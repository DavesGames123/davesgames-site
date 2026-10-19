// ============================================================================
//  CORAL REEF  ·  fauna/gen/sessile.js  ·  tube worms, mussels, a whale fall
// ----------------------------------------------------------------------------
//  DOM-free, our own generator. The landmarks of the deep regions: the
//  user asked for "tube-worm and mussel beds at seeps or vents" and "a whale
//  fall is a good landmark" (the coordinator's scope note, 2026-10-18).
//
//    tubeWormMesh(p)  a clump of white tubes with red plumes (Riftia,
//                     Lamellibrachia); p = { tubes, h, plume, seed, col }
//    musselMesh(p)    a bed of mussels (Bathymodiolus); p = { n, seed, col }
//    whaleFallMesh(p) the bones of a whale: skull, a curved spine of
//                     vertebrae and ribs, with the red plumes of Osedax;
//                     p = { length (in the unit box: 1), seed }
//    seaPenMesh(p)    a sea pen (Pennatula): a stalk in the sand, a rachis
//                     with leaves, polyps on the leaf edges that glow when
//                     touched (a wave up the colony: wave = height);
//                     p = { leaves, col, glow: { colour, k } }
//  The size is 1 (the widest span), y = 0 on the ground. The plumes have
//  w = 1 (the sway); the tubes and bones w = 0.
//
//  grep -n targets: "export function tubeWormMesh", "export function musselMesh",
//  "export function whaleFallMesh", "export function seaPenMesh"
// ============================================================================
import { builder, tube, blob, fin, hex, mix3, lerp, organ } from './mesh.js';

const TAU = Math.PI * 2;
function rng(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function tubeWormMesh(params = {}) {
  const p = Object.assign({ tubes: 24, h: 1, plume: 0.12, seed: 1, col: { tube: 0xe8e4d8, plume: 0xc01818 } }, params);
  const R = rng(p.seed), tc = hex(p.col.tube), pc = hex(p.col.plume), B = builder();
  for (let i = 0; i < p.tubes; i++) {
    const a = R() * TAU, r = Math.sqrt(R()) * 0.32, H = p.h * (0.45 + 0.55 * R());
    const lean = [Math.cos(a) * 0.15 * R(), Math.sin(a) * 0.15 * R()];
    const pts = []; for (let j = 0; j <= 6; j++) { const t = j / 6; pts.push([Math.cos(a) * r + lean[0] * t * t, H * t, Math.sin(a) * r + lean[1] * t * t]); }
    tube(B, pts, t => 0.018 + 0.006 * Math.sin(t * 30), { nu: 6, col: t => mix3(tc, [0.55, 0.5, 0.4], (1 - t) * 0.5), anim: t => [t, 0, 0, 0] });
    const tip = pts[pts.length - 1], pl = p.plume * (0.7 + 0.6 * R());
    blob(B, [tip[0], tip[1] + pl * 0.6, tip[2]], [pl * 0.32, pl, pl * 0.32], { nu: 8, nv: 5, col: () => pc, anim: () => [1, 1, i / p.tubes, 1] });
  }
  return B.mesh();
}

export function musselMesh(params = {}) {
  const p = Object.assign({ n: 40, seed: 2, col: { shell: 0x3a3226, inner: 0x7a6a50, lip: 0xb0a080 } }, params);
  const R = rng(p.seed), sc = hex(p.col.shell), lip = hex(p.col.lip), B = builder();
  for (let i = 0; i < p.n; i++) {
    const a = R() * TAU, r = Math.sqrt(R()) * 0.42, L = 0.09 + 0.05 * R(), long = R() > 0.5;
    const c = [Math.cos(a) * r, L * 0.22 + R() * 0.04, Math.sin(a) * r];
    // one closed shell: an ellipsoid with a pale lip line, long axis on x or z
    blob(B, c, long ? [L * 0.5, L * 0.22, L * 0.25] : [L * 0.25, L * 0.22, L * 0.5], { nu: 8, nv: 5, col: (q, n) => (Math.abs(n[1]) < 0.12 ? lip : sc), anim: () => [0, 0, 0, 0] });
  }
  return B.mesh();
}

export function whaleFallMesh(params = {}) {
  const p = Object.assign({ seed: 3, col: { bone: 0xd8cfb8, mat: 0xe8e8d0, osedax: 0xd02020 } }, params);
  const R = rng(p.seed), bone = hex(p.col.bone), mat = hex(p.col.mat), os = hex(p.col.osedax), B = builder();
  // the skull at +z
  blob(B, [0, 0.05, 0.38], [0.09, 0.05, 0.12], { nu: 12, nv: 6, col: () => bone, anim: () => [0, 0, 0, 0] });
  tube(B, [[0.06, 0.03, 0.32], [0.1, 0.02, 0.45], [0.08, 0.02, 0.52]], () => 0.012, { nu: 5, col: () => bone, anim: () => [0, 0, 0, 0] });
  tube(B, [[-0.06, 0.03, 0.32], [-0.1, 0.02, 0.45], [-0.08, 0.02, 0.52]], () => 0.012, { nu: 5, col: () => bone, anim: () => [0, 0, 0, 0] });
  // the spine: a slightly curved row of vertebrae; ribs on the front half
  const N = 26;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1), z = 0.26 - t * 0.74, x = Math.sin(t * 2.2) * 0.05, s = 0.022 * (1 - t * 0.6);
    blob(B, [x, s * 0.9, z], [s * 1.1, s * 0.9, s * 0.8], { nu: 7, nv: 4, col: () => (R() > 0.7 ? mat : bone), anim: () => [0, 0, 0, 0] });
    tube(B, [[x, s * 1.6, z], [x, s * 3.2, z - 0.005]], () => s * 0.25, { nu: 4, col: () => bone, anim: () => [0, 0, 0, 0] });
    if (i < 12) for (const sd of [1, -1]) {
      const pts = []; const lr = 0.16 * (1 - i / 14) + 0.05;
      for (let j = 0; j <= 6; j++) { const a = (j / 6) * Math.PI * 0.62; pts.push([x + sd * Math.sin(a) * lr * 1.1, Math.max(0.006, 0.03 + Math.cos(a) * 0.02 - (j / 6) * 0.02), z - 0.01 * j]); }
      tube(B, pts, () => 0.006, { nu: 4, col: () => bone, anim: () => [0, 0, 0, 0] });
    }
    // Osedax (bone-eating worms): small red plumes on the bones
    if (R() > 0.4) for (let k = 0; k < 3; k++) blob(B, [x + (R() - 0.5) * 0.03, s * 1.5 + R() * 0.01, z + (R() - 0.5) * 0.02], [0.004, 0.009, 0.004], { nu: 5, nv: 3, col: () => os, anim: () => [1, 1, R(), 1] });
  }
  // a white bacterial mat round the bones
  fin(B, [[0, 0.002, 0], ...Array.from({ length: 13 }, (_, j) => { const a = (j / 12) * TAU; return [Math.cos(a) * 0.3 * (0.8 + 0.3 * Math.sin(j * 3.1)), 0.002, Math.sin(a) * 0.5 * (0.8 + 0.3 * Math.cos(j * 2.3)) - 0.08]; })], 0.001, { col: () => mix3(mat, [0.4, 0.4, 0.35], 0.4), anim: () => [0, 0, 0, 0] });
  return B.mesh();
}

export function seaPenMesh(params = {}) {
  const p = Object.assign({ leaves: 16, col: { stalk: 0xd8b0a0, rachis: 0xe07850, leaf: 0xe89070, polyp: 0xfff0e0 }, glow: null }, params);
  const st = hex(p.col.stalk), ra = hex(p.col.rachis), lf = hex(p.col.leaf), po = hex(p.col.polyp), B = builder();
  const G = p.glow, g = G ? hex(G.colour ?? 0x50ffa0) : null;
  // the stalk (peduncle) and the rachis: a straight shaft, sway with height (s)
  const H = 1, y0 = 0.12;
  tube(B, [[0, 0, 0], [0, y0, 0]], () => 0.035, { nu: 6, col: () => st, anim: t => [t * y0, 0, 0, 0] });
  const shaft = []; for (let i = 0; i <= 8; i++) shaft.push([0, y0 + (H - y0) * (i / 8), 0]);
  tube(B, shaft, t => 0.03 * (1 - 0.6 * t), { nu: 6, col: () => ra, anim: t => [y0 + (H - y0) * t, 0, 0, 0] });
  // the leaves: pairs of fans on the upper rachis, polyps on the edge
  for (let k = 0; k < p.leaves; k++) {
    const t = 0.25 + 0.7 * (k / Math.max(1, p.leaves - 1)), y = y0 + (H - y0) * t, L = 0.2 * Math.sin(Math.PI * Math.min(1, (t - 0.2) / 0.8)) + 0.04;
    for (const sd of [1, -1]) {
      const edge = [0, 1, 2, 3].map(j => [sd * L * (0.3 + 0.7 * j / 3), y + 0.05 - 0.02 * j, (j - 1.5) * 0.012]);
      fin(B, [[0, y, 0], ...edge], 0.004, { col: () => lf, anim: () => [y, 0.4, k / p.leaves, 0.4] });
      for (const q of edge) blob(B, q, [0.008, 0.008, 0.008], { nu: 4, nv: 3, col: () => po, anim: () => [y, 0.4, k / p.leaves, 0.4], glow: () => (G ? [g[0] * G.k * 4, g[1] * G.k * 4, g[2] * G.k * 4] : null), pho: () => organ(y) });
    }
  }
  return B.mesh();
}
