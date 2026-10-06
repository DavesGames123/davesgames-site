// ============================================================================
//  ANTIKYTHERA MECHANISM  ·  cards.js — a copy of differential/cards.js (same API)
// ────────────────────────────────────────────────────────────────────────────
//  The watch-movement card pattern. A mouse hover raycasts once per frame and
//  shows #tipHover by the pointer. A click or a tap pins #tipPin beside the
//  part with the #leader line, until the next click. Both cards fill live
//  rows each frame. The hovered part glows and the pinned part breathes.
//  Labels (#labels) sit on the parts that have one.
//
//  The page supplies get(): { B, PARTS, alpha }, live(key): [label, text]
//  for a live row, gauge(): the carrier angle (rad) for the dial.
//
//  GREP MAP
//    function pick ............ raycast to { id, obj, local }
//    function cardHTML ........ the card body
//    function liveRows ........ live values and the gauge needle
//    function placePinned ..... pinned card position and its leader
//    function frame ........... per-frame hover, glow, cards, labels
// ============================================================================
import * as THREE from 'three';
import { GROUP_COLOR } from './parts.js';

export const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
export const vis = o => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };

// o: { stage, $, isPhone, get, live, gauge, labelsOn(): 0..1, onTap }
export function createCards(o) {
  const { stage, $ } = o, canvas = stage.renderer.domElement, camera = stage.camera;
  const tipHover = $('tipHover'), tipPin = $('tipPin'), leader = $('leader');
  const C = { pin: null, hover: null };
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

  // a hit on the cut-away half of a shell does not count: test the plane
  function pick(cx, cy) {
    const cur = o.get();
    if (!cur || cur.alpha < 0.6) return null;
    const r = canvas.getBoundingClientRect();
    ndc.set((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(cur.B.pickables.filter(vis), false);
    for (const hit of hits) {
      const planes = hit.object.material.clippingPlanes;
      if (planes && planes.some(pl => pl.distanceToPoint(hit.point) < 0)) continue;
      const id = hit.object.userData.part;
      if (!cur.PARTS[id]) continue;
      return { id, obj: hit.object, local: hit.object.worldToLocal(hit.point.clone()) };
    }
    return null;
  }

  function cardHTML(id) {
    const P = o.get().PARTS[id];
    const rows = (P.specs || []).map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`).join('');
    const live = (P.live || []).map(key => { const [k, v] = o.live(key); return `<div class="k">${esc(k)}</div><div class="v live" data-live="${key}">${esc(v)}</div>`; }).join('');
    const col = GROUP_COLOR[P.group] || '#e9c27a';
    return `<div class="tip-head"><svg class="gauge" viewBox="-20 -20 40 40" aria-hidden="true"><circle class="face" r="17"/><line class="needle" x1="0" y1="3" x2="0" y2="-14"/><circle class="hub" r="2.2"/></svg>
      <div><div class="eyebrow" style="--gc:${col}"><i></i>${esc(P.group)}</div><div class="name">${esc(P.name)}</div></div></div>
      <p class="role">${esc(P.role)}</p>
      <div class="specs">${rows}${live}</div>`;
  }
  function liveRows(el) {
    for (const n of el.querySelectorAll('[data-live]')) { const t = o.live(n.dataset.live)[1]; if (n.textContent !== t) n.textContent = t; }
    const needle = el.querySelector('.needle');
    if (needle) needle.setAttribute('transform', `rotate(${(o.gauge() * 180 / Math.PI).toFixed(1)})`);
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
  // pin a part by id (from the parts list): anchor on its first mesh centre
  function pinById(id) {
    const m = o.get().B.pickables.find(q => q.userData.part === id && vis(q));
    if (!m) return;
    m.geometry.computeBoundingBox();
    const c = m.geometry.boundingBox.getCenter(new THREE.Vector3());
    setPin({ id, obj: m, local: c });
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
      const L = o.clearLeft ? o.clearLeft() : 0, R = o.clearRight ? o.clearRight() : w;
      const right = ax + 46 + cw < R - 12;
      tx = right ? ax + 46 : Math.max(L + 12, ax - 46 - cw);
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
    setPin(pick(e.clientX, e.clientY));
  });

  // labels
  let labelEls = [];
  function buildLabels() {
    $('labels').innerHTML = '';
    labelEls = [];
    const B = o.get().B;
    for (const id in B.parts) {
      const q = B.parts[id]; if (!q.label) continue;
      const el = document.createElement('div'); el.className = 'lb'; el.innerHTML = `<i></i>${esc(q.label)}`;
      $('labels').appendChild(el);
      labelEls.push({ q, el, w: 0, h: 0 });
    }
  }
  // labels that would overlap step down below the one above them
  const placed = [];
  function placeLabels(w, h) {
    const cur = o.get(), op = o.labelsOn();
    const list = [];
    for (const L of labelEls) {
      const { q, el } = L;
      if (!op || !vis(q.holder)) { if (el._o !== 0) { el.style.opacity = 0; el._o = 0; } continue; }
      const v = cur.B.labelPoint(q).project(camera);
      if (v.z > 1) { el.style.opacity = 0; el._o = 0; continue; }
      if (!L.w) { L.w = el.offsetWidth; L.h = el.offsetHeight; }
      list.push({ L, x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h });
    }
    list.sort((a, b) => a.y - b.y);
    placed.length = 0;
    for (const it of list) {
      const { L } = it;
      for (let pass = 0; pass < 6; pass++) {
        const hit = placed.find(p => Math.abs(p.x - it.x) < (p.w + L.w) / 2 + 4 && Math.abs(p.y - it.y) < (p.h + L.h) / 2 + 2);
        if (!hit) break;
        it.y = hit.y + (hit.h + L.h) / 2 + 2;
      }
      const lo = (o.clearLeft ? o.clearLeft() : 0) + L.w / 2 + 6, hi = (o.clearRight ? o.clearRight() : w) - L.w / 2 - 6;
      if (hi > lo) it.x = Math.max(lo, Math.min(hi, it.x));
      placed.push({ x: it.x, y: it.y, w: L.w, h: L.h });
      L.el.style.opacity = op; L.el._o = op;
      L.el.style.transform = `translate(${it.x.toFixed(1)}px,${it.y.toFixed(1)}px) translate(-50%,-50%)`;
    }
  }

  function frame(now, dt) {
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
    if (tipHover._id) liveRows(tipHover);
    if (tipPin._id) liveRows(tipPin);
  }
  function reset() { setPin(null); C.hover = null; hideHover(); buildLabels(); }
  return { C, pick, setPin, pinById, hideHover, showCard, frame, reset, buildLabels };
}
