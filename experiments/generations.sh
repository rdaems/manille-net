#!/bin/bash
# Self-learning by generations, on hippo (run from the project root):
#   generation 1  networks fitted to plain search playing itself (data/sp1)
#   generation g  networks fitted to the generation g-1 player playing itself
# The generation-g player is search that weighs its drawn deals with the generation-g networks.
# Every step is skipped when its result is already there, so the script can be restarted.
#   N=30000 G=4 experiments/generations.sh
set -euo pipefail
N=${N:-30000}; G=${G:-4}
py() { python "$@" 2>&1 | grep -v -i -E 'warn|^W0|^I0' | tail -1; }
fit() { [ -e "nets/$2/trump.bin" ] || { py train/policy.py "data/$1" "nets/$2"; py train/trump.py "data/$1" "nets/$2"; }; }
fit sp1 g1
for g in $(seq 2 "$G"); do
  [ -e "data/g$g/done" ] || { nice -n 5 bin/manille selfplay "$N" "$g" "belief:30:1:8@nets/g$((g - 1))" "data/g$g" 2>&1 | tail -1; touch "data/g$g/done"; }
  fit "g$g" "g$g"
done
echo generations done
