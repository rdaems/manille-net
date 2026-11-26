# manille-net — manillen, and an AI that plays it

Rembert started this in 2017 (one Python file, never got to the rules) and picked it up on
2026-11-26: "put it on manillen.daems.me, add a mode where people can play the AI". The plan
he agreed to: a playable game against search-based bots first, the learning part (the "net")
after. Server side: `~/docker/notes/manillen.md`. The map of `~/research`: `../CLAUDE.md`.

## Where things are

- `site/` is **the live docroot of manillen.daems.me**, which is public (nginx, read-only
  mount): a save there is on the internet at once. Test first: `npm test`, then the browser rig `~/.cache/manillen-shots/play.py`
  (it plays whole deals on the live site, which has no state but the visitor's localStorage).
- `site/js/` is one JavaScript engine for the browser and for node: there is no second
  implementation of the rules, on purpose.
  - `manille.js`: cards as integers, hands as 32-bit masks, `legal`, `Deal`, `dealScore`.
  - `belief.js`: `know` (per seat, the cards it cannot hold, read off the forced plays) and
    `sampler` (the hidden hands, exactly uniform over everything that fits; no rejection).
  - `solve.js`: open-card alpha-beta, table keyed on (cards left, seat to lead).
  - `ai.js`: `search` = draw deals, solve each, play the best card on average; the same for
    the trump choice and for meegaan/tegengaan. Baselines `thumb` and `random`.
  - `game.js`: a deal from the trump choice to the score. `ui.js`, `worker.js`: the page.
- `RULES.md`: the rules and their sources. The lines marked **choice** are house rules that
  Rembert decides; do not change one without him.
- `experiments/tournament.js A B deals seed`: duplicate matches (same cards, sides swapped).
  `outputs/` is not in git.
- The page is in Dutch (players are Flemish). Code, comments and notes in English.

## Compute

odyssey is slow (a full solve is about 80 ms, one searched deal several seconds). Matches of
more than a few dozen deals go to hippo: it has no node of its own, so one lives in
`.cache/node` of the working copy there (`.cache` is never synced):

```bash
../bin/hippo run t1 .cache/node/bin/node experiments/tournament.js search:30 thumb 200 1
../bin/hippo log t1 ; ../bin/hippo pull
```

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
