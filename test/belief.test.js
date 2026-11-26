import test from 'node:test';
import assert from 'node:assert/strict';
import { legal, beats, Deal, rng, cards, bit, count, teamOf, ALL } from '../site/js/manille.js';
import { know, sampler } from '../reference/belief.js';

// Would `hands` (as they are now) have been allowed to play this history?
function fits(hands, leader0, trump, plays) {
  const h = Int32Array.from(hands);
  let leader = leader0, n = 0;
  const seats = [];
  for (const c of plays) {
    seats.push((leader + n) & 3);
    if (++n === 4) {                                     // find the winner of the trick
      const t = plays.slice(seats.length - 4, seats.length);
      let win = t[0], ws = seats[seats.length - 4];
      for (let i = 1; i < 4; i++) if (beats(t[i], win, trump)) { win = t[i]; ws = seats[seats.length - 4 + i]; }
      leader = ws; n = 0;
    }
  }
  plays.forEach((c, i) => { h[seats[i]] |= bit(c); });   // the hands at the start
  leader = leader0; n = 0;
  let led = -1, win = -1, ws = -1;
  for (let i = 0; i < plays.length; i++) {
    const c = plays[i], seat = seats[i];
    const l = legal(h[seat], trump, n, led, win, n > 0 && teamOf(ws) === teamOf(seat));
    if (!(l & bit(c))) return false;
    h[seat] ^= bit(c);
    if (n === 0) { led = c >> 3; win = c; ws = seat; } else if (beats(c, win, trump)) { win = c; ws = seat; }
    if (++n === 4) n = 0;
  }
  return true;
}

function playSome(rand, nPlays) {
  const d = Deal.random(rand, Math.floor(rand() * 4));
  d.trump = Math.floor(rand() * 5);
  while (d.plays.length < nPlays) {
    const l = cards(d.legal());
    d.play(l[Math.floor(rand() * l.length)]);
  }
  return d;
}

test('the true hands never contradict what is known, at any point of any game', () => {
  const rand = rng(7);
  for (let g = 0; g < 300; g++) {
    const d = playSome(rand, 0);
    while (!d.done) {
      const l = cards(d.legal());
      d.play(l[Math.floor(rand() * l.length)]);
      const k = know(d.leader0, d.trump, d.plays);
      for (let p = 0; p < 4; p++) {
        assert.equal(k.cant[p] & d.hands[p], 0);
        assert.equal(k.left[p], count(d.hands[p]));
      }
      assert.equal(k.turn, d.turn);
      assert.equal(k.n, d.n);
      assert.equal(k.win, d.win);
    }
  }
});

test('sampled deals are complete and would have played the same history', () => {
  const rand = rng(11);
  for (let g = 0; g < 400; g++) {
    const d = playSome(rand, Math.floor(rand() * 31));
    const me = d.turn, k = know(d.leader0, d.trump, d.plays);
    const draw = sampler(me, d.hands[me], k);
    assert.ok(draw, 'the truth fits, so something fits');
    for (let i = 0; i < 20; i++) {
      const h = draw(rand);
      assert.equal(h[me], d.hands[me]);
      assert.equal((h[0] | h[1] | h[2] | h[3]) >>> 0, (ALL & ~k.played) >>> 0);
      for (let p = 0; p < 4; p++) assert.equal(count(h[p]), k.left[p]);
      assert.ok(fits(h, d.leader0, d.trump, d.plays));
    }
  }
});

// Late in a deal every split of the unseen cards can be listed. The splits that would have
// played the same history must be exactly the ones the masks allow, and the sampler must
// draw them equally often.
test('the masks say exactly what the history says, and the draw is uniform', () => {
  const rand = rng(23);
  let checked = 0;
  for (let g = 0; g < 250; g++) {
    const d = playSome(rand, 17 + Math.floor(rand() * 12));
    const me = d.turn, k = know(d.leader0, d.trump, d.plays);
    const unseen = cards(ALL & ~k.played & ~d.hands[me]);
    const others = [1, 2, 3].map(i => (me + i) & 3);
    const truth = new Set();
    const rec = (i, h) => {
      if (i === unseen.length) {
        if (others.every(p => count(h[p]) === k.left[p]) && fits(h, d.leader0, d.trump, d.plays)) truth.add(h.join());
        return;
      }
      for (const p of others) {
        if (count(h[p]) === k.left[p]) continue;
        h[p] |= bit(unseen[i]); rec(i + 1, h); h[p] ^= bit(unseen[i]);
      }
    };
    const h0 = [0, 0, 0, 0]; h0[me] = d.hands[me];
    rec(0, h0);
    const draw = sampler(me, d.hands[me], k);
    assert.equal(draw.deals, truth.size, 'number of deals that fit');
    if (truth.size > 1 && truth.size <= 40) {
      const seen = new Map(), N = 300 * truth.size;
      for (let i = 0; i < N; i++) {
        const key = Array.from(draw(rand)).join();
        assert.ok(truth.has(key));
        seen.set(key, (seen.get(key) || 0) + 1);
      }
      assert.equal(seen.size, truth.size);
      for (const v of seen.values()) assert.ok(Math.abs(v - 300) < 6 * Math.sqrt(300), `count ${v} of 300`);
      checked++;
    }
  }
  assert.ok(checked > 30);
});
