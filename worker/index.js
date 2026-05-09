const FOURSQUARE_API = 'https://places-api.foursquare.com/places/search';
const MAPBOX_TILE    = 'https://api.mapbox.com';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';

    // CORS — only allow requests from the GitHub Pages app
    const allowedOrigin = env.ALLOWED_ORIGIN ?? '';
    const corsHeaders = {
      'Access-Control-Allow-Origin':  allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ── /search?q=...&ll=lat,lng&limit=8 ──────────────────────────────────
    if (url.pathname === '/search') {
      const q     = url.searchParams.get('q');
      const ll    = url.searchParams.get('ll');
      const limit = url.searchParams.get('limit') ?? '8';

      if (!q) {
        return json({ error: 'Missing query parameter q' }, 400, corsHeaders);
      }

      const fsqUrl = new URL(FOURSQUARE_API);
      fsqUrl.searchParams.set('query', q);
      fsqUrl.searchParams.set('limit', limit);
      if (ll) fsqUrl.searchParams.set('ll', ll);

      let fsqRes;
      try {
        fsqRes = await fetch(fsqUrl.toString(), {
          headers: {
            'Authorization':      `Bearer ${env.FOURSQUARE_API_KEY}`,
            'X-Places-Api-Version': '2025-06-17',
            'Accept':             'application/json',
          },
        });
      } catch (err) {
        return json({ error: 'Foursquare fetch failed', detail: err.message }, 502, corsHeaders);
      }

      const data = await fsqRes.json();
      return json(data, fsqRes.status, corsHeaders);
    }

    // ── /tiles/* — proxy Mapbox tile + style requests ─────────────────────
    if (url.pathname.startsWith('/tiles/')) {
      const mapboxPath = url.pathname.replace('/tiles', '');
      const mapboxUrl  = new URL(MAPBOX_TILE + mapboxPath + url.search);
      mapboxUrl.searchParams.set('access_token', env.MAPBOX_API_KEY);

      const tileRes = await fetch(mapboxUrl.toString(), { cf: { cacheEverything: true, cacheTtl: 86400 } });
      const headers = new Headers(tileRes.headers);
      headers.set('Access-Control-Allow-Origin', allowedOrigin);
      return new Response(tileRes.body, { status: tileRes.status, headers });
    }

    return json({ error: 'Not found' }, 404, corsHeaders);
  }
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
