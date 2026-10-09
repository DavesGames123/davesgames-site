// ============================================================================
//  CT EXPLAINED  ·  screensaver hook  (module)
// ----------------------------------------------------------------------------
//  Installs window.snSaver (protocol: lib/screensaver.js). It reuses the
//  hero scene: a fan-beam gantry turns once around a phantom while the
//  sinogram fills and the filtered back-projection builds. Each run
//  shuffles the phantoms and the colour maps from the seed, so no two
//  runs match. One shot is one rotation (about 9 s) plus a short hold.
//  The CT Lab has its own, larger saver (another page).
//
//  grep -n targets
//    plate text ......... "const PLATES"
//    frame loop ......... "function frame"
// ============================================================================
import { HeroScene, HERO_LIST } from './scenes-a.js';
import { PAL } from './draw.js';
import { plateBand } from '../../lib/saver-clear.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PLATES = {
  head: { title: 'A head, slice by slice', sub: 'skull, ventricles and a small bleed' },
  chest: { title: 'A chest in one turn', sub: 'lungs, heart, spine and ribs' },
  'shepp-logan-modified': { title: 'The Shepp-Logan phantom', sub: 'ten ellipses, the test object since 1974' },
  walnut: { title: 'A walnut', sub: 'shell and kernel, 5 cm across' },
  suitcase: { title: 'A suitcase at the airport', sub: 'a bottle, a laptop, keys and coins' },
  'metal-implant': { title: 'A hip with a metal implant', sub: 'steel and titanium throw dark streaks' },
};
const TEX = ['p(\\theta,s)=\\int_{L(\\theta,s)} \\mu\\,dl', '\\mu = \\int_0^{\\pi} (p_\\theta * h)(x\\cos\\theta + y\\sin\\theta)\\,d\\theta'];
const RULES = [['\\mu', 'm2'], ['p', 'm1'], ['\\theta', 'm5'], ['h', 'm3']];
const MAPS = [['bone', 'magma'], ['grey', 'inferno'], ['ice', 'magma'], ['bone', 'viridis'], ['xray-blue', 'magma'], ['grey', 'twilight']];

function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

let run = null;
window.snSaver = {
  enter(o = {}) {
    if (run) this.exit();
    const calm = clamp(o.calm == null ? 0.7 : +o.calm, 0, 1);
    const R = rng((o.seed >>> 0) || 7);
    const list = HERO_LIST.slice();
    for (let k = list.length - 1; k > 0; k--) { const j = Math.floor(R() * (k + 1)); [list[k], list[j]] = [list[j], list[k]]; }
    const maps = MAPS[Math.floor(R() * MAPS.length)];
    const css = document.createElement('style');
    css.textContent = 'html,body{overflow:hidden!important}body>*:not(#snSaverCv){visibility:hidden!important}' +
      '#snSaverCv{position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh;display:block;cursor:none;touch-action:none}';
    document.head.appendChild(css);
    const cv = document.createElement('canvas'); cv.id = 'snSaverCv';
    document.body.appendChild(cv);
    window.__ctxSaver = true;
    const scene = new HeroScene({ list, turn: 8 + 3 * calm, hold: 2.5, cmap: maps[0], sinoMap: maps[1] });
    run = { css, cv, raf: 0, last: 0, scene, shown: null, subj: null };
    const g = cv.getContext('2d');
    const frame = (now) => {
      if (!run) return;
      const dt = Math.min(0.05, run.last ? (now - run.last) / 1000 : 0.016); run.last = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = innerWidth, h = innerHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      try { scene.step(dt); } catch (e) { /* skip a bad step */ }
      const band = typeof o.label === 'function' ? plateBand(h) : null;
      const top = band ? band.t : 24, bot = band ? band.b : 24, bh = Math.max(140, h - top - bot);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = PAL.bg; g.fillRect(0, 0, w, h);
      // three panels in the band: gantry, sinogram, image (a column when tall)
      let F;
      if (w / bh > 1.7) {
        const s = Math.min(bh, (w - 80) / 3.1), gap = s * 0.05, x0 = (w - 3 * s - 2 * gap) / 2, y0 = top + (bh - s) / 2;
        F = { gantry: { x: x0, y: y0, w: s, h: s }, sino: { x: x0 + s + gap, y: y0 + s * 0.08, w: s * 0.84, h: s * 0.84 }, rec: { x: x0 + 2 * s + gap * 2 - s * 0.16, y: y0 + s * 0.08, w: s * 0.84, h: s * 0.84 } };
      } else {
        const gs = Math.min(w * 0.92, bh * 0.62), s = Math.min((w - 48) / 2, bh - gs - 16);
        const y0 = top + (bh - gs - s - 16) / 2;
        F = { gantry: { x: (w - gs) / 2, y: y0, w: gs, h: gs }, sino: { x: w / 2 - s - 8, y: y0 + gs + 16, w: s, h: s }, rec: { x: w / 2 + 8, y: y0 + gs + 16, w: s, h: s } };
      }
      try { scene.render(g, w, h, { frames: F, bare: true, rays: 64 }); } catch (e) { /* skip a bad frame */ }
      // fade at each new object
      const t = scene.t, end = scene.turn + scene.hold, f = clamp(Math.min(t, end - t) / 0.7, 0, 1);
      if (f < 1) { g.fillStyle = `rgba(5,7,12,${1 - f})`; g.fillRect(0, 0, w, h); }
      run.subj = { x: F.gantry.x + F.gantry.w / 2, y: F.gantry.y + F.gantry.h / 2, r: F.gantry.w * 0.42 };
      if (run.shown !== scene.name && typeof o.label === 'function') {
        run.shown = scene.name;
        const P = PLATES[scene.name] || { title: 'Computed tomography', sub: '' };
        try {
          o.label({
            title: P.title, sub: P.sub, tex: TEX, rules: RULES,
            params: [{ sym: '\\theta', name: 'views', value: '360 over one turn', cls: 'm5' }],
            lines: ['Fan beam, filtered back-projection', 'Algorithms after ASTRA Toolbox (van Aarle et al. 2015, 2016)'],
            anchor: () => (run && run.subj ? { ...run.subj } : null),
          });
        } catch (e) { /* the plate is optional */ }
      }
      run.raf = requestAnimationFrame(frame);
    };
    run.raf = requestAnimationFrame(frame);
    return { canvas: cv, warmupMs: 900 };
  },
  exit() {
    if (!run) return;
    cancelAnimationFrame(run.raf);
    run.cv.remove(); run.css.remove();
    run = null; window.__ctxSaver = false;
  },
};
window.snSaver.debug = () => (run ? { name: run.scene.name, t: run.scene.t, views: run.scene.done } : null);
