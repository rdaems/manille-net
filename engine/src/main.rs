//! manille match A B deals seed [threads]   two kinds of player, every deal twice with the
//!                                          sides swapped, all cores; JSON on stdout
//! manille deal seed worlds                 one deal between search players, as the
//!                                          JavaScript version plays it (cross-check)
//! manille bench                            how fast the solver is
use manille_engine::ai::{play_deal, Ai, Opts, Player};
use manille_engine::rules::*;
use manille_engine::solve::Solver;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |i: usize, default: &str| args.get(i).cloned().unwrap_or(default.to_string());
    match args.first().map(String::as_str) {
        Some("match") => {
            let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
            run_match(&arg(1, "search:30"), &arg(2, "thumb"), arg(3, "100").parse().unwrap(), arg(4, "1").parse().unwrap(), arg(5, &threads.to_string()).parse().unwrap());
        }
        Some("deal") => one_deal(arg(1, "1").parse().unwrap(), arg(2, "30").parse().unwrap()),
        Some("bench") => bench(),
        _ => eprintln!("manille match A B deals seed [threads] | deal seed worlds | bench"),
    }
}

struct Half {
    trump: u8,
    mult: i32,
    points_a: i32,
    score: i32,
}

fn run_match(spec_a: &str, spec_b: &str, deals: usize, seed: u32, threads: usize) {
    let a = Player::parse(spec_a).expect("unknown player A");
    let b = Player::parse(spec_b).expect("unknown player B");
    let next = AtomicUsize::new(0);
    let rows: Mutex<Vec<(usize, [u32; 4], [Half; 2])>> = Mutex::new(Vec::new());
    let t0 = Instant::now();
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                let mut ai = Ai::new();
                loop {
                    let g = next.fetch_add(1, Ordering::Relaxed);
                    if g >= deals {
                        break;
                    }
                    // every deal has its own generators, so the result does not depend on the threads
                    let mix = seed.wrapping_mul(0x9e37_79b1).wrapping_add(g as u32).wrapping_mul(0x85eb_ca6b);
                    let first = Deal::random(&mut Rng::new(mix), (g & 3) as u8);
                    let mut rng = Rng::new(mix ^ 0x5bd1_e995);
                    let halves = [0u8, 1].map(|swap| {
                        // swap 0: A sits on seats 0 and 2
                        let mut deal = Deal::new(first.hands, first.dealer, NOTRUMP);
                        let r = play_deal(&mut deal, &|seat| if seat & 1 == swap { a } else { b }, &mut ai, &mut rng, 1);
                        let team_a = swap as i32;
                        Half { trump: r.trump, mult: r.mult, points_a: r.points[swap as usize], score: if r.team < 0 { 0 } else if r.team == team_a { r.score } else { -r.score } }
                    });
                    rows.lock().unwrap().push((g, first.hands, halves));
                }
            });
        }
    });
    let mut rows = rows.into_inner().unwrap();
    rows.sort_by_key(|r| r.0);
    let d: Vec<f64> = rows.iter().map(|r| (r.2[0].points_a + r.2[1].points_a) as f64 / 2.0 - 30.0).collect();
    let m = d.iter().sum::<f64>() / d.len() as f64;
    let sd = (d.iter().map(|x| (x - m).powi(2)).sum::<f64>() / (d.len() as f64 - 1.0).max(1.0)).sqrt();
    let secs = t0.elapsed().as_secs_f64();
    eprintln!("{} deals: {} takes {:.2} ± {:.2} of 60 against {}; {:.1} s, {:.0} deals per second on {} threads",
        deals, spec_a, m + 30.0, sd / (d.len() as f64).sqrt(), spec_b, secs, deals as f64 / secs, threads);
    let half = |h: &Half| format!("{{\"trump\":{},\"mult\":{},\"pointsA\":{},\"score\":{}}}", h.trump, h.mult, h.points_a, h.score);
    let body: Vec<String> = rows.iter().map(|(g, hands, h)| format!("{{\"dealer\":{},\"hands\":[{},{},{},{}],\"a\":{},\"b\":{}}}", g & 3, hands[0], hands[1], hands[2], hands[3], half(&h[0]), half(&h[1]))).collect();
    println!("{{\"a\":\"{}\",\"b\":\"{}\",\"seed\":{},\"rows\":[{}]}}", spec_a, spec_b, seed, body.join(","));
}

/// The deal `experiments/crosscheck.js seed worlds` plays, printed the same way.
fn one_deal(seed: u32, worlds: u32) {
    let mut rng = Rng::new(seed);
    let mut deal = Deal::random(&mut Rng::new(seed + 99), (seed & 3) as u8);
    let mut ai = Ai::new();
    let d = deal.dealer;
    deal.trump = ai.search_trump(&deal.view(d), Opts::js(16), &mut rng);
    let (mut mee, mut tegen) = (-1, -1);
    for s in [(d + 1) & 3, (d + 3) & 3] {
        if ai.search_double(&deal.view(s), Opts::js(30), &mut rng) {
            mee = s as i32;
            break;
        }
    }
    if mee >= 0 {
        for s in [d, (d + 2) & 3] {
            if ai.search_double(&deal.view(s), Opts::js(30), &mut rng) {
                tegen = s as i32;
                break;
            }
        }
    }
    while !deal.done() {
        let seat = deal.turn;
        let card = ai.search_card(&deal.view(seat), Opts::js(worlds), &mut rng, None);
        deal.play(card);
    }
    let plays: Vec<String> = deal.plays.iter().map(|c| c.to_string()).collect();
    println!("{} trump {} mee {} tegen {} | {} | {} {}", seed, deal.trump, mee, tegen, plays.join(" "), deal.points[0], deal.points[1]);
}

fn bench() {
    let mut solver = Solver::new();
    for left in [32usize, 28, 24, 20] {
        let (mut rng, n) = (Rng::new(3), 200);
        let (mut times, t0, nodes0) = (Vec::new(), Instant::now(), solver.nodes);
        for g in 0..n {
            let mut d = Deal::random(&mut rng, (g & 3) as u8);
            d.trump = rng.below(5) as u8;
            while 32 - d.plays.len() > left {
                let mut m = d.legal();
                for _ in 0..rng.below(m.count_ones() as usize) {
                    m &= m - 1;
                }
                d.play(m.trailing_zeros() as u8);
            }
            let t = Instant::now();
            solver.reset(&d.hands, d.trump, 0);
            let mut m = d.legal();
            while m != 0 {
                solver.after(m.trailing_zeros() as u8, d.turn, d.n, d.led, d.win, d.win_seat, d.trick_pts, d.table());
                m &= m - 1;
            }
            times.push(t.elapsed().as_secs_f64() * 1e3);
        }
        times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("{left} cards, every legal card valued: median {:.2} ms, max {:.1} ms, {:.1} M nodes/s",
            times[n / 2], times[n - 1], (solver.nodes - nodes0) as f64 / t0.elapsed().as_secs_f64() / 1e6);
    }
}
