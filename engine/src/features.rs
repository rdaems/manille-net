//! What a player sees, as the numbers a network reads. One layout for the self-play records,
//! the trainer (train/) and the inference here: twelve 32-bit card sets, then four small
//! one-hot groups.
//!
//! ```text
//! word 0      my hand
//! word 1..4   the cards played so far by me, my left, my partner, my right
//! word 5..7   the card my left, my partner, my right has in the trick in progress
//! word 8..10  the cards my left, my partner, my right can still hold (as the forced plays tell)
//! word 11     the cards I may play now
//! then        trump (5: four suits, none), where the dealer sits (4: me, left, partner, right),
//!             who holds the trick (4: nobody, left, partner, right), cards in the trick (4)
//! ```
use crate::belief::Know;
use crate::rules::*;

pub const WORDS: usize = 12;
pub const INPUTS: usize = 32 * WORDS + 5 + 4 + 4 + 4;

#[derive(Clone, Copy)]
pub struct Features {
    pub words: [u32; WORDS],
    pub trump: u8,
    pub dealer_rel: u8,
    pub win_rel: u8,
    pub n: u8,
}

/// The features of `seat` holding `hand`, to move, with `k` = know(...) of the history so far.
pub fn features(seat: u8, hand: u32, dealer: u8, trump: u8, k: &Know) -> Features {
    let rel = |r: u8| ((seat + r) & 3) as usize;
    let on = |r: u8| if k.on_table[rel(r)] == NONE { 0 } else { bit(k.on_table[rel(r)]) };
    let can = |r: u8| !k.cant[rel(r)] & !hand;
    let partner = k.n > 0 && (k.win_seat & 1) == (seat & 1);
    Features {
        words: [
            hand, k.by[rel(0)], k.by[rel(1)], k.by[rel(2)], k.by[rel(3)], on(1), on(2), on(3), can(1), can(2), can(3),
            legal(hand, trump, k.n, k.led, k.win, partner),
        ],
        trump,
        dealer_rel: dealer.wrapping_sub(seat) & 3,
        win_rel: if k.n == 0 { 0 } else { k.win_seat.wrapping_sub(seat) & 3 },
        n: k.n,
    }
}

impl Features {
    /// The indices of the inputs that are 1 (all others are 0).
    pub fn active(&self, mut f: impl FnMut(usize)) {
        for (w, &word) in self.words.iter().enumerate() {
            let mut m = word;
            while m != 0 {
                f(32 * w + m.trailing_zeros() as usize);
                m &= m - 1;
            }
        }
        let base = 32 * WORDS;
        f(base + self.trump as usize);
        f(base + 5 + self.dealer_rel as usize);
        f(base + 9 + self.win_rel as usize);
        f(base + 13 + self.n as usize);
    }
}
