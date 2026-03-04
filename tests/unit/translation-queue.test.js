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
        fetchTranslation: async () => [true, []],
        fetchBatchTranslation: async () => [true, []],
        currentMovieName: null,
        targetLanguage: 'EN-US',
        detectedSourceLanguage: null,
        normalizeLanguageCode,
        globalDatabaseInstance: null,
        saveSubtitlesBatch: async () => 0,
        fullSubtitles: [],
        ControlIntegration: { setSubtitles: () => {} },
        getCurrentTranslationProvider: () => 'google',
        showBatchTranslationIndicator: () => {},
        updateBatchTranslationIndicator: () => {},
        hideBatchTranslationIndicator: () => {},
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

    return { context, dispatchedEvents };
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
});
