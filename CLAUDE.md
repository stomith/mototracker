# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vanilla JS PWA motorcycle ride tracker — no framework, no npm, no build step. Deployed to GitHub Pages.

## Files

- `index.html` — app shell, three `<section>` screens (home, active ride, detail)
- `app.js` — all application logic
- `style.css` — mobile-first styles, CSS custom properties in `:root`
- `manifest.json` — PWA manifest
- `sw.js` — service worker (cache-first shell, network-first map tiles)

## Running locally

Any static file server works:

```
python3 -m http.server 8080
```

Service worker and PWA install require HTTPS or `localhost`. GPS requires HTTPS in production.

## Architecture

Single-page app with manual screen switching — only one `.screen` has class `active` at a time, controlled by `showScreen(id)`.

**State** lives in two module-level variables:
- `activeRide` — null when idle, populated object during a ride; holds the Leaflet map instance, polyline, geolocation watch ID, timer interval, and wake lock
- `detailMap` — the Leaflet map instance on the detail screen; must be explicitly destroyed with `.remove()` before re-opening

**Data flow:** GPS fixes → `onGpsUpdate` → push to `activeRide.coordinates` → update HUD + Leaflet polyline → `dbPut` (incremental crash-safe persist). On end ride, `computeStats` runs once and is stored alongside the raw coordinates.

**Maps:** Leaflet 1.9.4 + CartoDB Dark Matter tiles (free, no API key). Tile URL in `TILE_URL` constant at top of `app.js`.

**Storage:** IndexedDB via bare Promise wrappers (`dbPut`, `dbGet`, `dbGetAll`, `dbDelete`). DB name `mototracker`, object store `rides`, indexed on `startTime`.

**Ride schema:**
```js
{ id, startTime, endTime, coordinates: [{lat, lng, timestamp, speed}], stats: {distance, duration, topSpeed, avgSpeed} }
```
- `id` is `Date.now()` at ride start
- `endTime` and `stats` are `null` during an active ride
- distances in miles, speeds in mph (conversion happens in `computeStats`)

## Icons

`manifest.json` references `icons/icon-192.png` and `icons/icon-512.png` — these need to be created. Without them the PWA installs but shows a blank icon.
