// ============================================================================
//  ULAM SPIRAL  ·  saver.js — the screensaver director (window.snSaver)
// ----------------------------------------------------------------------------
//  Protocol: lib/screensaver.js. enter(opts) { calm, seconds, caption,
//  seed, label } hides the page GUI, makes a 2D composite canvas in the
//  document (#saver-cv: the WebGL frame, then the labels and rings), and
//  returns { canvas, warmupMs }.
//
//  The director plays shots from a seeded shuffle of SHOTS (a new order
//  each run; the counters start again at each load). A shot lasts 5 to 12
//  s (calm: longer and slower), fades in and out through black, and
//  frames its subject in the clear band of the shell plate (plateBand,
//  read by main.js occlusion()).
//    animation    count (the spiral counted out), sacks (the Sacks spiral
//                 unrolls), tour (morphs through three shapes), sweep (a
//                 colour map sweeps out), euler (n^2 + n + 41 lights up)
//    exploration  zoomout, zoomin (one labelled cell <-> millions), diagonal
//                 (a drift along the densest line), far (a fly-over near
//                 10^9 or 10^12 on Miller-Rabin tiles), twins (a push from
//                 twin pair to twin pair), explore (another shape, another
//                 highlight), orbit (a 3D shape), heat (divisor heat map)
//  Each shot sends the plate: the shape, the shot's numbers (region,
//  highlight, pi(N) against N/ln N) and a short code extract read from
//  this page's own source files.
//
//  window.snSaver.debug() gives the director state for the CDP probe.
//
//  GREP MAP
//    grep -n 'const SHOTS'        the shot list
//    grep -n 'function plate'     the label plate payload
//    grep -n 'async function extract'   code extracts from the sources
//    grep -n 'enter(opts'         the hook
// ============================================================================

function mulberry(a) {
  a = (a >>> 0) || 0x9e3779b9;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);
const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// --- code extracts --------------------------------------------------------------
// A short extract of this page's own source: from the line that holds
// `from` for at most `lines` lines (to the end of the block).
const SRC = {};
async function extract(file, from, lines = 11) {
  try {
    if (!SRC[file]) SRC[file] = await (await fetch(new URL('./' + file, import.meta.url))).text();
    const all = SRC[file].split('\n'), i = all.findIndex(l => l.trimStart().startsWith(from));
    if (i < 0) return null;
    const out = [];
    let depth = 0;
    for (let j = i; j < all.length && out.length < lines; j++) {
      const l = all[j];
      out.push(l.replace(/\s+$/, ''));
      depth += (l.match(/[{(]/g) || []).length - (l.match(/[})]/g) || []).length;
      if (depth <= 0 && j > i) break;
    }
    const pad = Math.min(...out.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length));
    return out.map(l => l.slice(pad)).join('\n');
  } catch (e) { return null; }
}
const CODE = {
  sq: ['layouts.js', 'export function sqPos(k)', 'js', 'sqPos · layouts.js'],
  sieve: ['numtheory.js', 'for (let s = 0; s < segs; s++)', 'js', 'sieveOdd · numtheory.js'],
  mr: ['numtheory.js', 'function mrBig(n)', 'js', 'Miller–Rabin · numtheory.js'],
  quad: ['numtheory.js', 'export function quadDensity', 'js', 'quadDensity · numtheory.js'],
  hex: ['layouts.js', 'export function hexPos(k)', 'js', 'hexPos · layouts.js'],
  gisp: ['glsl.js', 'int gIsP(uint n)', 'glsl', 'gIsP · glsl.js'],
  sacks: ['glsl.js', 'float gSacksTurn(uint n)', 'glsl', 'gSacksTurn · glsl.js'],
  morph: ['glsl.js', 'if (uMorph > 0.0) {', 'glsl', 'POINT_VS · glsl.js'],
  oct: ['layouts.js', 'function octCnt(r, c, d)', 'js', 'octCnt · layouts.js'],
  rays: ['diagonals.js', 'export function rayQuadratic', 'js', 'rayQuadratic · diagonals.js'],
  tri: ['layouts.js', 'export function triPos(k)', 'js', 'triPos · layouts.js'],
  gauss: ['numtheory.js', 'export function gaussPrime', 'js', 'gaussPrime · numtheory.js'],
  div: ['numtheory.js', 'if (mode === MODE.divisors) {', 'js', 'arithBytes · numtheory.js'],
  li: ['numtheory.js', 'export function li(x)', 'js', 'li · numtheory.js'],
};

export function installSaver(app) {
  const { S, L, T } = app;
  const M = T.MODE;
  let st = null;     // the director state while the saver runs

  // --- helpers ------------------------------------------------------------------
  const modeName = id => (app.MODES.find(m => m.id === id) || { name: '' }).name;
  function setUp({ shape, mode = M.primes, P = {}, style = 2, pal, quad = null, labels = true, diag = false, bloom }) {
    S.P = { ...L.DEFAULT_P, ...P };
    S.shape = shape; S.morph = null; S.walk = null; S.fly = null; S.sweep = null; S.palB = null;
    S.mode = mode;
    if (mode >= M.divisors && mode <= M.totient && app.R().arith.mode !== mode) app.worker.postMessage({ type: 'arith', mode });
    S.style = style; if (pal) S.pal = pal; S.labels = labels; S.diag = diag;
    S.bloom = bloom != null ? bloom : 1.0; S.compA = 0.05; S.dotR = 0.36;
    S.quad = quad ? { on: true, max: null, ...quad } : { on: false, a: 1, b: 1, c: 41, max: null };
    S.tile.have = null; S.marks = [];
    app.shapeChanged();
    if (diag) app.computeRays();
  }
  const pick = a => a[Math.floor(st.rnd() * a.length)];
  const PALS = ['aurora', 'ember', 'orchid', 'ice', 'spectral', 'gold'];
  // A prime near the origin of the square spiral (within ring r).
  function primeCell(r) {
    for (let i = 0; i < 400; i++) {
      const x = Math.round((st.rnd() * 2 - 1) * r), y = Math.round((st.rnd() * 2 - 1) * r);
      const n = L.nAt(S.shape, S.P, x, y);
      if (n > 1 && app.isPrimeN(n)) return { x, y, n };
    }
    return { x: 1, y: 0, n: 2 };
  }
  const piParams = N => {
    if (!S.bits || !(N > 10)) return [];
    if (N > S.limit) {
      // past the sieve: the estimates only
      return [{ sym: '\\mathrm{li}(N)', name: `≈ π(${app.fmtS(N)})`, value: app.fmt(T.li(N) - T.li(2)), cls: 'm1' }, { sym: 'N/\\ln N', name: 'estimate', value: app.fmt(N / Math.log(N)), cls: 'm2' }];
    }
    const c = Math.min(N, S.limit), pi = T.piFrom(S.bits, S.blocks, c), nl = c / Math.log(c);
    return [{ sym: '\\pi(N)', name: `primes ≤ ${app.fmtS(c)}`, value: app.fmt(pi), cls: 'm1' }, { sym: 'N/\\ln N', name: 'estimate', value: `${app.fmt(nl)} (${(pi / nl).toFixed(3)})`, cls: 'm2' }];
  };

  // --- the shots --------------------------------------------------------------------
  // setup(sh) runs at the cut and fills sh.title, sh.sub, sh.code;
  // update(sh, u, dt, v) runs each frame, u = t / dur in 0..1.
  const SHOTS = {
    count: {
      kind: 'animation',
      setup(sh) {
        const shape = L.SHAPE[pick(['square', 'square', 'hex', 'tri', 'octagon', 'diamond'])];
        setUp({ shape, pal: pick(PALS), style: pick([0, 2, 2]) });
        sh.kEnd = pick([20000, 60000, 120000]) * (0.7 + 0.3 * (1 - st.calm));
        S.walk = { k: 0, max: Infinity, follow: false, rate: 0 };
        S.cam = { x: 0, y: 0, z: 70 };
        sh.title = shape.key === 'square' ? 'Ulam spiral' : spiralName(shape);
        sh.sub = 'Counted out from the centre: each prime lights as the count passes it';
        sh.code = shape.kind === 'hex' ? (shape.key === 'tri' ? 'tri' : 'hex') : shape.key === 'octagon' ? 'oct' : 'sq';
      },
      update(sh, u, dt, v) {
        const k = (sh.kEnd + 1) ** (u ** 1.25) - 1;
        S.walk.k = k;
        const stt = L.startOf(S.shape, S.P), b = app.bboxOf(S.shape, stt, stt + Math.max(9, Math.ceil(k * 1.12)), 120);
        const c = app.fitCam(b, 0.82, v); c.z = Math.min(c.z, 70);
        const a = 1 - Math.exp(-dt * 3);
        S.cam.x = lerp(S.cam.x, c.x, a); S.cam.y = lerp(S.cam.y, c.y, a); S.cam.z = Math.exp(lerp(Math.log(S.cam.z), Math.log(c.z), a));
        sh.region = [1, Math.round(k)];
      },
    },
    sacks: {
      kind: 'animation',
      setup(sh) {
        setUp({ shape: L.SHAPE.sacks, pal: pick(PALS), style: 2, quad: st.rnd() < 0.5 ? { a: 1, b: 1, c: 41 } : null });
        sh.kEnd = pick([30000, 80000]);
        S.walk = { k: 0, max: Infinity, follow: false, rate: 0 };
        S.cam = { x: 0, y: 0, z: 40 };
        sh.title = 'Sacks spiral'; sh.sub = 'n at radius √n: the squares on one ray, the primes on curves'; sh.code = 'sacks';
      },
      update(sh, u, dt, v) {
        const k = (sh.kEnd + 1) ** (u ** 1.15) - 1;
        S.walk.k = k;
        const r = Math.sqrt(k + 4) + 1.5;
        const z = Math.min(40, 0.86 * Math.min(v.cw, v.ch) / (2 * r));
        S.cam.x = 0; S.cam.y = 0; S.cam.z = Math.exp(lerp(Math.log(S.cam.z), Math.log(z), 1 - Math.exp(-dt * 3)));
        sh.region = [1, Math.round(k)];
      },
    },
    tour: {
      kind: 'animation',
      setup(sh) {
        const tours = [['square', 'sacks', 'hex'], ['square', 'fermat', 'diamond'], ['hex', 'tri', 'octagon'], ['klauber', 'square', 'sacks'], ['klauber', 'square', 'diamond'], ['diamond', 'log', 'hex'], ['square', 'rect', 'octagon'], ['sacks', 'fermat', 'archi']];
        sh.seq = pick(tours).map(k => L.SHAPE[k]);
        setUp({ shape: sh.seq[0], pal: pick(PALS), style: 2, P: { w: 30, cut: 4, L: 12 } });
        S.cam = app.homeCam(sh.seq[0]);
        sh.step = 0; sh.next = 0.12;
        sh.title = 'Shape tour'; sh.sub = sh.seq.map(s => s.name).join(' → '); sh.code = 'morph';
      },
      update(sh, u) {
        if (!S.morph && sh.step < sh.seq.length - 1 && u >= sh.next) {
          sh.step++;
          app.startMorph(sh.seq[sh.step], Math.max(2.2, sh.dur * 0.3), { count: 90000 });
          sh.next = u + 0.44;
        }
        sh.region = [L.startOf(S.shape, S.P), S.morph ? S.morph.n0 + S.morph.count : app.nSpan(S.shape).hi];
      },
    },
    sweep: {
      kind: 'animation',
      setup(sh) {
        const shape = L.SHAPE[pick(['square', 'hex', 'square', 'diamond'])];
        const mode = pick([M.primes, M.twin, M.divisors]);
        setUp({ shape, mode, pal: pick(PALS), style: 2, labels: false });
        S.palB = pick(PALS.filter(p => p !== S.pal));
        const c = app.homeCam(shape);
        S.cam = { x: c.x, y: c.y, z: c.z * 1.6 };
        sh.z1 = c.z * 0.55;
        sh.title = shape.key === 'square' ? 'Ulam spiral' : spiralName(shape);
        sh.sub = `${app.PALETTES[S.palB].name} sweeps over ${app.PALETTES[S.pal].name}: ${modeName(mode).toLowerCase()}`;
        sh.code = mode === M.divisors ? 'div' : 'gisp';
      },
      update(sh, u, dt, v) {
        const R = Math.hypot(v.w, v.h) / S.cam.z;
        // palB (the new map) spreads out from the centre (glsl shadeV mix)
        S.sweep = { x: 0, y: 0, r: easeIO(u) * R * 0.75, w: R * 0.12 };
        S.cam.z = Math.exp(lerp(Math.log(S.cam.z), Math.log(sh.z1), 1 - Math.exp(-dt * 0.35)));
        sh.region = [1, app.nSpan(S.shape).hi];
      },
      end() { if (S.palB) S.pal = S.palB; S.sweep = null; S.palB = null; },
    },
    euler: {
      kind: 'animation',
      setup(sh) {
        setUp({ shape: L.SHAPE.square, pal: pick(PALS), style: 2, P: { start: 41 }, quad: { a: 1, b: 1, c: 41, max: 0 } });
        S.compA = 0.04;
        sh.kq = 0; sh.dir = st.rnd() < 0.5 ? 1 : -1;
        S.cam = { x: 0, y: 0, z: 26 };
        sh.title = 'Euler’s polynomial'; sh.sub = 'n² + n + 41 runs down one diagonal of the spiral that starts at 41'; sh.code = 'quad';
      },
      update(sh, u, dt, v) {
        // the values light from k = 0 outwards (even k on one half-line, odd
        // k on the other); the camera follows the even front and pulls back
        const kmax = 24 + 200 * u ** 1.3;
        S.quad.max = kmax;
        const k = Math.floor(kmax) & ~1, p = L.posOf(S.shape, k * k + k + 41, S.P);   // even k: one half-line
        const dist = Math.hypot(p[0], p[1]);
        const z = clamp(0.85 * Math.min(v.cw, v.ch) / (dist + 8), 5, 24);
        const a = 1 - Math.exp(-dt * 2.5);
        S.cam.z = Math.exp(lerp(Math.log(S.cam.z), Math.log(z), a));
        S.cam.x = lerp(S.cam.x, p[0] * 0.5, a); S.cam.y = lerp(S.cam.y, p[1] * 0.5, a);
        sh.region = [41, 41 + Math.round(kmax) ** 2];
        sh.params = [{ sym: 'C(f)', name: 'Bateman–Horn', value: S.quadInfo ? S.quadInfo.C.toFixed(4) : '6.6405', cls: 'm5' },
          { sym: 'k', name: 'values lit', value: String(Math.round(kmax)), cls: 'm3' }];
      },
    },
    zoomout: {
      kind: 'exploration',
      setup(sh) {
        const shape = L.SHAPE[pick(['square', 'square', 'hex', 'diamond'])];
        setUp({ shape, mode: pick([M.primes, M.primes, M.twin]), pal: pick(PALS), style: pick([0, 2]) });
        const c = primeCell(shape.kind === 'hex' ? 30 : 60);
        const [wx, wy] = L.worldOf(shape, c.x, c.y);
        sh.from = { x: wx, y: wy, z: 110 }; sh.to = { x: 0, y: 0, z: 0.16 + 0.06 * st.calm };
        S.cam = { ...sh.from }; sh.cell = c;
        sh.title = shape.key === 'square' ? 'Ulam spiral' : spiralName(shape);
        sh.sub = `From ${app.fmt(c.n)} out to millions of numbers`; sh.code = 'gisp';
      },
      update(sh, u) {
        const e = easeIO(u);
        S.cam.z = Math.exp(lerp(Math.log(sh.from.z), Math.log(sh.to.z), e));
        const g = clamp((Math.log(sh.from.z) - Math.log(S.cam.z)) / 3, 0, 1);
        S.cam.x = lerp(sh.from.x, sh.to.x, ease(g)); S.cam.y = lerp(sh.from.y, sh.to.y, ease(g));
        sh.region = [1, app.nSpan(S.shape).hi];
        S.marks = u < 0.25 ? [{ w: L.worldOf(S.shape, sh.cell.x, sh.cell.y), a: 1 - u * 4 }] : [];
      },
    },
    zoomin: {
      kind: 'exploration',
      setup(sh) {
        const shape = L.SHAPE[pick(['square', 'hex', 'octagon'])];
        setUp({ shape, pal: pick(PALS), style: pick([0, 2]), P: { cut: 4 } });
        const c = primeCell(80);
        const [wx, wy] = L.worldOf(shape, c.x, c.y);
        sh.from = { x: 0, y: 0, z: 0.17 }; sh.to = { x: wx, y: wy, z: 95 };
        S.cam = { ...sh.from }; sh.cell = c;
        sh.title = shape.key === 'square' ? 'Ulam spiral' : spiralName(shape);
        sh.sub = `From millions of numbers down to ${app.fmt(c.n)}`; sh.code = shape.key === 'octagon' ? 'oct' : 'sq';
      },
      update(sh, u) {
        const e = easeIO(u);
        S.cam.z = Math.exp(lerp(Math.log(sh.from.z), Math.log(sh.to.z), e));
        const g = clamp(1 - (Math.log(sh.to.z) - Math.log(S.cam.z)) / 3, 0, 1);
        S.cam.x = lerp(sh.from.x, sh.to.x, ease(g)); S.cam.y = lerp(sh.from.y, sh.to.y, ease(g));
        sh.region = [1, app.nSpan(S.shape).hi];
        S.marks = u > 0.8 ? [{ w: L.worldOf(S.shape, sh.cell.x, sh.cell.y), a: (u - 0.8) * 5 }] : [];
      },
    },
    diagonal: {
      kind: 'exploration',
      setup(sh) {
        setUp({ shape: L.SHAPE.square, pal: pick(PALS), style: 2, diag: true, P: { start: pick([1, 41, 17, 1]) } });
        const rays = S.rays.length ? S.rays : [{ start: [0, 0], d: [1, 1], a: 4, b: 0, c0: 1, ratio: 1, steps: 100, t0: 0 }];
        const r = rays[Math.floor(st.rnd() * Math.min(3, rays.length))];
        sh.ray = r;
        S.rays = [r, ...rays.filter(x => x !== r).slice(0, 2)];
        const len = 70 + 90 * st.rnd();
        sh.a = [r.start[0] + r.d[0] * 6, r.start[1] + r.d[1] * 6];
        sh.b = [r.start[0] + r.d[0] * len, r.start[1] + r.d[1] * len];
        sh.z = pick([7, 10, 14]);
        S.cam = { x: sh.a[0], y: sh.a[1], z: sh.z };
        sh.title = 'A prime-rich diagonal';
        sh.sub = `${T.quadText(r.a, r.b, r.c0, 'm')}: ${r.ratio.toFixed(2)} × the primes of random numbers its size`; sh.code = 'rays';
      },
      update(sh, u) {
        const e = ease(u);
        S.cam.x = lerp(sh.a[0], sh.b[0], e); S.cam.y = lerp(sh.a[1], sh.b[1], e);
        S.cam.z = sh.z * (1 - 0.25 * Math.sin(Math.PI * u));
        sh.region = [1, app.nSpan(S.shape).hi];
        sh.params = [{ sym: 'C', name: 'observed / expected', value: sh.ray.ratio.toFixed(2) + '×', cls: 'm5' }];
      },
    },
    far: {
      kind: 'exploration',
      setup(sh) {
        const shape = L.SHAPE[pick(['square', 'square', 'hex'])];
        const mode = pick([M.primes, M.twin, M.primes]);
        setUp({ shape, mode, pal: pick(PALS), style: pick([0, 2]) });
        const target = pick([1e9, 1e12, 3e11, 1e10]) * (1 + st.rnd());
        const n = Math.round(target);
        const p = L.posOf(shape, n, S.P), [wx, wy] = L.worldOf(shape, p[0], p[1]);
        const ang = st.rnd() * Math.PI * 2, span = 18 + 18 * (1 - st.calm);
        sh.a = { x: wx - Math.cos(ang) * span, y: wy - Math.sin(ang) * span }; sh.b = { x: wx + Math.cos(ang) * span, y: wy + Math.sin(ang) * span };
        sh.z0 = pick([8, 11]); sh.z1 = pick([34, 52]);
        S.cam = { x: sh.a.x, y: sh.a.y, z: sh.z0 };
        sh.n = n;
        sh.title = shape.key === 'square' ? 'Ulam spiral, far out' : 'Hexagonal spiral, far out';
        sh.sub = `Near ${app.fmtS(n)}: every number tested by Miller–Rabin`; sh.code = 'mr';
      },
      update(sh, u) {
        const e = ease(u);
        S.cam.x = lerp(sh.a.x, sh.b.x, e); S.cam.y = lerp(sh.a.y, sh.b.y, e);
        S.cam.z = Math.exp(lerp(Math.log(sh.z0), Math.log(sh.z1), ease(clamp((u - 0.45) / 0.55, 0, 1))));
        const sp = app.nSpan(S.shape);
        sh.region = [sp.lo, sp.hi];
        sh.params = [{ sym: '1/\\ln n', name: 'prime density', value: (1 / Math.log(sh.n)).toFixed(4), cls: 'm2' }];
      },
    },
    twins: {
      kind: 'exploration',
      setup(sh) {
        setUp({ shape: L.SHAPE.square, mode: M.twin, pal: pick(PALS), style: 2 });
        sh.pairs = [];
        for (let i = 0; i < 300 && sh.pairs.length < 3; i++) {
          const c = primeCell(30 + 60 * i / 300);
          if (app.isPrimeN(c.n + 2)) {
            const q = L.posOf(S.shape, c.n + 2, S.P);
            sh.pairs.push({ a: L.worldOf(S.shape, c.x, c.y), b: L.worldOf(S.shape, q[0], q[1]), n: c.n });
          }
        }
        if (!sh.pairs.length) sh.pairs.push({ a: [1, 0], b: [1, 1], n: 3 });
        S.cam = { x: 0, y: 0, z: 2 };
        sh.title = 'Twin primes'; sh.sub = 'p and p + 2 both prime: pairs everywhere, but ever rarer'; sh.code = 'gisp';
      },
      update(sh, u) {
        const k = Math.min(sh.pairs.length - 1, Math.floor(u * sh.pairs.length)), f = u * sh.pairs.length - k;
        const p = sh.pairs[k], m = [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2];
        const q = k ? sh.pairs[k - 1] : null, m0 = q ? [(q.a[0] + q.b[0]) / 2, (q.a[1] + q.b[1]) / 2] : [0, 0];
        // between pairs: out and in again; at a pair: hold close, a slow push
        const zc = 46, zo = 7, fT = 0.35;
        let z, x, y;
        if (f < fT) {
          const s = f / fT;
          const zEnd = zc * (1 + 0.15 * (1 - fT));
          if (k === 0) z = Math.exp(lerp(Math.log(2), Math.log(zc), ease(s)));
          else if (s < 0.5) z = Math.exp(lerp(Math.log(zEnd), Math.log(zo), ease(s * 2)));
          else z = Math.exp(lerp(Math.log(zo), Math.log(zc), ease((s - 0.5) * 2)));
          x = lerp(m0[0], m[0], easeIO(s)); y = lerp(m0[1], m[1], easeIO(s));
        } else { z = zc * (1 + 0.15 * (f - fT)); x = m[0]; y = m[1]; }
        S.cam.x = x; S.cam.y = y; S.cam.z = z;
        S.marks = f > fT ? [{ w: p.a, a: Math.min(1, (f - fT) * 6) }, { w: p.b, a: Math.min(1, (f - fT) * 6) }] : [];
        sh.sub = `${app.fmt(p.n)} and ${app.fmt(p.n + 2)}: both prime`;
        sh.region = [p.n, p.n + 2];
      },
    },
    explore: {
      kind: 'exploration',
      setup(sh) {
        const opts = [
          ['hex', M.primes, {}], ['tri', M.primes, {}], ['octagon', M.twin, { cut: pick([2, 4, 6]) }], ['diamond', M.primes, {}],
          ['rows', M.primes, { w: pick([6, 30, 210, 42]) }], ['snake', M.primes, { w: pick([30, 60]) }], ['klauber', M.primes, {}],
          ['gauss', M.gauss, {}], ['eisen', M.eisen, {}], ['fermat', M.primes, {}], ['archi', M.primes, { w: pick([30, 44, 60]) }],
          ['rect', M.primes, { L: pick([10, 30]) }], ['hilbert', M.primes, {}], ['cantor', M.primes, {}], ['sacks', M.sophie, {}],
          ['log', M.primes, { g: pick([2, 3]) }], ['rings', M.primes, {}],
        ];
        const [key, mode, P] = pick(opts), shape = L.SHAPE[key];
        setUp({ shape, mode, P, pal: pick(PALS), style: shape.kind === 'pt' ? 2 : pick([0, 2]) });
        const c = app.homeCam(shape);
        const ang = st.rnd() * Math.PI * 2, d = 0.18 * Math.min(VWv().cw, VWv().ch) / c.z;
        const zk = key === 'rows' || key === 'snake' || key === 'klauber' ? pick([1, 1.4]) : pick([1.2, 2.5, 4]);
        sh.a = { x: c.x - Math.cos(ang) * d, y: c.y - Math.sin(ang) * d, z: c.z * zk };
        sh.b = { x: c.x + Math.cos(ang) * d, y: c.y + Math.sin(ang) * d, z: sh.a.z * pick([0.55, 1.8]) };
        S.cam = { ...sh.a };
        sh.title = shape.name.replace(/^(Hexagonal|Octagon|Diamond)$/, '$1 spiral');
        sh.sub = `${shape.note.split('. ')[0]}. Highlight: ${modeName(mode).toLowerCase()}`;
        sh.code = key === 'gauss' || key === 'eisen' ? 'gauss' : shape.kind === 'hex' ? 'hex' : key === 'octagon' ? 'oct' : shape.kind === 'pt' ? 'sacks' : 'sq';
      },
      update(sh, u) {
        const e = ease(u);
        S.cam.x = lerp(sh.a.x, sh.b.x, e); S.cam.y = lerp(sh.a.y, sh.b.y, e); S.cam.z = Math.exp(lerp(Math.log(sh.a.z), Math.log(sh.b.z), e));
        const fs = app.frameState(VWv());
        sh.region = L.isLattice(S.shape) ? [L.startOf(S.shape, S.P), app.nSpan(S.shape).hi] : fs.points ? [fs.points.n0, fs.points.n0 + fs.points.count] : null;
      },
    },
    orbit: {
      kind: 'exploration',
      setup(sh) {
        const shape = L.SHAPE[pick(['helix', 'cone', 'pyramid'])];
        setUp({ shape, pal: pick(PALS), style: 2, P: { w: pick([30, 36, 60]) }, mode: shape.key === 'helix' ? M.primes : pick([M.primes, M.twin]) });
        S.cam3 = app.home3(shape);
        sh.c0 = { ...S.cam3 }; sh.spin = (st.rnd() < 0.5 ? -1 : 1) * (0.5 + 0.4 * (1 - st.calm));
        sh.title = shape.name.replace(' (3D)', '');
        sh.sub = shape.note; sh.code = shape.key === 'helix' ? 'sacks' : 'sq';
      },
      update(sh, u) {
        const c = S.cam3;
        c.yaw = sh.c0.yaw + sh.spin * u * 1.6;
        c.pitch = sh.c0.pitch + 0.18 * Math.sin(u * Math.PI);
        c.dist = sh.c0.dist * (1.05 - 0.3 * ease(u));
        sh.region = [L.startOf(S.shape, S.P), L.startOf(S.shape, S.P) + 1e5];
      },
    },
    heat: {
      kind: 'exploration',
      setup(sh) {
        const mode = pick([M.divisors, M.spf, M.totient]);
        const shape = L.SHAPE[pick(['square', 'hex', 'rows'])];
        setUp({ shape, mode, P: { w: pick([30, 60]) }, pal: pick(['ember', 'aurora', 'spectral', 'gold']), style: pick([0, 2]), labels: false });
        const c = app.homeCam(shape);
        sh.a = { x: c.x, y: c.y, z: c.z * 3 }; sh.b = { x: c.x, y: c.y, z: c.z * 0.7 };
        S.cam = { ...sh.a };
        sh.title = modeName(mode); sh.sub = app.MODES.find(m => m.id === mode).note; sh.code = 'div';
      },
      update(sh, u) {
        S.cam.z = Math.exp(lerp(Math.log(sh.a.z), Math.log(sh.b.z), easeIO(u)));
        sh.region = [1, app.nSpan(S.shape).hi];
      },
    },
  };
  const VWv = () => app.view();
  // 'Hexagonal' -> 'Hexagonal spiral'; 'Triangular spiral' stays as it is
  function spiralName(shape) { return /spiral/i.test(shape.name) ? shape.name : shape.name + ' spiral'; }

  // --- the plate --------------------------------------------------------------------
  async function plate(sh, force) {
    if (!st || !st.label) return;
    const reg = sh.region;
    const params = [];
    params.push({ sym: '\\text{shape}', name: 'layout', value: S.shape.name, cls: 'm6' });
    if (reg && reg[1] > 0) params.push({ sym: 'n', name: 'region', value: `${app.fmtS(Math.max(0, reg[0]))} – ${app.fmtS(reg[1])}`, cls: 'm3' });
    params.push({ sym: '\\text{mark}', name: 'highlighted', value: modeName(S.mode) + (S.quad.on ? ' · f(n)' : ''), cls: 'm4' });
    if (sh.params) params.push(...sh.params);
    if (reg && reg[1] > 10 && params.length < 6) params.push(...piParams(reg[1]).slice(0, 6 - params.length));
    const key = JSON.stringify([sh.title, sh.sub, params.map(p => p.value)]);
    if (!force && key === st.plateKey) return;
    st.plateKey = key;
    const c = CODE[sh.code] || CODE.sq;
    if (!sh.codeText && sh.codeText !== null) sh.codeText = await extract(c[0], c[1], 11);
    st.label({
      title: sh.title, sub: sh.sub, params,
      code: sh.codeText ? { lang: c[2], name: c[3], text: sh.codeText } : undefined,
    });
  }

  // --- the director ------------------------------------------------------------------
  function nextShot() {
    if (st.cur && SHOTS[st.cur.type].end) SHOTS[st.cur.type].end(st.cur);
    if (st.qi >= st.queue.length) { st.queue = shuffled(); st.qi = 0; }
    const type = st.queue[st.qi++];
    const sh = { type, t: 0, dur: clamp(5 + 4 * st.calm + st.rnd() * 3, 5, 12) };
    if (type === 'tour') sh.dur = clamp(sh.dur + 2, 9, 12);
    S.cam3 = null; S.marks = [];
    SHOTS[type].setup(sh);
    st.cur = sh; st.cuts++; st.cutAt = performance.now();
    st.log.push({ type, dur: +sh.dur.toFixed(1), at: +((performance.now() - st.t0) / 1000).toFixed(1) });
    if (st.log.length > 60) st.log.shift();
    S.dirty = true;
    plate(sh, true);
  }
  function shuffled() {
    const a = Object.keys(SHOTS);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(st.rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    // no two exploration far shots back to back with the last of the old queue
    if (st.cur && a[0] === st.cur.type) a.push(a.shift());
    return a;
  }
  function frameHook(dt, v) {
    if (!st) return;
    const sh = st.cur;
    if (!sh) return;
    sh.t += dt;
    const u = clamp(sh.t / sh.dur, 0, 1);
    SHOTS[sh.type].update(sh, u, dt, v);
    S.animating = true; S.dirty = true;
    if (performance.now() - (st.plateAt || 0) > 1500) { st.plateAt = performance.now(); plate(sh); }
    if (sh.t >= sh.dur) nextShot();
  }
  function overlayHook(ctx, v) {
    for (const m of S.marks || []) {
      if (!m.w) continue;
      const [sx, sy] = app.toScreen(m.w[0], m.w[1], v);
      const r = Math.max(9, S.cam.z * 0.7);
      ctx.save();
      ctx.globalAlpha = clamp(m.a, 0, 1);
      ctx.strokeStyle = 'rgba(255,214,140,0.95)'; ctx.lineWidth = 2; ctx.shadowColor = 'rgba(255,196,107,0.9)'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
  function composite() {
    if (!st || !st.c2) return;
    const cv = st.cv, gl = app.gl;
    if (cv.width !== gl.width || cv.height !== gl.height) { cv.width = gl.width; cv.height = gl.height; }
    const c = st.c2;
    c.drawImage(gl, 0, 0);
    c.drawImage(app.ov, 0, 0);
    const sh = st.cur, FADE = 0.7;
    if (sh) {
      const f = Math.max(0, 1 - sh.t / FADE, 1 - (sh.dur - sh.t) / FADE, 1 - (performance.now() - st.t0) / 1500);
      if (f > 0) { c.fillStyle = `rgba(0,0,0,${Math.min(1, f)})`; c.fillRect(0, 0, cv.width, cv.height); }
    }
  }

  window.snSaver = {
    async enter(opts = {}) {
      const calm = clamp(+opts.calm || 0, 0, 1);
      while (!(S.bits && app.R())) await new Promise(r => setTimeout(r, 50));
      document.documentElement.classList.add('sn-saver');
      app.setOpen(false);
      S.saver = true;
      const cv = document.createElement('canvas'); cv.id = 'saver-cv'; document.body.appendChild(cv);
      st = { calm, rnd: mulberry(opts.seed), label: typeof opts.label === 'function' ? opts.label : null, cv, c2: cv.getContext('2d', { alpha: false }),
        queue: [], qi: 0, cur: null, cuts: 0, t0: performance.now(), log: [], saved: { P: { ...S.P }, shape: S.shape, mode: S.mode, pal: S.pal, style: S.style, labels: S.labels, diag: S.diag, quad: { ...S.quad }, bloom: S.bloom, cam: { ...S.cam } } };
      st.queue = shuffled();
      S.frameHook = frameHook; S.overlayHook = overlayHook; S.saverComposite = composite;
      nextShot();
      return { canvas: cv, warmupMs: 1200 };
    },
    exit() {
      if (!st) return;
      if (st.label) st.label(null);
      const sv = st.saved;
      st.cv.remove();
      S.frameHook = null; S.overlayHook = null; S.saverComposite = null; S.saver = false; S.animating = false;
      S.sweep = null; S.palB = null; S.walk = null; S.morph = null; S.marks = [];
      Object.assign(S, { P: sv.P, shape: sv.shape, mode: sv.mode, pal: sv.pal, style: sv.style, labels: sv.labels, diag: sv.diag, quad: sv.quad, bloom: sv.bloom, cam: sv.cam, cam3: null });
      document.documentElement.classList.remove('sn-saver');
      st = null;
      app.shapeChanged();
      if (!app.PHONE_Q.matches) app.setOpen(true);
    },
    debug() {
      if (!st) return null;
      const sh = st.cur;
      return {
        shot: sh && { type: sh.type, t: +sh.t.toFixed(2), dur: +sh.dur.toFixed(2), title: sh.title },
        shape: S.shape.key, mode: S.mode, cam: { x: +S.cam.x.toFixed(2), y: +S.cam.y.toFixed(2), z: +S.cam.z.toFixed(4) },
        cam3: S.cam3 && { yaw: +S.cam3.yaw.toFixed(3), dist: +S.cam3.dist.toFixed(1) },
        walk: S.walk && Math.round(S.walk.k), morph: S.morph && +S.morph.e.toFixed(3), quadMax: S.quad.on ? S.quad.max : null,
        sweep: S.sweep && +S.sweep.r.toFixed(1), tile: { on: S.tileOn, pending: !!S.tile.pending, ms: S.tile.ms || 0 },
        cuts: st.cuts, log: st.log.slice(-20), band: app.view().o,
      };
    },
  };
}
