# Review: External Module Removal Plan

## Date: 2026-02-24

## Scope
Remove all external modules (lamejs vendor, fake-indexeddb, shine-mp3) while keeping
Chrome extension behavior, MP3/audio download, and current UX unchanged.

---

## Phase 0: Freeze Baseline — Good

Headless smoke result already exists at `benchmarks/mp3/results/headless-smoke.chrome.json`.
Just commit it as the pinned baseline artifact. Straightforward.

## Phase 1: Remove Benchmark lamejs Vendor — Good

Clean removal. Benchmark becomes shine-only, comparing against committed baseline JSON
instead of live A/B. Removes 156K `lamejs.min.js` + its license. No runtime impact.

Files to remove:
- `benchmarks/mp3/vendors/lamejs.min.js` (156K)
- `third_party/licenses/lamejs-LICENSE.txt`

Files to update:
- `benchmarks/mp3/benchmark.js` — remove lamejs backend, add baseline JSON comparison
- `benchmarks/mp3/index.html` — remove lamejs script tag
- `benchmarks/mp3/README.md` — update description
- `THIRD_PARTY_NOTICES.md` — remove lamejs entry

## Phase 2: Remove fake-indexeddb — Good, Moderate Effort

`fake-indexeddb` is 676K and the only devDependency (the only npm dependency at all).

IndexedDB API surface used by `database.js` tests:
- `indexedDB.open()`, `indexedDB.deleteDatabase()`
- `db.createObjectStore()` with keyPath
- `objectStore.createIndex()` with compound key paths
- `transaction()`, `objectStore.put()`, `objectStore.get()`, `objectStore.getAll()`
- `index.getAll()` with compound key query
- `objectStore.openCursor()` (in cleanupOldMovieData)
- `objectStore.delete()`
- Transaction complete/error events

This is a non-trivial surface but bounded. A local in-tree shim (~200-300 lines) covering
just these operations is feasible. The shim only needs to handle the patterns `database.js`
actually uses — not the full IndexedDB spec.

After completion: zero npm dependencies, `node_modules/` can be removed entirely.

## Phase 3: Shine Removal Feasibility Spike

### Native Chrome MP3 Encoding: Will Fail

- **WebCodecs `AudioEncoder`**: Supports Opus, AAC, FLAC, PCM, Vorbis. MP3 is decode-only
  (`AudioDecoder`). No MP3 encoding in WebCodecs.
- **`MediaRecorder` with `audio/mpeg`**: No browser ships MP3 via MediaRecorder. Supports
  `audio/webm;codecs=opus` and `audio/webm;codecs=pcm` only.

Native Chrome MP3 encoding does not exist and is not on any public roadmap.

### But: The Right Question Is Whether We Need MP3

The actual requirement is "compressed audio download for language learning." Two paths
to remove Shine:

**Path 1: Change output format (trace to root)**
Chrome natively encodes:
- Opus/WebM via `MediaRecorder` — excellent compression, plays on all modern devices
- AAC/M4A potentially available depending on platform

For language learning audio played on phones/computers, Opus or AAC works everywhere
that matters. MP3 is only needed for ancient devices. This path eliminates the codec
problem entirely — no encoder library needed at all.

Effort: Low-medium. Refactor `audio-encoder.js` to use `MediaRecorder` or `OfflineAudioContext`.
The speech-segment extraction + concatenation pipeline stays the same; only the final
encoding step changes.

**Path 2: Write minimal MP3 encoder in JS**
Our use case is narrow: CBR 128kbps, 44.1k/48k, mono/stereo, speech audio. A simplified
encoder without psychoacoustic modeling (fixed quantization) covers the need. The codec
is fully standardized with no ambiguity — the agent figures it out.

### Recommendation

Either path removes Shine. Owned code is always less complex than external code you
can't see through — the dependency itself is the complexity.

Try Path 1 first (zero encoder code). If MP3 is required, Path 2. Either way, Shine goes.

Spike should test:
1. `MediaRecorder` with Opus/WebM — can we encode an AudioBuffer to compressed blob?
2. File size vs MP3 at equivalent quality
3. Playback compatibility on target devices (phone, laptop)

## Decision Gate

| Spike Result | Next Phase |
|---|---|
| Opus/WebM viable | Phase 4A: Remove Shine, use native encoding |
| MP3 format required | Phase 4B: Remove Shine, write owned MP3 encoder |

Either way, Shine goes. Complexity is the agent's problem to solve, not a reason to
keep a dependency. Owned code is always less complex than external code you can't see
through — the dependency itself is the complexity.

## Phase 4A (Preferred): Remove Shine via Native Encoding

Remove:
- `lib/shine-mp3.js` (88K, 309 lines)
- `third_party/licenses/shine-LGPL-2.0.txt`

Update:
- `controls/audio-encoder.js` — rewrite to use MediaRecorder/native encoding
- `manifest.json` — remove shine script reference
- `package_project.sh` — remove from package list
- `THIRD_PARTY_NOTICES.md` — remove shine entry

Gate: benchmark + smoke + packaging pass, audio plays correctly.

## Phase 4B (If MP3 Required): Remove Shine via Owned Minimal MP3 Encoder

Write project-owned MPEG-1 Layer III encoder for exact use case:
- CBR 128kbps, 44.1k/48k sample rates, mono/stereo
- Input: Int16 PCM (same interface as Shine)
- API: `new Mp3Encoder(channels, sampleRate, bitRate)`, `.encodeBuffer()`, `.flush()`

Implementation scope: MDCT, fixed quantization (no psychoacoustic model needed for
speech), Huffman coding with standard tables, bitstream packing. Simplified by the
narrow parameter space — no VBR, no exotic sample rates, no joint stereo decisions.

Remove same files as 4A. Replace `lib/shine-mp3.js` with `lib/mp3-encoder.js` (owned).

Parity gates:
- Decode validity (valid MP3 frames, decodes without error)
- Duration drift <= current Shine drift
- Throughput >= current Shine throughput (or acceptable for use case)
- Manual audio quality check on speech content

## Phase 5: Repository Surface Sweep — Good

Remove non-essential tracked artifacts. Keep source + required packaged assets +
benchmark fixtures only.

## Phase 6: Recursive Audit Loop — Good

Two consecutive no-change passes over dependency surface, packaged file list, and
dead symbol scan. Stop when both pass clean.

---

## Current State for Reference

| Item | Size | Type | Status |
|---|---|---|---|
| `benchmarks/mp3/vendors/lamejs.min.js` | 156K | Benchmark-only vendor | Phase 1 removal |
| `node_modules/fake-indexeddb/` | 676K | devDependency | Phase 2 replacement |
| `lib/shine-mp3.js` | 88K | Runtime vendor (WASM) | Phase 3 spike → 4A or 4B, removed either way |
| npm dependencies | 1 devDep | package.json | Phase 2 → zero |

## Execution Order

1. Phase 0 — pin baseline
2. Phase 1 — remove lamejs vendor
3. Phase 2 — replace fake-indexeddb with in-tree shim → zero npm deps
4. Phase 3 — spike: native Opus/WebM vs owned MP3 encoder
5. Phase 4A or 4B — remove Shine either way
6. Phase 5-6 — sweep and audit

End state: zero external modules, zero npm dependencies, all code owned.
