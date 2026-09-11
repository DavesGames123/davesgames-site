/* KaTeX color-coded equations
   F → cyan, G → yellow, m/M → orange, r → blue, v → green,
   K → blue, U → red, E → yellow, L → magenta, T → yellow, a → orange */
(function(){
  if(!window.katex) return;
  const C_F='#5cd8e8', C_G='#ffc832', C_m='#ff9050', C_r='#96c8ff',
        C_v='#7ad87a', C_K='#96c8ff', C_U='#e87466', C_E='#ffc832',
        C_L='#d870c8', C_T='#ffc832', C_a='#ff9050';
  const opts={throwOnError:false,displayMode:true};
  katex.render(
    String.raw`\textcolor{${C_F}}{F} \;=\; \textcolor{${C_G}}{G}\,\frac{\textcolor{${C_m}}{m_1}\,\textcolor{${C_m}}{m_2}}{\textcolor{${C_r}}{r^{2}}}`,
    document.getElementById('eq-newton'), opts
  );
  katex.render(
    String.raw`\textcolor{${C_E}}{E} \;=\; \underbrace{\tfrac{1}{2}\textcolor{${C_m}}{m}\,\textcolor{${C_v}}{v^{2}}}_{\textcolor{${C_K}}{K}} \;-\; \underbrace{\textcolor{${C_G}}{G}\,\tfrac{\textcolor{${C_m}}{m_1}\textcolor{${C_m}}{m_2}}{\textcolor{${C_r}}{r}}}_{\textcolor{${C_U}}{U}}`,
    document.getElementById('eq-energy'), opts
  );
  katex.render(
    String.raw`\textcolor{${C_L}}{L} \;=\; \textcolor{${C_m}}{m}\,\textcolor{${C_v}}{v}\,\textcolor{${C_r}}{r}\,\sin\theta`,
    document.getElementById('eq-angmom'), opts
  );
  katex.render(
    String.raw`\frac{dA}{dt} \;=\; \frac{\textcolor{${C_L}}{L}}{2\,\textcolor{${C_m}}{m}} \;=\; \text{const}`,
    document.getElementById('eq-kepler2'), opts
  );
  katex.render(
    String.raw`\textcolor{${C_T}}{T}^{2} \;=\; \frac{4\pi^{2}}{\textcolor{${C_G}}{G}\,\textcolor{${C_m}}{M}}\,\textcolor{${C_a}}{a}^{3}`,
    document.getElementById('eq-kepler3'), opts
  );
  const panel=document.getElementById('eqPanel');
  const btn=document.getElementById('eqCollapseBtn');
  btn.addEventListener('click',()=>{
    const c=panel.classList.toggle('collapsed');
    btn.innerHTML=c?'&#9660;':'&#9650;';
    btn.title=c?'Expand':'Collapse';
  });
})();
