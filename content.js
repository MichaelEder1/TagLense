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
        // Also check dataLayer and gtag queue for dynamic config calls
        try {
          if (window.dataLayer && Array.isArray(window.dataLayer)) {
            window.dataLayer.forEach(entry => {
              try {
                if (Array.isArray(entry) && entry[0] === 'config' && typeof entry[1] === 'string') {
                  const m = entry[1].match(/G-[A-Z0-9]+/);
                  if (m && !ids.includes(m[0])) ids.push(m[0]);
                }
                if (entry && typeof entry === 'object') {
                  const txt = JSON.stringify(entry);
                  const m2 = txt.match(/G-[A-Z0-9]+/g);
                  if (m2) m2.forEach(mid => { if (!ids.includes(mid)) ids.push(mid); });
                }
              } catch (e) { /* ignore */ }
            });
          }
        } catch (e) { /* ignore */ }
        try {
          if (window.gtag && Array.isArray(window.gtag.q)) {
            window.gtag.q.forEach(q => {
              try {
                if (Array.isArray(q) && q[0] === 'config' && typeof q[1] === 'string') {
                  const m = q[1].match(/G-[A-Z0-9]+/);
                  if (m && !ids.includes(m[0])) ids.push(m[0]);
                }
              } catch (e) { /* ignore */ }
            });
          }
        } catch (e) { /* ignore */ }
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
        // Also inspect dataLayer and gtag queue for dynamic gtag config calls (AW-...)
        try {
          if (window.dataLayer && Array.isArray(window.dataLayer)) {
            window.dataLayer.forEach(entry => {
              try {
                if (Array.isArray(entry) && entry[0] === 'config' && typeof entry[1] === 'string') {
                  const m = entry[1].match(/AW-[0-9]+/);
                  if (m && !ids.includes(m[0])) ids.push(m[0]);
                }
                // Some implementations push objects with 'config' calls as arrays nested inside
                if (entry && typeof entry === 'object') {
                  const txt = JSON.stringify(entry);
                  const m2 = txt.match(/AW-[0-9]+/g);
                  if (m2) m2.forEach(mid => { if (!ids.includes(mid)) ids.push(mid); });
                }
              } catch (e) { /* ignore entry parse errors */ }
            });
          }
        } catch (e) { /* ignore */ }

        try {
          if (window.gtag && Array.isArray(window.gtag.q)) {
            window.gtag.q.forEach(q => {
              try {
                if (Array.isArray(q) && q[0] === 'config' && typeof q[1] === 'string') {
                  const m = q[1].match(/AW-[0-9]+/);
                  if (m && !ids.includes(m[0])) ids.push(m[0]);
                }
              } catch (e) { /* ignore */ }
            });
          }
        } catch (e) { /* ignore */ }
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
        // Try to read active trackers via ga.getAll()
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
        // Fallback: search dataLayer for UA- strings
        try {
          if (window.dataLayer && Array.isArray(window.dataLayer)) {
            window.dataLayer.forEach(entry => {
              try {
                const txt = JSON.stringify(entry);
                const m = txt.match(/UA-[0-9]+-[0-9]+/g);
                if (m) m.forEach(mid => { if (!ids.includes(mid)) ids.push(mid); });
              } catch (e) { /* ignore */ }
            });
          }
        } catch (e) { /* ignore */ }
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
    }
  ];

  // ============================================================
  // KNOWN COOKIE-TO-SERVICE MAPPING
  // ============================================================
  const COOKIE_SERVICE_MAP = {
    '_ga': 'Google Analytics',
    '_ga_': 'Google Analytics 4',
    '_gid': 'Google Analytics',
    '_gat': 'Google Analytics',
    '_gcl_au': 'Google Ads',
    '_gcl_aw': 'Google Ads',
    '_gac_': 'Google Ads',
    '_fbp': 'Meta/Facebook',
    '_fbc': 'Meta/Facebook',
    'fr': 'Meta/Facebook',
    '_ttp': 'TikTok',
    '_tt_enable_cookie': 'TikTok',
    'MUID': 'Microsoft',
    '_uetsid': 'Microsoft Ads',
    '_uetvid': 'Microsoft Ads',
    '_clck': 'Microsoft Clarity',
    '_clsk': 'Microsoft Clarity',
    'li_sugr': 'LinkedIn',
    'bcookie': 'LinkedIn',
    'lidc': 'LinkedIn',
    '_pin_unauth': 'Pinterest',
    'IDE': 'Google DoubleClick',
    'test_cookie': 'Google DoubleClick',
    'NID': 'Google',
    '1P_JAR': 'Google',
    'CONSENT': 'Google',
    '_hjid': 'Hotjar',
    '_hjSessionUser': 'Hotjar',
    '_hjSession': 'Hotjar',
    '_hjAbsoluteSessionInProgress': 'Hotjar',
    'hubspotutk': 'HubSpot',
    '__hssc': 'HubSpot',
    '__hssrc': 'HubSpot',
    '__hstc': 'HubSpot',
    'CookieConsent': 'Cookiebot',
    'OptanonConsent': 'OneTrust',
    'OptanonAlertBoxClosed': 'OneTrust',
    'eupubconsent-v2': 'IAB TCF v2',
    'didomi_token': 'Didomi',
    'uc_settings': 'Usercentrics',
    'ajs_anonymous_id': 'Segment',
    'mp_': 'Mixpanel',
    'amplitude_id': 'Amplitude',
    '_pk_id': 'Matomo',
    '_pk_ses': 'Matomo',
    'crit': 'Criteo',
    'cto_bundle': 'Criteo',
    '__adroll': 'AdRoll',
    '_scid': 'Snapchat',
    'sc_at': 'Snapchat',
    'personalization_id': 'Twitter/X',
    'guest_id': 'Twitter/X',
    'YSC': 'YouTube',
    'VISITOR_INFO1_LIVE': 'YouTube',
    'wp-settings': 'WordPress',
    'wordpress_logged_in': 'WordPress',
    'PHPSESSID': 'PHP Session',
    'JSESSIONID': 'Java Session',
    'ASP.NET_SessionId': 'ASP.NET Session',
    'cf_clearance': 'Cloudflare',
    '__cf_bm': 'Cloudflare',
  };

  function getServiceForCookie(cookieName) {
    if (COOKIE_SERVICE_MAP[cookieName]) return COOKIE_SERVICE_MAP[cookieName];
    for (const [prefix, service] of Object.entries(COOKIE_SERVICE_MAP)) {
      if (prefix.endsWith('_') && cookieName.startsWith(prefix)) return service;
    }
    return null;
  }

    // Debugging removed: debug forwarding and helpers disabled

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

  // DataLayer consent cache and hooks
  let __taglens_dataLayerConsent = null;
  let __taglens_dataLayerConsentTs = 0;
  let __taglens_dataLayerLastIndex = 0;
  let __taglens_dataLayerWatcherId = null;

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
        const sig = JSON.stringify(normalized);
        if (!__taglens_dataLayerConsent || JSON.stringify(__taglens_dataLayerConsent) !== sig) {
          __taglens_dataLayerConsent = normalized;
          __taglens_dataLayerConsentTs = Date.now();
          // dataLayer consent parsed
          try { notifyChange(); } catch (e) { /* ignore */ }
        }
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function hookDataLayer() {
    try {
      if (window.dataLayer && Array.isArray(window.dataLayer)) {
        // process historical entries
        try { window.dataLayer.forEach(e => updateDataLayerConsentFromEntry(e)); } catch (e) { /* ignore */ }

        // monkeypatch push to observe future entries
        try {
          const origPush = window.dataLayer.push.bind(window.dataLayer);
          if (!origPush.__taglens_patched) {
            const patched = function () {
              const args = Array.from(arguments);
              let res = null;
              try { res = origPush.apply(null, args); } catch (e) { try { res = origPush.apply(window.dataLayer, args); } catch (e2) { /* ignore */ } }
              try { args.forEach(a => updateDataLayerConsentFromEntry(a)); } catch (e) { /* ignore */ }
              return res;
            };
            patched.__taglens_patched = true;
            try { window.dataLayer.push = patched; } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore */ }
        // start a persistent watcher to catch replacements or missed pushes
        try { startDataLayerWatcher(); } catch (e) { /* ignore */ }
        return true;
      }
      // If dataLayer not present yet, watch for its creation briefly
      let tries = 0;
      const intv = setInterval(() => {
        tries++;
        if (window.dataLayer && Array.isArray(window.dataLayer)) {
          clearInterval(intv);
          hookDataLayer();
        } else if (tries > 20) {
          clearInterval(intv);
        }
      }, 250);
    } catch (e) { /* ignore */ }
    return false;
  }

  function startDataLayerWatcher() {
    try {
      if (__taglens_dataLayerWatcherId) return;
      __taglens_dataLayerLastIndex = 0;
      // If dataLayer exists now, set last index to its length
      if (window.dataLayer && Array.isArray(window.dataLayer)) {
        __taglens_dataLayerLastIndex = window.dataLayer.length;
      }
      __taglens_dataLayerWatcherId = setInterval(() => {
        try {
          if (!window.dataLayer || !Array.isArray(window.dataLayer)) {
            // dataLayer might be recreated; reset index
            __taglens_dataLayerLastIndex = 0;
            return;
          }
          const len = window.dataLayer.length;
          if (len > __taglens_dataLayerLastIndex) {
            for (let i = __taglens_dataLayerLastIndex; i < len; i++) {
              try { updateDataLayerConsentFromEntry(window.dataLayer[i]); } catch (e) { /* ignore */ }
            }
            __taglens_dataLayerLastIndex = len;
          }
          // If dataLayer was replaced with a shorter/new array, process its entries from start
          if (len < __taglens_dataLayerLastIndex) {
            try { window.dataLayer.forEach(entry => updateDataLayerConsentFromEntry(entry)); } catch (e) { /* ignore */ }
            __taglens_dataLayerLastIndex = len;
          }
        } catch (e) { /* ignore */ }
      }, 500);
    } catch (e) { /* ignore */ }
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

    // Highest priority: dataLayer-derived consent (live updates)
    try {
      // Actively scan the current dataLayer entries to pick up consent pushes that may have occurred
      try {
        if (window.dataLayer && Array.isArray(window.dataLayer)) {
          window.dataLayer.forEach(entry => { try { updateDataLayerConsentFromEntry(entry); } catch (e) { /* ignore */ } });
        }
      } catch (e) { /* ignore */ }

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
          // consent source: dataLayer
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
        return consentCategories.map(cat => ({ ...cat, state: states[cat.key] || 'not set' }));
      }
    } catch (e) { /* ignore */ }

    // Usercentrics: Call UC_UI methods to get consent status
    try {
      if (window.UC_UI && typeof window.UC_UI.getServices === 'function') {
        try {
          const services = window.UC_UI.getServices();
          if (services && Array.isArray(services)) {
            // Find consent categories in services
            let hasAnalytics = false, hasMarketing = false, hasPreferences = false;
            services.forEach(s => {
              if (s.consent === true || s.status === 'ACCEPTED') {
                if (s.categorySlug === 'analytics') hasAnalytics = true;
                if (s.categorySlug === 'marketing') hasMarketing = true;
                if (s.categorySlug === 'preferences') hasPreferences = true;
              }
            });
            if (!Object.keys(states).length) {
              states['analytics_storage'] = hasAnalytics ? 'granted' : 'denied';
              states['ad_storage'] = hasMarketing ? 'granted' : 'denied';
              states['ad_user_data'] = hasMarketing ? 'granted' : 'denied';
              states['ad_personalization'] = hasMarketing ? 'granted' : 'denied';
              states['functionality_storage'] = hasPreferences ? 'granted' : 'denied';
              states['personalization_storage'] = hasPreferences ? 'granted' : 'denied';
              return consentCategories.map(cat => ({ ...cat, state: states[cat.key] || 'not set' }));
            }
          }
        } catch (e) { /* try alternative UC_UI method */ }
      }
    } catch (e) { /* ignore */ }

    // Didomi: Call Didomi API to get consent status
    try {
      if (window.Didomi && typeof window.Didomi.isConsentRequired === 'function') {
        const purposes = ['analytics', 'marketing', 'functional'];
        let analytics = false, marketing = false, functional = false;
        try {
          if (typeof window.Didomi.getUserConsentStatusForPurpose === 'function') {
            analytics = window.Didomi.getUserConsentStatusForPurpose('analytics') === true;
            marketing = window.Didomi.getUserConsentStatusForPurpose('marketing') === true;
            functional = window.Didomi.getUserConsentStatusForPurpose('functional') === true;
            if (!Object.keys(states).length) {
              states['analytics_storage'] = analytics ? 'granted' : 'denied';
              states['ad_storage'] = marketing ? 'granted' : 'denied';
              states['ad_user_data'] = marketing ? 'granted' : 'denied';
              states['ad_personalization'] = marketing ? 'granted' : 'denied';
              states['functionality_storage'] = functional ? 'granted' : 'denied';
              states['personalization_storage'] = functional ? 'granted' : 'denied';
              return consentCategories.map(cat => ({ ...cat, state: states[cat.key] || 'not set' }));
            }
          }
        } catch (e) { /* fallback */ }
      }
    } catch (e) { /* ignore */ }

    // Klaro: Call klaro API to get cookie consents
    try {
      if (window.klaro && typeof window.klaro.getCookieConsents === 'function') {
        const consents = window.klaro.getCookieConsents();
        if (consents && typeof consents === 'object') {
          let hasAnalytics = false, hasMarketing = false, hasRequired = false;
          Object.keys(consents).forEach(key => {
            if (consents[key] === true) {
              if (key.toLowerCase().includes('analytics') || key.toLowerCase().includes('google')) hasAnalytics = true;
              if (key.toLowerCase().includes('marketing') || key.toLowerCase().includes('facebook') || key.toLowerCase().includes('ads')) hasMarketing = true;
              if (key.toLowerCase().includes('required') || key.toLowerCase().includes('necessary')) hasRequired = true;
            }
          });
          if (!Object.keys(states).length) {
            states['analytics_storage'] = hasAnalytics ? 'granted' : 'denied';
            states['ad_storage'] = hasMarketing ? 'granted' : 'denied';
            states['ad_user_data'] = hasMarketing ? 'granted' : 'denied';
            states['ad_personalization'] = hasMarketing ? 'granted' : 'denied';
            states['functionality_storage'] = hasRequired ? 'granted' : 'denied';
            states['personalization_storage'] = hasRequired ? 'granted' : 'denied';
            return consentCategories.map(cat => ({ ...cat, state: states[cat.key] || 'not set' }));
          }
        }
      }
    } catch (e) { /* ignore */ }

    // === PRIORITY 2: OneTrust Active Groups ===
    try {
      if (window.OnetrustActiveGroups || window.OptanonActiveGroups) {
        const groups = (window.OnetrustActiveGroups || window.OptanonActiveGroups || '').split(',').filter(Boolean);
        // OneTrust groups: C0001=necessary, C0002=performance/analytics, C0003=functional, C0004=targeting/marketing
        if (!Object.keys(states).length) {
          states['analytics_storage'] = groups.includes('C0002') ? 'granted' : 'denied';
          states['functionality_storage'] = groups.includes('C0003') ? 'granted' : 'denied';
          states['ad_storage'] = groups.includes('C0004') ? 'granted' : 'denied';
          states['ad_user_data'] = groups.includes('C0004') ? 'granted' : 'denied';
          states['ad_personalization'] = groups.includes('C0004') ? 'granted' : 'denied';
          return consentCategories.map(cat => ({ ...cat, state: states[cat.key] || 'not set' }));
        }
      }
    } catch (e) { /* ignore */ }

    // === PRIORITY 3: dataLayer (Google Tag Manager format) ===
    try {
      if (window.dataLayer && Array.isArray(window.dataLayer)) {
        let foundUpdate = false;
        for (let i = window.dataLayer.length - 1; i >= 0; i--) {
          const entry = window.dataLayer[i];
          if (!entry) continue;

          let action = null;
          let consentData = null;

          // Format A: Object with numeric keys {"0": "consent", "1": "update", "2": {...}}
          if (entry['0'] === 'consent' && (entry['1'] === 'update' || entry['1'] === 'default')) {
            action = entry['1'];
            consentData = entry['2'];
          }
          // Format B: Actual array ["consent", "update", {...}]
          else if (Array.isArray(entry) && entry[0] === 'consent' && (entry[1] === 'update' || entry[1] === 'default')) {
            action = entry[1];
            consentData = entry[2];
          }
          // Format C: gtag-style event
          else if (entry.event === 'consent_update' || entry.event === 'consent_default') {
            action = entry.event.includes('update') ? 'update' : 'default';
            consentData = entry;
          }

          if (consentData && typeof consentData === 'object') {
            if (action === 'update' && !foundUpdate) {
              consentCategories.forEach(cat => {
                if (consentData[cat.key]) {
                  states[cat.key] = consentData[cat.key];
                }
              });
              foundUpdate = true;
              break;
            }
          }
        }
        if (Object.keys(states).length) {
          return consentCategories.map(cat => ({ ...cat, state: states[cat.key] || 'not set' }));
        }
      }
    } catch (e) { /* ignore */ }

    // === PRIORITY 4: google_tag_data.ics ===
    try {
      if (window.google_tag_data && window.google_tag_data.ics && window.google_tag_data.ics.entries) {
        const ics = window.google_tag_data.ics;
        consentCategories.forEach(cat => {
          if (!states[cat.key]) {
            const entry = ics.entries[cat.key];
            if (entry) {
              if (typeof entry.update !== 'undefined') {
                states[cat.key] = entry.update ? 'granted' : 'denied';
              } else if (typeof entry.default !== 'undefined') {
                states[cat.key] = entry.default ? 'granted' : 'denied';
              }
            }
          }
        });
        if (Object.keys(states).length) {
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
        return computed;
      }
    } catch (e) { /* ignore */ }

    // No explicit data this run — fall back to last known states if available
    try {
      if (__taglens_lastConsentStates && (Date.now() - __taglens_lastConsentTs) < 60 * 60 * 1000) {
        // return cached states (within 1 hour)
        return __taglens_lastConsentStates;
      }
    } catch (e) { /* ignore */ }

    return computed;
  }

  // ============================================================
  // COOKIE DETECTION
  // ============================================================
  function detectCookies() {
    const cookies = [];
    const cookieString = document.cookie;
    if (cookieString) {
      cookieString.split(';').forEach(cookie => {
        const parts = cookie.trim().split('=');
        const name = parts[0];
        const value = parts.slice(1).join('=');
        cookies.push({
          name: name,
          value: value.length > 60 ? value.substring(0, 60) + '...' : value,
          service: getServiceForCookie(name) || 'Unknown'
        });
      });
    }
    return cookies.sort((a, b) => {
      if (a.service === 'Unknown' && b.service !== 'Unknown') return 1;
      if (a.service !== 'Unknown' && b.service === 'Unknown') return -1;
      return a.service.localeCompare(b.service);
    });
  }

  // ============================================================
  // RUN FULL DETECTION
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
    const cookies = detectCookies();

    return {
      detectedTrackers,
      detectedCMPs,
      consentStates,
      cookies,
      url: window.location.href,
      timestamp: Date.now()
    };
  }

  // ============================================================
  // MESSAGE LISTENER - Respond to popup requests
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
      // Send a lightweight notification and also push the full data to background for immediate popup update
      try {
        const data = runDetection();
        chrome.runtime.sendMessage({ action: 'dataUpdate', payload: data });
      } catch (e) { /* ignore runDetection errors */ }
      chrome.runtime.sendMessage({ action: 'dataChanged' });
    } catch (e) { /* popup not open */ }
  }

  function checkForChanges() {
    const currentUrl = window.location.href;
    const currentScriptCount = document.querySelectorAll('script').length;
    const currentCookies = document.cookie;

    // Quick tracker signature check to detect dynamically injected trackers
    const currentSignature = generateTrackerSignature();

    if (currentUrl !== lastUrl || currentScriptCount !== lastScriptCount || currentCookies !== lastCookieString || currentSignature !== lastDetectedSignature) {
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
  // Start observing dataLayer for consent events
  try { hookDataLayer(); } catch (e) { /* ignore */ }

})();
