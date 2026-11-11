#!/usr/bin/env bash
# Full differential fuzz run: builds charon-oracle and the harness bundles in
# $OUT, then runs the lock fuzzer and the decoder / hashing fuzzer.
#
#   OUT=/tmp/fuzz N=10000 SHARDS=4 test/fuzz/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
OUT="${OUT:?set OUT to a scratch directory}"
N="${N:-2000}"
SHARDS="${SHARDS:-3}"
mkdir -p "$OUT"
[ -x "$OUT/oracle/charon-oracle" ] || OUT="$OUT/oracle" "$here/build-oracle.sh"
# Bundles resolve packages from $OUT/node_modules.
[ -e "$OUT/node_modules" ] || ln -s "$(readlink -f "$repo/node_modules")" "$OUT/node_modules"
(cd "$repo" && npx esbuild test/fuzz/driver.ts test/fuzz/sdkRunner.ts test/fuzz/decoders.ts \
  --bundle --platform=node --format=esm --packages=external \
  --outdir="$OUT/build" --out-extension:.js=.mjs --log-level=warning)
node "$OUT/build/driver.mjs" --out "$OUT/run" --oracle "$OUT/oracle/charon-oracle" \
  --n "$N" --shards "$SHARDS" ${SEED:+--seed "$SEED"} | tee "$OUT/run.log"
node "$OUT/build/decoders.mjs" --out "$OUT/decoders" --oracle "$OUT/oracle/charon-oracle" \
  --n "${DECODER_N:-20000}" | tee "$OUT/decoders.log"
