// ============================================================================
//  CT LAB SAVER  ·  node tests
// ----------------------------------------------------------------------------
//  node stella-nova/pages/ct-lab/saver/tests.mjs [--png DIR]
//  Checks the shot plan (lengths, no kind twice in a row, seeded order),
//  the springs, the panel layout, every shot kind through stubs (lab and
//  view3d stubs, the software canvas from ../../ct-explained/test-canvas.mjs)
//  with no NaN, and the window.snSaver hook on a stub DOM (enter, cuts, exit).
//  --png DIR writes frames of every shot kind to look at.
// ============================================================================
import { makePlan, KINDS, spring, stepSpring, cam2d, aimCam, stepCam, camOK, fitPanels, MIN_SHOT, MAX_SHOT } from './plan.js';
import { makeShot, spin } from './shots.js';
import { Canvas, writePNG } from '../../ct-explained/test-canvas.mjs';
import { mkdirSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) { pass++; console.log(`ok   ${m}${extra ? '  ' + extra : ''}`); } else { fail++; console.log(`FAIL ${m}${extra ? '  ' + extra : ''}`); } };
const pngDir = process.argv.includes('--png') ? process.argv[process.argv.indexOf('--png') + 1] : null;
if (pngDir) mkdirSync(pngDir, { recursive: true });
const ALL = KINDS.map((k) => k.kind);

// ---------- plan ----------
{
  let repeats = 0, famRep = 0, bad = 0, total = 0;
  for (let seed = 1; seed <= 40; seed++) for (const caps of [{ lab: true, gpu: true }, { lab: true, gpu: false }, { lab: false, gpu: false }]) {
    const p = makePlan(seed, { ...caps, calm: (seed % 5) / 4 });
    let prev = null;
    for (let i = 0; i < 60; i++) {
      const s = p.next(); total++;
      if (prev && s.kind === prev.kind) repeats++;
      if (prev && s.fam === prev.fam) famRep++;
      if (!(s.dur >= MIN_SHOT && s.dur <= MAX_SHOT) || !Number.isFinite(s.seed)) bad++;
      if (!caps.gpu && s.fam === '3d') bad++;
      if (!caps.lab && s.fam === 'lab') bad++;
      prev = s;
    }
  }
  ok(repeats === 0, 'no shot kind twice in a row', `${total} shots`);
  ok(bad === 0, 'every length in 6..12 s, and no shot needs a missing capability');
  ok(famRep / total < 0.05, 'a family rarely follows itself', `${famRep} of ${total}`);
  const a = makePlan(7, { lab: true, gpu: true }), b = makePlan(7, { lab: true, gpu: true }), c = makePlan(8, { lab: true, gpu: true });
  const sa = Array.from({ length: 11 }, () => a.next().kind).join(), sb = Array.from({ length: 11 }, () => b.next().kind).join(), sc = Array.from({ length: 11 }, () => c.next().kind).join();
  ok(sa === sb && sa !== sc, 'the order is seeded: same seed same reel, new seed new reel');
  ok(new Set(sa.split(',')).size === 11, 'one bag holds every kind once', sa);
  const d = makePlan(3, { lab: true, gpu: true }); d.next(); d.drop('3d');
  ok(Array.from({ length: 40 }, () => d.next()).every((s) => s.fam !== '3d'), 'drop(3d) removes the 3D shots');
}

// ---------- springs and layout ----------
{
  const s = spring(0, 3); s.t = 1; let over = 0, prevX = 0, mono = true;
  for (let i = 0; i < 400; i++) { stepSpring(s, 1 / 60); if (s.x > 1 + 1e-9) over++; if (s.x < prevX - 1e-12) mono = false; prevX = s.x; }
  ok(over === 0 && mono && Math.abs(s.x - 1) < 1e-3, 'spring is critically damped: no overshoot, monotone, settles', s.x.toFixed(5));
  const c = cam2d(100, 100); let fine = true;
  for (let i = 0; i < 1000; i++) { aimCam(c, 100 + 300 * Math.sin(i / 40), 200 * Math.cos(i / 70), 1 + 0.4 * Math.abs(Math.sin(i / 90))); stepCam(c, i % 7 ? 1 / 60 : 0.05); fine = fine && camOK(c); }
  ok(fine, 'camera stays finite under moving targets and long frames');
  let inside = true;
  for (const st of [{ x: 16, y: 180, w: 1248, h: 380 }, { x: 14, y: 140, w: 362, h: 420 }]) for (const asp of [[1, 1.7], [0.8, 1, 0.8], [1, 1.15, 1], [1, 0.62]]) {
    for (const r of fitPanels(st, asp, 24)) inside = inside && r.x >= st.x - 0.5 && r.y >= st.y - 0.5 && r.x + r.w <= st.x + st.w + 0.5 && r.y + r.h <= st.y + st.h + 0.5 && r.w > 20;
  }
  ok(inside, 'panels fit inside the clear band (desktop and phone)');
  ok(Math.abs(spin(1) - 1) < 1e-12 && spin(0) === 0 && spin(0.1) < 0.1, 'spin-up starts slow and ends at 1');
}

// ---------- stubs ----------
function labStub() {
  const panels = { phantom: new Canvas(380, 380), sinogram: new Canvas(380, 380), recon: new Canvas(380, 380), diff: new Canvas(380, 380) };
  for (const [k, c] of Object.entries(panels)) { const g = c.getContext('2d'); g.fillStyle = k === 'recon' ? '#8899aa' : '#334455'; g.fillRect(40, 40, 300, 300); }
  const S = { preset: 'shepp-logan', phase: 'idle', view: 0, views: 360, psnr: NaN, playing: false };
  const calls = [];
  return {
    calls, ready: Promise.resolve(),
    presets: () => [{ id: 'walnut', label: 'Walnut', blurb: 'shell' }, { id: 'metal-streaks', label: 'Metal', blurb: 'steel' }],
    async load(id) { calls.push('load:' + id); S.preset = id; S.phase = 'scan'; S.view = 0; S.views = id === 'sparse-18' ? 18 : 360; },
    params: () => ({ window: 'soft', beam: 'parallel', algo: 'fbp', filter: 'ram-lak' }),
    windows: () => [{ id: 'soft', label: 'Soft', level: 40, width: 400 }],
    async set() {}, async setColormap(id) { calls.push('cmap:' + id); }, setWindow(w) { calls.push('win'); if (!Number.isFinite(w.width)) throw new Error('NaN window'); },
    step(k) { S.view = Math.min(S.views, S.view + k); if (S.view === S.views) { S.phase = 'done'; S.psnr = 31.2; } return { ...S }; },
    stop() { calls.push('stop'); }, play() {}, pause() {}, setChrome(v) { calls.push('chrome:' + v); }, focusPanel() {},
    state: () => ({ ...S, angle: 0, iter: 0, iters: 0, residuals: [] }), panels: () => panels, on: () => () => {},
  };
}
function view3dStub() {
  const st = { scanned: 0, reconstructed: 0, total: 0, mode: 'dvr' }, calls = { cam: [], render: 0, iso: [], slices: [] };
  return {
    calls,
    view: {
      setColormap() {}, setShow() {}, setMode(m) { st.mode = m; }, setIso(a, b) { calls.iso.push([a, b]); }, setSlices(s) { calls.slices.push(s); },
      setCamera(c) { calls.cam.push(c); },
      scanStep(o) { st.scanned = Math.min(st.total, st.scanned + (o.views || 1)); return { done: st.scanned, total: st.total }; },
      async reconstructStep(o) { st.reconstructed = Math.min(st.scanned, st.reconstructed + (o.views || 8)); return { done: st.reconstructed, total: st.total }; },
      render() { calls.render++; },
      get state() { return { ...st }; },
      _init(nA) { st.total = nA; },
    },
    released: false,
  };
}

// ---------- every shot kind renders ----------
const W = 1280, H = 800, stage = { x: 51, y: 210, w: 1178, h: 360 };
for (const phone of [false, true]) {
  for (const kind of ALL) {
    const lab = labStub(); let h3 = null;
    const env = {
      phone, now: () => performance.now(), lab,
      makeCanvas: (w, h) => new Canvas(w, h),
      make3D: async (o) => { h3 = view3dStub(); h3.view._init(o.nAngles); return { view: h3.view, release() { h3.released = true; } }; },
    };
    const st = phone ? { x: 14, y: 150, w: 362, h: 430 } : stage, w = phone ? 390 : W, h = phone ? 844 : H;
    const plan = makePlan(11, { lab: true, gpu: true, only: [kind] });
    const spec = plan.next();
    const shot = makeShot(spec, env);
    const t0 = performance.now();
    await shot.init();
    const tInit = performance.now() - t0;
    let nan = 0, frames = 0, worst = 0, camBad = 0, plateBad = 0, shots = 0;
    const cv = new Canvas(Math.round(w / 2), Math.round(h / 2)), g = cv.getContext('2d');
    const dt = 1 / 30;
    for (let t = 0; t < shot.dur; t += dt) {
      let guard = 0, ran;
      do { const f0 = performance.now(); ran = shot.tick(dt); worst = Math.max(worst, performance.now() - f0); } while (!ran && guard++ < 10000);
      if (shot.cam === null) {
        await new Promise((r) => setImmediate(r));
        shot.render(dt, { t: st.y, b: h - st.y - st.h }, w, h);
      }
      frames++;
      if (shot.cam) {
        const f = shot.focus(st);
        aimCam(shot.cam, f.r.x + f.r.w / 2, f.r.y + f.r.h / 2, f.z); stepCam(shot.cam, dt);
        if (!camOK(shot.cam) || ![f.r.x, f.r.y, f.r.w, f.r.h, f.z].every(Number.isFinite)) camBad++;
      }
      if (frames % 30 === 0 || t + dt >= shot.dur) {
        const p = shot.plate();
        if (!p.title || !p.tex || p.tex.length !== 1 || /NaN|undefined/.test(JSON.stringify(p)) || p.code) plateBad++;
        if (shot.cam) {
          g.setTransform(0.5, 0, 0, 0.5, 0, 0); g.fillStyle = '#04060b'; g.fillRect(0, 0, w, h);
          const c = shot.cam, cx = st.x + st.w / 2, cy = st.y + st.h / 2;
          g.save(); g.translate(cx, cy); g.scale(c.z.x, c.z.x); g.translate(-c.fx.x, -c.fy.x); shot.draw(g, st); g.restore();
          nan += g.nan; g.nan = 0;
          if (pngDir && !phone && [0.25, 0.6, 0.95].some((q) => Math.abs(t / shot.dur - q) < 0.2 && shots < 3 && t / shot.dur > q - 0.02)) {
            writePNG(`${pngDir}/${kind}-${shots}.png`, cv); shots++;
          }
        }
      }
    }
    const s = shot.subject;
    const sub = s && [s.x, s.y, s.w, s.h].every(Number.isFinite);
    let extra = '';
    if (shot.cam === null) {
      const camFine = h3.calls.cam.every((c) => [c.yaw, c.pitch, c.dist, c.offset[0], c.offset[1]].every(Number.isFinite));
      extra = `views ${h3.view.state.scanned}/${h3.view.state.total}, fdk ${h3.view.state.reconstructed}, renders ${h3.calls.render}`;
      const scanOK = kind === 'cone-volume' ? h3.view.state.scanned === 0 : h3.view.state.scanned === h3.view.state.total && h3.view.state.reconstructed === h3.view.state.total;
      ok(camFine && scanOK && h3.calls.render > 100, `${kind}${phone ? ' (phone)' : ''}: 3D cameras finite; ${kind === 'cone-volume' ? 'no scan' : 'the scan and FDK complete'}`, extra);
    }
    if (shot.kind === 'cone-volume') ok(h3.calls.iso.length + h3.calls.slices.length > 0 || h3.view.state.mode === 'dvr', `${kind}${phone ? ' (phone)' : ''}: the transfer function or the slices move`);
    shot.dispose();
    if (h3) ok(h3.released, `${kind}${phone ? ' (phone)' : ''}: dispose releases the 3D device`);
    if (spec.fam === 'lab') ok(lab.calls.includes('stop') && lab.calls.some((c) => c.startsWith('load:')) && lab.state().view === lab.state().views, `${kind}${phone ? ' (phone)' : ''}: drives __ctlab (load, steps to the last view, stop)`, lab.calls.filter((c) => c !== 'win').join(' '));
    ok(nan === 0 && camBad === 0 && plateBad === 0 && sub, `${kind}${phone ? ' (phone)' : ''}: ${frames} frames, no NaN, finite camera, plate ok`, `dur ${spec.dur.toFixed(1)} s, init ${tInit.toFixed(0)} ms, worst step ${worst.toFixed(0)} ms`);
  }
}

// ---------- a cut during make3D releases the late device ----------
{
  let resolve3D; let late = null;
  const env = {
    phone: false, now: () => performance.now(), lab: labStub(),
    makeCanvas: (w, h) => new Canvas(w, h),
    make3D: () => new Promise((res) => { resolve3D = () => { late = view3dStub(); late.view._init(144); res({ view: late.view, release() { late.released = true; } }); }; }),
  };
  const spec = makePlan(11, { lab: true, gpu: true, only: ['cone-scan'] }).next();
  const shot = makeShot(spec, env);
  const p = shot.init();
  shot.dispose();
  resolve3D(); await p;
  ok(late && late.released && !shot.h3, 'a 3D shot cut before make3D resolves releases the late device');
}

// ---------- the hook on a stub DOM ----------
{
  const els = [];
  const mkEl = (tag) => {
    const el = tag === 'canvas' ? new Canvas(300, 150) : { textContent: '' };
    Object.assign(el, { tagName: tag.toUpperCase(), style: {}, hidden: false, remove() { const i = els.indexOf(el); if (i >= 0) els.splice(i, 1); } });
    return el;
  };
  let rafQ = [], tNow = 0;
  globalThis.window = globalThis;
  Object.assign(globalThis, {
    innerWidth: 200, innerHeight: 125, devicePixelRatio: 1,
    document: { createElement: mkEl, head: { appendChild: (e) => els.push(e) }, body: { appendChild: (e) => els.push(e) } },
    requestAnimationFrame: (f) => { rafQ.push(f); return rafQ.length; }, cancelAnimationFrame: () => { rafQ = []; },
  });
  const winL = {};
  globalThis.addEventListener = (t, f) => { (winL[t] ||= []).push(f); };
  const lab = labStub(); globalThis.__ctlab = lab;
  await import('../saver.js');
  const labels = [];
  const ret = window.snSaver.enter({ seed: 5, calm: 0.5, label: (i) => labels.push(i) });
  ok(ret && ret.canvas && els.includes(ret.canvas), 'enter returns a canvas that is in the document');
  const kinds = new Set();
  for (let i = 0; i < 20 * 100; i++) {
    const q = rafQ; rafQ = []; tNow += 1000 / 20; for (const f of q) f(tNow);
    await new Promise((r) => setImmediate(r));
    const d = window.snSaver.debug(); if (d && d.kind) kinds.add(d.kind);
  }
  const hist = window.snSaver.debug().history;
  const rep = hist.some((k, i) => i && k === hist[i - 1]);
  ok(hist.length >= 7 && !rep, 'the hook cuts through the reel with no repeat', hist.join(' > '));
  ok(labels.length > 0 && labels.every((l) => l.title && l.tex.length === 1 && typeof l.anchor === 'function' && !l.code), 'plates have a title, one TeX equation, an anchor and no code', `${labels.length} plate calls, ${new Set(labels.map((l) => l.title)).size} titles`);
  const an = labels[labels.length - 1].anchor();
  ok(!an || [an.x, an.y, an.w, an.h].every(Number.isFinite), 'the anchor is finite');
  window.snSaver.cut('smear');
  for (let i = 0; i < 4; i++) { const q = rafQ; rafQ = []; tNow += 33; for (const f of q) f(tNow); await new Promise((r) => setImmediate(r)); }
  ok(window.snSaver.debug().kind === 'smear', 'cut(kind) forces a shot');
  window.snSaver.exit();
  ok(window.snSaver.debug() === null && !els.some((e) => e.tagName === 'CANVAS'), 'exit removes the canvases');
  ok(lab.calls.includes('chrome:true') && lab.calls.filter((c) => c.startsWith('load:')).length >= 1, 'exit gives the lab its chrome back and reloads a preset');
  window.snSaver.enter({ seed: 9 });
  for (let i = 0; i < 4; i++) { const q = rafQ; rafQ = []; tNow += 33; for (const f of q) f(tNow); await new Promise((r) => setImmediate(r)); }
  const loads0 = lab.calls.filter((c) => c.startsWith('load:')).length;
  (winL.pagehide || []).forEach((f) => f());
  ok(window.snSaver.debug() === null && rafQ.length === 0 && lab.calls.filter((c) => c.startsWith('load:')).length === loads0, 'pagehide ends the reel and does not reload a lab preset');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
