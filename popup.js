document.addEventListener('DOMContentLoaded', function() {
  // --- Constants ---
  const ZOOM_MIN = 25;
  const ZOOM_MAX = 500;
  const DEFAULT_TOGGLE_ZOOM = 150;
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
  const zoomToggleBtn = document.getElementById('zoomToggleBtn');
  const zoomToggleBtnText = document.getElementById('zoomToggleBtnText');
  const toggleModeCheckbox = document.getElementById('toggleModeCheckbox');
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

  // Exclusion elements
  const exclusionSection = document.getElementById('exclusion-section');
  const excludeOptions = document.getElementById('exclude-options');
  const excludedIndicator = document.getElementById('excluded-indicator');
  const excludeExactBtn = document.getElementById('excludeExactBtn');
  const excludePatternBtn = document.getElementById('excludePatternBtn');
  const excludedReason = document.getElementById('excluded-reason');
  const removeExclusionBtn = document.getElementById('removeExclusionBtn');

  // Import/Export elements
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFileInput = document.getElementById('importFileInput');

  // Current tab state
  let currentHostname = null;
  let currentRootDomain = null;
  let currentExclusionInfo = null;
  let isZoomEnabled = false;

  // Helper to extract root domain from hostname
  function getRootDomain(hostname) {
    if (!hostname) return null;
    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join('.');
  }

  // --- Load Initial State ---
  chrome.storage.sync.get(['toggleZoom', 'toggleModeEnabled', 'isToggledActive', 'siteSettings'], (data) => {
    toggleModeCheckbox.checked = data.toggleModeEnabled || false;
    isZoomEnabled = data.isToggledActive || false;
    zoomLevelInput.value = data.toggleZoom || DEFAULT_TOGGLE_ZOOM;
    updateZoomToggleButton(isZoomEnabled);
    loadCurrentSite(data);
  });

  displayVersion();

  // --- Event Listeners ---

  // Zoom toggle button (enable/disable zoom)
  zoomToggleBtn.addEventListener('click', function() {
    isZoomEnabled = !isZoomEnabled;
    chrome.runtime.sendMessage({ type: "TOGGLE_ZOOM" });
    updateZoomToggleButton(isZoomEnabled);
    showStatus(isZoomEnabled ? 'Zoom enabled!' : 'Zoom disabled!', 'green');
  });

  // 1-Click Mode toggle (icon behavior)
  toggleModeCheckbox.addEventListener('change', function() {
    const isEnabled = this.checked;
    chrome.storage.sync.set({ toggleModeEnabled: isEnabled }, () => {
      chrome.runtime.sendMessage({ type: "SETTINGS_CHANGED" });
      showStatus('Mode updated!', 'green');
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

    chrome.storage.sync.set({ toggleZoom: zoomLevel }, () => {
      if (chrome.runtime.lastError) {
        showStatus('Failed to save settings.', 'red');
        return;
      }

      // If zoom is currently enabled, apply the new level to all tabs
      if (isZoomEnabled) {
        chrome.runtime.sendMessage({
          type: "APPLY_ZOOM_TO_ALL_TABS",
          zoomLevel: zoomLevel
        });
        showStatus(`Zoom set to ${zoomLevel}% on all tabs.`, 'green');
      } else {
        showStatus('Settings saved!', 'green');
      }

      if (shouldClose) {
        setTimeout(() => window.close(), CLOSE_DELAY_MS);
      }
    });
  }

  // --- Helper Functions ---

  function updateZoomToggleButton(isActive) {
    if (zoomToggleBtn) {
      if (isActive) {
        zoomToggleBtn.classList.add('active');
        if (zoomToggleBtnText) zoomToggleBtnText.textContent = 'Zoom Enabled';
      } else {
        zoomToggleBtn.classList.remove('active');
        if (zoomToggleBtnText) zoomToggleBtnText.textContent = 'Enable Zoom';
      }
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
        // Not a zoomable page, hide site section and exclusion section
        if (siteSection) siteSection.style.display = 'none';
        if (exclusionSection) exclusionSection.style.display = 'none';
        return;
      }

      currentHostname = getHostname(tab.url);
      if (!currentHostname) {
        if (siteSection) siteSection.style.display = 'none';
        if (exclusionSection) exclusionSection.style.display = 'none';
        return;
      }

      currentRootDomain = getRootDomain(currentHostname);

      // Show site section
      if (siteSection) siteSection.style.display = 'block';
      if (siteHostname) siteHostname.textContent = currentHostname;

      // Check if site has custom zoom
      const siteSettings = data.siteSettings || {};
      const siteConfig = siteSettings[currentHostname];
      const hasCustomZoom = siteConfig && (siteConfig.toggleZoom || siteConfig.baseZoom);

      if (hasCustomZoom) {
        if (siteIndicator) siteIndicator.classList.add('has-custom');
        if (resetSiteBtn) resetSiteBtn.style.display = 'block';

        // Show what's customized
        const customParts = [];
        if (siteConfig.toggleZoom) customParts.push(`Zoom: ${siteConfig.toggleZoom}%`);
        if (siteConfig.baseZoom) customParts.push(`Base: ${siteConfig.baseZoom}%`);
        if (siteHostname) siteHostname.title = `Custom: ${customParts.join(', ')}`;
      } else {
        if (siteIndicator) siteIndicator.classList.remove('has-custom');
        if (resetSiteBtn) resetSiteBtn.style.display = 'none';
        if (siteHostname) siteHostname.title = 'Using default zoom';
      }

      // Check exclusion status
      checkAndUpdateExclusionUI();
    });
  }

  function checkAndUpdateExclusionUI() {
    if (!currentHostname) return;

    // Show exclusion section immediately (will be populated by response)
    if (exclusionSection) exclusionSection.style.display = 'block';

    // Update button labels with current hostname (in case message fails)
    if (excludeExactBtn) {
      excludeExactBtn.textContent = currentHostname;
    }
    if (excludePatternBtn) {
      excludePatternBtn.textContent = `*.${currentRootDomain}`;
    }

    chrome.runtime.sendMessage(
      { type: "CHECK_EXCLUSION", hostname: currentHostname },
      (response) => {
        if (chrome.runtime.lastError || !response) {
          // On error, default to showing exclude options
          if (excludeOptions) excludeOptions.style.display = 'block';
          if (excludedIndicator) excludedIndicator.style.display = 'none';
          return;
        }

        currentExclusionInfo = response;

        if (response.isExcluded) {
          // Site is excluded - show indicator
          if (excludeOptions) excludeOptions.style.display = 'none';
          if (excludedIndicator) excludedIndicator.style.display = 'flex';

          // Show reason
          if (excludedReason) {
            if (response.isExact) {
              excludedReason.textContent = `${currentHostname} excluded`;
            } else if (response.matchedPattern) {
              excludedReason.textContent = `Matches ${response.matchedPattern}`;
            }
          }
        } else {
          // Site is not excluded - show exclude options
          if (excludeOptions) excludeOptions.style.display = 'block';
          if (excludedIndicator) excludedIndicator.style.display = 'none';

          // Update button labels
          if (excludeExactBtn) {
            excludeExactBtn.textContent = currentHostname;
          }
          if (excludePatternBtn) {
            excludePatternBtn.textContent = `*.${currentRootDomain}`;
          }
        }
      }
    );
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
            chrome.storage.sync.get(['toggleZoom'], (settings) => {
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (tab?.id) {
                  let targetZoom;
                  if (isZoomEnabled) {
                    targetZoom = (settings.toggleZoom || DEFAULT_TOGGLE_ZOOM) / 100;
                  } else {
                    targetZoom = 1.0; // Base zoom default is 100%
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

  // --- Exclusion Button Handlers ---

  // Exclude exact hostname
  if (excludeExactBtn) {
    excludeExactBtn.addEventListener('click', () => {
      if (!currentHostname) return;

      chrome.runtime.sendMessage(
        { type: "ADD_EXCLUSION", hostname: currentHostname, isPattern: false },
        (response) => {
          if (chrome.runtime.lastError) {
            showStatus('Failed to add exclusion', 'red');
            return;
          }
          showStatus(`Excluded ${currentHostname}`, 'green');
          checkAndUpdateExclusionUI();
        }
      );
    });
  }

  // Exclude pattern (*.domain.com)
  if (excludePatternBtn) {
    excludePatternBtn.addEventListener('click', () => {
      if (!currentHostname) return;

      chrome.runtime.sendMessage(
        { type: "ADD_EXCLUSION", hostname: currentHostname, isPattern: true },
        (response) => {
          if (chrome.runtime.lastError) {
            showStatus('Failed to add exclusion', 'red');
            return;
          }
          showStatus(`Excluded *.${currentRootDomain}`, 'green');
          checkAndUpdateExclusionUI();
        }
      );
    });
  }

  // Remove exclusion
  if (removeExclusionBtn) {
    removeExclusionBtn.addEventListener('click', () => {
      if (!currentExclusionInfo) return;

      let value, isPattern;
      if (currentExclusionInfo.isExact) {
        value = currentHostname;
        isPattern = false;
      } else if (currentExclusionInfo.matchedPattern) {
        value = currentExclusionInfo.matchedPattern;
        isPattern = true;
      } else {
        return;
      }

      chrome.runtime.sendMessage(
        { type: "REMOVE_EXCLUSION", value, isPattern },
        (response) => {
          if (chrome.runtime.lastError) {
            showStatus('Failed to remove exclusion', 'red');
            return;
          }
          showStatus('Exclusion removed', 'green');
          checkAndUpdateExclusionUI();
        }
      );
    });
  }

  // --- Import/Export Handlers ---

  // Export settings
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: "EXPORT_SETTINGS" }, (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          showStatus('Export failed', 'red');
          return;
        }

        // Create and download JSON file
        const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `1-click-zoom-settings-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showStatus('Settings exported!', 'green');
      });
    });
  }

  // Import settings
  if (importBtn && importFileInput) {
    importBtn.addEventListener('click', () => {
      importFileInput.click();
    });

    importFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const importData = JSON.parse(event.target.result);

          // Check if user has custom settings
          chrome.runtime.sendMessage({ type: "CHECK_HAS_CUSTOM_SETTINGS" }, (checkResult) => {
            if (chrome.runtime.lastError) {
              showStatus('Import failed', 'red');
              return;
            }

            let mergeMode = 'replace';

            if (checkResult?.hasCustomSettings) {
              // Ask user how to handle import
              const choice = confirm(
                `You have existing settings (${checkResult.siteCount} sites, ${checkResult.exclusionCount} exclusions).\n\n` +
                'Click OK to REPLACE all settings with imported data.\n' +
                'Click Cancel to MERGE (keep existing + add new).'
              );
              mergeMode = choice ? 'replace' : 'merge';
            }

            // Perform import
            chrome.runtime.sendMessage(
              { type: "IMPORT_SETTINGS", settings: importData, mergeMode },
              (importResult) => {
                if (chrome.runtime.lastError || !importResult?.success) {
                  showStatus(importResult?.error || 'Import failed', 'red');
                  return;
                }

                showStatus('Settings imported!', 'green');

                // Reload the popup to reflect new settings
                setTimeout(() => {
                  window.location.reload();
                }, 1000);
              }
            );
          });
        } catch (err) {
          showStatus('Invalid JSON file', 'red');
        }
      };
      reader.readAsText(file);

      // Reset file input
      importFileInput.value = '';
    });
  }
});
