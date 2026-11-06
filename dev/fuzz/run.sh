#!/usr/bin/env bash
# Runs every fuzz test in src/fuzz/, each property for FUZZTIME (a duration such as
# 10s or 2m; default 10s), from a fresh random seed. A failure prints the smallest
# input fast-check could shrink it to, with the FUZZ_SEED and FUZZ_PATH that replay
# it: add the input to the property's examples with the fix, and it runs with the
# regular tests from then on.
set -euo pipefail
cd "$(dirname "$0")/../.."

export FUZZTIME="${FUZZTIME:-10s}"
shopt -s nullglob
files=(src/fuzz/*.test.js)
if [ "${#files[@]}" -eq 0 ]; then
  echo "No fuzz tests found." >&2
  exit 1
fi

echo "Fuzzing each property for $FUZZTIME."
exec bun test "${files[@]/#/./}"
