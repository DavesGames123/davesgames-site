// ============================================================================
//  TENSOR CALCULUS  ·  learn/refs.js  ·  the names a chapter may use  (LEARN)
// ----------------------------------------------------------------------------
//  DOM-free. A chapter beat names VIZ scenes, LIBRARY entries, OpTrace step
//  kinds, layouts and diagram styles. This file holds the lists from
//  CONTRACT.md, so tests/learn.test.mjs can reject a beat that names
//  something that does not exist. When viz/index.js and library/index.js
//  are on disk, the test also checks the names against them.
//
//  SCENE_ALIAS maps the LEARN scene name to the VIZ id when the two are
//  different. resolveScene(name, vizIds) gives the id to send to
//  tensorPage.setScene.
//
//  EXPORTS   (grep -n "^export" refs.js)
//      SCENES ......... VIZ scene ids that LEARN uses (contract list)
//      SCENE_ALIAS .... LEARN name -> VIZ id
//      ENTRIES ........ LIBRARY entry ids that LEARN opens
//      STEP_KINDS ..... OpTrace Step.kind values (contract list)
//      LAYOUTS ........ tensorPage.setView layout strings
//      STYLES ......... diagram styles
//      WIDGETS ........ inline widget types (learn/widgets/index.js)
//      resolveScene(name, vizIds)
//      resolveEntry(name, libIds) .. null when the library has no such entry
// ============================================================================

// Contract "VIZ API" scene list, with the ids of viz/registry.js SCENE_IDS.
export const SCENES = Object.freeze([
  'upper-lower',        // vector vs covector under a basis stretch
  'dual-basis',         // basis and dual basis
  'curvilinear',        // polar and spherical grids with coordinate basis vectors
  'metric-field',       // the metric as an ellipse field (Tissot)
  'outer-product',      // tensor product as an outer-product block
  'contraction',        // a block collapsing along matched axes
  'rank3-cube',         // rank-3 component cube with slices
  'transform-rank2',    // ellipsoid rotating and stretching
  'stress-cube',        // stress on a cube with traction vectors
  'inertia',            // inertia ellipsoid
  'lorentz',            // light cone and F_{mu nu} under a boost
  'parallel-transport', // parallel transport on a sphere, holonomy angle
  'geodesic-deviation', // geodesics and geodesic deviation
  'curvature-loop',     // curvature from a small loop
  'flamm',              // Flamm paraboloid of Schwarzschild
  'levi-civita',        // orientation cube
  'christoffel',        // basis-vector change along a coordinate line
  'components',         // the component array of any tensor
]);

// Filled in when VIZ commits ids that differ from the names above.
export const SCENE_ALIAS = {};

export function resolveScene(name, vizIds) {
  const id = SCENE_ALIAS[name] || name;
  if (!vizIds || !vizIds.length || vizIds.includes(id)) return id;
  // A near match: same words in another order or with a suffix.
  const words = id.split('-');
  return vizIds.find(v => words.every(w => v.includes(w))) || id;
}

// Contract "LIBRARY entry" list, one id per item that LEARN opens.
export const ENTRIES = Object.freeze([
  'kronecker-delta', 'levi-civita-cross', 'epsilon-delta', 'determinant-epsilon', 'matrix-trace',
  'tensor-product', 'dot-product-metric', 'raise-lower', 'change-of-basis', 'sym-antisym',
  'rank2-transform', 'sphere-metric', 'polar-christoffel', 'geodesic-equation',
  'covariant-derivative', 'metric-compatibility', 'parallel-transport', 'riemann-tensor',
  'ricci-scalar', 'bianchi-identity', 'killing-equation', 'geodesic-deviation', 'divergence-theorem',
  // contract names that library/index.js does not hold yet
  'einstein-field-equations', 'schwarzschild', 'flrw', 'lorentz-transformation', 'maxwell-tensor',
  'maxwell-equations', 'em-stress-energy', 'perfect-fluid', 'cauchy-stress', 'strain', 'hooke',
  'inertia-tensor', 'quadrupole', 'weyl', 'einsum-attention',
]);

export const ENTRY_ALIAS = {};
export function resolveEntry(name, libIds) {
  const id = ENTRY_ALIAS[name] || name;
  if (!libIds || !libIds.length || libIds.includes(id)) return id;
  const words = id.split('-');
  return libIds.find(v => words.every(w => v.includes(w))) || null;
}

export const STEP_KINDS = Object.freeze(['product', 'contract', 'raise', 'lower', 'transform', 'symmetrize',
  'antisymmetrize', 'partial', 'covariant', 'christoffel', 'trace', 'expandSum', 'substitute', 'relabel', 'evaluate']);

export const LAYOUTS = Object.freeze(['all', 'tex', 'viz', 'diagram']);
export const STYLES = Object.freeze(['penrose', 'birdtrack', 'network']);

export const WIDGETS = Object.freeze(['basis-drag', 'stretch', 'sum-expand', 'quiz', 'raise-lower',
  'outer-product', 'rotate-rank2', 'count', 'christoffel-polar', 'holonomy', 'notation']);
