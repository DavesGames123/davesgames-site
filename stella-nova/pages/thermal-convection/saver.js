// ============================================================================
//  THERMAL CONVECTION  ·  saver.js — the screensaver (shell hook and in-page mode)
// ----------------------------------------------------------------------------
//  Two ways in, one director (director.js):
//    shell     lib/screensaver.js calls window.snSaver.enter(opts), opts =
//              { calm, seconds, caption, seed, label }. The shell draws the
//              label plate (opts.label) and this page frames the views in
//              the clear band of that plate (plateBand of
//              lib/saver-clear.js). Class sn-saver on <html>.
//    in page   the Screensaver button (id saverBtn, or ctx.button) or the
//              S key. The page goes full screen, class tc-saver goes on
//              <html>, and saver.css draws a lower-third plate: the title,
//              the shot, the momentum equation and the live Ra, Pr, Nu, t.
//              Esc, S, a click or a tap stops it.
//  In both modes the page chrome hides: style.css (package UI) or the
//  [data-saver-hide] rule of saver.css.
//
//  main.js must:
//    1. import { installSaver } from './saver.js' and call
//       installSaver({ app, canvas, layout: layoutRects, fitBlock, resize,
//       loadText }) once after boot (layoutRects and fitBlock from
//       render/layout.js and render/orbit.js).
//    2. call saver.tick(dt) each frame before it renders. When tick
//       returns true, the saver has written app.rects, the slice and the
//       block camera: main.js renders with app.rects and skips its own
//       layout for that frame.
//    3. give app.applyPreset, setView, setSlice, reset and (for warm
//       starts) app.prewarm(tff): run the field for tff free-fall times
//       before the next frames show it.
//
//  Exports:
//    shellLabel(app, shot, code) -> the poster payload of the shell
//    installSaver(ctx) -> saver
//      saver.enter(opts) -> { canvas, warmupMs }, saver.exit(),
//      saver.toggle(), saver.active, saver.shell, saver.tick(dt) -> bool,
//      saver.cut(key), saver.debug()
//      It also sets globalThis.snSaver = { enter, exit, cut, debug }.
//
//  grep -n targets: "export function shellLabel", "export function installSaver",
//  "function frame", "function plate", "function loadCode", "── KEYS"
// ============================================================================
import { createDirector, labelParams, TEX, RULES, EQ, CODE_PLACEHOLDER, CODE_SOURCE, extractWgsl } from './director.js';
import { plateBand } from '../../lib/saver-clear.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TITLE = 'Thermal Convection';

// The shell poster: title, the shot, the two equations, the live
// parameters and a short WGSL extract.
export function shellLabel(app, shot, code) {
  const c = code || CODE_PLACEHOLDER;
  return {
    title: TITLE,
    sub: shot ? shot.sub : 'Boussinesq convection, heated from below',
    tex: TEX.slice(), rules: RULES, eq: EQ.slice(),
    params: labelParams(app),
    code: { lang: 'wgsl', name: c.name, text: c.text },
  };
}

const PLATE_HTML = `
  <div class="tcs-bar"></div>
  <div class="tcs-main">
    <div class="tcs-head"><span class="tcs-title"></span><span class="tcs-sub"></span></div>
    <div class="tcs-eq"></div>
    <div class="tcs-params"></div>
  </div>`;

export function installSaver(ctx) {
  const app = ctx.app;
  const doc = document, root = doc.documentElement;
  let run = null, plateEl = null, hintEl = null, code = null, codeTried = false;

  const resize = () => requestAnimationFrame(() => {
    try { if (typeof ctx.resize === 'function') ctx.resize(); } catch (e) { console.warn(e); }
  });

  // ── the real WGSL extract (CODE_SOURCE), once; else the placeholder ──
  function loadCode() {
    if (codeTried) return;
    codeTried = true;
    const load = ctx.loadText || (typeof fetch === 'function' ? (u => fetch(new URL(u, import.meta.url)).then(r => (r.ok ? r.text() : null))) : null);
    if (!load) return;
    try {
      Promise.resolve(load(CODE_SOURCE.url)).then(src => {
        const text = src ? extractWgsl(src, CODE_SOURCE.marker) : null;
        if (text) code = { lang: 'wgsl', name: CODE_SOURCE.name, text };
      }).catch(() => {});
    } catch { /* no source: keep the placeholder */ }
  }

  function ensurePlate() {
    if (plateEl) return plateEl;
    plateEl = doc.createElement('div');
    plateEl.id = 'tcSaverPlate';
    plateEl.className = 'tcs-plate';
    plateEl.hidden = true;
    plateEl.setAttribute('aria-live', 'off');
    plateEl.innerHTML = PLATE_HTML;
    hintEl = doc.createElement('div');
    hintEl.id = 'tcSaverHint';
    hintEl.className = 'tcs-hint';
    hintEl.hidden = true;
    hintEl.textContent = 'Esc, S or a click stops the screensaver';
    doc.body.append(plateEl, hintEl);
    return plateEl;
  }

  // The frame and its clear band: the shell plate band, or the space above
  // the in-page lower third.
  function frame() {
    const W = innerWidth, H = innerHeight;
    if (!run) return { W, H, band: null };
    if (run.shell) {
      let pb = null;
      try { pb = (ctx.plateBand || plateBand)(H); } catch { pb = null; }
      if (pb) run.lastBand = pb;
      return { W, H, band: run.lastBand || { t: H * 0.24, b: H * 0.3, w: W } };
    }
    const r = plateEl && !plateEl.hidden ? plateEl.getBoundingClientRect() : null;
    const b = r && r.height > 0 ? H - r.top + 12 : H * 0.26;
    return { W, H, band: { t: Math.max(16, H * 0.05), b, w: W } };
  }

  function plate(cut) {
    if (!run) return;
    const shot = run.director.shot;
    if (run.shell) {
      if (run.label) try { run.label(shellLabel(app, shot, code)); } catch (e) { console.warn(e); }
      return;
    }
    const el = ensurePlate(), q = c => el.querySelector(c);
    const pp = labelParams(app);
    const sub = shot ? shot.sub : '';
    q('.tcs-params').textContent = pp.map(p => `${p.sym.replace(/\\mathrm\{(\w+)\}/, '$1')} = ${p.value}`).join('   ·   ');
    const write = () => {
      q('.tcs-title').textContent = TITLE;
      q('.tcs-sub').textContent = sub;
      q('.tcs-eq').textContent = EQ[0];
    };
    if (cut && run.plateSub !== sub) {
      run.plateSub = sub;
      el.classList.add('swap');
      clearTimeout(run.swapT);
      run.swapT = setTimeout(() => { write(); el.classList.remove('swap'); }, 380);
    } else if (!el.classList.contains('swap')) write();
  }

  // ── TICK ── main.js calls tick(dt) every frame; true while the saver runs.
  function tick(dt) {
    if (!run) return false;
    const before = run.director.shot;
    run.director.tick(dt);
    if (run.director.shot !== before) plate(true);
    return true;
  }

  // ── KEYS ──
  function onKey(e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable)) return;
    if (run && run.shell) return;
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); saver.toggle(); }
    else if (run && e.key === 'Escape') { e.preventDefault(); saver.exit(); }
  }
  // The tap that stops the saver ends there: its click must not reach the
  // stage (that would draw a new slice line) or a button under it.
  let eatUntil = 0;
  function eatClick(e) {
    removeEventListener('click', eatClick, true);
    if (performance.now() > eatUntil) return;
    e.preventDefault(); e.stopPropagation();
  }
  function onPointer(e) {
    if (!run || run.shell || performance.now() - run.at < 600) return;
    e.preventDefault(); e.stopPropagation();
    eatUntil = performance.now() + 1000;
    addEventListener('click', eatClick, true);
    saver.exit();
  }
  function onMove() {
    if (!run || run.shell || !hintEl) return;
    hintEl.hidden = false; hintEl.classList.add('on');
    clearTimeout(run.hintT);
    run.hintT = setTimeout(() => hintEl && hintEl.classList.remove('on'), 1800);
  }
  function onFullscreen() { if (run && !run.shell && run.wentFull && !doc.fullscreenElement) saver.exit(); }

  addEventListener('keydown', onKey);
  const btn = ctx.button || (doc.getElementById ? doc.getElementById('saverBtn') : null);
  if (btn && btn.addEventListener) btn.addEventListener('click', e => { if (e && e.preventDefault) e.preventDefault(); saver.toggle(); });

  const snap = () => ({
    view: app.view, palette: app.palette, slice: app.slice ? { ...app.slice } : null,
    surfaceZ: app.surfaceZ, zScale: app.zScale, toggles: app.toggles ? { ...app.toggles } : null,
    cam: app.cam ? { ...app.cam } : app.cam, preset: app.preset,
    params: app.params ? JSON.parse(JSON.stringify(app.params)) : null,
  });

  const saver = {
    get active() { return !!run; },
    get shell() { return !!(run && run.shell); },
    enter(opts = {}) {
      if (run) saver.exit();
      const shell = typeof opts.label === 'function' || !!opts.shell;
      const seed = (opts.seed >>> 0) || ((Math.random() * 2 ** 32) >>> 0) || 1;
      const calm = clamp(opts.calm ?? 0.7, 0, 1);
      run = {
        shell, label: typeof opts.label === 'function' ? opts.label : null, seed, calm,
        at: performance.now(), lastBand: null, saved: snap(), plateSub: null, director: null,
      };
      run.director = createDirector(app, { seed, calm, layout: ctx.layout, fitBlock: ctx.fitBlock, frame });
      app.saver = true;
      root.classList.add(shell ? 'sn-saver' : 'tc-saver');
      if (!shell) {
        const el = ensurePlate();
        el.hidden = false; el.classList.remove('swap');
        requestAnimationFrame(() => el.classList.add('on'));
        if (doc.fullscreenEnabled && !doc.fullscreenElement && root.requestFullscreen) {
          root.requestFullscreen().then(() => { if (run) run.wentFull = true; }).catch(() => {});
        }
        addEventListener('pointerdown', onPointer, true);
        addEventListener('pointermove', onMove);
        doc.addEventListener('fullscreenchange', onFullscreen);
      }
      loadCode();
      run.plateTimer = setInterval(() => plate(false), shell ? 1000 : 500);
      resize();
      if (typeof ctx.onEnter === 'function') try { ctx.onEnter(run); } catch (e) { console.warn(e); }
      // the first shot pre-runs its field: give the recorder time
      return { canvas: ctx.canvas, warmupMs: 2500 };
    },
    exit() {
      if (!run) return;
      const r = run;
      run = null;
      r.director.stop();
      clearInterval(r.plateTimer); clearTimeout(r.swapT); clearTimeout(r.hintT);
      root.classList.remove('sn-saver', 'tc-saver');
      removeEventListener('pointerdown', onPointer, true);
      removeEventListener('pointermove', onMove);
      doc.removeEventListener('fullscreenchange', onFullscreen);
      if (plateEl) { plateEl.classList.remove('on', 'swap'); plateEl.hidden = true; }
      if (hintEl) { hintEl.classList.remove('on'); hintEl.hidden = true; }
      if (r.label) try { r.label(null); } catch { /* shell gone */ }
      if (r.wentFull && doc.fullscreenElement) doc.exitFullscreen().catch(() => {});
      // restore the user's look; the field keeps running (no reset)
      const s = r.saved;
      try {
        if (s.params) { app.params = s.params; if (app.sim && typeof app.sim.set === 'function') app.sim.set(s.params); }
        if (s.preset !== undefined) app.preset = s.preset;
        Object.assign(app, { palette: s.palette, surfaceZ: s.surfaceZ, zScale: s.zScale, cam: s.cam });
        if (s.toggles) app.toggles = s.toggles;
        if (app.views && typeof app.views.set === 'function') {
          app.views.set({ palette: s.palette, surfaceZ: s.surfaceZ, zScale: s.zScale, sliceLine: true, ...(s.toggles || {}), ...(s.cam ? { cam: s.cam } : {}) });
        }
        if (typeof app.setView === 'function' && s.view) app.setView(s.view);
        if (typeof app.setSlice === 'function' && s.slice) app.setSlice(s.slice);
      } catch (e) { console.warn(e); }
      app.saver = false;
      resize();
      if (typeof ctx.onExit === 'function') try { ctx.onExit(); } catch (e) { console.warn(e); }
    },
    toggle() { if (run) saver.exit(); else saver.enter({}); },
    tick,
    // the next shot of a kind or key ('granulation', 'plume', 'soup-pot', ...)
    cut(key) {
      if (!run) return false;
      const done = run.director.cut(key);
      if (done) plate(true);
      return done;
    },
    debug() {
      if (!run) return null;
      return { shell: run.shell, frame: frame(), code: code ? code.name : 'placeholder', ...run.director.debug() };
    },
  };

  globalThis.snSaver = {
    enter: opts => saver.enter(opts),
    exit: () => saver.exit(),
    cut: key => saver.cut(key),
    debug: () => saver.debug(),
  };
  return saver;
}
