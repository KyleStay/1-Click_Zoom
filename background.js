// --- Constants and Initial Setup ---
const CONTEXT_MENU_ID = "configureZoom";
const CONTEXT_MENU_SITES_ID = "manageSites";
const ZOOM_DIFF_THRESHOLD = 0.01;
const VALID_URL_PREFIXES = ['http', 'file'];
const MANUAL_ZOOM_DEBOUNCE_MS = 1500;
const MAX_SITES = 100;
const BADGE_DISPLAY_MS = 2000;

// Track extension-initiated zooms to ignore in onZoomChange
const pendingExtensionZooms = new Map();

// Debounce timers per tab for manual zoom saves
const zoomSaveTimers = new Map();

// Helper to check if a URL is zoomable
function isZoomableUrl(url) {
  return url && VALID_URL_PREFIXES.some(prefix => url.startsWith(prefix));
}

// Helper to extract hostname from URL
function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// Helper to get effective zoom for a site based on current state
function getEffectiveZoom(hostname, data) {
  const siteConfig = data.siteSettings?.[hostname];

  if (data.isToggledActive) {
    // Zoom enabled: use site toggle zoom or default
    return (siteConfig?.toggleZoom ?? data.toggleZoom) / 100;
  }
  // Zoom disabled: use site base zoom or 100%
  return (siteConfig?.baseZoom ?? 100) / 100;
}

// Wrapper to set zoom and track that we initiated it
function setZoomTracked(tabId, zoomFactor) {
  pendingExtensionZooms.set(tabId, Date.now());
  return chrome.tabs.setZoom(tabId, zoomFactor);
}

// --- Event Listeners ---

// On installation, set default values.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set({
      toggleZoom: 150,
      toggleModeEnabled: false,
      isToggledActive: false,
      siteSettings: {}
    }, () => {
      updateActionBehavior();
    });
  } else {
    // On update, ensure siteSettings exists and behavior is correct
    chrome.storage.sync.get('siteSettings', (data) => {
      if (!data.siteSettings) {
        chrome.storage.sync.set({ siteSettings: {} });
      }
    });
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
  } else if (message.type === "APPLY_ZOOM_TO_ALL_TABS") {
    applyZoomToAllTabs(message.zoomLevel);
  } else if (message.type === "TOGGLE_ZOOM") {
    toggleZoom();
  }
});

// Apply zoom to all tabs (called from popup, uses tracked zoom to avoid triggering onZoomChange save)
function applyZoomToAllTabs(zoomLevel) {
  const targetZoomFactor = zoomLevel / 100;

  chrome.windows.getAll({ populate: true, windowTypes: ['normal', 'app'] }, (windows) => {
    windows.forEach((win) => {
      win.tabs.forEach((tab) => {
        if (tab.id && isZoomableUrl(tab.url)) {
          chrome.tabs.getZoom(tab.id, (currentZoomFactor) => {
            if (chrome.runtime.lastError) return;
            if (Math.abs(currentZoomFactor - targetZoomFactor) > ZOOM_DIFF_THRESHOLD) {
              setZoomTracked(tab.id, targetZoomFactor).catch((err) => {
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

// Listen for a left-click on the extension icon. This is only active in 1-Click Mode.
chrome.action.onClicked.addListener(() => {
  toggleZoom();
});

// Listen for keyboard shortcut (user-configurable via chrome://extensions/shortcuts)
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

// Listen for manual zoom changes to auto-save per-site preferences
chrome.tabs.onZoomChange.addListener((zoomChangeInfo) => {
  const { tabId, newZoomFactor, oldZoomFactor } = zoomChangeInfo;

  // Ignore if we caused this zoom (within last 500ms)
  const ourZoomTime = pendingExtensionZooms.get(tabId);
  if (ourZoomTime) {
    if (Date.now() - ourZoomTime < 500) {
      pendingExtensionZooms.delete(tabId);
      return;
    }
    // Clean up stale entry (older than 500ms)
    pendingExtensionZooms.delete(tabId);
  }

  // Ignore tiny changes (floating point noise)
  if (Math.abs(newZoomFactor - oldZoomFactor) < ZOOM_DIFF_THRESHOLD) {
    return;
  }

  // Debounce: clear existing timer and set new one
  clearTimeout(zoomSaveTimers.get(tabId));
  zoomSaveTimers.set(tabId, setTimeout(() => {
    saveSiteZoom(tabId, newZoomFactor);
    zoomSaveTimers.delete(tabId);
  }, MANUAL_ZOOM_DEBOUNCE_MS));
});

// Listen for a click on the right-click context menu.
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === CONTEXT_MENU_ID) {
    openConfigurationPage();
  } else if (info.menuItemId === CONTEXT_MENU_SITES_ID) {
    chrome.tabs.create({ url: 'sites.html' });
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

// Save manual zoom change for a site with auto-cleanup
function saveSiteZoom(tabId, zoomFactor) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab?.url) return;
    if (!isZoomableUrl(tab.url)) return;

    const hostname = getHostname(tab.url);
    if (!hostname) return;

    const zoomPercent = Math.round(zoomFactor * 100);

    chrome.storage.sync.get(['toggleZoom', 'isToggledActive', 'siteSettings'], (data) => {
      const siteSettings = data.siteSettings || {};
      const defaultToggleZoom = data.toggleZoom || 150;

      // Check site limit before adding new site
      if (!siteSettings[hostname] && Object.keys(siteSettings).length >= MAX_SITES) {
        console.warn('1-Click Zoom: Max sites limit reached, cannot save preference');
        return;
      }

      // Initialize site entry if needed
      if (!siteSettings[hostname]) {
        siteSettings[hostname] = {};
      }

      // Determine which zoom to save based on current state
      let zoomSaved = false;
      if (data.isToggledActive) {
        // Zoom enabled: save toggle zoom
        if (zoomPercent === defaultToggleZoom) {
          // Matches default, remove override
          delete siteSettings[hostname].toggleZoom;
        } else {
          siteSettings[hostname].toggleZoom = zoomPercent;
          zoomSaved = true;
        }
      } else {
        // Zoom disabled: save base zoom (unzoomed state)
        if (zoomPercent === 100) {
          // Matches default (100%), remove override
          delete siteSettings[hostname].baseZoom;
        } else {
          siteSettings[hostname].baseZoom = zoomPercent;
          zoomSaved = true;
        }
      }

      // Clean up empty site entries
      if (Object.keys(siteSettings[hostname]).length === 0) {
        delete siteSettings[hostname];
      }

      chrome.storage.sync.set({ siteSettings }, () => {
        if (chrome.runtime.lastError) {
          console.warn('1-Click Zoom: Failed to save site preference');
          return;
        }

        // Show badge notification
        if (zoomSaved) {
          chrome.action.setBadgeText({ text: '✓' });
          chrome.action.setBadgeBackgroundColor({ color: '#2da44e' });
          setTimeout(() => {
            chrome.action.setBadgeText({ text: '' });
          }, BADGE_DISPLAY_MS);
        }
      });
    });
  });
}

// Toggle zoom on/off for all tabs (used by icon click and keyboard shortcut)
function toggleZoom() {
  // Clear any pending manual zoom saves to prevent stale state being saved
  zoomSaveTimers.forEach((timer) => clearTimeout(timer));
  zoomSaveTimers.clear();

  chrome.storage.sync.get(['toggleZoom', 'isToggledActive', 'siteSettings'], (data) => {
    if (!data.toggleZoom) return;
    const newToggledState = !data.isToggledActive;
    const siteSettings = data.siteSettings || {};

    chrome.storage.sync.set({ isToggledActive: newToggledState }, () => {
      chrome.windows.getAll({ populate: true, windowTypes: ['normal', 'app'] }, (windows) => {
        windows.forEach((win) => {
          win.tabs.forEach((tab) => {
            if (tab.id && isZoomableUrl(tab.url)) {
              const hostname = getHostname(tab.url);
              const siteConfig = hostname ? siteSettings[hostname] : null;
              // Use site-specific toggle zoom or default for zoomed state
              const siteToggleZoom = siteConfig?.toggleZoom ?? data.toggleZoom;
              // Use site-specific base zoom or 100% for unzoomed state
              const siteBaseZoom = siteConfig?.baseZoom ?? 100;
              const targetZoomFactor = newToggledState ? (siteToggleZoom / 100) : (siteBaseZoom / 100);

              chrome.tabs.getZoom(tab.id, (currentZoomFactor) => {
                if (chrome.runtime.lastError) return;
                if (Math.abs(currentZoomFactor - targetZoomFactor) > ZOOM_DIFF_THRESHOLD) {
                  setZoomTracked(tab.id, targetZoomFactor).catch((err) => {
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
      // 1-Click Mode: icon click toggles zoom directly
      chrome.action.setPopup({ popup: '' });
      // Remove existing menu first to avoid duplicate ID error, then create
      chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
          id: CONTEXT_MENU_ID,
          title: "Configure Zoom",
          contexts: ["action"]
        }, () => {
          if (chrome.runtime.lastError) {
            console.warn('Context menu creation warning:', chrome.runtime.lastError.message);
          }
        });
        chrome.contextMenus.create({
          id: CONTEXT_MENU_SITES_ID,
          title: "Manage Sites",
          contexts: ["action"]
        }, () => {
          if (chrome.runtime.lastError) {
            console.warn('Context menu creation warning:', chrome.runtime.lastError.message);
          }
        });
      });
    } else {
      // Default Mode: icon click opens popup
      chrome.action.setPopup({ popup: 'popup.html' });
      chrome.contextMenus.removeAll();
      // Don't reset isToggledActive - preserve zoom state when switching modes
    }
  });
}

function applyZoomToFutureTab(tabId) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    chrome.windows.get(tab.windowId, (window) => {
      if (chrome.runtime.lastError || !window) return;
      chrome.storage.sync.get(['toggleZoom', 'isToggledActive', 'siteSettings'], (data) => {
        const hostname = getHostname(tab.url);
        const targetZoomFactor = getEffectiveZoom(hostname, data);

        if (targetZoomFactor) {
          chrome.tabs.getZoom(tabId, (currentZoomFactor) => {
            if (chrome.runtime.lastError) return;
            if (Math.abs(currentZoomFactor - targetZoomFactor) > ZOOM_DIFF_THRESHOLD) {
              setZoomTracked(tabId, targetZoomFactor).catch((err) => {
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
