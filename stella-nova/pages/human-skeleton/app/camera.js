// ============================================================================
//  HUMAN SKELETON  ·  app/camera.js — framing, fit, fly-to, shadow frustum
// ────────────────────────────────────────────────────────────────────────────
//  The panel and the card can cover part of the canvas. occlusion() measures
//  that part, and the loop eases occ toward it. resize() then moves the view
//  offset, so the specimen stays in the centre of the clear part. fitView
//  and fitDist size the camera distance to that clear part.
//
//  GREP MAP
//    const occ / function occlusion / clearRect      the clear part
//    function fitDist / fitBox / fitView             camera distance
//    function resize                                 canvas size, view offset
//    function flyTo                                  start a camera flight
//    function fitShadow                              key light frustum
//    function ensureVisible                          pan to a covered bone
// ============================================================================
import * as THREE from 'three';
import * as L from '../layout.js';
import { REDUCED, DPR } from './env.js';
import { canvas, renderer, camera, key, pool, controls } from './stage.js';
import { S, dirty } from './state.js';
import { boneCentre } from './select.js';
import { card } from './card.js';
import { setHover } from './pointer.js';
import { panel } from './panel.js';

export const occ = { l: 0, r: 0, t: 0, b: 0 };
export function occlusion() {
  const o = { l: 0, r: 0, t: 0, b: 0 };
  const cr = canvas.getBoundingClientRect(), w = cr.width, h = cr.height;
  const consider = el => {
    if (!el || el.hidden) return;
    const q = el.getBoundingClientRect();
    if (getComputedStyle(el).display === 'none') return;
    const x0 = Math.max(cr.left, q.left), x1 = Math.min(cr.right, q.right), y0 = Math.max(cr.top, q.top), y1 = Math.min(cr.bottom, q.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) return;
    const fw = (x1 - x0) / w, fh = (y1 - y0) / h;
    if (fw >= fh) { if (y0 + y1 > cr.top * 2 + h) o.b = Math.max(o.b, cr.bottom - y0); else o.t = Math.max(o.t, y1 - cr.top); }
    else { if (x0 + x1 < cr.left * 2 + w) o.l = Math.max(o.l, x1 - cr.left); else o.r = Math.max(o.r, cr.right - x0); }
  };
  if (panel.classList.contains('open')) consider(panel);
  consider(card);
  return o;
}
export function clearRect() {
  const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1, o = occlusion();
  return { x0: o.l, x1: w - o.r, y0: o.t, y1: h - o.b, w, h, o };
}
export function fitDist(radius) {
  const c = clearRect();
  const fy = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const frac = Math.max(0.2, Math.min((c.x1 - c.x0) / c.h, (c.y1 - c.y0) / c.h));
  return (radius / (fy * frac)) * 1.06;
}
export function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return false;
  const dpr = DPR();
  if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
  const sz = renderer.getSize(new THREE.Vector2());
  if (sz.x !== w || sz.y !== h) renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.setViewOffset(w, h, (occ.l - occ.r) / -2, (occ.t - occ.b) / -2, w, h);
  camera.updateProjectionMatrix();
  return true;
}
export function flyTo(tgt, dist, dur = 0.9, dir = null) {
  if (S.hov >= 0) setHover(-1);
  const d0 = camera.position.clone().sub(controls.target);
  S.fly = { t: 0, dur: REDUCED ? 0.01 : dur, t0: controls.target.clone(), t1: tgt.clone(), r0: d0.length(), r1: dist, u0: d0.normalize(), u1: dir ? dir.clone().normalize() : null };
  dirty();
}
const FRONT = new THREE.Vector3(0.32, 0.1, 1).normalize();
const ABOVE = new THREE.Vector3(0, 1.25, 0.95).normalize();
// distance that fits a box seen along `dir` into the clear part of the view
function fitBox(lo, hi, dir) {
  const c = clearRect();
  const fy = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const right = new THREE.Vector3(0, 1, 0).cross(dir).normalize(), up = dir.clone().cross(right).normalize();
  const mid = new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
  let hw = 0, hh = 0, hd = 0;
  const p = new THREE.Vector3();
  for (let k = 0; k < 8; k++) {
    p.set(k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]).sub(mid);
    hw = Math.max(hw, Math.abs(p.dot(right))); hh = Math.max(hh, Math.abs(p.dot(up))); hd = Math.max(hd, p.dot(dir));
  }
  const fh = Math.max(0.15, (c.y1 - c.y0) / c.h), fw = Math.max(0.15, (c.x1 - c.x0) / c.h);
  return { c: mid, d: Math.max(hh / (fy * fh), hw / (fy * fw)) * 1.07 + hd };
}
export function fitView(instant, off = S.to ? S.to.off : null) {
  if (!S.P) return;
  const vis = S.vis.some(Boolean) ? S.vis : new Uint8Array(S.n).fill(1);
  const cat = S.mode === 'catalogue';
  const bd = L.bounds(S.P, off || new Float32Array(S.n * 3), vis, null, !cat);
  const dir = cat ? ABOVE : FRONT;
  const fb = fitBox(bd.lo, bd.hi, dir);
  const c = fb.c, d = fb.d;
  if (instant) {
    controls.target.copy(c);
    camera.position.copy(c).addScaledVector(dir, d);
    camera.lookAt(c); controls.update(); S.fly = null;
  } else flyTo(c, d, 1.0, dir);
  pool.scale.setScalar(Math.max(2.2, bd.r * 3.2));
  pool.position.x = c.x; pool.position.z = c.z;
  dirty();
}
export function fitShadow() {
  const vis = S.vis.some(Boolean) ? S.vis : new Uint8Array(S.n).fill(1);
  const a = L.bounds(S.P, S.to.off, vis), b = L.bounds(S.P, S.cur.off, vis);
  const c = new THREE.Vector3((a.c[0] + b.c[0]) / 2, (a.c[1] + b.c[1]) / 2, (a.c[2] + b.c[2]) / 2);
  const r = Math.max(a.r, b.r) + new THREE.Vector3(...a.c).distanceTo(new THREE.Vector3(...b.c)) / 2 + 0.05;
  key.target.position.copy(c);
  key.position.copy(c).add(new THREE.Vector3(-0.42, 0.85, 0.5).normalize().multiplyScalar(r * 3));
  const sc = key.shadow.camera;
  sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = r * 0.5; sc.far = r * 5.5;
  sc.updateProjectionMatrix();
  key.updateMatrixWorld(); key.target.updateMatrixWorld();
}
export function ensureVisible(i) {
  const p = boneCentre(i).project(camera);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const x = (p.x + 1) / 2 * w, y = (1 - p.y) / 2 * h;
  const cr = canvas.getBoundingClientRect();
  const blocked = [card, panel.classList.contains('open') ? panel : null].some(el => {
    if (!el || el.hidden) return false;
    const q = el.getBoundingClientRect();
    return x + cr.left > q.left - 12 && x + cr.left < q.right + 12 && y + cr.top > q.top - 12 && y + cr.top < q.bottom + 12;
  });
  if (blocked || x < 8 || x > w - 8 || y < 8 || y > h - 8) flyTo(boneCentre(i), camera.position.distanceTo(controls.target), 0.7);
}
