// ============================================================================
//  LINKAGES  ·  main.js — unit swap, run, panels, plot, loop, saver
// ----------------------------------------------------------------------------
//  Shows one linkage at a time: mech.js for the joints, scene.js for its 3D
//  parts (kit.js), stage.js for the renderer and the camera, cards.js for
//  the part cards and labels. A copy of the geneva-cams main.js with the
//  linkage text, plot and saver steps.
//
//  MOTION
//    One angle drives everything: S.th, the input angle (rad). Each frame
//    adds rpm / 60 * 2 pi * dt. sc.pose(S.th) places every link and returns
//    the joints (Q.J), the input angle and the output value.
//
//  GREP MAP
//    function swapTo ............ build a unit and cross-fade to it
//    const INFO / ABOUT ......... the panel text of each unit
//    const VIEWS / function setView  camera presets
//    function curves / drawPlot . the motion plot over one input turn
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, pose, explode, stage, cards, plot
//    window.snSaver ............. screensaver hook: a tour of each unit,
//                                 face on (azRange -55..55, flat moves)
// ============================================================================
import * as THREE from 'three';
import { UNITS, unit, makeLinkage, TAU } from './mech.js';
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
  cur: null, leaving: [], th: 0.3, rpm: 15, lastRpm: 15, Q: null, view: 'three',
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
    B.parts.base.holder.visible = S.base;
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
  fourbar: { title: 'Four-bar linkage', kind: 'Crank-rocker · coupler curve', lede: 'Four bars and four pins: the frame, a crank that turns all the way round, a coupler and a rocker that swings. A point fixed on the coupler draws a closed curve, the coupler curve. Machines use these curves for film claws, pumps and pick-and-place arms.' },
  peaucellier: { title: 'Peaucellier–Lipkin linkage', kind: 'Exact straight line · 1864', lede: 'Seven bars and only pin joints, and the point P moves on a true straight line. Watt had found only near-straight lines. The trick is an inversion: the long links and the rhombus keep OC · OP fixed, and that maps the circle of C onto a straight line.' },
  jansen: { title: 'Jansen walking leg', kind: 'Theo Jansen · Strandbeest', lede: 'One leg of a Strandbeest. A crank turns at a steady speed, and eleven bars turn that into a step: the foot runs flat along the ground, lifts, and swings back over it. Jansen found the bar lengths with an evolutionary search on a computer.' },
};
const ABOUT = {
  fourbar: [
    ['Grashof\'s rule', 'Let s be the shortest bar, l the longest, p and q the others. If s + l ≤ p + q, the shortest bar can turn all the way round. With the crank as the shortest bar, the linkage is a crank-rocker.'],
    ['Solving it', 'The crank fixes A. B must be b from A and c from the rocker pivot: two circles, two answers. The page keeps the answer nearest the last one, so the linkage never jumps to its mirror pose.'],
    ['Dead points', 'At the two ends of the rocker swing, crank and coupler are in line. The rocker stops and turns back there, while the crank keeps turning.'],
  ],
  peaucellier: [
    ['Inversion', 'O, C and P stay on one line, and OC · OP = L² − s² at every pose. That is inversion in a circle of radius √(L² − s²) about O.'],
    ['Why a line', 'Inversion maps a circle through the centre to a straight line. The input arm makes C run on such a circle, so P runs on a line, x = (L² − s²)/(2r).'],
    ['History', 'Charles-Nicolas Peaucellier found it in 1864, Lipmann Lipkin again in 1871. It answered a question that had stood since Watt: can pin joints alone draw a straight line?'],
  ],
  jansen: [
    ['The numbers', 'a 38, b 41.5, c 39.3, d 40.1, e 55.8, f 39.4, g 36.7, h 65.7, i 49, j 50, k 61.9, l 7.8, m 15. Jansen calls them the holy numbers.'],
    ['A flat stance', 'For about a third of the crank turn the foot moves along a nearly straight, level line: the body does not bob. Then the foot lifts and returns high, so it clears the ground.'],
    ['Many legs', 'A Strandbeest puts many legs on one crankshaft with their cranks spread out, so some feet are always on the ground.'],
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
  three: { az: 24, el: 14, explode: 0, k: 1, at: null },
  close: { az: 34, el: 18, explode: 0, k: 0.55, at: 'trace' },
  front: { az: 0, el: 0, explode: 0, k: 0.95, at: null },
  side: { az: 62, el: 10, explode: 0, k: 0.9, at: null },
  exploded: { az: 40, el: 18, explode: 1, k: 1.3, at: null },
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
  // the box centre, or the traced point
  const c = S.cur.sc.box.c, at = v.at === 'trace' ? S.cur.sc.keys.trace : c;
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
  if (what === 'base') { S.base = on; $('tBase').classList.toggle('on', on); for (const o of [S.cur, ...S.leaving]) if (o) o.B.parts.base.holder.visible = on; }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
}
$('tBase').addEventListener('click', () => setShow('base', !S.base));
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

// ── motion analysis ─────────────────────────────────────────────────────────
// Over one input turn: the output value (o) and a second series (w), each
// scaled to its peak. four-bar: rocker angle and coupler point speed;
// Peaucellier: P height and P's distance from the line (it is zero);
// Jansen: foot height and foot speed along the ground.
const COL = { o: '#e2c27a', w: '#8fb0ff', a: '#e9a0a8' };
function curves() {
  const id = S.cur.id, L = makeLinkage(unit(id)), N = 360, out = { o: [], w: [], a: [] }, Ps = [];
  for (let i = 0; i <= N; i++) Ps.push(L.pose(i / N * TAU));
  const T = q => q.J[L.trace], d = i => { const a = T(Ps[Math.max(0, i - 1)]), b = T(Ps[Math.min(N, i + 1)]); return [(b[0] - a[0]), (b[1] - a[1])]; };
  if (id === 'fourbar') {
    const lo = Math.min(...Ps.map(q => q.out));
    out.o = Ps.map(q => (q.out - lo) * 180 / Math.PI); out.w = Ps.map((q, i) => Math.hypot(...d(i)));
    out.lab = [['lo', 'rocker angle'], ['lw', 'coupler point speed']]; out.wBase = true;
  } else if (id === 'peaucellier') {
    out.o = Ps.map(q => q.J.P[1]); out.w = Ps.map(q => q.J.P[0] - L.line);
    out.lab = [['lo', 'height of P'], ['lw', 'P off the line (× 10⁹)']]; out.oBase = false; out.wScale = 1e9;
  } else {
    const lo = Math.min(...Ps.map(q => q.J.G[1]));
    out.o = Ps.map(q => q.J.G[1] - lo); out.w = Ps.map((q, i) => d(i)[0]);
    out.lab = [['lo', 'foot height'], ['lw', 'foot speed along the ground']];
  }
  out.oMax = Math.max(...out.o.map(Math.abs)) || 1; out.wMax = Math.max(...out.w.map(Math.abs)) || 1;
  if (out.oBase === undefined) out.oBase = true;
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
    const o = off.getContext('2d'), pad = 10 * dpr, X = i => pad + (w - 2 * pad) * i / 360, mid = h / 2, Hh = h / 2 - pad;
    o.strokeStyle = 'rgba(217,179,106,0.12)'; o.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const x = X(k * 90); o.beginPath(); o.moveTo(x, pad); o.lineTo(x, h - pad); o.stroke(); }
    o.beginPath(); o.moveTo(pad, mid); o.lineTo(w - pad, mid); o.stroke();
    const line = (arr, max, col, base) => {
      o.strokeStyle = col; o.lineWidth = 1.6 * dpr; o.beginPath();
      arr.forEach((v, i) => { const y = base ? h - pad - (v / max) * (h - 2 * pad) : mid - (v / max) * Hh; i ? o.lineTo(X(i), y) : o.moveTo(X(i), y); });
      o.stroke();
    };
    line(C.o, C.oMax, COL.o, C.oBase);
    // P off the line is zero: draw it at the true scale, not at its peak
    line(C.w, C.wScale ? 1 / C.wScale * 1 : C.wMax, COL.w, !!C.wBase);
    o.fillStyle = 'rgba(141,144,166,0.9)'; o.font = `${10 * dpr}px ui-monospace,Menlo,monospace`;
    ['0°', '90°', '180°', '270°'].forEach((t, k) => o.fillText(t, X(k * 90) + 3 * dpr, h - pad - 3 * dpr));
    $('legend').innerHTML = C.lab.map(([k, t]) => `<span class="${k}"><i></i>${t}</span>`).join('');
    plotCache = { off, X, C };
  }
  g.clearRect(0, 0, w, h); g.drawImage(plotCache.off, 0, 0);
  const ph = ((S.th % TAU) + TAU) % TAU * DEG, x = plotCache.X(ph);
  g.strokeStyle = 'rgba(255,224,170,0.85)'; g.lineWidth = 1.2 * dpr; g.beginPath(); g.moveTo(x, 4 * dpr); g.lineTo(x, h - 4 * dpr); g.stroke();
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
let lastNums = '';
function fillNums() {
  const id = S.cur.id, u = unit(id), Q = S.Q, ph = (((S.th % TAU) + TAU) % TAU) * DEG, f = v => v.toFixed(1);
  let html = `<tr><th>${INFO[id].title}</th><th></th></tr>` + row('Input angle θ', `${ph.toFixed(1)}°`);
  if (id === 'fourbar') {
    html += row('Rocker angle', `${(Q.out * DEG).toFixed(1)}°`) + row('Coupler point', `${f(Q.J.P[0])}, ${f(Q.J.P[1])} mm`) + row('Links a b c d', `${u.a} ${u.b} ${u.c} ${u.d}`) + row('s + l vs p + q', `${u.a + u.b} ≤ ${u.c + u.d}`);
    $('now').innerHTML = `<b>Crank-rocker</b><span>The crank turns round; the rocker swings.</span>`;
  } else if (id === 'peaucellier') {
    const k = u.L * u.L - u.s * u.s, oc = Math.hypot(...Q.J.C), op = Math.hypot(...Q.J.P);
    html += row('Arm swing φ', `${(Q.input * DEG).toFixed(1)}°`) + row('OC', `${f(oc)} mm`) + row('OP', `${f(op)} mm`) + row('OC · OP', `${(oc * op).toFixed(1)}`) + row('L² − s²', `${k}`) + row('P.x − line', `${(Q.J.P[0] - (k / (2 * u.r))).toExponential(1)} mm`);
    $('now').innerHTML = `<b>On the line</b><span>P stays on x = ${(k / (2 * u.r)).toFixed(0)} mm.</span>`;
  } else {
    const G = Q.J.G, stance = G[1] < S.cur.sc.stanceY;
    html += row('Foot', `${f(G[0])}, ${f(G[1])} mm`) + row('Phase', stance ? 'stance (on the ground)' : 'swing (lifted)') + row('Scale', `× ${u.k}`);
    $('now').innerHTML = `<b>${stance ? 'Stance' : 'Swing'}</b><span>${stance ? 'The foot runs flat along the ground.' : 'The foot lifts and swings forward.'}</span>`;
  }
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
}
function fillEqs() {
  const id = S.cur.id;
  const E = {
    fourbar: [['Grashof', 's + l ≤ p + q', 'the shortest bar turns fully'], ['Joint B', '|B − A| = b,  |B − O₄| = c', 'two circles meet'], ['Coupler point', 'P = A + u ê + v n̂', 'fixed on the coupler']],
    peaucellier: [['Inversion', 'OC · OP = L² − s²', 'at every pose'], ['Input circle', '|C − O₁| = r = |O₁ − O|', 'C runs on a circle through O'], ['The line', 'x = (L² − s²) / (2r)', 'the image of that circle']],
    jansen: [['Joints', 'each joint = two circles meeting', 'eleven bars, one crank'], ['Foot', 'G from F (h) and D (i)', 'the lowest joint'], ['Step', 'one crank turn = one step', 'stance about 1/3 of the turn']],
  }[id];
  $('eqs').innerHTML = E.map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  if (!S.Q || !S.cur) return [key, '—'];
  const Q = S.Q, T = Q.J[S.cur.sc.L.trace];
  switch (key) {
    case 'input': return ['Input', `${S.rpm} rpm · ${((((S.th % TAU) + TAU) % TAU) * DEG).toFixed(0)}°`];
    case 'out': return ['Rocker angle', `${(Q.out * DEG).toFixed(1)}°`];
    case 'trace': return ['Traced point', `${T[0].toFixed(1)}, ${T[1].toFixed(1)} mm`];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const T = S.Q.J[S.cur.sc.L.trace];
  $('read').innerHTML = `<span class="hi">${esc(INFO[S.cur.id].title)}</span><br><span class="lo">θ ${((((S.th % TAU) + TAU) % TAU) * DEG).toFixed(0)}° · ${S.cur.sc.L.trace} ${T[0].toFixed(1)}, ${T[1].toFixed(1)} mm</span>`;
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
window.__linkages = { S, stage, cards, swapTo, setView, setRpm, setExplode, setShow, setOpen, setAna };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
setRpm(15); setExplode(0);
stage.place({ az: -50, el: 20, r: 1800, target: new THREE.Vector3(0, 0, 40) });
const start = (location.hash || '').slice(1);
swapTo(UNITS.some(v => v.id === start) ? start : 'fourbar');
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
    const RPM = Math.round(20 - 10 * calm);
    setRpm(RPM);
    const hold = Math.max(5, (o.seconds || 60) / 10) * 1000;
    const order = UNITS.map(u => u.id), first = Math.floor(rnd() * order.length);
    const canvas = $('view');
    const RULES = [['\\theta', 'm1'], ['P', 'm2'], ['G', 'm2'], ['L', 'm3'], ['s', 'm4'], ['r', 'm5']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const QQ = () => S.Q;
    const TEX = {
      fourbar: [String.raw`s + l \le p + q`, String.raw`|B-A| = b,\quad |B-O_4| = c`],
      peaucellier: [String.raw`OC\cdot OP = L^2 - s^2`, String.raw`x_P = \frac{L^2 - s^2}{2r}`],
      jansen: [String.raw`|G-F| = h,\quad |G-D| = i`, String.raw`\text{one crank turn} = \text{one step}`],
    };
    const EQ = { fourbar: ['s + l ≤ p + q'], peaucellier: ['OC · OP = L² − s²', 'x_P = (L² − s²)/(2r)'], jansen: ['one crank turn = one step'] };
    const tex = () => TEX[S.cur.id], eq = () => EQ[S.cur.id];
    const params = () => {
      const Q = QQ(); if (!Q) return [];
      const T = Q.J[S.cur.sc.L.trace], ph = ((((S.th % TAU) + TAU) % TAU) * DEG).toFixed(0) + '°';
      const out = [P('\\theta', 'input angle', ph, 'm1'), P(S.cur.sc.L.trace, 'traced point', `${T[0].toFixed(1)}, ${T[1].toFixed(1)} mm`, 'm2')];
      if (S.cur.id === 'peaucellier') out.push(P('x_P - x', 'off the line', `${(T[0] - S.cur.sc.L.line).toExponential(1)} mm`, 'm4'));
      return out;
    };
    const all = () => Object.values(S.cur.B.parts).filter(q => q.info !== 'base').map(q => q.holder);
    const pair = () => Object.values(S.cur.B.parts).filter(q => /^(trace|pen|L_coupler|L_rhAP|L_rhBP|L_h|L_i)$/.test(q.id)).map(q => q.holder);
    const STEPS = [
      { view: 'three', lab: () => ({ title: INFO[S.cur.id].title, sub: INFO[S.cur.id].kind, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'close', lab: () => ({ title: S.cur.id === 'peaucellier' ? 'An exact straight line' : S.cur.id === 'jansen' ? 'The foot path' : 'The coupler curve', sub: INFO[S.cur.id].title, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(pair()) }) },
      { view: 'front', lab: () => ({ title: INFO[S.cur.id].title, sub: 'Face on: the plane of the linkage', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'exploded', still: true, lab: () => ({ title: 'Exploded view', sub: INFO[S.cur.id].title, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
    ];
    STEPS.forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, prefer: ['coupler', 'rocker', 'rhombus', 'long', 'foot', 'knee', 'crank'], skip: ['base', 'trace', 'pin'], azRange: [-55, 55] });
    // a planar linkage reads face on: no top, graze or crane moves
    const FLAT_MOVES = ['push', 'pull', 'orbit', 'truck'];
    let plan = [];
    // thin bars make poor close-ups: the tour stays on the whole linkage
    const makePlan = () => { tour.unit(); plan = [STEPS[0], STEPS[1], STEPS[2], STEPS[3]]; };
    const show = s => {
      setRpm(s.still ? 0 : RPM);
      if (s.focus) tour.show(s.focus);
      else { tour.clear(); setView(s.view, true); tour.fromFly({ kind: 'view', exploded: s.view === 'exploded', move: FLAT_MOVES[Math.floor(rnd() * FLAT_MOVES.length)] }); }
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
