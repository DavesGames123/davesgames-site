// ============================================================================
//  CONTEXT FREE  ·  saver.js — the window.snSaver hook (screensaver tour)
// ----------------------------------------------------------------------------
//  Our own code (GPL-2.0-or-later, see COPYING) around the Context Free
//  engine of Mark Lentczner and John Horigan (CFDG by Chris Coyne).
//  Protocol: lib/screensaver.js. enter(opts) hides the page GUI, puts a
//  full-window canvas (#saverCanvas) in the document and returns
//  { canvas, warmupMs }. exit() gives the page back.
//
//  SHOTS. A seeded shuffle of designs (opts.seed differs per run; the bags
//  and the counters reset on each load). Each shot takes a new random
//  variation, a theme (look.js) and a grow mode (build order, depth,
//  radial) from seeded bags. A shot lasts 6.5-11 s at calm 0.7 (5-12 s over
//  the calm range):
//    grow   the structure is drawn over time: the growth replay of the
//           engine (patch 0004), frame by frame at the card size; the
//           first frame is the empty paper, the last is the full render
//    push   then a slow push-in on a busy part of the art, or
//    pan    a slow pan across it (tiled designs always pan)
//  No finished image pops in: every shot starts from the empty paper.
//  Two grow lanes take turns: the next shot is built in the other lane
//  while the current one plays, so a cut does not wait (at most 5 s).
//
//  NO UPSCALED RASTER. The push and pan draw a third render, made at the
//  final zoom (the card size times Z, at most 4096 px), at one raster px
//  per device px or less. The grow frames are drawn 1:1.
//
//  FRAMING. The art card sits in the clear band of the shell label plate
//  (lib/saver-clear.js plateBand), checked each 250 ms. Until the plate
//  has text, a guess of that band (see cardOf); with no shell, a band of
//  76% of the height.
//
//  LABEL. opts.label({ title, sub, lines, code }): the design name, the
//  credits (Context Free by Mark Lentczner and John Horigan, CFDG by Chris
//  Coyne), the variation code, shape count, grow mode and theme, and an
//  extract of the design's own CFDG source (code: { lang: 'cfdg', ... }).
//
//  GREP MAP
//    grep -n 'export function installSaver'  the hook
//    grep -n 'function prepare'              the renders of a shot
//    grep -n 'function pump'                 the grow frames of a shot
//    grep -n 'function drawShot'             one frame of a shot
//    grep -n 'function extract'              the CFDG extract
//    grep -n 'function busyPoint'            where the push-in goes
//    grep -n 'function cardOf'               the art card in the band
// ============================================================================
import { DESIGNS, loadSource } from './designs.js';
import { createLane } from './client.js';
import { varToString, randomVariation } from './variation.js';
import { THEMES, plan, defsFor, toMask, compose } from './look.js';

const TOUR = ['demo1', 'welcome', 'demo2', 'snowflake', 'sierpinski', 'octopi', 'thingy', 'cilia', 'ciliasun', 'rose',
  'funky_flower', 'tangle', 'thorns', 'tree_number_5', 'point', 'weighting_demo', 'triples', 'ziggy', 'xmas', 'chanukah',
  'truchet', 'garden', 'maze', 'p4g', 'spikes', 'rosette'];
const MODES = ['depth', 'depth', 'build', 'radial'];
const MODE_NAME = { build: 'build order', depth: 'generation by generation', radial: 'outwards from the origin' };

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

// A short extract of the design source: from the startshape's own shape
// (or rule) on, comments and blank lines left out.
export function extract(src, n = 11) {
  const lines = src.split('\n');
  const m = src.match(/^\s*startshape\s+([A-Za-z_][\w]*)/m);
  let i = -1;
  if (m) i = lines.findIndex(l => new RegExp('^\\s*(shape|rule)\\s+' + m[1] + '\\b').test(l));
  if (i < 0) i = lines.findIndex(l => /^\s*(shape|rule|path)\b/.test(l));
  if (i < 0) i = 0;
  const out = [];
  if (m) out.push(lines.find(l => /^\s*startshape\b/.test(l)).trim());
  for (let j = i; j < lines.length && out.length < n; j++) {
    const l = lines[j].replace(/\s+$/, '');
    if (!l.trim() || /^\s*(\/\/|#)/.test(l)) continue;
    out.push(l.replace(/\t/g, '  '));
  }
  return out.join('\n');
}
// The busiest cell of a 12 x 12 grid over the image (luminance spread),
// picked at random among the top quarter, in 0..1 units. The edges are
// left out, so the push-in stays on the art.
export function busyPoint(img, rnd) {
  const G = 12, W = img.width, H = img.height, px = img.data;
  const cells = [];
  for (let gy = 1; gy < G - 1; gy++) for (let gx = 1; gx < G - 1; gx++) {
    let s = 0, s2 = 0, n = 0;
    const x0 = Math.floor(gx * W / G), x1 = Math.floor((gx + 1) * W / G), y0 = Math.floor(gy * H / G), y1 = Math.floor((gy + 1) * H / G);
    const sx = Math.max(1, (x1 - x0) >> 3), sy = Math.max(1, (y1 - y0) >> 3);
    for (let y = y0; y < y1; y += sy) for (let x = x0; x < x1; x += sx) {
      const k = (y * W + x) * 4, l = px[k] * 0.3 + px[k + 1] * 0.59 + px[k + 2] * 0.11;
      s += l; s2 += l * l; n++;
    }
    cells.push({ u: (gx + 0.5) / G, v: (gy + 0.5) / G, var: n ? s2 / n - (s / n) ** 2 : 0 });
  }
  cells.sort((a, b) => b.var - a.var);
  const top = cells.slice(0, Math.max(1, cells.length >> 2));
  return top[Math.floor(rnd() * top.length)];
}

export function installSaver(ctxIn) {
  const { onEnter, onExit } = ctxIn;
  let V = null;
  const growLanes = [createLane('saver-a'), createLane('saver-b')];
  const hiLane = createLane('saver-hi');

  function shuffled(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function fromBag(key, list) {
    if (!V.bags[key] || !V.bags[key].length) V.bags[key] = shuffled(list, V.rnd);
    return V.bags[key].shift();
  }
  function nextDesign() {
    let id = fromBag('d', TOUR);
    if (id === V.lastId) id = fromBag('d', TOUR);
    V.lastId = id;
    return DESIGNS.find(d => d.id === id);
  }

  // ── cardOf ────────────────────────────────────────────────────────────────
  // Before the plate has text, plateBand() is null: the first shots use a
  // guess of the band the plate will leave (measured at 1280 x 800: top
  // text to 38% of the height, bottom text from 66%; in portrait the plate
  // leaves 26% to 90%). With no shell at all, the band stays at that
  // guess. The card is at most 1.6 times as wide as it is high.
  function cardOf() {
    const b = V.band;
    const port = innerHeight > innerWidth;
    const t = b ? b.t : innerHeight * (V.inShell ? (port ? 0.26 : 0.385) : 0.12),
      bb = b ? b.b : innerHeight * (V.inShell ? (port ? 0.1 : 0.35) : 0.12);
    const h = Math.max(100, innerHeight - t - bb);
    const w = Math.min(innerWidth * 0.92, h * 1.6);
    return { x: (innerWidth - w) / 2, y: t, w, h };
  }

  // ── prepare ───────────────────────────────────────────────────────────────
  // The grow render of a shot at the card size in its own lane, then the
  // zoom render for the push or pan.
  function prepare() {
    const d = nextDesign();
    const calm = V.calm, dpr = V.dpr;
    const variation = randomVariation(V.rnd);
    const theme = fromBag('t', THEMES.map(t => t.id));
    const look = { theme, bgStyle: 'theme', bg: '', ink: '', colourBg: true };
    const mode = fromBag('m', MODES);
    const card = cardOf();
    const cw = Math.max(64, Math.round(card.w * dpr)), ch = Math.max(64, Math.round(card.h * dpr));
    const lane = growLanes[V.laneTurn++ % 2];
    const shot = { d, variation, look, mode, lane, cw, ch, t0: 0, ready: false, failed: false,
      dur: 5 + 5 * calm + V.rnd() * 1.5, motion: d.tiled || V.rnd() < 0.3 ? 'pan' : 'push',
      shapes: 0, src: '', info: null, defsIgnored: false, canvas: null, w: 0, h: 0, at: -1, inflight: false, frames: 0,
      hi: null, focus: null, pan: { a: V.rnd() * Math.PI * 2 } };
    const Zmax = 4096 / Math.max(cw, ch);
    shot.Z = Math.min(Zmax, (shot.motion === 'pan' ? 1.7 : 2.0) + V.rnd() * 0.8);
    if (shot.Z < 1.1) shot.Z = 1;
    const tile = d.tiled ? 4 : 0;
    const defs = defsFor(look);
    shot.work = loadSource(d).then(src => {
      shot.src = src;
      if (!V) return null;
      return lane.run({ src, variation, defs, opts: { width: cw, height: ch, tile, maxShapes: 400000, grow: true, wide: true, tickMs: 0, budgetMs: 6000 } },
        { onParsed: p => { shot.info = p.info; shot.defsIgnored = !!p.defsIgnored; } })
        .then(async r => {
          if (!r.ok || !r.grow) throw new Error('grow render failed');
          shot.shapes = r.shapes; shot.info = r.info || shot.info; shot.w = r.width; shot.h = r.height;
          shot.plan = plan(look, shot.info, shot.defsIgnored);
          // The first frame (the empty paper) before the shot can start.
          const f = await lane.growFrame(mode, 0, shot.plan.kind === 'mask');
          if (!f) throw new Error('no grow frame');
          show(shot, f, 0);
          shot.ready = true;
          // The zoom render, after the grow render is in.
          if (shot.Z === 1) return;
          const hw = Math.round(cw * shot.Z), hh = Math.round(ch * shot.Z);
          const r2 = await hiLane.run({ src, variation, defs, opts: { width: hw, height: hh, tile, maxShapes: 900000, wide: true, tickMs: 0, budgetMs: 9000 } });
          if (!V || !r2.ok || !r2.image) return;
          shot.focus = busyPoint(r2.image, V.rnd);
          const im = shot.plan.kind === 'mask' ? new ImageData(toMask(new Uint8ClampedArray(r2.image.data), shot.info), r2.width, r2.height) : r2.image;
          const bmp = await createImageBitmap(im);
          shot.hi = compose(bmp, r2.width, r2.height, look, shot.plan, dpr * shot.Z);
          if (bmp.close) bmp.close();
        });
    }).catch(err => { if (!(err && err.cancelled)) { console.warn('saver shot failed', d.id, err); shot.failed = true; } });
    return shot;
  }

  function show(shot, f, at) {
    shot.canvas = compose(f.bitmap, f.w, f.h, shot.look, shot.plan, V ? V.dpr : 1, shot.canvas);
    if (f.bitmap.close) f.bitmap.close();
    shot.at = at; shot.frames++;
  }

  // ── pump ──────────────────────────────────────────────────────────────────
  // Ask the shot's lane for the grow frame of time t (one at a time).
  function pump(shot, t, G) {
    if (shot.inflight || shot.at >= 1) return;
    const u = Math.min(1, t / G);
    const want = u >= 1 ? 1 : (shot.mode === 'build' ? u * u : u);
    if (want === shot.at) return;
    shot.inflight = true;
    shot.lane.growFrame(shot.mode, want, shot.plan.kind === 'mask').then(f => {
      shot.inflight = false;
      if (f && V) show(shot, f, want);
    }, () => { shot.inflight = false; });
  }

  // ── label ─────────────────────────────────────────────────────────────────
  function labelFor(shot) {
    const d = shot.d, code = varToString(shot.variation);
    const theme = THEMES.find(t => t.id === shot.look.theme);
    const lines = [`Variation ${code} · ${shot.shapes.toLocaleString('en-US')} shapes` + (d.tiled ? ' · tiled' : ''),
      `Grown ${MODE_NAME[shot.mode]} · ${theme ? theme.name.toLowerCase() : ''}`, d.note];
    return {
      title: d.title,
      sub: 'Context Free by Mark Lentczner and John Horigan · CFDG by Chris Coyne',
      lines,
      code: { lang: 'cfdg', name: d.file, text: extract(shot.src) },
    };
  }

  // ── render ────────────────────────────────────────────────────────────────
  function render(now) {
    if (!V) return;
    V.raf = requestAnimationFrame(render);
    if (V.bandFn && now - V.bandAt > 250) { V.bandAt = now; try { V.band = V.bandFn(innerHeight); } catch (e) { V.band = null; } }
    const dpr = V.dpr, c = V.canvas, x = V.ctx;
    const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    let shot = V.shot;
    if (shot && shot.failed) { V.shot = shot = V.next; V.next = prepare(); }
    // Cut when the shot is over and the next one is ready (at most 5 s late).
    if (shot && shot.t0 && (now - shot.t0) / 1000 > shot.dur && (V.next.ready || V.next.failed || (now - shot.t0) / 1000 > shot.dur + 5)) {
      V.prev = shot; V.prevAt = now;
      V.shot = shot = V.next; shot.t0 = 0; V.next = prepare();
    }
    if (shot && !shot.t0 && shot.ready) { shot.t0 = now; V.count++; V.label(labelFor(shot)); }
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = '#07080a'; x.fillRect(0, 0, W, H);
    // A short cross-fade: the new shot, then the last frame of the previous
    // shot over it at a falling alpha.
    const fade = V.prev ? Math.min(1, (now - V.prevAt) / 600) : 1;
    if (V.prev && fade >= 1) V.prev = null;
    if (shot && shot.t0) drawShot(shot, now, x, dpr, false);
    if (V.prev && V.prev.t0) { x.globalAlpha = 1 - fade; drawShot(V.prev, now, x, dpr, true); x.globalAlpha = 1; }
  }

  const growTime = shot => shot.dur * (0.62 + 0.12 * V.calm);

  // One shot at time now. The art rect is the render (its own aspect)
  // contained in the card of the current band, never larger than the
  // render: one raster px per device px at most.
  function drawShot(shot, now, x, dpr, frozen) {
    const t = frozen ? shot.dur : (now - shot.t0) / 1000;
    const G = growTime(shot);
    if (!frozen) pump(shot, t, G);
    if (!shot.canvas) return;
    const band = cardOf();
    const k = Math.min(1, band.w * dpr / shot.w, band.h * dpr / shot.h);
    const w = Math.round(shot.w * k), h = Math.round(shot.h * k);
    const X = Math.round((innerWidth * dpr - w) / 2), Y = Math.round(band.y * dpr + (band.h * dpr - h) / 2);
    x.save();
    x.beginPath(); x.rect(X, Y, w, h); x.clip();
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    // Growing, or the zoom raster is not in yet: the grow canvas 1:1.
    if (t < G || shot.at < 1 || !shot.hi) { x.drawImage(shot.canvas, X, Y, w, h); x.restore(); return; }
    // Push or pan on the zoom raster. z is the zoom of the art (1 = all of
    // it); the raster is Z times the art rect at k = 1, so z <= Z keeps it
    // at one raster px per device px or less.
    const u = ease((t - G) / Math.max(0.5, shot.dur - G));
    const img = shot.hi, Z = shot.Z;
    let z, cx, cy;
    if (shot.motion === 'pan') {
      z = 1 + (Z - 1) * Math.min(1, u * 3);
      const r = 0.5 - 0.5 / z, a = shot.pan.a, s = -1 + 2 * u;
      cx = 0.5 + Math.cos(a) * r * s * Math.min(1, u * 3); cy = 0.5 + Math.sin(a) * r * s * Math.min(1, u * 3);
    } else {
      z = 1 + (Z - 1) * u;
      const f = shot.focus || { u: 0.5, v: 0.5 }, r = 0.5 - 0.5 / z;
      cx = 0.5 + clampAbs(f.u - 0.5, r) * Math.min(1, u * 1.5);
      cy = 0.5 + clampAbs(f.v - 0.5, r) * Math.min(1, u * 1.5);
    }
    const vw = 1 / z, sx = (cx - vw / 2) * img.width, sy = (cy - vw / 2) * img.height;
    x.drawImage(img, sx, sy, img.width * vw, img.height * vw, X, Y, w, h);
    x.restore();
  }
  const clampAbs = (v, r) => Math.max(-r, Math.min(r, v));

  window.snSaver = {
    enter(o = {}) {
      if (V) this.exit();
      const calm = Math.min(1, Math.max(0, o.calm ?? 0.7));
      const st = document.createElement('style');
      st.id = 'saverStyle';
      st.textContent = '.topbar,#panel,#dock,#gear,#desk{display:none!important}' +
        '#saverCanvas{position:fixed;inset:0;width:100%;height:100%;display:block;z-index:60;cursor:none;background:#07080a}';
      document.head.append(st);
      const canvas = document.createElement('canvas'); canvas.id = 'saverCanvas';
      document.body.append(canvas);
      V = { rnd: mulberry((o.seed >>> 0) || 1), calm, label: typeof o.label === 'function' ? o.label : () => {},
        canvas, ctx: canvas.getContext('2d'), style: st, bags: {}, lastId: '', count: 0, laneTurn: 0,
        dpr: Math.min(1.5, devicePixelRatio || 1),
        band: null, bandFn: null, bandAt: 0, raf: 0, prev: null, prevAt: 0,
        inShell: (() => { try { return window.parent !== window && !!window.parent.document.getElementById('frame-wrap'); } catch (e) { return false; } })() };
      import('../../lib/saver-clear.js').then(m => { if (V) { V.bandFn = m.plateBand; } }).catch(() => { /* no shell: the default band */ });
      onEnter();
      V.shot = prepare();
      V.next = prepare();
      V.raf = requestAnimationFrame(render);
      return { canvas, warmupMs: 2500 };
    },
    exit() {
      if (!V) return;
      cancelAnimationFrame(V.raf);
      growLanes.forEach(l => l.cancel()); hiLane.cancel();
      V.label(null);
      V.style.remove(); V.canvas.remove();
      V = null;
      onExit();
    },
    debug() {
      if (!V || !V.shot) return null;
      const s = V.shot;
      return { id: s.d.id, variation: varToString(s.variation), mode: s.mode, theme: s.look.theme, motion: s.motion,
        t0: s.t0, t: s.t0 ? (performance.now() - s.t0) / 1000 : 0, dur: s.dur, at: s.at, frames: s.frames, ready: s.ready,
        count: V.count, Z: s.Z, hi: s.hi ? [s.hi.width, s.hi.height] : null, card: [s.cw, s.ch],
        next: V.next && V.next.d.id, nextReady: V.next && V.next.ready, band: V.band };
    },
  };
  return window.snSaver;
}
