// life.js - the rule, the CPU reference, and the pattern tools.
//
// This module has no DOM code. The page, the CPU fallback engine, the info
// panel and tests.mjs all import it, so every one uses the same rule code.
//
// CELL WORD. Each cell is one u32, the same on the CPU and the GPU:
//   bits 0..7    age. 0 is dead. 1 is a newborn. A cell that survives adds
//                1 each generation, up to 255.
//   bits 8..15   trail. A cell that dies gets TRAIL here. A dead cell
//                subtracts 1 each generation, down to 0.
// A cell is alive when its age is not 0. The trail is for the colours only.
// It has no effect on the rule.
//
// RULE. A Life-like rule is two 9-bit masks over the neighbour count n:
//   birth   bit n set: a dead cell with n live neighbours is born.
//   survive bit n set: a live cell with n live neighbours stays alive.
// Conway's Life is B3/S23: birth = 1 << 3, survive = (1 << 2) | (1 << 3).
//
// GREP MAP
//   grep -n 'export function nextValue'   one cell, the rule (WGSL copy in life.wgsl)
//   grep -n 'export function stepDense'   one generation of a W x H world
//   grep -n 'export function stepSparse'  one generation on an unbounded plane
//   grep -n 'export function parseRule'   B/S text to masks
//   grep -n 'export function parseRLE'    RLE text to a cell list
//   grep -n 'export function orient'      rotate and flip a cell list
//   grep -n 'export function randomWorld' seeded random fill

export const TRAIL = 40;

// The rules in the picker. str is the B/S form. note is one line for the UI.
export const RULES = [
  { name: 'Life', str: 'B3/S23', note: "Conway's rule. Gliders, guns, and long chaotic histories." },
  { name: 'HighLife', str: 'B36/S23', note: 'Life plus birth on 6. It has a small replicator.' },
  { name: 'Seeds', str: 'B2/S', note: 'No cell survives. Each live cell lives for one generation only, and growth is explosive.' },
  { name: 'Day & Night', str: 'B3678/S34678', note: 'Live and dead cells obey the same rule, so a pattern and its negative act the same.' },
  { name: 'Life without Death', str: 'B3/S012345678', note: 'No cell dies. Patterns grow into ladders and solid blots.' },
  { name: 'Maze', str: 'B3/S12345', note: 'Random soup grows into a maze of corridors.' },
  { name: '2x2', str: 'B36/S125', note: 'Blocks of 2 x 2 cells act as one cell.' },
  { name: 'Replicator', str: 'B1357/S1357', note: 'Every pattern makes copies of itself.' },
];

// ------------------------------------------------------------------- rule
const digits = m => { let s = ''; for (let n = 0; n <= 8; n++) if ((m >> n) & 1) s += n; return s; };
export const ruleString = (birth, survive) => 'B' + digits(birth) + '/S' + digits(survive);

// Accepts "B3/S23", "b3s23", "B36/S23", "B2/S" and the old S/B form "23/3".
// Returns {birth, survive, str} or null.
export function parseRule(text) {
  const t = String(text || '').trim().toUpperCase().replace(/\s+/g, '');
  let b = null, s = null;
  let m = t.match(/^B([0-8]*)\/?S([0-8]*)$/);
  if (m) { b = m[1]; s = m[2]; }
  else if ((m = t.match(/^S([0-8]*)\/?B([0-8]*)$/))) { s = m[1]; b = m[2]; }
  else if ((m = t.match(/^([0-8]*)\/([0-8]*)$/))) { s = m[1]; b = m[2]; }
  if (b === null) return null;
  let birth = 0, survive = 0;
  for (const c of b) birth |= 1 << +c;
  for (const c of s) survive |= 1 << +c;
  return { birth, survive, str: ruleString(birth, survive) };
}

// One cell. v is the old cell word, n the count of live neighbours.
// life.wgsl has the same function. Keep the two the same.
export function nextValue(v, n, birth, survive) {
  const age = v & 0xff;
  if (age !== 0) {
    if ((survive >> n) & 1) return age < 255 ? age + 1 : 255;
    return TRAIL << 8;
  }
  if ((birth >> n) & 1) return 1;
  const t = (v >> 8) & 0xff;
  return t > 0 ? (t - 1) << 8 : 0;
}

// One generation of a W x H world. wrap true: a torus. wrap false: the cells
// outside the world are dead. Returns dst (a new array if none is given).
export function stepDense(src, W, H, birth, survive, wrap, dst) {
  dst = dst || new Uint32Array(W * H);
  const live = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) live[i] = (src[i] & 0xff) !== 0 ? 1 : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        let yy = y + dy;
        if (yy < 0 || yy >= H) { if (!wrap) continue; yy = (yy + H) % H; }
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          let xx = x + dx;
          if (xx < 0 || xx >= W) { if (!wrap) continue; xx = (xx + W) % W; }
          n += live[yy * W + xx];
        }
      }
      const i = y * W + x;
      dst[i] = nextValue(src[i], n, birth, survive);
    }
  }
  return dst;
}

// Population, births and deaths from one generation to the next.
export function diffStats(a, b) {
  let pop = 0, births = 0, deaths = 0;
  for (let i = 0; i < b.length; i++) {
    const wa = (a[i] & 0xff) !== 0, wb = (b[i] & 0xff) !== 0;
    if (wb) pop++;
    if (wb && !wa) births++;
    if (wa && !wb) deaths++;
  }
  return { pop, births, deaths };
}

// ---------------------------------------------------------- sparse plane
// A live set on an unbounded plane, for the tests and the info diagrams.
// The key packs x and y in one number. |x|, |y| must stay below 2^20.
const OFF = 1 << 20, SPAN = 1 << 21;
export const key = (x, y) => (x + OFF) * SPAN + (y + OFF);
export const unkey = k => [Math.floor(k / SPAN) - OFF, (k % SPAN) - OFF];
export function toSet(cells) { const s = new Set(); for (const [x, y] of cells) s.add(key(x, y)); return s; }
export function fromSet(set) { return [...set].map(unkey); }

// One generation of a live set. It uses nextValue, so it obeys the same rule
// code as the dense step and the GPU.
export function stepSparse(set, birth, survive) {
  const count = new Map();
  for (const k of set) {
    const x = Math.floor(k / SPAN) - OFF, y = (k % SPAN) - OFF;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const q = key(x + dx, y + dy);
      count.set(q, (count.get(q) || 0) + 1);
    }
  }
  const out = new Set();
  for (const [k, n] of count) if (nextValue(set.has(k) ? 1 : 0, n, birth, survive) & 0xff) out.add(k);
  // A live cell with no live neighbour is not in count. It survives on S0 only.
  if (survive & 1) for (const k of set) if (!count.has(k)) out.add(k);
  return out;
}

// --------------------------------------------------------------- patterns
// RLE: b dead, o live, $ end of row, ! end; a number repeats the next token.
// Lines that start with # and the "x = .." header are skipped.
export function parseRLE(text) {
  const body = String(text).split('\n').filter(l => !/^\s*(#|x\s*=)/.test(l)).join('');
  const cells = [];
  let x = 0, y = 0, num = '';
  for (const ch of body) {
    if (ch >= '0' && ch <= '9') { num += ch; continue; }
    const n = num ? parseInt(num, 10) : 1; num = '';
    if (ch === 'b' || ch === '.') x += n;
    else if (ch === 'o' || ch === 'A') { for (let i = 0; i < n; i++) cells.push([x + i, y]); x += n; }
    else if (ch === '$') { y += n; x = 0; }
    else if (ch === '!') break;
  }
  return normalize(cells);
}

export function bounds(cells) {
  if (!cells.length) return { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of cells) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Move the cells so the box starts at (0, 0), and sort them by row.
export function normalize(cells) {
  const b = bounds(cells);
  return cells.map(([x, y]) => [x - b.x0, y - b.y0]).sort((p, q) => p[1] - q[1] || p[0] - q[0]);
}

// Rotate by rot quarter turns clockwise, after a mirror in x when flip is true.
export function orient(cells, rot, flip) {
  let c = cells.map(([x, y]) => [flip ? -x : x, y]);
  for (let r = 0; r < ((rot % 4) + 4) % 4; r++) c = c.map(([x, y]) => [-y, x]);
  return normalize(c);
}

export const sameCells = (a, b) => a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);

// ----------------------------------------------------------------- random
// mulberry32: a small seeded generator, so the GPU parity test can repeat.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A W x H world. Each cell is a newborn with probability density. A box
// (x0, y0, w, h) limits the fill to part of the world.
export function randomWorld(W, H, density, seed, box) {
  const r = rng(seed), out = new Uint32Array(W * H);
  const bx = box ? box.x : 0, by = box ? box.y : 0, bw = box ? box.w : W, bh = box ? box.h : H;
  for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) if (r() < density) out[y * W + x] = 1;
  return out;
}
