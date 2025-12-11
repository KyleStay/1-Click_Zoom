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
  const defaultGlobalEl = document.getElementById('default-global');
  const defaultToggleEl = document.getElementById('default-toggle');

  // Debounce timers for input changes
  const saveTimers = new Map();

  // --- Load and Render ---
  loadSites();

  function loadSites() {
    chrome.storage.sync.get(['globalZoom', 'toggleZoom', 'siteSettings'], (data) => {
      const globalZoom = data.globalZoom || 100;
      const toggleZoom = data.toggleZoom || 150;
      const siteSettings = data.siteSettings || {};

      // Update defaults display
      if (defaultGlobalEl) defaultGlobalEl.textContent = globalZoom;
      if (defaultToggleEl) defaultToggleEl.textContent = toggleZoom;

      renderSites(siteSettings, globalZoom, toggleZoom);
    });
  }

  function renderSites(siteSettings, defaultGlobal, defaultToggle) {
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
        const card = createSiteCard(hostname, config, defaultGlobal, defaultToggle);
        siteListEl.appendChild(card);
      });
    }
  }

  function createSiteCard(hostname, config, defaultGlobal, defaultToggle) {
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
          <label>Global Zoom</label>
          <div class="zoom-input-wrapper">
            <input type="number" class="zoom-input global-zoom"
                   min="${ZOOM_MIN}" max="${ZOOM_MAX}"
                   placeholder="${defaultGlobal}"
                   value="${config.globalZoom || ''}">
            <span class="zoom-suffix">%</span>
            <button class="clear-field-btn" data-field="globalZoom" title="Clear (use default)">&times;</button>
          </div>
        </div>
        <div class="zoom-field">
          <label>Toggle Zoom</label>
          <div class="zoom-input-wrapper">
            <input type="number" class="zoom-input toggle-zoom"
                   min="${ZOOM_MIN}" max="${ZOOM_MAX}"
                   placeholder="${defaultToggle}"
                   value="${config.toggleZoom || ''}">
            <span class="zoom-suffix">%</span>
            <button class="clear-field-btn" data-field="toggleZoom" title="Clear (use default)">&times;</button>
          </div>
        </div>
      </div>
    `;

    // Delete button handler
    card.querySelector('.delete-btn').addEventListener('click', () => {
      deleteSite(hostname);
    });

    // Input change handlers with debounce
    const globalInput = card.querySelector('.global-zoom');
    const toggleInput = card.querySelector('.toggle-zoom');

    globalInput.addEventListener('input', () => {
      debouncedSave(hostname, 'globalZoom', globalInput.value);
    });

    toggleInput.addEventListener('input', () => {
      debouncedSave(hostname, 'toggleZoom', toggleInput.value);
    });

    // Clear field buttons
    card.querySelectorAll('.clear-field-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const field = btn.dataset.field;
        const input = field === 'globalZoom' ? globalInput : toggleInput;
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
    chrome.storage.sync.get(['globalZoom', 'toggleZoom', 'siteSettings'], (data) => {
      const siteSettings = data.siteSettings || {};
      const defaultGlobal = data.globalZoom || 100;
      const defaultToggle = data.toggleZoom || 150;

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
        const defaultValue = field === 'globalZoom' ? defaultGlobal : defaultToggle;
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
});
