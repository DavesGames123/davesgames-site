// ============================================================================
//  library/entries-ml.js  ·  tensor contraction in machine learning
// ----------------------------------------------------------------------------
//  Machine learning code has no metric and writes every index the same way
//  (numpy einsum). These entries put the indices where the geometry says
//  they belong (features of an input up, weights that eat them down) and
//  say when the difference matters: when features change units or basis.
//
//  ENTRIES   (grep -n "id: '<id>'" entries-ml.js)
//      einsum-matmul  attention-contraction  linear-layer-gradient
//      covariance-mahalanobis
// ============================================================================
import * as M from './math.js';
import { step, trace, check, P, num, vecTex, matTex, comp, wp, VASWANI, BRIDGEMAN, PENROSE } from './kit.js';

const r = String.raw;
const BISHOP = { text: 'C. M. Bishop, Pattern Recognition and Machine Learning (2006)', url: 'https://www.microsoft.com/en-us/research/publication/pattern-recognition-machine-learning/' };

// Deterministic small matrices from a seed.
function mat(rows, cols, seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => +(2 * rnd()).toFixed(3)));
}

export const ML = [
  // --------------------------------------------------------------------------
  {
    id: 'einsum-matmul', title: 'Einsum: matrix products as contractions', field: 'ml',
    tex: r`C^{i}{}_{k} = A^{i}{}_{j}\,B^{j}{}_{k} \quad\leftrightarrow\quad \texttt{einsum('ij,jk->ik', A, B)}, \qquad D^{i}{}_{l} = A^{i}{}_{j}B^{j}{}_{k}E^{k}{}_{l}`,
    itex: r`C^{i}{}_{k} = A^{i}{}_{j} B^{j}{}_{k}`,
    shape: { rank: 2, variance: 'ud', symmetries: 'none', independent: 'n m' },
    story: [
      r`Matrix multiplication is a contraction: the column index of $A$ is joined to the row index of $B$ and summed. Einstein's notation and numpy's einsum are the same idea: name every axis with a letter, and a letter that appears in two inputs and not in the output is summed. $\texttt{'ij,jk->ik'}$ is $A^{i}{}_{j}B^{j}{}_{k}$.`,
      r`Einsum has no metric and no up or down, so it will happily sum two "lower" indices. That is fine in an orthonormal basis, where the metric is the identity, and it is the source of quiet bugs when the axes mean different things. Writing the variance down (rows up, columns down for a map) makes the shapes check themselves: only an up index can meet a down index.`,
      r`With three matrices the result is the same in any contraction order, but the work is not: $(AB)E$ costs $n_{i}n_{j}n_{k} + n_{i}n_{k}n_{l}$ multiplications and $A(BE)$ costs $n_{j}n_{k}n_{l} + n_{i}n_{j}n_{l}$. For a vector at the end the difference is a factor of the matrix size, which is why backpropagation runs right to left. Libraries such as opt_einsum search for the cheapest order of large networks.`,
      r`In the Penrose diagram a matrix is a node with one leg up and one down, a product is two nodes joined by one line, and the trace of a product is a closed loop. The cyclic property $\operatorname{tr}(ABE) = \operatorname{tr}(EAB)$ is just sliding nodes round the loop.`,
    ],
    vocab: [
      { term: 'einsum', meaning: 'Einstein summation in code: letters name axes, repeated letters are summed.' },
      { term: 'contraction order', meaning: 'The sequence of pairwise products; it changes the cost, not the result.' },
      { term: 'FLOPs', meaning: 'Floating-point operations, the measure of cost.' },
    ],
    params: [
      { key: 'n', label: 'Inner size j', min: 2, max: 8, step: 1, def: 4 },
      { key: 'k', label: 'Inner size k', min: 2, max: 8, step: 1, def: 6 },
      { key: 'l', label: 'Output columns l', min: 1, max: 8, step: 1, def: 1 },
    ],
    trace(params) {
      const p = P(this.params, params), ni = 3, nj = Math.round(p.n), nk = Math.round(p.k), nl = Math.round(p.l);
      const Am = mat(ni, nj, 1), Bm = mat(nj, nk, 2), Em = mat(nk, nl, 3);
      const A = M.T(Am, ['u', 'd']), B = M.T(Bm, ['u', 'd']), E = M.T(Em, ['u', 'd']);
      const C = M.einsum('ij,jk->ik', A, B), D1 = M.einsum('ik,kl->il', C, E), D2 = M.einsum('ij,jl->il', A, M.einsum('jk,kl->jl', B, E));
      const direct = M.matMul(M.matMul(Am, Bm), Em);
      const costL = ni * nj * nk + ni * nk * nl, costR = nj * nk * nl + ni * nj * nl;
      return trace([
        step('product', 'Stack A and B: every pair of components.', r`A^{i}{}_{j}`, r`A^{i}{}_{j} B^{m}{}_{k}`, { focus: ['j', 'm'], viz: { scene: 'outer-product', params: {} } }),
        step('contract', 'Join the column of A to the row of B and sum.', r`A^{i}{}_{j} B^{m}{}_{k}`, r`C^{i}{}_{k} = A^{i}{}_{j} B^{j}{}_{k}`, { focus: ['j'], sums: [{ sym: 'j', range: [0, nj] }], numeric: { inputs: { A, B }, output: C }, viz: { scene: 'contraction-block', params: { shape: [ni, nj, nk], axes: [1, 1] } } }),
        step('contract', 'Add a third matrix: left to right.', r`C^{i}{}_{k} E^{m}{}_{l}`, r`D^{i}{}_{l} = C^{i}{}_{k} E^{k}{}_{l}`, { focus: ['k'], sums: [{ sym: 'k', range: [0, nk] }], numeric: { inputs: { C, E }, output: D1 } }),
        step('relabel', 'Right to left gives the same numbers for a different cost.', r`A^{i}{}_{j} B^{j}{}_{k} E^{k}{}_{l}`, r`D^{i}{}_{l} = A^{i}{}_{j} F^{j}{}_{l}`, { focus: ['j', 'k'], numeric: { inputs: { A, B, E }, output: D2 } }),
        step('evaluate', 'Multiplications for each order.', r`D^{i}{}_{l}`, r`(AB)E: ${costL}, \quad A(BE): ${costR}`, { focus: [] }),
      ], {
        dim: 3,
        checks: [
          check('einsum = matrix product (largest error)', Math.max(...direct.flat().map((v, i) => Math.abs(v - D1.data[i]))), 0, 1e-12),
          check('both orders agree (largest error)', M.maxAbs(M.sub(D1, D2)), 0, 1e-12),
        ],
        values: { costLeft: costL, costRight: costR },
      });
    },
    viz: { scene: 'contraction-block', params: { shape: [3, 4, 6], axes: [1, 1] } },
    diagram: { style: 'network', order: ['A', 'B', 'E'], note: 'Three matrix nodes in a row, each joined to the next by one line.' },
    refs: [wp('Einstein_notation'), wp('Tensor_network'), BRIDGEMAN, PENROSE],
  },
  // --------------------------------------------------------------------------
  {
    id: 'attention-contraction', title: 'Attention as a tensor contraction', field: 'ml',
    tex: r`S_{qk} = \frac{1}{\sqrt{d}}\,Q_{q}{}^{e}K_{ke}, \qquad A_{q}{}^{k} = \operatorname{softmax}_{k}\left(S_{qk}\right), \qquad O_{q}{}^{v} = A_{q}{}^{k}\,V_{k}{}^{v}`,
    itex: r`S_{qk} = \frac{1}{\sqrt{d}} Q_{q}{}^{e} K_{ke}`,
    shape: { rank: 2, variance: 'dd (scores), then ud (weights)', symmetries: 'rows of A sum to 1', independent: 'n_q n_k' },
    story: [
      r`Self-attention in a transformer is two contractions with a softmax between them. Each query row $Q_{q}{}^{e}$ is contracted with each key row $K_{ke}$ over the feature index $e$, giving scores $S_{qk}$. A softmax over $k$ turns each row of scores into weights that sum to one, and the weights contract with the value rows over the position index $k$.`,
      r`The index positions are a choice made to show the structure: the feature index $e$ is up on the query and down on the key, so the score is a pairing of a vector with a covector. In a real model both are produced by learned maps $W_{Q}$ and $W_{K}$, and the score is $x^{\mathsf T}W_{Q}W_{K}^{\mathsf T}y$: a learned bilinear form, a metric on feature space that need not be symmetric.`,
      r`The softmax is not a tensor operation: it is nonlinear and singles out the index $k$. Everything else is einsum: $\texttt{'qe,ke->qk'}$ and then $\texttt{'qk,kv->qv'}$. The $1/\sqrt d$ keeps the scores of order one when the feature size $d$ grows, so the softmax does not saturate.`,
      r`A useful symmetry: shuffle the keys and the values with the same permutation and the output does not change, because $k$ is summed. Attention sees a set, not a sequence; position has to be added to the features. The trace checks this.`,
    ],
    vocab: [
      { term: 'query, key, value', meaning: 'Three projections of the tokens; queries score keys, the scores weight values.' },
      { term: 'softmax', meaning: 'exp(s_k) / sum exp(s_k): positive weights that sum to 1.' },
      { term: 'permutation equivariance', meaning: 'Reordering the inputs reorders the outputs the same way.' },
    ],
    params: [
      { key: 'temp', label: 'Temperature (1 = 1/sqrt d)', min: 0.1, max: 4, step: 0.05, def: 1 },
      { key: 'shift', label: 'Query shift', min: -2, max: 2, step: 0.05, def: 0 },
    ],
    trace(params) {
      const p = P(this.params, params), nq = 3, nk = 4, d = 4, nv = 2;
      const Qm = mat(nq, d, 11).map(r0 => r0.map(v => v + p.shift)), Km = mat(nk, d, 12), Vm = mat(nk, nv, 13);
      const Q = M.T(Qm, ['d', 'u']), K = M.T(Km, ['d', 'd']), V = M.T(Vm, ['d', 'u']);
      const S = M.scale(M.einsum('qe,ke->qk', Q, K), 1 / (Math.sqrt(d) * p.temp));
      const A = new M.Tensor([nq, nk], ['d', 'u']);
      for (let q = 0; q < nq; q++) { const row = [0, 1, 2, 3].map(k => S.get(q, k)), mx = Math.max(...row), ex = row.map(v => Math.exp(v - mx)), z = ex.reduce((a, b) => a + b, 0); ex.forEach((v, k) => A.set(v / z, q, k)); }
      const O = M.einsum('qk,kv->qv', A, V);
      // permutation of keys and values
      const perm = [2, 0, 3, 1], K2 = M.T(perm.map(i => Km[i]), ['d', 'd']), V2 = M.T(perm.map(i => Vm[i]), ['d', 'u']);
      const S2 = M.scale(M.einsum('qe,ke->qk', Q, K2), 1 / (Math.sqrt(d) * p.temp)), A2 = new M.Tensor([nq, nk], ['d', 'u']);
      for (let q = 0; q < nq; q++) { const row = [0, 1, 2, 3].map(k => S2.get(q, k)), mx = Math.max(...row), ex = row.map(v => Math.exp(v - mx)), z = ex.reduce((a, b) => a + b, 0); ex.forEach((v, k) => A2.set(v / z, q, k)); }
      const O2 = M.einsum('qk,kv->qv', A2, V2);
      let loop = 0; for (let q = 0; q < nq; q++) for (let v = 0; v < nv; v++) { let s = 0; for (let k = 0; k < nk; k++) s += A.get(q, k) * Vm[k][v]; loop = Math.max(loop, Math.abs(s - O.get(q, v))); }
      const rowSums = Math.max(...[0, 1, 2].map(q => Math.abs([0, 1, 2, 3].reduce((s, k) => s + A.get(q, k), 0) - 1)));
      return trace([
        step('contract', 'Score every query against every key: sum over the features.', r`Q_{q}{}^{e} K_{kf}`, r`S_{qk} = \frac{1}{\sqrt{d}} Q_{q}{}^{e} K_{ke}`, { focus: ['e'], sums: [{ sym: 'e', range: [0, d] }], numeric: { inputs: { Q, K }, output: S }, viz: { scene: 'contraction-block', params: { shape: [nq, d, nk], axes: [1, 1] } } }),
        step('evaluate', 'Softmax along k: each row becomes weights that sum to one.', r`S_{qk}`, r`A_{q}{}^{k} = ${matTex(M.toNested(A), 3)}`, { focus: ['k'] }),
        step('contract', 'Weight the values: sum over the positions.', r`A_{q}{}^{k} V_{j}{}^{v}`, r`O_{q}{}^{v} = A_{q}{}^{k} V_{k}{}^{v}`, { focus: ['k'], sums: [{ sym: 'k', range: [0, nk] }], numeric: { inputs: { A, V }, output: O } }),
        step('relabel', 'Shuffle keys and values together: the output does not change.', r`O_{q}{}^{v}`, r`O_{q}{}^{v} = A_{q}{}^{\pi(k)} V_{\pi(k)}{}^{v}`, { focus: ['k'], numeric: { inputs: {}, output: O2 } }),
      ], {
        dim: d,
        checks: [
          check('softmax rows sum to 1 (largest error)', rowSums, 0, 1e-12),
          check('einsum output = explicit loops (largest error)', loop, 0, 1e-12),
          check('permutation of keys and values leaves the output (largest change)', M.maxAbs(M.sub(O, O2)), 0, 1e-12),
        ],
        values: { output: M.toNested(O) },
      });
    },
    viz: { scene: 'contraction-block', params: { shape: [3, 4, 4], axes: [1, 1] } },
    diagram: { style: 'network', order: ['Q', 'K', 'A', 'V'], note: 'Q and K joined on the feature leg; the softmax box; A and V joined on the position leg.' },
    refs: [wp('Attention_(machine_learning)'), wp('Transformer_(deep_learning_architecture)'), VASWANI],
  },
  // --------------------------------------------------------------------------
  {
    id: 'linear-layer-gradient', title: 'A linear layer and its gradient', field: 'ml',
    tex: r`y^{i} = W^{i}{}_{j}\,x^{j} + b^{i}, \qquad L = \tfrac12\,\delta_{ik}(y^{i} - t^{i})(y^{k} - t^{k}), \qquad \frac{\partial L}{\partial W^{i}{}_{j}} = e_{i}\,x^{j}`,
    itex: r`G_{i}{}^{j} = e_{i} x^{j}`,
    shape: { rank: 2, variance: 'du (the gradient of a ud weight)', symmetries: 'rank 1 per sample', independent: 'n m' },
    story: [
      r`A linear layer maps an input vector to an output vector, so its weight is a $(1,1)$ tensor $W^{i}{}_{j}$: the lower $j$ eats an input feature, the upper $i$ gives an output feature. The loss is a number, so its derivative with respect to $W^{i}{}_{j}$ has the opposite variance in every slot: $G_{i}{}^{j} = \partial L/\partial W^{i}{}_{j}$, one lower and one upper.`,
      r`Backpropagation computes it as an outer product: the error covector $e_{i} = \partial L/\partial y^{i}$ times the input vector $x^{j}$. For one sample the gradient has matrix rank 1, the same shape as $u^{i}w_{j}$ with the roles swapped.`,
      r`The variance flip is why "gradient descent" needs a metric. To update $W$ you must add something with the shape of $W$, but the gradient has the transposed variance. Plain gradient descent uses the identity metric without saying so; natural gradient and Adam-like methods use other metrics, and so they behave differently when you rescale the features.`,
      r`The trace computes the gradient from the einsum formula and checks every component against a finite difference of the loss.`,
    ],
    vocab: [
      { term: 'weight', meaning: 'W^i_j: the linear map of a layer, a (1,1) tensor.' },
      { term: 'backpropagation', meaning: 'The chain rule run from the loss back to the weights.' },
      { term: 'natural gradient', meaning: 'A gradient step that uses a metric on the parameters to raise the index.' },
    ],
    params: [
      { key: 'scale', label: 'Input scale', min: 0.1, max: 3, step: 0.05, def: 1 },
      { key: 'target', label: 'Target offset', min: -2, max: 2, step: 0.05, def: 0.5 },
    ],
    trace(params) {
      const p = P(this.params, params);
      const Wm = mat(2, 3, 21), b = [0.1, -0.2], x = [1, -0.5, 0.25].map(v => v * p.scale), t = [p.target, -p.target];
      const W = M.T(Wm, ['u', 'd']), X = M.T(x, ['u']);
      const y = [...M.einsum('ij,j->i', W, X).data].map((v, i) => v + b[i]), e = M.T(y.map((v, i) => v - t[i]), ['d']);
      const G = M.einsum('i,j->ij', e, X);
      const loss = Wq => { const yy = Wq.map((row, i) => row.reduce((s, w, j) => s + w * x[j], 0) + b[i]); return 0.5 * yy.reduce((s, v, i) => s + (v - t[i]) ** 2, 0); };
      let fdErr = 0; const h = 1e-6;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) { const Wp = Wm.map(r0 => r0.slice()), Wn = Wm.map(r0 => r0.slice()); Wp[i][j] += h; Wn[i][j] -= h; fdErr = Math.max(fdErr, Math.abs((loss(Wp) - loss(Wn)) / (2 * h) - G.get(i, j))); }
      return trace([
        step('contract', 'Forward: the weight eats the input.', r`W^{i}{}_{j} x^{k}`, r`y^{i} = W^{i}{}_{j} x^{j} + b^{i}`, { focus: ['j'], sums: [{ sym: 'j', range: [0, 3] }], numeric: { inputs: { W, x: X }, output: M.T(y, ['u']) }, viz: { scene: 'contraction-block', params: { shape: [2, 3], axes: [1, 0] } } }),
        step('lower', 'The error is a covector: the derivative of the loss by the output.', r`y^{k} - t^{k}`, r`e_{i} = \delta_{ik} y^{k} - \delta_{ik} t^{k}`, { focus: ['i', 'k'], sums: [{ sym: 'k', range: [0, 2] }], numeric: { inputs: {}, output: e } }),
        step('product', 'The weight gradient is an outer product with flipped variance.', r`e_{i} x^{j}`, r`G_{i}{}^{j} = e_{i} x^{j}`, { focus: ['i', 'j'], numeric: { inputs: { e, x: X }, output: G }, viz: { scene: 'outer-product', params: {} } }),
        step('evaluate', 'The gradient components.', r`G_{i}{}^{j}`, r`G_{i}{}^{j} = ${matTex(M.toNested(G), 4)}`, { focus: [] }),
      ], {
        dim: 3,
        checks: [check('gradient = finite difference of the loss (largest error)', fdErr, 0, 1e-7)],
        values: { loss: loss(Wm) },
      });
    },
    viz: { scene: 'outer-product', params: {} },
    diagram: { style: 'network', order: ['W', 'x', 'e'], note: 'Forward: x joins the down leg of W. Backward: e and x side by side, no line.' },
    refs: [wp('Backpropagation'), wp('Natural_gradient'), BISHOP, BRIDGEMAN],
  },
  // --------------------------------------------------------------------------
  {
    id: 'covariance-mahalanobis', title: 'Covariance and Mahalanobis distance', field: 'ml',
    tex: r`\Sigma^{ij} = \frac{1}{N}\sum_{n}\delta x_{n}^{i}\,\delta x_{n}^{j}, \qquad d^{2} = (\Sigma^{-1})_{ij}\,\delta x^{i}\,\delta x^{j}`,
    itex: r`D = \bar{\Sigma}_{ij} u^{i} u^{j}`,
    shape: { rank: 2, variance: 'uu (covariance), dd (its inverse)', symmetries: 'symmetric, positive', independent: 'n(n+1)/2' },
    story: [
      r`The covariance of a data set is an average of outer products of the centred data vectors: $\Sigma^{ij}$, two upper indices, because each data vector is a vector. Its inverse therefore has two lower indices, and that makes it a metric: $(\Sigma^{-1})_{ij}\delta x^{i}\delta x^{j}$ is the squared Mahalanobis distance, a length measured in units of the data's own spread.`,
      r`Index placement predicts the key property. Rescale a feature (metres to millimetres) or mix features with any invertible matrix $J$: the data and $\Sigma$ change with $J$, the inverse covariance with $J^{-1}$, and the Mahalanobis distance does not change at all. The plain Euclidean distance between data points, a sum of squares with no metric, does change, which is why unscaled features break nearest-neighbour methods.`,
      r`Geometrically $\Sigma$ is an ellipse (an ellipsoid in higher dimensions) that fits the data cloud, and its inverse is the family of level sets of the distance. Whitening the data means choosing coordinates in which $\Sigma = \delta$, an orthonormal basis for this metric; principal component analysis finds its axes.`,
      r`The trace builds a small correlated data set, checks its covariance against the closed form, and changes the units of one feature to show that the Mahalanobis distance is invariant while the Euclidean one is not.`,
    ],
    vocab: [
      { term: 'covariance', meaning: 'Sigma^ij: the average of the outer products of centred data.' },
      { term: 'Mahalanobis distance', meaning: 'sqrt(Sigma^-1_ij dx^i dx^j): distance in units of the spread.' },
      { term: 'whitening', meaning: 'A change of basis that makes the covariance the identity.' },
    ],
    params: [
      { key: 'rho', label: 'Correlation rho', min: -0.9, max: 0.9, step: 0.01, def: 0.6 },
      { key: 'units', label: 'Unit change of feature 1', min: 0.1, max: 10, step: 0.1, def: 1000 / 100 },
    ],
    trace(params) {
      const p = P(this.params, params), s1 = 1.5, s2 = 0.7;
      // four points whose covariance is exactly [[s1^2, rho s1 s2], [rho s1 s2, s2^2]]
      const c = Math.sqrt((1 + p.rho) / 2), d = Math.sqrt((1 - p.rho) / 2);
      const base = [[c, c], [-c, -c], [d, -d], [-d, d]].map(([a, b]) => [Math.SQRT2 * a * s1, Math.SQRT2 * b * s2]);
      const N = base.length;
      const Sig = new M.Tensor([2, 2], ['u', 'u']);
      for (const x of base) for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) Sig.set(Sig.get(i, j) + x[i] * x[j] / N, i, j);
      const Si = M.T(M.matInverse(M.toNested(Sig)), ['d', 'd']), u = M.T([1, 0.5], ['u']);
      const D = M.einsum('ij,i,j->', Si, u, u).data[0];
      const J = [[p.units, 0], [0, 1]], Sig2 = M.transform(Sig, J), Si2 = M.transform(Si, J), u2 = M.transform(u, J);
      const D2 = M.einsum('ij,i,j->', Si2, u2, u2).data[0], E1 = 1 + 0.25, E2 = u2.data[0] ** 2 + u2.data[1] ** 2;
      const want = (1 / (1 - p.rho ** 2)) * (1 / s1 ** 2 - 2 * p.rho * 0.5 / (s1 * s2) + 0.25 / s2 ** 2);
      return trace([
        step('product', 'Average the outer products of the centred data.', r`\delta x^{i}`, r`\Sigma^{ij} = \delta x^{i} \delta x^{j}`, { focus: ['i', 'j'], numeric: { inputs: {}, output: Sig }, viz: { scene: 'metric-ellipses', params: { surface: 'skew' } } }),
        step('lower', 'Invert it: two lower indices, a metric.', r`\Sigma^{ij}`, r`\bar{\Sigma}_{ij} \Sigma^{jk} = \delta_{i}{}^{k}`, { focus: ['j'], sums: [{ sym: 'j', range: [0, 2] }], numeric: { inputs: { Sigma: Sig }, output: Si } }),
        step('contract', 'The squared Mahalanobis distance of a displacement.', r`\bar{\Sigma}_{ij} u^{k} u^{l}`, r`D = \bar{\Sigma}_{ij} u^{i} u^{j}`, { focus: ['i', 'j'], sums: [{ sym: 'i', range: [0, 2] }, { sym: 'j', range: [0, 2] }] }),
        step('transform', 'Change the units of feature 1: the components change, D does not.', r`\bar{\Sigma}_{ij}`, r`\bar{\Sigma}'_{ij} u'^{i} u'^{j} = ${num(D2, 5)}`, { focus: ['i', 'j'], numeric: { inputs: { J: comp(J) }, output: Sig2 }, viz: { scene: 'rank2-transform', params: { matrix: M.toNested(Sig2) } } }),
        step('evaluate', 'The Euclidean length is not invariant.', r`u^{1} u^{1} + u^{2} u^{2}`, r`|u|^{2} = ${num(E1, 3)} \to ${num(E2, 3)}`, { focus: [] }),
      ], {
        dim: 2,
        checks: [
          check('Sigma^11 = s1^2', Sig.get(0, 0), s1 * s1, 1e-12),
          check('Sigma^12 = rho s1 s2', Sig.get(0, 1), p.rho * s1 * s2, 1e-12),
          check('Mahalanobis D = closed form', D, want, 1e-10),
          check('D is invariant under the unit change', D2, D, 1e-10),
        ],
        values: { mahalanobis: D, euclidBefore: E1, euclidAfter: E2 },
      });
    },
    viz: { scene: 'metric-ellipses', params: { surface: 'skew' } },
    diagram: { style: 'penrose', order: ['\\Sigma', 'u', 'u'], note: 'The inverse covariance is a cup: it closes two data legs.' },
    refs: [wp('Mahalanobis_distance'), wp('Covariance_matrix'), wp('Whitening_transformation'), BISHOP],
  },
];
