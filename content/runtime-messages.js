// ==================================
// RUNTIME MESSAGE HANDLERS
// ==================================
// Listen for messages from popup (extension toggle)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.action) {
        case 'extensionToggled': {
            extensionEnabled = message.enabled;
            console.info('DualSubExtension: Received extensionToggled from popup:', message.enabled);
            ControlIntegration._handleExtensionToggle(message.enabled);
            sendResponse({ success: true });
            return false;
        }
        case 'clearSubtitleCache': {
            const count = sharedTranslationMap.size;
            sharedTranslationMap.clear();
            console.info('DualSubExtension: Cleared subtitle translation cache:', count, 'entries');
            sendResponse({ success: true, count });
            return false;
        }
        case 'getSubtitleCacheCount': {
            const count = sharedTranslationMap.size;
            sendResponse({ success: true, count });
            return false;
        }
        case 'getWordCacheCount': {
            // Count entries in IndexedDB WordTranslations store.
            (async () => {
                try {
                    if (!globalDatabaseInstance) {
                        globalDatabaseInstance = await openDatabase();
                    }
                    const transaction = globalDatabaseInstance.transaction(['WordTranslations'], 'readonly');
                    const store = transaction.objectStore('WordTranslations');
                    const countRequest = store.count();
                    countRequest.onsuccess = () => {
                        sendResponse({ success: true, count: countRequest.result });
                    };
                    countRequest.onerror = () => {
                        sendResponse({ success: true, count: 0 });
                    };
                }
                catch (e) {
                    console.error('DualSubExtension: Error counting word cache:', e);
                    sendResponse({ success: true, count: 0 });
                }
            })();
            return true;
        }
        case 'clearWordCache': {
            // Clear entries from IndexedDB WordTranslations store.
            (async () => {
                try {
                    if (!globalDatabaseInstance) {
                        globalDatabaseInstance = await openDatabase();
                    }
                    const count = await clearAllWordTranslations(globalDatabaseInstance);
                    wordTranslationCache.clear();
                    console.info('DualSubExtension: Cleared word translation cache:', count, 'entries');
                    sendResponse({ success: true, count });
                }
                catch (e) {
                    console.error('DualSubExtension: Error clearing word cache:', e);
                    sendResponse({ success: false, count: 0 });
                }
            })();
            return true;
        }
        default:
            return false;
    }
});
