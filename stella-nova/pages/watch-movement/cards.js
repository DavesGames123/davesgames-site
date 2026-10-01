// ============================================================================
//  WATCH MOVEMENT  ·  cards.js — part picking, hover and pinned cards, labels
// ────────────────────────────────────────────────────────────────────────────
//  createCards() wires the part cards to a stage (stage.js). A mouse hover
//  raycasts once per frame and shows #tipHover by the pointer. A click or
//  tap pins #tipPin beside the part, with the #leader line to the hit
//  point, until the next click. Both cards fill live rows each frame. The
//  hovered part glows and the pinned part breathes. Labels (#labels) sit
//  on parts that have one, when the model is spread apart.
//
//  The page supplies get(): { B, PARTS, per, state, alpha } for the model
//  on show, and the DOM ids above. A part card reads PARTS[id]: { name,
//  group, role, specs: [[k, v]], rate, live, angleKey }.
//
//  GREP MAP
//    function pick ............ raycast to { id, obj, local }
//    function cardHTML ........ the card body
//    function liveRows ........ live values and the gauge needle
//    function placePinned ..... pinned card position and its leader
//    function frame ........... per-frame hover, glow, cards, labels
// ============================================================================
import * as THREE from 'three';

const D = Math.PI / 180, TAU = Math.PI * 2;
export const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
export const vis = o => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
const GROUP_COLOR = { Power: '#ffb46a', 'Going train': '#e9c27a', Escapement: '#ff8a9a', Regulator: '#9fd0ff', Frame: '#b9c0cf', 'Keyless works': '#c8a6ff', 'Motion works': '#8fe0c0', Display: '#f0e6d0', 'Self-winding': '#ffd27a', Tourbillon: '#7fe3ff', Fusee: '#ffb0d0', Case: '#e6c9a8', Strap: '#c79a6b', Alarm: '#ff9f80' };
const rpm = s => { const r = 60 / s; return r >= 1 ? `${+r.toFixed(2)} rpm` : `${+(r * 60).toFixed(r * 60 >= 1 ? 2 : 4)} rph`; };
function fmtPeriod(s) {
  if (!isFinite(s) || s <= 0) return '—';
  if (s >= 3600) return `${+(s / 3600).toFixed(2)} h`;
  if (s >= 60) return `${+(s / 60).toFixed(2)} min`;
  return `${+s.toFixed(3)} s`;
}

// o: { stage, $, isPhone, get, labelsOn(): opacity 0..1, onTap }
export function createCards(o) {
  const { stage, $ } = o, canvas = stage.renderer.domElement, camera = stage.camera;
  const tipHover = $('tipHover'), tipPin = $('tipPin'), leader = $('leader');
  const C = { pin: null, hover: null };
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

  function pick(cx, cy) {
    const cur = o.get();
    if (!cur || cur.alpha < 0.6) return null;
    const r = canvas.getBoundingClientRect();
    ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(cur.B.pickables.filter(vis), false)[0];
    if (!hit) return null;
    const id = hit.object.userData.part;
    if (!cur.PARTS[id]) return null;
    return { id, obj: hit.object, local: hit.object.worldToLocal(hit.point.clone()) };
  }

  // the pose key that turns a part, for the live angle and the gauge
  const liveKey = P => P.angleKey || (P.live && !['reserve', 'rotor'].includes(P.live) ? P.live : P.rate) || null;
  function cardHTML(id) {
    const cur = o.get(), P = cur.PARTS[id], per = cur.per[P.rate];
    const rows = (P.specs || []).map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`).join('');
    const live = [];
    if (P.rate && per) live.push(['One turn', fmtPeriod(per), ''], ['Speed', rpm(per), '']);
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
  function liveRows(el, id, p) {
    const cur = o.get(), P = cur.PARTS[id]; if (!P) return;
    const k = liveKey(P), a = k && typeof p[k] === 'number' ? p[k] : null;
    const deg = a === null ? null : ((a / D) % 360 + 360) % 360;
    const set = (key, t) => { const n = el.querySelector(`[data-live="${key}"]`); if (n && n.textContent !== t) n.textContent = t; };
    if (deg !== null) set('angle', `${deg.toFixed(1)}°`);
    set('amp', `${(cur.state.amp / D).toFixed(0)}°`);
    set('reserve', `${Math.max(0, p.reserve * cur.cal.hoursPerTurn).toFixed(1)} h`);
    if (p.fork !== undefined) set('fork', `${(p.fork / D).toFixed(1)}°`);
    const needle = el.querySelector('.needle'), arc = el.querySelector('.arc');
    if (needle) needle.setAttribute('transform', `rotate(${deg === null ? 0 : (-deg).toFixed(2)})`);
    if (arc) {
      const f = P.live === 'reserve' ? Math.max(0, Math.min(1, p.reserve / cur.cal.CAL.reserveTurns)) : P.live === 'balance' ? Math.min(1, Math.abs(p.balance) / (330 * D)) : 0;
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
  const hideHover = () => hideCard(tipHover);
  function setPin(hit) {
    C.pin = hit;
    stage.slow = !!hit;
    if (!hit) { hideCard(tipPin); leader.classList.remove('show'); return; }
    showCard(tipPin, hit.id);
    tipPin._placed = false;
    leader.classList.remove('show'); void leader.getBoundingClientRect(); leader.classList.add('show');
    if (C.hover === hit.id) hideHover();
  }
  // pin a part by id (from a table row): anchor on the centre of its first mesh
  function pinById(id) {
    const m = o.get().B.pickables.find(q => q.userData.part === id && vis(q));
    if (!m) return;
    m.geometry.computeBoundingBox();
    setPin({ id, obj: m, local: m.geometry.boundingBox.getCenter(new THREE.Vector3()) });
  }
  $('tipPinClose').addEventListener('click', () => setPin(null));

  const anchorV = new THREE.Vector3();
  function placePinned(w, h) {
    if (!C.pin) return;
    if (!vis(C.pin.obj) || !C.pin.obj.parent) { setPin(null); return; }
    anchorV.copy(C.pin.local); C.pin.obj.localToWorld(anchorV); anchorV.project(camera);
    const ax = (anchorV.x + 1) / 2 * w, ay = (1 - anchorV.y) / 2 * h;
    const cw = tipPin.offsetWidth, chh = tipPin.offsetHeight;
    let tx, ty;
    if (o.isPhone()) { tx = (w - cw) / 2; ty = h - chh - 10; }
    else {
      const right = ax + 46 + cw < w - 12;
      tx = right ? ax + 46 : Math.max(12, ax - 46 - cw);
      ty = Math.min(h - chh - 12, Math.max(12, ay - chh * 0.35));
    }
    if (!tipPin._placed) { tipPin._x = tx; tipPin._y = ty; tipPin._placed = true; }
    tipPin._x += (tx - tipPin._x) * 0.16; tipPin._y += (ty - tipPin._y) * 0.16;
    tipPin.style.transform = `translate(${tipPin._x.toFixed(1)}px,${tipPin._y.toFixed(1)}px)`;
    const nx = Math.max(tipPin._x, Math.min(ax, tipPin._x + cw)), ny = Math.max(tipPin._y, Math.min(ay, tipPin._y + chh));
    const line = leader.querySelector('line');
    line.setAttribute('x1', ax.toFixed(1)); line.setAttribute('y1', ay.toFixed(1));
    line.setAttribute('x2', nx.toFixed(1)); line.setAttribute('y2', ny.toFixed(1));
    for (const c of leader.querySelectorAll('circle')) { c.setAttribute('cx', ax.toFixed(1)); c.setAttribute('cy', ay.toFixed(1)); }
  }
  const hoverPos = { x: 0, y: 0, tx: 0, ty: 0 };
  function placeHover(w, h) {
    if (!tipHover._id) return;
    const cw = tipHover.offsetWidth, chh = tipHover.offsetHeight;
    let tx = hoverPos.tx + 22, ty = hoverPos.ty + 18;
    if (tx + cw > w - 8) tx = hoverPos.tx - 22 - cw;
    if (ty + chh > h - 8) ty = Math.max(8, h - 8 - chh);
    hoverPos.x += (tx - hoverPos.x) * 0.3; hoverPos.y += (ty - hoverPos.y) * 0.3;
    tipHover.style.transform = `translate(${hoverPos.x.toFixed(1)}px,${hoverPos.y.toFixed(1)}px)`;
  }

  // ── pointer ───────────────────────────────────────────────────────────────
  let down = null, rayAt = null;
  canvas.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const r = canvas.getBoundingClientRect();
    hoverPos.tx = e.clientX - r.left; hoverPos.ty = e.clientY - r.top;
    if (!tipHover._id) { hoverPos.x = hoverPos.tx + 22; hoverPos.y = hoverPos.ty + 18; }
    rayAt = [e.clientX, e.clientY];
  });
  canvas.addEventListener('pointerleave', () => { rayAt = null; C.hover = null; hideHover(); canvas.style.cursor = ''; });
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; if (o.onTap) o.onTap(); });
  canvas.addEventListener('pointerup', e => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
    down = null;
    if (moved > 6 || dt > 600) return;
    setPin(pick(e.clientX, e.clientY));        // a part pins its card; empty space clears it
  });

  // ── labels ────────────────────────────────────────────────────────────────
  let labelEls = [];
  function buildLabels() {
    $('labels').innerHTML = '';
    labelEls = [];
    const B = o.get().B;
    for (const id in B.parts) {
      const q = B.parts[id]; if (!q.label) continue;
      const el = document.createElement('div'); el.className = 'lb'; el.innerHTML = `<i></i>${esc(q.label)}`;
      $('labels').appendChild(el);
      labelEls.push({ q, el });
    }
  }
  function placeLabels(w, h) {
    const cur = o.get(), op = o.labelsOn();
    for (const { q, el } of labelEls) {
      if (!op || !vis(q.holder)) { el.style.opacity = 0; continue; }
      const v = cur.B.labelPoint(q).project(camera);
      if (v.z > 1) { el.style.opacity = 0; continue; }
      el.style.opacity = op;
      el.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px,${((1 - v.y) / 2 * h).toFixed(1)}px) translate(-50%,-50%)`;
    }
  }

  // ── per frame, after the render ───────────────────────────────────────────
  function frame(p, now, dt) {
    const cur = o.get();
    if (rayAt && !stage.dragging) {
      const hit = pick(rayAt[0], rayAt[1]);
      const id = hit ? hit.id : null;
      if (id !== C.hover) { C.hover = id; if (id && (!C.pin || C.pin.id !== id)) showCard(tipHover, id); else hideHover(); }
      canvas.style.cursor = id ? 'pointer' : '';
    }
    for (const k in cur.B.parts) {
      const q = cur.B.parts[k];
      const tgt = C.pin && q.info === C.pin.id ? 0.75 + 0.18 * Math.sin(now / 260) : C.hover && q.info === C.hover ? 0.55 : 0;
      let nv = q.hl + (tgt - q.hl) * Math.min(1, dt * 9);
      if (tgt === 0 && nv < 2e-3) nv = 0;
      if (nv !== q.hl) { q.hl = nv; cur.B.setHighlight(q, nv); }
    }
    const w = canvas.clientWidth, h = canvas.clientHeight;
    placeLabels(w, h); placeHover(w, h); placePinned(w, h);
    if (tipHover._id) liveRows(tipHover, tipHover._id, p);
    if (tipPin._id) liveRows(tipPin, tipPin._id, p);
  }
  // after a model swap: drop the cards and rebuild the labels
  function reset() { setPin(null); C.hover = null; hideHover(); buildLabels(); }
  return { C, pick, setPin, pinById, hideHover, showCard, frame, reset, buildLabels };
}
