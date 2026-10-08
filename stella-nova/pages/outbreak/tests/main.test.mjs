// OUTBREAK · tests/main.test.mjs — package N: main.js wiring in node, with
// a stub globe (no browser, no GPU). It drives the real model, network,
// director and saver: the ui.js api, the Auto button, and window.snSaver.
import { readFileSync } from 'node:fs';
import { parseNodes } from '../data.js';
import { buildNetwork } from '../network.js';
import { POLICY_DEFS } from '../policies.js';

function stubGlobe() {
  const g = {
    styles: [{ id: 'night', label: 'Night' }, { id: 'marble', label: 'Marble' }, { id: 'dots', label: 'Dots' },
      { id: 'flat', label: 'Flat map' }, { id: 'holo', label: 'Hologram' }],
    style: null, mode: 'globe', cam: null, fade: 1, offset: null, frames: 0, events: 0, fades: 0, styleLog: [],
    setStyle(id) { g.style = id; g.mode = id === 'flat' ? 'flat' : 'globe'; g.styleLog.push(id); },
    setCamera(c) { g.cam = { ...c }; },
    setViewOffset(l, r, t, b) { g.offset = l == null ? null : [l, r, t, b]; },
    update(f) {
      g.frames++; g.events += f.events.length;
      if (!(f.prev instanceof Float32Array) || f.prev.length !== f.sim.N) throw new Error('bad prev');
      for (const k of ['lat', 'lon', 'alt']) if (!Number.isFinite(g.cam[k])) throw new Error(`cam.${k} not finite`);
    },
    setFade(a) { g.fade = a; g.fades++; },
    pick: () => -1, resize() {}, dispose() {},
  };
  return g;
}

export default async function (ok) {
  const M = await import('../main.js');
  const D = parseNodes(JSON.parse(readFileSync(new URL('../data/nodes.json', import.meta.url), 'utf8')));
  const net = buildNetwork(D);

  // seed city: deterministic, one of the large cities
  ok('main: pickSeedNode is deterministic', M.pickSeedNode(D, 42) === M.pickSeedNode(D, 42));
  ok('main: pickSeedNode gives a node', M.pickSeedNode(D, 7) >= 0 && M.pickSeedNode(D, 7) < D.nodes.length);

  // manual run: the frame loop steps the model at speed x wall time
  const g = stubGlobe();
  const app = M.createApp({ D, net, globe: g, seed: 11 });
  const api = app.api;
  ok('main: boots with the default disease', api.getState().disease.id === M.DEFAULT_DISEASE);
  ok('main: default style is night', g.style === 'night' && api.getState().style === 'night');
  api.setSpeed(10);
  let t = 100;
  for (let k = 0; k <= 300; k++) { app.frame(t); t += 1 / 30; }
  ok('main: 10 s at 10 d/s is about 100 days', Math.abs(app.sim.day - 100) <= 1, `day ${app.sim.day}`);
  ok('main: globe got every frame', g.frames === 301);
  ok('main: events reach the globe', g.events > 0, `${g.events} events`);
  api.play(false);
  const d0 = app.sim.day;
  for (let k = 0; k < 30; k++) { app.frame(t); t += 1 / 30; }
  ok('main: pause holds the day', app.sim.day === d0);
  api.play(true);

  // a slow frame does not jump
  app.frame(t + 5); t += 5;
  ok('main: a long frame steps at most MAX_DT', app.sim.day - d0 <= 10 * M.MAX_DT + 0.25 + 1e-9, `${(app.sim.day - d0).toFixed(2)} d`);

  // disease, policies, seed city, restart
  api.setDisease('measles');
  ok('main: setDisease makes a new run', api.getState().disease.id === 'measles' && app.sim.day === 0);
  const pol = api.getState().policies;
  const p2 = Object.fromEntries(Object.entries(pol).map(([k, v]) => [k, { ...v }]));
  p2.distancing = { on: true, strength: 0.8, trigger: 0 };
  api.setPolicies(p2);
  app.frame(t); t += 0.1; app.frame(t); t += 0.1;
  ok('main: setPolicies reaches the model', app.sim.active.distancing !== undefined);
  api.seedAt(5);
  ok('main: seedAt seeds that city', app.seedNode === 5 && app.sim.cum[5] > 0);
  api.restart(99);
  ok('main: restart keeps the seed city and resets the day', app.seedNode === 5 && app.sim.day === 0);
  api.setStyle('flat');
  ok('main: setStyle reaches the globe', g.style === 'flat' && api.getState().style === 'flat');
  api.setStyle('night');

  // pointer input stays in range
  for (let k = 0; k < 50; k++) app.drag(0, 400, 800);
  ok('main: drag clamps the latitude', app.cam.lat <= 85 && app.cam.lat >= -85);
  for (let k = 0; k < 50; k++) app.zoom(2);
  ok('main: zoom clamps the altitude', app.cam.alt <= M.ALT.globe[1] + 1e-9);

  // the Auto button through saver.js (no window: no snSaver)
  const { installSaver } = await import('../saver.js');
  const ctl = installSaver(app.saverApp);
  app.attach({ ctl });
  t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  api.auto(true);
  ok('main: Auto turns on', api.getState().auto === true && ctl.mode === 'button');
  const diseases = new Set(), kinds = new Set();
  let throws = null;
  try {
    for (let k = 0; k < 30 * 200; k++) {
      app.frame(t); t += 1 / 30;
      if (k % 30 === 0) {
        const dbg = ctl.debug();
        if (dbg.shot) kinds.add(dbg.shot.kind);
        diseases.add(api.getState().disease.id);
      }
    }
  } catch (e) { throws = e; }
  ok('main: Auto runs 200 s without an exception', !throws, throws && throws.message);
  ok('main: Auto cuts between shot kinds', kinds.size >= 3, [...kinds].join(','));
  ok('main: Auto restarts with a new disease', diseases.size >= 2, [...diseases].join(','));
  ok('main: Auto fades its cuts', g.fades > 2);
  api.setDisease('cholera');
  ok('main: a user edit stops Auto', api.getState().auto === false && ctl.mode === null);

  // window.snSaver: enter, frames, exit restores the viewer's settings
  globalThis.window = { innerWidth: 1280, innerHeight: 800, parent: null, frameElement: null };
  try {
    const g2 = stubGlobe();
    const app2 = M.createApp({ D, net, globe: g2, seed: 5, disease: 'flu-seasonal' });
    const ctl2 = installSaver(app2.saverApp);
    app2.attach({ ctl: ctl2 });
    const before = app2.api.getState();
    ok('main: snSaver installed', typeof window.snSaver.enter === 'function' && typeof window.snSaver.exit === 'function');
    const r = window.snSaver.enter({ calm: 0.7, seed: 1234, label: () => {} });
    ok('main: snSaver.enter gives a canvas slot and warmup', r && 'canvas' in r && r.warmupMs > 0);
    ok('main: saver mode reports auto', app2.api.getState().auto === true && ctl2.mode === 'saver');
    let t2 = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    for (let k = 0; k < 30 * 30; k++) { app2.frame(t2); t2 += 1 / 30; }
    const dbg = window.snSaver.debug();
    ok('main: saver plays shots', dbg.mode === 'saver' && dbg.shots >= 2, `shots ${dbg.shots}`);
    ok('main: saver cut works', window.snSaver.cut('network') === true);
    app2.drag(100, 0, 800);
    ok('main: drag does not stop the saver', ctl2.mode === 'saver');
    window.snSaver.exit();
    const after = app2.api.getState();
    ok('main: exit restores the disease', after.disease.id === before.disease.id);
    ok('main: exit restores the style and Auto off', after.style === before.style && after.auto === false);
    ok('main: exit restores the fade', g2.fade === 1);
  } finally { delete globalThis.window; }

  ok('main: policy ids known', POLICY_DEFS.some(d => d.id === 'distancing'));
}

