/* ═════════════════════════════════════════════════════════════
   KaTeX color-coded reference equations
   μ → yellow      r → blue       v → green
   a → orange      Δv → cyan      t,T → yellow
   φ → magenta     ω → magenta
   ═════════════════════════════════════════════════════════════ */
(function(){
  if(!window.katex) return;
  const C_mu='#ffc832', C_r='#96c8ff', C_v='#7ad87a', C_a='#ff9050',
        C_dv='#5cd8e8', C_t='#ffc832', C_phi='#d870c8', C_om='#d870c8';
  const opts={throwOnError:false,displayMode:true};

  katex.render(
    String.raw`\textcolor{${C_v}}{v} \;=\; \sqrt{\textcolor{${C_mu}}{\mu}\!\left(\frac{2}{\textcolor{${C_r}}{r}} - \frac{1}{\textcolor{${C_a}}{a}}\right)}`,
    document.getElementById('eq-visviva'), opts
  );
  katex.render(
    String.raw`\textcolor{${C_a}}{a_t} \;=\; \frac{\textcolor{${C_r}}{r_1} + \textcolor{${C_r}}{r_2}}{2}`,
    document.getElementById('eq-atransfer'), opts
  );
  katex.render(
    String.raw`\textcolor{${C_dv}}{\Delta v_1} \;=\; \left|\,\textcolor{${C_v}}{v_t(r_1)} - \textcolor{${C_v}}{v_c(r_1)}\,\right|`,
    document.getElementById('eq-dv1'), opts
  );
  katex.render(
    String.raw`\textcolor{${C_dv}}{\Delta v_2} \;=\; \left|\,\textcolor{${C_v}}{v_t(r_2)} - \textcolor{${C_v}}{v_c(r_2)}\,\right|`,
    document.getElementById('eq-dv2'), opts
  );
  katex.render(
    String.raw`\textcolor{${C_t}}{t_{tr}} \;=\; \pi\sqrt{\frac{\textcolor{${C_a}}{a_t}^{3}}{\textcolor{${C_mu}}{\mu}}}`,
    document.getElementById('eq-time'), opts
  );
  katex.render(
    String.raw`\textcolor{${C_phi}}{\varphi_{\text{req}}} \;=\; \pi - \textcolor{${C_om}}{\omega_{\text{tgt}}}\cdot\textcolor{${C_t}}{t_{tr}}`,
    document.getElementById('eq-phi'), opts
  );

  const panel=document.getElementById('eqPanel');
  const btn=document.getElementById('eqCollapseBtn');
  btn.addEventListener('click',()=>{
    const c=panel.classList.toggle('collapsed');
    btn.innerHTML=c?'&#9660;':'&#9650;';
    btn.title=c?'Expand':'Collapse';
  });
})();
