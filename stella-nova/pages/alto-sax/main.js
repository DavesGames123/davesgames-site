// ============================================================================
//  ALTO SAX MECHANISM  ·  main.js — the page: view, chart, picking, panel
// ----------------------------------------------------------------------------
//  model.js holds the data and the solver, scene.js builds the 3D model,
//  synth.js makes the sound. This file mounts the renderer in #stage, binds
//  the panel, the dock and the keys, and runs the frame loop.
//
//  CONTROLS
//    click or tap a touch piece ... press it or let it go (it stays down)
//    drag ......................... orbit;  wheel or pinch: zoom
//    Left / Right ................. previous or next note of the chart
//    1-8 .......................... isolate a mechanism group; 0 = all
//    E explode  C release all  S sound  T group colours  L labels  R view
//
//  STATE
//    pressed (Set of touch ids) -> M.solve() -> S.setState() each change.
//    last: the touch that was pressed last. Its linkage path is traced
//    (M.movedBy) and the keys it moves glow. A chart note glows every key
//    that moves for the note and traces every pressed touch.
//
//  PHONE  (the wave-membrane pattern)
//    #dock at the base. Portrait: #panel is a bottom sheet (#sheetGrip tap =
//    half or full, drag down = close). Landscape: a drawer on the right.
//    occlusion() measures the panel, the dock and the topbar; the camera
//    view offset moves the model into the clear part of the window.
//
//  window.altoSax  (the saver hook in saver.js and the console use it)
//    ready, THREE, renderer, camera, controls, S, M,
//    setTouches(ids, o), setIsolate(g, amount), sphere(g), lookAt(o),
//    saver(on), onFrame
//
//  GREP MAP
//    function boot ............ renderer, environment, model, first frame
//    function applyState ...... solve, set targets, glow, trace, readout
//    function buildChart ...... the fingering chart buttons
//    function setGroup ........ isolate, ghost, explode, labels, text
//    function pick ............ ray cast on the touch pieces
//    function occlusion ....... overlay margins for the view offset
//    function fit ............. camera distance for a sphere in the clear part
//    function frame ........... the loop
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as M from './model.js';
import { buildSax } from './scene.js';
import { createSynth } from './synth.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const GROUP_KEYS = ['oct', 'lh', 'palm', 'table', 'side', 'rh', 'rp', 'neck'];
const synth = createSynth();

let renderer, scene, camera, controls, S, pathGroup;
const pressed = new Set();
let last = null, curFing = null, group = null, explodeAmt = 0.6, labelsOn = true, soundOn = false, dirty = true;
let saverOn = false, fly = null;
const occ = { l: 0, r: 0, t: 0, b: 0 };
const app = { ready: null, THREE, M, onFrame: null };
window.altoSax = app;

// ---- boot ------------------------------------------------------------------------------
function boot() {
  const stage = $('stage');
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PHONE_Q.matches ? 2 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const key = new THREE.DirectionalLight(0xfff1dc, 1.5); key.position.set(500, 700, 900); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc4ff, 0.9); rim.position.set(-700, 300, -600); scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x8aa0c0, 0x201810, 0.35));
  camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 4, 8000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.09; controls.minDistance = 90; controls.maxDistance = 3200;
  controls.addEventListener('change', () => { dirty = true; });

  S = buildSax(THREE, M);
  scene.add(S.root);
  pathGroup = new THREE.Group(); pathGroup.renderOrder = 10; scene.add(pathGroup);
  Object.assign(app, { renderer, camera, controls, S, scene });

  const c = sphere(null);
  controls.target.copy(c.c);
  camera.position.copy(c.c).add(new THREE.Vector3(Math.sin(0.42), 0.12, Math.cos(0.42)).normalize().multiplyScalar(1500));
  buildChart(); buildGroups(); bindUI();
  setOpen(!PHONE_Q.matches);
  requestAnimationFrame(() => { fit(c, true); });
  applyState();
  $('boot').hidden = true;
  $('counts').textContent = countsText();
  addEventListener('resize', onResize);
  requestAnimationFrame(frame);
}

function countsText() {
  const k = M.counts(), s = S.stats;
  return `${k.keys} keys, ${k.touches} touch pieces, ${k.holes} tone holes (${k.cups} pad cups), ${k.rods} hinges (${s.posts} posts, ${s.screws} screws), ${s.needle} needle and ${s.flat} flat springs, ${s.felts} felts, ${s.corks} corks, ${k.links} linkages.`;
}

// ---- state -----------------------------------------------------------------------------
function applyState() {
  const list = [...pressed], r = M.solve(list);
  S.setState(r);
  // matching chart entry
  curFing = M.FINGERINGS.find(f => f.touches.length === list.length && f.touches.every(t => pressed.has(t))) || null;
  let glowKeys = [], glowLinks = [], path = [];
  if (last && pressed.has(last)) {
    const mv = M.movedBy(last, list);
    glowKeys = mv.keys; glowLinks = mv.links; path = mv.path.map(p => [...p, last]);
  } else if (list.length) {
    glowKeys = [...r.act];
    for (const t of list) { const mv = M.movedBy(t, list); glowLinks.push(...mv.links); path.push(...mv.path.map(p => [...p, t])); }
  }
  S.setGlow(glowKeys, glowLinks);
  app.path = path;
  tracePath();
  readout(r);
  movesText(r);
  for (const b of document.querySelectorAll('#chart button, #chartAlt button')) b.classList.toggle('on', !!curFing && b.dataset.f === curFing.id);
  dirty = true;
}

function readout(r) {
  const nm = M.PRETTY(M.noteName(r.note)), snd = M.PRETTY(M.noteName(r.note + M.TRANSPOSE));
  const chart = curFing ? (curFing.alt ? ` (${curFing.alt})` : '') : '';
  $('noteName').textContent = nm + chart;
  $('noteTitle').textContent = curFing || pressed.size ? nm : '';
  $('dockNote').textContent = nm;
  const vent = r.vent ? M.HOLE[r.vent].name : 'the bell end (every hole closed)';
  const oct = r.octave ? `${r.octave === 'neck' ? 'neck' : 'body'} octave pip open` : 'no octave pip';
  const open = M.HOLES.filter(h => h.kind !== 'register' && r.holes[h.id]).length;
  $('noteSub').textContent = `Written ${nm}, sounds ${snd} (${M.hz(r.note).toFixed(1)} Hz) · ${oct}`;
  $('ventLine').textContent = `First open hole: ${vent}. ${open} of ${M.HOLES.length - 2} tone holes open.`;
  const chips = $('pressed'); chips.textContent = '';
  if (!pressed.size) { const s = document.createElement('span'); s.className = 'none'; s.textContent = 'No key down: C♯5 (every tone hole open).'; chips.appendChild(s); }
  for (const t of pressed) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.t = t;
    b.style.setProperty('--c', M.GROUP[M.TOUCH[t].group].color);
    b.textContent = M.TOUCH[t].name.replace(/\s*\(.*\)$/, ''); b.title = 'Let go of ' + M.TOUCH[t].name;
    b.addEventListener('click', () => { pressed.delete(t); if (last === t) last = null; applyState(); });
    chips.appendChild(b);
  }
}

function movesText(r) {
  const box = $('moves'); box.textContent = '';
  const h = document.createElement('p'); h.className = 'meta';
  if (!last || !pressed.has(last)) {
    h.textContent = 'Press a touch piece on the model (or pick a note) to see what it moves. Each part that moves glows, and a line follows the force through each linkage.';
    box.appendChild(h); return;
  }
  const mv = M.movedBy(last, [...pressed]);
  h.innerHTML = '';
  const b = document.createElement('b'); b.textContent = M.TOUCH[last].name; h.appendChild(b);
  h.appendChild(document.createTextNode(` moves ${mv.keys.length} part${mv.keys.length > 1 ? 's' : ''}:`));
  box.appendChild(h);
  const ol = document.createElement('ol'); ol.className = 'steps';
  const li0 = document.createElement('li'); li0.textContent = `${M.KEY[mv.keys[0]].name}: ${M.KEY[mv.keys[0]].what}`; ol.appendChild(li0);
  for (const [f, lid, t] of mv.path) {
    const li = document.createElement('li'), l = M.LINK[lid];
    const st = mv.after.links.get(lid) || mv.before.links.get(lid);
    li.innerHTML = '';
    const a = document.createElement('b'); a.textContent = M.KEY[t].name; li.appendChild(a);
    li.appendChild(document.createTextNode(` ${st === 'hold' || l.kind === 'hold' ? '(held)' : ''} — ${l.why}`));
    ol.appendChild(li);
  }
  box.appendChild(ol);
  if (!mv.path.length) { const p = document.createElement('p'); p.className = 'meta'; p.textContent = 'No linkage carries this press to another key.'; box.appendChild(p); }
}

// the path line: one tube for each step, drawn over the model
const pathMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
function tracePath() {
  for (const c of pathGroup.children) c.geometry.dispose();
  pathGroup.clear();
  if (!app.path || !app.path.length) return;
  S.root.updateMatrixWorld(true);
  const seen = new Set();
  for (const [f, lid, t, touch] of app.path) {
    const k = f + lid + t; if (seen.has(k)) continue; seen.add(k);
    const pts = S.tracePoints([[f, lid, t]], touch)[0]; if (!pts || pts.some(p => !p)) continue;
    const curve = new THREE.CatmullRomCurve3(pts);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.9, 6, false), pathMat);
    m.renderOrder = 10; pathGroup.add(m);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 8), pathMat); dot.position.copy(pts[1]); dot.renderOrder = 10; pathGroup.add(dot);
  }
}

// ---- chart -------------------------------------------------------------------------------
function buildChart() {
  const ch = $('chart'), alt = $('chartAlt');
  for (const f of M.FINGERINGS) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.f = f.id;
    const nm = M.PRETTY(M.noteName(f.note));
    b.innerHTML = '';
    const s1 = document.createElement('span'); s1.textContent = nm; b.appendChild(s1);
    if (f.alt) { const s2 = document.createElement('small'); s2.textContent = f.alt; b.appendChild(s2); }
    b.title = `${nm}${f.alt ? ' (' + f.alt + ')' : ''}: ` + (f.touches.length ? f.touches.map(t => M.TOUCH[t].name).join(', ') : 'no keys');
    b.addEventListener('click', () => pickFingering(f));
    (f.alt ? alt : ch).appendChild(b);
  }
}
function pickFingering(f, sound = true) {
  pressed.clear(); for (const t of f.touches) pressed.add(t);
  last = null; applyState();
  if (sound && soundOn) synth.play(M.hz(f.note), 1.1);
}
function stepNote(d) {
  const L = M.MAIN_FINGERINGS;
  // from the chart note, or else from the note that the keys down now give
  const from = curFing ? curFing.note : M.solve([...pressed]).note;
  let i = L.findIndex(f => f.note === from);
  i = i < 0 ? (d > 0 ? 0 : L.length - 1) : (i + d + L.length) % L.length;
  pickFingering(L[i]);
}

// ---- groups ------------------------------------------------------------------------------
function buildGroups() {
  const box = $('groups');
  const mk = (id, name, color) => {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.g = id || '';
    if (color) b.style.setProperty('--c', color);
    b.textContent = name; b.addEventListener('click', () => setGroup(id)); box.appendChild(b);
  };
  mk(null, 'Whole', null);
  GROUP_KEYS.forEach((g, i) => mk(g, `${i + 1} ${M.GROUP[g].name}`, M.GROUP[g].color));
  setGroup(null, false);
}
function setGroup(g, move = true) {
  group = g || null;
  S.setGhost(group); S.setExplode(group, group ? explodeAmt : 0);
  for (const b of $('groups').children) { const on = (b.dataset.g || null) === group; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }
  $('dockGroup').textContent = group ? String(GROUP_KEYS.indexOf(group) + 1) : '◎';
  const txt = $('groupText'), parts = $('groupParts');
  txt.textContent = group ? M.GROUP[group].text : 'Pick a mechanism to isolate it. The other parts go transparent and the parts of the group move out, with a label on each part.';
  parts.textContent = '';
  if (group) {
    const keys = M.KEYS.filter(k => k.group === group);
    for (const k of keys) {
      const li = document.createElement('li'), b = document.createElement('b'); b.textContent = k.name; li.appendChild(b);
      li.appendChild(document.createTextNode(` — ${k.what}`));
      li.addEventListener('mouseenter', () => { S.setGlow([k.id], []); dirty = true; });
      li.addEventListener('mouseleave', () => applyState());
      parts.appendChild(li);
    }
    const links = M.LINKS.filter(l => { const [d, t] = M.linkEnds(l); return M.KEY[d].group === group || t.some(x => M.KEY[x].group === group); });
    for (const l of links) { const li = document.createElement('li'); li.className = 'lk'; li.textContent = l.why; parts.appendChild(li); }
    if (group === 'neck') for (const s of ['Neck tube and socket, with the clamp screw', 'Neck cork, which holds the mouthpiece', 'Mouthpiece with a flat table and a curved facing', 'Cane reed, thin at the tip', 'Ligature: two bands, a plate and two screws']) { const li = document.createElement('li'); li.textContent = s; parts.appendChild(li); }
  }
  buildLabels();
  if (move) { const sp = sphere(group); flyTo(sp, 0.9); }
  dirty = true;
}

// ---- labels ------------------------------------------------------------------------------
let labelEls = [];
function buildLabels() {
  const host = $('labels'); host.textContent = ''; labelEls = [];
  if (!group || !labelsOn || saverOn) return;
  const items = group === 'neck'
    ? [['Mouthpiece', () => pt(M.surf(40, 180, 2))], ['Reed', () => pt(M.surf(30, -65, 4))], ['Ligature', () => pt(M.surf(26, 115, 4))], ['Neck cork', () => pt(M.surf(92, 180, 3))], ['Neck screw', () => pt(M.surf(M.S_BODY + 9, 90, 12))]]
    : M.KEYS.filter(k => k.group === group).map(k => [k.name, () => S.keyPoint(k.id)]);
  for (const [name, get] of items) {
    const d = document.createElement('div'); d.className = 'lbl'; d.textContent = name;
    if (group) d.style.setProperty('--c', M.GROUP[group].color);
    host.appendChild(d); labelEls.push({ d, get });
  }
}
const pt = a => new THREE.Vector3(a[0], a[1], a[2]);
const proj = new THREE.Vector3();
function placeLabels() {
  if (!labelEls.length) return;
  const w = innerWidth, h = innerHeight, placed = [];
  for (const L of labelEls) {
    const p = L.get(); if (!p) { L.d.hidden = true; continue; }
    proj.copy(p).project(camera);
    if (proj.z > 1) { L.d.hidden = true; continue; }
    // project() gives the offset view; map NDC to the full canvas
    let x = (proj.x * 0.5 + 0.5) * w, y = (-proj.y * 0.5 + 0.5) * h;
    // push down labels that hit an earlier label
    for (const q of placed) if (Math.abs(q.x - x) < 90 && Math.abs(q.y - y) < 16) y = q.y + 17;
    placed.push({ x, y });
    L.d.hidden = false; L.d.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
}

// ---- camera ------------------------------------------------------------------------------
function sphere(g) {
  const b = S.groupBox(g), c = b.getCenter(new THREE.Vector3()), r = Math.max(30, b.getSize(new THREE.Vector3()).length() / 2);
  return { c, r };
}
app.sphere = sphere;
const OVERLAYS = () => [$('panel'), $('dock'), document.querySelector('.topbar')].filter(e => e && !saverOn);
function occlusion(w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  for (const e of OVERLAYS()) {
    if (e.id === 'panel' && !e.classList.contains('open')) continue;
    const q = e.getBoundingClientRect();
    const x0 = Math.max(0, q.left), x1 = Math.min(w, q.right), y0 = Math.max(0, q.top), y1 = Math.min(h, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) { if (fw < 0.5) continue; if (y0 + y1 > h) o.b = Math.max(o.b, h - y0); else o.t = Math.max(o.t, y1); }
    else { if (fh < 0.5) continue; if (x0 + x1 < w) o.l = Math.max(o.l, x1); else o.r = Math.max(o.r, w - x0); }
  }
  return o;
}
function frameView(snap = false) {
  if (saverOn) return;
  const w = innerWidth, h = innerHeight, o = occlusion(w, h);
  let moved = false;
  for (const k in occ) { const n = snap ? o[k] : occ[k] + (o[k] - occ[k]) * 0.2; if (Math.abs(n - occ[k]) > 0.1) moved = true; occ[k] = n; }
  camera.setViewOffset(w, h, (occ.r - occ.l) / 2, (occ.b - occ.t) / 2, w, h);
  camera.updateProjectionMatrix();
  if (moved) dirty = true;
}
// distance at which a sphere fits the clear part of the window
function fitDistance(sp) {
  const w = innerWidth, h = innerHeight, o = occlusion(w, h);
  const cw = Math.max(80, w - o.l - o.r), ch = Math.max(80, h - o.t - o.b);
  const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  // half angles of the clear part, up and across
  const av = Math.atan(tv * ch / h), ah = Math.atan(tv * cw / h);
  return 1.06 * sp.r / Math.sin(Math.min(av, ah));
}
function fit(sp, snap = false) {
  const dir = camera.position.clone().sub(controls.target).normalize();
  const d = fitDistance(sp);
  if (snap) { controls.target.copy(sp.c); camera.position.copy(sp.c).addScaledVector(dir, d); frameView(true); controls.update(); dirty = true; }
  else flyTo(sp, 0.7);
}
function flyTo(sp, dur = 0.8) {
  const dir = camera.position.clone().sub(controls.target).normalize();
  fly = { t: 0, dur, t0: controls.target.clone(), p0: camera.position.clone(), t1: sp.c.clone(), p1: sp.c.clone().addScaledVector(dir, fitDistance(sp)) };
}
function stepFly(dt) {
  if (!fly) return;
  fly.t += dt; const k = Math.min(1, fly.t / fly.dur), e = k * k * (3 - 2 * k);
  controls.target.lerpVectors(fly.t0, fly.t1, e); camera.position.lerpVectors(fly.p0, fly.p1, e);
  dirty = true; if (k >= 1) fly = null;
}
function resetView() {
  const sp = sphere(null);
  fly = { t: 0, dur: 0.8, t0: controls.target.clone(), p0: camera.position.clone(), t1: sp.c.clone(),
    p1: sp.c.clone().add(new THREE.Vector3(Math.sin(0.42), 0.12, Math.cos(0.42)).normalize().multiplyScalar(fitDistance(sp))) };
}

// ---- picking -----------------------------------------------------------------------------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function hitTouch(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(S.touchMeshes, false);
  // a visible touch piece wins over a hidden proxy at about the same depth
  let best = null;
  for (const h of hits) {
    const t = h.object.userData.touch, g = M.TOUCH[t].group;
    if (group && g !== group) continue;
    if (!best || (!h.object.userData.proxy && best.object.userData.proxy && h.distance < best.distance + 12)) best = h;
    if (best && !best.object.userData.proxy) break;
  }
  return best ? best.object.userData.touch : null;
}
function pick(t) {
  if (!t) return;
  if (pressed.has(t)) { pressed.delete(t); last = last === t ? null : last; }
  else { pressed.add(t); last = t; }
  applyState();
  if (soundOn) { const r = M.solve([...pressed]); synth.play(M.hz(r.note), 0.9); }
}

// ---- UI ----------------------------------------------------------------------------------
function setOpen(open) {
  const p = $('panel'); p.classList.toggle('open', open); p.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  $('gear').setAttribute('aria-expanded', open); $('dockPanel').setAttribute('aria-expanded', open);
  setTimeout(() => { frameView(); dirty = true; }, 320);
}
function setSound(on) {
  soundOn = on;
  for (const id of ['btnSound', 'dockSound']) { $(id).setAttribute('aria-pressed', on); $(id).classList.toggle('on', on); }
  if (on) { const r = M.solve([...pressed]); synth.play(M.hz(r.note), 0.8); } else synth.stop();
}
function bindUI() {
  const cv = renderer.domElement;
  let down = null;
  cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  cv.addEventListener('pointerup', e => {
    if (!down) return;
    const d = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
    if (d < 7 && dt < 600) pick(hitTouch(e));
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || down) return;
    const t = hitTouch(e), tip = $('tip');
    cv.style.cursor = t ? 'pointer' : '';
    if (t) { tip.hidden = false; tip.textContent = M.TOUCH[t].name; tip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`; }
    else tip.hidden = true;
  });
  cv.addEventListener('pointerleave', () => { $('tip').hidden = true; });
  $('gear').addEventListener('click', () => setOpen(true));
  $('panelClose').addEventListener('click', () => setOpen(false));
  $('dockPanel').addEventListener('click', () => setOpen(!$('panel').classList.contains('open')));
  $('dockPrev').addEventListener('click', () => stepNote(-1));
  $('dockNext').addEventListener('click', () => stepNote(1));
  $('dockNote').addEventListener('click', () => setOpen(true));
  $('dockGroup').addEventListener('click', () => { const i = group ? GROUP_KEYS.indexOf(group) : -1; setGroup(i + 1 < GROUP_KEYS.length ? GROUP_KEYS[i + 1] : null); });
  $('dockSound').addEventListener('click', () => setSound(!soundOn));
  $('btnSound').addEventListener('click', () => setSound(!soundOn));
  $('btnClear').addEventListener('click', () => { pressed.clear(); last = null; applyState(); });
  $('btnReset').addEventListener('click', () => resetView());
  $('btnTint').addEventListener('click', () => { S.setTint(!S.tint); $('btnTint').setAttribute('aria-pressed', S.tint); dirty = true; });
  $('btnLabels').addEventListener('click', () => { labelsOn = !labelsOn; $('btnLabels').setAttribute('aria-pressed', labelsOn); buildLabels(); });
  $('explode').addEventListener('input', e => { explodeAmt = +e.target.value; $('explodeVal').textContent = Math.round(explodeAmt * 100) + '%'; if (group) S.setExplode(group, explodeAmt); dirty = true; });
  // sheet grip: tap = half or full, drag down = close
  const grip = $('sheetGrip'); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; grip.setPointerCapture(e.pointerId); });
  grip.addEventListener('pointerup', e => {
    if (gy == null) return; const d = e.clientY - gy; gy = null;
    if (d > 40) setOpen(false); else if (Math.abs(d) < 8 || d < -40) { $('panel').classList.toggle('full'); setTimeout(() => { dirty = true; }, 320); }
  });
  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowRight') { stepNote(1); e.preventDefault(); }
    else if (k === 'ArrowLeft') { stepNote(-1); e.preventDefault(); }
    else if (k >= '1' && k <= '8') setGroup(GROUP_KEYS[+k - 1]);
    else if (k === '0') setGroup(null);
    else if (k === 'e' || k === 'E') { explodeAmt = explodeAmt > 0.05 ? 0 : 0.7; $('explode').value = explodeAmt; $('explode').dispatchEvent(new Event('input')); }
    else if (k === 'c' || k === 'C') $('btnClear').click();
    else if (k === 's' || k === 'S') setSound(!soundOn);
    else if (k === 't' || k === 'T') $('btnTint').click();
    else if (k === 'l' || k === 'L') $('btnLabels').click();
    else if (k === 'r' || k === 'R') resetView();
  });
  PHONE_Q.addEventListener('change', e => { setOpen(!e.matches); setTimeout(() => fit(sphere(group), true), 350); });
  setTimeout(() => $('hint').classList.add('gone'), 9000);
}
function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  frameView(true); dirty = true;
}

// ---- saver API ---------------------------------------------------------------------------
app.setTouches = (ids, o = {}) => { pressed.clear(); for (const t of ids) pressed.add(t); last = o.last || null; applyState(); };
app.setIsolate = (g, amount = 0.6) => { explodeAmt = amount; group = g || null; S.setGhost(group); S.setExplode(group, group ? amount : 0); buildLabels(); dirty = true; };
app.saver = on => {
  saverOn = !!on; controls.enabled = !saverOn;
  document.documentElement.classList.toggle('as-saver', saverOn);
  if (saverOn) { camera.clearViewOffset(); camera.updateProjectionMatrix(); $('labels').textContent = ''; labelEls = []; }
  else { app.onFrame = null; frameView(true); buildLabels(); }
  fly = null; dirty = true;
};
// lookAt({ c, az, el, dist, dy }): the saver camera (degrees, mm, px)
app.lookAt = o => {
  const az = THREE.MathUtils.degToRad(o.az), el = THREE.MathUtils.degToRad(o.el);
  controls.target.copy(o.c);
  camera.position.set(o.c.x + o.dist * Math.cos(el) * Math.sin(az), o.c.y + o.dist * Math.sin(el), o.c.z + o.dist * Math.cos(el) * Math.cos(az));
  camera.lookAt(o.c);
  const w = innerWidth, h = innerHeight;
  if (o.dy) camera.setViewOffset(w, h, 0, o.dy, w, h); else camera.clearViewOffset();
  camera.updateProjectionMatrix(); dirty = true;
};

// ---- loop --------------------------------------------------------------------------------
let lastT = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 1 / 60; lastT = t;
  if (saverOn && app.onFrame) app.onFrame(dt);
  stepFly(dt);
  if (!saverOn) controls.update();
  frameView();
  const moving = S.tick(dt);
  if (moving) { tracePath(); dirty = true; }
  if (!dirty && !saverOn) return;
  dirty = false;
  renderer.render(scene, camera);
  if (!saverOn) placeLabels();
}

try { boot(); app.ready = Promise.resolve(app); }
catch (e) { console.error(e); const b = $('boot'); b.hidden = false; b.classList.add('err'); b.textContent = 'This page needs WebGL. ' + (e && e.message ? e.message : ''); app.ready = Promise.reject(e); }
