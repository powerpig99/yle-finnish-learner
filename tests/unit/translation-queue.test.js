/**
 * Unit tests for subtitle translation queue edge cases.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

function toTranslationKey(text) {
    return String(text || '')
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function normalizeLanguageCode(langCode) {
    if (!langCode || typeof langCode !== 'string') {
        return 'en';
    }
    return langCode.toLowerCase().trim().split(/[-_]/)[0] || 'en';
}

function buildTranslationQueueHarness() {
    const dispatchedEvents = [];
    const setSubtitlesCalls = [];
    const saveCalls = [];
    const indicatorStats = { showCount: 0, hideCount: 0, updateCount: 0 };
    const context = {
        console: {
            ...console,
            error: () => {},
            warn: () => {},
            info: () => {},
        },
        Date,
        Map,
        subtitleState: new Map(),
        toTranslationKey,
        dualSubEnabled: true,
        fetchBatchTranslation: async () => [true, []],
        currentMovieName: null,
        targetLanguage: 'EN-US',
        detectedSourceLanguage: null,
        normalizeLanguageCode,
        globalDatabaseInstance: null,
        saveSubtitlesBatch: async (_db, subtitles) => {
            saveCalls.push(subtitles.map((subtitle) => ({ ...subtitle })));
            return subtitles.length;
        },
        fullSubtitles: [],
        ControlIntegration: {
            setSubtitles: (subtitles) => {
                setSubtitlesCalls.push(subtitles.map((sub) => ({ ...sub })));
            }
        },
        getCurrentTranslationProvider: () => 'google',
        showBatchTranslationIndicator: () => {
            indicatorStats.showCount += 1;
        },
        updateBatchTranslationIndicator: () => {
            indicatorStats.updateCount += 1;
        },
        hideBatchTranslationIndicator: () => {
            indicatorStats.hideCount += 1;
        },
        sleep: async () => {},
        document: {
            dispatchEvent: (event) => {
                dispatchedEvents.push(event);
            },
        },
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
    };

    const scriptPath = path.resolve(__dirname, '../../content/translation-queue.js');
    const scriptSource = fs.readFileSync(scriptPath, 'utf8');

    vm.createContext(context);
    vm.runInContext(scriptSource, context, { filename: 'translation-queue.js' });

    return {
        context,
        dispatchedEvents,
        setSubtitlesCalls,
        indicatorStats,
        saveCalls,
    };
}

describe('translation queue non-translatable subtitle handling', () => {
    test('normalizeSubtitleText trims and removes newlines', () => {
        const { context } = buildTranslationQueueHarness();

        assert.equal(context.normalizeSubtitleText('  Hei\nmaailma  '), 'Hei maailma');
        assert.equal(context.normalizeSubtitleText('\n\t  '), '');
    });

    test('hasTranslatableSubtitleContent only triggers for letter-containing text', () => {
        const { context } = buildTranslationQueueHarness();

        assert.equal(context.hasTranslatableSubtitleContent(context.normalizeSubtitleText('.')), false);
        assert.equal(context.hasTranslatableSubtitleContent(context.normalizeSubtitleText('...')), false);
        assert.equal(context.hasTranslatableSubtitleContent(context.normalizeSubtitleText('!? 123')), false);
        assert.equal(context.hasTranslatableSubtitleContent(context.normalizeSubtitleText('Hei!')), true);
        assert.equal(context.hasTranslatableSubtitleContent(context.normalizeSubtitleText('こんにちは')), true);
    });

    test('shouldLogTranslationFailureAsWarning classifies provider/config errors as warnings', () => {
        const { context } = buildTranslationQueueHarness();

        assert.equal(
            context.shouldLogTranslationFailureAsWarning('Grok access denied (check API key permissions and model access)'),
            true
        );
        assert.equal(
            context.shouldLogTranslationFailureAsWarning('Gemini rate limit exceeded'),
            true
        );
        assert.equal(
            context.shouldLogTranslationFailureAsWarning('Google Cloud error: 403'),
            true
        );
    });

    test('shouldLogTranslationFailureAsWarning keeps unexpected/system errors as errors', () => {
        const { context } = buildTranslationQueueHarness();

        assert.equal(
            context.shouldLogTranslationFailureAsWarning('TypeError: Cannot read properties of undefined'),
            false
        );
        assert.equal(
            context.shouldLogTranslationFailureAsWarning('Network request failed'),
            false
        );
    });

    test('enqueueTranslation stores punctuation-only subtitles as pass-through success', () => {
        const { context, dispatchedEvents } = buildTranslationQueueHarness();

        const movedToPending = context.enqueueTranslation('.');

        assert.equal(movedToPending, false);
        const entry = context.subtitleState.get('.');
        assert.equal(entry?.status, 'success');
        assert.equal(entry?.text, '.');
        assert.equal(dispatchedEvents.length, 1);
        assert.equal(dispatchedEvents[0].type, 'dscTranslationResolved');
        assert.equal(dispatchedEvents[0].detail?.key, '.');
    });

    test('markTranslationSuccess ignores provider text for non-translatable subtitles', () => {
        const { context } = buildTranslationQueueHarness();
        const key = toTranslationKey('.');
        context.subtitleState.set(key, { status: 'pending', updatedAt: Date.now() });

        const updated = context.markTranslationSuccess('.', "I'm not sure if I can do that");

        assert.equal(updated, true);
        const entry = context.subtitleState.get(key);
        assert.equal(entry?.status, 'success');
        assert.equal(entry?.text, '.');
    });

    test('markTranslationFailed resolves non-translatable subtitles to pass-through success', () => {
        const { context } = buildTranslationQueueHarness();
        const key = toTranslationKey('...');
        context.subtitleState.set(key, { status: 'pending', updatedAt: Date.now() });

        const updated = context.markTranslationFailed('...', 'network timeout');

        assert.equal(updated, true);
        const entry = context.subtitleState.get(key);
        assert.equal(entry?.status, 'success');
        assert.equal(entry?.text, '...');
    });

    test('markTranslationSuccess keeps normal translated text for translatable subtitles', () => {
        const { context } = buildTranslationQueueHarness();
        const key = toTranslationKey('Hei maailma');
        context.subtitleState.set(key, { status: 'pending', updatedAt: Date.now() });

        const updated = context.markTranslationSuccess('Hei maailma', 'Hello world');

        assert.equal(updated, true);
        const entry = context.subtitleState.get(key);
        assert.equal(entry?.status, 'success');
        assert.equal(entry?.text, 'Hello world');
    });

    test('markTranslationSuccess marks identical translatable text as echo-back failure', () => {
        const { context } = buildTranslationQueueHarness();
        const key = toTranslationKey('Hei maailma');
        context.detectedSourceLanguage = 'fi';
        context.targetLanguage = 'EN-US';
        context.subtitleState.set(key, { status: 'pending', updatedAt: Date.now() });

        const updated = context.markTranslationSuccess('Hei maailma', 'Hei maailma');

        assert.equal(updated, true);
        const entry = context.subtitleState.get(key);
        assert.equal(entry?.status, 'failed');
        assert.match(entry?.error || '', /Translation echoed original text/);
        assert.equal(typeof entry?.nextRetryAt, 'number');
        assert.ok(Number.isFinite(entry?.nextRetryAt));
        assert.ok(entry.nextRetryAt > Date.now());
    });

    test('markTranslationSuccess marks tag-wrapped source echo as echo-back failure', () => {
        const { context } = buildTranslationQueueHarness();
        const key = toTranslationKey('Hei maailma');
        context.detectedSourceLanguage = 'fi';
        context.targetLanguage = 'EN-US';
        context.subtitleState.set(key, { status: 'pending', updatedAt: Date.now() });

        const updated = context.markTranslationSuccess('Hei maailma', 'Put <query>Hei maailma</query>');

        assert.equal(updated, true);
        const entry = context.subtitleState.get(key);
        assert.equal(entry?.status, 'failed');
        assert.match(entry?.error || '', /Translation echoed original text/);
        assert.equal(typeof entry?.nextRetryAt, 'number');
        assert.ok(Number.isFinite(entry?.nextRetryAt));
    });

    test('markTranslationSuccess keeps non-echo tagged translations', () => {
        const { context } = buildTranslationQueueHarness();
        const key = toTranslationKey('Hei maailma');
        context.detectedSourceLanguage = 'fi';
        context.targetLanguage = 'EN-US';
        context.subtitleState.set(key, { status: 'pending', updatedAt: Date.now() });

        const updated = context.markTranslationSuccess('Hei maailma', 'Hello <br> world');

        assert.equal(updated, true);
        const entry = context.subtitleState.get(key);
        assert.equal(entry?.status, 'success');
        assert.equal(entry?.text, 'Hello <br> world');
    });

    test('markTranslationSuccess allows identical text when source and target language match', () => {
        const { context } = buildTranslationQueueHarness();
        const key = toTranslationKey('Hei maailma');
        context.detectedSourceLanguage = 'fi';
        context.targetLanguage = 'FI';
        context.subtitleState.set(key, { status: 'pending', updatedAt: Date.now() });

        const updated = context.markTranslationSuccess('Hei maailma', 'Hei maailma');

        assert.equal(updated, true);
        const entry = context.subtitleState.get(key);
        assert.equal(entry?.status, 'success');
        assert.equal(entry?.text, 'Hei maailma');
    });

    test('echo-back retries back off and stop after max attempts', () => {
        const { context } = buildTranslationQueueHarness();
        const key = toTranslationKey('Hei maailma');
        context.detectedSourceLanguage = 'fi';
        context.targetLanguage = 'EN-US';

        const retryTimes = [];
        for (let attempt = 0; attempt < 4; attempt++) {
            context.subtitleState.set(key, { status: 'pending', updatedAt: Date.now() });
            const updated = context.markTranslationSuccess('Hei maailma', 'Hei maailma');
            assert.equal(updated, true);
            const entry = context.subtitleState.get(key);
            assert.equal(entry?.status, 'failed');
            retryTimes.push(entry?.nextRetryAt);
        }

        assert.ok(Number.isFinite(retryTimes[0]));
        assert.ok(Number.isFinite(retryTimes[1]));
        assert.ok(Number.isFinite(retryTimes[2]));
        assert.equal(retryTimes[3], Number.POSITIVE_INFINITY);
        assert.ok(retryTimes[1] > retryTimes[0]);
        assert.ok(retryTimes[2] > retryTimes[1]);
        assert.match(context.subtitleState.get(key)?.error || '', /retry limit reached/);

        const movedToPending = context.enqueueTranslation('Hei maailma');
        assert.equal(movedToPending, false);

        context.clearSubtitleTranslationState();
        const movedAfterReset = context.enqueueTranslation('Hei maailma');
        assert.equal(movedAfterReset, true);
    });

    test('handleBatchTranslation updates navigation timing during in-flight batch and processes queued subtitles', async () => {
        const { context, setSubtitlesCalls } = buildTranslationQueueHarness();
        let fetchCallCount = 0;
        let resolveFirstFetch = null;

        context.fetchBatchTranslation = async (texts) => {
            fetchCallCount += 1;
            if (fetchCallCount === 1) {
                return await new Promise((resolve) => {
                    resolveFirstFetch = () => resolve([true, texts.map((text) => `translated:${text}`)]);
                });
            }
            return [true, texts.map((text) => `translated:${text}`)];
        };

        const firstBatchPromise = context.handleBatchTranslation([
            { text: 'ensimmäinen', startTime: 1, endTime: 2 },
        ]);

        await Promise.resolve();

        await context.handleBatchTranslation([
            { text: 'kauempana', startTime: 120, endTime: 121 },
        ]);

        assert.ok(
            context.fullSubtitles.some((subtitle) => subtitle.startTime === 120),
            'expected far subtitle timing to be merged immediately for navigation'
        );
        assert.ok(
            setSubtitlesCalls.some((batch) => batch.some((subtitle) => subtitle.startTime === 120)),
            'expected ControlIntegration.setSubtitles to receive far subtitle timing'
        );

        assert.equal(typeof resolveFirstFetch, 'function');
        resolveFirstFetch();
        await firstBatchPromise;

        for (let attempt = 0; attempt < 20; attempt++) {
            const entry = context.subtitleState.get(toTranslationKey('kauempana'));
            if (entry?.status === 'success') {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        const queuedEntry = context.subtitleState.get(toTranslationKey('kauempana'));
        assert.equal(fetchCallCount, 2);
        assert.equal(queuedEntry?.status, 'success');
        assert.equal(queuedEntry?.text, 'translated:kauempana');
    });

    test('queued subtitles are still processed when current in-flight batch has nothing new to translate', async () => {
        const { context } = buildTranslationQueueHarness();
        let resolveFirstFetch = null;
        let fetchCallCount = 0;

        context.fetchBatchTranslation = async (texts) => {
            fetchCallCount += 1;
            if (fetchCallCount === 1) {
                return await new Promise((resolve) => {
                    resolveFirstFetch = () => resolve([true, texts.map((text) => `translated:${text}`)]);
                });
            }
            return [true, texts.map((text) => `translated:${text}`)];
        };

        const firstBatchPromise = context.handleBatchTranslation([
            { text: 'sama rivi', startTime: 1, endTime: 2 },
        ]);

        await Promise.resolve();

        // Duplicate text while first batch is in-flight -> no new translation work for this batch,
        // but it should still allow queued follow-up batches to process.
        await context.handleBatchTranslation([
            { text: 'sama rivi', startTime: 3, endTime: 4 },
        ]);

        // New text arrives while still in-flight and must not be dropped.
        await context.handleBatchTranslation([
            { text: 'uusi rivi', startTime: 5, endTime: 6 },
        ]);

        assert.equal(typeof resolveFirstFetch, 'function');
        resolveFirstFetch();
        await firstBatchPromise;

        for (let attempt = 0; attempt < 20; attempt++) {
            const entry = context.subtitleState.get(toTranslationKey('uusi rivi'));
            if (entry?.status === 'success') {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        const queuedEntry = context.subtitleState.get(toTranslationKey('uusi rivi'));
        assert.equal(fetchCallCount, 2);
        assert.equal(queuedEntry?.status, 'success');
        assert.equal(queuedEntry?.text, 'translated:uusi rivi');
    });

    test('batch translation indicator shows once for repeated batches in same movie session', async () => {
        const { context, indicatorStats } = buildTranslationQueueHarness();
        context.fetchBatchTranslation = async (texts) => [true, texts.map((text) => `translated:${text}`)];

        await context.handleBatchTranslation([
            { text: 'ensimmäinen', startTime: 1, endTime: 2 },
        ]);
        await context.handleBatchTranslation([
            { text: 'toinen', startTime: 3, endTime: 4 },
        ]);

        assert.equal(indicatorStats.showCount, 1);
        assert.equal(indicatorStats.hideCount, 1);
    });

    test('batch translation indicator gate resets after subtitle timeline is reset for new movie', async () => {
        const { context, indicatorStats } = buildTranslationQueueHarness();
        context.fetchBatchTranslation = async (texts) => [true, texts.map((text) => `translated:${text}`)];

        await context.handleBatchTranslation([
            { text: 'ensimmäinen', startTime: 1, endTime: 2 },
        ]);
        context.fullSubtitles.length = 0;
        await context.handleBatchTranslation([
            { text: 'uusi video', startTime: 1, endTime: 2 },
        ]);

        assert.equal(indicatorStats.showCount, 2);
        assert.equal(indicatorStats.hideCount, 2);
    });

    test('resetNavigationSubtitleTimeline clears prefetched navigation subtitles and syncs empty state', () => {
        const { context, setSubtitlesCalls } = buildTranslationQueueHarness();
        context.fullSubtitles.push(
            { startTime: 1, endTime: 2, text: 'one' },
            { startTime: 3, endTime: 4, text: 'two' }
        );

        context.resetNavigationSubtitleTimeline();

        assert.equal(context.fullSubtitles.length, 0);
        assert.equal(setSubtitlesCalls.length, 1);
        assert.equal(Array.isArray(setSubtitlesCalls[0]), true);
        assert.equal(setSubtitlesCalls[0].length, 0);
    });

    test('navigation reset drops stale batch work and caches only the current movie session', async () => {
        const { context, saveCalls } = buildTranslationQueueHarness();
        context.globalDatabaseInstance = { tag: 'db' };
        context.currentMovieName = 'movie-a';
        let resolveFirstFetch = null;
        const fetchArgs = [];

        context.fetchBatchTranslation = async (texts) => {
            fetchArgs.push([...texts]);
            if (fetchArgs.length === 1) {
                return await new Promise((resolve) => {
                    resolveFirstFetch = () => resolve([true, texts.map((text) => `stale:${text}`)]);
                });
            }
            return [true, texts.map((text) => `fresh:${text}`)];
        };

        const firstBatchPromise = context.handleBatchTranslation([
            { text: 'shared line', startTime: 1, endTime: 2 },
        ]);

        await Promise.resolve();

        await context.handleBatchTranslation([
            { text: 'old queued', startTime: 3, endTime: 4 },
        ]);

        context.resetNavigationSubtitleTimeline();
        context.currentMovieName = 'movie-b';

        await context.handleBatchTranslation([
            { text: 'shared line', startTime: 1, endTime: 2 },
        ]);

        assert.equal(typeof resolveFirstFetch, 'function');
        resolveFirstFetch();
        await firstBatchPromise;

        for (let attempt = 0; attempt < 20; attempt++) {
            const entry = context.subtitleState.get(toTranslationKey('shared line'));
            if (entry?.status === 'success' && entry.text === 'fresh:shared line') {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        const sharedEntry = context.subtitleState.get(toTranslationKey('shared line'));
        const cachedRecords = saveCalls.flat();
        assert.equal(fetchArgs.length, 2);
        assert.deepEqual(fetchArgs[0], ['shared line']);
        assert.deepEqual(fetchArgs[1], ['shared line']);
        assert.equal(sharedEntry?.status, 'success');
        assert.equal(sharedEntry?.text, 'fresh:shared line');
        assert.equal(context.subtitleState.has(toTranslationKey('old queued')), false);
        assert.equal(cachedRecords.some((record) => record.movieName === 'movie-a'), false);
        assert.equal(cachedRecords.some((record) => record.originalText === toTranslationKey('old queued')), false);
        assert.equal(
            cachedRecords.some((record) =>
                record.movieName === 'movie-b' &&
                record.originalText === toTranslationKey('shared line') &&
                record.translatedText === 'fresh:shared line'
            ),
            true
        );
    });

});
