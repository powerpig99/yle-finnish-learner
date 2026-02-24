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
   * Build sorted, de-duplicated subtitle start times for navigation.
   * Uses active text-track cues only (single source of truth).
   * @param {HTMLVideoElement} video
   * @returns {number[]}
   */
  getNavigationStartTimes(video) {
    const EPSILON = 0.001;
    const cueTimes = [];

    if (video && video.textTracks && video.textTracks.length > 0) {
      for (const track of Array.from(video.textTracks)) {
        if (!track) continue;
        const cues = track.cues;
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

    if (cueTimes.length === 0) return [];

    cueTimes.sort((a, b) => a - b);

    const uniqueTimes = [cueTimes[0]];
    for (let i = 1; i < cueTimes.length; i++) {
      const time = cueTimes[i];
      if (time > uniqueTimes[uniqueTimes.length - 1] + EPSILON) {
        uniqueTimes.push(time);
      }
    }

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

    if (startTimes.length === 0) return;

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

    if (startTimes.length === 0) return;

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
      video.currentTime = subtitles[0].startTime;
      if (video.paused) {
        video.play();
      }
      return;
    }

    const currentSub = subtitles[currentSubIndex];
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
    safeSendMessage({ action: 'openOptionsPage' })
      .then((response) => {
        if (response === null) {
          const shouldRefresh = confirm('Extension updated. Refresh this page now to open settings?');
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
  }
};

window.ControlActions = ControlActions;
