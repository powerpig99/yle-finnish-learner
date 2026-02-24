// ==================================
// UI EVENTS + FOCUS/MOUSE HANDLING
// ==================================
// ==================================
// MOUSE ACTIVITY TRACKING
// Show YLE controls on mouse movement, hide after inactivity
// Extension controls stay visible always (handled by CSS)
// ==================================
let mouseActivityTimer = null;
let cursorActivityTimer = null;
const MOUSE_HIDE_DELAY = 2500; // Hide after 2.5 seconds of inactivity
function getPlayerUI() {
    return document.querySelector('[class*="PlayerUI__UI"]');
}
function showYleControls() {
    const playerUI = getPlayerUI();
    if (playerUI) {
        playerUI.classList.add('yle-mouse-active');
    }
    document.body.classList.add('yle-mouse-active');
}
function hideYleControls() {
    const playerUI = getPlayerUI();
    if (playerUI) {
        playerUI.classList.remove('yle-mouse-active');
    }
    document.body.classList.remove('yle-mouse-active');
}
function showCursor() {
    const playerUI = getPlayerUI();
    if (playerUI) {
        playerUI.classList.add('yle-cursor-active');
    }
}
function hideCursor() {
    const playerUI = getPlayerUI();
    if (playerUI) {
        playerUI.classList.remove('yle-cursor-active');
    }
}
function onMouseActivity(e) {
    // Always show cursor on any mouse movement
    showCursor();
    if (cursorActivityTimer)
        clearTimeout(cursorActivityTimer);
    cursorActivityTimer = setTimeout(hideCursor, MOUSE_HIDE_DELAY);
    // Only show controls when mouse is in edge zones of the player
    const playerUI = getPlayerUI();
    if (!playerUI)
        return;
    const rect = playerUI.getBoundingClientRect();
    const inBottomZone = e.clientY >= rect.bottom - 80;
    const inTopZone = e.clientY <= rect.top + 60;
    if (inBottomZone || inTopZone) {
        showYleControls();
        if (mouseActivityTimer)
            clearTimeout(mouseActivityTimer);
        mouseActivityTimer = setTimeout(hideYleControls, MOUSE_HIDE_DELAY);
    }
}
// Track mouse movement
document.addEventListener('mousemove', onMouseActivity, { passive: true });
document.addEventListener('touchstart', () => {
    showYleControls();
    showCursor();
    if (mouseActivityTimer)
        clearTimeout(mouseActivityTimer);
    mouseActivityTimer = setTimeout(hideYleControls, MOUSE_HIDE_DELAY);
    if (cursorActivityTimer)
        clearTimeout(cursorActivityTimer);
    cursorActivityTimer = setTimeout(hideCursor, MOUSE_HIDE_DELAY);
}, { passive: true });
// Start with controls and cursor hidden
setTimeout(() => { hideYleControls(); hideCursor(); }, 1000);
/**
 * Focus the video/player to enable keyboard controls
 */
function focusVideo() {
    // Don't focus if a word tooltip is active (user is looking up a word)
    if (activeTooltip) {
        return;
    }
    // Find the player UI element that likely handles keyboard events
    const playerUI = document.querySelector('[class*="PlayerUI__UI"]');
    if (playerUI) {
        // Make it focusable and focus it
        playerUI.setAttribute('tabindex', '0');
        playerUI.focus();
        // If focus successful, we're done
        if (document.activeElement === playerUI) {
            return;
        }
    }
    // Try clicking on the player area to trigger native focus
    // We'll click on an area that doesn't toggle play/pause (like the bottom area)
    const video = document.querySelector('video');
    if (video) {
        const rect = video.getBoundingClientRect();
        // Create a click at the bottom edge of the video (near controls, won't toggle play)
        const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: rect.left + rect.width / 2,
            clientY: rect.bottom - 5
        });
        // Dispatch on the player UI, not the video (to avoid play/pause toggle)
        if (playerUI) {
            playerUI.dispatchEvent(clickEvent);
        }
    }
}
// Focus video after clicking on any control bar element (extension or YLE)
document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target)
        return;
    // Don't focus video when interacting with dropdowns/selects - wait for change event
    if (target.tagName === 'SELECT' || target.tagName === 'OPTION' || target.closest('select')) {
        return;
    }
    // Don't focus video when clicking on words in subtitles (for tooltip)
    if (target.closest('.word-item') || target.closest('#displayed-subtitles-wrapper')) {
        return;
    }
    // Don't focus video when clicking on the tooltip itself
    if (target.closest('.word-tooltip')) {
        return;
    }
    // Don't focus video when clicking on YLE settings buttons or menus
    // These need to maintain focus for the menu/submenu to stay open
    if (target.closest('[class*="SettingsButton"]') ||
        target.closest('[class*="Settings__"]') ||
        target.closest('[class*="TopLevelSettings"]') ||
        target.closest('[aria-label*="Tekstitykset"]') ||
        target.closest('[aria-label*="Asetukset"]') ||
        target.closest('[aria-label*="Ääni"]')) {
        return;
    }
    // Don't focus video when clicking on our extension's UI elements
    // The synthetic click in focusVideo can trigger YLE to close the video player
    // Check for the entire control panel and all dsc-prefixed elements
    if (target.closest('.dsc-panel') ||
        target.closest('.dsc-btn') ||
        target.closest('.dsc-group') ||
        target.closest('.dsc-audio-modal') ||
        target.closest('#dsc-download-audio-btn') ||
        target.closest('#dsc-yle-waiting-modal') ||
        target.closest('#dsc-yle-recording-ui') ||
        target.closest('.dsc-audio-progress') ||
        target.closest('.dsc-audio-toast') ||
        target.closest('[id^="dsc-yle-"]') ||
        target.closest('[id^="dsc-audio-"]') ||
        target.closest('[id^="dsc-export-"]') ||
        target.closest('[class*="dsc-"]')) {
        return;
    }
    // Also check if target itself has dsc- prefix (for buttons inside modals or SVG icons)
    if (target.id && target.id.startsWith('dsc-')) {
        return;
    }
    // Check if target or any parent has a class starting with dsc-
    let el = target;
    while (el && el !== document.body) {
        if (el.className && typeof el.className === 'string' && el.className.split(' ').some(c => c.startsWith('dsc-'))) {
            return;
        }
        el = el.parentElement;
    }
    // Check if click was on control bar area
    const isControlBarClick = target.closest('[class*="BottomControlBar"]') ||
        target.closest('[class*="TopControlBar"]') ||
        target.closest('[class*="Timeline"]');
    if (isControlBarClick) {
        // Small delay to let the control action complete first
        setTimeout(focusVideo, 100);
    }
}, true);
// ==================================
// UI EVENT LISTENERS
// ==================================
function getOriginalSubtitlesWrapper() {
    if (typeof getNativeSubtitlesWrapper === 'function') {
        return getNativeSubtitlesWrapper();
    }
    return document.querySelector('[data-testid="subtitles-wrapper"]');
}

function renderCurrentSubtitleImmediately(originalSubtitlesWrapper) {
    const displayedSubtitlesWrapper = createAndPositionDisplayedSubtitlesWrapper(originalSubtitlesWrapper);
    displayedSubtitlesWrapper.innerHTML = '';
    displayedSubtitlesWrapper.style.display = 'flex';
    const originalSubtitleElements = getSubtitleTextElements(originalSubtitlesWrapper);
    if (originalSubtitleElements.length > 0) {
        addContentToDisplayedSubtitlesWrapper(displayedSubtitlesWrapper, originalSubtitleElements);
    }
    translationQueue.processQueue().catch(console.error);
}
// SECTION: UNIFIED CONTROL PANEL EVENT LISTENERS
// ==================================
/* global ControlIntegration, ControlPanel, ControlActions, ControlKeyboard */
// Listen for unified control panel events
document.addEventListener('dscDualSubToggle', (e) => {
    const { enabled } = e.detail;
    dualSubEnabled = enabled;
    // Handle dual sub toggle logic for YLE
    if (enabled) {
        const originalSubtitlesWrapper = getOriginalSubtitlesWrapper();
        if (originalSubtitlesWrapper) {
            originalSubtitlesWrapper.classList.add('dsc-original-hidden');
            renderCurrentSubtitleImmediately(originalSubtitlesWrapper);
        }
    }
    else {
        // When dual sub is disabled, keep showing clickable original text
        // Just remove the translation spans, don't hide the wrapper
        const displayedSubtitlesWrapper = document.getElementById('displayed-subtitles-wrapper');
        if (displayedSubtitlesWrapper) {
            // Remove only translation spans, keep original clickable text
            const translationSpans = displayedSubtitlesWrapper.querySelectorAll('.translated-text-span');
            translationSpans.forEach(span => span.remove());
        }
        // Keep original YLE subtitles hidden - we show our clickable version instead
    }
});
document.addEventListener('dscAutoPauseToggle', (e) => {
    const { enabled } = e.detail;
    autoPauseEnabled = enabled;
    if (enabled) {
        scheduleAutoPause();
    }
    else {
        clearAutoPause();
    }
});
document.addEventListener('dscSpeedChange', (e) => {
    const { speed } = e.detail;
    playbackSpeed = speed;
});
document.addEventListener('dscSourceLangChange', (e) => {
    const { language } = e.detail;
    // Clear translations when language changes
    sharedTranslationMap.clear();
    sharedTranslationErrorMap.clear();
});
// Handle target language changes without reloading the YLE page.
document.addEventListener('dscTargetLanguageChanged', (e) => {
    // Drop in-memory translations from previous target language.
    sharedTranslationMap.clear();
    sharedTranslationErrorMap.clear();
    // Drop pending queue items from the previous language context.
    if (translationQueue && Array.isArray(translationQueue.queue)) {
        translationQueue.queue.length = 0;
    }
    const originalSubtitlesWrapper = getOriginalSubtitlesWrapper();
    const displayedSubtitlesWrapper = document.getElementById('displayed-subtitles-wrapper');
    if (!originalSubtitlesWrapper || !displayedSubtitlesWrapper) {
        return;
    }
    // Re-render current subtitle immediately, then let queue fetch new-language translations.
    displayedSubtitlesWrapper.innerHTML = '';
    const originalSubtitleElements = getSubtitleTextElements(originalSubtitlesWrapper);
    if (originalSubtitleElements.length > 0) {
        addContentToDisplayedSubtitlesWrapper(displayedSubtitlesWrapper, originalSubtitleElements);
        translationQueue.processQueue().catch((error) => {
            console.error('DualSubExtension: Failed to refresh translations after target language change:', error);
        });
    }
});
// Handle extension toggle from control panel
// Simplified: no auto-sync, user controls everything
document.addEventListener('dscExtensionToggle', (e) => {
    const { enabled } = e.detail;
    extensionEnabled = enabled;
    console.info('DualSubExtension: Extension toggled:', enabled);
    // When extension is disabled, restore native YLE behavior
    if (!enabled) {
        // Clear any pending auto-pause timer
        clearAutoPause();
        // Hide extension's subtitle overlay
        const extensionOverlay = document.getElementById('dual-sub-overlay');
        if (extensionOverlay) {
            extensionOverlay.style.display = 'none';
        }
        const displayedSubtitlesWrapper = document.getElementById('displayed-subtitles-wrapper');
        if (displayedSubtitlesWrapper) {
            displayedSubtitlesWrapper.style.display = 'none';
        }
        // Show the original YLE subtitle wrapper
        const originalWrapper = getOriginalSubtitlesWrapper();
        if (originalWrapper) {
            originalWrapper.classList.remove('dsc-original-hidden');
        }
    }
    else {
        // When extension is enabled, show our overlay and hide native captions
        const extensionOverlay = document.getElementById('dual-sub-overlay');
        if (extensionOverlay) {
            // Restore flex display explicitly to maintain positioning
            extensionOverlay.style.display = 'flex';
        }
        const displayedSubtitlesWrapper = document.getElementById('displayed-subtitles-wrapper');
        if (displayedSubtitlesWrapper) {
            displayedSubtitlesWrapper.style.display = 'flex';
        }
        // Hide native YLE captions when extension is enabled
        const originalWrapper = getOriginalSubtitlesWrapper();
        if (originalWrapper) {
            originalWrapper.classList.add('dsc-original-hidden');
            renderCurrentSubtitleImmediately(originalWrapper);
        }
        // Re-schedule auto-pause if it's enabled
        if (autoPauseEnabled) {
            scheduleAutoPause();
        }
    }
});
// Handle source language change from control integration
// Simplified: no auto-sync, just update detectedSourceLanguage
document.addEventListener('dscSourceLanguageChanged', (e) => {
    const { sourceLanguage, targetLanguage } = e.detail;
    // Only update detectedSourceLanguage if new value is not null
    if (sourceLanguage !== null) {
        detectedSourceLanguage = sourceLanguage;
    }
    console.info('DualSubExtension: Source language changed:', sourceLanguage, 'Target:', targetLanguage);
});
// Handle captions state change (CC button toggle)
// Simplified: no auto-sync, just log the change
document.addEventListener('dscCaptionsStateChanged', (e) => {
    const { captionsEnabled, extensionEnabled: newExtensionEnabled, dualSubEnabled: newDualSubEnabled } = e.detail;
    console.info('DualSubExtension: Captions state changed:', captionsEnabled, 'Extension:', newExtensionEnabled, 'DualSub:', newDualSubEnabled);
});
// Listen for source language detection from YLE adapter
document.addEventListener('yleSourceLanguageDetected', (e) => {
    const { language } = e.detail;
    detectedSourceLanguage = language;
    ControlIntegration.setSourceLanguage(language);
    console.info('DualSubExtension: YLE source language detected:', language);
});
// Handle YLE native captions toggle (when user disables subtitles via YLE menu)
document.addEventListener('yleNativeCaptionsToggled', (e) => {
    const { enabled } = e.detail;
    console.info('DualSubExtension: Native YLE captions toggled:', enabled);
    let effectiveExtensionEnabled = extensionEnabled;
    // CC toggle flow:
    // 1) Native CC emits `yleNativeCaptionsToggled`
    // 2) setCaptionsEnabled may emit `dscExtensionToggle` when effective state changes
    // 3) `dscExtensionToggle` listener above owns overlay/native visibility switching
    ControlIntegration.setCaptionsEnabled(enabled);
    const state = ControlIntegration.getState();
    effectiveExtensionEnabled = state.extensionEnabled;
    extensionEnabled = effectiveExtensionEnabled;
    if (!enabled || !effectiveExtensionEnabled) {
        clearAutoPause();
    }
});
