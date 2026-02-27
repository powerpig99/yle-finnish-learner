// ==================================
// SUBTITLE DOM + MUTATION OBSERVERS
// ==================================
const SUBTITLE_WRAPPER_SELECTORS = [
    '[data-testid="subtitles-wrapper"]',
    '[data-testid*="subtitles"]',
    '[data-testid*="subtitle"]',
    '[aria-live="polite"]',
    '[role="status"]',
    '[class*="Subtitles"]',
    '[class*="Subtitle"]'
];
let cachedNativeSubtitlesWrapper = null;
/**
 * Find subtitle text elements inside a container.
 * Uses a generic approach: find leaf elements with text content.
 * Immune to YLE DOM structure changes (span, div, p, etc. all work).
 */
function getSubtitleTextElements(container) {
    const leaves = [];
    container.querySelectorAll('*').forEach(el => {
        const htmlEl = el;
        if (htmlEl.children.length === 0 && htmlEl.textContent?.trim()) {
            leaves.push(htmlEl);
        }
    });
    return leaves;
}
function isLikelySubtitleWrapper(element) {
    if (!element)
        return false;
    if (element.id === "displayed-subtitles-wrapper")
        return false;
    if (element.closest?.('#dual-sub-overlay'))
        return false;
    const testId = element.getAttribute('data-testid') || '';
    const ariaLive = element.getAttribute('aria-live') || '';
    const role = element.getAttribute('role') || '';
    if (testId.toLowerCase().includes('subtitle'))
        return true;
    if (ariaLive === 'polite')
        return true;
    if (role === 'status')
        return true;
    return getSubtitleTextElements(element).length > 0;
}
function findNativeSubtitlesWrapper() {
    const playerUI = document.querySelector('[class*="PlayerUI__UI"]');
    const scope = playerUI || document;
    for (const selector of SUBTITLE_WRAPPER_SELECTORS) {
        const candidates = Array.from(scope.querySelectorAll(selector));
        for (const candidate of candidates) {
            if (isLikelySubtitleWrapper(candidate)) {
                return candidate;
            }
        }
    }
    return null;
}
function getNativeSubtitlesWrapper() {
    if (cachedNativeSubtitlesWrapper && document.contains(cachedNativeSubtitlesWrapper)) {
        return cachedNativeSubtitlesWrapper;
    }
    cachedNativeSubtitlesWrapper = findNativeSubtitlesWrapper();
    return cachedNativeSubtitlesWrapper;
}
function normalizeSubtitleTextForTiming(text) {
    return text.replace(/\n/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
function subtitleTextsLikelyMatch(displayedText, cueText) {
    const displayed = normalizeSubtitleTextForTiming(displayedText);
    const cue = normalizeSubtitleTextForTiming(cueText);
    if (!displayed || !cue)
        return false;
    return displayed === cue || displayed.includes(cue) || cue.includes(displayed);
}
function pickLaterTimingCandidate(current, candidate) {
    if (!current)
        return candidate;
    if (candidate.startTime > current.startTime)
        return candidate;
    if (candidate.startTime === current.startTime && candidate.endTime > current.endTime)
        return candidate;
    return current;
}
function resolveDisplayedSubtitleEndTimeFromActiveCues(displayedText, videoElement) {
    let bestTextMatch = null;
    let bestActiveCue = null;
    for (const track of Array.from(videoElement.textTracks)) {
        if (track.mode === "disabled")
            continue;
        const activeCues = track.activeCues;
        if (!activeCues || activeCues.length === 0)
            continue;
        for (let i = 0; i < activeCues.length; i++) {
            const cue = activeCues[i];
            const cueText = typeof cue.text === "string" ? cue.text : "";
            if (typeof cue.startTime !== "number" || typeof cue.endTime !== "number")
                continue;
            if (!Number.isFinite(cue.startTime) || !Number.isFinite(cue.endTime))
                continue;
            bestActiveCue = pickLaterTimingCandidate(bestActiveCue, {
                startTime: cue.startTime,
                endTime: cue.endTime
            });
            if (subtitleTextsLikelyMatch(displayedText, cueText)) {
                bestTextMatch = pickLaterTimingCandidate(bestTextMatch, {
                    startTime: cue.startTime,
                    endTime: cue.endTime
                });
            }
        }
    }
    if (bestTextMatch) {
        return bestTextMatch.endTime;
    }
    if (bestActiveCue) {
        return bestActiveCue.endTime;
    }
    return null;
}
function syncAutoPauseTimingFromDisplayedSubtitle(displayedText) {
    const videoElement = document.querySelector("video");
    if (!videoElement) {
        setCurrentSubtitleEndTime(null);
        return;
    }
    const matchedEndTime = resolveDisplayedSubtitleEndTimeFromActiveCues(displayedText, videoElement);
    setCurrentSubtitleEndTime(matchedEndTime);
    if (matchedEndTime !== null) {
        scheduleAutoPause();
    }
}
/**
 * Create another div for displaying translated subtitles,
 * which inherits class name from original subtitles wrapper.
 * When the extension is turned on, the original subtitles wrapper will stay hidden
 * while this displayed subtitles wrapper will be shown.
 *
 * Because, we need to listen to mutations on original subtitles wrapper,
 * so we want to avoid modifying it directly, which can trigger mutation observer recursively.
 * @param {string} className - class name to set for the new div
 * @returns {HTMLDivElement} - new subtitles wrapper div to be displayed
 */
function copySubtitlesWrapper(className) {
    const displayedSubtitlesWrapper = document.createElement("div");
    displayedSubtitlesWrapper.setAttribute("aria-live", "polite");
    displayedSubtitlesWrapper.setAttribute("class", className);
    displayedSubtitlesWrapper.setAttribute("id", "displayed-subtitles-wrapper");
    return displayedSubtitlesWrapper;
}
/**
 *
 * Create a span element for subtitle text.
 *
 * @param {string} text - text content of the span
 * @param {string} className - class name to set for the span
 * @returns {HTMLSpanElement} - created span element to display
 */
function createSubtitleSpan(text, className) {
    const span = document.createElement("span");
    span.setAttribute("class", className);
    span.textContent = text;
    return span;
}
/**
 * Check if a mutation is related to subtitles wrapper
 * @param {MutationRecord} mutation
 * @returns {boolean} - true if the mutation is related to subtitles wrapper
 */
function isMutationRelatedToSubtitlesWrapper(mutation) {
    try {
        const target = mutation?.target;
        const wrapper = getNativeSubtitlesWrapper();
        if (wrapper && target === wrapper) {
            return true;
        }
        if (target?.dataset?.["testid"] === "subtitles-wrapper") {
            return true;
        }
        // Also detect mutations on children of the wrapper (e.g. LiveRegion child)
        // YLE may mutate subtitle-row divs inside a child container
        if (wrapper && target && wrapper.contains(target)) {
            return true;
        }
        return false;
    }
    catch (error) {
        console.warn("YleDualSubExtension: Catch error checking mutation related to subtitles wrapper:", error);
        return false;
    }
}
/**
 * Create and position the displayed subtitles wrapper next to the original subtitles wrapper
 * if it does not exist yet
 *
 * @param {HTMLElement} originalSubtitlesWrapper
 * @returns {HTMLElement}
 */
function createAndPositionDisplayedSubtitlesWrapper(originalSubtitlesWrapper) {
    let displayedSubtitlesWrapper = document.getElementById("displayed-subtitles-wrapper");
    if (!displayedSubtitlesWrapper) {
        displayedSubtitlesWrapper = copySubtitlesWrapper(originalSubtitlesWrapper.className);
        originalSubtitlesWrapper.parentNode?.insertBefore(displayedSubtitlesWrapper, originalSubtitlesWrapper.nextSibling);
    }
    return displayedSubtitlesWrapper;
}
/** @type {Map<string, Set<HTMLElement>>} */
const activeTranslationSpans = new Map();
function clearActiveTranslationSpans() {
    activeTranslationSpans.clear();
}
function trackActiveTranslationSpan(key, span) {
    let spans = activeTranslationSpans.get(key);
    if (!spans) {
        spans = new Set();
        activeTranslationSpans.set(key, spans);
    }
    spans.add(span);
}
function renderFailedTranslation(span, originalText, entry) {
    span.textContent = originalText;
    span.style.opacity = '0.6';
    const errorHint = entry?.error ? `: ${entry.error}` : '';
    span.title = `Translation failed - showing original${errorHint}`;
}
function updateTrackedTranslationSpans(key) {
    const spans = activeTranslationSpans.get(key);
    if (!spans || spans.size === 0) {
        activeTranslationSpans.delete(key);
        return;
    }
    const entry = subtitleState.get(key);
    const remaining = new Set();
    for (const span of spans) {
        if (!span.isConnected) {
            continue;
        }
        const originalText = span.dataset.originalText || '';
        if (entry?.status === 'success' && entry.text) {
            span.textContent = entry.text;
            span.style.opacity = '';
            span.removeAttribute('title');
            continue;
        }
        if (entry?.status === 'failed') {
            renderFailedTranslation(span, originalText, entry);
            continue;
        }
        remaining.add(span);
    }
    if (remaining.size > 0) {
        activeTranslationSpans.set(key, remaining);
    }
    else {
        activeTranslationSpans.delete(key);
    }
}
document.addEventListener('dscTranslationResolved', (event) => {
    const key = event?.detail?.key;
    if (!key || typeof key !== 'string') {
        return;
    }
    updateTrackedTranslationSpans(key);
});
/**
 * Add both Finnish and target language subtitles to the displayed subtitles wrapper
 *
 * @param {HTMLElement} displayedSubtitlesWrapper
 * @param {NodeListOf<HTMLElement>} originalSubtitleElements
 * original Finnish subtitle text elements (spans or divs)
 */
function addContentToDisplayedSubtitlesWrapper(displayedSubtitlesWrapper, originalSubtitleElements) {
    if (!originalSubtitleElements || originalSubtitleElements.length === 0) {
        return;
    }
    const spanClassName = originalSubtitleElements[0].className;
    const finnishText = Array.from(originalSubtitleElements).map((el) => (el.textContent || '')).join(" ")
        .replace(/\n/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!finnishText || finnishText.length === 0) {
        return;
    }
    // Keep auto-pause timing sourced from active rendered text-track cues.
    syncAutoPauseTimingFromDisplayedSubtitle(finnishText);
    // Create Finnish span with clickable words for popup dictionary
    // ALWAYS shown so users can click words to look up translations
    const finnishSpan = createSubtitleSpanWithClickableWords(finnishText, spanClassName);
    displayedSubtitlesWrapper.appendChild(finnishSpan);
    // Only add translation line when dualSubEnabled is true AND translation is needed
    // Skip translation if source and target languages are the same
    if (dualSubEnabled && shouldTranslate()) {
        const translationKey = toTranslationKey(finnishText);
        const stateEntry = subtitleState.get(translationKey);
        let targetLanguageText = "Translating...";
        let shouldTrackPendingSpan = false;
        let shouldStartQueueProcessing = false;
        let failedEntryForFallback = null;
        if (stateEntry?.status === 'success' && stateEntry.text) {
            targetLanguageText = stateEntry.text;
        }
        else if (stateEntry?.status === 'failed') {
            const canRetry = typeof stateEntry.nextRetryAt !== 'number' || stateEntry.nextRetryAt <= Date.now();
            if (canRetry && enqueueTranslation(finnishText)) {
                shouldTrackPendingSpan = true;
                shouldStartQueueProcessing = true;
            }
            else {
                targetLanguageText = finnishText;
                failedEntryForFallback = stateEntry;
            }
        }
        else if (stateEntry?.status === 'pending') {
            shouldTrackPendingSpan = true;
            shouldStartQueueProcessing = true;
        }
        else if (enqueueTranslation(finnishText)) {
            shouldTrackPendingSpan = true;
            shouldStartQueueProcessing = true;
        }
        const targetLanguageSpan = createSubtitleSpan(targetLanguageText, `${spanClassName} translated-text-span`);
        targetLanguageSpan.dataset.originalText = finnishText;
        targetLanguageSpan.dataset.translationKey = translationKey;
        if (failedEntryForFallback) {
            renderFailedTranslation(targetLanguageSpan, finnishText, failedEntryForFallback);
        }
        if (shouldTrackPendingSpan) {
            trackActiveTranslationSpan(translationKey, targetLanguageSpan);
        }
        displayedSubtitlesWrapper.appendChild(targetLanguageSpan);
        if (shouldStartQueueProcessing) {
            translationQueue.processQueue().catch(console.error);
        }
    }
}
/**
 * Handle mutation related to subtitles wrapper
 * Hide the original subtitles wrapper and create another div for displaying translated subtitles
 * along with original Finnish subtitles.
 *
 * @param {MutationRecord} mutation
 * @returns {void}
 */
// Track last displayed subtitle to avoid unnecessary re-renders
let lastDisplayedSubtitleText = "";
function handleSubtitlesWrapperMutation(mutation) {
    // When extension is off, don't touch the original subtitles at all
    if (!extensionEnabled) {
        return;
    }
    // Always use the actual subtitles-wrapper, not mutation.target
    // (mutation may fire on a child like the LiveRegion)
    const originalSubtitlesWrapper = getNativeSubtitlesWrapper() || mutation.target;
    originalSubtitlesWrapper.classList.add('dsc-original-hidden');
    const displayedSubtitlesWrapper = createAndPositionDisplayedSubtitlesWrapper(originalSubtitlesWrapper);
    // Sync font-size from original wrapper (YLE sets it dynamically via inline style
    // based on player size). Copy on every mutation to track player resizes.
    if (originalSubtitlesWrapper.style.fontSize) {
        displayedSubtitlesWrapper.style.fontSize = originalSubtitlesWrapper.style.fontSize;
    }
    if (mutation.addedNodes.length > 0) {
        const finnishTextElements = getSubtitleTextElements(originalSubtitlesWrapper);
        // Get the current Finnish text
        const currentFinnishText = Array.from(finnishTextElements)
            .map((el) => (el.textContent || ''))
            .join(" ")
            .replace(/\n/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        // Skip re-render if the text hasn't changed (prevents flicker when controls appear/disappear)
        if (currentFinnishText === lastDisplayedSubtitleText && displayedSubtitlesWrapper.innerHTML !== "") {
            return;
        }
        lastDisplayedSubtitleText = currentFinnishText;
        clearActiveTranslationSpans();
        displayedSubtitlesWrapper.innerHTML = "";
        addContentToDisplayedSubtitlesWrapper(displayedSubtitlesWrapper, finnishTextElements);
    }
    else {
        // No added nodes - subtitles might have been cleared
        // Check if the original wrapper is now empty
        const finnishTextElements = getSubtitleTextElements(originalSubtitlesWrapper);
        if (finnishTextElements.length === 0) {
            clearActiveTranslationSpans();
            displayedSubtitlesWrapper.innerHTML = "";
            lastDisplayedSubtitleText = "";
            setCurrentSubtitleEndTime(null);
        }
    }
}
// Debounce flag to prevent duplicate initialization during rapid DOM mutations.
// Set to true when video detection starts, prevents re-triggering for 1.5 seconds.
// This handles the case where video player construction fires multiple sequential mutations.
let checkVideoAppearMutationDebounceFlag = false;
/**
 * Generic video element detection - detects when any <video> element appears in the DOM
 * Works for both:
 * - Initial load: when video container is added with video already inside
 * - Episode transitions: when video element is added to existing container
 *
 * Future-proof: doesn't rely on YLE Areena's specific class names
 * NOTE: This function relies on an assumption that there is only one video element in the page at any time.
 * If YLE Areena changes to have multiple video elements, this logic may need to be revised.
 * @param {MutationRecord} mutation
 * @returns {boolean}
 */
function isVideoElementAppearMutation(mutation) {
    if (checkVideoAppearMutationDebounceFlag) {
        return false;
    }
    try {
        // Must be a childList mutation with added nodes
        if (mutation.type !== "childList" || mutation.addedNodes.length === 0) {
            return false;
        }
        // Check each added node
        const nodes = Array.from(mutation.addedNodes);
        for (const node of nodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) {
                continue;
            }
            const element = node;
            // Case 1: The added node IS a video element
            // Case 2: The added node CONTAINS a video element (initial load scenario)
            if (element.tagName === "VIDEO" || element.querySelector?.('video')) {
                checkVideoAppearMutationDebounceFlag = true;
                setTimeout(() => { checkVideoAppearMutationDebounceFlag = false; }, 1500);
                return true;
            }
        }
        return false;
    }
    catch (error) {
        console.warn("YleDualSubExtension: Error checking video element mutation:", error);
        return false;
    }
}
// CC ON/OFF detection is now handled by TextTrack API in settings.js
// (setupVideoSpeedControl → video.textTracks 'change' event)
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === "childList") {
            if (isMutationRelatedToSubtitlesWrapper(mutation)) {
                // ALWAYS process subtitle mutations to show clickable original text
                // Translation line visibility is controlled inside the handler
                handleSubtitlesWrapperMutation(mutation);
                return;
            }
            if (isVideoElementAppearMutation(mutation)) {
                addDualSubExtensionSection().catch((error) => {
                    console.error("YleDualSubExtension: Error adding dual sub extension section:", error);
                });
                loadMovieCacheAndUpdateMetadata().catch((error) => {
                    console.error("YleDualSubExtension: Error populating shared translation map from cache:", error);
                });
                // Apply saved playback speed
                setupVideoSpeedControl();
            }
        }
    });
});
// Start observing the document for added nodes
if (document.body instanceof Node) {
    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
}
