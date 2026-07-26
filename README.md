TagLens — Tracker & CMP Inspector (MV3) [Alpha]

Overview
- Chrome extension (Manifest V3) that detects tracking scripts, CMPs, Google Consent Mode v2 state, IAB TCF v2 consent, and cookies on any page, shown live in a docked side panel (not a popup - it stays open while you browse).
- Handles SSR pages, SPA soft navigation, and tags that only fire after a cookie-consent banner is accepted (including ones fired purely from inside a GTM container, with no visible `<script>` tag).
- Toolbar badge shows the live tracker count; an Activity log timestamps new trackers and consent changes as they happen; one click exports a JSON report or clears cookies/cache/storage for the current site.

Architecture
- `manifest.json` — declares two content scripts per frame: `mainworld.js` (runs in the page's own JS world) and `content.js` (isolated world), plus the side panel, options page, and background service worker.
- `mainworld.js` — runs in the page's MAIN world, where `window.dataLayer`, `UC_UI`, `Didomi`, `klaro`, `OnetrustActiveGroups`, `google_tag_data.ics`, `__tcfapi` etc. actually live. Content scripts run in an *isolated* world and cannot see these globals directly, so this script reads them and relays the data to `content.js` via `CustomEvent`s (`TagLens:dataLayerEntry`, `TagLens:cmpSnapshot`, `TagLens:tcfData`).
- `content.js` — scans the DOM (script tags, inline script text) for tracker/CMP signatures, merges in the main-world bridge data for consent state, and reports per-frame findings to the background service worker. Also hooks `history.pushState`/`replaceState` and a `MutationObserver` as fast local change signals, and loads user-defined custom tracker patterns from `chrome.storage.sync`.
- `background.js` — the source of truth. Aggregates DOM findings from every frame of a tab, watches `chrome.webRequest` for tracker network requests (catches beacon/pixel-based tags that never touch the DOM, and extracts real tag IDs straight out of request query strings, e.g. `tid=G-XXXX`), reads the real cookie jar via `chrome.cookies` (sees `httpOnly` cookies `document.cookie` never could), and uses `chrome.webNavigation.onHistoryStateUpdated` to reliably detect SPA route changes and trigger a re-scan. Tracks first-seen timestamps for an activity log, updates the toolbar badge, filters out anything disabled in Settings, and handles `clearSiteData` via `chrome.browsingData.remove` (scoped strictly to the current origin - only dataTypes documented to respect per-origin scoping are used). Per-tab state persists across service-worker restarts via `chrome.storage.session`.
- `sidepanel.html` / `sidepanel.js` / `sidepanel.css` — the UI. Requests the aggregated snapshot from background via `getTabData`, and re-renders on `dataChanged` pushes or when the user switches/navigates tabs. Header buttons export a JSON report and clear site data (two-click confirm).
- `options.html` / `options.js` / `options.css` — Settings page (Chrome surfaces it automatically via the extension's context menu since `options_ui` is declared). Toggle individual trackers/CMPs off, or add custom domain-pattern trackers - both stored in `chrome.storage.sync` and picked up live by open tabs.

Install / Run (development)
1. Open Chrome and go to `chrome://extensions`.
2. Enable "Developer mode".
3. Click "Load unpacked" and select this folder.
4. Click "Reload" after changes (and refresh any already-open tabs, since existing content script instances aren't replaced automatically).
5. Click the TagLens toolbar icon to open the side panel.

Quick test
1. Load the extension as described above.
2. Open a site that uses GTM/GA4 + a consent banner (Cookiebot, OneTrust, Usercentrics, Didomi, Klaro, or Google Consent Mode v2).
3. Open the side panel and watch it update live as you accept/reject consent, or navigate within a single-page app.

Notes
- `webRequest` and `webNavigation` permissions are required for network-based tracker detection and SPA navigation handling.
- `chrome.cookies` is only available to the background service worker, not content scripts - that's why cookie detection lives in `background.js`.

Contributing
- Add new tracker heuristics under `TRACKERS` in `content.js`; add network-request patterns for the same tracker to `NETWORK_TRACKERS` in `background.js` (names must match so the UI can merge DOM- and network-detected entries).
- Add new CMPs under `CMP_PLATFORMS` in `content.js`. If the CMP exposes a consent API only reachable as a page-level JS global, read it in `mainworld.js` and relay it via `TagLens:cmpSnapshot` rather than reading `window.X` directly from `content.js` (it won't be visible there).
- Keep detection fast and defensive (try/catch) - avoid throwing from the content script.

License
- MIT (add your preferred license file if needed).
