#!/usr/bin/env python3
"""results/data.json for results/index.html, from what the runs left in outputs/ and nets/
(neither is in git; this small summary is). Run it after pulling from hippo:

    ../bin/hippo pull && python3 results/build.py
"""
import glob, json, math, pathlib, statistics as st

ROOT = pathlib.Path(__file__).resolve().parent.parent

# (files, A, B, note): every match is A against B on duplicate deals (same cards, sides swapped)
MATCHES = [
    ('thumb-random.json', 'rules of thumb', 'random legal card', ''),
    ('rs-search30-thumb.json', 'search', 'rules of thumb', '30 deals drawn per decision'),
    ('search:30-blind:30-*.json', 'search', 'search without the forced-play inference', ''),
    ('rs-exact30-search30.json', 'search, every deal solved to the end', 'search', 'at three times the cost'),
    ('belief1-p6k.json', 'weighted, 30 drawn', 'search', 'network from 6,000 deals'),
    ('belief05-p6k.json', 'weighted to the power ½, 30 drawn', 'search', 'network from 6,000 deals'),
    ('belief1x8-p6k.json', 'weighted, 240 drawn, 30 solved', 'search', 'network from 6,000 deals'),
    ('belief05x8-p6k.json', 'weighted to the power ½, 240 drawn, 30 solved', 'search', 'network from 6,000 deals'),
    ('belief1x8-p20k.json', 'weighted, 240 drawn, 30 solved', 'search', 'network from 20,000 deals'),
    ('belief1x8-p20k-thumb.json', 'weighted, 240 drawn, 30 solved', 'rules of thumb', 'network from 20,000 deals'),
    ('belief1x8-p30k.json', 'weighted, 240 drawn, 30 solved', 'search', 'network from 30,000 deals'),
]

matches = []
for pattern, a, b, note in MATCHES:
    d = []
    for f in sorted(glob.glob(str(ROOT / 'outputs' / pattern))):
        try:
            rows = json.load(open(f))['rows']
        except (ValueError, KeyError):
            continue                                   # a run that was stopped
        d += [(r['a']['pointsA'] + r['b']['pointsA']) / 2 for r in rows]
    if len(d) < 50:
        continue
    hist = [0] * 121                                   # A's card points over the two seatings together
    for x in d:
        hist[int(round(2 * x))] += 1
    matches.append({'a': a, 'b': b, 'note': note, 'deals': len(d), 'mean': st.mean(d),
                    'se': st.stdev(d) / math.sqrt(len(d)), 'hist': hist})

# the networks: held-out log-loss by epoch, one curve per amount of self-play
nets = []
for name, deals in (('try', 800), ('p6k', 6000), ('p20k-512', 20000), ('g1', 30000)):
    f = ROOT / 'nets' / name / 'policy.json'
    if f.exists():
        j = json.load(open(f))
        t = ROOT / 'nets' / name / 'trump.json'
        nets.append({'deals': deals, 'decisions': j['decisions'], 'width': j['args']['width'],
                     'log': [{k: round(e[k], 4) for k in ('epoch', 'val_nll', 'val_acc', 'val_regret', 'uniform_nll')} for e in j['log']],
                     'trump': json.load(open(t))['log'][-1] if t.exists() else None})

# what a seat believed the deal was worth to its side, and what the side then took
doubling = [r for f in sorted(glob.glob(str(ROOT / 'outputs' / 'doubling-*.json'))) for r in json.load(open(f))]
bins = []
for side in ('other', 'dealer'):
    rows = sorted((r for r in doubling if r['side'] == side), key=lambda r: r['mean'])
    n = max(1, len(rows) // 12)
    for i in range(0, len(rows) - n + 1, n):
        b = rows[i:i + n]
        got = [r['got'] for r in b]
        bins.append({'side': side, 'est': st.mean(r['mean'] for r in b), 'got': st.mean(got),
                     'se': st.stdev(got) / math.sqrt(len(got)), 'n': len(b)})

# ---- ratings -------------------------------------------------------------------------------
# outputs/ladder/<A>__<B>.json: everybody against everybody (experiments/ladder.sh). A rating
# is about winning a game (a boom, first to 121), which is what a player cares about: for each
# pair the chance that A wins a game is found by playing games out of deals drawn at random
# from their match (a 30-30 doubles the next deal), and the ratings are the Elo numbers that
# fit those chances best (weighted least squares on the log-odds, plain search fixed at 0).
import random
random.seed(1)
ELO = 400 / math.log(10)


def game_chance(scores, games):
    """Chance that A reaches 121 first when deals come at random from `scores` (A's signed score per deal)."""
    won = 0
    for _ in range(games):
        a = b = 0; carry = 1
        while a < 121 and b < 121:
            s = random.choice(scores)
            if s > 0: a += s * carry
            elif s < 0: b -= s * carry
            carry = 2 if s == 0 else 1
        won += a >= 121
    return won / games


pairs, names = [], []
for f in sorted(glob.glob(str(ROOT / 'outputs' / 'ladder' / '*__*.json'))):
    a, b = pathlib.Path(f).stem.split('__')
    rows = json.load(open(f))['rows']
    scores = [r[h]['score'] for r in rows for h in 'ab']
    p = game_chance(scores, 20000)
    boot = [game_chance(random.choices(scores, k=len(scores)), 2500) for _ in range(16)]
    se = max(st.stdev(boot), 0.004)
    p = min(0.997, max(0.003, p))
    points = [(r['a']['pointsA'] + r['b']['pointsA']) / 2 for r in rows]
    pairs.append({'a': a, 'b': b, 'p': p, 'se': se, 'deals': len(rows), 'points': st.mean(points),
                  'points_se': st.stdev(points) / math.sqrt(len(points))})
    names += [n for n in (a, b) if n not in names]

ratings = []
if pairs:
    order = ['random', 'thumb', 'search'] + sorted((n for n in names if n[0] == 'g'), key=lambda n: int(n[1:]))
    free = [n for n in order if n != 'search' and n in names]
    k = len(free)
    A = [[0.0] * k for _ in range(k)]; rhs = [0.0] * k
    for q in pairs:
        y = ELO * math.log(q['p'] / (1 - q['p']))
        w = 1 / (ELO * q['se'] / (q['p'] * (1 - q['p']))) ** 2
        x = [0.0] * k
        if q['a'] in free: x[free.index(q['a'])] = 1.0
        if q['b'] in free: x[free.index(q['b'])] = -1.0
        for i in range(k):
            rhs[i] += w * x[i] * y
            for j in range(k):
                A[i][j] += w * x[i] * x[j]
    # solve A r = rhs and invert A (Gauss-Jordan on [A | rhs | I])
    M = [A[i] + [rhs[i]] + [1.0 if i == j else 0.0 for j in range(k)] for i in range(k)]
    for i in range(k):
        piv = max(range(i, k), key=lambda r: abs(M[r][i])); M[i], M[piv] = M[piv], M[i]
        d = M[i][i]; M[i] = [v / d for v in M[i]]
        for r in range(k):
            if r != i and M[r][i]:
                f = M[r][i]; M[r] = [v - f * u for v, u in zip(M[r], M[i])]
    label = {'random': 'random legal card', 'thumb': 'rules of thumb', 'search': 'search'}
    for n in order:
        if n not in names: continue
        i = free.index(n) if n in free else -1
        ratings.append({'id': n, 'label': label.get(n, f'generation {n[1:]}'), 'generation': int(n[1:]) if n[0] == 'g' else (0 if n == 'search' else None),
                        'elo': M[i][k] if i >= 0 else 0.0, 'se': math.sqrt(M[i][k + 1 + i]) if i >= 0 else 0.0})

out = {'matches': matches, 'nets': nets, 'doubling': bins, 'ratings': ratings, 'pairs': pairs}
(ROOT / 'results' / 'data.json').write_text(json.dumps(out, separators=(',', ':')))
for m in matches:
    print(f"{m['mean']:.2f} ± {m['se']:.2f}  {m['deals']:5d} deals  {m['a']}  against  {m['b']}  {m['note']}")
print(len(nets), 'networks,', len(bins), 'calibration bins')
for r in ratings:
    print(f"{r['elo']:+7.0f} ± {r['se']:.0f}  {r['label']}")
for q in pairs:
    print(f"  {q['a']:>7} beats {q['b']:<7} in {100 * q['p']:.1f}% of games (± {100 * q['se']:.1f}); {q['points']:.2f} of 60 card points per deal")
