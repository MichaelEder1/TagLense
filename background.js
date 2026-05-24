// TagLens - Background service worker
// Stores recent debug logs and forwards broadcasts to popup

let debugLogs = [];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return;

  if (message.action === 'debugLog') {
    const entry = Object.assign({}, message.payload || {}, { fromTab: sender.tab ? sender.tab.id : null });
    debugLogs.push(entry);
    if (debugLogs.length > 300) debugLogs.shift();
    // Broadcast to any listeners (popup)
    try {
      chrome.runtime.sendMessage({ action: 'debugLogBroadcast', payload: entry });
    } catch (e) { /* ignore */ }
    return; // no response
  }

  if (message.action === 'getDebugLogs') {
    sendResponse({ logs: debugLogs.slice().reverse() });
    return true;
  }

  if (message.action === 'clearDebugLogs') {
    debugLogs = [];
    sendResponse({ ok: true });
    return true;
  }
});
// TagLens - Background Service Worker
// Routes messages between popup and content scripts

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'dataChanged') {
    // Forward to popup if it's open
    chrome.runtime.sendMessage(message).catch(() => {});
  }
  return false;
});

// Store last detection payload and forward updates to popup
let lastDetectionPayload = null;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return;
  if (message.action === 'dataUpdate') {
    try {
      lastDetectionPayload = message.payload || null;
      // Broadcast to popup(s)
      chrome.runtime.sendMessage({ action: 'dataUpdate', payload: lastDetectionPayload }).catch(() => {});
    } catch (e) { /* ignore */ }
    return; // no response
  }
  if (message.action === 'getLatestData') {
    sendResponse({ data: lastDetectionPayload });
    return true;
  }
  return false;
});

// Run a function in the page (main world) to read Cookiebot.consent safely (avoids CSP inline errors)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      return true; // indicate async response
    } catch (e) {
      sendResponse({ consent: null, error: String(e) });
      return false;
    }
  }
  return false;
});
