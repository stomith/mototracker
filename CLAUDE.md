# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vanilla JS PWA motorcycle ride tracker — no framework, no npm, no build step. Deployed to GitHub Pages at `https://stomith.github.io/mototracker/`.

## Files

- `index.html` — app shell; persistent map + overlays + drawers + detail screen
- `app.js` — all application logic
- `style.css` — mobile-first styles, CSS custom properties in `:root`
- `manifest.json` — PWA manifest (`start_url: /mototracker/`)
- `sw.js` — service worker (cache-first shell, network-first map tiles)
- `worker/index.js` — Cloudflare Worker that proxies Foursquare and Mapbox requests
- `worker/wrangler.toml` — Worker config (`name: mototracker-worker`)

## Running locally

```
python3 -m http.server 8080
```

Service worker and PWA install require HTTPS or `localhost`. GPS requires HTTPS in production.

## Architecture

**Single persistent map** — one Leaflet map instance (`map`) lives for the lifetime of the page. UI state is controlled by showing/hiding overlay `div`s on top of it, not by swapping screens.

### UI layers (bottom to top, z-index)

| z-index | Element | Purpose |
|---|---|---|
| 0 | `#map` | Leaflet map, always visible |
| 100 | `#overlay-home` / `#overlay-active` | Bottom overlay, swaps on ride start/end |
| 200 | `#map-buttons` | Floating recenter + search buttons |
| 300 | `#drawer-backdrop` | Scrim behind open drawers |
| 400 | `.drawer` | Past rides + search bottom drawers |
| 500 | `#screen-detail` | Full-screen ride detail overlay |

**Important:** CSS `display: flex` on `.screen` overrides the HTML `hidden` attribute — `[hidden] { display: none !important }` is required in the reset to prevent detail screen showing on load.

### State variables

- `map` — the single Leaflet map instance, initialized at boot
- `activeRide` — null when idle; during a ride holds `{ id, startTime, coordinates, polyline, watchId, timerInterval, wakeLock, paused, pausedMs, pauseStart }`
- `detailMap` — separate Leaflet instance inside `#screen-detail`; must be `.remove()`d before re-opening
- `searchPin` — Leaflet marker for the current Foursquare search result; removed on new search or ride end

### Data flow

GPS fixes → `onGpsUpdate` → push to `activeRide.coordinates` → update HUD + `polyline.addLatLng` → `dbPut` (incremental, crash-safe). On end ride, `computeStats` runs once and is stored with the ride.

### Pause/resume

Elapsed time is tracked as `(Date.now() - startTime) - pausedMs`. On pause, `pauseStart` is recorded. On resume, `pausedMs += Date.now() - pauseStart`. Stats use the corrected elapsed time, not wall-clock duration.

### Maps

Leaflet 1.9.4 + CartoDB Dark Matter tiles (free, no API key required). `TILE_URL` and `TILE_ATTR` constants at top of `app.js`.

### Storage

IndexedDB via bare Promise wrappers (`dbPut`, `dbGet`, `dbGetAll`, `dbDelete`). DB name `mototracker`, object store `rides`, indexed on `startTime`.

**Ride schema:**
```js
{ id, startTime, endTime, coordinates: [{lat, lng, timestamp, speed}], stats: {distance, duration, topSpeed, avgSpeed} }
```
- `id` is `Date.now()` at ride start
- `endTime` and `stats` are `null` during an active ride
- distances in miles, speeds in mph

## Cloudflare Worker

Live at `https://mototracker-worker.stomith.workers.dev`. Deploy with:

```
wrangler deploy --cwd worker
```

**Routes:**
- `GET /search?q=...&ll=lat,lng` — proxies Foursquare Places API v3 (`places-api.foursquare.com`). Authorization header: `Bearer <key>`, version header: `X-Places-Api-Version: 2025-06-17`
- `GET /tiles/*` — proxies Mapbox tile/style requests (for future use)

**Secrets** (stored in Cloudflare, never in code):
```
wrangler secret put FOURSQUARE_API_KEY --cwd worker
wrangler secret put MAPBOX_API_KEY --cwd worker
```

**Known limitation:** The Worker URL is public in `app.js`, so anyone can call it directly. CORS and Referer checks are bypassable. Auth (shared secret or OAuth) is a planned next step.

## Icons

`manifest.json` references `icons/icon-192.png` and `icons/icon-512.png` — not yet created. Generate at [maskable.app](https://maskable.app).
