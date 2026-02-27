/**
 * Control Integration Module
 *
 * Bridges the ControlPanel with the existing contentscript.js functionality for YLE Areena.
 */

/**
 * Integration manager for the YLE control panel
 */
const ControlIntegration = {
  /** @type {ControlPanel|null} */
  _panel: null,

  /** @type {Promise<ControlPanel|null>|null} */
  _initPromise: null,

  /** @type {MutationObserver|null} */
  _mountObserver: null,

  /** @type {boolean} */
  _captionsEnabled: true,

  /** @type {boolean} */
  _userExtensionEnabled: true,

  /** @type {Object} */
  _state: {
    dualSubEnabled: false,
    autoPauseEnabled: false,
    playbackSpeed: 1.0,
    sourceLanguage: null,       // Detected from subtitles
    targetLanguage: 'en',       // Effective target language
    extensionEnabled: true      // Global on/off toggle (user controls everything)
  },

  /** @type {Array<{startTime: number, endTime: number, text: string}>} */
  _subtitles: [],

  /**
   * Initialize the control integration for YLE Areena
   * @param {Object} options - Initial options
   * @returns {Promise<ControlPanel|null>}
   */
  async init(options = {}) {
    if (this._initPromise) {
      const panel = await this._initPromise;
      this._applyInitOptions(options);
      this.updateState({
        dualSubEnabled: this._state.dualSubEnabled,
        autoPauseEnabled: this._state.autoPauseEnabled,
        playbackSpeed: this._state.playbackSpeed,
        sourceLanguage: this._state.sourceLanguage,
        targetLanguage: this._state.targetLanguage,
        extensionEnabled: this._userExtensionEnabled,
        ccEnabled: this._captionsEnabled
      });
      return panel;
    }

    this._initPromise = (async () => {
      if (this._mountObserver) {
        this._mountObserver.disconnect();
        this._mountObserver = null;
      }

      // Load preferences from storage first
      await this._loadPreferences();
      this._applyInitOptions(options);

      if (!this._panel) {
        // Create the control panel for YLE
        this._panel = new ControlPanel({
          initialState: {
            dualSubEnabled: this._state.dualSubEnabled,
            autoPauseEnabled: this._state.autoPauseEnabled,
            playbackSpeed: this._state.playbackSpeed,
            sourceLanguage: this._state.sourceLanguage,
            targetLanguage: this._state.targetLanguage,
            extensionEnabled: this._state.extensionEnabled,
            ccEnabled: this._captionsEnabled,
            availableLanguages: options.availableLanguages || []
          },
          callbacks: {
            onDualSubToggle: this._handleDualSubToggle.bind(this),
            onAutoPauseToggle: this._handleAutoPauseToggle.bind(this),
            onPrevSubtitle: this._handlePrevSubtitle.bind(this),
            onNextSubtitle: this._handleNextSubtitle.bind(this),
            onRepeatSubtitle: this._handleRepeatSubtitle.bind(this),
            onSpeedChange: this._handleSpeedChange.bind(this),
            onSourceLangChange: this._handleSourceLangChange.bind(this),
            onSettingsClick: this._handleSettingsClick.bind(this),
            onPlayPause: this._handlePlayPause.bind(this),
            onDownloadAudio: this._handleDownloadAudio.bind(this),
            onExtensionToggle: this._handleExtensionToggle.bind(this)
          }
        });
      } else {
        this._panel.updateState({
          dualSubEnabled: this._state.dualSubEnabled,
          autoPauseEnabled: this._state.autoPauseEnabled,
          playbackSpeed: this._state.playbackSpeed,
          sourceLanguage: this._state.sourceLanguage,
          targetLanguage: this._state.targetLanguage,
          extensionEnabled: this._state.extensionEnabled,
          ccEnabled: this._captionsEnabled
        });
      }

      // Mount panel if target is present.
      const element = this._panel.isMounted() ? this._panel.element : this._panel.mount();

      if (!element) {
        this._watchForMountTarget();
      }

      return this._panel;
    })();

    try {
      return await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  },

  /**
   * Watch for mount target if init raced with a temporary DOM teardown.
   * @private
   */
  _watchForMountTarget() {
    if (this._mountObserver) return;
    if (!(document.body instanceof Node)) return;

    this._mountObserver = new MutationObserver(() => {
      if (!this._panel || this._panel.isMounted()) {
        this._mountObserver?.disconnect();
        this._mountObserver = null;
        return;
      }
      if (!document.querySelector('[class^="BottomControlBar__LeftControls"]')) {
        return;
      }

      this._mountObserver?.disconnect();
      this._mountObserver = null;

      const element = this._panel.mount();
      if (!element) {
        this._watchForMountTarget();
      }
    });

    this._mountObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  },

  /**
   * Update the panel state
   * @param {Object} state - Partial state to update
   */
  updateState(state) {
    Object.assign(this._state, state);
    if (typeof state.extensionEnabled === 'boolean') {
      this._userExtensionEnabled = state.extensionEnabled;
      this._state.extensionEnabled = this._userExtensionEnabled && this._captionsEnabled;
    }
    if (this._panel) {
      this._panel.updateState({
        ...state,
        extensionEnabled: this._state.extensionEnabled,
        ccEnabled: this._captionsEnabled
      });
    }
  },

  /**
   * Set full subtitles with timing for repeat functionality
   * @param {Array<{startTime: number, endTime: number, text: string}>} subtitles
   */
  setSubtitles(subtitles) {
    // IMPORTANT: Copy the array, don't reference it!
    // The source array (fullSubtitles) gets cleared on navigation, which would
    // also clear _subtitles if we just stored the reference.
    this._subtitles = subtitles.map(sub => ({ ...sub }));
  },

  /**
   * Get current state
   * @returns {Object}
   */
  getState() {
    return { ...this._state };
  },

  /**
   * Check if panel is initialized
   * @returns {boolean}
   */
  isInitialized() {
    return this._panel !== null && this._panel.isMounted();
  },

  /**
   * Load preferences from Chrome storage
   * Uses safe wrapper to handle extension context invalidation gracefully
   * @private
   */
  async _loadPreferences() {
    try {
      if (!isExtensionContextValid()) {
        console.warn('DualSubExtension: Extension context invalidated, using defaults');
        return;
      }

      const result = await safeStorageGet([
        'dualSubEnabled',
        'autoPauseEnabled',
        'playbackSpeed',
        'sourceLanguage',
        'extensionEnabled',
        'targetLanguage'
      ]);

      if (typeof result.dualSubEnabled === 'boolean') {
        this._state.dualSubEnabled = result.dualSubEnabled;
      }
      if (typeof result.autoPauseEnabled === 'boolean') {
        this._state.autoPauseEnabled = result.autoPauseEnabled;
      }
      if (typeof result.playbackSpeed === 'number') {
        this._state.playbackSpeed = result.playbackSpeed;
      }
      if (result.sourceLanguage) {
        this._state.sourceLanguage = result.sourceLanguage;
      }
      // Load extensionEnabled (default to true)
      this._userExtensionEnabled = result.extensionEnabled !== false;
      this._state.extensionEnabled = this._userExtensionEnabled && this._captionsEnabled;

      // Load effective target language
      this._state.targetLanguage = await getEffectiveTargetLanguage();
    } catch (e) {
      // Check if this is an extension context invalidation error
      if (e.message && e.message.includes('Extension context invalidated')) {
        console.warn('DualSubExtension: Extension context invalidated during preferences load');
        return;
      }
      console.warn('DualSubExtension: Error loading preferences:', e);
    }
  },
  /**
   * Set whether native captions (CC button) are enabled
   * Simplified: just stores the value, no auto-enable/disable logic
   * @param {boolean} enabled - Whether CC is ON
   */
  setCaptionsEnabled(enabled) {
    const previousEffective = this._state.extensionEnabled;
    this._captionsEnabled = enabled;
    this._state.extensionEnabled = this._userExtensionEnabled && this._captionsEnabled;

    if (this._panel) {
      this._panel.updateState({
        ccEnabled: this._captionsEnabled,
        extensionEnabled: this._state.extensionEnabled,
        sourceLanguage: this._captionsEnabled ? this._state.sourceLanguage : null
      });
    }

    if (previousEffective !== this._state.extensionEnabled) {
      document.dispatchEvent(new CustomEvent('dscExtensionToggle', {
        detail: {
          enabled: this._state.extensionEnabled,
          dualSubEnabled: this._state.dualSubEnabled
        }
      }));
    }

  },

  /**
   * Handle extension toggle (manual on/off)
   * Simplified: no prerequisites, user controls everything
   * @param {boolean} enabled - Whether extension should be enabled
   */
  async _handleExtensionToggle(enabled) {
    this._userExtensionEnabled = enabled;
    this._state.extensionEnabled = this._userExtensionEnabled && this._captionsEnabled;

    await saveExtensionEnabledToStorage(enabled);

    // Update panel UI if mounted
    if (this._panel) {
      this._panel.updateState({
        extensionEnabled: this._state.extensionEnabled,
        ccEnabled: this._captionsEnabled
      });
    }

    // Dispatch event for contentscript.js to handle
    document.dispatchEvent(new CustomEvent('dscExtensionToggle', {
      detail: {
        enabled: this._state.extensionEnabled,
        dualSubEnabled: this._state.dualSubEnabled
      }
    }));

  },

  /**
   * Merge init options into state while preserving user preference semantics.
   * @param {Object} options
   * @private
   */
  _applyInitOptions(options = {}) {
    if (typeof options.captionsEnabled === 'boolean') {
      this._captionsEnabled = options.captionsEnabled;
    }

    if (typeof options.extensionEnabled === 'boolean') {
      this._userExtensionEnabled = options.extensionEnabled;
    }

    const stateUpdates = { ...options };
    delete stateUpdates.captionsEnabled;
    delete stateUpdates.extensionEnabled;
    Object.assign(this._state, stateUpdates);

    this._state.extensionEnabled = this._userExtensionEnabled && this._captionsEnabled;
  },

  /**
   * Set the detected source language
   * Simplified: just stores the value, no auto-enable/disable logic
   * @param {string} langCode - Detected language code
   */
  setSourceLanguage(langCode) {
    // Handle null explicitly - it means "no subtitles available"
    let normalized = null;
    if (langCode !== null && langCode !== undefined) {
      normalized = normalizeLanguageCode(langCode);
    }

    this._state.sourceLanguage = normalized;

    // Update panel UI if mounted
    if (this._panel) {
      this._panel.updateState({
        sourceLanguage: normalized
      });
    }

    // Dispatch event for contentscript.js
    const event = new CustomEvent('dscSourceLanguageChanged', {
      detail: {
        sourceLanguage: normalized,
        targetLanguage: this._state.targetLanguage,
        dualSubEnabled: this._state.dualSubEnabled
      }
    });
    document.dispatchEvent(event);
  },

  /**
   * Update target language
   * Simplified: just stores the value, no auto-enable/disable logic
   * @param {string} langCode - Target language code
   */
  setTargetLanguage(langCode) {
    const normalized = normalizeLanguageCode(langCode);

    this._state.targetLanguage = normalized;

    // Update panel UI if mounted
    if (this._panel) {
      this._panel.updateState({
        targetLanguage: normalized
      });
    }

  },

  /**
   * Handle dual sub toggle
   * Simplified: no restrictions, user controls everything
   * @param {boolean} enabled
   * @private
   */
  _handleDualSubToggle(enabled) {
    this._state.dualSubEnabled = enabled;

    // Save preference
    chrome.storage.sync.set({ dualSubEnabled: enabled });

    // Dispatch event for contentscript.js to handle
    document.dispatchEvent(new CustomEvent('dscDualSubToggle', {
      detail: { enabled }
    }));

  },

  /**
   * Handle auto-pause toggle
   * @param {boolean} enabled
   * @private
   */
  _handleAutoPauseToggle(enabled) {
    this._state.autoPauseEnabled = enabled;

    // Save preference
    chrome.storage.sync.set({ autoPauseEnabled: enabled });

    // Dispatch event for contentscript.js
    document.dispatchEvent(new CustomEvent('dscAutoPauseToggle', {
      detail: { enabled }
    }));

  },

  /**
   * Handle previous subtitle
   * @private
   */
  _handlePrevSubtitle() {
    ControlActions.skipToPreviousSubtitle();
  },

  /**
   * Handle next subtitle
   * @private
   */
  _handleNextSubtitle() {
    ControlActions.skipToNextSubtitle();
  },

  /**
   * Handle repeat subtitle
   * @private
   */
  _handleRepeatSubtitle() {
    ControlActions.repeatCurrentSubtitle(this._subtitles);
  },

  /**
   * Handle speed change
   * @param {number} speed
   * @private
   */
  _handleSpeedChange(speed) {
    this._state.playbackSpeed = speed;

    // Apply speed directly
    ControlActions.setPlaybackSpeed(speed);

    // Save preference
    chrome.storage.sync.set({ playbackSpeed: speed });

    // Dispatch event for contentscript.js
    document.dispatchEvent(new CustomEvent('dscSpeedChange', {
      detail: { speed }
    }));
  },

  /**
   * Handle source language change
   * @param {string} lang
   * @private
   */
  _handleSourceLangChange(lang) {
    this._state.sourceLanguage = lang;

    // Save preference
    chrome.storage.sync.set({ sourceLanguage: lang });

    // Dispatch event for contentscript.js
    document.dispatchEvent(new CustomEvent('dscSourceLangChange', {
      detail: { language: lang }
    }));

  },

  /**
   * Handle settings click
   * @private
   */
  _handleSettingsClick() {
    ControlActions.openSettings();
  },

  /**
   * Handle play/pause
   * @private
   */
  _handlePlayPause() {
    ControlActions.togglePlayPause();
  },

  /**
   * Handle audio download button click
   * @private
   */
  async _handleDownloadAudio() {

    // YLE uses DRM protection - use screen recording
    // Check if already recording - if so, stop it (toggle behavior)
    if (ScreenRecorder.isRecording()) {
      ScreenRecorder.stopRecording();
      return;
    }

    // On YLE, showing any modal closes the video overlay
    // So we skip the confirmation and go directly to screen recording
    const video = ControlActions.getVideoElement();
    if (!video) {
      console.error('DualSubExtension: No video found');
      return;
    }

    // Start recording directly without modal
    await this._startYLERecording(video);
  },

  /**
   * Start YLE screen recording
   * @param {HTMLVideoElement} video
   * @private
   */
  async _startYLERecording(video) {
    // NOTE: On YLE, we cannot show any modal as it closes the video overlay
    // The browser's native screen share dialog will appear instead

    // Track when recording starts in the video timeline
    const recordingStartTime = video.currentTime;

    try {
      await ScreenRecorder.startRecording({
        expectedDuration: video.duration,
        onProgress: (currentTime, totalTime, percent) => {
          // Only show progress UI once recording has started
          // By this point the browser's native dialog has been handled
          this._showYLERecordingProgress(currentTime, totalTime, percent);
        },
        onComplete: async (blob) => {
          const recordingEndTime = video.currentTime;

          // Show processing status
          this._showYLEProcessingStatus('Extracting speech audio...');

          // Get speech segments adjusted for recording time
          let speechSegments = null;
          if (this._subtitles && this._subtitles.length > 0) {
            const allSegments = AudioFilters.filterSpeechSegments(this._subtitles);
            speechSegments = allSegments
              .filter(seg => seg.startTime >= recordingStartTime && seg.startTime < recordingEndTime)
              .map(seg => ({
                ...seg,
                startTime: seg.startTime - recordingStartTime,
                endTime: Math.min(seg.endTime, recordingEndTime) - recordingStartTime
              }));
          }

          // Automatically extract speech-only MP3 (no modal)
          try {
            await ScreenRecorder.extractSpeechAudio(blob, speechSegments, {
              onProgress: (currentTime, totalTime, percent, phase) => {
                const status = phase === 'encoding' ? 'Encoding MP3...' : 'Extracting speech...';
                this._showYLEProcessingStatus(`${status} ${Math.round(percent)}%`);
              },
              onComplete: async (mp3Blob) => {
                this._hideYLERecordingUI();
                const filename = this._generateFilename();
                await this._downloadBlob(mp3Blob, filename);
              },
              onError: (error) => {
                this._hideYLERecordingUI();
                console.error('DualSubExtension: Extraction failed:', error);
              }
            });
          } catch (error) {
            this._hideYLERecordingUI();
            console.error('DualSubExtension: Extraction error:', error);
          }
        },
        onError: (error) => {
          this._hideYLERecordingUI();
          if (!error.message.includes('cancelled') && !error.message.includes('denied')) {
            // Only show error after recording attempt (video may already be closed)
            console.error('DualSubExtension: Screen recording error:', error.message);
            alert(error.message);
          }
        }
      });

    } catch (error) {
      this._hideYLERecordingUI();
      if (!error.message.includes('cancelled') && !error.message.includes('denied')) {
        console.error('DualSubExtension: Screen recording error:', error.message);
        alert(error.message);
      }
    }
  },

  /**
   * Show recording progress with stop button
   * @private
   */
  _showYLERecordingProgress(currentTime, totalTime, percent) {
    // Create or update the recording UI
    let recordingUI = document.getElementById('dsc-yle-recording-ui');

    if (!recordingUI) {
      recordingUI = document.createElement('div');
      recordingUI.id = 'dsc-yle-recording-ui';
      recordingUI.className = 'dsc-audio-progress';
      recordingUI.innerHTML = `
        <div class="dsc-audio-progress__content">
          <div class="dsc-audio-progress__header">
            <span class="dsc-audio-progress__title">🔴 Recording Screen</span>
            <button class="dsc-audio-progress__close" id="dsc-yle-stop-recording" title="Stop Recording">⬛</button>
          </div>
          <div class="dsc-audio-progress__bar-container">
            <div class="dsc-audio-progress__bar" style="width: 0%"></div>
          </div>
          <div class="dsc-audio-progress__info">
            <span class="dsc-audio-progress__time">0:00</span>
            <span class="dsc-audio-progress__percent">Recording...</span>
          </div>
        </div>
      `;
      document.body.appendChild(recordingUI);

      // Stop button handler
      recordingUI.querySelector('#dsc-yle-stop-recording').addEventListener('click', () => {
        ScreenRecorder.stopRecording();
      });
    }

    // Update progress
    const progressBar = recordingUI.querySelector('.dsc-audio-progress__bar');
    const timeText = recordingUI.querySelector('.dsc-audio-progress__time');
    const percentText = recordingUI.querySelector('.dsc-audio-progress__percent');

    if (progressBar && totalTime > 0) {
      progressBar.style.width = `${Math.min(percent, 100)}%`;
    }

    if (timeText) {
      const mins = Math.floor(currentTime / 60);
      const secs = Math.floor(currentTime % 60);
      timeText.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    if (percentText) {
      percentText.textContent = 'Recording...';
    }
  },

  /**
   * Hide YLE recording UI
   * @private
   */
  _hideYLERecordingUI() {
    const recordingUI = document.getElementById('dsc-yle-recording-ui');
    if (recordingUI) recordingUI.remove();

    const processingUI = document.getElementById('dsc-yle-processing-ui');
    if (processingUI) processingUI.remove();
  },

  /**
   * Show processing status (extracting/encoding)
   * @param {string} status - Status message to display
   * @private
   */
  _showYLEProcessingStatus(status) {
    let processingUI = document.getElementById('dsc-yle-processing-ui');

    if (!processingUI) {
      processingUI = document.createElement('div');
      processingUI.id = 'dsc-yle-processing-ui';
      processingUI.className = 'dsc-audio-progress';
      processingUI.innerHTML = `
        <div class="dsc-audio-progress__content">
          <div class="dsc-audio-progress__header">
            <span class="dsc-audio-progress__title">⏳ Processing</span>
          </div>
          <div class="dsc-audio-progress__info" style="justify-content: center;">
            <span class="dsc-audio-progress__status">Processing...</span>
          </div>
        </div>
      `;
      document.body.appendChild(processingUI);
    }

    const statusText = processingUI.querySelector('.dsc-audio-progress__status');
    if (statusText) {
      statusText.textContent = status;
    }
  },

  /**
   * Generate filename for the audio download
   * @returns {string}
   * @private
   */
  _generateFilename() {
    // Try to get video title from page
    let title = 'audio';

    // Try different sources for title (YLE-specific)
    const titleSources = [
      () => document.querySelector('title')?.textContent,
      () => document.querySelector('h1')?.textContent,
      () => document.querySelector('[class*="title"]')?.textContent
    ];

    for (const getTitle of titleSources) {
      try {
        const t = getTitle();
        if (t && t.trim()) {
          title = t.trim();
          break;
        }
      } catch (e) {
        // Continue to next source
      }
    }

    // Clean filename
    title = title
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
      .replace(/\s+/g, '_')          // Replace spaces with underscores
      .substring(0, 50);             // Limit length

    return `${title}_speech.mp3`;
  },

  /**
   * Download a blob as a file
   * @param {Blob} blob
   * @param {string} filename
   * @private
   */
  async _downloadBlob(blob, filename) {
    try {
      // Convert blob to data URL for background script
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // Send to background script to download via chrome.downloads API
      // This avoids any focus events on the page
      const response = await chrome.runtime.sendMessage({
        action: 'downloadBlob',
        data: { dataUrl, filename }
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Download failed');
      }
    } catch (error) {
      console.error('DualSubExtension: Download error:', error);
      alert(error.message || 'Download failed');
    }
  },

  /**
   * Check if currently skipping (for auto-pause prevention)
   * @returns {boolean}
   */
  isSkipping() {
    return ControlActions.isSkipping();
  }
};

window.ControlIntegration = ControlIntegration;
