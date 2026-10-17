// ============================================================================
//  library/entries-quantum.js  ·  spin algebra, Clifford algebra, density
//  matrices and quantum circuits as tensor networks
// ----------------------------------------------------------------------------
//  Complex matrices are [re, im] pairs of nested arrays (local helpers);
//  Components passed to Step.numeric are real (real parts, traces, or
//  real amplitudes). Kets carry upper indices, bras lower indices, so a
//  matrix element is A^a_b and every sum joins a ket slot to a bra slot.
//  Dirac matrices use the signature (-, +, +, +) of the rest of the page.
//
//  ENTRIES   (grep -n "id: '<id>'" entries-quantum.js)
//      pauli-algebra  dirac-clifford  partial-trace  circuit-network
// ============================================================================
import * as M from './math.js';
import { step, trace, check, P, num, vecTex, matTex, wp, NIELSEN, BRIDGEMAN, PENROSE, CVITANOVIC } from './kit.js';

const r = String.raw;
const deg = d => d * Math.PI / 180;

// ---- complex matrices: { re, im } ------------------------------------------
const cz = n => ({ re: Array.from({ length: n }, () => new Array(n).fill(0)), im: Array.from({ length: n }, () => new Array(n).fill(0)) });
const cmul = (A, B) => { const n = A.re.length, C = cz(n); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) { C.re[i][j] += A.re[i][k] * B.re[k][j] - A.im[i][k] * B.im[k][j]; C.im[i][j] += A.re[i][k] * B.im[k][j] + A.im[i][k] * B.re[k][j]; } return C; };
const cadd = (A, B, k = 1) => ({ re: A.re.map((r0, i) => r0.map((v, j) => v + k * B.re[i][j])), im: A.im.map((r0, i) => r0.map((v, j) => v + k * B.im[i][j])) });
const cscale = (A, s) => ({ re: A.re.map(r0 => r0.map(v => v * s)), im: A.im.map(r0 => r0.map(v => v * s)) });
const cmaxDiff = (A, B) => { let m = 0; A.re.forEach((r0, i) => r0.forEach((v, j) => { m = Math.max(m, Math.abs(v - B.re[i][j]), Math.abs(A.im[i][j] - B.im[i][j])); })); return m; };
const cid = n => { const C = cz(n); for (let i = 0; i < n; i++) C.re[i][i] = 1; return C; };
const block = (a, b, c, d) => { const n = a.re.length, C = cz(2 * n); for (const [Q, oi, oj] of [[a, 0, 0], [b, 0, n], [c, n, 0], [d, n, n]]) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { C.re[oi + i][oj + j] = Q.re[i][j]; C.im[oi + i][oj + j] = Q.im[i][j]; } return C; };
const ctrace = A => A.re.reduce((s, r0, i) => s + r0[i], 0);
const PAULI = [
  { re: [[0, 1], [1, 0]], im: [[0, 0], [0, 0]] },
  { re: [[0, 0], [0, 0]], im: [[0, -1], [1, 0]] },
  { re: [[1, 0], [0, -1]], im: [[0, 0], [0, 0]] },
];

export const QUANTUM = [
  // --------------------------------------------------------------------------
  {
    id: 'pauli-algebra', title: 'Pauli matrices and the epsilon of spin', field: 'quantum',
    tex: r`\sigma_{a}\sigma_{b} = \delta_{ab}\,\mathbb{1} + i\,\epsilon_{abc}\,\sigma^{c}, \qquad [\sigma_{a}, \sigma_{b}] = 2i\,\epsilon_{abc}\,\sigma^{c}`,
    itex: r`\sigma_{a} \sigma_{b} = \delta_{ab} I + i \epsilon_{abc} \sigma^{c}`,
    shape: { rank: 3, variance: 'd (a) and a 2x2 matrix for each a', symmetries: 'Hermitian, traceless, tr(sigma_a sigma_b) = 2 delta_ab', independent: 3 },
    story: [
      r`The three Pauli matrices $\sigma_{a}$ are the spin of an electron along the axes $x, y, z$, in units of $\hbar/2$. Each one is a $2\times2$ matrix, so $\sigma_{a}$ is really a rank-3 object: one index $a$ in ordinary space and two matrix indices in the spin space. This entry writes only the space index; the matrix indices are summed by matrix multiplication.`,
      r`The product rule packs all of spin algebra into one line. The symmetric part, $\delta_{ab}$, says each $\sigma_{a}$ squares to the identity and different ones anticommute. The antisymmetric part is the Levi-Civita symbol: $\sigma_{x}\sigma_{y} = i\sigma_{z}$, the same structure as the cross product. The space index $c$ is raised with the Euclidean metric $\delta$, which changes no numbers.`,
      r`Because of this rule, $(\mathbf n\cdot\boldsymbol\sigma)^{2} = |\mathbf n|^{2}\mathbb 1$: spin along any unit direction has eigenvalues $\pm1$. The commutator $[\sigma_{a},\sigma_{b}] = 2i\epsilon_{abc}\sigma^{c}$ is the Lie algebra of rotations, with $\epsilon_{abc}$ as structure constants: the same epsilon that turns an antisymmetric tensor into a vector in 3D.`,
      r`In birdtrack notation the structure constants are a three-legged vertex, and identities like this one are proved by moving lines, which is how Cvitanovic computes group factors of particle physics.`,
    ],
    vocab: [
      { term: 'Pauli matrices', meaning: 'sigma_x, sigma_y, sigma_z: spin 1/2 along the axes.' },
      { term: 'structure constants', meaning: 'f_abc in [T_a, T_b] = i f_abc T^c; for spin, 2 epsilon_abc.' },
      { term: 'anticommutator', meaning: '{A, B} = AB + BA; for Pauli matrices 2 delta_ab.' },
    ],
    params: [
      { key: 'theta', label: 'Spin axis polar angle (deg)', min: 0, max: 180, step: 1, def: 60 },
      { key: 'phi', label: 'Spin axis azimuth (deg)', min: -180, max: 180, step: 1, def: 30 },
    ],
    trace(params) {
      const p = P(this.params, params), eps = M.leviCivita(3);
      let worst = 0;
      const gram = new M.Tensor([3, 3], ['d', 'd']);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        const lhs = cmul(PAULI[a], PAULI[b]);
        let rhs = a === b ? cid(2) : cz(2);
        for (let c = 0; c < 3; c++) { const e = eps.get(a, b, c); if (e) rhs = cadd(rhs, { re: PAULI[c].im.map(r0 => r0.map(v => -v * e)), im: PAULI[c].re.map(r0 => r0.map(v => v * e)) }); }
        worst = Math.max(worst, cmaxDiff(lhs, rhs));
        gram.set(ctrace(lhs) / 2, a, b);
      }
      const th = deg(p.theta), ph = deg(p.phi), n = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
      const S = PAULI.reduce((acc, s, a) => cadd(acc, cscale(s, n[a])), cz(2)), S2 = cmul(S, S);
      return trace([
        step('product', 'Multiply two Pauli matrices: nine products.', r`\sigma_{a}`, r`\sigma_{a} \sigma_{b}`, { focus: ['a', 'b'], viz: { scene: 'component-cube', params: { tensor: 'pauli' } } }),
        step('symmetrize', 'The symmetric part: one half the trace, the delta.', r`\sigma_{a} \sigma_{b}`, r`\frac{1}{2} \sigma_{a} \sigma_{b} + \frac{1}{2} \sigma_{b} \sigma_{a} = \delta_{ab} I`, { focus: ['a', 'b'], numeric: { inputs: {}, output: gram } }),
        step('antisymmetrize', 'The antisymmetric part: epsilon times the third matrix.', r`\sigma_{a} \sigma_{b}`, r`\frac{1}{2} \sigma_{a} \sigma_{b} - \frac{1}{2} \sigma_{b} \sigma_{a} = i \epsilon_{abc} \sigma^{c}`, { focus: ['c'], sums: [{ sym: 'c', range: [0, 3] }], numeric: { inputs: { epsilon: eps }, output: eps }, viz: { scene: 'levi-civita-cube', params: {} } }),
        step('contract', 'Spin along a direction n squares to the identity.', r`n^{a} \sigma_{a}`, r`n^{a} \sigma_{a} n^{b} \sigma_{b} = n^{a} n^{b} \delta_{ab} I`, { focus: ['a', 'b'], sums: [{ sym: 'a', range: [0, 3] }, { sym: 'b', range: [0, 3] }] }),
      ], {
        checks: [
          check('product rule on all 9 pairs (largest error)', worst, 0, 1e-15),
          check('tr(sigma_a sigma_b) / 2 = delta_ab (largest error)', M.maxAbs(M.sub(gram, M.kroneckerDelta(3, ['d', 'd']))), 0, 1e-15),
          check('(n . sigma)^2 = 1 (largest error)', cmaxDiff(S2, cid(2)), 0, 1e-12),
        ],
        values: { n },
      });
    },
    viz: { scene: 'levi-civita-cube', params: {} },
    diagram: { style: 'birdtrack', order: ['\\sigma', '\\sigma'], note: 'Two spin lines with a gluon-like leg each; the product splits into a delta line and an epsilon vertex.' },
    refs: [wp('Pauli_matrices'), NIELSEN, CVITANOVIC],
  },
  // --------------------------------------------------------------------------
  {
    id: 'dirac-clifford', title: 'Dirac matrices and the Clifford algebra', field: 'quantum',
    tex: r`\{\gamma^{\mu}, \gamma^{\nu}\} = \gamma^{\mu}\gamma^{\nu} + \gamma^{\nu}\gamma^{\mu} = -2\,\eta^{\mu\nu}\,\mathbb{1}, \qquad \not{p}\,\not{p} = -\,p_{\mu}p^{\mu}\,\mathbb{1} = m^{2}\,\mathbb{1}`,
    itex: r`\gamma^{\mu} \gamma^{\nu} + \gamma^{\nu} \gamma^{\mu} = -2 \eta^{\mu\nu} I`,
    shape: { rank: 1, variance: 'u, each a 4x4 matrix', symmetries: 'anticommute pairwise', independent: '4 matrices' },
    story: [
      r`Dirac wanted a square root of the wave equation. That needs four matrices whose anticommutators are the metric: $\gamma^{\mu}\gamma^{\nu} + \gamma^{\nu}\gamma^{\mu} = -2\eta^{\mu\nu}$. With this page's signature $(-,+,+,+)$ the sign is minus (Srednicki's convention); with $(+,-,-,-)$ books write $+2\eta^{\mu\nu}$ for the same matrices.`,
      r`The index $\mu$ is a spacetime index, so $\gamma^{\mu}$ is a four-vector of matrices, and contracting it with a covector makes a single matrix: $\not p = \gamma^{\mu}p_{\mu}$. The Clifford rule then gives $\not p\,\not p = -p_{\mu}p^{\mu} = m^{2}$: the matrix $\not p$ is a square root of the mass shell, and the Dirac equation $(\not p - m)\psi = 0$ follows.`,
      r`The algebra fixes the matrices only up to a change of basis; four is the smallest size in four dimensions, which is why the electron has four components (two spin states, particle and antiparticle). Products of gammas give 16 independent matrices, sorted by rank: scalar, vector, the six antisymmetric $\gamma^{[\mu}\gamma^{\nu]}$ that generate Lorentz transformations of spinors, axial vector and pseudoscalar.`,
    ],
    vocab: [
      { term: 'Clifford algebra', meaning: 'An algebra where vectors square to their metric length.' },
      { term: 'Feynman slash', meaning: 'pslash = gamma^m p_m.' },
      { term: 'spinor', meaning: 'The four-component object that the gamma matrices act on.' },
    ],
    params: [
      { key: 'm', label: 'Mass m', min: 0.1, max: 3, step: 0.05, def: 1 },
      { key: 'v', label: 'Speed v', min: 0, max: 0.95, step: 0.01, def: 0.6 },
    ],
    trace(params) {
      const p = P(this.params, params), Z = cz(2), I2 = cid(2), negI = cscale(I2, -1);
      // Dirac basis: gamma^0 = [[I, 0], [0, -I]], gamma^i = [[0, s_i], [-s_i, 0]]
      const G = [block(I2, Z, Z, negI), ...PAULI.map(s => block(Z, s, cscale(s, -1), Z))];
      const eta = [-1, 1, 1, 1];
      let worst = 0;
      const anti = new M.Tensor([4, 4], ['u', 'u']);
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
        const A = cadd(cmul(G[a], G[b]), cmul(G[b], G[a])), want = a === b ? cscale(cid(4), -2 * eta[a]) : cz(4);
        worst = Math.max(worst, cmaxDiff(A, want)); anti.set(ctrace(A) / 4, a, b);
      }
      const g = 1 / Math.sqrt(1 - p.v ** 2), pd = [-g * p.m, g * p.m * p.v, 0, 0]; // p_m (lower)
      const slash = G.reduce((acc, Gm, k) => cadd(acc, cscale(Gm, pd[k])), cz(4)), sq = cmul(slash, slash);
      return trace([
        step('product', 'All sixteen products of two gamma matrices.', r`\gamma^{\mu}`, r`\gamma^{\mu} \gamma^{\nu}`, { focus: ['mu', 'nu'] }),
        step('symmetrize', 'Their anticommutators are minus twice the metric.', r`\gamma^{\mu} \gamma^{\nu}`, r`\gamma^{\mu} \gamma^{\nu} + \gamma^{\nu} \gamma^{\mu} = -2 \eta^{\mu\nu} I`, { focus: ['mu', 'nu'], numeric: { inputs: {}, output: anti }, viz: { scene: 'component-cube', params: { tensor: 'gamma' } } }),
        step('contract', 'Contract gamma with a four-momentum: one matrix, p slash.', r`\gamma^{\mu} p_{\nu}`, r`\gamma^{\mu} p_{\mu}`, { focus: ['mu'], sums: [{ sym: 'mu', range: [0, 4] }], numeric: { inputs: { p: M.T(pd, ['d']) }, output: M.T(slash.re, ['u', 'd']) } }),
        step('evaluate', 'Its square is the mass squared times the identity.', r`\gamma^{\mu} p_{\mu} \gamma^{\nu} p_{\nu}`, r`(\gamma^{\mu} p_{\mu})^{2} = ${num(sq.re[0][0], 4)}\, I`, { focus: [] }),
      ], {
        dim: 4, metric: 'minkowski',
        checks: [
          check('Clifford rule on all 16 pairs (largest error)', worst, 0, 1e-15),
          check('pslash^2 = m^2 (largest error)', cmaxDiff(sq, cscale(cid(4), p.m ** 2)), 0, 1e-12),
        ],
        values: { m2: sq.re[0][0] },
      });
    },
    viz: { scene: 'component-cube', params: { tensor: 'gamma' } },
    diagram: { style: 'birdtrack', order: ['\\gamma', '\\gamma'], note: 'Two gamma vertices on a spinor line; swapping them costs minus the metric.' },
    refs: [wp('Gamma_matrices'), wp('Clifford_algebra'), wp('Dirac_equation'), PENROSE],
  },
  // --------------------------------------------------------------------------
  {
    id: 'partial-trace', title: 'Partial trace and entanglement', field: 'quantum',
    tex: r`(\rho_{A})^{a}{}_{c} = \rho^{ab}{}_{cb}, \qquad \rho^{ab}{}_{cd} = \psi^{ab}\,\bar\psi_{cd}, \qquad \gamma = \operatorname{tr}\rho_{A}^{2}`,
    itex: r`\tilde{\rho}^{a}{}_{c} = \rho^{ab}{}_{cb}`,
    shape: { rank: 4, variance: 'uudd (two kets, two bras)', symmetries: 'Hermitian, trace 1, positive', independent: '15 real numbers for two qubits' },
    story: [
      r`A state of two qubits is a rank-2 tensor $\psi^{ab}$: one index per qubit, each running over 0 and 1. Its density matrix $\rho^{ab}{}_{cd} = \psi^{ab}\bar\psi_{cd}$ has two ket indices up and two bra indices down. A sum is always between a ket slot and a bra slot, the quantum form of the Einstein rule.`,
      r`To describe qubit A alone, trace out B: join B's ket index to B's bra index and sum, $(\rho_{A})^{a}{}_{c} = \rho^{ab}{}_{cb}$. The result is a $2\times2$ density matrix. In a Penrose or tensor-network diagram the partial trace is a single wire that loops from the ket of B to its bra.`,
      r`If the state is a product, $\psi^{ab} = u^{a}w^{b}$, the reduced state is pure: purity $\operatorname{tr}\rho_{A}^{2} = 1$. For the entangled state $\cos\alpha|00\rangle + \sin\alpha|11\rangle$ the reduced state is mixed, with purity $\cos^{4}\alpha + \sin^{4}\alpha$, reaching $1/2$ for a Bell state: perfect knowledge of the whole, none of the parts.`,
      r`The noise slider mixes in the maximally mixed state $\mathbb 1/4$; purity falls further, and the trace checks the closed form.`,
    ],
    vocab: [
      { term: 'density matrix', meaning: 'rho: the general quantum state, a positive matrix of trace 1.' },
      { term: 'partial trace', meaning: 'The contraction of one subsystem\'s ket with its own bra.' },
      { term: 'purity', meaning: 'tr rho^2: 1 for a pure state, 1/d for maximally mixed.' },
      { term: 'entanglement', meaning: 'A joint state that is not a product; its parts are mixed.' },
    ],
    params: [
      { key: 'alpha', label: 'Entangling angle alpha (deg)', min: 0, max: 90, step: 1, def: 30 },
      { key: 'noise', label: 'White noise p', min: 0, max: 1, step: 0.01, def: 0.1 },
    ],
    trace(params) {
      const p = P(this.params, params), a = deg(p.alpha);
      const psi = M.T([[Math.cos(a), 0], [0, Math.sin(a)]], ['u', 'u']), bra = M.T(M.toNested(psi), ['d', 'd']);
      const pure = M.einsum('ab,cd->abcd', psi, bra);
      const rho = new M.Tensor([2, 2, 2, 2], ['u', 'u', 'd', 'd']);
      for (const [i, j, k, l] of M.indexTuples([2, 2, 2, 2])) rho.set((1 - p.noise) * pure.get(i, j, k, l) + p.noise * (i === k && j === l ? 0.25 : 0), i, j, k, l);
      const rA = M.einsum('abcb->ac', rho), pur = M.einsum('ac,ca->', rA, rA).data[0];
      const d0 = (1 - p.noise) * Math.cos(a) ** 2 + p.noise / 2, d1 = (1 - p.noise) * Math.sin(a) ** 2 + p.noise / 2;
      return trace([
        step('product', 'The density matrix: ket times bra.', r`\psi^{ab}`, r`\rho^{ab}{}_{cd} = \psi^{ab} \bar{\psi}_{cd}`, { focus: ['a', 'b', 'c', 'd'], numeric: { inputs: { psi }, output: rho }, viz: { scene: 'outer-product', params: {} } }),
        step('trace', 'Join the ket and bra of qubit B and sum.', r`\rho^{ab}{}_{cd}`, r`\tilde{\rho}^{a}{}_{c} = \rho^{ab}{}_{cb}`, { focus: ['b'], sums: [{ sym: 'b', range: [0, 2] }], numeric: { inputs: { rho }, output: rA }, viz: { scene: 'contraction-block', params: { shape: [2, 2, 2, 2], axes: [1, 3] } } }),
        step('contract', 'Purity: the reduced state times itself, traced.', r`\tilde{\rho}^{a}{}_{c} \tilde{\rho}^{e}{}_{f}`, r`\tilde{\rho}^{a}{}_{c} \tilde{\rho}^{c}{}_{a}`, { focus: ['a', 'c'], sums: [{ sym: 'a', range: [0, 2] }, { sym: 'c', range: [0, 2] }] }),
        step('evaluate', 'Less than 1 means qubit A is entangled with B (or noisy).', r`\gamma`, r`\gamma = ${num(pur, 4)}`, { focus: [] }),
      ], {
        dim: 2,
        checks: [
          check('rho_A_00 = (1-p) cos^2 alpha + p/2', rA.get(0, 0), d0, 1e-12),
          check('purity = d0^2 + d1^2', pur, d0 * d0 + d1 * d1, 1e-12),
          check('trace of rho_A = 1', rA.get(0, 0) + rA.get(1, 1), 1, 1e-12),
        ],
        values: { purity: pur },
      });
    },
    viz: { scene: 'contraction-block', params: { shape: [2, 2, 2, 2], axes: [1, 3] } },
    diagram: { style: 'network', order: ['\\psi', '\\bar\\psi'], note: 'The ket node above, the bra node below; the wire of B loops from one to the other.' },
    refs: [wp('Partial_trace'), wp('Density_matrix'), NIELSEN, BRIDGEMAN],
  },
  // --------------------------------------------------------------------------
  {
    id: 'circuit-network', title: 'A quantum circuit as a tensor network', field: 'quantum',
    tex: r`\psi^{ab} = C^{ab}{}_{cd}\,H^{c}{}_{e}\,\phi^{e}\,\chi^{d}, \qquad H = \frac{1}{\sqrt2}\begin{pmatrix}1&1\\1&-1\end{pmatrix}, \quad C^{ab}{}_{cd} = \text{CNOT}`,
    itex: r`\psi^{ab} = C^{ab}{}_{cd} H^{c}{}_{e} \phi^{e} \chi^{d}`,
    shape: { rank: 4, variance: 'uudd (the CNOT gate)', symmetries: 'unitary', independent: '16 entries, a permutation' },
    story: [
      r`A quantum circuit is a tensor network. Each qubit wire carries an index; each gate is a tensor with an upper index for every output wire and a lower index for every input wire. A one-qubit gate like the Hadamard $H^{c}{}_{e}$ has one of each; the two-qubit CNOT $C^{ab}{}_{cd}$ has two of each.`,
      r`Running the circuit is contracting the network: each wire joins the upper index of one tensor to the lower index of the next. Here a qubit $\phi$ goes through a Hadamard, and then a CNOT controlled by it flips the second qubit $\chi$. Starting from $|0\rangle|0\rangle$ this makes the Bell state $(|00\rangle + |11\rangle)/\sqrt2$.`,
      r`The order of contraction is up to you; the result is the same, which the trace checks. The cost is not: on large networks the order decides whether a simulation takes seconds or the age of the universe, and finding good orders is the core of tensor-network methods such as matrix product states and of the classical simulation of quantum supremacy circuits.`,
      r`The slider rotates the first input qubit, $\phi = (\cos\alpha, \sin\alpha)$, and the entanglement of the output changes: none for $\alpha = 45°$ (the Hadamard sends it to $|0\rangle$), maximal for $\alpha = 0$.`,
    ],
    vocab: [
      { term: 'tensor network', meaning: 'A set of tensors with some legs joined; the joined legs are summed.' },
      { term: 'Hadamard gate', meaning: 'H: the one-qubit gate that maps 0 to (0+1)/sqrt2.' },
      { term: 'CNOT', meaning: 'Flips the target qubit when the control qubit is 1.' },
      { term: 'contraction order', meaning: 'The sequence of pairwise contractions; it sets the cost.' },
    ],
    params: [
      { key: 'alpha', label: 'Input angle of qubit 1 (deg)', min: 0, max: 180, step: 1, def: 0 },
    ],
    trace(params) {
      const p = P(this.params, params), a = deg(p.alpha), s = 1 / Math.SQRT2;
      const H = M.T([[s, s], [s, -s]], ['u', 'd']), phi = M.T([Math.cos(a), Math.sin(a)], ['u']), chi = M.T([1, 0], ['u']);
      const C = new M.Tensor([2, 2, 2, 2], ['u', 'u', 'd', 'd']);
      for (const [c, d] of [[0, 0], [0, 1], [1, 0], [1, 1]]) C.set(1, c, c ^ d ? 1 : 0, c, d); // a = c, b = c xor d
      const h = M.einsum('ce,e->c', H, phi), psi = M.einsum('abcd,c,d->ab', C, h, chi);
      const other = M.einsum('abcd,ce,e,d->ab', C, H, phi, chi), CH = M.einsum('abcd,ce->abed', C, H), psi2 = M.einsum('abed,e,d->ab', CH, phi, chi);
      const norm = M.einsum('ab,ab->', psi, psi).data[0], conc = 2 * Math.abs(psi.get(0, 0) * psi.get(1, 1) - psi.get(0, 1) * psi.get(1, 0));
      const h0 = (Math.cos(a) + Math.sin(a)) * s, h1 = (Math.cos(a) - Math.sin(a)) * s;
      return trace([
        step('contract', 'The Hadamard acts on qubit 1: join phi to its lower leg.', r`H^{c}{}_{e} \phi^{f}`, r`H^{c}{}_{e} \phi^{e}`, { focus: ['e'], sums: [{ sym: 'e', range: [0, 2] }], numeric: { inputs: { H, phi }, output: h }, viz: { scene: 'contraction-block', params: { shape: [2, 2], axes: [1, 0] } } }),
        step('contract', 'The CNOT takes both wires: join c and d.', r`C^{ab}{}_{cd} H^{c}{}_{e} \phi^{e} \chi^{f}`, r`\psi^{ab} = C^{ab}{}_{cd} H^{c}{}_{e} \phi^{e} \chi^{d}`, { focus: ['c', 'd'], sums: [{ sym: 'c', range: [0, 2] }, { sym: 'd', range: [0, 2] }], numeric: { inputs: { C, chi }, output: psi } }),
        step('relabel', 'Contract in another order: first K = C H (CNOT with the Hadamard), then the inputs. The same state.', r`C^{ab}{}_{cd} H^{c}{}_{e}`, r`K^{ab}{}_{ed} \phi^{e} \chi^{d}`, { focus: ['c'], numeric: { inputs: { CH }, output: psi2 } }),
        step('evaluate', 'The output amplitudes.', r`\psi^{ab}`, r`\psi^{ab} = ${matTex(M.toNested(psi), 4)}`, { focus: [] }),
      ], {
        dim: 2,
        checks: [
          check('psi^00 = (cos + sin)/sqrt2', psi.get(0, 0), h0, 1e-12),
          check('psi^11 = (cos - sin)/sqrt2', psi.get(1, 1), h1, 1e-12),
          check('norm = 1', norm, 1, 1e-12),
          check('contraction order does not change the result', Math.max(M.maxAbs(M.sub(psi, psi2)), M.maxAbs(M.sub(psi, other))), 0, 1e-12),
          check('concurrence = |cos 2 alpha|', conc, Math.abs(Math.cos(2 * a)), 1e-12),
        ],
        values: { concurrence: conc },
      });
    },
    viz: { scene: 'contraction-block', params: { shape: [2, 2, 2, 2], axes: [2, 3] } },
    diagram: { style: 'network', order: ['\\phi', 'H', 'C', '\\chi'], note: 'Wires run left to right; H is a box on wire 1, CNOT a dot on wire 1 joined to a circle on wire 2.' },
    refs: [wp('Tensor_network'), wp('Quantum_logic_gate'), NIELSEN, BRIDGEMAN],
  },
];
