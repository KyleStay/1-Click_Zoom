// --- Constants and Initial Setup ---
const CONTEXT_MENU_ID = "configureZoom";

// --- Event Listeners ---

// On installation, set default values and configure the initial state.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['globalZoom', 'toggleZoom', 'toggleModeEnabled'], (data) => {
    chrome.storage.sync.set({
      globalZoom: data.globalZoom || 100,
      toggleZoom: data.toggleZoom || 150, // Default toggle zoom set to 150%
      toggleModeEnabled: data.toggleModeEnabled || false
    }, () => {
      updateActionBehavior();
    });
  });
});

// Listen for messages from the popup to update behavior.
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SETTINGS_CHANGED") {
    updateActionBehavior();
  }
});

// Listen for a left-click on the extension icon. This is only active in Toggle Mode.
chrome.action.onClicked.addListener((tab) => {
  if (tab.url && (tab.url.startsWith('http') || tab.url.startsWith('file'))) {
    toggleZoomOnTab(tab);
  }
});

// Listen for tab updates to apply the global zoom (if not in toggle mode).
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    applyGlobalZoom(tabId);
  }
});

// Listen for a click on the right-click context menu.
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === CONTEXT_MENU_ID) {
    openConfigurationPage();
  }
});


// --- Core Functions ---

/**
 * Checks storage and sets the extension's primary action (popup or toggle).
 */
function updateActionBehavior() {
  chrome.storage.sync.get('toggleModeEnabled', (data) => {
    if (data.toggleModeEnabled) {
      // Enable Toggle Mode: Left-click toggles, right-click configures.
      chrome.action.setPopup({ popup: '' }); // Disable popup
      chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: "Configure Zoom",
        contexts: ["action"]
      });
    } else {
      // Disable Toggle Mode: Left-click opens popup.
      chrome.action.setPopup({ popup: 'popup.html' }); // Enable popup
      chrome.contextMenus.removeAll();
    }
  });
}

/**
 * Toggles the zoom on a specific tab between 100% and the saved toggle level.
 * @param {chrome.tabs.Tab} tab The tab to apply the zoom to.
 */
function toggleZoomOnTab(tab) {
  Promise.all([
    chrome.tabs.getZoom(tab.id),
    chrome.storage.sync.get('toggleZoom')
  ]).then(([currentZoomFactor, data]) => {
    const toggleZoomFactor = data.toggleZoom / 100;
    // If zoom is already at the toggle level, reset to 100%. Otherwise, set to toggle level.
    const newZoomFactor = Math.abs(currentZoomFactor - toggleZoomFactor) < 0.01 ? 1.0 : toggleZoomFactor;
    chrome.tabs.setZoom(tab.id, newZoomFactor);
  }).catch(err => console.error("Could not toggle zoom:", err));
}

/**
 * Applies the saved global zoom to a tab, but only if toggle mode is disabled.
 * @param {number} tabId The ID of the tab to apply the zoom to.
 */
function applyGlobalZoom(tabId) {
  chrome.storage.sync.get(['globalZoom', 'toggleModeEnabled'], (data) => {
    if (!data.toggleModeEnabled && data.globalZoom) {
      const zoomFactor = data.globalZoom / 100;
      chrome.tabs.setZoom(tabId, zoomFactor).catch(err => console.error(err.message));
    }
  });
}

/**
 * Opens the popup.html file in a new, small window for configuration.
 */
function openConfigurationPage() {
  chrome.windows.create({
    url: 'popup.html',
    type: 'popup',
    width: 280,
    height: 450 // Slightly taller to accommodate new option
  });
}
