// ============================================================================
//  ULAM SPIRAL  ·  saver.js — the screensaver director (window.snSaver)
// ----------------------------------------------------------------------------
//  Protocol: lib/screensaver.js. enter(opts) { calm, seconds, caption,
//  seed, label } hides the page GUI, makes a 2D composite canvas in the
//  document (#saver-cv: the WebGL frame, then the labels and rings), and
//  returns { canvas, warmupMs }.
//
//  The director builds one spiral per shot, counted out from n = 1: the
//  walk front lights each number as the count passes it, the camera fits
//  the cells counted so far, and the full spiral holds to the cut. The
//  shapes come from a seeded shuffle of BUILDS (20 shapes: the square
//  family, the hex lattices, the point spirals and the three 3D shapes; a
//  new order each run). A shot lasts 8 to 12 s (calm: longer), fades in and
//  out through black, and frames its subject in the clear band of the
//  shell plate (plateBand, read by main.js occlusion()).
//  Each shot sends the plate: the shape, the count so far, the highlight,
//  pi(N) against N/ln N and a short code extract (the shape's position
//  function) read from this page's own source files.
//
//  window.snSaver.debug() gives the director state for the CDP probe, and
//  window.snSaver.cut(key) plays the build of one shape now.
//
//  GREP MAP
//    grep -n 'const BUILDS'       the shapes and their counts
//    grep -n 'const SHOTS'        the build shot
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
      if (depth <= 0 && (j > i || l.includes("}"))) break;
    }
    const pad = Math.min(...out.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length));
    return out.map(l => l.slice(pad)).join('\n');
  } catch (e) { return null; }
}
const CODE = {
  sq: ['layouts.js', 'export function sqPos(k)', 'js', 'sqPos · layouts.js'],
  rect: ['layouts.js', 'export function rectPos(k, L)', 'js', 'rectPos · layouts.js'],
  dia: ['layouts.js', 'export function diaPos(k)', 'js', 'diaPos · layouts.js'],
  rings: ['layouts.js', 'export function conPos(k)', 'js', 'conPos · layouts.js'],
  kla: ['layouts.js', 'export function klaPos(k)', 'js', 'klaPos · layouts.js'],
  can: ['layouts.js', 'export function canPos(k)', 'js', 'canPos · layouts.js'],
  rows: ['layouts.js', 'export function rowPos(k, w)', 'js', 'rowPos · layouts.js'],
  snake: ['layouts.js', 'export function snkPos(k, w)', 'js', 'snkPos · layouts.js'],
  hil: ['layouts.js', 'export function hilbertPos(d)', 'js', 'hilbertPos · layouts.js'],
  z: ['layouts.js', 'export function zPos(d)', 'js', 'zPos · layouts.js'],
  pt: ['layouts.js', 'function ptPos(s, n, k, P)', 'js', 'ptPos · layouts.js'],
  hex: ['layouts.js', 'export function hexPos(k)', 'js', 'hexPos · layouts.js'],
  gisp: ['glsl.js', 'int gIsP(uint n)', 'glsl', 'gIsP · glsl.js'],
  sacks: ['glsl.js', 'float gSacksTurn(uint n)', 'glsl', 'gSacksTurn · glsl.js'],
  oct: ['layouts.js', 'function octCnt(r, c, d)', 'js', 'octCnt · layouts.js'],
  tri: ['layouts.js', 'export function triPos(k)', 'js', 'triPos · layouts.js'],
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
  const piParams = N => {
    if (!S.bits || !(N > 10)) return [];
    if (N > S.limit) {
      // past the sieve: the estimates only
      return [{ sym: '\\mathrm{li}(N)', name: `≈ π(${app.fmtS(N)})`, value: app.fmt(T.li(N) - T.li(2)), cls: 'm1' }, { sym: 'N/\\ln N', name: 'estimate', value: app.fmt(N / Math.log(N)), cls: 'm2' }];
    }
    const c = Math.min(N, S.limit), pi = T.piFrom(S.bits, S.blocks, c), nl = c / Math.log(c);
    return [{ sym: '\\pi(N)', name: `primes ≤ ${app.fmtS(c)}`, value: app.fmt(pi), cls: 'm1' }, { sym: 'N/\\ln N', name: 'estimate', value: `${app.fmt(nl)} (${(pi / nl).toFixed(3)})`, cls: 'm2' }];
  };

  // --- the builds -------------------------------------------------------------------
  // Each shot counts one spiral out from n = 1: the walk front (S.walk.k)
  // grows from 0 to kEnd over the first 82 % of the shot, the camera fits
  // the cells counted so far, and the full spiral holds to the cut.
  // BUILDS holds every shape that counts from a start (not the Gaussian and
  // Eisenstein lattices). P(v) gives the shape parameters, kEnd(v) the count.
  const rot = () => ({ cw: st.rnd() < 0.5, rot: Math.floor(st.rnd() * 4) });
  const sq4 = () => pick([1, 1.5, 2.5]) * 40000;
  // rows of width w: as many rows as fill the clear band
  const rowsEnd = (w, v) => w * clamp(Math.round(w * v.ch / v.cw), 12, 160);
  const BUILDS = {
    square: { P: rot, kEnd: sq4, code: 'sq' },
    rect: { P: () => ({ ...rot(), L: pick([8, 12, 20]) }), kEnd: sq4, code: 'rect' },
    diamond: { P: rot, kEnd: sq4, code: 'dia' },
    octagon: { P: () => ({ ...rot(), cut: pick([2, 4, 6]) }), kEnd: sq4, code: 'oct' },
    rings: { P: rot, kEnd: sq4, code: 'rings' },
    klauber: { P: () => ({}), kEnd: () => pick([10000, 22500, 40000]), code: 'kla' },
    cantor: { P: () => ({}), kEnd: () => pick([12000, 20000]), code: 'can' },
    rows: { P: () => ({ w: pick([60, 90, 210]) }), kEnd: (v, P) => rowsEnd(P.w, v), code: 'rows' },
    snake: { P: () => ({ w: pick([60, 90, 120]) }), kEnd: (v, P) => rowsEnd(P.w, v), code: 'snake' },
    hilbert: { P: () => ({}), kEnd: () => pick([4096, 16384, 65536]), code: 'hil' },
    zorder: { P: () => ({}), kEnd: () => pick([4096, 16384, 65536]), code: 'z' },
    hex: { P: () => ({}), kEnd: sq4, code: 'hex' },
    tri: { P: () => ({}), kEnd: sq4, code: 'tri' },
    sacks: { P: () => ({}), kEnd: () => pick([30000, 80000]), code: 'sacks' },
    archi: { P: () => ({ w: pick([30, 44, 60]) }), kEnd: (v, P) => P.w * pick([40, 60]), code: 'pt' },
    fermat: { P: () => ({}), kEnd: () => pick([20000, 40000]), code: 'pt' },
    log: { P: () => ({ g: pick([2, 3]) }), kEnd: () => pick([20000, 40000]), code: 'pt' },
    helix: { P: () => ({ w: pick([30, 36, 60]) }), code: 'pt' },
    pyramid: { P: () => ({}), code: 'sq' },
    cone: { P: () => ({}), code: 'pt' },
  };
  const SHOTS = {
    build: {
      setup(sh) {
        const shape = L.SHAPE[sh.key], B = BUILDS[sh.key];
        const mode = pick([M.primes, M.primes, M.primes, M.twin]);
        setUp({ shape, mode, P: { start: 1, ...B.P() }, pal: pick(PALS), style: shape.kind === 'pt' || shape.kind === '3d' ? 2 : pick([0, 2, 2]) });
        S.walk = { k: 0, max: Infinity, follow: false, rate: 0 };
        if (shape.kind === '3d') {
          const h = app.home3(shape);
          sh.c0 = h;
          // the helix: up to the height the home camera frames (2 tz)
          sh.kEnd = shape.key === 'helix' ? Math.round(2 * h.tz * S.P.w) : app.n3Count(shape, h);
          sh.spin = (st.rnd() < 0.5 ? -1 : 1) * (0.5 + 0.4 * (1 - st.calm));
          S.cam3 = { ...h, dist: h.dist * 0.05 };
        } else {
          sh.kEnd = Math.round(B.kEnd(VWv(), S.P) * (0.7 + 0.3 * (1 - st.calm)));
          S.cam = { x: 0, y: 0, z: 70 };
        }
        sh.title = spiralName(shape);
        sh.sub = `Counted out from 1: ${shape.note.split('. ')[0].replace(/\.$/, '')}`;
        sh.code = B.code;
      },
      update(sh, u, dt, v) {
        const s = clamp(u / 0.82, 0, 1);
        const k = (sh.kEnd + 1) ** (s ** 1.25) - 1;
        S.walk.k = k;
        sh.region = [1, 1 + Math.round(k)];
        if (S.cam3) {
          // the camera backs off as the shape grows (helix: height ~ k,
          // the others: radius ~ sqrt k) and turns slowly. cam3Mats scales
          // by the full view height, so the distance grows by h / ch to fit
          // the shape in the clear band of the plate.
          const f = S.shape.key === 'helix' ? k / sh.kEnd : Math.sqrt(k / sh.kEnd);
          // (the helix starts on a ring of radius w / 2 pi, so not as close)
          const c = S.cam3, g = clamp(1.5 * f, S.shape.key === 'helix' ? 0.25 : 0.05, 1), fit = clamp(v.h / v.ch, 1, 4);
          c.dist = sh.c0.dist * g * fit; c.tz = S.shape.key === 'helix' ? 0.5 * k / S.P.w : sh.c0.tz * g;
          c.yaw = sh.c0.yaw + sh.spin * u * 1.4;
          c.pitch = sh.c0.pitch + 0.12 * Math.sin(u * Math.PI);
          return;
        }
        const stt = L.startOf(S.shape, S.P), b = app.bboxOf(S.shape, stt, stt + Math.max(9, Math.ceil(k * 1.12)), 120);
        const c = app.fitCam(b, 0.82, v); c.z = Math.min(c.z, 70);
        const a = 1 - Math.exp(-dt * 3);
        S.cam.x = lerp(S.cam.x, c.x, a); S.cam.y = lerp(S.cam.y, c.y, a); S.cam.z = Math.exp(lerp(Math.log(S.cam.z), Math.log(c.z), a));
      },
    },
  };
  const VWv = () => app.view();
  // 'Hexagonal' -> 'Hexagonal spiral'; 'Rows' and 'Hilbert curve' stay as
  // they are; '(3D)' goes
  const SPIRAL_WORD = ['rect', 'diamond', 'octagon', 'hex', 'archi', 'fermat', 'log'];
  function spiralName(shape) {
    if (shape.key === 'square') return 'Ulam spiral';
    return SPIRAL_WORD.includes(shape.key) ? shape.name + ' spiral' : shape.name.replace(' (3D)', '');
  }

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
    const key = st.queue[st.qi++], type = 'build';
    const sh = { type, key, t: 0, dur: clamp(8 + 3 * st.calm + st.rnd() * 1.5, 8, 12) };
    S.cam3 = null; S.marks = [];
    SHOTS[type].setup(sh);
    st.cur = sh; st.cuts++; st.cutAt = performance.now();
    st.log.push({ type, key, dur: +sh.dur.toFixed(1), at: +((performance.now() - st.t0) / 1000).toFixed(1) });
    if (st.log.length > 60) st.log.shift();
    S.dirty = true;
    plate(sh, true);
  }
  function shuffled() {
    const a = Object.keys(BUILDS);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(st.rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    // not the same shape twice across the seam with the old queue
    if (st.cur && a[0] === st.cur.key) a.push(a.shift());
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
    // the probe: play the build of shape `key` now (no key: the next one)
    cut(key) {
      if (!st) return;
      if (BUILDS[key]) st.queue.splice(st.qi, 0, key);
      nextShot();
    },
    debug() {
      if (!st) return null;
      const sh = st.cur;
      return {
        shot: sh && { type: sh.type, key: sh.key, kEnd: sh.kEnd, t: +sh.t.toFixed(2), dur: +sh.dur.toFixed(2), title: sh.title },
        shape: S.shape.key, mode: S.mode, cam: { x: +S.cam.x.toFixed(2), y: +S.cam.y.toFixed(2), z: +S.cam.z.toFixed(4) },
        cam3: S.cam3 && { yaw: +S.cam3.yaw.toFixed(3), dist: +S.cam3.dist.toFixed(1) },
        walk: S.walk && Math.round(S.walk.k), morph: S.morph && +S.morph.e.toFixed(3), quadMax: S.quad.on ? S.quad.max : null,
        sweep: S.sweep && +S.sweep.r.toFixed(1), tile: { on: S.tileOn, pending: !!S.tile.pending, ms: S.tile.ms || 0 },
        cuts: st.cuts, log: st.log.slice(-20), band: app.view().o,
      };
    },
  };
}
