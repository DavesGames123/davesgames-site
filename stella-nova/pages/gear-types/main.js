// ============================================================================
//  GEAR TYPES  ·  main.js — pair swap, run, panels, contact plot, saver
// ----------------------------------------------------------------------------
//  Shows one gear pair at a time: mech.js for the geometry, contact and
//  forces, scene.js for its 3D parts (kit.js, gears.js), stage.js for the
//  renderer and the camera, cards.js for the part cards and labels. A copy
//  of the harmonic-drive main.js with the gear text, plot and saver steps.
//
//  MOTION
//    One angle drives everything: S.th, the input angle (rad). Each frame
//    adds rpm / 60 * 2 pi * dt. sc.pose(S.th) moves every part and returns
//    mech.js pose() plus inContact. The rack pinion swings: its turn is
//    swing * sin(th / slow), so the rpm sets the pace of the swing.
//
//  GREP MAP
//    function swapTo ............ build a pair and cross-fade to it
//    function explodedBox ....... the frame of the exploded view
//    const INFO / ABOUT ......... the panel text of each pair
//    const VIEWS / function setView  camera presets
//    function drawPlot .......... tooth pairs in contact over two pitches
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, pose, explode, stage, cards, plot
//    window.snSaver ............. screensaver hook: a tour of each pair
// ============================================================================
import * as THREE from 'three';
import { UNITS, unit, pairsIn, TAU, D2R, T_IN } from './mech.js';
import { createBuild, ease } from './kit.js';
import { build } from './scene.js';
import { createStage } from './stage.js';
import { createCards, esc } from './cards.js';
import { partsFor, GROUP_COLOR } from './parts.js';
import { createTour } from '../../lib/mech-tour.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEG = 180 / Math.PI;

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], band: () => saverBand, coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, leaving: [], th: 0, rpm: 5, lastRpm: 5, Q: null, view: 'three',
  explode: 0, explodeTarget: 0, showLabels: !PHONE_Q.matches, showLoa: true, showForces: true, swapping: false,
  anaOpen: !PHONE_Q.matches, ekRate: 2.6,
};
let saverOn = false, saverTick = null, plotCache = null, saverBand = null;
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

// the drawing parts: line of action, forces and pitch cones
function applyShow(cur = S.cur) {
  if (!cur) return;
  for (const q of Object.values(cur.B.parts)) {
    if (q.info === 'loa') q.holder.visible = S.showLoa;
    if (q.info === 'forces' || q.info === 'cones' || q.info === 'vel') q.holder.visible = S.showForces;
  }
}

// The frame of the exploded view. The explode offsets push the parts up and
// toward the camera, so the assembled box framed the exploded pair off centre
// and cut it at the edge. Measured before B.root has a parent, so the world
// frame is the pair frame. R is the box R that frames it like 'three'.
function explodedBox(B) {
  B.applyExplode(1); B.root.updateMatrixWorld(true);
  const s = new THREE.Box3().setFromObject(B.root).getBoundingSphere(new THREE.Sphere());
  B.applyExplode(0); B.root.updateMatrixWorld(true);
  return { c: s.center.toArray(), R: s.radius / 1.12 };
}

// ── pair swap ───────────────────────────────────────────────────────────────
async function swapTo(id) {
  if (S.swapping || (S.cur && S.cur.id === id)) return;
  S.swapping = true;
  try {
    const B = createBuild(), sc = build(B, id);
    sc.xbox = explodedBox(B);
    const next = { id, B, sc, D: sc.D, PARTS: partsFor(id), alpha: 0, t0: performance.now() };
    B.setAlpha(0.001);
    B.setSection(false);
    S.Q = sc.pose(S.th);
    stage.root.add(B.root);
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now() });
    S.cur = next;
    applyShow(next);
    cards.reset();
    fillPanel();
    const c = new THREE.Vector3(...sc.box.c);
    stage.setShadowExtent(sc.box.R, c);
    stage.controls.minDistance = 120; stage.controls.maxDistance = sc.box.R * 8;
    document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    if (!saverOn) try { history.replaceState(null, '', '#' + id); } catch (e) { /* file: */ }
    if (!saverOn) setView(S.view || 'three', true);
    plotCache = null;
  } finally { S.swapping = false; }
}

// ── panel content ───────────────────────────────────────────────────────────
const INFO = {
  spur: { title: 'Spur gears', kind: 'Parallel shafts · 18 : 30 · ε = 1.59', lede: 'Straight involute teeth on parallel shafts. The teeth always touch on one straight line, the line of action, so the ratio stays exact while the contact slides in and out. With a contact ratio of 1.59, two pairs share the load for 59 % of the time and one pair carries it alone for the rest.' },
  helical: { title: 'Helical gears', kind: 'Parallel shafts · 20° helix · ε = 2.28', lede: 'The same 18 : 30 pair with the teeth on a 20° helix. Each tooth comes into mesh gradually across the face, so the number of teeth in contact hardly changes and the pair runs quietly. The price is an axial thrust Fa = Ft tan β along both shafts.' },
  bevel: { title: 'Bevel gears', kind: 'Shafts at 90° · 16 : 32 · pitch cones', lede: 'Teeth cut on two cones that share one apex and roll on each other. The cone angles set the ratio: tan γ₁ = N₁/N₂ for shafts at 90°. The tooth push has a part along each shaft that pushes each gear away from the apex.' },
  worm: { title: 'Worm drive', kind: 'Crossed shafts · 30 : 1 · self-locking', lede: 'A one-start screw turns a 30-tooth wheel by one tooth per turn: 30 : 1 in one stage. The thread slides along the wheel teeth, so friction matters. Here the lead angle (5.7°) is less than the friction angle (6.1°): the wheel cannot drive the worm backward.' },
  rack: { title: 'Rack and pinion', kind: 'Turn to slide · v = ω r', lede: 'A rack is a gear with an infinite radius: its involute flanks are straight. One radian of the pinion moves the rack by one pitch radius, so v = ω r. The pinion swings to and fro here, like a steering rack.' },
};
const ABOUT = {
  spur: [
    ['Involute', 'An involute flank is the path of a string unwound from the base circle. Two such flanks touch only on the common tangent of the base circles, so the push always acts along one fixed line and the speed ratio cannot change.'],
    ['Contact ratio', 'ε = length of action / base pitch. The length of action is where the line meets the two tip circles (gold). Above 1, a new pair starts before the last one leaves; real gears keep it above about 1.2.'],
    ['Why spur gears are loud', 'The count of loaded pairs jumps between 1 and 2 at fixed points of each tooth: the mesh stiffness changes in a step, once per tooth. The plot shows those steps.'],
  ],
  helical: [
    ['Two contact ratios', 'ε_α (1.47) is the transverse ratio, as for a spur gear. The helix adds the face ratio ε_β = b sin β / (π m_n) = 0.82, so the total is 2.28: two or three pairs always share the load.'],
    ['Axial thrust', 'The tooth push is normal to the twisted flank. Its part along the shaft is Fa = Ft tan β. The two gears are pushed in opposite directions, so each shaft needs a thrust bearing; double-helical gears cancel it.'],
    ['Transverse module', 'The teeth are cut with the normal module m_n = 4, so in the end view the module is m_n / cos β = 4.26 and the pressure angle is tan⁻¹(tan α_n / cos β) = 21.2°.'],
  ],
  bevel: [
    ['Pitch cones', 'Two cones with a shared apex roll without slip when their angles add to the shaft angle: γ₁ + γ₂ = 90°, tan γ₁ = 16/32. Every tooth line runs to the apex.'],
    ['Virtual gears', 'In the back cone each gear acts like a spur gear of N / cos γ teeth (Tredgold). The page tests the teeth on those virtual gears: 17.9 and 71.6 teeth, contact ratio 1.67.'],
    ['Thrust away from the apex', 'Fa₁ = Ft tan α sin γ₁ on the pinion and Fa₂ = Ft tan α sin γ₂ on the gear. Both push the gears out of mesh, so bevel shafts need thrust bearings and careful shims.'],
  ],
  worm: [
    ['Lead angle', 'One start, axial pitch π m = 12.6 mm on a pitch radius of 20 mm: tan λ = 12.6 / (2π · 20), λ = 5.71°. Each worm turn moves the wheel one tooth.'],
    ['Self-locking', 'With the wheel driving, the thread is a ramp of angle λ, and friction holds it when λ is less than the friction angle φ\' = tan⁻¹(μ / cos α_n) = 6.07° at μ = 0.10. The back efficiency is then below zero: no torque on the wheel can turn the worm.'],
    ['The price', 'The same friction costs power going forward: η = (cos α_n − μ tan λ) / (cos α_n + μ cot λ) = 48 %. Lifts and hoists accept that for the free brake; fast drives use several starts.'],
  ],
  rack: [
    ['A gear of infinite radius', 'As the radius grows, an involute flank becomes straight. A rack tooth is a trapezoid with sides at the pressure angle, the simplest tooth to cut.'],
    ['v = ω r', 'The rack moves one pitch radius per radian of the pinion. At the ends of the swing ω = 0 and the rack stops; mid-swing it is fastest.'],
    ['Line of action', 'Still a straight line through the pitch point at the pressure angle. When the pinion turns back, the other flanks touch and the line tilts the other way.'],
  ],
};
function fillPanel() {
  const id = S.cur.id, box = $('engInfo'), I = INFO[id];
  box.classList.add('fading');
  setTimeout(() => {
    $('engTitle').textContent = I.title;
    $('engKind').textContent = I.kind;
    $('engLede').textContent = I.lede;
    const seen = new Set(), P = S.cur.PARTS;
    const ids = Object.values(S.cur.B.parts).map(q => q.info).filter(k => P[k] && !seen.has(k) && seen.add(k));
    $('partList').innerHTML = ids.map(k => `<button type="button" data-part="${k}" style="--gc:${GROUP_COLOR[P[k].group] || '#e9c27a'}"><i></i>${esc(P[k].name)}</button>`).join('');
    $('partList').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { cards.pinById(b.dataset.part); if (PHONE_Q.matches) setOpen(false); }));
    $('about').innerHTML = ABOUT[id].map(([h, t]) => `<p><b>${esc(h)}.</b> ${esc(t)}</p>`).join('');
    fillEqs();
    box.classList.remove('fading');
  }, 200);
}
function buildPicker() {
  $('variants').innerHTML = UNITS.map(v => `<button class="mv" type="button" data-id="${v.id}"><b>${esc(v.name)}</b><span>${esc(v.kind)}</span></button>`).join('');
  $('variants').querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => swapTo(b.dataset.id)));
}

// ── views ───────────────────────────────────────────────────────────────────
// at: 'box' (the model centre), 'xbox' (the centre of the exploded pair,
// see function explodedBox) or a key of sc.keys
const VIEWS = {
  three: { az: 28, el: 24, explode: 0, k: 1, at: 'box' },
  close: { az: 14, el: 14, explode: 0, k: 0.42, at: 'mesh' },
  top: { az: 0, el: 76, explode: 0, k: 0.9, at: 'box' },
  low: { az: -32, el: 6, explode: 0, k: 0.95, at: 'box' },
  exploded: { az: 34, el: 22, explode: 1, k: 1, at: 'xbox' },
};
// per pair: a better side for the close-up
const CLOSE = { bevel: { az: 48, el: -2 }, worm: { az: 30, el: 26 }, rack: { az: 10, el: 8 } };
function fitDist(k, R = S.cur.sc.box.R) {
  const c = $('view'), a = c.clientWidth / Math.max(1, c.clientHeight);
  const wide = a < 1.1 ? 1 + 0.9 * (1.1 - a) * Math.min(1, k) : 1;
  return R * 3.3 * k * wide;
}
function viewPose(name) {
  const v = { ...VIEWS[name], ...(name === 'close' ? CLOSE[S.cur.id] || {} : {}) };
  const sc = S.cur.sc, at = v.at === 'box' ? sc.box.c : v.at === 'xbox' ? sc.xbox.c : sc.keys[v.at];
  return { v, at, R: v.at === 'xbox' ? sc.xbox.R : sc.box.R };
}
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const { v, at, R } = viewPose(name);
  stage.flyTo({ az: v.az, el: v.el, r: fitDist(v.k, R), target: new THREE.Vector3(...at), t: soft ? 1.8 : 1.4 });
  setExplode(v.explode);
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ── controls ────────────────────────────────────────────────────────────────
function setExplode(x) { S.explodeTarget = x; $('explode').value = x; $('explodeV').textContent = Math.round(x * 100) + '%'; }
$('explode').addEventListener('input', e => setExplode(+e.target.value));
$('assemble').addEventListener('click', () => setExplode(0));
$('burst').addEventListener('click', () => setExplode(1));
function setRpm(r) {
  r = Math.max(0, Math.min(120, r));
  if (r > 0) S.lastRpm = r;
  S.rpm = r;
  $('rpm').value = r; $('rpmV').textContent = `${r}`;
  document.querySelectorAll('#rates button').forEach(b => b.classList.toggle('on', +b.dataset.rpm === r));
  $('dockPlay').querySelector('i').textContent = r ? '❚❚' : '▶'; $('dockPlay').querySelector('span').textContent = r ? 'Pause' : 'Play';
  $('dockPlay').setAttribute('aria-label', r ? 'Pause' : 'Play');
}
document.querySelectorAll('#rates button').forEach(b => b.addEventListener('click', () => setRpm(+b.dataset.rpm)));
$('rpm').addEventListener('input', e => setRpm(+e.target.value));
$('dockPlay').addEventListener('click', () => setRpm(S.rpm ? 0 : S.lastRpm));
$('turn').addEventListener('input', e => {
  setRpm(0);
  const want = +e.target.value / DEG, base = Math.floor(S.th / TAU) * TAU;
  S.th = base + want;
});
function setShow(what, on) {
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
  if (what === 'loa') { S.showLoa = on; $('tLoa').classList.toggle('on', on); applyShow(); }
  if (what === 'forces') { S.showForces = on; $('tForces').classList.toggle('on', on); applyShow(); }
}
$('tLabels').addEventListener('click', () => setShow('labels', !S.showLabels));
$('tOrbit').addEventListener('click', () => setShow('orbit', !stage.orbit));
$('tLoa').addEventListener('click', () => setShow('loa', !S.showLoa));
$('tForces').addEventListener('click', () => setShow('forces', !S.showForces));

// ── panels: left controls, right analysis; on a phone one sheet ─────────────
const panel = $('panel'), tabs = [...document.querySelectorAll('#dock .tab')], anaSec = $('anaSec'), anaPanel = $('anaPanel');
let grp = 'unit';
function placeAnalysis() {
  if (PHONE_Q.matches) { if (anaSec.parentNode !== panel) panel.appendChild(anaSec); }
  else if (anaSec.parentNode !== anaPanel) anaPanel.appendChild(anaSec);
  setAna(S.anaOpen);
  plotCache = null;
}
function setAna(open) {
  S.anaOpen = open;
  const desk = !PHONE_Q.matches;
  anaPanel.classList.toggle('open', open && desk);
  $('anaOpen').hidden = !desk || open;
  document.body.classList.toggle('ana-open', open && desk);
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
  plotCache = null;
}
for (const t of tabs) t.addEventListener('click', () => setOpen(!(panel.classList.contains('open') && grp === t.dataset.grp), t.dataset.grp));
$('gear').addEventListener('click', () => setOpen(true));
$('panelClose').addEventListener('click', () => setOpen(false));
placeAnalysis();
setOpen(!PHONE_Q.matches);
PHONE_Q.addEventListener('change', e => { placeAnalysis(); setOpen(!e.matches); });
const grip = $('sheetGrip');
let gripY = null;
grip.addEventListener('pointerdown', e => { gripY = e.clientY; try { grip.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } });
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

// ── analysis ────────────────────────────────────────────────────────────────
// Tooth pairs in contact against the driver's pitch-line travel, over two
// circular pitches. Spur, bevel, worm and rack step between whole numbers;
// helical is the mean over the face. The dashed line is eps_alpha (the
// mean). The marker is the travel now.
function drawPlot() {
  const c = $('plot'), r = c.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; plotCache = null; }
  const D = S.cur.D, dir = S.Q.dir, g = c.getContext('2d'), pad = 10 * dpr, top = 3.2;
  if (!plotCache || plotCache.id !== S.cur.id || plotCache.dir !== dir) {
    const n = 360, ys = [];
    for (let i = 0; i <= n; i++) ys.push(pairsIn(D, 2 * D.p * i / n, dir));
    plotCache = { id: S.cur.id, dir, ys };
  }
  const X = t => pad + 18 * dpr + (w - 2 * pad - 18 * dpr) * t, Y = v => h - pad - 12 * dpr - (h - 2 * pad - 14 * dpr) * v / top;
  g.clearRect(0, 0, w, h);
  g.font = `${10 * dpr}px ui-monospace,Menlo,monospace`; g.fillStyle = 'rgba(141,144,166,0.9)'; g.lineWidth = 1;
  for (let k = 0; k <= 3; k++) { g.strokeStyle = 'rgba(217,179,106,0.12)'; g.beginPath(); g.moveTo(X(0), Y(k)); g.lineTo(X(1), Y(k)); g.stroke(); g.fillText(String(k), pad, Y(k) + 3 * dpr); }
  // eps_alpha
  g.strokeStyle = '#e9a0a8'; g.setLineDash([5 * dpr, 4 * dpr]); g.lineWidth = 1.2 * dpr;
  g.beginPath(); g.moveTo(X(0), Y(D.epsA)); g.lineTo(X(1), Y(D.epsA)); g.stroke(); g.setLineDash([]);
  g.strokeStyle = '#8fb0ff'; g.lineWidth = 1.8 * dpr; g.beginPath();
  plotCache.ys.forEach((v, i) => { const x = X(i / (plotCache.ys.length - 1)), y = Y(v); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.stroke();
  const t = ((dir * S.Q.arc) % (2 * D.p) + 2 * D.p) % (2 * D.p) / (2 * D.p);
  g.strokeStyle = 'rgba(255,224,170,0.85)'; g.lineWidth = 1.2 * dpr;
  g.beginPath(); g.moveTo(X(t), pad); g.lineTo(X(t), h - pad - 12 * dpr); g.stroke();
  const now = plotCache.ys[Math.round(t * (plotCache.ys.length - 1))];
  g.fillStyle = '#ffe0aa'; g.beginPath(); g.arc(X(t), Y(now), 3.5 * dpr, 0, TAU); g.fill();
  g.fillStyle = 'rgba(141,144,166,0.9)';
  g.fillText('0', X(0), h - pad); g.fillText('1 pitch', X(0.5) - 18 * dpr, h - pad); g.fillText('2', X(1) - 8 * dpr, h - pad);
  $('legend').innerHTML = `<span class="lw"><i></i>pairs in contact</span><span class="le"><i></i>ε_α = ${D.epsA.toFixed(2)}</span><span class="lm"><i></i>now</span>`;
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
const dg = v => `${(v / D2R).toFixed(2)}°`;
function speeds() {
  const D = S.cur.D, Q = S.Q, win = S.rpm / 60 * TAU;
  if (S.cur.id === 'rack') { const w = Q.w * win; return { w, v: w * D.r1 }; }
  return { w: win, out: -S.rpm / D.ratio };
}
let lastNums = '';
function fillNums() {
  const id = S.cur.id, D = S.cur.D, Q = S.Q, sp = speeds(), N = v => `${v.toFixed(0)} N`;
  let html = `<tr><th>${INFO[id].title}</th><th></th></tr>`;
  if (id === 'rack') html += row('Pace', `${S.rpm} rpm`) + row('Pinion ω', `${sp.w.toFixed(2)} rad/s`) + row('Rack v = ω r', `${sp.v.toFixed(1)} mm/s`) + row('Pitch radius r', `${D.r1.toFixed(1)} mm`) + row('Rack place', `${Q.x.toFixed(1)} mm`);
  else html += row('Input', `${S.rpm} rpm`) + row('Output', `${sp.out.toFixed(2)} rpm`) + row('Ratio', `${D.ratio.toFixed(3).replace(/\.?0+$/, '')} : 1`);
  html += row('Contact ratio ε_α', D.epsA.toFixed(3)) + (D.epsB ? row('Face ratio ε_β', D.epsB.toFixed(3)) + row('Total ε', D.eps.toFixed(3)) : '') + row('Pairs in contact', String(Q.inContact));
  if (id === 'spur') html += row(`Ft at ${T_IN} N·m`, N(D.Ft)) + row('Fr = Ft tan α', N(D.Fr)) + row('Fa', '0 N');
  if (id === 'helical') html += row('Helix β', dg(D.beta)) + row('Ft', N(D.Ft)) + row('Fr = Ft tan α_t', N(D.Fr)) + row('Fa = Ft tan β', N(D.Fa));
  if (id === 'bevel') html += row('Pitch cones γ₁ / γ₂', `${dg(D.g1)} / ${dg(D.g2)}`) + row('Cone distance A', `${D.A.toFixed(1)} mm`) + row('Fa pinion', N(D.Fa1)) + row('Fa gear', N(D.Fa2));
  if (id === 'worm') html += row('Lead angle λ', dg(D.lambda)) + row('Friction angle φ\'', dg(D.phiF)) + row('η worm drives', `${(D.eff.fwd * 100).toFixed(1)} %`) + row('η wheel drives', `${(D.eff.back * 100).toFixed(1)} %`) + row('Self-locking', D.selfLock ? 'yes' : 'no');
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
  // only the current pair's text is built: sp.v exists only for the rack
  const nowTxt = {
    spur: () => [`${Q.inContact} pair${Q.inContact > 1 ? 's' : ''} in contact`, 'The red dots move along the line of action; a pair enters at one gold end and leaves at the other.'],
    helical: () => [`${pairsIn(D, Q.arc).toFixed(2)} pairs over the face`, 'Each tooth enters across the face, so the count barely changes. Dots: the front section only.'],
    bevel: () => [`${Q.inContact} pair${Q.inContact > 1 ? 's' : ''} in contact`, 'Counted on the virtual spur gears at the heel.'],
    worm: () => [D.selfLock ? 'Self-locking' : 'Back-drivable', `λ = ${dg(D.lambda)} < φ' = ${dg(D.phiF)}: the wheel cannot turn the worm.`],
    rack: () => [`v = ${sp.v.toFixed(1)} mm/s`, `ω = ${sp.w.toFixed(2)} rad/s on r = ${D.r1} mm. Zero at each end of the swing.`],
  }[id]();
  $('now').innerHTML = `<b>${esc(nowTxt[0])}</b><span>${esc(nowTxt[1])}</span>`;
}
const EQS = {
  spur: [['Contact ratio', 'ε_α = (√(r_a1² − r_b1²) + √(r_a2² − r_b2²) − a sin α) / (π m cos α)', '= 1.59: one or two pairs'], ['Base circle', 'r_b = r cos α', 'the involute unwinds from it'], ['Forces', 'Ft = T / r₁, Fr = Ft tan α', 'no axial force']],
  helical: [['Thrust', 'Fa = Ft tan β', '= 0.364 Ft, opposite on the two shafts'], ['Face ratio', 'ε_β = b sin β / (π m_n)', 'adds to ε_α'], ['End-view angle', 'tan α_t = tan α_n / cos β', 'α_t = 21.2°']],
  bevel: [['Pitch cones', 'tan γ₁ = sin Σ / (N₂/N₁ + cos Σ)', 'γ₁ + γ₂ = Σ = 90°'], ['Virtual teeth', 'N_v = N / cos γ', 'Tredgold, on the back cone'], ['Thrust', 'Fa = Ft tan α sin γ', 'away from the apex']],
  worm: [['Lead angle', 'tan λ = z₁ p / (2π r₁)', 'λ = 5.71°'], ['Self-locking', 'tan λ ≤ μ / cos α_n', 'λ ≤ φ\''], ['Efficiency', 'η = (cos α_n − μ tan λ) / (cos α_n + μ cot λ)', '48 % forward']],
  rack: [['Rack speed', 'v = ω r', 'one pitch radius per radian'], ['Contact ratio', 'ε = (m / sin α + √(r_a² − r_b²) − r sin α) / (π m cos α)', '= 1.77'], ['Rack flank', 'a straight line at α', 'the involute of an infinite circle']],
};
function fillEqs() {
  $('eqs').innerHTML = EQS[S.cur.id].map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  if (!S.Q || !S.cur) return [key, '—'];
  const sp = speeds(), D = S.cur.D;
  switch (key) {
    case 'in': return S.cur.id === 'rack' ? ['Pinion ω', `${sp.w.toFixed(2)} rad/s`] : ['Input', `${S.rpm} rpm`];
    case 'out': return ['Output', `${sp.out.toFixed(2)} rpm`];
    case 'pairs': return ['Pairs in contact', String(S.Q.inContact)];
    case 'lock': return ['Back efficiency', `${(D.eff.back * 100).toFixed(1)} % (locked)`];
    case 'v': return ['Rack speed', `${sp.v.toFixed(1)} mm/s`];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const sp = speeds(), D = S.cur.D;
  const lo = S.cur.id === 'rack' ? `ω ${sp.w.toFixed(2)} rad/s · v = ω r = ${sp.v.toFixed(1)} mm/s` : `in ${S.rpm} rpm · out ${sp.out.toFixed(2)} rpm · ε ${D.eps.toFixed(2)}`;
  $('read').innerHTML = `<span class="hi">${esc(INFO[S.cur.id].title)}</span><br><span class="lo">${lo}</span>`;
  $('turnV').textContent = `${((((S.th % TAU) + TAU) % TAU) * DEG).toFixed(0)}°`;
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true, numT = 0;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur) return;
  const cur = S.cur;
  S.th += S.rpm / 60 * TAU * dt;
  S.Q = cur.sc.pose(S.th);
  for (const o of S.leaving) o.sc.pose(S.th);
  S.explode += (S.explodeTarget - S.explode) * Math.min(1, dt * S.ekRate);
  cur.B.applyExplode(S.explode);
  const age = (now - cur.t0) / 1000, al = REDUCED ? 1 : ease((age - 0.1) / 0.9);
  if (al !== cur.alpha) { cur.alpha = al; cur.B.setAlpha(Math.max(0.001, al)); }
  for (const old of S.leaving) {
    const t = (now - old.t0) / 600, kk = ease(t);
    old.B.setAlpha(Math.max(0.001, 1 - kk));
    old.B.applyExplode(Math.min(1, S.explode + 0.4 * kk));
    if (t >= 1) old.dead = true;
  }
  for (const old of S.leaving.filter(q => q.dead)) old.B.dispose();
  S.leaving = S.leaving.filter(q => !q.dead);
  stage.frame(dt);
  cards.frame(now, dt);
  if (!saverOn) {
    readout();
    if ((numT += dt) > 0.15) { numT = 0; fillNums(); }
    drawPlot();
  } else if (saverTick) saverTick(dt);
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });
window.__gears = { S, stage, cards, swapTo, setView, setRpm, setExplode, setShow, setOpen, setAna };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
setRpm(5); setExplode(0);
stage.place({ az: -40, el: 24, r: 1800, target: new THREE.Vector3(0, 0, 0) });
const start = (location.hash || '').slice(1);
swapTo(UNITS.some(v => v.id === start) ? start : 'spur');
requestAnimationFrame(frame);

// ── saver plate anchor ──────────────────────────────────────────────────────
// As on the differential page: the projected centre and radius of the
// visible meshes of the subject, in page CSS px, plus key points.
const PA = { box: new THREE.Box3(), mb: new THREE.Box3(), v: new THREE.Vector3(), c: new THREE.Vector3() };
function plateAnchor(objs, keys = []) {
  const cv = $('view'), rc = cv.getBoundingClientRect(), cam = stage.camera;
  if (!rc.width || !rc.height || cv.style.opacity === '0') return null;
  const px = w => { PA.v.copy(w).project(cam); return PA.v.z > 1 ? null : { x: rc.left + (PA.v.x + 1) / 2 * rc.width, y: rc.top + (1 - PA.v.y) / 2 * rc.height }; };
  const ms = [];
  PA.box.makeEmpty();
  for (const ob of objs) if (ob) ob.traverseVisible(m => {
    if (!m.isMesh || (m.material && m.material.opacity === 0)) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox; if (!b || b.isEmpty()) return;
    ms.push([m, b]); PA.mb.copy(b).applyMatrix4(m.matrixWorld); PA.box.union(PA.mb);
  });
  if (PA.box.isEmpty()) return null;
  const C = px(PA.box.getCenter(PA.c));
  if (!C) return null;
  let r = 0;
  for (const [m, b] of ms) for (let i = 0; i < 8; i++) {
    PA.c.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(m.matrixWorld);
    const q = px(PA.c); if (q) r = Math.max(r, Math.hypot(Math.max(rc.left, Math.min(rc.right, q.x)) - C.x, Math.max(rc.top, Math.min(rc.bottom, q.y)) - C.y));
  }
  if (C.x + r < rc.left || C.x - r > rc.right || C.y + r < rc.top || C.y - r > rc.bottom) return null;
  const pts = [];
  for (const k of keys) { const q = k && px(k); if (q && q.x >= rc.left && q.x <= rc.right && q.y >= rc.top && q.y <= rc.bottom) pts.push(q); }
  return { x: C.x, y: C.y, r, pts };
}

// ── screensaver ─────────────────────────────────────────────────────────────
// Hook for the shell (lib/screensaver.js). enter() hides the GUI and tours
// the pairs in a seeded order: the whole pair, the mesh close-up, a view
// from above or low, the exploded pair and close-ups of 2 parts
// (lib/mech-tour.js, moves seeded per run), then a fade to the next pair.
// Each step holds seconds/10 (at least 5 s). calm (1 = slowest) slows the
// input, not the step time. opts.label names each step with the relations
// and live values. No exit(): the shell reloads the page.
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
    setOpen(false); setAna(false); setShow('labels', false);
    const g = document.createElement('canvas'); g.width = 512; g.height = 320;
    const c2 = g.getContext('2d'), rg = c2.createRadialGradient(307, 128, 0, 307, 128, 420);
    rg.addColorStop(0, '#161826'); rg.addColorStop(0.7, '#08090f'); rg.addColorStop(1, '#08090f');
    c2.fillStyle = rg; c2.fillRect(0, 0, 512, 320);
    const bg = new THREE.CanvasTexture(g); bg.colorSpace = THREE.SRGBColorSpace;
    stage.scene.background = bg;
    stage.orbit = true; stage.orbitK = 1 - 0.6 * calm;
    S.ekRate = 2.4 - 0.8 * calm;
    const rpmFor = id => Math.round((id === 'worm' ? 60 : id === 'rack' ? 24 : 20) * (1 - 0.45 * calm));
    const hold = Math.max(5, (o.seconds || 60) / 10) * 1000;
    // a seeded shuffle of the pairs, not only a seeded start
    const order = UNITS.map(u => u.id);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const canvas = $('view');
    const RULES = [['\\varepsilon', 'm1'], ['F_a', 'm2'], ['\\beta', 'm2'], ['\\gamma', 'm3'], ['\\lambda', 'm4'], ['v', 'm5']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const TEXS = {
      spur: [String.raw`\varepsilon_\alpha = \frac{\sqrt{r_{a1}^2-r_{b1}^2}+\sqrt{r_{a2}^2-r_{b2}^2}-a\sin\alpha}{\pi m\cos\alpha}`, String.raw`r_b = r\cos\alpha`],
      helical: [String.raw`F_a = F_t\tan\beta`, String.raw`\varepsilon_\beta = \frac{b\sin\beta}{\pi m_n}`],
      bevel: [String.raw`\tan\gamma_1 = \frac{N_1}{N_2}`, String.raw`F_a = F_t\tan\alpha\sin\gamma`],
      worm: [String.raw`\tan\lambda = \frac{z_1 p}{2\pi r_1}`, String.raw`\lambda \le \varphi' = \tan^{-1}\frac{\mu}{\cos\alpha_n}`],
      rack: [String.raw`v = \omega r`, String.raw`x = r\,\psi`],
    };
    const EQ = { spur: ['ε_α = L_action / p_b', 'r_b = r cos α'], helical: ['Fa = Ft tan β', 'ε_β = b sin β / (π m_n)'], bevel: ['tan γ₁ = N₁/N₂', 'Fa = Ft tan α sin γ'], worm: ['tan λ = z₁ p / (2π r₁)', 'λ ≤ φ\' : self-locking'], rack: ['v = ω r'] };
    const tex = () => TEXS[S.cur.id], eq = () => EQ[S.cur.id];
    const params = () => {
      const D = S.cur.D, Q = S.Q; if (!Q) return [];
      const out = [P('\\varepsilon', 'contact ratio', D.eps.toFixed(2), 'm1')];
      if (S.cur.id === 'helical') out.push(P('F_a', 'axial thrust', `${D.Fa.toFixed(0)} N`, 'm2'), P('\\beta', 'helix', dg(D.beta), 'm2'));
      if (S.cur.id === 'bevel') out.push(P('\\gamma_1', 'pinion cone', dg(D.g1), 'm3'), P('F_{a1}', 'pinion thrust', `${D.Fa1.toFixed(0)} N`, 'm2'));
      if (S.cur.id === 'worm') out.push(P('\\lambda', 'lead angle', dg(D.lambda), 'm4'), P("\\varphi'", 'friction angle', dg(D.phiF), 'm4'));
      if (S.cur.id === 'rack') { const sp = speeds(); out.push(P('v', 'rack speed', `${sp.v.toFixed(1)} mm/s`, 'm5')); }
      else out.push(P('i', 'ratio', `${D.ratio.toFixed(3).replace(/\.?0+$/, '')} : 1`, ''));
      out.push(P('n', 'pairs in contact', String(Q.inContact), 'm1'));
      return out;
    };
    const all = () => Object.values(S.cur.B.parts).filter(q => q.info !== 'base').map(q => q.holder);
    const pair = () => Object.values(S.cur.B.parts).filter(q => /^(g1|g2|rack|loa)$/.test(q.id)).map(q => q.holder);
    const SUB = { spur: 'Contact runs along the line of action', helical: 'Teeth enter gradually across the face', bevel: 'Two pitch cones, one apex', worm: 'The thread slides on the wheel teeth', rack: 'The rack moves one radius per radian' };
    const STEPS = {
      three: { view: 'three', lab: () => ({ title: INFO[S.cur.id].title, sub: INFO[S.cur.id].kind, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      close: { view: 'close', lab: () => ({ title: 'The mesh', sub: SUB[S.cur.id], params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(pair()) }) },
      top: { view: 'top', lab: () => ({ title: INFO[S.cur.id].title, sub: 'From above', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      low: { view: 'low', lab: () => ({ title: INFO[S.cur.id].title, sub: 'Low, along the base', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      exploded: { view: 'exploded', still: true, lab: () => ({ title: 'Exploded view', sub: INFO[S.cur.id].title, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
    };
    Object.values(STEPS).forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, prefer: ['pinion', 'gear', 'worm', 'wheel', 'rack'], skip: ['base', 'block', 'loa', 'forces', 'cones', 'guide', 'vel'], azRange: [-75, 75] });
    const focusStep = info => ({ focus: info, still: true, lab: () => { const t = tour.plate(info, INFO[S.cur.id].title); return { ...t, anchor: () => plateAnchor(t.meshes) }; } });
    let plan = [];
    const makePlan = () => {
      tour.unit();
      const mid = rnd() < 0.5 ? [STEPS.top, STEPS.close] : [STEPS.close, rnd() < 0.5 ? STEPS.low : STEPS.top];
      plan = [STEPS.three, ...mid, STEPS.exploded, ...tour.pick(2).map(focusStep)];
    };
    const show = s => {
      setRpm(s.still ? 0 : rpmFor(S.cur.id));
      if (s.focus) tour.show(s.focus);
      else { tour.clear(); setView(s.view, true); tour.fromFly({ kind: 'view', exploded: s.view === 'exploded' }); }
      const l = s.lab(); lastLab = JSON.stringify(l); label(l);
    };
    const fadeSwap = async (id, then) => {
      canvas.style.opacity = '0';
      await new Promise(r => setTimeout(r, 950));
      setExplode(0); S.explode = 0;
      await swapTo(id);
      setTimeout(() => { canvas.style.opacity = '1'; then(); }, 250);
    };
    let n = 0, ord = 0, stepT = 0, lastLab = '', labT = 0, now = null;
    const advance = () => {
      if (n === 0 || n >= plan.length) {
        const go = () => { makePlan(); n = 0; stepT = 0; now = plan[n++]; show(now); };
        if (now) { tour.clear(); fadeSwap(order[++ord % order.length], go); now = null; } else go();
        return;
      }
      now = plan[n++]; show(now);
    };
    window.__mechTour = tour;
    let bandFn = null, bandT = 0;
    import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => { /* no band */ });
    saverTick = dt => {
      if (bandFn && (bandT += dt) > 0.5) { bandT = 0; try { saverBand = bandFn($('view').clientHeight); } catch (e) { saverBand = null; } }
      tour.tick(dt);
      stepT += dt * 1000; labT += dt;
      if (stepT >= hold && !S.swapping && now) { stepT = 0; advance(); }
      if (labT > 1 && now) { labT = 0; const l = now.lab(), js = JSON.stringify(l); if (js !== lastLab) { lastLab = js; label(l); } }
    };
    (async () => { if (!S.cur || S.cur.id !== order[0]) await swapTo(order[0]); advance(); })();
    return { canvas, warmupMs: 1500 };
  },
};
