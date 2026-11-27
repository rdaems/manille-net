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
for name, deals in (('try', 800), ('p6k', 6000), ('p20k-512', 20000), ('p30k-512', 30000)):
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

out = {'matches': matches, 'nets': nets, 'doubling': bins}
(ROOT / 'results' / 'data.json').write_text(json.dumps(out, separators=(',', ':')))
for m in matches:
    print(f"{m['mean']:.2f} ± {m['se']:.2f}  {m['deals']:5d} deals  {m['a']}  against  {m['b']}  {m['note']}")
print(len(nets), 'networks,', len(bins), 'calibration bins')
