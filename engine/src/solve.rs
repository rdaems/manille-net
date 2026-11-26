//! Open-card solver: with all four hands known, the card points team 0 still takes when both
//! teams play perfectly. Alpha-beta over the cards, with a table of positions at the trick
//! boundaries. For one deal the cards that are left and the seat to lead fix such a position,
//! so the key is that mask and that seat; the table is only valid for the deal it was built on.
use crate::rules::*;

const BITS: u32 = 17;
const SLOTS: usize = 1 << BITS;
const PROBE: usize = 4;

#[derive(Clone, Copy, Default)]
struct Entry {
    rem: u32,
    /// epoch << 18 | seat << 16 | upper bound << 8 | lower bound
    meta: u32,
}

pub struct Solver {
    hands: [u32; 4],
    trump: u8,
    t: u32,
    /// With `stop` > 0 the search does not open a trick once that few cards are left: such a
    /// position is valued by a playout instead.
    stop: u32,
    table: Box<[Entry]>,
    epoch: u32,
    moves: [[u8; 8]; 33],
    pub nodes: u64,
}

impl Default for Solver {
    fn default() -> Self {
        Self::new()
    }
}

impl Solver {
    pub fn new() -> Self {
        Solver {
            hands: [0; 4], trump: NOTRUMP, t: 0, stop: 0,
            table: vec![Entry::default(); SLOTS].into_boxed_slice(), epoch: 0, moves: [[0; 8]; 33], nodes: 0,
        }
    }

    /// Start on a deal.
    pub fn reset(&mut self, hands: &[u32; 4], trump: u8, stop: u32) {
        self.hands = *hands;
        self.trump = trump;
        self.t = suit_mask(trump);
        self.stop = stop;
        self.epoch += 1;
        if self.epoch >= 1 << 14 {
            self.table.fill(Entry::default());
            self.epoch = 1;
        }
    }

    #[inline]
    fn slot(rem: u32, turn: u8) -> usize {
        ((rem ^ (turn as u32).wrapping_mul(0x85eb_ca6b)).wrapping_mul(0x9e37_79b1) >> (32 - BITS)) as usize
    }
    #[inline]
    fn probe(&self, rem: u32, turn: u8) -> Option<(i32, i32)> {
        let tag = self.epoch << 2 | turn as u32;
        let s = Self::slot(rem, turn);
        for i in 0..PROBE {
            let e = self.table[(s + i) & (SLOTS - 1)];
            if e.meta >> 16 == tag && e.rem == rem {
                return Some(((e.meta & 255) as i32, (e.meta >> 8 & 255) as i32));
            }
        }
        None
    }
    #[inline]
    fn store(&mut self, rem: u32, turn: u8, lo: i32, hi: i32) {
        let tag = self.epoch << 2 | turn as u32;
        let s = Self::slot(rem, turn);
        let mut at = s;
        for i in 0..PROBE {
            let j = (s + i) & (SLOTS - 1);
            let e = self.table[j];
            if e.meta >> 18 != self.epoch || (e.meta >> 16 == tag && e.rem == rem) {
                at = j;
                break;
            }
        }
        self.table[at] = Entry { rem, meta: tag << 16 | (hi as u32) << 8 | lo as u32 };
    }

    /// Sorts the legal cards of the seat to play, most promising first, into moves[ply].
    #[inline]
    fn list(&mut self, ply: usize, mut mask: u32, n: u8, win: u8, partner: bool) -> usize {
        let mut score = [0i32; 8];
        let m = &mut self.moves[ply];
        let mut k = 0;
        while mask != 0 {
            let c = mask.trailing_zeros() as u8;
            mask &= mask - 1;
            let r = (c & 7) as i32;
            let tr = bit(c) & self.t != 0;
            let s = if n == 0 {
                r + if tr { -4 } else { 0 } // lead high, keep trumps
            } else if beats(c, win, self.trump) {
                100 + if n == 3 { POINTS[r as usize] - if tr { 8 } else { 0 } } else { r }
            } else if partner {
                50 + POINTS[r as usize] - if tr { 20 } else { 0 } // give points to partner
            } else {
                -8 * POINTS[r as usize] - r - if tr { 40 } else { 0 } // throw the cheapest
            };
            let mut i = k;
            k += 1;
            while i > 0 && score[i - 1] < s {
                score[i] = score[i - 1];
                m[i] = m[i - 1];
                i -= 1;
            }
            score[i] = s;
            m[i] = c;
        }
        k
    }

    /// A cheap stand-in for a position the search does not open: everyone plays the first card
    /// of `list` to the end.
    fn playout(&mut self, mut turn: u8) -> i32 {
        let saved = self.hands;
        let mut got = 0;
        while self.hands.iter().any(|&h| h != 0) {
            let (mut led, mut win, mut win_seat, mut pts) = (NONE, NONE, NONE, 0);
            for n in 0..4u8 {
                let seat = (turn + n) & 3;
                let partner = n > 0 && (win_seat ^ seat) & 1 == 0;
                let l = legal(self.hands[seat as usize], self.trump, n, led, win, partner);
                self.list(32, l, n, win, partner);
                let c = self.moves[32][0];
                self.hands[seat as usize] ^= bit(c);
                pts += points_of(c);
                if n == 0 {
                    led = c >> 3;
                    win = c;
                    win_seat = seat;
                } else if beats(c, win, self.trump) {
                    win = c;
                    win_seat = seat;
                }
            }
            if win_seat & 1 == 0 {
                got += pts;
            }
            turn = win_seat;
        }
        self.hands = saved;
        got
    }

    #[allow(clippy::too_many_arguments)]
    fn search(&mut self, ply: usize, turn: u8, n: u8, led: u8, win: u8, win_seat: u8, pts: i32, mut alpha: i32, mut beta: i32) -> i32 {
        self.nodes += 1;
        let (mut a0, mut b0, mut rem) = (alpha, beta, 0);
        if n == 0 {
            rem = self.hands[0] | self.hands[1] | self.hands[2] | self.hands[3];
            if rem == 0 {
                return 0;
            }
            if let Some((lo, hi)) = self.probe(rem, turn) {
                if lo >= beta {
                    return lo;
                }
                if hi <= alpha {
                    return hi;
                }
                if lo == hi {
                    return lo;
                }
                alpha = alpha.max(lo);
                beta = beta.min(hi);
                a0 = alpha;
                b0 = beta;
            } else if self.stop != 0 && rem.count_ones() <= self.stop {
                let v = self.playout(turn);
                self.store(rem, turn, v, v);
                return v;
            }
        }
        let partner = n > 0 && (win_seat ^ turn) & 1 == 0;
        let k = self.list(ply, legal(self.hands[turn as usize], self.trump, n, led, win, partner), n, win, partner);
        let max = turn & 1 == 0;
        let mut best = if max { -1 } else { 999 };
        for i in 0..k {
            let c = self.moves[ply][i];
            self.hands[turn as usize] ^= bit(c);
            let takes = n == 0 || beats(c, win, self.trump);
            let (w, ws) = if takes { (c, turn) } else { (win, win_seat) };
            let p = pts + points_of(c);
            let v = if n == 3 {
                let gain = if ws & 1 == 0 { p } else { 0 };
                gain + self.search(ply + 1, ws, 0, NONE, NONE, NONE, 0, alpha - gain, beta - gain)
            } else {
                self.search(ply + 1, (turn + 1) & 3, n + 1, if n == 0 { c >> 3 } else { led }, w, ws, p, alpha, beta)
            };
            self.hands[turn as usize] ^= bit(c);
            if max {
                if v > best {
                    best = v;
                    alpha = alpha.max(v);
                }
            } else if v < best {
                best = v;
                beta = beta.min(v);
            }
            if alpha >= beta {
                break;
            }
        }
        if n == 0 {
            let (mut lo, mut hi) = self.probe(rem, turn).unwrap_or((0, 255));
            if best <= a0 {
                hi = hi.min(best);
            } else if best >= b0 {
                lo = lo.max(best);
            } else {
                lo = best;
                hi = best;
            }
            self.store(rem, turn, lo, hi);
        }
        best
    }

    /// Card points team 0 takes from here on, the trick in progress included.
    /// `turn`: seat to play; `n, led, win, win_seat, pts`: the trick in progress.
    pub fn value(&mut self, turn: u8, n: u8, led: u8, win: u8, win_seat: u8, pts: i32) -> i32 {
        let all = self.hands[0] | self.hands[1] | self.hands[2] | self.hands[3];
        self.search(0, turn, n, led, win, win_seat, pts, 0, mask_points(all) + pts)
    }

    /// The same after the seat to play has put down `card`.
    #[allow(clippy::too_many_arguments)]
    pub fn after(&mut self, card: u8, turn: u8, n: u8, led: u8, win: u8, win_seat: u8, pts: i32) -> i32 {
        self.hands[turn as usize] ^= bit(card);
        let takes = n == 0 || beats(card, win, self.trump);
        let (w, ws) = if takes { (card, turn) } else { (win, win_seat) };
        let p = pts + points_of(card);
        let v = if n == 3 {
            let gain = if ws & 1 == 0 { p } else { 0 };
            gain + self.value(ws, 0, NONE, NONE, NONE, 0)
        } else {
            self.value((turn + 1) & 3, n + 1, if n == 0 { card >> 3 } else { led }, w, ws, p)
        };
        self.hands[turn as usize] ^= bit(card);
        v
    }

    /// The first card of the search order: a rule-of-thumb player, used as a baseline.
    pub fn greedy(&mut self, hand: u32, trump: u8, n: u8, led: u8, win: u8, partner: bool) -> u8 {
        let (t0, tm0) = (self.trump, self.t);
        self.trump = trump;
        self.t = suit_mask(trump);
        self.list(32, legal(hand, trump, n, led, win, partner), n, win, partner);
        self.trump = t0;
        self.t = tm0;
        self.moves[32][0]
    }
}
