"""The self-play records the engine writes (engine/src/selfplay.rs) and the network's input
(engine/src/features.rs), on the JAX side. Suits are interchangeable, so every sample can be
shown with its suits permuted: 24 times the data for free."""
import itertools
import numpy as np
import jax, jax.numpy as jnp

CARD = np.dtype([('deal', '<u4'), ('words', '<u4', (12,)), ('trump', 'u1'), ('dealer_rel', 'u1'),
                 ('win_rel', 'u1'), ('n', 'u1'), ('action', 'u1'), ('seat', 'u1'), ('mult', 'u1'),
                 ('outcome', 'u1'), ('best', '<i2'), ('pad', '<i2'), ('adv', '<i2', (32,))])
TRUMP = np.dtype([('deal', '<u4'), ('hand', '<u4'), ('trump', 'u1'), ('seat', 'u1'), ('pad', '<u2'),
                  ('mean', '<f4', (5,))])
DOUBLE = np.dtype([('deal', '<u4'), ('hand', '<u4'), ('trump', 'u1'), ('dealer_rel', 'u1'), ('go', 'u1'),
                   ('outcome', 'i1'), ('mean', '<f4'), ('win', '<f4'), ('pad', '<u4')])
assert (CARD.itemsize, TRUMP.itemsize, DOUBLE.itemsize) == (128, 32, 24)
INPUTS = 32 * 12 + 5 + 4 + 4 + 4
PERMS = jnp.array(list(itertools.permutations(range(4))), dtype=jnp.int32)       # (24, 4)


def load(path, dtype):
    """All whole records of a file (a run that is still writing ends mid-record)."""
    n = (np.fromfile(path, dtype=np.uint8).size // dtype.itemsize)
    return np.fromfile(path, dtype=dtype, count=n)


def permute_words(words, p):
    """Card sets (..., uint32) with new suit j taken from old suit p[..., j]."""
    shifts = 8 * jnp.arange(4, dtype=jnp.uint32)
    b = (words[..., None] >> shifts) & jnp.uint32(0xff)
    b = jnp.take_along_axis(b, jnp.broadcast_to(p[..., None, :], b.shape).astype(jnp.int32), axis=-1) \
        if words.ndim == 2 else jnp.take_along_axis(b, p, axis=-1)
    return (b << shifts).sum(-1).astype(jnp.uint32)


def new_suit(p, s):
    """Where old suit s ends up under p (4 = no trump stays 4)."""
    inv = jnp.argsort(p, axis=-1)
    return jnp.where(s < 4, jnp.take_along_axis(inv, jnp.minimum(s, 3)[:, None].astype(jnp.int32), axis=1)[:, 0], 4)


def expand(words, trump, dealer_rel, win_rel, n):
    """The network's input: (B, INPUTS) zeros and ones."""
    bits = ((words[..., None] >> jnp.arange(32, dtype=jnp.uint32)) & 1).reshape(words.shape[0], -1)
    return jnp.concatenate([bits.astype(jnp.float32), jax.nn.one_hot(trump, 5), jax.nn.one_hot(dealer_rel, 4),
                            jax.nn.one_hot(win_rel, 4), jax.nn.one_hot(n, 4)], axis=-1)


def bits32(word):
    return ((word[:, None] >> jnp.arange(32, dtype=jnp.uint32)) & 1).astype(jnp.float32)


def init_mlp(key, sizes):
    params = []
    for k, (i, o) in zip(jax.random.split(key, len(sizes) - 1), zip(sizes[:-1], sizes[1:])):
        params.append({'w': jax.random.normal(k, (i, o)) * np.sqrt(2.0 / i), 'b': jnp.zeros(o)})
    return params


def mlp(params, x):
    for layer in params[:-1]:
        x = jax.nn.relu(x @ layer['w'] + layer['b'])
    return x @ params[-1]['w'] + params[-1]['b']


def save_mlp(path, params):
    """'MNLP', number of layers, then per layer: inputs, outputs, w[inputs][outputs], b[outputs]
    (float32, little-endian). Read by engine/src/net.rs."""
    with open(path, 'wb') as f:
        f.write(b'MNLP' + np.uint32(len(params)).tobytes())
        for layer in params:
            w = np.asarray(layer['w'], dtype='<f4')
            f.write(np.array(w.shape, dtype='<u4').tobytes() + w.tobytes() + np.asarray(layer['b'], dtype='<f4').tobytes())
