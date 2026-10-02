// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  cases/straps.js — leather, bracelet and mesh
// ────────────────────────────────────────────────────────────────────────────
//  addStraps(B, part, o) builds the two halves of a wrist strap on curves
//  that leave the lugs and wrap round the wrist (+z, behind the case).
//  o: { kind: 'leather' | 'bracelet' | 'mesh', W (lug width), yTop, zc }
//    leather   a padded band that tapers from the lugs; edge stitching;
//              holes in the tail; two keepers and a tang buckle
//    bracelet  three rows of rounded links (polished centre, brushed
//              outer) and a folding clasp
//    mesh      a woven Milanese band (the kit's weave finish) and a
//              sliding clasp
//  The band surface is generated here (padded cross-section along the
//  curve, smooth normals); stitches and links are instanced meshes.
//
//  GREP MAP
//    function curveFor ........ the wrist curve of one half
//    function bandGeometry .... the padded, tapered band
//    function addStraps ....... the three kinds
// ============================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const X = new THREE.Vector3(1, 0, 0);

// one half of the strap: from the lug bar, up, and round the wrist
export function curveFor(sy, yTop, zc, Rw = 25, sweep = 1.75) {
  const pts = [new THREE.Vector3(0, sy * (yTop + 1.2), zc), new THREE.Vector3(0, sy * (yTop + 3.0), zc + 0.1)];
  for (let i = 1; i <= 18; i++) { const ph = i / 18 * sweep; pts.push(new THREE.Vector3(0, sy * (yTop + 4.0 + Rw * Math.sin(ph)), zc + Rw - Rw * Math.cos(ph))); }
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}
// the frame at t: tangent T, width axis A, and the face normal N. N points
// to the same side of the band on both halves. (A, T, N) is right-handed on
// both halves: A = sy X, so A x T = N. The lower half runs down (T to -y),
// so its width axis is -x. A frame built on +x for both halves is a mirror
// on the lower half and turns its band inside out.
function frame(curve, t, sy) {
  const T = curve.getTangentAt(t).normalize();
  const A = X.clone().multiplyScalar(sy);
  const N = new THREE.Vector3().crossVectors(A, T).normalize();
  return { P: curve.getPointAt(t), T, N, A };
}
// A padded band: a rounded cross-section, domed on the outer face, whose
// width w(t) and thickness th(t) taper along the curve.
export function bandGeometry(curve, sy, w, th, n = 120, m = 28, pad = 0.35) {
  const pos = [], nrm = [], uv = [], idx = [];
  const L = curve.getLength();
  for (let i = 0; i <= n; i++) {
    const t = i / n, { P, N, A } = frame(curve, t, sy), W = w(t), H = th(t);
    for (let j = 0; j <= m; j++) {
      const a = j / m * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const x = W / 2 * Math.sign(c) * Math.pow(Math.abs(c), 0.32);
      let y = H / 2 * Math.sign(s) * Math.pow(Math.abs(s), 0.32);
      if (y > 0) y *= 1 + pad * (1 - Math.pow(2 * x / W, 2));
      pos.push(P.x + A.x * x, P.y + N.y * y, P.z + N.z * y);
      uv.push(t * L, A.x * x);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const a = i * (m + 1) + j, b = a + m + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// place copies of one geometry along a curve
function instances(B, geo, mat, count, place) {
  const im = new THREE.InstancedMesh(geo, null, count);
  im.userData.matName = mat;
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < count; i++) { const { p, rot } = place(i); q.setFromRotationMatrix(rot); M.compose(p, q, s); im.setMatrixAt(i, M); }
  im.instanceMatrix.needsUpdate = true;
  B.mesh(geo, mat);              // the builder owns (and disposes) the geometry
  return im;
}
// the rotation of a frame: local x to A, y to T, z to N (always proper)
const basis = f => new THREE.Matrix4().makeBasis(f.A, f.T, f.N);

export function addStraps(B, part, o) {
  const { kind, W, yTop, zc } = o;
  for (const sy of [1, -1]) {
    const curve = curveFor(sy, yTop, zc, 25, sy === 1 ? 1.62 : 1.9), L = curve.getLength();
    if (kind === 'leather') {
      const w = t => W * (1 - 0.18 * t), th = t => 3.1 - 0.7 * t;
      B.add(part, B.mesh(bandGeometry(curve, sy, w, th), 'leather'));
      // edge stitching on the outer face, both sides, every 1.3 mm
      const stitch = new THREE.CapsuleGeometry(0.16, 0.65, 3, 6);   // its axis is local y, along T
      const n = Math.floor(L / 1.3);
      const im = instances(B, stitch, 'thread', n * 2, i => {
        const k = Math.floor(i / 2), side = i % 2 ? 1 : -1, t = (k + 0.5) / n, f = frame(curve, t, sy);
        const x = side * (w(t) / 2 - 1.1), y = th(t) / 2 * (1 + 0.35 * (1 - Math.pow(2 * x / w(t), 2))) + 0.02;
        return { p: f.P.clone().addScaledVector(f.A, x).addScaledVector(f.N, y), rot: basis(f) };
      });
      B.add(part, im);
      if (sy === -1) {                               // holes in the tail
        const hole = new THREE.CylinderGeometry(0.85, 0.85, 0.08, 20);
        B.add(part, instances(B, hole, 'slot', 6, i => {
          const t = 0.55 + i * 0.075, f = frame(curve, t, sy);
          return { p: f.P.clone().addScaledVector(f.N, th(t) / 2 * 1.35 + 0.01), rot: new THREE.Matrix4().makeBasis(f.A, f.N, f.T.clone().negate()) };
        }));
      } else {                                       // two keepers and the buckle
        for (const t of [0.72, 0.84]) {
          const f = frame(curve, t, sy), ring = new THREE.TorusGeometry(1, 0.32, 8, 32); ring.scale(w(t) / 2 + 0.35, 0.1, th(t) / 2 + 0.55);
          const k = B.mesh(ring, 'leather'); k.position.copy(f.P); k.quaternion.setFromRotationMatrix(basis(f));
          B.add(part, k);
        }
        const f = frame(curve, 1, sy), bw = w(1) + 2.4, bd = 9;
        const path = new THREE.CatmullRomCurve3([[-bw / 2, 0], [bw / 2, 0], [bw / 2 + 0.6, bd * 0.6], [bw / 2 - 0.4, bd], [-bw / 2 + 0.4, bd], [-bw / 2 - 0.6, bd * 0.6]].map(([x, y]) => new THREE.Vector3(x, y, 0)), true, 'centripetal');
        const frameG = new THREE.TubeGeometry(path, 80, 0.75, 12, true);
        const buckle = new THREE.Group(); buckle.position.copy(f.P); buckle.quaternion.setFromRotationMatrix(basis(f));
        const fm = B.mesh(frameG, 'polished'), tongue = B.mesh(new RoundedBoxGeometry(1.0, bd + 0.6, 0.7, 2, 0.3), 'polished');
        tongue.position.set(0, bd / 2 - 0.2, 0.8); tongue.rotation.x = -0.12;
        B.add(part, fm, tongue); buckle.add(fm, tongue); part.root.add(buckle);
      }
    } else if (kind === 'bracelet') {
      // three rows of links, 5.2 mm long, rounded; a folding clasp
      const len = 5.2, n = Math.floor(L / len), outW = W * 0.3, midW = W * 0.36, gap = 0.25;
      const outer = new RoundedBoxGeometry(outW, len - 0.3, 2.4, 3, 0.55), centre = new RoundedBoxGeometry(midW, len - 0.3, 2.7, 3, 0.7);
      const at = (i, x) => { const t = (i + 0.5) / n, f = frame(curve, t, sy); return { p: f.P.clone().addScaledVector(f.A, x), rot: basis(f) }; };
      B.add(part, instances(B, outer, 'satin', n * 2, i => at(i >> 1, (i & 1 ? 1 : -1) * (midW / 2 + gap + outW / 2))));
      B.add(part, instances(B, centre, 'polished', n, i => at(i, 0)));
      if (sy === -1) {
        const f = frame(curve, 1, sy), clasp = B.mesh(new RoundedBoxGeometry(W * 1.02, 14, 2.8, 3, 0.8), 'polished');
        clasp.position.copy(f.P).addScaledVector(f.T, 6); clasp.quaternion.setFromRotationMatrix(basis(f));
        B.add(part, clasp);
      }
    } else {
      B.add(part, B.mesh(bandGeometry(curve, sy, () => W - 0.4, () => 1.7, 120, 20, 0.05), 'mesh'));
      if (sy === 1) {
        const f = frame(curve, 1, sy), clasp = B.mesh(new RoundedBoxGeometry(W + 0.6, 10, 2.6, 3, 0.7), 'polished');
        clasp.position.copy(f.P).addScaledVector(f.T, -4); clasp.quaternion.setFromRotationMatrix(basis(f));
        B.add(part, clasp);
      }
    }
  }
}
