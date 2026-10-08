// ============================================================================
//  MAP PROJECTIONS  ·  saver.js — window.snSaver, the screensaver tour
// ----------------------------------------------------------------------------
//  Protocol: lib/screensaver.js. enter(opts) hides the page GUI, frames the
//  map in the clear band of the shell's label plate (plateBand from
//  lib/saver-clear.js) and plays a seeded shuffle of five shot kinds, so
//  each run differs:
//    morph   three world projections in a row, each a 2.2 s morph (both
//            maps clip the geometry, edges open smoothly) and a short hold
//    unroll  an orthographic globe turns, settles on the equator and
//            unrolls into a world map
//    tissot  Tissot circles grow on Mercator from the equator out, while
//            the globe turns slowly under the map
//    slide   Greenland slides from home to the equator on Mercator and
//            shrinks to its true size; its home outline stays
//    spin    an oblique map whose centre travels slowly round the globe
//  Each shot lasts 7-12 s (longer when calm is high) and ends in a 0.45 s
//  fade to the page colour; the next fades in. Every frame is drawn as
//  vectors into the one map canvas (#map, which stays in the document), so
//  lines are sharp at any device pixel ratio and the recording holds the
//  overlays.
//  The plate names the projection, its property and family, and gives the
//  formula as code: { lang: 'js', name, text }.
//
//  Probes for CDP: snSaver.debug() (shot, key, phase, frame times),
//  snSaver.cut(kind) to force a shot.
//
//  GREP MAP
//    grep -n 'export function installSaver'   the hook
//    grep -n 'const SHOTS'                    the shot kinds
//    grep -n 'function frameMap'              draw one frame of a shot
// ============================================================================
import { BY_KEY, D, makeMap } from './proj.js';
import { pointAt } from './geo.js';
import * as T from './tools.js';
import { CARDS, PROPS, FAMILY } from './cards.js';

const WORLD = ['mercator', 'equirectangular', 'mollweide', 'hammer', 'winkel-tripel', 'robinson', 'equal-earth', 'natural-earth', 'eckert-iv', 'sinusoidal', 'goode', 'lambert-cylindrical', 'gall-peters', 'aitoff'];
const UNROLL_TO = ['equirectangular', 'mollweide', 'winkel-tripel', 'equal-earth', 'natural-earth', 'hammer'];
const SPIN = ['orthographic', 'lambert-azimuthal', 'azimuthal-equidistant', 'stereographic', 'winkel-tripel', 'mollweide', 'equal-earth', 'hammer'];
const TISSOT_ON = ['mercator', 'mercator', 'mercator', 'mercator', 'equirectangular', 'sinusoidal', 'stereographic'];
const SHOTS = ['morph', 'unroll', 'tissot', 'slide', 'spin'];

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

export function installSaver(api) {
  let R = null;   // the running tour

  function label(key, extra = {}) {
    if (!R) return;
    const def = BY_KEY[key], c = CARDS[key], P = PROPS[def.prop];
    R.label(Object.assign({
      title: def.name,
      sub: `${P.name} · ${FAMILY[def.family].name.toLowerCase()} · ${c.who}`,
      lines: [extra.line || `${P.name}: ${P.note}.`],
      code: { lang: 'js', name: `${key}.js`, text: c.code },
    }, extra.plate || {}));
  }
  // The clear band between the plate's top and bottom text. While the
  // plate fades to a new title, plateBand() can return null or a short
  // band for a moment, so the last good band is kept, and the box eases
  // toward a new band (no jump when a sub line wraps to two lines).
  function band(now) {
    if (R.bandFn && now - R.bandAt > 250) {
      R.bandAt = now;
      const b = R.bandFn(innerHeight);
      if (b && (b.t > 0 || b.b > 0)) R.band = b;
    }
    const b = R.band, H = innerHeight, W = innerWidth;
    let t = b ? b.t : 0, bt = b ? b.b : 0;
    const k = (t + bt) / (0.62 * H); if (k > 1) { t /= k; bt /= k; }   // keep at least 38% of the height
    const goal = { x: W * 0.04, y: t, w: W * 0.92, h: Math.max(80, H - t - bt) };
    const cur = R.box;
    if (!cur || R.boxW !== W || R.boxH !== H) { R.box = goal; R.boxW = W; R.boxH = H; }
    else {
      const dt = Math.min(0.1, (now - (R.boxAt || now)) / 1000), e = 1 - Math.exp(-dt * 3);
      for (const q of ['x', 'y', 'w', 'h']) { cur[q] += (goal[q] - cur[q]) * e; if (Math.abs(goal[q] - cur[q]) < 0.05) cur[q] = goal[q]; }
    }
    R.boxAt = now;
    return { x: R.box.x, y: R.box.y, w: R.box.w, h: R.box.h, align: 'centre' };
  }
  // One shot = a plan with a duration and a frame(u) function, u in 0..1.
  function plan(kind) {
    const rnd = R.rnd, calm = R.calm, slow = 1 + 0.35 * calm;
    const pick = list => list[Math.floor(rnd() * list.length)];
    const lon0 = Math.round((rnd() * 360 - 180) / 10) * 10;
    if (kind === 'morph') {
      const seq = [];
      while (seq.length < 4) { const k = pick(WORLD); if (k !== seq[seq.length - 1] && !seq.includes(k)) seq.push(k); }
      const seg = 3.4 * slow, dur = seg * 3 + 1.2;
      const drift = (rnd() < 0.5 ? -1 : 1) * 4;   // deg per second of slow turning
      const stAt = (k, t) => ({ key: k, lon: lon0 + drift * t, lat: 0, roll: 0, aspect: 'normal' });
      let shown = null;
      return {
        dur, key: seq[0],
        frame(u) {
          const t = u * dur, i = Math.min(2, Math.floor(t / seg)), v = (t - i * seg) / seg;
          const m = Math.min(1, v / 0.65), e = ease(m);     // 65% morph, 35% hold
          const a = stAt(seq[i], t), b = stAt(seq[i + 1], t);
          const k = e < 0.5 ? seq[i] : seq[i + 1]; if (k !== shown) { shown = k; label(k); R.key = k; }
          if (m >= 1) { api.view.setState(b); return; }
          const mA = makeMap(a.key, a), mB = makeMap(b.key, b);
          api.view.setMorph(a, b, e, api.morphRects(mA, ease(Math.min(1, m * 1.15))), api.morphRects(mB, 1 - ease(Math.max(0, m * 1.15 - 0.15))));
        },
      };
    }
    if (kind === 'unroll') {
      const to = pick(UNROLL_TO), lat0 = 20 + rnd() * 25, dur = 10 * slow, spin = 14 + rnd() * 8;
      let phase = '';
      return {
        dur, key: 'orthographic',
        frame(u) {
          const t = u * dur, p1 = 0.42;
          if (u < p1) {
            if (phase !== 'globe') { phase = 'globe'; label('orthographic', { line: 'The globe turns under an orthographic view, the Earth as seen from far away.' }); R.key = 'orthographic'; }
            const v = u / p1;
            api.view.setState({ key: 'orthographic', aspect: 'oblique', lon: lon0 + spin * t, lat: lat0 * (1 - smooth(v)), roll: 0 });
          } else {
            if (phase !== 'unroll') { phase = 'unroll'; label(to, { line: 'The same globe unrolled: every point keeps its place, the shape of the sheet changes.' }); R.key = to; }
            const v = Math.min(1, (u - p1) / 0.45), e = ease(v), lonE = lon0 + spin * p1 * dur;
            const a = { key: 'orthographic', aspect: 'oblique', lon: lonE, lat: 0, roll: 0 }, b = { key: to, aspect: 'normal', lon: lonE, lat: 0, roll: 0 };
            if (v >= 1) { api.view.setState(b); return; }
            const mA = makeMap(a.key, a), mB = makeMap(b.key, b);
            api.view.setMorph(a, b, e, api.morphRects(mA, ease(Math.min(1, v * 1.2))), api.morphRects(mB, 1 - ease(Math.max(0, v * 1.2 - 0.2))));
          }
        },
      };
    }
    if (kind === 'tissot') {
      const key = pick(TISSOT_ON), dur = 9 * slow, step = rnd() < 0.5 ? 30 : 20, drift = (rnd() < 0.5 ? -1 : 1) * 3;
      const st = Object.assign({ key, aspect: 'normal', lon: lon0, lat: 0, roll: 0 }, key === 'stereographic' ? { aspect: 'normal', lat: 90 } : {});
      label(key, { line: 'Tissot circles: the same size on the ground everywhere. Their size on the map shows the area scale.' });
      return {
        dur, key, tissot: { step, radius: step === 30 ? 6.5 : 4.4 },
        crop: key === 'mercator' ? [-64, 74] : null,
        frame(u, box) { show(Object.assign({}, st, { lon: lon0 + drift * u * dur }), this.crop, box); },
        grow: (u, la) => smooth((u * 1.6 - 0.08) * 1.6 - Math.abs(la) / 90 * 1.1),
      };
    }
    if (kind === 'slide') {
      const c = api.country('Greenland'), dur = 10 * slow;
      const to = pick([[20, 3], [-55, -2], [100, 0], [25, -5], [-15, 8]]);
      const st = { key: 'mercator', aspect: 'normal', lon: Math.round((to[0] + c.lx) / 2 / 10) * 10, lat: 0, roll: 0 };
      const area = T.countryArea(c);
      label('mercator', { line: `Greenland: ${(area / 1e6).toFixed(2)} million km². On Mercator it looks as big as Africa (30.4 million km²).` });
      return {
        dur, key: 'mercator', country: c, crop: [-38, 83],
        frame(u, box) { show(st, this.crop, box); },
        target: u => { const e = ease(smooth((u - 0.18) / 0.62)); return [lerp(c.lx, to[0], e), lerp(c.ly, to[1], e)]; },
      };
    }
    // spin
    const key = pick(SPIN), dur = 9 * slow, rate = (rnd() < 0.5 ? -1 : 1) * (10 + rnd() * 8), latA = 20 + rnd() * 35, lat0 = rnd() * 40 - 10;
    label(key, { line: 'An oblique aspect: the same formula, with the globe turned underneath.' });
    return {
      dur, key,
      frame(u) { const t = u * dur; api.view.setState({ key, aspect: 'oblique', lon: lon0 + rate * t, lat: lat0 + latA * Math.sin(t * 0.35), roll: key.includes('winkel') || key === 'mollweide' || key.includes('equal') || key === 'hammer' ? 15 * Math.sin(t * 0.2) : 0 }); },
    };
  }

  // A map state in the box: fitted, or with crop [lat0, lat1] (Mercator
  // only) the band of latitudes fills the box height and is clipped to it.
  function show(st, crop, box) {
    if (!crop) { api.view.setState(st); return; }
    const y0 = Math.asinh(Math.tan(crop[0] * D)), y1 = Math.asinh(Math.tan(crop[1] * D));
    const k = Math.min(box.h / (y1 - y0), box.w / (2 * Math.PI));
    api.view.setStateScreen(st, { k, x: box.x + box.w / 2, y: box.y + box.h / 2 + k * (y0 + y1) / 2 });
  }
  function frameMap(now) {
    if (!R) return;
    const P = R.shot, u = Math.min(1, (now - R.t0) / (P.dur * 1000));
    const v = api.view;
    const box = band(now);
    v.setBox(box);
    const t0 = performance.now();
    P.frame(u, box);
    const fade = Math.min(1, smooth((now - R.t0) / 450), smooth((P.dur * 1000 - (now - R.t0)) / 450));
    const clipRect = P.crop ? [box.x, box.y, box.w, box.h] : null;
    v.draw(P.kind === 'slide' ? 'full' : 'fast', { alpha: fade, clipRect });   // the slide map holds still: its full geometry stays cached
    const g = v.g; g.save(); g.globalAlpha = fade;
    if (clipRect) { g.beginPath(); g.rect(...clipRect); g.clip(); }
    if (P.tissot) T.drawTissot(g, v.frames, { step: P.tissot.step, radius: P.tissot.radius, clip: v.edgePath, grow: (i, lo, la) => P.grow(u, la), lineWidth: 1.3, latMax: P.crop ? 60 : 75 });
    if (P.country) {
      const tgt = P.target(u);
      T.drawCountry(g, v.frames, { rings: P.country.rings, lines: P.country.lines }, { fill: 'rgba(255,255,255,0.07)', stroke: 'rgba(255,255,255,0.5)', lineWidth: 1 });
      T.drawCountry(g, v.frames, T.moveRings(P.country, tgt), { lineWidth: 2, fill: 'rgba(98,196,255,0.55)' });
      // name it once it has arrived: the shrunk shape is small
      const la = smooth((u - 0.78) / 0.08);
      if (la > 0) { const p = pointAt(v.frames, tgt[0] * D, tgt[1] * D); if (p) { g.globalAlpha = fade * la; T.label(g, 'Greenland, true size', p[0] + 16, p[1] - 4, '#cfe9ff'); } }
    }
    g.restore();
    const ms = performance.now() - t0;
    R.times.push(ms); if (R.times.length > 240) R.times.shift();
    const st = R.stats[P.kind] || (R.stats[P.kind] = { n: 0, sum: 0, max: 0 });
    st.n++; st.sum += ms; st.max = Math.max(st.max, ms);
    if (u >= 1) next();
    R.raf = requestAnimationFrame(frameMap);
  }
  function next(force) {
    if (!R) return;
    let kind = force;
    if (!kind) { if (R.i >= R.order.length) { R.order = shuffle(SHOTS.slice(), R.rnd); if (R.order[0] === R.last) R.order.push(R.order.shift()); R.i = 0; } kind = R.order[R.i++]; }
    R.last = kind;
    R.shot = plan(kind); R.shot.kind = kind; R.key = R.shot.key; R.t0 = performance.now(); R.count++;
  }
  function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  window.snSaver = {
    enter(o = {}) {
      if (R) this.exit();
      const seed = (o.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0);
      const rnd = mulberry(seed);
      document.documentElement.classList.add('sn-saver');
      document.body.classList.remove('sheet-open');
      api.setSaver(true);
      api.resize();
      R = { rnd, seed, calm: Math.max(0, Math.min(1, o.calm ?? 0.7)), label: typeof o.label === 'function' ? o.label : () => {}, order: shuffle(SHOTS.slice(), rnd), i: 0, last: null,
        band: null, bandFn: null, bandAt: 0, times: [], stats: {}, count: 0, key: '', raf: 0, prevZoom: api.view.zoom };
      api.view.zoom = 1;
      import('../../lib/saver-clear.js').then(m => { if (R) R.bandFn = m.plateBand; }).catch(() => {});
      next();
      R.raf = requestAnimationFrame(frameMap);
      return { canvas: api.view.c, warmupMs: 700 };
    },
    exit() {
      if (!R) return;
      cancelAnimationFrame(R.raf);
      R.label(null);
      api.view.zoom = R.prevZoom;
      R = null;
      document.documentElement.classList.remove('sn-saver');
      api.setSaver(false);
      api.resize();
      api.changed({ lod: 'full' });
    },
    debug() {
      if (!R) return null;
      const t = R.times, avg = t.length ? t.reduce((a, b) => a + b, 0) / t.length : 0;
      return { seed: R.seed, shot: R.shot && R.shot.kind, key: R.key, count: R.count, order: R.order.slice(), u: R.shot ? Math.min(1, (performance.now() - R.t0) / (R.shot.dur * 1000)) : 0,
        frameMsAvg: +avg.toFixed(2), frameMsMax: +Math.max(0, ...t).toFixed(2), stats: Object.fromEntries(Object.entries(R.stats).map(([k, s]) => [k, { n: s.n, avg: +(s.sum / s.n).toFixed(2), max: +s.max.toFixed(2) }])), band: R.band };
    },
    cut(kind) { if (R) next(SHOTS.includes(kind) ? kind : undefined); },
  };
}
