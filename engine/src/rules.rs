//! The cards, what may be played, who takes a trick, the score. Rules and sources: RULES.md.
//!
//! A card is `8 * suit + rank`; the rank is the strength inside the suit:
//! ```text
//! rank   0  1  2  3  4  5  6  7
//! card   7  8  9  V  D  R  A  10
//! points 0  0  0  1  2  3  4  5      60 in the pack
//! ```
//! A hand is a 32-bit mask. Seats run clockwise 0 1 2 3; seats 0 and 2 are team 0.

pub const POINTS: [i32; 8] = [0, 0, 0, 1, 2, 3, 4, 5];
pub const NOTRUMP: u8 = 4;
/// "No card" / "no suit" / "no seat".
pub const NONE: u8 = 255;
pub const SUITS: [&str; 4] = ["♠", "♥", "♣", "♦"];
pub const RANKS: [&str; 8] = ["7", "8", "9", "V", "D", "R", "A", "10"];

#[inline(always)]
pub fn bit(c: u8) -> u32 {
    1u32 << c
}
#[inline(always)]
pub fn suit_mask(s: u8) -> u32 {
    if s > 3 { 0 } else { 0xffu32 << (8 * s as u32) }
}
/// The cards of c's suit that beat c.
#[inline(always)]
pub fn higher(c: u8) -> u32 {
    suit_mask(c >> 3) & (0xffff_fffeu32 << c)
}
#[inline(always)]
pub fn points_of(c: u8) -> i32 {
    POINTS[(c & 7) as usize]
}
pub fn mask_points(mut m: u32) -> i32 {
    let mut p = 0;
    while m != 0 {
        p += POINTS[(m.trailing_zeros() & 7) as usize];
        m &= m - 1;
    }
    p
}
pub fn card_name(c: u8) -> String {
    format!("{}{}", SUITS[(c >> 3) as usize], RANKS[(c & 7) as usize])
}

/// Does `card` take the trick from `win`, the card that holds it now? `win` is always of the
/// suit led or a trump, so a card of another plain suit never does.
#[inline(always)]
pub fn beats(card: u8, win: u8, trump: u8) -> bool {
    let (s, w) = (card >> 3, win >> 3);
    if s == w { card > win } else { s == trump }
}

/// The cards of `hand` that may be played. `n` cards are in the trick already, `led` is the
/// suit of the first, `win` the card that holds the trick, `partner` whether it is your
/// partner's. The five rules of RULES.md.
#[inline]
pub fn legal(hand: u32, trump: u8, n: u8, led: u8, win: u8, partner: bool) -> u32 {
    if n == 0 {
        return hand;
    }
    let follow = hand & suit_mask(led);
    if follow != 0 {
        if !partner && (win >> 3) == led {
            let over = follow & higher(win);
            if over != 0 {
                return over;
            }
        }
        return follow;
    }
    let trumps = hand & suit_mask(trump);
    if trumps == 0 {
        return hand;
    }
    if (win >> 3) == trump {
        // the trick has been trumped
        let (over, plain) = (trumps & higher(win), hand & !trumps);
        if partner {
            return if over | plain != 0 { over | plain } else { hand };
        }
        return if over != 0 { over } else if plain != 0 { plain } else { hand };
    }
    if partner { hand } else { trumps }
}

/// The score of one deal: (team, score); team -1 at 30-30. The team above 30 scores what it
/// has above 30, all eight tricks count 60, times the multiplier.
pub fn deal_score(points0: i32, tricks0: i32, mult: i32) -> (i32, i32) {
    if points0 == 30 {
        return (-1, 0);
    }
    let team = if points0 > 30 { 0 } else { 1 };
    let sweep = tricks0 == if team == 0 { 8 } else { 0 };
    let base = if sweep { 60 } else { (if team == 0 { points0 } else { 60 - points0 }) - 30 };
    (team, base * mult)
}

/// mulberry32, bit for bit the generator of the JavaScript version (so a seed gives the same
/// deal and the same drawn hands in both).
pub struct Rng(u32);
impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng(seed)
    }
    #[inline]
    pub fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
    #[inline]
    pub fn below(&mut self, n: usize) -> usize {
        (self.next() * n as f64) as usize
    }
}

/// What one seat may know when it has to decide: its own hand and the public history.
#[derive(Clone, Copy)]
pub struct View<'a> {
    pub seat: u8,
    pub hand: u32,
    pub dealer: u8,
    pub trump: u8,
    pub leader0: u8,
    pub plays: &'a [u8],
}

/// One deal being played.
#[derive(Clone)]
pub struct Deal {
    pub hands: [u32; 4],
    pub dealer: u8,
    pub trump: u8,
    pub leader0: u8,
    pub plays: Vec<u8>,
    pub points: [i32; 2],
    pub tricks: [i32; 2],
    pub turn: u8,
    pub n: u8,
    pub led: u8,
    pub win: u8,
    pub win_seat: u8,
    pub trick_pts: i32,
}

impl Deal {
    pub fn new(hands: [u32; 4], dealer: u8, trump: u8) -> Self {
        let leader0 = (dealer + 1) & 3; // left of the dealer leads
        Deal {
            hands, dealer, trump, leader0, plays: Vec::with_capacity(32), points: [0; 2], tricks: [0; 2],
            turn: leader0, n: 0, led: NONE, win: NONE, win_seat: NONE, trick_pts: 0,
        }
    }
    /// Shuffle and deal, eight cards each; trump is set after the dealer looked.
    pub fn random(rng: &mut Rng, dealer: u8) -> Self {
        let mut d: [u8; 32] = core::array::from_fn(|i| i as u8);
        for i in (1..32).rev() {
            let j = rng.below(i + 1);
            d.swap(i, j);
        }
        let mut hands = [0u32; 4];
        for (i, &c) in d.iter().enumerate() {
            hands[i >> 3] |= bit(c);
        }
        Deal::new(hands, dealer, NOTRUMP)
    }
    pub fn done(&self) -> bool {
        self.plays.len() == 32
    }
    pub fn legal(&self) -> u32 {
        let partner = self.n > 0 && (self.win_seat & 1) == (self.turn & 1);
        legal(self.hands[self.turn as usize], self.trump, self.n, self.led, self.win, partner)
    }
    pub fn view(&self, seat: u8) -> View<'_> {
        View { seat, hand: self.hands[seat as usize], dealer: self.dealer, trump: self.trump, leader0: self.leader0, plays: &self.plays }
    }
    /// Play `card` for the seat whose turn it is.
    pub fn play(&mut self, card: u8) {
        let seat = self.turn;
        assert!(self.legal() & bit(card) != 0, "{} is not allowed for seat {}", card_name(card), seat);
        self.hands[seat as usize] ^= bit(card);
        self.plays.push(card);
        self.trick_pts += points_of(card);
        if self.n == 0 {
            self.led = card >> 3;
            self.win = card;
            self.win_seat = seat;
        } else if beats(card, self.win, self.trump) {
            self.win = card;
            self.win_seat = seat;
        }
        self.n += 1;
        if self.n < 4 {
            self.turn = (seat + 1) & 3;
            return;
        }
        let team = (self.win_seat & 1) as usize;
        self.points[team] += self.trick_pts;
        self.tricks[team] += 1;
        self.turn = self.win_seat;
        self.n = 0;
        self.led = NONE;
        self.win = NONE;
        self.win_seat = NONE;
        self.trick_pts = 0;
    }
}
