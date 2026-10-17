// ============================================================================
//  PLANT GROWTH  ·  screensaver shots and framing maths (DOM-free)
// ----------------------------------------------------------------------------
//  main.js "window.snSaver" plays a seeded shuffle of shots. Each shot grows
//  a new plant from a seed: a species, a colour mode, a gradient, roots or
//  not, a camera azimuth, elevation and orbit, and a length of 5 to 12 s.
//  The camera frames the sphere round the whole plant (crown, stem, and
//  the soil when roots show) in the clear band of the label plate.
//
//  grep -n targets
//    shot list .......... "export function makeShots"
//    growth rate ........ "export function shotRate"
//    band maths ......... "export function bandFrame"
//    camera distance .... "export function fitDistance"
//    on-screen radius ... "export function projectedRadius"
//    code for the plate . "export function codeExtract"
// ============================================================================
import { SPECIES_IDS } from './grow.js';
import { COLOUR_IDS } from './pose.js';

export const SAVER_GRADIENTS = ['forest', 'viridis', 'inferno', 'magma', 'aurora', 'ember', 'turbo', 'spectral', 'plasma', 'cividis'];

// Fisher-Yates with a seeded rnd.
export function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

// n shots. Each species comes once in a shuffled round before any repeats,
// and two shots in a row never have the same species. calm 0..1 slows the
// orbit.
export function makeShots(rnd, n = 12, calm = 0.7) {
  const out = [];
  let round = [];
  for (let k = 0; k < n; k++) {
    if (!round.length) {
      round = shuffle(SPECIES_IDS.slice(), rnd);
      if (out.length && round[0] === out[out.length - 1].species) round.push(round.shift());
    }
    const species = round.shift();
    const heat = COLOUR_IDS.filter(m => m !== 'natural');
    const mode = rnd() < 0.35 ? 'natural' : heat[Math.floor(rnd() * heat.length)];
    const dir = rnd() < 0.5 ? -1 : 1;
    out.push({
      species, mode,
      gradient: SAVER_GRADIENTS[Math.floor(rnd() * SAVER_GRADIENTS.length)],
      reversed: rnd() < 0.15,
      seed: 1 + Math.floor(rnd() * 2147483646),
      dur: 5 + 7 * rnd(),
      roots: rnd() < 0.4,
      az0: rnd() * Math.PI * 2,
      orbit: dir * (0.05 + 0.05 * rnd()) * (1 - 0.5 * calm),
      el: 0.1 + 0.22 * rnd(),
      wind: 0.25 + 0.5 * rnd(),
    });
  }
  return out;
}

// Steps per second so that a plant of about est steps is grown in the
// first 70% of a shot of dur seconds. Clamped to 3..40.
export function shotRate(est, dur) {
  const r = est / Math.max(0.5, dur * 0.7);
  return Math.min(40, Math.max(3, r));
}

// The clear band of the plate (plateBand: { t, b, w } in CSS px) in a
// frame of w x h. Each margin stays 42% of h or less. Returns the band
// height and width as fractions of the frame, and the view offset in px
// that puts the band centre at the image centre (camera.setViewOffset y;
// positive moves the image up).
export function bandFrame(band, w, h) {
  if (!band) return { hFrac: 1, wFrac: 1, offY: 0, t: 0, b: 0 };
  const t = Math.min(Math.max(0, band.t), h * 0.42), b = Math.min(Math.max(0, band.b), h * 0.42);
  const bw = band.w ? Math.min(w, band.w) : w;
  return { hFrac: Math.max(0.16, (h - t - b) / h), wFrac: bw / w, offY: (b - t) / 2, t, b };
}

// The camera distance at which a sphere of radius r fills fill of the
// band (fractions hFrac, wFrac of a frame of the given aspect), with a
// vertical field of view fovY in degrees.
export function fitDistance(r, fovY, aspect, hFrac = 1, wFrac = 1, fill = 0.8) {
  const tv = Math.tan(fovY * Math.PI / 360);
  const t = Math.min(tv * hFrac * fill, tv * aspect * wFrac * fill);
  return r * Math.sqrt(1 + t * t) / t;
}

// The on-screen radius in px of a sphere of radius r at distance d, in a
// frame h px tall.
export function projectedRadius(r, d, fovY, h) {
  if (d <= r) return Infinity;
  const half = Math.asin(r / d);
  return (h / 2) * Math.tan(half) / Math.tan(fovY * Math.PI / 360);
}

// A short real extract of the colonisation step for the plate: the lines
// of fnSource from the first line that holds `from`, n lines, with the
// common indent removed.
export function codeExtract(fnSource, from = '// 1. each live attractor', n = 12) {
  const lines = String(fnSource).split('\n');
  let i = lines.findIndex(l => l.includes(from));
  if (i < 0) i = 0;
  const part = lines.slice(i, i + n);
  const ind = Math.min(...part.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
  return part.map(l => l.slice(ind)).join('\n');
}
