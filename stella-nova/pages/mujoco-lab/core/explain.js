// ============================================================================
//  MUJOCO LAB  ·  core/explain.js — data for the explainer
// ----------------------------------------------------------------------------
//  Text and TeX for "what MuJoCo solves". The page typesets `tex` with
//  MathJax (lib/sci-math.js), never KaTeX. Every equation names its source
//  in `cite` (ids of CITATIONS). The equations follow the MuJoCo 3.15.0
//  documentation (doc/computation/index.rst and doc/modeling.rst, tag
//  3.15.0); the symbol names are the documentation's.
//
//  GREP MAP
//    export const CITATIONS ...... references with DOI or URL
//    export const STEPS .......... the explainer, in reading order
//    export const INTEGRATORS .... one entry per option integrator
//    export const SOLVERS ........ PGS, CG, Newton
//    export const CONES .......... pyramidal and elliptic friction cones
//    export const SYMBOLS ........ symbol glossary
//    export function citation .... id -> one formatted line
// ============================================================================

export const CITATIONS = [
  { id: 'todorov2012', authors: 'E. Todorov, T. Erez, Y. Tassa', year: 2012, title: 'MuJoCo: A physics engine for model-based control',
    venue: '2012 IEEE/RSJ International Conference on Intelligent Robots and Systems (IROS), pp. 5026-5033', doi: '10.1109/IROS.2012.6386109', url: 'https://doi.org/10.1109/IROS.2012.6386109' },
  { id: 'todorov2014', authors: 'E. Todorov', year: 2014, title: 'Convex and analytically-invertible dynamics with contacts and constraints: Theory and implementation in MuJoCo',
    venue: '2014 IEEE International Conference on Robotics and Automation (ICRA), pp. 6054-6061', doi: '10.1109/ICRA.2014.6907751', url: 'https://doi.org/10.1109/ICRA.2014.6907751' },
  { id: 'docs-computation', authors: 'MuJoCo documentation (Google DeepMind)', year: 2026, title: 'Computation',
    venue: 'MuJoCo 3.15.0 documentation, doc/computation/index.rst', url: 'https://mujoco.readthedocs.io/en/stable/computation/index.html' },
  { id: 'docs-solver', authors: 'MuJoCo documentation (Google DeepMind)', year: 2026, title: 'Modeling: Solver parameters',
    venue: 'MuJoCo 3.15.0 documentation, doc/modeling.rst', url: 'https://mujoco.readthedocs.io/en/stable/modeling.html#solver-parameters' },
  { id: 'featherstone2008', authors: 'R. Featherstone', year: 2008, title: 'Rigid Body Dynamics Algorithms',
    venue: 'Springer, Boston, MA', doi: '10.1007/978-1-4899-7560-7', url: 'https://doi.org/10.1007/978-1-4899-7560-7' },
  { id: 'mujoco-repo', authors: 'Google DeepMind', year: 2026, title: 'MuJoCo source code (Apache-2.0)', venue: 'GitHub, tag 3.15.0', url: 'https://github.com/google-deepmind/mujoco' },
];

export function citation(id) {
  const c = CITATIONS.find(x => x.id === id);
  if (!c) return '';
  return `${c.authors} (${c.year}). ${c.title}. ${c.venue}.` + (c.doi ? ` doi:${c.doi}` : ` ${c.url}`);
}

// One step of mj_step, as the explainer tells it. `tex` is display math.
export const STEPS = [
  { id: 'motion', title: 'The equation of motion',
    text: 'MuJoCo works in generalized coordinates: q is the position of every joint, v its velocity. M is the joint-space inertia, c holds Coriolis, centrifugal and gravity forces, tau the applied forces (actuators, springs, the mouse) and J^T f the constraint forces: contacts, joint limits, equalities, friction loss.',
    tex: ['M(q)\\,\\dot v + c(q, v) = \\tau + J^T f'], cite: ['docs-computation', 'todorov2012'] },
  { id: 'smooth', title: 'Smooth dynamics first',
    text: 'Before the constraints, MuJoCo computes M with the composite rigid body algorithm and c with recursive Newton-Euler. The unconstrained acceleration a_0 is what the system would do with no contact at all.',
    tex: ['a_0 = M^{-1}(\\tau - c)', '\\dot v = M^{-1}(\\tau + J^T f - c)'], cite: ['docs-computation', 'featherstone2008'] },
  { id: 'gauss', title: 'Constraints as least change (Gauss)',
    text: 'With hard equality constraints, the true acceleration is the one closest to a_0 in the metric of M that the constraints allow. MuJoCo keeps this form but makes every constraint soft.',
    tex: ['\\dot v = \\arg\\min_x \; \\lVert x - M^{-1}\\tau \\rVert^2_M \\quad \\text{subject to}\\quad Jx = a_{\\mathrm{ref}}'], cite: ['docs-computation'] },
  { id: 'primal', title: 'The convex problem MuJoCo solves',
    text: 'The constraint becomes a convex penalty s on the constraint-space acceleration. s is convex and once differentiable (a quadratic spline for pyramidal cones). The constraint force is minus its gradient, so forward and inverse dynamics are both well defined.',
    tex: ['\\dot v = \\arg\\min_x \; \\lVert x - M^{-1}(\\tau - c) \\rVert^2_M + s\\!\\left(Jx - a_{\\mathrm{ref}}\\right)', 'f = -\\nabla s\\!\\left(J\\dot v - a_{\\mathrm{ref}}\\right)'], cite: ['docs-computation', 'todorov2014'] },
  { id: 'dual', title: 'The dual: forces in constraint space',
    text: 'The same solution as a problem in the constraint forces. A is the inverse inertia seen by the constraints, a_u the unconstrained acceleration in constraint space. R > 0 makes the cost strictly convex, so the force is unique. Omega is free for equalities, a box for friction loss and the friction cone for contacts.',
    tex: ['f = \\arg\\min_{\\lambda \\in \\Omega} \; \\tfrac12 \\lambda^T (A + R)\\lambda + \\lambda^T (a_u - a_{\\mathrm{ref}})', 'A = J M^{-1} J^T, \\qquad a_u = J M^{-1}(\\tau - c) + \\dot J v'], cite: ['docs-computation', 'todorov2014'] },
  { id: 'impedance', title: 'Impedance: how hard a constraint is',
    text: 'The impedance d in (0, 1) interpolates between no constraint (a_u) and the reference acceleration. It sets the regularizer R from an approximation of the diagonal of A. solimp = (d_0, d_w, width, midpoint, power) makes d a smooth function of the violation r.',
    tex: ['R_{ii} = \\frac{1 - d_i}{d_i}\\, \\hat A_{ii}', 'a_1 = d\\, a_{\\mathrm{ref}} + (1 - d)\\, a_u'], cite: ['docs-computation', 'docs-solver'] },
  { id: 'reference', title: 'Reference acceleration: a spring and a damper',
    text: 'Each constraint tries to remove its violation r like a damped spring. solref = (timeconst, dampratio) sets b and k. A negative solref = (-stiffness, -damping) sets them directly: this is how the Newton\'s cradle and the bouncing balls get their restitution.',
    tex: ['a_{\\mathrm{ref}} = -b\\,(Jv) - k\\,r', 'b = \\frac{2}{d_w\\,\\mathrm{timeconst}}, \\qquad k = \\frac{d(r)}{d_w^2\\,\\mathrm{timeconst}^2\\,\\mathrm{dampratio}^2}'], cite: ['docs-solver'] },
  { id: 'complementarity', title: 'Complementarity, relaxed',
    text: 'A rigid contact obeys complementarity: either the gap is open and the force is zero, or the gap is closed and the force pushes. That is a hard, non-convex problem. MuJoCo relaxes it: contacts are soft, a small force can act across a small gap or overlap, and the problem stays convex with a unique answer. The cost is a small, tunable penetration; the gain is speed, stability and smooth derivatives.',
    tex: ['0 \\le f_N \;\\perp\; \\phi(q) \\ge 0 \\quad\\longrightarrow\\quad \\text{soft: } f_N > 0 \\text{ near } \\phi = 0'], cite: ['todorov2014', 'docs-computation'] },
  { id: 'cones', title: 'Friction cones',
    text: 'Contact force lies in a friction cone. The elliptic cone is exact Coulomb friction (with torsional and rolling terms when condim is 4 or 6). The pyramidal cone approximates it with edges and is the default.',
    tex: ['\\mathcal K = \\left\\{ f : f_1 \\ge 0,\; f_1^2 \\ge \\sum_{i=2}^{n} f_i^2/\\mu_{i-1}^2 \\right\\}'], cite: ['docs-computation'] },
  { id: 'integrate', title: 'Integrate and repeat',
    text: 'The acceleration from the solver goes to the integrator, which gives q and v at t + h. Then the next step starts with collision detection again.',
    tex: ['v_{t+h} = v_t + h\\,a_t, \\qquad q_{t+h} = q_t + h\\,v_{t+h}'], cite: ['docs-computation'] },
];

export const INTEGRATORS = [
  { key: 'Euler', name: 'Semi-implicit Euler', text: 'Velocity first, then position with the new velocity. Joint damping and armature are made implicit. Fast, first order, the default.',
    tex: ['v_{t+h} = v_t + h\\,a_t', 'q_{t+h} = q_t + h\\,v_{t+h}'], cite: ['docs-computation'] },
  { key: 'RK4', name: 'Runge-Kutta 4', text: 'Fourth order, four evaluations of the dynamics for each step. Best for smooth systems with no contact, where it keeps energy far better than Euler (try the double pendulum).',
    tex: ['x_{t+h} = x_t + \\tfrac{h}{6}(k_1 + 2k_2 + 2k_3 + k_4)'], cite: ['docs-computation'] },
  { key: 'implicit', name: 'Implicit in velocity', text: 'One Newton step on the implicit velocity update, with D the derivative of all forces with respect to velocity (Coriolis terms included, so D is not symmetric). Stable with strong damping and fast actuators.',
    tex: ['v_{t+h} = v_t + h\\,\\widehat M^{-1} M\\, a(v_t), \\qquad \\widehat M = M + hD', 'D \\equiv -\\frac{\\partial}{\\partial v}\\left(\\tau(v) - c(v) + J^T f(v)\\right)'], cite: ['docs-computation'] },
  { key: 'implicitfast', name: 'Implicit, fast', text: 'The same update without the Coriolis and centripetal derivatives. D stays symmetric, so a Cholesky factorization is enough. Recommended for most models with actuators.',
    tex: ['\\widehat M = M + hD_{\\mathrm{sym}}'], cite: ['docs-computation'] },
];

export const SOLVERS = [
  { key: 'PGS', name: 'Projected Gauss-Seidel', text: 'Works on the dual problem, one constraint at a time, and projects onto the cone. Simple and robust, slow to converge on large stacks.', cite: ['docs-computation'] },
  { key: 'CG', name: 'Conjugate gradient', text: 'Nonlinear conjugate gradient on the primal problem. Needs only products with M, so it suits large models.', cite: ['docs-computation'] },
  { key: 'Newton', name: 'Newton', text: 'Exact Newton steps on the primal problem with a line search. Converges in a few iterations; the default.', cite: ['docs-computation'] },
];

export const CONES = [
  { key: 'pyramidal', name: 'Pyramidal', text: 'Friction as a pyramid of edges. Cheaper; the default.' },
  { key: 'elliptic', name: 'Elliptic', text: 'Exact Coulomb cone; needed for stacks that stand on friction alone (the house of cards).' },
];

export const SYMBOLS = [
  ['q, v', 'joint positions and velocities (generalized coordinates)'],
  ['M', 'joint-space inertia matrix'],
  ['c', 'bias force: Coriolis, centrifugal, gravity'],
  ['\\tau', 'applied force: actuators, passive springs and dampers, perturbations'],
  ['J', 'constraint Jacobian (contacts, limits, equalities)'],
  ['f', 'constraint force'],
  ['a_{\\mathrm{ref}}', 'reference acceleration of the soft constraint'],
  ['d', 'impedance, from solimp'],
  ['b, k', 'damping and stiffness, from solref'],
  ['R', 'regularizer: how soft each constraint is'],
  ['h', 'time step (option timestep)'],
];
