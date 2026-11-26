// Manillen (West Flemish rules): the cards, what may be played, who takes a trick, the score.
// Shared by the page, the AI and the experiments. Rules and their sources: ../../RULES.md.
//
// A card is an integer c = 8 * suit + rank. The rank is the strength inside the suit:
//   rank   0  1  2  3  4  5  6  7
//   card   7  8  9  V  D  R  A  10      (valet, dame, roi: the French letters; 10 = the manille)
//   points 0  0  0  1  2  3  4  5       60 in the pack
// A hand is a 32-bit mask of cards. Seats run clockwise 0 1 2 3; seats 0 and 2 are team 0.

export const SUITS = ['♠', '♥', '♣', '♦'];
export const RANKS = ['7', '8', '9', 'V', 'D', 'R', 'A', '10'];
export const POINTS = [0, 0, 0, 1, 2, 3, 4, 5];
export const NOTRUMP = 4;
export const ALL = -1;                                   // all 32 cards

export const suitOf = c => c >> 3;
export const rankOf = c => c & 7;
export const pointsOf = c => POINTS[c & 7];
export const bit = c => 1 << c;
export const suitMask = s => (s > 3 ? 0 : 0xff << (8 * s));
export const higher = c => suitMask(c >> 3) & (-2 << c); // cards of c's suit that beat c
export const cardName = c => SUITS[c >> 3] + RANKS[c & 7];
export const teamOf = seat => seat & 1;

export function count(mask) {
  mask -= (mask >>> 1) & 0x55555555;
  mask = (mask & 0x33333333) + ((mask >>> 2) & 0x33333333);
  return (((mask + (mask >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function cards(mask) {
  const out = [];
  while (mask) { const b = mask & -mask; out.push(31 - Math.clz32(b)); mask ^= b; }
  return out;
}

export function maskPoints(mask) {
  let p = 0;
  while (mask) { const b = mask & -mask; p += POINTS[(31 - Math.clz32(b)) & 7]; mask ^= b; }
  return p;
}

// Does `card` take the trick from `win`, the card that holds it now? `win` is always of the
// suit led or a trump, so a card of another plain suit never does.
export function beats(card, win, trump) {
  const s = card >> 3, w = win >> 3;
  if (s === w) return card > win;
  return s === trump;
}

// The cards of `hand` that may be played.
//   n       cards already in the trick (0 = you lead: anything)
//   led     suit of the first card
//   win     the card that holds the trick
//   partner true when that card is your partner's
// 1. Follow suit. When an opponent holds the trick with a card of that suit, go over it if
//    you can.
// 2. No card of the suit: when an opponent holds the trick you must trump, and overtrump a
//    trump. A trump below the one that holds the trick is never allowed, unless the hand has
//    nothing else. When your partner holds the trick you are free (but still may not
//    undertrump).
export function legal(hand, trump, n, led, win, partner) {
  if (n === 0) return hand;
  const follow = hand & suitMask(led);
  if (follow) {
    if (!partner && (win >> 3) === led) {
      const over = follow & higher(win);
      if (over) return over;
    }
    return follow;
  }
  const trumps = hand & suitMask(trump);
  if (!trumps) return hand;
  if ((win >> 3) === trump) {                            // the trick has been trumped
    const over = trumps & higher(win), plain = hand & ~trumps;
    if (partner) return (over | plain) || hand;
    return over || plain || hand;
  }
  return partner ? hand : trumps;
}

// The score of one deal. points0 = card points of team 0 (team 1 has 60 - points0),
// tricks0 = tricks of team 0, mult = the multiplier of the deal.
// The team above 30 scores what it has above 30; all eight tricks count 60; 30-30 scores
// nothing (and doubles the next deal, which the caller keeps track of).
export function dealScore(points0, tricks0, mult) {
  if (points0 === 30) return { team: -1, score: 0 };
  const team = points0 > 30 ? 0 : 1;
  const sweep = tricks0 === (team === 0 ? 8 : 0);
  const base = sweep ? 60 : (team === 0 ? points0 : 60 - points0) - 30;
  return { team, score: base * mult };
}

// A small seedable generator (mulberry32), so games and experiments can be repeated.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffledDeck(rand) {
  const d = Array.from({ length: 32 }, (_, i) => i);
  for (let i = 31; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// One deal being played. `plays` (the cards in the order they fell) together with `leader0`
// is the whole public history; everything else here is derived from it.
export class Deal {
  constructor(hands, dealer, trump) {
    this.hands = Int32Array.from(hands);
    this.dealer = dealer;
    this.trump = trump;
    this.leader0 = (dealer + 1) & 3;                     // left of the dealer leads
    this.plays = [];
    this.points = [0, 0];
    this.tricks = [0, 0];
    this.last = null;                                    // the last finished trick
    this._open(this.leader0);
  }

  static random(rand, dealer) {
    const d = shuffledDeck(rand), hands = [0, 0, 0, 0];
    d.forEach((c, i) => { hands[i >> 3] |= bit(c); });
    return new Deal(hands, dealer, NOTRUMP);             // trump is set after the dealer looked
  }

  _open(leader) {
    this.leader = leader; this.turn = leader; this.n = 0;
    this.led = -1; this.win = -1; this.winSeat = -1; this.trickPts = 0; this.trick = [];
  }

  get done() { return this.plays.length === 32; }

  legal(seat = this.turn) {
    return legal(this.hands[seat], this.trump, this.n, this.led, this.win,
      this.n > 0 && teamOf(this.winSeat) === teamOf(seat));
  }

  // Play `card` for the seat whose turn it is. Returns the finished trick, or null.
  play(card) {
    const seat = this.turn;
    if (!(this.legal(seat) & bit(card))) throw new Error(`${cardName(card)} is not allowed for seat ${seat}`);
    this.hands[seat] ^= bit(card);
    this.plays.push(card);
    this.trick.push({ seat, card });
    this.trickPts += pointsOf(card);
    if (this.n === 0) { this.led = card >> 3; this.win = card; this.winSeat = seat; }
    else if (beats(card, this.win, this.trump)) { this.win = card; this.winSeat = seat; }
    this.n++;
    if (this.n < 4) { this.turn = (seat + 1) & 3; return null; }
    const done = { cards: this.trick, winner: this.winSeat, points: this.trickPts };
    this.points[teamOf(this.winSeat)] += this.trickPts;
    this.tricks[teamOf(this.winSeat)]++;
    this.last = done;
    this._open(this.winSeat);
    return done;
  }
}
