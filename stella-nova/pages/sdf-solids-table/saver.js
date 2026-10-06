// ============================================================================
//  SDF SOLIDS TABLE  ·  saver.js — the build-up screensaver
// ----------------------------------------------------------------------------
//  The table engine's own saver drew one calm cell for the whole dwell, so a
//  run showed one still solid (a ball bearing for 90 s). This saver builds
//  solids instead. Each RECIPE is an ordered op list for the interpreter in
//  shaders/saver.wgsl: primitives join (smooth union, grown in by scale),
//  cutters slide in and carve (max(d, -d_i)), and modifiers ease in (onion,
//  round, twist, grid repetition). One op animates at a time, about 2.5 s at
//  calm 0.7, while the camera moves to the part being made. The finished
//  solid holds, fades out, and the next recipe of a seeded order fades in.
//  The table cells and their shaders do not change: the saver has its own
//  pipeline on the device that the engine gives PAGE.init.
//
//  WIRING
//    main.js wraps PAGE.init to call setCtx(ctx), then calls install() after
//    bootTable, so this window.snSaver replaces the engine's one-cell hook.
//
//  GREP MAP
//    const RECIPES ...... the solids, op by op, with plate captions
//    function packOp .... op -> 7 vec4 (the WGSL Op layout)
//    function timeline .. op progress from the build clock
//    function camera .... orbit eye, fit to the frame, detail moves
//    function detailFocus the detail-shot aim point, kept inside the solid
//    function plate ..... opts.label: solid, step, formula, live values
//    export const SAVER . setCtx, install, and the JS port for saver-test.mjs
// ============================================================================

const D2R = Math.PI / 180;
const T = { sphere: 0, box: 1, torus: 2, cyl: 3, capsule: 4, cone: 5, half: 6, ellipsoid: 7, gyroid: 8, onion: 20, round: 21, twist: 22, grid: 23 };
const C = { union: 0, sub: 1, inter: 2 };
const MAX_OPS = 24;

// ---------------------------------------------------------------- recipes
// op fields: t type, c combine, b params, pos, rot (degrees x, y, z: the
// solid's own turn), rep and repR (polar copies about local y), slide (the
// cutter offset at progress 0), lerp L (ease the distance in from L,
// no slide; L is about half the cutter depth, or for an intersector a
// small part of its d_i range, so the change grows through the step;
// saver-test.mjs "spread" checks it), k,
// mat (0..3), at (timeline step; default the list index), cap (plate sub).
// Units: the floor is y = -1.25, and every solid stays in the bound sphere
// of radius 2.6 (saver-test.mjs checks both).
const UP = [0, 3.4, 0];
const RECIPES = [
  { name: 'Ball bearing', note: 'Deep-groove radial bearing', mats: [[0.86, 0.87, 0.9, 0.92], [0.62, 0.64, 0.7, 0.85], [0.85, 0.62, 0.3, 0.75], [0.95, 0.72, 0.5, 0.8]], ops: [
    { t: 'cyl', c: 'union', b: [1.5, 0.3, 0.03], pos: [0, -0.9, 0], mat: 0, cap: 'Turning the outer ring from a cylinder' },
    { t: 'cyl', c: 'sub', b: [1.18, 0.5, 0], pos: [0, -0.9, 0], slide: UP, k: 0.02, mat: 3, cap: 'Boring the outer ring' },
    { t: 'cyl', c: 'union', b: [0.86, 0.3, 0.03], pos: [0, -0.9, 0], mat: 0, cap: 'Adding the inner ring' },
    { t: 'cyl', c: 'sub', b: [0.42, 0.5, 0], pos: [0, -0.9, 0], slide: UP, mat: 3, cap: 'Boring the shaft hole' },
    { t: 'torus', c: 'sub', b: [1.02, 0.17], pos: [0, -0.9, 0], slide: UP, k: 0.02, mat: 3, cap: 'Carving the ball races' },
    { t: 'sphere', c: 'union', b: [0.16], pos: [0, -0.9, 0], rep: 12, repR: 1.02, slide: [0, 3.0, 0], mat: 1, cap: 'Seating twelve balls' },
    { t: 'torus', c: 'union', b: [1.02, 0.035], pos: [0, -0.9, 0], mat: 2, cap: 'Threading the cage' },
    { t: 'round', b: [0.012], cap: 'Breaking every edge' },
  ] },
  { name: 'Spur gear', note: 'Twenty teeth on a pocketed web', mats: [[0.8, 0.82, 0.86, 0.85], [0.35, 0.36, 0.4, 0.6], [0.8, 0.8, 0.8, 0.5], [1.0, 0.7, 0.45, 0.8]], ops: [
    { t: 'cyl', c: 'union', b: [1.15, 0.2, 0.02], pos: [0, -1.0, 0], mat: 0, cap: 'Blanking a steel disc' },
    { t: 'box', c: 'union', b: [0.16, 0.2, 0.11, 0.02], pos: [0, -1.0, 0], rep: 20, repR: 1.2, k: 0.03, mat: 0, cap: 'Cutting twenty teeth' },
    { t: 'cyl', c: 'sub', b: [0.95, 0.5, 0], pos: [0, -0.38, 0], slide: UP, mat: 3, cap: 'Pocketing the web' },
    { t: 'cyl', c: 'union', b: [0.42, 0.32, 0.03], pos: [0, -0.88, 0], k: 0.06, mat: 1, cap: 'Raising the hub' },
    { t: 'cyl', c: 'sub', b: [0.16, 0.6, 0], pos: [0, -1.0, 0], rep: 6, repR: 0.68, slide: UP, mat: 3, cap: 'Drilling six lightening holes' },
    { t: 'cyl', c: 'sub', b: [0.2, 0.6, 0], pos: [0, -1.0, 0], slide: UP, mat: 3, cap: 'Boring the shaft' },
    { t: 'box', c: 'sub', b: [0.07, 0.6, 0.06, 0], pos: [0.2, -1.0, 0], slide: UP, mat: 3, cap: 'Broaching the keyway' },
    { t: 'round', b: [0.01], cap: 'Breaking every edge' },
  ] },
  { name: 'Hourglass', note: 'Two blown bulbs in a turned frame', mats: [[0.45, 0.28, 0.16, 0.1], [0.62, 0.78, 0.9, 0.45], [0.9, 0.75, 0.45, 0.1], [0.7, 0.85, 1.0, 0.6]], ops: [
    { t: 'cyl', c: 'union', b: [0.95, 0.07, 0.03], pos: [0, -1.15, 0], mat: 0, cap: 'The base plate' },
    { t: 'cyl', c: 'union', b: [0.95, 0.07, 0.03], pos: [0, 1.15, 0], slide: [0, 2, 0], mat: 0, cap: 'The top plate' },
    { t: 'capsule', c: 'union', b: [1.1, 0.06], pos: [0, 0, 0], rep: 3, repR: 0.82, slide: [0, 3, 0], mat: 0, cap: 'Three turned pillars' },
    { t: 'ellipsoid', c: 'union', b: [0.6, 0.55, 0.6], pos: [0, 0.5, 0], mat: 1, cap: 'Blowing the upper bulb' },
    { t: 'ellipsoid', c: 'union', b: [0.6, 0.55, 0.6], pos: [0, -0.5, 0], k: 0.35, mat: 1, cap: 'Blowing the lower bulb' },
    { t: 'torus', c: 'sub', b: [0.42, 0.3], pos: [0, 0, 0], lerp: 0.15, k: 0.04, mat: 1, cap: 'Pinching the waist' },
    { t: 'round', b: [0.008], cap: 'Breaking every edge' },
  ] },
  { name: 'Spinning top', note: 'Lacquered body, brass stem', mats: [[0.75, 0.12, 0.1, 0.15], [0.9, 0.7, 0.35, 0.85], [0.92, 0.88, 0.8, 0.05], [1.0, 0.85, 0.5, 0.7]], ops: [
    { t: 'cone', c: 'union', b: [0.02, 0.85, 0.55], pos: [0, -0.68, 0], mat: 0, cap: 'A cone for the body' },
    { t: 'torus', c: 'union', b: [0.72, 0.2], pos: [0, -0.05, 0], k: 0.25, mat: 0, cap: 'Rolling the rim' },
    { t: 'ellipsoid', c: 'union', b: [0.75, 0.35, 0.75], pos: [0, 0.05, 0], k: 0.15, mat: 2, cap: 'Doming the crown' },
    { t: 'cyl', c: 'union', b: [0.09, 0.45, 0.04], pos: [0, 0.7, 0], k: 0.1, mat: 1, cap: 'Turning the stem' },
    { t: 'sphere', c: 'union', b: [0.14], pos: [0, 1.15, 0], k: 0.05, mat: 1, cap: 'Setting the knob' },
    { t: 'torus', c: 'sub', b: [0.9, 0.035], pos: [0, -0.05, 0], slide: UP, mat: 3, cap: 'Cutting a band in the rim' },
    { t: 'box', c: 'sub', b: [0.3, 0.06, 0.025, 0], pos: [0, 0.38, 0], rep: 16, repR: 0.45, slide: UP, mat: 3, cap: 'Fluting the crown with sixteen cuts' },
  ] },
  { name: 'Wine glass', note: 'A shell of glass, cut at the rim', mats: [[0.78, 0.86, 0.95, 0.6], [0.5, 0.06, 0.1, 0.2], [0.9, 0.9, 0.9, 0.3], [0.75, 0.9, 1.0, 0.6]], ops: [
    { t: 'cyl', c: 'union', b: [0.62, 0.035, 0.02], pos: [0, -1.18, 0], mat: 0, cap: 'Pressing the foot' },
    { t: 'capsule', c: 'union', b: [0.55, 0.045], pos: [0, -0.62, 0], k: 0.18, mat: 0, cap: 'Pulling the stem' },
    { t: 'ellipsoid', c: 'union', b: [0.62, 0.7, 0.62], pos: [0, 0.4, 0], k: 0.12, mat: 0, cap: 'Blowing the bowl' },
    { t: 'onion', b: [0.025], cap: 'Hollowing it to a shell' },
    { t: 'half', c: 'sub', b: [0.75], pos: [0, 0, 0], slide: [0, 3, 0], mat: 0, cap: 'Cutting the rim' },
  ] },
  { name: 'Teacup', note: 'Porcelain shell, gilded rim, saucer', mats: [[0.93, 0.9, 0.84, 0.06], [0.95, 0.75, 0.35, 0.9], [0.45, 0.24, 0.1, 0.15], [0.9, 0.8, 0.6, 0.5]], ops: [
    { t: 'cyl', c: 'union', b: [0.75, 0.45, 0.28], pos: [0, -0.65, 0], mat: 0, cap: 'A rounded cylinder' },
    { t: 'onion', b: [0.045], cap: 'Shelling the cylinder' },
    { t: 'half', c: 'sub', b: [-0.33], pos: [0, 0, 0], slide: [0, 3, 0], mat: 0, cap: 'Opening the mouth' },
    { t: 'cyl', c: 'union', b: [0.68, 0.02, 0], pos: [0, -0.45, 0], mat: 2, cap: 'Pouring the tea' },
    { t: 'torus', c: 'union', b: [0.26, 0.055], pos: [1.03, -0.62, 0], rot: [90, 0, 0], k: 0.05, mat: 0, cap: 'Bending the handle' },
    { t: 'torus', c: 'union', b: [0.727, 0.028], pos: [0, -0.33, 0], mat: 1, cap: 'Gilding the rim' },
    { t: 'cyl', c: 'union', b: [1.25, 0.03, 0.02], pos: [0, -1.13, 0], mat: 0, cap: 'Setting the saucer' },
    { t: 'torus', c: 'union', b: [1.2, 0.06], pos: [0, -1.1, 0], k: 0.1, mat: 0, cap: 'Raising the saucer lip' },
  ] },
  { name: 'Gyroscope', note: 'Rotor in two gimbal rings', mats: [[0.9, 0.72, 0.4, 0.85], [0.85, 0.86, 0.9, 0.9], [0.2, 0.2, 0.24, 0.4], [1.0, 0.8, 0.5, 0.8]], ops: [
    { t: 'cyl', c: 'union', b: [0.6, 0.08, 0.02], pos: [0, 0, 0], mat: 1, cap: 'The rotor disc' },
    { t: 'capsule', c: 'union', b: [0.95, 0.04], pos: [0, 0, 0], k: 0.02, mat: 1, cap: 'Its axle' },
    { t: 'torus', c: 'sub', b: [0.6, 0.03], pos: [0, 0, 0], lerp: 0.015, mat: 3, cap: 'Grooving the rotor rim' },
    { t: 'torus', c: 'union', b: [1.0, 0.05], pos: [0, 0, 0], rot: [90, 0, 0], mat: 0, cap: 'The inner gimbal ring' },
    { t: 'torus', c: 'union', b: [1.2, 0.05], pos: [0, 0, 0], rot: [0, 0, 90], mat: 0, cap: 'The outer gimbal ring' },
    { t: 'cone', c: 'union', b: [0.5, 0.08, 0.1], pos: [0, -1.15, 0], k: 0.04, mat: 2, cap: 'The pedestal' },
  ] },
  { name: 'Gyroid core', note: 'A triply periodic shell in a sphere', mats: [[0.25, 0.75, 0.7, 0.2], [1.0, 0.75, 0.3, 0.5], [0.9, 0.9, 0.9, 0.2], [0.5, 1.0, 0.85, 0.5]], ops: [
    { t: 'sphere', c: 'union', b: [1.1], pos: [0, 0, 0], mat: 0, cap: 'A sphere' },
    { t: 'gyroid', c: 'inter', b: [5.0, 0.07], pos: [0, 0, 0], lerp: 0.03, k: 0.02, mat: 0, cap: 'Intersecting a gyroid shell' },
    { t: 'sphere', c: 'union', b: [0.45], pos: [0, 0, 0], mat: 1, cap: 'Growing a core inside' },
    { t: 'box', c: 'sub', b: [1.3, 1.3, 1.3, 0], pos: [1.3, 1.3, 1.3], slide: [3, 3, 3], mat: 2, cap: 'Cutting an octant away' },
    { t: 'round', b: [0.01], cap: 'Breaking every edge' },
  ] },
  { name: 'Twisted column', note: 'Fluted shaft, plinth and capital', mats: [[0.9, 0.88, 0.85, 0.05], [0.9, 0.72, 0.35, 0.9], [0.6, 0.6, 0.6, 0.2], [1.0, 0.85, 0.6, 0.7]], ops: [
    { t: 'twist', b: [1.4], at: 4, cap: 'Twisting the shaft' },
    { t: 'box', c: 'union', b: [0.32, 0.95, 0.32, 0.04], pos: [0, 0, 0], at: 0, mat: 0, cap: 'A square shaft' },
    { t: 'cyl', c: 'sub', b: [0.07, 1.0, 0], pos: [0, 0, 0], rep: 4, repR: 0.32, lerp: 0.035, at: 1, mat: 0, cap: 'Fluting the four faces' },
    { t: 'box', c: 'union', b: [0.55, 0.12, 0.55, 0.03], pos: [0, -1.05, 0], k: 0.05, at: 2, mat: 1, cap: 'The plinth' },
    { t: 'box', c: 'union', b: [0.55, 0.12, 0.55, 0.03], pos: [0, 1.05, 0], k: 0.05, at: 3, mat: 1, cap: 'The capital' },
    { t: 'round', b: [0.01], at: 5, cap: 'Breaking every edge' },
  ] },
  { name: 'Lava blobs', note: 'Spheres joined by a smooth minimum', mats: [[1.0, 0.42, 0.12, 0.15], [0.95, 0.2, 0.45, 0.15], [1.0, 0.75, 0.2, 0.2], [1.0, 0.6, 0.3, 0.3]], ops: [
    { t: 'sphere', c: 'union', b: [0.7], pos: [0, -0.3, 0], mat: 0, cap: 'One sphere' },
    { t: 'sphere', c: 'union', b: [0.45], pos: [0.75, 0.35, 0.1], k: 0.5, mat: 1, cap: 'A second sphere melts in' },
    { t: 'sphere', c: 'union', b: [0.5], pos: [-0.7, 0.25, -0.2], k: 0.5, mat: 2, cap: 'A third melts in' },
    { t: 'sphere', c: 'union', b: [0.35], pos: [0.1, 0.85, -0.4], k: 0.5, mat: 0, cap: 'A fourth, higher up' },
    { t: 'sphere', c: 'union', b: [0.4], pos: [-0.2, -0.2, 0.8], k: 0.5, mat: 1, cap: 'A fifth, in front' },
    { t: 'sphere', c: 'union', b: [0.38], pos: [0.3, -0.4, -0.7], k: 0.5, mat: 2, cap: 'A sixth, behind' },
  ] },
  { name: 'Studded plate', note: 'One machined stud, repeated on a grid', mats: [[0.72, 0.75, 0.8, 0.85], [0.4, 0.42, 0.48, 0.7], [0.9, 0.9, 0.9, 0.1], [1.0, 0.8, 0.55, 0.8]], ops: [
    { t: 'box', c: 'union', b: [1.2, 0.3, 0.6, 0.03], pos: [0, -0.9, 0], at: 0, mat: 0, cap: 'A steel plate' },
    { t: 'grid', b: [0.4, 2, 1], at: 2, cap: 'Repeating it on a grid' },
    { t: 'cyl', c: 'union', b: [0.13, 0.08, 0.02], pos: [0, -0.52, 0], k: 0.02, at: 1, mat: 0, cap: 'One stud' },
    { t: 'cyl', c: 'sub', b: [0.06, 0.2, 0], pos: [0, -0.45, 0], slide: UP, at: 3, mat: 3, cap: 'Coring every stud' },
  ] },
];

// The plate formulas: TeX for the op kind and for the primitive, plus a
// plain Unicode fallback.
const KIND = {
  union: { tex: String.raw`d \leftarrow \operatorname{smin}(d,\,d_i,\,k),\quad \operatorname{smin}=\min(a,b)-\tfrac{k}{4}h^2,\ h=\tfrac{\max(k-|a-b|,\,0)}{k}`, eq: 'd ← smin(d, dᵢ, k)' },
  sub: { tex: String.raw`d \leftarrow \max(d,\,-d_i)`, eq: 'd ← max(d, −dᵢ)' },
  inter: { tex: String.raw`d \leftarrow \max(d,\,d_i)`, eq: 'd ← max(d, dᵢ)' },
  onion: { tex: String.raw`d \leftarrow \bigl|d\bigr| - t`, eq: 'd ← |d| − t' },
  round: { tex: String.raw`d \leftarrow d - r`, eq: 'd ← d − r' },
  twist: { tex: String.raw`(x,\,z) \leftarrow R(a\,y)\,(x,\,z)`, eq: '(x, z) ← R(a·y)(x, z)' },
  grid: { tex: String.raw`p \leftarrow p - s\,\operatorname{clamp}\!\bigl(\operatorname{round}(p/s),\,-n,\,n\bigr)`, eq: 'p ← p − s·clamp(round(p/s), −n, n)' },
};
const PRIM = {
  sphere: String.raw`d_i = \|p\| - r`,
  box: String.raw`d_i = \bigl\|\max(|p|-b,\,0)\bigr\| + \min\bigl(\max_j(|p_j|-b_j),\,0\bigr) - r`,
  torus: String.raw`d_i = \bigl\|\bigl(\|p_{xz}\|-R,\ p_y\bigr)\bigr\| - r`,
  cyl: String.raw`d_i = \bigl\|\max\bigl((\|p_{xz}\|,\,|p_y|)-(r,\,h),\,0\bigr)\bigr\| + \min(\max(\cdot),\,0)`,
  capsule: String.raw`d_i = \bigl\|p - (0,\ \operatorname{clamp}(p_y,-h,h),\ 0)\bigr\| - r`,
  cone: String.raw`d_i = \text{capped cone}(r_1,\,r_2,\,h)`,
  half: String.raw`d_i = h - p_y`,
  ellipsoid: String.raw`d_i \approx k_0(k_0-1)/k_1,\quad k_0=\|p/r\|,\ k_1=\|p/r^2\|`,
  gyroid: String.raw`d_i = \tfrac{0.55}{f}\,\bigl|\sin(fp)\cdot\cos(fp_{zxy})\bigr| - t`,
};
const REP = String.raw`\theta \leftarrow \theta - \tfrac{2\pi}{n}\operatorname{round}\!\bigl(\tfrac{n\,\theta}{2\pi}\bigr)`;

// Backdrops (linear, before the tone map): top, bottom, accent.
const BACKDROPS = [
  [[0.1, 0.11, 0.17], [0.02, 0.02, 0.035], [0.45, 0.6, 1.0]],
  [[0.16, 0.1, 0.08], [0.03, 0.02, 0.02], [1.0, 0.55, 0.25]],
  [[0.07, 0.13, 0.12], [0.01, 0.03, 0.03], [0.3, 1.0, 0.75]],
  [[0.14, 0.09, 0.16], [0.025, 0.015, 0.035], [0.95, 0.45, 1.0]],
];

// ---------------------------------------------------------------- packing
const ease = x => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
function rotRows(deg = [0, 0, 0]) {
  // world-to-local rows: the inverse of R = Rz Ry Rx (the solid's own turn)
  const [x, y, z] = deg.map(v => v * D2R), cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const R = [[cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx], [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx], [-sy, cy * sx, cy * cx]];
  return [[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]];
}
// Normalise a recipe op once: numeric type and combine, rows, defaults.
function prep(op, i) {
  const b = [0, 0, 0, 0]; (op.b || []).forEach((v, j) => { b[j] = v; });
  return { ...op, ti: T[op.t], ci: C[op.c] ?? 0, b, pos: op.pos || [0, 0, 0], rows: rotRows(op.rot), rep: op.rep || 0, repR: op.repR || 0,
    slide: op.slide || [0, 0, 0], lerp: +op.lerp || 0, k: op.k || 0, mat: op.mat || 0, at: op.at ?? i, pr: 0 };
}
// One op as 7 vec4 (28 floats), the WGSL Op layout.
function packOp(o, f, at) {
  f.set([o.ti, o.ci, o.pr, o.k, ...o.b, ...o.pos, o.rep, ...o.rows[0], o.mat, ...o.rows[1], o.lerp, ...o.rows[2], 0, ...o.slide, o.repR], at);
}

// ---------------------------------------------------------------- JS port
// The same walk as mapM in shaders/saver.wgsl, for saver-test.mjs.
const len3 = (x, y, z) => Math.hypot(x, y, z);
function prim(t, q, b) {
  const [x, y, z] = q;
  switch (t) {
    case 0: return len3(x, y, z) - b[0];
    case 1: { const dx = Math.abs(x) - b[0] + b[3], dy = Math.abs(y) - b[1] + b[3], dz = Math.abs(z) - b[2] + b[3];
      return len3(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dy, dz), 0) - b[3]; }
    case 2: return Math.hypot(Math.hypot(x, z) - b[0], y) - b[1];
    case 3: { const dx = Math.hypot(x, z) - b[0] + b[2], dy = Math.abs(y) - b[1] + b[2];
      return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - b[2]; }
    case 4: { const yy = Math.min(b[0], Math.max(-b[0], y)); return len3(x, y - yy, z) - b[1]; }
    case 5: { const h = b[2], wx = Math.hypot(x, z), wy = y, k1 = [b[1], h], k2 = [b[1] - b[0], 2 * h];
      const ca = [wx - Math.min(wx, wy < 0 ? b[0] : b[1]), Math.abs(wy) - h];
      const tt = Math.min(1, Math.max(0, ((k1[0] - wx) * k2[0] + (k1[1] - wy) * k2[1]) / (k2[0] * k2[0] + k2[1] * k2[1])));
      const cb = [wx - k1[0] + k2[0] * tt, wy - k1[1] + k2[1] * tt];
      const s = cb[0] < 0 && ca[1] < 0 ? -1 : 1;
      return s * Math.sqrt(Math.min(ca[0] * ca[0] + ca[1] * ca[1], cb[0] * cb[0] + cb[1] * cb[1])); }
    case 6: return b[0] - y;
    case 7: { const k0 = len3(x / b[0], y / b[1], z / b[2]), k1 = len3(x / (b[0] * b[0]), y / (b[1] * b[1]), z / (b[2] * b[2])); return k0 * (k0 - 1) / Math.max(k1, 1e-5); }
    case 8: { const f = b[0], g = Math.sin(x * f) * Math.cos(z * f) + Math.sin(y * f) * Math.cos(x * f) + Math.sin(z * f) * Math.cos(y * f); return Math.abs(g) / f * 0.55 - b[1]; }
    default: return 1e5;
  }
}
const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
function opDist(o, p) {
  const pr = o.pr;
  let q = [0, 1, 2].map(j => p[j] - (o.pos[j] + o.slide[j] * (1 - pr)));
  q = o.rows.map(r => r[0] * q[0] + r[1] * q[1] + r[2] * q[2]);
  if (o.rep > 0.5) {
    const sec = 2 * Math.PI / o.rep, a = Math.atan2(q[2], q[0]), a2 = a - sec * Math.round(a / sec), rr = Math.hypot(q[0], q[2]);
    q = [rr * Math.cos(a2) - o.repR, q[1], rr * Math.sin(a2)];
  }
  let d;
  if (o.ci === 0) { const sc = Math.max(pr, 1e-3); d = prim(o.ti, q.map(v => v / sc), o.b) * sc; }
  else d = prim(o.ti, q, o.b);
  if (o.lerp) { const L = o.lerp; if (o.ci === 1) d = L + (d - L) * pr; if (o.ci === 2) d = -L + (d + L) * pr; }
  return d;
}
function mapM(ops, p0) {
  let p = p0.slice(), d = 1e5;
  for (const o of ops) {
    const pr = o.pr;
    if (pr <= 0) continue;
    if (o.ti >= 20) {
      if (o.ti === 20) d = d + (Math.abs(d) - o.b[0] - d) * pr;
      if (o.ti === 21) d = d - o.b[0] * pr;
      if (o.ti === 22) { const an = o.b[0] * pr * p[1], cs = Math.cos(an), sn = Math.sin(an); p = [cs * p[0] - sn * p[2], p[1], sn * p[0] + cs * p[2]]; }
      if (o.ti === 23) { const sp = 40 + (o.b[0] - 40) * pr, cl = (v, n) => Math.min(n, Math.max(-n, Math.round(v / sp)));
        p = [p[0] - sp * cl(p[0], o.b[1]), p[1], p[2] - sp * cl(p[2], o.b[2])]; }
      continue;
    }
    const dp = opDist(o, p);
    if (o.ci === 0) d = smin(d, dp, o.k * pr);
    else if (o.ci === 1) d = smax(d, -dp, o.k);
    else d = smax(d, dp, o.k);
  }
  return d;
}

// ---------------------------------------------------------------- timeline
// The ops play in order of their step (at). Each step lasts T seconds. The
// op of the current step eases 0 -> 1; earlier steps are 1, later are 0.
function steps(ops) { return [...new Set(ops.map(o => o.at))].sort((a, b) => a - b); }
function timeline(ops, order, clock, T) {
  const s = Math.floor(clock / T), f = ease((clock - s * T) / T);
  for (const o of ops) { const k = order.indexOf(o.at); o.pr = k < s ? 1 : k === s ? f : 0; }
  return { step: Math.min(s, order.length - 1), f };
}

// The box of the solid built so far: the joined ops up to step s (all of
// them when s < 0), each as its position plus a radius from its size. The
// camera frames this box, so the first primitives fill the frame too.
function extent(ops, ord, s) {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const o of ops) {
    if (o.ti >= 20 || o.ci !== 0 || (s >= 0 && ord.indexOf(o.at) > s)) continue;
    const b = o.b, r = (o.ti === 2 || o.ti === 4 ? b[0] + b[1] : o.ti === 6 ? 0 : Math.max(b[0], b[1], b[2])) + o.repR;
    for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], o.pos[j] - r); hi[j] = Math.max(hi[j], o.pos[j] + r); }
  }
  if (lo[0] > hi[0]) return { c: [0, -0.2, 0], r: 1 };
  return { c: lo.map((v, j) => (v + hi[j]) / 2), r: Math.max(0.45, 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])) };
}

// The point a detail shot looks at: the op position (round the polar copy
// that faces the camera), pulled toward the solid centre so that it lies
// within 0.6 of the extent radius. A cutter centre is often outside the
// solid (the octant box of the gyroid core sits at (1.3, 1.3, 1.3)), and
// a shot aimed there puts the solid at the frame edge, under the plate.
function detailFocus(o, ex, az) {
  const f = o.pos.slice();
  if (o.rep) { f[0] += Math.sin(az) * o.repR; f[2] += Math.cos(az) * o.repR; }
  const v = f.map((x, j) => x - ex.c[j]), l = Math.hypot(...v), m = 0.6 * ex.r;
  return l > m ? ex.c.map((c, j) => c + v[j] * m / l) : f;
}

// ---------------------------------------------------------------- the hook
let CTX = null, ctxWait = [];
function setCtx(ctx) { CTX = ctx; ctxWait.forEach(f => f(ctx)); ctxWait = []; }
const getCtx = () => CTX ? Promise.resolve(CTX) : new Promise(r => ctxWait.push(r));

function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61); return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }

// The extract the plate shows: the combine step of mapM.
let CODE = '';
function codeExtract(src) {
  const a = src.indexOf('    let c = i32(o.a.y);'), b = src.indexOf('  return vec2f(d, m);');
  return a > 0 && b > a ? src.slice(a, b).replace(/^ {4}/gm, '').trimEnd() : '';
}

let run = null;
async function enter(opts = {}) {
  const ctx = await Promise.race([getCtx(), new Promise((_, no) => setTimeout(() => no(new Error('no GPU device')), 12000))]);
  const { device, format } = ctx;
  const src = await (await fetch(new URL('shaders/saver.wgsl', import.meta.url))).text();
  CODE = codeExtract(src);
  const module = device.createShaderModule({ code: src });
  const bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
  const pipe = await device.createRenderPipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_saver', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
  const FLOATS = 28 + 16 + MAX_OPS * 28, buf = device.createBuffer({ size: FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const data = new Float32Array(FLOATS), bind = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: buf } }] });

  const style = document.createElement('style');
  style.textContent = `html.sdf-saver, html.sdf-saver body { background: #000 !important; overflow: hidden !important; cursor: none !important; }
html.sdf-saver body > :not(.sdf-saver-canvas) { display: none !important; }
.sdf-saver-canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; z-index: 2147483647; background: #000; }`;
  document.head.appendChild(style);
  const canvas = document.createElement('canvas'); canvas.className = 'sdf-saver-canvas';
  document.body.appendChild(canvas); document.documentElement.classList.add('sdf-saver');
  const gpu = canvas.getContext('webgpu'); gpu.configure({ device, format, alphaMode: 'opaque' });

  const calm = Math.min(1, Math.max(0, opts.calm ?? 0.7)), R = rng(opts.seed);
  const order = RECIPES.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const STEP = 1.6 + 1.4 * calm, HOLD = 3 + 1.5 * calm, FADE = 0.7;
  const label = typeof opts.label === 'function' && opts.labels !== false ? opts.label : null;
  let ri = -1, rec = null, ops = null, ord = null, clock = 0, bd = null, cam = null, last = 0, labAt = -1, labStep = -1, raf = 0;

  const next = () => {
    ri++; rec = RECIPES[order[ri % order.length]];
    ops = rec.ops.map(prep); ord = steps(ops); clock = 0;
    bd = BACKDROPS[Math.floor(R() * BACKDROPS.length)];
    const az = R() * Math.PI * 2;
    const e0 = extent(ops, ord, 0);
    cam = { base: az, az, el: 0.45, dist: 1, rad: e0.r, tgt: e0.c, step: null, from: null, to: null, t: 1, spun: 0, spin: (R() < 0.5 ? -1 : 1) * (0.1 - 0.05 * calm) };
    labStep = -1;
  };
  // The orbit eye. dist 1 is the fit distance: the solid built so far
  // (extent, radius rad) fills 46% of the height, or 85% of the width on a
  // tall frame. A detail shot moves the target to the part and comes in to
  // 0.62 of it (0.8 on a tall frame).
  const camera = (dt, st, s) => {
    const o = ops.find(q => q.at === ord[s]);
    if (st !== cam.step) {
      cam.step = st;
      const ex = extent(ops, ord, st), tall = canvas.clientWidth < canvas.clientHeight;
      const detail = o && o.ti < 20 && st >= 0 && R() < 0.6, foc = detail ? detailFocus(o, ex, cam.az) : ex.c;
      cam.from = { el: cam.el, dist: cam.dist, rad: cam.rad, tgt: cam.tgt.slice(), base: cam.base };
      cam.to = { el: 0.25 + 0.5 * R(), dist: detail ? (tall ? 0.8 : 0.62) : 1, rad: ex.r, tgt: foc, daz: (R() - 0.5) * 1.2 };
      cam.t = 0;
    }
    cam.t = Math.min(1, cam.t + dt / 1.2);
    const e = ease(cam.t), f = cam.from, g = cam.to;
    cam.spun += dt;
    cam.base = f.base + g.daz * e; cam.az = cam.base + cam.spin * cam.spun;
    cam.el = f.el + (g.el - f.el) * e; cam.dist = f.dist + (g.dist - f.dist) * e; cam.rad = f.rad + (g.rad - f.rad) * e;
    cam.tgt = f.tgt.map((v, j) => v + (g.tgt[j] - v) * e);
  };
  const plate = (s, f) => {
    if (!label) return;
    const o = ops.find(q => q.at === ord[s]), done = clock >= ord.length * STEP;
    const kind = done ? null : o.ti >= 20 ? KIND[o.t] : KIND[o.c];
    const tex = done ? [KIND.union.tex, KIND.sub.tex] : [kind.tex].concat(o.ti < 20 ? [PRIM[o.t]] : []).concat(o.rep ? [REP] : []);
    const eq = done ? [KIND.union.eq, KIND.sub.eq] : [kind.eq];
    const params = [{ sym: 'i', name: 'step', value: `${Math.min(s + 1, ord.length)} of ${ord.length}` }, { sym: 'u', name: 'progress', value: `${Math.round(100 * (done ? 1 : f))}%` }];
    if (!done && o.ti < 20) params.push({ sym: 'k', name: o.c === 'union' ? 'blend radius' : 'edge blend', value: (o.c === 'union' ? o.k * o.pr : o.k).toFixed(3) });
    if (!done && o.rep) params.push({ sym: 'n', name: 'polar copies', value: String(o.rep) });
    if (!done && o.ti >= 20) params.push({ sym: o.t === 'twist' ? 'a' : o.t === 'grid' ? 's' : o.t === 'onion' ? 't' : 'r', name: o.t === 'twist' ? 'twist, rad per unit' : o.t === 'grid' ? 'spacing' : o.t === 'onion' ? 'shell thickness' : 'edge radius',
      value: (o.t === 'grid' ? 40 + (o.b[0] - 40) * o.pr : o.b[0] * o.pr).toFixed(3) });
    const info = { title: rec.name, sub: done ? `${rec.note}: ${ops.length} ops, finished` : o.cap, params, tex, eq,
      lines: [done ? 'The finished solid' : `${o.ti >= 20 ? 'Modifier' : o.c === 'union' ? 'Join' : o.c === 'sub' ? 'Carve' : 'Intersect'}: ${o.cap.toLowerCase()}`],
      code: CODE ? { lang: 'WGSL', name: 'fn mapM · saver.wgsl', text: CODE } : undefined };
    try { label(info); } catch (_) {}
  };

  const frame = now => {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
    const dpr = Math.min(1, devicePixelRatio || 1), w = Math.max(1, Math.round(canvas.clientWidth * dpr * 0.8)), h = Math.max(1, Math.round(canvas.clientHeight * dpr * 0.8));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    clock += dt;
    const total = ord.length * STEP + HOLD;
    if (clock > total + FADE) next();
    const { step, f } = timeline(ops, ord, Math.min(clock, ord.length * STEP - 1e-6), STEP);
    const done = clock >= ord.length * STEP;
    if (done) for (const o of ops) o.pr = 1;
    camera(dt, done ? -1 : step, step);
    if (done !== (labStep === -2) || (!done && step !== labStep) || now - labAt > 500) { labStep = done ? -2 : step; labAt = now; plate(step, f); }
    // camera: fit distance from the frame shape. The view lift (0.05 of the
    // half height on a wide frame, 0.12 on a tall one) puts the solid in the
    // clear band between the plate's logo and its formulas.
    const tanV = 0.42, asp = w / h, fit = cam.rad / Math.min(0.46 * tanV, 0.85 * tanV * asp), D = fit * cam.dist;
    const eye = [cam.tgt[0] + D * Math.cos(cam.el) * Math.sin(cam.az), cam.tgt[1] + D * Math.sin(cam.el), cam.tgt[2] + D * Math.cos(cam.el) * Math.cos(cam.az)];
    const fade = Math.min(1, clock / FADE, Math.max(0, (total + FADE - clock) / FADE));
    const act = done ? -1 : ops.indexOf(ops.find(q => q.at === ord[step] && q.ti < 20));
    const ghost = act >= 0 && ops[act].ci !== 0 ? Math.sin(Math.PI * Math.min(1, f * 1.15)) : 0;
    data.set([w, h, clock, fade, ...eye, tanV, ...cam.tgt, ops.length, act, ghost, -1.25, 2.6, ...bd[0], asp >= 1 ? 0.05 : 0.12, ...bd[1], 0, ...bd[2], 0], 0);
    rec.mats.forEach((m, j) => data.set(m, 28 + j * 4));
    ops.forEach((o, j) => packOp(o, data, 44 + j * 28));
    device.queue.writeBuffer(buf, 0, data);
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: gpu.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
    device.queue.submit([enc.finish()]);
  };
  next();
  raf = requestAnimationFrame(frame);
  run = { canvas, style, stop: () => cancelAnimationFrame(raf), buf };
  return { canvas, warmupMs: 1200 };
}
function exit() {
  if (!run) return;
  run.stop(); run.canvas.remove(); run.style.remove(); run.buf.destroy();
  document.documentElement.classList.remove('sdf-saver'); run = null;
}
function install() { window.snSaver = { enter, exit }; }

export const SAVER = { setCtx, install, RECIPES, prep, steps, timeline, mapM, opDist, extent, detailFocus, MAX_OPS };
