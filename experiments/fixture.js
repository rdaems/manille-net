// Positions from random games with what the JavaScript engine says about them, one line of
// numbers each, for the Rust tests (engine/tests/positions.txt):
//   hands[4] trump leader0 nplays plays... legal cant[4] deals value
// legal: the cards the seat to move may play; cant, deals: what that seat knows (belief.js);
// value: card points team 0 still takes with open cards and perfect play (solve.js).
//   node experiments/fixture.js > engine/tests/positions.txt
import { Deal, rng, cards } from '../site/js/manille.js';
import { know, sampler } from '../reference/belief.js';
import { makeSolver } from '../reference/solve.js';
const rand = rng(2026), solver = makeSolver(), u = x => x >>> 0;
for (let g = 0; g < 400; g++) {
  const d = Deal.random(rand, g & 3);
  d.trump = Math.floor(rand() * 5);
  const stopAt = g < 12 ? 0 : g < 40 ? Math.floor(rand() * 8) : 6 + Math.floor(rand() * 26);
  while (d.plays.length < stopAt) { const l = cards(d.legal()); d.play(l[Math.floor(rand() * l.length)]); }
  const k = know(d.leader0, d.trump, d.plays), me = d.turn;
  solver.reset(d.hands, d.trump);
  console.log([...Array.from(d.hands, u), d.trump, d.leader0, d.plays.length, ...d.plays, u(d.legal()),
    ...k.cant.map(u), sampler(me, d.hands[me], k).deals, solver.value(d.turn, d.n, d.led, d.win, d.winSeat, d.trickPts)].join(' '));
}
