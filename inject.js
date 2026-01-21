/**
 * YLE Areena script injector
 *
 * Injects the yle-injected.js script for VTT subtitle interception.
 */

(function() {
  // Inject the YLE VTT interception script
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('platforms/yle/yle-injected.js');
  script.onload = function() {
    this.remove();
  };
  script.onerror = function() {
    console.error('DualSubExtension: Failed to load yle-injected.js');
    this.remove();
  };

  (document.head || document.documentElement).appendChild(script);
})();
