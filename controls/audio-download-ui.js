/**
 * Audio Download UI Module
 *
 * Provides UI for the audio download feature:
 * - Confirmation dialog with segment info
 * - Non-intrusive progress bar in corner during recording
 * - Error and success messages
 */

/* global AudioFilters */

const AudioDownloadUI = {
  /**
   * Currently active modal element
   * @private
   */
  _modal: null,

  /**
   * Progress bar element (non-intrusive)
   * @private
   */
  _progressBar: null,

  /**
   * Show confirmation dialog before starting download
   * @param {Object} info - Download info
   * @param {number} info.totalDuration - Total video duration in seconds
   * @param {number} info.speechDuration - Speech-only duration in seconds
   * @param {number} info.segmentCount - Number of speech segments
   * @param {number} info.removedCount - Number of non-verbal segments removed
   * @param {Array<string>} info.removedTypes - Types of content removed
   * @param {string} info.estimatedSize - Estimated file size
   * @param {function} onConfirm - Called when user confirms
   * @param {function} onCancel - Called when user cancels
   */
  showConfirmation(info, onConfirm, onCancel) {
    this.hideModal();
    this.hideProgressBar();

    const removedTypesText = info.removedTypes && info.removedTypes.length > 0
      ? info.removedTypes.join(', ')
      : 'none detected';

    const modal = document.createElement('div');
    modal.className = 'dsc-audio-modal';
    modal.innerHTML = `
      <div class="dsc-audio-modal__overlay"></div>
      <div class="dsc-audio-modal__content">
        <div class="dsc-audio-modal__header">
          <h3 class="dsc-audio-modal__title">Download Speech Audio</h3>
        </div>
        <div class="dsc-audio-modal__body">
          <div class="dsc-audio-modal__info">
            <div class="dsc-audio-modal__row">
              <span class="dsc-audio-modal__label">Total video:</span>
              <span class="dsc-audio-modal__value">${AudioFilters.formatDuration(info.totalDuration)}</span>
            </div>
            <div class="dsc-audio-modal__row dsc-audio-modal__row--highlight">
              <span class="dsc-audio-modal__label">Speech only:</span>
              <span class="dsc-audio-modal__value">${AudioFilters.formatDuration(info.speechDuration)} (${info.segmentCount} segments)</span>
            </div>
            <div class="dsc-audio-modal__row dsc-audio-modal__row--removed">
              <span class="dsc-audio-modal__label">Removed:</span>
              <span class="dsc-audio-modal__value">${removedTypesText} (${info.removedCount} segments)</span>
            </div>
            <div class="dsc-audio-modal__row">
              <span class="dsc-audio-modal__label">Estimated size:</span>
              <span class="dsc-audio-modal__value">${info.estimatedSize}</span>
            </div>
          </div>
          <div class="dsc-audio-modal__notice">
            <p>The video will play from start to end while recording audio.</p>
            <p>Non-speech segments will be removed automatically.</p>
            <p class="dsc-audio-modal__warning-text">Note: Some streaming services use DRM protection which may prevent audio capture.</p>
          </div>
        </div>
        <div class="dsc-audio-modal__footer">
          <button class="dsc-audio-modal__btn dsc-audio-modal__btn--secondary" id="dsc-audio-cancel">
            Cancel
          </button>
          <button class="dsc-audio-modal__btn dsc-audio-modal__btn--primary" id="dsc-audio-confirm">
            Start Recording
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this._modal = modal;

    // Event handlers
    const confirmBtn = modal.querySelector('#dsc-audio-confirm');
    const cancelBtn = modal.querySelector('#dsc-audio-cancel');
    const overlay = modal.querySelector('.dsc-audio-modal__overlay');

    const handleConfirm = () => {
      this.hideModal();
      if (onConfirm) onConfirm();
    };

    const handleCancel = () => {
      this.hideModal();
      if (onCancel) onCancel();
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    overlay.addEventListener('click', handleCancel);

    // Focus confirm button
    setTimeout(() => confirmBtn.focus(), 100);
  },

  /**
   * Show non-intrusive progress bar in corner
   * @param {number} currentTime - Current time in seconds
   * @param {number} totalTime - Total time in seconds
   * @param {number} percent - Progress percentage
   * @param {string} phase - Current phase ('recording', 'extracting', 'encoding')
   * @param {function} onCancel - Called when user cancels
   */
  showProgress(currentTime, totalTime, percent, phase, onCancel) {
    if (!this._progressBar) {
      const bar = document.createElement('div');
      bar.className = 'dsc-audio-progress';
      bar.innerHTML = `
        <div class="dsc-audio-progress__content">
          <div class="dsc-audio-progress__header">
            <span class="dsc-audio-progress__title">Recording Audio</span>
            <button class="dsc-audio-progress__close" title="Cancel">×</button>
          </div>
          <div class="dsc-audio-progress__bar-container">
            <div class="dsc-audio-progress__bar" style="width: 0%"></div>
          </div>
          <div class="dsc-audio-progress__info">
            <span class="dsc-audio-progress__time">0:00 / 0:00</span>
            <span class="dsc-audio-progress__percent">0%</span>
          </div>
        </div>
      `;

      document.body.appendChild(bar);
      this._progressBar = bar;

      // Cancel handler
      const closeBtn = bar.querySelector('.dsc-audio-progress__close');
      closeBtn.addEventListener('click', () => {
        if (onCancel) onCancel();
      });
    }

    // Update progress
    const progressBarFill = this._progressBar.querySelector('.dsc-audio-progress__bar');
    const timeText = this._progressBar.querySelector('.dsc-audio-progress__time');
    const percentText = this._progressBar.querySelector('.dsc-audio-progress__percent');
    const titleText = this._progressBar.querySelector('.dsc-audio-progress__title');

    if (progressBarFill) progressBarFill.style.width = `${percent}%`;
    if (timeText) timeText.textContent = `${this._formatTime(currentTime)} / ${this._formatTime(totalTime)}`;
    if (percentText) percentText.textContent = `${Math.round(percent)}%`;

    // Update title based on phase
    if (titleText) {
      switch (phase) {
        case 'recording':
          titleText.textContent = 'Recording Audio';
          break;
        case 'extracting':
          titleText.textContent = 'Extracting Speech';
          break;
        case 'encoding':
          titleText.textContent = 'Encoding MP3';
          break;
        default:
          titleText.textContent = 'Processing';
      }
    }
  },

  /**
   * Show encoding progress (uses the same progress bar)
   * @param {number} percent - Encoding progress percentage
   */
  showEncodingProgress(percent) {
    this.showProgress(0, 0, percent, 'encoding', null);

    // Update time to show encoding instead
    if (this._progressBar) {
      const timeText = this._progressBar.querySelector('.dsc-audio-progress__time');
      if (timeText) timeText.textContent = 'Encoding...';
    }
  },

  /**
   * Hide progress bar
   */
  hideProgressBar() {
    if (this._progressBar) {
      this._progressBar.remove();
      this._progressBar = null;
    }
  },

  /**
   * Show success message (brief toast notification)
   * @param {string} filename - Downloaded filename
   * @param {function} onClose - Called when toast closes
   */
  showSuccess(filename, onClose) {
    this.hideModal();
    this.hideProgressBar();

    const toast = document.createElement('div');
    toast.className = 'dsc-audio-toast dsc-audio-toast--success';
    toast.innerHTML = `
      <div class="dsc-audio-toast__icon">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
        </svg>
      </div>
      <div class="dsc-audio-toast__content">
        <div class="dsc-audio-toast__title">Download Complete</div>
        <div class="dsc-audio-toast__message">${this._escapeHtml(filename)}</div>
      </div>
      <button class="dsc-audio-toast__close">×</button>
    `;

    document.body.appendChild(toast);

    const closeToast = () => {
      toast.remove();
      if (onClose) onClose();
    };

    toast.querySelector('.dsc-audio-toast__close').addEventListener('click', closeToast);

    // Auto-close after 5 seconds
    setTimeout(closeToast, 5000);
  },

  /**
   * Show error message
   * @param {string} message - Error message
   * @param {function} onDismiss - Called when error is dismissed
   */
  showError(message, onDismiss) {
    this.hideModal();
    this.hideProgressBar();

    const modal = document.createElement('div');
    modal.className = 'dsc-audio-modal';
    modal.innerHTML = `
      <div class="dsc-audio-modal__overlay"></div>
      <div class="dsc-audio-modal__content dsc-audio-modal__content--error">
        <div class="dsc-audio-modal__header">
          <h3 class="dsc-audio-modal__title">Error</h3>
        </div>
        <div class="dsc-audio-modal__body">
          <div class="dsc-audio-modal__error-icon">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
          </div>
          <p class="dsc-audio-modal__error-message">${this._escapeHtml(message)}</p>
        </div>
        <div class="dsc-audio-modal__footer">
          <button class="dsc-audio-modal__btn dsc-audio-modal__btn--primary" id="dsc-audio-dismiss">
            Dismiss
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this._modal = modal;

    const handleDismiss = () => {
      this.hideModal();
      if (onDismiss) onDismiss();
    };

    modal.querySelector('#dsc-audio-dismiss').addEventListener('click', handleDismiss);
    modal.querySelector('.dsc-audio-modal__overlay').addEventListener('click', handleDismiss);
  },

  /**
   * Hide current modal
   */
  hideModal() {
    if (this._modal) {
      this._modal.remove();
      this._modal = null;
    }
  },

  /**
   * Check if modal or progress bar is currently shown
   * @returns {boolean}
   */
  isShowing() {
    return this._modal !== null || this._progressBar !== null;
  },

  /**
   * Format time in seconds to mm:ss
   * @param {number} seconds
   * @returns {string}
   * @private
   */
  _formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  },

  /**
   * Escape HTML to prevent XSS
   * @param {string} text
   * @returns {string}
   * @private
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.AudioDownloadUI = AudioDownloadUI;
}
