// TagLens - Background service worker
// Source of truth for per-tab detection state. Aggregates:
//  - DOM findings reported by content scripts in every frame of a tab
//  - Network-observed trackers (via webRequest) - catches beacon/pixel requests
//    that never show up in the DOM (e.g. tags that only fire after consent accept)
//  - Real cookie data (via chrome.cookies) - sees httpOnly cookies that
//    document.cookie in the content script never could
//  - SPA soft-navigation (via webNavigation.onHistoryStateUpdated) - more robust
//    than relying on the page's own history.pushState being monkey-patchable

// Clicking the toolbar icon opens the side panel directly instead of a popup.
try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch (e) { /* ignore */ }

// ============================================================
// NETWORK TRACKER PATTERNS
// Mirrors the tracker list in content.js (names must match so the popup can
// merge DOM- and network-detected entries for the same tracker).
// ============================================================
// Many tags fired from *inside* a GTM container (GA4, Ads, UET, ...) never
// create a matching <script> element or a readable inline gtag() call - GTM's
// own bundle sends the hit directly via fetch/beacon. The request URL itself
// is often the only place the actual tag ID survives (e.g. ?tid=G-XXXX on
// the GA4 collect endpoint), so each entry can optionally extract it.
function idFromQuery(url, param, idPattern) {
  try {
    const re = new RegExp('[?&]' + param + '=([^&]+)', 'i');
    const m = url.match(re);
    if (!m) return null;
    const val = decodeURIComponent(m[1]);
    if (idPattern) { const im = val.match(idPattern); return im ? im[0] : null; }
    return val;
  } catch (e) { return null; }
}
function idFromPath(url, pathPattern) {
  try { const m = url.match(pathPattern); return m ? m[1] : null; } catch (e) { return null; }
}

const NETWORK_TRACKERS = [
  { name: 'Google Tag Manager', icon: '🏷️', patterns: ['googletagmanager.com/gtm.js'], extractId: (url) => idFromQuery(url, 'id', /GTM-[A-Z0-9]+/) },
  { name: 'Google Analytics 4', icon: '📊', patterns: ['googletagmanager.com/gtag/js', 'google-analytics.com/g/collect', 'analytics.google.com/g/collect'], extractId: (url) => idFromQuery(url, 'tid', /G-[A-Z0-9]+/) || idFromQuery(url, 'id', /G-[A-Z0-9]+/) },
  { name: 'Google Ads', icon: '💰', patterns: ['googleadservices.com', 'googlesyndication.com', 'googleads.g.doubleclick.net', 'doubleclick.net'], extractId: (url) => idFromQuery(url, 'tid', /AW-[0-9]+/) || idFromQuery(url, 'id', /AW-[0-9]+/) || idFromPath(url, /\/pagead\/conversion\/(\d+)/) },
  { name: 'Universal Analytics', icon: '📈', patterns: ['google-analytics.com/analytics.js', 'google-analytics.com/ga.js', 'google-analytics.com/collect'], extractId: (url) => idFromQuery(url, 'tid', /UA-[0-9]+-[0-9]+/) },
  { name: 'Meta Pixel', icon: '👤', patterns: ['connect.facebook.net', 'facebook.com/tr'], extractId: (url) => idFromQuery(url, 'id', /\d{10,}/) },
  { name: 'TikTok Pixel', icon: '🎵', patterns: ['analytics.tiktok.com'], extractId: (url) => idFromQuery(url, 'sdkid') || idFromQuery(url, 'pixel_code') },
  { name: 'Microsoft Ads (UET)', icon: '🔷', patterns: ['bat.bing.com'], extractId: (url) => idFromQuery(url, 'ti', /\d+/) },
  { name: 'LinkedIn Insight', icon: '💼', patterns: ['snap.licdn.com', 'px.ads.linkedin.com'], extractId: (url) => idFromQuery(url, 'pid', /\d+/) },
  { name: 'Pinterest Tag', icon: '📌', patterns: ['pinimg.com/ct', 'ct.pinterest.com'], extractId: (url) => idFromQuery(url, 'tid', /\d+/) },
  { name: 'Twitter/X Pixel', icon: '🐦', patterns: ['static.ads-twitter.com', 't.co/i/adsct', 'analytics.twitter.com'] },
  { name: 'Snapchat Pixel', icon: '👻', patterns: ['sc-static.net/scevent', 'tr.snapchat.com'], extractId: (url) => idFromQuery(url, 'pid', /[a-f0-9-]{6,}/) },
  { name: 'Hotjar', icon: '🔥', patterns: ['static.hotjar.com', 'script.hotjar.com', 'in.hotjar.com'], extractId: (url) => idFromPath(url, /hotjar-(\d+)/) },
  { name: 'Microsoft Clarity', icon: '🔍', patterns: ['clarity.ms'], extractId: (url) => idFromPath(url, /clarity\.ms\/tag\/([a-z0-9]+)/i) },
  { name: 'Plausible Analytics', icon: '🌿', patterns: ['plausible.io'] },
  { name: 'Adobe Analytics', icon: '🔴', patterns: ['omtrdc.net', 'adobedtm.com', '2o7.net'] },
  { name: 'HubSpot', icon: '🟠', patterns: ['js.hs-scripts.com', 'js.hsforms.net', 'api.hubspot.com', 'track.hubspot.com'], extractId: (url) => idFromPath(url, /hs-scripts\.com\/(\d+)/) },
  { name: 'Segment', icon: '🟣', patterns: ['cdn.segment.com', 'api.segment.io'] },
  { name: 'Criteo', icon: '🟡', patterns: ['static.criteo.net', 'dis.criteo.com'] },
  { name: 'Taboola', icon: '📰', patterns: ['cdn.taboola.com', 'trc.taboola.com'] },
  { name: 'Outbrain', icon: '📡', patterns: ['outbrain.com'] }
];

function matchNetworkTrackers(url) {
  const matches = [];
  for (const t of NETWORK_TRACKERS) {
    if (t.patterns.some(p => url.includes(p))) {
      let id = null;
      if (t.extractId) { try { id = t.extractId(url); } catch (e) { id = null; } }
      matches.push({ name: t.name, icon: t.icon, id });
    }
  }
  for (const t of userOptions.customTrackers) {
    if (t.pattern && url.includes(t.pattern)) matches.push({ name: t.name, icon: '🔧', id: null });
  }
  return matches;
}

// ============================================================
// USER OPTIONS (options page) - which built-in detectors are disabled and
// any custom domain patterns the user added. Cached in memory, refreshed on
// chrome.storage.onChanged so an open tab picks up edits without reloading.
// ============================================================
const userOptions = { disabledDetectors: [], customTrackers: [] };

function loadUserOptions() {
  try {
    chrome.storage.sync.get(['disabledDetectors', 'customTrackers'], (data) => {
      if (chrome.runtime.lastError) return;
      userOptions.disabledDetectors = Array.isArray(data.disabledDetectors) ? data.disabledDetectors : [];
      userOptions.customTrackers = Array.isArray(data.customTrackers) ? data.customTrackers : [];
    });
  } catch (e) { /* ignore */ }
}
loadUserOptions();
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && (changes.disabledDetectors || changes.customTrackers)) loadUserOptions();
  });
} catch (e) { /* ignore */ }

// ============================================================
// COOKIE -> SERVICE MAPPING (moved here from content.js since only
// background/extension pages can use chrome.cookies)
// ============================================================
const COOKIE_SERVICE_MAP = {
  '_ga': 'Google Analytics', '_ga_': 'Google Analytics 4', '_gid': 'Google Analytics', '_gat': 'Google Analytics',
  '_gcl_au': 'Google Ads', '_gcl_aw': 'Google Ads', '_gac_': 'Google Ads',
  '_fbp': 'Meta/Facebook', '_fbc': 'Meta/Facebook', 'fr': 'Meta/Facebook',
  '_ttp': 'TikTok', '_tt_enable_cookie': 'TikTok',
  'MUID': 'Microsoft', '_uetsid': 'Microsoft Ads', '_uetvid': 'Microsoft Ads',
  '_clck': 'Microsoft Clarity', '_clsk': 'Microsoft Clarity',
  'li_sugr': 'LinkedIn', 'bcookie': 'LinkedIn', 'lidc': 'LinkedIn',
  '_pin_unauth': 'Pinterest',
  'IDE': 'Google DoubleClick', 'test_cookie': 'Google DoubleClick',
  'NID': 'Google', '1P_JAR': 'Google', 'CONSENT': 'Google',
  '_hjid': 'Hotjar', '_hjSessionUser': 'Hotjar', '_hjSession': 'Hotjar', '_hjAbsoluteSessionInProgress': 'Hotjar',
  'hubspotutk': 'HubSpot', '__hssc': 'HubSpot', '__hssrc': 'HubSpot', '__hstc': 'HubSpot',
  'CookieConsent': 'Cookiebot', 'OptanonConsent': 'OneTrust', 'OptanonAlertBoxClosed': 'OneTrust',
  'eupubconsent-v2': 'IAB TCF v2', 'didomi_token': 'Didomi', 'uc_settings': 'Usercentrics',
  'ajs_anonymous_id': 'Segment', 'mp_': 'Mixpanel', 'amplitude_id': 'Amplitude',
  '_pk_id': 'Matomo', '_pk_ses': 'Matomo', 'crit': 'Criteo', 'cto_bundle': 'Criteo',
  '__adroll': 'AdRoll', '_scid': 'Snapchat', 'sc_at': 'Snapchat',
  'personalization_id': 'Twitter/X', 'guest_id': 'Twitter/X',
  'YSC': 'YouTube', 'VISITOR_INFO1_LIVE': 'YouTube',
  'wp-settings': 'WordPress', 'wordpress_logged_in': 'WordPress',
  'PHPSESSID': 'PHP Session', 'JSESSIONID': 'Java Session', 'ASP.NET_SessionId': 'ASP.NET Session',
  'cf_clearance': 'Cloudflare', '__cf_bm': 'Cloudflare'
};

function getServiceForCookie(name) {
  if (COOKIE_SERVICE_MAP[name]) return COOKIE_SERVICE_MAP[name];
  for (const [prefix, service] of Object.entries(COOKIE_SERVICE_MAP)) {
    if (prefix.endsWith('_') && name.startsWith(prefix)) return service;
  }
  return null;
}

const DEFAULT_CONSENT_CATEGORIES = [
  { key: 'ad_storage', label: 'Ad Storage', description: 'Enables storage for advertising' },
  { key: 'analytics_storage', label: 'Analytics Storage', description: 'Enables storage for analytics' },
  { key: 'ad_user_data', label: 'Ad User Data', description: 'User data for advertising' },
  { key: 'ad_personalization', label: 'Ad Personalization', description: 'Personalized advertising' },
  { key: 'functionality_storage', label: 'Functionality Storage', description: 'Enables functional storage' },
  { key: 'personalization_storage', label: 'Personalization Storage', description: 'Enables personalization storage' }
];

// ============================================================
// PER-TAB STATE
// ============================================================
const tabState = new Map(); // tabId -> state

function freshTabState() {
  return { frames: {}, networkTrackers: {}, url: null, events: [], seenTrackers: [], lastConsent: null };
}

async function getTabState(tabId) {
  if (tabState.has(tabId)) return tabState.get(tabId);
  try {
    const stored = await chrome.storage.session.get('tab_' + tabId);
    const state = stored['tab_' + tabId] || freshTabState();
    tabState.set(tabId, state);
    return state;
  } catch (e) {
    const state = freshTabState();
    tabState.set(tabId, state);
    return state;
  }
}

function persistTabState(tabId, state) {
  try { chrome.storage.session.set({ ['tab_' + tabId]: state }); } catch (e) { /* ignore */ }
}

function resetTabState(tabId, url) {
  const state = freshTabState();
  state.url = url || null;
  tabState.set(tabId, state);
  persistTabState(tabId, state);
}

// Debounced popup notification so bursts of webRequest hits don't spam messages
let notifyTimer = null;
function broadcastChange() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    try { chrome.runtime.sendMessage({ action: 'dataChanged' }).catch(() => {}); } catch (e) { /* ignore */ }
  }, 400);
}

// ============================================================
// NETWORK-BASED TRACKER DETECTION
// ============================================================
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const matches = matchNetworkTrackers(details.url);
    if (!matches.length) return;
    (async () => {
      const state = await getTabState(details.tabId);
      let changed = false;
      matches.forEach(m => {
        if (!state.networkTrackers[m.name]) {
          state.networkTrackers[m.name] = { icon: m.icon, ids: [] };
          changed = true;
        }
        if (m.id && !state.networkTrackers[m.name].ids.includes(m.id)) {
          state.networkTrackers[m.name].ids.push(m.id);
          changed = true;
        }
      });
      if (changed) {
        persistTabState(details.tabId, state);
        await processTabUpdate(details.tabId, state);
        broadcastChange();
      }
    })();
  },
  { urls: ['<all_urls>'] }
);

// ============================================================
// NAVIGATION HANDLING
// ============================================================

// Real top-level navigation to a new document: start fresh.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  resetTabState(details.tabId, details.url);
  try { chrome.action.setBadgeText({ tabId: details.tabId, text: '' }); } catch (e) { /* ignore */ }
});

// SPA soft-navigation (History API route change): don't wipe state (scripts
// already loaded are still active), just ask content scripts in the tab to
// re-run DOM detection immediately instead of waiting for their next poll.
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  (async () => {
    const state = await getTabState(details.tabId);
    state.url = details.url;
    persistTabState(details.tabId, state);
  })();
  try { chrome.tabs.sendMessage(details.tabId, { action: 'forceRecheck' }).catch(() => {}); } catch (e) { /* ignore */ }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
  try { chrome.storage.session.remove('tab_' + tabId); } catch (e) { /* ignore */ }
});

// ============================================================
// COOKIES (real cookie jar, including httpOnly - document.cookie can't see those)
// ============================================================
async function getCookiesForTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url || !/^https?:/i.test(tab.url)) return [];
    const cookies = await chrome.cookies.getAll({ url: tab.url });
    return cookies
      .map(c => ({
        name: c.name,
        value: c.value.length > 60 ? c.value.substring(0, 60) + '...' : c.value,
        domain: c.domain,
        httpOnly: c.httpOnly,
        secure: c.secure,
        service: getServiceForCookie(c.name) || 'Unknown'
      }))
      .sort((a, b) => {
        if (a.service === 'Unknown' && b.service !== 'Unknown') return 1;
        if (a.service !== 'Unknown' && b.service === 'Unknown') return -1;
        return a.service.localeCompare(b.service);
      });
  } catch (e) {
    return [];
  }
}

chrome.cookies.onChanged.addListener(() => {
  // Cookie set/removed anywhere - cheap to just let the popup refresh if open.
  broadcastChange();
});

// ============================================================
// AGGREGATE SNAPSHOT
// ============================================================

// Pure merge of whatever is currently known about a tab - no side effects,
// safe to call as often as needed (badge updates, event logging, renders).
function computeMergedSnapshot(state) {
  const trackerMap = new Map();
  let consentStates = null;
  let consentSource = null;
  const cmpMap = new Map();
  let tcf = null;

  const frameIds = Object.keys(state.frames).map(Number).sort((a, b) => a - b);
  frameIds.forEach(frameId => {
    const f = state.frames[frameId];
    if (!f) return;
    (f.detectedTrackers || []).forEach(t => {
      const existing = trackerMap.get(t.name) || { name: t.name, icon: t.icon, ids: [], sources: [] };
      (t.ids || []).forEach(id => { if (!existing.ids.includes(id)) existing.ids.push(id); });
      if (!existing.sources.includes('script')) existing.sources.push('script');
      trackerMap.set(t.name, existing);
    });
    (f.detectedCMPs || []).forEach(c => {
      if (!cmpMap.has(c.name)) cmpMap.set(c.name, c);
    });
    // Prefer the top frame's consent reading; fall back to the first frame
    // that actually resolved an explicit state.
    const hasExplicit = f.consentStates && f.consentStates.some(c => c.state !== 'not set');
    if (hasExplicit && (frameId === 0 || !consentStates)) {
      consentStates = f.consentStates;
      consentSource = f.consentSource || null;
    }
    if (f.tcf && !tcf) tcf = f.tcf;
  });

  if (!consentStates) {
    const top = state.frames[0];
    consentStates = (top && top.consentStates) || DEFAULT_CONSENT_CATEGORIES.map(c => ({ ...c, state: 'not set' }));
    consentSource = (top && top.consentSource) || null;
  }

  Object.entries(state.networkTrackers || {}).forEach(([name, info]) => {
    const existing = trackerMap.get(name);
    if (existing) {
      if (!existing.sources.includes('network')) existing.sources.push('network');
      (info.ids || []).forEach(id => { if (!existing.ids.includes(id)) existing.ids.push(id); });
    } else {
      trackerMap.set(name, { name, icon: info.icon, ids: (info.ids || []).slice(), sources: ['network'] });
    }
  });

  userOptions.disabledDetectors.forEach(name => { trackerMap.delete(name); cmpMap.delete(name); });

  return {
    detectedTrackers: Array.from(trackerMap.values()),
    detectedCMPs: Array.from(cmpMap.values()),
    consentStates,
    consentSource,
    tcf
  };
}

const CONSENT_LABELS = Object.fromEntries(DEFAULT_CONSENT_CATEGORIES.map(c => [c.key, c.label]));

function pushEvent(state, kind, label) {
  state.events = state.events || [];
  state.events.unshift({ ts: Date.now(), kind, label });
  if (state.events.length > 30) state.events.length = 30;
}

// Diffs the current merged snapshot against what this tab has shown before,
// logging "new tracker" / "consent changed" events and updating the toolbar
// badge. Called on every state-changing event (frame report, network hit),
// not just when the panel asks for data, so the log/badge stay live even if
// the panel isn't open.
async function processTabUpdate(tabId, state) {
  const snap = computeMergedSnapshot(state);
  let changed = false;

  state.seenTrackers = state.seenTrackers || [];
  snap.detectedTrackers.forEach(t => {
    if (!state.seenTrackers.includes(t.name)) {
      state.seenTrackers.push(t.name);
      pushEvent(state, 'tracker', `${t.icon} ${t.name} detected${t.sources.includes('network') && !t.sources.includes('script') ? ' (network)' : ''}`);
      changed = true;
    }
  });

  if (state.lastConsent) {
    snap.consentStates.forEach(c => {
      const prev = state.lastConsent[c.key];
      if (prev && prev !== c.state && c.state !== 'not set') {
        pushEvent(state, 'consent', `${CONSENT_LABELS[c.key] || c.key}: ${prev} → ${c.state}`);
        changed = true;
      }
    });
  }
  state.lastConsent = Object.fromEntries(snap.consentStates.map(c => [c.key, c.state]));

  if (changed) persistTabState(tabId, state);

  try {
    const count = snap.detectedTrackers.length;
    chrome.action.setBadgeText({ tabId, text: count ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#7c3aed' });
  } catch (e) { /* ignore */ }

  return snap;
}

async function buildTabSnapshot(tabId) {
  const state = await getTabState(tabId);
  const snap = await processTabUpdate(tabId, state);
  const cookies = await getCookiesForTab(tabId);

  return {
    detectedTrackers: snap.detectedTrackers,
    detectedCMPs: snap.detectedCMPs,
    consentStates: snap.consentStates,
    consentSource: snap.consentSource,
    tcf: snap.tcf,
    cookies,
    events: state.events || [],
    url: state.url,
    timestamp: Date.now()
  };
}

// ============================================================
// MESSAGE ROUTING
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return false;

  if (message.action === 'frameDetection') {
    const tabId = sender && sender.tab && sender.tab.id;
    if (tabId == null) return false;
    const frameId = sender.frameId || 0;
    (async () => {
      const state = await getTabState(tabId);
      state.frames[frameId] = message.payload || {};
      if (frameId === 0 && message.payload && message.payload.url) {
        state.url = message.payload.url;
      }
      persistTabState(tabId, state);
      await processTabUpdate(tabId, state);
      broadcastChange();
    })();
    return false;
  }

  if (message.action === 'getTabData') {
    const tabId = message.tabId;
    if (tabId == null) { sendResponse(null); return false; }
    buildTabSnapshot(tabId).then(sendResponse).catch(() => sendResponse(null));
    return true; // async
  }

  if (message.action === 'clearSiteData') {
    const tabId = message.tabId;
    if (tabId == null) { sendResponse({ ok: false, error: 'no_tab' }); return false; }
    (async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab || !tab.url || !/^https?:/i.test(tab.url)) {
          sendResponse({ ok: false, error: 'not_http' });
          return;
        }
        const origin = new URL(tab.url).origin;
        // Only dataTypes documented to respect per-origin scoping - never mix
        // in anything broader (history, downloads, ...) alongside `origins`.
        await chrome.browsingData.remove(
          { origins: [origin], since: 0 },
          { cookies: true, cache: true, cacheStorage: true, fileSystems: true, indexedDB: true, localStorage: true, serviceWorkers: true, webSQL: true }
        );
        broadcastChange();
        sendResponse({ ok: true, origin });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async
  }

  if (message.action === 'runPageCookiebotRead') {
    const tabId = sender && sender.tab && sender.tab.id;
    if (!tabId) { sendResponse({ consent: null, error: 'no_tab' }); return false; }
    try {
      chrome.scripting.executeScript({
        target: { tabId: tabId, allFrames: false },
        world: 'MAIN',
        func: function () {
          try {
            var resolved = null;
            if (window.Cookiebot) {
              var cp = window.Cookiebot.consent;
              if (typeof cp === 'function') {
                try { resolved = cp(); } catch (e) { /* ignore */ }
              } else if (cp && typeof cp === 'object') {
                resolved = cp;
              } else if (cp) {
                var getters = ['getConsent', 'get', 'consent', 'getCookiebotConsent', 'getCookieConsent'];
                for (var i = 0; i < getters.length; i++) {
                  var name = getters[i];
                  if (typeof cp[name] === 'function') {
                    try { resolved = cp[name](); break; } catch (e) { /* ignore */ }
                  }
                }
              }
            }
            try { return resolved ? JSON.parse(JSON.stringify(resolved)) : null; } catch (e) { return null; }
          } catch (e) { return null; }
        }
      }, (results) => {
        try {
          if (!results || !results[0]) sendResponse({ consent: null });
          else sendResponse({ consent: results[0].result || null });
        } catch (err) { sendResponse({ consent: null }); }
      });
      return true; // async
    } catch (e) {
      sendResponse({ consent: null, error: String(e) });
      return false;
    }
  }

  return false;
});
