/**
 * Control Actions Module
 *
 * Action handlers for the YLE Areena control panel.
 */

const NEXT_SUBTITLE_SKIP_AHEAD_SECONDS = 10;

const ControlActions = {
  /**
   * Get the current video element
   * @returns {HTMLVideoElement|null}
   */
  getVideoElement() {
    return document.querySelector('video');
  },

  /**
   * Build sorted, de-duplicated subtitle timing targets for navigation.
   * Prefetched subtitle timing is the only authoritative navigation source.
   * @param {Array<{startTime: number, endTime?: number|null}>} subtitles
   * @returns {Array<{startTime: number, endTime: number|null}>}
   */
  getNavigationTargets(subtitles = []) {
    const EPSILON = 0.001;
    const targets = [];
    if (!Array.isArray(subtitles) || subtitles.length === 0) {
      return [];
    }

    for (const subtitle of subtitles) {
      const startTime = subtitle?.startTime;
      if (typeof startTime !== 'number' || !Number.isFinite(startTime)) continue;

      targets.push({
        startTime,
        endTime: typeof subtitle?.endTime === 'number' && Number.isFinite(subtitle.endTime)
          ? subtitle.endTime
          : null,
        text: typeof subtitle?.text === 'string' ? subtitle.text : '',
      });
    }

    if (targets.length === 0) return [];

    targets.sort((a, b) => a.startTime - b.startTime);

    const uniqueTargets = [targets[0]];
    for (let i = 1; i < targets.length; i++) {
      const target = targets[i];
      const lastTarget = uniqueTargets[uniqueTargets.length - 1];
      if (target.startTime > lastTarget.startTime + EPSILON) {
        uniqueTargets.push(target);
        continue;
      }
      if (typeof target.endTime === 'number' && Number.isFinite(target.endTime)) {
        if (lastTarget.endTime === null || target.endTime > lastTarget.endTime) {
          lastTarget.endTime = target.endTime;
        }
      }
      if (!lastTarget.text && target.text) {
        lastTarget.text = target.text;
      }
    }

    return uniqueTargets;
  },

  dispatchSubtitleActionEvent(eventName, target) {
    const subtitleText = typeof target?.text === 'string' ? target.text.trim() : '';
    if (!subtitleText) {
      return;
    }
    if (typeof document?.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') {
      return;
    }
    document.dispatchEvent(new CustomEvent(eventName, {
      detail: { subtitleText },
    }));
  },

  getCurrentSubtitleTarget(subtitles = []) {
    const video = this.getVideoElement();
    if (!video) return null;

    const targets = this.getNavigationTargets(subtitles);
    if (targets.length === 0) return null;

    const currentTime = video.currentTime;

    let currentSubIndex = -1;
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      if (typeof target.endTime === 'number' &&
        currentTime >= target.startTime && currentTime <= target.endTime) {
        currentSubIndex = i;
        break;
      } else if (currentTime >= target.startTime) {
        currentSubIndex = i;
      }
    }

    return currentSubIndex === -1 ? targets[0] : targets[currentSubIndex];
  },

  seekVideo(video, time, endTime = null) {
    if (!video || typeof time !== 'number' || !Number.isFinite(time)) {
      return false;
    }

    if (typeof primeAutoPauseNavigationTarget === 'function') {
      primeAutoPauseNavigationTarget(endTime);
    }

    video.currentTime = time;
    if (video.paused) {
      video.play();
    }
    return true;
  },

  seekToSubtitleTarget(video, target) {
    if (!target || typeof target.startTime !== 'number' || !Number.isFinite(target.startTime)) {
      return false;
    }

    return this.seekVideo(video, target.startTime, target.endTime);
  },

  seekAheadBySeconds(video, seconds) {
    if (!video || typeof seconds !== 'number' || !Number.isFinite(seconds)) {
      return false;
    }

    return this.seekVideo(video, video.currentTime + seconds, null);
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
   * @param {Array<{startTime: number}>} subtitles
   */
  skipToPreviousSubtitle(subtitles = []) {
    const video = this.getVideoElement();
    if (!video) return false;

    const currentTime = video.currentTime;
    const targets = this.getNavigationTargets(subtitles);
    const EPSILON = 0.001;

    if (targets.length === 0) return false;

    // Find current subtitle index (last one that started at or before currentTime)
    let currentSubIndex = -1;
    for (let i = targets.length - 1; i >= 0; i--) {
      if (targets[i].startTime <= currentTime + EPSILON) {
        currentSubIndex = i;
        break;
      }
    }

    if (currentSubIndex <= 0) {
      return false;
    }

    return this.seekToSubtitleTarget(video, targets[currentSubIndex - 1]);
  },

  /**
   * Move forward to the next subtitle target when available, otherwise seek ahead.
   * @param {Array<{startTime: number}>} subtitles
   */
  skipToNextSubtitle(subtitles = []) {
    const video = this.getVideoElement();
    if (!video) return false;

    const currentTime = video.currentTime;
    const targets = this.getNavigationTargets(subtitles);
    const EPSILON = 0.001;

    // "Next subtitle" is still a forward-seek action even when no precise subtitle target exists yet.
    if (targets.length === 0) {
      return this.seekAheadBySeconds(video, NEXT_SUBTITLE_SKIP_AHEAD_SECONDS);
    }

    // Determine current subtitle by index first, then advance exactly one subtitle.
    let currentSubIndex = -1;
    for (let i = targets.length - 1; i >= 0; i--) {
      if (targets[i].startTime <= currentTime + EPSILON) {
        currentSubIndex = i;
        break;
      }
    }

    if (currentSubIndex >= targets.length - 1) {
      return this.seekAheadBySeconds(video, NEXT_SUBTITLE_SKIP_AHEAD_SECONDS);
    }

    if (currentSubIndex < 0) {
      return this.seekToSubtitleTarget(video, targets[0]);
    }

    return this.seekToSubtitleTarget(video, targets[currentSubIndex + 1]);
  },

  /**
   * Repeat the current subtitle - seeks to its start time.
   * @param {Array<{startTime: number, endTime?: number|null, text?: string}>} subtitles
   */
  repeatCurrentSubtitle(subtitles = []) {
    const video = this.getVideoElement();
    if (!video) return false;

    const currentTarget = this.getCurrentSubtitleTarget(subtitles);
    if (!currentTarget) return false;

    return this.seekToSubtitleTarget(video, currentTarget);
  },

  /**
   * Re-translate the current subtitle line without affecting playback.
   * @param {Array<{startTime: number, endTime?: number|null, text?: string}>} subtitles
   */
  retryCurrentSubtitleTranslation(subtitles = []) {
    const currentTarget = this.getCurrentSubtitleTarget(subtitles);
    if (!currentTarget) return false;

    this.dispatchSubtitleActionEvent('dscRetrySubtitleTranslation', currentTarget);
    return true;
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
