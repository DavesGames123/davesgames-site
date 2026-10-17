// ============================================================================
//  library/entries-mechanics.js  ·  rigid bodies and Lagrangian mechanics
// ----------------------------------------------------------------------------
//  Cartesian, orthonormal frames unless the entry says otherwise, so the
//  metric delta_ij moves indices with no change of value.
//
//  ENTRIES   (grep -n "id: '<id>'" entries-mechanics.js)
//      inertia-tensor  angular-momentum-bivector  kinetic-metric
// ============================================================================
import * as M from './math.js';
import { step, trace, check, P, num, vecTex, matTex, comp, wp, GOLDSTEIN, CARROLL, SCHUTZ } from './kit.js';

const r = String.raw;
const deg = d => d * Math.PI / 180;
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export const MECHANICS = [
  // --------------------------------------------------------------------------
  {
    id: 'inertia-tensor', title: 'Inertia tensor', field: 'mechanics',
    tex: r`I^{ij} = \sum_{n} m_{n}\left(r_{n}^{2}\,\delta^{ij} - x_{n}^{i}x_{n}^{j}\right), \qquad L^{i} = I^{ij}\,\omega_{j}, \qquad T = \tfrac12\,I^{ij}\omega_{i}\omega_{j}`,
    itex: r`L^{i} = I^{ij} \omega_{j}`,
    shape: { rank: 2, variance: 'uu', symmetries: 'symmetric, positive', independent: 6 },
    story: [
      r`For a spinning rigid body the angular momentum is a linear function of the angular velocity, and the linear map is the inertia tensor. Its diagonal components are the familiar moments of inertia about the axes; the off-diagonal products of inertia are what make a lopsided wheel wobble: they make $L$ point away from $\omega$.`,
      r`The formula is a sum over the masses of two pieces: $r^{2}\delta^{ij}$, which would make $L$ parallel to $\omega$, minus the outer product $x^{i}x^{j}$, which removes the part of each mass's position along the axis (a mass on the axis does not resist spin about it). Each index of $I^{ij}$ is a direction in space; feed one slot $\omega$ and you get $L$, feed both and you get twice the kinetic energy.`,
      r`$I$ is symmetric and positive, so it has three perpendicular principal axes, about which $L$ is parallel to $\omega$. Draw the ellipsoid $I^{ij}\omega_{i}\omega_{j} = 1$ (Poinsot's ellipsoid): the body's free motion is this ellipsoid rolling without slipping on a fixed plane. Spin about the middle axis is unstable, the tennis-racket effect.`,
      r`The trace builds $I$ from eight point masses at the corners of a box with sides $a, b, c$, which gives $I^{xx} = M(b^{2} + c^{2})/4$, and checks $L$ and $T$ for a tilted spin.`,
    ],
    vocab: [
      { term: 'moment of inertia', meaning: 'A diagonal component of I: resistance to spin about an axis.' },
      { term: 'product of inertia', meaning: 'An off-diagonal component; it tilts L away from omega.' },
      { term: 'principal axes', meaning: 'The eigenvectors of I, where L is parallel to omega.' },
    ],
    params: [
      { key: 'a', label: 'Box side a (x)', min: 0.2, max: 3, step: 0.05, def: 2 },
      { key: 'b', label: 'Box side b (y)', min: 0.2, max: 3, step: 0.05, def: 1 },
      { key: 'c', label: 'Box side c (z)', min: 0.2, max: 3, step: 0.05, def: 0.5 },
      { key: 'tilt', label: 'Tilt of the spin axis from z (deg)', min: 0, max: 90, step: 1, def: 35 },
    ],
    trace(params) {
      const p = P(this.params, params), m = 0.25, Mt = 8 * m;
      const pts = []; for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push([sx * p.a / 2, sy * p.b / 2, sz * p.c / 2]);
      const I = new M.Tensor([3, 3], ['u', 'u']);
      for (const x of pts) { const r2 = dot(x, x); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I.set(I.get(i, j) + m * ((i === j ? r2 : 0) - x[i] * x[j]), i, j); }
      const t = deg(p.tilt), w = [Math.sin(t), 0, Math.cos(t)], W = M.T(w, ['d']);
      const L = M.einsum('ij,j->i', I, W), T = 0.5 * M.einsum('ij,i,j->', I, W, W).data[0];
      const Ix = Mt * (p.b ** 2 + p.c ** 2) / 4, Iz = Mt * (p.a ** 2 + p.b ** 2) / 4;
      return trace([
        step('product', 'For each mass, the outer product of its position.', r`x^{i}`, r`x^{i} x^{j}`, { focus: ['i', 'j'] }),
        step('substitute', 'Subtract it from r^2 delta and sum the masses.', r`x^{i} x^{j}`, r`I^{ij} = m r^{2} \delta^{ij} - m x^{i} x^{j}`, { focus: ['i', 'j'], numeric: { inputs: {}, output: I }, viz: { scene: 'inertia-ellipsoid', params: { I: M.toNested(I), omega: w } } }),
        step('contract', 'Feed the angular velocity: the angular momentum.', r`I^{ij} \omega_{k}`, r`L^{i} = I^{ij} \omega_{j}`, { focus: ['j'], sums: [{ sym: 'j', range: [0, 3] }], numeric: { inputs: { I, omega: W }, output: L } }),
        step('contract', 'Feed it twice: twice the kinetic energy.', r`I^{ij} \omega_{i} \omega_{j}`, r`T = \frac{1}{2} I^{ij} \omega_{i} \omega_{j}`, { focus: ['i', 'j'], sums: [{ sym: 'i', range: [0, 3] }, { sym: 'j', range: [0, 3] }] }),
        step('evaluate', 'The kinetic energy.', r`T`, r`T = ${num(T, 4)}`, { focus: [] }),
      ], {
        checks: [
          check('I^xx = M (b^2 + c^2) / 4', I.get(0, 0), Ix, 1e-12),
          check('L^x = I^xx omega_x (box axes are principal)', L.get(0), Ix * w[0], 1e-12),
          check('L^z = I^zz omega_z', L.get(2), Iz * w[2], 1e-12),
          check('T = omega . L / 2', T, 0.5 * dot(w, [...L.data]), 1e-12),
        ],
        values: { L: [...L.data], T },
      });
    },
    viz: { scene: 'inertia-ellipsoid', params: { I: [[0.3125, 0, 0], [0, 1.0625, 0], [0, 0, 1.25]] } },
    diagram: { style: 'penrose', order: ['I', '\\omega'], note: 'omega closes one leg of I; the other leg is L.' },
    refs: [wp('Moment_of_inertia'), wp('Poinsot%27s_ellipsoid'), GOLDSTEIN],
  },
  // --------------------------------------------------------------------------
  {
    id: 'angular-momentum-bivector', title: 'Angular momentum as an antisymmetric tensor', field: 'mechanics',
    tex: r`L^{ij} = x^{i}p^{j} - x^{j}p^{i}, \qquad L_{k} = \tfrac12\,\epsilon_{kij}L^{ij} = (\mathbf x\times\mathbf p)_{k}`,
    itex: r`L_{k} = \frac{1}{2} \epsilon_{kij} L^{ij}`,
    shape: { rank: 2, variance: 'uu', symmetries: 'antisymmetric', independent: 'n(n-1)/2: 3 in 3D, 6 in spacetime' },
    story: [
      r`Angular momentum is really an oriented plane, not an arrow: the plane spanned by the position and the momentum, with an area and a sense of rotation. The antisymmetric tensor $L^{ij} = x^{i}p^{j} - x^{j}p^{i}$ records exactly that, one component per coordinate plane: $L^{xy}$ for rotation in the $xy$ plane, and so on.`,
      r`In three dimensions there are as many planes as axes, three, so the Levi-Civita symbol trades each plane for its perpendicular axis: $L_{k} = \frac12\epsilon_{kij}L^{ij}$, the cross product $\mathbf x\times\mathbf p$. This is why the angular momentum "vector" flips its sign in a mirror: it was a plane all along, and the trade with $\epsilon$ depends on orientation.`,
      r`In four dimensions there are six planes but only four axes, so the trade fails, and relativistic angular momentum stays a tensor $L^{\mu\nu}$ with six components: three of ordinary angular momentum and three that describe the motion of the centre of energy. The same happens for the magnetic field, which in 4D is part of $F_{\mu\nu}$.`,
    ],
    vocab: [
      { term: 'bivector', meaning: 'An oriented plane element; an antisymmetric rank-2 tensor.' },
      { term: 'Hodge dual', meaning: 'The trade of a plane for its normal axis with epsilon; only possible in 3D.' },
    ],
    params: [
      { key: 'x', label: 'Position x', min: -2, max: 2, step: 0.05, def: 1 },
      { key: 'y', label: 'Position y', min: -2, max: 2, step: 0.05, def: 0.5 },
      { key: 'px', label: 'Momentum p_x', min: -2, max: 2, step: 0.05, def: -0.3 },
      { key: 'py', label: 'Momentum p_y', min: -2, max: 2, step: 0.05, def: 1.2 },
      { key: 'pz', label: 'Momentum p_z', min: -2, max: 2, step: 0.05, def: 0.4 },
    ],
    trace(params) {
      const p = P(this.params, params), x = [p.x, p.y, 0.2], pm = [p.px, p.py, p.pz];
      const X = M.T(x, ['u']), Pm = M.T(pm, ['u']), xp = M.einsum('i,j->ij', X, Pm);
      const Lt = M.T({ shape: [3, 3], variance: ['u', 'u'], data: xp.data.map((v, k) => v - xp.data[[0, 3, 6, 1, 4, 7, 2, 5, 8][k]]) });
      const Lv = M.scale(M.einsum('kij,ij->k', M.leviCivita(3), Lt), 0.5), want = cross(x, pm);
      return trace([
        step('product', 'The outer product of position and momentum.', r`x^{i}`, r`x^{i} p^{j}`, { focus: ['i', 'j'], numeric: { inputs: { x: X, p: Pm }, output: xp }, viz: { scene: 'outer-product', params: { u: x, w: pm } } }),
        step('antisymmetrize', 'Antisymmetrise: the oriented plane of x and p.', r`x^{i} p^{j}`, r`L^{ij} = x^{i} p^{j} - x^{j} p^{i}`, { focus: ['i', 'j'], numeric: { inputs: { xp }, output: Lt } }),
        step('contract', 'Trade the plane for its axis with epsilon.', r`L^{ij}`, r`L_{k} = \frac{1}{2} \epsilon_{kij} L^{ij}`, { focus: ['i', 'j'], sums: [{ sym: 'i', range: [0, 3] }, { sym: 'j', range: [0, 3] }], numeric: { inputs: { L: Lt }, output: Lv }, viz: { scene: 'levi-civita-cube', params: { a: x, b: pm } } }),
        step('evaluate', 'It is the cross product.', r`L_{k}`, r`L_{k} = ${vecTex([...Lv.data])}`, { focus: [] }),
      ], {
        checks: [
          check('L_k = (x cross p)_k (largest error)', Math.max(...want.map((v, i) => Math.abs(v - Lv.data[i]))), 0, 1e-12),
          check('L^xy = L_z', Lt.get(0, 1), want[2], 1e-12),
          check('antisymmetric: L^xy + L^yx = 0', Lt.get(0, 1) + Lt.get(1, 0), 0, 1e-12),
        ],
        values: { L: [...Lv.data] },
      });
    },
    viz: { scene: 'levi-civita-cube', params: { a: [1, 0.5, 0.2], b: [-0.3, 1.2, 0.4] } },
    diagram: { style: 'penrose', order: ['\\epsilon', 'L'], note: 'The epsilon bar takes the two legs of L; one leg stays free.' },
    refs: [wp('Angular_momentum'), wp('Bivector'), GOLDSTEIN],
  },
  // --------------------------------------------------------------------------
  {
    id: 'kinetic-metric', title: 'Kinetic energy as a metric', field: 'mechanics',
    tex: r`T = \tfrac12\,m\,g_{ij}(q)\,\dot q^{i}\dot q^{j}, \qquad \text{free motion:}\ \ \ddot q^{k} + \Gamma^{k}_{ij}\,\dot q^{i}\dot q^{j} = 0`,
    itex: r`T = \frac{1}{2} m g_{ij} v^{i} v^{j}`,
    shape: { rank: 2, variance: 'dd', symmetries: 'symmetric, positive', independent: 'n(n+1)/2' },
    story: [
      r`In generalised coordinates $q^{i}$ the kinetic energy is a quadratic form in the velocities, and its coefficients form a metric on configuration space: $T = \frac12 m\,g_{ij}\dot q^{i}\dot q^{j}$. For a particle in polar coordinates $g = \mathrm{diag}(1, r^{2})$ and $T = \frac12 m(\dot r^{2} + r^{2}\dot\theta^{2})$.`,
      r`The velocities $\dot q^{i}$ are vector components (upper), so the coefficients must be a $(0,2)$ tensor (lower) for $T$ to be a scalar. Change coordinates and $g_{ij}$ transforms like a metric, while $T$ stays the same number; the trace checks this against the Cartesian velocity.`,
      r`Write the Euler-Lagrange equations for $L = T$ with no potential and they come out as the geodesic equation of $g$. A free particle in polar coordinates follows a straight line, and the centrifugal term $r\dot\theta^{2}$ is $-\Gamma^{r}_{\theta\theta}\dot\theta^{2}$. For a rigid body or a double pendulum the configuration space is curved, and free motion is still a geodesic of the kinetic metric (Jacobi's principle extends this to motion with a potential).`,
    ],
    vocab: [
      { term: 'generalised coordinates', meaning: 'Any coordinates q^i that fix the configuration of a system.' },
      { term: 'kinetic metric', meaning: 'g_ij(q) with T = m g_ij qdot^i qdot^j / 2.' },
      { term: 'Jacobi metric', meaning: '(E - V) g_ij: motion in a potential as a geodesic.' },
    ],
    params: [
      { key: 'm', label: 'Mass m', min: 0.1, max: 3, step: 0.05, def: 1 },
      { key: 'r', label: 'Radius r', min: 0.2, max: 3, step: 0.05, def: 1.5 },
      { key: 'theta', label: 'Angle theta (deg)', min: -180, max: 180, step: 1, def: 40 },
      { key: 'rdot', label: 'Radial speed rdot', min: -2, max: 2, step: 0.05, def: 0.3 },
      { key: 'thdot', label: 'Angular speed thetadot', min: -2, max: 2, step: 0.05, def: 0.8 },
    ],
    trace(params) {
      const p = P(this.params, params), x = [p.r, deg(p.theta)], v = [p.rdot, p.thdot];
      const g = M.T(M.metricAt('polar', x), ['d', 'd']), V = M.T(v, ['u']);
      const T = 0.5 * p.m * M.einsum('ij,i,j->', g, V, V).data[0];
      const J = [[Math.cos(x[1]), -x[0] * Math.sin(x[1])], [Math.sin(x[1]), x[0] * Math.cos(x[1])]]; // d(x,y)/d(r,theta)
      const vc = M.transform(V, J), Tc = 0.5 * p.m * dot([...vc.data], [...vc.data]);
      const G = M.christoffel('polar', x), acc = -G.get(0, 1, 1) * v[1] * v[1];
      return trace([
        step('evaluate', 'The kinetic metric of polar coordinates.', r`g_{ij}`, r`g_{ij} = ${matTex(M.toNested(g))}`, { focus: [], viz: { scene: 'curvilinear-grid', params: { coords: 'polar', point: x } } }),
        step('contract', 'Feed the velocity into both slots.', r`g_{ij} v^{k} v^{l}`, r`T = \frac{1}{2} m g_{ij} v^{i} v^{j}`, { focus: ['i', 'j'], sums: [{ sym: 'i', range: [0, 2] }, { sym: 'j', range: [0, 2] }], numeric: { inputs: { g, v: V }, output: M.T(T) } }),
        step('transform', 'The same velocity in Cartesian components gives the same energy.', r`v^{j}`, r`v'^{a} = J^{a}{}_{j} v^{j}`, { focus: ['a'], sums: [{ sym: 'j', range: [0, 2] }], numeric: { inputs: { v: V, J: comp(J) }, output: vc } }),
        step('christoffel', 'Free motion is a geodesic: the centrifugal term is a Christoffel symbol.', r`g_{ij}`, r`a^{r} = -\Gamma^{r}_{\theta\theta} v^{\theta} v^{\theta}`, { focus: ['theta'], numeric: { inputs: {}, output: G }, viz: { scene: 'christoffel-basis', params: { coords: 'polar', along: 'theta', point: x } } }),
      ], {
        dim: 2, metric: 'polar',
        checks: [
          check('T = m (rdot^2 + r^2 thetadot^2) / 2', T, 0.5 * p.m * (v[0] ** 2 + (x[0] * v[1]) ** 2), 1e-12),
          check('T in Cartesian = T in polar', Tc, T, 1e-12),
          check('centrifugal acceleration = r thetadot^2', acc, x[0] * v[1] ** 2, 1e-12),
        ],
        values: { T },
      });
    },
    viz: { scene: 'curvilinear-grid', params: { coords: 'polar' } },
    diagram: { style: 'penrose', order: ['g', 'v', 'v'], note: 'The metric cup closes two velocity legs: a scalar.' },
    refs: [wp('Lagrangian_mechanics'), wp('Generalized_coordinates'), GOLDSTEIN, CARROLL],
  },
];
