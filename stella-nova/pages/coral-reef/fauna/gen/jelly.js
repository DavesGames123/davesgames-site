// ============================================================================
//  CORAL REEF  ·  fauna/gen/jelly.js  ·  jellies, comb jellies, siphonophores
// ----------------------------------------------------------------------------
//  DOM-free, our own generator. Gel animals: the page draws them with the
//  gel material (fauna/glsl.js GEL: see-through, a bright rim, emissive
//  where the generator gives glow).
//
//    medusaMesh(p)   a bell (+y up, height 1) with oral arms and tentacles
//      p = { form: 'bell' | 'helmet' | 'crown', tentacles, tentL (fraction),
//            arms (oral arms), col: { bell, rim, arms }, glow: { colour, k } }
//    ctenoMesh(p)    a comb jelly (lobate or Beroe), the 8 comb rows have
//                    glow = 0 and anim.w = 1: the shader runs the rainbow
//      p = { form: 'lobate' | 'beroe', col }
//    siphoMesh(p)    a siphonophore along z: a float, a column of swimming
//                    bells and a long stem with tentacle clusters
//      p = { bells, stemL, col, glow }
//  Animation: bell rim w = 1 (the pulse), the tentacles s = 0..1 down
//  their length (the lag), ph per tentacle.
//
//  grep -n targets: "export function medusaMesh", "export function ctenoMesh",
//  "export function siphoMesh"
// ============================================================================
import { builder, loft, tube, blob, hex, mix3, sstep, clamp, lerp, dots, organ } from './mesh.js';

const TAU = Math.PI * 2;

export function medusaMesh(params = {}) {
  const p = Object.assign({ form: 'bell', tentacles: 16, tentL: 1.6, arms: 4, col: { bell: 0xc8d8f0, rim: 0xf0c0d0, arms: 0xe0b0c0 }, glow: null }, params);
  const C = p.col, bell = hex(C.bell), rim = hex(C.rim), armc = hex(C.arms ?? C.rim);
  const G = p.glow, g = G ? hex(G.colour ?? 0x3080ff) : null, gk = G ? G.k : 0;
  const B = builder();
  // bell profile: radius r(t) and height y(t) for t from the apex (0) to the margin (1)
  const prof = t => {
    if (p.form === 'helmet') return [0.32 * Math.sin(t * Math.PI * 0.5) * (0.6 + 0.4 * t), 0.5 - t * 0.85];       // tall cone (Periphylla)
    if (p.form === 'crown') return [0.5 * Math.sin(t * Math.PI * 0.5), 0.12 - 0.22 * t * t];                    // flat disc (Atolla)
    return [0.5 * Math.sin(t * Math.PI * 0.5), 0.3 - 0.5 * t * t];                                            // bell
  };
  // outer and inner surfaces of the bell (two lofts give thickness)
  for (const side of [1, -1]) {
    loft(B,
      t => { const [, y] = prof(t); return { o: [0, y - (side < 0 ? 0.03 : 0), 0], x: [1, 0, 0], y: [0, 0, side], z: [0, -side, 0] }; },
      (t, u) => { const [r] = prof(t), a = u * TAU, sc = 1 + (p.form === 'crown' ? 0.05 * Math.cos(a * 16) * t : 0.03 * Math.cos(a * 8) * t * t); const rr = Math.max(0.004, (r - (side < 0 ? 0.03 : 0)) * sc); return [Math.cos(a) * rr, Math.sin(a) * rr]; },
      { ns: 10, nu: 24, cap0: false, col: t => mix3(bell, rim, sstep(0.6, 1, t)), anim: t => [0, sstep(0.3, 1, t), 0, t],
        // the photophores: Atolla, a ring of dots on the coronal groove (the
        // flash wave runs round it, wave = u); Periphylla, scattered spots
        // over the outer bell (the wave runs from the apex, wave = t); a
        // plain bell, dots on the margin
        glow: (t, u) => (G && (p.form === 'crown' ? t > 0.74 : p.form === 'helmet' ? side > 0 && t > 0.15 : t > 0.82) ? [g[0] * gk * 3, g[1] * gk * 3, g[2] * gk * 3] : null),
        pho: (t, u) => (p.form === 'crown' ? dots(u * 40, (t - 0.8) / 0.12, 1, 0, u) : p.form === 'helmet' ? dots(u * 36, t * 14, 64, 0.6, t) : dots(u * 32, (t - 0.88) / 0.1, 1, 0, u)) });
  }
  // oral arms (frilly, short) and the marginal tentacles (long, thin)
  const [rM, yM] = prof(1);
  for (let k = 0; k < p.arms; k++) {
    const a = (k / p.arms) * TAU + 0.3, pts = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([Math.cos(a) * 0.06 * (1 + t), yM + 0.1 - t * 0.9 * (p.tentL * 0.4), Math.sin(a) * 0.06 * (1 + t)]); }
    tube(B, pts, t => 0.03 * (1 - t * 0.7) * (1 + 0.3 * Math.sin(t * 40)), { nu: 5, col: () => armc, anim: t => [t, 1, k / p.arms, t] });
  }
  for (let k = 0; k < p.tentacles; k++) {
    const a = (k / p.tentacles) * TAU, L = p.tentL * (p.form === 'crown' && k === 0 ? 3 : 1) * (0.7 + 0.3 * Math.sin(k * 7.1) ** 2), pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([Math.cos(a) * rM * (1 - 0.15 * t), yM - t * L, Math.sin(a) * rM * (1 - 0.15 * t)]); }
    tube(B, pts, () => 0.004, { nu: 3, col: () => rim, anim: t => [t, 1, k / p.tentacles, t], glow: t => (G && G.tent ? [g[0] * gk * 2, g[1] * gk * 2, g[2] * gk * 2] : null), pho: (t, u) => dots(t * 30, u * 3, 64, 0.5, t) });
  }
  // the stomach (deep red in the twilight and the abyss: it hides the glow of the prey)
  blob(B, [0, prof(0.3)[1] - 0.12, 0], [0.12, 0.1, 0.12], { nu: 10, nv: 6, col: () => hex(C.gut ?? C.rim), anim: () => [0, 0, 0, 0] });
  return B.mesh();
}

export function ctenoMesh(params = {}) {
  const p = Object.assign({ form: 'lobate', col: { body: 0xd8e8f0 } }, params);
  const body = hex(p.col.body), B = builder();
  const beroe = p.form === 'beroe';
  // an ovoid body (axis y), mouth at the bottom; lobate: two oral lobes
  const R = t => (beroe ? 0.28 * Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.5) * (1 - 0.15 * t) : 0.22 * Math.sin(t * Math.PI) + 0.04);
  loft(B, t => ({ o: [0, 0.5 - t, 0], x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] }),
    (t, u) => { const a = u * TAU, r = R(t) * (beroe ? 1 : 1 + 0.25 * Math.cos(2 * a) * sstep(0.5, 1, t)); return [Math.cos(a) * r, Math.sin(a) * r * (beroe ? 0.75 : 1)]; },
    { ns: 14, nu: 24, cap0: true, col: () => body, anim: t => [t, 0.2 * t, 0, t] });
  // 8 comb rows: thin strips over the body, w = 1, ph = row / 8 (the rainbow wave)
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + 0.2, pts = [];
    for (let i = 0; i <= 14; i++) { const t = 0.08 + (i / 14) * (beroe ? 0.84 : 0.55); const r = R(t) * 1.03; pts.push([Math.cos(a) * r, 0.5 - t, Math.sin(a) * r * (beroe ? 0.75 : 1)]); }
    tube(B, pts, () => 0.008, { nu: 3, col: () => [0.9, 0.9, 1], anim: t => [t, 1, k / 8, 2] });
  }
  return B.mesh();
}

export function siphoMesh(params = {}) {
  const p = Object.assign({ bells: 8, stemL: 0.7, col: { body: 0xe0d8f0, float: 0xf0b0a0, tent: 0xf08080 }, glow: null }, params);
  const body = hex(p.col.body), flt = hex(p.col.float), ten = hex(p.col.tent), B = builder();
  const G = p.glow, g = G ? hex(G.colour ?? 0x40a0ff) : null;
  // the float at the front (+z), then a double column of swimming bells
  blob(B, [0, 0, 0.5], [0.025, 0.025, 0.04], { nu: 8, nv: 5, col: () => flt, anim: () => [0, 0, 0, 0] });
  const L0 = 0.5 - 0.06, bellLen = (1 - p.stemL) - 0.06;
  for (let k = 0; k < p.bells; k++) {
    const z = L0 - (k / p.bells) * bellLen, sd = k % 2 ? 1 : -1;
    blob(B, [sd * 0.03, 0, z], [0.035, 0.03, 0.04], { nu: 8, nv: 5, col: () => body, anim: () => [0.5 - z, 1, k / p.bells, 0.3] });
  }
  // the stem with clusters of tentacles (glowing lures on some species)
  const z0 = L0 - bellLen, stem = [];
  for (let i = 0; i <= 16; i++) stem.push([0, 0, z0 - (i / 16) * (z0 + 0.5)]);
  tube(B, stem, () => 0.004, { nu: 3, col: () => ten, anim: t => [0.5 - (z0 - t * (z0 + 0.5)), 0.5, 0, 1] });
  for (let i = 1; i <= 8; i++) {
    const z = z0 - (i / 8.5) * (z0 + 0.5), pts = [];
    for (let j = 0; j <= 6; j++) { const t = j / 6; pts.push([Math.sin(i * 1.7) * 0.02 * t, -t * 0.18, z - t * 0.04]); }
    tube(B, pts, () => 0.002, { nu: 3, col: () => ten, anim: t => [0.5 - z + t * 0.05, 1, i / 8, t], glow: t => (G && t > 0.8 ? [g[0] * G.k * 4, g[1] * G.k * 4, g[2] * G.k * 4] : null), pho: () => organ(0.5 - z) });
    // Nanomia: a small light point at the tip of each tentacle cluster
    if (G) blob(B, pts[pts.length - 1], [0.006, 0.006, 0.006], { nu: 4, nv: 3, col: () => ten, anim: () => [0.5 - z, 1, i / 8, 1], glow: () => [g[0] * G.k * 5, g[1] * G.k * 5, g[2] * G.k * 5], pho: () => organ(0.5 - z) });
  }
  return B.mesh();
}
