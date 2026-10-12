// ============================================================================
//  ANTENNA FIELDS  ·  saver.js — the screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell screensaver (lib/screensaver.js) calls snSaver.enter(opts) with
//  opts = { calm, seconds, caption, seed, label }. enter() hides the page GUI
//  (html.af-saver), turns on S.saver, and starts a shot director. It resolves
//  to { canvas, warmupMs }. The canvas is #field, which stays in the
//  document; in saver mode the 2D overlay goes into it as a texture, so the
//  canvas holds the whole picture.
//
//  SHOTS. A seeded bag of the six kinds below; a new bag after six shots,
//  never the same kind twice in a row. Each shot holds 6 to 12 s (calm 1 is
//  the longest) with a fade through black at each cut.
//    nearfar   a push-in on the near-to-far transition: the observer moves in
//              through kr = 1 and its label shows E and B fall out of step
//    poynting  the Poynting flow leaving a dipole, with the flux sphere
//    sweep     a phased array turns its beam past a fixed observer; the
//              phasor box shows the element arrows line up and fold
//    yagi      a Yagi-Uda gains directors one by one; the beam forms
//    lobe      the 3D view: the flux sphere becomes the pattern, turning
//    peel      electric field lines break away from a dipole
//
//  FRAMING. main.js clearRect() uses S.band, the clear band between the
//  plate's top and bottom text (lib/saver-clear.js plateBand), read every
//  250 ms. The 3D view uses the same band as its viewport.
//
//  PLATE. opts.label gets a title, one line, the antenna, the frequency, the
//  directivity, one or two shot values and one TeX line. No code.
//
//  grep -n: "const KINDS"  "function makeShot"  "function apply"  "function plate"
//           "enter(opts"  "function snapshot"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';

const KINDS = ['nearfar', 'poynting', 'sweep', 'yagi', 'lobe', 'peel'];
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);
const clamp01 = t => Math.max(0, Math.min(1, t));

const NAMES = { dipole: 'Dipole', halfwave: 'Half-wave dipole', loop: 'Loop', array: 'Phased array', yagi: 'Yagi-Uda', hertz: 'Short dipole' };
const TITLES = {
  nearfar: ['From the near field to the far field', 'Near the wire E lags B by 90°; a sixth of a wavelength out they fall into step'],
  poynting: ['Energy leaving a dipole', 'The Poynting flow moves out at the speed of light, and out and back near the wire'],
  sweep: ['A phased array turning its beam', 'A phase step between equal currents turns the beam; the arrows add toward the marker'],
  yagi: ['A Yagi-Uda gaining directors', 'Each director pulls the beam forward; only the middle wire is fed'],
  lobe: ['The radiation pattern in 3D', 'The flux through a sphere, drawn out along each direction, is the pattern'],
  peel: ['Field lines breaking away', 'Closed loops of electric field pinch off the wire and travel outward'],
};
const TEX = {
  nearfar: 'E_\\theta=\\frac{j\\eta k\\,I\\Delta l\\,\\sin\\theta}{4\\pi r}\\Big[1+\\frac{1}{jkr}-\\frac{1}{(kr)^2}\\Big]e^{-jkr}',
  poynting: '\\oint\\langle\\vec S\\rangle\\cdot d\\vec A=P_\\text{rad},\\qquad \\vec S=\\vec E\\times\\vec H',
  sweep: 'AF(\\theta)=\\sum_{n}I_n\\,e^{jn(kd\\sin\\theta+\\beta)},\\qquad \\sin\\theta_s=-\\frac{\\beta}{kd}',
  yagi: '\\sum_n Z_{mn}\\,I_n=V_m',
  lobe: 'D=\\frac{4\\pi\\,U_\\text{max}}{P_\\text{rad}},\\qquad U=r^2\\langle S_r\\rangle',
  peel: '\\vec E(t)=\\mathrm{Re}\\{\\vec E\\,e^{j\\omega t}\\},\\qquad \\nabla\\times\\vec E=-\\frac{\\partial\\vec B}{\\partial t}',
};

export function installSaver(ctx) {
  const { S } = ctx;
  let run = null;

  function makeShot(kind, r, calm) {
    const dur = Math.min(12, 6 + 5 * calm + r() * 1.5);
    const pick = a => a[Math.floor(r() * a.length)];
    const base = { kind, dur, speed: lerp(0.12, 0.18, r()), view: 'side', field: 'E', v3: false,
      tog: { lines: true, zones: false, log: false, flow: false, sphere: false, phasors: false }, show: null };
    if (kind === 'nearfar') {
      const ant = pick([['hertz', { dl: 0.05 }], ['halfwave', { f: 300, model: 'sin' }]]);
      const ang = pick([0.35, -0.35, 0.55, -0.55]);
      return Object.assign(base, { ant, z0: 1.35, z1: 0.62, obs0: [1.5, ang], obs1: [0.11, ang * 0.6],
        tog: Object.assign(base.tog, { zones: true }), show: { obs: true, label: true, triad: true } });
    }
    if (kind === 'poynting') {
      const ant = pick([['halfwave', { f: 300, model: 'sin' }], ['dipole', { L: 1.0, model: 'mom' }], ['dipole', { L: 1.25, model: 'sin' }]]);
      const ang = pick([0.25, -0.25, 0.7]);
      // The sphere must fit in the band. In a wide band the visible half
      // height is 0.8 x the view half height (main.js updateView), which is
      // max(TYPES zoom, 0.75 x length) x zoom x 0.62. The sphere must also
      // hold the wire (radius >= 1.08 L/2 + 0.02 m).
      const hw = ant[0] === 'halfwave', r0 = hw ? 0.4 : 0.72, r1 = hw ? 0.55 : 0.82;
      return Object.assign(base, { ant, field: 'S', z0: hw ? 1.25 : 1.5, z1: hw ? 1.1 : 1.32, obs0: [r0, ang], obs1: [r1, ang],
        tog: Object.assign(base.tog, { lines: false, flow: true, sphere: true }), show: { obs: true, label: true, triad: false } });
    }
    if (kind === 'sweep') {
      const N = pick([8, 12, 16]), amp = lerp(35, 50, r()), ph = r() * 6.28, mark = pick([-18, 12, 24]);
      // the marker sits inside the view: 0.6 of its half height (main.js updateView)
      const halfV = Math.max(2.6, ((N - 1) * 0.5 + 0.5) * 0.75) * 0.9 * 0.62;
      return Object.assign(base, { ant: ['array', { N, d: 0.5, steer: amp * Math.sin(ph) }], view: 'top', amp, ph, z0: 1, z1: 0.9,
        obs0: [0.6 * halfV, Math.PI / 2 - mark * Math.PI / 180], speed: lerp(0.2, 0.28, r()),
        tog: Object.assign(base.tog, { phasors: true }), show: { obs: true, label: false, triad: false } });
    }
    if (kind === 'yagi') {
      const top = pick([5, 6, 7]);
      return Object.assign(base, { ant: ['yagi', { f: 300, nd: 0 }], view: 'top', top, z0: 1.15, z1: 1.0,
        obs0: [2.2, pick([0.12, -0.12, 0])], tog: Object.assign(base.tog, { phasors: true }), show: { obs: true, label: false, triad: false } });
    }
    if (kind === 'lobe') {
      const ant = pick([['halfwave', { f: 300, model: 'sin' }], ['dipole', { L: 1.25, model: 'sin' }], ['yagi', { f: 300, nd: 4 }], ['array', { N: 8, d: 0.5, steer: 20 }]]);
      const fromSphere = r() < 0.6;
      return Object.assign(base, { ant, v3: true, view: ant[0] === 'yagi' || ant[0] === 'array' ? 'top' : 'side', fromSphere,
        pitch0: lerp(0.5, 0.62, r()), pitch1: lerp(0.18, 0.3, r()), yaw0: r() * 6.28, tog: Object.assign(base.tog, { lines: true }) });
    }
    const ant = pick([['halfwave', { f: 300, model: 'sin' }], ['dipole', { L: 1.0, model: 'mom' }], ['hertz', { dl: 0.05 }], ['dipole', { L: 1.25, model: 'sin' }]]);
    return Object.assign(base, { kind: 'peel', ant, z0: lerp(1.3, 1.5, r()), z1: lerp(0.75, 0.95, r()), speed: lerp(0.1, 0.16, r()) });
  }

  function start(sh) {
    ctx.set(sh.ant[0], sh.ant[1], sh.view);
    S.field = sh.field;
    S.tog = Object.assign({}, sh.tog);
    S.saverShow = sh.show;
    S.speed = sh.speed * run.slow; S.speedK = 1;
    S.cam = { zoom: (sh.z0 || 1) * run.zoom, panX: 0, panY: 0 };
    if (sh.obs0) S.obs = { rM: sh.obs0[0], ang: sh.obs0[1] };
    ctx.view3d(sh.v3);
    if (sh.v3) {
      S.v3.yaw = sh.yaw0; S.v3.pitch = sh.pitch0; S.v3.zoom = 1; S.v3.auto = true; S.v3.db = false;
      S.v3.morph = S.v3.morphTo = sh.fromSphere ? 0 : 1;
    }
    ctx.resetFlow();
    ctx.rebuildNow();
    ctx.invalidate();
  }

  // Apply the shot at time t (s). Called every frame.
  function apply(sh, t) {
    const k = clamp01(t / sh.dur), e = ease(k);
    if (sh.z0) S.cam.zoom = lerp(sh.z0, sh.z1, e) * run.zoom;
    if (sh.obs1) S.obs = { rM: lerp(sh.obs0[0], sh.obs1[0], ease(clamp01((t - 0.6) / (sh.dur - 1.6)))), ang: lerp(sh.obs0[1], sh.obs1[1], e) };
    if (sh.kind === 'sweep') ctx.patch({ steer: sh.amp * Math.sin(sh.ph + t * 2 * Math.PI / Math.max(6, sh.dur * 0.95)) });
    if (sh.kind === 'yagi') {
      const nd = Math.min(sh.top, Math.floor(clamp01((t - 0.5) / (sh.dur - 2)) * (sh.top + 1)));
      if (nd !== S.yagi.nd) {
        // keep the reflector and the fed wire still on screen while the boom grows
        const c0 = ctx.centreM();
        ctx.patch({ nd });
        S.cam.panX += c0 - ctx.centreM();
      }
      S.cam.panX *= Math.exp(-1.6 / 60);
    }
    if (sh.kind === 'lobe') {
      S.v3.pitch = lerp(sh.pitch0, sh.pitch1, e);
      // the sphere becomes the pattern (or back) in the middle of the shot
      const m = ease(clamp01((t - sh.dur * 0.3) / (sh.dur * 0.35)));
      S.v3.morph = S.v3.morphTo = sh.fromSphere ? m : 1 - m * 0.999;
    }
    S.fade = Math.max(0, Math.min(1, t / 0.8, (sh.dur - t) / 0.7));
  }

  function plate(force) {
    if (!run || !run.label) return;
    const sh = run.shot, A = ctx.A, st = ctx.stats, g = ctx.geo;
    if (!A) return;
    const t = S.type;
    const params = [
      { sym: '', name: 'antenna', value: NAMES[t] + (t === 'array' ? ', ' + S.array.N + ' elements' : t === 'yagi' ? ', ' + (S.yagi.nd + 2) + ' elements' : t === 'dipole' ? ', ' + S.dipole.L.toFixed(2) + ' λ' : '') },
      { sym: 'f', name: 'frequency', value: ctx.freq().toFixed(0) + ' MHz', cls: 'm6' },
      { sym: 'D', name: 'directivity', value: st ? st.Ddb.toFixed(2) + ' dBi' : '…', cls: 'm4' },
    ];
    if (sh.kind === 'nearfar' && g && g.ob) params.push({ sym: 'kr', name: 'at the marker', value: g.ob.kr.toFixed(2), cls: 'm6' }, { sym: '\\Delta\\varphi', name: 'E minus B phase', value: Math.round(g.ob.gap) + '°', cls: 'm2' });
    if (sh.kind === 'poynting' && g && g.sf) params.push({ sym: 'P_\\text{rad}', name: 'flux through the sphere', value: g.sf.P.toFixed(1) + ' W', cls: 'm4' });
    if (sh.kind === 'sweep') params.push({ sym: '\\theta_s', name: 'steering', value: S.array.steer.toFixed(0) + '°', cls: 'm6' });
    if (sh.kind === 'yagi' && st) params.push({ sym: 'F/B', name: 'front to back', value: st.fb.toFixed(1) + ' dB', cls: '' });
    const info = { title: TITLES[sh.kind][0], sub: TITLES[sh.kind][1], params, tex: [TEX[sh.kind]], rules: window.AF_RULES || null };
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
      run.deck = KINDS.slice();
      for (let j = run.deck.length - 1; j > 0; j--) { const q = Math.floor(run.r() * (j + 1)); [run.deck[j], run.deck[q]] = [run.deck[q], run.deck[j]]; }
      // not the same kind across the bag boundary
      const prev = run.shot ? run.shot.kind : null;
      if (prev && run.deck[0] === prev) { const q = 1 + Math.floor(run.r() * (run.deck.length - 1)); [run.deck[0], run.deck[q]] = [run.deck[q], run.deck[0]]; }
    }
    run.shot = makeShot(run.deck.shift(), run.r, run.calm);
    run.t = 0; run.count++;
    start(run.shot);
    run.lastLab = '';
    plate(true);
  }

  // The user's state, put back on exit.
  function snapshot() {
    const pick = o => JSON.parse(JSON.stringify(o));
    return { type: S.type, view: S.view, field: S.field, tog: pick(S.tog), v3: pick(S.v3), cam: pick(S.cam), obs: pick(S.obs), speed: S.speed,
      params: { dipole: pick(S.dipole), halfwave: pick(S.halfwave), loop: pick(S.loop), array: pick(S.array), yagi: pick(S.yagi) } };
  }

  window.snSaver = {
    enter(opts = {}) {
      const calm = Math.min(1, Math.max(0, opts.calm ?? 0.7));
      document.documentElement.classList.add('af-saver');
      run = { r: rng(opts.seed || ((Math.random() * 1e9) | 0)), calm, slow: 1 - 0.4 * calm, zoom: 0.62, deck: [], shot: null, t: 0, count: 0,
        bandAt: -1e9, labAt: 0, label: typeof opts.label === 'function' ? opts.label : null, lastLab: '', saved: snapshot() };
      S.saver = true; S.playing = true;
      nextShot();
      S.saverTick = tick;
      return Promise.resolve({ canvas: ctx.canvas, warmupMs: 800 });
    },
    exit() {
      const sv = run && run.saved;
      run = null; S.saverTick = null; S.saver = false; S.band = null; S.fade = 1; S.saverShow = null;
      document.documentElement.classList.remove('af-saver');
      if (sv) {
        Object.assign(S.dipole, sv.params.dipole); Object.assign(S.halfwave, sv.params.halfwave); Object.assign(S.loop, sv.params.loop);
        Object.assign(S.array, sv.params.array); Object.assign(S.yagi, sv.params.yagi);
        ctx.set(sv.type, null, sv.view);
        S.field = sv.field; S.tog = sv.tog; S.cam = sv.cam; S.obs = sv.obs; S.speed = sv.speed;
        Object.assign(S.v3, sv.v3);
        ctx.view3d(sv.v3.on);
      }
      ctx.resetFlow();
      ctx.syncUI();
      ctx.rebuildNow();
      ctx.invalidate();
    },
    // Force a shot kind (for checks): snSaver.cut('lobe').
    cut(kind) {
      if (!run || !KINDS.includes(kind)) return false;
      run.deck.unshift(kind); nextShot(); return true;
    },
    debug() {
      if (!run) return null;
      const sh = run.shot;
      return { kind: sh.kind, t: +run.t.toFixed(2), dur: +sh.dur.toFixed(2), count: run.count, deckLeft: run.deck.slice(), type: S.type, view: S.view, field: S.field,
        v3: S.v3.on, morph: +S.v3.morph.toFixed(3), nd: S.yagi.nd, steer: +S.array.steer.toFixed(1), fade: +S.fade.toFixed(2), zoom: +S.cam.zoom.toFixed(3),
        obs: S.obs ? [+S.obs.rM.toFixed(2), +S.obs.ang.toFixed(2)] : null, band: S.band };
    },
  };
}
