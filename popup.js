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

  // --- Get DOM Elements ---
  const toggleModeCheckbox = document.getElementById('toggleModeCheckbox');
  const configTitle = document.getElementById('config-title');
  const zoomLevelInput = document.getElementById('zoomLevel');
  const saveButton = document.getElementById('saveButton');
  const statusDiv = document.getElementById('status');
  const presetButtons = document.querySelectorAll('.preset-btn');
  const versionInfoDiv = document.getElementById('version-info');

  // --- Load Initial State ---
  chrome.storage.sync.get(['globalZoom', 'toggleZoom', 'toggleModeEnabled'], (data) => {
    toggleModeCheckbox.checked = data.toggleModeEnabled || false;
    updateUI(data.toggleModeEnabled, data);
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
    const targetZoomFactor = zoomLevel / 100;

    chrome.windows.getAll({ populate: true, windowTypes: ['normal', 'app'] }, (windows) => {
      windows.forEach((win) => {
        win.tabs.forEach((tab) => {
          if (isZoomableUrl(tab.url)) {
            // Smart Check: Only set zoom if it's different from the target.
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
});
