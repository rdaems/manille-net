# manille-net — manillen, and an AI that plays it

Rembert started this in 2017 (one Python file, never got to the rules) and picked it up on
2026-11-26: "put it on manillen.daems.me, add a mode where people can play the AI". The plan
he agreed to: a playable game against search-based bots first, the learning part (the "net")
after. Server side: `~/docker/notes/manillen.md`. The map of `~/research`: `../CLAUDE.md`.

## Where things are

- `site/` is **the live docroot of manillen.daems.me**, which is public (nginx, read-only
  mount): a save there is on the internet at once. Test first: `npm test`, then the browser rig `~/.cache/manillen-shots/play.py`
  (it plays whole deals on the live site, which has no state but the visitor's localStorage).
- **`engine/` is the engine, in Rust** (no dependencies): `rules.rs` (cards as integers,
  hands as 32-bit masks, `legal`, `Deal`), `belief.rs` (`know`: per seat the cards it cannot
  hold, read off the forced plays; `Sampler`: the hidden hands, exactly uniform over everything
  that fits, no rejection), `solve.rs` (open-card alpha-beta, table keyed on cards left and
  seat to lead), `ai.rs` (`search`: draw deals, solve each, play the best card on average; the
  same for trump and meegaan/tegengaan; baselines `thumb` and `random`), `wasm.rs` (the page's
  interface), `main.rs` (`manille match | deal | bench`).
- `engine/build.sh` runs the tests and builds three things: the local binary, the static one
  for hippo (`bin/manille`, not in git) and **`site/manille.wasm`, which is in git and live
  the moment it is built**. So: test before building.
- The page (`site/js/ui.js`, `game.js`, `manille.js`) keeps its own small copy of the rules
  in JavaScript, for showing which cards are allowed; `worker.js` calls the WebAssembly engine.
- `reference/` is the first AI, in JavaScript, frozen. Rembert found it far too slow
  ("implementeer dat toch in rust ofzo"), so the engine was ported on 2026-11-27 and checked
  against it: `manille deal <seed> <worlds>` and `node experiments/crosscheck.js <seed> <worlds>`
  must print the same deal card for card (the `search` player keeps the JavaScript settings
  for that reason), and `engine/tests/positions.txt` holds 400 positions the two agree on.
  Do not develop the JavaScript AI further.
- `RULES.md`: the rules and their sources. The lines marked **choice** are house rules that
  Rembert decides; do not change one without him.
- `outputs/` (match results) is not in git.
- The page is in Dutch (players are Flemish). Code, comments and notes in English.

## Compute

Matches run on hippo, on all its cores, with the static binary (hippo has no Rust):

```bash
engine/build.sh
../bin/hippo sh bin/manille match search:30 thumb 1000 1 > outputs/x.json     # or `hippo run` for long ones
```

Speed as measured on 2026-11-27: 240 deals of `search:30` against `thumb` take 23 s on hippo
(the JavaScript version: 340 s). A full 32-card solve of every legal card is about 20 ms on
odyssey. What is still slow is the first trick; the real gain there is a value estimate that
replaces deep search, which is the job of the net.

## Rules

- Commit after a change and push: the remote is `rdaems/manille-net` on GitHub, public.
  Rembert said yes to pushing on 2026-11-26. Nothing private goes in the repo (no addresses,
  no keys; `outputs/`, `runs/` and `.cache/` are ignored).
- The site is public on the tunnel since 2026-11-26 (his yes), ungated, noindex.
- What he asked for on the page, so it is not undone: the doubling question is a small
  button above the hand that runs out after five seconds (no popup, and never the word
  "pass"); cards carry the French letters V D R; a neat typeface (he called the handwriting
  font sloppy); a game goes to 121 and finished games are kept; cards can be set ready before
  your turn (pre-moves); no running "this deal: us 7, them 8" line.
- Next steps and what was measured: this project's Claude memory,
  `~/.claude/projects/-home-rembert-research-manille-net/memory/`.
