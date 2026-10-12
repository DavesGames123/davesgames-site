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
];
