// ============================================================================
//  MUJOCO LAB  ·  main.js — the page: panel, gallery, view, loop
// ----------------------------------------------------------------------------
//  lab.js holds the sim (no DOM). This file mounts the sim kit panel
//  (widgets/sim-kit/ui.js) with the physics, visualisation and generator
//  groups, adds the simulate-style sections (model, simulation, control,
//  joints, sensors, contacts, MJCF editor), the model gallery, the 3D view
//  from render/ (render/README.md), the share link and the frame loop.
//
//  window.__mujoco  (for the screensaver agent and for tests)
//    load(src)       'key' | { model, seed } | { kind, seed } | { xml, files?, name? }
//                    -> Promise<stats>; a bad model throws, the old one stays
//    setOptions(o)   { timestep, integrator, solver, iterations, gravity: [3],
//                    wind: [3], density, viscosity, cone, noslip, impratio,
//                    substeps } -> options
//    play() pause() step(n = 1) reset() setSpeed(x) (0.05 .. 4)
//    setCamera(c)    { azimuth, elevation, distance, lookat: [x, y, z] } (degrees,
//                    metres, MuJoCo z up), also { mode: 'track', body }
//    getCamera()     the same shape, or null before the view mounts
//    setVisual(f)    renderer flags (render/README.md), for example
//                    { contactPoints: true, contactForces: true }
//    setDriver(mode, { amp, freq })   'off' | 'random' | 'sine'
//    stats()         { time, rtf, ncon, nbody, energy, options, ... }
//    canvas          the 3D canvas; models, kinds: the lists
//    lab, sim, view  the controller, the core sim, the renderer
//
//  GREP MAP
//    const SCHEMA .............. kit groups: physics, visual, generator
//    async function loadSource . every model load goes through here
//    function buildModelSection / buildSimSection / buildControlSection
//    function buildJointSection / buildSensorSection / buildContactSection
//    function buildEditorSection  MJCF editor (textarea over a highlight)
//    function buildGallery ..... model cards
//    async function openExplain  "How MuJoCo works" dialog (explain/index.js)
//    async function mountView .. render/renderer.js into #stage
//    function frameView ........ setViewOffset so the subject is not under the panel
//    function frame ............ the loop
//    function shareURL ......... the share link (lab.encodeShare)
//    function release .......... pagehide: free WASM objects and GL
// ============================================================================
import { mount, core as K } from '../../widgets/sim-kit/ui.js';
import { createLab, encodeShare, decodeShare, MODELS, SCENE_KINDS, INTEGRATORS, SOLVERS, CONES } from './lab.js';
import { GROUPS } from './core/models.js';
import { highlightXML, readUpload } from './io.js';

const $ = id => document.getElementById(id);
const el = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'on') for (const t in v) e.addEventListener(t, v[t]);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(kids)) if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
};
const fmt = (x, d = 3) => (x == null || !isFinite(x) ? '–' : Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(2) : x.toFixed(d));

// ---- kit schema -----------------------------------------------------------------
const VIS = [
  ['contactPoints', 'Contact points'], ['contactForces', 'Contact forces'], ['jointAxes', 'Joint axes'], ['com', 'Centres of mass'],
  ['inertia', 'Inertia boxes'], ['actuators', 'Actuator forces'], ['tendons', 'Tendons', true], ['constraints', 'Constraint violations'],
  ['frames', 'Body frames'], ['transparent', 'Transparent'], ['wireframe', 'Wireframe'], ['perturb', 'Perturbation spring', true],
];
const SHORTVIS = { contactPoints: 'cp', contactForces: 'cf', jointAxes: 'ja', com: 'com', inertia: 'in', actuators: 'ac', tendons: 'te', constraints: 'cv', frames: 'fr', transparent: 'tr', wireframe: 'wf', perturb: 'pe' };
const SCHEMA = { groups: [
  { id: 'phys', label: 'Physics options', open: false, random: false, hint: 'The options of mjModel.opt. Changes stay when you reset or edit the model; "Model defaults" undoes them.', controls: [
    { key: 'timestep', type: 'range', label: 'Timestep', min: 0.0001, max: 0.02, step: 0.0001, value: 0.002, unit: ' s', digits: 4 },
    { key: 'substeps', type: 'range', label: 'Substeps for each step', min: 1, max: 20, step: 1, value: 1 },
    { key: 'integrator', type: 'choice', label: 'Integrator', options: INTEGRATORS.map(id => ({ id, label: id === 'implicitfast' ? 'Impl. fast' : id === 'implicit' ? 'Implicit' : id })), value: 'Euler', seg: true },
    { key: 'solver', type: 'choice', label: 'Solver', options: SOLVERS, value: 'Newton' },
    { key: 'iterations', type: 'range', label: 'Solver iterations', min: 1, max: 200, step: 1, value: 100 },
    { key: 'cone', type: 'choice', label: 'Friction cone', options: CONES.map(id => ({ id, label: id === 'pyramidal' ? 'Pyramidal' : 'Elliptic' })), value: 'pyramidal' },
    { key: 'impratio', type: 'range', label: 'Impedance ratio', min: 0.1, max: 20, step: 0.1, value: 1 },
    { key: 'noslip', type: 'range', label: 'Noslip iterations', min: 0, max: 20, step: 1, value: 0 },
    { key: 'gz', type: 'range', label: 'Gravity z', min: -30, max: 10, step: 0.01, value: -9.81, unit: ' m/s²' },
    { key: 'gx', type: 'range', label: 'Gravity x', min: -10, max: 10, step: 0.01, value: 0, unit: ' m/s²' },
    { key: 'wx', type: 'range', label: 'Wind x', min: -20, max: 20, step: 0.1, value: 0, unit: ' m/s' },
    { key: 'wy', type: 'range', label: 'Wind y', min: -20, max: 20, step: 0.1, value: 0, unit: ' m/s' },
    { key: 'density', type: 'range', label: 'Medium density', min: 0, max: 10, step: 0.001, value: 0, unit: ' kg/m³', digits: 3 },
    { key: 'viscosity', type: 'range', label: 'Medium viscosity', min: 0, max: 0.5, step: 0.00001, value: 0, unit: ' Pa s', digits: 5 },
    { type: 'button', label: 'Model defaults', action: 'optDefaults' },
  ] },
  { id: 'vis', label: 'Visualisation', open: false, random: false, controls: [
    ...VIS.map(([key, label, on]) => ({ key, type: 'toggle', label, value: !!on })),
    K.themeControl('night'),
  ] },
  { id: 'gen', label: 'Scene generator', open: false, hint: 'Each seed gives the same scene. The dice in the panel head (or N) draws a new seed.', controls: [
    { key: 'kind', type: 'choice', label: 'Kind', options: Object.entries(SCENE_KINDS).map(([id, k]) => ({ id, label: k.name })), value: 'dominoes', seg: false },
    { type: 'button', label: 'Make this scene', action: 'generate' },
  ] },
] };
const OPT_KEYS = ['timestep', 'substeps', 'integrator', 'solver', 'iterations', 'cone', 'impratio', 'noslip', 'gz', 'gx', 'wx', 'wy', 'density', 'viscosity'];

// ---- state ------------------------------------------------------------------------
const lab = createLab();
let view = null, THREE = null, canvas = null, booted = false, lastT = 0, raf = 0, released = false;
const panels = {};          // section id -> { sec, update() }
const shareIn = decodeShare(location.hash);

const kit = mount({
  schema: SCHEMA, title: 'MuJoCo Lab', sub: 'Loading…', panelTitle: 'Simulation', hash: false,
  footer: 'MuJoCo 3.15.0 by Google DeepMind, Apache-2.0 (github.com/google-deepmind/mujoco). This page runs the WASM build in your browser.',
  actions: {
    optDefaults: () => { lab.resetOptions(); syncOptionControls(); kit.say('Model defaults'); writeHash(); },
    generate: () => loadSource({ kind: kit.state.kind, seed: kit.seed }),
  },
});
kit.shareURL = shareURL;
if (shareIn.speed) kit.setSpeed(shareIn.speed);
const vis0 = new Set(shareIn.visual || []);
if (shareIn.visual) { const d = K.defaults(SCHEMA); for (const [k, s] of Object.entries(SHORTVIS)) kit.set(k, vis0.has(s) ? !d[k] : d[k], 'hash'); }
if (shareIn.kind) kit.set('kind', shareIn.kind, 'hash');

kit.on('change', (out, st, why) => {
  if (why === 'model') return;
  const o = {};
  for (const k in out) {
    if (k === 'gz' || k === 'gx') { const g = lab.sim.options().gravity; g[k === 'gz' ? 2 : 0] = out[k]; o.gravity = g; }
    else if (k === 'wx' || k === 'wy') { const w = (o.wind || lab.sim.options().wind); w[k === 'wx' ? 0 : 1] = out[k]; o.wind = w; }
    else if (OPT_KEYS.includes(k)) o[k] = out[k];
  }
  if (Object.keys(o).length && lab.sim) { lab.setOptions(o); writeHash(); }
  const flags = {};
  for (const [k] of VIS) if (k in out) flags[k] = out[k];
  if (Object.keys(flags).length && view) { view.setFlags(flags); writeHash(); }
  if ('theme' in out && view) view.setLook({ theme: out.theme });
});
kit.on('scene', seed => loadSource({ kind: kit.state.kind, seed }));
kit.on('reset', () => { lab.restart(); refreshPanels(true); });

function syncOptionControls() {
  if (!lab.sim) return;
  const o = lab.sim.options();
  kit.load({ timestep: o.timestep, substeps: lab.sim.substeps, integrator: o.integrator, solver: o.solver, iterations: o.iterations, cone: o.cone, impratio: o.impratio,
    noslip: o.noslip, gz: o.gravity[2], gx: o.gravity[0], wx: o.wind[0], wy: o.wind[1], density: o.density, viscosity: o.viscosity }, 'model');
}

// ---- sections ------------------------------------------------------------------------
const pbody = kit.root.querySelector('.sk-pbody');
function section(id, label, open = false) {
  const sec = el('section', { class: 'sk-group ml-sec' + (open ? ' open' : ''), 'data-group': id });
  const gb = el('div', { class: 'sk-gbody', id: 'ml-g-' + id });
  const fold = el('button', { class: 'sk-gh', type: 'button', 'aria-expanded': String(open), 'aria-controls': 'ml-g-' + id, on: { click: () => { const o = !sec.classList.contains('open'); sec.classList.toggle('open', o); fold.setAttribute('aria-expanded', String(o)); if (o) refreshPanels(true); } } },
    [el('span', { class: 'sk-chev', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>' }), el('span', { text: label })]);
  sec.appendChild(el('div', { class: 'sk-ghead' }, [fold, el('span', { class: 'sk-gtools' })]));
  sec.appendChild(gb);
  return { sec, body: gb, tools: sec.querySelector('.sk-gtools'), get open() { return sec.classList.contains('open') && kit.panelOpen; } };
}
const kitGroup = id => pbody.querySelector(`[data-group="${id}"]`);
function rangeRow(label, min, max, step, value, onInput, digits = 3) {
  const out = el('output', { class: 'sk-val' });
  const inp = el('input', { type: 'range', min, max, step, 'aria-label': label });
  inp.value = value; out.textContent = fmt(+value, digits);
  inp.addEventListener('input', () => { out.textContent = fmt(+inp.value, digits); onInput(+inp.value); });
  const row = el('div', { class: 'sk-row sk-range' }, [el('label', { text: label }), out, inp]);
  row.set = v => { inp.value = v; out.textContent = fmt(v, digits); };
  row.input = inp;
  return row;
}
function segRow(label, items, value, onPick) {
  const row = el('div', { class: 'sk-seg', role: 'radiogroup', 'aria-label': label });
  const bs = items.map(([id, text]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(id === value), text, on: { click: () => { bs.forEach((b, i) => b.setAttribute('aria-checked', String(items[i][0] === id))); onPick(id); } } }));
  bs.forEach(b => row.appendChild(b));
  const wrap = el('div', { class: 'sk-row sk-choice' }, [el('span', { class: 'sk-lab', text: label }), row]);
  wrap.set = id => bs.forEach((b, i) => b.setAttribute('aria-checked', String(items[i][0] === id)));
  return wrap;
}

// Model: name, source, licence, gallery, upload
function buildModelSection() {
  const S = section('model', 'Model', true);
  const name = el('p', { class: 'ml-mname' }), blurb = el('p', { class: 'sk-hint ml-blurb' }), src = el('p', { class: 'ml-src' });
  const file = el('input', { type: 'file', accept: '.xml,.zip,.stl,.obj,.msh,.png', multiple: true, hidden: true, id: 'ml-file' });
  file.addEventListener('change', () => { if (file.files.length) loadFiles([...file.files]); file.value = ''; });
  S.body.append(name, blurb, src, el('div', { class: 'sk-btns' }, [
    el('button', { class: 'sk-btn sk-accent', type: 'button', text: 'Browse models', on: { click: () => openGallery(true) } }),
    el('button', { class: 'sk-btn', type: 'button', text: 'Load your own', title: 'An MJCF .xml file, MJCF and mesh files, or a .zip', on: { click: () => file.click() } }),
    el('button', { class: 'sk-btn', type: 'button', text: 'How MuJoCo works', on: { click: () => openExplain(true) } }),
  ]), file);
  S.update = () => {
    const s = lab.source; if (!s) return;
    const e = s.model ? MODELS.find(m => m.key === s.model) : null;
    name.textContent = s.name + (s.edited ? ' (edited)' : '');
    blurb.textContent = e ? e.blurb : s.kind ? SCENE_KINDS[s.kind].blurb + ' Seed ' + s.seed + '.' : 'Your own MJCF. A share link cannot carry it.';
    src.replaceChildren();
    if (e) {
      const so = e.source;
      src.append(el('span', { class: 'ml-lic', text: so.licence }), ' ', so.url ? el('a', { href: so.url, target: '_blank', rel: 'noopener', text: so.name }) : so.name, so.copyright ? ' · © ' + so.copyright : '', so.note ? el('span', { class: 'ml-note2', text: ' ' + so.note }) : null);
    } else if (s.kind) src.append(el('span', { class: 'ml-lic', text: 'Apache-2.0' }), ' Generated by this page (scenes.js, core/procedural.js)');
    $('credit-model').textContent = e ? ' · model: ' + e.name + ', ' + e.source.licence : s.kind ? ' · scene: generated' : ' · model: yours';
  };
  return S;
}

// Simulation: keyframes, readouts
function buildSimSection() {
  const S = section('sim', 'Simulation', true);
  const sel = el('select', { 'aria-label': 'Keyframe' });
  const kf = el('div', { class: 'sk-row sk-select' }, [el('label', { text: 'Keyframe' }), el('span', { class: 'sk-selw' }, [sel])]);
  const apply = el('button', { class: 'sk-btn', type: 'button', text: 'Go to keyframe', on: { click: () => { if (lab.sim && lab.sim.keyframe(+sel.value)) { refreshPanels(true); kit.say('Keyframe ' + (lab.sim.keyNames[+sel.value] || sel.value)); } } } });
  const dl = el('dl', { class: 'ml-stats' });
  S.body.append(kf, el('div', { class: 'sk-btns' }, [apply]), dl);
  S.rebuild = () => {
    sel.replaceChildren();
    const names = lab.sim ? lab.sim.keyNames : [];
    names.forEach((n, i) => sel.appendChild(el('option', { value: i, text: n || 'key ' + i })));
    kf.hidden = apply.hidden = !names.length;
  };
  S.update = () => {
    const st = lab.stats(); if (!st.loaded) return;
    const rows = [['Time', fmt(st.time, 3) + ' s'], ['Real-time factor', fmt(st.rtf, 2) + '×'], ['Step', fmt(st.stepMs, 3) + ' ms'], ['Steps', String(st.steps)],
      ['Energy', fmt(st.energy.total, 4) + ' J'], ['Kinetic', fmt(st.energy.kinetic, 4) + ' J'], ['Bodies / dofs', st.nbody + ' / ' + st.nv], ['Actuators / sensors', st.nu + ' / ' + st.nsensor]];
    dl.replaceChildren(...rows.flatMap(([a, b]) => [el('dt', { text: a }), el('dd', { text: b })]));
  };
  return S;
}

// Control: drivers and one slider per actuator
function buildControlSection() {
  const S = section('ctrl', 'Control');
  const list = el('div', { class: 'ml-acts' });
  const mode = segRow('Driver', [['off', 'Manual'], ['random', 'Random'], ['sine', 'Sine wave']], 'off', m => { lab.setDriver(m); list.classList.toggle('ml-driven', m !== 'off'); });
  const amp = rangeRow('Driver amplitude', 0, 1, 0.01, 0.6, v => lab.setDriver(lab.driver.mode, { amp: v }), 2);
  const freq = rangeRow('Driver frequency (Hz)', 0.05, 4, 0.05, 0.5, v => lab.setDriver(lab.driver.mode, { freq: v }), 2);
  const zero = el('button', { class: 'sk-btn', type: 'button', text: 'Zero the controls', on: { click: () => { mode.set('off'); lab.setDriver('off'); for (let i = 0; i < (lab.sim ? lab.sim.nu : 0); i++) lab.setCtrl(i, 0); S.rebuild(); } } });
  const none = el('p', { class: 'sk-hint', text: 'This model has no actuators.' });
  S.body.append(mode, amp, freq, el('div', { class: 'sk-btns' }, [zero]), none, list);
  let rows = [];
  S.rebuild = () => {
    list.replaceChildren(); rows = [];
    const sim = lab.sim, n = sim ? sim.nu : 0;
    none.hidden = n > 0; mode.hidden = amp.hidden = freq.hidden = zero.parentNode.hidden = n === 0;
    for (let i = 0; i < n; i++) {
      const [a, b] = lab.ctrlBounds(i);
      const r = rangeRow(sim.actuatorNames[i] || 'actuator ' + i, a, b, (b - a) / 200, sim.d.ctrl[i], v => { if (lab.driver.mode === 'off') lab.setCtrl(i, v); }, 2);
      rows.push(r); list.appendChild(r);
    }
  };
  S.update = () => { if (lab.driver.mode !== 'off' && lab.sim) rows.forEach((r, i) => r.set(lab.sim.d.ctrl[i])); };
  S.reset = () => { mode.set('off'); lab.setDriver('off'); list.classList.remove('ml-driven'); };
  return S;
}

// Joints: live qpos table
function buildJointSection() {
  const S = section('joints', 'Joints');
  const tb = el('tbody');
  const table = el('table', { class: 'ml-table' }, [el('thead', {}, [el('tr', {}, [el('th', { text: 'Joint' }), el('th', { text: 'Type' }), el('th', { text: 'qpos' })])]), tb]);
  const note = el('p', { class: 'sk-hint', text: 'qpos of each joint. A free joint shows position (m) and quaternion; a ball joint a quaternion; hinges in rad, slides in m.' });
  S.body.append(note, el('div', { class: 'ml-scroll' }, [table]));
  let cells = [];
  S.rebuild = () => {
    tb.replaceChildren(); cells = [];
    for (const r of lab.jointRows().slice(0, 120)) { const c = el('td', { class: 'ml-num' }); cells.push(c); tb.appendChild(el('tr', {}, [el('td', { text: r.name }), el('td', { text: r.type }), c])); }
  };
  S.update = () => { const rows = lab.jointRows(); cells.forEach((c, i) => { const r = rows[i]; if (r) c.textContent = r.q.map(x => fmt(x, 3)).join(' '); }); };
  return S;
}

// Sensors: live plots
const PLOT_N = 240, PLOT_COL = ['#7cc4ff', '#ffb347', '#8bdc6b'];
function buildSensorSection() {
  const S = section('sensors', 'Sensors');
  const wrap = el('div', { class: 'ml-plots' }), none = el('p', { class: 'sk-hint', text: 'This model has no sensors. Add a <sensor> block in the MJCF editor.' });
  S.body.append(none, wrap);
  let plots = [];
  S.rebuild = () => {
    wrap.replaceChildren(); plots = [];
    const ss = lab.sim ? lab.sim.sensors().slice(0, 24) : [];
    none.hidden = ss.length > 0;
    for (const s of ss) {
      const cv = el('canvas', { class: 'ml-plot', width: 280, height: 56, 'aria-label': 'Plot of sensor ' + s.name });
      const val = el('span', { class: 'sk-val' });
      wrap.appendChild(el('div', { class: 'ml-pl' }, [el('div', { class: 'ml-plh' }, [el('span', { text: s.name || 'sensor' }), val]), cv]));
      plots.push({ cv, val, dim: Math.min(3, s.value.length), buf: Array.from({ length: Math.min(3, s.value.length) }, () => new Float32Array(PLOT_N)), n: 0 });
    }
  };
  S.sample = () => {
    if (!plots.length || !lab.sim) return;
    const ss = lab.sim.sensors();
    plots.forEach((p, i) => { const v = ss[i].value; for (let k = 0; k < p.dim; k++) { p.buf[k].copyWithin(0, 1); p.buf[k][PLOT_N - 1] = v[k]; } p.n = Math.min(PLOT_N, p.n + 1); p.last = v; });
  };
  S.update = () => {
    for (const p of plots) {
      const g = p.cv.getContext && p.cv.getContext('2d'); if (!g) continue;
      const W = p.cv.width, H = p.cv.height;
      let lo = Infinity, hi = -Infinity;
      for (const b of p.buf) for (let i = PLOT_N - p.n; i < PLOT_N; i++) { lo = Math.min(lo, b[i]); hi = Math.max(hi, b[i]); }
      if (!(hi > lo)) { hi = (isFinite(hi) ? hi : 0) + 1e-6; lo = hi - 2e-6; }
      g.clearRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
      p.buf.forEach((b, k) => {
        g.strokeStyle = PLOT_COL[k]; g.lineWidth = 1.5; g.beginPath();
        for (let i = PLOT_N - p.n; i < PLOT_N; i++) { const x = i / (PLOT_N - 1) * W, y = H - 3 - (b[i] - lo) / (hi - lo) * (H - 6); i === PLOT_N - p.n ? g.moveTo(x, y) : g.lineTo(x, y); }
        g.stroke();
      });
      if (p.last) p.val.textContent = Array.from(p.last).slice(0, 3).map(x => fmt(x, 3)).join(' ');
    }
  };
  return S;
}

// Contacts: count, total force, the largest contacts
function buildContactSection() {
  const S = section('contacts', 'Contacts');
  const dl = el('dl', { class: 'ml-stats' }), tb = el('tbody');
  S.body.append(dl, el('div', { class: 'ml-scroll' }, [el('table', { class: 'ml-table' }, [el('thead', {}, [el('tr', {}, [el('th', { text: 'Geoms' }), el('th', { text: 'Normal (N)' }), el('th', { text: 'Friction (N)' })])]), tb])]));
  S.update = () => {
    const c = lab.contactInfo(8);
    dl.replaceChildren(...[['Contacts', String(c.count)], ['Sum of normal forces', fmt(c.normal, 2) + ' N'], ['Net force (world)', c.total.map(x => fmt(x, 2)).join(', ') + ' N'], ['Deepest penetration', fmt(c.maxPen * 1000, 2) + ' mm']]
      .flatMap(([a, b]) => [el('dt', { text: a }), el('dd', { text: b })]));
    tb.replaceChildren(...c.list.map(r => el('tr', {}, [el('td', { text: r.a + ' · ' + r.b }), el('td', { class: 'ml-num', text: fmt(r.fn, 2) }), el('td', { class: 'ml-num', text: fmt(r.ft, 2) })])));
  };
  return S;
}

// MJCF editor: a transparent textarea over a highlighted <pre>
function buildEditorSection() {
  const S = section('xml', 'MJCF editor');
  const pre = el('pre', { class: 'ml-hl', 'aria-hidden': 'true' });
  const ta = el('textarea', { class: 'ml-ta', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'MJCF text of the current model' });
  const err = el('p', { class: 'ml-err', role: 'alert', hidden: true });
  let hlT = 0;
  const paint = () => { pre.innerHTML = highlightXML(ta.value); pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; };
  ta.addEventListener('input', () => { clearTimeout(hlT); hlT = setTimeout(paint, ta.value.length > 60000 ? 300 : 30); });
  ta.addEventListener('scroll', () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); paint(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); reload(); }
  });
  async function reload() {
    err.hidden = true;
    try { await lab.reloadXML(ta.value); afterLoad(false); kit.say('Model compiled'); }
    catch (e) { err.textContent = String(e && e.message || e).replace(/^MuJoCo Error: /, ''); err.hidden = false; }
  }
  const wide = el('button', { class: 'sk-btn', type: 'button', text: 'Wide', title: 'Make the panel wide for editing', 'aria-pressed': 'false', on: { click: () => { const on = !kit.root.classList.contains('ml-wide'); kit.root.classList.toggle('ml-wide', on); wide.setAttribute('aria-pressed', String(on)); } } });
  S.body.append(el('p', { class: 'sk-hint', text: 'Edit the MJCF and compile it (Ctrl or Cmd + Enter). Mesh and texture files of the model stay loaded. A model that does not compile shows its error, and the old model keeps running.' }),
    el('div', { class: 'ml-ed' }, [pre, ta]), err,
    el('div', { class: 'sk-btns' }, [
      el('button', { class: 'sk-btn sk-accent', type: 'button', text: 'Compile and load', on: { click: reload } }),
      el('button', { class: 'sk-btn', type: 'button', text: 'Revert', on: { click: () => { S.rebuild(); err.hidden = true; } } }),
      el('button', { class: 'sk-btn', type: 'button', text: 'Download', on: { click: () => { const a = el('a', { href: URL.createObjectURL(new Blob([ta.value], { type: 'application/xml' })), download: (lab.source ? lab.source.name : 'model').replace(/[^\w.-]+/g, '_') + '.xml' }); document.body.appendChild(a); a.click(); a.remove(); } } }),
      wide,
    ]));
  S.rebuild = () => { ta.value = lab.source ? lab.source.xml : ''; ta.scrollTop = 0; paint(); };
  S.update = () => {};
  S.textarea = ta;
  return S;
}

// Panel order: model, simulation, control, physics, visualisation, joints, sensors, contacts, editor, generator
function buildSections() {
  panels.model = buildModelSection(); panels.sim = buildSimSection(); panels.ctrl = buildControlSection();
  panels.joints = buildJointSection(); panels.sensors = buildSensorSection(); panels.contacts = buildContactSection(); panels.xml = buildEditorSection();
  const order = [panels.model.sec, panels.sim.sec, panels.ctrl.sec, kitGroup('phys'), kitGroup('vis'), panels.joints.sec, panels.sensors.sec, panels.contacts.sec, panels.xml.sec, kitGroup('gen')];
  const foot = pbody.querySelector('.sk-foot');
  for (const n of order) if (n) pbody.insertBefore(n, foot);
}

let panelT = 0;
function refreshPanels(force) {
  const now = performance.now();
  if (!force && now - panelT < 100) return;
  panelT = now;
  for (const id of ['sim', 'ctrl', 'joints', 'contacts']) if (panels[id] && (force || panels[id].open)) panels[id].update();
  if (panels.sensors && (force || panels.sensors.open)) panels.sensors.update();
  hud();
}

// ---- gallery --------------------------------------------------------------------------
let THUMBS = new Set();
function buildGallery() {
  const list = $('gallery-list');
  list.replaceChildren();
  const card = (key, name, group, lic, blurb, heavy, onPick, thumb) => {
    const img = thumb && THUMBS.has(key) ? el('img', { src: thumb, alt: '', loading: 'lazy' }) : el('span', { class: 'ml-plate', text: name.split(/\s+/).map(w => w[0]).join('').slice(0, 3) });
    return el('button', { class: 'ml-card', type: 'button', 'data-key': key, title: blurb, on: { click: onPick } }, [
      el('span', { class: 'ml-thumb ml-g' + GROUPS.indexOf(group) }, [img]),
      el('span', { class: 'ml-cname', text: name }),
      el('span', { class: 'ml-cmeta' }, [el('span', { class: 'ml-lic', text: lic }), heavy ? el('span', { class: 'ml-heavy', text: 'heavy', title: 'Can run slower than real time on a phone' }) : null]),
    ]);
  };
  for (const g of GROUPS) {
    const row = el('div', { class: 'ml-grow' });
    for (const m of MODELS.filter(x => x.group === g)) row.appendChild(card(m.key, m.name, g, m.source.licence.replace(/ \(.*$/, ''), m.blurb, m.heavy, () => { openGallery(false); loadSource({ model: m.key, seed: m.seeded ? lab.newSeed() : undefined }); }, m.thumb));
    list.append(el('h3', { text: g }), row);
  }
  const row = el('div', { class: 'ml-grow' });
  for (const [k, v] of Object.entries(SCENE_KINDS)) row.appendChild(card('gen-' + k, v.name, 'Generated scenes', 'Apache-2.0', v.blurb + ' A new seed each time.', false, () => { openGallery(false); kit.set('kind', k, 'model'); loadSource({ kind: k, seed: lab.newSeed() }); }));
  list.append(el('h3', { text: 'Generated scenes (seeded)' }), row);
}
function openGallery(on) {
  const g = $('gallery');
  g.hidden = !on;
  if (on) { const cur = lab.source && (lab.source.model || 'gen-' + lab.source.kind); const b = g.querySelector(`[data-key="${cur}"]`) || g.querySelector('.ml-card'); if (b) b.focus(); }
}

// ---- explainer (explain/index.js, another agent's module; mounted on first open) ----
let explainer = null;
async function openExplain(on) {
  $('explain-dlg').hidden = !on;
  if (!on) return;
  if (!explainer) {
    try { const m = await import('./explain/index.js'); explainer = m.mountExplainer($('explain'), { mj: lab.mj }); }
    catch (e) { console.error(e); $('explain').textContent = 'The explainer could not load.'; }
  }
}

// ---- loading ----------------------------------------------------------------------------
let loading = null;
function status(t, isErr) { const b = $('boot'); b.textContent = t || ''; b.hidden = !t; b.classList.toggle('ml-bad', !!isErr); }
async function loadSource(src, { keepOptions = false, quiet = false } = {}) {
  const job = (async () => {
    status('Loading ' + (src.model ? MODELS.find(m => m.key === src.model).name : src.kind ? SCENE_KINDS[src.kind].name : src.name || 'model') + '…');
    try {
      if (view && view.perturbing) view.endPerturb();
      await lab.load(src, { keepOptions });
      afterLoad(true);
      status('');
      return lab.stats();
    } catch (e) {
      console.error(e);
      status('Could not load: ' + String(e && e.message || e).replace(/^MuJoCo Error: /, ''), true);
      setTimeout(() => { if ($('boot').classList.contains('ml-bad')) status(''); }, 6000);
      if (quiet) return null;
      throw e;
    }
  })();
  loading = job;
  return job;
}
function afterLoad(newModel) {
  const s = lab.source;
  kit.root.querySelector('.sk-title p') && (kit.root.querySelector('.sk-title p').textContent = s.name);
  if (s.seed != null && (s.kind || s.seeded)) { kit.seed = s.seed; kit.refresh(); }
  syncOptionControls();
  panels.ctrl.reset(); for (const id of ['sim', 'ctrl', 'joints', 'sensors', 'xml']) panels[id].rebuild && panels[id].rebuild();
  panels.model.update();
  if (view) { view.setSim(lab.sim); if (newModel) view.setCamera({ mode: 'free', ...s.camera }); }
  refreshPanels(true);
  writeHash();
}
async function loadFiles(files) {
  try {
    status('Reading ' + files.length + ' file' + (files.length > 1 ? 's' : '') + '…');
    const u = await readUpload(files);
    await loadSource({ xml: u.xml, files: u.files, name: u.name });
    panels.xml.sec.classList.add('open');
    kit.say('Loaded ' + u.main);
  } catch (e) { status(String(e && e.message || e).replace(/^MuJoCo Error: /, ''), true); setTimeout(() => status(''), 6000); }
}

// ---- share link -------------------------------------------------------------------------
function visualList() {
  const d = K.defaults(SCHEMA), out = [];
  for (const [k, s] of Object.entries(SHORTVIS)) if (kit.state[k] !== d[k]) out.push(s);
  return out;
}
function shareURL() {
  const st = lab.shareState({ speed: kit.baseSpeed, visual: visualList(), camera: view ? camOf(view.getCamera()) : null });
  return location.href.split('#')[0] + '#' + encodeShare(st);
}
const camOf = c => (c && c.lookat ? { azimuth: c.azimuth, elevation: c.elevation, distance: c.distance, lookat: c.lookat } : null);
let hashT = 0;
function writeHash() {
  if (window.snSaverActive) return;
  clearTimeout(hashT);
  hashT = setTimeout(() => { try { const st = lab.shareState({ speed: kit.baseSpeed, visual: visualList() }); history.replaceState(null, '', '#' + encodeShare(st)); } catch (e) { /* sandboxed */ } }, 300);
}

// ---- the 3D view ------------------------------------------------------------------------
async function mountView() {
  if (view || released) return view;
  let mod;
  try { mod = await import('./render/renderer.js'); } catch (e) { return null; }
  try {
    THREE = THREE || globalThis.THREE || await import('three');   // a THREE global (r139, tests) wins over the r160 module
    canvas = canvas || el('canvas', { id: 'view', 'aria-hidden': 'true' });
    if (!canvas.parentNode) $('stage').appendChild(canvas);
    const st = kit.state;
    view = mod.createMjRenderer(canvas, lab.sim, { THREE, phone: kit.phone, theme: st.theme, flags: Object.fromEntries(VIS.map(([k]) => [k, st[k]])) });
    view.setCamera({ mode: 'free', ...(shareIn.camera || lab.source.camera) });
    shareIn.camera = null;
    view.resize(); frameView();
    $('stage-note').hidden = true;
    return view;
  } catch (e) { console.error(e); view = null; status('The 3D view could not start: ' + (e && e.message || e), true); return null; }
}
// render/ is built by another agent: poll for it until it is there
async function waitView() {
  for (let i = 0; i < 40 && !view && !released; i++) {
    if (await mountView()) return;
    $('stage-note').hidden = false;
    await new Promise(r => setTimeout(r, 3000));
  }
}

// The panel and the dock cover part of the canvas: move the view centre into
// the clear part with setViewOffset (the wave-membrane occlusion pattern).
function occlusion() {
  const W = innerWidth, H = innerHeight, o = { right: 0, bottom: 0 };
  const p = kit.root.querySelector('.sk-panel'), tr = kit.root.querySelector('.sk-transport');
  const r = p && kit.panelOpen ? p.getBoundingClientRect() : null;
  if (r && r.width > 0) {
    if (r.height > H * 0.8 || r.top < H * 0.3) o.right = Math.max(0, W - r.left);     // a drawer at the right
    else o.bottom = Math.max(0, H - r.top);                                           // a bottom sheet
  } else if (kit.panelOpen && !kit.phone) o.right = 336;                             // no layout yet (tests)
  if (kit.phone && tr) { const t = tr.getBoundingClientRect(); if (t.height > 0 && t.width > W * 0.8) o.bottom = Math.max(o.bottom, H - t.top); }
  return o;
}
function frameView() {
  if (!view || !view.camera || !view.camera.setViewOffset) return;
  const W = innerWidth, H = innerHeight, o = occlusion();
  const dx = Math.min(o.right, W * 0.45) / 2, dy = Math.min(o.bottom, H * 0.6) / 2;
  if (dx || dy) view.camera.setViewOffset(W, H, dx, dy, W, H); else view.camera.clearViewOffset();
  view.camera.updateProjectionMatrix();
}

// ---- HUD ---------------------------------------------------------------------------------
function hud() {
  const st = lab.stats(); if (!st.loaded) return;
  const slow = st.rtf && st.rtf < 0.9 * kit.speed && kit.playing;
  $('hud').innerHTML = `<span>t ${fmt(st.time, 2)} s</span><span class="${slow ? 'ml-warn' : ''}" title="Simulated seconds per real second">${fmt(st.rtf, 2)}× real time</span><span>${st.ncon} contacts</span><span>${fmt(st.stepMs, 3)} ms/step</span>` + (kit.playing ? '' : '<span class="ml-paused">paused</span>');
}

// ---- loop -------------------------------------------------------------------------------
function frame(t) {
  raf = requestAnimationFrame(frame);
  if (!lab.sim || released) return;
  const dt = lastT ? (t - lastT) / 1000 : 1 / 60;
  lastT = t;
  const single = !kit.playing && kit.takeStep();
  const n = lab.frame(dt, { playing: kit.playing, speed: kit.speed, single });
  if (n && panels.sensors) panels.sensors.sample();
  if (view) view.render();
  refreshPanels(false);
}

// ---- pointer extras: drop files, keys ------------------------------------------------------
function bindDrop() {
  let depth = 0;
  addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { depth++; $('drop').hidden = false; e.preventDefault(); } });
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('drop').hidden = true; } });
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => { e.preventDefault(); depth = 0; $('drop').hidden = true; const f = [...(e.dataTransfer.files || [])]; if (f.length) loadFiles(f); });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('gallery').hidden) openGallery(false);
    if (e.key === 'Escape' && !$('explain-dlg').hidden) openExplain(false);
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'm' || e.key === 'M') openGallery($('gallery').hidden);
    if (e.key === 'Backspace' && lab.sim) { lab.restart(); refreshPanels(true); }
  });
  $('gallery-close').addEventListener('click', () => openGallery(false));
  $('explain-close').addEventListener('click', () => openExplain(false));
  $('gallery').addEventListener('click', e => { if (e.target === $('gallery')) openGallery(false); });
  addEventListener('resize', () => { if (view) { view.resize(); frameView(); } });
  kit.on('panel', () => setTimeout(frameView, 300));
}
// a "Models" button in the transport (the dock on a phone)
function addModelsButton() {
  const tr = kit.root.querySelector('.sk-transport');
  const b = el('button', { class: 'sk-tb ml-models', type: 'button', title: 'Models (M)', 'aria-label': 'Choose a model', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>', on: { click: () => openGallery($('gallery').hidden) } });
  tr.insertBefore(b, tr.firstChild);
}

// ---- release on pagehide -------------------------------------------------------------------
function release() {
  released = true;
  cancelAnimationFrame(raf);
  try { if (view) view.dispose(); } catch (e) { /* gone */ }
  try { if (explainer) explainer.dispose(); } catch (e) { /* gone */ }
  try { const gl = canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl')); const x = gl && gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) { /* gone */ }
  view = null;
  lab.dispose();
}
addEventListener('pagehide', e => { if (!e.persisted) release(); });

// ---- __mujoco ------------------------------------------------------------------------------
const api = {
  load: src => loadSource(typeof src === 'string' ? { model: src } : src),
  setOptions: o => { const r = lab.setOptions(o); syncOptionControls(); writeHash(); return r; },
  play: () => kit.setPlaying(true), pause: () => kit.setPlaying(false),
  step: (n = 1) => { kit.setPlaying(false); if (lab.sim) lab.sim.step(n); refreshPanels(true); },
  reset: () => { lab.restart(); refreshPanels(true); },
  setSpeed: x => { kit.baseSpeed = Math.min(4, Math.max(0.05, +x || 1)); },
  setCamera: c => view && view.setCamera({ mode: 'free', ...c }),
  getCamera: () => (view ? view.getCamera() : null),
  setVisual: f => { for (const k in f) if (SHORTVIS[k]) kit.set(k, !!f[k]); if (view) view.setFlags(f); },
  setDriver: (m, p) => lab.setDriver(m, p),
  stats: () => ({ ...lab.stats(), playing: kit.playing, speed: kit.speed, view: !!view }),
  models: MODELS.map(m => ({ key: m.key, name: m.name, group: m.group, heavy: !!m.heavy })),
  kinds: Object.keys(SCENE_KINDS),
  get canvas() { return canvas; }, get lab() { return lab; }, get sim() { return lab.sim; }, get view() { return view; }, get booted() { return booted; },
  openExplain, openGallery, kit, release,
};
window.__mujoco = api;

// ---- boot ----------------------------------------------------------------------------------
async function boot() {
  buildSections(); addModelsButton(); bindDrop();
  try { const t = await import('./thumbs/list.js'); THUMBS = new Set(t.THUMBS || t.default || []); } catch (e) { /* no thumbnails yet */ }
  buildGallery();
  try { await lab.init(); } catch (e) { status('MuJoCo could not start: ' + (e && e.message || e), true); return; }
  const first = shareIn.kind ? { kind: shareIn.kind, seed: shareIn.seed ?? 1 } : shareIn.model ? { model: shareIn.model, seed: shareIn.seed } : { kind: 'dominoes', seed: lab.newSeed() };
  try { await loadSource(first); } catch (e) { await loadSource({ model: 'double-pendulum' }, { quiet: true }); }
  if (Object.keys(shareIn.options).length) { lab.setOptions(shareIn.options); syncOptionControls(); writeHash(); }
  booted = true;
  raf = requestAnimationFrame(frame);
  waitView();
}
boot();
