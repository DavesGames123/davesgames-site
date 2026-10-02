// ============================================================================
//  STIRLING ENGINE  ·  main.js — the engine swap, the panels, the loop, saver
// ────────────────────────────────────────────────────────────────────────────
//  Shows one engine at a time: engine.js for the mechanism and the gas,
//  scene.js for its 3D parts (kit.js), gas.js for the working gas, and
//  analysis.js for the P-V loop and the numbers. stage.js holds the
//  renderer, the upright camera and the gentle orbit; cards.js the part
//  cards and labels. The crank turns at the set speed (no load model): the
//  flywheel's job is told by the torque readout, which changes sign.
//
//  ENGINE SWAP
//    The old engine fades (0.6 s), the new one fades in (0.9 s) and the
//    camera eases to fit it.
//
//  GREP MAP
//    function swapTo ............ build an engine and cross-fade to it
//    function recompute ......... the cycle for this phase and Th
//    const VIEWS / function setView  camera presets
//    function setOpen ........... the panel; on a phone one group per tab
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, pose, gas, explode, stage, cards
//    window.snSaver ............. screensaver hook: a slow tour
// ============================================================================
import * as THREE from 'three';
import { makeEngine, VARIANTS, PROC, D, TAU, TC } from './engine.js';
import { createBuild, ease } from './kit.js';
import { build } from './scene.js';
import { createGas } from './gas.js';
import { createStage } from './stage.js';
import { createCards, esc } from './cards.js';
import { createAnalysis } from './analysis.js';
import { partsFor, GROUP_COLOR } from './parts.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, leaving: [], th: 0.35, rpm: 45, lastRpm: 45, Th: 650, phase: 90 * D,
  explode: 0.6, explodeTarget: 0, section: true, gasOn: true, showLabels: !PHONE_Q.matches, swapping: false,
  cyc: null, proc: 'heat', anaOpen: !PHONE_Q.matches, ekRate: 2.6,
};
const ana = createAnalysis({ pv: $('pv'), ph: $('ph'), bar: $('gasBar'), barLab: $('barLab'), nums: $('nums'), eqs: $('eqs'), proc: $('proc') });
const cards = createCards({
  stage, $, isPhone: () => PHONE_Q.matches,
  get: () => S.cur,
  live: key => liveValue(key),
  gauge: () => S.th,
  labelsOn: () => S.showLabels && S.cur.alpha > 0.5 && S.explode > 0.12 ? Math.min(1, (S.explode - 0.12) * 4) * S.cur.alpha : 0,
  clearLeft: () => PHONE_Q.matches ? 0 : $('panel').getBoundingClientRect().right - $('view').getBoundingClientRect().left,
  clearRight: () => S.anaOpen && !PHONE_Q.matches ? $('anaPanel').getBoundingClientRect().left - $('view').getBoundingClientRect().left : $('view').clientWidth,
  onTap: () => hideHint(),
});
stage.onStart = () => hideHint();
let saverOn = false, saverTick = () => {};   // the screensaver (end of file)

// ── the gas, one cloud shared by every engine ──────────────────────────────
const gasPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
const gas = createGas(COARSE ? 420 : 560, gasPlane);
stage.root.add(gas.points);

// ── engine swap ─────────────────────────────────────────────────────────────
async function swapTo(id) {
  if (S.swapping || (S.cur && S.cur.E.id === id)) return;
  S.swapping = true;
  try {
    const E = makeEngine(id), B = createBuild(), sc = build(B, E);
    stage.root.add(B.root);
    const next = { E, B, sc, PARTS: partsFor(E), alpha: 0, t0: performance.now() };
    B.setAlpha(0.001);
    B.setSection(S.section);
    sc.setPhase(S.phase);
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now() });
    S.cur = next;
    cards.reset();
    recompute();
    fillPanel();
    const c = new THREE.Vector3(...sc.box.c);
    stage.setShadowExtent(sc.box.R, c);
    stage.controls.minDistance = sc.box.R * 0.5; stage.controls.maxDistance = sc.box.R * 7;
    document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    if (!saverOn) try { history.replaceState(null, '', '#' + id); } catch (e) {}
    setView(S.view || 'three', true);
  } finally { S.swapping = false; }
}
function recompute() {
  if (!S.cur) return;
  S.cyc = S.cur.E.cycle(S.phase, S.Th, TC);
  ana.setCycle(S.cur.E, S.cyc, S.phase);
}

// ── panel content ───────────────────────────────────────────────────────────
const ABOUT = [
  ['Two temperatures, one sealed charge', 'The air inside never leaves. Heat goes in at the hot cap and out at the cooler. The engine turns a temperature difference into work, like any heat engine, but its burning or heating happens outside.'],
  ['The displacer moves gas, not volume', 'When the displacer falls, the air is pushed up past it to the hot end, warms and its pressure rises. When it rises, the air goes down to the cold end and the pressure falls. The total volume hardly changes.'],
  ['The 90° phase', 'The power piston lags the displacer by about a quarter turn. So the pressure is high while the piston goes out (expansion, work out) and low while it comes back (compression, less work in). The difference is the area of the P-V loop.'],
  ['The regenerator', 'Gas going down leaves its heat in the screens; coming back up it takes that heat again. An ideal regenerator makes the cycle reach the Carnot efficiency, 1 − Tc/Th, as the Schmidt model here shows.'],
  ['What the model leaves out', 'The gas is isothermal in each space (the Schmidt model), with no friction, no leakage past the piston and no pressure drop in the screens. A real model engine gets a fraction of this work.'],
];
function fillPanel() {
  const E = S.cur.E, box = $('engInfo');
  box.classList.add('fading');
  setTimeout(() => {
    $('engTitle').textContent = E.g.name;
    $('engKind').textContent = E.g.kind;
    $('engLede').textContent = E.g.blurb;
    const seen = new Set(), P = S.cur.PARTS;
    const ids = Object.values(S.cur.B.parts).map(q => q.info).filter(id => P[id] && !seen.has(id) && seen.add(id));
    $('partList').innerHTML = ids.map(id => `<button type="button" data-part="${id}" style="--gc:${GROUP_COLOR[P[id].group] || '#e9c27a'}"><i></i>${esc(P[id].name)}</button>`).join('');
    $('partList').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { cards.pinById(b.dataset.part); if (PHONE_Q.matches) setOpen(false); }));
    $('about').innerHTML = ABOUT.map(([h, t]) => `<p><b>${esc(h)}.</b> ${esc(t)}</p>`).join('');
    box.classList.remove('fading');
  }, 200);
}
function buildPicker() {
  $('variants').innerHTML = VARIANTS.map(v => `<button class="mv" type="button" data-id="${v.id}"><b>${esc(v.name)}</b><span>${esc(v.kind)}</span></button>`).join('');
  $('variants').querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => swapTo(b.dataset.id)));
}

// ── views ───────────────────────────────────────────────────────────────────
const VIEWS = {
  three: { az: -20, el: 10, explode: 0, k: 1 },
  front: { az: 0, el: 3, explode: 0, k: 1 },
  exploded: { az: -30, el: 10, explode: 1, k: 1.5 },
  crank: { az: -52, el: 22, explode: 0, k: 0.62, at: E => [(E.g.bearings[0] + E.g.flywheel.x) / 2 - 10, 0, 0] },
  hot: { az: 8, el: 8, explode: 0, k: 0.5, at: E => [E.g.disp.x, E.g.disp.head - 50, 0] },
  regen: { az: -18, el: 6, explode: 0, k: 0.52, at: E => [(E.g.regen.x + E.g.disp.x) / 2, (E.g.regen.y0 + E.g.regen.y1) / 2, 0] },
};
function viewTarget(v, e) {
  const sc = S.cur.sc, E = S.cur.E;
  const t = v.at ? new THREE.Vector3(...v.at(E)) : new THREE.Vector3(...sc.box.c);
  if (!v.at) t.y += e * sc.explodeLift;
  return t;
}
const fitDist = () => S.cur.sc.box.R * 3.5;
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const v = VIEWS[name];
  stage.flyTo({ az: v.az, el: v.el, r: fitDist() * v.k, target: viewTarget(v, v.explode), t: soft ? 1.6 : 1.4 });
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
  r = Math.max(0, Math.min(600, r));
  if (r > 0) S.lastRpm = r;
  S.rpm = r;
  $('rpm').value = r; $('rpmV').textContent = r ? `${r}` : '0';
  document.querySelectorAll('#rates button').forEach(b => b.classList.toggle('on', +b.dataset.rpm === r));
  $('dockPlay').querySelector('i').textContent = r ? '❚❚' : '▶'; $('dockPlay').querySelector('span').textContent = r ? 'Pause' : 'Play';
  $('dockPlay').setAttribute('aria-label', r ? 'Pause' : 'Play');
  $('rateNote').textContent = r === 0 ? 'Paused. Drag the view, or change the phase and the heat: the loop updates.'
    : r <= 50 ? 'Slow. Follow one parcel of gas from the hot cap, down through the regenerator, to the cooler.'
    : r <= 200 ? 'A model engine on a warm plate runs about here.'
    : 'Fast. A small engine with a flame under it runs at 600 to 1500 rpm.';
}
document.querySelectorAll('#rates button').forEach(b => b.addEventListener('click', () => setRpm(+b.dataset.rpm)));
$('rpm').addEventListener('input', e => setRpm(+e.target.value));
$('dockPlay').addEventListener('click', () => setRpm(S.rpm ? 0 : S.lastRpm));
let recomputeT = 0;
const soonRecompute = () => { clearTimeout(recomputeT); recomputeT = setTimeout(recompute, 30); };
function setTh(t) { S.Th = t; $('th').value = t; $('thV').textContent = `${t} K`; soonRecompute(); }
$('th').addEventListener('input', e => setTh(+e.target.value));
function setPhase(deg) {
  S.phase = deg * D; $('phase').value = deg; $('phaseV').textContent = `${deg}°`;
  if (S.cur) S.cur.sc.setPhase(S.phase);
  for (const o of S.leaving) o.sc.setPhase(S.phase);
  $('phaseNote').textContent = deg < 60 ? 'Small phase: displacer and piston move nearly together, the gas is hot and cold at the wrong times, and the loop thins.'
    : deg > 120 ? 'Large phase: the displacer moves the gas back before the piston has used it. The loop thins again.'
    : 'The displacer crank pin leads the power pin. Near 90° the loop is widest.';
  soonRecompute();
}
$('phase').addEventListener('input', e => setPhase(+e.target.value));
$('phase90').addEventListener('click', () => setPhase(90));
function setShow(what, on) {
  if (what === 'section') { S.section = on; $('tSection').classList.toggle('on', on); for (const o of [S.cur, ...S.leaving]) if (o) o.B.setSection(on); }
  if (what === 'gas') { S.gasOn = on; $('tGas').classList.toggle('on', on); }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
}
$('tSection').addEventListener('click', () => setShow('section', !S.section));
$('tGas').addEventListener('click', () => setShow('gas', !S.gasOn));
$('tLabels').addEventListener('click', () => setShow('labels', !S.showLabels));
$('tOrbit').addEventListener('click', () => setShow('orbit', !stage.orbit));

// ── panels: left controls, right analysis; on a phone one sheet ─────────────
const panel = $('panel'), tabs = [...document.querySelectorAll('#dock .tab')], anaSec = $('anaSec'), anaPanel = $('anaPanel');
let grp = 'engine';
function placeAnalysis() {
  if (PHONE_Q.matches) { if (anaSec.parentNode !== panel) panel.appendChild(anaSec); }
  else if (anaSec.parentNode !== anaPanel) anaPanel.appendChild(anaSec);
  setAna(S.anaOpen);
  ana.redraw();
}
function setAna(open) {
  S.anaOpen = open;
  const desk = !PHONE_Q.matches;
  anaPanel.classList.toggle('open', open && desk);
  $('anaOpen').hidden = !desk || open;
  document.body.classList.toggle('ana-open', open && desk);
  if (open) setTimeout(() => ana.redraw(), 300);
}
$('anaClose').addEventListener('click', () => setAna(false));
$('anaOpen').addEventListener('click', () => setAna(true));
function setOpen(open, g = grp) {
  grp = g;
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  document.body.classList.toggle('sheet-open', open);
  panel.querySelectorAll('.grp').forEach(el => el.classList.toggle('on', el.dataset.grp === grp));
  for (const t of tabs) { const on = open && t.dataset.grp === grp; t.classList.toggle('on', on); t.setAttribute('aria-expanded', String(on)); }
  if (open && PHONE_Q.matches) panel.scrollTop = 0;
  if (open && grp === 'cycle') setTimeout(() => ana.redraw(), 60);
}
for (const t of tabs) t.addEventListener('click', () => setOpen(!(panel.classList.contains('open') && grp === t.dataset.grp), t.dataset.grp));
$('gear').addEventListener('click', () => setOpen(true));
$('panelClose').addEventListener('click', () => setOpen(false));
placeAnalysis();
setOpen(!PHONE_Q.matches);
PHONE_Q.addEventListener('change', e => { placeAnalysis(); setOpen(!e.matches); });
const grip = $('sheetGrip');
let gripY = null;
grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) {} });
grip.addEventListener('pointerup', e => {
  if (gripY === null) return;
  const dy = e.clientY - gripY; gripY = null;
  if (Math.abs(dy) < 8) panel.classList.toggle('full');
  else if (dy < -40) panel.classList.add('full');
  else if (dy > 40) { if (panel.classList.contains('full')) panel.classList.remove('full'); else setOpen(false); }
});
grip.addEventListener('pointercancel', () => { gripY = null; });
let hintGone = false;
function hideHint() { if (!hintGone) { hintGone = true; $('hint').classList.add('gone'); } }
if (COARSE) $('hint').textContent = 'tap a part to name it · drag to orbit · pinch to zoom';
setTimeout(hideHint, 9000);

// ── live values (part cards) ────────────────────────────────────────────────
let L = null;   // this frame: { k, gs, torque }
function liveValue(key) {
  if (!L || !S.cur) return [key, '—'];
  const E = S.cur.E, g = E.g, k = L.k, gs = L.gs, cyc = S.cyc, f = S.rpm / 60;
  const deg = a => `${((a / D) % 360 + 360) % 360 | 0}°`;
  const flow = () => { const dir = L.dmh; return Math.abs(dir) < 0.002 ? 'nearly still' : dir > 0 ? 'cold → hot' : 'hot → cold'; };
  switch (key) {
    case 'angle': return ['Crank angle', deg(k.th)];
    case 'phase': return ['Phase', `${Math.round(S.phase / D)}°`];
    case 'rpm': return ['Speed', `${S.rpm} rpm`];
    case 'torque': return ['Gas torque', `${L.torque >= 0 ? '+' : '−'}${Math.abs(L.torque * 1000).toFixed(0)} mN·m`];
    case 'dRodAngle': return ['Rod angle', `${(k.dk.rod / D).toFixed(1)}°`];
    case 'pRodAngle': return ['Rod angle', `${(k.pk.rod / D).toFixed(1)}°`];
    case 'dispY': return ['Position', `${(k.clevis - (g.disp.l - g.disp.r)).toFixed(1)} of ${2 * g.disp.r} mm`];
    case 'gasHot': return ['Gas in hot space', `${(gs.mh * 100).toFixed(0)}%`];
    case 'pistonY': return ['Position', `${(k.pin - (g.pow.l - g.pow.r)).toFixed(1)} of ${2 * g.pow.r} mm`];
    case 'force': { const F = (gs.P - 101325) * E.Ap * 1e-6; return ['Gas force', `${F >= 0 ? '+' : '−'}${Math.abs(F).toFixed(1)} N`]; }
    case 'pressure': return ['Pressure', `${(gs.P / 1000).toFixed(1)} kPa`];
    case 'Th': return ['Hot end Th', `${S.Th} K`];
    case 'Tc': return ['Cold end Tc', `${TC} K`];
    case 'Qh': return ['Heat in per turn', `${cyc.Qh.toFixed(3)} J`];
    case 'Qc': return ['Heat out per turn', `${(-cyc.Qc).toFixed(3)} J`];
    case 'heatPower': return ['Heat to gas', `${(cyc.Qh * f).toFixed(2)} W`];
    case 'Tr': return ['Screens', `${S.Th} → ${TC} K (mean ${gs.Tr.toFixed(0)} K)`];
    case 'gasRegen': return ['Gas in screens', `${(gs.mr * 100).toFixed(0)}%`];
    case 'flow': return ['Gas flow', flow()];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const P = PROC[S.proc], gs = L.gs;
  $('read').innerHTML = `<span class="hi" style="color:${P.col}">${P.name}</span> <span class="lo">· ${esc(S.cur.E.g.name)}</span><br>` +
    `<span class="lo">θ</span> ${((S.th / D) % 360 + 360) % 360 | 0}° <span class="lo">· P</span> ${(gs.P / 1000).toFixed(0)} kPa <span class="lo">· hot gas</span> ${(gs.mh * 100).toFixed(0)}% <span class="lo">·</span> ${S.rpm} rpm`;
}

// ── loop ────────────────────────────────────────────────────────────────────
const hotCol = new THREE.Color(), lastHeat = { Th: -1, cur: null };
let last = performance.now(), raf = 0, running = true;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur || !S.cyc) return;
  const cur = S.cur, E = cur.E;

  S.th = (S.th + dt * S.rpm / 60 * TAU) % TAU;
  const k = E.kin(S.th, S.phase), gs = E.gas(k, S.Th);
  const k2 = E.kin(S.th + 0.01, S.phase), gs2 = E.gas(k2, S.Th);
  L = { k, gs, dmh: gs2.mh - gs.mh, torque: E.torque(S.th, S.phase, S.Th) };
  S.proc = E.process(S.th, S.phase, S.Th);
  cur.sc.pose(k);
  S.explode += (S.explodeTarget - S.explode) * Math.min(1, dt * S.ekRate);
  cur.B.applyExplode(S.explode);

  // a calm heat colour: the hot cap and the heater glow faintly above ~450 K
  if (lastHeat.Th !== S.Th || lastHeat.cur !== cur) {
    lastHeat.Th = S.Th; lastHeat.cur = cur;
    const t = Math.max(0, Math.min(1, (S.Th - 450) / 450));
    cur.B.setHeat(cur.sc.heatIds, hotCol.setRGB(0.55 * t * t, 0.13 * t * t, 0.03 * t * t));
  }

  // the gas: only in the section, fading out as the parts spread
  const gOp = S.gasOn && S.section ? (1 - ease(S.explode / 0.14)) * cur.alpha : 0;
  gas.points.visible = gOp > 0.01;
  if (gas.points.visible) { gas.mat.opacity = 0.9 * gOp; gas.update(gs, k, cur.sc.gasMap, S.Th, TC); }

  // fade in the new engine, out the old
  const age = (now - cur.t0) / 1000;
  const a = REDUCED ? 1 : ease((age - 0.1) / 0.9);
  if (a !== cur.alpha) { cur.alpha = a; cur.B.setAlpha(Math.max(0.001, a)); }
  for (const old of S.leaving) {
    const t = (now - old.t0) / 600, kk = ease(t);
    old.B.setAlpha(Math.max(0.001, 1 - kk));
    old.B.applyExplode(Math.min(1, S.explode + 0.5 * kk));
    if (t >= 1) old.dead = true;
  }
  for (const old of S.leaving.filter(q => q.dead)) old.B.dispose();
  S.leaving = S.leaving.filter(q => !q.dead);

  // keep the target on the middle of the spread as the parts part
  if (!VIEWS[S.view] || !VIEWS[S.view].at) {
    const ty = S.explode * cur.sc.explodeLift, dy = ty - (S.lastTy ?? ty);
    S.lastTy = ty;
    stage.shift(new THREE.Vector3(0, dy, 0));
  } else S.lastTy = S.explode * cur.sc.explodeLift;
  stage.frame(dt);
  cards.frame(now, dt);
  ana.frame({ th: S.th, k, gs, proc: S.proc, Th: S.Th, Tc: TC, rpm: S.rpm, torque: L.torque });
  readout();
  if (saverOn) saverTick(dt);
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });

// debug and headless checks
window.__stirling = { S, stage, cards, swapTo, setView, setRpm, setExplode, setPhase, setTh, setShow, setOpen, setAna, pinById: id => cards.pinById(id), pick: (x, y) => cards.pick(x, y) };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
setRpm(45); setTh(650); setPhase(90); setExplode(0);
stage.place({ az: -60, el: 18, r: 1300, target: new THREE.Vector3(20, 80, 0) });
const start = (location.hash || '').slice(1);
swapTo(VARIANTS.some(v => v.id === start) ? start : 'gamma');
requestAnimationFrame(frame);

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
// The world centre of the box of an object: a key point for a part whose
// origin is not at its middle.
const centreOf = ob => new THREE.Box3().setFromObject(ob).getCenter(new THREE.Vector3());

// ── screensaver ─────────────────────────────────────────────────────────────
// Hook for the shell (lib/screensaver.js). enter() hides the GUI, draws the
// stage gradient in the scene, and tours: the running engine in section,
// the hot end and the regenerator, the exploded parts, the section face
// with the cycle, then a fade to the other layout. Each step holds
// seconds/4 (at least 9 s); calm (1 = slowest) slows the orbit, the crank
// and the explode. opts.label names the subject of each step. No URL hash
// writes while it plays. No exit(): the shell reloads the page.
window.snSaver = {
  enter(o = {}) {
    saverOn = true;
    const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
    let seed = (o.seed >>> 0) || 1;
    const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const label = typeof o.label === 'function' ? o.label : () => {};
    const st = document.createElement('style');
    st.textContent = '.topbar,#panel,#anaPanel,#anaOpen,#dock,#hint,#labels,#leader,#read,.tip,#nogl,#gear{display:none!important}#stage{top:0!important;bottom:0!important}#view{cursor:none;transition:opacity 0.9s ease}';
    document.head.appendChild(st);
    setOpen(false); setAna(false);
    setShow('labels', false); setShow('section', true); setShow('gas', true);
    const g = document.createElement('canvas'); g.width = 512; g.height = 320;
    const c2 = g.getContext('2d'), rg = c2.createRadialGradient(307, 128, 0, 307, 128, 420);
    rg.addColorStop(0, '#161826'); rg.addColorStop(0.7, '#08090f'); rg.addColorStop(1, '#08090f');
    c2.fillStyle = rg; c2.fillRect(0, 0, 512, 320);
    const bg = new THREE.CanvasTexture(g); bg.colorSpace = THREE.SRGBColorSpace;
    stage.scene.background = bg;
    stage.orbit = true; stage.orbitK = 1 - 0.6 * calm;
    S.ekRate = 1.6 - 1.0 * calm;
    setRpm(Math.round(48 - 30 * calm));
    const hold = Math.max(9, (o.seconds || 60) / 4) * 1000;
    let order = rnd() < 0.5 ? ['gamma', 'beta'] : ['beta', 'gamma'];
    const canvas = $('view');
    const fmt = (v, n = 2) => v.toFixed(n);
    // Plate fields. params and TeX share one colour map (RULES): T_c m1,
    // T_h and Q_h m2, V m3, T_r m4, P m5, θ and α m6. The plain eq lists
    // stay as the fallback. Anchors: plateAnchor() on the step's parts, with
    // the part centres as key points.
    const RULES = [['T_c', 'm1'], ['T_h', 'm2'], ['Q_h', 'm2'], ['V', 'm3'], ['V_h', 'm3'], ['V_c', 'm3'], ['V_r', 'm3'], ['T_r', 'm4'], ['P', 'm5'], ['P_0', 'm5'], ['\\theta', 'm6'], ['\\alpha', 'm6']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const pT = () => [P('T_h', 'hot end', `${S.Th} K`, 'm2'), P('T_c', 'cold end', `${TC} K`, 'm1')];
    const pAl = () => P('\\alpha', 'phase angle', `${Math.round(S.phase / D)}°`, 'm6');
    const pTh = () => P('\\theta', 'crank angle', `${Math.round(S.th / D)}°`, 'm6');
    const TCARNOT = String.raw`\eta_C = 1 - \frac{T_c}{T_h}`;
    const TP = String.raw`P = \frac{M}{V_h/T_h + V_r/T_r + V_c/T_c}`;
    const TW = String.raw`W = \oint P\,dV`;
    const TY = String.raw`y = r\cos\theta + \sqrt{l^2 - r^2\sin^2\theta}`;
    const part = id => S.cur.B.parts[id];
    const an = (ids, keys) => () => {
      // The whole engine leaves out the base board and the upright: they
      // carry the engine, and their corners would double the radius.
      const ps = ids ? ids.map(part).filter(Boolean) : Object.values(S.cur.B.parts).filter(q => q.id !== 'base' && q.id !== 'frame');
      return plateAnchor(ps.map(q => q.holder), keys.map(part).filter(Boolean).map(q => centreOf(q.holder)));
    };
    const MOVERS = ['displacer', 'piston', 'flywheel'];
    const STEPS = [
      { view: 'three', lab: () => ({ title: `${S.cur.E.g.name}`, sub: 'The Stirling cycle', params: [...pT(), pAl()], lines: ['Heat in at the hot cap, out at the cooler.', 'The displacer moves the gas; the piston takes the work.'], tex: [TCARNOT, TP], eq: ['η = 1 − Tc/Th = ' + fmt(1 - TC / S.Th)], anchor: an(null, MOVERS) }) },
      { view: 'hot', lab: () => ({ title: 'Hot end', sub: 'Heater band, hot cap, displacer', params: [pT()[0], P('Q_h', 'heat in per turn', `${fmt(S.cyc.Qh, 3)} J`, 'm2')], lines: ['The displacer falls: gas moves up to the hot space.', 'Warmer gas, higher pressure, same volume.'], tex: [String.raw`Q_h = \oint P\,dV_h`, TP], eq: ['Qh = ∮ P dVh'], anchor: an(['hotcap', 'heater', 'displacer'], ['displacer', 'hotcap']) }) },
      { view: 'regen', lab: () => ({ title: 'Regenerator', sub: 'Stacked wire screens', params: [...pT(), P('T_r', 'mean screen temperature', `${regenT().toFixed(0)} K`, 'm4')], lines: ['Gas going down leaves its heat in the screens.', 'Gas coming up takes it back.'], tex: [String.raw`T_r = \frac{T_h - T_c}{\ln(T_h / T_c)}`], eq: ['Tr = (Th − Tc) / ln(Th/Tc) = ' + regenT().toFixed(0) + ' K'], anchor: an(['regen', 'matrix'], ['regen']) }) },
      { view: 'exploded', lab: () => ({ title: 'Exploded view', sub: `${S.cur.E.g.name}, ${S.cur.E.g.kind}`, params: [pAl()], lines: ['Cylinder, cooler, heater and hot cap lift off their axis.', 'Displacer, piston and rods come forward; the flywheel slides off.'], tex: [TY], eq: ['y = r cos θ + √(l² − r² sin² θ)'], anchor: an(null, MOVERS) }) },
      { view: 'front', lab: () => ({ title: 'P-V loop', sub: PROC[S.proc].name + ' now', params: [P('W', 'work per turn', `${fmt(S.cyc.W, 3)} J`, ''), P('P', 'pressure range', `${fmt(S.cyc.Pmin / 1000, 0)}–${fmt(S.cyc.Pmax / 1000, 0)} kPa`, 'm5'), P('\\eta', 'efficiency', `${fmt(S.cyc.eta * 100, 1)} %`, '')], lines: [], tex: [TW, TP], eq: ['W = ∮ P dV', 'P = M / (Vh/Th + Vr/Tr + Vc/Tc)'], anchor: an(null, ['displacer', 'piston']) }) },
      { view: 'crank', lab: () => ({ title: 'Crank and flywheel', sub: `Phase angle ${Math.round(S.phase / D)}°`, params: [pAl(), pTh()], lines: ['The displacer pin leads the power pin.', 'The flywheel carries the crank through compression.'], tex: [String.raw`T = (P - P_0)\,A\,\frac{dy}{d\theta}`, TY], eq: ['T = (P − P₀) A dy/dθ'], anchor: an(['crank', 'flywheel', 'dRod', 'piston', 'dispRod'], ['crank', 'flywheel']) }) },
    ];
    STEPS.forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    const regenT = () => (S.Th - TC) / Math.log(S.Th / TC);
    let n = 0, ord = 0, stepT = 0, lastLab = '', labT = 0;
    const show = s => { setView(s.view, true); const l = s.lab(); lastLab = JSON.stringify(l); label(l); };
    const fadeSwap = async (id, then) => {
      canvas.style.opacity = '0';
      await new Promise(r => setTimeout(r, 950));
      // a new heat and phase for each pass, inside calm limits
      setTh(Math.round((560 + rnd() * 260) / 10) * 10);
      setPhase(Math.round(80 + rnd() * 20));
      await swapTo(id);
      setTimeout(() => { canvas.style.opacity = '1'; then(); }, 250);
    };
    const advance = () => {
      const s = STEPS[n % STEPS.length];
      if (n % STEPS.length === 0 && n > 0) fadeSwap(order[++ord % order.length], () => show(s));
      else show(s);
      n++;
    };
    saverTick = dt => {
      stepT += dt * 1000; labT += dt;
      if (stepT >= hold) { stepT = 0; advance(); }
      // refresh the plate when the subject's numbers change (at most every 2 s)
      if (labT > 2 && n > 0) {
        labT = 0;
        const l = STEPS[(n - 1) % STEPS.length].lab(), js = JSON.stringify(l);
        if (js !== lastLab) { lastLab = js; label(l); }
      }
    };
    (async () => { if (S.cur && S.cur.E.id !== order[0]) await swapTo(order[0]); advance(); })();
    return { canvas, warmupMs: 1500 };
  },
};
