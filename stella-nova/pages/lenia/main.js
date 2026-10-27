/* ============================================================================
   LENIA  ·  main script  (ES module)
   ----------------------------------------------------------------------------
   engine.js steps and draws the world on the GPU. This script loads the
   catalog, builds the controls, and sends each change to the engine. It does
   no simulation work itself.

   DATA PATH
     creatures.json ──> selectCreature ──> engine.setRule, engine.stamp
     rule slider    ──> engine.setRule({m | s | T})          (live uniform)
     scale slider   ──> engine.setRule({R}) and a new stamp at that scale
     pointer        ──> worldXY ──> engine.stamp(patch, x, y, 'set' | 'erase')
     frame          ──> engine.step(n) ──> engine.render()
                    ──> every 6th frame engine.stats() ──> status, follow

   WORLD SIZE. The short side of the world is the World select (96 to 384)
   times the Detail select (1 to 3). The long side follows the canvas aspect,
   so the world fills the screen at zoom 1 on a phone in portrait and on a
   wide monitor. Detail also multiplies the R of every creature and the size
   of its start cells, so a creature keeps its size on the screen and gets
   more cells. The default is 2 on desktop and 1.5 on phones.
   A creature flagged fixed in creatures.json always runs at detail 1.

   NO WEBGPU. If createEngine fails, the page keeps the catalog, the plots and
   the About text, and shows #nogpu.

   MODULES (app/). One concern per file. Each file opens with a GREP MAP.
     app/state.js          S, the media queries, $, toast, det
     app/catalog.js        family, start cells, rotate, palette lut (pure)
     app/tex.js            the TeX and plate text of the rule (pure)
     app/torus.js          wrap, wrapDelta (pure)
     app/creature.js       selectCreature, placeCreature, soup
     app/rule.js           the m, s, T and scale sliders
     app/plots.js          the kernel and growth plots
     app/equations.js      the MathJax lines for the current rule
     app/browser.js        the grouped, searchable catalog
     app/controls.js       the static controls, the panel, the sheet, the dock
     app/world.js          world size, canvas px ratio, worldXY, occlusion
     app/frame.js          the render loop and the follow camera
     app/pointer.js        tools, zoom and pan
     app/keys.js           keyboard shortcuts
     app/saver/director.js window.snSaver, the screensaver scenes and shots
     app/saver/label.js    the saver label plate and its anchor
     app/saver/grid.js     the saver tracker grid and seeded random (pure)

   GREP MAP
     grep -n 'function boot'            load order and the first creature
     grep -rn 'window.snSaver' app      the shell screensaver hook
   ========================================================================== */
import { createEngine } from './engine.js';
import { $, PHONE_Q, FINE_Q, LS_KEY, DEFAULT_CODE, S, lsGet, toast } from './app/state.js';
import { selectCreature } from './app/creature.js';
import { buildBrowser } from './app/browser.js';
import { buildStatic, pushView } from './app/controls.js';
import { sizeWorld, observeSize } from './app/world.js';
import { frame } from './app/frame.js';
import { bindPointer } from './app/pointer.js';
import './app/saver/director.js';

async function boot() {
  buildStatic();
  let doc;
  try {
    doc = await (await fetch('creatures.json')).json();
  } catch (e) {
    toast('The catalog did not load: ' + e.message, true, 8000);
    return;
  }
  S.creatures = doc.creatures;
  buildBrowser();

  const mobile = PHONE_Q.matches || !FINE_Q.matches;
  S.worldShort = mobile ? 96 : 128;
  S.detail = mobile ? 1.5 : 2;
  $('worldSel').value = String(S.worldShort);
  $('detailSel').value = String(S.detail);
  try {
    S.engine = await createEngine($('gl'), { mobile });
    S.engine.onLost = () => toast('The GPU device was lost. Reload the page to start again.', true, 10000);
  } catch (e) {
    console.warn('[lenia] no engine', e);
    S.gpu = false;
    document.body.classList.add('nogpu');
    $('nogpu').hidden = false;
  }
  if (S.engine) {
    observeSize();
    sizeWorld();
    bindPointer();
    pushView();
  }
  const saved = lsGet(LS_KEY);
  let i = S.creatures.findIndex(c => c.code === saved);
  if (i < 0) i = S.creatures.findIndex(c => c.code === DEFAULT_CODE);
  selectCreature(Math.max(0, i));
  requestAnimationFrame(frame);
}

boot();
