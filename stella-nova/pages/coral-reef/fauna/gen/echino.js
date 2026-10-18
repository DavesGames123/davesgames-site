// ============================================================================
//  CORAL REEF  ·  fauna/gen/echino.js  ·  sea stars, brittle stars, urchins,
//                                         sea cucumbers (our own generator)
// ----------------------------------------------------------------------------
//  DOM-free. The size is 1 (the widest span); +y up, the animal lies on
//  y = 0 (the page puts y = 0 on the ground).
//
//    starMesh(p)     p = { arms (5..24), disc (radius), taper, thick, wavy,
//                          col: { top, under, tip, spots } }
//    brittleMesh(p)  p = { arms (5), disc, armR, spines, col }  thin snaky arms
//    urchinMesh(p)   p = { test (radius), spines (count), spineL, flat,
//                          col: { test, spine, tip } }
//    cucumberMesh(p) p = { plan: 'holothuria' | 'enypniastes' | 'scotoplanes' |
//                          'psychropotes', col, glow }
//  Animation: an arm has w = t (out along the arm), ph = arm / arms, f = t
//  (the arm curl and the brittle-star crawl); a cucumber body s from front
//  to back (the peristalsis), its veil or sail w = 1 (the swim).
//
//  grep -n targets: "export function starMesh", "export function brittleMesh",
//  "export function urchinMesh", "export function cucumberMesh"
// ============================================================================
import { builder, loft, tube, blob, fin, hex, mix3, sstep, clamp, lerp, norm, cross, add, scale } from './mesh.js';

const TAU = Math.PI * 2;
const h2 = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

export function starMesh(params = {}) {
  const p = Object.assign({ arms: 5, disc: 0.14, taper: 0.85, thick: 0.07, wavy: 0.1, col: { top: 0xc04030, under: 0xe8c8a0, tip: 0xe07050, spots: 0xf0e0b0 } }, params);
  const C = p.col, top = hex(C.top), under = hex(C.under), tip = hex(C.tip ?? C.top), spots = hex(C.spots ?? C.top);
  const B = builder(), R = 0.5;
  blob(B, [0, p.thick * 0.55, 0], [p.disc * 1.05, p.thick * 0.7, p.disc * 1.05], { nu: 4 * p.arms, nv: 6, col: (q, n) => (n[1] < 0 ? under : top), anim: () => [0, 0, 0, 0] });
  for (let k = 0; k < p.arms; k++) {
    const a = (k / p.arms) * TAU, d = [Math.cos(a), 0, Math.sin(a)], side = [-Math.sin(a), 0, Math.cos(a)];
    const wv = p.wavy * Math.sin(k * 2.7);
    loft(B, t => {
      const r = lerp(p.disc * 0.6, R, t), bend = wv * Math.sin(t * Math.PI) * 0.4;
      const o = [d[0] * r + side[0] * bend, p.thick * 0.5 * (1 - t * 0.6) + 0.003, d[2] * r + side[2] * bend];
      return { o, x: [-side[0], 0, -side[2]], y: [0, 1, 0], z: d };
    }, (t, u) => {
      const wdt = lerp(p.disc * 0.7, p.disc * 0.7 * (1 - p.taper) + 0.006, Math.pow(t, 0.9)), ang = u * TAU;
      const hh = p.thick * 0.5 * (1 - t * 0.7) + 0.004;
      const yy = Math.sin(ang) > 0 ? Math.sin(ang) * hh : Math.sin(ang) * hh * 0.35;
      return [Math.cos(ang) * wdt, yy];
    }, { ns: 10, nu: 8, cap1: true,
      col: (t, u) => { const up = Math.sin(u * TAU); let c = up < -0.2 ? under : mix3(top, tip, sstep(0.6, 1, t)); if (up > 0 && h2(Math.floor(t * 14), Math.floor(u * 8 + k * 5)) > 0.78) c = mix3(c, spots, 0.7); return c; },
      anim: t => [t, t, k / p.arms, t] });
  }
  return B.mesh();
}

export function brittleMesh(params = {}) {
  const p = Object.assign({ arms: 5, disc: 0.07, armR: 0.018, spines: true, col: { top: 0x806040, under: 0xd0b090, band: 0x504030 } }, params);
  const C = p.col, top = hex(C.top), under = hex(C.under), band = hex(C.band ?? C.top);
  const B = builder();
  blob(B, [0, 0.02, 0], [p.disc, 0.025, p.disc], { nu: 15, nv: 5, col: (q, n) => (n[1] < 0 ? under : (h2(Math.floor(q[0] * 80), Math.floor(q[2] * 80)) > 0.5 ? top : band)), anim: () => [0, 0, 0, 0] });
  for (let k = 0; k < p.arms; k++) {
    const a = (k / p.arms) * TAU + 0.15, pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, r = p.disc * 0.8 + (0.5 - p.disc * 0.8) * t;
      const wig = 0.06 * Math.sin(t * 5 + k * 1.9) * t;
      pts.push([Math.cos(a) * r - Math.sin(a) * wig, 0.012 + 0.03 * Math.sin(t * Math.PI) * (k % 2 ? 1 : 0.4), Math.sin(a) * r + Math.cos(a) * wig]);
    }
    tube(B, pts, t => lerp(p.armR, 0.002, t), { nu: 4, capEnd: true, col: (t) => ((t * 22) % 1 < 0.5 ? top : band), anim: t => [t, t, k / p.arms, t] });
  }
  return B.mesh();
}

export function urchinMesh(params = {}) {
  const p = Object.assign({ test: 0.22, spines: 70, spineL: 0.28, flat: 0.75, col: { test: 0x402030, spine: 0x201018, tip: 0x603040 } }, params);
  const C = p.col, tc = hex(C.test), sc = hex(C.spine), tipc = hex(C.tip ?? C.spine);
  const B = builder(), r = p.test;
  blob(B, [0, r * p.flat, 0], [r, r * p.flat, r], { nu: 16, nv: 10, col: () => tc, anim: () => [0, 0, 0, 0] });
  // spines on a Fibonacci sphere (upper part denser), thin cones
  const n = p.spines, ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 1.6, rr = Math.sqrt(Math.max(0, 1 - y * y)), th = ga * i;
    const d = norm([Math.cos(th) * rr, y, Math.sin(th) * rr]);
    const base = [d[0] * r * 0.95, r * p.flat + d[1] * r * p.flat * 0.95, d[2] * r * 0.95];
    const L = p.spineL * (0.75 + 0.5 * h2(i, 3.3)) * (d[1] < -0.3 ? 0.4 : 1);
    tube(B, [base, add(base, scale(d, L * 0.5)), add(base, scale(d, L))], t => lerp(0.008, 0.0015, t), { nu: 3, col: t => mix3(sc, tipc, t), anim: t => [0, t, i / n, t] });
  }
  return B.mesh();
}

export function cucumberMesh(params = {}) {
  const plan = params.plan || 'holothuria';
  const P = {
    holothuria: { L: 1, R: 0.11, col: { body: 0x141414, under: 0x2a2620, pap: 0x303030 } },
    enypniastes: { L: 1, R: 0.16, col: { body: 0xe07080, under: 0xc04060, pap: 0xf0a0b0 } },
    scotoplanes: { L: 1, R: 0.17, col: { body: 0xe0c0c8, under: 0xd0a0b0, pap: 0xf0d8e0 } },
    psychropotes: { L: 1, R: 0.12, col: { body: 0xd8d090, under: 0xb0a060, pap: 0xe8e0a0 } },
  }[plan];
  const p = Object.assign({}, P, params, { col: Object.assign({}, P.col, params.col || {}) });
  const body = hex(p.col.body), under = hex(p.col.under), pap = hex(p.col.pap);
  const G = p.glow, g = G ? hex(G.colour ?? 0x40a0ff) : null;
  const B = builder();
  const R = s => p.R * Math.sqrt(Math.max(0.05, Math.sin(clamp(s, 0.02, 0.98) * Math.PI))) * (plan === 'enypniastes' ? 0.8 + 0.4 * (1 - s) : 1);
  loft(B, s => ({ o: [0, R(s) * 0.8, 0.5 - s], x: [-1, 0, 0], y: [0, 1, 0], z: [0, 0, -1] }),
    (s, u) => { const a = u * TAU, r = R(s); return [Math.cos(a) * r, Math.sin(a) * r * (Math.sin(a) < 0 ? 0.55 : 0.85)]; },
    { ns: 16, nu: 12, cap0: true, cap1: true, col: (s, u) => (Math.sin(u * TAU) < -0.3 ? under : body), anim: s => [s, 0, 0, 0],
      glow: (s, u) => (G && h2(Math.floor(s * 20), Math.floor(u * 12)) > 0.85 ? [g[0] * G.k * 2, g[1] * G.k * 2, g[2] * G.k * 2] : null) });
  if (plan === 'holothuria' || plan === 'psychropotes') {
    for (let i = 0; i < 26; i++) { const s = 0.1 + 0.8 * h2(i, 1.1), a = Math.PI * (0.15 + 0.7 * h2(i, 2.2)); const r = R(s); blob(B, [Math.cos(a) * r, R(s) * 0.8 + Math.sin(a) * r * 0.85, 0.5 - s], [0.012, 0.012, 0.012], { nu: 5, nv: 3, col: () => pap, anim: () => [s, 0, 0, 0] }); }
  }
  if (plan === 'enypniastes') {
    // the swimming veil at the front and the brim at the back
    const veil = []; veil.push([0, R(0.1) * 1.4, 0.4]);
    for (let i = 0; i <= 8; i++) { const a = Math.PI * (i / 8); veil.push([Math.cos(a) * 0.32, R(0.1) * 1.4 + Math.sin(a) * 0.12, 0.5 + 0.04]); }
    fin(B, veil, 0.004, { col: () => pap, anim: (i) => [0.05, i ? 1 : 0, 0, 1] });
    const brim = [[0, R(0.9) * 0.9, -0.38]]; for (let i = 0; i <= 6; i++) { const a = Math.PI * (i / 6); brim.push([Math.cos(a) * 0.22, R(0.9) * 0.9 + Math.sin(a) * 0.05, -0.5]); }
    fin(B, brim, 0.004, { col: () => pap, anim: (i) => [0.95, i ? 1 : 0, 0.5, 1] });
  }
  if (plan === 'scotoplanes') {
    // tube-feet legs under the body and the dorsal papillae ("antennae")
    for (let i = 0; i < 10; i++) {
      const s = 0.15 + (Math.floor(i / 2) / 4) * 0.7, sd = i % 2 ? 1 : -1, r = R(s);
      tube(B, [[sd * r * 0.7, R(s) * 0.4, 0.5 - s], [sd * r * 1.05, 0.0, 0.5 - s]], t => lerp(0.03, 0.018, t), { nu: 5, capEnd: true, col: () => under, anim: t => [s, t, i / 10, t] });
    }
    for (let i = 0; i < 4; i++) {
      const sd = i % 2 ? 1 : -1, s = i < 2 ? 0.12 : 0.24, base = [sd * 0.05, R(s) * 1.5, 0.5 - s];
      tube(B, [base, [sd * 0.08, base[1] + 0.12, base[2] + 0.03], [sd * 0.1, base[1] + 0.2, base[2] + 0.08]], t => lerp(0.018, 0.006, t), { nu: 5, capEnd: true, col: () => pap, anim: t => [s, t, i / 4, t] });
    }
  }
  if (plan === 'psychropotes') {
    // the tall dorsal sail at the back
    const sail = [[0, R(0.7) * 1.4, -0.2], [0, R(0.7) * 1.4 + 0.35, -0.32], [0, R(0.7) * 1.4 + 0.3, -0.5], [0, R(0.9) * 1.2, -0.45]];
    fin(B, sail, 0.01, { col: () => body, anim: (i) => [0.8, i ? 0.6 : 0, 0.5, 0.6] });
  }
  return B.mesh();
}
