// ==================================
// YLE AREENA EXTENSION
// ==================================
console.info('DualSubExtension: YLE Areena extension loaded');
// ==================================
// SECTION 1: STATE & INITIALIZATION
// ==================================
/* global openDatabase, saveSubtitlesBatch, loadSubtitlesByMovieName, upsertMovieMetadata, cleanupOldMovieData */
/** @type {Map<string, string>}
 * Shared translation map, with key is normalized Finnish text, and value is translated text
 */
const sharedTranslationMap = new Map();
/** @type {Map<string, string>} */
const sharedTranslationErrorMap = new Map();
/**
 *
 * @param {string} rawSubtitleFinnishText
 * @returns {string}
 */
function toTranslationKey(rawSubtitleFinnishText) {
    return rawSubtitleFinnishText.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
// ==================================
// UNIFIED CONTROL PANEL
// ==================================
/**
 * Initialize the unified control panel for the current platform
 * @returns {Promise<void>}
 */
// Flag to prevent concurrent initialization
let _unifiedPanelInitializing = false;
async function initializeUnifiedControlPanel() {
    console.log('DualSubExtension: initializeUnifiedControlPanel called');
    // Check if already initialized OR currently initializing (prevent race condition)
    const isActuallyInitialized = ControlIntegration.isInitialized();
    if (isActuallyInitialized) {
        console.log('DualSubExtension: ControlIntegration already initialized, skipping');
        return;
    }
    if (_unifiedPanelInitializing) {
        console.log('DualSubExtension: Panel currently initializing, skipping');
        return;
    }
    // Mark as initializing to prevent concurrent calls
    _unifiedPanelInitializing = true;
    // Wait briefly for player controls/container to settle before mounting panel
    console.log('DualSubExtension: Waiting 500ms for player UI to settle...');
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
        await window.waitForSettingsBootstrap();
        // Check initial captions state (YLE requires manual captions enable)
        const video = document.querySelector('video');
        const captionsEnabled = video
            ? Array.from(video.textTracks).some(t => t.mode !== 'disabled')
            : (fullSubtitles.length > 0 || !!detectedSourceLanguage);
        console.log('DualSubExtension: YLE captions initial state:', captionsEnabled);
        console.log('DualSubExtension: Calling ControlIntegration.init with state:', {
            dualSubEnabled, autoPauseEnabled, playbackSpeed, captionsEnabled
        });
        // Use detected source language if available, otherwise don't override
        const initOptions = {
            dualSubEnabled: dualSubEnabled,
            autoPauseEnabled: autoPauseEnabled,
            playbackSpeed: playbackSpeed,
            captionsEnabled: captionsEnabled
        };
        if (detectedSourceLanguage) {
            initOptions.sourceLanguage = detectedSourceLanguage;
        }
        const panel = await ControlIntegration.init(initOptions);
        if (panel) {
            console.info('DualSubExtension: Unified control panel initialized successfully');
            // Sync any already-loaded subtitles (YLE loads subtitles before panel init)
            if (fullSubtitles.length > 0) {
                ControlIntegration.setSubtitles(fullSubtitles);
                console.info('DualSubExtension: Synced', fullSubtitles.length, 'pre-loaded subtitles with ControlIntegration');
            }
            // After init, show overlay if conditions are met (CC on + extension on)
            const state = ControlIntegration.getState();
            console.info('DualSubExtension: Initial state after init:', {
                extensionEnabled: state.extensionEnabled,
                dualSubEnabled: state.dualSubEnabled
            });
            // Update global variable from loaded state
            extensionEnabled = state.extensionEnabled;
            dualSubEnabled = state.dualSubEnabled;
            autoPauseEnabled = state.autoPauseEnabled;
            playbackSpeed = state.playbackSpeed;
            if (captionsEnabled && state.extensionEnabled) {
                // Show our overlay
                const extensionOverlay = document.getElementById('dual-sub-overlay');
                if (extensionOverlay) {
                    extensionOverlay.style.display = 'flex';
                }
                const displayedSubtitlesWrapper = document.getElementById('displayed-subtitles-wrapper');
                if (displayedSubtitlesWrapper) {
                    displayedSubtitlesWrapper.style.display = 'flex';
                }
                console.info('DualSubExtension: Initial state: CC on + Extension on - showing our overlay');
            }
            else if (captionsEnabled && !state.extensionEnabled) {
                console.info('DualSubExtension: Initial state: CC on + Extension off - showing native captions');
            }
        }
        else {
            console.warn('DualSubExtension: Unified control panel init returned null');
        }
    }
    catch (error) {
        console.error('DualSubExtension: Error initializing unified control panel:', error);
    }
    finally {
        // Always release the init lock so future remount attempts can proceed.
        _unifiedPanelInitializing = false;
    }
}
// ==================================
// END UNIFIED CONTROL PANEL FLAG
// ==================================
/** @type {Array<{time: number, text: string}>}
 * Array of subtitle appearances with their video timestamps
 * Used for skip to next/previous subtitle feature
 */
const subtitleTimestamps = [];
/** @type {Array<{startTime: number, endTime: number, text: string}>}
 * Array of full subtitle data with start/end times
 * Used for repeat subtitle feature - accumulates like subtitleTimestamps
 */
const fullSubtitles = [];
/**
 * @type {string | null}
 * Memory cached current movie name
 */
let currentMovieName = null;
/**
 * @type {IDBDatabase | null}
 * Memory cached current database connection to write data to Index DB
 */
let globalDatabaseInstance = null;
openDatabase().then(db => {
    globalDatabaseInstance = db;
    console.info('YleDualSubExtension: Database opened successfully, stores:', Array.from(db.objectStoreNames));
    cleanupOldMovieData(db).then((cleanCount) => {
        console.info(`YleDualSubExtension: Clean ${cleanCount} movies data`);
    }).catch(error => { console.error("YleDualSubExtension: Error when cleaning old movie data: ", error); });
}).catch((error) => {
    console.error("YleDualSubExtension: Failed to established connection to indexDB: ", error);
});
// ==================================
// END SECTION
// ==================================
// ==================================
// SECTION 2: TRANSLATION QUEUE
// ==================================
/**
 * Show batch translation loading indicator
 */
function showBatchTranslationIndicator() {
    let indicator = document.getElementById('batch-translation-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'batch-translation-indicator';
        indicator.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.85);
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      z-index: 999999;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      display: flex;
      align-items: center;
      gap: 12px;
    `;
        indicator.innerHTML = `
      <div style="width: 20px; height: 20px; border: 2px solid #fff; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
      <div>
        <div style="font-weight: 600;">Pre-translating subtitles...</div>
        <div id="batch-progress-text" style="font-size: 12px; opacity: 0.8; margin-top: 4px;">0 / 0</div>
      </div>
    `;
        // Add spinner animation
        const style = document.createElement('style');
        style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
        document.head.appendChild(style);
        document.body.appendChild(indicator);
    }
    indicator.style.display = 'flex';
    updateBatchTranslationIndicator();
}
/**
 * Update batch translation progress indicator
 */
function updateBatchTranslationIndicator() {
    const progressText = document.getElementById('batch-progress-text');
    if (progressText) {
        progressText.textContent = `${batchTranslationProgress.current} / ${batchTranslationProgress.total} subtitles`;
    }
}
/**
 * Hide batch translation loading indicator
 */
function hideBatchTranslationIndicator() {
    const indicator = document.getElementById('batch-translation-indicator');
    if (indicator) {
        indicator.style.display = 'none';
    }
}
// ==================================
// END SECTION
// ==================================
// ==================================
// SECTION 3: UI MANIPULATION UTILS
// ==================================
// ==================================
// SECTION 3.5: POPUP DICTIONARY
// ==================================
// ==================================
// SECTION 3.55: MOUSE ACTIVITY TRACKING
// ==================================
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Add Dual Sub extension section to the video player's bottom control bar
 * next to the volume control.
 * @returns {Promise<void>}
 */
async function addDualSubExtensionSection() {
    console.log('DualSubExtension: addDualSubExtensionSection called');
    await initializeUnifiedControlPanel();
}
/**
 * Get video title once the video player is loaded
 * @returns {Promise<string | null>}
 */
async function getVideoTitle() {
    let titleElement = null;
    for (let attempt = 0; attempt < 8; attempt++) {
        titleElement = document.querySelector('[class*="VideoTitle__Titles"]');
        if (titleElement) {
            break;
        }
        await sleep(150);
    }
    if (!titleElement) {
        console.error("YleDualSubExtension: Cannot get movie name. Title Element is null.");
        return null;
    }
    const texts = Array.from(titleElement.querySelectorAll('span'))
        .map(span => (span.textContent || '').trim())
        .filter(text => text.length > 0);
    return texts.join(" | ");
}
// ==================================
// END SECTION
// ==================================
// =========================================
// MAIN SECTION: OBSERVERS & EVENT LISTENERS
// =========================================
/**
 * This function acts as a handler when new movie is played.
 * It will load that movie's subtitle from database and update metadata.
 * @param {string} [movieName] - Optional movie name. If not provided, will try to get from YLE page.
 * @returns {Promise<void>}
 */
async function loadMovieCacheAndUpdateMetadata(movieName) {
    const db = await openDatabase();
    // Clear accumulated subtitles when starting a new video
    subtitleTimestamps.length = 0;
    fullSubtitles.length = 0;
    // Use provided movie name or try to get from YLE page
    if (movieName) {
        currentMovieName = movieName;
    }
    else {
        currentMovieName = await getVideoTitle();
    }
    if (!currentMovieName) {
        return;
    }
    const subtitleRecords = await loadSubtitlesByMovieName(db, currentMovieName, targetLanguage);
    console.info(`YleDualSubExtension: Loaded ${subtitleRecords.length} cached subtitles for movie: ${currentMovieName}`);
    for (const subtitleRecord of subtitleRecords) {
        // Use toTranslationKey to normalize the key, matching how lookups are done
        sharedTranslationMap.set(toTranslationKey(subtitleRecord.originalText), subtitleRecord.translatedText);
    }
    const lastAccessedDays = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
    await upsertMovieMetadata(db, currentMovieName, lastAccessedDays);
}
document.addEventListener("sendTranslationTextEvent", (e) => {
    /**
     * Listening for incoming subtitle texts loaded into video player from injected.js
     * Send raw Finnish text from subtitle to a translation queue
     * Skip if batch translation is in progress (batch handles everything)
     * @param {Event} e
     */
    // Skip individual processing if batch translation is handling it
    if (isBatchTranslating) {
        return;
    }
    /** @type {string} */
    const rawSubtitleFinnishText = e.detail;
    const translationKey = toTranslationKey(rawSubtitleFinnishText);
    if (sharedTranslationMap.has(translationKey)) {
        return;
    }
    if (translationKey.length <= 1 || !/[a-zäöå]/.test(translationKey)) {
        sharedTranslationMap.set(translationKey, translationKey);
        return;
    }
    translationQueue.addToQueue(rawSubtitleFinnishText);
    translationQueue.processQueue().catch((error) => {
        console.error("YleDualSubExtension: Error processing translation queue:", error);
    });
});
// Listen for batch translation events from yle-injected.js
document.addEventListener("sendBatchTranslationEvent", (e) => {
    /**
     * Handle batch translation of all subtitles with context
     * This is triggered when a VTT file is loaded on YLE Areena
     */
    const { subtitles, source } = e.detail;
    if (!subtitles || subtitles.length === 0) {
        return;
    }
    console.info(`DualSubExtension: Processing batch of ${subtitles.length} subtitles from ${source || 'yle'}`);
    // Start batch translation in the background
    handleBatchTranslation(subtitles).catch((error) => {
        console.error("DualSubExtension: Error in batch translation:", error);
    });
});
// ==================================
// END UNIFIED CONTROL PANEL SECTION
// ==================================
