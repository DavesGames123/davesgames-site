// ============================================================================
//  library/entries-geometry.js  ·  differential geometry: metric, connection,
//  transport, curvature, symmetries, integration
// ----------------------------------------------------------------------------
//  Conventions (the MATH engine, tensor/geometry.js, and MTW / Carroll):
//      Gamma^l_{mn} = 1/2 g^{ls} (d_m g_sn + d_n g_sm - d_s g_mn)
//      R^r_{smn} = d_m Gamma^r_{ns} - d_n Gamma^r_{ms} + Gamma^r_{ml} Gamma^l_{ns} - Gamma^r_{nl} Gamma^l_{ms}
//      R_{sn} = R^r_{srn}, so a sphere of radius a has R = 2/a^2 > 0.
//  Spherical theta is the colatitude (0 at the north pole).
//
//  ENTRIES   (grep -n "id: '<id>'" entries-geometry.js)
//      sphere-metric  polar-christoffel  geodesic-equation  covariant-derivative
//      metric-compatibility  parallel-transport  riemann-tensor  ricci-scalar
//      bianchi-identity  killing-equation  geodesic-deviation  divergence-theorem
// ============================================================================
import * as M from './math.js';
import { step, trace, check, P, num, vecTex, matTex, wp, CARROLL, MTW, SCHUTZ, PENROSE } from './kit.js';

const r = String.raw;
const deg = d => d * Math.PI / 180;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export const GEOMETRY = [
  // --------------------------------------------------------------------------
  {
    id: 'sphere-metric', title: 'The metric tensor of the sphere', field: 'geometry',
    tex: r`ds^{2} = g_{ij}\,dx^{i}dx^{j} = a^{2}\left(d\theta^{2} + \sin^{2}\theta\,d\phi^{2}\right), \qquad g_{ij} = \begin{pmatrix} a^{2} & 0 \\ 0 & a^{2}\sin^{2}\theta \end{pmatrix}`,
    itex: r`s = g_{ij} u^{i} u^{j}`,
    shape: { rank: 2, variance: 'dd', symmetries: 'symmetric', independent: 3 },
    story: [
      r`On a sphere of radius $a$ the coordinates are the colatitude $\theta$ (0 at the north pole) and the longitude $\phi$. A small step $d\theta$ moves you $a\,d\theta$ along a meridian, but a step $d\phi$ moves you only $a\sin\theta\,d\phi$, because the circles of latitude shrink toward the poles. The metric records exactly this: $g_{\theta\theta} = a^{2}$ and $g_{\phi\phi} = a^{2}\sin^{2}\theta$.`,
      r`The line element $ds^{2} = g_{ij}dx^{i}dx^{j}$ is the metric fed the same small displacement twice. Both indices are lower because $g$ eats two vectors: here the coordinate displacement $dx^{i}$, whose index is up. The metric is symmetric, so in two dimensions it has 3 independent components; on the sphere the off-diagonal one is zero because meridians and latitude circles cross at right angles.`,
      r`Draw at each point the ellipse of all displacements of unit length: $g_{ij}\,dx^{i}dx^{j} = 1$ in coordinate space. Near the equator it is nearly a circle; near the poles it stretches without bound in the $\phi$ direction, because you need a large change of longitude to move one unit. These are Tissot's ellipses, and every map projection is a choice of how to distort them.`,
      r`Change coordinates and $g_{ij}$ changes with two Jacobians, $g'_{ij} = \frac{\partial x^{k}}{\partial x'^{i}}\frac{\partial x^{l}}{\partial x'^{j}}g_{kl}$. The components are not the geometry; the lengths they produce are. What no change of coordinates can remove is the curvature, which later entries compute from these same components.`,
    ],
    vocab: [
      { term: 'line element', meaning: 'ds^2 = g_ij dx^i dx^j, the squared length of a small step.' },
      { term: 'colatitude', meaning: 'theta measured from the north pole; latitude is 90 deg minus theta.' },
      { term: 'Tissot ellipse', meaning: 'The image of a small circle; here the unit ellipse of g at each point.' },
    ],
    params: [
      { key: 'a', label: 'Sphere radius a', min: 0.3, max: 3, step: 0.05, def: 1.5 },
      { key: 'theta', label: 'Colatitude theta (deg)', min: 5, max: 175, step: 1, def: 50 },
      { key: 'heading', label: 'Step direction (deg from south)', min: 0, max: 360, step: 1, def: 45 },
    ],
    trace(params) {
      const p = P(this.params, params), x = [deg(p.theta), 0.3], R = p.a;
      const gm = M.metricAt('sphere', x, { R }), g = M.T(gm, ['d', 'd']);
      // a unit step in direction 'heading': physical (south, east) = (cos h, sin h)
      const h = deg(p.heading), u = [Math.cos(h) / R, Math.sin(h) / (R * Math.sin(x[0]))];
      const U = M.T(u, ['u']), s = M.einsum('ij,i,j->', g, U, U).data[0];
      return trace([
        step('evaluate', 'The metric at this point of the sphere.', r`g_{ij}`, r`g_{ij} = ${matTex(gm)}`, { focus: ['i', 'j'], numeric: { inputs: {}, output: g }, viz: { scene: 'metric-ellipses', params: { surface: 'sphere', radius: R } } }),
        step('evaluate', 'A coordinate step that moves one unit of real distance.', r`u^{i}`, r`u^{i} = ${vecTex(u)}`, { focus: ['i'] }),
        step('contract', 'Feed the step to both slots of the metric and sum.', r`g_{ij} u^{k} u^{l}`, r`g_{ij} u^{i} u^{j} = ${num(s, 6)}`, { focus: ['i', 'j'], sums: [{ sym: 'i', range: [0, 2] }, { sym: 'j', range: [0, 2] }], numeric: { inputs: { g, u: U }, output: M.T(s) } }),
      ], {
        dim: 2, metric: 'sphere', coords: 'theta, phi',
        checks: [
          check('g_thetatheta = a^2', gm[0][0], R * R, 1e-12),
          check('g_phiphi = a^2 sin^2 theta', gm[1][1], (R * Math.sin(x[0])) ** 2, 1e-12),
          check('unit step has length 1', s, 1, 1e-12),
        ],
        values: { gthth: gm[0][0], gphph: gm[1][1] },
      });
    },
    viz: { scene: 'metric-ellipses', params: { surface: 'sphere', radius: 1.5 } },
    diagram: { style: 'penrose', order: ['g', 'u', 'u'], note: 'The metric is a cup that closes two up legs.' },
    refs: [wp('Metric_tensor'), wp('Tissot%27s_indicatrix'), CARROLL, SCHUTZ],
  },
  // --------------------------------------------------------------------------
  {
    id: 'polar-christoffel', title: 'Christoffel symbols in polar coordinates', field: 'geometry',
    tex: r`\Gamma^{\lambda}_{\mu\nu} = \tfrac12 g^{\lambda\sigma}\left(\partial_{\mu}g_{\sigma\nu} + \partial_{\nu}g_{\sigma\mu} - \partial_{\sigma}g_{\mu\nu}\right), \qquad \Gamma^{r}_{\theta\theta} = -r, \quad \Gamma^{\theta}_{r\theta} = \Gamma^{\theta}_{\theta r} = \frac{1}{r}`,
    itex: r`\Gamma^{\lambda}_{\mu\nu} = \frac{1}{2} g^{\lambda\sigma} \partial_{\mu} g_{\sigma\nu} + \frac{1}{2} g^{\lambda\sigma} \partial_{\nu} g_{\sigma\mu} - \frac{1}{2} g^{\lambda\sigma} \partial_{\sigma} g_{\mu\nu}`,
    shape: { rank: 3, variance: 'udd', symmetries: 'symmetric in the two lower indices (no torsion)', independent: 'n^2(n+1)/2 = 6 in 2D' },
    story: [
      r`In polar coordinates the basis vectors change from point to point. Walk outward along a ray and $\mathbf e_{\theta}$ grows: its length is $r$. Walk around a circle and $\mathbf e_{r}$ turns. The Christoffel symbols record this: $\partial_{\mu}\mathbf e_{\nu} = \Gamma^{\lambda}_{\mu\nu}\,\mathbf e_{\lambda}$, the rate of change of basis vector $\nu$ in direction $\mu$, written back in the basis.`,
      r`So $\Gamma^{\theta}_{r\theta} = 1/r$ says that moving out in $r$ makes $\mathbf e_{\theta}$ longer at the rate $\mathbf e_{\theta}/r$, and $\Gamma^{r}_{\theta\theta} = -r$ says that moving around in $\theta$ turns $\mathbf e_{\theta}$ inward, toward the centre. All other symbols are zero. Nothing here is curved: the plane is flat, and the symbols come only from curved coordinates.`,
      r`The index shape is one up, two down: $\lambda$ is the output direction, $\mu$ the direction you move, $\nu$ the basis vector that changes. The symbols are symmetric in $\mu\nu$ because coordinate basis vectors commute. In $n$ dimensions there are $n\cdot n(n+1)/2$ independent ones: 6 in the plane, 40 in spacetime.`,
      r`The Christoffel symbols are not a tensor. A tensor that is zero in one coordinate system is zero in all, but $\Gamma$ is zero in Cartesian coordinates and not zero in polar ones. Its transformation law has an extra term with second derivatives of the coordinate change. That extra term is exactly what is needed to make the covariant derivative a tensor.`,
      r`The formula on the left builds $\Gamma$ from first derivatives of the metric. It is the unique connection that is symmetric and keeps lengths fixed during parallel transport (the Levi-Civita connection).`,
    ],
    vocab: [
      { term: 'Christoffel symbols', meaning: 'Gamma^l_mn: how the coordinate basis vectors change from point to point.' },
      { term: 'Levi-Civita connection', meaning: 'The torsion-free connection that preserves the metric.' },
      { term: 'coordinate basis', meaning: 'e_mu = d/dx^mu, the tangent vectors to the coordinate lines.' },
    ],
    params: [
      { key: 'r', label: 'Radius r', min: 0.2, max: 4, step: 0.05, def: 1.5 },
      { key: 'theta', label: 'Angle theta (deg)', min: -180, max: 180, step: 1, def: 30 },
    ],
    trace(params) {
      const p = P(this.params, params), x = [p.r, deg(p.theta)];
      const G = M.christoffel('polar', x), gi = M.inverseMetricAt('polar', x);
      const jet = M.metricJet('polar', x, {}, 1);
      const dg = M.T(jet.dg.map((a, k) => a), ['d', 'd', 'd']); // dg[k][i][j] = d_k g_ij
      const Gm = M.T(gi, ['u', 'u']);
      // Gamma^l_mn = 1/2 g^ls (d_m g_sn + d_n g_sm - d_s g_mn), with einsum on dg[k][i][j]
      const t1 = M.einsum('ls,msn->lmn', Gm, dg), t2 = M.einsum('ls,nsm->lmn', Gm, dg), t3 = M.einsum('ls,smn->lmn', Gm, dg);
      const built = M.T({ shape: [2, 2, 2], variance: ['u', 'd', 'd'], data: t1.data.map((v, i) => 0.5 * (v + t2.data[i] - t3.data[i])) });
      return trace([
        step('partial', 'Take the derivatives of the metric: only d_r g_thetatheta = 2r is not zero.', r`g_{\mu\nu}`, r`\partial_{\sigma} g_{\mu\nu}`, { focus: ['sigma'], numeric: { inputs: {}, output: dg }, viz: { scene: 'curvilinear-grid', params: { coords: 'polar', point: x } } }),
        step('product', 'Combine the three derivative terms and raise with the inverse metric.', r`\partial_{\sigma} g_{\mu\nu}`, r`\frac{1}{2} g^{\lambda\sigma} \partial_{\mu} g_{\sigma\nu}`, { focus: ['lambda', 'sigma'], sums: [{ sym: 'sigma', range: [0, 2] }], numeric: { inputs: { gInv: Gm, dg }, output: built } }),
        step('christoffel', 'The symbols: e_theta grows outward and turns inward around the circle.', r`\frac{1}{2} g^{\lambda\sigma} \partial_{\mu} g_{\sigma\nu}`, r`\Gamma^{\lambda}_{\mu\nu}`, { focus: ['lambda', 'mu', 'nu'], numeric: { inputs: {}, output: G }, viz: { scene: 'christoffel-basis', params: { coords: 'polar', along: 'theta', point: x } } }),
        step('evaluate', 'Only two values appear: -r and 1/r.', r`\Gamma^{\lambda}_{\mu\nu}`, r`\Gamma^{r}_{\theta\theta} = ${num(G.get(0, 1, 1))},\; \Gamma^{\theta}_{r\theta} = ${num(G.get(1, 0, 1))}`, { focus: ['lambda', 'mu', 'nu'] }),
      ], {
        dim: 2, metric: 'polar', coords: 'r, theta',
        checks: [
          check('Gamma^r_thetatheta = -r', G.get(0, 1, 1), -p.r, 1e-12),
          check('Gamma^theta_rtheta = 1/r', G.get(1, 0, 1), 1 / p.r, 1e-12),
          check('Gamma^theta_thetar = 1/r (symmetry)', G.get(1, 1, 0), 1 / p.r, 1e-12),
          check('formula with einsum = MATH christoffel (largest error)', M.maxAbs(M.sub(built, G)), 0, 1e-12),
        ],
        values: { 'Gamma^r_thth': G.get(0, 1, 1), 'Gamma^th_rth': G.get(1, 0, 1) },
      });
    },
    viz: { scene: 'christoffel-basis', params: { coords: 'polar', along: 'theta', point: [1.5, 0.5] } },
    diagram: { style: 'penrose', order: ['\\Gamma'], note: 'Gamma is not a tensor: draw it as a dashed node with one leg up and two down.' },
    refs: [wp('Christoffel_symbols'), CARROLL, SCHUTZ],
  },
  // --------------------------------------------------------------------------
  {
    id: 'geodesic-equation', title: 'Geodesic equation', field: 'geometry',
    tex: r`\frac{d^{2}x^{\lambda}}{ds^{2}} + \Gamma^{\lambda}_{\mu\nu}\,\frac{dx^{\mu}}{ds}\,\frac{dx^{\nu}}{ds} = 0`,
    itex: r`a^{\lambda} + \Gamma^{\lambda}_{\mu\nu} u^{\mu} u^{\nu} = 0`,
    shape: { rank: 1, variance: 'u', symmetries: '-', independent: 'n equations' },
    story: [
      r`A geodesic is a path that does not turn: its velocity is parallel transported along itself. On a sphere the geodesics are great circles; in spacetime they are the paths of free fall. In coordinates the condition is the equation above, where $u^{\mu} = dx^{\mu}/ds$ is the velocity and $s$ is arc length (or proper time).`,
      r`Read the two terms. $d^{2}x^{\lambda}/ds^{2}$ is the coordinate acceleration. The $\Gamma$ term is the acceleration that the coordinates fake because the basis vectors turn and stretch. A geodesic is a path where they cancel, so that the true acceleration, the covariant one, is zero. In polar coordinates a straight line has $\ddot r = r\dot\theta^{2}$: that is the $-\Gamma^{r}_{\theta\theta}\dot\theta^{2}$ term, the centrifugal effect of the coordinates.`,
      r`The free index $\lambda$ is up on both terms: one equation per coordinate. The dummy pair $\mu,\nu$ is summed, and since $u^{\mu}u^{\nu}$ is symmetric, only the symmetric part of $\Gamma$ matters. The equation keeps $g_{\mu\nu}u^{\mu}u^{\nu}$ constant, so the speed along a geodesic does not change.`,
      r`In general relativity this one line replaces Newton's law of gravity: a falling apple follows a geodesic of curved spacetime, and the Christoffel symbols of the Schwarzschild metric play the role of the gravitational field. Here you start a geodesic on the sphere and watch it trace a great circle; the trace checks that it stays in one plane through the centre.`,
    ],
    vocab: [
      { term: 'geodesic', meaning: 'A curve whose tangent is parallel transported along itself; locally the straightest path.' },
      { term: 'great circle', meaning: 'A circle on a sphere whose centre is the centre of the sphere.' },
      { term: 'affine parameter', meaning: 'A parameter, such as arc length, for which the geodesic equation has this form.' },
    ],
    params: [
      { key: 'theta0', label: 'Start colatitude (deg)', min: 10, max: 170, step: 1, def: 60 },
      { key: 'heading', label: 'Heading (deg from east)', min: -90, max: 90, step: 1, def: 30 },
      { key: 'length', label: 'Arc length (radii)', min: 0.5, max: 6.28, step: 0.05, def: 3 },
    ],
    trace(params) {
      const p = P(this.params, params), R = 1, th = deg(p.theta0), hd = deg(p.heading);
      const x0 = [th, 0], v0 = [-Math.sin(hd), Math.cos(hd) / Math.sin(th)]; // unit speed, north = -theta
      const G0 = M.christoffel('sphere', x0, { R });
      const acc = [0, 1].map(l => { let s = 0; for (let m = 0; m < 2; m++) for (let n = 0; n < 2; n++) s -= G0.get(l, m, n) * v0[m] * v0[n]; return s; });
      const run = M.geodesic('sphere', x0, v0, { params: { R }, steps: 600, length: p.length });
      const emb = q => M.METRICS.sphere.embed(q, { R });
      const e0 = emb(x0), h = 1e-5, e1 = emb([x0[0] + h * v0[0], x0[1] + h * v0[1]]), em = emb([x0[0] - h * v0[0], x0[1] - h * v0[1]]);
      const t0 = e1.map((v, i) => (v - em[i]) / (2 * h)), n = [e0[1] * t0[2] - e0[2] * t0[1], e0[2] * t0[0] - e0[0] * t0[2], e0[0] * t0[1] - e0[1] * t0[0]];
      const nn = Math.hypot(...n), plane = Math.max(...run.x.map(q => Math.abs(emb(q).reduce((s, v, i) => s + v * n[i], 0)) / nn));
      const xf = run.final.x, vf = run.final.v, speed = M.inner('sphere', xf, vf, vf, { R });
      const chord = Math.hypot(...emb(xf).map((v, i) => v - e0[i]));
      return trace([
        step('christoffel', 'The Christoffel symbols of the sphere at the start point.', r`g_{\mu\nu}`, r`\Gamma^{\lambda}_{\mu\nu}`, { focus: ['lambda', 'mu', 'nu'], numeric: { inputs: {}, output: G0 } }),
        step('contract', 'Feed the velocity into both lower slots: the coordinate acceleration a geodesic needs.', r`\Gamma^{\lambda}_{\mu\nu} u^{\alpha} u^{\beta}`, r`a^{\lambda} = -\Gamma^{\lambda}_{\mu\nu} u^{\mu} u^{\nu}`, { focus: ['mu', 'nu'], sums: [{ sym: 'mu', range: [0, 2] }, { sym: 'nu', range: [0, 2] }], numeric: { inputs: { Gamma: G0, u: M.T(v0, ['u']) }, output: M.T(acc, ['u']) } }),
        step('evaluate', 'Integrate step by step (RK4): the path is a great circle.', r`a^{\lambda} + \Gamma^{\lambda}_{\mu\nu} u^{\mu} u^{\nu} = 0`, r`x^{\lambda}(s) = ${vecTex(xf)}`, { focus: ['lambda'], viz: { scene: 'geodesics', params: { surface: 'sphere', radius: R, start: x0, velocity: v0, length: p.length } }, ms: 4000 }),
      ], {
        dim: 2, metric: 'sphere', coords: 'theta, phi',
        checks: [
          check('path stays in a plane through the centre (largest offset)', plane, 0, 1e-7),
          check('speed g(u,u) stays 1', speed, 1, 1e-8),
          check('chord length = 2 sin(s/2) on a unit sphere', chord, 2 * Math.abs(Math.sin(p.length / 2)), 1e-8),
        ],
        values: { final: xf },
      });
    },
    viz: { scene: 'geodesics', params: { surface: 'sphere', radius: 1 } },
    diagram: { style: 'penrose', order: ['\\Gamma', 'u', 'u'], note: 'Two velocity nodes plug into the two down legs of Gamma.' },
    refs: [wp('Geodesic'), wp('Geodesics_in_general_relativity'), CARROLL, MTW],
  },
  // --------------------------------------------------------------------------
  {
    id: 'covariant-derivative', title: 'Covariant derivative of a vector', field: 'geometry',
    tex: r`\nabla_{\mu}V^{\nu} = \partial_{\mu}V^{\nu} + \Gamma^{\nu}_{\mu\lambda}V^{\lambda}, \qquad \nabla_{\mu}\omega_{\nu} = \partial_{\mu}\omega_{\nu} - \Gamma^{\lambda}_{\mu\nu}\omega_{\lambda}`,
    itex: r`\nabla_{\mu} V^{\nu} = \partial_{\mu} V^{\nu} + \Gamma^{\nu}_{\mu\lambda} V^{\lambda}`,
    shape: { rank: 2, variance: 'ud (V up, derivative down)', symmetries: 'none', independent: 'n^2' },
    story: [
      r`Take the constant field $\mathbf e_{x}$, an arrow pointing right everywhere. In polar coordinates its components are $V^{r} = \cos\theta$, $V^{\theta} = -\sin\theta/r$: they change from point to point even though the arrow does not. The plain partial derivatives $\partial_{\mu}V^{\nu}$ are not zero. They mix the change of the field with the change of the basis.`,
      r`The covariant derivative removes the basis part: $\nabla_{\mu}V^{\nu} = \partial_{\mu}V^{\nu} + \Gamma^{\nu}_{\mu\lambda}V^{\lambda}$. For $\mathbf e_{x}$ the two terms cancel exactly and $\nabla V = 0$, the right answer for a constant field. For the rotation field $\partial_{\theta}$ the result is not zero, because that field really does turn.`,
      r`The index rule: each upper index of the field gets a $+\Gamma$ term, each lower index a $-\Gamma$ term, and the derivative index $\mu$ always sits in the first lower slot of $\Gamma$. The result has one more lower index than the field, so $\nabla V$ is a $(1,1)$ tensor. That is the point: $\partial_{\mu}V^{\nu}$ is not a tensor, $\nabla_{\mu}V^{\nu}$ is.`,
      r`Slide the mix between the constant field and the rotation field and watch the partial and Christoffel terms trade places. In the Penrose diagram the derivative is a box drawn round the node, with one new leg pointing down.`,
    ],
    vocab: [
      { term: 'covariant derivative', meaning: 'A derivative that gives a tensor: partial derivative plus Christoffel corrections.' },
      { term: 'connection', meaning: 'The rule (here Gamma) that compares vectors at nearby points.' },
    ],
    params: [
      { key: 'r', label: 'Radius r', min: 0.3, max: 3, step: 0.05, def: 1.2 },
      { key: 'theta', label: 'Angle theta (deg)', min: -180, max: 180, step: 1, def: 40 },
      { key: 'mix', label: 'Mix: 0 = constant e_x, 1 = rotation field', min: 0, max: 1, step: 0.05, def: 0 },
    ],
    trace(params) {
      const p = P(this.params, params), x = [p.r, deg(p.theta)], k = p.mix;
      const field = q => M.T([(1 - k) * Math.cos(q[1]), (1 - k) * (-Math.sin(q[1]) / q[0]) + k], ['u']);
      const { T: V, dT } = M.partialDerivative(field, x);
      const G = M.christoffel('polar', x), gterm = M.einsum('nml,l->nm', G, V);
      const nab = M.covariantDerivative('polar', field, x);
      // closed form: rotation field d_theta has nabla_r V^theta = 1/r, nabla_theta V^r = -r
      return trace([
        step('partial', 'Partial derivatives of the components: not zero even for the constant field.', r`V^{\nu}`, r`\partial_{\mu} V^{\nu}`, { focus: ['mu'], numeric: { inputs: { V }, output: dT }, viz: { scene: 'curvilinear-grid', params: { coords: 'polar', point: x } } }),
        step('christoffel', 'The Christoffel term: how much the basis itself changed.', r`V^{\lambda}`, r`\Gamma^{\nu}_{\mu\lambda} V^{\lambda}`, { focus: ['lambda'], sums: [{ sym: 'lambda', range: [0, 2] }], numeric: { inputs: { Gamma: G, V }, output: gterm }, viz: { scene: 'christoffel-basis', params: { coords: 'polar', along: 'theta', point: x } } }),
        step('covariant', 'Add them: the true change of the field.', r`\partial_{\mu} V^{\nu} + \Gamma^{\nu}_{\mu\lambda} V^{\lambda}`, r`\nabla_{\mu} V^{\nu}`, { focus: ['mu', 'nu'], numeric: { inputs: {}, output: nab } }),
        step('evaluate', 'The components (rows nu, columns mu): zero for the constant field.', r`\nabla_{\mu} V^{\nu}`, r`\nabla_{\mu} V^{\nu} = ${matTex(M.toNested(nab))}`, { focus: [] }),
      ], {
        dim: 2, metric: 'polar', coords: 'r, theta',
        checks: [
          check('nabla_r V^r = 0', nab.get(0, 0), 0, 1e-8),
          check('nabla_r V^theta = mix / r (slot order V^nu, then mu)', nab.get(1, 0), k / p.r, 1e-8),
          check('nabla_theta V^r = -mix r', nab.get(0, 1), -k * p.r, 1e-8),
          check('nabla_theta V^theta = 0', nab.get(1, 1), 0, 1e-8),
        ],
        values: {},
      });
    },
    viz: { scene: 'christoffel-basis', params: { coords: 'polar', along: 'theta' } },
    diagram: { style: 'penrose', order: ['\\nabla', 'V'], note: 'A box round V with one new down leg.' },
    refs: [wp('Covariant_derivative'), CARROLL, SCHUTZ, PENROSE],
  },
  // --------------------------------------------------------------------------
  {
    id: 'metric-compatibility', title: 'Metric compatibility', field: 'geometry',
    tex: r`\nabla_{\lambda}g_{\mu\nu} = \partial_{\lambda}g_{\mu\nu} - \Gamma^{\sigma}_{\lambda\mu}g_{\sigma\nu} - \Gamma^{\sigma}_{\lambda\nu}g_{\mu\sigma} = 0`,
    itex: r`\nabla_{\lambda} g_{\mu\nu} = \partial_{\lambda} g_{\mu\nu} - \Gamma^{\sigma}_{\lambda\mu} g_{\sigma\nu} - \Gamma^{\sigma}_{\lambda\nu} g_{\mu\sigma}`,
    shape: { rank: 3, variance: 'ddd', symmetries: 'symmetric in mu nu', independent: 'zero' },
    story: [
      r`The metric has a lot of non-zero partial derivatives on the sphere: $\partial_{\theta}g_{\phi\phi} = 2a^{2}\sin\theta\cos\theta$. Yet its covariant derivative is zero everywhere. Lengths and angles do not change when you carry vectors along with the connection.`,
      r`The metric has two lower indices, so it gets two $-\Gamma$ terms, one per slot. Each one joins a leg of $g$ to the upper leg of $\Gamma$. The three terms cancel at every point, and this fact is what fixes $\Gamma$: solve $\nabla g = 0$ together with $\Gamma^{\lambda}_{\mu\nu} = \Gamma^{\lambda}_{\nu\mu}$ and you get the Christoffel formula, the fundamental theorem of Riemannian geometry.`,
      r`Practical consequence: you can raise and lower indices through a covariant derivative. $\nabla_{\mu}(g_{\nu\lambda}V^{\lambda}) = g_{\nu\lambda}\nabla_{\mu}V^{\lambda}$, so $\nabla_{\mu}V_{\nu}$ and $\nabla_{\mu}V^{\nu}$ are the same tensor with one index moved. Without this, the equations of physics would depend on which index position you wrote down.`,
    ],
    vocab: [
      { term: 'metric compatible', meaning: 'A connection with nabla g = 0: transport keeps lengths and angles.' },
      { term: 'torsion', meaning: 'The antisymmetric part of a connection; the Levi-Civita connection has none.' },
    ],
    params: [
      { key: 'a', label: 'Sphere radius a', min: 0.3, max: 3, step: 0.05, def: 1 },
      { key: 'theta', label: 'Colatitude (deg)', min: 10, max: 170, step: 1, def: 55 },
    ],
    trace(params) {
      const p = P(this.params, params), x = [deg(p.theta), 0.2], R = p.a;
      const field = q => M.T(M.metricAt('sphere', q, { R }), ['d', 'd']);
      const { T: g, dT } = M.partialDerivative(field, x);
      const G = M.christoffel('sphere', x, { R });
      const nab = M.covariantDerivative('sphere', field, x, { params: { R } });
      return trace([
        step('partial', 'The partial derivatives of the metric are not zero.', r`g_{\mu\nu}`, r`\partial_{\lambda} g_{\mu\nu}`, { focus: ['lambda'], numeric: { inputs: { g }, output: dT } }),
        step('christoffel', 'Subtract one Christoffel term per lower slot.', r`\partial_{\lambda} g_{\mu\nu}`, r`\partial_{\lambda} g_{\mu\nu} - \Gamma^{\sigma}_{\lambda\mu} g_{\sigma\nu} - \Gamma^{\sigma}_{\lambda\nu} g_{\mu\sigma}`, { focus: ['sigma'], sums: [{ sym: 'sigma', range: [0, 2] }], numeric: { inputs: { Gamma: G, g }, output: nab } }),
        step('evaluate', 'Every component cancels.', r`\nabla_{\lambda} g_{\mu\nu}`, r`\nabla_{\lambda} g_{\mu\nu} = 0`, { focus: [] }),
      ], {
        dim: 2, metric: 'sphere',
        checks: [
          check('d_theta g_phiphi = 2 a^2 sin cos (slot order mu, nu, lambda)', dT.get(1, 1, 0), 2 * R * R * Math.sin(x[0]) * Math.cos(x[0]), 1e-8),
          check('nabla g = 0 (largest component)', M.maxAbs(nab), 0, 1e-8),
        ],
      });
    },
    viz: { scene: 'metric-ellipses', params: { surface: 'sphere', radius: 1 } },
    diagram: { style: 'penrose', order: ['\\nabla', 'g'], note: 'A box round the metric cup equals zero.' },
    refs: [wp('Levi-Civita_connection'), wp('Fundamental_theorem_of_Riemannian_geometry'), CARROLL],
  },
  // --------------------------------------------------------------------------
  {
    id: 'parallel-transport', title: 'Parallel transport and holonomy', field: 'geometry',
    tex: r`\frac{dV^{\mu}}{ds} + \Gamma^{\mu}_{\nu\lambda}\,\frac{dx^{\nu}}{ds}\,V^{\lambda} = 0, \qquad \Delta\alpha = \oint K\,dA = 2\pi\left(1 - \cos\theta_{0}\right)`,
    itex: r`u^{\nu} \nabla_{\nu} V^{\mu} = 0`,
    shape: { rank: 1, variance: 'u', symmetries: '-', independent: 'n' },
    story: [
      r`To parallel transport a vector is to carry it along a curve without turning it, where "not turning" means the covariant derivative along the curve is zero: $u^{\nu}\nabla_{\nu}V^{\mu} = 0$. Written out, the change of components is exactly the change the Christoffel symbols demand.`,
      r`In flat space a vector carried round any closed loop comes back unchanged. On a sphere it does not. Carry an arrow round the circle of latitude at colatitude $\theta_{0}$ and it comes back rotated by $2\pi(1-\cos\theta_{0})$: the area of the cap inside the loop divided by $a^{2}$, that is, the total curvature enclosed. This rotation is the holonomy of the loop.`,
      r`Indices: the curve's velocity $u^{\nu}$ fills the derivative slot; the transported vector's index $\mu$ is free. The equation is linear in $V$, so transport round a loop is a linear map, a rotation here because the connection keeps lengths. For a tiny loop the rotation is $R^{\mu}{}_{\nu\rho\sigma}V^{\nu}$ times the loop's area element, which is how the Riemann tensor is defined.`,
      r`Foucault's pendulum is this effect: Earth carries the swing plane round a latitude circle each day, and the plane comes back turned by $2\pi\cos\lambda$ (with latitude $\lambda$), which is $2\pi$ minus the holonomy. Move the latitude slider and watch the arrow fail to come home.`,
    ],
    vocab: [
      { term: 'parallel transport', meaning: 'Moving a vector along a curve with zero covariant derivative.' },
      { term: 'holonomy', meaning: 'The rotation a vector picks up round a closed loop.' },
      { term: 'Gaussian curvature', meaning: 'K = 1/a^2 for a sphere; the holonomy per unit area.' },
    ],
    params: [
      { key: 'theta0', label: 'Loop colatitude (deg)', min: 5, max: 175, step: 1, def: 60 },
      { key: 'a', label: 'Sphere radius a', min: 0.3, max: 3, step: 0.05, def: 1 },
    ],
    trace(params) {
      const p = P(this.params, params), th = deg(p.theta0), R = p.a;
      const curve = s => [th, 2 * Math.PI * s];
      const v0 = [1 / R, 0];
      const res = M.parallelTransport('sphere', curve, v0, { params: { R }, steps: 800 });
      const vf = res.final, ang = M.angleBetween('sphere', [th, 0], v0, vf, { R });
      const want = 2 * Math.PI * (1 - Math.cos(th));
      const len = Math.sqrt(M.inner('sphere', [th, 0], vf, vf, { R }));
      const G = M.christoffel('sphere', [th, 0], { R });
      return trace([
        step('christoffel', 'The connection on the latitude circle.', r`g_{\mu\nu}`, r`\Gamma^{\mu}_{\nu\lambda}`, { focus: ['mu', 'nu', 'lambda'], numeric: { inputs: {}, output: G } }),
        step('covariant', 'Carry the vector so that its covariant derivative along the loop is zero.', r`V^{\mu}`, r`u^{\nu} \nabla_{\nu} V^{\mu} = 0`, { focus: ['nu'], sums: [{ sym: 'nu', range: [0, 2] }], viz: { scene: 'parallel-transport', params: { latitude: 90 - p.theta0, radius: R } }, ms: 5000 }),
        step('evaluate', 'Back at the start the vector has turned by the enclosed curvature.', r`V^{\mu}`, r`\Delta\alpha = ${num(Math.abs(wrap(ang)), 4)}\ \text{rad}`, { focus: ['mu'] }),
      ], {
        dim: 2, metric: 'sphere',
        checks: [
          check('cos(turn) = cos(2 pi (1 - cos theta0))', Math.cos(ang), Math.cos(want), 1e-6),
          check('|sin(turn)| = |sin(2 pi (1 - cos theta0))|', Math.abs(Math.sin(ang)), Math.abs(Math.sin(want)), 1e-6),
          check('length is kept', len, 1, 1e-6),
        ],
        values: { holonomy: want, measured: ang },
      });
    },
    viz: { scene: 'parallel-transport', params: { latitude: 30, radius: 1 } },
    diagram: { style: 'penrose', order: ['u', '\\nabla', 'V'], note: 'The velocity leg joins the derivative box.' },
    refs: [wp('Parallel_transport'), wp('Holonomy'), wp('Foucault_pendulum'), CARROLL, PENROSE],
  },
  // --------------------------------------------------------------------------
  {
    id: 'riemann-tensor', title: 'Riemann curvature tensor', field: 'geometry',
    tex: r`R^{\rho}{}_{\sigma\mu\nu} = \partial_{\mu}\Gamma^{\rho}_{\nu\sigma} - \partial_{\nu}\Gamma^{\rho}_{\mu\sigma} + \Gamma^{\rho}_{\mu\lambda}\Gamma^{\lambda}_{\nu\sigma} - \Gamma^{\rho}_{\nu\lambda}\Gamma^{\lambda}_{\mu\sigma}`,
    itex: r`R^{\rho}{}_{\sigma\mu\nu} = \partial_{\mu} \Gamma^{\rho}_{\nu\sigma} - \partial_{\nu} \Gamma^{\rho}_{\mu\sigma} + \Gamma^{\rho}_{\mu\lambda} \Gamma^{\lambda}_{\nu\sigma} - \Gamma^{\rho}_{\nu\lambda} \Gamma^{\lambda}_{\mu\sigma}`,
    shape: { rank: 4, variance: 'uddd', symmetries: 'R_{rsmn} = -R_{srmn} = -R_{rsnm} = R_{mnrs}; R_{r[smn]} = 0', independent: 'n^2(n^2-1)/12: 1 in 2D, 6 in 3D, 20 in 4D' },
    story: [
      r`The Riemann tensor measures how much covariant derivatives fail to commute: $[\nabla_{\mu},\nabla_{\nu}]V^{\rho} = R^{\rho}{}_{\sigma\mu\nu}V^{\sigma}$. Equivalently: carry $V$ round a tiny loop spanned by directions $\mu$ and $\nu$, and it comes back changed by $R^{\rho}{}_{\sigma\mu\nu}V^{\sigma}$ times the loop's area. This page uses the sign convention of Misner, Thorne and Wheeler and of Carroll, in which a sphere has positive curvature.`,
      r`Each index has a job. The last two, $\mu\nu$, name the plane of the loop, so they are antisymmetric. $\sigma$ is the slot for the vector you transport, and $\rho$ is the output component of its change. Lower $\rho$ with the metric and the full tensor $R_{\rho\sigma\mu\nu}$ is antisymmetric in its first pair too, symmetric under swapping the pairs, and obeys the cyclic identity $R_{\rho[\sigma\mu\nu]} = 0$.`,
      r`Those symmetries cut $n^{4}$ components down to $n^{2}(n^{2}-1)/12$: one in 2D (the Gaussian curvature), six in 3D, twenty in 4D spacetime. On a sphere of radius $a$ the only independent one is $R_{\theta\phi\theta\phi} = a^{2}\sin^{2}\theta$, and the Gaussian curvature is $K = R_{\theta\phi\theta\phi}/\det g = 1/a^{2}$.`,
      r`Unlike $\Gamma$, Riemann is a true tensor: if it vanishes in one coordinate system it vanishes in all, and then the space is flat. The formula is built from derivatives of $\Gamma$ (second derivatives of the metric) plus products of $\Gamma$; the step player shows each of the four terms. In a Penrose diagram it is one node with one leg up and three down, with an antisymmetry bar over the last two.`,
    ],
    vocab: [
      { term: 'Riemann tensor', meaning: 'R^r_smn: the change of a vector carried round a small loop in the mn plane.' },
      { term: 'commutator of derivatives', meaning: '[nabla_m, nabla_n] V^r = R^r_smn V^s.' },
      { term: 'flat', meaning: 'Riemann = 0 everywhere; then coordinates exist with constant metric.' },
    ],
    params: [
      { key: 'a', label: 'Sphere radius a', min: 0.3, max: 3, step: 0.05, def: 1.2 },
      { key: 'theta', label: 'Colatitude (deg)', min: 10, max: 170, step: 1, def: 60 },
    ],
    trace(params) {
      const p = P(this.params, params), x = [deg(p.theta), 0.4], R = p.a;
      const c = M.curvatureAt('sphere', x, { R }), Rm = c.Riemann, Rd = c.RiemannDown;
      const det = M.matDet(M.metricAt('sphere', x, { R })), K = Rd.get(0, 1, 0, 1) / det;
      let anti = 0, pair = 0;
      for (const [a, b, cc, d] of M.indexTuples([2, 2, 2, 2])) {
        anti = Math.max(anti, Math.abs(Rd.get(a, b, cc, d) + Rd.get(b, a, cc, d)), Math.abs(Rd.get(a, b, cc, d) + Rd.get(a, b, d, cc)));
        pair = Math.max(pair, Math.abs(Rd.get(a, b, cc, d) - Rd.get(cc, d, a, b)));
      }
      return trace([
        step('christoffel', 'Start from the Christoffel symbols.', r`g_{\mu\nu}`, r`\Gamma^{\rho}_{\nu\sigma}`, { focus: ['rho'], numeric: { inputs: {}, output: c.Gamma } }),
        step('partial', 'Differentiate them: the two derivative terms, antisymmetric in mu nu.', r`\Gamma^{\rho}_{\nu\sigma}`, r`\partial_{\mu} \Gamma^{\rho}_{\nu\sigma} - \partial_{\nu} \Gamma^{\rho}_{\mu\sigma}`, { focus: ['mu', 'nu'] }),
        step('contract', 'Add the two products of Gammas, each with a summed lambda.', r`\partial_{\mu} \Gamma^{\rho}_{\nu\sigma} - \partial_{\nu} \Gamma^{\rho}_{\mu\sigma}`, r`\partial_{\mu} \Gamma^{\rho}_{\nu\sigma} - \partial_{\nu} \Gamma^{\rho}_{\mu\sigma} + \Gamma^{\rho}_{\mu\lambda} \Gamma^{\lambda}_{\nu\sigma} - \Gamma^{\rho}_{\nu\lambda} \Gamma^{\lambda}_{\mu\sigma}`, { focus: ['lambda'], sums: [{ sym: 'lambda', range: [0, 2] }], numeric: { inputs: { Gamma: c.Gamma }, output: Rm }, viz: { scene: 'curvature-loop', params: { surface: 'sphere', radius: R, size: 0.3 } } }),
        step('lower', 'Lower rho: the all-lower tensor with its pair symmetries.', r`R^{\rho}{}_{\sigma\mu\nu}`, r`R_{\alpha\sigma\mu\nu} = g_{\alpha\rho} R^{\rho}{}_{\sigma\mu\nu}`, { focus: ['rho', 'alpha'], sums: [{ sym: 'rho', range: [0, 2] }], numeric: { inputs: { Riemann: Rm }, output: Rd } }),
        step('evaluate', 'One independent component in 2D: the Gaussian curvature.', r`R_{\theta\phi\theta\phi}`, r`K = \frac{R_{\theta\phi\theta\phi}}{\det g} = ${num(K, 5)}`, { focus: [] }),
      ], {
        dim: 2, metric: 'sphere',
        checks: [
          check('R^theta_phithetaphi = sin^2 theta', Rm.get(0, 1, 0, 1), Math.sin(x[0]) ** 2, 1e-10),
          check('R_thetaphithetaphi = a^2 sin^2 theta', Rd.get(0, 1, 0, 1), (R * Math.sin(x[0])) ** 2, 1e-10),
          check('Gaussian curvature K = 1/a^2', K, 1 / (R * R), 1e-10),
          check('antisymmetry in each pair (largest error)', anti, 0, 1e-10),
          check('pair symmetry R_abcd = R_cdab (largest error)', pair, 0, 1e-10),
        ],
        values: { K },
      });
    },
    viz: { scene: 'curvature-loop', params: { surface: 'sphere', radius: 1.2, size: 0.3 } },
    diagram: { style: 'penrose', order: ['R'], note: 'One node, one leg up, three down; a straight bar over the last two legs.' },
    refs: [wp('Riemann_curvature_tensor'), CARROLL, MTW, PENROSE],
  },
  // --------------------------------------------------------------------------
  {
    id: 'ricci-scalar', title: 'Ricci tensor and scalar curvature', field: 'geometry',
    tex: r`R_{\sigma\nu} = R^{\rho}{}_{\sigma\rho\nu}, \qquad R = g^{\sigma\nu}R_{\sigma\nu}; \qquad R_{\text{sphere}} = \frac{2}{a^{2}}, \quad R_{\text{torus}} = \frac{2\cos v}{b\,(c + b\cos v)}`,
    itex: r`R_{\sigma\nu} = R^{\rho}{}_{\sigma\rho\nu}`,
    shape: { rank: 2, variance: 'dd', symmetries: 'symmetric', independent: 'n(n+1)/2' },
    story: [
      r`Contract the upper index of Riemann with its first loop index and you get the Ricci tensor, $R_{\sigma\nu} = R^{\rho}{}_{\sigma\rho\nu}$. It is symmetric with $n(n+1)/2$ components, ten in spacetime. Contract once more with the inverse metric and you get one number per point, the scalar curvature $R = g^{\sigma\nu}R_{\sigma\nu}$.`,
      r`Geometrically, Ricci measures how volumes change. Start a small ball of test particles moving in direction $u$ along geodesics: $R_{\mu\nu}u^{\mu}u^{\nu}$ is the rate at which the ball's volume begins to shrink. Positive Ricci curvature focuses geodesics, the way gravity focuses falling dust. The scalar curvature compares the area of a small sphere with its flat-space value.`,
      r`For a sphere of radius $a$ (with this page's sign convention) $R = 2/a^{2}$: twice the Gaussian curvature, because in 2D $R = 2K$. On a torus with tube radius $b$ and main radius $c$ the curvature changes sign: positive on the outside where the surface is like a sphere, negative on the inside where it is like a saddle, zero on the top and bottom circles.`,
      r`Which indices to contract is a convention, and books differ by signs. Here Ricci contracts the first and third slots of $R^{\rho}{}_{\sigma\mu\nu}$. The test for any convention is the sphere: if your formula gives a negative scalar curvature for a sphere, the signs are the other book's.`,
    ],
    vocab: [
      { term: 'Ricci tensor', meaning: 'R_sn = R^r_srn, the trace of Riemann; the volume-change part of curvature.' },
      { term: 'scalar curvature', meaning: 'R = g^sn R_sn; 2/a^2 for a sphere of radius a.' },
      { term: 'saddle', meaning: 'A surface point with negative Gaussian curvature.' },
    ],
    params: [
      { key: 'a', label: 'Sphere radius a', min: 0.3, max: 3, step: 0.05, def: 1 },
      { key: 'c', label: 'Torus main radius c', min: 1, max: 4, step: 0.05, def: 2 },
      { key: 'b', label: 'Torus tube radius b', min: 0.1, max: 0.95, step: 0.05, def: 0.7 },
      { key: 'v', label: 'Torus tube angle v (deg)', min: -180, max: 180, step: 1, def: 30 },
    ],
    trace(params) {
      const p = P(this.params, params), xs = [1.1, 0.4], xt = [0.3, deg(p.v)];
      const cs = M.curvatureAt('sphere', xs, { R: p.a }), ct = M.curvatureAt('torus', xt, { R: p.c, a: p.b });
      const ric = M.einsum('rsrn->sn', cs.Riemann), Rs = M.einsum('sn,sn->', cs.gInv, ric).data[0];
      const Rt = ct.R, want = 2 * Math.cos(xt[1]) / (p.b * (p.c + p.b * Math.cos(xt[1])));
      return trace([
        step('contract', 'Contract the up index of Riemann with its first loop index.', r`R^{\rho}{}_{\sigma\mu\nu}`, r`R_{\sigma\nu} = R^{\rho}{}_{\sigma\rho\nu}`, { focus: ['rho'], sums: [{ sym: 'rho', range: [0, 2] }], numeric: { inputs: { Riemann: cs.Riemann }, output: ric }, viz: { scene: 'contraction-block', params: { shape: [2, 2, 2, 2], axes: [0, 2] } } }),
        step('raise', 'Trace it with the inverse metric: one number per point.', r`R_{\sigma\nu}`, r`R = g^{\sigma\nu} R_{\sigma\nu}`, { focus: ['sigma', 'nu'], sums: [{ sym: 'sigma', range: [0, 2] }, { sym: 'nu', range: [0, 2] }], viz: { scene: 'metric-ellipses', params: { surface: 'sphere', radius: p.a } } }),
        step('evaluate', 'On the sphere the scalar curvature is 2/a^2.', r`R`, r`R_{\text{sphere}} = ${num(Rs, 5)}`, { focus: [] }),
        step('evaluate', 'The same steps on a torus: positive outside, negative inside.', r`R`, r`R_{\text{torus}} = ${num(Rt, 5)}`, { focus: [], viz: { scene: 'metric-ellipses', params: { surface: 'torus', R: p.c, r: p.b } } }),
      ], {
        dim: 2, metric: 'sphere',
        checks: [
          check('sphere R = 2/a^2', Rs, 2 / p.a ** 2, 1e-10),
          check('sphere Ricci = g / a^2 (R_thth = 1)', ric.get(0, 0), 1, 1e-10),
          check('torus R = 2 cos v / (b (c + b cos v))', Rt, want, 1e-10),
        ],
        values: { sphere: Rs, torus: Rt },
      });
    },
    viz: { scene: 'metric-ellipses', params: { surface: 'torus', R: 2, r: 0.7 } },
    diagram: { style: 'penrose', order: ['R'], note: 'The up leg of Riemann bends down and joins its second lower leg.' },
    refs: [wp('Ricci_curvature'), wp('Scalar_curvature'), CARROLL, MTW],
  },
  // --------------------------------------------------------------------------
  {
    id: 'bianchi-identity', title: 'Bianchi identities', field: 'geometry',
    tex: r`R_{\rho[\sigma\mu\nu]} = 0, \qquad \nabla_{[\lambda}R_{\rho\sigma]\mu\nu} = 0, \qquad \nabla^{\mu}G_{\mu\nu} = 0`,
    itex: r`R_{\rho\sigma\mu\nu} + R_{\rho\mu\nu\sigma} + R_{\rho\nu\sigma\mu} = 0`,
    shape: { rank: 4, variance: 'dddd', symmetries: 'cyclic sum over the last three slots vanishes', independent: '-' },
    story: [
      r`The first Bianchi identity says that the cyclic sum of Riemann over its last three indices is zero. It holds because the connection has no torsion. It is the identity that cuts Riemann down to $n^{2}(n^{2}-1)/12$ independent components.`,
      r`The second, differential, identity says that the covariant derivative of Riemann, antisymmetrised over the derivative slot and the first pair, is zero: $\nabla_{[\lambda}R_{\rho\sigma]\mu\nu} = 0$. Geometrically it is "the boundary of a boundary is zero": add up the holonomies round the faces of a tiny cube and they cancel, because each edge is used twice in opposite directions.`,
      r`Contract the differential identity twice and you get $\nabla^{\mu}G_{\mu\nu} = 0$ for the Einstein tensor $G_{\mu\nu} = R_{\mu\nu} - \frac12 Rg_{\mu\nu}$. This is not a law of physics but an identity of geometry, and it is why Einstein's equations force energy and momentum to be conserved: if $G_{\mu\nu} = 8\pi T_{\mu\nu}$ then $\nabla^{\mu}T_{\mu\nu} = 0$ comes free.`,
      r`The trace here checks the cyclic identity on all 256 components of the Schwarzschild Riemann tensor, and the differential identity with numerical covariant derivatives.`,
    ],
    vocab: [
      { term: 'first Bianchi identity', meaning: 'R_r[smn] = 0, from zero torsion.' },
      { term: 'second Bianchi identity', meaning: 'nabla_[l R_rs]mn = 0, from the geometry of small cubes.' },
      { term: 'contracted Bianchi identity', meaning: 'nabla^m G_mn = 0, the reason Einstein equations conserve energy.' },
    ],
    params: [
      { key: 'M', label: 'Mass M', min: 0.2, max: 2, step: 0.05, def: 1 },
      { key: 'r', label: 'Radius r (in M)', min: 2.5, max: 20, step: 0.1, def: 6 },
      { key: 'theta', label: 'Colatitude (deg)', min: 20, max: 160, step: 1, def: 70 },
    ],
    trace(params) {
      const p = P(this.params, params), x = [0, p.r * p.M, deg(p.theta), 0.3], prm = { M: p.M };
      const c = M.curvatureAt('schwarzschild', x, prm), Rd = c.RiemannDown;
      let cyc = 0;
      for (const [a, b, cc, d] of M.indexTuples([4, 4, 4, 4])) cyc = Math.max(cyc, Math.abs(Rd.get(a, b, cc, d) + Rd.get(a, cc, d, b) + Rd.get(a, d, b, cc)));
      const field = q => M.curvatureAt('schwarzschild', q, prm).RiemannDown;
      const nab = M.covariantDerivative('schwarzschild', field, x, { params: prm, h: 1e-3 }); // slots r s m n ; l
      // second identity: sum over cyclic (m n l) of R_{rs mn;l}
      let bian = 0, scaleN = 0;
      for (const [a, b, cc, d, l] of M.indexTuples([4, 4, 4, 4, 4])) {
        bian = Math.max(bian, Math.abs(nab.get(a, b, cc, d, l) + nab.get(a, b, d, l, cc) + nab.get(a, b, l, cc, d)));
        scaleN = Math.max(scaleN, Math.abs(nab.get(a, b, cc, d, l)));
      }
      return trace([
        step('evaluate', 'The Riemann tensor of a black hole at this point (all indices down).', r`g_{\mu\nu}`, r`R_{\rho\sigma\mu\nu}`, { focus: ['rho', 'sigma', 'mu', 'nu'], numeric: { inputs: {}, output: Rd } }),
        step('antisymmetrize', 'Sum over cyclic orders of the last three indices.', r`R_{\rho\sigma\mu\nu}`, r`R_{\rho\sigma\mu\nu} + R_{\rho\mu\nu\sigma} + R_{\rho\nu\sigma\mu}`, { focus: ['sigma', 'mu', 'nu'] }),
        step('evaluate', 'Every component is zero: the first Bianchi identity.', r`R_{\rho[\sigma\mu\nu]}`, r`R_{\rho[\sigma\mu\nu]} = 0`, { focus: [] }),
        step('covariant', 'Take the covariant derivative and sum cyclically over the loop and derivative slots.', r`R_{\rho\sigma\mu\nu}`, r`\nabla_{\lambda} R_{\rho\sigma\mu\nu} + \nabla_{\mu} R_{\rho\sigma\nu\lambda} + \nabla_{\nu} R_{\rho\sigma\lambda\mu}`, { focus: ['lambda', 'mu', 'nu'], numeric: { inputs: { Riemann: Rd }, output: nab }, viz: { scene: 'flamm-paraboloid', params: { mass: p.M, r: p.r * p.M } } }),
        step('evaluate', 'Zero again, up to the error of the numerical derivative.', r`\nabla_{[\lambda} R_{|\rho\sigma|\mu\nu]}`, r`\nabla_{[\lambda} R_{|\rho\sigma|\mu\nu]} = 0`, { focus: [] }),
      ], {
        dim: 4, metric: 'schwarzschild',
        checks: [
          check('first Bianchi identity (largest cyclic sum)', cyc, 0, 1e-12),
          check('second Bianchi identity relative to the size of nabla R', bian / Math.max(scaleN, 1e-30), 0, 1e-6),
        ],
        values: { cyclic: cyc, differential: bian },
      });
    },
    viz: { scene: 'curvature-loop', params: { surface: 'sphere', radius: 1, size: 0.3 } },
    diagram: { style: 'penrose', order: ['\\nabla', 'R'], note: 'A straight antisymmetry bar across the derivative leg and two Riemann legs.' },
    refs: [wp('Bianchi_identities'), MTW, CARROLL],
  },
  // --------------------------------------------------------------------------
  {
    id: 'killing-equation', title: 'Killing equation', field: 'geometry',
    tex: r`\nabla_{\mu}\xi_{\nu} + \nabla_{\nu}\xi_{\mu} = 0`,
    itex: r`\nabla_{\mu} \xi_{\nu} + \nabla_{\nu} \xi_{\mu} = 0`,
    shape: { rank: 2, variance: 'dd', symmetries: 'symmetric (the equation is the symmetric part of nabla xi)', independent: 'n(n+1)/2 equations' },
    story: [
      r`A Killing vector field $\xi$ is a direction in which you can slide the whole space without stretching it: a symmetry. The condition is that the symmetric part of $\nabla_{\mu}\xi_{\nu}$ is zero, so the flow of $\xi$ changes no lengths. Equivalently, the Lie derivative of the metric along $\xi$ is zero.`,
      r`On the sphere, rotation about the axis, $\xi = \partial_{\phi}$, is a Killing field: with $\xi_{\nu} = g_{\nu\mu}\xi^{\mu} = (0,\ a^{2}\sin^{2}\theta)$ the equation holds at every point. The field $\partial_{\theta}$, which pushes everything toward the south pole, is not: it stretches the latitude circles, and $\nabla_{\phi}\xi_{\phi} + \nabla_{\phi}\xi_{\phi} = 2a^{2}\sin\theta\cos\theta$.`,
      r`Both indices are lower because the equation is about the metric, a lower-index object. It has $n(n+1)/2$ components, one per independent entry of the metric's change. A space of dimension $n$ has at most $n(n+1)/2$ independent Killing fields; the sphere has the maximum, three rotations.`,
      r`Each Killing field gives a conserved quantity along every geodesic: $\xi_{\mu}u^{\mu}$ is constant. On the sphere it is angular momentum about the axis. In Schwarzschild spacetime the field $\partial_{t}$ gives conserved energy and $\partial_{\phi}$ conserved angular momentum, the two numbers that fix every orbit.`,
    ],
    vocab: [
      { term: 'Killing vector', meaning: 'A vector field whose flow is an isometry: nabla_(m xi_n) = 0.' },
      { term: 'isometry', meaning: 'A map that keeps all distances.' },
      { term: 'Lie derivative', meaning: 'The change of a tensor along the flow of a vector field.' },
    ],
    params: [
      { key: 'a', label: 'Sphere radius a', min: 0.3, max: 3, step: 0.05, def: 1 },
      { key: 'theta', label: 'Colatitude (deg)', min: 10, max: 170, step: 1, def: 50 },
      { key: 'mix', label: 'Mix: 0 = rotation d_phi, 1 = d_theta', min: 0, max: 1, step: 0.05, def: 0 },
    ],
    trace(params) {
      const p = P(this.params, params), x = [deg(p.theta), 0.5], R = p.a, k = p.mix;
      const field = q => M.T([k * R * R, (1 - k) * (R * Math.sin(q[0])) ** 2], ['d']);
      const nab = M.covariantDerivative('sphere', field, x, { params: { R } }); // [nu, mu]
      const K = M.T({ shape: [2, 2], variance: ['d', 'd'], data: nab.data.map((v, i) => v + nab.data[[0, 2, 1, 3][i]]) });
      const want = 2 * k * R * R * Math.sin(x[0]) * Math.cos(x[0]);
      return trace([
        step('lower', 'Lower the field with the metric.', r`\xi^{\mu}`, r`\xi_{\nu} = g_{\nu\mu} \xi^{\mu}`, { focus: ['mu'], sums: [{ sym: 'mu', range: [0, 2] }], numeric: { inputs: {}, output: field(x) } }),
        step('covariant', 'Take its covariant derivative.', r`\xi_{\nu}`, r`\nabla_{\mu} \xi_{\nu}`, { focus: ['mu'], numeric: { inputs: {}, output: nab }, viz: { scene: 'metric-ellipses', params: { surface: 'sphere', radius: R } } }),
        step('symmetrize', 'Keep only the symmetric part: the stretching of the metric.', r`\nabla_{\mu} \xi_{\nu}`, r`\nabla_{\mu} \xi_{\nu} + \nabla_{\nu} \xi_{\mu}`, { focus: ['mu', 'nu'], numeric: { inputs: {}, output: K } }),
        step('evaluate', 'Zero for the rotation; not zero for the push toward the pole.', r`\nabla_{\mu} \xi_{\nu} + \nabla_{\nu} \xi_{\mu}`, r`\nabla_{\mu} \xi_{\nu} + \nabla_{\nu} \xi_{\mu} = ${matTex(M.toNested(K), 4)}`, { focus: [] }),
      ], {
        dim: 2, metric: 'sphere',
        checks: [
          check('phiphi component = 2 mix a^2 sin cos', K.get(1, 1), want, 1e-8),
          check('thetatheta component = 0', K.get(0, 0), 0, 1e-8),
          check('thetaphi component = 0', K.get(0, 1), 0, 1e-8),
        ],
        values: { phiphi: K.get(1, 1) },
      });
    },
    viz: { scene: 'metric-ellipses', params: { surface: 'sphere', radius: 1 } },
    diagram: { style: 'penrose', order: ['\\nabla', '\\xi'], note: 'A wavy symmetrisation bar over the derivative leg and the leg of xi.' },
    refs: [wp('Killing_vector_field'), CARROLL, MTW],
  },
  // --------------------------------------------------------------------------
  {
    id: 'geodesic-deviation', title: 'Geodesic deviation', field: 'geometry',
    tex: r`\frac{D^{2}S^{\mu}}{ds^{2}} = R^{\mu}{}_{\nu\rho\sigma}\,T^{\nu}\,T^{\rho}\,S^{\sigma}`,
    itex: r`A^{\mu} = R^{\mu}{}_{\nu\rho\sigma} T^{\nu} T^{\rho} S^{\sigma}`,
    shape: { rank: 1, variance: 'u', symmetries: '-', independent: 'n' },
    story: [
      r`Start two geodesics side by side, parallel, a small distance $S$ apart. In flat space they stay parallel. On a sphere two meridians that start parallel at the equator meet at the pole. The relative acceleration of nearby geodesics is the Riemann tensor fed the tangent $T$ twice and the separation $S$ once.`,
      r`Indices: $T^{\nu}$ and $T^{\rho}$ fill the vector slot and the first loop slot, $S^{\sigma}$ fills the second loop slot, and $\mu$ is the free direction of the acceleration. With this page's convention the formula reads $A^{\mu} = R^{\mu}{}_{\nu\rho\sigma}T^{\nu}T^{\rho}S^{\sigma}$; other books swap the last two slots and add a minus sign, with the same physics.`,
      r`On a unit-speed meridian of a sphere of radius $a$ this gives $A = -S/a^{2}$: the separation obeys $\ddot S = -S/a^{2}$ and so $S(s) = S_{0}\cos(s/a)$, which reaches zero after a quarter circle. That is the whole of the curvature in one sentence: positive curvature focuses geodesics.`,
      r`In general relativity geodesic deviation is the tidal force. Two freely falling particles next to the Earth drift apart vertically and together horizontally; nothing pushes them, the Riemann tensor of spacetime does it. A gravitational wave is a ripple of Riemann that a detector senses as geodesic deviation between its mirrors.`,
    ],
    vocab: [
      { term: 'geodesic deviation', meaning: 'The relative acceleration of nearby geodesics, given by Riemann.' },
      { term: 'tidal force', meaning: 'The physical name of geodesic deviation in gravity.' },
      { term: 'Jacobi field', meaning: 'The separation vector S between neighbouring geodesics.' },
    ],
    params: [
      { key: 'a', label: 'Sphere radius a', min: 0.3, max: 3, step: 0.05, def: 1 },
      { key: 'length', label: 'Distance along the meridian (radii)', min: 0.1, max: 1.5, step: 0.05, def: 1 },
    ],
    trace(params) {
      const p = P(this.params, params), R = p.a, x0 = [Math.PI / 2, 0];
      const Tv = [-1 / R, 0], S0 = 1e-3, Sv = [0, S0 / R]; // north along the meridian; separation east
      const Rm = M.riemann('sphere', x0, { R });
      const A = M.einsum('mnrs,n,r,s->m', Rm, M.T(Tv, ['u']), M.T(Tv, ['u']), M.T(Sv, ['u']));
      const physA = A.data[1] * R; // phi component times a sin(theta) = a at the equator
      const run1 = M.geodesic('sphere', x0, Tv, { params: { R }, steps: 400, length: p.length * R });
      const run2 = M.geodesic('sphere', [x0[0], Sv[1]], Tv, { params: { R }, steps: 400, length: p.length * R });
      const q1 = M.METRICS.sphere.embed(run1.final.x, { R }), q2 = M.METRICS.sphere.embed(run2.final.x, { R });
      const sep = Math.hypot(...q1.map((v, i) => v - q2[i]));
      return trace([
        step('evaluate', 'The Riemann tensor at the equator.', r`g_{\mu\nu}`, r`R^{\mu}{}_{\nu\rho\sigma}`, { focus: ['mu'], numeric: { inputs: {}, output: Rm } }),
        step('contract', 'Feed it the tangent twice and the separation once.', r`R^{\mu}{}_{\nu\rho\sigma}`, r`R^{\mu}{}_{\nu\rho\sigma} T^{\nu} T^{\rho} S^{\sigma}`, { focus: ['nu', 'rho', 'sigma'], sums: [{ sym: 'nu', range: [0, 2] }, { sym: 'rho', range: [0, 2] }, { sym: 'sigma', range: [0, 2] }], numeric: { inputs: { Riemann: Rm, T: M.T(Tv, ['u']), S: M.T(Sv, ['u']) }, output: A } }),
        step('evaluate', 'The two geodesics bend toward each other: S(s) = S0 cos(s/a).', r`A^{\mu}`, r`\frac{S(s)}{S_{0}} = ${num(sep / S0, 5)}`, { focus: [], viz: { scene: 'geodesics', params: { surface: 'sphere', radius: R, spread: 0.2, deviation: true } }, ms: 4000 }),
      ], {
        dim: 2, metric: 'sphere',
        checks: [
          check('relative acceleration = -S/a^2', physA, -S0 / (R * R), 1e-9),
          check('separation after s: S0 cos(s/a) (chord, small S0)', sep / S0, Math.cos(p.length), 2e-3),
        ],
        values: { ratio: sep / S0 },
      });
    },
    viz: { scene: 'geodesics', params: { surface: 'sphere', radius: 1, spread: 0.2, deviation: true } },
    diagram: { style: 'penrose', order: ['R', 'T', 'T', 'S'], note: 'Three vector nodes plug into the three lower legs of Riemann.' },
    refs: [wp('Geodesic_deviation'), wp('Tidal_force'), CARROLL, MTW],
  },
  // --------------------------------------------------------------------------
  {
    id: 'divergence-theorem', title: 'Divergence theorem', field: 'geometry',
    tex: r`\int_{V}\nabla_{\mu}V^{\mu}\,\sqrt{|g|}\,d^{n}x = \oint_{\partial V}V^{\mu}n_{\mu}\,\sqrt{|h|}\,d^{n-1}x, \qquad \nabla_{\mu}V^{\mu} = \frac{1}{\sqrt{|g|}}\,\partial_{\mu}\!\left(\sqrt{|g|}\,V^{\mu}\right)`,
    itex: r`\nabla_{\mu} V^{\mu} = \partial_{\mu} V^{\mu} + \Gamma^{\mu}_{\mu\lambda} V^{\lambda}`,
    shape: { rank: 0, variance: '-', symmetries: '-', independent: 1 },
    story: [
      r`The divergence of a vector field is a contraction: the derivative index of $\nabla_{\mu}V^{\nu}$ joined to the field's own index. It is a scalar, so it means the same thing in every coordinate system: the rate at which the field's flow spreads out per unit volume.`,
      r`In curved coordinates the contraction of Christoffel symbols has a neat closed form, $\Gamma^{\mu}_{\mu\lambda} = \partial_{\lambda}\ln\sqrt{|g|}$, which gives $\nabla_{\mu}V^{\mu} = \frac{1}{\sqrt{|g|}}\partial_{\mu}(\sqrt{|g|}V^{\mu})$. In polar coordinates $\sqrt{|g|} = r$ and the divergence of $r^{k}\mathbf e_{r}$ is $(k+1)r^{k-1}$.`,
      r`The theorem says the total spreading inside a region equals the net flow out through its boundary. The volume element $\sqrt{|g|}\,d^{n}x$ makes the left side coordinate-free; the boundary has its own induced metric $h$ and unit normal covector $n_{\mu}$. The normal is naturally a covector, a lower index, because it is the gradient of the function that defines the boundary.`,
      r`The trace integrates both sides over a disk numerically. Gauss's law, conservation of charge and the conservation of energy-momentum in relativity all use exactly this step to go from a local law, a divergence, to a global one, a flux.`,
    ],
    vocab: [
      { term: 'divergence', meaning: 'nabla_mu V^mu, the contraction of the covariant derivative.' },
      { term: 'volume element', meaning: 'sqrt|g| d^n x, the coordinate-free measure of volume.' },
      { term: 'flux', meaning: 'The integral of V^mu n_mu over a boundary.' },
    ],
    params: [
      { key: 'R', label: 'Disk radius', min: 0.3, max: 3, step: 0.05, def: 1.5 },
      { key: 'k', label: 'Power k in V = r^k e_r', min: 0, max: 3, step: 0.1, def: 1 },
      { key: 'swirl', label: 'Swirl part c sin(theta) e_theta', min: 0, max: 2, step: 0.05, def: 0.5 },
    ],
    trace(params) {
      const p = P(this.params, params);
      const field = q => M.T([q[0] ** p.k, p.swirl * Math.sin(q[1])], ['u']);
      const div = q => { const n = M.covariantDerivative('polar', field, q); return n.get(0, 0) + n.get(1, 1); };
      const Nr = 120, Nt = 48;
      let vol = 0;
      for (let i = 0; i < Nr; i++) for (let j = 0; j < Nt; j++) {
        const rr = (i + 0.5) * p.R / Nr, tt = (j + 0.5) * 2 * Math.PI / Nt;
        vol += div([rr, tt]) * rr * (p.R / Nr) * (2 * Math.PI / Nt);
      }
      let flux = 0;
      for (let j = 0; j < Nt; j++) { const tt = (j + 0.5) * 2 * Math.PI / Nt; flux += field([p.R, tt]).get(0) * p.R * (2 * Math.PI / Nt); }
      const want = 2 * Math.PI * p.R ** (p.k + 1), x = [p.R / 2, 0.7];
      return trace([
        step('covariant', 'Take the covariant derivative of the field.', r`V^{\nu}`, r`\nabla_{\mu} V^{\nu}`, { focus: ['mu'], viz: { scene: 'curvilinear-grid', params: { coords: 'polar', point: x } } }),
        step('contract', 'Join the derivative index to the field index: the divergence.', r`\nabla_{\mu} V^{\nu}`, r`\nabla_{\mu} V^{\mu} = ${num(div(x), 4)}`, { focus: ['mu'], sums: [{ sym: 'mu', range: [0, 2] }] }),
        step('evaluate', 'Integrate over the disk with the volume element r dr dtheta.', r`\nabla_{\mu} V^{\mu}`, r`\int \nabla_{\mu} V^{\mu} \sqrt{g}\, d^{2}x = ${num(vol, 4)}`, { focus: [] }),
        step('evaluate', 'Integrate the outward flow round the rim: the same number.', r`V^{\mu} n_{\mu}`, r`\oint V^{\mu} n_{\mu} \sqrt{h}\, d\theta = ${num(flux, 4)}`, { focus: ['mu'] }),
      ], {
        dim: 2, metric: 'polar',
        checks: [
          check('volume integral = 2 pi R^(k+1)', vol, want, 1e-3),
          check('flux = 2 pi R^(k+1)', flux, want, 1e-9),
          check('divergence at a point = (k+1) r^(k-1) + c cos(theta)', div(x), (p.k + 1) * x[0] ** (p.k - 1) + p.swirl * Math.cos(x[1]), 1e-7),
        ],
        values: { volume: vol, flux },
      });
    },
    viz: { scene: 'curvilinear-grid', params: { coords: 'polar' } },
    diagram: { style: 'penrose', order: ['\\nabla', 'V'], note: 'The derivative leg bends round and joins the up leg of V.' },
    refs: [wp('Divergence_theorem'), CARROLL, SCHUTZ],
  },
];
