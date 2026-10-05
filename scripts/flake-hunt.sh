#!/usr/bin/env bash
#
# Flake capture harness, with concurrent-writer detection.
#
# The intermittent in this repo is not test logic. It was reproduced deliberately
# (2026-10-05): writing a source file while vite transforms it makes the file fail
# to collect —
#   [vite] Pre-transform error: Transform failed with 1 error:
#   <file>:1:22: ERROR: Unexpected end of file
# — once per importer. The magnitude scales with the write window: 1.5 s → 42-46
# errors and `1 failed | 1068 passed`; 8 s → 117 errors; a permanently broken file
# → 96 files uncollected. Those are Shape 1's and Shape 2's summaries.
#
# This harness therefore hashes the working tree before and after each run. A run
# that failed WITH a transform error AND a changed tree hash is reported as
# TREE-MOVED — a concurrent writer, not a broken test — and re-run once, because
# the mitigation the coordinator asked for ("re-run on a Pre-transform error") is
# useless for a suite unless the runner does it.
#
#   RUNS=5 scripts/flake-hunt.sh <label> [extra vitest args...]
#
# Output: logs/<label>-<n>.log (FULL output), <label>-<n>.log.res (memory + fds
# sampled each second), and failures/<label>-<n>.log for every run that failed and
# was NOT explained by a tree move.
#
# OBSERVED, so it is not re-litigated:
#   - `--retry` does NOT cover collection/transform failures. A permanently broken
#     file with `--retry=3` still exits 1 (96 files uncollected, 247 transform
#     errors) and the output contains ZERO retry markers. Vitest's `retry` applies
#     to tests, never to collection.
#   - A reporter CAN see it (`Reporter.onCollected` / `onTaskUpdate` receive the
#     file list and task results) but cannot re-run the suite. Only a wrapper can,
#     which is what this script is.
#   - Ruled out by runs: steady state (6), 8 workers (4), shuffled (4), a browser
#     suite running concurrently (4), two vitest instances sharing the transform
#     cache (6), memory (min 1284 MB available), file descriptors (max 24).
set -u
label="${1:?usage: flake-hunt.sh <label> [vitest args...]}"
shift || true
out="${FLAKE_OUT:-/tmp/flake-hunt}"
mkdir -p "$out/logs" "$out/failures"
runs="${RUNS:-5}"
fails=0
tree_moves=0
reran=0

# A content hash of every source file: a change between two samples means a writer
# touched the tree while the run was in flight.
tree_hash() {
  find src tests server scripts -type f \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name '*.sh' -o -name '*.css' -o -name '*.json' \) \
    -print0 2>/dev/null | sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | cut -d' ' -f1
}

# One run. Sets run_code; writes the log; classifies a failure against the tree.
one_run() {
  local log="$1"; shift
  local before after
  before=$(tree_hash)
  npx vitest run "$@" > "$log" 2>&1
  run_code=$?
  after=$(tree_hash)
  run_moved=0
  [ "$before" != "$after" ] && run_moved=1
  return 0
}

for i in $(seq 1 "$runs"); do
  log="$out/logs/${label}-${i}.log"
  start=$(date +%s)
  ( for _ in $(seq 1 240); do
      free -m 2>/dev/null | awk '/Mem:/{print "mem_available_mb=" $7}' >> "${log}.res"
      pgrep -f "vitest" | head -1 | xargs -r -I{} sh -c 'ls /proc/{}/fd 2>/dev/null | wc -l' | sed 's/^/vitest_fds=/' >> "${log}.res"
      sleep 1
    done ) &
  sampler=$!
  one_run "$log" "$@"
  code=$run_code; moved=$run_moved
  kill "$sampler" 2>/dev/null; wait "$sampler" 2>/dev/null

  # A transform failure plus a tree that moved under the run is a concurrent
  # writer, not a broken test. Re-run ONCE, so the suite is not failed by it.
  if [ "$code" -ne 0 ] && [ "$moved" -eq 1 ] && grep -qE "Pre-transform error|Transform failed" "$log"; then
    tree_moves=$((tree_moves + 1))
    echo "[$label #$i] TREE MOVED during the run (transform failure + changed tree) — re-running once"
    grep -nE "Pre-transform error|Transform failed" "$log" | head -3 | sed 's/^/  /'
    one_run "$log.rerun" "$@"
    code=$run_code; moved=$run_moved
    reran=$((reran + 1))
    [ "$code" -eq 0 ] && echo "  re-run: clean — the first failure was the tree moving, not the code"
  fi

  dur=$(( $(date +%s) - start ))
  summary=$(grep -E "^ *(Test Files|Tests) " "$log" | tr '\n' ' ')
  echo "[$label #$i] exit=$code ${dur}s tree_moved=$moved :: ${summary:-<no summary line>}"
  if [ "$code" -ne 0 ]; then
    fails=$((fails + 1))
    cp "$log" "$out/failures/${label}-${i}.log"
    echo "  >>> CAPTURED FULL OUTPUT: $out/failures/${label}-${i}.log"
    grep -nE "FAIL|Error:|AssertionError|Failed to (load|collect)|Pre-transform|Transform failed|Unhandled|Cannot find" "$log" | head -15 | sed 's/^/  /'
  fi
  if [ -f "${log}.res" ]; then
    awk -F= '/mem_available_mb/{if($2<min||min==0)min=$2} /vitest_fds/{if($2>maxfd)maxfd=$2} END{print "  resources: min mem_available="min" MB, max vitest fds="maxfd}' "${log}.res"
  fi
done
echo "== ${label}: ${fails} failing run(s) out of ${runs}; ${tree_moves} explained by the tree moving (re-ran ${reran})"
[ "$fails" -eq 0 ]
