// The deal `manille deal seed worlds` plays, printed the same way, from the JavaScript
// engine. Same seeds, same generator: the two must agree card for card.
//   node experiments/crosscheck.js seed worlds
import { rng, Deal } from '../site/js/manille.js';
import { searchCard, searchTrump, searchDouble } from '../reference/ai.js';
import { playDeal } from '../site/js/game.js';
const seed = +process.argv[2], worlds = +process.argv[3];
const rand = rng(seed), deal = Deal.random(rng(seed + 99), seed & 3);
const r = await playDeal(deal, (seat, what, view) =>
  what === 'trump' ? searchTrump(view, { worlds: 16 }, rand).trump
    : what === 'double' ? searchDouble(view, { worlds: 30 }, rand).go
      : searchCard(view, { worlds }, rand).card);
console.log(`${seed} trump ${r.trump} mee ${r.mee} tegen ${r.tegen} | ${deal.plays.join(' ')} | ${r.points[0]} ${r.points[1]}`);
