// ============================================================================
//  CONTEXT FREE  ·  saver.js — the window.snSaver hook (screensaver tour)
// ----------------------------------------------------------------------------
//  Our own code (GPL-2.0-or-later, see COPYING) around the Context Free
//  engine of Mark Lentczner and John Horigan. Protocol: lib/screensaver.js.
//  enter(opts) hides the page GUI, puts a full-window canvas (#saverCanvas)
//  in the document and returns { canvas, warmupMs }. exit() gives the page
//  back.
//
//  SHOTS. A seeded shuffle of designs (opts.seed differs per run; the bag
//  and the counters reset on each load), each with a new random variation
//  from the same seeded stream. A shot lasts 5-12 s (calm = longer):
//    grow   the engine's own partial frames of the render, played back
//           over 1.5-3.5 s with cross-fades: the design grows and the
//           frame widens as the engine expands it, as in the app
//    push   then a slow push-in on a busy part of the finished art
//    pan    or, at a fixed zoom, a slow pan across it (tiled designs
//           always pan, over their repeats)
//    anim   a time design (CF::Time, ftime()) plays its frames instead
//  The next shot renders in the saver lane while the current one plays,
//  so a cut never waits (it waits at most 5 s for a slow render).
//
//  NO UPSCALED RASTER. The push and pan draw a second render made at the
//  final zoom (the card size times Z, at most 4096 px). The camera only
//  ever draws it at one raster px per device px or less. The grow frames
//  are made at the card size and drawn 1:1.
//
//  FRAMING. The art card sits in the clear band of the shell label plate
//  (lib/saver-clear.js plateBand), checked each 250 ms. Until the plate
//  has text, a guess of that band (see cardOf); with no shell, a band of
//  76% of the height.
//
//  LABEL. opts.label({ title, sub, lines, code }): the design name, the
//  variation code and shape count, the authors, and a short extract of
//  the design's own CFDG source (code: { lang: 'cfdg', name, text }).
//
//  GREP MAP
//    grep -n 'export function installSaver'  the hook
//    grep -n 'function prepare'              the renders of a shot
//    grep -n 'function render'               one frame of the tour
//    grep -n 'function extract'              the CFDG extract
//    grep -n 'function busyPoint'            where the push-in goes
//    grep -n 'function cardOf'               the art card in the band
// ============================================================================
import { DESIGNS, loadSource } from './designs.js';
import { createLane } from './client.js';
import { varToString, randomVariation } from './variation.js';

const TOUR = ['welcome', 'demo1', 'demo2', 'snowflake', 'sierpinski', 'octopi', 'thingy', 'cilia', 'ciliasun', 'rose',
  'funky_flower', 'tangle', 'thorns', 'tree_number_5', 'point', 'weighting_demo', 'triples', 'ziggy', 'xmas', 'chanukah',
  'truchet', 'garden', 'maze', 'p4g', 'spikes', 'rosette', 'spiral'];

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
  const lane = createLane('saver');

  function shuffled(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function nextDesign() {
    if (!V.bag.length) {
      const b = shuffled(TOUR, V.rnd);
      if (b[0] === V.lastId) b.push(b.shift());
      V.bag = b;
    }
    V.lastId = V.bag.shift();
    return DESIGNS.find(d => d.id === V.lastId);
  }

  // ── cardOf ────────────────────────────────────────────────────────────────
  // The art card in css px: the clear band, with side margins.
  // Before the plate has text, plateBand() is null: the first shots use a
  // guess of the band the plate will leave (measured at 1280 x 800: top
  // text to 38% of the height, bottom text from 66%; in portrait the
  // plate leaves 26% to 90%). With no shell at
  // all, the band stays at that guess. The card is at most 1.6 times as
  // wide as it is high: a design fills the height, not a wide white strip.
  function cardOf() {
    const b = V.band;
    const port = innerHeight > innerWidth;   // measured at 390 x 844: 26% and 10%
    const t = b ? b.t : innerHeight * (V.inShell ? (port ? 0.26 : 0.385) : 0.12),
      bb = b ? b.b : innerHeight * (V.inShell ? (port ? 0.1 : 0.35) : 0.12);
    const h = Math.max(100, innerHeight - t - bb);
    const w = Math.min(innerWidth * 0.92, h * 1.6);
    return { x: (innerWidth - w) / 2, y: t, w, h };
  }

  // ── prepare ───────────────────────────────────────────────────────────────
  // Two renders for a still design (the grow frames at card size, then the
  // zoom raster), or the frames of a time design.
  function prepare() {
    const d = nextDesign();
    const calm = V.calm, dpr = V.dpr;
    const variation = randomVariation(V.rnd);
    const card = cardOf();
    const cw = Math.max(64, Math.round(card.w * dpr)), ch = Math.max(64, Math.round(card.h * dpr));
    const shot = { d, variation, card, cw, ch, grow: [], final: null, hi: null, frames: [], t0: 0, ready: false,
      dur: 5 + 5 * calm + V.rnd() * 2.5, mode: d.anim ? 'anim' : (d.tiled || V.rnd() < 0.3 ? 'pan' : 'push'), shapes: 0, src: '' };
    // The zoom raster is Z times the card, at most 4096 px on a side.
    const Zmax = 4096 / Math.max(cw, ch);
    shot.Z = d.anim ? 1 : Math.min(Zmax, (shot.mode === 'pan' ? 1.7 : 2.0) + V.rnd() * 0.8);
    if (shot.Z < 1.1) shot.Z = 1;
    shot.pan = { a: V.rnd() * Math.PI * 2 };
    const tile = d.tiled ? 4 : 0;
    shot.work = loadSource(d).then(src => {
      shot.src = src;
      if (!V) return null;
      if (d.anim) {
        // Time designs: 24 frames at most 900 px wide, played in a loop.
        const fw = Math.min(cw, 900), fh = Math.round(fw * ch / cw);
        const n = Math.min(24, d.anim);
        return lane.run({ src, variation, opts: { width: fw, height: fh, frames: n, maxShapes: 200000, wide: true, tickMs: 0 } },
          { onFrame: (img, i) => createImageBitmap(img).then(b => { shot.frames[i] = b; }) })
          .then(r => { shot.shapes = r.shapes; });
      }
      let parts = [];
      return lane.run({ src, variation, opts: { width: cw, height: ch, tile, maxShapes: 400000, partial: true, tickMs: 25, wide: true, budgetMs: 6000 } },
        { onFrame: img => {
          parts.push(createImageBitmap(img));
          // Keep at most 14 partial frames: drop every other one.
          if (parts.length > 14) { const keep = parts.filter((_, i) => i % 2 === 1); parts.filter((_, i) => i % 2 === 0).forEach(p => p.then(b => b.close && b.close())); parts = keep; }
        } })
        .then(async r => {
          shot.shapes = r.shapes;
          shot.grow = await Promise.all(parts);
          shot.final = await createImageBitmap(r.image);
          if (!V) return;
          shot.focus = busyPoint(r.image, V.rnd);
          if (shot.Z === 1) return;
          const hw = Math.round(cw * shot.Z), hh = Math.round(ch * shot.Z);
          const r2 = await lane.run({ src, variation, opts: { width: hw, height: hh, tile, maxShapes: 900000, wide: true, tickMs: 0, budgetMs: 9000 } });
          shot.hi = await createImageBitmap(r2.image);
          shot.hiW = r2.width; shot.hiH = r2.height;
        });
    }).then(() => { shot.ready = true; }, err => { if (!(err && err.cancelled)) { console.warn('saver shot failed', d.id, err); shot.failed = true; } });
    return shot;
  }

  function release(shot) {
    if (!shot) return;
    for (const b of [...shot.grow, ...shot.frames, shot.final, shot.hi]) if (b && b.close) b.close();
  }

  // ── label ─────────────────────────────────────────────────────────────────
  function labelFor(shot) {
    const d = shot.d, code = varToString(shot.variation);
    const lines = [`Variation ${code} · ${shot.shapes.toLocaleString('en-US')} shapes` + (d.tiled ? ' · tiled' : '') + (d.anim ? ` · ${shot.frames.filter(Boolean).length} frames` : '')];
    lines.push(d.note);
    return {
      title: d.title,
      sub: 'Context Free · Mark Lentczner and John Horigan · CFDG by Chris Coyne',
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
    if (shot && shot.failed) { release(shot); V.shot = shot = V.next; V.next = prepare(); }
    // Cut when the shot is over and the next one is ready (at most 5 s late).
    if (shot && shot.t0 && (now - shot.t0) / 1000 > shot.dur && (V.next.ready || V.next.failed || (now - shot.t0) / 1000 > shot.dur + 5)) {
      V.prev = shot; V.prevAt = now;
      V.shot = shot = V.next; shot.t0 = 0; V.next = prepare();
    }
    if (shot && !shot.t0 && shot.ready) { shot.t0 = now; V.count++; V.label(labelFor(shot)); }
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = '#07080a'; x.fillRect(0, 0, W, H);
    // A short cross-fade: the new shot, then the last frame of the previous
    // shot over it at a falling alpha (two alphas over black would dim a
    // white card to grey half way).
    const fade = V.prev ? Math.min(1, (now - V.prevAt) / 600) : 1;
    if (V.prev && fade >= 1) { release(V.prev); V.prev = null; }
    if (shot && shot.t0) drawShot(shot, now, x, dpr, false);
    if (V.prev && V.prev.t0) { x.globalAlpha = 1 - fade; drawShot(V.prev, now, x, dpr, true); x.globalAlpha = 1; }
  }

  // One shot at time now. The art rect is the render (its own aspect)
  // contained in the card of the current band, never larger than the
  // render: one raster px per device px at most.
  function drawShot(shot, now, x, dpr, frozen) {
    const t = frozen ? shot.dur : (now - shot.t0) / 1000;
    const band = cardOf();
    const ref = shot.mode === 'anim' ? shot.frames.find(Boolean) : shot.final;
    if (!ref) return;
    const k = Math.min(1, band.w * dpr / ref.width, band.h * dpr / ref.height);
    const w = Math.round(ref.width * k), h = Math.round(ref.height * k);
    const X = Math.round((innerWidth * dpr - w) / 2), Y = Math.round(band.y * dpr + (band.h * dpr - h) / 2);
    x.save();
    x.beginPath(); x.rect(X, Y, w, h); x.clip();
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    if (shot.mode === 'anim') {
      const fr = shot.frames.filter(Boolean);
      const fps = 10 + 6 * (1 - V.calm);
      x.drawImage(fr[Math.floor(t * fps) % fr.length], X, Y, w, h);
      x.restore(); return;
    }
    const G = Math.min(3.5, Math.max(1.5, shot.grow.length * 0.3)) + 0.4 * V.calm;
    if (t < G && shot.grow.length) {
      // The engine's partial frames, one after another with a cross-fade.
      const n = shot.grow.length, p = (t / G) * n, i = Math.min(n - 1, Math.floor(p)), a = ease((p - i - 0.55) / 0.45);
      const ga = x.globalAlpha;
      x.drawImage(shot.grow[i], X, Y, w, h);
      const nx = i + 1 < n ? shot.grow[i + 1] : shot.final;
      if (a > 0 && nx) { x.globalAlpha = ga * a; x.drawImage(nx, X, Y, w, h); x.globalAlpha = ga; }
      x.restore(); return;
    }
    // Push or pan on the zoom raster. z is the zoom of the art (1 = all of
    // it); the raster is Z times the art rect at k = 1, so z <= Z keeps it
    // at one raster px per device px or less.
    const u = ease((t - G) / Math.max(0.5, shot.dur - G));
    const img = shot.hi || shot.final, Z = shot.hi ? shot.Z : 1;
    let z, cx, cy;
    if (shot.mode === 'pan') {
      z = Math.min(Z, 1 + (Z - 1) * Math.min(1, u * 4));
      const r = 0.5 - 0.5 / z, a = shot.pan.a, s = -1 + 2 * u;
      cx = 0.5 + Math.cos(a) * r * s; cy = 0.5 + Math.sin(a) * r * s;
    } else {
      z = 1 + (Z - 1) * u;
      const f = shot.focus || { u: 0.5, v: 0.5 }, r = 0.5 - 0.5 / z, m = Math.min(1, u * 1.5);
      cx = 0.5 + clampAbs(f.u - 0.5, r) * m;
      cy = 0.5 + clampAbs(f.v - 0.5, r) * m;
    }
    // The visible part of the art in 0..1 units, then in raster px.
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
        canvas, ctx: canvas.getContext('2d'), style: st, bag: [], lastId: '', count: 0,
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
      lane.cancel();
      V.label(null);
      release(V.shot); release(V.next); release(V.prev);
      V.style.remove(); V.canvas.remove();
      V = null;
      onExit();
    },
    debug() {
      if (!V || !V.shot) return null;
      const s = V.shot;
      return { id: s.d.id, variation: varToString(s.variation), mode: s.mode, t0: s.t0, ready: s.ready, count: V.count,
        grow: s.grow.length, frames: s.frames.length, Z: s.Z, hi: s.hi ? [s.hi.width, s.hi.height] : null, card: [s.cw, s.ch],
        next: V.next && V.next.d.id, nextReady: V.next && V.next.ready, band: V.band };
    },
  };
  return window.snSaver;
}
