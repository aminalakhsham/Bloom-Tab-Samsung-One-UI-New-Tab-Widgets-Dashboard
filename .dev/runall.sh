#!/usr/bin/env bash
# Runs every dev suite and writes a one-line verdict per run to .dev/shots/runall/summary.txt; full logs go to
# .dev/shots/runall/<name>.log.  usage: .dev/runall.sh [name-filter]      (JOBS=3 parallel runs by default)
#   - plain node tests: .dev/*.mjs (pure logic, no browser)
#   - browser suites: .dev/*.cjs except harness.cjs and lib-*.cjs; one whose first line starts with "// triple" also
#     runs in dark and Arabic; one whose first line mentions "run.sh --raw node" launches its own Chrome.
# Browser runs go through .dev/run.sh, which caps the Chromes running at once (CHROME_SLOTS).
cd "$(dirname "$0")/.." || exit 1
LOG=.dev/shots/runall; mkdir -p "$LOG"; SUM=$LOG/summary.txt; : > "$SUM"
FILTER=${1:-}; JOBS=${JOBS:-3}
verdict() { # name logfile exitcode
  local f=$2 ok fail perr serr v=PASS
  ok=$(grep -cE '^\s*(ok|PASS)' "$f"); fail=$(grep -cE '^FAIL' "$f"); perr=$(grep -c '\[pageerror\]' "$f"); serr=$(grep -c 'SCRIPT ERROR' "$f")
  { [ "$3" != 0 ] || [ "$fail$perr$serr" != "000" ]; } && v=FAIL
  printf '%-30s %s  ok=%s fail=%s pageerror=%s scripterror=%s\n' "$1" "$v" "$ok" "$fail" "$perr" "$serr" >> "$SUM"
  echo "$1 $v"
}
export -f verdict; export LOG SUM
for f in .dev/*.mjs; do
  n=$(basename "$f" .mjs); [[ -n $FILTER && $n != *$FILTER* ]] && continue
  node "$f" > "$LOG/$n.log" 2>&1; verdict "$n" "$LOG/$n.log" $?
done
jobs=()
for f in .dev/*.cjs; do
  n=$(basename "$f" .cjs); case $n in harness|lib-*) continue;; esac; [[ -n $FILTER && $n != *$FILTER* ]] && continue
  raw=0; head -1 "$f" | grep -q 'run.sh --raw node' && raw=1
  jobs+=("$n|$f|$raw|")
  if head -1 "$f" | grep -q '^// triple'; then jobs+=("$n-dark|$f|$raw|THEME=dark" "$n-ar|$f|$raw|UI=ar"); fi
done
printf '%s\n' "${jobs[@]}" | xargs -P "$JOBS" -I{} bash -c '
  IFS="|" read -r name file raw envs <<< "{}"
  if [ "$raw" = 1 ]; then cmd=(.dev/run.sh --raw node "$file"); else cmd=(.dev/run.sh "$file"); fi
  env $envs OUT="$LOG/$name" "${cmd[@]}" > "$LOG/$name.log" 2>&1; verdict "$name" "$LOG/$name.log" $?'
sort -o "$SUM" "$SUM"
python3 scripts/check_i18n.py --quiet > "$LOG/i18n.log" 2>&1; echo "i18n exit=$? $(tail -1 "$LOG/i18n.log")" | tee -a "$SUM"
echo "$(grep -c ' PASS ' "$SUM") passed, $(grep -c ' FAIL ' "$SUM") failed" | tee -a "$SUM"
echo DONE | tee -a "$SUM"
