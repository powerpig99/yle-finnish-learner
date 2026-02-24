(function benchmarkMain() {
  'use strict';

  const GATE = {
    minThroughputX: 0.75,
    maxDurationDriftPct: 1.0,
    maxSizeRatioToPcm: 0.6
  };

  const FIXTURE_DEFS = [
    { id: 'sine-44100-stereo-8s', type: 'sine', sampleRate: 44100, channels: 2, durationSec: 8 },
    { id: 'chirp-48000-mono-8s', type: 'chirp', sampleRate: 48000, channels: 1, durationSec: 8 },
    { id: 'noise-44100-stereo-12s', type: 'noise', sampleRate: 44100, channels: 2, durationSec: 12 },
    { id: 'speech-mono-44100', type: 'wav', path: './fixtures/speech-mono-44100.wav' },
    { id: 'speech-stereo-48000', type: 'wav', path: './fixtures/speech-stereo-48000.wav' }
  ];

  const runButton = document.getElementById('run-btn');
  const copyButton = document.getElementById('copy-btn');
  const statusEl = document.getElementById('status');
  const resultEl = document.getElementById('result');
  let latestJson = '';

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function readHeap() {
    if (performance && performance.memory && typeof performance.memory.usedJSHeapSize === 'number') {
      return performance.memory.usedJSHeapSize;
    }
    return null;
  }

  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes.buffer.slice(0));
    const arr = new Uint8Array(digest);
    let out = '';
    for (let i = 0; i < arr.length; i++) {
      out += arr[i].toString(16).padStart(2, '0');
    }
    return out;
  }

  function createSyntheticBuffer(ctx, def) {
    const length = Math.floor(def.sampleRate * def.durationSec);
    const buffer = ctx.createBuffer(def.channels, length, def.sampleRate);
    const twoPi = Math.PI * 2;

    for (let ch = 0; ch < def.channels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / def.sampleRate;
        let sample = 0;
        if (def.type === 'sine') {
          sample = Math.sin(twoPi * 220 * t) * 0.45 + Math.sin(twoPi * 440 * t) * 0.2;
        } else if (def.type === 'chirp') {
          const f = 180 + 1800 * (t / def.durationSec);
          sample = Math.sin(twoPi * f * t) * 0.5;
        } else if (def.type === 'noise') {
          const seed = (i * 1103515245 + (ch + 1) * 12345) & 0x7fffffff;
          sample = ((seed / 0x7fffffff) * 2 - 1) * 0.3;
        }
        data[i] = sample;
      }
    }

    return buffer;
  }

  function parseWavPcm16(arrayBuffer) {
    const view = new DataView(arrayBuffer);

    function readAscii(offset, length) {
      let out = '';
      for (let i = 0; i < length; i++) {
        out += String.fromCharCode(view.getUint8(offset + i));
      }
      return out;
    }

    if (readAscii(0, 4) !== 'RIFF' || readAscii(8, 4) !== 'WAVE') {
      throw new Error('Unsupported WAV header');
    }

    let offset = 12;
    let fmt = null;
    let dataOffset = -1;
    let dataSize = 0;

    while (offset + 8 <= view.byteLength) {
      const chunkId = readAscii(offset, 4);
      const chunkSize = view.getUint32(offset + 4, true);
      const chunkDataOffset = offset + 8;

      if (chunkId === 'fmt ') {
        fmt = {
          audioFormat: view.getUint16(chunkDataOffset, true),
          channels: view.getUint16(chunkDataOffset + 2, true),
          sampleRate: view.getUint32(chunkDataOffset + 4, true),
          bitsPerSample: view.getUint16(chunkDataOffset + 14, true)
        };
      } else if (chunkId === 'data') {
        dataOffset = chunkDataOffset;
        dataSize = chunkSize;
      }

      offset = chunkDataOffset + chunkSize + (chunkSize % 2);
    }

    if (!fmt || dataOffset < 0) {
      throw new Error('WAV missing fmt/data chunk');
    }
    if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
      throw new Error(`Unsupported WAV format: audioFormat=${fmt.audioFormat}, bits=${fmt.bitsPerSample}`);
    }

    const sampleCount = dataSize / (fmt.channels * 2);
    const channels = new Array(fmt.channels);
    for (let ch = 0; ch < fmt.channels; ch++) {
      channels[ch] = new Float32Array(sampleCount);
    }

    let p = dataOffset;
    for (let i = 0; i < sampleCount; i++) {
      for (let ch = 0; ch < fmt.channels; ch++) {
        channels[ch][i] = view.getInt16(p, true) / 32768;
        p += 2;
      }
    }

    return {
      sampleRate: fmt.sampleRate,
      channels
    };
  }

  async function decodeWavFixture(ctx, path) {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to fetch fixture: ${path} (${response.status})`);
    }
    const parsed = parseWavPcm16(await response.arrayBuffer());
    const length = parsed.channels[0].length;
    const buffer = ctx.createBuffer(parsed.channels.length, length, parsed.sampleRate);
    for (let ch = 0; ch < parsed.channels.length; ch++) {
      buffer.copyToChannel(parsed.channels[ch], ch);
    }
    return buffer;
  }

  async function loadFixtures(ctx) {
    const fixtures = [];
    for (const def of FIXTURE_DEFS) {
      if (def.type === 'wav') {
        fixtures.push({ id: def.id, buffer: await decodeWavFixture(ctx, def.path) });
      } else {
        fixtures.push({ id: def.id, buffer: createSyntheticBuffer(ctx, def) });
      }
    }
    return fixtures;
  }

  function parseFirstMpegAudioFrame(bytes) {
    const bitrateTableMpeg1L3 = [
      0, 32, 40, 48, 56, 64, 80, 96,
      112, 128, 160, 192, 224, 256, 320, 0
    ];
    const sampleRateTableMpeg1 = [44100, 48000, 32000, 0];
    const channelModes = ['stereo', 'joint_stereo', 'dual_channel', 'mono'];

    for (let i = 0; i + 4 < bytes.length; i++) {
      if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;

      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      const versionId = (b1 >> 3) & 0x03;
      const layerBits = (b1 >> 1) & 0x03;
      const bitrateIndex = (b2 >> 4) & 0x0f;
      const sampleRateIndex = (b2 >> 2) & 0x03;
      const padding = (b2 >> 1) & 0x01;
      const channelModeBits = (bytes[i + 3] >> 6) & 0x03;

      // Encoder target is MPEG-1 Layer III only.
      if (versionId !== 0x03 || layerBits !== 0x01) continue;

      const bitrateKbps = bitrateTableMpeg1L3[bitrateIndex];
      const sampleRate = sampleRateTableMpeg1[sampleRateIndex];
      if (!bitrateKbps || !sampleRate) continue;

      const frameSize = Math.floor((144000 * bitrateKbps) / sampleRate + padding);
      return {
        found: true,
        offset: i,
        mpegVersion: 1,
        layer: 'layer3',
        bitrateKbps,
        sampleRate,
        padding,
        channelMode: channelModes[channelModeBits],
        frameSize
      };
    }

    return { found: false };
  }

  async function decodeAudioBytes(ctx, bytes) {
    try {
      const decoded = await Promise.race([
        ctx.decodeAudioData(bytes.buffer.slice(0)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('decode timeout')), 20000))
      ]);
      return {
        success: true,
        durationSec: decoded.duration
      };
    } catch (error) {
      return {
        success: false,
        error: String(error)
      };
    }
  }

  async function encodeWithRuntimeEncoder(audioBuffer, onProgress) {
    if (!window.DSCAudioEncoder || typeof window.DSCAudioEncoder.encodeToMP3 !== 'function') {
      throw new Error('DSCAudioEncoder is not available');
    }

    return window.DSCAudioEncoder.encodeToMP3(audioBuffer, onProgress);
  }

  function evaluateFixtureGate(run) {
    const failures = [];
    const metrics = run.metrics;
    const validity = run.validity;
    const input = run.input;
    const rawPcmBytes = input.durationSec * input.sampleRate * input.channels * 2;
    const sizeRatioToPcm = rawPcmBytes > 0 ? metrics.outputBytes / rawPcmBytes : Infinity;

    if (!validity.decode.success) {
      failures.push('decode_failure');
    }

    if (!validity.frame || !validity.frame.found) {
      failures.push('frame_not_found');
    } else {
      if (validity.frame.layer !== 'layer3' || validity.frame.mpegVersion !== 1) {
        failures.push('unexpected_mpeg_layer_or_version');
      }
      if (validity.frame.bitrateKbps !== 128) {
        failures.push(`unexpected_bitrate(${validity.frame.bitrateKbps})`);
      }
      if (validity.frame.sampleRate !== input.sampleRate) {
        failures.push(`unexpected_samplerate(${validity.frame.sampleRate} != ${input.sampleRate})`);
      }
    }

    if (metrics.throughputX < GATE.minThroughputX) {
      failures.push(`throughput_too_slow(${metrics.throughputX.toFixed(3)}x < ${GATE.minThroughputX}x)`);
    }

    if (validity.durationDriftPct !== null && validity.durationDriftPct > GATE.maxDurationDriftPct) {
      failures.push(`duration_drift(${validity.durationDriftPct.toFixed(3)}% > ${GATE.maxDurationDriftPct}%)`);
    }

    if (sizeRatioToPcm > GATE.maxSizeRatioToPcm) {
      failures.push(`output_size_ratio(${sizeRatioToPcm.toFixed(3)} > ${GATE.maxSizeRatioToPcm})`);
    }

    return {
      pass: failures.length === 0,
      failures,
      summary: {
        elapsedMs: metrics.elapsedMs,
        throughputX: metrics.throughputX,
        outputBytes: metrics.outputBytes,
        outputMimeType: metrics.outputMimeType,
        frame: validity.frame,
        durationDriftPct: validity.durationDriftPct,
        sizeRatioToPcm
      }
    };
  }

  async function runCase(ctx, fixture) {
    let peakHeap = readHeap();
    const heapBefore = peakHeap;
    const perfStart = performance.now();
    const wallStart = Date.now();

    const blob = await encodeWithRuntimeEncoder(fixture.buffer, function onProgress() {
      const heap = readHeap();
      if (heap !== null && (peakHeap === null || heap > peakHeap)) {
        peakHeap = heap;
      }
    });

    const perfEnd = performance.now();
    const wallEnd = Date.now();
    const elapsedMs = Math.max(perfEnd - perfStart, wallEnd - wallStart, 0.001);
    const inputDurationSec = fixture.buffer.duration;
    const throughputX = inputDurationSec / (elapsedMs / 1000);
    const outputBytes = blob.size;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const outputSha256 = await sha256Hex(bytes);
    const frame = parseFirstMpegAudioFrame(bytes);
    const decoded = await decodeAudioBytes(ctx, bytes);
    const durationDriftPct = decoded.success
      ? Math.abs((decoded.durationSec - inputDurationSec) / inputDurationSec) * 100
      : null;
    const heapAfter = readHeap();
    const heapDelta = heapAfter !== null && heapBefore !== null ? (heapAfter - heapBefore) : null;
    const peakHeapDelta = peakHeap !== null && heapBefore !== null ? (peakHeap - heapBefore) : null;

    return {
      fixtureId: fixture.id,
      input: {
        durationSec: inputDurationSec,
        sampleRate: fixture.buffer.sampleRate,
        channels: fixture.buffer.numberOfChannels
      },
      metrics: {
        elapsedMs,
        throughputX,
        outputBytes,
        outputSha256,
        outputMimeType: blob.type || 'application/octet-stream',
        heapBefore,
        heapAfter,
        heapDelta,
        peakHeapDelta
      },
      validity: {
        frame,
        decode: decoded,
        durationDriftPct
      }
    };
  }

  async function runBenchmark() {
    if (!window.AudioContext) {
      throw new Error('AudioContext is not available in this browser context');
    }

    const ctx = new AudioContext();
    setStatus('Loading fixtures...');
    const fixtures = await loadFixtures(ctx);
    const runs = [];
    const gate = [];

    for (const fixture of fixtures) {
      setStatus(`Running ${fixture.id}...`);
      const run = await runCase(ctx, fixture);
      runs.push(run);
      gate.push({
        fixtureId: fixture.id,
        ...evaluateFixtureGate(run)
      });
    }

    await ctx.close();

    const overallPass = gate.every((entry) => entry.pass);
    return {
      meta: {
        generatedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        criteria: GATE,
        overallPass
      },
      runs,
      gate
    };
  }

  async function execute() {
    runButton.disabled = true;
    copyButton.disabled = true;
    resultEl.textContent = '';
    setStatus('Starting benchmark...');

    try {
      const report = await runBenchmark();
      latestJson = JSON.stringify(report, null, 2);
      resultEl.textContent = latestJson;
      setStatus(report.meta.overallPass ? 'PASS: all gate checks passed' : 'FAIL: one or more gate checks failed');
      copyButton.disabled = false;
      document.title = report.meta.overallPass ? 'Audio Benchmark PASS' : 'Audio Benchmark FAIL';
    } catch (error) {
      const message = `Benchmark failed: ${String(error)}`;
      setStatus(message);
      resultEl.textContent = message;
      document.title = 'Audio Benchmark ERROR';
    } finally {
      runButton.disabled = false;
    }
  }

  runButton.addEventListener('click', execute);
  copyButton.addEventListener('click', async function copyResult() {
    if (!latestJson) return;
    try {
      await navigator.clipboard.writeText(latestJson);
      setStatus('Copied benchmark JSON to clipboard.');
    } catch (_error) {
      setStatus('Clipboard copy failed. Copy from the result box manually.');
    }
  });

  const params = new URLSearchParams(window.location.search);
  if (params.get('auto') === '1') {
    execute();
  }
})();
