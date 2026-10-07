// ============================================================================
//  ANTENNA FIELDS  ·  saver.js — the screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell screensaver (lib/screensaver.js) calls snSaver.enter(opts) with
//  opts = { calm, seconds, caption, seed, label }. enter() hides the page GUI
//  (html.af-saver), turns on S.saver, and starts a shot director. It resolves
//  to { canvas, warmupMs }. The canvas is #field, which stays in the
//  document: in saver mode the overlay goes into it as a texture, and the 3D
//  lobe draws into it through a three.js renderer on the same context.
//
//  SHOTS. A seeded shuffle of a deck of shot kinds. opts.seed changes for
//  each run, so each run plays a new order with new values. A new deck is
//  shuffled when the old one ends, and no kind plays twice in a row.
//    peel ... field lines peeling off a dipole in slow motion, a push-in
//    sweep .. a phased array sweeping its beam from side to side
//    morph .. one dipole growing from short to 3λ/2 (or back), live numbers
//    yagi ... a Yagi-Uda that gains a director every second or two
//    lobe ... the 3D pattern turning, over the dimmed field
//    near ... a push-in on the reactive near field of a short source
//    loop ... a loop of one wavelength, side or top
//  Each shot holds 5 to 12 s (calm 1 is the longest), with a fade through
//  black at each cut.
//
//  FRAMING. main.js clearRect() uses S.band, the clear band between the
//  plate's top and bottom text (lib/saver-clear.js plateBand), read every
//  250 ms.
//
//  PLATE. opts.label gets the shot title, f, the electrical size, Z_in and
//  the gain, and a real extract of field-gl.js (the element sum) or em.js
//  (the moment-method fill, the loop modes, the far-field sum), cut from the
//  loaded source text.
//
//  grep -n: "function makeShot"  "function apply"  "function plate"  "enter(opts"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';

// The plate leaves a band of about a third of the frame height; the page
// zoom fits the default view to that band, which shows too many wavelengths
// for a poster. ZOOM brings the subject closer.
const ZOOM = 0.55;
const DECK = ['peel', 'peel', 'sweep', 'sweep', 'morph', 'yagi', 'yagi', 'lobe', 'lobe', 'near', 'loop'];
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);

// Lines [from, to) after the first line that holds `marker`, from `src`.
function extract(src, marker, from, to) {
  const i = src.indexOf(marker);
  if (i < 0) return '';
  const lines = src.slice(i).split('\n').slice(from, to).map(l => l.replace(/\s+$/, ''));
  const ind = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
  return lines.map(l => l.slice(ind)).join('\n');
}

export function installSaver(ctx) {
  const { S } = ctx;
  let run = null;
  const SRC = { gl: '', em: '' };

  function makeShot(kind, r, calm) {
    const dur = 5 + 5 * calm + r() * 2;
    const pick = a => a[Math.floor(r() * a.length)];
    if (kind === 'peel') {
      const ant = pick([['dipole', { L: 0.5, model: 'sin' }], ['dipole', { L: 1.0, model: 'mom' }], ['hertz', { dl: 0.05 }], ['dipole', { L: 1.25, model: 'sin' }]]);
      return { kind, dur, ant, view: 'side', field: pick(['E', 'E', 'H']), speed: lerp(0.1, 0.18, r()), z0: lerp(1.25, 1.5, r()), z1: lerp(0.6, 0.85, r()), log: false };
    }
    if (kind === 'sweep') {
      const N = pick([8, 10, 12, 16]);
      return { kind, dur, ant: ['array', { N, d: pick([0.45, 0.5]) }], view: 'top', field: pick(['E', 'Savg']), amp: lerp(40, 60, r()), ph: r() * 6.28, speed: lerp(0.25, 0.4, r()), z0: 1, z1: 1 };
    }
    if (kind === 'morph') {
      const up = r() < 0.6;
      return { kind, dur: dur + 2, ant: ['dipole', { model: 'sin' }], view: 'side', field: pick(['E', 'H']), L0: up ? 0.15 : 1.6, L1: up ? 1.6 : 0.15, speed: lerp(0.25, 0.35, r()), z0: 1, z1: 1 };
    }
    if (kind === 'yagi') {
      return { kind, dur: dur + 2, ant: ['yagi', { nd: 0, sd: 0.25, Lz: 0.44 }], view: 'top', field: pick(['Savg', 'E']), nmax: 5 + Math.floor(r() * 4), speed: lerp(0.25, 0.4, r()), z0: 1.15, z1: 1.15, log: true };
    }
    if (kind === 'lobe') {
      const ant = pick([['array', { N: 12, d: 0.5, steer: lerp(-40, 40, r()) }], ['yagi', { nd: 6, sd: 0.3, Lz: 0.43 }], ['dipole', { L: 1.25, model: 'sin' }], ['loop', { C: 1.0 }], ['dipole', { L: 1.5, model: 'sin' }]]);
      return { kind, dur, ant, view: ant[0] === 'array' || ant[0] === 'yagi' ? 'top' : 'side', field: 'E', az: r() * 6.28, azRate: (r() < 0.5 ? -1 : 1) * lerp(0.15, 0.3, r()), el: lerp(0.25, 0.6, r()), speed: 0.3, z0: 1, z1: 1 };
    }
    if (kind === 'near') {
      const ant = pick([['hertz', { dl: 0.05 }], ['loop', { C: 0.15 }], ['dipole', { L: 0.25, model: 'sin' }]]);
      return { kind, dur, ant, view: 'side', field: pick(['S', 'H', 'E']), speed: lerp(0.12, 0.2, r()), z0: 0.85, z1: 0.32 };
    }
    return { kind: 'loop', dur, ant: ['loop', { C: 1.0 }], view: pick(['side', 'top']), field: pick(['E', 'H', 'Savg']), speed: 0.3, z0: 1.1, z1: 0.9 };
  }

  function start(sh) {
    const [type, patch] = sh.ant;
    ctx.setType(type);
    ctx.applyPatch(patch);
    if (sh.kind === 'morph') ctx.applyPatch({ L: sh.L0 });
    if (sh.kind === 'sweep') ctx.applyPatch({ steer: sh.amp * Math.sin(sh.ph) });
    S.view = sh.view; S.field = sh.field;
    S.tog = { lines: true, arrows: sh.kind === 'yagi' && sh.field === 'E', zones: sh.kind === 'near' || sh.kind === 'peel', log: !!sh.log || sh.field === 'Savg' || sh.field === 'S', rcomp: true, grid: false };
    S.speed = sh.speed * run.slow;
    S.cam = { zoom: sh.z0 * ZOOM, panX: 0, panY: 0 };
    S.lobeShot = null;
    if (sh.kind === 'lobe') ctx.ensureSharedLobe().then(() => { if (run && run.shot === sh) { S.lobeShot = { az: sh.az, el: sh.el, dist: 3.6 }; ctx.rebuildNow(); } });
    ctx.rebuildNow();
    ctx.invalidate();
  }

  // Apply the shot at time t (s). Called every frame.
  function apply(sh, t) {
    const k = Math.min(1, t / sh.dur);
    S.cam.zoom = lerp(sh.z0, sh.z1, ease(k)) * ZOOM;
    if (sh.kind === 'sweep') ctx.applyPatch({ steer: sh.amp * Math.sin(sh.ph + t * 2 * Math.PI / Math.max(4, sh.dur * 0.8)) });
    if (sh.kind === 'morph') ctx.applyPatch({ L: lerp(sh.L0, sh.L1, ease(k)) });
    if (sh.kind === 'yagi') {
      const n = Math.min(sh.nmax, Math.floor(k * (sh.nmax + 1.5)));
      if (n !== S.yagi.nd) ctx.applyPatch({ nd: n });
    }
    if (sh.kind === 'lobe' && S.lobeShot) { S.lobeShot.az = sh.az + sh.azRate * t; S.lobeShot.dist = lerp(3.9, 3.3, ease(k)); }
    S.fade = Math.max(0, Math.min(1, t / 0.6, (sh.dur - t) / 0.5));
  }

  function code(sh) {
    if (sh.kind === 'yagi') return { lang: 'js', name: 'em.js · solveWires, the Galerkin fill', text: extract(SRC.em, 'const nodes = [[bn.z - bn.d, 1]', 0, 9) };
    if (sh.kind === 'sweep' || sh.kind === 'lobe') return { lang: 'js', name: 'em.js · farIntensity, the far-field sum', text: extract(SRC.em, 'for (let i = 0; i < L.n; i++) {\n    const o = i * STRIDE;\n    const ph = K', 0, 9) };
    if (sh.kind === 'loop') return { lang: 'js', name: 'em.js · solveLoop, one mode at a time', text: extract(SRC.em, 'for (let n = 0; n <= nModes; n++) {', 0, 8) };
    return { lang: 'glsl', name: 'field-gl.js · the exact element field, per pixel', text: extract(SRC.gl, 'float x = K * R, ix = 1.0 / x;', 0, 12) };
  }
  const TITLES = {
    peel: ['Field lines peeling off', 'Closed loops of E break away from the wire and travel out at c'],
    sweep: ['A phased array steering its beam', 'Equal currents, a progressive phase β: the beam turns with no moving part'],
    morph: ['One dipole, longer and longer', 'Past one wavelength the current reverses and the lobe splits'],
    yagi: ['A Yagi-Uda focusing its lobe', 'Each director is a passive wire: the moment method finds its current'],
    lobe: ['The radiation pattern in 3D', 'Gain over a 30 dB range, from the far-field sum over the elements'],
    near: ['Inside the reactive near field', 'Within λ/2π the 1/r² and 1/r³ terms hold energy and give it back'],
    loop: ['A loop one wavelength around', 'The current is no longer uniform: the Fourier modes solve it'],
  };
  function plate(force) {
    if (!run || !run.label) return;
    const sh = run.shot, A = ctx.A, st = ctx.stats;
    if (!A) return;
    const P = S[S.type], s = ctx.scale();
    const size = S.type === 'dipole' ? ['L', 'length', (P.L * s).toFixed(2) + ' λ'] : S.type === 'loop' ? ['C', 'circumference', (P.C * s).toFixed(2) + ' λ']
      : S.type === 'array' ? ['N', 'elements, d = ' + (P.d * s).toFixed(2) + ' λ', String(P.N)] : S.type === 'yagi' ? ['n', 'elements', String(P.nd + 2)] : ['\\Delta l', 'element', (P.dl * s).toFixed(2) + ' λ'];
    const Z = A.Zin, zs = !Z || !isFinite(Z[0]) ? '∞' : S.type === 'hertz' ? Z[0].toFixed(3) + ' Ω' : Z[0].toFixed(1) + (Z[1] < 0 ? ' − j' : ' + j') + Math.abs(Z[1]).toFixed(1) + ' Ω';
    const params = [
      { sym: 'f', name: 'frequency', value: S.f.toFixed(0) + ' MHz', cls: 'm6' },
      { sym: size[0], name: size[1], value: size[2], cls: 'm3' },
      { sym: S.type === 'hertz' ? 'R_{rad}' : 'Z_{in}', name: S.type === 'array' ? 'active, centre' : 'input', value: zs, cls: 'm4' },
      { sym: 'G', name: 'gain', value: st ? st.Ddb.toFixed(2) + ' dBi' : '…', cls: 'm5' },
    ];
    if (S.type === 'array') params.push({ sym: '\\theta_s', name: 'steering', value: P.steer.toFixed(0) + '°', cls: 'm6' });
    if (S.type === 'yagi' && st) params.push({ sym: 'F/B', name: 'front to back', value: st.fb.toFixed(1) + ' dB', cls: 'm2' });
    const tex = sh.kind === 'sweep' ? ['AF=\\frac{\\sin(N\\psi/2)}{\\sin(\\psi/2)},\\;\\psi=kd\\cos\\phi+\\beta']
      : sh.kind === 'yagi' ? ['\\sum_n Z_{mn}I_n=V_m']
      : sh.kind === 'lobe' ? ['D=4\\pi U_{\\max}/P_{\\mathrm{rad}}']
      : ['E_\\theta=\\frac{j\\eta k\\,I\\Delta l\\sin\\theta}{4\\pi r}\\Big[1+\\frac{1}{jkr}-\\frac{1}{(kr)^2}\\Big]e^{-jkr}'];
    const info = { title: TITLES[sh.kind][0], sub: TITLES[sh.kind][1], params, tex, rules: window.AF_RULES || null, code: run.code };
    const js = JSON.stringify([info.title, params]);
    if (!force && js === run.lastLab) return;
    run.lastLab = js;
    run.label(info);
  }

  function tick(dt) {
    if (!run) return;
    const now = performance.now();
    if (now - run.bandAt > 250) { run.bandAt = now; const b = plateBand(innerHeight); if (b) { S.band = b; } }
    run.t += dt;
    if (run.t >= run.shot.dur) nextShot();
    apply(run.shot, run.t);
    if (now - run.labAt > 500) { run.labAt = now; plate(false); }
  }

  function nextShot() {
    if (!run.deck.length) {
      run.deck = DECK.slice();
      for (let j = run.deck.length - 1; j > 0; j--) { const q = Math.floor(run.r() * (j + 1)); [run.deck[j], run.deck[q]] = [run.deck[q], run.deck[j]]; }
      const d = run.deck, prev = run.shot ? run.shot.kind : null;
      for (let i = 0; i < d.length; i++) {
        const before = i ? d[i - 1] : prev;
        if (d[i] !== before) continue;
        const j = d.findIndex((k, q) => q > i && k !== before && (q + 1 >= d.length || d[q + 1] !== before));
        if (j > 0) [d[i], d[j]] = [d[j], d[i]];
      }
    }
    run.shot = makeShot(run.deck.shift(), run.r, run.calm);
    run.t = 0; run.count++;
    start(run.shot);
    run.code = code(run.shot);
    run.lastLab = '';
    plate(true);
  }

  window.snSaver = {
    enter(opts = {}) {
      const calm = Math.min(1, Math.max(0, opts.calm ?? 0.7));
      document.documentElement.classList.add('af-saver');
      run = { r: rng(opts.seed || ((Math.random() * 1e9) | 0)), calm, slow: 1 - 0.45 * calm, deck: [], shot: null, t: 0, count: 0, bandAt: -1e9, labAt: 0,
        label: typeof opts.label === 'function' ? opts.label : null, lastLab: '', code: null };
      S.saver = true; S.playing = true; S.slow = false; S.exposure = 0; S.f = 300;
      const load = u => fetch(new URL(u, import.meta.url)).then(r => r.text()).catch(() => '');
      return Promise.all([load('./field-gl.js'), load('./em.js')]).then(([g, e]) => {
        SRC.gl = g; SRC.em = e;
        if (!run) return { canvas: ctx.canvas, warmupMs: 0 };
        nextShot();
        S.saverTick = tick;
        return { canvas: ctx.canvas, warmupMs: 800 };
      });
    },
    exit() {
      run = null; S.saverTick = null; S.saver = false; S.band = null; S.fade = 1; S.lobeShot = null;
      document.documentElement.classList.remove('af-saver');
      S.tog.grid = true;
      ctx.syncUI();
      ctx.rebuildNow();
      ctx.invalidate();
    },
    debug() {
      if (!run) return null;
      const sh = run.shot;
      return { kind: sh.kind, t: +run.t.toFixed(2), dur: +sh.dur.toFixed(2), count: run.count, deckLeft: run.deck.slice(), type: S.type, view: S.view, field: S.field,
        fade: +S.fade.toFixed(2), zoom: +S.cam.zoom.toFixed(3), band: S.band, lobe: !!S.lobeShot };
    },
  };
}
