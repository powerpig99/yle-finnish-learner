# Plan: Replace `lamejs` with a Shine-Based Encoder Only if Performance Matches or Improves

## Goal

Replace `lib/lamejs.min.js` with a self-contained vanilla JS MP3 encoder (`lib/shine-mp3.js`) while preserving functionality and achieving **match-or-better performance** against the current implementation.

This is a gated migration, not a direct swap.

## Current Status

1. Runtime path is now Shine-only (`manifest.json` and `package_project.sh` no longer include `lib/lamejs.min.js`).
2. `controls/audio-encoder.js` no longer has runtime backend selection/fallback logic.
3. `lamejs` is retained only under `benchmarks/mp3/vendors/lamejs.min.js` for A/B benchmark comparison.

## Non-Negotiable Acceptance Criteria

The new encoder is accepted only if all criteria pass:

1. Throughput: encode wall time is `<=` current `lamejs` for every benchmark case.
2. Memory: peak heap delta is `<= 1.5x` baseline for every benchmark case.
3. Stability: zero runtime exceptions across benchmark and manual integration cases.
4. Decode validity: `AudioContext.decodeAudioData()` succeeds on all generated MP3 outputs.
5. Duration accuracy: decoded duration drift is `<= lamejs drift + 0.05%` (relative gate).
6. Bitrate/frame sanity: output conforms to CBR 128k frame-size expectations (valid padding behavior).
7. Output size: file size is within `+/- 1%` of `lamejs` for equivalent fixture/case.
8. Quality: manual listening check on speech fixtures shows no obvious artifacts/regressions.
9. Integration: end-to-end YLE flow (record -> encode -> download -> playback) works unchanged.

If any criterion fails in future re-validation, hold release and fix before shipping.

## Scope and Constraints

1. Target environment: Chrome extension runtime.
2. Functional API compatibility: preserve `lamejs.Mp3Encoder` shape (`new`, `encodeBuffer`, `flush`).
3. Input matrix to support:
   1. Sample rates: 44100 Hz, 48000 Hz.
   2. Channels: mono and stereo.
   3. Clip lengths: short and long (to cover reservoir/frame continuity).
4. Fixture mix:
   1. Deterministic synthetic PCM fixtures (sine/chirp/noise/step).
   2. Real speech fixtures representative of YLE usage.

## Baseline First (Current `lamejs`)

Before any Shine porting, capture baseline metrics from current implementation:

1. Encode wall time (`ms`) per case.
2. Effective throughput (`audio-seconds encoded / wall-second`).
3. Peak heap delta.
4. Output file size.
5. Decode pass/fail and decoded duration.

Store results in a committed benchmark artifact for direct A/B comparison.

## Benchmark Environment

1. Primary gate measurements run in Chrome (extension/runtime context).
2. Optional secondary Node benchmark is allowed for fast iteration but is non-gating.
3. Final go/no-go uses Chrome results only.
4. Headless automation must use CDP real-time execution (no `--virtual-time-budget`) so decode checks and timing metrics remain valid.

## Rollout Strategy (Dual-Path, Then Swap)

Phases are kept here for implementation traceability. Current status is in the section above.

### Phase 0: Baseline Harness + Fixtures + Metrics

1. Add benchmark harness with deterministic fixtures.
2. Add at least one real speech fixture for mono and stereo cases.
3. Run harness against current `lamejs`.
4. Commit baseline artifact.

### Phase 1: Implement `shine` Encoder Behind a Selector

1. Create `lib/shine-mp3.js` as a single IIFE that exports `lamejs.Mp3Encoder`-compatible API.
2. Keep `lib/lamejs.min.js` in place.
3. Add temporary encoder selector in `/Users/jingliang/Documents/active_projects/yle-language-reactor/controls/audio-encoder.js`:
   1. `chrome.storage.local` key: `encoderBackend`.
   2. Allowed values: `lamejs`, `shine`.
   3. Default/fallback: `lamejs`.

### Phase 2: Functional and Performance A/B

1. Run harness against both encoders on identical fixtures.
2. Compare against Phase 0 baseline.
3. Block promotion unless all acceptance criteria pass.

### Phase 3: Promote and Simplify

Only after Phase 2 is green:

1. Update `/Users/jingliang/Documents/active_projects/yle-language-reactor/manifest.json`:
   `lib/lamejs.min.js` -> `lib/shine-mp3.js`
2. Update `/Users/jingliang/Documents/active_projects/yle-language-reactor/package_project.sh`:
   `lib/lamejs.min.js` -> `lib/shine-mp3.js`
3. Remove `lib/lamejs.min.js`.
4. Remove temporary selector/fallback code.

## Technical Port Plan (Shine -> Vanilla JS)

Reference source:

1. Shine C: `toots/shine` (`layer3.c`, `l3subband.c`, `l3mdct.c`, `l3loop.c`, `l3bitstream.c`, `reservoir.c`, `bitstream.c`, `tables.c`, `types.h`)
2. Secondary readability reference: Go port `braheezy/shine-mp3`

Implementation order:

1. IIFE scaffold + config validation + tables.
2. Bitstream writer.
3. Polyphase filterbank + MDCT.
4. Quantization loop + Huffman/region selection.
5. Bit reservoir + frame assembly.
6. API compatibility wrapper.

## What Not to Port

1. Do not port full LAME psychoacoustic model or VBR machinery.
2. Do port the minimum Shine quantization/bit-allocation logic needed for valid and acceptable output quality.
3. Do not port short-block attack model.
4. Do not port CLI/WAV tooling and unrelated utilities.

## Verification Checklist

### Automated

1. Structural frame checks (sync word, frame size, headers).
2. Decode check for every generated file.
3. Relative duration drift check (`shine <= lamejs + tolerance`).
4. Output-size check against baseline.
5. Performance and memory checks against baseline (strict pass/fail).

### Manual

1. YLE end-to-end recording and download flow.
2. Playback verification in Chrome and external player.
3. Listening check on real speech fixtures (artifact/regression check).

## Licensing Gate (Required Before Merge)

1. Confirm license compatibility of Shine source and referenced tables.
2. Add required attribution/notice updates in repo if needed.
3. Do not merge implementation until licensing gate is explicitly cleared.

## Go/No-Go Rule

Go:

1. All acceptance criteria pass.
2. Licensing gate cleared.
3. Manual integration flow verified.

No-Go:

1. Any regression on throughput, memory, validity, quality, or stability.
2. Any unresolved licensing uncertainty.

In No-Go, block release and revert to last known-good package if needed.
