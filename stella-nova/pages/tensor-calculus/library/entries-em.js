// ============================================================================
//  library/entries-em.js  ·  electromagnetism in tensor form
// ----------------------------------------------------------------------------
//  Units: Heaviside-Lorentz with c = 1 (no 4 pi in Maxwell's equations).
//  Signature (-, +, +, +). Carroll's convention for the field tensor:
//      F_{0i} = -E_i,  F_{ij} = epsilon_{ijk} B_k,  so F^{0i} = E_i.
//      d_m F^{nm} = J^n,   d_[l F_mn] = 0.
//
//  ENTRIES   (grep -n "id: '<id>'" entries-em.js)
//      field-strength  maxwell-inhomogeneous  maxwell-homogeneous
//      em-stress-energy  lorentz-force  quadrupole-moment
// ============================================================================
import * as M from './math.js';
import { step, trace, check, P, num, vecTex, matTex, comp, wp, CARROLL, JACKSON, LL2, SCHUTZ, PENROSE } from './kit.js';

const r = String.raw;
const ETA = [[-1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const deg = d => d * Math.PI / 180;

// F_{mn} (lower) and F^{mn} (upper) from E and B.
export function fieldLower(E, B) {
  const F = new M.Tensor([4, 4], ['d', 'd']);
  for (let i = 0; i < 3; i++) { F.set(-E[i], 0, i + 1); F.set(E[i], i + 1, 0); }
  F.set(B[2], 1, 2); F.set(-B[2], 2, 1); F.set(B[0], 2, 3); F.set(-B[0], 3, 2); F.set(B[1], 3, 1); F.set(-B[1], 1, 3);
  return F;
}
const raise2 = F => { const e = M.T(ETA, ['u', 'u']); return M.einsum('ma,nb,ab->mn', e, e, F); };
const EB = Fl => ({ E: [1, 2, 3].map(i => -Fl.get(0, i)), B: [Fl.get(2, 3), Fl.get(3, 1), Fl.get(1, 2)] });

export const ELECTROMAGNETISM = [
  // --------------------------------------------------------------------------
  {
    id: 'field-strength', title: 'Electromagnetic field tensor', field: 'electromagnetism',
    tex: r`F_{\mu\nu} = \partial_{\mu}A_{\nu} - \partial_{\nu}A_{\mu}, \qquad F_{\mu\nu} = \begin{pmatrix} 0 & -E_{x} & -E_{y} & -E_{z} \\ E_{x} & 0 & B_{z} & -B_{y} \\ E_{y} & -B_{z} & 0 & B_{x} \\ E_{z} & B_{y} & -B_{x} & 0 \end{pmatrix}`,
    itex: r`F_{\mu\nu} = \partial_{\mu} A_{\nu} - \partial_{\nu} A_{\mu}`,
    shape: { rank: 2, variance: 'dd', symmetries: 'antisymmetric', independent: 6 },
    story: [
      r`Electric and magnetic fields are not two things but one: the antisymmetric field tensor $F_{\mu\nu}$, the exterior derivative of the four-potential $A_{\mu} = (-\phi, \mathbf A)$. Antisymmetric in four dimensions means $4\cdot3/2 = 6$ components: three for $\mathbf E$ (the $0i$ slots) and three for $\mathbf B$ (the $ij$ slots). This page uses Carroll's signs: $F_{0i} = -E_{i}$ and $F_{ij} = \epsilon_{ijk}B^{k}$.`,
      r`Both indices are lower because $F$ is built from the gradient of a covector: $\partial_{\mu}$ is naturally lower and so is $A_{\nu}$. As a machine, $F_{\mu\nu}$ eats a four-velocity and a displacement and gives the work done on a unit charge, and it is antisymmetric because the force does no work along the direction of motion in the charge's own frame.`,
      r`Under a boost, $F$ transforms with two Lorentz matrices, so $\mathbf E$ and $\mathbf B$ mix: a pure electric field seen from a moving frame has a magnetic part. What does not change are the two invariants $F_{\mu\nu}F^{\mu\nu} = 2(B^{2} - E^{2})$ and $\epsilon^{\mu\nu\rho\sigma}F_{\mu\nu}F_{\rho\sigma} \propto \mathbf E\cdot\mathbf B$. If $E > B$ in one frame, there is a frame with no magnetic field at all.`,
      r`Adding the gradient of any function to $A_{\mu}$ leaves $F$ unchanged, because partial derivatives commute. That gauge freedom is the first example of a symmetry that physics carries in the index structure itself.`,
    ],
    vocab: [
      { term: 'four-potential', meaning: 'A_m = (-phi, A); the field tensor is its antisymmetrised derivative.' },
      { term: 'field tensor', meaning: 'F_mn: E in the time-space slots, B in the space-space slots.' },
      { term: 'gauge transformation', meaning: 'A_m -> A_m + d_m chi; F does not change.' },
      { term: 'Lorentz invariant', meaning: 'A number such as F_mn F^mn = 2(B^2 - E^2) that every frame agrees on.' },
    ],
    params: [
      { key: 'Ex', label: 'E_x', min: -2, max: 2, step: 0.05, def: 0.5 },
      { key: 'Ey', label: 'E_y', min: -2, max: 2, step: 0.05, def: 1 },
      { key: 'Bz', label: 'B_z', min: -2, max: 2, step: 0.05, def: 0.6 },
      { key: 'beta', label: 'Boost along x, beta', min: -0.95, max: 0.95, step: 0.01, def: 0.5 },
    ],
    trace(params) {
      const p = P(this.params, params), g = 1 / Math.sqrt(1 - p.beta ** 2);
      // A_m = (-phi, A) with phi = -(Ex x + Ey y), A = Bz (-y/2, x/2, 0)
      const Afield = x => M.T([p.Ex * x[1] + p.Ey * x[2], -p.Bz * x[2] / 2, p.Bz * x[1] / 2, 0], ['d']);
      const x0 = [0.2, 0.3, -0.4, 0.1];
      const { T: A, dT } = M.partialDerivative(Afield, x0); // dT[n][m] = d_m A_n
      const F = new M.Tensor([4, 4], ['d', 'd']);
      for (let m = 0; m < 4; m++) for (let n = 0; n < 4; n++) F.set(dT.get(n, m) - dT.get(m, n), m, n);
      const Fu = raise2(F), inv = M.einsum('mn,mn->', F, Fu).data[0];
      const L = M.lorentzBoost(p.beta, 1), F2 = M.transform(F, L), F2u = raise2(F2), inv2 = M.einsum('mn,mn->', F2, F2u).data[0];
      const e2 = EB(F2);
      return trace([
        step('partial', 'Differentiate the four-potential.', r`A_{\nu}`, r`\partial_{\mu} A_{\nu}`, { focus: ['mu'], numeric: { inputs: { A }, output: dT } }),
        step('antisymmetrize', 'Antisymmetrise: E in the time-space slots, B in the space-space slots.', r`\partial_{\mu} A_{\nu}`, r`F_{\mu\nu} = \partial_{\mu} A_{\nu} - \partial_{\nu} A_{\mu}`, { focus: ['mu', 'nu'], numeric: { inputs: { dA: dT }, output: F } }),
        step('evaluate', 'The field tensor.', r`F_{\mu\nu}`, r`F_{\mu\nu} = ${matTex(M.toNested(F), 2)}`, { focus: [] }),
        step('transform', 'Boost along x: E and B mix.', r`F_{\mu\nu}`, r`F'_{\mu\nu} = \bar{\Lambda}^{\alpha}{}_{\mu} \bar{\Lambda}^{\beta}{}_{\nu} F_{\alpha\beta}`, { focus: ['mu', 'nu'], sums: [{ sym: 'alpha', range: [0, 4] }, { sym: 'beta', range: [0, 4] }], numeric: { inputs: { F, Lambda: comp(L) }, output: F2 }, viz: { scene: 'lorentz-boost', params: { beta: p.beta, E: [p.Ex, p.Ey, 0], B: [0, 0, p.Bz], show: 'field' } } }),
        step('contract', 'The invariant F F is the same in both frames.', r`F_{\mu\nu} F^{\alpha\beta}`, r`F_{\mu\nu} F^{\mu\nu} = ${num(inv2, 4)}`, { focus: ['mu', 'nu'], sums: [{ sym: 'mu', range: [0, 4] }, { sym: 'nu', range: [0, 4] }] }),
      ], {
        dim: 4, metric: 'minkowski',
        checks: [
          check('F_01 = -E_x', F.get(0, 1), -p.Ex, 1e-9),
          check('F_12 = B_z', F.get(1, 2), p.Bz, 1e-9),
          check('F F = 2 (B^2 - E^2)', inv, 2 * (p.Bz ** 2 - p.Ex ** 2 - p.Ey ** 2), 1e-8),
          check('invariant after the boost', inv2, inv, 1e-8),
          check('E\'_y = gamma (E_y - beta B_z)', e2.E[1], g * (p.Ey - p.beta * p.Bz), 1e-8),
          check('B\'_z = gamma (B_z - beta E_y)', e2.B[2], g * (p.Bz - p.beta * p.Ey), 1e-8),
          check('E\'_x = E_x (along the boost)', e2.E[0], p.Ex, 1e-8),
        ],
        values: { invariant: inv },
      });
    },
    viz: { scene: 'lorentz-boost', params: { beta: 0.5, show: 'field' } },
    diagram: { style: 'penrose', order: ['\\partial', 'A'], note: 'A derivative box round A with a straight antisymmetry bar over the two down legs.' },
    refs: [wp('Electromagnetic_tensor'), CARROLL, JACKSON, LL2],
  },
  // --------------------------------------------------------------------------
  {
    id: 'maxwell-inhomogeneous', title: 'Maxwell equations with sources', field: 'electromagnetism',
    tex: r`\partial_{\mu}F^{\nu\mu} = J^{\nu} \quad\Longleftrightarrow\quad \nabla\cdot\mathbf E = \rho, \quad \nabla\times\mathbf B - \partial_{t}\mathbf E = \mathbf J`,
    itex: r`\partial_{\mu} F^{\nu\mu} = J^{\nu}`,
    shape: { rank: 1, variance: 'u', symmetries: '-', independent: '4 equations' },
    story: [
      r`Gauss's law and the Ampere-Maxwell law are one tensor equation: the divergence of the field tensor is the four-current $J^{\nu} = (\rho, \mathbf J)$. The $\nu = 0$ row gives $\nabla\cdot\mathbf E = \rho$; the three space rows give $\nabla\times\mathbf B - \partial_{t}\mathbf E = \mathbf J$. Units are Heaviside-Lorentz with $c = 1$, so no $4\pi$ appears.`,
      r`Index bookkeeping: the derivative index $\mu$ is contracted with the second index of $F^{\nu\mu}$, so one upper index $\nu$ is free on each side. Swapping the order to $\partial_{\mu}F^{\mu\nu}$ flips the sign, since $F$ is antisymmetric; books differ here, and the sign must match how $F$ was defined.`,
      r`Take one more divergence: $\partial_{\nu}\partial_{\mu}F^{\nu\mu} = 0$, because a symmetric pair of derivatives meets an antisymmetric tensor. So $\partial_{\nu}J^{\nu} = 0$: charge conservation is built into the shape of Maxwell's equations. In curved spacetime the same equation holds with $\nabla$ in place of $\partial$.`,
      r`The trace computes the divergence numerically for a field inside a uniformly charged ball carrying a uniform current along z, and recovers the source: the charge density and the current density.`,
    ],
    vocab: [
      { term: 'four-current', meaning: 'J^n = (rho, J): charge density and current density.' },
      { term: 'Heaviside-Lorentz units', meaning: 'Units with no 4 pi in Maxwell\'s equations; Coulomb\'s law is q/(4 pi r^2).' },
      { term: 'charge conservation', meaning: 'd_n J^n = 0, which follows from the antisymmetry of F.' },
    ],
    params: [
      { key: 'rho', label: 'Charge density rho', min: -2, max: 2, step: 0.05, def: 1 },
      { key: 'j', label: 'Current density J_z', min: -2, max: 2, step: 0.05, def: 0.7 },
    ],
    trace(params) {
      const p = P(this.params, params);
      // inside: E = rho x / 3, B = (j/2)(-y, x, 0)
      const Fup = x => fieldLowerToUpper(fieldLower([p.rho * x[1] / 3, p.rho * x[2] / 3, p.rho * x[3] / 3], [-p.j * x[2] / 2, p.j * x[1] / 2, 0]));
      const x0 = [0, 0.2, -0.1, 0.3];
      const { T: F, dT } = M.partialDerivative(Fup, x0); // [n, m ; l]
      const J = M.einsum('nmm->n', dT);
      return trace([
        step('partial', 'Differentiate every component of F.', r`F^{\nu\mu}`, r`\partial_{\lambda} F^{\nu\mu}`, { focus: ['lambda'], numeric: { inputs: { F }, output: dT } }),
        step('contract', 'Contract the derivative with the second index: the four-current.', r`\partial_{\lambda} F^{\nu\mu}`, r`\partial_{\mu} F^{\nu\mu} = J^{\nu}`, { focus: ['mu'], sums: [{ sym: 'mu', range: [0, 4] }], numeric: { inputs: {}, output: J }, viz: { scene: 'contraction-block', params: { shape: [4, 4, 4], axes: [1, 2] } } }),
        step('evaluate', 'The source comes back: (rho, 0, 0, J_z).', r`J^{\nu}`, r`J^{\nu} = ${vecTex([...J.data])}`, { focus: [] }),
      ], {
        dim: 4, metric: 'minkowski',
        checks: [
          check('J^0 = rho (Gauss)', J.get(0), p.rho, 1e-8),
          check('J^3 = J_z (Ampere)', J.get(3), p.j, 1e-8),
          check('J^1 = J^2 = 0', Math.abs(J.get(1)) + Math.abs(J.get(2)), 0, 1e-8),
        ],
        values: { J: [...J.data] },
      });
    },
    viz: { scene: 'contraction-block', params: { shape: [4, 4, 4], axes: [1, 2] } },
    diagram: { style: 'penrose', order: ['\\partial', 'F', 'J'], note: 'The derivative leg joins the second up leg of F; one up leg stays free.' },
    refs: [wp('Maxwell%27s_equations'), wp('Covariant_formulation_of_classical_electromagnetism'), CARROLL, JACKSON],
  },
  // --------------------------------------------------------------------------
  {
    id: 'maxwell-homogeneous', title: 'Maxwell equations without sources (Bianchi)', field: 'electromagnetism',
    tex: r`\partial_{[\lambda}F_{\mu\nu]} = 0 \quad\Longleftrightarrow\quad \nabla\cdot\mathbf B = 0, \quad \nabla\times\mathbf E + \partial_{t}\mathbf B = 0`,
    itex: r`\partial_{[\lambda} F_{\mu\nu]} = 0`,
    shape: { rank: 3, variance: 'ddd', symmetries: 'totally antisymmetric', independent: '4 equations in 4D' },
    story: [
      r`The other half of Maxwell's equations has no sources at all. It says that the totally antisymmetric derivative of $F$ is zero. A totally antisymmetric rank-3 tensor in four dimensions has $\binom{4}{3} = 4$ components, so this is four equations: $\nabla\cdot\mathbf B = 0$ (the $123$ component) and Faraday's law (the three components with a $0$).`,
      r`It is automatic when $F = dA$: the cyclic sum of $\partial_{\lambda}(\partial_{\mu}A_{\nu} - \partial_{\nu}A_{\mu})$ cancels in pairs because partial derivatives commute. This is the electromagnetic version of the Bianchi identity, and the shape is the same as $\nabla_{[\lambda}R_{\rho\sigma]\mu\nu} = 0$ for gravity: the boundary of a boundary is zero.`,
      r`All three indices are lower, and no metric appears: the equation makes sense on any manifold, curved or not, with $\partial$ or $\nabla$ (the Christoffel terms cancel by symmetry). Magnetic monopoles would put a source on the right and break the identity, which is why their absence is part of the geometry of $A$.`,
      r`The trace uses a plane wave $A_{y} = a\cos k(x - t)$, checks the cyclic sum on all 64 components, and checks that the wave is a null field: $|\mathbf E| = |\mathbf B|$ and $\mathbf E\perp\mathbf B$.`,
    ],
    vocab: [
      { term: 'exterior derivative', meaning: 'The antisymmetrised derivative; d(dA) = 0 always.' },
      { term: 'null field', meaning: 'A field with F F = 0 and E.B = 0, such as a plane wave.' },
      { term: 'Faraday\'s law', meaning: 'curl E + dB/dt = 0.' },
    ],
    params: [
      { key: 'a', label: 'Wave amplitude', min: 0.1, max: 2, step: 0.05, def: 1 },
      { key: 'k', label: 'Wave number k', min: 0.2, max: 4, step: 0.05, def: 1.5 },
      { key: 'x', label: 'Position x', min: -3, max: 3, step: 0.05, def: 0.3 },
    ],
    trace(params) {
      const p = P(this.params, params);
      const Afield = x => M.T([0, 0, p.a * Math.cos(p.k * (x[1] - x[0])), 0], ['d']);
      const Ffield = x => { const { dT } = M.partialDerivative(Afield, x, 1e-3); const F = new M.Tensor([4, 4], ['d', 'd']); for (let m = 0; m < 4; m++) for (let n = 0; n < 4; n++) F.set(dT.get(n, m) - dT.get(m, n), m, n); return F; };
      const x0 = [0.1, p.x, 0.2, -0.3];
      const F = Ffield(x0), { dT } = M.partialDerivative(Ffield, x0, 1e-3); // [m, n ; l]
      let cyc = 0, size = 0;
      for (const [l, m, n] of M.indexTuples([4, 4, 4])) { cyc = Math.max(cyc, Math.abs(dT.get(m, n, l) + dT.get(n, l, m) + dT.get(l, m, n))); size = Math.max(size, Math.abs(dT.get(m, n, l))); }
      const { E, B } = EB(F), inv = M.einsum('mn,mn->', F, raise2(F)).data[0];
      return trace([
        step('antisymmetrize', 'The field of the wave from its potential.', r`A_{\nu}`, r`F_{\mu\nu} = \partial_{\mu} A_{\nu} - \partial_{\nu} A_{\mu}`, { focus: ['mu', 'nu'], numeric: { inputs: {}, output: F }, viz: { scene: 'lorentz-boost', params: { show: 'field', E, B } } }),
        step('partial', 'Differentiate it again.', r`F_{\mu\nu}`, r`\partial_{\lambda} F_{\mu\nu}`, { focus: ['lambda'], numeric: { inputs: { F }, output: dT } }),
        step('antisymmetrize', 'Sum the three cyclic orders: every component cancels.', r`\partial_{\lambda} F_{\mu\nu}`, r`\partial_{\lambda} F_{\mu\nu} + \partial_{\mu} F_{\nu\lambda} + \partial_{\nu} F_{\lambda\mu}`, { focus: ['lambda', 'mu', 'nu'] }),
        step('evaluate', 'A plane wave is a null field: E and B have the same size and are perpendicular.', r`F_{\mu\nu} F^{\mu\nu}`, r`F_{\mu\nu} F^{\mu\nu} = ${num(inv, 6)}`, { focus: [] }),
      ], {
        dim: 4, metric: 'minkowski',
        checks: [
          check('cyclic sum / size of dF', cyc / Math.max(size, 1e-30), 0, 1e-5),
          check('|E| = |B| for the wave', Math.hypot(...E), Math.hypot(...B), 1e-6),
          check('E . B = 0', dot(E, B), 0, 1e-6),
          check('E_y = -dA_y/dt = -a k sin k(x - t)', E[1], -p.a * p.k * Math.sin(p.k * (x0[1] - x0[0])), 1e-6),
        ],
        values: { invariant: inv },
      });
    },
    viz: { scene: 'lorentz-boost', params: { show: 'field' } },
    diagram: { style: 'penrose', order: ['\\partial', 'F'], note: 'A straight antisymmetry bar across the derivative leg and both legs of F.' },
    refs: [wp('Maxwell%27s_equations'), wp('Electromagnetic_tensor'), CARROLL, PENROSE],
  },
  // --------------------------------------------------------------------------
  {
    id: 'em-stress-energy', title: 'Electromagnetic stress-energy tensor', field: 'electromagnetism',
    tex: r`T^{\mu\nu} = F^{\mu\lambda}F^{\nu}{}_{\lambda} - \tfrac14\,g^{\mu\nu}F_{\lambda\sigma}F^{\lambda\sigma}, \qquad T^{00} = \tfrac12\left(E^{2} + B^{2}\right), \quad T^{0i} = (\mathbf E\times\mathbf B)^{i}`,
    itex: r`T^{\mu\nu} = F^{\mu\lambda} F^{\nu}{}_{\lambda} - \frac{1}{4} g^{\mu\nu} F_{\lambda\sigma} F^{\lambda\sigma}`,
    shape: { rank: 2, variance: 'uu', symmetries: 'symmetric and traceless', independent: '9 (10 minus the trace)' },
    story: [
      r`The field carries energy, momentum and stress, and they all sit in one symmetric tensor built from two copies of $F$. $T^{00}$ is the energy density $\frac12(E^{2} + B^{2})$, $T^{0i}$ is the Poynting vector $\mathbf E\times\mathbf B$, the energy flux, and $T^{ij}$ is the Maxwell stress: field lines pull along their length and push sideways.`,
      r`Watch the indices: in the first term $\lambda$ is summed between an upper slot of one $F$ and a lower slot of the other; in the second, both indices of each $F$ are summed, giving the invariant $F_{\lambda\sigma}F^{\lambda\sigma}$, multiplied by the inverse metric to give it the two free upper indices $\mu\nu$.`,
      r`The tensor is traceless: $g_{\mu\nu}T^{\mu\nu} = F^{\mu\lambda}F_{\mu\lambda} - \frac14\cdot4\cdot F_{\lambda\sigma}F^{\lambda\sigma} = 0$, because $g_{\mu\nu}g^{\mu\nu} = 4$. Tracelessness is the tensor statement that light has no rest mass, the same as radiation with $p = \rho/3$ in a perfect fluid.`,
      r`Energy-momentum conservation, $\partial_{\mu}T^{\mu\nu} = -F^{\nu}{}_{\lambda}J^{\lambda}$, follows from Maxwell's equations: the field loses exactly the energy and momentum that the Lorentz force gives to the charges.`,
    ],
    vocab: [
      { term: 'Poynting vector', meaning: 'E x B, the energy flux of the field.' },
      { term: 'Maxwell stress tensor', meaning: 'The space-space block of T: field-line tension and pressure.' },
      { term: 'traceless', meaning: 'g_mn T^mn = 0; for EM it reflects the massless photon.' },
    ],
    params: [
      { key: 'Ex', label: 'E_x', min: -2, max: 2, step: 0.05, def: 1 },
      { key: 'Ey', label: 'E_y', min: -2, max: 2, step: 0.05, def: 0.3 },
      { key: 'Bz', label: 'B_z', min: -2, max: 2, step: 0.05, def: 0.8 },
      { key: 'Bx', label: 'B_x', min: -2, max: 2, step: 0.05, def: -0.4 },
    ],
    trace(params) {
      const p = P(this.params, params), E = [p.Ex, p.Ey, 0], B = [p.Bx, 0, p.Bz];
      const Fl = fieldLower(E, B), Fu = raise2(Fl), eta = M.T(ETA, ['d', 'd']), gi = M.T(ETA, ['u', 'u']);
      const Fmix = M.einsum('nb,bl->nl', Fu, eta); // F^n_l
      const t1 = M.einsum('ml,nl->mn', Fu, Fmix), inv = M.einsum('ls,ls->', Fl, Fu).data[0];
      const Tt = M.T({ shape: [4, 4], variance: ['u', 'u'], data: t1.data.map((v, i) => v - 0.25 * gi.data[i] * inv) });
      const tr = M.einsum('mn,mn->', eta, Tt).data[0], S = cross(E, B);
      return trace([
        step('contract', 'Join one leg of each F: the first term.', r`F^{\mu\lambda} F^{\nu}{}_{\sigma}`, r`F^{\mu\lambda} F^{\nu}{}_{\lambda}`, { focus: ['lambda'], sums: [{ sym: 'lambda', range: [0, 4] }], numeric: { inputs: { F: Fu }, output: t1 } }),
        step('contract', 'Join both legs: the invariant F F.', r`F_{\lambda\sigma} F^{\alpha\beta}`, r`F_{\lambda\sigma} F^{\lambda\sigma} = ${num(inv, 4)}`, { focus: ['lambda', 'sigma'], sums: [{ sym: 'lambda', range: [0, 4] }, { sym: 'sigma', range: [0, 4] }] }),
        step('substitute', 'Subtract a quarter of it times the inverse metric.', r`F^{\mu\lambda} F^{\nu}{}_{\lambda}`, r`T^{\mu\nu} = F^{\mu\lambda} F^{\nu}{}_{\lambda} - \frac{1}{4} g^{\mu\nu} F_{\lambda\sigma} F^{\lambda\sigma}`, { focus: ['mu', 'nu'], numeric: { inputs: { first: t1 }, output: Tt } }),
        step('evaluate', 'Energy density, Poynting flux and Maxwell stress.', r`T^{\mu\nu}`, r`T^{\mu\nu} = ${matTex(M.toNested(Tt), 3)}`, { focus: [] }),
      ], {
        dim: 4, metric: 'minkowski',
        checks: [
          check('T^00 = (E^2 + B^2) / 2', Tt.get(0, 0), (dot(E, E) + dot(B, B)) / 2, 1e-12),
          check('T^01 = (E x B)_x', Tt.get(0, 1), S[0], 1e-12),
          check('T^02 = (E x B)_y', Tt.get(0, 2), S[1], 1e-12),
          check('traceless', tr, 0, 1e-12),
          check('symmetric: T^12 = T^21', Tt.get(1, 2), Tt.get(2, 1), 1e-12),
        ],
        values: { energy: Tt.get(0, 0), poynting: S },
      });
    },
    viz: { scene: 'stress-cube', params: { show: 'maxwell' } },
    diagram: { style: 'penrose', order: ['F', 'F', 'g', 'F', 'F'], note: 'Two F nodes joined by one line, minus a quarter of a closed F-F loop times the metric cap.' },
    refs: [wp('Electromagnetic_stress%E2%80%93energy_tensor'), wp('Poynting_vector'), JACKSON, CARROLL],
  },
  // --------------------------------------------------------------------------
  {
    id: 'lorentz-force', title: 'Lorentz force law', field: 'electromagnetism',
    tex: r`\frac{dp^{\mu}}{d\tau} = q\,F^{\mu}{}_{\nu}\,u^{\nu} \quad\Longleftrightarrow\quad \frac{d\mathbf p}{dt} = q\left(\mathbf E + \mathbf v\times\mathbf B\right), \quad \frac{dE}{dt} = q\,\mathbf E\cdot\mathbf v`,
    itex: r`f^{\mu} = q F^{\mu}{}_{\nu} u^{\nu}`,
    shape: { rank: 1, variance: 'u', symmetries: 'f . u = 0', independent: '4 (3 independent)' },
    story: [
      r`The force on a charge is the field tensor fed the charge's four-velocity: one index of $F$ is lowered with the metric so that it can contract with $u^{\nu}$, and the free upper $\mu$ is the direction of the force. The space part is the familiar $q(\mathbf E + \mathbf v\times\mathbf B)$ times $\gamma$; the time part is the power $q\,\mathbf E\cdot\mathbf v$ times $\gamma$.`,
      r`Because $F_{\mu\nu}$ is antisymmetric, $u_{\mu}F^{\mu}{}_{\nu}u^{\nu} = F_{\mu\nu}u^{\mu}u^{\nu} = 0$: the four-force is perpendicular to the four-velocity, so the rest mass never changes. In the charge's own frame the magnetic part does no work: that is the tensor reason why magnetic forces only bend paths.`,
      r`The mixed tensor $F^{\mu}{}_{\nu}$ is a generator of Lorentz transformations: a pure magnetic field rotates the velocity, a pure electric field boosts it. A charge in a constant field moves along the orbit of the one-parameter group $e^{qF\tau/m}$, a circle in a magnetic field, a hyperbola in an electric field.`,
    ],
    vocab: [
      { term: 'four-force', meaning: 'f^m = dp^m/dtau.' },
      { term: 'generator', meaning: 'A matrix whose exponential gives a family of transformations.' },
    ],
    params: [
      { key: 'q', label: 'Charge q', min: -2, max: 2, step: 0.05, def: 1 },
      { key: 'vx', label: 'Velocity v_x', min: -0.7, max: 0.7, step: 0.01, def: 0.4 },
      { key: 'vy', label: 'Velocity v_y', min: -0.7, max: 0.7, step: 0.01, def: 0.2 },
      { key: 'Ey', label: 'E_y', min: -2, max: 2, step: 0.05, def: 0.5 },
      { key: 'Bz', label: 'B_z', min: -2, max: 2, step: 0.05, def: 1 },
    ],
    trace(params) {
      const p = P(this.params, params), v = [p.vx, p.vy, 0], g = 1 / Math.sqrt(1 - dot(v, v));
      const E = [0, p.Ey, 0], B = [0, 0, p.Bz], Fu = raise2(fieldLower(E, B)), eta = M.T(ETA, ['d', 'd']);
      const Fmix = M.einsum('ml,ln->mn', Fu, eta), u = M.T([g, g * v[0], g * v[1], 0], ['u']);
      const f = M.scale(M.einsum('mn,n->m', Fmix, u), p.q), fu = M.einsum('mn,m,n->', eta, f, u).data[0];
      const want = cross(v, B).map((c, i) => p.q * g * (E[i] + c));
      return trace([
        step('lower', 'Lower the second index of F with the metric.', r`F^{\mu\lambda}`, r`F^{\mu}{}_{\nu} = F^{\mu\lambda} \eta_{\lambda\nu}`, { focus: ['lambda'], sums: [{ sym: 'lambda', range: [0, 4] }], numeric: { inputs: { F: Fu }, output: Fmix } }),
        step('contract', 'Feed it the four-velocity.', r`F^{\mu}{}_{\nu} u^{\lambda}`, r`f^{\mu} = q F^{\mu}{}_{\nu} u^{\nu}`, { focus: ['nu'], sums: [{ sym: 'nu', range: [0, 4] }], numeric: { inputs: { F: Fmix, u }, output: f }, viz: { scene: 'lorentz-boost', params: { show: 'field', E, B } } }),
        step('evaluate', 'The four-force: power, then gamma times E + v x B.', r`f^{\mu}`, r`f^{\mu} = ${vecTex([...f.data])}`, { focus: [] }),
      ], {
        dim: 4, metric: 'minkowski',
        checks: [
          check('f^x = q gamma (E + v x B)_x', f.get(1), want[0], 1e-12),
          check('f^y = q gamma (E + v x B)_y', f.get(2), want[1], 1e-12),
          check('f^0 = q gamma E . v', f.get(0), p.q * g * dot(E, v), 1e-12),
          check('f . u = 0', fu, 0, 1e-12),
        ],
        values: { force: [...f.data] },
      });
    },
    viz: { scene: 'lorentz-boost', params: { show: 'field' } },
    diagram: { style: 'penrose', order: ['F', 'u'], note: 'The u node hangs on the down leg of F.' },
    refs: [wp('Lorentz_force'), JACKSON, SCHUTZ],
  },
  // --------------------------------------------------------------------------
  {
    id: 'quadrupole-moment', title: 'Electric quadrupole moment', field: 'electromagnetism',
    tex: r`Q_{ij} = \sum_{n} q_{n}\left(3x_{n,i}x_{n,j} - r_{n}^{2}\delta_{ij}\right), \qquad \phi(\mathbf r) \approx \frac{1}{4\pi}\left(\frac{Q}{r} + \frac{p_{i}n_{i}}{r^{2}} + \frac{Q_{ij}n_{i}n_{j}}{2r^{3}}\right)`,
    itex: r`Q_{ij} = q (3 x_{i} x_{j} - r^{2} \delta_{ij})`,
    shape: { rank: 2, variance: 'dd (Cartesian, orthonormal)', symmetries: 'symmetric and traceless', independent: 5 },
    story: [
      r`Far from a cluster of charges the potential is a series: total charge, then dipole, then quadrupole. The quadrupole term needs a rank-2 tensor because it describes how the charge is stretched along some axes and squeezed along others. This entry works in Cartesian coordinates with an orthonormal basis, where upper and lower indices are the same and every index is written down.`,
      r`$Q_{ij}$ is symmetric and traceless: $Q_{ii} = \sum q(3r^{2} - 3r^{2}) = 0$. So of its 9 components only 5 are independent, matching the 5 spherical harmonics with $\ell = 2$. The trace subtraction $r^{2}\delta_{ij}$ is exactly what removes the part that a spherical charge cloud would have, which produces no quadrupole field.`,
      r`Rotate the charges and $Q$ transforms as $Q' = RQR^{\mathsf T}$, a rank-2 tensor; its eigenvectors are the principal axes of the distribution. The Earth's oblateness, the shape of atomic nuclei, and the gravitational waves of a binary star, which come from the second time derivative of the mass quadrupole, are all this tensor.`,
      r`The trace places $+q$ at $\pm d$ on a tilted axis and $-2q$ at the centre (a linear quadrupole), computes $Q_{ij}$, and checks the far-field potential against the exact sum over charges.`,
    ],
    vocab: [
      { term: 'multipole expansion', meaning: 'The far-field series: monopole, dipole, quadrupole and so on.' },
      { term: 'principal axes', meaning: 'The eigenvectors of Q: the axes of stretch and squeeze.' },
      { term: 'traceless', meaning: 'Q_ii = 0, so only 5 of 9 components are free.' },
    ],
    params: [
      { key: 'q', label: 'Charge q', min: -2, max: 2, step: 0.05, def: 1 },
      { key: 'd', label: 'Spacing d', min: 0.1, max: 1, step: 0.01, def: 0.5 },
      { key: 'tilt', label: 'Axis tilt (deg)', min: 0, max: 90, step: 1, def: 30 },
      { key: 'view', label: 'Viewing angle (deg)', min: 0, max: 180, step: 1, def: 50 },
    ],
    trace(params) {
      const p = P(this.params, params), t = deg(p.tilt), ax = [Math.sin(t), 0, Math.cos(t)];
      const charges = [[p.q, ax.map(c => c * p.d)], [p.q, ax.map(c => -c * p.d)], [-2 * p.q, [0, 0, 0]]];
      const Q = new M.Tensor([3, 3], ['d', 'd']);
      for (const [q, x] of charges) { const r2 = dot(x, x); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) Q.set(Q.get(i, j) + q * (3 * x[i] * x[j] - (i === j ? r2 : 0)), i, j); }
      const tr = Q.get(0, 0) + Q.get(1, 1) + Q.get(2, 2), v = deg(p.view), n = [Math.sin(v), 0, Math.cos(v)], R = 60;
      const quad = M.einsum('ij,i,j->', Q, M.T(n, ['u']), M.T(n, ['u'])).data[0] / (2 * R ** 3) / (4 * Math.PI);
      const exact = charges.reduce((s, [q, x]) => s + q / (4 * Math.PI * Math.hypot(...n.map((c, i) => R * c - x[i]))), 0);
      const cosA = dot(n, ax), want = 4 * p.q * p.d ** 2 * (3 * cosA * cosA - 1) / 2;
      return trace([
        step('product', 'For each charge, the outer product of its position with itself.', r`x_{i}`, r`x_{i} x_{j}`, { focus: ['i', 'j'], viz: { scene: 'inertia-ellipsoid', params: { I: M.toNested(Q), show: 'quadrupole' } } }),
        step('substitute', 'Subtract the trace part and sum over the charges.', r`x_{i} x_{j}`, r`Q_{ij} = q (3 x_{i} x_{j} - r^{2} \delta_{ij})`, { focus: ['i', 'j'], numeric: { inputs: {}, output: Q } }),
        step('evaluate', 'The quadrupole tensor: symmetric, trace zero.', r`Q_{ij}`, r`Q_{ij} = ${matTex(M.toNested(Q), 3)}`, { focus: [] }),
        step('contract', 'Feed it the viewing direction twice: the far-field potential.', r`Q_{ij} n^{k} n^{l}`, r`\frac{1}{8\pi r^{3}} Q_{ij} n^{i} n^{j}`, { focus: ['i', 'j'], sums: [{ sym: 'i', range: [0, 3] }, { sym: 'j', range: [0, 3] }] }),
      ], {
        dim: 3, metric: 'euclid3',
        checks: [
          check('traceless', tr, 0, 1e-12),
          check('Q n n = 4 q d^2 (3 cos^2 - 1) / 2 for a linear quadrupole', quad * 8 * Math.PI * R ** 3, want, 1e-10),
          check('far-field potential = exact sum (r = 60, error ~ (d/r)^2)', quad, exact, 2e-3),
        ],
        values: { potential: quad },
      });
    },
    viz: { scene: 'inertia-ellipsoid', params: { show: 'quadrupole' } },
    diagram: { style: 'penrose', order: ['Q', 'n', 'n'], note: 'Two direction nodes plug into the two legs of Q.' },
    refs: [wp('Quadrupole'), wp('Multipole_expansion'), JACKSON],
  },
];

function fieldLowerToUpper(F) { return raise2(F); }
