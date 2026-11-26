"""The card policy: which card does a search player play, given what it sees?

Trained on self-play records by cross-entropy on the card that was played. What the engine
uses it for is the likelihood of an observed card under a supposed hand (engine/src/ai.rs),
so the calibrated probability matters more than the top choice.

    python train/policy.py data/sp1 nets/policy1 [--epochs 40] [--width 512]
"""
import argparse, json, pathlib, time
import numpy as np
import jax, jax.numpy as jnp, optax
import data as D

ap = argparse.ArgumentParser()
ap.add_argument('data'); ap.add_argument('out')
ap.add_argument('--epochs', type=int, default=40)
ap.add_argument('--width', type=int, default=512)
ap.add_argument('--batch', type=int, default=2048)
ap.add_argument('--lr', type=float, default=1e-3)
ap.add_argument('--seed', type=int, default=0)
a = ap.parse_args()
out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)

rec = D.load(f'{a.data}/cards.bin', D.CARD)
val = rec['deal'] % 20 == 0                                  # whole deals held out
dev = {k: jnp.asarray(rec[k]) for k in ('words', 'trump', 'dealer_rel', 'win_rel', 'n', 'action', 'adv')}
train_idx, val_idx = np.flatnonzero(~val), np.flatnonzero(val)
print(f'{len(rec)} decisions from {len(np.unique(rec["deal"]))} deals; {len(val_idx)} held out', flush=True)


def batch(idx, key=None):
    """Inputs, legal mask, card played and the search's values, suits permuted if key is given."""
    words, trump, action, adv = dev['words'][idx], dev['trump'][idx], dev['action'][idx].astype(jnp.int32), dev['adv'][idx]
    if key is not None:
        p = D.PERMS[jax.random.randint(key, (idx.shape[0],), 0, 24)]
        words = D.permute_words(words, p)
        inv = jnp.argsort(p, axis=1)
        action = jnp.take_along_axis(inv, (action >> 3)[:, None], axis=1)[:, 0] * 8 + (action & 7)
        adv = jnp.take_along_axis(adv.reshape(-1, 4, 8), p[:, :, None], axis=1).reshape(-1, 32)
        trump = D.new_suit(p, trump.astype(jnp.int32))
    x = D.expand(words, trump, dev['dealer_rel'][idx], dev['win_rel'][idx], dev['n'][idx])
    return x, D.bits32(words[:, 11]), action, adv


def logp(params, x, legal):
    return jax.nn.log_softmax(jnp.where(legal > 0, D.mlp(params, x), -1e9), axis=-1)


def loss(params, x, legal, action):
    return -jnp.take_along_axis(logp(params, x, legal), action[:, None], axis=1).mean()


steps = a.epochs * (len(train_idx) // a.batch)
opt = optax.adamw(optax.cosine_onecycle_schedule(steps, a.lr), weight_decay=1e-4)


@jax.jit
def step(params, state, idx, key):
    x, legal, action, _ = batch(idx, key)
    l, g = jax.value_and_grad(loss)(params, x, legal, action)
    upd, state = opt.update(g, state, params)
    return optax.apply_updates(params, upd), state, l


@jax.jit
def evaluate(params, idx):
    x, legal, action, adv = batch(idx)
    lp = logp(params, x, legal)
    pick = lp.argmax(-1)
    regret = -jnp.take_along_axis(adv, pick[:, None], axis=1)[:, 0] / 100.0      # card points lost to the search's best
    return (-jnp.take_along_axis(lp, action[:, None], axis=1)[:, 0].sum(), (pick == action).sum(), regret.sum(),
            jnp.log(legal.sum(-1)).sum())


def evaluate_all(params, idx):
    tot = np.zeros(4)
    for i in range(0, len(idx), 8192):
        tot += np.array(evaluate(params, jnp.asarray(idx[i:i + 8192])))
    return tot / len(idx)


key = jax.random.PRNGKey(a.seed)
params = D.init_mlp(key, [D.INPUTS, a.width, a.width, 32])
state = opt.init(params)
rng, log, t0 = np.random.default_rng(a.seed), [], time.time()
for epoch in range(a.epochs):
    perm, tl = rng.permutation(train_idx), []
    for i in range(0, len(perm) - a.batch + 1, a.batch):
        key, k = jax.random.split(key)
        params, state, l = step(params, state, jnp.asarray(perm[i:i + a.batch]), k)
        tl.append(l)
    nll, acc, regret, uniform = evaluate_all(params, val_idx)
    log.append({'epoch': epoch + 1, 'train_nll': float(np.mean(np.array(tl))), 'val_nll': nll, 'val_acc': acc,
                'val_regret': regret, 'uniform_nll': uniform})
    print(f'epoch {epoch + 1:3d}  train {log[-1]["train_nll"]:.4f}  val {nll:.4f} (uniform over legal {uniform:.4f})'
          f'  same card {100 * acc:.1f}%  loses {regret:.3f} points/decision  {time.time() - t0:.0f}s', flush=True)

D.save_mlp(out / 'policy.bin', params)
(out / 'policy.json').write_text(json.dumps({'args': vars(a), 'decisions': int(len(rec)), 'log': log}, indent=1))
# a few held-out records with the network's answer, for the engine's test (engine/tests/net.rs)
some = val_idx[:64]
x, legal, _, _ = batch(jnp.asarray(some))
rec[some].tofile(out / 'policy.check.records')
np.asarray(logp(params, x, legal), dtype='<f4').tofile(out / 'policy.check.logp')
print('saved', out / 'policy.bin')
