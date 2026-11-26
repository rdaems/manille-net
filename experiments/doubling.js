// Is the estimate behind meegaan/tegengaan honest? Deals between search players, nobody
// doubles; for every seat we keep what it believed the deal was worth to its side (card
// points above 30, searchDouble) and what its side then took.
//   node experiments/doubling.js deals seed [worlds] > outputs/doubling-<seed>.json
import { rng, Deal } from '../site/js/manille.js';
import { searchCard, searchTrump, searchDouble } from '../reference/ai.js';
import { playDeal } from '../site/js/game.js';
const [n = '100', seed = '1', worlds = '12'] = process.argv.slice(2);
const rand = rng(+seed + 5000), cardsRand = rng(+seed + 7000), rows = [];
for (let g = 0; g < +n; g++) {
  const deal = Deal.random(cardsRand, g & 3), est = [];
  const r = await playDeal(deal, (seat, what, view) => {
    if (what === 'trump') return searchTrump(view, { worlds: 12 }, rand).trump;
    if (what === 'card') return searchCard(view, { worlds: +worlds }, rand).card;
    return false;
  }, { on: (what) => {
    if (what !== 'trump') return;
    for (let s = 0; s < 4; s++) {
      if (s === deal.dealer) continue;
      const d = searchDouble({ seat: s, hand: deal.hands[s], dealer: deal.dealer, trump: deal.trump }, { worlds: 30 }, rand);
      est.push({ seat: s, side: (s & 1) === (deal.dealer & 1) ? 'dealer' : 'other', mean: d.mean, win: d.win });
    }
  } });
  for (const e of est) rows.push({ ...e, trump: r.trump, got: r.points[e.seat & 1] - 30 });
  if (g % 20 === 19) process.stderr.write(`${g + 1}\n`);
}
console.log(JSON.stringify(rows));
