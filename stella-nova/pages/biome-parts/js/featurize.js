// ============================================================================
//  BIOME PARTS  ·  featurize.js — state, goal and actions to model inputs
// ----------------------------------------------------------------------------
//  PURE. A port of freecad_s1/model/featurize.py for the options Taiga-S1 was
//  trained with (config.json: invariant_numerics = true, modular = true, so
//  encode_state runs with invariant and sentinel; no UI tokens).
//
//  THE STATE IS A SEQUENCE OF TYPED TOKENS
//    [CLS] [GLOBAL] [NODE x tree order] [SEL] [RECENT newest first]
//    [GOAL_GLOBAL] [GOAL x goal order] [END]
//  Each token has a segment, a primary id a (offset into one shared table), a
//  secondary id b (tree depth or selected object type), a position, a coupled
//  ordinal (goal item k and the tree objects that build it share k + 1) and a
//  numeric row of NUM_DIM values.
//
//  FLOAT16. Python stores the numeric rows as float16 before the model reads
//  them, so f16 rounds every value the same way here. Without it the logits
//  differ in the 4th digit.
//
//  GREP MAP
//    SEG_* N_SEGMENTS NUM_DIM MAX_* ..... sizes
//    A_OFFSETS A_VOCAB B_VOCAB .......... the shared id tables
//    f16 ................................ round to half precision
//    encodeState ........................ tokens for one state and goal
//    encodeAction / encodeActions ....... candidate action rows
// ============================================================================
import {
  WORKBENCHES, NODE_TYPES, SELECTION_KINDS, ACTION_IDS, GOAL_KINDS, NODE_NUM_KEYS, LENGTH_KEYS, GEOMETRY_KINDS,
  CONSTRAINT_KINDS, GOAL_PARAM_KEYS, GOAL_LENGTH_KEYS, CATALOGUE, CATEGORIES, SCOPES, WORD_VOCAB, SOLID_FEATURE_TYPES,
  actionWords, actionVector,
} from './vocab.js';

export const SEG_CLS = 0, SEG_GLOBAL = 1, SEG_NODE = 2, SEG_SEL = 3, SEG_RECENT = 4, SEG_GOAL_GLOBAL = 5, SEG_GOAL = 6;
export const N_SEGMENTS = 7;
export const NUM_DIM = NODE_NUM_KEYS.length + GEOMETRY_KINDS.length + CONSTRAINT_KINDS.length;   // 48
export const MAX_POS = 128, MAX_ORD = 32, MAX_NODES = 40, MAX_SEL = 4, MAX_GOAL = 24, MAX_WORDS = 8, ACT_VEC_DIM = 6;
const A_SIZES = [1, WORKBENCHES.length, NODE_TYPES.length, SELECTION_KINDS.length, ACTION_IDS.length, 1, GOAL_KINDS.length];
export const A_OFFSETS = A_SIZES.map((_, i) => A_SIZES.slice(0, i).reduce((s, x) => s + x, 0));
export const A_VOCAB = A_SIZES.reduce((s, x) => s + x, 0);   // 100
export const B_VOCAB = NODE_TYPES.length + 4;                // 21
const idx = list => new Map(list.map((x, i) => [x, i]));
const NT = idx(NODE_TYPES), WB = idx(WORKBENCHES), SEL = idx(SELECTION_KINDS), ACT = idx(ACTION_IDS), GOAL = idx(GOAL_KINDS);
const CAT = idx(CATEGORIES), SCOPE = idx(SCOPES), WORD = idx(WORD_VOCAB);
const FACE_DIRS = ['+Z', '-Z', '+X', '-X', '+Y', '-Y', '|Z'];
const clip = (x, lim = 8) => Math.max(-lim, Math.min(lim, x));

// Round a number to the nearest IEEE half (ties to even), as numpy does.
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
export function f16(x) {
  if (!Number.isFinite(x) || x === 0) return x;
  const a = Math.abs(x);
  if (a >= 65520) return Math.sign(x) * Infinity;
  let e = Math.floor(Math.log2(a));
  if (2 ** e > a) e--; else if (2 ** (e + 1) <= a) e++;
  const q = e < -14 ? 2 ** -24 : 2 ** (e - 10);       // spacing of halves near a
  const m = a / q, fl = Math.floor(m), r = m - fl;
  const n = r > 0.5 || (r === 0.5 && fl % 2 === 1) ? fl + 1 : fl;
  return Math.sign(x) * n * q;
}

// tokens = { n, seg, a, b, pos, ord, num (n * NUM_DIM) }
export function encodeState(st, goal) {
  const scale = goal.scale > 0 ? goal.scale : 1;
  const t = goal.target;
  const rows = [];
  const ords = [];
  rows.push([SEG_CLS, 0, 0, 0, []]);
  const sh = st.shape;
  const faces = clip(sh.n_faces / Math.max(t.n_faces, 1), 4), edges = clip(sh.n_edges / Math.max(t.n_edges, 1), 4);
  const tgtVol = t.volume > 0 ? t.volume : scale ** 3;
  const g = [+st.doc_open, +st.has_body, +(st.edit != null), +st.undo_available, st.selection.length / 4, +sh.valid,
    clip(sh.volume / tgtVol), ...sh.bbox.map(x => clip(x / scale)), faces, edges, sh.n_solids,
    ...FACE_DIRS.map(d => +sh.face_dirs.includes(d)), 0, 0];
  rows.push([SEG_GLOBAL, WB.get(st.workbench) ?? 0, 0, 0, g]);

  const nodeOrds = [];
  let nSolid = 0;
  const tree = st.tree.slice(0, MAX_NODES);
  for (const node of tree) {
    if (SOLID_FEATURE_TYPES.has(node.type)) { nodeOrds.push(Math.min(nSolid + 1, MAX_ORD - 1)); nSolid++; }
    else if (node.type === 'Sketcher::SketchObject') nodeOrds.push(Math.min(nSolid + 1, MAX_ORD - 1));
    else nodeOrds.push(0);
  }
  tree.forEach((node, i) => {
    const num = NODE_NUM_KEYS.map(k => clip((node.num[k] || 0) / (LENGTH_KEYS.has(k) ? scale : 1)));
    for (const k of GEOMETRY_KINDS) num.push((node.geo[k] || 0) / 10);
    for (const k of CONSTRAINT_KINDS) num.push((node.cons[k] || 0) / 10);
    if ('n_faces' in node.num) num[NODE_NUM_KEYS.indexOf('n_faces')] = clip(node.num.n_faces * 50 / Math.max(t.n_faces, 1), 4);
    rows.push([SEG_NODE, NT.get(node.type) ?? 0, NODE_TYPES.length + Math.min(node.depth, 3), Math.min(i, MAX_POS - 1), num]);
    ords.push(rows.length - 1);
  });
  st.selection.slice(0, MAX_SEL).forEach((s, i) => {
    rows.push([SEG_SEL, SEL.get(s.kind) ?? SEL.get('other'), NT.get(s.object_type) ?? 0, i, [...s.normal, clip(s.offset / scale), s.count / 10]]);
  });
  [...st.recent].reverse().forEach((a, i) => rows.push([SEG_RECENT, ACT.get(a) ?? 0, 0, i, []]));
  rows.push([SEG_GOAL_GLOBAL, 0, 0, 0, [...t.bbox.map(x => clip(x / scale)), clip(t.volume / scale ** 3)]]);
  const goalRows = [];
  goal.features.slice(0, MAX_GOAL).forEach((f, i) => {
    const num = GOAL_PARAM_KEYS.map(k => { const v = f.params[k]; return v == null ? 0 : clip(GOAL_LENGTH_KEYS.has(k) ? v / scale : v / 10); });
    for (const k of GOAL_PARAM_KEYS) num.push(+(k in f.params));
    num.push(0, 0, 0);
    rows.push([SEG_GOAL, GOAL.get(f.kind) ?? 0, 0, Math.min(i, MAX_POS - 1), num]);
    goalRows.push(rows.length - 1);
  });
  rows.push([SEG_GOAL, 0, 0, Math.min(goalRows.length, MAX_POS - 1), [...new Array(2 * GOAL_PARAM_KEYS.length).fill(0), 1, 1, 0]]);
  goalRows.push(rows.length - 1);

  const n = rows.length;
  const T = { n, seg: new Int32Array(n), a: new Int32Array(n), b: new Int32Array(n), pos: new Int32Array(n), ord: new Int32Array(n), num: new Float32Array(n * NUM_DIM) };
  ords.forEach((row, k) => { T.ord[row] = nodeOrds[k]; });
  goalRows.forEach((row, k) => { T.ord[row] = Math.min(k + 1, MAX_ORD - 1); });
  rows.forEach(([s, ai, bi, p, v], j) => {
    T.seg[j] = s; T.a[j] = A_OFFSETS[s] + ai; T.b[j] = bi; T.pos[j] = p;
    for (let k = 0; k < v.length; k++) T.num[j * NUM_DIM + k] = f16(v[k]);
  });
  return T;
}

const ACTION_CACHE = new Map();
export function encodeAction(id) {
  let hit = ACTION_CACHE.get(id);
  if (hit) return hit;
  const s = CATALOGUE.get(id);
  const words = actionWords(id).map(w => WORD.get(w) ?? 1).slice(0, MAX_WORDS);
  while (words.length < MAX_WORDS) words.push(0);
  hit = { id: ACT.get(id) ?? 0, cat: s ? CAT.get(s.category) ?? 0 : 0, scope: s ? SCOPE.get(s.scope) ?? 0 : 0, words, vec: actionVector(id) };
  ACTION_CACHE.set(id, hit);
  return hit;
}
export const encodeActions = ids => ids.map(encodeAction);
