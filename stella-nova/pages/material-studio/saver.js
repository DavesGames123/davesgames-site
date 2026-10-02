// ============================================================================
//  MATERIAL STUDIO  ·  saver.js — the screensaver hook for the shell
// ────────────────────────────────────────────────────────────────────────────
//  The shell (lib/screensaver.js) calls window.snSaver.enter(opts) when this
//  page plays in screensaver mode. main.js imports this file first, so the
//  hook exists before the long boot. enter() waits for __studio.booted.
//
//  enter() hides the editor chrome and makes #viewport-wrap fill the window.
//  The viewport ResizeObserver then sizes #vp to the window. The autopilot
//  shows one material at a time on a slow turntable. Each state has a recipe
//  from MATERIAL_PRESETS, a procedural environment from env.js PRESETS and a
//  mesh, all in a seeded order. Three states play in one dwell. The view
//  exposure ramps down to -10 EV before a change and back up after the bake,
//  so the recording has a fade and no hard cut.
//
//  Saver mode only: Storage.prototype.setItem is a no-op (the viewport, the
//  bake meter and the panels save prefs on change), toasts are hidden, and no
//  Poly Haven environment ('ph:*') is used, so the loop makes no request.
//  The shell reloads the page on stop, so nothing is restored.
//
//  GREP TARGETS
//      window.snSaver ....... the hook
//      function fadeTo ...... the exposure ramp
//      function nextState ... recipe, environment and mesh change
// ============================================================================
import { store, state } from './store.js';

const MESHES = ['shaderBall', 'sphere', 'roundedCube', 'torus'];
const DARK = -10;   // EV at the bottom of a fade
const CSS = `html.ms-saver #topbar,html.ms-saver #lib-panel,html.ms-saver #side,html.ms-saver #split,html.ms-saver #graph-wrap,
html.ms-saver #maps-strip,html.ms-saver #dock,html.ms-saver #sheet,html.ms-saver #vp-hud,html.ms-saver #toast,html.ms-saver #nogpu{display:none!important}
html.ms-saver #viewport-wrap{position:fixed!important;inset:0!important;z-index:50}html.ms-saver #vp{cursor:none}`;

const wait = ms => new Promise(r => setTimeout(r, ms));
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

window.snSaver = {
  async enter(opts) {
    while (!window.__studio || !window.__studio.booted) await wait(100);
    const S = window.__studio, vp = S.viewport, cam = vp && vp.camera;
    const calm = Math.max(0, Math.min(1, +opts.calm || 0));
    let seed = (opts.seed >>> 0) || 1;
    const rng = () => { seed = (seed + 0x6D2B79F5) >>> 0; let x = Math.imul(seed ^ seed >>> 15, 1 | seed); x ^= x + Math.imul(x ^ x >>> 7, 61 | x); return ((x ^ x >>> 14) >>> 0) / 4294967296; };
    const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

    try { Storage.prototype.setItem = function () {}; } catch (e) { /* storage off */ }
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    document.documentElement.classList.add('ms-saver');

    const { PRESETS } = await import('./env.js');
    const { loadPreset } = await import('./panels/material-view.js');
    const mats = shuffle((S.presets && S.presets.MATERIAL_PRESETS) || []);
    const envs = shuffle(PRESETS.map(p => p.id));
    const meshes = shuffle(MESHES);
    const dwell = Math.max(15, (+opts.seconds || 60) / 3) * 1000, fadeMs = 1200 + 800 * calm;
    store.setView({ autoRotate: true, exposure: DARK, background: 'env' });
    if (cam) cam.autoSpeed = 0.2 - 0.12 * calm;

    function fadeTo(ev) {
      const from = +state.view.exposure || 0, t0 = performance.now();
      return new Promise(res => {
        const step = now => {
          const k = smooth((now - t0) / fadeMs);
          store.setView({ exposure: from + (ev - from) * k });
          if (k < 1) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      });
    }
    let k = 0;
    async function nextState() {
      const baked = new Promise(res => { const u1 = store.once('bake:done', () => { u2(); res(); }); const u2 = store.once('bake:error', () => { u1(); res(); }); setTimeout(res, 8000); });
      if (mats.length) loadPreset(mats[k % mats.length]);
      store.setEnv({ preset: envs[k % envs.length], rotation: Math.round(rng() * 360 - 180) });
      if (vp) vp.setMesh(meshes[k % meshes.length]);
      k++;
      await baked;
      if (vp) vp.frame();
      await wait(400);
    }
    // A slow pitch swing on top of the turntable.
    const p0 = cam ? cam.pitch : 0.28, w = 0.00012 * (1 - 0.5 * calm);
    const swing = now => { if (cam) cam.pitch = p0 + 0.14 * Math.sin(now * w); requestAnimationFrame(swing); };
    (async () => {
      for (;;) {
        const t0 = performance.now();
        await nextState();
        await fadeTo(0);
        await wait(Math.max(2000, dwell - (performance.now() - t0) - fadeMs));
        await fadeTo(DARK);
      }
    })();
    requestAnimationFrame(swing);
    return { canvas: document.getElementById('vp'), warmupMs: 3000 };
  },
};
