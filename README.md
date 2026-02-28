# YLE Finnish Learner

A Chrome extension for learning Finnish through YLE Areena (Finnish public broadcasting). Display dual subtitles, click any word for instant translation, and control playback to study at your own pace.

## Currently Supported

- **YLE Areena** (areena.yle.fi) - Finnish public broadcasting with Finnish subtitles

> **Note:** This extension currently supports YLE Areena only. Support for additional platforms (YouTube, Netflix, etc.) is planned for future releases.

## Features

- **Dual Subtitles**: Original subtitles with translations in your target language displayed below
- **Popup Dictionary**: Click any word to see its translation
  - Wiktionary definitions when available
  - AI-powered contextual translation as fallback (Claude/Gemini/Grok)
  - "Ask AI" button for alternative translations
- **Auto-Pause**: Automatically pause after each subtitle line (toggle with P key)
- **Subtitle Navigation**: Skip to previous/next subtitle with `,` and `.` keys
- **Repeat**: Replay current subtitle from the beginning (R key)
- **Playback Speed Control**: Adjust from 0.5x to 2x with `[` and `]` keys
- **Audio Download**: Download speech audio with filler sounds removed (A key)
- **Multiple Translation Providers**:
  - Google Translate (free, no API key required)
  - DeepL (high quality, free API key available)
  - Claude, Gemini, Grok, Kimi (AI-powered with context)
- **Smart Caching**: Translations cached locally for instant replay
- **Clean Viewing Mode**: Controls and background shade hide during playback, subtitles drop to bottom for unobstructed viewing
- **Fullscreen Support**: All features work in fullscreen mode

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `D` | Toggle dual subtitles |
| `,` | Skip to previous subtitle |
| `.` | Skip to next subtitle |
| `R` | Repeat current subtitle |
| `P` | Toggle auto-pause |
| `[` | Decrease playback speed |
| `]` | Increase playback speed |
| `A` | Download audio (speech only) |
| `Space` | Play/pause video |

## Installation

### Chrome Web Store

[**Install from Chrome Web Store**](https://chromewebstore.google.com/detail/yle-finnish-learner/iiganofenpnkdhnmjjmfoilobopapmnj)

### Manual Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the extension folder
5. The extension icon will appear in your toolbar

## Setup

### YLE Areena
1. Go to [YLE Areena](https://areena.yle.fi/)
2. Play any video and enable Finnish subtitles via the player's subtitle menu
3. Enable "Dual Sub" in the control bar
4. Click any word to see its translation

### Settings
Click the extension icon → Settings to:
- Choose your target language
- Select translation provider
- Add API keys for premium providers

### Translation Providers

You can choose your translation engine in Settings. The default is free Google Translate; all other providers require your own API key.

> **Cost disclaimer:** The estimates below are illustrative and speculative, not billing guarantees.

| Provider | API Key Required | Notes | Illustrative monthly cost notes (speculative) |
|----------|------------------|-------|-----------------------------------------------|
| Google Translate | No | Default free provider. Uses throttling to reduce free-endpoint rate limits. | `$0` direct API spend in this extension (free endpoint), but rate limits and slower throughput may affect UX. |
| Google Cloud (v2) | Yes | Paid Google Cloud Translation API. Usage charges apply. | Character-based billing. Using scenarios below: Light `0.24*R`, Regular `0.72*R`, Heavy `1.44*R` where `R = price per 1M chars`. |
| DeepL | Yes | Uses DeepL API key (free or paid plan depending on your account). | If on paid per-character pricing: Light `0.24*D`, Regular `0.72*D`, Heavy `1.44*D` where `D = price per 1M chars` (or equivalent plan cost). |
| Claude | Yes | Uses Anthropic API key for contextual translation. | Token-based. Approximate with: `monthly_cost ~= (billable_tokens/1M) * C`, where `C = your Claude rate per 1M tokens`. |
| Gemini | Yes | Uses Google AI Studio API key for contextual translation. | Token/request-based by model/plan. Approximate with: `monthly_cost ~= (billable_tokens/1M) * G`, where `G = your Gemini rate per 1M tokens`. |
| Grok | Yes | Uses xAI API key for contextual translation. | Token-based. Approximate with: `monthly_cost ~= (billable_tokens/1M) * X`, where `X = your Grok rate per 1M tokens`. |
| Kimi | Yes | Uses Moonshot API key for contextual translation. | Token-based. Approximate with: `monthly_cost ~= (billable_tokens/1M) * K`, where `K = your Kimi rate per 1M tokens`. |

> **Note on Google Cloud:** Billing is character-based. Set API key restrictions, quota limits, and budget alerts before enabling it.
>
> **Quick cost estimator (illustrative):**
> - `monthly_characters ~= watched_minutes_per_month * characters_per_minute`
> - `monthly_cost ~= (monthly_characters / 1,000,000) * price_per_1M_characters`
>
> **Example scenarios (for planning only):**
> - Light use: `~300 min/month * ~800 chars/min ~= 240,000 chars/month`
> - Regular use: `~900 min/month * ~800 chars/min ~= 720,000 chars/month`
> - Heavy use: `~1,800 min/month * ~800 chars/min ~= 1,440,000 chars/month`
>
> If your current Google Cloud rate is `R` per 1M characters, estimated monthly cost is:
> - Light: `0.24 * R`
> - Regular: `0.72 * R`
> - Heavy: `1.44 * R`
>
> **Token-based providers (Claude/Gemini/Grok/Kimi) rough framework (illustrative):**
> - `billable_tokens ~= (monthly_characters / chars_per_token) * overhead_factor`
> - `monthly_cost ~= (billable_tokens / 1,000,000) * provider_rate_per_1M_tokens`
> - Typical planning assumptions (speculative): `chars_per_token ~= 4`, `overhead_factor ~= 1.2 to 2.0` (prompt + context + retries).
>
> Check current rates on the official pricing page: https://cloud.google.com/translate/pricing

## How It Works

1. Extension intercepts subtitle data from YLE Areena (WebVTT format)
2. Original subtitles are displayed with translations below
3. Clicking a word queries Wiktionary, then falls back to AI translation
4. All translations are cached locally in IndexedDB

## Development

### Project Structure

```
├── manifest.json           # Chrome extension manifest (v3)
├── background.js           # Service worker (direct source)
├── contentscript.js        # Main content script (direct source)
├── content/                # Content-script modules (direct source)
│   ├── settings.js         # Settings + state management
│   ├── word-translation.js # Popup dictionary + tooltip logic
│   ├── subtitle-dom.js     # Subtitle DOM + mutation observers
│   ├── ui-events.js        # Mouse/focus handling + UI event listeners
│   └── runtime-messages.js # Popup + runtime message handlers
├── database.js             # IndexedDB caching
├── styles.css              # UI styling
├── popup.html/js           # Extension popup
├── platforms/
│   └── yle/                # YLE Areena injected adapter
├── controls/               # Unified control panel
│   ├── control-panel.js    # UI components
│   ├── control-actions.js  # Action handlers
│   ├── control-keyboard.js # Keyboard shortcuts
│   └── audio-*.js          # Audio recording/download
└── extension-options-page/ # Settings page (vanilla HTML/CSS/JS)
```

### Building

```bash
# No build step required.
# Source files are shipped directly.
```

### Engineering Principle

- Ultimate simplicity: one authoritative trigger, one deterministic path, no symptom-level fallbacks.
- See: `docs/principles/ultimate-simplicity.md`

### Testing

Load the extension in developer mode and test on YLE Areena.

## Privacy

- All caching is local (IndexedDB in your browser)
- API keys stored in Chrome sync storage
- No analytics or tracking
- Only sends data to your chosen translation provider

## Changelog

### v6.0.0 (February 2026)
- **Changed:** Zero external dependencies — no build step, no npm packages, source JS loaded directly by Chrome
- **Changed:** Owned MP3 encoder replaces lamejs/shine external libraries
- **Changed:** TypeScript removed — plain JS with JSDoc type annotations
- **Improved:** Codebase reduced 26% (~5,400 lines) through recursive dead code audit
- **Improved:** All features preserved with simpler, more maintainable architecture

### v5.3.0 (February 2026)
- **Fixed:** Dual subtitles not displaying due to YLE Areena player DOM restructure
- **Improved:** Subtitle rendering now uses a generic text finder, resilient to future YLE DOM changes
- **Improved:** Subtitle font size syncs with YLE's dynamic player sizing

### v5.2.1 (February 2026)
- **Fixed:** Hide share overlay and play/pause animation during playback

### v5.2.0 (February 2026)
- **New:** Clean viewing mode — controls and background shade auto-hide during playback, subtitles drop to bottom for unobstructed viewing
- **Improved:** Subtitle repositioning when controls show/hide

### v5.1.0 (January 2026)
- **New:** Auto-pause at end of each subtitle line
- **New:** CC on/off detection via TextTrack API
- **Improved:** Unified control panel with all playback features

## Contributing

Contributions welcome! Please open issues for bugs or feature requests.

## License

[GPL v3](LICENSE) (GNU General Public License v3)

## Acknowledgments

- Originally forked from [yle-dual-sub](https://github.com/anhtumai/yle-dual-sub) by Anh Tu Mai
- Inspired by [Language Reactor](https://www.languagereactor.com/)
- [Wiktionary](https://en.wiktionary.org/) for word definitions
- [YLE Areena](https://areena.yle.fi/) for Finnish content
