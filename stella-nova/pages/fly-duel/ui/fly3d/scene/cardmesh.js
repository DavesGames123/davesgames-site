// ============================================================================
//  FLY DUEL 3D  ·  card mesh and ring mesh  (ES module, three.js r160)
// ----------------------------------------------------------------------------
//  Split out of ui/fly3d/scene.js. The outline of the elytron plate card,
//  the chamfered card geometry (front, back and edge groups) and the
//  outline ring for the attack, block and target marks.
//
//  GREP MAP   (grep -n targets)
//      grep -n 'function cardOutline'          the card shape
//      grep -n 'export function cardGeometry'  chamfered card mesh
//      grep -n 'export function ringGeometry'  outline ring outside the card
// ============================================================================
import * as THREE from 'three';
import { TABLE as T } from './table.js';

// The card shape: the elytron plate of ui/cardface.js. The top corners
// are cut at 45 degrees (chamfer = 7 % of the width), the bottom corners
// are round (radius = 5 % of the width). Counter-clockwise points.
export function cardOutline(W, H, arcSeg = 4) {
  const c = 0.07 * W, r = 0.05 * W, x0 = -W / 2, x1 = W / 2, y0 = -H / 2, y1 = H / 2;
  const pts = [];
  const arc = (cx, cy, a0, a1) => { for (let i = 0; i <= arcSeg; i++) { const a = a0 + (a1 - a0) * i / arcSeg; pts.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a))); } };
  arc(x1 - r, y0 + r, -Math.PI / 2, 0);
  pts.push(new THREE.Vector2(x1, y1 - c), new THREE.Vector2(x1 - c, y1), new THREE.Vector2(x0 + c, y1), new THREE.Vector2(x0, y1 - c));
  arc(x0 + r, y0 + r, Math.PI, Math.PI * 1.5);
  return pts;
}

// ----------------------------------------------------------- card mesh
// One BufferGeometry: front cap (group 0), back cap (group 1), edge
// (group 2). The back UVs are mirrored so the back reads the right way.
export function cardGeometry(W = T.cardW, H = T.cardH, D = T.cardT) {
  const pts = cardOutline(W, H);
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const pos = [], nor = [], uv = [], idx = [];
  const n = pts.length;
  const x0 = -W / 2, y0 = -H / 2;
  // front
  for (const p of pts) { pos.push(p.x, p.y, D / 2); nor.push(0, 0, 1); uv.push((p.x - x0) / W, (p.y - y0) / H); }
  for (const t of tris) idx.push(t[0], t[1], t[2]);
  const nf = idx.length;
  // back
  for (const p of pts) { pos.push(p.x, p.y, -D / 2); nor.push(0, 0, -1); uv.push(1 - (p.x - x0) / W, (p.y - y0) / H); }
  for (const t of tris) idx.push(n + t[0], n + t[2], n + t[1]);
  const nb = idx.length - nf;
  // edge
  const base = 2 * n;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, nx = dy / l, ny = -dx / l;
    const k = base + i * 4;
    pos.push(a.x, a.y, D / 2, b.x, b.y, D / 2, b.x, b.y, -D / 2, a.x, a.y, -D / 2);
    for (let j = 0; j < 4; j++) { nor.push(nx, ny, 0); uv.push(0, 0); }
    idx.push(k, k + 3, k + 1, k + 1, k + 3, k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.addGroup(0, nf, 0); g.addGroup(nf, nb, 1); g.addGroup(nf + nb, idx.length - nf - nb, 2);
  return g;
}

// An outline ring just outside the card (attack, block, target marks).
export function ringGeometry(W = T.cardW, H = T.cardH, w = 0.035) {
  const outer = cardOutline(W + 2 * w, H + 2 * w), inner = cardOutline(W, H);
  const s = new THREE.Shape(outer);
  s.holes.push(new THREE.Path(inner.slice().reverse()));
  return new THREE.ShapeGeometry(s);
}
