// ============================================================================
//  equations.js · rendered reference equations + mobile drawer toggles
// ----------------------------------------------------------------------------
//  A classic script loaded before main.js. On load it renders the molecular-
//  orbital equations into the info panel with KaTeX, colour-coding each symbol
//  so the maths matches the on-screen legend. It also defines the mobile drawer
//  open/close helpers used by the inline onclick handlers in index.html.
//
//  SECTION MAP  (jump with grep -n "<anchor>" equations.js)
//      equation render ...... "katex.render"       colour-coded LaTeX into #eq-*
//      panel collapse ....... "eqCollapseBtn"      show/hide the equation panel
//      drawer toggles ....... "function toggleDrawer"  mobile side panels
// ============================================================================
// Render the equations once the page and KaTeX have loaded.
(function(){
  // Bail if KaTeX failed to load; the page still runs without the equations.
  if(!window.katex) return;
  // Per-symbol colours, matched to the simulator legend (ψ, φ, E, R, Z, S, J/K).
  const C_psi='#7ad87a', C_phi='#7ad87a', C_E='#ffc832', C_R='#96c8ff',
        C_Z='#ff9050', C_S='#d870c8', C_JK='#d870c8', C_N='#dde3f0';
  const opts={throwOnError:false,displayMode:true};

  // LCAO: ψ_± = N (φ_A ± φ_B)
  katex.render(
    String.raw`\textcolor{${C_psi}}{\psi_\pm} \;=\; N_\pm\!\left(\,\textcolor{${C_phi}}{\varphi_A} \pm \textcolor{${C_phi}}{\varphi_B}\,\right)`,
    document.getElementById('eq-lcao'), opts
  );
  // Normalization
  katex.render(
    String.raw`N_\pm \;=\; \dfrac{1}{\sqrt{\,2 \pm 2\,\textcolor{${C_S}}{S}\,}}`,
    document.getElementById('eq-norm'), opts
  );

  // Hydrogen-like AO: φ = Z^(3/2) R(Zr) Y
  katex.render(
    String.raw`\textcolor{${C_phi}}{\varphi_{n\ell m}(\mathbf r)} \;=\; \textcolor{${C_Z}}{Z}^{3/2}\,R_{n\ell}\!\left(\textcolor{${C_Z}}{Z}\,r\right)\,Y_{\ell m}(\theta,\phi)`,
    document.getElementById('eq-ao'), opts
  );

  // H2+ bonding energy
  katex.render(
    String.raw`\textcolor{${C_E}}{E_+} \;=\; -\tfrac{1}{2} + \dfrac{1}{\textcolor{${C_R}}{R}} + \dfrac{\textcolor{${C_JK}}{J} + \textcolor{${C_JK}}{K}}{1 + \textcolor{${C_S}}{S}}`,
    document.getElementById('eq-eplus'), opts
  );
  // Overlap integral
  katex.render(
    String.raw`\textcolor{${C_S}}{S(R)} \;=\; e^{-\textcolor{${C_R}}{R}}\!\left(1 + \textcolor{${C_R}}{R} + \tfrac{\textcolor{${C_R}}{R}^{\,2}}{3}\right)`,
    document.getElementById('eq-overlap'), opts
  );

  // Collapse toggle: fold the equation panel and flip the caret glyph.
  const panel=document.getElementById('eqPanel');
  const btn=document.getElementById('eqCollapseBtn');
  btn.addEventListener('click',()=>{
    const c=panel.classList.toggle('collapsed');
    btn.innerHTML=c?'&#9660;':'&#9650;';
    btn.title=c?'Expand':'Collapse';
  });
})();

// Drawer toggles (mobile)
// Open or close one side drawer (a or b), closing the other first so only one
// is open at a time, and toggle the shared backdrop.
function toggleDrawer(which){
  const p=document.getElementById('panel-'+which);
  const fab=document.getElementById('fab'+which.toUpperCase());
  const bd=document.getElementById('drawerBackdrop');
  // Close the other drawer first
  const other=which==='a'?'b':'a';
  document.getElementById('panel-'+other).classList.remove('open');
  document.getElementById('fab'+other.toUpperCase()).classList.remove('open');
  const open=!p.classList.contains('open');
  p.classList.toggle('open',open);
  fab.classList.toggle('open',open);
  bd.classList.toggle('show',open);
}
// Force both drawers and the backdrop closed (used after loading a preset).
function closeDrawers(){
  document.getElementById('panel-a').classList.remove('open');
  document.getElementById('panel-b').classList.remove('open');
  document.getElementById('fabA').classList.remove('open');
  document.getElementById('fabB').classList.remove('open');
  document.getElementById('drawerBackdrop').classList.remove('show');
}
