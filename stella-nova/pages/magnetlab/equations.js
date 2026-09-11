// ============================================================================
//  MAGNETLAB  ·  equation panel renderer  (KaTeX helper)
// ----------------------------------------------------------------------------
//  Renders the three governing equations of the MagnetLab overlay panel into
//  their target elements with KaTeX, then wires the panel collapse toggle.
//  This runs before main.js. It only paints math and one click handler; it
//  never touches the simulation state.
//
//  Each formula reuses one colour per physical symbol, so the same quantity
//  reads the same hue across all three lines.
//      op #96c8ff  the del operator (divergence, curl)
//      B  #60e0ee  the magnetic field vector
//      J  #ffb84d  the free current density
//      mu #c890ff  the permeability constants mu_0 and mu_0*eps_0
//      E  #ffc832  the electric field vector
//      m  #ff9050  the dipole moment vector
//
//  TARGET ELEMENTS  (ids owned by index.html)
//      #eq-gauss-b   div B = 0            no magnetic monopoles
//      #eq-ampere    curl B = ...         Ampere with Maxwell's correction
//      #eq-dipole    B(r) = ...           the point-dipole field, the sim core
//
//  SECTION MAP   (jump with grep -n "<anchor>" equations.js)
//      guard + palette ..... "window.katex"      bail out if KaTeX absent
//      render calls ........ "katex.render"       paint the three formulas
//      collapse toggle ..... "eq-toggle"          expand/collapse the panel
// ============================================================================

// Run as an IIFE so the palette and options never leak into global scope.
(function(){

  // Bail out silently if the KaTeX library did not load; the panel then stays
  // empty rather than throwing during page init.
  if(!window.katex) return;

  // One hex colour per physical symbol, shared across all three formulas.
  const B='#60e0ee',E='#ffc832',J='#ffb84d',mu='#c890ff',op='#96c8ff',m='#ff9050';

  // Shared KaTeX options: display mode (block, centred) and no throw on error.
  const o={throwOnError:false,displayMode:true};
  // Gauss's law for magnetism: the divergence of B is zero everywhere, so
  // field lines never begin or end. This is why the sim has no monopoles.
  katex.render(String.raw`\textcolor{${op}}{\nabla}\cdot\textcolor{${B}}{\vec{B}}=0`,document.getElementById('eq-gauss-b'),o);

  // Ampere's law with Maxwell's displacement-current term: a current density J
  // and a changing E field both curl the magnetic field.
  katex.render(String.raw`\textcolor{${op}}{\nabla}\times\textcolor{${B}}{\vec{B}}=\textcolor{${mu}}{\mu_0}\textcolor{${J}}{\vec{J}}+\textcolor{${mu}}{\mu_0\epsilon_0}\frac{\partial\textcolor{${E}}{\vec{E}}}{\partial t}`,document.getElementById('eq-ampere'),o);

  // The point magnetic-dipole field. This is the exact formula the simulator
  // sums over every pole, so this line documents the physics main.js computes.
  katex.render(String.raw`\textcolor{${B}}{\vec{B}}(\vec{r})=\frac{\textcolor{${mu}}{\mu_0}}{4\pi}\frac{3(\textcolor{${m}}{\vec{m}}\cdot\hat{r})\hat{r}-\textcolor{${m}}{\vec{m}}}{r^3}`,document.getElementById('eq-dipole'),o);

  // Collapse toggle: clicking the header folds the panel and flips the arrow
  // glyph between down (collapsed) and up (expanded).
  document.getElementById('eq-toggle').addEventListener('click',()=>{
    const p=document.getElementById('eq-panel');
    const c=p.classList.toggle('collapsed');
    p.querySelector('.arrow').textContent=c?'▼':'▲';
  });
})();
