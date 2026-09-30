// ============================================================================
//  WAVE MEMBRANE  ·  equation renderer
// ----------------------------------------------------------------------------
//  Renders the two equations in #eqPanel with KaTeX, and wires the collapse
//  toggle of that panel. The markup already holds a plain Unicode copy of each
//  equation. If the KaTeX library did not load, the plain copy stays.
//
//  SECTION MAP   (jump with grep -n "<anchor>" equations.js)
//  --------------------------------------------------------------------------
//      color palette ....... "C_u"        per-symbol tint constants
//      wave equation ....... "eq-wave"    the 2D wave equation
//      one-mode relation ... "eq-mode"    acceleration = -omega^2 * u
//      collapse toggle ..... "eqCollapse" show or hide the equation blocks
// ============================================================================
(function(){
  // Collapse toggle. On a phone the panel starts collapsed, so it does not
  // cover the membrane until the user opens it.
  const panel=document.getElementById('eqPanel'), btn=document.getElementById('eqCollapse');
  const setCollapsed=on=>{
    panel.classList.toggle('collapsed',on);
    btn.textContent=on?'▼':'▲';
    btn.title=btn.ariaLabel=on?'Expand equations':'Collapse equations';
  };
  setCollapsed(window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)').matches);
  btn.addEventListener('click',()=>setCollapsed(!panel.classList.contains('collapsed')));

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
    String.raw`\frac{\partial^2 \textcolor{${C_u}}{u}}{\partial t^2} \;=\; \textcolor{${C_c}}{c^2}\nabla^2\textcolor{${C_u}}{u} \;=\; -\textcolor{${C_w}}{\omega^2}\,\textcolor{${C_u}}{u}`,
    document.getElementById('eq-mode'), opts
  );
})();
