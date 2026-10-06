// ============================================================================
//  STEAM LOCOMOTIVE  ·  main.js — reverser, run, panels, plots, loop, saver
// ----------------------------------------------------------------------------
//  Shows the right side of a two-cylinder engine with Walschaerts valve
//  gear: mech.js for the joints and the valve events, scene.js for the 3D
//  parts (kit.js), stage.js for the renderer and the camera, cards.js for
//  the part cards and labels. A copy of the linkages main.js with one
//  build (no unit swap), a reverser, two plots and the saver steps.
//
//  MOTION
//    S.phi is the wheel angle (rad). Each frame adds dir * rpm / 60 * 2 pi
//    * dt, with dir = +1 when the reverser is forward of mid gear and -1
//    behind it: the engine runs the way the reverser points. S.c is the
//    reverser (-1 .. 1); it eases toward S.cTarget, as a reverser screw
//    turns. sc.pose(S.phi, S.c) places every part and returns Q.
//
//  STEAM
//    events() and indicator() (both ends) are computed for the reverser
//    setting when it changes (function analyse). The cylinder ends, ports
//    and live steam take colours from the pressure at the nearest sample.
//
//  GREP MAP
//    const PRESETS .............. the reverser buttons
//    function analyse ........... events and indicator loops for S.c
//    const VIEWS / function setView  camera presets
//    function drawPlot .......... valve travel and port openings
//    function drawInd ........... the indicator diagram
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function paintSteam ........ port, cylinder and chest colours
//    function frame ............. step, pose, explode, stage, cards, plots
//    window.snSaver ............. screensaver hook: whole engine, valve
//                                 gear, cut-away valve, exploded, part
//                                 close-ups, a new reverser setting each
//                                 round (azRange -65..65)
// ============================================================================
import * as THREE from 'three';
import { G, TAU, events, indicator, makeGear, sample } from './mech.js';
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
const NS = 720;   // samples per turn for the plots and the steam colours

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], band: () => saverBand, coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, phi: 0.4, rpm: 20, lastRpm: 20, Q: null, view: 'three', c: 0.75, cTarget: 0.75, A: null,
  explode: 0, explodeTarget: 0, body: true, section: true, showLabels: !PHONE_Q.matches,
  anaOpen: !PHONE_Q.matches, ekRate: 2.6,
};
let saverOn = false, saverTick = null, plotCache = null, indCache = null, saverBand = null;
const cards = createCards({
  stage, $, isPhone: () => PHONE_Q.matches,
  get: () => S.cur,
  live: key => liveValue(key),
  gauge: () => -S.phi,
  labelsOn: () => S.showLabels && S.cur.alpha > 0.5 && S.explode > 0.12 ? Math.min(1, (S.explode - 0.12) * 4) * S.cur.alpha : 0,
  clearLeft: () => PHONE_Q.matches ? 0 : $('panel').getBoundingClientRect().right - $('view').getBoundingClientRect().left,
  clearRight: () => S.anaOpen && !PHONE_Q.matches ? $('anaPanel').getBoundingClientRect().left - $('view').getBoundingClientRect().left : $('view').clientWidth,
  onTap: () => hideHint(),
});
stage.onStart = () => hideHint();

// ── build ───────────────────────────────────────────────────────────────────
function boot() {
  const B = createBuild(), sc = build(B);
  S.cur = { id: 'loco', B, sc, PARTS: partsFor(), alpha: 0, t0: performance.now() };
  B.setAlpha(0.001);
  B.setSection(S.section);
  S.Q = sc.pose(S.phi, S.c);
  stage.root.add(B.root);
  cards.reset();
  fillPanel();
  const c = new THREE.Vector3(...sc.box.c);
  stage.setShadowExtent(sc.box.R, c);
  stage.controls.minDistance = sc.box.R * 0.15; stage.controls.maxDistance = sc.box.R * 7;
}
const dirOf = c => (c < -1e-3 ? -1 : 1);

// ── the reverser and the valve events ───────────────────────────────────────
const PRESETS = [
  { id: 'full', c: 1, name: 'Full forward', kind: 'Starting: about 75 % cut-off' },
  { id: 'linked', c: 0.35, name: 'Linked up', kind: 'Running: short cut-off' },
  { id: 'mid', c: 0, name: 'Mid gear', kind: 'Lap and lead only' },
  { id: 'reverse', c: -1, name: 'Full reverse', kind: 'Die above the trunnion' },
];
// events and both indicator loops for a reverser setting (cached by c)
// (a memo by c: the screw passes the same settings again)
const MEMO = new Map();
function compute(c, key) {
  if (!MEMO.has(key)) {
    const dir = dirOf(c), P = sample(c, dir, NS), ev = events(c, dir, NS, P), f = indicator(c, dir, NS, 'front', P), r = indicator(c, dir, NS, 'rear', P);
    MEMO.set(key, { key, c, dir, ev, f, r, cut: (ev.front.cutoff + ev.rear.cutoff) / 2 });
  }
  return MEMO.get(key);
}
function analyse(c) {
  const key = c.toFixed(3);
  if (S.A && S.A.key === key) return S.A;
  S.A = compute(c, key);
  plotCache = null; indCache = null;
  return S.A;
}
function setRev(c, now) {
  c = Math.max(-1, Math.min(1, Math.round(c * 100) / 100));
  S.cTarget = c; if (now) S.c = c;
  $('rev').value = Math.round(c * 100);
  $('revV').textContent = c === 0 ? 'mid' : `${Math.abs(Math.round(c * 100))} % ${c > 0 ? 'fwd' : 'rev'}`;
  document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', Math.abs(+b.dataset.c - c) < 1e-6));
}
$('rev').addEventListener('input', e => setRev(+e.target.value / 100));
function buildPicker() {
  $('variants').innerHTML = PRESETS.map(v => `<button class="mv" type="button" data-c="${v.c}"><b>${esc(v.name)}</b><span>${esc(v.kind)}</span></button>`).join('');
  $('variants').querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => setRev(+b.dataset.c)));
}

// ── panel content ───────────────────────────────────────────────────────────
const INFO = { title: 'Walschaerts valve gear', kind: 'Steam locomotive · right side', lede: 'One side of a two-cylinder engine. The piston drives the wheels through the main rod; the valve gear times the steam. A return crank on the main crank pin rocks the expansion link, and the crosshead adds its own motion through the combination lever. The reverser moves the die block in the link: that sets the direction and the cut-off.' };
const ABOUT = [
  ['Lap and lead', `Each valve head overlaps its port by the lap (${G.LAP} mm) when the valve is central. At dead centre the valve is already open by the lead (${'≈'}6 mm), so the steam meets the piston as it turns back. The crosshead, through the combination lever, gives exactly lap + lead at each dead centre.`],
  ['Cut-off', 'The link gives the part of the valve motion a quarter turn ahead of the piston. The further the die is from the trunnion, the larger that part, and the later the valve closes. In full gear the steam enters for about 75 % of the stroke; linked up, for 20 % or less, and expands for the rest.'],
  ['Why link up', 'Steam that expands gives work for nothing. A short cut-off uses much less steam per stroke for a little less push: the indicator loop gets thinner, but the work per unit of steam goes up. Drivers start in full gear and notch up as speed rises.'],
  ['Constant lead', 'The link slot has the radius of the radius rod, and the return crank is set so that the link is at mid swing at both dead centres. Then moving the die does not move the valve at dead centre: the lead is the same at every cut-off, forward and reverse.'],
  ['The other side', 'The left side has the same gear with its crank a quarter turn away, so one cylinder is always far from dead centre and the engine can start from any wheel position.'],
];
function fillPanel() {
  $('engTitle').textContent = INFO.title;
  $('engKind').textContent = INFO.kind;
  $('engLede').textContent = INFO.lede;
  const seen = new Set(), P = S.cur.PARTS;
  const ids = Object.values(S.cur.B.parts).map(q => q.info).filter(k => P[k] && !seen.has(k) && seen.add(k));
  $('partList').innerHTML = ids.map(k => `<button type="button" data-part="${k}" style="--gc:${GROUP_COLOR[P[k].group] || '#e9c27a'}"><i></i>${esc(P[k].name)}</button>`).join('');
  $('partList').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { cards.pinById(b.dataset.part); if (PHONE_Q.matches) setOpen(false); }));
  $('about').innerHTML = ABOUT.map(([h, t]) => `<p><b>${esc(h)}.</b> ${esc(t)}</p>`).join('');
  fillEqs();
}

// ── views ───────────────────────────────────────────────────────────────────
const VIEWS = {
  three: { az: 28, el: 12, explode: 0, k: 1.02, at: null },
  gear: { az: 18, el: 8, explode: 0, k: 0.56, at: 'gear' },
  valve: { az: 8, el: 4, explode: 0, k: 0.2, at: 'valve' },
  side: { az: 0, el: 2, explode: 0, k: 0.78, at: null },
  exploded: { az: 26, el: 36, explode: 1, k: 1.1, at: 'spread' },
};
function fitDist(k) {
  const c = $('view'), a = c.clientWidth / Math.max(1, c.clientHeight);
  const wide = a < 1.1 ? 1 + 0.9 * (1.1 - a) * Math.min(1, k) : 1;
  return S.cur.sc.box.R * 3.3 * k * wide;
}
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const v = VIEWS[name], sc = S.cur.sc;
  const at = v.at ? sc.keys[v.at] : sc.box.c;
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
const kmh = rpm => rpm / 60 * Math.PI * 2 * G.WHEEL_R / 1000 * 3.6;
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
  const want = +e.target.value / DEG, base = Math.floor(S.phi / TAU) * TAU;
  S.phi = base + want;
});
function setShow(what, on) {
  if (what === 'body') { S.body = on; $('tBody').classList.toggle('on', on); if (S.cur) S.cur.B.parts.body.holder.visible = on; }
  if (what === 'section') { S.section = on; $('tSection').classList.toggle('on', on); if (S.cur) S.cur.B.setSection(on); }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
}
$('tBody').addEventListener('click', () => setShow('body', !S.body));
$('tSection').addEventListener('click', () => setShow('section', !S.section));
$('tLabels').addEventListener('click', () => setShow('labels', !S.showLabels));
$('tOrbit').addEventListener('click', () => setShow('orbit', !stage.orbit));

// ── panels: left controls, right analysis; on a phone one sheet ─────────────
const panel = $('panel'), tabs = [...document.querySelectorAll('#dock .tab')], anaSec = $('anaSec'), anaPanel = $('anaPanel');
let grp = 'unit';
function placeAnalysis() {
  if (PHONE_Q.matches) { if (anaSec.parentNode !== panel) panel.appendChild(anaSec); }
  else if (anaSec.parentNode !== anaPanel) anaPanel.appendChild(anaSec);
  setAna(S.anaOpen);
  plotCache = null; indCache = null;
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
  plotCache = null; indCache = null;
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

// ── plots ───────────────────────────────────────────────────────────────────
// Valve travel and port openings over one wheel turn, in the running
// direction, from front dead centre. Valve offset on a fixed +-100 mm
// scale with the laps marked; steam openings filled under the axis.
const COL = { v: '#e2c27a', f: '#e9a0a8', r: '#8fb0ff', x: 'rgba(160,170,190,0.55)', lap: 'rgba(226,194,122,0.35)' };
const sizeCanvas = c => {
  const r = c.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; return { w, h, dpr, fresh: true }; }
  return { w, h, dpr, fresh: false };
};
function drawPlot() {
  const c = $('plot'), z = sizeCanvas(c);
  if (!z) return;
  const { w, h, dpr } = z;
  if (z.fresh) plotCache = null;
  const g = c.getContext('2d'), A = S.A;
  if (!plotCache) {
    const off = document.createElement('canvas'); off.width = w; off.height = h;
    const o = off.getContext('2d'), pad = 10 * dpr, X = i => pad + (w - 2 * pad) * i / 360, top = pad, base = h * 0.62, Hv = base - top - 4 * dpr;
    const Y = v => base - Hv / 2 - v / 100 * (Hv / 2), Yo = mm => base + 4 * dpr + mm / G.PORT * (h - pad - base - 4 * dpr);
    o.strokeStyle = 'rgba(217,179,106,0.12)'; o.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const x = X(k * 90); o.beginPath(); o.moveTo(x, pad); o.lineTo(x, h - pad); o.stroke(); }
    o.beginPath(); o.moveTo(pad, Y(0)); o.lineTo(w - pad, Y(0)); o.stroke();
    o.setLineDash([4 * dpr, 4 * dpr]); o.strokeStyle = COL.lap;
    for (const v of [G.LAP, -G.LAP]) { o.beginPath(); o.moveTo(pad, Y(v)); o.lineTo(w - pad, Y(v)); o.stroke(); }
    o.setLineDash([]);
    // piston travel, faint, on the same band
    const P = [];
    const gear = makeGear();
    for (let i = 0; i <= 360; i++) P.push(gear.pose(A.dir * i / 360 * TAU, A.c));
    o.strokeStyle = COL.x; o.lineWidth = 1 * dpr; o.beginPath();
    P.forEach((q, i) => { const y = Y(100 - 200 * q.x / G.STROKE); i ? o.lineTo(X(i), y) : o.moveTo(X(i), y); }); o.stroke();
    // port openings to steam, hanging below the base line
    for (const [k, col] of [['fs', COL.f], ['rs', COL.r]]) {
      o.fillStyle = col + '55'; o.strokeStyle = col; o.lineWidth = 1.3 * dpr; o.beginPath(); o.moveTo(X(0), Yo(0));
      P.forEach((q, i) => o.lineTo(X(i), Yo(q.open[k]))); o.lineTo(X(360), Yo(0)); o.closePath(); o.fill(); o.stroke();
    }
    o.strokeStyle = 'rgba(217,179,106,0.2)'; o.beginPath(); o.moveTo(pad, Yo(0)); o.lineTo(w - pad, Yo(0)); o.stroke();
    // valve offset
    o.strokeStyle = COL.v; o.lineWidth = 1.7 * dpr; o.beginPath();
    P.forEach((q, i) => { const y = Y(q.v); i ? o.lineTo(X(i), y) : o.moveTo(X(i), y); }); o.stroke();
    // cut-off marks: where the steam openings close
    o.fillStyle = 'rgba(255,224,170,0.95)'; o.font = `${9.5 * dpr}px ui-monospace,Menlo,monospace`;
    for (const k of ['fs', 'rs']) for (let i = 1; i <= 360; i++) if (P[i - 1].open[k] > 0 && P[i].open[k] === 0) { o.fillRect(X(i) - 1 * dpr, Yo(0) - 3 * dpr, 2 * dpr, 6 * dpr); }
    o.fillStyle = 'rgba(141,144,166,0.9)'; o.font = `${10 * dpr}px ui-monospace,Menlo,monospace`;
    ['FDC 0°', '90°', 'RDC 180°', '270°'].forEach((t, k) => o.fillText(t, X(k * 90) + 3 * dpr, top + 9 * dpr));
    o.fillText(`lap ±${G.LAP}`, w - pad - 70 * dpr, Y(G.LAP) - 3 * dpr);
    $('legend').innerHTML = [['lo', 'valve offset (±100 mm)'], ['lw', 'rear port to steam'], ['la', 'front port to steam'], ['lx', 'piston travel']].map(([k, t]) => `<span class="${k}"><i></i>${t}</span>`).join('');
    plotCache = { off, X };
  }
  g.clearRect(0, 0, w, h); g.drawImage(plotCache.off, 0, 0);
  const ph = ((A.dir * S.phi % TAU) + TAU) % TAU * DEG, x = plotCache.X(ph);
  g.strokeStyle = 'rgba(255,224,170,0.85)'; g.lineWidth = 1.2 * dpr; g.beginPath(); g.moveTo(x, 4 * dpr); g.lineTo(x, h - 4 * dpr); g.stroke();
}
// the indicator diagram: p against v for both ends (v = clearance + travel)
function drawInd() {
  const c = $('ind'), z = sizeCanvas(c);
  if (!z) return;
  const { w, h, dpr } = z;
  if (z.fresh) indCache = null;
  const g = c.getContext('2d'), A = S.A;
  const pad = 12 * dpr, vMax = 1 + G.CLEAR, X = v => pad + (w - 2 * pad) * v / vMax, Y = p => h - pad - (h - 2 * pad) * p;
  if (!indCache) {
    const off = document.createElement('canvas'); off.width = w; off.height = h;
    const o = off.getContext('2d');
    o.strokeStyle = 'rgba(217,179,106,0.14)'; o.lineWidth = 1;
    for (const p of [0, 0.5, 1]) { o.beginPath(); o.moveTo(pad, Y(p)); o.lineTo(w - pad, Y(p)); o.stroke(); }
    for (const v of [G.CLEAR, vMax]) { o.beginPath(); o.moveTo(X(v), pad); o.lineTo(X(v), h - pad); o.stroke(); }
    for (const [L, col] of [[A.f, COL.f], [A.r, COL.r]]) {
      o.fillStyle = col + '30'; o.strokeStyle = col; o.lineWidth = 1.5 * dpr; o.beginPath();
      L.pv.forEach(([v, p], i) => (i ? o.lineTo(X(v), Y(p)) : o.moveTo(X(v), Y(p)))); o.closePath(); o.fill(); o.stroke();
    }
    o.fillStyle = 'rgba(141,144,166,0.9)'; o.font = `${10 * dpr}px ui-monospace,Menlo,monospace`;
    o.fillText('p = boiler', pad + 3 * dpr, Y(1) + 11 * dpr);
    o.fillText('volume →', w - pad - 64 * dpr, h - pad - 4 * dpr);
    indCache = { off };
  }
  g.clearRect(0, 0, w, h); g.drawImage(indCache.off, 0, 0);
  const i = sampleIndex();
  for (const [L, col] of [[A.f, COL.f], [A.r, COL.r]]) {
    const [v, p] = L.pv[i];
    g.fillStyle = col; g.beginPath(); g.arc(X(v), Y(p), 3.6 * dpr, 0, TAU); g.fill();
  }
}
// the sample of the analysis loops nearest the present wheel angle
function sampleIndex() { const ph = ((S.A.dir * S.phi % TAU) + TAU) % TAU; return Math.round(ph / TAU * NS) % NS; }

const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
const pc = v => `${(v * 100).toFixed(0)} %`;
let lastNums = '';
function fillNums() {
  const A = S.A, Q = S.Q, ev = A.ev, i = sampleIndex(), ph = (((A.dir * S.phi % TAU) + TAU) % TAU) * DEG;
  let html = `<tr><th>Reverser ${$('revV').textContent}</th><th>${A.dir > 0 ? 'running forward' : 'running backward'}</th></tr>`;
  html += row('Cut-off front / rear', `${pc(ev.front.cutoff)} / ${pc(ev.rear.cutoff)}`)
    + row('Lead front / rear', `${ev.front.lead.toFixed(1)} / ${ev.rear.lead.toFixed(1)} mm`)
    + row('Valve travel', `${ev.travel.toFixed(0)} mm`)
    + row('Largest port opening', `${ev.maxOpen.toFixed(0)} mm`)
    + row('Release (front)', pc(ev.front.release))
    + row('Compression (front)', pc(ev.front.compression))
    + row('Mean effective pressure', `${((A.f.mep + A.r.mep) / 2 * 100).toFixed(0)} % of boiler`)
    + row('Work per unit of steam', `${((A.f.eff + A.r.eff) / 2).toFixed(2)}`)
    + row('Wheel angle', `${ph.toFixed(0)}° from FDC`)
    + row('Valve offset now', `${Q.v >= 0 ? '+' : '−'}${Math.abs(Q.v).toFixed(1)} mm`)
    + row('Pressure front / rear', `${(A.f.pv[i][1] * 100).toFixed(0)} / ${(A.r.pv[i][1] * 100).toFixed(0)} %`)
    + row('Speed', `${S.rpm} rpm · ${kmh(S.rpm).toFixed(0)} km/h`);
  const fo = Q.open, st = fo.fs > 0 ? 'Steam to the front end' : fo.rs > 0 ? 'Steam to the rear end' : 'Both ports closed to steam';
  $('now').innerHTML = `<b>${esc(st)}</b><span>${fo.fx > 0 ? 'front end exhausting' : fo.rx > 0 ? 'rear end exhausting' : 'expansion or compression'}</span>`;
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
}
function fillEqs() {
  const E = [
    ['Port open to steam', 'front: v − lap > 0,  rear: −v − lap > 0', 'inside admission'],
    ['Lap and lead', 'v(dead centre) = ± (lap + lead)', 'from the crosshead, via the lever'],
    ['Valve motion', 'v ≈ (lap + lead) cos φ + k·c·sin φ', 'c: reverser, −1 … 1'],
    ['Expansion', 'p·V = constant after cut-off', 'ideal, hyperbolic'],
    ['MEP', '∮ p dV / swept volume', 'work per stroke'],
  ];
  $('eqs').innerHTML = E.map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  if (!S.Q || !S.A) return [key, '—'];
  const Q = S.Q, A = S.A, i = sampleIndex();
  switch (key) {
    case 'wheel': return ['Wheel', `${S.rpm} rpm · ${kmh(S.rpm).toFixed(0)} km/h`];
    case 'piston': return ['Piston travel', `${Q.x.toFixed(0)} mm from front`];
    case 'valve': return ['Valve offset', `${Q.v >= 0 ? '+' : '−'}${Math.abs(Q.v).toFixed(1)} mm`];
    case 'cut': return ['Cut-off', `${pc(A.cut)} · ${$('revV').textContent}`];
    case 'press': return ['Pressure F / R', `${(A.f.pv[i][1] * 100).toFixed(0)} / ${(A.r.pv[i][1] * 100).toFixed(0)} %`];
  }
  return [key, '—'];
}

// fill the memo in the background, one reverser setting per frame
let warmK = 0;
function warm() {
  if (warmK > 100) return;
  const c = (Math.round((warmK++ - 50) * 2) / 100), key = c.toFixed(3);
  compute(c, key);
}

// ── steam colours ───────────────────────────────────────────────────────────
const C_STEAM = new THREE.Color(0xffa040), C_EXH = new THREE.Color(0x4f86d8), C_DARK = new THREE.Color(0x1c1d22), C_COLD = new THREE.Color(0x30405a), tc = new THREE.Color();
function tint(m, col, glow) { m.material.color.copy(col); m.material.emissive.copy(col).multiplyScalar(glow); }
function paintSteam() {
  const { ports, gas } = S.cur.sc, Q = S.Q, A = S.A, i = sampleIndex(), o = Q.open;
  const port = (m, s, x) => tint(m, s > 0 ? tc.copy(C_DARK).lerp(C_STEAM, 0.35 + 0.65 * s / G.PORT) : x > 0 ? tc.copy(C_DARK).lerp(C_EXH, 0.35 + 0.65 * x / G.PORT) : C_DARK, s > 0 || x > 0 ? 0.55 : 0);
  port(ports.portF, o.fs, o.fx); port(ports.portR, o.rs, o.rx);
  const gp = (m, p) => tint(m, tc.copy(C_COLD).lerp(C_STEAM, Math.max(0, Math.min(1, (p - G.PEX) / (1 - G.PEX)))), 0.2 + 0.5 * p);
  gp(gas.gasF, A.f.pv[i][1]); gp(gas.gasR, A.r.pv[i][1]);
  tint(gas.live, C_STEAM, 0.55);
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const A = S.A, ph = (((A.dir * S.phi % TAU) + TAU) % TAU) * DEG;
  $('read').innerHTML = `<span class="hi">Cut-off ${pc(A.cut)} · ${esc($('revV').textContent)}</span><br><span class="lo">φ ${ph.toFixed(0)}° · valve ${S.Q.v >= 0 ? '+' : '−'}${Math.abs(S.Q.v).toFixed(1)} mm · ${kmh(S.rpm).toFixed(0)} km/h</span>`;
  $('turnV').textContent = `${ph.toFixed(0)}°`;
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true, numT = 0;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur) return;
  const cur = S.cur;
  // the reverser screw: about 1.5 s from full forward to full reverse
  if (S.c !== S.cTarget) { const d = S.cTarget - S.c, st = dt * 1.4; S.c = Math.abs(d) <= st ? S.cTarget : S.c + Math.sign(d) * st; }
  analyse(Math.round(S.c * 50) / 50);
  warm();
  S.phi += S.A.dir * S.rpm / 60 * TAU * dt;
  S.Q = cur.sc.pose(S.phi, S.c);
  S.explode += (S.explodeTarget - S.explode) * Math.min(1, dt * S.ekRate);
  cur.B.applyExplode(S.explode);
  const age = (now - cur.t0) / 1000, al = REDUCED ? 1 : ease((age - 0.1) / 0.9);
  if (al !== cur.alpha) { cur.alpha = al; cur.B.setAlpha(Math.max(0.001, al)); }
  paintSteam();
  stage.frame(dt);
  cards.frame(now, dt);
  if (!saverOn) {
    readout();
    if ((numT += dt) > 0.15) { numT = 0; fillNums(); }
    drawPlot(); drawInd();
  } else if (saverTick) saverTick(dt);
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });
window.__steamLoco = { S, stage, cards, setView, setRpm, setRev, setExplode, setShow, setOpen, setAna };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
$('tBody').classList.toggle('on', S.body);
$('tSection').classList.toggle('on', S.section);
setRpm(20); setExplode(0); setRev(S.c, true);
stage.place({ az: -40, el: 20, r: 60000, target: new THREE.Vector3(1300, 900, 0) });
boot();
analyse(S.c);
setView('three', true);
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
// the engine: the whole engine, the valve gear, the cut-away valve and
// cylinder, the exploded gear and close-ups of 3 parts (lib/mech-tour.js).
// Each round takes a new reverser setting (seeded) and the screw moves the
// die while the camera flies. Each step holds seconds/10 (at least 5 s).
// calm (1 = slowest) slows the wheels, not the step time. opts.label names
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
    const RPM = Math.round(30 - 14 * calm);
    setRpm(RPM);
    const hold = Math.max(5, (o.seconds || 60) / 10) * 1000;
    const canvas = $('view');
    const RULES = [['v', 'm1'], ['\\varphi', 'm2'], ['c', 'm3'], ['p', 'm4'], ['V', 'm4']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const TEX = [String.raw`v \approx (l + l_e)\cos\varphi + k\,c\,\sin\varphi`, String.raw`\mathrm{MEP} = \frac{1}{V_s}\oint p\,dV`];
    const EQ = ['v ≈ (lap + lead) cos φ + k c sin φ', 'MEP = ∮ p dV / V_s'];
    const params = () => {
      if (!S.A || !S.Q) return [];
      const A = S.A;
      return [P('c', 'reverser', $('revV').textContent, 'm3'), P('x_c', 'cut-off', pc(A.cut), 'm3'), P('v', 'valve offset', `${S.Q.v >= 0 ? '+' : '−'}${Math.abs(S.Q.v).toFixed(1)} mm`, 'm1'),
        P('p', 'MEP', `${((A.f.mep + A.r.mep) / 2 * 100).toFixed(0)} % of boiler`, 'm4')];
    };
    const parts = re => Object.values(S.cur.B.parts).filter(q => re.test(q.id)).map(q => q.holder);
    const all = () => Object.values(S.cur.B.parts).filter(q => q.info !== 'track').map(q => q.holder);
    const gearParts = () => parts(/^(retC|ecc|link|die|radius|lever|union|xh|weigh|lift)$/);
    const valveParts = () => parts(/^(cyl|chest|valve|piston|steam|ports)$/);
    const sub = () => `${$('revV').textContent} · cut-off ${pc(S.A.cut)}`;
    const STEPS = [
      { view: 'three', lab: () => ({ title: 'Steam locomotive', sub: `Walschaerts valve gear · ${sub()}`, params: params(), tex: TEX, eq: EQ, anchor: () => plateAnchor(all()) }) },
      { view: 'gear', lab: () => ({ title: 'Walschaerts valve gear', sub: 'The link adds the quarter-turn motion; the crosshead adds lap and lead', params: params(), tex: TEX, eq: EQ, anchor: () => plateAnchor(gearParts()) }) },
      { view: 'valve', lab: () => ({ title: 'Piston valve and cylinder', sub: 'Steam between the valve heads; exhaust at the ends', params: params(), tex: TEX, eq: EQ, anchor: () => plateAnchor(valveParts()) }) },
      { view: 'exploded', still: true, lab: () => ({ title: 'Exploded view', sub: 'Walschaerts valve gear', params: params(), tex: TEX, eq: EQ, anchor: () => plateAnchor(all()) }) },
    ];
    STEPS.forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, prefer: ['link', 'lever', 'valve', 'die', 'crosshead', 'retcrank', 'radius', 'piston'], skip: ['body', 'track', 'frame', 'steam', 'ports', 'reach', 'cylinder', 'chest', 'coupling'], azRange: [-65, 65] });
    const focusStep = info => ({ focus: info, still: true, lab: () => { const t = tour.plate(info, sub()); return { ...t, anchor: () => plateAnchor(t.meshes) }; } });
    // the engine reads from its valve gear side: no view from above
    const MOVES = ['push', 'pull', 'orbit', 'truck', 'crane', 'graze'];
    const REVS = [1, 0.75, 0.5, 0.3, -0.6, -1];
    let plan = [], revs = [];
    const makePlan = () => {
      tour.unit();
      if (!revs.length) { revs = REVS.slice(); for (let i = revs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [revs[i], revs[j]] = [revs[j], revs[i]]; } }
      setRev(revs.pop());
      const mid = [STEPS[1], STEPS[2]]; if (rnd() < 0.5) mid.reverse();
      plan = [STEPS[0], ...mid, STEPS[3], ...tour.pick(3).map(focusStep)];
    };
    const show = s => {
      setRpm(s.still ? 0 : RPM);
      if (s.focus) tour.show(s.focus);
      else {
        // a forced move equal to the last one falls back to any move (top
        // too) in mech-tour, so pick from the moves other than the last
        const lastMove = tour.log.length ? tour.log[tour.log.length - 1].move : null, pool = MOVES.filter(m => m !== lastMove);
        tour.clear(); setView(s.view, true); tour.fromFly({ kind: 'view', exploded: s.view === 'exploded', move: pool[Math.floor(rnd() * pool.length)] });
      }
      const l = s.lab(); lastLab = JSON.stringify(l); label(l);
    };
    let n = 0, stepT = 0, lastLab = '', labT = 0, now = null;
    const advance = () => {
      if (n === 0 || n >= plan.length) { tour.clear(); setExplode(0); makePlan(); n = 0; }
      stepT = 0; now = plan[n++]; show(now);
    };
    window.__mechTour = tour;
    let bandFn = null, bandT = 0;
    import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => { /* no band */ });
    saverTick = dt => {
      if (bandFn && (bandT += dt) > 0.5) { bandT = 0; try { saverBand = bandFn($('view').clientHeight); } catch (e) { saverBand = null; } }
      tour.tick(dt);
      stepT += dt * 1000; labT += dt;
      if (stepT >= hold && now) advance();
      if (labT > 1 && now) { labT = 0; const l = now.lab(), js = JSON.stringify(l); if (js !== lastLab) { lastLab = js; label(l); } }
    };
    advance();
    return { canvas, warmupMs: 1500 };
  },
};
