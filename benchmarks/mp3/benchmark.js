(function benchmarkMain() {
  'use strict';

  const GATE = {
    maxDurationDriftDeltaPct: 0.05,
    maxSizeDeltaPct: 1.0,
    maxMemoryRatio: 1.5
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

  function floatToPcm16(value) {
    let v = value;
    if (v > 1) v = 1;
    if (v < -1) v = -1;
    return v < 0 ? v * 0x8000 : v * 0x7fff;
  }

  function floatArrayToInt16(floatSamples) {
    const int16 = new Int16Array(floatSamples.length);
    for (let i = 0; i < floatSamples.length; i++) {
      int16[i] = floatToPcm16(floatSamples[i]);
    }
    return int16;
  }

  async function encodeWithBackend(audioBuffer, backend, bitRate, onProgress) {
    let Encoder = null;
    if (backend === 'shine') {
      if (!window.shineLamejs || !window.shineLamejs.Mp3Encoder) {
        throw new Error('shine backend not available');
      }
      if (window.shineLamejs.initialized && typeof window.shineLamejs.initialized.then === 'function') {
        await window.shineLamejs.initialized;
      }
      Encoder = window.shineLamejs.Mp3Encoder;
    } else if (backend === 'lamejs') {
      if (!window.lamejs || !window.lamejs.Mp3Encoder) {
        throw new Error('lamejs backend not available');
      }
      Encoder = window.lamejs.Mp3Encoder;
    } else {
      throw new Error(`Unsupported backend: ${backend}`);
    }

    const channels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const encoderChannels = channels === 1 ? 1 : 2;
    const mp3encoder = new Encoder(encoderChannels, sampleRate, bitRate);

    const mp3Data = [];
    const samplesPerFrame = 1152;
    const chunkSize = samplesPerFrame * 100;
    const leftChannel = audioBuffer.getChannelData(0);
    const rightChannel = channels > 1 ? audioBuffer.getChannelData(1) : leftChannel;
    const leftInt16 = floatArrayToInt16(leftChannel);
    const rightInt16 = channels > 1 ? floatArrayToInt16(rightChannel) : leftInt16;
    const totalSamples = leftInt16.length;

    for (let i = 0; i < totalSamples; i += chunkSize) {
      const end = Math.min(i + chunkSize, totalSamples);

      for (let j = i; j < end; j += samplesPerFrame) {
        const frameEnd = Math.min(j + samplesPerFrame, totalSamples);
        const leftSamples = leftInt16.subarray(j, frameEnd);
        const rightSamples = rightInt16.subarray(j, frameEnd);
        const mp3buf = channels === 1
          ? mp3encoder.encodeBuffer(leftSamples)
          : mp3encoder.encodeBuffer(leftSamples, rightSamples);
        if (mp3buf.length > 0) {
          mp3Data.push(mp3buf);
        }
      }

      if (onProgress) {
        onProgress(end / totalSamples);
      }

      if (i + chunkSize < totalSamples) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    const flushBuf = mp3encoder.flush();
    if (flushBuf.length > 0) {
      mp3Data.push(flushBuf);
    }

    if (onProgress) {
      onProgress(1);
    }

    return new Blob(mp3Data, { type: 'audio/mp3' });
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
          // Deterministic pseudo-noise (LCG).
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
        const s = view.getInt16(p, true);
        channels[ch][i] = s / 32768;
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
    const arrayBuffer = await response.arrayBuffer();
    const parsed = parseWavPcm16(arrayBuffer);
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
        const buffer = await decodeWavFixture(ctx, def.path);
        fixtures.push({ id: def.id, buffer });
      } else {
        fixtures.push({ id: def.id, buffer: createSyntheticBuffer(ctx, def) });
      }
    }
    return fixtures;
  }

  function parseFirstMp3Frame(bytes) {
    const bitrateTableMpeg1L3 = [
      0, 32, 40, 48, 56, 64, 80, 96,
      112, 128, 160, 192, 224, 256, 320, 0
    ];
    const sampleRateTableMpeg1 = [44100, 48000, 32000, 0];

    for (let i = 0; i + 4 < bytes.length; i++) {
      if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;

      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      const versionId = (b1 >> 3) & 0x03;
      const layer = (b1 >> 1) & 0x03;
      const bitrateIndex = (b2 >> 4) & 0x0f;
      const sampleRateIndex = (b2 >> 2) & 0x03;
      const padding = (b2 >> 1) & 0x01;

      if (versionId !== 0x03 || layer !== 0x01) continue; // Expect MPEG1 Layer III
      const bitrateKbps = bitrateTableMpeg1L3[bitrateIndex];
      const sampleRate = sampleRateTableMpeg1[sampleRateIndex];
      if (!bitrateKbps || !sampleRate) continue;

      const frameSize = Math.floor((144000 * bitrateKbps) / sampleRate + padding);
      return {
        found: true,
        offset: i,
        bitrateKbps,
        sampleRate,
        frameSize
      };
    }
    return { found: false };
  }

  async function decodeMp3(ctx, mp3Bytes) {
    try {
      const decodePromise = ctx.decodeAudioData(mp3Bytes.buffer.slice(0));
      const decoded = await Promise.race([
        decodePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('decode timeout')), 15000))
      ]);
      return { success: true, durationSec: decoded.duration };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async function runCase(ctx, backend, fixture) {
    let peakHeap = readHeap();
    const heapBefore = peakHeap;
    const perfStart = performance.now();
    const wallStart = Date.now();

    const mp3Blob = await encodeWithBackend(fixture.buffer, backend, 128, function onProgress() {
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
    const outputBytes = mp3Blob.size;
    const bytes = new Uint8Array(await mp3Blob.arrayBuffer());
    const frame = parseFirstMp3Frame(bytes);
    const decoded = await decodeMp3(ctx, bytes);
    const durationDriftPct = decoded.success
      ? Math.abs((decoded.durationSec - inputDurationSec) / inputDurationSec) * 100
      : null;
    const heapAfter = readHeap();
    const heapDelta = heapAfter !== null && heapBefore !== null ? (heapAfter - heapBefore) : null;
    const peakHeapDelta = peakHeap !== null && heapBefore !== null ? (peakHeap - heapBefore) : null;

    return {
      backend,
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

  function evaluateFixtureGate(lame, shine) {
    const failures = [];
    const shineMetrics = shine.metrics;
    const lameMetrics = lame.metrics;
    const shineValidity = shine.validity;

    if (shineMetrics.elapsedMs > lameMetrics.elapsedMs) {
      failures.push(`throughput_regression(${shineMetrics.elapsedMs.toFixed(2)}ms > ${lameMetrics.elapsedMs.toFixed(2)}ms)`);
    }

    if (shineMetrics.peakHeapDelta !== null && lameMetrics.peakHeapDelta !== null) {
      const memoryRatio = lameMetrics.peakHeapDelta === 0
        ? (shineMetrics.peakHeapDelta === 0 ? 1 : Infinity)
        : shineMetrics.peakHeapDelta / lameMetrics.peakHeapDelta;
      if (memoryRatio > GATE.maxMemoryRatio) {
        failures.push(`memory_ratio(${memoryRatio.toFixed(3)} > ${GATE.maxMemoryRatio})`);
      }
    }

    const sizeDeltaPct = lameMetrics.outputBytes === 0
      ? Infinity
      : Math.abs((shineMetrics.outputBytes - lameMetrics.outputBytes) / lameMetrics.outputBytes) * 100;
    if (sizeDeltaPct > GATE.maxSizeDeltaPct) {
      failures.push(`output_size_delta(${sizeDeltaPct.toFixed(3)}% > ${GATE.maxSizeDeltaPct}%)`);
    }

    if (!lame.validity.decode.success) {
      failures.push('baseline_decode_failure');
    }

    if (!shineValidity.decode.success) {
      failures.push('decode_failure');
    }

    const shineDurationDriftPct = shineValidity.durationDriftPct;
    const lameDurationDriftPct = lame.validity.durationDriftPct;
    const allowedDriftPct = lameDurationDriftPct === null
      ? null
      : lameDurationDriftPct + GATE.maxDurationDriftDeltaPct;
    if (shineDurationDriftPct !== null && lameDurationDriftPct !== null) {
      if (shineDurationDriftPct > allowedDriftPct) {
        failures.push(`duration_drift_regression(${shineDurationDriftPct.toFixed(4)}% > ${allowedDriftPct.toFixed(4)}%)`);
      }
    }

    if (!shineValidity.frame.found) {
      failures.push('frame_not_found');
    } else {
      if (shineValidity.frame.bitrateKbps !== 128) {
        failures.push(`unexpected_bitrate(${shineValidity.frame.bitrateKbps})`);
      }
      if (shineValidity.frame.sampleRate !== shine.input.sampleRate) {
        failures.push(`unexpected_samplerate(${shineValidity.frame.sampleRate} != ${shine.input.sampleRate})`);
      }
    }

    return {
      pass: failures.length === 0,
      failures,
      summary: {
        elapsedMsLame: lameMetrics.elapsedMs,
        elapsedMsShine: shineMetrics.elapsedMs,
        throughputXLame: lameMetrics.throughputX,
        throughputXShine: shineMetrics.throughputX,
        outputBytesLame: lameMetrics.outputBytes,
        outputBytesShine: shineMetrics.outputBytes,
        durationDriftPctAllowed: allowedDriftPct,
        durationDriftPctLame: lameDurationDriftPct,
        durationDriftPctShine: shineDurationDriftPct
      }
    };
  }

  async function runBenchmark() {
    if (!window.AudioContext) {
      throw new Error('AudioContext is not available in this browser context');
    }

    if (!window.lamejs || !window.lamejs.Mp3Encoder) {
      throw new Error('lamejs backend not available');
    }

    if (!window.shineLamejs || !window.shineLamejs.initialized) {
      throw new Error('shine backend not available');
    }

    setStatus('Initializing shine backend...');
    await window.shineLamejs.initialized;

    const ctx = new AudioContext();
    setStatus('Loading fixtures...');
    const fixtures = await loadFixtures(ctx);
    const runs = [];
    const gate = [];

    for (const fixture of fixtures) {
      setStatus(`Running ${fixture.id} [lamejs]...`);
      const lame = await runCase(ctx, 'lamejs', fixture);
      runs.push(lame);

      setStatus(`Running ${fixture.id} [shine]...`);
      const shine = await runCase(ctx, 'shine', fixture);
      runs.push(shine);

      gate.push({
        fixtureId: fixture.id,
        ...evaluateFixtureGate(lame, shine)
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
      document.title = report.meta.overallPass ? 'MP3 Benchmark PASS' : 'MP3 Benchmark FAIL';
    } catch (error) {
      const message = `Benchmark failed: ${String(error)}`;
      setStatus(message);
      resultEl.textContent = message;
      document.title = 'MP3 Benchmark ERROR';
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
