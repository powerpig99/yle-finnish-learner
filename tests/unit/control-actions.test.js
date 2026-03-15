/**
 * Unit tests for subtitle navigation controls.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

function buildControlActionsHarness(video, {
    primeAutoPauseNavigationTarget = null,
    clearAutoPause = null,
    dispatchEvent = null,
} = {}) {
    const context = {
        window: {},
        document: {
            querySelector: (selector) => {
                if (selector === 'video') {
                    return video;
                }
                return null;
            },
            dispatchEvent: typeof dispatchEvent === 'function' ? dispatchEvent : undefined,
        },
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
    };
    if (typeof primeAutoPauseNavigationTarget === 'function') {
        context.primeAutoPauseNavigationTarget = primeAutoPauseNavigationTarget;
    }
    if (typeof clearAutoPause === 'function') {
        context.clearAutoPause = clearAutoPause;
    }

    const scriptPath = path.resolve(__dirname, '../../controls/control-actions.js');
    const scriptSource = fs.readFileSync(scriptPath, 'utf8');

    vm.createContext(context);
    vm.runInContext(scriptSource, context, { filename: 'control-actions.js' });

    return context.window.ControlActions;
}

function makeVideo({ currentTime = 0, paused = false, textTracks = [] } = {}) {
    return {
        currentTime,
        paused,
        textTracks,
        playCalls: 0,
        play() {
            this.paused = false;
            this.playCalls += 1;
        },
    };
}

describe('ControlActions subtitle navigation', () => {
    test('skipToNextSubtitle prefers the exact next subtitle timing when it exists', () => {
        const video = makeVideo({
            currentTime: 11,
            textTracks: [],
        });
        const controlActions = buildControlActionsHarness(video);

        controlActions.skipToNextSubtitle([
            { startTime: 2, endTime: 3, text: 'one' },
            { startTime: 35, endTime: 37, text: 'two' },
        ]);

        assert.equal(video.currentTime, 35);
    });

    test('skipToNextSubtitle primes auto-pause with the target subtitle end time', () => {
        const primedEndTimes = [];
        const video = makeVideo({
            currentTime: 11,
            paused: true,
            textTracks: [],
        });
        const controlActions = buildControlActionsHarness(video, {
            primeAutoPauseNavigationTarget: (endTime) => {
                primedEndTimes.push(endTime);
            },
        });

        controlActions.skipToNextSubtitle([
            { startTime: 2, endTime: 3, text: 'one' },
            { startTime: 35, endTime: 37, text: 'two' },
        ]);

        assert.deepEqual(primedEndTimes, [37]);
        assert.equal(video.currentTime, 35);
        assert.equal(video.playCalls, 1);
    });

    test('skipToNextSubtitle clears any stale auto-pause before seeking', () => {
        const callOrder = [];
        const video = makeVideo({
            currentTime: 11,
            paused: true,
            textTracks: [],
        });
        const controlActions = buildControlActionsHarness(video, {
            clearAutoPause: () => {
                callOrder.push('clear');
            },
            primeAutoPauseNavigationTarget: (endTime) => {
                callOrder.push(`prime:${endTime}`);
            },
        });

        controlActions.skipToNextSubtitle([
            { startTime: 2, endTime: 3, text: 'one' },
            { startTime: 35, endTime: 37, text: 'two' },
        ]);

        assert.deepEqual(callOrder, ['clear', 'prime:37']);
        assert.equal(video.currentTime, 35);
        assert.equal(video.playCalls, 1);
    });

    test('skipToPreviousSubtitle uses prefetched subtitle timing', () => {
        const video = makeVideo({
            currentTime: 36,
            textTracks: [],
        });
        const controlActions = buildControlActionsHarness(video);

        controlActions.skipToPreviousSubtitle([
            { startTime: 2, endTime: 3, text: 'one' },
            { startTime: 35, endTime: 37, text: 'two' },
            { startTime: 50, endTime: 52, text: 'three' },
        ]);

        assert.equal(video.currentTime, 2);
    });

    test('skipToNextSubtitle still moves forward 10 seconds when no subtitle target is available yet', () => {
        const video = makeVideo({
            currentTime: 10,
            textTracks: [
                {
                    mode: 'showing',
                    cues: [{ startTime: 5 }, { startTime: 12 }, { startTime: 20 }],
                },
            ],
            paused: true,
        });
        const controlActions = buildControlActionsHarness(video);

        controlActions.skipToNextSubtitle([]);

        assert.equal(video.currentTime, 20);
        assert.equal(video.playCalls, 1);
    });

    test('prefetched timings stay authoritative and ignore text-track cue timing', () => {
        const video = makeVideo({
            currentTime: 35.1,
            textTracks: [
                {
                    mode: 'showing',
                    cues: [{ startTime: 34.9 }, { startTime: 35.0 }, { startTime: 35.2 }],
                },
            ],
        });
        const controlActions = buildControlActionsHarness(video);
        const subtitles = [
            { startTime: 2, endTime: 3, text: 'one' },
            { startTime: 35, endTime: 37, text: 'two' },
            { startTime: 50, endTime: 52, text: 'three' },
        ];

        controlActions.skipToPreviousSubtitle(subtitles);
        assert.equal(video.currentTime, 2);

        video.currentTime = 35.1;
        controlActions.skipToNextSubtitle(subtitles);
        assert.equal(video.currentTime, 50);
    });

    test('skipToPreviousSubtitle is a no-op on the first subtitle', () => {
        const primedEndTimes = [];
        const video = makeVideo({
            currentTime: 2.1,
            paused: true,
            textTracks: [],
        });
        const controlActions = buildControlActionsHarness(video, {
            primeAutoPauseNavigationTarget: (endTime) => {
                primedEndTimes.push(endTime);
            },
        });

        const didSeek = controlActions.skipToPreviousSubtitle([
            { startTime: 2, endTime: 3, text: 'one' },
            { startTime: 35, endTime: 37, text: 'two' },
        ]);

        assert.equal(didSeek, false);
        assert.equal(video.currentTime, 2.1);
        assert.equal(video.playCalls, 0);
        assert.deepEqual(primedEndTimes, []);
    });

    test('skipToNextSubtitle deduplicates near-identical prefetched start times', () => {
        const video = makeVideo({
            currentTime: 4,
            textTracks: [],
        });
        const controlActions = buildControlActionsHarness(video);

        controlActions.skipToNextSubtitle([
            { startTime: 5.0000, endTime: 6, text: 'one' },
            { startTime: 5.0004, endTime: 6, text: 'duplicate window' },
            { startTime: 8.0, endTime: 9, text: 'two' },
        ]);

        assert.equal(video.currentTime, 5.0);
    });

    test('skipToNextSubtitle still moves forward 10 seconds after the last subtitle', () => {
        const video = makeVideo({
            currentTime: 50.5,
            paused: true,
            textTracks: [],
        });
        const controlActions = buildControlActionsHarness(video);

        const didSeek = controlActions.skipToNextSubtitle([
            { startTime: 2, endTime: 3, text: 'one' },
            { startTime: 35, endTime: 37, text: 'two' },
            { startTime: 50, endTime: 52, text: 'three' },
        ]);

        assert.equal(didSeek, true);
        assert.equal(video.currentTime, 60.5);
        assert.equal(video.playCalls, 1);
    });

    test('repeatCurrentSubtitle primes auto-pause with the repeated subtitle end time', () => {
        const primedEndTimes = [];
        const video = makeVideo({
            currentTime: 35.2,
            paused: true,
            textTracks: [],
        });
        const controlActions = buildControlActionsHarness(video, {
            primeAutoPauseNavigationTarget: (endTime) => {
                primedEndTimes.push(endTime);
            },
        });

        controlActions.repeatCurrentSubtitle([
            { startTime: 2, endTime: 3, text: 'one' },
            { startTime: 35, endTime: 37, text: 'two' },
            { startTime: 50, endTime: 52, text: 'three' },
        ]);

        assert.deepEqual(primedEndTimes, [37]);
        assert.equal(video.currentTime, 35);
        assert.equal(video.playCalls, 1);
    });

    test('repeatCurrentSubtitle does not dispatch translation retry events', () => {
        const dispatchedEvents = [];
        const video = makeVideo({
            currentTime: 35.2,
            paused: true,
            textTracks: [],
        });
        const controlActions = buildControlActionsHarness(video, {
            dispatchEvent: (event) => {
                dispatchedEvents.push(event);
            },
        });

        controlActions.repeatCurrentSubtitle([
            { startTime: 2, endTime: 3, text: 'one' },
            { startTime: 35, endTime: 37, text: 'two' },
            { startTime: 50, endTime: 52, text: 'three' },
        ]);

        assert.equal(dispatchedEvents.length, 0);
    });

    test('retryCurrentSubtitleTranslation dispatches current subtitle text for forced re-translation', () => {
        const dispatchedEvents = [];
        const video = makeVideo({
            currentTime: 35.2,
            paused: true,
            textTracks: [],
        });
        const controlActions = buildControlActionsHarness(video, {
            dispatchEvent: (event) => {
                dispatchedEvents.push(event);
            },
        });

        const didDispatch = controlActions.retryCurrentSubtitleTranslation([
            { startTime: 2, endTime: 3, text: 'one' },
            { startTime: 35, endTime: 37, text: 'two' },
            { startTime: 50, endTime: 52, text: 'three' },
        ]);

        assert.equal(didDispatch, true);
        assert.equal(dispatchedEvents.length, 1);
        assert.equal(dispatchedEvents[0].type, 'dscRetrySubtitleTranslation');
        assert.equal(dispatchedEvents[0].detail?.subtitleText, 'two');
    });
});
