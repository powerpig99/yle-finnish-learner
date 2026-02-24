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
     * @returns {void}
     */
    addToQueue(rawSubtitleFinnishText) {
        this.queue.push(rawSubtitleFinnishText);
    }
    /**
     * Process the translation queue in batches
     * By sending to background.js to handle translation and store results in
     * sharedTranslationMap
     * @returns {Promise<void>}
     */
    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) {
            return;
        }
        while (this.queue.length > 0 && dualSubEnabled) {
            this.isProcessing = true;
            /** @type {Array<string>} */
            const toProcessItems = [];
            for (let i = 0; i < Math.min(this.queue.length, this.BATCH_MAXIMUM_SIZE); i++) {
                const item = this.queue.shift();
                if (item) {
                    toProcessItems.push(item);
                }
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
                        const sharedTranslationMapKey = toTranslationKey(rawSubtitleFinnishText);
                        // Skip failed translations (null) - they will be retried next time
                        if (translatedText === null || translatedText === undefined) {
                            continue;
                        }
                        const sharedTranslationMapValue = translatedText.trim().replace(/\n/g, ' ');
                        sharedTranslationMap.set(sharedTranslationMapKey, sharedTranslationMapValue);
                        if (currentMovieName) {
                            toCacheSubtitleRecords.push({
                                "movieName": currentMovieName,
                                "originalLanguage": "FI",
                                targetLanguage,
                                "originalText": sharedTranslationMapKey,
                                "translatedText": sharedTranslationMapValue,
                            });
                        }
                    }
                    if (globalDatabaseInstance) {
                        saveSubtitlesBatch(globalDatabaseInstance, toCacheSubtitleRecords)
                            .catch((error) => {
                            console.error("YleDualSubExtension: Error saving subtitles batch to cache:", error);
                        });
                    }
                }
                else {
                    const translationErrorMessage = translationResponse;
                    console.error("YleDualSubExtension: JIT translation error:", translationErrorMessage);
                }
            }
            catch (error) {
                console.error("YleDualSubExtension: System error when translating text:", error);
            }
        }
        this.isProcessing = false;
    }
}
const translationQueue = new TranslationQueue();
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
    // Set flag IMMEDIATELY to block individual event processing
    if (isBatchTranslating) {
        return;
    }
    isBatchTranslating = true;
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
    // Filter out subtitles that are already translated (from cache)
    const untranslatedSubtitles = subtitles.filter(sub => {
        const key = toTranslationKey(sub.text);
        return !sharedTranslationMap.has(key);
    });
    if (untranslatedSubtitles.length === 0) {
        isBatchTranslating = false;
        return;
    }
    batchTranslationProgress = { current: 0, total: untranslatedSubtitles.length };
    showBatchTranslationIndicator();
    // Process in chunks of 10 for better reliability with Google Translate
    const CHUNK_SIZE = 10;
    const chunks = [];
    for (let i = 0; i < untranslatedSubtitles.length; i += CHUNK_SIZE) {
        chunks.push(untranslatedSubtitles.slice(i, i + CHUNK_SIZE));
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
                    const sharedTranslationMapKey = toTranslationKey(rawSubtitleFinnishText);
                    // Skip failed translations (null) - they will be retried next time
                    if (translatedText === null || translatedText === undefined) {
                        continue;
                    }
                    const sharedTranslationMapValue = translatedText.trim().replace(/\n/g, ' ');
                    sharedTranslationMap.set(sharedTranslationMapKey, sharedTranslationMapValue);
                    if (currentMovieName) {
                        toCacheSubtitleRecords.push({
                            movieName: currentMovieName,
                            originalLanguage: "FI",
                            targetLanguage,
                            originalText: sharedTranslationMapKey,
                            translatedText: sharedTranslationMapValue,
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
            }
        }
        catch (error) {
            console.error("YleDualSubExtension: Error in batch translation chunk:", error);
        }
        batchTranslationProgress.current += chunk.length;
        updateBatchTranslationIndicator();
    }
    isBatchTranslating = false;
    hideBatchTranslationIndicator();
}
