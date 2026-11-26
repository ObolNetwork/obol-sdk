#!/usr/bin/env bash
# Builds test/fuzz/charon-oracle against a local Charon checkout without
# touching it: the module is assembled in $OUT/src (go.mod = Charon's
# requirements + a replace to $CHARON), the binary lands in $OUT/charon-oracle.
#
#   CHARON=/workspace/repos/charon OUT=/tmp/fuzz test/fuzz/build-oracle.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
CHARON="${CHARON:-/workspace/repos/charon}"
OUT="${OUT:?set OUT to a scratch directory}"
mkdir -p "$OUT/src"
cp "$here/charon-oracle/main.go" "$OUT/src/main.go"
# Charon's go.mod with the module renamed, plus a requirement on Charon itself.
sed -e 's#^module .*#module charonoracle#' "$CHARON/go.mod" >"$OUT/src/go.mod"
cat >>"$OUT/src/go.mod" <<EOF

require github.com/obolnetwork/charon v0.0.0-local
replace github.com/obolnetwork/charon => $CHARON
EOF
cp "$CHARON/go.sum" "$OUT/src/go.sum"
cd "$OUT/src"
export GOTOOLCHAIN="${GOTOOLCHAIN:-go1.27.3}" GOFLAGS="-mod=mod"
go build -o "$OUT/charon-oracle" .
echo "built $OUT/charon-oracle"
