// The players. Each decision gets a `view`: what one seat may know, never the other hands.
//   view = { seat, hand, dealer, trump, leader0, plays, mult }
//
// `search` is the AI of the site: it draws deals that fit everything the seat knows
// (belief.js), solves each of them with open cards (solve.js), and plays the card that is
// best on average. The same draw-and-solve answers the dealer's question (which trump?) and
// the doubling questions (meegaan? tegengaan?).
import { cards, legal, teamOf, pointsOf, suitMask, count, maskPoints, NOTRUMP } from '../site/js/manille.js';
import { know, sampler } from './belief.js';
import { makeSolver } from './solve.js';

const solver = makeSolver();
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// A rule of thumb for a hand with suit s as trump: two per trump, half a point per card point.
export const suitStrength = (hand, s) => {
  const m = hand & suitMask(s);
  return 2 * count(m) + 0.5 * maskPoints(m);
};
const thumbTrump = hand => {
  let best = 0;
  for (let s = 1; s < 4; s++) if (suitStrength(hand, s) > suitStrength(hand, best)) best = s;
  return best;
};

// What the deal is worth to `team` when team 0 takes p0 card points: the points above 30,
// negative when the others have them. (The sweep bonus is left out.)
const worth = (p0, team) => (team === 0 ? p0 - 30 : 30 - p0);

function position(view) {
  const k = know(view.leader0, view.trump, view.plays);
  let pts = 0;
  for (let i = view.plays.length - k.n; i < view.plays.length; i++) pts += pointsOf(view.plays[i]);
  const partner = k.n > 0 && teamOf(k.winSeat) === teamOf(view.seat);
  return { k, pts, partner, moves: cards(legal(view.hand, view.trump, k.n, k.led, k.win, partner)) };
}

// ---- search ----------------------------------------------------------------------------

// opts: worlds (deals to draw), ms (stop drawing after this long, 0 = never), min (draw at
// least this many whatever the clock says), blind (see below).
export function searchCard(view, opts, rand) {
  const { k, pts, moves } = position(view);
  if (moves.length === 1) return { card: moves[0], worlds: 0, values: [] };
  // blind: forget what the forced plays revealed, keep only which cards fell (for comparison)
  if (opts.blind) k.cant = k.cant.map(() => k.played);
  const draw = sampler(view.seat, view.hand, k);
  const sum = new Float64Array(moves.length);
  const left = 32 - view.plays.length;
  const stop = left === 32 ? 16 : 0;                     // the opening lead is searched 4 tricks deep
  const t0 = now(), min = opts.min || 4;
  let w = 0;
  for (; w < opts.worlds; w++) {
    if (opts.ms && w >= min && now() - t0 > opts.ms) break;
    solver.reset(draw(rand), view.trump, stop);
    for (let i = 0; i < moves.length; i++) sum[i] += solver.after(moves[i], view.seat, k.n, k.led, k.win, k.winSeat, pts);
  }
  // team 1 wants team 0 to take as little as possible
  const sign = teamOf(view.seat) === 0 ? 1 : -1;
  let best = 0;
  for (let i = 1; i < moves.length; i++) {
    const d = sign * (sum[i] - sum[best]);
    // equal on average: keep the stronger card in hand
    if (d > 1e-9 || (Math.abs(d) <= 1e-9 && moves[i] % 8 < moves[best] % 8)) best = i;
  }
  return { card: moves[best], worlds: w, deals: draw.deals, values: moves.map((c, i) => ({ card: c, mean: sum[i] / w })) };
}

// For every contract, what the deal is worth to the seat's team on average over drawn deals
// (card points above 30, with open cards), and how often the team gets above 30.
function contracts(view, list, opts, rand) {
  const k = know((view.dealer + 1) & 3, NOTRUMP, []);
  const draw = sampler(view.seat, view.hand, k);
  const team = teamOf(view.seat), lead = (view.dealer + 1) & 3;
  const mean = list.map(() => 0), wins = list.map(() => 0);
  const t0 = now(), min = opts.min || 4;
  let w = 0, total = 0;
  for (; w < opts.worlds; w++) {
    if (opts.ms && w >= min && now() - t0 > opts.ms) break;
    const h = draw(rand);
    // somebody else dealt and chose this trump: deals in which the rule of thumb would have
    // chosen it too count fully, the others for a quarter
    let weight = 1;
    if (view.seat !== view.dealer && list.length === 1 && list[0] !== NOTRUMP && thumbTrump(h[view.dealer]) !== list[0]) weight = 0.25;
    total += weight;
    list.forEach((trump, i) => {
      solver.reset(h, trump, opts.stop ?? 16);
      const v = worth(solver.value(lead, 0, -1, -1, -1, 0), team);
      mean[i] += weight * v; if (v > 0) wins[i] += weight;
    });
  }
  return list.map((trump, i) => ({ trump, mean: mean[i] / total, win: wins[i] / total, worlds: w }));
}

export function searchTrump(view, opts, rand) {
  const c = contracts(view, [0, 1, 2, 3, NOTRUMP], opts, rand);
  let best = c[0];
  const value = x => x.mean * (x.trump === NOTRUMP ? 2 : 1);   // no trump counts double
  for (const x of c) if (value(x) > value(best)) best = x;
  return { trump: best.trump, contracts: c };
}

// Meegaan (an opponent of the dealer doubles) or tegengaan (the dealer's side doubles back).
// The estimate is too rosy for the dealer's opponents: over 600 deals between search players
// (experiments/doubling.js, 2026-11-26) the dealer's side ended 6 card points above 30 on
// average, and an opponent who believed in +4 to +12 ended around -1. From +12 on it paid
// (right 3 times in 4). After such a meegaan the dealer's side lost 4 deals in 5, whatever
// its own estimate said, so going against asks for the same high bar.
export function searchDouble(view, opts, rand) {
  const [c] = contracts(view, [view.trump], opts, rand);
  const back = teamOf(view.seat) === teamOf(view.dealer);
  return { go: c.mean >= 12 && c.win >= (back ? 0.9 : 0.85), ...c };
}

// ---- baselines -------------------------------------------------------------------------

export const players = {
  search: (opts = { worlds: 30 }) => ({
    card: (view, rand) => searchCard(view, opts, rand).card,
    trump: (view, rand) => searchTrump(view, { worlds: 12, ...opts }, rand).trump,
    double: (view, rand) => searchDouble(view, { worlds: 24, ...opts }, rand).go,
  }),
  // search that ignores what the forced plays reveal
  blind: (opts = { worlds: 30 }) => players.search({ ...opts, blind: true }),
  // a legal card at random, a suit at random, never doubles
  random: () => ({
    card: (view, rand) => { const m = position(view).moves; return m[Math.floor(rand() * m.length)]; },
    trump: (view, rand) => Math.floor(rand() * 4),
    double: () => false,
  }),
  // the rules of thumb the solver uses to order its search: lead high, win when you can,
  // feed your partner, throw the cheapest; longest-strongest suit as trump
  thumb: () => ({
    card: view => {
      const { k, partner } = position(view);
      return solver.greedy(view.hand, view.trump, k.n, k.led, k.win, partner);
    },
    trump: view => thumbTrump(view.hand),
    double: () => false,
  }),
};
