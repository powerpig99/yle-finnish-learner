/**
 * Platform Adapter Base Class
 *
 * Abstract base class that defines the interface for platform-specific adapters.
 * Each platform (YLE, YouTube, HTML5) must implement these methods.
 */

class PlatformAdapter {
  constructor() {
    if (this.constructor === PlatformAdapter) {
      throw new Error('PlatformAdapter is abstract and cannot be instantiated directly');
    }

    this.initialized = false;
    this.videoElement = null;
    this.subtitleTimestamps = [];
    this.controlBarElement = null;
  }

  /**
   * Initialize the adapter for the current page.
   * Called once when the platform is detected.
   */
  async initialize() {
    throw new Error('initialize() must be implemented by subclass');
  }

  /**
   * Clean up resources when navigating away or disabling.
   */
  cleanup() {
    throw new Error('cleanup() must be implemented by subclass');
  }

  /**
   * Detect and attach to video element(s) on the page.
   * @returns {HTMLVideoElement|null} The video element, or null if not found
   */
  detectVideo() {
    throw new Error('detectVideo() must be implemented by subclass');
  }

  /**
   * Set up subtitle interception for this platform.
   * This might be XHR/fetch hooks, TextTrack API, etc.
   */
  interceptSubtitles() {
    throw new Error('interceptSubtitles() must be implemented by subclass');
  }

  /**
   * Create and insert the control bar UI into the video player.
   * @param {Object} options - Configuration for the control bar
   * @returns {HTMLElement} The created control bar element
   */
  createControlBar(options) {
    throw new Error('createControlBar() must be implemented by subclass');
  }

  /**
   * Get the container element for the subtitle overlay.
   * @returns {HTMLElement} The container to append subtitles to
   */
  getSubtitleContainer() {
    throw new Error('getSubtitleContainer() must be implemented by subclass');
  }

  /**
   * Display dual subtitles (original + translated).
   * @param {string} originalText - The original subtitle text
   * @param {string} translatedText - The translated subtitle text
   */
  displaySubtitles(originalText, translatedText) {
    throw new Error('displaySubtitles() must be implemented by subclass');
  }

  /**
   * Hide the current subtitles.
   */
  hideSubtitles() {
    throw new Error('hideSubtitles() must be implemented by subclass');
  }

  /**
   * Get platform-specific DOM selectors.
   * @returns {Object} Object containing CSS selectors for this platform
   */
  getSelectors() {
    throw new Error('getSelectors() must be implemented by subclass');
  }

  /**
   * Check if this is a video page (vs. homepage, search, etc.).
   * @returns {boolean}
   */
  isVideoPage() {
    throw new Error('isVideoPage() must be implemented by subclass');
  }

  /**
   * Get the current video playback time in seconds.
   * @returns {number}
   */
  getCurrentTime() {
    if (this.videoElement) {
      return this.videoElement.currentTime;
    }
    return 0;
  }

  /**
   * Seek to a specific time in the video.
   * @param {number} time - Time in seconds
   */
  seekTo(time) {
    if (this.videoElement) {
      this.videoElement.currentTime = time;
    }
  }

  /**
   * Get the video playback rate.
   * @returns {number}
   */
  getPlaybackRate() {
    if (this.videoElement) {
      return this.videoElement.playbackRate;
    }
    return 1;
  }

  /**
   * Set the video playback rate.
   * @param {number} rate
   */
  setPlaybackRate(rate) {
    if (this.videoElement) {
      this.videoElement.playbackRate = rate;
    }
  }

  /**
   * Pause the video.
   */
  pause() {
    if (this.videoElement) {
      this.videoElement.pause();
    }
  }

  /**
   * Play the video.
   */
  play() {
    if (this.videoElement) {
      this.videoElement.play();
    }
  }

  /**
   * Check if video is paused.
   * @returns {boolean}
   */
  isPaused() {
    if (this.videoElement) {
      return this.videoElement.paused;
    }
    return true;
  }

  /**
   * Focus the video element (for keyboard shortcuts).
   */
  focusVideo() {
    if (this.videoElement) {
      this.videoElement.focus();
    }
  }

  // ============================================
  // Shared utility methods (implemented in base)
  // ============================================

  /**
   * Wait for an element to appear in the DOM.
   * @param {string} selector - CSS selector
   * @param {number} timeout - Maximum wait time in ms
   * @returns {Promise<HTMLElement>}
   */
  waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver((mutations, obs) => {
        const element = document.querySelector(selector);
        if (element) {
          obs.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);
    });
  }

  /**
   * Sleep for a specified duration.
   * @param {number} ms - Duration in milliseconds
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Escape HTML special characters.
   * @param {string} text
   * @returns {string}
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Generate a unique ID.
   * @returns {string}
   */
  generateId() {
    return 'dual-sub-' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Normalize text for translation key lookup.
   * @param {string} text
   * @returns {string}
   */
  toTranslationKey(text) {
    return text
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * Find the closest subtitle timestamp to the current time.
   * @param {number} currentTime
   * @param {string} direction - 'prev' or 'next'
   * @returns {Object|null} - { time, text } or null
   */
  findNearestSubtitle(currentTime, direction) {
    if (this.subtitleTimestamps.length === 0) {
      return null;
    }

    const sorted = [...this.subtitleTimestamps].sort((a, b) => a.time - b.time);

    if (direction === 'prev') {
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].time < currentTime - 0.5) {
          return sorted[i];
        }
      }
      return sorted[0];
    } else {
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].time > currentTime + 0.5) {
          return sorted[i];
        }
      }
      return sorted[sorted.length - 1];
    }
  }

  /**
   * Skip to the previous subtitle.
   */
  skipToPreviousSubtitle() {
    const target = this.findNearestSubtitle(this.getCurrentTime(), 'prev');
    if (target) {
      this.seekTo(target.time);
    }
  }

  /**
   * Skip to the next subtitle.
   */
  skipToNextSubtitle() {
    const target = this.findNearestSubtitle(this.getCurrentTime(), 'next');
    if (target) {
      this.seekTo(target.time);
    }
  }

  /**
   * Add a subtitle timestamp for navigation.
   * @param {number} time
   * @param {string} text
   */
  addSubtitleTimestamp(time, text) {
    const exists = this.subtitleTimestamps.find(ts => Math.abs(ts.time - time) < 0.5);
    if (!exists) {
      this.subtitleTimestamps.push({ time, text });
    }
  }

  /**
   * Clear all subtitle timestamps.
   */
  clearSubtitleTimestamps() {
    this.subtitleTimestamps = [];
  }

  /**
   * Get the control bar HTML template.
   * @param {Object} options
   * @returns {string}
   */
  getControlBarHTML(options = {}) {
    const {
      dualSubEnabled = true,
      autoPauseEnabled = false,
      playbackSpeed = 1,
      showWarning = false,
      warningMessage = ''
    } = options;

    return `
      <div class="dual-sub-extension-section">
        <span class="dual-sub-label">Dual Sub:</span>
        <input id="dual-sub-switch" class="dual-sub-switch" type="checkbox" ${dualSubEnabled ? 'checked' : ''}>

        ${showWarning ? `
          <span class="dual-sub-warning" title="${this.escapeHtml(warningMessage)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
          </span>
        ` : ''}

        <button aria-label="Open settings" type="button" id="yle-dual-sub-settings-button" class="dual-sub-btn" title="Settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
        </button>

        <button aria-label="Previous subtitle" type="button" id="yle-dual-sub-rewind-button" class="dual-sub-btn" title="Previous subtitle (,)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/>
          </svg>
        </button>

        <button aria-label="Next subtitle" type="button" id="yle-dual-sub-forward-button" class="dual-sub-btn" title="Next subtitle (.)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>
          </svg>
        </button>

        <span class="dual-sub-control-group">
          <span class="dual-sub-label">Auto-Pause:</span>
          <input id="auto-pause-switch" class="auto-pause-switch" type="checkbox" ${autoPauseEnabled ? 'checked' : ''}>
        </span>

        <span class="dual-sub-control-group">
          <span class="dual-sub-label">Speed:</span>
          <select id="yle-playback-speed" class="yle-speed-select">
            <option value="0.5" ${playbackSpeed === 0.5 ? 'selected' : ''}>0.5x</option>
            <option value="0.75" ${playbackSpeed === 0.75 ? 'selected' : ''}>0.75x</option>
            <option value="1" ${playbackSpeed === 1 ? 'selected' : ''}>1x</option>
            <option value="1.25" ${playbackSpeed === 1.25 ? 'selected' : ''}>1.25x</option>
            <option value="1.5" ${playbackSpeed === 1.5 ? 'selected' : ''}>1.5x</option>
            <option value="1.75" ${playbackSpeed === 1.75 ? 'selected' : ''}>1.75x</option>
            <option value="2" ${playbackSpeed === 2 ? 'selected' : ''}>2x</option>
          </select>
        </span>
      </div>
    `;
  }
}

// Platform detection utility
const PlatformDetector = {
  PLATFORMS: {
    YLE: {
      name: 'yle',
      match: (url) => url.hostname === 'areena.yle.fi',
      sourceLanguage: 'FI'
    },
    YOUTUBE: {
      name: 'youtube',
      match: (url) => url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com',
      sourceLanguage: null
    },
    HTML5: {
      name: 'html5',
      match: () => true,
      sourceLanguage: null
    }
  },

  detect() {
    const url = new URL(window.location.href);

    // Check in order of specificity
    if (this.PLATFORMS.YLE.match(url)) {
      return this.PLATFORMS.YLE;
    }
    if (this.PLATFORMS.YOUTUBE.match(url)) {
      return this.PLATFORMS.YOUTUBE;
    }

    // Default to HTML5 for any other site
    return this.PLATFORMS.HTML5;
  },

  isYLE() {
    return this.detect().name === 'yle';
  },

  isYouTube() {
    return this.detect().name === 'youtube';
  },

  isHTML5() {
    return this.detect().name === 'html5';
  }
};

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.PlatformAdapter = PlatformAdapter;
  window.PlatformDetector = PlatformDetector;
}
