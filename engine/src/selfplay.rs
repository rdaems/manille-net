//! One kind of search player against itself, every decision written down for the trainer.
//!
//! Three files of fixed-size little-endian records (layouts below, read by train/data.py):
//! `cards.bin` (128 bytes, one per card choice with more than one legal card), `trumps.bin`
//! (32 bytes, one per deal) and `doubles.bin` (24 bytes, one per time a seat was asked).
use manille_engine::ai::{double_rule, pick_trump, Ai, Opts, Player};
use manille_engine::belief::know;
use manille_engine::features::features;
use manille_engine::rules::*;
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

#[derive(Default)]
struct Out {
    cards: Vec<u8>,
    trumps: Vec<u8>,
    doubles: Vec<u8>,
}

fn one_deal(g: usize, seed: u32, o: Opts, ai: &mut Ai, out: &mut Out) {
    let mix = seed.wrapping_mul(0x9e37_79b1).wrapping_add(g as u32).wrapping_mul(0x85eb_ca6b);
    let mut deal = Deal::random(&mut Rng::new(mix), (g & 3) as u8);
    let mut rng = Rng::new(mix ^ 0x5bd1_e995);
    let d = deal.dealer;

    // trumps.bin: u32 deal, u32 hand, u8 trump, u8 seat, u16 0, f32 mean[5]
    let c = ai.contracts(&deal.view(d), &[0, 1, 2, 3, NOTRUMP], o, &mut rng);
    deal.trump = pick_trump(&c);
    out.trumps.extend((g as u32).to_le_bytes());
    out.trumps.extend(deal.hands[d as usize].to_le_bytes());
    out.trumps.extend([deal.trump, d, 0, 0]);
    for x in &c {
        out.trumps.extend((x.mean as f32).to_le_bytes());
    }

    // doubles.bin: u32 deal, u32 hand, u8 trump, u8 dealer_rel, u8 go, i8 outcome, f32 mean, f32 win, u32 0
    // (outcome: the side's card points above 30 at the end, filled in below)
    let (mut mult_log2, mut asked) = ((deal.trump == NOTRUMP) as u8, Vec::new());
    let mut ask = |s: u8, deal: &Deal, ai: &mut Ai, rng: &mut Rng, out: &mut Out| {
        let c = &ai.contracts(&deal.view(s), &[deal.trump], o, rng)[0];
        let go = double_rule(c, (s & 1) == (d & 1));
        asked.push((out.doubles.len() + 11, s));
        out.doubles.extend((g as u32).to_le_bytes());
        out.doubles.extend(deal.hands[s as usize].to_le_bytes());
        out.doubles.extend([deal.trump, d.wrapping_sub(s) & 3, go as u8, 0]);
        out.doubles.extend((c.mean as f32).to_le_bytes());
        out.doubles.extend((c.win as f32).to_le_bytes());
        out.doubles.extend(0u32.to_le_bytes());
        go
    };
    let mut mee = false;
    for s in [(d + 1) & 3, (d + 3) & 3] {
        if ask(s, &deal, ai, &mut rng, out) {
            mee = true;
            mult_log2 += 1;
            break;
        }
    }
    if mee {
        for s in [d, (d + 2) & 3] {
            if ask(s, &deal, ai, &mut rng, out) {
                mult_log2 += 1;
                break;
            }
        }
    }

    // cards.bin: u32 deal, u32 words[12] (features.rs), u8 trump, dealer_rel, win_rel, n,
    // action, seat, mult_log2, outcome, i16 best, i16 0, i16 adv[32]
    // (best: what the search believed the side still takes, x100; adv: each legal card against
    // the best one, x100, -32768 = not allowed; outcome: what the side then really took)
    let (mut values, mut pending) = (Vec::new(), Vec::new());
    while !deal.done() {
        let seat = deal.turn;
        let v = deal.view(seat);
        let card = ai.search_card(&v, o, &mut rng, Some(&mut values));
        if deal.legal().count_ones() > 1 {
            let k = know(deal.leader0, deal.trump, &deal.plays);
            let f = features(seat, v.hand, d, deal.trump, &k);
            let team = (seat & 1) as usize;
            // the search counts for team 0; for team 1 less is better
            let sign = if team == 0 { 1.0 } else { -1.0 };
            let best = values.iter().map(|x| sign * x.1).fold(f64::MIN, f64::max);
            let left = mask_points(deal.hands.iter().fold(0, |m, h| m | h)) + deal.trick_pts;
            let mine = if team == 0 { best } else { left as f64 + best };
            pending.push((out.cards.len() + 59, team, deal.points[team]));
            out.cards.extend((g as u32).to_le_bytes());
            for w in f.words {
                out.cards.extend(w.to_le_bytes());
            }
            out.cards.extend([f.trump, f.dealer_rel, f.win_rel, f.n, card, seat, mult_log2, 0]);
            out.cards.extend(((mine * 100.0).round() as i16).to_le_bytes());
            out.cards.extend(0i16.to_le_bytes());
            let mut adv = [i16::MIN; 32];
            for &(c, x) in &values {
                adv[c as usize] = ((sign * x - best) * 100.0).round() as i16;
            }
            for a in adv {
                out.cards.extend(a.to_le_bytes());
            }
        }
        deal.play(card);
    }
    for (at, team, had) in pending {
        out.cards[at] = (deal.points[team] - had) as u8;
    }
    for (at, s) in asked {
        out.doubles[at] = (deal.points[(s & 1) as usize] - 30) as i8 as u8;
    }
}

pub fn run(deals: usize, seed: u32, spec: &str, dir: &str, threads: usize) {
    let Some(Player::Search(o)) = Player::parse(spec) else { panic!("selfplay needs a search player, not {spec}") };
    let nets = Player::nets_dir(spec);
    std::fs::create_dir_all(dir).unwrap();
    let file = |name: &str| Mutex::new(std::io::BufWriter::new(std::fs::File::create(format!("{dir}/{name}")).unwrap()));
    let (cards, trumps, doubles) = (file("cards.bin"), file("trumps.bin"), file("doubles.bin"));
    let (next, t0) = (AtomicUsize::new(0), std::time::Instant::now());
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                let (mut ai, mut out) = (Ai::new(), Out::default());
                ai.nets = vec![manille_engine::net::Nets::load(&nets)];
                loop {
                    let g = next.fetch_add(1, Ordering::Relaxed);
                    if g >= deals {
                        break;
                    }
                    one_deal(g, seed, o, &mut ai, &mut out);
                    // whole deals at a time, so a file never holds half a deal
                    cards.lock().unwrap().write_all(&out.cards).unwrap();
                    trumps.lock().unwrap().write_all(&out.trumps).unwrap();
                    doubles.lock().unwrap().write_all(&out.doubles).unwrap();
                    out.cards.clear();
                    out.trumps.clear();
                    out.doubles.clear();
                    if (g + 1) % 1000 == 0 {
                        eprintln!("{} deals, {:.0} s", g + 1, t0.elapsed().as_secs_f64());
                    }
                }
            });
        }
    });
    eprintln!("{deals} deals in {:.0} s -> {dir}", t0.elapsed().as_secs_f64());
}
