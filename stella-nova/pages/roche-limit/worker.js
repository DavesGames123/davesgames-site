// ============================================================================
//  ROCHE LIMIT  ·  worker.js — bound mass and energy, off the main thread
// ----------------------------------------------------------------------------
//  type 'cloud': physics.js makeCloud (a loose random cloud of N grains; it
//  takes a second or more at 24k grains, so not on the main thread).
//  type 'analyze': main.js posts one readback of a satellite (engine.js readback: the body
//  rows, 12 floats each, the potential, the frame point X, V, the ledger
//  totals). The worker returns:
//    tags     Float32Array, 1 bound, 0 shed (render colour, ring splat)
//    M, com, vcm, rH, groups    physics.js analyzeBound
//    E, K, Us, Up, L            physics.js energyOf, in the planet frame
//  A module worker: physics.js is the same module the page and tests use.
//
//  grep -n targets: "onmessage"
// ============================================================================
import { analyzeBound, energyOf, makeCloud } from './physics.js';

self.onmessage = e => {
  const q = e.data;
  if (q.type === 'cloud') {
    const c = makeCloud(q.N, q.seed);
    self.postMessage({ id: q.id, pos: c.pos, rad: c.rad, mass: c.mass }, [c.pos.buffer, c.rad.buffer, c.mass.buffer]);
    return;
  }
  const { N, body, grav, rad, X, V, GMp } = q;
  const pos = new Float64Array(N * 3), vel = new Float64Array(N * 3), spin = new Float64Array(N * 3);
  const mass = new Float64Array(N), phi = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 3; k++) { pos[3 * i + k] = body[12 * i + k]; vel[3 * i + k] = body[12 * i + 4 + k]; spin[3 * i + k] = body[12 * i + 8 + k]; }
    mass[i] = body[12 * i + 7]; phi[i] = grav[8 * i + 3];
  }
  const an = analyzeBound(pos, vel, mass, rad, 3, X, GMp, N);
  const en = energyOf(pos, vel, spin, rad, mass, phi, X, V, GMp);
  const tags = new Float32Array(q.np);
  for (let i = 0; i < N; i++) tags[i] = mass[i] === 0 ? -1 : an.mask[i];
  // a sample of shed grains for the fragment conics: state in the planet frame
  const frag = [];
  const want = q.fragCount || 0;
  if (want) {
    const step = Math.max(1, Math.floor(N / (want * 4)));
    for (let i = (q.seed || 0) % step; i < N && frag.length < want * 6; i += step) {
      if (!mass[i] || an.mask[i]) continue;
      frag.push(X[0] + pos[3 * i], X[1] + pos[3 * i + 1], X[2] + pos[3 * i + 2], V[0] + vel[3 * i], V[1] + vel[3 * i + 1], V[2] + vel[3 * i + 2]);
    }
  }
  let accreted = 0; for (let i = 0; i < N; i++) if (!mass[i]) accreted++;
  // centre of all grains left (the camera follows it once the moon is gone)
  let Ma = 0; const ca = [0, 0, 0], va = [0, 0, 0];
  for (let i = 0; i < N; i++) { const m = mass[i]; if (!m) continue; Ma += m; for (let k = 0; k < 3; k++) { ca[k] += m * pos[3 * i + k]; va[k] += m * vel[3 * i + k]; } }
  if (Ma > 0) for (let k = 0; k < 3; k++) { ca[k] /= Ma; va[k] /= Ma; }
  let s2 = 0; for (let i = 0; i < N; i++) { const m = mass[i]; if (!m) continue; s2 += m * ((pos[3 * i] - ca[0]) ** 2 + (pos[3 * i + 1] - ca[1]) ** 2 + (pos[3 * i + 2] - ca[2]) ** 2); }
  const spread = Ma > 0 ? Math.sqrt(s2 / Ma) : 0;
  self.postMessage({ id: q.id, tags, M: an.M, com: an.com, vcm: an.vcm, rH: an.rH, groups: an.groups, largest: an.largest,
    E: en.E, K: en.K + en.Kr, Us: en.Us, Up: en.Up, L: en.L, frag: new Float64Array(frag), accreted, comAll: ca, vcmAll: va, spread, t: q.t, X, V }, [tags.buffer]);
};
