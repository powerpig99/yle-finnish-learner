// ==================================
// TRANSLATION QUEUE
// ==================================
class TranslationQueue {
    constructor() {
        /* Queue to manage translation requests to avoid hitting rate limits */
        this.BATCH_MAXIMUM_SIZE = 7;
        this.queue = [];
        this.isProcessing = false;
    }
    /**
     * @param {string} rawSubtitleFinnishText - Finnish text to translate
     * @param {boolean} shouldQueue - Whether to add this text to the JIT queue.
     * @returns {boolean} - True if subtitle moved to pending state
     */
    enqueue(rawSubtitleFinnishText, shouldQueue = true) {
        const normalizedText = String(rawSubtitleFinnishText || '').trim();
        if (!normalizedText) {
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
                    for (const rawSubtitleFinnishText of toProcessItems) {
                        // Guard for dualSubEnabled being false at dequeue time: resolve pending entries deterministically.
                        markTranslationFailed(rawSubtitleFinnishText, 'Dual subtitles disabled', 0);
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
                            const rawSubtitleFinnishText = toProcessItems[i];
                            if (translatedText === null || translatedText === undefined) {
                                markTranslationFailed(rawSubtitleFinnishText, 'Empty translation response');
                                continue;
                            }
                            const translatedTextValue = String(translatedText).trim().replace(/\n/g, ' ');
                            if (!markTranslationSuccess(rawSubtitleFinnishText, translatedTextValue)) {
                                continue;
                            }
                            if (currentMovieName) {
                                toCacheSubtitleRecords.push({
                                    "movieName": currentMovieName,
                                    "originalLanguage": "FI",
                                    targetLanguage,
                                    "originalText": toTranslationKey(rawSubtitleFinnishText),
                                    "translatedText": translatedTextValue,
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
                        console.error("YleDualSubExtension: JIT translation error:", translationErrorMessage);
                        for (const rawSubtitleFinnishText of toProcessItems) {
                            markTranslationFailed(rawSubtitleFinnishText, translationErrorMessage);
                        }
                    }
                }
                catch (error) {
                    const errorMessage = error.message || String(error);
                    console.error("YleDualSubExtension: System error when translating text:", error);
                    for (const rawSubtitleFinnishText of toProcessItems) {
                        markTranslationFailed(rawSubtitleFinnishText, errorMessage);
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
function dispatchTranslationResolved(key) {
    document.dispatchEvent(new CustomEvent('dscTranslationResolved', { detail: { key } }));
}
/**
 * Enqueue subtitle translation request for both JIT and batch workflows.
 * @param {string} rawSubtitleFinnishText
 * @param {boolean} shouldQueue
 * @returns {boolean}
 */
function enqueueTranslation(rawSubtitleFinnishText, shouldQueue = true) {
    return translationQueue.enqueue(rawSubtitleFinnishText, shouldQueue);
}
/**
 * Transition subtitle state from pending to success.
 * @param {string} rawSubtitleFinnishText
 * @param {string} translatedText
 * @returns {boolean}
 */
function markTranslationSuccess(rawSubtitleFinnishText, translatedText) {
    const key = toTranslationKey(rawSubtitleFinnishText);
    const existingEntry = subtitleState.get(key);
    // Language change/reset can clear state while requests are in flight.
    // Ignore stale completions so old-language results cannot repopulate state.
    if (!existingEntry || existingEntry.status !== 'pending') {
        return false;
    }
    const normalizedTranslatedText = String(translatedText || '').trim().replace(/\n/g, ' ');
    if (!normalizedTranslatedText) {
        return markTranslationFailed(rawSubtitleFinnishText, 'Empty translation response');
    }
    subtitleState.set(key, {
        status: 'success',
        text: normalizedTranslatedText,
        updatedAt: Date.now(),
    });
    dispatchTranslationResolved(key);
    return true;
}
/**
 * Transition subtitle state from pending to failed.
 * @param {string} rawSubtitleFinnishText
 * @param {string} errorMessage
 * @param {number} [cooldownMs]
 * @returns {boolean}
 */
function markTranslationFailed(rawSubtitleFinnishText, errorMessage, cooldownMs = TRANSLATION_FAILURE_COOLDOWN_MS) {
    const key = toTranslationKey(rawSubtitleFinnishText);
    const existingEntry = subtitleState.get(key);
    // Language change/reset can clear state while requests are in flight.
    // Ignore stale failures from old requests.
    if (!existingEntry || existingEntry.status !== 'pending') {
        return false;
    }
    const now = Date.now();
    subtitleState.set(key, {
        status: 'failed',
        error: String(errorMessage || 'Translation failed'),
        nextRetryAt: now + Math.max(0, cooldownMs),
        updatedAt: now,
    });
    dispatchTranslationResolved(key);
    return true;
}
function clearSubtitleTranslationState() {
    subtitleState.clear();
    translationQueue.clear();
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
            // Add delay between chunks to avoid rate limiting
            if (chunkIndex > 0) {
                await sleep(500);
            }
            try {
                const [isSucceeded, translationResponse] = await fetchBatchTranslation(texts);
                if (isSucceeded) {
                    const translatedTexts = translationResponse;
                    const toCacheSubtitleRecords = [];
                    for (let i = 0; i < texts.length; i++) {
                        const translatedText = translatedTexts[i];
                        const rawSubtitleFinnishText = texts[i];
                        if (translatedText === null || translatedText === undefined) {
                            markTranslationFailed(rawSubtitleFinnishText, 'Empty translation response');
                            continue;
                        }
                        const translatedTextValue = String(translatedText).trim().replace(/\n/g, ' ');
                        if (!markTranslationSuccess(rawSubtitleFinnishText, translatedTextValue)) {
                            continue;
                        }
                        if (currentMovieName) {
                            toCacheSubtitleRecords.push({
                                movieName: currentMovieName,
                                originalLanguage: "FI",
                                targetLanguage,
                                originalText: toTranslationKey(rawSubtitleFinnishText),
                                translatedText: translatedTextValue,
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
                    console.error("YleDualSubExtension: Batch translation error:", translationResponse);
                    for (const rawSubtitleFinnishText of texts) {
                        markTranslationFailed(rawSubtitleFinnishText, translationResponse);
                    }
                }
            }
            catch (error) {
                const errorMessage = error.message || String(error);
                console.error("YleDualSubExtension: Error in batch translation chunk:", error);
                for (const rawSubtitleFinnishText of texts) {
                    markTranslationFailed(rawSubtitleFinnishText, errorMessage);
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
