/**
 * Targeted tests for Google Cloud provider integration points.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

function createStorageSync(initialData = {}) {
    const data = { ...initialData };
    const writes = [];

    function buildResult(keys) {
        if (typeof keys === 'undefined' || keys === null) {
            return { ...data };
        }
        if (typeof keys === 'string') {
            return { [keys]: data[keys] };
        }
        if (Array.isArray(keys)) {
            const result = {};
            for (const key of keys) {
                result[key] = data[key];
            }
            return result;
        }
        if (typeof keys === 'object') {
            const result = { ...keys };
            for (const key of Object.keys(keys)) {
                if (Object.prototype.hasOwnProperty.call(data, key)) {
                    result[key] = data[key];
                }
            }
            return result;
        }
        return {};
    }

    return {
        data,
        writes,
        async get(keys, callback) {
            const result = buildResult(keys);
            if (typeof callback === 'function') {
                callback(result);
            }
            return result;
        },
        async set(payload) {
            writes.push(payload);
            Object.assign(data, payload);
        },
    };
}

function jsonResponse(payload, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return payload;
        },
        async text() {
            return JSON.stringify(payload);
        },
    };
}

function buildBackgroundHarness(storageData) {
    const storageSync = createStorageSync(storageData);
    const context = {
        console: {
            ...console,
            error: () => {},
            warn: () => {},
            info: () => {},
        },
        importScripts: () => {},
        fetch: async () => {
            throw new Error('fetch not mocked');
        },
        sleep: async () => {},
        setTimeout,
        clearTimeout,
        AbortController,
        chrome: {
            storage: {
                sync: storageSync,
                onChanged: { addListener: () => {} },
            },
            runtime: {
                onMessage: { addListener: () => {} },
                openOptionsPage: () => {},
                lastError: null,
            },
            tabs: {
                query: async () => [],
                sendMessage: async () => ({}),
            },
            downloads: {
                download: (_options, callback) => {
                    if (typeof callback === 'function') {
                        callback(1);
                    }
                },
            },
        },
    };

    const backgroundPath = path.resolve(__dirname, '../../background.js');
    const backgroundSource = fs.readFileSync(backgroundPath, 'utf8');
    vm.createContext(context);
    vm.runInContext(backgroundSource, context, { filename: 'background.js' });

    return { context, storageSync };
}

function buildOptionsHarness(storageData = {}) {
    const storageSync = createStorageSync(storageData);
    const context = {
        console: {
            ...console,
            error: () => {},
            warn: () => {},
            info: () => {},
        },
        chrome: {
            storage: {
                sync: storageSync,
            },
        },
        document: {
            addEventListener: () => {},
        },
    };

    const optionsPath = path.resolve(__dirname, '../../extension-options-page/options.js');
    const optionsSource = fs.readFileSync(optionsPath, 'utf8');
    vm.createContext(context);
    vm.runInContext(optionsSource, context, { filename: 'options.js' });

    return { context, storageSync };
}

function extractFunctionSource(fileSource, signature) {
    const start = fileSource.indexOf(signature);
    if (start === -1) {
        throw new Error(`Could not find function signature: ${signature}`);
    }

    const braceStart = fileSource.indexOf('{', start);
    if (braceStart === -1) {
        throw new Error(`Could not find opening brace for: ${signature}`);
    }

    let depth = 0;
    for (let index = braceStart; index < fileSource.length; index++) {
        const char = fileSource[index];
        if (char === '{') {
            depth += 1;
            continue;
        }
        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return fileSource.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Could not find closing brace for: ${signature}`);
}

describe('Google Cloud provider integration', () => {
    test('routes translateTexts to Google Cloud implementation when provider is googleCloud', async () => {
        const { context } = buildBackgroundHarness({
            translationProvider: 'googleCloud',
            googleCloudApiKey: 'route-test-key',
        });

        const requestedUrls = [];
        context.fetch = async (url) => {
            requestedUrls.push(String(url));
            if (String(url).includes('translation.googleapis.com')) {
                return jsonResponse({
                    data: {
                        translations: [{ translatedText: 'cloud-route' }],
                    },
                });
            }
            if (String(url).includes('translate.googleapis.com')) {
                return jsonResponse([[['free-route']]]);
            }
            throw new Error(`Unexpected URL: ${url}`);
        };

        await context.loadProviderConfig();
        const result = await context.translateTexts(['hei'], 'EN-US');

        assert.equal(result[0], true);
        assert.equal(result[1][0], 'cloud-route');
        assert.match(requestedUrls[0], /translation\.googleapis\.com/);
    });

    test('loads googleCloudApiKey into provider config used by translateWithGoogleCloud', async () => {
        const { context } = buildBackgroundHarness({
            translationProvider: 'googleCloud',
            googleCloudApiKey: 'loaded-key-123',
        });

        const requestedUrls = [];
        context.fetch = async (url) => {
            requestedUrls.push(String(url));
            return jsonResponse({
                data: {
                    translations: [{ translatedText: 'ok' }],
                },
            });
        };

        await context.loadProviderConfig();
        const result = await context.translateWithGoogleCloud(['hei maailma'], 'EN-US');

        assert.equal(result[0], true);
        assert.ok(requestedUrls[0].includes('key=loaded-key-123'));
    });

    test('persists googleCloud provider key using googleCloudApiKey storage field', async () => {
        const { context, storageSync } = buildOptionsHarness();

        await context.saveApiKey('googleCloud', 'persist-me');

        assert.equal(storageSync.writes.length, 1);
        assert.equal(storageSync.writes[0].googleCloudApiKey, 'persist-me');
    });

    test('checkHasValidProvider returns false when googleCloud is selected without API key', async () => {
        const settingsPath = path.resolve(__dirname, '../../content/settings.js');
        const settingsSource = fs.readFileSync(settingsPath, 'utf8');
        const functionSource = extractFunctionSource(settingsSource, 'async function checkHasValidProvider()');

        const storageSync = createStorageSync({
            translationProvider: 'googleCloud',
            googleCloudApiKey: '',
            deeplApiKey: '',
            claudeApiKey: '',
            geminiApiKey: '',
            grokApiKey: '',
            kimiApiKey: '',
        });

        const context = {
            console: {
                ...console,
                error: () => {},
                warn: () => {},
                info: () => {},
            },
            chrome: {
                storage: {
                    sync: storageSync,
                },
            },
        };

        vm.createContext(context);
        vm.runInContext(`${functionSource}\n;globalThis.__checkHasValidProvider = checkHasValidProvider;`, context, {
            filename: 'settings-checkHasValidProvider.js',
        });

        const isValid = await context.__checkHasValidProvider();
        assert.equal(isValid, false);
    });
});
