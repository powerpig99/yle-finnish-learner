/**
 * Control Actions Module
 *
 * Action handlers for the YLE Areena control panel.
 */

const ControlActions = {
  /**
   * Get the current video element
   * @returns {HTMLVideoElement|null}
   */
  getVideoElement() {
    return document.querySelector('video');
  },

  /**
   * Skip-debug toggle.
   * Enable with:
   *   window.__DSC_DEBUG_SKIP = true
   * or
   *   localStorage.setItem('dsc.debug.skip', '1')
   * @returns {boolean}
   */
  isSkipDebugEnabled() {
    try {
      if (typeof window === 'undefined') return false;
      return window.__DSC_DEBUG_SKIP === true || window.localStorage?.getItem('dsc.debug.skip') === '1';
    } catch (_error) {
      return false;
    }
  },

  /**
   * Emit debug logs for subtitle navigation when enabled.
   * @param {string} message
   * @param {Object} data
   */
  logSkipDebug(message, data = {}) {
    if (!this.isSkipDebugEnabled()) return;
    console.info(`[DualSubExtension][skip-debug] ${message}`, data);
  },

  /**
   * Build sorted, de-duplicated subtitle start times for navigation.
   * Uses active text-track cues only (single source of truth).
   * @param {HTMLVideoElement} video
   * @returns {number[]}
   */
  getNavigationStartTimes(video) {
    const EPSILON = 0.001;
    const cueTimes = [];
    const trackSummaries = [];

    if (video && video.textTracks && video.textTracks.length > 0) {
      for (const track of Array.from(video.textTracks)) {
        if (!track) continue;
        const cues = track.cues;
        trackSummaries.push({
          language: track.language || '',
          label: track.label || '',
          mode: track.mode,
          cuesCount: cues ? cues.length : 0
        });
        if (track.mode === 'disabled') continue;
        if (!cues || cues.length === 0) continue;

        for (let i = 0; i < cues.length; i++) {
          const cue = cues[i];
          if (typeof cue.startTime === 'number' && Number.isFinite(cue.startTime)) {
            cueTimes.push(cue.startTime);
          }
        }
      }
    }

    if (cueTimes.length === 0) {
      this.logSkipDebug('no cues available for navigation', {
        currentTime: typeof video?.currentTime === 'number' ? video.currentTime : null,
        tracks: trackSummaries
      });
      return [];
    }

    cueTimes.sort((a, b) => a - b);

    const uniqueTimes = [cueTimes[0]];
    for (let i = 1; i < cueTimes.length; i++) {
      const time = cueTimes[i];
      if (time > uniqueTimes[uniqueTimes.length - 1] + EPSILON) {
        uniqueTimes.push(time);
      }
    }

    this.logSkipDebug('built navigation cue timeline', {
      currentTime: typeof video?.currentTime === 'number' ? video.currentTime : null,
      rawCueStartCount: cueTimes.length,
      uniqueCueStartCount: uniqueTimes.length,
      tracks: trackSummaries
    });

    return uniqueTimes;
  },

  /**
   * Toggle play/pause on the video
   * @returns {boolean} - New paused state
   */
  togglePlayPause() {
    const video = this.getVideoElement();
    if (!video) return true;

    if (video.paused) {
      video.play();
      return false;
    } else {
      video.pause();
      return true;
    }
  },

  /**
   * Skip to the previous subtitle
   */
  skipToPreviousSubtitle() {
    const video = this.getVideoElement();
    if (!video) return;

    const currentTime = video.currentTime;
    const startTimes = this.getNavigationStartTimes(video);
    const EPSILON = 0.001;

    if (startTimes.length === 0) {
      this.logSkipDebug('prev no-op (no startTimes)', { currentTime });
      return;
    }

    // Find current subtitle index (last one that started at or before currentTime)
    let currentSubIndex = -1;
    for (let i = startTimes.length - 1; i >= 0; i--) {
      if (startTimes[i] <= currentTime + EPSILON) {
        currentSubIndex = i;
        break;
      }
    }

    // Always go to the PREVIOUS subtitle (one before current)
    let targetTime = null;
    if (currentSubIndex > 0) {
      targetTime = startTimes[currentSubIndex - 1];
      video.currentTime = targetTime;
    } else if (currentSubIndex === 0) {
      // Already at first subtitle — seek to its start
      targetTime = startTimes[0];
      video.currentTime = targetTime;
    }

    this.logSkipDebug('prev navigation decision', {
      currentTime,
      currentSubIndex,
      targetTime
    });

    // Resume playback if paused (e.g., after auto-pause)
    if (video.paused) {
      video.play();
    }
  },

  /**
   * Skip to the next subtitle
   */
  skipToNextSubtitle() {
    const video = this.getVideoElement();
    if (!video) return;

    const currentTime = video.currentTime;
    const startTimes = this.getNavigationStartTimes(video);
    const EPSILON = 0.001;

    if (startTimes.length === 0) {
      this.logSkipDebug('next no-op (no startTimes)', { currentTime });
      return;
    }

    // Determine current subtitle by index first, then advance exactly one subtitle.
    let currentSubIndex = -1;
    for (let i = startTimes.length - 1; i >= 0; i--) {
      if (startTimes[i] <= currentTime + EPSILON) {
        currentSubIndex = i;
        break;
      }
    }

    let nextTime = null;
    if (currentSubIndex < 0) {
      nextTime = startTimes[0];
    } else if (currentSubIndex < startTimes.length - 1) {
      nextTime = startTimes[currentSubIndex + 1];
    }

    if (nextTime !== null) {
      video.currentTime = nextTime;
    }

    this.logSkipDebug('next navigation decision', {
      currentTime,
      currentSubIndex,
      targetTime: nextTime
    });

    // Resume playback if paused (e.g., after auto-pause)
    if (video.paused) {
      video.play();
    }
  },

  /**
   * Repeat the current subtitle - seeks to its start time
   * Auto-pause at end is handled by the video's seeked event listener
   * @param {Array<{startTime: number, endTime: number, text: string}>} subtitles - Array of subtitles with timing
   */
  repeatCurrentSubtitle(subtitles) {
    const video = this.getVideoElement();
    if (!video) {
      console.warn('[Repeat] no video element');
      return;
    }
    if (!subtitles || subtitles.length === 0) {
      console.warn('[Repeat] subtitles empty');
      return;
    }

    const currentTime = video.currentTime;
    console.log(`[Repeat] currentTime=${currentTime.toFixed(3)}, subtitles.length=${subtitles.length}, video.paused=${video.paused}`);

    // Find current subtitle (the one we're in or the most recent one)
    let currentSubIndex = -1;
    for (let i = 0; i < subtitles.length; i++) {
      const sub = subtitles[i];
      if (currentTime >= sub.startTime && currentTime <= sub.endTime) {
        currentSubIndex = i;
        break;
      } else if (currentTime > sub.endTime) {
        currentSubIndex = i; // Keep track of last passed subtitle
      }
    }

    if (currentSubIndex === -1) {
      console.log(`[Repeat] no match found, seeking to first subtitle at ${subtitles[0].startTime.toFixed(3)}`);
      video.currentTime = subtitles[0].startTime;
      if (video.paused) {
        video.play();
      }
      return;
    }

    const currentSub = subtitles[currentSubIndex];
    console.log(`[Repeat] matched sub[${currentSubIndex}]: [${currentSub.startTime.toFixed(3)}-${currentSub.endTime.toFixed(3)}], seeking from ${currentTime.toFixed(3)} to ${currentSub.startTime.toFixed(3)}`);
    video.currentTime = currentSub.startTime;

    // Resume playback if paused (e.g., after auto-pause)
    if (video.paused) {
      video.play();
    }
  },

  /**
   * Set playback speed
   * @param {number} speed - Playback speed (0.5 to 2.0)
   */
  setPlaybackSpeed(speed) {
    const video = this.getVideoElement();
    if (!video) return;

    video.playbackRate = speed;
    console.info('DualSubExtension: Playback speed set to', speed + 'x');
  },

  /**
   * Get current playback speed
   * @returns {number}
   */
  getPlaybackSpeed() {
    const video = this.getVideoElement();
    return video ? video.playbackRate : 1;
  },

  /**
   * Adjust playback speed by increment
   * @param {number} increment - Amount to change speed (e.g., 0.25 or -0.25)
   * @returns {number} - New playback speed
   */
  adjustPlaybackSpeed(increment) {
    const video = this.getVideoElement();
    if (!video) return 1;

    let newSpeed = Math.round((video.playbackRate + increment) * 100) / 100;
    // Clamp between 0.5 and 2.0
    newSpeed = Math.max(0.5, Math.min(2.0, newSpeed));
    video.playbackRate = newSpeed;

    console.info('DualSubExtension: Playback speed adjusted to', newSpeed + 'x');
    return newSpeed;
  },

  /**
   * Focus the YLE video player element
   */
  focusPlayer() {
    const playerUI = document.querySelector('[class*="PlayerUI__UI"]');
    if (playerUI) {
      playerUI.setAttribute('tabindex', '0');
      playerUI.focus();
    }
  },

  /**
   * Open extension settings page
   */
  openSettings() {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      if (typeof safeSendMessage === 'function') {
        safeSendMessage({ action: 'openOptionsPage' })
          .then((response) => {
            if (response === null && typeof showExtensionInvalidatedToast === 'function') {
              const shouldRefresh = typeof confirm === 'function'
                ? confirm('Extension updated. Refresh this page now to open settings?')
                : false;
              if (shouldRefresh) {
                location.reload();
                return;
              }
              showExtensionInvalidatedToast();
            }
          })
          .catch(err => {
            console.warn('DualSubExtension: Failed to open options page:', err);
          });
      } else {
        chrome.runtime.sendMessage({ action: 'openOptionsPage' });
      }
    }
  },

  /**
   * Save preference to Chrome storage
   * @param {string} key - Storage key
   * @param {*} value - Value to save
   */
  savePreference(key, value) {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.set({ [key]: value }).catch(err => {
        console.warn('DualSubExtension: Error saving preference:', err);
      });
    }
  },

  /**
   * Load preference from Chrome storage
   * @param {string} key - Storage key
   * @param {*} defaultValue - Default value if not found
   * @returns {Promise<*>}
   */
  async loadPreference(key, defaultValue) {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      try {
        const result = await chrome.storage.sync.get(key);
        return result[key] !== undefined ? result[key] : defaultValue;
      } catch (err) {
        console.warn('DualSubExtension: Error loading preference:', err);
        return defaultValue;
      }
    }
    return defaultValue;
  }
};

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.ControlActions = ControlActions;
}
