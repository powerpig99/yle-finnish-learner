// ==================================
// RUNTIME MESSAGE HANDLERS
// ==================================
// Listen for messages from popup (extension toggle)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.action) {
        case 'extensionToggled': {
            extensionEnabled = message.enabled;
            ControlIntegration._handleExtensionToggle(message.enabled);
            sendResponse({ success: true });
            return false;
        }
        case 'clearSubtitleCache': {
            // Clear in-memory subtitle cache immediately.
            clearSubtitleTranslationState();
            // Clear persistent subtitle cache from IndexedDB.
            (async () => {
                try {
                    if (!globalDatabaseInstance) {
                        globalDatabaseInstance = await openDatabase();
                    }
                    const transaction = globalDatabaseInstance.transaction(['SubtitlesCache'], 'readwrite');
                    const store = transaction.objectStore('SubtitlesCache');
                    const countRequest = store.count();
                    countRequest.onsuccess = () => {
                        const count = countRequest.result;
                        const clearRequest = store.clear();
                        clearRequest.onsuccess = () => {
                            sendResponse({ success: true, count });
                        };
                        clearRequest.onerror = () => {
                            sendResponse({ success: false, count: 0 });
                        };
                    };
                    countRequest.onerror = () => {
                        sendResponse({ success: false, count: 0 });
                    };
                }
                catch (e) {
                    console.error('DualSubExtension: Error clearing subtitle cache:', e);
                    sendResponse({ success: false, count: 0 });
                }
            })();
            return true;
        }
        case 'getSubtitleCacheCount': {
            // Count entries in IndexedDB SubtitlesCache store.
            (async () => {
                try {
                    if (!globalDatabaseInstance) {
                        globalDatabaseInstance = await openDatabase();
                    }
                    const transaction = globalDatabaseInstance.transaction(['SubtitlesCache'], 'readonly');
                    const store = transaction.objectStore('SubtitlesCache');
                    const countRequest = store.count();
                    countRequest.onsuccess = () => {
                        sendResponse({ success: true, count: countRequest.result });
                    };
                    countRequest.onerror = () => {
                        sendResponse({ success: true, count: 0 });
                    };
                }
                catch (e) {
                    console.error('DualSubExtension: Error counting subtitle cache:', e);
                    sendResponse({ success: true, count: 0 });
                }
            })();
            return true;
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
