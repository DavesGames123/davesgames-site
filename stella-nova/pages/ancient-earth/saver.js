// ============================================================================
//  ANCIENT EARTH  ·  saver.js  ·  window.snSaver, the screensaver tour
// ----------------------------------------------------------------------------
//  The shell (lib/screensaver.js) calls snSaver.enter(opts), opts = { calm,
//  seconds, caption, seed, label }. enter hides the GUI, then plays shots
//  in a seeded shuffle (a new order each run). Each shot holds 5-12 s
//  (calm makes them longer), and a cut fades the globe through black by
//  its exposure, so the recording (the WebGL canvas only) has the fade.
//
//  Shots:
//    pangea   a slow sweep from 330 to 170 Ma: Pangea joins and splits
//    assembly a sweep from 480 to 300 Ma over the closing Iapetus and Rheic
//    city     a modern city rides from its oldest age to today, with its
//             trail, the camera following it
//    kpg      68 to 65.5 Ma over the Yucatan, the K-Pg moment
//    ice      a pole view of an icehouse (Late Ordovician, Late Paleozoic,
//             the ice age) then of a hothouse world
//    orbit    one age, a slow orbit with the terminator and the sun glint
//    map      a colour-map mode (magma, viridis, turbo, atlas, outline with
//             plate tints) with a short time sweep
//  The globe is framed in the clear band of the label plate (plateBand).
//  Each shot sends the plate: title, the age in Ma and its period, notes,
//  and a real extract of recon.js (slerp, the pole interpolation).
//
//  snSaver.debug() returns the director state for CDP checks.
//
//  grep -n targets
//    shot list ........ "const SHOTS"
//    framing .......... "function frame"
//    the plate ........ "function plate"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';
import { describeAge, fmtMa } from './timescale.js';
import { climateAt, captionAt } from './world.js';

const CITIES = [['London', 51.507, -0.128], ['New York', 40.713, -74.006], ['Sydney', -33.868, 151.209], ['Mumbai', 19.07, 72.88], ['Cape Town', -33.925, 18.424],
  ['Tokyo', 35.676, 139.65], ['Buenos Aires', -34.6, -58.38], ['Moscow', 55.756, 37.617], ['Cairo', 30.04, 31.24], ['Perth', -31.95, 115.86], ['Mexico City', 19.43, -99.13], ['Beijing', 39.9, 116.4]];
const MAPS = [{ mode: 3, tint: 0, name: 'magma' }, { mode: 4, tint: 0, name: 'viridis' }, { mode: 6, tint: 0, name: 'turbo' }, { mode: 1, tint: 0, name: 'atlas tint' },
  { mode: 7, tint: 1, name: 'outline, plates' }, { mode: 1, tint: 2, name: 'atlas tint, modern continents' }, { mode: 5, tint: 0, name: 'inferno' }, { mode: 2, tint: 0, name: 'greyscale' }];

let CODE = `export function slerp(a, b, f) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let s = 1;
  if (d < 0) { d = -d; s = -1; }
  const th = Math.acos(d), st = Math.sin(th);
  const ka = Math.sin((1 - f) * th) / st, kb = s * Math.sin(f * th) / st;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb,
          a[2] * ka + b[2] * kb, a[3] * ka + b[3] * kb];
}`;

export function installSaver(AE) {
  AE.saverOn = false;
  // the real source of slerp in recon.js (the fallback above is a copy)
  fetch(new URL('recon.js', import.meta.url)).then(r => r.text()).then(t => {
    const i = t.indexOf('export function slerp'), j = t.indexOf('\n}\n', i);
    if (i >= 0 && j > i) CODE = t.slice(i, j + 2).trim();
  }).catch(() => {});
  const G = AE.globe;
  let run = null;

  window.snSaver = {
    enter(opts = {}) {
      const calm = Math.max(0, Math.min(1, opts.calm ?? 0.7));
      let seed = (opts.seed >>> 0) || 1;
      const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      const label = typeof opts.label === 'function' ? opts.label : null;
      AE.saverOn = true;
      AE.stopPlay && AE.stopPlay();
      document.documentElement.classList.add('sn-saver');
      const st = document.createElement('style');
      st.textContent = '#labels{display:none!important}#view{cursor:none}';
      document.head.appendChild(st);
      const saved = { style: { ...G.state }, sun: { ...G.sun }, layers: { ...G.layers }, age: AE.state.age, cam: G.camera.position.clone(), rot: G.group.rotation.y };
      G.setLayer('fossils', false); G.setLayer('borders', false); G.setLayer('terranes', false); G.setLayer('bounds', false);
      G.setLayer('grid', true); G.setLayer('coast', true);
      G.controls.enabled = false;
      const pins = [];
      // seeded shuffle of the shot kinds (city twice: it is the best one)
      const kinds = ['pangea', 'assembly', 'city', 'city', 'kpg', 'ice', 'orbit', 'map', 'map'];
      for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
      const hold = () => (6 + 4 * calm + rnd() * 2.5) * 1000;
      const cityOrder = CITIES.slice().sort(() => rnd() - 0.5), mapOrder = MAPS.slice().sort(() => rnd() - 0.5);
      let ci = 0, mi = 0;
      run = { kinds, i: -1, shot: null, t0: 0, fade: 1, going: false, st, saved, pins, timer: 0, plateTimer: 0, band: null, bandAt: -1e9, fit: null };

      // ── framing in the plate's clear band ────────────────────────────────
      const frame = (zoom, k) => {
        const now = performance.now();
        if (now - run.bandAt > 250) { run.bandAt = now; run.band = plateBand(innerHeight); }
        const H = innerHeight, W = innerWidth, b = run.band;
        const top = b ? b.t : 0, bot = b ? b.b : 0, hc = Math.max(0.3 * H, H - top - bot), w = b ? Math.min(W, b.w) : W;
        const goal = { cy: top + hc / 2, r: Math.min(0.42 * hc, 0.42 * w) * zoom };
        run.fit = run.fit && k < 1 ? { cy: run.fit.cy + (goal.cy - run.fit.cy) * k, r: run.fit.r + (goal.r - run.fit.r) * k } : goal;
        AE.viewOverride = { cx: W / 2, cy: run.fit.cy, s: run.fit.r * 2 / 0.82 };
        const t = Math.tan(G.camera.fov * Math.PI / 360);
        G.camera.position.setLength(Math.max(1.12, Math.hypot(H / 2 / (t * run.fit.r), 1)));
      };
      // camera direction: from lat/lon in the globe frame, eased
      const look = (lat, lon, k) => {
        const d = G.camera.position.length();
        const v = AE.llToThree(lat, lon).applyQuaternion(G.group.quaternion).normalize().multiplyScalar(d);
        G.camera.position.lerp(v, k).setLength(d);
        G.camera.lookAt(0, 0, 0);
      };

      // aim at land: a present-day anchor on a big plate, where it was at t
      const LAND = [[5, 20], [45, -95], [62, 100], [-25, 135], [-10, -55], [50, 30], [35, 105], [20, 78], [-80, 30]];
      const ll = r => r ? { lat: r.lat * 0.7, lon: r.lon } : { lat: 10, lon: 0 };
      const landAt = t => {
        for (let k = 0; k < 6; k++) { const a = LAND[Math.floor(rnd() * LAND.length)], r = AE.plates.reconstruct(a[0], a[1], t); if (r) return [r.lat * 0.7, r.lon]; }
        return [0, 0];
      };
      const SHOTS = {
        pangea: () => ({ title: 'Pangea joins and splits', a0: 330, a1: 170, ...ll(AE.plates.reconstruct(5, 20, 250)), dlon: 6, zoom: 1, mode: 0, tint: 0 }),
        assembly: () => ({ title: 'Oceans close, Pangea forms', a0: 480, a1: 300, ...ll(AE.plates.reconstruct(40, -40 + rnd() * 70, 390)), dlon: -6, zoom: 1, mode: 0, tint: 0 }),
        city: () => {
          const c = cityOrder[ci++ % cityOrder.length];
          const p = G.addPin(c[1], c[2], '#ffcf5a', c[0]); pins.push(p);
          const oldest = p.path.length ? p.path[p.path.length - 1][0] : 0;
          return { title: c[0] + ' through time', a0: Math.min(oldest, 400 + rnd() * 140), a1: 0, pin: p, zoom: 1.25, mode: 0, tint: 0, city: c[0] };
        },
        kpg: () => {
          // Chicxulub, on the Yucatan (21.4 N, 89.5 W): a red pin
          const p = G.addPin(21.4, -89.5, '#ff5a4a', 'Chicxulub'); pins.push(p);
          return { title: 'The K–Pg moment', a0: 68, a1: 65.5, lat: 24, lon: -80, dlon: 10, zoom: 1.35, mode: 0, tint: 0 };
        },
        ice: () => {
          const ice = [[445, 'Late Ordovician ice', -70, 10], [300, 'Late Paleozoic ice', -60, 30], [0.021, 'Last Glacial Maximum', 62, -60]][Math.floor(rnd() * 3)];
          return { title: ice[1] + ', then a hothouse', a0: ice[0], a1: ice[0], second: { age: 92, title: 'Cretaceous hothouse' }, lat: ice[2], lon: ice[3], dlon: 8, zoom: 1.05, mode: 0, tint: 0 };
        },
        orbit: () => { const a = [240, 150, 90, 66, 34, 0, 300, 420][Math.floor(rnd() * 8)]; const [la, lo] = landAt(a); return { title: 'Orbit at ' + fmtMa(a), a0: a, a1: a, lat: la, lon: lo, dlon: 14, zoom: 1, mode: 0, tint: 0, glint: true }; },
        map: () => { const m = mapOrder[mi++ % mapOrder.length], a = 60 + rnd() * 400; const [la, lo] = landAt(a); return { title: 'Paleo-elevation in ' + m.name, a0: a + 25, a1: a - 25, lat: la, lon: lo, dlon: 10, zoom: 1, mode: m.mode, tint: m.tint, map: m.name }; },
      };

      const start = () => {
        run.i = (run.i + 1) % kinds.length;
        for (const p of pins.splice(0)) G.removePin(p);
        const s = run.shot = SHOTS[kinds[run.i]]();
        s.kind = kinds[run.i]; s.dur = hold() * (s.kind === 'city' ? 1.25 : 1);
        G.setStyle({ mode: s.mode, tint: s.tint, clouds: 1, hill: 1 }); G.idxDirty = true;
        G.sun.mode = 'view'; G.sun.az = s.glint ? -22 : -34 - rnd() * 10; G.sun.el = 16 + rnd() * 10;
        AE.setAge(s.a0);
        if (s.pin) { const r = s.pin.now; if (r) { s.lat = r.lat; s.lon = r.lon; } }
        frame(s.zoom, 1);
        look(s.lat ?? 0, s.lon ?? 0, 1);
        run.t0 = performance.now();
        plate();
      };
      const fadeTo = (fn) => {
        if (run.going) return; run.going = true;
        const t0 = performance.now(), e0 = G.state.exposure;
        const step = () => {
          if (!run) return;
          const k = (performance.now() - t0) / 700;
          if (k < 1) { G.earthU.uExposure.value = e0 * (1 - k); requestAnimationFrame(step); return; }
          fn();
          const t1 = performance.now();
          const up = () => { if (!run) return; const q = (performance.now() - t1) / 900; G.earthU.uExposure.value = e0 * Math.min(1, q); if (q < 1) requestAnimationFrame(up); else run.going = false; };
          up();
        };
        step();
      };
      const update = () => {
        const s = run.shot; if (!s) return;
        const now = performance.now(), k = Math.min(1, (now - run.t0) / s.dur);
        const e = k * k * (3 - 2 * k);
        let age = s.a0 + (s.a1 - s.a0) * e;
        if (s.second && k > 0.55) {
          if (!s.switched) { s.switched = true; fadeTo(() => { AE.setAge(s.second.age); s.title = s.second.title; plate(); }); }
          age = s.second.age;
        }
        if (!s.second || !s.switched) AE.setAge(age);
        frame(s.zoom, 0.1);
        if (s.pin && s.pin.now) look(s.pin.now.lat, s.pin.now.lon, 0.04);
        else look(s.lat, (s.lon ?? 0) + (s.dlon || 0) * e, 0.05);
        if (k >= 1 && !run.going) fadeTo(start);
      };
      const plate = () => {
        if (!label || !run || !run.shot) return;
        const s = run.shot, t = AE.state.age, u = describeAge(t), cl = climateAt(t), cap = captionAt(t);
        const lines = [cap.title + (s.city ? ' · ' + s.city + (s.pin && s.pin.now ? ` at ${Math.abs(s.pin.now.lat).toFixed(0)}° ${s.pin.now.lat >= 0 ? 'N' : 'S'}` : '') : '')];
        if (s.map) lines.push('Colour: ' + s.map + ', height on a square-root scale');
        else lines.push('Global mean ' + cl.gmst.toFixed(0) + ' °C (estimate) · ' + cl.state.toLowerCase());
        lines.push('PALEOMAP plates and PaleoDEMs, Scotese & Wright 2018 (CC BY 4.0)');
        label({
          title: s.title,
          sub: `${fmtMa(t)} · ${u.epoch[0]}${u.epoch[0].includes(u.period[0]) ? '' : ', ' + u.period[0]} · ${u.era[0]}`,
          params: [
            { sym: 't', name: 'age', value: fmtMa(t), cls: 'm1' },
            { sym: '\\text{P}', name: 'period', value: u.period[0], cls: 'm2' },
            { sym: 'T', name: 'mean surface', value: cl.gmst.toFixed(1) + ' °C est.', cls: 'm5' },
          ],
          lines,
          code: { lang: 'js', name: 'recon.js · pole interpolation', text: CODE },
          anchor: () => { const f = run && run.fit; return f ? { x: innerWidth / 2, y: f.cy, r: f.r } : null; },
        });
      };
      start();
      fadeTo(() => {});
      run.timer = setInterval(update, 33);
      run.plateTimer = setInterval(plate, 1000);
      this.debug = () => run && { kind: run.shot && run.shot.kind, title: run.shot && run.shot.title, age: +AE.state.age.toFixed(2), held: +((performance.now() - run.t0) / 1000).toFixed(1), dur: run.shot && +(run.shot.dur / 1000).toFixed(1), order: run.kinds, fit: run.fit, mode: G.state.mode, exposure: +G.earthU.uExposure.value.toFixed(2) };
      return { canvas: G.renderer.domElement, warmupMs: 1500 };
    },
    exit() {
      if (!run) return;
      clearInterval(run.timer); clearInterval(run.plateTimer);
      for (const p of run.pins) G.removePin(p);
      run.st.remove();
      document.documentElement.classList.remove('sn-saver');
      const s = run.saved;
      G.setStyle(s.style); Object.assign(G.sun, s.sun);
      for (const k of Object.keys(s.layers)) G.setLayer(k, s.layers[k]);
      G.camera.position.copy(s.cam); G.group.rotation.y = s.rot;
      G.controls.enabled = true;
      AE.viewOverride = null; AE.saverOn = false;
      AE.setAge(s.age);
      run = null;
    },
  };
}
