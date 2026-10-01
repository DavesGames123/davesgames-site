// ============================================================================
//  PROTEIN VIEWER  ·  cartoon.js — spline ribbons from the polymer backbone
// ────────────────────────────────────────────────────────────────────────────
//  No DOM and no THREE: it returns flat arrays that reps.js wraps.
//
//  For each unbroken polymer segment (parse.js segmentsOf):
//    guide point   CA (protein) or P (nucleic); strand CAs are averaged
//                  with their neighbours to take out the pleat
//    guide normal  the C=O direction made normal to the chain, flipped to
//                  agree with the previous one. A CA-only chain uses the
//                  cross product of the tangent and the CA bisector.
//    spline        uniform Catmull-Rom through the guide points, `sub`
//                  samples per residue
//    section       a superellipse |x/w|^p + |y/h|^p = 1, swept along the
//                  spline. x runs along the guide normal (the ribbon width)
//                        w     h     p
//                  coil  0.30  0.30  2   (a round tube)
//                  helix 1.40  0.24  4   (a flat ribbon, round edges)
//                  3-10  1.00  0.24  4
//                  strand 1.15 0.30  5, and an arrow on its last residue
//                  that tapers from 1.85 to the coil width
//                  nucleic 0.85 0.55 3
//    rungs         one per nucleotide, from the backbone to N1 (purines)
//                  or N3 (pyrimidines), for reps.js to draw as cylinders
//  Each vertex keeps its residue index (vres) so a colour change or a
//  highlight only rewrites the colour buffer.
//
//  grep: export function cartoonGeometry  const DIMS  function guide
// ============================================================================

const DIMS = { C: [0.3, 0.3, 2], H: [1.4, 0.24, 4], G: [1.0, 0.24, 4], E: [1.15, 0.3, 5], N: [0.85, 0.55, 3] };
const ARROW = 1.85;

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const smooth = t => t * t * (3 - 2 * t);

// any unit vector normal to t
const perp = t => norm3(Math.abs(t[0]) < 0.9 ? cross3(t, [1, 0, 0]) : cross3(t, [0, 1, 0]));

function guide(s, wpos, seg) {
  const R = seg.residues.map(i => s.residues[i]);
  const n = R.length;
  const at = i => [wpos[3 * i], wpos[3 * i + 1], wpos[3 * i + 2]];
  const P = R.map(r => at(r.ca));
  const ss = R.map(r => (seg.kind === 'nucleic' ? 'N' : r.ss === 'H' || r.ss === 'G' || r.ss === 'E' ? r.ss : 'C'));
  // a strand of one residue reads as noise; a helix needs three
  for (let k = 0; k < n; k++) {
    if (ss[k] === 'C' || ss[k] === 'N') continue;
    let j = k; while (j + 1 < n && ss[j + 1] === ss[k]) j++;
    if (j - k + 1 < (ss[k] === 'E' ? 2 : 3)) for (let q = k; q <= j; q++) ss[q] = 'C';
    k = j;
  }
  const T = P.map((p, k) => norm3(sub3(P[Math.min(n - 1, k + 1)], P[Math.max(0, k - 1)])));
  const O = [];
  for (let k = 0; k < n; k++) {
    const r = R[k];
    let o = null;
    if (seg.kind === 'protein' && r.map.C !== undefined && r.map.O !== undefined) o = sub3(at(r.map.O), at(r.map.C));
    else if (seg.kind === 'nucleic' && r.map["C1'"] !== undefined) o = cross3(T[k], sub3(at(r.map["C1'"]), P[k]));
    else if (k > 0 && k < n - 1) o = cross3(T[k], sub3(P[k], mul3(add3(P[k - 1], P[k + 1]), 0.5)));
    if (!o || Math.hypot(...o) < 1e-3) o = O.length ? O[O.length - 1] : perp(T[k]);
    o = sub3(o, mul3(T[k], dot3(o, T[k])));
    o = Math.hypot(...o) < 1e-4 ? perp(T[k]) : norm3(o);
    if (O.length && dot3(o, O[O.length - 1]) < 0) o = mul3(o, -1);
    O.push(o);
  }
  // take the pleat out of strands, and smooth the strand normals
  const Ps = P.map(p => p.slice());
  for (let k = 1; k < n - 1; k++) if (ss[k] === 'E' && ss[k - 1] === 'E' && ss[k + 1] === 'E') Ps[k] = add3(add3(mul3(P[k - 1], 0.25), mul3(P[k], 0.5)), mul3(P[k + 1], 0.25));
  for (let k = 1; k < n - 1; k++) if (ss[k] === 'E') O[k] = norm3(add3(add3(O[k - 1], mul3(O[k], 2)), O[k + 1]));
  return { R, P: Ps, O, ss, n };
}

export function cartoonGeometry(s, wpos, opts = {}) {
  const sub = opts.sub || 8, ring = opts.ring || 12;
  const show = opts.show || (() => true);
  const pos = [], nor = [], vres = [], idx = [];
  const rungs = [];
  for (const seg of s.segments) {
    if (seg.residues.length < 2 || !show(seg.residues[0])) continue;
    const g = guide(s, wpos, seg);
    const { P, O, ss, n, R } = g;
    const ext = k => (k < 0 ? sub3(mul3(P[0], 2), P[1]) : k >= n ? sub3(mul3(P[n - 1], 2), P[n - 2]) : P[k]);
    const rings = [];
    let prevN = null;
    const emit = (k, t, dims, rk) => {
      const p0 = ext(k - 1), p1 = ext(k), p2 = ext(k + 1), p3 = ext(k + 2);
      const t2 = t * t, t3 = t2 * t;
      const c = [0, 1, 2].map(a => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3));
      let T = norm3([0, 1, 2].map(a => 0.5 * ((-p0[a] + p2[a]) + 2 * (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t + 3 * (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t2)));
      const o0 = O[Math.min(n - 1, k)], o1 = O[Math.min(n - 1, k + 1)];
      const st = smooth(t);
      let N = add3(mul3(o0, 1 - st), mul3(o1, st));
      N = sub3(N, mul3(T, dot3(N, T)));
      N = Math.hypot(...N) < 1e-4 ? (prevN || perp(T)) : norm3(N);
      if (prevN && dot3(N, prevN) < 0) N = mul3(N, -1);
      prevN = N;
      const B = cross3(T, N);
      const [w, h, p] = dims;
      const e = 2 / p, base = pos.length / 3;
      for (let j = 0; j < ring; j++) {
        const a = (j / ring) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const x = w * Math.sign(ca) * Math.abs(ca) ** e, y = h * Math.sign(sa) * Math.abs(sa) ** e;
        const nx = Math.sign(ca) * Math.abs(ca) ** (2 - e) / w, ny = Math.sign(sa) * Math.abs(sa) ** (2 - e) / h;
        pos.push(c[0] + N[0] * x + B[0] * y, c[1] + N[1] * x + B[1] * y, c[2] + N[2] * x + B[2] * y);
        const m = norm3(add3(mul3(N, nx), mul3(B, ny)));
        nor.push(m[0], m[1], m[2]);
        vres.push(R[rk].index);
      }
      rings.push({ base, c, T, rk });
    };
    const lerpD = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    for (let k = 0; k < n - 1; k++) {
      const a = ss[k], b = ss[k + 1];
      const arrow = a === 'E' && b !== 'E';
      for (let j = 0; j < sub; j++) {
        const t = j / sub;
        const rk = t < 0.5 ? k : k + 1;
        let d;
        if (arrow) {
          if (j === 0) emit(k, 0, DIMS.E, k);
          d = lerpD([ARROW, DIMS.E[1], DIMS.E[2]], DIMS[b], smooth(t));
          d = [ARROW + (DIMS[b][0] - ARROW) * t, d[1], d[2]];
          emit(k, t, d, k);
          continue;
        }
        d = a === b ? DIMS[a] : lerpD(DIMS[a], DIMS[b], smooth(Math.min(1, Math.max(0, (t - 0.2) / 0.6))));
        emit(k, t, d, rk);
      }
    }
    emit(n - 2, 1, DIMS[ss[n - 1]], n - 1);
    // join the rings; a second ring at the same point (the arrow base)
    // makes a flat step
    for (let q = 0; q + 1 < rings.length; q++) {
      const A = rings[q].base, Bq = rings[q + 1].base;
      for (let j = 0; j < ring; j++) {
        const j1 = (j + 1) % ring;
        idx.push(A + j, Bq + j, Bq + j1, A + j, Bq + j1, A + j1);
      }
    }
    // caps
    for (const [r, sign] of [[rings[0], -1], [rings[rings.length - 1], 1]]) {
      const cb = pos.length / 3;
      const nT = mul3(r.T, sign);
      pos.push(r.c[0], r.c[1], r.c[2]); nor.push(nT[0], nT[1], nT[2]); vres.push(R[r.rk].index);
      const rb = pos.length / 3;
      for (let j = 0; j < ring; j++) {
        const v = r.base + j;
        pos.push(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]); nor.push(nT[0], nT[1], nT[2]); vres.push(R[r.rk].index);
      }
      for (let j = 0; j < ring; j++) {
        const j1 = (j + 1) % ring;
        if (sign < 0) idx.push(cb, rb + j1, rb + j); else idx.push(cb, rb + j, rb + j1);
      }
    }
    // nucleotide rungs
    if (seg.kind === 'nucleic') {
      for (let k = 0; k < n; k++) {
        const r = R[k];
        const far = r.map.N9 !== undefined && r.map.C8 !== undefined ? r.map.N1 : r.map.N3;
        if (far === undefined) continue;
        rungs.push({ from: P[k], to: [wpos[3 * far], wpos[3 * far + 1], wpos[3 * far + 2]], res: r.index });
      }
    }
  }
  return {
    position: new Float32Array(pos), normal: new Float32Array(nor), vres: new Int32Array(vres),
    index: pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), rungs,
  };
}
