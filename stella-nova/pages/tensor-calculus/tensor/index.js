// ============================================================================
//  tensor/index.js  ·  MATH package public API (DOM-free, node and browser)
// ----------------------------------------------------------------------------
//  The tensor engine of the tensor-calculus page. It has no DOM access, so
//  node tests, workers and every view can import it. CONTRACT.md defines
//  the shapes TensorExpr, OpTrace and Components; this file is the one
//  entry point. Import from here, not from the inner files.
//
//  NOTATION AND EXPRESSIONS (expr.js)
//      parseIndexTex(src) -> TensorExpr      restricted TeX, TexParseError on bad input
//      toTex(expr, { colors = true, colorMap }) -> TeX with \class{iN}{sym}
//      indexColorMap(expr) -> Map(sym -> 0..7), first appearance, stable
//      validate(expr, { dim, euclidean }) -> { ok, errors, warnings, free, dummies, rank }
//      makeExpr(terms | { lhs, rhs }), idx(sym, up), fac(name, indices, opts), term(coeff, factors)
//      relabel(expr, map), cloneExpr, exprKey (structural key), symTex(sym), fmtNum(x)
//
//  COMPONENTS (tensor.js)   Components = { shape, variance: ['u'|'d'], data }
//      class Tensor(shape, variance, data)   .get(...i) .set(v, ...i) .toNested()
//          Tensor.from(x), Tensor.fromNested(arr, variance), Tensor.scalar(v)
//      product(A, B)                outer product, slots concatenate
//      contract(T, i, j, { force }) one upper and one lower slot
//      raise(T, slot, gInv), lower(T, slot, g)
//      transpose(T, perm | i, j), symmetrize(T, slots), antisymmetrize(T, slots)
//      trace(T, i = 0, j = 1, metric?)
//      einsum('ij,jk->ik', A, B, ...)  output variance from the input slots
//      transform(T, J, Jinv?)       J[a][b] = dx'^a/dx^b; upper slots use J,
//                                   lower slots use (J^-1) transposed
//      leviCivita(n, variance?), kroneckerDelta(n, variance?)
//      matInverse, matDet, matMul, permutations, indexTuples
//
//  METRICS (metrics.js)   G = c = 1, Minkowski signature (-,+,+,+)
//      METRICS: euclid2, euclid3, polar, cylindrical, spherical, sphere,
//               torus, minkowski, schwarzschild, flrw
//      each { id, label, dim, coords, coordTex, line, params, paramInfo,
//             signature, sample, g(x, F, p), embed?(x, p) }
//      getMetric(id), metricAt(m, x, p), inverseMetricAt, metricJet(m, x, p)
//      jacobianOf(f, x), COORD_MAPS, lorentzBoost(beta, axis), rotation2, rotation3
//
//  GEOMETRY (geometry.js)   signature (metric, x, params)
//      christoffel -> ['u','d','d']      riemann -> R^r_{smn} ['u','d','d','d']
//      ricci (or ricci(riemannTensor)), scalarCurvature, einsteinTensor,
//      weyl -> ['d','d','d','d'], curvatureAt (all of them at once)
//      covariantDerivative(m, field, x, { params, h })  new lower slot last
//      nablaFromPartials(Gamma, T, dT), partialDerivative(field, x, h)
//      parallelTransport(m, curve, v0, { params, steps }) -> { s, x, v, final }
//      geodesic(m, x0, v0, { params, steps, length }) -> { s, x, v, final }
//      geodesicDeviation, inner(m, x, u, v), angleBetween(m, x, u, v)
//
//  NUMERIC EVALUATION (evaluate.js)
//      evaluateExpr(expr, bindings, { dim, metric, coeffs }) -> Tensor (free slots in expr.free order)
//      expandToComponents(expr, { dim, values, bindings, coords, maxTerms }) -> { lines, tex }
//
//  OPERATION TRACES (trace.js)   OpTrace = { steps: [Step], dim, metric?, coords? }
//      traceEinstein(tex, bindings, opts)   generic: find pairs, expand, add
//      traceProduct, traceContract, traceRaise, traceLower, traceTranspose,
//      traceSymmetrize, traceAntisymmetrize, traceTrace, traceEinsum,
//      traceTransform, traceChristoffel, traceCovariant, traceRiemann,
//      traceRicci, traceEinsteinTensor, traceParallelTransport, traceGeodesic,
//      traceLeviCivita
//
//  CONVENTIONS
//      Riemann R^r_{smn} = d_m G^r_{ns} - d_n G^r_{ms} + G^r_{ml} G^l_{ns} - G^r_{nl} G^l_{ms},
//      Ricci R_{sn} = R^r_{srn}; a sphere of radius a has R = 2/a^2.
//      Spherical theta is the colatitude. Data is row-major.
// ============================================================================

export * from './expr.js';
export * from './tensor.js';
export * from './metrics.js';
export * from './geometry.js';
export { NUM, jetOps, variables } from './jet.js';
