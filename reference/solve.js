// Open-card solver: with all four hands known, the card points team 0 still takes when both
// teams play perfectly. Alpha-beta over the cards, with a table of positions at the trick
// boundaries. For one deal the cards that are left and the seat to lead fix such a position,
// so the key is that mask and that seat; the table is only valid for the deal it was built on.
import { POINTS, suitMask, legal, beats, maskPoints, count } from '../site/js/manille.js';

export function makeSolver() {
  const tt = new Map();
  const hands = new Int32Array(4);
  const moves = Array.from({ length: 33 }, () => new Int32Array(8));
  const order = Array.from({ length: 33 }, () => new Int32Array(8));
  let trump = 4, T = 0, stop = 0, nodes = 0;

  // Sorts the legal cards of the seat to play, most promising first, into moves[ply].
  function list(ply, mask, n, win, partner) {
    const m = moves[ply], o = order[ply];
    let k = 0;
    while (mask) {
      const b = mask & -mask, c = 31 - Math.clz32(b), r = c & 7;
      mask ^= b;
      let s;
      if (n === 0) s = r + ((b & T) ? -4 : 0);                     // lead high, keep trumps
      else if (beats(c, win, trump)) s = 100 + (n === 3 ? POINTS[r] - ((b & T) ? 8 : 0) : r);
      else if (partner) s = 50 + POINTS[r] - ((b & T) ? 20 : 0);   // give points to partner
      else s = -8 * POINTS[r] - r - ((b & T) ? 40 : 0);            // throw the cheapest
      let i = k++;
      while (i > 0 && o[i - 1] < s) { o[i] = o[i - 1]; m[i] = m[i - 1]; i--; }
      o[i] = s; m[i] = c;
    }
    return k;
  }

  // A cheap stand-in for a position the search does not open: everyone plays the first card
  // of `list` to the end.
  function playout(turn) {
    let rem = hands[0] | hands[1] | hands[2] | hands[3], got = 0;
    const undo = [];
    while (rem) {
      let led = -1, win = -1, winSeat = -1, pts = 0;
      for (let n = 0; n < 4; n++) {
        const seat = (turn + n) & 3, partner = n > 0 && ((winSeat ^ seat) & 1) === 0;
        list(32, legal(hands[seat], trump, n, led, win, partner), n, win, partner);
        const c = moves[32][0];
        hands[seat] ^= 1 << c; undo.push(seat, c); rem ^= 1 << c; pts += POINTS[c & 7];
        if (n === 0) { led = c >> 3; win = c; winSeat = seat; }
        else if (beats(c, win, trump)) { win = c; winSeat = seat; }
      }
      if ((winSeat & 1) === 0) got += pts;
      turn = winSeat;
    }
    for (let i = 0; i < undo.length; i += 2) hands[undo[i]] |= 1 << undo[i + 1];
    return got;
  }

  function search(ply, turn, n, led, win, winSeat, pts, alpha, beta) {
    nodes++;
    let key = 0, a0 = alpha, b0 = beta;
    if (n === 0) {
      const rem = hands[0] | hands[1] | hands[2] | hands[3];
      if (!rem) return 0;
      key = (rem >>> 0) * 4 + turn;
      const e = tt.get(key);
      if (e !== undefined) {
        const lo = e & 255, hi = e >> 8;
        if (lo >= beta) return lo;
        if (hi <= alpha) return hi;
        if (lo === hi) return lo;
        if (lo > alpha) alpha = lo;
        if (hi < beta) beta = hi;
        a0 = alpha; b0 = beta;
      } else if (stop && count(rem) <= stop) {
        const v = playout(turn);
        tt.set(key, v | (v << 8));
        return v;
      }
    }
    const partner = n > 0 && ((winSeat ^ turn) & 1) === 0;
    const k = list(ply, legal(hands[turn], trump, n, led, win, partner), n, win, partner);
    const m = moves[ply], max = (turn & 1) === 0;
    let best = max ? -1 : 999;
    for (let i = 0; i < k; i++) {
      const c = m[i], b = 1 << c;
      hands[turn] ^= b;
      let v;
      const w = n === 0 || beats(c, win, trump) ? c : win;
      const ws = w === c ? turn : winSeat;
      const p = pts + POINTS[c & 7];
      if (n === 3) {
        const gain = (ws & 1) === 0 ? p : 0;
        v = gain + search(ply + 1, ws, 0, -1, -1, -1, 0, alpha - gain, beta - gain);
      } else {
        v = search(ply + 1, (turn + 1) & 3, n + 1, n === 0 ? c >> 3 : led, w, ws, p, alpha, beta);
      }
      hands[turn] ^= b;
      if (max) { if (v > best) { best = v; if (v > alpha) alpha = v; } }
      else if (v < best) { best = v; if (v < beta) beta = v; }
      if (alpha >= beta) break;
    }
    if (n === 0) {
      const e = tt.get(key);
      let lo = e === undefined ? 0 : e & 255, hi = e === undefined ? 255 : e >> 8;
      if (best <= a0) hi = Math.min(hi, best);
      else if (best >= b0) lo = Math.max(lo, best);
      else lo = hi = best;
      tt.set(key, lo | (hi << 8));
    }
    return best;
  }

  return {
    // Start on a deal. With `stopCards` > 0 the search does not open a trick once that few
    // cards are left: such a position is valued by a playout instead.
    reset(theHands, theTrump, stopCards = 0) {
      hands.set(theHands); trump = theTrump; T = suitMask(trump); stop = stopCards;
      tt.clear(); nodes = 0;
    },
    // Card points team 0 takes from here on, the trick in progress included.
    //   turn: seat to play; n, led, win, winSeat, pts: the trick in progress (pts = points in it)
    value(turn, n, led, win, winSeat, pts) {
      return search(0, turn, n, led, win, winSeat, pts, 0, maskPoints(hands[0] | hands[1] | hands[2] | hands[3]) + pts);
    },
    // The same after the seat to play has put down `card`.
    after(card, turn, n, led, win, winSeat, pts) {
      const b = 1 << card;
      hands[turn] ^= b;
      const w = n === 0 || beats(card, win, trump) ? card : win, ws = w === card ? turn : winSeat;
      const p = pts + POINTS[card & 7];
      let v;
      if (n === 3) {
        const gain = (ws & 1) === 0 ? p : 0;
        v = gain + this.value(ws, 0, -1, -1, -1, 0);
      } else {
        v = this.value((turn + 1) & 3, n + 1, n === 0 ? card >> 3 : led, w, ws, p);
      }
      hands[turn] ^= b;
      return v;
    },
    // The first card of the search order: a rule-of-thumb player, used as a baseline.
    greedy(hand, theTrump, n, led, win, partner) {
      const t0 = trump, T0 = T;
      trump = theTrump; T = suitMask(trump);
      list(32, legal(hand, trump, n, led, win, partner), n, win, partner);
      trump = t0; T = T0;
      return moves[32][0];
    },
    get nodes() { return nodes; },
  };
}
