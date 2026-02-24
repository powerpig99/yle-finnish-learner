/**
 * Audio Filters Module
 *
 * Filters subtitle segments to identify speech vs non-verbal content.
 * Used for audio download feature to remove filler/music/sound effects.
 */

const AudioFilters = {
  /**
   * Patterns that match non-verbal content (music, sounds, etc.)
   * These will be excluded from speech audio downloads
   */
  NON_VERBAL_PATTERNS: [
    /^\s*\[.*\]\s*$/i,           // [music], [applause], [laughter]
    /^\s*\(.*\)\s*$/i,           // (sighs), (door creaks)
    /^\s*♪.*♪\s*$/,              // Music notes surrounding text
    /^\s*♪\s*$/,                 // Just music note
    /^\s*♫.*♫\s*$/,              // Double music notes
    /^\s*\*.*\*\s*$/,            // *sound effects*
    /\[music\]/i,
    /\[music playing\]/i,
    /\[applause\]/i,
    /\[laughter\]/i,
    /\[cheering\]/i,
    /\[crowd noise\]/i,
    /\[inaudible\]/i,
    /\[background.*\]/i,
    /\[silence\]/i,
    /\[no audio\]/i,
    /\[♪.*\]/,                   // [♪ music ♪]
    /\[singing\]/i,
    /\[humming\]/i,
    /\[instrumental\]/i,
    /\[theme music\]/i,
    /\[dramatic music\]/i,
    /\[upbeat music\]/i,
    /\[soft music\]/i,
  ],

  /**
   * Check if text represents non-verbal content
   * @param {string} text - Subtitle text to check
   * @returns {boolean} - True if non-verbal (should be excluded)
   */
  isNonVerbal(text) {
    if (!text || typeof text !== 'string') return true;
    const trimmed = text.trim();
    if (!trimmed) return true;

    return this.NON_VERBAL_PATTERNS.some(pattern => pattern.test(trimmed));
  },

  /**
   * Check if text is likely speech content
   * @param {string} text - Subtitle text to check
   * @returns {boolean} - True if speech (should be included)
   */
  isSpeech(text) {
    return !this.isNonVerbal(text);
  },

  /**
   * Filter subtitles to only include speech segments
   * @param {Array<{startTime: number, endTime: number, text: string}>} subtitles
   * @returns {Array<{startTime: number, endTime: number, text: string}>} - Only speech segments
   */
  filterSpeechSegments(subtitles) {
    if (!Array.isArray(subtitles)) return [];

    return subtitles.filter(sub => {
      // Must have valid timing
      if (typeof sub.startTime !== 'number' || typeof sub.endTime !== 'number') {
        return false;
      }
      // Must have positive duration
      if (sub.endTime <= sub.startTime) {
        return false;
      }
      // Must be speech content
      return this.isSpeech(sub.text);
    });
  }
};

window.AudioFilters = AudioFilters;
