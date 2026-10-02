// app/saver.js -- window.snSaver, the screensaver autopilot for the shell.
//
// lib/screensaver.js calls snSaver.enter(opts) when the page shows in the
// screensaver. enter hides every control, label and bar, and lets the stage
// fill the window. Both panes stay: the diagram and the live fold. It reads
// the pattern files of a short list once, so no fetch runs in the loop.
// Then the fold sweeps up and down at a calm speed, the 3D view turns
// slowly, and after seconds/3 the next pattern comes in at the flat end of
// a sweep, behind a fade of the canvas colour (S.veil, drawn by render).
// opts.calm (1 = slowest) sets the fold and the turn speeds. opts.seed sets
// the pattern order. It writes no storage and no URL. No exit(): the shell
// reloads the page on stop.
//
// grep map:
//   LIST          -- the patterns the autopilot shows
//   installSaver  -- set window.snSaver
//   tick          -- the turn, the hold timer and the fade

import * as patterns from '../patterns.js';
import { S, gpu } from './state.js';
import { loadPreset } from './edit.js';
import { applyLayout, resize } from './layout.js';

// Patterns that fold cleanly to a recognisable form.
const LIST = ['crane', 'kabuto', 'birdbase', 'waterbomb', 'miura', 'pinwheel', 'yakko', 'blintz', 'house', 'sailboat'];
const FADE = 0.9;   // seconds for each half of the fade

export function installSaver() {
  window.snSaver = {
    async enter(o = {}) {
      const calm = Math.max(0, Math.min(1, o.calm ?? 0.7));
      let sd = (o.seed >>> 0) || 1;
      const rnd = () => { sd = (sd + 0x6D2B79F5) >>> 0; let t = sd; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      const st = document.createElement('style');
      st.textContent = '.topbar,#status,#dock,#panel,#library,.pane-label,.pane .bar,#nogpu{display:none!important}'
        + '#stage{top:0!important;bottom:0!important;left:0!important;right:0!important}.pane{border-color:transparent!important}#gl{cursor:none}';
      document.head.appendChild(st);
      S.libraryOpen = false; S.panelOpen = false; S.cursor = null; S.drawing = null;
      applyLayout(); resize();
      // boot sets the pattern reader and the GPU; wait for them (5 s at most)
      for (let i = 0; i < 50 && !(S.mesh && gpu); i++) await new Promise((r) => setTimeout(r, 100));
      const ok = [];
      await Promise.all(LIST.map((id) => patterns.prepare(patterns.byId(id)).then(() => ok.push(id), () => {})));
      const order = LIST.filter((id) => ok.includes(id));
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      const hold = Math.max(9, (o.seconds || 60) / 3) * 1000;
      const yawRate = 0.14 * (1 - 0.6 * calm);
      const speed = 0.3 * (1 - 0.6 * calm);
      let k = 0, phase = 'in', since = performance.now(), last = since;
      const start = async () => {
        if (order.length) await loadPreset(patterns.byId(order[k++ % order.length]));
        S.foldSpeed = speed; S.fraction = 0; S.autoDir = 1; S.auto = true; S.frozen = false;
      };
      S.veil = 1;
      await start();
      // the turn, the hold timer and the fade
      const tick = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000); last = now;
        S.orbit.yaw += dt * yawRate;
        if (phase === 'show' && order.length > 1 && now - since > hold && S.autoDir === 1 && S.fraction < 0.05) { phase = 'out'; S.auto = false; }
        else if (phase === 'out') {
          S.veil = Math.min(1, S.veil + dt / FADE);
          if (S.veil >= 1) { phase = 'load'; start().then(() => { phase = 'in'; }); }
        } else if (phase === 'in') {
          S.veil = Math.max(0, S.veil - dt / FADE);
          if (S.veil <= 0) { phase = 'show'; since = now; }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return { canvas: document.getElementById('gl'), warmupMs: 1500 };
    },
  };
}
