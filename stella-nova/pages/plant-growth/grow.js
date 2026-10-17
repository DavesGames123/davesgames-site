// ============================================================================
//  PLANT GROWTH  ·  self-organising tree model, year by year (DOM-free)
// ----------------------------------------------------------------------------
//  Our own code after W. Palubicki, K. Horel, S. Longay, A. Runions, B. Lane,
//  R. Mech, P. Prusinkiewicz, "Self-organizing tree models for image
//  synthesis", ACM Transactions on Graphics 28(3), SIGGRAPH 2009. The model
//  grows a plant one year (one growth cycle) at a time:
//
//   1. LIGHT. A voxel grid holds shadow. Each leafy node casts a pyramid of
//      shadow down: a voxel k layers below gets a * b^-k, over (2k+1)^2
//      voxels (the "shadow propagation" method of the paper). A bud gets the
//      light Q = clamp((C - s + a_self) / C, 0, 1) from the shadow s at its
//      voxel. Several plants share one grid, so they compete for light.
//   2. BASIPETAL PASS. Q flows from the buds down to the base. At each node
//      it is kept in two sums: Qm (the main axis) and Ql (the laterals).
//   3. ALLOCATION (Borchert and Honda 1984, as in the paper). The base gets
//      the resource v = alpha * Q_base. At each node it divides:
//        v_m = v (lambda Qm) / (lambda Qm + (1 - lambda) Ql),  v_l = v - v_m
//      lambda is the apical dominance of the species. Each lateral gets a
//      share of v_l in proportion to its Q.
//   4. BUD FATE. A bud with v >= 1 grows a shoot of n = floor(v) metamers
//      (internode, leaf, axillary buds), each of length L(age) * v / n. A
//      bud with v < 1 stays dormant, and dies after budLife years.
//   5. DIRECTION. Each new metamer turns toward
//        d = normalise(d_prev + xi * V + tropisms)
//      V points to the least shaded voxels in a cone round d_prev (the
//      optimal growth direction). The tropisms: up (negative gravitropism,
//      stronger on the leader), plagiotropism (laterals stay level, as in a
//      spruce) and positive gravitropism (willow and birch shoots hang).
//   6. SHEDDING. A lateral branch whose light per node Q / n falls below
//      shed.q dies, and it falls in the late winter. A plant that gets too
//      little light for three years stops growing (suppressed in a grove).
//   7. SECONDARY GROWTH. The pipe model each year: r^n = sum of the child
//      r^n, with a twig radius at each tip. A radius never gets smaller.
//
//  The year has a calendar (season.js). A shoot breaks bud in spring and
//  its metamers extend one after the other (born, dur), so the renderer can
//  show the shoot grow at its tip. Leaves come in groups per node with a
//  window of years [y0, y1]: a deciduous node is leafy while it is young,
//  lit and thin; spurs on lit older wood keep leaves too. Flowers use the
//  same groups. Ferns use their own rule (fronds from a crown each spring).
//
//  The module has no DOM and no THREE. sim-worker.js runs it off the main
//  thread; tests.mjs, mesh.js and diagram.js call it directly.
//
//  USE
//    const sim = createSim({ species: 'oak', seed: 7 });
//    while (!sim.done) sim.stepYear();
//    sim.count, sim.px/py/pz, sim.parent, sim.born, sim.died, sim.radius ...
//    sim.radHist[y]           radius of each node at the end of year y
//    sim.leaves, sim.leafCount (LEAF_STRIDE floats per leaf)
//    sim.snapshot()           plain arrays for the renderer (one year)
//    growLife('oak', { seed }) the whole life, in one call
//
//  grep -n targets
//    species presets ....... "export const SPECIES"
//    stand layouts ......... "export function standLayout"
//    the model ............. "export function createSim"
//    shadow grid ........... "function castAll"
//    one year .............. "function stepYear"
//    allocation ............ "// 3. Borchert-Honda"
//    shoot growth .......... "function growShoot"
//    phyllotaxis ........... "function addLateralBuds"
//    shedding .............. "// 4. shedding"
//    pipe model ............ "function pipeModel"
//    leaf windows .......... "function updateLeafGroups"
//    fern fronds ........... "function stepFern"
//    snapshot for the GPU .. "function snapshot"
// ============================================================================
import { rng } from '../../lib/dla-engine.js';

// Floats per leaf record in sim.leaves:
//   0 node   1 y0 (first year)   2 y1 (last year, OPEN while in use)
//   3 size (m)   4 angle round the twig (rad)   5 tilt from the twig (0..1)
//   6 rand (0..1)   7 code = kind + 4 * variant + 32 * species index
// kind: 0 leaf, 1 flower, 2 cotyledon. variant picks the atlas cell.
export const LEAF_STRIDE = 8;
export const OPEN = 10000;
export const KIND = { leaf: 0, flower: 1, cotyledon: 2 };

const D2R = Math.PI / 180;

// ---------------------------------------------------------------- species
// L: internode length [age 0, mature, years to mature] in metres.
// alpha, lambda: Borchert-Honda. nmax: metamers per shoot at most.
// phyl: phyllotaxis. type spiral | decussate | distichous | whorl; div
//   (deg), theta (branch angle, deg), tip (extra buds at a shoot end),
//   whorl (buds in a whorl), latWhorl (buds at the end of a lateral shoot),
//   inner (chance of a bud on an inner node of a whorled shoot).
// dir: xi (light seeking), up0 (leader up), up (laterals up), plagio
//   (laterals level), droop (shoots hang) from order droopOrder.
// shed: q (light per node below which a branch dies), age (years first).
// leaf: per (leaves per node), age (years a node stays leafy), q (light
//   for leaves), rMax (m, a thicker node has no leaves), size (m), var
//   (atlas variants), ever (evergreen), life (years of a needle), fall
//   (leaves drop in autumn), spur (extra leaves on lit old wood).
// flower: per, size, from (first year), at: 'spur' | 'tip'.
// pheno: brk (bud break), col (autumn colour), fall (leaf fall), in years.
// size: h, r (a mature plant, metres), for the grid and the camera.
export const SPECIES = {
  oak: {
    label: 'English oak', latin: 'Quercus robur', form: 'tree', years: 42,
    kind: 'broad crown, late bud break, lobed leaves, russet autumn',
    L: [0.05, 0.3, 14], alpha: 1.9, lambda: [0.6, 0.5], nmax: 5, rTip: 0.0035, pipe: 2.7,
    phyl: { type: 'spiral', div: 137.5, theta: 52, tip: 2 },
    dir: { xi: 0.12, up0: 0.3, up: 0.0, plagio: 0.25, droop: 0.0, droopOrder: 99 },
    shed: { q: 0.11, age: 2 },
    leaf: { per: 5, age: 2, q: 0.14, rMax: 0.013, size: 0.15, var: 4, ever: false, fall: true, spur: 3 },
    flower: null,
    pheno: { brk: 0.27, col: 0.70, fall: 0.79 },
    clear: 2.2,
    size: { h: 14, r: 7.5 },
  },
  maple: {
    label: 'Norway maple', latin: 'Acer platanoides', form: 'tree', years: 38,
    kind: 'opposite buds, dense round crown, red and gold autumn',
    L: [0.05, 0.3, 12], alpha: 2.1, lambda: [0.62, 0.52], nmax: 5, rTip: 0.0035, pipe: 2.7,
    phyl: { type: 'decussate', theta: 45, tip: 0 },
    dir: { xi: 0.14, up0: 0.34, up: 0.04, plagio: 0.12, droop: 0.0, droopOrder: 99 },
    shed: { q: 0.12, age: 2 },
    leaf: { per: 4, age: 2, q: 0.1, rMax: 0.014, size: 0.2, var: 4, ever: false, fall: true, spur: 3 },
    flower: null,
    pheno: { brk: 0.24, col: 0.68, fall: 0.77 },
    clear: 2,
    size: { h: 14, r: 6.5 },
  },
  birch: {
    label: 'Silver birch', latin: 'Betula pendula', form: 'tree', years: 34,
    kind: 'slender leader, hanging twigs, white bark, gold autumn',
    L: [0.05, 0.28, 10], latL: 0.75, alpha: 2.2, lambda: [0.64, 0.55], nmax: 6, rTip: 0.0028, pipe: 2.4,
    phyl: { type: 'spiral', div: 160, theta: 36, tip: 1 },
    dir: { xi: 0.2, up0: 0.5, up: 0.12, plagio: 0.0, droop: [0, 0, 0.3, 0.45], droopOrder: 2 },
    shed: { q: 0.12, age: 2 },
    leaf: { per: 5, age: 2, q: 0.1, rMax: 0.012, size: 0.105, var: 3, ever: false, fall: true, spur: 3 },
    flower: null,
    pheno: { brk: 0.22, col: 0.66, fall: 0.75 },
    clear: 3,
    size: { h: 18, r: 4.5 },
  },
  conifer: {
    label: 'Norway spruce', latin: 'Picea abies', form: 'tree', years: 40,
    kind: 'strong leader, whorls of level branches, evergreen needles',
    L: [0.04, 0.3, 12], latL: 0.32, alpha: 2.0, lambda: [0.7, 0.64], nmax: 4, rTip: 0.0035, pipe: 2.4,
    phyl: { type: 'whorl', whorl: 5, latWhorl: 2, theta: 76, inner: 0.45, div: 137.5 },
    dir: { xi: 0.1, up0: 1.2, up: 0.02, plagio: 0.6, droop: [0, 0.07, 0.28, 0.3], droopOrder: 1 },
    shed: { q: 0.1, age: 3 },
    leaf: { per: 5, age: 7, q: 0.05, rMax: 0.022, size: 0.3, var: 2, ever: true, life: 7, fall: false, spur: 0 },
    flower: null,
    pheno: { brk: 0.3, col: 2, fall: 2 },
    size: { h: 24, r: 4 },
  },
  willow: {
    label: 'Weeping willow', latin: 'Salix babylonica', form: 'tree', years: 30,
    kind: 'long hanging shoots, narrow leaves, early yellow autumn',
    L: [0.06, 0.32, 9], latL: 0.7, alpha: 2.6, lambda: [0.58, 0.48], nmax: 6, rTip: 0.003, pipe: 2.4,
    phyl: { type: 'spiral', div: 137.5, theta: 40, tip: 3 },
    dir: { xi: 0.12, up0: 0.4, up: 0.15, plagio: 0.0, droop: [0, 0, 0.06, 0.3, 0.95], droopOrder: 2 },
    hang: { order: 4, p: 0.7 },
    shed: { q: 0.05, age: 3, hangAge: 5 },
    leaf: { per: 9, age: 3, q: 0.04, rMax: 0.013, size: 0.19, var: 2, ever: false, fall: true, spur: 3 },
    flower: null,
    pheno: { brk: 0.2, col: 0.67, fall: 0.8 },
    clear: 1.8,
    size: { h: 11, r: 7 },
  },
  cherry: {
    label: 'Japanese cherry', latin: 'Prunus serrulata', form: 'tree', years: 26,
    kind: 'spreading vase, spring blossom on spurs, red autumn',
    L: [0.05, 0.27, 9], alpha: 2.1, lambda: [0.58, 0.48], nmax: 5, rTip: 0.0035, pipe: 2.7,
    phyl: { type: 'spiral', div: 137.5, theta: 50, tip: 2 },
    dir: { xi: 0.14, up0: 0.3, up: 0.1, plagio: 0.05, droop: 0.0, droopOrder: 99 },
    shed: { q: 0.11, age: 2 },
    leaf: { per: 4, age: 2, q: 0.13, rMax: 0.013, size: 0.14, var: 3, ever: false, fall: true, spur: 3 },
    flower: { per: 6, size: 0.15, from: 3, at: 'spur', minAge: 1, maxAge: 8, p: 0.9, q: 0.18 },
    pheno: { brk: 0.23, col: 0.67, fall: 0.77, bloom: 0.17, bloomEnd: 0.27 },
    clear: 1,
    size: { h: 7.5, r: 5 },
  },
  bush: {
    label: 'Azalea', latin: 'Rhododendron sp.', form: 'shrub', years: 14,
    kind: 'many stems from the base, magenta flower trusses in May',
    L: [0.03, 0.11, 6], alpha: 2.2, lambda: [0.47, 0.47], nmax: 4, rTip: 0.002, pipe: 2.4,
    phyl: { type: 'spiral', div: 137.5, theta: 55, tip: 3 },
    dir: { xi: 0.12, up0: 0.12, up: 0.02, plagio: 0.3, droop: 0.0, droopOrder: 99 },
    shed: { q: 0.06, age: 2 },
    leaf: { per: 6, age: 3, q: 0.035, rMax: 0.008, size: 0.07, var: 3, ever: false, fall: true, spur: 3 },
    flower: { per: 9, size: 0.12, from: 2, at: 'tip', minAge: 1, maxAge: 3, p: 1, q: 0.12 },
    pheno: { brk: 0.25, col: 0.72, fall: 0.82, bloom: 0.3, bloomEnd: 0.4 },
    basal: { n: 7, theta: 40, perYear: 2 },
    size: { h: 1.7, r: 1.4 },
  },
  fern: {
    label: 'Ostrich fern', latin: 'Matteuccia struthiopteris', form: 'fern', years: 8,
    kind: 'fronds unroll from one crown each spring, collapse in autumn',
    L: [0.04, 0.06, 4], alpha: 1, lambda: [0.5, 0.5], nmax: 1, rTip: 0.0025, pipe: 2.4,
    phyl: { type: 'spiral', theta: 40 }, dir: { xi: 0, up0: 0, up: 0, plagio: 0, droop: 0, droopOrder: 99 },
    shed: { q: 0, age: 99 },
    leaf: { per: 2, age: 0, q: 0, rMax: 1, size: 0.15, var: 2, ever: false, fall: false, spur: 0 },
    flower: null,
    fern: { fronds: [3, 14], len: [0.35, 1.25], nodes: 22 },
    pheno: { brk: 0.24, col: 0.7, fall: 0.8 },
    size: { h: 1.2, r: 1.1 },
  },
};
export const SPECIES_IDS = Object.keys(SPECIES);
export const TREE_IDS = SPECIES_IDS.filter(id => SPECIES[id].form === 'tree');

// The internode length at a plant age (years).
export function internode(sp, age) {
  const [l0, l1, a1] = sp.L, f = Math.min(1, Math.max(0, age / a1));
  return l0 + (l1 - l0) * f * f * (3 - 2 * f);
}

// Plant layouts. single: one plant at the origin. grove: the species and
// four more of it round it. mixed: a woodland edge of several species,
// with ferns and azaleas in the understorey.
export function standLayout(stand, species, seed = 1) {
  const r = rng((seed * 7919 + 13) >>> 0 || 1), out = [];
  const put = (sp, x, z) => out.push({ species: sp, x, z, seed: 1 + Math.floor(r() * 2147483646) });
  if (stand === 'grove') {
    put(species, 0, 0);
    const R = Math.max(1.4, SPECIES[species].size.r * 0.95), a0 = r() * Math.PI * 2;
    for (let k = 0; k < 4; k++) {
      const a = a0 + k * Math.PI / 2 + (r() - 0.5) * 0.6, d = R * (0.85 + 0.35 * r());
      put(species, Math.cos(a) * d, Math.sin(a) * d);
    }
  } else if (stand === 'mixed') {
    const trees = TREE_IDS.filter(id => id !== species), a0 = r() * Math.PI * 2;
    put(SPECIES[species].form === 'tree' ? species : 'oak', 0, 0);
    for (let k = 0; k < 4; k++) {
      const a = a0 + k * Math.PI / 2 + (r() - 0.5) * 0.7, d = 5.5 + 2.5 * r();
      put(trees[Math.floor(r() * trees.length)], Math.cos(a) * d, Math.sin(a) * d);
    }
    for (let k = 0; k < 4; k++) {
      const a = r() * Math.PI * 2, d = 2.2 + 4.5 * r();
      put(k % 2 ? 'bush' : 'fern', Math.cos(a) * d, Math.sin(a) * d);
    }
  } else put(species, 0, 0);
  return out;
}

// ------------------------------------------------------------ small maths
function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; }
// a unit vector at angle theta from d, at angle phi round it; ref gives
// phi = 0 (a horizontal direction across d when it can).
function coneDir(d, theta, phi, out, flat) {
  let ux, uy, uz;
  if (flat) { ux = -d[1]; uy = d[0]; uz = 0; }
  else { ux = -d[2]; uy = 0; uz = d[0]; if (ux * ux + uz * uz < 1e-6) { ux = 1; uy = 0; uz = 0; } }
  let l = Math.hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l;
  // w = d x u
  const wx = d[1] * uz - d[2] * uy, wy = d[2] * ux - d[0] * uz, wz = d[0] * uy - d[1] * ux;
  const c = Math.cos(theta), s = Math.sin(theta), cp = Math.cos(phi), sp = flat ? 0 : Math.sin(phi);
  const fp = flat ? Math.sign(Math.cos(phi)) || 1 : cp;
  out[0] = c * d[0] + s * (fp * ux + sp * wx);
  out[1] = c * d[1] + s * (fp * uy + sp * wy);
  out[2] = c * d[2] + s * (fp * uz + sp * wz);
  return norm3(out);
}

// 26 unit directions to the neighbour voxels, for the optimal direction.
const NB = [];
for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
  if (!x && !y && !z) continue; const l = Math.hypot(x, y, z); NB.push([x / l, y / l, z / l, x, y, z]);
}

// =================================================================== model
// opts: species, seed, stand ('single' | 'grove' | 'mixed') or plants
// ([{ species, x, z, seed }]), maxNodes, flat (2D, z = 0, for the diagram),
// years (override), shadow { a, b, q, C }.
export function createSim(opts = {}) {
  const flat = !!opts.flat;
  const seed = opts.seed ?? 1;
  const rand = rng(seed);
  const tune = opts.tune || {};
  const plantsIn = opts.plants || standLayout(opts.stand || 'single', SPECIES[opts.species] ? opts.species : 'oak', seed);
  const maxNodes = opts.maxNodes ?? 60000, hardCap = opts.hardCap ?? maxNodes * 4;
  const SH = Object.assign({ a: 1, b: 2.0, q: 6, C: 8, wood: 0.12, leafW: 0.35, side: 0.55 }, opts.shadow || {});

  // ---- plants
  const plants = plantsIn.map((p, k) => {
    const sp = SPECIES[p.species] || SPECIES.oak;
    return {
      k, id: SPECIES[p.species] ? p.species : 'oak', sp, spIndex: SPECIES_IDS.indexOf(SPECIES[p.species] ? p.species : 'oak'),
      x: p.x || 0, z: flat ? 0 : (p.z || 0), rand: rng(p.seed || (k + 1) * 977), root: -1,
      alive: true, weak: 0, start: 0, nodes: 0, leafy: 0,
      // the model sliders of the page: multipliers on the presets
      alpha: sp.alpha * (tune.alpha ?? 1), xi: sp.dir.xi * (tune.xi ?? 1),
      lambda: sp.lambda.map(v => Math.min(0.95, Math.max(0.05, v * (tune.lambda ?? 1)))),
    };
  });
  const years = opts.years ?? Math.max(...plants.map(p => p.sp.years));

  // ---- the shadow grid: voxel = the longest mature internode
  const vox = opts.voxel ?? Math.max(...plants.map(p => p.sp.L[1])) * 1.0;
  let gx0 = Infinity, gx1 = -Infinity, gz0 = Infinity, gz1 = -Infinity, gy1 = 0;
  for (const p of plants) {
    const R = p.sp.size.r * 1.35 + 1, H = p.sp.size.h * 1.45 + 1;
    gx0 = Math.min(gx0, p.x - R); gx1 = Math.max(gx1, p.x + R);
    gz0 = Math.min(gz0, p.z - R); gz1 = Math.max(gz1, p.z + R); gy1 = Math.max(gy1, H);
  }
  const NX = Math.ceil((gx1 - gx0) / vox) + 1, NY = Math.ceil(gy1 / vox) + 1;
  const NZ = flat ? 1 : Math.ceil((gz1 - gz0) / vox) + 1;
  const G = new Float32Array(NX * NY * NZ);
  const powB = new Float32Array(SH.q + 1);
  for (let k = 0; k <= SH.q; k++) powB[k] = SH.a * Math.pow(SH.b, -k);
  const vx = x => Math.min(NX - 1, Math.max(0, Math.floor((x - gx0) / vox)));
  const vy = y => Math.min(NY - 1, Math.max(0, Math.floor(y / vox)));
  const vz = z => flat ? 0 : Math.min(NZ - 1, Math.max(0, Math.floor((z - gz0) / vox)));
  const gIdx = (ix, iy, iz) => (iy * NZ + iz) * NX + ix;
  function shadowAt(x, y, z) { return G[gIdx(vx(x), vy(y), vz(z))]; }
  function cast(x, y, z, w) {
    const cx = vx(x), cy = vy(y), cz = vz(z);
    for (let k = 0; k <= SH.q; k++) {
      const iy = cy - k; if (iy < 0) break;
      const s = powB[k] * w;
      const z0 = flat ? 0 : Math.max(0, cz - k), z1 = flat ? 0 : Math.min(NZ - 1, cz + k);
      const x0 = Math.max(0, cx - k), x1 = Math.min(NX - 1, cx + k);
      for (let iz = z0; iz <= z1; iz++) {
        const row = (iy * NZ + iz) * NX;
        for (let ix = x0; ix <= x1; ix++) G[row + ix] += s;
      }
    }
  }
  // light (0..1) at a point; self is the shadow the point casts on itself
  function exposure(x, y, z, self) {
    const s = shadowAt(x, y, z) - self;
    const q = (SH.C - Math.max(0, s)) / SH.C;
    return q < 0 ? 0 : q > 1 ? 1 : q;
  }

  // ---- nodes (one per metamer end point; a root node per plant)
  let cap = 1024, count = 0;
  let px = new Float32Array(cap), py = new Float32Array(cap), pz = new Float32Array(cap);
  let dx = new Float32Array(cap), dy = new Float32Array(cap), dz = new Float32Array(cap);
  let parent = new Int32Array(cap), mainChild = new Int32Array(cap), isMain = new Uint8Array(cap);
  let born = new Float32Array(cap), died = new Float32Array(cap), year0 = new Int16Array(cap);
  let order = new Uint8Array(cap), plantOf = new Uint8Array(cap), sArc = new Float32Array(cap);
  let radius = new Float32Array(cap), light = new Float32Array(cap), vigor = new Float32Array(cap);
  let tips = new Float32Array(cap), leafy = new Uint8Array(cap), dead = new Uint8Array(cap);
  let Qm = new Float32Array(cap), Ql = new Float32Array(cap), Qt = new Float32Array(cap);
  let vin = new Float32Array(cap), vm = new Float32Array(cap), vl = new Float32Array(cap);
  let nSub = new Float32Array(cap), pacc = new Float64Array(cap), lgroup = new Int32Array(cap), fgroup = new Int32Array(cap);
  let nodeLen = new Float32Array(cap), shootEnd = new Uint8Array(cap), lightRel = new Float32Array(cap);
  function growNodes() {
    cap *= 2;
    const g = (a, T) => { const b = new T(cap); b.set(a); return b; };
    px = g(px, Float32Array); py = g(py, Float32Array); pz = g(pz, Float32Array);
    dx = g(dx, Float32Array); dy = g(dy, Float32Array); dz = g(dz, Float32Array);
    parent = g(parent, Int32Array); mainChild = g(mainChild, Int32Array); isMain = g(isMain, Uint8Array);
    born = g(born, Float32Array); died = g(died, Float32Array); year0 = g(year0, Int16Array);
    order = g(order, Uint8Array); plantOf = g(plantOf, Uint8Array); sArc = g(sArc, Float32Array);
    radius = g(radius, Float32Array); light = g(light, Float32Array); vigor = g(vigor, Float32Array);
    tips = g(tips, Float32Array); leafy = g(leafy, Uint8Array); dead = g(dead, Uint8Array);
    Qm = g(Qm, Float32Array); Ql = g(Ql, Float32Array); Qt = g(Qt, Float32Array);
    vin = g(vin, Float32Array); vm = g(vm, Float32Array); vl = g(vl, Float32Array);
    nSub = g(nSub, Float32Array); pacc = g(pacc, Float64Array); lgroup = g(lgroup, Int32Array); fgroup = g(fgroup, Int32Array);
    nodeLen = g(nodeLen, Float32Array); shootEnd = g(shootEnd, Uint8Array); lightRel = g(lightRel, Float32Array);
  }
  function addNode(x, y, z, par, main, b, yr, pl) {
    if (count === cap) growNodes();
    const i = count++;
    px[i] = x; py[i] = y; pz[i] = z; parent[i] = par; isMain[i] = main ? 1 : 0; mainChild[i] = -1;
    born[i] = b; died[i] = OPEN; year0[i] = yr; plantOf[i] = pl.k; dead[i] = 0; leafy[i] = 0;
    lgroup[i] = -1; fgroup[i] = -1; light[i] = 1; vigor[i] = 0; tips[i] = 1;
    if (par >= 0) {
      const ex = x - px[par], ey = y - py[par], ez = z - pz[par], l = Math.hypot(ex, ey, ez) || 1e-6;
      dx[i] = ex / l; dy[i] = ey / l; dz[i] = ez / l; nodeLen[i] = l;
      sArc[i] = sArc[par] + l;
      order[i] = Math.min(250, order[par] + (main ? 0 : 1));
      if (main) mainChild[par] = i;
    } else { dx[i] = 0; dy[i] = 1; dz[i] = 0; nodeLen[i] = 0; sArc[i] = 0; order[i] = 0; }
    radius[i] = pl.sp.rTip * 0.6;
    pl.nodes++;
    return i;
  }

  // ---- buds
  let bcap = 1024, bcount = 0;
  let bNode = new Int32Array(bcap), bDir = new Float32Array(bcap * 3), bTerm = new Uint8Array(bcap);
  let bAge = new Uint8Array(bcap), bQ = new Float32Array(bcap), bV = new Float32Array(bcap), bOrd = new Uint8Array(bcap);
  function addBud(node, d, term, ord) {
    if (bcount === bcap) {
      bcap *= 2;
      const g = (a, T, k = 1) => { const b = new T(bcap * k); b.set(a); return b; };
      bNode = g(bNode, Int32Array); bDir = g(bDir, Float32Array, 3); bTerm = g(bTerm, Uint8Array);
      bAge = g(bAge, Uint8Array); bQ = g(bQ, Float32Array); bV = g(bV, Float32Array); bOrd = g(bOrd, Uint8Array);
    }
    const b = bcount++;
    bNode[b] = node; bDir[b * 3] = d[0]; bDir[b * 3 + 1] = d[1]; bDir[b * 3 + 2] = d[2];
    bTerm[b] = term ? 1 : 0; bAge[b] = 0; bQ[b] = 0; bV[b] = 0; bOrd[b] = ord;
    return b;
  }
  // keep the buds that pass keep(b)
  function compactBuds(keep) {
    let w = 0;
    for (let b = 0; b < bcount; b++) {
      if (!keep(b)) continue;
      if (w !== b) {
        bNode[w] = bNode[b]; bDir[w * 3] = bDir[b * 3]; bDir[w * 3 + 1] = bDir[b * 3 + 1]; bDir[w * 3 + 2] = bDir[b * 3 + 2];
        bTerm[w] = bTerm[b]; bAge[w] = bAge[b]; bQ[w] = bQ[b]; bV[w] = bV[b]; bOrd[w] = bOrd[b];
      }
      w++;
    }
    bcount = w;
  }

  // ---- leaf and flower groups: records of LEAF_STRIDE floats
  let lcap = 4096, lcount = 0, leaves = new Float32Array(lcap * LEAF_STRIDE);
  function addLeaf(node, y0, size, ang, tilt, kind, variant, spIndex) {
    if (lcount === lcap) { lcap *= 2; const n = new Float32Array(lcap * LEAF_STRIDE); n.set(leaves); leaves = n; }
    const o = lcount++ * LEAF_STRIDE;
    leaves[o] = node; leaves[o + 1] = y0; leaves[o + 2] = OPEN; leaves[o + 3] = size;
    leaves[o + 4] = ang; leaves[o + 5] = tilt; leaves[o + 6] = rand(); leaves[o + 7] = kind + 4 * variant + 32 * spIndex;
    return lcount - 1;
  }
  // group start index -> count, so a whole group closes at once
  const groupLen = new Map();

  const st = { year: 0, done: false, stats: [] };
  const radHist = [], lightHist = [], vigorHist = [], tipsHist = [], yearOff = [0];

  // ---- germination: a root node, a short hypocotyl and cotyledons
  const tmp = [0, 0, 0], tmp2 = [0, 0, 0];
  for (const pl of plants) {
    const sp = pl.sp, r = pl.rand, g0 = sp.pheno.brk - 0.05 + (r() - 0.5) * 0.02;
    pl.germ = g0;
    pl.root = addNode(pl.x, 0, pl.z, -1, true, g0, 0, pl);
    if (sp.form === 'fern') { pl.fern = { last: pl.root }; continue; }
    // the hypocotyl: two short internodes, then the cotyledons
    const hl = sp.form === 'shrub' ? 0.02 : 0.03;
    let top = pl.root;
    for (let k = 0; k < 2; k++) top = addNode(pl.x + (r() - 0.5) * 0.004, hl * (k + 1), pl.z + (flat ? 0 : (r() - 0.5) * 0.004), top, true, g0 + 0.008 * k, 0, pl);
    pl.coty = top;
    const nc = sp.id === 'conifer' || pl.id === 'conifer' ? 6 : 2, a0 = r() * Math.PI * 2;
    for (let k = 0; k < nc; k++) {
      const li = addLeaf(top, 0, nc > 2 ? 0.045 : 0.05, flat ? (k % 2) * Math.PI : a0 + k * 2 * Math.PI / nc, 0.85, KIND.cotyledon, 0, pl.spIndex);
      leaves[li * LEAF_STRIDE + 2] = 1;          // cotyledons wither in the second year
    }
    addBud(top, [0, 1, 0], true, 0);
    if (sp.basal) {   // a shrub: buds at the base start many stems
      for (let k = 0; k < sp.basal.n; k++) {
        coneDir([0, 1, 0], sp.basal.theta * D2R * (0.7 + 0.6 * r()), r() * Math.PI * 2, tmp, flat);
        addBud(pl.root, tmp, false, 1);
      }
    }
  }

  // ---- side light: diffuse sky light from the horizon reaches the outer
  //      1.2 m of a crown (the pyramid only sends light down). Per plant, the
  //      crown hull is the largest horizontal reach in each band of height
  //      (0.5 m) and each of 16 sectors; a node near it gets side light, less
  //      when the shadow grid there is deep (a neighbour's crown).
  const SB = 0.5, SS = 16;
  let hull = null;
  function sideLightPrep() {
    let maxB = 1;
    for (let i = 0; i < count; i++) if (!dead[i]) maxB = Math.max(maxB, Math.floor(py[i] / SB) + 2);
    hull = plants.map(() => new Float32Array(maxB * SS));
    for (let i = 0; i < count; i++) {
      if (dead[i]) continue;
      const pl = plants[plantOf[i]], ex = px[i] - pl.x, ez = pz[i] - pl.z;
      const b = Math.floor(py[i] / SB), sec = (Math.floor((Math.atan2(ez, ex) / (2 * Math.PI) + 1) * SS) % SS);
      const H = hull[pl.k], r = Math.hypot(ex, ez);
      if (r > H[b * SS + sec]) H[b * SS + sec] = r;
    }
    hull.bands = maxB;
  }
  function sideLight(x, y, z, k, s) {
    if (!hull || flat) return 0;
    const pl = plants[k], ex = x - pl.x, ez = z - pl.z, H = hull[k], nb = hull.bands;
    const b = Math.floor(y / SB), sec = (Math.floor((Math.atan2(ez, ex) / (2 * Math.PI) + 1) * SS) % SS);
    let rm = 0;
    for (let db = -1; db <= 1; db++) {
      const bb = b + db; if (bb < 0 || bb >= nb) continue;
      for (let ds = -1; ds <= 1; ds++) rm = Math.max(rm, H[bb * SS + ((sec + ds + SS) % SS)]);
    }
    const r = Math.hypot(ex, ez);
    const edge = Math.min(1, Math.max(0, 1 - (rm - r) / 1.2));
    return SH.side * edge * Math.max(0, 1 - s / (4 * SH.C));
  }

  // ---- the shadow grid from the leafy nodes (and a little from the wood)
  function castAll() {
    G.fill(0);
    for (let i = 0; i < count; i++) {
      if (dead[i]) continue;
      const w = leafy[i] ? 1 : SH.wood;
      if (w > 0) cast(px[i], py[i], pz[i], w);
    }
  }

  // ---- the optimal growth direction: toward the least shade near p
  const Vtmp = [0, 0, 0];
  function optimalDir(x, y, z, d, out) {
    let sx = 0, sy = 0, sz = 0;
    const cx = vx(x), cy = vy(y), cz = vz(z);
    let smin = Infinity;
    for (const n of NB) {
      if (flat && n[5] !== 0) continue;
      const c = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
      if (c < 0.2) continue;                       // a cone of about 78 degrees
      const ix = cx + 2 * n[3], iy = cy + 2 * n[4], iz = cz + 2 * n[5];
      if (ix < 0 || iy < 0 || iz < 0 || ix >= NX || iy >= NY || iz >= NZ) { smin = Math.min(smin, 0); continue; }
      smin = Math.min(smin, G[gIdx(ix, iy, iz)]);
    }
    for (const n of NB) {
      if (flat && n[5] !== 0) continue;
      const c = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
      if (c < 0.2) continue;
      const ix = cx + 2 * n[3], iy = cy + 2 * n[4], iz = cz + 2 * n[5];
      const s = (ix < 0 || iy < 0 || iz < 0 || ix >= NX || iy >= NY || iz >= NZ) ? 0 : G[gIdx(ix, iy, iz)];
      const w = Math.exp(-(s - smin) * 1.2);
      sx += n[0] * w; sy += n[1] * w; sz += n[2] * w;
    }
    out[0] = sx; out[1] = sy; out[2] = sz;
    const l = Math.hypot(sx, sy, sz);
    if (l < 1e-6) { out[0] = d[0]; out[1] = d[1]; out[2] = d[2]; } else { out[0] /= l; out[1] /= l; out[2] /= l; }
    return out;
  }

  // ---- phyllotaxis: the lateral buds at a new node
  function addLateralBuds(pl, node, d, k, n, shoot, ord) {
    const P = pl.sp.phyl, r = pl.rand, last = k === n - 1;
    const th = P.theta * D2R;
    const jit = () => (r() - 0.5) * 0.25;
    switch (P.type) {
      case 'decussate': {
        const phi = shoot.phi + (k % 2) * Math.PI / 2;
        for (let j = 0; j < 2; j++) addBud(node, coneDir(d, th + jit(), phi + j * Math.PI, tmp, flat), false, ord + 1);
        break;
      }
      case 'distichous': {
        addBud(node, coneDir(d, th + jit(), (k % 2) * Math.PI, tmp, flat), false, ord + 1);
        break;
      }
      case 'whorl': {
        if (last) {
          const m = ord === 0 ? P.whorl : P.latWhorl;
          for (let j = 0; j < m; j++) {
            const phi = ord === 0 ? shoot.phi + j * 2 * Math.PI / m + jit() : j * Math.PI + jit() * 0.5;
            addBud(node, coneDir(d, (ord === 0 ? th : th * 0.75) + jit(), phi, tmp, flat), false, ord + 1);
          }
        } else if (r() < P.inner) {
          const phi = ord === 0 ? shoot.phi + k * P.div * D2R : (k % 2) * Math.PI;
          addBud(node, coneDir(d, th * 0.8 + jit(), phi, tmp, flat), false, ord + 1);
        }
        break;
      }
      default: {   // spiral
        addBud(node, coneDir(d, th + jit(), shoot.phi + k * P.div * D2R, tmp, flat), false, ord + 1);
      }
    }
    if (last && P.tip) for (let j = 0; j < P.tip; j++) addBud(node, coneDir(d, th * 0.75 + jit(), shoot.phi + (j + 0.5) * 2.4, tmp, flat), false, ord + 1);
  }

  // ---- one shoot from a bud
  const D = [0, 0, 0], V = [0, 0, 0];
  function growShoot(b, Y, pl) {
    const sp = pl.sp, r = pl.rand, v = bV[b];
    let n = Math.min(sp.nmax, Math.floor(v));
    if (n < 1) return 0;
    const age = Y - pl.start;
    // a weeping shoot: long, hangs straight down, carries leaves, few laterals
    const H = sp.hang, hanging = !!(H && bOrd[b] >= H.order && pl.rand() < H.p);

    // hydraulic limit: shoots that grow up near the species' top height
    // grow short (a hanging or a level shoot does not lift water higher)
    const hy = py[bNode[b]] / (sp.size.h * 1.05);
    const hyd = hanging || bDir[b * 3 + 1] < 0.2 ? 1 : Math.max(0.06, 1 - hy * hy);
    const l = internode(sp, age) * (bOrd[b] > 0 ? sp.latL ?? 1 : 1) * Math.min(1.35, v / n) * (0.9 + 0.2 * r()) * hyd;
    // a curtain grows down to near the ground in one season
    if (hanging) n = Math.max(1, Math.min(Math.floor(v * 3), 32, Math.floor((py[bNode[b]] - 0.6) / l * (0.6 + 0.35 * r()))));
    const term = bTerm[b] === 1, ord = bOrd[b];
    let prev = bNode[b];
    D[0] = bDir[b * 3]; D[1] = bDir[b * 3 + 1]; D[2] = bDir[b * 3 + 2];
    const shoot = { phi: r() * Math.PI * 2 };
    const dur = SPECIES_DUR(sp);
    let t0 = Y + sp.pheno.brk + (r() - 0.5) * 0.03;
    if (born[prev] + dur > t0) t0 = born[prev] + dur;     // never before the parent is grown
    const T = sp.dir, lateral = ord > 0;
    let x = px[prev], y = py[prev], z = pz[prev], dr = 0;
    for (let k = 0; k < n; k++) {
      optimalDir(x, y, z, D, V);
      D[0] += pl.xi * V[0]; D[1] += pl.xi * V[1]; D[2] += pl.xi * V[2];
      D[1] += lateral ? T.up : T.up0;
      if (lateral && T.plagio) D[1] *= 1 - T.plagio;
      dr = Array.isArray(T.droop) ? T.droop[Math.min(ord, T.droop.length - 1)] : (ord >= T.droopOrder ? T.droop : 0);
      if (dr) D[1] -= dr * Math.min(1, 0.1 + 0.3 * k);   // an arch first, then the shoot hangs
      if (flat) D[2] = 0;
      norm3(D);
      x += D[0] * l; y += D[1] * l; z += D[2] * l;
      if (y < 0.04) { y = 0.04; D[1] = Math.max(D[1], 0.05); norm3(D); }
      const main = term || k > 0;
      const i = addNode(x, y, z, prev, main, t0 + k * dur, Y, pl);
      order[i] = Math.min(250, ord);
      if (!main) order[i] = ord;
      if (!hanging) addLateralBuds(pl, i, D, k, n, shoot, ord);
      prev = i;
      if (dr > 0.5 && y < 0.35) break;          // a hanging shoot stops above the ground
    }
    shootEnd[prev] = 1;
    addBud(prev, D, true, ord);
    return n;
  }

  // ---- fern: fronds from the crown each spring, gone each autumn
  function stepFern(pl, Y) {
    const sp = pl.sp, F = sp.fern, r = pl.rand, age = Y - pl.start;
    const m = Math.min(1, age / 4);
    const nf = Math.round(F.fronds[0] + (F.fronds[1] - F.fronds[0]) * m);
    const dur = SPECIES_DUR(sp), a0 = r() * Math.PI * 2;
    for (let f = 0; f < nf; f++) {
      const inner = f / nf;
      const phi = a0 + f * 2.39996 + (r() - 0.5) * 0.3;
      const tilt = (0.32 + 0.5 * (1 - inner)) * (0.85 + 0.3 * r());
      const len = (F.len[0] + (F.len[1] - F.len[0]) * m) * (0.75 + 0.35 * r()) * (0.75 + 0.25 * inner);
      const nn = F.nodes, seg = len / nn;
      const d = [Math.sin(tilt) * Math.cos(phi), Math.cos(tilt), flat ? 0 : Math.sin(tilt) * Math.sin(phi)];
      if (flat) { d[0] = Math.sin(tilt) * (Math.cos(phi) < 0 ? -1 : 1); norm3(d); }
      let prev = pl.root, x = px[prev], y = py[prev] + 0.01, z = pz[prev];
      const t0 = Y + sp.pheno.brk + 0.005 + inner * 0.06 + r() * 0.01;
      const dieAt = Y + sp.pheno.fall + 0.02 + r() * 0.06;
      for (let k = 0; k < nn; k++) {
        const u = k / nn;
        // the rachis arches out and over: bend down more toward the tip
        d[1] -= (0.035 + 0.3 * u * u) * (1.25 - inner * 0.55); norm3(d);
        x += d[0] * seg; y += d[1] * seg; z += d[2] * seg;
        if (y < 0.03) y = 0.03;
        const i = addNode(x, y, z, prev, k > 0, t0 + k * dur, Y, pl);
        order[i] = 1; died[i] = dieAt;
        if (k >= 2) {
          // pinna length: an ostrich-fern outline, widest at 0.65 of the frond
          const w = Math.pow(Math.sin(Math.PI * Math.min(1, (u - 0.06) / 0.98)), 0.9) * (0.55 + 0.45 * u);
          const size = Math.max(0.025, sp.leaf.size * len / 1.1 * w * 1.15);
          for (let j = 0; j < 2; j++) {
            const li = addLeaf(i, Y, size, j * Math.PI + (r() - 0.5) * 0.15, 0.93, KIND.leaf, Math.floor(r() * sp.leaf.var), pl.spIndex);
            leaves[li * LEAF_STRIDE + 2] = Y;
          }
        }
        prev = i;
      }
    }
  }

  function relativeLight() {
    const sv = [];
    for (let i = 0; i < count; i += 1 + (count >> 14)) if (leafy[i] && !dead[i]) sv.push(shadowAt(px[i], py[i], pz[i]));
    sv.sort((a, b) => a - b);
    const med = sv.length ? sv[sv.length >> 1] : 1, k = 0.6 * med + 1;
    for (let i = 0; i < count; i++) {
      if (dead[i]) { lightRel[i] = 0; continue; }
      const s = shadowAt(px[i], py[i], pz[i]) - (leafy[i] ? SH.a : SH.wood);
      lightRel[i] = Math.max(Math.exp(-Math.max(0, s) / k), 0.8 * sideLight(px[i], py[i], pz[i], plantOf[i], s));
    }
  }

  // ---- pipe model and the per-node sums
  function pipeModel() {
    for (let i = 0; i < count; i++) { pacc[i] = 0; tips[i] = 0; }
    for (let i = count - 1; i >= 0; i--) {
      const pl = plants[plantOf[i]], n = pl.sp.pipe;
      if (dead[i]) continue;
      if (mainChild[i] < 0 || dead[mainChild[i]]) { pacc[i] += Math.pow(pl.sp.rTip, n); tips[i] += 1; }
      const r = Math.pow(pacc[i], 1 / n);
      if (r > radius[i]) radius[i] = r;
      const p = parent[i];
      if (p >= 0) { pacc[p] += Math.pow(radius[i], n); tips[p] += tips[i]; }
    }
  }

  // ---- leaf windows: open a group when a node turns leafy, close it when
  //      the node stops (shade, age, girth, death). A closed group stays shut.
  function updateLeafGroups(Y) {
    for (let i = 0; i < count; i++) {
      const pl = plants[plantOf[i]], sp = pl.sp;
      if (sp.form === 'fern') continue;
      const L = sp.leaf;
      const g = lgroup[i];
      if (leafy[i]) {
        if (g < 0) {
          const per = L.per + (Y > year0[i] ? L.spur : 0), r = pl.rand;
          const juv = 0.5 + 0.5 * Math.min(1, (Y - pl.start) / Math.max(1, sp.L[2] * 0.5));
          const a0 = r() * Math.PI * 2;
          const start = lcount;
          for (let k = 0; k < per; k++) {
            const ang = (L.ever ? a0 + k * 2 * Math.PI / per : a0 + k * 2.39996) + (r() - 0.5) * 0.5;
            const tilt = L.ever ? 0.9 + 0.1 * r() : 0.45 + 0.4 * r();
            addLeaf(i, Y, L.size * juv * (0.75 + 0.45 * r()), flat ? (k % 2) * Math.PI : ang, tilt, KIND.leaf, Math.floor(r() * L.var), pl.spIndex);
          }
          lgroup[i] = start; groupLen.set(start, per);
        }
      } else if (g >= 0 && leaves[g * LEAF_STRIDE + 2] === OPEN) {
        const n = groupLen.get(g);
        for (let k = 0; k < n; k++) leaves[(g + k) * LEAF_STRIDE + 2] = Y - 1;
      }
    }
  }

  // ---- flowers: spurs on lit two- to six-year wood (cherry) or the tips of
  //      last year's shoots (azalea)
  function updateFlowers(Y) {
    for (const pl of plants) pl.flowering = !!(pl.sp.flower && pl.alive && Y - pl.start >= pl.sp.flower.from);
    for (let i = 0; i < count; i++) {
      const pl = plants[plantOf[i]], F = pl.sp.flower;
      if (!F) continue;
      const age = Y - year0[i], g = fgroup[i];
      let on = pl.flowering && !dead[i] && age >= F.minAge && age <= F.maxAge && lightRel[i] > (F.q ?? 0.15);
      if (F.at === 'tip') on = on && shootEnd[i] === 1;
      else on = on && radius[i] < pl.sp.leaf.rMax * 1.8;
      if (on && g < 0) {
        if (pl.rand() > (F.p ?? 0.8)) { fgroup[i] = -2; continue; }
        const start = lcount, r = pl.rand, a0 = r() * Math.PI * 2;
        for (let k = 0; k < F.per; k++) addLeaf(i, Y, F.size * (0.8 + 0.4 * r()), a0 + k * 2 * Math.PI / F.per + (r() - 0.5) * 0.6, 0.35 + 0.35 * r(), KIND.flower, Math.floor(r() * 2), pl.spIndex);
        fgroup[i] = start; groupLen.set(start, F.per);
      } else if (!on && g >= 0 && leaves[g * LEAF_STRIDE + 2] === OPEN) {
        const n = groupLen.get(g);
        for (let k = 0; k < n; k++) leaves[(g + k) * LEAF_STRIDE + 2] = Y - 1;
      }
    }
  }

  // Steps 1 to 3: light, the basipetal pass and the allocation. commit
  // false (the diagram) leaves the plant state as it is.
  function allocate(Y, commit) {
    // 1. bud light from last year's grid (the grid is empty in year 0)
    for (let b = 0; b < bcount; b++) {
      const i = bNode[b];
      const x = px[i] + bDir[b * 3] * vox * 0.5, y = py[i] + bDir[b * 3 + 1] * vox * 0.5, z = pz[i] + bDir[b * 3 + 2] * vox * 0.5;
      bQ[b] = Math.max(exposure(x, y, z, leafy[i] ? SH.a : 0), sideLight(x, y, z, plantOf[i], shadowAt(x, y, z)));
    }
    // 2. basipetal pass: Q and the live node counts toward the base
    // nSub: the upkeep of a subtree, one per metamer; a thin hanging shoot
    // of a weeping tree costs a quarter (shedding compares light to upkeep)
    for (let i = 0; i < count; i++) {
      Qm[i] = 0; Ql[i] = 0;
      const H = plants[plantOf[i]].sp.hang;
      nSub[i] = dead[i] ? 0 : (H && order[i] >= H.order ? 0.25 : 1);
    }
    for (let b = 0; b < bcount; b++) { if (bTerm[b]) Qm[bNode[b]] += bQ[b]; else Ql[bNode[b]] += bQ[b]; }
    // a leafy node adds the light its leaves caught last year (leaf.w of a
    // bud): long leafy shoots with few buds (willow curtains) still pay
    for (let i = count - 1; i >= 0; i--) {
      if (dead[i]) { Qt[i] = 0; continue; }
      Qt[i] = Qm[i] + Ql[i] + (leafy[i] ? SH.leafW * light[i] : 0);
      const p = parent[i];
      if (p >= 0) { if (isMain[i]) Qm[p] += Qt[i]; else Ql[p] += Qt[i]; nSub[p] += nSub[i]; }
    }
    // 3. Borchert-Honda: resource from the base to the buds. Near the node
    //    budget the resource eases off, so the crown turns over smoothly
    let planned = 0, live = 0;
    for (let i = 0; i < count; i++) live += 1 - dead[i];
    const soft = Math.min(1, Math.max(0.25, 1.6 - 1.1 * live / maxNodes));
    // a plant in a stand that gets far less light per metamer than the best
    // lit plant for three years stops growing (it is suppressed)
    let bestQn = 0;
    for (const pl of plants) if (pl.sp.form !== 'fern' && pl.alive) bestQn = Math.max(bestQn, Qt[pl.root] / Math.max(1, nSub[pl.root]));
    for (const pl of plants) {
      const r = pl.root;
      if (pl.sp.form === 'fern') continue;
      const qn = Qt[r] / Math.max(1, nSub[r]);
      if (commit && plants.length > 1) {
        if (Y - pl.start > 4 && qn < 0.2 * bestQn) pl.weak++; else pl.weak = 0;
        if (pl.weak >= 3) pl.alive = false;
      }
      vin[r] = pl.alive ? pl.alpha * Qt[r] * soft : 0;
    }
    // apical dominance eases from the young value to the mature value
    const lamOf = plants.map(pl => { const [a, b] = pl.lambda, f = Math.min(1, (Y - pl.start) / pl.sp.L[2]); return a + (b - a) * f; });
    for (let i = 0; i < count; i++) {
      if (dead[i]) { vm[i] = vl[i] = 0; continue; }
      const p = parent[i];
      if (p >= 0) vin[i] = isMain[i] ? vm[p] : (Ql[p] > 0 ? vl[p] * Qt[i] / Ql[p] : 0);
      const lam = lamOf[plantOf[i]];
      const den = lam * Qm[i] + (1 - lam) * Ql[i];
      vm[i] = den > 0 ? vin[i] * lam * Qm[i] / den : 0;
      vl[i] = vin[i] - vm[i];
      vigor[i] = vin[i];
    }
    for (let b = 0; b < bcount; b++) {
      const i = bNode[b];
      bV[b] = bTerm[b] ? vm[i] : (Ql[i] > 0 ? vl[i] * bQ[b] / Ql[i] : 0);
      if (bV[b] >= 1) planned += Math.min(plants[plantOf[i]].sp.nmax, Math.floor(bV[b]));
    }
    // the hard cap (all nodes, for memory): scale the resource down near it
    const room = Math.min(maxNodes * 1.3 - live, hardCap - count);
    if (planned > room * 0.5) {
      const k = Math.max(0, room * 0.5) / planned;
      for (let b = 0; b < bcount; b++) bV[b] = bV[b] * k < 1 ? 0 : bV[b] * k;
    }
    return live;
  }

  // ======================================================== one year
  function stepYear() {
    if (st.done) return st.year;
    const Y = st.year, n0 = count;
    let grown = 0, shed = 0;
    allocate(Y, true);

    // 4. shedding: lateral branches with too little light per node
    const shedRoot = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      if (dead[i] || isMain[i] || parent[i] < 0) continue;
      const pl = plants[plantOf[i]], S = pl.sp.shed;
      if (Y - year0[i] < S.age || pl.sp.form === 'fern') continue;
      // a weeping tree: its scaffold carries the curtains, so light per
      // metamer says little about it; only the curtains age out
      if (pl.sp.hang && order[i] < pl.sp.hang.order) continue;
      if (S.hangAge && pl.sp.hang && Y - year0[i] < S.hangAge) continue;
      if (Qt[i] / Math.max(1, nSub[i]) < S.q) shedRoot[i] = 1;
    }
    // self-pruning: low limbs on the trunk die as the crown rises above them
    const hgt = plants.map(() => 0);
    for (let i = 0; i < count; i++) if (!dead[i] && py[i] > hgt[plantOf[i]]) hgt[plantOf[i]] = py[i];
    for (let i = 0; i < count; i++) {
      if (dead[i] || isMain[i] || parent[i] < 0) continue;
      const pl = plants[plantOf[i]], c = pl.sp.clear || 0, p = parent[i];
      if (!c || order[p] !== 0 || Y - pl.start < 6) continue;
      if (py[p] < Math.min(c, 0.3 * hgt[pl.k])) shedRoot[i] = 1;
    }
    // the whole branch falls at the time of its base
    for (let i = 0; i < count; i++) {
      if (dead[i]) continue;
      const p = parent[i];
      if (shedRoot[i]) { dead[i] = 1; died[i] = Y + 0.03 + 0.1 * rand(); leafy[i] = 0; shed++; shedRoot[i] = 2; }
      else if (p >= 0 && shedRoot[p] === 2) { dead[i] = 1; died[i] = died[p]; leafy[i] = 0; shedRoot[i] = 2; }
    }

    // 5. bud fate and shoot growth
    const nb = bcount;
    for (let b = 0; b < nb; b++) {
      const i = bNode[b], pl = plants[plantOf[i]];
      if (dead[i] || !pl.alive || bV[b] < 1) continue;
      const g = growShoot(b, Y, pl);
      if (g > 0) { bV[b] = -1; grown += g; }
    }
    // ferns: this year's fronds; last year's are dead already
    for (const pl of plants) {
      if (pl.sp.form !== 'fern') continue;
      for (let i = 0; i < count; i++) if (plantOf[i] === pl.k && i !== pl.root && year0[i] < Y) dead[i] = 1;
      stepFern(pl, Y);
    }
    // shrubs: a new basal bud now and then
    for (const pl of plants) {
      const B = pl.sp.basal;
      if (!B || !pl.alive || Y < 2) continue;
      for (let k = 0; k < B.perYear; k++) if (pl.rand() < 0.6) addBud(pl.root, coneDir([0, 1, 0], B.theta * D2R * (0.7 + 0.6 * pl.rand()), pl.rand() * Math.PI * 2, tmp2, flat), false, 1);
    }
    // the buds that grew are used; dormant buds age and die
    compactBuds(b => {
      const i = bNode[b], pl = plants[plantOf[i]];
      if (bV[b] < 0 || dead[i]) return false;
      if (bAge[b] < 255) bAge[b]++;
      return bAge[b] <= (bTerm[b] ? 6 : 4) && pl.alive;
    });

    // 6. which nodes are leafy this year (light from the grid of last year)
    sideLightPrep();
    for (let i = 0; i < count; i++) {
      const pl = plants[plantOf[i]], L = pl.sp.leaf;
      if (dead[i] || !pl.alive || pl.sp.form === 'fern') { leafy[i] = pl.sp.form === 'fern' && !dead[i] && i !== pl.root ? 1 : 0; continue; }
      const q = Math.max(exposure(px[i], py[i], pz[i], leafy[i] ? SH.a : 0), sideLight(px[i], py[i], pz[i], plantOf[i], shadowAt(px[i], py[i], pz[i])));
      const age = Y - year0[i];
      // young shoots, and short shoots (spurs) on lit thin wood up to spurAge
      const young = age <= L.age || (L.spur > 0 && radius[i] < L.rMax * 0.75 && q >= L.q * 1.5);
      // the curtain of a weeping tree leafs in the half shade under its crown
      const curtain = pl.sp.hang && order[i] >= pl.sp.hang.order && dy[i] < -0.4;
      leafy[i] = (i !== pl.root && (young || (curtain && age <= L.age + 2)) && (q >= L.q || curtain) && radius[i] < L.rMax) ? 1 : 0;
      if (i === pl.coty || parent[i] === pl.root) leafy[i] = 0;
    }
    // 7. the new grid, and the light of each node in it
    castAll();
    for (let i = 0; i < count; i++) light[i] = dead[i] ? 0 : Math.max(exposure(px[i], py[i], pz[i], leafy[i] ? SH.a : SH.wood), sideLight(px[i], py[i], pz[i], plantOf[i], shadowAt(px[i], py[i], pz[i])));
    // the light the eye sees (shade inside the crown, the light colour mode,
    // flowers): relative to the median shadow among the leaves, because a
    // dense crown saturates the absolute exposure of the model
    relativeLight();
    // 8. secondary growth
    pipeModel();
    // 9. leaves and flowers
    updateLeafGroups(Y);
    updateFlowers(Y);

    radHist[Y] = radius.slice(0, count);
    lightHist[Y] = quant8(lightRel, count, 1);
    vigorHist[Y] = vigor.slice(0, count);
    tipsHist[Y] = tips.slice(0, count);
    yearOff[Y + 1] = count;
    let lf = 0; for (let i = 0; i < count; i++) lf += leafy[i];
    let lv = 0; for (let i = 0; i < count; i++) lv += 1 - dead[i];
    st.stats[Y] = { year: Y, nodes: count, live: lv, added: count - n0, grown, shed, buds: bcount, leafy: lf, leaves: visibleLeaves(Y) };
    st.year = Y + 1;
    if (st.year >= years) st.done = true;
    return Y;
  }

  // the leaf records that show in year Y
  function visibleLeaves(Y) {
    let n = 0;
    for (let k = 0; k < lcount; k++) { const o = k * LEAF_STRIDE; if (leaves[o + 1] <= Y && leaves[o + 2] >= Y) n++; }
    return n;
  }

  // plain arrays of the state now, for the renderer (structured clone)
  function snapshot() {
    const n = count, Y = st.year - 1;
    return {
      year: Y, years, count: n, voxel: vox,
      px: px.slice(0, n), py: py.slice(0, n), pz: pz.slice(0, n),
      parent: parent.slice(0, n), isMain: isMain.slice(0, n), mainChild: mainChild.slice(0, n),
      born: born.slice(0, n), died: died.slice(0, n), year0: year0.slice(0, n), order: order.slice(0, n),
      plant: plantOf.slice(0, n), s: sArc.slice(0, n),
      radius: radHist[Y], light: lightHist[Y], vigor: vigorHist[Y], tips: tipsHist[Y],
      leaves: leaves.slice(0, lcount * LEAF_STRIDE), leafCount: lcount,
      yearOff: yearOff.slice(), stats: st.stats[Y],
      plants: plants.map(p => ({ species: p.id, spIndex: p.spIndex, x: p.x, z: p.z, root: p.root, germ: p.germ, alive: p.alive })),
    };
  }

  const sim = {
    flat, plants, years, voxel: vox, grid: { G, NX, NY, NZ, x0: gx0, z0: gz0, vox }, shadow: SH,
    get count() { return count; }, get year() { return st.year; }, get done() { return st.done; },
    get px() { return px; }, get py() { return py; }, get pz() { return pz; },
    get dx() { return dx; }, get dy() { return dy; }, get dz() { return dz; },
    get parent() { return parent; }, get isMain() { return isMain; }, get mainChild() { return mainChild; },
    get born() { return born; }, get died() { return died; }, get year0() { return year0; }, get dead() { return dead; },
    get order() { return order; }, get plant() { return plantOf; }, get s() { return sArc; },
    get radius() { return radius; }, get light() { return light; }, get lightRel() { return lightRel; }, get vigor() { return vigor; }, get tips() { return tips; },
    get leafy() { return leafy; }, get Qt() { return Qt; },
    get leaves() { return leaves; }, get leafCount() { return lcount; },
    get budCount() { return bcount; },
    buds() { const o = []; for (let b = 0; b < bcount; b++) o.push({ node: bNode[b], term: !!bTerm[b], q: bQ[b], v: bV[b], age: bAge[b], dir: [bDir[b * 3], bDir[b * 3 + 1], bDir[b * 3 + 2]] }); return o; },
    radHist, lightHist, vigorHist, tipsHist, yearOff, stats: st.stats,
    stepYear, snapshot, visibleLeaves, exposure, shadowAt,
    allocate() { if (!st.done) allocate(st.year, false); },
  };
  return sim;
}

// The time one metamer takes to extend, in years.
export function SPECIES_DUR(sp) { return sp.form === 'fern' ? 0.0045 : sp.form === 'shrub' ? 0.02 : 0.022; }

function quant8(a, n, max) {
  const o = new Uint8Array(n);
  for (let i = 0; i < n; i++) o[i] = Math.max(0, Math.min(255, Math.round(a[i] / max * 255)));
  return o;
}

// Grow a whole life. opts as createSim.
export function growLife(species, opts = {}) {
  const sim = createSim(Object.assign({ species }, opts));
  let guard = 0;
  while (!sim.done && guard++ < 200) sim.stepYear();
  return sim;
}
