document.addEventListener('DOMContentLoaded', function() {
  // --- Constants ---
  const ZOOM_MIN = 25;
  const ZOOM_MAX = 500;
  const DEFAULT_GLOBAL_ZOOM = 100;
  const DEFAULT_TOGGLE_ZOOM = 150;
  const ZOOM_DIFF_THRESHOLD = 0.01;
  const STATUS_DISPLAY_MS = 2500;
  const CLOSE_DELAY_MS = 300;
  const VALID_URL_PREFIXES = ['http', 'file'];

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

  // --- Get DOM Elements ---
  const toggleModeCheckbox = document.getElementById('toggleModeCheckbox');
  const configTitle = document.getElementById('config-title');
  const zoomLevelInput = document.getElementById('zoomLevel');
  const saveButton = document.getElementById('saveButton');
  const statusDiv = document.getElementById('status');
  const presetButtons = document.querySelectorAll('.preset-btn');
  const versionInfoDiv = document.getElementById('version-info');
  const siteSection = document.getElementById('site-section');
  const siteIndicator = document.getElementById('site-indicator');
  const siteHostname = document.getElementById('site-hostname');
  const resetSiteBtn = document.getElementById('resetSiteBtn');
  const manageSitesBtn = document.getElementById('manageSitesBtn');

  // Current tab state
  let currentHostname = null;

  // --- Load Initial State ---
  chrome.storage.sync.get(['globalZoom', 'toggleZoom', 'toggleModeEnabled', 'siteSettings'], (data) => {
    toggleModeCheckbox.checked = data.toggleModeEnabled || false;
    updateUI(data.toggleModeEnabled, data);
    loadCurrentSite(data);
  });

  displayVersion();

  // --- Event Listeners ---

  toggleModeCheckbox.addEventListener('change', function() {
    const isEnabled = this.checked;
    chrome.storage.sync.set({ toggleModeEnabled: isEnabled }, () => {
      chrome.storage.sync.get(['globalZoom', 'toggleZoom'], (data) => {
        updateUI(isEnabled, data);
        chrome.runtime.sendMessage({ type: "SETTINGS_CHANGED" });
        showStatus('Mode updated!', 'green');

        applyGlobalZoomToAllTabs(DEFAULT_GLOBAL_ZOOM, false);
      });
    });
  });

  presetButtons.forEach(button => {
    button.addEventListener('click', function() {
      const zoomValue = this.getAttribute('data-zoom');
      zoomLevelInput.value = zoomValue;
      saveAndApply(zoomValue, false);
    });
  });

  saveButton.addEventListener('click', function() {
    saveAndApply(zoomLevelInput.value, true);
  });

  // --- Core Logic Function ---

  function saveAndApply(zoomValue, shouldClose) {
    const zoomLevel = parseInt(zoomValue, 10);

    // Validate input is a valid number within range
    if (isNaN(zoomLevel)) {
      showStatus('Please enter a valid number.', 'red');
      return;
    }

    if (zoomLevel < ZOOM_MIN || zoomLevel > ZOOM_MAX) {
      showStatus(`Invalid range (${ZOOM_MIN}-${ZOOM_MAX}).`, 'red');
      return;
    }

    const isToggleMode = toggleModeCheckbox.checked;
    const keyToSave = isToggleMode ? 'toggleZoom' : 'globalZoom';

    chrome.storage.sync.set({ [keyToSave]: zoomLevel }, () => {
      if (chrome.runtime.lastError) {
        showStatus('Failed to save settings.', 'red');
        return;
      }

      if (!isToggleMode) {
        applyGlobalZoomToAllTabs(zoomLevel, shouldClose);
      } else {
        showStatus('Settings saved!', 'green');
        if (shouldClose) {
          setTimeout(() => window.close(), CLOSE_DELAY_MS);
        }
      }
    });
  }

  // --- Helper Functions ---

  function applyGlobalZoomToAllTabs(zoomLevel, shouldClose) {
    // Send message to background.js to apply zoom (so it's tracked and won't trigger manual zoom save)
    chrome.runtime.sendMessage({
      type: "APPLY_ZOOM_TO_ALL_TABS",
      zoomLevel: zoomLevel
    });

    showStatus(`Zoom set to ${zoomLevel}% on all tabs.`, 'green');

    if (shouldClose) {
      setTimeout(() => window.close(), CLOSE_DELAY_MS);
    }
  }

  function updateUI(isEnabled, data) {
    if (isEnabled) {
      configTitle.textContent = 'Set 1-Click Zoom Level';
      zoomLevelInput.value = data.toggleZoom || DEFAULT_TOGGLE_ZOOM;
    } else {
      configTitle.textContent = 'Set Global Zoom Level';
      zoomLevelInput.value = data.globalZoom || DEFAULT_GLOBAL_ZOOM;
    }
  }

  function displayVersion() {
      const manifest = chrome.runtime.getManifest();
      if (versionInfoDiv) {
        versionInfoDiv.textContent = `v${manifest.version}`;
      }
  }

  function showStatus(message, color) {
    if (statusDiv) {
      statusDiv.textContent = message;
      statusDiv.style.color = color;
      setTimeout(() => {
        if (statusDiv) {
          statusDiv.textContent = '';
        }
      }, STATUS_DISPLAY_MS);
    }
  }

  // --- Site-specific Functions ---

  function loadCurrentSite(data) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.url || !isZoomableUrl(tab.url)) {
        // Not a zoomable page, hide site section
        if (siteSection) siteSection.style.display = 'none';
        return;
      }

      currentHostname = getHostname(tab.url);
      if (!currentHostname) {
        if (siteSection) siteSection.style.display = 'none';
        return;
      }

      // Show site section
      if (siteSection) siteSection.style.display = 'block';
      if (siteHostname) siteHostname.textContent = currentHostname;

      // Check if site has custom zoom
      const siteSettings = data.siteSettings || {};
      const siteConfig = siteSettings[currentHostname];
      const hasCustomZoom = siteConfig && (siteConfig.globalZoom || siteConfig.toggleZoom);

      if (hasCustomZoom) {
        if (siteIndicator) siteIndicator.classList.add('has-custom');
        if (resetSiteBtn) resetSiteBtn.style.display = 'block';

        // Show what's customized
        const customParts = [];
        if (siteConfig.globalZoom) customParts.push(`Global: ${siteConfig.globalZoom}%`);
        if (siteConfig.toggleZoom) customParts.push(`Toggle: ${siteConfig.toggleZoom}%`);
        if (siteHostname) siteHostname.title = `Custom: ${customParts.join(', ')}`;
      } else {
        if (siteIndicator) siteIndicator.classList.remove('has-custom');
        if (resetSiteBtn) resetSiteBtn.style.display = 'none';
        if (siteHostname) siteHostname.title = 'Using default zoom';
      }
    });
  }

  // Reset site button handler
  if (resetSiteBtn) {
    resetSiteBtn.addEventListener('click', () => {
      if (!currentHostname) return;

      chrome.storage.sync.get('siteSettings', (data) => {
        const siteSettings = data.siteSettings || {};

        if (siteSettings[currentHostname]) {
          delete siteSettings[currentHostname];

          chrome.storage.sync.set({ siteSettings }, () => {
            showStatus('Site reset to defaults', 'green');

            // Update UI
            if (siteIndicator) siteIndicator.classList.remove('has-custom');
            if (resetSiteBtn) resetSiteBtn.style.display = 'none';
            if (siteHostname) siteHostname.title = 'Using default zoom';

            // Re-apply default zoom to current tab
            chrome.storage.sync.get(['globalZoom', 'toggleZoom', 'toggleModeEnabled', 'isToggledActive'], (settings) => {
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (tab?.id) {
                  let targetZoom;
                  if (settings.toggleModeEnabled && settings.isToggledActive) {
                    targetZoom = (settings.toggleZoom || DEFAULT_TOGGLE_ZOOM) / 100;
                  } else if (!settings.toggleModeEnabled) {
                    targetZoom = (settings.globalZoom || DEFAULT_GLOBAL_ZOOM) / 100;
                  } else {
                    targetZoom = 1.0;
                  }
                  chrome.tabs.setZoom(tab.id, targetZoom);
                }
              });
            });
          });
        }
      });
    });
  }

  // Manage sites button handler
  if (manageSitesBtn) {
    manageSitesBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'sites.html' });
    });
  }
});
