// ============================================================================
//  PIN TUMBLER LOCK  ·  main.js — the lock swap, the cycle, panels, loop, saver
// ────────────────────────────────────────────────────────────────────────────
//  Shows one lock at a time: lock.js for the mechanism, scene.js for its 3D
//  parts (kit.js), analysis.js for the shear-line chart and the numbers.
//  stage.js holds the renderer, the upright camera and the gentle orbit;
//  cards.js the part cards and labels.
//
//  THE CYCLE. cycleAt(t) gives the key insertion s (0..1) and the turn the
//  hand asks for. L.state() decides how far the plug may really turn: 90°
//  when every stack is on the shear line, else only the clearance. The
//  plug angle eases toward that limit, so a wrong key gives a short bump.
//  "By hand" sliders pause the cycle and set s and the turn directly.
//
//  EXPLODE. As the parts start to part, the plug turns back and then the key
//  comes out (sEff, thEff in frame), so every part leaves from rest.
//
//  GREP MAP
//    function swapTo ............ build a lock and cross-fade to it
//    function cycleAt ........... the insert, turn, withdraw cycle
//    const VIEWS / function setView  camera presets
//    function setOpen ........... the panel; on a phone one group per tab
//    function liveValue ......... the live rows of the part cards
//    function frame ............. cycle, state, pose, tint, explode, stage
//    window.snSaver ............. screensaver hook: a slow tour
// ============================================================================
import * as THREE from 'three';
import { makeLock, VARIANTS, KEYS, D } from './lock.js';
import { createBuild, ease } from './kit.js';
import { build } from './scene.js';
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
  cur: null, leaving: [], keyId: 'right', rate: 1, lastRate: 1, cycT: 0, manual: false, s: 0, turnReq: 0, th: 0,
  explode: 0, explodeTarget: 0, section: true, shearOn: true, showLabels: !PHONE_Q.matches, swapping: false,
  anaOpen: !PHONE_Q.matches, ekRate: 2.4, st: null, view: 'three',
};
const ana = createAnalysis({ chart: $('chart'), chTable: $('chTable'), nums: $('nums'), eqs: $('eqs'), stateNow: $('stateNow') });
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

// ── lock swap ───────────────────────────────────────────────────────────────
async function swapTo(id) {
  if (S.swapping || (S.cur && S.cur.L.id === id)) return;
  S.swapping = true;
  try {
    const L = makeLock(id), B = createBuild(), sc = build(B, L);
    stage.root.add(B.root);
    const next = { L, B, sc, PARTS: partsFor(L), alpha: 0, t0: performance.now(), tint: L.g.X.map(() => [0, 0]) };
    B.setAlpha(0.001);
    B.setSection(S.section);
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now() });
    S.cur = next;
    S.cycT = 0; S.th = 0;
    if (S.manual) { S.s = 0; S.turnReq = 0; syncHand(); }
    cards.reset();
    ana.setLock(L);
    fillPanel();
    const c = new THREE.Vector3(...sc.box.c);
    stage.setShadowExtent(sc.box.R * 1.4, c);
    stage.controls.minDistance = sc.box.R * 0.45; stage.controls.maxDistance = sc.box.R * 8;
    document.querySelectorAll('#variants .mv').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    if (!saverOn) try { history.replaceState(null, '', '#' + id); } catch (e) {}
    setView(S.view || 'three', true);
  } finally { S.swapping = false; }
}

// ── panel content ───────────────────────────────────────────────────────────
const ABOUT = {
  pin: [
    ['Two cylinders, one line', 'The plug turns inside the housing. The thin gap between them is the shear line. A pin that crosses the gap ties the two together, the way a dowel ties two boards.'],
    ['Each stack has a split', 'A key pin and a driver pin share one chamber. The split between them moves up and down with the key. Only one height puts the split on the shear line, and the key pin length sets that height for each chamber.'],
    ['The key sets five heights', 'Each cut on the key holds one key pin at a height. The right key puts all five splits on the line at once, and the plug turns. The cam on the back of the plug then throws the bolt.'],
    ['A wrong key', 'A cut too shallow pushes a key pin up across the line; a cut too deep leaves a driver pin down across it. Either way the plug moves only through its small clearance, then stops.'],
    ['What the model leaves out', 'Real pins and holes have small errors in size and place, which make the stacks bind one at a time. This model has exact parts, no friction and no wear.'],
  ],
  wafer: [
    ['Plates, not pins', 'A wafer is a flat plate with a window. It slides up and down in a slot right through the plug, and a spring pushes it down.'],
    ['Two grooves, two ways to block', 'The housing has a groove along the top and the bottom of its bore. A wafer pushed too low stands out into the lower groove; one lifted too high stands into the upper groove. Either one stops the plug.'],
    ['The right key centres each wafer', 'Each cut lifts its wafer by the top edge of the window. The right cut puts both ends of the wafer inside the plug at once.'],
    ['Compared with pins', 'One part does the work of a pin stack, so the lock is cheap and short. It has few depths, so few codes: cabinets, mailboxes and desk drawers.'],
  ],
};
function fillPanel() {
  const L = S.cur.L, g = L.g, box = $('lockInfo');
  box.classList.add('fading');
  setTimeout(() => {
    $('lockTitle').textContent = g.name;
    $('lockKind').textContent = g.kind;
    $('lockLede').textContent = g.blurb;
    const seen = new Set(), P = S.cur.PARTS;
    const ids = [];
    for (const m of S.cur.B.pickables) { const id = m.userData.part; if (P[id] && !seen.has(id)) { seen.add(id); ids.push(id); } }
    $('partList').innerHTML = ids.map(id => `<button type="button" data-part="${id}" style="--gc:${GROUP_COLOR[P[id].group] || '#e9c27a'}"><i></i>${esc(P[id].name)}</button>`).join('');
    $('partList').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { cards.pinById(b.dataset.part); if (PHONE_Q.matches) setOpen(false); }));
    $('about').innerHTML = ABOUT[L.id].map(([h, t]) => `<p><b>${esc(h)}.</b> ${esc(t)}</p>`).join('');
    $('legend').innerHTML = L.pin
      ? '<span class="lk"><i></i>key pin</span><span class="ldr"><i></i>driver</span><span class="lbad"><i></i>across the line</span><span class="lsh"><i></i>shear line</span>'
      : '<span class="ldr"><i></i>wafer</span><span class="lbad"><i></i>stands out</span><span class="lsh"><i></i>plug surface</span>';
    $('views').querySelector('[data-view="pins"]').textContent = L.pin ? 'Pin stacks' : 'Wafers';
    $('views').querySelector('[data-view="drive"]').textContent = L.pin ? 'Cam & bolt' : 'Cam bar';
    box.classList.remove('fading');
  }, 200);
}
function buildPickers() {
  $('variants').innerHTML = VARIANTS.map(v => `<button class="mv" type="button" data-id="${v.id}"><b>${esc(v.name)}</b><span>${esc(v.kind)}</span></button>`).join('');
  $('variants').querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => swapTo(b.dataset.id)));
  $('keys').innerHTML = KEYS.map(k => `<button class="mv" type="button" data-key="${k.id}"><b>${esc(k.name)}</b><span>${esc(k.note)}</span></button>`).join('');
  $('keys').querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => setKey(b.dataset.key)));
}

// ── views ───────────────────────────────────────────────────────────────────
const VIEWS = {
  three: { az: 34, el: 16, explode: 0, k: 1 },
  section: { az: 0, el: 2, explode: 0, k: 0.8 },
  pins: { az: 4, el: 4, explode: 0, k: 0.42, at: g => [(g.X[0] + g.X[g.n - 1]) / 2, g.type === 'pin' ? 5 : 0, 0],
    // wafers are plates across the axis: look at their faces, not their edges
    wafer: { az: 48, el: 14, k: 0.5 } },
  keyway: { az: 90, el: 4, explode: 0, k: 0.36, at: g => [g.x1, 0, 0] },
  drive: { az: -68, el: 14, explode: 0, k: 0.8, at: g => g.type === 'pin' ? [g.x0 - 5, -3, -6] : [g.x0 - 4, -9, 0] },
  exploded: { az: 26, el: 14, explode: 1, k: 1 },
};
function viewTarget(v) {
  const sc = S.cur.sc, g = S.cur.L.g;
  if (v.at) return new THREE.Vector3(...v.at(g));
  const t = new THREE.Vector3(...sc.box.c);
  if (v.explode) t.add(new THREE.Vector3(...sc.explodeShift));
  return t;
}
// the lock is wider than it is tall: a narrow canvas needs more distance
// than the stage's own zoom gives it
const fitDist = v => {
  const c = $('view'), a = c.clientWidth / Math.max(1, c.clientHeight), narrow = Math.max(0, Math.min(1, (1 - a) / 0.5));
  return (v.explode ? S.cur.sc.explodeR * 2.9 : S.cur.sc.box.R * 3.2) * v.k * (1 + 0.35 * narrow);
};
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const v = { ...VIEWS[name], ...(VIEWS[name][S.cur.L.id] || {}) };
  stage.flyTo({ az: v.az, el: v.el, r: fitDist(v), target: viewTarget(v), t: soft ? 1.6 : 1.4 });
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
function setKey(id) {
  if (S.keyId === id) return;
  S.keyId = id;
  // a new key starts the cycle with the key out
  S.cycT = 0; S.th = 0;
  if (S.manual) { S.s = 0; S.turnReq = 0; syncHand(); }
  document.querySelectorAll('#keys .mv').forEach(b => b.classList.toggle('on', b.dataset.key === id));
}
function setRate(r) {
  if (r > 0) { S.lastRate = r; if (S.manual) { S.manual = false; S.cycT = cycleFrom(S.s); } }
  S.rate = r;
  document.querySelectorAll('#rates button').forEach(b => b.classList.toggle('on', +b.dataset.rate === r));
  $('dockPlay').querySelector('i').textContent = r ? '❚❚' : '▶'; $('dockPlay').querySelector('span').textContent = r ? 'Pause' : 'Play';
  $('dockPlay').setAttribute('aria-label', r ? 'Pause' : 'Play');
}
document.querySelectorAll('#rates button').forEach(b => b.addEventListener('click', () => setRate(+b.dataset.rate)));
$('dockPlay').addEventListener('click', () => setRate(S.rate ? 0 : S.lastRate));
// by hand: pause the cycle, drive s and the turn directly
function goManual() { if (!S.manual) { S.manual = true; setRate(0); } }
$('ins').addEventListener('input', e => {
  goManual();
  // a turned plug holds the key: the key pins sit in the plug
  if (S.th > 0.5 * D) { $('ins').value = S.s * 100; return; }
  S.s = +e.target.value / 100; syncHand();
});
$('turn').addEventListener('input', e => { goManual(); S.turnReq = +e.target.value * D; syncHand(); });
function syncHand() {
  $('ins').value = S.s * 100; $('insV').textContent = `${Math.round(S.s * 100)}%`;
  $('turn').value = S.turnReq / D; $('turnV').textContent = `${Math.round(S.th / D)}°`;
}
function setShow(what, on) {
  if (what === 'section') { S.section = on; $('tSection').classList.toggle('on', on); for (const o of [S.cur, ...S.leaving]) if (o) o.B.setSection(on); }
  if (what === 'shear') { S.shearOn = on; $('tShear').classList.toggle('on', on); }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
}
$('tSection').addEventListener('click', () => setShow('section', !S.section));
$('tShear').addEventListener('click', () => setShow('shear', !S.shearOn));
$('tLabels').addEventListener('click', () => setShow('labels', !S.showLabels));
$('tOrbit').addEventListener('click', () => setShow('orbit', !stage.orbit));

// ── the cycle ───────────────────────────────────────────────────────────────
// phases in seconds at 1×: out, insert, seat, turn, hold, back, pause, withdraw
const PH = [['out', 1.2], ['insert', 3.0], ['seat', 0.7], ['turn', 1.7], ['hold', 1.6], ['back', 1.4], ['pause', 0.5], ['withdraw', 2.6]];
const CYCLE = PH.reduce((a, p) => a + p[1], 0);
function cycleAt(t, keyId) {
  if (keyId === 'none') return { s: 0, turn: 0, phase: 'out' };
  t = ((t % CYCLE) + CYCLE) % CYCLE;
  let name = 'out', u = 0;
  for (const [nm, d] of PH) { if (t < d) { name = nm; u = t / d; break; } t -= d; }
  const sIn = { out: 0, insert: ease(u), withdraw: 1 - ease(u) }[name] ?? 1;
  let turn = 0;
  if (keyId === 'right') turn = name === 'turn' ? 90 * D * ease(u) : name === 'hold' ? 90 * D : name === 'back' ? 90 * D * (1 - ease(u)) : 0;
  else turn = name === 'turn' ? 14 * D * Math.sin(Math.PI * u) : name === 'back' ? 10 * D * Math.sin(Math.PI * u) : 0;
  return { s: sIn, turn, phase: name };
}
// the cycle time that matches insertion s (to resume after a hand move)
function cycleFrom(s) { return s <= 0.001 ? 0 : s >= 0.999 ? PH[0][1] + PH[1][1] : PH[0][1] + PH[1][1] * s; }

// ── panels: left controls, right analysis; on a phone one sheet ─────────────
const panel = $('panel'), tabs = [...document.querySelectorAll('#dock .tab')], anaSec = $('anaSec'), anaPanel = $('anaPanel');
let grp = 'lock';
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
  if (open && grp === 'shear') setTimeout(() => ana.redraw(), 60);
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
function liveValue(key) {
  const st = S.st;
  if (!st || !S.cur) return [key, '—'];
  const L = S.cur.L, g = L.g;
  const gaps = () => st.ch.map(q => (q.gap > 0.0005 ? '+' : q.gap < -0.0005 ? '−' : '') + Math.abs(q.gap).toFixed(2)).join(' ');
  switch (key) {
    case 'insert': return ['Key in', `${(st.s * g.key.travel).toFixed(1)} of ${g.key.travel} mm`];
    case 'keyName': return ['Key', KEYS.find(k => k.id === st.keyId).name];
    case 'angle': return ['Plug angle', `${(st.theta / D).toFixed(1)}°`];
    case 'open': return ['State', st.open ? 'free to turn' : `held by ${st.blocked}`];
    case 'blocked': return ['Stacks across', `${st.blocked} of ${g.n}`];
    case 'gaps': return ['Gaps (mm)', gaps()];
    case 'state': return ['On the line', st.ch.map(q => q.ok ? '●' : '○').join(' ')];
    case 'drivers': return ['Driver bottoms', st.ch.map(q => (q.db - g.Rp >= 0 ? '+' : '−') + Math.abs(q.db - g.Rp).toFixed(2)).join(' ')];
    case 'springs': return ['Lengths (mm)', st.ch.map(q => q.spring.toFixed(1)).join(' ')];
    case 'force': return ['Load', `${st.ch.reduce((a, q) => a + q.force, 0).toFixed(2)} N`];
    case 'bolt': return ['Bolt out', `${st.bolt.toFixed(2)} mm`];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout(st) {
  if (++readTick % 4) return;
  const L = S.cur.L;
  const head = st.open ? `<span class="ok">Open</span>` : st.keyId === 'none' || st.s < 0.02 ? `<span class="bad">Locked</span> <span class="lo">· no key in</span>` : !st.home ? `<span class="hi">Key part way in</span>` : `<span class="bad">Locked</span> <span class="lo">· ${st.blocked} across</span>`;
  $('read').innerHTML = `${head} <span class="lo">· ${esc(L.g.name)}</span><br>` +
    `<span class="lo">key</span> ${Math.round(st.s * 100)}% <span class="lo">· plug</span> ${(st.theta / D).toFixed(1)}°` +
    (L.pin ? ` <span class="lo">· bolt</span> ${st.bolt.toFixed(1)} mm` : '') + ` <span class="lo">· on line</span> ${st.ok}/${L.g.n}`;
}
function runNote(st, want) {
  const L = S.cur.L;
  let t;
  if (!S.manual) t = S.rate ? 'Playing the cycle. Move a slider below to take the key in your own hand.' : 'Paused. Drag the view, or move a slider below.';
  else if (st.keyId === 'none') t = 'No key: nothing lifts the stacks, so the plug cannot turn.';
  else if (S.th > 0.5 * D && st.open) t = 'The plug is turned: the key pins sit in the plug, so the key cannot come out until the plug turns back.';
  else if (!st.home) t = want > 0 ? 'The key is not home: the plug does not turn.' : 'Slide the key home to line the cuts up with the chambers.';
  else if (!st.open && want > st.maxTurn) t = `The plug stops at ${(st.maxTurn / D).toFixed(1)}°: ${st.blocked} ${L.pin ? 'stacks cross' : 'wafers stand out across'} the line.`;
  else t = st.open ? 'Every stack is on the shear line. Turn the plug.' : 'Home, but not every stack is on the line.';
  if ($('runNote').textContent !== t) $('runNote').textContent = t;
}

// ── loop ────────────────────────────────────────────────────────────────────
const TINT = new THREE.Color(), RED = new THREE.Color(0.42, 0.05, 0.03);
const OK_COL = new THREE.Color(0x7fe3b0), BAD_COL = new THREE.Color(0xffb35c), camDir = new THREE.Vector3();
let last = performance.now(), raf = 0, running = true, handTick = 0;
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur) return;
  const cur = S.cur, L = cur.L;

  // the cycle or the hand
  let sWant, turnWant;
  if (S.manual) { sWant = S.s; turnWant = S.turnReq; }
  else { S.cycT += dt * S.rate; const c = cycleAt(S.cycT, S.keyId); sWant = c.s; turnWant = c.turn; S.s = sWant; }
  S.explode += (S.explodeTarget - S.explode) * Math.min(1, dt * S.ekRate);
  if (Math.abs(S.explode - S.explodeTarget) < 1e-4) S.explode = S.explodeTarget;
  // explode: the plug turns back first, then the key comes out
  const thK = 1 - ease(S.explode / 0.12), sK = 1 - ease((S.explode - 0.12) / 0.2);
  const lim = L.state(S.keyId, sWant * sK, 90 * D).maxTurn;
  const thGoal = Math.min(turnWant, lim) * thK;
  S.th += (thGoal - S.th) * Math.min(1, dt * 9);
  if (Math.abs(thGoal - S.th) < 1e-5) S.th = thGoal;
  const st = L.state(S.keyId, sWant * sK, S.th);
  S.th = st.theta; S.st = st;
  cur.sc.pose(st, S.explode);
  cur.B.applyExplode(S.explode);

  // a calm red on each part that holds the plug, once the key is home (or none)
  const show = (st.home || S.keyId === 'none' || st.s < 0.001) && S.explode < 0.1 ? 1 : 0;
  st.ch.forEach((q, i) => {
    const tt = cur.tint[i];
    const want = L.pin ? [show && q.cross === 'key' ? 1 : 0, show && q.cross === 'driver' ? 1 : 0] : [show && !q.ok ? 1 : 0, 0];
    for (let j = 0; j < 2; j++) {
      const nv = tt[j] + (want[j] - tt[j]) * Math.min(1, dt * 5);
      if (Math.abs(nv - tt[j]) > 0.004 || (want[j] === 0 && tt[j] !== 0 && nv < 0.004)) {
        tt[j] = nv < 0.004 && want[j] === 0 ? 0 : nv;
        const p = L.pin ? (j ? cur.sc.stacks.dp[i] : cur.sc.stacks.kp[i]) : j ? null : cur.sc.stacks.wf[i];
        if (p) cur.B.setTint(p, TINT.copy(RED).multiplyScalar(tt[j]));
      }
    }
  });
  // the shear line: green when open, amber when not; only assembled, in
  // section, and only when the camera looks at the section face
  camDir.copy(stage.camera.position).sub(stage.controls.target).normalize();
  const shOp = S.shearOn && S.section ? (1 - ease(S.explode / 0.08)) * cur.alpha * ease((camDir.z - 0.72) / 0.2) : 0;
  for (const m of cur.sc.shear) { m.visible = shOp > 0.01; m.material.opacity = 0.95 * shOp; m.material.color.copy(st.open ? OK_COL : BAD_COL); }

  // fade in the new lock, out the old
  const age = (now - cur.t0) / 1000;
  const a = REDUCED ? 1 : ease((age - 0.1) / 0.9);
  if (a !== cur.alpha) { cur.alpha = a; cur.B.setAlpha(Math.max(0.001, a)); }
  for (const old of S.leaving) {
    const t = (now - old.t0) / 600, kk = ease(t);
    old.B.setAlpha(Math.max(0.001, 1 - kk));
    if (t >= 1) old.dead = true;
  }
  for (const old of S.leaving.filter(q => q.dead)) old.B.dispose();
  S.leaving = S.leaving.filter(q => !q.dead);

  // keep the target on the middle of the spread as the parts part
  if (!VIEWS[S.view] || !VIEWS[S.view].at) {
    const k = S.explode - (S.lastShift ?? S.explode);
    S.lastShift = S.explode;
    if (k) stage.shift(new THREE.Vector3(...cur.sc.explodeShift).multiplyScalar(k));
  } else S.lastShift = S.explode;
  stage.frame(dt);
  cards.frame(now, dt);
  ana.frame(st);
  readout(st);
  if (++handTick % 5 === 0) { if (!S.manual) { $('ins').value = st.s * 100; $('insV').textContent = `${Math.round(st.s * 100)}%`; } $('turnV').textContent = `${Math.round(st.theta / D)}°`; if (!S.manual) $('turn').value = st.theta / D; runNote(st, turnWant); }
  if (saverOn) saverTick(dt);
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });

// debug and headless checks
window.__lock = { S, stage, cards, swapTo, setView, setRate, setExplode, setKey, setShow, setOpen, setAna, cycleAt, pinById: id => cards.pinById(id), pick: (x, y) => cards.pick(x, y),
  hand: (s, deg) => { goManual(); S.s = s; S.turnReq = deg * D; syncHand(); } };

// ── boot ────────────────────────────────────────────────────────────────────
buildPickers();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
document.querySelectorAll('#keys .mv').forEach(b => b.classList.toggle('on', b.dataset.key === S.keyId));
setRate(1); setExplode(0); syncHand();
stage.place({ az: 50, el: 22, r: 200, target: new THREE.Vector3(-8, 2, 0) });
const start = (location.hash || '').slice(1);
swapTo(VARIANTS.some(v => v.id === start) ? start : 'pin');
requestAnimationFrame(frame);

// ── screensaver ─────────────────────────────────────────────────────────────
// Hook for the shell (lib/screensaver.js). enter() hides the GUI, draws the
// stage gradient in the scene, and tours one lock: the right key at work,
// the pin stacks on the shear line, a wrong key, the exploded parts, the
// drive at the back, the keyway from the front; then a fade to the other
// lock. Key changes happen behind a fade. Each step holds seconds/4 (at
// least 9 s); calm (1 = slowest) slows the orbit, the cycle and the
// explode. opts.label names the subject of each step. No URL hash writes
// while it plays. No exit(): the shell reloads the page.
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
    setShow('labels', false); setShow('section', true); setShow('shear', true);
    const g2 = document.createElement('canvas'); g2.width = 512; g2.height = 320;
    const c2 = g2.getContext('2d'), rg = c2.createRadialGradient(307, 128, 0, 307, 128, 420);
    rg.addColorStop(0, '#161826'); rg.addColorStop(0.7, '#08090f'); rg.addColorStop(1, '#08090f');
    c2.fillStyle = rg; c2.fillRect(0, 0, 512, 320);
    const bg = new THREE.CanvasTexture(g2); bg.colorSpace = THREE.SRGBColorSpace;
    stage.scene.background = bg;
    stage.orbit = true; stage.orbitK = 1 - 0.6 * calm;
    S.ekRate = 1.6 - 1.0 * calm;
    S.manual = false;
    setRate(+(1 - 0.45 * calm).toFixed(2));
    const hold = Math.max(9, (o.seconds || 60) / 4) * 1000;
    const order = rnd() < 0.5 ? ['pin', 'wafer'] : ['wafer', 'pin'];
    const canvas = $('view');
    const g = () => S.cur.L.g, pin = () => S.cur.L.pin;
    const gapsTxt = () => S.st ? S.st.ch.map(q => (q.gap > 0.0005 ? '+' : q.gap < -0.0005 ? '−' : '') + Math.abs(q.gap).toFixed(2)).join('  ') : '';
    const STEPS = [
      { view: 'three', key: 'right', lab: () => ({ title: g().name, sub: g().kind, lines: [pin() ? 'Five pin stacks tie the plug to the housing' : 'Five wafers reach out of the plug into the housing', 'The right key lines every one up, and the plug turns', S.st && S.st.open ? `Open · plug at ${(S.st.theta / D).toFixed(0)}°` : `${S.st ? S.st.ok : 0} of ${g().n} on the line`], eq: [pin() ? 'yᵢ + kᵢ = R  (each chamber)' : '−R ≤ wafer ≤ R  (each wafer)'] }) },
      { view: 'pins', key: 'right', lab: () => ({ title: pin() ? 'The shear line' : 'Wafers in the plug', sub: pin() ? 'Key pins below, drivers above' : 'The plug surface, top and bottom', lines: [pin() ? 'Each key pin is cut so its top meets the line' : 'Each window top is set by one cut', `Gaps now (mm): ${gapsTxt()}`, `Key in ${Math.round((S.st ? S.st.s : 0) * 100)}%`], eq: [pin() ? 'kᵢ = R − yᵢ*' : 'oᵢ = max(o_rest, hᵢ − wᵢ)'] }) },
      { view: 'section', key: 'wrong', lab: () => ({ title: 'A wrong key', sub: 'Same blank, other cuts', lines: [pin() ? 'Too shallow: a key pin crosses the line' : 'Too high: a wafer stands into the upper groove', pin() ? 'Too deep: a driver stays across it' : 'Too low: a wafer stays in the lower groove', `The plug turns only ${(g().clearance / D).toFixed(1)}°`], eq: [`Gaps (mm): ${gapsTxt()}`] }) },
      { view: 'exploded', key: 'right', lab: () => ({ title: 'Exploded view', sub: `${g().name} · ${g().kind}`, lines: pin() ? ['Springs, drivers and key pins lift out of their chambers', 'The bolt, the cam and the clip come off the back', 'The plug slides out of the front'] : ['The frame stop, the cam bar and the clip come off', 'The plug slides out of the back', 'Its wafers and springs stay in their slots'], eq: [pin() ? `Keyspace ${S.cur.L.keyspace.toLocaleString('en')} of 10⁵ (MACS ${g().key.macs})` : `Keyspace ${S.cur.L.keyspaceRaw.toLocaleString('en')} = 5⁵`] }) },
      { view: 'drive', key: 'right', lab: () => pin() ? ({ title: 'Cam and bolt', sub: 'A Scotch yoke', lines: ['The cam turns with the back of the plug', 'Its pin slides in the slot of the bolt yoke', `Bolt out ${(S.st ? S.st.bolt : 0).toFixed(1)} of ${g().cam.Rc} mm`], eq: ['b = Rc · sin θ'] }) : ({ title: 'Cam bar', sub: 'A quarter turn', lines: ['Locked, the bar hangs behind the frame stop', 'Open, it swings clear', `Plug at ${(S.st ? S.st.theta / D : 0).toFixed(0)}°`], eq: ['θ ≤ 90° only when every wafer is flush'] }) },
      { view: 'keyway', key: 'none', section: false, lab: () => ({ title: 'Keyway and wards', sub: 'Only the right blank goes in', lines: ['Ridges in the keyway ride in grooves in the key', `Cuts ${g().key.angle}° apart, ${g().key.step} mm per depth step`, `${g().key.depths} depths × ${g().n} cuts`], eq: [`cᵢ = c₀ − ${g().key.step} · dᵢ`] }) },
    ];
    let n = 0, ord = 0, stepT = 0, lastLab = '', labT = 0, busy = false;
    const show = s => { setShow('section', s.section !== false); setView(s.view, true); const l = s.lab(); lastLab = JSON.stringify(l); label(l); };
    const fade = async fn => {
      busy = true;
      canvas.style.opacity = '0';
      await new Promise(r => setTimeout(r, 950));
      await fn();
      setTimeout(() => { canvas.style.opacity = '1'; busy = false; }, 250);
    };
    const advance = () => {
      const s = STEPS[n % STEPS.length], first = n === 0;
      const swap = n % STEPS.length === 0 && n > 0;
      if (swap || (!first && s.key !== S.keyId)) fade(async () => { if (swap) await swapTo(order[++ord % order.length]); setKey(s.key); show(s); });
      else { setKey(s.key); show(s); }
      n++;
    };
    saverTick = dt => {
      if (busy) return;
      stepT += dt * 1000; labT += dt;
      if (stepT >= hold) { stepT = 0; advance(); }
      // refresh the plate when its numbers change (at most every 2 s)
      if (labT > 2 && n > 0) {
        labT = 0;
        const l = STEPS[(n - 1) % STEPS.length].lab(), js = JSON.stringify(l);
        if (js !== lastLab) { lastLab = js; label(l); }
      }
    };
    (async () => { if (S.cur && S.cur.L.id !== order[0]) await swapTo(order[0]); advance(); })();
    return { canvas, warmupMs: 1500 };
  },
};
