// ============================================================================
//  RETRO SHELF  ·  saver.js — screensaver hook: a typographic attract mode
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js and PAGES.md):
//    enter({ calm, seconds, caption, seed }) -> { canvas, warmupMs }
//    exit()
//  enter() closes a running game (the saver plays no game and no sound)
//  and puts one full-window canvas on top. The canvas shows the shelf as
//  title cards: one game at a time, in a seeded shuffle, 6 to 12 s each,
//  with the title, the year and maker, the engine and the licence line.
//  The saver shows no game screen and no game art. The card sits in the
//  clear band of the label plate (plateBand of lib/saver-clear.js).
//
//  Export for node tests: planReel.
//  grep -n targets  "export function planReel"  "function frame"  "window.snSaver ="
// ============================================================================
import { plateBand } from '../../lib/saver-clear.js';

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A seeded reel: every game once per round, no game twice in a row, 6..12 s a shot. */
export function planReel(ids, seed, rounds = 3) {
  const r = rng(seed), out = [];
  for (let k = 0; k < rounds; k++) {
    const a = ids.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    if (out.length && a.length > 1 && a[0] === out[out.length - 1].id) [a[0], a[1]] = [a[1], a[0]];
    for (const id of a) out.push({ id, secs: 6 + r() * 6 });
  }
  return out;
}

let run = null;

function wrap(c, text, maxW) {
  const words = text.split(' '), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (c.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function frame(now) {
  if (!run) return;
  run.raf = requestAnimationFrame(frame);
  const cv = run.canvas, dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = innerWidth, h = innerHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const t = (now - run.t0) / 1000;
  let shot = run.plan[run.i % run.plan.length];
  if (t > shot.secs) { run.i++; run.t0 = now; shot = run.plan[run.i % run.plan.length]; }
  const g = run.games.find(x => x.id === shot.id) || run.games[0];
  const u = Math.min(1, ((now - run.t0) / 1000) / 0.9);   // fade in
  const v = Math.max(0, Math.min(1, (shot.secs - (now - run.t0) / 1000) / 0.7)); // fade out
  const a = Math.min(u, v);
  c.fillStyle = '#07080b'; c.fillRect(0, 0, w, h);
  const band = plateBand(h);
  const top = band ? band.t : 0, bot = band ? band.b : 0;
  const bh = h - top - bot, cw = Math.min(w * 0.82, bh * 1.7, 980), ch = Math.min(bh * 0.8, cw * 0.56);
  const x = (w - cw) / 2, y = top + (bh - ch) / 2;
  // drift: a slow push-in, slower when calm
  const s = 1 + 0.03 * (1 - run.calm * 0.5) * ((now - run.t0) / 1000) / shot.secs;
  c.save();
  c.translate(w / 2, y + ch / 2); c.scale(s, s); c.translate(-w / 2, -(y + ch / 2));
  c.globalAlpha = a;
  c.fillStyle = '#121520'; c.fillRect(x, y, cw, ch);
  c.fillStyle = g.accent; c.fillRect(x, y, Math.max(8, cw * 0.018), ch);
  const pad = cw * 0.07, tx = x + pad, maxW = cw - pad * 1.6;
  c.textBaseline = 'alphabetic';
  c.fillStyle = g.accent;
  c.font = '600 ' + Math.round(ch * 0.055) + 'px ui-monospace, Menlo, monospace';
  c.fillText((g.year + ' · ' + g.maker).toUpperCase(), tx, y + ch * 0.2);
  c.fillStyle = '#ecebe6';
  const big = Math.round(ch * (g.title.length > 22 ? 0.12 : 0.17));
  c.font = big + 'px "STIX Two Text", Georgia, serif';
  const lines = wrap(c, g.title, maxW).slice(0, 2);
  lines.forEach((l, i) => c.fillText(l, tx, y + ch * 0.2 + big * 1.15 * (i + 1)));
  c.fillStyle = '#8a8a90';
  c.font = Math.round(ch * 0.05) + 'px Inter, system-ui, sans-serif';
  const ly = y + ch * 0.2 + big * 1.15 * lines.length + ch * 0.1;
  c.fillText(g.sub + ' · ' + (g.engine === 'dos' ? 'DOSBox' : 'ScummVM'), tx, ly);
  c.font = Math.round(ch * 0.042) + 'px Inter, system-ui, sans-serif';
  wrap(c, 'Free from its owner: ' + g.licence, maxW).slice(0, 2).forEach((l, i) => c.fillText(l, tx, ly + ch * 0.08 * (i + 1)));
  c.restore();
  // scan lines over all
  c.globalAlpha = 0.07; c.fillStyle = '#000';
  for (let yy = 0; yy < h; yy += 3) c.fillRect(0, yy, w, 1);
  c.globalAlpha = 1;
}

async function gamesList() {
  const s = window.__retro && window.__retro.S;
  if (s && s.data) return s.data.games;
  const r = await fetch(new URL('games.json', import.meta.url));
  return (await r.json()).games;
}

if (typeof window !== 'undefined') {
  window.snSaver = {
    enter(o = {}) {
      if (window.__retro) window.__retro.closePlayer();
      window.snSaver.exit();
      window.snSaverActive = true;
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:200;background:#07080b;display:block';
      document.body.append(canvas);
      run = { canvas, calm: o.calm == null ? 0.5 : o.calm, games: [], plan: [], i: 0, t0: performance.now(), raf: 0 };
      const my = run;
      gamesList().then(games => {
        if (run !== my) return;
        my.games = games;
        my.plan = planReel(games.map(g => g.id), (o.seed >>> 0) || (Date.now() >>> 0));
        my.t0 = performance.now();
        my.raf = requestAnimationFrame(frame);
      }).catch(() => {});
      return { canvas, warmupMs: 400 };
    },
    exit() {
      if (!run) return;
      cancelAnimationFrame(run.raf);
      run.canvas.remove();
      run = null;
      window.snSaverActive = false;
    },
  };
}
