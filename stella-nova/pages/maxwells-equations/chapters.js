// ============================================================================
//  MAXWELL'S EQUATIONS  ·  chapters.js — the steps: text, TeX, scene, controls
// ----------------------------------------------------------------------------
//  One record per step. main.js shows the steps in order.
//    id        the URL hash
//    ch        chapter index (CHAPTERS)
//    title     sentence case, plain
//    tex       [{ t: TeX, cap?: plain caption, small? }]; the colour classes
//              are put in by hand with the macros below
//    text      HTML paragraphs (STIX Two Text). Spans .m1 to .m6 colour a word.
//    scene     the scene module key (main.js SCENES), mode its mode
//    params    the scene state on entry
//    controls  [{ key, label, sym (HTML), cls, min, max, step, value, fmt }]
//              and { toggle: 'auto', label } for the run toggle
//    cam       { pos, target } in three.js world coordinates (y up)
//
//  Colours (lib/sci.css):  E .m2   B .m1   rho .m4   J .m5
//                          d, boundaries, surfaces .m3   A, F, star .m6
//  GREP MAP: "export const CHAPTERS"  "export const STEPS"  "const TEX"
// ============================================================================

// TeX macros with the colour classes.
const c = (k, t) => `\\class{${k}}{${t}}`;
const E = c('m2', 'E'), B = c('m1', 'B'), RHO = c('m4', '\\rho'), J = c('m5', 'J'), PHI = c('m2', '\\phi');
const Ev = c('m2', '\\mathbf{E}'), Bv = c('m1', '\\mathbf{B}'), Jv = c('m5', '\\mathbf{J}');
const d = c('m3', 'd'), PD = c('m3', '\\partial');
const A = c('m6', 'A'), F = c('m6', 'F'), STAR = c('m6', '\\star');
export const TEX = { E, B, RHO, J, PHI, Ev, Bv, Jv, d, PD, A, F, STAR, c };

export const CHAPTERS = [
  { name: 'Fields as forms', short: 'Forms' },
  { name: 'The boundary and d', short: 'Stokes' },
  { name: 'The four laws', short: 'Laws' },
];

const auto = (label = 'Animate') => ({ toggle: 'auto', label });

export const STEPS = [
  // ── 1 · fields as forms ──────────────────────────────────────────────────
  {
    id: 'e-one-form', ch: 0, title: 'The electric field is a 1-form', scene: 'forms', mode: 'E',
    params: { q: 1, endAng: 0.4, auto: true },
    tex: [
      { t: `${E} = -\\,${d}${PHI}`, cap: 'E is the derivative of the potential φ. Its sheets are the level surfaces of φ.' },
      { t: `\\int_{\\gamma} ${E} \\;=\\; ${PHI}(a) - ${PHI}(b) \\;\\approx\\; (\\text{sheets crossed})\\,\\Delta${PHI}`, small: true },
    ],
    text: `<p>An arrow at each point is one way to draw a field. A <em>1-form</em> is drawn by what it does: it takes a path and gives back a number. Its picture is a stack of sheets, and the number is how many sheets the path pierces, counted with sign.</p>
<p>On the right of the divider, the sheets of a point charge's field: the spheres on which the potential <span class="m2">φ</span> steps by Δφ. They crowd together near the charge, where the field is strong. On the left, the same field as arrows.</p>
<p>The bead runs a path from <i>a</i> to <i>b</i> and lights each sheet it crosses. The count times Δφ is the line integral of <span class="m2">E</span>, to within one sheet. The shape of the path does not matter, only its ends: that is what <span class="m2">E</span> = −<span class="m3">d</span><span class="m2">φ</span> says.</p>`,
    controls: [
      { key: 'q', label: 'charge', sym: 'q', cls: 'm4', min: 0.5, max: 2, step: 0.05, value: 1, fmt: v => v.toFixed(2) },
      { key: 'endAng', label: 'end of the path', sym: 'b', cls: '', min: -1.2, max: 1.4, step: 0.01, value: 0.4, fmt: v => (v * 57.3).toFixed(0) + '°' },
      auto('Run the bead'),
    ],
    cam: { pos: [1.6, 1.9, 8.2], target: [0, 0, 0] },
  },
  {
    id: 'b-two-form', ch: 0, title: 'The magnetic field is a 2-form', scene: 'forms', mode: 'B',
    params: { cellsR: 3, cellsZ: 4, auto: true },
    tex: [
      { t: `\\int_{S} ${B} \\;=\\; (\\text{tubes through } S)\\times(\\text{flux per tube})`, small: true },
      { t: `${B} \\;=\\; \\frac{${c('m5', 'I')}}{2\\pi}\\; dz \\wedge d(\\ln r)`, cap: 'The field of a straight wire as a 2-form.' },
    ],
    text: `<p>A <em>2-form</em> takes a surface and gives back a number. Its picture is a bundle of tubes, and the number is how many tubes pierce the surface.</p>
<p>Round a straight wire, <span class="m1">B</span> circles the wire. Written as a 2-form it is a product of two 1-forms, <i>dz</i> and <i>d</i>(ln <i>r</i>), so its tubes are rings walled in by the planes <i>z</i> = const and by cylinders whose radii grow by a fixed factor. The rings crowd toward the wire, as the field grows like 1/<i>r</i>.</p>
<p>The green strip lies in a half-plane through the wire. Each tube it cuts lights up. The count times the flux per tube is the flux of <span class="m1">B</span> through the strip, exactly, since the strip's edges sit on tube walls.</p>`,
    controls: [
      { key: 'cellsR', label: 'strip width, in tubes', sym: '', cls: '', min: 1, max: 6, step: 1, value: 3, fmt: v => String(v) },
      { key: 'cellsZ', label: 'strip height, in tubes', sym: '', cls: '', min: 1, max: 8, step: 1, value: 4, fmt: v => String(v) },
      auto('Resize the strip'),
    ],
    cam: { pos: [2.0, 2.2, 8.4], target: [0, 0, 0] },
  },
  {
    id: 'rho-three-form', ch: 0, title: 'Charge density is a 3-form', scene: 'forms', mode: 'rho',
    params: { boxX: 0, boxS: 0.9, auto: true },
    tex: [{ t: `Q_V \\;=\\; \\int_{V} ${RHO}`, cap: 'A 3-form takes a volume and gives back the charge inside it.' }],
    text: `<p>A <em>3-form</em> takes a volume. Its picture is a cloud of points, each holding the same small charge, and the number is how many points the volume holds.</p>
<p>There is no arrow picture here, and none is needed: <span class="m4">ρ</span> has no direction, only an amount per volume. The box counts the dots inside it, and that count times the charge per dot is the charge in the box.</p>
<p>The ladder is now complete. A 0-form is a number at each point (<span class="m2">φ</span>), a 1-form counts sheets along a path (<span class="m2">E</span>), a 2-form counts tubes through a surface (<span class="m1">B</span>, <span class="m5">J</span>), and a 3-form counts points in a volume (<span class="m4">ρ</span>).</p>`,
    controls: [
      { key: 'boxX', label: 'box position', sym: '', cls: '', min: -1, max: 1, step: 0.01, value: 0, fmt: v => v.toFixed(2) },
      { key: 'boxS', label: 'box size', sym: '', cls: '', min: 0.3, max: 1.6, step: 0.01, value: 0.9, fmt: v => v.toFixed(2) },
      auto('Move the box'),
    ],
    cam: { pos: [0.5, 1.5, 6.2], target: [0, 0, 0] },
  },
  {
    id: 'j-two-form', ch: 0, title: 'Current is a 2-form too', scene: 'forms', mode: 'J',
    params: { tilt: 0.4, discR: 0.62, auto: true },
    tex: [{ t: `I_S \\;=\\; \\int_{S} ${J}, \\qquad ${Jv} = ${c('m4', '\\rho')}\\,\\mathbf{v}`, cap: 'Current counts the charge that crosses a surface each second.' }],
    text: `<p>Current measures charge crossing a surface per second, so it takes a surface: <span class="m5">J</span> is a 2-form, drawn as tubes along the flow. The charges of <span class="m4">ρ</span> ride the tubes.</p>
<p>Tilt the disc. It cuts the same tubes at every angle until its shadow stops covering the wire. That is the content of the flux integral: only which tubes pass through counts, not the angle at which they pass.</p>`,
    controls: [
      { key: 'tilt', label: 'disc tilt', sym: '', cls: '', min: -1.1, max: 1.1, step: 0.01, value: 0.4, fmt: v => (v * 57.3).toFixed(0) + '°' },
      { key: 'discR', label: 'disc radius', sym: '', cls: '', min: 0.25, max: 0.9, step: 0.01, value: 0.62, fmt: v => v.toFixed(2) },
      auto('Tilt the disc'),
    ],
    cam: { pos: [2.0, 1.8, 7.6], target: [0, 0, 0] },
  },

  // ── 2 · the boundary and d ───────────────────────────────────────────────
  {
    id: 'gradient-theorem', ch: 1, title: 'A path, and the two points at its ends', scene: 'stokes', mode: 'stokes',
    params: { dim: 1, n: 5, spread: 1, auto: true },
    tex: [
      { t: `\\int_{R} ${d}\\omega \;=\; \\int_{${PD} R} \\omega`, cap: 'The generalized Stokes theorem. Here R is a path and ω = f is a 0-form.' },
      { t: `\\int_{\\gamma} ${d}f \;=\; f(b) - f(a), \\qquad ${PD}\\gamma = b - a`, small: true },
    ],
    text: `<p>Two operations sit under all four laws. The <em>exterior derivative</em> <span class="m3">d</span> turns a k-form into a (k+1)-form: a function into its gradient, a 1-form into its curl, a 2-form into its divergence. The <em>boundary</em> <span class="m3">∂</span> turns a region into its edge: a path into its two ends, a sheet into its rim, a solid into its skin.</p>
<p>Stokes' theorem says they are partners: integrating <span class="m3">d</span>ω over a region is the same as integrating ω over its boundary.</p>
<p>Start with a path cut into segments. On each segment, the integral of <span class="m3">d</span>f is f at the end minus f at the start: a + at one end and a − at the other. As the segments close up, each inner + lands on the next segment's −, and they cancel. Only the two outer ends are left.</p>`,
    controls: [
      { key: 'n', label: 'pieces', sym: '', cls: '', min: 2, max: 7, step: 1, value: 5, fmt: v => String(v) },
      { key: 'spread', label: 'pull the pieces apart', sym: '', cls: '', min: 0, max: 1, step: 0.01, value: 1, fmt: v => v.toFixed(2) },
      auto('Close and open'),
    ],
    cam: { pos: [0.6, 2.6, 5.4], target: [0, -0.1, 0] },
  },
  {
    id: 'kelvin-stokes', ch: 1, title: 'A sheet, and the loop round its rim', scene: 'stokes', mode: 'stokes',
    params: { dim: 2, n: 4, spread: 1, auto: true },
    tex: [
      { t: `\\int_{S} ${d}\\alpha \;=\; \\oint_{${PD} S} \\alpha`, cap: 'R is now a sheet and α a 1-form.' },
      { t: `\\iint_{S} (\\nabla\\times\\mathbf{A})\\cdot d\\mathbf{S} \;=\; \\oint_{${PD} S} \\mathbf{A}\\cdot d\\boldsymbol{\\ell}`, small: true, cap: 'The same statement in vector calculus (Kelvin–Stokes).' },
    ],
    text: `<p>Pull the path sideways and it sweeps out a sheet. Cut the sheet into cells. Round each cell, the circulation of α is the integral of <span class="m3">d</span>α over that cell: the small loop of arrows.</p>
<p>Where two cells meet, their loops run along the shared edge in opposite directions, so the two contributions cancel. Close the cells up and every inner edge goes; the arrows that are left run round the rim of the sheet.</p>
<p>The readout gives both sides for a sample α on this exact sheet.</p>`,
    controls: [
      { key: 'n', label: 'pieces per side', sym: '', cls: '', min: 2, max: 6, step: 1, value: 4, fmt: v => String(v) },
      { key: 'spread', label: 'pull the pieces apart', sym: '', cls: '', min: 0, max: 1, step: 0.01, value: 1, fmt: v => v.toFixed(2) },
      auto('Close and open'),
    ],
    cam: { pos: [1.2, 3.4, 4.9], target: [0, 0, 0] },
  },
  {
    id: 'divergence-theorem', ch: 1, title: 'A solid, and the skin round it', scene: 'stokes', mode: 'stokes',
    params: { dim: 3, n: 3, spread: 1, auto: true },
    tex: [
      { t: `\\int_{V} ${d}\\beta \;=\; \\oint_{${PD} V} \\beta`, cap: 'R is a solid and β a 2-form.' },
      { t: `\\iiint_{V} \\nabla\\cdot\\mathbf{F}\; dV \;=\; \\oint_{${PD} V} \\mathbf{F}\\cdot d\\mathbf{S}`, small: true, cap: 'The divergence theorem.' },
    ],
    text: `<p>Lift the sheet and it sweeps out a solid. Each cell has six faces with arrows pointing out. Where two cells touch, one cell's outward arrow is the other's inward arrow, so the flux through the shared face cancels.</p>
<p>Close the cells and only the outer skin is left. Three theorems from a calculus course, the gradient theorem, Kelvin–Stokes and the divergence theorem, are one statement about <span class="m3">d</span> and <span class="m3">∂</span> in three sizes.</p>`,
    controls: [
      { key: 'n', label: 'pieces per side', sym: '', cls: '', min: 1, max: 4, step: 1, value: 3, fmt: v => String(v) },
      { key: 'spread', label: 'pull the pieces apart', sym: '', cls: '', min: 0, max: 1, step: 0.01, value: 1, fmt: v => v.toFixed(2) },
      auto('Close and open'),
    ],
    cam: { pos: [3.4, 3.0, 4.6], target: [0, 0, 0.1] },
  },

  // ── 3 · the four laws ────────────────────────────────────────────────────
  {
    id: 'gauss', ch: 2, title: 'Gauss: the charge inside is the flux out', scene: 'laws', mode: 'gauss',
    params: { R0: 1.0, cz: 0.1, amp: 0.25, auto: true },
    tex: [
      { t: `\\nabla\\cdot ${Ev} = \\frac{${RHO}}{\\varepsilon_0} \\qquad \\oint_{${PD} V} ${Ev}\\cdot d\\mathbf{A} = \\frac{${c('m4', 'Q_V')}}{\\varepsilon_0}` },
      { t: `${d}\\,(${STAR}${E}) \;=\; ${RHO}`, small: true, cap: 'As forms (ε₀ = 1): ⋆E is the 2-form whose tubes are the field lines. Its d is the charge 3-form, so tubes begin and end only on charge.' },
    ],
    text: `<p>Three charges sit on an axis: +2, −1 and +1. Each orange line is the centre of one tube of flux, and each unit of charge sends out 24 of them. The +2 sends out 48, the −1 takes in 24.</p>
<p>The green surface <i>S</i> breathes and moves. Where a line leaves it, a bright mark; where a line enters, a dark one. Count out minus in and divide by 24: that is the charge inside, whatever the shape of the surface. A line that passes through without starting or ending inside crosses twice, once each way.</p>
<p>This is the divergence theorem of the last chapter, read the other way: the flux out of a region is the sum of the sources in it.</p>`,
    controls: [
      { key: 'R0', label: 'size of S', sym: '', cls: '', min: 0.3, max: 2.2, step: 0.01, value: 1, fmt: v => v.toFixed(2) },
      { key: 'cz', label: 'height of its centre', sym: '', cls: '', min: -1.9, max: 1.2, step: 0.01, value: 0.1, fmt: v => v.toFixed(2) },
      { key: 'amp', label: 'wobble', sym: '', cls: '', min: 0, max: 0.45, step: 0.01, value: 0.25, fmt: v => v.toFixed(2) },
      auto('Move the surface'),
    ],
    cam: { pos: [2.4, 1.2, 7.6], target: [0, -0.35, 0] },
  },
  {
    id: 'no-monopoles', ch: 2, title: 'No monopoles: tubes of B never end', scene: 'laws', mode: 'monopole',
    params: { R0: 1.0, cz: 0.1, amp: 0.25, auto: true },
    tex: [
      { t: `\\nabla\\cdot ${Bv} = 0 \\qquad \\oint_{${PD} V} ${Bv}\\cdot d\\mathbf{A} = 0` },
      { t: `${d}${B} \;=\; 0`, small: true, cap: 'The 2-form B is closed: its tubes have no ends.' },
    ],
    text: `<p>A ring of current makes a magnetic field whose lines close on themselves, each one looping once through the ring. There is no place where a line of <span class="m1">B</span> begins or ends.</p>
<p>So any closed surface, of any shape, in any place, sees each line leave and come back. The count of bright marks always equals the count of dark ones. Put the surface round the whole ring, round one side of the wire, or inside the ring: the net flux is zero.</p>
<p>A magnetic charge, a monopole, would be a place where tubes of <span class="m1">B</span> end. None has ever been found.</p>`,
    controls: [
      { key: 'R0', label: 'size of S', sym: '', cls: '', min: 0.3, max: 2.4, step: 0.01, value: 1, fmt: v => v.toFixed(2) },
      { key: 'cz', label: 'height of its centre', sym: '', cls: '', min: -1.2, max: 1.2, step: 0.01, value: 0.1, fmt: v => v.toFixed(2) },
      { key: 'amp', label: 'wobble', sym: '', cls: '', min: 0, max: 0.45, step: 0.01, value: 0.25, fmt: v => v.toFixed(2) },
      auto('Move the surface'),
    ],
    cam: { pos: [2.6, 3.0, 6.6], target: [0, 0, 0] },
  },
  {
    id: 'faraday', ch: 2, title: 'Faraday: a changing flux drives E round a loop', scene: 'laws', mode: 'faraday',
    params: { z0: 0.9, rho: 0.75, tilt: 0.25, bulge: 0.55, auto: true },
    tex: [
      { t: `\\nabla\\times ${Ev} = -\\frac{\\partial ${Bv}}{\\partial t} \\qquad \\oint_{C} ${Ev}\\cdot d\\boldsymbol{\\ell} = -\\frac{d}{dt}\\int_{S} ${Bv}\\cdot d\\mathbf{A}` },
      { t: `${d}${E} + \\partial_t ${B} \;=\; 0`, small: true, cap: 'As forms: the sheets of E end along the tubes of ∂B/∂t.' },
    ],
    text: `<p>Now the current in the ring swings back and forth, so its field of <span class="m1">B</span> grows, falls and turns over. A loop <i>C</i> floats above the ring. The changing flux through it drives an electric field round it: the orange arrows on <i>C</i>, and the orange circles round the axis.</p>
<p>Which surface's flux? <i>C</i> bounds a flat disc <i>S</i><sub>1</sub> and a dome <i>S</i><sub>2</sub>, and the readout shows they carry the same flux at every moment. That is the last law at work: together the two surfaces close a region, and <span class="m3">d</span><span class="m1">B</span> = 0 makes the net flux out of it zero. So "the flux through <i>C</i>" has one value, and Faraday's law makes sense.</p>
<p>The minus sign is Lenz's law: the induced field pushes against the change.</p>`,
    controls: [
      { key: 'z0', label: 'height of C', sym: '', cls: '', min: 0.4, max: 1.6, step: 0.01, value: 0.9, fmt: v => v.toFixed(2) },
      { key: 'rho', label: 'radius of C', sym: '', cls: '', min: 0.3, max: 1.3, step: 0.01, value: 0.75, fmt: v => v.toFixed(2) },
      { key: 'tilt', label: 'tilt of C', sym: '', cls: '', min: -0.6, max: 0.6, step: 0.01, value: 0.25, fmt: v => (v * 57.3).toFixed(0) + '°' },
      { key: 'bulge', label: 'bulge of the dome', sym: '', cls: '', min: -0.9, max: 0.9, step: 0.01, value: 0.55, fmt: v => v.toFixed(2) },
      auto('Tilt and bulge'),
    ],
    cam: { pos: [2.8, 2.6, 6.2], target: [0, 0.45, 0] },
  },
  {
    id: 'ampere-maxwell', ch: 2, title: 'Ampère and Maxwell: the current that crosses the gap', scene: 'laws', mode: 'ampere',
    params: { zc: 0.9, r0: 0.75, auto: true },
    tex: [
      { t: `\\nabla\\times ${Bv} = \\mu_0 ${Jv} + \\mu_0\\varepsilon_0 \\frac{\\partial ${Ev}}{\\partial t}` },
      { t: `\\oint_{C} ${Bv}\\cdot d\\boldsymbol{\\ell} = \\mu_0 ${c('m5', 'I_S')} + \\mu_0\\varepsilon_0\\frac{d}{dt}\\int_{S} ${Ev}\\cdot d\\mathbf{A}`, small: true },
      { t: `${d}\\,(${STAR}${B}) - \\partial_t (${STAR}${E}) \;=\; ${J}`, small: true, cap: 'As forms (μ₀ = ε₀ = 1).' },
    ],
    text: `<p>An alternating current runs in a wire with a capacitor in it. Charge piles up on one plate and drains from the other, and between the plates there is no wire at all.</p>
<p>Ampère's law says the circulation of <span class="m1">B</span> round a loop <i>C</i> equals the current through a surface bounded by <i>C</i>. The flat disc <i>S</i><sub>1</sub> is cut by the wire, so it carries the current <span class="m5">I</span>. The bag <i>S</i><sub>2</sub> has the same rim but passes between the plates, and no charge crosses it. Without a second term, the two surfaces would give two answers.</p>
<p>Maxwell's term settles it. Between the plates <span class="m2">E</span> grows as the charge grows, and ε₀ d<span class="m2">Φ<sub>E</sub></span>/dt is exactly the current that stopped at the plate. The dashed orange lines carry the current on across the gap, and both surfaces now give the same circulation.</p>`,
    controls: [
      { key: 'zc', label: 'height of C', sym: '', cls: '', min: 0.45, max: 1.8, step: 0.01, value: 0.9, fmt: v => v.toFixed(2) },
      { key: 'r0', label: 'radius of C', sym: '', cls: '', min: 0.3, max: 1.5, step: 0.01, value: 0.75, fmt: v => v.toFixed(2) },
      auto('Resize the loop'),
    ],
    cam: { pos: [3.2, 1.6, 6.8], target: [0, 0.2, 0] },
  },
];
