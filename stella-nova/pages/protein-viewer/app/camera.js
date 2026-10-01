// ============================================================================
//  PROTEIN VIEWER  ·  app/camera.js — framing, fly-to and the clear area
// ────────────────────────────────────────────────────────────────────────────
//  occlusion() measures the panel, the strip and (on a phone) the card.
//  resize() sets camera.setViewOffset so that the view centres in the clear
//  area. loop.js eases occ toward occlusion() and moves S.fly.
//
//  GREP MAP
//    const occ / function occlusion / clearRect   the clear area
//    function fitDist / resize                   fit a radius, size the view
//    function flyTo / resetView / focusResidues / focusSelection   moves
//    function ensureVisible                      pan to a hidden pick
// ============================================================================
import * as THREE from 'three';
import { $, DPR, PHONE_Q, REDUCED } from './env.js';
import { S, anchorAtom, atomPos, dirty } from './state.js';
import { camera, canvas, controls, post, renderer } from './stage.js';
import { hideHint } from './feedback.js';
import { card } from './card.js';
import { panel } from './panel.js';

controls.addEventListener('change', dirty);
controls.addEventListener('start', () => { S.fly = null; hideHint(); });

// ── camera ────────────────────────────────────────────────────────────────
export const occ = { l: 0, r: 0, t: 0, b: 0 };
export function occlusion() {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  const cr = canvas.getBoundingClientRect(), w = cr.width, h = cr.height;
  const consider = el => {
    if (!el || el.hidden) return;
    const q = el.getBoundingClientRect();
    const x0 = Math.max(cr.left, q.left), x1 = Math.min(cr.right, q.right), y0 = Math.max(cr.top, q.top), y1 = Math.min(cr.bottom, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) return;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) { if (y0 + y1 > cr.top * 2 + h) o.b = Math.max(o.b, cr.bottom - y0); else o.t = Math.max(o.t, y1 - cr.top); }
    else { if (x0 + x1 < cr.left * 2 + w) o.l = Math.max(o.l, x1 - cr.left); else o.r = Math.max(o.r, cr.right - x0); }
  };
  if (panel.classList.contains('open')) consider(panel);
  consider($('seqWrap'));
  if (PHONE_Q.matches) consider(card);
  return o;
}
function clearRect() {
  const w = canvas.clientWidth, h = canvas.clientHeight, o = occlusion();
  return { x0: o.l, x1: w - o.r, y0: o.t, y1: h - o.b, w, h, o };
}
function fitDist(radius) {
  const c = clearRect();
  const frac = Math.max(0.25, Math.min((c.x1 - c.x0) / c.h, (c.y1 - c.y0) / c.h));
  return (radius / (Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * frac)) * 1.04;
}
export function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return false;
  const dpr = DPR();
  if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
  const sz = renderer.getSize(new THREE.Vector2());
  if (sz.x !== w || sz.y !== h) renderer.setSize(w, h, false);
  post.setSize(w, h, dpr);
  camera.aspect = w / h;
  camera.setViewOffset(w, h, (occ.l - occ.r) / -2, (occ.t - occ.b) / -2, w, h);
  camera.updateProjectionMatrix();
  return true;
}
function flyTo(target, dist, dur = 0.9) {
  S.fly = { t: 0, dur: REDUCED ? 0.01 : dur, t0: controls.target.clone(), t1: target.clone(), d0: camera.position.distanceTo(controls.target), d1: dist };
  dirty();
}
export function resetView(instant) {
  S.fly = null;
  const d = fitDist(S.bound.r);
  controls.target.copy(S.bound.c);
  camera.up.set(0, 1, 0);
  camera.position.set(S.bound.c.x, S.bound.c.y, S.bound.c.z + d);
  camera.lookAt(controls.target);
  controls.maxDistance = Math.max(80, S.bound.r * 10);
  controls.minDistance = 2;
  if (!instant) { const t = S.bound.c.clone(); camera.position.z += d * 0.25; flyTo(t, d, 0.6); }
  controls.update();
  dirty();
}
export function focusResidues(list, pad = 8) {
  const s = S.s, c = new THREE.Vector3();
  let n = 0;
  for (const ri of list) for (const i of s.residues[ri].atoms) { c.add(atomPos(i)); n++; }
  if (!n) return;
  c.multiplyScalar(1 / n);
  let r = 0;
  for (const ri of list) for (const i of s.residues[ri].atoms) r = Math.max(r, atomPos(i).distanceTo(c));
  flyTo(c, fitDist(Math.min(r + pad, S.bound.r)));
}
export function focusSelection() {
  if (!S.sel) { resetView(false); return; }
  focusResidues([S.sel.res, ...[...S.hood.keys()].slice(0, 30)], 3);
}
// pan to a picked residue that sits under the card, the strip or the panel
export function ensureVisible(ri) {
  const s = S.s;
  if (!s || !S.sel) return;
  const p = atomPos(anchorAtom(s.residues[ri])).project(camera);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const x = (p.x + 1) / 2 * w, y = (1 - p.y) / 2 * h;
  const cr = canvas.getBoundingClientRect();
  const blocked = [card, $('seqWrap'), panel.classList.contains('open') ? panel : null].some(el => {
    if (!el || el.hidden) return false;
    const q = el.getBoundingClientRect();
    return x + cr.left > q.left - 16 && x + cr.left < q.right + 16 && y + cr.top > q.top - 16 && y + cr.top < q.bottom + 16;
  });
  if (blocked || x < 8 || x > w - 8 || y < 8 || y > h - 8) flyTo(atomPos(anchorAtom(s.residues[ri])), camera.position.distanceTo(controls.target), 0.7);
}
