#!/usr/bin/env bash
set -euo pipefail

# Headless MP3 benchmark runner.
#
# Runs the A/B benchmark in real-time headless Chrome via CDP (Chrome DevTools
# Protocol). No --virtual-time-budget — all operations including native audio
# decode run in real wall-clock time, producing the same results as interactive
# Chrome.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BENCH_DIR="$ROOT_DIR/benchmarks/mp3"
PORT="${PORT:-8765}"
CDP_PORT="${CDP_PORT:-9223}"
OUT_FILE="${1:-$BENCH_DIR/results/headless-smoke.chrome.json}"
TIMEOUT_SEC=120
POLL_INTERVAL=2

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_PID=""
SERVER_PID=""
BENCH_URL_PATH="/benchmarks/mp3/index.html"

if [[ ! -x "$CHROME" ]]; then
  echo "ERROR: Chrome binary not found at: $CHROME" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required for CDP polling" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required for CDP WebSocket extraction" >&2
  exit 1
fi

if ! node -e "if (!('WebSocket' in globalThis)) process.exit(1)"; then
  echo "ERROR: Node.js with global WebSocket support is required (Node 22+)." >&2
  exit 1
fi

cleanup() {
  if [[ -n "${CHROME_PID:-}" ]] && ps -p "$CHROME_PID" >/dev/null 2>&1; then
    kill "$CHROME_PID" >/dev/null 2>&1 || true
    wait "$CHROME_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${SERVER_PID:-}" ]] && ps -p "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# 1. Start HTTP server if not already running
cd "$ROOT_DIR"
if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Using existing HTTP server on port ${PORT}"
else
  python -m http.server "$PORT" >/dev/null 2>&1 &
  SERVER_PID=$!
  sleep 1
  echo "Started HTTP server on port ${PORT} (pid ${SERVER_PID})"
fi

# 2. Launch headless Chrome with CDP — no virtual-time-budget
"$CHROME" \
  --headless=new \
  --disable-gpu \
  --remote-debugging-port="$CDP_PORT" \
  --no-first-run \
  --no-default-browser-check \
  "http://127.0.0.1:${PORT}${BENCH_URL_PATH}?auto=1" >/dev/null 2>&1 &
CHROME_PID=$!

# 3. Wait for CDP to be ready
echo -n "Waiting for CDP on port ${CDP_PORT}..."
for i in $(seq 1 20); do
  if curl -s "http://localhost:${CDP_PORT}/json/version" >/dev/null 2>&1; then
    echo " ready"
    break
  fi
  if [[ $i -eq 20 ]]; then
    echo " timeout"
    echo "ERROR: Chrome CDP did not start within 20s" >&2
    exit 1
  fi
  sleep 1
done

# 4. Poll tab title until benchmark completes or timeout
echo "Benchmark running (timeout ${TIMEOUT_SEC}s)..."
ELAPSED=0
while [[ $ELAPSED -lt $TIMEOUT_SEC ]]; do
  TITLE=$(curl -s "http://localhost:${CDP_PORT}/json" \
    | node -e "
        let d='';
        process.stdin.on('data',c=>d+=c);
        process.stdin.on('end',()=>{
          const tabs=JSON.parse(d);
          const t=tabs.find(t=>t.url.includes('${BENCH_URL_PATH}'));
          console.log(t?t.title:'');
        });" 2>/dev/null || echo "")

  case "$TITLE" in
    *PASS*|*FAIL*|*ERROR*)
      echo "Benchmark finished: ${TITLE}"
      break
      ;;
  esac

  sleep "$POLL_INTERVAL"
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

if [[ $ELAPSED -ge $TIMEOUT_SEC ]]; then
  echo "ERROR: Benchmark timed out after ${TIMEOUT_SEC}s" >&2
  exit 1
fi

# 5. Extract result JSON via CDP WebSocket
echo "Extracting results via CDP..."
WS_URL=$(curl -s "http://localhost:${CDP_PORT}/json" \
  | node -e "
      let d='';
      process.stdin.on('data',c=>d+=c);
      process.stdin.on('end',()=>{
        const tabs=JSON.parse(d);
        const t=tabs.find(t=>t.url.includes('${BENCH_URL_PATH}'));
        console.log(t?t.webSocketDebuggerUrl:'');
      });" 2>/dev/null)

if [[ -z "$WS_URL" ]]; then
  echo "ERROR: Could not find benchmark tab WebSocket URL" >&2
  exit 1
fi

node -e "
  const ws = new WebSocket('${WS_URL}');
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: 'document.getElementById(\"result\").textContent' }
    }));
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id === 1) {
      process.stdout.write(msg.result.result.value);
      ws.close();
    }
  });
  ws.addEventListener('error', (err) => {
    process.stderr.write('WebSocket error: ' + err.message + '\n');
    process.exit(1);
  });
" > "${OUT_FILE}.tmp"

# 6. Validate and write output
node -e "
  const fs = require('fs');
  const raw = fs.readFileSync('${OUT_FILE}.tmp', 'utf8');
  const data = JSON.parse(raw);
  fs.mkdirSync(require('path').dirname('${OUT_FILE}'), { recursive: true });
  fs.writeFileSync('${OUT_FILE}', JSON.stringify(data, null, 2) + '\n');
  console.log('Wrote ' + '${OUT_FILE}');
  console.log('overallPass=' + data.meta.overallPass);
  const gate = data.gate || [];
  for (const g of gate) {
    const status = g.pass ? 'PASS' : 'FAIL';
    const detail = g.failures.length ? ' (' + g.failures.join(', ') + ')' : '';
    console.log('  ' + g.fixtureId + ': ' + status + detail);
  }
"

rm -f "${OUT_FILE}.tmp"
