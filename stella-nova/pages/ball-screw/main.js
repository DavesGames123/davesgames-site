// ============================================================================
//  BALL SCREW & LEAD SCREW  ·  main.js — unit swap, run, panels, plot, saver
// ----------------------------------------------------------------------------
//  Shows one linear stage at a time: mech.js for the threads, the motion
//  and the efficiency, scene.js for its 3D parts (kit.js), stage.js for the
//  renderer and the camera, cards.js for the part cards and labels. A copy
//  of the geneva-cams main.js with the screw text, the efficiency plot, the
//  drive modes and the saver steps.
//
//  MOTION
//    One phase drives everything: S.psi (rad). Each frame adds
//    rpm / 60 * 2 pi * dt. sc.pose(S.psi, load) runs the screw back and
//    forth over the stroke (mech.js stroke()) and returns { theta, x, dir }.
//    In the load mode the load pushes the nut. A self-locking screw
//    (eta' <= 0) does not move, so S.psi stands still.
//    The lead slider rebuilds the stage with a new lead (swapTo(id, L));
//    S.psi is mapped so that the nut keeps its place and its direction.
//
//  GREP MAP
//    function swapTo ............ build a unit and cross-fade to it
//    function psiFor ............ the phase for a nut place and direction
//    const INFO / ABOUT ......... the panel text of each unit
//    const VIEWS / function setView  camera presets
//    function drawPlot .......... efficiency against lead angle
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, pose, explode, stage, cards, plot
//    window.snSaver ............. screensaver hook: a tour of each unit
// ============================================================================
import * as THREE from 'three';
import { UNITS, unit, screw, effLead, effBall, lockAngle, torques, psiMid, STROKE, MU_ROLL, TAU } from './mech.js';
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

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], band: () => saverBand, tall: () => 0.55 + 0.3 * S.explode, coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, leaving: [], psi: 0, rpm: 120, lastRpm: 120, Q: null, view: 'three',
  explode: 0, explodeTarget: 0, base: true, showLabels: !PHONE_Q.matches, swapping: false,
  anaOpen: !PHONE_Q.matches, ekRate: 2.6, mode: 'motor', F: 1000, mu: 0.12, cut: false, moving: true,
};
let saverOn = false, saverTick = null, plotCache = null, saverBand = null;
const cards = createCards({
  stage, $, isPhone: () => PHONE_Q.matches,
  get: () => S.cur,
  live: key => liveValue(key),
  gauge: () => (S.Q ? S.Q.theta : 0),
  labelsOn: () => S.showLabels && S.cur.alpha > 0.5 && S.explode > 0.12 ? Math.min(1, (S.explode - 0.12) * 4) * S.cur.alpha : 0,
  clearLeft: () => PHONE_Q.matches ? 0 : $('panel').getBoundingClientRect().right - $('view').getBoundingClientRect().left,
  clearRight: () => S.anaOpen && !PHONE_Q.matches ? $('anaPanel').getBoundingClientRect().left - $('view').getBoundingClientRect().left : $('view').clientWidth,
  onTap: () => hideHint(),
});
stage.onStart = () => hideHint();

// the phase that puts the nut at x, moving with dir (dtheta/dpsi)
function psiFor(g, x, dir) {
  const half = TAU * STROKE / g.L, th = Math.max(-half / 2, Math.min(half / 2, -TAU * x / g.L));
  return dir > 0 ? th + half / 2 : half + (half / 2 - th);
}

// ── unit swap ───────────────────────────────────────────────────────────────
async function swapTo(id, L) {
  const u = unit(id);
  L = L ?? u.L;
  if (S.swapping || (S.cur && S.cur.id === id && S.cur.L === L)) return;
  S.swapping = true;
  try {
    const B = createBuild(), sc = build(B, id, L);
    const next = { id, L, B, sc, g: sc.g, PARTS: partsFor(id, L, S.mu), alpha: 0, t0: performance.now() };
    B.setAlpha(0.001);
    B.setSection(S.cut);
    B.parts.base.holder.visible = S.base;
    // keep the nut where it is
    S.psi = S.Q ? psiFor(sc.g, S.Q.x, S.Q.dir) : psiMid(sc.g);
    S.Q = sc.pose(S.psi, loadSign());
    stage.root.add(B.root);
    const sameUnit = S.cur && S.cur.id === id;
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now() });
    S.cur = next;
    cards.reset();
    fillPanel();
    syncLead();
    const c = new THREE.Vector3(...sc.box.c);
    stage.setShadowExtent(sc.box.R, c);
    stage.controls.minDistance = 120; stage.controls.maxDistance = sc.box.R * 8;
    document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    if (!saverOn) try { history.replaceState(null, '', '#' + id); } catch (e) { /* file: */ }
    if (!saverOn && !sameUnit) setView(S.view || 'three', true);
    plotCache = null;
  } finally { S.swapping = false; }
}
const loadSign = () => S.F > 0 ? (S.mode === 'motor' ? 1 : -1) : 0;

// ── panel content ───────────────────────────────────────────────────────────
const INFO = {
  acme: { title: 'ACME lead screw', kind: 'Sliding · bronze nut · self-locking', lede: 'A bronze nut slides on a 29° steel thread. Each turn moves the nut one lead. At a small lead angle the friction wins: most of the motor work turns to heat, and a load on the nut cannot turn the screw back. The screw holds its load with no brake.' },
  acme4: { title: 'Four-start lead screw', kind: 'Sliding · steep lead · back-drives', lede: 'Four threads side by side give a lead of 16 mm on the same 4 mm pitch. The lead angle is steeper, so the screw drives more efficiently, and a push on the nut now turns the screw. Steep leads give fast travel; they do not hold a load.' },
  ball: { title: 'Ball screw', kind: 'Rolling · return tube', lede: 'Steel balls roll between the screw groove and the nut groove. Rolling friction is about forty times less than sliding, so the screw drives at more than 90% and a load on the nut turns it back almost as easily. The balls run out of the circuit and a tube brings them back.' },
};
const ABOUT = {
  lead: [
    ['Lead and travel', 'The lead L is the travel for one turn: the pitch times the number of starts. The nut moves x = L × N for N turns, whatever the friction.'],
    ['Why it is inefficient', 'The nut slides on the flanks. The friction force acts along the thread at every point of contact, and at a small lead angle it is large compared with the useful force along the axis.'],
    ['Self-locking', 'When tan λ < μ / cos αn the back-drive efficiency η′ is below zero: a thrust on the nut cannot turn the screw, however large. Jacks, vices and clamps use this. It is not a safe brake: vibration can make a locked screw creep.'],
    ['Where you find it', '3D printer Z axes, scissor jacks, vices, valve stems and machine slides that must hold their place with the power off.'],
  ],
  ball: [
    ['Rolling, not sliding', 'Each ball touches the screw and the nut at about 45°. It rolls on both, so the friction is rolling friction, μ ≈ 0.003, and the efficiency stays above 90% over most lead angles.'],
    ['The balls move', 'A ball centre turns at about half the screw speed, so the balls walk along the nut. At the end of the circuit the return tube lifts them out and puts them back at the start.'],
    ['It back-drives', 'With so little friction a thrust on the nut turns the screw. A vertical axis needs a brake on the motor, or the load drops when the power goes off.'],
    ['Where you find it', 'CNC machine axes, robots, aircraft flap actuators, electric power steering and injection moulding machines: anywhere force, speed and precision matter.'],
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
    $('about').innerHTML = ABOUT[S.cur.g.type].map(([h, t]) => `<p><b>${esc(h)}.</b> ${esc(t)}</p>`).join('');
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
  three: { az: 30, el: 26, explode: 0, k: 1, at: [-64, 50, 0] },
  close: { az: 18, el: 66, explode: 0, k: 0.46, at: null, cut: true },
  side: { az: 0, el: 6, explode: 0, k: 0.92, at: [-64, 55, 0] },
  top: { az: 0, el: 80, explode: 0, k: 0.95, at: [-64, 40, 0] },
  low: { az: -28, el: 7, explode: 0, k: 0.85, at: [-64, 60, 0] },
  exploded: { az: 26, el: 22, explode: 1, k: 1.25, at: [-50, 110, 0] },
};
function fitDist(k) {
  const c = $('view'), a = c.clientWidth / Math.max(1, c.clientHeight);
  // a long stage: a portrait screen backs off more than the square subjects do
  const wide = a < 1.1 ? 1 + 1.3 * (1.1 - a) * Math.min(1, k) : 1;
  return S.cur.sc.box.R * 3.3 * k * wide;
}
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const v = VIEWS[name];
  // close in: the nut where it is now
  const at = v.at || [S.cur.sc.keys.nut[0], 60, 0];
  if (v.cut && !saverOn) setShow('cut', true);
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
  S.psi = psiFor(S.cur.g, +e.target.value, S.Q ? S.Q.dir : 1);
});
function setMode(m) {
  S.mode = m;
  document.querySelectorAll('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
}
document.querySelectorAll('#modes button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
// lead: an index into the unit's lead list; a release rebuilds the stage
const leadLabel = (g) => `${g.L} mm${g.n > 1 ? ` (${g.n}×${g.p})` : ''}`;
function syncLead() {
  const u = unit(S.cur.id), i = u.leads.indexOf(S.cur.L);
  $('lead').max = u.leads.length - 1; $('lead').value = i;
  $('leadV').textContent = leadLabel(S.cur.g);
}
$('lead').addEventListener('input', e => { const u = unit(S.cur.id); $('leadV').textContent = leadLabel(screw(u, u.leads[+e.target.value])); });
$('lead').addEventListener('change', e => { const u = unit(S.cur.id); swapTo(u.id, u.leads[+e.target.value]); });
function setLoad(F) { S.F = F; $('load').value = F; $('loadV').textContent = `${(F / 1000).toFixed(1)} kN`; }
$('load').addEventListener('input', e => setLoad(+e.target.value));
function setMu(m) {
  S.mu = m; $('mu').value = m; $('muV').textContent = m.toFixed(2);
  if (S.cur) { S.cur.PARTS = partsFor(S.cur.id, S.cur.L, m); fillEqs(); }
  plotCache = null;
}
$('mu').addEventListener('input', e => setMu(+e.target.value));
function setShow(what, on) {
  if (what === 'base') { S.base = on; $('tBase').classList.toggle('on', on); for (const o of [S.cur, ...S.leaving]) if (o) o.B.parts.base.holder.visible = on; }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
  if (what === 'cut') { S.cut = on; $('tCut').classList.toggle('on', on); for (const o of [S.cur, ...S.leaving]) if (o) o.B.setSection(on); }
}
$('tBase').addEventListener('click', () => setShow('base', !S.base));
$('tLabels').addEventListener('click', () => setShow('labels', !S.showLabels));
$('tOrbit').addEventListener('click', () => setShow('orbit', !stage.orbit));
$('tCut').addEventListener('click', () => setShow('cut', !S.cut));

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

// ── efficiency plot ─────────────────────────────────────────────────────────
// eta (drive) and eta' (back-drive) against the lead angle, 0..45 degrees:
// sliding at S.mu with the ACME flank, rolling at MU_ROLL. The line marks
// the self-locking angle; the dots mark this screw.
const COL = { s: '#e2c27a', r: '#8fb0ff', lock: 'rgba(233,160,168,0.8)' };
const LMAX = 45;
function drawPlot() {
  const c = $('plot'), r = c.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; plotCache = null; }
  const g = c.getContext('2d');
  if (!plotCache) {
    const off = document.createElement('canvas'); off.width = w; off.height = h;
    const o = off.getContext('2d'), padL = 26 * dpr, pad = 10 * dpr, padB = 16 * dpr;
    const X = l => padL + (w - padL - pad) * l / LMAX, Y = e => h - padB - (h - padB - pad) * Math.max(0, Math.min(1, e));
    o.strokeStyle = 'rgba(217,179,106,0.12)'; o.lineWidth = 1;
    for (let k = 0; k <= LMAX; k += 15) { o.beginPath(); o.moveTo(X(k), pad); o.lineTo(X(k), h - padB); o.stroke(); }
    for (let k = 0; k <= 4; k++) { o.beginPath(); o.moveTo(padL, Y(k / 4)); o.lineTo(w - pad, Y(k / 4)); o.stroke(); }
    // the self-locking band (sliding)
    const lk = lockAngle(S.mu) * DEG;
    o.fillStyle = 'rgba(233,160,168,0.07)'; o.fillRect(X(0), pad, X(lk) - X(0), h - padB - pad);
    o.strokeStyle = COL.lock; o.lineWidth = 1.2 * dpr; o.beginPath(); o.moveTo(X(lk), pad); o.lineTo(X(lk), h - padB); o.stroke();
    const line = (f, col, dash) => {
      o.strokeStyle = col; o.lineWidth = 1.7 * dpr; o.setLineDash(dash ? [5 * dpr, 4 * dpr] : []); o.beginPath();
      let on = false;
      for (let i = 1; i <= 450; i++) { const l = i / 10, e = f(l / DEG); if (e <= 0) { on = false; continue; } const x = X(l), y = Y(e); on ? o.lineTo(x, y) : o.moveTo(x, y); on = true; }
      o.stroke(); o.setLineDash([]);
    };
    line(l => effLead(l, S.mu).fwd, COL.s, false);
    line(l => effLead(l, S.mu).back, COL.s, true);
    line(l => effBall(l).fwd, COL.r, false);
    line(l => effBall(l).back, COL.r, true);
    o.fillStyle = 'rgba(141,144,166,0.9)'; o.font = `${10 * dpr}px ui-monospace,Menlo,monospace`;
    o.textAlign = 'center';
    for (let k = 0; k <= LMAX; k += 15) o.fillText(`${k}°`, Math.min(X(k), w - 14 * dpr), h - 4 * dpr);
    o.textAlign = 'left';
    ['0', '0.5', '1'].forEach((t, k) => o.fillText(t, 4 * dpr, Y(k / 2) + (k ? 9 : -2) * dpr));
    o.fillStyle = COL.lock; o.fillText('locks', X(0) + 3 * dpr, Y(0.08));
    $('legend').innerHTML = [['e1', `sliding η (μ ${S.mu.toFixed(2)})`], ['e2', 'sliding η′'], ['e3', `rolling η (μ ${MU_ROLL})`], ['e4', 'rolling η′'], ['e5', `self-locking below ${lk.toFixed(1)}°`]].map(([k, t]) => `<span class="${k}"><i></i>${t}</span>`).join('');
    plotCache = { off, X, Y };
  }
  g.clearRect(0, 0, w, h); g.drawImage(plotCache.off, 0, 0);
  // this screw: its lead angle and its two efficiencies
  const G = S.cur.g, l = G.lam * DEG, E = G.type === 'ball' ? effBall(G.lam) : effLead(G.lam, S.mu), x = plotCache.X(l);
  g.strokeStyle = 'rgba(255,224,170,0.85)'; g.lineWidth = 1.2 * dpr; g.beginPath(); g.moveTo(x, 4 * dpr); g.lineTo(x, h - 16 * dpr); g.stroke();
  const col = G.type === 'ball' ? COL.r : COL.s;
  for (const [e, fill] of [[E.fwd, true], [E.back, false]]) {
    const y = plotCache.Y(Math.max(0, e));
    g.beginPath(); g.arc(x, y, 4 * dpr, 0, TAU);
    if (fill) { g.fillStyle = col; g.fill(); } else { g.strokeStyle = e > 0 ? col : COL.lock; g.lineWidth = 2 * dpr; g.stroke(); }
  }
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
const nm = T => `${Math.abs(T) < 10 ? Math.abs(T).toFixed(2) : Math.abs(T).toFixed(1)} N·m`;
let lastNums = '';
function status() {
  const T = torques(S.cur.g, S.F, S.mu), load = S.mode === 'load';
  if (!load) return { T, key: 'drive', head: 'Driving', text: `The motor turns the screw against ${S.F} N with ${nm(T.drive)}.` };
  if (S.F === 0) return { T, key: 'idle', head: 'No load', text: 'No force pushes the nut, so nothing moves.' };
  if (T.locks) return { T, key: 'lock', head: 'Self-locking', text: `η′ is below zero: the thrust cannot turn the screw. To move the nut the motor must still turn it with ${nm(T.back)}.` };
  return { T, key: 'back', head: 'Back-driving', text: `The load turns the screw. The motor must brake with ${nm(T.back)} to hold the speed.` };
}
function fillNums() {
  const G = S.cur.g, Q = S.Q, st = status(), T = st.T, turns = Q.theta / TAU, v = G.L * S.rpm / 60 * (S.moving ? 1 : 0);
  let html = `<tr><th>${esc(INFO[S.cur.id].title)}</th><th></th></tr>` +
    row('Lead L', `${G.L} mm${G.n > 1 ? ` = ${G.n} × ${G.p}` : ''}`) + row('Lead angle λ', `${(G.lam * DEG).toFixed(2)}°`) +
    row('Screw turns N', `${turns.toFixed(2)}`) + row('Travel x = L N', `${Q.x.toFixed(1)} mm`) + row('Nut speed', `${v.toFixed(1)} mm/s`) +
    row('Drive η', `${(T.E.fwd * 100).toFixed(1)}%`) + row('Back-drive η′', T.locks ? `${(T.E.back * 100).toFixed(0)}% (locks)` : `${(T.E.back * 100).toFixed(1)}%`) +
    row('Load F', `${S.F} N`) + row('Drive torque', nm(T.drive)) + row(T.locks ? 'Torque to lower' : 'Back torque', nm(T.back));
  if (G.type === 'ball') html += row('Balls', `${S.cur.sc.C.nb * G.n} of ${G.Db.toFixed(2)} mm`) + row('Ball speed', `${(G.k / 2).toFixed(3)} × screw`);
  $('now').innerHTML = `<b>${st.head}</b><span>${esc(st.text)}</span>`;
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
}
function fillEqs() {
  const G = S.cur.g, T = torques(G, S.F, S.mu);
  const E = [
    ['Travel', 'x = L · N', 'lead times turns'],
    ['Lead angle', 'tan λ = L / (π d_m)', `${(G.lam * DEG).toFixed(2)}° here, d_m = ${G.dm} mm`],
    ['Drive', 'η = tan λ (cos αₙ − μ tan λ) / (cos αₙ tan λ + μ)', G.type === 'ball' ? `rolling: αₙ = 0, μ = ${MU_ROLL}` : `tan αₙ = tan 14.5° cos λ, μ = ${S.mu.toFixed(2)}`],
    ['Back-drive', 'η′ = (cos αₙ tan λ − μ) / (tan λ (cos αₙ + μ tan λ))', `η′ ≤ 0: self-locking below ${(lockAngle(S.mu) * DEG).toFixed(1)}° (sliding)`],
    ['Torque', 'T = F L / (2π η)', `${nm(T.drive)} at ${S.F} N`],
  ];
  $('eqs').innerHTML = E.map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  if (!S.Q || !S.cur) return [key, '—'];
  const Q = S.Q, G = S.cur.g, st = status();
  switch (key) {
    case 'rpm': return ['Screw speed', S.moving ? `${S.rpm} rpm` : 'stopped'];
    case 'torque': return S.mode === 'motor' ? ['Motor torque', nm(st.T.drive)] : [st.T.locks ? 'Torque to lower' : 'Brake torque', nm(st.T.back)];
    case 'turns': return ['Turns N', (Q.theta / TAU).toFixed(2)];
    case 'theta': return ['Angle', `${((((Q.theta % TAU) + TAU) % TAU) * DEG).toFixed(0)}°`];
    case 'x': return ['Travel x', `${Q.x.toFixed(1)} mm`];
    case 'v': return ['Nut speed', `${(S.moving ? G.L * S.rpm / 60 : 0).toFixed(1)} mm/s`];
    case 'F': return ['Load', `${S.F} N`];
    case 'ballRate': return ['Ball speed', `${(G.k / 2 * S.rpm).toFixed(1)} rpm`];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const Q = S.Q, G = S.cur.g, st = status();
  $('read').innerHTML = `<span class="hi">${esc(INFO[S.cur.id].title)} · L ${G.L} mm</span><br><span class="${st.key === 'lock' ? 'bad' : 'lo'}">${st.head.toLowerCase()} · N ${(Q.theta / TAU).toFixed(2)} · x ${Q.x.toFixed(1)} mm · η ${(st.T.E.fwd * 100).toFixed(0)}%</span>`;
  $('turnV').textContent = `${Q.x.toFixed(0)} mm`;
  if (document.activeElement !== $('turn')) $('turn').value = Q.x;
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true, numT = 0;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur) return;
  const cur = S.cur;
  // a load drives only a screw that is not self-locking
  S.moving = S.rpm > 0 && (S.mode === 'motor' || (S.F > 0 && !torques(cur.g, S.F, S.mu).locks));
  if (S.moving) S.psi += S.rpm / 60 * TAU * dt;
  S.Q = cur.sc.pose(S.psi, loadSign());
  for (const o of S.leaving) o.sc.pose(psiFor(o.g, S.Q.x, S.Q.dir), loadSign());
  S.explode += (S.explodeTarget - S.explode) * Math.min(1, dt * S.ekRate);
  cur.B.applyExplode(S.explode);
  const age = (now - cur.t0) / 1000, al = REDUCED ? 1 : ease((age - 0.1) / 0.9);
  if (al !== cur.alpha) { cur.alpha = al; cur.B.setAlpha(Math.max(0.001, al)); }
  for (const old of S.leaving) {
    const t = (now - old.t0) / 600, kk = ease(t);
    old.B.setAlpha(Math.max(0.001, 1 - kk));
    old.B.applyExplode(S.explode);
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
window.__ballScrew = { S, stage, cards, swapTo, setView, setRpm, setExplode, setShow, setOpen, setAna, setMode, setLoad, setMu };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
setRpm(120); setExplode(0); setMode('motor'); setLoad(1000); setMu(0.12);
stage.place({ az: -60, el: 30, r: 1800, target: new THREE.Vector3(-64, 50, 0) });
const start = (location.hash || '').slice(1);
swapTo(UNITS.some(v => v.id === start) ? start : 'acme');
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
// each unit: the whole stage, the nut cut open, the side view (travel on
// the scale), the exploded stage and close-ups of 3 parts
// (lib/mech-tour.js), then a fade to the next unit. Each step holds
// seconds/10 (at least 5 s). calm (1 = slowest) slows the screw, not the
// step time. opts.label names each step with the relations and live
// values. No exit(): the shell reloads the page.
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
    setOpen(false); setAna(false); setShow('labels', false); setMode('motor'); setLoad(1000);
    const g = document.createElement('canvas'); g.width = 512; g.height = 320;
    const c2 = g.getContext('2d'), rg = c2.createRadialGradient(307, 128, 0, 307, 128, 420);
    rg.addColorStop(0, '#161826'); rg.addColorStop(0.7, '#08090f'); rg.addColorStop(1, '#08090f');
    c2.fillStyle = rg; c2.fillRect(0, 0, 512, 320);
    const bg = new THREE.CanvasTexture(g); bg.colorSpace = THREE.SRGBColorSpace;
    stage.scene.background = bg;
    stage.orbit = true; stage.orbitK = 1 - 0.6 * calm;
    S.ekRate = 2.4 - 0.8 * calm;
    const RPM = Math.round(160 - 80 * calm);
    setRpm(RPM);
    const hold = Math.max(5, (o.seconds || 60) / 10) * 1000;
    const order = UNITS.map(u => u.id), first = Math.floor(rnd() * order.length);
    const canvas = $('view');
    const RULES = [['L', 'm1'], ['N', 'm2'], ['x', 'm3'], ['\\lambda', 'm4'], ['\\eta', 'm5'], ['\\mu', 'm6']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const params = () => {
      const G = S.cur.g, Q = S.Q || { theta: 0, x: 0 }, E = G.type === 'ball' ? effBall(G.lam) : effLead(G.lam, S.mu);
      return [P('L', 'lead', `${G.L} mm`, 'm1'), P('N', 'turns', (Q.theta / TAU).toFixed(1), 'm2'), P('x', 'travel', `${Q.x.toFixed(0)} mm`, 'm3'),
        P('\\lambda', 'lead angle', `${(G.lam * DEG).toFixed(1)}°`, 'm4'), P('\\eta', 'drive', `${(E.fwd * 100).toFixed(0)}%`, 'm5'),
        P("\\eta'", 'back-drive', E.back > 0 ? `${(E.back * 100).toFixed(0)}%` : 'locks', 'm5')];
    };
    const tex = () => [String.raw`x = L\,N,\qquad \tan\lambda = \frac{L}{\pi d_m}`, String.raw`\eta = \frac{\tan\lambda\,(\cos\alpha_n-\mu\tan\lambda)}{\cos\alpha_n\tan\lambda+\mu}`];
    const eq = () => ['x = L · N,  tan λ = L / (π dₘ)', 'η = tan λ (cos αₙ − μ tan λ) / (cos αₙ tan λ + μ)'];
    const all = () => Object.values(S.cur.B.parts).filter(q => q.info !== 'base').map(q => q.holder);
    const pair = () => Object.values(S.cur.B.parts).filter(q => /^(nut|balls|tube)$/.test(q.id)).map(q => q.holder);
    const ballU = () => S.cur.g.type === 'ball';
    const STEPS = [
      { view: 'three', cut: false, lab: () => ({ title: INFO[S.cur.id].title, sub: INFO[S.cur.id].kind, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'close', cut: true, slow: true, lab: () => ({ title: ballU() ? 'Balls in the groove' : 'Inside the bronze nut', sub: ballU() ? 'They roll at half the screw speed and come back through the tube' : 'The nut slides on the flanks: friction sets the efficiency', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(pair()) }) },
      { view: 'side', cut: false, lab: () => ({ title: 'Travel = lead × turns', sub: `${S.cur.g.L} mm for each turn of the screw`, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'exploded', cut: false, still: true, lab: () => ({ title: 'Exploded view', sub: INFO[S.cur.id].title, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
    ];
    STEPS.forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, prefer: ['nut', 'balls', 'tube', 'coupling', 'carriage', 'motor'], skip: ['base', 'rails', 'load', 'endplate', 'screw'] });
    const focusStep = info => ({ focus: info, still: true, lab: () => { const t = tour.plate(info, INFO[S.cur.id].title); return { ...t, anchor: () => plateAnchor(t.meshes) }; } });
    let plan = [];
    const makePlan = () => { tour.unit(); plan = [STEPS[0], STEPS[1], STEPS[2], STEPS[3], ...tour.pick(3).map(focusStep)]; };
    const show = s => {
      // the close view runs slow enough that the nut stays in the frame
      setRpm(s.still ? 0 : s.slow ? Math.min(RPM / 2, Math.round(300 / S.cur.g.L)) : RPM);
      if (s.focus) { setShow('cut', false); tour.show(s.focus); }
      else { setShow('cut', !!s.cut); tour.clear(); setView(s.view, true); tour.fromFly({ kind: 'view', exploded: s.view === 'exploded' }); }
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
