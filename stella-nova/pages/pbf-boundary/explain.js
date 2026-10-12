// ============================================================================
//  PBF BOUNDARIES  ·  pages/pbf-boundary/explain.js — the page explains itself
// ----------------------------------------------------------------------------
//  The parts of the page that say what the simulation shows:
//    info band    the title, a lead of two sentences, one button per preset
//                 (scene.PRESETS) with its caption, and "How it works"
//    legend       the colour key of the fluid (water colours or the colour
//                 map with its end values), boundary particles, walls and
//                 bodies
//    how sheet    "How it works": the density rule, the boundary weight Ψ,
//                 buoyancy and the wall clamp as MathJax SVG (lib/sci-math)
//                 with the colours of lib/sci.css (.m1 to .m5)
//  All three go inside the sim kit root (#sk-root), so the saver hides
//  them with the rest of the GUI. Desktop: the band sits at the top left,
//  the legend at the bottom left, the sheet is a left drawer. Phone: the
//  band is the title, the caption and a row of preset chips; the legend is
//  one line over the dock; the sheet is a bottom sheet (style.css).
//
//  TeX colours (one per quantity, the same colour on the canvas):
//    m1 fluid, density ρ   m2 boundary particles, Ψ   m3 correction λ
//    m4 bodies             m5 kernel W, h
//
//  grep -n targets
//    TeX strings ........... "export const EQS"
//    band ................... "export function mountExplain"
//    legend ................. "function paintLegend"
//    how sheet .............. "function howSheet"
// ============================================================================
import { typeset } from '../../lib/sci-math.js';

const c = (k, t) => `\\class{m${k}}{${t}}`;
const RHO_I = c(1, '\\rho_i'), RHO0 = c(1, '\\rho_0'), PSI = c(2, '\\Psi_b'), LAM_I = c(3, '\\lambda_i'), LAM_J = c(3, '\\lambda_j');
const W = c(5, 'W'), Hh = c(5, 'h'), XB = c(2, '\\mathbf{x}_b'), XK = c(2, '\\mathbf{x}_k');

// Display equations of the "How it works" sheet, in reading order.
export const EQS = {
  density: `${RHO_I} = \\sum_j ${W}(\\mathbf{x}_i - \\mathbf{x}_j, ${Hh}) + \\sum_b ${PSI}\\, ${W}(\\mathbf{x}_i - ${XB}, ${Hh}),\\qquad C_i = \\frac{${RHO_I}}{${RHO0}} - 1`,
  lambda: `${LAM_I} = -\\frac{C_i}{\\sum_k \\lvert \\nabla_{\\mathbf{x}_k} C_i \\rvert^2 + \\varepsilon}\\quad (C_i > 0)`,
  delta: `\\Delta\\mathbf{x}_i = \\frac{1}{${RHO0}} \\sum_j \\left(${LAM_I} + ${LAM_J} + s_{\\mathrm{corr}}\\right) \\nabla ${W}_{ij} + \\frac{1}{${RHO0}} \\sum_b ${PSI}\\, ${LAM_I}\\, \\nabla ${W}_{ib}`,
  psi: `${PSI} = \\frac{${RHO0}}{\\sum_{k \\in \\text{wall}} ${W}(${XB} - ${XK}, ${Hh})}`,
  body: `\\Delta ${c(4, '\\mathbf{x}_B')} = -\\frac{1}{${c(4, 'm_B')}} \\sum_{b \\in B} \\sum_i \\Delta\\mathbf{x}_{i \\leftarrow b}\\qquad\\Rightarrow\\qquad \\frac{A_{\\text{under}}}{A} \\approx \\frac{${c(4, '\\rho_B')}}{${RHO0}}`,
  clamp: `\\phi(\\mathbf{x}_i) < r \\;\\Rightarrow\\; \\mathbf{x}_i \\leftarrow \\mathbf{x}_i + \\bigl(r - \\phi(\\mathbf{x}_i)\\bigr)\\, \\nabla\\phi(\\mathbf{x}_i)`,
};

// Small element helper, the same shape as the sim kit's h().
function h(tag, p, kids) {
  const el = document.createElement(tag);
  if (p) for (const k in p) {
    const v = p[k];
    if (v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'on') for (const e in v) el.addEventListener(e, v[e]);
    else el.setAttribute(k, v);
  }
  if (kids) for (const ch of kids) if (ch) el.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch);
  return el;
}

export const TITLE = 'Fluid walls made of particles';
export const LEAD = 'The water is a position-based fluid: thousands of particles that move each step until the density around every particle is back at rest. Walls, obstacles and bodies are made of particles too (orange). The water feels them through the same density rule, and that is the whole boundary method.';
export const LEAD_SHORT = 'Water as particles that keep a fixed density. The walls and bodies are particles too (orange), so the water feels them through the same rule.';

// opts: { kit, presets, onPreset(id), phone }
export function mountExplain(opts) {
  const { kit, presets } = opts;
  const root = kit.root;
  const band = h('section', { id: 'pb-info', class: 'pb-info', 'aria-label': 'About this simulation' });
  const title = h('h1', { class: 'pb-title', text: TITLE });
  const lead = h('p', { class: 'pb-lead', text: LEAD });
  const chips = h('div', { class: 'pb-presets', role: 'group', 'aria-label': 'Presets: one boundary idea each' });
  const btns = new Map();
  for (const p of presets) {
    const b = h('button', { type: 'button', class: 'pb-chip', 'aria-pressed': 'false', title: p.caption, text: p.label, on: { click: () => opts.onPreset(p.id) } });
    btns.set(p.id, b); chips.appendChild(b);
  }
  const howBtn = h('button', { type: 'button', class: 'pb-chip pb-howbtn', 'aria-expanded': 'false', 'aria-controls': 'pb-how', text: 'How it works', on: { click: () => setHow(!howOpen) } });
  chips.appendChild(howBtn);
  const cap = h('p', { class: 'pb-cap', 'aria-live': 'polite' });
  band.appendChild(title); band.appendChild(lead); band.appendChild(chips); band.appendChild(cap);
  root.appendChild(band);

  const legend = h('ul', { id: 'pb-legend', class: 'pb-legend', 'aria-label': 'Colour key' });
  root.appendChild(legend);

  const sheet = howSheet(() => setHow(false));
  root.appendChild(sheet.el);
  let howOpen = false, typeset0 = false;
  function setHow(o) {
    howOpen = !!o;
    sheet.el.hidden = !howOpen;
    howBtn.setAttribute('aria-expanded', String(howOpen));
    if (howOpen && opts.phone && kit.panelOpen) kit.setPanel(false);
    if (howOpen && !typeset0) { typeset0 = true; for (const [el, tex] of sheet.eqs) typeset(el, tex, { display: true }); }
  }
  kit.on('panel', open => { if (open && opts.phone && howOpen) setHow(false); });
  if (typeof addEventListener === 'function') addEventListener('keydown', e => { if (e.key === 'Escape' && howOpen) setHow(false); });

  let active = null;
  function setPreset(id, seed) {
    active = id;
    for (const [pid, b] of btns) b.setAttribute('aria-pressed', String(pid === id));
    const p = presets.find(q => q.id === id);
    cap.textContent = p ? p.caption : (opts.phone ? LEAD_SHORT : 'Random scene, seed ' + seed + '. Pick a preset above to see one boundary idea at a time.');
  }
  return {
    band, legend, sheet: sheet.el, setPreset, setHow,
    get active() { return active; }, get howOpen() { return howOpen; },
    paintLegend: items => paintLegend(legend, items),
  };
}

// items: [{ swatch: css background, shape: 'dot' | 'line' | 'bar' | 'box',
// text, lo?, hi? }]. A bar shows its end values on each side.
export function legendKey(items) { return JSON.stringify(items); }
function paintLegend(ul, items) {
  const key = legendKey(items);
  if (ul._key === key) return false;
  ul._key = key;
  ul.innerHTML = '';
  for (const it of items) {
    const sw = h('span', { class: 'pb-sw pb-' + (it.shape || 'box') });
    sw.style.setProperty('background', it.swatch);
    const kids = it.shape === 'bar'
      ? [h('span', { class: 'pb-lt', text: it.text }), h('span', { class: 'pb-end', text: it.lo }), sw, h('span', { class: 'pb-end', text: it.hi })]
      : [sw, h('span', { class: 'pb-lt', text: it.text })];
    ul.appendChild(h('li', null, kids));
  }
  return true;
}

function howSheet(close) {
  const el = h('aside', { id: 'pb-how', class: 'pb-how', role: 'dialog', 'aria-labelledby': 'pb-how-h' });
  el.hidden = true;
  const eqs = [];
  const eq = name => { const d = h('div', { class: 'sci-eq', 'aria-label': EQS[name] }); d.textContent = ''; eqs.push([d, EQS[name]]); return d; };
  const P = html => h('p', { html });
  const head = h('div', { class: 'pb-howhead' }, [
    h('h2', { id: 'pb-how-h', text: 'How it works' }),
    h('button', { type: 'button', class: 'pb-x', 'aria-label': 'Close', title: 'Close (Esc)', text: '×', on: { click: close } }),
  ]);
  const body = h('div', { class: 'pb-howbody' }, [
    h('h3', { text: 'What you see' }),
    P('<span class="m1">Blue</span>: the fluid. Each particle stands for a 2 cm square of water (spacing <i>d</i> = 0.02 m) in a tank 2 m wide. <span class="m2">Orange dots</span>: the boundary particles, one layer just inside every wall, obstacle and body. <span class="m4">Shapes</span>: rigid bodies that the water carries, lifts or lets sink.'),
    h('h3', { text: 'The density rule' }),
    P('Position-based fluids (Macklin and Müller, 2013) predict where each particle goes, then move the particles until the density at each one is back at the rest value. The density counts the fluid neighbours and the boundary particles inside the kernel radius <span class="m5"><i>h</i></span> = 2.4 <i>d</i>:'),
    eq('density'),
    P('Only a squeeze is corrected (<i>C<sub>i</sub></i> &gt; 0), so the water can pull apart at a splash. Each particle gets a scale factor <span class="m3">λ</span>:'),
    eq('lambda'),
    P('and the move that brings the density back. The last sum is the push from the boundary particles:'),
    eq('delta'),
    h('h3', { text: 'Why the walls are particles' }),
    P('At a wall, half of the kernel of a particle would be empty, so the water there would see too little density and pack into the wall. The boundary particles fill that half (Akinci and others, 2012). Each one counts with a weight <span class="m2">Ψ</span> from its own wall neighbours, so a sparse or a dense wall adds the density of one full layer of water:'),
    eq('psi'),
    P('Try the presets “Wall particles off” and “Sparse wall”, or the solver settings in the panel.'),
    h('h3', { text: 'Bodies and buoyancy' }),
    P('A <span class="m4">body</span> is sampled with boundary particles too. Every push it gives the water goes back to the body, equal and opposite, divided by its mass. Nothing else makes it float, and the result comes close to Archimedes’ rule: the part under water is near the density ratio.'),
    eq('body'),
    h('h3', { text: 'The safety net' }),
    P('A fast particle can still reach a wall in one step. A signed distance <i>φ</i> to every solid moves it back out to one particle radius <i>r</i> = <i>d</i>/2, with a little friction along the wall:'),
    eq('clamp'),
    h('h3', { text: 'Sources' }),
    P('M. Macklin and M. Müller, “Position based fluids”, ACM TOG 32(4), 2013. N. Akinci and others, “Versatile rigid-fluid coupling for incompressible SPH”, ACM TOG 31(4), 2012. The page grew from the Ten Minute Physics contribution “PBF Boundary” by Sergii Biloshytskyi (MIT licence).'),
  ]);
  el.appendChild(head); el.appendChild(body);
  return { el, eqs };
}
