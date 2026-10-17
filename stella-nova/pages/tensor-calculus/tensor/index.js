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
//      factorTex(f, { colors, colorMap, subst }), factorIndices(f) (indices, then deriv),
//      writtenIndices(f) (prefix derivative first); expr.free is in written order
//      Brackets: inside one factor on factor.sym; over several factors on
//          term.sym = [{ type, slots: [{ factor, index }], refs: [[factor, index]] }]
//          (index is a position in factorIndices). term(coeff, factors, sym),
//          normTermSym, writtenOrder(f), expandBrackets(expr) (writes them out)
//      Labels of trace steps keep their math in $...$.
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
//      T(x, variance), zeros, get, toNested, maxAbs, sub, scale, transposeM
//          (the names of library/stub-math.js, so LIBRARY can switch to MATH)
//
//  METRICS (metrics.js)   G = c = 1, Minkowski signature (-,+,+,+)
//      METRICS: euclid2, euclid3, polar, cylindrical, spherical, sphere,
//               torus, minkowski, schwarzschild, flrw
//      each { id, label, dim, coords, coordTex, line, params, paramInfo,
//             signature, sample, g(x, F, p), embed?(x, p), periodic? }
//      A metric object with g(x) only (plain numbers) also works: the
//      engine then takes its derivatives by finite differences.
//      getMetric(id), metricAt(m, x, p), inverseMetricAt, metricJet(m, x, p)
//      jacobianOf(f, x), COORD_MAPS, lorentzBoost(beta, axis), rotation2, rotation3
//
//  GEOMETRY (geometry.js)   signature (metric, x, params)
//      christoffel -> ['u','d','d']      riemann -> R^r_{smn} ['u','d','d','d']
//      ricci (or ricci(riemannTensor), ricci(m, x, riemannTensor)),
//      scalarCurvature (or scalarCurvature(m, x, ricciTensor)), einsteinTensor,
//      weyl -> ['d','d','d','d'], curvatureAt (all of them at once)
//      covariantDerivative(m, field, x, { params, h })  new lower slot last
//      nablaFromPartials(Gamma, T, dT), partialDerivative(field, x, h)
//      parallelTransport(m, curve, v0, { params, steps }) -> { s, x, v, final, V, Vs }
//      geodesic(m, x0, v0, { params, steps, length | ds | dt }) -> { s, x, v, final, xs, vs }
//      geodesicDeviation, inner(m, x, u, v), angleBetween(m, x, u, v)
//
//  NUMERIC EVALUATION (evaluate.js)
//      evaluateExpr(expr, bindings, { dim, metric, coeffs }) -> Tensor (free slots in expr.free order)
//          an equation gives { lhs, rhs, residual }; bindings['nabla:V'] binds a
//          derivative (derivative slots last); bindings['scalar:R'] a scalar R;
//          bindings['R@4'] and ['R@2'] two tensors of one name by rank
//      expandToComponents(expr, { dim, values, all, bindings, coords, maxTerms, skipZero })
//          -> { lines: [{ values, tex, texNumeric, value, terms }], tex, truncated }
//      factorTensor(f, bindings, opts), fmtVal(x)
//
//  OPERATION TRACES (trace.js)   OpTrace = { steps: [Step], dim, metric?, coords? }
//      traceEinstein(tex, bindings, opts)   generic: find pairs, expand, add
//      traceProduct, traceContract, traceRaise, traceLower, traceTranspose,
//      traceSymmetrize, traceAntisymmetrize, traceTrace, traceEinsum,
//      traceTransform, traceChristoffel, traceCovariant, traceRiemann,
//      traceRicci, traceEinsteinTensor, traceParallelTransport, traceGeodesic,
//      traceLeviCivita
//      Step.display (optional): TeX for the TeX view, for example
//      { expanded, numeric, expandedNonzero, numericNonzero } or { nonzero: [...] }.
//      Step.viz.scene uses the ids of library/scenes.js.
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
export * from './evaluate.js';
export * from './trace.js';
