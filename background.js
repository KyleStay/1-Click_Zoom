// --- Constants and Initial Setup ---
const CONTEXT_MENU_ID = "configureZoom";
const CONTEXT_MENU_SITES_ID = "manageSites";
const CONTEXT_MENU_EXCLUDE_EXACT_ID = "excludeExact";
const CONTEXT_MENU_EXCLUDE_PATTERN_ID = "excludePattern";
const CONTEXT_MENU_REMOVE_EXCLUSION_ID = "removeExclusion";
// Page context menu IDs (right-click on webpage)
const PAGE_MENU_EXCLUDE_EXACT_ID = "pageExcludeExact";
const PAGE_MENU_EXCLUDE_PATTERN_ID = "pageExcludePattern";
const PAGE_MENU_REMOVE_EXCLUSION_ID = "pageRemoveExclusion";
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

// Helper to extract root domain from hostname (e.g., "mail.google.com" -> "google.com")
function getRootDomain(hostname) {
  if (!hostname) return null;
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join('.');
}

// Helper to check if a hostname is excluded
function isExcluded(hostname, excludedSites) {
  if (!hostname || !excludedSites) return false;

  // Check exact match
  if (excludedSites.exact?.includes(hostname)) return true;

  // Check patterns (*.domain.com matches domain.com and any subdomain)
  for (const pattern of excludedSites.patterns || []) {
    const domain = pattern.replace('*.', '');
    if (hostname === domain || hostname.endsWith('.' + domain)) return true;
  }
  return false;
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
      siteSettings: {},
      excludedSites: { exact: [], patterns: [] }
    }, () => {
      updateActionBehavior();
    });
  } else {
    // On update, ensure siteSettings and excludedSites exist and behavior is correct
    chrome.storage.sync.get(['siteSettings', 'excludedSites'], (data) => {
      const updates = {};
      if (!data.siteSettings) updates.siteSettings = {};
      if (!data.excludedSites) updates.excludedSites = { exact: [], patterns: [] };
      if (Object.keys(updates).length > 0) {
        chrome.storage.sync.set(updates);
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SETTINGS_CHANGED") {
    updateActionBehavior();
  } else if (message.type === "APPLY_ZOOM_TO_ALL_TABS") {
    applyZoomToAllTabs(message.zoomLevel);
  } else if (message.type === "TOGGLE_ZOOM") {
    toggleZoom();
  } else if (message.type === "ADD_EXCLUSION") {
    addExclusion(message.hostname, message.isPattern).then(sendResponse);
    return true; // Keep channel open for async response
  } else if (message.type === "REMOVE_EXCLUSION") {
    removeExclusion(message.value, message.isPattern).then(sendResponse);
    return true;
  } else if (message.type === "CHECK_EXCLUSION") {
    checkExclusion(message.hostname).then(sendResponse);
    return true;
  } else if (message.type === "EXPORT_SETTINGS") {
    exportSettings().then(sendResponse);
    return true;
  } else if (message.type === "IMPORT_SETTINGS") {
    importSettings(message.settings, message.mergeMode).then(sendResponse);
    return true;
  } else if (message.type === "CHECK_HAS_CUSTOM_SETTINGS") {
    checkHasCustomSettings().then(sendResponse);
    return true;
  }
});

// Apply zoom to all tabs (called from popup, uses tracked zoom to avoid triggering onZoomChange save)
function applyZoomToAllTabs(zoomLevel) {
  const targetZoomFactor = zoomLevel / 100;

  chrome.storage.sync.get('excludedSites', (data) => {
    const excludedSites = data.excludedSites || { exact: [], patterns: [] };

    chrome.windows.getAll({ populate: true, windowTypes: ['normal', 'app'] }, (windows) => {
      windows.forEach((win) => {
        win.tabs.forEach((tab) => {
          if (tab.id && isZoomableUrl(tab.url)) {
            const hostname = getHostname(tab.url);
            // Skip excluded sites
            if (isExcluded(hostname, excludedSites)) return;

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

  // Check if site is excluded before debouncing
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab?.url) return;
    const hostname = getHostname(tab.url);
    chrome.storage.sync.get('excludedSites', (data) => {
      if (isExcluded(hostname, data.excludedSites)) return;

      // Debounce: clear existing timer and set new one
      clearTimeout(zoomSaveTimers.get(tabId));
      zoomSaveTimers.set(tabId, setTimeout(() => {
        saveSiteZoom(tabId, newZoomFactor);
        zoomSaveTimers.delete(tabId);
      }, MANUAL_ZOOM_DEBOUNCE_MS));
    });
  });
});

// Listen for a click on the right-click context menu.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID) {
    openConfigurationPage();
  } else if (info.menuItemId === CONTEXT_MENU_SITES_ID) {
    chrome.tabs.create({ url: 'sites.html' });
  } else if (info.menuItemId === CONTEXT_MENU_EXCLUDE_EXACT_ID ||
             info.menuItemId === PAGE_MENU_EXCLUDE_EXACT_ID) {
    // Exclude exact hostname of current tab
    if (tab?.url && isZoomableUrl(tab.url)) {
      const hostname = getHostname(tab.url);
      if (hostname) {
        addExclusion(hostname, false);
      }
    }
  } else if (info.menuItemId === CONTEXT_MENU_EXCLUDE_PATTERN_ID ||
             info.menuItemId === PAGE_MENU_EXCLUDE_PATTERN_ID) {
    // Exclude all subdomains of current tab's domain
    if (tab?.url && isZoomableUrl(tab.url)) {
      const hostname = getHostname(tab.url);
      if (hostname) {
        addExclusion(hostname, true);
      }
    }
  } else if (info.menuItemId === CONTEXT_MENU_REMOVE_EXCLUSION_ID ||
             info.menuItemId === PAGE_MENU_REMOVE_EXCLUSION_ID) {
    // Remove exclusion for current tab's hostname
    if (tab?.url && isZoomableUrl(tab.url)) {
      const hostname = getHostname(tab.url);
      if (hostname) {
        // Check what type of exclusion and remove it
        checkExclusion(hostname).then(result => {
          if (result.isExact) {
            removeExclusion(hostname, false);
          } else if (result.matchedPattern) {
            removeExclusion(result.matchedPattern, true);
          }
        });
      }
    }
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

    chrome.storage.sync.get(['toggleZoom', 'isToggledActive', 'siteSettings', 'excludedSites'], (data) => {
      // Skip excluded sites
      if (isExcluded(hostname, data.excludedSites)) return;
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
      if (data.isToggledActive) {
        // Zoom enabled: save toggle zoom
        if (zoomPercent === defaultToggleZoom) {
          // Matches default, remove override
          delete siteSettings[hostname].toggleZoom;
        } else {
          siteSettings[hostname].toggleZoom = zoomPercent;
        }
      } else {
        // Zoom disabled: save base zoom (unzoomed state)
        if (zoomPercent === 100) {
          // Matches default (100%), remove override
          delete siteSettings[hostname].baseZoom;
        } else {
          siteSettings[hostname].baseZoom = zoomPercent;
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

        // Always show badge notification for manual zoom changes
        chrome.action.setBadgeText({ text: '✓' });
        chrome.action.setBadgeBackgroundColor({ color: '#2da44e' });
        setTimeout(() => {
          chrome.action.setBadgeText({ text: '' });
        }, BADGE_DISPLAY_MS);
      });
    });
  });
}

// Toggle zoom on/off for all tabs (used by icon click and keyboard shortcut)
function toggleZoom() {
  // Clear any pending manual zoom saves to prevent stale state being saved
  zoomSaveTimers.forEach((timer) => clearTimeout(timer));
  zoomSaveTimers.clear();

  chrome.storage.sync.get(['toggleZoom', 'isToggledActive', 'siteSettings', 'excludedSites'], (data) => {
    if (!data.toggleZoom) return;
    const newToggledState = !data.isToggledActive;
    const siteSettings = data.siteSettings || {};
    const excludedSites = data.excludedSites || { exact: [], patterns: [] };

    chrome.storage.sync.set({ isToggledActive: newToggledState }, () => {
      chrome.windows.getAll({ populate: true, windowTypes: ['normal', 'app'] }, (windows) => {
        windows.forEach((win) => {
          win.tabs.forEach((tab) => {
            if (tab.id && isZoomableUrl(tab.url)) {
              const hostname = getHostname(tab.url);
              // Skip excluded sites
              if (isExcluded(hostname, excludedSites)) return;
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
    // Remove existing menus first to avoid duplicate ID error
    chrome.contextMenus.removeAll(() => {
      // Always create page context menu items (right-click on webpage)
      createPageContextMenus();

      if (data.toggleModeEnabled) {
        // 1-Click Mode: icon click toggles zoom directly
        chrome.action.setPopup({ popup: '' });
        // Create action context menu items (right-click on extension icon)
        createActionContextMenus();
      } else {
        // Default Mode: icon click opens popup
        chrome.action.setPopup({ popup: 'popup.html' });
        // Don't reset isToggledActive - preserve zoom state when switching modes
      }
    });
  });
}

// Create context menu items for right-clicking on the extension icon (1-click mode only)
function createActionContextMenus() {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: "Configure Zoom",
    contexts: ["action"]
  }, logContextMenuError);

  chrome.contextMenus.create({
    id: CONTEXT_MENU_SITES_ID,
    title: "Manage Sites",
    contexts: ["action"]
  }, logContextMenuError);

  // Separator before exclusion items
  chrome.contextMenus.create({
    id: "separator1",
    type: "separator",
    contexts: ["action"]
  }, logContextMenuError);

  chrome.contextMenus.create({
    id: CONTEXT_MENU_EXCLUDE_EXACT_ID,
    title: "Exclude this site",
    contexts: ["action"]
  }, logContextMenuError);

  chrome.contextMenus.create({
    id: CONTEXT_MENU_EXCLUDE_PATTERN_ID,
    title: "Exclude all subdomains",
    contexts: ["action"]
  }, logContextMenuError);

  chrome.contextMenus.create({
    id: CONTEXT_MENU_REMOVE_EXCLUSION_ID,
    title: "Remove exclusion",
    contexts: ["action"]
  }, logContextMenuError);
}

// Create context menu items for right-clicking on a webpage (always available)
function createPageContextMenus() {
  // Parent menu item
  chrome.contextMenus.create({
    id: "zoomExclusionMenu",
    title: "1-Click Zoom",
    contexts: ["page"]
  }, logContextMenuError);

  chrome.contextMenus.create({
    id: PAGE_MENU_EXCLUDE_EXACT_ID,
    parentId: "zoomExclusionMenu",
    title: "Exclude this site",
    contexts: ["page"]
  }, logContextMenuError);

  chrome.contextMenus.create({
    id: PAGE_MENU_EXCLUDE_PATTERN_ID,
    parentId: "zoomExclusionMenu",
    title: "Exclude all subdomains",
    contexts: ["page"]
  }, logContextMenuError);

  chrome.contextMenus.create({
    id: PAGE_MENU_REMOVE_EXCLUSION_ID,
    parentId: "zoomExclusionMenu",
    title: "Remove exclusion",
    contexts: ["page"]
  }, logContextMenuError);
}

function logContextMenuError() {
  if (chrome.runtime.lastError) {
    console.warn('Context menu creation warning:', chrome.runtime.lastError.message);
  }
}

function applyZoomToFutureTab(tabId) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    chrome.windows.get(tab.windowId, (window) => {
      if (chrome.runtime.lastError || !window) return;
      chrome.storage.sync.get(['toggleZoom', 'isToggledActive', 'siteSettings', 'excludedSites'], (data) => {
        const hostname = getHostname(tab.url);
        // Skip excluded sites
        if (isExcluded(hostname, data.excludedSites)) return;
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
    width: 312,
    height: 770
  }, (win) => {
    if (win && win.id) {
      chrome.storage.session.set({ configWindowId: win.id });
    }
  });
}

// --- Exclusion Functions ---

// Add a site to the exclusion list
async function addExclusion(hostname, isPattern) {
  return new Promise((resolve) => {
    chrome.storage.sync.get('excludedSites', (data) => {
      const excludedSites = data.excludedSites || { exact: [], patterns: [] };

      if (isPattern) {
        const pattern = '*.' + getRootDomain(hostname);
        if (!excludedSites.patterns.includes(pattern)) {
          excludedSites.patterns.push(pattern);
        }
      } else {
        if (!excludedSites.exact.includes(hostname)) {
          excludedSites.exact.push(hostname);
        }
      }

      chrome.storage.sync.set({ excludedSites }, () => {
        resolve({ success: true, excludedSites });
      });
    });
  });
}

// Remove a site from the exclusion list
async function removeExclusion(value, isPattern) {
  return new Promise((resolve) => {
    chrome.storage.sync.get('excludedSites', (data) => {
      const excludedSites = data.excludedSites || { exact: [], patterns: [] };

      if (isPattern) {
        excludedSites.patterns = excludedSites.patterns.filter(p => p !== value);
      } else {
        excludedSites.exact = excludedSites.exact.filter(h => h !== value);
      }

      chrome.storage.sync.set({ excludedSites }, () => {
        resolve({ success: true, excludedSites });
      });
    });
  });
}

// Check if a hostname is excluded and return exclusion info
async function checkExclusion(hostname) {
  return new Promise((resolve) => {
    chrome.storage.sync.get('excludedSites', (data) => {
      const excludedSites = data.excludedSites || { exact: [], patterns: [] };
      const isExact = excludedSites.exact?.includes(hostname);

      let matchedPattern = null;
      for (const pattern of excludedSites.patterns || []) {
        const domain = pattern.replace('*.', '');
        if (hostname === domain || hostname.endsWith('.' + domain)) {
          matchedPattern = pattern;
          break;
        }
      }

      resolve({
        isExcluded: isExact || matchedPattern !== null,
        isExact,
        matchedPattern,
        hostname,
        rootDomain: getRootDomain(hostname)
      });
    });
  });
}

// --- Import/Export Functions ---

// Export all settings to a JSON object
async function exportSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(null, (data) => {
      const manifest = chrome.runtime.getManifest();
      const exportData = {
        version: manifest.version,
        exportDate: new Date().toISOString(),
        settings: {
          toggleZoom: data.toggleZoom || 150,
          toggleModeEnabled: data.toggleModeEnabled || false,
          isToggledActive: data.isToggledActive || false,
          siteSettings: data.siteSettings || {},
          excludedSites: data.excludedSites || { exact: [], patterns: [] }
        }
      };
      resolve({ success: true, data: exportData });
    });
  });
}

// Import settings from a JSON object
async function importSettings(importData, mergeMode = 'replace') {
  return new Promise((resolve) => {
    // Validate import data
    if (!importData || !importData.settings) {
      resolve({ success: false, error: 'Invalid import data format' });
      return;
    }

    const settings = importData.settings;

    // Validate individual fields
    if (settings.toggleZoom !== undefined) {
      const zoom = parseInt(settings.toggleZoom, 10);
      if (isNaN(zoom) || zoom < 25 || zoom > 500) {
        resolve({ success: false, error: 'Invalid zoom level (must be 25-500)' });
        return;
      }
    }

    chrome.storage.sync.get(null, (currentData) => {
      let newSettings = {};

      if (mergeMode === 'replace') {
        // Replace all settings
        newSettings = {
          toggleZoom: settings.toggleZoom ?? 150,
          toggleModeEnabled: settings.toggleModeEnabled ?? false,
          isToggledActive: settings.isToggledActive ?? false,
          siteSettings: settings.siteSettings ?? {},
          excludedSites: settings.excludedSites ?? { exact: [], patterns: [] }
        };
      } else if (mergeMode === 'merge') {
        // Merge with existing settings
        const currentSiteSettings = currentData.siteSettings || {};
        const importSiteSettings = settings.siteSettings || {};
        const mergedSiteSettings = { ...currentSiteSettings, ...importSiteSettings };

        const currentExcluded = currentData.excludedSites || { exact: [], patterns: [] };
        const importExcluded = settings.excludedSites || { exact: [], patterns: [] };
        const mergedExcluded = {
          exact: [...new Set([...(currentExcluded.exact || []), ...(importExcluded.exact || [])])],
          patterns: [...new Set([...(currentExcluded.patterns || []), ...(importExcluded.patterns || [])])]
        };

        newSettings = {
          toggleZoom: settings.toggleZoom ?? currentData.toggleZoom ?? 150,
          toggleModeEnabled: settings.toggleModeEnabled ?? currentData.toggleModeEnabled ?? false,
          isToggledActive: settings.isToggledActive ?? currentData.isToggledActive ?? false,
          siteSettings: mergedSiteSettings,
          excludedSites: mergedExcluded
        };
      }

      chrome.storage.sync.set(newSettings, () => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          updateActionBehavior();
          resolve({ success: true });
        }
      });
    });
  });
}

// Check if user has any custom settings (for determining import behavior)
async function checkHasCustomSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['siteSettings', 'excludedSites', 'toggleZoom'], (data) => {
      const hasCustomSites = Object.keys(data.siteSettings || {}).length > 0;
      const hasExclusions = (data.excludedSites?.exact?.length || 0) > 0 ||
                           (data.excludedSites?.patterns?.length || 0) > 0;
      const hasCustomZoom = data.toggleZoom && data.toggleZoom !== 150;

      resolve({
        hasCustomSettings: hasCustomSites || hasExclusions || hasCustomZoom,
        siteCount: Object.keys(data.siteSettings || {}).length,
        exclusionCount: (data.excludedSites?.exact?.length || 0) + (data.excludedSites?.patterns?.length || 0)
      });
    });
  });
}
