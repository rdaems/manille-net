//! The players. Each decision gets a `View`: what one seat may know, never the other hands.
//!
//! `search` draws deals that fit everything the seat knows (belief), solves each of them with
//! open cards (solve), and plays the card that is best on average. The same draw-and-solve
//! answers the dealer's question (which trump?) and the doubling questions.
use crate::belief::{know, Know, Sampler};
use crate::features::features;
use crate::net::Nets;
use crate::rules::*;
use crate::solve::Solver;

#[derive(Clone, Copy)]
pub struct Opts {
    /// Deals to draw per decision.
    pub worlds: u32,
    /// Forget what the forced plays revealed, keep only which cards fell (for comparison).
    pub blind: bool,
    /// The solver's `stop` for the trump and doubling questions.
    pub stop: u32,
    /// The solver's `stop` for the opening lead.
    pub stop_lead: u32,
    /// Weigh every drawn deal by how likely the trump named and the cards played so far are
    /// under it, according to the networks, to this power (0 = all deals count the same).
    pub belief: f32,
    /// With `belief`: draw this many times `worlds` deals and solve only `worlds` of them,
    /// picked by weight.
    pub oversample: u32,
    /// Which of the engine's sets of networks this player uses (`Ai::nets`).
    pub nets: usize,
}
impl Opts {
    /// As the JavaScript version played: the opening lead and the contracts are not solved
    /// to the end but valued by a playout from 16 cards on.
    pub fn js(worlds: u32) -> Self {
        Opts { worlds, blind: false, stop: 16, stop_lead: 16, belief: 0.0, oversample: 1, nets: 0 }
    }
    /// Everything solved to the last card.
    pub fn exact(worlds: u32) -> Self {
        Opts { worlds, blind: false, stop: 0, stop_lead: 0, belief: 0.0, oversample: 1, nets: 0 }
    }
}

/// A rule of thumb for a hand with suit s as trump: two per trump, half a point per card point.
pub fn suit_strength(hand: u32, s: u8) -> f64 {
    let m = hand & suit_mask(s);
    2.0 * m.count_ones() as f64 + 0.5 * mask_points(m) as f64
}
pub fn thumb_trump(hand: u32) -> u8 {
    let mut best = 0;
    for s in 1..4 {
        if suit_strength(hand, s) > suit_strength(hand, best) {
            best = s;
        }
    }
    best
}

pub struct Contract {
    pub trump: u8,
    /// What the deal is worth to the seat's side on average: card points above 30, open cards.
    pub mean: f64,
    /// How often the side gets above 30.
    pub win: f64,
}

pub struct Ai {
    pub solver: Solver,
    /// The sets of networks the players at the table use (`Opts::nets` picks one).
    pub nets: Vec<Option<Nets>>,
    /// Over the weighted decisions so far: the sum of the effective numbers of deals, and how many.
    pub ess: (f64, u64),
}

impl Default for Ai {
    fn default() -> Self {
        Self::new()
    }
}

struct Position {
    k: Know,
    pts: i32,
    table: u32,
    partner: bool,
    legal: u32,
}
fn position(v: &View) -> Position {
    let k = know(v.leader0, v.trump, v.plays);
    let trick = &v.plays[v.plays.len() - k.n as usize..];
    let pts = trick.iter().map(|&c| points_of(c)).sum();
    let table = trick.iter().fold(0, |m, &c| m | bit(c));
    let partner = k.n > 0 && (k.win_seat & 1) == (v.seat & 1);
    let legal = legal(v.hand, v.trump, k.n, k.led, k.win, partner);
    Position { k, pts, table, partner, legal }
}

/// The public history as each earlier player saw it, so that a supposed deal can be asked:
/// would these players, holding those cards, have named this trump and played these cards?
/// The answer is a sum of one term per seat and step that depends only on the cards that
/// seat held then, and drawn deals share many such hands, so the terms are remembered.
struct History {
    /// For every card played by somebody else: who, which card, what was known just before.
    steps: Vec<(u8, u8, Know)>,
    now: Know,
    seen: std::collections::HashMap<(u32, u32), f32>,
}

impl History {
    fn new(v: &View) -> History {
        let mut steps = Vec::new();
        for t in 0..v.plays.len() {
            let k = know(v.leader0, v.trump, &v.plays[..t]);
            if k.turn != v.seat {
                steps.push((k.turn, v.plays[t], k));
            }
        }
        History { steps, now: know(v.leader0, v.trump, v.plays), seen: Default::default() }
    }

    /// log P(trump named, cards played | the hands `h` as they are now), by the networks.
    fn log_likelihood(&mut self, h: &[u32; 4], v: &View, nets: &mut Nets) -> f64 {
        let mut ll = 0.0;
        if v.dealer != v.seat {
            let dealt = h[v.dealer as usize] | self.now.by[v.dealer as usize];
            ll += *self.seen.entry((u32::MAX, dealt)).or_insert_with(|| nets.trump_logp(dealt, v.trump)) as f64;
        }
        for (t, (seat, card, k)) in self.steps.iter().enumerate() {
            // the hand that seat held then: what it holds now and what it has played since
            let hand = h[*seat as usize] | (self.now.by[*seat as usize] & !k.by[*seat as usize]);
            ll += *self.seen.entry((t as u32, hand)).or_insert_with(|| {
                let f = features(*seat, hand, v.dealer, v.trump, k);
                if f.words[11].count_ones() > 1 { nets.card_logp(&f, *card) } else { 0.0 }
            }) as f64;
        }
        ll
    }
}

impl Ai {
    pub fn new() -> Self {
        Ai { solver: Solver::new(), nets: vec![None], ess: (0.0, 0) }
    }

    /// The card to play, and for every legal card the mean card points team 0 takes after it.
    pub fn search_card(&mut self, v: &View, o: Opts, rng: &mut Rng, values: Option<&mut Vec<(u8, f64)>>) -> u8 {
        let Position { mut k, pts, table, legal, .. } = position(v);
        let mut moves = [0u8; 8];
        let (mut m, mut n_moves) = (legal, 0);
        while m != 0 {
            moves[n_moves] = m.trailing_zeros() as u8;
            n_moves += 1;
            m &= m - 1;
        }
        if n_moves == 1 {
            return moves[0];
        }
        if o.blind {
            k.cant = [k.played; 4];
        }
        let mut draw = Sampler::new(v.seat, v.hand, &k).expect("the truth fits, so something fits");
        let mut sum = [0f64; 8];
        let stop = if v.plays.is_empty() { o.stop_lead } else { 0 };
        if o.belief > 0.0 && self.nets.get(o.nets).is_some_and(|n| n.is_some()) {
            // Draw deals, give each the likelihood of what has been seen, then solve them.
            // With `oversample` > 1 many more are drawn than are solved: `worlds` of them are
            // picked in proportion to their weights (systematic resampling), so the solver's
            // time goes to deals that are plausible.
            let mut seen = History::new(v);
            let m = (o.worlds * o.oversample.max(1)) as usize;
            let mut cand: Vec<([u32; 4], f64)> = Vec::with_capacity(m);
            for _ in 0..m {
                let h = draw.draw(rng);
                cand.push((h, o.belief as f64 * seen.log_likelihood(&h, v, self.nets[o.nets].as_mut().unwrap())));
            }
            let top = cand.iter().map(|c| c.1).fold(f64::MIN, f64::max);
            let (mut total, mut squares) = (0.0, 0.0);
            for c in cand.iter_mut() {
                c.1 = (c.1 - top).exp();
                total += c.1;
                squares += c.1 * c.1;
            }
            self.ess.0 += total * total / squares;
            self.ess.1 += 1;
            if o.oversample > 1 {
                let step = total / o.worlds as f64;
                let (mut at, mut next) = (0.0, rng.next() * step);
                for c in cand.iter_mut() {
                    at += c.1;
                    let mut times = 0.0;
                    while next < at {
                        times += 1.0;
                        next += step;
                    }
                    c.1 = times;
                }
                total = o.worlds as f64;
            }
            for (h, w) in &cand {
                if *w > 0.0 {
                    self.solver.reset(h, v.trump, stop);
                    for i in 0..n_moves {
                        sum[i] += w * self.solver.after(moves[i], v.seat, k.n, k.led, k.win, k.win_seat, pts, table) as f64;
                    }
                }
            }
            for s in sum.iter_mut() {
                *s *= o.worlds as f64 / total; // on the scale of the unweighted sum
            }
        } else {
            for _ in 0..o.worlds {
                let h = draw.draw(rng);
                self.solver.reset(&h, v.trump, stop);
                for i in 0..n_moves {
                    sum[i] += self.solver.after(moves[i], v.seat, k.n, k.led, k.win, k.win_seat, pts, table) as f64;
                }
            }
        }
        // team 1 wants team 0 to take as little as possible
        let sign = if v.seat & 1 == 0 { 1.0 } else { -1.0 };
        let mut best = 0;
        for i in 1..n_moves {
            let d = sign * (sum[i] - sum[best]);
            // equal on average: keep the stronger card in hand
            if d > 1e-9 || (d.abs() <= 1e-9 && moves[i] % 8 < moves[best] % 8) {
                best = i;
            }
        }
        if let Some(out) = values {
            out.clear();
            out.extend((0..n_moves).map(|i| (moves[i], sum[i] / o.worlds as f64)));
        }
        moves[best]
    }

    /// For every contract in `list`, what the deal is worth to the seat's side.
    pub fn contracts(&mut self, v: &View, list: &[u8], o: Opts, rng: &mut Rng) -> Vec<Contract> {
        let lead = (v.dealer + 1) & 3;
        let k = know(lead, NOTRUMP, &[]);
        let mut draw = Sampler::new(v.seat, v.hand, &k).unwrap();
        let team = v.seat & 1;
        let (mut mean, mut wins, mut total) = (vec![0f64; list.len()], vec![0f64; list.len()], 0f64);
        for _ in 0..o.worlds {
            let h = draw.draw(rng);
            // somebody else dealt and chose this trump: deals in which the rule of thumb would
            // have chosen it too count fully, the others for a quarter
            let mut weight = 1.0;
            if v.seat != v.dealer && list.len() == 1 && list[0] != NOTRUMP && thumb_trump(h[v.dealer as usize]) != list[0] {
                weight = 0.25;
            }
            total += weight;
            for (i, &trump) in list.iter().enumerate() {
                self.solver.reset(&h, trump, o.stop);
                let p0 = self.solver.value(lead, 0, NONE, NONE, NONE, 0, 0);
                let worth = if team == 0 { p0 - 30 } else { 30 - p0 } as f64;
                mean[i] += weight * worth;
                if worth > 0.0 {
                    wins[i] += weight;
                }
            }
        }
        list.iter().enumerate().map(|(i, &trump)| Contract { trump, mean: mean[i] / total, win: wins[i] / total }).collect()
    }

    pub fn search_trump(&mut self, v: &View, o: Opts, rng: &mut Rng) -> u8 {
        pick_trump(&self.contracts(v, &[0, 1, 2, 3, NOTRUMP], o, rng))
    }

    /// Meegaan (an opponent of the dealer doubles) or tegengaan (the dealer's side doubles back).
    /// The estimate is too rosy for the dealer's opponents: over 600 deals between search
    /// players (2026-11-26) an opponent who believed in +4 to +12 ended around -1; from +12 on
    /// it paid. After such a meegaan the dealer's side lost 4 deals in 5: the same high bar.
    pub fn search_double(&mut self, v: &View, o: Opts, rng: &mut Rng) -> bool {
        double_rule(&self.contracts(v, &[v.trump], o, rng)[0], (v.seat & 1) == (v.dealer & 1))
    }

    /// The first card of the solver's search order: lead high, win when you can, feed your
    /// partner, throw the cheapest.
    pub fn thumb_card(&mut self, v: &View) -> u8 {
        let p = position(v);
        self.solver.greedy(v.hand, v.trump, p.k.n, p.k.led, p.k.win, p.partner)
    }

    pub fn random_card(&mut self, v: &View, rng: &mut Rng) -> u8 {
        let mut m = position(v).legal;
        for _ in 0..rng.below(m.count_ones() as usize) {
            m &= m - 1;
        }
        m.trailing_zeros() as u8
    }
}

/// The contract worth most; no trump counts double.
pub fn pick_trump(c: &[Contract]) -> u8 {
    let value = |x: &Contract| x.mean * if x.trump == NOTRUMP { 2.0 } else { 1.0 };
    let mut best = &c[0];
    for x in c {
        if value(x) > value(best) {
            best = x;
        }
    }
    best.trump
}

/// Go along (or, on the dealer's side, against) from +12 card points on.
pub fn double_rule(c: &Contract, back: bool) -> bool {
    c.mean >= 12.0 && c.win >= if back { 0.9 } else { 0.85 }
}

/// Who sits on a chair.
#[derive(Clone, Copy)]
pub enum Player {
    Search(Opts),
    /// Rules of thumb, longest-strongest suit as trump, never doubles.
    Thumb,
    /// A legal card at random, a suit at random, never doubles.
    Random,
}

impl Player {
    /// "search:30", "exact:30" (no playouts), "blind:30", "belief:30", "belief:30:0.5" (deals
    /// weighed by the networks, to that power) or "belief:30:1:8" (8 x 30 deals drawn, 30
    /// solved), "thumb", "random". A belief player may name its networks: "belief:30:1:8@nets/g2"
    /// (see `nets_dir`).
    pub fn parse(spec: &str) -> Option<Player> {
        let mut parts = spec.split('@').next()?.split(':');
        let name = parts.next()?;
        let w: u32 = parts.next().unwrap_or("30").parse().ok()?;
        let power: f32 = parts.next().unwrap_or("1").parse().ok()?;
        Some(match name {
            "belief" => Player::Search(Opts { belief: power, oversample: parts.next().unwrap_or("1").parse().ok()?, ..Opts::js(w) }),
            "search" => Player::Search(Opts::js(w)),
            "exact" => Player::Search(Opts::exact(w)),
            "blind" => Player::Search(Opts { blind: true, ..Opts::js(w) }),
            "thumb" => Player::Thumb,
            "random" => Player::Random,
            _ => return None,
        })
    }
    /// The directory of the networks a spec names after '@' (none: $MANILLE_NETS, or nets/current).
    pub fn nets_dir(spec: &str) -> String {
        match spec.split_once('@') {
            Some((_, dir)) => dir.to_string(),
            None => std::env::var("MANILLE_NETS").unwrap_or("nets/current".to_string()),
        }
    }
    /// The same player using the engine's set of networks number `i`.
    pub fn with_nets(self, i: usize) -> Player {
        match self {
            Player::Search(o) => Player::Search(Opts { nets: i, ..o }),
            p => p,
        }
    }
    pub fn trump(&self, ai: &mut Ai, v: &View, rng: &mut Rng) -> u8 {
        match *self {
            Player::Search(o) => ai.search_trump(v, o, rng),
            Player::Thumb => thumb_trump(v.hand),
            Player::Random => rng.below(4) as u8,
        }
    }
    pub fn double(&self, ai: &mut Ai, v: &View, rng: &mut Rng) -> bool {
        match *self {
            Player::Search(o) => ai.search_double(v, o, rng),
            _ => false,
        }
    }
    pub fn card(&self, ai: &mut Ai, v: &View, rng: &mut Rng) -> u8 {
        match *self {
            Player::Search(o) => ai.search_card(v, o, rng, None),
            Player::Thumb => ai.thumb_card(v),
            Player::Random => ai.random_card(v, rng),
        }
    }
}

pub struct Outcome {
    pub trump: u8,
    pub mult: i32,
    pub mee: i32,
    pub tegen: i32,
    pub points: [i32; 2],
    pub tricks: [i32; 2],
    /// -1 at 30-30.
    pub team: i32,
    pub score: i32,
}

/// A whole deal: the dealer names trump, the others may go along, the dealer's side may go
/// against, eight tricks. `who(seat)` says who sits where.
pub fn play_deal(deal: &mut Deal, who: &dyn Fn(u8) -> Player, ai: &mut Ai, rng: &mut Rng, carry: i32) -> Outcome {
    let d = deal.dealer;
    deal.trump = who(d).trump(ai, &deal.view(d), rng);
    let mut mult = carry * if deal.trump == NOTRUMP { 2 } else { 1 };
    let (mut mee, mut tegen) = (-1, -1);
    for s in [(d + 1) & 3, (d + 3) & 3] {
        // the dealer's opponents, left first
        if who(s).double(ai, &deal.view(s), rng) {
            mee = s as i32;
            mult *= 2;
            break;
        }
    }
    if mee >= 0 {
        for s in [d, (d + 2) & 3] {
            if who(s).double(ai, &deal.view(s), rng) {
                tegen = s as i32;
                mult *= 2;
                break;
            }
        }
    }
    while !deal.done() {
        let seat = deal.turn;
        let card = who(seat).card(ai, &deal.view(seat), rng);
        deal.play(card);
    }
    let (team, score) = deal_score(deal.points[0], deal.tricks[0], mult);
    Outcome { trump: deal.trump, mult, mee, tegen, points: deal.points, tricks: deal.tricks, team, score }
}
