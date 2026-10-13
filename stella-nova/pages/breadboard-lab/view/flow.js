// ============================================================================
//  BREADBOARD LAB  ·  view/flow.js — current flow dots along wires
// ----------------------------------------------------------------------------
//  Optional animation (CONTRACT 1.2): dots move along each wire and probe
//  lead in the conventional direction, at a speed set by the current. All
//  dots of the bench are ONE THREE.Points object, so the cost is one draw
//  call. Each frame the CPU writes the dot positions from the arc length of
//  each path.
//
//  Speed is logarithmic in |I|: 1 µA crawls, 1 A runs. Below 1 µA a path
//  shows no dots. Frame.wires gives + for current from end a to end b.
//
//  GREP MAP
//    speedFor ........... |I| → mm/s (pure, tested)
//    dotsOnPath ......... dot positions at a phase along a polyline (pure)
//    createFlow ......... the Points object, setPaths, setCurrents, update
// ============================================================================
import { dataTexture } from './fallback.js';

export const I_MIN = 1e-6;
export const SPACING = 5;          // mm between dots
const MAX_DOTS = 6000;

export function speedFor(amps) {
  const a = Math.abs(amps);
  if (!(a >= I_MIN)) return 0;
  const s = 6 + 9 * Math.log10(a / I_MIN);       // 1 µA → 6, 1 mA → 33, 1 A → 60 mm/s
  return Math.sign(amps) * Math.min(70, s);
}

// Cumulative lengths of a polyline.
export function measure(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  return cum;
}

// Positions at s = phase, phase + spacing, … along the path (phase mod
// spacing). out receives x, y, z triples from index k. Returns the new k.
export function dotsOnPath(pts, cum, phase, spacing, out, k, max) {
  const L = cum[cum.length - 1];
  if (!(L > 0)) return k;
  let s = ((phase % spacing) + spacing) % spacing;
  let seg = 1;
  while (s < L && k < max) {
    while (seg < cum.length - 1 && cum[seg] < s) seg++;
    const s0 = cum[seg - 1], s1 = cum[seg];
    const u = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    const a = pts[seg - 1], b = pts[seg];
    out[k * 3] = a[0] + (b[0] - a[0]) * u;
    out[k * 3 + 1] = a[1] + (b[1] - a[1]) * u + 0.15;
    out[k * 3 + 2] = a[2] + (b[2] - a[2]) * u;
    k++;
    s += spacing;
  }
  return k;
}

export function createFlow(THREE, parent) {
  const pos = new Float32Array(MAX_DOTS * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const tex = dataTexture(THREE, 32, (u, v) => { const r = Math.hypot(u - 0.5, v - 0.5) * 2; const a = Math.max(0, Math.min(1, (1 - r) * 3)); return [255, 255, 255, Math.round(255 * a)]; });
  const mat = new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: true, color: 0x4fc3e8, map: tex, transparent: true, depthWrite: false, alphaTest: 0.05 });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  points.visible = false;
  points.name = 'flow';
  parent.add(points);

  const paths = new Map();          // id → { pts, cum, phase, amps }
  let on = false;

  return {
    object: points,
    get on() { return on; },
    setOn(v) { on = !!v; points.visible = on; },
    // list: [{ id, pts }]. Phases of known ids carry over.
    setPaths(list) {
      const next = new Map();
      for (const { id, pts } of list) {
        const old = paths.get(id);
        next.set(id, { pts, cum: measure(pts), phase: old ? old.phase : 0, amps: old ? old.amps : 0 });
      }
      paths.clear();
      for (const [k, v] of next) paths.set(k, v);
    },
    setCurrents(ids, amps) {
      for (const p of paths.values()) p.amps = 0;
      if (!ids || !amps) return;
      for (let i = 0; i < ids.length; i++) { const p = paths.get(ids[i]); if (p) p.amps = amps[i]; }
    },
    setCurrent(id, a) { const p = paths.get(id); if (p) p.amps = a; },
    // Returns true when dots moved (the scene must render).
    update(dt) {
      if (!on) return false;
      let k = 0;
      for (const p of paths.values()) {
        const v = speedFor(p.amps);
        if (!v) continue;
        p.phase += v * dt;
        k = dotsOnPath(p.pts, p.cum, p.phase, SPACING, pos, k, MAX_DOTS);
      }
      geo.setDrawRange(0, k);
      geo.attributes.position.needsUpdate = true;
      return k > 0;
    },
    count() { return geo.drawRange.count; },
    dispose() { geo.dispose(); mat.dispose(); tex.dispose(); parent.remove(points); },
  };
}
