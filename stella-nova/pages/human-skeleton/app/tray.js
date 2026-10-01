// ============================================================================
//  HUMAN SKELETON  ·  app/tray.js — the catalogue trays and their labels
// ────────────────────────────────────────────────────────────────────────────
//  In catalogue mode the bones lie on trays (layout.js gives the places).
//  buildTrays makes one box and one edge outline per tray. placeLabels puts
//  an HTML label under each bone that is large enough on screen, with no
//  overlap, and a title on each tray. The labels wait until the move ends.
//
//  GREP MAP
//    function setTraysOn / buildTrays                the tray meshes
//    let labelEls / trayEls                          label elements (lazy)
//    function shortName                              short label text
//    function placeLabels / labelScale               label placement
// ============================================================================
import * as THREE from 'three';
import { $, THEMES } from './env.js';
import { canvas, camera, trays } from './stage.js';
import { S } from './state.js';

export function setTraysOn(on) {
  S.traysOn = on;
  S.labelsOn = on;
  if (!on) { $('labels').innerHTML = ''; labelEls = null; }
}
export function buildTrays(cat) {
  for (const c of [...trays.children]) { c.geometry.dispose(); c.material.dispose(); trays.remove(c); }
  const th = THEMES[S.theme];
  for (const t of cat.trays) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(t.w, 0.006, t.d), new THREE.MeshStandardMaterial({ color: th.tray, roughness: 0.95, metalness: 0, transparent: true, opacity: 0 }));
    m.position.set(t.x, 0.003, t.z);
    m.receiveShadow = true;
    m.userData.tray = t;
    trays.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(t.w, 0.006, t.d)), new THREE.LineBasicMaterial({ color: th.trayLine, transparent: true, opacity: 0 }));
    e.position.copy(m.position);
    trays.add(e);
  }
  labelEls = null;
}
let labelEls = null, trayEls = null;
function shortName(b) {
  let s = b.name;
  s = s.replace(/^Cervical vertebra |^Thoracic vertebra |^Lumbar vertebra /, '');
  s = s.replace(/^Proximal phalanx, /, 'Prox. ').replace(/^Middle phalanx, /, 'Mid. ').replace(/^Distal phalanx, /, 'Dist. ');
  s = s.replace(/ finger$/, '').replace(/ toe$/, ' toe').replace('Inferior nasal concha', 'Inf. concha');
  return s;
}
export function placeLabels() {
  const box = $('labels');
  if (!S.labelsOn || !S.cat || (S.tr && S.tr.t < S.tr.end * 0.85)) { if (box.childElementCount) box.style.opacity = '0'; return; }
  box.style.opacity = '1';
  if (!labelEls) {
    box.innerHTML = '';
    labelEls = new Map();
    for (const b of S.bones) {
      const el = document.createElement('div'); el.className = 'bl'; el.textContent = shortName(b);
      box.appendChild(el); labelEls.set(b.i, el);
    }
    trayEls = S.cat.trays.map(t => { const el = document.createElement('div'); el.className = 'tl'; el.textContent = t.label; box.appendChild(el); return el; });
  }
  const w = canvas.clientWidth, h = canvas.clientHeight, v = new THREE.Vector3();
  const taken = [];
  const free = (x0, y0, x1, y1) => !taken.some(r => x0 < r[2] && r[0] < x1 && y0 < r[3] && r[1] < y1);
  const order = S.bones.filter(b => S.vis[b.i]).sort((a, c) => (c.i === S.sel) - (a.i === S.sel) || c.len - a.len);
  for (const b of S.bones) if (!S.vis[b.i]) labelEls.get(b.i).style.display = 'none';
  for (const b of order) {
    const el = labelEls.get(b.i);
    v.set(S.cat.label[b.i * 3], S.cat.label[b.i * 3 + 1], S.cat.label[b.i * 3 + 2]).project(camera);
    const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h;
    const tw = el.textContent.length * 5.4 + 4, th = 13;
    // too small on screen: the bone is narrower than a third of its label
    const ok = v.z < 1 && x > 0 && x < w && y > 0 && y < h && free(x - tw / 2, y, x + tw / 2, y + th);
    // the label lives in the gap under its bone (pad + label band in
    // layout.js): when the gap is shorter than the text, it waits for zoom
    const ls = labelScale(b), gapPx = (ls / Math.max(1e-4, b.lay.ext[0])) * 0.058;
    const big = (ls > tw * 0.33 && gapPx >= 11) || b.i === S.sel;
    if (ok && big) {
      taken.push([x - tw / 2, y, x + tw / 2, y + th]);
      el.style.display = '';
      el.style.transform = `translate(${(x - tw / 2).toFixed(1)}px,${y.toFixed(1)}px)`;
      el.classList.toggle('sel', b.i === S.sel);
    } else el.style.display = 'none';
  }
  S.cat.trays.forEach((t, k) => {
    v.set(t.lx, 0.006, t.lz).project(camera);
    const el = trayEls[k];
    if (!el) return;
    const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h;
    _la.set(t.x - t.w / 2, 0.006, t.lz).project(camera); _lb.set(t.x + t.w / 2, 0.006, t.lz).project(camera);
    el.style.maxWidth = `${Math.max(0, Math.abs(_lb.x - _la.x) / 2 * w - 8).toFixed(0)}px`;
    el.style.transform = `translate(${x.toFixed(1)}px,${(y - 14).toFixed(1)}px)`;
  });
}
// width of the bone on screen, in CSS pixels
const _la = new THREE.Vector3(), _lb = new THREE.Vector3();
function labelScale(b) {
  const cx = S.cat.label[b.i * 3], cz = S.cat.label[b.i * 3 + 2];
  _la.set(cx - b.lay.ext[0] / 2, 0.01, cz).project(camera);
  _lb.set(cx + b.lay.ext[0] / 2, 0.01, cz).project(camera);
  return Math.abs(_lb.x - _la.x) / 2 * canvas.clientWidth;
}
