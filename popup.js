/**
 * Popup script for Language Learning Subtitles extension
 */

document.getElementById("setupLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Extension toggle functionality
const extensionToggle = document.getElementById("extension-enabled-toggle");
const extensionStatus = document.getElementById("extension-status");
const YLE_TAB_URL_PATTERN = 'https://areena.yle.fi/*';

/**
 * Update the status display based on current state
 * Simplified: just show ON/OFF, no detailed reasons
 * @param {boolean} enabled - Whether extension is enabled
 */
function updateStatusDisplay(enabled) {
  extensionStatus.classList.remove('status-disabled');

  if (enabled) {
    extensionStatus.textContent = "Extension enabled";
  } else {
    extensionStatus.textContent = "Extension disabled";
    extensionStatus.classList.add('status-disabled');
  }
}

// Load initial state from storage
async function loadInitialState() {
  try {
    const result = await chrome.storage.sync.get(['extensionEnabled']);
    const enabled = result.extensionEnabled !== false; // Default to true

    extensionToggle.checked = enabled;
    updateStatusDisplay(enabled);
  } catch (error) {
    console.warn('Error loading extension state:', error);
    extensionToggle.checked = true;
    updateStatusDisplay(true);
  }
}

// Handle toggle changes
extensionToggle.addEventListener("change", async (e) => {
  const enabled = e.target.checked;

  try {
    // Save to storage
    await chrome.storage.sync.set({ extensionEnabled: enabled });

    // Update UI immediately
    updateStatusDisplay(enabled);

    // Send message to YLE tabs with content script
    const tabs = await chrome.tabs.query({ url: [YLE_TAB_URL_PATTERN] });
    for (const tab of tabs) {
      if (typeof tab.id !== 'number') {
        continue;
      }
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'extensionToggled',
          enabled: enabled
        });
      } catch (err) {
        // Tab doesn't have content script - ignore
      }
    }
  } catch (error) {
    console.error('Error saving extension state:', error);
  }
});

// Listen for storage changes (cross-tab sync)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return;

  if (changes.extensionEnabled) {
    const enabled = changes.extensionEnabled.newValue !== false;
    extensionToggle.checked = enabled;
    updateStatusDisplay(enabled);
  }
});

// Initialize on popup open
loadInitialState();
