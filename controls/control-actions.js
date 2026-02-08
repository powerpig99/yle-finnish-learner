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
   * @param {Array<{time: number, text: string}>} subtitleTimestamps - Array of subtitle timestamps
   */
  skipToPreviousSubtitle(subtitleTimestamps) {
    const video = this.getVideoElement();
    if (!video) return;

    const currentTime = video.currentTime;

    // Find the current subtitle index (last one that started at or before currentTime)
    let currentSubIndex = -1;
    for (let i = subtitleTimestamps.length - 1; i >= 0; i--) {
      if (subtitleTimestamps[i].time <= currentTime) {
        currentSubIndex = i;
        break;
      }
    }

    // Always go to the PREVIOUS subtitle (one before current)
    if (currentSubIndex > 0) {
      video.currentTime = subtitleTimestamps[currentSubIndex - 1].time;
    } else if (currentSubIndex === 0) {
      // Already at first subtitle — seek to its start
      video.currentTime = subtitleTimestamps[0].time;
    } else {
      // No subtitle found, skip back 5 seconds as fallback
      video.currentTime = Math.max(0, currentTime - 5);
    }
  },

  /**
   * Skip to the next subtitle
   * @param {Array<{time: number, text: string}>} subtitleTimestamps - Array of subtitle timestamps
   */
  skipToNextSubtitle(subtitleTimestamps) {
    const video = this.getVideoElement();
    if (!video) return;

    const currentTime = video.currentTime;

    // Find the next subtitle timestamp after current time
    const nextSubtitle = subtitleTimestamps.find(entry => entry.time > currentTime + 0.5);

    if (nextSubtitle) {
      video.currentTime = nextSubtitle.time;
    } else {
      // No next subtitle found, skip forward 5 seconds as fallback
      video.currentTime = currentTime + 5;
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
      return;
    }

    const currentSub = subtitles[currentSubIndex];
    console.log(`[Repeat] matched sub[${currentSubIndex}]: [${currentSub.startTime.toFixed(3)}-${currentSub.endTime.toFixed(3)}], seeking from ${currentTime.toFixed(3)} to ${currentSub.startTime.toFixed(3)}`);
    video.currentTime = currentSub.startTime;

    // Verify seek completed
    video.addEventListener('seeked', () => {
      console.log(`[Repeat] seeked done, now at ${video.currentTime.toFixed(3)}`);
    }, { once: true });
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
