// ============================================================================
//  CORAL SPECIES  ·  node tests (no browser):  node tests.mjs
// ----------------------------------------------------------------------------
//  1. base ..... the rock SDF, its normal, the site, the meshes
//  2. growth ... each species grows ONE colony on the base, at the page
//                rate (cap / GROW_S, 16 ms steps of simulated time): full
//                in 60 to 120 s, never into the rock or the sand, and it
//                stays full (no restart)
//  3. worker ... the runner of ../coral-reef/mesh-worker.js with the base
//                rock: init, single, colonies, particles, bricks, done
//  4. saver .... the plan (every species before a repeat, no species twice
//                in a row, calm continuous shots) and the framing in the
//                plate band for 16:9 and 9:16
//  5. glsl ..... the coral-reef programs that this page draws, through
//                glslangValidator as GLSL ES 3.00 with a three.js prefix
//  6. page ..... index.html and main.js in jsdom 24 on the fake WebGL2 of
//                ../coral-reef/tests/fake-gl.mjs (JSDOM_DIR or NODE_PATH;
//                it skips with a note if jsdom is not there): the boot,
//                the colony grows on the main thread runner, the UI, the
//                saver hook, a phone boot
//  8. panel ... panel-check.mjs (a child process): the sn-panel sections and
//                controls, labels, keyboard order, the stored collapse state
//  Exit code 1 if a check fails.
// ============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installThree, fakeCanvas } from '../coral-reef/tests/fake-gl.mjs';
import { createBase, PLOT_R } from './base.js';
import { SPECIES_LIST, GROW_S, sizeFor, rateFor, colonyStats, frameSample, saverClear, saverPlan, shotPose, ageYears } from './species.js';
import { createReef, SPECIES_IDS } from '../coral-reef/reef.js';
import { createReefRunner } from '../coral-reef/mesh-worker.js';
import { frameFit, projectedBox } from '../coral-reef/saver.js';
import * as SH from '../coral-reef/shaders.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
const sect = s => console.log('\n' + s);

// ── 1. base ──
sect('1. base');
const B = createBase({ seed: 3 });
ok(B.sdf(0, 0, 0) < 0, `the rock centre is inside (sdf ${B.sdf(0, 0, 0).toFixed(3)})`);
ok(B.sdf(0, 1.2, 0) > 0.5, 'the water over the rock is outside');
ok(Math.abs(B.sdf(...B.site.p)) < 0.01, `the site is on the rock surface (sdf ${B.sdf(...B.site.p).toFixed(4)})`);
ok(B.site.n[1] > 0.8, `the site normal looks up (ny ${B.site.n[1].toFixed(2)})`);
ok(B.site.p[1] > B.sand.heightAt(0, 0) + 0.15, `the rock top is over the sand (top ${B.top.toFixed(2)} m)`);
const rm = B.meshes[0];
ok(rm.indices.length / 3 > 4000 && rm.indices.length / 3 < 60000, `rock mesh ${rm.indices.length / 3} tris`);
ok(B.sand.mesh.indices.length / 3 > 1000, `sand mesh ${B.sand.mesh.indices.length / 3} tris`);
const B2 = createBase({ seed: 3, mesh: false });
ok(B2.sdf(0.3, 0.1, -0.2) === B.sdf(0.3, 0.1, -0.2) && B2.meshes.length === 0, 'the worker base (no mesh) has the same SDF');
let maxG = 0, rs = 12345;
const rnd = () => { rs = (Math.imul(rs, 1103515245) + 12345) >>> 0; return rs / 4294967296; };
for (let i = 0; i < 4000; i++) {
  const x = (rnd() - 0.5) * 2.4, y = rnd() * 0.7 - 0.05, z = (rnd() - 0.5) * 2.4, e = 1e-3;
  const g = Math.hypot(B.sdf(x + e, y, z) - B.sdf(x - e, y, z), B.sdf(x, y + e, z) - B.sdf(x, y - e, z), B.sdf(x, y, z + e) - B.sdf(x, y, z - e)) / (2 * e);
  maxG = Math.max(maxG, g);
}
ok(maxG <= B.lipschitz, `|grad sdf| ${maxG.toFixed(2)} <= lipschitz ${B.lipschitz}`);

// ── 2. growth ──
sect('2. growth: one colony per species at the page rate');
for (const q of ['desktop', 'phone']) {
  for (const id of SPECIES_IDS) {
    const R = createReef({ rock: B2, seed: 5, quality: q, radius: PLOT_R, rate: 0, budget: { particles: 20000 } });
    const c = R.growColony(B2.site, id, { size: sizeFor(id), seed: 5, rate: 0 });
    R.setRate(rateFor(c.cap));
    let t = 0, tFull = -1, inRock = 0;
    const dt = 16;
    while (t < 200000) { R.step(dt, 50, t); t += dt; if (R.done()) { tFull = t / 1000; break; } }
    for (let g = 0; g < R.count; g++) if (B2.sdf(R.px[g], R.py[g], R.pz[g]) <= 0 || R.py[g] < B2.sand.heightAt(R.px[g], R.pz[g])) inRock++;
    const n0 = R.count; for (let k = 0; k < 200; k++) R.step(dt, 50, t + k * dt);
    const st = colonyStats(R, 0);
    ok(tFull >= 50 && tFull <= 125 && inRock === 0 && R.count === n0,
      `${q} ${id}: cap ${c.cap}, ${R.count} particles, full at ${tFull.toFixed(1)} s, h ${(st.height * 100).toFixed(0)} cm, w ${(st.width * 100).toFixed(0)} cm, in rock ${inRock}, after full +${R.count - n0}`);
  }
}
ok(SPECIES_LIST.length === SPECIES_IDS.length && SPECIES_LIST.length >= 5, `the picker lists every species (${SPECIES_LIST.map(s => s.id).join(', ')})`);
ok(Math.abs(ageYears('staghorn', 0.12) - 1) < 1e-9, 'age: 12 cm of staghorn is one year');

// ── 3. worker ──
sect('3. worker runner with the base rock');
{
  const msgs = [];
  const timers = { set: () => 0, clear: () => {} };
  const run = createReefRunner({ post: m => msgs.push(m), makeRock: ro => createBase({ seed: ro.seed, mesh: false }), timers });
  await run.onMessage({ type: 'init', seed: 1, quality: 'desktop', radius: PLOT_R, rockSeed: 3, sites: [], colonies: 0, rate: 0, budget: { particles: 20000, colonies: 1, tris: 1200000, polyps: 1 }, lod: false });
  ok(msgs.some(m => m.type === 'ready') && run.reef.colonies.length === 0, 'init: ready, no colony yet');
  await run.onMessage({ type: 'single', site: createBase({ seed: 3, mesh: false }).site, species: 'staghorn', size: sizeFor('staghorn'), seed: 2, rate: 0 });
  const col = msgs.find(m => m.type === 'colonies' && m.gen === 2);
  ok(col && col.list.length === 1 && col.list[0].cap > 500, `single: one colony, gen 2, cap ${col && col.list[0].cap}`);
  let n = 0, done = false;
  const t0 = Date.now();
  // a runner whose timer queue the test drains by hand, until idle
  const msgs2 = [];
  let q = [];
  const run2 = createReefRunner({ post: m => msgs2.push(m), makeRock: ro => createBase({ seed: ro.seed, mesh: false }), timers: { set: f => { q.push(f); return q.length; }, clear: () => {} } });
  await run2.onMessage({ type: 'init', seed: 1, quality: 'desktop', radius: PLOT_R, rockSeed: 3, sites: [], colonies: 0, rate: 0, budget: { particles: 20000, colonies: 1, tris: 1200000, polyps: 1 }, lod: false });
  await run2.onMessage({ type: 'single', site: B2.site, species: 'fan', size: sizeFor('fan'), seed: 2, rate: Infinity });
  while (q.length && Date.now() - t0 < 90000) { const f = q.shift(); f(); n++; if (msgs2.some(m => m.type === 'idle' && m.gen === 2)) { done = true; break; } }
  const parts = msgs2.filter(m => m.type === 'particles' && m.gen === 2).reduce((s, m) => s + m.data.length / 8, 0);
  const bricks = msgs2.filter(m => m.type === 'bricks' && m.gen === 2).reduce((s, m) => s + m.list.length, 0);
  const prog = msgs2.filter(m => m.type === 'progress' && m.gen === 2).pop();
  ok(done && parts === run2.reef.count && bricks > 10 && prog && prog.done && prog.tris > 10000 && prog.polyps > 1000,
    `fan in the runner: ${n} ticks, ${parts} particles posted, ${bricks} bricks, ${prog && prog.tris} tris, ${prog && prog.polyps} polyps, done ${!!(prog && prog.done)}`);
  const before = run2.reef.count; for (let k = 0; k < 20 && q.length; k++) q.shift()();
  ok(run2.reef.count === before && run2.gen === 2, 'the full colony stays: no new gen, no new particles');
  ok(n > 0 || msgs.length > 0, 'runner messages flow');
}

// ── 4. saver ──
sect('4. saver plan and framing');
{
  const plan = saverPlan(7, { n: 12 });
  const ids = SPECIES_IDS;
  ok(new Set(plan.slice(0, ids.length).map(s => s.species)).size === ids.length, `the first ${ids.length} stages hold every species: ${plan.slice(0, ids.length).map(s => s.species).join(' ')}`);
  ok(plan.every((s, i) => i === 0 || s.species !== plan[i - 1].species), 'no species twice in a row');
  ok(plan.every((s, i) => i === 0 || s.gradient !== plan[i - 1].gradient), 'no gradient twice in a row');
  ok(JSON.stringify(saverPlan(7)) === JSON.stringify(saverPlan(7)) && JSON.stringify(saverPlan(7)) !== JSON.stringify(saverPlan(8)), 'the plan is seeded');
  let jump = 0, minLen = Infinity, maxLen = 0;
  for (const s of plan) {
    for (const sh of s.shots) { minLen = Math.min(minLen, sh.len); maxLen = Math.max(maxLen, sh.len); }
    let prev = shotPose(s, 0);
    for (let t = 0.05; t < s.total; t += 0.05) { const p = shotPose(s, t); jump = Math.max(jump, Math.abs(p.az - prev.az), Math.abs(p.elev - prev.elev), Math.abs(p.zoom - prev.zoom)); prev = p; }
  }
  ok(jump < 0.02 && minLen >= 8 && maxLen <= 12, `shots of ${minLen.toFixed(1)} to ${maxLen.toFixed(1)} s, largest step in 50 ms ${jump.toFixed(4)} (no jump)`);
  // the subject sphere in the clear band of the plate (16:9 and 9:16)
  for (const [w, h, band] of [[1920, 1080, { t: 210, b: 300, w: 1920 }], [1080, 1920, { t: 380, b: 520, w: 1080 }], [1920, 1080, { t: 200, b: 330, w: 608 }], [390, 844, null]]) {
    const clear = saverClear(band, w, h), fov = 50;
    const fit = frameFit({ w, h, clear, radius: 1, fov, fill: 0.74 });
    const bx = projectedBox({ w, h, fov }, fit, 1);
    const inside = bx.y0 >= clear.t - 1 && bx.y1 <= h - clear.b + 1 && bx.x0 >= clear.l - 1 && bx.x1 <= w - clear.r + 1;
    const share = (bx.y1 - bx.y0) / (h - clear.t - clear.b);
    ok(inside && share > 0.5, `${w}x${h} band ${band ? `${band.t}/${band.b}/${band.w}` : 'none'}: box y ${bx.y0.toFixed(0)}..${bx.y1.toFixed(0)} x ${bx.x0.toFixed(0)}..${bx.x1.toFixed(0)}, ${(share * 100).toFixed(0)}% of the band`);
  }
  const fs0 = frameSample(null, [0, 0.3, 0]);
  ok(fs0.count === 4, 'frame sample of an empty colony: the four base points');
}

// ── 5. glsl ──
sect('5. GLSL (glslangValidator, GLSL ES 3.00)');
{
  const GV = ['/opt/homebrew/bin/glslangValidator', '/usr/local/bin/glslangValidator'].find(p => fs.existsSync(p));
  if (!GV) ok(false, 'glslangValidator not found');
  else {
    const VP = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nuniform mat4 modelMatrix, modelViewMatrix, projectionMatrix, viewMatrix;\nuniform mat3 normalMatrix;\nuniform vec3 cameraPosition;\nin vec3 position;\nin vec3 normal;\nin vec2 uv;\n';
    const FP = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nuniform mat4 viewMatrix;\nuniform vec3 cameraPosition;\nvec4 linearToOutputTexel(vec4 v) { return v; }\n';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-glsl-'));
    const progs = [['coral', SH.CORAL_VS, SH.CORAL_FS], ['polyp', SH.POLYP_VS, SH.POLYP_FS], ['rock', SH.ROCK_VS, SH.ROCK_FS], ['sand', SH.SURF_VS, SH.SAND_FS], ['snow', SH.SNOW_VS, SH.SNOW_FS]];
    for (const [name, vs, fsrc] of progs) {
      for (const [stage, src, pre] of [['vert', vs, VP], ['frag', fsrc, FP]]) {
        const f = path.join(dir, `${name}.${stage}`);
        fs.writeFileSync(f, pre + src);
        let log = '', good = true;
        try { log = execFileSync(GV, [f], { encoding: 'utf8' }); } catch (e) { good = false; log = String(e.stdout || '') + String(e.stderr || ''); }
        ok(good, `${name}.${stage}${good ? '' : ': ' + log.split('\n').filter(l => /ERROR/.test(l)).slice(0, 3).join(' | ')}`);
      }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── 6. page ──
sect('6. page in jsdom on a fake WebGL2');
function loadJsdom() {
  const require = createRequire(import.meta.url);
  try {
    const dirs = [process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(path.delimiter)].filter(Boolean);
    return require(require.resolve('jsdom', { paths: dirs.length ? dirs : undefined })).JSDOM;
  } catch (e) { return null; }
}
function mediaFor(w, h, coarse) {
  const feat = f => {
    const [k, v] = f.trim().replace(/^\(|\)$/g, '').split(':').map(s => s.trim()), n = parseFloat(v);
    if (k === 'max-width') return w <= n; if (k === 'min-width') return w >= n;
    if (k === 'max-height') return h <= n; if (k === 'min-height') return h >= n;
    if (k === 'pointer') return (v === 'coarse') === coarse;
    if (k === 'orientation') return (v === 'landscape') === (w > h);
    if (k === 'prefers-reduced-motion') return false;
    return false;
  };
  return q => ({ matches: q.split(',').some(part => part.split(/\band\b/).every(feat)), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}
let bootN = 0;
async function boot({ w = 1280, h = 720, coarse = false, dpr = 2 } = {}) {
  const JSDOM = loadJsdom(); if (!JSDOM) return null;
  installThree();
  const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
  const dom = new JSDOM(html.replace(/<script type="module"[^>]*><\/script>/, '').replace(/<script src="[^"]*"><\/script>/g, ''), { url: 'http://localhost:8963/stella-nova/pages/coral-species/index.html', pretendToBeVisual: true });
  const win = dom.window, doc = win.document;
  win.matchMedia = mediaFor(w, h, coarse);
  const view = doc.getElementById('view');
  for (const [k, v] of [['clientWidth', w], ['clientHeight', h]]) Object.defineProperty(view, k, { value: v, configurable: true });
  const fake = fakeCanvas({ w, h, canvas: view });
  win.HTMLCanvasElement.prototype.getContext = function (kind) { return this === view && kind === 'webgl2' ? fake.gl : null; };
  const rafQ = [];
  win.requestAnimationFrame = f => { rafQ.push(f); return rafQ.length; };
  const Gl = globalThis, saved = {};
  const keys = ['window', 'document', 'navigator', 'getComputedStyle', 'requestAnimationFrame', 'HTMLElement', 'Element', 'Node', 'Event', 'matchMedia', 'addEventListener', 'removeEventListener', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'location', 'Worker', 'HTMLCanvasElement', 'sessionStorage'];
  for (const k of keys) saved[k] = Object.getOwnPropertyDescriptor(Gl, k);
  const val = k => (k === 'window' ? win : k === 'devicePixelRatio' ? dpr : k === 'innerWidth' ? w : k === 'innerHeight' ? h : k === 'Worker' ? undefined : (typeof win[k] === 'function' && /^[a-z]/.test(k) ? win[k].bind(win) : win[k]));
  for (const k of keys) Object.defineProperty(Gl, k, { value: val(k), configurable: true, writable: true });
  const errors = [], cerr = console.error, cwarn = console.warn;
  console.error = (...a) => { const s = a.map(x => (x && x.stack) || String(x)).join(' '); if (!/^THREE\.WebGLRenderer|UniformsUtils/.test(s)) errors.push(s); };
  console.warn = () => {};
  const P = {
    win, doc, fake, errors,
    frames(n = 1) { for (let i = 0; i < n; i++) { const q = rafQ.splice(0); for (const f of q) { try { f(performance.now()); } catch (e) { errors.push('frame: ' + (e && e.stack || e)); } } } },
    async run(ms) { const end = Date.now() + ms; while (Date.now() < end) { P.frames(1); await new Promise(r => setTimeout(r, 4)); } },
    close() { console.error = cerr; console.warn = cwarn; for (const k of keys) { if (saved[k]) Object.defineProperty(Gl, k, saved[k]); else delete Gl[k]; } win.close(); },
  };
  try { await import(pathToFileURL(path.join(HERE, 'main.js')).href + `?boot=${bootN++}`); } catch (e) { errors.push('import: ' + (e && e.stack || e)); }
  return P;
}
{
  const P = await boot({ w: 1280, h: 720 });
  if (!P) console.log('  skip page checks: no jsdom (set JSDOM_DIR or NODE_PATH to a folder with jsdom@24.1.3)');
  else {
    const d = P.doc;
    ok(!P.errors.length, `boot with no errors${P.errors.length ? ': ' + P.errors[0].slice(0, 300) : ''}`);
    ok(d.getElementById('nogl').hidden, 'WebGL2 (fake) is up: no "WebGL not available" note');
    ok(d.querySelectorAll('#species button').length === SPECIES_IDS.length, `species chips: ${d.querySelectorAll('#species button').length}`);
    ok(d.querySelectorAll('#modes button').length >= 5 && d.querySelectorAll('#gradPick .gg-sw').length >= 10, 'colour-by chips and the gradient picker');
    await P.run(6000);
    // the user (2026-10-18, Safari on Mac): "the lighting on the coral
    // species page isn't working for me" - a milky, blown out, flat frame
    const lk = P.win.__speciesLook && P.win.__speciesLook();
    ok(lk && lk.down <= 1 && Number(d.getElementById('sDown').value) === lk.down, `light from above ${lk && lk.down} (was 2), the slider agrees`);
    ok(lk && lk.scatter !== null && lk.scatter <= 0.25 && lk.shaft <= 0.6, `volume in-scatter ${lk && lk.scatter}, shafts ${lk && lk.shaft} (were 1 and 1: a milky veil)`);
    let expMaxSeen = 0;
    for (let i = 0; i < 48; i++) { P.frames(1); const q = P.win.__speciesLook(); expMaxSeen = Math.max(expMaxSeen, q.uExposure, q.exposure); }
    ok(lk && expMaxSeen <= 3, `auto exposure capped on every frame (48 frames, 4 auto exposure updates): most ${expMaxSeen}`);
    ok(lk && lk.key / lk.fill >= 4, `key to fill ${lk && (lk.key / lk.fill).toFixed(1)} (was 2.5): the lamp direction reads`);
    const n1 = Number(d.getElementById('rN').textContent.replace(/\D/g, ''));
    ok(n1 > 5, `the colony grows on the main thread runner: ${n1} particles after 6 s, state "${d.getElementById('rState').textContent}"`);
    ok(n1 < 600, `a watchable pace: ${n1} particles in 6 s (a full colony is about 90 s)`);
    d.getElementById('sSpeed').value = '4'; d.getElementById('sSpeed').dispatchEvent(new P.win.Event('input'));
    d.querySelector('#species button[data-id="table"]').click();
    await P.run(2500);
    ok(d.getElementById('rSp').textContent === 'Table coral' && d.querySelector('#species button.on').dataset.id === 'table', 'a species chip starts a new table coral');
    d.getElementById('bPlay').click();
    await P.run(300);
    const nP = d.getElementById('rN').textContent; await P.run(1500);
    ok(d.getElementById('rN').textContent === nP && /Paused/.test(d.getElementById('rState').textContent), `pause holds the colony at ${nP}`);
    d.getElementById('bPlay').click();
    const sv = P.win.snSaver;
    ok(sv && typeof sv.enter === 'function' && typeof sv.exit === 'function', 'window.snSaver has enter and exit');
    const labels = [];
    const r = sv.enter({ calm: 0.7, seed: 4, label: i => labels.push(i) });
    ok(r && r.canvas === d.getElementById('view') && r.warmupMs > 0, 'enter returns the canvas and a warmup');
    await P.run(3000);
    const dbg = sv.debug();
    const L = labels.filter(Boolean).pop();
    ok(dbg.on && dbg.stage && L && L.title && L.params.length === 4 && L.code && /function|=>|\(/.test(L.code.text), `saver stage ${dbg.stage && dbg.stage.species}, label "${L && L.title}", code ${L && L.code ? L.code.name : 'none'}`);
    ok(d.documentElement.classList.contains('sn-saver'), 'saver class on html');
    sv.exit();
    ok(!d.documentElement.classList.contains('sn-saver') && !P.errors.length, `exit restores the page${P.errors.length ? ': ' + P.errors[0].slice(0, 200) : ''}`);
    P.close();
  }
  const Q = await boot({ w: 390, h: 844, coarse: true, dpr: 3 });
  if (Q) {
    const d = Q.doc;
    await Q.run(1500);
    ok(!Q.errors.length, `phone boot 390x844 with no errors${Q.errors.length ? ': ' + Q.errors[0].slice(0, 300) : ''}`);
    ok(!d.getElementById('panel').classList.contains('open'), 'phone: the sheet starts closed');
    d.getElementById('dockMenu').click();
    ok(d.getElementById('panel').classList.contains('open'), 'phone: Menu opens the sheet');
    const sp0 = d.getElementById('dockSpName').textContent; d.getElementById('dockSp').click();
    ok(d.getElementById('dockSpName').textContent !== sp0, `phone: the dock species button cycles (${sp0} -> ${d.getElementById('dockSpName').textContent})`);
    const pr = Q.fake.gl.canvas ? Q.fake.gl.canvas.width / 390 : 0;
    ok(pr > 0 && pr <= 1.5 + 1e-6, `phone pixel ratio capped: ${pr.toFixed(2)}`);
    Q.close();
  }
}

// static checks
sect('7. static');
{
  const css = fs.readFileSync(path.join(HERE, 'style.css'), 'utf8'), html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
  ok(css.includes('[hidden]{display:none!important}'), 'style.css has [hidden]{display:none!important}');
  const head = html.slice(0, html.indexOf('<meta charset'));
  ok(head.indexOf('gpu-guard.js') >= 0 && head.indexOf('gpu-guard.js') < head.indexOf('wishlist.js'), 'wishlist.js loads after gpu-guard.js');
  ok(/github\.com\/fogleman\/dlaf/.test(html) && fs.readFileSync(path.join(HERE, 'CREDITS.txt'), 'utf8').includes('Copyright (C) 2019 Michael Fogleman'), 'dlaf credit in the page and CREDITS.txt');
}

// panel (lib/sn-panel.js): panel-check.mjs in its own process
sect('8. panel');
{
  let out = '', code = 0;
  try { out = execFileSync(process.execPath, [path.join(HERE, 'panel-check.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 }); }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); code = e.status ?? 1; }
  for (const l of out.trim().split('\n').filter(l => /^FAIL/.test(l))) console.log('  ' + l);
  const sum = out.trim().split('\n').filter(l => /^panel-check:/.test(l)).pop() || `exit ${code}`;
  ok(code === 0, `panel-check.mjs: ${sum}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
