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
  },

  /**
   * Filter subtitles to get non-verbal segments (for display)
   * @param {Array<{startTime: number, endTime: number, text: string}>} subtitles
   * @returns {Array<{startTime: number, endTime: number, text: string}>} - Non-verbal segments
   */
  filterNonVerbalSegments(subtitles) {
    if (!Array.isArray(subtitles)) return [];

    return subtitles.filter(sub => {
      if (typeof sub.startTime !== 'number' || typeof sub.endTime !== 'number') {
        return false;
      }
      return this.isNonVerbal(sub.text);
    });
  },

  /**
   * Merge adjacent segments with small gaps to reduce seek operations
   * @param {Array<{startTime: number, endTime: number, text: string}>} segments
   * @param {number} [maxGap=0.3] - Maximum gap in seconds to merge
   * @returns {Array<{startTime: number, endTime: number, text: string, merged: boolean}>}
   */
  mergeAdjacentSegments(segments, maxGap = 0.3) {
    if (!segments || segments.length === 0) return [];

    // Sort by start time first
    const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
    const merged = [];
    let current = { ...sorted[0], merged: false };

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];
      const gap = next.startTime - current.endTime;

      if (gap <= maxGap) {
        // Merge: extend current segment to include next
        current.endTime = next.endTime;
        current.text = current.text + ' ' + next.text;
        current.merged = true;
      } else {
        // Gap too large, push current and start new
        merged.push(current);
        current = { ...next, merged: false };
      }
    }

    // Push the last segment
    merged.push(current);

    return merged;
  },

  /**
   * Calculate total duration of segments
   * @param {Array<{startTime: number, endTime: number}>} segments
   * @returns {number} - Total duration in seconds
   */
  getTotalDuration(segments) {
    if (!Array.isArray(segments)) return 0;

    return segments.reduce((sum, seg) => {
      const duration = (seg.endTime || 0) - (seg.startTime || 0);
      return sum + Math.max(0, duration);
    }, 0);
  },

  /**
   * Format duration in seconds to readable string
   * @param {number} seconds
   * @returns {string} - Formatted as "MM:SS" or "HH:MM:SS"
   */
  formatDuration(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  },

  /**
   * Get summary of filtering results
   * @param {Array<{startTime: number, endTime: number, text: string}>} allSubtitles
   * @returns {Object} - Summary with counts and durations
   */
  getFilteringSummary(allSubtitles) {
    const speech = this.filterSpeechSegments(allSubtitles);
    const nonVerbal = this.filterNonVerbalSegments(allSubtitles);

    return {
      totalSegments: allSubtitles.length,
      speechSegments: speech.length,
      nonVerbalSegments: nonVerbal.length,
      speechDuration: this.getTotalDuration(speech),
      nonVerbalDuration: this.getTotalDuration(nonVerbal),
      speechDurationFormatted: this.formatDuration(this.getTotalDuration(speech)),
      nonVerbalDurationFormatted: this.formatDuration(this.getTotalDuration(nonVerbal)),
      nonVerbalTypes: this._categorizeNonVerbal(nonVerbal)
    };
  },

  /**
   * Categorize non-verbal segments by type
   * @param {Array<{text: string}>} segments
   * @returns {Array<string>} - Unique categories found
   * @private
   */
  _categorizeNonVerbal(segments) {
    const categories = new Set();

    for (const seg of segments) {
      const text = (seg.text || '').toLowerCase();
      if (text.includes('music')) categories.add('[music]');
      else if (text.includes('applause')) categories.add('[applause]');
      else if (text.includes('laughter')) categories.add('[laughter]');
      else if (text.includes('cheering')) categories.add('[cheering]');
      else if (text.includes('singing')) categories.add('[singing]');
      else if (text.includes('inaudible')) categories.add('[inaudible]');
      else if (text.includes('silence')) categories.add('[silence]');
      else categories.add('[other]');
    }

    return Array.from(categories);
  }
};

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.AudioFilters = AudioFilters;
}
