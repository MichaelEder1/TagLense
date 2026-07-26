// TagLens - Main-world bridge
//
// Content scripts run in an "isolated world": they share the DOM with the
// page, but NOT its JavaScript globals. window.dataLayer, window.UC_UI,
// window.Didomi, window.klaro, google_tag_data.ics etc. that the page sets
// are invisible to content.js even though they clearly exist on the page
// (confirmed empirically - this is why consent-state detection was
// returning "not set" for everything except Cookiebot, which already used
// a MAIN-world injection to read Cookiebot.consent).
//
// This script is declared with "world": "MAIN" in manifest.json so it runs
// in the page's own JS context. It reads exactly the globals content.js
// needs and relays them via CustomEvents on `window`, which DOM events can
// cross the isolated/main world boundary safely.
(function () {
  'use strict';

  function safeClone(v) {
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; }
  }

  function dispatchEntry(entry) {
    const clone = safeClone(entry);
    if (clone === null) return;
    try { window.dispatchEvent(new CustomEvent('TagLens:dataLayerEntry', { detail: clone })); } catch (e) { /* ignore */ }
  }

  // ---- dataLayer relay: forward every push (historical + future) as-is,
  // content.js already knows how to parse these into consent categories. ----
  function hookDataLayer() {
    if (window.dataLayer && Array.isArray(window.dataLayer)) {
      window.dataLayer.forEach(dispatchEntry);
      try {
        const origPush = window.dataLayer.push.bind(window.dataLayer);
        if (!origPush.__taglensPatched) {
          const patched = function () {
            const args = Array.prototype.slice.call(arguments);
            const res = origPush.apply(window.dataLayer, args);
            args.forEach(dispatchEntry);
            return res;
          };
          patched.__taglensPatched = true;
          window.dataLayer.push = patched;
        }
      } catch (e) { /* ignore */ }

      // Catch entries pushed via a reference that bypassed our patch, or a
      // wholesale array replacement.
      let lastLen = window.dataLayer.length;
      setInterval(() => {
        try {
          if (!window.dataLayer || !Array.isArray(window.dataLayer)) { lastLen = 0; return; }
          const len = window.dataLayer.length;
          if (len > lastLen) {
            for (let i = lastLen; i < len; i++) dispatchEntry(window.dataLayer[i]);
          } else if (len < lastLen) {
            window.dataLayer.forEach(dispatchEntry);
          }
          lastLen = len;
        } catch (e) { /* ignore */ }
      }, 500);
      return true;
    }
    let tries = 0;
    const intv = setInterval(() => {
      tries++;
      if (window.dataLayer && Array.isArray(window.dataLayer)) { clearInterval(intv); hookDataLayer(); }
      else if (tries > 40) clearInterval(intv);
    }, 250);
    return false;
  }

  // ---- CMP API snapshot: everything content.js's per-CMP consent branches
  // need, computed here (where the APIs actually exist) instead of guessed
  // at from the isolated world. ----
  function computeCmpSnapshot() {
    const out = {};

    try {
      if (window.UC_UI && typeof window.UC_UI.getServices === 'function') {
        const services = window.UC_UI.getServices();
        if (Array.isArray(services)) {
          let hasAnalytics = false, hasMarketing = false, hasPreferences = false;
          services.forEach(s => {
            if (s && (s.consent === true || s.status === 'ACCEPTED')) {
              if (s.categorySlug === 'analytics') hasAnalytics = true;
              if (s.categorySlug === 'marketing') hasMarketing = true;
              if (s.categorySlug === 'preferences') hasPreferences = true;
            }
          });
          out.usercentrics = { hasAnalytics, hasMarketing, hasPreferences };
        }
      }
    } catch (e) { /* ignore */ }

    try {
      if (window.Didomi && typeof window.Didomi.getUserConsentStatusForPurpose === 'function') {
        out.didomi = {
          analytics: window.Didomi.getUserConsentStatusForPurpose('analytics') === true,
          marketing: window.Didomi.getUserConsentStatusForPurpose('marketing') === true,
          functional: window.Didomi.getUserConsentStatusForPurpose('functional') === true
        };
      }
    } catch (e) { /* ignore */ }

    try {
      if (window.klaro && typeof window.klaro.getCookieConsents === 'function') {
        const consents = window.klaro.getCookieConsents();
        if (consents && typeof consents === 'object') {
          let hasAnalytics = false, hasMarketing = false, hasRequired = false;
          Object.keys(consents).forEach(key => {
            if (consents[key] === true) {
              const k = key.toLowerCase();
              if (k.includes('analytics') || k.includes('google')) hasAnalytics = true;
              if (k.includes('marketing') || k.includes('facebook') || k.includes('ads')) hasMarketing = true;
              if (k.includes('required') || k.includes('necessary')) hasRequired = true;
            }
          });
          out.klaro = { hasAnalytics, hasMarketing, hasRequired };
        }
      }
    } catch (e) { /* ignore */ }

    try {
      const groupsRaw = window.OnetrustActiveGroups || window.OptanonActiveGroups;
      if (groupsRaw) {
        out.oneTrustGroups = String(groupsRaw).split(',').filter(Boolean);
      }
    } catch (e) { /* ignore */ }

    try {
      if (window.google_tag_data && window.google_tag_data.ics && window.google_tag_data.ics.entries) {
        const entries = window.google_tag_data.ics.entries;
        const ics = {};
        Object.keys(entries).forEach(key => {
          const entry = entries[key];
          if (entry && typeof entry.update !== 'undefined') ics[key] = !!entry.update;
          else if (entry && typeof entry.default !== 'undefined') ics[key] = !!entry.default;
        });
        if (Object.keys(ics).length) out.googleTagDataIcs = ics;
      }
    } catch (e) { /* ignore */ }

    out.presence = {
      Cookiebot: !!window.Cookiebot,
      UC_UI: !!window.UC_UI,
      Didomi: !!window.Didomi || !!window.didomiConfig,
      klaro: !!window.klaro || !!window.klaroConfig,
      OneTrust: !!window.OneTrust || !!window.OptanonActiveGroups,
      truste: !!window.truste,
      ckyStore: !!window.ckyStore,
      _iub: !!window._iub,
      complianz: !!window.complianz,
      BorlabsCookie: !!window.BorlabsCookie,
      Osano: !!window.Osano,
      CookieInformation: !!window.CookieInformation,
      Termly: !!window.Termly,
      CookieFirst: !!window.CookieFirst
    };

    return out;
  }

  // ---- IAB TCF v2 (__tcfapi): the standardized consent API most EU CMPs
  // implement (OneTrust, Didomi, Cookiebot, Usercentrics, Quantcast,
  // Consentmanager, ...). addEventListener fires immediately with the
  // current state and again on every consent change - no polling needed
  // once registered. Decoding is handled by the CMP itself; we just relay
  // the already-decoded TCData.
  function tryTcf(tries) {
    tries = tries || 0;
    if (typeof window.__tcfapi !== 'function') {
      if (tries < 40) setTimeout(() => tryTcf(tries + 1), 250);
      return;
    }
    try {
      window.__tcfapi('addEventListener', 2, function (tcData, success) {
        try {
          if (!success || !tcData) return;
          const purposeConsents = (tcData.purpose && tcData.purpose.consents) || {};
          const vendorConsents = (tcData.vendor && tcData.vendor.consents) || {};
          const vendorIds = Object.keys(vendorConsents);
          window.dispatchEvent(new CustomEvent('TagLens:tcfData', {
            detail: {
              tcString: typeof tcData.tcString === 'string' ? tcData.tcString : null,
              gdprApplies: !!tcData.gdprApplies,
              cmpId: tcData.cmpId || null,
              eventStatus: tcData.eventStatus || null,
              purposeConsents: safeClone(purposeConsents) || {},
              vendorGranted: vendorIds.filter(id => vendorConsents[id]).length,
              vendorTotal: vendorIds.length
            }
          }));
        } catch (e) { /* ignore */ }
      });
    } catch (e) { /* ignore */ }
  }
  tryTcf();

  let lastCmpSignature = '';
  function dispatchCmpSnapshotIfChanged() {
    try {
      const snap = computeCmpSnapshot();
      const sig = JSON.stringify(snap);
      if (sig !== lastCmpSignature) {
        lastCmpSignature = sig;
        window.dispatchEvent(new CustomEvent('TagLens:cmpSnapshot', { detail: snap }));
      }
    } catch (e) { /* ignore */ }
  }

  hookDataLayer();
  dispatchCmpSnapshotIfChanged();
  setInterval(dispatchCmpSnapshotIfChanged, 1000);

  // Let content.js ask for an immediate fresh read (e.g. right after it
  // attaches its listeners, so it doesn't have to wait for the next tick).
  window.addEventListener('TagLens:requestSnapshot', () => {
    lastCmpSignature = ''; // force a re-dispatch even if unchanged
    dispatchCmpSnapshotIfChanged();
  });
})();
