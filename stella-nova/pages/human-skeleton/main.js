// ============================================================================
//  HUMAN SKELETON  ·  main.js — state, loading, UI, picking, camera, loop
// ────────────────────────────────────────────────────────────────────────────
//  The manifest arrives first: it builds the list, the camera frame and the
//  bone state texture. The eight body groups then load at the same time
//  (spine and thorax first) and each one dissolves in when it arrives.
//
//  STATE    per bone: cur / from / to (offset + rotation), a stagger delay,
//           a drag offset with a spring, an appear factor, a flag (shown,
//           hidden, ghost). Every frame that changes, they go into the
//           BoneState texture (render.js) and the GPU moves the bones.
//  MODES    radial, regional (layout.js), catalogue (the tray). An amount
//           per region scales radial and regional, so one hand can open
//           while the rest stays put. Reconstruct plays the stagger back.
//  PICK     the bones render their row as a colour into a small target
//           round the tap (view offset of the main camera); the nearest
//           coloured pixel wins. Radius 4 px (mouse) or 22 px (touch).
//  SELECT   the bone glows, the card opens, the list marks it, and the
//           camera pans if the bone sits under the card or the panel.
//  ISOLATE  the other bones become fresnel ghosts; the camera flies to
//           the bone and orbits it.
//  FRAME    occlusion() measures the panel and the card;
//           camera.setViewOffset centres the view in the clear part.
//
//  GREP MAP
//    function loadAll / addGroup / ensureCartilage        loading
//    function setMode / explode / reconstruct / target    layouts
//    function pickAt / onTap / select / showCard          picking
//    function isolate / step / focusRegion / focusBone    inspection
//    function buildList / syncList / setRegionHidden      the bone list
//    function occlusion / resize / flyTo / fitView        camera
//    function setTheme / buildUI / syncUI / setOpen       controls
//    function placeLabels / buildTrays                    the tray
//    function frame                                       the loop
// ============================================================================
import * as L from './layout.js';
import { $, COARSE, REDUCED, esc, clamp01, easeIO, ease, MODE_NAME, THEMES } from './app/env.js';
import { canvas, renderer, scene, envRT, camera, key, floor, poolTex, pool, trays, U, controls } from './app/stage.js';
import { T, S, dirty, toast } from './app/state.js';
import { occ, occlusion, resize, fitView, fitShadow } from './app/camera.js';
import { placeLabels } from './app/tray.js';
import { pickRT, pickAt } from './app/pick.js';
import { loadAll, ensureCartilage } from './app/load.js';
import { refreshVisibility } from './app/visibility.js';
import { exploded, retarget, setMode, explode, reconstruct, setAmount, toggleRegionExplode } from './app/layouts.js';
import { boneCentre, select, clearSelection, step } from './app/select.js';
import { isolate, exitIsolate, focusBone, focusRegion } from './app/inspect.js';
import { list, setRegionHidden } from './app/list.js';
import { dVelZero, hoverPick } from './app/pointer.js';
import { setOpen } from './app/panel.js';

// ── controls ─────────────────────────────────────────────────────────────────
function setTheme(t) {
  S.theme = t;
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('hs-theme', t); } catch (e) { /* private mode */ }
  const th = THEMES[t];
  U.uSel.value.set(th.sel); U.uHov.value.set(th.hov); U.uGhost.value.set(th.ghost); U.uGhostA.value = th.ghostA;
  floor.material.opacity = th.shadow;
  pool.material.color.set(th.pool); pool.material.opacity = th.poolA;
  renderer.toneMappingExposure = th.exposure;
  for (const m of trays.children) {
    if (m.isLineSegments) m.material.color.set(th.trayLine); else m.material.color.set(th.tray);
  }
  dirty();
}
export function setShow(k, v) {
  S.show[k] = v;
  if (k === 'spin') { controls.autoRotate = v; }
  else if (k === 'cartilage' && v) ensureCartilage().then(() => refreshVisibility(true));
  else refreshVisibility(true);
  syncUI();
}
export function syncRead() {
  if (!S.M) return;
  const bones = S.bones.filter(b => S.vis[b.i] && b.counted).length;
  const extra = [];
  const teeth = S.bones.filter(b => S.vis[b.i] && b.type === 'tooth').length;
  const cart = S.bones.filter(b => S.vis[b.i] && b.type === 'cartilage').length;
  if (teeth) extra.push(`${teeth} teeth`);
  if (cart) extra.push(`${cart} cartilages`);
  const mode = S.iso >= 0 ? 'Isolated' : !exploded() ? 'Assembled' : S.mode === 'catalogue' ? `On the tray, by ${S.sort === 'size' ? 'length' : 'region'}` : `${MODE_NAME[S.mode]} explode`;
  $('read').innerHTML = `<span class="meta">${esc(mode)}</span><b>${bones} bones</b>${extra.join(' · ')}`;
}
export function syncUI() {
  if (!S.amt) return;
  const ex = exploded();
  const modeNow = S.mode === 'catalogue' ? 'catalogue' : ex ? S.mode : 'assembled';
  for (const b of $('modes').children) { b.classList.toggle('on', b.dataset.mode === modeNow); b.setAttribute('aria-checked', String(b.dataset.mode === modeNow)); }
  $('sortRow').hidden = S.mode !== 'catalogue';
  $('amountRow').classList.toggle('off', S.mode === 'catalogue');
  const am = S.amt.length ? Math.max(...S.amt) : 0;
  $('amount').value = String(S.mode === 'catalogue' ? 1 : am);
  $('amountV').textContent = `${Math.round((S.mode === 'catalogue' ? 1 : am) * 100)}%`;
  for (const b of $('sortRow').children) b.classList.toggle('on', b.dataset.sort === S.sort);
  for (const b of $('shows').children) b.classList.toggle('on', !!S.show[b.dataset.show]);
  $('dockExplodeV').textContent = ex ? 'Reconstruct' : 'Explode';
  $('dockExplode').classList.toggle('on', ex);
  $('dockModeV').textContent = MODE_NAME[S.mode === 'catalogue' ? 'catalogue' : S.lastMode];
  for (const g of list.querySelectorAll('.rg')) {
    const rid = g.dataset.r;
    const hidden = rid === 'teeth' ? !S.show.teeth : rid === 'cartilage' ? !S.show.cartilage : S.hiddenRegion.has(rid);
    g.classList.toggle('hidden', hidden);
    const hb = g.querySelector('[data-x="hide"]');
    hb.textContent = hidden ? 'Show' : 'Hide';
    hb.classList.toggle('on', hidden);
    const eb = g.querySelector('[data-x="explode"]');
    if (eb) eb.classList.toggle('on', S.mode !== 'catalogue' && S.amt[S.regionIx.get(rid)] > 0 && S.amt.some(x => x === 0));
  }
  syncRead();
}
function buildUI() {
  $('modes').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
  $('amount').addEventListener('input', e => setAmount(+e.target.value));
  $('sortRow').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.sort = b.dataset.sort; if (S.mode === 'catalogue') retarget(true); syncUI(); } });
  $('bReconstruct').addEventListener('click', reconstruct);
  $('focus').addEventListener('click', e => { const b = e.target.closest('button'); if (b) focusRegion(b.dataset.focus); });
  $('shows').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setShow(b.dataset.show, !S.show[b.dataset.show]); });
  $('dockExplode').addEventListener('click', () => (exploded() ? reconstruct() : explode()));
  $('dockMode').addEventListener('click', () => {
    const order = ['radial', 'regional', 'catalogue'];
    const now = S.mode === 'catalogue' ? 'catalogue' : S.lastMode;
    const next = exploded() ? order[(order.indexOf(now) + 1) % 3] : now;
    setMode(next);
  });
  const flip = () => setTheme(S.theme === 'dark' ? 'light' : 'dark');
  $('dockTheme').addEventListener('click', flip);
  $('themeBtn').addEventListener('click', flip);
  $('dockFit').addEventListener('click', () => { if (S.iso >= 0) exitIsolate(false); fitView(false); });
  $('hint').textContent = COARSE ? 'Tap a bone · drag to turn · pinch to zoom' : 'Click a bone · drag to orbit · scroll to zoom';
  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input')) return;
    if (e.key === 'Escape') { if (S.iso >= 0) exitIsolate(true); else clearSelection(); }
    else if (e.key === 'ArrowRight' || e.key === ']') step(1);
    else if (e.key === 'ArrowLeft' || e.key === '[') step(-1);
    else if (e.key === 'e') (exploded() ? reconstruct() : explode());
    else if (e.key === 'i' && S.sel >= 0) (S.iso >= 0 ? exitIsolate(true) : isolate(S.sel));
    else if (e.key === 'f' && S.sel >= 0) focusBone(S.sel);
    else if (e.key === 'r') fitView(false);
  });
  addEventListener('resize', dirty);
}

// ── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), raf = 0, running = true;
const _q = new Float32Array(4);
function frame(now) {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  let upload = false;
  // framing eases toward the clear area
  const o = occlusion();
  for (const k in occ) {
    const d = o[k] - occ[k];
    if (Math.abs(d) > 0.5) { occ[k] += d * Math.min(1, dt * 9); S.dirty = true; } else if (d) { occ[k] = o[k]; S.dirty = true; }
  }
  if (S.fly) {
    const f = S.fly;
    f.t = Math.min(1, f.t + dt / f.dur);
    const k = easeIO(f.t);
    controls.target.lerpVectors(f.t0, f.t1, k);
    const u = f.u1 ? f.u0.clone().lerp(f.u1, k).normalize() : camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(u, f.r0 + (f.r1 - f.r0) * k);
    if (f.t >= 1) S.fly = null;
    S.dirty = true;
  }
  if (S.ready) {
    // explode transition
    if (S.tr) {
      const tr = S.tr;
      tr.t += dt;
      for (let i = 0; i < S.n; i++) {
        const k = easeIO(clamp01((tr.t - S.delay[i]) / tr.dur));
        for (let a = 0; a < 3; a++) S.cur.off[i * 3 + a] = S.from.off[i * 3 + a] + (S.to.off[i * 3 + a] - S.from.off[i * 3 + a]) * k;
        L.slerp(S.from.q, i * 4, S.to.q, i * 4, k, S.cur.q, i * 4);
      }
      for (const m of trays.children) m.material.opacity = (S.traysOn ? ease(clamp01(tr.t / Math.max(0.3, tr.end * 0.6))) : 1 - ease(clamp01(tr.t / 0.35))) * (m.isLineSegments ? 0.55 : 1);
      if (tr.t >= tr.end) { S.tr = null; if (!S.traysOn) for (const m of trays.children) m.visible = false; fitShadow(); }
      else for (const m of trays.children) m.visible = true;
      upload = true;
    }
    // drag springs
    for (const i of S.springing) {
      let e = 0;
      for (let a = 0; a < 3; a++) {
        const k = i * 3 + a;
        S.dVel[k] += (-70 * S.dOff[k] - 9 * S.dVel[k]) * dt;
        S.dOff[k] += S.dVel[k] * dt;
        e += Math.abs(S.dOff[k]) + Math.abs(S.dVel[k]) * 0.05;
      }
      if (e < 1e-5) { S.dOff.fill(0, i * 3, i * 3 + 3); dVelZero(i); S.springing.delete(i); }
      upload = true;
    }
    if (S.drag) upload = true;
    // dissolve in as groups arrive
    for (const b of S.bones) {
      if (!S.loaded[b.i] || S.appear[b.i] >= 1) continue;
      S.appear[b.i] = REDUCED ? 1 : clamp01((now - b.appearAt) / 650);
      upload = true;
    }
    if (upload) {
      for (let i = 0; i < S.n; i++) {
        S.state.set(0, i, S.cur.off[i * 3] + S.dOff[i * 3], S.cur.off[i * 3 + 1] + S.dOff[i * 3 + 1], S.cur.off[i * 3 + 2] + S.dOff[i * 3 + 2], S.appear[i]);
        _q.set(S.cur.q.subarray(i * 4, i * 4 + 4));
        S.state.set(1, i, _q[0], _q[1], _q[2], _q[3]);
      }
      S.state.dirty();
      S.dirty = true;
    }
  }
  controls.autoRotate = S.show.spin && !S.fly && !S.drag;
  if (controls.update(dt)) S.dirty = true;
  if (S.show.spin) S.dirty = true;
  // hover pick, once a frame, while the mouse is still
  hoverPick();
  if (!S.dirty) return;
  S.dirty = false;
  if (!resize()) return;
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  placeLabels();
  S.frames++;
  if (!T.firstFrame) T.firstFrame = performance.now();
  if (!T.firstBones && S.groups.size) T.firstBones = performance.now();
}

window.addEventListener('pagehide', () => {
  running = false; cancelAnimationFrame(raf);
  try {
    for (const g of S.groups.values()) g.geo.dispose();
    if (S.mats) for (const k of ['bone', 'depth', 'ghost', 'pick']) S.mats[k].dispose();
    if (S.state) S.state.dispose();
    for (const c of trays.children) { c.geometry.dispose(); c.material.dispose(); }
    floor.geometry.dispose(); floor.material.dispose(); pool.geometry.dispose(); pool.material.dispose(); poolTex.dispose();
    pickRT.dispose(); envRT.dispose(); key.shadow.map && key.shadow.map.dispose();
    controls.dispose(); renderer.dispose();
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
  } catch (e) { /* the page is going */ }
});

// debug and headless checks
window.__hs = {
  S, T, select, clearSelection, isolate, exitIsolate, setMode, explode, reconstruct, setAmount, toggleRegionExplode, focusRegion, focusBone,
  setTheme, setShow, setRegionHidden, pickAt, step, camera, controls, setOpen, fitView,
  screenOf(id) {
    const b = typeof id === 'number' ? S.bones[id] : S.P.byId.get(id);
    const p = boneCentre(b.i).project(camera);
    const cr = canvas.getBoundingClientRect();
    return { x: cr.left + (p.x + 1) / 2 * cr.width, y: cr.top + (1 - p.y) / 2 * cr.height, i: b.i };
  },
  busy: () => !!(S.tr || S.fly || S.springing.size || S.bones.some(b => S.loaded[b.i] && S.appear[b.i] < 1)),
};

// ── boot ────────────────────────────────────────────────────────────────────
buildUI();
setTheme(S.theme);
requestAnimationFrame(frame);
loadAll().catch(e => { console.error(e); $('loadingText').textContent = 'The skeleton failed to load'; toast(String(e.message || e)); });
