// ============================================================================
//  GALAXY  ·  saverplan.js — the screensaver shot list (no DOM)
// ----------------------------------------------------------------------------
//  makePlan(seed, calm).next() gives one shot:
//    { key, subject, kind, dur, yaw0, spin, incl }
//  key is a preset key or "type:seed" (a random galaxy of that type).
//  A deck holds every (subject, kind) pair once; it is shuffled with the
//  seed, and a new shuffle starts when it runs out. The same subject never
//  comes twice in a row. dur is 5-12 s (calm makes shots longer).
//
//  shotCamera(shot, p, ctx) gives the orbit camera at progress p (0..1):
//    orbit  a slow arc at a fixed inclination
//    face   near face-on, a push-in on the arms
//    dive   from outside down into the disk, level at the end
//    bulge  a lateral fly-by of the bulge, close in
//    edge   edge-on, the dust lane across the frame
//    pair   a wide arc round an interacting pair
//  ctx = { R (fit radius, kpc), Rd, fit (fit distance, kpc), re }.
// ============================================================================
import { rng } from './model.js';
import { DEG, ease, lerp, inclToPitch } from './camera.js';

const BASE = [
  ['milkyway', 'dive'], ['milkyway', 'orbit'], ['milkyway', 'bulge'],
  ['m51', 'face'], ['m51', 'dive'],
  ['m87', 'bulge'], ['m87', 'orbit'],
  ['sombrero', 'edge'], ['sombrero', 'bulge'],
  ['ngc1300', 'face'], ['ngc1300', 'orbit'],
  ['flocculent', 'orbit'], ['flocculent', 'dive'],
  ['antennae', 'pair'],
  ['pair:*', 'pair'], ['grand:*', 'dive'], ['barred:*', 'face'], ['flocculent:*', 'orbit'],
  ['elliptical:*', 'bulge'], ['lenticular:*', 'edge'], ['irregular:*', 'orbit'],
];
const INCL = { orbit: [35, 65], face: [8, 22], dive: [45, 65], bulge: [55, 75], edge: [84, 88], pair: [30, 60] };

export function makePlan(seed, calm = 0.7) {
  const r = rng((seed >>> 0) * 2246822519 + 3);
  let deck = [], i = 0, last = '';
  const shuffle = () => {
    deck = BASE.map(([k, kind]) => ({ key: k.endsWith(':*') ? k.replace('*', String(1 + Math.floor(r() * 9999))) : k, kind }));
    for (let j = deck.length - 1; j > 0; j--) { const q = Math.floor(r() * (j + 1)); [deck[j], deck[q]] = [deck[q], deck[j]]; }
    i = 0;
  };
  shuffle();
  return {
    next() {
      if (i >= deck.length) shuffle();
      let s = deck[i];
      if (s.key.split(':')[0] === last.split(':')[0] && i + 1 < deck.length) { [deck[i], deck[i + 1]] = [deck[i + 1], deck[i]]; s = deck[i]; }
      i++;
      last = s.key;
      const [a, b] = INCL[s.kind];
      const dur = Math.min(12, Math.max(5, (6 + 5 * r()) * (0.85 + 0.25 * calm)));
      return { key: s.key, subject: s.key.split(':')[0], kind: s.kind, dur, yaw0: r() * 6.2832, spin: (r() < 0.5 ? -1 : 1) * (0.25 + 0.3 * r()) * (1.1 - 0.5 * calm), incl: lerp(a, b, r()) };
    },
  };
}

export function shotCamera(s, p, ctx) {
  const e = ease(p), fov = 40;
  const yaw = s.yaw0 + s.spin * p;
  const pitch = inclToPitch(s.incl);
  const c = { target: [0, 0, 0], yaw, pitch, dist: ctx.fit, fov };
  switch (s.kind) {
    case 'face': c.dist = ctx.fit * lerp(1.0, 0.7, e); break;
    case 'dive': {
      // out of the sky, down to 1.6 R_d from the centre, level with the disk
      c.dist = lerp(ctx.fit * 0.95, ctx.Rd * 1.6, e);
      c.pitch = lerp(pitch, 0.02, ease(Math.min(1, p * 1.15)));
      c.fov = lerp(40, 62, e);
      break;
    }
    case 'bulge': {
      const reach = Math.max(ctx.re || 1, ctx.R * 0.08) * 6;
      const side = (p - 0.5) * reach * 0.9;
      c.target = [-Math.sin(yaw) * side, Math.cos(yaw) * side, 0];
      c.dist = lerp(reach * 1.25, reach * 0.8, e);
      c.fov = 48;
      break;
    }
    case 'edge': c.dist = ctx.fit * lerp(1.02, 0.86, e); c.yaw = s.yaw0 + s.spin * 0.25 * p; break;
    case 'pair': c.dist = ctx.fit * lerp(1.08, 0.9, e); break;
    default: c.dist = ctx.fit * lerp(1.05, 0.88, e);
  }
  return c;
}
export { DEG };
