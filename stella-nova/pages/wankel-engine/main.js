// ============================================================================
//  WANKEL ENGINE  ·  main.js — the layout swap, the panels, the loop, saver
// ────────────────────────────────────────────────────────────────────────────
//  Shows one layout at a time (single or twin rotor): engine.js for the
//  geometry and the cycle, scene.js for the 3D parts (kit.js), analysis.js
//  for the plots and the numbers. stage.js holds the renderer, the camera
//  and the gentle orbit; cards.js the part cards and labels. The shaft
//  turns at the set speed (no load model). The gas torque readout shows
//  what the gas does to the shaft at each angle.
//
//  LAYOUT SWAP
//    The old engine fades (0.6 s), the new one fades in (0.9 s) and the
//    camera eases to fit it.
//
//  GREP MAP
//    function swapTo ............ build a layout and cross-fade to it
//    const VIEWS / function setView  camera presets
//    function setShow ........... front housing, gas, spark, labels, orbit
//    function setOpen ........... the panel; on a phone one group per tab
//    function liveValue ......... the live rows of the part cards
//    function frame ............. turn, pose, explode, fades, stage, cards
//    window.snSaver ............. screensaver hook: a slow tour
// ============================================================================
import * as THREE from 'three';
import * as E from './engine.js';
import { createBuild, ease } from './kit.js';
import { build } from './scene.js';
import { createStage } from './stage.js';
import { createCards, esc } from './cards.js';
import { createAnalysis } from './analysis.js';
import { partsFor, GROUP_COLOR } from './parts.js';

const { VARIANTS, TAU, D, GEO, STROKES } = E;
const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
stage.controls.minDistance = 90; stage.controls.maxDistance = 3200;
const S = {
  cur: null, leaving: [], t: 0.4, rpm: 40, lastRpm: 40, explode: 0.5, explodeTarget: 0,
  cover: false, gasOn: true, sparkOn: true, showLabels: !PHONE_Q.matches, swapping: false,
  anaOpen: !PHONE_Q.matches, ekRate: 2.2, view: 'three',
};
const ana = createAnalysis({ vol: $('vol'), pv: $('pv'), tq: $('tq'), chams: $('chams'), nums: $('nums'), eqs: $('eqs') });
const cards = createCards({
  stage, $, isPhone: () => PHONE_Q.matches,
  get: () => S.cur,
  live: key => liveValue(key),
  gauge: () => S.t,
  labelsOn: () => S.showLabels && S.cur.alpha > 0.5 && S.explode > 0.12 ? Math.min(1, (S.explode - 0.12) * 4) * S.cur.alpha : 0,
  clearLeft: () => PHONE_Q.matches ? 0 : $('panel').getBoundingClientRect().right - $('view').getBoundingClientRect().left,
  clearRight: () => S.anaOpen && !PHONE_Q.matches ? $('anaPanel').getBoundingClientRect().left - $('view').getBoundingClientRect().left : $('view').clientWidth,
  onTap: () => hideHint(),
});
stage.onStart = () => hideHint();
let saverOn = false, saverTick = () => {};   // the screensaver (end of file)

// ── layout swap ─────────────────────────────────────────────────────────────
async function swapTo(id) {
  if (S.swapping || (S.cur && S.cur.V.id === id)) return;
  S.swapping = true;
  try {
    const V = VARIANTS.find(v => v.id === id) || VARIANTS[0], B = createBuild(), sc = build(B, V);
    stage.root.add(B.root);
    const next = { V, B, sc, PARTS: partsFor(V), alpha: 0, t0: performance.now() };
    B.setAlpha(0.001);
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now() });
    S.cur = next;
    applyCover();
    cards.reset();
    ana.setVariant(V);
    fillPanel();
    stage.setShadowExtent(sc.box.R, new THREE.Vector3(...sc.box.c));
    document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.id === V.id));
    if (!saverOn) try { history.replaceState(null, '', '#' + V.id); } catch (e) {}
    setView(S.view || 'three', true);
  } finally { S.swapping = false; }
}

// ── panel content ───────────────────────────────────────────────────────────
const LEDE = {
  single: 'One rotor, three chambers, no valves and no reciprocating parts. The rotor turns at a third of the shaft speed, and every shaft turn gets one power stroke.',
  twin: 'Two rotors on one shaft, their lobes 180 degrees apart, as in the Mazda 13B. A power stroke every half turn, and the two rotors balance each other.',
};
const ABOUT = [
  ['A triangle in an oval', 'The housing bore is an epitrochoid, the path of a point on a circle that rolls round another. The rotor tips trace exactly that path, so each flank closes a chamber with the housing at all times.'],
  ['Three chambers, four strokes', 'As the rotor turns, each chamber grows and shrinks twice in one rotor turn. Past the ports it draws in and pushes out; at the top waist it is squeezed small, the plugs fire, and the gas drives the flank. All three chambers do this, one third of a turn apart.'],
  ['The eccentric shaft', 'The rotor rides on a lobe that sits e off the shaft axis. Gas pressure on a flank pushes the rotor sideways on that lobe, and that is the torque. The rotor centre goes round once for each shaft turn.'],
  ['The 3:2 gears do not drive', 'The ring gear in the rotor rolls on the stationary gear on the side housing. They carry almost no load. They hold the rotor at one third of the shaft speed, so its tips stay on the housing curve.'],
  ['Seals', 'Apex seals at the three tips, side seals along the flanks and corner seals where they meet. The apex seal must lean ±25° as it sweeps the curve, and it is the part that wears first.'],
  ['What the model leaves out', 'The pressure is the ideal air-standard Otto cycle: instant burning at the top waist, no heat loss, no leakage and no port timing. A real 13B makes about a third of this ideal torque.'],
];
function fillPanel() {
  const V = S.cur.V, box = $('engInfo');
  box.classList.add('fading');
  setTimeout(() => {
    $('engTitle').textContent = V.name;
    $('engKind').textContent = V.kind;
    $('engLede').textContent = LEDE[V.id];
    const seen = new Set(), P = S.cur.PARTS;
    const ids = Object.values(S.cur.B.parts).map(q => q.info).filter(id => P[id] && !seen.has(id) && seen.add(id));
    $('partList').innerHTML = ids.map(id => `<button type="button" data-part="${id}" style="--gc:${GROUP_COLOR[P[id].group] || '#e9c27a'}"><i></i>${esc(P[id].name)}</button>`).join('');
    $('partList').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (S.cur.sc.cover.some(c => S.cur.B.parts[c].info === b.dataset.part)) setShow('cover', true); cards.pinById(b.dataset.part); if (PHONE_Q.matches) setOpen(false); }));
    $('about').innerHTML = ABOUT.map(([h, t]) => `<p><b>${esc(h)}.</b> ${esc(t)}</p>`).join('');
    box.classList.remove('fading');
  }, 200);
}
function buildPicker() {
  $('variants').innerHTML = VARIANTS.map(v => `<button class="mv" type="button" data-id="${v.id}"><b>${esc(v.name)}</b><span>${esc(v.kind)}</span></button>`).join('');
  $('variants').querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => swapTo(b.dataset.id)));
}

// ── views ───────────────────────────────────────────────────────────────────
// at(sc): a close target (mm). k: distance as a share of the fit distance.
const VIEWS = {
  face: { az: 0, el: 0, explode: 0, k: 1.22, cover: false },
  three: { az: 34, el: 20, explode: 0, k: 1.1, cover: false },
  exploded: { az: 80, el: 14, explode: 1, k: 2.25, cover: true },
  gears: { az: 14, el: 8, explode: 0, k: 0.55, cover: false, at: sc => [0, 0, sc.units[0].zc + 40] },
  plugs: { az: -10, el: 22, explode: 0, k: 0.42, cover: false, at: sc => [0, GEO.R - 6, sc.units[0].zc + 20] },
  ports: { az: 14, el: -24, explode: 0, k: 0.5, cover: false, at: sc => [0, -GEO.R - 10, sc.units[0].zc + 10] },
};
function viewTarget(v, e) {
  const sc = S.cur.sc;
  return v.at ? new THREE.Vector3(...v.at(sc)) : new THREE.Vector3(0, 0, sc.explodeCentre(e));
}
const fitDist = () => S.cur.sc.box.R * 3.6;
// a portrait screen gets the exploded spread from above, so it runs down
// the screen instead of off its sides
const PORTRAIT = { exploded: { az: 12, el: 72, k: 2.1 } };
function clearWidth() {
  const w = $('view').clientWidth;
  if (PHONE_Q.matches) return w;
  return w - (panel.classList.contains('open') ? panel.offsetWidth : 0) - (S.anaOpen ? anaPanel.offsetWidth : 0);
}
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const tall = innerWidth < innerHeight * 0.8;
  const v = { ...VIEWS[name], ...(tall && PORTRAIT[name] || {}) };
  // the exploded engine is about three times as long as it is high: back
  // off when the clear part of the view (between the panels) is narrow
  let r = fitDist() * v.k;
  if (v.explode > 0.5) r *= S.cur.sc.spreadK * (tall ? 1 : Math.max(1, 1.1 / Math.max(0.3, clearWidth() / $('view').clientHeight)));
  stage.flyTo({ az: v.az, el: v.el, r, target: viewTarget(v, v.explode), t: soft ? 1.6 : 1.4 });
  setExplode(v.explode);
  if (v.cover !== undefined) setShow('cover', v.cover);
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
$('burst').addEventListener('click', () => { setExplode(1); setShow('cover', true); });
function setRpm(r) {
  r = Math.max(0, Math.min(9000, Math.round(r)));
  if (r > 0) S.lastRpm = r;
  S.rpm = r;
  $('rpm').value = r; $('rpmV').textContent = String(r);
  document.querySelectorAll('#rates button').forEach(b => b.classList.toggle('on', +b.dataset.rpm === r));
  $('dockPlay').querySelector('i').textContent = r ? '❚❚' : '▶'; $('dockPlay').querySelector('span').textContent = r ? 'Pause' : 'Play';
  $('dockPlay').setAttribute('aria-label', r ? 'Pause' : 'Play');
  $('rateNote').textContent = r === 0 ? 'Paused. Drag the slider below to turn the shaft by hand.'
    : r <= 60 ? 'Slow. Follow one chamber: it fills past the intake, is squeezed at the plugs, fires and empties past the exhaust, in one rotor turn.'
    : r <= 1000 ? 'Idle is about 750 rpm. The rotor turns at a third of that.'
    : 'Fast. The screen shows about 60 frames a second, so the rotor seems to stand or step (aliasing). The plots stay exact.';
}
document.querySelectorAll('#rates button').forEach(b => b.addEventListener('click', () => setRpm(+b.dataset.rpm)));
$('rpm').addEventListener('input', e => setRpm(+e.target.value));
$('dockPlay').addEventListener('click', () => setRpm(S.rpm ? 0 : S.lastRpm));
$('step').addEventListener('input', e => { setRpm(0); S.t = +e.target.value * D; });
function applyCover() {
  if (!S.cur) return;
  const on = S.cover || S.explode > 0.03;
  for (const id of S.cur.sc.cover) S.cur.B.parts[id].holder.visible = on;
  for (const m of S.cur.sc.coverMeshes) m.visible = on;
}
function setShow(what, on) {
  if (what === 'cover') { S.cover = on; $('tCover').classList.toggle('on', on); applyCover(); }
  if (what === 'gas') { S.gasOn = on; $('tGas').classList.toggle('on', on); }
  if (what === 'spark') { S.sparkOn = on; $('tSpark').classList.toggle('on', on); }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
}
$('tCover').addEventListener('click', () => setShow('cover', !S.cover));
$('tGas').addEventListener('click', () => setShow('gas', !S.gasOn));
$('tSpark').addEventListener('click', () => setShow('spark', !S.sparkOn));
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

// ── live values (part cards and analysis) ───────────────────────────────────
let L = null;   // this frame: { units, torque, apexSpeed }
function liveValue(key) {
  if (!L || !S.cur) return [key, '—'];
  const u0 = L.units[0], deg = a => `${((a / D) % 360 + 360) % 360 | 0}°`;
  const byStroke = s => u0.ch.find(c => c.stroke === s);
  switch (key) {
    case 'shaft': return ['Shaft angle', `${deg(S.t)} · ${S.rpm} rpm`];
    case 'rotorAngle': return ['Rotor angle', deg(u0.k.a)];
    case 'rotorRpm': return ['Rotor speed', `${+(S.rpm / 3).toFixed(1)} rpm`];
    case 'torque': return ['Gas torque', `${L.torque >= 0 ? '+' : '−'}${Math.abs(L.torque).toFixed(0)} N·m`];
    case 'lean': return ['Lean now', `${(u0.k.lean[0] / D).toFixed(1)}°`];
    case 'apexSpeed': return ['Sliding speed', `${L.apexSpeed.toFixed(1)} m/s`];
    case 'chamberV': return ['Chamber 1', `${(u0.ch[0].V / 1000).toFixed(0)} cm³ · ${STROKES[u0.ch[0].stroke].name.toLowerCase()}`];
    case 'spark': { const c = byStroke(1); return ['Next firing', c ? `chamber ${c.k + 1}, in ${(((Math.PI - GEO.spark - c.w) * 3) / D).toFixed(0)}° shaft` : '—']; }
    case 'intakeV': { const c = byStroke(0); return ['Filling', c ? `chamber ${c.k + 1}, ${(c.V / 1000).toFixed(0)} cm³` : '—']; }
    case 'exhaustV': { const c = byStroke(3); return ['Emptying', c ? `chamber ${c.k + 1}, ${(c.V / 1000).toFixed(0)} cm³` : '—']; }
  }
  return [key, '—'];
}
// sliding speed of apex 1 on the housing (m/s)
function apexSpeed(t) {
  const h = 1e-3, p0 = E.kin(t - h).apex[0], p1 = E.kin(t + h).apex[0];
  return Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / (2 * h) * (S.rpm / 60 * TAU) / 1000;
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const c = L.units[0].ch, fire = c.find(q => q.stroke === 2 && q.w - Math.PI < 0.35);
  $('read').innerHTML = `<span class="hi">${esc(S.cur.V.name)}</span> <span class="lo">· θ</span> ${((S.t / D) % 1080 + 1080) % 1080 | 0}° <span class="lo">· rotor</span> ${((L.units[0].k.a / D) % 360 + 360) % 360 | 0}°<br>` +
    c.map(q => `<span style="color:${STROKES[q.stroke].col}">${q.k + 1} ${STROKES[q.stroke].name.toLowerCase()}</span>`).join(' <span class="lo">·</span> ') +
    (fire ? ' <span class="hi">· fire</span>' : '') + ` <span class="lo">·</span> ${S.rpm} rpm`;
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur) return;
  const cur = S.cur, sc = cur.sc;

  S.t = (S.t + dt * S.rpm / 60 * TAU) % (3 * TAU);
  if (S.rpm) $('step').value = Math.round(S.t / D);
  S.explode += (S.explodeTarget - S.explode) * Math.min(1, dt * S.ekRate);
  if (Math.abs(S.explodeTarget - S.explode) < 1e-4) S.explode = S.explodeTarget;
  applyCover();
  cur.B.applyExplode(S.explode);
  sc.setGas(S.gasOn ? (1 - ease(S.explode / 0.1)) * cur.alpha : 0);
  sc.setSpark(S.sparkOn && S.explode < 0.1);
  sc.pose(S.t);
  L = { units: sc.units, torque: E.torque(S.t, cur.V.rotors.map(r => r.off)), apexSpeed: apexSpeed(S.t) };

  // fade in the new engine, out the old
  const age = (now - cur.t0) / 1000;
  const a = REDUCED ? 1 : ease((age - 0.1) / 0.9);
  if (a !== cur.alpha) { cur.alpha = a; cur.B.setAlpha(Math.max(0.001, a)); }
  for (const old of S.leaving) {
    const t = (now - old.t0) / 600, kk = ease(t);
    old.B.setAlpha(Math.max(0.001, 1 - kk));
    old.sc.setGas(0);
    if (t >= 1) old.dead = true;
  }
  for (const old of S.leaving.filter(q => q.dead)) old.B.dispose();
  S.leaving = S.leaving.filter(q => !q.dead);

  // keep the target on the middle of the spread as the parts part
  if (!VIEWS[S.view] || !VIEWS[S.view].at) {
    const tz = sc.explodeCentre(S.explode), dz = tz - (S.lastTz ?? tz);
    S.lastTz = tz;
    stage.shift(new THREE.Vector3(0, 0, dz));
  } else S.lastTz = sc.explodeCentre(S.explode);
  stage.frame(dt);
  cards.frame(now, dt);
  ana.frame({ t: S.t, rpm: S.rpm, units: sc.units, torque: L.torque, apexSpeed: L.apexSpeed });
  readout();
  if (saverOn) saverTick(dt);
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });

// debug and headless checks
window.__wankel = { S, stage, cards, swapTo, setView, setRpm, setExplode, setShow, setOpen, setAna, pinById: id => cards.pinById(id), pick: (x, y) => cards.pick(x, y) };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
setRpm(40); setExplode(0); setShow('cover', false);
stage.place({ az: 50, el: 24, r: 1500, target: new THREE.Vector3(0, 0, 0) });
const start = (location.hash || '').slice(1);
swapTo(VARIANTS.some(v => v.id === start) ? start : 'single');
requestAnimationFrame(frame);

// ── screensaver ─────────────────────────────────────────────────────────────
// Hook for the shell (lib/screensaver.js). enter() hides the GUI, draws the
// stage gradient in the scene, and tours: the face with the chambers, the
// phasing gears, the plugs, the exploded parts, the engine put together
// again, and the ports; then a fade to the other layout. Each step holds
// seconds/4 (at least 9 s); calm (1 = slowest) slows the orbit, the shaft
// and the explode. opts.label names the subject of each step with its
// equation. No URL hash writes while it plays. No exit(): the shell
// reloads the page.
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
    setShow('labels', false); setShow('gas', true); setShow('spark', true);
    const g = document.createElement('canvas'); g.width = 512; g.height = 320;
    const c2 = g.getContext('2d'), rg = c2.createRadialGradient(307, 128, 0, 307, 128, 420);
    rg.addColorStop(0, '#161826'); rg.addColorStop(0.7, '#08090f'); rg.addColorStop(1, '#08090f');
    c2.fillStyle = rg; c2.fillRect(0, 0, 512, 320);
    const bg = new THREE.CanvasTexture(g); bg.colorSpace = THREE.SRGBColorSpace;
    stage.scene.background = bg;
    stage.orbit = true; stage.orbitK = 1 - 0.6 * calm;
    S.ekRate = 1.4 - 0.8 * calm;
    setRpm(Math.round(32 - 18 * calm));
    const hold = Math.max(9, (o.seconds || 60) / 4) * 1000;
    const order = rnd() < 0.5 ? ['single', 'twin'] : ['twin', 'single'];
    const canvas = $('view');
    const vt = E.volumes();
    const chLine = () => L ? L.units[0].ch.map(q => `${q.k + 1} ${STROKES[q.stroke].name.toLowerCase()} ${(q.V / 1000).toFixed(0)} cm³`).join(' · ') : '';
    const STEPS = [
      { view: 'face', lab: () => ({ title: `Wankel engine · ${S.cur.V.name.toLowerCase()}`, sub: 'Epitrochoid housing, three-cornered rotor', lines: ['The rotor tips trace the housing curve', 'Three chambers, each a full four-stroke cycle per rotor turn', chLine()], eq: ['x = e cos 3α + R cos α', 'y = e sin 3α + R sin α', `R = ${GEO.R} mm · e = ${GEO.e} mm`] }) },
      { view: 'gears', lab: () => ({ title: 'Phasing gears', sub: `Ring ${GEO.gear.ring} teeth · stationary ${GEO.gear.fixed} teeth`, lines: ['The ring gear in the rotor rolls round the fixed gear', 'It holds the rotor at one third of the shaft speed', `Shaft ${S.rpm} rpm · rotor ${+(S.rpm / 3).toFixed(1)} rpm`], eq: ['r(ring) − r(fixed) = e', 'ω(rotor) = ω(shaft) · (1 − 20/30) = ω(shaft) / 3'] }) },
      { view: 'plugs', lab: () => ({ title: 'Spark plugs', sub: 'Leading and trailing, at the top waist', lines: ['The chamber is smallest as its flank passes the waist', 'The pocket in the flank keeps the flame path open', `Compression ratio ${vt.CR.toFixed(1)} : 1`], eq: ['ε = Vₘₐₓ / Vₘᵢₙ', `= ${(vt.Vmax / 1000).toFixed(0)} / ${(vt.Vmin / 1000).toFixed(0)} cm³`] }) },
      { view: 'exploded', lab: () => ({ title: 'Exploded view', sub: `${S.cur.V.name} · ${S.cur.V.kind}`, lines: ['Bolts, side housing and stationary gear come off the front', 'The rotor slides off its lobe; the seals leave their slots', 'The eccentric shaft and flywheel come out last'], eq: ['c = e (cos θ, sin θ)', 'α = θ / 3'] }) },
      { view: 'three', lab: () => ({ title: 'Three chambers, four strokes', sub: 'Intake · compression · power · exhaust', lines: [chLine(), `Swept ${(E.SWEPT / 1000).toFixed(0)} cm³ per chamber`, 'One power stroke per rotor per shaft turn'], eq: ['V(θ) = Vₘᵢₙ + ½ Vₛ (1 − cos ⅔θ)', 'Vₛ = 3√3 e R W'] }) },
      { view: 'ports', lab: () => ({ title: 'Ports, not valves', sub: 'Exhaust before the bottom waist, intake after it', lines: ['The apexes open and close the ports as they pass', 'The apex seal leans as it sweeps the curve', `Lean now ${(L ? L.units[0].k.lean[0] / D : 0).toFixed(1)}° of ±${(E.LEAN_MAX / D).toFixed(1)}°`], eq: ['φₘₐₓ = asin(3e / R)', 'T = Σ (p − p₀) dV/dθ'] }) },
    ];
    let n = 0, ord = 0, stepT = 0, lastLab = '', labT = 0;
    const show = s => { setView(s.view, true); const l = s.lab(); lastLab = JSON.stringify(l); label(l); };
    const fadeSwap = async (id, then) => {
      canvas.style.opacity = '0';
      await new Promise(r => setTimeout(r, 950));
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
      // refresh the plate when its live numbers change (at most every 2 s)
      if (labT > 2 && n > 0) {
        labT = 0;
        const l = STEPS[(n - 1) % STEPS.length].lab(), js = JSON.stringify(l);
        if (js !== lastLab) { lastLab = js; label(l); }
      }
    };
    (async () => { while (S.swapping) await new Promise(r => setTimeout(r, 100)); if (S.cur && S.cur.V.id !== order[0]) await swapTo(order[0]); advance(); })();
    return { canvas, warmupMs: 1500 };
  },
};
