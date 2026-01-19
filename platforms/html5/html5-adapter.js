/**
 * Generic HTML5 Video Platform Adapter
 *
 * Platform-agnostic implementation for any website with HTML5 video elements.
 * Uses the standard HTMLMediaElement.textTracks API to detect and intercept subtitles.
 */

const HTML5Adapter = {
  name: 'html5',
  sourceLanguage: null, // User must select or auto-detect

  // Track attached videos to avoid duplicates
  _attachedVideos: new WeakSet(),
  _subtitleOverlays: new WeakMap(),
  _initialized: false,

  /**
   * Get mount configuration for the unified control panel
   * @returns {Object}
   */
  getControlPanelMountConfig() {
    return {
      selector: null,        // Uses video.parentElement
      insertMethod: 'float', // Floating overlay panel
      style: 'floating',
      hideOnInactive: true   // Show only on hover
    };
  },

  /**
   * Get keyboard configuration for the unified control panel
   * @returns {Object}
   */
  getKeyboardConfig() {
    return {
      useCapture: false,
      interceptSpace: true,
      interceptBrackets: true
    };
  },

  /**
   * Check if this adapter should be used for the current page
   * Always returns true as this is the fallback adapter
   * @returns {boolean}
   */
  isMatch() {
    // This is the fallback for any site not handled by specific adapters
    const hostname = window.location.hostname;
    return hostname !== 'areena.yle.fi' &&
           hostname !== 'www.youtube.com' &&
           hostname !== 'youtube.com';
  },

  /**
   * Check if page has any video elements
   * @returns {boolean}
   */
  isVideoPage() {
    return document.querySelectorAll('video').length > 0;
  },

  /**
   * Get all video elements on the page
   * @returns {NodeListOf<HTMLVideoElement>}
   */
  getAllVideoElements() {
    return document.querySelectorAll('video');
  },

  /**
   * Get the first video element
   * @returns {HTMLVideoElement|null}
   */
  getVideoElement() {
    return document.querySelector('video');
  },

  /**
   * Initialize the adapter - start watching for videos
   */
  initialize() {
    if (this._initialized) return;
    this._initialized = true;

    console.info('DualSubExtension: HTML5 adapter initializing');

    // Observe DOM for new video elements
    this.observeVideoElements();

    // Attach to existing videos
    this.getAllVideoElements().forEach(video => {
      this.attachToVideo(video);
    });
  },

  /**
   * Set up MutationObserver to watch for new video elements
   */
  observeVideoElements() {
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          const element = /** @type {HTMLElement} */ (node);

          if (element.tagName === 'VIDEO') {
            this.attachToVideo(/** @type {HTMLVideoElement} */ (element));
          } else if (element.querySelectorAll) {
            element.querySelectorAll('video').forEach(video => {
              this.attachToVideo(video);
            });
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  },

  /**
   * Attach to a video element to intercept its text tracks
   * @param {HTMLVideoElement} video
   */
  attachToVideo(video) {
    if (this._attachedVideos.has(video)) {
      return;
    }
    this._attachedVideos.add(video);

    console.info('DualSubExtension: Attaching to video element');

    // Process existing text tracks
    const textTracks = video.textTracks;
    for (let i = 0; i < textTracks.length; i++) {
      this.handleTextTrack(textTracks[i], video);
    }

    // Listen for new tracks being added
    textTracks.addEventListener('addtrack', event => {
      this.handleTextTrack(event.track, video);
    });

    // Create floating control bar for this video
    this.createFloatingControlBar(video);
  },

  /**
   * Handle a text track - extract cues and set up listeners
   * @param {TextTrack} track
   * @param {HTMLVideoElement} video
   */
  handleTextTrack(track, video) {
    if (track.kind !== 'subtitles' && track.kind !== 'captions') {
      return;
    }

    console.info('DualSubExtension: Found text track:', track.label || track.language);

    // Set to hidden so we get events but browser doesn't render
    const originalMode = track.mode;
    track.mode = 'hidden';

    // If track is loaded, extract cues immediately
    if (track.cues && track.cues.length > 0) {
      this.extractAndSendCues(track, video);
    }

    // Listen for cues to load (for async-loaded tracks)
    track.addEventListener('load', () => {
      this.extractAndSendCues(track, video);
    });

    // Listen for cue changes during playback
    track.addEventListener('cuechange', () => {
      this.handleCueChange(track, video);
    });
  },

  /**
   * Extract all cues from a track and send for translation
   * @param {TextTrack} track
   * @param {HTMLVideoElement} video
   */
  extractAndSendCues(track, video) {
    if (!track.cues || track.cues.length === 0) {
      return;
    }

    const subtitles = [];
    for (let i = 0; i < track.cues.length; i++) {
      const cue = track.cues[i];
      const text = cue.text || '';
      if (text.trim().length === 0) continue;

      subtitles.push({
        text: text.replace(/\n/g, ' ').trim(),
        startTime: cue.startTime,
        endTime: cue.endTime
      });
    }

    if (subtitles.length > 0) {
      // Dispatch batch translation event
      const event = new CustomEvent('sendBatchTranslationEvent', {
        bubbles: true,
        cancelable: true,
        detail: {
          subtitles: subtitles,
          source: 'html5-texttrack',
          trackLabel: track.label || track.language
        }
      });
      document.dispatchEvent(event);

      console.info('DualSubExtension: [HTML5] Sent batch of', subtitles.length, 'subtitles from track:', track.label || track.language);
    }
  },

  /**
   * Handle cue change event - display current subtitle
   * @param {TextTrack} track
   * @param {HTMLVideoElement} video
   */
  handleCueChange(track, video) {
    const activeCues = track.activeCues;
    if (!activeCues || activeCues.length === 0) {
      this.hideSubtitles(video);
      return;
    }

    // Get the current cue text
    const currentText = Array.from(activeCues)
      .map(cue => cue.text)
      .join(' ')
      .replace(/\n/g, ' ')
      .trim();

    if (currentText.length > 0) {
      // Dispatch event for content script to handle display
      const event = new CustomEvent('html5SubtitleUpdate', {
        bubbles: true,
        cancelable: true,
        detail: {
          text: currentText,
          video: video
        }
      });
      document.dispatchEvent(event);
    }
  },

  /**
   * Create a floating control bar for a video element
   * @param {HTMLVideoElement} video
   */
  createFloatingControlBar(video) {
    // Find or create container
    const container = video.parentElement;
    if (!container) return;

    // Make container position relative for absolute positioning of overlay
    const computedStyle = window.getComputedStyle(container);
    if (computedStyle.position === 'static') {
      container.style.position = 'relative';
    }

    // Create floating control bar
    const controlBar = document.createElement('div');
    controlBar.className = 'dual-sub-floating-controls';
    controlBar.innerHTML = this.getControlBarHTML({});

    // Position at bottom of video
    controlBar.style.cssText = `
      position: absolute;
      bottom: 50px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      padding: 8px 16px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 12px;
      z-index: 9999;
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: auto;
    `;

    container.appendChild(controlBar);

    // Show on hover
    container.addEventListener('mouseenter', () => {
      controlBar.style.opacity = '1';
    });
    container.addEventListener('mouseleave', () => {
      controlBar.style.opacity = '0';
    });

    // Store reference
    this._subtitleOverlays.set(video, controlBar);
  },

  /**
   * Get the control bar HTML for generic HTML5 videos
   * @param {Object} options
   * @returns {string}
   */
  getControlBarHTML(options = {}) {
    const {
      dualSubEnabled = false,
      autoPauseEnabled = false
    } = options;

    return `
      <span style="color: #fff; font-size: 13px; font-weight: 500;">Dual Sub</span>
      <input id="dual-sub-switch" class="dual-sub-switch" type="checkbox" ${dualSubEnabled ? 'checked' : ''} style="
        width: 16px;
        height: 16px;
        cursor: pointer;
      ">

      <span style="color: rgba(255,255,255,0.6); margin: 0 4px;">|</span>

      <button id="yle-dual-sub-rewind-button" style="
        background: none;
        border: none;
        color: #fff;
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        opacity: 0.9;
      " title="Previous subtitle (,)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z"/>
        </svg>
      </button>

      <button id="yle-dual-sub-forward-button" style="
        background: none;
        border: none;
        color: #fff;
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        opacity: 0.9;
      " title="Next subtitle (.)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 18l8.5-6L6 6v12zm2-12v12l6.5-6L8 6zm8 0v12h2V6h-2z"/>
        </svg>
      </button>

      <span style="color: rgba(255,255,255,0.6); margin: 0 4px;">|</span>

      <span style="color: #fff; font-size: 11px; opacity: 0.8;">Auto-Pause</span>
      <input id="auto-pause-switch" class="auto-pause-switch" type="checkbox" ${autoPauseEnabled ? 'checked' : ''} style="
        width: 14px;
        height: 14px;
        cursor: pointer;
      " title="Pause after each subtitle (P)">
    `;
  },

  /**
   * Create subtitle display wrapper for a video
   * @param {HTMLVideoElement} video
   * @returns {HTMLElement}
   */
  createSubtitleDisplayWrapper(video) {
    const container = video.parentElement;
    if (!container) return null;

    // Check if wrapper already exists
    let wrapper = container.querySelector('#displayed-subtitles-wrapper');
    if (wrapper) return wrapper;

    // Create wrapper
    wrapper = document.createElement('div');
    wrapper.id = 'displayed-subtitles-wrapper';
    wrapper.style.cssText = `
      position: absolute;
      bottom: 80px;
      left: 0;
      right: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 0 20px;
      pointer-events: auto;
      z-index: 9998;
    `;

    container.appendChild(wrapper);
    return wrapper;
  },

  /**
   * Hide subtitles for a video
   * @param {HTMLVideoElement} video
   */
  hideSubtitles(video) {
    const container = video.parentElement;
    if (!container) return;

    const wrapper = container.querySelector('#displayed-subtitles-wrapper');
    if (wrapper) {
      wrapper.innerHTML = '';
    }
  },

  /**
   * Get video title (for caching)
   * @returns {Promise<string|null>}
   */
  async getVideoTitle() {
    // Try to get title from page
    const title = document.title ||
                  document.querySelector('h1')?.textContent ||
                  window.location.pathname;
    return title.trim() || null;
  },

  /**
   * Focus the video element
   */
  focusPlayer() {
    const video = this.getVideoElement();
    if (video) {
      video.focus();
    }
  },

  /**
   * Check if a mutation indicates a video element appeared
   * @param {MutationRecord} mutation
   * @returns {boolean}
   */
  isVideoAppearMutation(mutation) {
    if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) {
      return false;
    }

    for (const node of Array.from(mutation.addedNodes)) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      const element = /** @type {HTMLElement} */ (node);

      if (element.tagName === 'VIDEO' || element.querySelector?.('video')) {
        return true;
      }
    }

    return false;
  },

  /**
   * Check if mutation is related to subtitle/track changes
   * @param {MutationRecord} mutation
   * @returns {boolean}
   */
  isSubtitleMutation(mutation) {
    // For HTML5, we use TextTrack events instead of mutations
    return false;
  }
};

// Export for use in content script
if (typeof window !== 'undefined') {
  window.HTML5Adapter = HTML5Adapter;
}
