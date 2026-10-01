// ============================================================================
//  MATERIAL STUDIO  ·  viewport/test-maps.js — synthetic material maps
// ────────────────────────────────────────────────────────────────────────────
//  Makes a full set of synthetic maps on the GPU: checker base color, studs
//  in height with a normal map made from that height, metal studs, emissive
//  stripes, clearcoat, sheen, anisotropy and an opacity corner. The HUD
//  "Test maps" button and the viewport selfTest use these maps.
//
//  GREP TARGETS
//      makeTestMaps ........... the six map textures, res and scalars
//      studH .................. the stud and groove height field
// ============================================================================
import * as C from '../contract.js';
import { clamp, norm3 } from './state.js';
import { mapTexture, writeHalf } from './textures.js';

/**
 * Synthetic maps for tests and for a quick look before the bake works:
 * a checker base color, studs with bevels in height, a +Y normal map made
 * from that height, metal studs, emissive stripes, clearcoat on the left half,
 * sheen on the bottom quarter, anisotropy on the studs, an opacity corner.
 */
export function makeTestMaps(res = 512) {
  const H = new Float32Array(res * res);
  const studH = (u, v) => {
    const cx = (u * 4) % 1 - 0.5, cy = (v * 4) % 1 - 0.5;
    const d = Math.hypot(cx, cy);
    const stud = 1 - smooth(0.24, 0.33, d);
    const groove = Math.exp(-Math.pow(((u + v) * 6) % 1 - 0.5, 2) / 0.002) * 0.12;
    return { h: 0.5 + 0.32 * stud - groove * (1 - stud), stud, cx, cy };
  };
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) H[y * res + x] = studH((x + 0.5) / res, (y + 0.5) / res).h;
  const h = (x, y) => H[((y + res) % res) * res + ((x + res) % res)];
  const tex = {};
  for (const k of C.MAP_NAMES) tex[k] = mapTexture('vp-test-' + k, res);
  writeHalf(tex.height, res, (u, v, px, x, y) => { const s = h(x, y); px[0] = px[1] = px[2] = s; px[3] = 1; });
  const k = res / 24;
  writeHalf(tex.normal, res, (u, v, px, x, y) => {
    const du = (h(x + 1, y) - h(x - 1, y)) * 0.5, dv = (h(x, y + 1) - h(x, y - 1)) * 0.5;
    // OpenGL +Y: green follows image-up, which is -v
    const n = norm3([-du * k, dv * k, 1]);
    px[0] = n[0] * 0.5 + 0.5; px[1] = n[1] * 0.5 + 0.5; px[2] = n[2] * 0.5 + 0.5; px[3] = 1;
  });
  writeHalf(tex.albedo, res, (u, v, px) => {
    const s = studH(u, v);
    const ch = ((Math.floor(u * 8) + Math.floor(v * 8)) & 1) === 1;
    const c = s.stud > 0.5 ? [0.95, 0.72, 0.32] : ch ? [0.62, 0.18, 0.06] : [0.32, 0.36, 0.42];
    px[0] = c[0]; px[1] = c[1]; px[2] = c[2];
    px[3] = (u > 0.75 && v < 0.25) ? 0.25 + 0.75 * ((v * 4) % 1) : 1;
  });
  writeHalf(tex.orm, res, (u, v, px, x, y) => {
    const s = studH(u, v);
    const lap = (h(x + 2, y) + h(x - 2, y) + h(x, y + 2) + h(x, y - 2)) * 0.25 - h(x, y);
    px[0] = clamp(1 - Math.max(0, lap) * 18, 0.2, 1);
    px[1] = s.stud > 0.5 ? 0.22 : (((Math.floor(u * 8) + Math.floor(v * 8)) & 1) ? 0.45 : 0.75);
    px[2] = s.stud > 0.5 ? 1 : 0;
    px[3] = 1;
  });
  writeHalf(tex.emissive, res, (u, v, px) => {
    const band = Math.abs(((v * 8) % 1) - 0.5) < 0.02 && u < 0.25 ? 1 : 0;
    px[0] = 0.2 * band; px[1] = 1.4 * band; px[2] = 2.0 * band; px[3] = 1;
  });
  writeHalf(tex.extra, res, (u, v, px) => {
    const s = studH(u, v);
    px[0] = u < 0.5 ? 1 : 0; px[1] = 0.06; px[2] = v > 0.75 ? 0.8 : 0; px[3] = s.stud > 0.5 ? 0.7 : 0;
  });
  return { ...tex, res, scalars: { ...C.DEFAULT_SCALARS, displacementScale: 0.04 } };
  function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
}
