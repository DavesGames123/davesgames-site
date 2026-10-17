// ============================================================================
//  TENSOR CALCULUS  ·  saver/director.js  ·  the saver shot director  (SAVER)
// ----------------------------------------------------------------------------
//  DOM-free. This file makes the shot catalog, the seeded shot plan, the
//  framing in the clear band of the shell plate, and the label payload.
//  saver/index.js owns the DOM part and drives the page. Node tests import
//  this file directly (tests/saver.test.mjs).
//
//  CHANNELS   all · geometry · relativity · notation · derivations
//    A shot has one home channel and can have more. 'all' has no shots of
//    its own: it rotates. It plays ROTATE_BLOCK shots of each channel in
//    turn, and the channel order comes from the seed.
//
//  SHOT KINDS  (one shot = one subject, held 5 to 12 s)
//    orbit     a VIZ saverShot (viz/shots.js), slow orbit, seeded yaw and
//              direction. The 3D view fills the frame. Home: its channel.
//    push      a slow push-in on the growth of a contraction or a tensor
//              product (camera glides from far to near over the hold).
//    stretch   the upper/lower index demo: the basis stretches, arrows
//              (upper) shrink, plane stacks (lower) squeeze.
//    derive    a LIBRARY entry derived step by step: the diagram and the 3D
//              view side by side (stacked in 9:16); the plate carries the
//              live TeX of the step.
//    diagram   a LIBRARY entry in the diagram view only. The style morphs
//              Penrose -> birdtrack -> network during the hold.
//    equation  a LIBRARY entry in the TeX view and the diagram.
//
//  A plan is a seeded shuffle. The same subject never comes twice in a row,
//  also across the end of one list and the start of the next.
//
//  FRAMING  frameFor(W, H, band, layout) puts the subject in the middle of
//  the clear band (plateBand of lib/saver-clear.js). For a 3D shot the
//  canvas fills the frame and VIZ setViewOffset moves the picture; dist
//  pulls the camera back when the band is short. A pane shot puts the
//  stage in the band.
//
//  EXPORTS   (grep -n "export" saver/director.js)
//    rng, shuffle, CHANNELS, CHANNEL_LABELS, KINDS, HOLD_S, ROTATE_BLOCK,
//    STYLE_CYCLE, buildCatalog(lib, vizShots), shotsOf(catalog, channel),
//    buildPlan(catalog, { seed, channel, calm, avoid }), holdFor(kind, calm, rnd),
//    pickWindow(timeline, holdMs, speeds), clearBox(W, H, band),
//    frameFor(W, H, band, layout), stackPair(w, h), cameraFor(shot, dist, phase), scaleCam,
//    SCENE_TEX, CODE_SCENE, CODE_KIND, codeRef(shot, step), extractBlock(src, marker),
//    READS, readParams(reads), mClassMap(syms, slotOf), colourTex(tex, map),
//    texSyms(tex), labelFor(shot, live)
//
//  grep -n targets: "── CATALOG", "export function buildPlan",
//  "export function frameFor", "export function pickWindow",
//  "── LABEL", "export function labelFor", "export function extractBlock"
// ============================================================================
import { SAVER_SHOTS } from '../viz/shots.js';
import { SCENE_IDS, sceneInfo } from '../viz/registry.js';
import { plainLabel, scriptIndices, colorIndexTex } from '../ui/tex-color.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const CHANNELS = Object.freeze(['all', 'geometry', 'relativity', 'notation', 'derivations']);
export const CHANNEL_LABELS = Object.freeze({
  all: 'All channels', geometry: 'Geometry', relativity: 'Relativity',
  notation: 'Notation and diagrams', derivations: 'Derivations',
});
export const KINDS = Object.freeze(['orbit', 'push', 'stretch', 'derive', 'diagram', 'equation']);
export const HOLD_S = Object.freeze([5, 12]);
export const ROTATE_BLOCK = 2;
export const STYLE_CYCLE = Object.freeze(['penrose', 'birdtrack', 'network']);

// ── RANDOM ───────────────────────────────────────────────────────────────
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ── SCENE TeX ────────────────────────────────────────────────────────────
// The equation of each VIZ scene for the plate. syms: the index letters
// that get the index colours (only letters in a sub- or superscript).
export const SCENE_TEX = Object.freeze({
  'upper-lower': ['w_i v^i = w(v)', 'e_i \\to s\\,e_i:\\; v^i \\to v^i/s,\\; w_i \\to s\\,w_i'],
  'dual-basis': ['e^i(e_j) = \\delta^i_j'],
  'curvilinear': ['e_a = \\frac{\\partial \\vec x}{\\partial x^a},\\quad e^a = \\nabla x^a'],
  'metric-field': ['ds^2 = g_{ab}\\,dx^a dx^b'],
  'outer-product': ['(u \\otimes w)^i{}_j = u^i w_j'],
  'contraction': ['u^i = A^i{}_j\\, v^j', '\\mathrm{tr}\\,T = T^i{}_i'],
  'rank3-cube': ['\\Gamma^i_{jk} = \\tfrac12 g^{il}(\\partial_j g_{lk} + \\partial_k g_{lj} - \\partial_l g_{jk})', 'V = \\epsilon_{ijk}\\, a^i b^j c^k'],
  'transform-rank2': ["T'_{ab} = \\frac{\\partial x^c}{\\partial x'^a}\\frac{\\partial x^d}{\\partial x'^b}\\, T_{cd}"],
  'stress-cube': ['t^i = \\sigma^{ij} n_j'],
  'inertia': ['L^i = I^i{}_j\\, \\omega^j'],
  'lorentz': ["x'^\\mu = \\Lambda^\\mu{}_\\nu\\, x^\\nu", '\\eta_{\\mu\\nu}\\, x^\\mu x^\\nu = 0'],
  'parallel-transport': ['\\frac{dV^\\mu}{ds} + \\Gamma^\\mu_{\\nu\\lambda}\\, \\frac{dx^\\nu}{ds}\\, V^\\lambda = 0'],
  'geodesic-deviation': ['\\frac{D^2 \\xi^\\mu}{d\\tau^2} = -R^\\mu{}_{\\nu\\rho\\sigma}\\, u^\\nu \\xi^\\rho u^\\sigma'],
  'curvature-loop': ['\\delta V^\\rho = -R^\\rho{}_{\\sigma\\mu\\nu}\\, V^\\sigma\\, \\delta a^\\mu\\, \\delta b^\\nu'],
  'flamm': ['ds^2 = -\\left(1 - \\frac{2M}{r}\\right) dt^2 + \\frac{dr^2}{1 - 2M/r} + r^2 d\\Omega^2'],
  'levi-civita': ['V = \\epsilon_{ijk}\\, a^i b^j c^k'],
  'christoffel': ['\\partial_\\mu e_\\nu = \\Gamma^\\lambda_{\\mu\\nu}\\, e_\\lambda'],
  'components': ['T^i{}_j = A^i{}_k\\, B^k{}_j'],
});
// a scene shot with params that pick the second equation
const texOfShot = (scene, params = {}) => {
  const list = SCENE_TEX[scene] || [];
  if (scene === 'contraction') return [params.mode === 'trace' ? list[1] : list[0]];
  if (scene === 'rank3-cube') return [params.tensor === 'epsilon' ? list[1] : list[0]];
  return list.slice();
};

// ── CODE ─────────────────────────────────────────────────────────────────
// The real source each shot quotes: [file (page relative), marker]. The
// marker is the start of a line in that file; extractBlock() cuts the
// block from there. tests/saver.test.mjs reads every file and marker.
export const CODE_SCENE = Object.freeze({
  'upper-lower': ['viz/scenes/basis.js', 'export function basisState'],
  'dual-basis': ['viz/scenes/basis.js', 'export function dualState'],
  'curvilinear': ['tensor/metrics.js', 'export function jacobianOf'],
  'metric-field': ['viz/scenes/curvi.js', 'export function chartMetric'],
  'outer-product': ['tensor/tensor.js', 'export function product'],
  'contraction': ['tensor/tensor.js', 'export function contract'],
  'rank3-cube': ['viz/scenes/blocks.js', 'export function sphericalGamma'],
  'rank3-cube:epsilon': ['tensor/tensor.js', 'export function leviCivita'],
  'transform-rank2': ['tensor/tensor.js', 'export function transform'],
  'stress-cube': ['viz/scenes/continuum.js', 'export function stressAt'],
  'inertia': ['viz/scenes/continuum.js', 'export function inertiaTensor'],
  'lorentz': ['tensor/metrics.js', 'export function lorentzBoost'],
  'parallel-transport': ['tensor/geometry.js', 'export function parallelTransport'],
  'geodesic-deviation': ['tensor/geometry.js', 'export function geodesicDeviation'],
  'curvature-loop': ['viz/scenes/sphere.js', 'export function routes'],
  'flamm': ['tensor/metrics.js', '  schwarzschild: {'],
  'levi-civita': ['viz/scenes/blocks.js', 'export function tripleEps'],
  'christoffel': ['tensor/geometry.js', 'export function christoffel'],
  'components': ['tensor/tensor.js', 'export function einsum'],
});
export const CODE_KIND = Object.freeze({
  product: ['tensor/tensor.js', 'export function product'],
  contract: ['tensor/tensor.js', 'export function contract'],
  raise: ['tensor/tensor.js', 'export function raise'],
  lower: ['tensor/tensor.js', 'export function lower'],
  transform: ['tensor/tensor.js', 'export function transform'],
  symmetrize: ['tensor/tensor.js', 'function symCore'],
  antisymmetrize: ['tensor/tensor.js', 'function symCore'],
  trace: ['tensor/tensor.js', 'export function trace'],
  partial: ['tensor/geometry.js', 'export function partialDerivative'],
  covariant: ['tensor/geometry.js', 'export function covariantDerivative'],
  christoffel: ['tensor/geometry.js', 'export function christoffel'],
  evaluate: ['tensor/evaluate.js', 'export function evaluateExpr'],
  substitute: ['tensor/evaluate.js', 'export function evaluateExpr'],
  expandSum: ['tensor/evaluate.js', 'export function expandToComponents'],
  relabel: ['tensor/expr.js', 'export function relabel'],
});
export const CODE_FILES = Object.freeze([...new Set([...Object.values(CODE_SCENE), ...Object.values(CODE_KIND)].map(r => r[0]))]);

// The code of a shot: a pane shot follows the kind of its live step; a
// scene shot quotes its scene.
export function codeRef(shot, step) {
  if (shot && shot.entry && step && CODE_KIND[step.kind]) return CODE_KIND[step.kind];
  if (shot && shot.scene) {
    const k = shot.scene === 'rank3-cube' && shot.params && shot.params.tensor === 'epsilon' ? 'rank3-cube:epsilon' : shot.scene;
    return CODE_SCENE[k] || CODE_SCENE[shot.scene] || null;
  }
  return null;
}

// Cut the block that starts at the line that begins with marker: up to the
// line where the braces close, at most maxLines lines. null if no marker.
export function extractBlock(src, marker, maxLines = 12) {
  if (!src || !marker) return null;
  const lines = String(src).split('\n');
  const at = lines.findIndex(l => l.startsWith(marker));
  if (at < 0) return null;
  const out = [];
  let depth = 0, opened = false;
  for (let i = at; i < lines.length; i++) {
    const l = lines[i];
    if (out.length === maxLines - 1 && i + 1 < lines.length) {
      // one line is left: close the block if this is its end, else cut
      const end = depth + braces(l) <= 0 && (opened || braces(l) !== 0);
      out.push(end ? l : indentOf(l) + '// …');
      break;
    }
    out.push(l);
    const d = braces(l);
    if (/\{/.test(strip(l))) opened = true;
    depth += d;
    if (opened && depth <= 0) break;
  }
  return out.join('\n');
}
// braces in strings and comments do not count; a wrong count only makes
// the extract stop at maxLines
const strip = l => l.replace(/\/\/.*$/, '').replace(/'(?:\\.|[^'])*'|"(?:\\.|[^"])*"|`(?:\\.|[^`])*`/g, '');
function braces(l) { let d = 0; for (const c of strip(l)) { if (c === '{') d++; else if (c === '}') d--; } return d; }
const indentOf = l => (/^\s*/.exec(l) || [''])[0];

// ── CATALOG ──────────────────────────────────────────────────────────────
// Shots that are not in viz/shots.js: the push-ins and the index demo.
const PUSH = [
  { scene: 'contraction', params: { mode: 'matvec' }, title: 'A contraction grows', sub: 'A^i_j v^j: matched axes collapse into a vector' },
  { scene: 'contraction', params: { mode: 'trace' }, title: 'The trace', sub: 'T^i_i: the diagonal sums to one number' },
  { scene: 'outer-product', params: {}, title: 'A tensor product grows', sub: 'u^i w_j: every pair of components multiplies' },
  { scene: 'rank3-cube', params: { tensor: 'christoffel' }, title: 'Christoffel symbols', sub: 'A rank-3 block of spherical coordinates, slice by slice' },
];
const STRETCH = [
  { scene: 'upper-lower', params: { covector: 1 }, title: 'Upper and lower indices', sub: 'The basis stretches: arrows shrink, plane stacks squeeze' },
  { scene: 'upper-lower', params: { both: 1, covector: 1 }, title: 'Contravariant and covariant', sub: 'Both basis vectors stretch; the pairing w_i v^i stays' },
  { scene: 'dual-basis', params: {}, title: 'A basis and its dual', sub: 'Shear the basis: the dual planes turn to keep e^i(e_j) = δ^i_j' },
];
// LIBRARY fields: the kind of their shot and their channels
const FIELD = {
  algebra: { kind: 'diagram', channels: ['notation', 'derivations'] },
  quantum: { kind: 'diagram', channels: ['notation', 'derivations'] },
  ml: { kind: 'diagram', channels: ['notation', 'derivations'] },
  geometry: { kind: 'derive', channels: ['derivations', 'geometry'] },
  continuum: { kind: 'derive', channels: ['derivations', 'geometry'] },
  mechanics: { kind: 'derive', channels: ['derivations', 'geometry'] },
  relativity: { kind: 'derive', channels: ['derivations', 'relativity'] },
  electromagnetism: { kind: 'derive', channels: ['derivations', 'relativity'] },
};
// entries that read best as an equation with its diagram
const EQUATION_IDS = new Set(['metric-compatibility', 'killing-equation', 'bianchi-identity', 'hooke-isotropic', 'em-stress-energy', 'weyl-tensor', 'divergence-theorem']);

function splitLabel(label, scene) {
  const k = String(label || '').indexOf(':');
  const info = sceneInfo(scene);
  if (k > 0) {
    const sub = label.slice(k + 1).trim();
    return { title: label.slice(0, k).trim(), sub: sub.charAt(0).toUpperCase() + sub.slice(1) };
  }
  return { title: (info && info.label) || scene, sub: label || '' };
}
const keyOf = (scene, params) => scene + (params && Object.keys(params).length ? '?' + Object.keys(params).sort().map(k => k + '=' + params[k]).join('&') : '');

// lib: the LIBRARY module (or { LIBRARY }); vizShots: viz saverShots.
export function buildCatalog(lib, vizShots = SAVER_SHOTS) {
  const out = [];
  for (const s of vizShots || []) {
    const { title, sub } = splitLabel(s.label, s.scene);
    out.push({
      key: 'orbit:' + keyOf(s.scene, s.params), kind: 'orbit', channel: s.channel, channels: [s.channel],
      layout: 'viz', scene: s.scene, params: { ...(s.params || {}) }, camera: s.camera, title, sub,
      tex: texOfShot(s.scene, s.params), subject: s.scene,
    });
  }
  const vizCam = scene => { const v = (vizShots || []).find(s => s.scene === scene); return v ? v.camera : null; };
  for (const p of PUSH) out.push({ key: 'push:' + keyOf(p.scene, p.params), kind: 'push', channel: 'notation', channels: ['notation'], layout: 'viz', camera: vizCam(p.scene), tex: texOfShot(p.scene, p.params), subject: p.scene, ...p, params: { ...p.params } });
  for (const p of STRETCH) out.push({ key: 'stretch:' + keyOf(p.scene, p.params), kind: 'stretch', channel: 'notation', channels: ['notation'], layout: 'viz', camera: vizCam(p.scene), tex: texOfShot(p.scene, p.params), subject: p.scene, ...p, params: { ...p.params } });
  const entries = (lib && (lib.LIBRARY || lib.entries || (Array.isArray(lib) ? lib : null))) || [];
  let n = 0;
  for (const e of entries) {
    const f = FIELD[e.field] || FIELD.geometry;
    const kind = EQUATION_IDS.has(e.id) ? 'equation' : f.kind;
    out.push({
      key: 'entry:' + e.id, kind, channel: kind === 'diagram' ? 'notation' : kind === 'equation' || (n++ % 2) ? 'derivations' : f.channels[1], channels: f.channels.slice(),
      layout: kind === 'diagram' ? 'diagram' : kind === 'equation' ? 'texdiagram' : 'pair',
      entry: e.id, field: e.field, title: e.title, sub: '', tex: [e.tex], subject: 'entry:' + e.id,
    });
  }
  return out;
}

export function shotsOf(catalog, channel) {
  if (!channel || channel === 'all') return catalog.slice();
  return catalog.filter(s => s.channels.includes(channel));
}

// ── PLAN ─────────────────────────────────────────────────────────────────
export function holdFor(kind, calm = 0.7, rnd = Math.random) {
  const c = clamp(calm, 0, 1);
  const base = kind === 'derive' || kind === 'equation' || kind === 'diagram' ? 9 + 2 * c : kind === 'push' ? 8 + 3 * c : 6 + 4 * c;
  return clamp(base + (rnd() - 0.5) * 2.4, HOLD_S[0], HOLD_S[1]);
}

function noRepeat(list, avoid) {
  const bad = (l, i) => l[i].subject === (i === 0 ? avoid : l[i - 1].subject);
  for (let i = 0; i < list.length; i++) {
    if (!bad(list, i)) continue;
    const prev = i === 0 ? avoid : list[i - 1].subject;
    const fits = m => {
      const s = list[m];
      if (s.subject === prev || (i + 1 < list.length && m !== i + 1 && s.subject === list[i + 1].subject)) return false;
      // the shot that moves to m must also fit there
      const a = m > 0 ? (m - 1 === i ? s.subject : list[m - 1].subject) : avoid, b = m + 1 < list.length ? list[m + 1].subject : null;
      return list[i].subject !== a && list[i].subject !== b;
    };
    // a later shot of the same channel first, so the rotation blocks hold
    let j = list.findIndex((s, m) => m > i && s.channel === list[i].channel && fits(m));
    if (j < 0) j = list.findIndex((s, m) => m > i && fits(m));
    if (j < 0) j = list.findIndex((s, m) => m < i - 1 && m > 0 && fits(m));
    if (j >= 0) [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// One pass through the shots of a channel (or the rotation for 'all'), in
// a seeded order, with the hold, the yaw and the orbit direction of each.
export function buildPlan(catalog, opts = {}) {
  const seed = (opts.seed >>> 0) || 1, rnd = rng(seed), calm = clamp(opts.calm ?? 0.7, 0, 1);
  const channel = CHANNELS.includes(opts.channel) ? opts.channel : 'all';
  let order;
  if (channel === 'all') {
    const chans = shuffle(CHANNELS.filter(c => c !== 'all'), rnd);
    // a pool that runs out is shuffled again until every pool has played
    // all its shots once, so the rotation holds to the end of the plan
    const src = chans.map(c => catalog.filter(s => s.channel === c)).filter(p => p.length);
    const pools = src.map(p => shuffle(p.slice(), rnd)), done = src.map(() => false);
    order = [];
    while (done.some(d => !d)) {
      pools.forEach((p, i) => {
        for (let k = 0; k < ROTATE_BLOCK; k++) {
          if (!p.length) { done[i] = true; p.push(...shuffle(src[i].slice(), rnd)); }
          order.push(p.shift());
        }
        if (!p.length) done[i] = true;
      });
    }
  } else order = shuffle(shotsOf(catalog, channel), rnd);
  noRepeat(order, opts.avoid);
  return order.map((s, i) => ({
    ...s, n: i, planChannel: channel,
    hold: holdFor(s.kind, calm, rnd),
    yaw: (rnd() - 0.5) * 0.9,                         // radians about the target
    spin: (rnd() < 0.5 ? -1 : 1) * (1 - 0.45 * calm),  // orbit direction and rate factor
    style0: Math.floor(rnd() * STYLE_CYCLE.length),
  }));
}

// The steps a pane shot plays in its hold. timeline: player.timeline()
// ([{ start, motion, hold }]). Pick the slowest speed that shows the whole
// trace, else the speed that shows three steps or more, from the end.
export function pickWindow(timeline, holdMs, speeds = [0.5, 1, 1.5, 2]) {
  const tl = timeline || [];
  if (!tl.length) return { step: 0, speed: 1, steps: 0 };
  const end = tl[tl.length - 1].start + tl[tl.length - 1].motion + tl[tl.length - 1].hold;
  const fits = s => { let k = tl.length; while (k > 0 && (end - tl[k - 1].start) / s <= holdMs) k--; return k; };
  const sp = speeds.slice().sort((a, b) => a - b);
  for (const s of sp) if (fits(s) === 0) return { step: 0, speed: s, steps: tl.length };
  const want = Math.min(3, tl.length);
  for (const s of sp) { const k = fits(s); if (tl.length - k >= want) return { step: k, speed: s, steps: tl.length - k }; }
  const s = sp[sp.length - 1], k = Math.min(fits(s), tl.length - 1);
  return { step: k, speed: s, steps: tl.length - k };
}

// ── FRAMING ──────────────────────────────────────────────────────────────
// The clear box: the band between the plate text blocks, as wide as the
// plate column. band null (no shell plate) gives a band of 24% and 30%.
export function clearBox(W, H, band) {
  const b = band || { t: H * 0.24, b: H * 0.3, w: W };
  const t = clamp(b.t || 0, 0, H * 0.7), bot = clamp(b.b || 0, 0, H * 0.7);
  const h = Math.max(H * 0.3, H - t - bot);
  const w = clamp(b.w || W, 1, W);
  const x = (W - w) / 2, y = Math.min(t, H - h);
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

export const SUBJECT_K = 0.55;   // the subject spans this part of a wide frame height at dist 1
export const FILL = 0.9;         // the subject fills at most this part of the clear box

// A pair of panes stacks when stacked panes are nearer PANE_ASPECT (a
// diagram row is wide) than panes side by side.
export const PANE_ASPECT = 1.4;
export function stackPair(w, h) {
  const off = a => Math.abs(Math.log(a / PANE_ASPECT));
  return off((2 * w) / h) < off(w / (2 * h));
}

// layout 'viz': the canvas fills the frame, offset moves the picture, dist
// pulls the camera back. Other layouts: the stage is the clear box.
export function frameFor(W, H, band, layout = 'viz') {
  const box = clearBox(W, H, band);
  const aspect = W / H, tall = stackPair(box.w, box.h);
  if (layout === 'viz') {
    // viz/shots.js fitFov widens the view on a frame under 1.25 wide
    const D = SUBJECT_K * H * Math.min(1, Math.pow(aspect / 1.25, 0.85));
    const dist = clamp(Math.max(D / (FILL * box.h), D / (FILL * box.w)), 0.85, 1.8);
    const r = D / dist / 2;
    return {
      layout, box, tall, dist,
      stage: { top: 0, left: 0, right: 0, bottom: 0 },
      offset: { x: Math.round(W / 2 - box.cx), y: Math.round(H / 2 - box.cy) },
      anchor: { x: box.cx, y: box.cy, r },
    };
  }
  return {
    layout, box, tall, dist: 1,
    stage: { top: Math.round(box.y), left: Math.round(box.x), right: Math.round(W - box.x - box.w), bottom: Math.round(H - box.y - box.h) },
    offset: { x: 0, y: 0 },
    anchor: { x: box.cx, y: box.cy, r: FILL * Math.min(box.w, box.h) / 2 },
  };
}

// A camera pulled back by k along its view line.
export function scaleCam(cam, k) {
  const pos = cam.pos.map((v, i) => cam.target[i] + (v - cam.target[i]) * k);
  return { ...cam, pos, target: cam.target.slice() };
}
// The camera of a 3D shot. phase 'start' or 'end' (a push-in glides from
// start to end). yaw turns the camera about the vertical axis of the target.
export function cameraFor(shot, dist = 1, phase = 'start') {
  const base = shot.camera || { pos: [3, 2.5, 5], target: [0, 0, 0], fov: 40, orbit: 2 };
  const yaw = shot.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw), T = base.target;
  const dx = base.pos[0] - T[0], dz = base.pos[2] - T[2];
  const turned = { ...base, pos: [T[0] + c * dx - s * dz, base.pos[1], T[2] + s * dx + c * dz], target: T.slice() };
  const push = shot.kind === 'push' ? (phase === 'start' ? 1.3 : 0.82) : 1;
  const orbit = shot.kind === 'push' ? 0.6 : (base.orbit ?? 2) * (shot.spin ?? 1) * (shot.kind === 'stretch' ? 0.6 : 1);
  return { ...scaleCam(turned, dist * push), orbit };
}

// ── LABEL ────────────────────────────────────────────────────────────────
// VIZ readouts (viz/index.js readouts()) that the plate shows: key ->
// [sym TeX, name]. The first four keys that a scene reads show.
export const READS = Object.freeze({
  s: ['s', 'basis stretch'], pair: ['w_i v^i', 'pairing'], v1: ['v^1', 'component'], w1: ['w_1', 'component'],
  shear: ['\\gamma', 'shear'], beta: ['\\beta', 'boost speed'], E2B2: ['E^2 - B^2', 'invariant'], e0interval: ['-x_\\mu x^\\mu', 'interval'],
  holonomy: ['\\Delta\\alpha', 'holonomy'], expected: ['2\\pi(1-\\cos\\theta_0)', 'expected'], th0: ['\\theta_0', 'colatitude'],
  K: ['K', 'Gauss curvature'], ratio: ['\\delta\\alpha / A', 'angle per area'], angle: ['\\delta\\alpha', 'loop angle'], area: ['A', 'loop area'],
  r: ['r', 'radius'], grr: ['g_{rr}', 'metric'], G_th_rth: ['\\Gamma^\\theta_{r\\theta}', 'Christoffel'], G_r_thth: ['\\Gamma^r_{\\theta\\theta}', 'Christoffel'],
  G_th_phph: ['\\Gamma^\\theta_{\\phi\\phi}', 'Christoffel'], tangentLen: ['|\\nabla e|', 'tangent part'],
  det: ['\\det', 'orientation'], volume: ['V', 'volume'], tn: ['t^i n_i', 'normal traction'], trace: ['\\sigma^i{}_i', 'trace'],
  L: ['|L|', 'angular momentum'], E2: ['2E', 'energy'], u: ['u', 'transform'], detJ: ['\\det J', 'Jacobian'],
  sum0: ['u^1', 'result'], cells: ['n', 'components'], metric: ['\\lambda', 'metric blend'], g12: ['g_{12}', 'metric'],
  morph: ['m', 'chart blend'], th: ['\\theta', 'colatitude'], eph: ['|e_\\phi|', 'basis length'], Vr: ['V^r', 'component'],
});
export const fmt = x => {
  if (typeof x !== 'number' || !Number.isFinite(x)) return String(x);
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return x.toExponential(2).replace('e', '·10^');
  return String(+x.toFixed(a >= 100 ? 1 : 3));
};
export function readParams(reads, max = 4) {
  const out = [];
  if (!reads) return out;
  for (const k of Object.keys(READS)) {
    if (out.length >= max) break;
    const v = reads[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out.push({ sym: READS[k][0], name: READS[k][1], value: fmt(v), cls: 'm' + ((out.length % 6) + 1) });
  }
  return out;
}

// The plate colours m1..m6 (lib/sci.css) for the page index slots 0..7, by
// hue: sky blue, orange, green, yellow, pink, vermilion, violet, white.
const SLOT_M = ['m1', 'm2', 'm3', 'm5', 'm4', 'm2', 'm6', 'm1'];
// One plate class per index letter of one expression: the class of its
// slot, or the next free one when two letters would share it.
export function mClassMap(syms, slotOf = () => 0) {
  const map = new Map(), used = new Set();
  for (const raw of syms || []) {
    const s = String(raw).replace(/^\\+/, '');
    if (!s || map.has(s)) continue;
    let k = ((slotOf(s) | 0) % 8 + 8) % 8, cls = SLOT_M[k];
    for (let n = 1; used.has(cls) && n <= 6; n++) cls = 'm' + ((+cls.slice(1) % 6) + 1);
    used.add(cls); map.set(s, cls);
  }
  return map;
}
export const texSyms = tex => scriptIndices(String(tex || '')).map(s => String(s).replace(/^\\+/, ''));
// TeX with each script index in \class{mN}{..}; letters out of scripts stay.
export function colourTex(tex, map) {
  const norm = s => String(s).replace(/^\\+/, '');
  return colorIndexTex(String(tex || ''), sym => map.get(norm(sym)) || 'm1', [...map.keys()].flatMap(s => [s, '\\' + s]));
}

// The shell plate payload. live = { step, index, count, trace, reads,
// code: { name, text } | null, slotOf, band, anchor, channel, style }.
export function labelFor(shot, live = {}) {
  const step = live.step || null;
  const rawTex = shot.entry ? (step && step.after && step.after.tex) || (shot.tex && shot.tex[0]) || '' : null;
  const texList = (rawTex != null ? [rawTex] : (shot.tex || [])).filter(Boolean);
  const syms = [];
  for (const t of texList) for (const s of texSyms(t)) if (!syms.includes(s)) syms.push(s);
  const map = mClassMap(syms, live.slotOf);
  const tex = texList.map(t => colourTex(t, map));
  const rules = [...map].filter(([s]) => s.length > 1).map(([s, c]) => ['\\' + s, c]);
  const params = [];
  if (shot.entry) {
    if (live.count) params.push({ sym: 'k', name: 'step', value: `${(live.index | 0) + 1} / ${live.count}`, cls: 'm1' });
    if (live.trace && live.trace.dim) params.push({ sym: 'n', name: 'dimension', value: String(live.trace.dim), cls: 'm3' });
    if (live.trace && live.trace.metric) params.push({ sym: 'g', name: 'metric', value: String(live.trace.metric), cls: 'm5' });
    if (shot.kind === 'diagram' && live.style) params.push({ sym: '\\mathcal{D}', name: 'diagram', value: live.style, cls: 'm6' });
  } else params.push(...readParams(live.reads));
  const sub = shot.entry
    ? (step ? plainLabel(step.label) : (shot.sub || ''))
    : shot.sub || '';
  const lines = [CHANNEL_LABELS[live.channel || shot.planChannel || shot.channel] || ''];
  if (shot.kind === 'diagram' || shot.layout === 'pair' || shot.layout === 'texdiagram') lines.push('Penrose notation: a leg up is an upper index, a leg down a lower one; a joined leg is a sum.');
  if (shot.kind === 'stretch') lines.push('Upper index: an arrow. Lower index: a stack of planes.');
  const info = {
    title: shot.title, sub, tex, rules, params, lines: lines.filter(Boolean),
    eq: texList.map(t => plainLabel('$' + t + '$')),
  };
  if (live.code && live.code.text) info.code = { lang: 'js', name: live.code.name, text: live.code.text };
  if (live.anchor) info.anchor = live.anchor;
  return info;
}

export { SAVER_SHOTS, SCENE_IDS };
