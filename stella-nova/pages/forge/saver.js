// ============================================================================
//  PLANET FORGE  ·  saver.js — window.snSaver, the screensaver tour
// ----------------------------------------------------------------------------
//  The shell (lib/screensaver.js) calls snSaver.enter(opts), opts = { calm,
//  seconds, caption, seed, label }. enter hides the GUI (html.sn-saver) and
//  plays a seeded tour (a new order each run): rocky presets and giants
//  shuffled apart, then alternated, each with a fresh seed. A planet holds
//  2-3 shots; each shot lasts 5-12 s (calm stretches it) and ends in a cut.
//  The next planet generates in the workers while the current one plays.
//
//  Shots (the camera eases inside a shot, so it never jumps mid-shot):
//    orbit    a slow arc at 3-3.6 radii, the sun three-quarters on
//    sunrise  the camera low over the night side; the sun climbs past the
//             limb (the atmosphere lights up, then the disc clears it)
//    push     a push-in from 2.3 to 1.45 radii on the great spot (giants)
//             or the highest massif (rocky); spin stops for the shot
//    rings    a low pass across the ring plane (ringed giants only)
//    lapse    a wide shot at 4.2 radii, the planet left of centre, a 6 h/s
//             time-lapse (the planet turns, the clouds evolve). Half are
//             lit from the camera side; half are backlit: a crescent, the
//             granulated sun disc in frame and the starfield.
//  Time: the tour runs the clock at SAVER_RATE (20 min/s), so cloud decks
//  move in every shot; the lapse shot runs at LAPSE_RATE. exit() puts
//  back the user's rate.
//  The planet is framed in the plate's clear band (lib/saver-clear.js
//  plateBand through main.js clearArea). The plate names the planet, its
//  family member (preset and seed), its generator parameters, the clock
//  rate and the scattering maths in TeX. No code on the plate.
//
//  snSaver.debug() returns the director state; snSaver.cut() forces the
//  next shot (for probes).
//
//  grep -n targets: "const SHOTS", "function planFor", "function shotCam",
//  "function plate", "function tick"
// ============================================================================
import * as PR from './presets.js';
import { plateBand } from '../../lib/saver-clear.js';
import { worldFrame } from './render.js';

const D2R = Math.PI / 180;
const SAVER_RATE = 1200, LAPSE_RATE = 21600;
const rateText = r => r >= 86400 ? (r / 86400) + ' day/s' : r >= 3600 ? (r / 3600) + ' h/s' : (r / 60) + ' min/s';
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const ease = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

let run = null;

window.snSaver = {
  enter(opts = {}) {
    const F = window.__forge;
    if (!F) return null;
    if (run) this.exit();
    const S = F.S;
    const calm = Math.max(0, Math.min(1, opts.calm ?? 0.7));
    let seed = (opts.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0) || 1;
    const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const label = opts.labels !== false && typeof opts.label === 'function' ? opts.label : null;
    const rocky = shuffle(PR.PRESETS.filter(p => p.kind === 'rocky').map(p => p.id));
    const gas = shuffle(PR.PRESETS.filter(p => p.kind === 'gas').map(p => p.id));
    const order = [];
    for (let i = 0; i < Math.max(rocky.length, gas.length); i++) { order.push(rocky[i % rocky.length]); order.push(gas[i % gas.length]); }
    const W = F.ENV.mobile ? 1024 : 2048;
    const saved = { moveSun: S.moveSun, spin: S.spin, exposure: S.exposure, rate: S.rate, clouds: S.clouds };
    document.documentElement.classList.add('sn-saver');
    S.saver = true; S.moveSun = false; S.spin = true; S.exposure = 0.7; S.rate = SAVER_RATE; S.clouds = true;
    run = { i: 0, order, W, shot: null, shotsLeft: 0, next: null, P: null, M: null, raf: 0, saved, label, calm, rnd };

    const makeNext = () => {
      const id = order[run.i++ % order.length];
      const P = PR.fromPreset(id, Math.floor(rnd() * 1e6));
      const job = { P, M: null, ready: false };
      job.promise = F.pool.generate(P, W).then(M => { job.M = M; job.ready = true; }).catch(() => {});
      return job;
    };
    run.next = makeNext();

    function adoptNext() {
      const j = run.next;
      if (!j || !j.ready) return false;
      run.P = j.P; run.M = j.M;
      F.adopt(j.P, j.M, W);
      run.shotsLeft = 2 + (rnd() < 0.4 ? 1 : 0);
      run.kinds = shuffle(['orbit', 'sunrise', 'push', 'lapse', ...(j.P.rings && j.P.rings.on ? ['rings'] : [])]);
      run.next = makeNext();
      return true;
    }

    function planFor(kind) {
      const P = run.P, dur = (5 + 7 * rnd()) * (0.8 + 0.4 * calm);
      const a0 = rnd() * Math.PI * 2, dir = rnd() < 0.5 ? -1 : 1;
      const sh = { kind, t0: performance.now(), dur, a0, dir, el: (rnd() - 0.4) * 0.5 };
      S.rate = kind === 'lapse' ? LAPSE_RATE : SAVER_RATE;
      if (kind === 'lapse') sh.lit = rnd() < 0.5;
      if (kind === 'push') {
        // the subject in the body frame
        let b;
        if (P.kind === 'gas' && P.storms.spot) { const lat = P.storms.spotLat * D2R, lon = P.storms.spotLon * 2 * Math.PI; b = [-Math.cos(lon) * Math.cos(lat), Math.sin(lat), Math.sin(lon) * Math.cos(lat)]; }
        else b = highPoint(run.M);
        S.spin = false;
        sh.subject = norm(worldFrame(b, P.tilt, S.spinAngle));
      } else S.spin = true;
      return sh;
    }

    // Camera of a shot at progress u (0..1).
    function shotCam(sh, u) {
      const e = ease(u);
      if (sh.kind === 'orbit') {
        const yaw = sh.a0 + sh.dir * 0.35 * e, d = lerp(3.6, 3.1, e), el = sh.el;
        const pos = [d * Math.cos(el) * Math.sin(yaw), d * Math.sin(el), d * Math.cos(el) * Math.cos(yaw)];
        const sun = norm([Math.sin(yaw + 1.0), 0.25, Math.cos(yaw + 1.0)]);
        return { pos, target: [0, 0, 0], up: [0, 1, 0], fov: 32 * D2R, sunDir: sun };
      }
      if (sh.kind === 'lapse') {
        // wide and still: the planet left of centre, backlit to a crescent,
        // the sun disc in frame to the right of it, the starfield behind;
        // the time-lapse does the motion
        const yaw = sh.a0 + sh.dir * 0.08 * e, d = 4.2, el = sh.el * 0.6;
        const pos = [d * Math.cos(el) * Math.sin(yaw), d * Math.sin(el), d * Math.cos(el) * Math.cos(yaw)];
        const fwd = norm(pos.map(v => -v)), right = norm(cross(fwd, [0, 1, 0]));
        // half the lapse shots: lit from the camera side (day clouds move),
        // the other half: backlit (the sun disc in frame, night glow)
        const sun = sh.lit ? norm([-fwd[0] * 0.35 + right[0], 0.25, -fwd[2] * 0.35 + right[2]])
          : norm([fwd[0] + right[0] * 0.34, 0.06, fwd[2] + right[2] * 0.34]);
        const target = right.map(v => v * 0.55);
        return { pos, target, up: [0, 1, 0], fov: 40 * D2R, sunDir: sun };
      }
      if (sh.kind === 'sunrise') {
        const s = norm([Math.sin(sh.a0), 0.15, Math.cos(sh.a0)]);
        const up0 = norm(cross(cross(s, [0, 1, 0]), s));
        const u0 = [-up0[0], -up0[1], -up0[2]];
        const D = 2.6, lim = Math.asin(1 / D), b = lerp(lim - 0.12, lim + 0.06, e);
        const c = norm([-s[0] * Math.cos(b) + u0[0] * Math.sin(b), -s[1] * Math.cos(b) + u0[1] * Math.sin(b), -s[2] * Math.cos(b) + u0[2] * Math.sin(b)]);
        const pos = [c[0] * D, c[1] * D, c[2] * D];
        const target = [u0[0] * 0.75, u0[1] * 0.75, u0[2] * 0.75];
        return { pos, target, up: u0, fov: 28 * D2R, sunDir: s };
      }
      if (sh.kind === 'push') {
        const n = sh.subject, d = lerp(2.3, 1.45, e);
        const side = norm(cross(n, [0, 1, 0])), off = 0.18 * (1 - e * 0.5);
        const pos = [n[0] * d + side[0] * off, n[1] * d + side[1] * off, n[2] * d + side[2] * off];
        const sun = norm([n[0] + side[0] * 1.4, n[1] + 0.3, n[2] + side[2] * 1.4]);
        return { pos, target: n.map(v => v * 0.9), up: [0, 1, 0], fov: 30 * D2R, sunDir: sun };
      }
      // rings: a low pass across the plane
      const yaw = sh.a0 + sh.dir * 0.3 * e, d = 5.2, el = (6 + 6 * e) * D2R;
      const tilt = run.P.tilt * D2R;
      const pos = worldFrame([d * Math.cos(el) * Math.sin(yaw), d * Math.sin(el), d * Math.cos(el) * Math.cos(yaw)], run.P.tilt, 0);
      const sun = norm([Math.sin(yaw + 2.2), Math.sin(tilt) + 0.35, Math.cos(yaw + 2.2)]);
      return { pos, target: [0, 0, 0], up: worldFrame([0, 1, 0], run.P.tilt, 0), fov: 36 * D2R, sunDir: sun };
    }

    function plate() {
      if (!label || !run.P) return;
      const P = run.P, rocky = P.kind === 'rocky', A = P.atmo;
      const kind = run.shot ? run.shot.kind : 'orbit';
      const shotName = { orbit: 'orbit', sunrise: 'sunrise over the limb', push: rocky || !P.storms.spot ? 'push-in on the highest point' : 'push-in on the great spot', rings: 'across the ring plane', lapse: 'time-lapse under the stars' }[kind];
      const pr = PR.presetById(P.preset);
      const params = rocky ? [
        { sym: 'o', name: 'octaves', value: P.terrain.octaves.toFixed(1) },
        { sym: '\\lambda', name: 'lacunarity', value: P.terrain.lacunarity.toFixed(2) },
        { sym: 'g', name: 'gain', value: P.terrain.gain.toFixed(2) },
        { sym: 'w', name: 'warp', value: P.terrain.warp.toFixed(2) },
        { sym: 'k', name: 'ridge sharpness', value: P.mountains.sharpness.toFixed(1) },
        ...(P.craters.density > 0 ? [{ sym: '\\alpha', name: 'crater power law', value: P.craters.slope.toFixed(2) }] : []),
        ...(P.ocean.level > 0 ? [{ sym: 's', name: 'sea cover', value: Math.round(P.ocean.level * 100) + ' %' }] : []),
      ] : [
        { sym: 'N', name: 'bands', value: String(P.bands.count) },
        { sym: 'c', name: 'contrast', value: P.bands.contrast.toFixed(2) },
        { sym: 't', name: 'turbulence', value: P.turbulence.amount.toFixed(2) },
        { sym: 'u_0', name: 'equator jet', value: P.bands.equatorJet.toFixed(2) },
        { sym: 'n_s', name: 'storms', value: String(P.storms.spot + P.storms.ovals + P.storms.small) },
      ];
      if (A.on) params.push({ sym: 'H_R', name: 'Rayleigh scale height', value: A.rayleighH + ' km' });
      params.push({ sym: '\\dot t', name: 'time-lapse', value: rateText(S.rate) });
      const lapseTex = ['N(<m) \\propto 10^{0.45\\,m}', 'I(\\mu) = I_0\\,(0.3 + 0.7\\,\\mu^{0.55})'];
      const lapseEq = ['N(<m) ∝ 10^(0.45 m)', 'I(μ) = I₀ (0.3 + 0.7 μ^0.55)'];
      const tex0 = A.on ? [
        'P_R(\\theta) = \\frac{3}{16\\pi}\\left(1 + \\cos^2\\theta\\right)',
        '\\tau(s) = \\int_0^s \\beta_R\\, e^{-h/H_R} + \\beta_M\\, e^{-h/H_M}\\, dx',
        'L = \\int_0^{t} T(x)\\, \\sigma_s(x) \\left[ P(\\theta)\\, T_\\odot(x)\\, E + \\Psi_{ms} \\right] dx',
      ] : [
        rocky ? 'N(>r) \\propto r^{-\\alpha}' : 'u(\\varphi) = u_0 e^{-(\\varphi/w)^2} + \\sum_k a_k e^{-((\\varphi-\\varphi_k)/\\sigma)^2}',
        'f_{\\mathrm{spec}} = \\frac{D\\, G\\, F}{4\\, (n\\cdot l)(n\\cdot v)}',
      ];
      const tex = kind === 'lapse' ? [...lapseTex, tex0[0]] : tex0;
      const eq0 = A.on ? ['P_R(θ) = 3/(16π) (1 + cos²θ)', 'τ(s) = ∫ β_R e^(−h/H_R) + β_M e^(−h/H_M) dx', 'L = ∫ T σ_s [P(θ) T_sun E + Ψ_ms] dx']
        : [rocky ? 'N(>r) ∝ r^(−α)' : 'u(φ) = u₀ e^(−(φ/w)²) + Σ jets', 'f_spec = D G F / (4 (n·l)(n·v))'];
      const eq = kind === 'lapse' ? [...lapseEq, eq0[0]] : eq0;
      label({
        title: `${P.name}, seed ${P.seed}`,
        sub: (pr ? pr.name + ' family' : rocky ? 'Rocky world' : 'Gas giant') + ' · ' + shotName + ' · ' + rateText(S.rate),
        params, tex, eq,
        lines: [rocky ? 'warped fBm continents, plate uplift, ridged mountains, eroded detail' + (P.craters.density > 0 ? ', power-law craters' : '') : 'zonal band profile, curl-advected turbulence, vortices',
          kind === 'lapse' ? 'stars: magnitudes by the count law, colours from black-body temperatures; sun: granulation and limb darkening' : 'clouds evolve on the GPU in simulated hours; the sky turns with the world frame, not the planet'],
        anchor: () => {
          if (!run || !run.shot || run.shot.kind !== 'orbit') return null;
          const ca = F.clearArea();
          return { x: (ca.x0 + ca.x1) / 2, y: (ca.y0 + ca.y1) / 2, r: (ca.y1 - ca.y0) * 0.3 };
        },
      });
    }

    function nextShot() {
      if (run.shotsLeft <= 0 || !run.P) { if (!adoptNext()) { if (run.shot) { run.shot.dur += 1.5; return; } return; } }
      const kind = run.kinds[(run.kinds.length + run.shotsLeft) % run.kinds.length];
      run.shot = planFor(kind);
      run.shotsLeft--;
      plate();
    }

    function tick() {
      if (!run) return;
      run.raf = requestAnimationFrame(tick);
      try { S.band = plateBand(innerHeight); } catch (e) { S.band = null; }
      if (!run.shot || (performance.now() - run.shot.t0) / 1000 >= run.shot.dur) nextShot();
      if (!run.shot) { S.override = null; return; }
      const u = Math.min(1, (performance.now() - run.shot.t0) / 1000 / run.shot.dur);
      S.override = shotCam(run.shot, u);
    }
    // wait for the first planet, then start
    run.next.promise.then(() => { if (run) { nextShot(); } });
    tick();
    this.debug = () => run && { planet: run.P && run.P.preset, seed: run.P && run.P.seed, shot: run.shot && run.shot.kind, dur: run.shot && run.shot.dur, nextReady: run.next && run.next.ready };
    this.cut = () => { if (run && run.shot) run.shot.dur = 0; return true; };
    return { canvas: F.canvas, warmupMs: 3000 };
  },
  exit() {
    const F = window.__forge;
    if (!run || !F) return;
    cancelAnimationFrame(run.raf);
    const S = F.S;
    Object.assign(S, run.saved); S.saver = false; S.override = null; S.band = null; S.spin = true;
    document.documentElement.classList.remove('sn-saver');
    if (run.label) run.label(null);
    run = null;
  },
};

// The direction of the highest texel (a coarse scan), for the push-in.
function highPoint(M) {
  let best = -1, bi = 0;
  const step = Math.max(1, M.W >> 8);
  for (let y = M.H >> 3; y < M.H - (M.H >> 3); y += step) for (let x = 0; x < M.W; x += step) {
    const v = M.height[y * M.W + x]; if (v > best) { best = v; bi = y * M.W + x; }
  }
  const x = bi % M.W, y = (bi / M.W) | 0, u = (x + 0.5) / M.W, th = (y + 0.5) / M.H * Math.PI;
  return [-Math.cos(2 * Math.PI * u) * Math.sin(th), Math.cos(th), Math.sin(2 * Math.PI * u) * Math.sin(th)];
}
