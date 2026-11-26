# manille-net

The card game manillen (West Flemish rules, `RULES.md`) and an AI for it.

- `site/`: the game, as played on manillen.daems.me. Static; the AI runs in the browser.
- `site/js/manille.js` rules, `belief.js` what a player can know and deals drawn from it,
  `solve.js` open-card solver, `ai.js` the players, `game.js` one deal from trump to score.
- `test/`: `npm test` (node 22, no dependencies).
- `experiments/`: matches between players, timings.

The first commit is the 2017 start in Python; it stopped before the rules.
