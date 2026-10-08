// ============================================================================
//  HOPF FIBRATION  ·  saver.js — the screensaver tour (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell (lib/screensaver.js) calls snSaver.enter(opts) with
//  { calm, seconds, caption, seed, label }. The tour plays authored shots
//  in a seeded shuffle, so each run differs. A shot lasts 5 to 12 s (calm 1
//  gives the long end), with a short fade through black between shots
//  (the tone-map exposure goes to 0 and back).
//
//  SHOTS
//    build    nested tori grow in, fibre by fibre, latitude by latitude
//    flow     a fibre-to-fibre 4D rotation: circles pass through infinity
//    link     a push-in on two linked circles, their discs and the points
//             where each crosses the disc of the other
//    sweep    one torus sweeps from the south pole to the north pole: a line
//             opens into a fat torus and closes onto the unit circle
//    dense    the fibres over a polar cap: a solid torus filled with circles
//    trace    a point moves on S2 and its fibre moves with it
//    villarceau  one torus with one fibre lit, and a push-in on it
//    clifford the fibres over a great circle near the equator
//
//  FRAME  The shell plate covers a band at the top and the base. main.js
//  adds that band (plateBand, lib/saver-clear.js) to its occlusion, so the
//  view offset centres the origin in the clear band. The camera distance is
//  fitDistance(extent) for that band: extent() measures the projected
//  fibres (85th percentile radius), so a 4D rotation that makes the tori
//  grow or shrink keeps them inside the band. cut(kind) forces a shot and
//  debug() reports the shot, its extent and the band, for CDP probes.
//
//  PLATE  Title and sub per shot, the Hopf map and the fibre as TeX, the
//  live values (fibres, rotation, linking number), and the shader extract
//  FIBRE_GLSL from scene.js.
//
//  grep -n targets: "const SHOTS", "function nextShot", "function tick",
//                   "function plate", "window.snSaver"
// ============================================================================
import { FIBRE_GLSL } from './scene.js';
import { TEX, ROT_TEX, RULES } from './equations.js';

const FADE = 0.6;
const ease = t => { t = Math.max(0, Math.min(1, t)); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };

export function installSaver(app) {
  const { G, S, H } = app;
  let V = null;   // saver state

  // Each shot: setup(r) returns { title, sub, cam, push?, update?(t, dur) }.
  // cam = { az, spin, el0, el1, zoom0, zoom1 }: the azimuth turns by spin
  // rad/s, the elevation eases from el0 to el1 and the zoom from zoom0 to
  // zoom1. Zoom 1 fits the measured extent of the fibres (function extent)
  // in the clear band.
  const cam = (r, o = {}) => Object.assign({ az: r.range(0, H.TAU), spin: r.pick([-1, 1]) * r.range(0.04, 0.09),
    el0: r.range(0.1, 0.45), el1: r.range(0.35, 0.8), zoom0: 1.05, zoom1: 0.92 }, o);
  const SHOTS = {
    build(r) {
      // the tori grow in: each latitude adds its fibres one by one, around
      const n = r.int(3, 5), zs = Array.from({ length: n }, (_, i) => 0.84 - 1.25 * i / (n - 1) + r.range(-0.04, 0.04));
      const span = r.next() < 0.6 ? H.TAU * r.range(0.72, 0.82) : H.TAU, ph0 = r.range(0, H.TAU);
      const counts = zs.map((_, k) => Math.round((COARSE() ? 10 : 16) + (COARSE() ? 4 : 7) * k));
      app.applyPreset('nested'); G.items = zs.map(() => ({ kind: 'cloud', pts: [] })); app.rebuild();
      G.mode = 'along'; G.speed = r.range(0.25, 0.45);
      let shown = -1;
      return {
        title: 'Nested Hopf tori', sub: 'fibres over ' + n + ' circles of latitude fill ' + n + ' nested tori',
        cam: cam(r, { zoom0: 1.04, zoom1: 0.96 }),
        // the largest torus: its outer radius is cos/(1 - sin) of the half-angle
        fixedExtent: Math.max(...zs.map(z => Math.sqrt((1 + z) / 2) / (1 - Math.sqrt((1 - z) / 2)))) * 0.95,
        update(t, dur) {
          const total = counts.reduce((a, b) => a + b, 0), want = Math.min(total, Math.floor(total * Math.min(1, t / (dur * 0.7))));
          if (want === shown) return;
          shown = want;
          let left = want;
          zs.forEach((z, k) => {
            const m = Math.min(counts[k], left); left -= m;
            const rr = Math.sqrt(1 - z * z), step = span >= H.TAU - 1e-9 ? span / counts[k] : span / (counts[k] - 1);
            G.items[k].pts = Array.from({ length: m }, (_, i) => [rr * Math.cos(ph0 + i * step), rr * Math.sin(ph0 + i * step), z]);
          });
          app.rebuild();
        },
      };
    },
    flow(r) {
      const src = r.pick(['random', 'nested', 'torus', 'random']);
      app.applyPreset(src, { seed: r.int(1, 9999), density: COARSE() ? 14 : 22 });
      G.sel = [];
      G.mode = 'isoclinic'; G.speed = r.range(0.45, 0.7); G.tilt = r.range(0, Math.PI); G.a = r.range(0, H.TAU);
      app.rebuild();
      return { title: 'Through infinity', sub: 'a 4D rotation of S³ carries each fibre onto another fibre, through the point at infinity',
        // the tails through infinity are the point of this shot: a lower
        // percentile keeps them from pulling the camera back, and a
        // denser fog fades them
        pct: 0.8, fog: 2.2, cam: cam(r, { zoom0: 1.1, zoom1: 0.95 }) };
    },
    link(r) {
      app.applyPreset('linked');
      // both base points north of the equator keep both circles a similar,
      // moderate size (a point near the south pole gives a huge circle)
      const ph = r.range(0, H.TAU);
      G.items[0].b = H.baseFromAngles(r.range(0.45, 0.9), ph);
      G.items[1].b = H.baseFromAngles(r.range(1.1, 1.5), ph + r.range(1.8, 4.4));
      G.sel = [0, 1]; G.discs = true;
      G.mode = r.pick(['along', 'still', 'along']); G.speed = 0.35;
      app.rebuild();
      return { title: 'Two fibres, linked once', sub: 'each circle passes once through the disc of the other',
        push: true, cam: cam(r, { el0: r.range(0.3, 0.7), el1: r.range(0.1, 0.5), zoom0: 1.0, zoom1: 0.5 }) };
    },
    villarceau(r) {
      app.applyPreset('torus', { density: COARSE() ? 22 : 34 });
      G.items[0].z = r.range(-0.35, 0.35);
      app.rebuild();
      const k = r.int(0, app.fibres().length - 1); G.sel = [k]; G.discs = false; G.focus = true;
      G.mode = 'along'; G.speed = 0.3;
      app.rebuild();
      return { title: 'A Villarceau circle', sub: 'each fibre on a Hopf torus is a circle that winds once around each way',
        cam: cam(r, { el0: r.range(0.6, 1.0), el1: r.range(0.05, 0.3), zoom0: 1.05, zoom1: 0.7 }) };
    },
    sweep(r) {
      app.applyPreset('torus', { density: COARSE() ? 18 : 28 });
      G.items[0].beta0 = -0.75; G.items[0].z = Math.sin(-0.75); G.sweep = true; G.sweepPhase = 0; G.sweepRate = 2.4 / 9;
      G.mode = r.pick(['still', 'along']); G.speed = 0.25;
      app.rebuild();
      return { title: 'A latitude sweep', sub: 'the torus over one circle of latitude, from the southern half to near the north pole',
        cam: cam(r, { zoom0: 1.0, zoom1: 0.95 }), fixedExtent: 2.7 };
    },
    dense(r) {
      // the fibres over a polar cap fill a solid torus that stays bounded
      const zc = r.range(-0.35, 0.05), all = H.fibonacciSphere(COARSE() ? 360 : r.int(900, 1200));
      app.applyPreset('dense'); G.items = [{ kind: 'cloud', pts: all.filter(b => b[2] > zc) }];
      G.mode = 'along'; G.speed = r.range(0.2, 0.35);
      app.rebuild();
      return { title: 'Filling space with circles', sub: 'the fibres over a polar cap of S² fill a solid torus; over all of S², all of space',
        cam: cam(r, { zoom0: 1.0, zoom1: 0.8 }) };
    },
    trace(r) {
      app.applyPreset('trace');
      G.trace.u = r.range(0, 1);
      for (let i = 0; i < 24; i++) G.trace.trail.push(H.loxodrome(G.trace.u - (24 - i) * 0.007));
      G.mode = 'still';
      app.rebuild();
      return { title: 'The fibre over a moving point', sub: 'a point runs from pole to pole on S², and its circle follows',
        cam: cam(r, { zoom0: 1.0, zoom1: 0.9 }) };
    },
    clifford(r) {
      // a great circle near the equator: its fibres make a Clifford torus
      // that stays clear of infinity (no fibre over the south pole)
      const tilt = r.range(0, 0.6), az = r.range(0, H.TAU);
      app.applyPreset('meridian', { density: COARSE() ? 18 : 30 });
      G.items = [{ kind: 'great', axis: [Math.sin(tilt) * Math.cos(az), Math.sin(tilt) * Math.sin(az), Math.cos(tilt)], n: COARSE() ? 22 : 36 }];
      G.mode = 'along'; G.speed = r.range(0.25, 0.4);
      app.rebuild();
      return { title: 'A Clifford torus', sub: 'the fibres over a great circle of S² lie on a flat torus in S³',
        cam: cam(r, { el0: r.range(0.5, 0.9), el1: r.range(0.0, 0.3), zoom0: 1.05, zoom1: 0.8 }) };
    },
  };
  const COARSE = () => S.coarse;

  // A robust centre and size of what is on screen. The centre is the mean
  // of sampled points of the projected fibres; the size is the 95th
  // percentile of their distance from it, so a thin tail through infinity
  // does not shrink the subject. Points past 25 units (near
  // infinity) do not count.
  function extent(pct = 0.95) {
    const F = app.fibres(), M = app.rotation(), step = Math.max(1, Math.ceil(F.length / 90)), P = [];
    for (let i = 0; i < F.length; i += step) {
      const C = H.fibreCurve(F[i].b, M, 40);
      for (let k = 0; k < 40; k++) { const x = C[k * 3], y = C[k * 3 + 1], z = C[k * 3 + 2]; if (x * x + y * y + z * z < 625) P.push([x, y, z]); }
    }
    if (!P.length) return { c: [0, 0, 0], r: 2.5 };
    const c = [0, 1, 2].map(j => P.reduce((s, p) => s + p[j], 0) / P.length);
    const d = P.map(p => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])).sort((a, b) => a - b);
    return { c, r: Math.max(0.9, Math.min(6, d[Math.floor(d.length * pct)] * 1.05)) };
  }

  function nextShot() {
    if (!V.order.length) V.order = V.rng.shuffle(Object.keys(SHOTS).filter(k => k !== V.lastKind));
    const kind = V.order.shift();
    V.lastKind = kind;
    G.sweep = false; G.sweepRate = 0.35; G.focus = false; G.sel = []; G.tilt = 0; G.pole = 0; G.a = 0; G.discs = true;
    G.stripes = V.rng.next() < 0.7;
    const shot = SHOTS[kind](V.rng);
    G.playing = true; G.orbit = false;
    shot.kind = kind;
    shot.dur = Math.max(5, Math.min(12, 5 + 7 * V.calm + V.rng.range(-1.2, 1.2)));
    shot.t = 0;
    if (kind === 'sweep') G.sweepRate = 2.0 / shot.dur;
    G.fogK = shot.fog || 1;
    S.controls.target.set(0, 0, 0);
    V.shot = shot;
    app.rebuild();
    const e0 = extent(shot.pct);
    V.ext = shot.fixedExtent || e0.r; V.extAt = 0; V.ctrGoal = null;
    V.ctr = new S.THREE.Vector3(...(shot.fixedExtent ? [0, 0, 0] : e0.c));
    plate();
  }

  const _t = new S.THREE.Vector3();
  function tick(dt) {
    if (!V || !V.shot) return;
    const sh = V.shot; sh.t += dt;
    if (sh.update) sh.update(sh.t, sh.dur);
    // fade in, fade out
    const f = Math.min(1, sh.t / FADE, (sh.dur - sh.t) / FADE);
    S.renderer.toneMappingExposure = 1.05 * ease(Math.max(0, f));
    // the size of the subject, measured 3 times a second, eased
    V.extAt += dt;
    if (!sh.fixedExtent && !sh.push && V.extAt > 0.33) {
      V.extAt = 0; const e = extent(sh.pct);
      V.ext += (e.r - V.ext) * 0.35; V.ctrGoal = e.c;
    }
    if (V.ctrGoal && !sh.push) { _t.set(...V.ctrGoal); V.ctr.lerp(_t, Math.min(1, dt * 1.5)); }
    if (!sh.push) S.controls.target.copy(V.ctr);
    const { w, h } = app.size(), c = sh.cam, u = ease(sh.t / sh.dur);
    const az = c.az + c.spin * sh.t, el = c.el0 + (c.el1 - c.el0) * u;
    const d = app.fitDistance(V.ext, w, h) * (c.zoom0 + (c.zoom1 - c.zoom0) * u);
    if (sh.push) {
      // push in toward the midpoint of the two pierce points
      const a = S.dots[0], b = S.dots[1];
      if (a.visible && b.visible) { _t.copy(a.position).add(b.position).multiplyScalar(0.5 * u); S.controls.target.copy(_t); }
    }
    const tg = S.controls.target;
    S.camera.position.set(tg.x + d * Math.cos(el) * Math.cos(az), tg.y + d * Math.sin(el), tg.z + d * Math.cos(el) * Math.sin(az));
    S.camera.lookAt(tg);
    if (sh.t >= sh.dur) nextShot();
    V.plateT += dt;
    if (V.plateT > 1) { V.plateT = 0; plate(); }
  }

  function plate() {
    if (!V || !V.label || !V.shot) return;
    const sh = V.shot, lk = app.linking();
    const params = [{ sym: 'N', name: 'fibres', value: String(app.fibres().length) }];
    if (G.mode !== 'still') params.push({ sym: 'a', name: H.MODES[G.mode].label.toLowerCase(), value: (G.a % H.TAU).toFixed(2) + ' rad', cls: 'm6' });
    if (sh.kind === 'link' && lk != null) params.push({ sym: '\\mathrm{Lk}', name: 'linking number', value: (lk >= 0 ? '+' : '−') + Math.abs(lk).toFixed(3) });
    const tex = [TEX.map, TEX.fibre];
    if (G.mode !== 'still') tex.push(ROT_TEX[G.mode]);
    else tex.push(TEX.stereo.split(',\\qquad')[0]);
    try {
      V.label({
        title: sh.title, sub: sh.sub, params, tex, rules: RULES,
        eq: ['p(z₀, z₁) = (2 z₀ z̄₁, |z₀|² − |z₁|²)', '(z₀, z₁) = e^{it} (cos(θ/2) e^{iφ}, sin(θ/2))'],
        lines: ['Stereographic projection from (0, 0, 0, 1). Colour: hue from longitude, lightness from latitude.'],
        code: { lang: 'glsl', name: 'scene.js · hopfFibre', text: FIBRE_GLSL.split('\n').slice(0, 10).join('\n') },
        anchor: () => {
          const { w, h } = app.size(), o = app.occ;
          const cw = w - o.l - o.r, ch = h - o.t - o.b;
          return { x: o.l + cw / 2, y: o.t + ch / 2, w: Math.min(cw, ch) * 0.8, h: Math.min(cw, ch) * 0.8, lead: false };
        },
      });
    } catch (e) { /* the shell is gone */ }
  }

  window.snSaver = {
    enter(o = {}) {
      if (V) this.exit();
      const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
      document.documentElement.classList.add('sn-saver');
      V = { calm, rng: H.makeRng((o.seed >>> 0) || ((Date.now() & 0xffffff) + 1)), order: [], lastKind: null, shot: null, plateT: 0,
        label: o.labels !== false && typeof o.label === 'function' ? o.label : null };
      import('../../lib/saver-clear.js').then(m => {
        if (!V) return;
        let band = null, at = -1e9;
        app.setBand(h => {
          const now = performance.now();
          // the plate fades out and in between shots, and plateBand gives
          // null then: keep the last band, so the camera does not jump
          if (now - at > 250) { at = now; band = m.plateBand(h) || band; }
          if (!band) return null;
          let t = band.t, b = band.b; const k = (t + b) / (0.8 * h);
          if (k > 1) { t /= k; b /= k; }
          return { t, b };
        });
      }).catch(() => { /* no shell: the full frame */ });
      app.addHook(tick);
      S.controls.maxDistance = 400;
      nextShot();
      return { canvas: S.renderer.domElement, warmupMs: 900 };
    },
    exit() {
      if (!V) return;
      try { V.label && V.label(null); } catch (e) { /* the shell is gone */ }
      app.removeHook(tick);
      app.setBand(null);
      V = null;
      document.documentElement.classList.remove('sn-saver');
      S.renderer.toneMappingExposure = 1.05;
      S.controls.maxDistance = 40;
      G.sweep = false; G.sweepRate = 0.35; G.focus = false; G.orbit = true; G.tilt = 0; G.a = 0; G.pole = 0; G.stripes = true; G.discs = true; G.fogK = 1;
      app.setMode('along'); app.setPlaying(true);
      app.applyPreset('nested');
    },
    // For checks over CDP: the shot on screen.
    debug() { return V && V.shot ? { kind: V.shot.kind, t: +V.shot.t.toFixed(2), dur: +V.shot.dur.toFixed(2), fibres: app.fibres().length, mode: G.mode, ext: +V.ext.toFixed(2), dist: +S.camera.position.distanceTo(S.controls.target).toFixed(2), occ: Object.fromEntries(Object.entries(app.occ).map(([k, v]) => [k, Math.round(v)])), queue: V.order.slice() } : null; },
    cut(kind) { if (V && SHOTS[kind]) { V.order.unshift(kind); V.shot.t = V.shot.dur; } },
  };
}
