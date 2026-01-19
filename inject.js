/**
 * Platform-specific script injector
 *
 * Injects the appropriate injected.js script based on the current platform.
 * This allows each platform (YLE, YouTube, HTML5) to have its own subtitle
 * interception logic.
 */

(function() {
  // Detect platform based on hostname
  const hostname = window.location.hostname;

  let scriptPath = '';

  if (hostname === 'areena.yle.fi') {
    // YLE Areena - use VTT interception
    scriptPath = 'platforms/yle/yle-injected.js';
  } else if (hostname === 'www.youtube.com' || hostname === 'youtube.com') {
    // YouTube - use timedtext API interception
    scriptPath = 'platforms/youtube/youtube-injected.js';
  } else {
    // Generic HTML5 - no injection needed, uses TextTrack API directly
    // The HTML5 adapter handles this in the content script context
    console.info('DualSubExtension: Generic HTML5 platform detected, no injection needed');
    return;
  }

  // Inject the platform-specific script
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL(scriptPath);
  script.onload = function() {
    this.remove();
  };
  script.onerror = function() {
    console.error('DualSubExtension: Failed to load injected script:', scriptPath);
    this.remove();
  };

  (document.head || document.documentElement).appendChild(script);
})();
