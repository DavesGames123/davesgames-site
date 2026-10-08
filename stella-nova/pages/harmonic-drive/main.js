// ============================================================================
//  HARMONIC & CYCLOIDAL DRIVES  ·  main.js — unit swap, run, panels, plot, saver
// ----------------------------------------------------------------------------
//  Shows one drive at a time: drive.js for the geometry and motion,
//  scene.js for its 3D parts (kit.js, teeth.js), stage.js for the renderer
//  and the camera, cards.js for the part cards and labels. A copy of the
//  geneva-cams main.js with the drive text, plot and saver steps.
//
//  MOTION
//    One angle drives everything: S.th, the input angle (rad). Each frame
//    adds rpm / 60 * 2 pi * dt. sc.pose(S.th) moves every part and returns
//    { th, out, ratio }. The input is fast: these are reducers.
//
//  GREP MAP
//    function swapTo ............ build a unit and cross-fade to it
//    const INFO / ABOUT ......... the panel text of each unit
//    const VIEWS / function setView  camera presets
//    function drawPlot .......... strain wave deflection, or pin gaps
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, pose, explode, stage, cards, plot
//    window.snSaver ............. screensaver hook: a tour of each unit
// ============================================================================
import * as THREE from 'three';
import { UNITS, unit, cycloPose, TAU } from './drive.js';
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
  cur: null, leaving: [], th: 0, rpm: 60, lastRpm: 60, Q: null, view: 'three',
  explode: 0, explodeTarget: 0, base: true, showLabels: !PHONE_Q.matches, swapping: false,
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

// ── unit swap ───────────────────────────────────────────────────────────────
async function swapTo(id) {
  if (S.swapping || (S.cur && S.cur.id === id)) return;
  S.swapping = true;
  try {
    const B = createBuild(), sc = build(B, id);
    const next = { id, B, sc, PARTS: partsFor(id), alpha: 0, t0: performance.now() };
    B.setAlpha(0.001);
    B.setSection(false);
    S.Q = sc.pose(S.th);
    stage.root.add(B.root);
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now() });
    S.cur = next;
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
  harmonic: { title: 'Strain wave gear', kind: 'Harmonic drive · 15 : 1', lede: 'Three parts and a 15 : 1 reduction. An oval wave generator bends a thin flexspline cup so that its teeth mesh with a rigid ring at two places. The ring has two teeth more, so each input turn walks the flexspline back by two teeth. No backlash, very compact: robot joints and satellite pointing use it.' },
  cycloidal: { title: 'Cycloidal drive', kind: 'Two discs · 9 : 1', lede: 'An eccentric shaft wobbles a disc with 9 lobes inside a ring of 10 pins. Each input turn the disc rolls round the pins and turns back by one lobe. Pins through oversized holes take the slow turn out to the flange. Many lobes share the load, so it takes shocks well: industrial robot arms use it.' },
};
const ABOUT = {
  harmonic: [
    ['Two teeth short', 'The flexspline has Nf = 30 teeth, the circular spline Nc = 32. In one input turn the two engaged zones go round once, and the flexspline falls behind by Nc − Nf = 2 teeth: 2/30 of a turn. Ratio Nf / (Nc − Nf) = 15, output turning backward. Watch the red tooth against the red mark on the ring. The teeth are drawn large so that you can see them: a real unit has 100 to 200.'],
    ['Why no backlash', 'Many teeth are in mesh at the same time near each end of the long axis, preloaded by the bending. There is no gap to cross when the torque reverses.'],
    ['The wave', 'A point of the flexspline at angle φ is pushed out by d cos 2(φ − θ). The page bends the mesh this way every frame; the cup bends less toward its closed end.'],
  ],
  cycloidal: [
    ['One lobe less', 'With Np pins and Np − 1 lobes, one input turn makes the disc roll back by one lobe: ratio Np − 1 = 9, output turning backward. Watch the red lobe pass the red pin.'],
    ['The outline', 'Seen from the disc, each pin centre traces an epitrochoid with Np − 1 lobes. The disc outline is that curve moved in by the pin radius, so every pin touches it or clears it.'],
    ['Two discs', 'One wobbling disc would shake the drive. A second disc on a cam 180° round balances it and shares the load.'],
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
const VIEWS = {
  three: { az: 30, el: 38, explode: 0, k: 1, at: [0, 20, 0] },
  close: { az: 20, el: 55, explode: 0, k: 0.5, at: 'teeth' },
  top: { az: 0, el: 86, explode: 0, k: 0.85, at: [0, 20, 0] },
  low: { az: -25, el: 12, explode: 0, k: 0.9, at: [0, 20, 0] },
  exploded: { az: 24, el: 20, explode: 1, k: 1.45, at: [0, 30, 0] },
};
function fitDist(k) {
  const c = $('view'), a = c.clientWidth / Math.max(1, c.clientHeight);
  const wide = a < 1.1 ? 1 + 0.9 * (1.1 - a) * Math.min(1, k) : 1;
  return S.cur.sc.box.R * 3.3 * k * wide;
}
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const v = VIEWS[name];
  const at = v.at === 'teeth' ? S.cur.sc.keys.teeth : v.at;
  stage.flyTo({ az: v.az, el: v.el, r: fitDist(v.k), target: new THREE.Vector3(...at), t: soft ? 1.8 : 1.4 });
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
  r = Math.max(0, Math.min(300, r));
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
}
$('tLabels').addEventListener('click', () => setShow('labels', !S.showLabels));
$('tOrbit').addEventListener('click', () => setShow('orbit', !stage.orbit));

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
// Strain wave: the flexspline push d cos 2(phi - th) round the rim, with
// the two mesh zones marked. Cycloidal: the load share of each ring pin.
function drawPlot() {
  const c = $('plot'), r = c.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const g = c.getContext('2d'), pad = 10 * dpr, u = unit(S.cur.id);
  g.clearRect(0, 0, w, h);
  // 12 px axis text on a touch screen (10 px with a mouse)
  g.font = `${(COARSE ? 12 : 10) * dpr}px ui-monospace,Menlo,monospace`; g.fillStyle = 'rgba(141,144,166,0.9)';
  if (S.cur.id === 'harmonic') {
    const X = a => pad + (w - 2 * pad) * a / 360, mid = h / 2, A = h / 2 - pad;
    g.strokeStyle = 'rgba(217,179,106,0.12)'; g.beginPath(); g.moveTo(pad, mid); g.lineTo(w - pad, mid); g.stroke();
    g.strokeStyle = '#8fb0ff'; g.lineWidth = 1.6 * dpr; g.beginPath();
    for (let i = 0; i <= 360; i++) { const y = mid - Math.cos(2 * (i / 180 * Math.PI - S.th)) * A; i ? g.lineTo(X(i), y) : g.moveTo(X(i), y); }
    g.stroke();
    const th = ((S.th * 180 / Math.PI) % 360 + 360) % 360;
    g.strokeStyle = 'rgba(255,224,170,0.85)';
    for (const a of [th, (th + 180) % 360]) { g.beginPath(); g.moveTo(X(a), pad); g.lineTo(X(a), h - pad); g.stroke(); }
    ['0°', '90°', '180°', '270°'].forEach((t, k) => g.fillText(t, X(k * 90) + 3 * dpr, h - pad - 3 * dpr));
    $('legend').innerHTML = `<span class="lw"><i></i>flexspline push (±${u.d} mm)</span><span class="lo"><i></i>mesh zones</span>`;
  } else {
    const st = pinState(), bw = (w - 2 * pad) / st.length;
    st.forEach((o, j) => { const bh = (h - 2 * pad - 12 * dpr) * o.load; g.fillStyle = o.load > 0.02 ? '#e2c27a' : 'rgba(143,176,255,0.35)'; g.fillRect(pad + j * bw + 2 * dpr, h - pad - 12 * dpr - Math.max(2 * dpr, bh), bw - 4 * dpr, Math.max(2 * dpr, bh)); g.fillStyle = 'rgba(141,144,166,0.9)'; const t = String(j + 1); g.fillText(t, pad + j * bw + bw / 2 - g.measureText(t).width / 2, h - pad); });
    $('legend').innerHTML = '<span class="lo"><i></i>load share of each pin</span><span class="lw"><i></i>touching, no load</span>';
  }
}
// Each ring pin against disc 0: gap (mm) and load share. The pin pushes on
// the disc along the contact normal; the pins whose push turns the disc
// backward (the way it runs) carry the load, in proportion to that torque.
function pinState() {
  const u = unit('cycloidal'), P = cycloPose(u, S.th, 0), c = Math.cos(P.rot), s = Math.sin(P.rot), prof = S.cur.sc.prof, out = [];
  for (let j = 0; j < u.Np; j++) {
    const a = TAU * j / u.Np, px = u.R * Math.cos(a) - P.cx, py = u.R * Math.sin(a) - P.cy, lx = px * c + py * s, ly = -px * s + py * c;
    let m = Infinity, q = null; for (const p of prof) { const d = Math.hypot(p[0] - lx, p[1] - ly); if (d < m) { m = d; q = p; } }
    // push on the disc: from the pin centre toward the contact point
    const nx = (q[0] - lx) / m, ny = (q[1] - ly) / m, tau = q[0] * ny - q[1] * nx;
    out.push({ gap: Math.max(0, m - u.Rr), tau });
  }
  const top = Math.max(...out.map(o => -o.tau), 1e-9);
  for (const o of out) o.load = o.gap < 0.05 ? Math.max(0, -o.tau) / top : 0;
  return out;
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
let lastNums = '';
function fillNums() {
  const id = S.cur.id, u = unit(id), Q = S.Q, deg = v => `${((((v * 180 / Math.PI) % 360) + 360) % 360).toFixed(1)}°`;
  let html = `<tr><th>${INFO[id].title}</th><th></th></tr>` + row('Input', `${S.rpm} rpm`) + row('Output', `${(-S.rpm / Q.ratio).toFixed(2)} rpm`) + row('Ratio', `${Q.ratio} : 1, reversed`) + row('Input angle', deg(Q.th)) + row('Output angle', deg(Q.out));
  if (id === 'harmonic') { html += row('Teeth Nf / Nc', `${u.Nf} / ${u.Nc}`) + row('Wave push d', `${u.d} mm`); $('now').innerHTML = '<b>Two mesh zones</b><span>The teeth mesh at the two ends of the long axis, which turn with the input.</span>'; }
  else { const ps = pinState(), t = ps.filter(o => o.gap < 0.05).length, L = ps.filter(o => o.load > 0.02).length; html += row('Pins / lobes', `${u.Np} / ${u.Np - 1}`) + row('Eccentricity', `${u.E} mm`) + row('Pins touching', `${t} of ${u.Np}`) + row('Pins under load', `${L}`); $('now').innerHTML = `<b>${L} pins carry the load</b><span>Every pin touches the ideal disc; the ones on the driving side push it round.</span>`; }
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
}
function fillEqs() {
  const E = S.cur.id === 'harmonic' ? [
    ['Ratio', 'i = N_f / (N_c − N_f) = 30 / 2 = 15', 'output turns backward'],
    ['Strain wave', 'Δr(φ) = d cos 2(φ − θ)', 'two lobes, turning with the input'],
    ['Pitch radii', 'r_c − r_f = m (N_c − N_f) / 2 = d', 'the push closes the gap'],
  ] : [
    ['Ratio', 'i = N_p − 1 = 9', 'output turns backward'],
    ['Disc outline', 'pin path in the disc frame, moved in by R_r', 'an epitrochoid with 9 lobes'],
    ['Output holes', 'r_hole = r_pin + E', 'pins stay tangent in the holes'],
  ];
  $('eqs').innerHTML = E.map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  if (!S.Q || !S.cur) return [key, '—'];
  switch (key) {
    case 'in': return ['Input', `${S.rpm} rpm`];
    case 'out': return ['Output', `${(-S.rpm / S.Q.ratio).toFixed(2)} rpm`];
    case 'touch': return ['Pins under load', `${pinState().filter(o => o.load > 0.02).length} of 12`];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  $('read').innerHTML = `<span class="hi">${esc(INFO[S.cur.id].title)}</span><br><span class="lo">in ${S.rpm} rpm · out ${(-S.rpm / S.Q.ratio).toFixed(2)} rpm · ${S.Q.ratio} : 1</span>`;
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
window.__drives = { S, stage, cards, swapTo, setView, setRpm, setExplode, setShow, setOpen, setAna };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
setRpm(60); setExplode(0);
stage.place({ az: -60, el: 30, r: 1800, target: new THREE.Vector3(0, 20, 0) });
const start = (location.hash || '').slice(1);
swapTo(UNITS.some(v => v.id === start) ? start : 'harmonic');
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
// each unit: the whole unit, a close view of the working pair, the view
// from above, the exploded unit and close-ups of 3 parts (lib/mech-tour.js),
// then a fade to the next unit. Each step holds seconds/10 (at least 5 s).
// calm (1 = slowest) slows the input, not the step time. opts.label names
// each step with the relations and live values. No exit(): the shell
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
    setOpen(false); setAna(false); setShow('labels', false);
    const g = document.createElement('canvas'); g.width = 512; g.height = 320;
    const c2 = g.getContext('2d'), rg = c2.createRadialGradient(307, 128, 0, 307, 128, 420);
    rg.addColorStop(0, '#161826'); rg.addColorStop(0.7, '#08090f'); rg.addColorStop(1, '#08090f');
    c2.fillStyle = rg; c2.fillRect(0, 0, 512, 320);
    const bg = new THREE.CanvasTexture(g); bg.colorSpace = THREE.SRGBColorSpace;
    stage.scene.background = bg;
    stage.orbit = true; stage.orbitK = 1 - 0.6 * calm;
    S.ekRate = 2.4 - 0.8 * calm;
    const RPM = Math.round(90 - 40 * calm);
    setRpm(RPM);
    const hold = Math.max(5, (o.seconds || 60) / 10) * 1000;
    const order = UNITS.map(u => u.id), first = Math.floor(rnd() * order.length);
    const canvas = $('view');
    const RULES = [['i', 'm1'], ['N_f', 'm2'], ['N_c', 'm3'], ['N_p', 'm3'], ['d', 'm4'], ['E', 'm4']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const TEXS = {
      harmonic: [String.raw`i = \frac{N_f}{N_c - N_f} = \frac{30}{32-30} = 15`, String.raw`\Delta r(\varphi) = d\cos 2(\varphi-\theta)`],
      cycloidal: [String.raw`i = N_p - 1 = 9`, String.raw`r_{hole} = r_{pin} + E`],
    };
    const EQS = { harmonic: ['i = N_f / (N_c − N_f) = 15', 'Δr = d cos 2(φ − θ)'], cycloidal: ['i = N_p − 1 = 9', 'r_hole = r_pin + E'] };
    const tex = () => TEXS[S.cur.id], eq = () => EQS[S.cur.id];
    const params = () => [P('i', 'ratio', `${S.Q ? S.Q.ratio : '—'} : 1`, 'm1'), P('\\omega_{in}', 'input', `${S.rpm} rpm`, ''), P('\\omega_{out}', 'output', `${S.Q ? (-S.rpm / S.Q.ratio).toFixed(2) : 0} rpm`, '')];
    const all = () => Object.values(S.cur.B.parts).filter(q => q.info !== 'base').map(q => q.holder);
    const pair = () => Object.values(S.cur.B.parts).filter(q => /^(fs|cs|wg|bearing|disc0|disc1|pins)$/.test(q.id)).map(q => q.holder);
    const STEPS = [
      { view: 'three', lab: () => ({ title: INFO[S.cur.id].title, sub: INFO[S.cur.id].kind, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'close', lab: () => ({ title: S.cur.id === 'harmonic' ? 'Two mesh zones' : 'Lobes on pins', sub: S.cur.id === 'harmonic' ? 'The oval flexspline meshes at the ends of its long axis' : 'About half the pins carry the load at once', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(pair()) }) },
      { view: 'top', lab: () => ({ title: INFO[S.cur.id].title, sub: S.cur.id === 'harmonic' ? 'From above: the strain wave goes round' : 'From above: the discs wobble and roll', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'exploded', still: true, lab: () => ({ title: 'Exploded view', sub: INFO[S.cur.id].title, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
    ];
    STEPS.forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, prefer: ['fs', 'wg', 'bearing', 'disc', 'ecc', 'flange'], skip: ['cs', 'housing', 'pins'] });
    const focusStep = info => ({ focus: info, still: true, lab: () => { const t = tour.plate(info, INFO[S.cur.id].title); return { ...t, anchor: () => plateAnchor(t.meshes) }; } });
    let plan = [];
    const makePlan = () => { tour.unit(); plan = [STEPS[0], STEPS[1], STEPS[2], STEPS[3], ...tour.pick(3).map(focusStep)]; };
    const show = s => {
      setRpm(s.still ? 0 : RPM);
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
    let n = 0, ord = first, stepT = 0, lastLab = '', labT = 0, now = null;
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
    (async () => { if (!S.cur || S.cur.id !== order[first]) await swapTo(order[first]); advance(); })();
    return { canvas, warmupMs: 1500 };
  },
};
