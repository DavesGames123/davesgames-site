// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · view3d/strings3d.js — live string tubes and field colours
// ────────────────────────────────────────────────────────────────────────────
//  LiveStrings puts one tube mesh on each string of a model (models.js).
//  The tube runs from the bridge to the stop point (the fret or the nut).
//  Each frame, update() reads the attached StringSim, moves the tube by the
//  displacement u times the display exaggeration, and colours each ring of
//  vertices by one field through a colour map LUT.
//
//  The parts of a string that do not vibrate (bridge to pin or tailpiece,
//  fret to nut, nut to tuner) are static tubes in the natural string colour.
//  A coloured dot marks the finger on each stopped string. A cross marks a
//  muted string and a ring marks an open string.
//
//  Fields: see FIELDS. fieldOnGrid() gives the value at each sim grid point.
//
//  SECTION MAP   (grep -n "<anchor>" strings3d.js)
//    field list ........... "export const FIELDS"
//    field values ......... "export function fieldOnGrid"
//    colour helpers ....... "export function srgbToLinear", "export function linearLut"
//    string materials ..... "function naturalMaterial"
//    class ................ "export class LiveStrings"
//    tube update .......... "_updateTube("
//    fretting ............. "setFret("
// ════════════════════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { smoothField } from '../engine/strings.js';

export const FIELDS = [
  { id: 'accel', label: 'Acceleration (net force per unit mass)', short: 'Acceleration', unit: 'm/s²', signed: true },
  { id: 'velocity', label: 'Velocity', short: 'Velocity', unit: 'm/s', signed: true },
  { id: 'displacement', label: 'Displacement', short: 'Displacement', unit: 'm', signed: true },
  { id: 'energy', label: 'Energy density', short: 'Energy', unit: 'J/m', signed: false },
  { id: 'tension', label: 'Tension force per unit mass (c² u_xx)', short: 'Tension force', unit: 'm/s²', signed: true },
  { id: 'none', label: 'String material', short: 'Material', unit: '', signed: false },
];
export const FINGER_COLORS = [0xf5f5f5, 0x4fc3f7, 0x9ccc65, 0xffb74d, 0xf06292];

/**
 * Field value at each grid point of a sim (length N + 1).
 * accel and tension are smoothed (3 and 2 passes of 1-2-1) because a sharp
 * pluck corner leaves a grid-scale ripple (CONTRACT.md, smoothField).
 */
export function fieldOnGrid(sim, id, out, tmp) {
  const n = sim.N + 1;
  if (!out || out.length !== n) out = new Float64Array(n);
  if (id === 'accel') return smoothField(sim.a, 3, out);
  if (id === 'tension') return smoothField(sim.aTension, 2, out);
  if (id === 'velocity') { out.set(sim.v); return out; }
  if (id === 'displacement') { out.set(sim.u); return out; }
  if (id === 'energy') {
    const { u, v, mu, T, h } = sim;
    for (let j = 0; j < n; j++) {
      const a = j > 0 ? u[j - 1] : -u[1]; // odd mirror at the ends (u = 0 there)
      const b = j < n - 1 ? u[j + 1] : -u[n - 2];
      const ux = (b - a) / (2 * h);
      out[j] = 0.5 * mu * v[j] * v[j] + 0.5 * T * ux * ux;
    }
    return out;
  }
  out.fill(0);
  return out;
}

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
/** 768-byte sRGB LUT -> Float32Array(768) of linear values for vertex colours. */
export function linearLut(lut) {
  const out = new Float32Array(768);
  for (let i = 0; i < 768; i++) out[i] = srgbToLinear(lut[i] / 255);
  return out;
}

function naturalMaterial(kind) {
  const o = {
    bronze: { color: 0xd29d62, metalness: 1, roughness: 0.3 },
    steel: { color: 0xe6e8eb, metalness: 1, roughness: 0.16 },
    silver: { color: 0xd3d6db, metalness: 1, roughness: 0.26 },
    nylon: { color: 0xf3eee2, metalness: 0, roughness: 0.22 },
  }[kind] || { color: 0xdddddd, metalness: 1, roughness: 0.3 };
  return new THREE.MeshStandardMaterial(o);
}

function fieldMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.05 });
  m.userData.glow = { value: 0.55 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = m.userData.glow;
    sh.fragmentShader = 'uniform float uGlow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance += vColor.rgb * uGlow;\n#endif');
  };
  return m;
}

function tubeBetween(points, r, mat, seg = 8) {
  const curve = points.length === 2 ? new THREE.LineCurve3(points[0], points[1]) : new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, Math.max(1, points.length * 4), r, seg, false);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

export class LiveStrings {
  /**
   * @param model   from buildModel()
   * @param opts    { segments, radial, thick }
   */
  constructor(model, { segments = 160, radial = 10, thick = 1.8 } = {}) {
    this.model = model;
    this.group = new THREE.Group();
    this.group.name = 'strings';
    model.root.add(this.group);
    this.M = segments;
    this.R = radial;
    this.thick = thick;
    this.items = model.strings.map((s, i) => this._makeString(s, i));
    this.highlighted = null;
  }

  _makeString(s, i) {
    const M = this.M, R = this.R;
    const nv = (M + 1) * R;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    const idx = [];
    for (let k = 0; k < M; k++) {
      for (let c = 0; c < R; c++) {
        const a = k * R + c, b = k * R + ((c + 1) % R), d = a + R, e = b + R;
        idx.push(a, b, d, b, e, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    const natural = naturalMaterial(s.kind);
    const field = fieldMaterial();
    const tube = new THREE.Mesh(geo, field);
    tube.castShadow = true;
    tube.frustumCulled = false;
    tube.name = 'string-' + i;
    this.group.add(tube);
    const rDraw = Math.max(s.radius, 0.00025) * this.thick;
    const fixed = new THREE.Group();
    this.group.add(fixed);
    const it = { s, i, tube, geo, natural, field, rDraw, fixed, sim: null, fret: 0, finger: 0, stop: s.nut.clone(), grid: null, tmp: null, marker: null };
    // bridge side and head side never change
    if (s.after) fixed.add(tubeBetween(s.after, rDraw, natural, 8));
    if (s.head) fixed.add(tubeBetween(s.head, rDraw, natural, 8));
    if (s.coil) fixed.add(tubeBetween(s.coil, rDraw * 1.1, natural, 6));
    it.pressed = new THREE.Group();
    this.group.add(it.pressed);
    this._updateTube(it, null, 0, 0, null, 0, false);
    this._marker(it);
    return it;
  }

  /** Attach a StringSim (or null) to string i. */
  attach(i, sim) {
    if (this.items[i]) this.items[i].sim = sim || null;
  }

  /** fret: -1 muted, 0 open, n stopped at fret n. finger: 0..4 (colour). */
  setFret(i, fret, finger = 0) {
    const it = this.items[i];
    if (!it) return;
    it.fret = fret;
    it.finger = finger;
    it.stop = this.model.stopPoint(i, Math.max(0, fret));
    for (const c of [...it.pressed.children]) { c.geometry.dispose(); it.pressed.remove(c); }
    if (fret > 0) it.pressed.add(tubeBetween([it.stop, it.s.nut], it.rDraw, it.natural, 8));
    this._marker(it);
  }

  _marker(it) {
    if (it.marker) {
      it.marker.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      this.group.remove(it.marker);
    }
    const g = new THREE.Group();
    const { s, fret, finger } = it;
    if (fret > 0) {
      const color = FINGER_COLORS[finger] ?? FINGER_COLORS[1];
      const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.35, transparent: true, opacity: 0.92 });
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0052, 24, 16), m);
      dot.scale.set(1.25, 1, 0.75);
      dot.position.copy(it.stop).add(new THREE.Vector3(0.002, 0, 0.0035));
      dot.name = 'finger';
      g.add(dot);
    } else {
      const x = s.nut.x - 0.0075;
      const p = new THREE.Vector3(x, s.nut.y + (s.bridge.y - s.nut.y) * (0.0075 / s.nut.x), s.nut.z + 0.004);
      if (fret < 0) {
        const m = new THREE.MeshStandardMaterial({ color: 0xff5252, emissive: 0xff5252, emissiveIntensity: 0.6 });
        for (const a of [Math.PI / 4, -Math.PI / 4]) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.0062, 0.0011, 0.0011), m);
          b.position.copy(p);
          b.rotation.z = a;
          g.add(b);
        }
        g.name = 'muted';
      } else {
        const m = new THREE.MeshStandardMaterial({ color: 0x80deea, emissive: 0x80deea, emissiveIntensity: 0.5 });
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.0022, 0.00055, 8, 24), m);
        t.position.copy(p);
        g.add(t);
        g.name = 'open';
      }
    }
    it.marker = g;
    this.group.add(g);
  }

  setThick(k) {
    this.thick = k;
    for (const it of this.items) it.rDraw = Math.max(it.s.radius, 0.00025) * k;
  }

  /**
   * Move and colour all tubes.
   * o = { field, exaggeration, polarization, lut (linear Float32Array 768),
   *       signed, range (number, or function(peak) -> number), natural }
   * Returns the peak |field| over all strings this frame.
   */
  update(o) {
    let peak = 0;
    const fieldId = o.natural || o.field === 'none' ? 'displacement' : o.field;
    for (const it of this.items) {
      if (!it.sim) continue;
      it.grid = fieldOnGrid(it.sim, fieldId, it.grid);
      for (let j = 0; j < it.grid.length; j++) { const a = Math.abs(it.grid[j]); if (a > peak) peak = a; }
    }
    // the range can depend on this frame's peak (auto range)
    const range = typeof o.range === 'function' ? o.range(peak) : o.range;
    for (const it of this.items) {
      this._updateTube(it, it.sim, o.exaggeration, o.polarization, it.sim ? it.grid : null, range, o.signed, o.lut, o.natural);
    }
    return peak;
  }

  _updateTube(it, sim, exag, pol, vals, range, signed, lut, natural) {
    const M = this.M, R = this.R;
    const S = it.s.bridge, F = it.stop;
    const ax = new THREE.Vector3().subVectors(F, S);
    const Lv = ax.length();
    ax.divideScalar(Lv);
    const ey = new THREE.Vector3(0, 1, 0).addScaledVector(ax, -ax.y).normalize();
    const ez = new THREE.Vector3().crossVectors(ax, ey).normalize();
    const d = ey.clone().multiplyScalar(Math.cos(pol || 0)).addScaledVector(ez, Math.sin(pol || 0));
    const n2 = new THREE.Vector3().crossVectors(ax, d).normalize();
    const pos = it.geo.attributes.position.array, nor = it.geo.attributes.normal.array, col = it.geo.attributes.color.array;
    const r = it.rDraw * (this.highlighted === it.i ? 1.45 : 1);
    const u = sim ? sim.u : null;
    const N = sim ? sim.N : 1;
    const w = new Float64Array(M + 1), f = new Float64Array(M + 1);
    for (let k = 0; k <= M; k++) {
      const s = k / M;
      if (u) {
        const x = s * N, j = Math.min(N - 1, Math.floor(x)), t = x - j;
        w[k] = (u[j] * (1 - t) + u[j + 1] * t) * exag;
        if (vals) f[k] = vals[j] * (1 - t) + vals[j + 1] * t;
      }
    }
    const inv = range > 0 ? 1 / range : 0;
    let p = 0;
    for (let k = 0; k <= M; k++) {
      const s = k / M;
      const dw = (w[Math.min(M, k + 1)] - w[Math.max(0, k - 1)]) / ((Math.min(M, k + 1) - Math.max(0, k - 1)) / M);
      // in-plane normal: perpendicular to the tangent (Lv ax + dw d)
      const n1x = d.x * Lv - ax.x * dw, n1y = d.y * Lv - ax.y * dw, n1z = d.z * Lv - ax.z * dw;
      const nl = Math.hypot(n1x, n1y, n1z) || 1;
      const cx = S.x + ax.x * s * Lv + d.x * w[k], cy = S.y + ax.y * s * Lv + d.y * w[k], cz = S.z + ax.z * s * Lv + d.z * w[k];
      let cr = 0, cg = 0, cb = 0;
      if (lut && !natural) {
        let t = signed ? 0.5 + 0.5 * f[k] * inv : Math.abs(f[k]) * inv;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const li = Math.round(t * 255) * 3;
        cr = lut[li]; cg = lut[li + 1]; cb = lut[li + 2];
      }
      for (let c = 0; c < R; c++) {
        const ph = (c / R) * Math.PI * 2;
        const co = Math.cos(ph), si = Math.sin(ph);
        const nx = (co * n1x) / nl + si * n2.x, ny = (co * n1y) / nl + si * n2.y, nz = (co * n1z) / nl + si * n2.z;
        pos[p] = cx + r * nx; pos[p + 1] = cy + r * ny; pos[p + 2] = cz + r * nz;
        nor[p] = nx; nor[p + 1] = ny; nor[p + 2] = nz;
        col[p] = cr; col[p + 1] = cg; col[p + 2] = cb;
        p += 3;
      }
    }
    it.geo.attributes.position.needsUpdate = true;
    it.geo.attributes.normal.needsUpdate = true;
    it.geo.attributes.color.needsUpdate = true;
    const want = natural ? it.natural : it.field;
    if (it.tube.material !== want) it.tube.material = want;
    it.lastW = w;
  }

  /** Rest line of string i in model coordinates: { S, F }. */
  line(i) {
    const it = this.items[i];
    return it ? { S: it.s.bridge, F: it.stop } : null;
  }

  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const it of this.items) { it.natural.dispose(); it.field.dispose(); }
    this.model.root.remove(this.group);
  }
}
