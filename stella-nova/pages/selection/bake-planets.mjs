// ============================================================================
//  SELECTION  ·  bake-planets.mjs — planet textures from Planet Forge
// ----------------------------------------------------------------------------
//  Run once from this folder:  node bake-planets.mjs   (needs cwebp)
//  For each preset in BAKE, the site's own Planet Forge (pages/forge
//  maps.js generate) builds the maps at W x W/2. This script then writes:
//    planets/<id>.webp     albedo with the cloud deck mixed in (sRGB)
//    planets/<id>-n.webp   R G = tangent normal x y (OpenGL, +Y north),
//                          B = sea glint mask (height under the sea
//                          level); clouds flatten both.
//                          Gas giants get no normal file.
//  The forge output is our own procedural art, so no licence applies.
//  main.js keeps the list, the atmosphere colours and the tilts in
//  "const PLANETS". Add a new id there after a bake.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generate } from '../forge/maps.js';
import { fromPreset } from '../forge/presets.js';
import { encodePNG } from '../forge/png.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'planets');
const W = 1024;
// Forge preset ids, each with its default seed. Gas giants are left out:
// their look comes from the forge flow shader, not from the albedo map.
const BAKE = ['earth', 'rust', 'ice', 'moon'];

fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sel-bake-'));
for (const id of BAKE) {
  const b = { id };
  const t0 = Date.now();
  const P = fromPreset(b.id);
  const M = generate(P, W);
  const n = M.W * M.H, cr = M.cloudRGB || [255, 255, 255], gas = P.kind === 'gas';
  const alb = new Uint8Array(n * 3), nrm = new Uint8Array(n * 3);
  // Sea mask for the sun glint: height under the sea level. Frozen seas
  // glint less.
  const seaK = typeof M.sea === 'number' ? (id === 'ice' ? 0.35 : 1) : 0;
  for (let i = 0; i < n; i++) {
    // Gas giants keep flow data in the cloud channels, not a cloud deck.
    const cov = gas ? 0 : Math.min(1, (M.cloud[i * 4] / 255) * 0.9);
    for (let c = 0; c < 3; c++) alb[i * 3 + c] = Math.round(M.albedo[i * 4 + c] * (1 - cov) + cr[c] * cov);
    nrm[i * 3] = Math.round(127.5 + (M.normal[i * 4] - 127.5) * (1 - cov));
    nrm[i * 3 + 1] = Math.round(127.5 + (M.normal[i * 4 + 1] - 127.5) * (1 - cov));
    nrm[i * 3 + 2] = seaK && M.height[i] < M.sea ? Math.round(255 * seaK * (1 - cov)) : 0;
  }
  const write = async (name, data, q) => {
    const png = path.join(tmp, name + '.png');
    fs.writeFileSync(png, await encodePNG({ width: M.W, height: M.H, channels: 3, depth: 8, data }));
    execFileSync('cwebp', ['-quiet', '-q', String(q), png, '-o', path.join(OUT, name + '.webp')]);
  };
  await write(b.id, alb, 84);
  if (!gas) await write(b.id + '-n', nrm, 90);
  console.log(b.id, M.W + 'x' + M.H, (Date.now() - t0) + ' ms');
}
fs.rmSync(tmp, { recursive: true, force: true });
