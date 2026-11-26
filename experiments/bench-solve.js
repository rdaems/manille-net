// How long does the open-card solver take to value every legal card of one position, by the
// number of cards left and by where the search stops? (node experiments/bench-solve.js)
import { Deal, rng, cards } from '../site/js/manille.js';
import { makeSolver } from '../site/js/solve.js';
const solver = makeSolver();
for (const left of [32, 31, 30, 28, 24, 20]) {
  for (const stop of [0, 20, 16, 12]) {
    if (stop && stop > left - 8) continue;
    const rand = rng(3), N = 16;
    let ms = [];
    for (let g = 0; g < N; g++) {
      const d = Deal.random(rand, g & 3);
      d.trump = Math.floor(rand() * 5);
      while (32 - d.plays.length > left) { const l = cards(d.legal()); d.play(l[Math.floor(rand() * l.length)]); }
      const t = performance.now();
      solver.reset(d.hands, d.trump, stop);
      for (const c of cards(d.legal())) solver.after(c, d.turn, d.n, d.led, d.win, d.winSeat, d.trickPts);
      ms.push(performance.now() - t);
    }
    ms.sort((a, b) => a - b);
    console.log(`${left} cards, stop ${String(stop).padStart(2)}: median ${ms[N >> 1].toFixed(1)} ms, max ${ms[N - 1].toFixed(0)} ms`);
  }
}
