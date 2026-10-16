// ============================================================================
//  THERMAL CONVECTION  ·  explainer.js — equations and explainer (package UI)
// ----------------------------------------------------------------------------
//  DOM-free data plus one render function. The data is TeX and short HTML
//  paragraphs with citations. renderExplainer() builds the DOM and typesets
//  the TeX through the typeset function that it gets (lib/sci-math.js in
//  the page, a stub in the node tests).
//
//  COLOUR CODE. Each term of the equations gets one math class from
//  lib/sci.css. colorize() wraps the term TeX in \class{mN}{...}:
//      m1 advection    m6 pressure    m3 viscosity
//      m2 buoyancy     m4 diffusion   m5 Ra (the control on the panel)
//
//  The equations are those of CONTRACT.md "Physics", in free-fall units:
//  length d, velocity sqrt(g alpha dT d), temperature (T - T_top) / dT.
//
//  EXPORTS   (grep -n "<anchor>" explainer.js)
//      TERMS ........... "export const TERMS"      term -> class and name
//      RULES ........... "export const RULES"      colorize rules
//      EQUATIONS ....... "export const EQUATIONS"  the equation list
//      DEFINITIONS ..... "export const DEFINITIONS" Ra, Pr, Nu, Ma
//      SECTIONS ........ "export const SECTIONS"   explainer text
//      REFS ............ "export const REFS"       the cited sources
//      RA_CRIT ......... "export const RA_CRIT"    onset values
//      renderExplainer . "export function renderExplainer"
//      citeKeys ........ "export function citeKeys"
// ============================================================================

const R = String.raw;

// Onset of convection, Chandrasekhar 1961 (ch. II): two rigid walls, and a
// rigid bottom with a free (stress-free) top. Two free walls: 27 pi^4 / 4.
export const RA_CRIT = { rigid: 1707.76, free: 1100.65, freefree: 657.51 };

// One entry per coloured term. tex is the exact TeX string in EQUATIONS.
export const TERMS = [
  { key: 'advection', cls: 'm1', name: 'Advection', tex: [R`(\mathbf{u}\cdot\nabla)\,\mathbf{u}`, R`\mathbf{u}\cdot\nabla T`] },
  { key: 'pressure', cls: 'm6', name: 'Pressure', tex: [R`\nabla p`] },
  { key: 'viscosity', cls: 'm3', name: 'Viscosity', tex: [R`\sqrt{\mathrm{Pr}/\mathrm{Ra}}\;\nabla^{2}\mathbf{u}`] },
  { key: 'buoyancy', cls: 'm2', name: 'Buoyancy', tex: [R`T\,\hat{\mathbf{z}}`] },
  { key: 'diffusion', cls: 'm4', name: 'Heat diffusion', tex: [R`\frac{1}{\sqrt{\mathrm{Ra}\,\mathrm{Pr}}}\;\nabla^{2}T`] },
];

export const RULES = TERMS.flatMap(t => t.tex.map(x => [x, t.cls]));

export const EQUATIONS = [
  { id: 'momentum', label: 'Momentum (Navier–Stokes, Boussinesq)',
    tex: R`\frac{\partial \mathbf{u}}{\partial t} + (\mathbf{u}\cdot\nabla)\,\mathbf{u} = -\nabla p + \sqrt{\mathrm{Pr}/\mathrm{Ra}}\;\nabla^{2}\mathbf{u} + T\,\hat{\mathbf{z}}` },
  { id: 'mass', label: 'Mass (incompressible flow)',
    tex: R`\nabla\cdot\mathbf{u} = 0` },
  { id: 'heat', label: 'Heat',
    tex: R`\frac{\partial T}{\partial t} + \mathbf{u}\cdot\nabla T = \frac{1}{\sqrt{\mathrm{Ra}\,\mathrm{Pr}}}\;\nabla^{2}T` },
  { id: 'marangoni', label: 'Thin pan only: surface-tension stress at the top, z = 1',
    tex: R`\frac{\partial u}{\partial z} = -\mathrm{Ma}_{\mathrm{eff}}\,\frac{\partial T}{\partial x},\qquad \frac{\partial v}{\partial z} = -\mathrm{Ma}_{\mathrm{eff}}\,\frac{\partial T}{\partial y}` },
];

export const DEFINITIONS = [
  { sym: R`\mathrm{Ra}`, cls: 'm5', name: 'Rayleigh number',
    tex: R`\mathrm{Ra} = \frac{g\,\alpha\,\Delta T\,d^{3}}{\nu\,\kappa}`,
    text: 'Buoyancy against the two brakes, viscosity and heat diffusion. g is gravity, α the thermal expansion, ΔT the temperature step across the layer, d the depth, ν the kinematic viscosity, κ the thermal diffusivity.' },
  { sym: R`\mathrm{Pr}`, cls: 'm6', name: 'Prandtl number',
    tex: R`\mathrm{Pr} = \frac{\nu}{\kappa}`,
    text: 'How fast momentum diffuses compared with heat. About 7 for water at room temperature, about 0.7 for air, far below 1 in the plasma of the Sun.' },
  { sym: R`\mathrm{Nu}`, cls: '', name: 'Nusselt number',
    tex: R`\mathrm{Nu} = \frac{\langle q \rangle}{k\,\Delta T / d}`,
    text: 'The mean heat flux through the layer divided by the flux of pure conduction. Nu = 1 means no convection. The readout measures it at the bottom wall.' },
  { sym: R`\mathrm{Ma}`, cls: 'm3', name: 'Marangoni number',
    tex: R`\mathrm{Ma} = \frac{\left|\partial\sigma/\partial T\right|\,\Delta T\,d}{\rho\,\nu\,\kappa}`,
    text: 'Surface-tension stress against viscosity and diffusion. σ is the surface tension, ρ the density. Hot spots on the surface pull less, so the surface flows from hot to cold.' },
];

// Explainer sections. Paragraphs are HTML (no user data). cites are REFS keys.
export const SECTIONS = [
  { id: 'drive', title: 'What drives convection',
    paras: [
      'Heat the bottom of a fluid layer and the warm fluid at the bottom expands. It is lighter than the cool fluid above it, so the layer is top-heavy. Buoyancy pushes the warm fluid up, but viscosity resists the motion and heat diffusion smooths out a warm parcel before it can rise far.',
      'The Rayleigh number Ra compares buoyancy with those two brakes. Below a critical value the fluid stays at rest and heat goes through by conduction only: the temperature falls in a straight line from the bottom to the top. Above it the rest state is unstable and the fluid turns over in cells. For rigid walls at the top and the bottom the onset is at Ra = 1708; for a free top surface it is at Ra = 1101 (Rayleigh 1916; Chandrasekhar 1961).',
      'Near onset the cells are steady rolls or hexagons about two layer depths across. At higher Ra the cells move, split and merge, thin hot plumes rise from the bottom boundary layer and cold plumes fall from the top. The heat flux grows: the Nusselt number Nu climbs above 1.',
    ], cites: ['rayleigh1916', 'chandra1961'] },
  { id: 'voronoi', title: 'Why the surface looks like a Voronoi pattern',
    paras: [
      'Each cell has warm fluid rising in its middle. At the top the fluid spreads out, loses its heat and turns down where it meets the flow of the next cell. So the surface is a set of warm patches, each one fed from its own centre, cut apart by thin cold lanes where neighbours meet. A Voronoi diagram has the same form: every point belongs to the nearest centre, and the borders are the lines midway between centres.',
      'The likeness is a description, not a law. Real cell borders bend, and cells are not of equal strength. Near onset the pattern can be very regular hexagons; at high Ra it is an irregular, moving net of polygons.',
    ], cites: [] },
  { id: 'soup', title: 'Soup, oil and thin pans',
    paras: [
      'Henri Bénard photographed regular hexagonal cells in thin liquid layers, about a millimetre deep, heated from below with an open top (Bénard 1900). Rayleigh built his buoyancy theory to explain them. In 1958 Pearson showed that in layers that thin, buoyancy is too weak: the cells come from surface tension. A warm spot on the surface has a lower surface tension, so the surface pulls fluid away from it, and fluid from below comes up to take its place (Pearson 1958). His critical Marangoni number is about 80.',
      'Ra grows with the cube of the depth and Ma with the depth only, so a thin layer is a surface-tension problem and a deep pot is a buoyancy problem. The thin pan preset adds the surface-tension stress at the top; the hot plate and burner presets use buoyancy only.',
      'A bowl of soup on a table cools from its open top, and a pot on a stove is heated at one place. The burner mode heats a round patch at the centre of the bottom: it gives one strong central plume with a ring roll around it, not a field of equal cells.',
    ], cites: ['benard1900', 'pearson1958'] },
  { id: 'sun', title: 'The Sun',
    paras: [
      'The visible surface of the Sun, the photosphere, is covered in granules: bright cells about 1000–1500 km across, each with a lifetime of about 5–10 minutes. Hot plasma rises in the middle of a granule, radiates its heat away into space at the photosphere, becomes denser and sinks in the narrow dark lanes between granules (Nordlund, Stein and Asplund 2009).',
      'The sinking lanes are narrow and the rising cells are broad because the cooling happens in a thin layer at the very top. The sun mode copies that with a cooling flux at the top that grows with temperature. The real Sun is strongly stratified and compressible and has a Rayleigh number many orders of magnitude above anything a grid can resolve, so this is a picture of the mechanism, not a model of the Sun.',
    ], cites: ['nordlund2009'] },
  { id: 'model', title: 'What this model leaves out',
    paras: [
      'The simulation uses the Boussinesq approximation: the density changes only in the buoyancy term, and the flow is otherwise incompressible. It has no compressibility or density stratification, no radiative transfer (the sun mode uses a simple top cooling law in its place), no magnetic field, and a flat top surface that does not deform. The sides are periodic, so there are no bowl walls. The grid is coarse: at the higher Rayleigh numbers the thinnest boundary layers are not resolved, and the flow is a sketch of the turbulence, not a converged solution.',
      '<span class="note">Illustrative values: the grid size, the burner patch, the cooling law and the effective Marangoni number are chosen to give a clear picture on a GPU in real time. They are not fitted to any one fluid.</span>',
    ], cites: [] },
  { id: 'units', title: 'Units',
    paras: [
      'Lengths are in layer depths d, temperatures run from 0 at the cold top to 1 at the hot bottom, and time is in free-fall times t<sub>ff</sub> = √(d / (g α ΔT)): about the time a warm parcel takes to rise one depth if only buoyancy acted. The box is 4 depths wide and repeats at its sides.',
    ], cites: [] },
];

export const REFS = {
  benard1900: { text: 'H. Bénard (1900). Les tourbillons cellulaires dans une nappe liquide. Revue générale des sciences pures et appliquées 11, 1261–1271 and 1309–1328.' },
  rayleigh1916: { text: 'Lord Rayleigh (1916). On convection currents in a horizontal layer of fluid, when the higher temperature is on the under side. Philosophical Magazine (6) 32, 529–546.', url: 'https://doi.org/10.1080/14786441608635602' },
  pearson1958: { text: 'J. R. A. Pearson (1958). On convection cells induced by surface tension. Journal of Fluid Mechanics 4, 489–500.', url: 'https://doi.org/10.1017/S0022112058000616' },
  chandra1961: { text: 'S. Chandrasekhar (1961). Hydrodynamic and Hydromagnetic Stability. Oxford: Clarendon Press. Chapter II.' },
  nordlund2009: { text: 'Å. Nordlund, R. F. Stein and M. Asplund (2009). Solar surface convection. Living Reviews in Solar Physics 6, 2.', url: 'https://doi.org/10.12942/lrsp-2009-2' },
};

// Every REFS key that a section cites, in first-cite order.
export function citeKeys() {
  const out = [];
  for (const s of SECTIONS) for (const k of s.cites) if (!out.includes(k)) out.push(k);
  return out;
}

// Build the equations (into eqRoot) and the explainer (into exRoot).
// typeset(el, tex, { display, rules }) is lib/sci-math.js typeset. It is
// passed in so the module stays DOM-free at import. Returns a promise that
// settles when every box is typeset.
export function renderExplainer({ eqRoot, keyRoot, exRoot, typeset, doc = globalThis.document }) {
  const jobs = [];
  const el = (tag, cls, html) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const math = (tex, display, rules, cls) => {
    const e = el(display ? 'div' : 'span', (display ? 'sci-eq' : 'sci-sym') + (cls ? ' ' + cls : ''));
    e.textContent = tex;
    jobs.push(Promise.resolve(typeset(e, tex, { display, rules })).catch(() => false));
    return e;
  };
  if (eqRoot) {
    eqRoot.textContent = '';
    for (const q of EQUATIONS) {
      eqRoot.appendChild(el('div', 'eq-sub', q.label));
      const box = math(q.tex, true, RULES);
      box.dataset.eq = q.id;
      eqRoot.appendChild(box);
    }
  }
  if (keyRoot) {
    keyRoot.textContent = '';
    for (const t of TERMS) keyRoot.appendChild(el('span', t.cls, t.name));
  }
  if (exRoot) {
    exRoot.textContent = '';
    exRoot.appendChild(el('h3', '', 'Numbers that set the flow'));
    const defs = el('div', 'defs');
    for (const d of DEFINITIONS) {
      defs.appendChild(math(d.sym, false, null, 'sym' + (d.cls ? ' ' + d.cls : '')));
      const txt = el('div', 'txt');
      txt.appendChild(el('div', '', `<strong>${d.name}</strong>`));
      txt.appendChild(math(d.tex, true, null));
      txt.appendChild(el('div', '', d.text));
      defs.appendChild(txt);
    }
    exRoot.appendChild(defs);
    const keys = citeKeys();
    for (const s of SECTIONS) {
      const sec = el('section');
      sec.dataset.sec = s.id;
      sec.appendChild(el('h3', '', s.title));
      for (const p of s.paras) sec.appendChild(el('p', '', p));
      if (s.cites.length) sec.appendChild(el('p', 'cite', 'Sources: ' + s.cites.map(k => `[${keys.indexOf(k) + 1}]`).join(' ')));
      exRoot.appendChild(sec);
    }
    exRoot.appendChild(el('h3', '', 'Sources'));
    const ol = el('ol', 'refs');
    for (const k of keys) {
      const r = REFS[k];
      ol.appendChild(el('li', '', r.text + (r.url ? ` <a href="${r.url}" target="_blank" rel="noopener">${r.url.replace('https://', '')}</a>` : '')));
    }
    exRoot.appendChild(ol);
  }
  return Promise.all(jobs);
}
