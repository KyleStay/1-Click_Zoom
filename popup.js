document.addEventListener('DOMContentLoaded', function() {
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

  // Display the extension version
  displayVersion();

  // --- Event Listeners ---

  // When the toggle switch is changed
  toggleModeCheckbox.addEventListener('change', function() {
    const isEnabled = this.checked;
    chrome.storage.sync.set({ toggleModeEnabled: isEnabled }, () => {
      chrome.storage.sync.get(['globalZoom', 'toggleZoom'], (data) => {
        updateUI(isEnabled, data);
        chrome.runtime.sendMessage({ type: "SETTINGS_CHANGED" });
        showStatus('Mode updated!', 'green');
      });
    });
  });

  // Clicking a preset immediately saves and applies the setting without closing.
  presetButtons.forEach(button => {
    button.addEventListener('click', function() {
      const zoomValue = this.getAttribute('data-zoom');
      zoomLevelInput.value = zoomValue; // Update the input for visual feedback
      saveAndApply(zoomValue, false); // Save but do not close the window.
    });
  });

  // The save button now saves, applies, and closes the popup.
  saveButton.addEventListener('click', function() {
    saveAndApply(zoomLevelInput.value, true); // Save and close the window.
  });

  // --- Core Logic Function ---

  /**
   * Saves the zoom value and optionally closes the window.
   * @param {string|number} zoomValue The zoom level to save.
   * @param {boolean} shouldClose - Whether to close the popup after saving.
   */
  function saveAndApply(zoomValue, shouldClose) {
    const zoomLevel = parseInt(zoomValue);
    if (zoomLevel >= 25 && zoomLevel <= 500) {
      const isToggleMode = toggleModeCheckbox.checked;
      const keyToSave = isToggleMode ? 'toggleZoom' : 'globalZoom';

      chrome.storage.sync.set({ [keyToSave]: zoomLevel }, () => {
        if (!isToggleMode) {
          applyGlobalZoomToAllTabs(zoomLevel, shouldClose); // Pass shouldClose here
        } else {
          showStatus('Settings saved!', 'green');
          if (shouldClose) {
            setTimeout(() => window.close(), 300);
          }
        }
      });
    } else {
      showStatus('Invalid range (25-500).', 'red');
    }
  }

  // --- Helper Functions ---

  /**
   * Applies the new global zoom setting to all open web tabs in all windows.
   * @param {number} zoomLevel - The zoom level in percent (e.g., 150).
   * @param {boolean} shouldClose - Whether to close the popup after applying.
   */
  function applyGlobalZoomToAllTabs(zoomLevel, shouldClose) {
    const zoomFactor = zoomLevel / 100;

    chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }, (windows) => {
        windows.forEach((win) => {
            win.tabs.forEach((tab) => {
                if (tab.url && (tab.url.startsWith('http') || tab.url.startsWith('https'))) {
                    chrome.tabs.setZoom(tab.id, zoomFactor).catch((error) => {
                        console.error(`Could not set zoom for tab ${tab.id}: ${error.message}`);
                    });
                }
            });
        });
    });

    showStatus(`Zoom set to ${zoomLevel}% on all tabs.`, 'green');

    if (shouldClose) {
      setTimeout(() => window.close(), 300);
    }
  }

  /**
   * Updates the popup's UI based on whether 1-Click mode is enabled.
   * @param {boolean} isEnabled - Is 1-Click mode on?
   * @param {object} data - The stored zoom data.
   */
  function updateUI(isEnabled, data) {
    if (isEnabled) {
      configTitle.textContent = 'Set 1-Click Zoom Level';
      zoomLevelInput.value = data.toggleZoom || 150;
    } else {
      configTitle.textContent = 'Set Global Zoom Level';
      zoomLevelInput.value = data.globalZoom || 100;
    }
  }

  /**
   * Gets the version from the manifest and displays it in the popup.
   */
  function displayVersion() {
      const manifest = chrome.runtime.getManifest();
      versionInfoDiv.textContent = `v${manifest.version}`;
  }

  /**
   * Displays a status message to the user.
   * @param {string} message - The text to display.
   * @param {string} color - The color of the text.
   */
  function showStatus(message, color) {
    statusDiv.textContent = message;
    statusDiv.style.color = color;
    setTimeout(() => {
      if(statusDiv) {
          statusDiv.textContent = '';
      }
    }, 2500);
  }
});
