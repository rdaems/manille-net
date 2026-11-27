import test from 'node:test';
import assert from 'node:assert/strict';
import { legal, beats, dealScore, Deal, rng, cards, bit, count, higher, suitMask, NOTRUMP, RANKS, SUITS } from '../site/js/manille.js';

// "♠10 ♥J" -> mask
const C = s => SUITS.indexOf(s[0]) * 8 + RANKS.indexOf(s.slice(1));
const H = s => s.trim().split(/\s+/).reduce((m, x) => m | bit(C(x)), 0);
const names = m => cards(m).map(c => SUITS[c >> 3] + RANKS[c & 7]).join(' ');
const S = 0, He = 1;
const ok = (hand, trump, n, led, win, partner, want) =>
  assert.equal(names(legal(H(hand), trump, n, led, C(win), partner)), names(H(want)));

test('ranking: 10 over ace over king', () => {
  assert.ok(beats(C('♠10'), C('♠A'), He));
  assert.ok(beats(C('♠A'), C('♠K'), He));
  assert.ok(!beats(C('♠9'), C('♠J'), He));
  assert.ok(beats(C('♥7'), C('♠10'), He), 'a trump takes a plain card');
  assert.ok(!beats(C('♣10'), C('♠7'), He), 'another plain suit never takes');
  assert.equal(names(higher(C('♦K'))), '♦A ♦10');
  assert.equal(names(higher(C('♦10'))), '');
});

test('leading: anything', () => {
  assert.equal(count(legal(H('♠7 ♥8 ♣9'), He, 0, -1, -1, false)), 3);
});

test('following: over an opponent if possible, free under the partner', () => {
  ok('♠7 ♠K ♠10 ♥8', He, 1, S, '♠Q', false, '♠K ♠10');
  ok('♠7 ♠J ♥8', He, 1, S, '♠Q', false, '♠7 ♠J');
  ok('♠7 ♠K ♠10 ♥8', He, 2, S, '♠Q', true, '♠7 ♠K ♠10');
});

test('following a plain suit that an opponent trumped: any card of the suit', () => {
  ok('♠7 ♠10 ♥A', He, 2, S, '♥8', false, '♠7 ♠10');
});

test('trumps led: over an opponent if possible', () => {
  ok('♥7 ♥A ♠10', He, 1, He, '♥K', false, '♥A');
  ok('♥7 ♥J ♠10', He, 1, He, '♥K', false, '♥7 ♥J');
});

test('void, opponent holds the trick: must trump', () => {
  ok('♥7 ♥A ♣10 ♦8', He, 1, S, '♠Q', false, '♥7 ♥A');
  ok('♣10 ♦8', He, 1, S, '♠Q', false, '♣10 ♦8');
});

test('void, opponent trumped: overtrump, else throw a plain card, never undertrump', () => {
  ok('♥7 ♥A ♣10 ♦8', He, 2, S, '♥K', false, '♥A');
  ok('♥7 ♥J ♣10 ♦8', He, 2, S, '♥K', false, '♣10 ♦8');
  ok('♥7 ♥J', He, 2, S, '♥K', false, '♥7 ♥J');
});

test('void, partner holds the trick: free, but no undertrump', () => {
  ok('♥7 ♥A ♣10 ♦8', He, 2, S, '♠Q', true, '♥7 ♥A ♣10 ♦8');
  ok('♥7 ♥A ♣10 ♦8', He, 3, S, '♥K', true, '♥A ♣10 ♦8');
  ok('♥7 ♥J', He, 3, S, '♥K', true, '♥7 ♥J');
});

test('no trump: follow and go over, otherwise free', () => {
  ok('♠7 ♠10 ♥A', NOTRUMP, 1, S, '♠A', false, '♠10');
  ok('♥7 ♣A', NOTRUMP, 1, S, '♠A', false, '♥7 ♣A');
});

test('score of a deal', () => {
  assert.deepEqual(dealScore(36, 5, 1), { team: 0, score: 6 });
  assert.deepEqual(dealScore(23, 3, 2), { team: 1, score: 14 });
  assert.deepEqual(dealScore(30, 4, 4), { team: -1, score: 0 });
  assert.deepEqual(dealScore(60, 8, 1), { team: 0, score: 60 });
  assert.deepEqual(dealScore(0, 0, 2), { team: 1, score: 120 });
  assert.deepEqual(dealScore(60, 7, 1), { team: 0, score: 30 }, 'all points but not all tricks');
});

test('random deals play out: 32 cards, 60 points, 8 tricks', () => {
  const rand = rng(1);
  for (let g = 0; g < 500; g++) {
    const d = Deal.random(rand, g & 3);
    d.trump = Math.floor(rand() * 5);
    assert.equal(d.turn, (d.dealer + 1) & 3);
    while (!d.done) {
      const l = cards(d.legal());
      assert.ok(l.length > 0);
      d.play(l[Math.floor(rand() * l.length)]);
    }
    assert.equal(d.points[0] + d.points[1], 60);
    assert.equal(d.tricks[0] + d.tricks[1], 8);
    assert.equal(d.hands.reduce((a, b) => a | b, 0), 0);
  }
});
