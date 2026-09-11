// ============================================================================
//  HOHMANN · KaTeX reference equations
// ----------------------------------------------------------------------------
//  Static helper that renders the five Hohmann formulas into the floating
//  equation panel (the eq-* elements defined in index.html). Each variable is
//  colour-coded so the same colours match the live math panel in main.js. This
//  file only draws the reference forms; main.js fills the panel with live values
//  once a transfer is computed. Runs as an IIFE, and no-ops if KaTeX is absent.
//
//  Equations rendered: vis-viva, transfer semi-major axis a_t, the two burns
//  Δv1/Δv2, transfer time t_tr, and the required phase angle phi_req.
// ============================================================================
/* ═════════════════════════════════════════════════════════════
   KaTeX color-coded reference equations
   μ → yellow      r → blue       v → green
   a → orange      Δv → cyan      t,T → yellow
   φ → magenta     ω → magenta
   ═════════════════════════════════════════════════════════════ */
(function(){
  // Bail out quietly if the KaTeX library failed to load.
  if(!window.katex) return;
  // One colour per variable, shared with the live panel's palette (CC in main.js).
  const C_mu='#ffc832', C_r='#96c8ff', C_v='#7ad87a', C_a='#ff9050',
        C_dv='#5cd8e8', C_t='#ffc832', C_phi='#d870c8', C_om='#d870c8';
  // Render each formula in display mode; never throw on a malformed string.
  const opts={throwOnError:false,displayMode:true};

  // Vis-viva: speed on any conic at radius r.
  katex.render(
    String.raw`\textcolor{${C_v}}{v} \;=\; \sqrt{\textcolor{${C_mu}}{\mu}\!\left(\frac{2}{\textcolor{${C_r}}{r}} - \frac{1}{\textcolor{${C_a}}{a}}\right)}`,
    document.getElementById('eq-visviva'), opts
  );
  // Transfer semi-major axis: mean of the two orbital radii.
  katex.render(
    String.raw`\textcolor{${C_a}}{a_t} \;=\; \frac{\textcolor{${C_r}}{r_1} + \textcolor{${C_r}}{r_2}}{2}`,
    document.getElementById('eq-atransfer'), opts
  );
  // First burn: speed jump between transfer and circular speed at r1.
  katex.render(
    String.raw`\textcolor{${C_dv}}{\Delta v_1} \;=\; \left|\,\textcolor{${C_v}}{v_t(r_1)} - \textcolor{${C_v}}{v_c(r_1)}\,\right|`,
    document.getElementById('eq-dv1'), opts
  );
  // Second burn: speed jump at r2 to circularise.
  katex.render(
    String.raw`\textcolor{${C_dv}}{\Delta v_2} \;=\; \left|\,\textcolor{${C_v}}{v_t(r_2)} - \textcolor{${C_v}}{v_c(r_2)}\,\right|`,
    document.getElementById('eq-dv2'), opts
  );
  // Transfer time: half the ellipse period.
  katex.render(
    String.raw`\textcolor{${C_t}}{t_{tr}} \;=\; \pi\sqrt{\frac{\textcolor{${C_a}}{a_t}^{3}}{\textcolor{${C_mu}}{\mu}}}`,
    document.getElementById('eq-time'), opts
  );
  // Required phase angle: target lead so it meets the ship at arrival.
  katex.render(
    String.raw`\textcolor{${C_phi}}{\varphi_{\text{req}}} \;=\; \pi - \textcolor{${C_om}}{\omega_{\text{tgt}}}\cdot\textcolor{${C_t}}{t_{tr}}`,
    document.getElementById('eq-phi'), opts
  );

  // Wire the panel collapse button, swapping the caret glyph and tooltip.
  const panel=document.getElementById('eqPanel');
  const btn=document.getElementById('eqCollapseBtn');
  btn.addEventListener('click',()=>{
    const c=panel.classList.toggle('collapsed');
    btn.innerHTML=c?'&#9660;':'&#9650;';
    btn.title=c?'Expand':'Collapse';
  });
})();
