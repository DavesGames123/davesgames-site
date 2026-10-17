// ============================================================================
//  library/paths.js  ·  learning paths through the library
// ----------------------------------------------------------------------------
//  A path is an ordered list of entry ids with a one-line reason for each
//  step. CORE's library browser shows paths next to the fields; LEARN and
//  SAVER can play a path entry by entry. Tests check that every id exists.
//
//  PATHS ......... [{ id, title, blurb, steps: [id], why: { id: sentence } }]
// ============================================================================
const path = (id, title, blurb, list) => ({ id, title, blurb, steps: list.map(s => s[0]), why: Object.fromEntries(list) });

export const PATHS = [
  path('indices', 'What upper and lower indices mean', 'Vectors against covectors, the metric that converts them, and the rule that keeps sums basis-free.', [
    ['change-of-basis', 'Stretch the basis: arrows shrink, plane stacks squeeze.'],
    ['raise-lower', 'The same arrow, two sets of components.'],
    ['dot-product-metric', 'The metric turns components into lengths.'],
    ['tensor-product', 'Build a (1,1) tensor from a vector and a covector.'],
    ['matrix-trace', 'Why only up-down contractions are invariant.'],
    ['rank2-transform', 'One Jacobian per index.'],
  ]),
  path('dot-to-einstein', 'From dot product to Einstein', 'Every step adds one idea, from a dot product in a skewed basis to the field equations of gravity.', [
    ['dot-product-metric', 'Lengths need a metric.'],
    ['sphere-metric', 'On a curved surface the metric changes from point to point.'],
    ['polar-christoffel', 'Curved coordinates make basis vectors turn.'],
    ['covariant-derivative', 'Derivatives that remove the turning of the basis.'],
    ['parallel-transport', 'Carry a vector round a loop: it comes back turned.'],
    ['riemann-tensor', 'The turning per unit loop area.'],
    ['ricci-scalar', 'Contract Riemann: volume change and one number per point.'],
    ['bianchi-identity', 'The identity that makes Einstein\'s tensor conserved.'],
  ]),
  path('epsilon', 'Epsilon, orientation and volume', 'The Levi-Civita symbol from cross products to determinants.', [
    ['kronecker-delta', 'The identity tensor and the trace that counts dimensions.'],
    ['levi-civita-cross', 'Epsilon eats two vectors and gives an oriented plane.'],
    ['epsilon-delta', 'Two epsilons collapse into deltas.'],
    ['determinant-epsilon', 'Epsilon measures how a map scales volume.'],
    ['sym-antisym', 'Antisymmetric tensors in 3D are vectors in disguise.'],
  ]),
  path('curvature', 'Curvature you can feel', 'Geodesics, tides and symmetries on curved surfaces.', [
    ['geodesic-equation', 'The straightest paths.'],
    ['geodesic-deviation', 'Neighbouring geodesics bend together.'],
    ['killing-equation', 'Directions that keep the metric.'],
    ['metric-compatibility', 'Why transport keeps lengths.'],
    ['divergence-theorem', 'From a local divergence to a global flux.'],
  ]),
];
