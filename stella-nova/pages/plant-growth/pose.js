// ============================================================================
//  PLANT GROWTH  ·  GPU packing, colour modes and the CPU twin of the shaders
// ----------------------------------------------------------------------------
//  The model (grow.js) gives one snapshot per simulated year. packYear()
//  turns the snapshot and the per-year history into five RGBA float rows
//  per node (render.js reads them as textures, TEX_W texels per row) and a
//  leaf instance buffer, for one display year Y:
//    T0  x, y, z, born            T1  rA, rB, parent (minus for a lateral), died
//    T2  frame quaternion         T3  arc length s, born of the main child,
//                                     light, colour value of the mode
//    T4  species, plant, rand, flags (1 frond, 2 trunk)
//  rA is the radius at the end of year Y-1 and rB at the end of year Y; the
//  shader grows the radius from one to the other in the season (girth).
//  Only the nodes that show in year Y are packed (a dead branch shows for
//  one year as it falls and rots), so ids are remapped (pack.remap).
//
//  The frame of a node: its tangent is the bisector of the segment into it
//  and the segment to its main child, and its normal is carried from the
//  parent (a rotation-minimising frame). Two segments that meet at a node
//  share the ring there, so a branch is one smooth generalised cylinder.
//
//  The functions after "CPU twin" do on the CPU what the shaders do on the
//  GPU (mesh.js builds a thumbnail mesh with them; tests.mjs checks them).
//
//  grep -n targets
//    colour modes .......... "export const COLOUR_MODES"
//    atlas cells ........... "export function cellIndex"
//    species tables ........ "export function speciesTables"
//    frames ................ "export function nodeFrames"
//    pack one year ......... "export function packYear"
//    CPU twin: node ........ "export function nodeShown"
//    CPU twin: leaf ........ "export function leafPose"
//    wind (JS and GLSL) .... "export function windOffset"
// ============================================================================
import { SPECIES, SPECIES_IDS, LEAF_STRIDE, OPEN, SPECIES_DUR } from './grow.js';
import { ATLAS_SIZE, ATLAS_CELLS } from './atlas.js';
import { LOOK, BARKS, hex3 } from './look.js';
import { leafState, girthPhase, deathDrop, deathFade, smoothstep } from './season.js';

export const TEX_W = 256;

export const COLOUR_MODES = [
  { id: 'natural', label: 'Natural', short: 'Natural', text: 'Bark, leaves and flowers as they look. Leaves inside the crown get less sky light.' },
  { id: 'age', label: 'Age', short: 'Age', text: 'When each metamer grew. The newest shoots are at the hot end, so the growing tips glow as they extend.' },
  { id: 'order', label: 'Branch order', short: 'Order', text: 'The trunk is order 0. Each lateral branch is one order more than the branch it grows from.' },
  { id: 'flow', label: 'Pipe flow', short: 'Flow', text: 'The pipe model: how many shoot tips a branch carries, on a log scale. The trunk carries all of them.' },
  { id: 'vigour', label: 'Resource', short: 'Resource', text: 'Borchert-Honda: the share of the resource that flowed into each branch this year. Apical dominance sends more up the leader.' },
  { id: 'light', label: 'Light', short: 'Light', text: 'The light from the shadow grid: deep in the crown it is dark, and branches there are shed.' },
  { id: 'height', label: 'Height', short: 'Height', text: 'Height above the deepest root, up to the top of the crown.' },
];
export const COLOUR_IDS = COLOUR_MODES.map(m => m.id);
export const MODE_INDEX = Object.fromEntries(COLOUR_IDS.map((id, k) => [id, k]));

// ------------------------------------------------------------- atlas cells
export const CELLS = [];          // [u0, v0, u1, v1, quadAspect]
const CELL_BASE = {};
for (const name of Object.keys(ATLAS_CELLS)) {
  CELL_BASE[name] = CELLS.length;
  for (const c of ATLAS_CELLS[name]) CELLS.push([c[0], c[1], c[2], c[3], ((c[2] - c[0]) * ATLAS_SIZE[0]) / ((c[3] - c[1]) * ATLAS_SIZE[1])]);
}
// The flat cell index of a leaf record (species index, kind, variant).
export function cellIndex(spIndex, kind, variant) {
  const L = LOOK[SPECIES_IDS[spIndex]] || LOOK.oak;
  const name = kind === 1 ? (L.flower || L.leaf) : kind === 2 ? L.coty : L.leaf;
  const n = ATLAS_CELLS[name].length;
  return CELL_BASE[name] + (variant % n);
}

// ----------------------------------------------------------- species tables
// Flat Float32Arrays of vec4 per species (uniform arrays in the shaders).
export function speciesTables() {
  const N = SPECIES_IDS.length;
  const t = { n: N, pheno: new Float32Array(N * 4), pheno2: new Float32Array(N * 4), leafA: new Float32Array(N * 4),
    tint: new Float32Array(N * 4), aut0: new Float32Array(N * 4), aut1: new Float32Array(N * 4), aut2: new Float32Array(N * 4),
    litter: new Float32Array(N * 4), twig: new Float32Array(N * 4) };
  SPECIES_IDS.forEach((id, k) => {
    const sp = SPECIES[id], L = LOOK[id], ph = sp.pheno, o = k * 4;
    t.pheno.set([ph.brk, ph.col, ph.fall, ph.bloom ?? 0.2], o);
    t.pheno2.set([ph.bloomEnd ?? 0.3, SPECIES_DUR(sp), sp.leaf.ever ? 1 : 0, sp.leaf.fall ? 1 : 0], o);
    t.leafA.set([L.leafMode, L.droop, L.tilt, Math.max(0, BARKS.indexOf(L.bark))], o);
    t.tint.set([...L.tint, L.tile], o);
    const a = L.autumn.map(hex3);
    t.aut0.set([...a[0], 1], o); t.aut1.set([...a[1], 1], o); t.aut2.set([...a[2], 1], o);
    t.litter.set([...hex3(L.litter), 1], o); t.twig.set([...hex3(L.twig), sp.rTip], o);
  });
  return t;
}

// ------------------------------------------------------------------ frames
// tan, nrm: Float32Array(n * 3). The parent comes before the child.
export function nodeFrames(snap, out) {
  const n = snap.count, P = [snap.px, snap.py, snap.pz], par = snap.parent, mc = snap.mainChild;
  const tan = out && out.tan.length >= n * 3 ? out.tan : new Float32Array(n * 3);
  const nrm = out && out.nrm.length >= n * 3 ? out.nrm : new Float32Array(n * 3);
  const d = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = par[i];
    let x = 0, y = 1, z = 0;
    if (p >= 0) {
      x = P[0][i] - P[0][p]; y = P[1][i] - P[1][p]; z = P[2][i] - P[2][p];
      const l = Math.hypot(x, y, z);
      if (l > 1e-7) { x /= l; y /= l; z /= l; } else { x = d[p * 3]; y = d[p * 3 + 1]; z = d[p * 3 + 2]; }
    }
    d[i * 3] = x; d[i * 3 + 1] = y; d[i * 3 + 2] = z;
  }
  for (let i = 0; i < n; i++) {
    let tx = d[i * 3], ty = d[i * 3 + 1], tz = d[i * 3 + 2];
    const c = mc[i];
    if (c >= 0 && c < n) {
      tx += d[c * 3]; ty += d[c * 3 + 1]; tz += d[c * 3 + 2];
      const l = Math.hypot(tx, ty, tz);
      if (l > 1e-6) { tx /= l; ty /= l; tz /= l; } else { tx = d[i * 3]; ty = d[i * 3 + 1]; tz = d[i * 3 + 2]; }
    }
    tan[i * 3] = tx; tan[i * 3 + 1] = ty; tan[i * 3 + 2] = tz;
    const p = par[i];
    let nx = 1, ny = 0, nz = 0;
    if (p >= 0) { nx = nrm[p * 3]; ny = nrm[p * 3 + 1]; nz = nrm[p * 3 + 2]; }
    let k = nx * tx + ny * ty + nz * tz;
    nx -= k * tx; ny -= k * ty; nz -= k * tz;
    let l = Math.hypot(nx, ny, nz);
    if (l < 1e-4) { nx = -tz; ny = 0; nz = tx; l = Math.hypot(nx, ny, nz); if (l < 1e-4) { nx = 1; ny = 0; nz = 0; l = 1; } }
    nrm[i * 3] = nx / l; nrm[i * 3 + 1] = ny / l; nrm[i * 3 + 2] = nz / l;
  }
  return { tan, nrm };
}

// a quaternion [x, y, z, w] for the basis X = n, Y = t, Z = n x t
export function frameQuat(tx, ty, tz, nx, ny, nz, out, o) {
  const zx = ny * tz - nz * ty, zy = nz * tx - nx * tz, zz = nx * ty - ny * tx;
  const m00 = nx, m01 = tx, m02 = zx, m10 = ny, m11 = ty, m12 = zy, m20 = nz, m21 = tz, m22 = zz;
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = w;
}
// rotate v by quaternion q (offset o) -> out
export function quatRotate(q, o, vx, vy, vz, out) {
  const qx = q[o], qy = q[o + 1], qz = q[o + 2], qw = q[o + 3];
  const cx = qy * vz - qz * vy + qw * vx, cy = qz * vx - qx * vz + qw * vy, cz = qx * vy - qy * vx + qw * vz;
  out[0] = vx + 2 * (qy * cz - qz * cy); out[1] = vy + 2 * (qz * cx - qx * cz); out[2] = vz + 2 * (qx * cy - qy * cx);
  return out;
}

// ---------------------------------------------------------------- history
// hist: { rad: [], light: [], vigor: [], tips: [] } per simulated year.
export function createHistory() { return { rad: [], light: [], vigor: [], tips: [], last: -1 }; }
export function addToHistory(hist, snap) {
  const Y = snap.year;
  hist.rad[Y] = snap.radius; hist.light[Y] = snap.light; hist.vigor[Y] = snap.vigor; hist.tips[Y] = snap.tips;
  hist.last = Math.max(hist.last, Y);
}

// ------------------------------------------------------------- pack a year
// opts: { mode, frames, maxLeaves, keep (0..1, a share of leaves on phones) }
export function packYear(snap, hist, Y, opts = {}) {
  Y = Math.max(0, Math.min(Y, hist.last));
  const n = snap.count, mode = opts.mode || 'natural';
  const fr = opts.frames || nodeFrames(snap);
  const rad1 = hist.rad[Y], rad0 = Y > 0 ? hist.rad[Y - 1] : null, lt = hist.light[Y], vg = hist.vigor[Y], tp = hist.tips[Y];
  const plants = snap.plants;
  // visible nodes: born by the end of Y, not yet gone (a dead node shows one year)
  const remap = new Int32Array(n).fill(-1);
  const list = [];
  const Yend = Y + 1;
  for (let i = 0; i < n; i++) {
    if (snap.born[i] >= Yend || i >= rad1.length) continue;
    if (snap.died[i] < Y - 0.7) continue;
    const p = snap.parent[i];
    if (p >= 0 && remap[p] < 0) continue;
    remap[i] = list.length; list.push(i);
  }
  const m = list.length, rows = Math.max(1, Math.ceil(m / TEX_W)), size = TEX_W * rows * 4;
  const T = [0, 1, 2, 3, 4].map(k => (opts.out && opts.out[k] && opts.out[k].length >= size) ? opts.out[k] : new Float32Array(size));
  let maxOrder = 1, maxTips = 1, maxV = 1;
  for (const i of list) {
    if (snap.order[i] > maxOrder) maxOrder = snap.order[i];
    if (tp[i] > maxTips) maxTips = tp[i];
    if (vg[i] > maxV) maxV = vg[i];
  }
  const lmT = Math.log(1 + maxTips), lmV = Math.log(1 + maxV);
  for (let j = 0; j < m; j++) {
    const i = list[j], o = j * 4, p = snap.parent[i];
    const pl = plants[snap.plant[i]], sp = SPECIES[pl.species];
    T[0][o] = snap.px[i]; T[0][o + 1] = snap.py[i]; T[0][o + 2] = snap.pz[i]; T[0][o + 3] = snap.born[i];
    const rB = rad1[i], rA = rad0 && i < rad0.length ? rad0[i] : sp.rTip * 0.6;
    T[1][o] = rA; T[1][o + 1] = rB;
    const q = p >= 0 ? remap[p] : j;
    T[1][o + 2] = (p < 0 || snap.isMain[i]) ? q : -(q + 1);
    T[1][o + 3] = snap.died[i];
    frameQuat(fr.tan[i * 3], fr.tan[i * 3 + 1], fr.tan[i * 3 + 2], fr.nrm[i * 3], fr.nrm[i * 3 + 1], fr.nrm[i * 3 + 2], T[2], o);
    const c = snap.mainChild[i];
    T[3][o] = snap.s[i];
    T[3][o + 1] = c >= 0 && remap[c] >= 0 ? snap.born[c] : 1e9;
    T[3][o + 2] = lt[i] / 255;
    let v = 0;
    switch (mode) {
      case 'order': v = snap.order[i] / maxOrder; break;
      case 'flow': v = Math.log(1 + tp[i]) / lmT; break;
      case 'vigour': v = Math.log(1 + vg[i]) / lmV; break;
      case 'light': v = lt[i] / 255; break;
      default: v = 0;
    }
    T[3][o + 3] = v;
    const frond = sp.form === 'fern' ? 1 : 0, trunk = snap.order[i] === 0 && sp.form !== 'fern' ? 2 : 0;
    T[4][o] = pl.spIndex; T[4][o + 1] = snap.plant[i]; T[4][o + 2] = hash01(i); T[4][o + 3] = frond + trunk;
  }
  // leaves: the records that show in year Y (or lie as last year's litter).
  // Over opts.leafBudget, a share of the plain leaves is left out and the
  // rest drawn larger (keep), so the crown keeps its leaf area
  const Lsrc = snap.leaves, lc = snap.leafCount;
  let keep = opts.keep ?? 1;
  if (opts.leafBudget) {
    let plain = 0;
    for (let k = 0; k < lc; k++) { const o = k * LEAF_STRIDE; if (Lsrc[o + 1] <= Y && Lsrc[o + 2] >= Y - 1 && (Lsrc[o + 7] & 3) === 0 && remap[Lsrc[o]] >= 0) plain++; }
    if (plain * keep > opts.leafBudget) keep = opts.leafBudget / plain;
  }
  let cnt = 0;
  for (let k = 0; k < lc; k++) {
    const o = k * LEAF_STRIDE;
    if (Lsrc[o + 1] > Y || Lsrc[o + 2] < Y - 1) continue;
    const ever = SPECIES[plants[snap.plant[Lsrc[o]]].species].leaf.ever;
    if (Lsrc[o + 2] < Y - 1 + (ever ? -1 : 0)) continue;
    if (remap[Lsrc[o]] < 0) continue;
    if (keep < 1 && (Lsrc[o + 6] * 13.17) % 1 > keep && (Lsrc[o + 7] & 3) === 0) continue;
    cnt++;
  }
  const maxL = opts.maxLeaves ?? Infinity;
  const nL = Math.min(cnt, maxL);
  const leaves = opts.leafOut && opts.leafOut.length >= nL * 8 ? opts.leafOut : new Float32Array(Math.max(8, nL * 8));
  let w = 0;
  for (let k = 0; k < lc && w < nL; k++) {
    const o = k * LEAF_STRIDE;
    if (Lsrc[o + 1] > Y || Lsrc[o + 2] < Y - 1) continue;
    const node = Lsrc[o], j = remap[node];
    if (j < 0) continue;
    if (keep < 1 && (Lsrc[o + 6] * 13.17) % 1 > keep && (Lsrc[o + 7] & 3) === 0) continue;
    const code = Lsrc[o + 7], kind = code & 3, variant = (code >> 2) & 7, spi = code >> 5;
    const q = w * 8;
    leaves[q] = j; leaves[q + 1] = Lsrc[o + 1]; leaves[q + 2] = Lsrc[o + 2] >= OPEN ? 9999 : Lsrc[o + 2];
    leaves[q + 3] = Lsrc[o + 3] * (keep < 1 && kind === 0 ? 1 / Math.sqrt(keep) : 1);
    leaves[q + 4] = Lsrc[o + 4]; leaves[q + 5] = Lsrc[o + 5]; leaves[q + 6] = Lsrc[o + 6];
    leaves[q + 7] = kind + 4 * cellIndex(spi, kind, variant);
    w++;
  }
  // the box round what shows (for the camera and the shadow frustum)
  let x0 = Infinity, y0 = 0, z0 = Infinity, x1 = -Infinity, y1 = 0.3, z1 = -Infinity;
  for (const i of list) {
    if (snap.died[i] < Y + 0.6) continue;
    const x = snap.px[i], y = snap.py[i], z = snap.pz[i];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  if (!(x1 >= x0)) { x0 = z0 = -0.3; x1 = z1 = 0.3; }
  return { year: Y, n: m, rows, T, remap, list, leaves, leafN: w, keep, box: [x0, y0, z0, x1, y1, z1], maxOrder, mode };
}

function hash01(i) { let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; }

// ================================================================ CPU twin
// The node j of a pack at clock t: its shown position (out[0..2]) and
// radius (out[3]), with the growth of its segment, the girth, a death drop
// and the wind (wind: { k 0..1, time s, dir [x, z] }).
const TAB = speciesTables();
export function nodeShown(pk, j, t, wind, out = [0, 0, 0, 0]) {
  const T0 = pk.T[0], T1 = pk.T[1], T4 = pk.T[4], o = j * 4;
  const sp = T4[o] | 0, dur = TAB.pheno2[sp * 4 + 1];
  const pe = T1[o + 2], q = pe >= 0 ? pe : -pe - 1;
  const g = Math.min(1, Math.max(0, (t - T0[o + 3]) / dur));
  const qo = q * 4;
  let x = T0[o], y = T0[o + 1], z = T0[o + 2];
  if (q !== j) { x = T0[qo] + (x - T0[qo]) * g; y = T0[qo + 1] + (y - T0[qo + 1]) * g; z = T0[qo + 2] + (z - T0[qo + 2]) * g; }
  let r = T1[o] + (T1[o + 1] - T1[o]) * girthPhase(Math.min(1, Math.max(0, t - pk.year)));
  if (t >= pk.year + 1) r = T1[o + 1];
  const frond = (T4[o + 3] & 1) ? 1 : 0;
  const died = T1[o + 3];
  if (t > died) {
    y -= deathDrop(t - died, y, frond); r *= deathFade(t - died, frond);
    // the base of a shed branch: it breaks off its live parent
    if (q !== j && T1[qo + 3] > died + 1e-4) r = 0;
  }
  if (wind && wind.k > 0) { const w = windOffset(x, y, z, r, wind); x += w[0]; y += w[1]; z += w[2]; }
  out[0] = x; out[1] = y; out[2] = z; out[3] = g > 0 ? r : 0;
  return out;
}

// wind: a sway of the whole plant that grows with height, plus a flutter
// of thin twigs. The same in GLSL (WIND_GLSL).
const WO = [0, 0, 0];
export function windOffset(x, y, z, r, wind) {
  const k = wind.k, tm = wind.time, dx = wind.dir ? wind.dir[0] : 0.93, dz = wind.dir ? wind.dir[1] : 0.37;
  const h = Math.max(0, y);
  const sway = k * 0.012 * h * h / (1 + 0.04 * h * h) * (0.6 + 0.4 * Math.sin(tm * 0.9 + 0.13 * (x + z)));
  const flex = Math.pow(Math.min(1, 0.006 / Math.max(1e-4, r)), 0.6);
  const ph = 0.7 * (x + z) + 0.4 * y;
  const fl = k * 0.05 * flex * Math.min(1, h);
  WO[0] = dx * sway + fl * Math.sin(tm * 2.3 + ph);
  WO[1] = -0.3 * fl * Math.abs(Math.sin(tm * 1.7 + ph * 1.3));
  WO[2] = dz * sway + fl * Math.cos(tm * 2.9 + ph * 0.8);
  return WO;
}
export const WIND_GLSL = /* glsl */`
vec3 windOffset(vec3 p, float r, float k, float tm, vec2 dir) {
  float h = max(0.0, p.y);
  float sway = k * 0.012 * h * h / (1.0 + 0.04 * h * h) * (0.6 + 0.4 * sin(tm * 0.9 + 0.13 * (p.x + p.z)));
  float flex = pow(min(1.0, 0.006 / max(1e-4, r)), 0.6);
  float ph = 0.7 * (p.x + p.z) + 0.4 * p.y;
  float fl = k * 0.05 * flex * min(1.0, h);
  return vec3(dir.x * sway + fl * sin(tm * 2.3 + ph), -0.3 * fl * abs(sin(tm * 1.7 + ph * 1.3)), dir.y * sway + fl * cos(tm * 2.9 + ph * 0.8));
}
`;

// The frame at node j: tangent t, normal n, binormal b (n x t... b = t x n).
export function nodeFrame(pk, j, out = { t: [0, 1, 0], n: [1, 0, 0], b: [0, 0, 1] }) {
  quatRotate(pk.T[2], j * 4, 0, 1, 0, out.t);
  quatRotate(pk.T[2], j * 4, 1, 0, 0, out.n);
  quatRotate(pk.T[2], j * 4, 0, 0, 1, out.b);
  return out;
}

// Leaf instance k of a pack at clock t: { show, colour, fall, litter,
// o (origin), dL (along), wid (across), nL (normal), len, w, cell }, or
// null when it does not show. groundY(x, z) gives the ground height.
const ST = {}, FR = { t: [0, 1, 0], n: [1, 0, 0], b: [0, 0, 1] }, NS = [0, 0, 0, 0];
export function leafPose(pk, k, t, opts = {}) {
  const L = pk.leaves, q = k * 8, j = L[q];
  const T0 = pk.T[0], T4 = pk.T[4], o = j * 4, sp = T4[o] | 0;
  const kind = L[q + 7] & 3, cell = (L[q + 7] - kind) / 4;
  const rec = { kind, y0: L[q + 1], y1: L[q + 2], rand: L[q + 6], nodeBorn: T0[o + 3], ever: TAB.pheno2[sp * 4 + 2] > 0.5, falls: TAB.pheno2[sp * 4 + 3] > 0.5 };
  const ph = { brk: TAB.pheno[sp * 4], col: TAB.pheno[sp * 4 + 1], fall: TAB.pheno[sp * 4 + 2], bloom: TAB.pheno[sp * 4 + 3], bloomEnd: TAB.pheno2[sp * 4] };
  leafState(ph, rec, t, ST);
  if (ST.show <= 0.001) return null;
  // the node must be grown
  const g = Math.min(1, Math.max(0, (t - T0[o + 3]) / TAB.pheno2[sp * 4 + 1]));
  if (g < 1 && ST.fall < 0) return null;
  nodeShown(pk, j, t, opts.wind, NS);
  nodeFrame(pk, j, FR);
  const mode = TAB.leafA[sp * 4], droop = TAB.leafA[sp * 4 + 1], tiltK = TAB.leafA[sp * 4 + 2];
  const ang = L[q + 4], tilt = L[q + 5] * tiltK, rnd = L[q + 6], size = L[q + 3];
  const tt = FR.t, nn = FR.n, bb = FR.b;
  const side = [Math.cos(ang) * nn[0] + Math.sin(ang) * bb[0], Math.cos(ang) * nn[1] + Math.sin(ang) * bb[1], Math.cos(ang) * nn[2] + Math.sin(ang) * bb[2]];
  let dL;
  if (kind === 2) dL = [side[0], side[1] + 0.3, side[2]];
  else if (mode === 2) {     // pinna: out to the side of the rachis, level
    let sx = tt[2], sz = -tt[0]; const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;
    const s = Math.cos(ang) >= 0 ? 1 : -1;
    dL = [s * sx + 0.3 * tt[0], 0.12 + 0.3 * tt[1], s * sz + 0.3 * tt[2]];
  } else if (mode === 1) dL = [tt[0] * 0.8 + side[0] * 0.55, tt[1] * 0.8 + side[1] * 0.55 - droop * 0.4, tt[2] * 0.8 + side[2] * 0.55];
  else {
    dL = [tt[0] + (side[0] - tt[0]) * tilt, tt[1] + (side[1] - tt[1]) * tilt, tt[2] + (side[2] - tt[2]) * tilt];
    const l0 = Math.hypot(...dL) || 1; dL = dL.map(v => v / l0);
    dL[1] -= droop * (0.4 + 0.6 * ST.show) * (mode === 3 ? 1.6 : 1);
  }
  norm(dL);
  let wid = [-dL[2], 0, dL[0]];      // up x dL
  if (Math.hypot(wid[0], wid[2]) < 1e-3) wid = [nn[0], nn[1], nn[2]];
  norm(wid);
  let nL = cross(wid, dL);
  if (nL[1] < 0) { wid = wid.map(v => -v); nL = nL.map(v => -v); }
  let O = [NS[0], NS[1], NS[2]];
  if (kind === 1) {          // a flower faces out and up from its spur
    const f = norm([side[0] * 0.7 + tt[0] * 0.3, side[1] * 0.7 + 0.55, side[2] * 0.7 + tt[2] * 0.3]);
    nL = f; wid = norm(cross([0, 1, 0], f)); if (!isFinite(wid[0]) || Math.hypot(...wid) < 0.5) wid = [1, 0, 0];
    dL = norm(cross(f, wid));
    const out = 0.012 + size * 0.35;   // a flower sits out on its pedicel, clear of the leaves
    O = [O[0] + f[0] * out - dL[0] * size * 0.5, O[1] + f[1] * out - dL[1] * size * 0.5, O[2] + f[2] * out - dL[2] * size * 0.5];
  }
  // falling and lying
  if (ST.fall >= 0) {
    const gy = opts.groundY ? opts.groundY(O[0], O[2]) : 0;
    const h = Math.max(0, O[1] - gy);
    const ang2 = rnd * 40.0;
    const drift = h * (0.35 + 0.5 * rnd);
    const wd = opts.wind && opts.wind.dir ? opts.wind.dir : [0.93, 0.37];
    const gx = O[0] + wd[0] * drift + Math.cos(ang2) * 0.4 * h * 0.3, gz = O[2] + wd[1] * drift + Math.sin(ang2) * 0.4 * h * 0.3;
    const e = Math.pow(ST.fall, 1.15);
    const wob = (1 - ST.fall) * Math.min(1, h * 0.3) * 0.35;
    O = [O[0] + (gx - O[0]) * e + Math.sin(ST.fall * 9 + rnd * 6) * wob, O[1] + (gy + 0.006 + 0.01 * rnd - O[1]) * e, O[2] + (gz - O[2]) * e + Math.cos(ST.fall * 7 + rnd * 5) * wob];
    const sg = smoothstep(0.82, 1, ST.fall);
    const th = rnd * 43.7;
    const gL = [Math.cos(th), 0.04, Math.sin(th)], gW = [-Math.sin(th), 0, Math.cos(th)], gN = [0, 1, 0];
    // tumble: turn the leaf round a random axis as it falls
    const ax = norm([Math.sin(rnd * 17), 0.6, Math.cos(rnd * 23)]), a = ST.fall * (5 + 4 * rnd) * (1 - sg);
    dL = rot(dL, ax, a); wid = rot(wid, ax, a); nL = rot(nL, ax, a);
    dL = norm(mixv(dL, gL, sg)); wid = norm(mixv(wid, gW, sg)); nL = norm(mixv(nL, gN, sg));
    if (kind === 1) O[1] = Math.max(O[1], gy + 0.004);
  }
  const C = CELLS[cell];
  const len = size * ST.show * (ST.fall >= 1 ? 0.75 + 0.25 * ST.litter : 1) * (kind === 1 ? 1 : 1 - 0.1 * ST.colour * (rec.falls ? 0 : 1));
  return { show: ST.show, colour: ST.colour, fall: ST.fall, litter: ST.litter, o: O, dL, wid, nL, len, w: len * C[4], cell, kind, sp, rand: rnd, node: j, fold: (1 - ST.show) * 1.1 + 0.12, curl: 0.1 + 0.1 * rnd };
}
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function mixv(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rot(v, k, a) {   // Rodrigues
  const c = Math.cos(a), s = Math.sin(a), d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2], x = cross(k, v);
  return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)];
}

export { TAB as SPECIES_TABLE };
