// The table's sounds, made on the spot (no files): a card landing, a trick being swept in,
// a knock for meegaan and tegengaan, a short tune when a deal or a game ends.
let ctx = null, muted = false;
try { muted = localStorage.getItem('manillen-mute') === '1'; } catch {}

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('manillen-mute', m ? '1' : '0'); } catch {}
}
// Browsers only let a page make sound after a tap or a click: call this from one.
export function wake() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {}
}

function noise(seconds) {
  const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const n = ctx.createBufferSource(); n.buffer = b; return n;
}
function env(gain, t, peak, attack, decay) {
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}
function hiss(t, { freq, q = 1, peak, attack = 0.002, decay, to }) {
  const n = noise(attack + decay + 0.02), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'bandpass'; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
  env(g, t, peak, attack, decay);
  n.connect(f).connect(g).connect(ctx.destination); n.start(t);
}
function tone(t, { freq, to, type = 'sine', peak, attack = 0.004, decay }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
  env(g, t, peak, attack, decay);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + attack + decay + 0.05);
}

const SOUNDS = {
  card(t) {                                              // a card slapped on felt
    hiss(t, { freq: 2600 + Math.random() * 900, q: 0.8, peak: 0.22, decay: 0.045 });
    tone(t, { freq: 170, to: 90, peak: 0.25, decay: 0.07 });
  },
  sweep(t) {                                             // four cards drawn across the cloth
    hiss(t, { freq: 900, to: 3200, q: 0.6, peak: 0.12, attack: 0.05, decay: 0.16 });
  },
  knock(t) {                                             // knuckles on the table, twice
    for (const d of [0, 0.13]) {
      tone(t + d, { freq: 210, to: 95, type: 'triangle', peak: 0.5, decay: 0.09 });
      hiss(t + d, { freq: 1200, q: 2, peak: 0.12, decay: 0.03 });
    }
  },
  ready(t) { hiss(t, { freq: 4200, q: 3, peak: 0.05, decay: 0.03 }); },   // a card set ready
  no(t) { tone(t, { freq: 150, to: 110, type: 'triangle', peak: 0.2, decay: 0.09 }); },
  won(t) { [523, 659, 784].forEach((f, i) => tone(t + i * 0.09, { freq: f, type: 'triangle', peak: 0.16, decay: 0.22 })); },
  lost(t) { [392, 330].forEach((f, i) => tone(t + i * 0.13, { freq: f, type: 'triangle', peak: 0.14, decay: 0.26 })); },
  game(t) { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(t + i * 0.11, { freq: f, type: 'triangle', peak: 0.17, decay: 0.3 })); },
};

export function play(name) {
  if (muted || !ctx || ctx.state !== 'running') return;
  try { SOUNDS[name](ctx.currentTime + 0.005); } catch {}
}
