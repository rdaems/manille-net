//! Manillen (West Flemish rules) and players for it. See ../RULES.md and ../CLAUDE.md.
pub mod ai;
pub mod belief;
pub mod features;
pub mod net;
pub mod rules;
pub mod solve;
#[cfg(target_arch = "wasm32")]
mod wasm;
