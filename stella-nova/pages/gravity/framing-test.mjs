// ============================================================================
//  GRAVITY PLAYGROUND  ·  action framing check  (Node)
// ----------------------------------------------------------------------------
//  Runs the page view and the saver view of main.js in node: the same
//  framing.js sample, lib/action-camera.js and toView, on a copy of the
//  page integrator (saver-test.mjs forces and step). Asserts:
//    page view (the five presets as main.js builds them, seeded, and an
//    escape run), 1280 x 720 and a 390 x 760 phone:
//      - the action weight in view stays at or above 0.8 (each frame
//        after the first second)
//      - the camera does not chase an escaper: at the end the escaper is
//        off screen, and the framed radius stays under 2.5 times its value
//        when the escaper's weight went to 0
//      - camera steps: the centre moves at most 6 px a frame, the zoom at
//        most CAM.maxZoomRate / 60 in ln a frame
//    saver (every scene of saver-scenes.js, seeds 1-3, 16:9 and the 9:16
//    column with their plate bands):
//      - the action weight in the plate view at or above 0.8, the same
//        step bounds, and the fill of the band between 0.15 and 0.95
//      - the seeded look differs between seeds
//  The presets below are copies of main.js laplace, binaryStar, figure8,
//  miniSolar and chaos5 (Math.random replaced by a seeded rng).
//  Run: node stella-nova/pages/gravity/framing-test.mjs   (tests.mjs runs it)
//  grep: function pageRun  function saverRun  const PRESETS
// ============================================================================
import { createRequire } from 'node:module';
import { forces, step } from './saver-test.mjs';
import { createActionCamera } from '../../lib/action-camera.js';
const require = createRequire(import.meta.url);
const F = require("./framing.js");
const T = require('./trails.js');
const { SCENES } = require('./saver-scenes.js');

const G = 1000, DT = 0.01, PACE = 0.3;
let fail = 0;
const check = (ok, name, info = '') => { if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
function rng(seed) { return () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const mk = (name, x, y, vx, vy, mass, radius, color, fixed) => ({ name, x, y, vx, vy, ax: 0, ay: 0, mass, radius, color, fixed: !!fixed, trail: T.make(), tper: 0 });

const PRESETS = {
  laplace() { const star = 8000, r1 = 110, r2 = r1 * Math.pow(2, 2 / 3), r3 = r1 * Math.pow(4, 2 / 3), v = r => Math.sqrt(G * star / r);
    return [mk('Star', 0, 0, 0, 0, star, 20, '', true), mk('Io', r1, 0, 0, v(r1), 1.5, 5), mk('Europa', 0, r2, -v(r2), 0, 2, 6), mk('Ganymede', -r3, 0, 0, -v(r3), 3, 8)]; },
  binary() { const sep = 100, m = 2000, v = Math.sqrt(G * m / (4 * sep));
    return [mk('Alpha', sep, 0, 0, v, m, 14), mk('Beta', -sep, 0, 0, -v, m, 14), mk('Planet', 0, 300, -Math.sqrt(G * 2 * m / 300) * 0.95, 0, 5, 5)]; },
  figure8() { const s = 100, m = 500, vs = Math.sqrt(G * m / s);
    return [mk('A', -0.97000436 * s, 0.24308753 * s, 0.466203685 * vs, 0.43236573 * vs, m, 10), mk('B', 0.97000436 * s, -0.24308753 * s, 0.466203685 * vs, 0.43236573 * vs, m, 10), mk('C', 0, 0, -0.93240737 * vs, -0.86473146 * vs, m, 10)]; },
  solar(R) { const star = 8000, B = [mk('Sun', 0, 0, 0, 0, star, 22, '', true)], radii = [80, 130, 190, 280, 400], masses = [3, 8, 10, 5, 80], sizes = [4, 6, 7, 5, 12];
    for (let i = 0; i < 5; i++) { const r = radii[i], v = Math.sqrt(G * star / r), a = R() * Math.PI * 2; B.push(mk('P' + i, r * Math.cos(a), r * Math.sin(a), -v * Math.sin(a), v * Math.cos(a), masses[i], sizes[i])); }
    return B; },
  chaos(R) { const B = [];
    for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5, r = 80 + R() * 80, v = Math.sqrt(G * 200 * 5 / (r * 2)) * (0.8 + R() * 0.4);
      B.push(mk('Body ' + (i + 1), r * Math.cos(a), r * Math.sin(a), -v * Math.sin(a), v * Math.cos(a), 150 + R() * 300, 6 + R() * 6)); }
    return B; },
  // an escape: two moons and a probe thrown out at 1.5 times the escape speed
  escape() { const star = 8000, v = r => Math.sqrt(G * star / r), B = PRESETS.laplace().slice(0, 3), r = 150;
    B.push(mk('Probe', 0, -r, 1.5 * Math.SQRT2 * v(r) * 0.6, -1.5 * Math.SQRT2 * v(r) * 0.8, 1, 5)); return B; },
};

// The page view for one run: 60 fps, timeScale 1 (one step of h = PACE/60
// a frame, as main.js loop), the trail of each body and its smoothed
// period, the action camera, toView into the whole canvas.
function pageRun(B, W, H, seconds) {
  const ac = createActionCamera(F.CAM), view = { W, H, cx: W / 2, cy: H / 2, hw: W / 2, hh: H / 2 };
  const rect = { x0: 0, x1: W, y0: 0, y1: H };
  forces(B);
  let t = 0, s = null, prev = null, minW = 1, maxPx = 0, maxLz = 0, escR = null, escName = null, endR = 0, escOff = true, frames = 0;
  const h = PACE / 60;
  for (let f = 0; f < seconds * 60; f++) {
    step(B, h); t += h;
    for (let i = 0; i < B.length; i++) {
      const b = B[i]; T.sample(b.trail, b.x, b.y, t);
      let P = T.oscPeriod(B, i, G); if (!(P > 0) || P > 60) P = 60; b.tper = b.tper > 0 ? b.tper + (P - b.tper) * 0.08 : P;
    }
    s = F.buildSample(B, G, t, b => b.tper > 0 ? b.tper : 6, s);
    const g = ac.update(s, 1 / 60), c = F.toView(g, view, F.FILL, F.Z_MIN, F.Z_MAX), w = s.w;
    if (f > 60) minW = Math.min(minW, F.weightInView(B, w, c, W, H, rect));
    if (prev) {
      // the move of the world point at the view centre, in px
      const wx = (W / 2 - W / 2 - prev.x) / prev.z, wy = (H / 2 - H / 2 - prev.y) / prev.z;
      const sx = W / 2 + c.x + wx * c.z, sy = H / 2 + c.y + wy * c.z;
      maxPx = Math.max(maxPx, Math.hypot(sx - W / 2, sy - H / 2)); maxLz = Math.max(maxLz, Math.abs(Math.log(c.z / prev.z)));
    }
    prev = c; frames++;
    for (let i = 0; i < B.length; i++) if (w[i] === 0 && escR === null) { escR = g.radius; escName = i; }
    endR = g.radius;
    if (escName !== null && f === seconds * 60 - 1) { const b = B[escName], sx = W / 2 + c.x + b.x * c.z, sy = H / 2 + c.y + b.y * c.z; escOff = sx < 0 || sx > W || sy < 0 || sy > H; }
  }
  return { minW, maxPx, maxLz, escR, escName, endR, escOff, frames };
}

const lzCap = F.CAM.maxZoomRate / 60 + 1e-9;
for (const [W, H] of [[1280, 720], [390, 760]]) {
  const rows = [];
  for (const key of Object.keys(PRESETS)) for (const seed of key === 'chaos' || key === 'solar' ? [1, 2, 3, 4] : [1]) {
    const r = pageRun(PRESETS[key](rng(seed)), W, H, 90);
    rows.push({ key: key + (seed > 1 || key === 'chaos' || key === 'solar' ? ':' + seed : ''), ...r });
  }
  const minW = Math.min(...rows.map(r => r.minW)), worst = rows.find(r => r.minW === minW);
  check(minW >= 0.8, `page ${W}x${H}: the action weight in view stays at or above 0.8`, `min ${minW.toFixed(3)} (${worst.key}); ${rows.map(r => r.key + ' ' + r.minW.toFixed(2)).join(', ')}`);
  const esc = rows.filter(r => r.escName !== null), bad = esc.filter(r => !r.escOff || r.endR > 2.5 * r.escR);
  check(esc.some(r => r.key === 'escape') && bad.length === 0, `page ${W}x${H}: no chase of an escaper`, `${esc.length} runs with an escaper (${esc.map(r => r.key + ' R ' + r.escR.toFixed(0) + '->' + r.endR.toFixed(0) + (r.escOff ? ' off' : ' ON')).join(', ')})`);
  const px = Math.max(...rows.map(r => r.maxPx)), lz = Math.max(...rows.map(r => r.maxLz));
  check(px <= 6 && lz <= lzCap, `page ${W}x${H}: camera steps under the bound`, `centre ${px.toFixed(2)} px/frame (limit 6), zoom ${lz.toExponential(2)} ln/frame (limit ${lzCap.toExponential(2)})`);
}

// The saver view for one scene, as main.js snSaver: a look-ahead run of
// 1.3 holds records frames, then the shown run frames them.
function saverRun(sc, seed, W, H, band) {
  const calm = 0.7, ts = sc.ts * (1 - 0.3 * calm), holdS = 10, holdSim = holdS * PACE * ts;
  const S = sc.build(rng(seed * 31 + 7919), G, (n, x, y, vx, vy, m, r, c, f) => ({ name: n, x, y, vx, vy, ax: 0, ay: 0, mass: m, radius: r, color: c, fixed: !!f }));
  const B = S.bodies, every = Math.max(1, Math.round(PACE * ts / 20 / DT));
  const shown = (b, t) => { if (!S.omega) return [b.x, b.y]; const a = -S.omega * t - Math.PI / 2, c = Math.cos(a), s = Math.sin(a); return [c * b.x - s * b.y, s * b.x + c * b.y]; };
  forces(B, S.extra);
  const frames = [], states = [];
  let t = 0;
  const steps = Math.round(2.4 * holdSim / DT);
  for (let k = 0; k < steps; k++) {
    step(B, DT, S.extra); t += DT;
    const w = F.weights(B, G), org = sc.follow != null ? shown(B[sc.follow], t) : [0, 0];
    states.push({ t, P: B.map(b => shown(b, t)), w, org });
    if (k % every === 0) { const pts = []; B.forEach((b, i) => { if (w[i] > 0) { const p = shown(b, t); pts.push(p[0] - org[0], p[1] - org[1], w[i]); } }); frames.push({ t, pts }); }
  }
  const look = F.saverLook(rng(seed * 131 + 17)), ac = createActionCamera(F.SAVER_CAM), v = F.saverView(W, H, band);
  let rmax = 1; for (const b of B) if (!b.noframe) rmax = Math.max(rmax, b.radius);
  const zMax = Math.min(6, 0.03 * Math.min(W, H) / rmax);
  let s = null, prev = null, minW = 1, maxPx = 0, maxLz = 0, fillMin = 9, fillMax = 0;
  const perFrame = PACE * ts / 60;
  for (let f = 0; f < holdS * 60; f++) {
    const now = f * perFrame, st = states[Math.min(states.length - 1, Math.round(now / DT))];
    s = F.windowSample(frames, now, look.back * holdSim, look.ahead * holdSim, s);
    const g = ac.update(s, 1 / 60), fill = look.fill * (1 + look.dolly * Math.min(1, now / holdSim));
    const c = F.toView({ center: [g.center[0] + st.org[0], g.center[1] + st.org[1]], radius: g.radius }, v, fill, 0.05, zMax);
    if (f > 30) minW = Math.min(minW, F.weightInView(st.P.map(p => ({ x: p[0], y: p[1] })), st.w, c, W, H, v.rect));
    fillMin = Math.min(fillMin, g.radius * c.z / Math.min(v.hw, v.hh)); fillMax = Math.max(fillMax, g.radius * c.z / Math.min(v.hw, v.hh));
    if (prev) {
      const wx = (v.cx - W / 2 - prev.x) / prev.z, wy = (v.cy - H / 2 - prev.y) / prev.z;
      const sx = W / 2 + c.x + wx * c.z, sy = H / 2 + c.y + wy * c.z;
      maxPx = Math.max(maxPx, Math.hypot(sx - v.cx, sy - v.cy)); maxLz = Math.max(maxLz, Math.abs(Math.log(c.z / prev.z)));
    }
    prev = c;
  }
  return { minW, maxPx, maxLz, fillMin, fillMax, look };
}
for (const [W, H, band, name] of [[1920, 1080, { t: 230, b: 260 }, '16:9'], [608, 1080, { t: 250, b: 300 }, '9:16']]) {
  const rows = [];
  for (const sc of SCENES) for (const seed of [1, 2, 3]) rows.push({ key: sc.key + ':' + seed, ...saverRun(sc, seed, W, H, band) });
  const minW = Math.min(...rows.map(r => r.minW)), worst = rows.find(r => r.minW === minW);
  check(minW >= 0.8, `saver ${name}: the action weight in the plate view at or above 0.8`, `min ${minW.toFixed(3)} (${worst.key}) over ${rows.length} scene runs`);
  const px = Math.max(...rows.map(r => r.maxPx)), lz = Math.max(...rows.map(r => r.maxLz)), lzc = F.SAVER_CAM.maxZoomRate / 60 + 2e-4;   // the dolly adds at most 1e-4 a frame
  check(px <= 6 && lz <= lzc, `saver ${name}: camera steps under the bound`, `centre ${px.toFixed(2)} px/frame (limit 6), zoom ${lz.toExponential(2)} ln/frame (limit ${lzc.toExponential(2)})`);
  const f0 = Math.min(...rows.map(r => r.fillMin)), f1 = Math.max(...rows.map(r => r.fillMax));
  check(f0 >= 0.15 && f1 <= 0.95, `saver ${name}: the subject fills 15-95% of the band`, `fill ${f0.toFixed(2)}..${f1.toFixed(2)}`);
}
{
  const looks = [1, 2, 3].map(sd => F.saverLook(rng(sd * 131 + 17)));
  check(new Set(looks.map(l => l.fill.toFixed(3))).size === 3, 'saver: the seeded look differs between seeds', looks.map(l => `fill ${l.fill.toFixed(2)} dolly ${l.dolly.toFixed(2)}`).join('; '));
}
{
  // not too much: a sparse view keeps gain 1; the 56 disk stars of the
  // tidal scene dim the trails; a pile of big glows dims them too
  const few = PRESETS.laplace(), tidal = SCENES.find(s => s.key === 'tidal').build(rng(1), G, mk).bodies;
  const pile = Array.from({ length: 30 }, (_, i) => mk('', i, 0, 0, 0, 1, 20));
  const g0 = F.crowdGain(few, 1, 1280, 720), g1 = F.crowdGain(tidal, 1, 1280, 720), g2 = F.crowdGain(pile, 2, 1280, 720);
  check(g0 === 1 && g1 < 0.6 && g2 >= 0.4 && g2 < 0.7, 'crowd gain: 1 when sparse, dimmer for many trails or glows, never under 0.4', `laplace ${g0.toFixed(2)}, tidal ${g1.toFixed(2)}, 30 big glows ${g2.toFixed(2)}`);
  check(F.followBlend(1, F.IDLE, F.EASE) === 0 && F.followBlend(F.IDLE + F.EASE / 2, F.IDLE, F.EASE) === 0.5 && F.followBlend(F.IDLE + F.EASE, F.IDLE, F.EASE) === 1,
    'user override: no follow while the user is active, an ease back after the idle time', `idle ${F.IDLE} s, ease ${F.EASE} s`);
}
console.log(fail ? `${fail} failures` : 'all framing checks pass');
process.exit(fail ? 1 : 0);
