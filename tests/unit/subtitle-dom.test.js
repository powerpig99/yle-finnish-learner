/**
 * Unit tests for tracked subtitle DOM state transitions.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

function buildSubtitleDomHarness() {
    const listeners = new Map();
    const context = {
        Map,
        subtitleState: new Map(),
        document: {
            addEventListener: (type, handler) => {
                listeners.set(type, handler);
            },
            dispatchEvent: (event) => {
                const handler = listeners.get(event.type);
                if (typeof handler === 'function') {
                    handler(event);
                }
            },
        },
    };

    const source = fs.readFileSync(path.resolve(__dirname, '../../content/subtitle-dom.js'), 'utf8');
    const start = source.indexOf('/** @type {Map<string, Set<HTMLElement>>} */');
    const end = source.indexOf('/**\n * Add both Finnish and target language subtitles to the displayed subtitles wrapper');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('Failed to locate tracked subtitle DOM snippet');
    }
    const snippet = source.slice(start, end);

    vm.createContext(context);
    vm.runInContext(`
${snippet}
globalThis.__api = {
    trackActiveTranslationSpan,
    updateTrackedTranslationSpans,
    getTrackedCount: (key) => activeTranslationSpans.get(key)?.size || 0,
};
`, context, { filename: 'subtitle-dom-snippet.js' });

    return context;
}

function buildVideoBottomHarness() {
    const context = {
        Math,
        Number,
        Set,
        window: {
            getComputedStyle: (element) => element.__computedStyle,
        },
    };

    const source = fs.readFileSync(path.resolve(__dirname, '../../content/subtitle-dom.js'), 'utf8');
    const start = source.indexOf('const DISPLAYED_SUBTITLES_VIDEO_BOTTOM_OFFSET_PROPERTY');
    const end = source.indexOf('/**\n * Check if a mutation is related to subtitles wrapper');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('Failed to locate video bottom helper snippet');
    }
    const snippet = source.slice(start, end);

    vm.createContext(context);
    vm.runInContext(`
${snippet}
globalThis.__videoApi = {
    getRenderedVideoBottomCoordinate,
    getRenderedVideoWidth,
    getVisibleBottomControlsTopCoordinate,
    getDisplayedSubtitlesControlsOverlapOffset,
    getDisplayedSubtitlesBottomOffset,
    syncDisplayedSubtitlesWrapperVideoWidth,
};
`, context, { filename: 'subtitle-dom-video-bottom-snippet.js' });

    return context;
}

function makeSpan(originalText) {
    return {
        isConnected: true,
        dataset: {
            originalText,
        },
        style: {
            opacity: '',
        },
        textContent: originalText,
        title: '',
        removeAttribute(name) {
            if (name === 'title') {
                this.title = '';
            }
        },
    };
}

function makeVideoElement({ rect, videoWidth, videoHeight, objectFit = 'contain', objectPosition = '50% 50%' }) {
    return {
        videoWidth,
        videoHeight,
        getBoundingClientRect() {
            return rect;
        },
        __computedStyle: {
            objectFit,
            objectPosition,
        },
    };
}

function makeDisplayedWrapper(containingRect) {
    const properties = new Map();
    return {
        offsetParent: {
            getBoundingClientRect() {
                return containingRect;
            },
        },
        style: {
            setProperty(name, value) {
                properties.set(name, value);
            },
            removeProperty(name) {
                properties.delete(name);
            },
            getPropertyValue(name) {
                return properties.get(name) || '';
            },
        },
    };
}

function makeControlElement(rect) {
    return {
        getBoundingClientRect() {
            return rect;
        },
    };
}

function makePlayerUI({ active = true, controlElements = [] } = {}) {
    return {
        classList: {
            contains(className) {
                return className === 'yle-mouse-active' ? active : false;
            },
        },
        querySelectorAll() {
            return controlElements;
        },
    };
}

describe('tracked subtitle DOM state transitions', () => {
    test('failed spans stay tracked and pending retries show translating', () => {
        const context = buildSubtitleDomHarness();
        const key = 'hei maailma';
        const span = makeSpan('Hei maailma');

        context.__api.trackActiveTranslationSpan(key, span);
        context.subtitleState.set(key, {
            status: 'failed',
            error: 'Translation echoed original text',
        });
        context.__api.updateTrackedTranslationSpans(key);

        assert.equal(span.textContent, 'Hei maailma');
        assert.equal(span.style.opacity, '0.6');
        assert.match(span.title, /Translation failed/);
        assert.equal(context.__api.getTrackedCount(key), 1);

        context.subtitleState.set(key, {
            status: 'pending',
        });
        context.document.dispatchEvent({
            type: 'dscTranslationStateChanged',
            detail: { key },
        });

        assert.equal(span.textContent, 'Translating...');
        assert.equal(span.style.opacity, '');
        assert.equal(span.title, '');
        assert.equal(context.__api.getTrackedCount(key), 1);
    });

    test('successful spans stay tracked and forced retries show translating', () => {
        const context = buildSubtitleDomHarness();
        const key = 'hei maailma';
        const span = makeSpan('Hei maailma');

        context.__api.trackActiveTranslationSpan(key, span);
        context.subtitleState.set(key, {
            status: 'success',
            text: 'Hello world',
        });
        context.__api.updateTrackedTranslationSpans(key);

        assert.equal(span.textContent, 'Hello world');
        assert.equal(span.style.opacity, '');
        assert.equal(span.title, '');
        assert.equal(context.__api.getTrackedCount(key), 1);

        context.subtitleState.set(key, {
            status: 'pending',
        });
        context.document.dispatchEvent({
            type: 'dscTranslationStateChanged',
            detail: { key },
        });

        assert.equal(span.textContent, 'Translating...');
        assert.equal(span.style.opacity, '');
        assert.equal(span.title, '');
        assert.equal(context.__api.getTrackedCount(key), 1);
    });
});

describe('rendered video bottom offset', () => {
    test('uses vertical letterbox offset for contain-fitted video', () => {
        const context = buildVideoBottomHarness();
        const videoElement = makeVideoElement({
            rect: { top: 0, bottom: 993, width: 1536, height: 993 },
            videoWidth: 960,
            videoHeight: 540,
        });
        const displayedWrapper = makeDisplayedWrapper({ bottom: 993 });

        const renderedBottom = context.__videoApi.getRenderedVideoBottomCoordinate(videoElement);
        const bottomOffset = context.__videoApi.getDisplayedSubtitlesBottomOffset(displayedWrapper, videoElement);

        assert.equal(renderedBottom, 928.5);
        assert.equal(bottomOffset, 64.5);
    });

    test('returns zero bottom offset when contain fit produces horizontal letterboxing only', () => {
        const context = buildVideoBottomHarness();
        const videoElement = makeVideoElement({
            rect: { top: 0, bottom: 2073, width: 3840, height: 2073 },
            videoWidth: 1920,
            videoHeight: 1080,
        });
        const displayedWrapper = makeDisplayedWrapper({ bottom: 2073 });

        const renderedBottom = context.__videoApi.getRenderedVideoBottomCoordinate(videoElement);
        const bottomOffset = context.__videoApi.getDisplayedSubtitlesBottomOffset(displayedWrapper, videoElement);

        assert.equal(renderedBottom, 2073);
        assert.equal(bottomOffset, 0);
    });

    test('uses rendered video width instead of container width when height constrains the video', () => {
        const context = buildVideoBottomHarness();
        const videoElement = makeVideoElement({
            rect: { top: 0, bottom: 700, width: 1536, height: 700 },
            videoWidth: 1920,
            videoHeight: 1080,
        });
        const displayedWrapper = makeDisplayedWrapper({ bottom: 700 });

        const renderedWidth = context.__videoApi.getRenderedVideoWidth(videoElement);
        context.__videoApi.syncDisplayedSubtitlesWrapperVideoWidth(displayedWrapper, videoElement);
        const syncedWidth = Number.parseFloat(displayedWrapper.style.getPropertyValue('--dsc-rendered-video-width'));

        assert.ok(Math.abs(renderedWidth - 1244.4444444444443) < 0.000001);
        assert.ok(Math.abs(syncedWidth - 1244.4444444444443) < 0.000001);
    });

    test('does not lift subtitles when visible controls stay inside the lower letterbox band', () => {
        const context = buildVideoBottomHarness();
        const videoElement = makeVideoElement({
            rect: { top: 0, bottom: 993, width: 1536, height: 993 },
            videoWidth: 960,
            videoHeight: 540,
        });
        const displayedWrapper = makeDisplayedWrapper({ bottom: 993 });
        const playerUI = makePlayerUI({
            controlElements: [
                makeControlElement({ top: 933, bottom: 993, width: 1536, height: 60 }),
            ],
        });

        const controlsTop = context.__videoApi.getVisibleBottomControlsTopCoordinate(playerUI);
        const overlapOffset = context.__videoApi.getDisplayedSubtitlesControlsOverlapOffset(videoElement, playerUI);
        const bottomOffset = context.__videoApi.getDisplayedSubtitlesBottomOffset(displayedWrapper, videoElement, playerUI);

        assert.equal(controlsTop, 933);
        assert.equal(overlapOffset, 0);
        assert.equal(bottomOffset, 64.5);
    });

    test('lifts subtitles only by the amount bottom controls overlap the rendered picture', () => {
        const context = buildVideoBottomHarness();
        const videoElement = makeVideoElement({
            rect: { top: 0, bottom: 993, width: 1536, height: 993 },
            videoWidth: 960,
            videoHeight: 540,
        });
        const displayedWrapper = makeDisplayedWrapper({ bottom: 993 });
        const playerUI = makePlayerUI({
            controlElements: [
                makeControlElement({ top: 900, bottom: 993, width: 1536, height: 93 }),
            ],
        });

        const overlapOffset = context.__videoApi.getDisplayedSubtitlesControlsOverlapOffset(videoElement, playerUI);
        const bottomOffset = context.__videoApi.getDisplayedSubtitlesBottomOffset(displayedWrapper, videoElement, playerUI);

        assert.equal(overlapOffset, 28.5);
        assert.equal(bottomOffset, 93);
    });
});
