// ============================================================================
//  ACTION CAMERA  ·  calm framing of the busy part of a particle simulation
// ----------------------------------------------------------------------------
//  For the gravity pages (galaxy, gravity-lab, gravity, roche-limit,
//  planet-collision). Each frame the page gives a sample of its bodies.
//  The module finds where the action is and how big it is, and returns a
//  smooth goal for the camera: a centre and a radius to frame. It also
//  gives a brightness hint, so a dense core does not wash the view out.
//
//  WHY: a camera that frames all bodies chases ejecta to the edge of the
//  world (the subject shrinks to a dot); a camera that frames the centre
//  of mass misses the collision; a camera that follows every change
//  shakes. This one weighs the bodies by mass and by action, frames a
//  trimmed percentile (outliers do not pull it), and moves only when the
//  subject leaves a dead zone, with critically damped springs.
//
//  DOM-free ES module (node tests import it).
//
//  USE
//    const ac = createActionCamera({ fill: 0.55 });
//    each frame:
//      const g = ac.update({ pos, mass, vel, acc, count, stride }, dt);
//      g.center [x, y, z], g.radius, g.distance(fovY, aspect), g.brightness
//    ac.reset()     after a new scenario (the next update snaps)
//
//  TWO HALVES  update(sample, dt) is follow(measure(sample), dt).
//    ac.measure(sample)      -> { c, r, n }: the trimmed centre, the
//                               percentile radius and the body count, with
//                               no change to the camera state
//    ac.follow({ c, r, n }, dt) -> the goal: the dead zone, the springs and
//                               the zoom cap on a centre and a radius that
//                               the page found its own way (for example a
//                               shot director that frames two cores)
//
//  INPUT  pos (and vel, acc) are flat arrays with `stride` floats per body
//  (default 3); mass is per body (default 1). Pass a subsample of large sets
//  (2 000 to 20 000 bodies is enough).
//
//  OPTIONS (defaults)
//    fill 0.55         the subject radius as a share of the half view height
//    percentile 0.85   the share of action weight the radius must hold
//    actionK 1.5       how much speed and acceleration add to the weight
//    deadZone 0.25     the centre moves only when the subject leaves this
//                      share of the frame; the radius only past +-18%
//    halfLife 1.2 s    spring half-life of the centre and radius
//    maxZoomRate 0.35  most change of log(radius) per second
//    minRadius, maxRadius   clamps in world units
//    targetDensity 0.6 projected bodies per pixel area for brightness 1
//
//  grep -n targets
//    weights ............. "function weightsOf"
//    trimmed centre ...... "function robustCenter"
//    framing radius ...... "function percentileRadius"
//    springs ............. "function spring"
// ============================================================================

const DEF = {
  fill: 0.55, percentile: 0.85, actionK: 1.5, deadZone: 0.25, radiusBand: 0.18,
  halfLife: 1.2, maxZoomRate: 0.35, minRadius: 1e-6, maxRadius: Infinity, targetDensity: 0.6,
};

// Mass times (1 + actionK * activity): activity is speed and acceleration
// over their medians, so fast and strongly pulled bodies (the collision,
// the tidal bridge) weigh more than the quiet halo.
function weightsOf(s, n, out) {
  const st = s.stride || 3, m = s.mass, v = s.vel, a = s.acc;
  const sp = new Float64Array(n), ac = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * st;
    sp[i] = v ? Math.sqrt(v[o] * v[o] + v[o + 1] * v[o + 1] + v[o + 2] * v[o + 2]) : 0;
    ac[i] = a ? Math.sqrt(a[o] * a[o] + a[o + 1] * a[o + 1] + a[o + 2] * a[o + 2]) : 0;
  }
  const med = arr => { const c = Array.from(arr).sort((x, y) => x - y); return c[c.length >> 1] || 1; };
  const ms = v ? med(sp) || 1 : 1, ma = a ? med(ac) || 1 : 1;
  return { w: out, fill(k) {
    for (let i = 0; i < n; i++) {
      const act = (v ? Math.min(4, sp[i] / ms) : 0) * 0.5 + (a ? Math.min(4, ac[i] / ma) : 0) * 0.5;
      out[i] = (m ? Math.max(0, +m[i] || 0) : 1) * (1 + k * act);
    }
  } };
}

// Weighted centre that ignores the far tail: start at the weighted mean,
// then twice keep the bodies inside the weighted 80th percentile radius.
function robustCenter(pos, st, w, n) {
  let c = [0, 0, 0];
  const mean = keep => {
    let sx = 0, sy = 0, sz = 0, sw = 0;
    for (let i = 0; i < n; i++) { if (keep && !keep[i]) continue; const o = i * st, wi = w[i]; sx += pos[o] * wi; sy += pos[o + 1] * wi; sz += pos[o + 2] * wi; sw += wi; }
    return sw > 0 ? [sx / sw, sy / sw, sz / sw] : c;
  };
  c = mean(null);
  const keep = new Uint8Array(n);
  for (let it = 0; it < 2; it++) {
    const r = percentileRadius(pos, st, w, n, c, 0.8);
    for (let i = 0; i < n; i++) { const o = i * st, dx = pos[o] - c[0], dy = pos[o + 1] - c[1], dz = pos[o + 2] - c[2]; keep[i] = dx * dx + dy * dy + dz * dz <= r * r * 1.0001 ? 1 : 0; }
    c = mean(keep);
  }
  return c;
}

// The radius round c that holds share p of the weight.
function percentileRadius(pos, st, w, n, c, p) {
  const d = new Array(n);
  let sw = 0;
  for (let i = 0; i < n; i++) { const o = i * st, dx = pos[o] - c[0], dy = pos[o + 1] - c[1], dz = pos[o + 2] - c[2]; d[i] = [Math.sqrt(dx * dx + dy * dy + dz * dz), w[i]]; sw += w[i]; }
  d.sort((a, b) => a[0] - b[0]);
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += d[i][1]; if (acc >= p * sw) return d[i][0]; }
  return n ? d[n - 1][0] : 0;
}

// Critically damped spring step (frame-rate independent) toward goal.
function spring(x, v, goal, halfLife, dt) {
  const w = 2 * Math.LN2 / Math.max(1e-3, halfLife) * 1.6783; // matches the half-life of a critical spring
  const e = Math.exp(-w * dt), d = x - goal;
  const nx = goal + (d + (v + w * d) * dt) * e;
  const nv = (v - w * (v + w * d) * dt) * e;
  return [nx, nv];
}

export function createActionCamera(opts = {}) {
  const o = Object.assign({}, DEF, opts);
  let st = null; // { c:[3], cv:[3], r, rv, goalC, goalR }
  let wbuf = new Float64Array(0);

  function measure(s) {
    const n = Math.max(0, s.count ?? Math.floor(s.pos.length / (s.stride || 3)));
    if (!n) return null;
    if (wbuf.length < n) wbuf = new Float64Array(n);
    const W = weightsOf(s, n, wbuf); W.fill(o.actionK);
    const c = robustCenter(s.pos, s.stride || 3, wbuf, n);
    const r = percentileRadius(s.pos, s.stride || 3, wbuf, n, c, o.percentile);
    return { c, r: Math.min(o.maxRadius, Math.max(o.minRadius, r)), n };
  }

  function update(sample, dt = 1 / 60) {
    return follow(measure(sample), dt);
  }

  function follow(m, dt = 1 / 60) {
    if (!m) return goal();
    m = { c: m.c, r: Math.min(o.maxRadius, Math.max(o.minRadius, m.r)), n: m.n || 0 };
    dt = Math.min(0.25, Math.max(0, dt));
    if (!st) { st = { c: m.c.slice(), cv: [0, 0, 0], r: m.r, rv: 0, goalC: m.c.slice(), goalR: m.r, n: m.n }; return goal(); }
    st.n = m.n;
    // dead zone: move the goal centre only when the subject leaves it
    const dx = m.c[0] - st.goalC[0], dy = m.c[1] - st.goalC[1], dz = m.c[2] - st.goalC[2];
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) > o.deadZone * st.r) st.goalC = m.c.slice();
    if (Math.abs(Math.log(m.r / st.goalR)) > Math.log(1 + o.radiusBand)) st.goalR = m.r;
    for (let k = 0; k < 3; k++) { const s2 = spring(st.c[k], st.cv[k], st.goalC[k], o.halfLife, dt); st.c[k] = s2[0]; st.cv[k] = s2[1]; }
    // zoom in log space with a rate cap, so it never lunges
    const lr = Math.log(st.r), [nl, nv] = spring(lr, st.rv, Math.log(st.goalR), o.halfLife * 1.4, dt);
    const cap = o.maxZoomRate * dt;
    st.r = Math.exp(lr + Math.max(-cap, Math.min(cap, nl - lr))); st.rv = nv;
    return goal();
  }

  function goal() {
    if (!st) return null;
    const c = st.c.slice(), r = st.r, n = st.n || 0;
    return {
      center: c, radius: r,
      // camera distance so that the radius fills `fill` of the half height
      distance(fovY, aspect = 1) {
        const half = Math.tan(fovY / 2) * Math.min(1, aspect);
        return r / Math.max(1e-6, o.fill * half);
      },
      // a brightness scale for additive points: bodies per pixel area in
      // the framed disc against targetDensity (1 when sparse)
      brightness(viewPx = 1e6, n2 = n) {
        const discPx = Math.PI * Math.pow(o.fill * 0.5, 2) * viewPx;
        const dens = n2 / Math.max(1, discPx);
        return Math.min(1, o.targetDensity / Math.max(1e-6, dens));
      },
    };
  }

  return { update, measure, follow, goal, reset() { st = null; }, options: o };
}

export { robustCenter, percentileRadius, spring };
