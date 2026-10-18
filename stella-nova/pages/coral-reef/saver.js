// ============================================================================
//  CORAL REEF  ·  screensaver plan and camera framing (DOM-free)
// ----------------------------------------------------------------------------
//  The saver is one ROV that analyses ONE coral colony while it grows. A
//  run is a list of dives (divePlan). A dive picks a species and a site
//  with a view (an arch top, a canyon wall, a pinnacle, a ledge), grows
//  one colony there from a seed to full size (reef.growColony), and cuts
//  between calm camera shots while it grows. Then the frame fades and a
//  new dive starts at a new site. Every choice comes from the seed, so
//  each run differs and one seed gives one run.
//
//  SHOTS (shotPose)
//    orbit ..... a slow turn round the colony; the ROV is near it
//    push ...... a slow push-in on the growth front (zoom 1.3 to 0.75)
//    shoulder .. from behind the ROV: its frame and its beams in the
//                foreground, the colony in the light
//    wide ...... far out: the ROV, its beams and the colony small in the
//                black water (at most one in four shots, never two in a row)
//  Each shot holds 7 to 14 s. The distance comes from frameFit with the
//  clear band of the plate (plateBand of lib/saver-clear.js), so the
//  subject stays between the text blocks in 16:9 and in 9:16.
//
//  ROCK. safeCamera() keeps the camera in open water with a clear line
//  to the subject: it traces rock.sdfAll (rock and sand) from the edge of
//  the subject to the camera. When rock is in the way it lifts the
//  camera (more elevation) and then turns it round the subject; only when
//  no line is clear does it come nearer. clearPath() (the old rule: move
//  to the near side of the rock) put the camera 0.6 m from the subject
//  when the rock round the base was in the first 0.5 m of the trace.
//  pickSite() ranks rock.sampleSurface points by their feature and
//  exposure and takes one by the dive seed (open, up-facing rock only).
//  The shoulder and wide shots need the ROV near the colony (reachRov);
//  while the ROV is far away they are orbits, so no shot frames empty
//  water. cardRect() places the feed card beside the clear band.
//
//  frameFit() gives the camera distance and the view offset that put a
//  sphere (or a wide, low ellipse) in the middle of the clear part of the
//  canvas: the canvas less the panel and dock on the page, or less the
//  text bands of the saver plate. setViewOffset(w, h, ox, oy, w, h) then
//  moves the subject to the centre of the clear part.
//
//  GROWTH. The user found the saver growth "way too fast". A dive grows
//  its one colony for several minutes: growSeconds(calm, seconds) is 120
//  + 150 x calm s (225 s at calm 0.7), less when the saver gives the page
//  fewer seconds. createGovernor(rate) meters the particles per second
//  with a smooth ease-in, and caps the stock it can carry, so no frame
//  schedule (slow device, a long frame, a tab that comes back) gives a
//  burst. main.js grows only the particles that the governor gives.
//
//  grep -n targets
//    growth time .......... "export function growSeconds"
//    the rate meter ....... "export function createGovernor"
//    the dives ............ "export function divePlan"
//    the shots ............ "function shotList"
//    a camera pose ........ "export function shotPose"
//    a site on the rock ... "export function pickSite"
//    rock in the way ...... "export function clearPath"
//    a safe camera ........ "export function safeCamera"
//    the feed card ........ "export function cardRect"
//    the fit .............. "export function frameFit"
//    the check (tests) .... "export function projectedBox"
// ============================================================================

export const SAVER_GRADIENTS = ['reef', 'viridis', 'inferno', 'aurora', 'ice', 'magma', 'turbo', 'plasma', 'ember', 'spectral'];
export const SHOT_KINDS = ['orbit', 'push', 'shoulder', 'wide'];
const SITE_KINDS = ['arch', 'canyon', 'pinnacle', 'ledge', 'overhang', 'cave'];
const TAU = Math.PI * 2;

function mulberry(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
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

// Seconds from the seed to full size, for the saver calm (0..1) and the
// seconds that the saver shows this page (opts.seconds, or none).
export function growSeconds(calm = 0.7, seconds) {
  let g = 120 + 150 * Math.max(0, Math.min(1, calm));
  if (seconds > 0) g = Math.min(g, Math.max(90, seconds * 0.9));
  return g;
}

// The rate meter: rate particles per second at full speed, an ease-in
// over ramp s (smoothstep), and a stock of at most cap particles (0.1 s
// of growth, at least 1). take(dt) -> the particles this frame may add;
// used(n) books the ones that joined (a walker can fail, so the rest
// stays in the stock up to cap). The total up to time t is at most
// rate x t + cap, whatever the frame times are.
export function createGovernor(rate, { ramp = 8, cap } = {}) {
  const C = cap ?? Math.max(1, rate * 0.1);
  let t = 0, stock = 0;
  return {
    get rate() { return rate; }, get t() { return t; },
    // the eased rate now (particles per second): what a worker that meters
    // by itself (mesh-worker.js { type: 'rate' }) gets
    get current() { const u = Math.min(1, t / ramp); return rate * u * u * (3 - 2 * u); },
    setRate(r) { rate = Math.max(0, r); },
    take(dt) {
      dt = Math.max(0, dt);
      const t1 = t + dt;
      // the integral of rate x smoothstep over [t, t1]
      const I = u => (u < 1 ? (u * u * u - 0.5 * u * u * u * u) * ramp : ramp * 0.5 + (u - 1) * ramp);
      const add = rate * (I(t1 / ramp) - I(t / ramp));
      t = t1;
      stock = Math.min(C, stock + add);
      return Math.floor(stock);
    },
    used(n) { stock = Math.max(0, stock - n); },
  };
}

// Shots that cover dur seconds. calm 0..1 makes the moves slower.
function shotList(rand, dur, calm) {
  const out = [];
  let t = 0, prev = null, nWide = 0;
  while (t < dur) {
    let kind;
    for (let k = 0; k < 8; k++) {
      const r = rand();
      kind = out.length === 0 ? (r < 0.5 ? 'shoulder' : 'orbit') : r < 0.3 ? 'orbit' : r < 0.55 ? 'push' : r < 0.8 ? 'shoulder' : 'wide';
      if (kind === prev) continue;
      if (kind === 'wide' && (nWide + 1) * 4 > out.length + 1) continue;
      break;
    }
    if (kind === prev || (kind === 'wide' && (nWide + 1) * 4 > out.length + 1)) kind = prev === 'orbit' ? 'push' : 'orbit';
    const hold = 7 + rand() * 7;
    const slow = 1 - 0.5 * calm;
    out.push({
      kind, t0: t, hold,
      az: rand() * TAU,
      spin: (rand() < 0.5 ? -1 : 1) * (0.03 + rand() * 0.04) * slow,      // rad/s
      elev: kind === 'wide' ? 0.08 + rand() * 0.2 : 0.18 + rand() * 0.38,
      zoom: kind === 'wide' ? 1 : kind === 'push' ? 1.3 : 0.95 + rand() * 0.35,
      zoom1: kind === 'push' ? 0.72 + rand() * 0.12 : null,
      side: rand() < 0.5 ? -1 : 1,
      lift: 0.3 + rand() * 0.6,
    });
    if (kind === 'wide') nWide++;
    prev = kind; t += hold;
  }
  return out;
}

// n dives. species: the ids to pick from (reef.js SPECIES_IDS). Each dive:
// { species, siteKind, siteR, seed, grow (s, growSeconds +-10%), gradient, reversed, mode,
//   current, shots: [{ kind, t0, hold, az, spin, elev, zoom, zoom1, side, lift }] }
export function divePlan(seed = 1, { n = 6, species = ['staghorn', 'fan', 'table', 'boulder', 'finger'], modes = ['natural', 'age', 'natural', 'height', 'natural', 'flow'], calm = 0.7, seconds } = {}) {
  const G0 = growSeconds(calm, seconds);
  const rand = mulberry((seed >>> 0) * 2654435761 + 7);
  const sp = deck(species, rand), site = deck(SITE_KINDS, rand), grad = deck(SAVER_GRADIENTS, rand), mode = deck(modes, rand);
  const out = [];
  for (let i = 0; i < n; i++) {
    const grow = G0 * (0.9 + 0.2 * rand());      // s from seed to full size
    out.push({
      species: sp(), siteKind: site(), siteR: rand(), seed: 1 + Math.floor(rand() * 1e6), grow,
      gradient: grad(), reversed: rand() < 0.15, mode: mode(), current: Math.floor(rand() * 360),
      shots: shotList(rand, grow + 14, calm),
    });
  }
  return out;
}

// The shot that is on at time t of a dive, and its progress u (0..1).
export function shotAt(dive, t) {
  const S = dive.shots;
  for (let i = S.length - 1; i >= 0; i--) if (t >= S[i].t0) return { shot: S[i], i, u: Math.min(1, (t - S[i].t0) / S[i].hold) };
  return { shot: S[0], i: 0, u: 0 };
}

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = a => Math.hypot(a[0], a[1], a[2]);
const norm3 = a => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// The camera of a shot at progress u (0..1) and shot time ts (s).
// subj: { c (colony centre), r (colony sphere radius), front (growth
// front point), rov (ROV position or null) }. fitDist(r): the distance
// that fits a sphere of radius r in the clear band (frameFit). Returns
// { pos, tgt, r } where r is the radius of the subject sphere that the
// shot frames (for the tests).
// The ROV counts for a shot only when it is near the colony: far away (on
// its way to the site) a shoulder or wide shot would frame open water.
export function reachRov(c, r, rov) { return !!rov && len3(sub3(rov, c)) < 3 + 6 * Math.max(0.3, r); }
export function shotPose(shot, u, ts, subj0, fitDist) {
  const subj = reachRov(subj0.c, subj0.r, subj0.rov) ? subj0 : Object.assign({}, subj0, { rov: null });
  const c = subj.c, r = Math.max(0.3, subj.r);
  const ease = u * u * (3 - 2 * u);
  const aim = (w) => [c[0] + (subj.front[0] - c[0]) * w, c[1] + (subj.front[1] - c[1]) * w, c[2] + (subj.front[2] - c[2]) * w];
  const orbitAt = (tgt, dist, az, el) => [tgt[0] + Math.sin(az) * Math.cos(el) * dist, tgt[1] + Math.sin(el) * dist, tgt[2] + Math.cos(az) * Math.cos(el) * dist];
  if (shot.kind === 'wide' && subj.rov) {
    // a sphere round the colony and the ROV
    const m = [(c[0] + subj.rov[0]) / 2, (c[1] + subj.rov[1]) / 2, (c[2] + subj.rov[2]) / 2];
    const R = len3(sub3(subj.rov, c)) / 2 + Math.max(r, 1.2) + 1.5;
    const dist = fitDist(R) * 1.15;
    return { pos: orbitAt(m, dist, shot.az + shot.spin * ts, shot.elev), tgt: m, r: R };
  }
  if (shot.kind === 'shoulder' && subj.rov) {
    // behind the ROV, on the line from the colony through the ROV, a little to one side and up
    const tgt = aim(0.35);
    const d0 = sub3(subj.rov, c), dh = Math.hypot(d0[0], d0[2]) || 1;
    const az = Math.atan2(d0[0], d0[2]) + shot.side * (0.25 + 0.1 * Math.sin(ts * 0.1)) + shot.spin * ts * 0.3;
    const dist = Math.max(fitDist(r) * shot.zoom, Math.hypot(dh, d0[1]) + 1.6);
    const el = Math.max(0.12, Math.atan2(d0[1], dh) + 0.12 * shot.lift);
    return { pos: orbitAt(tgt, dist, az, el), tgt, r };
  }
  if (shot.kind === 'push') {
    const tgt = aim(0.55);
    const z = shot.zoom + (shot.zoom1 - shot.zoom) * ease;
    return { pos: orbitAt(tgt, fitDist(r) * Math.max(z, 1), shot.az + shot.spin * ts * 0.5, shot.elev), tgt, r: r * Math.min(1, z) };
  }
  // orbit (and wide or shoulder with no ROV)
  const tgt = aim(0.3);
  return { pos: orbitAt(tgt, fitDist(r) * Math.max(1, shot.zoom), shot.az + shot.spin * ts, shot.elev), tgt, r };
}

// A site for the dive colony: points of rock.sampleSurface, ranked by
// how near they are to a feature of the wanted kind (then any feature)
// and by exposure, with no overhang. siteR (0..1) picks among the best.
// Returns { p, n, feature } or null.
export function pickSite(rock, kind, siteR = 0, rand = Math.random, R = 30) {
  if (!rock || typeof rock.sampleSurface !== 'function') return null;
  let pts;
  // open, up-facing rock in the inner plot, not under a roof, not in the sand
  const sandAt = rock.sand && rock.sand.heightAt ? rock.sand.heightAt : null;
  const good = s => (s.n ? s.n[1] > 0.25 : true) && Math.hypot(s.p[0], s.p[2]) < R * 0.8 && !s.overhang && (s.exposure ?? 1) >= 0.2 && (!sandAt || s.p[1] > sandAt(s.p[0], s.p[2]) + 0.1);
  try { pts = rock.sampleSurface(160, rand, good); } catch (e) { pts = []; }
  if (!pts || !pts.length) { try { pts = rock.sampleSurface(160, rand, s => (s.n ? s.n[1] > 0.25 : true) && Math.hypot(s.p[0], s.p[2]) < R * 0.8); } catch (e) { pts = []; } }
  if (!pts || !pts.length) return null;
  const feats = (rock.features || []).filter(f => f && f.center);
  const want = feats.filter(f => f.kind === kind);
  const fsize = f => (Array.isArray(f.size) ? Math.max(...f.size) : f.size || 4);
  const score = s => {
    let best = 0;
    for (const f of (want.length ? want : feats)) {
      const d = len3(sub3(s.p, f.center)) / (fsize(f) * 0.6 + 1);
      best = Math.max(best, Math.exp(-d * d) * (f.kind === kind ? 1 : 0.5));
    }
    const ex = s.exposure ?? 0.5, ov = s.overhang ?? 0;
    return best * 2 + ex - ov * 2 + (s.n ? s.n[1] : 0.5) * 0.3;
  };
  const ranked = pts.map(s => ({ s, v: score(s) })).sort((a, b) => b.v - a.v).slice(0, 6);
  const pick = ranked[Math.min(ranked.length - 1, Math.floor(siteR * ranked.length))].s;
  let feature = null, fd = Infinity;
  for (const f of feats) { const d = len3(sub3(pick.p, f.center)); if (d < fd) { fd = d; feature = f; } }
  return { p: pick.p.slice(), n: (pick.n || [0, 1, 0]).slice(), feature };
}

// Move pos toward tgt until the segment tgt..pos has margin of free water
// (sdf: rock.sdf). Sphere tracing from tgt. Returns a new pos.
export function clearPath(sdf, tgt, pos, margin = 0.6) {
  if (typeof sdf !== 'function') return pos.slice();
  const d = sub3(pos, tgt), L = len3(d);
  if (L < 1e-6) return pos.slice();
  const u = [d[0] / L, d[1] / L, d[2] / L];
  let t = Math.min(L, 0.5), hit = L;
  for (let i = 0; i < 96 && t < L; i++) {
    const p = [tgt[0] + u[0] * t, tgt[1] + u[1] * t, tgt[2] + u[2] * t];
    const s = sdf(p[0], p[1], p[2]);
    if (s < margin) { hit = t; break; }
    t += Math.max(0.05, s - margin * 0.5);
  }
  if (hit >= L) return pos.slice();
  const k = Math.max(0.6, hit - margin);
  return [tgt[0] + u[0] * k, tgt[1] + u[1] * k, tgt[2] + u[2] * k];
}

// A camera position in open water with a clear line to the subject.
// sdf: rock.sdfAll (rock and sand; falls back to rock.sdf). scale:
// rock.sdfScale (the field is the true distance times scale, NOTES.md),
// so the margins below are true metres. tgt: the aim point; pos: the
// wanted camera; r: the subject radius (the trace starts at its edge,
// so the rock under the colony does not count). Tries the wanted pose,
// then more elevation (up to 1.2 rad), then turns round the subject; if
// no line is clear, the nearest clear point on the wanted line, never
// nearer than r + 0.8 m, lifted until the camera is in water.
// Returns { pos, how: 'clear' | 'lift' | 'turn' | 'near' }.
export function safeCamera(sdf, scale, tgt, pos, r = 0.3, o = {}) {
  if (typeof sdf !== 'function') return { pos: pos.slice(), how: 'clear' };
  const k = scale > 0 ? scale : 1, margin = (o.margin ?? 0.45) * k, start = Math.max(0.35, r * 0.9 + 0.25);
  const free = p => sdf(p[0], p[1], p[2]);
  const clearTo = (p) => {
    const d = sub3(p, tgt), L = len3(d);
    if (L <= start) return free(p) > margin;
    const u = [d[0] / L, d[1] / L, d[2] / L];
    let t = start;
    for (let i = 0; i < 160 && t < L; i++) {
      const q = [tgt[0] + u[0] * t, tgt[1] + u[1] * t, tgt[2] + u[2] * t];
      const s = free(q);
      if (s < margin) return false;
      t += Math.max(0.04, (s - margin * 0.5) / 1.5);
    }
    return free(p) > margin;
  };
  if (clearTo(pos)) return { pos: pos.slice(), how: 'clear' };
  const d = sub3(pos, tgt), L = Math.max(len3(d), r + 0.8);
  const az0 = Math.atan2(d[0], d[2]), el0 = Math.asin(Math.max(-1, Math.min(1, d[1] / (len3(d) || 1))));
  const at = (az, el) => [tgt[0] + Math.sin(az) * Math.cos(el) * L, tgt[1] + Math.sin(el) * L, tgt[2] + Math.cos(az) * Math.cos(el) * L];
  for (let e = el0 + 0.15; e <= 1.25; e += 0.15) { const p = at(az0, e); if (clearTo(p)) return { pos: p, how: 'lift' }; }
  for (const da of [0.5, -0.5, 1, -1, 1.6, -1.6, 2.3, -2.3, Math.PI]) for (const e of [Math.max(el0, 0.35), 0.8]) { const p = at(az0 + da, e); if (clearTo(p)) return { pos: p, how: 'turn' }; }
  // nearer on the wanted line, then up until in water
  const u = [d[0] / (len3(d) || 1), d[1] / (len3(d) || 1), d[2] / (len3(d) || 1)];
  let best = null;
  for (let t = L; t >= r + 0.8; t -= 0.25) { const p = [tgt[0] + u[0] * t, tgt[1] + u[1] * t, tgt[2] + u[2] * t]; if (clearTo(p)) { best = p; break; } }
  if (!best) best = [tgt[0] + u[0] * (r + 0.8), tgt[1] + u[1] * (r + 0.8), tgt[2] + u[2] * (r + 0.8)];
  for (let i = 0; i < 40 && free(best) <= margin; i++) best[1] += 0.25;
  return { pos: best, how: 'near' };
}

// The feed card in the saver: right of the clear band in a wide frame
// (16:9), under the subject and over the bottom text in a tall frame
// (9:16). w, h: canvas CSS px; band: { t, b } of the plate (or null);
// aspect: card w / h (352 / 322). Returns { w, h, left, top, clear }
// where clear is { r } or { b }: the px that frameFit must keep free.
export function cardRect(w, h, band, aspect = 352 / 322) {
  const t = band ? band.t || 0 : 0, b = band ? band.b || 0 : 0, land = w >= h;
  const cw = land ? Math.min(0.26 * w, 0.42 * (h - t - b) * aspect) : Math.min(0.5 * w, 0.2 * h * aspect);
  const ch = cw / aspect;
  const left = land ? w - 16 - cw : (w - cw) / 2;
  const top = land ? t + (h - t - b - ch) / 2 : h - b - ch - 8;
  return { w: cw, h: ch, left, top, clear: land ? { r: cw + 24 } : { b: ch + 16 + b } };
}

// w, h: canvas CSS px. clear: { l, r, t, b } px covered at each edge.
// radius: the subject sphere, or rx and ry: the half sizes of the subject
// across and up the screen. fov: the vertical field of view in degrees.
// fill: the part of the clear size that the subject may span. Returns
// { dist, ox, oy, cx, cy, wc, hc }.
export function frameFit({ w, h, clear = {}, radius, rx, ry, fov = 40, fill = 0.84 }) {
  const l = clear.l || 0, r = clear.r || 0, t = clear.t || 0, b = clear.b || 0;
  const wc = Math.max(1, w - l - r), hc = Math.max(1, h - t - b);
  const T = Math.tan(fov * Math.PI / 360);
  const av = Math.atan(T * (hc / h) * fill), ah = Math.atan(T * (wc / h) * fill);
  const dist = radius !== undefined
    ? radius / Math.sin(Math.min(av, ah))
    : Math.max(ry / Math.tan(av), rx / Math.tan(ah));
  const cx = l + wc / 2, cy = t + hc / 2;
  return { dist, ox: w / 2 - cx, oy: h / 2 - cy, cx, cy, wc, hc };
}

// Where the subject lands on screen for a fit: { x0, x1, y0, y1 } in px.
export function projectedBox({ w, h, fov = 40 }, fit, radius, rx, ry) {
  const T = Math.tan(fov * Math.PI / 360), k = (h / 2) / T;
  const px = radius !== undefined ? Math.tan(Math.asin(Math.min(1, radius / fit.dist))) * k : rx / fit.dist * k;
  const py = radius !== undefined ? px : ry / fit.dist * k;
  const x = w / 2 - fit.ox, y = h / 2 - fit.oy;
  return { x0: x - px, x1: x + px, y0: y - py, y1: y + py };
}

// Project a world sphere through a look-at camera with a view offset:
// the screen box (px) of its outline, or null if it is behind the eye.
export function projectSphere({ w, h, fov = 40, ox = 0, oy = 0 }, pos, tgt, c, r) {
  const f = norm3(sub3(tgt, pos));
  const rt = norm3([-f[2], 0, f[0]]);          // f x (0, 1, 0): the screen right
  const up = [rt[1] * f[2] - rt[2] * f[1], rt[2] * f[0] - rt[0] * f[2], rt[0] * f[1] - rt[1] * f[0]];
  const d = sub3(c, pos);
  const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  if (z <= r) return null;
  const x = d[0] * rt[0] + d[1] * rt[1] + d[2] * rt[2], y = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
  const k = (h / 2) / Math.tan(fov * Math.PI / 360);
  const ang = Math.asin(Math.min(1, r / Math.hypot(x, y, z)));
  const sx = w / 2 - ox + x / z * k, sy = h / 2 - oy - y / z * k;
  const pr = Math.tan(ang) * k * Math.hypot(x, y, z) / z;
  return { x0: sx - pr, x1: sx + pr, y0: sy - pr, y1: sy + pr };
}
