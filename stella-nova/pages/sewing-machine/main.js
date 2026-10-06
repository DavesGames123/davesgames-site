// ============================================================================
//  LOCKSTITCH SEWING MACHINE  ·  main.js — run, panels, plot, loop, saver
// ----------------------------------------------------------------------------
//  Shows one lockstitch machine: mech.js for the cycle, scene.js for its 3D
//  parts (kit.js), stage.js for the renderer and the camera, cards.js for
//  the part cards and labels. A copy of the linkages main.js with the
//  machine text, the timing plot and the saver steps. The picker sets the
//  stitch length, not the unit.
//
//  MOTION
//    One angle drives everything: S.th, the main shaft angle (rad, not
//    wrapped). Each frame adds rpm / 60 * 2 pi * dt. S.travel, the cloth
//    travel, adds the change of mech.js feed().travel over that step, so a
//    new stitch length takes effect without a jump.
//
//  GREP MAP
//    function boot / setStitch .. build the machine, pick a stitch length
//    const INFO / ABOUT ......... the panel text
//    const VIEWS / function setView  camera presets
//    function curves / drawPlot . the timing plot over one shaft turn
//    function phase ............. the step of the stitch now
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, pose, explode, stage, cards, plot
//    window.snSaver ............. screensaver hook: a seeded tour of views,
//                                 part close-ups and stitch lengths
// ============================================================================
import * as THREE from 'three';
import { M, PRESETS, pose, feed, thC, thCast, TAU, DEG, POINT_TDC, POINT_BDC } from './mech.js';
import { createBuild, ease } from './kit.js';
import { build } from './scene.js';
import { createStage } from './stage.js';
import { createCards, esc } from './cards.js';
import { PARTS, GROUP_COLOR } from './parts.js';
import { createTour } from '../../lib/mech-tour.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const W = th => ((th % TAU) + TAU) % TAU;

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], band: () => saverBand, coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, th: 0.4, rpm: 30, lastRpm: 30, Q: null, view: 'three', L: 2.5, travel: 0,
  explode: 0, explodeTarget: 0, base: true, thread: true, showLabels: !PHONE_Q.matches,
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

// ── build ───────────────────────────────────────────────────────────────────
function boot() {
  const B = createBuild(), sc = build(B);
  S.cur = { id: 'machine', B, sc, PARTS, alpha: 0, t0: performance.now() };
  B.setAlpha(0.001);
  B.setSection(false);
  S.Q = sc.pose(S.th, S.L, S.travel, S.thread);
  stage.root.add(B.root);
  fillPanel();
  stage.setShadowExtent(sc.box.R, new THREE.Vector3(...sc.box.c));
  stage.controls.minDistance = 40; stage.controls.maxDistance = sc.box.R * 8;
}
function setStitch(L) {
  S.L = L;
  document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', +b.dataset.l === L));
  if (!saverOn) try { history.replaceState(null, '', '#' + PRESETS.findIndex(p => p.L === L)); } catch (e) { /* file: */ }
  plotCache = null; lastNums = '';
}

// ── panel content ───────────────────────────────────────────────────────────
const INFO = { title: 'Lockstitch sewing machine', kind: 'Rotary hook · four-motion feed', lede: 'One turn of the handwheel makes one stitch. The needle takes the thread through the cloth, a rotary hook catches a loop of it below and passes it round the bobbin, and the take-up lever pulls the two threads into a lock in the middle of the cloth. Then the feed dog moves the cloth on by one stitch length.' };
const ABOUT = [
  ['The catch', `As the needle rises from the bottom, the thread behind it cannot follow at once: it bulges into a small loop by the scarf. The hook beak passes the needle there, ${M.RISE} mm above the lowest point and about 1.6 mm above the eye, and takes the loop.`],
  ['Round the bobbin', 'The hook turns twice per stitch. In the first turn it spreads the loop round the stationary bobbin case, so the bobbin thread is now inside the loop. The second turn passes the needle while the eye is high: there is nothing to catch.'],
  ['The take-up lever', 'While the hook needs thread, the lever is at the bottom of its stroke and gives slack. When the loop slips off the case, the lever rises fast, pulls the loop up through the cloth and sets the stitch, drawing new thread through the tension discs.'],
  ['Four-motion feed', 'Two eccentrics move the feed dog up, back, down and forward. The teeth are above the plate only while the needle is out of the cloth, so the cloth never moves with the needle in it. The stitch regulator sets the push, and reverses it.'],
  ['History', 'Walter Hunt (1834) and Elias Howe (1846) made the first lockstitch machines with a shuttle. Allen B. Wilson invented the rotary hook in 1851; Isaac Singer added the up-and-down needle bar and the presser foot.'],
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
function buildPicker() {
  $('variants').innerHTML = PRESETS.map(v => `<button class="mv" type="button" data-l="${v.L}"><b>${esc(v.name)}</b><span>${esc(v.kind)}</span></button>`).join('');
  $('variants').querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => setStitch(+b.dataset.l)));
}

// ── views ───────────────────────────────────────────────────────────────────
const VIEWS = {
  three: { az: 28, el: 12, explode: 0, k: 1, at: null },
  close: { az: 34, el: 16, explode: 0, k: 0.2, at: 'feed' },
  head: { az: -64, el: 10, explode: 0, k: 0.36, at: 'takeup' },
  hook: { az: -56, el: -6, explode: 0, k: 0.15, at: 'hook' },
  exploded: { az: 40, el: 16, explode: 1, k: 1.15, at: null },
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
  const at = v.at ? S.cur.sc.keys[v.at] : S.cur.sc.box.c;
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
  r = Math.max(0, Math.min(240, r));
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
  advanceTo(base + want);
});
function setShow(what, on) {
  if (what === 'base') { S.base = on; $('tBase').classList.toggle('on', on); if (S.cur) S.cur.B.parts.base.holder.visible = on; }
  if (what === 'thread') { S.thread = on; $('tThread').classList.toggle('on', on); }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
}
$('tBase').addEventListener('click', () => setShow('base', !S.base));
$('tThread').addEventListener('click', () => setShow('thread', !S.thread));
$('tLabels').addEventListener('click', () => setShow('labels', !S.showLabels));
$('tOrbit').addEventListener('click', () => setShow('orbit', !stage.orbit));

// move the shaft to th and carry the cloth by the feed over that step
function advanceTo(th) {
  S.travel += feed(th, S.L).travel - feed(S.th, S.L).travel;
  S.th = th;
}

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

// ── timing plot ─────────────────────────────────────────────────────────────
// Over one shaft turn, each series scaled into the plot height: the needle
// point (-12 .. +20 mm), the take-up eye (its own travel) and the hook
// angle (0 .. 360 deg, two ramps per turn). Marks: the loop catch and the
// cast-off; a band where the feed teeth are above the plate.
const COL = { n: '#8fb0ff', t: '#e9a0a8', h: '#c8a6ff', c: '#ffe0a0', f: 'rgba(159,214,176,0.12)' };
function curves() {
  const N = 360, out = { n: [], t: [], h: [], feed: [] };
  let t0 = Infinity, t1 = -Infinity;
  for (let i = 0; i <= N; i++) {
    const Q = pose(i / N * TAU, S.L);
    out.n.push((Q.N.point - POINT_BDC) / (POINT_TDC - POINT_BDC)); out.t.push(Q.takeY); out.h.push(W(Q.K.psi) / TAU); out.feed.push(Q.F.engaged);
    t0 = Math.min(t0, Q.takeY); t1 = Math.max(t1, Q.takeY);
  }
  out.t = out.t.map(v => (v - t0) / (t1 - t0));
  return out;
}
function drawPlot() {
  const c = $('plot'), r = c.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; plotCache = null; }
  const g = c.getContext('2d');
  if (!plotCache) {
    const C = curves(), off = document.createElement('canvas'); off.width = w; off.height = h;
    const o = off.getContext('2d'), pad = 10 * dpr, X = deg => pad + (w - 2 * pad) * deg / 360, Y = v => h - pad - 12 * dpr - v * (h - 2 * pad - 14 * dpr);
    // feed band
    o.fillStyle = COL.f;
    C.feed.forEach((on, i) => { if (on) o.fillRect(X(i), pad, X(1) - X(0) + 0.5, h - 2 * pad); });
    o.strokeStyle = 'rgba(217,179,106,0.12)'; o.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const x = X(k * 90); o.beginPath(); o.moveTo(x, pad); o.lineTo(x, h - pad); o.stroke(); }
    // plate level for the needle
    const yPlate = Y((0 - POINT_BDC) / (POINT_TDC - POINT_BDC));
    o.setLineDash([3 * dpr, 3 * dpr]); o.beginPath(); o.moveTo(pad, yPlate); o.lineTo(w - pad, yPlate); o.stroke(); o.setLineDash([]);
    const line = (arr, col, jump) => {
      o.strokeStyle = col; o.lineWidth = 1.6 * dpr; o.beginPath();
      arr.forEach((v, i) => { const x = X(i), y = Y(v); if (!i || (jump && Math.abs(v - arr[i - 1]) > 0.5)) o.moveTo(x, y); else o.lineTo(x, y); });
      o.stroke();
    };
    line(C.h, COL.h, true); line(C.t, COL.t); line(C.n, COL.n);
    // catch and cast-off marks
    o.font = `${10 * dpr}px ui-monospace,Menlo,monospace`;
    for (const [a, t] of [[thC, 'catch'], [W(thCast), 'loop off']]) {
      const x = X(a * DEG); o.strokeStyle = COL.c; o.lineWidth = 1.2 * dpr; o.setLineDash([4 * dpr, 3 * dpr]);
      o.beginPath(); o.moveTo(x, pad); o.lineTo(x, h - pad - 12 * dpr); o.stroke(); o.setLineDash([]);
      o.fillStyle = COL.c; o.fillText(t, Math.min(x + 3 * dpr, w - pad - o.measureText(t).width), pad + 9 * dpr);
    }
    o.fillStyle = 'rgba(141,144,166,0.9)';
    ['0°', '90°', '180°', '270°'].forEach((t, k) => o.fillText(t, X(k * 90) + 3 * dpr, h - pad - 1 * dpr));
    $('legend').innerHTML = [['ln', 'needle point'], ['lt', 'take-up eye'], ['lh', 'hook angle'], ['lf', 'feed teeth up']].map(([k, t]) => `<span class="${k}"><i></i>${t}</span>`).join('');
    plotCache = { off, X };
  }
  g.clearRect(0, 0, w, h); g.drawImage(plotCache.off, 0, 0);
  const x = plotCache.X(W(S.th) * DEG);
  g.strokeStyle = 'rgba(255,224,170,0.85)'; g.lineWidth = 1.2 * dpr; g.beginPath(); g.moveTo(x, 4 * dpr); g.lineTo(x, h - 4 * dpr); g.stroke();
}

// ── the step of the stitch now ──────────────────────────────────────────────
function phase(Q) {
  const a = W(Q.th), psi = Q.K.psi * DEG;
  if (Q.K.caught && psi < 40) return ['Catch', 'The hook beak takes the loop beside the needle.'];
  if (Q.K.caught) return ['Round the bobbin', `The hook carries the loop round the bobbin case (hook ${psi.toFixed(0)}°).`];
  if (Q.F.engaged && Math.abs(S.L) > 0.05) return ['Feed', `The dog moves the cloth ${Math.abs(S.L)} mm ${S.L < 0 ? 'toward you' : 'away from you'}.`];
  if (a > W(thCast) || a < 0.6) return ['Set the stitch', 'The take-up lever pulls the loop up and locks the threads.'];
  if (Q.N.point > M.FABRIC) return ['Needle down', 'The needle goes down with the thread in its long groove.'];
  return ['In the cloth', 'The needle passes the cloth and the plate to the bottom of its stroke.'];
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
let lastNums = '';
function fillNums() {
  const Q = S.Q, f = v => v.toFixed(1);
  let html = `<tr><th>At ${(W(S.th) * DEG).toFixed(0)}° of the shaft</th><th></th></tr>`;
  html += row('Needle point', `${f(Q.N.point)} mm`) + row('Take-up eye', `${f(Q.takeY - M.H)} mm above the shaft`) + row('Hook angle ψ', `${(W(Q.K.psi) * DEG).toFixed(0)}°${Q.K.psi >= TAU ? ' (idle turn)' : ''}`);
  html += row('Thread, discs to eye', `${f(Q.P.upper)} mm`) + row('Loop on the hook', Q.K.caught ? `${f(Q.P.loop)} mm` : '—');
  html += row('Feed teeth', `${Q.F.top >= 0 ? '+' : ''}${Q.F.top.toFixed(2)} mm`) + row('Stitch length', `${S.L} mm`) + row('Stitches made', `${Math.max(0, Math.floor((S.th - Math.PI) / TAU) + 1)}`);
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
  const [b, t] = phase(Q);
  const now = `<b>${b}</b><span>${t}</span>`;
  if ($('now').innerHTML !== now) $('now').innerHTML = now;
}
function fillEqs() {
  const E = [
    ['Needle', 'y = a cos θ − √(l² − a² sin² θ) + c', 'crank-slider, stroke 2a = 32 mm'],
    ['Hook', 'ψ = 2 (θ − θc)', `catch θc = ${(thC * DEG).toFixed(1)}°, ${M.RISE} mm past the bottom`],
    ['Take-up', '|B − A| = b,  |B − C| = c', 'the eye is a coupler point'],
    ['Feed', 'teeth up while |θ| < acos(drop / lift)', `${(M.thE * DEG).toFixed(0)}°: the needle is out`],
  ];
  $('eqs').innerHTML = E.map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  if (!S.Q || !S.cur) return [key, '—'];
  const Q = S.Q;
  switch (key) {
    case 'shaft': return ['Shaft', `${S.rpm} rpm · ${(W(S.th) * DEG).toFixed(0)}°`];
    case 'needle': return ['Needle point', `${Q.N.point.toFixed(1)} mm`];
    case 'takeup': return ['Eye height', `${(Q.takeY - M.H).toFixed(1)} mm`];
    case 'hook': return ['Hook', `${(W(Q.K.psi) * DEG).toFixed(0)}° · ${Q.K.caught ? 'loop on' : 'free'}`];
    case 'feed': return ['Teeth', `${Q.F.top.toFixed(2)} mm · cloth ${S.travel.toFixed(1)} mm`];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const Q = S.Q;
  $('read').innerHTML = `<span class="hi">${esc(phase(Q)[0])}</span><br><span class="lo">θ ${(W(S.th) * DEG).toFixed(0)}° · needle ${Q.N.point.toFixed(1)} mm · hook ${(W(Q.K.psi) * DEG).toFixed(0)}°</span>`;
  $('turnV').textContent = `${(W(S.th) * DEG).toFixed(0)}°`;
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true, numT = 0;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur) return;
  const cur = S.cur;
  advanceTo(S.th + S.rpm / 60 * TAU * dt);
  S.explode += (S.explodeTarget - S.explode) * Math.min(1, dt * S.ekRate);
  S.Q = cur.sc.pose(S.th, S.L, S.travel, S.thread && S.explode < 0.04);
  cur.B.applyExplode(S.explode);
  const age = (now - cur.t0) / 1000, al = REDUCED ? 1 : ease((age - 0.1) / 0.9);
  if (al !== cur.alpha) { cur.alpha = al; cur.B.setAlpha(Math.max(0.001, al)); }
  stage.frame(dt);
  cards.frame(now, dt);
  if (!saverOn) {
    readout();
    if ((numT += dt) > 0.15) { numT = 0; fillNums(); }
    drawPlot();
  } else if (saverTick) saverTick(dt);
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });
window.__sewing = { S, stage, cards, setView, setRpm, setExplode, setShow, setOpen, setAna, setStitch, advanceTo };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
setRpm(30); setExplode(0);
stage.place({ az: -30, el: 18, r: 2000, target: new THREE.Vector3(10, 96, 0) });
boot();
{ const i = parseInt((location.hash || '').slice(1), 10); setStitch(PRESETS[i] ? PRESETS[i].L : 2.5); }
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
// the machine in rounds. Each round picks a stitch length (seeded) and
// shows, in a seeded order, the whole machine, the needle and feed, the
// head from its end, the hook from below the bed, the exploded machine and
// close-ups of 3 parts (lib/mech-tour.js). Each step holds seconds/10 (at
// least 5 s). calm (1 = slowest) slows the shaft, not the step time.
// opts.label names each step with the relations and live values. No exit():
// the shell reloads the page.
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
    // a slow shaft: at 12-30 rpm the eye can follow the hook and the loop
    const RPM = Math.round(30 - 18 * calm);
    setRpm(RPM);
    const hold = Math.max(5, (o.seconds || 60) / 10) * 1000;
    const canvas = $('view');
    const RULES = [['\\theta', 'm1'], ['y_n', 'm2'], ['\\psi', 'm3'], ['L', 'm4'], ['\\ell', 'm5']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const TEX = [String.raw`y_n = a\cos\theta - \sqrt{l^2 - a^2\sin^2\theta}`, String.raw`\psi = 2\,(\theta - \theta_c),\quad \theta_c = ${(thC * DEG).toFixed(1)}^\circ`];
    const EQ = ['y = a cos θ − √(l² − a² sin² θ)', `ψ = 2 (θ − θc), θc = ${(thC * DEG).toFixed(1)}°`];
    const params = () => {
      const Q = S.Q; if (!Q) return [];
      return [P('\\theta', 'shaft', `${(W(S.th) * DEG).toFixed(0)}°`, 'm1'), P('y_n', 'needle point', `${Q.N.point.toFixed(1)} mm`, 'm2'),
        P('\\psi', 'hook', `${(W(Q.K.psi) * DEG).toFixed(0)}°`, 'm3'), P('\\ell', Q.K.caught ? 'loop on the hook' : 'thread to the eye', `${(Q.K.caught ? Q.P.loop : Q.P.upper).toFixed(1)} mm`, 'm5'), P('L', 'stitch', `${S.L} mm`, 'm4')];
    };
    const lab = (title, sub, objs) => () => ({ title, sub: typeof sub === 'function' ? sub() : sub, params: params(), tex: TEX, eq: EQ, rules: RULES, anchor: () => plateAnchor(objs()) });
    const by = re => () => Object.values(S.cur.B.parts).filter(q => re.test(q.id)).map(q => q.holder);
    const all = by(/^(?!base$)/);
    const STEPS = {
      three: { view: 'three', lab: lab(INFO.title, () => `${PRESETS.find(p => p.L === S.L).kind} · ${phase(S.Q)[0]}`, all) },
      close: { view: 'close', moves: ['push', 'pull', 'orbit', 'truck', 'graze', 'crane'], lab: lab('Needle, foot and feed dog', () => phase(S.Q)[1], by(/^(needle|needlebar|presser|feeddog|plate|cloth)$/)) },
      head: { view: 'head', moves: ['push', 'pull', 'orbit', 'truck', 'graze'], lab: lab('The head from its end', 'Needle crank, take-up lever and its link', by(/^(crank|link|takeup|tulink|needlebar)$/)) },
      hook: { view: 'hook', moves: ['push', 'pull', 'orbit', 'truck'], lab: lab('The rotary hook', () => (S.Q.K.caught ? 'The beak carries the loop round the bobbin case' : 'Two hook turns for each stitch'), by(/^(hook|bobbin)$/)) },
      exploded: { view: 'exploded', still: true, lab: lab('Exploded view', INFO.kind, all) },
    };
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, prefer: ['hook', 'takeup', 'feeddog', 'needlebar', 'bobbin', 'crank', 'tension'], skip: ['base', 'thread', 'cloth', 'plate', 'spool'], azRange: [-110, 80] });
    const focusStep = info => ({ focus: info, still: true, lab: () => { const t = tour.plate(info, INFO.title); return { ...t, anchor: () => plateAnchor(t.meshes) }; } });
    const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    let plan = [];
    // the whole machine first, then the working views in a seeded order,
    // the exploded view and three part close-ups
    const makePlan = () => { tour.unit(); plan = [STEPS.three, ...shuf([STEPS.close, STEPS.head, STEPS.hook]), STEPS.exploded, ...tour.pick(3).map(focusStep)]; };
    const show = s => {
      setRpm(s.still ? 0 : RPM);
      if (s.focus) tour.show(s.focus);
      // the hook sits under the bed and the head is seen from its end: a
      // top, crane or graze move would put the bed or the arm in the way
      else { tour.clear(); setView(s.view, true); tour.fromFly({ kind: 'view', exploded: s.view === 'exploded', move: pickMove(s.moves) }); }
      const l = s.lab(); lastLab = JSON.stringify(l); label(l);
    };
    // a move from the step's list that is not the last move (mech-tour
    // ignores a forced move equal to the last one and picks any move)
    const pickMove = list => {
      if (!list) return undefined;
      const lastM = tour.log.length ? tour.log[tour.log.length - 1].move : null, ok = list.filter(m => m !== lastM);
      return ok[Math.floor(rnd() * ok.length)];
    };
    const order = shuf(PRESETS.filter(p => p.L !== 0).map(p => p.L));
    const fadeSwap = async (L, then) => {
      canvas.style.opacity = '0';
      await new Promise(r => setTimeout(r, 950));
      setExplode(0); S.explode = 0;
      setStitch(L);
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
      if (stepT >= hold && now) { stepT = 0; advance(); }
      if (labT > 1 && now) { labT = 0; const l = now.lab(), js = JSON.stringify(l); if (js !== lastLab) { lastLab = js; label(l); } }
    };
    setStitch(order[0]);
    advance();
    return { canvas, warmupMs: 1500 };
  },
};
