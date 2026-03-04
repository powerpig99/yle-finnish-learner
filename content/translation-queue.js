// ==================================
// TRANSLATION QUEUE
// ==================================
function normalizeSubtitleText(rawSubtitleText) {
    return String(rawSubtitleText || '').trim().replace(/\n/g, ' ');
}

function hasTranslatableSubtitleContent(normalizedSubtitleText) {
    // Use letter presence as the authoritative translation trigger.
    return /\p{L}/u.test(normalizedSubtitleText);
}

function shouldLogTranslationFailureAsWarning(errorMessage) {
    const normalizedError = String(errorMessage || '').toLowerCase();
    if (!normalizedError) {
        return false;
    }
    return normalizedError.includes('api key') ||
        normalizedError.includes('rate limit') ||
        normalizedError.includes('access denied') ||
        normalizedError.includes('quota') ||
        normalizedError.includes('not configured') ||
        /\berror:\s*4\d\d\b/.test(normalizedError);
}

function setPassThroughSubtitleState(normalizedText) {
    if (!normalizedText) {
        return false;
    }
    const key = toTranslationKey(normalizedText);
    const existingEntry = subtitleState.get(key);
    if (existingEntry?.status === 'success' && existingEntry.text === normalizedText) {
        clearEchoBackRetryState(key);
        return false;
    }
    subtitleState.set(key, {
        status: 'success',
        text: normalizedText,
        updatedAt: Date.now(),
    });
    clearEchoBackRetryState(key);
    dispatchTranslationResolved(key);
    return true;
}

class TranslationQueue {
    constructor() {
        /* Queue to manage translation requests to avoid hitting rate limits */
        this.BATCH_MAXIMUM_SIZE = 7;
        this.queue = [];
        this.isProcessing = false;
    }
    /**
     * @param {string} rawSubtitleText - Source subtitle text to translate
     * @param {boolean} shouldQueue - Whether to add this text to the JIT queue.
    * @returns {boolean} - True if subtitle moved to pending state
     */
    enqueue(rawSubtitleText, shouldQueue = true) {
        const normalizedText = normalizeSubtitleText(rawSubtitleText);
        if (!normalizedText) {
            return false;
        }
        if (!hasTranslatableSubtitleContent(normalizedText)) {
            setPassThroughSubtitleState(normalizedText);
            return false;
        }
        const key = toTranslationKey(normalizedText);
        const currentEntry = subtitleState.get(key);
        const now = Date.now();
        if (currentEntry?.status === 'pending' || currentEntry?.status === 'success') {
            return false;
        }
        if (currentEntry?.status === 'failed' &&
            typeof currentEntry.nextRetryAt === 'number' &&
            currentEntry.nextRetryAt > now) {
            return false;
        }
        subtitleState.set(key, {
            status: 'pending',
            updatedAt: now,
        });
        if (shouldQueue) {
            this.queue.push(normalizedText);
        }
        return true;
    }
    clear() {
        this.queue.length = 0;
    }
    /**
     * Process the translation queue in batches
     * By sending to background.js to handle translation and update subtitleState
     * @returns {Promise<void>}
     */
    async processQueue() {
        if (this.isProcessing || this.queue.length === 0 || !dualSubEnabled) {
            return;
        }
        this.isProcessing = true;
        try {
            while (this.queue.length > 0 && dualSubEnabled) {
                /** @type {Array<string>} */
                const toProcessItems = [];
                for (let i = 0; i < Math.min(this.queue.length, this.BATCH_MAXIMUM_SIZE); i++) {
                    const item = this.queue.shift();
                    if (item) {
                        toProcessItems.push(item);
                    }
                }
                if (toProcessItems.length === 0) {
                    continue;
                }
                if (!dualSubEnabled) {
                    for (const rawSubtitleText of toProcessItems) {
                        // Guard for dualSubEnabled being false at dequeue time: resolve pending entries deterministically.
                        markTranslationFailed(rawSubtitleText, 'Dual subtitles disabled', 0);
                    }
                    break;
                }
                try {
                    const [isSucceeded, translationResponse] = await fetchTranslation(toProcessItems);
                    if (isSucceeded) {
                        const translatedTexts = translationResponse;
                        /**
                         * @type {Array<SubtitleRecord>}
                         */
                        const toCacheSubtitleRecords = [];
                        for (let i = 0; i < toProcessItems.length; i++) {
                            const translatedText = translatedTexts[i];
                            const rawSubtitleText = toProcessItems[i];
                            if (translatedText === null || translatedText === undefined) {
                                markTranslationFailed(rawSubtitleText, 'Empty translation response');
                                continue;
                            }
                            const translatedTextValue = normalizeSubtitleText(translatedText);
                            if (!markTranslationSuccess(rawSubtitleText, translatedTextValue)) {
                                continue;
                            }
                            const resolvedEntry = subtitleState.get(toTranslationKey(rawSubtitleText));
                            const textToCache = resolvedEntry?.status === 'success' && resolvedEntry.text
                                ? resolvedEntry.text
                                : translatedTextValue;
                            if (currentMovieName) {
                                toCacheSubtitleRecords.push({
                                    "movieName": currentMovieName,
                                    "originalLanguage": "FI",
                                    targetLanguage,
                                    "originalText": toTranslationKey(rawSubtitleText),
                                    "translatedText": textToCache,
                                });
                            }
                        }
                        if (globalDatabaseInstance && toCacheSubtitleRecords.length > 0) {
                            saveSubtitlesBatch(globalDatabaseInstance, toCacheSubtitleRecords)
                                .catch((error) => {
                                console.error("YleDualSubExtension: Error saving subtitles batch to cache:", error);
                            });
                        }
                    }
                    else {
                        const translationErrorMessage = translationResponse;
                        const logTranslationError = shouldLogTranslationFailureAsWarning(translationErrorMessage)
                            ? console.warn
                            : console.error;
                        logTranslationError("YleDualSubExtension: JIT translation error:", translationErrorMessage);
                        for (const rawSubtitleText of toProcessItems) {
                            markTranslationFailed(rawSubtitleText, translationErrorMessage);
                        }
                    }
                }
                catch (error) {
                    const errorMessage = error.message || String(error);
                    console.error("YleDualSubExtension: System error when translating text:", error);
                    for (const rawSubtitleText of toProcessItems) {
                        markTranslationFailed(rawSubtitleText, errorMessage);
                    }
                }
            }
        }
        finally {
            this.isProcessing = false;
        }
    }
}
const translationQueue = new TranslationQueue();
const TRANSLATION_FAILURE_COOLDOWN_MS = 30000;
const ECHO_BACK_BASE_COOLDOWN_MS = 30000;
const ECHO_BACK_MAX_COOLDOWN_MS = 5 * 60 * 1000;
const ECHO_BACK_MAX_RETRIES = 4;
const echoBackRetryCounts = new Map();

function clearEchoBackRetryState(key) {
    echoBackRetryCounts.delete(key);
}

function incrementEchoBackRetryCount(key) {
    const nextCount = (echoBackRetryCounts.get(key) || 0) + 1;
    echoBackRetryCounts.set(key, nextCount);
    return nextCount;
}

function calculateEchoBackCooldownMs(retryCount) {
    const backoffMultiplier = 2 ** Math.max(0, retryCount - 1);
    const nextCooldownMs = ECHO_BACK_BASE_COOLDOWN_MS * backoffMultiplier;
    return Math.min(ECHO_BACK_MAX_COOLDOWN_MS, nextCooldownMs);
}

function parseTranslationFailureOptions(cooldownOrOptions) {
    if (typeof cooldownOrOptions === 'number') {
        return {
            cooldownMs: cooldownOrOptions,
            isEchoBack: false,
        };
    }
    if (!cooldownOrOptions || typeof cooldownOrOptions !== 'object') {
        return {
            cooldownMs: TRANSLATION_FAILURE_COOLDOWN_MS,
            isEchoBack: false,
        };
    }
    return {
        cooldownMs: typeof cooldownOrOptions.cooldownMs === 'number'
            ? cooldownOrOptions.cooldownMs
            : TRANSLATION_FAILURE_COOLDOWN_MS,
        isEchoBack: cooldownOrOptions.isEchoBack === true,
    };
}

function isSourceAndTargetSameLanguage() {
    if (typeof detectedSourceLanguage !== 'string' || !detectedSourceLanguage.trim()) {
        return false;
    }
    return normalizeLanguageCode(detectedSourceLanguage) === normalizeLanguageCode(targetLanguage);
}

function stripXmlLikeTags(text) {
    return String(text || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isLikelyWrappedEchoBackTranslation(originalText, translatedText) {
    if (!/<[^>]+>/.test(String(translatedText || ''))) {
        return false;
    }
    const normalizedOriginalKey = toTranslationKey(originalText);
    if (!normalizedOriginalKey) {
        return false;
    }
    const strippedTranslatedKey = toTranslationKey(stripXmlLikeTags(translatedText));
    if (!strippedTranslatedKey) {
        return false;
    }
    if (strippedTranslatedKey === normalizedOriginalKey) {
        return true;
    }
    const sourceIndex = strippedTranslatedKey.indexOf(normalizedOriginalKey);
    if (sourceIndex === -1) {
        return false;
    }
    const prefix = strippedTranslatedKey.slice(0, sourceIndex).trim();
    const suffix = strippedTranslatedKey
        .slice(sourceIndex + normalizedOriginalKey.length)
        .trim();
    const prefixWords = prefix ? prefix.split(/\s+/).length : 0;
    const suffixWords = suffix ? suffix.split(/\s+/).length : 0;
    return prefixWords + suffixWords <= 3;
}

function dispatchTranslationResolved(key) {
    document.dispatchEvent(new CustomEvent('dscTranslationResolved', { detail: { key } }));
}
/**
 * Enqueue subtitle translation request for both JIT and batch workflows.
 * @param {string} rawSubtitleText
 * @param {boolean} shouldQueue
 * @returns {boolean}
 */
function enqueueTranslation(rawSubtitleText, shouldQueue = true) {
    return translationQueue.enqueue(rawSubtitleText, shouldQueue);
}
/**
 * Transition subtitle state from pending to success.
 * @param {string} rawSubtitleText
 * @param {string} translatedText
 * @returns {boolean}
 */
function markTranslationSuccess(rawSubtitleText, translatedText) {
    const normalizedOriginalText = normalizeSubtitleText(rawSubtitleText);
    const key = toTranslationKey(normalizedOriginalText);
    const existingEntry = subtitleState.get(key);
    // Language change/reset can clear state while requests are in flight.
    // Ignore stale completions so old-language results cannot repopulate state.
    if (!existingEntry || existingEntry.status !== 'pending') {
        return false;
    }
    const normalizedTranslatedText = normalizeSubtitleText(translatedText);
    const isDirectEchoBack = toTranslationKey(normalizedTranslatedText) === toTranslationKey(normalizedOriginalText);
    const isWrappedEchoBack = isLikelyWrappedEchoBackTranslation(normalizedOriginalText, normalizedTranslatedText);
    if (hasTranslatableSubtitleContent(normalizedOriginalText) &&
        !isSourceAndTargetSameLanguage() &&
        (isDirectEchoBack || isWrappedEchoBack)) {
        return markTranslationFailed(rawSubtitleText, 'Translation echoed original text', {
            isEchoBack: true,
        });
    }
    const resolvedText = hasTranslatableSubtitleContent(normalizedOriginalText)
        ? normalizedTranslatedText
        : normalizedOriginalText;
    if (!resolvedText) {
        return markTranslationFailed(rawSubtitleText, 'Empty translation response');
    }
    subtitleState.set(key, {
        status: 'success',
        text: resolvedText,
        updatedAt: Date.now(),
    });
    clearEchoBackRetryState(key);
    dispatchTranslationResolved(key);
    return true;
}
/**
 * Transition subtitle state from pending to failed.
 * @param {string} rawSubtitleText
 * @param {string} errorMessage
 * @param {number|{cooldownMs?: number, isEchoBack?: boolean}} [cooldownOrOptions]
 * @returns {boolean}
 */
function markTranslationFailed(rawSubtitleText, errorMessage, cooldownOrOptions = TRANSLATION_FAILURE_COOLDOWN_MS) {
    const normalizedOriginalText = normalizeSubtitleText(rawSubtitleText);
    const key = toTranslationKey(normalizedOriginalText);
    const existingEntry = subtitleState.get(key);
    // Language change/reset can clear state while requests are in flight.
    // Ignore stale failures from old requests.
    if (!existingEntry || existingEntry.status !== 'pending') {
        return false;
    }
    if (!hasTranslatableSubtitleContent(normalizedOriginalText)) {
        subtitleState.set(key, {
            status: 'success',
            text: normalizedOriginalText,
            updatedAt: Date.now(),
        });
        clearEchoBackRetryState(key);
        dispatchTranslationResolved(key);
        return true;
    }
    const { cooldownMs, isEchoBack } = parseTranslationFailureOptions(cooldownOrOptions);
    const now = Date.now();
    let nextRetryAt = now + Math.max(0, cooldownMs);
    let failureMessage = String(errorMessage || 'Translation failed');
    if (isEchoBack) {
        const echoRetryCount = incrementEchoBackRetryCount(key);
        const isRetryExhausted = echoRetryCount >= ECHO_BACK_MAX_RETRIES;
        nextRetryAt = isRetryExhausted
            ? Number.POSITIVE_INFINITY
            : now + calculateEchoBackCooldownMs(echoRetryCount);
        if (isRetryExhausted) {
            failureMessage = `${failureMessage} (retry limit reached)`;
        }
    }
    else {
        clearEchoBackRetryState(key);
    }
    subtitleState.set(key, {
        status: 'failed',
        error: failureMessage,
        nextRetryAt,
        updatedAt: now,
    });
    dispatchTranslationResolved(key);
    return true;
}
function clearSubtitleTranslationState() {
    subtitleState.clear();
    translationQueue.clear();
    echoBackRetryCounts.clear();
    if (typeof clearActiveTranslationSpans === 'function') {
        clearActiveTranslationSpans();
    }
}
// Batch translation state
let isBatchTranslating = false;
let batchTranslationProgress = { current: 0, total: 0 };
function buildFullSubtitleKey(startTime, endTime, text) {
    return `${startTime.toFixed(3)}|${endTime.toFixed(3)}|${toTranslationKey(text)}`;
}
/**
 * Handle batch translation of all subtitles with context
 * @param {Array<{text: string, startTime: number, endTime: number}>} subtitles - All subtitles with timing
 * @returns {Promise<void>}
 */
async function handleBatchTranslation(subtitles) {
    if (isBatchTranslating) {
        return;
    }
    isBatchTranslating = true;
    try {
        const translationProvider = getCurrentTranslationProvider();
        // Pre-populate full subtitles for skip/repeat features.
        const existingFullSubtitleKeys = new Set(fullSubtitles.map(sub => buildFullSubtitleKey(sub.startTime, sub.endTime, sub.text)));
        for (const sub of subtitles) {
            if (sub.startTime === undefined || sub.endTime === undefined) {
                continue;
            }
            const fullSubtitleKey = buildFullSubtitleKey(sub.startTime, sub.endTime, sub.text);
            if (!existingFullSubtitleKeys.has(fullSubtitleKey)) {
                existingFullSubtitleKeys.add(fullSubtitleKey);
                fullSubtitles.push({ startTime: sub.startTime, endTime: sub.endTime, text: sub.text });
            }
        }
        fullSubtitles.sort((a, b) => a.startTime - b.startTime);
        // Sync ACCUMULATED subtitles with ControlIntegration for skip/repeat functionality
        // Note: Call setSubtitles even if panel isn't mounted yet - it just stores the data
        ControlIntegration.setSubtitles(fullSubtitles);
        // enqueueTranslation(..., false) only writes pending state and dedupes.
        // This batch loop is responsible for resolving each pending entry.
        const toTranslateSubtitles = subtitles.filter(sub => enqueueTranslation(sub.text, false));
        if (toTranslateSubtitles.length === 0) {
            return;
        }
        batchTranslationProgress = { current: 0, total: toTranslateSubtitles.length };
        showBatchTranslationIndicator();
        // Process in chunks of 10 for better reliability with Google Translate
        const CHUNK_SIZE = 10;
        const chunks = [];
        for (let i = 0; i < toTranslateSubtitles.length; i += CHUNK_SIZE) {
            chunks.push(toTranslateSubtitles.slice(i, i + CHUNK_SIZE));
        }
        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
            const chunk = chunks[chunkIndex];
            const texts = chunk.map(sub => sub.text);
            // Delay only for free Google scraper endpoint to reduce rate-limit pressure.
            if (chunkIndex > 0 && translationProvider === 'google') {
                await sleep(500);
            }
            try {
                const [isSucceeded, translationResponse] = await fetchBatchTranslation(texts);
                if (isSucceeded) {
                    const translatedTexts = translationResponse;
                    const toCacheSubtitleRecords = [];
                    for (let i = 0; i < texts.length; i++) {
                        const translatedText = translatedTexts[i];
                        const rawSubtitleText = texts[i];
                        if (translatedText === null || translatedText === undefined) {
                            markTranslationFailed(rawSubtitleText, 'Empty translation response');
                            continue;
                        }
                        const translatedTextValue = normalizeSubtitleText(translatedText);
                        if (!markTranslationSuccess(rawSubtitleText, translatedTextValue)) {
                            continue;
                        }
                        const resolvedEntry = subtitleState.get(toTranslationKey(rawSubtitleText));
                        const textToCache = resolvedEntry?.status === 'success' && resolvedEntry.text
                            ? resolvedEntry.text
                            : translatedTextValue;
                        if (currentMovieName) {
                            toCacheSubtitleRecords.push({
                                movieName: currentMovieName,
                                originalLanguage: "FI",
                                targetLanguage,
                                originalText: toTranslationKey(rawSubtitleText),
                                translatedText: textToCache,
                            });
                        }
                    }
                    // Save to cache
                    if (globalDatabaseInstance && toCacheSubtitleRecords.length > 0) {
                        saveSubtitlesBatch(globalDatabaseInstance, toCacheSubtitleRecords).catch((error) => {
                            console.error("YleDualSubExtension: Error saving batch to cache:", error);
                        });
                    }
                }
                else {
                    const logBatchError = shouldLogTranslationFailureAsWarning(translationResponse)
                        ? console.warn
                        : console.error;
                    logBatchError("YleDualSubExtension: Batch translation error:", translationResponse);
                    for (const rawSubtitleText of texts) {
                        markTranslationFailed(rawSubtitleText, translationResponse);
                    }
                }
            }
            catch (error) {
                const errorMessage = error.message || String(error);
                console.error("YleDualSubExtension: Error in batch translation chunk:", error);
                for (const rawSubtitleText of texts) {
                    markTranslationFailed(rawSubtitleText, errorMessage);
                }
            }
            batchTranslationProgress.current += chunk.length;
            updateBatchTranslationIndicator();
        }
    }
    finally {
        isBatchTranslating = false;
        hideBatchTranslationIndicator();
    }
}
