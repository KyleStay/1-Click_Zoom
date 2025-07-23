// --- Constants and Initial Setup ---
const CONTEXT_MENU_ID = "configureZoom";
let configWindowId = null; // Variable to store the ID of the settings window

// --- Event Listeners ---

// On installation, set default values and configure the initial state.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set({
      globalZoom: 100,
      toggleZoom: 150,
      toggleModeEnabled: false,
      isToggledActive: false
    }, () => {
      updateActionBehavior();
    });
  } else {
    updateActionBehavior();
  }
});

// Listen for messages from the popup to update behavior.
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SETTINGS_CHANGED") {
    updateActionBehavior();
  }
});

// Listen for a left-click on the extension icon. This is only active in 1-Click Mode.
chrome.action.onClicked.addListener(() => {
    chrome.storage.sync.get(['toggleZoom', 'isToggledActive'], (data) => {
        if (!data.toggleZoom) return;

        const newToggledState = !data.isToggledActive;
        const targetZoomFactor = newToggledState ? (data.toggleZoom / 100) : 1.0;

        chrome.storage.sync.set({ isToggledActive: newToggledState }, () => {
            chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }, (windows) => {
                windows.forEach((win) => {
                    win.tabs.forEach((tab) => {
                        if (tab.id && tab.url && (tab.url.startsWith('http') || tab.url.startsWith('https'))) {
                            // Smart Check: Only set zoom if it's different from the target.
                            chrome.tabs.getZoom(tab.id, (currentZoomFactor) => {
                                if (Math.abs(currentZoomFactor - targetZoomFactor) > 0.01) {
                                    chrome.tabs.setZoom(tab.id, targetZoomFactor).catch(err => {
                                        console.error(`Could not set zoom for tab ${tab.id}: ${err.message}`);
                                    });
                                }
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

// When the settings window is closed, reset its ID.
chrome.windows.onRemoved.addListener((windowId) => {
    if (windowId === configWindowId) {
        configWindowId = null;
    }
});


// --- Core Functions ---

/**
 * Checks storage and sets the extension's primary action (popup or toggle).
 */
function updateActionBehavior() {
  chrome.storage.sync.get('toggleModeEnabled', (data) => {
    if (data.toggleModeEnabled) {
      chrome.action.setPopup({ popup: '' });
      chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: "Configure Zoom",
        contexts: ["action"]
      });
    } else {
      chrome.action.setPopup({ popup: 'popup.html' });
      chrome.contextMenus.removeAll();
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
    let targetZoomFactor = 1.0;

    if (data.toggleModeEnabled) {
      if (data.isToggledActive) {
        targetZoomFactor = data.toggleZoom / 100;
      }
    } else {
      targetZoomFactor = data.globalZoom / 100;
    }

    if (targetZoomFactor) {
        // Smart Check: Only set zoom if it's different from the target.
        chrome.tabs.getZoom(tabId, (currentZoomFactor) => {
            if (Math.abs(currentZoomFactor - targetZoomFactor) > 0.01) {
                chrome.tabs.setZoom(tabId, targetZoomFactor).catch(err => console.error(err.message));
            }
        });
    }
  });
}

/**
 * Opens the popup.html file, or focuses it if it's already open.
 */
function openConfigurationPage() {
  if (configWindowId !== null) {
    chrome.windows.get(configWindowId, (foundWindow) => {
        if (chrome.runtime.lastError) {
            createConfigWindow();
        } else {
            chrome.windows.update(configWindowId, { focused: true });
        }
    });
  } else {
    createConfigWindow();
  }
}

/**
 * Creates a new configuration window and stores its ID.
 */
function createConfigWindow() {
    chrome.windows.create({
        url: 'popup.html',
        type: 'popup',
        width: 280,
        height: 500
    }, (win) => {
        configWindowId = win.id;
    });
}
