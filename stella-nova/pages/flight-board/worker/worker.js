// ============================================================================
//  FLIGHT BOARD PROXY  ·  Cloudflare Worker for pages/flight-board
// ----------------------------------------------------------------------------
//  adsb.lol publishes live ADS-B positions for the whole world under the
//  ODbL, free and without a key. Its API sends no CORS header, so a browser
//  page on davesgames.io cannot read it. This Worker forwards two read-only
//  calls and adds the CORS header. It holds no key and keeps no state.
//
//    GET /point/{lat}/{lon}/{nm}   aircraft within nm (1..250) of a point
//    GET /hex/{hex}                one aircraft by its 24-bit ICAO address
//    GET /                         a short health text
//
//  Each upstream answer stays in the Cloudflare edge cache for CACHE_S
//  seconds, so many viewers of one airport share one upstream call.
//  Only ORIGINS (and localhost) get the CORS header.
//
//  Deploy:  cd stella-nova/pages/flight-board/worker && npx wrangler deploy
//  Local:   node dev-server.mjs   (the same handler on http://localhost:8787)
//
//  grep -n targets
//    allowed origins ...... "const ORIGINS"
//    route table .......... "function route"
//    upstream call ........ "async function upstream"
// ============================================================================

const UPSTREAM = 'https://api.adsb.lol/v2';
const CACHE_S = 5;
const ORIGINS = ['https://davesgames.io', 'https://www.davesgames.io'];
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

function cors(origin) {
  const ok = origin && (ORIGINS.includes(origin) || LOCAL.test(origin));
  return ok ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : { 'Vary': 'Origin' };
}

function route(path) {
  let m = path.match(/^\/point\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (m) {
    const lat = +m[1], lon = +m[2], nm = +m[3];
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || nm < 1 || nm > 250) return null;
    // Round the point so that viewers of one airport hit one cache key.
    return `${UPSTREAM}/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${Math.round(nm)}`;
  }
  m = path.match(/^\/hex\/(~?[0-9a-f]{6})$/i);
  if (m) return `${UPSTREAM}/hex/${m[1].toLowerCase()}`;
  return null;
}

async function upstream(url) {
  return fetch(url, {
    headers: { 'User-Agent': 'davesgames.io flight-board (+https://davesgames.io)', 'Accept': 'application/json' },
    cf: { cacheTtl: CACHE_S, cacheEverything: true },
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin');
    const h = cors(origin);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...h, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    }
    if (request.method !== 'GET') return new Response('GET only', { status: 405, headers: h });
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (path === '/') return new Response('flight-board proxy: /point/{lat}/{lon}/{nm}, /hex/{hex}\n', { headers: { ...h, 'Content-Type': 'text/plain' } });
    const url = route(path);
    if (!url) return new Response('bad path', { status: 404, headers: h });
    let res;
    try { res = await upstream(url); }
    catch (e) { return new Response(JSON.stringify({ error: 'upstream unreachable' }), { status: 502, headers: { ...h, 'Content-Type': 'application/json' } }); }
    return new Response(res.body, {
      status: res.status,
      headers: { ...h, 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_S}` },
    });
  },
};
