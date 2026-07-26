// TagLens - Content Script
// Detects tracking scripts, CMPs, consent states, and cookies
// Supports auto-update and SPA route changes

(function () {
  'use strict';

  // ============================================================
  // TRACKER DEFINITIONS
  // ============================================================
  const TRACKERS = [
    {
      name: 'Google Tag Manager',
      icon: '🏷️',
      detect: () => {
        const scripts = document.querySelectorAll('script[src*="googletagmanager.com/gtm.js"]');
        const ids = [];
        scripts.forEach(s => {
          const match = s.src.match(/[?&]id=(GTM-[A-Z0-9]+)/);
          if (match) ids.push(match[1]);
        });
        if (ids.length === 0 && window.google_tag_manager) {
          Object.keys(window.google_tag_manager).forEach(key => {
            if (key.startsWith('GTM-')) ids.push(key);
          });
        }
        if (ids.length === 0) {
          document.querySelectorAll('script').forEach(s => {
            if (s.textContent) {
              const matches = s.textContent.match(/GTM-[A-Z0-9]+/g);
              if (matches) matches.forEach(m => { if (!ids.includes(m)) ids.push(m); });
            }
          });
        }
        return ids.length > 0 ? ids : null;
      }
    },
    {
      name: 'Google Analytics 4',
      icon: '📊',
      detect: () => {
        const ids = [];
        const scripts = document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]');
        scripts.forEach(s => {
          const match = s.src.match(/[?&]id=(G-[A-Z0-9]+)/);
          if (match) ids.push(match[1]);
        });
        document.querySelectorAll('script').forEach(s => {
          if (s.textContent) {
            const matches = s.textContent.match(/['"]config['"]\s*,\s*['"](G-[A-Z0-9]+)['"]/g);
            if (matches) {
              matches.forEach(m => {
                const id = m.match(/G-[A-Z0-9]+/);
                if (id && !ids.includes(id[0])) ids.push(id[0]);
              });
            }
          }
        });
        // Tags fired purely from inside a GTM container (no visible script
        // or inline text) surface here via the mainworld.js dataLayer relay.
        __taglens_liveConfigIds['Google Analytics 4'].forEach(id => { if (!ids.includes(id)) ids.push(id); });
        return ids.length > 0 ? ids : null;
      }
    },
    {
      name: 'Google Ads',
      icon: '💰',
      detect: () => {
        const ids = [];
        document.querySelectorAll('script').forEach(s => {
          if (s.textContent) {
            const matches = s.textContent.match(/['"]config['"]\s*,\s*['"](AW-[0-9]+)['"]/g);
            if (matches) {
              matches.forEach(m => {
                const id = m.match(/AW-[0-9]+/);
                if (id && !ids.includes(id[0])) ids.push(id[0]);
              });
            }
          }
          if (s.src && s.src.includes('googleads.g.doubleclick.net')) {
            if (!ids.includes('Active')) ids.push('Active');
          }
        });
        if (document.querySelector('script[src*="pagead2.googlesyndication.com"]')) {
          if (!ids.includes('AdSense')) ids.push('AdSense');
        }
        // Tags fired purely from inside a GTM container (no visible script
        // or inline text) surface here via the mainworld.js dataLayer relay.
        __taglens_liveConfigIds['Google Ads'].forEach(id => { if (!ids.includes(id)) ids.push(id); });
        return ids.length > 0 ? ids : null;
      }
    },
    {
      name: 'Universal Analytics',
      icon: '📈',
      detect: () => {
        const ids = [];
        if (document.querySelector('script[src*="google-analytics.com/analytics.js"], script[src*="google-analytics.com/ga.js"]')) {
          document.querySelectorAll('script').forEach(s => {
            if (s.textContent) {
              const matches = s.textContent.match(/UA-[0-9]+-[0-9]+/g);
              if (matches) matches.forEach(m => { if (!ids.includes(m)) ids.push(m); });
            }
          });
          if (ids.length === 0) ids.push('Detected');
        }
        // Try to read active trackers via ga.getAll() - only works if this
        // page happens to expose ga() synchronously; usually invisible from
        // here (isolated world), kept as a harmless best-effort attempt.
        try {
          if (window.ga && typeof window.ga.getAll === 'function') {
            const all = window.ga.getAll();
            if (Array.isArray(all)) {
              all.forEach(t => {
                try {
                  if (t && typeof t.get === 'function') {
                    const tid = t.get('trackingId') || t.get('clientId');
                    if (tid && !ids.includes(tid)) ids.push(tid);
                  }
                } catch (e) { /* ignore */ }
              });
            }
          }
        } catch (e) { /* ignore */ }
        __taglens_liveConfigIds['Universal Analytics'].forEach(id => { if (!ids.includes(id)) ids.push(id); });
        return ids.length > 0 ? ids : null;
      }
    },
    {
      name: 'Meta Pixel',
      icon: '👤',
      detect: () => {
        const ids = [];
        if (document.querySelector('script[src*="connect.facebook.net"]') || window.fbq) {
          document.querySelectorAll('script').forEach(s => {
            if (s.textContent) {
              const matches = s.textContent.match(/fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d+)['"]/g);
              if (matches) {
                matches.forEach(m => {
                  const id = m.match(/['"](\d{10,})['"]/);
                  if (id) ids.push(id[1]);
                });
              }
            }
          });
          if (ids.length === 0) ids.push('Detected');
        }

        // Additional heuristics: check dataLayer and fbq queue for dynamic init calls
        try {
          if (window.dataLayer && Array.isArray(window.dataLayer)) {
            window.dataLayer.forEach(entry => {
              try {
                const txt = JSON.stringify(entry);
                const m = txt.match(/fbq\s*\\?\(\s*['\"]init['\"]\s*,\s*['\"]?(\d{10,})/i);
                if (m && m[1] && !ids.includes(m[1])) ids.push(m[1]);
                const m2 = txt.match(/(\d{10,})/g);
                if (m2) m2.forEach(n => { if (!ids.includes(n) && n.length >= 10) ids.push(n); });
              } catch (e) { /* ignore */ }
            });
          }
        } catch (e) { /* ignore */ }

        try {
          if (window.fbq && Array.isArray(window.fbq.q)) {
            window.fbq.q.forEach(call => {
              try {
                if (Array.isArray(call) && call[0] === 'init' && call[1]) {
                  const id = String(call[1]).match(/(\d{10,})/);
                  if (id && !ids.includes(id[0])) ids.push(id[0]);
                }
              } catch (e) { /* ignore */ }
            });
          }
        } catch (e) { /* ignore */ }
        return ids.length > 0 ? ids : null;
      }
    },
    {
      name: 'TikTok Pixel',
      icon: '🎵',
      detect: () => {
        const ids = [];
        if (document.querySelector('script[src*="analytics.tiktok.com"]') || window.ttq) {
          document.querySelectorAll('script').forEach(s => {
            if (s.textContent) {
              const matches = s.textContent.match(/ttq\.load\s*\(\s*['"]([A-Z0-9]+)['"]/g);
              if (matches) {
                matches.forEach(m => {
                  const id = m.match(/['"]([A-Z0-9]+)['"]/);
                  if (id) ids.push(id[1]);
                });
              }
            }
          });
          if (ids.length === 0) ids.push('Detected');
        }
        // Check ttq queue for dynamic load/init calls
        try {
          if (window.ttq && Array.isArray(window.ttq.q)) {
            window.ttq.q.forEach(call => {
              try {
                if (Array.isArray(call) && (call[0] === 'load' || call[0] === 'init') && call[1]) {
                  const id = String(call[1]).match(/([A-Z0-9]{5,})/);
                  if (id && !ids.includes(id[0])) ids.push(id[0]);
                }
              } catch (e) { /* ignore */ }
            });
          }
        } catch (e) { /* ignore */ }
        return ids.length > 0 ? ids : null;
      }
    },
    {
      name: 'Microsoft Ads (UET)',
      icon: '🔷',
      detect: () => {
        const ids = [];
        if (document.querySelector('script[src*="bat.bing.com"]') || window.uetq) {
          document.querySelectorAll('script').forEach(s => {
            if (s.textContent) {
              const matches = s.textContent.match(/uetq.*?ti['":\s]+['"]?(\d+)['"]?/g);
              if (matches) {
                matches.forEach(m => {
                  const id = m.match(/(\d{7,})/);
                  if (id) ids.push(id[1]);
                });
              }
            }
          });
          if (ids.length === 0) ids.push('Detected');
        }
        // Check uetq queue for ids
        try {
          if (window.uetq && Array.isArray(window.uetq)) {
            window.uetq.forEach(entry => {
              try {
                const txt = JSON.stringify(entry);
                const m = txt.match(/(\d{7,})/g);
                if (m) m.forEach(mid => { if (!ids.includes(mid)) ids.push(mid); });
              } catch (e) { /* ignore */ }
            });
          }
        } catch (e) { /* ignore */ }
        return ids.length > 0 ? ids : null;
      }
    },
    {
      name: 'LinkedIn Insight',
      icon: '💼',
      detect: () => {
        const ids = [];
        if (document.querySelector('script[src*="snap.licdn.com"]') || window._linkedin_data_partner_ids) {
          if (window._linkedin_data_partner_ids) {
            window._linkedin_data_partner_ids.forEach(id => ids.push(String(id)));
          }
          document.querySelectorAll('script').forEach(s => {
            if (s.textContent) {
              const matches = s.textContent.match(/_linkedin_partner_id\s*=\s*['"](\d+)['"]/);
              if (matches && !ids.includes(matches[1])) ids.push(matches[1]);
            }
          });
          if (ids.length === 0) ids.push('Detected');
        }
        // Check for lintrk or partner ids in global queues
        try {
          if (window._linkedin_data_partner_ids && Array.isArray(window._linkedin_data_partner_ids)) {
            window._linkedin_data_partner_ids.forEach(id => { if (!ids.includes(String(id))) ids.push(String(id)); });
          }
        } catch (e) { /* ignore */ }
        return ids.length > 0 ? ids : null;
      }
    },
    {
      name: 'Pinterest Tag',
      icon: '📌',
      detect: () => {
        const ids = [];
        if (document.querySelector('script[src*="pinimg.com/ct"]') || window.pintrk) {
          document.querySelectorAll('script').forEach(s => {
            if (s.textContent) {
              const matches = s.textContent.match(/pintrk\s*\(\s*['"]load['"]\s*,\s*['"](\d+)['"]/);
              if (matches) ids.push(matches[1]);
            }
          });
          if (ids.length === 0) ids.push('Detected');
        }
        return ids.length > 0 ? ids : null;
      }
    },
    {
      name: 'Twitter/X Pixel',
      icon: '🐦',
      detect: () => {
        const ids = [];
        if (document.querySelector('script[src*="static.ads-twitter.com"]') || window.twq) {
          document.querySelectorAll('script').forEach(s => {
            if (s.textContent) {
              const matches = s.textContent.match(/twq\s*\(\s*['"]init['"]\s*,\s*['"]([a-z0-9]+)['"]/);
              if (matches) ids.push(matches[1]);
            }
          });
          if (ids.length === 0) ids.push('Detected');
        }
        // Check twq queue for init calls
        try {
          if (window.twq && Array.isArray(window.twq.q)) {
            window.twq.q.forEach(call => {
              try {
                if (Array.isArray(call) && call[0] === 'init' && call[1]) {
                  const id = String(call[1]);
                  if (!ids.includes(id)) ids.push(id);
                }
              } catch (e) { /* ignore */ }
            });
          }
        } catch (e) { /* ignore */ }
        return ids.length > 0 ? ids : null;
      }
    },
    {
      name: 'Snapchat Pixel',
      icon: '👻',
      detect: () => {
        const ids = [];
        if (document.querySelector('script[src*="sc-static.net/scevent"]') || window.snaptr) {
          document.querySelectorAll('script').forEach(s => {
            if (s.textContent) {
              const matches = s.textContent.match(/snaptr\s*\(\s*['"]init['"]\s*,\s*['"]([a-f0-9-]+)['"]/);
              if (matches) ids.push(matches[1]);
            }
          });
          if (ids.length === 0) ids.push('Detected');
        }
        // Check snaptr queue
        try {
          if (window.snaptr && Array.isArray(window.snaptr.q)) {
            window.snaptr.q.forEach(call => {
              try {
                if (Array.isArray(call) && call[0] === 'init' && call[1]) {
                  const id = String(call[1]);
                  if (!ids.includes(id)) ids.push(id);
                }
              } catch (e) { /* ignore */ }
            });
          }
        } catch (e) { /* ignore */ }
        return ids.length > 0 ? ids : null;
      }
    },
    {
      name: 'Hotjar',
      icon: '🔥',
      detect: () => {
        const ids = [];
        if (document.querySelector('script[src*="static.hotjar.com"]') || window.hj) {
          document.querySelectorAll('script').forEach(s => {
            if (s.textContent) {
              const matches = s.textContent.match(/hjid\s*[:=]\s*(\d+)/);
              if (matches) ids.push(matches[1]);
            }
          });
          if (ids.length === 0) ids.push('Detected');
        }
        // Check hotjar queue
        try {
          if (window.hj && Array.isArray(window.hj.q)) {
            window.hj.q.forEach(call => {
              try {
                const txt = JSON.stringify(call);
                const m = txt.match(/hjid\D*(\d{3,})/);
                if (m && m[1] && !ids.includes(m[1])) ids.push(m[1]);
              } catch (e) { /* ignore */ }
            });
          }
        } catch (e) { /* ignore */ }
        return ids.length > 0 ? ids : null;
      }
    },
    {
      name: 'Microsoft Clarity',
      icon: '🔍',
      detect: () => {
        const ids = [];
        if (document.querySelector('script[src*="clarity.ms"]') || window.clarity) {
          document.querySelectorAll('script').forEach(s => {
            if (s.textContent && s.textContent.includes('clarity')) {
              const idMatch = s.textContent.match(/clarity[^)]*["']([a-z0-9]{8,12})["']\s*\)/);
              if (idMatch) ids.push(idMatch[1]);
            }
          });
          if (ids.length === 0) ids.push('Detected');
        }
        return ids.length > 0 ? ids : null;
      }
    },
    {
      name: 'Matomo/Piwik',
      icon: '🟢',
      detect: () => {
        const ids = [];
        if (document.querySelector('script[src*="matomo.js"], script[src*="piwik.js"]') || window._paq) {
          document.querySelectorAll('script').forEach(s => {
            if (s.textContent) {
              const matches = s.textContent.match(/setSiteId['"]*\s*,\s*['"]?(\d+)['"]?/);
              if (matches) ids.push('Site ' + matches[1]);
            }
          });
          if (ids.length === 0) ids.push('Detected');
        }
        // Check _paq queue for setSiteId or setSiteId pushes
        try {
          if (window._paq && Array.isArray(window._paq)) {
            window._paq.forEach(call => {
              try {
                if (Array.isArray(call) && (call[0] === 'setSiteId' || call[0] === 'setSiteId')) {
                  if (call[1]) {
                    const id = String(call[1]);
                    if (!ids.includes('Site ' + id)) ids.push('Site ' + id);
                  }
                }
              } catch (e) { /* ignore */ }
            });
          }
        } catch (e) { /* ignore */ }
        return ids.length > 0 ? ids : null;
      }
    },
    {
      name: 'Plausible Analytics',
      icon: '🌿',
      detect: () => {
        const script = document.querySelector('script[src*="plausible.io"]');
        if (script) {
          const domain = script.getAttribute('data-domain');
          return domain ? [domain] : ['Detected'];
        }
        return null;
      }
    },
    {
      name: 'Adobe Analytics',
      icon: '🔴',
      detect: () => {
        if (document.querySelector('script[src*="omtrdc.net"], script[src*="adobedtm.com"]') || window.s_gi || window._satellite) {
          return ['Detected'];
        }
        return null;
      }
    },
    {
      name: 'HubSpot',
      icon: '🟠',
      detect: () => {
        const ids = [];
        if (document.querySelector('script[src*="js.hs-scripts.com"], script[src*="js.hsforms.net"]') || window._hsq) {
          document.querySelectorAll('script[src*="js.hs-scripts.com"]').forEach(s => {
            const match = s.src.match(/\/(\d+)\.js/);
            if (match) ids.push(match[1]);
          });
          if (ids.length === 0) ids.push('Detected');
        }
        // Check _hsq queue for identify or other IDs
        try {
          if (window._hsq && Array.isArray(window._hsq)) {
            window._hsq.forEach(call => {
              try {
                const txt = JSON.stringify(call);
                const m = txt.match(/(\d{6,})/);
                if (m && m[1] && !ids.includes(m[1])) ids.push(m[1]);
              } catch (e) { /* ignore */ }
            });
          }
        } catch (e) { /* ignore */ }
        return ids.length > 0 ? ids : null;
      }
    },
    {
      name: 'Segment',
      icon: '🟣',
      detect: () => {
        const ids = [];
        if (document.querySelector('script[src*="cdn.segment.com"]') || window.analytics) {
          // Check analytics queue for load/config entries
          try {
            if (window.analytics && Array.isArray(window.analytics && window.analytics._q)) {
              window.analytics._q.forEach(call => {
                try {
                  const txt = JSON.stringify(call);
                  const m = txt.match(/[A-Za-z0-9_-]{10,}/);
                  if (m && m[0] && !ids.includes(m[0])) ids.push(m[0]);
                } catch (e) { /* ignore */ }
              });
            }
            if (window.analytics && Array.isArray(window.analytics.q)) {
              window.analytics.q.forEach(call => {
                try {
                  const txt = JSON.stringify(call);
                  const m = txt.match(/[A-Za-z0-9_-]{10,}/);
                  if (m && m[0] && !ids.includes(m[0])) ids.push(m[0]);
                } catch (e) { /* ignore */ }
              });
            }
          } catch (e) { /* ignore */ }
          return ids.length ? ids : ['Detected'];
        }
        return null;
      }
    },
    {
      name: 'Criteo',
      icon: '🟡',
      detect: () => {
        const ids = [];
        if (document.querySelector('script[src*="static.criteo.net"]') || window.criteo_q) {
          try {
            if (Array.isArray(window.criteo_q)) {
              window.criteo_q.forEach(call => {
                try {
                  const txt = JSON.stringify(call);
                  const m = txt.match(/(\d{4,})/g);
                  if (m) m.forEach(mid => { if (!ids.includes(mid)) ids.push(mid); });
                } catch (e) { /* ignore */ }
              });
            }
          } catch (e) { /* ignore */ }
          return ids.length ? ids : ['Detected'];
        }
        return null;
      }
    },
    {
      name: 'Taboola',
      icon: '📰',
      detect: () => {
        const ids = [];
        if (document.querySelector('script[src*="cdn.taboola.com"]') || window._tfa) {
          try {
            if (window._tfa && Array.isArray(window._tfa)) {
              window._tfa.forEach(call => {
                try {
                  const txt = JSON.stringify(call);
                  const m = txt.match(/(\d{4,})/g);
                  if (m) m.forEach(mid => { if (!ids.includes(mid)) ids.push(mid); });
                } catch (e) { /* ignore */ }
              });
            }
          } catch (e) { /* ignore */ }
          return ids.length ? ids : ['Detected'];
        }
        return null;
      }
    },
    {
      name: 'Outbrain',
      icon: '📡',
      detect: () => {
        const ids = [];
        if (document.querySelector('script[src*="outbrain.com"]') || window.obApi) {
          try {
            if (window._obv && Array.isArray(window._obv)) {
              window._obv.forEach(call => {
                try {
                  const txt = JSON.stringify(call);
                  const m = txt.match(/(\d{4,})/g);
                  if (m) m.forEach(mid => { if (!ids.includes(mid)) ids.push(mid); });
                } catch (e) { /* ignore */ }
              });
            }
          } catch (e) { /* ignore */ }
          return ids.length ? ids : ['Detected'];
        }
        return null;
      }
    }
  ];

  // ============================================================
  // CONSENT MANAGEMENT PLATFORM DEFINITIONS
  // ============================================================
  const CMP_PLATFORMS = [
    {
      name: 'Cookiebot',
      icon: '🤖',
      detect: () => {
        if (document.querySelector('script[src*="consent.cookiebot.com"], script[src*="consentcdn.cookiebot.com"]') || window.Cookiebot) {
          const cbid = document.querySelector('script[data-cbid]');
          return cbid ? cbid.getAttribute('data-cbid') : 'Active';
        }
        return null;
      }
    },
    {
      name: 'Usercentrics',
      icon: '🛡️',
      detect: () => {
        if (document.querySelector('script[src*="usercentrics.eu"], script[src*="app.usercentrics.eu"]') || window.UC_UI) {
          const script = document.querySelector('script[data-settings-id]');
          return script ? script.getAttribute('data-settings-id') : 'Active';
        }
        return null;
      }
    },
    {
      name: 'OneTrust',
      icon: '🔒',
      detect: () => {
        if (document.querySelector('script[src*="cdn.cookielaw.org"], script[src*="optanon"]') || window.OneTrust || window.OptanonActiveGroups) {
          return 'Active';
        }
        return null;
      }
    },
    {
      name: 'Didomi',
      icon: '📋',
      detect: () => {
        if (document.querySelector('script[src*="sdk.privacy-center.org"]') || window.Didomi || window.didomiConfig) {
          return 'Active';
        }
        return null;
      }
    },
    {
      name: 'Quantcast Choice',
      icon: '⚖️',
      detect: () => {
        if (document.querySelector('script[src*="quantcast.mgr.consensu.org"], script[src*="cmp.quantcast.com"]')) {
          return 'Active';
        }
        return null;
      }
    },
    {
      name: 'TrustArc',
      icon: '✅',
      detect: () => {
        if (document.querySelector('script[src*="consent.trustarc.com"]') || window.truste) {
          return 'Active';
        }
        return null;
      }
    },
    {
      name: 'CookieYes',
      icon: '🍪',
      detect: () => {
        if (document.querySelector('script[src*="cookieyes.com"]') || window.ckyStore) {
          return 'Active';
        }
        return null;
      }
    },
    {
      name: 'Iubenda',
      icon: '📜',
      detect: () => {
        if (document.querySelector('script[src*="iubenda.com"]') || window._iub) {
          return 'Active';
        }
        return null;
      }
    },
    {
      name: 'Complianz',
      icon: '🏛️',
      detect: () => {
        if (document.querySelector('script[src*="complianz"], .cmplz-cookiebanner') || window.complianz) {
          return 'Active';
        }
        return null;
      }
    },
    {
      name: 'Borlabs Cookie',
      icon: '🧁',
      detect: () => {
        if (document.querySelector('script[src*="borlabs-cookie"], .BorlabsCookie') || window.BorlabsCookie) {
          return 'Active';
        }
        return null;
      }
    },
    {
      name: 'Klaro',
      icon: '🎛️',
      detect: () => {
        if (document.querySelector('script[src*="klaro"], .klaro') || window.klaro || window.klaroConfig) {
          return 'Active';
        }
        return null;
      }
    },
    {
      name: 'Osano',
      icon: '🌐',
      detect: () => {
        if (document.querySelector('script[src*="osano.com"]') || window.Osano) {
          return 'Active';
        }
        return null;
      }
    },
    {
      name: 'Cookie Information',
      icon: 'ℹ️',
      detect: () => {
        if (document.querySelector('script[src*="cookieinformation.com"]') || window.CookieInformation) {
          return 'Active';
        }
        return null;
      }
    },
    {
      name: 'Termly',
      icon: '📄',
      detect: () => {
        if (document.querySelector('script[src*="termly.io"]') || window.Termly) {
          return 'Active';
        }
        return null;
      }
    },
    {
      name: 'CookieFirst',
      icon: '🥇',
      detect: () => {
        if (document.querySelector('script[src*="cookiefirst.com"]') || window.CookieFirst) {
          return 'Active';
        }
        return null;
      }
    },
    {
      name: 'Consentmanager',
      icon: '📝',
      detect: () => {
        if (document.querySelector('script[src*="consentmanager.net"], script[src*="cdn.consentmanager.net"]')) {
          return 'Active';
        }
        return null;
      }
    },
    {
      name: 'Sourcepoint',
      icon: '🔷',
      detect: () => {
        if (document.querySelector('script[src*="sourcepoint.com"], script[src*="sp-prod.net"], iframe[src*="sourcepoint"]') || window._sp_) {
          return 'Active';
        }
        return null;
      }
    }
  ];

  // Cookie detection (including httpOnly cookies) now lives in background.js,
  // the only context with access to chrome.cookies.

  // ============================================================
  // GOOGLE CONSENT MODE v2 DETECTION (IMPROVED WITH CMP APIs)
  // Calls native CMP APIs to get accurate consent status
  // ============================================================
  // Page-context Cookiebot bridge
  let __taglens_pageCookiebotConsent = null;
  let __taglens_cookiebotResolvedAt = 0;
  let __taglens_cookiebotBridgeAttempted = false;
  let __taglens_cookiebotBridgeFailed = false;

  // Last known consent states cache to avoid flapping when reads are transiently unavailable
  let __taglens_lastConsentStates = null;
  let __taglens_lastConsentTs = 0;

  // Human-readable label for where the last consent reading came from
  let __taglens_consentSource = null;

  // Snapshot relayed from mainworld.js (window.UC_UI/Didomi/klaro/OneTrust/
  // google_tag_data.ics all live in the page's MAIN world and are invisible
  // from this isolated-world script - mainworld.js reads them and forwards
  // the result here via CustomEvent).
  let __taglens_cmpBridge = null;
  window.addEventListener('TagLens:cmpSnapshot', function (ev) {
    try { __taglens_cmpBridge = ev.detail || null; notifyChange(); } catch (e) { /* ignore */ }
  });

  // IAB TCF v2 (__tcfapi) snapshot, also relayed from mainworld.js.
  let __taglens_tcf = null;
  window.addEventListener('TagLens:tcfData', function (ev) {
    try { __taglens_tcf = ev.detail || null; notifyChange(); } catch (e) { /* ignore */ }
  });

  // User-defined custom tracker patterns from the options page ([{name, pattern}]).
  let __taglens_customTrackers = [];
  function loadCustomTrackers() {
    try {
      chrome.storage.sync.get('customTrackers', (data) => {
        if (chrome.runtime.lastError) return;
        __taglens_customTrackers = Array.isArray(data && data.customTrackers) ? data.customTrackers : [];
      });
    } catch (e) { /* ignore */ }
  }
  loadCustomTrackers();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.customTrackers) loadCustomTrackers();
    });
  } catch (e) { /* ignore */ }
  window.addEventListener('TagLens:dataLayerEntry', function (ev) {
    try { updateDataLayerConsentFromEntry(ev.detail); } catch (e) { /* ignore */ }
    try { updateLiveConfigIdsFromEntry(ev.detail); } catch (e) { /* ignore */ }
  });

  // Tags GTM fires purely from inside its own container often never appear
  // as a <script> tag or literal inline gtag() call text - GTM's bundle
  // calls the page's real gtag()/dataLayer.push() at runtime instead, which
  // mainworld.js already relays here. Catch config calls (gtag('config',
  // 'G-XXXX' | 'AW-XXXX' | 'UA-XXXX-Y')) so those IDs show up immediately,
  // not just once/if a matching network request happens to fire later.
  const __taglens_liveConfigIds = { 'Google Analytics 4': [], 'Google Ads': [], 'Universal Analytics': [] };
  function updateLiveConfigIdsFromEntry(entry) {
    try {
      if (!entry) return;
      let id = null;
      if (entry['0'] === 'config' && typeof entry['1'] === 'string') id = entry['1'];
      else if (Array.isArray(entry) && entry[0] === 'config' && typeof entry[1] === 'string') id = entry[1];
      if (!id) return;
      let bucket = null;
      if (/^G-/.test(id)) bucket = 'Google Analytics 4';
      else if (/^AW-/.test(id)) bucket = 'Google Ads';
      else if (/^UA-/.test(id)) bucket = 'Universal Analytics';
      if (!bucket) return;
      if (!__taglens_liveConfigIds[bucket].includes(id)) {
        __taglens_liveConfigIds[bucket].push(id);
        notifyChange();
      }
    } catch (e) { /* ignore */ }
  }

  // DataLayer consent cache, fed by mainworld.js's TagLens:dataLayerEntry events
  let __taglens_dataLayerConsent = null;
  let __taglens_dataLayerConsentTs = 0;

  function normalizeConsentValue(v) {
    if (v === true) return 'granted';
    if (typeof v === 'string') {
      const s = v.toLowerCase();
      if (s === 'granted' || s === 'yes' || s === 'allow' || s === 'true') return 'granted';
      return 'denied';
    }
    return 'denied';
  }

  function parseDataLayerEntryForConsent(entry) {
    try {
      if (!entry) return null;
      // array style: ['consent','update',{...}]
      if (Array.isArray(entry) && entry[0] === 'consent' && (entry[1] === 'update' || entry[1] === 'default') && typeof entry[2] === 'object') {
        return entry[2];
      }
      // numeric-keyed object: { '0': 'consent', '1': 'update', '2': {...} }
      if (entry['0'] === 'consent' && (entry['1'] === 'update' || entry['1'] === 'default') && typeof entry['2'] === 'object') {
        return entry['2'];
      }
      // gtag-style event: { event: 'consent_update', ad_storage: 'granted', ... }
      if (entry.event && (entry.event === 'consent_update' || entry.event === 'consent_default' || entry.event === 'cookie_consent_update' || entry.event === 'cookie_consent_statistics' || entry.event === 'cookie_consent_marketing' || entry.event === 'cookie_consent_preferences')) {
        // If the entry itself contains the keys, return object containing known consent keys
        const keys = ['ad_storage','analytics_storage','ad_user_data','ad_personalization','functionality_storage','personalization_storage','security_storage'];
        const found = {};
        let any = false;
        keys.forEach(k => { if (k in entry) { found[k] = entry[k]; any = true; } });
        if (any) return found;
      }
      // Vendor-specific events: usercentrics, onetrust, didomi, quantcast, consentmanager, cookieyes, trustarc, iubenda, borlabs, klaro, osano
      if (entry.event && /usercentrics|one ?trust|didomi|quantcast|consentmanager|cookieyes|trustarc|iubenda|borlabs|klaro|osano|cookieinformation|termly|cookiefirst/i.test(entry.event)) {
        // try to extract a nested consent object
        const keys = ['consent','consents','categories','preferences','settings'];
        for (const k of keys) {
          if (entry[k] && typeof entry[k] === 'object') return entry[k];
        }
        // sometimes vendor payload is under vendor name
        const vendorKey = entry.event.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        if (entry[vendorKey] && typeof entry[vendorKey] === 'object') return entry[vendorKey];
      }
      // fallback: scan object for consent-like subobject
      if (typeof entry === 'object') {
        for (const k of Object.keys(entry)) {
          try {
            const v = entry[k];
            if (v && typeof v === 'object') {
              const keys = ['ad_storage','analytics_storage','ad_user_data','ad_personalization','functionality_storage','personalization_storage','security_storage'];
              let any = false;
              const found = {};
              keys.forEach(kk => { if (kk in v) { found[kk] = v[kk]; any = true; } });
              if (any) return found;
              // vendor-style nested payloads
              const vendorRegex = /usercentrics|one ?trust|didomi|quantcast|consentmanager|cookieyes|trustarc|iubenda|borlabs|klaro|osano|cookieinformation|termly|cookiefirst/i;
              if (vendorRegex.test(k) || (k && typeof k === 'string' && vendorRegex.test(k))) {
                return v;
              }
            }
          } catch (e) { /* ignore */ }
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function updateDataLayerConsentFromEntry(entry) {
    try {
      const parsed = parseDataLayerEntryForConsent(entry);
      if (parsed && typeof parsed === 'object') {
        // Normalize values
        const normalized = {};
        Object.keys(parsed).forEach(k => { normalized[k] = normalizeConsentValue(parsed[k]); });
        // Merge into the existing cache rather than replacing it: GTM/Consent
        // Mode typically pushes a 'default' event with ALL categories, then
        // later partial 'update' events with only the categories that
        // changed. Replacing wholesale would make previously-known
        // categories flip back to "not set" every time a partial update
        // arrives.
        const merged = Object.assign({}, __taglens_dataLayerConsent || {}, normalized);
        const sig = JSON.stringify(merged);
        if (!__taglens_dataLayerConsent || JSON.stringify(__taglens_dataLayerConsent) !== sig) {
          __taglens_dataLayerConsent = merged;
          __taglens_dataLayerConsentTs = Date.now();
          // dataLayer consent parsed
          try { notifyChange(); } catch (e) { /* ignore */ }
        }
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function requestCookiebotConsentFromPage() {
    try {
      if (__taglens_cookiebotBridgeAttempted || __taglens_cookiebotBridgeFailed) return;
      __taglens_cookiebotBridgeAttempted = true;
      // Ask background to execute a MAIN-world script to read Cookiebot (avoids inline-injection CSP)
      try {
        chrome.runtime.sendMessage({ action: 'runPageCookiebotRead' }, (resp) => {
          try {
            if (resp && resp.consent) {
              __taglens_pageCookiebotConsent = resp.consent;
              __taglens_cookiebotResolvedAt = Date.now();
              // Cookiebot page read resolved
            } else {
              __taglens_cookiebotBridgeFailed = true;
              // Cookiebot page read failed
            }
          } catch (e) { __taglens_cookiebotBridgeFailed = true; }
        });
      } catch (e) {
        __taglens_cookiebotBridgeFailed = true;
      }
    } catch (e) { /* ignore */ }
  }

  window.addEventListener('TagLens.Cookiebot', function (ev) {
    try {
      if (ev && ev.detail) {
        __taglens_pageCookiebotConsent = ev.detail.consent || null;
        __taglens_cookiebotResolvedAt = Date.now();
        // Cookiebot page event received
      }
    } catch (e) { /* ignore */ }
  }, false);

  function detectConsentStates() {
    const consentCategories = [
      { key: 'ad_storage', label: 'Ad Storage', description: 'Enables storage for advertising' },
      { key: 'analytics_storage', label: 'Analytics Storage', description: 'Enables storage for analytics' },
      { key: 'ad_user_data', label: 'Ad User Data', description: 'User data for advertising' },
      { key: 'ad_personalization', label: 'Ad Personalization', description: 'Personalized advertising' },
      { key: 'functionality_storage', label: 'Functionality Storage', description: 'Enables functional storage' },
      { key: 'personalization_storage', label: 'Personalization Storage', description: 'Enables personalization storage' }
    ];

    const states = {};
    __taglens_consentSource = null;

    // Highest priority: dataLayer-derived consent (live updates, fed by
    // mainworld.js relaying real dataLayer.push calls via CustomEvent -
    // window.dataLayer itself is not readable from this isolated world).
    try {
      if (__taglens_dataLayerConsent && typeof __taglens_dataLayerConsent === 'object') {
        const cache = __taglens_dataLayerConsent;
        consentCategories.forEach(cat => {
          if (cache[cat.key]) states[cat.key] = cache[cat.key];
        });
        if (Object.keys(states).length) {
          const computed = consentCategories.map(cat => ({ ...cat, state: states[cat.key] || 'not set' }));
          // Cache the last known consent states to avoid flapping
          __taglens_lastConsentStates = computed;
          __taglens_lastConsentTs = Date.now();
          __taglens_consentSource = 'dataLayer (Consent Mode)';
          return computed;
        }
      }
    } catch (e) { /* ignore */ }

    // === PRIORITY 1: CMP-SPECIFIC API CALLS ===

    // Cookiebot: Try page-context bridge first, then best-effort inline read (no long waits)
    try {
      // Only attempt and log if we haven't tried the page bridge yet
      if (!__taglens_cookiebotBridgeAttempted && !__taglens_cookiebotBridgeFailed) {
        try { requestCookiebotConsentFromPage(); } catch (e) { /* ignore */ }
      }

      let cb = null;

      // Prefer recently received page-context result
      try {
        const CACHE_MAX_MS = 5000;
        if (__taglens_pageCookiebotConsent !== null && (Date.now() - __taglens_cookiebotResolvedAt) < CACHE_MAX_MS) {
          cb = __taglens_pageCookiebotConsent;
          // Cookiebot.consent resolved from pageEvent
        }
      } catch (e) { /* ignore */ }

      // Best-effort inline read (may be undefined due to isolated context)
      if (!cb) {
        try {
          if (window.Cookiebot) {
            const consentProp = window.Cookiebot.consent;
            try {
              if (typeof consentProp === 'function') {
                cb = consentProp();
              } else if (consentProp && typeof consentProp === 'object') {
                cb = consentProp;
              } else if (consentProp) {
                const getters = ['getConsent', 'get', 'consent', 'getCookiebotConsent', 'getCookieConsent'];
                for (let i = 0; i < getters.length; i++) {
                  const name = getters[i];
                  if (typeof consentProp[name] === 'function') {
                    try { cb = consentProp[name](); break; } catch (e) { /* ignore */ }
                  }
                }
              }
            } catch (err) {
              // Cookiebot.consent retrieval error
            }
          }
        } catch (e) { /* ignore */ }
      }

      // Cookiebot consent attempt logged

      if (cb && typeof cb === 'object') {
        states['analytics_storage'] = cb.statistics ? 'granted' : 'denied';
        states['ad_storage'] = cb.marketing ? 'granted' : 'denied';
        states['ad_user_data'] = cb.marketing ? 'granted' : 'denied';
        states['ad_personalization'] = cb.marketing ? 'granted' : 'denied';
        states['functionality_storage'] = cb.preferences ? 'granted' : 'denied';
        states['personalization_storage'] = cb.preferences ? 'granted' : 'denied';
        __taglens_consentSource = 'Cookiebot';
        return consentCategories.map(cat => ({ ...cat, state: states[cat.key] || 'not set' }));
      }
    } catch (e) { /* ignore */ }

    // Usercentrics/Didomi/Klaro/OneTrust/google_tag_data.ics all live as JS
    // globals in the page's MAIN world, invisible from here - read the
    // snapshot mainworld.js already computed and relayed via CustomEvent.
    const bridge = __taglens_cmpBridge;

    // Usercentrics
    try {
      if (bridge && bridge.usercentrics) {
        const { hasAnalytics, hasMarketing, hasPreferences } = bridge.usercentrics;
        if (!Object.keys(states).length) {
          states['analytics_storage'] = hasAnalytics ? 'granted' : 'denied';
          states['ad_storage'] = hasMarketing ? 'granted' : 'denied';
          states['ad_user_data'] = hasMarketing ? 'granted' : 'denied';
          states['ad_personalization'] = hasMarketing ? 'granted' : 'denied';
          states['functionality_storage'] = hasPreferences ? 'granted' : 'denied';
          states['personalization_storage'] = hasPreferences ? 'granted' : 'denied';
          __taglens_consentSource = 'Usercentrics';
          return consentCategories.map(cat => ({ ...cat, state: states[cat.key] || 'not set' }));
        }
      }
    } catch (e) { /* ignore */ }

    // Didomi
    try {
      if (bridge && bridge.didomi) {
        const { analytics, marketing, functional } = bridge.didomi;
        if (!Object.keys(states).length) {
          states['analytics_storage'] = analytics ? 'granted' : 'denied';
          states['ad_storage'] = marketing ? 'granted' : 'denied';
          states['ad_user_data'] = marketing ? 'granted' : 'denied';
          states['ad_personalization'] = marketing ? 'granted' : 'denied';
          states['functionality_storage'] = functional ? 'granted' : 'denied';
          states['personalization_storage'] = functional ? 'granted' : 'denied';
          __taglens_consentSource = 'Didomi';
          return consentCategories.map(cat => ({ ...cat, state: states[cat.key] || 'not set' }));
        }
      }
    } catch (e) { /* ignore */ }

    // Klaro
    try {
      if (bridge && bridge.klaro) {
        const { hasAnalytics, hasMarketing, hasRequired } = bridge.klaro;
        if (!Object.keys(states).length) {
          states['analytics_storage'] = hasAnalytics ? 'granted' : 'denied';
          states['ad_storage'] = hasMarketing ? 'granted' : 'denied';
          states['ad_user_data'] = hasMarketing ? 'granted' : 'denied';
          states['ad_personalization'] = hasMarketing ? 'granted' : 'denied';
          states['functionality_storage'] = hasRequired ? 'granted' : 'denied';
          states['personalization_storage'] = hasRequired ? 'granted' : 'denied';
          __taglens_consentSource = 'Klaro';
          return consentCategories.map(cat => ({ ...cat, state: states[cat.key] || 'not set' }));
        }
      }
    } catch (e) { /* ignore */ }

    // === PRIORITY 2: OneTrust Active Groups ===
    try {
      if (bridge && bridge.oneTrustGroups) {
        const groups = bridge.oneTrustGroups;
        // OneTrust groups: C0001=necessary, C0002=performance/analytics, C0003=functional, C0004=targeting/marketing
        if (!Object.keys(states).length) {
          states['analytics_storage'] = groups.includes('C0002') ? 'granted' : 'denied';
          states['functionality_storage'] = groups.includes('C0003') ? 'granted' : 'denied';
          states['ad_storage'] = groups.includes('C0004') ? 'granted' : 'denied';
          states['ad_user_data'] = groups.includes('C0004') ? 'granted' : 'denied';
          states['ad_personalization'] = groups.includes('C0004') ? 'granted' : 'denied';
          __taglens_consentSource = 'OneTrust';
          return consentCategories.map(cat => ({ ...cat, state: states[cat.key] || 'not set' }));
        }
      }
    } catch (e) { /* ignore */ }

    // === PRIORITY 3: google_tag_data.ics (relayed via bridge) ===
    try {
      if (bridge && bridge.googleTagDataIcs) {
        const ics = bridge.googleTagDataIcs;
        consentCategories.forEach(cat => {
          if (!states[cat.key] && typeof ics[cat.key] === 'boolean') {
            states[cat.key] = ics[cat.key] ? 'granted' : 'denied';
          }
        });
        if (Object.keys(states).length) {
          __taglens_consentSource = 'Google Consent Mode (google_tag_data.ics)';
          return consentCategories.map(cat => ({ ...cat, state: states[cat.key] || 'not set' }));
        }
      }
    } catch (e) { /* ignore */ }

    const computed = consentCategories.map(cat => ({ ...cat, state: states[cat.key] || 'not set' }));

    // If we obtained at least one explicit state, cache and return
    try {
      const hasExplicit = computed.some(c => c.state && c.state !== 'not set');
      if (hasExplicit) {
        __taglens_lastConsentStates = computed;
        __taglens_lastConsentTs = Date.now();
        __taglens_consentSource = __taglens_consentSource || 'heuristic';
        return computed;
      }
    } catch (e) { /* ignore */ }

    // No explicit data this run — fall back to last known states if available
    try {
      if (__taglens_lastConsentStates && (Date.now() - __taglens_lastConsentTs) < 60 * 60 * 1000) {
        __taglens_consentSource = __taglens_consentSource || 'cached (last known reading)';
        // return cached states (within 1 hour)
        return __taglens_lastConsentStates;
      }
    } catch (e) { /* ignore */ }

    return computed;
  }

  // ============================================================
  // RUN FULL DETECTION (per-frame DOM findings only - cookies and
  // network-only tags are handled by background.js, which is the only
  // context with access to chrome.cookies / chrome.webRequest)
  // ============================================================
  function runDetection() {
    const detectedTrackers = [];
    TRACKERS.forEach(tracker => {
      try {
        const result = tracker.detect();
        if (result) {
          detectedTrackers.push({ name: tracker.name, icon: tracker.icon, ids: result });
        }
      } catch (e) { /* ignore */ }
    });

    __taglens_customTrackers.forEach(custom => {
      try {
        if (document.querySelector(`script[src*="${CSS.escape(custom.pattern)}"]`)) {
          detectedTrackers.push({ name: custom.name, icon: '🔧', ids: ['Detected'] });
        }
      } catch (e) { /* ignore */ }
    });

    const detectedCMPs = [];
    CMP_PLATFORMS.forEach(cmp => {
      try {
        const result = cmp.detect();
        if (result) {
          detectedCMPs.push({ name: cmp.name, icon: cmp.icon, id: result });
        }
      } catch (e) { /* ignore */ }
    });

    const consentStates = detectConsentStates();

    return {
      detectedTrackers,
      detectedCMPs,
      consentStates,
      consentSource: __taglens_consentSource,
      tcf: __taglens_tcf,
      url: window.location.href,
      timestamp: Date.now()
    };
  }

  // ============================================================
  // MESSAGE LISTENER - Respond to popup requests / background triggers
  // ============================================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getData') {
      try {
        const data = runDetection();
        sendResponse(data);
      } catch (e) { /* ignore */ }
      // Response sent synchronously.
      return false;
    }

    if (message.action === 'forceRecheck') {
      // Background saw a SPA soft-navigation (webNavigation.onHistoryStateUpdated)
      // and wants an immediate re-scan instead of waiting for the next poll.
      try { checkForChanges(true); } catch (e) { /* ignore */ }
      return false;
    }

    return false;
  });

  // ============================================================
  // AUTO-UPDATE: Watch for changes (new scripts, consent, SPA nav)
  // ============================================================
  let lastUrl = window.location.href;
  let lastScriptCount = document.querySelectorAll('script').length;
  let lastCookieString = document.cookie;
  let lastDetectedSignature = '';

  function generateTrackerSignature() {
    try {
      const found = [];
      TRACKERS.forEach(tracker => {
        try {
          const result = tracker.detect();
          if (result) {
            const ids = Array.isArray(result) ? result.slice() : [result];
            ids.sort();
            found.push({ name: tracker.name, ids });
          }
        } catch (e) { /* ignore */ }
      });
      // Sort by name for deterministic signature
      found.sort((a, b) => a.name.localeCompare(b.name));
      return JSON.stringify(found);
    } catch (e) { return '' + Date.now(); }
  }

  function notifyChange() {
    try {
      const data = runDetection();
      // Report this frame's DOM findings to background, which aggregates
      // across all frames of the tab, merges in network-detected trackers,
      // and is the only context that can read the real cookie jar.
      chrome.runtime.sendMessage({ action: 'frameDetection', payload: data }).catch(() => {});
    } catch (e) { /* background not reachable (e.g. extension reloading) */ }
  }

  function checkForChanges(force) {
    const currentUrl = window.location.href;
    const currentScriptCount = document.querySelectorAll('script').length;
    const currentCookies = document.cookie;

    // Quick tracker signature check to detect dynamically injected trackers
    const currentSignature = generateTrackerSignature();

    if (force || currentUrl !== lastUrl || currentScriptCount !== lastScriptCount || currentCookies !== lastCookieString || currentSignature !== lastDetectedSignature) {
      lastUrl = currentUrl;
      lastScriptCount = currentScriptCount;
      lastCookieString = currentCookies;
      lastDetectedSignature = currentSignature;
      notifyChange();
    }
  }

  // Poll every 2 seconds
  setInterval(checkForChanges, 2000);

  // SPA: Intercept History API
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function () {
    originalPushState.apply(this, arguments);
    setTimeout(() => { checkForChanges(); }, 800);
  };

  history.replaceState = function () {
    originalReplaceState.apply(this, arguments);
    setTimeout(() => { checkForChanges(); }, 800);
  };

  window.addEventListener('popstate', () => {
    setTimeout(() => { checkForChanges(); }, 800);
  });

  // MutationObserver: Watch for new scripts
  const observer = new MutationObserver((mutations) => {
    let changed = false;
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeName === 'SCRIPT') changed = true;
        if (node.querySelectorAll) {
          if (node.querySelectorAll('script').length > 0) changed = true;
        }
      });
    });
    if (changed) {
      setTimeout(notifyChange, 1500);
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Ask mainworld.js for an immediate CMP/dataLayer snapshot rather than
  // waiting for its next periodic tick.
  try { window.dispatchEvent(new CustomEvent('TagLens:requestSnapshot')); } catch (e) { /* ignore */ }

  // We inject at document_start so early inline consent-default pushes and
  // pushState overrides aren't missed - but that also means the very first
  // scan can run before the document has any content. Report once right
  // away (cheap, mostly empty), then force full re-scans once the DOM is
  // actually populated so SSR pages that stream in content are captured too.
  try { notifyChange(); } catch (e) { /* ignore */ }
  document.addEventListener('DOMContentLoaded', () => { try { checkForChanges(true); } catch (e) { /* ignore */ } });
  window.addEventListener('load', () => { try { checkForChanges(true); } catch (e) { /* ignore */ } });
  setTimeout(() => { try { checkForChanges(true); } catch (e) { /* ignore */ } }, 3000);

})();
