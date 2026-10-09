/*
Copyright 2022 Matthias Müller - Ten Minute Physics

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
// ============================================================================
//  SPATIAL HASHING  ·  pages/spatial-hashing/sim.js — balls and the hash
// ----------------------------------------------------------------------------
//  UPSTREAM. Ten Minute Physics #11, 11-hashing.html by Matthias Müller
//  (MIT, notice above). The Hash class and the vector helpers below are
//  the upstream code, unchanged (only the export is ours). stepBalls()
//  is the upstream Balls.simulate loop: integrate, build the hash, then
//  for each ball the world walls and the hashed neighbour contacts
//  (separate the pair, swap the normal velocities).
//
//  OUR ADDITIONS (davesgames.io, not upstream): restitution, a gravity
//  vector, a box of any size, a kinematic stirrer sphere the pointer
//  drags through the balls, pair and contact counters (to compare the
//  hash with all pairs), a probe ball whose query is shown, start shapes
//  (gas, burst, twin, rain, slosh, vortex, layers) and the seeded scene
//  builder.
//
//  grep -n targets: "export class Hash", "export function stepBalls",
//  "export function buildScene", "export function queryProbe"
// ============================================================================

export class Hash {
    constructor(spacing, maxNumObjects) 
    {
        this.spacing = spacing;
        this.tableSize = 2 * maxNumObjects;
        this.cellStart = new Int32Array(this.tableSize + 1);
        this.cellEntries = new Int32Array(maxNumObjects);
        this.queryIds = new Int32Array(maxNumObjects);
        this.querySize = 0;
    }

    hashCoords(xi, yi, zi) {
        var h = (xi * 92837111) ^ (yi * 689287499) ^ (zi * 283923481);    // fantasy function
        return Math.abs(h) % this.tableSize; 
    }

    intCoord(coord) {
        return Math.floor(coord / this.spacing);
    }

    hashPos(pos, nr) {
        return this.hashCoords(
            this.intCoord(pos[3 * nr]), 
            this.intCoord(pos[3 * nr + 1]),
            this.intCoord(pos[3 * nr + 2]));
    }

    create(pos) {
        var numObjects = Math.min(pos.length / 3, this.cellEntries.length);

        // determine cell sizes

        this.cellStart.fill(0);
        this.cellEntries.fill(0);

        for (var i = 0; i < numObjects; i++) {
            var h = this.hashPos(pos, i);
            this.cellStart[h]++;
        }

        // determine cells starts

        var start = 0;
        for (var i = 0; i < this.tableSize; i++) {
            start += this.cellStart[i];
            this.cellStart[i] = start;
        }
        this.cellStart[this.tableSize] = start;    // guard

        // fill in objects ids

        for (var i = 0; i < numObjects; i++) {
            var h = this.hashPos(pos, i);
            this.cellStart[h]--;
            this.cellEntries[this.cellStart[h]] = i;
        }
    }

    query(pos, nr, maxDist) {
        var x0 = this.intCoord(pos[3 * nr] - maxDist);
        var y0 = this.intCoord(pos[3 * nr + 1] - maxDist);
        var z0 = this.intCoord(pos[3 * nr + 2] - maxDist);

        var x1 = this.intCoord(pos[3 * nr] + maxDist);
        var y1 = this.intCoord(pos[3 * nr + 1] + maxDist);
        var z1 = this.intCoord(pos[3 * nr + 2] + maxDist);

        this.querySize = 0;

        for (var xi = x0; xi <= x1; xi++) {
            for (var yi = y0; yi <= y1; yi++) {
                for (var zi = z0; zi <= z1; zi++) {
                    var h = this.hashCoords(xi, yi, zi);
                    var start = this.cellStart[h];
                    var end = this.cellStart[h + 1];

                    for (var i = start; i < end; i++) {
                        this.queryIds[this.querySize] = this.cellEntries[i];
                        this.querySize++;
                    }
                }
            }
        }
    }
}

// ----- math on vector arrays (upstream) --------------------------------------------
function vecScale(a,anr, scale) {
    anr *= 3;
    a[anr++] *= scale;
    a[anr++] *= scale;
    a[anr]   *= scale;
}

function vecCopy(a,anr, b,bnr) {
    anr *= 3; bnr *= 3;
    a[anr++] = b[bnr++]; 
    a[anr++] = b[bnr++]; 
    a[anr]   = b[bnr];
}

function vecAdd(a,anr, b,bnr, scale = 1.0) {
    anr *= 3; bnr *= 3;
    a[anr++] += b[bnr++] * scale; 
    a[anr++] += b[bnr++] * scale; 
    a[anr]   += b[bnr] * scale;
}

function vecSetDiff(dst,dnr, a,anr, b,bnr, scale = 1.0) {
    dnr *= 3; anr *= 3; bnr *= 3;
    dst[dnr++] = (a[anr++] - b[bnr++]) * scale;
    dst[dnr++] = (a[anr++] - b[bnr++]) * scale;
    dst[dnr]   = (a[anr] - b[bnr]) * scale;
}

function vecLengthSquared(a,anr) {
    anr *= 3;
    let a0 = a[anr], a1 = a[anr + 1], a2 = a[anr + 2];
    return a0 * a0 + a1 * a1 + a2 * a2;
}

function vecDistSquared(a,anr, b,bnr) {
    anr *= 3; bnr *= 3;
    let a0 = a[anr] - b[bnr], a1 = a[anr + 1] - b[bnr + 1], a2 = a[anr + 2] - b[bnr + 2];
    return a0 * a0 + a1 * a1 + a2 * a2;
}    

function vecDot(a,anr, b,bnr) {
    anr *= 3; bnr *= 3;
    return a[anr] * b[bnr] + a[anr + 1] * b[bnr + 1] + a[anr + 2] * b[bnr + 2];
}

// ---- our sim ----------------------------------------------------------------------

export const START = ['gas', 'burst', 'twin', 'rain', 'slosh', 'vortex', 'layers'];

export function createSim() {
  const S = {
    P: { g: 0, tiltX: 0, tiltZ: 0, e: 1, eWall: 1, w: 2, h: 2, d: 2, stir: true, stirR: 0.18 },
    n: 0, radius: 0.025, pos: null, vel: null, hit: null, origin: null, hash: null, normal: new Float32Array(3),
    bounds: [-1, 0, -1, 1, 2, 1],
    stirrer: { on: false, x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, r: 0.18, held: false, auto: false, t: 0 },
    probe: -1, probeIds: null, probeN: 0, probeHits: 0,
    stats: { pairs: 0, contacts: 0, walls: 0, ms: 0 }, t: 0, frame: 0,
  };
  S.step = dt => stepBalls(S, dt);
  return S;
}

export function gravityVec(P) {
  const ax = P.tiltX * Math.PI / 180, az = P.tiltZ * Math.PI / 180;
  return [P.g * Math.sin(az), -P.g * Math.cos(az) * Math.cos(ax), -P.g * Math.sin(ax)];
}

// The upstream loop (integrate, hash, walls, neighbour contacts) with
// restitution e (e = 1 is the upstream velocity swap) and the stirrer.
export function stepBalls(S, dt) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const P = S.P, n = S.n, r = S.radius, minDist = 2 * r, pos = S.pos, vel = S.vel, b = S.bounds, nrm = S.normal;
  const g = gravityVec(P);
  // the stirrer moves on its own path when it is not held
  const st = S.stirrer;
  if (st.on && st.auto && !st.held) {
    st.t += dt;
    const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2, ax = 0.32 * (b[3] - b[0]), az = 0.32 * (b[5] - b[2]);
    const x = cx + ax * Math.sin(0.9 * st.t), z = cz + az * Math.sin(1.3 * st.t + 1), y = b[1] + (b[4] - b[1]) * (0.35 + 0.15 * Math.sin(0.7 * st.t));
    st.vx = (x - st.x) / dt; st.vy = (y - st.y) / dt; st.vz = (z - st.z) / dt; st.x = x; st.y = y; st.z = z;
  }
  for (let i = 0; i < n; i++) {
    vecAdd(vel, i, g, 0, dt);
    vecAdd(pos, i, vel, i, dt);
  }
  S.hash.create(pos);
  let pairs = 0, contacts = 0, walls = 0;
  const hit = S.hit;
  for (let i = 0; i < n; i++) {
    hit[i] *= 0.85;
    // world collision
    for (let dim = 0; dim < 3; dim++) {
      const k = 3 * i + dim;
      if (pos[k] < b[dim] + r) { pos[k] = b[dim] + r; vel[k] = -vel[k] * P.eWall; hit[i] = 1; walls++; }
      else if (pos[k] > b[dim + 3] - r) { pos[k] = b[dim + 3] - r; vel[k] = -vel[k] * P.eWall; hit[i] = 1; walls++; }
    }
    // the stirrer: a moving sphere; the ball takes its velocity on contact
    if (st.on) {
      const dx = pos[3 * i] - st.x, dy = pos[3 * i + 1] - st.y, dz = pos[3 * i + 2] - st.z, rr = st.r + r, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < rr * rr && d2 > 0) {
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d;
        pos[3 * i] = st.x + nx * rr; pos[3 * i + 1] = st.y + ny * rr; pos[3 * i + 2] = st.z + nz * rr;
        const vn = (vel[3 * i] - st.vx) * nx + (vel[3 * i + 1] - st.vy) * ny + (vel[3 * i + 2] - st.vz) * nz;
        if (vn < 0) { const k = (1 + P.e) * vn; vel[3 * i] -= k * nx; vel[3 * i + 1] -= k * ny; vel[3 * i + 2] -= k * nz; }
        hit[i] = 1;
      }
    }
    // interball collision through the hash
    S.hash.query(pos, i, minDist);
    pairs += S.hash.querySize;
    for (let q = 0; q < S.hash.querySize; q++) {
      const j = S.hash.queryIds[q];
      vecSetDiff(nrm, 0, pos, i, pos, j);
      const d2 = vecLengthSquared(nrm, 0);
      if (d2 > 0 && d2 < minDist * minDist) {
        const d = Math.sqrt(d2);
        vecScale(nrm, 0, 1 / d);
        const corr = (minDist - d) * 0.5;
        vecAdd(pos, i, nrm, 0, corr);
        vecAdd(pos, j, nrm, 0, -corr);
        const vi = vecDot(vel, i, nrm, 0), vj = vecDot(vel, j, nrm, 0);
        // e = 1: the upstream swap of the normal velocities
        const ci = 0.5 * ((1 + P.e) * vj + (1 - P.e) * vi) - vi, cj = 0.5 * ((1 + P.e) * vi + (1 - P.e) * vj) - vj;
        vecAdd(vel, i, nrm, 0, ci);
        vecAdd(vel, j, nrm, 0, cj);
        hit[i] = 1; hit[j] = 1; contacts++;
      }
    }
  }
  // a contact push late in the loop can cross a wall: clamp into the box
  // (our addition; upstream leaves it to the next step)
  for (let i = 0; i < n; i++) for (let dim = 0; dim < 3; dim++) {
    const k = 3 * i + dim;
    if (pos[k] < b[dim] + r) pos[k] = b[dim] + r; else if (pos[k] > b[dim + 3] - r) pos[k] = b[dim + 3] - r;
  }
  S.stats.pairs = pairs; S.stats.contacts = contacts; S.stats.walls = walls;
  S.stats.ms = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  if (S.probe >= 0 && S.probe < n) queryProbe(S);
  S.t += dt; S.frame++;
}

// The probe ball: the ids its hash query returns, and how many touch it.
export function queryProbe(S) {
  const i = S.probe, r = S.radius;
  S.hash.query(S.pos, i, 2 * r);
  const m = S.hash.querySize;
  if (!S.probeIds || S.probeIds.length < S.n) S.probeIds = new Int32Array(S.n);
  S.probeIds.set(S.hash.queryIds.subarray(0, m));
  S.probeN = m;
  let h = 0;
  for (let k = 0; k < m; k++) { const j = S.probeIds[k]; if (j !== i && vecDistSquared(S.pos, i, S.pos, j) < 4.4 * r * r) h++; }
  S.probeHits = h;
}

// The hash bucket of ball i (for the "hash cell" colour mode).
export const bucketOf = (S, i) => S.hash.hashPos(S.pos, i);

// ---- scenes -------------------------------------------------------------------------
// cfg: { start, radius, count, speed, w, h, d }. The count is a target; the
// balls sit on a grid with a gap of 3 r (as upstream) inside the start shape.
export function buildScene(S, cfg, rnd) {
  const r = cfg.radius, w = cfg.w, h = cfg.h, d = cfg.d;
  S.radius = r; S.bounds = [-w / 2, 0, -d / 2, w / 2, h, d / 2];
  const sp = 3 * r, v = cfg.speed;
  const pts = [], vels = [], orig = [];
  const b = S.bounds;
  const grid = (x0, y0, z0, x1, y1, z1, max) => {
    const out = [];
    for (let x = x0 + sp; x <= x1 - sp + 1e-9; x += sp) for (let y = y0 + sp; y <= y1 - sp + 1e-9; y += sp) for (let z = z0 + sp; z <= z1 - sp + 1e-9; z += sp) out.push([x, y, z]);
    // keep at most max, spread evenly
    if (out.length <= max) return out;
    const k = out.length / max, sel = [];
    for (let i = 0; i < max; i++) sel.push(out[Math.floor(i * k)]);
    return sel;
  };
  const rv = () => v * (2 * rnd() - 1);
  const N = Math.max(8, cfg.count | 0);
  switch (cfg.start) {
    case 'burst': {
      const n = Math.max(2, Math.round(Math.cbrt(N))), s2 = 2.15 * r, hh = 0.5 * (n - 1) * s2, cy = h / 2;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
        const x = -hh + i * s2, y = cy - hh + j * s2, z = -hh + k * s2, L = Math.hypot(x, y - cy, z) || 1;
        pts.push([x, y, z]); vels.push([x / L * v * 2 + 0.1 * rv(), (y - cy) / L * v * 2 + 0.1 * rv(), z / L * v * 2 + 0.1 * rv()]); orig.push(x < 0 ? 0 : 1);
      }
      break;
    }
    case 'twin': {
      const half = grid(b[0], b[1], b[2], b[3], b[4], b[5], N).filter(p => Math.abs(p[0]) > w * 0.12);
      for (const p of half) { const s = p[0] < 0 ? 1 : -1; pts.push(p); vels.push([s * v * 1.5 + 0.2 * rv(), 0.2 * rv(), 0.2 * rv()]); orig.push(p[0] < 0 ? 0 : 1); }
      break;
    }
    case 'rain': {
      for (const p of grid(b[0], b[1] + h * 0.4, b[2], b[3], b[4], b[5], N)) { pts.push(p); vels.push([0.2 * rv(), -0.3 * Math.abs(rv()), 0.2 * rv()]); orig.push(p[1] > h * 0.7 ? 0 : 1); }
      break;
    }
    case 'slosh': {
      for (const p of grid(b[0], b[1], b[2], b[0] + w * 0.45, b[4] * 0.8, b[5], N)) { pts.push(p); vels.push([0.3 * rv(), 0, 0.3 * rv()]); orig.push(p[2] < 0 ? 0 : 1); }
      break;
    }
    case 'vortex': {
      for (const p of grid(b[0], b[1], b[2], b[3], b[4], b[5], N)) { const R = Math.hypot(p[0], p[2]) || 1; pts.push(p); vels.push([-p[2] / R * v * 1.5, 0.2 * rv(), p[0] / R * v * 1.5]); orig.push(p[1] > h / 2 ? 0 : 1); }
      break;
    }
    case 'layers': {
      for (const p of grid(b[0], b[1], b[2], b[3], b[4], b[5], N)) { pts.push(p); vels.push([rv(), rv(), rv()]); orig.push(p[1] > h / 2 ? 0 : 1); }
      break;
    }
    case 'gas': default: {
      for (const p of grid(b[0], b[1], b[2], b[3], b[4], b[5], N)) { pts.push(p); vels.push([rv(), rv(), rv()]); orig.push(p[0] < 0 ? 0 : 1); }
    }
  }
  const n = pts.length;
  S.n = n; S.pos = new Float32Array(3 * n); S.vel = new Float32Array(3 * n); S.hit = new Float32Array(n); S.origin = new Uint8Array(n);
  for (let i = 0; i < n; i++) { S.pos.set(pts[i], 3 * i); S.vel.set(vels[i], 3 * i); S.origin[i] = orig[i]; }
  S.hash = new Hash(2 * r, n);
  S.probe = n ? Math.floor(rnd() * n) : -1; S.probeN = 0; S.probeHits = 0;
  const st = S.stirrer; st.x = 0; st.y = h * 0.5; st.z = 0; st.vx = st.vy = st.vz = 0; st.t = 0; st.held = false;
  S.t = 0; S.frame = 0;
  return S;
}

// Kinetic energy (per unit mass): the upstream gas keeps it with e = 1.
export function energy(S) {
  let E = 0;
  for (let i = 0; i < 3 * S.n; i++) E += 0.5 * S.vel[i] * S.vel[i];
  return E;
}
