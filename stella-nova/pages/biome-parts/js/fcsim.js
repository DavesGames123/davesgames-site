// ============================================================================
//  BIOME PARTS  ·  fcsim.js — a FreeCAD PartDesign session, without FreeCAD
// ----------------------------------------------------------------------------
//  PURE. Taiga-S1 reads a State that freecad_s1/runtime/session.py extracts
//  from a live FreeCAD document. FreeCAD does not run in a browser, so this
//  module keeps the same records itself: the document objects in creation
//  order, the sketches with their geometry and constraints, the body tip,
//  the selection, the undo stack, the recent actions, and the solid.
//
//  WHAT IS PORTED LINE FOR LINE (session.py, expert.py)
//    executors (ex_*), the constraint slots and their groups, the undo
//    entries and the 20-transaction limit, the "dirty" off-plan counter,
//    snapshot() field by field, describe_selection, the expert policy.
//  WHAT IS MODELLED (OpenCASCADE is not here)
//    the solid. A feature adds an op to a CSG tape (part.js draws the same
//    tape as a distance field). Face and edge counts, volumes, the largest
//    face in a direction and its outer wire come from per-op topology rules
//    (analyze), not from a B-rep. tests.mjs checks the rules on simple
//    cases; the closed-loop eval shows whether the model accepts the states.
//
//  FRAMES. FreeCAD axes, millimetres. A sketch frame is { o, u, v, n }:
//    XY_Plane  u = X, v = Y, n = +Z
//    XZ_Plane  u = X, v = Z, n = -Y   (x cross z; FreeCAD 1.x front view)
//    YZ_Plane  u = Y, v = Z, n = +X
//    a face    the face plane; for +Z faces u = X, v = Y
//
//  GREP MAP
//    class Session ........ reset / state / validActions / expert / step
//    ex* .................. the command executors
//    snapshot ............. Session -> State (session.snapshot)
//    expertActions ........ expert.expert_actions
//    analyze .............. ops -> faces, edges, volume, bbox (the topology)
//    buildTarget .......... the clean expert run that fills goal.target
//    rollout .............. one closed-loop episode (rollout.run_episodes)
// ============================================================================
import { SOLID_FEATURE_TYPES, CONSTRAINT_KINDS, RECENT_ACTIONS, enumerateActions } from './vocab.js';
import { RECIPES, PD, planLength, intent, profileBox, padLength, pocketSpec, holeDiameter, dressupValue, patternSpec } from './goals.js';

export const UNDO_LIMIT = 20;
const TREE_TYPES = new Set(['PartDesign::Body', 'Sketcher::SketchObject', 'Part::Box', 'Part::Cylinder', ...SOLID_FEATURE_TYPES]);
const GEO_PARAMS = { line: 4, circle: 3, point: 2 };
const CONSTRAINT_DOF = { Coincident: 2, Symmetric: 2, Block: 3 };
const CONSTRAINT_SLOTS = {
  Sketcher_ConstrainDistanceX: ['dx', ['rect', 'line']],
  Sketcher_ConstrainDistanceY: ['dy', ['rect', 'line']],
  Sketcher_ConstrainDiameter: ['size', ['circle', 'hex']],
  Sketcher_ConstrainRadius: ['size', ['circle', 'hex']],
  Sketcher_ConstrainLock: ['lock', ['rect', 'circle', 'hex', 'line', 'point']],
  Sketcher_ConstrainHorizontal: ['orient', ['hex', 'line']],
  Sketcher_ConstrainVertical: ['orient', ['line']],
};
const TYPE_OF = {
  PartDesign_Pad: 'PartDesign::Pad', PartDesign_Pocket: 'PartDesign::Pocket', PartDesign_Revolution: 'PartDesign::Revolution',
  PartDesign_Groove: 'PartDesign::Groove', PartDesign_Hole: 'PartDesign::Hole', PartDesign_Fillet: 'PartDesign::Fillet',
  PartDesign_Chamfer: 'PartDesign::Chamfer', PartDesign_Thickness: 'PartDesign::Thickness', PartDesign_Draft: 'PartDesign::Draft',
  PartDesign_Mirrored: 'PartDesign::Mirrored', PartDesign_LinearPattern: 'PartDesign::LinearPattern', PartDesign_PolarPattern: 'PartDesign::PolarPattern',
};
const ADDSUB = new Set(['PartDesign::Pad', 'PartDesign::Pocket', 'PartDesign::Revolution', 'PartDesign::Groove', 'PartDesign::Hole']);
const clone = x => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));
class ActionError extends Error {}
const need = (c, m) => { if (!c) throw new ActionError(m); };

// vectors
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const AX = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const dirVec = d => mul(AX[d[1]], d[0] === '+' ? 1 : -1);
// Name of an axis-aligned unit vector ('+Z'), or null.
function dirName(v) {
  for (const [k, a] of Object.entries(AX)) { const c = dot(v, a); if (Math.abs(Math.abs(c) - 1) < 1e-9) return (c > 0 ? '+' : '-') + k; }
  return null;
}
export const PLANE_FRAMES = {
  XY: { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  XZ: { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] },
  YZ: { o: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] },
};
// Frame of a face with outward normal d at offset off (FlatFace attachment).
function faceFrame(d, off) {
  const n = dirVec(d);
  const FR = { '+Z': [[1, 0, 0], [0, 1, 0]], '-Z': [[1, 0, 0], [0, -1, 0]], '+X': [[0, 1, 0], [0, 0, 1]], '-X': [[0, -1, 0], [0, 0, 1]],
    '+Y': [[-1, 0, 0], [0, 0, 1]], '-Y': [[1, 0, 0], [0, 0, 1]] }[d];
  return { o: mul(n, off), u: FR[0], v: FR[1], n };
}
const toGlobal = (F, lu, lv, ln = 0) => add(add(add(F.o, mul(F.u, lu)), mul(F.v, lv)), mul(F.n, ln));
const toLocal = (F, p) => { const q = [p[0] - F.o[0], p[1] - F.o[1], p[2] - F.o[2]]; return [dot(q, F.u), dot(q, F.v), dot(q, F.n)]; };

// ── profiles: closed shapes of a sketch (construction geometry left out) ───
// rect group -> { kind: 'rect', cu, cv, a, b }, circle -> 'circle' (a = r),
// hex -> 'hex' (a = corner radius). Lines and points make no closed shape.
function sketchProfiles(sk) {
  const out = [];
  for (const g of sk.groups) {
    const geos = g.geo.map(i => sk.geos[i]);
    if (g.kind === 'rect' && geos.every(x => !x.construction)) {
      const xs = geos.flatMap(x => [x.p1[0], x.p2[0]]), ys = geos.flatMap(x => [x.p1[1], x.p2[1]]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      out.push({ kind: 'rect', cu: (x0 + x1) / 2, cv: (y0 + y1) / 2, a: (x1 - x0) / 2, b: (y1 - y0) / 2 });
    } else if (g.kind === 'circle' && !geos[0].construction) {
      out.push({ kind: 'circle', cu: geos[0].c[0], cv: geos[0].c[1], a: geos[0].r, b: geos[0].r });
    } else if (g.kind === 'hex') {
      const lines = geos.filter(x => x.kind === 'line');
      const circ = geos.find(x => x.kind === 'circle');
      if (lines.every(x => !x.construction)) out.push({ kind: 'hex', cu: circ.c[0], cv: circ.c[1], a: circ.r, b: circ.r });
      if (!circ.construction) out.push({ kind: 'circle', cu: circ.c[0], cv: circ.c[1], a: circ.r, b: circ.r });
    }
  }
  return out;
}
export function profArea(p) {
  if (p.kind === 'rect') return 4 * p.a * p.b;
  if (p.kind === 'circle') return Math.PI * p.a * p.a;
  return 1.5 * Math.sqrt(3) * p.a * p.a;
}
function profPerimeter(p) {
  if (p.kind === 'rect') return 4 * (p.a + p.b);
  if (p.kind === 'circle') return 2 * Math.PI * p.a;
  return 6 * p.a;
}
const profEdges = p => (p.kind === 'rect' ? 4 : p.kind === 'hex' ? 6 : 1);
// Directions (sketch-local, u/v) of the straight edges of a profile.
function profLineDirs(p) {
  if (p.kind === 'rect') return [[1, 0], [0, 1], [1, 0], [0, 1]];
  if (p.kind === 'hex') return [0, 60, 120, 0, 60, 120].map(a => [Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)]);
  return [];
}
// Outward normals (u/v) of the flat side faces and their widths.
function profSides(p) {
  if (p.kind === 'rect') return [[[1, 0], 2 * p.b, p.a], [[-1, 0], 2 * p.b, p.a], [[0, 1], 2 * p.a, p.b], [[0, -1], 2 * p.a, p.b]];
  if (p.kind === 'hex') {
    const ap = p.a * Math.cos(Math.PI / 6);
    return [90, 150, 210, 270, 330, 30].map(a => [[Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)], p.a, ap]);
  }
  return [];
}
// Is the local point (lu, lv) inside the profile?
function inProfile(p, lu, lv) {
  const x = lu - p.cu, y = lv - p.cv;
  if (p.kind === 'rect') return Math.abs(x) <= p.a + 1e-9 && Math.abs(y) <= p.b + 1e-9;
  if (p.kind === 'circle') return x * x + y * y <= p.a * p.a + 1e-9;
  const ap = p.a * Math.cos(Math.PI / 6);
  return profSides(p).every(([nn]) => nn[0] * x + nn[1] * y <= ap + 1e-9);
}

// ── pattern instances: the global transforms of an op's copies ─────────────
export function instances(op) {
  const I = [x => x];
  const P = op.pat;
  if (!P) return I;
  if (P.kind === 'mirror') return [x => x, x => [-x[0], x[1], x[2]]];
  const out = [];
  for (let k = 0; k < P.n; k++) {
    if (P.kind === 'polar') { const a = 2 * Math.PI * k / P.n, c = Math.cos(a), s = Math.sin(a); out.push(x => [c * x[0] - s * x[1], s * x[0] + c * x[1], x[2]]); }
    else out.push(x => [x[0] + k * P.step, x[1], x[2]]);
  }
  return out;
}
const nCopies = op => (!op.pat ? 1 : op.pat.kind === 'mirror' ? 2 : op.pat.n);

// ── analyze: the topology and measures of a tape ───────────────────────────
// Returns { valid, empty, F, E, vol, bbox [min, max], faces, vEdges, nSolids }.
// faces: planar faces with an axis-aligned normal: { dir, area, off, owner,
// cap, edges: [{ d: [x,y,z] | null }] }. vEdges: straight vertical edges
// ({ cz, seam }).
export function analyze(ops) {
  const R = { valid: true, empty: true, F: 0, E: 0, vol: 0, bbox: [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]], faces: [], vEdges: [], nSolids: 0, adds: [] };
  if (!ops.length) return R;
  const grow = p => { for (let i = 0; i < 3; i++) { R.bbox[0][i] = Math.min(R.bbox[0][i], p[i]); R.bbox[1][i] = Math.max(R.bbox[1][i], p[i]); } };
  const addFace = f => { R.faces.push(f); return f; };
  const findFace = (dir, off) => {
    let best = null;
    for (const f of R.faces) if (f.dir === dir && Math.abs(f.off - off) < 1e-6 && (!best || f.area > best.area)) best = f;
    return best;
  };
  // material column at a global point along global axis a (only Z-axis
  // prisms and revolves are counted): list of [lo, hi] intervals.
  const column = (pt, axisVec) => {
    const out = [];
    for (const A of R.adds) {
      if (A.geom === 'prism' && Math.abs(Math.abs(dot(A.F.n, axisVec)) - 1) < 1e-9) {
        const l = toLocal(A.F, pt);
        if (inProfile(A.p, l[0], l[1])) { const s = dot(A.F.n, axisVec); const lo = dot(A.F.o, axisVec) + s * (s > 0 ? A.z0 : A.z1), hi = dot(A.F.o, axisVec) + s * (s > 0 ? A.z1 : A.z0); out.push([lo, hi]); }
      } else if (A.geom === 'revolve' && Math.abs(Math.abs(dot(A.F.v, axisVec)) - 1) < 1e-9) {
        const l = toLocal(A.F, pt), r = Math.hypot(l[0], l[2]);
        if (A.p.kind === 'rect' && r >= A.p.cu - A.p.a - 1e-9 && r <= A.p.cu + A.p.a + 1e-9) out.push([A.p.cv - A.p.b, A.p.cv + A.p.b]);
      }
    }
    return out;
  };
  let base = null;
  for (let oi = 0; oi < ops.length; oi++) {
    const op = ops[oi];
    if (op.type === 'shell') {
      if (!base) { R.valid = false; continue; }
      const t = op.t, p = base.p;
      const h = base.z1 - base.z0;
      let inner;
      if (base.geom === 'revolve') inner = Math.PI * (Math.max(0, (p.cu + p.a - t)) ** 2 - (p.cu - p.a + t) ** 2) * (2 * p.b - t);
      else if (p.kind === 'rect') inner = Math.max(0, 2 * p.a - 2 * t) * Math.max(0, 2 * p.b - 2 * t) * Math.max(0, h - t);
      else if (p.kind === 'circle') inner = Math.PI * Math.max(0, p.a - t) ** 2 * Math.max(0, h - t);
      else inner = 1.5 * Math.sqrt(3) * Math.max(0, p.a - t / Math.cos(Math.PI / 6)) ** 2 * Math.max(0, h - t);
      if (inner <= 0 || t * 2 >= Math.min(p.a, p.b) * 2 || t >= h) { R.valid = false; continue; }
      R.vol -= inner; R.F = 2 * R.F - 1; R.E = 2 * R.E;
      const top = R.faces.filter(f => f.dir === op.dir).sort((a, b) => b.area - a.area)[0];
      if (top) { top.area = Math.max(0, top.area - inner / Math.max(h - t, 1e-6)); addFace({ dir: op.dir, area: inner / Math.max(h - t, 1e-6), off: top.off - h + t, owner: oi, cap: false, edges: top.edges.slice() }); }
      continue;
    }
    const p = op.p, F = op.F, nC = nCopies(op), inst = instances(op);
    if (op.geom === 'revolve') {
      // the profile in (radius = u, height = v) about the v axis
      const r0 = Math.max(0, p.cu - p.a), r1 = p.cu + p.a, z0 = p.cv - p.b, z1 = p.cv + p.b;
      if (p.kind !== 'rect') { R.valid = R.valid && true; }
      const vol = p.kind === 'rect' ? Math.PI * (r1 * r1 - r0 * r0) * (z1 - z0) : 2 * Math.PI * Math.abs(p.cu) * profArea(p);
      if (op.type === 'add') {
        R.adds.push(op); R.vol += vol; R.empty = false;
        if (!base) { base = op; R.nSolids = 1; }
        R.F += p.kind === 'rect' ? (r0 > 0 ? 4 : 3) : profEdges(p); R.E += p.kind === 'rect' ? (r0 > 0 ? 8 : 5) : 2 * profEdges(p);
        for (const k of [-1, 1]) for (const z of [z0, z1]) { grow(toGlobal(F, r1 * k, z)); grow(toGlobal(F, 0, z, r1 * k)); }
        if (p.kind === 'rect') {
          const vd = dirName(F.v);
          const area = Math.PI * (r1 * r1 - r0 * r0);
          const fTop = addFace({ dir: vd, area, off: dot(F.o, F.v) + z1, owner: oi, cap: true, edges: [{ d: null }] });
          addFace({ dir: dirName(mul(F.v, -1)), area, off: -(dot(F.o, F.v) + z0), owner: oi, cap: true, edges: [{ d: null }] });
          if (op.rTop > 0 || op.chTop > 0) { const r = op.rTop || op.chTop; R.F += 1; R.E += 1; R.vol -= 2 * Math.PI * r1 * r * r * (op.rTop ? 1 - Math.PI / 4 : 0.5); fTop.area = Math.PI * ((r1 - r) ** 2 - r0 * r0); }
          if (dirName(F.v) === '+Z' || dirName(F.v) === '-Z') { R.vEdges.push({ cz: (z0 + z1) / 2, seam: true }); if (r0 > 0) R.vEdges.push({ cz: (z0 + z1) / 2, seam: true }); }
        }
      } else {
        const col = column(toGlobal(F, 0, p.cv), F.v);
        if (!col.length) continue;
        R.vol -= vol * 0.9; R.F += 2; R.E += 4;
      }
      continue;
    }
    // prisms
    const fp = profArea(p), ne = profEdges(p), sides = p.kind === 'circle' ? 1 : ne;
    if (op.type === 'add') {
      const hgt = op.z1 - op.z0;
      let firstCopy = true;
      for (const T of inst) {
        const ctr = T(toGlobal(F, p.cu, p.cv, op.z0));
        const nD = dirName(F.n), bottomOff = dot(ctr, F.n);
        let attached = null;
        if (base) {
          attached = findFace(nD, bottomOff);
          if (!attached) {
            // overlap with the solid's box, else a second solid
            const lo = T(toGlobal(F, p.cu - p.a, p.cv - p.b, op.z0)), hi = T(toGlobal(F, p.cu + p.a, p.cv + p.b, op.z1));
            const over = [0, 1, 2].every(i => Math.min(lo[i], hi[i]) <= R.bbox[1][i] + 1e-6 && Math.max(lo[i], hi[i]) >= R.bbox[0][i] - 1e-6);
            if (!over) R.nSolids++;
          }
        }
        if (!base) { R.F += 2 + sides; R.E += p.kind === 'circle' ? 3 : 3 * ne; R.nSolids = 1; }
        else { R.F += 1 + sides; R.E += p.kind === 'circle' ? 3 : 3 * ne; if (attached) attached.area -= fp; }
        R.vol += fp * hgt;
        R.empty = false;
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (const [su, sv] of corners) for (const z of [op.z0, op.z1]) grow(T(toGlobal(F, p.cu + su * p.a, p.cv + sv * p.b, z)));
        // caps and flat sides
        const lineDirs = profLineDirs(p).map(([a, b]) => ({ d: add(mul(F.u, a), mul(F.v, b)) }));
        const capEdges = p.kind === 'circle' ? [{ d: null }] : lineDirs;
        const topC = T(toGlobal(F, p.cu, p.cv, op.z1)), botC = T(toGlobal(F, p.cu, p.cv, op.z0));
        const tN = T(add(F.n, [0, 0, 0])).map((x, i) => x - T([0, 0, 0])[i]);
        const td = dirName(tN);
        if (td) addFace({ dir: td, area: fp, off: dot(topC, tN), owner: oi, cap: true, edges: capEdges.map(e => ({ d: e.d && T(e.d).map((x, i) => x - T([0, 0, 0])[i]) })) });
        if (!base && td) addFace({ dir: dirName(mul(tN, -1)), area: fp, off: -dot(botC, tN), owner: oi, cap: true, edges: capEdges });
        for (const [nn, wid, ap] of profSides(p)) {
          const sn = add(mul(F.u, nn[0]), mul(F.v, nn[1]));
          const gn = T(sn).map((x, i) => x - T([0, 0, 0])[i]);
          const sd = dirName(gn);
          if (!sd) continue;
          const c = T(toGlobal(F, p.cu + nn[0] * ap, p.cv + nn[1] * ap, (op.z0 + op.z1) / 2));
          addFace({ dir: sd, area: wid * hgt, off: dot(c, gn), owner: oi, cap: false, edges: [] });
        }
        // straight edges parallel to Z
        if (Math.abs(Math.abs(tN[2]) - 1) < 1e-9) {
          for (let k = 0; k < sides; k++) R.vEdges.push({ cz: (topC[2] + botC[2]) / 2, seam: p.kind === 'circle', owner: oi });
        } else {
          for (const e of lineDirs) if (Math.abs(Math.abs(e.d[2]) - 1) < 1e-9) R.vEdges.push({ cz: (topC[2] + botC[2]) / 2, seam: false, owner: oi }, { cz: (topC[2] + botC[2]) / 2, seam: false, owner: oi });
        }
        if (!base) base = op;
        firstCopy = false;
      }
      R.adds.push(op);
      void firstCopy;
      // dressups on this op
      if (op.rTop > 0 || op.chTop > 0) {
        const r = op.rTop || op.chTop;
        R.F += ne; R.E += p.kind === 'circle' ? 1 : 2 * ne;
        R.vol -= profPerimeter(p) * r * r * (op.rTop ? 1 - Math.PI / 4 : 0.5);
        const top = R.faces.find(f => f.owner === oi && f.cap && f.dir === dirName(F.n));
        if (top) top.area = Math.max(0, top.area - profPerimeter(p) * r);
      }
      if (op.rVert > 0) {
        R.F += ne; R.E += 3 * ne;
        R.vol -= ne * (op.z1 - op.z0) * op.rVert * op.rVert * (1 - Math.PI / 4);
        const own = R.vEdges.filter(e => e.owner === oi);
        for (const e of own) R.vEdges.push({ ...e });
      }
      continue;
    }
    // subtractive prism: the cut runs from the sketch plane (z1) into -n
    for (const T of inst) {
      const c = T(toGlobal(F, p.cu, p.cv, op.z1));
      const nG = T(F.n).map((x, i) => x - T([0, 0, 0])[i]);
      const col = column(c, nG);
      const s = dot(c, nG), lo = s - (op.z1 - op.z0);
      let mat = 0, minLo = Infinity;
      for (const [a, b] of col) { mat += Math.max(0, Math.min(b, s) - Math.max(a, lo)); minLo = Math.min(minLo, a); }
      if (mat <= 1e-9) continue;
      const through = lo <= minLo + 1e-9;
      R.vol -= fp * mat;
      const nD = dirName(nG);
      const top = nD ? findFace(nD, s) : null;
      if (top) top.area -= fp;
      if (through) {
        R.F += sides; R.E += p.kind === 'circle' ? 3 : 3 * ne;
        const bot = nD ? findFace(dirName(mul(nG, -1)), -minLo) : null;
        if (bot) bot.area -= fp;
      } else {
        R.F += sides + 1; R.E += p.kind === 'circle' ? 3 : 3 * ne;
        if (nD) addFace({ dir: nD, area: fp, off: lo, owner: oi, cap: false, edges: p.kind === 'circle' ? [{ d: null }] : profLineDirs(p).map(([a, b]) => ({ d: add(mul(F.u, a), mul(F.v, b)) })) });
      }
      if (Math.abs(Math.abs(nG[2]) - 1) < 1e-9) for (let k = 0; k < sides; k++) R.vEdges.push({ cz: s - mat / 2, seam: p.kind === 'circle', owner: oi });
      if (op.rVert > 0) {   // rounded pocket corners: material comes back
        R.F += ne; R.E += 3 * ne;
        R.vol += ne * mat * op.rVert * op.rVert * (1 - Math.PI / 4);
        for (let k = 0; k < sides; k++) R.vEdges.push({ cz: s - mat / 2, seam: false, owner: oi });
      }
    }
  }
  if (R.nSolids > 1) R.valid = false;
  if (R.vol <= 1e-6) R.valid = false;
  return R;
}
// ShapeInfo (schema.ShapeInfo) of an analysis.
export function shapeInfo(A) {
  if (!A || A.empty || !A.valid) return { valid: false, volume: 0, area: 0, bbox: [0, 0, 0], n_faces: 0, n_edges: 0, n_solids: 0, face_dirs: [] };
  const dirs = [];
  for (const d of ['+Z', '-Z', '+X', '-X', '+Y', '-Y']) if (A.faces.some(f => f.dir === d && f.area > 1e-6)) dirs.push(d);
  if (A.vEdges.length) dirs.push('|Z');
  return { valid: true, volume: A.vol, area: 0, bbox: [0, 1, 2].map(i => A.bbox[1][i] - A.bbox[0][i]), n_faces: A.F, n_edges: A.E, n_solids: 1, face_dirs: dirs };
}
export function pickFace(A, d) {
  let best = null;
  for (const f of A.faces) if (f.dir === d && f.area > 1e-6 && (!best || f.area > best.area + 1e-9 || (Math.abs(f.area - best.area) <= 1e-9 && f.off > best.off))) best = f;
  return best;
}

// ── the session ─────────────────────────────────────────────────────────────
export class Session {
  constructor() { this.doc = null; this.goal = null; this.meta = newMeta(); this.selRefs = []; this.undoStack = []; this.recent = []; this.done = false; this.undoLimit = UNDO_LIMIT; this.docN = 0; }
  reset(goal, start = { doc_open: true, workbench: PD, body: false }) {
    this.goal = goal; this.meta = newMeta(start.workbench); this.selRefs = []; this.undoStack = []; this.recent = []; this.done = false;
    this.doc = null;
    if (start.doc_open) { this.newDocument(); if (start.body) this.makeBody(); }
  }
  newDocument() { this.doc = { objects: [], counters: {} }; this.meta.doc_open = true; }
  uniqueName(base) { const c = this.doc.counters; const k = c[base] || 0; c[base] = k + 1; return k === 0 ? base : base + String(k).padStart(3, '0'); }
  obj(name) { return this.doc ? this.doc.objects.find(o => o.name === name) || null : null; }
  makeBody() {
    const name = this.uniqueName('Body');
    this.doc.objects.push({ name, type: 'PartDesign::Body', inBody: false, tip: null });
    if (this.meta.body == null) { this.meta.body = name; this.meta.objects.push(objMeta(name, 'body', -1, 'PartDesign_Body')); }
    else this.meta.objects.push(objMeta(name, 'other', -1, 'PartDesign_Body'));
    return name;
  }
  get body() { return this.doc && this.meta.body ? this.obj(this.meta.body) : null; }
  tip() { const b = this.body; return b && b.tip ? this.obj(b.tip) : null; }
  solid() { const t = this.tip(); return t && t.ops && t.ok ? t : null; }
  state() { return snapshot(this); }
  validActions(st) { return enumerateActions(st || this.state()); }
  expert() { const a = expertActions(this.goal, this.meta); return a.length === 1 && a[0] === 'Std_Undo' && !this.undoStack.length ? [] : a; }
  progress() { return progress(this.goal, this.meta); }
  intentFor(ref) { return intent(this.goal, ref == null || ref < 0 ? progress(this.goal, this.meta) : ref); }
  step(action) {
    const onPlan = this.expert().includes(action);
    const info = { changed: false, error: null, done: false, on_plan: onPlan };
    this.recent.push(action);
    if (this.recent.length > RECENT_ACTIONS) this.recent.shift();
    try {
      if (action === 'Done') { this.done = info.done = true; }
      else if (action === 'Std_New') { this.newDocument(); info.changed = true; }
      else if (action.startsWith('Std_Workbench:')) this.meta.workbench = action.split(':')[1];
      else if (action === 'Std_ViewFitAll') { /* view only */ }
      else if (action === 'Std_Undo') info.changed = this.undo();
      else if (action.startsWith('Select:')) this.select(action.slice(7));
      else if (action === 'Sketcher_LeaveSketch') {
        const before = clone(this.meta);
        this.meta.edit = null;
        this.pushUndo({ meta: before, sel: clone(this.selRefs), docTx: false });
        if (!onPlan) this.meta.dirty++;
        info.changed = true;
      } else info.changed = this.transact(action, onPlan);
    } catch (e) {
      if (!(e instanceof ActionError)) throw e;
      info.error = e.message;
    }
    return info;
  }
  transact(action, onPlan) {
    if (action in CONSTRAINT_SLOTS && !constraintTarget(this, action)) return false;
    const ex = EXECUTORS[action];
    if (!ex) throw new ActionError('unknown action ' + action);
    const before = clone(this.meta), selBefore = clone(this.selRefs), docBefore = clone(this.doc);
    let changed;
    try { changed = ex(this, action); }
    catch (e) { this.meta = before; this.selRefs = selBefore; this.doc = docBefore; throw e instanceof ActionError ? e : new ActionError(`${action} failed: ${e.message}`); }
    if (!changed) { this.meta = before; this.selRefs = selBefore; this.doc = docBefore; return false; }
    this.pushUndo({ meta: before, sel: selBefore, docTx: true, doc: docBefore });
    if (!onPlan) this.meta.dirty++;
    this.refreshValidity();
    return true;
  }
  pushUndo(e) {
    this.undoStack.push(e);
    while (this.undoStack.filter(x => x.docTx).length > this.undoLimit) { while (!this.undoStack.shift().docTx) { /* drop */ } }
  }
  undo() {
    if (!this.undoStack.length) return false;
    const e = this.undoStack.pop();
    if (e.docTx) this.doc = e.doc;
    const wb = this.meta.workbench;
    this.meta = e.meta; this.meta.workbench = wb;
    this.selRefs = e.sel;
    this.refreshValidity();
    return true;
  }
  refreshValidity() {
    for (const om of this.meta.objects) {
      const o = this.obj(om.name);
      om.valid = !!(o && o.ok !== false);
      if (om.valid && om.role === 'feature') om.valid = !!(o.ops && o.ok && o.A.valid && o.A.vol > 1e-6);
    }
  }
  select(arg) {
    if (arg === 'Clear') { this.selRefs = []; this.meta.selection = []; return; }
    const ref = this.resolveSelection(arg);
    if (!ref) throw new ActionError('nothing to select for ' + arg);
    this.selRefs = [ref]; this.meta.selection = [arg];
  }
  // A selection ref keeps the object name, the description at selection
  // time (describe_selection) and the Select argument.
  resolveSelection(arg) {
    if (arg.startsWith('Plane:')) {
      if (!this.body) return null;
      const F = PLANE_FRAMES[arg.slice(6)];
      return { obj: '__plane_' + arg.slice(6), arg, item: { kind: 'plane', object: arg.slice(6) + '_Plane', object_type: 'App::Plane', subs: [], normal: F.n.slice(), offset: 0, count: 0 }, frame: F };
    }
    const tip = this.tip();
    if (arg === 'Tip') return tip && SOLID_FEATURE_TYPES.has(tip.type) ? { obj: tip.name, arg, item: { kind: 'feature', object: tip.name, object_type: tip.type, subs: [], normal: [0, 0, 0], offset: 0, count: 0 } } : null;
    const sol = this.solid();
    if (!sol) return null;
    const A = sol.A;
    if (arg.startsWith('Face')) {
      const f = pickFace(A, arg.slice(4));
      if (!f) return null;
      const n = dirVec(f.dir);
      return { obj: tip.name, arg, face: { dir: f.dir, off: f.off }, item: { kind: 'face', object: tip.name, object_type: tip.type, subs: ['Face'], normal: n, offset: f.off, count: 1 } };
    }
    if (arg === 'Edges@Face+Z') {
      const f = pickFace(A, '+Z');
      if (!f) return null;
      return { obj: tip.name, arg, owner: f.owner, item: edgesItem(tip, f.edges.map(e => ({ d: e.d, cz: f.off }))) };
    }
    if (arg === 'Edges|Z') {
      if (!A.vEdges.length) return null;
      return { obj: tip.name, arg, item: edgesItem(tip, A.vEdges.map(e => ({ d: [0, 0, 1], cz: e.cz }))) };
    }
    return null;
  }
  consumeSelection() { this.selRefs = []; this.meta.selection = []; }
  addFeature(type, cmd, goalRef) {
    const name = this.uniqueName(cmd.split('_')[1]);
    const f = { name, type, inBody: true, cmd, props: {}, ops: null, ok: false, A: null };
    this.doc.objects.push(f);
    this.meta.objects.push(objMeta(name, 'feature', goalRef, cmd));
    return f;
  }
  // Recompute: the feature's tape is the tip's tape plus its own change.
  finishFeature(f, ops, ok = true) {
    f.ops = ops; f.A = ops ? analyze(ops) : null;
    f.ok = !!(ok && ops && f.A.valid && !f.A.empty);
    if (!f.ok) { f.ops = ops; }
    this.body.tip = f.name;
    this.consumeSelection();
  }
  openProfile() {
    for (let i = this.meta.objects.length - 1; i >= 0; i--) {
      const om = this.meta.objects[i];
      if (om.role === 'sketch' && om.consumed_by == null && om.geometry.length && this.meta.edit !== om.name) return om;
    }
    return null;
  }
  baseOps() { const s = this.solid(); return s ? clone(s.ops) : []; }
}
function edgesItem(tip, edges) {
  let d = [0, 0, 0];
  for (const e of edges) if (e.d) d = add(d, e.d.map(Math.abs));
  const l = Math.hypot(...d);
  if (l > 0) d = mul(d, 1 / l);
  return { kind: 'edges', object: tip.name, object_type: tip.type, subs: edges.map((_, i) => 'Edge' + (i + 1)), normal: d, offset: edges.reduce((s, e) => s + e.cz, 0) / edges.length, count: edges.length };
}
function newMeta(workbench = 'StartWorkbench') { return { doc_open: false, workbench, edit: null, selection: [], body: null, objects: [], dirty: 0 }; }
function objMeta(name, role, goalRef = -1, command = '') { return { name, role, goal_ref: goalRef, command, geometry: [], constraints: [], groups: [], consumed_by: null, valid: true }; }
const metaObj = (S, name) => S.meta.objects.find(o => o.name === name);

// ── executors ───────────────────────────────────────────────────────────────
function exBody(S) { S.makeBody(); return true; }
function exNewSketch(S, a) {
  need(S.body && S.selRefs.length === 1, 'select one plane or face first');
  const ref = S.selRefs[0];
  need(ref.arg.startsWith('Plane:') || ref.arg.startsWith('Face'), 'selection is not a plane or face');
  const goalRef = progress(S.goal, S.meta);
  const name = S.uniqueName('Sketch');
  const frame = ref.frame ? clone(ref.frame) : faceFrame(ref.face.dir, ref.face.off);
  S.doc.objects.push({ name, type: 'Sketcher::SketchObject', inBody: true, frame, onFace: !ref.frame, geos: [], cons: [], groups: [] });
  S.meta.objects.push(objMeta(name, 'sketch', goalRef, a));
  S.meta.edit = name;
  S.consumeSelection();
  return true;
}
function editSketch(S) {
  need(S.meta.edit != null, 'not editing a sketch');
  return [S.obj(S.meta.edit), metaObj(S, S.meta.edit)];
}
// Intent coordinates -> sketch-local: origin planes use them as they are;
// face sketches take global (x, y) on the face and project into the frame.
function local(sk, x, y) {
  if (!sk.onFace) return [x, y];
  const g = [x, y, sk.frame.o[2]];
  const l = toLocal(sk.frame, g);
  return [l[0], l[1]];
}
function exCreate(S, a) {
  const [sk, om] = editSketch(S);
  const f = S.intentFor(om.goal_ref);
  const [cx, cy, sx, sy] = profileBox(f, S.goal.scale);
  const c = local(sk, cx, cy);
  const n0 = sk.geos.length;
  let group;
  const L = (p1, p2) => ({ kind: 'line', p1, p2, construction: false });
  if (a === 'Sketcher_CreateRectangle') {
    const x0 = c[0] - sx / 2, y0 = c[1] - sy / 2;
    const pts = [[x0, y0], [x0 + sx, y0], [x0 + sx, y0 + sy], [x0, y0 + sy]];
    for (let i = 0; i < 4; i++) sk.geos.push(L(pts[i], pts[(i + 1) % 4]));
    for (let i = 0; i < 4; i++) sk.cons.push({ type: 'Coincident' });
    sk.cons.push({ type: 'Horizontal' }, { type: 'Horizontal' }, { type: 'Vertical' }, { type: 'Vertical' });
    group = { kind: 'rect', geo: [n0, n0 + 1, n0 + 2, n0 + 3] };
  } else if (a === 'Sketcher_CreateCircle') {
    sk.geos.push({ kind: 'circle', c, r: Math.min(sx, sy) / 2, construction: false });
    group = { kind: 'circle', geo: [n0] };
  } else if (a === 'Sketcher_CreateHexagon') {
    // ProfileLib.RegularPolygon.makeRegularPolygon(sketch, 6, c, corner):
    // six lines, a construction circle through the corners, 6 Coincident,
    // 5 Equal and 6 PointOnObject constraints.
    const r = Math.min(sx, sy) / 2, a0 = 240 * Math.PI / 180;
    const pts = [];
    for (let i = 0; i < 6; i++) { const t = a0 + i * Math.PI / 3; pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]); }
    for (let i = 0; i < 6; i++) sk.geos.push(L(pts[i], pts[(i + 1) % 6]));
    sk.geos.push({ kind: 'circle', c, r, construction: true });
    for (let i = 0; i < 6; i++) sk.cons.push({ type: 'Coincident' });
    for (let i = 0; i < 5; i++) sk.cons.push({ type: 'Equal' });
    for (let i = 0; i < 6; i++) sk.cons.push({ type: 'PointOnObject' });
    group = { kind: 'hex', geo: [n0, n0 + 1, n0 + 2, n0 + 3, n0 + 4, n0 + 5, n0 + 6] };
  } else if (a === 'Sketcher_CreateLine') {
    sk.geos.push(L(c, [c[0] + sx / 2, c[1] + sy / 3]));
    group = { kind: 'line', geo: [n0] };
  } else if (a === 'Sketcher_CreatePoint') {
    sk.geos.push({ kind: 'point', p: c, construction: false });
    group = { kind: 'point', geo: [n0] };
  } else throw new ActionError(a);
  group.applied = [];
  sk.groups.push(group);
  om.geometry.push(a);
  om.groups.push(clone(group));
  return true;
}
function constraintTarget(S, a) {
  const om = S.meta.edit ? metaObj(S, S.meta.edit) : null;
  if (!om) return null;
  const [slot, kinds] = CONSTRAINT_SLOTS[a];
  return om.groups.find(g => kinds.includes(g.kind) && !g.applied.includes(slot)) || null;
}
function exConstrain(S, a) {
  const [sk, om] = editSketch(S);
  const [slot] = CONSTRAINT_SLOTS[a];
  const g = constraintTarget(S, a);
  if (!g) return false;
  if (slot === 'dx') sk.cons.push({ type: 'DistanceX' });
  else if (slot === 'dy') sk.cons.push({ type: 'DistanceY' });
  else if (slot === 'size') sk.cons.push({ type: a.endsWith('Diameter') ? 'Diameter' : 'Radius' });
  else if (slot === 'lock') sk.cons.push({ type: 'DistanceX', lock: true }, { type: 'DistanceY', lock: true });
  else if (slot === 'orient') sk.cons.push({ type: a.endsWith('Horizontal') ? 'Horizontal' : 'Vertical' });
  g.applied.push(slot);
  const sg = sk.groups[om.groups.indexOf(g)];
  if (sg) sg.applied.push(slot);
  om.constraints.push(a);
  return true;
}
function exToggleConstruction(S, a) {
  const [sk, om] = editSketch(S);
  need(sk.geos.length > 0, 'no geometry');
  const g = sk.geos[sk.geos.length - 1];
  g.construction = !g.construction;
  om.geometry.push(a);
  return true;
}
let OP_ID = 0;
function exProfileFeature(S, a) {
  const prof = S.openProfile();
  need(prof, 'no unused sketch to use as profile');
  const sk = S.obj(prof.name);
  const f = S.intentFor(prof.goal_ref);
  const scale = S.goal.scale;
  const type = TYPE_OF[a];
  const subtract = a === 'PartDesign_Pocket' || a === 'PartDesign_Groove' || a === 'PartDesign_Hole';
  if (subtract) need(S.solid(), 'subtractive feature needs a solid');
  const ops = S.baseOps();
  const feat = S.addFeature(type, a, prof.goal_ref);
  feat.profile = sk.name;
  const profiles = sketchProfiles(sk);
  let ok = profiles.length > 0;
  const F = sk.frame;
  const id = ++OP_ID;
  if (a === 'PartDesign_Pad') {
    const L = padLength(f, scale);
    feat.props = { length: L, type: 'Length', reversed: false };
    for (const p of profiles) ops.push({ id, owner: feat.name, type: 'add', geom: 'prism', p, F, z0: 0, z1: L, rTop: 0, chTop: 0, rVert: 0, pat: null });
  } else if (a === 'PartDesign_Pocket') {
    const [typ, len] = pocketSpec(f, scale);
    feat.props = { length: typ === 'Length' ? len : 5, type: typ, reversed: false };
    const D = typ === 'Length' ? len : 1e4;
    for (const p of profiles) ops.push({ id, owner: feat.name, type: 'sub', geom: 'prism', p, F, z0: -D, z1: 0, rTop: 0, chTop: 0, rVert: 0, pat: null });
  } else if (a === 'PartDesign_Revolution' || a === 'PartDesign_Groove') {
    feat.props = { angle: 360 };
    for (const p of profiles) ops.push({ id, owner: feat.name, type: a === 'PartDesign_Groove' ? 'sub' : 'add', geom: 'revolve', p, F, z0: 0, z1: 0, rTop: 0, chTop: 0, rVert: 0, pat: null });
  } else if (a === 'PartDesign_Hole') {
    const dia = holeDiameter(f, scale);
    feat.props = { diameter: dia, depthType: 'ThroughAll' };
    // the Hole tool drills at each circle centre of the sketch
    const centres = sk.groups.flatMap(g => (g.kind === 'circle' || g.kind === 'hex' ? [sk.geos[g.geo[g.geo.length - 1]].c] : []));
    ok = centres.length > 0;
    for (const c of centres) ops.push({ id, owner: feat.name, type: 'sub', geom: 'prism', p: { kind: 'circle', cu: c[0], cv: c[1], a: dia / 2, b: dia / 2 }, F, z0: -1e4, z1: 0, rTop: 0, chTop: 0, rVert: 0, pat: null });
  }
  prof.consumed_by = feat.name;
  S.finishFeature(feat, ops, ok);
  return true;
}
function exDressup(S, a) {
  need(S.selRefs.length === 1 && S.selRefs[0].item.subs.length, 'select edges/faces first');
  const ref = S.selRefs[0];
  const goalRef = progress(S.goal, S.meta);
  const f = S.intentFor(goalRef);
  const feat = S.addFeature(TYPE_OF[a], a, goalRef);
  const value = dressupValue(f, a);
  feat.props = { value, nRefs: ref.item.subs.length };
  const ops = S.baseOps();
  let ok = ops.length > 0;
  const A = analyze(ops);
  if (a === 'PartDesign_Fillet' || a === 'PartDesign_Chamfer') {
    if (ref.arg === 'Edges@Face+Z') {
      const face = pickFace(A, '+Z');
      const op = face ? ops[face.owner] : null;
      if (!op || op.type !== 'add' || !face.cap || op.rTop || op.chTop) ok = false;
      else {
        const lim = op.geom === 'revolve' ? Math.min(op.p.a, op.p.b) : Math.min(op.p.a, op.p.b, op.z1 - op.z0);
        if (value >= lim * 0.999) ok = false;
        else if (a === 'PartDesign_Fillet') op.rTop = value; else op.chTop = value;
      }
    } else if (ref.arg === 'Edges|Z') {
      // a fillet on a seam edge (a cylinder's vertical edge) fails in OCC
      if (A.vEdges.some(e => e.seam)) ok = false;
      else {
        for (const owner of new Set(A.vEdges.map(e => e.owner))) {
          const op = ops[owner];
          // convex block corners and concave pocket corners both round
          if (!op || op.geom !== 'prism' || op.p.kind === 'circle' || a !== 'PartDesign_Fillet' || op.rVert) { ok = false; continue; }
          if (value >= Math.min(op.p.a, op.p.b) * 0.999) ok = false; else op.rVert = value;
        }
        if (a === 'PartDesign_Chamfer') ok = false;
      }
    } else ok = false;
  } else if (a === 'PartDesign_Thickness') {
    if (!ref.face) ok = false;
    else ops.push({ id: ++OP_ID, owner: feat.name, type: 'shell', t: value, dir: ref.face.dir, off: ref.face.off });
  } else ok = false;   // Draft: not modelled; FreeCAD rejects a draft of a cap face without a neutral plane
  S.finishFeature(feat, ops, ok);
  return true;
}
function exPattern(S, a) {
  need(S.selRefs.length === 1 && S.selRefs[0].arg === 'Tip', 'select a feature first');
  const original = S.obj(S.selRefs[0].obj);
  const goalRef = progress(S.goal, S.meta);
  const f = S.intentFor(goalRef);
  const spec = patternSpec(f, a, S.goal.scale);
  const feat = S.addFeature(TYPE_OF[a], a, goalRef);
  feat.props = { n: spec.n, length: spec.length, nRefs: 1 };
  const ops = S.baseOps();
  let ok = !!original && ADDSUB.has(original.type) && original.ok;
  const mine = ops.filter(o => o.owner === original?.name);
  if (!mine.length || mine.some(o => o.pat)) ok = false;
  for (const o of mine) {
    if (a === 'PartDesign_Mirrored') o.pat = { kind: 'mirror', n: 2, step: 0 };
    else if (a === 'PartDesign_LinearPattern') o.pat = { kind: 'linear', n: spec.n, step: spec.length / (spec.n - 1) };
    else o.pat = { kind: 'polar', n: spec.n, step: 0 };
  }
  S.finishFeature(feat, ops, ok);
  return true;
}
function exPartPrimitive(S, a) {
  const type = a === 'Part_Box' ? 'Part::Box' : 'Part::Cylinder';
  const name = S.uniqueName(a.split('_')[1]);
  const vol = a === 'Part_Box' ? 1000 : Math.PI * 4 * 10;
  S.doc.objects.push({ name, type, inBody: false, prim: { vol, faces: a === 'Part_Box' ? 6 : 3 } });
  S.meta.objects.push(objMeta(name, 'other', -1, a));
  return true;
}
const EXECUTORS = {
  PartDesign_Body: exBody, PartDesign_NewSketch: exNewSketch,
  Sketcher_CreateRectangle: exCreate, Sketcher_CreateCircle: exCreate, Sketcher_CreateHexagon: exCreate, Sketcher_CreateLine: exCreate, Sketcher_CreatePoint: exCreate,
  ...Object.fromEntries(Object.keys(CONSTRAINT_SLOTS).map(k => [k, exConstrain])),
  Sketcher_ToggleConstruction: exToggleConstruction,
  PartDesign_Pad: exProfileFeature, PartDesign_Pocket: exProfileFeature, PartDesign_Revolution: exProfileFeature, PartDesign_Groove: exProfileFeature, PartDesign_Hole: exProfileFeature,
  PartDesign_Fillet: exDressup, PartDesign_Chamfer: exDressup, PartDesign_Thickness: exDressup, PartDesign_Draft: exDressup,
  PartDesign_Mirrored: exPattern, PartDesign_LinearPattern: exPattern, PartDesign_PolarPattern: exPattern,
  Part_Box: exPartPrimitive, Part_Cylinder: exPartPrimitive,
};

// ── snapshot (session.snapshot) ─────────────────────────────────────────────
function sketchNumbers(sk) {
  const geo = { line: 0, circle: 0, arc: 0, point: 0, other: 0 };
  let nParams = 0, nConstr = 0;
  const xs = [], ys = [];
  for (const g of sk.geos) {
    nParams += GEO_PARAMS[g.kind] ?? 4;
    if (g.construction) nConstr++;
    geo[g.kind] = (geo[g.kind] || 0) + 1;
    if (g.kind === 'line') { xs.push(g.p1[0], g.p2[0]); ys.push(g.p1[1], g.p2[1]); }
    else if (g.kind === 'circle') { xs.push(g.c[0] - g.r, g.c[0] + g.r); ys.push(g.c[1] - g.r, g.c[1] + g.r); }
    else if (g.kind === 'point') { xs.push(g.p[0]); ys.push(g.p[1]); }
  }
  const cons = Object.fromEntries(CONSTRAINT_KINDS.map(k => [k, 0]));
  let removed = 0;
  for (const c of sk.cons) {
    if (c.lock) { if (c.type === 'DistanceX') cons.Lock++; }
    else cons[c.type in cons ? c.type : 'Other']++;
    removed += CONSTRAINT_DOF[c.type] ?? 1;
  }
  // closed: every wire of the non-construction geometry is closed
  const real = sk.geos.filter(g => !g.construction);
  const hasWire = real.some(g => g.kind !== 'point');
  const closedGroups = sk.groups.every(gr => {
    const gs = gr.geo.map(i => sk.geos[i]).filter(g => !g.construction && g.kind !== 'point');
    if (!gs.length) return true;
    if (gr.kind === 'rect') return gs.length === 4;
    if (gr.kind === 'hex') return gs.filter(g => g.kind === 'line').length === 6 || gs.length === 1;
    if (gr.kind === 'circle') return true;
    return false;
  });
  const dof = Math.max(0, nParams - removed);
  const num = {
    n_geo: sk.geos.length / 10, n_construction: nConstr / 10, n_constraints: sk.cons.length / 20, dof: dof / 10,
    fully_constrained: +(dof === 0 && sk.geos.length > 0), closed: +(hasWire && closedGroups),
    sk_w: xs.length ? Math.max(...xs) - Math.min(...xs) : 0, sk_h: ys.length ? Math.max(...ys) - Math.min(...ys) : 0,
    sk_cx: xs.length ? (Math.max(...xs) + Math.min(...xs)) / 2 : 0, sk_cy: ys.length ? (Math.max(...ys) + Math.min(...ys)) / 2 : 0,
    support_nx: sk.frame.n[0], support_ny: sk.frame.n[1], support_nz: sk.frame.n[2], support_offset: dot(sk.frame.o, sk.frame.n),
    on_face: +sk.onFace,
  };
  return { num, geo, cons };
}
function featureNumbers(o) {
  const num = {}, t = o.type, P = o.props || {};
  if (t === 'PartDesign::Pad' || t === 'PartDesign::Pocket') { num.length = P.length; num.through_all = +(P.type !== 'Length' && P.type !== 'TwoLengths'); num.reversed = 0; }
  if (t === 'PartDesign::LinearPattern') num.length = P.length;
  if (t === 'PartDesign::Hole') { num.through_all = 1; num.radius = P.diameter / 2; }
  if (t === 'PartDesign::Revolution' || t === 'PartDesign::Groove' || t === 'PartDesign::PolarPattern') num.angle = 1;
  if (t === 'PartDesign::Fillet' || t === 'PartDesign::Chamfer' || t === 'PartDesign::Thickness') num.radius = P.value;
  if (t === 'PartDesign::LinearPattern' || t === 'PartDesign::PolarPattern') num.occurrences = P.n / 10;
  if (t === 'PartDesign::Fillet' || t === 'PartDesign::Chamfer' || t === 'PartDesign::Thickness' || t === 'PartDesign::Draft') num.n_refs = P.nRefs / 10;
  if (t === 'PartDesign::Mirrored' || t === 'PartDesign::LinearPattern' || t === 'PartDesign::PolarPattern') num.n_refs = 0.1;
  return num;
}
export function snapshot(S) {
  const st = { doc_open: !!S.doc, workbench: S.meta.workbench, edit: S.meta.edit, has_body: false, undo_available: S.undoStack.length > 0,
    tree: [], selection: [], recent: S.recent.slice(), shape: shapeInfo(null) };
  if (!S.doc) return st;
  const body = S.body;
  st.has_body = !!body;
  const tip = body ? body.tip : null;
  const scale = S.goal.scale;
  const tgtVol = S.goal.target && S.goal.target.volume > 0 ? S.goal.target.volume : scale ** 3;
  const index = {};
  for (const o of S.doc.objects) {
    if (!TREE_TYPES.has(o.type)) continue;
    let parent = -1;
    if (o.inBody && body && body.name in index) parent = index[body.name];
    const node = { name: o.name, type: o.type, parent, depth: parent < 0 ? 0 : 1, num: {}, geo: {}, cons: {} };
    const valid = o.type === 'PartDesign::Body' ? (o.tip ? +!!(S.obj(o.tip)?.ok) : 1) : o.ops !== undefined && o.type !== 'Sketcher::SketchObject' && SOLID_FEATURE_TYPES.has(o.type) ? +o.ok : 1;
    const num = { tip: +(o.name === tip), in_edit: +(o.name === st.edit), valid, visible: 1, active_body: +(!!body && o.name === body.name) };
    if (o.type === 'Sketcher::SketchObject') {
      const s = sketchNumbers(o);
      Object.assign(num, s.num); node.geo = s.geo; node.cons = s.cons;
      num.consumed = +S.doc.objects.some(x => x.profile === o.name);
    } else if (o.type !== 'PartDesign::Body') {
      if (o.prim) { num.volume_ratio = o.prim.vol / tgtVol; num.n_faces = o.prim.faces / 50; }
      else {
        Object.assign(num, featureNumbers(o));
        if (o.ok && o.A) { num.volume_ratio = o.A.vol / tgtVol; num.n_faces = o.A.F / 50; }
      }
    }
    node.num = num;
    index[o.name] = st.tree.length;
    st.tree.push(node);
  }
  for (const r of S.selRefs) {
    if (r.obj.startsWith('__plane_') ? !!body : !!S.obj(r.obj)) st.selection.push(clone(r.item));
  }
  const sol = S.solid();
  st.shape = body && sol ? shapeInfo(sol.A) : shapeInfo(null);
  return st;
}

// ── the expert (expert.py) ──────────────────────────────────────────────────
export function progress(goal, meta) {
  const done = new Set(meta.objects.filter(o => o.role === 'feature').map(o => o.goal_ref));
  let i = 0;
  while (i < goal.features.length && done.has(i)) i++;
  return i;
}
function currentSketch(meta, i) { return meta.objects.find(o => o.role === 'sketch' && o.goal_ref === i && o.consumed_by == null) || null; }
export function expertActions(goal, meta) {
  if (!meta.doc_open) return ['Std_New', ...(meta.workbench !== PD ? [`Std_Workbench:${PD}`] : [])];
  if (meta.dirty > 0 || meta.objects.some(o => !o.valid)) return ['Std_Undo'];
  if (meta.edit == null && meta.workbench !== PD) return [`Std_Workbench:${PD}`];
  if (meta.body == null) return ['PartDesign_Body'];
  const i = progress(goal, meta);
  if (i >= goal.features.length) return meta.edit ? ['Sketcher_LeaveSketch'] : ['Done'];
  const r = RECIPES[goal.features[i].kind];
  if (r.sketched) {
    const sk = currentSketch(meta, i);
    if (!sk) return meta.selection.length === 1 && meta.selection[0] === r.support ? ['PartDesign_NewSketch'] : [`Select:${r.support}`];
    if (meta.edit === sk.name) {
      if (!sk.geometry.length) return [r.geometry];
      const missing = r.constraints.filter(c => !sk.constraints.includes(c));
      return missing.length ? missing : ['Sketcher_LeaveSketch'];
    }
    return [r.feature];
  }
  if (meta.selection.length === 1 && meta.selection[0] === r.select) return [r.feature];
  return [`Select:${r.select}`];
}

// ── episodes ────────────────────────────────────────────────────────────────
// Run the clean expert; fill goal.target and return the target tape.
export function buildTarget(goal, maxSteps = 200) {
  const S = new Session();
  goal.target = goal.target || { valid: false, volume: 0, area: 0, bbox: [0, 0, 0], n_faces: 0, n_edges: 0, n_solids: 0, face_dirs: [] };
  S.reset(goal, { doc_open: true, workbench: PD, body: false });
  for (let k = 0; k < maxSteps; k++) {
    const acts = S.expert();
    if (acts[0] === 'Done') break;
    if (acts[0] === 'Std_Undo') throw new Error('expert path produced an invalid feature');
    const info = S.step(acts[0]);
    if (info.error) throw new Error(info.error);
  }
  const sol = S.solid();
  if (!sol) throw new Error('target is not a single valid solid');
  goal.target = shapeInfo(sol.A);
  return { ops: clone(sol.ops), A: sol.A };
}
export const stepBudget = (goal, start) => 2 * planLength(goal, start.doc_open, start.workbench, start.body) + 6;

// Canonical comparison of two tapes (ids and owners left out).
export function sameTape(a, b) {
  const strip = ops => JSON.stringify(ops.map(o => ({ ...o, id: 0, owner: '' })), (k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v));
  return strip(a) === strip(b);
}
