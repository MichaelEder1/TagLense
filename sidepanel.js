// TagLens - Side panel script
// Unlike the old popup (which reloaded fresh every time it was opened), a
// side panel document stays alive across tab switches and navigations. So
// this script has to actively track which tab is "current" and re-render
// whenever that tab changes or navigates, not just on its own open.

let currentTabId = null;
let autoRefreshInterval = null;
let lastData = null;
let searchQuery = '';

// renderData() rebuilds every section from scratch on every refresh (live
// pushes can fire many times a minute), so any collapse/expand the user did
// by hand has to be captured before the rebuild and re-applied after -
// otherwise a section snaps back to its hardcoded default on the very next
// update, which is especially jarring for a fast-moving one like DataLayer
// Events. Keyed by section title; only used for sections the user has
// actually touched, everything else keeps its normal default.
const collapsedState = {};

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  startAutoRefresh();
  document.getElementById('refreshBtn').addEventListener('click', loadData);
  document.getElementById('exportBtn').addEventListener('click', exportReport);
  document.getElementById('clearDataBtn').addEventListener('click', handleClearDataClick);

  const searchInput = document.getElementById('searchInput');
  const searchClearBtn = document.getElementById('searchClearBtn');
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    searchClearBtn.hidden = !searchQuery;
    if (lastData) renderData(lastData);
  });
  searchClearBtn.addEventListener('click', () => {
    searchQuery = '';
    searchInput.value = '';
    searchClearBtn.hidden = true;
    searchInput.focus();
    if (lastData) renderData(lastData);
  });
});

// A section's items are shown as-is when there's no active search; when
// searching, only items whose searchable text contains the query survive,
// and the section is hidden entirely if nothing in it matches.
function matchesSearch(text) {
  if (!searchQuery) return true;
  return text.toLowerCase().includes(searchQuery);
}

// Background broadcasts this whenever any tab's detection state changes.
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.action === 'dataChanged') loadData();
});

// Follow the user as they switch tabs or navigate within the active tab.
chrome.tabs.onActivated.addListener(() => loadData());
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active) return;
  if (changeInfo.status === 'complete' || changeInfo.url) loadData();
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  loadData();
});

function startAutoRefresh() {
  // Safety net in case a push notification is missed - the panel can stay
  // open for a long time, so keep this infrequent.
  autoRefreshInterval = setInterval(loadData, 8000);
}

function loadData() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) {
      showError('No active tab found');
      return;
    }

    const tab = tabs[0];
    currentTabId = tab.id;
    document.getElementById('urlBar').textContent = truncateUrl(tab.url);
    document.getElementById('urlBar').title = tab.url;

    if (!/^https?:/i.test(tab.url || '')) {
      showError('TagLens only inspects http(s) pages.');
      return;
    }

    // Background is the source of truth: it merges DOM findings from every
    // frame with network-observed trackers and the real cookie jar.
    chrome.runtime.sendMessage({ action: 'getTabData', tabId: tab.id }, (response) => {
      if (chrome.runtime.lastError) {
        showError('Cannot access this page. Try refreshing the page first.');
        return;
      }
      if (response) {
        lastData = response;
        renderData(response);
        pulseIndicator();
      } else {
        showError('No data yet - try refreshing the page.');
      }
    });
  });
}

function truncateUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return u.hostname + path;
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

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.hidden = false;
  void toast.offsetWidth;
  toast.classList.add('tl-show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.classList.remove('tl-show');
    setTimeout(() => { toast.hidden = true; }, 250);
  }, 2200);
}

function showError(msg) {
  document.getElementById('content').innerHTML = `
    <div class="tl-error">
      <span class="tl-error-icon">⚠️</span>
      <span>${escapeHtml(msg)}</span>
    </div>
  `;
}

// ============================================================
// Header actions
// ============================================================
function exportReport() {
  if (!lastData) { showToast('Nothing to export yet'); return; }
  const report = {
    url: lastData.url,
    exportedAt: new Date().toISOString(),
    trackers: lastData.detectedTrackers,
    cmps: lastData.detectedCMPs,
    consentStates: lastData.consentStates,
    consentSource: lastData.consentSource,
    tcf: lastData.tcf || null,
    cookies: lastData.cookies,
    activity: lastData.events || [],
    dataLayerEvents: lastData.dataLayerEvents || []
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const host = (() => { try { return new URL(lastData.url).hostname; } catch (e) { return 'report'; } })();
  const a = document.createElement('a');
  a.href = url;
  a.download = `taglens-${host}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast('Report downloaded');
}

function handleClearDataClick() {
  if (!currentTabId) return;
  // A native confirm() is a single unambiguous step - no custom double-click
  // timing window to get wrong, no state to fall out of sync.
  const ok = window.confirm('Clear cookies, cache, and storage for this site? The page will reload.');
  if (!ok) return;

  // If background never responds (service worker died mid-flight, message
  // port closed, ...) the button would otherwise just look dead with no
  // feedback at all - always resolve one way or another.
  let settled = false;
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    showToast('Clear timed out - try again');
  }, 10000);

  chrome.runtime.sendMessage({ action: 'clearSiteData', tabId: currentTabId }, (resp) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (chrome.runtime.lastError || !resp || !resp.ok) {
      showToast('Could not clear site data');
      return;
    }
    showToast('Site data cleared - page reloaded');
    loadData();
  });
}

// ============================================================
// Rendering
// ============================================================
function renderData(data) {
  const content = document.getElementById('content');

  // Capture whatever the user currently has collapsed/expanded before we
  // blow the DOM away and rebuild it.
  content.querySelectorAll('.tl-section').forEach(sec => {
    const title = sec.querySelector('.tl-section-title');
    if (title) collapsedState[title.textContent] = sec.classList.contains('collapsed');
  });

  content.innerHTML = '';

  // Activity Section
  const allEvents = data.events || [];
  const events = allEvents.filter(ev => matchesSearch(ev.label));
  content.appendChild(buildSection(
    '📡', 'Activity', events.length,
    events.length === 0
      ? `<div class="tl-empty">${searchQuery ? 'No activity matches "' + escapeHtml(searchQuery) + '"' : 'No changes yet - this updates live as you browse'}</div>`
      : events.map(ev => `
          <div class="tl-activity-row">
            <span class="tl-activity-dot tl-kind-${ev.kind}"></span>
            <div class="tl-activity-body">
              <div class="tl-activity-label">${escapeHtml(ev.label)}</div>
              <div class="tl-activity-time">${relativeTime(ev.ts)}</div>
            </div>
          </div>
        `).join(''),
    allEvents.length === 0
  ));

  // Trackers Section
  const allTrackers = data.detectedTrackers;
  const trackers = allTrackers.filter(t => matchesSearch(t.name + ' ' + (t.ids || []).join(' ')));
  content.appendChild(buildSection(
    '🔎', 'Tracking Scripts', trackers.length,
    trackers.length === 0
      ? `<div class="tl-empty">${searchQuery ? 'No trackers match "' + escapeHtml(searchQuery) + '"' : 'No tracking scripts detected'}</div>`
      : trackers.map(t => {
          const sources = t.sources || [];
          const idText = t.ids && t.ids.length ? t.ids.join(', ') : 'Detected';
          const viaNetworkOnly = sources.includes('network') && !sources.includes('script');
          const tags = [];
          if (viaNetworkOnly) tags.push('<span class="tl-source-tag" title="Only seen as a network request, not in the page DOM - typically means it fired after a consent action or via server-side tagging">network</span>');
          if (t.consentWarning) tags.push(`<span class="tl-warning-tag">⚠ ${escapeHtml(t.consentWarning.label)} denied</span>`);
          return `
          <div class="tl-item">
            <span class="tl-item-icon">${t.icon}</span>
            <div class="tl-item-info">
              <span class="tl-item-name">${escapeHtml(t.name)}</span>
              <span class="tl-item-id">${escapeHtml(idText)}</span>
            </div>
            ${tags.length ? `<div class="tl-item-tags">${tags.join('')}</div>` : ''}
          </div>
        `;
        }).join('')
  ));

  // CMP Section
  const allCmps = data.detectedCMPs;
  const cmps = allCmps.filter(c => matchesSearch(c.name + ' ' + c.id));
  content.appendChild(buildSection(
    '🛡️', 'Consent Management', cmps.length,
    cmps.length === 0
      ? `<div class="tl-empty">${searchQuery ? 'No CMPs match "' + escapeHtml(searchQuery) + '"' : 'No CMP detected'}</div>`
      : cmps.map(c => `
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
    `<div class="tl-consent-source">${data.consentSource ? 'Source: ' + escapeHtml(data.consentSource) : 'No consent signal detected yet'}</div>
    <div class="tl-consent-grid">
      ${data.consentStates.map(c => `
        <div class="tl-consent-card">
          <div class="tl-consent-label">${escapeHtml(c.label)}</div>
          <div class="tl-consent-value tl-consent-${c.state.replace(/\s/g, '-')}" title="${escapeHtml(c.description)}">
            <span class="tl-consent-dot"></span>
            ${escapeHtml(c.state)}
          </div>
        </div>
      `).join('')}
    </div>
    <div class="tl-consent-legend">
      <span><span class="tl-legend-dot" style="background:var(--granted)"></span>Granted - storage/tracking allowed</span>
      <span><span class="tl-legend-dot" style="background:var(--denied)"></span>Denied - explicitly blocked</span>
      <span><span class="tl-legend-dot" style="background:var(--not-set)"></span>Not set - no signal observed (page may not implement Consent Mode)</span>
    </div>`
  ));

  // IAB TCF v2 Section - only when a CMP actually implements it
  if (data.tcf) {
    const tcf = data.tcf;
    const purposeLabels = {
      1: 'Store/access info on device', 2: 'Select basic ads', 3: 'Create ad profiles',
      4: 'Select personalised ads', 5: 'Create content profiles', 6: 'Select personalised content',
      7: 'Measure ad performance', 8: 'Measure content performance', 9: 'Audience research',
      10: 'Develop & improve products'
    };
    const purposeKeys = Object.keys(tcf.purposeConsents || {}).sort((a, b) => Number(a) - Number(b));
    content.appendChild(buildSection(
      '📜', 'IAB TCF v2', null,
      `<div class="tl-tcf-meta">
        <span>GDPR applies: ${tcf.gdprApplies ? 'Yes' : 'No'}</span>
        <span>Vendors consented: ${tcf.vendorGranted}/${tcf.vendorTotal}</span>
        ${tcf.cmpId ? `<span>CMP ID: ${escapeHtml(String(tcf.cmpId))}</span>` : ''}
      </div>
      <div class="tl-tcf-purposes">
        ${purposeKeys.map(k => `
          <div class="tl-tcf-purpose">
            <span>${escapeHtml(purposeLabels[k] || ('Purpose ' + k))}</span>
            <span class="tl-consent-dot" style="background:${tcf.purposeConsents[k] ? 'var(--granted)' : 'var(--denied)'}"></span>
          </div>
        `).join('')}
      </div>`
    ));
  }

  // Cookies Section
  const allCookies = data.cookies;
  const cookies = allCookies.filter(c => matchesSearch(c.name + ' ' + c.service + ' ' + c.domain));
  content.appendChild(buildSection(
    '🍪', 'Cookies', cookies.length,
    cookies.length === 0
      ? `<div class="tl-empty">${searchQuery ? 'No cookies match "' + escapeHtml(searchQuery) + '"' : 'No cookies found'}</div>`
      : cookies.map(c => {
          return `
          <div class="tl-cookie-row">
            <div class="tl-cookie-main">
              <span class="tl-cookie-name" title="${escapeHtml(c.value)}">
                <span>${escapeHtml(c.name)}</span>
                ${c.httpOnly ? '<span class="tl-http-only-tag" title="Not readable by page JavaScript (document.cookie) - only visible via the browser cookie jar">httpOnly</span>' : ''}
              </span>
              <span class="tl-cookie-svc ${c.service === 'Unknown' ? 'tl-unknown' : ''}">${escapeHtml(c.service)}</span>
            </div>
            <div class="tl-cookie-meta">
              <span class="tl-party-tag ${c.firstParty ? 'tl-first-party' : 'tl-third-party'}">${c.firstParty ? '1st-party' : '3rd-party'}</span>
              <span>${escapeHtml(c.domain)}</span>
              <span>SameSite: ${escapeHtml(c.sameSite || 'unspecified')}</span>
              <span>Expires: ${escapeHtml(c.expiry)}</span>
              ${c.secure ? '<span>Secure</span>' : ''}
            </div>
          </div>
        `;
        }).join('')
  ));

  // DataLayer Events Section (debug feed - collapsed by default, it's a
  // power-user tool for checking what a page is actually sending to GTM).
  // Everything here is shown directly, nothing behind a hover tooltip.
  const allDlEvents = data.dataLayerEvents || [];
  const dlEvents = allDlEvents.filter(e => matchesSearch(e.name + ' ' + JSON.stringify(e.params || {})));
  content.appendChild(buildSection(
    '📨', 'DataLayer Events', dlEvents.length,
    dlEvents.length === 0
      ? `<div class="tl-empty">${searchQuery ? 'No events match "' + escapeHtml(searchQuery) + '"' : 'No dataLayer.push() calls seen yet'}</div>`
      : dlEvents.map(e => {
          const paramKeys = Object.keys(e.params || {});
          const paramRows = paramKeys.map(k => `
            <div class="tl-dl-param-row">
              <span class="tl-dl-param-key">${escapeHtml(k)}</span>
              <span class="tl-dl-param-val">${escapeHtml(formatParamValue(e.params[k]))}</span>
            </div>
          `).join('');
          return `
          <div class="tl-dl-row">
            <div class="tl-dl-head">
              <span class="tl-dl-name">${escapeHtml(e.name)}</span>
              <span class="tl-activity-time">${relativeTime(e.ts)}</span>
            </div>
            ${paramRows ? `<div class="tl-dl-params">${paramRows}</div>` : '<div class="tl-dl-params tl-dl-empty">(no params)</div>'}
          </div>
        `;
        }).join(''),
    true
  ));

  content.querySelectorAll('.tl-section-head').forEach(header => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('collapsed');
    });
    header.setAttribute('tabindex', '0');
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); header.click(); }
    });
  });
}

function formatParamValue(v) {
  let s;
  if (v && typeof v === 'object') {
    try { s = JSON.stringify(v); } catch (e) { s = String(v); }
  } else {
    s = String(v);
  }
  // Nothing here is behind a hover/tooltip, so don't truncate so hard that
  // the value becomes useless - just wrap long ones instead (see CSS).
  return s.length > 300 ? s.slice(0, 300) + '…' : s;
}

function relativeTime(ts) {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 10000) return 'just now';
  if (diff < 60000) return Math.floor(diff / 1000) + 's ago';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return new Date(ts).toLocaleDateString();
}

function buildSection(icon, title, count, bodyHtml, defaultCollapsed) {
  const section = document.createElement('div');
  // While actively searching, force open any section with a match so
  // results aren't hidden behind a collapsed header - collapsedState (the
  // user's own manual choice) takes back over the instant the search is
  // cleared. Otherwise: respect whatever the user last had this section
  // set to, only falling back to the caller's default the very first time
  // a section with this title is ever rendered.
  const collapsed = searchQuery
    ? count === 0
    : (Object.prototype.hasOwnProperty.call(collapsedState, title) ? collapsedState[title] : !!defaultCollapsed);
  section.className = 'tl-section' + (collapsed ? ' collapsed' : '');
  section.innerHTML = `
    <div class="tl-section-head">
      <div class="tl-section-left">
        <span class="tl-section-icon">${icon}</span>
        <span class="tl-section-title">${title}</span>
      </div>
      <div class="tl-section-right">
        ${count !== null ? `<span class="tl-badge">${count}</span>` : ''}
        <span class="tl-chevron">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </span>
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
