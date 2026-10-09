// ============================================================================
//  FLIP WATER  ·  scenes.js  —  seeded scene randomizer, presets, URL hash
// ----------------------------------------------------------------------------
//  Our addition to the Ten Minute Physics port (not upstream code).
//
//  A scene comes from a state { seed, sub, locks, colours, over }:
//    seed     text; each category draws from its own RNG, seeded by
//             hash(seed + '/' + category), so a change in one category
//             does not move the draws of another
//    sub      { category: text } replaces that category's seed (the
//             per-category dice); a locked category keeps its old seed
//             text here when the main seed rolls
//    locks    categories that "New scene" does not roll
//    colours  render options (render.js reads them)
//    over     user edits from the sliders: { key: number }
//  The whole state round-trips through the URL hash (encodeHash /
//  decodeHash). build(state, env) gives a plain-data spec; createSim(spec)
//  makes the FlipSim with its moving solids.
//
//  Ranges are kept inside what the solver handles: the tests run 200
//  random seeds for 600 frames each and check for NaN, escape and volume.
//
//  The tank aspect is the long side over the short side. A landscape
//  screen gets a wide tank, a portrait screen a tall one; env.portrait
//  says which. The same seed on the same orientation gives the same scene.
//
//  grep -n targets
//    const CATS           category list (UI order)
//    const GEN            one generator per category
//    const PRESETS        named scenes ('harbour' is the default)
//    export function build
//    export function createSim
//    export function encodeHash / decodeHash
//    export function rollAll / rollCat
// ============================================================================
import { FlipSim, Solid, mulberry } from './flip.js';
import { box, disc, segment, poly } from './shapes.js';

export const CATS = ['tank', 'water', 'obstacles', 'gravity', 'particles', 'solver', 'damping', 'flow', 'time'];
export const CAT_NAMES = {
  tank: 'Tank', water: 'Water shape', obstacles: 'Obstacles', gravity: 'Gravity', particles: 'Particles',
  solver: 'Solver', damping: 'Damping', flow: 'Flow', time: 'Time step', objects: 'Objects',
};

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
  return h >>> 0;
}

function R(seedText) {
  const r = mulberry(hashStr(seedText));
  r.uni = (a, b) => a + (b - a) * r();
  r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  return r;
}

const ALPHA = '23456789abcdefghjkmnpqrstuvwxyz';
export function newSeed(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHA[Math.floor(rand() * ALPHA.length)];
  return s;
}

// ---- generators ---------------------------------------------------------------
// Each one reads the context c (what earlier categories made) and adds to it.
export const GEN = {
  tank(r, c) {
    c.Hm = r.uni(2.2, 3.4);                       // short side, metres
    c.aspect = r.chance(0.2) ? r.uni(1.0, 1.3) : r.uni(1.35, 2.3);
    c.resMax = r.int(70, 110);                    // cells on the short side (before the budget)
  },
  particles(r, c) {
    c.rRatio = r.uni(0.27, 0.33);                 // particle radius / cell size (upstream 0.3)
    c.fillBudget = r.uni(0.65, 1.0);              // share of the device particle budget
  },
  water(r, c) {
    const kind = c.forceWater || r.pick(['dam', 'dam', 'drop', 'columns', 'pooldrop', 'pour', 'waves']);
    const W = c.W, H = c.H, out = [];
    let pour = null, paddle = false;
    const side = r.chance(0.5) ? 0 : 1;
    const R0 = (x0, y0, x1, y1, extra) => out.push(Object.assign({ kind: 'rect', x0, y0, x1, y1 }, extra || {}));
    if (kind === 'dam') {
      const w = r.uni(0.24, 0.42) * W, hh = r.uni(0.5, 0.82) * H;
      if (side === 0) R0(0, 0, w, hh); else R0(W - w, 0, W, hh);
      if (r.chance(0.35)) R0(0, 0, W, r.uni(0.04, 0.1) * H);
      c.dam = { side, w, hh };
    } else if (kind === 'drop') {
      R0(0, 0, W, r.uni(0.1, 0.22) * H);
      const rr = r.uni(0.12, 0.2) * Math.min(W, H);
      out.push({ kind: 'disc', cx: r.uni(0.3, 0.7) * W, cy: r.uni(0.62, 0.78) * H, r: rr, vx: r.uni(-1, 1), vy: -r.uni(0, 2) });
    } else if (kind === 'columns') {
      const a = r.uni(0.14, 0.26) * W, b = r.uni(0.14, 0.26) * W;
      R0(0, 0, a, r.uni(0.45, 0.8) * H); R0(W - b, 0, W, r.uni(0.45, 0.8) * H);
    } else if (kind === 'pooldrop') {
      R0(0, 0, W, r.uni(0.22, 0.36) * H);
      const w = r.uni(0.14, 0.26) * W, x = r.uni(0.15, 0.85) * W - w / 2;
      R0(x, r.uni(0.6, 0.66) * H, x + w, r.uni(0.78, 0.88) * H, { vy: -r.uni(0, 1.5) });
    } else if (kind === 'pour') {
      R0(0, 0, W, r.uni(0.12, 0.28) * H);
      pour = true;
    } else {
      R0(0, 0, W, r.uni(0.3, 0.48) * H);
      paddle = true;
    }
    c.waterKind = kind; c.water = out; c.forcePour = pour; c.forcePaddle = paddle;
    // area of the water, for the particle budget
    let A = 0;
    for (const w of out) A += w.kind === 'rect' ? (w.x1 - w.x0) * (w.y1 - w.y0) : Math.PI * w.r * w.r;
    c.waterArea = A;
  },
  obstacles(r, c) {
    const W = c.W, H = c.H, h = c.h, th = Math.max(2.2 * h, 0.05), list = [];
    const st = (shape, x, y, a, kind) => list.push({ shape, x, y, a: a || 0, kind });
    const n = r.pick([0, 1, 1, 2, 2, 3, 4]);
    const kinds = ['wall', 'slope', 'pillar', 'shelf', 'funnel', 'step', 'post'];
    for (let k = 0; k < n; k++) {
      const kind = r.pick(kinds), x = r.uni(0.25, 0.75) * W;
      if (kind === 'wall') { const hh = r.uni(0.12, 0.32) * H; st(box(th, hh, th * 0.3), x, hh / 2, 0, kind); }
      else if (kind === 'step') { const w = r.uni(0.1, 0.25) * W, hh = r.uni(0.06, 0.16) * H; st(box(w, hh, 0.01), x, hh / 2, 0, kind); }
      else if (kind === 'slope') {
        const w = r.uni(0.18, 0.4) * W, hh = r.uni(0.1, 0.3) * H, flip = r.chance(0.5);
        const pts = flip ? [[0, 0], [w, 0], [0, hh]] : [[0, 0], [w, 0], [w, hh]];
        const x0 = flip ? r.uni(0.02, 0.3) * W : W - w - r.uni(0.02, 0.3) * W;
        st(poly(pts, 0.005), x0, 0, 0, kind);
      }
      else if (kind === 'pillar') { const rr = r.uni(0.04, 0.09) * H; st(disc(rr), x, r.uni(0.25, 0.55) * H, 0, kind); }
      else if (kind === 'post') { const hh = r.uni(0.2, 0.45) * H, w = r.uni(0.04, 0.08) * W; st(box(Math.max(w, th), hh, 0.02), x, hh / 2, 0, kind); }
      else if (kind === 'shelf') {
        const w = r.uni(0.15, 0.3) * W, y = r.uni(0.3, 0.55) * H, a = r.uni(-0.35, 0.35);
        st(segment(-w / 2, 0, w / 2, 0, th), x, y, a, kind);
      } else {
        // funnel: two slanted walls with a gap
        const y = r.uni(0.45, 0.62) * H, gap = r.uni(0.05, 0.1) * W + 4 * h, arm = r.uni(0.12, 0.22) * W, ang = r.uni(0.45, 0.8);
        const dx = Math.cos(ang) * arm, dy = Math.sin(ang) * arm;
        st(segment(-gap / 2 - dx, dy, -gap / 2, 0, th), x, y, 0, kind);
        st(segment(gap / 2, 0, gap / 2 + dx, dy, th), x, y, 0, kind);
      }
    }
    c.statics = list;
    // A sluice gate holds the dam and lifts after a moment.
    c.gate = null;
    if (c.dam && r.chance(0.6)) {
      const gw = Math.max(th, 0.06), gh = c.dam.hh + 0.1 * H;
      const gx = c.dam.side === 0 ? c.dam.w + gw / 2 + c.r : W - c.dam.w - gw / 2 - c.r;
      c.gate = { x: gx, w: gw, hgt: gh, liftAt: r.uni(0.3, 1.2), speed: r.uni(1.5, 4) };
    }
  },
  gravity(r, c) {
    const g = r.chance(0.5) ? 9.81 : r.uni(6.5, 13);
    const tilt = r.chance(0.55) ? 0 : r.uni(-18, 18) * Math.PI / 180;
    c.g = g; c.tilt = tilt;
  },
  solver(r, c) {
    c.flip = r.chance(0.1) ? r.uni(0.3, 0.7) : r.uni(0.8, 0.97);
    c.pressureIters = r.int(35, 70);
    c.overRelax = r.uni(1.75, 1.93);
    c.compensate = true;                          // off lets the water compress to half its area
    c.stiffness = r.uni(0.6, 1.4);
    c.separate = r.chance(0.95);
    c.particleIters = r.int(1, 3);
  },
  damping(r, c) {
    c.damping = r.chance(0.6) ? r.uni(0, 0.08) : r.uni(0.08, 0.4);
    c.viscosity = r.chance(0.6) ? 0 : r.uni(0.03, 0.25);
  },
  flow(r, c) {
    const W = c.W, H = c.H, h = c.h;
    c.emitters = []; c.drains = []; c.paddle = null; c.wind = 0;
    const ne = c.forcePour ? r.int(1, 2) : (r.chance(0.2) ? 1 : 0);
    for (let k = 0; k < ne; k++) {
      const left = r.chance(0.5), a = -Math.PI / 2 + (left ? 1 : -1) * r.uni(0, 0.8);
      c.emitters.push({ x: (left ? r.uni(0.08, 0.35) : r.uni(0.65, 0.92)) * W, y: r.uni(0.78, 0.9) * H, dx: Math.cos(a), dy: Math.sin(a), speed: r.uni(1, 3.5), width: r.uni(3, 6) * h, rateShare: r.uni(0.05, 0.12) });
    }
    if (ne && r.chance(0.7)) {
      const w = r.uni(0.05, 0.1) * W, x = r.chance(0.5) ? r.uni(0.02, 0.2) * W : r.uni(0.8, 0.98) * W - w;
      c.drains.push({ x0: x, y0: 0, x1: x + w, y1: h + 2.5 * c.r });
    }
    if (c.forcePaddle || r.chance(0.18)) {
      const left = !(c.dam && c.dam.side === 0) ;
      c.paddle = { side: left ? 0 : 1, w: Math.max(0.05 * W, 2.5 * h), hgt: r.uni(0.55, 0.8) * H, amp: r.uni(0.03, 0.08) * W, period: r.uni(1.2, 2.6) };
    }
    if (r.chance(0.3)) c.wind = r.uni(1, 4) * (r.chance(0.5) ? -1 : 1);
  },
  time(r, c) {
    c.dt = 1 / r.pick([50, 60, 60, 60, 72]);
    c.substeps = r.chance(0.6) ? 1 : 2;
    c.cfl = r.uni(1.0, 1.8);
  },
};

// ---- presets ---------------------------------------------------------------------
// A preset fixes some categories; the rest come from the seed as usual.
export const PRESETS = {
  harbour: {
    water(r, c) {
      const W = c.W, H = c.H;
      c.water = [{ kind: 'rect', x0: 0, y0: 0, x1: 0.32 * W, y1: 0.78 * H }, { kind: 'rect', x0: 0, y0: 0, x1: W, y1: 0.16 * H }];
      c.dam = { side: 0, w: 0.32 * W, hh: 0.78 * H }; c.waterKind = 'dam';
      c.waterArea = 0.32 * W * 0.62 * H + W * 0.16 * H;
      c.forcePour = false; c.forcePaddle = false;
    },
    obstacles(r, c) {
      const W = c.W, H = c.H, h = c.h, th = Math.max(2.2 * h, 0.05);
      c.statics = [{ shape: poly([[0, 0], [0.22 * W, 0], [0.22 * W, 0.1 * H]], 0.005), x: 0.76 * W, y: 0, a: 0, kind: 'slope' }];
      c.gate = { x: 0.32 * W + Math.max(th, 0.06) / 2 + c.r, w: Math.max(th, 0.06), hgt: 0.88 * H, liftAt: 0.6, speed: 2.5 };
    },
    gravity(r, c) { c.g = 9.81; c.tilt = 0; },
    flow(r, c) { c.emitters = []; c.drains = []; c.paddle = null; c.wind = 0; },
    solver(r, c) { c.flip = 0.92; c.pressureIters = 50; c.overRelax = 1.9; c.compensate = true; c.stiffness = 1; c.separate = true; c.particleIters = 2; },
    damping(r, c) { c.damping = 0.02; c.viscosity = 0; },
    time(r, c) { c.dt = 1 / 60; c.substeps = 1; c.cfl = 1.5; },
  },
};

// Slider overrides: key -> [min, max, step, label]. They win over the draws.
export const OVERRIDES = {
  flip: [0, 1, 0.01, 'PIC ↔ FLIP'],
  g: [0, 20, 0.1, 'Gravity m/s²'],
  tilt: [-0.5, 0.5, 0.01, 'Tilt rad'],
  damping: [0, 1, 0.01, 'Damping 1/s'],
  viscosity: [0, 0.3, 0.01, 'Viscosity'],
  wind: [-6, 6, 0.1, 'Wind m/s²'],
  stiffness: [0, 2, 0.05, 'Drift stiffness'],
  pressureIters: [10, 100, 1, 'Pressure iterations'],
};

function catSeed(state, cat) {
  return state.sub && state.sub[cat] ? state.sub[cat] : state.seed + '/' + cat;
}

// env: { portrait, budget (particles), minRes }
export function build(state, env = {}) {
  const budget = env.budget || 20000, minRes = env.minRes || 40;
  const c = {};
  const preset = PRESETS[state.seed] || null;
  const run = (cat) => {
    const r = R(catSeed(state, cat));
    const g = preset && preset[cat] && !(state.sub && state.sub[cat]) ? preset[cat] : GEN[cat];
    if (g) g(r, c);
  };
  run('tank');
  const L = c.Hm * c.aspect;
  c.W = env.portrait ? c.Hm : L; c.H = env.portrait ? L : c.Hm;
  run('particles');
  c.h = c.Hm / c.resMax; c.r = c.rRatio * c.h;   // provisional, for the water draw
  run('water');
  // Cell size from the particle budget: N = area / (2 sqrt3 r^2), r = rRatio h.
  const N = Math.max(500, budget * c.fillBudget);
  let h = Math.sqrt(c.waterArea / (2 * Math.sqrt(3) * c.rRatio * c.rRatio * N));
  h = Math.max(h, Math.min(c.W, c.H) / c.resMax);
  h = Math.min(h, Math.min(c.W, c.H) / minRes);
  c.h = h; c.r = c.rRatio * h;
  run('obstacles');
  run('gravity');
  run('solver');
  run('damping');
  run('flow');
  run('time');
  if (GEN.objects) run('objects');
  const o = state.over || {};
  for (const k of Object.keys(OVERRIDES)) if (o[k] != null && Number.isFinite(+o[k])) c[k] = +o[k];
  const spec = {
    seed: state.seed, simSeed: hashStr(state.seed + '/sim'),
    W: c.W, H: c.H, h: c.h, r: c.r, portrait: !!env.portrait,
    gx: c.g * Math.sin(c.tilt), gy: -c.g * Math.cos(c.tilt), g: c.g, tilt: c.tilt,
    flip: c.flip, pressureIters: c.pressureIters, overRelax: c.overRelax, compensate: c.compensate,
    stiffness: c.stiffness, separate: c.separate, particleIters: c.particleIters,
    damping: c.damping, viscosity: c.viscosity, wind: c.wind,
    dt: c.dt, substeps: c.substeps, cfl: c.cfl,
    water: c.water, waterKind: c.waterKind, statics: c.statics, gate: c.gate, paddle: c.paddle,
    emitters: c.emitters.map(e => ({ x: e.x, y: e.y, dx: e.dx, dy: e.dy, speed: e.speed, width: e.width, rate: e.rateShare * N })),
    drains: c.drains,
    objects: c.objects || [],
  };
  spec.maxParticles = Math.round(N * (spec.emitters.length ? 1.45 : 1.05)) + 64;
  return spec;
}

export function createSim(spec, makeBodies) {
  const sim = new FlipSim(spec);
  const { W, H } = spec;
  if (spec.gate) {
    const g = spec.gate;
    const s = new Solid(box(g.w, g.hgt, 0.01), g.x, g.hgt / 2 + 0.002);
    s.kind = 'gate';
    s.motion = (t, so) => { so.y = g.hgt / 2 + 0.002 + Math.max(0, t - g.liftAt) * g.speed; if (so.y - g.hgt / 2 > H) so.active = false; };
    sim.addSolid(s);
  }
  if (spec.paddle) {
    const p = spec.paddle;
    const x0 = p.side === 0 ? p.w / 2 + sim.h * 1.5 + p.amp : W - p.w / 2 - sim.h * 1.5 - p.amp;
    const s = new Solid(box(p.w, p.hgt, 0.01), x0, p.hgt / 2 + sim.h + 0.01);
    s.kind = 'paddle';
    s.motion = (t, so) => { so.x = x0 + p.amp * Math.sin(2 * Math.PI * t / p.period); };
    sim.addSolid(s);
  }
  if (makeBodies) makeBodies(sim, spec);
  sim.refill();
  return sim;
}

// ---- state, rolls and the hash --------------------------------------------------
export function defaultState() {
  return { seed: 'harbour', sub: {}, locks: [], colours: {}, over: {} };
}

export function rollAll(state, rand = Math.random) {
  const next = { seed: newSeed(rand), sub: {}, locks: state.locks.slice(), colours: Object.assign({}, state.colours), over: {} };
  for (const cat of state.locks) next.sub[cat] = catSeed(state, cat);
  // A preset seed fixes its categories through PRESETS, not through the
  // text, so a locked category of a preset keeps the preset's values only
  // while the seed stays; the lock keeps the drawn values otherwise.
  return next;
}

export function rollCat(state, cat, rand = Math.random) {
  const next = JSON.parse(JSON.stringify(state));
  next.sub[cat] = newSeed(rand);
  return next;
}

const COLOUR_KEYS = ['water', 'map', 'rev', 'bg', 'obj', 'view', 'foam'];

export function encodeHash(state) {
  const q = [];
  const e = encodeURIComponent;
  q.push('s=' + e(state.seed));
  for (const cat of Object.keys(state.sub || {}).sort()) if (state.sub[cat]) q.push(cat + '=' + e(state.sub[cat]));
  if (state.locks && state.locks.length) q.push('lock=' + state.locks.slice().sort().join('.'));
  for (const k of COLOUR_KEYS) if (state.colours && state.colours[k] != null && state.colours[k] !== '') q.push('c.' + k + '=' + e(state.colours[k]));
  for (const k of Object.keys(state.over || {}).sort()) if (state.over[k] != null) q.push('o.' + k + '=' + e(state.over[k]));
  return '#' + q.join('&');
}

export function decodeHash(hash) {
  const st = defaultState();
  const s = (hash || '').replace(/^#/, '');
  if (!s) return st;
  const cats = new Set(CATS.concat(['objects']));
  for (const part of s.split('&')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i), v = decodeURIComponent(part.slice(i + 1));
    if (k === 's' || k === 'seed') st.seed = v.slice(0, 40) || 'harbour';
    else if (k === 'lock') st.locks = v.split('.').filter(x => cats.has(x));
    else if (cats.has(k)) st.sub[k] = v.slice(0, 60);
    else if (k.startsWith('c.') && COLOUR_KEYS.includes(k.slice(2))) st.colours[k.slice(2)] = v;
    else if (k.startsWith('o.') && OVERRIDES[k.slice(2)]) { const n = +v; if (Number.isFinite(n)) st.over[k.slice(2)] = n; }
  }
  return st;
}
