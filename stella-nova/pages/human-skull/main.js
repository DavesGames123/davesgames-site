// ============================================================================
//  HUMAN SKULL  ·  main.js — state, controls, picking, cards, the loop
// ────────────────────────────────────────────────────────────────────────────
//  Boot: stage.js makes the renderer and the studio; skull.js loads the 51
//  parts; the parts fly in, assemble, then open in the Anatomy layout.
//
//  STATE (S)
//    arr     the layout: anatomy | symmetry | region | tray (arrange.js)
//    e       the spread, 0 (assembled) .. 1 (full layout)
//    sel     the picked part (card), or -1
//    iso     the isolated part (the rest are ghosts), or -1
//    hover   the part under the mouse, or -1
//
//  TAP RULES (onTap)
//    a part ........... pick it and show its card
//    the picked part .. isolate it (again: show all)
//    empty space ...... leave isolation, else drop the pick
//  Hold a part (about 0.3 s), then drag: the part follows the pointer and
//  springs back on release. A plain drag turns the camera.
//
//  GREP MAP
//    function setArrangement ... pick a layout and fly the camera
//    function setExplode ....... the spread, the slider and Reconstruct
//    function select ........... the picked part and its card
//    function isolate .......... ghost the rest, frame the part
//    function pickAt ........... raycast, with a wider ring on touch
//    function onTap ............ the tap rules above
//    function beginDrag ........ hold-and-drag a part
//    function cardHTML ......... the museum label card
//    function placeCard ........ card position and its leader line
//    function setOpen .......... panel, sheet and dock
//    function frame ............ the loop
//    window.snSaver ............ screensaver tour for lib/screensaver.js
//    function saverPlate ....... screensaver plate: layout or the isolated bone
//    function partAnchor ....... the bone (landmarks) or the layout on screen
//    function partView ......... screensaver: the camera side for one bone
// ============================================================================
import * as THREE from 'three';
import { createStage, KEY_DIR } from './stage.js';
import { loadSkull, disposeSkull } from './skull.js';
import { layoutFor, createMotion, REGIONS, TRAY_Y } from './arrange.js';
import { createTray, shortName } from './tray.js';

const $ = id => document.getElementById(id);
const PHONE_Q = matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)');
const COARSE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const GROUPS = {
  cranial: { label: 'Cranial bone', short: 'Cranial' },
  facial: { label: 'Facial bone', short: 'Facial' },
  dentition: { label: 'Tooth', short: 'Dentition' },
  hyoid: { label: 'Throat bone', short: 'Hyoid' },
};
const ARR = {
  anatomy: { label: 'Anatomy', blurb: 'Each part moves out along the line it takes in the head. The teeth leave their sockets and fan out from the arch.', view: { az: 34, el: 9 } },
  symmetry: { label: 'Symmetry', blurb: 'The midline bones stand in a column. Each left and right pair faces its twin across the midline.', view: { az: 0, el: 3 } },
  region: { label: 'Region', blurb: 'Four groups: the cranium round the brain, the bones of the face, the teeth, and the hyoid.', view: { az: 16, el: 8 } },
  tray: { label: 'Catalogue', blurb: 'Every part laid flat on a specimen tray, largest first, with its catalogue number.', view: { az: 0, el: 56 } },
};
const Q0 = new THREE.Quaternion();

// ── stage ───────────────────────────────────────────────────────────────────
const panel = $('panel'), canvas = $('view');
const stage = createStage({
  canvas, coarse: COARSE, reduced: REDUCED,
  onNoGL: () => { $('nogl').hidden = false; $('loading').hidden = true; },
  occluders: () => {
    const list = [$('bar'), $('dock')];
    if (panel.classList.contains('open')) list.push(panel);
    if (PHONE_Q.matches) { list.push($('plate')); if ($('card').classList.contains('show')) list.push($('card')); }
    return list;
  },
});
const camera = stage.camera;

let theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
const S = {
  arr: 'anatomy', e: 1, layout: null, sel: -1, iso: -1, hover: -1, labels: false, ready: false,
  floorY: -140, aspectWide: null, introTimer: 0, selPoint: null,
};
let parts = [], motion = null, tray = null, man = null;
let saver = null;   // the screensaver run (window.snSaver), or null

// ── layouts ─────────────────────────────────────────────────────────────────
function clearAspect() {
  const ob = stage.occlusion(), w = canvas.clientWidth - ob.l - ob.r, h = canvas.clientHeight - ob.t - ob.b;
  return Math.max(0.3, w / Math.max(1, h));
}
function computeLayout(name) {
  const a = clearAspect();
  S.aspectWide = a >= 1.05;
  S.layout = layoutFor(name, parts, a);
  if (name === 'tray') tray.setLayout(S.layout);
  return S.layout;
}
function targetsAt(e) {
  return parts.map((p, i) => {
    const f = S.layout.out[i];
    return { pos: p.home.clone().lerp(f.pos, e), quat: new THREE.Quaternion().slerpQuaternions(Q0, f.quat, Math.min(1, e * 1.25)) };
  });
}
function viewFor(name) { return ARR[name].view; }
function fitFor(targets, view, margin) {
  const list = targets.map((t, i) => ({ c: t.pos, r: parts[i].size * 0.4 }));
  if (S.arr === 'tray' && S.e > 0.5 && S.layout.size) {
    const [W, D] = S.layout.size;
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) list.push({ c: new THREE.Vector3(x * W / 2, TRAY_Y, z * D / 2), r: 4 });
  }
  return stage.fitSpheres(list, view.az, view.el, margin);
}
function flyToLayout(dur, keepAngle) {
  const T = targetsAt(S.e);
  const v = keepAngle ? stage.view() : viewFor(S.arr);
  const f = fitFor(T, { az: v.az, el: v.el }, S.e < 0.05 ? 1.25 : 1.06);
  stage.flyTo(f, dur);
}

function setArrangement(name, { fly = true } = {}) {
  if (!ARR[name]) return;
  clearTimeout(S.introTimer);
  const changed = name !== S.arr;
  S.arr = name;
  computeLayout(name);
  if (S.e < 0.05) setExplodeUI(1);
  if (S.iso >= 0) isolate(-1, { fly: false });
  motion.go(targetsAt(S.e), performance.now() / 1000, { order: 'out', stagger: changed ? 0.6 : 0.3 });
  tray.show(name === 'tray');
  if (fly) flyToLayout(1.5);
  document.querySelectorAll('#arrs button').forEach(b => { const on = b.dataset.arr === name; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  document.querySelectorAll('#arrList button').forEach(b => b.classList.toggle('on', b.dataset.arr === name));
  $('plateArr').textContent = '· ' + ARR[name].label;
  if (!saver) try { history.replaceState(null, '', '#' + name); } catch (e) {}
}

// ── explode ─────────────────────────────────────────────────────────────────
function setExplodeUI(e) {
  S.e = e;
  $('explode').value = e; $('explodeV').textContent = Math.round(e * 100) + '%';
  const open = e > 0.02;
  $('rebuild').textContent = open ? 'Reconstruct' : 'Explode';
  $('dockRebuild').querySelector('span').textContent = open ? 'Rebuild' : 'Explode';
  $('dockRebuild').querySelector('i').textContent = open ? '⟲' : '✳';
}
// animate: a staggered move with a camera flight (Reconstruct, Explode);
// otherwise the springs follow the slider directly
function setExplode(e, { animate = false } = {}) {
  clearTimeout(S.introTimer);
  const closing = e < S.e;
  setExplodeUI(e);
  if (animate) {
    if (S.iso >= 0) isolate(-1, { fly: false });
    motion.go(targetsAt(e), performance.now() / 1000, { order: closing ? 'in' : 'out', stagger: closing ? 0.5 : 0.55, dur: 1.15 });
    flyToLayout(1.4, S.arr !== 'tray');
  } else motion.snap(targetsAt(e));
  tray.show(S.arr === 'tray' && e > 0.5);
}
$('explode').addEventListener('input', ev => setExplode(+ev.target.value));
$('explode').addEventListener('change', () => flyToLayout(1.0, true));
const rebuild = () => setExplode(S.e > 0.02 ? 0 : 1, { animate: true });
$('rebuild').addEventListener('click', rebuild);
$('dockRebuild').addEventListener('click', rebuild);

// ── theme ───────────────────────────────────────────────────────────────────
function setTheme(t) {
  theme = t;
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('sn-skull-theme', t); } catch (e) {}
  stage.setTheme(t);
  if (tray) tray.setTheme(t);
  for (const p of parts) p.U.uHLc.value.set(t === 'dark' ? 0xffc777 : 0xd9822b);
  $('tTheme').classList.toggle('on', t === 'light');
  $('theme').setAttribute('aria-label', t === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme');
}
const flipTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');
$('theme').addEventListener('click', flipTheme);
$('dockTheme').addEventListener('click', flipTheme);
$('tTheme').addEventListener('click', flipTheme);

// ── toggles ─────────────────────────────────────────────────────────────────
$('tOrbit').addEventListener('click', () => { stage.orbit = !stage.orbit; $('tOrbit').classList.toggle('on', stage.orbit); });
$('tLabels').addEventListener('click', () => { S.labels = !S.labels; $('tLabels').classList.toggle('on', S.labels); });
$('tFront').addEventListener('click', () => {
  const f = fitFor(targetsAt(S.e), { az: 0, el: S.arr === 'tray' ? 56 : 3 }, 1.06);
  stage.flyTo(f, 1.2);
});

// ── selection, isolation, the card ─────────────────────────────────────────
const card = $('card'), cardIn = card.querySelector('.card-in'), leader = $('leader');
function cardHTML(i) {
  const m = parts[i].m, G = GROUPS[m.group];
  const side = m.side === 'mid' ? 'Midline' : m.side[0].toUpperCase() + m.side.slice(1);
  const pair = m.pair ? parts.find(q => q.m.key === m.pair) : null;
  const rows = [['Side', esc(side)]];
  if (m.fdi) rows.push(['FDI number', esc(m.fdi)]);
  rows.push(['FMA', esc(m.fma.replace('FMA', ''))], ['BodyParts3D', esc(m.bp3d)]);
  if (pair) rows.push(['Mirror pair', `<button type="button" class="lnk" data-go="${pair.i}">${esc(pair.m.name)}</button>`]);
  const iso = S.iso === i;
  return `<div class="c-top"><span class="eyebrow" data-g="${m.group}"><i></i>${esc(G.label)}</span><span class="no">No. ${String(i + 1).padStart(2, '0')}<em> / ${parts.length}</em></span></div>
    <div class="c-name">${esc(m.name)}</div>
    <div class="c-lat">${esc(m.latin)}</div>
    <p class="c-fact">${esc(m.fact)}</p>
    <dl class="c-specs">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <div class="c-act"><button type="button" class="c-btn" data-act="iso">${iso ? 'Show all' : 'Isolate'}</button><button type="button" class="c-btn ghost" data-act="close">Close</button></div>`;
}
cardIn.addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.go) select(+b.dataset.go);
  else if (b.dataset.act === 'iso') isolate(S.iso === S.sel ? -1 : S.sel);
  else if (b.dataset.act === 'close') { isolate(-1); select(-1); }
});
function refreshCard() { if (S.sel >= 0) cardIn.innerHTML = cardHTML(S.sel); }
function select(i, point) {
  if (i === S.sel && i >= 0) return;
  S.sel = i;
  if (i < 0) {
    card.classList.remove('show'); leader.classList.remove('show');
    stage.hold = false;
  } else {
    const mesh = parts[i].mesh;
    S.selPoint = point ? mesh.worldToLocal(point.clone()) : new THREE.Vector3();
    cardIn.innerHTML = cardHTML(i);
    cardIn.classList.remove('swap'); void cardIn.offsetWidth; cardIn.classList.add('swap');
    card.classList.add('show'); card._placed = false;
    leader.classList.remove('show'); void leader.getBoundingClientRect(); leader.classList.add('show');
    stage.hold = true;
    hideHover();
  }
  document.querySelectorAll('#list .it').forEach(b => b.classList.toggle('on', +b.dataset.i === i));
}
function isolate(i, { fly = true } = {}) {
  S.iso = i;
  if (i >= 0) {
    if (S.sel !== i) select(i);
    const p = parts[i], v = stage.view(), b = new THREE.Box3().setFromObject(p.mesh);
    if (fly) stage.flyTo(stage.fitBox(b, v.az, v.el, 2.1), 1.1);
  } else if (fly) flyToLayout(1.1, true);
  refreshCard();
}

// ── picking ─────────────────────────────────────────────────────────────────
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function castAt(cx, cy) {
  const r = canvas.getBoundingClientRect();
  ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const meshes = [];
  for (const p of parts) if (p.U.uGhost.value < 0.5) meshes.push(p.mesh);
  const h = ray.intersectObjects(meshes, false)[0];
  return h ? { i: h.object.userData.part, point: h.point.clone() } : null;
}
// forgiving: on touch, a miss tries two rings round the tap point
function pickAt(cx, cy, forgiving) {
  const h = castAt(cx, cy);
  if (h || !forgiving) return h;
  for (const rad of [14, 26]) for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2 + (rad > 20 ? Math.PI / 8 : 0);
    const q = castAt(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    if (q) return q;
  }
  return null;
}
function onTap(x, y, type) {
  const hit = pickAt(x, y, type !== 'mouse');
  if (hit) {
    if (hit.i === S.sel) isolate(S.iso === hit.i ? -1 : hit.i);
    else { if (S.iso >= 0) isolate(-1, { fly: false }); select(hit.i, hit.point); }
  } else if (S.iso >= 0) isolate(-1);
  else select(-1);
}

// ── pointer: tap, hold-and-drag, hover ─────────────────────────────────────
let down = null, drag = null, lpTimer = 0, hoverAt = null;
const pointers = new Set();
const plane = new THREE.Plane(), hitV = new THREE.Vector3();
function beginDrag(hit) {
  const p = parts[hit.i];
  drag = { i: hit.i, off: hit.point.clone().sub(p.mesh.position) };
  stage.controls.enabled = false;
  plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), hit.point);
  motion.M[hit.i].drag = p.mesh.position.clone();
  S.hover = hit.i;
  canvas.style.cursor = 'grabbing';
  try { if (navigator.vibrate && COARSE) navigator.vibrate(8); } catch (e) {}
}
function moveDrag(x, y) {
  const r = canvas.getBoundingClientRect();
  ndc.set((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (ray.ray.intersectPlane(plane, hitV)) motion.M[drag.i].drag.copy(hitV).sub(drag.off);
}
function endDrag() {
  if (!drag) return;
  motion.M[drag.i].drag = null;
  drag = null;
  stage.controls.enabled = true;
  canvas.style.cursor = '';
}
canvas.addEventListener('pointerdown', ev => {
  pointers.add(ev.pointerId);
  hideHint();
  clearTimeout(lpTimer);
  if (pointers.size > 1 || !S.ready) { down = null; return; }
  down = { x: ev.clientX, y: ev.clientY, t: performance.now(), type: ev.pointerType, moved: false };
  const hit = castAt(ev.clientX, ev.clientY);
  if (hit) {
    const d0 = down;
    lpTimer = setTimeout(() => { if (down === d0 && !d0.moved && pointers.size === 1) { d0.dragged = true; beginDrag(hit); } }, ev.pointerType === 'mouse' ? 260 : 330);
  }
}, { capture: true });
canvas.addEventListener('pointermove', ev => {
  if (ev.pointerType === 'mouse') hoverAt = [ev.clientX, ev.clientY];
  if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 7) { down.moved = true; if (!drag) clearTimeout(lpTimer); }
  if (drag) moveDrag(ev.clientX, ev.clientY);
});
function pointerEnd(ev) {
  pointers.delete(ev.pointerId);
  clearTimeout(lpTimer);
  const d = down; down = null;
  if (drag) { endDrag(); return; }
  if (!d || ev.type === 'pointercancel') return;
  if (!d.moved && performance.now() - d.t < 600) onTap(ev.clientX, ev.clientY, d.type);
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);
canvas.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') { hoverAt = null; S.hover = -1; hideHover(); } });
canvas.addEventListener('contextmenu', ev => ev.preventDefault());
addEventListener('keydown', ev => {
  if (ev.key !== 'Escape' || ev.target.tagName === 'INPUT') return;
  if (S.iso >= 0) isolate(-1); else select(-1);
});

// hover card (mouse only)
const tipHover = $('tipHover'), hov = { x: 0, y: 0, tx: 0, ty: 0, i: -1 };
function hideHover() { tipHover.classList.remove('show'); hov.i = -1; }
function showHover(i) {
  if (hov.i === i) return;
  hov.i = i;
  const m = parts[i].m;
  tipHover.querySelector('.tip-in').innerHTML = `<span class="eyebrow" data-g="${m.group}"><i></i>${esc(GROUPS[m.group].label)}</span><div class="t-name">${esc(m.name)}</div><div class="t-lat">${esc(m.latin)}</div>`;
  tipHover.classList.add('show');
}
let hoverTick = 0;
function updateHover() {
  if (!hoverAt || drag || stage.dragging || !S.ready || COARSE) return;
  if (++hoverTick % 2) return;
  const h = castAt(hoverAt[0], hoverAt[1]);
  S.hover = h ? h.i : -1;
  canvas.style.cursor = h ? 'pointer' : '';
  if (h && h.i !== S.sel) showHover(h.i); else hideHover();
}

// ── hint ────────────────────────────────────────────────────────────────────
let hintGone = false;
function hideHint() { if (!hintGone) { hintGone = true; $('hint').classList.add('gone'); } }
if (COARSE) $('hint').textContent = 'tap a part to name it · tap again to isolate · hold a part to drag it';
else $('hint').textContent = 'hover a part to name it · click to pick, again to isolate · hold a part and drag it out';
setTimeout(hideHint, 12000);

// ── panel, sheet, dock ──────────────────────────────────────────────────────
const tabs = [...document.querySelectorAll('#dock .tab')];
let grp = 'parts';
function setOpen(open, g = grp) {
  grp = g;
  panel.classList.toggle('open', open);
  if (!open) panel.classList.remove('full');
  document.body.classList.toggle('panel-closed', !open);
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

// arrangement buttons: the bar, and the list in the Adjust group
$('arrList').innerHTML = Object.entries(ARR).map(([k, a]) => `<button type="button" data-arr="${k}"><b>${a.label}</b><span>${a.blurb}</span></button>`).join('');
document.querySelectorAll('#arrs button, #arrList button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.arr === S.arr && S.e > 0.02) { flyToLayout(1.2); return; }
  setArrangement(b.dataset.arr);
}));

// ── the parts list ──────────────────────────────────────────────────────────
function buildList() {
  $('list').innerHTML = REGIONS.map(R => {
    const ps = parts.filter(p => p.m.group === R.group);
    return `<div class="lg" data-g="${R.group}"><div class="lg-h"><i></i>${GROUPS[R.group].short}<span>${ps.length}</span></div>` +
      ps.map(p => `<button type="button" class="it" role="listitem" data-i="${p.i}" data-s="${esc((p.m.name + ' ' + p.m.latin + ' ' + (p.m.fdi || '') + ' ' + shortName(p.m)).toLowerCase())}"><span class="n">${String(p.i + 1).padStart(2, '0')}</span><span class="nm">${esc(p.m.name)}<i>${esc(p.m.latin)}</i></span></button>`).join('') + '</div>';
  }).join('') + '<p class="none" hidden>No part matches.</p>';
  $('list').querySelectorAll('.it').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.i;
    if (S.sel === i) isolate(S.iso === i ? -1 : i);
    else { if (S.iso >= 0) isolate(-1, { fly: false }); select(i); }
    if (PHONE_Q.matches) setOpen(false);
  }));
}
$('q').addEventListener('input', () => {
  const q = $('q').value.trim().toLowerCase();
  let any = false;
  $('list').querySelectorAll('.lg').forEach(g => {
    let n = 0;
    g.querySelectorAll('.it').forEach(b => { const on = !q || b.dataset.s.includes(q); b.hidden = !on; if (on) n++; });
    g.hidden = !n; if (n) any = true;
  });
  $('list').querySelector('.none').hidden = any;
});

// ── labels: region titles, part names ──────────────────────────────────────
const labelBox = $('labels');
let regionEls = [], partEls = [];
function buildLabels() {
  labelBox.innerHTML = '';
  regionEls = REGIONS.map(R => {
    const el = document.createElement('div'); el.className = 'rl'; el.dataset.g = R.group;
    labelBox.appendChild(el); return el;
  });
  partEls = parts.map(p => {
    if (p.m.group === 'dentition') return null;
    const el = document.createElement('div'); el.className = 'pl'; el.textContent = shortName(p.m);
    labelBox.appendChild(el); return el;
  });
}
const pv = new THREE.Vector3();
function project(v, w, h) { pv.copy(v).project(camera); return pv.z > 1 ? null : [(pv.x + 1) / 2 * w, (1 - pv.y) / 2 * h]; }
function placeLabels(w, h) {
  const rOn = S.arr === 'region' && S.layout.labels ? smooth(0.6, 0.95, S.e) : 0;
  regionEls.forEach((el, k) => {
    const L = S.layout.labels && S.layout.labels[k];
    const xy = rOn && L ? project(L.at, w, h) : null;
    if (!xy) { el.style.opacity = 0; return; }
    if (!el._t) { el._t = 1; el.innerHTML = `<i></i>${L.label}<span>${L.n} ${L.unit}</span>`; }
    el.style.opacity = rOn;
    el.style.transform = `translate(${xy[0].toFixed(1)}px,${xy[1].toFixed(1)}px) translate(-50%,-100%)`;
  });
  const pOn = S.labels && S.arr !== 'tray' && S.iso < 0 ? smooth(0.25, 0.6, S.e) : 0;
  partEls.forEach((el, i) => {
    if (!el) return;
    if (!pOn) { el.style.opacity = 0; return; }
    const p = parts[i];
    const xy = project(pv.copy(p.mesh.position).add({ x: 0, y: p.m.ext[1] * 0.5 + 3, z: 0 }), w, h);
    if (!xy) { el.style.opacity = 0; return; }
    el.style.opacity = pOn * (i === S.sel ? 0 : 1);
    el.style.transform = `translate(${xy[0].toFixed(1)}px,${xy[1].toFixed(1)}px) translate(-50%,-100%)`;
  });
}

// ── card placement ──────────────────────────────────────────────────────────
const anchorV = new THREE.Vector3();
function placeCard(w, h) {
  if (S.sel < 0) return;
  anchorV.copy(S.selPoint); parts[S.sel].mesh.localToWorld(anchorV);
  const xy = project(anchorV, w, h) || [w / 2, h / 2];
  const [ax, ay] = xy, cw = card.offsetWidth, ch = card.offsetHeight;
  let tx, ty;
  if (PHONE_Q.matches) { tx = 0; ty = 0; }
  else {
    const left = panel.classList.contains('open') ? panel.getBoundingClientRect().right - canvas.getBoundingClientRect().left : 0;
    const right = ax + 56 + cw < w - 16;
    tx = right ? ax + 56 : Math.max(left + 16, ax - 56 - cw);
    ty = Math.min(h - ch - 90, Math.max(16, ay - ch * 0.4));
  }
  if (!PHONE_Q.matches) {
    if (!card._placed) { card._x = tx; card._y = ty; card._placed = true; }
    card._x += (tx - card._x) * 0.14; card._y += (ty - card._y) * 0.14;
    card.style.transform = `translate(${card._x.toFixed(1)}px,${card._y.toFixed(1)}px)`;
  } else card.style.transform = '';
  const cr = card.getBoundingClientRect(), vr = canvas.getBoundingClientRect();
  const cx0 = cr.left - vr.left, cy0 = cr.top - vr.top;
  const nx = Math.max(cx0, Math.min(ax, cx0 + cr.width)), ny = Math.max(cy0, Math.min(ay, cy0 + cr.height));
  const line = leader.querySelector('line');
  line.setAttribute('x1', ax.toFixed(1)); line.setAttribute('y1', ay.toFixed(1));
  line.setAttribute('x2', nx.toFixed(1)); line.setAttribute('y2', ny.toFixed(1));
  for (const c of leader.querySelectorAll('circle')) { c.setAttribute('cx', ax.toFixed(1)); c.setAttribute('cy', ay.toFixed(1)); }
}
function placeHover(w, h) {
  if (hov.i < 0 || !hoverAt) return;
  const r = canvas.getBoundingClientRect(), cw = tipHover.offsetWidth, ch = tipHover.offsetHeight;
  let tx = hoverAt[0] - r.left + 20, ty = hoverAt[1] - r.top + 16;
  if (tx + cw > w - 8) tx = hoverAt[0] - r.left - 20 - cw;
  if (ty + ch > h - 8) ty = h - 8 - ch;
  hov.x += (tx - hov.x) * 0.35; hov.y += (ty - hov.y) * 0.35;
  if (!tipHover._seen) { hov.x = tx; hov.y = ty; tipHover._seen = true; }
  tipHover.style.transform = `translate(${hov.x.toFixed(1)}px,${hov.y.toFixed(1)}px)`;
}

// ── floor and shadow box ────────────────────────────────────────────────────
const fBox = new THREE.Box3(), fV = new THREE.Vector3();
let floorTick = 0;
function updateFloor(dt) {
  if (floorTick++ % 6 === 0) {
    fBox.makeEmpty();
    let minY = Infinity;
    parts.forEach((p, i) => {
      const r = p.size * 0.42;
      for (const v of [p.mesh.position, motion.M[i].to]) {
        fBox.expandByPoint(fV.copy(v).addScalar(-r)); fBox.expandByPoint(fV.copy(v).addScalar(r));
        minY = Math.min(minY, v.y - p.m.ext[1] * 0.55);
      }
    });
    S.floorWant = S.arr === 'tray' && S.e > 0.5 ? TRAY_Y - 14 : minY - 16;
    S.fBox = fBox.clone();
  }
  S.floorY += ((S.floorWant ?? S.floorY) - S.floorY) * Math.min(1, dt * 2.5);
  stage.setFloor(S.floorY, S.fBox || fBox);
}

// ── the loop ────────────────────────────────────────────────────────────────
const KEYV = new THREE.Vector3(), camDir = new THREE.Vector3();
let last = performance.now(), raf = 0, running = true, layoutCheck = 0;
function frame(nowMs) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (nowMs - last) / 1000); last = nowMs;
  const now = nowMs / 1000;
  if (!S.ready) { stage.frame(dt); return; }

  // a tall or wide clear area changes the region and tray layouts
  if (++layoutCheck % 30 === 0 && (S.arr === 'region' || S.arr === 'tray')) {
    const wide = clearAspect() >= 1.05;
    if (wide !== S.aspectWide) { computeLayout(S.arr); motion.go(targetsAt(S.e), now, { order: null, dur: 0.9 }); flyToLayout(1.0); }
  }
  camDir.copy(camera.position).sub(stage.controls.target).normalize();
  const float = REDUCED || S.arr === 'tray' ? 0 : smooth(0.1, 0.6, S.e) * (S.iso >= 0 ? 0.3 : 1);
  motion.step(now, dt, { float, camDir });

  KEYV.copy(KEY_DIR).transformDirection(camera.matrixWorldInverse);
  const k = Math.min(1, dt * 7);
  // the whole-skull AO holds only while the part and its neighbours are home
  let dSum = 0;
  for (const p of parts) { p.dHome = p.mesh.position.distanceTo(p.home); dSum += p.dHome; }
  const together = 1 - smooth(2, 18, dSum / parts.length);
  for (const p of parts) {
    const U = p.U, i = p.i;
    U.uAsm.value = (1 - smooth(3, 26, p.dHome)) * together;
    const pairHot = S.hover >= 0 && parts[S.hover].m.key === p.m.pair && S.arr === 'symmetry';
    const hl = i === S.sel ? 0.55 + 0.18 * Math.sin(now * 3.4) : i === S.hover ? 0.5 : pairHot ? 0.28 : 0;
    U.uHL.value += (hl - U.uHL.value) * k;
    const g = S.iso >= 0 && i !== S.iso ? 1 : 0;
    U.uGhost.value += (g - U.uGhost.value) * Math.min(1, dt * 5);
    if (Math.abs(U.uGhost.value - g) < 0.004) U.uGhost.value = g;
    const tr = U.uGhost.value > 0.004;
    if (p.mat.transparent !== tr) { p.mat.transparent = tr; p.mat.depthWrite = !tr; p.mat.needsUpdate = true; }
    p.mesh.castShadow = U.uGhost.value < 0.6;
    p.mesh.renderOrder = tr ? 1 : 0;
    p.mat.envMapIntensity = stage.envIntensity;
  }
  tray.frame(dt);
  updateFloor(dt);
  updateHover();
  stage.frame(dt);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  placeLabels(w, h); placeCard(w, h); placeHover(w, h);
}

// ── boot ────────────────────────────────────────────────────────────────────
async function boot() {
  setTheme(theme);
  stage.place({ az: 30, el: 10, r: 1400, target: new THREE.Vector3() });
  requestAnimationFrame(frame);
  let data;
  try {
    data = await loadSkull('data/', f => { $('ldBar').style.width = (f * 100).toFixed(1) + '%'; });
  } catch (e) {
    $('loading').querySelector('.ld-t').textContent = 'The skull data did not load.';
    console.warn(e);
    return;
  }
  man = data.man; parts = data.parts;
  for (const p of parts) { stage.root.add(p.mesh); p.U.uKey.value = KEYV; }
  setTheme(theme);
  motion = createMotion(parts, { reduced: REDUCED });
  tray = createTray({ coarse: COARSE, parts });
  tray.setTheme(theme);
  stage.scene.add(tray.group);
  if (document.fonts) document.fonts.ready.then(() => tray.redraw());
  buildList(); buildLabels();
  $('tOrbit').classList.toggle('on', stage.orbit);

  const start = (location.hash || '').slice(1);
  const arr = ARR[start] ? start : 'anatomy';
  S.arr = arr;
  computeLayout(arr);
  document.querySelectorAll('#arrs button').forEach(b => { const on = b.dataset.arr === arr; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  document.querySelectorAll('#arrList button').forEach(b => b.classList.toggle('on', b.dataset.arr === arr));
  $('plateArr').textContent = '· ' + ARR[arr].label;
  const now = performance.now() / 1000;
  if (REDUCED) {
    setExplodeUI(1);
    motion.snap(targetsAt(1));
    stage.place(fitFor(targetsAt(1), viewFor(arr), 1.06));
    tray.show(arr === 'tray');
  } else {
    // intro: scattered parts gather into the skull, then it opens
    setExplodeUI(0);
    motion.snap(targetsAt(2.4));
    motion.go(targetsAt(0), now, { order: 'in', stagger: 0.9, dur: 1.5 });
    const v = viewFor('anatomy');
    stage.place({ ...fitFor(targetsAt(0), { az: v.az - 50, el: v.el + 8 }, 1.9) });
    stage.flyTo(fitFor(targetsAt(0), v, 1.3), 2.2);
    S.introTimer = setTimeout(() => { setExplode(1, { animate: true }); tray.show(arr === 'tray'); if (arr !== 'anatomy') flyToLayout(1.4); }, 2700);
  }
  S.ready = true;
  $('loading').classList.add('gone');
}

window.addEventListener('pagehide', () => {
  running = false; cancelAnimationFrame(raf);
  try { disposeSkull(parts); if (tray) tray.dispose(); } catch (e) {}
  stage.dispose();
});

// debug and headless checks
window.__skull = {
  S, stage, get parts() { return parts; }, get man() { return man; }, setArrangement, setExplode, select, isolate, setTheme, pickAt, onTap, setOpen,
  settled: () => {
    if (!motion) return false;
    const t = performance.now() / 1000;
    return motion.M.every((m, i) => t > m.t0 + m.dur && parts[i].settle < 0.3) && !stage.fly;
  },
  selectKey: k => { const p = parts.find(q => q.m.key === k); if (p) select(p.i); },
  project: k => { const p = parts.find(q => q.m.key === k); const r = canvas.getBoundingClientRect(); const xy = project(p.mesh.position, canvas.clientWidth, canvas.clientHeight); return xy && [xy[0] + r.left, xy[1] + r.top]; },
};

// ── screensaver ─────────────────────────────────────────────────────────────
// Hook for the shell screensaver (lib/screensaver.js). enter() hides all the
// DOM but the canvas, paints the studio backdrop into the scene (the canvas
// is transparent), and plays a tour. It always opens on the full view: the
// closed skull from the face. Then come push-ins on single bones (a seeded
// shuffle, facial and cranial in turn; no teeth, no part under 30 mm, no
// small deep part): the rest turn to ghosts
// and the camera comes in from the outer face of the bone (partView) at a
// new angle each time. In the hold the bone lifts out of the skull, along
// the line from the skull middle through it, and settles back into place
// (saverLift), so it shows where it sits. After three bones one layout opens, then the full
// view comes back from a new angle. A shot lasts 6 to 9 s (calm 0 to 1).
// Part moves and camera flights take 1.6 to 2.8 times longer, and the slow
// orbit runs at 1.2 to 0.4 of its speed. The subject sits in the clear band
// of the label plate (plateBand, through stage.clearExtra). No URL or
// storage writes.
function saverBackdrop(t) {
  const c = document.createElement('canvas'); c.width = 768; c.height = 512;
  const g = c.getContext('2d'), dark = t !== 'light';
  const fill = (stops, x, y, r) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    for (const [k, col] of stops) gr.addColorStop(k, col);
    g.fillStyle = gr; g.fillRect(0, 0, 768, 512);
  };
  fill(dark ? [[0, '#26252b'], [0.45, '#16161a'], [1, '#0a0a0d']] : [[0, '#fdfbf7'], [0.48, '#f1ece3'], [1, '#dfd7c9']], 445, 205, 560);
  fill([[0.52, 'rgba(0,0,0,0)'], [1, dark ? 'rgba(0,0,0,0.55)' : 'rgba(90,70,40,0.16)']], 422, 230, 700);
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}
// The screensaver plate (opts.label). With a bone isolated it names the
// bone from skull.json (name, Latin name, group, side, mirror pair, the
// fact of the card, the mesh size in mm, FMA). Else it names the layout
// and counts the parts in each group.
function saverPlate() {
  if (!parts.length) return null;
  if (S.iso >= 0) {
    const m = parts[S.iso].m, G = GROUPS[m.group];
    const side = m.side === 'mid' ? 'midline' : m.side;
    const pair = m.pair ? parts.find(q => q.m.key === m.pair) : null;
    // Parameters: the mesh size and area from skull.json. The page has no
    // equations, so the plate has no TeX.
    const params = [{ name: 'group, side', value: `${G.label}, ${side}` }];
    if (m.ext) params.push({ name: 'mesh size', value: m.ext.map(v => Math.round(v)).join(' × ') + ' mm' });
    if (m.area) params.push({ name: 'surface area', value: Math.round(m.area / 100) + ' cm²' });
    if (m.fma) params.push({ name: 'FMA', value: m.fma });
    const lines = [m.latin + (pair ? `, pairs with the ${pair.m.name.toLowerCase()}` : '') + '.', m.fact];
    return { title: m.name, sub: `Human skull · part ${S.iso + 1} of ${parts.length}`, params, lines, anchor: partAnchor };
  }
  const n = {};
  for (const p of parts) n[p.m.group] = (n[p.m.group] || 0) + 1;
  const params = Object.keys(GROUPS).filter(g => n[g]).slice(0, 5).map(g => ({ name: GROUPS[g].label.toLowerCase(), value: String(n[g]) }));
  const open = S.e > 0.01;
  return { title: open ? `Human skull · ${ARR[S.arr].label}` : 'Human skull', sub: `${parts.length} parts · BodyParts3D meshes`,
    params, lines: [open ? ARR[S.arr].blurb : 'Reconstructed: every part back in place.'], anchor: partAnchor };
}
// The subject on screen, for the plate leader. With a bone isolated, the
// subject is that bone: its landmarks are the mesh vertices furthest along
// ±x, ±y and ±z (found once per part, in the mesh frame) and its centre,
// through mesh.matrixWorld and the stage camera (with its view offset) to
// page px. The radius holds the landmarks. Else the subject is the whole
// skull or layout: the centre of the box round all parts, a radius that
// holds each part centre plus half its size, and the eight largest parts as
// key points.
const lmv = new THREE.Vector3();
function partLandmarks(p) {
  if (p.lm) return p.lm;
  const a = p.mesh.geometry.attributes.position, best = [0, 0, 0, 0, 0, 0], val = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < a.count; i++) for (let k = 0; k < 3; k++) {
    const v = a.getComponent(i, k);
    if (v < val[2 * k]) { val[2 * k] = v; best[2 * k] = i; }
    if (v > val[2 * k + 1]) { val[2 * k + 1] = v; best[2 * k + 1] = i; }
  }
  return (p.lm = best.map(i => new THREE.Vector3(a.getX(i), a.getY(i), a.getZ(i))));
}
function partAnchor() {
  if (!parts.length || !stage) return null;
  const b = canvas.getBoundingClientRect(), cam = stage.camera;
  const P = v => { lmv.copy(v).project(cam); return lmv.z < 1 ? { x: b.left + (lmv.x + 1) / 2 * b.width, y: b.top + (1 - lmv.y) / 2 * b.height } : null; };
  if (S.iso >= 0) {
    const p = parts[S.iso], c = P(p.mesh.getWorldPosition(new THREE.Vector3())); if (!c) return null;
    const pts = partLandmarks(p).map(v => P(v.clone().applyMatrix4(p.mesh.matrixWorld))).filter(Boolean);
    let r = 0; for (const q of pts) r = Math.max(r, Math.hypot(q.x - c.x, q.y - c.y));
    return { x: c.x, y: c.y, r, pts: [c, ...pts].slice(0, 8) };
  }
  const w = new THREE.Vector3(), cs = [];
  for (const p of parts) { const q = P(p.mesh.getWorldPosition(w)); if (!q) continue;
    const e = P(w.clone().addScaledVector(cam.up, 0.5 * p.size * (p.mesh.getWorldScale(lmv.clone()).x || 1))); cs.push({ q, h: e ? Math.hypot(e.x - q.x, e.y - q.y) : 0, s: p.size }); }
  if (!cs.length) return null;
  // the box centre, not the mean: 28 teeth would pull a mean to the teeth
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const o of cs) { x0 = Math.min(x0, o.q.x - o.h); x1 = Math.max(x1, o.q.x + o.h); y0 = Math.min(y0, o.q.y - o.h); y1 = Math.max(y1, o.q.y + o.h); }
  const x = (x0 + x1) / 2, y = (y0 + y1) / 2;
  let r = 0; for (const o of cs) r = Math.max(r, Math.hypot(o.q.x - x, o.q.y - y) + o.h);
  return { x, y, r, pts: cs.sort((m, n2) => n2.s - m.s).slice(0, 8).map(o => o.q) };
}
// The camera side for part p, in degrees: outward from the middle of the
// skull, so the camera looks at the outer face of the bone. A part deep on
// the midline (sphenoid, vomer, palatines) is seen from the side, through
// the ghosts. A seeded turn of up to 25 deg is added, and the angle moves by
// 40 deg when it is near the last one. az 0 is the face (+z), az 90 the left.
const SKULL_MID = new THREE.Vector3(0, -10, 15);
function partView(p, rnd, last) {
  const v = p.home.clone().sub(SKULL_MID), h = Math.hypot(v.x, v.z), side = rnd() < 0.5 ? 1 : -1;
  let az = Math.atan2(v.x, v.z) / D2R, el = Math.atan2(v.y, h) / D2R;
  if (p.m.side === 'mid' && v.length() < 50) { az = side * (60 + 40 * rnd()); el = 5; }
  az += (rnd() * 2 - 1) * 25;
  el = Math.max(-15, Math.min(50, el + (rnd() * 2 - 1) * 10));
  if (last) {
    let da = az - last.az; da -= Math.round(da / 360) * 360;
    if (Math.abs(da) < 25 && Math.abs(el - last.el) < 12) az += da >= 0 ? 40 : -40;
  }
  return { az, el };
}
const D2R = Math.PI / 180;
// The lift of part p in a push-in: out from SKULL_MID through its home, by
// 35% of its largest mesh side (12 to 40 mm). Out from 30% to 50% of the
// hold, back from 62% to 82%, through the motion anchors (createMotion), so
// the springs ease it. The part keeps its turn; no arc (lift 0).
function saverLift(p, d, isCur) {
  const v = p.home.clone().sub(SKULL_MID);
  if (v.lengthSq() < 1) v.set(0, 1, 0);
  const out = p.home.clone().addScaledVector(v.normalize(), Math.min(40, Math.max(12, 0.35 * Math.max(...p.m.ext))));
  const move = (to, at, dur) => setTimeout(() => {
    if (!isCur() || !motion) return;
    const m = motion.M[p.i];
    m.from.copy(m.anchor); m.qFrom.copy(m.quat); m.to.copy(to); m.qTo.copy(m.quat);
    m.t0 = performance.now() / 1000; m.dur = dur; m.lift = 0;
  }, at * 1000);
  move(out, 0.3 * d, 0.2 * d);
  move(p.home.clone(), 0.62 * d, 0.2 * d);
}
window.snSaver = {
  enter(o = {}) {
    const calm = Math.max(0, Math.min(1, o.calm == null ? 0.7 : +o.calm));
    const pace = 1.6 + 1.2 * calm, hold = 6 + 3 * calm;
    let seed = (o.seed >>> 0) || 1;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    saver = { calm, pace };
    const css = document.createElement('style');
    css.textContent = '#stage{top:0!important}#stage>*:not(#view),body>*:not(#stage){display:none!important}#view{cursor:none!important}';
    document.head.appendChild(css);
    stage.scene.background = saverBackdrop(theme);
    stage.orbit = true; stage.orbitRate = 1.2 - 0.8 * calm;
    // the clear band between the plate's top and bottom text
    let band = null, bandAt = -1e9, plateBand = null;
    import('../../lib/saver-clear.js').then(m => { plateBand = m.plateBand; }).catch(() => { /* no band: the full canvas */ });
    stage.clearExtra = (w, h) => {
      const now = performance.now();
      // a plate that changes its text has no band for a moment: keep the last one
      if (plateBand && now - bandAt > 250) { bandAt = now; band = plateBand(h) || band; }
      return band ? { t: band.t, b: band.b, l: 0, r: 0 } : null;
    };
    // The tour: the full view of the closed skull from the face first, then
    // three bones (a seeded shuffle, cranial and facial in turn), then one
    // open layout, then the full view again from a new angle, and so on.
    const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const turn = rnd() < 0.5 ? 1 : -1;
    const fulls = [{ az: -10 * turn, el: 6 }, { az: 40 * turn, el: 14 }, { az: -45 * turn, el: 10 }, { az: 90 * turn, el: 4 }];
    const arrs = shuf(['anatomy', 'symmetry', 'region']);
    let tour = null, k = -1, last = null, cur = null;
    const makeTour = () => {
      // A part under 30 mm (the lacrimals) is a speck inside the ghosts. A
      // part under 50 mm that lies deep (centre within 60 mm of SKULL_MID:
      // the palatines, the ethmoid, the conchae) sits behind layers of
      // ghosts and reads as noise.
      const big = p => { const e = Math.max(...p.m.ext); return e >= 30 && (e >= 50 || p.home.distanceTo(SKULL_MID) >= 60); };
      const cran = shuf(parts.filter(p => p.m.group === 'cranial' && big(p))), face = shuf(parts.filter(p => (p.m.group === 'facial' || p.m.group === 'hyoid') && big(p)));
      const bones = [];
      while (cran.length || face.length) { if (face.length) bones.push(face.pop()); if (cran.length) bones.push(cran.pop()); }
      const t = [];
      let bi = 0, fi = 0, ai = 0;
      while (bi < bones.length) {
        t.push({ full: fulls[fi++ % fulls.length] });
        for (let j = 0; j < 3 && bi < bones.length; j++) t.push({ part: bones[bi++].i });
        t.push({ arr: arrs[ai++ % arrs.length] });
      }
      return t;
    };
    // The subject box: the part centres at targets T, each plus half its
    // mesh size. FIT: the larger side of the box as a share of the short
    // side of the clear band (a layout: of the band width and height).
    const FIT = { full: 0.85, bone: 0.6, layout: 0.9 };
    const boxOf = T => {
      const b = new THREE.Box3();
      T.forEach((t, i) => b.union(new THREE.Box3().setFromCenterAndSize(t.pos, new THREE.Vector3(...parts[i].m.ext))));
      return b;
    };
    const label = () => { if (typeof o.label === 'function') { try { o.label(saverPlate()); } catch (e) { /* the plate is optional */ } } };
    const step = () => {
      if (!S.ready || !motion || !parts.length) { saver.timer = setTimeout(step, 300); return; }
      if (!tour) tour = makeTour();
      k = (k + 1) % tour.length; cur = tour[k];
      clearTimeout(S.introTimer);
      let d = hold;
      if (cur.full) {
        // the primary view: every part in place, nothing ghosted
        if (S.iso >= 0) isolate(-1, { fly: false });
        select(-1);
        const was = S.e;
        if (S.arr !== 'anatomy') { S.arr = 'anatomy'; computeLayout('anatomy'); tray.show(false); }
        setExplodeUI(0);
        motion.go(targetsAt(0), performance.now() / 1000, { order: 'in', stagger: 0.5, dur: 1.15 * pace });
        const v = cur.full;
        cur.fit = () => stage.fitFrac(boxOf(targetsAt(0)), v.az, v.el, FIT.full);
        stage.flyTo(cur.fit(), (was > 0.05 ? 1.6 : 2.2) * pace);
        d = hold + 1;
      } else if (cur.part != null) {
        // a push-in on one bone: the rest turn to ghosts
        const p = parts[cur.part];
        if (S.e > 0.02) { setExplodeUI(0); motion.go(targetsAt(0), performance.now() / 1000, { order: 'in', stagger: 0.3, dur: 0.9 * pace }); }
        cur.view = partView(p, rnd, last); last = cur.view;
        isolate(p.i, { fly: false });
        const b = new THREE.Box3().setFromCenterAndSize(p.home, new THREE.Vector3(...p.m.ext));
        const v = cur.view;
        cur.fit = () => stage.fitFrac(b, v.az, v.el, FIT.bone);
        stage.flyTo(cur.fit(), 1.5 * pace);
        stage.hold = false;   // keep the orbit
        const me = cur;
        saverLift(p, d, () => cur === me);
      } else {
        // an open layout, from its own view
        if (S.iso >= 0) isolate(-1, { fly: false });
        select(-1);
        setArrangement(cur.arr);
        if (S.e < 0.5) setExplode(1, { animate: true });
        const now = performance.now() / 1000;
        for (const m of motion.M) if (m.t0 > -1e8 && m.t0 + m.dur > now) { m.t0 = now + Math.max(0, m.t0 - now) * pace; m.dur *= pace; }
        // the open layout fills the band (the page fit leaves it small)
        const v = viewFor(cur.arr);
        cur.fit = () => stage.fitFrac(boxOf(targetsAt(1)), v.az, v.el, FIT.layout, true);
        stage.flyTo(cur.fit(), 1.5 * pace);
        d = hold + 1.5;
      }
      label();
      // The plate shows the new text after label(), and the clear band
      // moves with it (on the first shot it appears only now). Fit again
      // 0.8 s later from the band at that time. The orbit keeps its angle.
      const me = cur;
      setTimeout(() => {
        if (cur !== me || !me.fit) return;
        const f = me.fit(), now = stage.view();
        stage.flyTo({ ...f, az: stage.fly ? f.az : now.az, el: stage.fly ? f.el : now.el }, 1.2 * pace);
      }, 800);
      saver.timer = setTimeout(step, d * 1000);
    };
    // the tour state, for the headless probe
    window.snSaver.debug = () => cur && { k, kind: cur.full ? 'full' : cur.part != null ? 'part' : 'layout', what: cur.part != null ? parts[cur.part].m.name : cur.arr || 'full', e: +S.e.toFixed(2), iso: S.iso,
      tour: tour.filter(x => x.part != null).map(x => parts[x.part].m.key).join(' '), ...frameStats() };
    // the subject box on the screen (mesh boxes now) and the clear part, in canvas CSS px
    const frameStats = () => {
      const W = canvas.clientWidth, H = canvas.clientHeight, b = new THREE.Box3(), q = new THREE.Vector3();
      for (const p of cur.part != null ? [parts[cur.part]] : parts) b.expandByObject(p.mesh);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        q.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(camera);
        const x = (q.x + 1) / 2 * W, y = (1 - q.y) / 2 * H;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      const o = stage.occlusion();
      return { box: [x0, y0, x1, y1].map(Math.round), clear: [o.l, o.t, W - o.r, H - o.b].map(Math.round), W, H };
    };
    saver.timer = setTimeout(step, 300);
    return { canvas, warmupMs: 3000 };
  },
};
boot();
