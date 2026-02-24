// ================================
// SECTION: WebVTT Parser (YLE-focused)
// ================================

function parseVttTimestamp(value) {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) {
        return null;
    }
    const parts = normalized.split(':');
    if (parts.length !== 2 && parts.length !== 3) {
        return null;
    }
    let hours = 0;
    let minutesPart;
    let secondsPart;
    if (parts.length === 3) {
        [hours, minutesPart, secondsPart] = parts;
    } else {
        [minutesPart, secondsPart] = parts;
    }
    const [secondsOnly, millisOnly = '0'] = String(secondsPart).split('.');
    const h = Number(hours);
    const m = Number(minutesPart);
    const s = Number(secondsOnly);
    const ms = Number(String(millisOnly).padEnd(3, '0').slice(0, 3));
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s) || !Number.isFinite(ms)) {
        return null;
    }
    if (m < 0 || m > 59 || s < 0 || s > 59 || ms < 0 || ms > 999) {
        return null;
    }
    return h * 3600 + m * 60 + s + ms / 1000;
}

function parseCueTimingLine(line) {
    const match = line.match(/^\s*([0-9:.,]+)\s+-->\s+([0-9:.,]+)/);
    if (!match) {
        return null;
    }
    const startTime = parseVttTimestamp(match[1]);
    const endTime = parseVttTimestamp(match[2]);
    if (startTime === null || endTime === null || endTime <= startTime) {
        return null;
    }
    return { startTime, endTime };
}

function parseVttCues(vttText) {
    const normalized = vttText
        .replace(/\u0000/g, '\uFFFD')
        .replace(/\r\n?/g, '\n')
        .replace(/^\uFEFF/, '');
    const blocks = normalized.split(/\n{2,}/);
    const cues = [];
    for (const block of blocks) {
        if (!block.includes('-->')) {
            continue;
        }
        const lines = block.split('\n').map(line => line.trimEnd());
        const timingIndex = lines.findIndex(line => line.includes('-->'));
        if (timingIndex < 0) {
            continue;
        }
        const timing = parseCueTimingLine(lines[timingIndex]);
        if (!timing) {
            continue;
        }
        const text = lines
            .slice(timingIndex + 1)
            .join('\n')
            .trim();
        if (!text) {
            continue;
        }
        cues.push({ startTime: timing.startTime, endTime: timing.endTime, text });
    }
    cues.sort((a, b) => (a.startTime - b.startTime) || (a.endTime - b.endTime));
    return cues;
}

// ================================
// End section
// ================================

// ================================
// SECTION: Language Detection
// ================================

/**
 * Heuristic language detection from subtitle text
 * Detects Finnish, Swedish, English and other common languages
 */
const LanguageDetector = {
  // Language patterns with common words and special characters
  patterns: {
    fi: {
      // Finnish: common words and special characters ä, ö
      words: /\b(minä|sinä|hän|me|te|he|on|ovat|oli|olisi|olla|ja|tai|mutta|että|kun|jos|niin|kuin|mitä|mikä|missä|miksi|koska|kanssa|joka|jotka|myös|vain|sitten|nyt|tässä|täällä|siellä|tuolla|tänne|sinne|tänään|huomenna|eilen|aina|koskaan|joskus|ehkä|pitää|täytyy|voida|haluta|tietää|nähdä|kuulla|sanoa|mennä|tulla|ottaa|antaa)\b/gi,
      chars: /[äöÄÖ]/,
      weight: 0
    },
    sv: {
      // Swedish: common words and special character å
      words: /\b(jag|du|han|hon|den|det|vi|ni|de|är|var|vara|har|hade|och|eller|men|att|när|om|så|som|vad|vilken|var|varför|för|med|på|av|till|från|också|bara|sedan|nu|här|där|dit|idag|imorgon|igår|alltid|aldrig|ibland|kanske|måste|kan|vill|vet|ser|hör|säger|går|kommer|tar|ger)\b/gi,
      chars: /[åÅ]/,
      weight: 0
    },
    en: {
      // English: common words
      words: /\b(the|a|an|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|could|should|can|may|might|must|shall|and|or|but|if|then|else|when|where|why|how|what|which|who|this|that|these|those|here|there|now|just|only|also|very|really|always|never|sometimes|maybe|want|need|know|think|see|hear|say|go|come|take|give|get|make|let|put|use|find|tell)\b/gi,
      chars: null, // No special chars
      weight: 0
    },
    de: {
      // German: common words and special characters ü, ß
      words: /\b(ich|du|er|sie|es|wir|ihr|ist|sind|war|waren|sein|haben|hat|hatte|und|oder|aber|wenn|dann|weil|dass|als|wie|was|wer|wo|warum|für|mit|auf|von|zu|aus|auch|nur|noch|schon|jetzt|hier|dort|heute|morgen|gestern|immer|nie|manchmal|vielleicht|müssen|können|wollen|wissen|sehen|hören|sagen|gehen|kommen|nehmen|geben)\b/gi,
      chars: /[üÜßäöÄÖ]/,
      weight: 0
    },
    fr: {
      // French: common words
      words: /\b(je|tu|il|elle|nous|vous|ils|elles|est|sont|était|étaient|être|avoir|a|ont|avait|et|ou|mais|si|alors|parce|que|quand|où|pourquoi|comment|qui|quoi|ce|cette|ces|ici|là|maintenant|seulement|aussi|très|vraiment|toujours|jamais|parfois|peut-être|vouloir|devoir|pouvoir|savoir|voir|entendre|dire|aller|venir|prendre|donner)\b/gi,
      chars: /[éèêëàâäùûüïîôœçÉÈÊËÀÂÄÙÛÜÏÎÔŒÇ]/,
      weight: 0
    }
  },

  // Track detected language to avoid repeated detection
  _detected: null,
  _sampleCount: 0,
  _maxSamples: 5,

  /**
   * Detect language from a text sample
   * @param {string} text - Text to analyze
   * @returns {string|null} - Detected language code or null
   */
  detect(text) {
    if (!text || typeof text !== 'string') return null;

    // Reset weights for fresh detection
    for (const lang in this.patterns) {
      this.patterns[lang].weight = 0;
    }

    const lowerText = text.toLowerCase();

    // Check each language pattern
    for (const lang in this.patterns) {
      const pattern = this.patterns[lang];

      // Count word matches
      const wordMatches = lowerText.match(pattern.words);
      if (wordMatches) {
        pattern.weight += wordMatches.length * 2;
      }

      // Check for special characters (strong indicator)
      if (pattern.chars && pattern.chars.test(text)) {
        pattern.weight += 5;
      }
    }

    // Find language with highest weight
    let maxWeight = 0;
    let detectedLang = null;

    for (const lang in this.patterns) {
      if (this.patterns[lang].weight > maxWeight) {
        maxWeight = this.patterns[lang].weight;
        detectedLang = lang;
      }
    }

    // Only return if we have reasonable confidence (weight >= 3)
    return maxWeight >= 3 ? detectedLang : null;
  },

  /**
   * Process subtitle batch and detect language
   * @param {Array} subtitles - Array of subtitle objects with text property
   * @returns {string|null} - Detected language code or null
   */
  detectFromBatch(subtitles) {
    if (this._detected && this._sampleCount >= this._maxSamples) {
      // Already confidently detected
      return this._detected;
    }

    if (!subtitles || subtitles.length === 0) return this._detected;

    // Sample first few subtitles for detection
    const sampleSize = Math.min(10, subtitles.length);
    const sampleText = subtitles
      .slice(0, sampleSize)
      .map(s => s.text || '')
      .join(' ');

    const detected = this.detect(sampleText);

    if (detected) {
      this._sampleCount++;
      if (!this._detected) {
        this._detected = detected;

        // Dispatch event for content script
        const event = new CustomEvent('yleSourceLanguageDetected', {
          bubbles: true,
          detail: { language: detected }
        });
        document.dispatchEvent(event);
      }
    }

    return this._detected;
  },

  /**
   * Reset detection state (for new video)
   */
  reset() {
    this._detected = null;
    this._sampleCount = 0;
  }
};

// ================================
// End Language Detection
// ================================

const decoder = new TextDecoder("utf-8");

function collectSubtitlesFromVttText(vttText) {
    const subtitles = [];

    for (const cue of parseVttCues(vttText)) {
        const subtitle = cue.text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
        if (subtitle.length > 0) {
            subtitles.push({
                text: subtitle,
                startTime: cue.startTime,
                endTime: cue.endTime
            });
        }
    }

    return subtitles;
}

function dispatchBatchTranslation(subtitles) {
    if (subtitles.length === 0) {
        return;
    }

    LanguageDetector.detectFromBatch(subtitles);

    const batchEvent = new CustomEvent("sendBatchTranslationEvent", {
        bubbles: true,
        cancelable: true,
        detail: {
            subtitles
        }
    });
    document.dispatchEvent(batchEvent);
}

(function () {
    const XHR = XMLHttpRequest.prototype;

    const open = XHR.open;
    const send = XHR.send;

    XHR.open = function (method, url) {
        this._method = method;
        this._url = url;

        return open.apply(this, arguments);
    };

    XHR.send = function (_postData) {
        this.addEventListener("load", function () {

            if (typeof this._url !== "string") {
                return;
            }
            /** @type {string} */
            const requestedUrl = this._url.toLowerCase();
            if (!requestedUrl.endsWith(".vtt")) {
                return;
            }

            try {
                const fullVttFileResponseText = decoder.decode(this.response);
                const allSubtitles = collectSubtitlesFromVttText(fullVttFileResponseText);
                dispatchBatchTranslation(allSubtitles);
            } catch (e) {
                console.error("YleDualSubExtension: Failed to parse VTT file:", e);
            }
        });

        return send.apply(this, arguments);
    };
})();

// Also intercept fetch API for VTT files (modern video players often use fetch)
(function () {
    const originalFetch = window.fetch;

    window.fetch = async function (input) {
        const response = await originalFetch.apply(this, arguments);

        // Get the URL from the input
        let url = '';
        if (typeof input === 'string') {
            url = input;
        } else if (input instanceof Request) {
            url = input.url;
        }

        // Check if this is a VTT file
        if (url.toLowerCase().endsWith('.vtt')) {
            try {
                // Clone the response so we can read it without consuming the original
                const clonedResponse = response.clone();
                const text = await clonedResponse.text();
                const allSubtitles = collectSubtitlesFromVttText(text);
                dispatchBatchTranslation(allSubtitles);
            } catch (e) {
                console.error("YleDualSubExtension: [fetch] Failed to parse VTT file:", e);
            }
        }

        return response;
    };
})();
