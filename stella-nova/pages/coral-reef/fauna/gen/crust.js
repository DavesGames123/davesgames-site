// ============================================================================
//  CORAL REEF  ·  fauna/gen/crust.js  ·  crabs, lobsters, shrimp, isopods,
//                                        amphipods (our own generator)
// ----------------------------------------------------------------------------
//  DOM-free. Length 1 along z (the head at +z), +y up, the legs stand on
//  y = 0.
//
//    crabMesh(p)    p = { carapace: [w, l, h], legs (4 pairs), legL, claw,
//                         hairy (yeti crab: white setae on the claws),
//                         col: { top, under, leg, claw, tip } }
//    shrimpMesh(p)  p = { plan: 'shrimp' | 'lobster' | 'squat', segs, h,
//                         antennaL, claw, col, glow }
//    isopodMesh(p)  p = { plan: 'isopod' | 'amphipod', segs, w, col }
//  Animation: a leg has w = 1, ph = the leg index (a walk wave), f = the
//  distance along the leg; the shrimp abdomen s = 0..1 (the tail flick).
//
//  grep -n targets: "export function crabMesh", "export function shrimpMesh",
//  "export function isopodMesh"
// ============================================================================
import { builder, loft, tube, blob, fin, hex, mix3, sstep, clamp, lerp } from './mesh.js';

const TAU = Math.PI * 2;
const h2 = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

function leg(B, base, dir, L, r, col, ph, s, kneeUp = 0.6) {
  const knee = [base[0] + dir[0] * L * 0.45, base[1] + L * kneeUp * 0.45, base[2] + dir[2] * L * 0.45];
  const foot = [base[0] + dir[0] * L, 0.0, base[2] + dir[2] * L];
  const pts = [base, knee, [lerp(knee[0], foot[0], 0.6), lerp(knee[1], foot[1], 0.5), lerp(knee[2], foot[2], 0.6)], foot];
  tube(B, pts, t => lerp(r, r * 0.35, t), { nu: 4, capEnd: true, col: () => col, anim: t => [s, clamp(t * 1.5, 0, 1), ph, t] });
}

function claw(B, base, dir, L, col, tip, hairy, ph) {
  const elbow = [base[0] + dir[0] * L * 0.4, base[1] + L * 0.18, base[2] + L * 0.35];
  const hand = [elbow[0] + dir[0] * L * 0.15, elbow[1] - L * 0.02, elbow[2] + L * 0.45];
  tube(B, [base, elbow, hand], t => lerp(L * 0.06, L * 0.08, t), { nu: 5, col: () => col, anim: t => [0.1, t * 0.6, ph, t] });
  blob(B, hand, [L * 0.13, L * 0.1, L * 0.22], { nu: 8, nv: 5, col: () => (hairy ? [0.85, 0.85, 0.8] : col), anim: () => [0.1, 0.6, ph, 1] });
  for (const [dy, l2] of [[0.04, 0.3], [-0.04, 0.26]]) tube(B, [[hand[0], hand[1] + dy * L, hand[2] + L * 0.15], [hand[0], hand[1] + dy * L * 0.6, hand[2] + L * l2 + L * 0.15]], t => lerp(L * 0.035, L * 0.008, t), { nu: 4, capEnd: true, col: () => tip, anim: t => [0.1, 0.7, ph, 1] });
  if (hairy) for (let i = 0; i < 14; i++) { const a = h2(i, 7) * TAU; tube(B, [hand, [hand[0] + Math.cos(a) * L * 0.25, hand[1] - L * 0.12 - h2(i, 3) * L * 0.1, hand[2] + Math.sin(a) * L * 0.2]], () => 0.002, { nu: 3, col: () => [0.92, 0.92, 0.86], anim: () => [0.1, 0.8, ph, 1] }); }
}

export function crabMesh(params = {}) {
  const p = Object.assign({ carapace: [0.55, 0.42, 0.16], legs: 4, legL: 0.4, claw: 0.42, hairy: false, col: { top: 0xb04020, under: 0xe8d0b0, leg: 0xc05030, claw: 0xc04020, tip: 0x301010 } }, params);
  const C = p.col, top = hex(C.top), under = hex(C.under), lc = hex(C.leg ?? C.top), cc = hex(C.claw ?? C.top), tip = hex(C.tip ?? 0x202020);
  const B = builder(), [cw, cl, ch] = p.carapace, y0 = p.legL * 0.35;
  blob(B, [0, y0 + ch * 0.4, 0], [cw / 2, ch / 2, cl / 2], { nu: 16, nv: 8, col: (q, n) => (n[1] < -0.2 ? under : (h2(Math.floor(q[0] * 30), Math.floor(q[2] * 30)) > 0.85 ? mix3(top, under, 0.3) : top)), anim: () => [0.3, 0, 0, 0] });
  for (const sd of [1, -1]) blob(B, [sd * cw * 0.12, y0 + ch * 0.85, cl * 0.48], [0.018, 0.022, 0.018], { nu: 6, nv: 4, col: () => [0.05, 0.03, 0.02], anim: () => [0, 0, 0, 0] });
  for (let k = 0; k < p.legs; k++) for (const sd of [1, -1]) {
    const z = cl * (0.18 - k * 0.14), base = [sd * cw * 0.42, y0 + ch * 0.25, z];
    const dz = 0.25 - k * 0.35;
    const dir = [sd * Math.cos(dz * 0.8), 0, Math.sin(dz * 0.8)];
    leg(B, base, dir, p.legL * (1 - 0.05 * k), 0.016, lc, ((k + (sd > 0 ? 0 : 0.5)) / p.legs) % 1, 0.5);
  }
  for (const sd of [1, -1]) claw(B, [sd * cw * 0.32, y0 + ch * 0.3, cl * 0.36], [sd * 0.6, 0, 0.8], p.claw, cc, tip, p.hairy, sd > 0 ? 0.1 : 0.6);
  return B.mesh();
}

export function shrimpMesh(params = {}) {
  const plan = params.plan || 'shrimp';
  const P = {
    shrimp: { h: 0.09, w: 0.07, segs: 6, antennaL: 1.1, claw: 0, legL: 0.16, col: { top: 0xd04030, under: 0xf0a090, leg: 0xe06050 } },
    lobster: { h: 0.11, w: 0.11, segs: 6, antennaL: 0.9, claw: 0.42, legL: 0.2, col: { top: 0x603020, under: 0xc08050, leg: 0x804030, claw: 0x703020, tip: 0xc04020 } },
    squat: { h: 0.12, w: 0.16, segs: 4, antennaL: 0.3, claw: 0.7, legL: 0.3, hairy: true, col: { top: 0xe8e4dc, under: 0xd8d0c0, leg: 0xe0dcd0, claw: 0xf0ece0, tip: 0xc0b8a0 } },
  }[plan];
  const p = Object.assign({}, P, params, { col: Object.assign({}, P.col, params.col || {}) });
  const top = hex(p.col.top), under = hex(p.col.under), lc = hex(p.col.leg ?? p.col.top);
  const G = p.glow, g = G ? hex(G.colour ?? 0x40a0ff) : null;
  const B = builder(), y0 = p.legL * 0.6;
  // the body: cephalothorax (s 0..0.4) then the abdomen segments (to 0.9) and the tail fan
  const R = s => (s < 0.4 ? 1 : lerp(1, 0.45, (s - 0.4) / 0.5));
  loft(B, s => ({ o: [0, y0 + p.h * (s < 0.4 ? 1 : 1 - 0.3 * Math.sin((s - 0.4) / 0.6 * Math.PI)) * (plan === 'shrimp' ? 1 : 0.8), 0.5 - s * (plan === 'squat' ? 0.75 : 0.92)], x: [-1, 0, 0], y: [0, 1, 0], z: [0, 0, -1] }),
    (s, u) => { const a = u * TAU, ring = s > 0.4 ? 1 - 0.12 * Math.pow(Math.abs(Math.sin(((s - 0.4) / 0.5) * p.segs * Math.PI)), 6) : 1, sh = Math.sqrt(Math.sin(clamp(s / 0.12, 0, 1) * Math.PI / 2)); return [Math.cos(a) * p.w * R(s) * ring * sh, Math.sin(a) * p.h * R(s) * ring * sh * (Math.sin(a) < 0 ? 0.6 : 1)]; },
    { ns: 20, nu: 10, cap0: true, cap1: true, col: (s, u) => (Math.sin(u * TAU) < -0.3 ? under : top), anim: s => [s, 0, 0, 0],
      glow: (s, u) => (G && Math.sin(u * TAU) < -0.5 && (s * 14) % 1 < 0.3 ? [g[0] * G.k * 3, g[1] * G.k * 3, g[2] * G.k * 3] : null) });
  const tz = 0.5 - (plan === 'squat' ? 0.75 : 0.92);
  fin(B, [[0, y0 + p.h * 0.6, tz + 0.02], [0.08, y0 + p.h * 0.5, tz - 0.08], [0, y0 + p.h * 0.5, tz - 0.11], [-0.08, y0 + p.h * 0.5, tz - 0.08]], 0.004, { col: () => top, anim: () => [1, 0.6, 0, 0.5] });
  for (const sd of [1, -1]) blob(B, [sd * p.w * 0.6, y0 + p.h * 0.9, 0.47], [0.02, 0.02, 0.02], { nu: 6, nv: 4, col: () => [0.05, 0.03, 0.02], anim: () => [0, 0, 0, 0] });
  // antennae
  for (const sd of [1, -1]) { const pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([sd * (0.03 + t * 0.15 * p.antennaL), y0 + p.h + t * 0.1, 0.5 + t * p.antennaL * 0.8 - t * t * p.antennaL * 0.3]); } tube(B, pts, () => 0.004, { nu: 3, col: () => lc, anim: t => [0, t, sd > 0 ? 0.2 : 0.7, t] }); }
  // walking legs under the cephalothorax
  for (let k = 0; k < 5; k++) for (const sd of [1, -1]) leg(B, [sd * p.w * 0.6, y0, 0.36 - k * 0.07], [sd * 0.9, 0, 0.2 - k * 0.1], p.legL * 1.6, 0.008, lc, ((k + (sd > 0 ? 0 : 0.5)) / 5) % 1, 0.25, 0.4);
  if (p.claw) for (const sd of [1, -1]) claw(B, [sd * p.w * 0.7, y0 + p.h * 0.3, 0.42], [sd * 0.35, 0, 0.9], p.claw, hex(p.col.claw ?? p.col.top), hex(p.col.tip ?? p.col.top), !!p.hairy, sd > 0 ? 0.15 : 0.65);
  return B.mesh();
}

export function isopodMesh(params = {}) {
  const plan = params.plan || 'isopod';
  const P = {
    isopod: { segs: 7, w: 0.42, h: 0.14, col: { top: 0xc8c0b0, under: 0xa89880, leg: 0xb0a090 } },
    amphipod: { segs: 9, w: 0.14, h: 0.26, col: { top: 0xf0e8e0, under: 0xe0c8b0, leg: 0xe8d8c8 } },
  }[plan];
  const p = Object.assign({}, P, params, { col: Object.assign({}, P.col, params.col || {}) });
  const top = hex(p.col.top), under = hex(p.col.under), lc = hex(p.col.leg);
  const B = builder(), amph = plan === 'amphipod', y0 = amph ? 0.08 : 0.05;
  // a curved (amphipod) or flat (isopod) segmented body
  loft(B, s => { const bend = amph ? Math.sin(s * Math.PI) * 0.14 : 0; return { o: [0, y0 + p.h * 0.5 + bend, 0.5 - s], x: [-1, 0, 0], y: [0, 1, 0], z: [0, 0, -1] }; },
    (s, u) => { const a = u * TAU, seg = 1 - 0.1 * Math.pow(Math.abs(Math.sin(s * p.segs * Math.PI)), 8), sh = Math.sqrt(Math.sin(clamp(s / 0.1, 0, 1) * Math.PI / 2)) * (1 - 0.35 * sstep(0.7, 1, s)); return [Math.cos(a) * p.w * 0.5 * seg * sh, Math.sin(a) * p.h * 0.5 * seg * sh * (Math.sin(a) < 0 ? 0.35 : 1)]; },
    { ns: 24, nu: 10, cap0: true, cap1: true, col: (s, u) => (Math.sin(u * TAU) < -0.2 ? under : mix3(top, under, 0.25 * Math.pow(Math.abs(Math.sin(s * p.segs * Math.PI)), 8))), anim: s => [s, 0, 0, 0] });
  for (const sd of [1, -1]) blob(B, [sd * p.w * 0.3, y0 + p.h * 0.65, 0.44], [0.03, 0.025, 0.03], { nu: 6, nv: 4, col: () => (amph ? [0.6, 0.1, 0.1] : [0.08, 0.08, 0.06]), anim: () => [0, 0, 0, 0] });
  for (const sd of [1, -1]) tube(B, [[sd * 0.03, y0 + p.h * 0.6, 0.48], [sd * 0.12, y0 + p.h, 0.62], [sd * 0.2, y0 + p.h * 0.9, 0.75]], () => 0.006, { nu: 3, col: () => lc, anim: t => [0, t, sd > 0 ? 0.2 : 0.7, t] });
  for (let k = 0; k < 7; k++) for (const sd of [1, -1]) leg(B, [sd * p.w * 0.4, y0 + 0.01, 0.32 - k * 0.09], [sd * 0.95, 0, 0.1 - k * 0.05], (amph ? 0.16 : 0.2), 0.008, lc, ((k + (sd > 0 ? 0 : 0.5)) / 7) % 1, 0.3, 0.4);
  if (!amph) for (const sd of [1, -1]) fin(B, [[sd * 0.02, y0 + 0.03, -0.46], [sd * 0.1, y0 + 0.02, -0.56], [sd * 0.05, y0 + 0.02, -0.6]], 0.004, { col: () => top, anim: () => [1, 0.5, 0, 0.5] });
  return B.mesh();
}
