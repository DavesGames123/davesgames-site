// ============================================================================
//  BIOME PARTS  ·  vocab.js — the fixed vocabularies of Taiga-S1
// ----------------------------------------------------------------------------
//  PURE. A port of freecad_s1/schema.py and freecad_s1/actions.py from
//  Biome-S1 (github.com/shhivv/biome-s1, MIT, Shiv Shanmugam). The order of
//  every list is the order of the embedding rows in the weights, so a change
//  here breaks the model. tests.mjs compares each table with the dump that
//  tools/biome-parts/make_ref.py writes from the Python source.
//
//  GREP MAP
//    WORKBENCHES NODE_TYPES SELECTION_KINDS ..... schema vocabularies
//    NODE_NUM_KEYS LENGTH_KEYS ................... node numeric columns
//    GOAL_KINDS GOAL_PARAM_KEYS .................. goal vocabularies
//    CATALOGUE ACTION_IDS CATEGORIES SCOPES ...... the action catalogue
//    actionWords WORD_VOCAB actionVector ......... action encodings
//    enumerateActions ............................ the valid action set
// ============================================================================

export const WORKBENCHES = ['<unk>', 'NoneWorkbench', 'StartWorkbench', 'PartWorkbench', 'PartDesignWorkbench', 'SketcherWorkbench'];
export const NODE_TYPES = [
  '<unk>', 'PartDesign::Body', 'Sketcher::SketchObject', 'PartDesign::Pad', 'PartDesign::Pocket',
  'PartDesign::Revolution', 'PartDesign::Groove', 'PartDesign::Hole', 'PartDesign::Fillet', 'PartDesign::Chamfer',
  'PartDesign::Draft', 'PartDesign::Thickness', 'PartDesign::Mirrored', 'PartDesign::LinearPattern',
  'PartDesign::PolarPattern', 'Part::Box', 'Part::Cylinder',
];
export const GEOMETRY_KINDS = ['line', 'circle', 'arc', 'point', 'other'];
export const CONSTRAINT_KINDS = ['Coincident', 'Horizontal', 'Vertical', 'DistanceX', 'DistanceY', 'Distance', 'Radius',
  'Diameter', 'Equal', 'PointOnObject', 'Symmetric', 'Lock', 'Other'];
export const SELECTION_KINDS = ['<none>', 'plane', 'face', 'edges', 'feature', 'sketch', 'other'];
export const NODE_NUM_KEYS = [
  'tip', 'in_edit', 'valid', 'visible', 'consumed', 'active_body',
  'n_geo', 'n_construction', 'n_constraints', 'dof', 'fully_constrained', 'closed',
  'support_nx', 'support_ny', 'support_nz', 'support_offset', 'on_face',
  'sk_w', 'sk_h', 'sk_cx', 'sk_cy',
  'length', 'through_all', 'reversed', 'angle', 'radius', 'occurrences', 'n_refs',
  'volume_ratio', 'n_faces',
];
export const LENGTH_KEYS = new Set(['support_offset', 'sk_w', 'sk_h', 'sk_cx', 'sk_cy', 'length', 'radius']);
export const GOAL_KINDS = [
  '<unk>', 'base_box', 'base_cyl', 'base_hex', 'base_ring',
  'boss_cyl', 'boss_box', 'hole', 'hole_std', 'pocket_rect',
  'polar_pattern', 'linear_pattern', 'mirror',
  'fillet_top', 'fillet_vertical', 'chamfer_top', 'shell',
];
export const GOAL_PARAM_KEYS = ['w', 'd', 'h', 'r', 'ri', 'ro', 'x', 'y', 'depth', 'n', 'length', 'size', 't'];
export const GOAL_LENGTH_KEYS = new Set(['w', 'd', 'h', 'r', 'ri', 'ro', 'x', 'y', 'depth', 'length', 'size', 't']);
export const RECENT_ACTIONS = 8;

// ── the action catalogue (actions.py) ───────────────────────────────────────
export const SELECT_PLANES = ['Plane:XY', 'Plane:XZ', 'Plane:YZ'];
export const SELECT_FACES = ['Face+Z', 'Face-Z', 'Face+X', 'Face-X', 'Face+Y', 'Face-Y'];
export const SELECT_OTHER = ['Edges@Face+Z', 'Edges|Z', 'Tip', 'Clear'];
export const WORKBENCH_TARGETS = ['PartDesignWorkbench', 'PartWorkbench', 'SketcherWorkbench'];

const spec = (id, category, scope) => [id, { id, category, scope }];
export const CATALOGUE = new Map([
  spec('Std_New', 'std', 'nodoc'),
  ...WORKBENCH_TARGETS.map(w => spec(`Std_Workbench:${w}`, 'workbench', 'any')),
  spec('Std_Undo', 'std', 'doc'),
  spec('Std_ViewFitAll', 'view', 'doc'),
  spec('Done', 'terminal', 'doc'),
  ...[...SELECT_PLANES, ...SELECT_FACES, ...SELECT_OTHER].map(a => spec(`Select:${a}`, 'select', 'doc')),
  spec('PartDesign_Body', 'body', 'PartDesign'),
  spec('PartDesign_NewSketch', 'sketch', 'PartDesign'),
  spec('PartDesign_Pad', 'additive', 'PartDesign'),
  spec('PartDesign_Revolution', 'additive', 'PartDesign'),
  spec('PartDesign_Pocket', 'subtractive', 'PartDesign'),
  spec('PartDesign_Groove', 'subtractive', 'PartDesign'),
  spec('PartDesign_Hole', 'subtractive', 'PartDesign'),
  spec('PartDesign_Fillet', 'dressup', 'PartDesign'),
  spec('PartDesign_Chamfer', 'dressup', 'PartDesign'),
  spec('PartDesign_Draft', 'dressup', 'PartDesign'),
  spec('PartDesign_Thickness', 'dressup', 'PartDesign'),
  spec('PartDesign_Mirrored', 'pattern', 'PartDesign'),
  spec('PartDesign_LinearPattern', 'pattern', 'PartDesign'),
  spec('PartDesign_PolarPattern', 'pattern', 'PartDesign'),
  spec('Part_Box', 'part_primitive', 'Part'),
  spec('Part_Cylinder', 'part_primitive', 'Part'),
  spec('Sketcher_CreateRectangle', 'sketch_geometry', 'sketch'),
  spec('Sketcher_CreateCircle', 'sketch_geometry', 'sketch'),
  spec('Sketcher_CreateHexagon', 'sketch_geometry', 'sketch'),
  spec('Sketcher_CreateLine', 'sketch_geometry', 'sketch'),
  spec('Sketcher_CreatePoint', 'sketch_geometry', 'sketch'),
  spec('Sketcher_ConstrainDistanceX', 'sketch_constraint', 'sketch'),
  spec('Sketcher_ConstrainDistanceY', 'sketch_constraint', 'sketch'),
  spec('Sketcher_ConstrainDiameter', 'sketch_constraint', 'sketch'),
  spec('Sketcher_ConstrainRadius', 'sketch_constraint', 'sketch'),
  spec('Sketcher_ConstrainLock', 'sketch_constraint', 'sketch'),
  spec('Sketcher_ConstrainHorizontal', 'sketch_constraint', 'sketch'),
  spec('Sketcher_ConstrainVertical', 'sketch_constraint', 'sketch'),
  spec('Sketcher_ToggleConstruction', 'sketch_misc', 'sketch'),
  spec('Sketcher_LeaveSketch', 'sketch_misc', 'sketch'),
]);
const pySorted = a => [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
export const ACTION_IDS = ['<unk>', ...CATALOGUE.keys()];
export const CATEGORIES = ['<unk>', ...pySorted(new Set([...CATALOGUE.values()].map(s => s.category)))];
export const SCOPES = ['<unk>', ...pySorted(new Set([...CATALOGUE.values()].map(s => s.scope)))];

export const SOLID_FEATURE_TYPES = new Set([
  'PartDesign::Pad', 'PartDesign::Pocket', 'PartDesign::Revolution', 'PartDesign::Groove',
  'PartDesign::Hole', 'PartDesign::Fillet', 'PartDesign::Chamfer', 'PartDesign::Draft',
  'PartDesign::Thickness', 'PartDesign::Mirrored', 'PartDesign::LinearPattern', 'PartDesign::PolarPattern',
]);

// The same alternation as the Python _CAMEL pattern; findall = matchAll.
const CAMEL = /[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[+\-|@]?[A-Z0-9]+|[+\-|@]/g;
export function actionWords(id) {
  const out = [];
  for (const part of id.split(/[_:]/)) for (const m of part.matchAll(CAMEL)) out.push(m[0].toLowerCase());
  return out;
}
export const WORD_VOCAB = ['<pad>', '<unk>', ...pySorted(new Set([...CATALOGUE.keys()].flatMap(actionWords)))];

const AXES = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
// Normal of a selected face or plane (sign included) and 3 flags.
export function actionVector(id) {
  const v = [0, 0, 0, 0, 0, 0];
  if (!id.startsWith('Select:')) return v;
  const arg = id.slice(7);
  const m = /Face([+-])([XYZ])/.exec(arg);
  if (m) { const s = m[1] === '+' ? 1 : -1; AXES[m[2]].forEach((c, i) => { v[i] = s * c; }); }
  else if (arg.startsWith('Plane:')) { const n = { XY: 'Z', XZ: 'Y', YZ: 'X' }[arg.split(':')[1]]; AXES[n].forEach((c, i) => { v[i] = c; }); }
  else if (arg === 'Edges|Z') AXES.Z.forEach((c, i) => { v[i] = c; });
  v[3] = +arg.startsWith('Plane:'); v[4] = +arg.startsWith('Face'); v[5] = +arg.startsWith('Edges');
  return v;
}

// ── valid actions (actions.enumerate_actions) ───────────────────────────────
const ORDER = new Map([...CATALOGUE.keys()].map((a, i) => [a, i]));
export function enumerateActions(st) {
  const out = [];
  const wb = st.workbench;
  for (const w of WORKBENCH_TARGETS) if (w !== wb && !st.edit) out.push(`Std_Workbench:${w}`);
  if (!st.doc_open) return ['Std_New', ...out];
  if (st.undo_available) out.push('Std_Undo');
  out.push('Std_ViewFitAll');
  if (st.edit) {
    const sk = st.tree.find(n => n.name === st.edit);
    const hasGeo = !!(sk && (sk.num.n_geo || 0) > 0);
    out.push('Sketcher_CreateRectangle', 'Sketcher_CreateCircle', 'Sketcher_CreateHexagon', 'Sketcher_CreateLine', 'Sketcher_CreatePoint');
    if (hasGeo) {
      for (const [a, s] of CATALOGUE) if (s.category === 'sketch_constraint') out.push(a);
      out.push('Sketcher_ToggleConstruction');
    }
    out.push('Sketcher_LeaveSketch');
    return out;
  }
  out.push('Done');
  const selKinds = new Set(st.selection.map(s => s.kind));
  const hasSolid = st.shape.valid && st.shape.volume > 1e-9;
  if (st.has_body) out.push(...SELECT_PLANES.map(p => `Select:${p}`));
  for (const f of SELECT_FACES) if (st.shape.face_dirs.includes(f.slice(-2))) out.push(`Select:${f}`);
  if (st.shape.face_dirs.includes('+Z')) out.push('Select:Edges@Face+Z');
  if (st.shape.face_dirs.includes('|Z')) out.push('Select:Edges|Z');
  if (st.tree.some(n => SOLID_FEATURE_TYPES.has(n.type))) out.push('Select:Tip');
  if (st.selection.length) out.push('Select:Clear');
  if (wb === 'PartDesignWorkbench') {
    out.push('PartDesign_Body');
    if (st.has_body) {
      if (st.selection.length === 1 && (selKinds.has('plane') || selKinds.has('face'))) out.push('PartDesign_NewSketch');
      const openProfile = st.tree.some(n => n.type === 'Sketcher::SketchObject' && !n.num.consumed && (n.num.n_geo || 0) > 0);
      if (openProfile) {
        out.push('PartDesign_Pad', 'PartDesign_Revolution');
        if (hasSolid) out.push('PartDesign_Pocket', 'PartDesign_Groove', 'PartDesign_Hole');
      }
      if (hasSolid && selKinds.has('edges')) out.push('PartDesign_Fillet', 'PartDesign_Chamfer');
      if (hasSolid && selKinds.has('face')) out.push('PartDesign_Thickness', 'PartDesign_Draft');
      if (selKinds.has('feature')) out.push('PartDesign_Mirrored', 'PartDesign_LinearPattern', 'PartDesign_PolarPattern');
    }
  } else if (wb === 'PartWorkbench') out.push('Part_Box', 'Part_Cylinder');
  return [...new Set(out)].sort((a, b) => (ORDER.get(a) ?? 1e6) - (ORDER.get(b) ?? 1e6));
}
