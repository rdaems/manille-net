use manille_engine::belief::{know, Sampler};
use manille_engine::rules::*;
use manille_engine::solve::Solver;

fn random_legal(d: &Deal, rng: &mut Rng) -> u8 {
    let mut m = d.legal();
    for _ in 0..rng.below(m.count_ones() as usize) {
        m &= m - 1;
    }
    m.trailing_zeros() as u8
}
fn play_some(rng: &mut Rng, n: usize) -> Deal {
    let dealer = rng.below(4) as u8;
    let mut d = Deal::random(rng, dealer);
    d.trump = rng.below(5) as u8;
    while d.plays.len() < n {
        let c = random_legal(&d, rng);
        d.play(c);
    }
    d
}

/// Would `hands` (as they are now) have been allowed to play this history?
fn fits(hands: &[u32; 4], leader0: u8, trump: u8, plays: &[u8]) -> bool {
    let mut start = Deal::new(*hands, (leader0 + 3) & 3, trump);
    // give every seat its played cards back: replay once to learn who played what
    let (mut leader, mut n, mut win, mut ws) = (leader0, 0u8, NONE, NONE);
    for &c in plays {
        let seat = (leader + n) & 3;
        start.hands[seat as usize] |= bit(c);
        if n == 0 || beats(c, win, trump) {
            win = c;
            ws = seat;
        }
        n += 1;
        if n == 4 {
            leader = ws;
            n = 0;
        }
    }
    for &c in plays {
        if start.legal() & bit(c) == 0 {
            return false;
        }
        start.play(c);
    }
    true
}

#[test]
fn the_javascript_engine_agrees_on_recorded_positions() {
    let mut solver = Solver::new();
    let text = include_str!("positions.txt");
    for line in text.lines() {
        let x: Vec<u64> = line.split(' ').map(|t| t.parse().unwrap()).collect();
        let hands = [x[0] as u32, x[1] as u32, x[2] as u32, x[3] as u32];
        let (trump, leader0, np) = (x[4] as u8, x[5] as u8, x[6] as usize);
        let plays: Vec<u8> = x[7..7 + np].iter().map(|&c| c as u8).collect();
        let rest = &x[7 + np..];
        // rebuild the deal: the hands in the file are what is left, so replay on the full hands
        let mut full = hands;
        let (mut leader, mut n, mut win, mut ws) = (leader0, 0u8, NONE, NONE);
        for &c in &plays {
            let seat = (leader + n) & 3;
            full[seat as usize] |= bit(c);
            if n == 0 || beats(c, win, trump) {
                win = c;
                ws = seat;
            }
            n += 1;
            if n == 4 {
                leader = ws;
                n = 0;
            }
        }
        let mut d = Deal::new(full, (leader0 + 3) & 3, trump);
        for &c in &plays {
            d.play(c);
        }
        assert_eq!(d.hands, hands);
        assert_eq!(d.legal() as u64, rest[0], "legal cards");
        let k = know(leader0, trump, &plays);
        for p in 0..4 {
            assert_eq!(k.cant[p] as u64, rest[1 + p], "what seat {p} cannot hold");
        }
        let s = Sampler::new(d.turn, d.hands[d.turn as usize], &k).unwrap();
        assert_eq!(s.deals, rest[5] as f64, "deals that fit");
        solver.reset(&d.hands, trump, 0);
        assert_eq!(solver.value(d.turn, d.n, d.led, d.win, d.win_seat, d.trick_pts, d.table()) as u64, rest[6], "open-card value");
    }
}

/// Plain minimax without any shortcut.
#[allow(clippy::too_many_arguments)]
fn brute(h: &mut [u32; 4], trump: u8, turn: u8, n: u8, led: u8, win: u8, ws: u8, pts: i32) -> i32 {
    if n == 0 && h.iter().all(|&x| x == 0) {
        return 0;
    }
    let mut l = legal(h[turn as usize], trump, n, led, win, n > 0 && (ws & 1) == (turn & 1));
    let mut best = if turn & 1 == 0 { -1 } else { 999 };
    while l != 0 {
        let c = l.trailing_zeros() as u8;
        l &= l - 1;
        h[turn as usize] ^= bit(c);
        let takes = n == 0 || beats(c, win, trump);
        let (w, s, p) = (if takes { c } else { win }, if takes { turn } else { ws }, pts + points_of(c));
        let v = if n == 3 {
            (if s & 1 == 0 { p } else { 0 }) + brute(h, trump, s, 0, NONE, NONE, NONE, 0)
        } else {
            brute(h, trump, (turn + 1) & 3, n + 1, if n == 0 { c >> 3 } else { led }, w, s, p)
        };
        h[turn as usize] ^= bit(c);
        best = if turn & 1 == 0 { best.max(v) } else { best.min(v) };
    }
    best
}

#[test]
fn the_solver_agrees_with_plain_minimax_on_endgames() {
    let (mut rng, mut solver) = (Rng::new(5), Solver::new());
    for _ in 0..600 {
        let n = 18 + rng.below(13);
        let d = play_some(&mut rng, n); // 2 to 14 cards left
        let want = brute(&mut d.hands.clone(), d.trump, d.turn, d.n, d.led, d.win, d.win_seat, d.trick_pts);
        solver.reset(&d.hands, d.trump, 0);
        assert_eq!(solver.value(d.turn, d.n, d.led, d.win, d.win_seat, d.trick_pts, d.table()), want);
        // and per card: the best card reaches the value, no card does better
        let (mut l, mut best) = (d.legal(), if d.turn & 1 == 0 { -1 } else { 999 });
        while l != 0 {
            let c = l.trailing_zeros() as u8;
            l &= l - 1;
            let v = solver.after(c, d.turn, d.n, d.led, d.win, d.win_seat, d.trick_pts, d.table());
            let mut h = d.hands;
            h[d.turn as usize] ^= bit(c);
            let takes = d.n == 0 || beats(c, d.win, d.trump);
            let (w, s, p) = (if takes { c } else { d.win }, if takes { d.turn } else { d.win_seat }, d.trick_pts + points_of(c));
            let exact = if d.n == 3 {
                (if s & 1 == 0 { p } else { 0 }) + brute(&mut h, d.trump, s, 0, NONE, NONE, NONE, 0)
            } else {
                brute(&mut h, d.trump, (d.turn + 1) & 3, d.n + 1, if d.n == 0 { c >> 3 } else { d.led }, w, s, p)
            };
            assert_eq!(v, exact, "value after one card");
            best = if d.turn & 1 == 0 { best.max(v) } else { best.min(v) };
        }
        assert_eq!(best, want);
    }
}

#[test]
fn drawn_deals_would_have_played_the_same_history() {
    let mut rng = Rng::new(11);
    for _ in 0..400 {
        let n = rng.below(31);
        let d = play_some(&mut rng, n);
        let (me, k) = (d.turn, know(d.leader0, d.trump, &d.plays));
        for p in 0..4 {
            assert_eq!(k.cant[p] & d.hands[p], 0, "the truth never contradicts what is known");
            assert_eq!(k.left[p] as u32, d.hands[p].count_ones());
        }
        let mut s = Sampler::new(me, d.hands[me as usize], &k).expect("the truth fits");
        for _ in 0..20 {
            let h = s.draw(&mut rng);
            assert_eq!(h[me as usize], d.hands[me as usize]);
            assert_eq!(h[0] | h[1] | h[2] | h[3], !k.played);
            assert_eq!(h[0].count_ones() + h[1].count_ones() + h[2].count_ones() + h[3].count_ones(), 32 - d.plays.len() as u32);
            assert!(fits(&h, d.leader0, d.trump, &d.plays));
        }
    }
}

/// Late in a deal every split of the unseen cards can be listed. The splits that would have
/// played the same history must be exactly as many as the sampler says, and it must draw them
/// equally often.
#[test]
fn the_masks_say_exactly_what_the_history_says_and_the_draw_is_uniform() {
    let (mut rng, mut checked) = (Rng::new(23), 0);
    for _ in 0..250 {
        let n = 17 + rng.below(12);
        let d = play_some(&mut rng, n);
        let (me, k) = (d.turn, know(d.leader0, d.trump, &d.plays));
        let mut unseen = Vec::new();
        let mut m = !k.played & !d.hands[me as usize];
        while m != 0 {
            unseen.push(m.trailing_zeros() as u8);
            m &= m - 1;
        }
        let others = [(me + 1) & 3, (me + 2) & 3, (me + 3) & 3];
        let mut truth = std::collections::HashMap::new();
        let mut split = vec![0usize; unseen.len()];
        'all: loop {
            let mut h = [0u32; 4];
            h[me as usize] = d.hands[me as usize];
            for (i, &c) in unseen.iter().enumerate() {
                h[others[split[i]] as usize] |= bit(c);
            }
            if (0..4).all(|p| h[p].count_ones() == k.left[p] as u32) && fits(&h, d.leader0, d.trump, &d.plays) {
                truth.insert(h, 0u32);
            }
            for s in split.iter_mut() {
                *s += 1;
                if *s < 3 {
                    continue 'all;
                }
                *s = 0;
            }
            break;
        }
        let mut s = Sampler::new(me, d.hands[me as usize], &k).unwrap();
        assert_eq!(s.deals, truth.len() as f64, "number of deals that fit");
        if truth.len() > 1 && truth.len() <= 40 {
            for _ in 0..300 * truth.len() {
                *truth.get_mut(&s.draw(&mut rng)).expect("a drawn deal fits") += 1;
            }
            for &v in truth.values() {
                assert!((v as f64 - 300.0).abs() < 6.0 * 300f64.sqrt(), "count {v} of 300");
            }
            checked += 1;
        }
    }
    assert!(checked > 30);
}
