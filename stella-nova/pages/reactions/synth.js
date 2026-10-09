// ============================================================================
//  REACTIONS  ·  synth.js — a synthesis as a tree of molecules (no DOM)
// ----------------------------------------------------------------------------
//  A SYNTH is a list of molecule nodes and the steps that make them:
//    nodes [{ id, mol (steps.js node), step (index of the step that made
//            it, or -1 for a starting compound), coef, formal }]
//    steps [{ st (steps.js STEP), out (node id), ins [node ids] }]
//    root  the node id of the target
//  The tree for the layout: the target at the root, the molecules that a
//  step used are its children. Leaves are the starting compounds; branches
//  merge where chemicals combine. Two of one species in one step (2 NH3)
//  are one child with coef 2. Formal reagents ([O], 2[H]) are not nodes:
//  they show in the equation only.
//
//  fromNamed(OCL, named)    run a named synthesis of templates.js
//  addStep(S, OCL, cls, nodeIds, pick)   apply a class to existing nodes
//  layout(S, kind, size)    the fishdraw tree-of-life layout
//    (pages/fishdraw/tree.js layoutTree, its natural layout, imported):
//    'clado' elbow branches, one row per leaf, here mirrored so the leaves
//    sit at the left and the target at the right (a synthesis reads left
//    to right); 'radial' rings by depth, the target at the centre; 'fan'
//    a half circle, the target at the base. Leaf boxes never overlap
//    (fishdraw's guarantee; tests.mjs checks every box here).
//  growOrder(S)             the node ids in build order (leaves of a step,
//                           then its product), for the growth playback
//
//  GREP MAP: grep -n 'export function fromNamed'  'export function layout'
// ============================================================================
import { layoutTree } from '../fishdraw/tree.js';
import { CLASS } from './templates.js';
import { runStep, nodeOfSpecies } from './steps.js';
import { keyOfSpecies } from './species.js';

export function emptySynth() { return { nodes: [], steps: [], root: -1 }; }
export function addLeaf(S, mol) {
  const id = S.nodes.length;
  S.nodes.push({ id, mol, step: -1, coef: 1, used: -1 });
  if (S.root < 0) S.root = id;
  return id;
}
// Apply a class to nodes (ids, one per lhs pattern; a reagent pattern can
// name a species key instead, which adds a leaf). Returns the new node id.
export function addStep(S, OCL, cls, ins, pick = null) {
  cls = typeof cls === 'string' ? CLASS[cls] : cls;
  const ids = ins.map(x => (typeof x === 'number' ? x : null));
  const mols = ins.map(x => (typeof x === 'number' ? S.nodes[x].mol : nodeOfSpecies(x)));
  const st = runStep(OCL, cls, mols, pick);
  if (!st) return -1;
  // the inputs of the step: existing nodes, else new leaves; one node per
  // species per step (coef counts the copies); formal reagents: no node
  const used = [], seen = new Map();
  mols.forEach((m, i) => {
    if (cls.kind === 'overall' && !cls.fuel) return;   // its species come below
    if (cls.kind !== 'overall' && st.formal[i]) return;
    const k = m.key;
    if (seen.has(k) && ids[i] == null) { S.nodes[seen.get(k)].coef++; return; }
    let id = ids[i];
    if (id == null) id = addLeaf(S, m);
    seen.set(k, id); used.push(id);
  });
  if (cls.kind === 'overall' && cls.fuel) {
    const o2 = addLeaf(S, nodeOfSpecies('o2'));
    S.nodes[o2].coef = st.inputs.filter(n => n.sp === 'o2').length;
    S.nodes[used[0]].coef = st.inputs.filter(n => n.key === mols[0].key).length;
    used.push(o2);
  } else if (cls.kind === 'overall') {
    used.length = 0;
    cls.lhsQ.forEach(([k, q]) => { const id = ids.find(x => x != null && S.nodes[x].mol.key === keyOfSpecies(k)) ?? addLeaf(S, nodeOfSpecies(k)); S.nodes[id].coef = q; used.push(id); });
  }
  const out = S.nodes.length;
  S.nodes.push({ id: out, mol: st.products[st.made], step: S.steps.length, coef: 1, used: -1 });
  S.steps.push({ st, out, ins: used });
  for (const i of used) S.nodes[i].used = out;
  S.root = out;
  return out;
}

// A named synthesis: each step takes the species that an earlier step
// made from that step's product node.
export function fromNamed(OCL, N) {
  const S = emptySynth(), made = new Map();
  N.steps.forEach(([cid, ks, prod], i) => {
    const cls = CLASS[cid];
    const ins = ks.map((k, j) => {
      if (made.has(k) && !(cls.role && typeof cls.role[j] === 'string' && cls.role[j].startsWith('f:'))) { const id = made.get(k); made.delete(k); return id; }
      return k;
    });
    const want = prod || (i === N.steps.length - 1 ? N.target : null);
    const id = addStep(S, OCL, cls, ins, want ? keyOfSpecies(want) : null);
    if (id < 0) throw new Error(N.id + ': step ' + (i + 1) + ' failed');
    made.set(S.nodes[id].mol.sp || want || ks[0], id);
  });
  S.name = N.name; S.d = N.d; S.named = N.id;
  return S;
}

// ── tree for the layout ─────────────────────────────────────────────────────
export function treeOf(S) {
  const full = S.nodes.map(n => ({ id: n.id, children: [] }));
  for (const s of S.steps) for (const i of s.ins) full[s.out].children.push(i);
  // only the nodes under the root, numbered 0.. for fishdraw's layout
  const keep = [], walk = id => { keep.push(id); full[id].children.forEach(walk); };
  walk(S.root);
  const local = new Map(keep.map((id, i) => [id, i]));
  const nodes = keep.map((id, i) => ({ id: i, parent: -1, children: full[id].children.map(c => local.get(c)), depth: 0, kind: 'tip', t: 0, change: 0 }));
  const dep = (i, d) => { nodes[i].depth = d; nodes[i].kind = nodes[i].children.length ? 'split' : 'tip'; nodes[i].children.forEach(c => { nodes[c].parent = i; dep(c, d + 1); }); };
  dep(0, 0);
  const tips = nodes.filter(q => !q.children.length).map(q => q.id);
  return { nodes, root: 0, tips, keep, local, sid: keep };
}
export function layout(S, kind = 'clado', size = 150) {
  const tree = treeOf(S);
  const L = layoutTree(tree, kind, { tip: size });
  if (kind === 'clado') {
    // mirror: leaves left, target right
    const W = L.w, fx = x => W - x;
    tree.nodes.forEach((q, i) => {
      const p = L.pos[i]; if (p) p.x = fx(p.x);
      const b = L.fish[i]; if (b) b.x = W - b.x - b.w;
      const br = L.branch[i];
      if (br) { br.elbow = br.elbow.map(([x, y]) => [fx(x), y]); br.run = br.run.map(([x, y]) => [fx(x), y]); }
    });
  }
  // back to synth node ids
  const pos = [], fish = [], branch = [];
  tree.keep.forEach((id, i) => { pos[id] = L.pos[i]; fish[id] = L.fish[i]; branch[id] = L.branch[i]; });
  const out = Object.assign({}, L, { pos, fish, branch, tree, ids: tree.keep });
  // fishdraw keeps the leaf boxes apart; a chain of one-input steps on one
  // ray of a radial or fan layout can still touch on a diagonal. Spread
  // the positions (not the boxes) from the centre until no box touches.
  if (kind !== 'clado') {
    for (let k = 0; k < 12 && overlaps(out).length; k++) {
      const f = 1.12, cx = out.cx, cy = out.cy, sc = ([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f];
      for (const id of out.ids) {
        const p = pos[id], b = fish[id];
        const [nx, ny] = sc([p.x, p.y]);
        if (b) { b.x += nx - p.x; b.y += ny - p.y; }
        p.x = nx; p.y = ny; if (p.r != null) p.r *= f;
        const br = branch[id]; if (br) { br.elbow = br.elbow.map(sc); br.run = br.run.map(sc); }
      }
      out.w *= f; out.h *= f;
    }
    // shift so the boxes start at 0, 0
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of out.ids) { const b = fish[id]; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    const pad = size * 0.1, dx = pad - x0, dy = pad - y0, mv = ([x, y]) => [x + dx, y + dy];
    for (const id of out.ids) {
      pos[id].x += dx; pos[id].y += dy; fish[id].x += dx; fish[id].y += dy;
      const br = branch[id]; if (br) { br.elbow = br.elbow.map(mv); br.run = br.run.map(mv); }
    }
    out.cx += dx; out.cy += dy; out.w = x1 - x0 + 2 * pad; out.h = y1 - y0 + 2 * pad;
  }
  return out;
}
// Leaves first, each product after the molecules it needs.
export function growOrder(S) {
  const tree = treeOf(S), out = [];
  const walk = i => { tree.nodes[i].children.forEach(walk); out.push(tree.keep[i]); };
  walk(0);
  return out;
}
// Boxes that overlap (for the tests): pairs of node ids.
export function overlaps(lay) {
  const ids = lay.ids, bad = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = lay.fish[ids[i]], b = lay.fish[ids[j]];
    if (!a || !b) continue;
    if (a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6) bad.push([ids[i], ids[j]]);
  }
  return bad;
}

// A route of retro.js: its steps run forward from the starting compounds.
// Leaves named by SMILES get a node from OpenChemLib.
export function fromRoute(OCL, route, nodeOfSmiles) {
  const S = emptySynth(), at = [];
  route.steps.forEach(st => {
    const ins = st.ins.map(x => {
      if (x.made != null) return at[x.made];
      if (x.sp) return x.sp;
      return addLeaf(S, nodeOfSmiles(x.smiles));
    });
    const id = addStep(S, OCL, CLASS[st.cls], ins, st.pick);
    if (id < 0) throw new Error('a route step did not run: ' + st.cls);
    at.push(id);
  });
  return S;
}
