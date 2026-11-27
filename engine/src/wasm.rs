//! The engine as WebAssembly for the page: plain numbers in and out, no glue code.
//! The page writes the cards played so far into the buffer at `plays_ptr()`, and hands over
//! the two network files once (`alloc`, then `load_nets`). Without them the players are plain
//! search; with them every drawn deal is weighed by the likelihood of the play so far.
use crate::ai::{Ai, Opts};
use crate::net::Nets;
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

/// Room for `n` bytes the page wants to hand over.
#[no_mangle]
pub extern "C" fn alloc(n: u32) -> *mut u8 {
    Box::leak(vec![0u8; n as usize].into_boxed_slice()).as_mut_ptr()
}

/// The networks as the trainer saved them (policy.bin, trump.bin). 1 when they were read.
///
/// # Safety
/// Both ranges must come from `alloc` and hold that many bytes.
#[no_mangle]
pub unsafe extern "C" fn load_nets(policy: *const u8, policy_len: u32, trump: *const u8, trump_len: u32) -> u32 {
    let (p, t) = (std::slice::from_raw_parts(policy, policy_len as usize), std::slice::from_raw_parts(trump, trump_len as usize));
    let nets = Nets::parse(p, t);
    let ok = nets.is_some() as u32;
    AI.with(|ai| ai.borrow_mut().nets = nets);
    ok
}

/// How the page's players think. With networks: eight times `worlds` deals are drawn and
/// `worlds` of them solved, picked by likelihood to the power one half. The half is for the
/// person at the table, who does not play like the search players the networks were fitted
/// to; between search players it was as strong as the full power (results/).
fn opts(worlds: u32) -> Opts {
    Opts { belief: 0.5, oversample: 8, ..Opts::js(worlds) }
}

/// The card `seat` plays. `n` cards have been played in this deal (in the buffer).
#[no_mangle]
pub extern "C" fn card(seat: u32, hand: u32, dealer: u32, trump: u32, n: u32, worlds: u32, seed: u32) -> u32 {
    let plays = PLAYS.with(|p| *p.borrow());
    let v = View { seat: seat as u8, hand, dealer: dealer as u8, trump: trump as u8, leader0: (dealer as u8 + 1) & 3, plays: &plays[..n as usize] };
    AI.with(|ai| ai.borrow_mut().search_card(&v, opts(worlds), &mut Rng::new(seed), None)) as u32
}

/// The trump the dealer names (4 = none).
#[no_mangle]
pub extern "C" fn trump(seat: u32, hand: u32, worlds: u32, seed: u32) -> u32 {
    let v = View { seat: seat as u8, hand, dealer: seat as u8, trump: 4, leader0: (seat as u8 + 1) & 3, plays: &[] };
    AI.with(|ai| ai.borrow_mut().search_trump(&v, Opts::js(worlds), &mut Rng::new(seed))) as u32
}

/// 1 when `seat` goes along (or against, on the dealer's side).
#[no_mangle]
pub extern "C" fn double(seat: u32, hand: u32, dealer: u32, trump: u32, worlds: u32, seed: u32) -> u32 {
    let v = View { seat: seat as u8, hand, dealer: dealer as u8, trump: trump as u8, leader0: (dealer as u8 + 1) & 3, plays: &[] };
    AI.with(|ai| ai.borrow_mut().search_double(&v, Opts::js(worlds), &mut Rng::new(seed))) as u32
}
