/**
 * Control Panel Module
 *
 * Unified control panel that works consistently across all platforms.
 * Uses ControlIcons, ControlActions, and ControlKeyboard modules.
 */

/* global ControlIcons, ControlActions, ControlKeyboard */

class ControlPanel {
  /**
   * Create a control panel
   * @param {Object} options
   * @param {string} options.platform - 'yle' | 'youtube' | 'html5'
   * @param {Object} [options.callbacks] - Callback functions for control events
   * @param {Object} [options.initialState] - Initial state values
   */
  constructor(options) {
    this.platform = options.platform;
    this.element = null;
    this.keyboard = null;
    this._mounted = false;

    // State tracked by panel
    this.state = Object.assign({
      dualSubEnabled: false,
      autoPauseEnabled: false,
      sourceLanguage: 'en',
      playbackSpeed: 1.0,
      availableLanguages: [],
      showWarning: false,
      warningMessage: ''
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
      onDownloadAudio: () => {}
    }, options.callbacks || {});

    // References to UI elements
    this._elements = {};
  }

  /**
   * Get mount configuration for the platform
   * @returns {Object}
   */
  getMountConfig() {
    switch (this.platform) {
      case 'yle':
        return {
          selector: '[class^="BottomControlBar__LeftControls"]',
          insertMethod: 'append',
          style: 'integrated',
          hideOnInactive: true
        };
      case 'youtube':
        return {
          selector: '.ytp-left-controls',
          insertMethod: 'append',
          style: 'integrated',
          hideOnInactive: false
        };
      case 'html5':
        return {
          selector: null,
          insertMethod: 'float',
          style: 'floating',
          hideOnInactive: true
        };
      default:
        return {
          selector: null,
          insertMethod: 'float',
          style: 'floating',
          hideOnInactive: true
        };
    }
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

    // Also remove any legacy control panels
    const legacyControls = document.querySelectorAll('.dual-sub-extension-section');
    legacyControls.forEach(el => el.remove());
    const legacyYtControls = document.getElementById('dual-sub-yt-controls');
    if (legacyYtControls) legacyYtControls.remove();

    // Create the panel element
    this.element = this._createPanel();

    // Find the mount target
    let target = null;
    if (config.selector) {
      // Wait for the target element
      for (let i = 0; i < 20; i++) {
        target = document.querySelector(config.selector);
        if (target) break;
        await new Promise(r => setTimeout(r, 200));
      }
    }

    if (!target && config.style === 'floating') {
      // For floating style, mount to video parent
      const video = ControlActions.getVideoElement(this.platform);
      if (video && video.parentElement) {
        target = video.parentElement;
        // Make container position relative for absolute positioning
        const computedStyle = window.getComputedStyle(target);
        if (computedStyle.position === 'static') {
          target.style.position = 'relative';
        }
      }
    }

    if (!target) {
      console.error('DualSubExtension: Could not find mount target for control panel');
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
      case 'float':
        target.appendChild(this.element);
        this._setupFloatingBehavior(target);
        break;
    }

    // Setup event handlers
    this._setupEventHandlers();

    // Setup keyboard handler
    this._setupKeyboard();

    this._mounted = true;
    console.info('DualSubExtension: Control panel mounted for platform:', this.platform);

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
    panel.className = `dsc-panel dsc-${this.platform}`;
    panel.id = 'dsc-control-panel';

    const config = this.getMountConfig();
    if (config.style === 'floating') {
      panel.classList.add('dsc-floating');
    }

    // Build the panel content
    panel.innerHTML = this._getPanelHTML();

    return panel;
  }

  /**
   * Get the panel HTML
   * @returns {string}
   */
  _getPanelHTML() {
    const { dualSubEnabled, autoPauseEnabled, playbackSpeed, showWarning } = this.state;

    // Build speed options
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    const speedOptions = speeds
      .map(s => `<option value="${s}" ${s === playbackSpeed ? 'selected' : ''}>${s}x</option>`)
      .join('');

    return `
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
    `;
  }

  /**
   * Setup event handlers for controls
   */
  _setupEventHandlers() {
    // Store element references
    this._elements = {
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
    const config = ControlKeyboard.getDefaultConfig(this.platform);

    this.keyboard = new ControlKeyboard({
      platform: this.platform,
      config: config,
      callbacks: {
        onDualSubToggle: () => {
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
          this.callbacks.onPrevSubtitle();
        },
        onNextSubtitle: () => {
          this.callbacks.onNextSubtitle();
        },
        onRepeatSubtitle: () => {
          this.callbacks.onRepeatSubtitle();
        },
        onSpeedChange: (increment) => {
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
          this.callbacks.onDownloadAudio();
        }
      }
    });

    this.keyboard.attach();
  }

  /**
   * Setup floating behavior for HTML5 videos
   * @param {HTMLElement} container
   */
  _setupFloatingBehavior(container) {
    // Show panel on hover
    container.addEventListener('mouseenter', () => {
      this.element.classList.add('visible');
    });

    container.addEventListener('mouseleave', () => {
      this.element.classList.remove('visible');
    });
  }

  /**
   * Sync UI elements with current state
   */
  _syncUI() {
    if (!this._mounted) return;

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

  /**
   * Focus the video player
   */
  _focusPlayer() {
    ControlActions.focusPlayer(this.platform);
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
