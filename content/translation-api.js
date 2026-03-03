// ==================================
// TRANSLATION API
// ==================================
const TRANSLATION_MAX_RETRIES = 3;
const TRANSLATION_RETRY_DELAY_MS = 1000;

function isServiceWorkerRecoverableError(errorMsg) {
    return errorMsg.includes('message channel closed') ||
        errorMsg.includes('Extension context invalidated') ||
        errorMsg.includes('Receiving end does not exist');
}

async function sendTranslationMessageWithRetry(action, data, errorContext) {
    for (let attempt = 0; attempt < TRANSLATION_MAX_RETRIES; attempt++) {
        try {
            const response = await safeSendMessage({ action, data });
            if (response === null) {
                if (attempt < TRANSLATION_MAX_RETRIES - 1) {
                    console.warn(`YleDualSubExtension: Service worker not responding, retrying in ${TRANSLATION_RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${TRANSLATION_MAX_RETRIES})`);
                    await sleep(TRANSLATION_RETRY_DELAY_MS);
                    continue;
                }
                return [false, 'Extension context invalidated'];
            }
            return response;
        }
        catch (error) {
            const errorMsg = error.message || String(error);
            if (isServiceWorkerRecoverableError(errorMsg) && attempt < TRANSLATION_MAX_RETRIES - 1) {
                console.warn(`YleDualSubExtension: Service worker error, retrying in ${TRANSLATION_RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${TRANSLATION_MAX_RETRIES}):`, errorMsg);
                await sleep(TRANSLATION_RETRY_DELAY_MS);
                continue;
            }
            console.error(`YleDualSubExtension: Error sending ${errorContext}:`, error);
            return [false, errorMsg];
        }
    }
    return [false, 'Translation failed after retries'];
}

/**
 * Fetch batch translation with context from background script
 * @param {Array<string>} texts - Texts to translate
 * @returns {Promise<[true, Array<string>]|[false, string]>}
 */
async function fetchBatchTranslation(texts) {
    return sendTranslationMessageWithRetry(
        'fetchBatchTranslation',
        { texts, targetLanguage, isContextual: true, sourceLanguage: detectedSourceLanguage },
        'batch translation request'
    );
}
/**
 *
 * @param {Array<string>} rawSubtitleTexts - Source subtitle texts to translate
 * @returns {Promise<[true, Array<string>]|[false, string]>} - Returns a tuple where the first element
 * indicates success and the second is either translated texts or an error message.

 */
async function fetchTranslation(rawSubtitleTexts) {
    return sendTranslationMessageWithRetry(
        'fetchTranslation',
        // Send both keys during transition to avoid any runtime version skew.
        { rawSubtitleTexts, rawSubtitleFinnishTexts: rawSubtitleTexts, targetLanguage },
        'message to background for translation'
    );
}
