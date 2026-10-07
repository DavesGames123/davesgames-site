// ============================================================================
//  ANCIENT EARTH  ·  saver.js  ·  window.snSaver, the screensaver journeys
// ----------------------------------------------------------------------------
//  The shell (lib/screensaver.js) calls snSaver.enter(opts), opts = { calm,
//  seconds, caption, seed, label }. enter hides the GUI and plays curated
//  journeys (JOURNEYS) in a seeded shuffle, a new order each run. Each
//  journey pins named places (a pin rides its plate, its trail is the road
//  it took), runs the age from its start to today and holds on the real
//  present-day Earth (NASA Blue Marble) for the last part. A journey
//  holds 10-16 s (calm makes it longer). A cut fades the globe through
//  black by its exposure, so the recording (the WebGL canvas only) has the
//  fade. While the age runs fast the clouds churn fast (globe.js).
//
//  Camera kinds:  pin   follow the first pin
//                 mid   the midpoint of the first two pins
//                 at    a present-day place riding its plate (lat, lon)
//  Only the pin names show on the label layer (the rest are off).
//  The globe is framed in the clear band of the label plate (plateBand).
//  Each journey sends the plate: title, the age and its period, a note,
//  each pin's latitude then, the climate estimate, and a real extract of
//  recon.js (slerp, the pole interpolation).
//
//  snSaver.debug() returns the director state for CDP checks.
//
//  grep -n targets
//    journey list ..... "const JOURNEYS"
//    age path ......... "function ageAt"
//    framing .......... "const frame"
//    the plate ........ "const plate"
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';
import { describeAge, fmtMa } from './timescale.js';
import { climateAt, captionAt } from './world.js';

const C = ['#ffcf5a', '#7ee0ff', '#ff8fa3', '#a5f28a', '#c9a2ff'];
// { title, note, a0 (Ma), pins [[name, lat, lon]], cam, at, zoom }
export const JOURNEYS = [
  { title: "London's journey", a0: 450, cam: 'pin', zoom: 1.2, pins: [['London', 51.507, -0.128]],
    note: 'London sits on Avalonia, a sliver of crust that left Gondwana near the South Pole and crossed the Iapetus Ocean.' },
  { title: 'New York and Morocco were neighbours', a0: 300, cam: 'mid', zoom: 1.25, pins: [['New York', 40.713, -74.006], ['Casablanca', 33.57, -7.59]],
    note: 'In Pangea the two coasts touched. From about 200 Ma the Central Atlantic opened between them.' },
  { title: "India's sprint north", a0: 160, cam: 'pin', zoom: 1.1, pins: [['Mumbai', 19.07, 72.88], ['Delhi', 28.61, 77.21]],
    note: 'India broke from Gondwana and moved north at up to 15 cm a year, then struck Asia and raised the Himalaya.' },
  { title: 'Australia leaves Antarctica', a0: 130, cam: 'mid', zoom: 1.15, pins: [['Sydney', -33.87, 151.21], ['McMurdo', -77.85, 166.67]],
    note: 'Australia and Antarctica split slowly, then fast after 45 Ma. The open Southern Ocean helped Antarctica freeze.' },
  { title: 'Pangea from above', a0: 320, cam: 'at', at: [10, 15], zoom: 0.95, pins: [],
    note: 'Almost all land in one supercontinent, then the slow break-up into the continents of today.' },
  { title: 'Brazil and West Africa fit together', a0: 170, cam: 'mid', zoom: 1.25, pins: [['Recife', -8.05, -34.9], ['Lagos', 6.5, 3.4]],
    note: 'The bulge of Brazil sat in the Gulf of Guinea. The South Atlantic unzipped from the south from about 130 Ma.' },
  { title: 'Madagascar and India part', a0: 140, cam: 'pin', zoom: 1.15, pins: [['Antananarivo', -18.88, 47.51], ['Mumbai', 19.07, 72.88]],
    note: 'Madagascar stayed near Africa; India split from it about 88 Ma and kept going.' },
  { title: 'Scotland and Newfoundland, one mountain belt', a0: 430, cam: 'mid', zoom: 1.2, pins: [['Edinburgh', 55.95, -3.19], ["St John's", 47.56, -52.71]],
    note: 'The Caledonian and Appalachian mountains formed as one range when Iapetus closed. The Atlantic later cut it in two.' },
  { title: 'Antarctica freezes', a0: 110, cam: 'pin', zoom: 1.05, pins: [['Vostok', -78.46, 106.84]],
    note: 'Forests grew near the Cretaceous pole. As CO2 fell and the ocean gateways opened, an ice sheet grew from about 34 Ma.' },
  { title: "From the dinosaurs' last day", a0: 70, cam: 'pin', zoom: 1.25, pins: [['Chicxulub', 21.4, -89.5]],
    note: 'An asteroid struck the Yucatan 66 million years ago. The same crust then rode on to where it is today.' },
  { title: 'Cape Town and Buenos Aires', a0: 150, cam: 'mid', zoom: 1.2, pins: [['Cape Town', -33.92, 18.42], ['Buenos Aires', -34.6, -58.38]],
    note: 'South Africa and Argentina were one coast of Gondwana before the South Atlantic opened.' },
  { title: 'Siberia meets Europe', a0: 420, cam: 'mid', zoom: 1.1, pins: [['Moscow', 55.76, 37.62], ['Novosibirsk', 55.0, 82.9]],
    note: 'Siberia was its own continent. It collided with Baltica about 300 Ma and the Ural Mountains rose on the seam.' },
  { title: "Cairo's journey", a0: 520, cam: 'pin', zoom: 1.1, pins: [['Cairo', 30.04, 31.24]],
    note: 'North Africa lay deep in the south on the edge of Gondwana, under the ice of the Late Ordovician.' },
  { title: 'The Iapetus Ocean closes', a0: 480, cam: 'mid', zoom: 1.15, pins: [['Boston', 42.36, -71.06], ['Oslo', 59.91, 10.75]],
    note: 'An ocean once lay between New England and Norway. It closed by about 400 Ma; the Atlantic opened near the old seam.' },
  { title: "Tokyo's journey", a0: 240, cam: 'pin', zoom: 1.2, pins: [['Tokyo', 35.68, 139.65], ['Beijing', 39.9, 116.4]],
    note: 'Japan grew on the edge of Asia, then swung away as the Sea of Japan opened about 20 Ma.' },
  { title: 'The last ice age melts', a0: 0.06, cam: 'at', at: [55, -30], zoom: 1.05, pins: [['London', 51.507, -0.128], ['New York', 40.713, -74.006]],
    note: 'Ice sheets over North America and Europe; the sea about 120 m lower; Britain joined to Europe. Then the melt.' },
];

let CODE = `export function slerp(a, b, f) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let s = 1;
  if (d < 0) { d = -d; s = -1; }
  const th = Math.acos(d), st = Math.sin(th);
  const ka = Math.sin((1 - f) * th) / st, kb = s * Math.sin(f * th) / st;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb,
          a[2] * ka + b[2] * kb, a[3] * ka + b[3] * kb];
}`;

// Age along a journey at k in 0..1: eased from a0 to 0 by k = RUN, then
// today. The run is slower near today on a log-like scale, so the last
// tens of millions of years do not flash by.
export const RUN = 0.74;
export function ageAt(a0, k) {
  if (k >= RUN) return 0;
  const u = k / RUN, e = u * u * (3 - 2 * u);
  return Math.max(0, Math.pow(1 - e, 1.6) * a0);
}

export function installSaver(AE) {
  AE.saverOn = false;
  // the real source of slerp in recon.js (the fallback above is a copy)
  fetch(new URL('recon.js', import.meta.url)).then(r => r.text()).then(t => {
    const i = t.indexOf('export function slerp'), j = t.indexOf('\n}\n', i);
    if (i >= 0 && j > i) CODE = t.slice(i, j + 2).trim();
  }).catch(() => {});
  const G = AE.globe, Lb = AE.labels;
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
      st.textContent = '#view{cursor:none}';
      document.head.appendChild(st);
      const saved = { style: { ...G.state }, sun: { ...G.sun }, layers: { ...G.layers }, show: { ...Lb.show }, age: AE.state.age, cam: G.camera.position.clone(), rot: G.group.rotation.y };
      for (const k of ['fossils', 'borders', 'terranes', 'bounds']) G.setLayer(k, false);
      G.setLayer('grid', true); G.setLayer('coast', true);
      for (const k of Object.keys(Lb.show)) Lb.show[k] = false;
      G.controls.enabled = false;
      G.setStyle({ mode: 0, tint: 0, clouds: 1, hill: 1 });
      const pins = [];
      // seeded shuffle of all journeys
      const order = JOURNEYS.map((j, i) => i);
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      run = { order, i: -1, shot: null, t0: 0, going: false, st, saved, pins, timer: 0, plateTimer: 0, band: null, bandAt: -1e9, fit: null };

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
      // camera direction: toward a globe-frame unit vector [x, y, z] (recon
      // axes, z north), eased by k
      const lookV = (v, k) => {
        const d = G.camera.position.length();
        const w = AE.llToThree(0, 0).set(v[1], v[2], v[0]).applyQuaternion(G.group.quaternion).normalize().multiplyScalar(d);
        G.camera.position.lerp(w, k).setLength(d);
        G.camera.lookAt(0, 0, 0);
      };
      // where the camera aims for a journey at the age now
      const aim = s => {
        const P = s.pins.map(p => p.now).filter(Boolean);
        if (s.cam === 'at' || !P.length) {
          const r = AE.plates.reconstruct(s.at ? s.at[0] : s.pinsLL[0][1], s.at ? s.at[1] : s.pinsLL[0][2], AE.state.age);
          return r ? r.v : null;
        }
        if (s.cam === 'mid' && P.length > 1) {
          const m = [0, 1, 2].map(i => P[0].v[i] + P[1].v[i]), n = Math.hypot(...m);
          if (n > 1e-6) return m.map(x => x / n);
        }
        return P[0].v;
      };

      const start = () => {
        run.i = (run.i + 1) % order.length;
        for (const p of pins.splice(0)) G.removePin(p);
        const J = JOURNEYS[order[run.i]];
        const s = run.shot = { ...J, pinsLL: J.pins, pins: [] };
        J.pins.forEach(([n, la, lo], i) => { const p = G.addPin(la, lo, C[i % C.length], n); pins.push(p); s.pins.push(p); });
        // never older than the oldest pin's crust
        for (const p of s.pins) if (p.path.length) s.a0 = Math.min(s.a0, p.path[p.path.length - 1][0]);
        s.dur = (9.5 + 4 * calm + rnd() * 2.5) * 1000;
        G.sun.mode = 'view'; G.sun.az = -30 - rnd() * 14; G.sun.el = 14 + rnd() * 12;
        AE.setAge(s.a0);
        frame(s.zoom, 1);
        const v = aim(s); if (v) lookV(v, 1);
        run.t0 = performance.now();
        plate();
      };
      const fadeTo = fn => {
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
        const k = Math.min(1, (performance.now() - run.t0) / s.dur);
        AE.setAge(ageAt(s.a0, k));
        frame(s.zoom, 0.1);
        const v = aim(s); if (v) lookV(v, 0.05);
        if (k >= 1 && !run.going) fadeTo(start);
      };
      const plate = () => {
        if (!label || !run || !run.shot) return;
        const s = run.shot, t = AE.state.age, u = describeAge(t), cl = climateAt(t), cap = captionAt(t);
        const where = s.pins.filter(p => p.now).map(p => `${p.name} at ${Math.abs(p.now.lat).toFixed(0)}° ${p.now.lat >= 0 ? 'N' : 'S'}`).join(' · ');
        const lines = [s.note];
        lines.push(t === 0 ? 'Today: NASA Blue Marble and Black Marble' : cap.title + (where ? ' · ' + where : ''));
        lines.push('Global mean ' + cl.gmst.toFixed(0) + ' °C (estimate) · ' + cl.state.toLowerCase() + ' · PALEOMAP, Scotese & Wright 2018 (CC BY 4.0)');
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
      this.debug = () => run && { journey: run.shot && run.shot.title, age: +AE.state.age.toFixed(3), held: +((performance.now() - run.t0) / 1000).toFixed(1), dur: run.shot && +(run.shot.dur / 1000).toFixed(1),
        pins: run.shot && run.shot.pins.map(p => p.name + (p.now ? ` ${p.now.lat.toFixed(1)},${p.now.lon.toFixed(1)}` : ' gone')), order: run.order.map(i => JOURNEYS[i].title), fit: run.fit, exposure: +G.earthU.uExposure.value.toFixed(2), bakes: { ...G.stats } };
      return { canvas: G.renderer.domElement, warmupMs: 1500 };
    },
    exit() {
      if (!run) return;
      clearInterval(run.timer); clearInterval(run.plateTimer);
      for (const p of run.pins) G.removePin(p);
      run.st.remove();
      document.documentElement.classList.remove('sn-saver');
      const s = run.saved;
      G.setStyle(s.style); Object.assign(G.sun, s.sun); Object.assign(Lb.show, s.show);
      for (const k of Object.keys(s.layers)) G.setLayer(k, s.layers[k]);
      G.camera.position.copy(s.cam); G.group.rotation.y = s.rot;
      G.controls.enabled = true;
      AE.viewOverride = null; AE.saverOn = false;
      AE.setAge(s.age);
      run = null;
    },
  };
}
