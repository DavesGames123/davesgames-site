// ============================================================================
//  POOL PHYSICS  ·  core/cue.js — where the cue sits, clear of the table
// ----------------------------------------------------------------------------
//  The user asked: "make sure the cure does not intersect the table". A
//  level cue goes through the rail when the cue ball is near a cushion, and
//  through a ball that is behind the cue ball. cuePose() lifts the butt
//  just enough: it finds the lowest elevation alpha at which the cue (a
//  tapered cylinder, 1.48 m) clears every ball and the rail along its full
//  length, and it puts the bridge (the hand) on the rail or on the cloth.
//
//  Frame: the table frame of core/table.js (x along the table, y across,
//  z up from the cloth). The tip touches the cue ball at the point (a, b)
//  of its face: a to the right of the shooter, b up, both fractions of R.
//
//    cuePose(T, S, { x, y, phi, a, b, back }) -> pose
//      pose.elev      alpha, rad (2 deg at least)
//      pose.tip       [x, y, z] the tip end of the cue
//      pose.butt      [x, y, z] the butt end
//      pose.u         [ux, uy, uz] the unit axis, tip to butt
//      pose.contact   [x, y, z] the tip point on the cue ball
//      pose.bVis      the b that the picture uses (b, or less draw when a
//                     steep cue would go into the cue ball)
//      pose.bridge    { x, y, z, rail } the bridge point under the cue
//      pose.need      [{ what, elev }] the limits that set alpha
//    cueRadius(s)     the cue radius at s metres from the tip (view/scene3d
//                     buildCue makes the same taper)
//    cueClearance(T, S, pose) -> { min, what, s }  the smallest gap from the
//                     cue surface to a ball or to the rail top (tests)
//  The physics (core/physics.js strike) keeps a level cue: the lift is
//  for the picture. A real player jacks up the butt the same way.
//
//  grep -n targets: "export const CUE", "export function cueRadius",
//  "export function cuePose", "export function cueClearance"
// ============================================================================

const D2R = Math.PI / 180;
export const CUE = { len: 1.48, minElev: 2 * D2R, maxElev: 80 * D2R, margin: 0.003, bridgeS: 0.24 };

// The taper of the cue: tip, ferrule, maple shaft, joint ring, ebony butt.
export function cueRadius(s) {
  if (s < 0.008) return 0.0064;
  if (s < 0.03) return 0.0065;
  if (s < 0.75) return 0.0065 + (s - 0.03) / 0.72 * 0.004;
  if (s < 0.77) return 0.011;
  return Math.min(0.0146, 0.011 + (s - 0.77) / 0.70 * 0.0036);
}
const R_MAX = 0.0146;

// The distance along the ray (px, py) + s (dx, dy) to the first exit of the
// box |x| < X, |y| < Y (the ray starts inside). Infinity when it starts out.
function exitBox(px, py, dx, dy, X, Y) {
  if (Math.abs(px) > X || Math.abs(py) > Y) return 0;
  let s = Infinity;
  if (dx > 1e-12) s = Math.min(s, (X - px) / dx); else if (dx < -1e-12) s = Math.min(s, (-X - px) / dx);
  if (dy > 1e-12) s = Math.min(s, (Y - py) / dy); else if (dy < -1e-12) s = Math.min(s, (-Y - py) / dy);
  return s;
}

export function cuePose(T, S, shot) {
  // A pull-back that puts the tip over the rail or a ball shortens until the
  // cue fits. A cue ball frozen on the cushion (or on a ball behind it) is
  // hit from above: the picture then moves the tip up the ball face.
  const b0 = shot.b || 0, back0 = shot.back ?? 0.02;
  let first = null;
  for (const bv of [b0, 0.3, 0.5, 0.7, 0.85, 0.95]) {
    if (bv < b0) continue;
    for (const back of [back0, back0 * 0.5, back0 * 0.25, 0]) {
      const p = poseAt(T, S, Object.assign({}, shot, { b: bv }), back);
      if (!first) first = p;
      if (p.elev < CUE.maxElev - 1e-9) { p.bVis = Math.min(p.bVis, bv); return p; }
    }
  }
  return first;
}

function poseAt(T, S, { x, y, phi, a = 0, b = 0 }, back) {
  const R = T.R, sp = T.spec, m = CUE.margin;
  const dx = Math.cos(phi), dy = Math.sin(phi), rx = dy, ry = -dx;   // d and the shooter's right
  const railH = sp.railTop, ox = T.hx + sp.cushionW + sp.railW, oy = T.hy + sp.cushionW + sp.railW;
  const need = [{ what: 'min', elev: CUE.minElev }];
  // the tip point on the face, for the asked (a, b); b may shrink below
  const contactOf = bb => {
    const f = Math.sqrt(Math.max(0, 1 - a * a - bb * bb));
    return [x + rx * a * R - dx * f * R, y + ry * a * R - dy * f * R, R + bb * R];
  };
  let c = contactOf(b);
  // horizontal distance along -d from the contact point, and the axis height there
  const hx = c[0], hy = c[1];
  // 1. the rail: from the nose line out to the outer edge of the wood
  const sN = exitBox(hx, hy, -dx, -dy, T.hx, T.hy);
  const sO = exitBox(hx, hy, -dx, -dy, ox, oy);
  // 2. the balls behind the cue ball (and beside the line)
  const balls = [];
  for (let k = 1; k < 16; k++) {
    if (!S.on[k]) continue;
    const wx = S.x[k] - hx, wy = S.y[k] - hy, s = -(wx * dx + wy * dy), l = Math.abs(wx * rx + wy * ry);
    if (s > -R - R_MAX - m && l < R + R_MAX + m) balls.push({ k, s, l });
  }
  // the axis height that clears an obstacle top H at horizontal distance s:
  // (z_axis - H) cos(alpha) >= r + margin; z_axis = z0 + s tan(alpha)
  const elevFor = (H, s, r, z0) => {
    if (s <= 1e-4) return CUE.maxElev;
    // solve z0 + s t >= H + (r + m) sqrt(1 + t^2) for t = tan(alpha) (fixed point, it converges fast)
    let t = Math.max(0, (H + r + m - z0) / s);
    for (let i = 0; i < 6; i++) t = Math.max(0, (H + (r + m) * Math.sqrt(1 + t * t) - z0) / s);
    return Math.atan(t);
  };
  const z0 = c[2];
  // the tip end sits back * cos(alpha) behind the contact, so solve twice
  let elev = CUE.minElev, list = need;
  for (let pass = 0; pass < 3; pass++) {
    const sb0 = back * Math.cos(elev);
    list = need.slice();
    if (sN < Infinity && sN <= back + CUE.len) {
      // the rail band starts at the nose; the cue is lowest (and thinnest) there
      const s = Math.max(sN, sb0);
      list.push({ what: 'rail', elev: elevFor(railH, s, cueRadius((s - sb0) / Math.cos(elev) + 0.001), z0) });
    }
    for (const q of balls) {
      if (q.s < sb0 - R - R_MAX - m || q.s > back + CUE.len + R + R_MAX + m) continue;
      const rr = cueRadius(Math.max(0, q.s - sb0));
      const reach = R + rr + m;
      if (q.l >= reach) continue;
      // the highest point of the ball under the cue footprint; the cue must
      // pass over it from where its footprint first meets the plan circle
      const top = R + Math.sqrt(Math.max(0, R * R - Math.max(0, q.l - rr) ** 2));
      const s0 = Math.max(sb0, q.s - Math.sqrt(Math.max(0, reach * reach - q.l * q.l)));
      list.push({ what: `ball ${q.k}`, elev: elevFor(top, s0, rr, z0) });
    }
    elev = Math.min(CUE.maxElev, Math.max(...list.map(q => q.elev)));
  }
  need.length = 0; need.push(...list);
  // the cue ball itself: a steep cue with draw goes into the ball. The cue
  // axis u = (-d cos e, sin e) must leave the face: b >= -sqrt(1 - a^2) cos e
  let bVis = b;
  const bMin = -Math.sqrt(Math.max(0, 1 - a * a)) * Math.cos(elev) + 0.06;
  if (bVis < bMin) { bVis = Math.min(0, bMin); c = contactOf(bVis); }
  const ce = Math.cos(elev), se = Math.sin(elev);
  const u = [-dx * ce, -dy * ce, se];
  const tip = [c[0] + u[0] * back, c[1] + u[1] * back, c[2] + u[2] * back];
  const butt = [tip[0] + u[0] * CUE.len, tip[1] + u[1] * CUE.len, tip[2] + u[2] * CUE.len];
  // the bridge: on the rail when the rail is close, else a hand on the cloth
  let bridge;
  const sb = back + CUE.bridgeS;
  if (sN < Infinity && sN < sb + 0.04 && sO > sN) {
    const s = Math.min(sO - 0.02, Math.max(sN + 0.05, back + 0.08)), t = (s - back) / ce;
    bridge = { x: c[0] - dx * s, y: c[1] - dy * s, z: c[2] + (s) * Math.tan(elev), rail: true, base: railH, s: t + back };
  } else {
    const s = sb, t = (s - back) / ce;
    bridge = { x: c[0] - dx * s, y: c[1] - dy * s, z: c[2] + s * Math.tan(elev), rail: false, base: 0, s: t + back };
  }
  return { elev, tip, butt, u, contact: c, bVis, bridge, need, phi, back };
}

// The smallest gap from the cue surface to the other balls, the cue ball
// (away from the tip) and the rail top, sampled every 5 mm along the cue.
export function cueClearance(T, S, pose) {
  const R = T.R, sp = T.spec, ox = T.hx + sp.cushionW + sp.railW, oy = T.hy + sp.cushionW + sp.railW;
  let min = Infinity, what = '', at = 0;
  for (let s = 0.004; s <= CUE.len; s += 0.005) {
    const r = cueRadius(s), px = pose.tip[0] + pose.u[0] * s, py = pose.tip[1] + pose.u[1] * s, pz = pose.tip[2] + pose.u[2] * s;
    for (let k = 0; k < 16; k++) {
      if (!S.on[k]) continue;
      if (k === 0 && s < 0.03) continue;   // the tip touches the cue ball
      const g = Math.hypot(px - S.x[k], py - S.y[k], pz - R) - R - r;
      if (g < min) { min = g; what = k ? `ball ${k}` : 'cue ball'; at = s; }
    }
    // the rail: the wood band between the nose box and the outer edge
    const inside = Math.abs(px) < T.hx && Math.abs(py) < T.hy, outside = Math.abs(px) > ox || Math.abs(py) > oy;
    if (!inside && !outside) {
      const g = pz - r - sp.railTop;
      if (g < min) { min = g; what = 'rail'; at = s; }
    }
    if (pz - r < -1e-9 && inside) { const g = pz - r; if (g < min) { min = g; what = 'cloth'; at = s; } }
  }
  return { min, what, s: at };
}
