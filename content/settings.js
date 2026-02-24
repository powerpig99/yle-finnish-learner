// ==================================
// SETTINGS + STATE MANAGEMENT
// ==================================
// State of target_language (cached from chrome storage sync)
let targetLanguage = "EN-US";
loadTargetLanguageFromChromeStorageSync().then((loadedTargetLanguage) => {
    targetLanguage = loadedTargetLanguage;
}).catch((error) => {
    console.error("YleDualSubExtension: Error loading target language from storage:", error);
});
// State of Dual Sub Switch, to manage whether to add display subtitles wrapper
let dualSubEnabled = false;
/**
 * Load dual sub preference from Chrome storage
 * @returns {Promise<boolean>} - The loaded preference value
 */
async function loadDualSubPreference() {
    try {
        const result = await chrome.storage.sync.get("dualSubEnabled");
        if (result && typeof result.dualSubEnabled === 'boolean') {
            dualSubEnabled = result.dualSubEnabled;
            console.log("YleDualSubExtension: Loaded dual sub preference:", dualSubEnabled);
        }
        else {
            console.log("YleDualSubExtension: No dual sub preference found in storage, using default:", dualSubEnabled);
        }
        return dualSubEnabled;
    }
    catch (error) {
        console.warn("YleDualSubExtension: Error loading dual sub preference:", error);
        return dualSubEnabled;
    }
}
// State of Auto-Pause feature
let autoPauseEnabled = false;
// State of Playback Speed (1x to 2x in 0.25 steps)
let playbackSpeed = 1.0;
// State of Extension Enabled (global on/off toggle)
let extensionEnabled = true;
let detectedSourceLanguage = null;
// Target language for translation (loaded from storage)
window._targetLanguage = 'en'; // Default to English
chrome.storage.sync.get(['targetLanguage'], (result) => {
    if (result.targetLanguage) {
        window._targetLanguage = result.targetLanguage;
    }
});
/**
 * Load extension enabled state from Chrome storage
 */
async function loadExtensionEnabledState() {
    try {
        const result = await chrome.storage.sync.get(['extensionEnabled']);
        extensionEnabled = result.extensionEnabled !== false; // Default to true
        console.info('DualSubExtension: Extension enabled state loaded:', extensionEnabled);
    }
    catch (error) {
        console.warn('DualSubExtension: Error loading extension enabled state:', error);
        extensionEnabled = true;
    }
}
/**
 * Check if subtitles should be processed based on extension state
 * @returns {boolean}
 */
function shouldProcessSubtitles() {
    return extensionEnabled;
}
/**
 * Check if translation should be performed
 * Returns false if source and target languages are the same
 * @returns {boolean}
 */
function shouldTranslate() {
    if (!extensionEnabled || !dualSubEnabled) {
        return false;
    }
    // If no detected source language, assume we should translate
    if (!detectedSourceLanguage) {
        return true;
    }
    // Check if same language using the utility function
    if (typeof isSameLanguage === 'function') {
        // Get target language from storage or use default
        const targetLang = window._targetLanguage || 'en';
        if (isSameLanguage(detectedSourceLanguage, targetLang)) {
            return false;
        }
    }
    return true;
}
/**
 * Load playback speed preference from Chrome storage
 */
async function loadPlaybackSpeedPreference() {
    try {
        const result = await chrome.storage.sync.get(['playbackSpeed']);
        if (typeof result.playbackSpeed === 'number') {
            playbackSpeed = result.playbackSpeed;
            applyPlaybackSpeed();
            console.info('DualSubExtension: Loaded playback speed preference:', playbackSpeed);
        }
    }
    catch (error) {
        console.warn('DualSubExtension: Error loading playback speed preference:', error);
    }
}
/**
 * Apply the current playback speed to the video element
 */
function applyPlaybackSpeed() {
    const video = document.querySelector('video');
    if (video && video.playbackRate !== playbackSpeed) {
        video.playbackRate = playbackSpeed;
    }
}
// Track video element to reapply speed on new videos
let lastVideoElement = null;
// Subtitle font size setting (small, medium, large, xlarge)
let subtitleFontSize = "medium";
// Font size scale factors using CSS cqw units (container query width percentage)
// Using CSS clamp() with container queries for automatic scaling based on player size
const FONT_SIZE_VW_MAP = {
    small: { main: '1.8cqw', translated: '1.4cqw', minMain: 12, maxMain: 50, minTrans: 10, maxTrans: 38 },
    medium: { main: '2.2cqw', translated: '1.7cqw', minMain: 14, maxMain: 60, minTrans: 11, maxTrans: 46 },
    large: { main: '2.6cqw', translated: '2.0cqw', minMain: 16, maxMain: 72, minTrans: 12, maxTrans: 55 },
    xlarge: { main: '3.0cqw', translated: '2.3cqw', minMain: 18, maxMain: 84, minTrans: 14, maxTrans: 64 },
    xxlarge: { main: '3.4cqw', translated: '2.6cqw', minMain: 20, maxMain: 96, minTrans: 16, maxTrans: 72 },
    huge: { main: '4.0cqw', translated: '3.0cqw', minMain: 24, maxMain: 120, minTrans: 18, maxTrans: 90 }
};
// Load saved subtitle font size from chrome storage
chrome.storage.sync.get(['subtitleFontSize'], (result) => {
    if (result.subtitleFontSize) {
        subtitleFontSize = result.subtitleFontSize;
    }
    // Always apply font size (use default if not set)
    applySubtitleFontSize();
});
/**
 * Apply the current subtitle font size via CSS injection
 * Uses CSS clamp() with cqw units for automatic responsive scaling based on player size
 */
function applySubtitleFontSize() {
    const styleId = 'yle-dual-sub-fontsize-style';
    let styleEl = document.getElementById(styleId);
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
    }
    const sizes = FONT_SIZE_VW_MAP[subtitleFontSize] || FONT_SIZE_VW_MAP.medium;
    // Use CSS clamp() for automatic responsive scaling
    // clamp(min, preferred, max) - preferred uses cqw units which scale with container (player) width
    styleEl.textContent = `
    #displayed-subtitles-wrapper span {
      font-size: clamp(${sizes.minMain}px, ${sizes.main}, ${sizes.maxMain}px) !important;
    }
    #displayed-subtitles-wrapper .translated-text-span,
    #displayed-subtitles-wrapper .dual-sub-translated {
      font-size: clamp(${sizes.minTrans}px, ${sizes.translated}, ${sizes.maxTrans}px) !important;
    }
  `;
}
/**
 * Setup speed control and auto-pause event listeners for video element
 */
function setupVideoSpeedControl() {
    const video = document.querySelector('video');
    if (video && video !== lastVideoElement) {
        lastVideoElement = video;
        applyPlaybackSpeed();
        // Reapply when video metadata loads (new video)
        video.addEventListener('loadedmetadata', applyPlaybackSpeed);
        video.addEventListener('play', applyPlaybackSpeed, { once: true });
        // Auto-pause event listeners
        // On seek (skip/repeat), clear stale endTime and schedule auto-pause for the new subtitle
        video.addEventListener('seeked', () => {
            _currentSubtitleEndTime = null; // Clear stale value, force fresh lookup
            if (autoPauseEnabled && extensionEnabled) {
                scheduleAutoPause();
            }
        });
        // On play (resume after pause), schedule auto-pause for remaining time
        video.addEventListener('play', () => {
            if (autoPauseEnabled && extensionEnabled) {
                scheduleAutoPause();
            }
        });
        // On pause, clear any pending auto-pause timer
        video.addEventListener('pause', () => {
            clearAutoPause();
        });
        // On rate change, recalculate delay
        video.addEventListener('ratechange', () => {
            if (autoPauseEnabled && extensionEnabled) {
                scheduleAutoPause();
            }
        });
        // CC ON/OFF detection via TextTrack API
        // YLE sets track.mode to 'hidden' when CC is on, 'disabled' when off.
        // The 'change' event fires immediately when the user toggles CC in YLE's menu.
        // No length guard — tracks load asynchronously after the video element appears.
        const readCcActiveState = () => Array.from(video.textTracks).some(t => t.mode !== 'disabled');
        const emitCcState = (enabled, reason) => {
            document.dispatchEvent(new CustomEvent('yleNativeCaptionsToggled', {
                bubbles: true,
                detail: { enabled, reason }
            }));
        };
        let _ccWasActive = readCcActiveState();
        const syncCcState = (reason) => {
            const ccActive = readCcActiveState();
            if (ccActive === _ccWasActive)
                return;
            _ccWasActive = ccActive;
            console.info(`DualSubExtension: CC state changed (${reason}) ->`, ccActive ? 'ON' : 'OFF');
            emitCcState(ccActive, reason);
        };
        // Emit initial state so keyboard gating and panel state never stay stale.
        emitCcState(_ccWasActive, 'init');
        video.textTracks.addEventListener('change', () => syncCcState('change'));
        video.textTracks.addEventListener('addtrack', () => syncCcState('addtrack'));
        video.textTracks.addEventListener('removetrack', () => syncCcState('removetrack'));
        // Text tracks may initialize asynchronously after video appears.
        setTimeout(() => syncCcState('post-init-300ms'), 300);
        setTimeout(() => syncCcState('post-init-1000ms'), 1000);
        console.info('DualSubExtension: TextTrack CC detection initialized, ccActive:', _ccWasActive);
    }
}
// Initial setup after a short delay
setTimeout(setupVideoSpeedControl, 500);
/**
 * Check if a valid translation provider is configured
 * Google Translate works without an API key, so it's always valid
 * @returns {Promise<boolean>}
 */
async function checkHasValidProvider() {
    try {
        const result = await chrome.storage.sync.get([
            'translationProvider',
            'deeplApiKey',
            'claudeApiKey',
            'geminiApiKey',
            'grokApiKey',
            'kimiApiKey'
        ]);
        const provider = result.translationProvider || 'google';
        // Google Translate doesn't need a key
        if (provider === 'google') {
            return true;
        }
        // Provider-specific key lookup.
        const keyMap = {
            deepl: result.deeplApiKey,
            claude: result.claudeApiKey,
            gemini: result.geminiApiKey,
            grok: result.grokApiKey,
            kimi: result.kimiApiKey
        };
        const apiKey = keyMap[provider] || '';
        return apiKey.trim().length > 0;
    }
    catch (error) {
        console.error('YleDualSubExtension: Error checking provider:', error);
        // Default to true (Google Translate) on error
        return true;
    }
}
/**
 * Handle dual sub behaviour based on whether a provider key is configured.
 * If no key is selected, display warning icon and disable dual sub switch.
 * @param {boolean} hasSelectedToken
 */
function _handleDualSubBehaviourBasedOnSelectedToken(hasSelectedToken) {
    // Unified control panel migration: warning state is managed by dsc panel.
    ControlIntegration.updateState({
        showWarning: !hasSelectedToken,
        warningMessage: hasSelectedToken ? '' : 'Translation provider not configured'
    });
}
// Auto-pause timeout ID for the setTimeout-based approach
let _autoPauseTimeout = null;
let _autoPauseLookupRetryCount = 0;
const AUTO_PAUSE_LOOKUP_RETRY_LIMIT = 3;
const AUTO_PAUSE_LOOKUP_RETRY_DELAY_MS = 120;
// Current subtitle endTime, set by subtitle-dom.js when a subtitle is displayed.
// This is the source of truth for auto-pause — avoids time-based lookup issues
// where DOM mutation fires ~20-30ms before VTT startTime.
let _currentSubtitleEndTime = null;
/**
 * Set the current subtitle's endTime for auto-pause scheduling.
 * Called from subtitle-dom.js when a subtitle is displayed and matched against fullSubtitles.
 * @param {number | null} endTime - The endTime of the current subtitle, or null to clear
 */
function setCurrentSubtitleEndTime(endTime) {
    _currentSubtitleEndTime = endTime;
    if (endTime !== null) {
        _autoPauseLookupRetryCount = 0;
    }
}
function getActiveCueEndTime(video) {
    let bestMatch = null;
    for (const track of Array.from(video.textTracks)) {
        if (track.mode === 'disabled')
            continue;
        const activeCues = track.activeCues;
        if (!activeCues || activeCues.length === 0)
            continue;
        for (let i = 0; i < activeCues.length; i++) {
            const cue = activeCues[i];
            if (typeof cue.startTime !== 'number' || typeof cue.endTime !== 'number')
                continue;
            if (!Number.isFinite(cue.startTime) || !Number.isFinite(cue.endTime))
                continue;
            if (video.currentTime < cue.startTime || video.currentTime >= cue.endTime)
                continue;
            if (!bestMatch ||
                cue.startTime > bestMatch.startTime ||
                (cue.startTime === bestMatch.startTime && cue.endTime > bestMatch.endTime)) {
                bestMatch = { startTime: cue.startTime, endTime: cue.endTime };
            }
        }
    }
    return bestMatch ? bestMatch.endTime : null;
}
function scheduleAutoPauseLookupRetry() {
    if (_autoPauseLookupRetryCount >= AUTO_PAUSE_LOOKUP_RETRY_LIMIT) {
        return;
    }
    _autoPauseLookupRetryCount++;
    _autoPauseTimeout = setTimeout(() => {
        _autoPauseTimeout = null;
        scheduleAutoPause(true);
    }, AUTO_PAUSE_LOOKUP_RETRY_DELAY_MS);
}
/**
 * Schedule auto-pause at the end of the current subtitle.
 * Uses _currentSubtitleEndTime (set by subtitle DOM mutation via text matching)
 * instead of looking up by video.currentTime, which is unreliable because
 * DOM mutation fires ~20-30ms before VTT startTime.
 *
 * Called from: subtitle DOM mutation, video seeked/play/ratechange events.
 */
function scheduleAutoPause(fromRetry = false) {
    // Clear any existing timer first
    clearAutoPause(false);
    if (!fromRetry) {
        _autoPauseLookupRetryCount = 0;
    }
    if (!autoPauseEnabled || !extensionEnabled) {
        return;
    }
    const video = document.querySelector('video');
    if (!video || video.paused) {
        return;
    }
    // For DOM mutation calls, _currentSubtitleEndTime is already set.
    // For seeked/play/ratechange events, we need to look up by currentTime.
    let endTime = _currentSubtitleEndTime;
    // Check if stored endTime is stale (already passed) — if so, fall through to lookup
    if (endTime !== null) {
        const pauseAt = endTime - 0.05;
        if (pauseAt <= video.currentTime) {
            endTime = null; // Stale, fall through to lookup
        }
    }
    if (endTime === null) {
        // Fallback: read active native text track cues (single source of truth with subtitle rendering).
        endTime = getActiveCueEndTime(video);
        if (endTime === null) {
            scheduleAutoPauseLookupRetry();
            return;
        }
        setCurrentSubtitleEndTime(endTime);
    }
    _autoPauseLookupRetryCount = 0;
    const currentTime = video.currentTime;
    // Calculate delay: time until 0.05s before endTime, adjusted for playback rate
    const pauseAt = endTime - 0.05;
    const remaining = pauseAt - currentTime;
    if (remaining <= 0) {
        return;
    }
    const delay = (remaining / video.playbackRate) * 1000;
    console.log(`[AutoPause] SCHEDULED: endTime=${endTime.toFixed(3)}, currentTime=${currentTime.toFixed(3)}, delay=${delay.toFixed(0)}ms`);
    const pauseTarget = pauseAt;
    _autoPauseTimeout = setTimeout(function autoPauseCheck() {
        _autoPauseTimeout = null;
        if (!autoPauseEnabled)
            return;
        const v = document.querySelector('video');
        if (v && !v.paused) {
            if (v.currentTime >= pauseTarget) {
                v.pause();
                console.log(`[AutoPause] PAUSED at ${v.currentTime.toFixed(3)}`);
            }
            else {
                // Timer fired early (seek-to-play startup delay causes video position
                // to lag behind wall-clock timer). Re-schedule for remaining time.
                const rem = pauseTarget - v.currentTime;
                const reDelay = (rem / v.playbackRate) * 1000;
                console.log(`[AutoPause] RE-SCHEDULED: pos=${v.currentTime.toFixed(3)}, target=${pauseTarget.toFixed(3)}, delay=${reDelay.toFixed(0)}ms`);
                _autoPauseTimeout = setTimeout(autoPauseCheck, reDelay);
            }
        }
    }, delay);
}
/**
 * Clear any pending auto-pause timeout.
 * Called from: video pause event, auto-pause toggle OFF, start of scheduleAutoPause.
 */
function clearAutoPause(resetRetry = true) {
    if (_autoPauseTimeout !== null) {
        clearTimeout(_autoPauseTimeout);
        _autoPauseTimeout = null;
    }
    if (resetRetry) {
        _autoPauseLookupRetryCount = 0;
    }
}
/**
 * Load auto-pause preference from Chrome storage
 */
async function loadAutoPausePreference() {
    try {
        const result = await chrome.storage.sync.get("autoPauseEnabled");
        if (result && typeof result.autoPauseEnabled === 'boolean') {
            autoPauseEnabled = result.autoPauseEnabled;
            console.log("YleDualSubExtension: Loaded auto-pause preference:", autoPauseEnabled);
            updateAutoPauseSwitchUI();
        }
    }
    catch (error) {
        console.warn("YleDualSubExtension: Error loading auto-pause preference:", error);
    }
}
/**
 * Update auto-pause switch UI to match current state
 */
function updateAutoPauseSwitchUI() {
    ControlIntegration.updateState({ autoPauseEnabled });
    const autoPauseCheckbox = document.getElementById('dsc-auto-pause-checkbox');
    if (autoPauseCheckbox) {
        autoPauseCheckbox.checked = autoPauseEnabled;
    }
    const autoPauseToggle = document.getElementById('dsc-auto-pause-toggle');
    if (autoPauseToggle) {
        autoPauseToggle.classList.toggle('active', autoPauseEnabled);
    }
}
let _settingsBootstrapPromise = null;
function startSettingsBootstrap() {
    if (!_settingsBootstrapPromise) {
        _settingsBootstrapPromise = Promise.all([
            loadDualSubPreference(),
            loadAutoPausePreference(),
            loadExtensionEnabledState(),
            loadPlaybackSpeedPreference(),
        ]).then(() => {
            console.info('DualSubExtension: Settings bootstrap complete');
        }).catch((error) => {
            console.warn('DualSubExtension: Settings bootstrap failed:', error);
        });
    }
    return _settingsBootstrapPromise;
}
/**
 * Wait until settings/state bootstrap is complete.
 * Used by contentscript.js to avoid init races with stale defaults.
 */
function waitForSettingsBootstrap() {
    return startSettingsBootstrap();
}
// Load core settings on startup
startSettingsBootstrap();
// Listen for user setting changes for provider/key selection in Options page
chrome.storage.onChanged.addListener(async (changes, namespace) => {
    // Handle provider or API key changes
    if (namespace === 'sync' && (changes.translationProvider ||
        changes.deeplApiKey ||
        changes.claudeApiKey ||
        changes.geminiApiKey ||
        changes.grokApiKey ||
        changes.kimiApiKey)) {
        const hasValidProvider = await checkHasValidProvider();
        _handleDualSubBehaviourBasedOnSelectedToken(hasValidProvider);
    }
    if (namespace === 'sync' && changes.targetLanguage) {
        // Handled in the cross-tab sync listener below.
    }
    // Handle subtitle font size changes
    if (namespace === 'sync' && changes.subtitleFontSize) {
        const newSize = changes.subtitleFontSize.newValue;
        if (newSize && typeof newSize === 'string') {
            subtitleFontSize = newSize;
            applySubtitleFontSize();
            console.info(`YleDualSubExtension: Subtitle font size updated to ${newSize}`);
        }
    }
});
// Listen for storage changes (cross-tab sync)
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync')
        return;
    if (changes.extensionEnabled) {
        const newEnabled = changes.extensionEnabled.newValue !== false;
        if (newEnabled !== extensionEnabled) {
            extensionEnabled = newEnabled;
            console.info('DualSubExtension: Extension enabled changed via storage:', newEnabled);
            // Update control integration state
            ControlIntegration.updateState({ extensionEnabled: newEnabled });
        }
    }
    if (changes.targetLanguage) {
        const newTargetLanguage = changes.targetLanguage.newValue || 'EN-US';
        const previousTargetLanguage = targetLanguage;
        targetLanguage = newTargetLanguage;
        window._targetLanguage = newTargetLanguage;
        console.info('DualSubExtension: Target language changed via storage:', newTargetLanguage);
        // Update control integration and recalculate activation
        ControlIntegration.setTargetLanguage(newTargetLanguage);
        // Refresh translation state in-page without forcing a YLE player reload.
        if (previousTargetLanguage !== newTargetLanguage) {
            document.dispatchEvent(new CustomEvent('dscTargetLanguageChanged', {
                detail: { targetLanguage: newTargetLanguage }
            }));
        }
    }
});
