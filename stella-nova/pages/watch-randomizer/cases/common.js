// ============================================================================
//  TIMEPIECE RANDOMIZER  ·  cases/common.js — shapes every case builder uses
// ────────────────────────────────────────────────────────────────────────────
//  lathe() turns a closed (r, z) profile about z; cap() makes a domed
//  crystal; bezelOutline() a smooth, coin-edge or fluted rim; DIAL_R the
//  default dial radius of each calibre (a calibre may set cal.dialR).
// ============================================================================
import * as THREE from 'three';
import * as G from '../../watch-movement/geom.js';
import { circ } from '../../watch-movement/kit.js';
const { TAU } = G;

export const DIAL_R = { lever: 18.6, tourbillon: 18.6, automatic: 12.9, verge: 18.9 };
export const dialRadius = cal => cal.dialR ?? DIAL_R[cal.id] ?? cal.plateR + 0.3;

// a lathe solid round z from a closed (r, z) profile
export function lathe(B, prof, mat, seg = 128) {
  const g = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), seg);
  g.rotateX(Math.PI / 2);
  return B.mesh(g, mat);
}
// a spherical cap (domed crystal) of base radius r and height h, bulging to -z from z0
export function cap(B, r, h, z0, mat) {
  const rho = (r * r + h * h) / (2 * h), th = Math.asin(Math.min(1, r / rho));
  const g = new THREE.SphereGeometry(rho, 64, 12, 0, TAU, 0, th);
  g.rotateX(-Math.PI / 2); g.translate(0, 0, z0 - h + rho);
  return B.mesh(g, mat);
}
// a bezel outline: smooth, coin edge or fluted
export function bezelOutline(style, R) {
  if (style === 'coin') { const n = Math.round(R * 11); return G.gearProfile(n, 2 * R / n, { t: 0.5, ha: 0.3, hf: 0.3, seg: 2 }); }
  if (style === 'fluted') { const n = Math.round(R * 3.2); return G.gearProfile(n, 2 * R / n, { t: 0.62, ha: 0.28, hf: 0.32, seg: 4 }); }
  return circ(R, 160);
}

