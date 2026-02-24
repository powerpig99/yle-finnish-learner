# Audio Encoder Benchmark Gate

This directory contains the gated benchmark for the active runtime encoder path.

## Files

1. `index.html`: Browser runner UI.
2. `benchmark.js`: Benchmark logic and gate evaluation.
3. `fixtures/`: Deterministic benchmark fixtures, including speech WAV files.
4. `results/`: Committed benchmark artifacts.

## Gate Criteria

The report enforces:

1. Throughput at least `0.75x` real-time per fixture.
2. MPEG-1 Layer III frame is found with `128 kbps` and expected sample rate.
3. Decode succeeds for every fixture.
4. Duration drift is `<= 1.0%`.
5. Output remains compressed (`outputBytes/rawPcmBytes <= 0.6`).

## Run In Browser

From repo root:

```bash
python -m http.server 8765
```

Open:

`http://127.0.0.1:8765/benchmarks/mp3/index.html`

Click `Run Benchmark`, then copy JSON and save to `benchmarks/mp3/results/`.

## Headless Run (CDP Real-Time Gate)

Run:

```bash
bash benchmarks/mp3/run-headless-benchmark.sh
```

Optional output path:

```bash
bash benchmarks/mp3/run-headless-benchmark.sh benchmarks/mp3/results/headless-smoke.chrome.json
```

This runner uses Chrome DevTools Protocol in real time (no virtual-time budget), so decode validation and throughput timing are meaningful.
