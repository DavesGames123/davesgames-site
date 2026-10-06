// ============================================================================
//  PATTERN DESIGNER  ·  saver.js — the screensaver tour (window.snSaver)
// ----------------------------------------------------------------------------
//  The shell (lib/screensaver.js) calls snSaver.enter(opts) with
//  { calm, seconds, caption, seed, label }. The tour is a seeded shuffle of
//  patterns, dark palettes and light modifiers, so each run differs. Each
//  shot:
//    gen    the worker makes the elements (the next shot is made early)
//    draw   the elements draw on in order: lines by length, solids fade in
//    hold   the full pattern stays, with a slow push-in when it is light
//    fade   a short fade to the paper, then the next shot
//  A shot takes 5 to 12 s; calm 1 gives the long end.
//
//  DRAWING. Each frame draws vectors at the screen resolution. The
//  finished elements go to a cache canvas of the same size (never scaled
//  up), and only the element that draws now is drawn on top. A push-in
//  draws all vectors again each frame through the zoom.
//
//  FRAME. The board sits in the clear band of the shell label plate
//  (plateBand, lib/saver-clear.js), as wide as the band allows.
//
//  PLATE. Title: the pattern name. Sub: the family and palette. Params:
//  the first sliders. Lines: the seed and the modifiers. Code: the first
//  lines of the pattern's own gen() source.
//
//  grep -n targets: "function nextShot", "function frame", "function plate", "window.snSaver"
// ============================================================================
import { makeRng, boardSize, clampParams } from './engine.js';
import { PATTERNS, FAMILIES } from './patterns/index.js';
import { PALETTES } from './palettes.js';
import { modDefaults } from './modifiers.js';
import { applyMode, drawItems, revealPlan, codeExtract } from './export.js';

const famName = id => (FAMILIES.find(f => f.id === id) || { name: id }).name;
// Palettes with a dark paper read best under the light plate text.
const lum = hex => { const n = parseInt(hex.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255; };
const DARK = PALETTES.filter(p => lum(p.bg) < 0.3);
// Mirror wedges cut solid tiles into blocks, so only line families get one.
const LINE_FAMS = ['flow', 'radial', 'physics', 'distort'];
const FADE_MS = 650, PUSH = 0.05, LIGHT_ITEMS = 6000, LIGHT_POINTS = 160000;

function darker(hex, k) {
  const n = parseInt(hex.slice(1), 16), f = c => Math.round(c * k).toString(16).padStart(2, '0');
  return '#' + f(n >> 16) + f(n >> 8 & 255) + f(n & 255);
}

export function installSaver(api) {
  let S = null;

  function bandRect() {
    const W = innerWidth, H = innerHeight, b = S.band;
    const t = b ? b.t : H * 0.2, bot = b ? b.b : H * 0.2, side = Math.max(24, W * 0.05);
    const h = Math.max(140, H - t - bot), w = Math.max(160, W - 2 * side);
    return { x: side, y: b ? t : (H - h) / 2, w, h };
  }
  // A seeded pick of the next shot: pattern, params near the defaults,
  // palette, and at most one light modifier.
  function pickShot() {
    const r = S.rng, pat = PATTERNS[S.order[S.i % S.order.length]]; S.i++;
    const P = {};
    for (const k in pat.params) { const [a, b, st, d, lab] = pat.params[k]; P[k] = (st >= 1 && b - a === 1) || /\bink$/i.test(lab) ? d : d + (b - a) * 0.22 * (r.next() * 2 - 1); }
    const pal = S.pals[S.i % S.pals.length], mods = [];
    const roll = r.next();
    if (roll < 0.22) { const m = modDefaults('warp'); m.kind = r.pick(['lens', 'twirl', 'noise', 'wave']); m.amount = r.range(0.3, 0.7); m.size = r.range(0.4, 0.7); m.cx = r.range(0.35, 0.65); m.cy = r.range(0.4, 0.6); mods.push(m); }
    else if (roll < 0.34 && LINE_FAMS.includes(pat.family)) { const m = modDefaults('mirror'); m.kind = 'kaleido'; m.n = r.pick([6, 8, 10]); mods.push(m); }
    else if (roll < 0.44) { const m = modDefaults('clip'); m.shape = r.pick(['rounded', 'arch', 'hex']); m.margin = 0.05; mods.push(m); }
    const rc = bandRect(), aspect = Math.max(0.7, Math.min(2.4, rc.w / rc.h));
    const { W, H } = boardSize(aspect);
    return { pat, P: clampParams(pat, P), pal, mods, seed: r.int(1, 999999), W, H, lw: r.range(1.6, 2.8), mode: 'auto' };
  }
  function nextShot() {
    const shot = S.next || makeJob(pickShot());
    S.next = null;
    S.shot = null; S.phase = 'gen';
    shot.promise.then(res => {
      if (!S) return;
      shot.res = res; shot.items = applyMode(res.items, shot.mode); shot.plan = revealPlan(shot.items);
      const total = 1000 * Math.max(5, Math.min(12, 5 + 7 * S.calm + S.rng.range(-1.2, 1.2)));
      shot.drawMs = total * 0.55; shot.holdMs = total * 0.45 - FADE_MS;
      shot.light = shot.items.length < LIGHT_ITEMS && res.points < LIGHT_POINTS;
      shot.t0 = performance.now(); shot.done = 0;
      S.shot = shot; S.phase = 'draw'; S.cacheKey = '';
      plate(shot);
      S.next = makeJob(pickShot());      // make the next shot early
    }).catch(() => { if (S) setTimeout(() => S && nextShot(), 50); });
  }
  function makeJob(s) {
    s.promise = Promise.race([
      api.runner.run({ pat: s.pat.id, P: s.P, seed: s.seed, W: s.W, H: s.H, mods: s.mods }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 6000)),
    ]);
    s.promise.catch(() => {});
    return s;
  }
  function plate(shot) {
    const p = shot.pat, keys = Object.keys(p.params).slice(0, 5);
    const mods = shot.mods.map(m => m.type === 'warp' ? `${m.kind} warp` : m.type === 'mirror' ? `kaleidoscope of ${m.n}` : `${m.shape} clip`);
    S.label({
      title: p.name,
      sub: `${famName(p.family)} pattern · ${shot.pal.name}`,
      params: keys.map(k => { const d = p.params[k], v = shot.P[k]; return { name: d[4].toLowerCase(), value: d[2] >= 1 ? String(Math.round(v)) : v.toFixed(2) }; }),
      lines: [`Seed ${shot.seed}${mods.length ? ' · ' + mods.join(' · ') : ''}. Same seed, same pattern.`],
      code: { lang: 'js', name: `patterns/${p.family}.js · ${p.id}`, text: codeExtract(p.gen) },
      anchor: () => { const b = S && S.box; return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2, w: b.w, h: b.h, lead: false } : null; },
    });
  }
  // The board box in CSS px for this shot, inside the band.
  function boxFor(shot) {
    const rc = bandRect(), k = Math.min(rc.w / shot.W, rc.h / shot.H) * 0.96, w = shot.W * k, h = shot.H * k;
    return { x: rc.x + (rc.w - w) / 2, y: rc.y + (rc.h - h) / 2, w, h, k };
  }
  function frame(now) {
    if (!S) return;
    S.raf = requestAnimationFrame(frame);
    if (S.bandFn && now - S.bandAt > 300) { S.bandAt = now; S.band = S.bandFn(innerHeight); }
    const c = S.canvas, dpr = Math.min(2, devicePixelRatio || 1), cw = Math.round(innerWidth * dpr), ch = Math.round(innerHeight * dpr);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; S.cacheKey = ''; }
    const g = c.getContext('2d'), shot = S.shot;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = shot ? darker(shot.pal.bg, 0.72) : '#07080a'; g.fillRect(0, 0, cw, ch);
    if (!shot) return;
    const el = now - shot.t0, box = boxFor(shot); S.box = box;
    if (S.phase === 'draw' && el > shot.drawMs) S.phase = 'hold';
    if (S.phase === 'hold' && el > shot.drawMs + shot.holdMs) { S.phase = 'fade'; S.fadeAt = now; }
    const T = S.phase === 'draw' ? ease(el / shot.drawMs) : 1;
    // Board paper with a soft shadow.
    const bx = box.x * dpr, by = box.y * dpr, bw = box.w * dpr, bh = box.h * dpr, k = box.k * dpr;
    g.save(); g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 30 * dpr; g.shadowOffsetY = 8 * dpr;
    g.fillStyle = shot.pal.bg; g.fillRect(bx, by, bw, bh); g.restore();
    const o = { palette: shot.pal, lw: shot.lw, clip: shot.res.clip };
    if (S.phase !== 'draw' && shot.light) {
      // Push-in: all vectors again through the zoom (no cached raster).
      const z = 1 + PUSH * ease(Math.min(1, (el - shot.drawMs) / Math.max(1, shot.holdMs + FADE_MS)));
      g.save(); g.beginPath(); g.rect(bx, by, bw, bh); g.clip();
      g.setTransform(k * z, 0, 0, k * z, bx + bw / 2 - shot.W / 2 * k * z, by + bh / 2 - shot.H / 2 * k * z);
      drawItems(g, shot.items, Object.assign({ frame: shot.res.frame }, o));
      g.restore();
    } else {
      // The cache holds the finished elements, at this size and place.
      const key = `${cw}x${ch}|${bx}|${by}|${k}`;
      if (key !== S.cacheKey) { S.cacheKey = key; shot.done = 0; S.cache.width = cw; S.cache.height = ch; }
      const cg = S.cache.getContext('2d'), plan = shot.plan, Tt = T * plan.total;
      let j = shot.done;
      while (j < shot.items.length && plan.start[j] + plan.len[j] <= Tt) j++;
      if (j > shot.done) {
        cg.setTransform(k, 0, 0, k, bx, by);
        drawItems(cg, shot.items.slice(shot.done, j), o);
        shot.done = j;
        if (j >= shot.items.length && shot.res.frame) drawItems(cg, [], Object.assign({ frame: true }, o));
      }
      // Elements may pass the board edge (a mirror, a large disc): clip.
      g.save(); g.beginPath(); g.rect(bx, by, bw, bh); g.clip();
      g.drawImage(S.cache, 0, 0);
      if (j < shot.items.length && T < 1) {
        // The element that draws now: its part up to T.
        const one = { start: new Float64Array([0]), len: new Float64Array([plan.len[j]]), total: plan.len[j] };
        g.setTransform(k, 0, 0, k, bx, by);
        drawItems(g, [shot.items[j]], Object.assign({ reveal: one, t: Math.max(0, Math.min(1, (Tt - plan.start[j]) / plan.len[j])) }, o));
        g.setTransform(1, 0, 0, 1, 0, 0);
      }
      g.restore();
    }
    if (S.phase === 'fade') {
      const a = Math.min(1, (now - S.fadeAt) / FADE_MS);
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = a; g.fillStyle = darker(shot.pal.bg, 0.72); g.fillRect(0, 0, cw, ch); g.globalAlpha = 1;
      if (a >= 1) nextShot();
    }
  }
  const ease = t => { t = Math.max(0, Math.min(1, t)); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };

  window.snSaver = {
    enter(o = {}) {
      if (S) this.exit();
      api.enter();
      const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
      const rng = makeRng((o.seed >>> 0) || ((Date.now() & 0xffffff) + 1), 'saver');
      const order = rng.shuffle(PATTERNS.map((_, i) => i));
      const pals = rng.shuffle(DARK.slice());
      const st = document.createElement('style'); st.id = 'pdSaverStyle';
      st.textContent = '.topbar,#panel,#dock,#gear,#caption,#tools,#explorer,#board,#busy,#toast{display:none!important}#desk{top:0!important;bottom:0!important}html,body{cursor:none}' +
        '#pdSaver{position:fixed;inset:0;width:100vw;height:100vh;display:block;z-index:100}';
      document.head.append(st);
      const canvas = document.createElement('canvas'); canvas.id = 'pdSaver';
      document.body.append(canvas);
      S = { calm, rng, order, pals, i: 0, canvas, cache: document.createElement('canvas'), style: st, label: typeof o.label === 'function' ? o.label : () => {},
        band: null, bandFn: null, bandAt: 0, shot: null, next: null, phase: 'gen', cacheKey: '', box: null };
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
    // For checks over CDP: the shot on screen and its phase.
    debug() { return S && S.shot ? { pat: S.shot.pat.id, phase: S.phase, items: S.shot.items.length, box: S.box, band: S.band } : null; },
  };
}
