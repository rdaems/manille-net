//! What a seat can know about the hidden hands, and deals drawn from exactly that.
//!
//! The rules force a lot, so every card somebody played tells what that hand did not hold:
//! not following suit shows a void; staying under an opponent's card shows nothing higher;
//! throwing a plain card on an opponent's trick shows no (higher) trump. `know` turns the
//! public history into one mask per seat of cards that seat cannot have. `Sampler` draws the
//! unseen cards uniformly over every deal that fits those masks and the hand sizes.
use crate::rules::*;

pub struct Know {
    /// Cards the seat cannot hold now (the played cards included).
    pub cant: [u32; 4],
    pub played: u32,
    /// Cards the seat still holds.
    pub left: [u8; 4],
    // the trick in progress
    pub turn: u8,
    pub n: u8,
    pub led: u8,
    pub win: u8,
    pub win_seat: u8,
}

/// Replays the public history.
pub fn know(leader0: u8, trump: u8, plays: &[u8]) -> Know {
    let (mut cant, mut left) = ([0u32; 4], [8u8; 4]);
    let t = suit_mask(trump);
    let (mut played, mut leader, mut n, mut led, mut win, mut win_seat) = (0u32, leader0, 0u8, NONE, NONE, NONE);
    for &c in plays {
        let (seat, s) = ((leader + n) & 3, c >> 3);
        let me = seat as usize;
        if n == 0 {
            led = s;
            win = c;
            win_seat = seat;
        } else {
            let partner = (win_seat & 1) == (seat & 1);
            if s == led {
                // followed, but stayed under an opponent's card of the suit: nothing higher
                if !partner && (win >> 3) == led && c < win {
                    cant[me] |= higher(win);
                }
            } else {
                cant[me] |= suit_mask(led); // void in the suit led
                if t != 0 && led != trump {
                    let trumped = (win >> 3) == trump;
                    if s == trump {
                        // a trump under the trump that holds the trick: only such trumps were left
                        if trumped && c < win {
                            cant[me] |= higher(win) | !t;
                        }
                    } else if !partner {
                        cant[me] |= if trumped { higher(win) } else { t }; // could not (over)trump
                    }
                }
            }
            if beats(c, win, trump) {
                win = c;
                win_seat = seat;
            }
        }
        played |= bit(c);
        left[me] -= 1;
        n += 1;
        if n == 4 {
            leader = win_seat;
            n = 0;
            led = NONE;
            win = NONE;
            win_seat = NONE;
        }
    }
    for c in cant.iter_mut() {
        *c |= played;
    }
    Know { cant, played, left, turn: (leader + n) & 3, n, led, win, win_seat }
}

fn fact(n: usize) -> f64 {
    let mut f = 1.0;
    for i in 1..=n {
        f *= i as f64;
    }
    f
}
fn choose(n: usize, k: usize) -> f64 {
    fact(n) / (fact(k) * fact(n - k))
}

/// The three hidden hands as seat `me` sees them. Every unseen card has a type: the set of
/// other seats that may hold it. Cards of one type are interchangeable, so a deal is a table
/// (how many cards of each type go to each seat) and a shuffle inside each type. The tables
/// are few; they are listed once with the number of deals each stands for, and a draw picks a
/// table by that weight. Exact and uniform, with no rejection.
pub struct Sampler {
    me: usize,
    my_hand: u32,
    by_type: [Vec<u8>; 8],
    /// (weight, x, y, z, a, b): x cards of type AB to A, y of type AC to A, z of type BC to B,
    /// a and b cards of type ABC to A and B.
    tables: Vec<(f64, usize, usize, usize, usize, usize)>,
    /// How many deals fit what is known.
    pub deals: f64,
}

impl Sampler {
    pub fn new(me: u8, my_hand: u32, k: &Know) -> Option<Sampler> {
        let (a_, b_, c_) = (((me + 1) & 3) as usize, ((me + 2) & 3) as usize, ((me + 3) & 3) as usize);
        let mut by_type: [Vec<u8>; 8] = Default::default();
        let mut unseen = !k.played & !my_hand;
        while unseen != 0 {
            let c = unseen.trailing_zeros() as u8;
            unseen &= unseen - 1;
            let b = bit(c);
            let t = (k.cant[a_] & b == 0) as usize | ((k.cant[b_] & b == 0) as usize) << 1 | ((k.cant[c_] & b == 0) as usize) << 2;
            if t == 0 {
                return None;
            }
            by_type[t].push(c);
        }
        let n: [usize; 8] = core::array::from_fn(|t| by_type[t].len());
        let cap = |seat: usize, fixed: usize| (k.left[seat] as usize).checked_sub(fixed);
        let (cap_a, cap_b, cap_c) = (cap(a_, n[1])?, cap(b_, n[2])?, cap(c_, n[4])?);
        let (mut tables, mut total) = (Vec::new(), 0.0);
        for x in 0..=n[3] {
            for y in 0..=n[5] {
                if x + y > cap_a || cap_a - x - y > n[7] {
                    continue;
                }
                let a = cap_a - x - y;
                for z in 0..=n[6] {
                    let to_b = (n[3] - x) + z;
                    if to_b > cap_b || a + (cap_b - to_b) > n[7] {
                        continue;
                    }
                    let b = cap_b - to_b;
                    let c = n[7] - a - b;
                    if (n[5] - y) + (n[6] - z) + c != cap_c {
                        continue;
                    }
                    let w = choose(n[3], x) * choose(n[5], y) * choose(n[6], z) * fact(n[7]) / (fact(a) * fact(b) * fact(c));
                    total += w;
                    tables.push((w, x, y, z, a, b));
                }
            }
        }
        if tables.is_empty() {
            return None;
        }
        Some(Sampler { me: me as usize, my_hand, by_type, tables, deals: total })
    }

    pub fn draw(&mut self, rng: &mut Rng) -> [u32; 4] {
        let mut u = rng.next() * self.deals;
        let mut t = *self.tables.last().unwrap();
        for row in &self.tables {
            u -= row.0;
            if u < 0.0 {
                t = *row;
                break;
            }
        }
        let (_, x, y, z, a, b) = t;
        let (me, sa, sb, sc) = (self.me, (self.me + 1) & 3, (self.me + 2) & 3, (self.me + 3) & 3);
        let mut h = [0u32; 4];
        h[me] = self.my_hand;
        fn give(h: &mut [u32; 4], list: &[u8], seat: usize) {
            for &c in list {
                h[seat] |= bit(c);
            }
        }
        fn mix(list: &mut [u8], rng: &mut Rng) {
            for i in (1..list.len()).rev() {
                let j = rng.below(i + 1);
                list.swap(i, j);
            }
        }
        give(&mut h, &self.by_type[1], sa);
        give(&mut h, &self.by_type[2], sb);
        give(&mut h, &self.by_type[4], sc);
        let l = &mut self.by_type[3];
        mix(l, rng);
        give(&mut h, &l[..x], sa);
        give(&mut h, &l[x..], sb);
        let l = &mut self.by_type[5];
        mix(l, rng);
        give(&mut h, &l[..y], sa);
        give(&mut h, &l[y..], sc);
        let l = &mut self.by_type[6];
        mix(l, rng);
        give(&mut h, &l[..z], sb);
        give(&mut h, &l[z..], sc);
        let l = &mut self.by_type[7];
        mix(l, rng);
        give(&mut h, &l[..a], sa);
        give(&mut h, &l[a..a + b], sb);
        give(&mut h, &l[a + b..], sc);
        h
    }
}
