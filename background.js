// --- Constants and Initial Setup ---
const CONTEXT_MENU_ID = "configureZoom";
const ZOOM_DIFF_THRESHOLD = 0.01;
const VALID_URL_PREFIXES = ['http', 'file'];

// Helper to check if a URL is zoomable
function isZoomableUrl(url) {
  return url && VALID_URL_PREFIXES.some(prefix => url.startsWith(prefix));
}

// --- Event Listeners ---

// On installation, set default values.
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
    // On update, just ensure the behavior is correct.
    updateActionBehavior();
  }
});

// **FIX:** Add a listener for browser startup to ensure the correct action is set.
chrome.runtime.onStartup.addListener(() => {
  updateActionBehavior();
});

// Listen for messages from the popup to update behavior.
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SETTINGS_CHANGED") {
    updateActionBehavior();
  }
});

// Listen for a left-click on the extension icon. This is only active in 1-Click Mode.
chrome.action.onClicked.addListener(() => {
  toggleZoom();
});

// Listen for keyboard shortcut (Ctrl+Shift+Alt+Z)
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-zoom') {
    toggleZoom();
  }
});

// Listen for tab updates to apply the correct zoom to future tabs in either mode.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isZoomableUrl(tab.url)) {
    applyZoomToFutureTab(tabId);
  }
});

// Listen for a click on the right-click context menu.
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === CONTEXT_MENU_ID) {
    openConfigurationPage();
  }
});

// When the settings window is closed, reset its ID in session storage.
chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.session.get('configWindowId', (data) => {
    if (data.configWindowId === windowId) {
      chrome.storage.session.remove('configWindowId');
    }
  });
});


// --- Core Functions ---

// Toggle zoom on/off for all tabs (used by icon click and keyboard shortcut)
function toggleZoom() {
  chrome.storage.sync.get(['toggleZoom', 'isToggledActive'], (data) => {
    if (!data.toggleZoom) return;
    const newToggledState = !data.isToggledActive;
    const targetZoomFactor = newToggledState ? (data.toggleZoom / 100) : 1.0;

    chrome.storage.sync.set({ isToggledActive: newToggledState }, () => {
      chrome.windows.getAll({ populate: true, windowTypes: ['normal', 'app'] }, (windows) => {
        windows.forEach((win) => {
          win.tabs.forEach((tab) => {
            if (tab.id && isZoomableUrl(tab.url)) {
              chrome.tabs.getZoom(tab.id, (currentZoomFactor) => {
                if (chrome.runtime.lastError) return;
                if (Math.abs(currentZoomFactor - targetZoomFactor) > ZOOM_DIFF_THRESHOLD) {
                  chrome.tabs.setZoom(tab.id, targetZoomFactor).catch((err) => {
                    // Expected for chrome:// or restricted pages
                    if (!err.message?.includes('Cannot access')) {
                      console.warn('Zoom error:', err.message);
                    }
                  });
                }
              });
            }
          });
        });
      });
    });
  });
}

function updateActionBehavior() {
  chrome.storage.sync.get('toggleModeEnabled', (data) => {
    if (data.toggleModeEnabled) {
      chrome.action.setPopup({ popup: '' });
      // Remove existing menu first to avoid duplicate ID error, then create
      chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
          id: CONTEXT_MENU_ID,
          title: "Configure Zoom",
          contexts: ["action"]
        }, () => {
          // Clear any potential error from create (e.g., if extension context invalidated)
          if (chrome.runtime.lastError) {
            console.warn('Context menu creation warning:', chrome.runtime.lastError.message);
          }
        });
      });
    } else {
      chrome.action.setPopup({ popup: 'popup.html' });
      chrome.contextMenus.removeAll();
      chrome.storage.sync.set({ isToggledActive: false });
    }
  });
}

function applyZoomToFutureTab(tabId) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    chrome.windows.get(tab.windowId, (window) => {
      if (chrome.runtime.lastError || !window) return;
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
          chrome.tabs.getZoom(tabId, (currentZoomFactor) => {
            if (chrome.runtime.lastError) return;
            if (Math.abs(currentZoomFactor - targetZoomFactor) > ZOOM_DIFF_THRESHOLD) {
              chrome.tabs.setZoom(tabId, targetZoomFactor).catch((err) => {
                // Expected for chrome:// or restricted pages
                if (!err.message?.includes('Cannot access')) {
                  console.warn('Zoom error:', err.message);
                }
              });
            }
          });
        }
      });
    });
  });
}

function openConfigurationPage() {
  // Use session storage to persist configWindowId across service worker restarts
  chrome.storage.session.get('configWindowId', (data) => {
    const storedWindowId = data.configWindowId;
    if (storedWindowId !== null && storedWindowId !== undefined) {
      chrome.windows.get(storedWindowId, (foundWindow) => {
        if (chrome.runtime.lastError || !foundWindow) {
          createConfigWindow();
        } else {
          chrome.windows.update(storedWindowId, { focused: true });
        }
      });
    } else {
      createConfigWindow();
    }
  });
}

function createConfigWindow() {
  chrome.windows.create({
    url: 'popup.html',
    type: 'popup',
    width: 280,
    height: 510
  }, (win) => {
    if (win && win.id) {
      chrome.storage.session.set({ configWindowId: win.id });
    }
  });
}
