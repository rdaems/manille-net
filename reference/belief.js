// What a seat can know about the hidden hands, and deals drawn from exactly that.
//
// The rules force a lot, so every card somebody played tells what that hand did not hold:
// not following suit shows a void; staying under an opponent's card shows nothing higher;
// throwing a plain card on an opponent's trick shows no (higher) trump. `know` turns the
// public history into one mask per seat of cards that seat cannot have. `sampler` then draws
// the unseen cards uniformly over every deal that fits those masks and the hand sizes.
import { bit, suitMask, higher, beats, count, cards, teamOf, ALL } from '../site/js/manille.js';

// Replays the public history. Returns
//   cant[seat]  cards the seat cannot hold now (the played cards included)
//   played      every card that fell
//   left[seat]  cards the seat still holds
//   turn, n, led, win, winSeat   the trick in progress
export function know(leader0, trump, plays) {
  const cant = [0, 0, 0, 0], left = [8, 8, 8, 8];
  const T = suitMask(trump);
  let played = 0, leader = leader0, n = 0, led = -1, win = -1, winSeat = -1;
  for (const c of plays) {
    const seat = (leader + n) & 3, s = c >> 3;
    if (n === 0) { led = s; win = c; winSeat = seat; }
    else {
      const partner = teamOf(winSeat) === teamOf(seat), L = suitMask(led);
      if (s === led) {
        // followed, but stayed under an opponent's card of the suit: nothing higher
        if (!partner && (win >> 3) === led && c < win) cant[seat] |= higher(win);
      } else {
        cant[seat] |= L;                                  // void in the suit led
        if (T && led !== trump) {
          const trumped = (win >> 3) === trump;
          if (s === trump) {
            // a trump under the trump that holds the trick: only such trumps were left
            if (trumped && c < win) cant[seat] |= higher(win) | ~T;
          } else if (!partner) {
            cant[seat] |= trumped ? higher(win) : T;      // could not (over)trump
          }
        }
      }
      if (beats(c, win, trump)) { win = c; winSeat = seat; }
    }
    played |= bit(c); left[seat]--; n++;
    if (n === 4) { leader = winSeat; n = 0; led = -1; win = -1; winSeat = -1; }
  }
  for (let p = 0; p < 4; p++) cant[p] |= played;
  return { cant, played, left, turn: (leader + n) & 3, leader, n, led, win, winSeat };
}

const FACT = [1]; for (let i = 1; i <= 24; i++) FACT[i] = FACT[i - 1] * i;
const choose = (n, k) => FACT[n] / (FACT[k] * FACT[n - k]);

// A sampler of the three hidden hands as seat `me` sees them. Every unseen card has a type:
// the set of other seats that may hold it. Cards of one type are interchangeable, so a deal
// is a table (how many cards of each type go to each seat) and a shuffle inside each type.
// The tables are few; they are listed once with the number of deals each stands for, and a
// draw picks a table by that weight. That is exact and uniform, with no rejection.
// Returns a function (rand) -> Int32Array(4) of hands, or null when nothing fits.
export function sampler(me, myHand, k) {
  const A = (me + 1) & 3, B = (me + 2) & 3, C = (me + 3) & 3;
  const unseen = cards(ALL & ~k.played & ~myHand);
  const byType = [[], [], [], [], [], [], [], []];
  for (const c of unseen) {
    const b = bit(c);
    const t = (k.cant[A] & b ? 0 : 1) | (k.cant[B] & b ? 0 : 2) | (k.cant[C] & b ? 0 : 4);
    if (t === 0) return null;
    byType[t].push(c);
  }
  const n = byType.map(x => x.length);
  const capA = k.left[A] - n[1], capB = k.left[B] - n[2], capC = k.left[C] - n[4];
  if (capA < 0 || capB < 0 || capC < 0) return null;
  // x: cards of type AB to A, y: of type AC to A, z: of type BC to B; a, b, c: of type ABC
  const tables = []; let total = 0;
  for (let x = 0; x <= n[3]; x++) for (let y = 0; y <= n[5]; y++) {
    const a = capA - x - y;
    if (a < 0 || a > n[7]) continue;
    for (let z = 0; z <= n[6]; z++) {
      const b = capB - (n[3] - x) - z, c = n[7] - a - b;
      if (b < 0 || c < 0) continue;
      if ((n[5] - y) + (n[6] - z) + c !== capC) continue;
      const w = choose(n[3], x) * choose(n[5], y) * choose(n[6], z) * FACT[n[7]] / (FACT[a] * FACT[b] * FACT[c]);
      total += w; tables.push([w, x, y, z, a, b]);
    }
  }
  if (!tables.length) return null;

  const mix = (arr, rand) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  const draw = rand => {
    let u = rand() * total, t = tables[tables.length - 1];
    for (const row of tables) { u -= row[0]; if (u < 0) { t = row; break; } }
    const [, x, y, z, a, b] = t;
    const h = new Int32Array(4); h[me] = myHand;
    const give = (list, seat, from, to) => { for (let i = from; i < to; i++) h[seat] |= bit(list[i]); };
    give(byType[1], A, 0, n[1]); give(byType[2], B, 0, n[2]); give(byType[4], C, 0, n[4]);
    let l = mix(byType[3], rand); give(l, A, 0, x); give(l, B, x, n[3]);
    l = mix(byType[5], rand); give(l, A, 0, y); give(l, C, y, n[5]);
    l = mix(byType[6], rand); give(l, B, 0, z); give(l, C, z, n[6]);
    l = mix(byType[7], rand); give(l, A, 0, a); give(l, B, a, a + b); give(l, C, a + b, n[7]);
    return h;
  };
  draw.deals = total;                                    // how many deals fit what is known
  return draw;
}
