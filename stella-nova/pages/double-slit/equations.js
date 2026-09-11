// ============================================================================
//  DOUBLE-SLIT  ·  equation panel renderer
// ----------------------------------------------------------------------------
//  Renders the three governing equations shown in the floating panel with KaTeX,
//  color-coding each symbol to match the sim's channel and field colors. Also
//  wires the panel's collapse button. Self-invoking; bails out quietly if the
//  KaTeX library did not load.
//
//  SECTION MAP   (jump with grep -n "<anchor>" equations.js)
//  --------------------------------------------------------------------------
//      color palette ....... "C_psi"          per-symbol tint constants
//      wave equation ....... "eq-wave"         the scalar wave PDE
//      FDTD update ......... "eq-fdtd"         the discretized leapfrog step
//      stability ........... "eq-rgb"          Courant limit and RGB channels
//      collapse toggle ..... "eq-collapse-btn" show/hide the panel
// ============================================================================
(function(){
  // Do nothing if KaTeX is unavailable, so the page still runs without the CDN.
  if(!window.katex) return;
  // Symbol tints: psi field amber, wave speed green, Courant α red, wavelength blue.
  const C_psi='#ffc832', C_c='#64c864', C_a='#ff6b6b', C_lam='#96c8ff';
  const opts={throwOnError:false,displayMode:true};
  // Scalar wave equation: second time derivative equals c² times the Laplacian.
  katex.render(
    String.raw`\frac{\partial^2 \textcolor{${C_psi}}{\psi}}{\partial t^2} \;=\; \textcolor{${C_c}}{c^2}\,\nabla^2\textcolor{${C_psi}}{\psi}`,
    document.getElementById('eq-wave'), opts
  );
  // Leapfrog discretization: the explicit three-slice update the sim steps.
  katex.render(
    String.raw`\textcolor{${C_psi}}{\psi^{n\!+\!1}} \!=\! 2\textcolor{${C_psi}}{\psi^n} \!-\! \textcolor{${C_psi}}{\psi^{n\!-\!1}} \!+\! \textcolor{${C_a}}{\alpha^2}\nabla^2\textcolor{${C_psi}}{\psi^n}`,
    document.getElementById('eq-fdtd'), opts
  );
  // Stability limit α ≤ 1/√2 for the 2D scheme, and the three RGB wavelengths.
  katex.render(
    String.raw`\textcolor{${C_a}}{\alpha} = \tfrac{c\,\Delta t}{\Delta x} \leq \tfrac{1}{\sqrt{2}}\;\;\;\; 3\!\times\!\textcolor{${C_lam}}{\lambda_{\scriptscriptstyle R,G,B}}`,
    document.getElementById('eq-rgb'), opts
  );
  // Collapse toggle: fold the panel and flip the caret and its tooltip.
  const panel=document.getElementById('eq-panel');
  const btn=document.getElementById('eq-collapse-btn');
  btn.addEventListener('click',()=>{
    const c=panel.classList.toggle('collapsed');
    btn.textContent=c?'▼':'▲';
    btn.title=c?'Expand':'Collapse';
  });
})();
