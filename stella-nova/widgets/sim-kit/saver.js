// ============================================================================
//  SIM KIT SAVER  ·  widgets/sim-kit/saver.js
// ----------------------------------------------------------------------------
//  director(spec) defines window.snSaver (protocol: lib/screensaver.js) for a
//  page that mounted the sim kit. Each cut is a new shot:
//    1. the shot kind comes from a seeded bag (core.shotBag): every kind
//       plays once a pass, never the same kind twice in a row;
//    2. the scene is a fresh draw of the page randomizer (core.randomize,
//       with the page guard), then shot.scene(r, state) sets what the kind
//       needs (for example "boats only", "drum container");
//    3. the theme is a seeded pick from spec.themes, never the last one;
//    4. the camera is shot.camera(r) (the page decides what it means:
//       a zoom, a body to follow, a pan);
//    5. the plate gets title, sub, TeX and parameter values. No code.
//  A cut lasts 6-12 s (core.shotSeconds; longer when calm is high). The old
//  frame fades out over the new one (a DOM snapshot), and director.veil
//  goes 1 -> 0 over 0.7 s so a page can also fade inside its canvas (the
//  recorder sees only the canvas and the plate).
//
//  spec = {
//    kit,                       the object from ui.mount()
//    canvas(),                  the sim canvas
//    shots: [{ key, weight?, title, sub?, tex?, rules?, eq?, lines?,
//              scene?(r, state) -> state changes, camera?(r, state) -> cam,
//              params?(state) -> [{ sym, name, value, cls }], seconds? }],
//    themes?: [theme ids]       default: every dark theme of core.THEMES
//    apply(state, shot, cam),   the page loads the scene (after kit.load)
//    frame(band),               band = { x, y, w, h, W, H } in CSS px: the
//                               clear band between the plate texts
//    tick?(dt, ctx), enter?(opts), exit?()
//    credit?()                  extra plate lines (default: TMP.creditLines)
//  }
//
//  grep -n targets
//    one cut .............. "function cut("
//    band ................. "function band("
//    cross-fade ........... "function snapshot"
//    hook ................. "window.snSaver ="
// ============================================================================
import * as K from './core.js';

const CLEAR_URL = new URL('../../lib/saver-clear.js', import.meta.url).href;

export function director(spec) {
  const kit = spec.kit;
  const themes = spec.themes || K.THEMES.filter(t => t.dark).map(t => t.id);
  let on = false, opts = null, r = null, bag = null, cur = null, cam = null, timer = 0, raf = 0, last = 0, lastTheme = null;
  let saved = null, hist = [], ctx = null, xf = null, plateMod = null, bandBox = null;
  const D = { veil: 0, cam: null, shot: null, active: false };

  const calm = () => Math.max(0, Math.min(1, opts && opts.calm != null ? +opts.calm : 0.6));

  async function band() {
    if (!on) return;
    const W = innerWidth, H = innerHeight;
    if (!plateMod) plateMod = import(CLEAR_URL).catch(() => null);
    const m = await plateMod;
    let b = null;
    try { b = m && m.plateBand ? m.plateBand(H) : null; } catch (e) { b = null; }
    // The plate drops "on" while a new label fades in: keep the last band.
    if (!b && bandBox && opts && typeof opts.label === 'function') return;
    const t = b ? b.t : 0, bt = b ? b.b : 0;
    bandBox = { x: 0, y: t, w: W, h: Math.max(80, H - t - bt), W, H };
    if (spec.frame) try { spec.frame(bandBox, cam); } catch (e) { console.error(e); }
  }

  function snapshot() {
    const cv = spec.canvas && spec.canvas();
    if (!cv || !cv.width || typeof document === 'undefined') return;
    if (!xf) { xf = document.createElement('canvas'); xf.className = 'sk-xfade'; document.body.appendChild(xf); }
    xf.width = cv.width; xf.height = cv.height;
    const rc = cv.getBoundingClientRect();
    Object.assign(xf.style, { left: rc.left + 'px', top: rc.top + 'px', width: rc.width + 'px', height: rc.height + 'px' });
    try { xf.getContext('2d').drawImage(cv, 0, 0); } catch (e) { return; }
    xf.classList.remove('go'); xf.style.opacity = '1';
    // Two frames so the opacity 1 is painted before the transition starts.
    requestAnimationFrame(() => requestAnimationFrame(() => { if (xf) { xf.classList.add('go'); xf.style.opacity = '0'; } }));
  }

  function credit() {
    if (spec.credit) return spec.credit() || [];
    try { return window.TMP && window.TMP.creditLines ? window.TMP.creditLines() : []; } catch (e) { return []; }
  }

  function label(shot, state) {
    if (!opts || typeof opts.label !== 'function') return;
    const L = { title: shot.title || shot.key, sub: shot.sub || spec.sub || '' };
    if (shot.tex) { L.tex = shot.tex; if (shot.rules) L.rules = shot.rules; }
    if (shot.eq) L.eq = shot.eq;
    if (shot.params) try { L.params = shot.params(state, cam); } catch (e) { console.error(e); }
    L.lines = (typeof shot.lines === 'function' ? shot.lines(state, cam) : shot.lines || []).concat(credit());
    opts.label(L);
    setTimeout(band, 80); setTimeout(band, 750);
  }

  function cut(force, why) {
    if (!on) return;
    clearTimeout(timer);
    let key = force && spec.shots.some(s => s.key === force) ? force : bag.next();
    const shot = spec.shots.find(s => s.key === key);
    const seed = r.int(1, 999999);
    const sr = K.rng(seed);
    let st = K.randomize(kit.schema, seed, kit.state, { locks: shot.locks || [], guard: spec.guard }).state;
    if (shot.scene) { const extra = shot.scene(sr, st); if (extra) st = Object.assign({}, st, extra); }
    if (kit.schema.byKey.has('theme') && !(shot.scene && shot.keepTheme)) {
      let t = r.pick(themes); if (themes.length > 1) while (t === lastTheme) t = r.pick(themes);
      st.theme = t; lastTheme = t;
    }
    cam = shot.camera ? shot.camera(sr, st) : null;
    snapshot();
    kit.seed = seed;
    kit.load(st, 'saver');
    cur = shot; D.shot = shot.key; D.cam = cam; D.veil = 1;
    try { spec.apply && spec.apply(kit.state, shot, cam); } catch (e) { console.error(e); }
    ctx = { r: sr, calm: calm(), shot: shot.key, cam, t: 0, state: kit.state };
    label(shot, kit.state);
    band();
    const sec = shot.seconds ? K.shotSeconds(r, calm(), shot.seconds[0], shot.seconds[1]) : K.shotSeconds(r, calm());
    hist.push({ shot: shot.key, theme: kit.state.theme, seed, sec: +sec.toFixed(2), why: why || (force ? 'cut' : 'timer') }); if (hist.length > 40) hist.shift();
    if (spec.shots.length > 1 || shot.repeat) timer = setTimeout(() => cut(null), sec * 1000);
  }

  function loop(ts) {
    if (!on) return;
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0; last = ts;
    D.veil = Math.max(0, D.veil - dt / 0.7);
    if (ctx) { ctx.t += dt; if (spec.tick) try { spec.tick(dt, ctx); } catch (e) { console.error(e); } }
    raf = requestAnimationFrame(loop);
  }
  const onResize = () => band();

  window.snSaver = {
    enter(o) {
      opts = o || {}; on = true; D.active = true; kit.saver = true;
      r = K.rng((opts.seed >>> 0) || K.newSeed()); bag = K.shotBag(spec.shots, r); hist = []; lastTheme = null;
      saved = { state: Object.assign({}, kit.state), seed: kit.seed, playing: kit.playing, speed: kit.baseSpeed, slow: kit.slow, panel: kit.panelOpen };
      document.documentElement.classList.add('sk-saver');
      kit.setPanel(false); kit.setSlow(false); kit.setSpeed(1); kit.setPlaying(true);
      if (spec.enter) try { spec.enter(opts); } catch (e) { console.error(e); }
      addEventListener('resize', onResize);
      return band().then(() => { cut(null, 'enter'); last = 0; raf = requestAnimationFrame(loop); return { canvas: spec.canvas(), warmupMs: spec.warmupMs || 700 }; });
    },
    exit() {
      on = false; D.active = false; clearTimeout(timer); cancelAnimationFrame(raf); removeEventListener('resize', onResize);
      document.documentElement.classList.remove('sk-saver');
      if (xf) { xf.remove(); xf = null; }
      kit.saver = false;
      if (spec.exit) try { spec.exit(); } catch (e) { console.error(e); }
      if (saved) { kit.seed = saved.seed; kit.load(saved.state, 'saver-exit'); kit.setSpeed(saved.speed); kit.setSlow(saved.slow); kit.setPlaying(saved.playing); kit.setPanel(saved.panel); kit.refresh(); if (spec.apply) spec.apply(kit.state, null, null); }
      cam = null; D.cam = null; D.shot = null;
      if (spec.frame) spec.frame(null, null);
    },
    cut(key) { cut(key, 'cut'); },
    debug() { return { on, shot: cur && cur.key, cam, theme: kit.state.theme, seed: kit.seed, t: ctx && ctx.t, band: bandBox, shots: spec.shots.map(s => s.key), hist: hist.slice() }; },
  };
  return D;
}
