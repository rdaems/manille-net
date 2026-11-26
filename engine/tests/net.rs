//! The engine's forward pass against the trainer's, on records the trainer set aside
//! (nets/current/*.check.*). Skipped when no network has been trained here.
use manille_engine::features::Features;
use manille_engine::net::Nets;

#[test]
fn the_networks_say_what_the_trainer_says() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../nets/current");
    let Some(mut nets) = Nets::load(dir) else {
        eprintln!("no networks in {dir}: skipped");
        return;
    };
    let read = |name: &str| std::fs::read(format!("{dir}/{name}")).unwrap();
    let f32s = |b: &[u8]| -> Vec<f32> { b.chunks_exact(4).map(|x| f32::from_le_bytes(x.try_into().unwrap())).collect() };
    let u32_at = |b: &[u8], at: usize| u32::from_le_bytes(b[at..at + 4].try_into().unwrap());

    let (records, want) = (read("policy.check.records"), f32s(&read("policy.check.logp")));
    for (i, r) in records.chunks_exact(128).enumerate() {
        let f = Features { words: core::array::from_fn(|w| u32_at(r, 4 + 4 * w)), trump: r[52], dealer_rel: r[53], win_rel: r[54], n: r[55] };
        for c in 0..32u8 {
            if f.words[11] >> c & 1 != 0 {
                let (got, want) = (nets.card_logp(&f, c), want[32 * i + c as usize]);
                assert!((got - want).abs() < 2e-3, "record {i} card {c}: {got} against {want}");
            }
        }
    }
    let (records, want) = (read("trump.check.records"), f32s(&read("trump.check.logp")));
    for (i, r) in records.chunks_exact(32).enumerate() {
        for t in 0..5u8 {
            let (got, want) = (nets.trump_logp(u32_at(r, 4), t), want[5 * i + t as usize]);
            assert!((got - want).abs() < 2e-3, "deal {i} trump {t}: {got} against {want}");
        }
    }
}
