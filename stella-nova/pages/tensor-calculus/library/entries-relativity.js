// ============================================================================
//  library/entries-relativity.js  ·  special and general relativity
// ----------------------------------------------------------------------------
//  Units G = c = 1. Metric signature (-, +, +, +), time first. Riemann
//  convention of MTW and Carroll (see entries-geometry.js), so the Einstein
//  equations read G_mn + Lambda g_mn = 8 pi T_mn with T_00 = rho > 0.
//
//  ENTRIES   (grep -n "id: '<id>'" entries-relativity.js)
//      lorentz-boost  four-momentum  einstein-field-equations
//      schwarzschild-metric  flrw-metric  perfect-fluid  energy-conservation
//      weyl-tensor
// ============================================================================
import * as M from './math.js';
import { step, trace, check, P, num, vecTex, matTex, comp, wp, CARROLL, MTW, SCHUTZ, PENROSE } from './kit.js';

const r = String.raw;
const ETA = [[-1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const deg = d => d * Math.PI / 180;

// R_abcd R^abcd with the inverse metric (any metric, n^8 loop, fine for n = 4).
function kretschmann(c) {
  const n = c.n, gi = (a, b) => c.gInv.data[a * n + b], Rd = c.RiemannDown;
  // raise all four slots
  let up = Rd;
  for (let s = 0; s < 4; s++) {
    const out = new M.Tensor([n, n, n, n], up.variance.map((v, k) => (k === s ? 'u' : v)));
    for (const idx of M.indexTuples([n, n, n, n])) {
      let v = 0; const j = idx.slice();
      for (let e = 0; e < n; e++) { j[s] = e; const g = gi(idx[s], e); if (g) v += g * up.get(...j); }
      out.set(v, ...idx);
    }
    up = out;
  }
  let K = 0; for (let i = 0; i < Rd.data.length; i++) K += Rd.data[i] * up.data[i];
  return K;
}
const mixed = (c, T) => { const n = c.n, out = new M.Tensor([n, n], ['u', 'd']); for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) { let v = 0; for (let e = 0; e < n; e++) v += c.gInv.data[a * n + e] * T.data[e * n + b]; out.set(v, a, b); } return out; };

export const RELATIVITY = [
  // --------------------------------------------------------------------------
  {
    id: 'lorentz-boost', title: 'Lorentz transformation', field: 'relativity',
    tex: r`x'^{\mu} = \Lambda^{\mu}{}_{\nu}\,x^{\nu}, \qquad \eta_{\alpha\beta}\,\Lambda^{\alpha}{}_{\mu}\,\Lambda^{\beta}{}_{\nu} = \eta_{\mu\nu}, \qquad \Lambda = \begin{pmatrix} \gamma & -\gamma\beta \\ -\gamma\beta & \gamma \end{pmatrix}`,
    itex: r`\eta_{\alpha\beta} \Lambda^{\alpha}{}_{\mu} \Lambda^{\beta}{}_{\nu} = \eta_{\mu\nu}`,
    shape: { rank: 2, variance: 'ud', symmetries: 'Lambda^T eta Lambda = eta', independent: '6 (3 boosts + 3 rotations)' },
    story: [
      r`A Lorentz transformation is a change of inertial frame. In the $(t,x)$ plane a boost with speed $\beta$ (with $c = 1$) mixes time and space with the matrix $\Lambda^{\mu}{}_{\nu}$, where $\gamma = 1/\sqrt{1-\beta^{2}}$. This page uses the signature $(-,+,+,+)$: $\eta_{\mu\nu} = \mathrm{diag}(-1,1,1,1)$.`,
      r`The defining property is the second equation: $\Lambda$ keeps the Minkowski metric. Both sides have the free indices $\mu\nu$ down, as they must. It says the interval $\eta_{\mu\nu}x^{\mu}x^{\nu} = -t^{2} + x^{2}$ is the same in every frame, so the light cone $t = \pm x$ maps to itself: every observer measures the same speed of light.`,
      r`$\Lambda^{\mu}{}_{\nu}$ is the Jacobian $\partial x'^{\mu}/\partial x^{\nu}$, one up and one down like every Jacobian. Contravariant vectors (displacements, four-velocity) transform with it; covariant ones (gradients, the four-wave-vector $k_{\mu}$) with its inverse, which for a boost is the boost with $-\beta$. Tensors with more indices take one factor per index; the electromagnetic field $F^{\mu\nu}$ takes two, which is how electric and magnetic fields mix.`,
      r`In the 3D view the boost squeezes the grid along one diagonal of the light cone and stretches it along the other, the hyperbolic rotation. Time dilation is the first component: an event at the origin's clock at time $t$ has $t' = \gamma t$ in the moving frame.`,
    ],
    vocab: [
      { term: 'boost', meaning: 'A Lorentz transformation to a frame moving with speed beta.' },
      { term: 'Minkowski metric', meaning: 'eta = diag(-1, 1, 1, 1) in the (-,+,+,+) signature.' },
      { term: 'rapidity', meaning: 'phi with beta = tanh phi; boosts add rapidities.' },
      { term: 'interval', meaning: 'eta_mn x^m x^n, the same for every inertial observer.' },
    ],
    params: [
      { key: 'beta', label: 'Speed beta', min: -0.95, max: 0.95, step: 0.01, def: 0.6 },
      { key: 't', label: 'Event time t', min: -2, max: 2, step: 0.05, def: 1 },
      { key: 'x', label: 'Event position x', min: -2, max: 2, step: 0.05, def: 0.4 },
    ],
    trace(params) {
      const p = P(this.params, params), L = M.lorentzBoost(p.beta, 1), g = 1 / Math.sqrt(1 - p.beta ** 2);
      const Lt = M.T(L, ['u', 'd']), eta = M.T(ETA, ['d', 'd']), X = M.T([p.t, p.x, 0, 0], ['u']);
      const X2 = M.einsum('mn,n->m', Lt, X), keep = M.einsum('ab,am,bn->mn', eta, Lt, Lt);
      const s1 = M.einsum('mn,m,n->', eta, X, X).data[0], s2 = M.einsum('mn,m,n->', eta, X2, X2).data[0];
      return trace([
        step('transform', 'Boost the event: time and space mix.', r`x^{\nu}`, r`x'^{\mu} = \Lambda^{\mu}{}_{\nu} x^{\nu}`, { focus: ['mu', 'nu'], sums: [{ sym: 'nu', range: [0, 4] }], numeric: { inputs: { Lambda: Lt, x: X }, output: X2 }, viz: { scene: 'lorentz-boost', params: { beta: p.beta, show: 'cone' } } }),
        step('evaluate', 'The new coordinates.', r`x'^{\mu}`, r`x'^{\mu} = ${vecTex([...X2.data])}`, { focus: ['mu'] }),
        step('contract', 'Feed the boost twice into the metric: the metric comes back unchanged.', r`\eta_{\alpha\beta}`, r`\eta_{\alpha\beta} \Lambda^{\alpha}{}_{\mu} \Lambda^{\beta}{}_{\nu}`, { focus: ['alpha', 'beta'], sums: [{ sym: 'alpha', range: [0, 4] }, { sym: 'beta', range: [0, 4] }], numeric: { inputs: { eta, Lambda: Lt }, output: keep } }),
        step('contract', 'The interval is the same in both frames.', r`\eta_{\mu\nu} x'^{\mu} x'^{\nu}`, r`\eta_{\mu\nu} x'^{\mu} x'^{\nu} = ${num(s2, 4)}`, { focus: ['mu', 'nu'], sums: [{ sym: 'mu', range: [0, 4] }, { sym: 'nu', range: [0, 4] }] }),
      ], {
        dim: 4, metric: 'minkowski', coords: 't, x, y, z',
        checks: [
          check('Lambda^T eta Lambda = eta (largest error)', M.maxAbs(M.sub(keep, eta)), 0, 1e-12),
          check('interval is invariant', s2, s1, 1e-12),
          check('t\' = gamma (t - beta x)', X2.data[0], g * (p.t - p.beta * p.x), 1e-12),
          check('x\' = gamma (x - beta t)', X2.data[1], g * (p.x - p.beta * p.t), 1e-12),
        ],
        values: { gamma: g, interval: s1 },
      });
    },
    viz: { scene: 'lorentz-boost', params: { beta: 0.6, show: 'cone' } },
    diagram: { style: 'penrose', order: ['\\eta', '\\Lambda', '\\Lambda'], note: 'The eta cup with a Lambda node on each leg equals the bare cup.' },
    refs: [wp('Lorentz_transformation'), SCHUTZ, CARROLL],
  },
  // --------------------------------------------------------------------------
  {
    id: 'four-momentum', title: 'Four-momentum and the mass shell', field: 'relativity',
    tex: r`p^{\mu} = m\,u^{\mu} = (\gamma m,\ \gamma m\mathbf{v}), \qquad \eta_{\mu\nu}\,p^{\mu}p^{\nu} = -m^{2}, \qquad E^{2} = |\mathbf p|^{2} + m^{2}`,
    itex: r`\eta_{\mu\nu} p^{\mu} p^{\nu} = -m^{2}`,
    shape: { rank: 1, variance: 'u', symmetries: '-', independent: 4 },
    story: [
      r`The four-velocity $u^{\mu} = dx^{\mu}/d\tau$ is the tangent of a worldline per unit proper time. Its length is fixed: $\eta_{\mu\nu}u^{\mu}u^{\nu} = -1$ in the $(-,+,+,+)$ signature. Multiply by the rest mass and you get the four-momentum $p^{\mu} = mu^{\mu}$, whose time component is the energy $E = \gamma m$ and whose space part is the momentum $\gamma m\mathbf v$.`,
      r`Contract $p$ with itself through the metric and every frame agrees: $p_{\mu}p^{\mu} = -E^{2} + |\mathbf p|^{2} = -m^{2}$. This is $E^{2} = p^{2} + m^{2}$, the mass shell, with $E = mc^{2}$ at rest. The free index count of the left side is zero: it is a scalar, which is why it can equal a number.`,
      r`Lowering the index changes the sign of the time component: $p_{\mu} = (-E, \mathbf p)$. The covector $p_{\mu}$ is the natural one in quantum mechanics, where a plane wave is $e^{ip_{\mu}x^{\mu}}$: its level sets are the wavefronts, and the phase $p_{\mu}x^{\mu}$ is the same number for every observer.`,
      r`Conservation of four-momentum in collisions is one vector equation, four numbers at once: energy and three momentum components. Because each side is a four-vector, if it holds in one frame it holds in all.`,
    ],
    vocab: [
      { term: 'four-velocity', meaning: 'u^m = dx^m/dtau, with u.u = -1.' },
      { term: 'proper time', meaning: 'tau, the time on a clock carried along the worldline.' },
      { term: 'mass shell', meaning: 'p.p = -m^2, the surface on which a free particle\'s momentum lies.' },
    ],
    params: [
      { key: 'm', label: 'Rest mass m', min: 0.1, max: 3, step: 0.05, def: 1 },
      { key: 'v', label: 'Speed v', min: 0, max: 0.99, step: 0.01, def: 0.8 },
      { key: 'dir', label: 'Direction in the xy plane (deg)', min: 0, max: 360, step: 1, def: 30 },
    ],
    trace(params) {
      const p = P(this.params, params), g = 1 / Math.sqrt(1 - p.v ** 2), d = deg(p.dir);
      const u = [g, g * p.v * Math.cos(d), g * p.v * Math.sin(d), 0];
      const U = M.T(u, ['u']), Pm = M.scale(U, p.m), eta = M.T(ETA, ['d', 'd']);
      const Pd = M.einsum('mn,n->m', eta, Pm), shell = M.einsum('m,m->', Pd, Pm).data[0];
      const uu = M.einsum('mn,m,n->', eta, U, U).data[0];
      return trace([
        step('evaluate', 'Four-velocity of the particle: gamma times (1, v).', r`u^{\mu}`, r`u^{\mu} = ${vecTex(u)}`, { focus: ['mu'], viz: { scene: 'lorentz-boost', params: { beta: p.v, show: 'worldline' } } }),
        step('product', 'Scale by the rest mass: the four-momentum.', r`u^{\mu}`, r`p^{\mu} = m u^{\mu}`, { focus: ['mu'], numeric: { inputs: { u: U }, output: Pm } }),
        step('lower', 'Lower the index: the time component changes sign.', r`p^{\nu}`, r`p_{\mu} = \eta_{\mu\nu} p^{\nu}`, { focus: ['mu', 'nu'], sums: [{ sym: 'nu', range: [0, 4] }], numeric: { inputs: { eta, p: Pm }, output: Pd } }),
        step('contract', 'Contract: minus the mass squared, in every frame.', r`p_{\mu} p^{\nu}`, r`p_{\mu} p^{\mu} = ${num(shell, 4)}`, { focus: ['mu'], sums: [{ sym: 'mu', range: [0, 4] }] }),
      ], {
        dim: 4, metric: 'minkowski',
        checks: [
          check('u.u = -1', uu, -1, 1e-12),
          check('p.p = -m^2', shell, -(p.m ** 2), 1e-12),
          check('E = gamma m', Pm.data[0], g * p.m, 1e-12),
        ],
        values: { E: Pm.data[0], gamma: g },
      });
    },
    viz: { scene: 'lorentz-boost', params: { beta: 0.8, show: 'worldline' } },
    diagram: { style: 'penrose', order: ['p', '\\eta', 'p'], note: 'Two p nodes joined by the eta cup: a closed diagram, a scalar.' },
    refs: [wp('Four-momentum'), wp('Energy%E2%80%93momentum_relation'), SCHUTZ],
  },
  // --------------------------------------------------------------------------
  {
    id: 'einstein-field-equations', title: 'Einstein field equations', field: 'relativity',
    tex: r`G_{\mu\nu} + \Lambda g_{\mu\nu} = 8\pi T_{\mu\nu}, \qquad G_{\mu\nu} = R_{\mu\nu} - \tfrac12 R\,g_{\mu\nu} \qquad (G = c = 1)`,
    itex: r`G_{\mu\nu} + \Lambda g_{\mu\nu} = 8 \pi T_{\mu\nu}`,
    shape: { rank: 2, variance: 'dd', symmetries: 'symmetric', independent: '10 equations, 4 fixed by the Bianchi identity' },
    story: [
      r`"Spacetime tells matter how to move; matter tells spacetime how to curve." The left side is geometry: the Einstein tensor $G_{\mu\nu} = R_{\mu\nu} - \frac12 Rg_{\mu\nu}$, built from the metric and its first two derivatives, plus the cosmological constant term. The right side is matter: the stress-energy tensor $T_{\mu\nu}$, whose $T_{00}$ is the energy density and whose $T_{ij}$ are pressures and stresses.`,
      r`Both sides are symmetric with two lower indices, so this is ten equations in four dimensions. The contracted Bianchi identity $\nabla^{\mu}G_{\mu\nu} = 0$ makes four of them automatic, and they force $\nabla^{\mu}T_{\mu\nu} = 0$: energy and momentum are conserved because geometry cannot do otherwise. The remaining freedom is the choice of coordinates.`,
      r`The signs here are those of Misner, Thorne and Wheeler and of Carroll: signature $(-,+,+,+)$, Riemann with $+\partial_{\mu}\Gamma$ first, Ricci from the first and third index. With these, positive energy density curves spacetime so that geodesics focus.`,
      r`The trace solves the equations for a flat expanding universe with scale factor $a = t^{p}$. Computing $G_{\mu\nu}$ from the metric gives the density $\rho = 3H^{2}/8\pi$ and a pressure that depends on $p$: dust for $p = 2/3$, radiation for $p = 1/2$. The equation of state $w = P/\rho = -1 + 2/(3p)$ comes out of the geometry.`,
    ],
    vocab: [
      { term: 'Einstein tensor', meaning: 'G_mn = R_mn - R g_mn / 2, the divergence-free part of curvature.' },
      { term: 'stress-energy tensor', meaning: 'T_mn: energy density, momentum density, pressure and stress.' },
      { term: 'cosmological constant', meaning: 'Lambda: a constant energy density of empty space.' },
      { term: 'equation of state', meaning: 'w = P / rho; 0 for dust, 1/3 for radiation, -1 for Lambda.' },
    ],
    params: [
      { key: 'p', label: 'Expansion law a = t^p', min: 0.2, max: 1.4, step: 0.01, def: 0.6667 },
      { key: 't', label: 'Cosmic time t', min: 0.3, max: 4, step: 0.05, def: 1.5 },
    ],
    trace(params) {
      const p = P(this.params, params), x = [p.t, 0.4, 1.0, 0.2], prm = { k: 0, p: p.p };
      const c = M.curvatureAt('flrw', x, prm), Gm = mixed(c, c.Einstein);
      const H = p.p / p.t, rho = -Gm.get(0, 0) / (8 * Math.PI), Pr = Gm.get(1, 1) / (8 * Math.PI);
      return trace([
        step('christoffel', 'Christoffel symbols of the expanding universe.', r`g_{\mu\nu}`, r`\Gamma^{\lambda}_{\mu\nu}`, { focus: ['lambda'], numeric: { inputs: {}, output: c.Gamma } }),
        step('contract', 'Riemann, then Ricci by contraction.', r`R^{\rho}{}_{\sigma\mu\nu}`, r`R_{\mu\nu} = R^{\rho}{}_{\mu\rho\nu}`, { focus: ['rho'], sums: [{ sym: 'rho', range: [0, 4] }], numeric: { inputs: { Riemann: c.Riemann }, output: c.Ricci } }),
        step('substitute', 'Subtract half the trace: the Einstein tensor.', r`R_{\mu\nu}`, r`G_{\mu\nu} = R_{\mu\nu} - \frac{1}{2} R g_{\mu\nu}`, { focus: ['mu', 'nu'], numeric: { inputs: { Ricci: c.Ricci }, output: c.Einstein } }),
        step('raise', 'Raise one index: the diagonal is minus the density and the pressure.', r`G_{\mu\nu}`, r`G^{\mu}{}_{\nu} = g^{\mu\lambda} G_{\lambda\nu}`, { focus: ['mu', 'lambda'], sums: [{ sym: 'lambda', range: [0, 4] }], numeric: { inputs: { Einstein: c.Einstein }, output: Gm } }),
        step('evaluate', 'Read off the matter that this geometry needs.', r`8 \pi T^{\mu}{}_{\nu}`, r`\rho = ${num(rho, 5)},\; P = ${num(Pr, 5)},\; w = ${num(Pr / rho, 4)}`, { focus: [] }),
      ], {
        dim: 4, metric: 'flrw', coords: 't, r, theta, phi',
        checks: [
          check('rho = 3 H^2 / 8 pi', rho, 3 * H * H / (8 * Math.PI), 1e-10),
          check('w = -1 + 2 / (3 p)', Pr / rho, -1 + 2 / (3 * p.p), 1e-9),
          check('isotropy: G^r_r = G^theta_theta', Gm.get(1, 1), Gm.get(2, 2), 1e-10),
        ],
        values: { rho, pressure: Pr, w: Pr / rho },
      });
    },
    viz: { scene: 'geodesics', params: { surface: 'sphere', spread: 0.3, deviation: true } },
    diagram: { style: 'penrose', order: ['G', 'g', 'T'], note: 'Three two-leg nodes, legs down, summed side by side.' },
    refs: [wp('Einstein_field_equations'), CARROLL, MTW, SCHUTZ],
  },
  // --------------------------------------------------------------------------
  {
    id: 'schwarzschild-metric', title: 'Schwarzschild metric', field: 'relativity',
    tex: r`ds^{2} = -\left(1-\frac{2M}{r}\right)dt^{2} + \left(1-\frac{2M}{r}\right)^{-1}dr^{2} + r^{2}\,d\Omega^{2}, \qquad R_{\mu\nu} = 0, \qquad R_{\alpha\beta\gamma\delta}R^{\alpha\beta\gamma\delta} = \frac{48M^{2}}{r^{6}}`,
    itex: r`R_{\mu\nu} = 0`,
    shape: { rank: 2, variance: 'dd (metric)', symmetries: 'static, spherically symmetric', independent: '4 non-zero metric components' },
    story: [
      r`The Schwarzschild metric is the field outside any spherical, non-rotating mass: a star, a planet, a black hole. It is a vacuum solution, so the Ricci tensor is zero everywhere outside the mass. The trace computes all ten components of $R_{\mu\nu}$ from the metric and finds zero, while the Riemann tensor is not zero: there is curvature without matter, and that curvature is tidal.`,
      r`Read the components. $g_{tt} = -(1-2M/r)$ makes clocks at small $r$ run slow: a clock at rest at $r$ ticks $\sqrt{1-2M/r}$ times as fast as one far away, the gravitational redshift. $g_{rr} = (1-2M/r)^{-1}$ means a radial step covers more proper distance than $dr$, so space is stretched near the mass. At $r = 2M$ both blow up; that is a coordinate effect, the event horizon, not a singularity of the geometry.`,
      r`The coordinate-free test is the Kretschmann scalar $R_{\alpha\beta\gamma\delta}R^{\alpha\beta\gamma\delta} = 48M^{2}/r^{6}$. It is finite at the horizon and infinite only at $r = 0$, the true singularity. To compute it, every index of Riemann is raised with the inverse metric and the whole tensor is contracted with itself.`,
      r`The Flamm paraboloid $z = \sqrt{8M(r-2M)}$ is a picture of the spatial geometry at one instant: embed the $(r,\phi)$ plane in flat 3D so that distances match. It is the funnel in every popular picture of a black hole, and it shows only space, not the time warping that causes most of gravity.`,
    ],
    vocab: [
      { term: 'vacuum solution', meaning: 'A metric with R_mn = 0: no matter, but possibly curvature.' },
      { term: 'event horizon', meaning: 'r = 2M, the surface from inside of which nothing escapes.' },
      { term: 'Kretschmann scalar', meaning: 'R_abcd R^abcd, a curvature invariant that detects true singularities.' },
      { term: 'gravitational redshift', meaning: 'Clocks deeper in the potential run slow by sqrt(1 - 2M/r).' },
    ],
    params: [
      { key: 'M', label: 'Mass M', min: 0.2, max: 3, step: 0.05, def: 1 },
      { key: 'r', label: 'Radius r (in units of M)', min: 2.2, max: 20, step: 0.1, def: 6 },
    ],
    trace(params) {
      const p = P(this.params, params), rr = p.r * p.M, x = [0, rr, 1.2, 0.4], prm = { M: p.M };
      const c = M.curvatureAt('schwarzschild', x, prm), K = kretschmann(c), gm = M.metricAt('schwarzschild', x, prm);
      return trace([
        step('evaluate', 'The metric at this radius.', r`g_{\mu\nu}`, r`g_{\mu\nu} = ${matTex(gm, 3)}`, { focus: ['mu', 'nu'], viz: { scene: 'flamm-paraboloid', params: { mass: p.M, r: rr } } }),
        step('christoffel', 'Its Christoffel symbols: the gravitational field.', r`g_{\mu\nu}`, r`\Gamma^{\lambda}_{\mu\nu}`, { focus: ['lambda'], numeric: { inputs: {}, output: c.Gamma } }),
        step('contract', 'Riemann contracted to Ricci: every component is zero (vacuum).', r`R^{\rho}{}_{\mu\sigma\nu}`, r`R_{\mu\nu} = R^{\rho}{}_{\mu\rho\nu}`, { focus: ['rho'], sums: [{ sym: 'rho', range: [0, 4] }], numeric: { inputs: { Riemann: c.Riemann }, output: c.Ricci } }),
        step('contract', 'Contract Riemann with itself: the Kretschmann scalar.', r`R_{\alpha\beta\gamma\delta}`, r`R_{\alpha\beta\gamma\delta} R^{\alpha\beta\gamma\delta} = ${num(K, 6)}`, { focus: ['alpha', 'beta', 'gamma', 'delta'], sums: ['alpha', 'beta', 'gamma', 'delta'].map(s => ({ sym: s, range: [0, 4] })) }),
      ], {
        dim: 4, metric: 'schwarzschild', coords: 't, r, theta, phi',
        checks: [
          check('vacuum: Ricci = 0 (largest component)', M.maxAbs(c.Ricci), 0, 1e-10),
          check('Kretschmann = 48 M^2 / r^6', K, 48 * p.M ** 2 / rr ** 6, 1e-10),
          check('Riemann is not zero (largest component > 0)', M.maxAbs(c.Riemann) > 1e-6 ? 1 : 0, 1, 0),
          check('redshift factor sqrt(-g_tt) = sqrt(1 - 2M/r)', Math.sqrt(-gm[0][0]), Math.sqrt(1 - 2 / p.r), 1e-12),
        ],
        values: { kretschmann: K, redshift: Math.sqrt(1 - 2 / p.r) },
      });
    },
    viz: { scene: 'flamm-paraboloid', params: { mass: 1, r: 6 } },
    diagram: { style: 'penrose', order: ['R'], note: 'Ricci: the Riemann node with its up leg joined to its second leg; here it equals zero.' },
    refs: [wp('Schwarzschild_metric'), wp('Kretschmann_scalar'), CARROLL, MTW],
  },
  // --------------------------------------------------------------------------
  {
    id: 'flrw-metric', title: 'FLRW metric and the Friedmann equation', field: 'relativity',
    tex: r`ds^{2} = -dt^{2} + a(t)^{2}\left[\frac{dr^{2}}{1-kr^{2}} + r^{2}d\Omega^{2}\right], \qquad H^{2} = \left(\frac{\dot a}{a}\right)^{2} = \frac{8\pi}{3}\rho - \frac{k}{a^{2}}`,
    itex: r`G^{\mu}{}_{\nu} = 8 \pi T^{\mu}{}_{\nu}`,
    shape: { rank: 2, variance: 'ud', symmetries: 'homogeneous and isotropic: diag(-rho, P, P, P)', independent: '2 functions: rho(t), P(t)' },
    story: [
      r`The Friedmann-Lemaitre-Robertson-Walker metric describes a universe that looks the same everywhere and in every direction. All the dynamics is in one function, the scale factor $a(t)$, and one number, the spatial curvature $k = -1, 0, +1$ (open, flat, closed). Galaxies sit at fixed coordinates $r,\theta,\phi$; their distances grow with $a$.`,
      r`Put the metric into Einstein's equations with mixed indices, $G^{\mu}{}_{\nu} = 8\pi T^{\mu}{}_{\nu}$. With one index up and one down, a fluid at rest has $T^{\mu}{}_{\nu} = \mathrm{diag}(-\rho, P, P, P)$ with no metric factors, so you can read density and pressure straight off. The $tt$ equation is the Friedmann equation: $H^{2} = \frac{8\pi}{3}\rho - k/a^{2}$.`,
      r`The FLRW metric is conformally flat: its Weyl tensor is zero, so all its curvature is Ricci curvature, sourced locally by matter. Tidal fields with no local source, such as gravitational waves, are absent from a perfectly smooth universe.`,
      r`Move the curvature slider and the same expansion rate needs a different density. With $k = +1$ more matter is needed than the critical density $3H^{2}/8\pi$; with $k = -1$ less.`,
    ],
    vocab: [
      { term: 'scale factor', meaning: 'a(t): the size of the universe relative to now.' },
      { term: 'Hubble rate', meaning: 'H = (da/dt)/a.' },
      { term: 'critical density', meaning: '3H^2 / 8 pi: the density of a flat universe.' },
      { term: 'conformally flat', meaning: 'Weyl tensor zero: the metric is a rescaled flat metric.' },
    ],
    params: [
      { key: 'k', label: 'Spatial curvature k', min: -1, max: 1, step: 1, def: 0 },
      { key: 'p', label: 'Expansion law a = t^p', min: 0.2, max: 1.4, step: 0.01, def: 0.6667 },
      { key: 't', label: 'Cosmic time t', min: 0.3, max: 4, step: 0.05, def: 1.5 },
    ],
    trace(params) {
      const p = P(this.params, params), x = [p.t, 0.4, 1.0, 0.2], prm = { k: Math.round(p.k), p: p.p };
      const c = M.curvatureAt('flrw', x, prm), Gm = mixed(c, c.Einstein);
      const a = p.t ** p.p, H = p.p / p.t, rho = -Gm.get(0, 0) / (8 * Math.PI);
      return trace([
        step('christoffel', 'Christoffel symbols of the FLRW metric.', r`g_{\mu\nu}`, r`\Gamma^{\lambda}_{\mu\nu}`, { focus: ['lambda'], numeric: { inputs: {}, output: c.Gamma } }),
        step('raise', 'The Einstein tensor with one index up.', r`G_{\lambda\nu}`, r`G^{\mu}{}_{\nu} = g^{\mu\lambda} G_{\lambda\nu}`, { focus: ['mu'], sums: [{ sym: 'lambda', range: [0, 4] }], numeric: { inputs: { Einstein: c.Einstein }, output: Gm } }),
        step('evaluate', 'The tt component is the Friedmann equation.', r`G^{t}{}_{t}`, r`\rho = -\frac{G^{t}{}_{t}}{8\pi} = ${num(rho, 5)}`, { focus: [] }),
      ], {
        dim: 4, metric: 'flrw',
        checks: [
          check('Friedmann: 8 pi rho / 3 = H^2 + k / a^2', 8 * Math.PI * rho / 3, H * H + prm.k / (a * a), 1e-10),
          check('conformally flat: Weyl = 0 (largest component)', M.maxAbs(c.Weyl), 0, 1e-10),
          check('isotropy: G^r_r = G^phi_phi', Gm.get(1, 1), Gm.get(3, 3), 1e-10),
        ],
        values: { rho, H },
      });
    },
    viz: { scene: 'metric-ellipses', params: { surface: 'sphere', radius: 1 } },
    diagram: { style: 'penrose', order: ['G', 'T'], note: 'One leg up, one down on each side: mixed tensors need no metric to read.' },
    refs: [wp('Friedmann%E2%80%93Lema%C3%AEtre%E2%80%93Robertson%E2%80%93Walker_metric'), wp('Friedmann_equations'), CARROLL, SCHUTZ],
  },
  // --------------------------------------------------------------------------
  {
    id: 'perfect-fluid', title: 'Perfect fluid stress-energy', field: 'relativity',
    tex: r`T^{\mu\nu} = (\rho + p)\,u^{\mu}u^{\nu} + p\,g^{\mu\nu}, \qquad T^{\mu}{}_{\mu} = -\rho + 3p`,
    itex: r`T^{\mu\nu} = (\rho + p) u^{\mu} u^{\nu} + p g^{\mu\nu}`,
    shape: { rank: 2, variance: 'uu', symmetries: 'symmetric', independent: '10 components, 2 numbers + u in the fluid' },
    story: [
      r`A perfect fluid has no viscosity and no heat flow. In its rest frame it looks the same in every direction: $T^{\mu\nu} = \mathrm{diag}(\rho, p, p, p)$, energy density on the diagonal's time slot and pressure in the three space slots. The covariant form above says the same thing in any frame, using only the fluid's four-velocity $u^{\mu}$ and the metric.`,
      r`Both indices are up: $T^{\mu\nu}$ is the flux of $\mu$-momentum across a surface of constant $x^{\nu}$. $T^{00}$ is energy density, $T^{0i}$ energy flux (or momentum density), $T^{ij}$ the momentum flux, the stress. It is symmetric, ten components in 4D.`,
      r`Boost the fluid and the components mix: in a frame where it moves with speed $\beta$, $T^{00} = \gamma^{2}(\rho + \beta^{2}p)$ and $T^{0x} = \gamma^{2}\beta(\rho + p)$. The pressure adds to the energy flux: pressure has inertia in relativity. The trace $T^{\mu}{}_{\mu} = -\rho + 3p$ does not change; it is zero for radiation, $p = \rho/3$.`,
      r`Dust ($p = 0$), radiation ($p = \rho/3$) and dark energy ($p = -\rho$) are all perfect fluids. The FLRW universe is filled with one, and the Einstein equations relate its $\rho$ and $p$ to the expansion.`,
    ],
    vocab: [
      { term: 'perfect fluid', meaning: 'A fluid with only density and isotropic pressure in its rest frame.' },
      { term: 'energy flux', meaning: 'T^0i: energy crossing unit area per unit time.' },
      { term: 'trace', meaning: 'T^m_m = -rho + 3p, the same in every frame.' },
    ],
    params: [
      { key: 'rho', label: 'Density rho', min: 0.1, max: 3, step: 0.05, def: 1 },
      { key: 'pr', label: 'Pressure p', min: -1, max: 1, step: 0.01, def: 0.3333 },
      { key: 'beta', label: 'Fluid speed beta (along x)', min: -0.95, max: 0.95, step: 0.01, def: 0.5 },
    ],
    trace(params) {
      const p = P(this.params, params), g = 1 / Math.sqrt(1 - p.beta ** 2);
      const u = M.T([g, g * p.beta, 0, 0], ['u']), gi = M.T(ETA, ['u', 'u']), eta = M.T(ETA, ['d', 'd']);
      const uu = M.einsum('m,n->mn', u, u);
      const Tt = M.T({ shape: [4, 4], variance: ['u', 'u'], data: uu.data.map((v, i) => (p.rho + p.pr) * v + p.pr * gi.data[i]) });
      const tr = M.einsum('mn,mn->', eta, Tt).data[0];
      return trace([
        step('product', 'The outer product of the four-velocity with itself.', r`u^{\mu}`, r`u^{\mu} u^{\nu}`, { focus: ['mu', 'nu'], numeric: { inputs: { u }, output: uu }, viz: { scene: 'outer-product', params: { u: [...u.data], w: [...u.data] } } }),
        step('substitute', 'Weight it by rho + p and add p times the inverse metric.', r`u^{\mu} u^{\nu}`, r`T^{\mu\nu} = (\rho + p) u^{\mu} u^{\nu} + p g^{\mu\nu}`, { focus: ['mu', 'nu'], numeric: { inputs: { uu, gInv: gi }, output: Tt } }),
        step('evaluate', 'The components in this frame.', r`T^{\mu\nu}`, r`T^{\mu\nu} = ${matTex(M.toNested(Tt), 3)}`, { focus: [], viz: { scene: 'lorentz-boost', params: { beta: p.beta, show: 'tensor' } } }),
        step('trace', 'Lower one index and trace: the invariant -rho + 3p.', r`T^{\mu\nu}`, r`g_{\mu\nu} T^{\mu\nu} = ${num(tr, 4)}`, { focus: ['mu', 'nu'], sums: [{ sym: 'mu', range: [0, 4] }, { sym: 'nu', range: [0, 4] }] }),
      ], {
        dim: 4, metric: 'minkowski',
        checks: [
          check('T^00 = gamma^2 (rho + beta^2 p)', Tt.get(0, 0), g * g * (p.rho + p.beta ** 2 * p.pr), 1e-12),
          check('T^0x = gamma^2 beta (rho + p)', Tt.get(0, 1), g * g * p.beta * (p.rho + p.pr), 1e-12),
          check('trace = -rho + 3p', tr, -p.rho + 3 * p.pr, 1e-12),
          check('T^yy = p', Tt.get(2, 2), p.pr, 1e-12),
        ],
        values: { trace: tr },
      });
    },
    viz: { scene: 'lorentz-boost', params: { beta: 0.5, show: 'tensor' } },
    diagram: { style: 'penrose', order: ['u', 'u', 'g'], note: 'Two u nodes side by side plus a metric cap, summed.' },
    refs: [wp('Perfect_fluid'), wp('Stress%E2%80%93energy_tensor'), SCHUTZ, CARROLL],
  },
  // --------------------------------------------------------------------------
  {
    id: 'energy-conservation', title: 'Conservation of energy-momentum', field: 'relativity',
    tex: r`\nabla_{\mu}T^{\mu\nu} = 0 \quad\Longrightarrow\quad \dot\rho + 3H(\rho + p) = 0`,
    itex: r`\nabla_{\mu} T^{\mu\nu} = 0`,
    shape: { rank: 1, variance: 'u', symmetries: '-', independent: '4 equations' },
    story: [
      r`In flat space, $\partial_{\mu}T^{\mu\nu} = 0$ says that energy and momentum flow but are never created. In curved spacetime the derivative must be covariant, and the Christoffel terms add something new: in an expanding universe the $\nu = t$ component becomes $\dot\rho + 3H(\rho + p) = 0$. The density falls as the volume grows, and pressure makes it fall faster, because the fluid does work as it expands.`,
      r`The derivative index $\mu$ is contracted with the first index of $T$, so one free upper index $\nu$ is left: four equations, energy and three momentum components. Each upper index of $T$ gets its own $+\Gamma$ term in $\nabla_{\mu}T^{\mu\nu}$; the term $\Gamma^{\mu}_{\mu\lambda}T^{\lambda\nu} = \partial_{\lambda}\ln\sqrt{|g|}\,T^{\lambda\nu}$ is the volume growth.`,
      r`For dust $\rho \propto a^{-3}$ (the number of particles is fixed); for radiation $\rho \propto a^{-4}$ (each photon is also redshifted). This equation is not extra physics: it follows from Einstein's equations and the Bianchi identity. The trace computes the covariant divergence numerically and finds zero for the right pressure. Turn the pressure scale away from 1 and the divergence is no longer zero: that matter would not be allowed by the geometry.`,
    ],
    vocab: [
      { term: 'continuity equation', meaning: 'drho/dt + 3H(rho + p) = 0 in an expanding universe.' },
      { term: 'covariant divergence', meaning: 'nabla_m T^mn: the flat divergence plus Christoffel terms.' },
    ],
    params: [
      { key: 'p', label: 'Expansion law a = t^p', min: 0.3, max: 1.2, step: 0.01, def: 0.5 },
      { key: 't', label: 'Cosmic time t', min: 0.5, max: 3, step: 0.05, def: 1.2 },
      { key: 's', label: 'Pressure scale (1 = the true pressure)', min: 0, max: 2, step: 0.05, def: 1 },
    ],
    trace(params) {
      const p = P(this.params, params), prm = { k: 0, p: p.p }, x0 = [p.t, 0.5, 1.1, 0.3];
      const rhoOf = t => 3 * (p.p / t) ** 2 / (8 * Math.PI), POf = t => -(3 * p.p ** 2 - 2 * p.p) / (8 * Math.PI * t * t);
      const field = x => {
        const gi = M.inverseMetricAt('flrw', x, prm), rho = rhoOf(x[0]), pr = p.s * POf(x[0]);
        const out = new M.Tensor([4, 4], ['u', 'u']);
        for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) out.set((a === 0 && b === 0 ? rho + pr : 0) + pr * gi[a][b], a, b);
        return out;
      };
      const nab = M.covariantDerivative('flrw', field, x0, { params: prm, h: 1e-4 }); // [mu, nu ; lambda]
      const div = M.einsum('mnm->n', nab);
      const H = p.p / p.t, want = 3 * H * (p.s - 1) * POf(p.t);
      return trace([
        step('covariant', 'Take the covariant derivative of the fluid tensor.', r`T^{\mu\nu}`, r`\nabla_{\lambda} T^{\mu\nu}`, { focus: ['lambda'], numeric: { inputs: { T: field(x0) }, output: nab } }),
        step('contract', 'Contract the derivative index with the first index of T.', r`\nabla_{\lambda} T^{\mu\nu}`, r`\nabla_{\mu} T^{\mu\nu}`, { focus: ['mu'], sums: [{ sym: 'mu', range: [0, 4] }], numeric: { inputs: {}, output: div }, viz: { scene: 'contraction-block', params: { shape: [4, 4, 4], axes: [0, 2] } } }),
        step('evaluate', 'The time component is the continuity equation.', r`\nabla_{\mu} T^{\mu 0}`, r`\nabla_{\mu} T^{\mu 0} = ${num(div.get(0), 6)}`, { focus: [] }),
      ], {
        dim: 4, metric: 'flrw',
        checks: [
          check('nabla_m T^mt = 3H (s - 1) P_true', div.get(0), want, 1e-6),
          check('space components are zero (largest)', Math.max(...[1, 2, 3].map(i => Math.abs(div.get(i)))), 0, 1e-6),
        ],
        values: { divergence: div.get(0) },
      });
    },
    viz: { scene: 'contraction-block', params: { shape: [4, 4, 4], axes: [0, 2] } },
    diagram: { style: 'penrose', order: ['\\nabla', 'T'], note: 'The derivative leg bends over and joins the first up leg of T.' },
    refs: [wp('Stress%E2%80%93energy_tensor'), wp('Friedmann_equations'), CARROLL, MTW],
  },
  // --------------------------------------------------------------------------
  {
    id: 'weyl-tensor', title: 'Weyl tensor', field: 'relativity',
    tex: r`C_{\rho\sigma\mu\nu} = R_{\rho\sigma\mu\nu} - \frac{2}{n-2}\left(g_{\rho[\mu}R_{\nu]\sigma} - g_{\sigma[\mu}R_{\nu]\rho}\right) + \frac{2}{(n-1)(n-2)}\,R\,g_{\rho[\mu}g_{\nu]\sigma}`,
    itex: r`C_{\rho\sigma\mu\nu} = R_{\rho\sigma\mu\nu} - \frac{1}{2} g_{\rho\mu} R_{\nu\sigma} + \frac{1}{2} g_{\rho\nu} R_{\mu\sigma} + \frac{1}{2} g_{\sigma\mu} R_{\nu\rho} - \frac{1}{2} g_{\sigma\nu} R_{\mu\rho} + \frac{R}{6} g_{\rho\mu} g_{\nu\sigma} - \frac{R}{6} g_{\rho\nu} g_{\mu\sigma}`,
    shape: { rank: 4, variance: 'dddd', symmetries: 'Riemann symmetries, and every trace is zero', independent: '10 in 4D (n(n+1)(n+2)(n-3)/12)' },
    story: [
      r`Riemann has 20 independent components in four dimensions; Einstein's equations fix only the 10 of its trace, the Ricci tensor, in terms of local matter. The other 10 are the Weyl tensor: the trace-free part of curvature. It is what the formula gives when you subtract every trace of Riemann (the index tex spells out the $n = 4$ case term by term).`,
      r`The Weyl tensor is the part of gravity that travels. Tidal fields far from a star, and gravitational waves, are Weyl curvature with zero Ricci. In the Schwarzschild vacuum, Weyl equals Riemann. In a perfectly smooth FLRW universe, Weyl is zero: the metric is a rescaled flat metric, which is why it is called conformally flat.`,
      r`Weyl has all the symmetries of Riemann, plus $C^{\rho}{}_{\sigma\rho\nu} = 0$ for every trace. It is unchanged by a rescaling $g \to \Omega^{2}g$ (with one index up), which is why it measures shape, not scale. In three dimensions it is always zero, so 3D curvature is all Ricci; in two dimensions curvature is one number.`,
      r`The trace builds it at a point of a black hole and at a point of an expanding universe, checks that Weyl equals Riemann in the first and vanishes in the second, and checks that it is trace-free.`,
    ],
    vocab: [
      { term: 'Weyl tensor', meaning: 'The trace-free part of Riemann; the tidal and wave part of gravity.' },
      { term: 'conformal transformation', meaning: 'g -> Omega^2 g: a rescaling of lengths that keeps angles.' },
    ],
    params: [
      { key: 'M', label: 'Black hole mass M', min: 0.2, max: 2, step: 0.05, def: 1 },
      { key: 'r', label: 'Radius r (in M)', min: 2.5, max: 20, step: 0.1, def: 5 },
      { key: 'p', label: 'Universe expansion a = t^p', min: 0.3, max: 1.2, step: 0.01, def: 0.6667 },
    ],
    trace(params) {
      const p = P(this.params, params);
      const cs = M.curvatureAt('schwarzschild', [0, p.r * p.M, 1.1, 0.3], { M: p.M }), cf = M.curvatureAt('flrw', [1.4, 0.4, 1.0, 0.2], { k: 0, p: p.p });
      const Ws = cs.Weyl, Wf = cf.Weyl;
      const trS = M.einsum('ab,acbd->cd', cs.gInv, Ws);
      return trace([
        step('evaluate', 'Riemann with all indices down, at a point near a black hole.', r`R_{\rho\sigma\mu\nu}`, r`R_{\rho\sigma\mu\nu}`, { focus: [], numeric: { inputs: {}, output: cs.RiemannDown } }),
        step('substitute', 'Subtract every trace of Riemann: the Ricci and scalar terms.', r`R_{\rho\sigma\mu\nu}`, r`C_{\rho\sigma\mu\nu}`, { focus: ['rho', 'sigma', 'mu', 'nu'], numeric: { inputs: { Riemann: cs.RiemannDown, Ricci: cs.Ricci }, output: Ws }, viz: { scene: 'geodesics', params: { surface: 'sphere', deviation: true } } }),
        step('trace', 'Every trace of the Weyl tensor is zero.', r`C_{\rho\sigma\mu\nu}`, r`g^{\rho\mu} C_{\rho\sigma\mu\nu} = 0`, { focus: ['rho', 'mu'], sums: [{ sym: 'rho', range: [0, 4] }, { sym: 'mu', range: [0, 4] }], numeric: { inputs: { Weyl: Ws }, output: trS } }),
        step('evaluate', 'In the smooth expanding universe the Weyl tensor vanishes.', r`C_{\rho\sigma\mu\nu}`, r`C_{\rho\sigma\mu\nu}^{\text{FLRW}} = 0`, { focus: [], numeric: { inputs: {}, output: Wf } }),
      ], {
        dim: 4, metric: 'schwarzschild',
        checks: [
          check('Schwarzschild: Weyl = Riemann (largest difference)', M.maxAbs(M.sub(Ws, cs.RiemannDown)), 0, 1e-10),
          check('Weyl is trace-free (largest trace)', M.maxAbs(trS), 0, 1e-10),
          check('FLRW: Weyl = 0 (largest component)', M.maxAbs(Wf), 0, 1e-10),
          check('C_abcd C^abcd = 48 M^2 / r^6 near the black hole', kretschmann({ ...cs, RiemannDown: Ws }), 48 * p.M ** 2 / (p.r * p.M) ** 6, 1e-10),
        ],
        values: { trace: M.maxAbs(trS) },
      });
    },
    viz: { scene: 'geodesics', params: { surface: 'sphere', deviation: true } },
    diagram: { style: 'penrose', order: ['C'], note: 'A four-leg node; joining any two legs with the metric cap gives zero.' },
    refs: [wp('Weyl_tensor'), CARROLL, MTW, PENROSE],
  },
];
