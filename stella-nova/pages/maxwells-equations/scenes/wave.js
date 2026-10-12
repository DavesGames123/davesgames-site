// ============================================================================
//  MAXWELL'S EQUATIONS  ·  scenes/wave.js — a plane wave of light
// ----------------------------------------------------------------------------
//  A plane wave runs along +x. E points along z, B along -y, so E x B
//  points along +x. Units c = 1: E and B have the same size and move at 1.
//  Two pictures, crossfaded by P.mix (0 arrows, 1 forms):
//    arrows  ribbons under the E and B curves, with arrows on them
//    forms   E as a 1-form: in each slice x, horizontal sheets (planes
//            z = const) whose count is |E|; the sheets end between slices,
//            and their ends line up with the tubes of B
//            B as a 2-form: tubes along y whose count in the slice is |B|
//  Orange is E, blue is B, as in the TeX.
//
//  GREP MAP: "function ribbons"  "function forms"  "readout()"
// ============================================================================
import { THREE, COL, lines, setLines, arrows, setArrow, glowMat, ease, clamp } from '../kit.js';
import * as G from '../geom.js';

const X0 = -4, X1 = 4, LAMBDA = 2.4, K = G.TAU / LAMBDA, AMP = 1.0;
const NCOL = 40, H = 1.15, NMAX = 7, DEPTH = 0.7;

export function build(ctx) {
  const root = new THREE.Group();
  const P = { mode: 'wave', mix: 0.0, auto: true };
  let clock = 0;
  const lab = (html, fn, cls) => ctx.label(html, cls, () => (root.visible ? fn() : null));

  // the axis of travel
  root.add(lines([[[X0 - 0.3, 0, 0], [X1 + 0.3, 0, 0]]], { color: '#8b9bb0', width: 1.2, opacity: 0.6 }));
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 20), glowMat('#c9d3e0', { emissive: 0.3 }));
  tip.rotation.z = -Math.PI / 2; tip.position.set(X1 + 0.35, 0, 0);
  root.add(tip);

  // ── arrows picture ──────────────────────────────────────────────────────
  const N = 160;
  const mkRibbon = (color) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 2 * 3), 3));
    const idx = [];
    for (let i = 0; i < N; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    return m;
  };
  const ribE = mkRibbon(COL.E), ribB = mkRibbon(COL.B);
  const crestE = lines([], { color: COL.E, width: 2.6 }), crestB = lines([], { color: COL.B, width: 2.6 });
  const arrE = arrows(64, { color: COL.E, emissive: 0.7 }), arrB = arrows(64, { color: COL.B, emissive: 0.7 });
  const pic1 = new THREE.Group();
  pic1.add(ribE, ribB, crestE, crestB, arrE, arrB);
  root.add(pic1);

  function ribbons(t, a) {
    const pe = ribE.geometry.attributes.position.array, pb = ribB.geometry.attributes.position.array;
    const ce = [], cb = [];
    for (let i = 0; i <= N; i++) {
      const x = X0 + (X1 - X0) * i / N, e = AMP * Math.cos(K * (x - t));
      pe.set([x, 0, 0, x, 0, e], i * 6);
      pb.set([x, 0, 0, x, -e, 0], i * 6);
      ce.push([x, 0, e]); cb.push([x, -e, 0]);
    }
    ribE.geometry.attributes.position.needsUpdate = true; ribB.geometry.attributes.position.needsUpdate = true;
    ribE.geometry.computeBoundingSphere(); ribB.geometry.computeBoundingSphere();
    setLines(crestE, [ce]); setLines(crestB, [cb]);
    let k = 0;
    for (let i = 0; i < 40; i++) {
      const x = X0 + (X1 - X0) * (i + 0.5) / 40, e = AMP * Math.cos(K * (x - t));
      setArrow(arrE, k, [x, 0, 0], [0, 0, Math.sign(e) || 1], Math.abs(e), 0.7);
      setArrow(arrB, k, [x, 0, 0], [0, -(Math.sign(e) || 1), 0], Math.abs(e), 0.7);
      k++;
    }
    arrE.count = arrB.count = k;
    arrE.instanceMatrix.needsUpdate = true; arrB.instanceMatrix.needsUpdate = true;
    for (const o of [ribE, ribB]) o.material.opacity = 0.16 * a;
    for (const o of [crestE, crestB]) o.material.opacity = a;
    for (const o of [arrE, arrB]) { o.material.opacity = a; o.material.transparent = a < 1; o.visible = a > 0.01; }
  }

  // ── forms picture ───────────────────────────────────────────────────────
  // E sheets: thin horizontal tiles, one column per slice; B tubes: rods along y.
  const tileGeo = new THREE.BoxGeometry((X1 - X0) / NCOL * 0.9, 2 * DEPTH, 0.012);
  const tilePos = new THREE.InstancedMesh(tileGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(COL.E), emissive: new THREE.Color(COL.E), emissiveIntensity: 0.6, roughness: 0.5, transparent: true, opacity: 0.8, depthWrite: false }), NCOL * NMAX);
  const tileNeg = new THREE.InstancedMesh(tileGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color('#a1573a'), emissive: new THREE.Color('#a1573a'), emissiveIntensity: 0.35, roughness: 0.5, transparent: true, opacity: 0.8, depthWrite: false }), NCOL * NMAX);
  const rodGeo = new THREE.CylinderGeometry(0.018, 0.018, 2 * DEPTH + 0.1, 10);
  const rodPos = new THREE.InstancedMesh(rodGeo, glowMat(COL.B, { emissive: 1.0 }), NCOL * NMAX);
  const rodNeg = new THREE.InstancedMesh(rodGeo, glowMat('#2f5f86', { emissive: 0.5 }), NCOL * NMAX);
  for (const m of [tilePos, tileNeg, rodPos, rodNeg]) { m.count = 0; m.frustumCulled = false; }
  const pic2 = new THREE.Group();
  pic2.add(tilePos, tileNeg, rodPos, rodNeg);
  root.add(pic2);
  const _m = new THREE.Matrix4();
  function forms(t, a) {
    pic2.visible = a > 0.01;
    if (!pic2.visible) return;
    let ip = 0, ineg = 0, rp = 0, rn = 0;
    const dx = (X1 - X0) / NCOL;
    for (let j = 0; j < NCOL; j++) {
      const x = X0 + (j + 0.5) * dx, e = AMP * Math.cos(K * (x - t));
      const n = Math.round(Math.abs(e) * NMAX);
      for (let k = 0; k < n; k++) {
        const z = -H + (k + 0.5) * 2 * H / n;
        _m.makeTranslation(x, 0, z);
        if (e > 0) tilePos.setMatrixAt(ip++, _m); else tileNeg.setMatrixAt(ineg++, _m);
        // B tubes run along y, half a spacing above each sheet of the slice
        if (k === n - 1) continue;
        _m.makeTranslation(x, 0, z + H / n);
        if (e > 0) rodPos.setMatrixAt(rp++, _m); else rodNeg.setMatrixAt(rn++, _m);
      }
    }
    tilePos.count = ip; tileNeg.count = ineg; rodPos.count = rp; rodNeg.count = rn;
    for (const m of [tilePos, tileNeg, rodPos, rodNeg]) { m.instanceMatrix.needsUpdate = true; m.material.opacity = 0.85 * a; m.material.transparent = true; }
  }

  lab('<b>E</b>', () => (P.mix < 0.5 ? [X0 + 0.4, 0, 1.25] : null), 'e');
  lab('<b>B</b>', () => (P.mix < 0.5 ? [X0 + 0.4, -1.25, 0.05] : null), 'b');
  lab('<i>c</i>', () => [X1 + 0.6, 0, 0.18], 'side');

  const api = {
    group: root, P,
    enter(mode, params = {}) { Object.assign(P, params, { mode }); clock = 0; },
    set(key, v) { P[key] = v; },
    update(dt) {
      clock += dt;
      const t = clock * 0.55;   // the wave moves 0.55 units per second at c = 1
      if (P.auto) P.mix = ease(clamp(0.5 - 0.5 * Math.cos(clock * 0.28), 0, 1) * 1.25 - 0.12);
      const m = clamp(P.mix, 0, 1);
      ribbons(t, 1 - m);
      forms(t, m);
      api.t = t;
    },
    readout() {
      const t = api.t || 0, e = Math.cos(K * (0 - t)), b = e;
      return [['wavelength λ', LAMBDA.toFixed(2), 'm2'], ['E at x = 0', e.toFixed(3), 'm2'], ['B at x = 0', b.toFixed(3), 'm1'], ['|E| / |B|', '1.000 = c', 'm3'], ['E · B', '0', 'm3']];
    },
    anchor() { return { c: [0, 0, 0], r: 3.6 }; },
  };
  return api;
}
