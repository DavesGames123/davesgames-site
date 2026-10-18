// ============================================================================
//  PLANT GROWTH  ·  screensaver shots and framing maths (DOM-free)
// ----------------------------------------------------------------------------
//  main.js "window.snSaver" plays a seeded shuffle of shots. Each shot sows
//  a new plant from its own seed and shows one part of its life:
//    life     the whole life in a fast time-lapse, seed to mature tree
//    grove    a mixed woodland edge that competes for light, as a time-lapse
//    autumn   one autumn of a mature plant, slow: colour, then leaf fall
//    spring   one spring, slow: bud break, blossom, leaf flush
//    winter   snow on the bare crown, slow
//    summer   a mature crown in the wind
//    heat     a young plant in the age (or resource, or light) heatmap
//    meadow   the meadow round a mature tree in June, from eye height
//             (meadowCamera): grass in flower, drifts of buttercups and
//             daisies, falling petals, gusts
//  shotPlan(shot) gives the clock window [t0, t1] and the rate (years per
//  second) of a shot. The camera frames the sphere round the plants in the
//  clear band of the label plate, calm and wide, for 16:9 and 9:16.
//
//  grep -n targets
//    shot list .......... "export function makeShots"
//    clock window ....... "export function shotPlan"
//    band maths ......... "export function bandFrame"
//    camera distance .... "export function fitDistance"
//    meadow camera ...... "export function meadowCamera"
//    on-screen radius ... "export function projectedRadius"
//    code for the plate . "export function codeExtract"
// ============================================================================
import { SPECIES, SPECIES_IDS } from './grow.js';

export const SAVER_GRADIENTS = ['forest', 'viridis', 'inferno', 'magma', 'aurora', 'ember', 'turbo', 'spectral', 'plasma'];
export const SHOT_KINDS = ['life', 'autumn', 'grove', 'spring', 'heat', 'winter', 'summer', 'meadow'];

// Fisher-Yates with a seeded rnd.
export function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

// n shots. The kinds come in a shuffled round, and so do the species; two
// shots in a row never show the same species, and an autumn shot never
// shows an evergreen. Ferns and azaleas get the
// short-life kinds (life, spring, summer, heat) only.
export function makeShots(rnd, n = 12, calm = 0.7) {
  const out = [];
  let kinds = [], species = [];
  for (let k = 0; k < n; k++) {
    if (!kinds.length) kinds = shuffle(SHOT_KINDS.slice(), rnd);
    const kind = kinds.shift();
    let sp = null;
    const prev = out.length ? out[out.length - 1].species : null;
    const fits = c => c !== prev && (SPECIES[c].form === 'tree' || !(kind === 'autumn' || kind === 'winter' || kind === 'grove' || kind === 'meadow'))
      && !(kind === 'autumn' && SPECIES[c].leaf.ever);   // an evergreen has no autumn colour
    if (!species.some(fits)) species = species.concat(shuffle(SPECIES_IDS.slice(), rnd));   // a new round
    for (let tries = 0; tries < species.length && !sp; tries++) {
      if (fits(species[0])) sp = species.shift(); else species.push(species.shift());
    }
    if (!sp) sp = SPECIES_IDS.find(fits) || 'oak';
    const heat = ['age', 'vigour', 'light', 'flow'];
    const pick = rnd();
    const mode = kind === 'heat' ? heat[Math.floor(pick * heat.length)] : kind === 'life' && pick < 0.15 ? 'age' : 'natural';
    const dir = rnd() < 0.5 ? -1 : 1;
    out.push({
      kind, species: sp, stand: kind === 'grove' ? 'mixed' : 'single', mode,
      gradient: SAVER_GRADIENTS[Math.floor(rnd() * SAVER_GRADIENTS.length)],
      reversed: rnd() < 0.12,
      seed: 1 + Math.floor(rnd() * 2147483646),
      dur: kind === 'life' || kind === 'grove' ? 11 + rnd() : 6 + 5 * rnd(),
      az0: rnd() * Math.PI * 2,
      orbit: dir * (0.04 + 0.04 * rnd()) * (1 - 0.5 * calm),
      el: 0.06 + 0.16 * rnd(),
      wind: kind === 'summer' ? 0.6 + 0.3 * rnd() : 0.2 + 0.4 * rnd(),
    });
  }
  return out;
}

// The clock window of a shot: { t0, t1, rate (years per second), caption }.
export function shotPlan(shot) {
  const years = SPECIES[shot.species].years, late = Math.max(2, years - 2);
  let t0, t1, caption;
  switch (shot.kind) {
    case 'life': t0 = 0.17; t1 = years - 0.45; caption = 'A whole life, seed to mature plant'; break;
    case 'grove': t0 = 0.17; t1 = Math.min(years, 32) - 0.45; caption = 'A woodland edge competes for light'; break;
    case 'autumn': t0 = late + 0.64; t1 = late + 0.93; caption = 'Autumn colour and leaf fall'; break;
    case 'spring': { const Y = Math.max(1, Math.round(years * 0.6)); t0 = Y + 0.13; t1 = Y + 0.42; caption = 'Bud break, blossom and leaf flush'; break; }
    case 'winter': t0 = late + 0.9; t1 = late + 1.14; caption = 'Snow on the bare crown'; break;
    case 'summer': t0 = years - 1 + 0.42; t1 = years - 1 + 0.6; caption = 'A mature crown in the wind'; break;
    case 'meadow': t0 = years - 1 + 0.36; t1 = years - 1 + 0.55; caption = 'The meadow in June: grass in flower, buttercups and daisies in drifts'; break;
    default: { const Y = Math.min(3, years - 2); t0 = Y + 0.2; t1 = Math.min(years - 1, 15) + 0.5; caption = 'The heatmap while it grows'; }
  }
  t1 = Math.max(t1, t0 + 0.05);
  return { t0, t1, rate: (t1 - t0) / Math.max(1, shot.dur * 0.94), caption };
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

// The meadow shot: the camera stands at eye height (1.15 m over the
// ground) in the grass, 2 crown radii from the plants, and aims at the
// middle of the crown, so the meadow fills the lower frame and the tree
// stands over it. With edge (the direction of the woodland edge, eco.js
// params.edge) the camera stays on the open side and swings within 55
// degrees of the line through the tree to the wood, so the wood is the
// backdrop. s: { c, r } (the frame sphere), groundY(x, z).
export function meadowCamera(s, d, az, groundY, edge = null) {
  const dd = Math.max(6, Math.min(d * 0.8, s.r * 2));
  const a = edge ? Math.atan2(-edge[0], -edge[1]) + Math.sin(az) * 0.95 : az;
  const x = s.c[0] + Math.sin(a) * dd, z = s.c[2] + Math.cos(a) * dd;
  return { pos: [x, groundY(x, z) + 1.15, z], target: [s.c[0], Math.max(1.2, s.c[1] * 0.55), s.c[2]] };
}

// The on-screen radius in px of a sphere of radius r at distance d, in a
// frame h px tall.
export function projectedRadius(r, d, fovY, h) {
  if (d <= r) return Infinity;
  const half = Math.asin(r / d);
  return (h / 2) * Math.tan(half) / Math.tan(fovY * Math.PI / 360);
}

// A short real extract of a function source for the plate: n lines from
// the first line that holds `from`, with the common indent removed.
export function codeExtract(fnSource, from, n = 12) {
  const lines = String(fnSource).split('\n');
  let i = lines.findIndex(l => l.includes(from));
  if (i < 0) i = 0;
  const part = lines.slice(i, i + n);
  const ind = Math.min(...part.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
  return part.map(l => l.slice(ind)).join('\n');
}
