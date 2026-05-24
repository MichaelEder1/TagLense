// Debug UI removed
// TagLens - Popup Script
// Fetches data from content script and renders directly in the popup

let autoRefreshInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  startAutoRefresh();

  document.getElementById('refreshBtn').addEventListener('click', loadData);
});

// Listen for data change notifications from content script
chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;
  if (message.action === 'dataChanged') {
    loadData();
  }
  if (message.action === 'dataUpdate' && message.payload) {
    try {
      renderData(message.payload);
      pulseIndicator();
    } catch (e) { /* ignore */ }
  }
});

function startAutoRefresh() {
  // Refresh every 3 seconds to catch consent/cookie changes
  autoRefreshInterval = setInterval(loadData, 3000);
}

function loadData() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) {
      showError('No active tab found');
      return;
    }

    const tab = tabs[0];
    document.getElementById('urlBar').textContent = truncateUrl(tab.url);
    document.getElementById('urlBar').title = tab.url;

    chrome.tabs.sendMessage(tab.id, { action: 'getData' }, (response) => {
      if (chrome.runtime.lastError) {
        showError('Cannot access this page. Try refreshing the page first.');
        return;
      }
      if (response) {
        renderData(response);
        pulseIndicator();
      }
    });
  });
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    const display = u.hostname + path;
    return display.length > 50 ? display.substring(0, 50) + '...' : display;
  } catch (e) {
    return url;
  }
}

function pulseIndicator() {
  const dot = document.getElementById('liveDot');
  dot.classList.remove('tl-pulse');
  void dot.offsetWidth; // Force reflow
  dot.classList.add('tl-pulse');
}

function showError(msg) {
  document.getElementById('content').innerHTML = `
    <div class="tl-error">
      <span class="tl-error-icon">⚠️</span>
      <span>${msg}</span>
    </div>
  `;
}

function renderData(data) {
  const content = document.getElementById('content');
  content.innerHTML = '';

  // Trackers Section
  content.appendChild(buildSection(
    '🔎', 'Tracking Scripts', data.detectedTrackers.length,
    data.detectedTrackers.length === 0
      ? '<div class="tl-empty">No tracking scripts detected</div>'
      : data.detectedTrackers.map(t => `
          <div class="tl-item">
            <span class="tl-item-icon">${t.icon}</span>
            <div class="tl-item-info">
              <span class="tl-item-name">${escapeHtml(t.name)}</span>
              <span class="tl-item-id">${escapeHtml(t.ids.join(', '))}</span>
            </div>
          </div>
        `).join('')
  ));

  // CMP Section
  content.appendChild(buildSection(
    '🛡️', 'Consent Management', data.detectedCMPs.length,
    data.detectedCMPs.length === 0
      ? '<div class="tl-empty">No CMP detected</div>'
      : data.detectedCMPs.map(c => `
          <div class="tl-item">
            <span class="tl-item-icon">${c.icon}</span>
            <div class="tl-item-info">
              <span class="tl-item-name">${escapeHtml(c.name)}</span>
              <span class="tl-item-id">${escapeHtml(c.id)}</span>
            </div>
          </div>
        `).join('')
  ));

  // Consent States Section
  content.appendChild(buildSection(
    '⚙️', 'Google Consent Mode v2', null,
    `<div class="tl-consent-grid">
      ${data.consentStates.map(c => `
        <div class="tl-consent-card">
          <div class="tl-consent-label">${escapeHtml(c.label)}</div>
          <div class="tl-consent-value tl-consent-${c.state.replace(/\s/g, '-')}" title="${escapeHtml(c.description)}">
            <span class="tl-consent-dot"></span>
            ${escapeHtml(c.state)}
          </div>
        </div>
      `).join('')}
    </div>`
  ));

  // Cookies Section
  content.appendChild(buildSection(
    '🍪', 'Cookies', data.cookies.length,
    data.cookies.length === 0
      ? '<div class="tl-empty">No cookies found</div>'
      : `<div class="tl-cookies-scroll">
          ${data.cookies.map(c => `
            <div class="tl-cookie-row">
              <span class="tl-cookie-name" title="${escapeHtml(c.value)}">${escapeHtml(c.name)}</span>
              <span class="tl-cookie-svc ${c.service === 'Unknown' ? 'tl-unknown' : ''}">${escapeHtml(c.service)}</span>
            </div>
          `).join('')}
        </div>`
  ));

  // Make sections collapsible
  content.querySelectorAll('.tl-section-head').forEach(header => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('collapsed');
    });
  });
}

function buildSection(icon, title, count, bodyHtml) {
  const section = document.createElement('div');
  section.className = 'tl-section';
  section.innerHTML = `
    <div class="tl-section-head">
      <div class="tl-section-left">
        <span class="tl-section-icon">${icon}</span>
        <span class="tl-section-title">${title}</span>
      </div>
      <div class="tl-section-right">
        ${count !== null ? `<span class="tl-badge">${count}</span>` : ''}
        <span class="tl-chevron">‹</span>
      </div>
    </div>
    <div class="tl-section-body">
      ${bodyHtml}
    </div>
  `;
  return section;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
