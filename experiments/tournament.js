// Two kinds of player against each other, over many deals. Every deal is played twice with
// the same cards, the teams swapped, so the luck of the cards cancels.
//   node experiments/tournament.js search:30 thumb 200 [seed] > outputs/search30-thumb.json
import { rng } from '../site/js/manille.js';
import { players } from '../site/js/ai.js';
import { playDeal, freshDeal } from '../site/js/game.js';
import { Deal } from '../site/js/manille.js';

const make = spec => { const [name, w] = spec.split(':'); return players[name](w ? { worlds: +w } : undefined); };
const [specA, specB, nDeals = '100', seed = '1'] = process.argv.slice(2);
const A = make(specA), B = make(specB);
const cardsRand = rng(+seed), rand = rng(+seed + 1000);
const rows = [];
const t0 = Date.now();
for (let g = 0; g < +nDeals; g++) {
  const first = freshDeal(cardsRand, g & 3);
  const row = { dealer: g & 3 };
  for (const swap of [0, 1]) {                           // swap 0: A sits 0 and 2
    const deal = new Deal(first.hands, first.dealer, first.trump);
    if (swap === 0) row.hands = Array.from(deal.hands);
    const r = await playDeal(deal, (seat, what, view) => ((seat & 1) === swap ? A : B)[what](view, rand));
    const a = swap;                                      // A's team
    row[swap ? 'b' : 'a'] = { trump: r.trump, mult: r.mult, pointsA: r.points[a], score: r.team < 0 ? 0 : (r.team === a ? r.score : -r.score) };
  }
  rows.push(row);
  if (process.stderr.isTTY || g % 10 === 9) {
    const d = rows.map(r => (r.a.pointsA + r.b.pointsA) / 2 - 30), m = d.reduce((x, y) => x + y, 0) / d.length;
    const sd = Math.sqrt(d.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, d.length - 1));
    process.stderr.write(`${g + 1} deals: ${specA} takes ${(m + 30).toFixed(1)} ± ${(sd / Math.sqrt(d.length)).toFixed(1)} of 60, ${((Date.now() - t0) / 1000 / (g + 1)).toFixed(1)} s per deal\n`);
  }
}
console.log(JSON.stringify({ a: specA, b: specB, seed: +seed, rows }));
