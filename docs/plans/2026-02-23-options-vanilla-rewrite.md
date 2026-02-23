# Options Page Vanilla Rewrite — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the React/Vite options page with vanilla HTML/CSS/JS — zero build step, zero `node_modules`.

**Architecture:** Three static files (`index.html`, `options.css`, `options.js`) in `extension-options-page/`. Manifest points directly at HTML. All chrome.storage.sync patterns preserved exactly.

**Tech Stack:** Vanilla JS (no framework), Chrome Extension APIs (`chrome.storage.sync`, `chrome.runtime.sendMessage`)

**Design doc:** `docs/plans/2026-02-23-options-vanilla-rewrite-design.md`

---

### Task 1: Create `options.css`

**Files:**
- Create: `extension-options-page/options.css`

**Step 1: Write the CSS file**

Merge `extension-options-page/src/App.css` (228 lines) and `extension-options-page/src/index.css` (18 lines) into one file. Changes from the originals:

- Remove duplicate `* { box-sizing: border-box }` (appears in both files, keep once)
- Drop `.size-slider::-moz-range-thumb` rule (lines 180-187 of App.css) — Chrome-only extension
- Add `.hidden { display: none !important; }` utility class (for API key section toggle)
- Everything else stays identical — same selectors, same values, same dark theme

**Step 2: Verify visually**

No verification yet — CSS is static. Will be tested in Task 4.

**Step 3: Commit**

```bash
git add extension-options-page/options.css
git commit -m "Add vanilla options.css (merged from App.css + index.css)"
```

---

### Task 2: Create `options.js`

**Files:**
- Create: `extension-options-page/options.js`
- Reference: `extension-options-page/src/App.jsx` (current React implementation)

**Step 1: Write the JS file**

Port `App.jsx` logic to vanilla JS. The file structure:

```javascript
// 1. Constants — exact copies from App.jsx
const DEFAULT_TARGET_LANGUAGE = 'EN-US';
const DEFAULT_FONT_SIZE = 'medium';
const DEFAULT_PROVIDER = 'google';

const PROVIDERS = [
  { id: 'google', name: 'Google Translate', description: 'Free, no API key needed' },
  { id: 'deepl', name: 'DeepL', description: 'Best for Finnish', link: 'https://www.deepl.com/en/your-account/keys' },
  { id: 'claude', name: 'Claude (Anthropic)', description: 'High quality AI', link: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', name: 'Gemini (Google AI)', description: "Google's AI model", link: 'https://aistudio.google.com/apikey' },
  { id: 'grok', name: 'Grok (xAI)', description: "xAI's model", link: 'https://console.x.ai' },
  { id: 'kimi', name: 'Kimi (Moonshot)', description: 'Kimi 2.5 for Kimi Coding', link: 'https://platform.moonshot.ai' },
];

const FONT_SIZES = [
  { value: 'small', label: 'S', tooltip: 'Small (24px/20px)' },
  { value: 'medium', label: 'M', tooltip: 'Medium (32px/28px)' },
  { value: 'large', label: 'L', tooltip: 'Large (40px/36px)' },
  { value: 'xlarge', label: 'XL', tooltip: 'Extra Large (48px/42px)' },
  { value: 'xxlarge', label: '2K', tooltip: '2K Display (56px/50px)' },
  { value: 'huge', label: '4K', tooltip: '4K Display (64px/56px)' },
];

const LANGUAGES = [
  // Exact same array as App.jsx lines 38-74
  { code: 'EN-US', name: 'English (US)' },
  { code: 'EN-GB', name: 'English (UK)' },
  { code: 'VI', name: 'Vietnamese' },
  // ... all 34 languages ...
  { code: 'ZH-HANT', name: 'Chinese (Traditional)' },
];

// 2. State — mutable locals (replaces React useState)
let currentProvider = DEFAULT_PROVIDER;
let apiKeys = { deepl: '', claude: '', gemini: '', grok: '', kimi: '' };

// 3. DOM references — cached after DOMContentLoaded
// getElementById for: provider-list, api-key-section, api-key-input,
// api-key-link, language-select, size-slider, slider-value,
// word-cache-count, subtitle-cache-count

// 4. Render functions — called once on load
// buildProviderList() — createElement for each provider radio+label, append to provider-list
// buildLanguageSelect() — createElement <option> for each language, append to select
// Both use textContent (never innerHTML) for dynamic values

// 5. State sync functions
// updateApiKeySection() — show/hide based on currentProvider, set input value/placeholder, set link href
// updateSliderValue() — set slider-value textContent from FONT_SIZES[index].tooltip
// refreshCacheCounts() — chrome.runtime.sendMessage({ action: 'getCacheCounts' })

// 6. Event listeners (all attached in DOMContentLoaded, no inline handlers)
// Provider radio change → save old API key first, update currentProvider, chrome.storage.sync.set, updateApiKeySection()
// API key input blur → chrome.storage.sync.set({ [currentProvider + 'ApiKey']: value })
// Language select change → chrome.storage.sync.set({ targetLanguage: value })
// Size slider input → chrome.storage.sync.set({ subtitleFontSize: FONT_SIZES[index].value }), updateSliderValue()
// Clear word cache click → chrome.runtime.sendMessage({ action: 'clearWordCache' }), refreshCacheCounts()
// Clear subtitle cache click → chrome.runtime.sendMessage({ action: 'clearSubtitleCaches' }), refreshCacheCounts()

// 7. Init — DOMContentLoaded handler
// a. Cache DOM references
// b. Build provider list and language select
// c. Load all settings from chrome.storage.sync.get([...])
// d. Set form state from loaded values
// e. Attach all event listeners
// f. refreshCacheCounts()
```

Key behavioral differences from React version:
- **Save API key on provider change**: Before switching `currentProvider`, save `apiKeys[currentProvider]` to storage. React version only saved on blur, so switching provider before blurring lost edits.
- **No re-render**: DOM is built once. Updates are targeted (`el.value = x`, `el.textContent = x`, `el.classList.toggle()`).

Storage keys (must match exactly):
- `translationProvider` (default: `'google'`)
- `deeplApiKey`, `claudeApiKey`, `geminiApiKey`, `grokApiKey`, `kimiApiKey` (default: `''`)
- `targetLanguage` (default: `'EN-US'`)
- `subtitleFontSize` (default: `'medium'`)

**Step 2: Verify syntax**

No runtime test yet. Quick syntax check:

```bash
node --check extension-options-page/options.js
```

Expected: no output (clean parse). Note: `chrome.*` APIs will be undefined in Node, but `--check` only parses syntax.

**Step 3: Commit**

```bash
git add extension-options-page/options.js
git commit -m "Add vanilla options.js (ported from App.jsx)"
```

---

### Task 3: Create `index.html`

**Files:**
- Create: `extension-options-page/index.html` (overwrite existing Vite template)

**Step 1: Write the HTML file**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LLS Settings</title>
  <link rel="stylesheet" href="options.css">
</head>
<body>
  <div class="settings-page">
    <header class="settings-header">
      <h1>LLS Settings</h1>
    </header>
    <main class="settings-content">

      <!-- Translation Provider -->
      <section class="settings-section">
        <h2>Translation Provider</h2>
        <div id="provider-list" class="provider-list"></div>
        <div id="api-key-section" class="api-key-section hidden">
          <input type="password" id="api-key-input" class="api-key-input" placeholder="">
          <a id="api-key-link" class="api-key-link" href="#" target="_blank" rel="noopener noreferrer">Get API key &rarr;</a>
        </div>
      </section>

      <hr class="divider">

      <!-- Target Language -->
      <section class="settings-section">
        <h2>Target Language</h2>
        <select id="language-select" class="language-dropdown"></select>
      </section>

      <hr class="divider">

      <!-- Subtitle Size -->
      <section class="settings-section">
        <h2>Subtitle Size</h2>
        <div class="slider-container">
          <span class="slider-label">S</span>
          <input type="range" id="size-slider" class="size-slider" min="0" max="5" value="1">
          <span class="slider-label">4K</span>
        </div>
        <div id="slider-value" class="slider-value">Medium (32px/28px)</div>
      </section>

      <hr class="divider">

      <!-- Cache Management -->
      <section class="settings-section">
        <h2>Cache Management</h2>
        <div class="cache-buttons">
          <div class="cache-item">
            <button id="clear-word-cache" class="clear-cache-btn">Clear Word Cache</button>
            <span id="word-cache-count" class="cache-count">0 entries</span>
          </div>
          <div class="cache-item">
            <button id="clear-subtitle-cache" class="clear-cache-btn">Clear Subtitle Cache</button>
            <span id="subtitle-cache-count" class="cache-count">0 entries</span>
          </div>
        </div>
      </section>

    </main>
  </div>
  <script src="options.js" defer></script>
</body>
</html>
```

Note: `max="5"` on slider = `FONT_SIZES.length - 1`. Provider list and language select are empty — populated by JS.

**Step 2: Commit**

```bash
git add extension-options-page/index.html
git commit -m "Add vanilla index.html for options page"
```

---

### Task 4: Update manifest and packaging

**Files:**
- Modify: `manifest.json:72` — change `options_page`
- Modify: `package_project.sh:15` — change options page inclusion

**Step 1: Update manifest.json**

Change line 72 from:
```json
"options_page": "extension-options-page/dist/index.html"
```
to:
```json
"options_page": "extension-options-page/index.html"
```

**Step 2: Update package_project.sh**

Change line 15 from:
```
extension-options-page/dist/ \
```
to:
```
extension-options-page/index.html \
extension-options-page/options.css \
extension-options-page/options.js \
```

**Step 3: Test packaging**

```bash
bash package_project.sh
unzip -l yle-dual-sub-extension.zip | grep extension-options-page
```

Expected: exactly 3 entries:
```
extension-options-page/index.html
extension-options-page/options.css
extension-options-page/options.js
```

No `dist/`, no `.map`, no PNGs.

**Step 4: Commit**

```bash
git add manifest.json package_project.sh
git commit -m "Point manifest and packaging at vanilla options page"
```

---

### Task 5: Delete React/Vite stack

**Files:**
- Delete: `extension-options-page/src/` (entire directory)
- Delete: `extension-options-page/dist/` (entire directory)
- Delete: `extension-options-page/public/` (entire directory, if exists)
- Delete: `extension-options-page/node_modules/` (entire directory)
- Delete: `extension-options-page/package.json`
- Delete: `extension-options-page/package-lock.json`
- Delete: `extension-options-page/vite.config.js`
- Delete: `extension-options-page/.gitignore`

**Step 1: Delete all React/Vite files**

```bash
rm -rf extension-options-page/src extension-options-page/dist extension-options-page/public extension-options-page/node_modules
rm -f extension-options-page/package.json extension-options-page/package-lock.json extension-options-page/vite.config.js extension-options-page/.gitignore
```

**Step 2: Verify only target files remain**

```bash
ls -la extension-options-page/
```

Expected: `index.html`, `options.css`, `options.js`, `README.md` (4 files only).

**Step 3: Commit**

```bash
git add -A extension-options-page/
git commit -m "Remove React/Vite stack from options page"
```

---

### Task 6: Update README files

**Files:**
- Modify: `extension-options-page/README.md` — replace with vanilla description
- Modify: `README.md:115,124-127` — update stale references

**Step 1: Update options README**

Replace contents of `extension-options-page/README.md` with:

```markdown
# Extension Options Page

Vanilla HTML/CSS/JS settings UI for the extension. No build step required.

## Files

- `index.html` — Page markup
- `options.css` — Styles (dark theme)
- `options.js` — Settings logic (chrome.storage.sync)

Loaded via `manifest.json` → `options_page`.
```

**Step 2: Update root README**

In `README.md`, change line 115 from:
```
└── extension-options-page/ # React settings page
```
to:
```
└── extension-options-page/ # Settings page (vanilla HTML/CSS/JS)
```

Replace lines 124-127 (the options build section):
```bash
# Build the options page
cd extension-options-page
npm install
npm run build
```
with:
```
# Options page requires no build step (vanilla HTML/CSS/JS)
```

**Step 3: Commit**

```bash
git add extension-options-page/README.md README.md
git commit -m "Update docs to reflect vanilla options page"
```

---

### Task 7: Verify in Chrome

**Step 1: Run project-level checks**

```bash
npm test -- --runInBand
npm run type-check
```

Expected: both pass (options page changes don't affect these).

**Step 2: Load extension in Chrome**

1. Go to `chrome://extensions`
2. Click reload on the extension
3. Right-click extension icon → Options (or click "Details" → "Extension options")
4. Verify the options page loads with dark theme

**Step 3: Test all settings interactions**

Checklist:
- [ ] Provider radio buttons select correctly
- [ ] Selecting a non-Google provider shows API key input with correct placeholder
- [ ] Selecting Google hides API key section
- [ ] Typing API key and blurring saves (re-open options to verify)
- [ ] Switching provider saves the current API key first
- [ ] Language dropdown shows all 34 languages, selection persists on re-open
- [ ] Font size slider moves, tooltip updates, selection persists
- [ ] "Clear Word Cache" button works, count refreshes
- [ ] "Clear Subtitle Cache" button works, count refreshes
- [ ] No console errors on any interaction

**Step 4: Test packaging**

```bash
bash package_project.sh
unzip -l yle-dual-sub-extension.zip | grep -c extension-options-page
```

Expected: 3 (the three vanilla files only).

**Step 5: Final commit (if any fixes needed)**

Only if Chrome testing reveals issues. Otherwise, task is done.

---

### Task 8: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` — update directory structure and any references to React/Vite options page

**Step 1: Update directory structure**

In the Directory Structure section, update the `extension-options-page` entry to reflect vanilla files instead of "React-based settings UI".

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Update CLAUDE.md to reflect vanilla options page"
```
