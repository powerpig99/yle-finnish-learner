/**
 * Audio Encoder Module
 *
 * Handles encoding audio data to MP3 format using lamejs library.
 * Used for the audio download feature.
 */

/* global lamejs */

const AudioEncoder = {
  /**
   * Default encoding options
   */
  DEFAULT_OPTIONS: {
    bitRate: 128,      // kbps
    sampleRate: 44100, // Hz
    channels: 2        // stereo
  },

  /**
   * Check if lamejs is available
   * @returns {boolean}
   */
  isAvailable() {
    return typeof lamejs !== 'undefined' && typeof lamejs.Mp3Encoder === 'function';
  },

  /**
   * Encode an AudioBuffer to MP3
   * @param {AudioBuffer} audioBuffer - The audio data to encode
   * @param {Object} [options] - Encoding options
   * @param {number} [options.bitRate=128] - Bitrate in kbps
   * @param {function} [onProgress] - Progress callback (0-1)
   * @returns {Promise<Blob>} - MP3 file as Blob
   */
  async encodeToMP3(audioBuffer, options = {}, onProgress = null) {
    if (!this.isAvailable()) {
      throw new Error('lamejs library not loaded');
    }

    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    const channels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;

    // Create encoder
    const mp3encoder = new lamejs.Mp3Encoder(
      channels === 1 ? 1 : 2,
      sampleRate,
      opts.bitRate
    );

    const mp3Data = [];
    const samplesPerFrame = 1152; // Standard MP3 frame size

    // Get audio data
    const leftChannel = audioBuffer.getChannelData(0);
    const rightChannel = channels > 1 ? audioBuffer.getChannelData(1) : leftChannel;

    // Convert Float32 to Int16
    const leftInt16 = this._floatTo16BitPCM(leftChannel);
    const rightInt16 = channels > 1 ? this._floatTo16BitPCM(rightChannel) : leftInt16;

    const totalSamples = leftInt16.length;
    let samplesProcessed = 0;

    // Process in chunks for progress reporting
    const chunkSize = samplesPerFrame * 100; // Process 100 frames at a time

    for (let i = 0; i < totalSamples; i += chunkSize) {
      const end = Math.min(i + chunkSize, totalSamples);

      // Process frames within this chunk
      for (let j = i; j < end; j += samplesPerFrame) {
        const frameEnd = Math.min(j + samplesPerFrame, totalSamples);
        const leftSamples = leftInt16.subarray(j, frameEnd);
        const rightSamples = rightInt16.subarray(j, frameEnd);

        let mp3buf;
        if (channels === 1) {
          mp3buf = mp3encoder.encodeBuffer(leftSamples);
        } else {
          mp3buf = mp3encoder.encodeBuffer(leftSamples, rightSamples);
        }

        if (mp3buf.length > 0) {
          mp3Data.push(mp3buf);
        }
      }

      samplesProcessed = end;

      // Report progress
      if (onProgress) {
        onProgress(samplesProcessed / totalSamples);
      }

      // Yield to main thread periodically
      if (i + chunkSize < totalSamples) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Flush remaining data
    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }

    if (onProgress) {
      onProgress(1);
    }

    // Create blob from all chunks
    return new Blob(mp3Data, { type: 'audio/mp3' });
  },

  /**
   * Encode raw PCM data (Int16Array) to MP3
   * @param {Int16Array} leftChannel - Left channel data
   * @param {Int16Array} [rightChannel] - Right channel data (optional)
   * @param {number} sampleRate - Sample rate in Hz
   * @param {Object} [options] - Encoding options
   * @returns {Promise<Blob>} - MP3 file as Blob
   */
  async encodePCMToMP3(leftChannel, rightChannel, sampleRate, options = {}) {
    if (!this.isAvailable()) {
      throw new Error('lamejs library not loaded');
    }

    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    const channels = rightChannel ? 2 : 1;

    const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, opts.bitRate);
    const mp3Data = [];
    const samplesPerFrame = 1152;

    for (let i = 0; i < leftChannel.length; i += samplesPerFrame) {
      const end = Math.min(i + samplesPerFrame, leftChannel.length);
      const leftSamples = leftChannel.subarray(i, end);

      let mp3buf;
      if (channels === 1) {
        mp3buf = mp3encoder.encodeBuffer(leftSamples);
      } else {
        const rightSamples = rightChannel.subarray(i, end);
        mp3buf = mp3encoder.encodeBuffer(leftSamples, rightSamples);
      }

      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }
    }

    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }

    return new Blob(mp3Data, { type: 'audio/mp3' });
  },

  /**
   * Convert Float32Array to Int16Array for encoding
   * @param {Float32Array} floatSamples - Floating point audio samples (-1 to 1)
   * @returns {Int16Array} - 16-bit PCM samples
   * @private
   */
  _floatTo16BitPCM(floatSamples) {
    const int16 = new Int16Array(floatSamples.length);

    for (let i = 0; i < floatSamples.length; i++) {
      // Clamp to valid range
      let s = Math.max(-1, Math.min(1, floatSamples[i]));
      // Convert to 16-bit integer
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    return int16;
  },

  /**
   * Create an AudioBuffer from multiple chunks
   * @param {AudioContext} audioContext - Audio context for creating buffer
   * @param {Array<AudioBuffer>} chunks - Array of audio buffers to concatenate
   * @returns {AudioBuffer} - Combined audio buffer
   */
  concatenateAudioBuffers(audioContext, chunks) {
    if (!chunks || chunks.length === 0) {
      throw new Error('No audio chunks to concatenate');
    }

    const channels = chunks[0].numberOfChannels;
    const sampleRate = chunks[0].sampleRate;

    // Calculate total length
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

    // Create output buffer
    const outputBuffer = audioContext.createBuffer(channels, totalLength, sampleRate);

    // Copy data
    let offset = 0;
    for (const chunk of chunks) {
      for (let channel = 0; channel < channels; channel++) {
        const outputData = outputBuffer.getChannelData(channel);
        const inputData = chunk.getChannelData(channel);
        outputData.set(inputData, offset);
      }
      offset += chunk.length;
    }

    return outputBuffer;
  },

  /**
   * Check if an AudioBuffer is silent (all zeros or near-zero values)
   * Used to detect DRM-protected audio that records as silence
   * @param {AudioBuffer} audioBuffer - The audio buffer to check
   * @param {number} [threshold=0.001] - Maximum amplitude to consider as silence
   * @returns {boolean} - True if the audio is silent
   */
  isSilent(audioBuffer, threshold = 0.001) {
    if (!audioBuffer || audioBuffer.length === 0) {
      return true;
    }

    // Check a sample of the audio data (checking every sample would be slow)
    const sampleSize = Math.min(audioBuffer.length, 44100 * 5); // Check up to 5 seconds
    const step = Math.max(1, Math.floor(audioBuffer.length / sampleSize));

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const data = audioBuffer.getChannelData(channel);

      for (let i = 0; i < data.length; i += step) {
        if (Math.abs(data[i]) > threshold) {
          return false; // Found non-silent audio
        }
      }
    }

    return true; // All samples were below threshold
  },

  /**
   * Get the peak amplitude of an AudioBuffer
   * @param {AudioBuffer} audioBuffer
   * @returns {number} - Peak amplitude (0-1)
   */
  getPeakAmplitude(audioBuffer) {
    if (!audioBuffer || audioBuffer.length === 0) {
      return 0;
    }

    let peak = 0;
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const data = audioBuffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) {
          peak = abs;
        }
      }
    }

    return peak;
  },

  /**
   * Get file size estimate for MP3 encoding
   * @param {number} durationSeconds - Duration in seconds
   * @param {number} [bitRate=128] - Bitrate in kbps
   * @returns {string} - Formatted file size estimate
   */
  estimateFileSize(durationSeconds, bitRate = 128) {
    // Formula: (bitrate * duration) / 8 = bytes
    const bytes = (bitRate * 1000 * durationSeconds) / 8;

    if (bytes < 1024) {
      return `${bytes} B`;
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    } else {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
  }
};

window.AudioEncoder = AudioEncoder;
