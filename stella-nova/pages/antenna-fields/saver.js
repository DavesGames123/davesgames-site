// ============================================================================
//  ANTENNA FIELDS  ·  saver.js — the screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell screensaver (lib/screensaver.js) calls snSaver.enter(opts) with
//  opts = { calm, seconds, caption, seed, label }. enter() hides the page GUI
//  (html.af-saver), turns on S.saver, and starts a shot director. It resolves
//  to { canvas, warmupMs }. The canvas is #field, which stays in the
//  document; in saver mode the overlay goes into it as a texture.
//
//  SHOTS. Only wavefronts, in a seeded shuffle (opts.seed changes each run,
//  no kind twice in a row):
//    peel ... field lines peeling off a dipole, slow, with a slow push-in
//    sweep .. a phased array: the beam swings and the wavefronts tilt
//    near ... a slow zoom into the near field of a short dipole or a loop
//  Each shot holds 6 to 12 s (calm 1 is the longest), with a fade through
//  black at each cut.
//
//  FRAMING. main.js clearRect() uses S.band, the clear band between the
//  plate's top and bottom text (lib/saver-clear.js plateBand), read every
//  250 ms.
//
//  PLATE. opts.label gets the shot title, the frequency, the size, Z_in and
//  the gain, and a real extract of field-gl.js (the element sum) or em.js
//  (the far-field sum), cut from the loaded source text.
//
//  grep -n: "function makeShot"  "function apply"  "function plate"  "enter(opts"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';

const DECK = ['peel', 'peel', 'sweep', 'sweep', 'near', 'near'];
// The plate leaves a band of about a third of the frame height. ZOOM brings
// the subject closer than the page default.
const ZOOM = 0.55;
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
    const dur = 6 + 5 * calm + r() * 1.5;
    const pick = a => a[Math.floor(r() * a.length)];
    if (kind === 'peel') {
      const ant = pick([['halfwave', { f: 300, model: 'sin' }], ['dipole', { L: 1.0, model: 'mom' }], ['hertz', { dl: 0.05 }], ['dipole', { L: 1.25, model: 'sin' }]]);
      return { kind, dur, ant, view: 'side', field: 'E', speed: lerp(0.1, 0.16, r()), z0: lerp(1.3, 1.5, r()), z1: lerp(0.75, 0.95, r()) };
    }
    if (kind === 'sweep') {
      return { kind, dur, ant: ['array', { N: pick([8, 12, 16]), d: 0.5 }], view: 'top', field: 'E', amp: lerp(35, 55, r()), ph: r() * 6.28, speed: lerp(0.22, 0.32, r()), z0: 1, z1: 0.9 };
    }
    const ant = pick([['hertz', { dl: 0.05 }], ['loop', { C: 0.15 }], ['dipole', { L: 0.3, model: 'sin' }]]);
    return { kind: 'near', dur, ant, view: 'side', field: pick(['E', 'H']), speed: lerp(0.1, 0.16, r()), z0: 0.9, z1: 0.35 };
  }

  function start(sh) {
    ctx.set(sh.ant[0], sh.ant[1], sh.view);
    if (sh.kind === 'sweep') ctx.patch({ steer: sh.amp * Math.sin(sh.ph) });
    S.field = sh.field;
    S.tog = { lines: true, zones: false, log: false };
    S.speed = sh.speed * run.slow; S.speedK = 1;
    S.cam = { zoom: sh.z0 * ZOOM, panX: 0, panY: 0 };
    ctx.rebuildNow();
    ctx.invalidate();
  }

  // Apply the shot at time t (s). Called every frame.
  function apply(sh, t) {
    const k = Math.min(1, t / sh.dur);
    S.cam.zoom = lerp(sh.z0, sh.z1, ease(k)) * ZOOM;
    if (sh.kind === 'sweep') ctx.patch({ steer: sh.amp * Math.sin(sh.ph + t * 2 * Math.PI / Math.max(5, sh.dur * 0.9)) });
    S.fade = Math.max(0, Math.min(1, t / 0.8, (sh.dur - t) / 0.7));
  }

  const TITLES = {
    peel: ['Field lines peeling off', 'Closed loops of electric field break away from the wire and travel outward'],
    sweep: ['A phased array steering its beam', 'A progressive phase between equal currents tilts the wavefronts'],
    near: ['Into the near field', 'Within λ/2π the field stores energy and gives it back each cycle'],
  };
  function code(sh) {
    if (sh.kind === 'sweep') return { lang: 'js', name: 'em.js · farIntensity, the far-field sum', text: extract(SRC.em, 'for (let i = 0; i < L.n; i++) {\n    const o = i * STRIDE;\n    const ph = K', 0, 9) };
    return { lang: 'glsl', name: 'field-gl.js · the exact element field, per pixel', text: extract(SRC.gl, 'float x = K * R, ix = 1.0 / x;', 0, 12) };
  }
  function plate(force) {
    if (!run || !run.label) return;
    const sh = run.shot, A = ctx.A, st = ctx.stats;
    if (!A) return;
    const t = S.type, P = S[t];
    const size = t === 'dipole' ? ['L', 'length', P.L.toFixed(2) + ' λ'] : t === 'halfwave' ? ['L', 'length', '0.50 λ'] : t === 'loop' ? ['C', 'circumference', P.C.toFixed(2) + ' λ']
      : t === 'array' ? ['N', 'elements', String(P.N)] : ['\\Delta l', 'element', P.dl.toFixed(2) + ' λ'];
    const Z = A.Zin, zs = !Z || !isFinite(Z[0]) ? '—' : !isFinite(Z[1]) ? Z[0].toFixed(3) + ' Ω' : Z[0].toFixed(1) + (Z[1] < 0 ? ' − j' : ' + j') + Math.abs(Z[1]).toFixed(1) + ' Ω';
    const params = [
      { sym: 'f', name: 'frequency', value: '300 MHz', cls: 'm6' },
      { sym: size[0], name: size[1], value: size[2], cls: 'm3' },
      { sym: t === 'hertz' ? 'R_{rad}' : 'Z_{in}', name: t === 'array' ? 'centre element' : 'input', value: zs, cls: 'm4' },
      { sym: 'G', name: 'gain', value: st ? st.Ddb.toFixed(2) + ' dBi' : '…', cls: 'm5' },
    ];
    if (t === 'array') params.push({ sym: '\\theta_s', name: 'steering', value: P.steer.toFixed(0) + '°', cls: 'm6' });
    const tex = sh.kind === 'sweep' ? ['AF=\\frac{\\sin(N\\psi/2)}{\\sin(\\psi/2)},\\;\\psi=kd\\cos\\phi+\\beta']
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
    if (now - run.bandAt > 250) { run.bandAt = now; const b = plateBand(innerHeight); if (b) S.band = b; }
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
      S.saver = true; S.playing = true;
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
      run = null; S.saverTick = null; S.saver = false; S.band = null; S.fade = 1;
      document.documentElement.classList.remove('af-saver');
      if (S.type === 'hertz') ctx.set('halfwave', null);
      S.tog = { lines: true, zones: false, log: false };
      ctx.syncUI();
      ctx.rebuildNow();
      ctx.invalidate();
    },
    debug() {
      if (!run) return null;
      const sh = run.shot;
      return { kind: sh.kind, t: +run.t.toFixed(2), dur: +sh.dur.toFixed(2), count: run.count, deckLeft: run.deck.slice(), type: S.type, view: S.view, field: S.field,
        fade: +S.fade.toFixed(2), zoom: +S.cam.zoom.toFixed(3), band: S.band };
    },
  };
}
