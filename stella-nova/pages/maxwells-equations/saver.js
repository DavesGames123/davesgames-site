// ============================================================================
//  MAXWELL'S EQUATIONS  ·  saver.js — the screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell screensaver (lib/screensaver.js) calls snSaver.enter(opts) with
//  opts = { calm, seconds, caption, seed, label }. enter() hides the page GUI
//  (html.mx-saver), takes the camera from the reader, and runs a director:
//  a seeded bag of shots, 6 to 12 s each (calm 1 is the longest), never the
//  same shot twice in a row, with a fade through black at each cut.
//
//  SHOTS  (SHOTS below; each names a scene, its mode and a camera move)
//    gauss       push-in on the breathing Gaussian surface and its marks
//    gaussSide   a low pass round the surface as it swallows a charge
//    monopole    a slow orbit round the ring and its closed lines
//    faraday     push-in on the loop, the disc and the dome
//    ampere      along the wire to the capacitor gap
//    sheet       Stokes on the sheet: the cells close, the rim stays
//    morph       the sheet lifts into a solid (the Stokes morph)
//    dd          the faces of a cube close, and every edge cancels
//    hodge       sheets turn into tubes and back
//    eform       E as sheets, a bead counting them
//    bform       B as tubes round a wire
//    wave        light: the wave and its forms
//
//  FRAMING. The subject sits in the clear band of the plate
//  (lib/saver-clear.js plateBand, read every 250 ms). The camera distance
//  fits the subject radius to the band height; the view offset centres it.
//
//  PLATE. opts.label gets the law, a one-line sub, its TeX (colour classes
//  inside, so rules is null) and up to three live values from the scene's
//  readout. No code extract: this is not a shader page.
//
//  grep -n: "export const SHOTS"  "function makeShot"  "function frameCam"
//           "export function plateFor"  "export function installSaver"
// ============================================================================
import { TEX } from './chapters.js';

const { E, B, RHO, J, Ev, Bv, Jv, d, PD, F, A, STAR, c } = TEX;

// Each shot: scene, mode, params; cam { az: [from, to], el: [from, to],
// push: [from, to] } in degrees and fit factors; r the subject radius;
// at: [[seconds, key, value]] changes during the shot.
export const SHOTS = {
  gauss: { scene: 'laws', mode: 'gauss', params: { auto: true }, t0: [0, 35], r: 1.9, target: [0, 0, -0.4],
    cam: { az: [25, 48], el: [12, 20], push: [1.25, 0.9] },
    title: "Gauss's law", sub: 'The flux out of any closed surface counts the charge inside it',
    tex: [`\\nabla\\cdot ${Ev} = \\frac{${RHO}}{\\varepsilon_0} \\qquad ${d}\\,(${STAR}${E}) = ${RHO}`] },
  gaussSide: { scene: 'laws', mode: 'gauss', params: { auto: true }, t0: [0, 35], r: 2.1, target: [0, 0, -0.5],
    cam: { az: [-70, -20], el: [4, 10], push: [1.1, 1.0] },
    title: "Gauss's law", sub: 'Lines out minus lines in, over 24, is the enclosed charge',
    tex: [`\\oint_{${PD} V} ${Ev}\\cdot d\\mathbf{A} = \\frac{${c('m4', 'Q_V')}}{\\varepsilon_0}`] },
  monopole: { scene: 'laws', mode: 'monopole', params: { auto: true }, t0: [0, 28], r: 2.1, target: [0, 0, 0],
    cam: { az: [10, 60], el: [22, 30], push: [1.15, 0.95] },
    title: 'No magnetic monopoles', sub: 'Every tube of B that leaves a closed surface comes back in',
    tex: [`\\nabla\\cdot ${Bv} = 0 \\qquad ${d}${B} = 0`] },
  faraday: { scene: 'laws', mode: 'faraday', params: { auto: true }, t0: [0, 20], r: 1.7, target: [0, 0, 0.55],
    cam: { az: [35, 15], el: [26, 18], push: [1.2, 0.85] },
    title: "Faraday's law", sub: 'Two surfaces, one rim, one flux, and E circles the change',
    tex: [`\\oint_{C} ${Ev}\\cdot d\\boldsymbol{\\ell} = -\\frac{d}{dt}\\int_{S} ${Bv}\\cdot d\\mathbf{A} \\qquad ${d}${E} + \\partial_t ${B} = 0`] },
  ampere: { scene: 'laws', mode: 'ampere', params: { auto: true }, t0: [0, 20], r: 1.9, target: [0, 0, 0.3],
    cam: { az: [60, 30], el: [8, 16], push: [1.15, 0.9] },
    title: 'The Ampère–Maxwell law', sub: 'Across the gap, the changing E carries the current on',
    tex: [`\\nabla\\times ${Bv} = \\mu_0 ${Jv} + \\mu_0\\varepsilon_0 \\frac{\\partial ${Ev}}{\\partial t}`] },
  sheet: { scene: 'stokes', mode: 'stokes', params: { dim: 2, n: 4, auto: true, instant: true }, r: 1.7, target: [0, 0, 0.1],
    cam: { az: [15, 35], el: [32, 40], push: [1.15, 0.92] },
    title: "Stokes' theorem", sub: 'Inner edges cancel in pairs; only the rim remains',
    tex: [`\\int_{S} ${d}\\alpha = \\oint_{${PD} S} \\alpha`] },
  morph: { scene: 'stokes', mode: 'stokes', params: { dim: 2, n: 3, auto: true, instant: true }, r: 1.8, target: [0, 0, 0.2],
    at: [[2.0, 'dim', 3]],
    cam: { az: [40, 70], el: [20, 28], push: [1.15, 0.95] },
    title: 'One theorem in three sizes', sub: 'A path sweeps a sheet, a sheet sweeps a solid',
    tex: [`\\int_{R} ${d}\\omega \\;=\\; \\int_{${PD} R} \\omega`] },
  dd: { scene: 'stokes', mode: 'dd', params: { auto: true }, r: 1.5, target: [0, 0, 0],
    cam: { az: [30, 75], el: [24, 34], push: [1.2, 0.95] },
    title: 'The boundary of a boundary is empty', sub: 'Every edge of the cube is run twice, once each way',
    tex: [`${PD}${PD} = 0 \\quad\\Longleftrightarrow\\quad ${d}${d} = 0 \\qquad ${F} = ${d}${A} \\Rightarrow ${d}${F} = 0`] },
  hodge: { scene: 'forms', mode: 'hodge', params: { auto: true }, r: 2.7, target: [0, 0, 0],
    cam: { az: [-8, 8], el: [14, 20], push: [1.05, 0.95] },
    title: 'The Hodge star', sub: 'Sheets become tubes: tubes of F never end, tubes of ⋆F end on charge',
    tex: [`${d}${F} = 0 \\qquad ${d}\\,(${STAR}${F}) = ${J}`] },
  eform: { scene: 'forms', mode: 'E', params: { auto: true, q: 1 }, r: 2.5, target: [0, 0, 0],
    cam: { az: [12, 22], el: [12, 16], push: [1.1, 0.92] },
    title: 'The electric field as a 1-form', sub: 'Sheets of potential; a path counts the sheets it crosses',
    tex: [`\\int_{\\gamma} ${E} = ${c('m2', '\\phi')}(a) - ${c('m2', '\\phi')}(b)`] },
  bform: { scene: 'forms', mode: 'B', params: { auto: true }, r: 2.5, target: [0, 0, 0],
    cam: { az: [16, 30], el: [14, 20], push: [1.1, 0.92] },
    title: 'The magnetic field as a 2-form', sub: 'Tubes round a wire; a surface counts the tubes it cuts',
    tex: [`\\int_{S} ${B} = (\\text{tubes through } S)`] },
  wave: { scene: 'wave', mode: 'wave', params: { auto: true }, r: 3.3, target: [0, 0, 0],
    cam: { az: [28, 8], el: [16, 22], push: [1.0, 0.85] },
    title: 'Light', sub: 'E and B, at right angles and in step, moving at c',
    tex: [`c = \\frac{1}{\\sqrt{\\mu_0\\varepsilon_0}} \\qquad ${d}${F} = 0,\\;\\; ${d}\\,(${STAR}${F}) = 0`] },
};
const DECK = Object.keys(SHOTS);

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const ease = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const lerp = (a, b, t) => a + (b - a) * t;

// The plate for a shot: title, sub, TeX and up to three live values.
export function plateFor(key, scene) {
  const sh = SHOTS[key];
  const rows = (scene && scene.readout ? scene.readout() : []).slice(0, 3);
  const params = rows.map(([name, value, cls]) => ({ name, value: String(value), cls }));
  return { title: sh.title, sub: sh.sub, tex: sh.tex, rules: null, params };
}

// ctx = { stage, scene(key), toWorld, go, cur, S }
export function installSaver(ctx) {
  const { stage } = ctx;
  let run = null;
  let bandFn = null;
  import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => {});

  function makeShot(key) {
    const sh = SHOTS[key], r = run.r;
    const dur = 6 + 5.5 * run.calm + r() * 1.2;
    const flip = r() < 0.5 ? 1 : -1;
    return { key, sh, dur, t: 0, flip, t0: sh.t0 ? lerp(sh.t0[0], sh.t0[1], r()) : 0, done: new Set() };
  }
  function start(shot) {
    const s = ctx.scene(shot.sh.scene);
    for (const k in ctx.SCENES) ctx.SCENES[k].group.visible = false;
    s.group.visible = true;
    s.enter(shot.sh.mode, { ...(shot.sh.params || {}), t0: shot.t0 });
    run.scene = s;
    ctx.setActive(s);
    run.lastLab = '';
    plate(true);
  }
  // Camera: fit the subject radius r to the clear band, then ease the
  // azimuth, elevation and push over the shot.
  function frameCam(shot) {
    const { camera, controls } = stage;
    const k = ease(shot.t / shot.dur), cam = shot.sh.cam;
    const az = lerp(cam.az[0], cam.az[1], k) * shot.flip * Math.PI / 180, el = lerp(cam.el[0], cam.el[1], k) * Math.PI / 180;
    const h = stage.h, band = run.band, fh = band ? Math.max(0.3 * h, h - band.t - band.b) : 0.86 * h;
    const tanH = Math.tan(camera.fov * Math.PI / 360);
    const fit = shot.sh.r * h / (0.9 * fh * tanH);
    // a narrow frame (9:16) fits by width too
    const fitW = shot.sh.r * h / (0.9 * Math.max(1, stage.w) * tanH);
    const dist = Math.max(fit, fitW) * lerp(cam.push[0], cam.push[1], k);
    const T = ctx.toWorld(shot.sh.target);
    camera.position.set(T[0] + dist * Math.cos(el) * Math.sin(az), T[1] + dist * Math.sin(el), T[2] + dist * Math.cos(el) * Math.cos(az));
    controls.target.set(T[0], T[1], T[2]);
    camera.lookAt(controls.target);
  }
  function plate(force) {
    if (!run || !run.label) return;
    const info = plateFor(run.shot.key, run.scene);
    const js = JSON.stringify([info.title, info.params]);
    if (!force && js === run.lastLab) return;
    run.lastLab = js;
    run.label(info);
  }
  function nextShot() {
    if (!run.deck.length) {
      const d = DECK.slice();
      for (let j = d.length - 1; j > 0; j--) { const q = Math.floor(run.r() * (j + 1)); [d[j], d[q]] = [d[q], d[j]]; }
      if (run.shot && d[0] === run.shot.key) d.push(d.shift());
      run.deck = d;
    }
    run.shot = makeShot(run.deck.shift());
    run.count++;
    start(run.shot);
    stage.fadeTarget = 1;
  }
  function tick(dt) {
    if (!run) return;
    const now = performance.now();
    if (now - run.bandAt > 250) {
      run.bandAt = now;
      const b = bandFn ? bandFn(stage.h) : null;
      run.band = b;
      stage.setOcclusion(b ? { t: b.t, b: b.b } : {});
    }
    const sh = run.shot;
    sh.t += dt;
    for (const [at, key, v] of sh.sh.at || []) if (sh.t >= at && !sh.done.has(at)) { sh.done.add(at); run.scene.set(key, v); }
    stage.fadeTarget = sh.t > sh.dur - 0.7 ? 0 : 1;
    frameCam(sh);
    if (now - run.labAt > 500) { run.labAt = now; plate(false); }
    if (sh.t >= sh.dur) nextShot();
  }

  window.snSaver = {
    enter(opts = {}) {
      const calm = Math.min(1, Math.max(0, opts.calm ?? 0.7));
      document.documentElement.classList.add('mx-saver');
      run = { r: rng(opts.seed || ((Math.random() * 1e9) | 0)), calm, deck: [], shot: null, count: 0, bandAt: -1e9, labAt: 0, band: null,
        label: typeof opts.label === 'function' ? opts.label : null, lastLab: '', scene: null };
      stage.saver = true; stage.controls.enabled = false; stage.fly = null;
      ctx.S.saver = true;
      stage.saverTick = tick;
      stage.resize();
      nextShot();
      stage.fade = 0;
      return { canvas: stage.canvas, warmupMs: 1200 };
    },
    exit() {
      run = null;
      stage.saverTick = null; stage.saver = false; stage.controls.enabled = true;
      ctx.S.saver = false;
      document.documentElement.classList.remove('mx-saver');
      ctx.reenter();
    },
    cut(key) { if (run && SHOTS[key]) { run.deck.unshift(key); run.shot.t = run.shot.dur; } },
    debug() {
      if (!run) return null;
      const s = run.shot;
      return { key: s.key, t: +s.t.toFixed(2), dur: +s.dur.toFixed(2), count: run.count, deck: run.deck.slice(), band: run.band, fade: +stage.fade.toFixed(2) };
    },
  };
}
