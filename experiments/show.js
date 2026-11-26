// One deal between search players, written out card by card with what the player to move
// believed each legal card was worth.   node experiments/show.js [seed] [worlds]
import { rng, cards, cardName, SUITS, NOTRUMP, Deal } from '../site/js/manille.js';
import { searchCard, searchTrump, searchDouble } from '../site/js/ai.js';
import { playDeal } from '../site/js/game.js';
const seed = +(process.argv[2] || 1), worlds = +(process.argv[3] || 30);
const rand = rng(seed), deal = Deal.random(rng(seed + 99), seed & 3);
const show = m => cards(m).reverse().map(cardName).join(' ');
for (let s = 0; s < 4; s++) console.log(`seat ${s}${s === deal.dealer ? ' (dealer)' : ''}: ${show(deal.hands[s])}`);
let line = '';
const r = await playDeal(deal, (seat, what, view) => {
  if (what === 'trump') {
    const t = searchTrump(view, { worlds: 16 }, rand);
    console.log('trump:', t.contracts.map(c => `${c.trump === NOTRUMP ? 'none' : SUITS[c.trump]} ${c.mean.toFixed(1)}`).join('  '), '->', t.trump === NOTRUMP ? 'none' : SUITS[t.trump]);
    return t.trump;
  }
  if (what === 'double') {
    const d = searchDouble(view, { worlds: 30 }, rand);
    console.log(`seat ${seat} double? worth ${d.mean.toFixed(1)}, wins ${(100 * d.win).toFixed(0)}% -> ${d.go}`);
    return d.go;
  }
  const c = searchCard(view, { worlds }, rand);
  line += `  ${seat}:${cardName(c.card)}` + (c.values.length ? ` [${c.values.map(v => `${cardName(v.card)} ${v.mean.toFixed(1)}`).join(', ')}; ${c.deals.toExponential(1)} deals]` : '') + '\n';
  return c.card;
}, { on: (what, t) => { if (what === 'trick') { console.log(line + `  -> seat ${t.winner} takes ${t.points}`); line = ''; } } });
console.log(r);
