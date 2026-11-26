//! A small fully connected network, as train/data.py saves it, and the two networks the
//! engine uses: the card policy and the trump policy. Plain loops: the first layer only adds
//! the rows of the inputs that are 1, the later ones skip the units that are 0.
use crate::features::Features;

pub struct Mlp {
    /// Per layer: inputs, outputs, w[inputs][outputs], b[outputs].
    layers: Vec<(usize, usize, Vec<f32>, Vec<f32>)>,
    a: Vec<f32>,
    b: Vec<f32>,
}

impl Mlp {
    pub fn parse(bytes: &[u8]) -> Option<Mlp> {
        let u32_at = |at: usize| bytes.get(at..at + 4).map(|b| u32::from_le_bytes(b.try_into().unwrap()) as usize);
        let floats = |at: usize, n: usize| -> Option<Vec<f32>> {
            Some(bytes.get(at..at + 4 * n)?.chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect())
        };
        if bytes.get(..4)? != b"MNLP" {
            return None;
        }
        let (n, mut at, mut layers, mut widest) = (u32_at(4)?, 8, Vec::new(), 0);
        for _ in 0..n {
            let (i, o) = (u32_at(at)?, u32_at(at + 4)?);
            layers.push((i, o, floats(at + 8, i * o)?, floats(at + 8 + 4 * i * o, o)?));
            at += 8 + 4 * i * o + 4 * o;
            widest = widest.max(o);
        }
        Some(Mlp { layers, a: vec![0.0; widest], b: vec![0.0; widest] })
    }

    pub fn inputs(&self) -> usize {
        self.layers[0].0
    }

    /// The outputs for an input that is 1 at the indices `active` gives and 0 elsewhere.
    pub fn forward(&mut self, active: impl FnOnce(&mut dyn FnMut(usize))) -> &[f32] {
        let (_, o, w, b) = &self.layers[0];
        let x = &mut self.a[..*o];
        x.copy_from_slice(b);
        active(&mut |i| {
            for (xj, wj) in x.iter_mut().zip(&w[i * o..(i + 1) * o]) {
                *xj += wj;
            }
        });
        let mut width = *o;
        for (inputs, o, w, b) in &self.layers[1..] {
            debug_assert_eq!(*inputs, width);
            let y = &mut self.b[..*o];
            y.copy_from_slice(b);
            for i in 0..width {
                let xi = self.a[i];
                if xi > 0.0 {
                    for (yj, wj) in y.iter_mut().zip(&w[i * o..(i + 1) * o]) {
                        *yj += xi * wj;
                    }
                }
            }
            std::mem::swap(&mut self.a, &mut self.b);
            width = *o;
        }
        &self.a[..width]
    }
}

fn log_sum_exp(x: impl Iterator<Item = f32> + Clone) -> f32 {
    let m = x.clone().fold(f32::MIN, f32::max);
    m + x.map(|v| (v - m).exp()).sum::<f32>().ln()
}

pub struct Nets {
    pub policy: Mlp,
    pub trump: Mlp,
}

impl Nets {
    pub fn parse(policy: &[u8], trump: &[u8]) -> Option<Nets> {
        Some(Nets { policy: Mlp::parse(policy)?, trump: Mlp::parse(trump)? })
    }

    /// The directory the trainer wrote (policy.bin, trump.bin).
    #[cfg(not(target_arch = "wasm32"))]
    pub fn load(dir: &str) -> Option<Nets> {
        Nets::parse(&std::fs::read(format!("{dir}/policy.bin")).ok()?, &std::fs::read(format!("{dir}/trump.bin")).ok()?)
    }

    /// log P(card | what the player sees), over the cards it may play.
    pub fn card_logp(&mut self, f: &Features, card: u8) -> f32 {
        let legal = f.words[11];
        let out = self.policy.forward(|g| f.active(g));
        let allowed = (0..32).filter(|c| legal >> c & 1 != 0).map(|c| out[c]);
        out[card as usize] - log_sum_exp(allowed)
    }

    /// log P(trump | the dealer's eight cards); trump 4 = none.
    pub fn trump_logp(&mut self, hand: u32, trump: u8) -> f32 {
        let out = self.trump.forward(|g| {
            let mut m = hand;
            while m != 0 {
                g(m.trailing_zeros() as usize);
                m &= m - 1;
            }
        });
        out[trump as usize] - log_sum_exp(out.iter().copied())
    }
}
