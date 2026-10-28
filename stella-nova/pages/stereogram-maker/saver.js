// ============================================================================
//  STEREOGRAM MAKER  ·  saver.js — the screensaver hook (window.snSaver)
// ----------------------------------------------------------------------------
//  lib/screensaver.js has the protocol. enter() hides the page (the CSS
//  under html.sn-saver) and shows #saver, a canvas that fills the frame.
//  Each shot is a turntable stereogram of one model on one pattern tile:
//  the saver's own worker (worker.js, op 'turntable') makes the frames,
//  and a timer plays them. A new shot cuts in every hold seconds
//  (seconds / 5, clamped to 5..12 s) with a short crossfade. The next
//  shot renders while the current one plays.
//
//  FRAMING. plateBand(h) from lib/saver-clear.js gives the clear band
//  between the label plate texts, and the width of the visible column
//  (the full frame at 16:9, the middle column at 9:16). The stereogram
//  fills that band and that column, so no text covers it. Without a plate
//  the stereogram fills the frame with a small margin. A shot is sized
//  for the rect at the time it renders. The band and the frame can change
//  after that, so draw() letterboxes each frame to its own shape inside
//  the rect of now (fitFrame), and never stretches it.
//
//  FRAMES. A shot waits until each of its n frames is an ImageBitmap. A
//  bitmap that finishes after its shot is dropped, or after exit(), is
//  closed at once. exit() also drops each shot that is still in the
//  making (the set making), because its worker call never resolves.
//
//  SHOTS. shotList(seed, n) is a seeded shuffle of models, each paired
//  with a pattern tile (and now and then coloured dots), with no model or
//  tile twice in a row. calm 1 plays the turn slowest.
//
//  grep -n targets: "export function shotList", "export function holdSeconds",
//                   "export function installSaver", "function frameRect",
//                   "export function fitFrame"
// ============================================================================
import { MODELS, TILES, modelMeta, tileMeta } from './engine-api.js';
import { DEFAULT_STATE, DOT_PALETTE_IDS, cloneState } from './state.js';
import { turntableSize, screenDpi } from './depthkit.js';
import { PALETTES } from '../pattern-designer/palettes.js';

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export const holdSeconds = seconds => Math.max(5, Math.min(12, (seconds || 60) / 5));

// The largest rect with the shape w:h, centred in r (the letterbox).
export function fitFrame(r, w, h) {
  const a = w / h;
  if (!(a > 0) || !Number.isFinite(a)) return { x: r.x, y: r.y, w: r.w, h: r.h };
  const fw = r.w / r.h > a ? r.h * a : r.w, fh = r.w / r.h > a ? r.h : r.w / a;
  return { x: r.x + (r.w - fw) / 2, y: r.y + (r.h - fh) / 2, w: fw, h: fh };
}

// n shots: { model, tile | null, palette, tileSeed }. Fixed by seed.
export function shotList(seed, n = 24) {
  const r = rng(seed), models = MODELS.map(m => m.id), tiles = TILES.filter(t => t.family !== 'dots').map(t => t.id);
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const mq = [], tq = [], out = [];
  for (let k = 0; k < n; k++) {
    if (!mq.length) { const s = shuffle(models.slice()); if (out.length && s[0] === out[out.length - 1].model && s.length > 1) s.push(s.shift()); mq.push(...s); }
    if (!tq.length) tq.push(...shuffle(tiles.slice()));
    const dots = r() < 0.15 || !tiles.length;
    out.push({ model: mq.shift(), tile: dots ? null : tq.shift(), palette: Math.floor(r() * DOT_PALETTE_IDS.length), tileSeed: 1 + Math.floor(r() * 9999) });
  }
  return out;
}

function shotState(shot) {
  const s = cloneState(DEFAULT_STATE), m = modelMeta(shot.model), v = (m && m.view) || {};
  Object.assign(s.src, { kind: 'model', id: shot.model, yaw: v.yaw || 0, pitch: v.pitch || 0, roll: v.roll || 0, fit: 0.84, relief: 0.85, lift: 0.08 });
  if (shot.tile) Object.assign(s.pat, { kind: 'tile', id: shot.tile, seed: shot.tileSeed });
  else Object.assign(s.pat, { kind: 'colour', palette: shot.palette, seed: shot.tileSeed });
  Object.assign(s.view, { mode: 'wall', guides: false, smooth: true });
  return s;
}

export function installSaver(page = {}) {
  let on = false, cv = null, g = null, worker = null, seq = 0, pend = new Map(), life = 0;
  const making = new Set();     // shots whose frames are still coming
  let shots = [], si = 0, cur = null, next = null, fade = null, timer = 0, raf = 0, opts = null, band = null, bandFn = null, bandAt = 0;

  function call(op, args, onProgress) {
    const id = ++seq;
    return new Promise((res, rej) => { pend.set(id, { res, rej, onProgress }); worker.postMessage({ id, op, args }); });
  }
  function startWorker() {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      const m = e.data, p = pend.get(m.id);
      if (!p) return;
      if (m.progress) { p.onProgress && p.onProgress(m.progress); return; }
      pend.delete(m.id); m.ok ? p.res(m.result) : p.rej(new Error(m.error));
    };
  }
  // The rect of the stereogram in canvas px.
  function frameRect() {
    const W = cv.width, H = cv.height, s = W / innerWidth;
    const now = performance.now();
    if (bandFn && now - bandAt > 1000) { bandAt = now; band = bandFn(innerHeight); }
    if (!band) { const m = Math.round(Math.min(W, H) * 0.04); return { x: m, y: m, w: W - 2 * m, h: H - 2 * m }; }
    const cw = Math.min(W, band.w * s), t = band.t * s, b = band.b * s;
    return { x: Math.round((W - cw) / 2), y: Math.round(t), w: Math.round(cw), h: Math.round(H - t - b) };
  }
  async function makeShot(shot) {
    const r = frameRect(), n = 32, calm = opts.calm ?? 0.7;
    const f = turntableSize(r.w, r.h, n, 14e6), k = f.w / (r.w / (cv.width / innerWidth));
    const st = shotState(shot), pal = PALETTES.find(p => p.id === DOT_PALETTE_IDS[shot.palette]);
    // fill(null): .some() skips the holes of new Array(n)
    const s = { shot, frames: new Array(n).fill(null), k: 0, fps: 6 + 8 * (1 - calm), t0: 0, dead: false, life };
    making.add(s);
    try {
      await call('turntable', { state: st, w: f.w, h: f.h, dpi: screenDpi(Math.max(0.5, k), false), n, colors: pal ? [pal.bg, ...pal.ink] : null }, async p => {
        const img = new ImageData(p.frame.data, p.frame.w, p.frame.h);
        const bm = await createImageBitmap(img);
        // the shot is gone (drop or exit): no one will close this bitmap
        if (s.dead || !on || s.life !== life) { if (bm && bm.close) bm.close(); return; }
        s.frames[p.k] = bm;
      });
      for (let tries = 0; s.frames.some(x => !x) && tries < 100; tries++) await new Promise(r2 => setTimeout(r2, 20));
    } finally { making.delete(s); }
    s.t0 = performance.now();
    return s;
  }
  function drop(s) {
    if (!s) return;
    s.dead = true;
    for (const f of s.frames) if (f && f.close) f.close();
  }
  function label(shot) {
    if (!opts || !opts.label || opts.labels === false) return;
    const m = modelMeta(shot.model), t = shot.tile ? tileMeta(shot.tile) : null;
    opts.label({
      title: m ? m.name : 'Stereogram',
      sub: 'A single-image stereogram on ' + (t ? t.name.toLowerCase() : 'coloured dots'),
      lines: ['Look through the screen, as if at a far wall', m ? m.credit + ' · ' + m.licence : ''],
    });
  }
  function draw() {
    if (!on) return;
    raf = requestAnimationFrame(draw);
    const now = performance.now();
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    const r = frameRect();
    const paint = (s, a) => {
      if (!s) return;
      const i = Math.floor((now - s.t0) / 1000 * s.fps) % s.frames.length, f = s.frames[i];
      if (!f) return;
      g.globalAlpha = a; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      const q = fitFrame(r, f.width, f.height);
      g.drawImage(f, q.x, q.y, q.w, q.h);
      g.globalAlpha = 1;
    };
    if (fade) {
      const t = Math.min(1, (now - fade.t0) / 900);
      paint(fade.from, 1 - t); paint(cur, t);
      if (t >= 1) { drop(fade.from); fade = null; }
    } else paint(cur, 1);
  }
  async function cut() {
    if (!on) return;
    if (!next) { timer = setTimeout(cut, 500); return; }
    const from = cur;
    cur = next; cur.t0 = performance.now(); next = null;
    fade = from ? { from, t0: performance.now() } : null;
    label(cur.shot);
    timer = setTimeout(cut, holdSeconds(opts.seconds) * 1000);
    prepare();
  }
  async function prepare() {
    const shot = shots[si++ % shots.length];
    const my = life;
    try { const s = await makeShot(shot); if (on && my === life) next = s; else drop(s); }
    catch (e) { if (on) setTimeout(prepare, 400); }
  }
  function resize() {
    if (!cv) return;
    const s = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(innerWidth * s); cv.height = Math.round(innerHeight * s);
  }

  window.snSaver = {
    enter(o) {
      opts = o || {};
      life++;
      if (page.stopTurntable) page.stopTurntable();
      import('../../lib/saver-clear.js').then(m => { bandFn = m.plateBand; }).catch(() => { /* no band: the full frame */ });
      cv = document.getElementById('saver');
      if (!cv) { cv = document.createElement('canvas'); cv.id = 'saver'; document.body.append(cv); }
      g = cv.getContext('2d');
      document.documentElement.classList.add('sn-saver');
      on = true; resize(); addEventListener('resize', resize);
      if (!worker) startWorker();
      shots = shotList(((opts.seed >>> 0) || 1), 24); si = 0;
      cur = null; next = null; fade = null;
      prepare().then(() => cut());
      draw();
      return { canvas: cv, warmupMs: 2600 };
    },
    exit() {
      on = false; life++;
      clearTimeout(timer); cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
      document.documentElement.classList.remove('sn-saver');
      drop(cur); drop(next); if (fade) drop(fade.from);
      // exit ends the worker, so a shot in the making never resolves
      for (const s of making) drop(s);
      making.clear();
      cur = next = fade = null;
      if (worker) { worker.terminate(); worker = null; pend = new Map(); }
      if (opts && opts.label) try { opts.label(null); } catch (e) { /* shell gone */ }
    },
  };
}
