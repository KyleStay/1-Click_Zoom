document.addEventListener('DOMContentLoaded', function() {
  // --- Constants ---
  const ZOOM_MIN = 25;
  const ZOOM_MAX = 500;
  const STATUS_DISPLAY_MS = 2000;
  const DEBOUNCE_SAVE_MS = 500;

  // --- DOM Elements ---
  const siteListEl = document.getElementById('site-list');
  const emptyStateEl = document.getElementById('empty-state');
  const clearAllBtn = document.getElementById('clear-all-btn');
  const siteCountEl = document.getElementById('site-count');
  const statusEl = document.getElementById('status');
  const defaultToggleEl = document.getElementById('default-toggle');

  // Tab elements
  const tabs = document.querySelectorAll('.tab');
  const zoomTab = document.getElementById('zoom-tab');
  const exclusionsTab = document.getElementById('exclusions-tab');

  // Exclusion elements
  const exclusionListEl = document.getElementById('exclusion-list');
  const exclusionEmptyStateEl = document.getElementById('exclusion-empty-state');
  const exclusionCountEl = document.getElementById('exclusion-count');
  const clearAllExclusionsBtn = document.getElementById('clear-all-exclusions-btn');
  const exclusionInput = document.getElementById('exclusion-input');
  const exclusionTypeSelect = document.getElementById('exclusion-type');
  const addExclusionBtn = document.getElementById('add-exclusion-btn');

  // Import/Export elements
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFileInput = document.getElementById('importFileInput');

  // Debounce timers for input changes
  const saveTimers = new Map();

  // --- Tab Switching ---
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const tabName = tab.dataset.tab;
      if (tabName === 'zoom') {
        zoomTab.classList.add('active');
        exclusionsTab.classList.remove('active');
      } else {
        zoomTab.classList.remove('active');
        exclusionsTab.classList.add('active');
        loadExclusions(); // Refresh exclusions when tab is opened
      }
    });
  });

  // --- Load and Render ---
  loadSites();
  loadExclusions();

  function loadSites() {
    chrome.storage.sync.get(['toggleZoom', 'siteSettings'], (data) => {
      const toggleZoom = data.toggleZoom || 150;
      const siteSettings = data.siteSettings || {};

      // Update defaults display
      if (defaultToggleEl) defaultToggleEl.textContent = toggleZoom;

      renderSites(siteSettings, toggleZoom);
    });
  }

  function renderSites(siteSettings, defaultToggle) {
    const sites = Object.keys(siteSettings).sort();
    const count = sites.length;

    // Update count
    if (siteCountEl) {
      siteCountEl.textContent = count === 0 ? '' : `${count} site${count !== 1 ? 's' : ''}`;
    }

    // Toggle empty state
    if (emptyStateEl) {
      emptyStateEl.style.display = count === 0 ? 'block' : 'none';
    }

    // Enable/disable clear all button
    if (clearAllBtn) {
      clearAllBtn.disabled = count === 0;
    }

    // Clear existing list
    if (siteListEl) {
      siteListEl.innerHTML = '';

      // Render each site
      sites.forEach(hostname => {
        const config = siteSettings[hostname];
        const card = createSiteCard(hostname, config, defaultToggle);
        siteListEl.appendChild(card);
      });
    }
  }

  function createSiteCard(hostname, config, defaultToggle) {
    const card = document.createElement('div');
    card.className = 'site-card';
    card.dataset.hostname = hostname;

    card.innerHTML = `
      <div class="site-header">
        <span class="site-hostname">${escapeHtml(hostname)}</span>
        <button class="delete-btn" title="Delete site">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
        </button>
      </div>
      <div class="zoom-inputs">
        <div class="zoom-field">
          <label>Zoom Level</label>
          <div class="zoom-input-wrapper">
            <input type="number" class="zoom-input toggle-zoom"
                   min="${ZOOM_MIN}" max="${ZOOM_MAX}"
                   placeholder="${defaultToggle}"
                   value="${config.toggleZoom || ''}">
            <span class="zoom-suffix">%</span>
            <button class="clear-field-btn" data-field="toggleZoom" title="Clear (use default)">&times;</button>
          </div>
        </div>
        <div class="zoom-field">
          <label>Base Zoom</label>
          <div class="zoom-input-wrapper">
            <input type="number" class="zoom-input base-zoom"
                   min="${ZOOM_MIN}" max="${ZOOM_MAX}"
                   placeholder="100"
                   value="${config.baseZoom || ''}">
            <span class="zoom-suffix">%</span>
            <button class="clear-field-btn" data-field="baseZoom" title="Clear (use default)">&times;</button>
          </div>
        </div>
      </div>
    `;

    // Delete button handler
    card.querySelector('.delete-btn').addEventListener('click', () => {
      deleteSite(hostname);
    });

    // Input change handlers with debounce
    const toggleInput = card.querySelector('.toggle-zoom');
    const baseInput = card.querySelector('.base-zoom');

    toggleInput.addEventListener('input', () => {
      debouncedSave(hostname, 'toggleZoom', toggleInput.value);
    });

    baseInput.addEventListener('input', () => {
      debouncedSave(hostname, 'baseZoom', baseInput.value);
    });

    // Clear field buttons
    card.querySelectorAll('.clear-field-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = btn.dataset.field;
        const input = field === 'toggleZoom' ? toggleInput : baseInput;
        input.value = '';
        debouncedSave(hostname, field, '');
      });
    });

    return card;
  }

  function debouncedSave(hostname, field, value) {
    const key = `${hostname}-${field}`;
    clearTimeout(saveTimers.get(key));
    saveTimers.set(key, setTimeout(() => {
      saveSiteField(hostname, field, value);
      saveTimers.delete(key);
    }, DEBOUNCE_SAVE_MS));
  }

  function saveSiteField(hostname, field, value) {
    chrome.storage.sync.get(['toggleZoom', 'siteSettings'], (data) => {
      const siteSettings = data.siteSettings || {};
      const defaultToggle = data.toggleZoom || 150;
      const defaultBase = 100; // Base zoom default is always 100%

      if (!siteSettings[hostname]) {
        siteSettings[hostname] = {};
      }

      const parsedValue = parseInt(value, 10);

      if (value === '' || isNaN(parsedValue)) {
        // Clear the field
        delete siteSettings[hostname][field];
      } else if (parsedValue < ZOOM_MIN || parsedValue > ZOOM_MAX) {
        showStatus(`Invalid zoom (${ZOOM_MIN}-${ZOOM_MAX}%)`, true);
        return;
      } else {
        // Check if it matches the default
        const defaultValue = field === 'toggleZoom' ? defaultToggle : defaultBase;

        if (parsedValue === defaultValue) {
          // Remove since it matches default
          delete siteSettings[hostname][field];
        } else {
          siteSettings[hostname][field] = parsedValue;
        }
      }

      // Clean up empty site entries
      if (Object.keys(siteSettings[hostname]).length === 0) {
        delete siteSettings[hostname];
        // Remove the card from UI
        const card = document.querySelector(`.site-card[data-hostname="${hostname}"]`);
        if (card) {
          card.remove();
          updateCount(Object.keys(siteSettings).length);
        }
      }

      chrome.storage.sync.set({ siteSettings }, () => {
        if (chrome.runtime.lastError) {
          showStatus('Failed to save', true);
        } else {
          showStatus('Saved');
        }
      });
    });
  }

  function deleteSite(hostname) {
    chrome.storage.sync.get('siteSettings', (data) => {
      const siteSettings = data.siteSettings || {};

      if (siteSettings[hostname]) {
        delete siteSettings[hostname];

        chrome.storage.sync.set({ siteSettings }, () => {
          if (chrome.runtime.lastError) {
            showStatus('Failed to delete', true);
          } else {
            showStatus(`Deleted ${hostname}`);
            loadSites(); // Refresh the list
          }
        });
      }
    });
  }

  // Clear all button handler
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all site-specific zoom settings?')) {
        chrome.storage.sync.set({ siteSettings: {} }, () => {
          if (chrome.runtime.lastError) {
            showStatus('Failed to clear', true);
          } else {
            showStatus('All sites cleared');
            loadSites();
          }
        });
      }
    });
  }

  // --- Helper Functions ---

  function updateCount(count) {
    if (siteCountEl) {
      siteCountEl.textContent = count === 0 ? '' : `${count} site${count !== 1 ? 's' : ''}`;
    }
    if (emptyStateEl) {
      emptyStateEl.style.display = count === 0 ? 'block' : 'none';
    }
    if (clearAllBtn) {
      clearAllBtn.disabled = count === 0;
    }
  }

  function showStatus(message, isError = false) {
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.style.background = isError ? '#cf222e' : '#1f2328';
      statusEl.classList.add('show');
      setTimeout(() => {
        statusEl.classList.remove('show');
      }, STATUS_DISPLAY_MS);
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // --- Exclusion Functions ---

  function loadExclusions() {
    chrome.storage.sync.get('excludedSites', (data) => {
      const excludedSites = data.excludedSites || { exact: [], patterns: [] };
      renderExclusions(excludedSites);
    });
  }

  function renderExclusions(excludedSites) {
    const exactCount = excludedSites.exact?.length || 0;
    const patternCount = excludedSites.patterns?.length || 0;
    const totalCount = exactCount + patternCount;

    // Update count
    if (exclusionCountEl) {
      exclusionCountEl.textContent = totalCount === 0 ? '' : `${totalCount} exclusion${totalCount !== 1 ? 's' : ''}`;
    }

    // Toggle empty state
    if (exclusionEmptyStateEl) {
      exclusionEmptyStateEl.style.display = totalCount === 0 ? 'block' : 'none';
    }

    // Enable/disable clear all button
    if (clearAllExclusionsBtn) {
      clearAllExclusionsBtn.disabled = totalCount === 0;
    }

    // Clear existing list
    if (exclusionListEl) {
      exclusionListEl.innerHTML = '';

      // Render exact exclusions
      excludedSites.exact?.sort().forEach(hostname => {
        const card = createExclusionCard(hostname, 'exact');
        exclusionListEl.appendChild(card);
      });

      // Render pattern exclusions
      excludedSites.patterns?.sort().forEach(pattern => {
        const card = createExclusionCard(pattern, 'pattern');
        exclusionListEl.appendChild(card);
      });
    }
  }

  function createExclusionCard(value, type) {
    const card = document.createElement('div');
    card.className = 'exclusion-card';

    card.innerHTML = `
      <div class="exclusion-value">
        <span>${escapeHtml(value)}</span>
        <span class="exclusion-type ${type}">${type === 'exact' ? 'Exact' : 'Pattern'}</span>
      </div>
      <button class="delete-btn" title="Remove exclusion">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
      </button>
    `;

    // Delete button handler
    card.querySelector('.delete-btn').addEventListener('click', () => {
      removeExclusion(value, type === 'pattern');
    });

    return card;
  }

  function addExclusion(value, isPattern) {
    if (!value.trim()) {
      showStatus('Please enter a hostname', true);
      return;
    }

    chrome.runtime.sendMessage(
      { type: "ADD_EXCLUSION", hostname: value.trim(), isPattern },
      (response) => {
        if (chrome.runtime.lastError) {
          showStatus('Failed to add exclusion', true);
          return;
        }
        showStatus(`Added ${isPattern ? '*.' + value.trim() : value.trim()}`);
        loadExclusions();
        if (exclusionInput) exclusionInput.value = '';
      }
    );
  }

  function removeExclusion(value, isPattern) {
    chrome.runtime.sendMessage(
      { type: "REMOVE_EXCLUSION", value, isPattern },
      (response) => {
        if (chrome.runtime.lastError) {
          showStatus('Failed to remove exclusion', true);
          return;
        }
        showStatus(`Removed ${value}`);
        loadExclusions();
      }
    );
  }

  // Add exclusion button handler
  if (addExclusionBtn) {
    addExclusionBtn.addEventListener('click', () => {
      const value = exclusionInput?.value || '';
      const isPattern = exclusionTypeSelect?.value === 'pattern';
      addExclusion(value, isPattern);
    });
  }

  // Handle Enter key in exclusion input
  if (exclusionInput) {
    exclusionInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const value = exclusionInput.value || '';
        const isPattern = exclusionTypeSelect?.value === 'pattern';
        addExclusion(value, isPattern);
      }
    });
  }

  // Clear all exclusions button handler
  if (clearAllExclusionsBtn) {
    clearAllExclusionsBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all site exclusions?')) {
        chrome.storage.sync.set({ excludedSites: { exact: [], patterns: [] } }, () => {
          if (chrome.runtime.lastError) {
            showStatus('Failed to clear', true);
          } else {
            showStatus('All exclusions cleared');
            loadExclusions();
          }
        });
      }
    });
  }

  // --- Import/Export Handlers ---

  // Export settings
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: "EXPORT_SETTINGS" }, (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          showStatus('Export failed', true);
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

        showStatus('Settings exported!');
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
              showStatus('Import failed', true);
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
                  showStatus(importResult?.error || 'Import failed', true);
                  return;
                }

                showStatus('Settings imported!');

                // Reload the page to reflect new settings
                setTimeout(() => {
                  window.location.reload();
                }, 1000);
              }
            );
          });
        } catch (err) {
          showStatus('Invalid JSON file', true);
        }
      };
      reader.readAsText(file);

      // Reset file input
      importFileInput.value = '';
    });
  }
});
