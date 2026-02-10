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
    if (element.closest?.('.dual-sub-extension-section'))
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
    // Set current subtitle endTime for auto-pause.
    // DOM mutation fires ~20-30ms before VTT startTime, so we use a tolerance
    // for the time-based lookup HERE (the one place where tolerance is needed).
    // scheduleAutoPause() then uses this stored endTime directly.
    const subtitles = window.fullSubtitles;
    const videoEl = document.querySelector('video');
    if (subtitles && subtitles.length > 0 && videoEl) {
        const ct = videoEl.currentTime;
        let matchedEndTime = null;
        for (let i = 0; i < subtitles.length; i++) {
            const sub = subtitles[i];
            // Tolerance on startTime only: DOM mutation fires slightly before VTT startTime
            if (ct >= sub.startTime - 0.15 && ct < sub.endTime) {
                matchedEndTime = sub.endTime;
                break;
            }
        }
        setCurrentSubtitleEndTime(matchedEndTime);
    }
    else {
        setCurrentSubtitleEndTime(null);
    }
    // Create Finnish span with clickable words for popup dictionary
    // ALWAYS shown so users can click words to look up translations
    const finnishSpan = createSubtitleSpanWithClickableWords(finnishText, spanClassName);
    displayedSubtitlesWrapper.appendChild(finnishSpan);
    // Only add translation line when dualSubEnabled is true AND translation is needed
    // Skip translation if source and target languages are the same
    if (dualSubEnabled && shouldTranslate()) {
        const translationKey = toTranslationKey(finnishText);
        let targetLanguageText = sharedTranslationMap.get(translationKey) ||
            sharedTranslationErrorMap.get(translationKey);
        // Generate unique ID for this translation span
        const spanId = `translation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        // If no translation yet, show "Translating..." and set up a retry mechanism
        if (!targetLanguageText) {
            targetLanguageText = "Translating...";
            // Queue this displayed text for translation since it wasn't found in cache
            // This handles cases where VTT text differs from displayed text (YLE combines cues)
            translationQueue.addToQueue(finnishText);
            translationQueue.processQueue();
            const startTime = Date.now();
            // Set up a periodic check to update the translation when it arrives
            const checkTranslation = setInterval(() => {
                const translation = sharedTranslationMap.get(translationKey) || sharedTranslationErrorMap.get(translationKey);
                // Find the specific span by ID to avoid updating wrong subtitle
                const translationSpan = document.getElementById(spanId);
                if (!translationSpan) {
                    // Span no longer exists (subtitle changed), stop checking
                    clearInterval(checkTranslation);
                    return;
                }
                if (translation) {
                    translationSpan.textContent = translation;
                    clearInterval(checkTranslation);
                }
                else if (Date.now() - startTime > 15000) {
                    // After 15 seconds, fall back to showing original text
                    translationSpan.textContent = finnishText;
                    translationSpan.style.opacity = '0.6';
                    translationSpan.title = 'Translation timed out - showing original';
                    clearInterval(checkTranslation);
                    console.warn("YleDualSubExtension: Translation timed out for:", finnishText.substring(0, 30));
                }
            }, 500);
            // Clear interval after 20 seconds as final safety net
            setTimeout(() => clearInterval(checkTranslation), 20000);
        }
        const targetLanguageSpan = createSubtitleSpan(targetLanguageText, `${spanClassName} translated-text-span`);
        targetLanguageSpan.id = spanId;
        displayedSubtitlesWrapper.appendChild(targetLanguageSpan);
    }
    // Schedule auto-pause at end of current subtitle
    scheduleAutoPause();
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
    if (!shouldProcessSubtitles()) {
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
        displayedSubtitlesWrapper.innerHTML = "";
        addContentToDisplayedSubtitlesWrapper(displayedSubtitlesWrapper, finnishTextElements);
        // Record subtitle timestamp for skip feature
        const videoElement = document.querySelector('video');
        if (videoElement && finnishTextElements.length > 0) {
            const subtitleText = Array.from(finnishTextElements).map(el => el.textContent || '').join(' ').trim();
            if (subtitleText) {
                const currentTime = videoElement.currentTime;
                // Only add if this is a new timestamp (not already recorded within 0.5s)
                const lastEntry = subtitleTimestamps[subtitleTimestamps.length - 1];
                if (!lastEntry || Math.abs(lastEntry.time - currentTime) > 0.5) {
                    subtitleTimestamps.push({ time: currentTime, text: subtitleText });
                    // Keep array sorted and limit size to prevent memory issues
                    subtitleTimestamps.sort((a, b) => a.time - b.time);
                    if (subtitleTimestamps.length > 1000) {
                        subtitleTimestamps.shift();
                    }
                }
            }
        }
    }
    else {
        // No added nodes - subtitles might have been cleared
        // Check if the original wrapper is now empty
        const finnishTextElements = getSubtitleTextElements(originalSubtitlesWrapper);
        if (finnishTextElements.length === 0) {
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
                // eslint-disable-next-line no-loop-func
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
// CC ON/OFF detection is now handled by TextTrack API in settings.ts
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
                addDualSubExtensionSection().then(() => { }).catch((error) => {
                    console.error("YleDualSubExtension: Error adding dual sub extension section:", error);
                });
                loadMovieCacheAndUpdateMetadata().then(() => { }).catch((error) => {
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
//# sourceMappingURL=subtitle-dom.js.map