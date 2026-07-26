// TagLens - Options page
// Mirrors the name/icon list from the TRACKERS and CMP_PLATFORMS arrays in
// content.js. Kept as a small duplicated list (rather than importing) since
// content scripts can't easily share modules with an extension page without
// a build step - if you add a tracker/CMP in content.js, add it here too.
const TRACKERS = [
  { name: 'Google Tag Manager', icon: '🏷️' },
  { name: 'Google Analytics 4', icon: '📊' },
  { name: 'Google Ads', icon: '💰' },
  { name: 'Universal Analytics', icon: '📈' },
  { name: 'Meta Pixel', icon: '👤' },
  { name: 'TikTok Pixel', icon: '🎵' },
  { name: 'Microsoft Ads (UET)', icon: '🔷' },
  { name: 'LinkedIn Insight', icon: '💼' },
  { name: 'Pinterest Tag', icon: '📌' },
  { name: 'Twitter/X Pixel', icon: '🐦' },
  { name: 'Snapchat Pixel', icon: '👻' },
  { name: 'Hotjar', icon: '🔥' },
  { name: 'Microsoft Clarity', icon: '🔍' },
  { name: 'Matomo/Piwik', icon: '🟢' },
  { name: 'Plausible Analytics', icon: '🌿' },
  { name: 'Adobe Analytics', icon: '🔴' },
  { name: 'HubSpot', icon: '🟠' },
  { name: 'Segment', icon: '🟣' },
  { name: 'Criteo', icon: '🟡' },
  { name: 'Taboola', icon: '📰' },
  { name: 'Outbrain', icon: '📡' }
];

const CMP_PLATFORMS = [
  { name: 'Cookiebot', icon: '🤖' },
  { name: 'Usercentrics', icon: '🛡️' },
  { name: 'OneTrust', icon: '🔒' },
  { name: 'Didomi', icon: '📋' },
  { name: 'Quantcast Choice', icon: '⚖️' },
  { name: 'TrustArc', icon: '✅' },
  { name: 'CookieYes', icon: '🍪' },
  { name: 'Iubenda', icon: '📜' },
  { name: 'Complianz', icon: '🏛️' },
  { name: 'Borlabs Cookie', icon: '🧁' },
  { name: 'Klaro', icon: '🎛️' },
  { name: 'Osano', icon: '🌐' },
  { name: 'Cookie Information', icon: 'ℹ️' },
  { name: 'Termly', icon: '📄' },
  { name: 'CookieFirst', icon: '🥇' },
  { name: 'Consentmanager', icon: '📝' },
  { name: 'Sourcepoint', icon: '🔷' }
];

let disabledDetectors = [];
let customTrackers = [];

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(['disabledDetectors', 'customTrackers'], (data) => {
    disabledDetectors = Array.isArray(data.disabledDetectors) ? data.disabledDetectors : [];
    customTrackers = Array.isArray(data.customTrackers) ? data.customTrackers : [];
    renderChecklist('trackerList', TRACKERS);
    renderChecklist('cmpList', CMP_PLATFORMS);
    renderCustomList();
  });

  document.getElementById('customForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('customName');
    const patternInput = document.getElementById('customPattern');
    const name = nameInput.value.trim();
    const pattern = patternInput.value.trim().toLowerCase();
    if (!name || !pattern) return;
    customTrackers.push({ name, pattern });
    saveCustomTrackers();
    nameInput.value = '';
    patternInput.value = '';
    renderCustomList();
  });
});

function renderChecklist(containerId, items) {
  const container = document.getElementById(containerId);
  container.innerHTML = items.map(item => {
    const id = 'chk_' + item.name.replace(/[^a-z0-9]/gi, '_');
    const checked = !disabledDetectors.includes(item.name);
    return `
      <div class="tl-check-row">
        <input type="checkbox" id="${id}" data-name="${escapeHtml(item.name)}" ${checked ? 'checked' : ''}>
        <label for="${id}">${item.icon} ${escapeHtml(item.name)}</label>
      </div>
    `;
  }).join('');
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const name = cb.dataset.name;
      if (cb.checked) {
        disabledDetectors = disabledDetectors.filter(n => n !== name);
      } else if (!disabledDetectors.includes(name)) {
        disabledDetectors.push(name);
      }
      chrome.storage.sync.set({ disabledDetectors });
    });
  });
}

function renderCustomList() {
  const container = document.getElementById('customList');
  if (customTrackers.length === 0) {
    container.innerHTML = '<div class="tl-opts-empty">No custom trackers added yet.</div>';
    return;
  }
  container.innerHTML = customTrackers.map((t, i) => `
    <div class="tl-custom-item">
      <span><span class="tl-ci-name">${escapeHtml(t.name)}</span><span class="tl-ci-pattern">${escapeHtml(t.pattern)}</span></span>
      <button type="button" data-index="${i}">Remove</button>
    </div>
  `).join('');
  container.querySelectorAll('button[data-index]').forEach(btn => {
    btn.addEventListener('click', () => {
      customTrackers.splice(Number(btn.dataset.index), 1);
      saveCustomTrackers();
      renderCustomList();
    });
  });
}

function saveCustomTrackers() {
  chrome.storage.sync.set({ customTrackers });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
