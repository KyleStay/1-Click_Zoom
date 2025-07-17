document.addEventListener('DOMContentLoaded', function() {
  // --- Get DOM Elements ---
  const toggleModeCheckbox = document.getElementById('toggleModeCheckbox');
  const configTitle = document.getElementById('config-title');
  const zoomLevelInput = document.getElementById('zoomLevel');
  const saveButton = document.getElementById('saveButton');
  const statusDiv = document.getElementById('status');
  const presetButtons = document.querySelectorAll('.preset-btn');

  // --- Load Initial State ---
  chrome.storage.sync.get(['globalZoom', 'toggleZoom', 'toggleModeEnabled'], (data) => {
    toggleModeCheckbox.checked = data.toggleModeEnabled || false;
    updateUI(data.toggleModeEnabled, data);
  });

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
            // Give a moment for the user to see the status update before closing.
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

    // Get all normal browser windows, and populate them with their tabs.
    chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }, (windows) => {
        // Iterate over each window.
        windows.forEach((win) => {
            // Iterate over each tab in the window.
            win.tabs.forEach((tab) => {
                // Check if the tab has a web URL before trying to set zoom.
                if (tab.url && (tab.url.startsWith('http') || tab.url.startsWith('https'))) {
                    // Set zoom, ignoring errors for tabs that can't be zoomed.
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
   * Displays a status message to the user.
   * @param {string} message - The text to display.
   * @param {string} color - The color of the text.
   */
  function showStatus(message, color) {
    statusDiv.textContent = message;
    statusDiv.style.color = color;
    // Set a timeout to clear the message, but don't worry if the window closes first.
    setTimeout(() => {
      if(statusDiv) {
          statusDiv.textContent = '';
      }
    }, 2500);
  }
});
