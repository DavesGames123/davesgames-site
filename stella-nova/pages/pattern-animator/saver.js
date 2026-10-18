// ============================================================================
//  ANIMATED PATTERN DESIGNER  ·  saver.js — the screensaver (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell (lib/screensaver.js) calls snSaver.enter(opts) with
//  { calm, seconds, caption, seed, label }. The tour plays the curated
//  presets (presets.js) in a seeded shuffle, so each run differs. Each shot
//  plays its loop for 9 to 20 s (calm 1 gives the long end and a slower
//  speed), then the next shot fades in over CROSS_MS while the last frame
//  of the old one fades out. The next shot is built early, during the
//  current one.
//
//  FRAME. The board sits in the clear band of the shell label plate
//  (plateBand, lib/saver-clear.js). The board aspect follows the band:
//  16:9 for a wide band, 9:16 for a tall one (a 9:16 recording), 4:5 or
//  square between (boardForBand). boxInBand fits the board in the band at
//  BOX_FILL of the room and centres it. Both are pure (tests.mjs).
//
//  DRAWING. Each frame draws the vectors at the screen resolution
//  (render.js drawFrame), never a scaled raster. The fade-out is a still
//  copy of the old frame at the same size.
//
//  PLATE. Title: the preset name. Sub: the pattern and the palette.
//  Params: the loop and the channels. Lines: the seed and the density.
//  Code: the first lines of the pattern's own gen() source.
//
//  grep -n targets: "export function boardForBand", "export function boxInBand",
//                   "function nextShot", "function frame", "window.snSaver"
// ============================================================================
import { makeRng } from '../pattern-designer/engine.js';
import { paletteById } from '../pattern-designer/palettes.js';
import { FAMILIES } from '../pattern-designer/patterns/index.js';
import { densityDefault } from '../pattern-designer/density.js';
import { codeExtract } from '../pattern-designer/export.js';
import { PRESETS, presetAnim } from './presets.js';
import { CHANNELS } from './motion.js';
import { buildScene, makePlayer } from './scene.js';
import { drawFrame } from './render.js';

export const CROSS_MS = 1600, BOX_FILL = 0.94;
const famName = id => (FAMILIES.find(f => f.id === id) || { name: id }).name;

// The board id for a band of w x h px.
export function boardForBand(w, h) {
  const a = w / Math.max(1, h);
  return a >= 1.45 ? 'desk' : a <= 0.7 ? '9x16' : a >= 1.05 ? 'sq' : '4x5';
}
// The board box (CSS px) in the clear band of a vw x vh view. band:
// { t, b } (plateBand) or null (no plate: a centred band of 80%).
export function boxInBand(vw, vh, band, aspect) {
  const t = band ? band.t : vh * 0.1, b = band ? band.b : vh * 0.1, side = Math.max(16, vw * 0.04);
  const bw = Math.max(80, vw - 2 * side), bh = Math.max(80, vh - t - b);
  let w = bw * BOX_FILL, h = w / aspect;
  if (h > bh * BOX_FILL) { h = bh * BOX_FILL; w = h * aspect; }
  return { x: (vw - w) / 2, y: t + (bh - h) / 2, w, h };
}

export function installSaver(api) {
  let S = null;
  const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;

  function band() { return S.band; }
  function pickShot() {
    const pr = PRESETS[S.order[S.i % S.order.length]]; S.i++;
    const bd = band(), vw = innerWidth, vh = innerHeight;
    const bw = vw * 0.92, bh = bd ? vh - bd.t - bd.b : vh * 0.8;
    return { pr, board: boardForBand(bw, bh), seed: pr.seed + S.rng.int(0, 40) };
  }
  function makeShot(s) {
    const st = { pat: s.pr.pat, P: null, seed: s.seed, D: densityDefault(COARSE), detail: s.pr.detail ?? 0.5, mode: 'auto', board: s.board, mods: s.pr.mods || [], anim: presetAnim(s.pr) };
    s.promise = Promise.race([
      buildScene(j => api.runner.run(j), st, { coarse: COARSE }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 8000)),
    ]).then(sc => { s.scene = sc; s.player = makePlayer(sc, st.anim, paletteById(s.pr.pal)); s.anim = st.anim; return s; });
    s.promise.catch(() => {});
    return s;
  }
  function nextShot() {
    const s = S.next || makeShot(pickShot());
    S.next = null; S.waiting = true;
    s.promise.then(() => {
      if (!S) return;
      const L = s.anim.L, loops = Math.max(1, Math.round((9 + 11 * S.calm) / L));
      s.dur = Math.max(9, Math.min(20, loops * L)) * 1000 / S.speed;
      s.t0 = performance.now();
      if (S.shot) { snapshot(); S.fadeAt = performance.now(); }
      S.shot = s; S.waiting = false;
      plate(s);
      S.next = makeShot(pickShot());
    }).catch(() => { if (S) { S.waiting = false; setTimeout(() => S && nextShot(), 60); } });
  }
  // The frame on screen now, as a still for the fade-out.
  function snapshot() {
    const c = S.canvas, o = S.old;
    o.width = c.width; o.height = c.height;
    const g = o.getContext('2d'); if (g) g.drawImage(c, 0, 0);
  }
  function plate(s) {
    const p = s.scene.pat, on = Object.keys(s.anim.ch).filter(k => s.anim.ch[k].on);
    S.label({
      title: s.pr.name,
      sub: `${p.name} · ${famName(p.family)} pattern · ${paletteById(s.pr.pal).name}`,
      params: [{ name: 'loop', value: s.anim.L + ' s' }].concat(on.map(k => ({ name: CHANNELS[k].label.toLowerCase(), value: s.anim.ch[k].curve }))),
      lines: [`Seed ${s.seed} · density ${s.scene.D.toFixed(2)}${s.scene.patB ? ' · morph to ' + s.scene.patB.name : s.anim.morph ? ' · morph to seed ' + s.anim.morph.seed : ''}. Every channel turns a whole number of times in the loop, so the loop has no seam.`],
      code: { lang: 'js', name: `pattern-designer/patterns/${p.family}.js · ${p.id}`, text: codeExtract(p.gen) },
      anchor: () => { const b = S && S.box; return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2, w: b.w, h: b.h, lead: false } : null; },
    });
  }
  function frame(now) {
    if (!S) return;
    S.raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    if (S.bandFn && now - S.bandAt > 300) { S.bandAt = now; S.band = S.bandFn(innerHeight); }
    const c = S.canvas, dpr = Math.min(2, devicePixelRatio || 1), cw = Math.round(innerWidth * dpr), ch = Math.round(innerHeight * dpr);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const g = c.getContext('2d'); if (!g) return;
    const s = S.shot;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#07080a'; g.fillRect(0, 0, cw, ch);
    if (s) {
      const v = s.scene.view, box = boxInBand(innerWidth, innerHeight, S.band, v.W / v.H); S.box = box;
      const t = (now - s.t0) / 1000 * S.speed, p = s.player.pal, k = box.w * dpr / v.W;
      g.save(); g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 30 * dpr; g.shadowOffsetY = 8 * dpr;
      g.fillStyle = p.bg; g.fillRect(box.x * dpr, box.y * dpr, box.w * dpr, box.h * dpr); g.restore();
      drawFrame(g, s.player.play(t), { W: v.W, H: v.H, base: [k, box.x * dpr, box.y * dpr], lut: s.player.lut, paper: p.bg, lw: 2, lwScale: s.scene.lwScale, clip: null });
      S.t = t;
      if (!S.waiting && S.next && S.next.scene && now - s.t0 > s.dur) nextShot();
    }
    if (S.fadeAt != null) {
      const a = 1 - Math.min(1, (now - S.fadeAt) / CROSS_MS);
      if (a > 0) { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = a; g.drawImage(S.old, 0, 0); g.globalAlpha = 1; } else S.fadeAt = null;
    }
  }

  window.snSaver = {
    enter(o = {}) {
      if (S) this.exit();
      api.enter();
      const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
      const rng = makeRng((o.seed >>> 0) || ((Date.now() & 0xffffff) + 1), 'pa-saver');
      const st = document.createElement('style'); st.id = 'paSaverStyle';
      st.textContent = '.topbar,#panel,#dock,#gear,#caption,#tools,#transport,#board,#busy,#toast{display:none!important}#desk{top:0!important;bottom:0!important}html,body{cursor:none}' +
        '#paSaver{position:fixed;inset:0;width:100vw;height:100vh;display:block;z-index:100}';
      document.head.append(st);
      const canvas = document.createElement('canvas'); canvas.id = 'paSaver';
      document.body.append(canvas);
      S = { calm, rng, order: rng.shuffle(PRESETS.map((_, i) => i)), i: 0, canvas, old: document.createElement('canvas'), style: st,
        label: typeof o.label === 'function' ? o.label : () => {}, band: null, bandFn: null, bandAt: 0,
        shot: null, next: null, waiting: false, fadeAt: null, box: null, t: 0, speed: 1 - 0.45 * calm };
      import('../../lib/saver-clear.js').then(m => { if (S) S.bandFn = m.plateBand; }).catch(() => { /* no shell: the centre band */ });
      nextShot();
      S.raf = requestAnimationFrame(frame);
      return { canvas, warmupMs: 900 };
    },
    exit() {
      if (!S) return;
      cancelAnimationFrame(S.raf);
      try { S.label(null); } catch (e) { /* the shell is gone */ }
      S.canvas.remove(); S.style.remove();
      S = null;
      api.exit();
    },
    // For checks: the shot on screen, its time, the board box and the band.
    debug() { return S && S.shot ? { preset: S.shot.pr.id, board: S.shot.board, t: S.t, box: S.box, band: S.band, shots: S.i, fading: S.fadeAt != null } : null; },
  };
}
