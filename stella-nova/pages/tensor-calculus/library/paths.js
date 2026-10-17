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
    ['einstein-field-equations', 'Set the conserved curvature equal to matter.'],
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
  path('spacetime', 'Spacetime and gravity', 'Special relativity in index form, then black holes and the expanding universe.', [
    ['lorentz-boost', 'Changing frame keeps the Minkowski metric.'],
    ['four-momentum', 'Energy and momentum as one vector; the mass shell.'],
    ['perfect-fluid', 'Matter as a symmetric tensor.'],
    ['einstein-field-equations', 'Geometry equals matter.'],
    ['schwarzschild-metric', 'Curvature with no matter: a black hole.'],
    ['flrw-metric', 'The expanding universe and the Friedmann equation.'],
    ['energy-conservation', 'Why the density of the universe falls.'],
    ['weyl-tensor', 'The part of curvature that travels.'],
  ]),
  path('fields', 'Electromagnetism as a tensor', 'E and B as one antisymmetric tensor, and Maxwell\'s four equations as two.', [
    ['field-strength', 'E and B in one tensor; boosts mix them.'],
    ['maxwell-inhomogeneous', 'Sources: the divergence of F.'],
    ['maxwell-homogeneous', 'No sources: an identity of geometry.'],
    ['lorentz-force', 'F acting on a four-velocity.'],
    ['em-stress-energy', 'Energy, momentum and stress of the field.'],
    ['quadrupole-moment', 'Far fields and a traceless rank-2 tensor.'],
  ]),
  path('materials', 'Stress, strain and spinning bodies', 'Rank-2 and rank-4 tensors you can push on.', [
    ['cauchy-traction', 'The force on a cut is stress times the normal.'],
    ['principal-stress', 'Eigenvectors and invariants.'],
    ['strain-tensor', 'Stretch versus rotation.'],
    ['hooke-isotropic', 'An 81-component map with 2 numbers.'],
    ['cauchy-momentum', 'Newton\'s law for a continuum.'],
    ['inertia-tensor', 'Why L does not point along omega.'],
    ['angular-momentum-bivector', 'Angular momentum is a plane.'],
    ['kinetic-metric', 'Kinetic energy is a metric; free motion is a geodesic.'],
  ]),
  path('networks', 'Tensor networks: quantum and machine learning', 'Contraction as computation, from einsum to quantum circuits.', [
    ['einsum-matmul', 'Contraction in code, and the cost of the order.'],
    ['attention-contraction', 'A transformer layer as two contractions.'],
    ['linear-layer-gradient', 'Gradients have flipped variance.'],
    ['covariance-mahalanobis', 'The inverse covariance is a metric.'],
    ['pauli-algebra', 'Epsilon inside spin.'],
    ['dirac-clifford', 'Matrices that square to the metric.'],
    ['partial-trace', 'Tracing out a subsystem.'],
    ['circuit-network', 'A quantum circuit is a tensor network.'],
  ]),
];
