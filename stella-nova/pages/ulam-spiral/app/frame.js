// ============================================================================
//  ULAM SPIRAL  ·  app/frame.js — S -> the renderer state of one frame
// ----------------------------------------------------------------------------
//  frameState(v, opts) turns S (or the overrides in opts, for thumbnails,
//  the minimap and selfTest) into what render.js draws: the field pass for
//  the lattice shapes, the points pass for the point shapes, 3D shapes and
//  the morph, the path, the bloom and the density pyramid region.
//
//  GREP MAP
//    grep -n 'export function pyrRegion'   the cells the density pyramid holds
//    grep -n 'export function frameState'  S -> renderer state, one frame
//    grep -n 'point shapes'                the n range of the visible annulus
// ============================================================================
import * as T from '../numtheory.js';
import * as L from '../layouts.js';
import { S, rt } from './state.js';
import { PHONE_Q } from './dom.js';
import { PALETTES, BGS, rgb, palArr } from './palettes.js';
import { clamp, lerp, is3D, cam3Mats, worldRect } from './camera.js';
import { bboxOf, home3, n3Count, nSpan } from './framing.js';

const M = T.MODE;
const PT_CAP = () => (PHONE_Q.matches ? 1200000 : 4000000);

// --- the pyramid region ---------------------------------------------------------------
// The lattice cells (x0, y0, x1, y1) that hold the numbers the sieve
// knows (n <= S.limit), with a margin; null before the sieve. Outside it
// every cell is unknown or empty, and the shader samples them directly.
const pyrBoxes = new Map();
export function pyrRegion(sh) {
  if (!S.bits) return null;
  const key = `${sh.key}|${JSON.stringify(S.P)}|${S.limit}`;
  if (pyrBoxes.has(key)) return pyrBoxes.get(key);
  let box = null;
  const st = L.startOf(sh, S.P);
  if (sh.lattice) {
    const r = Math.ceil(1.16 * Math.sqrt(S.limit)) + 2;
    box = [-r, -r, r, r];
  } else if (st <= S.limit) {
    const b = bboxOf(sh, st, Math.min(S.limit, 4294967295), 2000);
    // world -> lattice (hex: axial q = x - r / 2, r = y / SQ3)
    const pts = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(([x, y]) => sh.kind === 'hex' ? [x - y / (2 * L.SQ3), y / L.SQ3] : [x, y]);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const m = 0.02 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 2;
    box = [Math.floor(Math.min(...xs) - m), Math.floor(Math.min(...ys) - m), Math.ceil(Math.max(...xs) + m), Math.ceil(Math.max(...ys) + m)];
  }
  if (box) box = box.map(v => clamp(v, -23001, 23001));
  if (pyrBoxes.size > 40) pyrBoxes.clear();
  pyrBoxes.set(key, box);
  return box;
}

// --- frame state --------------------------------------------------------------------------
export function frameState(v, opts = {}) {
  const sh = opts.shape || S.shape, cam = opts.cam || S.cam, dpr = opts.dpr || rt.dpr;
  const pal = palArr(S.pal);
  const s = {
    shape: sh, P: S.P, mode: opts.mode != null ? opts.mode : S.mode, quad: S.quad,
    palA: pal, palB: S.palB ? palArr(S.palB) : pal, quadCol: rgb(PALETTES[S.pal].quad),
    compA: S.compA * clamp((cam.z - 2) / 8, 0, 1), gain: 1, sweep: S.sweep ? [S.sweep.x, S.sweep.y, S.sweep.r] : null, sweepW: S.sweep ? S.sweep.w : 1,
    walk: S.walk ? S.walk.k : null, ignite: S.walk ? Math.max(6, S.walk.k * 0.04) : 30,
    style: S.style, dotR: S.dotR, ptSize: S.dotR * 2, bg: BGS[S.bg].c.map(rgb), bloom: S.bloom, exposure: 1,
    dpr, cam, center: [v.cx * dpr, (v.h - v.cy) * dpr],
    renderer: 'none', points: null, path: null, cam3: null, tileOn: false, boxMax: opts.thumb ? 3 : rt.boxMax,
  };
  if (opts.walk !== undefined) s.walk = opts.walk;
  const pxW = 1 / (cam.z * s.dpr);
  if (S.morph && !opts.shape) {
    const mo = S.morph;
    s.points = { shapeA: mo.a.id, shapeB: mo.b.id, morph: mo.e, n0: mo.n0, count: mo.count, stagger: 0.55 };
    s.ptSize = Math.max(S.dotR * 2, 0.5);
    if (mo.c3) s.cam3 = cam3Mats(mo.c3, v);
    return s;
  }
  if (is3D(sh)) {
    const c3 = opts.cam3 || S.cam3 || home3(sh);
    s.cam3 = cam3Mats(c3, v);
    const st = L.startOf(sh, S.P);
    s.points = { shapeA: sh.id, n0: st, count: n3Count(sh, c3) };
    s.ptSize = S.dotR * 2.2;
    return s;
  }
  if (L.isLattice(sh)) {
    s.renderer = 'field';
    const [bx, by] = L.cellAt(sh, cam.x, cam.y), [wx, wy] = L.worldOf(sh, bx, by);
    s.base = { x: bx, y: by, wx, wy };
    s.tileOn = opts.tileOn != null ? opts.tileOn : S.tileOn;
    s.gain = 0.9;
    // the density pyramid (render.js): its region, and only the main view
    // builds it (the thumbnails of other shapes would rebuild it each time)
    const box = pyrRegion(sh);
    if (box) {
      s.pyr = { box, alpha: s.mode <= M.eisen, cap: PHONE_Q.matches ? 1024 : 2048 };
      s.pyrBuild = !opts.thumb; s.pyrBudget = PHONE_Q.matches ? 1e7 : 4e7;
    }
    // Zoomed out the field is a density map: a soft, high-floor bloom only.
    const zo = clamp((pxW - 0.3) / 1.2, 0, 1);
    s.bloomT = 0.3 * zo * zo * (3 - 2 * zo); s.bloom = S.bloom * lerp(1, 0.35, zo);
    if (S.path && !opts.thumb && cam.z * s.dpr > 2.5) {
      const sp = nSpan(sh, v, cam);
      if (sp.hi >= sp.lo && sp.hi - sp.lo < 400000) s.path = { shapeA: sh.id, n0: sp.lo, count: sp.hi - sp.lo + 1 };
    }
    return s;
  }
  // point shapes: the n range of the annulus under the canvas
  const r = worldRect(v, cam);
  const ox = clamp(0, r[0], r[2]), oy = clamp(0, r[1], r[3]);
  const rmin = Math.hypot(ox, oy), rmax = Math.max(...[[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]].map(([x, y]) => Math.hypot(x, y)));
  let [lo, hi] = L.nRange(sh, S.P, rmin - 2, rmax + 2);
  hi = Math.min(hi, lo + (opts.cap || PT_CAP()));
  if (hi > 4294967295) hi = 4294967295;
  if (S.bits) hi = Math.min(hi, Math.max(lo, S.limit + 7));
  s.points = { shapeA: sh.id, n0: lo, count: Math.max(0, hi - lo + 1) };
  s.ptSize = S.dotR * 2.6;
  if (S.path && !opts.thumb && hi - lo < 400000 && cam.z * s.dpr > 1.5) s.path = { shapeA: sh.id, n0: lo, count: hi - lo + 1 };
  return s;
}
