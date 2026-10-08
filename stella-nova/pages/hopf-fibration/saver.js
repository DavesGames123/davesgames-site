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
//    link     a push-in on two linked circles, their discs and the points
//             where each crosses the disc of the other
//    sweep    one torus sweeps from latitude -20 deg toward the north pole:
//             a fat torus that closes onto the unit circle
//    dense    the fibres over a polar cap: a solid torus filled with circles
//    villarceau  one torus with one fibre lit, and a push-in on it
//    clifford the fibres over a great circle near the equator
//    knots    torus knots: the weights step through coprime pairs, and
//             the orbits blend on S3 from one knot type to the next
//    hopftorus  a breathing Hopf torus (flower, seam or two linked tori)
//             on a spinning base
//    solid    the fibres over the vertices of an icosahedron or a
//             dodecahedron, the base spinning about the polar axis
//    morph    presets of one group, one after another; the base points
//             slide from one set to the next
//
//  CHOICE  The user wants visually strong shots with closed loops to look
//  at. The order is a seeded bag of WEIGHTS (knots, Hopf tori and the
//  nested build three times each, sweep once), never the same kind twice
//  in a row. Shots whose point was a fibre through the point at infinity
//  (flow: an isoclinic 4D rotation; tumble: a tumbling base; trace: a
//  loxodrome over the south pole) are gone. No shot puts a base point
//  near the south pole: its fibre would open into a huge circle or a line.
//
//  PLATE  The title is always "Hopf fibration". The sub line is the
//  configuration: the shot, its set-up (cfg), the fibre count, the
//  weights, the motion and the palette. The old descriptive sub line is
//  the first note.
//
//  Each shot also picks a palette and the light pulses from the seeded
//  random source. The old shots run with no flow and no breathing, so
//  their framing stays as authored.
//
//  FRAME  The shell plate covers a band at the top and the base. main.js
//  adds that band (plateBand, lib/saver-clear.js) to its occlusion, so the
//  view offset centres the origin in the clear band. The camera distance is
//  fitDistance(extent) for that band: extent() measures the projected
//  fibres (85th percentile radius), so a 4D rotation that makes the tori
//  grow or shrink keeps them inside the band. cut(kind) forces a shot and
//  debug() reports the shot, its extent and the band, for CDP probes.
//
//  EXIT  enter() keeps a copy of G and the camera; exit() puts them back,
//  so the user gets their own fibres, sliders and view again.
//
//  PLATE  Title and sub per shot, the maths of the shot as TeX (shot.tex,
//  or the Hopf map, the fibre and the rotation), the live values (fibres,
//  weights, rotation, linking number). No code on the plate.
//
//  grep -n targets: "const SHOTS", "function nextShot", "function tick",
//                   "function plate", "window.snSaver"
// ============================================================================
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
      // this shot draws its own reveal: no morph or draw-on
      app.applyPreset('nested', { transition: 'none' }); G.items = zs.map(() => ({ kind: 'cloud', pts: [] })); app.rebuild();
      G.mode = 'along'; G.speed = r.range(0.25, 0.45);
      let shown = -1;
      return {
        title: 'Nested Hopf tori', cfg: n + ' latitudes', sub: 'fibres over ' + n + ' circles of latitude fill ' + n + ' nested tori',
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
      // start at -20 deg: further south the torus grows past the frame
      G.items[0].beta0 = -0.35; G.items[0].z = Math.sin(-0.35); G.sweep = true; G.sweepPhase = 0; G.sweepRate = 2.4 / 9;
      G.mode = r.pick(['still', 'along']); G.speed = 0.25;
      app.rebuild();
      return { title: 'A latitude sweep', sub: 'the torus over one circle of latitude, from 20° south to near the north pole',
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
  // ---- the new shots
  const PQ_TOUR = [[2, 3], [3, 2], [2, 5], [3, 4], [1, 1], [3, 5], [2, 3]];
  Object.assign(SHOTS, {
    knots(r) {
      const id = r.pick(['trefoils', 'seifert', 'cinquefoil', 'trefoils']);
      app.applyPreset(id, { density: COARSE() ? 16 : 24, transition: 'grow' });
      G.mode = 'along'; G.speed = r.range(0.25, 0.45);
      // after the draw-on, step to other weights at even times
      const start = r.int(0, PQ_TOUR.length - 1), seq = [G.pq.slice()];
      for (let k = 0; k < 3; k++) { const pq = PQ_TOUR[(start + k) % PQ_TOUR.length]; if (pq.join() !== seq[seq.length - 1].join()) seq.push(pq); }
      let at = 0;
      return {
        title: 'Torus knots', sub: 'each orbit of the weighted circle action is a (p, q) torus knot, and two orbits link p·q times',
        tex: [TEX.seifert, TEX.linkpq], cam: cam(r, { zoom0: 1.05, zoom1: 0.85 }),
        update(t, dur) {
          const k = Math.min(seq.length - 1, Math.floor((t / dur) * seq.length * 0.999));
          if (k > at) { at = k; app.setWeights(seq[k], G.pq); }
        },
      };
    },
    hopftorus(r) {
      const id = r.pick(['flower', 'seam', 'twin', 'flower']);
      app.applyPreset(id, { density: COARSE() ? 16 : 26, transition: 'grow' });
      G.breathe = true; G.flow = 'spin'; G.flowRate = r.range(0.12, 0.3);
      G.mode = r.pick(['along', 'still']); G.speed = 0.3;
      const name = { flower: 'A flower torus', seam: 'A tennis-ball torus', twin: 'Two linked Hopf tori' }[id];
      return { title: name, sub: 'the fibres over a closed curve on S² fill a flat torus in S³; its area is π times the length of the curve',
        tex: [TEX.torus, TEX.fibre], pct: 0.85, cam: cam(r, { zoom0: 1.05, zoom1: 0.88 }) };
    },
    solid(r) {
      const id = r.pick(['icosa', 'dodeca']);
      app.applyPreset(id, { transition: 'grow' });
      // spin about the polar axis: a tumble swept vertices past the south
      // pole, where their circles open through infinity
      G.flow = 'spin'; G.flowRate = r.range(0.18, 0.32);
      G.mode = 'along'; G.speed = 0.3;
      app.rebuild();
      const n = app.fibres().length;
      return { title: id === 'icosa' ? 'An icosahedron of circles' : 'A dodecahedron of circles',
        sub: `the fibres over the ${n} vertices of a regular solid: ${n * (n - 1) / 2} pairs, each linked once`,
        tex: [TEX.map, TEX.link], pct: 0.8, fog: 1.6, cam: cam(r, { zoom0: 1.05, zoom1: 0.9 }) };
    },
    morph(r) {
      // no 'meridian' or 'random': a great circle through the poles, or a
      // random point near the south pole, gives a fibre through infinity
      const groups = { tori: ['flower', 'seam', 'twin', 'necklace'], hopf: ['nested', 'torus', 'twin'], links: ['icosa', 'dodeca', 'necklace'] };
      const g = r.pick(Object.keys(groups)), list = r.shuffle(groups[g].slice());
      app.applyPreset(list[0], { density: COARSE() ? 16 : 22, seed: r.int(1, 9999), transition: 'grow' });
      G.mode = 'along'; G.speed = 0.3; G.breathe = r.next() < 0.5;
      let at = 0;
      return { title: 'One fibration, many shapes', sub: 'each base point slides on S², and its fibre moves with it: every frame is a true Hopf fibration',
        tex: [TEX.map, TEX.fibre], pct: 0.85, cam: cam(r, { zoom0: 1.05, zoom1: 0.9 }),
        update(t, dur) {
          const k = Math.min(list.length - 1, Math.floor(t / Math.max(2.6, dur / list.length)));
          if (k > at) { at = k; app.applyPreset(list[k], { transition: 'morph', seed: r.int(1, 9999) }); G.mode = 'along'; }
        } };
    },
  });
  const COARSE = () => S.coarse;

  // A robust centre and size of what is on screen. The centre is the mean
  // of sampled points of the projected fibres; the size is the 95th
  // percentile of their distance from it, so a thin tail through infinity
  // does not shrink the subject. Points past 25 units (near
  // infinity) do not count.
  function extent(pct = 0.95) {
    const F = app.fibres(), M = app.rotation(), step = Math.max(1, Math.ceil(F.length / 90)), P = [];
    for (let i = 0; i < F.length; i += step) {
      const C = app.curveAt(i, M, 40);
      for (let k = 0; k < 40; k++) { const x = C[k * 3], y = C[k * 3 + 1], z = C[k * 3 + 2]; if (x * x + y * y + z * z < 625) P.push([x, y, z]); }
    }
    if (!P.length) return { c: [0, 0, 0], r: 2.5 };
    const c = [0, 1, 2].map(j => P.reduce((s, p) => s + p[j], 0) / P.length);
    const d = P.map(p => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])).sort((a, b) => a - b);
    return { c, r: Math.max(0.9, Math.min(6, d[Math.floor(d.length * pct)] * 1.05)) };
  }

  // The bag: the strong closed-loop shots come more often.
  const WEIGHTS = { build: 3, knots: 3, hopftorus: 3, solid: 2, villarceau: 2, link: 2, clifford: 2, dense: 2, morph: 2, sweep: 1 };
  function nextShot() {
    // cut(kind) puts a forced kind first in V.order
    let kind = V.order.shift();
    if (!kind) {
      const fill = () => { for (const [k, w] of Object.entries(WEIGHTS)) if (SHOTS[k]) for (let i = 0; i < w; i++) V.bag.push(k); };
      if (!V.bag) V.bag = [];
      // draw from the bag, never the kind just shown: a bag that holds only
      // that kind gets the next bag added first
      if (!V.bag.some(k => k !== V.lastKind)) fill();
      const pool = V.bag.map((k, i) => i).filter(i => V.bag[i] !== V.lastKind);
      const i = pool[V.rng.int(0, pool.length - 1)];
      kind = V.bag.splice(i, 1)[0];
    }
    V.lastKind = kind;
    G.sweep = false; G.sweepRate = 0.35; G.focus = false; G.sel = []; G.tilt = 0; G.pole = 0; G.a = 0; G.discs = true;
    G.stripes = V.rng.next() < 0.7;
    // the old shots keep their authored framing: no flow, no breathing
    G.flow = 'off'; G.breathe = false; G.pulse = V.rng.next() < 0.6;
    G.palette = V.rng.next() < 0.35 ? 'spectrum' : V.rng.pick(H.PALETTES).id;
    app.applyLook();
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
    if (G.pq[0] !== 1 || G.pq[1] !== 1) params.push({ sym: '(\\mathsf{p},\\mathsf{q})', name: 'weights', value: `(${G.pq[0]}, ${G.pq[1]})` });
    if (G.mode !== 'still') params.push({ sym: 'a', name: H.MODES[G.mode].label.toLowerCase(), value: (G.a % H.TAU).toFixed(2) + ' rad', cls: 'm6' });
    if (sh.kind === 'link' && lk != null) params.push({ sym: '\\mathrm{Lk}', name: 'linking number', value: (lk >= 0 ? '+' : '−') + Math.abs(lk).toFixed(3) });
    const tex = sh.tex ? sh.tex.slice() : [TEX.map, TEX.fibre];
    if (!sh.tex) tex.push(G.mode !== 'still' ? ROT_TEX[G.mode] : TEX.stereo.split(',\\qquad')[0]);
    const pal = (H.PALETTES.find(p => p.id === G.palette) || H.PALETTES[0]).name;
    const motion = G.flow === 'spin' ? 'base spinning' : G.mode === 'still' ? 'still' : H.MODES[G.mode].label.toLowerCase();
    const cfg = [sh.title, sh.cfg, app.fibres().length + ' fibres', G.pq[0] !== 1 || G.pq[1] !== 1 ? `weights (${G.pq[0]}, ${G.pq[1]})` : '', motion, pal].filter(Boolean).join(' · ');
    try {
      V.label({
        title: 'Hopf fibration', sub: cfg, params, tex, rules: RULES,
        eq: ['p(z₀, z₁) = (2 z₀ z̄₁, |z₀|² − |z₁|²)', '(z₀, z₁) = e^{it} (cos(θ/2) e^{iφ}, sin(θ/2))'],
        lines: [sh.sub[0].toUpperCase() + sh.sub.slice(1) + '.', 'Stereographic projection from (0, 0, 0, 1). Colour (' + pal.toLowerCase() + '): hue from longitude, lightness from latitude.'],
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
        label: o.labels !== false && typeof o.label === 'function' ? o.label : null,
        // the state of the page before the tour, for exit()
        keep: { G: structuredClone(G), cam: S.camera.position.clone(), tgt: S.controls.target.clone() } };
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
      document.documentElement.classList.remove('sn-saver');
      S.renderer.toneMappingExposure = 1.05;
      S.controls.maxDistance = 40;
      // put back what the user had: the fibres, density, speed, mode and the
      // camera (the shots change all of them, and the sliders still show
      // the old values)
      const k = V.keep;
      V = null;
      G.focus = false; G.sweepRate = 0.35; G.fogK = 1;
      Object.assign(G, k.G);
      // the saver's flow, morph and draw-on end with it
      app.A.R = H.ident3(); app.A.morph = null; app.A.grow = 1;
      app.setWeights(G.pq, null);
      app.setMode(G.mode); app.setPlaying(G.playing);
      app.applyLook(); app.syncPresetUI(); app.syncControls();
      S.controls.target.copy(k.tgt); S.camera.position.copy(k.cam); S.controls.update();
    },
    // For checks over CDP: the shot on screen.
    debug() { return V && V.shot ? { kind: V.shot.kind, t: +V.shot.t.toFixed(2), dur: +V.shot.dur.toFixed(2), fibres: app.fibres().length, mode: G.mode, ext: +V.ext.toFixed(2), dist: +S.camera.position.distanceTo(S.controls.target).toFixed(2), occ: Object.fromEntries(Object.entries(app.occ).map(([k, v]) => [k, Math.round(v)])), queue: V.order.slice() } : null; },
    cut(kind) { if (V && SHOTS[kind]) { V.order.unshift(kind); V.shot.t = V.shot.dur; } },
  };
}
