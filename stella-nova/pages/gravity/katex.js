// ============================================================================
//  GRAVITY PLAYGROUND  ·  equation panel renderer
// ----------------------------------------------------------------------------
//  Renders the five governing equations of the sim into their placeholder <div>s
//  with KaTeX, colour-coding each symbol to match the vectors and readouts drawn
//  by main.js (force cyan, velocity green, mass orange, and so on). Wires the
//  panel's collapse button. Runs once as an IIFE; a no-op if KaTeX is absent.
//
//  SECTION MAP   (jump with grep -n "<anchor>" katex.js)
//  ---------------------------------------------------------------------------
//      symbol colours .... "const C_F"          per-symbol hex, keyed to main.js
//      Newton ............ "eq-newton"          inverse-square force law
//      energy ............ "eq-energy"          E = K − U
//      ang. momentum ..... "eq-angmom"          L = m·v·r·sinθ
//      Kepler II ......... "eq-kepler2"         equal areas, dA/dt = const
//      Kepler III ........ "eq-kepler3"         T² ∝ a³
//      collapse toggle ... "eqCollapseBtn"      show/hide the panel
// ============================================================================

/* KaTeX color-coded equations
   F → cyan, G → yellow, m/M → orange, r → blue, v → green,
   K → blue, U → red, E → yellow, L → magenta, T → yellow, a → orange */
(function(){
  // Skip silently if the KaTeX library failed to load from the CDN.
  if(!window.katex) return;
  // One hex per physical symbol; these match the colours main.js uses on canvas.
  const C_F='#5cd8e8', C_G='#ffc832', C_m='#ff9050', C_r='#96c8ff',
        C_v='#7ad87a', C_K='#96c8ff', C_U='#e87466', C_E='#ffc832',
        C_L='#d870c8', C_T='#ffc832', C_a='#ff9050';
  // Render options: never throw on a bad expression, and use block (display) mode.
  const opts={throwOnError:false,displayMode:true};
  // Newton's law of gravitation: the inverse-square force between two masses.
  katex.render(
    String.raw`\textcolor{${C_F}}{F} \;=\; \textcolor{${C_G}}{G}\,\frac{\textcolor{${C_m}}{m_1}\,\textcolor{${C_m}}{m_2}}{\textcolor{${C_r}}{r^{2}}}`,
    document.getElementById('eq-newton'), opts
  );
  // Total energy: kinetic K minus gravitational potential U, the conserved sum.
  katex.render(
    String.raw`\textcolor{${C_E}}{E} \;=\; \underbrace{\tfrac{1}{2}\textcolor{${C_m}}{m}\,\textcolor{${C_v}}{v^{2}}}_{\textcolor{${C_K}}{K}} \;-\; \underbrace{\textcolor{${C_G}}{G}\,\tfrac{\textcolor{${C_m}}{m_1}\textcolor{${C_m}}{m_2}}{\textcolor{${C_r}}{r}}}_{\textcolor{${C_U}}{U}}`,
    document.getElementById('eq-energy'), opts
  );
  // Angular momentum magnitude for a body about the origin.
  katex.render(
    String.raw`\textcolor{${C_L}}{L} \;=\; \textcolor{${C_m}}{m}\,\textcolor{${C_v}}{v}\,\textcolor{${C_r}}{r}\,\sin\theta`,
    document.getElementById('eq-angmom'), opts
  );
  // Kepler II: the areal velocity is constant, equivalent to conserved L.
  katex.render(
    String.raw`\frac{dA}{dt} \;=\; \frac{\textcolor{${C_L}}{L}}{2\,\textcolor{${C_m}}{m}} \;=\; \text{const}`,
    document.getElementById('eq-kepler2'), opts
  );
  // Kepler III: orbital period squared scales with semi-major axis cubed.
  katex.render(
    String.raw`\textcolor{${C_T}}{T}^{2} \;=\; \frac{4\pi^{2}}{\textcolor{${C_G}}{G}\,\textcolor{${C_m}}{M}}\,\textcolor{${C_a}}{a}^{3}`,
    document.getElementById('eq-kepler3'), opts
  );
  // Collapse toggle: flip the panel's collapsed class and swap the caret glyph.
  const panel=document.getElementById('eqPanel');
  const btn=document.getElementById('eqCollapseBtn');
  btn.addEventListener('click',()=>{
    const c=panel.classList.toggle('collapsed');
    btn.innerHTML=c?'&#9660;':'&#9650;';
    btn.title=c?'Expand':'Collapse';
  });
})();
