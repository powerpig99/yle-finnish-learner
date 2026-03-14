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
const DISPLAYED_SUBTITLES_VIDEO_BOTTOM_OFFSET_PROPERTY = '--dsc-rendered-video-bottom-offset';
const DISPLAYED_SUBTITLES_RENDERED_VIDEO_WIDTH_PROPERTY = '--dsc-rendered-video-width';
const BOTTOM_CONTROLS_OVERLAY_SELECTORS = [
    'div[class*="Timeline__TimelineContainer"]',
    'div[class*="BottomControlBar__LeftControls"]',
    'div[class*="BottomControlBar__RightControls"]',
];
function clearDisplayedSubtitlesWrapperBottomOffset(displayedSubtitlesWrapper) {
    if (!displayedSubtitlesWrapper?.style) {
        return;
    }
    displayedSubtitlesWrapper.style.removeProperty(DISPLAYED_SUBTITLES_VIDEO_BOTTOM_OFFSET_PROPERTY);
}
function clearDisplayedSubtitlesWrapperVideoWidth(displayedSubtitlesWrapper) {
    if (!displayedSubtitlesWrapper?.style) {
        return;
    }
    displayedSubtitlesWrapper.style.removeProperty(DISPLAYED_SUBTITLES_RENDERED_VIDEO_WIDTH_PROPERTY);
}
function parseObjectPositionOffset(token, freeSpace) {
    const normalizedToken = String(token || '').trim().toLowerCase();
    if (!normalizedToken) {
        return null;
    }
    if (normalizedToken === 'top' || normalizedToken === 'left') {
        return 0;
    }
    if (normalizedToken === 'center') {
        return freeSpace / 2;
    }
    if (normalizedToken === 'bottom' || normalizedToken === 'right') {
        return freeSpace;
    }
    if (normalizedToken.endsWith('%')) {
        const percent = Number.parseFloat(normalizedToken.slice(0, -1));
        return Number.isFinite(percent) ? (freeSpace * percent) / 100 : null;
    }
    if (normalizedToken.endsWith('px')) {
        const pixels = Number.parseFloat(normalizedToken.slice(0, -2));
        return Number.isFinite(pixels) ? pixels : null;
    }
    return null;
}
function getObjectPositionTokens(objectPosition) {
    const tokens = String(objectPosition || '').trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
        return ['50%', '50%'];
    }
    if (tokens.length === 1) {
        const token = tokens[0].toLowerCase();
        if (token === 'top' || token === 'bottom') {
            return ['50%', token];
        }
        return [token, '50%'];
    }
    return [tokens[0], tokens[1]];
}
function getRenderedVideoDimensions(boxWidth, boxHeight, intrinsicWidth, intrinsicHeight, objectFit) {
    if (!(boxWidth > 0) || !(boxHeight > 0) || !(intrinsicWidth > 0) || !(intrinsicHeight > 0)) {
        return null;
    }
    if (objectFit === 'fill' || objectFit === 'cover') {
        return { width: boxWidth, height: boxHeight };
    }
    if (objectFit === 'none') {
        return { width: intrinsicWidth, height: intrinsicHeight };
    }
    const containScale = Math.min(boxWidth / intrinsicWidth, boxHeight / intrinsicHeight);
    const containDimensions = {
        width: intrinsicWidth * containScale,
        height: intrinsicHeight * containScale,
    };
    if (objectFit === 'contain') {
        return containDimensions;
    }
    if (objectFit === 'scale-down') {
        if (intrinsicWidth <= boxWidth && intrinsicHeight <= boxHeight) {
            return { width: intrinsicWidth, height: intrinsicHeight };
        }
        return containDimensions;
    }
    return null;
}
function getRenderedVideoBottomCoordinate(videoElement) {
    if (!videoElement || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
        return null;
    }
    const videoRect = videoElement.getBoundingClientRect?.();
    if (!videoRect || !(videoRect.width > 0) || !(videoRect.height > 0)) {
        return null;
    }
    const computedStyle = window.getComputedStyle(videoElement);
    const objectFit = computedStyle.objectFit || 'fill';
    const intrinsicWidth = typeof videoElement.videoWidth === 'number' ? videoElement.videoWidth : 0;
    const intrinsicHeight = typeof videoElement.videoHeight === 'number' ? videoElement.videoHeight : 0;
    if (!(intrinsicWidth > 0) || !(intrinsicHeight > 0)) {
        return objectFit === 'contain' || objectFit === 'none' || objectFit === 'scale-down'
            ? null
            : videoRect.bottom;
    }
    const renderedDimensions = getRenderedVideoDimensions(
        videoRect.width,
        videoRect.height,
        intrinsicWidth,
        intrinsicHeight,
        objectFit
    );
    if (!renderedDimensions) {
        return null;
    }
    if (renderedDimensions.height >= videoRect.height) {
        return videoRect.bottom;
    }
    const [, verticalPositionToken] = getObjectPositionTokens(computedStyle.objectPosition || '50% 50%');
    const freeVerticalSpace = videoRect.height - renderedDimensions.height;
    const verticalOffset = parseObjectPositionOffset(verticalPositionToken, freeVerticalSpace);
    if (!Number.isFinite(verticalOffset)) {
        return null;
    }
    return videoRect.top + verticalOffset + renderedDimensions.height;
}
function getRenderedVideoWidth(videoElement) {
    if (!videoElement || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
        return null;
    }
    const videoRect = videoElement.getBoundingClientRect?.();
    if (!videoRect || !(videoRect.width > 0) || !(videoRect.height > 0)) {
        return null;
    }
    const computedStyle = window.getComputedStyle(videoElement);
    const objectFit = computedStyle.objectFit || 'fill';
    const intrinsicWidth = typeof videoElement.videoWidth === 'number' ? videoElement.videoWidth : 0;
    const intrinsicHeight = typeof videoElement.videoHeight === 'number' ? videoElement.videoHeight : 0;
    if (!(intrinsicWidth > 0) || !(intrinsicHeight > 0)) {
        return objectFit === 'contain' || objectFit === 'none' || objectFit === 'scale-down'
            ? null
            : videoRect.width;
    }
    const renderedDimensions = getRenderedVideoDimensions(
        videoRect.width,
        videoRect.height,
        intrinsicWidth,
        intrinsicHeight,
        objectFit
    );
    return renderedDimensions ? renderedDimensions.width : null;
}
function getVisibleBottomControlsTopCoordinate(playerUI = typeof document !== 'undefined'
    ? document.querySelector('[class*="PlayerUI__UI"]')
    : null) {
    if (!playerUI?.classList?.contains('yle-mouse-active') || typeof playerUI.querySelectorAll !== 'function') {
        return null;
    }
    const controlElements = new Set();
    for (const selector of BOTTOM_CONTROLS_OVERLAY_SELECTORS) {
        const matches = playerUI.querySelectorAll(selector);
        for (const match of matches) {
            controlElements.add(match);
        }
    }
    let controlsTop = null;
    for (const element of controlElements) {
        const rect = element?.getBoundingClientRect?.();
        if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
            continue;
        }
        controlsTop = controlsTop === null ? rect.top : Math.min(controlsTop, rect.top);
    }
    return controlsTop;
}
function getDisplayedSubtitlesControlsOverlapOffset(videoElement = typeof document !== 'undefined'
    ? document.querySelector('video')
    : null, playerUI = typeof document !== 'undefined'
    ? document.querySelector('[class*="PlayerUI__UI"]')
    : null) {
    const renderedVideoBottom = getRenderedVideoBottomCoordinate(videoElement);
    const controlsTop = getVisibleBottomControlsTopCoordinate(playerUI);
    if (!Number.isFinite(renderedVideoBottom) || !Number.isFinite(controlsTop)) {
        return 0;
    }
    return Math.max(0, renderedVideoBottom - controlsTop);
}
function getDisplayedSubtitlesBottomOffset(displayedSubtitlesWrapper, videoElement = typeof document !== 'undefined'
    ? document.querySelector('video')
    : null, playerUI = typeof document !== 'undefined'
    ? document.querySelector('[class*="PlayerUI__UI"]')
    : null) {
    if (!displayedSubtitlesWrapper || !videoElement) {
        return null;
    }
    const containingRect = displayedSubtitlesWrapper.offsetParent?.getBoundingClientRect?.();
    const renderedVideoBottom = getRenderedVideoBottomCoordinate(videoElement);
    if (!containingRect || !Number.isFinite(renderedVideoBottom)) {
        return null;
    }
    const renderedVideoBottomOffset = Math.max(0, containingRect.bottom - renderedVideoBottom);
    const controlsOverlapOffset = getDisplayedSubtitlesControlsOverlapOffset(videoElement, playerUI);
    return renderedVideoBottomOffset + controlsOverlapOffset;
}
function syncDisplayedSubtitlesWrapperBottomOffset(displayedSubtitlesWrapper = typeof document !== 'undefined'
    ? document.getElementById("displayed-subtitles-wrapper")
    : null, videoElement = typeof document !== 'undefined'
    ? document.querySelector('video')
    : null, playerUI = typeof document !== 'undefined'
    ? document.querySelector('[class*="PlayerUI__UI"]')
    : null) {
    if (!displayedSubtitlesWrapper?.style) {
        return;
    }
    const bottomOffset = getDisplayedSubtitlesBottomOffset(displayedSubtitlesWrapper, videoElement, playerUI);
    if (!Number.isFinite(bottomOffset)) {
        clearDisplayedSubtitlesWrapperBottomOffset(displayedSubtitlesWrapper);
        return;
    }
    displayedSubtitlesWrapper.style.setProperty(
        DISPLAYED_SUBTITLES_VIDEO_BOTTOM_OFFSET_PROPERTY,
        `${bottomOffset}px`
    );
}
function syncDisplayedSubtitlesWrapperVideoWidth(displayedSubtitlesWrapper = typeof document !== 'undefined'
    ? document.getElementById("displayed-subtitles-wrapper")
    : null, videoElement = typeof document !== 'undefined'
    ? document.querySelector('video')
    : null) {
    if (!displayedSubtitlesWrapper?.style) {
        return;
    }
    const renderedVideoWidth = getRenderedVideoWidth(videoElement);
    if (!Number.isFinite(renderedVideoWidth)) {
        clearDisplayedSubtitlesWrapperVideoWidth(displayedSubtitlesWrapper);
        return;
    }
    displayedSubtitlesWrapper.style.setProperty(
        DISPLAYED_SUBTITLES_RENDERED_VIDEO_WIDTH_PROPERTY,
        `${renderedVideoWidth}px`
    );
}
function syncDisplayedSubtitlesWrapperVideoGeometry(displayedSubtitlesWrapper = typeof document !== 'undefined'
    ? document.getElementById("displayed-subtitles-wrapper")
    : null) {
    const videoElement = typeof document !== 'undefined' ? document.querySelector('video') : null;
    const playerUI = typeof document !== 'undefined'
        ? document.querySelector('[class*="PlayerUI__UI"]')
        : null;
    syncDisplayedSubtitlesWrapperBottomOffset(displayedSubtitlesWrapper, videoElement, playerUI);
    syncDisplayedSubtitlesWrapperVideoWidth(displayedSubtitlesWrapper, videoElement);
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
    syncDisplayedSubtitlesWrapperVideoGeometry(displayedSubtitlesWrapper);
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
            remaining.add(span);
            continue;
        }
        if (entry?.status === 'pending') {
            span.textContent = 'Translating...';
            span.style.opacity = '';
            span.removeAttribute('title');
            remaining.add(span);
            continue;
        }
        if (entry?.status === 'failed') {
            renderFailedTranslation(span, originalText, entry);
            remaining.add(span);
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
document.addEventListener('dscTranslationStateChanged', (event) => {
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
        const hasTranslatableContent = hasTranslatableSubtitleContent(finnishText);
        let targetLanguageText = "Translating...";
        let shouldRequestVisibleTranslation = false;
        if (!hasTranslatableContent) {
            targetLanguageText = finnishText;
            setPassThroughSubtitleState(finnishText);
        }
        else if (stateEntry?.status === 'success' && stateEntry.text) {
            targetLanguageText = stateEntry.text;
        }
        else if (stateEntry?.status === 'failed') {
            shouldRequestVisibleTranslation = true;
        }
        else if (stateEntry?.status === 'pending') {
        }
        else {
            shouldRequestVisibleTranslation = true;
        }
        const targetLanguageSpan = createSubtitleSpan(targetLanguageText, `${spanClassName} translated-text-span`);
        targetLanguageSpan.dataset.originalText = finnishText;
        targetLanguageSpan.dataset.translationKey = translationKey;
        if (hasTranslatableContent) {
            trackActiveTranslationSpan(translationKey, targetLanguageSpan);
        }
        displayedSubtitlesWrapper.appendChild(targetLanguageSpan);
        if (shouldRequestVisibleTranslation && typeof requestVisibleSubtitleTranslation === 'function') {
            requestVisibleSubtitleTranslation(finnishText).catch((error) => {
                console.error('YleDualSubExtension: Error requesting visible subtitle translation:', error);
            });
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
    syncDisplayedSubtitlesWrapperVideoGeometry(displayedSubtitlesWrapper);
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
/** @type {HTMLVideoElement|null} */
let _trackedVideoElement = null;
function triggerVideoLifecycleInitialization() {
    if (typeof setupVideoSpeedControl === 'function') {
        setupVideoSpeedControl();
    }
    _trackedVideoElement?.addEventListener('loadedmetadata', () => {
        syncDisplayedSubtitlesWrapperVideoGeometry();
    });
    if (typeof loadMovieCacheAndUpdateMetadata === 'function') {
        loadMovieCacheAndUpdateMetadata().catch((error) => {
            console.error("YleDualSubExtension: Error populating shared translation map from cache:", error);
        });
    }
}
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
                const video = element.tagName === "VIDEO"
                    ? element
                    : element.querySelector('video');
                if (!video || video === _trackedVideoElement) {
                    continue;
                }
                _trackedVideoElement = video;
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
/**
 * Detect when BottomControlBar__LeftControls is added to the DOM.
 * This is the authoritative "player ready" signal for panel mounting.
 * @param {MutationRecord} mutation
 * @returns {boolean}
 */
function isControlBarMutation(mutation) {
    if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) {
        return false;
    }
    for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) {
            continue;
        }
        const element = node;
        if (element.matches?.('[class^="BottomControlBar__LeftControls"]') ||
            element.querySelector?.('[class^="BottomControlBar__LeftControls"]')) {
            return true;
        }
    }
    return false;
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
            if (isControlBarMutation(mutation)) {
                if (typeof addDualSubExtensionSection === 'function') {
                    addDualSubExtensionSection().catch((error) => {
                        console.error("YleDualSubExtension: Error adding dual sub extension section:", error);
                    });
                }
            }
            if (isVideoElementAppearMutation(mutation)) {
                triggerVideoLifecycleInitialization();
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
// Bootstrap: if player already present when extension is injected (live-page case).
if (document.querySelector('[class^="BottomControlBar__LeftControls"]')) {
    if (typeof addDualSubExtensionSection === 'function') {
        addDualSubExtensionSection().catch((error) => {
            console.error("YleDualSubExtension: Error adding dual sub extension section:", error);
        });
    }
}
// Bootstrap: if video already present when extension is injected.
const existingVideo = document.querySelector('video');
if (existingVideo && existingVideo !== _trackedVideoElement) {
    _trackedVideoElement = existingVideo;
    triggerVideoLifecycleInitialization();
}
if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
        syncDisplayedSubtitlesWrapperVideoGeometry();
    }, { passive: true });
}
document.addEventListener('dscYleControlsVisibilityChanged', () => {
    syncDisplayedSubtitlesWrapperVideoGeometry();
});
document.addEventListener('fullscreenchange', () => {
    syncDisplayedSubtitlesWrapperVideoGeometry();
});
