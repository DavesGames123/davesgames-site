// ============================================================================
//  PROTEIN FOLDING  ·  render.js — the 3D chains (three r160)
// ----------------------------------------------------------------------------
//  ChainView draws one Go replica: a smooth tube through the C-alpha
//  atoms (Catmull-Rom, parallel-transport frames, rebuilt in place each
//  frame), a bead per residue, and thin lines for the native contacts that
//  are formed. The ghost is the same tube for the native structure, wide
//  and faint. LatticeView draws an HP chain: H and P beads, bonds, and the
//  H-H contacts as bright rods.
//
//  Colours are per residue and come from main.js (colour modes).
//
//  grep: class TubeGeo  class ChainView  class LatticeView  export const COL
// ============================================================================
import * as THREE from 'three';

export const COL = {
  helix: new THREE.Color('#e45f84'), strand: new THREE.Color('#e8b44a'), coil: new THREE.Color('#8f9bb3'),
  hyd: new THREE.Color('#e0902f'), pol: new THREE.Color('#3f8ee8'), mid: new THREE.Color('#8a8a8a'),
  off: new THREE.Color('#3b4258'), on: new THREE.Color('#ffd68c'),
  H: new THREE.Color('#e9a23b'), P: new THREE.Color('#aab9d8'),
  ghost: new THREE.Color('#9fc4ff'), contact: new THREE.Color('#ffd68c'),
};

// A tube with fixed topology whose vertices are rewritten from N points.
class TubeGeo {
  constructor(N, seg, radial, radius) {
    this.N = N; this.S = seg; this.R = radial; this.radius = radius;
    this.M = (N - 1) * seg + 1;
    const V = this.M * radial;
    this.g = new THREE.BufferGeometry();
    this.pos = new Float32Array(3 * V); this.nor = new Float32Array(3 * V); this.col = new Float32Array(3 * V);
    this.g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    this.g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let m = 0; m < this.M - 1; m++) for (let r = 0; r < radial; r++) {
      const a = m * radial + r, b = m * radial + (r + 1) % radial, c = a + radial, d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
    this.g.setIndex(idx);
    this.c = new Float32Array(3 * this.M); this.t = new Float32Array(3 * this.M);
    this.g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  }
  // Catmull-Rom samples and tangents through x (flat xyz, N points).
  update(x) {
    const { N, S, R, M, c, t, pos, nor } = this;
    const P = (i, k) => x[3 * Math.max(0, Math.min(N - 1, i)) + k];
    let m = 0;
    for (let i = 0; i < N - 1; i++) {
      for (let s = 0; s < S; s++, m++) {
        const u = s / S, u2 = u * u, u3 = u2 * u;
        for (let k = 0; k < 3; k++) {
          const p0 = i === 0 ? 2 * P(0, k) - P(1, k) : P(i - 1, k), p1 = P(i, k), p2 = P(i + 1, k), p3 = i + 2 >= N ? 2 * P(N - 1, k) - P(N - 2, k) : P(i + 2, k);
          c[3 * m + k] = 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
          t[3 * m + k] = 0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * u2);
        }
      }
    }
    for (let k = 0; k < 3; k++) { c[3 * m + k] = x[3 * (N - 1) + k]; t[3 * m + k] = x[3 * (N - 1) + k] - x[3 * (N - 2) + k]; }
    // parallel transport of a normal along the samples
    let nx = 0, ny = 0, nz = 0;
    for (let j = 0; j < M; j++) {
      let tx = t[3 * j], ty = t[3 * j + 1], tz = t[3 * j + 2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      if (j === 0) {
        // any vector not parallel to t
        const ax = Math.abs(tx) < 0.9 ? 1 : 0, ay = ax ? 0 : 1;
        nx = ay * tz; ny = -ax * tz; nz = ax * ty - ay * tx;
      }
      const d = nx * tx + ny * ty + nz * tz; nx -= d * tx; ny -= d * ty; nz -= d * tz;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      for (let r = 0; r < R; r++) {
        const a = r / R * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const ox = ca * nx + sa * bx, oy = ca * ny + sa * by, oz = ca * nz + sa * bz;
        const v = 3 * (j * R + r);
        pos[v] = c[3 * j] + this.radius * ox; pos[v + 1] = c[3 * j + 1] + this.radius * oy; pos[v + 2] = c[3 * j + 2] + this.radius * oz;
        nor[v] = ox; nor[v + 1] = oy; nor[v + 2] = oz;
      }
    }
    this.g.attributes.position.needsUpdate = true; this.g.attributes.normal.needsUpdate = true;
  }
  // residue colours (flat rgb, N) to vertex colours; nearest residue
  colour(rgb) {
    const { S, R, M, col, N } = this;
    for (let j = 0; j < M; j++) {
      const i = Math.min(N - 1, Math.round(j / S));
      for (let r = 0; r < R; r++) { const v = 3 * (j * R + r); col[v] = rgb[3 * i]; col[v + 1] = rgb[3 * i + 1]; col[v + 2] = rgb[3 * i + 2]; }
    }
    this.g.attributes.color.needsUpdate = true;
  }
}

const SPHERE = new THREE.IcosahedronGeometry(1, 2);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false).translate(0, 0.5, 0).rotateX(Math.PI / 2);

export class ChainView {
  constructor(protein, nat, opt = {}) {
    const N = protein.seq.length;
    this.N = N;
    this.group = new THREE.Group();
    const seg = N > 100 ? 5 : N > 50 ? 6 : 8, radial = N > 100 ? 7 : 9;
    this.tube = new TubeGeo(N, seg, radial, N > 100 ? 0.95 : 1.05);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.08 });
    this.mesh = new THREE.Mesh(this.tube.g, this.mat);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.beads = new THREE.InstancedMesh(SPHERE, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.05 }), N);
    this.beads.frustumCulled = false;
    this.group.add(this.beads);
    this.beadR = N > 100 ? 0.0 : N > 60 ? 1.15 : 1.3;
    this.beads.visible = this.beadR > 0;
    // native contact lines, drawn when formed
    const nc = protein.con.length / 2;
    this.ci = new Int32Array(nc); this.cj = new Int32Array(nc);
    for (let c = 0; c < nc; c++) { this.ci[c] = protein.con[2 * c]; this.cj[c] = protein.con[2 * c + 1]; }
    this.lpos = new Float32Array(6 * Math.max(1, nc));
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.lpos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: COL.contact, transparent: true, opacity: 0.32, depthWrite: false }));
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
    // ghost: native trace
    this.ghostTube = new TubeGeo(N, seg, radial, 1.5);
    this.ghostTube.update(nat);
    const gc = new Float32Array(3 * N); for (let i = 0; i < N; i++) { gc[3 * i] = COL.ghost.r; gc[3 * i + 1] = COL.ghost.g; gc[3 * i + 2] = COL.ghost.b; }
    this.ghostTube.colour(gc);
    this.ghost = new THREE.Mesh(this.ghostTube.g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false }));
    this.ghost.frustumCulled = false; this.ghost.renderOrder = 2;
    this.group.add(this.ghost);
    this.m4 = new THREE.Matrix4(); this.c = new THREE.Color();
  }
  set(x, formed) {
    this.tube.update(x);
    const m = this.m4, r = this.beadR;
    if (r > 0) for (let i = 0; i < this.N; i++) { m.makeScale(r, r, r).setPosition(x[3 * i], x[3 * i + 1], x[3 * i + 2]); this.beads.setMatrixAt(i, m); }
    this.beads.instanceMatrix.needsUpdate = true;
    let n = 0;
    if (formed && this.lines.visible) {
      const L = this.lpos;
      for (let c = 0; c < this.ci.length; c++) {
        if (!formed[c]) continue;
        const a = 3 * this.ci[c], b = 3 * this.cj[c];
        L[6 * n] = x[a]; L[6 * n + 1] = x[a + 1]; L[6 * n + 2] = x[a + 2];
        L[6 * n + 3] = x[b]; L[6 * n + 4] = x[b + 1]; L[6 * n + 5] = x[b + 2]; n++;
      }
      this.lines.geometry.attributes.position.needsUpdate = true;
    }
    this.lines.geometry.setDrawRange(0, 2 * n);
  }
  colour(rgb) {
    this.tube.colour(rgb);
    for (let i = 0; i < this.N; i++) { this.c.setRGB(rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2]); this.beads.setColorAt(i, this.c); }
    this.beads.instanceColor.needsUpdate = true;
  }
  dispose() {
    this.tube.g.dispose(); this.ghostTube.g.dispose(); this.lines.geometry.dispose();
    this.mat.dispose(); this.beads.material.dispose(); this.beads.dispose(); this.lines.material.dispose(); this.ghost.material.dispose();
  }
}

// An HP chain on the lattice. Unit = 3.8 A, so the camera scale matches.
export const LAT = 3.8;
export class LatticeView {
  constructor(seq, opt = {}) {
    const N = seq.length; this.N = N; this.seq = seq;
    this.group = new THREE.Group();
    this.beads = new THREE.InstancedMesh(SPHERE, new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.05, transparent: !!opt.faint, opacity: opt.faint ? 0.55 : 1 }), N);
    this.bonds = new THREE.InstancedMesh(CYL, new THREE.MeshStandardMaterial({ color: '#69728c', roughness: 0.5, transparent: !!opt.faint, opacity: opt.faint ? 0.55 : 1 }), Math.max(1, N - 1));
    this.hh = new THREE.InstancedMesh(CYL, new THREE.MeshBasicMaterial({ color: COL.H, transparent: true, opacity: 0.55, depthWrite: false }), N * 3);
    for (const o of [this.beads, this.bonds, this.hh]) { o.frustumCulled = false; this.group.add(o); }
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) this.beads.setColorAt(i, c.copy(seq[i] === 'H' ? COL.H : COL.P));
    this.beads.instanceColor.needsUpdate = true;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.z = new THREE.Vector3(0, 0, 1);
  }
  set(pos, off = 0) {
    const N = this.N, m = this.m;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < N; i++) { cx += pos[off + 3 * i]; cy += pos[off + 3 * i + 1]; cz += pos[off + 3 * i + 2]; }
    cx /= N; cy /= N; cz /= N;
    const P = (i, k) => (pos[off + 3 * i + k] - [cx, cy, cz][k]) * LAT;
    const site = new Map();
    for (let i = 0; i < N; i++) {
      const s = this.seq[i] === 'H' ? 1.25 : 1.0;
      m.makeScale(s, s, s).setPosition(P(i, 0), P(i, 1), P(i, 2)); this.beads.setMatrixAt(i, m);
      site.set(`${pos[off + 3 * i]},${pos[off + 3 * i + 1]},${pos[off + 3 * i + 2]}`, i);
    }
    const rod = (inst, k, i, j, r) => {
      const a = new THREE.Vector3(P(i, 0), P(i, 1), P(i, 2)), b = new THREE.Vector3(P(j, 0), P(j, 1), P(j, 2));
      this.v.subVectors(b, a); const len = this.v.length();
      this.q.setFromUnitVectors(this.z, this.v.normalize());
      m.compose(a, this.q, new THREE.Vector3(r, r, len)); inst.setMatrixAt(k, m);
    };
    for (let i = 0; i < N - 1; i++) rod(this.bonds, i, i, i + 1, 0.42);
    let n = 0;
    for (let i = 0; i < N; i++) {
      if (this.seq[i] !== 'H') continue;
      const x = pos[off + 3 * i], y = pos[off + 3 * i + 1], z = pos[off + 3 * i + 2];
      for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        const j = site.get(`${x + dx},${y + dy},${z + dz}`);
        if (j !== undefined && Math.abs(j - i) > 1 && this.seq[j] === 'H') rod(this.hh, n++, i, j, 0.22);
      }
    }
    this.hh.count = n; this.contacts = n;
    for (const o of [this.beads, this.bonds, this.hh]) o.instanceMatrix.needsUpdate = true;
  }
  dispose() { for (const o of [this.beads, this.bonds, this.hh]) { o.material.dispose(); o.dispose(); } }
}
