# Language Learning Subtitles Extension - Development Guide

## Development Workflow Reminders

> **TEST ON CHROME:** Always test changes directly in Chrome browser. Don't assume code works - verify it:
> 1. Reload extension at `chrome://extensions`
> 2. Refresh the target page (YLE Areena, YouTube, etc.)
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
A Chrome extension that provides dual subtitles (original + translation), popup dictionary, and playback controls for YLE Areena, YouTube, and generic HTML5 video players.

## Architecture

### ⚠️ GUIDING PRINCIPLE: Unified Interface, Platform-Specific Translation Only

**CRITICAL:** Keep a unified interface and controls across ALL platforms. Only adjust the translation/adapter layers, NOT the control logic.

```
┌─────────────────────────────────────────────────────────────┐
│                    UNIFIED LAYER (ONE implementation)       │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐    │
│  │ControlPanel │  │ControlActions│  │ControlIntegration│   │
│  │  (UI)       │  │ (skip/repeat │  │   (bridge)       │    │
│  │             │  │  /autopause) │  │                  │    │
│  └─────────────┘  └─────────────┘  └──────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                    Events & Callbacks
                              │
┌─────────────────────────────────────────────────────────────┐
│              TRANSLATION LAYER (platform-specific)          │
│  ┌──────────┐    ┌───────────────┐    ┌─────────────┐      │
│  │YLE Adapter│    │YouTube Adapter│    │HTML5 Adapter│      │
│  │-getVideo()│    │-getVideo()    │    │-getVideo()  │      │
│  │-mount()   │    │-mount()       │    │-mount()     │      │
│  │-subtitles │    │-subtitles     │    │-subtitles   │      │
│  └──────────┘    └───────────────┘    └─────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

**Rules:**
1. **ControlActions** is the ONLY place for action logic (skip, repeat, speed, auto-pause)
2. **ControlIntegration** is the ONLY bridge between controls and contentscript
3. **Platform adapters** ONLY provide: video element, subtitle data, mount points, keyboard config
4. **contentscript.js** should NOT have platform-specific control logic
5. **Fix once, works everywhere** - if you fix a bug, it should work on ALL platforms automatically

### GENERAL Features (must work on ALL platforms the same way)
| Feature | Behavior | Location |
|---------|----------|----------|
| Clickable original text | ALWAYS shown, even when dual sub OFF | `addContentToDisplayedSubtitlesWrapper`, `displayYouTubeSubtitle` |
| Translation line | Only shown when dual sub ON | Same functions, check `dualSubEnabled` |
| Word popup dictionary | Click any word → translation popup | `createSubtitleSpanWithClickableWords` |
| Skip prev/next | Jump to previous/next subtitle | `ControlActions.skipToPreviousSubtitle/skipToNextSubtitle` |
| Repeat | Play from subtitle start to current position | `ControlActions.repeatCurrentSubtitle` |
| Auto-pause | Pause after each subtitle change | Check `isSkippingSubtitle`, `isRepeatingSubtitle` flags |
| Speed control | 0.5x - 2.0x playback | `ControlActions.setPlaybackSpeed` |

### PLATFORM-SPECIFIC Translation Layer (adapters only)
| Platform | What adapter provides |
|----------|----------------------|
| YLE | Video element, subtitle wrapper selector, VTT fetching, mount point |
| YouTube | Video element, caption API, timedtext fetching, mount point, keyboard config (capture phase) |
| HTML5 | Video element, generic subtitle detection, floating mount |

**Violations to clean up:**
- `contentscript.js` has duplicate auto-pause logic for YLE vs YouTube
- `contentscript.js` has legacy skip/repeat functions that should be removed
- Platform-specific keyboard handlers should use unified `ControlKeyboard`

### Platform Adapters
- `platforms/yle/yle-adapter.js` - YLE Areena specific logic
- `platforms/youtube/youtube-adapter.js` - YouTube specific logic
- `platforms/html5/html5-adapter.js` - Generic HTML5 video support
- `platforms/platform-base.js` - Base class with common interface

### Unified Control Panel (v4.0)
Located in `controls/` directory:
- `control-panel.js` - Main ControlPanel class, creates UI
- `control-actions.js` - Platform-agnostic action handlers (skip, repeat, speed, **auto-pause**)
- `control-keyboard.js` - Unified keyboard handler
- `control-icons.js` - SVG icon definitions
- `control-integration.js` - Bridge between ControlPanel and contentscript.js

### Key Files
- `contentscript.js` - Main content script, handles subtitle observation and translation
- `inject.js` - Injected into page context for YLE/YouTube API access
- `styles.css` - All styles including `dsc-*` prefixed unified control styles

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

### 3. YouTube Keyboard Handling
YouTube requires `useCapture: true` for keyboard event listeners to intercept before YouTube's own handlers.

### 4. Extension Reload Required
Chrome extensions do NOT auto-reload when source files change. After editing:
1. Go to `chrome://extensions`
2. Find the extension and click reload (↻)
3. Refresh the target page

### 5. Control Panel Mount Points
Each platform has a `getControlPanelMountConfig()` method:
- **YLE:** Appends to `[class^="BottomControlBar__LeftControls"]`
- **YouTube:** Appends to `.ytp-left-controls`
- **HTML5:** Floating overlay on video parent

### 6. Subtitle Navigation (Skip/Repeat)
For skip prev/next/repeat to work, subtitles must be synced to `ControlIntegration`.

**CRITICAL: Subtitle Accumulation Issue**

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

**Key locations:**
- `fullSubtitles` array declared at ~line 316-320 in contentscript.js
- YLE: `handleBatchTranslation()` accumulates into `fullSubtitles` (~line 488-513)
- YouTube: Initial load at `youtubeSubtitlesLoaded` handler (~line 2577-2591)
- Clear arrays in `loadMovieCacheAndUpdateMetadata()` and YouTube navigation handler

The subtitles array is used by `ControlActions.repeatCurrentSubtitle()` for the repeat feature.

### 7. YLE Mouse Activity
YLE hides controls on mouse inactivity. To show controls programmatically:
```javascript
const playerUI = document.querySelector('[class*="PlayerUI"]');
playerUI.classList.add('yle-mouse-active');
```

### 8. YLE Video Overlay Closes When Showing Modals (IMPORTANT)
**Problem:** On YLE, clicking buttons that show modal dialogs (like the audio download confirmation) would close the video overlay, returning to the series page.

**Root Cause:** YLE's video player opens as an overlay on the series page (URL stays the same). When our extension appends modal elements to `document.body`, YLE interprets this DOM manipulation as a signal to close the video overlay.

**Key Discovery:**
- Keyboard shortcuts that don't show modals work fine (video stays open)
- Button clicks that trigger modal creation close the video
- Even programmatic DOM appends to `document.body` trigger this behavior

**Solution (in `control-integration.js`):**
For YLE platform, skip showing any custom modals and go directly to the action:
```javascript
async _handleDownloadAudio() {
  // YLE uses DRM protection - offer screen recording instead
  if (this._platform === 'yle') {
    // On YLE, showing any modal closes the video overlay
    // So we skip the confirmation and go directly to screen recording
    const video = ControlActions.getVideoElement(this._platform);
    if (!video) {
      console.error('DualSubExtension: No video found');
      return;
    }

    // Start recording directly without modal
    await this._startYLERecording(video, speechSegments);
    return;
  }
  // ... show modal for other platforms
}
```

**Key files:**
- `controls/control-integration.js` - `_handleDownloadAudio()` and `_startYLERecording()`
- Keyboard shortcut "A" triggers the same code path

**Testing:** Both button click and keyboard shortcut "A" now work on YLE without closing the video overlay.

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
| `A` | Download audio (screen recording on YLE) |
| `Space` | Play/Pause |

## Common Issues & Debugging

### Subtitles not showing
1. Check if YLE native subtitles are enabled (via their menu)
2. Check if `dualSubEnabled` is true
3. Verify `[data-testid="subtitles-wrapper"]` exists and has content
4. Check console for MutationObserver activity

### Skip/Repeat not working
1. Verify subtitles are loaded into ControlIntegration
2. Check `ControlIntegration._subtitles` array has data
3. Ensure video element is accessible via `ControlActions.getVideoElement(platform)`

### Menu closes immediately
See "YLE Menu Focus Issue" above - likely focusVideo() stealing focus.

## Translation Providers
Configured in extension options:
- DeepL (free/pro API)
- Google Translate
- Claude AI (Anthropic)
- Gemini (Google)
- xAI (Grok)

## Testing Checklist
- [ ] YLE: Dual sub toggle
- [ ] YLE: Auto-pause
- [ ] YLE: Skip prev/next
- [ ] YLE: Repeat subtitle
- [ ] YLE: Speed control
- [ ] YLE: Word click popup dictionary
- [ ] YouTube: All above features
- [ ] HTML5: All above features
- [ ] Keyboard shortcuts on all platforms
