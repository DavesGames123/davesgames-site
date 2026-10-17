// ============================================================================
//  CORAL REEF  ·  screensaver shots and camera framing (DOM-free)
// ----------------------------------------------------------------------------
//  shotList(seed, n) gives a seeded shuffle of shots. Each shot grows a new
//  reef (a preset) or one new colony from its own seed, with its own
//  gradient, colour mode, hold time (5 to 12 s) and camera path. Two shots
//  in a row never share a preset or a colour mode.
//
//  frameFit() gives the camera distance and the view offset that put a
//  sphere (the reef) in the middle of the clear part of the canvas: the
//  canvas less the panel and dock on the page, or less the text bands of
//  the saver plate (plateBand of lib/saver-clear.js). setViewOffset(w, h,
//  ox, oy, w, h) then moves the subject to the centre of the clear part.
//
//  grep -n targets
//    the shot list ........ "export function shotList"
//    the fit .............. "export function frameFit"
//    the check (tests) .... "export function projectedBox"
// ============================================================================
import { rng } from '../../lib/dla-engine.js';
import { PRESET_IDS, SPECIES_IDS } from './reef.js';
import { MODE_IDS } from './colour.js';

export const SAVER_GRADIENTS = ['reef', 'viridis', 'inferno', 'aurora', 'ice', 'magma', 'turbo', 'plasma', 'ember', 'spectral'];

function shuffle(a, rand) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// A shuffled pick from a pool, never the same as the one before.
function deck(pool, rand) {
  let d = [], last = null;
  return () => {
    if (!d.length) { d = shuffle(pool.slice(), rand); if (d.length > 1 && d[d.length - 1] === last) d.unshift(d.pop()); }
    last = d.pop(); return last;
  };
}

export function shotList(seed = 1, n = 12) {
  const rand = rng((seed >>> 0) || 1);
  const preset = deck(PRESET_IDS, rand), species = deck(SPECIES_IDS, rand);
  const grad = deck(SAVER_GRADIENTS, rand), mode = deck(MODE_IDS, rand);
  const out = [];
  for (let i = 0; i < n; i++) {
    const kind = rand() < 0.72 ? 'reef' : 'colony';
    out.push({
      kind,
      preset: preset(),
      species: species(),
      gradient: grad(),
      reversed: rand() < 0.15,
      mode: mode(),
      seed: 1 + Math.floor(rand() * 1e6),
      hold: 5 + rand() * 7,                    // seconds, 5 to 12
      az: rand() * Math.PI * 2,                // camera start azimuth
      spin: (rand() < 0.5 ? -1 : 1) * (0.025 + rand() * 0.035), // rad/s, calm
      elev: 0.2 + rand() * 0.22,               // radians above the horizon
      current: Math.floor(rand() * 360),
    });
  }
  return out;
}

// w, h: canvas CSS px. clear: { l, r, t, b } px covered at each edge.
// radius: the subject sphere, or rx and ry: the half sizes of the subject
// across and up the screen (a reef is wide and low). fov: the vertical
// field of view in degrees. fill: the part of the clear size that the
// subject may span. Returns { dist, ox, oy, cx, cy, wc, hc }.
export function frameFit({ w, h, clear = {}, radius, rx, ry, fov = 40, fill = 0.84 }) {
  const l = clear.l || 0, r = clear.r || 0, t = clear.t || 0, b = clear.b || 0;
  const wc = Math.max(1, w - l - r), hc = Math.max(1, h - t - b);
  const T = Math.tan(fov * Math.PI / 360);
  // the angular half-size that the subject may have, in each direction
  const av = Math.atan(T * (hc / h) * fill), ah = Math.atan(T * (wc / h) * fill);
  const dist = radius !== undefined
    ? radius / Math.sin(Math.min(av, ah))
    : Math.max(ry / Math.tan(av), rx / Math.tan(ah));
  const cx = l + wc / 2, cy = t + hc / 2;
  return { dist, ox: w / 2 - cx, oy: h / 2 - cy, cx, cy, wc, hc };
}

// Where the subject lands on screen for a fit: { x0, x1, y0, y1 } in px.
// The camera looks at the subject centre. A sphere has a circle outline of
// angular radius asin(radius / dist). A flat subject of half sizes rx, ry
// at distance dist spans rx / dist and ry / dist in tan units.
export function projectedBox({ w, h, fov = 40 }, fit, radius, rx, ry) {
  const T = Math.tan(fov * Math.PI / 360), k = (h / 2) / T;
  const px = radius !== undefined ? Math.tan(Math.asin(Math.min(1, radius / fit.dist))) * k : rx / fit.dist * k;
  const py = radius !== undefined ? px : ry / fit.dist * k;
  const x = w / 2 - fit.ox, y = h / 2 - fit.oy;
  return { x0: x - px, x1: x + px, y0: y - py, y1: y + py };
}
