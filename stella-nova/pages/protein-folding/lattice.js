// ============================================================================
//  PROTEIN FOLDING  ·  lattice.js — HP lattice model with pull moves
// ----------------------------------------------------------------------------
//  No DOM and no THREE. worker.js runs it in the page, tests.mjs in Node.
//
//  The chain is a self-avoiding walk on the square (2D) or cubic (3D)
//  lattice. Each residue is H (hydrophobic) or P (polar). The energy is
//      E = -(number of H-H pairs that are lattice neighbours, not bonded)
//  A pull move (Lesh, Mitzenmacher and Whitesides 2003) moves one residue
//  to a free corner site and pulls the chain behind it until the chain is
//  connected again. End pulls move an end two sites out. Moves are
//  accepted by the Metropolis rule.
//
//  Search modes, for R replicas:
//    remc ..... replica exchange: a geometric ladder Tlo..Thi, neighbour
//               swaps accepted with min(1, exp((b_i - b_j)(E_i - E_j)))
//    anneal ... each replica cools from Thi to Tlo, then starts again
//    fixed .... every replica at one temperature
//
//  GREP MAP
//    export const HP_BENCH ......... benchmark sequences, best known 2D E
//    export function makeChain ..... a straight chain on the lattice
//    export function setPositions .. a chain at given sites
//    export function energyOf ...... the full H-H count (tests, checks)
//    function pullMove ............. propose and apply one pull move
//    export function mcSweep ....... Metropolis moves for one replica
//    export function createSearch .. replicas, ladder, swaps, best found
//    export function enumerate2D ... exact ground state by enumeration
// ============================================================================

// Standard 2D HP benchmarks (Unger and Moult 1993; Hart and Istrail).
// best = lowest energy reported in the literature on the square lattice.
export const HP_BENCH = [
  { id: 'hp20', seq: 'HPHPPHHPHPPHPHHPPHPH', best: -9 },
  { id: 'hp24', seq: 'HHPPHPPHPPHPPHPPHPPHPPHH', best: -9 },
  { id: 'hp25', seq: 'PPHPPHHPPPPHHPPPPHHPPPPHH', best: -8 },
  { id: 'hp36', seq: 'PPPHHPPHHPPPPPHHHHHHHPPHHPPPPHHPPHPP', best: -14 },
  { id: 'hp48', seq: 'PPHPPHHPPHHPPPPPHHHHHHHHHHPPPPPPHHPPHHPPHPPHHHHH', best: -23 },
  { id: 'hp50', seq: 'HHPHPHPHPHHHHPHPPPHPPPHPPPPHPPPHPPPHPHHHHPHPHPHPHH', best: -21 },
  { id: 'hp60', seq: 'PPHHHPHHHHHHHHPPPHHHHHHHHHHPHPPPHHHHHHHHHHHHPPPPHHHHHHPHHPHP', best: -36 },
  { id: 'hp64', seq: 'HHHHHHHHHHHHPHPHPPHHPPHHPPHPPHHPPHHPPHPPHHPPHHPPHPHPHHHHHHHHHHHH', best: -42 },
];

const OFF = 512, K = 1024;
const key = (x, y, z) => ((x + OFF) * K + (y + OFF)) * K + (z + OFF);
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// A straight chain along x. pos is Int32Array(3N); map is site -> index.
export function makeChain(seq, dim = 2) {
  const N = seq.length, pos = new Int32Array(3 * N);
  for (let i = 0; i < N; i++) pos[3 * i] = i - (N >> 1);
  const h = new Uint8Array(N); for (let i = 0; i < N; i++) h[i] = seq[i] === 'H' ? 1 : 0;
  const c = { N, dim, h, pos, map: new Map(), E: 0, nd: 2 * dim, old: new Int32Array(3 * N), moved: new Int32Array(N) };
  rebuildMap(c);
  c.E = energyOf(c);
  return c;
}
// Puts a chain at new sites (flat xyz) and recounts its energy.
export function setPositions(c, pos) { c.pos.set(pos); rebuildMap(c); c.E = energyOf(c); return c; }
function rebuildMap(c) {
  c.map.clear();
  for (let i = 0; i < c.N; i++) c.map.set(key(c.pos[3 * i], c.pos[3 * i + 1], c.pos[3 * i + 2]), i);
}
// Keeps the chain near the origin, so the site keys stay in range.
function recentre(c) {
  const { N, pos } = c;
  const sx = pos[0], sy = pos[1], sz = pos[2];
  if (Math.abs(sx) < 300 && Math.abs(sy) < 300 && Math.abs(sz) < 300) return;
  for (let i = 0; i < N; i++) { pos[3 * i] -= sx; pos[3 * i + 1] -= sy; pos[3 * i + 2] -= sz; }
  rebuildMap(c);
}
export function energyOf(c) {
  const { N, pos, h, map, nd } = c; let e = 0;
  for (let i = 0; i < N; i++) {
    if (!h[i]) continue;
    for (let d = 0; d < nd; d++) {
      const j = map.get(key(pos[3 * i] + DIRS[d][0], pos[3 * i + 1] + DIRS[d][1], pos[3 * i + 2] + DIRS[d][2]));
      if (j !== undefined && j > i + 1 && h[j]) e--;
    }
  }
  return e;
}
// H-H contacts that involve at least one moved residue (moved[i] = stamp).
function localContacts(c, list, n, stamp) {
  const { pos, h, map, nd, moved } = c; let e = 0;
  for (let m = 0; m < n; m++) {
    const i = list[m]; if (!h[i]) continue;
    for (let d = 0; d < nd; d++) {
      const j = map.get(key(pos[3 * i] + DIRS[d][0], pos[3 * i + 1] + DIRS[d][1], pos[3 * i + 2] + DIRS[d][2]));
      if (j === undefined || !h[j] || j === i + 1 || j === i - 1) continue;
      if (moved[j] === stamp && j < i) continue;   // counted from j already
      e++;
    }
  }
  return e;
}
export function validChain(c) {
  const { N, pos } = c, seen = new Set();
  for (let i = 0; i < N; i++) {
    const k = key(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
    if (seen.has(k)) return false; seen.add(k);
    if (i && Math.abs(pos[3 * i] - pos[3 * i - 3]) + Math.abs(pos[3 * i + 1] - pos[3 * i - 2]) + Math.abs(pos[3 * i + 2] - pos[3 * i - 1]) !== 1) return false;
  }
  return true;
}

// --- pull moves ---------------------------------------------------------------
// Proposes one pull move. On success the move is applied to pos and map,
// the moved indices are in list[0..n), their old sites in c.old, and the
// function returns n. It returns 0 when the move is not possible.
const LIST = new Int32Array(4096);
let STAMP = 1;
function adj(p, a, b) { return Math.abs(p[a] - p[b]) + Math.abs(p[a + 1] - p[b + 1]) + Math.abs(p[a + 2] - p[b + 2]) === 1; }
function pullMove(c, rnd) {
  const { N, pos, map, nd, old } = c;
  const i = (rnd() * N) | 0;
  const free = (x, y, z) => !map.has(key(x, y, z));
  let n = 0;
  const stamp = ++STAMP; c.stamp = stamp;
  const mark = j => { old[3 * n] = pos[3 * j]; old[3 * n + 1] = pos[3 * j + 1]; old[3 * n + 2] = pos[3 * j + 2]; LIST[n++] = j; c.moved[j] = stamp; };
  const endPull = (i === 0 || i === N - 1) && rnd() < 0.5;
  if (endPull) {
    // end residue to L, its neighbour to C (C next to the end, L next to C)
    const s = i === 0 ? 1 : -1;
    const dC = DIRS[(rnd() * nd) | 0], dL = DIRS[(rnd() * nd) | 0];
    const cx = pos[3 * i] + dC[0], cy = pos[3 * i + 1] + dC[1], cz = pos[3 * i + 2] + dC[2];
    const lx = cx + dL[0], ly = cy + dL[1], lz = cz + dL[2];
    if (!free(cx, cy, cz) || !free(lx, ly, lz) || (lx === pos[3 * i] && ly === pos[3 * i + 1] && lz === pos[3 * i + 2])) return 0;
    // residues i, i+s, i+2s ... take L, C, old(i), old(i+s) ... until connected
    const NEW = c._new || (c._new = new Int32Array(3 * N));
    NEW[0] = lx; NEW[1] = ly; NEW[2] = lz; NEW[3] = cx; NEW[4] = cy; NEW[5] = cz;
    let k = 0, j = i;
    for (; j >= 0 && j < N; j += s, k++) {
      if (k >= 2) {
        const px = NEW[3 * (k - 1)], py = NEW[3 * (k - 1) + 1], pz = NEW[3 * (k - 1) + 2];
        if (Math.abs(pos[3 * j] - px) + Math.abs(pos[3 * j + 1] - py) + Math.abs(pos[3 * j + 2] - pz) === 1) break;
        NEW[3 * k] = old[3 * (k - 2)]; NEW[3 * k + 1] = old[3 * (k - 2) + 1]; NEW[3 * k + 2] = old[3 * (k - 2) + 2];
      }
      mark(j);
    }
    commit(c, n, NEW);
    return n;
  }
  // interior (or end) residue i pulled toward lower (dirn -1) or higher (+1) index
  const dirn = rnd() < 0.5 ? -1 : 1;
  const a = i - dirn;                  // the anchor: i+1 for a pull down, i-1 for a pull up
  if (a < 0 || a >= N) return 0;
  const ux = pos[3 * i] - pos[3 * a], uy = pos[3 * i + 1] - pos[3 * a + 1], uz = pos[3 * i + 2] - pos[3 * a + 2];
  const d = DIRS[(rnd() * nd) | 0];
  if (d[0] * ux + d[1] * uy + d[2] * uz !== 0) return 0;      // d must be perpendicular to bond a-i
  const lx = pos[3 * a] + d[0], ly = pos[3 * a + 1] + d[1], lz = pos[3 * a + 2] + d[2];
  const cx = pos[3 * i] + d[0], cy = pos[3 * i + 1] + d[1], cz = pos[3 * i + 2] + d[2];
  if (!free(lx, ly, lz)) return 0;
  const b = i + dirn;                  // the next residue along the pull
  const NEW = c._new || (c._new = new Int32Array(3 * N));
  NEW[0] = lx; NEW[1] = ly; NEW[2] = lz;
  if (b < 0 || b >= N || (pos[3 * b] === cx && pos[3 * b + 1] === cy && pos[3 * b + 2] === cz)) {
    mark(i); commit(c, n, NEW); return n;
  }
  if (!free(cx, cy, cz)) return 0;
  NEW[3] = cx; NEW[4] = cy; NEW[5] = cz;
  let k = 0;
  for (let j = i; j >= 0 && j < N; j += dirn, k++) {
    if (k >= 2) {
      const px = NEW[3 * (k - 1)], py = NEW[3 * (k - 1) + 1], pz = NEW[3 * (k - 1) + 2];
      if (Math.abs(pos[3 * j] - px) + Math.abs(pos[3 * j + 1] - py) + Math.abs(pos[3 * j + 2] - pz) === 1) break;
      NEW[3 * k] = old[3 * (k - 2)]; NEW[3 * k + 1] = old[3 * (k - 2) + 1]; NEW[3 * k + 2] = old[3 * (k - 2) + 2];
    }
    mark(j);
  }
  commit(c, n, NEW);
  return n;
}
function commit(c, n, NEW) {
  const { pos, map, old } = c;
  for (let m = 0; m < n; m++) map.delete(key(old[3 * m], old[3 * m + 1], old[3 * m + 2]));
  for (let m = 0; m < n; m++) {
    const j = LIST[m];
    pos[3 * j] = NEW[3 * m]; pos[3 * j + 1] = NEW[3 * m + 1]; pos[3 * j + 2] = NEW[3 * m + 2];
    map.set(key(pos[3 * j], pos[3 * j + 1], pos[3 * j + 2]), j);
  }
}
function revert(c, n) {
  const { pos, map, old } = c;
  for (let m = 0; m < n; m++) { const j = LIST[m]; map.delete(key(pos[3 * j], pos[3 * j + 1], pos[3 * j + 2])); }
  for (let m = 0; m < n; m++) {
    const j = LIST[m];
    pos[3 * j] = old[3 * m]; pos[3 * j + 1] = old[3 * m + 1]; pos[3 * j + 2] = old[3 * m + 2];
    map.set(key(pos[3 * j], pos[3 * j + 1], pos[3 * j + 2]), j);
  }
}

// Metropolis moves for one chain at temperature T. Returns accepted count.
// pullMove applies the move; the contacts of the moved beads are counted,
// the move is reverted to count them again on the old sites, and redo()
// applies it once more when Metropolis accepts.
export function mcSweep(c, T, moves, rnd) {
  let acc = 0;
  for (let m = 0; m < moves; m++) {
    const n = pullMove(c, rnd);
    if (!n) continue;
    const stamp = c.stamp;
    const after = localContacts(c, LIST, n, stamp);
    revert(c, n);
    const before = localContacts(c, LIST, n, stamp);
    const dE = before - after;          // E = -contacts
    if (dE <= 0 || rnd() < Math.exp(-dE / T)) {
      // re-apply: old[] still holds the old sites; swap in the new ones
      redo(c, n);
      c.E += dE; acc++;
    }
  }
  recentre(c);
  return acc;
}
function redo(c, n) {
  const NEW = c._new;
  const { pos, map, old } = c;
  for (let m = 0; m < n; m++) map.delete(key(old[3 * m], old[3 * m + 1], old[3 * m + 2]));
  for (let m = 0; m < n; m++) {
    const j = LIST[m];
    pos[3 * j] = NEW[3 * m]; pos[3 * j + 1] = NEW[3 * m + 1]; pos[3 * j + 2] = NEW[3 * m + 2];
    map.set(key(pos[3 * j], pos[3 * j + 1], pos[3 * j + 2]), j);
  }
}

// --- search over replicas -----------------------------------------------------
export function ladder(R, lo, hi) {
  if (R === 1) return [lo];
  return Array.from({ length: R }, (_, k) => lo * Math.pow(hi / lo, k / (R - 1)));
}
export function createSearch(seq, opt = {}) {
  const R = opt.replicas ?? 8, dim = opt.dim ?? 2;
  const s = {
    seq, dim, R, mode: opt.mode ?? 'remc', Tlo: opt.Tlo ?? 0.25, Thi: opt.Thi ?? 1.6, Tfix: opt.Tfix ?? 0.5,
    annealSweeps: opt.annealSweeps ?? 3000,
    chains: [], T: [], moves: 0, sweeps: 0, swapTry: 0, swapAcc: 0, acc: new Float64Array(R), tried: new Float64Array(R),
    bestE: 0, bestPos: null, bestAt: 0, trace: [],
  };
  for (let r = 0; r < R; r++) s.chains.push(makeChain(seq, dim));
  s.bestPos = Int32Array.from(s.chains[0].pos);
  setTemps(s);
  return s;
}
export function setTemps(s) {
  if (s.mode === 'remc') s.T = ladder(s.R, s.Tlo, s.Thi);
  else if (s.mode === 'fixed') s.T = Array(s.R).fill(s.Tfix);
  else { const f = (s.sweeps % s.annealSweeps) / s.annealSweeps; s.T = Array(s.R).fill(s.Thi * Math.pow(s.Tlo / s.Thi, f)); }
}
// One sweep: N moves per replica, then (remc) one round of swaps.
export function searchSweep(s, rnd) {
  const N = s.seq.length;
  if (s.mode === 'anneal') setTemps(s);
  for (let r = 0; r < s.R; r++) {
    s.acc[r] += mcSweep(s.chains[r], s.T[r], N, rnd); s.tried[r] += N;
    const c = s.chains[r];
    if (c.E < s.bestE) { s.bestE = c.E; s.bestPos = Int32Array.from(c.pos); s.bestAt = s.moves + (r + 1) * N; }
  }
  s.moves += s.R * N; s.sweeps++;
  if (s.mode === 'remc' && s.R > 1) {
    for (let r = s.sweeps & 1; r + 1 < s.R; r += 2) {
      const a = s.chains[r], b = s.chains[r + 1];
      const x = (1 / s.T[r] - 1 / s.T[r + 1]) * (a.E - b.E);
      s.swapTry++;
      if (x >= 0 || rnd() < Math.exp(x)) { s.chains[r] = b; s.chains[r + 1] = a; s.swapAcc++; }
    }
  }
}

// --- exact ground state by enumeration (2D, short chains; tests) --------------
// Walks start with a step +x and the first turn to +y, which removes the
// eightfold symmetry of the square lattice.
export function enumerate2D(seq) {
  const N = seq.length, h = [...seq].map(ch => ch === 'H');
  const xs = new Int32Array(N), ys = new Int32Array(N), occ = new Map();
  let best = 0, count = 0;
  const k2 = (x, y) => (x + 64) * 256 + (y + 64);
  const D2 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function go(i, e, turned) {
    if (i === N) { count++; if (e < best) best = e; return; }
    for (const [dx, dy] of D2) {
      const x = xs[i - 1] + dx, y = ys[i - 1] + dy;
      if (occ.has(k2(x, y))) continue;
      if (!turned && dy < 0) continue;           // first turn goes to +y
      const nowTurned = turned || dy !== 0;
      let de = 0;
      if (h[i]) for (const [ex, ey] of D2) { const j = occ.get(k2(x + ex, y + ey)); if (j !== undefined && j < i - 1 && h[j]) de--; }
      xs[i] = x; ys[i] = y; occ.set(k2(x, y), i);
      go(i + 1, e + de, nowTurned);
      occ.delete(k2(x, y));
    }
  }
  xs[0] = 0; ys[0] = 0; occ.set(k2(0, 0), 0);
  if (N > 1) { xs[1] = 1; ys[1] = 0; occ.set(k2(1, 0), 1); go(2, 0, false); } else count = 1;
  return { best, count };
}
