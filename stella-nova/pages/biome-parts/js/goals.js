// ============================================================================
//  BIOME PARTS  ·  goals.js — goals, recipes and the goal sampler
// ----------------------------------------------------------------------------
//  PURE. A port of freecad_s1/goals.py and freecad_s1/runtime/params.py. A
//  goal is { features: [{ kind, params }], level, scale, target }, where
//  target is the ShapeInfo of the solid the clean expert builds (the session
//  fills it in, see fcsim.buildTarget).
//
//  THE SAMPLER uses the same rules and ranges as goals.sample_goal, with a
//  seeded mulberry32 stream in place of Python's random.Random, so the
//  distribution is the same and the stream is not. tests.mjs runs the
//  Python streams (dumped by tools/biome-parts/make_ref.py) for the eval.
//
//  FEASIBLE. goals.py keeps a goal only if FreeCAD can build it. We cannot
//  run FreeCAD; feasible() rejects the one family we know fails: a fillet on
//  vertical edges when a cylinder (hole or boss) has a vertical seam edge.
//
//  GREP MAP
//    RECIPES ................ the command recipe of each goal kind
//    KIND_INFO .............. labels and parameter rows for the goal editor
//    rng / sampleGoal ....... the curriculum sampler (levels 1 to 9)
//    feasible ............... the seam-fillet rule
//    planLength ............. expert_plan_length (step budgets)
//    profileBox / padLength / pocketSpec / holeDiameter / dressupValue /
//    patternSpec ............ the parameter stage (runtime/params.py)
//    describe ............... one line of text per goal item
// ============================================================================

const RECT = ['Sketcher_ConstrainDistanceX', 'Sketcher_ConstrainDistanceY', 'Sketcher_ConstrainLock'];
const CIRC = ['Sketcher_ConstrainDiameter', 'Sketcher_ConstrainLock'];
const HEX = ['Sketcher_ConstrainDiameter', 'Sketcher_ConstrainLock', 'Sketcher_ConstrainHorizontal'];
const R = (feature, support, geometry, constraints = [], select = null) => ({ feature, support, geometry, constraints, select, sketched: !!geometry });
export const RECIPES = {
  base_box: R('PartDesign_Pad', 'Plane:XY', 'Sketcher_CreateRectangle', RECT),
  base_cyl: R('PartDesign_Pad', 'Plane:XY', 'Sketcher_CreateCircle', CIRC),
  base_hex: R('PartDesign_Pad', 'Plane:XY', 'Sketcher_CreateHexagon', HEX),
  base_ring: R('PartDesign_Revolution', 'Plane:XZ', 'Sketcher_CreateRectangle', RECT),
  boss_cyl: R('PartDesign_Pad', 'Face+Z', 'Sketcher_CreateCircle', CIRC),
  boss_box: R('PartDesign_Pad', 'Face+Z', 'Sketcher_CreateRectangle', RECT),
  hole: R('PartDesign_Pocket', 'Face+Z', 'Sketcher_CreateCircle', CIRC),
  hole_std: R('PartDesign_Hole', 'Face+Z', 'Sketcher_CreateCircle', CIRC),
  pocket_rect: R('PartDesign_Pocket', 'Face+Z', 'Sketcher_CreateRectangle', RECT),
  polar_pattern: R('PartDesign_PolarPattern', null, null, [], 'Tip'),
  linear_pattern: R('PartDesign_LinearPattern', null, null, [], 'Tip'),
  mirror: R('PartDesign_Mirrored', null, null, [], 'Tip'),
  fillet_top: R('PartDesign_Fillet', null, null, [], 'Edges@Face+Z'),
  fillet_vertical: R('PartDesign_Fillet', null, null, [], 'Edges|Z'),
  chamfer_top: R('PartDesign_Chamfer', null, null, [], 'Edges@Face+Z'),
  shell: R('PartDesign_Thickness', null, null, [], 'Face+Z'),
};

// For the goal editor: label, parameter rows [key, label, min, max, step].
export const KIND_INFO = {
  base_box: { label: 'Base plate', group: 'base', params: [['w', 'width', 4, 120, 0.5], ['d', 'depth', 4, 120, 0.5], ['h', 'height', 2, 40, 0.5]] },
  base_cyl: { label: 'Base disc', group: 'base', params: [['r', 'radius', 4, 60, 0.5], ['h', 'height', 2, 40, 0.5]] },
  base_hex: { label: 'Base hexagon', group: 'base', params: [['r', 'corner radius', 4, 60, 0.5], ['h', 'height', 2, 40, 0.5]] },
  base_ring: { label: 'Base ring', group: 'base', params: [['ri', 'inner radius', 2, 40, 0.5], ['ro', 'outer radius', 4, 60, 0.5], ['h', 'height', 2, 30, 0.5]] },
  boss_cyl: { label: 'Round boss', group: 'top', params: [['r', 'radius', 1, 30, 0.1], ['x', 'x', -60, 60, 0.1], ['y', 'y', -60, 60, 0.1], ['h', 'height', 1, 30, 0.5]] },
  boss_box: { label: 'Block boss', group: 'top', params: [['w', 'width', 1, 60, 0.1], ['d', 'depth', 1, 60, 0.1], ['x', 'x', -60, 60, 0.1], ['y', 'y', -60, 60, 0.1], ['h', 'height', 1, 30, 0.5]] },
  hole: { label: 'Hole (pocket)', group: 'cut', params: [['r', 'radius', 0.5, 20, 0.1], ['x', 'x', -60, 60, 0.1], ['y', 'y', -60, 60, 0.1]] },
  hole_std: { label: 'Hole (hole tool)', group: 'cut', params: [['r', 'radius', 0.5, 20, 0.1], ['x', 'x', -60, 60, 0.1], ['y', 'y', -60, 60, 0.1]] },
  pocket_rect: { label: 'Pocket', group: 'cut', params: [['w', 'width', 1, 60, 0.1], ['d', 'depth', 1, 60, 0.1], ['x', 'x', -60, 60, 0.1], ['y', 'y', -60, 60, 0.1], ['depth', 'cut depth', 0.5, 30, 0.1]] },
  polar_pattern: { label: 'Polar pattern', group: 'pattern', params: [['n', 'copies', 2, 12, 1]] },
  linear_pattern: { label: 'Linear pattern', group: 'pattern', params: [['n', 'copies', 2, 8, 1], ['length', 'length', 2, 100, 0.5]] },
  mirror: { label: 'Mirror (YZ)', group: 'pattern', params: [] },
  fillet_top: { label: 'Fillet top edges', group: 'dress', params: [['r', 'radius', 0.2, 10, 0.1]] },
  fillet_vertical: { label: 'Fillet vertical edges', group: 'dress', params: [['r', 'radius', 0.2, 10, 0.1]] },
  chamfer_top: { label: 'Chamfer top edges', group: 'dress', params: [['size', 'size', 0.2, 10, 0.1]] },
  shell: { label: 'Shell (open top)', group: 'dress', params: [['t', 'wall', 0.4, 10, 0.1]] },
};

// ── seeded random (mulberry32) with the random.Random calls goals.py uses ──
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    random: next,
    uniform: (lo, hi) => lo + (hi - lo) * next(),
    choice: arr => arr[Math.floor(next() * arr.length)],
    randint: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    shuffle: arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; },
  };
}
// Python round(x, 1) on a float: round half to even on the stored double.
export const round1 = x => { const y = x * 10, f = Math.floor(y), r = y - f; return (r > 0.5 || (r === 0.5 && f % 2 !== 0) ? f + 1 : f) / 10; };
const U = (g, lo, hi) => round1(g.uniform(lo, hi));
const F = (kind, params = {}) => ({ kind, params });

function base(g, kinds) {
  const kind = g.choice(kinds);
  if (kind === 'base_box') return F(kind, { w: U(g, 20, 80), d: U(g, 20, 80), h: U(g, 5, 30) });
  if (kind === 'base_cyl' || kind === 'base_hex') return F(kind, { r: U(g, 12, 40), h: U(g, 5, 30) });
  const ri = U(g, 5, 25);
  return F(kind, { ri, ro: round1(ri + U(g, 4, 15)), h: U(g, 4, 25) });
}
const halfExtents = b => (b.kind === 'base_box' ? [b.params.w / 2, b.params.d / 2] : [b.params.r * 0.6, b.params.r * 0.6]);
function minDim(b) {
  const p = b.params;
  if (b.kind === 'base_box') return Math.min(p.w, p.d, p.h);
  if (b.kind === 'base_ring') return Math.min(p.ro - p.ri, p.h);
  return Math.min(2 * p.r, p.h);
}
function onTop(g, kind, b, xSign = 0) {
  const [hx, hy] = halfExtents(b), h = b.params.h;
  if (kind === 'boss_cyl' || kind === 'hole' || kind === 'hole_std') {
    const r = U(g, 1.5, Math.max(1.6, Math.min(hx, hy) * 0.35));
    let x = U(g, -(hx - r) * 0.8, (hx - r) * 0.8);
    if (xSign) x = U(g, r + 1, Math.max(r + 1.1, (hx - r) * 0.8)) * xSign;
    const y = U(g, -(hy - r) * 0.8, (hy - r) * 0.8);
    const params = { r, x, y };
    if (kind === 'boss_cyl') params.h = U(g, 2, 20);
    return F(kind, params);
  }
  const w = U(g, 2, Math.max(2.1, hx * 0.8)), d = U(g, 2, Math.max(2.1, hy * 0.8));
  let x = U(g, -(hx - w / 2) * 0.8, (hx - w / 2) * 0.8);
  if (xSign) x = U(g, w / 2 + 1, Math.max(w / 2 + 1.1, (hx - w / 2) * 0.8)) * xSign;
  const y = U(g, -(hy - d / 2) * 0.8, (hy - d / 2) * 0.8);
  const params = { w, d, x, y };
  if (kind === 'boss_box') params.h = U(g, 2, 20); else params.depth = U(g, 1, h * 0.7);
  return F(kind, params);
}
function dressup(g, kind, b) {
  const m = minDim(b);
  if (kind === 'fillet_top' || kind === 'fillet_vertical') return F(kind, { r: U(g, 0.5, Math.max(0.6, m * 0.2)) });
  if (kind === 'chamfer_top') return F(kind, { size: U(g, 0.5, Math.max(0.6, m * 0.2)) });
  return F('shell', { t: U(g, 0.8, Math.max(0.9, m * 0.15)) });
}
export function goalScale(b) {
  const p = b.params;
  if (b.kind === 'base_box') return Math.max(p.w, p.d, p.h);
  if (b.kind === 'base_ring') return Math.max(2 * p.ro, p.h);
  return Math.max(2 * p.r, p.h);
}
function cutGroup(g, b) {
  const pc = g.random();
  if ((b.kind === 'base_cyl' || b.kind === 'base_hex') && pc < 0.5) {
    const rho = b.params.r * U(g, 0.45, 0.65);
    const n = g.randint(3, 8);
    const r = U(g, 1.0, Math.max(1.1, Math.min(rho * Math.sin(Math.PI / n) * 0.6, b.params.r * 0.15)));
    return [[F(g.choice(['hole', 'hole_std']), { r, x: round1(rho), y: 0 }), F('polar_pattern', { n })], true];
  }
  if (b.kind === 'base_box' && pc < 0.35) {
    const { w, d } = b.params;
    const n = g.randint(2, 4);
    const r = U(g, 1.0, Math.max(1.1, Math.min(d * 0.12, w / (4 * n))));
    const x0 = round1(-w / 2 + w * 0.2), length = round1(w * 0.6);
    return [[F(g.choice(['hole', 'hole_std']), { r, x: x0, y: U(g, -d * 0.2, d * 0.2) }), F('linear_pattern', { n, length })], true];
  }
  if (pc < 0.75) {
    const k = g.choice(['hole', 'hole_std', 'pocket_rect', 'boss_cyl']);
    return [[onTop(g, k, b, 1), F('mirror')], k !== 'boss_cyl'];
  }
  return [[onTop(g, g.choice(['hole', 'hole_std', 'pocket_rect']), b)], true];
}
function composite(g, b, level) {
  const comps = [];
  if (level >= 4 || g.random() < 0.5) comps.push([[onTop(g, g.choice(['boss_cyl', 'boss_box']), b)], false]);
  const nCut = level >= 4 ? level - 2 : g.random() < 0.35 ? 2 : 1;
  for (let i = 0; i < nCut; i++) comps.push(cutGroup(g, b));
  if (level <= 3) g.shuffle(comps);
  const feats = [b];
  let hasCut = false;
  for (const [group, cut] of comps) {
    if (level <= 3 && feats.length - 1 + group.length > 4) continue;
    feats.push(...group); hasCut = hasCut || cut;
  }
  if (level >= 4 || (feats.length < 5 && g.random() < 0.7)) {
    const opts = ['fillet_top', 'chamfer_top', ...(b.kind === 'base_box' ? ['fillet_vertical'] : [])];
    if (!hasCut) opts.push('shell');
    feats.push(dressup(g, g.choice(opts), b));
  }
  return { features: feats, level, scale: goalScale(b) };
}
const PATTERNS = new Set(['polar_pattern', 'linear_pattern']);
export function heldoutComposition(goal) {
  const k = goal.features.map(f => f.kind);
  if (k.includes('boss_box') && k.some(x => PATTERNS.has(x))) return 'pattern+boss_box';
  for (let i = 0; i + 1 < k.length; i++) {
    if (k[i] === 'hole_std' && k[i + 1] === 'mirror') return 'mirrored_hole_std';
    if (k[i] === 'boss_box' && k[i + 1] === 'mirror') return 'mirrored_boss_box';
    if (k[i] === 'pocket_rect' && PATTERNS.has(k[i + 1])) return 'patterned_pocket_rect';
  }
  return null;
}
// One goal at a curriculum level (1..9). Levels 1-3 are the training
// distribution; 4+ are longer than anything Taiga-S1 trained on.
export function sampleGoal(level, g) {
  if (level <= 1) { const b = base(g, ['base_box', 'base_cyl', 'base_hex', 'base_ring']); return { features: [b], level: 1, scale: goalScale(b) }; }
  const b = base(g, level === 2 ? ['base_box', 'base_box', 'base_cyl', 'base_hex', 'base_ring'] : ['base_box', 'base_box', 'base_cyl', 'base_hex']);
  if (level === 2) {
    const feats = [b];
    if (b.kind === 'base_ring') feats.push(dressup(g, g.choice(['fillet_top', 'chamfer_top']), b));
    else {
      const kinds = ['boss_cyl', 'boss_box', 'hole', 'hole_std', 'pocket_rect', 'fillet_top', 'chamfer_top', 'shell'];
      if (b.kind === 'base_box') kinds.push('fillet_vertical');
      const k = g.choice(kinds);
      feats.push(['boss_cyl', 'boss_box', 'hole', 'hole_std', 'pocket_rect'].includes(k) ? onTop(g, k, b) : dressup(g, k, b));
    }
    return { features: feats, level: 2, scale: goalScale(b) };
  }
  let goal;
  for (let i = 0; i < 50; i++) {
    goal = composite(g, b, level);
    const n = goal.features.length;
    if ((level <= 3 && n <= 5) || (level === 4 && n >= 6) || (level === 5 && n >= 8) || (level >= 6 && n >= 2 * level - 1)) return goal;
  }
  return goal;
}
// The rule goals.goal_in_split applies, plus feasible(): a goal in the
// training distribution (levels 1-3, no held-out pairing) or a length goal.
export function sampleLiveGoal(level, g) {
  for (let i = 0; i < 400; i++) {
    const goal = sampleGoal(level, g);
    const rule = heldoutComposition(goal);
    if (rule === null && feasible(goal)) return goal;
  }
  return sampleGoal(1, g);
}
export function feasible(goal) {
  const k = goal.features.map(f => f.kind);
  const i = k.indexOf('fillet_vertical');
  return i < 0 || !k.slice(0, i).some(x => x === 'hole' || x === 'hole_std' || x === 'boss_cyl');
}

export const PD = 'PartDesignWorkbench';
export function planLength(goal, docOpen, wb, body) {
  let n = 1 + (docOpen ? 0 : 1) + (wb === PD ? 0 : 1) + (body ? 0 : 1);
  for (const f of goal.features) { const r = RECIPES[f.kind]; n += r.sketched ? 5 + r.constraints.length : 2; }
  return n;
}

// ── the parameter stage (runtime/params.py) ────────────────────────────────
export function intent(goal, i) {
  if (!goal.features.length) return F('<unk>');
  return goal.features[Math.max(0, Math.min(i, goal.features.length - 1))];
}
export function profileBox(f, scale) {
  const p = f.params;
  if (f.kind === 'base_box') return [0, 0, p.w, p.d];
  if (f.kind === 'base_cyl' || f.kind === 'base_hex') return [0, 0, 2 * p.r, 2 * p.r];
  if (f.kind === 'base_ring') return [(p.ri + p.ro) / 2, p.h / 2, p.ro - p.ri, p.h];
  if (f.kind === 'boss_cyl' || f.kind === 'hole' || f.kind === 'hole_std') return [p.x, p.y, 2 * p.r, 2 * p.r];
  if (f.kind === 'boss_box' || f.kind === 'pocket_rect') return [p.x, p.y, p.w, p.d];
  return [0, 0, scale / 4, scale / 4];
}
export const padLength = (f, scale) => f.params.h || Math.max(1, round1(scale * 0.2));
export function pocketSpec(f, scale) {
  if (f.kind === 'pocket_rect') return ['Length', f.params.depth];
  if (f.kind === 'hole' || f.kind === 'hole_std') return ['ThroughAll', 0];
  return ['Length', Math.max(1, round1(scale * 0.1))];
}
export function holeDiameter(f, scale) {
  if ('r' in f.params && ['hole', 'hole_std', 'boss_cyl'].includes(f.kind)) return 2 * f.params.r;
  return Math.max(1, round1(scale * 0.1));
}
export function dressupValue(f, cmd) {
  if (cmd === 'PartDesign_Fillet' && f.kind.startsWith('fillet')) return f.params.r;
  if (cmd === 'PartDesign_Chamfer' && f.kind === 'chamfer_top') return f.params.size;
  if (cmd === 'PartDesign_Thickness' && f.kind === 'shell') return f.params.t;
  if (cmd === 'PartDesign_Draft') return 3;
  return 1;
}
export function patternSpec(f, cmd, scale) {
  const n = Math.trunc(f.params.n ?? (cmd === 'PartDesign_PolarPattern' ? 3 : 2));
  return { n: Math.max(2, n), length: f.params.length ?? round1(scale * 0.4) };
}

const fmt = v => (Math.round(v * 10) / 10).toString();
export function describe(f) {
  const p = f.params, at = 'x' in p ? ` at (${fmt(p.x)}, ${fmt(p.y)})` : '';
  switch (f.kind) {
    case 'base_box': return `plate ${fmt(p.w)} × ${fmt(p.d)} × ${fmt(p.h)}`;
    case 'base_cyl': return `disc r ${fmt(p.r)}, h ${fmt(p.h)}`;
    case 'base_hex': return `hexagon r ${fmt(p.r)}, h ${fmt(p.h)}`;
    case 'base_ring': return `ring ${fmt(p.ri)} to ${fmt(p.ro)}, h ${fmt(p.h)}`;
    case 'boss_cyl': return `round boss r ${fmt(p.r)}, h ${fmt(p.h)}${at}`;
    case 'boss_box': return `block boss ${fmt(p.w)} × ${fmt(p.d)}, h ${fmt(p.h)}${at}`;
    case 'hole': return `hole r ${fmt(p.r)}${at}`;
    case 'hole_std': return `hole tool r ${fmt(p.r)}${at}`;
    case 'pocket_rect': return `pocket ${fmt(p.w)} × ${fmt(p.d)}, ${fmt(p.depth)} deep${at}`;
    case 'polar_pattern': return `polar pattern × ${p.n}`;
    case 'linear_pattern': return `linear pattern × ${p.n} over ${fmt(p.length)}`;
    case 'mirror': return 'mirror in YZ';
    case 'fillet_top': return `fillet top edges r ${fmt(p.r)}`;
    case 'fillet_vertical': return `fillet vertical edges r ${fmt(p.r)}`;
    case 'chamfer_top': return `chamfer top edges ${fmt(p.size)}`;
    case 'shell': return `shell, wall ${fmt(p.t)}`;
    default: return f.kind;
  }
}
