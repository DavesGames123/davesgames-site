// ============================================================================
//  FOUR-STROKE ENGINE  ·  main.js — the swap, the panels, the loop, the saver
// ────────────────────────────────────────────────────────────────────────────
//  An inline four-cylinder four-stroke engine in 3D. engine.js holds the
//  kinematics and the gas (no DOM), scene.js the parts and their pose,
//  kit.js the builder, analysis.js the live analysis panel, cards.js the
//  part cards, stage.js the renderer and camera. One crank angle θ drives
//  every moving part, the gas colours and the analysis.
//
//  TRAIN SWAP
//    The DOHC 16-valve and SOHC 8-valve engines share the bottom end. A
//    swap fades the old build out (0.6 s) and the new one in (0.9 s).
//
//  GREP MAP
//    function swapTo ............ build a valve train and cross-fade to it
//    const VIEWS / function setView  camera presets
//    function liveRows .......... the live rows of the part cards
//    function gasColour ......... the colour of the charge by stroke
//    function setOpen ........... the panels; on a phone one sheet at a time
//    function frame ............. step, pose, explode, fades, stage, cards
//    window.snSaver ............. screensaver hook: a calm tour with plates
// ============================================================================
import * as THREE from 'three';
import * as E from './engine.js';
import { createBuild } from './kit.js';
import { build } from './scene.js';
import { createStage, ease } from './stage.js';
import { createCards, esc } from './cards.js';
import { createAnalysis, SCOL } from './analysis.js';
import { partsFor } from './parts.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const { D, GEO } = E;

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('ana')], coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, leaving: [], th: 0, rpm: 15, lastRpm: 15, explode: 0, explodeTarget: 0,
  section: true, castings: true, labels: !PHONE_Q.matches, gas: true, swapping: false, liftY: 0, lastE: 0,
};
const cards = createCards({
  stage, $, isPhone: () => PHONE_Q.matches,
  get: () => S.cur,
  live: id => liveRows(id), gauge: id => gaugeOf(id),
  labelsOn: () => S.showLabelsNow ? Math.min(1, (S.explode - 0.2) * 4) * S.cur.alpha : 0,
  onTap: () => hideHint(),
});
stage.onStart = () => hideHint();
stage.setShadowExtent(420);
let saverOn = false;
const analysis = createAnalysis({ $, getTrain: () => (S.cur ? S.cur.T : E.TRAINS.dohc) });

// ── train swap ──────────────────────────────────────────────────────────────
function swapTo(id) {
  if (S.cur && S.cur.T.id === id) return;
  const T = E.TRAINS[id];
  const B = createBuild();
  const sc = build(B, T);
  stage.root.add(B.root);
  B.setAlpha(0.001);
  const next = { T, B, sc, PARTS: partsFor(B), alpha: 0, t0: performance.now() };
  if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now() });
  S.cur = next;
  applyToggles();
  cards.reset();
  analysis.setTrain();
  $('trainTitle').textContent = T.name;
  $('trainLede').textContent = T.blurb;
  document.querySelectorAll('#trains button').forEach(b => b.classList.toggle('on', b.dataset.id === id));
  if (!saverOn) try { history.replaceState(null, '', '#' + id); } catch (e) {}
}

// ── views: the camera flies along a spherical arc round the target ─────────
const BASE_Y = 150;
const VIEWS = {
  three: { az: 34, el: 16, r: 1450, explode: 0 },
  section: { az: 0, el: 4, r: 1350, explode: 0 },
  end: { az: 90, el: 8, r: 1250, explode: 0, castings: true },
  valves: { az: 22, el: 20, r: 980, explode: 0, target: [40, 270, 0] },
  exploded: { az: 36, el: 14, r: 1500, explode: 1 },
};
const fitK = () => { const a = innerWidth / Math.max(1, innerHeight); return a < 0.8 ? 1.55 : a < 1.2 ? 1.2 : 1; };
const explodeLift = e => 170 * e;
function setView(name) {
  const v = VIEWS[name];
  const target = v.target ? new THREE.Vector3(...v.target) : new THREE.Vector3(0, BASE_Y + explodeLift(v.explode), v.explode * 60);
  S.liftY = v.target ? null : explodeLift(v.explode);
  stage.flyTo({ az: v.az, el: v.el, r: v.r * fitK() * (v.target ? 1 : 1 + 0.7 * v.explode), target });
  setExplode(v.explode);
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ── controls ────────────────────────────────────────────────────────────────
function setExplode(x) {
  S.explodeTarget = x;
  $('explode').value = x; $('explodeV').textContent = Math.round(x * 100) + '%';
}
$('explode').addEventListener('input', e => setExplode(+e.target.value));
$('assemble').addEventListener('click', () => setExplode(0));
$('burst').addEventListener('click', () => setExplode(1));
function setRpm(r) {
  if (r > 0) S.lastRpm = r;
  S.rpm = r;
  document.querySelectorAll('#rates button').forEach(b => b.classList.toggle('on', +b.dataset.rpm === r));
  $('dockPlay').querySelector('i').textContent = r ? '❚❚' : '▶'; $('dockPlay').querySelector('span').textContent = r ? 'Pause' : 'Play';
  $('dockPlay').setAttribute('aria-label', r ? 'Pause' : 'Play');
  $('rateNote').textContent = r === 0 ? 'Paused. Drag the crank angle to step through the cycle.'
    : r <= 15 ? `${r} rpm: one full cycle (two crank turns) every ${(120 / r).toFixed(0)} s. A real engine idles at about 800 rpm.`
    : r < 200 ? `${r} rpm, still slow motion. Watch the firing order: one power stroke every half turn.`
    : `${r} rpm. Near idle speed the parts move faster than the screen can draw them, so the cams and chain can look still (aliasing).`;
}
document.querySelectorAll('#rates button').forEach(b => b.addEventListener('click', () => setRpm(+b.dataset.rpm)));
$('dockPlay').addEventListener('click', () => setRpm(S.rpm ? 0 : S.lastRpm));
$('crank').addEventListener('input', e => { setRpm(0); S.th = +e.target.value; });
document.querySelectorAll('#trains button').forEach(b => b.addEventListener('click', () => swapTo(b.dataset.id)));
function applyToggles() {
  if (!S.cur) return;
  const B = S.cur.B;
  B.setSection(S.section);
  for (const id of S.cur.sc.toggles.castings) B.parts[id].root.visible = S.castings;
}
function setShow(what, on) {
  if (what === 'section') { S.section = on; $('tSection').classList.toggle('on', on); }
  if (what === 'castings') { S.castings = on; $('tCastings').classList.toggle('on', on); }
  if (what === 'labels') { S.labels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'gas') { S.gas = on; $('tGas').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
  applyToggles();
}
for (const [id, k] of [['tSection', 'section'], ['tCastings', 'castings'], ['tLabels', 'labels'], ['tGas', 'gas']]) $(id).addEventListener('click', () => setShow(k, !S[k]));
$('tOrbit').addEventListener('click', () => setShow('orbit', !stage.orbit));

// ── panels. Desktop: controls left, analysis right. Phone: one bottom sheet
//    at a time; a dock tab picks the group (the Analysis tab opens #ana). ──
const panel = $('panel'), ana = $('ana'), tabs = [...document.querySelectorAll('#dock .tab')];
let grp = 'engine';
function setOpen(open, g = grp) {
  grp = g;
  const phone = PHONE_Q.matches;
  if (phone) {
    const isAna = g === 'ana';
    panel.classList.toggle('open', open && !isAna);
    ana.classList.toggle('open', open && isAna);
    panel.querySelectorAll('.grp').forEach(el => el.classList.toggle('on', el.dataset.grp === grp));
    for (const t of tabs) { const on = open && t.dataset.grp === grp; t.classList.toggle('on', on); t.setAttribute('aria-expanded', String(on)); }
    if (open) (isAna ? ana : panel).scrollTop = 0;
  } else {
    panel.classList.toggle('open', open);
    panel.querySelectorAll('.grp').forEach(el => el.classList.add('on'));
  }
  if (!open) { panel.classList.remove('full'); ana.classList.remove('full'); }
  document.body.classList.toggle('panel-closed', !panel.classList.contains('open'));
}
function setAna(open) {
  ana.classList.toggle('open', open);
  document.body.classList.toggle('ana-closed', !open);
  $('anaBtn').classList.toggle('on', open);
}
for (const t of tabs) t.addEventListener('click', () => {
  const isOpen = (t.dataset.grp === 'ana' ? ana : panel).classList.contains('open') && grp === t.dataset.grp;
  setOpen(!isOpen, t.dataset.grp);
});
$('gear').addEventListener('click', () => setOpen(true));
$('panelClose').addEventListener('click', () => setOpen(false));
$('anaClose').addEventListener('click', () => PHONE_Q.matches ? setOpen(false) : setAna(false));
$('anaBtn').addEventListener('click', () => setAna(!ana.classList.contains('open')));
function layout() {
  if (PHONE_Q.matches) { setOpen(false); ana.classList.remove('open'); document.body.classList.remove('ana-closed'); }
  else { setOpen(true); setAna(innerWidth >= 1000); }
}
layout();
PHONE_Q.addEventListener('change', layout);
for (const [g, el] of [['sheetGrip', panel], ['anaGrip', ana]]) {
  const grip = $(g); let gy = null;
  grip.addEventListener('pointerdown', e => { gy = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
  grip.addEventListener('pointerup', e => {
    if (gy === null) return;
    const dy = e.clientY - gy; gy = null;
    if (Math.abs(dy) < 8) el.classList.toggle('full');
    else if (dy < -40) el.classList.add('full');
    else if (dy > 40) { if (el.classList.contains('full')) el.classList.remove('full'); else setOpen(false); }
  });
  grip.addEventListener('pointercancel', () => { gy = null; });
}
let hintGone = false;
function hideHint() { if (!hintGone) { hintGone = true; $('hint').classList.add('gone'); } }
if (COARSE) $('hint').textContent = 'tap a part to name it · drag to orbit · pinch to zoom';
setTimeout(hideHint, 9000);

// ── live rows for the part cards ────────────────────────────────────────────
const deg = a => `${E.mod(a, 360).toFixed(1)}°`;
function valveOf(id) { const key = id.replace(/^(spring|bucket|rocker)-/, ''); return S.cur.T.valves.find(v => v.id === key); }
function liveRows(id) {
  const P = S.cur.PARTS[id], th = S.th, k = P.cyl;
  if (!P) return [];
  switch (P.kind) {
    case 'piston': { const psi = E.psiOf(k, th), g = E.gasState(psi); return [['Stroke now', g.stroke], ['Cycle angle ψ', `${psi.toFixed(1)}°`], ['Height x', `${E.pistonX(E.crankOf(k, th)).toFixed(1)} mm`], ['Gas pressure', `${g.p.toFixed(1)} bar`]]; }
    case 'rod': return [['Lean', `${(E.rodLean(E.crankOf(k, th)) / D).toFixed(1)}°`], ['Crank pin', deg(E.crankOf(k, th))]];
    case 'crank': case 'damper': case 'crankSprocket': return [['Crank angle θ', deg(th)], ['Turn of the cycle', E.mod(th, 720) < 360 ? '1 of 2' : '2 of 2'], ['Speed', `${S.rpm} rpm`]];
    case 'flywheel': return [['Crank angle θ', deg(th)], ['Gas torque now', `${E.torque(th).toFixed(0)} N·m`], ['Mean torque', `${E.cycleStats.Tmean.toFixed(0)} N·m`]];
    case 'camIn': case 'camEx': case 'cam': case 'camSprocket': return [['Cam angle θ/2', deg(E.camAngle(th))], ['Speed', `${S.rpm / 2} rpm`]];
    case 'valveIn': case 'valveEx': case 'bucket': { const v = valveOf(id), L = E.valveLift(S.cur.T, v, th); return [['Lift now', `${L.toFixed(2)} mm`], ['State', L > 0.15 ? 'open' : 'shut']]; }
    case 'spring': { const v = valveOf(id), L = E.valveLift(S.cur.T, v, th); return [['Load now', `${(250 + 45 * L).toFixed(0)} N`], ['Compressed by', `${L.toFixed(2)} mm`]]; }
    case 'rocker': { const v = valveOf(id), a = E.rockerAngle(S.cur.T, E.lobeLiftOf(v, th)); return [['Rocker angle', `${(a / D).toFixed(2)}°`], ['Valve lift', `${E.valveLift(S.cur.T, v, th).toFixed(2)} mm`]]; }
    case 'chain': return [['Chain speed', `${(23 * S.rpm * Math.PI / 30).toFixed(0)} mm/s`], ['Links', String(S.cur.sc.chain.N)]];
    case 'plug': { const psi = E.psiOf(k, th); return [['Next spark in', `${E.mod(E.TIMING.spark - psi, 720).toFixed(0)}° of crank`], ['Stroke now', E.strokeOf(psi)]]; }
    default: return [];
  }
}
function gaugeOf(id) {
  const P = S.cur.PARTS[id], th = S.th, k = P.cyl;
  if (/^(crank|damper|crankSprocket|flywheel)$/.test(P.kind)) return { deg: E.mod(th, 360), frac: E.mod(th, 720) / 720 };
  if (/^(cam|camIn|camEx|camSprocket)$/.test(P.kind)) return { deg: E.mod(th / 2, 360), frac: E.mod(th, 720) / 720 };
  if (P.kind === 'piston' || P.kind === 'rod' || P.kind === 'plug') return { deg: E.crankOf(k, th), frac: E.psiOf(k, th) / 720 };
  if (/^(valveIn|valveEx|bucket|spring|rocker)$/.test(P.kind)) return { deg: 0, frac: E.valveLift(S.cur.T, valveOf(id), th) / 10 };
  return { deg: E.mod(th, 360), frac: 0 };
}

// ── the gas colour by stroke and pressure ───────────────────────────────────
const cA = new THREE.Color(), cB = new THREE.Color(), HOT = new THREE.Color(1, 0.93, 0.7), FLAME = new THREE.Color(1, 0.5, 0.12), DULL = new THREE.Color(0.55, 0.16, 0.08);
const COOL = new THREE.Color(SCOL.Intake), VIOLET = new THREE.Color(SCOL.Compression), SMOKE = new THREE.Color(SCOL.Exhaust);
function gasColour(psi, out) {
  const g = E.gasState(psi), pr = E.cycleStats.pMax;
  if (g.stroke === 'Intake') { out.copy(COOL); return 0.26; }
  if (g.stroke === 'Compression') {
    if (psi >= E.TIMING.spark) { out.copy(VIOLET).lerp(HOT, Math.min(1, g.xb * 3 + 0.3)); return 0.4; }
    out.copy(COOL).lerp(VIOLET, Math.min(1, (g.p - 1) / 15)); return 0.3;
  }
  if (g.stroke === 'Power') {
    const k = 1 - g.p / pr;
    if (k < 0.5) out.copy(HOT).lerp(FLAME, k * 2); else out.copy(FLAME).lerp(DULL, (k - 0.5) * 2);
    return 0.5 - 0.15 * k;
  }
  out.copy(DULL).lerp(SMOKE, Math.min(1, (psi - 180) / 60)); return 0.22;
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur) return;
  S.th += S.rpm * 6 * dt;
  if (S.th > 72000) S.th -= 72000;
  if (S.rpm) { const c = E.mod(S.th, 720); if (Math.abs(+$('crank').value - c) > 1) $('crank').value = c.toFixed(0); }
  const cur = S.cur;
  S.explode += (S.explodeTarget - S.explode) * Math.min(1, dt * 2.6);
  if (Math.abs(S.explode - S.explodeTarget) < 1e-4) S.explode = S.explodeTarget;
  cur.sc.pose(S.th);
  cur.B.applyExplode(S.explode);
  const age = (now - cur.t0) / 1000;
  const a = REDUCED ? 1 : ease((age - 0.1) / 0.9);
  if (a !== cur.alpha) { cur.alpha = a; cur.B.setAlpha(Math.max(0.001, a)); }
  // the charge and the sparks
  const gk = S.gas ? Math.max(0, 1 - S.explode * 5) * cur.alpha : 0;
  for (const k of E.CYLS) {
    const psi = E.psiOf(k, S.th), m = cur.sc.gas[k];
    const op = gasColour(psi, m.material.color);
    m.material.opacity = op * gk; m.visible = gk > 0.01;
    const ds = E.mod(psi - E.TIMING.spark + 20, 720) - 20;     // degrees after the spark
    const sp = ds >= 0 && ds < 22 ? 1 - ds / 22 : 0;
    const sm = cur.sc.sparks[k];
    sm.material.opacity = sp * cur.alpha * (S.gas ? 1 : 0.6); sm.visible = sp > 0.01; sm.scale.setScalar(0.6 + 1.6 * sp);
  }
  for (const old of S.leaving) {
    const t = (now - old.t0) / 600, k = ease(t);
    old.sc.pose(S.th); old.B.applyExplode(S.explode);
    old.B.setAlpha(Math.max(0.001, 1 - k));
    if (t >= 1) old.dead = true;
  }
  for (const old of S.leaving.filter(q => q.dead)) old.B.dispose();
  S.leaving = S.leaving.filter(q => !q.dead);
  // keep the spread in view as the parts move apart: lift the target and
  // pull the camera back in proportion (a camera flight sets its own end)
  if (S.liftY !== null) {
    const want = explodeLift(S.explode), dy = want - S.liftY;
    if (dy && !stage.fly && !stage.fit) {
      const tg = stage.controls.target, cam = stage.camera.position;
      tg.y += dy; cam.y += dy;
      const k = (1 + 0.7 * S.explode) / (1 + 0.7 * S.lastE);
      cam.sub(tg).multiplyScalar(k).add(tg);
      S.liftY = want;
    } else if (stage.fly) S.liftY = want;
  }
  S.lastE = S.explode;
  S.showLabelsNow = S.labels && S.explode > 0.2;
  stage.frame(dt);
  cards.frame(now, dt);
  analysis.frame(S.th, S.rpm);
  readout();
}
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const th = E.mod(S.th, 720);
  const firing = E.FIRING.find(k => E.psiOf(k, S.th) < 180);
  $('read').innerHTML = `<span class="hi">θ ${th.toFixed(0)}°</span> <span class="lo">· cam ${(th / 2).toFixed(0)}° · ${S.rpm} rpm</span><br><span class="lo">power stroke:</span> <span style="color:${SCOL.Power}">cylinder ${firing}</span> <span class="lo">· order 1-3-4-2</span>`;
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });

// debug and headless checks
window.__engine = { S, E, stage, cards, swapTo, setView, setRpm, setExplode, setShow, setOpen, setAna, pinById: id => cards.pinById(id) };

// ── boot ────────────────────────────────────────────────────────────────────
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.labels);
setRpm(15);
setExplode(0);
stage.place({ az: 34, el: 16, r: 1600 * fitK(), target: new THREE.Vector3(0, BASE_Y, 0) });
const start = (location.hash || '').slice(1);
swapTo(E.TRAINS[start] ? start : 'dohc');
setView('three');
requestAnimationFrame(frame);

// ── screensaver ─────────────────────────────────────────────────────────────
// ── saver plate anchor ──────────────────────────────────────────────────────
// The shell's label plate (lib/screensaver.js, "label plate") points at the
// subject of each tour step. plateAnchor(objs, keys) projects with the page
// camera (Vector3.project) to page CSS px of the canvas rect:
//   x, y  the projected centre of the world box of the visible meshes
//   r     the largest distance from (x, y) to a projected corner of the
//         local box of a mesh: the circle holds every mesh of the subject
//   pts   the projected key points (world Vector3) that are on screen
// It returns null when the subject is not on screen.
const PA = { box: new THREE.Box3(), mb: new THREE.Box3(), v: new THREE.Vector3(), c: new THREE.Vector3() };
function plateAnchor(objs, keys = []) {
  const rc = $('view').getBoundingClientRect(), cam = stage.camera;
  if (!rc.width || !rc.height) return null;
  const px = w => { PA.v.copy(w).project(cam); return PA.v.z > 1 ? null : { x: rc.left + (PA.v.x + 1) / 2 * rc.width, y: rc.top + (1 - PA.v.y) / 2 * rc.height }; };
  const ms = [];
  PA.box.makeEmpty();
  for (const ob of objs) if (ob) ob.traverseVisible(m => {
    if (!m.isMesh || (m.material && m.material.opacity === 0)) return;
    let b;
    if (m.isInstancedMesh) { if (!m.boundingBox) m.computeBoundingBox(); b = m.boundingBox; }
    else { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); b = m.geometry.boundingBox; }
    if (!b || b.isEmpty()) return;
    ms.push([m, b]); PA.mb.copy(b).applyMatrix4(m.matrixWorld); PA.box.union(PA.mb);
  });
  if (PA.box.isEmpty()) return null;
  const C = px(PA.box.getCenter(PA.c));
  if (!C) return null;
  let r = 0;
  for (const [m, b] of ms) for (let i = 0; i < 8; i++) {
    PA.c.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(m.matrixWorld);
    const q = px(PA.c); if (q) r = Math.max(r, Math.hypot(q.x - C.x, q.y - C.y));
  }
  if (C.x + r < rc.left || C.x - r > rc.right || C.y + r < rc.top || C.y - r > rc.bottom) return null;
  const pts = [];
  for (const k of keys) { const q = k && px(k); if (q && q.x >= rc.left && q.x <= rc.right && q.y >= rc.top && q.y <= rc.bottom) pts.push(q); }
  return { x: C.x, y: C.y, r, pts };
}

// Hook for the shell (lib/screensaver.js). enter() hides the GUI, paints the
// stage gradient into the scene, lowers the pixel-ratio cap, and starts a
// calm tour: each step sets a view, an explode and a speed, and names its
// subject on the shell's plate (opts.label). Each step holds seconds/4, at
// least 8 s. calm (1 = slowest) slows the orbit and the crank. The variant
// changes once per lap. No URL hash writes while it plays; no exit(): the
// shell reloads the page.
window.snSaver = {
  enter(o = {}) {
    saverOn = true;
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    const label = typeof o.label === 'function' ? o.label : () => {};
    let seed = (o.seed >>> 0) || 1;
    const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const st = document.createElement('style');
    st.textContent = '.topbar,#panel,#ana,#dock,#hint,#labels,#leader,#read,.tip,#nogl,#gear{display:none!important}#stage{top:0!important;bottom:0!important}#view{cursor:none}';
    document.head.appendChild(st);
    setOpen(false); setAna(false);
    setShow('labels', false);
    stage.setDpr(Math.min(1.5, devicePixelRatio || 1));
    const g = document.createElement('canvas'); g.width = 512; g.height = 320;
    const c2 = g.getContext('2d'), rg = c2.createRadialGradient(307, 128, 0, 307, 128, 420);
    rg.addColorStop(0, '#161826'); rg.addColorStop(0.7, '#08090f'); rg.addColorStop(1, '#08090f');
    c2.fillStyle = rg; c2.fillRect(0, 0, 512, 320);
    const bg = new THREE.CanvasTexture(g); bg.colorSpace = THREE.SRGBColorSpace;
    stage.scene.background = bg;
    stage.orbit = true; stage.orbitK = 1 - 0.6 * calm;
    const rpm = Math.round(20 - 12 * calm);          // 11.6 rpm at calm 0.7: one cycle in about 10 s
    const st0 = E.cycleStats;
    const eqX = 'x(θ) = r cos θ + √(l² − r² sin² θ)';
    // Plate fields: params and TeX share one colour map (RULES): θ crank
    // angle m1, r and S m2, l and B m3, ε and V_d m4, x and p m5, ω, φ and W
    // m6. The plain eq lists stay as the fallback.
    const RULES = [['\\theta', 'm1'], ['r', 'm2'], ['S', 'm2'], ['l', 'm3'], ['B', 'm3'], ['\\varepsilon', 'm4'], ['V_d', 'm4'], ['x', 'm5'], ['p', 'm5'], ['\\omega', 'm6'], ['\\varphi', 'm6'], ['W', 'm6'], ['\\beta', 'm1']];
    const TX = String.raw`x(\theta) = r\cos\theta + \sqrt{l^2 - r^2\sin^2\theta}`;
    const TPSI = String.raw`\psi_k = \theta - \varphi_k \pmod{720^\circ}`;
    const thNow = () => ((S.th % 720) + 720) % 720;
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const pTh = () => P('\\theta', 'crank angle', `${thNow().toFixed(0)}° of 720°`, 'm1');
    const pX = () => P('x_1', 'piston 1 above the crank', `${E.pistonX(E.crankOf(1, S.th)).toFixed(1)} mm`, 'm5');
    // Subjects: parts by kind, and key points in world space.
    const parts = re => Object.values(S.cur.B.parts).filter(q => re.test(q.kind || '')).map(q => q.root);
    const crowns = () => E.CYLS.map(k => S.cur.sc.pistons[k].holder.localToWorld(new THREE.Vector3(0, GEO.compH, 0)));
    const crankC = () => S.cur.B.parts.crank.holder.localToWorld(new THREE.Vector3(0, 0, 0));
    const ALL = /^(?!gas)/, CORE = /^(piston|rod|crank|flywheel|damper)$/;
    const whole = () => plateAnchor(parts(ALL), [...crowns(), crankC()]);
    const STEPS = [
      { view: 'three', label: T => ({ title: 'Four-stroke engine', sub: `Inline four, ${T.name}`,
        params: [pTh(), pX(), P('r', 'crank radius', `${GEO.r} mm`, 'm2'), P('l', 'rod length', `${GEO.l} mm`, 'm3')],
        lines: ['Intake, compression, power, exhaust: two crank turns per cycle.', 'Firing order 1-3-4-2: one power stroke every 180° of crank.'],
        tex: [TX, TPSI], eq: [eqX, `r = ${GEO.r} mm · l = ${GEO.l} mm`], anchor: whole }) },
      { view: 'exploded', label: T => ({ title: 'Exploded view', sub: T.name,
        params: [P('B', 'bore', `${GEO.bore} mm`, 'm3'), P('S', 'stroke, 2r', `${GEO.stroke} mm`, 'm2'), P('V_d', 'displacement', `${GEO.displacement.toFixed(0)} cc`, 'm4')],
        lines: ['Head, valve train and cam cover lift off; the crank and oil pan drop.', 'Pistons and rods come forward out of their bores.'],
        tex: [String.raw`V_d = 4\cdot\frac{\pi}{4}\,B^2 S`, TX], eq: [`displacement = 4 · (π/4) B² S = ${GEO.displacement.toFixed(0)} cc`], anchor: whole }) },
      { view: 'valves', label: T => {
        const an = () => plateAnchor(parts(/^(cam|camIn|camEx|valveIn|valveEx|spring|bucket|rocker|rockerShaft)$/), S.cur.sc.cams.filter(q => q.kind !== 'camSprocket').map(q => q.holder.localToWorld(new THREE.Vector3(0, 0, 0))));
        const pp = [pTh(), P('\\beta', 'cam angle, θ/2', `${(thNow() / 2).toFixed(0)}°`, 'm1')];
        return T.id === 'dohc'
          ? { title: 'Valve train', sub: 'Two camshafts, bucket tappets', params: pp, lines: ['Each cam turns once for every two crank turns.', 'The flat bucket rides on the lobe: lift = h(β) − R_b.'],
              tex: [String.raw`\beta = \frac{\theta}{2}`, String.raw`h(\beta) = \max_\alpha\, \rho(\alpha)\cos(\alpha - \beta)`], eq: ['cam angle = θ / 2', 'h(β) = max_α r(α) cos(α − β)'], anchor: an }
          : { title: 'Valve train', sub: 'One camshaft, rocker arms', params: pp, lines: ['The lobe lifts the pad end of the rocker; the far end opens the valve.', 'Both valves of a cylinder come from one shaft at half crank speed.'],
              tex: [String.raw`\beta = \frac{\theta}{2}`, String.raw`L = \frac{a_{\text{out}}\sin\delta}{\cos ${GEO.incline}^\circ}`], eq: ['cam angle = θ / 2', `lift = a_out sin δ / cos ${GEO.incline}°`], anchor: an };
      } },
      { view: 'section', label: () => ({ title: 'Otto cycle', sub: 'Section through the bores',
        params: [P('\\varepsilon', 'compression ratio', String(GEO.cr), 'm4'), P('p_{\\max}', `peak pressure, ${st0.pMaxAt.toFixed(0)}° after TDC`, `${st0.pMax.toFixed(0)} bar`, 'm5'), P('W', 'work per cylinder', `${st0.W.toFixed(0)} J`, 'm6'), P('\\eta', 'Otto efficiency', `${(st0.otto * 100).toFixed(0)} %`, '')],
        lines: ['Blue: fresh charge · violet: compression · orange: the burn · grey: exhaust.'],
        tex: [String.raw`\eta = 1 - \frac{1}{\varepsilon^{\gamma - 1}}`, String.raw`W = \oint p\,dV`], eq: [`η = 1 − 1 / ε^(γ−1) = ${(st0.otto * 100).toFixed(0)} %  (ε = ${GEO.cr})`, `W = ∮ p dV = ${st0.W.toFixed(0)} J per cylinder`],
        anchor: () => plateAnchor(parts(/^(piston|rod)$/), crowns()) }) },
      { view: 'end', label: () => ({ title: 'Timing drive', sub: 'Crank to camshaft',
        params: [P('N_k', 'crank sprocket teeth', '18', ''), P('N_c', 'cam sprocket teeth', '36', ''), P('\\omega_c', 'cam speed', `${(rpm / 2).toFixed(1)} rpm`, 'm6')],
        lines: ['The chain keeps the valves in step with the pistons.'],
        tex: [String.raw`\omega_{\text{cam}} = \omega_{\text{crank}}\,\frac{N_k}{N_c} = \frac{\omega_{\text{crank}}}{2}`], eq: ['ω_cam = ω_crank · 18 / 36 = ω_crank / 2'],
        anchor: () => plateAnchor(parts(/^(chain|crankSprocket|camSprocket|guides)$/), [S.cur.B.parts.crankSprocket.holder.localToWorld(new THREE.Vector3()), ...S.cur.sc.cams.filter(q => q.kind === 'camSprocket').map(q => q.holder.localToWorld(new THREE.Vector3()))]) }) },
      { view: 'three', label: () => ({ title: 'Firing order 1-3-4-2', sub: 'Cylinder phase',
        params: [pTh(), P('\\varphi_k', 'phase of cylinders 1, 3, 4, 2', '0°, 180°, 360°, 540°', 'm6')],
        lines: ['Throws 1 and 4 point up while 2 and 3 point down.', 'Each cylinder runs the same cycle, shifted.'],
        tex: [TPSI, TX], eq: ['ψ_k = θ − φ_k (mod 720°)', 'φ = 0°, 180°, 360°, 540° for 1, 3, 4, 2'],
        anchor: () => plateAnchor(parts(CORE), [...crowns(), crankC()]) }) },
    ];
    STEPS.forEach(s => { const f = s.label; s.label = T => Object.assign(f(T), { rules: RULES }); });
    const hold = Math.max(8, (o.seconds || 60) / 4) * 1000;
    let n = Math.floor(rnd() * STEPS.length), laps = 0;
    function step() {
      const s = STEPS[n % STEPS.length];
      if (n > 0 && n % STEPS.length === 0) { laps++; swapTo(laps % 2 ? 'sohc' : 'dohc'); }
      setShow('castings', true); setShow('section', true); setShow('gas', true);
      setRpm(rpm);
      setView(s.view);
      cur = s; label(s.label(S.cur.T));
      n++;
      setTimeout(step, hold);
    }
    // Refresh the live values (θ, x) on the plate every second. The shell
    // swaps the text with no fade when the title stays the same.
    let cur = null;
    setInterval(() => { if (cur && S.cur) label(cur.label(S.cur.T)); }, 1000);
    if (rnd() < 0.5) swapTo('sohc');
    step();
    return { canvas: $('view'), warmupMs: 1500 };
  },
};
