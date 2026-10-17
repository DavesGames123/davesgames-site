// ============================================================================
//  TENSOR CALCULUS  ·  viz/registry.js  ·  the scene list  (VIZ)
// ----------------------------------------------------------------------------
//  DOM-free. Each scene is a plain object:
//      { id, label, blurb, params: [{ key, label, min, max, step, def }],
//        camera: { pos, target, fov }, fog, frame(dl, S) }
//  frame() writes one picture into a DL (dl.js). S is
//      { p       the params: the defaults, then the caller's params.
//                A default of null means "animate it by time".
//        time    seconds of the scene clock
//        t       null in free play; 0..1 when play(step, t) drives it
//        stepKind the kind of the step being played, or null
//        step    the step (OpTrace Step), or null
//        aspect  width / height of the view }
//
//  SCENE_IDS is the binding list of the contract (CONTRACT.md, VIZ API),
//  in menu order. tests/viz.test.mjs checks it against the contract text.
//
//  EXPORTS   (grep -n "export" registry.js)
//      SCENES ......... id -> scene
//      SCENE_IDS ...... the ids in menu order
//      sceneInfo(id) .. { id, label, blurb, params, camera } (no functions)
//      paramsFor(id, p) the defaults merged with p
//      frameScene(id, dl, state)
// ============================================================================
import { upperLower, dualBasis } from './scenes/basis.js';
import { curvilinear, metricField, christoffel } from './scenes/curvi.js';
import { outerProduct, contraction, rank3Cube, components, leviCivita } from './scenes/blocks.js';
import { transformRank2, stressCube, inertia } from './scenes/continuum.js';
import { lorentz, flamm } from './scenes/spacetime.js';
import { parallelTransport, geodesicDeviation, curvatureLoop } from './scenes/sphere.js';

const LIST = [
  upperLower, dualBasis, curvilinear, metricField,
  outerProduct, contraction, rank3Cube, transformRank2,
  stressCube, inertia, lorentz, parallelTransport,
  geodesicDeviation, curvatureLoop, flamm, leviCivita,
  christoffel, components,
];

export const SCENES = Object.freeze(Object.fromEntries(LIST.map(s => [s.id, s])));
export const SCENE_IDS = Object.freeze(LIST.map(s => s.id));

export function sceneInfo(id) {
  const s = SCENES[id];
  if (!s) return null;
  return { id: s.id, label: s.label, blurb: s.blurb, params: s.params.map(q => ({ ...q })), camera: { ...s.camera } };
}

export function paramsFor(id, p = {}) {
  const s = SCENES[id], out = {};
  if (!s) return out;
  for (const q of s.params) out[q.key] = q.def;
  for (const k in p) if (p[k] !== undefined) out[k] = p[k];
  return out;
}

export function frameScene(id, dl, state = {}) {
  const s = SCENES[id] || SCENES['upper-lower'];
  dl.fog = s.fog ?? 0.035;
  const S = {
    p: paramsFor(s.id, state.params || {}),
    time: state.time || 0,
    t: state.t == null ? null : Math.max(0, Math.min(1, state.t)),
    stepKind: state.stepKind || (state.step && state.step.kind) || null,
    step: state.step || null,
    aspect: state.aspect || 1.6,
  };
  s.frame(dl, S);
  return S;
}
