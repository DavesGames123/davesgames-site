// ============================================================================
//  THERMAL CONVECTION  ·  director.js — the screensaver shot director (no DOM)
// ----------------------------------------------------------------------------
//  The director chooses the shots of the screensaver and moves the slice
//  line and the block camera during each shot. saver.js owns the DOM part
//  (shell hook, in-page mode, plate). Node tests import this file directly.
//
//  A run is a seeded shuffle of SHOTS (12 shots, six kinds, two variants
//  of each kind). The same kind never comes twice in a row, also across
//  the end of one list and the start of the next. Each shot holds for
//  HOLD_S (8-14 s, longer when calm is high), then the director cuts.
//
//  Shot kinds:
//    granulation  surface view only, sun preset, solar palette. The slice
//                 drifts but its line is hidden (views.set sliceLine false).
//    onset        reset from rest (onset or hexagons preset): cells form.
//    cut          split view: the slice line sweeps across the surface.
//    plume        split view: the slice follows stats().plume, isotherms
//                 and arrows on.
//    block        cutaway block: slow orbit, the slice plane drifts.
//    soup         burner preset, broth palette, tracers on; the slice
//                 follows stats().hot (else the burner centre).
//
//  Warm starts: a shot calls app.applyPreset only when its preset is not
//  the one that runs. Then it asks app.prewarm(tff) (main.js) to run the
//  field for shot.warm free-fall times, so the flow is developed when the
//  shot shows. A shot with the same preset continues the running field.
//  An onset shot always resets from rest (app.reset(seed)).
//
//  Framing: frameShot() puts every rect inside the clear band of the
//  plate (plateBand of lib/saver-clear.js, or the in-page lower third),
//  with a margin. It asks layoutRects (render/layout.js) for the rects,
//  then scales and centres their union in the band. A box wider than
//  SIDE_ASPECT puts the split pair side by side (16:9). A tall box stacks
//  the surface over its section (9:16).
//
//  Exports (all pure, except createDirector which writes to app):
//    rng(seed), shuffle(a, rnd), smooth(u)
//    SHOTS, KINDS, HOLD_S, SIDE_ASPECT, SIDE_ZSCALE, PAD_K
//    buildShots(seed, { calm, aspect, avoid }) -> [shot]
//    clearBox(frame) -> { x, y, w, h }        frame = { W, H, band:{t,b,w} }
//    frameShot(shot, frame, layout, dims) -> { surface?, slice?, block? }
//    sliceThrough(pt, angle, dims) -> offset    the slice offset through pt
//    wrapOffset(o, angle, dims), period(angle, dims)
//    TEX, RULES, EQ, CODE_PLACEHOLDER, CODE_SOURCE, extractWgsl(src, marker)
//    fmtSci(x), labelParams(app) -> [{ sym, name, value, cls }]
//    createDirector(app, opts) -> { tick(dt), cut(key), debug(), stop() }
//
//  grep -n targets: "── SHOTS", "export function buildShots",
//  "export function frameShot", "export function sliceThrough",
//  "── LABEL", "CODE_PLACEHOLDER", "export function createDirector",
//  "function begin", "function move"
// ============================================================================

export const HOLD_S = [8, 14];
export const SIDE_ASPECT = 1.3;   // a clear box wider than this puts the split pair side by side
export const PAD_K = 0.03;        // margin inside the band, of its short side

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

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

// ── SHOTS ────────────────────────────────────────────────────────────────
// A variant: { kind, key, sub, preset, palette, view, toggles, warm (tff),
// fresh (reset from rest), speed?, aim ('plume' | 'hot' | null), sweep
// (fraction of the period the slice moves over the hold), zScale, surfaceZ }
const T = (tracers, arrows, isotherms, relief) => ({ tracers, arrows, isotherms, relief });
export const SHOTS = [
  { kind: 'granulation', key: 'granulation-solar', sub: 'Solar granulation', preset: 'granulation', palette: 'solar', view: 'surface', toggles: T(false, false, false, 0.8), warm: 40, sweep: 0.2, sliceLine: false, surfaceZ: 0.94 },
  { kind: 'granulation', key: 'granulation-deep', sub: 'Hot cells, cold lanes', preset: 'granulation', palette: 'inferno', view: 'surface', toggles: T(false, false, false, 0.5), warm: 40, sweep: 0.2, sliceLine: false, surfaceZ: 0.88 },
  { kind: 'onset', key: 'onset-rolls', sub: 'Onset of convection, Ra = 3000', preset: 'onset', palette: 'icefire', view: 'split', toggles: T(false, false, true, 0.3), warm: 30, fresh: true, speed: 3, sweep: 0 },
  { kind: 'onset', key: 'onset-hexagons', sub: 'Bénard–Marangoni hexagons', preset: 'hexagons', palette: 'broth', view: 'split', toggles: T(false, false, false, 0.6), warm: 8, fresh: true, speed: 2, sweep: 0 },
  { kind: 'cut', key: 'cut-benard', sub: 'Rayleigh–Bénard cells under the cut', preset: 'benard', palette: 'inferno', view: 'split', toggles: T(false, false, true, 0.4), warm: 30, sweep: 0.45 },
  { kind: 'cut', key: 'cut-turbulent', sub: 'Turbulent convection, Ra = 5·10⁶', preset: 'turbulent', palette: 'icefire', view: 'split', toggles: T(false, false, false, 0.4), warm: 30, sweep: 0.45 },
  { kind: 'plume', key: 'plume-turbulent', sub: 'A rising plume', preset: 'turbulent', palette: 'inferno', view: 'split', toggles: T(false, true, true, 0.3), warm: 30, aim: 'plume', sweep: 0 },
  { kind: 'plume', key: 'plume-burner', sub: 'The plume over the burner', preset: 'soup', palette: 'broth', view: 'split', toggles: T(false, true, true, 0.3), warm: 25, aim: 'plume', sweep: 0 },
  { kind: 'block', key: 'block-benard', sub: 'Inside the layer', preset: 'benard', palette: 'icefire', view: 'block', toggles: T(false, false, true, 0.4), warm: 30, sweep: 0.25 },
  { kind: 'block', key: 'block-sun', sub: 'Granulation in depth', preset: 'granulation', palette: 'solar', view: 'block', toggles: T(false, false, false, 0.6), warm: 40, sweep: 0.25 },
  { kind: 'soup', key: 'soup-pot', sub: 'A pot of soup on the burner', preset: 'soup', palette: 'broth', view: 'split', toggles: T(true, false, false, 0.5), warm: 25, aim: 'hot', sweep: 0 },
  { kind: 'soup', key: 'soup-block', sub: 'Broth from the side', preset: 'soup', palette: 'broth', view: 'block', toggles: T(true, false, false, 0.5), warm: 25, sweep: 0.2 },
];
export const KINDS = [...new Set(SHOTS.map(s => s.kind))];

// The vertical exaggeration of a side-by-side split shot: 2.3 x or more.
export const SIDE_ZSCALE = 2.3;
const sideZ = (z, side, rnd) => (side ? Math.max(z, SIDE_ZSCALE + 0.2 * rnd()) : z);

const validOrder = (l, avoid) => l.every((s, i) => (i === 0 ? s.kind !== avoid : s.kind !== l[i - 1].kind));

// The shot list of one run. aspect: the clear box w / h (it sets the
// split layout and the vertical exaggeration). avoid: the kind that ended
// the last list (the first shot of this list is not of that kind).
export function buildShots(seed, opts = {}) {
  const rnd = rng(seed), calm = clamp(opts.calm ?? 0.7, 0, 1);
  const aspect = opts.aspect > 0 ? opts.aspect : 16 / 9;
  const out = SHOTS.map(v => {
    const side = v.view === 'split' && aspect > SIDE_ASPECT;
    return {
      ...v, toggles: { ...v.toggles },
      hold: HOLD_S[0] + (HOLD_S[1] - HOLD_S[0] - 2) * calm + 2 * rnd(),
      side,
      // a thin layer stays legible: 1.6-2.2 x, the section label names it.
      // Side by side, the band height sets the section height: 2.3-2.5 x
      // keeps the section over 22% of the short side (saver.test.mjs).
      zScale: sideZ(v.view === 'block' ? 1.4 : 1.6 + 0.6 * rnd(), side, rnd),
      surfaceZ: v.surfaceZ ?? 0.94,
      angle: rnd() < 0.5 ? 0 : Math.PI / 2,
      from: rnd() - 0.5,                                    // slice start, fraction of the period
      dir: rnd() < 0.5 ? -1 : 1,
      yaw0: (rnd() - 0.5) * 1.6 + (rnd() < 0.5 ? 0 : Math.PI),
      pitch: 0.42 + 0.16 * rnd(),
      yawRate: (rnd() < 0.5 ? -1 : 1) * (0.03 + 0.03 * rnd()) * (1 - 0.4 * calm),
      seed: (rnd() * 2 ** 31) >>> 0,
    };
  });
  for (let k = 0; k < 64; k++) {
    shuffle(out, rnd);
    if (validOrder(out, opts.avoid)) return out;
  }
  // repair: swap each repeat with the first later shot that fits
  for (let i = 0; i < out.length; i++) {
    const prev = i ? out[i - 1].kind : opts.avoid;
    if (out[i].kind !== prev) continue;
    const j = out.findIndex((s, m) => m > i && s.kind !== prev && (i + 1 >= out.length || m === i + 1 || s.kind !== out[i + 1]?.kind));
    if (j > 0) [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── FRAMING ──────────────────────────────────────────────────────────────
// The clear box: the band between the plate texts, inside the visible
// column (band.w, the 9:16 column of the shell), less a margin.
export function clearBox(frame) {
  const { W, H } = frame, b = frame.band || { t: 0, b: 0, w: W };
  const cw = Math.min(W, b.w || W), l = (W - cw) / 2;
  const t = clamp(b.t || 0, 0, H * 0.7), bot = clamp(b.b || 0, 0, H * 0.7 - t);
  const h = H - t - bot, pad = PAD_K * Math.min(cw, h);
  return { x: l + pad, y: t + pad, w: cw - 2 * pad, h: h - 2 * pad };
}

const RECT_KEYS = ['surface', 'slice', 'block'];
function union(rs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// The rects of a shot in frame px. layout = layoutRects of render/layout.js:
// layout(w, h, view, clear, { side, zScale, Lx, Ly }). The union of the
// rects is then scaled down (never up) to fit the box and centred in it,
// so a layout that ignores clear still lands in the band.
export function frameShot(shot, frame, layout, dims = {}) {
  const box = clearBox(frame);
  const clear = { t: box.y, b: frame.H - box.y - box.h, l: box.x, r: frame.W - box.x - box.w };
  const raw = layout(frame.W, frame.H, shot.view, clear, { side: !!shot.side, zScale: shot.zScale, Lx: dims.Lx ?? 4, Ly: dims.Ly ?? 4 }) || {};
  const keys = RECT_KEYS.filter(k => raw[k] && raw[k].w > 0 && raw[k].h > 0);
  if (!keys.length) return {};
  const u = union(keys.map(k => raw[k]));
  const s = Math.min(1, box.w / u.w, box.h / u.h);
  const ox = box.x + (box.w - u.w * s) / 2, oy = box.y + (box.h - u.h * s) / 2;
  const out = {};
  for (const k of keys) {
    const r = raw[k];
    out[k] = { x: ox + (r.x - u.x) * s, y: oy + (r.y - u.y) * s, w: r.w * s, h: r.h * s };
  }
  return out;
}

// ── SLICE ────────────────────────────────────────────────────────────────
// The slice plane through the box centre c moved by offset along the
// normal n = (-sin a, cos a). period(): the repeat distance along n
// (exact for a = 0 and a = pi/2, the angles the director uses).
export function period(angle, dims = {}) {
  const Lx = dims.Lx ?? 4, Ly = dims.Ly ?? 4;
  return Math.abs(Math.cos(angle)) * Ly + Math.abs(Math.sin(angle)) * Lx;
}
export function wrapOffset(o, angle, dims) {
  const P = period(angle, dims);
  return ((((o + P / 2) % P) + P) % P) - P / 2;
}
export function sliceThrough(pt, angle, dims = {}) {
  const Lx = dims.Lx ?? 4, Ly = dims.Ly ?? 4;
  const dx = pt[0] - Lx / 2, dy = pt[1] - Ly / 2;
  return wrapOffset(-Math.sin(angle) * dx + Math.cos(angle) * dy, angle, dims);
}

// ── LABEL ────────────────────────────────────────────────────────────────
// The momentum and heat equations (free-fall units), colour-coded: m1
// advection, m2 pressure, m3 viscosity, m4 buoyancy, m5 diffusion.
export const TEX = [
  '\\frac{\\partial \\mathbf{u}}{\\partial t} + (\\mathbf{u}\\cdot\\nabla)\\mathbf{u} = -\\nabla p + \\sqrt{\\mathrm{Pr}/\\mathrm{Ra}}\\,\\nabla^2\\mathbf{u} + T\\,\\hat{\\mathbf{z}}',
  '\\frac{\\partial T}{\\partial t} + \\mathbf{u}\\cdot\\nabla T = \\frac{1}{\\sqrt{\\mathrm{Ra}\\,\\mathrm{Pr}}}\\,\\nabla^2 T',
];
export const RULES = [
  ['(\\mathbf{u}\\cdot\\nabla)\\mathbf{u}', 'm1'],
  ['\\mathbf{u}\\cdot\\nabla T', 'm1'],
  ['-\\nabla p', 'm2'],
  ['\\sqrt{\\mathrm{Pr}/\\mathrm{Ra}}\\,\\nabla^2\\mathbf{u}', 'm3'],
  ['T\\,\\hat{\\mathbf{z}}', 'm4'],
  ['\\frac{1}{\\sqrt{\\mathrm{Ra}\\,\\mathrm{Pr}}}\\,\\nabla^2 T', 'm5'],
];
export const EQ = [
  '∂u/∂t + (u·∇)u = −∇p + √(Pr/Ra) ∇²u + T ẑ',
  '∂T/∂t + u·∇T = ∇²T / √(Ra Pr)',
];

// CODE_SOURCE is the real extract: the tri kernel of shaders/sim-tri.wgsl,
// where the implicit solves of U, V and T run and the new T then pushes W
// (the buoyancy term + T z_hat). saver.js loads the file once and cuts it
// with extractWgsl. CODE_PLACEHOLDER shows only until that fetch is done,
// or when the fetch fails. It is a sketch of the same term, not SIM code.
export const CODE_PLACEHOLDER = {
  lang: 'wgsl', name: 'sim · buoyancy and viscosity', placeholder: true,
  text: [
    '@compute @workgroup_size(8, 8, 4)',
    'fn forces(@builtin(global_invocation_id) g: vec3<u32>) {',
    '  let i = cell(g);',
    '  var u = vel[i].xyz;',
    '  let nu = sqrt(P.Pr / P.Ra);           // free-fall units',
    '  u += P.dt * (nu * lap_u(g));          // viscosity',
    '  u.z += P.dt * temp[i];                // buoyancy: + T z_hat',
    '  vel[i] = vec4<f32>(u, 0.0);',
    '}',
  ].join('\n'),
};
export const CODE_SOURCE = { url: 'shaders/sim-tri.wgsl', marker: /let tw = 0\.5 \* dt/, name: 'sim-tri.wgsl · implicit solves and buoyancy' };

// The function of src around the first line that matches marker: from its
// attribute or fn line to the closing brace, at most max lines.
export function extractWgsl(src, marker, max = 12) {
  const lines = String(src || '').replace(/\t/g, '  ').split('\n');
  const m = marker instanceof RegExp ? marker : new RegExp(String(marker), 'i');
  const at = lines.findIndex(l => m.test(l));
  if (at < 0) return null;
  let s = at;
  while (s > 0 && !/^\s*fn\s/.test(lines[s])) s--;
  if (!/^\s*fn\s/.test(lines[s])) return null;
  while (s > 0 && /^\s*@/.test(lines[s - 1])) s--;
  let depth = 0, e = s, opened = false;
  for (; e < lines.length; e++) {
    for (const c of lines[e]) { if (c === '{') { depth++; opened = true; } else if (c === '}') depth--; }
    if (opened && depth <= 0) break;
  }
  let body = lines.slice(s, e + 1);
  if (body.length > max) {
    // keep the head and the lines around the marker
    const k = at - s, keep = max - 2, from = clamp(k - Math.floor(keep / 2), 2, body.length - keep);
    body = [...body.slice(0, 2), ...body.slice(from, from + keep - 1), '  …'];
  }
  return body.join('\n');
}

// 100000 -> '1.0 × 10⁵'
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export function fmtSci(x) {
  if (!Number.isFinite(x)) return '–';
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x))), m = x / 10 ** e;
  if (e >= -1 && e <= 3) return String(+x.toPrecision(3));
  return `${m.toFixed(1)} × 10${String(e).split('').map(c => SUP[c]).join('')}`;
}

function readStats(app) {
  try { return app.sim && typeof app.sim.stats === 'function' ? app.sim.stats() : null; } catch { return null; }
}

// The live parameters of the plate: Ra, Pr, Nu, t.
export function labelParams(app) {
  const p = app.params || (app.sim && app.sim.params) || {};
  const st = readStats(app) || {};
  const t = Number.isFinite(st.simTime) ? st.simTime : (app.sim && Number.isFinite(app.sim.time) ? app.sim.time : NaN);
  return [
    { sym: '\\mathrm{Ra}', name: 'Rayleigh number', value: fmtSci(p.Ra), cls: 'm4' },
    { sym: '\\mathrm{Pr}', name: 'Prandtl number', value: Number.isFinite(p.Pr) ? String(+p.Pr.toPrecision(3)) : '–', cls: 'm3' },
    { sym: '\\mathrm{Nu}', name: 'Nusselt number', value: Number.isFinite(st.Nu) ? st.Nu.toFixed(2) : '–', cls: 'm5' },
    { sym: 't', name: 'time', value: Number.isFinite(t) ? `${t.toFixed(1)} tff` : '–', cls: 'm6' },
  ];
}

// ── DIRECTOR ─────────────────────────────────────────────────────────────
// opts: { seed, calm, layout, fitBlock?, frame: () => { W, H, band } }
// app (main.js): applyPreset(id), setView(v), setSlice({ angle, offset }),
// reset(seed), prewarm?(tff), sim (dims, set, stats, params), views (set),
// and the fields palette, toggles, surfaceZ, zScale, cam, rects, preset.
export function createDirector(app, opts = {}) {
  const calm = clamp(opts.calm ?? 0.7, 0, 1);
  const layout = opts.layout, frame = opts.frame || (() => ({ W: 1280, H: 720, band: null }));
  let seed = (opts.seed >>> 0) || 1;
  let list = null, i = -1, shot = null, t = 0, stopped = false, shots = 0, preset = null;
  let offset = 0, angle = 0, lastFrame = null, rects = {}, lastKind = null, aimPt = null;
  const log = [];

  const dims = () => {
    const d = (app.sim && app.sim.dims) || {};
    const p = app.params || {};
    return { Lx: d.Lx ?? p.Lx ?? 4, Ly: d.Ly ?? p.Ly ?? 4 };
  };
  const call = (name, ...a) => { try { if (typeof app[name] === 'function') return app[name](...a); } catch (e) { if (typeof console !== 'undefined') console.warn(e); } return undefined; };

  function newList() {
    const f = frame(), b = clearBox(f);
    list = buildShots(seed++, { calm, aspect: b.w / Math.max(1, b.h), avoid: lastKind });
    i = -1;
  }

  // The rect aspect of the frame decides side by side; a resize between
  // lists (rotation) flips it for the shots still to come.
  function sideFor(s, f) {
    const b = clearBox(f);
    return s.view === 'split' && b.w / Math.max(1, b.h) > SIDE_ASPECT;
  }

  function aimPoint(s) {
    const st = readStats(app), d = dims();
    if (s.aim === 'plume' && st && Array.isArray(st.plume)) return st.plume;
    if (st && Array.isArray(st.hot) && (s.aim === 'hot' || s.aim === 'plume')) return st.hot;
    const bu = (app.params && app.params.burner) || { x: 0.5, y: 0.5 };
    return [bu.x * d.Lx, bu.y * d.Ly];
  }

  function look(s) {
    app.palette = s.palette;
    app.toggles = { ...(app.toggles || {}), ...s.toggles };
    app.surfaceZ = s.surfaceZ;
    app.zScale = s.zScale;
    try {
      if (app.views && typeof app.views.set === 'function') {
        app.views.set({ palette: s.palette, surfaceZ: s.surfaceZ, zScale: s.zScale, sliceLine: s.sliceLine !== false, ...s.toggles });
      }
    } catch (e) { if (typeof console !== 'undefined') console.warn(e); }
  }

  // ── begin: the cut to shot s ──
  function begin(s) {
    const cur = app.preset ?? preset;
    let warmed = 0, reset = false;
    if (s.fresh) {
      call('applyPreset', s.preset);
      call('reset', s.seed);
      reset = true;
      if (s.warm > 0 && typeof app.prewarm === 'function') { call('prewarm', s.warm); warmed = s.warm; }
    } else if (cur !== s.preset) {
      call('applyPreset', s.preset);
      if (s.warm > 0 && typeof app.prewarm === 'function') { call('prewarm', s.warm); warmed = s.warm; }
    }
    preset = s.preset;
    if (app.preset !== undefined) app.preset = s.preset;
    try {
      if (app.sim && typeof app.sim.set === 'function') app.sim.set({ speed: s.speed || 1 });
    } catch (e) { if (typeof console !== 'undefined') console.warn(e); }
    call('setView', s.view);
    look(s);
    const d = dims();
    angle = s.angle;
    aimPt = s.aim ? aimPoint(s) : null;
    offset = aimPt ? sliceThrough(aimPt, angle, d) : wrapOffset(s.from * period(angle, d), angle, d);
    call('setSlice', { angle, offset });
    log.push({ key: s.key, kind: s.kind, preset: s.preset, warmed, reset });
    if (log.length > 64) log.shift();
  }

  function next() {
    if (!list || i + 1 >= list.length) newList();
    i++;
    const f = frame();
    shot = { ...list[i] };
    shot.side = sideFor(shot, f);
    if (shot.side) shot.zScale = Math.max(shot.zScale, SIDE_ZSCALE);
    t = 0; shots++;
    lastKind = shot.kind;
    begin(shot);
  }

  // ── move: the slice and the camera during the hold ──
  function move(dt) {
    const s = shot, d = dims(), P = period(angle, d), u = t / s.hold;
    if (s.aim) {
      // follow the sim target slowly (calm): ease the offset toward it
      const pt = aimPoint(s);
      if (pt) aimPt = pt;
      const goal = sliceThrough(aimPt, angle, d);
      const k = 1 - Math.exp(-dt / (1.2 + calm));
      offset = wrapOffset(offset + wrapOffset(goal - offset, angle, d) * k, angle, d);
    } else if (s.sweep) {
      offset = wrapOffset((s.from + s.dir * s.sweep * smooth(u)) * P, angle, d);
    }
    call('setSlice', { angle, offset });
    if (s.view === 'block') {
      const r = rects.block;
      const yaw = s.yaw0 + s.yawRate * t;
      const target = [d.Lx / 2, d.Ly / 2, 0.5];
      let cam = { yaw, pitch: s.pitch, dist: null, target };
      if (typeof opts.fitBlock === 'function' && r) {
        try {
          const base = opts.fitBlock({ ...(app.sim && app.sim.dims), Lx: d.Lx, Ly: d.Ly, Lz: s.zScale }, r.w / r.h) || {};
          cam = { ...base, yaw, pitch: s.pitch, dist: Number.isFinite(base.dist) ? base.dist * 1.08 : null, target: base.target || target };
        } catch (e) { if (typeof console !== 'undefined') console.warn(e); }
      }
      app.cam = cam;
      try { if (app.views && typeof app.views.set === 'function') app.views.set({ cam }); } catch { /* views gone */ }
    }
  }

  function place() {
    const f = frame();
    lastFrame = f;
    rects = typeof layout === 'function' ? frameShot(shot, f, layout, dims()) : {};
    app.rects = rects;
  }

  return {
    // Advance dt s. Writes app.rects, the slice and the camera. Returns
    // false after stop().
    tick(dt) {
      if (stopped) return false;
      dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
      if (!shot) next();
      else {
        t += dt;
        if (t >= shot.hold) next();
      }
      place();
      move(shot === null ? 0 : dt);
      return true;
    },
    // Cut now to the next shot of a kind or key (any shot when key is empty).
    cut(key) {
      if (stopped) return false;
      if (!list) newList();
      const j = list.findIndex((s, m) => m > i && (!key || s.kind === key || s.key === key));
      if (j < 0) {
        const k = SHOTS.find(s => s.kind === key || s.key === key);
        if (!k) return false;
        newList();
        const m = list.findIndex(s => s.key === k.key);
        [list[0], list[m]] = [list[m], list[0]];
        i = -1;
      } else {
        // move the chosen shot to i + 1, so the rest of the list still plays
        const [x] = list.splice(j, 1);
        list.splice(i + 1, 0, x);
      }
      next(); place(); move(0);
      return true;
    },
    debug() {
      return {
        seed, i, n: list ? list.length : 0, shots, calm,
        kind: shot && shot.kind, key: shot && shot.key, sub: shot && shot.sub, view: shot && shot.view, side: shot && shot.side,
        t: +t.toFixed(3), hold: shot ? +shot.hold.toFixed(3) : 0,
        preset, slice: { angle, offset }, aim: aimPt, cam: app.cam, rects, box: lastFrame ? clearBox(lastFrame) : null, log: log.slice(),
      };
    },
    get shot() { return shot; },
    stop() { stopped = true; },
  };
}
