// THERMAL CONVECTION · tests/saver.test.mjs — package SAVER: the seeded
// shot list (varies per run, no kind twice in a row, holds 8-14 s), the
// framing of every shot kind inside the clear band for 16:9, 9:16, the
// shell 9:16 column and a phone (rects in the band, min side >= 22% of the
// frame's short side, split stacks in 9:16), a ten-minute director run on
// a stubbed app (cut interval, warm starts, sim-aimed slices, calm moves),
// the WGSL extract, and the shell and in-page modes on a fake DOM (no
// browser). It uses render/layout.js when that file exists, else a stub
// that follows the CONTRACT.md layoutRects interface.
import { existsSync } from 'node:fs';
import {
  buildShots, frameShot, clearBox, createDirector, sliceThrough, wrapOffset, period,
  extractWgsl, fmtSci, labelParams, SHOTS, KINDS, HOLD_S, TEX, CODE_PLACEHOLDER,
} from '../director.js';
import { installSaver, shellLabel } from '../saver.js';

const page = new URL('../', import.meta.url);

// ── layoutRects stub (CONTRACT.md "render/layout.js") ──
// layoutRects(w, h, view, clear, { side, zScale, Lx, Ly }). The surface
// keeps Lx : Ly, the slice keeps cut length : zScale (cut along x).
function stubLayout(w, h, view, clear = { t: 0, b: 0, l: 0, r: 0 }, o = {}) {
  const Lx = o.Lx ?? 4, Ly = o.Ly ?? 4, z = o.zScale ?? 1, g = 8;
  const x0 = clear.l, y0 = clear.t, W = w - clear.l - clear.r, H = h - clear.t - clear.b;
  const cen = (rw, rh) => ({ x: x0 + (W - rw) / 2, y: y0 + (H - rh) / 2, w: rw, h: rh });
  if (view === 'block') return { block: { x: x0, y: y0, w: W, h: H } };
  if (view === 'surface') { const s = Math.min(W / Lx, H / Ly); return { surface: cen(s * Lx, s * Ly) }; }
  if (view === 'slice') { const s = Math.min(W / Lx, H / z); return { slice: cen(s * Lx, s * z) }; }
  if (o.side) {
    // surface height = slice height = s * Ly
    const s = Math.min(H / Ly, (W - g) / (Lx + Lx * Ly / z));
    const sw = s * Lx, sh = s * Ly, cw = sh * Lx / z, tot = sw + g + cw;
    const ox = x0 + (W - tot) / 2, oy = y0 + (H - sh) / 2;
    return { surface: { x: ox, y: oy, w: sw, h: sh }, slice: { x: ox + sw + g, y: oy, w: cw, h: sh } };
  }
  const s = Math.min(W / Lx, (H - g) / (Ly + z));
  const rw = s * Lx, tot = s * Ly + g + s * z, ox = x0 + (W - rw) / 2, oy = y0 + (H - tot) / 2;
  return { surface: { x: ox, y: oy, w: rw, h: s * Ly }, slice: { x: ox, y: oy + s * Ly + g, w: rw, h: s * z } };
}

// The frames: shell plate bands (lib/screensaver.js poster: about 24% top,
// 30% bottom), the shell 9:16 column on a landscape screen, the in-page
// lower third, and a phone.
const FRAMES = [
  { tag: 'shell 16:9', W: 1920, H: 1080, band: { t: 260, b: 320, w: 1920 } },
  { tag: 'shell 9:16', W: 1080, H: 1920, band: { t: 420, b: 560, w: 1080 } },
  { tag: 'shell 9:16 column', W: 1920, H: 1080, band: { t: 230, b: 300, w: 1080 * 9 / 16 } },
  { tag: 'page 16:9', W: 1600, H: 900, band: { t: 45, b: 190, w: 1600 } },
  { tag: 'page 9:16', W: 900, H: 1600, band: { t: 80, b: 330, w: 900 } },
  { tag: 'phone', W: 390, H: 844, band: { t: 42, b: 230, w: 390 } },
];
const portrait = f => Math.min(f.W, f.band.w) < f.H;

// The real band of a frame (no margin): the rects must sit in it.
function bandBox(f) {
  const cw = Math.min(f.W, f.band.w), l = (f.W - cw) / 2;
  return { x: l, y: f.band.t, w: cw, h: f.H - f.band.t - f.band.b };
}
const inside = (r, b) => r.x >= b.x - 0.5 && r.y >= b.y - 0.5 && r.x + r.w <= b.x + b.w + 0.5 && r.y + r.h <= b.y + b.h + 0.5;

// ── stub app ──
function stubApp(opts = {}) {
  const calls = { applyPreset: [], setView: [], setSlice: 0, reset: [], prewarm: [], viewsSet: [], simSet: [] };
  let clock = 0;
  const app = {
    view: 'split', palette: 'inferno', slice: { angle: 0, offset: 0 }, surfaceZ: 0.94, zScale: 1, toggles: { tracers: true, arrows: false, isotherms: false, relief: 0 },
    params: { Ra: 1e5, Pr: 1, Lx: 4, Ly: 4, burner: { x: 0.5, y: 0.5 }, speed: 1 }, preset: null, cam: { yaw: 0.3, pitch: 0.5, dist: 6 }, rects: null,
    applyPreset(id) { calls.applyPreset.push(id); app.preset = id; },
    setView(v) { calls.setView.push(v); app.view = v; },
    setSlice(s) { calls.setSlice++; app.slice = { ...s }; },
    reset(seed) { calls.reset.push(seed); },
    sim: {
      dims: { nx: 128, ny: 128, nz: 32, Lx: 4, Ly: 4, dx: 1 / 32 },
      time: 0,
      set(p) { calls.simSet.push(p); },
      // a plume that wanders slowly round the box; the hot spot fixed
      stats() { return { simTime: clock, Nu: 4.2, vmax: 0.3, Tmean: 0.5, ke: 0.01, plume: [2 + 1.2 * Math.cos(clock * 0.05), 2 + 1.2 * Math.sin(clock * 0.07)], hot: [1.1, 2.9], cold: [3, 1] }; },
    },
    views: { set(p) { calls.viewsSet.push(p); } },
    advance(dt) { clock += dt; },
  };
  if (opts.prewarm !== false) app.prewarm = tff => calls.prewarm.push(tff);
  return { app, calls };
}

// ── fake DOM (from pages/weather-map/tests/saver.test.mjs) ──
function fakeEl(tag = 'div') {
  const cls = new Set(), q = {}, ev = {};
  const el = {
    tagName: tag.toUpperCase(), hidden: false, textContent: '', innerHTML: '', id: '', attrs: {}, children: [],
    classList: { add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)), contains: c => cls.has(c) },
    set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(x => cls.add(x)); },
    get className() { return [...cls].join(' '); },
    setAttribute(k, v) { el.attrs[k] = v; },
    append(...c) { el.children.push(...c); },
    querySelector(s) { return q[s] || (q[s] = fakeEl()); },
    addEventListener(k, f) { (ev[k] = ev[k] || []).push(f); },
    fire(k, e = {}) { (ev[k] || []).forEach(f => f({ preventDefault() {}, stopPropagation() {}, ...e })); },
    getBoundingClientRect: () => ({ top: 900 - 150, bottom: 900 - 32, left: 32, right: 560, width: 528, height: 118 }),
    q,
  };
  return el;
}
function fakeWindow(W, H) {
  const ev = {}, docEv = {}, btn = fakeEl('button');
  let now = 0;
  const doc = {
    documentElement: fakeEl('html'), body: fakeEl('body'),
    createElement: t => fakeEl(t),
    getElementById: id => (id === 'saverBtn' ? btn : null),
    fullscreenEnabled: false, fullscreenElement: null,
    addEventListener: (k, f) => { (docEv[k] = docEv[k] || []).push(f); },
    removeEventListener: (k, f) => { docEv[k] = (docEv[k] || []).filter(x => x !== f); },
  };
  const g = {
    document: doc, innerWidth: W, innerHeight: H,
    addEventListener: (k, f) => { (ev[k] = ev[k] || []).push(f); },
    removeEventListener: (k, f) => { ev[k] = (ev[k] || []).filter(x => x !== f); },
    requestAnimationFrame: f => { f(now); return 1; },
    setInterval: () => 1, clearInterval: () => {}, setTimeout: f => { f(); return 1; }, clearTimeout: () => {},
    performance: { now: () => now },
  };
  g.window = g; g.parent = g;
  return { g, ev, doc, btn, advance: ms => { now += ms; } };
}
function withGlobals(g, fn) {
  const keep = {};
  for (const k of Object.keys(g)) { keep[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: g[k], configurable: true, writable: true }); }
  try { return fn(); }
  finally { for (const k of Object.keys(g)) { if (keep[k]) Object.defineProperty(globalThis, k, keep[k]); else delete globalThis[k]; } }
}

export default async function (ok) {
  let layout = stubLayout, real = false;
  if (existsSync(new URL('render/layout.js', page))) {
    try { const m = await import(new URL('render/layout.js', page)); if (typeof m.layoutRects === 'function') { layout = m.layoutRects; real = true; } } catch (e) { ok('saver: render/layout.js imports', false, e.message); }
  }
  ok('saver: layout under test', true, real ? 'render/layout.js' : 'contract stub (render/layout.js not built yet)');

  // ── SHOT LIST ──
  const lists = [1, 2, 3, 4, 5, 6].map(s => buildShots(s, { calm: 0.7 }));
  const orders = new Set(lists.map(l => l.map(s => s.key).join(',')));
  ok('saver: the shot order changes with the seed', orders.size === 6, `${orders.size} orders of 6`);
  ok('saver: the same seed gives the same order', buildShots(3).map(s => s.key).join() === buildShots(3).map(s => s.key).join());
  ok('saver: runs do not all start on the same kind', new Set(lists.map(l => l[0].kind)).size >= 3, lists.map(l => l[0].kind).join(' '));
  ok('saver: the six shot kinds are there', ['granulation', 'onset', 'cut', 'plume', 'block', 'soup'].every(k => KINDS.includes(k)) && lists.every(l => KINDS.every(k => l.some(s => s.kind === k))), KINDS.join(' '));
  const many = Array.from({ length: 200 }, (_, s) => buildShots(s + 1, { avoid: KINDS[s % KINDS.length] }));
  ok('saver: no kind twice in a row (200 seeds)', many.every(l => l.every((s, i) => i === 0 || s.kind !== l[i - 1].kind)));
  ok('saver: a list does not start with the kind that ended the last one', many.every((l, s) => l[0].kind !== KINDS[s % KINDS.length]));
  const holds = many.flat().map(s => s.hold);
  ok('saver: holds (the cut interval) are 8-14 s', holds.every(h => h >= HOLD_S[0] && h <= HOLD_S[1]), `${Math.min(...holds).toFixed(2)}..${Math.max(...holds).toFixed(2)} s`);
  const sum = c => buildShots(9, { calm: c }).reduce((a, s) => a + s.hold, 0);
  ok('saver: calm makes the holds longer', sum(1) > sum(0), `${sum(0).toFixed(0)} s vs ${sum(1).toFixed(0)} s`);
  const presets = new Set(['granulation', 'soup', 'benard', 'hexagons', 'onset', 'turbulent']), pals = new Set(['solar', 'broth', 'inferno', 'icefire']);
  ok('saver: every shot names a contract preset and palette', SHOTS.every(s => presets.has(s.preset) && pals.has(s.palette)));
  ok('saver: granulation is the sun preset on the surface, line hidden', SHOTS.filter(s => s.kind === 'granulation').every(s => s.preset === 'granulation' && s.view === 'surface' && s.sliceLine === false && s.palette === 'solar' || s.palette === 'inferno'));
  ok('saver: soup shots are burner, broth, tracers on', SHOTS.filter(s => s.kind === 'soup').every(s => s.preset === 'soup' && s.palette === 'broth' && s.toggles.tracers));
  ok('saver: plume shots aim at the plume with isotherms on', SHOTS.filter(s => s.kind === 'plume').every(s => s.aim === 'plume' && s.toggles.isotherms));
  ok('saver: onset shots reset from rest', SHOTS.filter(s => s.kind === 'onset').every(s => s.fresh && (s.preset === 'onset' || s.preset === 'hexagons')));
  ok('saver: every shot names its subject', SHOTS.every(s => typeof s.sub === 'string' && s.sub.length > 4));

  // ── FRAMING ──
  for (const f of FRAMES) {
    const b = bandBox(f), box = clearBox(f), shortSide = Math.min(Math.min(f.W, f.band.w), f.H);
    const aspect = box.w / box.h;
    const out = [], small = [], order = [], offc = [];
    let minSide = Infinity, n = 0;
    for (const seed of [1, 2, 3]) {
      for (const s of buildShots(seed, { aspect })) {
        const r = frameShot(s, f, layout, { Lx: 4, Ly: 4 });
        const keys = Object.keys(r);
        n++;
        if (!keys.length) { out.push(`${s.key}:none`); continue; }
        for (const k of keys) {
          if (!inside(r[k], b)) out.push(`${s.key}/${k}@${r[k].x.toFixed(0)},${r[k].y.toFixed(0)} ${r[k].w.toFixed(0)}x${r[k].h.toFixed(0)}`);
          const m = Math.min(r[k].w, r[k].h);
          minSide = Math.min(minSide, m);
          if (m < 0.22 * shortSide) small.push(`${s.key}/${k}:${m.toFixed(0)}`);
        }
        if (s.view === 'split') {
          const { surface: su, slice: sl } = r;
          if (!su || !sl) order.push(`${s.key}:missing`);
          else if (portrait(f)) { if (!(sl.y >= su.y + su.h - 1 && Math.abs(sl.x - su.x) < 1 && Math.abs(sl.w - su.w) < 1)) order.push(`${s.key}:not stacked`); }
          else if (!(sl.x >= su.x + su.w - 1 || sl.y >= su.y + su.h - 1)) order.push(`${s.key}:overlap`);
        }
        const xs = keys.map(k => r[k]), x0 = Math.min(...xs.map(q => q.x)), x1 = Math.max(...xs.map(q => q.x + q.w)), y0 = Math.min(...xs.map(q => q.y)), y1 = Math.max(...xs.map(q => q.y + q.h));
        if (Math.abs((y0 + y1) / 2 - (b.y + b.h / 2)) > 2 || Math.abs((x0 + x1) / 2 - (b.x + b.w / 2)) > 2) offc.push(s.key);
      }
    }
    ok(`saver framing ${f.tag}: every rect is inside the clear band`, out.length === 0, out.length ? out.slice(0, 3).join(' | ') : `${n} shots`);
    ok(`saver framing ${f.tag}: no rect side under 22% of the short side`, small.length === 0, small.length ? small.slice(0, 4).join(' ') : `min side ${minSide.toFixed(0)} px >= ${(0.22 * shortSide).toFixed(0)} px`);
    ok(`saver framing ${f.tag}: split ${portrait(f) ? 'stacks the surface over its section' : 'pair does not overlap'}`, order.length === 0, order.slice(0, 3).join(' '));
    ok(`saver framing ${f.tag}: the subject is centred in the band`, offc.length === 0, offc.slice(0, 4).join(' '));
  }
  const side16 = buildShots(1, { aspect: clearBox(FRAMES[0]).w / clearBox(FRAMES[0]).h }).filter(s => s.view === 'split');
  const side916 = buildShots(1, { aspect: clearBox(FRAMES[1]).w / clearBox(FRAMES[1]).h }).filter(s => s.view === 'split');
  ok('saver framing: split is side by side in 16:9 and stacked in 9:16', side16.every(s => s.side) && side916.every(s => !s.side));

  // ── SLICE ──
  const D = { Lx: 4, Ly: 4 };
  ok('slice: offset through a point, angle 0 (plane y = Ly/2 + offset)', Math.abs(sliceThrough([1, 3], 0, D) - 1) < 1e-12);
  ok('slice: offset through a point, angle pi/2', Math.abs(sliceThrough([3, 1], Math.PI / 2, D) + 1) < 1e-12);
  ok('slice: offsets wrap into the period', Math.abs(wrapOffset(2.5, 0, D) + 1.5) < 1e-12 && period(0, { Lx: 6, Ly: 4 }) === 4 && Math.abs(period(Math.PI / 2, { Lx: 6, Ly: 4 }) - 6) < 1e-9);

  // ── DIRECTOR RUN (stub app, 10 min at 30 fps, shell 9:16) ──
  {
    const { app, calls } = stubApp();
    const F = FRAMES[1];
    const d = createDirector(app, { seed: 7, calm: 0.7, layout, frame: () => F, fitBlock: (_dims, a) => ({ yaw: 0, pitch: 0.5, dist: 5 + 1 / a, target: [2, 2, 0.5] }) });
    const cuts = [], kinds = [], seq = [];
    let last = null, tEl = 0, maxStep = 0, maxYaw = 0, prevOff = null, prevYaw = null, prevKey = null, outFrames = 0, plumeMiss = [], sameKind = 0;
    const b = bandBox(F);
    for (let k = 0; k < 30 * 600; k++) {
      app.advance(1 / 30);
      d.tick(1 / 30); tEl += 1 / 30;
      const g = d.debug();
      if (g.key !== last) {
        if (prevKey && g.kind === kinds[kinds.length - 1]) sameKind++;
        cuts.push(tEl); kinds.push(g.kind); seq.push(g.key); last = g.key; prevOff = null; prevYaw = null;
      }
      // calm: the slice moves at most a little per frame, the orbit is slow
      if (prevOff !== null) { const st = Math.abs(wrapOffset(g.slice.offset - prevOff, g.slice.angle, D)); maxStep = Math.max(maxStep, st); }
      prevOff = g.slice.offset;
      if (g.view === 'block' && app.cam && prevYaw !== null) maxYaw = Math.max(maxYaw, Math.abs(app.cam.yaw - prevYaw));
      prevYaw = app.cam ? app.cam.yaw : null;
      if (Object.values(app.rects || {}).some(r => !inside(r, b))) outFrames++;
      // at the end of a plume shot the slice runs through the plume
      if (g.kind === 'plume' && g.t > g.hold - 0.05) {
        const pl = app.sim.stats().plume, want = sliceThrough(pl, g.slice.angle, D);
        const err = Math.abs(wrapOffset(g.slice.offset - want, g.slice.angle, D));
        if (err > 0.25) plumeMiss.push(err.toFixed(2));
      }
      prevKey = g.key;
    }
    const gaps = cuts.slice(1).map((t, i) => t - cuts[i]);
    ok('run: cuts every 8-14 s', gaps.length >= 40 && gaps.every(g => g >= 8 - 1e-6 && g <= 14 + 0.05), `${gaps.length} cuts, ${Math.min(...gaps).toFixed(2)}..${Math.max(...gaps).toFixed(2)} s`);
    ok('run: no kind twice in a row, also across lists', sameKind === 0 && kinds.every((k, i) => i === 0 || k !== kinds[i - 1]), `${kinds.length} shots`);
    ok('run: every kind shows in ten minutes', KINDS.every(k => kinds.includes(k)));
    ok('run: rects stay in the band every frame', outFrames === 0, `${outFrames} frames out`);
    ok('run: the slice moves calmly (per frame)', maxStep < 0.03, `max ${maxStep.toFixed(4)} box units per frame`);
    ok('run: the block orbit is slow', maxYaw > 0 && maxYaw < 0.004, `max ${maxYaw.toFixed(5)} rad per frame`);
    ok('run: plume shots end with the slice through stats().plume', plumeMiss.length === 0, plumeMiss.join(' '));
    const lg = d.debug().log;
    const warmed = lg.filter(x => x.warmed > 0), kept = lg.filter((x, i) => i > 0 && !x.reset && x.preset === lg[i - 1].preset);
    ok('run: a preset change pre-runs the field (app.prewarm)', warmed.length > 0 && calls.prewarm.length === warmed.length, `${calls.prewarm.length} pre-runs`);
    ok('run: the same preset continues the running field', kept.every(x => x.warmed === 0), `${kept.length} warm continues`);
    ok('run: onset shots reset from rest', lg.filter(x => x.key.startsWith('onset')).every(x => x.reset) && calls.reset.length === lg.filter(x => x.reset).length);
    ok('run: setView and views.set follow each shot', calls.setView.length >= lg.length && calls.viewsSet.some(p => p.palette === 'broth') && calls.viewsSet.some(p => p.sliceLine === false));
    ok('run: block shots set a fitted camera', calls.viewsSet.some(p => p.cam && Number.isFinite(p.cam.dist) && p.cam.pitch > 0.3 && p.cam.pitch < 0.65));
    const s1 = [], s2 = [];
    for (const [sd, out] of [[11, s1], [12, s2]]) {
      const { app: a2 } = stubApp();
      const d2 = createDirector(a2, { seed: sd, layout, frame: () => F });
      let lk = null;
      for (let k = 0; k < 30 * 120; k++) { d2.tick(1 / 30); const g = d2.debug(); if (g.key !== lk) { out.push(g.key); lk = g.key; } }
    }
    ok('run: two seeds give two orders', s1.join() !== s2.join(), `${s1.slice(0, 3).join(' ')} / ${s2.slice(0, 3).join(' ')}`);
    const { app: a3 } = stubApp({ prewarm: false });
    const d3 = createDirector(a3, { seed: 3, layout, frame: () => F });
    let threw = null;
    try { for (let k = 0; k < 30 * 30; k++) d3.tick(1 / 30); d3.cut('plume'); d3.cut('soup-block'); } catch (e) { threw = e.message; }
    const { app: a4, calls: c4 } = stubApp();
    const d4 = createDirector(a4, { seed: 5, layout, frame: () => F });
    d4.cut('plume-burner'); const n0 = c4.prewarm.length, p0 = c4.applyPreset.length;
    d4.cut('soup-pot');
    ok('run: a shot with the running preset keeps the field (no applyPreset, no pre-run)', c4.prewarm.length === n0 && c4.applyPreset.length === p0 && d4.debug().log.at(-1).warmed === 0, `${d4.debug().log.map(x => x.key + ':' + x.warmed).join(' ')}`);
    ok('run: works with no app.prewarm, and cut(kind | key) forces a shot', !threw && d3.debug().key === 'soup-block', threw || d3.debug().key);
  }

  // ── LABEL ──
  const sample = [
    'struct P { dt: f32, Ra: f32, Pr: f32 }',
    '@group(0) @binding(0) var<uniform> P: P;',
    '',
    '@compute @workgroup_size(8, 8, 4)',
    'fn forces(@builtin(global_invocation_id) g: vec3<u32>) {',
    '  let i = cell(g);',
    '  var u = vel[i].xyz;',
    '  // buoyancy',
    '  u.z += P.dt * temp[i];',
    '  if (u.z > 1.0) { u.z = 1.0; }',
    '  vel[i] = vec4<f32>(u, 0.0);',
    '}',
    'fn other() {}',
  ].join('\n');
  const ex = extractWgsl(sample, /buoyan/i);
  ok('code: extractWgsl cuts the kernel around the marker', !!ex && ex.startsWith('@compute') && ex.trim().endsWith('}') && !ex.includes('other') && ex.split('\n').length === 9, ex && `${ex.split('\n').length} lines`);
  ok('code: no marker gives null', extractWgsl(sample, /nothing/) === null);
  const longSrc = ['fn big() {', ...Array.from({ length: 30 }, (_, i) => (i === 20 ? '  x += buoyancy;' : `  a${i} = 0.0;`)), '}'].join('\n');
  const exl = extractWgsl(longSrc, /buoyan/);
  ok('code: a long kernel is cut to 12 lines and keeps the marker', exl.split('\n').length <= 12 && exl.includes('buoyancy'), `${exl.split('\n').length} lines`);
  const realWgsl = existsSync(new URL('shaders/', page)) && (await import('node:fs')).readdirSync(new URL('shaders/', page)).some(f => /^sim-.*\.wgsl$/.test(f));
  ok('code: the plate extract', true, realWgsl ? 'shaders/sim-*.wgsl exists: INTEGRATE must point CODE_SOURCE at the buoyancy kernel' : 'placeholder from the contract buoyancy term (INTEGRATE must replace it)');
  ok('code: the placeholder is short WGSL', CODE_PLACEHOLDER.text.split('\n').length <= 12 && /@compute/.test(CODE_PLACEHOLDER.text) && /temp\[i\]/.test(CODE_PLACEHOLDER.text));
  ok('label: numbers', fmtSci(1e5) === '1.0 × 10⁵' && fmtSci(5e6) === '5.0 × 10⁶' && fmtSci(3000) === '3000' && fmtSci(0.7) === '0.7', `${fmtSci(1e5)} ${fmtSci(5e6)} ${fmtSci(3000)}`);
  {
    const { app } = stubApp();
    const pp = labelParams(app);
    ok('label: live Ra, Pr, Nu, t', pp.length === 4 && pp[0].value === '1.0 × 10⁵' && pp[1].value === '1' && pp[2].value === '4.20' && /tff$/.test(pp[3].value), pp.map(p => p.value).join(', '));
    const L = shellLabel(app, SHOTS[0], null);
    ok('label: title, sub, two equations, code', L.title === 'Thermal Convection' && L.sub === 'Solar granulation' && L.tex.length === 2 && L.tex !== TEX && L.code.lang === 'wgsl' && !!L.code.text && L.rules.length >= 5, `${L.title} · ${L.sub}`);
  }

  // ── SHELL MODE (fake DOM) ──
  {
    const W = fakeWindow(1080, 1920);
    const labels = [];
    const res = withGlobals(W.g, () => {
      const { app, calls } = stubApp();
      const before = { view: app.view, palette: app.palette, slice: { ...app.slice }, Ra: app.params.Ra };
      const saver = installSaver({ app, canvas: { id: 'stage' }, layout, loadText: () => Promise.resolve(null), plateBand: () => ({ t: 420, b: 560, w: 1080 }) });
      const r = globalThis.snSaver.enter({ calm: 0.7, seed: 42, label: x => labels.push(x) });
      const okEnter = r && r.canvas && r.canvas.id === 'stage' && r.warmupMs > 0 && W.doc.documentElement.classList.contains('sn-saver') && app.saver === true;
      let out = 0, ticks = 0;
      const b = bandBox({ W: 1080, H: 1920, band: { t: 420, b: 560, w: 1080 } });
      for (let k = 0; k < 30 * 60; k++) { if (saver.tick(1 / 30)) ticks++; if (Object.values(app.rects || {}).some(q => !inside(q, b))) out++; }
      const dbg = globalThis.snSaver.debug();
      const cutOk = globalThis.snSaver.cut('granulation') && saver.debug().kind === 'granulation';
      app.params.Ra = 5e6;
      globalThis.snSaver.exit();
      const restored = app.view === before.view && app.palette === before.palette && app.slice.offset === before.slice.offset && app.params.Ra === before.Ra && !W.doc.documentElement.classList.contains('sn-saver') && app.saver === false && saver.tick(1 / 30) === false;
      return { okEnter, out, ticks, dbg, cutOk, restored, nullLabel: labels[labels.length - 1] === null, pre: calls.prewarm.length };
    });
    ok('shell: enter returns the page canvas and a warmup', res.okEnter);
    ok('shell: tick drives the director and the rects stay in the plate band', res.ticks === 1800 && res.out === 0, `${res.out} frames out, shot ${res.dbg && res.dbg.key}`);
    const named = labels.filter(Boolean);
    ok('shell: the label names each shot with the equations, live params and code', named.length >= 5 && named.every(x => x.title === 'Thermal Convection' && x.sub && x.tex.length === 2 && x.params.length === 4 && x.code && x.code.lang === 'wgsl'), named[0] && `${named.length} labels, "${named[0].sub}"`);
    ok('shell: cut(kind) forces a shot', res.cutOk);
    ok('shell: exit restores the view, palette, slice and params and clears the label', res.restored && res.nullLabel);
  }

  // ── PAGE MODE (fake DOM) ──
  {
    const P = fakeWindow(1600, 900);
    const res = withGlobals(P.g, () => {
      const { app } = stubApp();
      const saver = installSaver({ app, canvas: { id: 'stage' }, layout });
      const keys = P.ev.keydown || [];
      const key = (k, tag = 'BODY') => keys.forEach(f => f({ key: k, target: { tagName: tag }, preventDefault() {} }));
      key('s');
      const on = saver.active && !saver.shell && P.doc.documentElement.classList.contains('tc-saver');
      for (let k = 0; k < 30 * 5; k++) saver.tick(1 / 30);
      const plate = P.doc.body.children.find(e => e.id === 'tcSaverPlate');
      const title = plate && plate.q['.tcs-title'].textContent, sub = plate && plate.q['.tcs-sub'].textContent, params = plate && plate.q['.tcs-params'].textContent;
      // the band sits above the plate box (top 750 of 900)
      const rects = Object.values(app.rects || {}), inBand = rects.length > 0 && rects.every(q => q.y + q.h <= 900 - 150 - 12 + 0.5 && q.y >= 45 - 0.5);
      key('s', 'INPUT');
      const typing = saver.active;
      key('Escape');
      const off = !saver.active && !P.doc.documentElement.classList.contains('tc-saver') && plate.hidden;
      P.btn.fire('click');
      const byBtn = saver.active;
      P.advance(800);
      (P.ev.pointerdown || []).forEach(f => f({ preventDefault() {}, stopPropagation() {} }));
      const byTap = !saver.active;
      return { on, title, sub, params, inBand, typing, off, byBtn, byTap };
    });
    ok('page: the S key starts the in-page saver (class tc-saver)', res.on);
    ok('page: the lower third shows the title, the shot and live params', res.title === 'Thermal Convection' && !!res.sub && /Ra = .*Nu = 4\.20/.test(res.params || ''), `${res.title} · ${res.sub} · ${res.params}`);
    ok('page: the views sit above the lower third', res.inBand);
    ok('page: S in a text field does not toggle it', res.typing === true);
    ok('page: Esc stops it and hides the plate', res.off);
    ok('page: the saverBtn button starts it and a tap stops it', res.byBtn && res.byTap);
  }
}
