/**
 * Control Keyboard Module
 *
 * Keyboard handler for the YLE Areena control panel.
 */

class ControlKeyboard {
  /**
   * Create a keyboard handler
   * @param {Object} options
   * @param {Object} options.callbacks - Callback functions for each action
   */
  constructor(options = {}) {
    this.callbacks = options.callbacks || {};
    this.config = Object.assign({
      useCapture: true,
      interceptSpace: false, // Let YLE handle space
      interceptBrackets: true,
      enabled: true
    }, options.config || {});

    this._boundKeyDown = this._handleKeyDown.bind(this);
    this._boundKeyUp = this._handleKeyUp.bind(this);
    this._boundWindowBlur = this._handleWindowBlur.bind(this);
    this._attached = false;
    this._pressedKeys = new Set();

    // Default key bindings
    this.keyBindings = {
      'd': 'toggleDualSub',
      'D': 'toggleDualSub',
      ',': 'previousSubtitle',
      '.': 'nextSubtitle',
      'r': 'repeatSubtitle',
      'R': 'repeatSubtitle',
      'p': 'toggleAutoPause',
      'P': 'toggleAutoPause',
      '[': 'decreaseSpeed',
      ']': 'increaseSpeed',
      ' ': 'togglePlayPause',
      'a': 'downloadAudio',
      'A': 'downloadAudio'
    };
  }

  /**
   * Attach keyboard event listeners
   */
  attach() {
    if (this._attached) return;

    const useCapture = !!this.config.useCapture;
    window.addEventListener('keydown', this._boundKeyDown, useCapture);
    window.addEventListener('keyup', this._boundKeyUp, useCapture);
    window.addEventListener('blur', this._boundWindowBlur);

    this._attached = true;
  }

  /**
   * Detach keyboard event listeners
   */
  detach() {
    if (!this._attached) return;

    const useCapture = !!this.config.useCapture;
    window.removeEventListener('keydown', this._boundKeyDown, useCapture);
    window.removeEventListener('keyup', this._boundKeyUp, useCapture);
    window.removeEventListener('blur', this._boundWindowBlur);

    this._attached = false;
    this._pressedKeys.clear();
  }

  /**
   * Check if the event target is an input element
   * @param {KeyboardEvent} event
   * @returns {boolean}
   */
  _isInputElement(event) {
    const target = event.target;
    if (!(target instanceof Element)) return false;

    const tagName = target.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
      return true;
    }

    if (target.isContentEditable) {
      return true;
    }

    return target.closest('[contenteditable="true"]') !== null;
  }

  /**
   * Check if the key should be handled
   * @param {string} key
   * @returns {boolean}
   */
  _shouldHandleKey(key) {
    // Check if key is in our bindings
    if (!this.keyBindings[key]) return false;

    // Check special keys
    if (key === ' ' && !this.config.interceptSpace) return false;
    if ((key === '[' || key === ']') && !this.config.interceptBrackets) return false;

    return true;
  }

  /**
   * Handle keydown events
   * @param {KeyboardEvent} event
   */
  _handleKeyDown(event) {
    if (!this.config.enabled) return;
    if (this._isInputElement(event)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const key = event.key;
    const allowsRepeat = key === '[' || key === ']';

    // Check if this is one of our hotkeys
    if (!this._shouldHandleKey(key)) return;

    // Ignore key-repeat for one-shot actions (not speed brackets).
    if (event.repeat && !allowsRepeat) return;

    // Guard against duplicate keydown firing while a key is held.
    if (!allowsRepeat && this._pressedKeys.has(key)) return;
    if (!allowsRepeat) {
      this._pressedKeys.add(key);
    }

    // Prevent default and stop propagation for our keys
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const action = this.keyBindings[key];
    this._executeAction(action, event);
  }

  /**
   * Handle keyup events (to prevent platform from detecting our keys)
   * @param {KeyboardEvent} event
   */
  _handleKeyUp(event) {
    if (!this.config.enabled) return;
    if (this._isInputElement(event)) return;

    const key = event.key;
    this._pressedKeys.delete(key);

    if (!this._shouldHandleKey(key)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  /**
   * Clear pressed-key guards when window loses focus.
   */
  _handleWindowBlur() {
    this._pressedKeys.clear();
  }

  /**
   * Execute an action based on key binding
   * @param {string} action - Action name
   * @param {KeyboardEvent} event - Original keyboard event
   */
  _executeAction(action, event) {
    switch (action) {
      case 'toggleDualSub':
        if (this.callbacks.onDualSubToggle) {
          this.callbacks.onDualSubToggle();
        }
        break;

      case 'previousSubtitle':
        if (this.callbacks.onPrevSubtitle) {
          this.callbacks.onPrevSubtitle();
        }
        break;

      case 'nextSubtitle':
        if (this.callbacks.onNextSubtitle) {
          this.callbacks.onNextSubtitle();
        }
        break;

      case 'repeatSubtitle':
        if (this.callbacks.onRepeatSubtitle) {
          this.callbacks.onRepeatSubtitle();
        }
        break;

      case 'toggleAutoPause':
        if (this.callbacks.onAutoPauseToggle) {
          this.callbacks.onAutoPauseToggle();
        }
        break;

      case 'decreaseSpeed':
        if (this.callbacks.onSpeedChange) {
          this.callbacks.onSpeedChange(-0.25);
        }
        break;

      case 'increaseSpeed':
        if (this.callbacks.onSpeedChange) {
          this.callbacks.onSpeedChange(0.25);
        }
        break;

      case 'togglePlayPause':
        if (this.callbacks.onPlayPause) {
          this.callbacks.onPlayPause();
        }
        break;

      case 'downloadAudio':
        if (this.callbacks.onDownloadAudio) {
          this.callbacks.onDownloadAudio();
        }
        break;

      default:
        console.warn('DualSubExtension: Unknown keyboard action:', action);
    }
  }

  /**
   * Get the default configuration for YLE
   * @returns {Object} - Configuration object
   */
  static getDefaultConfig() {
    return {
      useCapture: true,
      interceptSpace: false, // Let YLE handle space
      interceptBrackets: true
    };
  }
}

window.ControlKeyboard = ControlKeyboard;
