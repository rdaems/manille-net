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
- `outputs/` (match results), `data/` (self-play) and `nets/` (training runs) are not in git.
- The page is in Dutch (players are Flemish). Code, comments and notes in English.

## The networks

- `bin/manille selfplay <deals> <seed> <worlds> <dir>` (on hippo) writes every decision of
  search players against themselves: `engine/src/selfplay.rs` has the record layouts,
  `engine/src/features.rs` the network's input. `data/` is not in git.
- `train/` (JAX; `../bin/hippo setup --python 3.12` once, then
  `../bin/hippo sh python train/policy.py data/sp1 nets/<name>` and `train/trump.py`) fits
  P(card | what the player sees) and P(trump | the dealer's cards), suits permuted at random.
  `nets/` is not in git; `nets/current` is what `cargo test` checks the engine's forward
  pass against (`*.check.*` files the trainer writes).
- The player `belief:N[:power[:oversample]]` (`MANILLE_NETS=nets/<name>`) weighs every drawn
  deal by the likelihood of the trump named and the cards played so far (`History` in
  `ai.rs`). What it is worth is on the results page; the short version on 2026-11-27:
  drawing 8 times more deals than are solved is what makes it pay (about +1.3 card points
  per deal over plain search with the 20,000-deal network).
- **The site's networks are `site/policy.bin` and `site/trump.bin`, in git and live on
  save.** Replace them only with networks that won a match of at least 1000 deals against
  the ones there. The page uses power ½ (`engine/src/wasm.rs` says why).
- `results/build.py` (after `../bin/hippo pull`) writes `results/data.json` for
  `results/index.html`, the page on research.daems.me. Add a match to its `MATCHES` list.

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
- What he asked for on the page, so it is not undone (2026-11-26 and 27):
  - the doubling question is a small button above the hand that runs out after five seconds,
    has a cross to click it away, and stands still while the pointer rests on it; no popup,
    and never the word "pass";
  - "keep it reasonably classic": green table, the classic card faces (English letters are
    fine), a neat typeface (he called a handwriting font sloppy);
  - the three other players get first names drawn at random, per boom, from typical West
    Flemish names of people of 40 to 90 (`NAMES` in `ui.js`; first he asked for the names of
    Hartenjagen '98, then for these); the names of the left and right players stand on the
    outside of their cards and do not move when the hand shrinks;
  - **a card is defined once**: `cardEl()` in `ui.js` and `.card` in `style.css` (width `--cw`,
    height and white margin follow from it); every place that shows a card sets `--cw` and
    nothing else. The faces come without their own outline (`tools/make-cards.py`);
  - when you choose trump your cards are not dimmed and the question sits above them;
  - the trump symbol sits on the dealer's name plate, with the multiplier;
  - cards drop onto the table (start larger with a wide shadow, land), brisk: nothing that
    feels like waiting; sound effects (made in `sound.js`, no files), with a mute switch;
  - a start screen with "Nieuw spel" and "Verder spelen"; installable as an app
    (`manifest.json`, `sw.js`, `icons/`);
  - it must work on a phone both ways up and on a desktop: sizes come from one `--cw`;
  - a game goes to 121 and finished games are kept; pre-moves; no running "this deal: us 7,
    them 8" line.
- **Change the page in a copy, not in `site/`:** `rsync -a --delete site/ ~/.cache/manillen-shots/next/`,
  edit there, test with `-e URL=http://localhost:8124/` (see `play.py`) at 390x760, 780x360
  and 1280x800, then rsync back. `site/cards/*.webp` are made by `tools/make-cards.py`
  (Byron Knoll's public-domain deck).
- Next steps and what was measured: this project's Claude memory,
  `~/.claude/projects/-home-rembert-research-manille-net/memory/`.
