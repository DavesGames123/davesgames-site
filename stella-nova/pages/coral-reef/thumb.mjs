// ============================================================================
//  CORAL REEF  ·  a node render of a grown reef (thumbnails, checks)
// ----------------------------------------------------------------------------
//    node thumb.mjs out.png [preset] [seed] [w] [h] [view]
//  view: 'reef' (default, the page camera), 'close' (one colony), 'top'.
//  It grows a preset with reef.js (the same hooks as the page), meshes each
//  colony with coral-sdf.js (lib/dla-sdf.js), the real seabed and the
//  rocks with terrain.js, places the scanned models with assets.js, and
//  draws it all with raster.js (a software rasteriser: shapes, natural
//  colours, a sun, fog; not the page shaders). No browser.
//  The home thumbnail size is 640 x 400.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { growPreset } from './reef.js';
import { naturalRGB } from './colour.js';
import { createCoralMesher } from './coral-sdf.js';
import { groundGrid, meshRock } from './terrain.js';
import { DECOR, parseCRM, scatterDecor } from './assets.js';
import { createRaster, loadZlib } from './raster.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function renderReef({ preset = 'mixed', seed = 3, w = 640, h = 400, view = 'reef', capTotal = 12000, polyps = true } = {}) {
  await loadZlib();
  const reef = growPreset(preset, seed, { capTotal });
  const nat = naturalRGB(reef);
  const R = createRaster(w, h, { fogDen: 0.0032, bg: [0.03, 0.16, 0.22], fog: [0.05, 0.25, 0.32] });
  // camera
  const big = reef.colonies.slice().sort((a, b) => b.count - a.count)[0];
  if (view === 'close' && big) {
    const u = big.user, s = Math.max(u.top, u.ext) + 6;
    R.camera([u.bx + s * 1.25, u.by + s * 0.75, u.bz + s * 1.35], [u.bx, u.by + u.top * 0.4, u.bz], 40);
  } else if (view === 'top') R.camera([0.1, 190, 40], [0, 0, 0], 40);
  else R.camera([95, 62, 112], [0, 8, 0], 40);
  // seabed
  const g = groundGrid(170, 420, 1.9);
  const gc = new Float32Array(g.mask.length * 3);
  for (let i = 0; i < g.mask.length; i++) { const m = g.mask[i]; gc[i * 3] = 0.78 - 0.3 * m; gc[i * 3 + 1] = 0.72 - 0.26 * m; gc[i * 3 + 2] = 0.56 - 0.2 * m; }
  R.mesh({ ...g, colors: gc });
  for (const rk of reef.rocks) R.mesh({ ...meshRock(rk, 0.45), color: [0.5, 0.45, 0.37] });
  // scanned models
  const keep = (x, z, r) => !reef.rocks.some(q => Math.hypot(q.x - x, q.z - z) < Math.max(q.rx, q.rz) + r + 1.5) && !reef.colonies.some(c => Math.hypot(c.user.bx - x, c.user.bz - z) < 16 + r);
  const places = scatterDecor(seed, keep, 1);
  for (const d of DECOR) {
    const f = path.join(HERE, 'assets/models', d.id + '.bin');
    if (!fs.existsSync(f)) continue;
    const b = fs.readFileSync(f), mod = parseCRM(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
    for (const p of places[d.id] || []) {
      const c = Math.cos(p.ry), s = Math.sin(p.ry), P = new Float32Array(mod.positions.length), N = new Float32Array(mod.normals.length);
      for (let v = 0; v < P.length; v += 3) {
        const x = mod.positions[v], y = mod.positions[v + 1], z = mod.positions[v + 2];
        P[v] = p.x + (x * c + z * s) * p.s; P[v + 1] = p.y + y * p.s; P[v + 2] = p.z + (-x * s + z * c) * p.s;
        const nx = mod.normals[v], nz = mod.normals[v + 2];
        N[v] = nx * c + nz * s; N[v + 1] = mod.normals[v + 1]; N[v + 2] = -nx * s + nz * c;
      }
      R.mesh({ positions: P, normals: N, indices: mod.indices, color: d.kind === 'shell' ? [0.85, 0.62, 0.45] : [0.52, 0.48, 0.4] });
    }
  }
  // corals
  const M = createCoralMesher({ polyps: polyps ? 0.6 : 0 });
  let tris = 0, npol = 0;
  for (const c of reef.colonies) {
    const u = c.user;
    M.addColony({ k: c.k, id: c.id, normal: u.normal, stalk: c.sp.stalk });
    for (let i = 0; i < c.count; i++) M.add(c.k, i, c.model.parent[i], c.model.pos[i * 3], c.model.pos[i * 3 + 1], c.model.pos[i * 3 + 2], c.ids[i]);
    for (const m of M.meshColony(c.k)) {
      const P = new Float32Array(m.positions.length), K = new Float32Array(m.positions.length);
      for (let v = 0; v < P.length; v += 3) {
        P[v] = m.positions[v] + u.bx; P[v + 1] = m.positions[v + 1] + u.by; P[v + 2] = m.positions[v + 2] + u.bz;
        const gid = Math.max(0, m.gids[v / 3]);
        K[v] = nat[gid * 3]; K[v + 1] = nat[gid * 3 + 1]; K[v + 2] = nat[gid * 3 + 2];
      }
      R.mesh({ positions: P, normals: m.normals, indices: m.indices, colors: K });
      tris += m.indices.length / 3;
      const pts = [];
      for (let q = 0; q < m.polyps.length; q += 8) {
        const gid = m.polyps[q + 6];
        pts.push([m.polyps[q] + u.bx + m.polyps[q + 3] * 0.07, m.polyps[q + 1] + u.by + m.polyps[q + 4] * 0.07, m.polyps[q + 2] + u.bz + m.polyps[q + 5] * 0.07, 0.09,
          Math.min(1, nat[gid * 3] * 1.25 + 0.15), Math.min(1, nat[gid * 3 + 1] * 1.25 + 0.15), Math.min(1, nat[gid * 3 + 2] * 1.25 + 0.15)]);
      }
      npol += pts.length;
      R.points(pts);
    }
  }
  return { png: R.png(), reef, tris, polyps: npol };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [out = 'coral-reef.png', preset = 'mixed', seed = '3', w = '640', h = '400', view = 'reef'] = process.argv.slice(2);
  const t0 = performance.now();
  const r = await renderReef({ preset, seed: +seed, w: +w, h: +h, view });
  fs.writeFileSync(out, r.png);
  console.log(`${out}: ${preset} seed ${seed}, ${r.reef.count} particles, ${r.reef.colonies.length} colonies, ${r.tris} coral triangles, ${r.polyps} polyps, ${(performance.now() - t0).toFixed(0)} ms`);
}
