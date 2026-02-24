/**
 * Audio Download UI Module
 *
 * Minimal UI helpers for audio-download flow:
 * - Error modal
 * - Legacy progress cleanup
 */

const AudioDownloadUI = {
  /**
   * Currently active modal element
   * @private
   */
  _modal: null,

  /**
   * Hide progress bar
   */
  hideProgressBar() {
    const progressBars = document.querySelectorAll('.dsc-audio-progress');
    progressBars.forEach((progressBar) => {
      if (progressBar instanceof HTMLElement) {
        progressBar.remove();
      }
    });
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

window.AudioDownloadUI = AudioDownloadUI;
