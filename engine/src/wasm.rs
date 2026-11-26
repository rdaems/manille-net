//! The engine as WebAssembly for the page: plain numbers in and out, no glue code.
//! The page writes the cards played so far into the buffer at `plays_ptr()`.
use crate::ai::{Ai, Opts};
use crate::rules::{Rng, View};
use std::cell::RefCell;

thread_local! {
    static AI: RefCell<Ai> = RefCell::new(Ai::new());
    static PLAYS: RefCell<[u8; 32]> = const { RefCell::new([0; 32]) };
}

#[no_mangle]
pub extern "C" fn plays_ptr() -> *mut u8 {
    PLAYS.with(|p| p.borrow_mut().as_mut_ptr())
}

/// The card `seat` plays. `n` cards have been played in this deal (in the buffer).
#[no_mangle]
pub extern "C" fn card(seat: u32, hand: u32, dealer: u32, trump: u32, n: u32, worlds: u32, seed: u32) -> u32 {
    let plays = PLAYS.with(|p| *p.borrow());
    let v = View { seat: seat as u8, hand, dealer: dealer as u8, trump: trump as u8, leader0: (dealer as u8 + 1) & 3, plays: &plays[..n as usize] };
    AI.with(|ai| ai.borrow_mut().search_card(&v, Opts::exact(worlds), &mut Rng::new(seed), None)) as u32
}

/// The trump the dealer names (4 = none).
#[no_mangle]
pub extern "C" fn trump(seat: u32, hand: u32, worlds: u32, seed: u32) -> u32 {
    let v = View { seat: seat as u8, hand, dealer: seat as u8, trump: 4, leader0: (seat as u8 + 1) & 3, plays: &[] };
    AI.with(|ai| ai.borrow_mut().search_trump(&v, Opts::exact(worlds), &mut Rng::new(seed))) as u32
}

/// 1 when `seat` goes along (or against, on the dealer's side).
#[no_mangle]
pub extern "C" fn double(seat: u32, hand: u32, dealer: u32, trump: u32, worlds: u32, seed: u32) -> u32 {
    let v = View { seat: seat as u8, hand, dealer: dealer as u8, trump: trump as u8, leader0: (dealer as u8 + 1) & 3, plays: &[] };
    AI.with(|ai| ai.borrow_mut().search_double(&v, Opts::exact(worlds), &mut Rng::new(seed))) as u32
}
