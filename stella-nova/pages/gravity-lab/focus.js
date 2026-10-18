// ============================================================================
//  GRAVITY LAB  ·  focus.js — where the action is, and how dense it looks
// ----------------------------------------------------------------------------
//  director.js calls this file for the calm view: the framing when no pair
//  is in a close pass. It is the shared action camera (lib/action-camera.js
//  createActionCamera) on a weighted sample of the run: the live bodies and
//  up to SAMPLE particle rows. No DOM, no GPU (node tests import it).
//
//  THE SAMPLE (focusSample). One point per body and per sampled particle,
//  in frame coordinates (frame.js), with a weight:
//    body       1; a body that is unbound and outbound (leaving) LEAVE_W;
//               a body that has left (gone) 0
//    particles  PART_SHARE x the sum of the body weights, shared out over
//               the sampled rows; the weight fades from NEAR to FAR x
//               the view extent (0 past FAR); a
//               row that is unbound and outbound against the bodies' mass
//               at the frame centre LEAVE_W
//  The action camera adds (1 + actionK x activity): fast bodies weigh
//  more (the speed is against the frame centre).
//
//  THE HOOK. An experiment can have focus(st) (experiments/*.js). st is
//  { spec, sys, frame, gone, leaving, parts, ext, rNow, t }; parts is
//  { pos, vel (frame), row, group, n } or null. It returns any of:
//    bodyW        a weight per body (replaces the generic 1 / LEAVE_W)
//    partShare    the particle share (replaces PART_SHARE)
//    partW(k)     a weight factor for sampled row k (st.parts.group[k],
//                 st.parts.row[k] tell what the row is)
//    points       extra points [[x, y, z, w]] in frame coordinates (the
//                 Lagrange points)
//    preferRadius the framing radius is at least this
//    hold         bodies the framing must hold (both galaxy cores): the
//                 radius is at least 1.1 x their distance from the centre
//    actionK      the action camera's activity factor (default ACTION_K)
//    keepLeaving  true: unbound outbound rows keep their weight
//
//  THE FRAMER (makeFramer, frameAction). One action camera per run. Each
//  frame the radius floor is max(MIN_EXT x ext, MIN_BODY x the largest
//  drawn radius, preferRadius): a close pass never fills the screen with
//  one white disc. The ceiling is MAX_EXT x ext. The action camera keeps
//  its dead zone, springs and zoom rate cap; the framing is MARGIN x its
//  radius (its radius goal moves only past +-18%). LEAD: the springs trail
//  a subject that drifts at a steady speed (a binary that recoils from an
//  escaper); the centre goes ahead by the weighted mean velocity times
//  the spring lag, at most LEAD_MAX x the radius.
//
//  DENSITY (densityGain). The particles add their light. Two limits dim
//  them before a dense core goes white: the brightness hint of the action
//  camera (goal.brightness) for the rows in the framed disc (the share in
//  its core, CORE x the radius, scaled to the disc), and the light of the
//  densest CELL px screen cell (peakDensity) under OVERLAP. The gain
//  factor is in [GAIN_MIN, 1]; the point size floor follows it.
//
//  BLOOM (bloomFactor): a star drawn over BLOOM_PX px of radius fades the
//  bloom to BLOOM_MIN, so a close pass does not glow over the screen.
//
//  TRAILS (trailCap): at most TRAIL_ALL trail points in all, and past
//  TRAIL_FULL trails each trail is fainter.
//
//  LABELS (thinLabels): the body names by priority (the selection, the
//  dominant body, thrown items, then mass); a name that would overlap a
//  name kept before is not shown, at most 10 (3 on a phone).
//
//  PARTICLE ROWS (sampleRows): every k-th live row of a readback (12
//  floats per row, mass > 0 is live), in the frame of the readback, with
//  the sim time; partsInFrame moves them on to the time of this frame
//  (pos + vel x (t - t_read), at most EXTRA x the view extent).
//
//  grep -n targets: "export const FOCUS", "export function sampleRows",
//  "export function partsInFrame", "export function leavingMask", "export function keepBound",
//  "export function focusSample", "export function makeFramer", "export function velInFrame",
//  "export function frameAction", "export function weightInView",
//  "export function peakDensity", "export function densityGain",
//  "export function bloomFactor", "export function thinLabels",
//  "export function trailCap"
// ============================================================================
import { createActionCamera } from '../../lib/action-camera.js';
import { toFrame, dirToFrame } from './frame.js';

export const FOCUS = {
  SAMPLE: 2048, PART_SHARE: 0.6, LEAVE_W: 0.08, NEAR: 1.5, FAR: 2.5, ACTION_K: 0.6,
  PERCENTILE: 0.85, FILL: 0.62, MIN_EXT: 0.1, MIN_BODY: 12, MAX_EXT: 2.5,
  HALF_LIFE: 0.5, ZOOM_RATE: 1.0, DEAD: 0.12, READ_S: 0.4, MARGIN: 1.2, EXTRA: 0.1, LEAD_MAX: 1,
  CORE: 0.2, TARGET_DENSITY: 0.2, GAIN_MIN: 0.25, CELL: 24, OVERLAP: 1.5, TRAIL_ALL: 5000, TRAIL_FULL: 8, BLOOM_PX: 36, BLOOM_MIN: 0.3,
};

// The velocity in the frame of a point at frame position p with world
// velocity v: R (v - v_c) - omega z x p (at rest in a turning frame: 0).
export function velInFrame(f, p, v) {
  const u = dirToFrame(f, [v[0] - f.v[0], v[1] - f.v[1], v[2] - f.v[2]]), om = f.om || 0;
  return [u[0] + om * p[1], u[1] - om * p[0], u[2]];
}

// Every k-th live row of a readback body array: { pos, vel, row
// (Int32Array), n, live (all live rows), t, frame }. With a frame (the
// frame at the time of the readback) pos and vel are in its coordinates
// (vel against the frame centre), else in world coordinates.
export function sampleRows(body, nRows, t, frame = null, max = FOCUS.SAMPLE) {
  let live = 0;
  for (let i = 0; i < nRows; i++) if (body[12 * i + 7] > 0) live++;
  const step = Math.max(1, Math.ceil(live / max)), n = Math.ceil(live / step);
  const pos = new Float64Array(3 * n), vel = new Float64Array(3 * n), row = new Int32Array(n);
  let k = 0, q = 0;
  for (let i = 0; i < nRows && k < n; i++) {
    const o = 12 * i;
    if (!(body[o + 7] > 0)) continue;
    if (q++ % step) continue;
    let p = [body[o], body[o + 1], body[o + 2]], v = [body[o + 4], body[o + 5], body[o + 6]];
    if (frame) { p = toFrame(frame, p); v = velInFrame(frame, p, v); }
    pos.set(p, 3 * k); vel.set(v, 3 * k);
    row[k++] = i;
  }
  return { pos: pos.subarray(0, 3 * k), vel: vel.subarray(0, 3 * k), row: row.subarray(0, k), n: k, live, t, frame };
}

// The sample at sim time t: { pos, vel, row, group, n, live } in frame
// coordinates. A sample taken in a frame keeps those coordinates (dust at
// rest in a turning frame stays at rest); a world sample goes into this
// frame. Each row moves on by vel x (t - t_read), but at most EXTRA x the
// view extent (ext): a straight line is right for a tail or debris, and
// wrong for an orbit over a long time. group: the spec's particle groups
// (a row past it is debris: -1).
export function partsInFrame(ps, frame, t, group = null, ext = Infinity) {
  if (!ps || !ps.n) return null;
  const n = ps.n, pos = new Float64Array(3 * n), vel = new Float64Array(3 * n), g = new Int16Array(n);
  const dt = isFinite(t - ps.t) ? t - ps.t : 0, cap = FOCUS.EXTRA * ext;
  for (let k = 0; k < n; k++) {
    const o = 3 * k;
    let p = [ps.pos[o], ps.pos[o + 1], ps.pos[o + 2]], u = [ps.vel[o], ps.vel[o + 1], ps.vel[o + 2]];
    if (!ps.frame) { p = toFrame(frame, p); u = velInFrame(frame, p, u); }
    const s = Math.hypot(u[0], u[1], u[2]) * Math.abs(dt), f = s > cap ? cap / s : 1;
    pos[o] = p[0] + u[0] * dt * f; pos[o + 1] = p[1] + u[1] * dt * f; pos[o + 2] = p[2] + u[2] * dt * f;
    vel[o] = u[0]; vel[o + 1] = u[1]; vel[o + 2] = u[2];
    g[k] = group && ps.row[k] < group.length ? group[ps.row[k]] : -1;
  }
  return { pos, vel, row: ps.row, group: g, n, live: ps.live };
}

// The bodies that are unbound and move out (against the bound centre of
// mass), before they are far enough to be gone: 1 in the mask. A body
// bound to a body that stays is not leaving (keepBound).
export function leavingMask(sys, gone) {
  const n = sys.n, out = new Uint8Array(n);
  let M = 0; const c = [0, 0, 0], u = [0, 0, 0];
  for (let i = 0; i < n; i++) if (sys.alive[i] && !gone[i] && sys.m[i] > 0) { M += sys.m[i]; for (let k = 0; k < 3; k++) { c[k] += sys.m[i] * sys.x[3 * i + k]; u[k] += sys.m[i] * sys.v[3 * i + k]; } }
  if (!(M > 0)) return out;
  for (let k = 0; k < 3; k++) { c[k] /= M; u[k] /= M; }
  for (let i = 0; i < n; i++) {
    if (!sys.alive[i] || gone[i]) continue;
    const dx = sys.x[3 * i] - c[0], dy = sys.x[3 * i + 1] - c[1], dz = sys.x[3 * i + 2] - c[2];
    const vx = sys.v[3 * i] - u[0], vy = sys.v[3 * i + 1] - u[1], vz = sys.v[3 * i + 2] - u[2];
    const r = Math.hypot(dx, dy, dz), Mo = Math.max(M - sys.m[i], 1e-300);
    const E = 0.5 * (vx * vx + vy * vy + vz * vz) - Mo / Math.max(r, 1e-300);
    if (E > 0 && dx * vx + dy * vy + dz * vz > 0) out[i] = 1;
  }
  return keepBound(sys, out, gone);
}
// A body in the mask that is bound (two-body energy) to a live body that
// is not in the mask stays: the members of a tight binary that recoils.
export function keepBound(sys, mask, skip = null) {
  const out = mask.slice(), X = sys.x, V = sys.v;
  for (let i = 0; i < sys.n; i++) {
    if (!mask[i] || !sys.alive[i]) continue;
    for (let j = 0; j < sys.n; j++) {
      if (j === i || mask[j] || !sys.alive[j] || (skip && skip[j])) continue;
      const dx = X[3 * i] - X[3 * j], dy = X[3 * i + 1] - X[3 * j + 1], dz = X[3 * i + 2] - X[3 * j + 2];
      const vx = V[3 * i] - V[3 * j], vy = V[3 * i + 1] - V[3 * j + 1], vz = V[3 * i + 2] - V[3 * j + 2];
      if (0.5 * (vx * vx + vy * vy + vz * vz) < (sys.m[i] + sys.m[j]) / Math.max(Math.hypot(dx, dy, dz), 1e-300)) { out[i] = 0; break; }
    }
  }
  return out;
}

// The weighted sample: { pos, vel, mass (the weights), count, stride,
// preferRadius, actionK }. st: see THE HOOK; hook: the experiment's focus.
export function focusSample(st, hook = null) {
  const sys = st.sys, P = st.parts, ext = st.ext;
  const h = (hook && hook(st)) || {};
  const nb = sys ? sys.n : 0, np = P ? P.n : 0, extra = h.points || [];
  const cnt = nb + np + extra.length;
  const pos = new Float64Array(3 * cnt), vel = new Float64Array(3 * cnt), w = new Float64Array(cnt);
  let k = 0, sumB = 0;
  for (let i = 0; i < nb; i++) {
    if (!sys.alive[i] || st.gone[i]) continue;
    const wi = h.bodyW ? Math.max(0, h.bodyW[i] || 0) : (st.leaving[i] ? FOCUS.LEAVE_W : 1);
    if (!(wi > 0)) continue;
    const p = toFrame(st.frame, sys.pos(i)), v = velInFrame(st.frame, p, sys.vel(i));
    pos.set(p, 3 * k); vel.set(v, 3 * k); w[k++] = wi; sumB += wi;
  }
  if (np) {
    const share = (h.partShare ?? FOCUS.PART_SHARE) * Math.max(sumB, 1), far2 = (FOCUS.FAR * ext) ** 2;
    // a row that is unbound and outbound against the mass of the bodies
    // at the frame centre (debris flung away) weighs LEAVE_W (the hook
    // can keep them: keepLeaving, the tidal tails)
    let Mb = 0; if (sys) for (let i = 0; i < nb; i++) if (sys.alive[i]) Mb += sys.m[i];
    const leave = !h.keepLeaving && Mb > 0;
    let sumP = 0; const k0 = k;
    for (let q = 0; q < np; q++) {
      const o = 3 * q, x = P.pos[o], y = P.pos[o + 1], z = P.pos[o + 2];
      const r2 = x * x + y * y + z * z;
      if (r2 > far2) continue;
      // the weight fades from NEAR to FAR x the view extent (no jump when
      // a row passes FAR)
      const rr = Math.sqrt(r2) / ext, fade = rr <= FOCUS.NEAR ? 1 : (FOCUS.FAR - rr) / (FOCUS.FAR - FOCUS.NEAR);
      let f = (h.partW ? Math.max(0, h.partW(q) || 0) : 1) * fade;
      if (leave && f > 0) {
        const vx = P.vel[o], vy = P.vel[o + 1], vz = P.vel[o + 2];
        if (x * vx + y * vy + z * vz > 0 && 0.5 * (vx * vx + vy * vy + vz * vz) > Mb / Math.max(Math.sqrt(r2), 1e-300)) f *= FOCUS.LEAVE_W;
      }
      if (!(f > 0)) continue;
      pos[3 * k] = x; pos[3 * k + 1] = y; pos[3 * k + 2] = z;
      vel[3 * k] = P.vel[o]; vel[3 * k + 1] = P.vel[o + 1]; vel[3 * k + 2] = P.vel[o + 2];
      w[k++] = f; sumP += f;
    }
    if (sumP > 0) for (let q = k0; q < k; q++) w[q] *= share / sumP;
  }
  for (const p of extra) { pos[3 * k] = p[0]; pos[3 * k + 1] = p[1]; pos[3 * k + 2] = p[2]; w[k++] = Math.max(0, p[3] ?? 1); }
  const hold = (h.hold || []).filter(i => sys && i < nb && sys.alive[i] && !st.gone[i]).map(i => toFrame(st.frame, sys.pos(i)));
  return { pos, vel, mass: w, count: k, stride: 3, preferRadius: h.preferRadius || 0, hold, actionK: h.actionK ?? FOCUS.ACTION_K };
}

const HOLD_K = 1.1;
// One action camera per run.
export function makeFramer() {
  return { ac: null, k: null, last: null };
}
// The calm framing: { target, radius, sample, goal } (frame coordinates).
// st as for focusSample; dt real seconds.
export function frameAction(fr, st, dt, hook = null) {
  const s = focusSample(st, hook);
  if (!s.count) return null;
  if (!fr.ac || fr.k !== s.actionK) {
    fr.ac = createActionCamera({ fill: FOCUS.FILL, percentile: FOCUS.PERCENTILE, actionK: s.actionK, deadZone: FOCUS.DEAD, halfLife: FOCUS.HALF_LIFE, maxZoomRate: FOCUS.ZOOM_RATE, targetDensity: FOCUS.TARGET_DENSITY });
    fr.k = s.actionK;
  }
  let rmax = 0;
  if (st.rNow && st.sys) for (let i = 0; i < st.sys.n; i++) if (st.sys.alive[i] && !st.gone[i]) rmax = Math.max(rmax, st.rNow[i] || 0);
  const o = fr.ac.options;
  // the bodies to hold: their distance from the last centre
  let hr = 0;
  const c0 = fr.last && fr.last.target;
  if (c0) for (const p of s.hold) hr = Math.max(hr, HOLD_K * Math.hypot(p[0] - c0[0], p[1] - c0[1], p[2] - c0[2]));
  o.minRadius = Math.max(FOCUS.MIN_EXT * st.ext, FOCUS.MIN_BODY * rmax, s.preferRadius, hr / FOCUS.MARGIN);
  o.maxRadius = Math.max(o.minRadius, FOCUS.MAX_EXT * st.ext);
  const g = fr.ac.update(s, dt);
  // LEAD: the springs of the action camera trail a subject that moves at
  // a steady speed by 2 v / omega; the weighted mean velocity of the
  // sample (sim units, times the sim rate: sim time per real second) puts
  // the centre that far ahead, at most LEAD_MAX x the radius
  const t = st.t ?? 0;
  if (fr.tPrev !== undefined && dt > 0) { const rate = Math.max(0, (t - fr.tPrev) / dt); fr.rate = fr.rate === undefined ? rate : fr.rate + (rate - fr.rate) * Math.min(1, 4 * dt); }
  fr.tPrev = t;
  let sw = 0; const vb = [0, 0, 0];
  for (let q = 0; q < s.count; q++) { const w = s.mass[q]; sw += w; vb[0] += w * s.vel[3 * q]; vb[1] += w * s.vel[3 * q + 1]; vb[2] += w * s.vel[3 * q + 2]; }
  if (sw > 0) for (let q = 0; q < 3; q++) vb[q] /= sw;
  if (!fr.vb) fr.vb = vb; else for (let q = 0; q < 3; q++) fr.vb[q] += (vb[q] - fr.vb[q]) * Math.min(1, 4 * dt);
  const lagT = 2 / (2 * Math.LN2 / FOCUS.HALF_LIFE * 1.6783), k = (fr.rate || 0) * lagT;
  let lead = [fr.vb[0] * k, fr.vb[1] * k, fr.vb[2] * k];
  const ll = Math.hypot(...lead), lm = FOCUS.LEAD_MAX * g.radius;
  if (ll > lm) lead = lead.map(x => x * lm / ll);
  const center = [g.center[0] + lead[0], g.center[1] + lead[1], g.center[2] + lead[2]];
  // MARGIN: the action camera moves its radius goal only past +-18%, so
  // the framing holds a little more than the radius
  fr.last = { target: center, radius: FOCUS.MARGIN * Math.min(o.maxRadius, Math.max(o.minRadius, g.radius)), sample: s, goal: g };
  return fr.last;
}

// The share of the sample's weight that a camera shows: proj(p) -> { x, y }
// or null; the screen box [x0, x1] x [y0, y1].
export function weightInView(s, proj, box) {
  let all = 0, inside = 0;
  for (let k = 0; k < s.count; k++) {
    const w = s.mass[k]; if (!(w > 0)) continue;
    all += w;
    const q = proj([s.pos[3 * k], s.pos[3 * k + 1], s.pos[3 * k + 2]]);
    if (q && q.x >= box[0] && q.x <= box[1] && q.y >= box[2] && q.y <= box[3]) inside += w;
  }
  return all > 0 ? inside / all : 1;
}

// The densest screen cell: points per px^2. pos: frame coordinates of
// the sampled rows (n of them, standing for nLive); proj(p) -> { x, y }.
export function peakDensity(pos, n, nLive, proj, W, H, cell = FOCUS.CELL) {
  if (!n) return 0;
  const nx = Math.max(1, Math.ceil(W / cell)), ny = Math.max(1, Math.ceil(H / cell)), bin = new Uint32Array(nx * ny);
  let top = 0;
  for (let k = 0; k < n; k++) {
    const q = proj([pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]]);
    if (!q || q.x < 0 || q.y < 0 || q.x >= W || q.y >= H) continue;
    const c = Math.floor(q.y / cell) * nx + Math.floor(q.x / cell);
    if (++bin[c] > top) top = bin[c];
  }
  return top * (nLive / n) / (cell * cell);
}

// The gain factor of the particles, in [GAIN_MIN, 1]. o: { fr (a
// frameAction result), nLive (live rows), viewPx (screen area), peak
// (peakDensity), ptPx (the point radius floor), gain (the base gain) }.
// Two limits: the brightness hint of the action camera for the rows in
// the framed disc (the core share scaled to the disc), and the light of
// the densest cell (overlap x gain) under OVERLAP.
export function densityGain(o) {
  let k = 1;
  const fr = o.fr;
  if (fr && fr.goal && o.nLive > 0) {
    const s = fr.sample, c = fr.target, rc2 = (FOCUS.CORE * fr.radius) ** 2;
    let core = 0;
    for (let q = 0; q < s.count; q++) {
      const dx = s.pos[3 * q] - c[0], dy = s.pos[3 * q + 1] - c[1], dz = s.pos[3 * q + 2] - c[2];
      if (dx * dx + dy * dy + dz * dz < rc2) core++;
    }
    const nCore = o.nLive * core / Math.max(1, s.count);
    k = Math.min(k, Math.sqrt(fr.goal.brightness(o.viewPx, nCore / (FOCUS.CORE * FOCUS.CORE))));
  }
  if (o.peak > 0) {
    const light = o.peak * Math.PI * (o.ptPx || 1) ** 2 * (o.gain || 1);
    k = Math.min(k, FOCUS.OVERLAP / light);
  }
  return Math.max(FOCUS.GAIN_MIN, Math.min(1, k));
}

// The bloom factor: px, the largest drawn radius of a star on screen.
export function bloomFactor(px) {
  if (!(px > FOCUS.BLOOM_PX)) return 1;
  return Math.max(FOCUS.BLOOM_MIN, FOCUS.BLOOM_PX / px);
}

// Labels that thin out when crowded: cands [{ i, x, y, pri }] (CSS px,
// higher pri first). A label is kept when no kept label is within gx x gy
// px of it, up to max labels. Returns the kept indices (a Set).
export function thinLabels(cands, max, gx = 84, gy = 20) {
  const kept = [], out = new Set();
  for (const c of cands.slice().sort((a, b) => b.pri - a.pri)) {
    if (kept.length >= max) break;
    if (kept.some(k => Math.abs(k.x - c.x) < gx && Math.abs(k.y - c.y) < gy)) continue;
    kept.push(c); out.add(c.i);
  }
  return out;
}

// The trail cap: the points of each of n trails (at most ring), and their
// alpha factor. All trails together keep under TRAIL_ALL points; past
// TRAIL_FULL trails each is fainter (alpha sqrt(TRAIL_FULL / n)).
export function trailCap(n, ring = 420) {
  n = Math.max(1, n);
  return { points: Math.max(60, Math.min(ring, Math.floor(FOCUS.TRAIL_ALL / n))), alpha: Math.min(1, Math.sqrt(FOCUS.TRAIL_FULL / n)) };
}
