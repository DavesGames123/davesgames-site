// ============================================================================
//  BIOME PARTS  ·  main.js — the page: goal, build loop, panels, exports
// ----------------------------------------------------------------------------
//  Boots the brain (worker.js, Taiga-S1) and the scene (scene.js, the SDF lab
//  ray marcher) in parallel. A build is: brain.start -> think -> act -> think
//  ... until Done, the step budget or an unrecoverable state. Step does one
//  act + think; Play repeats with a delay from the speed slider; a tap on a
//  score row acts with that command instead (an override) and the model
//  carries on from the state it finds.
//
//  SCRUB. The scrubber replays the log: seek(k) starts the same goal again
//  and acts the first k logged commands (the session is deterministic, so
//  the part is the same; tests.mjs checks it). The longer log stays as the
//  tape, so a seek forward works too, until a new step makes a new branch.
//
//  GREP MAP
//    boot ............... brain + scene, status line
//    goal editor ........ setGoal / gallery / random levels / add item
//    build loop ......... build / step / play / pick (override) / seek
//    show ............... one view -> scene, HUD, panels, tokens, scrubber
//    exports ............ STL, JSON, SDF Forge hand-off, toast
//    workspace .......... panels.js, keys: Space, arrows, B, [ ], and L G I C E H
//    pagehide ........... release the GPU and end the worker
// ============================================================================
import { createBrain } from './brain.js';
import { createScene } from './scene.js';
import { GALLERY } from './gallery.js';
import { KIND_INFO, sampleLiveGoal, rng, describe } from './goals.js';
import { meshOf, toSTL, toSdfLabDoc } from './part.js';
import { renderGoal, renderScores, renderChecks, renderTree, renderLog, renderTicks, renderTokens, renderEval, actionLabel } from './ui.js';
import { createWorkspace } from './panels.js';
import { EVAL_ROWS, EVAL_NOTE } from './evalnums.js';
import { installSaver } from './saver.js';

const $ = id => document.getElementById(id);
const clone = x => JSON.parse(JSON.stringify(x));
const START = {
  pd: { doc_open: true, workbench: 'PartDesignWorkbench', body: false },
  nodoc: { doc_open: false, workbench: 'StartWorkbench', body: false },
  part: { doc_open: true, workbench: 'PartWorkbench', body: false },
  body: { doc_open: true, workbench: 'PartDesignWorkbench', body: true },
};
const app = { brain: null, scene: null, goal: clone(GALLERY.flange.goal), goalKey: 'flange', view: null, playing: false, busy: false, took: null, log: [], dirtyGoal: true, framed: false, tape: [], built: null, box: null };
window.__biome = app;

// ── boot ────────────────────────────────────────────────────────────────────
function status(t, err = false) { const s = $('status'); s.textContent = t; s.classList.toggle('err', err); }
async function boot() {
  const pb = createBrain().then(b => {
    app.brain = b;
    status(`Taiga-S1 v${b.info.version || '?'} · ${(b.info.params / 1e6).toFixed(2)}M params · ${b.info.where === 'worker' ? 'worker' : 'main thread'}`);
  }).catch(e => status('model failed to load: ' + (e && e.message || e), true));
  const ps = (async () => {
    if (!navigator.gpu) throw new Error('no-webgpu');
    app.scene = await createScene({ canvas: $('view'), overlay: $('ov'), onLost: () => { $('nogpu').hidden = false; } });
    app.scene.frame(null, { yaw: 38, pitch: 28 });
  })().catch(() => { $('nogpu').hidden = false; });
  await Promise.all([pb, ps]);
  installSaver({ app, $, show, prepare: () => stopPlay() });
  previewTarget();
}

// ── goal editor ─────────────────────────────────────────────────────────────
function goalChanged() {
  app.dirtyGoal = true; app.goalKey = null;
  for (const b of $('gallery').children) b.classList.remove('on');
  drawGoal(); previewTarget();
}
function drawGoal() {
  const v = app.view, d = v && v.decision;
  renderGoal($('items'), app.goal, { onChange: goalChanged, active: d ? d.active : -1, built: v ? v.progress : -1 });
  $('goalNote').textContent = `${app.goal.features.length} items. Taiga-S1 trained on up to 5; the repo tests up to 17.`;
  renderChecks($('checks'), app.goal, v);
}
function setGoal(goal, key = null) {
  stopPlay();
  app.goal = clone(goal); app.goalKey = key; app.dirtyGoal = true; app.view = null;
  for (const b of $('gallery').children) b.classList.toggle('on', b.dataset.key === key);
  drawGoal(); previewTarget(); showPanels();
}
function scaleOf(goal) {
  const p = goal.features[0].params, k = goal.features[0].kind;
  return k === 'base_box' ? Math.max(p.w, p.d, p.h) : k === 'base_ring' ? Math.max(2 * p.ro, p.h) : Math.max(2 * p.r, p.h);
}
// Show the goal's target (the clean expert build) as a ghost-free preview.
async function previewTarget() {
  if (!app.brain || !app.scene || app.busy) return;
  try {
    const goal = clone(app.goal); goal.scale = scaleOf(goal);
    const v = await app.brain.start({ goal, start: START.pd });
    app.scene.setTape(v.target.ops, v.target.bbox, { instant: true });
    app.box = v.target.bbox;
    app.scene.frame(v.target.bbox, {});
    app.scene.setSketch(null);
    $('hudStep').textContent = 'target preview'; $('hudAct').textContent = ''; $('hudItem').textContent = 'Press Build to watch Taiga-S1 make it';
    app.view = null; app.dirtyGoal = true;
    showPanels();
  } catch (e) { $('goalNote').textContent = 'This goal cannot be built: ' + (e.message || e); }
}

// ── build loop ──────────────────────────────────────────────────────────────
async function build() {
  if (!app.brain) return;
  stopPlay();
  const goal = clone(app.goal); goal.scale = scaleOf(goal);
  app.busy = true;
  try {
    const start = START[$('startSel').value] || START.pd;
    let v = await app.brain.start({ goal, start });
    app.built = { goal: clone(goal), start };
    app.dirtyGoal = false; app.took = null; $('banner').hidden = true;
    app.box = v.target.bbox;
    app.scene && app.scene.frame(v.target.bbox, {});
    show(v);
    v = await app.brain.think();
    show(v);
  } catch (e) { $('goalNote').textContent = 'Build failed: ' + (e.message || e); }
  app.busy = false;
}
async function step(action = null, kind = 'model') {
  if (!app.brain || app.busy) return;
  if (!app.view || app.dirtyGoal || app.view.finished) { await build(); if (!action) return; }
  app.busy = true;
  try {
    let a = action, k = kind;
    const d = app.view.decision;
    if (!a && $('noiseChk').checked && d && Math.random() < 0.2) {
      const pool = d.rows.filter(r => r.a !== 'Done'); a = pool[Math.floor(Math.random() * pool.length)].a; k = 'noise';
    }
    app.took = a || (d && d.choice);
    let v = await app.brain.act({ action: a, kind: k });
    show(v, { kind: k, action: app.took });
    if (!v.finished) { v = await app.brain.think(); show(v); }
  } catch (e) { $('goalNote').textContent = 'Step failed: ' + (e.message || e); stopPlay(); }
  app.busy = false;
}
const delay = () => 1300 - 1240 * parseFloat($('speed').value);
async function playLoop() {
  while (app.playing) {
    await step();
    if (app.view && app.view.finished) { stopPlay(); break; }
    await new Promise(r => setTimeout(r, delay()));
  }
}
function play() { if (app.playing) { stopPlay(); return; } app.playing = true; $('playBtn').textContent = 'Pause'; playLoop(); }
function stopPlay() { app.playing = false; $('playBtn').textContent = 'Play'; }
function pick(a) { stopPlay(); step(a, 'user'); }
// Replay the tape to step k: the same goal and start, the first k commands.
async function seek(k) {
  if (!app.brain || app.busy || !app.built || !app.tape.length) return;
  stopPlay();
  k = Math.max(0, Math.min(app.tape.length, k | 0));
  if (app.view && !app.dirtyGoal && app.view.logLen === k) return;
  const tape = app.tape;
  app.busy = true; $('scrub').disabled = true; $('scrubLab').textContent = 'replaying…';
  try {
    let v = await app.brain.start({ goal: clone(app.built.goal), start: app.built.start });
    for (let i = 0; i < k; i++) v = await app.brain.act({ action: tape[i].action, kind: tape[i].kind });
    if (!v.finished) v = await app.brain.think();
    app.dirtyGoal = false; app.took = null;
    show(v, { seek: true });
  } catch (e) { $('goalNote').textContent = 'Replay failed: ' + (e.message || e); }
  app.busy = false; $('scrub').disabled = false;
}
function drawScrub() {
  const at = app.view ? app.view.logLen || 0 : 0, n = Math.max(at, app.tape.length);
  const s = $('scrub');
  s.max = String(n); s.value = String(at);
  $('scrubLab').textContent = app.view ? `step ${at}${n > at ? ' of ' + n : ''}` : 'step 0';
  renderTicks($('ticks'), app.tape, at);
}

// ── show one view ───────────────────────────────────────────────────────────
function show(v, extra = {}) {
  if (!v) return;
  app.view = v;
  const sc = app.scene;
  if (sc) {
    sc.setTape(v.ops, v.bbox || v.target.bbox);
    sc.setSketch(v.edit);
    const nw = v.ops.length ? v.ops[v.ops.length - 1].id : null;
    sc.setHighlight(extra.action && /^PartDesign_/.test(extra.action) ? nw : null);
  }
  const d = v.decision;
  $('hudStep').textContent = `step ${v.step} / ${v.budget}${v.finished ? '' : ''}`;
  const last = v.last;
  const act = $('hudAct');
  act.classList.toggle('noise', !!(last && last.kind === 'noise'));
  if (d && !v.finished) {
    const top = d.rows[0];
    act.innerHTML = '';
    act.append(document.createTextNode('next: ' + actionLabel(top.a)));
    const s = document.createElement('span'); s.className = 'p'; s.textContent = top.p.toFixed(3); act.append(s);
  } else if (last) act.textContent = (last.kind === 'noise' ? 'gremlin: ' : last.kind === 'user' ? 'you: ' : '') + actionLabel(last.action);
  const ai = d ? d.active : v.progress;
  $('hudItem').textContent = ai < v.goal.features.length ? `item ${ai + 1}: ${describe(v.goal.features[ai])}` : 'all items built';
  if (v.finished) {
    const r = v.result || {};
    const b = $('banner');
    b.hidden = false; b.className = 'banner ' + (r.success ? 'ok' : 'bad');
    b.textContent = r.success ? `Built in ${v.step} steps${r.overrides ? `, ${r.overrides} by you` : ''} · IoU ${r.iou.toFixed(3)}` : `Not built: ${r.outcome} (IoU ${(r.iou || 0).toFixed(2)})`;
  } else $('banner').hidden = true;
  showPanels();
  if (app.brain) app.brain.log().then(log => {
    app.log = log;
    if (!extra.seek) app.tape = log;
    renderLog($('log'), log); drawScrub();
  });
}
function showPanels() {
  const v = app.view;
  renderScores($('scores'), v, { onPick: pick, took: null });
  drawGoal();
  renderTree($('tree'), v);
  renderTokens($('tokens'), v);
}

// ── exports ─────────────────────────────────────────────────────────────────
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const partOps = () => (app.view && app.view.ops.length ? app.view : null);
let toastT = 0;
function toast(t) {
  const e = $('toast');
  e.textContent = t; e.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('on'), 4200);
}
function note(t) { $('expNote').textContent = t; toast(t); }
function exportSTL() {
  const v = partOps();
  if (!v) { note('Build something first.'); return; }
  $('expNote').textContent = 'Meshing…';
  setTimeout(() => {
    const { m, stats } = meshOf(v.ops, { bbox: v.bbox }, 110);
    download('biome-part.stl', toSTL(m), 'model/stl');
    note(`STL: ${stats.tris} triangles, ${stats.closed ? 'closed' : 'NOT closed'}, ${Math.round(stats.volume)} mm³ (marching cubes on the distance field; millimetres, Z up).`);
  }, 30);
}
function exportJSON() {
  const v = app.view;
  const out = { source: 'Biome Parts, davesgames.io', model: { name: 'Taiga-S1', version: app.brain && app.brain.info.version, url: 'https://huggingface.co/shhivv/taiga-s1', licence: 'MIT' },
    goal: v ? v.goal : app.goal, start: $('startSel').value, steps: app.log, result: v && v.result || null };
  download('biome-part.json', JSON.stringify(out, null, 1), 'application/json');
  note(`Goal + log JSON: ${out.goal.features.length} items, ${app.log.length} steps.`);
}
function openForge() {
  const v = partOps();
  if (!v) { note('Build something first.'); return; }
  const doc = toSdfLabDoc(v.ops);
  const text = JSON.stringify(doc);
  try { localStorage.setItem('sdf-forge-doc-v1', text); } catch (e) { /* storage blocked */ }
  download('biome-part.sdf.json', text, 'application/json');
  note('SDF Forge scene saved (an approximation: no top fillets, chamfers or shell). It opens as the autosave, or with Open in SDF Forge.');
  try { if (window.parent !== window && typeof window.parent.switchTab === 'function') { window.parent.switchTab('sdf-lab'); return; } } catch (e) { /* cross-origin */ }
  window.open('../sdf-lab/index.html', '_blank', 'noopener');
}

// ── wiring ──────────────────────────────────────────────────────────────────
for (const [key, g] of Object.entries(GALLERY)) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = g.name; b.title = g.note; b.dataset.key = key;
  b.onclick = () => setGoal(g.goal, key);
  $('gallery').append(b);
}
let seedN = (Date.now() & 0xffff) || 1;
for (let L = 1; L <= 6; L++) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = 'L' + L;
  b.title = L <= 3 ? 'like the training goals' : L === 4 ? '6-7 items, held-out length' : L === 5 ? '8-9 items' : '11 items';
  b.onclick = () => setGoal(sampleLiveGoal(L, rng(seedN++)));
  $('levels').append(b);
}
for (const [k, info] of Object.entries(KIND_INFO)) {
  if (info.group === 'base') continue;
  const o = document.createElement('option'); o.value = k; o.textContent = info.label; $('addKind').append(o);
}
$('addBtn').onclick = () => {
  const k = $('addKind').value, p = {};
  for (const [key, , lo, hi] of KIND_INFO[k].params) p[key] = key === 'n' ? 4 : key === 'x' || key === 'y' ? 0 : Math.round(Math.min(hi, lo * 3) * 10) / 10;
  app.goal.features.push({ kind: k, params: p });
  goalChanged();
};
$('startSel').onchange = () => { app.dirtyGoal = true; };
$('buildBtn').onclick = () => build();
$('stepBtn').onclick = () => { stopPlay(); step(); };
$('playBtn').onclick = () => play();
$('stlBtn').onclick = exportSTL;
$('jsonBtn').onclick = exportJSON;
$('forgeBtn').onclick = openForge;
// On a phone the stage shrinks above an open sheet: frame the part again.
let ws = null;
ws = createWorkspace({ $, onLayout: () => { if (ws && ws.phone && app.scene) app.scene.frame(app.view && app.view.bbox || app.box, {}); } });
app.ws = ws;
const scrub = $('scrub');
scrub.oninput = () => { $('scrubLab').textContent = `step ${scrub.value} of ${scrub.max}`; renderTicks($('ticks'), app.tape, +scrub.value); };
scrub.onchange = () => seek(+scrub.value);
renderEval($('evalTable'), EVAL_ROWS);
$('evalNote').textContent = EVAL_NOTE;
document.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input,select,textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest && e.target.closest('.grip') && /^Arrow(Up|Down)$/.test(e.key)) return;
  if (e.key === ' ') { e.preventDefault(); play(); }
  else if (e.key === 'ArrowRight') { stopPlay(); step(); }
  else if (e.key === 'ArrowLeft' || e.key === '[') { if (app.view) seek((app.view.logLen || 0) - 1); }
  else if (e.key === ']') { if (app.view) seek((app.view.logLen || 0) + 1); }
  else if (e.key === 'b' || e.key === 'B') build();
  else if (ws.keys(e)) e.preventDefault();
});
window.addEventListener('pagehide', () => { stopPlay(); if (app.scene) app.scene.destroy(); if (app.brain) app.brain.terminate(); });
import('../../../lib/sci-math.js').then(m => m.typesetAll && m.typesetAll()).catch(() => {});
drawGoal();
drawScrub();
boot();
