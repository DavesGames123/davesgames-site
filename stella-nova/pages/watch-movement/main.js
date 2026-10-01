// ============================================================================
//  WATCH MOVEMENT  ·  main.js — the stage, the picker, the cards, the loop
// ────────────────────────────────────────────────────────────────────────────
//  Shows one calibre at a time (calibres/*.js for the mechanism, scenes/*.js
//  for its 3D parts). The watch stands upright: y is 12 o'clock, z (the
//  watch axis) points at the camera, and the camera orbits gently round the
//  vertical. The layers spread along z in the exploded view.
//
//  MOVEMENT SWAP
//    The old movement flies apart and fades (0.7 s), the new one fades in
//    from a wide explode and settles (1.1 s), and the camera eases to fit it.
//  PART CARDS
//    Hover (mouse) shows a card that follows the pointer. A click or tap pins
//    a card to the part, with a leader line to the point that was hit; it
//    stays until the next click. Both cards show live values each frame.
//
//  GREP MAP
//    function swapTo ............ build a calibre and cross-fade to it
//    function frame ............. step, pose, explode, fades, orbit, cards
//    function pick .............. raycast to a part id and a hit point
//    function cardHTML / liveRows  the card content and its live values
//    function placePinned ....... pinned card position and leader line
//    const VIEWS / function setView  camera presets on spherical arcs
//    function occlusion ......... framing around the panel and the dock
// ============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CALIBRES, byId } from './calibres/index.js';
import { createBuild } from './kit.js';
import * as G from './geom.js';

const SCENES = {
  lever: () => import('./scenes/lever.js'),
  tourbillon: () => import('./scenes/tourbillon.js'),
  automatic: () => import('./scenes/automatic.js'),
  verge: () => import('./scenes/verge.js'),
};
const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const { TAU, D } = G;
const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// ── renderer, scene, light ─────────────────────────────────────────────────
const canvas = $('view');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
catch (e) { $('nogl').hidden = false; throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio, COARSE ? 1.75 : 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
const stage = new THREE.Group();
scene.add(stage);

const camera = new THREE.PerspectiveCamera(30, 1, 1, 3000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 12; controls.maxDistance = 360;
controls.target.set(0, 0, 0);

const key = new THREE.DirectionalLight(0xfff5ea, 1.8);
key.position.set(34, 52, 70);
key.castShadow = true;
key.shadow.mapSize.set(COARSE ? 1024 : 2048, COARSE ? 1024 : 2048);
Object.assign(key.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 10, far: 260 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0x9db6ff, 0.9);
rim.position.set(-50, -30, -40);
scene.add(rim, new THREE.HemisphereLight(0xc8d4ff, 0x2a1e10, 0.35));

// ── state ───────────────────────────────────────────────────────────────────
const S = {
  cur: null, leaving: [], rate: 1, lastRate: 1, explode: 1.4, explodeTarget: 0.55, winding: false,
  showDial: true, showBridges: true, showLabels: !PHONE_Q.matches,
  orbit: !REDUCED, orbitAmt: 0, idle: 99, dragging: false,
  hover: null, pin: null, fly: null, fit: null, swapping: false,
};
function nowSeconds() { const d = new Date(); return (d.getHours() % 12) * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000; }

// ── movement swap ───────────────────────────────────────────────────────────
async function swapTo(id) {
  if (S.swapping || (S.cur && S.cur.cal.id === id)) return;
  S.swapping = true;
  try {
    const cal = byId(id);
    const mod = await SCENES[id]();
    const B = createBuild();
    const sc = mod.build(B, cal);
    stage.add(B.root);
    const next = { cal, B, sc, state: cal.createState(nowSeconds(), 0.85), alpha: 0, t0: performance.now(), per: cal.periods() };
    B.setAlpha(0.001);
    if (S.cur) S.leaving.push({ ...S.cur, t0: performance.now(), e0: S.explode });
    S.cur = next;
    S.explode = Math.max(S.explode, 1.25);
    setPin(null); S.hover = null; hideHover();
    applyToggles();
    buildLabels();
    fillPanel(cal);
    // ease the camera distance to fit this calibre
    const off = camera.position.clone().sub(controls.target);
    S.fit = { t: 0, r0: off.length(), r1: fitDistance(cal), t0: controls.target.clone(), t1: new THREE.Vector3(0, 0, midZ(cal) + explodeCentre(S.explodeTarget)) };
    S.fly = null;
    document.querySelectorAll('.mv').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    try { history.replaceState(null, '', '#' + id); } catch (e) {}
  } finally { S.swapping = false; }
}
const fitDistance = cal => cal.plateR * 6.3;
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
    $('train').querySelectorAll('tr[data-part]').forEach(tr => tr.addEventListener('click', () => pinById(tr.dataset.part)));
    $('trainNote').textContent = cal.trainNote || '';
    $('about').innerHTML = cal.about.map(([h, t]) => `<p><b>${esc(h)}.</b> ${esc(t)}</p>`).join('');
    box.classList.remove('fading');
  }, 220);
}
function buildPicker() {
  $('movements').innerHTML = CALIBRES.map(c => `<button class="mv" type="button" data-id="${c.id}"><b>${esc(c.name)}</b><span>${esc(c.kind)} · ${esc(c.era)}</span></button>`).join('');
  $('movements').querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => swapTo(b.dataset.id)));
}

// ── labels ──────────────────────────────────────────────────────────────────
let labelEls = [];
function buildLabels() {
  $('labels').innerHTML = '';
  labelEls = [];
  const B = S.cur.B;
  for (const id in B.parts) {
    const q = B.parts[id]; if (!q.label) continue;
    const el = document.createElement('div'); el.className = 'lb'; el.innerHTML = `<i></i>${esc(q.label)}`;
    $('labels').appendChild(el);
    labelEls.push({ q, el });
  }
}
const vis = o => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
function placeLabels(w, h) {
  const on = S.showLabels && !S.close && S.explode > 0.2 && S.cur.alpha > 0.5;
  const op = on ? Math.min(1, (S.explode - 0.2) * 4) * S.cur.alpha : 0;
  for (const { q, el } of labelEls) {
    if (!on || !vis(q.holder)) { el.style.opacity = 0; continue; }
    const v = S.cur.B.labelPoint(q).project(camera);
    if (v.z > 1) { el.style.opacity = 0; continue; }
    el.style.opacity = op;
    el.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px,${((1 - v.y) / 2 * h).toFixed(1)}px) translate(-50%,-50%)`;
  }
}

// ── picking ─────────────────────────────────────────────────────────────────
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(cx, cy) {
  if (!S.cur || S.cur.alpha < 0.6) return null;
  const r = canvas.getBoundingClientRect();
  ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(S.cur.B.pickables.filter(vis), false)[0];
  if (!hit) return null;
  const id = hit.object.userData.part;
  if (!S.cur.cal.PARTS[id]) return null;
  return { id, obj: hit.object, local: hit.object.worldToLocal(hit.point.clone()) };
}

// ── cards ───────────────────────────────────────────────────────────────────
const GROUP_COLOR = { Power: '#ffb46a', 'Going train': '#e9c27a', Escapement: '#ff8a9a', Regulator: '#9fd0ff', Frame: '#b9c0cf', 'Keyless works': '#c8a6ff', 'Motion works': '#8fe0c0', Display: '#f0e6d0', 'Self-winding': '#ffd27a', Tourbillon: '#7fe3ff', Fusee: '#ffb0d0' };
const rpm = s => { const r = 60 / s; return r >= 1 ? `${+r.toFixed(2)} rpm` : `${+(r * 60).toFixed(r * 60 >= 1 ? 2 : 4)} rph`; };
function cardHTML(id) {
  const cal = S.cur.cal, P = cal.PARTS[id];
  const per = S.cur.per[P.rate];
  const rows = P.specs.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`).join('');
  const live = [];
  if (P.rate && per) live.push(['One turn', G.fmtPeriod(per), ''], ['Speed', rpm(per), '']);
  if (liveKey(P)) live.push(['Angle now', '', 'angle']);
  if (P.live === 'balance') live.push(['Amplitude', '', 'amp']);
  if (P.live === 'reserve') live.push(['Reserve', '', 'reserve']);
  if (P.live === 'fork') live.push(['Lever', '', 'fork']);
  const col = GROUP_COLOR[P.group] || '#e9c27a';
  return `<div class="tip-head"><svg class="gauge" viewBox="-20 -20 40 40" aria-hidden="true"><circle class="face" r="17"/><path class="arc" d=""/><line class="needle" x1="0" y1="3" x2="0" y2="-14"/><circle class="hub" r="2.2"/></svg>
    <div><div class="eyebrow" style="--gc:${col}"><i></i>${esc(P.group)}</div><div class="name">${esc(P.name)}</div></div></div>
    <p class="role">${esc(P.role)}</p>
    <div class="specs">${rows}${live.map(([k, v, l]) => `<div class="k">${esc(k)}</div><div class="v live"${l ? ` data-live="${l}"` : ''}>${esc(v)}</div>`).join('')}</div>`;
}
// the pose key that turns a part, for the live angle and the gauge
const liveKey = P => P.angleKey || (P.live && !['reserve', 'rotor'].includes(P.live) ? P.live : P.rate) || null;
function liveRows(el, id, p) {
  const P = S.cur.cal.PARTS[id]; if (!P) return;
  const k = liveKey(P), a = k && typeof p[k] === 'number' ? p[k] : null;
  const deg = a === null ? null : ((a / D) % 360 + 360) % 360;
  const set = (key, t) => { const n = el.querySelector(`[data-live="${key}"]`); if (n && n.textContent !== t) n.textContent = t; };
  if (deg !== null) set('angle', `${deg.toFixed(1)}°`);
  set('amp', `${(S.cur.state.amp / D).toFixed(0)}°`);
  set('reserve', `${Math.max(0, p.reserve * S.cur.cal.hoursPerTurn).toFixed(1)} h`);
  if (p.fork !== undefined) set('fork', `${(p.fork / D).toFixed(1)}°`);
  const needle = el.querySelector('.needle'), arc = el.querySelector('.arc');
  if (needle) needle.setAttribute('transform', `rotate(${deg === null ? 0 : (-deg).toFixed(2)})`);
  if (arc) {
    const f = P.live === 'reserve' ? Math.max(0, Math.min(1, p.reserve / S.cur.cal.CAL.reserveTurns)) : P.live === 'balance' ? Math.min(1, Math.abs(p.balance) / (330 * D)) : 0;
    const a1 = f * TAU - Math.PI / 2;
    arc.setAttribute('d', f > 0.001 ? `M 0 -17 A 17 17 0 ${f > 0.5 ? 1 : 0} 1 ${(17 * Math.cos(a1)).toFixed(2)} ${(17 * Math.sin(a1)).toFixed(2)}` : '');
  }
}
function showCard(el, id) {
  if (el._id === id) return;
  el._id = id;
  const inner = el.querySelector('.tip-in');
  inner.innerHTML = cardHTML(id);
  inner.classList.remove('swap'); void inner.offsetWidth; inner.classList.add('swap');
  el.classList.add('show');
}
function hideCard(el) { el.classList.remove('show'); el._id = null; }
const tipHover = $('tipHover'), tipPin = $('tipPin');
const hoverPos = { x: 0, y: 0, tx: 0, ty: 0 };
function hideHover() { hideCard(tipHover); }

function setPin(hit) {
  S.pin = hit;
  if (!hit) { hideCard(tipPin); $('leader').classList.remove('show'); return; }
  showCard(tipPin, hit.id);
  tipPin._placed = false;
  $('leader').classList.remove('show'); void $('leader').getBoundingClientRect(); $('leader').classList.add('show');
  if (S.hover === hit.id) hideHover();
}
// pin a part from the table: anchor on the centre of its first mesh
function pinById(id) {
  const m = S.cur.B.pickables.find(o => o.userData.part === id && vis(o));
  if (!m) return;
  m.geometry.computeBoundingBox();
  setPin({ id, obj: m, local: m.geometry.boundingBox.getCenter(new THREE.Vector3()) });
}
$('tipPinClose').addEventListener('click', () => setPin(null));

const anchorV = new THREE.Vector3();
function placePinned(w, h) {
  if (!S.pin) return;
  if (!vis(S.pin.obj) || !S.pin.obj.parent) { setPin(null); return; }
  anchorV.copy(S.pin.local); S.pin.obj.localToWorld(anchorV); anchorV.project(camera);
  const ax = (anchorV.x + 1) / 2 * w, ay = (1 - anchorV.y) / 2 * h;
  const cw = tipPin.offsetWidth, chh = tipPin.offsetHeight;
  let tx, ty;
  if (PHONE_Q.matches) { tx = (w - cw) / 2; ty = h - chh - 10; }
  else {
    const right = ax + 46 + cw < w - 12;
    tx = right ? ax + 46 : Math.max(12, ax - 46 - cw);
    ty = Math.min(h - chh - 12, Math.max(12, ay - chh * 0.35));
  }
  if (!tipPin._placed) { tipPin._x = tx; tipPin._y = ty; tipPin._placed = true; }
  tipPin._x += (tx - tipPin._x) * 0.16; tipPin._y += (ty - tipPin._y) * 0.16;
  tipPin.style.transform = `translate(${tipPin._x.toFixed(1)}px,${tipPin._y.toFixed(1)}px)`;
  // the leader runs from the anchor to the nearest point of the card
  const nx = Math.max(tipPin._x, Math.min(ax, tipPin._x + cw)), ny = Math.max(tipPin._y, Math.min(ay, tipPin._y + chh));
  const line = $('leader').querySelector('line');
  line.setAttribute('x1', ax.toFixed(1)); line.setAttribute('y1', ay.toFixed(1));
  line.setAttribute('x2', nx.toFixed(1)); line.setAttribute('y2', ny.toFixed(1));
  for (const c of $('leader').querySelectorAll('circle')) { c.setAttribute('cx', ax.toFixed(1)); c.setAttribute('cy', ay.toFixed(1)); }
}
function placeHover(w, h) {
  if (!tipHover._id) return;
  const cw = tipHover.offsetWidth, chh = tipHover.offsetHeight;
  let tx = hoverPos.tx + 22, ty = hoverPos.ty + 18;
  if (tx + cw > w - 8) tx = hoverPos.tx - 22 - cw;
  if (ty + chh > h - 8) ty = Math.max(8, h - 8 - chh);
  hoverPos.x += (tx - hoverPos.x) * 0.3; hoverPos.y += (ty - hoverPos.y) * 0.3;
  tipHover.style.transform = `translate(${hoverPos.x.toFixed(1)}px,${hoverPos.y.toFixed(1)}px)`;
}

// ── pointer ─────────────────────────────────────────────────────────────────
let down = null, rayAt = null;
canvas.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  const r = canvas.getBoundingClientRect();
  hoverPos.tx = e.clientX - r.left; hoverPos.ty = e.clientY - r.top;
  if (!tipHover._id) { hoverPos.x = hoverPos.tx + 22; hoverPos.y = hoverPos.ty + 18; }
  rayAt = [e.clientX, e.clientY];
});
canvas.addEventListener('pointerleave', () => { rayAt = null; S.hover = null; hideHover(); canvas.style.cursor = ''; });
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; S.idle = 0; hideHint(); });
canvas.addEventListener('pointerup', e => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
  down = null;
  if (moved > 6 || dt > 600) return;
  setPin(pick(e.clientX, e.clientY));          // a part pins its card; empty space clears it
});
controls.addEventListener('start', () => { S.dragging = true; S.close = false; S.fly = null; S.fit = null; hideHint(); });
controls.addEventListener('end', () => { S.dragging = false; S.idle = 0; });
canvas.addEventListener('wheel', () => { S.idle = 0; S.fit = null; }, { passive: true });

// ── views: camera moves along spherical arcs round the target ──────────────
const VIEWS = {
  front: { az: 0, el: 10, explode: 0 },
  dial: { az: 180, el: 8, explode: 0, dial: true },
  exploded: { az: 52, el: 16, explode: 0.9, dial: true, bridges: true },
  escapement: { az: 38, el: -22, explode: 0.55, rate: 0.05, close: true, bridges: false },
};
const sph = new THREE.Spherical();
function setView(name) {
  const cal = S.cur.cal, v = { ...VIEWS[name], ...((cal.views || {})[name] || {}) };
  const s0 = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  const t1 = v.close ? new THREE.Vector3(...cal.focus) : new THREE.Vector3(0, 0, midZ(cal));
  const r1 = v.close ? cal.plateR * (v.distK ?? 1.5) : fitDistance(cal) * (v.explode > 0.5 ? 1.15 : 1);
  t1.z += v.close ? v.explode * S.cur.sc.unit * (S.cur.sc.focusK ?? 1) : explodeCentre(v.explode);
  let th = v.az * D; while (th - s0.theta > Math.PI) th -= TAU; while (s0.theta - th > Math.PI) th += TAU;
  S.fly = { t: 0, s0, s1: new THREE.Spherical(r1, (90 - v.el) * D, th), t0: controls.target.clone(), t1 };
  S.fit = null;
  S.close = !!v.close;
  setExplode(v.explode);
  if (v.bridges !== undefined) setShow('bridges', v.bridges);
  if (v.dial !== undefined) setShow('dial', v.dial);
  if (v.rate !== undefined) setRate(v.rate);
  S.idle = -2;                                // hold the orbit a moment
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === name));
}
document.querySelectorAll('#views button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ── controls ────────────────────────────────────────────────────────────────
function setExplode(x) {
  S.explodeTarget = x;
  $('explode').value = x; $('explodeV').textContent = Math.round(x * 100) + '%';
  $('dockExplode').classList.toggle('on', x > 0.3);
}
$('explode').addEventListener('input', e => setExplode(+e.target.value));
$('assemble').addEventListener('click', () => setExplode(0));
$('burst').addEventListener('click', () => setExplode(0.9));
$('dockExplode').addEventListener('click', () => setExplode(S.explodeTarget > 0.3 ? 0 : 0.85));
function setRate(r) {
  if (r > 0) S.lastRate = r;
  S.rate = r;
  document.querySelectorAll('#rates button, #dockRates button').forEach(b => b.classList.toggle('on', +b.dataset.rate === r));
  $('dockPlay').textContent = r ? '❚❚' : '▶'; $('dockPlay').setAttribute('aria-label', r ? 'Pause' : 'Play');
  $('rateNote').textContent = r === 0 ? 'Paused. Winding still works.'
    : r < 1 ? 'Slow motion. Watch the escape wheel lock, unlock, give its impulse and drop.'
    : r === 1 ? 'Real time.'
    : 'Fast. The balance now swings faster than the screen can draw, so it looks still or jumps (aliasing). The wheel train stays exact.';
}
document.querySelectorAll('#rates button, #dockRates button').forEach(b => b.addEventListener('click', () => setRate(+b.dataset.rate)));
$('dockPlay').addEventListener('click', () => setRate(S.rate ? 0 : S.lastRate));
$('dockMove').addEventListener('click', () => {
  const i = CALIBRES.findIndex(c => c.id === S.cur.cal.id);
  swapTo(CALIBRES[(i + 1) % CALIBRES.length].id);
});
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
  if (what === 'orbit') { S.orbit = on; $('tOrbit').classList.toggle('on', on); }
  applyToggles();
}
$('tDial').addEventListener('click', () => setShow('dial', !S.showDial));
$('tBridges').addEventListener('click', () => setShow('bridges', !S.showBridges));
$('tLabels').addEventListener('click', () => setShow('labels', !S.showLabels));
$('tOrbit').addEventListener('click', () => setShow('orbit', !S.orbit));

const windBtn = $('wind');
const windOn = e => { e.preventDefault(); S.winding = true; windBtn.classList.add('on'); try { windBtn.setPointerCapture(e.pointerId); } catch (x) {} };
const windOff = () => { S.winding = false; windBtn.classList.remove('on'); };
windBtn.addEventListener('pointerdown', windOn);
windBtn.addEventListener('pointerup', windOff);
windBtn.addEventListener('pointercancel', windOff);
windBtn.addEventListener('lostpointercapture', windOff);
windBtn.addEventListener('contextmenu', e => e.preventDefault());

// panel, sheet and dock (the wave-membrane pattern)
const panel = $('panel'), dockPanel = $('dockPanel');
function setOpen(open) {
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
  document.body.classList.toggle('sheet-open', open);
  dockPanel.classList.toggle('on', open); dockPanel.setAttribute('aria-expanded', String(open));
}
$('gear').addEventListener('click', () => setOpen(true));
dockPanel.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
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
setTimeout(hideHint, 9000);

// ── framing: shift the view into the area the panel and dock leave clear ───
function occlusion(w, h) {
  const o = { l: 0, r: 0, t: 0, b: 0 }, cr = canvas.getBoundingClientRect(), q = panel.getBoundingClientRect();
  const x0 = Math.max(cr.left, q.left), x1 = Math.min(cr.right, q.right), y0 = Math.max(cr.top, q.top), y1 = Math.min(cr.bottom, q.bottom);
  if (x1 - x0 >= 1 && y1 - y0 >= 1) {
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) { if (y0 + y1 > cr.top * 2 + h) o.b = cr.bottom - y0; else o.t = y1 - cr.top; }
    else { if (x0 + x1 < cr.left * 2 + w) o.l = x1 - cr.left; else o.r = cr.right - x0; }
  }
  return o;
}
const occ = { l: 0, r: 0, t: 0, b: 0 };
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.zoom = Math.min(1, Math.max(0.72, camera.aspect / 1.3));
  const o = occlusion(w, h);
  for (const k in occ) occ[k] += (o[k] - occ[k]) * 0.25;
  camera.setViewOffset(w, h, (occ.l - occ.r) / -2, (occ.t - occ.b) / -2, w, h);
  camera.updateProjectionMatrix();
}

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
  S.idle += dt;

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
  for (const old of S.leaving.filter(o => o.dead)) old.B.dispose();
  S.leaving = S.leaving.filter(o => !o.dead);

  // camera: preset flights, fit after a swap, the gentle orbit
  if (S.fly) {
    S.fly.t = Math.min(1, S.fly.t + dt / 1.3);
    const k = ease(S.fly.t), s0 = S.fly.s0, s1 = S.fly.s1;
    controls.target.lerpVectors(S.fly.t0, S.fly.t1, k);
    sph.set(s0.radius + (s1.radius - s0.radius) * k, s0.phi + (s1.phi - s0.phi) * k, s0.theta + (s1.theta - s0.theta) * k);
    camera.position.setFromSpherical(sph).add(controls.target);
    if (S.fly.t >= 1) S.fly = null;
  } else if (S.fit) {
    S.fit.t = Math.min(1, S.fit.t + dt / 1.2);
    const k = ease(S.fit.t);
    const off = camera.position.clone().sub(controls.target).setLength(S.fit.r0 + (S.fit.r1 - S.fit.r0) * k);
    controls.target.lerpVectors(S.fit.t0, S.fit.t1, k);
    camera.position.copy(controls.target).add(off);
    if (S.fit.t >= 1) S.fit = null;
  }
  // keep the target on the middle of the spread as the layers part
  const cz = explodeCentre(S.explode), dz = cz - (S.lastCz ?? cz);
  S.lastCz = cz;
  if (dz && !S.fly && !S.fit) { controls.target.z += dz; camera.position.z += dz; }
  const want = S.orbit && !S.dragging && !S.fly && S.idle > 2.5 ? (S.pin ? 0.3 : 1) : 0;
  S.orbitAmt += (want - S.orbitAmt) * Math.min(1, dt * (want > S.orbitAmt ? 0.6 : 4));
  controls.autoRotate = S.orbitAmt > 0.002;
  controls.autoRotateSpeed = -0.5 * S.orbitAmt;
  controls.update(dt);

  // hover pick (mouse), once per frame
  if (rayAt && !S.dragging) {
    const hit = pick(rayAt[0], rayAt[1]);
    const id = hit ? hit.id : null;
    if (id !== S.hover) { S.hover = id; if (id && (!S.pin || S.pin.id !== id)) showCard(tipHover, id); else hideHover(); }
    canvas.style.cursor = id ? 'pointer' : '';
  }
  // highlights ease in and out; the pinned part breathes
  for (const k in cur.B.parts) {
    const q = cur.B.parts[k];
    const tgt = S.pin && q.info === S.pin.id ? 0.75 + 0.18 * Math.sin(now / 260) : S.hover && q.info === S.hover ? 0.55 : 0;
    let nv = q.hl + (tgt - q.hl) * Math.min(1, dt * 9);
    if (tgt === 0 && nv < 2e-3) nv = 0;
    if (nv !== q.hl) { q.hl = nv; cur.B.setHighlight(q, nv); }
  }

  resize();
  renderer.render(scene, camera);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  placeLabels(w, h);
  placeHover(w, h);
  placePinned(w, h);
  if (tipHover._id) liveRows(tipHover, tipHover._id, p);
  if (tipPin._id) liveRows(tipPin, tipPin._id, p);
  readout(p);
}

window.addEventListener('pagehide', () => {
  running = false; cancelAnimationFrame(raf);
  try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) {}
});

// debug and headless checks
window.__watch = { S, swapTo, setView, setRate, setExplode, setPin, pinById, pick, showCard, camera, controls, CALIBRES };

// ── boot ────────────────────────────────────────────────────────────────────
buildPicker();
setRate(1);
setExplode(0.55);
const start = (location.hash || '').slice(1);
camera.position.setFromSpherical(new THREE.Spherical(150, (90 - 14) * D, 36 * D));
swapTo(byId(start) ? start : CALIBRES[0].id);
requestAnimationFrame(frame);
