// ============================================================================
//  WATCH MOVEMENT  ·  main.js — the picker, the swap, the panel, the loop
// ────────────────────────────────────────────────────────────────────────────
//  Shows one calibre at a time (calibres/*.js for the mechanism, scenes/*.js
//  for its 3D parts). stage.js holds the renderer, the upright camera and
//  the gentle orbit; cards.js the hover and pinned part cards and labels.
//  The watch stands upright: y is 12 o'clock, z (the watch axis) points at
//  the camera, and the layers spread along z in the exploded view.
//
//  MOVEMENT SWAP
//    The old movement flies apart and fades (0.7 s), the new one fades in
//    from a wide explode and settles (1.1 s), and the camera eases to fit it.
//
//  GREP MAP
//    function swapTo ............ build a calibre and cross-fade to it
//    function frame ............. step, pose, explode, fades, stage, cards
//    const VIEWS / function setView  camera presets
//    function setOpen ........... the panel; on a phone one group per tab
// ============================================================================
import * as THREE from 'three';
import { CALIBRES, metaById, loadCalibre as loadModule } from './calibres/index.js';
import { createBuild } from './kit.js';
import { createStage, ease } from './stage.js';
import { createCards, esc } from './cards.js';
import * as G from './geom.js';

const SCENES = {
  lever: () => import('./scenes/lever.js'),
  tourbillon: () => import('./scenes/tourbillon.js'),
  automatic: () => import('./scenes/automatic.js'),
  verge: () => import('./scenes/verge.js'),
  cylinder: () => import('./scenes/cylinder.js'),
  detent: () => import('./scenes/detent.js'),
};
const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const { D } = G;

const stage = createStage({ canvas: $('view'), panel: $('panel'), coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, leaving: [], rate: 1, lastRate: 1, explode: 1.4, explodeTarget: 0.55, winding: false,
  showDial: true, showBridges: true, showLabels: !PHONE_Q.matches, wrist: true, close: false, swapping: false,
};
const cards = createCards({
  stage, $, isPhone: () => PHONE_Q.matches,
  get: () => S.cur && { ...S.cur, PARTS: S.cur.cal.PARTS },
  labelsOn: () => S.showLabels && !S.close && S.explode > 0.2 && S.cur.alpha > 0.5 ? Math.min(1, (S.explode - 0.2) * 4) * S.cur.alpha : 0,
  onTap: () => hideHint(),
});
stage.onStart = () => { S.close = false; hideHint(); };
function nowSeconds() { const d = new Date(); return (d.getHours() % 12) * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000; }

// ── movement swap ───────────────────────────────────────────────────────────
// a calibre not yet in calibres/index.js loads by its id (#<id>), so a new
// one can be checked here before it is registered
async function loadCalibre(id) {
  const [cal, mod] = await Promise.all([loadModule(id), SCENES[id] ? SCENES[id]() : import(`./scenes/${id}.js`)]);
  return { cal, mod };
}
async function swapTo(id) {
  if (S.swapping || (S.cur && S.cur.cal.id === id)) return;
  S.swapping = true;
  try {
    const { cal, mod } = await loadCalibre(id);
    const B = createBuild();
    const sc = mod.build(B, cal);
    stage.root.add(B.root);
    const next = { cal, B, sc, state: cal.createState(nowSeconds(), 0.85), alpha: 0, t0: performance.now(), per: cal.periods() };
    B.setAlpha(0.001);
    next.state.still = !S.wrist;
    $('tWrist').hidden = !cal.wristToggle;
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now(), e0: S.explode });
    S.cur = next;
    S.explode = Math.max(S.explode, 1.25);
    applyToggles();
    cards.reset();
    fillPanel(cal);
    stage.setShadowExtent(Math.max(18, cal.plateR));
    stage.fitTo(fitDistance(cal), new THREE.Vector3(0, 0, midZ(cal) + explodeCentre(S.explodeTarget)));
    document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    try { history.replaceState(null, '', '#' + id); } catch (e) {}
  } finally { S.swapping = false; }
}
const fitDistance = cal => cal.plateR * 6.3 * (innerWidth < innerHeight * 0.8 ? 1.3 : 1);
const explodeCentre = e => S.cur ? e * S.cur.sc.unit * (S.cur.sc.centreK ?? 0.25) : 0;
const midZ = cal => (cal.zRange[0] + cal.zRange[1]) / 2 * 0.3;

// ── panel content for a calibre (cross-faded) ──────────────────────────────
function fillPanel(cal) {
  const box = $('calInfo');
  box.classList.add('fading');
  setTimeout(() => {
    $('calTitle').textContent = cal.name;
    $('calKind').textContent = `${cal.kind} · ${cal.era}`;
    $('calLede').textContent = cal.blurb;
    const per = cal.periods();
    $('train').innerHTML = '<tr><th>wheel</th><th>teeth</th><th>pinion</th><th>1 turn</th></tr>' +
      cal.train.map(r => `<tr data-part="${r[0]}"><td>${esc(r[1])}</td><td>${r[2]}</td><td>${r[3]}</td><td>${G.fmtPeriod(per[r[0]])}</td></tr>`).join('') +
      `<tr data-part="balance"><td>Balance</td><td>—</td><td>—</td><td>${esc(cal.freq.split(' · ')[0])}</td></tr>`;
    $('train').querySelectorAll('tr[data-part]').forEach(tr => tr.addEventListener('click', () => cards.pinById(tr.dataset.part)));
    $('trainNote').textContent = cal.trainNote || '';
    $('about').innerHTML = cal.about.map(([h, t]) => `<p><b>${esc(h)}.</b> ${esc(t)}</p>`).join('');
    box.classList.remove('fading');
  }, 220);
}
function buildPicker() {
  $('movements').innerHTML = CALIBRES.map(c => `<button class="mv" type="button" data-id="${c.id}"><b>${esc(c.name)}</b><span>${esc(c.kind)} · ${esc(c.era)}</span></button>`).join('');
  $('movements').querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => swapTo(b.dataset.id)));
}

// ── views: camera moves along spherical arcs round the target ──────────────
const VIEWS = {
  front: { az: 0, el: 10, explode: 0 },
  dial: { az: 180, el: 8, explode: 0, dial: true },
  exploded: { az: 52, el: 16, explode: 0.9, dial: true, bridges: true },
  escapement: { az: 38, el: -22, explode: 0.55, rate: 0.05, close: true, bridges: false },
};
function setView(name) {
  const cal = S.cur.cal, v = { ...VIEWS[name], ...((cal.views || {})[name] || {}) };
  const target = v.close ? new THREE.Vector3(...cal.focus) : new THREE.Vector3(0, 0, midZ(cal));
  const r = v.close ? cal.plateR * (v.distK ?? 1.5) : fitDistance(cal) * (v.explode > 0.5 ? 1.15 : 1);
  target.z += v.close ? v.explode * S.cur.sc.unit * (S.cur.sc.focusK ?? 1) : explodeCentre(v.explode);
  stage.flyTo({ az: v.az, el: v.el, r, target });
  S.close = !!v.close;
  setExplode(v.explode);
  if (v.bridges !== undefined) setShow('bridges', v.bridges);
  if (v.dial !== undefined) setShow('dial', v.dial);
  if (v.rate !== undefined) setRate(v.rate);
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
$('burst').addEventListener('click', () => setExplode(0.9));
function setRate(r) {
  if (r > 0) S.lastRate = r;
  S.rate = r;
  document.querySelectorAll('#rates button').forEach(b => b.classList.toggle('on', +b.dataset.rate === r));
  $('dockPlay').querySelector('i').textContent = r ? '❚❚' : '▶'; $('dockPlay').querySelector('span').textContent = r ? 'Pause' : 'Play';
  $('dockPlay').setAttribute('aria-label', r ? 'Pause' : 'Play');
  $('rateNote').textContent = r === 0 ? 'Paused. Winding still works.'
    : r < 1 ? 'Slow motion. Watch the escape wheel lock, unlock, give its impulse and drop.'
    : r === 1 ? 'Real time.'
    : 'Fast. The balance now swings faster than the screen can draw, so it looks still or jumps (aliasing). The wheel train stays exact.';
}
document.querySelectorAll('#rates button').forEach(b => b.addEventListener('click', () => setRate(+b.dataset.rate)));
$('dockPlay').addEventListener('click', () => setRate(S.rate ? 0 : S.lastRate));
function applyToggles() {
  if (!S.cur) return;
  const t = S.cur.sc.toggles || {};
  for (const id of t.dial || []) if (S.cur.B.parts[id]) S.cur.B.parts[id].holder.visible = S.showDial;
  for (const id of t.bridges || []) if (S.cur.B.parts[id]) S.cur.B.parts[id].holder.visible = S.showBridges;
}
function setShow(what, on) {
  if (what === 'dial') { S.showDial = on; $('tDial').classList.toggle('on', on); }
  if (what === 'bridges') { S.showBridges = on; $('tBridges').classList.toggle('on', on); }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
  applyToggles();
}
$('tDial').addEventListener('click', () => setShow('dial', !S.showDial));
$('tBridges').addEventListener('click', () => setShow('bridges', !S.showBridges));
$('tLabels').addEventListener('click', () => setShow('labels', !S.showLabels));
$('tOrbit').addEventListener('click', () => setShow('orbit', !stage.orbit));
// self-winders: on the wrist the rotor swings and winds; on a table it rests
$('tWrist').addEventListener('click', () => {
  S.wrist = !S.wrist;
  if (S.cur) S.cur.state.still = !S.wrist;
  $('tWrist').classList.toggle('on', S.wrist);
  $('tWrist').textContent = S.wrist ? 'Wrist motion: on' : 'Wrist motion: off (on a table)';
});

const windBtn = $('wind');
const windOn = e => { e.preventDefault(); S.winding = true; windBtn.classList.add('on'); try { windBtn.setPointerCapture(e.pointerId); } catch (x) {} };
const windOff = () => { S.winding = false; windBtn.classList.remove('on'); };
windBtn.addEventListener('pointerdown', windOn);
windBtn.addEventListener('pointerup', windOff);
windBtn.addEventListener('pointercancel', windOff);
windBtn.addEventListener('lostpointercapture', windOff);
windBtn.addEventListener('contextmenu', e => e.preventDefault());

// panel, sheet and dock. On a phone a dock tab opens the sheet with only
// its group; the same tab, the grip or a drag down closes it.
const panel = $('panel'), tabs = [...document.querySelectorAll('#dock .tab')];
let grp = 'movement';
function setOpen(open, g = grp) {
  grp = g;
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  document.body.classList.toggle('sheet-open', open);
  panel.querySelectorAll('.grp').forEach(el => el.classList.toggle('on', el.dataset.grp === grp));
  for (const t of tabs) { const on = open && t.dataset.grp === grp; t.classList.toggle('on', on); t.setAttribute('aria-expanded', String(on)); }
  if (open && PHONE_Q.matches) panel.scrollTop = 0;
}
for (const t of tabs) t.addEventListener('click', () => setOpen(!(panel.classList.contains('open') && grp === t.dataset.grp), t.dataset.grp));
$('gear').addEventListener('click', () => setOpen(true));
$('panelClose').addEventListener('click', () => setOpen(false));
setOpen(!PHONE_Q.matches);
PHONE_Q.addEventListener('change', e => setOpen(!e.matches));
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

// ── readout ─────────────────────────────────────────────────────────────────
function fmtClock(sec) {
  sec = ((sec % 43200) + 43200) % 43200;
  const h = Math.floor(sec / 3600) || 12, m = Math.floor(sec / 60) % 60, s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}
let readTick = 0;
function readout(p) {
  if (++readTick % 4) return;
  const cal = S.cur.cal, st = S.cur.state;
  const res = Math.max(0, p.reserve), hrs = res * cal.hoursPerTurn;
  $('read').innerHTML = `<span class="hi">${fmtClock(p.seconds)}</span> <span class="lo">· ${esc(cal.name)}</span><br>` +
    (st.stopped ? '<span class="bad">stopped · wind it</span>' : `<span class="lo">beat</span> ${p.beats.toLocaleString()} <span class="lo">· amplitude</span> ${(st.amp / D).toFixed(0)}° <span class="lo">· ×</span>${S.rate}`);
  $('resBar').style.width = (res / cal.CAL.reserveTurns * 100).toFixed(1) + '%';
  $('resV').textContent = `${hrs.toFixed(1)} h`;
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur) return;

  // the watch
  const cur = S.cur;
  cur.cal.step(cur.state, dt * S.rate, S.winding ? dt * 0.35 : 0);
  const p = cur.cal.pose(cur.state);
  S.explode += (S.explodeTarget - S.explode) * Math.min(1, dt * 3.2);
  cur.sc.pose(p, dt);
  cur.B.applyExplode(S.explode, cur.sc.unit);
  // fade in after a short beat, with a gentle settle in scale
  const age = (now - cur.t0) / 1000;
  const a = REDUCED ? 1 : ease((age - 0.15) / 0.9);
  if (a !== cur.alpha) { cur.alpha = a; cur.B.setAlpha(Math.max(0.001, a)); }
  cur.B.root.scale.setScalar(1 + 0.05 * (1 - ease(age / 1.1)));

  // the old movements fly apart and fade
  for (const old of S.leaving) {
    const t = (now - old.t0) / 700, k = ease(t);
    old.B.applyExplode(old.e0 + (1.7 - old.e0) * k, old.sc.unit);
    old.B.setAlpha(Math.max(0.001, 1 - k));
    old.B.root.scale.setScalar(1 - 0.08 * k);
    if (t >= 1) old.dead = true;
  }
  for (const old of S.leaving.filter(q => q.dead)) old.B.dispose();
  S.leaving = S.leaving.filter(q => !q.dead);

  // keep the target on the middle of the spread as the layers part
  const cz = explodeCentre(S.explode), dz = cz - (S.lastCz ?? cz);
  S.lastCz = cz;
  stage.shift(dz);
  stage.frame(dt);
  cards.frame(p, now, dt);
  readout(p);
}

window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });

// debug and headless checks
window.__watch = { S, stage, cards, swapTo, setView, setRate, setExplode, setPin: h => cards.setPin(h), pinById: id => cards.pinById(id), pick: (x, y) => cards.pick(x, y), camera: stage.camera, controls: stage.controls, CALIBRES };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
setRate(1);
setExplode(0.55);
const start = (location.hash || '').slice(1);
stage.place({ az: 36, el: 14, r: 150, target: new THREE.Vector3() });
swapTo(/^[a-z0-9-]+$/.test(start) ? start : CALIBRES[0].id).catch(() => swapTo(CALIBRES[0].id));
requestAnimationFrame(frame);
