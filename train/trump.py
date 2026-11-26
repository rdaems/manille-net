"""The trump policy: which trump does a search player name with these eight cards?

    python train/trump.py data/sp1 nets/policy1 [--epochs 300]
"""
import argparse, json, pathlib
import numpy as np
import jax, jax.numpy as jnp, optax
import data as D

ap = argparse.ArgumentParser()
ap.add_argument('data'); ap.add_argument('out')
ap.add_argument('--epochs', type=int, default=300)
ap.add_argument('--width', type=int, default=64)
ap.add_argument('--batch', type=int, default=1024)
ap.add_argument('--lr', type=float, default=2e-3)
a = ap.parse_args()
out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)

rec = D.load(f'{a.data}/trumps.bin', D.TRUMP)
val = rec['deal'] % 20 == 0
hand, trump = jnp.asarray(rec['hand']), jnp.asarray(rec['trump'].astype(np.int32))
train_idx, val_idx = np.flatnonzero(~val), np.flatnonzero(val)
freq = np.bincount(rec['trump'][~val], minlength=5) / (~val).sum()
print(f'{len(rec)} deals; trump named: suits {freq[:4].round(3)}, none {freq[4]:.3f}', flush=True)


def loss(params, h, t):
    return -jnp.take_along_axis(jax.nn.log_softmax(D.mlp(params, D.bits32(h))), t[:, None], axis=1).mean()


a.batch = min(a.batch, len(train_idx))
steps = a.epochs * (len(train_idx) // a.batch)
opt = optax.adamw(optax.cosine_onecycle_schedule(steps, a.lr), weight_decay=1e-4)


@jax.jit
def step(params, state, idx, key):
    p = D.PERMS[jax.random.randint(key, (idx.shape[0],), 0, 24)]
    h, t = D.permute_words(hand[idx], p), D.new_suit(p, trump[idx])
    l, g = jax.value_and_grad(loss)(params, h, t)
    upd, state = opt.update(g, state, params)
    return optax.apply_updates(params, upd), state, l


key = jax.random.PRNGKey(0)
params = D.init_mlp(key, [32, a.width, a.width, 5])
state, rng, log = opt.init(params), np.random.default_rng(0), []
vi = jnp.asarray(val_idx)
for epoch in range(a.epochs):
    perm = rng.permutation(train_idx)
    for i in range(0, len(perm) - a.batch + 1, a.batch):
        key, k = jax.random.split(key)
        params, state, l = step(params, state, jnp.asarray(perm[i:i + a.batch]), k)
    if (epoch + 1) % 20 == 0:
        lp = jax.nn.log_softmax(D.mlp(params, D.bits32(hand[vi])))
        nll = float(-jnp.take_along_axis(lp, trump[vi][:, None], axis=1).mean())
        acc = float((lp.argmax(-1) == trump[vi]).mean())
        base = float(-np.log(freq[rec['trump'][val_idx]]).mean())
        log.append({'epoch': epoch + 1, 'val_nll': nll, 'val_acc': acc, 'marginal_nll': base})
        print(f'epoch {epoch + 1:3d}  val {nll:.4f} (frequencies alone {base:.4f})  same trump {100 * acc:.1f}%', flush=True)

D.save_mlp(out / 'trump.bin', params)
(out / 'trump.json').write_text(json.dumps({'args': vars(a), 'deals': int(len(rec)), 'log': log}, indent=1))
some = val_idx[:64]
rec[some].tofile(out / 'trump.check.records')
np.asarray(jax.nn.log_softmax(D.mlp(params, D.bits32(hand[jnp.asarray(some)]))), dtype='<f4').tofile(out / 'trump.check.logp')
print('saved', out / 'trump.bin')
