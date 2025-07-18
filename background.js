// --- Constants and Initial Setup ---
const CONTEXT_MENU_ID = "configureZoom";

// --- Event Listeners ---

// On installation, set default values and configure the initial state.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['globalZoom', 'toggleZoom', 'toggleModeEnabled', 'isToggledActive'], (data) => {
    chrome.storage.sync.set({
      globalZoom: data.globalZoom || 100,
      toggleZoom: data.toggleZoom || 150,
      toggleModeEnabled: data.toggleModeEnabled || false,
      isToggledActive: data.isToggledActive || false // Tracks the state of 1-Click Mode
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

// Listen for a left-click on the extension icon. This is only active in 1-Click Mode.
chrome.action.onClicked.addListener(() => {
    // This listener is active when in 1-Click Mode. It flips the toggle state
    // and applies the correct zoom to all current tabs.
    chrome.storage.sync.get(['toggleZoom', 'isToggledActive'], (data) => {
        if (!data.toggleZoom) return;

        const newToggledState = !data.isToggledActive;
        const targetZoomFactor = newToggledState ? (data.toggleZoom / 100) : 1.0;

        // Save the new state
        chrome.storage.sync.set({ isToggledActive: newToggledState }, () => {
            // Apply the new zoom to all tabs in all windows
            chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }, (windows) => {
                windows.forEach((win) => {
                    win.tabs.forEach((tab) => {
                        if (tab.id && tab.url && (tab.url.startsWith('http') || tab.url.startsWith('https'))) {
                            chrome.tabs.setZoom(tab.id, targetZoomFactor).catch(err => {
                                console.error(`Could not set zoom for tab ${tab.id}: ${err.message}`);
                            });
                        }
                    });
                });
            });
        });
    });
});

// Listen for tab updates to apply the correct zoom to future tabs in either mode.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Ensure the tab is fully loaded before applying zoom.
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    applyZoomToFutureTab(tabId);
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
      // Enable 1-Click Mode: Left-click toggles, right-click configures.
      chrome.action.setPopup({ popup: '' }); // Disable popup
      chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: "Configure Zoom",
        contexts: ["action"]
      });
    } else {
      // Disable 1-Click Mode: Left-click opens popup.
      chrome.action.setPopup({ popup: 'popup.html' }); // Enable popup
      chrome.contextMenus.removeAll();
      // When switching back to global mode, reset the toggle state for consistency.
      chrome.storage.sync.set({ isToggledActive: false });
    }
  });
}

/**
 * Applies the correct zoom to a new or updated tab based on the current mode.
 * @param {number} tabId The ID of the tab to apply the zoom to.
 */
function applyZoomToFutureTab(tabId) {
  chrome.storage.sync.get(['globalZoom', 'toggleZoom', 'toggleModeEnabled', 'isToggledActive'], (data) => {
    let zoomFactor = 1.0; // Default to 100%

    if (data.toggleModeEnabled) {
      // In 1-Click Mode, use the toggle state.
      if (data.isToggledActive) {
        zoomFactor = data.toggleZoom / 100;
      }
    } else {
      // In Global Zoom Mode, use the global setting.
      zoomFactor = data.globalZoom / 100;
    }

    // Apply the determined zoom factor.
    if (zoomFactor) {
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
    height: 450
  });
}
