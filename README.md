# MotoTracker

A PWA motorcycle ride tracker. Records GPS tracks in real time, stores rides locally in IndexedDB, and displays routes and stats. No framework, no build pipeline — vanilla HTML, CSS, and JavaScript served from GitHub Pages.

## Accounts required

| Service | Purpose | Free tier |
|---|---|---|
| [GitHub](https://github.com) | Hosts the app via GitHub Pages | Yes |
| [Cloudflare](https://cloudflare.com) | Workers proxy for API keys | Yes |
| [Foursquare](https://foursquare.com/developers) | POI / place search | Yes |
| [Mapbox](https://mapbox.com) | Map tiles (better styling than OSM) | Yes (50k loads/mo) |

## Local prerequisites

- **Node.js** — needed to install and run `wrangler` (Cloudflare's CLI). Install via Homebrew: `brew install node`
- **wrangler** — Cloudflare Worker CLI. Install globally: `npm install -g wrangler`
- **git**

## Project structure

```
mototracker/
├── index.html       # App shell, three screens
├── app.js           # All application logic
├── style.css        # Mobile-first styles
├── manifest.json    # PWA manifest
├── sw.js            # Service worker (offline support)
├── icons/           # icon-192.png and icon-512.png (not committed)
└── worker/          # Cloudflare Worker (proxies Foursquare + Mapbox)
    └── index.js
```

## GitHub Pages setup

1. Push the repo to GitHub
2. Go to **Settings → Pages → Source**: deploy from branch `main` / `/ (root)`
3. Site will be live at `https://<username>.github.io/mototracker/`

## Cloudflare Worker setup

The Worker keeps API keys off GitHub by proxying requests to Foursquare and Mapbox server-side.

### First-time setup

```bash
npm install -g wrangler
wrangler login
```

### Deploy

```bash
cd worker
wrangler deploy
```

### Add secrets (API keys — never commit these)

```bash
wrangler secret put FOURSQUARE_API_KEY
wrangler secret put MAPBOX_API_KEY
```

Each command will prompt you to paste the key. Keys are stored in Cloudflare's environment and never appear in code or git history.

### Worker URL

After deploying, Cloudflare gives you a URL like:
`https://mototracker-worker.<your-subdomain>.workers.dev`

Update `WORKER_URL` in `app.js` to point to it.

## Icons

`manifest.json` expects `icons/icon-192.png` and `icons/icon-512.png`. Generate them at [maskable.app](https://maskable.app) and drop them in the `icons/` folder. Without them the PWA installs but shows a blank home screen icon.

## Architecture notes

See `CLAUDE.md` for a full breakdown of the code architecture, data model, and key design decisions.
