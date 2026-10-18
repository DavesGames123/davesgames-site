// ============================================================================
//  CORAL REEF  ·  fauna/gen/ceph.js  ·  parametric cephalopods (our own)
// ----------------------------------------------------------------------------
//  DOM-free. Octopus, squid, cirrate (dumbo) octopus and vampire squid from
//  one generator. Length 1 along z: the mantle tip at -z (behind), the arms
//  point forward to +z for a squid, and hang down (-y) for an octopus.
//
//    cephMesh(p) -> builder mesh (gen/mesh.js)
//  p = { plan: 'octopus' | 'squid' | 'dumbo' | 'vampire',
//        mantle: [length, radius], arms: count (8), armL (fraction),
//        tentacles: 0 | 2 (squid), web: 0..1 (the web between the arms),
//        fins: 0..1 (squid rhombic fins, dumbo ear fins), curl: 0..1,
//        col: { body, under, spots, web }, glow: { colour, k, spots } }
//  Animation: arm vertices have w = 1, ph = arm index / arms, f = the
//  distance along the arm; the fins w = 1 with ph 0.25 / 0.75; the mantle
//  w = 0 (a slow pulse in the shader).
//
//  grep -n targets: "export function cephMesh"
// ============================================================================
import { builder, loft, tube, blob, fin, hex, mix3, sstep, clamp, lerp, add, scale } from './mesh.js';

const TAU = Math.PI * 2;
const h2 = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

export function cephMesh(params = {}) {
  const plan = params.plan || 'octopus';
  const base = {
    octopus: { mantle: [0.32, 0.13], arms: 8, armL: 0.75, tentacles: 0, web: 0.15, fins: 0, curl: 0.6 },
    squid: { mantle: [0.6, 0.075], arms: 8, armL: 0.25, tentacles: 2, web: 0, fins: 0.5, curl: 0.15 },
    dumbo: { mantle: [0.34, 0.16], arms: 8, armL: 0.45, tentacles: 0, web: 0.85, fins: 0.7, curl: 0.3 },
    vampire: { mantle: [0.36, 0.13], arms: 8, armL: 0.45, tentacles: 0, web: 0.95, fins: 0.45, curl: 0.4 },
  }[plan];
  const p = Object.assign({}, base, params);
  const C = Object.assign({ body: 0x9a4a3a, under: 0xd09080, spots: 0xf0e0d0, web: 0x702a2a }, p.col || {});
  const body = hex(C.body), under = hex(C.under), spot = hex(C.spots), webc = hex(C.web);
  const G = p.glow, gcol = G ? hex(G.colour ?? 0x40c0ff) : null;
  const B = builder();
  const [mL, mR] = p.mantle;
  const squidLike = plan === 'squid';
  // the axis: a squid swims along z (arms to +z); an octopus body is
  // upright: mantle up (+y), arms down. The loft uses s from the mantle tip.
  const tipZ = squidLike ? -0.5 : 0, headZ = squidLike ? tipZ + mL : 0;
  const spine = s => squidLike
    ? { o: [0, 0, lerp(tipZ, headZ + 0.06, s)], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
    : { o: [0, lerp(0.5, 0.5 - mL - 0.06, s), 0], x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] };
  const radius = s => {
    const mantle = Math.sqrt(Math.sin(clamp(s / 0.85, 0, 1) * Math.PI / 2)) * mR;
    const neck = s > 0.85 ? lerp(mR, mR * 0.75, sstep(0.85, 1, s)) : mantle;
    return Math.max(0.006, s > 0.85 ? neck : mantle);
  };
  const glowSpot = (s, u) => (G && G.spots && h2(Math.floor(s * 18), Math.floor(u * 14)) > 1 - G.spots ? [gcol[0] * G.k * 3, gcol[1] * G.k * 3, gcol[2] * G.k * 3] : null);
  loft(B, spine, (s, u) => { const r = radius(s), a = u * TAU; return [Math.cos(a) * r, Math.sin(a) * r * (plan === 'dumbo' ? 1.15 : 1)]; }, {
    ns: 14, nu: 14, cap0: true, cap1: false,
    col: (s, u) => { let c = mix3(under, body, sstep(-0.4, 0.5, Math.sin(u * TAU))); if (h2(Math.floor(s * 22), Math.floor(u * 16)) > 0.86) c = mix3(c, spot, 0.6); return c; },
    anim: s => [s, 0, 0, 0], glow: glowSpot,
  });
  // eyes at the head
  const head = squidLike ? [0, 0, headZ] : [0, 0.5 - mL - 0.02, 0];
  for (const sd of [1, -1]) {
    const e = squidLike ? [sd * mR * 0.95, mR * 0.25, headZ] : [sd * mR * 0.9, head[1] + 0.02, mR * 0.35];
    blob(B, e, [0.028, 0.03, 0.03], { nu: 8, nv: 5, col: () => (plan === 'vampire' ? [0.4, 0.05, 0.04] : [0.02, 0.02, 0.03]), anim: () => [0.9, 0, 0, 0] });
  }
  // arms: tubes from a ring at the head
  const nA = p.arms + p.tentacles;
  const armTips = [];
  for (let k = 0; k < nA; k++) {
    const isT = k >= p.arms, a = (k / p.arms) * TAU + (isT ? 0.6 : 0) + (isT && k > p.arms ? Math.PI : 0);
    const L = (isT ? p.armL * 2.6 : p.armL) * (1 + 0.1 * Math.sin(k * 2.3));
    const pts = [];
    const N = 12;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      // out from the ring, then along the body axis, then the curl
      const out = mR * 0.75 + L * 0.35 * Math.sin(t * Math.PI * 0.5) * (squidLike ? 0.3 : 1);
      const along = L * t;
      const curl = p.curl * Math.pow(t, 2) * L * 0.6;
      let q;
      if (squidLike) q = [Math.cos(a) * (out * 0.5 - curl * 0.2), Math.sin(a) * (out * 0.5 - curl * 0.2), headZ + 0.05 + along];
      else q = [Math.cos(a) * (out + curl * 0.2), head[1] - 0.04 - along * 0.85 + curl * 0.6, Math.sin(a) * (out + curl * 0.2)];
      pts.push(q);
    }
    armTips.push(pts);
    const r0 = isT ? 0.012 : mR * 0.28;
    tube(B, pts, t => (isT && t > 0.8 ? 0.02 : lerp(r0, 0.003, Math.pow(t, 0.8))), {
      nu: 6, capEnd: true,
      col: (t, u) => { let c = mix3(body, under, u > 0.5 ? 0.6 : 0.1); if (u > 0.4 && u < 0.6 && (t * 20) % 1 < 0.4) c = mix3(c, spot, 0.7); return c; },
      anim: t => [0.6 + 0.4 * t, clamp(t * 1.4, 0, 1), k / nA, t],
      glow: t => (G && plan === 'vampire' && t > 0.92 ? [gcol[0] * G.k * 4, gcol[1] * G.k * 4, gcol[2] * G.k * 4] : null),
    });
  }
  // the web between the arms (a skirt of fans)
  if (p.web > 0) {
    for (let k = 0; k < p.arms; k++) {
      const A = armTips[k], Bt = armTips[(k + 1) % p.arms], n = Math.max(2, Math.round(A.length * p.web) - 1);
      const pts = [squidLike ? [0, 0, headZ] : [0, head[1] - 0.02, 0]];
      for (let i = 1; i <= n; i++) pts.push(A[i]);
      for (let i = n; i >= 1; i--) pts.push(Bt[i]);
      fin(B, pts, 0.004, { col: () => webc, anim: (i, q) => [0.8, 0.6, k / p.arms, 0.5] });
    }
  }
  // fins: squid rhombic fins at the mantle tip; dumbo and vampire ear fins
  if (p.fins > 0) {
    for (const sd of [1, -1]) {
      let pts;
      if (squidLike) { const z0 = tipZ, fl = mL * 0.45 * p.fins * 2; pts = [[0, 0, z0 + 0.01], [sd * mR * 0.6, 0, z0 + fl], [sd * (mR + fl * 0.55), 0, z0 + fl * 0.45], [sd * mR * 0.3, 0, z0 - 0.01]]; }
      else { const y0 = 0.5 - mL * 0.35, fs = 0.16 * p.fins; pts = [[sd * mR * 0.85, y0, 0], [sd * (mR + fs * 0.7), y0 + fs * 0.6, 0], [sd * (mR + fs), y0 + fs * 0.1, 0], [sd * (mR + fs * 0.6), y0 - fs * 0.5, 0], [sd * mR * 0.8, y0 - fs * 0.3, 0]]; }
      fin(B, pts, 0.006, { col: () => body, anim: (i, q) => [0.3, i === 0 ? 0 : 1, sd > 0 ? 0.25 : 0.75, 0.9], glow: () => (G && plan === 'vampire' ? [gcol[0] * G.k * 1.5, gcol[1] * G.k * 1.5, gcol[2] * G.k * 1.5] : null) });
    }
  }
  return B.mesh();
}
