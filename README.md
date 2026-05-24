TagLens — Tracker & CMP Overlay (MV3) [Alpha]

Overview
- Lightweight Chrome extension (Manifest V3) that detects tracking scripts, CMPs, consent states (Google Consent Mode v2 mapping), and cookies on pages and shows results in a popup overlay.
- Live updates: listens to dataLayer pushes, script injection events, and SPA navigation to refresh results immediately.

Features
- Detects many widely-used trackers (GTM, GA4, Google Ads, Meta Pixel, TikTok, Microsoft Ads, LinkedIn, Twitter/X, Hotjar, Matomo, HubSpot, Segment, Criteo, Taboola, Outbrain, etc.).
- Extracts tracker IDs when available (e.g., G-, AW-, UA-, Meta Pixel IDs).
- Detects CMPs and reads consent where possible: Cookiebot, Usercentrics, OneTrust, Didomi, Klaro, and other common CMPs.
 - Robust dataLayer parsing: handles arrays, numeric-key objects, gtag-style events, and vendor-specific payloads. Updates popup live on consent changes.
 - (Debugging tools removed in this build.)

Install / Run (development)
1. Open Chrome and go to `chrome://extensions`.
2. Enable "Developer mode".
3. Click "Load unpacked" and select this repository folder (Tracking_Extension).
4. Click "Reload" after changes.

Required manifest permissions (development)
- `scripting` — used to execute a script in the page's main world to read Cookiebot consent without injecting inline scripts (avoids CSP errors).
- `storage` — for small settings.
- `activeTab` / `tabs` and appropriate `host_permissions` (or `<all_urls>`) to access page content during development.

Quick test
1. Load the extension as described above.
2. Open a site that uses GTM/CMP/Cookiebot.
3. Open the extension popup.
4. Accept or modify cookie consent on the site. The popup should update immediately (tracking scripts and consent states).

Notes
- If Cookiebot reads are failing due to CSP, ensure `scripting` permission exists in `manifest.json` and extension is reloaded.
- If the popup shows inconsistent states, open the page console and look for `TagLens`/`Cookiebot`/`dataLayer.consent` messages.

Developer notes
- `content.js` is the heart of detection: it scans scripts, global queues, and `window.dataLayer`, patches `dataLayer.push`, and runs a watcher to catch replacements.
- For Cookiebot we try a MAIN-world read via `chrome.scripting.executeScript` from the background service worker to avoid inline script CSP violations.
- `background.js` stores the latest detection payload to broadcast updates to the popup.
- `popup.js` listens for `dataUpdate` messages from the background and renders results live.

Contributing
- Feel free to add new tracker heuristics in `content.js` under the `TRACKERS` array.
- Keep detection fast and defensive (try/catch) — avoid throwing from the content script.

License
- MIT (add your preferred license file if needed).