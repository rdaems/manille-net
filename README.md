# manille-net

The card game manillen (West Flemish rules, `RULES.md`) and an AI for it.

- `engine/`: the engine, in Rust: rules, what a player can know and deals drawn from it,
  an open-card solver, the players. `engine/build.sh` builds it for this machine, as a static
  Linux binary (`bin/manille`) and as WebAssembly for the page (`site/manille.wasm`).
  `manille match search:30 thumb 1000 1` plays a match on all cores.
- `site/`: the game, as played on manillen.daems.me. Static; the AI is the same engine,
  running in the browser.
- `reference/`: the first version of the AI, in JavaScript. The Rust engine was checked against
  it card for card; it is kept as that yardstick and is not used by the page.
- `train/`: the trainer (JAX) for the two networks the engine uses to weigh drawn deals: a card
  policy and a trump policy, fitted to self-play. The ones the page uses are `site/*.bin`.
- `results/`: what each change was worth, measured in matches.
- `test/`: `npm test` for the JavaScript side (node 22, no dependencies); `cargo test` in `engine/`.
- `experiments/`: cross-checks between the two versions, a deal written out card by card.

The first commit is the 2017 start in Python; it stopped before the rules.
