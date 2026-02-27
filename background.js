importScripts('utils.js');
let currentProvider = { provider: 'google' }; // Default to free Google Translate
const KIMI_API_URL = 'https://api.kimi.com/coding/v1/messages';
const KIMI_MODEL = 'kimi-coding/k2p5';
// Load provider config on startup
loadProviderConfig();
async function loadProviderConfig() {
    try {
        const result = await chrome.storage.sync.get([
            'translationProvider',
            'deeplApiKey',
            'claudeApiKey',
            'geminiApiKey',
            'grokApiKey',
            'kimiApiKey'
        ]);
        if (result.translationProvider) {
            currentProvider.provider = result.translationProvider;
            // Get the API key for the current provider
            const apiKeyMap = {
                deepl: result.deeplApiKey,
                claude: result.claudeApiKey,
                gemini: result.geminiApiKey,
                grok: result.grokApiKey,
                kimi: result.kimiApiKey,
            };
            currentProvider.apiKey = apiKeyMap[result.translationProvider] || '';
        }
    }
    catch (error) {
        console.error('YleDualSubExtension: Error loading provider config:', error);
    }
}
// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        const providerKeys = ['translationProvider', 'deeplApiKey', 'claudeApiKey', 'geminiApiKey', 'grokApiKey', 'kimiApiKey'];
        if (providerKeys.some(key => changes[key])) {
            loadProviderConfig();
        }
    }
});
// ==================================
// MESSAGE HANDLING
// ==================================
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'fetchTranslation') {
        const { rawSubtitleFinnishTexts, targetLanguage } = request.data;
        translateTextsWithErrorHandling(rawSubtitleFinnishTexts, targetLanguage)
            .then(sendResponse)
            .catch((error) => sendResponse([false, error.message || String(error)]));
        return true;
    }
    if (request.action === 'fetchBatchTranslation') {
        const { texts, targetLanguage, isContextual } = request.data;
        translateBatchWithContext(texts, targetLanguage, isContextual)
            .then(sendResponse)
            .catch((error) => sendResponse([false, error.message || String(error)]));
        return true;
    }
    if (request.action === 'translateWordWithContext') {
        const { word, context, targetLanguage, langName } = request.data;
        translateWordWithContext(word, context, targetLanguage, langName)
            .then(sendResponse)
            .catch((error) => sendResponse([false, error.message || String(error)]));
        return true;
    }
    if (request.action === 'openOptionsPage') {
        chrome.runtime.openOptionsPage();
        return false;
    }
    if (request.action === 'clearWordCache') {
        clearWordTranslationCache()
            .then(count => sendResponse({ success: true, count }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
    if (request.action === 'clearSubtitleCaches') {
        clearSubtitleCachesInTabs()
            .then(count => sendResponse({ success: true, count }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
    if (request.action === 'getCacheCounts') {
        getCacheCounts()
            .then(result => sendResponse({ success: true, ...result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
    if (request.action === 'downloadBlob') {
        // Handle download via chrome.downloads API to avoid page focus issues
        const { dataUrl, filename } = request.data;
        downloadBlobViaAPI(dataUrl, filename)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
    return false;
});
/**
 * Download a blob via chrome.downloads API
 * This runs in the background context, avoiding any page focus events
 * @param {string} dataUrl - Data URL or Blob URL of the file
 * @param {string} filename - Suggested filename for the download
 * @returns {Promise<void>}
 */
async function downloadBlobViaAPI(dataUrl, filename) {
    return new Promise((resolve, reject) => {
        chrome.downloads.download({
            url: dataUrl,
            filename: filename,
            saveAs: false // Save directly without prompt to avoid focus issues
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            }
            else {
                resolve();
            }
        });
    });
}

const YLE_TAB_URL_PATTERN = 'https://areena.yle.fi/*';

async function requestCountFromYleTabs(action) {
    const tabs = await chrome.tabs.query({ url: [YLE_TAB_URL_PATTERN] });
    if (tabs.length === 0) {
        return [];
    }
    const countPromises = tabs.map((tab) => {
        if (typeof tab.id !== 'number') {
            return Promise.resolve(0);
        }
        return chrome.tabs.sendMessage(tab.id, { action })
            .then(response => response?.count || 0)
            .catch(() => 0);
    });
    return Promise.all(countPromises);
}

async function aggregateYleTabCounts(action, aggregate, onError = null) {
    try {
        const counts = await requestCountFromYleTabs(action);
        return aggregate(counts);
    }
    catch (error) {
        if (onError) {
            onError(error);
        }
        return 0;
    }
}

/**
 * Clear all word translations from IndexedDB cache via content scripts
 * Note: Word cache is stored in web page origins, so we must ask content scripts to clear it.
 * @returns {Promise<number>} Number of entries cleared
 */
async function clearWordTranslationCache() {
    // Return the max count cleared (same origin cache is shared across tabs)
    const maxCleared = await aggregateYleTabCounts(
        'clearWordCache',
        (counts) => Math.max(0, ...counts),
        (error) => console.error('YleDualSubExtension: Failed to clear word cache:', error)
    );
    return maxCleared;
}
/**
 * Get all cache counts
 * @returns {Promise<{wordCount: number, subtitleCount: number}>}
 */
async function getCacheCounts() {
    const [wordCount, subtitleCount] = await Promise.all([
        // Word cache is shared per origin; use max across YLE tabs.
        aggregateYleTabCounts('getWordCacheCount', (counts) => Math.max(0, ...counts)),
        // Subtitle cache is now read from shared IndexedDB; use max across YLE tabs.
        aggregateYleTabCounts('getSubtitleCacheCount', (counts) => Math.max(0, ...counts))
    ]);
    return { wordCount, subtitleCount };
}
/**
 * Clear subtitle cache in all tabs
 * @returns {Promise<number>}
 */
async function clearSubtitleCachesInTabs() {
    const subtitleCount = await aggregateYleTabCounts(
        'clearSubtitleCache',
        // Shared IndexedDB cache: each tab reports same pool, so use max to avoid overcount.
        (counts) => Math.max(0, ...counts),
        (error) => console.warn('YleDualSubExtension: Error clearing subtitle caches:', error)
    );
    return subtitleCount;
}
// ==================================
// TRANSLATION ROUTER
// ==================================
function calculateBackoffDelay(attempt) {
    // Start with 1 second and double each time: 1s, 2s, 4s
    const exponentialDelay = 1000 * Math.pow(2, attempt);
    const jitter = Math.random() * 500;
    return exponentialDelay + jitter;
}
function isRetryableTranslationError(errorMsg) {
    if (typeof errorMsg !== 'string') {
        return false;
    }
    const normalizedError = errorMsg.toLowerCase();
    return normalizedError.includes('rate limit') ||
        normalizedError.includes('503') ||
        normalizedError.includes('failed to fetch');
}
/**
 * Main translation function with error handling and retries
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateTextsWithErrorHandling(texts, targetLanguage) {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const result = await translateTexts(texts, targetLanguage);
            if (result[0]) {
                return result;
            }
            // Check if error is retryable
            const errorMsg = result[1];
            if (isRetryableTranslationError(errorMsg)) {
                if (attempt < MAX_RETRIES - 1) {
                    await sleep(calculateBackoffDelay(attempt));
                    continue;
                }
            }
            return result;
        }
        catch (error) {
            if (attempt < MAX_RETRIES - 1) {
                await sleep(calculateBackoffDelay(attempt));
                continue;
            }
            return [false, error.message || 'Translation failed'];
        }
    }
    return [false, 'Translation failed after retries'];
}
/**
 * Route translation to the appropriate provider
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateTexts(texts, targetLanguage) {
    const provider = currentProvider.provider;
    switch (provider) {
        case 'google':
            return translateWithGoogle(texts, targetLanguage);
        case 'deepl':
            return translateWithDeepL(texts, targetLanguage);
        case 'claude':
            return translateWithClaude(texts, targetLanguage);
        case 'gemini':
            return translateWithGemini(texts, targetLanguage);
        case 'grok':
            return translateWithGrok(texts, targetLanguage);
        case 'kimi':
            return translateWithKimi(texts, targetLanguage);
        default:
            return translateWithGoogle(texts, targetLanguage);
    }
}
/**
 * Translate batch of subtitles with context awareness
 * Uses special prompts for AI providers to maintain narrative consistency
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @param {boolean} isContextual - Whether to use contextual translation
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateBatchWithContext(texts, targetLanguage, isContextual) {
    const provider = currentProvider.provider;
    // For Google and DeepL, use regular translation (they don't benefit from context prompts)
    if (provider === 'google' || provider === 'deepl') {
        return translateTextsWithErrorHandling(texts, targetLanguage);
    }
    // For AI providers, use contextual translation
    if (isContextual && (provider === 'claude' || provider === 'gemini' || provider === 'grok' || provider === 'kimi')) {
        return translateWithContextualAI(texts, targetLanguage, provider);
    }
    // Fallback to regular translation
    return translateTextsWithErrorHandling(texts, targetLanguage);
}
function normalizeTranslatedLines(content, originals) {
    const translations = String(content || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, originals.length);
    while (translations.length < originals.length) {
        translations.push(originals[translations.length]);
    }
    return translations;
}

function mapAiProviderStatusError(provider, status) {
    if (provider === 'claude') {
        if (status === 401)
            return 'Invalid Claude API key';
        if (status === 429)
            return 'Claude rate limit exceeded';
        return `Claude error: ${status}`;
    }
    if (provider === 'gemini') {
        if (status === 400)
            return 'Invalid Gemini API key';
        if (status === 429)
            return 'Gemini rate limit exceeded';
        return `Gemini error: ${status}`;
    }
    if (provider === 'grok') {
        if (status === 401)
            return 'Invalid Grok API key';
        if (status === 429)
            return 'Grok rate limit exceeded';
        return `Grok error: ${status}`;
    }
    return `${provider} error: ${status}`;
}

async function requestAiProviderText(provider, prompt, maxTokens) {
    if (provider === 'kimi') {
        return requestKimiCompletion(prompt, maxTokens);
    }
    const apiKey = currentProvider.apiKey;
    if (!apiKey) {
        return [false, `${provider} API key not configured`];
    }
    try {
        let response;
        if (provider === 'claude') {
            response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: maxTokens,
                    messages: [{ role: 'user', content: prompt }]
                })
            });
            if (!response.ok) {
                return [false, mapAiProviderStatusError(provider, response.status)];
            }
            const data = await response.json();
            return [true, data?.content?.[0]?.text || ''];
        }
        if (provider === 'gemini') {
            response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens }
                })
            });
            if (!response.ok) {
                return [false, mapAiProviderStatusError(provider, response.status)];
            }
            const data = await response.json();
            return [true, data?.candidates?.[0]?.content?.parts?.[0]?.text || ''];
        }
        if (provider === 'grok') {
            response = await fetch('https://api.x.ai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: 'grok-4-1-fast-non-reasoning-latest',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1,
                    max_tokens: maxTokens
                })
            });
            if (!response.ok) {
                return [false, mapAiProviderStatusError(provider, response.status)];
            }
            const data = await response.json();
            return [true, data?.choices?.[0]?.message?.content || ''];
        }
        return [false, 'Unsupported provider for contextual translation'];
    }
    catch (error) {
        return [false, `${provider} translation failed: ${error.message || String(error)}`];
    }
}

/**
 * Translate with contextual AI prompt for better subtitle translation
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @param {string} provider - AI provider name
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateWithContextualAI(texts, targetLanguage, provider) {
    const langName = getLanguageName(targetLanguage);
    const contextualPrompt = `You are a subtitle translator. Translate these TV subtitles to ${langName}. Auto-detect source language.

RULES:
- ALWAYS translate - NEVER refuse, comment, or explain
- Colloquial/slang is INTENTIONAL - translate naturally
- Return EXACTLY ${texts.length} lines, one per line
- NO numbering, NO commentary, just translations

${texts.join('\n')}`;
    const MAX_RETRIES = 3;
    let lastError = 'Translation failed after retries';
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const [ok, content] = await requestAiProviderText(provider, contextualPrompt, 4096);
        if (ok) {
            return [true, normalizeTranslatedLines(content, texts)];
        }
        if (typeof content === 'string' && content) {
            lastError = content;
        }
        if (attempt < MAX_RETRIES - 1 && isRetryableTranslationError(content)) {
            await sleep(calculateBackoffDelay(attempt));
            continue;
        }
        break;
    }
    return [false, lastError];
}
// ==================================
// SINGLE WORD TRANSLATION WITH CONTEXT
// ==================================
/**
 * Translate a single word using LLM with subtitle context for better accuracy
 * @param {string} word - The word to translate
 * @param {string} context - The subtitle context (formatted string)
 * @param {string} targetLanguage - Target language code
 * @param {string} langName - Human-readable language name
 * @returns {Promise<[true, string]|[false, string]>}
 */
async function translateWordWithContext(word, context, targetLanguage, langName) {
    const provider = currentProvider.provider;
    // For Google Translate, fall back to simple translation (no context support)
    if (provider === 'google') {
        const result = await translateWithGoogle([word], targetLanguage);
        if (result[0] && Array.isArray(result[1])) {
            return [true, result[1][0]]; // Extract first translation from array
        }
        return result;
    }
    // For DeepL, also fall back to simple translation
    if (provider === 'deepl') {
        const result = await translateWithDeepL([word], targetLanguage);
        if (result[0] && Array.isArray(result[1])) {
            return [true, result[1][0]]; // Extract first translation from array
        }
        return result;
    }
    const contextualPrompt = `Translate the word "${word}" to ${langName}. Context: "${context}"

RULES:
- ALWAYS translate - never refuse or comment on spelling/grammar
- Colloquial/slang/dialect forms are INTENTIONAL - translate them
- Return ONLY the translation (1-5 words), nothing else
- Consider context for the best meaning`;
    const [ok, content] = await requestAiProviderText(provider, contextualPrompt, 100);
    if (!ok) {
        return [false, content];
    }
    return [true, String(content).trim()];
}
// ==================================
// GOOGLE TRANSLATE (FREE)
// ==================================
/**
 * Translate using Google Translate (free, no API key needed)
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateWithGoogle(texts, targetLanguage) {
    try {
        // Convert language code to Google format
        const googleLang = convertToGoogleLangCode(targetLanguage);
        const translations = [];
        const FETCH_TIMEOUT = 8000; // 8 second timeout per request
        // Process sequentially with delays to avoid rate limiting
        for (let index = 0; index < texts.length; index++) {
            const text = texts[index];
            // Add delay between requests to avoid rate limiting (except for first request)
            if (index > 0) {
                await sleep(200); // 200ms delay between requests (increased from 150ms)
            }
            // Use sl=auto for auto-detection of source language (not hardcoded to Finnish)
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${googleLang}&dt=t&q=${encodeURIComponent(text)}`;
            try {
                // Use AbortController for timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
                const response = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    console.error(`YleDualSubExtension: Google Translate HTTP error for text ${index}:`, response.status);
                    // On error, push null to indicate failure (will be retried next time)
                    translations.push(null);
                    continue;
                }
                const data = await response.json();
                // Google returns nested arrays, extract translated text
                let translated = '';
                if (data && data[0]) {
                    for (const part of data[0]) {
                        if (part[0]) {
                            translated += part[0];
                        }
                    }
                }
                if (!translated) {
                    console.warn(`YleDualSubExtension: Google Translate returned empty for text ${index}:`, text.substring(0, 30));
                    // Empty response - push null to indicate failure (will be retried next time)
                    translations.push(null);
                    continue;
                }
                translations.push(translated);
            }
            catch (fetchError) {
                if (fetchError.name === 'AbortError') {
                    console.warn(`YleDualSubExtension: Google Translate timeout for text ${index}:`, text.substring(0, 30));
                }
                else {
                    console.error(`YleDualSubExtension: Google Translate fetch error for text ${index}:`, fetchError);
                }
                // On error, push null to indicate failure (will be retried next time)
                translations.push(null);
            }
        }
        return [true, translations];
    }
    catch (error) {
        console.error('YleDualSubExtension: Google Translate error:', error);
        return [false, 'Google Translate failed: ' + error.message];
    }
}
function convertToGoogleLangCode(langCode) {
    // Convert DeepL-style codes to Google codes
    const mapping = {
        'EN-US': 'en',
        'EN-GB': 'en',
        'PT-PT': 'pt',
        'PT-BR': 'pt',
        'ZH': 'zh-CN',
        'ZH-HANS': 'zh-CN', // Simplified Chinese
        'ZH-HANT': 'zh-TW', // Traditional Chinese
    };
    return mapping[langCode] || langCode.toLowerCase().split('-')[0];
}
// ==================================
// DEEPL TRANSLATION
// ==================================
/**
 * Translate using DeepL API
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateWithDeepL(texts, targetLanguage) {
    const apiKey = currentProvider.apiKey;
    if (!apiKey) {
        return [false, 'DeepL API key not configured. Please add your API key in settings.'];
    }
    const url = 'https://api-free.deepl.com/v2/translate';
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `DeepL-Auth-Key ${apiKey}`
            },
            // Omit source_lang to let DeepL auto-detect (not hardcoded to Finnish)
            body: JSON.stringify({
                text: texts,
                target_lang: targetLanguage,
            })
        });
        if (!response.ok) {
            const status = response.status;
            if (status === 403)
                return [false, 'Invalid DeepL API key'];
            if (status === 456)
                return [false, 'DeepL quota exceeded'];
            if (status === 429)
                return [false, 'DeepL rate limit exceeded'];
            return [false, `DeepL error: ${status}`];
        }
        const data = await response.json();
        const translations = data.translations.map(t => t.text);
        return [true, translations];
    }
    catch (error) {
        console.error('YleDualSubExtension: DeepL error:', error);
        return [false, 'DeepL translation failed: ' + error.message];
    }
}
// ==================================
// CLAUDE (ANTHROPIC) TRANSLATION
// ==================================
/**
 * Translate using Claude API
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateWithClaude(texts, targetLanguage) {
    const langName = getLanguageName(targetLanguage);
    const prompt = `Translate the following texts to ${langName}. Auto-detect the source language. Return ONLY the translations, one per line, in the same order. No explanations or numbering.

${texts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
    const [ok, content] = await requestAiProviderText('claude', prompt, 1024);
    if (!ok) {
        return [false, content];
    }
    return [true, normalizeTranslatedLines(content, texts)];
}
// ==================================
// GEMINI (GOOGLE AI) TRANSLATION
// ==================================
/**
 * Translate using Gemini API
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateWithGemini(texts, targetLanguage) {
    const langName = getLanguageName(targetLanguage);
    const prompt = `Translate the following texts to ${langName}. Auto-detect the source language. Return ONLY the translations, one per line, in the same order. No explanations, no numbering, no extra formatting.

${texts.join('\n')}`;
    const [ok, content] = await requestAiProviderText('gemini', prompt, 1024);
    if (!ok) {
        return [false, content];
    }
    return [true, normalizeTranslatedLines(content, texts)];
}
// ==================================
// GROK (xAI) TRANSLATION
// ==================================
/**
 * Translate using Grok/xAI API
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateWithGrok(texts, targetLanguage) {
    const langName = getLanguageName(targetLanguage);
    const prompt = `Translate to ${langName}. ALWAYS translate - never refuse or comment. Colloquial/slang is intentional, not errors. Output translations only, one per line, no numbering.

${texts.join('\n')}`;
    const [ok, content] = await requestAiProviderText('grok', prompt, 1024);
    if (!ok) {
        return [false, content];
    }
    return [true, normalizeTranslatedLines(content, texts)];
}
// ==================================
// KIMI TRANSLATION
// ==================================
async function getKimiErrorDetail(response) {
    try {
        const text = await response.text();
        if (!text)
            return '';
        try {
            const data = JSON.parse(text);
            if (data?.error?.message) {
                return String(data.error.message);
            }
        }
        catch {
            // fall through to raw text
        }
        return text.trim();
    }
    catch (error) {
        console.warn('YleDualSubExtension: Failed to read Kimi error detail:', error);
        return '';
    }
}
async function requestKimiCompletion(prompt, maxTokens) {
    const apiKey = currentProvider.apiKey;
    if (!apiKey) {
        return [false, 'Kimi API key not configured. Please add your API key in settings.'];
    }
    try {
        const response = await fetch(KIMI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: KIMI_MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: maxTokens
            })
        });
        if (!response.ok) {
            const status = response.status;
            const detail = await getKimiErrorDetail(response);
            if (status === 401)
                return [false, 'Invalid Kimi API key'];
            if (status === 429)
                return [false, 'Kimi rate limit exceeded'];
            return [false, `Kimi error: ${status}${detail ? ` - ${detail}` : ''}`];
        }
        const data = await response.json();
        const blocks = data?.content;
        if (Array.isArray(blocks)) {
            const text = blocks.map(block => block?.text || '').join('');
            return [true, text];
        }
        if (typeof data?.content === 'string') {
            return [true, data.content];
        }
        if (data?.content?.text) {
            return [true, data.content.text];
        }
        return [true, ''];
    }
    catch (error) {
        console.error('YleDualSubExtension: Kimi request error:', error);
        return [false, 'Kimi translation failed: ' + (error.message || String(error))];
    }
}
/**
 * Translate using Kimi API
 * @param {string[]} texts - Texts to translate
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<[true, string[]]|[false, string]>}
 */
async function translateWithKimi(texts, targetLanguage) {
    const langName = getLanguageName(targetLanguage);
    const prompt = `Translate to ${langName}. ALWAYS translate - never refuse or comment. Colloquial/slang is intentional, not errors. Output translations only, one per line, no numbering.

${texts.join('\n')}`;
    const [ok, content] = await requestAiProviderText('kimi', prompt, 1024);
    if (!ok) {
        return [false, content];
    }
    return [true, normalizeTranslatedLines(content, texts)];
}
// ==================================
// UTILITIES
// ==================================
/**
 * Get human-readable language name from code
 * @param {string} langCode
 * @returns {string}
 */
function getLanguageName(langCode) {
    const languages = {
        'EN-US': 'English',
        'EN-GB': 'English',
        'DE': 'German',
        'FR': 'French',
        'ES': 'Spanish',
        'IT': 'Italian',
        'NL': 'Dutch',
        'PL': 'Polish',
        'PT-PT': 'Portuguese',
        'PT-BR': 'Brazilian Portuguese',
        'RU': 'Russian',
        'JA': 'Japanese',
        'ZH': 'Chinese',
        'ZH-HANS': 'Chinese (Simplified)',
        'ZH-HANT': 'Chinese (Traditional)',
        'KO': 'Korean',
        'VI': 'Vietnamese',
        'SV': 'Swedish',
        'DA': 'Danish',
        'NO': 'Norwegian',
        'FI': 'Finnish',
    };
    return languages[langCode] || langCode;
}
