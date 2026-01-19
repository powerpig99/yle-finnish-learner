/**
 * Control Icons Module
 *
 * Centralized SVG icon definitions for the unified control panel.
 * All icons are 18x18 viewBox by default for consistency.
 */

const ControlIcons = {
  /**
   * Settings/gear icon
   */
  settings: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
  </svg>`,

  /**
   * Previous/skip back icon
   */
  previous: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z"/>
  </svg>`,

  /**
   * Next/skip forward icon
   */
  next: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 18l8.5-6L6 6v12zm2-12v12l6.5-6L8 6zm8 0v12h2V6h-2z"/>
  </svg>`,

  /**
   * Repeat/replay icon
   */
  repeat: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
  </svg>`,

  /**
   * Warning/alert icon
   */
  warning: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
  </svg>`,

  /**
   * Speed/fast forward icon (for speed control indicator)
   */
  speed: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>
  </svg>`,

  /**
   * Play icon
   */
  play: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z"/>
  </svg>`,

  /**
   * Pause icon
   */
  pause: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
  </svg>`,

  /**
   * Subtitles/closed captions icon
   */
  subtitles: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/>
  </svg>`,

  /**
   * Language/translate icon
   */
  language: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
  </svg>`,

  /**
   * Auto-pause indicator icon
   */
  autoPause: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
  </svg>`,

  /**
   * Download icon for audio download feature
   */
  download: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
  </svg>`,

  /**
   * Create an SVG element from an icon string
   * @param {string} iconHtml - The icon HTML string
   * @param {Object} options - Optional configuration
   * @param {number} [options.size] - Size in pixels (applies to both width and height)
   * @param {string} [options.color] - Color for the icon
   * @returns {SVGElement}
   */
  createSvgElement(iconHtml, options = {}) {
    const template = document.createElement('template');
    template.innerHTML = iconHtml.trim();
    const svg = template.content.firstChild;

    if (options.size) {
      svg.setAttribute('width', options.size);
      svg.setAttribute('height', options.size);
    }

    if (options.color) {
      svg.style.fill = options.color;
    }

    return svg;
  },

  /**
   * Get icon HTML with custom size
   * @param {string} iconName - Name of the icon
   * @param {number} size - Size in pixels
   * @returns {string} - HTML string with adjusted size
   */
  getIconHtml(iconName, size = 18) {
    const icon = this[iconName];
    if (!icon) {
      console.warn(`ControlIcons: Unknown icon "${iconName}"`);
      return '';
    }

    // Replace size attributes
    return icon
      .replace(/width="18"/g, `width="${size}"`)
      .replace(/height="18"/g, `height="${size}"`);
  }
};

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.ControlIcons = ControlIcons;
}
