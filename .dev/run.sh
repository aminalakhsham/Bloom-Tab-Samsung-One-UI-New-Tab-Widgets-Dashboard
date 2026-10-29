#!/usr/bin/env bash
# Runs one dev test with the harness in one of CHROME_SLOTS (default 3) lock slots, so tests started at the same
# time by several people or agents take turns: more headless Chromes than that at once make boot time out on this
# 4-core machine.
#   usage: .dev/run.sh .dev/<test>.cjs          (env vars such as UI=ar THEME=dark OUT=… pass through)
#          .dev/run.sh --raw node .dev/<x>.cjs  (any command, same slots)
#   A run is killed after TIMEOUT seconds (default 600).
cd "$(dirname "$0")/.." || exit 1
SLOTS=${CHROME_SLOTS:-3}
if [ "$1" = "--raw" ]; then shift; CMD=("$@"); else CMD=(timeout "${TIMEOUT:-600}" node .dev/harness.cjs "$@"); fi
while :; do
  for i in $(seq 1 "$SLOTS"); do
    exec 9>".dev/.chrome.lock.$i"
    if flock -n 9; then "${CMD[@]}"; rc=$?; exec 9>&-; exit $rc; fi
    exec 9>&-
  done
  sleep 1
done
