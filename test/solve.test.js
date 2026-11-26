import test from 'node:test';
import assert from 'node:assert/strict';
import { legal, beats, Deal, rng, cards, bit, pointsOf, teamOf } from '../site/js/manille.js';
import { makeSolver } from '../site/js/solve.js';

// Plain minimax without any shortcut, on a copy of the deal.
function brute(hands, trump, turn, n, led, win, ws, pts) {
  if (n === 0 && !(hands[0] | hands[1] | hands[2] | hands[3])) return 0;
  const l = cards(legal(hands[turn], trump, n, led, win, n > 0 && teamOf(ws) === teamOf(turn)));
  let best = teamOf(turn) === 0 ? -1 : 999;
  for (const c of l) {
    hands[turn] ^= bit(c);
    const w = n === 0 || beats(c, win, trump) ? c : win, s = w === c ? turn : ws, p = pts + pointsOf(c);
    let v;
    if (n === 3) v = (teamOf(s) === 0 ? p : 0) + brute(hands, trump, s, 0, -1, -1, -1, 0);
    else v = brute(hands, trump, (turn + 1) & 3, n + 1, n === 0 ? c >> 3 : led, w, s, p);
    hands[turn] ^= bit(c);
    best = teamOf(turn) === 0 ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

test('the solver agrees with plain minimax on endgames, mid-trick too', () => {
  const rand = rng(5), solver = makeSolver();
  for (let g = 0; g < 400; g++) {
    const d = Deal.random(rand, g & 3);
    d.trump = Math.floor(rand() * 5);
    const stopAt = 18 + Math.floor(rand() * 13);         // 2 to 14 cards left
    while (d.plays.length < stopAt) {
      const l = cards(d.legal());
      d.play(l[Math.floor(rand() * l.length)]);
    }
    const want = brute(Int32Array.from(d.hands), d.trump, d.turn, d.n, d.led, d.win, d.winSeat, d.trickPts);
    solver.reset(d.hands, d.trump);
    assert.equal(solver.value(d.turn, d.n, d.led, d.win, d.winSeat, d.trickPts), want);
    // and per card: the best card reaches the value
    const vals = cards(d.legal()).map(c => solver.after(c, d.turn, d.n, d.led, d.win, d.winSeat, d.trickPts));
    assert.equal(teamOf(d.turn) === 0 ? Math.max(...vals) : Math.min(...vals), want);
  }
});
