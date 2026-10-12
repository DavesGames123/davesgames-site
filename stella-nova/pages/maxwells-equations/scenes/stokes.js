// ============================================================================
//  MAXWELL'S EQUATIONS  ·  scenes/stokes.js — d, boundaries and Stokes
// ----------------------------------------------------------------------------
//  One map (geom.js stokesMap) of the unit cube onto a bent, twisted block.
//  Its edge v = w = 0 is a path, its face w = 0 is a sheet, the whole is a
//  solid. The scene cuts the region into n pieces per side and pulls them
//  apart (spread). Each piece shows its own boundary with orientation:
//    path   segments, with - at the start and + at the end
//    sheet  cells, each with a loop of arrows round it
//    solid  cells, each with outward arrows on its six faces
//  As the pieces close up, each inner boundary meets its neighbour's with
//  the opposite sign and both shrink away. Only the outer boundary stays.
//  This is the generalized Stokes theorem: int_R d(omega) = int_dR omega.
//
//  MODES
//    stokes   dim 1, 2 or 3 (P.dim); the scene morphs path -> sheet -> solid
//    dd       one cube: the boundaries of its six faces. Every edge comes
//             twice with opposite signs, so the boundary of a boundary is
//             empty (d d = 0).
//
//  GREP MAP   (grep -n "<anchor>" scenes/stokes.js)
//    "function pieces1"  "function pieces2"  "function pieces3"  "function piecesDD"
//    "function draw"     "readout()"         "const INT"
// ============================================================================
import { THREE, COL, lines, dots, arrows, setArrow, shellMat, rgb, ease, clamp } from '../kit.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import * as G from '../geom.js';

const M = G.stokesMap;
const PLUS = rgb(COL.S), MINUS = rgb('#c46f8a'), EDGE = rgb(COL.S);

// The integrals of the three cases on the full map (geom.js SAMPLE).
function integrals() {
  const S = G.SAMPLE;
  const path = s => M(s, 0, 0);
  const loop = s => { const q = 4 * s; if (q < 1) return M(q, 0, 0); if (q < 2) return M(1, q - 1, 0); if (q < 3) return M(3 - q, 1, 0); return M(0, 4 - q, 0); };
  const faces = [[(u, v) => M(1, u, v), 1], [(u, v) => M(0, u, v), -1], [(u, v) => M(v, 1, u), 1], [(u, v) => M(v, 0, u), -1], [(u, v) => M(u, v, 1), 1], [(u, v) => M(u, v, 0), -1]];
  return {
    d1: G.loopIntegral(S.df, path, 2048), b1: S.f(path(1)) - S.f(path(0)),
    d2: G.surfaceFlux(S.dalpha, (u, v) => M(u, v, 0), 96, 96), b2: G.loopIntegral(S.alpha, loop, 4096),
    d3: G.volumeIntegral(S.dbeta, M, 28), b3: faces.reduce((s, [P, sg]) => s + sg * G.surfaceFlux(S.beta, P, 72, 72), 0),
  };
}

export function build(ctx) {
  const root = new THREE.Group();
  const P = { mode: 'stokes', dim: 1, n: 4, spread: 1, auto: true };
  let dimT = 1, INT = null, clock = 0;

  const edgeLines = lines([], { color: '#ffffff', width: 2.6, colors: () => [1, 1, 1], additive: true });
  const ends = dots(512, { size: 11 });
  const arr = arrows(1200, { color: COL.S, emissive: 0.6 });
  const fillOut = new THREE.Mesh(new THREE.BufferGeometry(), shellMat({ color: COL.S, base: 0.1, rim: 0.35 }));
  const fillIn = new THREE.Mesh(new THREE.BufferGeometry(), shellMat({ color: COL.S, base: 0.1, rim: 0.35 }));
  // the whole region, faint, so the reader sees what the pieces fill
  const ghost = new THREE.Mesh(new THREE.BufferGeometry(), shellMat({ color: '#9fb3c8', base: 0.025, rim: 0.12 }));
  root.add(ghost, fillIn, fillOut, edgeLines, arr, ends);

  const lab = (html, fn, cls) => ctx.label(html, cls, () => (root.visible ? fn() : null));
  lab('<i>a</i>', () => (P.mode === 'stokes' && dimT < 1.4 ? G.add(M(0, 0, 0), [-0.12, 0, 0.18]) : null), 's');
  lab('<i>b</i>', () => (P.mode === 'stokes' && dimT < 1.4 ? G.add(M(1, 0, 0), [0.12, 0, 0.18]) : null), 's');
  lab('∂<i>S</i>', () => (P.mode === 'stokes' && dimT > 1.7 && dimT < 2.4 && P.spread < 0.3 ? G.add(M(1, 0.6, 0), [0.25, 0, 0.1]) : null), 's');
  lab('∂<i>V</i>', () => (P.mode === 'stokes' && dimT > 2.7 && P.spread < 0.3 ? G.add(M(1, 0.5, 1), [0.3, 0, 0.25]) : null), 's');

  // Shrink a point toward a piece centre.
  const shrink = (p, c, k) => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k, c[2] + (p[2] - c[2]) * k];
  const seg = (f, n = 8) => Array.from({ length: n + 1 }, (_, i) => f(i / n));

  // A frame's drawing lists.
  let L, Cn, D, A, Tout, Tin;
  function reset() { L = []; Cn = []; D = []; A = []; Tout = []; Tin = []; }
  // a polyline with one colour (rgb * alpha, additive)
  const addLine = (pts, col, a) => { L.push(pts); Cn.push(col.map(x => x * a)); };
  // a quad patch from a 2D param f(s,t) into a triangle list
  function patch(list, f, m = 3) {
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
      const a = f(i / m, j / m), b = f((i + 1) / m, j / m), c = f((i + 1) / m, (j + 1) / m), d = f(i / m, (j + 1) / m);
      list.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  // an arrow: position, direction, length, colour, scale
  const addArrow = (p, v, l, col, s = 1) => A.push([p, v, l * s, col, s]);

  // ── dim 1: the path in segments ─────────────────────────────────────────
  function pieces1(w, k, n) {
    if (w <= 0.01) return;
    for (let i = 0; i < n; i++) {
      const u0 = i / n, u1 = (i + 1) / n, c = M((u0 + u1) / 2, 0, 0);
      const pts = seg(t => shrink(M(u0 + (u1 - u0) * t, 0, 0), c, k));
      addLine(pts, EDGE, w);
      const inner0 = i > 0, inner1 = i < n - 1;
      const fa = inner0 ? P.spread : 1, fb = inner1 ? P.spread : 1;
      D.push([pts[0], MINUS, w * fa, 1.0]);
      D.push([pts[pts.length - 1], PLUS, w * fb, 1.15]);
      const mid = pts[4], tan = G.sub(pts[5], pts[3]);
      addArrow(mid, tan, 0.16, EDGE, 1);
    }
  }
  // ── dim 2: the sheet in cells with oriented loops ───────────────────────
  function pieces2(w, k, n, ext) {
    if (w <= 0.01) return;
    const m = n;
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const u0 = i / n, u1 = (i + 1) / n, v0 = j / m * ext, v1 = (j + 1) / m * ext;
      const c = M((u0 + u1) / 2, (v0 + v1) / 2, 0);
      const f = (u, v) => shrink(M(u, v, 0), c, k);
      const sides = [
        [t => f(u0 + (u1 - u0) * t, v0), j > 0],
        [t => f(u1, v0 + (v1 - v0) * t), i < n - 1],
        [t => f(u1 - (u1 - u0) * t, v1), j < m - 1],
        [t => f(u0, v1 - (v1 - v0) * t), i > 0],
      ];
      for (const [g, inner] of sides) {
        const a = inner ? P.spread : 1;
        addLine(seg(g, 6), EDGE, w * (inner ? 0.25 + 0.75 * a : 1));
        const p = g(0.5), tan = G.sub(g(0.6), g(0.4));
        addArrow(p, tan, 0.13, EDGE, inner ? Math.pow(a, 0.8) : 1);
      }
      patch(Tout, (s, t) => f(u0 + (u1 - u0) * s, v0 + (v1 - v0) * t), 2);
    }
  }
  // ── dim 3: the solid in cells with outward face arrows ──────────────────
  function pieces3(w, k, n, ext) {
    if (w <= 0.01) return;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let l = 0; l < n; l++) {
      const U = [i / n, (i + 1) / n], V = [j / n, (j + 1) / n], W = [l / n * ext, (l + 1) / n * ext];
      const c = M((U[0] + U[1]) / 2, (V[0] + V[1]) / 2, (W[0] + W[1]) / 2);
      const f = (u, v, x) => shrink(M(u, v, x), c, k);
      const faces = [
        [(s, t) => f(U[0], V[0] + (V[1] - V[0]) * s, W[0] + (W[1] - W[0]) * t), i > 0],
        [(s, t) => f(U[1], V[0] + (V[1] - V[0]) * s, W[0] + (W[1] - W[0]) * t), i < n - 1],
        [(s, t) => f(U[0] + (U[1] - U[0]) * s, V[0], W[0] + (W[1] - W[0]) * t), j > 0],
        [(s, t) => f(U[0] + (U[1] - U[0]) * s, V[1], W[0] + (W[1] - W[0]) * t), j < n - 1],
        [(s, t) => f(U[0] + (U[1] - U[0]) * s, V[0] + (V[1] - V[0]) * t, W[0]), l > 0],
        [(s, t) => f(U[0] + (U[1] - U[0]) * s, V[0] + (V[1] - V[0]) * t, W[1]), l < n - 1],
      ];
      for (const [g, inner] of faces) {
        const a = inner ? P.spread : 1;
        if (!inner || a > 0.02) patch(inner ? Tin : Tout, g, 2);
        const fc = g(0.5, 0.5), nrm = G.sub(fc, c);
        addArrow(fc, nrm, 0.15, EDGE, inner ? Math.pow(a, 0.8) : 1);
        if (!inner) addLine([g(0, 0), g(1, 0), g(1, 1), g(0, 1), g(0, 0)], EDGE, w * 0.55);
      }
    }
  }
  // ── d d = 0: the six faces of one cube and their boundary loops ─────────
  const cube = (u, v, w) => { const p = [-0.8 + 1.6 * u, -0.8 + 1.6 * v, -0.8 + 1.6 * w]; return [p[0] + 0.18 * p[2], p[1] + 0.1 * p[0], p[2] + 0.12 * Math.sin(2 * p[0])]; };
  function piecesDD() {
    const c = cube(0.5, 0.5, 0.5);
    // each face: param (s,t) with the outward orientation, its boundary loop
    const F = [
      (s, t) => cube(1, s, t), (s, t) => cube(0, t, s),
      (s, t) => cube(t, 1, s), (s, t) => cube(s, 0, t),
      (s, t) => cube(s, t, 1), (s, t) => cube(t, s, 0),
    ];
    const pull = 0.55 * P.spread;
    for (const g of F) {
      const fc = g(0.5, 0.5), out = G.mul(G.unit(G.sub(fc, c)), pull);
      const h = (s, t) => G.add(shrink(g(s, t), fc, 0.9 + 0.1 * (1 - P.spread)), out);
      patch(Tout, h, 3);
      const sides = [t => h(t, 0), t => h(1, t), t => h(1 - t, 1), t => h(0, 1 - t)];
      for (const q of sides) {
        addLine(seg(q, 6), EDGE, 0.15 + 0.85 * P.spread);
        addArrow(q(0.5), G.sub(q(0.6), q(0.4)), 0.15, EDGE, Math.pow(P.spread, 0.8));
      }
    }
  }

  function draw() {
    reset();
    const k = 1 - 0.32 * P.spread, n = P.mode === 'dd' ? 1 : P.n;
    if (P.mode === 'dd') piecesDD();
    else {
      const e2 = ease(clamp(dimT - 1, 0, 1)), e3 = ease(clamp(dimT - 2, 0, 1));
      const w1 = 1 - ease(clamp((dimT - 1) / 0.45, 0, 1));
      const w2 = ease(clamp((dimT - 1.15) / 0.45, 0, 1)) * (1 - ease(clamp((dimT - 2.05) / 0.4, 0, 1)));
      const w3 = ease(clamp((dimT - 2.15) / 0.45, 0, 1));
      pieces1(w1, k, n);
      pieces2(w2, k, n, Math.max(0.04, e2));
      pieces3(w3, k, n, Math.max(0.04, e3));
      fillOut.material.uniforms.uOpacity.value = Math.max(w2, w3);
      // ghost: the region at its present size
      const gl = [];
      if (dimT > 1.05) patch(gl, (u, v) => M(u, v * Math.max(0.04, e2), 0), 12);
      if (dimT > 2.05) { const ex = Math.max(0.04, e3); patch(gl, (u, v) => M(u, v, ex), 12); patch(gl, (u, w) => M(u, 0, w * ex), 12); patch(gl, (u, w) => M(u, 1, w * ex), 12); patch(gl, (v, w) => M(0, v, w * ex), 6); patch(gl, (v, w) => M(1, v, w * ex), 6); }
      setTri(ghost, gl);
    }
    fillIn.material.uniforms.uOpacity.value = P.spread;
    // lines
    if (L.length) {
      const pos = [], col = [];
      L.forEach((pts, li) => { for (let i = 0; i < pts.length - 1; i++) { pos.push(...pts[i], ...pts[i + 1]); col.push(...Cn[li], ...Cn[li]); } });
      edgeLines.visible = true;
      edgeLines.geometry.dispose();
      const g = new LineSegmentsGeometry();
      g.setPositions(pos); g.setColors(col);
      edgeLines.geometry = g;
    } else edgeLines.visible = false;
    // dots
    D.forEach(([p, c, a, s], i) => ends.setDot(i, p, c, a, s));
    ends.commit(D.length);
    // arrows
    A.forEach(([p, v, l], i) => setArrow(arr, i, p, v, l, 0.9));
    arr.count = A.length;
    arr.instanceMatrix.needsUpdate = true;
    setTri(fillOut, Tout);
    setTri(fillIn, Tin);
  }
  function setTri(mesh, list) {
    const g = mesh.geometry;
    const a = g.getAttribute('position');
    if (!a || a.array.length < list.length) {
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(list.length, 9) * 2), 3));
    }
    g.getAttribute('position').array.set(list);
    g.getAttribute('position').needsUpdate = true;
    g.setDrawRange(0, list.length / 3);
    g.computeVertexNormals();
    mesh.visible = list.length > 0;
  }

  // auto: pieces close up, hold, open again
  function autoSpread(t) {
    const T = 9, x = t % T;
    if (x < 1.2) return 1;
    if (x < 4.2) return 1 - ease((x - 1.2) / 3);
    if (x < 6.8) return 0;
    return ease((x - 6.8) / 2.2);
  }

  const api = {
    group: root, P,
    enter(mode, params = {}) {
      Object.assign(P, params, { mode });
      if (mode === 'dd') dimT = 3;
      clock = 0;
      if (mode === 'stokes' && !INT) INT = integrals();
    },
    set(key, v) { P[key] = key === 'n' ? Math.round(v) : v; },
    update(dt) {
      clock += dt;
      if (P.mode === 'stokes') {
        const goal = P.dim;
        dimT += clamp(goal - dimT, -dt * 0.9, dt * 0.9);
      }
      if (P.auto) P.spread = autoSpread(clock);
      draw();
    },
    readout() {
      const f = v => v.toFixed(3), n = P.n;
      if (P.mode === 'dd') return [['faces of the cube', '6', 'm3'], ['edges in their boundaries', '24 = 12 × 2', 'm3'], ['each edge, summed with signs', '+1 − 1 = 0', 'm3'], ['∂∂(cube)', 'empty', 'm3']];
      if (!INT) return [];
      const d = Math.round(dimT);
      if (d <= 1) return [['pieces', `${n} segments`, 'm3'], ['inner ends that cancel', `${n - 1} pairs`, 'm3'], ['∫ df along the path', f(INT.d1), 'm3'], ['f(b) − f(a)', f(INT.b1), 'm3']];
      if (d === 2) return [['pieces', `${n * n} cells`, 'm3'], ['inner edges that cancel', `${2 * n * (n - 1)} pairs`, 'm3'], ['∫ dα over the sheet', f(INT.d2), 'm3'], ['∮ α round its edge', f(INT.b2), 'm3']];
      return [['pieces', `${n ** 3} cells`, 'm3'], ['inner faces that cancel', `${3 * n * n * (n - 1)} pairs`, 'm3'], ['∫ dβ over the solid', f(INT.d3), 'm3'], ['∯ β over its surface', f(INT.b3), 'm3']];
    },
    anchor() { return { c: [0, 0, 0], r: 2.0 }; },
  };
  return api;
}
