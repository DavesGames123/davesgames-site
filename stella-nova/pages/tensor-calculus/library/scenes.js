// ============================================================================
//  library/scenes.js  ·  the VIZ scenes that library entries ask for
// ----------------------------------------------------------------------------
//  Entries name scenes with LIBRARY ids (left column), one per scene of the
//  CONTRACT.md "VIZ API" list. toViz() turns a LIBRARY hint into the hint
//  that viz/index.js reads: the VIZ scene id (viz/registry.js SCENE_IDS)
//  and the VIZ param keys. kit.step() and index.js apply it, so every
//  Step.viz and entry.viz that leaves this package has VIZ ids. When VIZ
//  renames a scene or a param, change the table here; entries stay.
//
//  SCENES ........ [{ id, viz, contract, params }]
//  SCENE_IDS ..... Set of LIBRARY ids
//  VIZ_IDS ....... Set of the VIZ ids that toViz can give
//  toViz(hint) ... { scene, params } -> { scene: VIZ id, params: VIZ keys }
// ============================================================================
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const SCENES = [
  { id: 'vector-covector', viz: 'upper-lower', contract: 'vector vs covector under a basis stretch (arrows shrink, plane stacks squeeze)',
    map: p => ({ ...(p.stretch != null ? { s: clamp(p.stretch, 0.45, 2.2) } : {}), covector: 1 }) },
  { id: 'basis-dual', viz: 'dual-basis', contract: 'basis and dual basis',
    map: p => ({ ...(p.angle != null ? { shear: clamp(Math.abs(Math.cos(p.angle * Math.PI / 180)), 0, 1) } : {}) }) },
  { id: 'curvilinear-grid', viz: 'curvilinear', contract: 'curvilinear grids (polar, spherical) with coordinate basis vectors',
    map: p => ({ ...(p.coords ? { system: p.coords === 'spherical' ? 'spherical' : 'polar' } : {}) }) },
  { id: 'metric-ellipses', viz: 'metric-field', contract: 'the metric as an ellipse/ellipsoid field (Tissot)', map: () => ({}) },
  { id: 'outer-product', viz: 'outer-product', contract: 'tensor product as an outer-product component block', map: p => p },
  { id: 'contraction-block', viz: 'contraction', contract: 'contraction as a block collapsing along matched axes', map: p => p },
  { id: 'component-cube', viz: 'rank3-cube', contract: 'rank-3 component cube with slices', map: p => p },
  { id: 'rank2-transform', viz: 'transform-rank2', contract: 'transformation of a rank-2 tensor (ellipsoid rotating and stretching, components updating)', map: p => p },
  { id: 'stress-cube', viz: 'stress-cube', contract: 'stress on a cube with traction vectors', map: p => p },
  { id: 'inertia-ellipsoid', viz: 'inertia', contract: 'inertia ellipsoid', map: p => p },
  { id: 'lorentz-boost', viz: 'lorentz', contract: 'Lorentz boost of the light cone and of F_{mu nu}', map: p => p },
  { id: 'parallel-transport', viz: 'parallel-transport', contract: 'parallel transport on a sphere with the holonomy angle',
    map: p => ({ path: 'latitude', ...(p.latitude != null ? { th0: clamp((90 - p.latitude) * Math.PI / 180, 0.25, 1.45) } : {}) }) },
  { id: 'geodesics', viz: 'geodesic-deviation', contract: 'geodesics and geodesic deviation', map: p => ({ surface: p.surface === 'saddle' ? 'saddle' : 'sphere' }) },
  { id: 'curvature-loop', viz: 'curvature-loop', contract: 'curvature from a small loop', map: p => ({ ...(p.size != null ? { d: clamp(p.size, 0.08, 0.9) } : {}) }) },
  { id: 'flamm-paraboloid', viz: 'flamm', contract: 'Flamm paraboloid of Schwarzschild', map: p => p },
  { id: 'levi-civita-cube', viz: 'levi-civita', contract: 'Levi-Civita orientation cube', map: p => p },
  { id: 'christoffel-basis', viz: 'christoffel', contract: 'Christoffel symbols as basis-vector change along a coordinate line',
    map: p => ({ ...(p.coords ? { surface: p.coords === 'sphere' ? 'sphere' : 'polar' } : {}), ...(p.along ? { line: p.along === 'r' ? 'r' : 'theta' } : {}) }) },
];
export const SCENE_IDS = new Set(SCENES.map(s => s.id));
export const VIZ_IDS = new Set(SCENES.map(s => s.viz));
const BY_ID = new Map(SCENES.map(s => [s.id, s]));

// A LIBRARY hint -> a VIZ hint. The LIBRARY params stay under 'lib' so a
// scene that knows them can still read them. An unknown id passes through.
export function toViz(hint) {
  if (!hint || !hint.scene) return hint;
  const s = BY_ID.get(hint.scene);
  if (!s) return hint;
  const p = hint.params || {};
  return { scene: s.viz, params: { ...s.map(p), lib: { scene: s.id, ...p } } };
}
