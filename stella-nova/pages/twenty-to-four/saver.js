// ============================================================================
//  TWENTY TO FOUR  ·  saver.js — the screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell screensaver (lib/screensaver.js) calls snSaver.enter(opts) with
//  opts = { calm, seconds, caption, seed, label, labels }. enter() hides the
//  page GUI (html.t24-saver: only the stage canvas shows), then a shot
//  director plays a seeded bag of shots, 6 to 12 s each, with a fade
//  through dark at each cut. It returns { canvas: #gl, warmupMs }. The
//  canvas stays in the document.
//
//  SHOTS (no kind twice in a row; the seed changes the order and details)
//      fold      the twenty lines fold into four laws, then into two forms
//      detach    a push-in on the E loops that pinch off near kr = 1
//      lobe      the 3D field turning: sheets, B rings, the sin²θ lobe
//      curl      three loops add up to the curl, which lands on the
//                displacement current (B) or on −∂B/∂t (E)
//      cube      six face fluxes in three pairs cancel: ∇·E = 0
//      gauge     the gauge blob swells; A swirls, the E lines stay still
//      boundary  the face loops of a cube cancel on every edge: ∂∂ = 0
//
//  FRAMING. Every 250 ms plateBand() (lib/saver-clear.js) gives the clear
//  band between the plate's top and bottom text. S.band carries it to the
//  renderer, which scales the scene into that band (scenes.js bandOf).
//
//  PLATE. opts.label gets the shot title, a sub line, the TeX of the law
//  (from tex.js, so the colours match the stage), and live parameters. No
//  code extract on this plate.
//
//  grep -n: "const DECK"  "function makeShot"  "function apply"  "function plate"  "enter(opts"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';
import { TEX, LAWS } from './tex.js';
import * as F from './field.js';

const DECK = ['fold', 'fold', 'detach', 'detach', 'lobe', 'lobe', 'curl', 'curl', 'cube', 'gauge', 'boundary'];
const PROBES = [[0.55, 0, 0.32], [0.42, 0, -0.26], [0.78, 0, 0.46], [0.36, 0, 0.12], [0.64, 0, -0.4]];
const SCENE = { fold: 'twenty', detach: 'field', lobe: 'four', cube: 'div', gauge: 'gauge', boundary: 'forms' };
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const T = k => TEX[k][0];

export function installSaver(ctx) {
  const { S, stage, layout, setChapter, canvas } = ctx;
  let run = null, saved = null;

  function makeShot(kind, r, calm) {
    const pick = a => a[Math.floor(r() * a.length)];
    const sh = { kind, dur: lerp(7, 11, calm) + r() * 1.2 };
    if (kind === 'fold') sh.dur = 12;
    if (kind === 'detach') Object.assign(sh, { z0: lerp(0.95, 1.1, r()), z1: lerp(0.3, 0.38, r()), aim: [lerp(0.3, 0.4, r()), 0, lerp(-0.04, 0.08, r())], map: pick(['B', 'B', 'none']), lam: pick([1, 1, 0.9]) });
    if (kind === 'lobe') Object.assign(sh, { pitch0: lerp(-0.25, 0.3, r()), pitch1: lerp(0.1, 0.6, r()), zoom0: lerp(1.05, 1.2, r()), zoom1: lerp(0.8, 0.95, r()) });
    if (kind === 'curl') Object.assign(sh, { which: pick(['B', 'E']), probe: pick(PROBES), dur: 8 });
    if (kind === 'cube') Object.assign(sh, { probe: pick(PROBES), dur: 8 });
    if (kind === 'boundary') Object.assign(sh, { probe: pick(PROBES), dur: 9 });
    if (kind === 'gauge') Object.assign(sh, { g0: 0, g1: lerp(0.75, 1, r()) });
    return sh;
  }

  function start(sh) {
    const ch = sh.kind === 'curl' ? (sh.which === 'B' ? 'curlB' : 'curlE') : SCENE[sh.kind];
    setChapter(ch, { force: true });
    S.camTarget = null; S.camHalf = 1; S.cycle0 = S.clock; S.hl = null;
    S.lam = sh.lam || 1; S.map = sh.map || 'B'; S.arrows = 0; S.lineGap = 0.16;
    if (sh.probe) S.probe = sh.probe.slice();
    if (sh.kind === 'gauge') { S.gauge = 0; S.gaugeMap = 'Az'; }
    if (sh.kind === 'cube') S.divField = 'E';
    if (sh.kind === 'fold') stage.restartFold(S);
    S.snapCam = true;
  }

  // Apply the shot at time t (s). Called every frame from main.js.
  function apply(sh, t) {
    const k = Math.min(1, t / sh.dur), e = ease(k);
    if (sh.kind === 'detach') {
      S.camHalf = lerp(sh.z0, sh.z1, e);
      S.camTarget = [sh.aim[0] * e, 0, sh.aim[2] * e];
    } else if (sh.kind === 'lobe') {
      S.view.pitch = lerp(sh.pitch0, sh.pitch1, e) - 0.34;
      S.view.zoom = lerp(sh.zoom0, sh.zoom1, e);
    } else if (sh.kind === 'gauge') {
      S.gauge = lerp(sh.g0, sh.g1, ease(k / 0.7));
    } else if (sh.kind === 'curl' || sh.kind === 'cube' || sh.kind === 'boundary') {
      S.view.zoom = lerp(1.08, 0.92, e);
    }
    S.fade = Math.max(0, Math.min(1, t / 0.8, (sh.dur - t) / 0.7));
  }

  const TITLES = {
    fold: ['Twenty to four', 'Maxwell’s twenty component equations of 1865 fold into four vector laws, and the four into two'],
    detach: ['Light leaving a dipole', 'Loops of the electric field pinch off near kr = 1 and move out at the speed of light'],
    lobe: ['Four laws, one field', 'E loops in planes through the axis, B rings round it, and the sin²θ radiation pattern'],
    curlB: ['Curl from three small loops', 'Circulation per area on the yz, zx and xy planes adds up to ∇×B, the displacement current'],
    curlE: ['Faraday’s law from three small loops', 'Only the loop that stands in the plane of E circulates; its curl is −∂B/∂t'],
    cube: ['Divergence from a small cube', 'Flux out of six faces, in three pairs; in empty space the pairs cancel'],
    gauge: ['A gauge transformation', 'Adding ∇χ to A swirls the potential, and the electric and magnetic fields do not change'],
    boundary: ['The boundary of a boundary', 'Each edge of the cube is run twice in opposite directions, so dF = d dA = 0'],
  };
  function texOf(sh) {
    if (sh.kind === 'fold') return [LAWS.dF, LAWS.dsF];
    if (sh.kind === 'detach') return [T('lines')];
    if (sh.kind === 'lobe') return [T('power')];
    if (sh.kind === 'curl') return sh.which === 'B' ? [T('curlBvac')] : [T('curlE')];
    if (sh.kind === 'cube') return [T('divE')];
    if (sh.kind === 'gauge') return [T('gaugeA'), T('gaugeP')];
    return [T('ddA')];
  }
  const fmt = v => (Math.abs(v) < 0.0005 ? '0.000' : v.toFixed(3));
  function params(sh) {
    const k = F.kOf(S.lam), kr = k * Math.hypot(S.probe[0], S.probe[2]);
    if (sh.kind === 'fold') return [{ name: 'Maxwell, 1865', value: '20' }, { name: 'Heaviside, 1884', value: '4' }, { name: 'forms', value: '2' }];
    if (sh.kind === 'detach' || sh.kind === 'lobe') return [{ sym: '\\lambda', name: 'wavelength', value: S.lam.toFixed(2), cls: 'm6' }, { sym: 'kr', name: 'near zone edge', value: '1' }, { sym: 'T', name: 'period', value: (4 / Math.max(0.05, S.speed)).toFixed(1) + ' s' }];
    if (sh.kind === 'curl') {
      const r = stage.readouts.curl; if (!r) return [];
      const m = Math.max(1e-12, ...r.lines.map(Math.abs), ...r.cmp.map(Math.abs)), f = r.which === 'B' ? 'B' : 'E', cl = r.which === 'B' ? 'm1' : 'm2';
      return ['x', 'y', 'z'].map((a, i) => ({ sym: `(\\nabla\\times\\mathbf ${f})_${a}`, name: ['yz', 'zx', 'xy'][i] + ' loop', value: fmt(r.loops[i] / m), cls: cl })).concat([{ sym: 'kr', name: 'probe', value: kr.toFixed(2) }]);
    }
    if (sh.kind === 'cube') {
      const r = stage.readouts.div; if (!r) return [];
      const m = Math.max(1e-12, ...r.pairs.map(Math.abs));
      return ['x', 'y', 'z'].map((a, i) => ({ sym: `\\partial_${a} E_${a}`, name: a + ' faces', value: fmt(r.pairs[i] / m), cls: 'm2' })).concat([{ sym: '\\nabla\\cdot\\mathbf E', name: 'sum', value: fmt((r.pairs[0] + r.pairs[1] + r.pairs[2]) / m), cls: 'm2' }]);
    }
    if (sh.kind === 'gauge') {
      const r = stage.readouts.gauge; if (!r) return [];
      const e = v => v < 1e-6 ? '< 10⁻⁶' : v.toExponential(1);
      return [{ sym: 'g', name: 'gauge strength', value: S.gauge.toFixed(2), cls: 'm3' }, { sym: '\\Delta\\mathbf A', name: 'change', value: r.dA.toFixed(2), cls: 'm3' }, { sym: '\\Delta\\mathbf E', name: 'change', value: e(r.dE), cls: 'm2' }, { sym: '\\Delta\\mathbf B', name: 'change', value: e(r.dB), cls: 'm1' }];
    }
    return [{ sym: '\\partial\\partial', name: 'boundary of a boundary', value: '0' }];
  }
  function plate(force) {
    if (!run || !run.label) return;
    const sh = run.shot;
    const key = sh.kind === 'curl' ? (sh.which === 'B' ? 'curlB' : 'curlE') : sh.kind;
    const p = params(sh);
    const info = { title: TITLES[key][0], sub: TITLES[key][1], tex: texOf(sh), params: p, anchor: () => anchor() };
    const js = JSON.stringify([info.title, p]);
    if (!force && js === run.lastLab) return;
    run.lastLab = js;
    run.label(info);
  }
  // The subject on screen, in page CSS px: the centre of the band.
  function anchor() {
    const b = S.band || { t: 0, b: 0 };
    const h = innerHeight - b.t - b.b;
    return { x: innerWidth / 2, y: b.t + h / 2, r: Math.min(innerWidth, h) * 0.35 };
  }

  function tick(dt) {
    if (!run) return;
    const now = performance.now();
    if (now - run.bandAt > 250) { run.bandAt = now; const b = plateBand(innerHeight); S.band = b ? { t: b.t, b: b.b } : null; }
    run.t += dt;
    if (run.t >= run.shot.dur) next();
    apply(run.shot, run.t);
    if (now - run.labAt > 500) { run.labAt = now; plate(false); }
  }

  function next() {
    if (!run.deck.length) {
      const d = DECK.slice();
      for (let j = d.length - 1; j > 0; j--) { const q = Math.floor(run.r() * (j + 1)); [d[j], d[q]] = [d[q], d[j]]; }
      const prev = run.shot ? run.shot.kind : null;
      for (let i = 0; i < d.length; i++) {
        const before = i ? d[i - 1] : prev;
        if (d[i] !== before) continue;
        const j = d.findIndex((k, q) => q > i && k !== before && (q + 1 >= d.length || d[q + 1] !== before));
        if (j > 0) [d[i], d[j]] = [d[j], d[i]];
      }
      run.deck = d;
    }
    run.shot = makeShot(run.deck.shift(), run.r, run.calm);
    run.t = 0; run.count++; run.kinds.push(run.shot.kind);
    start(run.shot);
    run.lastLab = '';
    plate(true);
  }

  window.snSaver = {
    enter(opts = {}) {
      const calm = Math.min(1, Math.max(0, opts.calm ?? 0.7));
      saved = { chapter: S.chapter, lam: S.lam, speed: S.speed, map: S.map, arrows: S.arrows, probe: S.probe.slice(), gauge: S.gauge, playing: S.playing, lineGap: S.lineGap };
      document.documentElement.classList.add('t24-saver');
      S.saver = true; S.playing = true; S.speed = lerp(0.85, 0.45, calm);
      run = { r: rng(opts.seed || ((Math.random() * 1e9) | 0)), calm, deck: [], shot: null, t: 0, count: 0, kinds: [], bandAt: -1e9, labAt: 0,
        label: opts.labels !== false && typeof opts.label === 'function' ? opts.label : null, lastLab: '' };
      layout();
      next();
      S.saverTick = tick;
      return { canvas, warmupMs: 900 };
    },
    exit() {
      run = null; S.saverTick = null; S.saver = false; S.band = null; S.fade = 1;
      S.camTarget = null; S.camHalf = 1;
      document.documentElement.classList.remove('t24-saver');
      if (saved) { Object.assign(S, { lam: saved.lam, speed: saved.speed, map: saved.map, arrows: saved.arrows, probe: saved.probe, gauge: saved.gauge, playing: saved.playing, lineGap: saved.lineGap }); setChapter(saved.chapter, { force: true }); }
      layout();
    },
    debug() {
      if (!run) return null;
      const sh = run.shot;
      return { kind: sh.kind, scene: S.scene, t: +run.t.toFixed(2), dur: +sh.dur.toFixed(2), count: run.count, kinds: run.kinds.slice(-12), fade: +S.fade.toFixed(2), band: S.band };
    },
    cut(kind) { if (run) { run.deck.unshift(kind); next(); } },
  };
}
