// ============================================================================
//  PLANETARY GEARBOX  ·  main.js — the set swap, the modes, the loop, saver
// ────────────────────────────────────────────────────────────────────────────
//  Shows one gear set at a time: layout.js for its sizes and explode order,
//  scene.js for its 3D parts (kit.js), gears.js for the speeds and the
//  planet phases, analysis.js for the ratio, the lever and the numbers.
//  stage.js holds the renderer, the upright camera and the gentle orbit;
//  cards.js the part cards and labels.
//
//  MOTION. Two angles are free (simple set: sun and carrier; Simpson: sun and
//  output). Each frame they advance by their solved speeds; every other
//  member angle comes from them (gears.js poseAngles), so the teeth stay in
//  mesh for any run time. The input speed eases to its target, so a mode
//  change or a pause never jumps.
//
//  SET SWAP
//    The old set fades (0.6 s), the new one fades in (0.9 s). A tooth-count
//    change rebuilds the set the same way and keeps the camera.
//
//  GREP MAP
//    function swapTo ............ build a gear set and cross-fade to it
//    function setMode ........... what is held, driven and taken off
//    function setTeeth .......... tooth counts and planet count
//    const VIEWS / function setView  camera presets
//    function setOpen ........... the panel; on a phone one group per tab
//    function liveValue ......... the live rows of the part cards
//    function frame ............. speeds, pose, explode, ghosts, stage, cards
//    window.snSaver ............. screensaver hook: a slow tour
// ============================================================================
import * as THREE from 'three';
import { MODELS, SIMPSON_GEARS, simpleMode, solveSpeeds, poseAngles, ratioOf, planetChoices, bestPlanets, planetAngle, TAU } from './gears.js';
import { layout, VARIANTS, ease } from './layout.js';
import { createBuild } from './kit.js';
import { build } from './scene.js';
import { createStage } from './stage.js';
import { createCards, esc } from './cards.js';
import { createAnalysis, ratioText, fmtRpm, SHORT } from './analysis.js';
import { partsFor, GROUP_COLOR } from './parts.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, leaving: [], variant: 'simple', Zs: 30, Zp: 18, N: 3,
  hold: 'R', input: 'S', gear: '1', md: null, sp1: null,
  rpm: 15, lastRpm: 15, wNow: 0, explode: 0, explodeTarget: 0, ekRate: 2.4,
  showLabels: !PHONE_Q.matches, pitch: false, pitchUser: false, roles: true, view: 'three', anaOpen: !PHONE_Q.matches,
  f: { S: 0, C: 0, C1: 0 }, ang: {}, swapping: false,
};
const ana = createAnalysis({ ratio: $('ratio'), lever: $('lever'), nums: $('nums'), eqs: $('eqs') });
const cards = createCards({
  stage, $, isPhone: () => PHONE_Q.matches,
  get: () => S.cur,
  live: key => liveValue(key),
  gauge: id => gaugeAngle(id),
  // the closed Simpson train hides most parts: label it once it opens (or in a see-through view)
  labelsOn: () => S.showLabels && S.cur.alpha > 0.5 && (S.variant === 'simple' || S.explode > 0.12 || ghostIds().length) ? S.cur.alpha : 0,
  clearLeft: () => PHONE_Q.matches ? 0 : $('panel').getBoundingClientRect().right - $('view').getBoundingClientRect().left,
  clearRight: () => S.anaOpen && !PHONE_Q.matches ? $('anaPanel').getBoundingClientRect().left - $('view').getBoundingClientRect().left : $('view').clientWidth,
  onTap: () => hideHint(),
});
stage.onStart = () => hideHint();
let saverOn = false, saverTick = () => {};   // the screensaver (end of file)

// ── set swap ────────────────────────────────────────────────────────────────
// keep: rebuild the same variant (new teeth) and leave the camera where it is
function swapTo(id, keep = false) {
  if (S.swapping || (!keep && S.cur && S.cur.L.id === id)) return;
  S.swapping = true;
  try {
    S.variant = id;
    const L = layout(id, S.Zs, S.Zp, S.N), B = createBuild(), sc = build(B, L);
    stage.root.add(B.root);
    const next = { L, B, sc, PARTS: partsFor(L), alpha: 0, t0: performance.now(), fast: keep };
    B.setAlpha(0.001);
    B.setPitch(S.pitch);
    B.applyExplode(S.explode);
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now() });
    S.cur = next;
    cards.reset();
    setMode();
    fillPanel(keep);
    const R = Math.max(sc.box.a.R, sc.box.e.R * 0.75);
    stage.setShadowExtent(R, new THREE.Vector3(0, 0, (sc.box.a.c + sc.box.e.c) / 2));
    stage.controls.minDistance = sc.box.a.R * 0.6; stage.controls.maxDistance = sc.box.e.R * 8;
    document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    $('simpleDrive').hidden = id !== 'simple'; $('simpsonDrive').hidden = id === 'simple';
    if (!saverOn) try { history.replaceState(null, '', '#' + id); } catch (e) {}
    if (!keep) setView(S.view || 'three', true);
  } finally { S.swapping = false; }
}

// ── modes ───────────────────────────────────────────────────────────────────
function curMode() {
  if (S.variant === 'simpson') return SIMPSON_GEARS[S.gear];
  return simpleMode(S.hold === 'none' ? null : S.hold, S.input);
}
const ROLE_COL = { in: new THREE.Color(0x03200f), held: new THREE.Color(0x2a0606), out: new THREE.Color(0x221703), '': new THREE.Color(0) };
function setMode() {
  if (!S.cur) return;
  if (S.variant === 'simple' && S.hold === S.input) S.input = S.hold === 'S' ? 'C' : 'S';
  const L = S.cur.L, md = curMode();
  S.md = md;
  S.sp1 = solveSpeeds(MODELS[L.id], L.sets.map(s => s.k), md, 1);
  ana.set(L, md, S.gear, MODELS[L.id]);
  applyRoles();
  document.querySelectorAll('#hold button').forEach(b => b.classList.toggle('on', b.dataset.hold === S.hold));
  document.querySelectorAll('#input button').forEach(b => { b.classList.toggle('on', b.dataset.in === S.input); b.disabled = b.dataset.in === S.hold; });
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('on', b.dataset.h === S.hold && b.dataset.i === S.input));
  document.querySelectorAll('#gears button').forEach(b => b.classList.toggle('on', b.dataset.g === S.gear));
  const rt = ratioText(ratioOf(S.sp1, md));
  if (S.variant === 'simple') {
    $('modeNote').innerHTML = md.direct
      ? 'Sun and carrier locked: no gear can turn on another, so the set turns as one block. Ratio 1 : 1.'
      : `${SHORT[md.hold[0]]} held, ${SHORT[md.input].toLowerCase()} drives, ${SHORT[md.out].toLowerCase()} is the output: <b>${rt.v}</b>, ${rt.kind.split(':')[0].toLowerCase()}.`;
  } else {
    const g = SIMPSON_GEARS[S.gear];
    const all = ['Forward clutch', 'Direct clutch', 'Intermediate band', 'Low/reverse band'];
    $('applyTab').innerHTML = all.map(x => `<tr><td>${x}</td><td>${g.apply.includes(x) || (x === 'Forward clutch' && g.apply.includes('Forward clutch only')) ? 'applied' : ''}</td></tr>`).join('');
    $('gearNote').innerHTML = {
      1: 'Rear carrier held. The front set turns the sun backward; the rear set turns that into a slow forward output. Both sets carry torque.',
      2: 'Sun held by the intermediate band. Only the front set works: ring in, carrier out.',
      3: 'The direct clutch locks the sun to the input. Two members of the front set turn together, so the whole train turns as one.',
      R: 'Sun driven, rear carrier held: the rear set is a plain reverse, ring out.',
      N: 'Nothing held. The front ring turns, the planets turn the sun backward, and no torque reaches the output.',
    }[S.gear] + ` <b>${rt.v}</b>`;
  }
}
// role colours: input green, held red, output amber (bands red when applied)
function applyRoles() {
  if (!S.cur) return;
  const md = S.md, B = S.cur.B;
  for (const id in B.parts) {
    const p = B.parts[id], m = p.L.pose.m;
    let r = m ? ana.role(m) : '';
    if (p.L.kind === 'band') r = (id === 'band1' && md.hold.includes('S')) || (id === 'band2' && md.hold.includes('C2')) ? 'held' : '';
    if (p.L.kind === 'pins' && r === 'held') r = '';
    B.setRole(p, ROLE_COL[S.roles ? r : '']);
  }
}
document.querySelectorAll('#hold button').forEach(b => b.addEventListener('click', () => { S.hold = b.dataset.hold; setMode(); }));
document.querySelectorAll('#input button').forEach(b => b.addEventListener('click', () => { if (b.dataset.in !== S.hold) { S.input = b.dataset.in; setMode(); } }));
document.querySelectorAll('#presets button').forEach(b => b.addEventListener('click', () => { S.hold = b.dataset.h; S.input = b.dataset.i; setMode(); }));
document.querySelectorAll('#gears button').forEach(b => b.addEventListener('click', () => { S.gear = b.dataset.g; setMode(); }));

// ── teeth ───────────────────────────────────────────────────────────────────
let teethT = 0;
function setTeeth(zs, zp, n, rebuild = true) {
  S.Zs = zs; S.Zp = zp;
  const ch = planetChoices(zs, zp);
  S.N = ch.includes(n) ? n : bestPlanets(zs, zp);
  $('zs').value = zs; $('zp').value = zp;
  $('zsV').textContent = zs; $('zpV').textContent = zp;
  const zr = zs + 2 * zp;
  $('zrV').textContent = `${zs} + 2·${zp} = ${zr}`;
  $('planets').innerHTML = [2, 3, 4, 5, 6].map(k => `<button type="button" data-n="${k}"${ch.includes(k) ? '' : ' disabled'}${k === S.N ? ' class="on"' : ''}>${k}</button>`).join('');
  $('planets').querySelectorAll('button').forEach(b => b.addEventListener('click', () => setTeeth(S.Zs, S.Zp, +b.dataset.n)));
  const k = zr / zs;
  $('teethNote').innerHTML = `Equal spacing needs (Z<sub>s</sub> + Z<sub>r</sub>) ⁄ N whole: ${zs + zr} ⁄ N. ` +
    `Ring held, sun in: i = 1 + Z<sub>r</sub>/Z<sub>s</sub> = ${(1 + k).toFixed(3)}.` + (zs < 17 || zp < 17 ? ' Below 17 teeth a 20° tooth is undercut at the root.' : '');
  if (rebuild && S.cur) { clearTimeout(teethT); teethT = setTimeout(() => swapTo(S.variant, true), 120); }
}
$('zs').addEventListener('input', e => setTeeth(+e.target.value, S.Zp, S.N));
$('zp').addEventListener('input', e => setTeeth(S.Zs, +e.target.value, S.N));

// ── panel content ───────────────────────────────────────────────────────────
const ABOUT = [
  ['Three members, two degrees of freedom', 'Sun, carrier and ring can all turn. Fix one and the other two are geared together; drive one of those and take the power off the last. Lock any two together and the set turns as one block.'],
  ['The Willis equation', 'Ride on the carrier and the set is an ordinary gear train: the sun turns the planets, the planets turn the ring the other way, at Zs/Zr. So (ωs − ωc) / (ωr − ωc) = −Zr/Zs, whatever the carrier does.'],
  ['Why automatic gearboxes use them', 'The shafts are all on one axis and the load is shared by several planets, so the set is small for its torque. A band or a clutch can hold or join members while the gears stay in mesh: a gear change with no sliding gears.'],
  ['Real teeth', 'The teeth here are involutes of a 20° pressure angle. The sun and planets have a module of the same size, so the ring needs Zr = Zs + 2Zp teeth, and the planets fit evenly only when (Zs + Zr)/N is a whole number.'],
  ['What the model leaves out', 'No friction and no tooth deflection: power in equals power out, so the output torque is the ratio times the input torque. Real sets lose one to three percent per mesh.'],
];
function fillPanel(keep) {
  const L = S.cur.L, v = VARIANTS.find(q => q.id === L.id), box = $('engInfo');
  box.classList.add('fading');
  setTimeout(() => {
    $('engTitle').textContent = v.name;
    $('engKind').textContent = v.kind;
    $('engLede').textContent = v.blurb;
    const seen = new Set(), P = S.cur.PARTS;
    const ids = Object.values(S.cur.B.parts).map(q => q.info).filter(id => P[id] && !seen.has(id) && seen.add(id));
    $('partList').innerHTML = ids.map(id => `<button type="button" data-part="${id}" style="--gc:${GROUP_COLOR[P[id].group] || '#e9c27a'}"><i></i>${esc(P[id].name)}</button>`).join('');
    $('partList').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { cards.pinById(b.dataset.part); if (PHONE_Q.matches) setOpen(false); }));
    $('about').innerHTML = ABOUT.map(([h, t]) => `<p><b>${esc(h)}.</b> ${esc(t)}</p>`).join('');
    box.classList.remove('fading');
  }, keep ? 0 : 200);
}
function buildPicker() {
  $('variants').innerHTML = VARIANTS.map(v => `<button class="mv" type="button" data-id="${v.id}"><b>${esc(v.name)}</b><span>${esc(v.kind)}</span></button>`).join('');
  $('variants').querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => swapTo(b.dataset.id)));
}

// ── views ───────────────────────────────────────────────────────────────────
// face and mesh views look through the plate in front (ghost) at the teeth
const GHOST = { simple: { front: ['carrierF', 'pins'], back: ['carrierB'] }, simpson: { front: ['c2Drum', 'sunDrum', 'band1', 'band2', 'c2Front'], back: ['inWeb', 'c1Front'] } };
// in those views only the parts in the face keep a label
const FACE_LABELS = { simple: ['sun', 'ring', 'p0_0'], simpson: ['sun', 'ring1', 'p0_0'] };
const VIEWS = {
  three: { az: 38, el: 18, explode: 0, k: 1 },
  face: { az: 0, el: 0, explode: 0, k: 0.9, ghost: 'face', pitch: true },
  mesh: { az: 8, el: 6, explode: 0, k: 0.55, ghost: 'face', pitch: true, mesh: true },
  side: { az: 90, el: 4, explode: 0, k: 1.05 },
  back: { az: 150, el: 16, explode: 0, k: 1 },
  exploded: { az: 46, el: 22, explode: 1, k: 1.12 },
};
// the face the face views look at: simple +z (output side), Simpson −z (input side)
const faceSide = () => S.variant === 'simple' ? 1 : -1;
function viewTarget(v, e) {
  const box = S.cur.sc.box, L = S.cur.L;
  if (v.mesh) { const T = L.sets[0]; return new THREE.Vector3(0, T.a * 0.55, faceSide() > 0 ? T.b / 2 : T.z - T.b / 2); }
  return new THREE.Vector3(0, 0, box.a.c + (box.e.c - box.a.c) * e);
}
// a narrow portrait screen sees the long axis across its short side: step back
const fitDist = e => {
  const b = S.cur.sc.box, v = $('view'), narrow = v.clientWidth / Math.max(1, v.clientHeight) < 0.75 ? 1.3 : 1;
  return (b.a.R + (b.e.R - b.a.R) * e) * 3.7 * narrow * (saverOn ? 0.86 : 1);
};
function ghostIds() {
  const v = VIEWS[S.view];
  if (!v || !v.ghost) return [];
  return GHOST[S.variant][faceSide() > 0 ? 'front' : 'back'];
}
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const v = VIEWS[name];
  const az = v.ghost && faceSide() < 0 ? v.az + 180 : v.az;
  stage.flyTo({ az, el: v.el, r: fitDist(v.explode) * v.k, target: viewTarget(v, v.explode), t: soft ? 1.6 : 1.4 });
  setExplode(v.explode);
  if (!S.pitchUser) setPitch(!!v.pitch, false);
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ── controls ────────────────────────────────────────────────────────────────
function setExplode(x) {
  S.explodeTarget = x;
  $('explode').value = x; $('explodeV').textContent = Math.round(x * 100) + '%';
}
$('explode').addEventListener('input', e => setExplode(+e.target.value));
// the buttons also move the camera: the exploded set is about twice as long
$('assemble').addEventListener('click', () => S.view === 'exploded' ? setView('three') : setExplode(0));
$('burst').addEventListener('click', () => VIEWS[S.view] && VIEWS[S.view].ghost ? setExplode(1) : setView('exploded'));
function setRpm(r) {
  r = Math.max(0, Math.min(60, r));
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
function setPitch(on, user = true) {
  S.pitch = on; if (user) S.pitchUser = true;
  $('tPitch').classList.toggle('on', on);
  for (const o of [S.cur, ...S.leaving]) if (o) o.B.setPitch(on);
}
function setShow(what, on) {
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
  if (what === 'roles') { S.roles = on; $('tRoles').classList.toggle('on', on); applyRoles(); }
  if (what === 'pitch') setPitch(on);
}
$('tLabels').addEventListener('click', () => setShow('labels', !S.showLabels));
$('tOrbit').addEventListener('click', () => setShow('orbit', !stage.orbit));
$('tRoles').addEventListener('click', () => setShow('roles', !S.roles));
$('tPitch').addEventListener('click', () => setShow('pitch', !S.pitch));

// ── panels: left controls, right analysis; on a phone one sheet ─────────────
const panel = $('panel'), tabs = [...document.querySelectorAll('#dock .tab')], anaSec = $('anaSec'), anaPanel = $('anaPanel');
let grp = 'set';
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
  if (open && grp === 'maths') setTimeout(() => ana.redraw(), 60);
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
let LV = null;   // this frame: { sp: rpm per member, pspin: [rpm per set] }
function liveValue(key) {
  if (!LV || !S.cur) return [key, '—'];
  const [k, a] = key.split(':');
  switch (k) {
    case 'w': return ['Speed', fmtRpm(LV.sp[a])];
    case 'role': { const r = ana.role(a); return ['Role', r === 'in' ? 'input' : r === 'held' ? 'held' : r === 'out' ? 'output' : 'free']; }
    case 'pspin': return ['Spin on its pin', fmtRpm(LV.pspin[+a])];
    case 'band': return ['Band', (a === 'band1' && S.md.hold.includes('S')) || (a === 'band2' && S.md.hold.includes('C2')) ? 'applied' : 'released'];
  }
  return [key, '—'];
}
function gaugeAngle(info) {
  if (!S.cur) return 0;
  for (const id in S.cur.B.parts) { const p = S.cur.B.parts[id]; if (p.info === info) return p.root.rotation.z; }
  return 0;
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 6) return;
  const md = S.md, rt = ratioText(ratioOf(S.sp1, md));
  const head = S.variant === 'simple'
    ? (md.direct ? 'Direct drive' : `${SHORT[md.hold[0]]} held · ${SHORT[md.input].toLowerCase()} in · ${SHORT[md.out].toLowerCase()} out`)
    : `Gear ${SIMPSON_GEARS[S.gear].name} · ${SIMPSON_GEARS[S.gear].apply.join(' + ').toLowerCase()}`;
  const h = `<span class="hi">${esc(head)}</span><br><span class="lo">i =</span> ${rt.v} <span class="lo">· in</span> ${fmtRpm(LV.sp[md.input])} <span class="lo">· out</span> ${fmtRpm(LV.sp[md.out])}`;
  if ($('read')._h !== h) { $('read').innerHTML = h; $('read')._h = h; }
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true;
const ghostSet = new Set();
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!S.cur || !S.sp1) return;
  const cur = S.cur, L = cur.L, model = MODELS[L.id], ks = L.sets.map(s => s.k);

  // speed: the input eases to its target; two free angles advance
  const wT = S.rpm / 60 * TAU;
  S.wNow += (wT - S.wNow) * Math.min(1, dt * (saverOn ? 0.9 : 2.2));
  if (Math.abs(S.wNow) < 1e-4 && !wT) S.wNow = 0;
  // no wrap: a wrap of one free angle by whole turns moves the derived
  // angles (rear carrier, planets) by part of a turn, so the parts jumped.
  // A double keeps sub-micro-radian steps for years of run time.
  for (const m of model.free) S.f[m] += S.sp1[m] * S.wNow * dt;
  const ang = poseAngles(L.id, ks, S.f);
  S.ang = ang;
  const rpmNow = S.wNow / TAU * 60, sp = {};
  for (const m of model.members) sp[m] = S.sp1[m] * rpmNow;
  const pspin = L.sets.map((T, j) => { const ms = model.sets[j]; return -(T.Zs / T.Zp) * (sp[ms.s] - sp[ms.c]); });
  LV = { sp, pspin };

  S.explode += (S.explodeTarget - S.explode) * Math.min(1, dt * S.ekRate);
  if (Math.abs(S.explodeTarget - S.explode) < 1e-4) S.explode = S.explodeTarget;
  cur.B.applyExplode(S.explode);
  cur.sc.pose(ang);

  // ghosts: the plate in front fades in the face views
  const gh = ghostIds();
  for (const id in cur.B.parts) {
    const p = cur.B.parts[id], want = gh.includes(id) ? 0.1 : 1;
    p.noLabel = gh.length > 0 && !FACE_LABELS[L.id].includes(id);
    if (Math.abs(p.ga - want) > 0.004) cur.B.setPartAlpha(p, p.ga + (want - p.ga) * Math.min(1, dt * 5));
    else if (p.ga !== want) cur.B.setPartAlpha(p, want);
  }

  // fade in the new set, out the old
  const age = (now - cur.t0) / 1000;
  const a = REDUCED ? 1 : ease((age - (cur.fast ? 0 : 0.1)) / (cur.fast ? 0.35 : 0.9));
  if (a !== cur.alpha) { cur.alpha = a; cur.B.setAlpha(Math.max(0.001, a)); }
  for (const old of S.leaving) {
    const t = (now - old.t0) / (old.fast || cur.fast ? 250 : 600), kk = ease(t);
    old.B.setAlpha(Math.max(0.001, 1 - kk));
    old.sc.pose(ang);
    if (t >= 1) old.dead = true;
  }
  for (const old of S.leaving.filter(q => q.dead)) old.B.dispose();
  S.leaving = S.leaving.filter(q => !q.dead);

  // keep the target on the middle of the spread as the parts part
  const V = VIEWS[S.view];
  if (!V || !V.mesh) {
    const b = cur.sc.box, tz = (b.e.c - b.a.c) * S.explode, dz = tz - (S.lastTz ?? tz);
    S.lastTz = tz;
    stage.shift(new THREE.Vector3(0, 0, dz));
  } else S.lastTz = (cur.sc.box.e.c - cur.sc.box.a.c) * S.explode;
  stage.frame(dt);
  cards.frame(now, dt);
  ana.frame({ sp, pspin, ratio: ratioOf(S.sp1, S.md) });
  readout();
  if (saverOn) saverTick(dt);
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });

// debug and headless checks
window.__planetary = { S, stage, cards, swapTo, setView, setRpm, setExplode, setTeeth, setShow, setOpen, setAna,
  setMode: (o = {}) => { Object.assign(S, o); setMode(); }, pinById: id => cards.pinById(id), pick: (x, y) => cards.pick(x, y), planetAngle };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
setRpm(15); setExplode(0); setTeeth(30, 18, 3, false);
stage.place({ az: 70, el: 24, r: 900, target: new THREE.Vector3(0, 0, 0) });
const start = (location.hash || '').slice(1);
swapTo(VARIANTS.some(v => v.id === start) ? start : 'simple');
requestAnimationFrame(frame);

// ── screensaver ─────────────────────────────────────────────────────────────
// Hook for the shell (lib/screensaver.js). enter() hides the GUI, draws the
// stage gradient in the scene, and tours: the simple set in reduction,
// overdrive and reverse, the gear face with the pitch circles, the exploded
// parts; then a fade to the Simpson train through 1st, 2nd, 3rd and reverse
// and its exploded view; then back, with new tooth counts. Each step holds
// seconds/4 (at least 9 s); calm (1 = slowest) slows the orbit, the gears and
// the explode. A mode change eases the input to a stop and back up. opts.label
// names the subject of each step. No URL hash writes while it plays.
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
    setShow('labels', false); setShow('roles', true);
    S.pitchUser = false;
    const g = document.createElement('canvas'); g.width = 512; g.height = 320;
    const c2 = g.getContext('2d'), rg = c2.createRadialGradient(307, 128, 0, 307, 128, 420);
    rg.addColorStop(0, '#161826'); rg.addColorStop(0.7, '#08090f'); rg.addColorStop(1, '#08090f');
    c2.fillStyle = rg; c2.fillRect(0, 0, 512, 320);
    const bg = new THREE.CanvasTexture(g); bg.colorSpace = THREE.SRGBColorSpace;
    stage.scene.background = bg;
    stage.orbit = true; stage.orbitK = 1 - 0.6 * calm;
    S.ekRate = 1.5 - 0.9 * calm;
    const runRpm = Math.round(16 - 9 * calm);
    setRpm(runRpm);
    const hold = Math.max(9, (o.seconds || 60) / 4) * 1000;
    // tooth sets the tour may pick (all assemble with 3 planets)
    const TEETH = [[30, 18], [24, 18], [36, 15], [27, 21], [33, 18], [21, 15]];
    const fmt = (v, n = 3) => (Math.abs(v) < 0.0005 ? 0 : v).toFixed(n).replace('-', '−');
    const T0 = () => S.cur.L.sets[0];
    const iNow = () => ratioOf(S.sp1, S.md);
    const sim = (h, i) => ({ hold: h, input: i });
    const STEPS = [
      { v: 'simple', view: 'three', mode: sim('R', 'S'), lab: () => ({ title: 'Planetary gear set', sub: 'Ring held · sun in · carrier out', lines: [`Sun ${T0().Zs} · planets ${T0().Zp} (×${T0().N}) · ring ${T0().Zr} teeth`, 'The planets roll round inside the held ring', `Reduction ${fmt(iNow(), 2)} : 1, torque × ${fmt(iNow(), 2)}`], eq: ['(ωs − ωc) / (ωr − ωc) = −Zr/Zs', `i = 1 + Zr/Zs = ${fmt(1 + T0().k)}`] }) },
      { v: 'simple', view: 'face', mode: sim('R', 'S'), lab: () => ({ title: 'Pitch circles', sub: 'Rolling without slip', lines: ['Each pair of pitch circles touches at one point', 'Riding on the carrier, the set is a plain gear train', `Zr = Zs + 2Zp = ${T0().Zs} + 2·${T0().Zp} = ${T0().Zr}`], eq: ['Zs ωs + Zr ωr = (Zs + Zr) ωc'] }) },
      { v: 'simple', view: 'back', mode: sim('S', 'C'), lab: () => ({ title: 'Overdrive', sub: 'Sun held · carrier in · ring out', lines: ['The ring turns faster than the input', `Ratio ${fmt(iNow())} : 1`, 'Output faster, torque down'], eq: [`i = Zr/(Zs + Zr) = ${fmt(T0().Zr / (T0().Zs + T0().Zr))}`] }) },
      { v: 'simple', view: 'three', mode: sim('C', 'S'), lab: () => ({ title: 'Reverse', sub: 'Carrier held · sun in · ring out', lines: ['With the carrier still, the planets are idlers', 'The ring turns the other way', `Ratio ${fmt(iNow(), 2)} : 1`], eq: [`i = −Zr/Zs = ${fmt(-T0().k)}`] }) },
      { v: 'simple', view: 'exploded', mode: sim('R', 'S'), lab: () => ({ title: 'Exploded view', sub: 'Simple planetary set', lines: ['Output carrier plate and planet pins come off first', 'The ring slides back along the input shaft', `${T0().N} planets move out from the sun`], eq: [`(Zs + Zr)/N = ${(T0().Zs + T0().Zr)}/${T0().N} = ${(T0().Zs + T0().Zr) / T0().N}`] }) },
      { v: 'simple', view: 'mesh', mode: sim('R', 'S'), lab: () => ({ title: 'Tooth mesh', sub: 'Involute teeth, 20° pressure angle', lines: ['The sun meshes with every planet at once', 'The load is shared between the planets', 'Each planet spins on needle rollers'], eq: ['ωp − ωc = −(Zs/Zp)(ωs − ωc)'] }) },
      { v: 'simpson', view: 'three', gear: '1', lab: () => ({ title: 'Simpson gear train · 1st', sub: 'Low/reverse band holds the rear carrier', lines: ['Two sets share one long sun', 'Front carrier and rear ring are the output', `Ratio ${fmt(iNow(), 2)} : 1`], eq: [`i₁ = 2 + Zs/Zr = ${fmt(2 + 1 / T0().k)}`] }) },
      { v: 'simpson', view: 'three', gear: '2', lab: () => ({ title: '2nd gear', sub: 'Intermediate band holds the sun', lines: ['Only the front set carries torque', 'Front ring in, front carrier out', `Ratio ${fmt(iNow(), 2)} : 1`], eq: [`i₂ = 1 + Zs/Zr = ${fmt(1 + 1 / T0().k)}`] }) },
      { v: 'simpson', view: 'side', gear: '3', lab: () => ({ title: '3rd gear', sub: 'Direct clutch locks the sun to the input', lines: ['Two members of a set turn together', 'So the whole train turns as one', 'Ratio 1 : 1'], eq: ['i₃ = 1'] }) },
      { v: 'simpson', view: 'back', gear: 'R', lab: () => ({ title: 'Reverse', sub: 'Sun driven · rear carrier held', lines: ['The rear set alone: sun in, ring out', 'The output turns backward', `Ratio ${fmt(iNow(), 2)} : 1`], eq: [`iR = −Zr/Zs = ${fmt(-T0().k)}`] }) },
      { v: 'simpson', view: 'exploded', gear: '1', lab: () => ({ title: 'Exploded view', sub: 'Simpson gear train', lines: ['Input shell, front ring and front carrier forward', 'Sun drum, bands, rear carrier and rear ring back', 'The output drum stays on the sun'], eq: ['Zs ωs + Zr ωr = (Zs + Zr) ωc  (each set)'] }) },
    ];
    let n = 0, stepT = 0, lastLab = '', labT = 0, busy = false;
    const canvas = $('view');
    const showLab = s => { const l = s.lab(); lastLab = JSON.stringify(l); label(l); };
    const wait = ms => new Promise(r => setTimeout(r, ms));
    // ease the input to a stop, change the mode, ease back up
    const modeSwap = async s => {
      setRpm(0); await wait(1300 + 900 * calm);
      if (s.mode) { S.hold = s.mode.hold; S.input = s.mode.input; }
      if (s.gear) S.gear = s.gear;
      setMode(); setRpm(runRpm);
    };
    const fadeSwap = async s => {
      canvas.style.opacity = '0';
      await wait(950);
      if (s.v === 'simple') { const t = TEETH[Math.floor(rnd() * TEETH.length)]; setTeeth(t[0], t[1], 3, false); }
      if (s.mode) { S.hold = s.mode.hold; S.input = s.mode.input; }
      if (s.gear) S.gear = s.gear;
      S.view = s.view;
      swapTo(s.v);
      setExplode(VIEWS[s.view].explode); S.explode = S.explodeTarget;
      setTimeout(() => { canvas.style.opacity = '1'; }, 250);
    };
    const advance = async () => {
      busy = true;
      const s = STEPS[n % STEPS.length];
      try {
        if (!S.cur || S.cur.L.id !== s.v) await fadeSwap(s);
        else if ((s.mode && (s.mode.hold !== S.hold || s.mode.input !== S.input)) || (s.gear && s.gear !== S.gear)) { setView(s.view, true); await modeSwap(s); }
        setView(s.view, true);
        showLab(s);
      } finally { busy = false; }
      n++;
    };
    saverTick = dt => {
      stepT += dt * 1000; labT += dt;
      if (stepT >= hold && !busy) { stepT = 0; advance(); }
      if (labT > 2 && n > 0 && !busy) {
        labT = 0;
        const l = STEPS[(n - 1) % STEPS.length].lab(), js = JSON.stringify(l);
        if (js !== lastLab) { lastLab = js; label(l); }
      }
    };
    // first step: start from a seeded tooth set, then follow the order
    { const t = TEETH[Math.floor(rnd() * TEETH.length)]; setTeeth(t[0], t[1], 3, false); }
    n = rnd() < 0.5 ? 0 : 6;
    S.hold = 'R'; S.input = 'S'; S.gear = '1';
    S.view = STEPS[n].view;
    swapTo(STEPS[n].v, S.cur && S.cur.L.id === STEPS[n].v);
    setMode();
    advance();
    return { canvas, warmupMs: 1500 };
  },
};
