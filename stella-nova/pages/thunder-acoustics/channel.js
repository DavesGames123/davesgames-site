// ============================================================================
//  THUNDER ACOUSTICS  ·  channel.js — the lightning channel and its source
// ----------------------------------------------------------------------------
//  Pure module (no DOM). Makes a tortuous channel in the x-z plane from a
//  coarse stroke, and gives the source numbers of the Few (1969) model.
//
//  The channel follows the stroke waypoints. Each step has a random length
//  near STEP_M and a direction that is the direction to the next waypoint
//  plus two angle terms: a slow meander (AR(1), large scale) and a fast
//  jitter with RMS angle sigma (small scale). Measured channels show a
//  mean change in direction of about 16 degrees per 10 m step.
//  Branches leave the main channel with probability pBranch per step. A
//  branch goes down at 20 to 55 degrees off the main direction, ends after
//  an exponential length, and carries a lower energy per unit length.
//
//  Few's model: the return stroke puts the energy E_l (J/m) into a
//  cylinder of radius R0 = sqrt(E_l / p0). The thunder spectrum has its
//  peak near f_m = 0.63 c0 / R0.
//
//  grep -n: "export function rng"  "export function fewRadius"
//           "export function fewFrequency"  "export function tortuous"
//           "export function autoStroke"  "export function soundSpeed"
// ============================================================================

export const P0 = 101325;          // sea-level pressure, Pa
export const STEP_M = 10;          // mean step of the tortuous channel, m

// Seeded PRNG (mulberry32). The same seed gives the same channel.
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  const f = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = f();
    v = f();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return f;
}

// Few (1969): radius of the channel when its pressure falls to ambient.
export function fewRadius(El) { return Math.sqrt(El / P0); }
// Few (1969): frequency of the spectral peak of thunder.
export function fewFrequency(El, c0 = 343) { return 0.63 * c0 / fewRadius(El); }
// Sound speed of dry air at temperature T (deg C).
export function soundSpeed(Tc) { return 20.05 * Math.sqrt(Tc + 273.15); }

// Make the tortuous channel.
//   stroke   [[x, z], ...] waypoints in metres, top first
//   opt      { seed, sigmaDeg, meanderDeg, pBranch, branchLen, ground(x),
//              W, H, maxOrder }
// Returns { segs: [{x0,z0,x1,z1,order,w}], length, mainLength, top, end }.
// w is the relative energy per unit length (1 on the main channel).
export function tortuous(stroke, opt = {}) {
  const r = rng(opt.seed ?? 1);
  const sig = (opt.sigmaDeg ?? 16) * Math.PI / 180;
  const mea = (opt.meanderDeg ?? 6) * Math.PI / 180;
  const pB = opt.pBranch ?? 0.012;
  const bLen = opt.branchLen ?? 500;
  const ground = opt.ground || (() => 0);
  const W = opt.W ?? 16000, H = opt.H ?? 6000;
  const maxOrder = opt.maxOrder ?? 2;
  const segs = [];
  let length = 0, mainLength = 0;
  const inside = (x, z) => x >= 0 && x <= W && z <= H && z >= ground(x);
  const pushSeg = (x0, z0, x1, z1, order, w) => {
    const l = Math.hypot(x1 - x0, z1 - z0);
    segs.push({ x0, z0, x1, z1, order, w });
    length += l;
    if (order === 0) mainLength += l;
  };

  function branch(x, z, heading, order, budget) {
    let m = 0, left = budget;
    const w = Math.pow(0.35, order);
    while (left > 0) {
      m = 0.96 * m + mea * 1.4 * r.gauss();
      const h = heading + m + sig * r.gauss();
      const l = STEP_M * (0.4 + 1.2 * r());
      const nx = x + l * Math.cos(h), nz = z + l * Math.sin(h);
      if (!inside(nx, nz)) break;
      pushSeg(x, z, nx, nz, order, w);
      if (order < maxOrder && r() < pB * 0.6) {
        const side = r() < 0.5 ? -1 : 1;
        branch(nx, nz, h + side * (0.35 + 0.6 * r()), order + 1, bLen * 0.45 * -Math.log(1 - r() * 0.95));
      }
      x = nx; z = nz; left -= l;
    }
  }

  if (!stroke || stroke.length < 2) return { segs, length: 0, mainLength: 0, top: null, end: null };
  let [x, z] = stroke[0];
  const top = [x, z];
  let m = 0;
  for (let wpi = 1; wpi < stroke.length; wpi++) {
    const [tx, tz] = stroke[wpi];
    const last = wpi === stroke.length - 1;
    let guard = 0;
    while (Math.hypot(tx - x, tz - z) > STEP_M * 1.5 && guard++ < 4000) {
      const toT = Math.atan2(tz - z, tx - x);
      m = 0.97 * m + mea * r.gauss() * 0.5;
      m = Math.max(-0.9, Math.min(0.9, m));
      const h = toT + m + sig * r.gauss();
      const l = STEP_M * (0.4 + 1.2 * r());
      let nx = x + l * Math.cos(h), nz = z + l * Math.sin(h);
      nx = Math.max(0, Math.min(W, nx)); nz = Math.min(H, nz);
      const g = ground(nx);
      if (nz <= g) { pushSeg(x, z, nx, g, 0, 1); x = nx; z = g; wpi = stroke.length; break; }
      pushSeg(x, z, nx, nz, 0, 1);
      if (maxOrder > 0 && r() < pB) {
        // a branch goes down and away from the main direction
        const side = r() < 0.5 ? -1 : 1;
        const bh = h + side * (0.35 + 0.6 * r());
        branch(nx, nz, bh, 1, bLen * -Math.log(1 - r() * 0.97));
      }
      x = nx; z = nz;
    }
    if (last && wpi === stroke.length - 1) {
      const g = ground(tx);
      const ez = Math.abs(tz - g) < 40 ? g : tz;
      if (Math.hypot(tx - x, ez - z) > 0.5) pushSeg(x, z, tx, ez, 0, 1);
      x = tx; z = ez;
    }
  }
  return { segs, length, mainLength, top, end: [x, z] };
}

// A cloud-to-ground stroke from the cloud base to the ground, seeded.
export function autoStroke(seed, { W = 16000, ground = () => 0, xMin = 2500, xMax = 9000, base = 4200 } = {}) {
  const r = rng(seed * 7 + 3);
  const xt = xMin + (xMax - xMin) * r();
  const zt = base + 600 * (r() - 0.3);
  const xe = Math.max(300, Math.min(W - 300, xt + (r() - 0.5) * 3000));
  const xm = (xt + xe) / 2 + (r() - 0.5) * 1200;
  const zm = (zt + ground(xm)) * (0.45 + 0.2 * r());
  return [[xt, zt], [xm, zm], [xe, ground(xe)]];
}
