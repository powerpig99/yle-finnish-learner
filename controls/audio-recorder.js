/**
 * Audio Recorder Module
 *
 * Records audio from video elements using continuous playback approach.
 * Plays video from start to end, records all audio, then extracts speech segments.
 * Uses Web Audio API with MediaElementSource for better compatibility with streaming players.
 */

/* global AudioFilters, AudioEncoder */

const AudioRecorder = {
  /**
   * Recording state
   */
  _state: {
    isRecording: false,
    isCancelled: false,
    originalVolume: 1,
    originalPlaybackRate: 1,
    originalCurrentTime: 0,
    wasPlaying: false,
    audioContext: null,
    mediaSource: null,
    isAudioContextConnected: false
  },

  /**
   * Check if browser supports required APIs
   * @returns {Object} - { supported: boolean, reason?: string }
   */
  checkSupport() {
    if (!window.AudioContext) {
      return { supported: false, reason: 'AudioContext not supported' };
    }
    if (!window.MediaRecorder) {
      return { supported: false, reason: 'MediaRecorder not supported' };
    }
    return { supported: true };
  },

  /**
   * Record audio continuously from video, then extract speech segments
   * @param {HTMLVideoElement} video - Video element to record from
   * @param {Array<{startTime: number, endTime: number, text: string}>} speechSegments - Segments to extract
   * @param {Object} callbacks - Callback functions
   * @param {function} callbacks.onProgress - Progress callback (currentTime, totalTime, percent, phase)
   * @param {function} callbacks.onComplete - Called when recording completes with AudioBuffer
   * @param {function} callbacks.onError - Called on error
   * @param {function} callbacks.onStatusChange - Called with status text updates
   * @returns {Promise<AudioBuffer>}
   */
  async recordFilteredAudio(video, speechSegments, callbacks = {}) {
    const { onProgress, onComplete, onError, onStatusChange } = callbacks;

    // Reset state
    this._state = {
      isRecording: true,
      isCancelled: false,
      originalVolume: video.volume,
      originalPlaybackRate: video.playbackRate,
      originalCurrentTime: video.currentTime,
      wasPlaying: !video.paused,
      audioContext: null,
      mediaSource: null,
      isAudioContextConnected: false
    };

    try {
      // Check support
      const support = this.checkSupport();
      if (!support.supported) {
        throw new Error(support.reason);
      }

      if (onStatusChange) onStatusChange('Initializing audio capture...');

      // Create audio context
      const audioContext = new window.AudioContext();
      this._state.audioContext = audioContext;

      // Resume audio context if suspended (required by some browsers)
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Try to set up audio capture
      let audioStream;
      try {
        audioStream = await this._setupAudioCapture(video, audioContext);
      } catch (captureError) {
        console.error('Audio capture setup failed:', captureError);
        throw new Error(
          'Cannot capture audio from this video. ' +
          'This may be due to DRM protection or cross-origin restrictions. ' +
          'Error: ' + captureError.message
        );
      }

      if (!audioStream) {
        throw new Error('Failed to create audio stream');
      }

      // Set playback rate to 1x for recording (ensures quality)
      video.playbackRate = 1;

      const totalDuration = video.duration;

      if (onStatusChange) onStatusChange('Recording audio...');

      // Record the entire video continuously
      const fullAudioBuffer = await this._recordContinuously(
        video,
        audioStream,
        audioContext,
        totalDuration,
        onProgress
      );

      if (this._state.isCancelled) {
        throw new Error('Recording cancelled by user');
      }

      if (!fullAudioBuffer) {
        throw new Error('No audio was recorded. The video may be DRM protected.');
      }

      // Check if the audio is silent (DRM protection)
      if (AudioEncoder.isSilent(fullAudioBuffer)) {
        throw new Error(
          'The recorded audio is silent. This video uses DRM protection that prevents audio capture. ' +
          'Try using screen recording software instead.'
        );
      }

      if (onStatusChange) onStatusChange('Extracting speech segments...');

      // Extract only the speech segments from the full recording
      const speechAudioBuffer = this._extractSpeechSegments(
        fullAudioBuffer,
        speechSegments,
        audioContext
      );

      if (!speechAudioBuffer || speechAudioBuffer.length === 0) {
        throw new Error('Failed to extract speech segments');
      }

      if (onComplete) onComplete(speechAudioBuffer);

      return speechAudioBuffer;

    } catch (error) {
      if (onError) onError(error);
      throw error;

    } finally {
      // Restore video state
      this._restoreVideoState(video);
      this._state.isRecording = false;
    }
  },

  /**
   * Set up audio capture from video element
   * Tries multiple methods for maximum compatibility
   * @param {HTMLVideoElement} video
   * @param {AudioContext} audioContext
   * @returns {Promise<MediaStream>}
   * @private
   */
  async _setupAudioCapture(video, audioContext) {
    // Method 1: Try captureStream first (less intrusive, doesn't alter audio routing)
    try {
      const captureStreamFn = video.captureStream;
      if (captureStreamFn) {
        const stream = captureStreamFn.call(video);
        const audioTracks = stream.getAudioTracks();

        if (audioTracks.length > 0) {
          console.info('Audio capture: Using captureStream');
          return new MediaStream(audioTracks);
        } else {
          console.warn('captureStream returned no audio tracks');
        }
      }
    } catch (e) {
      console.warn('captureStream failed:', e.message);
      // Don't throw yet - try createMediaElementSource as fallback
    }

    // Method 2: Try createMediaElementSource as fallback
    // Note: This method can only be called once per video element
    // and will route all audio through the Web Audio API
    try {
      // Only create source once - can't create multiple for same element
      if (!this._state.isAudioContextConnected) {
        console.info('Audio capture: Trying createMediaElementSource');

        const source = audioContext.createMediaElementSource(video);
        this._state.mediaSource = source;

        // Create a destination that we can record from
        const destination = audioContext.createMediaStreamDestination();

        // Connect: video -> destination (for recording)
        source.connect(destination);

        // Also connect to speakers so user can hear
        source.connect(audioContext.destination);

        this._state.isAudioContextConnected = true;

        return destination.stream;
      } else if (this._state.mediaSource) {
        // Already connected, create new destination
        const destination = audioContext.createMediaStreamDestination();
        this._state.mediaSource.connect(destination);
        return destination.stream;
      }
    } catch (e) {
      console.error('createMediaElementSource failed:', e.message);
      // This often fails due to CORS or DRM restrictions
    }

    throw new Error('No audio capture method available. The video may be DRM protected.');
  },

  /**
   * Record audio continuously from start to end
   * @param {HTMLVideoElement} video
   * @param {MediaStream} audioStream
   * @param {AudioContext} audioContext
   * @param {number} totalDuration
   * @param {function} onProgress
   * @returns {Promise<AudioBuffer>}
   * @private
   */
  async _recordContinuously(video, audioStream, audioContext, totalDuration, onProgress) {
    return new Promise((resolve, reject) => {
      // Seek to beginning
      video.currentTime = 0;

      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);

        // Setup recorder
        const mimeType = this._getSupportedMimeType();
        let mediaRecorder;

        try {
          mediaRecorder = new MediaRecorder(audioStream, {
            mimeType: mimeType
          });
        } catch (e) {
          console.error('MediaRecorder creation failed:', e);
          resolve(null);
          return;
        }

        const chunks = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        mediaRecorder.onstop = async () => {
          try {
            if (chunks.length === 0) {
              resolve(null);
              return;
            }

            const blob = new Blob(chunks, { type: mimeType });
            const arrayBuffer = await blob.arrayBuffer();

            // Clone the buffer for decoding (some browsers modify it)
            const bufferCopy = arrayBuffer.slice(0);

            try {
              const audioBuffer = await audioContext.decodeAudioData(bufferCopy);
              resolve(audioBuffer);
            } catch (decodeErr) {
              console.warn('Error decoding audio:', decodeErr);
              resolve(null);
            }
          } catch (err) {
            console.warn('Error processing audio:', err);
            resolve(null);
          }
        };

        mediaRecorder.onerror = (e) => {
          console.error('MediaRecorder error:', e);
          resolve(null);
        };

        // Start recording
        try {
          mediaRecorder.start(1000); // Collect data every second
        } catch (e) {
          console.error('Failed to start recording:', e);
          resolve(null);
          return;
        }

        // Play video
        const playPromise = video.play();

        if (playPromise) {
          playPromise.catch(err => {
            console.error('Video play failed:', err);
            if (mediaRecorder.state === 'recording') {
              mediaRecorder.stop();
            }
          });
        }

        // Monitor playback progress
        let lastUpdateTime = 0;
        const checkInterval = setInterval(() => {
          if (this._state.isCancelled) {
            clearInterval(checkInterval);
            if (mediaRecorder.state === 'recording') {
              mediaRecorder.stop();
            }
            video.pause();
            return;
          }

          const currentTime = video.currentTime;
          const percent = (currentTime / totalDuration) * 100;

          // Update progress (throttle to every 0.5 seconds)
          if (currentTime - lastUpdateTime >= 0.5 && onProgress) {
            lastUpdateTime = currentTime;
            onProgress(currentTime, totalDuration, percent, 'recording');
          }

          // Check if video ended
          if (video.ended || currentTime >= totalDuration - 0.1) {
            clearInterval(checkInterval);
            // Small delay to ensure all audio is captured
            setTimeout(() => {
              if (mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
              }
              video.pause();
            }, 500);
          } else if (video.paused && !this._state.isCancelled) {
            // Video paused unexpectedly, try to resume
            video.play().catch(() => {
              clearInterval(checkInterval);
              if (mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
              }
            });
          }
        }, 200);

        // Handle video ended event
        const onEnded = () => {
          video.removeEventListener('ended', onEnded);
          clearInterval(checkInterval);
          setTimeout(() => {
            if (mediaRecorder.state === 'recording') {
              mediaRecorder.stop();
            }
          }, 500);
        };
        video.addEventListener('ended', onEnded);

        // Safety timeout (video duration + buffer)
        setTimeout(() => {
          clearInterval(checkInterval);
          if (mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            video.pause();
          }
        }, (totalDuration + 10) * 1000);
      };

      // Handle seek error
      const onError = (e) => {
        video.removeEventListener('error', onError);
        video.removeEventListener('seeked', onSeeked);
        console.error('Video error during seek:', e);
        resolve(null);
      };

      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError);

      // Trigger seek if already at beginning
      if (video.currentTime < 0.1) {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        onSeeked();
      }
    });
  },

  /**
   * Extract speech segments from full audio buffer
   * @param {AudioBuffer} fullBuffer - Complete recorded audio
   * @param {Array<{startTime: number, endTime: number}>} segments - Speech segments
   * @param {AudioContext} audioContext
   * @returns {AudioBuffer}
   * @private
   */
  _extractSpeechSegments(fullBuffer, segments, audioContext) {
    if (!segments || segments.length === 0) {
      return fullBuffer;
    }

    const sampleRate = fullBuffer.sampleRate;
    const channels = fullBuffer.numberOfChannels;

    // Calculate total samples needed
    let totalSamples = 0;
    for (const seg of segments) {
      const startSample = Math.floor(seg.startTime * sampleRate);
      const endSample = Math.min(Math.floor(seg.endTime * sampleRate), fullBuffer.length);
      totalSamples += Math.max(0, endSample - startSample);
    }

    if (totalSamples === 0) {
      return fullBuffer;
    }

    // Create output buffer
    const outputBuffer = audioContext.createBuffer(channels, totalSamples, sampleRate);

    // Copy speech segments
    let outputOffset = 0;
    for (const seg of segments) {
      const startSample = Math.floor(seg.startTime * sampleRate);
      const endSample = Math.min(Math.floor(seg.endTime * sampleRate), fullBuffer.length);
      const segmentLength = Math.max(0, endSample - startSample);

      if (segmentLength > 0) {
        for (let channel = 0; channel < channels; channel++) {
          const inputData = fullBuffer.getChannelData(channel);
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
  },

  /**
   * Get supported MIME type for MediaRecorder
   * @returns {string}
   * @private
   */
  _getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4'
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return '';
  },

  /**
   * Cancel ongoing recording
   */
  cancel() {
    this._state.isCancelled = true;
  },

  /**
   * Check if currently recording
   * @returns {boolean}
   */
  isRecording() {
    return this._state.isRecording;
  },

  /**
   * Restore video to original state
   * @param {HTMLVideoElement} video
   * @private
   */
  _restoreVideoState(video) {
    try {
      video.volume = this._state.originalVolume;
      video.playbackRate = this._state.originalPlaybackRate;

      // Restore position
      video.currentTime = this._state.originalCurrentTime;

      // Pause to let user control playback
      video.pause();
    } catch (e) {
      console.warn('Error restoring video state:', e);
    }
  },

  /**
   * Clean up audio context and connections
   * Call this when done with recording
   */
  cleanup() {
    if (this._state.audioContext) {
      try {
        this._state.audioContext.close();
      } catch (e) {
        // Ignore
      }
      this._state.audioContext = null;
    }
    this._state.mediaSource = null;
    this._state.isAudioContextConnected = false;
  }
};

window.AudioRecorder = AudioRecorder;
