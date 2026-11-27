// The AI thinks here, off the page, so the table keeps moving. The engine is the Rust one
// (../../engine), built as WebAssembly: plain numbers in and out.
const file = async name => new Uint8Array(await (await fetch(new URL('../' + name, import.meta.url))).arrayBuffer());
const engine = (async () => {
  const x = (await WebAssembly.instantiate(await file('manille.wasm'), {})).instance.exports;
  // The two networks (fitted to self-play, see results on the research page): with them the
  // engine weighs every deal it draws by how likely the play so far is under it. If they do
  // not arrive the players are plain search, which also works.
  try {
    const put = bytes => { const at = x.alloc(bytes.length); new Uint8Array(x.memory.buffer, at, bytes.length).set(bytes); return at; };
    const [policy, trump] = await Promise.all([file('policy.bin'), file('trump.bin')]);
    x.load_nets(put(policy), policy.length, put(trump), trump.length);
  } catch (e) { console.warn('no networks, playing plain search', e); }
  return x;
})();

// How many deals the AI draws for a card, for the trump choice (five contracts each) and for
// meegaan/tegengaan. In the first trick a deal takes long to solve, so fewer are drawn there
// (a slow phone should still answer within a second or two).
const WORLDS = { card: 40, early: 20, trump: 16, double: 30 };
const seed = () => (Math.random() * 2 ** 32) >>> 0;

onmessage = async e => {
  const x = await engine, { id, what, view } = e.data;
  let result;
  if (what === 'card') {
    new Uint8Array(x.memory.buffer, x.plays_ptr(), 32).set(view.plays);
    result = { card: x.card(view.seat, view.hand, view.dealer, view.trump, view.plays.length, view.plays.length < 4 ? WORLDS.early : WORLDS.card, seed()) };
  } else if (what === 'trump') {
    result = { trump: x.trump(view.seat, view.hand, WORLDS.trump, seed()) };
  } else {
    result = { go: !!x.double(view.seat, view.hand, view.dealer, view.trump, WORLDS.double, seed()) };
  }
  postMessage({ id, result });
};
