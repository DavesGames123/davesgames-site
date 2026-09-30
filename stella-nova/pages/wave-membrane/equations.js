// ============================================================================
//  WAVE MEMBRANE  ·  equation renderer
// ----------------------------------------------------------------------------
//  Renders the two equations in the READOUT section with KaTeX. The markup
//  already holds a plain Unicode copy of each equation. If the KaTeX library
//  did not load, this script does nothing and the plain copy stays.
//
//  SECTION MAP   (jump with grep -n "<anchor>" equations.js)
//  --------------------------------------------------------------------------
//      color palette ....... "C_u"        per-symbol tint constants
//      wave equation ....... "eq-wave"    the 2D wave equation
//      one-mode relation ... "eq-mode"    acceleration = -omega^2 * u
// ============================================================================
(function(){
  if(!window.katex) return;
  // Symbol tints: displacement warm, wave speed pink, omega pale yellow.
  const C_u='#fca35e', C_c='#cd4071', C_w='#fcfdbf';
  const opts={throwOnError:false,displayMode:true};
  // The 2D wave equation, in the form the page title uses.
  katex.render(
    String.raw`\nabla^2 \textcolor{${C_u}}{u} \;=\; \frac{1}{\textcolor{${C_c}}{c^2}}\,\frac{\partial^2 \textcolor{${C_u}}{u}}{\partial t^2}`,
    document.getElementById('eq-wave'), opts
  );
  // For one mode, the acceleration is the displacement times -omega^2.
  katex.render(
    String.raw`\frac{\partial^2 \textcolor{${C_u}}{u}}{\partial t^2} \;=\; \textcolor{${C_c}}{c^2}\nabla^2\textcolor{${C_u}}{u} \;=\; -\textcolor{${C_w}}{\omega^2}\,\textcolor{${C_u}}{u}\quad\text{\small(one mode)}`,
    document.getElementById('eq-mode'), opts
  );
})();
