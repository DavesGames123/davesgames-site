// ============================================================================
//  RATCHETS & FREEWHEELS  ·  main.js — unit swap, run, panels, plot, loop, saver
// ----------------------------------------------------------------------------
//  Shows one one-way clutch at a time: mech.js for the clutch model and the
//  outlines, scene.js for its 3D parts (kit.js), stage.js for the renderer
//  and the camera, cards.js for the part cards and labels. A copy of the
//  geneva-cams main.js with the clutch text, plot and saver steps.
//
//  MOTION
//    One number drives everything: S.th, the program time (rad, one cycle
//    of six strokes per 2 pi). Each frame adds cpm / 60 * 2 pi * dt.
//    sc.pose(S.th) steps the unit's clutch to the program input at S.th
//    and turns every part. The output only moves when the clutch drives.
//    The hand slider sets the place in the cycle and pauses the drive.
//
//  GREP MAP
//    function swapTo ............ build a unit and cross-fade to it
//    const INFO / ABOUT ......... the panel text of each unit
//    const VIEWS / function setView  camera presets
//    function drawPlot .......... output against input over one cycle
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, pose, explode, stage, cards, plot
//    window.snSaver ............. screensaver hook: a tour of each unit
// ============================================================================
import * as THREE from 'three';
import { UNITS, unit, TAU, STROKES, cycleCurve, lostMax, pawlGeo, spragGeo, strokeAt } from './mech.js';
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
  cur: null, leaving: [], th: 0.2, rpm: 5, lastRpm: 5, Q: null, view: 'three',
  explode: 0, explodeTarget: 0, base: true, showLabels: !PHONE_Q.matches, swapping: false,
  anaOpen: !PHONE_Q.matches, ekRate: 2.6,
};
let saverOn = false, saverTick = null, plotCache = null, saverBand = null;
const cards = createCards({
  stage, $, isPhone: () => PHONE_Q.matches,
  get: () => S.cur,
  live: key => liveValue(key),
  gauge: () => (S.Q ? S.Q.out : 0),
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
    stage.controls.minDistance = 90; stage.controls.maxDistance = sc.box.R * 8;
    document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    if (!saverOn) try { history.replaceState(null, '', '#' + id); } catch (e) { /* file: */ }
    if (!saverOn) setView(S.view || 'three', true);
    plotCache = null;
  } finally { S.swapping = false; }
}

// ── panel content ───────────────────────────────────────────────────────────
const INFO = {
  ratchet: { title: 'Ratchet and pawl', kind: '12 teeth · spring-loaded pawl', lede: 'The lever swings back and forth. On a forward stroke the pawl pushes a tooth face and the wheel turns with the lever; on a back stroke the pawl rides up the back slopes and clicks into the next tooth while a drag load holds the wheel. Before it drives again, the lever must take up the gap to the next face: up to one tooth, 30°.' },
  sprag: { title: 'Sprag clutch', kind: '14 sprags between two races', lede: 'No teeth at all. Between the races stand short hardened struts, the sprags, each leaning 4° from the radius. Turn the inner race forward and friction tips them up until they wedge; turn it back and they tip down and slide. They lock at any angle, so the lost motion is only the elastic squeeze of the contacts.' },
  freehub: { title: 'Bicycle freehub', kind: '24-tooth ring · 3 pawls', lede: 'The cassette and its body (input) carry three pawls that spring out against a toothed ring in the hub shell (output). Pedal forward and the pawls catch the ring; stop pedalling and the wheel runs on while the pawls click over the teeth. When you pedal again you turn the cranks up to one tooth, 15°, before it bites.' },
};
const ABOUT = {
  ratchet: [
    ['Lost motion', 'After a back stroke B, the pawl sits a gap g behind the next face: g = B mod 30°. The next forward stroke turns that far before the wheel moves. Here the strokes go back 40°, 25° and 52°, so the gaps are 10°, 25° and 22°.'],
    ['Self-engaging', 'The face pushes the pawl tip back along the tangent. The pivot is placed so that this push turns the pawl into the tooth, against friction up to μ ≈ 0.19. A pawl that is not self-engaging is pushed out under load.'],
    ['The small overrun', 'The tip swings on a circle about its pivot, so it is a little ahead of where it would be on a straight radial path. It clears a crest 0.15° late, and the largest loss is 30.15°, not exactly 30°.'],
    ['Where you find it', 'Socket wrenches, winches and hoists (a second pawl holds the load), clock winding, turnstiles and the escapement family.'],
  ],
  sprag: [
    ['Wedging', 'Each sprag touches both races. The line between its contacts leans ε from the radius. With tan ε less than the friction coefficient, the contact forces fall inside the friction cone and the sprag cannot slip: it locks.'],
    ['Lost motion', 'The garter spring keeps every sprag on both races, so there is no gap to close. Only the contacts squeeze: δ ≈ 3.7 µm each at 100 N·m (Palmgren, line contact), and the races turn δ / tan ε further. That is 0.13°.'],
    ['Many sprags', 'Fourteen sprags share the load, so a small clutch takes a large torque. They are the backstops of conveyors, the overrunning clutches of starter motors and helicopter rotors.'],
    ['What the model leaves out', 'Race hoop strain, wear, and the drag in the free direction. The sprags here slide on the inner race when the clutch is free.'],
  ],
  freehub: [
    ['Points of engagement', 'Twenty-four teeth and three pawls in phase: all three pawls drop together, 24 times a turn. The pedals can turn up to 360° / 24 = 15° before the drive bites. Hubs with more teeth, or pawls out of phase, bite sooner.'],
    ['The overrun', 'The pawl pivot must sit inside the ring, so the tip also moves along the teeth when it folds. It clears a crest 1.41° late; the largest loss is 16.4°.'],
    ['The click', 'Coasting, the ring runs past the pawls and each tooth lifts and drops them. That is the buzz of a coasting bicycle.'],
    ['What the model leaves out', 'Bearings, the rider and the chain. A drag holds the hub shell still while the body turns back, which is the same relative motion as coasting.'],
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
  three: { az: 30, el: 34, explode: 0, k: 1, at: null },
  close: { az: 40, el: 50, explode: 0, k: 0.55, at: 'mid' },
  top: { az: 0, el: 82, explode: 0, k: 0.95, at: null },
  low: { az: -20, el: 10, explode: 0, k: 0.85, at: null },
  exploded: { az: 24, el: 24, explode: 1, k: 1.35, at: 'up' },
};
function fitDist(k) {
  const c = $('view'), a = c.clientWidth / Math.max(1, c.clientHeight);
  const wide = a < 1.1 ? 1 + 0.9 * (1.1 - a) * Math.min(1, k) : 1;
  return S.cur.sc.box.R * 3.3 * k * wide;
}
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const v = VIEWS[name], c = S.cur.sc.box.c;
  // close in: the wheel or the races, at the height of the pawls; the pawl
  // goes round with the input, so the view frames the whole ring of teeth
  const at = v.at === 'mid' ? S.cur.sc.keys.wheel : v.at === 'up' ? [c[0], c[1] + 50, c[2]] : c;
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
  r = Math.max(0, Math.min(30, r));
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
  const want = +e.target.value / 100 * TAU, base = Math.floor(S.th / TAU) * TAU;
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
// Output angle against input angle over one cycle of six strokes (after a
// warm-up cycle, so the clutch state repeats). Forward strokes climb with
// slope 1 where the clutch drives; the flat runs are back strokes and
// lost motion. The lost part of each forward stroke is drawn
// in pink with its size. The other two units are drawn faint.
const COL = { o: '#e2c27a', w: 'rgba(143,176,255,0.35)', a: '#e9a0a8' };
const curveCache = {};
const curveOf = id => curveCache[id] || (curveCache[id] = cycleCurve(unit(id), 600));
function drawPlot() {
  const c = $('plot'), r = c.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; plotCache = null; }
  const g = c.getContext('2d');
  const id = S.cur.id, C = curveOf(id);
  const pad = 12 * dpr, padL = 30 * dpr, padB = 18 * dpr;
  // each axis fills its side; a driving run has slope 1 in degrees
  const xMax = Math.max(...UNITS.map(u => Math.max(...curveOf(u.id).pts.map(q => q.in)))) * DEG;
  const yMax = Math.max(...UNITS.map(u => curveOf(u.id).pts.at(-1).out)) * DEG;
  const kx = (w - padL - pad) / xMax, ky = (h - pad - padB) / yMax;
  const X = v => padL + v * DEG * kx, Y = v => h - padB - v * DEG * ky;
  if (!plotCache) {
    const off = document.createElement('canvas'); off.width = w; off.height = h;
    const o = off.getContext('2d');
    o.strokeStyle = 'rgba(217,179,106,0.12)'; o.lineWidth = 1;
    o.font = `${9.5 * dpr}px ui-monospace,Menlo,monospace`; o.fillStyle = 'rgba(141,144,166,0.9)';
    for (let d = 0; d <= xMax; d += 60) { o.beginPath(); o.moveTo(X(d / DEG), pad); o.lineTo(X(d / DEG), h - padB); o.stroke(); o.fillText(`${d}°`, X(d / DEG) + 2 * dpr, h - 5 * dpr); }
    for (let d = 0; d <= yMax; d += 60) { o.beginPath(); o.moveTo(padL, Y(d / DEG)); o.lineTo(w - pad, Y(d / DEG)); o.stroke(); if (d) o.fillText(`${d}°`, 3 * dpr, Y(d / DEG) + 3 * dpr); }
    const path = (pts, col, lw) => { o.strokeStyle = col; o.lineWidth = lw * dpr; o.beginPath(); pts.forEach((q, i) => (i ? o.lineTo(X(q.in), Y(q.out)) : o.moveTo(X(q.in), Y(q.out)))); o.stroke(); };
    for (const u of UNITS) if (u.id !== id) path(curveOf(u.id).pts, COL.w, 1.1);
    path(C.pts, COL.o, 1.8);
    // lost motion: forward samples where the clutch did not drive
    o.strokeStyle = COL.a; o.lineWidth = 3.2 * dpr; o.lineCap = 'round';
    for (let i = 1; i < C.pts.length; i++) {
      const a = C.pts[i - 1], b = C.pts[i];
      if (b.in > a.in + 1e-9 && !b.driving) { o.beginPath(); o.moveTo(X(a.in), Y(a.out) - 2.5 * dpr); o.lineTo(X(b.in), Y(b.out) - 2.5 * dpr); o.stroke(); }
    }
    // the size of each loss, at the start of its forward stroke
    o.fillStyle = COL.a; o.font = `${10 * dpr}px ui-monospace,Menlo,monospace`;
    const per = (C.pts.length - 1) / STROKES.length;
    let j = 0;
    STROKES.forEach((s, i) => { if (s > 0) { const q = C.pts[i * per]; o.fillText(`${(C.lost[j++] * DEG).toFixed(C.lost[0] * DEG < 1 ? 2 : 0)}°`, X(q.in) - 6 * dpr, Y(q.out) - 7 * dpr); } });
    o.fillStyle = 'rgba(141,144,166,0.9)'; o.font = `${9.5 * dpr}px ui-monospace,Menlo,monospace`;
    o.fillText('output', padL + 3 * dpr, pad + 4 * dpr); o.fillText('input →', w - pad - 48 * dpr, h - padB - 4 * dpr);
    $('legend').innerHTML = `<span class="lo"><i></i>${esc(INFO[id].title.toLowerCase())}</span><span class="la"><i></i>lost motion</span><span class="lw"><i></i>other units</span>`;
    plotCache = { off };
  }
  g.clearRect(0, 0, w, h); g.drawImage(plotCache.off, 0, 0);
  // the present place in the cycle
  const f = (((S.th % TAU) + TAU) % TAU) / TAU, q = C.pts[Math.round(f * (C.pts.length - 1))];
  g.fillStyle = '#fff1d0'; g.beginPath(); g.arc(X(q.in), Y(q.out), 3.6 * dpr, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(255,224,170,0.5)'; g.lineWidth = 1 * dpr; g.beginPath(); g.arc(X(q.in), Y(q.out), 7 * dpr, 0, TAU); g.stroke();
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
const stateOf = Q => {
  if (!Q) return ['—', ''];
  const sk = strokeAt(S.th);
  if (!sk.fwd) return ['Free', S.cur.id === 'sprag' ? 'The input turns back; the sprags slide.' : 'The input turns back; the pawls click over the teeth.'];
  if (Q.driving) return ['Driving', 'The clutch is locked: the output turns with the input.'];
  return ['Taking up', `The input closes the gap: ${(Q.g * DEG).toFixed(S.cur.id === 'sprag' ? 3 : 1)}° to go.`];
};
let lastNums = '';
function fillNums() {
  const id = S.cur.id, u = unit(id), Q = S.Q, f = (v, n = 1) => (v * DEG).toFixed(n) + '°';
  const [st, why] = stateOf(Q);
  let html = `<tr><th>${INFO[id].title}</th><th></th></tr>` + row('Input θ<sub>in</sub>', f(Q.in)) + row('Output θ<sub>out</sub>', f(Q.out)) + row('Gap g', f(Q.g, id === 'sprag' ? 3 : 1));
  if (u.type === 'tooth') {
    const G = pawlGeo(u);
    html += row('Pitch 360°/N', `${(360 / u.N).toFixed(0)}°`) + row('Crest overrun c', f(G.c, 2)) + row('Largest loss', f(lostMax(u), 2)) + row('Clicks', String(Q.clicks));
    if (u.pawls) html += row('Pawls in phase', `${u.pawls} on ${u.N} teeth`);
  } else {
    const Sg = spragGeo(u);
    html += row('Strut angle ε', f(Sg.epsI, 2)) + row('tan ε vs μ', `${Math.tan(Sg.epsI).toFixed(3)} < ${u.mu}`) + row('Load per sprag', `${(Sg.Q / 1000).toFixed(2)} kN`) + row('Contact squeeze δ', `${(Sg.delta * 1000).toFixed(1)} µm`) + row('Take-up e', f(Sg.e, 3));
  }
  $('now').innerHTML = `<b>${st}</b><span>${why}</span>`;
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
}
function fillEqs() {
  const id = S.cur.id;
  const E = {
    ratchet: [['Lost motion', 'g = B mod p,  p = 360° / N', 'after a back stroke B'], ['Largest loss', 'g < p + c = 30.15°', 'c: the tip clears the crest late'], ['Self-engaging', 'M(face) > M(friction μ)', 'the push turns the pawl in']],
    sprag: [['Wedge', 'tan ε < μ', 'the force stays in the friction cone'], ['Contact', 'δ = 3.84·10⁻⁵ Q^0.9 / L^0.8', 'Palmgren, steel line contact'], ['Take-up', 'e = 2δ / (r_i tan ε)', 'the only lost motion']],
    freehub: [['Engagement', '360° / N = 15°', 'N = 24, three pawls in phase'], ['Largest loss', 'g < p + c = 16.4°', 'the pivot sits inside the ring'], ['Coasting', 'ω_shell > ω_body', 'the pawls click over the teeth']],
  }[id];
  $('eqs').innerHTML = E.map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  if (!S.Q || !S.cur) return [key, '—'];
  const Q = S.Q, sp = S.cur.id === 'sprag';
  switch (key) {
    case 'in': return ['Input', `${(Q.in * DEG).toFixed(1)}°`];
    case 'out': return ['Output', `${(Q.out * DEG).toFixed(1)}°`];
    case 'gap': return ['Gap to drive', `${(Q.g * DEG).toFixed(sp ? 3 : 1)}°`];
    case 'state': return ['Now', stateOf(Q)[0]];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const Q = S.Q;
  $('read').innerHTML = `<span class="hi">${esc(INFO[S.cur.id].title)}</span><br><span class="lo">in ${(Q.in * DEG).toFixed(0)}° · out ${(Q.out * DEG).toFixed(0)}° · ${stateOf(Q)[0].toLowerCase()}</span>`;
  $('turnV').textContent = `${Math.round((((S.th % TAU) + TAU) % TAU) / TAU * 100)}%`;
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
window.__ratchets = { S, stage, cards, swapTo, setView, setRpm, setExplode, setShow, setOpen, setAna };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
setRpm(5); setExplode(0);
stage.place({ az: -50, el: 30, r: 1600, target: new THREE.Vector3(0, 30, 0) });
const start = (location.hash || '').slice(1);
swapTo(UNITS.some(v => v.id === start) ? start : 'ratchet');
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
// each unit: the whole unit, a close view of the pawl (or the sprags), the
// view from above, a low view, the exploded unit and close-ups of 3 parts
// (lib/mech-tour.js), then a fade to the next unit. The step order and the
// camera moves are shuffled by the seed. Each step holds seconds/10 (at
// least 5 s). calm (1 = slowest) slows the strokes, not the step time.
// opts.label names each step with the relations and live values. No
// exit(): the shell reloads the page.
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
    const RPM = Math.max(2, Math.round(9 - 5 * calm));
    setRpm(RPM);
    const hold = Math.max(5, (o.seconds || 60) / 10) * 1000;
    const order = UNITS.map(u => u.id);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const canvas = $('view');
    const RULES = [['\\theta_{in}', 'm1'], ['\\theta_{out}', 'm2'], ['g', 'm3'], ['p', 'm4'], ['N', 'm4'], ['\\varepsilon', 'm5'], ['\\mu', 'm6'], ['\\delta', 'm5']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const params = () => {
      const Q = S.Q; if (!Q) return [];
      const sp = S.cur.id === 'sprag', u = unit(S.cur.id);
      const out = [P('\\theta_{in}', 'input', `${(Q.in * DEG).toFixed(0)}°`, 'm1'), P('\\theta_{out}', 'output', `${(Q.out * DEG).toFixed(0)}°`, 'm2'), P('g', 'gap to drive', `${(Q.g * DEG).toFixed(sp ? 3 : 1)}°`, 'm3')];
      if (!sp) out.push(P('p', 'tooth pitch', `${(360 / u.N).toFixed(0)}°`, 'm4'));
      else out.push(P('\\varepsilon', 'strut angle', `${(spragGeo(u).epsI * DEG).toFixed(2)}°`, 'm5'));
      return out;
    };
    const TEX = {
      ratchet: [String.raw`g = B \bmod p,\qquad p = \frac{360^\circ}{N} = 30^\circ`, String.raw`g_{max} = p + c = 30.15^\circ`],
      sprag: [String.raw`\tan\varepsilon < \mu,\qquad \tan 4.0^\circ = 0.070 < 0.1`, String.raw`e = \frac{2\delta}{r_i\tan\varepsilon},\quad \delta = 3.84\cdot10^{-5}\,\frac{Q^{0.9}}{L^{0.8}}`],
      freehub: [String.raw`p = \frac{360^\circ}{N} = 15^\circ,\quad N = 24`, String.raw`g_{max} = p + c = 16.4^\circ`],
    };
    const EQ = { ratchet: ['g = B mod p', 'p = 360°/N = 30°'], sprag: ['tan ε < μ', 'e = 2δ / (r_i tan ε)'], freehub: ['p = 360°/N = 15°', 'g < p + c = 16.4°'] };
    const tex = () => TEX[S.cur.id], eq = () => EQ[S.cur.id];
    const all = () => Object.values(S.cur.B.parts).filter(q => q.info !== 'base').map(q => q.holder);
    const pair = () => Object.values(S.cur.B.parts).filter(q => /^(pawl|spring|sprag|cage|garter)/.test(q.info)).map(q => q.holder);
    const SUB = { ratchet: 'The pawl and the tooth face', sprag: 'Sprags wedged between the races', freehub: 'Three pawls on a 24-tooth ring' };
    const STEPS = [
      { view: 'three', lab: () => ({ title: INFO[S.cur.id].title, sub: INFO[S.cur.id].kind, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'close', lab: () => ({ title: S.cur.id === 'sprag' ? 'The sprags' : 'The pawl', sub: SUB[S.cur.id], params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(pair()) }) },
      { view: 'top', lab: () => ({ title: INFO[S.cur.id].title, sub: 'From above: drive, then slip', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'low', lab: () => ({ title: INFO[S.cur.id].title, sub: 'Low and close to the plate', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'exploded', still: true, lab: () => ({ title: 'Exploded view', sub: INFO[S.cur.id].title, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
    ];
    STEPS.forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, prefer: ['pawl', 'wheel', 'sprag', 'ring', 'spring', 'cage', 'cassette'], skip: ['base', 'shaft', 'axle', 'pin', 'lever'] });
    const focusStep = info => ({ focus: info, still: true, lab: () => { const t = tour.plate(info, INFO[S.cur.id].title); return { ...t, anchor: () => plateAnchor(t.meshes) }; } });
    let plan = [];
    // the whole unit first; the other views shuffled; the exploded view,
    // then the part close-ups
    const makePlan = () => {
      tour.unit();
      const mid = [STEPS[1], STEPS[2], STEPS[3]];
      for (let i = mid.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [mid[i], mid[j]] = [mid[j], mid[i]]; }
      plan = [STEPS[0], ...mid.slice(0, 2), STEPS[4], ...tour.pick(3).map(focusStep)];
    };
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
