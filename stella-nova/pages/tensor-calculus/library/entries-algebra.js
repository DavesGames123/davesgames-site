// ============================================================================
//  library/entries-algebra.js  ·  index algebra: delta, epsilon, metric,
//  change of basis, symmetry, transformation of components
// ----------------------------------------------------------------------------
//  Each entry has the LIBRARY entry shape of CONTRACT.md plus 'itex' (the
//  index TeX that MATH parses; 'tex' is the display form), and 'shape'
//  (rank, variance, symmetries, independent components).
//
//  ENTRIES   (grep -n "id: '<id>'" entries-algebra.js)
//      kronecker-delta  levi-civita-cross  epsilon-delta  determinant-epsilon
//      matrix-trace  tensor-product  dot-product-metric  raise-lower
//      change-of-basis  sym-antisym  rank2-transform
// ============================================================================
import * as M from './math.js';
import { X, step, trace, check, P, num, vecTex, matTex, comp, METRICS, wp, CARROLL, MTW, SCHUTZ, PENROSE, PENROSE71 } from './kit.js';

const r = String.raw;
const rot3z = a => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const rot2 = a => [[Math.cos(a), -Math.sin(a)], [Math.sin(a), Math.cos(a)]];
const deg = d => d * Math.PI / 180;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.data.length; i++) m = Math.max(m, Math.abs(a.data[i] - b.data[i])); return m; };

export const ALGEBRA = [
  // --------------------------------------------------------------------------
  {
    id: 'kronecker-delta', title: 'Kronecker delta', field: 'algebra',
    tex: r`\delta^{i}{}_{j}\,v^{j} = v^{i}, \qquad \delta^{i}{}_{i} = n`,
    itex: r`\delta^{i}{}_{j} v^{j} = v^{i}`,
    shape: { rank: 2, variance: 'ud', symmetries: 'none needed (it is the identity map)', independent: 0 },
    story: [
      r`The Kronecker delta $\delta^{i}{}_{j}$ is the identity machine. Feed it a vector and it gives the same vector back: $\delta^{i}{}_{j}v^{j} = v^{i}$. Its components are 1 when $i = j$ and 0 otherwise, so in the sum over $j$ only one term survives.`,
      r`Look at the index positions. The upper $i$ is a slot that outputs a vector component; the lower $j$ is a slot that eats a vector component. One up and one down is exactly the shape of a linear map from vectors to vectors, a $(1,1)$ tensor, an $n\times n$ matrix.`,
      r`Contract the delta with itself, $\delta^{i}{}_{i}$, and you count: $1+1+\dots+1 = n$, the dimension of the space. This is the simplest invariant there is. The trace of the identity does not care about the basis because it only asks how many directions there are.`,
      r`The delta is the one tensor whose components are the same in every basis. Under a change of basis with Jacobian $J$, a $(1,1)$ tensor goes to $J\,\delta\,J^{-1}$, and that is $\delta$ again. That is why you can write it without naming coordinates. With two lower indices the story changes: $\delta_{ij}$ is the Euclidean metric in an orthonormal basis, and it does change when the basis stretches.`,
      r`In Penrose diagrams the delta is just a line. Joining a leg of $v$ to the lower end of a plain line and reading the free end on top gives $v$ back, which is the picture of $\delta^{i}{}_{j}v^{j} = v^{i}$. A closed loop of line is $\delta^{i}{}_{i} = n$.`,
    ],
    vocab: [
      { term: 'Kronecker delta', meaning: 'The identity map written in components: 1 on the diagonal, 0 elsewhere.' },
      { term: '(1,1) tensor', meaning: 'A tensor with one upper and one lower index; a linear map from vectors to vectors.' },
      { term: 'contraction', meaning: 'Set an upper and a lower index equal and sum over them; the rank drops by two.' },
    ],
    params: [
      { key: 'n', label: 'Dimension n', min: 2, max: 5, step: 1, def: 3 },
      { key: 'shear', label: 'Basis shear (for the invariance test)', min: -1, max: 1, step: 0.05, def: 0.4 },
    ],
    trace(params) {
      const p = P(this.params, params), n = Math.round(p.n);
      const d = M.kroneckerDelta(n), v = M.T(Array.from({ length: n }, (_, i) => i + 1), ['u']);
      const out = M.einsum('ij,j->i', d, v), tr = M.einsum('ii->', d).data[0];
      const J = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 + 0.1 * i : j === i + 1 ? p.shear : 0)));
      const dT = M.transform(d, J);
      return trace([
        step('product', 'Put the delta next to the vector: a rank-3 array with n^3 numbers.', r`\delta^{i}{}_{j}`, r`\delta^{i}{}_{j} v^{k}`, { focus: ['j', 'k'] }),
        step('contract', 'Join the lower j to the upper index of v and sum: only the j = i term is not zero.', r`\delta^{i}{}_{j} v^{k}`, r`\delta^{i}{}_{j} v^{j}`, { focus: ['j'], sums: [{ sym: 'j', range: [0, n] }], numeric: { inputs: { delta: d, v }, output: out } }),
        step('evaluate', 'The vector comes back unchanged.', r`\delta^{i}{}_{j} v^{j}`, r`v^{i} = ${vecTex([...out.data])}`, { focus: ['i'] }),
        step('trace', 'Join the delta to itself: the loop counts the dimensions.', r`\delta^{i}{}_{j}`, r`\delta^{i}{}_{i} = ${tr}`, { focus: ['i'], sums: [{ sym: 'i', range: [0, n] }] }),
        step('transform', 'Change basis with a sheared Jacobian: J delta J^-1 is the delta again.', r`\delta^{i}{}_{j}`, r`\delta'^{i}{}_{j} = \delta^{i}{}_{j}`, { focus: ['i', 'j'], numeric: { inputs: { delta: d, J: comp(J) }, output: dT } }),
      ], {
        dim: n,
        checks: [
          check('delta v = v (largest error)', maxDiff(out, v), 0, 1e-12),
          check('trace of delta = n', tr, n, 1e-12),
          check('delta is the same after the basis change (largest change)', maxDiff(dT, d), 0, 1e-12),
        ],
        values: { trace: tr },
      });
    },
    viz: { scene: 'contraction-block', params: { shape: [3, 3], axes: [1, 0] } },
    diagram: { style: 'penrose', order: ['\\delta', 'v'], note: 'The delta is a plain line; a closed loop is n.' },
    refs: [wp('Kronecker_delta'), CARROLL, PENROSE],
  },
  // --------------------------------------------------------------------------
  {
    id: 'levi-civita-cross', title: 'Levi-Civita symbol and the cross product', field: 'algebra',
    tex: r`(\mathbf{a}\times\mathbf{b})_{i} = \epsilon_{ijk}\,a^{j}\,b^{k}`,
    itex: r`c_{i} = \epsilon_{ijk} a^{j} b^{k}`,
    shape: { rank: 3, variance: 'ddd', symmetries: 'totally antisymmetric', independent: 1 },
    story: [
      r`The Levi-Civita symbol $\epsilon_{ijk}$ is $+1$ when $(i,j,k)$ is an even permutation of $(1,2,3)$, $-1$ for an odd permutation, and $0$ when any two indices repeat. Of its 27 components only 6 are not zero, and they are all fixed by one number, $\epsilon_{123} = 1$. It is totally antisymmetric: swap any two indices and the sign flips.`,
      r`Contract it with two vectors and you get the cross product: $(\mathbf a\times\mathbf b)_{i} = \epsilon_{ijk}a^{j}b^{k}$. The two lower indices $j,k$ eat the two vectors; the leftover lower $i$ says the result is naturally a covector, an oriented plane element, not an arrow. In Euclidean space with an orthonormal basis we turn it into an arrow with $\delta^{ij}$ without thinking about it.`,
      r`Geometrically, $\epsilon_{ijk}a^{i}b^{j}c^{k}$ is the signed volume of the box spanned by $\mathbf a,\mathbf b,\mathbf c$. Fixing $\mathbf a$ and $\mathbf b$ leaves a machine that eats $\mathbf c$ and returns the volume: that machine is the covector $(\mathbf a\times\mathbf b)_{k}$. Its level sets are planes parallel to $\mathbf a$ and $\mathbf b$, spaced so that each unit of volume is one plane.`,
      r`$\epsilon_{ijk}$ is not quite a tensor. Under a change of basis with Jacobian $J$ the transformed array is $\det(J)^{-1}\epsilon_{ijk}$, so the symbol keeps its values only for rotations ($\det J = 1$). A reflection flips the sign: this is why the cross product of two ordinary vectors is a pseudovector, and why magnetic field and angular momentum flip under a mirror differently from velocity. The honest tensor is $\sqrt{|g|}\,\epsilon_{ijk}$, the volume form.`,
    ],
    vocab: [
      { term: 'Levi-Civita symbol', meaning: 'The totally antisymmetric array with epsilon_123 = 1.' },
      { term: 'pseudovector', meaning: 'An object that transforms like a vector under rotations but gains a sign under reflections.' },
      { term: 'volume form', meaning: 'sqrt|g| epsilon: the true tensor that measures oriented volume.' },
    ],
    params: [
      { key: 'la', label: '|a|', min: 0.2, max: 2, step: 0.05, def: 1 },
      { key: 'lb', label: '|b|', min: 0.2, max: 2, step: 0.05, def: 1.2 },
      { key: 'angle', label: 'Angle between a and b (deg)', min: 0, max: 180, step: 1, def: 60 },
      { key: 'tilt', label: 'Tilt of the a, b plane (deg)', min: 0, max: 90, step: 1, def: 25 },
    ],
    trace(params) {
      const p = P(this.params, params), t = deg(p.angle), tl = deg(p.tilt);
      // a along x; b in a plane through x tilted about x by 'tilt'
      const a = [p.la, 0, 0], b = [p.lb * Math.cos(t), p.lb * Math.sin(t) * Math.cos(tl), p.lb * Math.sin(t) * Math.sin(tl)];
      const eps = M.leviCivita(3), A = M.T(a, ['u']), B = M.T(b, ['u']);
      const c = M.einsum('ijk,j,k->i', eps, A, B), want = cross(a, b);
      const J = [[1.5, 0.3, 0], [0, 0.8, 0.2], [0.1, 0, 1.1]], epsT = M.transform(eps, J), dJ = M.matDet(J);
      return trace([
        step('product', 'Stack epsilon with both vectors: 3^5 = 243 numbers.', r`\epsilon_{ijk}`, r`\epsilon_{ijk} a^{l} b^{m}`, { focus: ['l', 'm'], viz: { scene: 'component-cube', params: { tensor: 'epsilon' } } }),
        step('contract', 'Join j with the leg of a and sum.', r`\epsilon_{ijk} a^{l} b^{m}`, r`\epsilon_{ijk} a^{j} b^{m}`, { focus: ['j'], sums: [{ sym: 'j', range: [0, 3] }] }),
        step('contract', 'Join k with the leg of b and sum. One lower index i is left: a covector.', r`\epsilon_{ijk} a^{j} b^{m}`, r`\epsilon_{ijk} a^{j} b^{k}`, { focus: ['k'], sums: [{ sym: 'k', range: [0, 3] }], numeric: { inputs: { epsilon: eps, a: A, b: B }, output: c } }),
        step('evaluate', 'The components are the cross product.', r`\epsilon_{ijk} a^{j} b^{k}`, r`c_{i} = ${vecTex([...c.data])}`, { focus: ['i'], viz: { scene: 'levi-civita-cube', params: { a, b } } }),
        step('transform', 'Change basis with a general J: the epsilon array comes back divided by det J, so it is a density, not a tensor.', r`\epsilon_{ijk}`, r`\epsilon'_{ijk} = \frac{1}{\det J}\epsilon_{ijk}`, { focus: ['i', 'j', 'k'], numeric: { inputs: { epsilon: eps, J: comp(J) }, output: epsT } }),
      ], {
        checks: [
          check('|a x b| = |a||b| sin(angle)', Math.hypot(...c.data), p.la * p.lb * Math.sin(t), 1e-12),
          check('epsilon contraction = direct cross product (largest error)', Math.max(...want.map((w, i) => Math.abs(w - c.data[i]))), 0, 1e-12),
          check('a . (a x b) = 0', dot(a, [...c.data]), 0, 1e-12),
          check('transformed epsilon = epsilon / det J', maxDiff(epsT, M.scale(eps, 1 / dJ)), 0, 1e-12),
        ],
        values: { area: Math.hypot(...c.data), detJ: dJ },
      });
    },
    viz: { scene: 'levi-civita-cube', params: { a: [1, 0, 0], b: [0.6, 0.94, 0.44] } },
    diagram: { style: 'penrose', order: ['\\epsilon', 'a', 'b'], note: 'Epsilon is a horizontal bar with three legs down; a and b hang their up legs into two of them.' },
    refs: [wp('Levi-Civita_symbol'), wp('Cross_product'), CARROLL, PENROSE],
  },
  // --------------------------------------------------------------------------
  {
    id: 'epsilon-delta', title: 'The epsilon-delta identity', field: 'algebra',
    tex: r`\epsilon_{ijk}\,\epsilon^{imn} = \delta^{m}{}_{j}\,\delta^{n}{}_{k} - \delta^{n}{}_{j}\,\delta^{m}{}_{k}`,
    itex: r`\epsilon_{ijk} \epsilon^{imn} = \delta^{m}{}_{j} \delta^{n}{}_{k} - \delta^{n}{}_{j} \delta^{m}{}_{k}`,
    shape: { rank: 4, variance: 'dduu (free j k down, m n up)', symmetries: 'antisymmetric in (j,k) and in (m,n)', independent: 3 },
    story: [
      r`Two epsilons sharing one index collapse into deltas. On the left, $i$ is summed; the free indices are $j,k$ down and $m,n$ up. The right side has exactly the same free indices in the same positions, which is the first thing to check in any tensor equation.`,
      r`Why is it true? Both sides are antisymmetric in $j,k$ and in $m,n$, and in three dimensions the only such objects built from deltas are multiples of $\delta^{m}{}_{j}\delta^{n}{}_{k} - \delta^{n}{}_{j}\delta^{m}{}_{k}$. Setting $j=m=1$, $k=n=2$ fixes the multiple to 1.`,
      r`This identity is the engine behind vector calculus. The rule $\mathbf a\times(\mathbf b\times\mathbf c) = \mathbf b(\mathbf a\cdot\mathbf c) - \mathbf c(\mathbf a\cdot\mathbf b)$ is just this line with three vectors plugged in, and so are $\nabla\times(\nabla\times\mathbf A) = \nabla(\nabla\cdot\mathbf A) - \nabla^{2}\mathbf A$ and the area identity $|\mathbf a\times\mathbf b|^{2} = |\mathbf a|^{2}|\mathbf b|^{2} - (\mathbf a\cdot\mathbf b)^{2}$.`,
      r`Contract one more pair and you get $\epsilon_{ijk}\epsilon^{ijn} = 2\delta^{n}{}_{k}$, and all three: $\epsilon_{ijk}\epsilon^{ijk} = 6 = 3!$. In Penrose notation, two bars joined by a line become a pair of crossing and uncrossing strands, which is how birdtracks prove such identities without ever writing a component.`,
    ],
    vocab: [
      { term: 'free index', meaning: 'An index that is not summed; both sides of an equation must have the same free indices.' },
      { term: 'BAC-CAB rule', meaning: 'a x (b x c) = b(a.c) - c(a.b), a consequence of the epsilon-delta identity.' },
    ],
    params: [
      { key: 'twist', label: 'Twist of c about b (deg)', min: 0, max: 180, step: 1, def: 40 },
    ],
    trace(params) {
      const p = P(this.params, params), tw = deg(p.twist);
      const eL = M.leviCivita(3), eU = M.leviCivita(3, ['u', 'u', 'u']), d = M.kroneckerDelta(3);
      const lhs = M.einsum('ijk,imn->jkmn', eL, eU);
      const rhs = M.sub(M.einsum('mj,nk->jkmn', d, d), M.einsum('nj,mk->jkmn', d, d));
      const full = M.einsum('ijk,ijk->', eL, eU).data[0];
      const a = [1, 0.5, -0.3], b = [0.2, 1, 0.4], c = [Math.cos(tw), 0.3, Math.sin(tw)];
      const bac = cross(a, cross(b, c)), cab = b.map((bi, i) => bi * dot(a, c) - c[i] * dot(a, b));
      return trace([
        step('product', 'Put the two epsilons side by side: rank 6, 729 numbers.', r`\epsilon_{ijk}`, r`\epsilon_{ijk} \epsilon^{lmn}`, { focus: ['i', 'l'] }),
        step('contract', 'Join the first leg of each epsilon and sum over i.', r`\epsilon_{ijk} \epsilon^{lmn}`, r`\epsilon_{ijk} \epsilon^{imn}`, { focus: ['i'], sums: [{ sym: 'i', range: [0, 3] }], numeric: { inputs: { epsilon_low: eL, epsilon_up: eU }, output: lhs } }),
        step('substitute', 'The result equals two products of deltas: straight minus crossed strands.', r`\epsilon_{ijk} \epsilon^{imn}`, r`\delta^{m}{}_{j} \delta^{n}{}_{k} - \delta^{n}{}_{j} \delta^{m}{}_{k}`, { focus: ['j', 'k', 'm', 'n'], numeric: { inputs: { delta: d }, output: rhs } }),
        step('contract', 'Contract every leg: the result is 3! = 6.', r`\epsilon_{ijk} \epsilon^{imn}`, r`\epsilon_{ijk} \epsilon^{ijk} = ${num(full)}`, { focus: ['j', 'k'], sums: [{ sym: 'j', range: [0, 3] }, { sym: 'k', range: [0, 3] }] }),
        step('evaluate', 'Plug in three vectors: the BAC-CAB rule.', r`\epsilon_{ijk} \epsilon^{imn}`, r`\mathbf{a}\times(\mathbf{b}\times\mathbf{c}) = ${vecTex(bac)}`, { focus: [] }),
      ], {
        checks: [
          check('identity holds on all 81 components (largest error)', maxDiff(lhs, rhs), 0, 1e-12),
          check('epsilon_ijk epsilon^ijk = 6', full, 6, 1e-12),
          check('BAC-CAB (largest error)', Math.max(...bac.map((v, i) => Math.abs(v - cab[i]))), 0, 1e-12),
        ],
        values: { full },
      });
    },
    viz: { scene: 'component-cube', params: { tensor: 'epsilon' } },
    diagram: { style: 'birdtrack', order: ['\\epsilon', '\\epsilon'], note: 'Two bars joined by one strand equal straight strands minus crossed strands.' },
    refs: [wp('Levi-Civita_symbol'), CARROLL, PENROSE],
  },
  // --------------------------------------------------------------------------
  {
    id: 'determinant-epsilon', title: 'Determinant via epsilon', field: 'algebra',
    tex: r`\epsilon_{lmn}\,A^{l}{}_{i}\,A^{m}{}_{j}\,A^{n}{}_{k} = \det(A)\,\epsilon_{ijk}`,
    itex: r`\epsilon_{lmn} A^{l}{}_{i} A^{m}{}_{j} A^{n}{}_{k} = D \epsilon_{ijk}`,
    shape: { rank: 3, variance: 'ddd', symmetries: 'totally antisymmetric in i, j, k', independent: 1 },
    story: [
      r`Feed the three columns of a matrix into the volume machine $\epsilon_{lmn}$. Each column $A^{l}{}_{i}$ is the image of a basis vector, so the result is the signed volume of the unit cube after the map: the determinant. Because the left side is antisymmetric in $i,j,k$, it must be a multiple of $\epsilon_{ijk}$, and that multiple is $\det A$.`,
      r`The index placement is the map's own: $A^{l}{}_{i}$ has a lower $i$ that takes a vector in and an upper $l$ that gives a vector out. All three upper indices are absorbed by epsilon, all three lower indices stay free and land on the epsilon of the right side.`,
      r`Setting $i,j,k = 1,2,3$ gives the classical expansion $\det A = \epsilon_{lmn}A^{l}{}_{1}A^{m}{}_{2}A^{n}{}_{3}$: six products with signs, one per permutation. Contracting with $\epsilon^{ijk}/3!$ gives the fully symmetric form that you can read straight off a Penrose diagram.`,
      r`The determinant of a $(1,1)$ tensor is a true invariant: $\det(JAJ^{-1}) = \det A$. The determinant of a metric $g_{ij}$ is not; it picks up $\det(J)^{-2}$, which is why $\sqrt{|g|}$ appears in every volume integral and why $\epsilon$ needs it to become a tensor.`,
    ],
    vocab: [
      { term: 'determinant', meaning: 'The factor by which a linear map scales signed volume.' },
      { term: 'tensor density', meaning: 'An object that transforms like a tensor times a power of det J.' },
    ],
    params: [
      { key: 'sx', label: 'Stretch x', min: 0.2, max: 2, step: 0.05, def: 1.4 },
      { key: 'sy', label: 'Stretch y', min: -1.5, max: 2, step: 0.05, def: 0.8 },
      { key: 'shear', label: 'Shear', min: -1, max: 1, step: 0.05, def: 0.5 },
      { key: 'angle', label: 'Rotation (deg)', min: -180, max: 180, step: 1, def: 30 },
    ],
    trace(params) {
      const p = P(this.params, params);
      const S = [[p.sx, p.shear, 0], [0, p.sy, 0], [0, 0, 1]], Am = M.matMul(rot3z(deg(p.angle)), S);
      const A = M.T(Am, ['u', 'd']), eps = M.leviCivita(3);
      const lhs = M.einsum('lmn,li,mj,nk->ijk', eps, A, A, A), det = lhs.data[0 * 9 + 1 * 3 + 2];
      return trace([
        step('product', 'Take three copies of A, one per column slot.', r`A^{l}{}_{i}`, r`A^{l}{}_{i} A^{m}{}_{j} A^{n}{}_{k}`, { focus: ['l', 'm', 'n'] }),
        step('contract', 'Join their upper legs to epsilon: the signed volume of the three mapped basis vectors.', r`A^{l}{}_{i} A^{m}{}_{j} A^{n}{}_{k}`, r`\epsilon_{lmn} A^{l}{}_{i} A^{m}{}_{j} A^{n}{}_{k}`, { focus: ['l', 'm', 'n'], sums: [{ sym: 'l', range: [0, 3] }, { sym: 'm', range: [0, 3] }, { sym: 'n', range: [0, 3] }], numeric: { inputs: { epsilon: eps, A }, output: lhs }, viz: { scene: 'levi-civita-cube', params: { matrix: Am } } }),
        step('evaluate', 'The 123 component is the determinant; the rest is epsilon times it.', r`\epsilon_{lmn} A^{l}{}_{i} A^{m}{}_{j} A^{n}{}_{k}`, r`\det A = ${num(det, 4)}`, { focus: ['i', 'j', 'k'] }),
      ], {
        checks: [
          check('det from epsilon = sx * sy (rotation and shear keep volume)', det, p.sx * p.sy, 1e-12),
          check('det from epsilon = det by elimination', det, M.matDet(Am), 1e-12),
          check('left side = det * epsilon (largest error)', maxDiff(lhs, M.scale(eps, det)), 0, 1e-12),
        ],
        values: { det },
      });
    },
    viz: { scene: 'levi-civita-cube', params: { matrix: [[1.4, 0.5, 0], [0, 0.8, 0], [0, 0, 1]] } },
    diagram: { style: 'penrose', order: ['\\epsilon', 'A', 'A', 'A'], note: 'Epsilon bar on top, three copies of A hang below it.' },
    refs: [wp('Determinant'), wp('Levi-Civita_symbol'), PENROSE],
  },
  // --------------------------------------------------------------------------
  {
    id: 'matrix-trace', title: 'Trace of a (1,1) tensor', field: 'algebra',
    tex: r`\operatorname{tr}A = A^{i}{}_{i}, \qquad \operatorname{tr}\!\left(J A J^{-1}\right) = \operatorname{tr}A`,
    itex: r`t = A^{i}{}_{i}`,
    shape: { rank: 2, variance: 'ud', symmetries: 'none', independent: 'n^2' },
    story: [
      r`The trace contracts the upper index of a $(1,1)$ tensor with its own lower index: $A^{i}{}_{i} = A^{1}{}_{1} + A^{2}{}_{2} + \dots$. The result has no free index, so it is a scalar, and a scalar has the same value in every basis.`,
      r`This is why index position matters. For $A^{i}{}_{j}$ the sum of the diagonal is invariant. For a tensor with two upper indices, $A^{ij}$, the plain diagonal sum $A^{11}+A^{22}+\dots$ is not a contraction at all; it changes when the basis is not orthonormal. To get an invariant from $A^{ij}$ you must first lower one index with the metric: $g_{ij}A^{ij}$.`,
      r`The trace is the sum of eigenvalues, and it measures the rate at which the map changes volume near the identity: $\det(1 + \varepsilon A) \approx 1 + \varepsilon\operatorname{tr}A$. In continuum mechanics the trace of the strain rate is the rate of volume change; in relativity the trace of the stress-energy tensor separates radiation (trace zero) from matter.`,
      r`Play with the basis stretch: the matrix entries change, the trace of $A^{i}{}_{j}$ does not, while the naive diagonal sum of the two-upper version drifts. In a Penrose diagram the trace is a leg that bends round and plugs into its own node.`,
    ],
    vocab: [
      { term: 'trace', meaning: 'Contraction of an upper index with a lower index of the same tensor.' },
      { term: 'invariant', meaning: 'A number that does not depend on the basis.' },
    ],
    params: [
      { key: 'a', label: 'A^1_1', min: -2, max: 2, step: 0.05, def: 1.2 },
      { key: 'd', label: 'A^2_2', min: -2, max: 2, step: 0.05, def: -0.4 },
      { key: 'b', label: 'A^1_2', min: -2, max: 2, step: 0.05, def: 0.7 },
      { key: 'stretch', label: 'Basis stretch', min: 0.3, max: 3, step: 0.05, def: 1.8 },
      { key: 'skew', label: 'Basis skew', min: -1, max: 1, step: 0.05, def: 0.4 },
    ],
    trace(params) {
      const p = P(this.params, params);
      const Am = [[p.a, p.b], [0.3, p.d]], J = [[p.stretch, p.skew], [0, 1]];
      const A = M.T(Am, ['u', 'd']), A2 = M.transform(A, J);
      const t1 = M.einsum('ii->', A).data[0], t2 = M.einsum('ii->', A2).data[0];
      const Au = M.T(Am, ['u', 'u']), Au2 = M.transform(Au, J);
      const naive1 = Am[0][0] + Am[1][1], naive2 = Au2.data[0] + Au2.data[3];
      return trace([
        step('trace', 'Join the upper i to the lower i and sum the diagonal.', r`A^{i}{}_{j}`, r`A^{i}{}_{i} = ${num(t1)}`, { focus: ['i'], sums: [{ sym: 'i', range: [0, 2] }], numeric: { inputs: { A }, output: M.T(t1) } }),
        step('transform', 'Stretch and skew the basis: the entries of A change as J A J^-1.', r`A^{i}{}_{j}`, r`A'^{i}{}_{j} = J^{i}{}_{k} A^{k}{}_{l} \bar{J}^{l}{}_{j}`, { focus: ['i', 'j'], numeric: { inputs: { A, J: comp(J) }, output: A2 }, viz: { scene: 'rank2-transform', params: { matrix: Am, stretch: p.stretch } } }),
        step('evaluate', 'The new entries (the bar marks the inverse Jacobian).', r`A'^{i}{}_{j}`, r`A'^{i}{}_{j} = ${matTex(M.toNested(A2))}`, { focus: ['i', 'j'] }),
        step('trace', 'The trace in the new basis is the same number.', r`A'^{i}{}_{j}`, r`A'^{i}{}_{i} = ${num(t2)}`, { focus: ['i'], sums: [{ sym: 'i', range: [0, 2] }] }),
        step('evaluate', 'With two upper indices the diagonal sum is not a contraction, and it changes.', r`A^{ij}`, r`A'^{11} + A'^{22} = ${num(naive2)} \ne ${num(naive1)}`, { focus: ['i', 'j'] }),
      ], {
        dim: 2,
        checks: [
          check('trace is invariant under J A J^-1', t2, t1, 1e-12),
          check('trace = a + d', t1, p.a + p.d, 1e-12),
          check('trace of the transformed matrix by direct matrix product', (() => { const B = M.matMul(M.matMul(J, Am), M.matInverse(J)); return B[0][0] + B[1][1]; })(), t1, 1e-12),
        ],
        values: { trace: t1, naiveBefore: naive1, naiveAfter: naive2 },
      });
    },
    viz: { scene: 'rank2-transform', params: { matrix: [[1.2, 0.7], [0.3, -0.4]], stretch: 1.8 } },
    diagram: { style: 'penrose', order: ['A'], note: 'The lower leg of A bends round and joins its upper leg.' },
    refs: [wp('Trace_(linear_algebra)'), SCHUTZ, PENROSE],
  },
  // --------------------------------------------------------------------------
  {
    id: 'tensor-product', title: 'Tensor product of a vector and a covector', field: 'algebra',
    tex: r`T^{i}{}_{j} = u^{i}\,w_{j}, \qquad T^{i}{}_{i} = w_{i}u^{i}`,
    itex: r`T^{i}{}_{j} = u^{i} w_{j}`,
    shape: { rank: 2, variance: 'ud', symmetries: 'none; matrix rank 1', independent: '2n - 1 for a pure product' },
    story: [
      r`The tensor product $u\otimes w$ puts every component of $u$ next to every component of $w$: $T^{i}{}_{j} = u^{i}w_{j}$. No index is summed. The ranks add, so a vector (one up) times a covector (one down) gives a $(1,1)$ tensor, an $n\times n$ block of numbers.`,
      r`As a machine, $T$ eats a vector $v$ and returns $u$ scaled by $w(v) = w_{j}v^{j}$. It squashes all of space onto the line of $u$, which is why a pure tensor product has matrix rank 1. Sums of such products give every $(1,1)$ tensor; the fewest products you need is its rank.`,
      r`Contract the product, $T^{i}{}_{i} = w_{i}u^{i}$, and you get the number $w(u)$: how many of $w$'s level planes the arrow $u$ crosses. Outer product then contraction is the pattern behind every tensor operation on this page.`,
      r`Under a change of basis each factor transforms on its own: $u$ with $J$, $w$ with $J^{-1}$. So $T$ transforms with one $J$ and one $J^{-1}$, as its index positions say, and the trace is invariant. In the 3D view the product is a block of cubes coloured by $u^{i}w_{j}$; in the diagram two separate nodes stand side by side with no line between them.`,
    ],
    vocab: [
      { term: 'tensor product', meaning: 'u (x) w: all products of components, ranks add, no sum.' },
      { term: 'matrix rank', meaning: 'The smallest number of tensor products whose sum gives the tensor.' },
    ],
    params: [
      { key: 'ua', label: 'Angle of u (deg)', min: -180, max: 180, step: 1, def: 20 },
      { key: 'ul', label: '|u|', min: 0.2, max: 2, step: 0.05, def: 1.2 },
      { key: 'wa', label: 'Angle of w (deg)', min: -180, max: 180, step: 1, def: 70 },
      { key: 'wl', label: '|w|', min: 0.2, max: 2, step: 0.05, def: 0.9 },
    ],
    trace(params) {
      const p = P(this.params, params);
      const u = [p.ul * Math.cos(deg(p.ua)), p.ul * Math.sin(deg(p.ua))], w = [p.wl * Math.cos(deg(p.wa)), p.wl * Math.sin(deg(p.wa))];
      const U = M.T(u, ['u']), W = M.T(w, ['d']);
      const Tt = M.einsum('i,j->ij', U, W), tr = M.einsum('ii->', Tt).data[0], det = M.matDet(M.toNested(Tt));
      return trace([
        step('product', 'Every component of u times every component of w: a 2 x 2 block, nothing summed.', r`u^{i}`, r`T^{i}{}_{j} = u^{i} w_{j}`, { focus: ['i', 'j'], numeric: { inputs: { u: U, w: W }, output: Tt }, viz: { scene: 'outer-product', params: { u, w } } }),
        step('trace', 'Join the two legs: the number w(u).', r`u^{i} w_{j}`, r`u^{i} w_{i} = ${num(tr)}`, { focus: ['i'], sums: [{ sym: 'i', range: [0, 2] }], viz: { scene: 'contraction-block', params: { shape: [2, 2], axes: [0, 1] } } }),
        step('evaluate', 'A pure product squashes the plane onto a line: det T = 0.', r`T^{i}{}_{j}`, r`\det T = ${num(det)}`, { focus: [] }),
      ], {
        dim: 2,
        checks: [
          check('trace = |u||w| cos(angle between)', tr, p.ul * p.wl * Math.cos(deg(p.ua - p.wa)), 1e-12),
          check('det of a pure product = 0', det, 0, 1e-12),
        ],
        values: { trace: tr },
      });
    },
    viz: { scene: 'outer-product', params: { u: [1.13, 0.41], w: [0.31, 0.85] } },
    diagram: { style: 'penrose', order: ['u', 'w'], note: 'Two nodes side by side, no line between them; the trace adds one line.' },
    refs: [wp('Tensor_product'), wp('Outer_product'), SCHUTZ],
  },
  // --------------------------------------------------------------------------
  {
    id: 'dot-product-metric', title: 'Dot product with a metric', field: 'algebra',
    tex: r`\langle u, v\rangle = g_{ij}\,u^{i}\,v^{j}, \qquad g_{ij} = \mathbf{e}_{i}\cdot\mathbf{e}_{j}`,
    itex: r`s = g_{ij} u^{i} v^{j}`,
    shape: { rank: 2, variance: 'dd', symmetries: 'symmetric', independent: 'n(n+1)/2' },
    story: [
      r`Components alone cannot give lengths or angles. In a skewed basis the vector with components $(1,1)$ is not $\sqrt 2$ long. The metric $g_{ij} = \mathbf e_{i}\cdot\mathbf e_{j}$ stores the lengths of the basis vectors and the angles between them, and $g_{ij}u^{i}v^{j}$ turns components back into the true dot product.`,
      r`Both indices of $g$ are lower: it eats two vectors and returns a number. It is symmetric, $g_{ij} = g_{ji}$, so in $n$ dimensions it has $n(n+1)/2$ independent components: 3 in the plane, 6 in space, 10 in spacetime.`,
      r`Change the basis and $g$ changes with two copies of $J^{-1}$, exactly cancelling the two copies of $J$ that the components $u^{i}$ and $v^{j}$ pick up. The dot product is a scalar; only its bookkeeping moves.`,
      r`Draw the metric as the ellipse $g_{ij}x^{i}x^{j} = 1$ in component space: the set of component vectors with unit length. In an orthonormal basis it is a circle; skew the basis and it becomes a tilted ellipse. This picture is the Tissot indicatrix that the curved-surface entries use at every point.`,
    ],
    vocab: [
      { term: 'metric tensor', meaning: 'g_ij = e_i . e_j; the symmetric (0,2) tensor that gives lengths and angles.' },
      { term: 'orthonormal basis', meaning: 'A basis where g_ij = delta_ij: unit vectors at right angles.' },
    ],
    params: [
      { key: 'alpha', label: 'Angle between e1 and e2 (deg)', min: 20, max: 160, step: 1, def: 60 },
      { key: 'ua', label: 'Direction of u (deg)', min: -180, max: 180, step: 1, def: 10 },
      { key: 'va', label: 'Direction of v (deg)', min: -180, max: 180, step: 1, def: 100 },
    ],
    trace(params) {
      const p = P(this.params, params), al = deg(p.alpha);
      const E = [[1, Math.cos(al)], [0, Math.sin(al)]]; // columns are e1, e2 in Cartesian
      const Ei = M.matInverse(E), cart = a => [Math.cos(deg(a)), Math.sin(deg(a))];
      const uc = M.matMul(Ei, cart(p.ua).map(x => [x])).map(r0 => r0[0]), vc = M.matMul(Ei, cart(p.va).map(x => [x])).map(r0 => r0[0]);
      const g = M.T(METRICS.skew(al).g(), ['d', 'd']), U = M.T(uc, ['u']), V = M.T(vc, ['u']);
      const s = M.einsum('ij,i,j->', g, U, V).data[0], naive = uc[0] * vc[0] + uc[1] * vc[1];
      return trace([
        step('evaluate', 'Write u and v in the skewed basis: these are their components.', r`u^{i}`, r`u^{i} = ${vecTex(uc)},\; v^{j} = ${vecTex(vc)}`, { focus: ['i', 'j'], viz: { scene: 'basis-dual', params: { angle: p.alpha } } }),
        step('product', 'Put the metric with both vectors.', r`g_{ij}`, r`g_{ij} u^{k} v^{l}`, { focus: ['k', 'l'], numeric: { inputs: { g }, output: g } }),
        step('contract', 'Join i to u and j to v and sum all four terms.', r`g_{ij} u^{k} v^{l}`, r`g_{ij} u^{i} v^{j} = ${num(s, 4)}`, { focus: ['i', 'j'], sums: [{ sym: 'i', range: [0, 2] }, { sym: 'j', range: [0, 2] }], numeric: { inputs: { g, u: U, v: V }, output: M.T(s) }, viz: { scene: 'metric-ellipses', params: { surface: 'skew', angle: p.alpha } } }),
        step('evaluate', 'Without the metric the plain sum of products gives a wrong answer.', r`u^{1} v^{1} + u^{2} v^{2}`, r`u^{1} v^{1} + u^{2} v^{2} = ${num(naive, 4)}`, { focus: [] }),
      ], {
        dim: 2,
        checks: [check('g u v = cos(angle between u and v)', s, Math.cos(deg(p.ua - p.va)), 1e-12)],
        values: { dot: s, naive },
      });
    },
    viz: { scene: 'metric-ellipses', params: { surface: 'skew', angle: 60 } },
    diagram: { style: 'penrose', order: ['u', 'g', 'v'], note: 'The metric is a cup: it takes two up legs and closes them.' },
    refs: [wp('Metric_tensor'), SCHUTZ, CARROLL],
  },
  // --------------------------------------------------------------------------
  {
    id: 'raise-lower', title: 'Raising and lowering indices', field: 'algebra',
    tex: r`v_{i} = g_{ij}\,v^{j}, \qquad v^{i} = g^{ij}\,v_{j}, \qquad g^{ik}g_{kj} = \delta^{i}{}_{j}`,
    itex: r`v_{i} = g_{ij} v^{j}`,
    shape: { rank: 1, variance: 'd (from u)', symmetries: '-', independent: 'n' },
    story: [
      r`A vector has two sets of components. The contravariant ones, $v^{i}$, are the numbers you multiply the basis vectors by to build the arrow: $\mathbf v = v^{i}\mathbf e_{i}$. The covariant ones, $v_{i} = \mathbf v\cdot\mathbf e_{i}$, are the projections of the arrow onto each basis vector. In an orthonormal basis they agree; in a skewed basis they do not.`,
      r`The metric converts one set into the other: $v_{i} = g_{ij}v^{j}$, and its inverse goes back: $v^{i} = g^{ij}v_{j}$, with $g^{ik}g_{kj} = \delta^{i}{}_{j}$. Lowering is not a change of object; it is the same geometric arrow seen through the dot product, now packaged as the covector $\mathbf u \mapsto \mathbf v\cdot\mathbf u$.`,
      r`The upper components grow when the basis vectors shrink (you need more of them), and they are read with the parallelogram rule. The lower components grow when the basis vectors grow (the projections get longer), and they are read by dropping perpendiculars. That is the meaning of contravariant and covariant: against the basis, and with it.`,
      r`The dual basis $\mathbf e^{i}$ is defined by $\mathbf e^{i}\cdot\mathbf e_{j} = \delta^{i}{}_{j}$; each $\mathbf e^{i}$ is perpendicular to all the other $\mathbf e_{j}$. Then $v_{i}$ are the components on the dual basis. Without a metric there is no way to raise or lower, and vectors and covectors are genuinely different kinds of thing.`,
    ],
    vocab: [
      { term: 'contravariant components', meaning: 'v^i: coefficients on the basis vectors (parallelogram rule).' },
      { term: 'covariant components', meaning: 'v_i = v . e_i: projections on the basis vectors.' },
      { term: 'dual basis', meaning: 'e^i with e^i . e_j = delta^i_j.' },
      { term: 'inverse metric', meaning: 'g^ij, the matrix inverse of g_ij; it raises indices.' },
    ],
    params: [
      { key: 'alpha', label: 'Angle between e1 and e2 (deg)', min: 20, max: 160, step: 1, def: 55 },
      { key: 'l2', label: '|e2|', min: 0.3, max: 2.5, step: 0.05, def: 1.5 },
      { key: 'va', label: 'Direction of v (deg)', min: -180, max: 180, step: 1, def: 35 },
    ],
    trace(params) {
      const p = P(this.params, params), al = deg(p.alpha);
      const e1 = [1, 0], e2 = [p.l2 * Math.cos(al), p.l2 * Math.sin(al)], v = [Math.cos(deg(p.va)), Math.sin(deg(p.va))];
      const gm = [[dot(e1, e1), dot(e1, e2)], [dot(e2, e1), dot(e2, e2)]], gi = M.matInverse(gm);
      const Em = [[e1[0], e2[0]], [e1[1], e2[1]]], vu = M.matMul(M.matInverse(Em), v.map(x => [x])).map(q => q[0]);
      const g = M.T(gm, ['d', 'd']), G = M.T(gi, ['u', 'u']), Vu = M.T(vu, ['u']);
      const Vd = M.einsum('ij,j->i', g, Vu), back = M.einsum('ij,j->i', G, Vd), dd = M.einsum('ik,kj->ij', G, g);
      return trace([
        step('evaluate', 'Contravariant components: how many of each basis vector build v.', r`v^{i}`, r`v^{i} = ${vecTex(vu)}`, { focus: ['i'], viz: { scene: 'basis-dual', params: { angle: p.alpha, stretch: p.l2 } } }),
        step('lower', 'Lower the index with the metric: the cup turns the leg down.', r`v^{j}`, r`v_{i} = g_{ij} v^{j}`, { focus: ['i', 'j'], sums: [{ sym: 'j', range: [0, 2] }], numeric: { inputs: { g, v: Vu }, output: Vd } }),
        step('evaluate', 'Covariant components: the projections of v on e1 and e2.', r`v_{i}`, r`v_{i} = ${vecTex([...Vd.data])}`, { focus: ['i'] }),
        step('raise', 'Raise it again with the inverse metric: the same numbers as before.', r`v_{j}`, r`v^{i} = g^{ij} v_{j}`, { focus: ['i', 'j'], sums: [{ sym: 'j', range: [0, 2] }], numeric: { inputs: { gInv: G, v: Vd }, output: back } }),
        step('contract', 'Metric times inverse metric is the delta: a cup and a cap straighten into a line.', r`g^{ik} g_{kj}`, r`g^{ik} g_{kj} = \delta^{i}{}_{j}`, { focus: ['k'], sums: [{ sym: 'k', range: [0, 2] }], numeric: { inputs: { g, gInv: G }, output: dd } }),
      ], {
        dim: 2,
        checks: [
          check('v_1 = v . e1', Vd.data[0], dot(v, e1), 1e-12),
          check('v_2 = v . e2', Vd.data[1], dot(v, e2), 1e-12),
          check('raise(lower(v)) = v (largest error)', maxDiff(back, Vu), 0, 1e-12),
          check('g^ik g_kj = delta (largest error)', maxDiff(dd, M.kroneckerDelta(2)), 0, 1e-12),
        ],
        values: { v_up: vu, v_down: [...Vd.data] },
      });
    },
    viz: { scene: 'basis-dual', params: { angle: 55, stretch: 1.5 } },
    diagram: { style: 'penrose', order: ['g', 'v'], note: 'Lowering: a cup bends the up leg of v into a down leg. Raising: a cap.' },
    refs: [wp('Raising_and_lowering_indices'), wp('Dual_basis'), SCHUTZ, PENROSE],
  },
  // --------------------------------------------------------------------------
  {
    id: 'change-of-basis', title: 'Change of basis: vectors against covectors', field: 'algebra',
    tex: r`v'^{i} = \Lambda^{i}{}_{j}\,v^{j}, \qquad \omega'_{i} = \omega_{j}\,(\Lambda^{-1})^{j}{}_{i}, \qquad \omega'_{i}v'^{i} = \omega_{j}v^{j}`,
    itex: r`\omega'_{i} v'^{i} = \omega_{j} v^{j}`,
    shape: { rank: 1, variance: 'u and d', symmetries: '-', independent: 'n each' },
    story: [
      r`This is the heart of the upper and lower indices. Stretch every basis vector by a factor $s$. An arrow that did not move now needs $1/s$ as many basis vectors: its components shrink, $v'^{i} = v^{i}/s$. They change against the basis, so they are contravariant, and the index goes up.`,
      r`A covector is a stack of parallel planes, and its components count how many planes each basis vector crosses: $\omega_{i} = \omega(\mathbf e_{i})$. Stretch the basis vectors by $s$ and each one crosses $s$ times as many planes: $\omega'_{i} = s\,\omega_{i}$. They change with the basis, so they are covariant, and the index goes down. The gradient of a function is the standard example: its components are $\partial f/\partial x^{i}$, and they grow when the coordinate steps grow.`,
      r`In general the new components are $v'^{i} = \Lambda^{i}{}_{j}v^{j}$ and $\omega'_{i} = \omega_{j}(\Lambda^{-1})^{j}{}_{i}$. The pairing $\omega_{i}v^{i}$, the number of planes the arrow pierces, is the same in both bases because $\Lambda$ and $\Lambda^{-1}$ cancel. Einstein's rule, one index up and one down in every sum, is exactly the rule that makes each sum a basis-free number.`,
      r`Every tensor transforms with one factor per index: $\Lambda$ for each upper index, $\Lambda^{-1}$ for each lower one. You can read the transformation law straight off the index positions. In the 3D view, the arrows shrink while the plane stacks squeeze together, and the count of pierced planes stays fixed.`,
    ],
    vocab: [
      { term: 'contravariant', meaning: 'Components that change against the basis (upper index).' },
      { term: 'covariant', meaning: 'Components that change with the basis (lower index).' },
      { term: 'covector', meaning: 'A linear map from vectors to numbers; drawn as a stack of planes.' },
      { term: 'Jacobian', meaning: 'Lambda^i_j = dx\'^i/dx^j, the matrix that moves components between bases.' },
    ],
    params: [
      { key: 'stretch', label: 'Basis stretch s', min: 0.3, max: 3, step: 0.05, def: 2 },
      { key: 'angle', label: 'Basis rotation (deg)', min: -90, max: 90, step: 1, def: 0 },
    ],
    trace(params) {
      const p = P(this.params, params), s = p.stretch, a = deg(p.angle);
      // new basis e'_i = s R e_i, so components v' = (sR)^-1 v; Lambda = (sR)^-1
      const B = rot2(a).map(r0 => r0.map(x => x * s)), L = M.matInverse(B);
      const v = M.T([1.2, 0.6], ['u']), w = M.T([0.5, 1.5], ['d']);
      const v2 = M.transform(v, L), w2 = M.transform(w, L);
      const pair = M.einsum('i,i->', w, v).data[0], pair2 = M.einsum('i,i->', w2, v2).data[0];
      return trace([
        step('transform', 'Stretch the basis by s: the vector components shrink by 1/s.', r`v^{j}`, r`v'^{i} = \Lambda^{i}{}_{j} v^{j}`, { focus: ['i'], sums: [{ sym: 'j', range: [0, 2] }], numeric: { inputs: { v, Lambda: comp(L) }, output: v2 }, viz: { scene: 'vector-covector', params: { stretch: s, angle: p.angle } } }),
        step('transform', 'The covector components grow by s: each basis vector crosses more planes. The bar marks the inverse Jacobian.', r`\omega_{j}`, r`\omega'_{i} = \omega_{j} \bar{\Lambda}^{j}{}_{i}`, { focus: ['i'], sums: [{ sym: 'j', range: [0, 2] }], numeric: { inputs: { omega: w, LambdaInv: comp(B) }, output: w2 } }),
        step('contract', 'Pair them: the number of planes the arrow pierces is the same.', r`\omega'_{i} v'^{j}`, r`\omega'_{i} v'^{i} = ${num(pair2, 4)}`, { focus: ['i'], sums: [{ sym: 'i', range: [0, 2] }] }),
      ], {
        dim: 2,
        checks: [
          check('pairing is invariant', pair2, pair, 1e-12),
          check('|v\'| = |v| / s (components, rotation keeps length)', Math.hypot(...v2.data), Math.hypot(...v.data) / s, 1e-12),
          check('|omega\'| = s |omega|', Math.hypot(...w2.data), s * Math.hypot(...w.data), 1e-12),
        ],
        values: { pairing: pair },
      });
    },
    viz: { scene: 'vector-covector', params: { stretch: 2, angle: 0 } },
    diagram: { style: 'penrose', order: ['\\omega', 'v'], note: 'Insert the Jacobian on a leg and its inverse on the matching leg: they cancel along the joined line.' },
    refs: [wp('Covariance_and_contravariance_of_vectors'), wp('Change_of_basis'), SCHUTZ, MTW],
  },
  // --------------------------------------------------------------------------
  {
    id: 'sym-antisym', title: 'Symmetric and antisymmetric parts', field: 'algebra',
    tex: r`T_{ij} = T_{(ij)} + T_{[ij]}, \quad T_{(ij)} = \tfrac12\left(T_{ij} + T_{ji}\right), \quad T_{[ij]} = \tfrac12\left(T_{ij} - T_{ji}\right)`,
    itex: r`T_{ij} = T_{(ij)} + T_{[ij]}`,
    shape: { rank: 2, variance: 'dd', symmetries: 'splits into symmetric + antisymmetric', independent: 'n(n+1)/2 + n(n-1)/2' },
    story: [
      r`Any tensor with two lower (or two upper) indices splits uniquely into a symmetric part and an antisymmetric part. Round brackets mean symmetrise, average over orders; square brackets mean antisymmetrise, average with the sign of each permutation.`,
      r`Counting tells you a lot. In $n$ dimensions the symmetric part has $n(n+1)/2$ independent components and the antisymmetric part $n(n-1)/2$; together $n^{2}$. In 3D that is $6 + 3$: the 3 antisymmetric components are secretly a vector (via $\epsilon$), which is why rotations, angular velocity and the magnetic field come with three numbers.`,
      r`The split is invariant. Under a change of basis both indices get the same $\Lambda^{-1}$, so a symmetric tensor stays symmetric and an antisymmetric one stays antisymmetric. This is why physics can say "the stress tensor is symmetric" without naming a basis. For a mixed tensor $T^{i}{}_{j}$ the split is not invariant; you need a metric first.`,
      r`Examples: the metric and the stress tensor are symmetric, the electromagnetic field $F_{\mu\nu}$ and the rotation part of a velocity gradient are antisymmetric. In Penrose notation a wavy bar across legs means symmetrise and a straight bar means antisymmetrise.`,
    ],
    vocab: [
      { term: 'symmetrisation', meaning: 'T_(ij): the average of T over all orders of the bracketed indices.' },
      { term: 'antisymmetrisation', meaning: 'T_[ij]: the signed average; it vanishes for symmetric T.' },
      { term: 'Hodge dual', meaning: 'In 3D, w^k = 1/2 epsilon^kij A_ij turns an antisymmetric tensor into a vector.' },
    ],
    params: [
      { key: 'sym', label: 'Symmetric strength', min: 0, max: 2, step: 0.05, def: 1 },
      { key: 'anti', label: 'Antisymmetric strength', min: 0, max: 2, step: 0.05, def: 0.6 },
    ],
    trace(params) {
      const p = P(this.params, params);
      const S0 = [[2, 0.5, 0.1], [0.5, 1, -0.3], [0.1, -0.3, 0.4]], A0 = [[0, 1, -0.4], [-1, 0, 0.7], [0.4, -0.7, 0]];
      const Tm = S0.map((r0, i) => r0.map((x, j) => p.sym * x + p.anti * A0[i][j]));
      const Tt = M.T(Tm, ['d', 'd']), S = M.symmetrize(Tt, [0, 1]), A = M.antisymmetrize(Tt, [0, 1]);
      const sumBack = M.sub(Tt, M.T({ shape: [3, 3], variance: ['d', 'd'], data: S.data.map((x, i) => x + A.data[i]) }));
      const epsU = M.leviCivita(3, ['u', 'u', 'u']), wv = M.scale(M.einsum('kij,ij->k', epsU, A), 0.5);
      return trace([
        step('symmetrize', 'Average T with its transpose: the symmetric part, 6 numbers.', r`T_{ij}`, r`T_{(ij)}`, { focus: ['i', 'j'], numeric: { inputs: { T: Tt }, output: S }, viz: { scene: 'rank2-transform', params: { matrix: M.toNested(S) } } }),
        step('antisymmetrize', 'Half the difference: the antisymmetric part, 3 numbers.', r`T_{ij}`, r`T_{[ij]}`, { focus: ['i', 'j'], numeric: { inputs: { T: Tt }, output: A } }),
        step('contract', 'In 3D the antisymmetric part is a vector: contract it with epsilon.', r`T_{[ij]}`, r`w^{k} = \frac{1}{2} \epsilon^{kij} T_{[ij]}`, { focus: ['i', 'j'], sums: [{ sym: 'i', range: [0, 3] }, { sym: 'j', range: [0, 3] }], numeric: { inputs: { A }, output: wv } }),
        step('evaluate', 'The two parts add back to T.', r`T_{(ij)} + T_{[ij]}`, r`T_{ij} = T_{(ij)} + T_{[ij]}`, { focus: [] }),
      ], {
        checks: [
          check('T = sym + antisym (largest error)', M.maxAbs(sumBack), 0, 1e-12),
          check('sym part: T_12 - T_21 = 0', S.data[1] - S.data[3], 0, 1e-12),
          check('dual vector w^1 = A_23 = 0.7 * anti', wv.data[0], 0.7 * p.anti, 1e-12),
        ],
        values: { dual: [...wv.data] },
      });
    },
    viz: { scene: 'rank2-transform', params: { matrix: [[2, 1.5, -0.3], [-0.5, 1, 0.4], [0.5, -1, 0.4]] } },
    diagram: { style: 'penrose', order: ['T'], note: 'A wavy bar across the two legs is the symmetric part, a straight bar the antisymmetric part.' },
    refs: [wp('Symmetric_tensor'), wp('Antisymmetric_tensor'), CARROLL, PENROSE],
  },
  // --------------------------------------------------------------------------
  {
    id: 'rank2-transform', title: 'Transformation law of a rank-2 tensor', field: 'algebra',
    tex: r`T'^{ab} = \Lambda^{a}{}_{c}\,\Lambda^{b}{}_{d}\,T^{cd}`,
    itex: r`T'^{ab} = \Lambda^{a}{}_{c} \Lambda^{b}{}_{d} T^{cd}`,
    shape: { rank: 2, variance: 'uu', symmetries: 'symmetric in this example', independent: 6 },
    story: [
      r`A rank-2 tensor carries one Jacobian per index. Each upper index of $T^{cd}$ is contracted with the lower index of its own copy of $\Lambda$, and the new upper index of that $\Lambda$ becomes the new index of $T'$. Read it left to right and the index positions write the law for you.`,
      r`Picture a symmetric positive $T^{ab}$ as an ellipsoid: the surface $T^{-1}_{ab}x^{a}x^{b} = 1$ with semi-axes $\sqrt{\lambda}$. A rotation turns the ellipsoid and shuffles all nine components, but its shape, the eigenvalues, trace and determinant, is the same. A stretch distorts the ellipsoid itself, and the components follow.`,
      r`In matrix language the law is $T' = \Lambda T\Lambda^{\mathsf T}$, not the similarity $\Lambda T\Lambda^{-1}$ that a $(1,1)$ tensor obeys. The two agree only for rotations, where $\Lambda^{\mathsf T} = \Lambda^{-1}$. That is why careless index placement goes unnoticed in Cartesian coordinates and fails in curved or skewed ones.`,
      r`Watch the step player: first the left $\Lambda$ acts on the first slot (each row mixes), then the right $\Lambda$ acts on the second slot (each column mixes). Each step is one contraction, one joined line in the diagram.`,
    ],
    vocab: [
      { term: 'transformation law', meaning: 'The rule that gives new components: one Lambda per upper index, one inverse per lower index.' },
      { term: 'congruence', meaning: 'T\' = L T L^T, the law for a tensor with two indices of the same kind.' },
    ],
    params: [
      { key: 'angle', label: 'Rotation (deg)', min: -180, max: 180, step: 1, def: 35 },
      { key: 'stretch', label: 'Stretch along x', min: 0.3, max: 2.5, step: 0.05, def: 1 },
    ],
    trace(params) {
      const p = P(this.params, params);
      const Tm = [[3, 0, 0], [0, 1.5, 0], [0, 0, 0.6]], L = M.matMul([[p.stretch, 0, 0], [0, 1, 0], [0, 0, 1]], rot3z(deg(p.angle)));
      const Tt = M.T(Tm, ['u', 'u']), Lt = M.T(L, ['u', 'd']);
      const half = M.einsum('ac,cd->ad', Lt, Tt), T2 = M.einsum('ac,bd,cd->ab', Lt, Lt, Tt);
      const direct = M.matMul(M.matMul(L, Tm), M.transposeM(L));
      const viaTransform = M.transform(Tt, L);
      const tr = T2.data[0] + T2.data[4] + T2.data[8];
      return trace([
        step('contract', 'The first Lambda acts on the first slot.', r`T^{cd}`, r`\Lambda^{a}{}_{c} T^{cd}`, { focus: ['c'], sums: [{ sym: 'c', range: [0, 3] }], numeric: { inputs: { T: Tt, Lambda: Lt }, output: half }, viz: { scene: 'rank2-transform', params: { angle: p.angle, stretch: p.stretch, matrix: Tm } } }),
        step('contract', 'The second Lambda acts on the second slot.', r`\Lambda^{a}{}_{c} T^{cd}`, r`\Lambda^{a}{}_{c} \Lambda^{b}{}_{d} T^{cd}`, { focus: ['d'], sums: [{ sym: 'd', range: [0, 3] }], numeric: { inputs: { T: Tt, Lambda: Lt }, output: T2 } }),
        step('evaluate', 'The new components.', r`T'^{ab}`, r`T'^{ab} = ${matTex(M.toNested(T2), 2)}`, { focus: ['a', 'b'] }),
      ], {
        checks: [
          check('index law = L T L^T (largest error)', Math.max(...direct.flat().map((x, i) => Math.abs(x - T2.data[i]))), 0, 1e-12),
          check('index law = MATH transform (largest error)', maxDiff(T2, viaTransform), 0, 1e-12),
          check('trace with a pure rotation and stretch 1 is 5.1; else stretch^2 weight', tr, 3 * (p.stretch ** 2 * Math.cos(deg(p.angle)) ** 2 + Math.sin(deg(p.angle)) ** 2) + 1.5 * (p.stretch ** 2 * Math.sin(deg(p.angle)) ** 2 + Math.cos(deg(p.angle)) ** 2) + 0.6, 1e-12),
        ],
        values: { trace: tr },
      });
    },
    viz: { scene: 'rank2-transform', params: { angle: 35, stretch: 1, matrix: [[3, 0, 0], [0, 1.5, 0], [0, 0, 0.6]] } },
    diagram: { style: 'penrose', order: ['\\Lambda', 'T', '\\Lambda'], note: 'Two Lambda nodes sit on the two up legs of T.' },
    refs: [wp('Tensor'), CARROLL, SCHUTZ],
  },
];
