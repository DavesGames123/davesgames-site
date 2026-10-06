// ============================================================================
//  PUMPS  ·  main.js — pump swap, run, panels, plot, loop, saver
// ----------------------------------------------------------------------------
//  Shows one pump at a time: mech.js for the geometry, the flow and the
//  pocket states, scene.js for its 3D parts (kit.js), stage.js for the
//  renderer and the camera, cards.js for the part cards and labels. A copy
//  of the swashplate-pump main.js with the pump text, the volume and
//  ripple plot and a face-on saver tour.
//
//  MOTION
//    One angle drives everything: S.th, the drive shaft angle (rad). Each
//    frame adds rpm / 60 * 2 pi * dt. sc.pose(S.th) turns the rotors,
//    places the vanes, colours the pockets and returns the pump pose
//    (q, qMean, pockets or chambers). The hand slider sets S.th and
//    pauses the drive.
//
//  GREP MAP
//    function swapTo ............ build a pump and cross-fade to it
//    const INFO / ABOUT ......... the panel text of each pump
//    const VIEWS / function setView  camera presets
//    function curves / drawPlot . delivered volume and ripple over one turn
//    function fillNums / fillEqs  numbers and relations
//    function liveValue ......... the live rows of the part cards
//    function frame ............. step, pose, explode, stage, cards, plot
//    window.snSaver ............. screensaver hook: a tour of each pump,
//                                 face on (azRange -60..60, flat moves)
// ============================================================================
import * as THREE from 'three';
import { UNITS, unit, TAU, flowCurve, displacement, rippleOf, gearDims } from './mech.js';
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
const RATED = 1500;   // rpm for the rated flow

const stage = createStage({ canvas: $('view'), occluders: [$('panel'), $('anaPanel')], band: () => saverBand, coarse: COARSE, reduced: REDUCED, onNoGL: () => { $('nogl').hidden = false; } });
const S = {
  cur: null, leaving: [], th: 0.3, rpm: 10, lastRpm: 10, Q: null, view: 'three',
  explode: 0, explodeTarget: 0, base: true, fluid: true, showLabels: !PHONE_Q.matches, swapping: false,
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

// ── pump swap ───────────────────────────────────────────────────────────────
const fluidParts = B => Object.values(B.parts).filter(q => q.info === 'pocket');
async function swapTo(id) {
  if (S.swapping || (S.cur && S.cur.id === id)) return;
  S.swapping = true;
  try {
    const B = createBuild(), sc = build(B, id);
    const next = { id, B, sc, PARTS: partsFor(id), alpha: 0, t0: performance.now() };
    B.setAlpha(0.001);
    B.setSection(false);
    B.parts.base.holder.visible = S.base;
    for (const q of fluidParts(B)) q.holder.visible = S.fluid;
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
  gear: { title: 'External gear pump', kind: 'Two spur gears · 12 teeth', lede: 'The drive gear turns the idler. Each tooth space on the outer side of a gear is a pocket: it fills at the inlet, runs sealed along the bore wall and empties at the outlet. In the middle the teeth mesh, and a tooth fills each space, so the fluid cannot go back.' },
  vane: { title: 'Sliding-vane pump', kind: 'Offset rotor · 9 vanes', lede: 'The rotor sits off the centre of the cam ring. Its vanes slide out against the ring, so each chamber between two vanes grows over the inlet kidney and shrinks over the outlet kidney. Set the offset to zero and the chambers do not change: no flow.' },
  roots: { title: 'Roots blower', kind: 'Two lobes · cycloidal', lede: 'Two figure-eight rotors turn the other way at the same speed. Each half turn a lobe traps a pocket of air against the casing and carries it round to the outlet. The rotors do not squeeze the air: the outlet gas flows back into the pocket as it opens.' },
};
const ABOUT = {
  gear: [
    ['Displacement', 'q = b (Ra² − r² − u²) per radian, where u is the distance of the sealing contact from the pitch point. u runs from −pb/2 to pb/2 once per tooth, so V = 2π b (Ra² − r² − pb²/12).'],
    ['Why it ripples', 'The contact slides along the line of action. Near the pitch point the meshing teeth give back little volume; at the ends of the contact path they give back more. The flow has one pulse per tooth, 12 a turn here.'],
    ['Trapped volume', 'With a contact ratio over 1, two tooth pairs touch for a while and close a small volume between them. Relief grooves in the side plates vent it; without them the pressure spikes and the pump is loud.'],
  ],
  vane: [
    ['Chamber area', 'A vane at φ reaches ρ(φ) = e cos φ + √(R² − e² sin² φ). The fluid area between two vanes is ½ ∫ (ρ² − r²) dφ, less the vane thickness.'],
    ['Delivery', 'The chambers open to the outlet lose area at q / b = ½(ρT² − ρF²) plus a vane term, from the two vanes at their edges. V ≈ 4π R e b for thin vanes.'],
    ['Odd vane counts', 'The flow steps each time a vane crosses an edge of a kidney. With an odd count, a vane enters one kidney half a pitch after another leaves the other, so the steps are small and many: 9 vanes ripple less than 8 or 10.'],
  ],
  roots: [
    ['The lobes', 'Each lobe is an epicycloid and each waist a hypocycloid of one rolling circle of radius r/4. A lobe and the waist it meets come from the same circle, so they stay in contact.'],
    ['Displacement', 'The contact runs on the rolling circles through the pitch point: |PC| = 2a |sin 2ψ|. Then q = b (Ra² − r² − |PC|²), and V = 2π b (Ra² − r² − 2a²): the same as the carried volume 2b (π Ra² − rotor area).'],
    ['Ripple', 'Two lobes give four pockets a turn, so the flow pulses four times a turn and the ripple is large: 22%. Three-lobe rotors and helical lobes smooth it.'],
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
// az 0 looks from +z, at the open face of the pump. at: 'box' (the box
// centre) or a key point of the scene (sc.keys, world coordinates).
const VIEWS = {
  three: { az: 26, el: 16, explode: 0, k: 0.95, at: 'box' },
  front: { az: 0, el: 3, explode: 0, k: 0.92, at: 'box' },
  mesh: { az: -16, el: 14, explode: 0, k: 0.46, at: 'mesh' },
  pocket: { az: 28, el: 18, explode: 0, k: 0.46, at: 'pocket' },
  side: { az: 64, el: 12, explode: 0, k: 0.95, at: 'box' },
  exploded: { az: 38, el: 18, explode: 1, k: 1.35, at: 'box' },
};
function fitDist(k) {
  const c = $('view'), a = c.clientWidth / Math.max(1, c.clientHeight);
  const wide = a < 1.1 ? 1 + 0.9 * (1.1 - a) * Math.min(1, k) : 1;
  return S.cur.sc.box.R * 3.3 * k * wide;
}
function setView(name, soft) {
  if (!S.cur) return;
  S.view = name;
  const v = VIEWS[name], sc = S.cur.sc, at = v.at === 'box' ? sc.box.c : sc.keys[v.at];
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
  if (what === 'fluid') { S.fluid = on; $('tFluid').classList.toggle('on', on); for (const o of [S.cur, ...S.leaving]) if (o) for (const q of fluidParts(o.B)) q.holder.visible = on; }
  if (what === 'labels') { S.showLabels = on; $('tLabels').classList.toggle('on', on); }
  if (what === 'orbit') { stage.orbit = on; $('tOrbit').classList.toggle('on', on); }
}
$('tBase').addEventListener('click', () => setShow('base', !S.base));
$('tFluid').addEventListener('click', () => setShow('fluid', !S.fluid));
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

// ── volume and ripple ───────────────────────────────────────────────────────
// Over one shaft turn th in [0, 360): the top band holds the volume
// delivered since th = 0, as a fraction of V (solid), against the mean
// rate (dashed). The bottom band holds q / q_mean - 1 for this pump (solid)
// and for the other two (thin, dashed), on one scale.
const COL = { gear: '#8fb0ff', vane: '#8fe0c0', roots: '#e9a0a8', v: '#e2c27a', m: 'rgba(226,194,122,0.4)' };
const CURVE = {};
function flowOf(id) {
  if (CURVE[id]) return CURVE[id];
  const u = unit(id), N = 720, q = flowCurve(u, N), m = displacement(u) / TAU, cum = [0];
  for (let j = 1; j <= N; j++) cum.push(cum[j - 1] + (q[j - 1] + q[j]) / 2 * TAU / N);
  return (CURVE[id] = { q, m, dev: q.map(x => x / m - 1), cum: cum.map(x => x / displacement(u)), N });
}
function drawPlot() {
  const c = $('plot'), r = c.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; plotCache = null; }
  const g = c.getContext('2d');
  if (!plotCache) {
    const id = S.cur.id, C = flowOf(id), off = document.createElement('canvas'); off.width = w; off.height = h;
    const o = off.getContext('2d'), pad = 10 * dpr, X = deg => pad + (w - 2 * pad) * deg / 360;
    const split = h * 0.46, top0 = pad + 4 * dpr, top1 = split - 4 * dpr, mid = (split + h - pad) / 2, half = (h - pad - split) / 2 - 2 * dpr;
    const span = 1.1 * Math.max(...UNITS.map(u => Math.max(...flowOf(u.id).dev.map(Math.abs))));
    o.strokeStyle = 'rgba(217,179,106,0.12)'; o.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const x = X(k * 90); o.beginPath(); o.moveTo(x, pad); o.lineTo(x, h - pad); o.stroke(); }
    o.beginPath(); o.moveTo(pad, mid); o.lineTo(w - pad, mid); o.stroke();
    o.beginPath(); o.moveTo(pad, split); o.lineTo(w - pad, split); o.stroke();
    const line = (arr, y, col, wd, dash) => {
      o.strokeStyle = col; o.lineWidth = wd * dpr; o.setLineDash(dash ? [4 * dpr, 3 * dpr] : []); o.beginPath();
      arr.forEach((v, i) => { const xx = X(360 * i / (arr.length - 1)), yy = y(v); i ? o.lineTo(xx, yy) : o.moveTo(xx, yy); });
      o.stroke(); o.setLineDash([]);
    };
    const yV = v => top1 - v * (top1 - top0), yQ = v => mid - v / span * half;
    line([0, 1], yV, COL.m, 1.2, true);
    line(C.cum, yV, COL.v, 1.8);
    for (const u of UNITS) if (u.id !== id) line(flowOf(u.id).dev, yQ, COL[u.id], 1, true);
    line(C.dev, yQ, COL[id], 1.9);
    o.fillStyle = 'rgba(141,144,166,0.9)'; o.font = `${10 * dpr}px ui-monospace,Menlo,monospace`;
    ['0°', '90°', '180°', '270°'].forEach((t, k) => o.fillText(t, X(k * 90) + 3 * dpr, h - pad - 3 * dpr));
    o.fillText(`V = ${(displacement(unit(id)) / 1000).toFixed(1)} cm³`, pad + 3 * dpr, top0 + 8 * dpr);
    o.fillText(`±${(span * 100).toFixed(0)}%`, pad + 3 * dpr, split + 12 * dpr);
    $('legend').innerHTML = [['lv', 'volume delivered / V', COL.v], ...UNITS.map(u => [u.id === id ? 'lq' : 'lx', `ripple, ${u.name.toLowerCase()}`, COL[u.id]])]
      .map(([k, t, col]) => `<span class="${k}"><i style="${k === 'lx' ? `background:none;height:0;border-top:2px dashed ${col}` : `background:${col}`}"></i>${t}</span>`).join('');
    plotCache = { off, X };
  }
  g.clearRect(0, 0, w, h); g.drawImage(plotCache.off, 0, 0);
  const ph = ((S.th % TAU) + TAU) % TAU * DEG, x = plotCache.X(ph);
  g.strokeStyle = 'rgba(255,224,170,0.85)'; g.lineWidth = 1.2 * dpr; g.beginPath(); g.moveTo(x, 4 * dpr); g.lineTo(x, h - 4 * dpr); g.stroke();
}
const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
let lastNums = '';
const RIP = {};
const ripOf = u => RIP[u.id] || (RIP[u.id] = rippleOf(u));
const Lmin = (u, rpm) => displacement(u) * rpm * 1e-6;
const states = Q => { const s = { inlet: 0, sealed: 0, outlet: 0 }; for (const p of Q.pockets || Q.chambers) s[p.state === 'both' ? 'outlet' : p.state]++; return s; };
function fillNums() {
  const u = unit(S.cur.id), Q = S.Q, ph = (((S.th % TAU) + TAU) % TAU) * DEG, R = ripOf(u), st = states(Q);
  let html = `<tr><th>${INFO[u.id].title}</th><th></th></tr>` + row('Shaft angle θ', `${ph.toFixed(1)}°`) +
    row('Displacement V', `${(displacement(u) / 1000).toFixed(2)} cm³/rev`) + row(`Flow at ${S.rpm} rpm`, `${Lmin(u, S.rpm).toFixed(2)} L/min`) +
    row(`Flow at ${RATED} rpm`, `${Lmin(u, RATED).toFixed(1)} L/min`) + row('Flow now', `${((Q.q / Q.qMean - 1) * 100).toFixed(2)}% from the mean`) +
    row('Ripple', `${(R.theory * 100).toFixed(2)}%`) + row('Pulses a turn', String(R.pulses)) +
    row('Pockets in · sealed · out', `${st.inlet} · ${st.sealed} · ${st.outlet}`);
  if (u.id === 'gear') { const G = gearDims(u); html += row('Contact from pitch point', `${Q.pc.toFixed(2)} mm`) + row('Base pitch pb', `${G.pb.toFixed(2)} mm`); }
  else if (u.id === 'roots') html += row('Contact |PC|', `${Q.pc.toFixed(2)} mm`) + row('Rolling circle a', `${u.a} mm`);
  else html += row('Ring offset e', `${u.e} mm`) + row('Vane reach', `${(Math.min(...Q.vanes.map(v => v.rho)) - u.r).toFixed(1)} – ${(Math.max(...Q.vanes.map(v => v.rho)) - u.r).toFixed(1)} mm`);
  $('now').innerHTML = `<b>${st.sealed} sealed pocket${st.sealed === 1 ? '' : 's'}</b><span>Flow ${((Q.q / Q.qMean - 1) * 100).toFixed(1)}% from the mean.</span>`;
  if (html !== lastNums) { $('nums').innerHTML = html; lastNums = html; }
}
function fillEqs() {
  const u = unit(S.cur.id), R = ripOf(u), V = (displacement(u) / 1000).toFixed(2);
  const E = {
    gear: [['Flow', 'q = b (Ra² − r² − u²)', 'per radian of shaft turn'], ['Contact', 'u = rb (θ − θ₀),  |u| ≤ pb / 2', 'along the line of action'], ['Displacement', 'V = 2π b (Ra² − r² − pb²/12)', `${V} cm³ per turn`], ['Ripple', 'δ = (pb²/4) / (Ra² − r² − pb²/12)', `${(R.theory * 100).toFixed(2)}%`]],
    vane: [['Vane reach', 'ρ = e cos φ + √(R² − e² sin² φ)', 'to the cam ring'], ['Chamber', 'A = ½ ∫ (ρ² − r²) dφ − vane', 'between two vanes'], ['Displacement', 'V = n b (A_open − A_close)', `${V} cm³ per turn`], ['Ripple', `${2 * u.n} flow steps a turn`, `${(R.theory * 100).toFixed(2)}%, measured`]],
    roots: [['Contact', '|PC| = 2a |sin 2ψ|', 'on the rolling circles'], ['Flow', 'q = b (Ra² − r² − |PC|²)', 'per radian'], ['Displacement', 'V = 2π b (Ra² − r² − 2a²)', `${V} cm³ per turn`], ['Ripple', 'δ = 4a² / (Ra² − r² − 2a²)', `${(R.theory * 100).toFixed(2)}%`]],
  }[u.id];
  $('eqs').innerHTML = E.map(([hh, eq, sub]) => `<div class="eq"><span>${hh}</span><div>${eq}</div><em>${sub}</em></div>`).join('');
}

// ── live values (part cards) ────────────────────────────────────────────────
function liveValue(key) {
  if (!S.Q || !S.cur) return [key, '—'];
  const u = unit(S.cur.id), Q = S.Q, ph = (((S.th % TAU) + TAU) % TAU) * DEG, st = states(Q);
  switch (key) {
    case 'rpm': return ['Shaft', `${S.rpm} rpm`];
    case 'th': return ['Shaft angle', `${ph.toFixed(1)}°`];
    case 'contact': return ['Contact from P', `${Q.pc.toFixed(2)} mm`];
    case 'pockets': return ['In · sealed · out', `${st.inlet} · ${st.sealed} · ${st.outlet}`];
    case 'flow': return [`Flow at ${RATED} rpm`, `${Lmin(u, RATED).toFixed(1)} L/min`];
    case 'ripple': return ['Ripple', `${(ripOf(u).theory * 100).toFixed(2)}%`];
    case 'reach': return ['Vane reach', `${(Q.vanes[0].rho - u.r).toFixed(1)} mm`];
  }
  return [key, '—'];
}

// ── readout ─────────────────────────────────────────────────────────────────
let readTick = 0;
function readout() {
  if (++readTick % 4) return;
  const u = unit(S.cur.id), Q = S.Q;
  $('read').innerHTML = `<span class="hi">${esc(INFO[S.cur.id].title)}</span><br>` +
    `<span class="lo">V ${(displacement(u) / 1000).toFixed(1)} cm³/rev · q ${((Q.q / Q.qMean - 1) * 100).toFixed(1)}% · ripple ${(ripOf(u).theory * 100).toFixed(1)}%</span>`;
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
  if (saverOn && saverTick) saverTick(dt);
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
  }
}
window.addEventListener('pagehide', () => { running = false; cancelAnimationFrame(raf); stage.dispose(); });
window.__pumps = { S, stage, cards, swapTo, setView, setRpm, setExplode, setShow, setOpen, setAna };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
$('tOrbit').classList.toggle('on', stage.orbit);
$('tLabels').classList.toggle('on', S.showLabels);
$('tFluid').classList.toggle('on', S.fluid);
setRpm(10); setExplode(0);
stage.place({ az: -50, el: 24, r: 1400, target: new THREE.Vector3(0, 0, 10) });
const start = (location.hash || '').slice(1);
swapTo(UNITS.some(v => v.id === start) ? start : 'gear');
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
// each pump: the whole pump, then a seeded order of face on, the mesh close
// in, a pocket close in and the side view, then the exploded pump and
// close-ups of 3 parts (lib/mech-tour.js), then a fade to the next pump.
// A pump is a planar subject, so the camera stays within 60 degrees of
// face on (azRange) and the view steps use push, pull, orbit or truck
// moves only. Each step holds seconds/10 (at least 5 s). calm (1 =
// slowest) slows the shaft, not the step time. opts.label names each step
// with the relations and live values. No exit(): the shell reloads the page.
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
    const RPM = Math.round(14 - 8 * calm);
    setRpm(RPM);
    const hold = Math.max(5, (o.seconds || 60) / 10) * 1000;
    const order = UNITS.map(u => u.id), first = Math.floor(rnd() * order.length);
    const canvas = $('view');
    const RULES = [['\\theta', 'm1'], ['V', 'm2'], ['q', 'm3'], ['\\delta', 'm4']];
    const P = (sym, name, value, cls) => ({ sym, name, value, cls });
    const uu = () => unit(S.cur.id);
    const params = () => {
      const u = uu(), Q = S.Q, ph = ((((S.th % TAU) + TAU) % TAU) * DEG).toFixed(0) + '°';
      return [P('\\theta', 'shaft angle', ph, 'm1'), P('V', 'displacement', `${(displacement(u) / 1000).toFixed(1)} cm³/rev`, 'm2'),
        P('q', 'flow from the mean', Q ? `${((Q.q / Q.qMean - 1) * 100).toFixed(1)}%` : '—', 'm3'), P('\\delta', 'flow ripple', `${(ripOf(u).theory * 100).toFixed(1)}%`, 'm4')];
    };
    const TEX = {
      gear: [String.raw`q = b\,(R_a^2 - r^2 - u^2)`, String.raw`V = 2\pi b\,\left(R_a^2 - r^2 - \tfrac{p_b^2}{12}\right)`],
      vane: [String.raw`\rho = e\cos\varphi + \sqrt{R^2 - e^2\sin^2\varphi}`, String.raw`V = n\,b\,(A_{open} - A_{close})`],
      roots: [String.raw`|PC| = 2a\,|\sin 2\psi|`, String.raw`V = 2\pi b\,(R_a^2 - r^2 - 2a^2)`],
    };
    const EQ = { gear: ['q = b (Ra² − r² − u²)', 'V = 2π b (Ra² − r² − pb²/12)'], vane: ['ρ = e cos φ + √(R² − e² sin² φ)', 'V = n b (A_open − A_close)'], roots: ['|PC| = 2a |sin 2ψ|', 'V = 2π b (Ra² − r² − 2a²)'] };
    const tex = () => TEX[S.cur.id], eq = () => EQ[S.cur.id];
    const all = () => Object.values(S.cur.B.parts).filter(q => q.info !== 'base' && q.info !== 'pocket').map(q => q.holder);
    const rotors = () => Object.values(S.cur.B.parts).filter(q => /^(driveGear|idlerGear|rotor|rotorA|rotorB|vane|ring)$/.test(q.info)).map(q => q.holder);
    const SUB = { gear: 'Where the teeth mesh, nothing goes back', vane: 'The rotor runs 0.4 mm from the ring', roots: 'Lobe and waist from one rolling circle' };
    const STEPS = [
      { view: 'three', lab: () => ({ title: INFO[S.cur.id].title, sub: INFO[S.cur.id].kind, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'front', lab: () => ({ title: 'Inlet below, outlet above', sub: 'Blue pockets fill, amber are sealed, red empty', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'mesh', lab: () => ({ title: S.cur.id === 'vane' ? 'The seal at the bottom' : 'The mesh', sub: SUB[S.cur.id], params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(rotors()) }) },
      { view: 'pocket', lab: () => ({ title: 'A sealed pocket', sub: 'Carried from the inlet to the outlet', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(rotors()) }) },
      { view: 'side', lab: () => ({ title: INFO[S.cur.id].title, sub: 'From the side: the drive shaft and the ports', params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
      { view: 'exploded', still: true, lab: () => ({ title: 'Exploded view', sub: INFO[S.cur.id].title, params: params(), tex: tex(), eq: eq(), anchor: () => plateAnchor(all()) }) },
    ];
    STEPS.forEach(s => { const f = s.lab; s.lab = () => Object.assign(f(), { rules: RULES }); });
    const tour = createTour({ THREE, stage, cards, cur: () => S.cur, rnd, hold, prefer: ['driveGear', 'idlerGear', 'vane', 'rotor', 'ring', 'rotorA', 'rotorB', 'casing'], skip: ['base', 'pocket', 'shaft'], azRange: [-60, 60] });
    const focusStep = info => ({ focus: info, still: true, lab: () => { const t = tour.plate(info, INFO[S.cur.id].title); return { ...t, anchor: () => plateAnchor(t.meshes) }; } });
    // a pump reads face on: no top, graze or crane moves
    const FLAT_MOVES = ['push', 'pull', 'orbit', 'truck'];
    let plan = [];
    const makePlan = () => {
      tour.unit();
      const mid = [STEPS[1], STEPS[2], STEPS[3], STEPS[4]].sort(() => rnd() - 0.5).slice(0, 3);
      plan = [STEPS[0], ...mid, STEPS[5], ...tour.pick(3).map(focusStep)];
    };
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
