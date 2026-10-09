// ============================================================================
//  FLIP WATER  ·  saver.js  —  the screensaver shots
// ----------------------------------------------------------------------------
//  Our addition to the Ten Minute Physics port (not upstream code).
//
//  installSaver(app) hands seven shots to the sim kit director
//  (widgets/sim-kit/saver.js): it hides the GUI, frames the canvas in the
//  plate's clear band and cuts a seeded bag of the shots every 6-12 s,
//  never the same shot twice in a row. Each
//  shot builds a new scene through the page's own randomizer and objects,
//  with a new seeded look (looks.js randomLook; never the same water
//  scheme twice in a row). Some shots follow a body with a spring zoom
//  (app.zoom, read by main.js when it draws).
//
//  Shots: harbour (the dam break), boatwave (close on the boat as the wave
//  arrives), random (any seeded tank), regatta (ducks, balls and buoys on
//  waves or a pour), sinkers (rocks, ice and crates dropped in a pool),
//  field (a swirl or speed view in a colour map), splash (close on a
//  crate that falls into the water).
//  Plates: a title, a fixed sub line and one TeX equation; no code.
//
//  It uses only the app API (loadState, state, sim, spec, objects,
//  syncLook, zoom), so node tests run every shot with a stub app.
//
//  grep -n targets
//    const SHOTS         the shot list
//    function newLook    seeded look, no repeat
//    function follow     the zoom target per frame
//    export function installSaver / makeShots
// ============================================================================
import { randomLook, SCHEMES, VIEWS } from './looks.js';
import { build, defaultState } from './scenes.js';
import { KINDS } from './bodies.js';
import { director } from '../../widgets/sim-kit/saver.js';

const TEX = {
  buoy: 'F_b = \\rho_w\\, g\\, V_{\\mathrm{sub}}',
  float: '\\frac{V_{\\mathrm{sub}}}{V} = \\frac{\\rho_b}{\\rho_w}',
  flip: '\\mathbf{v}_p \\leftarrow (1-\\alpha)\\,\\mathbf{v}_{\\mathrm{PIC}} + \\alpha\\,\\mathbf{v}_{\\mathrm{FLIP}}',
  div: '\\nabla \\cdot \\mathbf{u} = 0',
  curl: '\\omega = \\frac{\\partial v}{\\partial x} - \\frac{\\partial u}{\\partial y}',
  drag: '\\mathbf{F}_d = \\rho_w k\\, A\\, (\\mathbf{u} - \\mathbf{v}_b)',
  impulse: '\\Delta \\mathbf{p}_b = -\\sum_i m_i\\, \\Delta \\mathbf{v}_i',
};

export function makeShots(app) {
  let lastWater = null, follow = null;

  function newLook(rng, force) {
    let L = null;
    for (let k = 0; k < 8; k++) { L = Object.assign(randomLook(rng), force || {}); if (L.water !== lastWater) break; }
    lastWater = L.water;
    app.state.colours = L;
    if (app.syncLook) app.syncLook();
    return L;
  }
  // A seed whose water kind is in `kinds` (the build is cheap; no sim).
  function seedFor(rng, kinds) {
    let seed = 'saver-' + Math.floor(rng() * 1e9).toString(36);
    for (let k = 0; k < 24; k++) {
      const s = 'saver-' + Math.floor(rng() * 1e9).toString(36);
      const st = defaultState(); st.seed = s;
      if (!kinds || kinds.includes(build(st, { budget: 3000 }).waterKind)) { seed = s; break; }
    }
    return seed;
  }
  function load(seed, rng, force) {
    app.zoom = null; follow = null;
    newLook(rng, force);
    app.loadState({ seed, sub: {}, locks: [], colours: app.state.colours, over: {} });
  }
  function warm(n) { for (let k = 0; k < n; k++) app.sim.step(); }
  const dyn = () => app.sim.solids.filter(s => !s.kinematic && s.active);
  function names() {
    const n = {};
    for (const b of dyn()) n[b.kind] = (n[b.kind] || 0) + 1;
    return Object.entries(n).map(([k, c]) => `${c} ${KINDS[k].name.toLowerCase()}${c > 1 ? 's' : ''}`).join(', ') || 'no objects';
  }
  function lookLine() {
    const L = app.state.colours, v = VIEWS[L.view] || VIEWS.surface;
    return v.field ? `${v.name} view, ${L.map} colour map` : `${(SCHEMES[L.water] || SCHEMES.clear).name} water`;
  }
  // zoom on a body: the centre follows it with a spring, k eases in
  function track(body, k, delay = 0.8) {
    if (!body) return;
    follow = { body, k, delay, t: 0 };
    app.zoom = { x: body.x, y: body.y, k: 1 };
  }

  const SHOTS = [
    { key: 'harbour', label: { sub: 'FLIP water · a gate, a slope and floating bodies', title: 'Dam break in the harbour', tex: [TEX.buoy], lines: ['The sluice gate lifts; the wave carries the boats.'] },
      run(c) { load('harbour', c.rng); } },
    { key: 'boatwave', label: { sub: 'Close on the boat · two-way coupling', title: 'The wave meets the boat', tex: [TEX.impulse], lines: ['Particles that hit a body pass it their momentum.'] },
      run(c) { load('harbour', c.rng, { view: 'surface' }); track(dyn().find(b => b.kind === 'boat'), 2.1, 1.2); } },
    { key: 'random', label: { sub: 'A seeded scene · tank, water, obstacles, flow and objects', title: 'A random tank', tex: [TEX.flip] },
      run(c) { load(seedFor(c.rng), c.rng); warm(30); } },
    { key: 'regatta', label: { sub: 'Ducks, beach balls and buoys on moving water', title: 'Rubber duck regatta', tex: [TEX.float], lines: ['Light bodies ride high: a duck is 30 % of the density of water.'] },
      run(c) {
        load(seedFor(c.rng, ['waves', 'pour', 'pooldrop']), c.rng, { view: 'surface' });
        app.objects.clearObjects();
        const n = 6 + Math.floor(c.rng() * 4);
        for (let k = 0; k < n; k++) app.objects.dropAt(['duck', 'duck', 'duck', 'ball', 'buoy'][Math.floor(c.rng() * 5)], (0.1 + 0.8 * (k + 0.5) / n) * app.spec.W, (0.62 + 0.25 * c.rng()) * app.spec.H, { colour: Math.floor(c.rng() * 6), look: 1 + Math.floor(c.rng() * 1e6) });
      } },
    { key: 'sinkers', label: { sub: 'Seven bodies, seven densities, one pool', title: 'What floats and what sinks', tex: [TEX.float], lines: ['Rock 2.6, ice 0.92, crate 0.6, ball 0.12 times the density of water.'] },
      run(c) {
        load(seedFor(c.rng, ['waves', 'pour', 'pooldrop', 'drop']), c.rng, { view: 'surface' });
        app.objects.clearObjects();
        const kinds = ['rock', 'ice', 'box', 'ball', 'rock', 'plank', 'bottle'];
        kinds.forEach((kind, k) => app.objects.dropAt(kind, (0.1 + 0.8 * (k + 0.5) / kinds.length) * app.spec.W, (0.72 + 0.18 * c.rng()) * app.spec.H, { colour: Math.floor(c.rng() * 4), look: 1 + Math.floor(c.rng() * 1e6) }));
      } },
    { key: 'field', label: { sub: 'The water coloured by its swirl or its speed', title: 'Swirl in the wake', tex: [TEX.curl] },
      run(c) {
        const view = c.rng() < 0.6 ? 'vorticity' : 'speed';
        load(seedFor(c.rng, ['dam', 'columns', 'waves', 'pour']), c.rng, { view });
        warm(40);
      } },
    { key: 'splash', label: { sub: 'Close on a falling body', title: 'Splash', tex: [TEX.div], lines: ['The body is a moving solid: its faces push the water away.'] },
      run(c) {
        load(seedFor(c.rng, ['waves', 'pooldrop', 'pour']), c.rng, { view: 'surface', foam: '1' });
        warm(20);
        const b = app.objects.dropAt(c.rng() < 0.5 ? 'box' : 'rock', (0.3 + 0.4 * c.rng()) * app.spec.W, 0.9 * app.spec.H, { a: (c.rng() - 0.5) * 0.6 });
        track(b, 1.9, 0.3);
      } },
  ];
  // The kit shows the plate before run() builds the scene, so the plate
  // text is fixed per shot; app.saverLine() gives the live scene line
  // (look and objects) for debugging and the tests.
  app.saverLine = () => `${lookLine()} · ${names()}`;

  // Each frame in saver mode: the zoom follows its body with a spring.
  function tick(dt) {
    if (!follow || !app.zoom || !app.sim) return;
    const z = app.zoom, b = follow.body;
    follow.t += dt;
    const k = Math.min(1, Math.max(0, (follow.t - follow.delay) / 1.5));
    const target = 1 + (follow.k - 1) * (k * k * (3 - 2 * k));
    const a = 1 - Math.exp(-dt * 3);
    if (b && b.active && Number.isFinite(b.x)) { z.x += (b.x - z.x) * a; z.y += (b.y - z.y) * a; }
    z.k = target;
  }
  return { SHOTS, tick, TEX };
}

// The sim kit director (widgets/sim-kit/saver.js) drives the cuts: a
// seeded bag, no shot twice in a row, 6-12 s cuts, the plate band. Each
// cut runs the shot's own run() through the app API; the kit's scene draw
// is not used (why = 'saver' changes are ignored by main.js), and exit
// rebuilds the visitor's scene from the restored kit state.
export function installSaver(app) {
  if (typeof window === 'undefined' || !app.kit) return null;
  const S = makeShots(app);
  let rngState = 1;
  const rng = () => { rngState = (rngState * 16807) % 2147483647; return rngState / 2147483647; };
  app.saverTick = dt => { if (app.saver) S.tick(dt); };
  director({
    kit: app.kit,
    canvas: () => app.canvas,
    themes: ['night', 'abyss', 'slate', 'violet'],
    shots: S.SHOTS.map(s => ({ key: s.key, title: s.label.title, sub: s.label.sub, tex: s.label.tex[0], lines: s.label.lines,
      params: () => [{ sym: 'N', name: 'particles', value: app.sim ? String(app.sim.numParticles) : '' }] })),
    enter() { app.saver = true; },
    apply(state, shot) {
      if (!shot) return;
      rngState = 1 + Math.floor(Math.random() * 2147483646);
      const s = S.SHOTS.find(x => x.key === shot.key);
      if (s) s.run({ rng, calm: 0.7 });
      app.fitTank && app.fitTank();
    },
    frame(band) { app.band = band || null; app.fitTank && app.fitTank(); },
    exit() { app.saver = false; app.zoom = null; app.band = null; app.pendingRebuild = true; },
  });
  return S;
}
