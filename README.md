# 🔍 TagLens

**See exactly what's tracking you — trackers, consent tools, and cookies, live, on any page.**

![Manifest V3](https://img.shields.io/badge/Manifest-V3-6366f1?style=flat-square)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-22d3ee?style=flat-square)
![License: MIT](https://img.shields.io/badge/License-MIT-a78bfa?style=flat-square)
![Status](https://img.shields.io/badge/status-alpha-f472b6?style=flat-square)

TagLens is a Manifest V3 Chrome extension that inspects any webpage and shows you, in a docked side panel that stays open while you browse:

- which **tracking scripts** are loaded (GA4, Google Ads, Meta Pixel, TikTok, Microsoft/Bing UET, Hotjar, and 15+ more) — including tags fired asynchronously from inside a GTM container that never touch the DOM
- which **consent management platform** (CMP) is running (Cookiebot, OneTrust, Usercentrics, Didomi, Klaro, and a dozen others)
- the live **Google Consent Mode v2** state (granted / denied / not set, per category) and **IAB TCF v2** purpose/vendor consent
- every **cookie** on the page — including `httpOnly` ones a page's own JavaScript can never see — and who it belongs to

It's built to handle the cases that trip up most tag inspectors: **SSR pages**, **SPA soft navigation**, and tags that only fire **after** a cookie banner is accepted.

---

## ✨ Features

| | |
|---|---|
| 🔎 **Tracking scripts** | Detects 20+ trackers by script signature *and* live network requests, extracting real tag IDs (`G-XXXX`, `AW-XXXX`, ...) even when a tag fires purely inside a GTM container |
| 🛡️ **CMP detection** | Recognizes 17 major consent platforms |
| ⚙️ **Consent Mode v2** | Live granted/denied per category, with the source of the reading (dataLayer, Cookiebot, OneTrust, ...) |
| 📜 **IAB TCF v2** | Decodes purpose consents, vendor consent ratio, and GDPR applicability where a CMP implements it |
| 🍪 **Cookies** | Full cookie jar via `chrome.cookies`, including `httpOnly`/`secure` flags and best-guess service ownership |
| 📡 **Activity log** | Timestamped feed of new trackers appearing and consent states changing, live |
| 🔢 **Toolbar badge** | Tracker count at a glance, no need to open the panel |
| 📤 **Export** | One click to download the current findings as a JSON report |
| 🧹 **Clear site data** | Wipes cookies, cache, and storage for the current site only (two-click confirm) |
| ⚡ **Live updates** | Side panel stays open and updates as you browse — SPA route changes, async GTM tags, and post-consent tags all refresh automatically |
| 🎛️ **Settings** | Toggle individual trackers/CMPs off, or add your own custom domain patterns |

---

## 🚀 Install (development)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Click the TagLens icon in the toolbar to open the side panel

> After editing source files, click **Reload** on the extension card *and* refresh any already-open tabs — existing content script instances aren't replaced automatically.

### Try it

Open a site that uses GTM/GA4 with a consent banner (Cookiebot, OneTrust, Usercentrics, Didomi, Klaro, or plain Google Consent Mode v2), open the side panel, and accept/reject consent — trackers, consent state, and the activity log all update live, including tags that only start firing after you click Accept.

---

## 🧩 How it works

| File | Runs in | Responsibility |
|---|---|---|
| `manifest.json` | — | Declares two content scripts per frame, the side panel, options page, and background service worker |
| `mainworld.js` | Page's own JS world | Reads `window.dataLayer`, `UC_UI`, `Didomi`, `klaro`, `OnetrustActiveGroups`, `google_tag_data.ics`, `__tcfapi` — globals that are otherwise invisible from a content script — and relays them via `CustomEvent` |
| `content.js` | Isolated world | Scans the DOM for tracker/CMP script signatures, merges in the main-world bridge data, reports per-frame findings to the background worker; hooks `pushState`/`replaceState` and a `MutationObserver` as fast local change signals |
| `background.js` | Service worker | Source of truth. Aggregates every frame's findings, watches `chrome.webRequest` for network-only tags and extracts real IDs from request URLs, reads the true cookie jar via `chrome.cookies`, detects SPA navigation via `chrome.webNavigation`, maintains the activity log and toolbar badge, and handles `clearSiteData` |
| `sidepanel.*` | Extension page | The UI — requests the aggregated snapshot from background and re-renders on live push updates or tab switches |
| `options.*` | Extension page | Settings — toggle detectors, add custom tracker patterns, synced via `chrome.storage.sync` |

**Why two content scripts per frame?** Content scripts run in an *isolated* JS world — they share the page's DOM but not its JavaScript globals. `window.dataLayer` (and every CMP's own consent API) lives in the page's *main* world and is invisible to a normal content script. `mainworld.js` runs there instead and relays what it reads across the world boundary via DOM `CustomEvent`s.

---

## 🔐 Permissions

| Permission | Why |
|---|---|
| `activeTab`, `tabs` | Know which page the side panel is currently inspecting |
| `scripting` | Read `Cookiebot.consent` safely in the page's main world |
| `cookies` | Read the real cookie jar, including `httpOnly` cookies |
| `webRequest` | Detect trackers that fire via network request only (no visible script) |
| `webNavigation` | Detect SPA route changes reliably |
| `storage` | Persist per-tab state across service-worker restarts, and sync your Settings |
| `sidePanel` | Show the docked panel UI |
| `browsingData` | Power the "Clear site data" button, scoped strictly to the current origin |
| `<all_urls>` (host) | Inspect any page you visit |

## 🕵️ Privacy

TagLens only *reads* what's on the page you're currently looking at. Nothing is sent anywhere — there's no analytics, no remote server, no telemetry. All the data it shows you stays local to your browser.

---

## 🤝 Contributing

- Add new tracker heuristics under `TRACKERS` in `content.js`; add a matching network-request pattern to `NETWORK_TRACKERS` in `background.js` (names must match so the UI can merge DOM- and network-detected entries).
- Add new CMPs under `CMP_PLATFORMS` in `content.js`. If the CMP's consent API is only reachable as a page-level JS global, read it in `mainworld.js` and relay it via `TagLens:cmpSnapshot` — reading `window.X` directly from `content.js` won't work.
- If you add a tracker/CMP to `content.js`, also add it to the checklist in `options.js` (small intentional duplication — see the comment there).
- Keep detection fast and defensive (`try`/`catch` everywhere) — never let the content script throw.

## 📄 License

[MIT](LICENSE) © 2026 Michael Eder
