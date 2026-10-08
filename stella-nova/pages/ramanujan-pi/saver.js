// ============================================================================
//  RAMANUJAN–SATO SERIES  ·  saver.js — the screensaver director (window.snSaver)
// ----------------------------------------------------------------------------
//  Protocol: lib/screensaver.js. enter(opts) { calm, seconds, caption,
//  seed, label } hides the page GUI, makes a 2D canvas in the document
//  (#rpSaver) and returns { canvas, warmupMs }.
//
//  The director plays a seeded shuffle of SHOTS, a new order each run:
//    race      the ten series draw in, one of them picked out
//    digits    the decimals of pi, fixed term by term
//    anatomy   one term taken apart while k counts up, with a slow push-in
//  A shot lasts 5 to 12 s (calm: longer), fades in and out through black,
//  and fills the clear band of the shell plate (plateBand, lib/saver-clear.js).
//  The data of the next shot loads while the current one plays.
//
//  DRAWING. Every frame draws the vectors and text of charts.js again at the
//  screen resolution. The push-in scales the context, never a raster.
//
//  PLATE. Title: the series or the race. Eqs: the colour-coded formula of
//  the series. Params: digits per term, terms, digits. Code: a short extract
//  of this page's engine.js (read from the source file).
//
//  window.snSaver.debug() gives the director state for a CDP probe, and
//  window.snSaver.cut(kind) plays a shot of that kind now.
//
//  GREP MAP
//    grep -n 'function buildShots'   the shot list
//    grep -n 'function frame'        the draw loop
//    grep -n 'function plate'        the label plate payload
//    grep -n 'async function extract'  code extracts from engine.js
//    grep -n 'window.snSaver'        the hook
// ============================================================================
import { byId } from './engine.js';
import { drawRace, drawStream, drawAnatomy, fmtInt } from './charts.js';

function mulberry(a) {
  a = (a >>> 0) || 0x9e3779b9;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => { t = clamp(t, 0, 1); return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; };
const FADE = 600;

// A short extract of engine.js: from the line that starts with `from`, to
// the end of its block, at most `lines` lines.
const SRC = {};
async function extract(from, lines = 8, fixed = false) {
  try {
    if (!SRC.e) SRC.e = await (await fetch(new URL('./engine.js', import.meta.url))).text();
    const all = SRC.e.split('\n'), i = all.findIndex(l => l.trimStart().startsWith(from));
    if (i < 0) return null;
    const out = [];
    let depth = 0;
    for (let j = i; j < all.length && out.length < lines; j++) {
      const l = all[j];
      out.push(l.replace(/\s+$/, ''));
      depth += (l.match(/[{(]/g) || []).length - (l.match(/[})]/g) || []).length;
      if (!fixed && depth <= 0 && j > i) break;
    }
    const pad = Math.min(...out.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length));
    return out.map(l => l.slice(pad)).join('\n');
  } catch (e) { return null; }
}
// [first line, name, lines, fixed]: 8 lines at most, so the code box at
// the base of the plate stays short and the clear band stays tall.
const CODE = {
  race: ['export function correctDigits', 'correctDigits · engine.js', 6],
  digits: ['const lock = new Int32Array(D);', 'lockMap · engine.js', 8, true],
  anatomy: ['export function piFromSum', 'piFromSum · engine.js', 6],
  isqrt: ['const k = big(Math.floor(bitLength(n) / 4));', 'isqrt · engine.js', 3, true],
};

export function installSaver(app) {
  let S = null;

  function buildShots(rng) {
    const pick = a => a[Math.floor(rng() * a.length)];
    const rs = app.RS.map(s => s.id), shots = [];
    for (const T of [20, 40, 120]) shots.push({ kind: 'race', T, sid: pick(rs) });
    for (const sid of ['l1a', 'l2a', 'l3a', 'l6a', 'l5a', 'machin', 'l10a']) shots.push({ kind: 'digits', sid, D: sid === 'machin' ? 150 : pick([200, 300]) });
    for (const sid of rs) shots.push({ kind: 'anatomy', sid });
    for (let i = shots.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [shots[i], shots[j]] = [shots[j], shots[i]]; }
    // no two shots of one kind in a row, where a swap can avoid it
    for (let i = 1; i < shots.length; i++) if (shots[i].kind === shots[i - 1].kind) {
      const j = shots.findIndex((s, n) => n > i && s.kind !== shots[i - 1].kind);
      if (j > 0) [shots[i], shots[j]] = [shots[j], shots[i]];
    }
    return shots;
  }
  function prep(shot) {
    shot.ready = app.load(shot.kind, shot.sid, { T: shot.T, D: shot.D }).then(d => { shot.data = d; return d; }).catch(() => null);
    return shot;
  }
  function nextShot(force) {
    const shot = force || S.queue || prep(S.shots[S.i++ % S.shots.length]);
    S.queue = null; S.shot = null;
    shot.ready.then(d => {
      if (!S) return;
      if (!d) { setTimeout(() => S && nextShot(), 50); return; }
      shot.dur = 1000 * clamp(6 + 5 * S.calm + (S.rng() * 2 - 1), 5, 12);
      shot.t0 = performance.now(); shot.lastK = -1; shot.flashAt = 0;
      shot.z0 = 1; shot.z1 = shot.kind === 'anatomy' ? 1.14 : shot.kind === 'digits' ? 1.06 : 1;
      if (shot.kind === 'anatomy') {
        // one axis for the whole shot, from the last term: the bars grow
        let lo = 0, hi = 1;
        for (const a of d) { lo = Math.min(lo, a.lt, a.ls + a.ll - a.lc); hi = Math.max(hi, a.ls + a.ll); }
        shot.range = [Math.floor(lo - (hi - lo) * 0.04 - 0.5), Math.ceil(hi + (hi - lo) * 0.04 + 0.5)];
      }
      S.shot = shot;
      plate(shot);
      S.queue = prep(S.shots[S.i++ % S.shots.length]);
    });
  }
  async function plate(shot) {
    const Sx = byId(shot.sid), c = CODE[shot.kind === 'anatomy' && S.rng() < 0.4 ? 'isqrt' : shot.kind];
    const text = await extract(c[0], c[2], c[3]);
    if (!S || S.shot !== shot) return;
    const code = text ? { lang: 'js', name: c[1], text } : null;
    shot.plate = shot.kind === 'race'
      ? { title: 'The race to π', sub: `Correct digits after each term, ten series, ${shot.T} terms`, tex: [Sx.tex], code }
      : shot.kind === 'digits'
        ? { title: Sx.name, sub: `The first ${shot.data.D} decimals of π, fixed term by term`, tex: [Sx.tex], code }
        : { title: `${Sx.name}: one term`, sub: 'Its factors on a log scale, as k counts up', tex: [Sx.tex], code };
    shot.live = '';
    live(shot);
  }
  // The live values on the plate: the same title swaps them in place.
  function live(shot, info) {
    if (!shot.plate) return;
    const Sx = byId(shot.sid);
    let params;
    if (shot.kind === 'race') {
      const n = Math.max(1, info ? info.n : 1), d = shot.data;
      const top = d.map(q => ({ id: q.id, v: q.digits[Math.min(q.digits.length, n) - 1] })).sort((a, b) => b.v - a.v).slice(0, 3);
      params = [{ name: 'terms', value: String(n) }, ...top.map(q => ({ name: byId(q.id).name, value: `${fmtInt(q.v)} digits` }))];
    } else if (shot.kind === 'digits') {
      params = [{ name: 'terms', value: `${info ? info.k : 0} of ${shot.data.K}` }, { name: 'decimals fixed', value: String(info ? info.locked : 0) }, { name: 'digits per term', value: Sx.rate.toFixed(2) }];
    } else {
      const a = info ? info.a : shot.data[0];
      params = [{ sym: 'k', value: String(a.k) }, { name: 's(k)', value: `${a.sLen} digits` }, { sym: `${a.neg ? '-' : ''}10^{${a.lt.toFixed(1)}}`, name: 'term' }];
    }
    const key = JSON.stringify(params);
    if (key === shot.live) return;
    shot.live = key;
    S.label(Object.assign({}, shot.plate, { params }));
  }
  function rect() {
    // the plate column: the full width, or the 9:16 column in the middle
    const W = innerWidth, H = innerHeight, b = S.band, cw = b && b.w ? Math.min(W, b.w) : W;
    const t = b ? b.t : H * 0.2, bot = b ? b.b : H * 0.2, side = Math.max(16, cw * 0.05);
    const h = Math.max(160, H - t - bot);
    return { x: (W - cw) / 2 + side, y: b ? t : (H - h) / 2, w: cw - 2 * side, h };
  }
  function frame(now) {
    if (!S) return;
    S.raf = requestAnimationFrame(frame);
    if (S.bandFn && now - S.bandAt > 300) { S.bandAt = now; const b = S.bandFn(innerHeight); if (b) S.band = b; }
    const c = S.canvas, dpr = Math.min(2, devicePixelRatio || 1), cw = Math.round(innerWidth * dpr), ch = Math.round(innerHeight * dpr);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#07080d'; g.fillRect(0, 0, cw, ch);
    const shot = S.shot;
    if (!shot) return;
    const el = now - shot.t0, u = el / shot.dur, band = rect();
    // Push-in: the chart is laid out in the band shrunk by 1/z1 and then
    // scaled up to z (a transform, the vectors drawn again), so at the end
    // it fills the band and never reaches the plate text. Clip to the band.
    const cx = band.x + band.w / 2, cy = band.y + band.h / 2;
    const r = { x: cx - band.w / shot.z1 / 2, y: cy - band.h / shot.z1 / 2, w: band.w / shot.z1, h: band.h / shot.z1 };
    const z = shot.z0 + (shot.z1 - shot.z0) * ease(u);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.save(); g.beginPath(); g.rect(band.x - 4, band.y, band.w + 8, band.h); g.clip();
    g.setTransform(dpr * z, 0, 0, dpr * z, dpr * (cx - cx * z), dpr * (cy - cy * z));
    const compact = r.w < 560;
    if (shot.kind === 'race') {
      const reveal = Math.max(1, shot.T * ease(u / 0.75));
      drawRace(g, r, shot.data, { T: shot.T, sel: shot.sid, reveal, names: app.NAMES, short: app.SHORT, compact, heads: true });
      live(shot, { n: Math.floor(reveal) });
    } else if (shot.kind === 'digits') {
      const k = Math.min(shot.data.K, Math.floor(shot.data.K * ease(u / 0.8)) + 1);
      if (k !== shot.lastK) { shot.lastK = k; shot.flashAt = now; }
      const L = drawStream(g, r, shot.data, { k, flash: Math.max(0, 1 - (now - shot.flashAt) / 600) });
      live(shot, { k, locked: L.locked });
    } else {
      const K = shot.data.length - 1, k = Math.min(K, Math.floor((K + 1) * clamp(u / 0.85, 0, 1)));
      drawAnatomy(g, r, shot.data, { k, rate: byId(shot.sid).rate, compact, range: shot.range });
      live(shot, { a: shot.data[k] });
    }
    g.restore();
    // fades through black
    const a = el < FADE ? 1 - el / FADE : el > shot.dur - FADE ? (el - (shot.dur - FADE)) / FADE : 0;
    if (a > 0) { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = clamp(a, 0, 1); g.fillStyle = '#07080d'; g.fillRect(0, 0, cw, ch); g.globalAlpha = 1; }
    if (el >= shot.dur) nextShot();
  }

  window.snSaver = {
    enter(o = {}) {
      if (S) this.exit();
      // Stop the page's own play first: its frame loop ends while the
      // saver runs, and the button would show Pause after exit.
      if (app.st.playing && app.setPlaying) app.setPlaying(false);
      app.st.saver = true;
      const calm = clamp(o.calm ?? 0.7, 0, 1), rng = mulberry((o.seed >>> 0) || ((Date.now() & 0xffffff) + 1));
      const st = document.createElement('style'); st.id = 'rpSaverStyle';
      st.textContent = '.topbar,#panel,#dock,#gear,#stage,#toast{display:none!important}html,body{cursor:none}' +
        '#rpSaver{position:fixed;inset:0;width:100vw;height:100vh;display:block;z-index:100;background:#07080d}';
      document.head.append(st);
      const canvas = document.createElement('canvas'); canvas.id = 'rpSaver';
      document.body.append(canvas);
      S = { calm, rng, shots: buildShots(rng), i: 0, canvas, style: st, label: typeof o.label === 'function' ? o.label : () => {},
        band: null, bandFn: null, bandAt: 0, shot: null, queue: null };
      import('../../lib/saver-clear.js').then(m => { if (S) S.bandFn = m.plateBand; }).catch(() => { /* no shell: the centre band */ });
      nextShot();
      S.raf = requestAnimationFrame(frame);
      return { canvas, warmupMs: 1200 };
    },
    exit() {
      if (!S) return;
      cancelAnimationFrame(S.raf);
      try { S.label(null); } catch (e) { /* the shell is gone */ }
      S.canvas.remove(); S.style.remove();
      S = null;
      app.st.saver = false;
      app.layout();
    },
    debug() { return S && S.shot ? { kind: S.shot.kind, sid: S.shot.sid, T: S.shot.T, D: S.shot.D, t: Math.round(performance.now() - S.shot.t0), dur: Math.round(S.shot.dur), band: S.band, order: S.shots.map(s => s.kind[0] + ':' + s.sid).join(' ') } : null; },
    cut(kind) {
      if (!S) return false;
      const i = S.shots.findIndex(s => s.kind === kind);
      if (i < 0) return false;
      nextShot(prep(Object.assign({}, S.shots[i])));
      return true;
    },
  };
}
