#!/bin/bash
# Everybody against everybody, 1000 duplicate deals a pair: random, the rules of thumb, plain
# search and the players of each generation. Results in outputs/ladder/ (results/build.py
# turns them into ratings). Pairs already played are skipped.
#   G=4 experiments/ladder.sh
set -euo pipefail
G=${G:-4}; DEALS=${DEALS:-1000}
names=(random thumb search); specs=(random thumb search:30)
for g in $(seq 1 "$G"); do [ -e "nets/g$g/trump.bin" ] && { names+=("g$g"); specs+=("belief:30:1:8@nets/g$g"); }; done
mkdir -p outputs/ladder
for i in "${!names[@]}"; do for j in "${!names[@]}"; do
  [ "$j" -gt "$i" ] || continue
  out="outputs/ladder/${names[$j]}__${names[$i]}.json"          # the later (stronger) one is A
  [ -s "$out" ] || { nice -n 5 bin/manille match "${specs[$j]}" "${specs[$i]}" "$DEALS" 11 > "$out.tmp" 2> >(head -1 >&2) && mv "$out.tmp" "$out"; }
done; done
echo ladder done
