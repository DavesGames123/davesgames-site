// WEATHER MAP · data/radar.js — RainViewer radar frame list and tile URLs.
// No DOM.
//
// Public API terms (checked 2026-10-15): attribution "Radar by
// RainViewer" with a link, tiles up to zoom 7 (zoom 8 returns a
// placeholder tile), and one colour scheme (the colour field has no
// effect, scheme 2 comes back for every value). Past frames are 10 min
// apart over about 2 h. Old frame paths stop working, so the sample
// fallback gives no frames.
//
// grep -n targets: RADAR_URL, MAX_ZOOM, parseRadarList, tileUrl,
//   lonLatToTile, tilesForBounds, loadRadar

import { fetchJSON, cacheGet, cacheSet } from './net.js';

export const RADAR_URL = 'https://api.rainviewer.com/public/weather-maps.json';
export const ATTRIBUTION = 'Radar by RainViewer';
export const MAX_ZOOM = 7;
const RADAR_MAX_AGE = 5 * 60 * 1000; // new frame every 10 min

export function parseRadarList(j) {
  const r = (j && j.radar) || {};
  const frames = [...(r.past || []), ...(r.nowcast || [])]
    .filter(f => f && typeof f.path === 'string' && Number.isFinite(f.time))
    .map(f => ({ time: f.time * 1000, path: f.path }))
    .sort((a, b) => a.time - b.time);
  return { frames, host: j.host || 'https://tilecache.rainviewer.com', generated: (j.generated || 0) * 1000 };
}

// opts: { host, size 256|512, color 2, smooth 1, snow 1 }
export function tileUrl(frame, z, x, y, opts = {}) {
  const host = opts.host || 'https://tilecache.rainviewer.com';
  const size = opts.size === 512 ? 512 : 256;
  const zz = Math.max(0, Math.min(MAX_ZOOM, z | 0));
  const n = 1 << zz;
  const xx = ((x % n) + n) % n, yy = Math.max(0, Math.min(n - 1, y | 0));
  return `${host}${frame.path}/${size}/${zz}/${xx}/${yy}/${opts.color ?? 2}/${opts.smooth ?? 1}_${opts.snow ?? 1}.png`;
}

// Web Mercator tile coordinates (fractional) for lon, lat at zoom z.
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z, r = Math.PI / 180;
  const la = Math.max(-85.0511, Math.min(85.0511, lat));
  return { x: (lon + 180) / 360 * n, y: (1 - Math.log(Math.tan(la * r) + 1 / Math.cos(la * r)) / Math.PI) / 2 * n };
}

// Every tile { z, x, y } that covers bounds { lat0, lat1, lon0, lon1 }.
export function tilesForBounds(b, z) {
  const zz = Math.max(0, Math.min(MAX_ZOOM, z | 0));
  const a = lonLatToTile(b.lon0, b.lat1, zz), c = lonLatToTile(b.lon1, b.lat0, zz);
  const out = [];
  for (let y = Math.floor(a.y); y <= Math.floor(c.y - 1e-9); y++)
    for (let x = Math.floor(a.x); x <= Math.floor(c.x - 1e-9); x++) out.push({ z: zz, x, y });
  return out;
}

export async function loadRadar(opts = {}) {
  const hit = !opts.noCache && cacheGet('radar', RADAR_MAX_AGE);
  if (hit) return { ...hit, live: true, cached: true };
  try {
    const set = parseRadarList(await fetchJSON(RADAR_URL, opts));
    if (!set.frames.length) throw new Error('radar: no frames');
    cacheSet('radar', set);
    return { ...set, live: true };
  } catch (e) {
    return { frames: [], host: 'https://tilecache.rainviewer.com', live: false, error: String(e && e.message || e) };
  }
}
