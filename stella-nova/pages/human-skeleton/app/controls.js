// ============================================================================
//  HUMAN SKELETON  ·  app/controls.js — theme, toggles, readout, keys
// ────────────────────────────────────────────────────────────────────────────
//  setTheme sets the colours of the uniforms, floor, pool and trays, and
//  keeps the choice in localStorage. setShow sets the teeth, cartilage and
//  spin toggles. syncUI writes the state of S into the mode buttons, the
//  amount slider, the dock and the list groups. syncRead writes the bone
//  count line. buildUI connects the panel controls, the dock and the keys.
//
//  GREP MAP
//    function setTheme                               dark or light
//    function setShow                                teeth, cartilage, spin
//    function syncRead / syncUI                      state to DOM
//    function buildUI                                listeners and keys
// ============================================================================
import { $, COARSE, esc, MODE_NAME, THEMES } from './env.js';
import { renderer, floor, pool, trays, U, controls } from './stage.js';
import { S, dirty } from './state.js';
import { fitView } from './camera.js';
import { ensureCartilage } from './load.js';
import { refreshVisibility } from './visibility.js';
import { exploded, retarget, setMode, explode, reconstruct, setAmount } from './layouts.js';
import { clearSelection, step } from './select.js';
import { isolate, exitIsolate, focusBone, focusRegion } from './inspect.js';
import { list } from './list.js';

export function setTheme(t) {
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
export function buildUI() {
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
