// ============================================================================
//  ROCHE LIMIT  ·  app/saver.js — the screensaver
// ----------------------------------------------------------------------------
//  window.snSaver implements the lib/screensaver.js protocol: a
//  seeded queue of shots, each planet-fixed, with a fade between them.
//  S.saver holds the state of the screensaver while it runs.
//
//  grep -n targets
//    shots ............... "const SHOTS"
//    camera of a shot .... "function saverCamera"
//    plate label ......... "function saverLabel"
//    next shot ........... "function saverScenario"
//    fade ................ "function saverFade"
//    protocol ............ "window.snSaver"
// ============================================================================
import { cam, resetCamStats, camStats } from './camera.js';
import { applyScenario, openPanel } from './controls.js';
import { debugState } from './debug.js';
import { $, UI, RM_Q } from './env.js';
import { resize } from './quality.js';
import { limitsFor, currentSpec, startRun } from './runs.js';
import { satState } from './sat.js';
import { S, bootReady } from './state.js';
import { storyText } from './story.js';

// lib/screensaver.js has the protocol. enter() hides the page UI (CSS
// under html.sn-saver), takes N = 8192 and plays a seeded shuffle of
// SHOTS. Every shot is planet-fixed: the camera looks at the planet from a
// slowly turning direction and never follows the moon; the page's camera
// governor caps the turn (ROT_MAX). A new shot fades to black, settles,
// runs its warm-up in the dark at full speed, then fades in over 2 s.
//   saturn   the main shot: the Saturn story from the start, slow, until
//            the ring phase plus some time (at most 80 s)
//   rings    a fly-by of today's rings at their true size, with a moon
//            torn up in them: the run starts near the limit and warms up
//            in the dark; the camera rises slowly from the ring plane
//   comet    the comet pass of Jupiter
// The subject is framed in the clear band of the plate (plateBand).
const SHOTS = [
  { key: 'saturn', scen: 'saturn', title: 'How Saturn may have got its rings', warm: () => 0, speed: 5, hold: 80,
    until: r => r.story.ring !== undefined && (r.t - r.story.ring) / r.T0 > 1.5,
    cam: { zoom: 1, el: 0.22, az: 0.9, spin: 0.6 } },
  { key: 'rings', scen: 'saturn', title: 'Today’s rings of Saturn, at their true size', spec: { d: 2.2, d1: 1.75, orbits: 1.5 }, warm: () => 1.6, speed: 3, hold: 45,
    cam: { zoom: 0.92, el: 0.05, elTo: 0.42, az: 0.5, spin: 1.6, zoomTo: 0.7, backlit: true } },
  { key: 'comet', scen: 'flyby', title: 'A comet torn into a string of pearls', warm: r => r.tPeri !== undefined ? (r.tPeri / r.T0 - 0.8) : 0, speed: 2, hold: 40,
    until: r => r.t / r.T0 > r.tPeri / r.T0 + 5, cam: { zoom: 0.9, el: 0.6, az: 1.2, spin: 0.5 } },
];
const WGSL_EXTRACT = `// shaders/sim.wgsl · cs_forces: one contact
let Fn = max(0.0, P.kn * (-gap) - P.gnK * sm * vn);
F = Fn * n;
var ft = -P.kt * sp - P.gtK * sm * vt;
let cap = P.mu * (Fn + coh);
if (length(ft) > cap) { ft = ft * (cap / length(ft)); }
// then the tide, relative to the frame point X
td = tide(S.X, xi0);`;
export function saverCamera(g, dt) {
  const sh = S.saver.cur; if (!sh) return;
  const c = sh.cam;
  S.saver.az += dt * S.saver.spin;
  const prog = Math.min(1, (performance.now() - S.saver.shotAt) / (S.saver.hold * 1000));
  const ease = prog * prog * (3 - 2 * prog);
  g.az = (c.az ?? 0.9) + S.saver.az;
  g.el = c.elTo !== undefined ? c.el + (c.elTo - c.el) * ease : (c.el ?? g.el);
  const z = c.zoomTo !== undefined ? c.zoom + (c.zoomTo - c.zoom) * ease : c.zoom * (1 - 0.06 * ease);
  g.dist = g.dist / (cam.zoom || 1) * z;
}
function saverLabel() {
  if (!S.saver || !S.saver.opts.label || !S.run || S.run.phase !== 'orbit' || !S.run.sats[0].ref) return;
  const s = S.run.sats[0], L = S.run.limits || limitsFor(S.run.spec);
  const st = satState(s), dNow = Math.hypot(...st.r) / s.Rp;
  const bnd = S.run.sats.map(x => x.an ? (100 * x.an.f).toFixed(0) + '%' : '100%').join(' / ');
  S.saver.opts.label({
    title: 'Roche limit', sub: S.saver.cur ? S.saver.cur.title : '',
    params: [
      { sym: 'd/R_p', name: 'distance', value: dNow.toFixed(2), cls: 'm5' },
      { sym: 'd_\\mathrm{fluid}', name: 'Roche limit', value: L.fluid.toFixed(2) + ' R_p', cls: 'm1' },
      { sym: 'f_b', name: 'in one piece', value: bnd, cls: 'm3' },
    ],
    tex: ['d_\\mathrm{fluid} \\approx 2.44\\,R_p\\left(\\rho_p/\\rho_s\\right)^{1/3}'],
    rules: [['d_\\mathrm{fluid}', 'm1'], ['R_p', 'm5']],
    eq: ['d_fluid ≈ 2.44 R_p (ρ_p/ρ_s)^(1/3)'],
    lines: [storyText(S.run.storyKey), `${s.N.toLocaleString()} grains · self-gravity, contacts, tide on the GPU`],
    code: { lang: 'wgsl', name: 'sim.wgsl · cs_forces', text: WGSL_EXTRACT },
    anchor: () => {
      const cs = $('gpu');
      const q = S.ren.project([0, 0, 0], cs.clientWidth, cs.clientHeight);
      if (!q) return null;
      return { x: q.x, y: q.y, r: Math.max(8, S.ren.focal / q.w / (S.ren.H / cs.clientHeight)) };
    },
  });
}
function saverScenario() {
  const sv = S.saver;
  if (!sv.queue.length) {
    // the Saturn story first in each round, then the other two in a seeded
    // order; never the same shot twice in a row
    const rest = SHOTS.slice(1);
    if (sv.rnd() < 0.5) rest.reverse();
    sv.queue = [SHOTS[0], ...rest];
    if (sv.last && sv.queue[0] === sv.last) sv.queue.push(sv.queue.shift());
  }
  const shot = sv.queue.shift(); sv.last = shot;
  sv.cur = { shot, title: shot.title, cam: shot.cam };
  UI.ringGain = 2; UI.rings = true; UI.real = true; UI.pred = false; UI.hill = false; UI.track = false; UI.blur = false; UI.ringOn = true;
  applyScenario(shot.scen);
  UI.cam = 'planet'; UI.color = 4; UI.field = 0;
  const spec = currentSpec();
  if (shot.spec) Object.assign(spec, shot.spec);
  sv.speed = 100;
  sv.state = 'warm'; sv.warmAt = performance.now();
  sv.spin = (sv.rnd() < 0.5 ? -1 : 1) * (shot.cam.spin || 0.6) * (1 - 0.5 * sv.calm) * Math.PI / 180;
  sv.backlit = !!shot.cam.backlit;
  sv.hold = shot.hold * (1 + 0.3 * sv.calm);
  sv.shotAt = performance.now(); sv.az = 0;
  startRun(spec);
}
// Called each frame by drawFrame: the fade, as an exposure factor.
export function saverFade(dt) {
  const sv = S.saver; if (!sv) return 1;
  const rate = sv.fadeTarget > sv.fade ? 0.5 : 0.7;   // 2 s in, 1.4 s out
  sv.fade += Math.sign(sv.fadeTarget - sv.fade) * Math.min(Math.abs(sv.fadeTarget - sv.fade), rate * dt);
  return sv.fade;
}
window.snSaver = {
  async enter(opts) {
    S.saverOn = true;
    await bootReady;
    document.documentElement.classList.add('sn-saver');
    openPanel(null);
    let seed = (opts.seed >>> 0) || 1;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const calm = Math.max(Math.min(1, Math.max(0, opts.calm ?? 0.7)), RM_Q.matches ? 1 : 0);
    S.saver = { opts, rnd, calm, queue: [], cur: null, az: 0, spin: 0, hold: 40, shotAt: performance.now(), fade: 0, fadeTarget: 0, state: 'warm', speed: 100 };
    if (RM_Q.matches) UI.calm = true;
    UI.paused = false;
    resetCamStats();
    UI.N = Math.min(UI.N, 8192);
    resize();
    saverScenario();
    S.saver.tick = setInterval(() => {
      if (!S.saverOn) return;
      const sv = S.saver;
      if (sv.state === 'fadeout') { if (sv.fade <= 0.001) saverScenario(); return; }
      if (!S.run || S.run.phase !== 'orbit') return;
      if (sv.state === 'warm') {
        // the warm-up runs in the dark at full speed; then the view fades
        // in (at most 12 s of dark: a slow GPU fades in early)
        if (S.run.t / S.run.T0 < sv.cur.shot.warm(S.run) && performance.now() - sv.warmAt < 12000) { sv.speed = 100; sv.shotAt = performance.now(); return; }
        sv.speed = sv.cur.shot.speed * (sv.calm > 0.85 ? 0.75 : 1);
        cam.pose = null; sv.az = 0;
        sv.state = 'show'; sv.fadeTarget = 1; sv.shotAt = performance.now();
      }
      const until = sv.cur.shot.until;
      if ((until && until(S.run)) || (performance.now() - sv.shotAt) / 1000 > sv.hold) { sv.state = 'fadeout'; sv.fadeTarget = 0; return; }
      saverLabel();
    }, 500);
    return { canvas: $('gpu'), warmupMs: 2500 };
  },
  exit() {
    S.saverOn = false;
    if (S.saver) clearInterval(S.saver.tick);
    S.saver = null;
    document.documentElement.classList.remove('sn-saver');
    resize();
  },
  debug() { return S.saver ? { shot: S.saver.cur && S.saver.cur.shot.key, cam: S.saver.cur && S.saver.cur.cam, hold: S.saver.hold, state: S.saver.state, fade: S.saver.fade, camStats: Object.assign({}, camStats, { prev: undefined }), state2: debugState() } : null; },
};
