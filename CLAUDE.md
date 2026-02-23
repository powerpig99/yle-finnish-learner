# Language Learning Subtitles Extension - Development Guide

## Development Workflow Reminders

> **TEST ON CHROME:** Always test changes directly in Chrome browser. Don't assume code works - verify it:
> 1. Reload extension at `chrome://extensions`
> 2. Refresh the target page (YLE Areena)
> 3. Verify the feature works visually
> 4. Check browser console for errors/logs

> **IMPORTANT:** After fixing bugs that required significant debugging effort, update this CLAUDE.md file with:
> 1. The problem description
> 2. Root cause analysis
> 3. The fix location (file and line numbers)
> 4. Code snippets if helpful
>
> This prevents re-debugging the same issues in future sessions.

---

## Project Overview
A Chrome extension (v5.3.0, Manifest v3) that provides dual subtitles (original + translation), popup dictionary, and playback controls for YLE Areena (Finnish public broadcasting).

**Chrome Web Store:** v5.3.0 submitted February 2026 (pending review)

**Supported Platform:** YLE Areena only (`https://areena.yle.fi/*`)

## Directory Structure

```
yle-language-reactor/
├── TypeScript source (compiled to dist/ via npm run build:extension)
│   ├── background.ts         # Service worker for translation handling
│   ├── contentscript.ts      # Main content script (YLE-specific)
│   └── content/              # Content-script modules
│       ├── settings.ts       # Settings, state, auto-pause, CC detection
│       ├── subtitle-dom.ts   # Subtitle DOM, mutation observers, getSubtitleTextElements()
│       ├── ui-events.ts      # Mouse/focus handling, UI event listeners
│       ├── word-translation.ts # Popup dictionary + tooltip logic
│       ├── translation-api.ts  # Translation API calls
│       ├── translation-queue.ts # Batch translation queue
│       └── runtime-messages.ts  # Popup + runtime message handlers
│
├── Plain JS (not compiled)
│   ├── inject.js             # Script injector for YLE
│   ├── database.js           # IndexedDB word translation cache
│   ├── utils.js              # Storage utilities
│   ├── popup.js              # Minimal popup handler
│   └── types.js              # Type definitions
│
├── controls/                 # Control panel modules (plain JS)
│   ├── control-panel.js      # Main ControlPanel class
│   ├── control-actions.js    # Action handlers (skip/repeat/speed)
│   ├── control-keyboard.js   # Keyboard handler
│   ├── control-integration.js # Bridge to contentscript
│   ├── control-icons.js      # SVG icon definitions
│   ├── audio-recorder.js     # Web Audio API recording
│   ├── audio-encoder.js      # MP3 encoding using lamejs
│   ├── audio-filters.js      # Speech vs non-verbal detection
│   ├── audio-download-ui.js  # Download dialog UI
│   └── screen-recorder.js    # Screen capture recording for DRM
│
├── platforms/yle/            # YLE-specific adapter
│   ├── yle-adapter.ts        # YLE Areena implementation (compiled to dist/)
│   └── yle-injected.js       # Page-context VTT interception (plain JS)
│
├── Other
│   ├── manifest.json         # Chrome Extension Manifest v3
│   ├── styles.css            # Unified styles with `dsc-*` prefix
│   ├── extension-options-page/ # Settings UI (vanilla HTML/CSS/JS)
│   ├── lib/lamejs.min.js     # MP3 encoding library
│   └── icons/icon.png        # Extension icon
```

## Architecture

### Control Modules Detail

**control-panel.js** - Main ControlPanel class
- Manages UI state (dualSubEnabled, autoPauseEnabled, speed, language)
- Handles mount/unmount to YLE's control bar

**control-actions.js** - Action handlers
- `togglePlayPause()` - Play/pause video
- `skipToPreviousSubtitle()` - Navigate to prev subtitle
- `skipToNextSubtitle()` - Navigate to next subtitle
- `repeatCurrentSubtitle()` - Play subtitle segment loop
- `setPlaybackSpeed()` - Speed control (0.5x - 2.0x)
- `getVideoElement()` - Get video element

**control-keyboard.js** - Keyboard handler
- `ControlKeyboard` class with unified key bindings

**control-integration.js** - Bridge to contentscript
- Manages subtitle data: `_subtitles` array (with startTime/endTime)
- State management: loads/saves to Chrome storage.sync
- Audio download handlers (screen capture for YLE's DRM)
- Handles all callbacks from ControlPanel

**control-icons.js** - SVG icon definitions (18x18 viewBox)
- Icons: settings, previous, next, repeat, warning, speed, play, pause, subtitles, language, autoPause, download

### YLE Configuration

| Setting | Value |
|---------|-------|
| URL Match | `https://areena.yle.fi/*` |
| Source Language | Finnish (FI) - auto-detected |
| Controls Mount | `[class^="BottomControlBar__LeftControls"]` |
| Subtitle Selector | `[data-testid="subtitles-wrapper"]` |
| Audio Download | Screen recording (DRM protection) |

### Features

| Feature | Behavior | Location |
|---------|----------|----------|
| Clickable original text | ALWAYS shown, even when dual sub OFF | `addContentToDisplayedSubtitlesWrapper` |
| Translation line | Only shown when dual sub ON | Same function, check `dualSubEnabled` |
| Word popup dictionary | Click any word -> translation popup | `createSubtitleSpanWithClickableWords` |
| Skip prev/next | Jump to previous/next subtitle | `ControlActions.skipToPreviousSubtitle/skipToNextSubtitle` |
| Repeat | Play from subtitle start to current position | `ControlActions.repeatCurrentSubtitle` |
| Auto-pause | Pause at end of each subtitle (setTimeout-based) | `scheduleAutoPause()` in settings.ts, video event listeners |
| Speed control | 0.5x - 2.0x playback | `ControlActions.setPlaybackSpeed` |

### Subtitle Processing Pipeline

**Detection & Interception:**
- Page-context VTT interception via `yle-injected.js`

**Main Processing (contentscript.js):**
1. MutationObserver watches subtitle wrapper
2. Batch translation (~2-4 subtitles at a time)
3. Accumulates into `fullSubtitles` array (CRITICAL: must accumulate, not replace)
4. Maps original -> translated text
5. Displays in dual-line format when enabled

**Key Arrays Maintained:**
- `subtitleTimestamps` - Quick lookup for skip/repeat (time, text)
- `fullSubtitles` - Complete array with startTime/endTime for repeat feature
- `sharedTranslationMap` - Cache of translations

### Audio Download Pipeline

**Files Involved:**
- `screen-recorder.js` - Records screen/tab with audio (YLE uses DRM)
- `audio-filters.js` - Removes non-verbal segments (music, effects)
- `audio-encoder.js` - Encodes to MP3 using lamejs
- `audio-download-ui.js` - Shows progress and download UI

**Flow:**
1. User presses `A` or clicks download button
2. `ControlIntegration._handleDownloadAudio()` called
3. Use ScreenRecorder (YLE has DRM protection)
4. Extract speech segments using AudioFilters
5. Encode to MP3 using lamejs
6. Trigger chrome.downloads API via background.js

### Core Scripts

**background.js** - Service worker (Manifest v3)
- Message handlers: `fetchTranslation`, `fetchBatchTranslation`, `translateWordWithContext`, `clearWordCache`, `downloadBlob`
- Translation provider management (Google, DeepL, Claude, Gemini, xAI)
- Listens to `chrome.storage.onChanged` for provider updates

**contentscript.js** - Main content script
- YLE-specific initialization
- Subtitle observation and display
- Translation request batching
- Word click handlers (popup dictionary)
- Auto-pause logic (setTimeout-based, pauses at subtitle endTime)
- Integration with ControlIntegration

**database.js** - IndexedDB wrapper
- Schema: `{word, context, translation, provider, timestamp}`
- Methods: `addWordTranslation()`, `getWordTranslation()`, `clearOldCache()`

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `D` | Toggle dual subtitles |
| `,` | Previous subtitle |
| `.` | Next subtitle |
| `R` | Repeat current subtitle |
| `P` | Toggle auto-pause |
| `[` | Decrease speed |
| `]` | Increase speed |
| `A` | Download audio (screen recording) |

## Translation Providers

Configured in extension options:
- Google Translate (free, default)
- DeepL (free/pro API)
- Claude AI (Anthropic)
- Gemini (Google)
- xAI (Grok)

---

## Critical Learnings

### 1. YLE Menu Focus Issue (IMPORTANT)
**Problem:** YLE's settings menus (Audio/Subtitles) close immediately when clicked.

**Root Cause:** In `contentscript.js`, there's a click handler that calls `setTimeout(focusVideo, 100)` after clicks on the control bar area. This steals focus from YLE's menus.

**Solution (lines ~1448-1457 in contentscript.js):**
```javascript
// Don't focus video when clicking on YLE settings buttons or menus
if (target.closest('[class*="SettingsButton"]') ||
    target.closest('[class*="Settings__"]') ||
    target.closest('[class*="TopLevelSettings"]') ||
    target.closest('[aria-label*="Tekstitykset"]') ||
    target.closest('[aria-label*="Asetukset"]') ||
    target.closest('[aria-label*="Ääni"]')) {
  return;
}
```

### 2. YLE Subtitles Requirement
YLE's native subtitles MUST be enabled through their player UI first. Our extension intercepts and enhances them - it doesn't create subtitles from scratch.

- Subtitles wrapper selector: `[data-testid="subtitles-wrapper"]`
- MutationObserver watches for changes to this wrapper
- When `dualSubEnabled` is true, original wrapper is hidden, displayed wrapper shows clickable words + translation

### 3. Extension Reload Required
Chrome extensions do NOT auto-reload when source files change. After editing:
1. Go to `chrome://extensions`
2. Find the extension and click reload
3. Refresh the target page

### 4. Control Panel Mount Point
YLE control panel mounts to `[class^="BottomControlBar__LeftControls"]`

### 5. Subtitle Navigation (Skip/Repeat) - CRITICAL
For skip prev/next/repeat to work, subtitles must be synced to `ControlIntegration`.

**Subtitle Accumulation Issue:**

YLE loads subtitles in small batches (2-4 at a time) via `handleBatchTranslation()`. The repeat function needs ALL subtitles with `startTime` and `endTime` to work properly.

**Problem:** If you call `ControlIntegration.setSubtitles(currentBatch)` with each batch, it REPLACES the previous subtitles. The repeat function then only sees the latest small batch (2-4 subtitles) instead of all 90+ subtitles.

**Solution:** Use `fullSubtitles` array that ACCUMULATES like `subtitleTimestamps`:
```javascript
// In handleBatchTranslation() - ACCUMULATE, don't replace
for (const sub of subtitles) {
  if (sub.startTime !== undefined && sub.endTime !== undefined) {
    const existing = fullSubtitles.find(fs => Math.abs(fs.startTime - sub.startTime) < 0.5);
    if (!existing) {
      fullSubtitles.push({ startTime: sub.startTime, endTime: sub.endTime, text: sub.text });
    }
  }
}
fullSubtitles.sort((a, b) => a.startTime - b.startTime);

// Sync ACCUMULATED array, not current batch
ControlIntegration.setSubtitles(fullSubtitles);
```

### 6. YLE Mouse Activity & Cursor
Controls only show when mouse enters edge zones of the player (bottom 80px or top 60px), not on any mouse movement. Cursor auto-hides after 2.5s of inactivity via `yle-cursor-active` class. To show controls programmatically:
```javascript
const playerUI = document.querySelector('[class*="PlayerUI"]');
playerUI.classList.add('yle-mouse-active');   // shows controls
playerUI.classList.add('yle-cursor-active');  // shows cursor
```

### 7. YLE Video Overlay Closes When Showing Modals (IMPORTANT)
**Problem:** On YLE, clicking buttons that show modal dialogs (like the audio download confirmation) would close the video overlay, returning to the series page.

**Root Cause:** YLE's video player opens as an overlay on the series page (URL stays the same). When our extension appends modal elements to `document.body`, YLE interprets this DOM manipulation as a signal to close the video overlay.

**Solution (in `control-integration.js`):**
For YLE, skip showing any custom modals and go directly to the action:
```javascript
async _handleDownloadAudio() {
  // YLE uses DRM protection - go directly to screen recording
  // Showing any modal closes the video overlay
  const video = ControlActions.getVideoElement();
  if (!video) {
    console.error('DualSubExtension: No video found');
    return;
  }

  // Start recording directly without modal
  await this._startYLERecording(video, speechSegments);
}
```

### 8. Manifest V3 Service Worker Termination
**Problem:** Chrome can terminate the background service worker at any time to save resources. If a translation request is pending when this happens, the content script receives "message channel closed before a response was received" error, causing translations to fail.

**Solution (in `contentscript.js`):**
Added retry logic to `fetchTranslation()` and `fetchBatchTranslation()`:
```javascript
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  try {
    const response = await safeSendMessage({...});
    if (response === null && attempt < MAX_RETRIES - 1) {
      await sleep(RETRY_DELAY);  // Wait for service worker to restart
      continue;
    }
    return response;
  } catch (error) {
    const isServiceWorkerError = error.message?.includes('message channel closed');
    if (isServiceWorkerError && attempt < MAX_RETRIES - 1) {
      await sleep(RETRY_DELAY);
      continue;
    }
  }
}
```

### 9. Subtitle Sync Timing for Audio Download (IMPORTANT - REGRESSION PRONE)
**Problem:** The "Please wait for subtitles to load" error appears even when subtitles are loaded, because they weren't synced to `ControlIntegration._subtitles`.

**Root Cause:** The sync calls had an `isInitialized()` check:
```javascript
// WRONG - this was the bug
if (typeof ControlIntegration !== 'undefined' && ControlIntegration.isInitialized()) {
  ControlIntegration.setSubtitles(fullSubtitles);  // Never called if panel not mounted!
}
```
`isInitialized()` requires the panel to be MOUNTED, but `setSubtitles()` just stores data - it doesn't need the panel. When panel mount was delayed (retry pending), subtitles never got synced.

**Solution:**
1. Remove `isInitialized()` check from all `setSubtitles` calls:
```javascript
// CORRECT - just check if ControlIntegration exists
if (typeof ControlIntegration !== 'undefined') {
  ControlIntegration.setSubtitles(fullSubtitles);
}
```

2. Export `fullSubtitles` to window for cross-module access:
```javascript
const fullSubtitles = [];
window.fullSubtitles = fullSubtitles;  // For fallback access from control-integration.js
```

**Key insight:** `setSubtitles()` just stores data - don't guard it with UI-dependent checks like `isInitialized()`.

### 10. Array Reference Bug in setSubtitles (CRITICAL)
**Problem:** Even after `setSubtitles(fullSubtitles)` was called, `_subtitles` would be empty when download was triggered.

**Root Cause:** `setSubtitles` stored a REFERENCE to the array, not a copy:
```javascript
// WRONG - stores reference
this._subtitles = subtitles;
```
When the navigation handler later did `fullSubtitles.length = 0`, it cleared the SAME array that `_subtitles` pointed to!

**Solution:** Deep copy the array in `setSubtitles()`:
```javascript
// CORRECT - stores a copy
this._subtitles = subtitles.map(sub => ({ ...sub }));
```

**Key insight:** When storing arrays that may be modified elsewhere, ALWAYS copy them. Watch out for `.length = 0` pattern which clears arrays in-place.

### 11. Extension Context Invalidated Error (PENDING FIX)
**Problem:** After switching tabs or changing language settings, the extension panel stops working. Console shows "Extension context invalidated" errors.

**Root Cause:** When the extension is reloaded (manually or via Chrome update), the content scripts on already-open pages keep running but lose access to `chrome.*` APIs. Any call to `chrome.storage.sync.get()`, `chrome.runtime.sendMessage()`, etc. will throw "Extension context invalidated".

**Symptoms:**
- "DualSubExtension: Error loading preferences: Error: Extension context invalidated"
- "Uncaught Error: Extension context invalidated"
- "Google Translate fetch error: Failed to fetch"
- Panel doesn't respond to keyboard shortcuts
- Translations stop loading

**Workaround:** Refresh the page after the extension is reloaded.

### 12. Same Language Mode Disabling ALL Controls (Session 2026-01-20)
**Problem:** With source=target language (Finnish→Finnish), ALL control panel features were disabled (skip/repeat/speed/download grayed out), not just the DS (Dual Subtitles) toggle.

**Root Cause:** In `control-panel.js`, the `featuresDisabled` logic incorrectly used `isActive`:
```javascript
// Line 258 - WRONG
const featuresDisabled = !extensionEnabled || !isActive;
```

When same language is detected, `isActive` becomes `false` (because translation isn't needed), which caused ALL features to be disabled. But playback features (skip/repeat/speed/download) should work even when translation isn't needed.

**Solution:** Only consider `extensionEnabled` for disabling features:
```javascript
// Line 258-260 - CORRECT
// Features (skip/repeat/speed/download) are only disabled when extension is OFF
// NOT when same language - user should still be able to use playback features
const featuresDisabled = !extensionEnabled;
```

### 13. Events Module Using ControlPanel Class Instead of Instance (Session 2026-01-21)
**Problem:** The extension switch was always disabled even when CC was on and subtitles were detected.

**Root Cause:** In `events.js`, the `_updateUI()` method was checking `ControlPanel._mounted` and calling `ControlPanel.updateFromState()`, but `ControlPanel` is a CLASS - the actual panel instance is stored in `ControlIntegration._panel`.

**Solution (events.js):**
```javascript
// CORRECT - Use the actual panel instance from ControlIntegration
if (typeof ControlIntegration !== 'undefined' && ControlIntegration._panel && ControlIntegration._panel._mounted) {
  ControlIntegration._panel.updateFromState({...});
}
```

### 14. YLE CC Off Not Detected - Use TextTrack API (Session 2026-02-08)
**Problem:** When CC is turned off via YLE's menu, the control panel UI was not grayed out and buttons remained clickable. Both functionality and UI stayed enabled.

**Root Cause:** The old `setupYleWrapperStyleObserver()` watched for `getComputedStyle(wrapper).display === 'none'`, but YLE never sets `display: none` on the subtitles-wrapper. YLE keeps the wrapper in the DOM with `display: flex` and simply stops populating it with child spans.

**Solution (content/settings.ts):**
Use the `video.textTracks` API which fires a `change` event immediately when CC is toggled. YLE sets track mode to `'hidden'` when CC is ON and `'disabled'` when CC is OFF:
```typescript
// In setupVideoSpeedControl(), after getting the video element:
let _ccWasActive = Array.from(video.textTracks).some(t => t.mode !== 'disabled');
video.textTracks.addEventListener('change', () => {
  const ccActive = Array.from(video.textTracks).some(t => t.mode !== 'disabled');
  if (_ccWasActive && !ccActive) {
    _ccWasActive = false;
    document.dispatchEvent(new CustomEvent('yleNativeCaptionsToggled', {
      bubbles: true, detail: { enabled: false }
    }));
  } else if (!_ccWasActive && ccActive) {
    _ccWasActive = true;
    document.dispatchEvent(new CustomEvent('yleNativeCaptionsToggled', {
      bubbles: true, detail: { enabled: true }
    }));
  }
});
```

**Key insight:** Don't observe DOM style changes when there's a proper API. `video.textTracks` provides a direct, instant signal for CC state changes. Note: don't guard with `textTracks.length > 0` — tracks load asynchronously after the video element appears.

### 15. Property Name Mismatch Between Modules - captionsEnabled vs ccEnabled (Session 2026-01-21)
**Problem:** The panel wasn't disabled when CC was turned off, even after adding CC detection logic.

**Root Cause:** Property name mismatch between modules:
- `ControlIntegration` passed `captionsEnabled: true/false`
- `ControlPanel` expected `ccEnabled: true/false`

**Solution (control-integration.js):**
```javascript
// BEFORE - wrong property name
captionsEnabled: this._state.captionsEnabled,

// AFTER - correct property name
ccEnabled: this._state.captionsEnabled,  // Note: panel uses ccEnabled, not captionsEnabled
```

**Key insight:** When integrating modules, verify that property names match between caller and callee.

### 16. Missing Initial CC Status Detection on Page Load (Session 2026-01-21)
**Problem:** When the page loaded with CC already OFF, the State module's `ccStatus` was `false` (correct), but the panel was created before State was initialized, so it used the default value.

**Solution (contentscript.js):**
Added initial CC detection in `initializeStateAndEvents()`:
```javascript
// Initial CC status detection for YLE
// The MutationObserver only catches CHANGES, so we need to check the initial state
const wrapper = document.querySelector('[data-testid="subtitles-wrapper"]');
if (wrapper) {
  const computedDisplay = getComputedStyle(wrapper).display;
  const isVisible = computedDisplay !== 'none';
  State.setCCStatus(isVisible);
} else {
  State.setCCStatus(false);
}
```

**Key insight:** Observers/listeners only catch changes, not initial state. Always check the initial state at startup.

### 17. Failed Translations Being Cached as Original Text (Session 2026-01-22)
**Problem:** When translation API calls failed (network error, rate limit, etc.), the extension would fall back to showing the original Finnish text AND cache it as the "translation". This meant the text would never be retried.

**Root Cause:** In `background.js`, the batch translation function returned the original text on error:
```javascript
// WRONG - caches original text as "translation"
if (!response.ok) {
  translations.push(text);  // Original text cached as translation!
  continue;
}
```

**Solution (background.js):**
Return `null` for failed translations so they can be retried:
```javascript
// CORRECT - return null so it will be retried
if (!response.ok) {
  translations.push(null);
  continue;
}
```

And in `contentscript.js`, skip null translations:
```javascript
// Skip failed translations (null) - they will be retried next time
if (translatedText === null || translatedText === undefined) {
  console.info(`Translation failed for "${text.substring(0, 30)}..." - will retry later`);
  continue;
}
```

**Key insight:** Don't cache failures. Return a sentinel value (null) that callers can check, and let the retry logic handle it.

### 18. Controls Auto-Hide: Subtitle Position and Shade (Session 2026-02-09)
**Problem:** When the control panel auto-hides (2.5s mouse inactivity), dual subtitles stayed at `bottom: 60px` — unnecessarily high with no controls visible. Also, YLE's native bottom gradient shade remained visible, adding visual clutter.

**Root Cause:**
- `#displayed-subtitles-wrapper` had a static `bottom: 60px` regardless of control visibility
- YLE's `BottomControlBar__ControlBar-` element has `linear-gradient(transparent→black)` but our CSS only hid its children (buttons), not the gradient container itself

**Solution (styles.css — CSS-only, no JS):**
1. Subtitle wrapper defaults to `bottom: 0`, raised to `bottom: 60px` when `yle-mouse-active`, with `transition: bottom 0.3s ease`
2. Bottom shade hidden via `opacity: 0` when `yle-mouse-active` absent

```css
/* Subtitles drop when controls hide */
#displayed-subtitles-wrapper { bottom: 0 !important; transition: bottom 0.3s ease !important; }
div[class*="PlayerUI__UI"].yle-mouse-active #displayed-subtitles-wrapper { bottom: 60px !important; }

/* Hide bottom shade when controls hidden */
div[class*="PlayerUI__UI"]:not(.yle-mouse-active) div[class*="BottomControlBar__ControlBar-"] {
  opacity: 0 !important; transition: opacity 0.3s ease !important;
}
```

**Key insights:**
- The shade should always follow control visibility — don't add a separate paused condition. Conditional logic (only when paused) causes a brief flash when clicking to pause (controls show on click → shade appears → controls auto-hide → shade disappears)
- YLE's `BottomControlBar__ControlBar-` (with trailing dash) is the gradient container. `BottomControlBar__ControlBarButtons-` is the button wrapper — the trailing dash in the selector disambiguates them
- `TopControlBar__ControlBar` gradient was already hidden by existing CSS

### 19. Hide Share Overlay & Play/Pause Animation (Session 2026-02-09)
**Problem:** Two YLE native UI elements are distracting during auto-pause language learning:
1. A share button (52x52px) appears on the right edge when video is paused
2. A play triangle animation briefly flashes in the center when playback resumes

**Solution (styles.css — CSS-only):**
```css
div[class*="VideoOverlayButton__OverlayButtonWrapper"] { display: none !important; }
div[class*="ActionIndicator__SimpleIndicator"] { display: none !important; }
```

**Key selectors:**
- `VideoOverlayButton__OverlayButtonWrapper` — absolute-positioned wrapper on right edge, contains `ShareOverlayButton__ShareButtonWithText`
- `ActionIndicator__SimpleIndicator` — transient element, briefly injected into DOM during play/pause then removed

### 20. YLE Subtitle DOM Structure Change — Generic Text Finder (Session 2026-02-10)
**Problem:** Dual subtitles completely disappeared. The `#displayed-subtitles-wrapper` existed but had 0 children.

**Root Cause:** YLE changed their subtitle DOM structure:
```
BEFORE: subtitles-wrapper > <span>text</span>
AFTER:  subtitles-wrapper > div.LiveRegion > <div data-testid="subtitle-row">text</div>
```
All `querySelectorAll("span")` calls returned 0 elements. The mutation handler found no text to render.

**Solution (`content/subtitle-dom.ts`):**
1. Replaced all element-type-specific queries with a generic leaf-text finder:
```typescript
function getSubtitleTextElements(container: HTMLElement): HTMLElement[] {
  const leaves: HTMLElement[] = [];
  container.querySelectorAll('*').forEach(el => {
    const htmlEl = el as HTMLElement;
    if (htmlEl.children.length === 0 && htmlEl.textContent?.trim()) {
      leaves.push(htmlEl);
    }
  });
  return leaves;
}
```
2. Updated `isMutationRelatedToSubtitlesWrapper()` to detect mutations on children of the wrapper (LiveRegion), not just the wrapper itself
3. `handleSubtitlesWrapperMutation()` now uses `getNativeSubtitlesWrapper()` instead of `mutation.target` (which may be the LiveRegion child)
4. Syncs YLE's dynamic inline `font-size` from original wrapper to displayed wrapper on each mutation

**Key insights:**
- Never query for specific element types (`span`, `div`) when you only need the text content. Use a generic leaf-element finder instead — immune to future DOM restructuring
- YLE sets `font-size` via inline style on the wrapper (dynamically based on player size), not via CSS class. Must copy this to the displayed wrapper
- The `addContentToDisplayedSubtitlesWrapper` parameter type changed from `NodeListOf<HTMLSpanElement>` to `HTMLElement[]`

**Files changed:** `content/subtitle-dom.ts`, `content/ui-events.ts`

### 21. Zone-Based Control Activation & Cursor Auto-Hide (Session 2026-02-10)
**Problem:** During frequent auto-pause, two things are distracting:
1. Controls appear on any mouse movement anywhere on the video (even a slight nudge)
2. Mouse cursor stays visible when video is paused

**Solution (`content/ui-events.ts` + `styles.css`):**

1. **Zone-based controls**: `onMouseActivity(e)` checks `e.clientY` against the player bounds. Only shows controls when mouse is in bottom 80px (bottom controls) or top 60px (top controls). Mouse movement in the middle of the video does nothing to controls.

2. **Cursor auto-hide**: Separate `yle-cursor-active` class on `PlayerUI__UI`, toggled by its own timer (2.5s). Shows on any mouse movement, hides after inactivity. CSS hides cursor when class is absent:
```css
div[class*="PlayerUI__UI"]:not(.yle-cursor-active),
div[class*="PlayerUI__UI"]:not(.yle-cursor-active) * {
  cursor: none !important;
}
```

**Key insights:**
- Controls and cursor use separate timers — cursor shows on any movement (for subtitle clicking etc.), controls only show in edge zones
- `touchstart` handler doesn't have MouseEvent coordinates, so it always shows both controls and cursor
- `getPlayerUI()` helper avoids repeated `querySelector` calls across multiple functions

**Files changed:** `content/ui-events.ts`, `styles.css`

### 22. Auto-Pause Double-Fire After Repeat (Session 2026-02-22)
**Problem:** After repeat (R key), pressing space to resume would immediately re-pause, requiring a second space press. First press appeared to move only a single frame.

**Root Cause:** `scheduleAutoPause()` calculates setTimeout delay from the `seeked` event, but after seek+play there's a ~60ms startup delay before the video actually begins decoding frames. The wall-clock timer fires on time, but the video position lags ~60ms behind expected. Auto-pause fires at e.g. 409.403 instead of target 409.464. When user presses space:
- Resume at 409.403 → `play` event → `scheduleAutoPause()`
- Only 3ms until pause point (409.464) → immediately re-pauses

**Solution (`content/settings.ts` — `scheduleAutoPause`):**
Timer callback now verifies `video.currentTime >= pauseTarget` before pausing. If the video hasn't reached the target (due to seek startup delay), it re-schedules for the remaining time:
```typescript
_autoPauseTimeout = setTimeout(function autoPauseCheck() {
  _autoPauseTimeout = null;
  if (!autoPauseEnabled) return;
  const v = document.querySelector('video');
  if (v && !v.paused) {
    if (v.currentTime >= pauseTarget) {
      v.pause();
    } else {
      // Re-schedule for remaining time
      const rem = pauseTarget - v.currentTime;
      const reDelay = (rem / v.playbackRate) * 1000;
      _autoPauseTimeout = setTimeout(autoPauseCheck, reDelay);
    }
  }
}, delay);
```

**Key insight:** Never trust wall-clock setTimeout to correspond exactly to video position. Always verify `video.currentTime` before taking position-dependent actions. Seek-to-play has a startup delay (~60ms) that causes systematic early timer fires.

---

## Debugging Methodology

### Debugging Checklist for Subtitle Issues
1. **Check if data is loaded**: Look for console logs showing subtitle count
2. **Check if data is synced**: Look for `setSubtitles called with X subtitles`
3. **Check if data persists**: When the feature is triggered, is the data still there?
4. **Trace the data flow**: Where is the array created? Where is it modified? Who else has a reference?

### Common JavaScript Pitfalls in This Codebase

**1. Array References vs Copies**
```javascript
// WRONG - stores reference, clearing source clears this too
this._subtitles = subtitles;

// CORRECT - stores independent copy
this._subtitles = subtitles.map(sub => ({ ...sub }));
```

**2. Clearing Arrays In-Place**
```javascript
// This clears ALL references to the array!
fullSubtitles.length = 0;

// If you did this earlier:
this._subtitles = fullSubtitles;  // Same reference!
// Now _subtitles is also empty!
```

**3. Conditional Guards That Are Too Strict**
```javascript
// WRONG - isInitialized() requires UI to be mounted
if (ControlIntegration.isInitialized()) {
  ControlIntegration.setSubtitles(data);  // Never called if UI pending!
}

// CORRECT - setSubtitles just stores data, doesn't need UI
if (typeof ControlIntegration !== 'undefined') {
  ControlIntegration.setSubtitles(data);
}
```

**4. Cross-Module Variable Access**
```javascript
// Variables in contentscript.js aren't automatically visible in control-integration.js
// Export to window if needed:
const fullSubtitles = [];
window.fullSubtitles = fullSubtitles;  // Now accessible as window.fullSubtitles
```

### Key Questions When Debugging
1. **Is the data there?** (console.log the array length)
2. **Is it the same array?** (reference vs copy issue)
3. **Who else modifies it?** (search for `.length = 0`, `.splice()`, `= []`)
4. **When is it cleared?** (navigation handlers, cleanup functions)
5. **Is the timing right?** (async operations, race conditions)

---

## Common Issues & Debugging

### Subtitles not showing
1. Check if YLE native subtitles are enabled (via their menu)
2. Check if `dualSubEnabled` is true
3. Verify `[data-testid="subtitles-wrapper"]` exists and has content
4. Check console for MutationObserver activity

### Skip/Repeat not working
1. Verify subtitles are loaded into ControlIntegration
2. Check `ControlIntegration._subtitles` array has data
3. Ensure video element is accessible via `ControlActions.getVideoElement()`

### Menu closes immediately
See "YLE Menu Focus Issue" above - likely focusVideo() stealing focus.

### Audio download not working
1. YLE uses DRM - must use screen recording
2. Check console for lamejs encoding errors

---

## Testing Checklist

### YLE Areena
- [ ] Dual subtitle toggle (D key)
- [ ] Auto-pause at end of subtitle (P key)
- [ ] Skip previous/next subtitle (comma/period)
- [ ] Repeat current subtitle (R key)
- [ ] Playback speed control ([ and ] keys)
- [ ] Word click popup dictionary
- [ ] Screen recording audio download (A key)
- [ ] Settings menus don't close unexpectedly
- [ ] Extension toggle enables/disables correctly
- [ ] CC on/off correctly enables/disables extension toggle

### Cache Management
- [ ] Word cache count displays correctly in options page
- [ ] Subtitle cache count displays correctly
- [ ] Clear word cache works
- [ ] Clear subtitle cache works

### Language Switch Test
1. [ ] Target=English → dual sub ON, translations showing
2. [ ] Change target to Simplified Chinese → dual sub should still work
3. [ ] Change target to Finnish (same as source) → dual sub should auto-disable
4. [ ] Change target back to English → verify dual sub re-enables automatically

### Error Handling
- [ ] Extension options page loads and saves correctly
- [ ] No console errors on page load
- [ ] No "Extension context invalidated" after reload (refresh page)

---

## Key Statistics

| Category | Count |
|----------|-------|
| Total Lines of Code | ~12,700 |
| Platform | YLE Areena only |
| Control Modules | 10 |
| Keyboard Shortcuts | 8 |
| Translation Providers | 6 (Google, DeepL, Claude, Gemini, Grok, Kimi) |
| Chrome API Permissions | storage, downloads |
