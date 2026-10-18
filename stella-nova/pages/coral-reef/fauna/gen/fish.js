// ============================================================================
//  CORAL REEF  ·  fauna/gen/fish.js  ·  parametric fish, rays and turtles
// ----------------------------------------------------------------------------
//  DOM-free. Our own generator (no model of an archive): a lofted body with
//  fins, eyes, a colour pattern and photophores. The length is 1 (z from
//  +0.5 at the snout to -0.5 at the tail), +y is up; the page scales each
//  instance to the length of the species.
//
//    fishMesh(p) -> builder mesh (gen/mesh.js); p = { ...FISH_DEFAULTS, ... }
//    turtleMesh(p), rayMesh(p)
//
//  p fields (all optional)
//    body ..... 'fusiform' | 'deep' | 'elongate' | 'globose' | 'tadpole' |
//               'hatchet' | 'shark'
//    h, w ..... the largest half-height and half-width (fraction of length)
//    peak ..... s of the largest section; ped: the peduncle half-height
//    head ..... head size factor (gulper, angler: > 1); jaw: an open mouth
//    dorsal ... [s0, s1, height] or null; dorsal2, anal the same
//    caudal ... 'forked' | 'lunate' | 'round' | 'point' | 'hetero' | 'none'
//               and caudalH (height); pect: [size, droop]
//    eye ...... radius (fraction of length)
//    rays ..... tripod fish: the length of the pelvic and caudal stilts
//    lure ..... angler: the illicium length (a glowing esca); barbel: a
//               chin barbel with a glowing tip; sword: a rostrum length
//    col ...... { back, belly, fin, pattern: 'plain' | 'bars' | 'stripes' |
//                 'spots' | 'saddle', accent, n (pattern count), eye }
//               colours are 0xRRGGBB (sRGB)
//    glow ..... { rows: number of ventral photophore rows, colour, k (0..1) }
//
//  grep -n targets: "export function fishMesh", "function bodyProfile",
//  "export function rayMesh", "export function turtleMesh"
// ============================================================================
import { builder, loft, tube, blob, fin, hex, mix3, sstep, clamp, lerp } from './mesh.js';

export const FISH_DEFAULTS = {
  body: 'fusiform', h: 0.12, w: 0.07, peak: 0.32, ped: 0.025, head: 1, jaw: 0,
  dorsal: [0.25, 0.62, 0.1], dorsal2: null, anal: [0.55, 0.78, 0.06], caudal: 'forked', caudalH: 0.16, pect: [0.09, 0.4],
  eye: 0.03, rays: 0, lure: 0, barbel: 0, sword: 0,
  col: { back: 0x3a5f7a, belly: 0xd8dde0, fin: 0x8aa0b0, pattern: 'plain', accent: 0xf0d040, n: 4, eye: 0x101010 },
  glow: null, ns: 22, nu: 12,
};

const TAU = Math.PI * 2;
const zOf = s => 0.5 - s;
// a hash 0..1 of two numbers (the spot pattern)
const h2 = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

// half-height, half-width and the centre lift of the section at s
function bodyProfile(p, s) {
  const pk = p.peak;
  let f;
  if (s < pk) f = Math.sqrt(Math.sin((s / pk) * Math.PI / 2));             // round snout to the peak
  else f = Math.cos(((s - pk) / (1 - pk)) * Math.PI / 2);                    // taper to the tail
  f = Math.max(f, 0);
  let h = p.h * f, w = p.w * f, lift = 0;
  const tail = sstep(0.78, 1, s);
  h = lerp(h, p.ped, tail * 0.85); w = lerp(w, p.ped * 0.5, tail);
  switch (p.body) {
    case 'elongate': h = p.h * (s < 0.06 ? Math.sqrt(s / 0.06) : 1 - 0.75 * sstep(0.4, 1, s)); w = h * (p.w / p.h); break;
    case 'tadpole': { const hd = s < 0.32 ? Math.sqrt(Math.sin(Math.min(1, s / 0.12) * Math.PI / 2)) : 1 - sstep(0.32, 1, s) * 0.9; h = p.h * hd; w = p.w * hd; break; }
    case 'globose': h = p.h * Math.sqrt(Math.max(0, Math.sin(clamp(s / 0.75, 0, 1) * Math.PI))) + p.ped * tail; w = h * (p.w / p.h); break;
    case 'hatchet': lift = -p.h * 0.35 * (1 - sstep(0.15, 0.7, s)); h *= 1 + 0.6 * (1 - sstep(0.1, 0.7, s)); break;
    case 'deep': break;
    case 'shark': lift = 0.01 * (1 - s); break;
    default: break;
  }
  if (p.head > 1 && s < 0.25) { const k = 1 + (p.head - 1) * (1 - s / 0.25); h *= k; w *= k; }
  return [Math.max(h, 0.004), Math.max(w, 0.003), lift];
}

function bodyColour(p, s, u) {
  const C = p.col, back = hex(C.back), belly = hex(C.belly), acc = hex(C.accent ?? C.back);
  const up = Math.sin(u * TAU);                              // +1 top .. -1 bottom
  let c = mix3(belly, back, sstep(-0.35, 0.55, up));
  const n = C.n || 4;
  switch (C.pattern) {
    case 'bars': if (Math.sin(s * n * Math.PI * 2 + 0.6) > 0.55 && s > 0.12 && s < 0.85) c = mix3(c, acc, 0.85); break;
    case 'stripes': if (Math.abs(Math.sin(up * n * 1.7)) < 0.28 && s > 0.08) c = mix3(c, acc, 0.8); break;
    case 'spots': if (h2(Math.floor(s * 26 * n / 4), Math.floor(u * 20)) > 0.72 && up > -0.5) c = mix3(c, acc, 0.9); break;
    case 'saddle': if (up > 0.2 && Math.sin(s * n * Math.PI) > 0.5) c = mix3(c, acc, 0.75); break;
    case 'band': if (Math.abs(up - 0.05) < 0.22 && s > 0.05) c = mix3(c, acc, 0.85); break;   // a mid-side stripe (fusilier)
    case 'tailband': if (s > 0.72) c = mix3(c, acc, sstep(0.72, 0.8, s)); break;
    default: break;
  }
  // a dark head cap on deep fish
  if (C.head != null && s < 0.18) c = mix3(c, hex(C.head), 0.7);
  return c;
}

export function fishMesh(params = {}) {
  const p = Object.assign({}, FISH_DEFAULTS, params, { col: Object.assign({}, FISH_DEFAULTS.col, params.col || {}) });
  const B = builder();
  const G = p.glow, gcol = G ? hex(G.colour ?? 0x40a0ff) : null;
  const glowAt = (s, u) => {
    if (!G || !G.rows) return null;
    const up = Math.sin(u * TAU);
    if (up > -0.55 || s < 0.08 || s > 0.9) return null;
    const row = Math.floor((up + 1) / 0.45 * G.rows) % G.rows;
    const spot = (s * (G.per || 18)) % 1;
    return spot < 0.42 && row < G.rows ? [gcol[0] * G.k * 3, gcol[1] * G.k * 3, gcol[2] * G.k * 3] : null;
  };
  // body
  loft(B,
    s => { const [, , lift] = bodyProfile(p, s); return { o: [0, lift, zOf(s)], x: [-1, 0, 0], y: [0, 1, 0], z: [0, 0, -1] }; },
    (s, u) => { const [h, w] = bodyProfile(p, s); const a = u * TAU; return [Math.cos(a) * w, Math.sin(a) * h * (Math.sin(a) < 0 && p.body === 'shark' ? 0.8 : 1)]; },
    { ns: p.ns, nu: p.nu, cap0: true, cap1: true, col: (s, u) => bodyColour(p, s, u), anim: s => [s, 0, 0, 0], glow: glowAt });
  const finCol = hex(p.col.fin);
  const finAnim = (s, w = 1) => [s, w, 0, 0.6];
  // median fins along the top / bottom
  const median = (spec, top) => {
    if (!spec) return;
    const [s0, s1, hh] = spec, pts = [];
    const sm = (s0 + s1) / 2, [h0, , l0] = bodyProfile(p, sm);
    pts.push([0, l0 + (top ? 1 : -1) * h0 * 0.8, zOf(sm)]);
    const N = 8;
    for (let i = 0; i <= N; i++) {
      const s = lerp(s0, s1, i / N), [h, , l] = bodyProfile(p, s), y = l + (top ? 1 : -1) * h * 0.92;
      const e = Math.sin((i / N) * Math.PI) * 0.6 + 0.4 * (top ? 1 - i / N : i / N);
      pts.push([0, y + (top ? 1 : -1) * hh * e, zOf(s)]);
    }
    const [h1, , l1] = bodyProfile(p, s1); pts.push([0, l1 + (top ? 1 : -1) * h1 * 0.85, zOf(s1)]);
    const [ha, , la] = bodyProfile(p, s0); pts.push([0, la + (top ? 1 : -1) * ha * 0.85, zOf(s0)]);
    fin(B, pts, 0.003, { col: () => finCol, anim: (i, q) => finAnim(0.5 - q[2], 0.4) });
  };
  median(p.dorsal, true); median(p.dorsal2, true); median(p.anal, false);
  // caudal fin
  const cz = zOf(0.985), cH = p.caudalH;
  const tail = {
    forked: [[0, 0, cz + 0.03], [0, cH, cz - 0.11], [0, cH * 0.75, cz - 0.12], [0, 0.0, cz - 0.04], [0, -cH * 0.75, cz - 0.12], [0, -cH, cz - 0.11]],
    lunate: [[0, 0, cz + 0.02], [0, cH * 1.1, cz - 0.12], [0, cH * 0.5, cz - 0.07], [0, 0, cz - 0.05], [0, -cH * 0.5, cz - 0.07], [0, -cH * 1.1, cz - 0.12]],
    round: [[0, 0, cz + 0.03], [0, cH * 0.7, cz - 0.07], [0, cH * 0.4, cz - 0.12], [0, 0, cz - 0.13], [0, -cH * 0.4, cz - 0.12], [0, -cH * 0.7, cz - 0.07]],
    point: [[0, 0, cz + 0.06], [0, cH * 0.35, cz - 0.04], [0, 0, cz - 0.16], [0, -cH * 0.35, cz - 0.04]],
    hetero: [[0, 0.01, cz + 0.05], [0, cH * 1.2, cz - 0.16], [0, cH * 0.25, cz - 0.05], [0, -cH * 0.15, cz - 0.03], [0, -cH * 0.55, cz - 0.08]],
  }[p.caudal];
  if (tail) fin(B, tail, 0.004, { col: () => finCol, anim: (i, q) => [clamp(0.5 - q[2], 0.9, 1.15), 1, 0, 0.8] });
  // paired fins: pectorals behind the head, two-sided
  if (p.pect && p.pect[0] > 0) {
    const sz = p.pect[0], s = 0.24, [h, w, l] = bodyProfile(p, s);
    for (const sd of [1, -1]) {
      const b = [sd * w * 0.9, l - h * 0.25, zOf(s)];
      const pts = [b, [b[0] + sd * sz * 0.35, b[1] - sz * p.pect[1] * 0.5, b[2] - sz * 0.25], [b[0] + sd * sz * 0.8, b[1] - sz * p.pect[1], b[2] - sz * 0.75], [b[0] + sd * sz * 0.2, b[1] - sz * p.pect[1] * 0.4, b[2] - sz * 0.9], [b[0], b[1], b[2] - sz * 0.35]];
      fin(B, pts, 0.003, { col: () => finCol, anim: () => [s, 1, sd > 0 ? 0.25 : 0.75, 0.7] });
    }
  }
  // eyes
  if (p.eye > 0) {
    const s = p.body === 'globose' ? 0.12 : 0.08, [h, w, l] = bodyProfile(p, s), e = hex(p.col.eye);
    for (const sd of [1, -1]) blob(B, [sd * w * 0.82, l + h * 0.3, zOf(s)], [p.eye * 0.5, p.eye, p.eye], { nu: 8, nv: 5, col: () => e, anim: () => [s, 0, 0, 0] });
  }
  // an open jaw: a dark lower jaw plate under the snout (gulper, viperfish, angler)
  if (p.jaw > 0) {
    const s0 = 0.0, [h] = bodyProfile(p, 0.12), jl = p.jaw, jc = hex(p.col.mouth ?? 0x120608);
    const pts = [[0, -h * 0.2, zOf(0.18)], [h * 1.2, -h * 0.9, zOf(0.12)], [h * 0.6, -h * 1.4 - jl * 0.3, zOf(0.0) + jl * 0.2], [-h * 0.6, -h * 1.4 - jl * 0.3, zOf(0.0) + jl * 0.2], [-h * 1.2, -h * 0.9, zOf(0.12)]];
    fin(B, pts, 0.004, { col: () => jc, anim: () => [s0, 0.3, 0.5, 0.2] });
  }
  // the angler's lure and the viperfish barbel: a thin tube with a glowing tip
  const glowTip = (base, dir, L, c) => {
    const pts = []; for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push([base[0] + dir[0] * L * t, base[1] + dir[1] * L * t + Math.sin(t * 2.4) * L * 0.25, base[2] + dir[2] * L * t]); }
    tube(B, pts, () => 0.004, { nu: 4, col: () => hex(p.col.fin), anim: t => [0.05, t, 0.5, 1] });
    const g = hex(c), tip = pts[pts.length - 1];
    blob(B, tip, [0.018, 0.018, 0.018], { nu: 6, nv: 4, col: () => [0.9, 0.95, 1], anim: () => [0.05, 1, 0.5, 1], glow: () => [g[0] * 6, g[1] * 6, g[2] * 6] });
  };
  if (p.lure) { const [h, , l] = bodyProfile(p, 0.1); glowTip([0, l + h * 0.95, zOf(0.1)], [0, 0.6, 0.8], p.lure, p.lureColour ?? 0x60e0ff); }
  if (p.barbel) { const [h, , l] = bodyProfile(p, 0.06); glowTip([0, l - h, zOf(0.06)], [0, -0.85, 0.2], p.barbel, p.lureColour ?? 0x6080ff); }
  // a rostrum (swordfish)
  if (p.sword) { const [, , l] = bodyProfile(p, 0); tube(B, [[0, l, zOf(0) - 0.01], [0, l + 0.005, zOf(0) + p.sword]], t => 0.012 * (1 - t) + 0.002, { nu: 6, col: () => hex(p.col.back), anim: () => [0, 0, 0, 0] }); }
  // tripod fish stilts: the two pelvic rays and the lower caudal ray reach down
  if (p.rays) {
    const R = p.rays, c = hex(p.col.fin);
    for (const sd of [1, -1]) tube(B, [[sd * 0.02, -0.03, zOf(0.3)], [sd * 0.06, -R * 0.5, zOf(0.32)], [sd * 0.08, -R, zOf(0.3)]], () => 0.004, { nu: 4, col: () => c, anim: () => [0.3, 0.05, 0, 0] });
    tube(B, [[0, -0.01, zOf(0.97)], [0, -R * 0.5, zOf(1.05)], [0, -R, zOf(1.08)]], () => 0.004, { nu: 4, col: () => c, anim: () => [1, 0.05, 0, 0] });
    // the long pectoral rays held forward over the head (feeding antennae)
    for (const sd of [1, -1]) tube(B, [[sd * 0.03, 0.02, zOf(0.22)], [sd * 0.12, 0.12, zOf(0.0)], [sd * 0.2, 0.18, zOf(-0.25)]], () => 0.0025, { nu: 3, col: () => c, anim: t => [0.2, t, sd > 0 ? 0.25 : 0.75, 1] });
  }
  return B.mesh();
}

// A batoid (stingray, eagle ray): a flat disc of wings and a whip tail.
export function rayMesh(params = {}) {
  const p = Object.assign({ span: 0.95, disc: 0.55, thick: 0.05, tail: 0.9, pointed: 0.6, col: { back: 0x5a5040, belly: 0xe8e4dc, accent: 0x40a0ff, pattern: 'spots', n: 4, fin: 0x403830 } }, params);
  const B = builder(), back = hex(p.col.back), belly = hex(p.col.belly), acc = hex(p.col.accent);
  const D = p.disc, half = p.span / 2;
  // the disc as a grid in x (span) and z (length), two faces
  const NX = 18, NZ = 12;
  const outline = z => { const t = clamp((D / 2 - z) / D, 0, 1); const wing = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), p.pointed); return half * wing; };
  for (const side of [1, -1]) {
    const base = B.count;
    for (let j = 0; j <= NZ; j++) {
      const z = D / 2 - (j / NZ) * D, xe = outline(z);
      for (let i = 0; i <= NX; i++) {
        const u = i / NX * 2 - 1, x = u * xe, r = Math.abs(u);
        const yv = p.thick * (1 - r * r) * Math.cos(clamp((z) / (D / 2), -1, 1) * Math.PI / 2) * side * 0.5;
        let c = side > 0 ? back : belly;
        if (side > 0 && p.col.pattern === 'spots' && h2(Math.floor(x * 30), Math.floor(z * 30)) > 0.8) c = acc;
        B.v([x, yv, z], null, c, [0.5 - z / D * 0.5 + 0.25, r, 0, r], null);
      }
    }
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const a = base + j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
      if (side > 0) { B.t(a, b, c); B.t(b, d, c); } else { B.t(a, c, b); B.t(b, c, d); }
    }
  }
  // the tail whip
  const pts = []; for (let i = 0; i <= 10; i++) pts.push([0, 0, -D / 2 - (i / 10) * p.tail]);
  tube(B, pts, t => 0.012 * (1 - t) + 0.002, { nu: 5, col: () => hex(p.col.fin), anim: t => [0.75 + t * 0.25, 0.2, 0, 1] });
  // eyes on top
  for (const sd of [1, -1]) blob(B, [sd * 0.05, p.thick * 0.5, D * 0.3], [0.014, 0.012, 0.014], { nu: 6, nv: 4, col: () => [0.02, 0.02, 0.02], anim: () => [0.2, 0, 0, 0] });
  return B.mesh();
}

// A sea turtle: a domed carapace, a plastron, the head and four flippers.
export function turtleMesh(params = {}) {
  const p = Object.assign({ col: { back: 0x5b4a2e, scute: 0x7a6338, skin: 0x8a8060, belly: 0xd8c890 } }, params);
  const B = builder(), back = hex(p.col.back), scute = hex(p.col.scute), skin = hex(p.col.skin), belly = hex(p.col.belly);
  // carapace: an upper half ellipsoid with a scute pattern
  blob(B, [0, 0, 0], [0.3, 0.13, 0.42], { nu: 18, nv: 10, col: (q, n) => (n[1] < -0.1 ? belly : (h2(Math.floor(q[0] * 9), Math.floor(q[2] * 7)) > 0.5 ? back : scute)), anim: q => [0.5 - q[2], 0, 0, 0] });
  // head
  blob(B, [0, 0.01, 0.5], [0.075, 0.07, 0.11], { nu: 10, nv: 6, col: () => skin, anim: () => [0, 0, 0, 0] });
  for (const sd of [1, -1]) blob(B, [sd * 0.055, 0.03, 0.56], [0.012, 0.014, 0.014], { nu: 6, nv: 4, col: () => [0.03, 0.03, 0.02], anim: () => [0, 0, 0, 0] });
  // flippers: front long, back short; w = 1, phase per side
  const flip = (sd, z, L, W, ph) => {
    const b = [sd * 0.26, -0.01, z];
    fin(B, [b, [b[0] + sd * L * 0.4, b[1] + 0.01, b[2] + W * 0.6], [b[0] + sd * L, b[1] - 0.02, b[2] - W * 0.2], [b[0] + sd * L * 0.85, b[1] - 0.02, b[2] - W * 0.5], [b[0] + sd * 0.02, b[1], b[2] - W * 0.6]], 0.02,
      { col: () => skin, anim: (i, q) => [0.4, clamp(Math.abs(q[0] - b[0]) / L, 0, 1), ph, 0.8] });
  };
  flip(1, 0.22, 0.42, 0.16, 0.0); flip(-1, 0.22, 0.42, 0.16, 0.0);
  flip(1, -0.3, 0.16, 0.1, 0.5); flip(-1, -0.3, 0.16, 0.1, 0.5);
  return B.mesh();
}
