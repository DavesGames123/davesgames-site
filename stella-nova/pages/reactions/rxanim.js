// ============================================================================
//  REACTIONS  ·  rxanim.js — the 3D change of one reaction step (no DOM)
// ----------------------------------------------------------------------------
//  makeScene(step) turns one step into a timeline of atom positions and
//  bond states. The view (rxview.js) draws it; tests.mjs checks it. It is
//  a schematic of the change, not a simulated trajectory: the page says so.
//
//  step = { inputs: [{ rec, G }], products: [{ rec, G, origin }], off,
//           names: [label of each product] }
//  Atom u of the scene is atom i of input k (u = off[k] + i). Each product
//  atom j comes from scene atom origin[j] (react.js), so every atom keeps
//  its identity from reactant to product.
//
//  GEOMETRY
//    end      the main product at its own conformer; each by-product is
//             fitted (Kabsch, no mirror) onto the places its atoms had
//    contact  each reactant, rigid, fitted onto the end places of its
//             atoms: the pose in which it meets the others
//    start    contact moved out along the line from the centre, so the
//             reactants come in and push against each other
//    flat     the skeletal formula of each reactant, face on, at its
//             start place: the draw-then-lift intro of the Molecule
//             Explorer (molecules/drawlift.js gives the timing)
//  TIMELINE (s)  intro (draw, hold, lift) | approach and push | stretch:
//    the reaction centre pulls toward the product | rearrange: every atom
//    eases from contact to end; old bonds snap, new bonds grow | the
//    by-products drift apart, labelled | the product turns (the view)
//  at(t) -> { pos (Float32Array 3U), alpha (per bond), order (per bond),
//    ink, morph, reveal (bonds drawn, intro only), phase, labels }
//
//  GREP MAP
//    grep -n 'export function makeScene'    geometry and bonds
//    grep -n 'export function fitRigid'     Kabsch / Horn fit
//    grep -n 'at(t)'                        the timeline
// ============================================================================
import { decode, placeHydrogens } from '../molecules/chem.js';
import { timingFor, drawLiftAt } from '../molecules/drawlift.js';

const FLAT = 1.45;               // angstrom per 2D bond length, as view3d.js
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

// ── rigid fit ───────────────────────────────────────────────────────────────
// The rotation R and shift that best map points A onto points B (Horn
// 1987, the same quaternion method as molecules/view3d.js hornRotation,
// written here without THREE). 1 point: shift only. 2 points: the
// shortest turn of the A segment onto the B segment.
export function fitRigid(A, B) {
  const n = A.length;
  const ca = [0, 0, 0], cb = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) { ca[d] += A[i][d] / n; cb[d] += B[i][d] / n; }
  let R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (n === 2) R = turnOnto(sub(A[1], A[0]), sub(B[1], B[0]));
  else if (n >= 3) {
    const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += (A[i][r] - ca[r]) * (B[i][c] - cb[c]);
    const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
    const N = [[xx + yy + zz, yz - zy, zx - xz, xy - yx], [yz - zy, xx - yy - zz, xy + yx, zx + xz],
      [zx - xz, xy + yx, -xx + yy - zz, yz + zy], [xy - yx, zx + xz, yz + zy, -xx - yy + zz]];
    const V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    for (let sweep = 0; sweep < 30; sweep++) {
      let off = 0;
      for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += N[p][q] * N[p][q];
      if (off < 1e-14) break;
      for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
        if (Math.abs(N[p][q]) < 1e-15) continue;
        const th = (N[q][q] - N[p][p]) / (2 * N[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 4; k++) { const a = N[k][p], b = N[k][q]; N[k][p] = c * a - s * b; N[k][q] = s * a + c * b; }
        for (let k = 0; k < 4; k++) { const a = N[p][k], b = N[q][k]; N[p][k] = c * a - s * b; N[q][k] = s * a + c * b; }
        for (let k = 0; k < 4; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = c * a - s * b; V[k][q] = s * a + c * b; }
      }
    }
    let best = 0; for (let k = 1; k < 4; k++) if (N[k][k] > N[best][best]) best = k;
    let [w, x, y, z] = [V[0][best], V[1][best], V[2][best], V[3][best]];
    const L = Math.hypot(w, x, y, z) || 1; w /= L; x /= L; y /= L; z /= L;
    R = [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
      [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
      [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]];
  }
  const t = sub(cb, mul(R, ca));
  return { R, t, apply: p => add(mul(R, p), t) };
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (R, p) => [R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2], R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2], R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2]];
function turnOnto(a, b) {
  const la = Math.hypot(...a) || 1, lb = Math.hypot(...b) || 1;
  const u = a.map(v => v / la), v = b.map(x => x / lb);
  const c = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  let k = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const s = Math.hypot(...k);
  if (s < 1e-9) return c > 0 ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : [[-1, 0, 0], [0, -1, 0], [0, 0, 1]];
  k = k.map(x => x / s);
  const [x, y, z] = k, C = 1 - c;
  return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]];
}

// ── scene ───────────────────────────────────────────────────────────────────
export function makeScene(step, opt = {}) {
  const ins = step.inputs, prods = step.products, off = step.off;
  const U = ins.reduce((s, x) => s + x.G.N, 0);
  const Ms = ins.map(x => decode(x.rec)), Ps = prods.map(p => decode(p.rec));
  const molOf = new Int32Array(U), idx = new Int32Array(U);
  ins.forEach((x, k) => { for (let i = 0; i < x.G.N; i++) { molOf[off[k] + i] = k; idx[off[k] + i] = i; } });
  const own = (M, i) => [M.xyz[3 * i], M.xyz[3 * i + 1], M.xyz[3 * i + 2]];
  const prodOf = new Int32Array(U).fill(-1), pidx = new Int32Array(U);
  prods.forEach((p, k) => p.origin.forEach((u, j) => { prodOf[u] = k; pidx[u] = j; }));

  // end: main product at its conformer, centred
  const end = new Array(U).fill(null), contact = new Array(U).fill(null);
  {
    const P = Ps[0], c = centroid(Array.from({ length: P.N }, (_, j) => own(P, j)));
    prods[0].origin.forEach((u, j) => { end[u] = sub(own(P, j), c); });
  }
  const placedIn = new Uint8Array(ins.length), placedP = new Uint8Array(prods.length); placedP[0] = 1;
  for (let round = 0; round < 6; round++) {
    let moved = false;
    ins.forEach((x, k) => {
      if (placedIn[k]) return;
      const A = [], B = [];
      for (let i = 0; i < x.G.N; i++) { const u = off[k] + i; if (end[u]) { A.push(own(Ms[k], i)); B.push(end[u]); } }
      if (!A.length) return;
      const f = fitRigid(A, B);
      for (let i = 0; i < x.G.N; i++) contact[off[k] + i] = f.apply(own(Ms[k], i));
      placedIn[k] = 1; moved = true;
    });
    prods.forEach((p, k) => {
      if (placedP[k]) return;
      const A = [], B = [];
      p.origin.forEach((u, j) => { if (contact[u]) { A.push(own(Ps[k], j)); B.push(contact[u]); } });
      if (!A.length) return;
      const f = fitRigid(A, B);
      p.origin.forEach((u, j) => { end[u] = f.apply(own(Ps[k], j)); });
      placedP[k] = 1; moved = true;
    });
    if (!moved) break;
  }
  // anything left (no shared atoms): beside the rest
  ins.forEach((x, k) => { if (!placedIn[k]) for (let i = 0; i < x.G.N; i++) contact[off[k] + i] = add(own(Ms[k], i), [6 + 3 * k, 0, 0]); });
  prods.forEach((p, k) => { if (!placedP[k]) p.origin.forEach((u, j) => { end[u] = add(own(Ps[k], j), [0, -6 - 3 * k, 0]); }); });

  // start: each reactant out along its line from the centre
  const all = contact.filter(Boolean), C0 = centroid(all);
  const nIn = ins.length, dirs = [], cen = [];
  ins.forEach((x, k) => {
    const pts = Array.from({ length: x.G.N }, (_, i) => contact[off[k] + i]), c = centroid(pts);
    let d = sub(c, C0); let L = Math.hypot(...d);
    if (L < 0.4) { const a = 2 * Math.PI * k / Math.max(1, nIn) + 0.3; d = [Math.cos(a), Math.sin(a) * 0.6, 0.35]; L = Math.hypot(...d); }
    d = d.map(v => v / L);
    let r = 0; for (const p of pts) r = Math.max(r, Math.hypot(...sub(p, c)));
    dirs.push(d); cen.push(c); x._r = r;
  });
  const gap = nIn > 1 ? 3.2 : 0;
  const shift = ins.map((x, k) => dirs[k].map(v => v * (gap + 0.6 * x._r)));
  // drift of the by-products, away from the main product
  const Pc = centroid(Array.from(prods[0].origin, u => end[u]));
  const drift = prods.map((p, k) => {
    if (k === 0) return [0, 0, 0];
    const c = centroid(Array.from(p.origin, u => end[u]));
    let d = sub(c, Pc), L = Math.hypot(...d);
    if (L < 0.5) { d = [Math.cos(k * 2.1), Math.sin(k * 2.1), 0.4]; L = Math.hypot(...d); }
    return d.map(v => v / L * (3.2 + 0.5 * k));
  });
  // flat: each reactant's drawing, face on (x right, y up), at its start
  const flat = new Array(U);
  ins.forEach((x, k) => {
    const M = Ms[k], h = placeHydrogens(M).xy;
    let cx = 0, cy = 0; for (let i = 0; i < M.N; i++) { cx += h[2 * i] / M.N; cy += h[2 * i + 1] / M.N; }
    const c = add(cen[k], shift[k]);
    for (let i = 0; i < M.N; i++) flat[off[k] + i] = [c[0] + (h[2 * i] - cx) * FLAT, c[1] - (h[2 * i + 1] - cy) * FLAT, c[2]];
  });

  // bonds: reactant bonds and product bonds in scene atoms
  const bmap = new Map();
  const put = (a, b, o, side) => {
    const k = a < b ? a * 1e6 + b : b * 1e6 + a;
    if (!bmap.has(k)) bmap.set(k, { a: Math.min(a, b), b: Math.max(a, b), oR: 0, oP: 0, arR: false, arP: false });
    const e = bmap.get(k);
    if (side === 'R') e.oR = o; else e.oP = o;
  };
  ins.forEach((x, k) => x.G.bonds.forEach(b => put(off[k] + b.a, off[k] + b.b, b.o, 'R')));
  prods.forEach(p => p.G.bonds.forEach(b => put(p.origin[b.a], p.origin[b.b], b.o, 'P')));
  const bonds = [...bmap.values()];
  for (const b of bonds) b.kind = !b.oP ? 'break' : !b.oR ? 'form' : b.oR !== b.oP ? 'change' : 'keep';
  const centre = new Uint8Array(U);
  for (const b of bonds) if (b.kind !== 'keep') { centre[b.a] = 1; centre[b.b] = 1; }
  ins.forEach((x, k) => { for (let i = 0; i < x.G.N; i++) { const u = off[k] + i, p = prodOf[u]; if (p >= 0 && prods[p].G.q[pidx[u]] !== x.G.q[i]) centre[u] = 1; } });
  // a hydrogen is part of the centre only when it moves between atoms
  const z = new Int16Array(U); ins.forEach((x, k) => { for (let i = 0; i < x.G.N; i++) z[off[k] + i] = x.G.z[i]; });

  // timeline
  const D = timingFor(opt.introDur ?? 6, true);
  const t0 = opt.intro === false ? 0 : D.draw + D.hold + D.lift;
  const tA = t0 + 1.5, tS = tA + 0.7, tR = tS + 1.8, tD = tR + 1.3, T = tD + (opt.turn ?? 2.5);
  const nbR = Ms.reduce((s, M) => s + M.nShown, 0);
  const tBreak = tS + 0.3 * (tR - tS), tForm = tS + 0.45 * (tR - tS);
  const pos = new Float32Array(3 * U), alpha = new Float32Array(bonds.length), order = new Float32Array(bonds.length);
  // bonds of the drawing, in draw order per reactant, for the intro reveal
  const drawIdx = new Int32Array(bonds.length).fill(-1);
  {
    let base = 0;
    ins.forEach((x, k) => {
      const M = Ms[k];
      M.bonds.forEach((b, j) => { if (j >= M.nShown) return; const a = off[k] + b.a, c = off[k] + b.b, kk = a < c ? a * 1e6 + c : c * 1e6 + a; const e = bmap.get(kk); if (e) drawIdx[bonds.indexOf(e)] = base + j; });
      base += M.nShown;
    });
  }
  const scene = {
    U, z, bonds, centre, molOf, prodOf, T, phases: { t0, tA, tS, tR, tD, tBreak, tForm }, end, contact,
    names: step.names || [],
    at(t) {
      let ink = 0, morph = 1, reveal = null, phase = 'turn';
      if (t < t0) {
        const st = drawLiftAt(t, nbR, D); ink = st.ink; morph = st.morph; reveal = st.reveal; phase = 'intro';
      } else if (t < tA) phase = 'approach'; else if (t < tS) phase = 'stretch'; else if (t < tR) phase = 'rearrange'; else if (t < tD) phase = 'drift';
      const ua = ease((t - t0) / (tA - t0));
      // the push: a short overshoot into contact, then back
      const push = t > tA - 0.5 && t < tS ? Math.sin(clamp((t - (tA - 0.5)) / (tS - tA + 0.5), 0, 1) * Math.PI) * 0.18 : 0;
      const wS = ease((t - tA) / (tS - tA)) * 0.22, wR = ease((t - tS) / (tR - tS)), wD = ease((t - tR) / (tD - tR));
      for (let u = 0; u < U; u++) {
        const k = molOf[u];
        const out = 1 - ua - push;
        let p = add(contact[u], shift[k].map(v => v * out));
        // flat drawing to 3D during the intro
        if (t < t0) { const s = add(contact[u], shift[k]); p = mixv(flat[u], s, ease(morph)); }
        const w = Math.max(centre[u] ? wS : 0, wR);
        if (w > 0) p = mixv(p, end[u], w);
        const pk = prodOf[u];
        if (pk > 0 && wD > 0) p = add(p, drift[pk].map(v => v * wD));
        pos[3 * u] = p[0]; pos[3 * u + 1] = p[1]; pos[3 * u + 2] = p[2];
      }
      bonds.forEach((b, i) => {
        let a = 1, o = b.oR || b.oP;
        if (b.kind === 'break') a = 1 - ease((t - tBreak) / 0.3);
        else if (b.kind === 'form') a = ease((t - tForm) / 0.6);
        else if (b.kind === 'change') o = t < tForm ? b.oR : b.oP;
        if (reveal != null) { const d = drawIdx[i]; a = d < 0 ? 0 : clamp(reveal - d, 0, 1); }
        alpha[i] = a; order[i] = o;
      });
      const labels = [];
      if (t >= tR - 0.3) prods.forEach((p, k) => {
        if (k === 0 && t < tD) return;
        const c = centroid(Array.from(p.origin, u => [pos[3 * u], pos[3 * u + 1], pos[3 * u + 2]]));
        labels.push({ text: (step.names || [])[k] || '', pos: c, alpha: ease((t - tR + 0.3) / 0.6), main: k === 0 });
      });
      return { pos, alpha, order, ink, morph, reveal, phase, labels };
    },
  };
  return scene;
}
const mixv = (a, b, w) => [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
function centroid(pts) { const c = [0, 0, 0]; for (const p of pts) { c[0] += p[0] / pts.length; c[1] += p[1] / pts.length; c[2] += p[2] / pts.length; } return c; }
