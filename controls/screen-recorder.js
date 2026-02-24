/**
 * Screen Recorder Module
 *
 * Records screen/tab with audio using getDisplayMedia.
 * Used for platforms with DRM protection (like YLE) where direct audio capture fails.
 * Records the entire playback and extracts speech segments in post-processing.
 */

const ScreenRecorder = {
  /**
   * Recording state
   */
  _state: {
    isRecording: false,
    mediaRecorder: null,
    mediaStream: null,
    chunks: [],
    startTime: 0
  },

  /**
   * Check if screen recording is supported
   * @returns {Object} - { supported: boolean, reason?: string }
   */
  checkSupport() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      return { supported: false, reason: 'Screen capture not supported in this browser' };
    }
    if (!window.MediaRecorder) {
      return { supported: false, reason: 'MediaRecorder not supported' };
    }
    return { supported: true };
  },

  /**
   * Start screen recording
   * @param {Object} options
   * @param {function} options.onProgress - Progress callback (currentTime, totalTime, percent, phase)
   * @param {function} options.onComplete - Called when recording completes with Blob
   * @param {function} options.onError - Called on error
   * @param {function} options.onStatusChange - Called with status text updates
   * @param {number} options.expectedDuration - Expected duration in seconds (for progress calculation)
   * @returns {Promise<void>}
   */
  async startRecording(options = {}) {
    const { onProgress, onComplete, onError, onStatusChange, expectedDuration } = options;

    // Reset state
    this._state = {
      isRecording: true,
      mediaRecorder: null,
      mediaStream: null,
      chunks: [],
      startTime: Date.now()
    };

    try {
      // Check support
      const support = this.checkSupport();
      if (!support.supported) {
        throw new Error(support.reason);
      }

      if (onStatusChange) onStatusChange('Requesting screen capture permission...');

      // Request screen capture with audio
      // preferCurrentTab hints to capture the current tab
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
          cursor: 'never'
        },
        audio: true,
        preferCurrentTab: true
      });

      this._state.mediaStream = stream;

      // Check if we got audio
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error(
          'No audio captured. Please make sure to select "Share tab audio" or "Share system audio" when prompted.'
        );
      }

      if (onStatusChange) onStatusChange('Recording screen and audio...');

      // Setup recorder
      const mimeType = this._getSupportedMimeType();
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        videoBitsPerSecond: 2500000, // 2.5 Mbps for reasonable quality
        audioBitsPerSecond: 128000   // 128 kbps audio
      });

      this._state.mediaRecorder = mediaRecorder;
      this._state.chunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this._state.chunks.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (onStatusChange) onStatusChange('Processing recording...');

        const blob = new Blob(this._state.chunks, { type: mimeType });
        this._cleanup();

        if (onComplete) onComplete(blob);
      };

      mediaRecorder.onerror = (e) => {
        console.error('ScreenRecorder: MediaRecorder error:', e);
        this._cleanup();
        if (onError) onError(new Error('Recording failed: ' + e.error?.message || 'Unknown error'));
      };

      // Handle stream ending (user stopped sharing)
      stream.getVideoTracks()[0].onended = () => {
        console.info('ScreenRecorder: User stopped sharing');
        if (this._state.isRecording && this._state.mediaRecorder?.state === 'recording') {
          this.stopRecording();
        }
      };

      // Start recording
      mediaRecorder.start(1000); // Collect data every second

      // Monitor progress
      this._startProgressMonitor(expectedDuration, onProgress);

    } catch (error) {
      this._cleanup();

      // Handle user cancellation
      if (error.name === 'NotAllowedError') {
        if (onError) onError(new Error('Screen capture was cancelled or denied.'));
      } else {
        if (onError) onError(error);
      }
    }
  },

  /**
   * Stop the current recording
   * @returns {Promise<void>}
   */
  stopRecording() {
    if (!this._state.isRecording) return;

    if (this._state.mediaRecorder && this._state.mediaRecorder.state === 'recording') {
      this._state.mediaRecorder.stop();
    }

    this._state.isRecording = false;
  },

  /**
   * Check if currently recording
   * @returns {boolean}
   */
  isRecording() {
    return this._state.isRecording;
  },

  /**
   * Start progress monitoring
   * @param {number} expectedDuration
   * @param {function} onProgress
   * @private
   */
  _startProgressMonitor(expectedDuration, onProgress) {
    if (!onProgress) return;

    const interval = setInterval(() => {
      if (!this._state.isRecording) {
        clearInterval(interval);
        return;
      }

      const elapsed = (Date.now() - this._state.startTime) / 1000;
      const percent = expectedDuration > 0 ? (elapsed / expectedDuration) * 100 : 0;

      onProgress(elapsed, expectedDuration || 0, Math.min(percent, 100), 'recording');
    }, 500);
  },

  /**
   * Get supported MIME type for video recording
   * @returns {string}
   * @private
   */
  _getSupportedMimeType() {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
      'video/mp4'
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return 'video/webm';
  },

  /**
   * Cleanup resources
   * @private
   */
  _cleanup() {
    // Stop all tracks
    if (this._state.mediaStream) {
      this._state.mediaStream.getTracks().forEach(track => track.stop());
      this._state.mediaStream = null;
    }

    this._state.mediaRecorder = null;
    this._state.isRecording = false;
  },

  /**
   * Extract audio from video blob and process for speech-only MP3
   * @param {Blob} videoBlob - Recorded video blob
   * @param {Array<{startTime: number, endTime: number}>} speechSegments - Speech segments to extract
   * @param {Object} callbacks
   * @param {function} callbacks.onProgress - Progress callback
   * @param {function} callbacks.onComplete - Called with MP3 blob
   * @param {function} callbacks.onError - Called on error
   * @returns {Promise<Blob>}
   */
  async extractSpeechAudio(videoBlob, speechSegments, callbacks = {}) {
    const { onProgress, onComplete, onError } = callbacks;

    try {
      if (onProgress) onProgress(0, 100, 0, 'extracting');

      // Create audio context
      const audioContext = new window.AudioContext();

      // Decode video blob to audio
      const arrayBuffer = await videoBlob.arrayBuffer();

      if (onProgress) onProgress(0, 100, 20, 'extracting');

      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      if (onProgress) onProgress(0, 100, 40, 'extracting');

      // Extract speech segments
      let finalBuffer;
      if (speechSegments && speechSegments.length > 0) {
        finalBuffer = this._extractSegments(audioBuffer, speechSegments, audioContext);
      } else {
        finalBuffer = audioBuffer;
      }

      if (onProgress) onProgress(0, 100, 60, 'encoding');

      // Encode to MP3
      const mp3Blob = await AudioEncoder.encodeToMP3(finalBuffer, {
        bitRate: 128,
        onProgress: (percent) => {
          if (onProgress) onProgress(0, 100, 60 + percent * 0.4, 'encoding');
        }
      });

      audioContext.close();

      if (onComplete) onComplete(mp3Blob);
      return mp3Blob;

    } catch (error) {
      console.error('ScreenRecorder: Audio extraction failed:', error);
      if (onError) onError(error);
      throw error;
    }
  },

  /**
   * Extract segments from audio buffer
   * @param {AudioBuffer} buffer
   * @param {Array<{startTime: number, endTime: number}>} segments
   * @param {AudioContext} audioContext
   * @returns {AudioBuffer}
   * @private
   */
  _extractSegments(buffer, segments, audioContext) {
    const sampleRate = buffer.sampleRate;
    const channels = buffer.numberOfChannels;

    // Calculate total samples needed
    let totalSamples = 0;
    for (const seg of segments) {
      const startSample = Math.floor(seg.startTime * sampleRate);
      const endSample = Math.min(Math.floor(seg.endTime * sampleRate), buffer.length);
      totalSamples += Math.max(0, endSample - startSample);
    }

    if (totalSamples === 0) {
      return buffer;
    }

    // Create output buffer
    const outputBuffer = audioContext.createBuffer(channels, totalSamples, sampleRate);

    // Copy segments
    let outputOffset = 0;
    for (const seg of segments) {
      const startSample = Math.floor(seg.startTime * sampleRate);
      const endSample = Math.min(Math.floor(seg.endTime * sampleRate), buffer.length);
      const segmentLength = Math.max(0, endSample - startSample);

      if (segmentLength > 0) {
        for (let channel = 0; channel < channels; channel++) {
          const inputData = buffer.getChannelData(channel);
          const outputData = outputBuffer.getChannelData(channel);

          for (let i = 0; i < segmentLength; i++) {
            if (startSample + i < inputData.length && outputOffset + i < outputData.length) {
              outputData[outputOffset + i] = inputData[startSample + i];
            }
          }
        }
        outputOffset += segmentLength;
      }
    }

    return outputBuffer;
  }
};

window.ScreenRecorder = ScreenRecorder;
