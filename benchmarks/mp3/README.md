# MP3 Encoder Benchmark Gate

This directory contains the gated A/B benchmark for `lamejs` vs `shine`.

## Files

1. `index.html`: Browser runner UI.
2. `benchmark.js`: Benchmark logic and gate evaluation.
3. `fixtures/`: Deterministic benchmark fixtures, including speech WAV files.
4. `vendors/lamejs.min.js`: Baseline encoder used for A/B comparison.
5. `results/`: Committed benchmark artifacts.

## Gate Criteria

The report enforces:

1. `shine` wall time `<= lamejs` per fixture.
2. `shine` peak heap delta `<= 1.5x` baseline.
3. Output size delta within `+/- 1%`.
4. Frame/header sanity for CBR 128k.
5. Decode passes and `shine` duration drift is no worse than `lamejs` + `0.05%`.

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
