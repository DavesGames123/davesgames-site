// ============================================================================
//  COLLAPSE CITY  ·  mock-world.js — a stand-in for the Rust World
// ----------------------------------------------------------------------------
//  This module has the same API as pkg/wfc_city.js (CONTRACT.md, "wasm
//  API"). main.js uses it only when pkg/ is missing, and the page then
//  shows the "mock world" badge. It is NOT a wave function collapse solver.
//  A seeded hash sets a fixed city (streets, blocks of boxes of several
//  heights, parks, water, ramps). update() then "collapses" the slots of
//  that city in a ragged nearest-first order, so the renderer gets real
//  birth values to animate.
//
//  Units and layout are the contract units: cell 2 m, chunk 8 x 8 cells,
//  height H cells, y up. Vertex = 8 floats (32 bytes):
//    [px, py, pz, nx, ny, nz, colour_index, birth]
//
//  GREP MAP
//    const PAL ................ the mock palette (sRGB, made linear)
//    function columnOf ........ the fixed city: kind and height of a column
//    function cellKind ........ the kind of one cell (i, j, k)
//    class World .............. the API object
//    update( .................. nearest-first collapse with jitter
//    chunk_mesh( .............. the mesher (faces, windows, parapets, ramps)
//    move_body( ............... heightfield body with step-up
//    export default ........... init(): no work, for the same call shape
// ============================================================================

const CELL = 2, CHUNK = 8;
const BLOCK = 7;                 // street every 7 cells on x and z
// kinds of a cell
const AIR = 0, PAVE = 1, GRASS = 2, WATER = 3, WALL = 4, RAMP = 5;
const PROTOS = ['air', 'paving', 'grass', 'water channel', 'wall', 'wall with windows', 'door', 'roof', 'roof garden', 'ramp'];
const MODULES = 31;

// Palette: sRGB 0..255, sent as linear 0..1 by palette().
//   0 paving   1 kerb    2 grass   3 water   4 plaster  5 brick
//   6 ochre    7 glass   8 roof    9 slate  10 wood    11 metal
//  12 garden  13 stone  14 rail   15 awning
const PAL = [
  [168, 158, 142], [120, 116, 110], [96, 140, 70], [52, 104, 130],
  [226, 212, 186], [178, 92, 66], [214, 160, 82], [40, 58, 78],
  [150, 70, 52], [84, 92, 104], [120, 80, 50], [130, 138, 146],
  [80, 128, 60], [190, 182, 168], [236, 232, 222], [40, 120, 120],
];
const toLin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

// 32-bit integer hash of up to four values and the seed
function hash(a, b, c, d) {
  let h = (a | 0) * 0x27d4eb2d ^ (b | 0) * 0x165667b1 ^ (c | 0) * 0x9e3779b1 ^ (d | 0) * 0x85ebca77;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}
const h01 = (a, b, c, d) => hash(a, b, c, d) / 4294967296;
const fdiv = (a, b) => Math.floor(a / b);
const mod = (a, b) => ((a % b) + b) % b;

// Smooth value noise on a coarse grid: the taller districts.
function vnoise(x, z, seed) {
  const x0 = Math.floor(x), z0 = Math.floor(z), fx = x - x0, fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const v = (i, k) => h01(i, k, seed, 77);
  const a = v(x0, z0) + (v(x0 + 1, z0) - v(x0, z0)) * sx;
  const b = v(x0, z0 + 1) + (v(x0 + 1, z0 + 1) - v(x0, z0 + 1)) * sx;
  return a + (b - a) * sz;
}

export class World {
  constructor(seed = 1, height = 12) {
    this.seed = seed >>> 0;
    this.H = Math.max(3, height | 0);
    this.cols = new Map();       // "cx,cz" -> { birth: Float64Array(64*H) | -1 = open, n }
    this.dirty = new Set();
    this.count = 0;
    this.colCache = new Map();   // column key -> { kind, h, wallC, roofC, ramp }
    this.offsets = null; this.offR = -1;
    this.lastMs = 0;
  }

  // ---- the fixed city ----------------------------------------------------------
  // A column (i, k): kind PAVE (street), GRASS (park), WATER or WALL (a
  // building of h layers). Blocks split into four lots on a seeded line.
  columnOf(i, k) {
    const key = i + ',' + k;
    let c = this.colCache.get(key);
    if (c) return c;
    if (this.colCache.size > 400000) this.colCache.clear();
    const s = this.seed, bi = fdiv(i, BLOCK), bk = fdiv(k, BLOCK), li = mod(i, BLOCK), lk = mod(k, BLOCK);
    if (li === 0 || lk === 0) {
      // street; a water channel runs down some streets on z
      const water = li === 0 && lk !== 0 && h01(bi, 0, s, 5) < 0.18 && mod(k, 3) !== 0;
      c = { kind: water ? WATER : PAVE, h: 0 };
    } else {
      const sx = 2 + Math.floor(h01(bi, bk, s, 1) * 3), sz = 2 + Math.floor(h01(bi, bk, s, 2) * 3);
      const lot = (li <= sx ? 0 : 1) + (lk <= sz ? 0 : 2);
      const r = h01(bi * 4 + lot, bk, s, 3);
      const district = vnoise(bi / 3.3, bk / 3.3, s);
      if (r < 0.1) c = { kind: GRASS, h: 0 };
      else if (r < 0.13) c = { kind: WATER, h: 0 };
      else {
        const top = this.H - 2;
        let h = 1 + Math.floor(Math.pow(h01(bi * 4 + lot, bk, s, 4), 1.6) * (2 + district * district * top));
        h = Math.min(top, Math.max(1, h));
        const pal = [4, 5, 6, 13, 4, 6];
        c = {
          kind: WALL, h,
          wallC: pal[hash(bi * 4 + lot, bk, s, 6) % pal.length],
          roofC: h01(bi * 4 + lot, bk, s, 7) < 0.25 ? 12 : (h01(bi * 4 + lot, bk, s, 8) < 0.5 ? 8 : 9),
        };
      }
    }
    // A ramp on top of this column climbs to a neighbour one layer higher.
    c.ramp = -1;
    if (c.kind !== WATER && c.h < this.H - 2) {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const pick = hash(i, k, s, 9);
      if (pick % 9 === 0) {
        for (let n = 0; n < 4; n++) {
          const d = (n + (pick >>> 8)) % 4;
          const o = this.peekHeight(i + dirs[d][0], k + dirs[d][1]);
          if (o === c.h + 1) { c.ramp = d; break; }
        }
      }
    }
    this.colCache.set(key, c);
    return c;
  }

  // height of a column without the ramp step (no recursion into ramps)
  peekHeight(i, k) {
    const s = this.seed, bi = fdiv(i, BLOCK), bk = fdiv(k, BLOCK), li = mod(i, BLOCK), lk = mod(k, BLOCK);
    if (li === 0 || lk === 0) return (li === 0 && lk !== 0 && h01(bi, 0, s, 5) < 0.18 && mod(k, 3) !== 0) ? -1 : 0;
    const key = i + ',' + k, c = this.colCache.get(key);
    if (c) return c.kind === WALL ? c.h : (c.kind === WATER ? -1 : 0);
    const sx = 2 + Math.floor(h01(bi, bk, s, 1) * 3), sz = 2 + Math.floor(h01(bi, bk, s, 2) * 3);
    const lot = (li <= sx ? 0 : 1) + (lk <= sz ? 0 : 2);
    const r = h01(bi * 4 + lot, bk, s, 3);
    if (r < 0.1) return 0;
    if (r < 0.13) return -1;
    const district = vnoise(bi / 3.3, bk / 3.3, s), top = this.H - 2;
    let h = 1 + Math.floor(Math.pow(h01(bi * 4 + lot, bk, s, 4), 1.6) * (2 + district * district * top));
    return Math.min(top, Math.max(1, h));
  }

  cellKind(i, j, k) {
    if (j < 0) return WALL;
    if (j >= this.H) return AIR;
    const c = this.columnOf(i, k);
    if (c.kind === WALL) {
      if (j < c.h) return WALL;
      if (j === c.h && c.ramp >= 0) return RAMP;
      return AIR;
    }
    if (j === 0) return c.ramp >= 0 ? RAMP : c.kind;
    return AIR;
  }

  // ---- slots ---------------------------------------------------------------------
  chunk(cx, cz, make) {
    const key = cx + ',' + cz;
    let ch = this.cols.get(key);
    if (!ch && make) {
      ch = { cx, cz, birth: new Float64Array(CHUNK * CHUNK * this.H).fill(-1), done: new Uint8Array(CHUNK * CHUNK), n: 0 };
      this.cols.set(key, ch);
    }
    return ch;
  }
  birthOf(i, j, k) {
    const ch = this.cols.get(fdiv(i, CHUNK) + ',' + fdiv(k, CHUNK));
    if (!ch || j < 0 || j >= this.H) return -1;
    return ch.birth[(mod(i, CHUNK) + mod(k, CHUNK) * CHUNK) * this.H + j];
  }

  ring(radius) {
    if (this.offR === radius) return this.offsets;
    const out = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d = Math.hypot(dx, dz);
        if (d <= radius) out.push([dx, dz, d]);
      }
    }
    out.sort((a, b) => a[2] - b[2]);
    this.offsets = out; this.offR = radius;
    return out;
  }

  update(px, py, pz, radius, budget) {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    radius = Math.max(1, Math.min(160, radius | 0));
    budget = Math.max(0, budget | 0);
    const fi = Math.floor(px / CELL), fk = Math.floor(pz / CELL), H = this.H;
    const ring = this.ring(radius);
    let done = 0;
    // The front is ragged: a column with a small hash jitter (0..3 cells)
    // goes before a column with a large one at the same distance. Each pass
    // takes the columns with d + jitter <= front + 3, where front is the
    // distance of the nearest open column.
    for (let pass = 0; pass < 4 && done < budget; pass++) {
      let front = -1;
      for (let n = 0; n < ring.length; n++) {
        const [dx, dz, d] = ring[n];
        if (front >= 0 && d > front + 3) break;
        const i = fi + dx, k = fk + dz;
        const ch = this.chunk(fdiv(i, CHUNK), fdiv(k, CHUNK), true);
        const ci = mod(i, CHUNK) + mod(k, CHUNK) * CHUNK;
        if (ch.done[ci] === 2) continue;
        if (front < 0) front = d;
        const jit = h01(i, k, this.seed, 11) * 3;
        if (d + jit > front + 3 || d + jit > radius + 1) continue;
        // collapse the column bottom-up, one slot at a time
        const base = ci * H;
        for (let j = 0; j < H && done < budget; j++) {
          if (ch.birth[base + j] >= 0) continue;
          ch.birth[base + j] = ++this.count;
          done++;
        }
        let all = true;
        for (let j = 0; j < H; j++) if (ch.birth[base + j] < 0) { all = false; break; }
        ch.done[ci] = all ? 2 : 1;
        if (all) ch.n++;
        this.dirty.add(ch.cx + ',' + ch.cz);
        const li = mod(i, CHUNK), lk = mod(k, CHUNK);
        if (li === 0) this.dirty.add((ch.cx - 1) + ',' + ch.cz);
        if (li === CHUNK - 1) this.dirty.add((ch.cx + 1) + ',' + ch.cz);
        if (lk === 0) this.dirty.add(ch.cx + ',' + (ch.cz - 1));
        if (lk === CHUNK - 1) this.dirty.add(ch.cx + ',' + (ch.cz + 1));
        if (done >= budget) break;
      }
      if (front < 0) break;
    }
    this.lastMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    return done;
  }

  dirty_chunks() {
    const out = [];
    for (const key of this.dirty) {
      if (!this.cols.has(key)) continue;
      const [a, b] = key.split(',');
      out.push(+a, +b);
    }
    this.dirty.clear();
    return Int32Array.from(out);
  }

  forget_far(px, pz, keep) {
    const out = [], lim = (keep * CELL + CHUNK * CELL * 0.75);
    for (const [key, ch] of this.cols) {
      const x = (ch.cx + 0.5) * CHUNK * CELL, z = (ch.cz + 0.5) * CHUNK * CELL;
      if (Math.hypot(x - px, z - pz) > lim) { this.cols.delete(key); this.dirty.delete(key); out.push(ch.cx, ch.cz); }
    }
    return Int32Array.from(out);
  }

  // ---- mesher ---------------------------------------------------------------------
  chunk_mesh(cx, cz) {
    const ch = this.cols.get(cx + ',' + cz);
    if (!ch) return new Float32Array(0);
    const v = [], H = this.H;
    // one quad = two triangles; winding turned to face n (cull none is the
    // renderer rule, but keep it right)
    const quad = (a, b, c, d, n, ci, bt) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
      const cr = (uy * wz - uz * wy) * n[0] + (uz * wx - ux * wz) * n[1] + (ux * wy - uy * wx) * n[2];
      const P = cr >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
      for (const p of P) v.push(p[0], p[1], p[2], n[0], n[1], n[2], ci, bt);
    };
    const tri = (a, b, c, n, ci, bt) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
      const cr = (uy * wz - uz * wy) * n[0] + (uz * wx - ux * wz) * n[1] + (ux * wy - uy * wx) * n[2];
      const P = cr >= 0 ? [a, b, c] : [a, c, b];
      for (const p of P) v.push(p[0], p[1], p[2], n[0], n[1], n[2], ci, bt);
    };
    // box with min corner (x0, y0, z0) and max corner; skip[f] hides a face
    // f: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z
    const box = (x0, y0, z0, x1, y1, z1, ci, bt, skip, topC) => {
      if (!skip || !skip[0]) quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], ci, bt);
      if (!skip || !skip[1]) quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0], ci, bt);
      if (!skip || !skip[2]) quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], topC ?? ci, bt);
      if (!skip || !skip[3]) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], ci, bt);
      if (!skip || !skip[4]) quad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [0, 0, 1], ci, bt);
      if (!skip || !skip[5]) quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], ci, bt);
    };
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];   // +x -x +z -z
    const NRM = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    // A face toward a neighbour is hidden only when that neighbour is solid
    // AND collapsed, so an open neighbour never leaves a hole.
    const solidDone = (i, j, k) => this.cellKind(i, j, k) === WALL && (j < 0 || this.birthOf(i, j, k) >= 0);

    for (let lk = 0; lk < CHUNK; lk++) {
      for (let li = 0; li < CHUNK; li++) {
        const i = cx * CHUNK + li, k = cz * CHUNK + lk, x0 = i * CELL, z0 = k * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
        const col = this.columnOf(i, k);
        const base = (li + lk * CHUNK) * H;
        for (let j = 0; j < H; j++) {
          const bt = ch.birth[base + j];
          if (bt < 0) continue;
          const kind = this.cellKind(i, j, k), y0 = j * CELL, y1 = y0 + CELL;
          if (kind === WALL) {
            const wc = col.wallC;
            const up = this.cellKind(i, j + 1, k);
            for (let f = 0; f < 4; f++) {
              const ni = i + DIRS[f][0], nk = k + DIRS[f][1];
              if (solidDone(ni, j, nk)) continue;
              const n = NRM[f];
              // wall face
              let a, b, c, d;
              if (f === 0) { a = [x1, y0, z0]; b = [x1, y1, z0]; c = [x1, y1, z1]; d = [x1, y0, z1]; }
              else if (f === 1) { a = [x0, y0, z1]; b = [x0, y1, z1]; c = [x0, y1, z0]; d = [x0, y0, z0]; }
              else if (f === 2) { a = [x1, y0, z1]; b = [x1, y1, z1]; c = [x0, y1, z1]; d = [x0, y0, z1]; }
              else { a = [x0, y0, z0]; b = [x0, y1, z0]; c = [x1, y1, z0]; d = [x1, y0, z0]; }
              quad(a, b, c, d, n, wc, bt);
              // window, or a door at street level on some faces
              const r = hash(i, j, k * 4 + f, this.seed);
              const door = j === 0 && (r % 5 === 0);
              if (!door && r % 7 === 6) continue;             // blank bay
              const e = 0.03, cxw = (x0 + x1) / 2 + n[0] * (CELL / 2 + e), czw = (z0 + z1) / 2 + n[2] * (CELL / 2 + e);
              const tx = Math.abs(n[2]), tz = Math.abs(n[0]);  // tangent along the face
              const hw = door ? 0.48 : 0.42, wy0 = y0 + (door ? 0.02 : 0.62), wy1 = y0 + (door ? 1.55 : 1.55);
              const p = (s, y) => [cxw + tx * s, y, czw + tz * s];
              quad(p(-hw, wy0), p(-hw, wy1), p(hw, wy1), p(hw, wy0), n, door ? 10 : 7, bt);
              if (!door) {
                // a sill under the window
                const sx = 0.5, sy = wy0 - 0.08, out = 0.12;
                const q = (s, y, o) => [cxw + tx * s + n[0] * o, y, czw + tz * s + n[2] * o];
                quad(q(-sx, sy + 0.08, 0), q(-sx, sy + 0.08, out), q(sx, sy + 0.08, out), q(sx, sy + 0.08, 0), [0, 1, 0], 13, bt);
                quad(q(-sx, sy, out), q(-sx, sy + 0.08, out), q(sx, sy + 0.08, out), q(sx, sy, out), n, 13, bt);
              } else if (r % 3 === 0) {
                // an awning over the door
                const ax = 0.7, ay = y0 + 1.75, out = 0.7;
                const q = (s, y, o) => [cxw + tx * s + n[0] * o, y, czw + tz * s + n[2] * o];
                quad(q(-ax, ay, 0), q(-ax, ay - 0.3, out), q(ax, ay - 0.3, out), q(ax, ay, 0), [n[0] * 0.4, 0.9, n[2] * 0.4], 15, bt);
              }
            }
            if (up !== WALL || this.birthOf(i, j + 1, k) < 0) {
              quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], up === WALL ? col.wallC : col.roofC, bt);
              if (up !== WALL) {
                // parapet on each roof edge with no roof beside it
                for (let f = 0; f < 4; f++) {
                  const ni = i + DIRS[f][0], nk = k + DIRS[f][1];
                  if (this.cellKind(ni, j, nk) === WALL && this.cellKind(ni, j + 1, nk) !== WALL) continue;
                  if (this.cellKind(ni, j + 1, nk) === WALL) continue;
                  const t = 0.22, ph = 0.4;
                  let bx0 = x0, bx1 = x1, bz0 = z0, bz1 = z1;
                  if (f === 0) bx0 = x1 - t; else if (f === 1) bx1 = x0 + t; else if (f === 2) bz0 = z1 - t; else bz1 = z0 + t;
                  box(bx0, y1, bz0, bx1, y1 + ph, bz1, 13, bt, [false, false, false, true, false, false]);
                }
              }
            }
          } else if (j === 0 && (kind === PAVE || kind === GRASS || kind === WATER || (kind === RAMP && col.kind !== WALL))) {
            const gk = kind === RAMP ? col.kind : kind;
            const top = gk === GRASS ? 0.16 : gk === WATER ? 0.03 : 0.08;
            const c = gk === GRASS ? 2 : gk === WATER ? 3 : (mod(i + k, 2) === 0 ? 0 : 1);
            box(x0, 0, z0, x1, top, z1, c, bt, [false, false, false, true, false, false]);
            if (gk === WATER) {
              // kerbs where the channel meets a street or a lot
              for (let f = 0; f < 4; f++) {
                const ni = i + DIRS[f][0], nk = k + DIRS[f][1];
                if (this.columnOf(ni, nk).kind === WATER) continue;
                const t = 0.25;
                let bx0 = x0, bx1 = x1, bz0 = z0, bz1 = z1;
                if (f === 0) bx0 = x1 - t; else if (f === 1) bx1 = x0 + t; else if (f === 2) bz0 = z1 - t; else bz1 = z0 + t;
                box(bx0, 0, bz0, bx1, 0.22, bz1, 13, bt, [false, false, false, true, false, false]);
              }
            }
            if (gk === GRASS && hash(i, 0, k, this.seed + 3) % 3 === 0) {
              // a tree: trunk and a crown of two boxes
              const tx = x0 + 1, tz = z0 + 1, s = 0.5 + h01(i, 1, k, this.seed) * 0.3;
              box(tx - 0.12, top, tz - 0.12, tx + 0.12, top + 1.4, tz + 0.12, 10, bt, [false, false, true, true, false, false]);
              box(tx - 0.8 * s - 0.2, top + 1.3, tz - 0.8 * s - 0.2, tx + 0.8 * s + 0.2, top + 2.4 + s, tz + 0.8 * s + 0.2, 12, bt);
            }
          }
          if (kind === RAMP) {
            // a sloped slab that climbs 2 m across the cell toward col.ramp
            const yb = y0 + (col.kind === WALL ? 0 : 0.08), yt = y0 + CELL + (col.kind === WALL ? 0 : 0);
            const d = col.ramp;
            let lo, hi;   // lo edge (2 points) at yb, hi edge at yt
            if (d === 0) { lo = [[x0, z0], [x0, z1]]; hi = [[x1, z0], [x1, z1]]; }
            else if (d === 1) { lo = [[x1, z0], [x1, z1]]; hi = [[x0, z0], [x0, z1]]; }
            else if (d === 2) { lo = [[x0, z0], [x1, z0]]; hi = [[x0, z1], [x1, z1]]; }
            else { lo = [[x0, z1], [x1, z1]]; hi = [[x0, z0], [x1, z0]]; }
            const dx = DIRS[d][0], dz = DIRS[d][1];
            // steps: 6 treads read as stairs
            const STEPS = 6;
            for (let s = 0; s < STEPS; s++) {
              const f0 = s / STEPS, f1 = (s + 1) / STEPS, yy = yb + (yt - yb) * f1;
              const P = (e, f) => [lo[e][0] + (hi[e][0] - lo[e][0]) * f, yy, lo[e][1] + (hi[e][1] - lo[e][1]) * f];
              quad(P(0, f0), P(1, f0), P(1, f1), P(0, f1), [0, 1, 0], 13, bt);
              const R = (e, f, y) => [lo[e][0] + (hi[e][0] - lo[e][0]) * f, y, lo[e][1] + (hi[e][1] - lo[e][1]) * f];
              quad(R(0, f0, yb + (yt - yb) * f0), R(0, f0, yy), R(1, f0, yy), R(1, f0, yb + (yt - yb) * f0), [-dx, 0, -dz], 13, bt);
            }
            // side walls of the stair (triangles)
            for (let e = 0; e < 2; e++) {
              const sgn = e === 0 ? -1 : 1;
              const sn = d < 2 ? [0, 0, sgn] : [sgn, 0, 0];
              tri([lo[e][0], yb, lo[e][1]], [hi[e][0], yb, hi[e][1]], [hi[e][0], yt, hi[e][1]], sn, 1, bt);
            }
          }
        }
      }
    }
    return Float32Array.from(v);
  }

  // ---- bodies ----------------------------------------------------------------------
  // Top of the solid in a column at (x, z), with the ramp slope. Only
  // collapsed slots count; an open column has the ground at y = 0.
  topAt(x, z) {
    const i = Math.floor(x / CELL), k = Math.floor(z / CELL);
    const c = this.columnOf(i, k);
    let h = c.kind === WALL ? c.h : 0;
    let y = c.kind === WALL ? h * CELL : (c.kind === GRASS ? 0.16 : c.kind === WATER ? 0.03 : 0.08);
    // only the collapsed layers stand
    if (c.kind === WALL) { while (h > 0 && this.birthOf(i, h - 1, k) < 0) h--; y = h * CELL; if (h === 0) y = 0.08; }
    if (c.ramp >= 0 && this.birthOf(i, c.kind === WALL ? c.h : 0, k) >= 0 && h === (c.kind === WALL ? c.h : 0)) {
      const fx = x / CELL - i, fz = z / CELL - k;
      const f = c.ramp === 0 ? fx : c.ramp === 1 ? 1 - fx : c.ramp === 2 ? fz : 1 - fz;
      y = h * CELL + Math.max(0, Math.min(1, f)) * CELL;
    }
    return y;
  }

  ground_height(x, z) {
    const i = Math.floor(x / CELL), k = Math.floor(z / CELL), c = this.columnOf(i, k);
    if (c.kind === WALL) return c.h * CELL;
    return c.kind === GRASS ? 0.16 : c.kind === WATER ? 0.03 : 0.08;
  }

  // state = [x, y, z, vx, vy, vz, grounded, unused]; feet at y
  move_body(st, dt, radius, height, fly) {
    dt = Math.min(Math.max(dt, 0), 1 / 15);
    const STEP = 0.55, G = 18;
    if (!fly) st[4] -= G * dt;
    const sp = Math.hypot(st[3], st[4], st[5]);
    const n = Math.max(1, Math.ceil(sp * dt / 0.2));
    const h = dt / n;
    const floorAt = (x, z) => {
      let m = -Infinity;
      for (const [ox, oz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) m = Math.max(m, this.topAt(x + ox * 0.9, z + oz * 0.9));
      return m;
    };
    let grounded = 0;
    for (let s = 0; s < n; s++) {
      // horizontal, one axis at a time; a rise over STEP blocks the axis
      for (const ax of [0, 2]) {
        const nx = ax === 0 ? st[0] + st[3] * h : st[0], nz = ax === 2 ? st[2] + st[5] * h : st[2];
        const f = floorAt(nx, nz);
        if (f - st[1] <= STEP) { st[0] = nx; st[2] = nz; if (f > st[1] && st[4] <= 0) { st[1] = f; } }
        else { if (ax === 0) st[3] = 0; else st[5] = 0; }
      }
      st[1] += st[4] * h;
      const f = floorAt(st[0], st[2]);
      if (st[1] <= f) { st[1] = f; if (st[4] < 0) st[4] = 0; grounded = 1; }
      if (st[1] > this.H * CELL + 40) { st[1] = this.H * CELL + 40; if (st[4] > 0) st[4] = 0; }
    }
    st[6] = grounded;
  }

  counter() { return this.count; }
  stats() {
    let live = 0;
    for (const ch of this.cols.values()) for (let n = 0; n < ch.birth.length; n++) if (ch.birth[n] >= 0) live++;
    return Float32Array.from([this.count, 0, 0, live, this.cols.size, MODULES, PROTOS.length, this.lastMs]);
  }
  palette() { const out = new Float32Array(48); PAL.forEach((c, n) => { out[n * 3] = toLin(c[0]); out[n * 3 + 1] = toLin(c[1]); out[n * 3 + 2] = toLin(c[2]); }); return out; }
  module_count() { return MODULES; }
  prototype_name(i) { return PROTOS[i] || ''; }
  slot_info(i, j, k) {
    const b = this.birthOf(i, j, k);
    const kind = this.cellKind(i, j, k);
    const proto = kind === WALL ? 4 : kind === RAMP ? 9 : kind;
    if (b < 0) return Int32Array.from([this.cols.has(fdiv(i, CHUNK) + ',' + fdiv(k, CHUNK)) ? 1 : 0, MODULES, -1, -1]);
    return Int32Array.from([2, 1, proto * 3, proto]);
  }
  free() { this.cols.clear(); this.colCache.clear(); }
}

export function version() { return 'mock-0.1'; }
export const IS_MOCK = true;
export default async function init() { return {}; }
