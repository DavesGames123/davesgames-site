// ============================================================================
//  EM EXPLORER  ·  saver/plan.js — the shot plan and the framing maths (SAVER)
// ----------------------------------------------------------------------------
//  Pure functions, no DOM. saver/director.js uses them, and saver/tests.mjs
//  tests them in node.
//
//  A shot is one CATALOG bookmark. The plan visits the datasets in a seeded
//  order and takes 3 to 5 bookmarks from each visit. The bookmarks of one
//  visit with the same plane stay together. A change of dataset or of plane
//  is a cut (a fade to black). Between cuts the camera flies (VIEW
//  saverShots.flyTo, a van Wijk zoom flight) from one bookmark to the next.
//
//  Units. Bookmark x y z are voxels of scale 0. zoom is CSS px per scale-0
//  voxel (VIEW units). The targets that the director gives VIEW are in nm
//  (units: 'nm'), so a drift is the same length on each axis.
//
//  grep -n targets
//    seeded random ........ "export function rng"
//    shot plan ............ "export function shotPlan"
//    the clear box ........ "export function clearBox"
//    zoom for the box ..... "export function frameZoom"
//    flight target ........ "export function shotTarget"
//    cut start view ....... "export function startView"
//    hold drift ........... "export function holdTarget"
//    flight length ........ "export function flightLength"
//    shot times ........... "export function shotTiming"
//    fade window .......... "export function crush"
//    band ease ............ "export function bandStep"
// ============================================================================
import { zoomPath } from '../view/camera.js';

export const PLANES = { xy: { u: 0, v: 1, n: 2 }, xz: { u: 0, v: 2, n: 1 }, yz: { u: 2, v: 1, n: 0 } };
// Short side (CSS px) of the clear box that a bookmark zoom was chosen for:
// a desktop window less the page chrome. frameZoom scales from it.
export const REF_SHORT = 640;
export const SHOT_MIN_MS = 5000, SHOT_MAX_MS = 12000;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };

// mulberry32: the same seed gives the same plan.
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, r) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const okPlane = (p) => (PLANES[p] ? p : 'xy');
const okMark = (b) => b && b.id && b.dataset && [b.x, b.y, b.z, b.zoom].every(Number.isFinite) && b.zoom > 0;

// shotPlan(bookmarks, seed, n) -> [{ id, dataset, plane, cut }]
//   cut 'dataset' on the first shot of each visit, 'plane' when the plane
//   changes inside a visit, else null. No bookmark shows twice in a row.
export function shotPlan(bookmarks, seed, n = 64) {
  const r = rng(seed);
  const by = new Map();
  for (const b of bookmarks || []) if (okMark(b)) { if (!by.has(b.dataset)) by.set(b.dataset, []); by.get(b.dataset).push(b); }
  const ids = shuffle([...by.keys()], r);
  if (!ids.length) return [];
  const decks = new Map();
  const out = [];
  let di = 0, last = null;
  while (out.length < n) {
    const ds = ids[di++ % ids.length], all = by.get(ds);
    const want = Math.min(all.length, 3 + Math.floor(r() * 3));
    const take = [];
    let guard = 0;
    while (take.length < want && guard++ < 4 * all.length + 8) {
      let deck = decks.get(ds);
      if (!deck || !deck.length) { deck = shuffle(all, r); decks.set(ds, deck); }
      const b = deck.shift();
      if (take.includes(b) || (b.id === last && all.length > 1)) { if (deck.length) deck.push(b); continue; }
      take.push(b);
    }
    // the same plane together, in the order the planes first come
    const order = [];
    for (const b of take) if (!order.includes(okPlane(b.plane))) order.push(okPlane(b.plane));
    take.sort((a, b) => order.indexOf(okPlane(a.plane)) - order.indexOf(okPlane(b.plane)));
    take.forEach((b, j) => {
      const plane = okPlane(b.plane);
      const cut = j === 0 ? 'dataset' : plane !== okPlane(take[j - 1].plane) ? 'plane' : null;
      out.push({ id: b.id, dataset: ds, plane, cut });
      last = b.id;
    });
  }
  return out.slice(0, n);
}

// The clear box: the frame less the plate bands (lib/saver-clear.js
// plateBand t and b). The subject sits at its centre.
export function clearBox(w, h, band) {
  const t = Math.max(0, (band && band.t) || 0), b = Math.max(0, (band && band.b) || 0);
  const bh = Math.max(1, h - t - b);
  return { w, h: bh, fw: w, fh: h, t, b, cx: w / 2, cy: t + bh / 2 };
}

// The bookmark zoom, scaled so the subject fills the same part of the
// clear box at 16:9 and in the 9:16 column.
export function frameZoom(zoom, box) {
  const short = Math.min(box.w, box.h);
  return zoom * clamp(short / REF_SHORT, 0.45, 1.6);
}

// Finest in-plane voxel (nm) of a dataset record.
export function planeRes(voxel, plane) {
  const a = PLANES[okPlane(plane)];
  return Math.min(voxel[a.u], voxel[a.v]);
}

// The flight target of a bookmark, in nm (the voxel centre, as VIEW goTo).
export function shotTarget(b, d, box) {
  const v = d.voxel;
  return {
    x: (b.x + 0.5) * v[0], y: (b.y + 0.5) * v[1], z: (b.z + 0.5) * v[2],
    zoom: frameZoom(b.zoom, box), plane: okPlane(b.plane), units: 'nm',
  };
}

// The first view after a cut, in voxels (CORE selectDataset takes voxels).
// With the same plane as the dataset home: the home view in the plane, on
// the slice of the bookmark (so the flight does not cross slices). With
// another plane: the bookmark, 8 times wider. A bookmark that is as wide
// as the home view or up to 2 times closer (a whole-specimen place)
// starts 4 times closer, so the
// flight is a pull back that shows the whole specimen.
export function startView(home, b, box) {
  const plane = okPlane(b.plane), n = PLANES[plane].n, k = ['x', 'y', 'z'][n];
  const okHome = home && [home.x, home.y, home.z, home.zoom].every(Number.isFinite);
  if (okHome && b.zoom <= home.zoom * 2) return { x: b.x, y: b.y, z: b.z, zoom: frameZoom(b.zoom, box) * 4, plane };
  if (okHome && okPlane(home.plane) === plane) {
    const v = { x: home.x, y: home.y, z: home.z, zoom: frameZoom(home.zoom, box), plane };
    v[k] = b[k];
    return v;
  }
  return { x: b.x, y: b.y, z: b.z, zoom: frameZoom(b.zoom, box) / 8, plane };
}

// The end of the hold: a slow push in (8 to 14 %) and a drift of about 3 %
// of the box width, in a seeded direction.
export function holdTarget(tg, d, box, u1, u2) {
  const a = PLANES[tg.plane], k = ['x', 'y', 'z'];
  const npp = planeRes(d.voxel, tg.plane) / tg.zoom;
  const len = 0.03 * box.w * npp, th = u1 * Math.PI * 2;
  const out = { ...tg, zoom: tg.zoom * (1.08 + 0.06 * u2) };
  out[k[a.u]] += Math.cos(th) * len;
  out[k[a.v]] += Math.sin(th) * len;
  return out;
}

// van Wijk length S of the flight from the view now to the target.
// from = { nm: [x, y, z], nmPerPx }, both in the plane of the target.
export function flightLength(from, tg, d, box) {
  const a = PLANES[tg.plane], c = [tg.x, tg.y, tg.z];
  const npp1 = planeRes(d.voxel, tg.plane) / tg.zoom;
  const p = zoomPath([from.nm[a.u], from.nm[a.v], box.w * from.nmPerPx], [c[a.u], c[a.v], box.w * npp1]);
  return Number.isFinite(p.S) ? Math.abs(p.S) : 0;
}

// Times for one shot (ms). The flight goes with its length S; calm (0..1,
// 1 slowest) makes all of it slower. fadeIn is the fade before the flight
// on a cut. fadeIn + fly + hold stays in 5..12 s; extra is the most the
// director can wait for the next tiles after the hold.
export function shotTiming(S, calm, u, fadeIn = 0) {
  const c = clamp(+calm || 0, 0, 1);
  const fly = Math.round(clamp(S * (950 + 650 * c), 2400 + 600 * c, 6500));
  let hold = (2800 + 2600 * clamp(u, 0, 1)) * (0.85 + 0.35 * c);
  hold = Math.round(clamp(hold, SHOT_MIN_MS - fly - fadeIn, SHOT_MAX_MS - fly - fadeIn));
  return { flyMs: fly, holdMs: hold, extraMs: Math.max(0, SHOT_MAX_MS - fadeIn - fly - hold) };
}

// The contrast window at fade k (0 = the window, 1 = black). lo and hi go
// up to the top, so the image goes dark from its shadows up. Values stay
// in 0..1 (VIEW reads a value over 1 as 0..255).
export function crush(win, k) {
  const e = smooth(k), lo = +win.lo || 0, hi = Number.isFinite(+win.hi) ? +win.hi : 1;
  const l = lo + (0.995 - lo) * e, h = hi + (1 - hi) * e;
  return { lo: Math.min(l, 0.995), hi: Math.max(Math.min(h, 1), Math.min(l, 0.995) + 0.004) };
}

// One step of the band ease: cur goes to tgt with time constant tau (s).
export function bandStep(cur, tgt, dt, tau = 0.35) {
  const f = 1 - Math.exp(-Math.max(0, dt) / tau);
  return { t: cur.t + (tgt.t - cur.t) * f, b: cur.b + (tgt.b - cur.b) * f };
}
