#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RESULTS_FILE="$ROOT_DIR/benchmarks/mp3/results/headless-smoke.chrome.json"

cd "$ROOT_DIR"

echo "[release-gate] 1/3 unit tests"
npm test

echo "[release-gate] 2/3 headless mp3 benchmark"
bash benchmarks/mp3/run-headless-benchmark.sh "$RESULTS_FILE"

node -e "
  const fs = require('fs');
  const file = process.argv[1];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data?.meta?.overallPass) {
    console.error('[release-gate] benchmark failed: overallPass is false');
    process.exit(1);
  }
  console.log('[release-gate] benchmark passed: overallPass=true');
" "$RESULTS_FILE"

echo "[release-gate] 3/3 package zip"
bash package_project.sh

echo "[release-gate] PASS"
