// ============================================================================
//  PROTEIN VIEWER  ·  app/pick.js — ray picking and the 5 Å neighbourhood
// ────────────────────────────────────────────────────────────────────────────
//  pickAt() casts a ray against spheres round the pickable atoms, with a
//  slack of 5 px (mouse) or 18 px (touch). neighbours() reads the grid
//  in file coordinates and sorts the residues by distance.
//
//  GREP MAP
//    function pickAt                       screen point to atom index, or -1
//    function neighbours                   residue index to Map(residue, Å)
// ============================================================================
import * as THREE from 'three';
import { COARSE } from './env.js';
import { S } from './state.js';
import { camera, canvas } from './stage.js';

// ── picking ───────────────────────────────────────────────────────────────
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
export function pickAt(cx, cy, slackPx = COARSE ? 18 : 5) {
  if (!S.s) return -1;
  const rect = canvas.getBoundingClientRect();
  ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction, w = S.wpos;
  const perPx = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / camera.zoom / rect.height;
  let best = -1, bestT = Infinity, near = -1, nearPx = Infinity;
  for (const set of [...S.pickOver, ...S.pick]) {
    const { idx, rad } = set;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const vx = w[3 * i] - o.x, vy = w[3 * i + 1] - o.y, vz = w[3 * i + 2] - o.z;
      const t = vx * d.x + vy * d.y + vz * d.z;
      if (t <= 0) continue;
      const p2 = vx * vx + vy * vy + vz * vz - t * t, r = rad[k];
      if (p2 < r * r) {
        const tt = t - Math.sqrt(r * r - p2);
        if (tt < bestT) { bestT = tt; best = i; }
      } else if (best < 0) {
        const px = (Math.sqrt(p2) - r) / (perPx * t);
        if (px < slackPx && px < nearPx) { nearPx = px; near = i; }
      }
    }
  }
  return best >= 0 ? best : near;
}

export function neighbours(ri, cut = 5) {
  const s = S.s, out = new Map();
  for (const i of s.residues[ri].atoms) {
    if (s.atoms[i].el === 'H') continue;
    S.grid.near(s.pos[3 * i], s.pos[3 * i + 1], s.pos[3 * i + 2], cut, (j, d2) => {
      const rj = s.atoms[j].res;
      if (rj === ri) return;
      const r = s.residues[rj];
      if (!S.chainOn[r.chain]) return;
      if (r.kind === 'water' && !S.show.waters) return;
      const d = Math.sqrt(d2);
      if (!out.has(rj) || out.get(rj) > d) out.set(rj, d);
    });
  }
  return new Map([...out.entries()].sort((a, b) => a[1] - b[1]));
}
