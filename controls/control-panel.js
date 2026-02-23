/**
 * Control Panel Module
 *
 * Control panel for YLE Areena.
 * Uses ControlIcons, ControlActions, and ControlKeyboard modules.
 */

/* global ControlIcons, ControlActions, ControlKeyboard */

class ControlPanel {
  /**
   * Create a control panel
   * @param {Object} options
   * @param {Object} [options.callbacks] - Callback functions for control events
   * @param {Object} [options.initialState] - Initial state values
   */
  constructor(options) {
    this.element = null;
    this.keyboard = null;
    this._mounted = false;

    // State tracked by panel
    // Simplified: no auto-disable logic, user controls everything
    this.state = Object.assign({
      dualSubEnabled: false,
      autoPauseEnabled: false,
      sourceLanguage: null,
      targetLanguage: 'en',
      playbackSpeed: 1.0,
      availableLanguages: [],
      showWarning: false,
      warningMessage: '',
      extensionEnabled: true,
      ccEnabled: true
    }, options.initialState || {});

    // Callbacks for all controls
    this.callbacks = Object.assign({
      onDualSubToggle: (enabled) => {},
      onAutoPauseToggle: (enabled) => {},
      onPrevSubtitle: () => {},
      onNextSubtitle: () => {},
      onRepeatSubtitle: () => {},
      onSpeedChange: (speed) => {},
      onSourceLangChange: (lang) => {},
      onSettingsClick: () => {},
      onPlayPause: () => {},
      onDownloadAudio: () => {},
      onExtensionToggle: (enabled) => {}
    }, options.callbacks || {});

    // References to UI elements
    this._elements = {};
  }

  /**
   * Get mount configuration for YLE
   * @returns {Object}
   */
  getMountConfig() {
    return {
      selector: '[class^="BottomControlBar__LeftControls"]',
      insertMethod: 'append',
      style: 'integrated',
      hideOnInactive: true
    };
  }

  /**
   * Mount the control panel to the DOM
   * @param {Object} [customConfig] - Override mount configuration
   * @returns {Promise<HTMLElement|null>}
   */
  async mount(customConfig = {}) {
    const config = Object.assign(this.getMountConfig(), customConfig);

    // Remove existing panel if present
    this.unmount();

    // Create the panel element
    this.element = this._createPanel();

    // Find the mount target with exponential backoff
    let target = null;
    if (config.selector) {
      // Wait for the target element with increasing delays
      // Total wait: ~8 seconds (200+200+400+400+800+800+1000+1000+1500+1500 = 7800ms)
      const delays = [200, 200, 400, 400, 800, 800, 1000, 1000, 1500, 1500];
      for (let i = 0; i < delays.length; i++) {
        target = document.querySelector(config.selector);
        if (target) break;
        await new Promise(r => setTimeout(r, delays[i]));
      }
    }

    if (!target) {
      // Log as warning instead of error - mounting will be retried
      console.warn('DualSubExtension: Mount target not found yet, will retry');
      return null;
    }

    // Insert the panel
    switch (config.insertMethod) {
      case 'append':
        target.appendChild(this.element);
        break;
      case 'prepend':
        target.insertBefore(this.element, target.firstChild);
        break;
    }

    // Setup event handlers
    this._setupEventHandlers();

    // Setup keyboard handler
    this._setupKeyboard();

    this._mounted = true;
    console.info('DualSubExtension: Control panel mounted for YLE Areena');

    return this.element;
  }

  /**
   * Unmount the control panel
   */
  unmount() {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }

    if (this.keyboard) {
      this.keyboard.detach();
      this.keyboard = null;
    }

    // Clear element references
    this._elements = {};
    this._mounted = false;
  }

  /**
   * Update panel state and sync UI
   * @param {Object} partialState - Partial state to update
   */
  updateState(partialState) {
    Object.assign(this.state, partialState);
    this._syncUI();
  }

  /**
   * Create the panel DOM element
   * @returns {HTMLElement}
   */
  _createPanel() {
    const panel = document.createElement('div');
    panel.className = 'dsc-panel dsc-yle';
    panel.id = 'dsc-control-panel';

    // Build the panel content
    panel.innerHTML = this._getPanelHTML();

    return panel;
  }

  // REMOVED: _getStatusBadgeText() and _getStatusBadgeClass()
  // No status badges needed - user controls everything manually

  /**
   * Get the panel HTML
   * Simplified: no blocking/disabled states, user controls everything
   * @returns {string}
   */
  _getPanelHTML() {
    const { dualSubEnabled, autoPauseEnabled, playbackSpeed, showWarning, extensionEnabled } = this.state;

    // Build speed options
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    const speedOptions = speeds
      .map(s => `<option value="${s}" ${s === playbackSpeed ? 'selected' : ''}>${s}x</option>`)
      .join('');

    // Features are only disabled when extension is OFF
    const featuresDisabled = !extensionEnabled;

    return `
      <div class="dsc-group dsc-master-toggle">
        <label class="dsc-switch dsc-switch-master ${extensionEnabled ? 'active' : ''}" id="dsc-extension-toggle" title="Enable/disable extension">
          <input type="checkbox" id="dsc-extension-checkbox" ${extensionEnabled ? 'checked' : ''}>
          <span class="dsc-switch-knob"></span>
        </label>
      </div>

      <span class="dsc-separator"></span>

      <div class="dsc-features ${featuresDisabled ? 'dsc-disabled' : ''}">

      <div class="dsc-group dsc-branding">
        <span class="dsc-logo" title="Language Learning Subtitles">LLS</span>
      </div>

      <span class="dsc-separator"></span>

      <div class="dsc-group dsc-dual-sub">
        <span class="dsc-label">DS</span>
        <label class="dsc-switch ${dualSubEnabled ? 'active' : ''}" id="dsc-dual-sub-toggle" title="Toggle dual subtitles (D)">
          <input type="checkbox" id="dsc-dual-sub-checkbox" ${dualSubEnabled ? 'checked' : ''}>
          <span class="dsc-switch-knob"></span>
        </label>
        ${showWarning ? `
          <span class="dsc-warning" id="dsc-warning" title="Translation provider not configured">
            <span class="dsc-warning-icon">!</span>
          </span>
        ` : ''}
      </div>

      <span class="dsc-separator"></span>

      <div class="dsc-group dsc-navigation">
        <button id="dsc-prev-btn" class="dsc-btn" title="Previous subtitle (,)">
          ${ControlIcons.previous}
        </button>
        <button id="dsc-repeat-btn" class="dsc-btn" title="Repeat subtitle (R)">
          ${ControlIcons.repeat}
        </button>
        <button id="dsc-next-btn" class="dsc-btn" title="Next subtitle (.)">
          ${ControlIcons.next}
        </button>
      </div>

      <span class="dsc-separator"></span>

      <div class="dsc-group dsc-auto-pause">
        <span class="dsc-label">AP</span>
        <label class="dsc-switch dsc-switch-small ${autoPauseEnabled ? 'active' : ''}" id="dsc-auto-pause-toggle" title="Auto-pause after each subtitle (P)">
          <input type="checkbox" id="dsc-auto-pause-checkbox" ${autoPauseEnabled ? 'checked' : ''}>
          <span class="dsc-switch-knob"></span>
        </label>
      </div>

      <div class="dsc-group dsc-speed">
        <select id="dsc-speed-select" class="dsc-select" title="Playback speed ([ / ])">
          ${speedOptions}
        </select>
      </div>

      <div class="dsc-group dsc-audio-download">
        <button id="dsc-download-audio-btn" class="dsc-btn" title="Download speech audio">
          ${ControlIcons.download}
        </button>
      </div>

      <div class="dsc-group dsc-settings">
        <button id="dsc-settings-btn" class="dsc-btn dsc-btn-settings" title="Open settings">
          ${ControlIcons.settings}
        </button>
      </div>

      </div><!-- end dsc-features -->
    `;
  }

  /**
   * Setup event handlers for controls
   */
  _setupEventHandlers() {
    // Store element references (simplified - no statusBadge)
    this._elements = {
      extensionToggle: this.element.querySelector('#dsc-extension-toggle'),
      extensionCheckbox: this.element.querySelector('#dsc-extension-checkbox'),
      featuresContainer: this.element.querySelector('.dsc-features'),
      dualSubToggle: this.element.querySelector('#dsc-dual-sub-toggle'),
      dualSubCheckbox: this.element.querySelector('#dsc-dual-sub-checkbox'),
      autoPauseToggle: this.element.querySelector('#dsc-auto-pause-toggle'),
      autoPauseCheckbox: this.element.querySelector('#dsc-auto-pause-checkbox'),
      speedSelect: this.element.querySelector('#dsc-speed-select'),
      prevBtn: this.element.querySelector('#dsc-prev-btn'),
      nextBtn: this.element.querySelector('#dsc-next-btn'),
      repeatBtn: this.element.querySelector('#dsc-repeat-btn'),
      settingsBtn: this.element.querySelector('#dsc-settings-btn'),
      warning: this.element.querySelector('#dsc-warning')
    };

    // Extension master toggle
    if (this._elements.extensionCheckbox) {
      this._elements.extensionCheckbox.addEventListener('change', (e) => {
        e.stopPropagation();
        const enabled = e.target.checked;
        this.state.extensionEnabled = enabled;
        this._elements.extensionToggle.classList.toggle('active', enabled);
        this._updateFeaturesDisabledState();
        this.callbacks.onExtensionToggle(enabled);
        this._focusPlayer();
      });
    }

    // Dual Sub toggle
    if (this._elements.dualSubCheckbox) {
      this._elements.dualSubCheckbox.addEventListener('change', (e) => {
        e.stopPropagation();
        const enabled = e.target.checked;
        this.state.dualSubEnabled = enabled;
        this._elements.dualSubToggle.classList.toggle('active', enabled);
        this.callbacks.onDualSubToggle(enabled);
        this._focusPlayer();
      });
    }

    // Auto-pause toggle
    if (this._elements.autoPauseCheckbox) {
      this._elements.autoPauseCheckbox.addEventListener('change', (e) => {
        e.stopPropagation();
        const enabled = e.target.checked;
        this.state.autoPauseEnabled = enabled;
        this._elements.autoPauseToggle.classList.toggle('active', enabled);
        this.callbacks.onAutoPauseToggle(enabled);
        this._focusPlayer();
      });
    }

    // Speed selector
    if (this._elements.speedSelect) {
      this._elements.speedSelect.addEventListener('change', (e) => {
        e.stopPropagation();
        const speed = parseFloat(e.target.value);
        this.state.playbackSpeed = speed;
        this.callbacks.onSpeedChange(speed);
        this._focusPlayer();
      });
      this._elements.speedSelect.addEventListener('click', (e) => e.stopPropagation());
    }

    // Navigation buttons
    if (this._elements.prevBtn) {
      this._elements.prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.callbacks.onPrevSubtitle();
        this._focusPlayer();
      });
    }

    if (this._elements.nextBtn) {
      this._elements.nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.callbacks.onNextSubtitle();
        this._focusPlayer();
      });
    }

    if (this._elements.repeatBtn) {
      this._elements.repeatBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.callbacks.onRepeatSubtitle();
        this._focusPlayer();
      });
    }

    // Download audio button
    this._elements.downloadAudioBtn = this.element.querySelector('#dsc-download-audio-btn');
    if (this._elements.downloadAudioBtn) {
      this._elements.downloadAudioBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.callbacks.onDownloadAudio();
      });
    }

    // Settings button
    if (this._elements.settingsBtn) {
      this._elements.settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.callbacks.onSettingsClick();
      });
    }

    // Block events from bubbling UP to YLE's handlers (bubble phase only)
    // Don't use capture phase here as it would prevent events from reaching our buttons
    const blockBubble = (e) => {
      e.stopPropagation();
    };

    ['mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup',
     'touchstart', 'touchend', 'touchmove', 'focus', 'blur', 'focusin', 'focusout'].forEach(evt => {
      this.element.addEventListener(evt, blockBubble, false); // Bubble phase
    });

  }

  /**
   * Setup keyboard handler
   */
  _setupKeyboard() {
    const config = ControlKeyboard.getDefaultConfig();

    this.keyboard = new ControlKeyboard({
      config: config,
      callbacks: {
        onDualSubToggle: () => {
          if (!this.state.extensionEnabled) return;
          const newState = !this.state.dualSubEnabled;
          this.state.dualSubEnabled = newState;
          if (this._elements.dualSubCheckbox) {
            this._elements.dualSubCheckbox.checked = newState;
          }
          if (this._elements.dualSubToggle) {
            this._elements.dualSubToggle.classList.toggle('active', newState);
          }
          this.callbacks.onDualSubToggle(newState);
        },
        onAutoPauseToggle: () => {
          if (!this.state.extensionEnabled) return;
          const newState = !this.state.autoPauseEnabled;
          this.state.autoPauseEnabled = newState;
          if (this._elements.autoPauseCheckbox) {
            this._elements.autoPauseCheckbox.checked = newState;
          }
          if (this._elements.autoPauseToggle) {
            this._elements.autoPauseToggle.classList.toggle('active', newState);
          }
          this.callbacks.onAutoPauseToggle(newState);
        },
        onPrevSubtitle: () => {
          if (!this.state.extensionEnabled) return;
          this.callbacks.onPrevSubtitle();
        },
        onNextSubtitle: () => {
          if (!this.state.extensionEnabled) return;
          this.callbacks.onNextSubtitle();
        },
        onRepeatSubtitle: () => {
          if (!this.state.extensionEnabled) return;
          this.callbacks.onRepeatSubtitle();
        },
        onSpeedChange: (increment) => {
          if (!this.state.extensionEnabled) return;
          const currentSpeed = this.state.playbackSpeed;
          let newSpeed = Math.round((currentSpeed + increment) * 100) / 100;
          newSpeed = Math.max(0.5, Math.min(2.0, newSpeed));
          this.state.playbackSpeed = newSpeed;
          if (this._elements.speedSelect) {
            this._elements.speedSelect.value = newSpeed.toString();
          }
          this.callbacks.onSpeedChange(newSpeed);
        },
        onPlayPause: () => {
          this.callbacks.onPlayPause();
        },
        onDownloadAudio: () => {
          if (!this.state.extensionEnabled) return;
          this.callbacks.onDownloadAudio();
        }
      }
    });

    this.keyboard.attach();
  }

  /**
   * Sync UI elements with current state
   * Simplified: no blocking/disabled states
   */
  _syncUI() {
    if (!this._mounted) return;

    // Sync extension toggle
    if (this._elements.extensionCheckbox) {
      this._elements.extensionCheckbox.checked = this.state.extensionEnabled;
    }
    if (this._elements.extensionToggle) {
      this._elements.extensionToggle.classList.toggle('active', this.state.extensionEnabled);
    }

    // Sync CC-enabled state on the master toggle
    if (this._elements.extensionCheckbox) {
      this._elements.extensionCheckbox.disabled = !this.state.ccEnabled;
    }
    if (this._elements.extensionToggle) {
      this._elements.extensionToggle.classList.toggle('dsc-switch-blocked', !this.state.ccEnabled);
    }

    // Update features disabled state
    this._updateFeaturesDisabledState();

    // Sync dual sub toggle
    if (this._elements.dualSubCheckbox) {
      this._elements.dualSubCheckbox.checked = this.state.dualSubEnabled;
    }
    if (this._elements.dualSubToggle) {
      this._elements.dualSubToggle.classList.toggle('active', this.state.dualSubEnabled);
    }

    // Sync auto-pause toggle
    if (this._elements.autoPauseCheckbox) {
      this._elements.autoPauseCheckbox.checked = this.state.autoPauseEnabled;
    }
    if (this._elements.autoPauseToggle) {
      this._elements.autoPauseToggle.classList.toggle('active', this.state.autoPauseEnabled);
    }

    // Sync speed
    if (this._elements.speedSelect) {
      this._elements.speedSelect.value = this.state.playbackSpeed.toString();
    }

    // Sync warning visibility
    if (this._elements.warning) {
      this._elements.warning.style.display = this.state.showWarning ? 'inline-flex' : 'none';
    }
  }

  // REMOVED: _updateStatusBadge() - no status badges needed

  /**
   * Update the disabled state of the features container
   * Features are only disabled when extension is OFF
   */
  _updateFeaturesDisabledState() {
    if (!this._elements.featuresContainer) return;

    const shouldDisable = !this.state.extensionEnabled;
    this._elements.featuresContainer.classList.toggle('dsc-disabled', shouldDisable);

    // When CC is off, disable the master toggle too
    if (this._elements.extensionCheckbox) {
      this._elements.extensionCheckbox.disabled = !this.state.ccEnabled;
    }
    if (this._elements.extensionToggle) {
      this._elements.extensionToggle.classList.toggle('dsc-switch-blocked', !this.state.ccEnabled);
    }
  }

  /**
   * Focus the video player
   */
  _focusPlayer() {
    ControlActions.focusPlayer();
  }

  /**
   * Check if panel is mounted and still in the DOM
   * @returns {boolean}
   */
  isMounted() {
    // Check both the flag AND if element is actually connected to DOM
    // This handles cases where the platform (like YLE) removes our element
    if (!this._mounted || !this.element) {
      return false;
    }
    // Check if element is still in the DOM
    if (!this.element.isConnected) {
      // Element was removed externally, update our state
      this._mounted = false;
      this.element = null;
      this._elements = {};
      return false;
    }
    return true;
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.ControlPanel = ControlPanel;
}
