// ============================================================================
//  CORAL REEF  ·  mesh worker (module worker)
// ----------------------------------------------------------------------------
//  Runs coral-sdf.js (lib/dla-sdf.js under it) off the main thread, so the
//  growth and the render stay smooth while the coral surfaces are meshed.
//
//  Messages in (from main.js):
//    { type: 'reset', polyps }                 all colonies gone
//    { type: 'colony', k, id, normal, stalk }  a new colony
//    { type: 'add', data: Float32Array }       particles, 7 floats each:
//                                              k, local id, parent, x, y, z (local frame), gid
//    { type: 'budget', ms }                    mesh time per tick (default 10)
//    { type: 'rock', id, rock, cell }          mesh one rock SDF (terrain.js meshRock)
//  Messages out:
//    { type: 'bricks', gen, list: [{ k, key, chunk, positions, normals, gids, indices, polyps }] }
//      (the typed arrays are transferred)
//    { type: 'idle', gen }                     no dirty bricks left
//    { type: 'rock', id, positions, normals, indices }
//  gen counts the resets, so the page drops results of an old reef.
//
//  grep -n targets
//    the tick ............ "function tick"
// ============================================================================
import { createCoralMesher } from './coral-sdf.js';
import { meshRock } from './terrain.js';

let M = createCoralMesher();
let gen = 0, budget = 10, timer = 0, idleSent = false;

function tick() {
  timer = 0;
  const out = M.update(budget);
  if (out.length) {
    const tr = [];
    for (const r of out) tr.push(r.positions.buffer, r.normals.buffer, r.gids.buffer, r.indices.buffer, r.polyps.buffer);
    postMessage({ type: 'bricks', gen, list: out }, tr);
    idleSent = false;
  }
  if (M.dirty()) schedule();
  else if (!idleSent) { idleSent = true; postMessage({ type: 'idle', gen }); }
}
function schedule() { if (!timer) timer = setTimeout(tick, 4); }

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'reset') { M = createCoralMesher({ polyps: m.polyps ?? 1 }); gen++; idleSent = false; return; }
  if (m.type === 'colony') { M.addColony(m); return; }
  if (m.type === 'budget') { budget = m.ms; return; }
  if (m.type === 'rock') {
    const r = meshRock(m.rock, m.cell || 0.4);
    postMessage({ type: 'rock', id: m.id, positions: r.positions, normals: r.normals, indices: r.indices }, [r.positions.buffer, r.normals.buffer, r.indices.buffer]);
    return;
  }
  if (m.type === 'add') {
    const d = m.data;
    for (let i = 0; i < d.length; i += 7) M.add(d[i], d[i + 1], d[i + 2], d[i + 3], d[i + 4], d[i + 5], d[i + 6]);
    schedule();
  }
};
