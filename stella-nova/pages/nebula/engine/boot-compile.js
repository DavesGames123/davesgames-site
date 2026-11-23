// boot-compile.js: start the compositor compile before main.js runs. Pass 3 bake speed (B6, L2b).
// Spec: pass3-bake-speed.md B5.1, B6 L2; nebula-spec.md 7.4.
//
// WHY: on a fresh profile the first frame waits for one compile and link of the compositor on the
// driver thread (about 1.6 s on ANGLE / D3D11 after the single PointSources call site). main.js
// starts that compile at sm:boot, after its whole module graph loads and runs (about 0.5 s cold,
// because js/data/v67-graph.js is large). This module needs only the shader text and context.js.
// index.html loads it with "async" after the canvas, so it runs as soon as its small graph is here.
//
// HOW: getContext('webgl2', GL_ATTRS) on canvas#gl, then programStart(gl, 'compositor', ...) with the
// default text (no lever defines). main.js later gets the same context from the same canvas, and its
// programStart of the same name returns at once; program() adopts the started compile.
// It does nothing when a query changes the compositor or the GL path: lever, precompile=0, webgl=0.
// Mark: sm:early-compile (performance.getEntriesByType('mark')).
//
// grep -n targets: "function earlyCompile", "GL_ATTRS".

import { GL_ATTRS, programStart } from './gl/context.js';
import { compositorSource, specOn } from './render/shaders/compositor.glsl.js';
import { compositorProgramName } from './render/compositor.js';
import { labConsts, labOffFrom } from './render/lab-consts.js';
import comp from './data/composition.js';

function earlyCompile() {
  const q = new URLSearchParams(location.search);
  // ?lab merges into the composition in main.js after this runs, so the constants here would be stale.
  if (q.has('lever') || q.has('lab') || q.get('precompile') === '0' || q.get('webgl') === '0') return;
  const canvas = document.getElementById('gl');
  if (!canvas) return;
  let gl = null;
  try { gl = canvas.getContext('webgl2', GL_ATTRS); } catch (e) { gl = null; }
  if (!gl) return;
  performance.mark('sm:early-compile');
  const spec = specOn(location.search);
  // Same default as main.js: knots are off unless ?off= sets the list (the quality presets).
  const off = /[?&]off=/.test(location.search) ? labOffFrom(location.search) : ['knots'];
  programStart(gl, compositorProgramName([], off, spec), null, compositorSource([], spec ? labConsts(comp, location.search, off) : null));
}

earlyCompile();
