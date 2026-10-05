#!/usr/bin/env bash
#
# Flake capture harness.
#
# The intermittent in this repo has been OBSERVED twice and CAPTURED never: each
# sighting was a summary line in a suite that then passed. This runs the suite in
# a loop and, on any non-zero exit, keeps the FULL output (test names, error text,
# stack) instead of a summary, so the next sighting is nameable.
#
#   RUNS=5 scripts/flake-hunt.sh <label> [extra vitest args...]
#
# Every run writes logs/<label>-<n>.log (full output) and <label>-<n>.log.res
# (available memory + the runner's open file descriptors, sampled each second).
# A failing run's log is COPIED to failures/ and its error lines are printed.
#
# What is already ruled out, with runs recorded (2026-10-05):
#   - steady state: 6/6 clean · 8 workers: 4/4 · shuffled: 4/4
#   - loaded (a browser suite running concurrently): 4/4
#   - two vitest instances sharing the transform cache: 6/6
#   - resources: available memory never below ~1.2 GB, runner fds max 24
#
# What reproduces the transform-phase failure (both shapes) — a source file
# written while vite transforms it:
#   truncate a widely-imported file (e.g. src/model/types.ts) ~6 s into a run for
#   1.5 s → `[vite] Pre-transform error … <file>:1:22: ERROR: Unexpected end of
#   file`, 42-46 errors, 1-2 files uncollected (2 of 3 runs); hold it 5 s → 64
#   errors and the failure also surfaces in a spawned CLI's stderr. Magnitude
#   scales with the write window, which is how a small "1 failed" sighting and a
#   large "24 files uncollected" sighting can share one cause: an agent editing
#   the tree while a suite runs.
set -u
label="${1:?usage: flake-hunt.sh <label> [vitest args...]}"
shift || true
out="${FLAKE_OUT:-/tmp/flake-hunt}"
mkdir -p "$out/logs" "$out/failures"
runs="${RUNS:-5}"
fails=0

for i in $(seq 1 "$runs"); do
  log="$out/logs/${label}-${i}.log"
  start=$(date +%s)
  # Resource watch: available memory and the test runner's open file descriptors.
  ( for _ in $(seq 1 120); do
      free -m 2>/dev/null | awk '/Mem:/{print "mem_available_mb=" $7}' >> "${log}.res"
      pgrep -f "vitest" | head -1 | xargs -r -I{} sh -c 'ls /proc/{}/fd 2>/dev/null | wc -l' | sed 's/^/vitest_fds=/' >> "${log}.res"
      sleep 1
    done ) &
  sampler=$!
  npx vitest run "$@" > "$log" 2>&1
  code=$?
  kill "$sampler" 2>/dev/null; wait "$sampler" 2>/dev/null
  dur=$(( $(date +%s) - start ))
  summary=$(grep -E "^ *(Test Files|Tests) " "$log" | tr '\n' ' ')
  echo "[$label #$i] exit=$code ${dur}s :: ${summary:-<no summary line>}"
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
echo "== ${label}: ${fails} failing run(s) out of ${runs}"
[ "$fails" -eq 0 ]
