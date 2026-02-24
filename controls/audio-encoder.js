/**
 * Audio Encoder Module
 *
 * Handles encoding audio data to MP3 format using lamejs library.
 * Used for the audio download feature.
 */

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
  }
};

window.AudioEncoder = AudioEncoder;
