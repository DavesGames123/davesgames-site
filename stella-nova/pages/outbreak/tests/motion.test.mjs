// motion: the Auto camera in main.js with the real director, model and
// network, and a stub globe (no browser, no GPU). The camera target and
// heading must move slowly, apart from a jump behind a full fade.
import { readFileSync } from 'node:fs';
import { parseNodes } from '../data.js';
import { buildNetwork } from '../network.js';
import { flight } from '../camera.js';
import { slerpLL } from '../geo.js';

const RAD = Math.PI / 180;
const gc = (a, b) => Math.acos(Math.max(-1, Math.min(1, Math.sin(a.lat * RAD) * Math.sin(b.lat * RAD) + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((a.lon - b.lon) * RAD)))) / RAD;
const dHead = (a, b) => Math.abs(((b - a) % 360 + 540) % 360 - 180);

function stubGlobe() {
  const g = {
    styles: [{ id: 'night', label: 'Night' }, { id: 'marble', label: 'Marble' }, { id: 'dots', label: 'Dots' },
      { id: 'flat', label: 'Flat map' }, { id: 'holo', label: 'Hologram' }],
    style: null, mode: 'globe', cam: null, fade: 1,
    setStyle(id) { g.style = id; g.mode = id === 'flat' ? 'flat' : 'globe'; },
    setCamera(c) { g.cam = { ...c }; }, setViewOffset() {}, update() {}, setFade(a) { g.fade = a; },
    pick: () => -1, resize() {}, dispose() {},
  };
  return g;
}

export default async function (ok) {
  const M = await import('../main.js');
  const { installSaver } = await import('../saver.js');
  const D = parseNodes(JSON.parse(readFileSync(new URL('../data/nodes.json', import.meta.url), 'utf8')));
  const net = buildNetwork(D);

  // calm flights: the speed cap and the turn cap hold for a big heading change
  const f = flight({ lat: 0, lon: 0, alt: 1, tilt: 0, heading: 0 }, { lat: 10, lon: 20, alt: 1, tilt: 30, heading: 170 }, { ...M.FLY, mode: 'globe' });
  let pk = 0, ph = 0;
  for (let i = 1; i <= 400; i++) { const a = f.at((i - 1) / 400 * f.dur), b = f.at(i / 400 * f.dur), dt = f.dur / 400; pk = Math.max(pk, gc(a, b) / dt); ph = Math.max(ph, dHead(a.heading, b.heading) / dt); }
  ok('motion: a flight holds the calm speed and turn caps', pk <= M.FLY.maxDegPerSec * 1.01 && ph <= M.FLY.maxTurnDegPerSec * 1.01, `${pk.toFixed(1)} deg/s, turn ${ph.toFixed(1)} deg/s`);

  // a flight that only zooms or turns stays on its point (no loop over a pole)
  const same = slerpLL({ lat: 24.87, lon: 66.99 }, { lat: 24.87, lon: 66.99000000000001 }, 0.5);
  ok('motion: slerp of one point stays on it', Math.abs(same[0] - 24.87) < 1e-6 && Math.abs(same[1] - 66.99) < 1e-6, same.map(x => x.toFixed(4)).join());

  const g = stubGlobe();
  const app = M.createApp({ D, net, globe: g, seed: 21 });
  const ctl = installSaver(app.saverApp);
  app.attach({ ctl });
  ok('motion: the Auto button starts', ctl.auto(true, { seed: 77 }) === true);
  let t = 10, prev = null, prevFade = 1, maxDeg = 0, maxTurn = 0, jumps = 0, steady = 0;
  const fps = 30, dt = 1 / fps;
  for (let k = 0; k < 6 * 60 * fps; k++) {
    app.frame(t); t += dt;
    const c = g.cam, fade = g.fade;
    if (prev && fade > 0.05 && prevFade > 0.05) {
      const v = gc(prev, c) / dt, w = dHead(prev.heading || 0, c.heading || 0) / dt;
      maxDeg = Math.max(maxDeg, v); maxTurn = Math.max(maxTurn, w);
      if (v < 2.5 && w < 2.5) steady++;
    } else if (prev && gc(prev, c) > 1) jumps++;
    prev = c; prevFade = fade;
  }
  const dbg = ctl.debug();
  ok('motion: Auto ran shots for six minutes', dbg.shots >= 20, `${dbg.shots} shots, ${dbg.runs} runs`);
  ok('motion: the camera target moves under the calm limit (20 deg/s)', maxDeg <= 20, `peak ${maxDeg.toFixed(1)} deg/s`);
  ok('motion: the heading turns under the calm limit (20 deg/s)', maxTurn <= 20, `peak ${maxTurn.toFixed(1)} deg/s`);
  ok('motion: most of the time the camera holds or drifts slowly', steady > 0.6 * 6 * 60 * fps, `${(steady / (6 * 60 * fps) * 100).toFixed(0)} % of frames under 2.5 deg/s`);
  ok('motion: far cuts jump behind a full fade', jumps >= 1, `${jumps} jumps`);
  ctl.auto(false);

  // the idle turn: slow, and eased in (no step at the start)
  const g2 = stubGlobe();
  const app2 = M.createApp({ D, net, globe: g2, seed: 3 });
  app2.api.play(false);
  let t2 = 0, p2 = null, maxIdle = 0, firstStep = null;
  for (let k = 0; k < 20 * fps; k++) {
    app2.frame(t2); t2 += dt;
    if (p2) { const v = gc(p2, g2.cam) / dt; maxIdle = Math.max(maxIdle, v); if (firstStep === null && v > 0) firstStep = v; }
    p2 = g2.cam;
  }
  ok('motion: the idle turn is slow', maxIdle <= M.IDLE_DRIFT * 1.01 && M.IDLE_DRIFT <= 1.5, `${maxIdle.toFixed(2)} deg/s`);
  ok('motion: the idle turn eases in', firstStep !== null && firstStep < 0.2 * M.IDLE_DRIFT, firstStep && firstStep.toFixed(3));
}
