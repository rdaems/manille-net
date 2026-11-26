#!/bin/bash
# A match spread over several processes, one seed each:
#   experiments/match.sh search:30 thumb 50 6     -> outputs/search:30-thumb-<seed>.json (6 x 50 deals)
# NODE=.cache/node/bin/node on hippo.
set -euo pipefail
cd "$(dirname "$0")/.."
A=$1; B=$2; DEALS=${3:-50}; N=${4:-4}; NODE=${NODE:-node}
mkdir -p outputs
for seed in $(seq 1 "$N"); do
  nice -n 19 "$NODE" experiments/tournament.js "$A" "$B" "$DEALS" "$seed" > "outputs/$A-$B-$seed.json" 2> "outputs/$A-$B-$seed.log" &
done
wait
tail -qn 1 outputs/"$A-$B"-*.log
