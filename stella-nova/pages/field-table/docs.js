// ============================================================================
//  FIELD TABLE  ·  docs.js — the equation docs in the inspector
// ────────────────────────────────────────────────────────────────────────────
//  DOCS[name] gives one cell its documentation: the velocity field as TeX,
//  the knob map, and one or two sentences on the physics. renderDoc(t, box)
//  typesets it into the inspector as color-coded MathJax SVG through
//  lib/sci-math.js. The table engine calls PAGE.inspect(t) when the inspector
//  opens, and page.js calls renderDoc from there.
//
//  The TeX is a copy of the WGSL in shaders/pack.wgsl (fn v_<name>). When a
//  WGSL field changes, change its entry here too. Where the code and the
//  species text in spec.json do not agree, the TeX follows the code and the
//  note says so.
//
//  COLORS  (the .m1 to .m6 classes of lib/sci.css, put on with \class)
//      m1 .... position: p, x, y, r, the unit vectors, the scaled coordinates
//      m6 .... velocity v and the time derivatives
//      m2 .... the parameter of knob k0
//      m3 .... the parameter of knob k1
//      m4 .... the parameter of knob k2
//      m5 .... time t (the hover clock)
//
//  ENTRY   { tex: [TeX line, ...], knobs: [knob, ...], note: 'text' }
//      knob .... [symbolTeX, lo, hi]  the WGSL mix(lo, hi, k_i), a linear map
//                [symbolTeX, 'TeX', labelRange?]  a switch or another map: the
//                TeX follows the symbol as given (with its own '=' or ':')
//                null                 the knob is not used
//
//  The plain Unicode spec.json cell.eq stays for the screensaver plate.
//
//  grep -n targets: "const DOCS", "INTEGRATOR", "NOISE", "export function renderDoc",
//  "export function knobLabel"
// ============================================================================
import { typeset } from '../../lib/sci-math.js';

const c = (cls, s) => `\\class{${cls}}{${s}}`;
const KC = ['m2', 'm3', 'm4', 'm5'];
const k = (i, s) => c(KC[i], s);
// position
const P = c('m1', '\\mathbf{p}'), X = c('m1', 'x'), Y = c('m1', 'y'), R = c('m1', 'r');
const RH = c('m1', '\\hat{\\mathbf{r}}'), TH = c('m1', '\\hat{\\theta}'), D = c('m1', '\\mathbf{d}');
const PERP = c('m1', '\\mathbf{p}^{\\perp}');                  // (-y, x)
const XS = c('m1', 'X'), YS = c('m1', 'Y');
// velocity and time
const V = c('m6', '\\mathbf{v}'), XD = c('m6', '\\dot{X}'), YD = c('m6', '\\dot{Y}'), T = c('m5', 't');
const GP = c('m1', '\\nabla_{q}^{\\perp}\\psi');                // curl of the stream function
const Q = c('m1', '\\mathbf{q}');

// INTEGRATOR: cs_move in pack.wgsl, the same for every cell
const INTEGRATOR = [
  `${P} \\leftarrow ${P} + \\Delta t\\, ${V}\\!\\left(${P} + \\tfrac{1}{2}\\Delta t\\, ${V}(${P}, ${T}),\\; ${T}\\right),\\qquad \\Delta t = 0.016\\cdot\\text{speed}`,
];
const INTEGRATOR_NOTE = 'RK2 midpoint, one step for each frame. speed is the Speed generator (0.2 to 3.0). t is the hover clock: it moves only while the cell animates, at the Tempo rate. A particle that leaves the domain (|x|, |y| > 1 on a tile) or stops goes back to a random point. A small fraction does so each frame anyway, set by Fade.';

// NOISE: grad_fbm and fbm in pack.wgsl, for the noise family
const NOISE = [
  `\\psi(${Q}) = \\textstyle\\sum_{i=0}^{3} 2^{-(i+1)}\\, n\\!\\left(2^{i} R_{0.5}^{\\,i}\\, ${Q}\\right),\\qquad ${GP} = \\left(\\frac{\\partial\\psi}{\\partial q_y},\\, -\\frac{\\partial\\psi}{\\partial q_x}\\right)`,
];
const NOISE_NOTE = 'n is 2-D gradient (Perlin) noise. Each octave doubles the frequency, halves the amplitude and turns 0.5 rad. The code takes the derivatives as forward differences with h = 0.01 in q.';

const DOCS = {
  // ---------------------------------------------------------- potential flow
  uniform: {
    tex: [`${V} = (\\cos\\phi,\\ \\sin\\phi),\\qquad \\phi = ${k(0, '\\alpha')} + 0.2\\sin(0.3\\,${T})`],
    knobs: [[k(0, '\\alpha'), ' = 2\\pi\\, k_0 \\in [0,\\ 2\\pi]', '[0,\\ 2\\pi]']],
    note: 'A uniform stream, the simplest potential flow: the velocity potential is φ = U·x. The direction rocks by ±0.2 rad over time. Add it to a source, a doublet or a vortex to build flow past a body.',
  },
  source: {
    tex: [`${V} = \\pm\\, ${k(0, 'm')}\\, \\frac{${P}}{${R}^2},\\qquad ${R}^2 = \\max(|${P}|^2,\\ 0.01)`],
    knobs: [[k(0, 'm'), 0.3, 1.5], [k(1, '\\pm'), `:\\ \\text{sink } (-) \\text{ when } k_1 > 0.5`]],
    note: 'A point source: the speed falls as 1/r, so the flux m through every circle is the same. With the sink switch on, the flow goes inward.',
  },
  vortex: {
    tex: [`${V} = ${k(0, '\\Gamma')}\\, \\frac{${PERP}}{${R}^2},\\qquad ${PERP} = (-${Y},\\ ${X}),\\quad ${R}^2 = \\max(|${P}|^2,\\ 0.01)`],
    knobs: [[k(0, '\\Gamma'), 0.3, 1.5]],
    note: 'A free (irrotational) vortex: the speed is Γ/r, and the curl is zero everywhere except at the center. The floor on r² keeps the core finite.',
  },
  rankine: {
    tex: [`${V} = ${k(1, 's')}\\, ${TH} \\begin{cases} ${R}/${k(0, 'a')} & ${R} < ${k(0, 'a')} \\\\ ${k(0, 'a')}/${R} & ${R} \\ge ${k(0, 'a')} \\end{cases},\\qquad ${TH} = \\frac{(-${Y},\\ ${X})}{${R}}`],
    knobs: [[k(0, 'a'), 0.15, 0.6], [k(1, 's'), 0.5, 2]],
    note: 'The Rankine vortex: the core r < a turns as a solid body, and outside the core it is a free vortex. The speed is largest, s, at the edge of the core.',
  },
  doublet: {
    tex: [`${V} = 0.05\\, ${k(0, '\\mu')}\\, \\frac{(${Y}^2 - ${X}^2,\\ -2${X}${Y})}{${R}^4},\\qquad ${R}^2 = \\max(|${P}|^2,\\ 0.005)`],
    knobs: [[k(0, '\\mu'), 0.3, 2]],
    note: 'A source and a sink brought together with their product held: the streamlines are circles that touch at the origin. The speed falls as 1/r².',
  },
  cylinder: {
    tex: [`${V} = (U, 0) + U ${k(0, 'R')}^2 \\frac{(${Y}^2 - ${X}^2,\\ -2${X}${Y})}{${R}^4} + 0.3\\, ${k(1, '\\Gamma')}\\, \\frac{(-${Y},\\ ${X})}{${R}^2}`,
          `U = 1,\\qquad ${R}^2 = \\max(|${P}|^2,\\ 0.999\\, ${k(0, 'R')}^2),\\qquad ${V} = 0 \\ \\text{for}\\ |${P}| < ${k(0, 'R')}`],
    knobs: [[k(0, 'R'), 0.2, 0.5], [k(1, '\\Gamma'), -2, 2]],
    note: 'A uniform stream plus a doublet gives flow round a cylinder of radius R. The added vortex moves the stagnation points, and by Kutta–Joukowski the cylinder then feels a lift L = ρUΓ.',
  },
  spiral_sink: {
    tex: [`${V} = \\frac{${k(0, '\\omega')}\\,(-${Y},\\ ${X}) - ${k(1, '\\sigma')}\\, ${P}}{${R}},\\qquad ${R} = \\sqrt{\\max(|${P}|^2,\\ 0.01)}`],
    knobs: [[k(0, '\\omega'), 0, 1.5], [k(1, '\\sigma'), 0.1, 1]],
    note: 'A vortex plus a sink: the streamlines are logarithmic spirals into the drain. In this code the division is by r, not r², so the speed √(ω² + σ²) is the same at every radius.',
  },
  taylor_green: {
    tex: [`${V} = \\left(\\sin f q_x \\cos f q_y,\\ -\\cos f q_x \\sin f q_y\\right) e^{-0\\cdot ${T}},\\qquad \\mathbf{q} = \\tfrac{1}{2}(${P} + 1),\\quad f = ${k(0, 'n')}\\,\\pi`],
    knobs: [[k(0, 'n'), 2, 8]],
    note: 'The Taylor–Green vortex: a lattice of counter-rotating cells, an exact solution of the Navier–Stokes equations. With viscosity the true solution decays exponentially in time. The code multiplies by e^(−0·t), so the lattice holds.',
  },
  shear: {
    tex: [`${V} = \\left(${k(0, 'U')}\\tanh\\frac{${Y}}{${k(1, 'w')}} + 0.1\\sin(10${X} + ${T}),\\ \\ 0.05\\, ${k(2, 'b')}\\sin(6${X} - 0.7${T})\\right)`],
    knobs: [[k(0, 'U'), 0.5, 1.5], [k(1, 'w'), 0.05, 0.3], [k(2, 'b'), 0, 1]],
    note: 'A tanh shear layer: the two streams move in opposite directions across a layer of width w. The small travelling waves are the start of the Kelvin–Helmholtz roll-up. The field itself does not evolve.',
  },
  dipole_pair: {
    tex: [`${V} = ${k(0, 's')} \\left(\\frac{${D}_a^{\\perp}}{\\max(|${D}_a|^2, 0.01)} - \\frac{${D}_b^{\\perp}}{\\max(|${D}_b|^2, 0.01)}\\right),\\qquad ${D}_{a,b} = ${P} \\pm (0.4, 0)`],
    knobs: [[k(0, 's'), 0.3, 1.5]],
    note: 'Two vortices of opposite sign at x = ±0.4. Between them they push a jet. Free vortices of this kind move together in a straight line. Here the centers are fixed. (d⊥ = (−d_y, d_x).)',
  },
  stagnation: {
    tex: [`${V} = R(\\pi ${k(1, '\\beta')})\\; ${k(0, 'a')}\\,(${X},\\ -${Y})`],
    knobs: [[k(0, 'a'), 0.4, 1.5], [k(1, '\\beta'), 0, 1]],
    note: 'Planar stagnation-point (Hiemenz) flow, stream function ψ = a·x·y: flow comes in along one axis and goes out along the other. The code turns the whole field by the angle πβ.',
  },
  source_vortex: {
    tex: [`${V} = \\frac{${k(0, '\\sigma')}\\, ${P} + ${k(1, '\\omega')}\\,(-${Y},\\ ${X})}{${R}},\\qquad ${R} = \\max(|${P}|,\\ 0.05)`],
    knobs: [[k(0, '\\sigma'), 0.2, 1], [k(1, '\\omega'), 0.3, 1.5]],
    note: 'A source plus a vortex: outward logarithmic spirals at the angle atan(ω/σ). The division is by r, not r², so the speed is the same at every radius.',
  },
  vortex_street: {
    tex: [`${V} = ${k(0, 's')} \\sum_{i=-2}^{2} \\varepsilon_i \\frac{${D}_i^{\\perp}}{\\max(|${D}_i|^2, 0.02)} + (${k(2, 'U')},\\ 0),\\qquad ${D}_i = ${P} - (0.5 i - ${k(1, 'u')}\\, ${T},\\ 0.16\\,\\varepsilon_i)`,
          `\\varepsilon_i = +1 \\text{ for even } i,\\ -1 \\text{ for odd } i`],
    knobs: [[k(0, 's'), 0.05, 0.2], [k(1, 'u'), 0, 0.3], [k(2, 'U'), 0, 0.6]],
    note: 'A Kármán street: two staggered rows of vortices with opposite spin. The row gap is h = 0.32 and the spacing in a row is l = 1, so h/l = 0.32, near von Kármán\'s stable 0.281. The five centers drift at u and do not wrap.',
  },
  rankine_halfbody: {
    tex: [`${V} = (${k(1, 'U')},\\ 0) + ${k(0, 'm')}\\, \\frac{${P}}{${R}^2},\\qquad ${R}^2 = \\max(|${P}|^2,\\ 0.01)`],
    knobs: [[k(0, 'm'), 0.2, 0.8], [k(1, 'U'), 0.3, 1]],
    note: 'A uniform stream past a source. The stagnation point is at x = −m/U, and the streamline through it closes round a blunt nose: the Rankine half-body.',
  },
  channel: {
    tex: [`${V} = \\left(${k(0, 'G')}\\,(1 - ${Y}^2),\\ 0\\right)`],
    knobs: [[k(0, 'G'), 0.5, 1.6]],
    note: 'Plane Poiseuille flow: a viscous flow between walls at y = ±1, driven by a pressure gradient. The profile is a parabola with the peak speed G on the center line.',
  },
  couette: {
    tex: [`${V} = \\left(${k(0, '\\dot\\gamma')}\\, ${Y} + ${k(1, 'c')},\\ 0\\right)`],
    knobs: [[k(0, '\\dot\\gamma'), 0.5, 1.6], [k(1, 'c'), 0, 0.5]],
    note: 'Plane Couette flow: viscous fluid between two plates that slide past each other. The profile is linear with the shear rate γ̇. The offset c moves the frame.',
  },
  stokeslet: {
    tex: [`${V} = ${k(0, 'S')}\\left(-\\mathbf{f}\\,\\ln ${R} + ${RH}\\,(\\mathbf{f}\\cdot ${RH})\\right),\\qquad \\mathbf{f} = (\\cos 2\\pi ${k(1, '\\beta')},\\ \\sin 2\\pi ${k(1, '\\beta')}),\\quad ${R} = \\max(|${P}|, 0.06)`],
    knobs: [[k(0, 'S'), 0.1, 0.4], [k(1, '\\beta'), 0, 1]],
    note: 'The 2-D Stokeslet: the creeping (zero Reynolds number) flow from a point force f. In 2-D it grows as −ln r, so a finite window shows a strong far field (the Stokes paradox).',
  },
  jet: {
    tex: [`${V} = e\\left(${k(0, 'U')},\\ 0.4\\cos(${k(1, '\\kappa')}\\pi ${X} + 0.6\\,${T})\\right),\\qquad e = \\exp(-${k(2, 'w')}\\, ${Y}^2)`],
    knobs: [[k(0, 'U'), 0.4, 1.4], [k(1, '\\kappa'), 2, 6], [k(2, 'w'), 3, 12]],
    note: 'A Gaussian jet with a travelling cross-stream wave, so the core meanders. Larger w gives a narrower jet.',
  },
  double_vortex: {
    tex: [`${V} = ${k(0, 's')} \\left(\\frac{${D}_a^{\\perp}}{\\max(|${D}_a|^2, 0.02)} + \\frac{${D}_b^{\\perp}}{\\max(|${D}_b|^2, 0.02)}\\right),\\qquad ${D}_{a,b} = ${P} \\pm (0.35, 0)`],
    knobs: [[k(0, 's'), 0.3, 1.2]],
    note: 'Two vortices with the same spin. Free, they would turn round their midpoint. In this code the centers are fixed at x = ±0.35 and do not orbit (the species text says they do).',
  },
  source_sink: {
    tex: [`${V} = ${k(0, 'm')}\\left(\\frac{${D}_a}{\\max(|${D}_a|^2, 0.02)} - \\frac{${D}_b}{\\max(|${D}_b|^2, 0.02)}\\right),\\qquad ${D}_{a,b} = ${P} \\pm (0.4, 0)`],
    knobs: [[k(0, 'm'), 0.1, 0.5]],
    note: 'A source at x = −0.4 and a sink of the same strength at x = +0.4. The streamlines are arcs of circles through both points. As the pair closes up, it becomes a doublet.',
  },
  // ---------------------------------------------------------- physics
  gravity: {
    tex: [`${V} = 0.05 \\sum_{i=0}^{2} \\frac{\\mathbf{c}_i - ${P}}{\\left(|\\mathbf{c}_i - ${P}|^2 + ${k(1, '\\varepsilon')}^2\\right)^{3/2}},\\qquad \\mathbf{c}_i = ${k(0, '\\rho')}\\,(\\cos a_i,\\ \\sin a_i),\\quad a_i = 2.094\\, i + 0.15\\,${T}`],
    knobs: [[k(0, '\\rho'), 0, 0.6], [k(1, '\\varepsilon'), 0.02, 0.2]],
    note: 'The Newtonian field of three equal masses, 120° apart on a ring of radius ρ that turns slowly. The particles follow the field as a velocity, not as an acceleration, so they flow into the masses and do not orbit. Plummer softening ε removes the singularity.',
  },
  coulomb: {
    tex: [`${V} = 0.08\\, ${k(0, '\\kappa')} \\sum_{j} q_j \\frac{${P} - \\mathbf{c}_j}{\\left(|${P} - \\mathbf{c}_j|^2 + 0.03\\right)^{3/2}},\\qquad \\mathbf{c} = (\\mp 0.45,\\ 0),\\quad q_a = 1,\\ q_b = ${k(1, '\\pm 1')}`],
    knobs: [[k(0, '\\kappa'), 0.5, 2], [k(1, 'q_b'), ` = +1 \\text{ when } k_1 > 0.5,\\ \\text{else } -1`]],
    note: 'The electric field of two point charges (inverse square in the plane, softened). Unlike charges give the dipole pattern from + to −. Like charges give a neutral point between them. The knob is named unlike, but in the code k1 > 0.5 gives like charges.',
  },
  magnetic_dipole: {
    tex: [`${V} = 0.05\\, \\frac{3(\\mathbf{m}\\cdot ${RH})\\, ${RH} - \\mathbf{m}}{\\max(${R}^3,\\ 0.01)},\\qquad \\mathbf{m} = (-\\sin\\phi,\\ \\cos\\phi),\\quad \\phi = ${k(0, '\\alpha')} + 0.1\\,${T}`],
    knobs: [[k(0, '\\alpha'), ' = 2\\pi\\, k_0 \\in [0,\\ 2\\pi]', '[0,\\ 2\\pi]']],
    note: 'The far field of a magnetic dipole m (the same form as an electric dipole). The field lines leave one pole and loop round to the other. The moment turns slowly with t.',
  },
  orbit: {
    tex: [`${V} = 0.1\\left(-\\frac{${D}}{${R}^3} + ${k(0, '\\omega')}\\frac{${D}^{\\perp}}{${R}}\\right),\\qquad ${D} = ${P} - ${k(1, '\\rho')}(\\cos 0.3${T},\\ \\sin 0.3${T}),\\quad ${R} = \\max(|${D}|, 0.06)`],
    knobs: [[k(0, '\\omega'), 0, 1.5], [k(1, '\\rho'), 0, 0.4]],
    note: 'An inverse-square pull toward a mass that circles the origin at radius ρ, plus a swirl term of constant speed ω round it. With no swirl the particles fall straight in.',
  },
  charged_ring: {
    tex: [`${V} = ${k(1, 'q')}\\,(${R} - ${k(0, 'R')})\\, ${RH}`],
    knobs: [[k(0, 'R'), 0.3, 0.6], [k(1, 'q'), 1, 3]],
    note: 'The code is a radial field linear in r − R: outward past the ring, inward within it, so particles move away from the circle on both sides. This is not the Coulomb field of a charged ring, which is zero inside by Gauss\'s law.',
  },
  two_body: {
    tex: [`${V} = 0.05\\, ${k(0, 'G')} \\sum_{\\pm} \\frac{\\pm\\mathbf{c} - ${P}}{\\left(|\\pm\\mathbf{c} - ${P}|^2 + ${k(1, '\\varepsilon')}^2\\right)^{3/2}},\\qquad \\mathbf{c} = 0.35\\,(\\cos 0.4${T},\\ \\sin 0.4${T})`],
    knobs: [[k(0, 'G'), 0.5, 1.5], [k(1, '\\varepsilon'), 0.02, 0.15]],
    note: 'The softened gravity of two equal masses on opposite sides of a circle of radius 0.35, turning together like a binary star. Near the pair the field has two wells. Far away it looks like one mass.',
  },
  // ---------------------------------------------------------- phase portraits
  pendulum: {
    tex: [`\\dot\\theta = \\omega,\\qquad \\dot\\omega = -${k(0, 'g')}\\sin\\theta - ${k(1, '\\gamma')}\\,\\omega`,
          `\\theta = 2\\pi ${X},\\quad \\omega = 4${Y},\\qquad ${V} = \\tfrac{1}{2}\\left(\\frac{\\dot\\theta}{2\\pi},\\ \\frac{\\dot\\omega}{4}\\right)`],
    knobs: [[k(0, 'g'), 2, 8], [k(1, '\\gamma'), 0, 1.5]],
    note: 'The phase plane of a damped pendulum. With no damping the closed orbits are swings, the wavy outer orbits are full turns, and the separatrix through the upright point divides them. Damping makes every orbit spiral to rest.',
  },
  vanderpol: {
    tex: [`${XD} = ${YS},\\qquad ${YD} = ${k(0, '\\mu')}(1 - ${XS}^2)\\,${YS} - ${XS}`,
          `(${XS}, ${YS}) = 3${P},\\qquad ${V} = \\frac{0.4}{3}\\,(${XD},\\ ${YD})`],
    knobs: [[k(0, '\\mu'), 0.2, 2.5]],
    note: 'The van der Pol oscillator: negative damping at small amplitude, positive damping at large amplitude. Every orbit except the fixed point goes to one limit cycle. Large μ gives relaxation oscillations.',
  },
  duffing: {
    tex: [`${XD} = ${YS},\\qquad ${YD} = ${XS} - ${XS}^3 - ${k(1, '\\delta')}\\,${YS} + ${k(0, 'F')}\\cos(1.2\\,${T})`,
          `(${XS}, ${YS}) = 2${P},\\qquad ${V} = 0.4\\,(${XD},\\ ${YD})`],
    knobs: [[k(0, 'F'), 0, 0.8], [k(1, '\\delta'), 0, 0.6]],
    note: 'The double-well Duffing oscillator: two stable wells at X = ±1 and a saddle at 0. The periodic forcing moves the field in time, so orbits can jump from well to well. That is the way to chaos in the Duffing system.',
  },
  lotka: {
    tex: [`${XD} = ${k(0, 'a')}\\,${XS} - ${XS}${YS},\\qquad ${YD} = ${XS}${YS} - ${k(0, 'a')}\\,${YS}`,
          `(${XS}, ${YS}) = 2(${P} + 1),\\qquad ${V} = \\tfrac{1}{4}(${XD},\\ ${YD})`],
    knobs: [[k(0, 'a'), 0.8, 1.6]],
    note: 'Lotka–Volterra predator and prey (X prey, Y predator). The quantity X − a ln X + Y − a ln Y is conserved, so every orbit is a closed cycle round the point (a, a).',
  },
  hopf: {
    tex: [`${V} = 0.7\\left(${P}\\,(${k(0, '\\mu')} - ${R}^2) + ${k(1, '\\omega')}\\,(-${Y},\\ ${X})\\right)`],
    knobs: [[k(0, '\\mu'), -0.3, 0.6], [k(1, '\\omega'), 0.5, 2]],
    note: 'The normal form of a supercritical Hopf bifurcation. For μ < 0 the origin is a stable focus. As μ crosses 0, a stable limit cycle of radius √μ comes out of it.',
  },
  saddle: {
    tex: [`${V} = ${k(1, 's')}\\; R(${k(0, '\\alpha')}) \\begin{pmatrix} 1 & 0 \\\\ 0 & -1 \\end{pmatrix} R(-${k(0, '\\alpha')})\\; ${P}`],
    knobs: [[k(0, '\\alpha'), ' = \\pi\\, k_0 \\in [0,\\ \\pi]', '[0,\\ \\pi]'], [k(1, 's'), 0.5, 1.5]],
    note: 'A linear saddle with eigenvalues ±s. The stable and unstable axes are turned by α. Orbits come in along one axis and leave along the other on hyperbolas.',
  },
  node: {
    tex: [`${V} = 0.8\\,(${k(0, '\\lambda_1')}\\, ${X},\\ ${k(1, '\\lambda_2')}\\, ${Y})`],
    knobs: [[k(0, '\\lambda_1'), -1, 1], [k(1, '\\lambda_2'), -1, 1]],
    note: 'A diagonal linear system with real eigenvalues λ1, λ2. Both negative gives a stable node, both positive an unstable node. Opposite signs give a saddle.',
  },
  spiral: {
    tex: [`${V} = \\left(${k(0, 'a')}\\, ${X} - ${k(1, '\\omega')}\\, ${Y},\\ \\ ${k(1, '\\omega')}\\, ${X} + ${k(0, 'a')}\\, ${Y}\\right)`],
    knobs: [[k(0, 'a'), -0.6, 0.3], [k(1, '\\omega'), 0.5, 2]],
    note: 'A linear focus with the eigenvalues a ± iω. Orbits are logarithmic spirals: inward for a < 0, outward for a > 0, and circles (a center) at a = 0.',
  },
  limit_cycle: {
    tex: [`${V} = 0.8\\left(${k(1, 'c')}\\,(${k(0, 'R')} - ${R})\\, ${RH} + ${k(2, '\\omega')}\\, ${TH}\\right)`],
    knobs: [[k(0, 'R'), 0.3, 0.7], [k(1, 'c'), 1, 3], [k(2, '\\omega'), 0.5, 1.5]],
    note: 'A radial pull toward the circle r = R plus a swirl of constant speed: every orbit goes to the stable limit cycle at radius R. The pull c sets how fast.',
  },
  lorenz: {
    tex: [`${XD} = \\sigma(${c('m1', 'Y')} - ${XS}),\\qquad \\dot{Z} = ${XS}\\,${c('m1', 'Y')} - \\beta\\, ${c('m1', 'Z')},\\qquad \\sigma = 10,\\ \\beta = 8/3`,
          `${XS} = 25${X},\\quad ${c('m1', 'Z')} = 25${Y} + 25,\\quad ${c('m1', 'Y')} = ${k(0, 'c')}\\,${XS},\\qquad ${V} = \\frac{0.03}{25}\\,(${XD},\\ \\dot{Z})`],
    knobs: [[k(0, 'c'), 0.6, 1.4]],
    note: 'The Lorenz equations projected onto the (X, Z) plane, with Y set to c·X. This is a 2-D field, not the chaotic 3-D flow: the code declares ρ = 28 but does not use it, because it does not compute Ẏ.',
  },
  selkov: {
    tex: [`${XD} = -${XS} + ${k(0, 'a')}\\,${YS} + ${XS}^2${YS},\\qquad ${YD} = ${k(1, 'b')} - ${k(0, 'a')}\\,${YS} - ${XS}^2${YS}`,
          `(${XS}, ${YS}) = 1.5(${P} + 1),\\qquad ${V} = 0.4\\,(${XD},\\ ${YD})`],
    knobs: [[k(0, 'a'), 0.05, 0.15], [k(1, 'b'), 0.4, 1]],
    note: "Sel'kov's model of glycolysis (X is ADP, Y is F6P). For a range of a and b the fixed point is unstable and the orbits go to a limit cycle: a chemical clock.",
  },
  brusselator: {
    tex: [`${XD} = ${k(0, 'A')} - (${k(1, 'B')} + 1)\\,${XS} + ${XS}^2${YS},\\qquad ${YD} = ${k(1, 'B')}\\,${XS} - ${XS}^2${YS}`,
          `(${XS}, ${YS}) = 1.5(${P} + 1),\\qquad ${V} = 0.3\\,(${XD},\\ ${YD})`],
    knobs: [[k(0, 'A'), 0.5, 1.5], [k(1, 'B'), 1.5, 3.5]],
    note: 'The Brusselator, a model autocatalytic reaction. The fixed point is (A, B/A). It loses stability in a Hopf bifurcation at B = 1 + A², and above that the orbits go to a limit cycle.',
  },
  fitzhugh_ph: {
    tex: [`${c('m6', '\\dot{V}')} = ${c('m1', 'V')} - \\tfrac{1}{3}${c('m1', 'V')}^3 - ${c('m1', 'W')},\\qquad ${c('m6', '\\dot{W}')} = ${k(1, '\\varepsilon')}\\,(${c('m1', 'V')} + ${k(0, 'a')})`,
          `(${c('m1', 'V')}, ${c('m1', 'W')}) = 2${P},\\qquad ${V} = 0.6\\,(${c('m6', '\\dot{V}')},\\ ${c('m6', '\\dot{W}')})`],
    knobs: [[k(0, 'a'), 0.5, 0.9], [k(1, '\\varepsilon'), 0.05, 0.2]],
    note: 'The FitzHugh–Nagumo neuron, here without the usual −bW recovery term. V is fast and W is slow (ε small), so orbits run along the cubic V-nullcline and jump between its branches. The fixed point is at V = −a.',
  },
  pitchfork: {
    tex: [`${V} = ${k(1, 's')}\\left(${k(0, 'r')}\\, ${X} - ${X}^3,\\ -${Y}\\right)`],
    knobs: [[k(0, 'r'), -0.5, 0.5], [k(1, 's'), 0.5, 1.5]],
    note: 'The normal form of a supercritical pitchfork bifurcation. For r < 0 there is one stable point at the origin. For r > 0 it becomes unstable and two stable points come out at x = ±√r.',
  },
  // ---------------------------------------------------------- noise
  curl: {
    tex: [`${V} = 0.3\\, ${GP},\\qquad ${Q} = ${k(0, 'f')}\\, ${P} + 0.1\\, ${k(1, 'd')}\\, ${T}\\,(1, 1)`, ...NOISE],
    knobs: [[k(0, 'f'), 1, 4], [k(1, 'd'), 0, 1]],
    note: 'Curl noise (Bridson, Hourihan and Nordenstam 2007): the rotated gradient of a scalar noise field. It has zero divergence, so the particles swirl and do not bunch up. The drift d moves the noise along the diagonal.',
  },
  gradient: {
    tex: [`${V} = \\pm\\, 0.3\\, \\nabla_{q}\\psi,\\qquad ${Q} = ${k(0, 'f')}\\, ${P} + 0.1\\, ${k(1, 'd')}\\, ${T}\\,(1, 1)`, ...NOISE],
    knobs: [[k(0, 'f'), 1, 4], [k(1, 'd'), 0, 1], [k(2, '\\pm'), `:\\ - \\text{ (downhill) when } k_2 > 0.5`]],
    note: 'The plain gradient of the noise: a field with divergence and no curl. Uphill, the particles collect on the peaks of ψ. With the downhill switch on, they collect in the valleys.',
  },
  curl_plus_stream: {
    tex: [`${V} = ${k(1, 'A')}\\, ${GP} + (${k(2, 'U')},\\ 0),\\qquad ${Q} = ${k(0, 'f')}\\, ${P} + 0.1\\, ${T}\\,(1, 1)`, ...NOISE],
    knobs: [[k(0, 'f'), 1, 4], [k(1, 'A'), 0, 0.6], [k(2, 'U'), 0.2, 1]],
    note: 'Curl noise on top of a uniform stream: turbulent-looking eddies carried downstream. The ratio A/U sets how much the stream meanders.',
  },
  wind: {
    tex: [`${V} = 0.5\\, \\nabla^{\\perp}\\psi_1 + 0.12\\, ${k(0, 'g')}\\, \\nabla^{\\perp}\\psi_2 + ${k(1, 'S')}\\,\\left(0.3 + 0.2\\sin 0.5${T},\\ 0\\right)`,
          `\\psi_1:\\ ${Q} = 1.5${P} + 0.15${T}\\,(1,1),\\qquad \\psi_2:\\ ${Q} = 5${P} + 3 + 0.4${T}\\,(1,1)`, ...NOISE],
    knobs: [[k(0, 'g'), 0, 2], [k(1, 'S'), 0, 1]],
    note: 'Two scales of curl noise (large slow eddies and small fast gusts) plus a mean wind whose speed pulses. The gusts knob scales only the small eddies.',
  },
  sine_flow: {
    tex: [`${V} = 0.5\\left(\\sin(${k(0, 'a')}\\pi ${Y} + 0.5${T}),\\ \\sin(${k(0, 'a')}\\pi ${X} - 0.4${T})\\right)`],
    knobs: [[k(0, 'a'), 1, 4]],
    note: 'Crossed sine shears: each component depends only on the other coordinate, so the field has zero divergence. The two phases drift at different rates, so the lattice of cells moves and particles mix.',
  },
  abc_slice: {
    tex: [`${V} = 0.3\\left(A\\sin z + ${k(1, 'C')}\\cos \\pi ${Y},\\ \\ ${k(0, 'B')}\\sin \\pi ${X} + A\\cos z\\right),\\qquad A = 1,\\quad z = 0.2\\,${T}`],
    knobs: [[k(0, 'B'), 0.4, 1.2], [k(1, 'C'), 0.4, 1.2]],
    note: 'The (x, y) part of the Arnold–Beltrami–Childress flow on the plane z = 0.2t. The full 3-D ABC flow is a steady Euler solution with chaotic streamlines. This slice moves as z moves.',
  },
  perlin_curl: {
    tex: [`${V} = 0.5\\, ${GP},\\qquad ${Q} = ${k(0, 'f')}\\, ${P} + 0.05\\, ${k(1, 'd')}\\, ${T}\\,(1, 1)`, ...NOISE],
    knobs: [[k(0, 'f'), 0.8, 2.5], [k(1, 'd'), 0, 1]],
    note: 'Curl noise at a low frequency with a slow drift: wide, smooth eddies like marbled paper. It has zero divergence, as in curl.',
  },
  turbulent: {
    tex: [`${V} = 0.4\\, ${GP},\\qquad ${Q} = ${k(0, 'f')}\\, |${P}| + 0.1\\, ${k(1, 'd')}\\, ${T}\\,(1, 1),\\quad |${P}| = (|${X}|,\\ |${Y}|)`, ...NOISE],
    knobs: [[k(0, 'f'), 1, 4], [k(1, 'd'), 0, 1]],
    note: 'Curl noise of the folded coordinates (|x|, |y|): the noise is a mirror image across both axes, so the eddies make a four-fold kaleidoscope. The fold is on p, not on the fbm.',
  },
};

// one number for a knob range: at most 3 decimals, no trailing zeros
const num = v => { const s = (+v.toFixed(3)).toString(); return v < 0 ? '-' + s.slice(1) : s; };
const rangeTeX = (lo, hi) => `[${num(lo)},\\ ${num(hi)}]`;

// The TeX for knob i of a cell, or null. For a linear knob:
// sym = lo + (hi - lo) k_i in [lo, hi].
function knobTeX(kn, i) {
  if (!kn) return null;
  if (typeof kn[1] === 'string') return kn[0] + kn[1];
  const [sym, lo, hi] = kn, d = hi - lo;
  const lin = lo === 0 ? (d === 1 ? `k_${i}` : `${num(d)}\\, k_${i}`) : `${num(lo)} ${d < 0 ? '-' : '+'} ${num(Math.abs(d))}\\, k_${i}`;
  return `${sym} = ${lin} \\in ${rangeTeX(lo, hi)}`;
}

// The symbol and range for the inspector slider label of knob i, or null.
export function knobLabel(name, i) {
  const d = DOCS[name]; const kn = d && d.knobs[i];
  if (!kn) return null;
  return { tex: kn[0], cls: KC[i], range: typeof kn[1] === 'string' ? (kn[2] || '') : rangeTeX(kn[1], kn[2]) };
}

export function hasDoc(name) { return !!DOCS[name]; }

// Fill box with the doc for cell t: the field, the knob map, the note, the
// integrator. Each TeX line is a .sci-eq box typeset as MathJax SVG.
export function renderDoc(t, box) {
  const d = DOCS[t.s.name];
  box.replaceChildren();
  if (!d) { box.hidden = true; return; }
  box.hidden = false;
  const sec = (label) => { const h = document.createElement('div'); h.className = 'doc-lbl'; h.textContent = label; box.appendChild(h); };
  const eq = (tex) => { const e = document.createElement('div'); e.className = 'sci-eq'; box.appendChild(e); typeset(e, tex); };
  const txt = (s) => { const p = document.createElement('p'); p.className = 'doc-note'; p.textContent = s; box.appendChild(p); };
  sec('Velocity field');
  for (const line of d.tex) eq(line);
  txt(d.note);
  if (t.s.family === 'noise') txt(NOISE_NOTE);
  const kt = d.knobs.map(knobTeX).filter(Boolean);
  if (kt.length) { sec('Knobs'); for (const line of kt) eq(line); }
  sec('Integrator');
  for (const line of INTEGRATOR) eq(line);
  txt(INTEGRATOR_NOTE);
}

export { DOCS };
