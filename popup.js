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

  displayVersion();

  // --- Event Listeners ---

  toggleModeCheckbox.addEventListener('change', function() {
    const isEnabled = this.checked;
    chrome.storage.sync.set({ toggleModeEnabled: isEnabled }, () => {
      chrome.storage.sync.get(['globalZoom', 'toggleZoom'], (data) => {
        updateUI(isEnabled, data);
        chrome.runtime.sendMessage({ type: "SETTINGS_CHANGED" });
        showStatus('Mode updated!', 'green');

        applyGlobalZoomToAllTabs(100, false);
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
    const zoomLevel = parseInt(zoomValue);
    if (zoomLevel >= 25 && zoomLevel <= 500) {
      const isToggleMode = toggleModeCheckbox.checked;
      const keyToSave = isToggleMode ? 'toggleZoom' : 'globalZoom';

      chrome.storage.sync.set({ [keyToSave]: zoomLevel }, () => {
        if (!isToggleMode) {
          applyGlobalZoomToAllTabs(zoomLevel, shouldClose);
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

  function applyGlobalZoomToAllTabs(zoomLevel, shouldClose) {
    const targetZoomFactor = zoomLevel / 100;

    chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }, (windows) => {
        windows.forEach((win) => {
            win.tabs.forEach((tab) => {
                if (tab.url && (tab.url.startsWith('http') || tab.url.startsWith('https'))) {
                    // Smart Check: Only set zoom if it's different from the target.
                    chrome.tabs.getZoom(tab.id, (currentZoomFactor) => {
                        if (Math.abs(currentZoomFactor - targetZoomFactor) > 0.01) {
                            chrome.tabs.setZoom(tab.id, targetZoomFactor).catch((error) => {
                                console.error(`Could not set zoom for tab ${tab.id}: ${error.message}`);
                            });
                        }
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

  function updateUI(isEnabled, data) {
    if (isEnabled) {
      configTitle.textContent = 'Set 1-Click Zoom Level';
      zoomLevelInput.value = data.toggleZoom || 150;
    } else {
      configTitle.textContent = 'Set Global Zoom Level';
      zoomLevelInput.value = data.globalZoom || 100;
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
          if(statusDiv) {
              statusDiv.textContent = '';
          }
        }, 2500);
    }
  }
});
