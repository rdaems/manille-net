// A whole deal, from the cards being dealt to the score: the dealer names trump, the others
// may go along (meegaan), the dealer's side may go against (tegengaan), eight tricks.
// The four seats are asked through `ask(seat, what, view)`, which may be async (a person).
import { Deal, dealScore, NOTRUMP, teamOf } from './manille.js';

export const viewOf = (deal, seat, mult) => ({
  seat, hand: deal.hands[seat], dealer: deal.dealer, trump: deal.trump,
  leader0: deal.leader0, plays: deal.plays, mult,
});

// carry: the multiplier the deal starts with (2 after a 30-30). `on` gets told what happens.
export async function playDeal(deal, ask, { carry = 1, on = () => {} } = {}) {
  const d = deal.dealer;
  deal.trump = await ask(d, 'trump', viewOf(deal, d, carry));
  let mult = carry * (deal.trump === NOTRUMP ? 2 : 1);
  await on('trump', { seat: d, trump: deal.trump, mult });
  let mee = -1, tegen = -1;
  for (const s of [(d + 1) & 3, (d + 3) & 3]) {           // the dealer's opponents, left first
    if (await ask(s, 'double', viewOf(deal, s, mult))) { mee = s; mult *= 2; await on('mee', { seat: s, mult }); break; }
  }
  if (mee >= 0) for (const s of [d, (d + 2) & 3]) {
    if (await ask(s, 'double', viewOf(deal, s, mult))) { tegen = s; mult *= 2; await on('tegen', { seat: s, mult }); break; }
  }
  while (!deal.done) {
    const seat = deal.turn;
    const card = await ask(seat, 'card', viewOf(deal, seat, mult));
    const trick = deal.play(card);
    await on('card', { seat, card });
    if (trick) await on('trick', trick);
  }
  const result = dealScore(deal.points[0], deal.tricks[0], mult);
  return { ...result, points: deal.points.slice(), tricks: deal.tricks.slice(), mult, trump: deal.trump, mee, tegen, dealer: d };
}

export const freshDeal = (rand, dealer) => Deal.random(rand, dealer);
