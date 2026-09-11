(function(){
  if(!window.katex) return;
  const C_psi='#ffc832', C_c='#64c864', C_a='#ff6b6b', C_lam='#96c8ff';
  const opts={throwOnError:false,displayMode:true};
  katex.render(
    String.raw`\frac{\partial^2 \textcolor{${C_psi}}{\psi}}{\partial t^2} \;=\; \textcolor{${C_c}}{c^2}\,\nabla^2\textcolor{${C_psi}}{\psi}`,
    document.getElementById('eq-wave'), opts
  );
  katex.render(
    String.raw`\textcolor{${C_psi}}{\psi^{n\!+\!1}} \!=\! 2\textcolor{${C_psi}}{\psi^n} \!-\! \textcolor{${C_psi}}{\psi^{n\!-\!1}} \!+\! \textcolor{${C_a}}{\alpha^2}\nabla^2\textcolor{${C_psi}}{\psi^n}`,
    document.getElementById('eq-fdtd'), opts
  );
  katex.render(
    String.raw`\textcolor{${C_a}}{\alpha} = \tfrac{c\,\Delta t}{\Delta x} \leq \tfrac{1}{\sqrt{2}}\;\;\;\; 3\!\times\!\textcolor{${C_lam}}{\lambda_{\scriptscriptstyle R,G,B}}`,
    document.getElementById('eq-rgb'), opts
  );
  const panel=document.getElementById('eq-panel');
  const btn=document.getElementById('eq-collapse-btn');
  btn.addEventListener('click',()=>{
    const c=panel.classList.toggle('collapsed');
    btn.textContent=c?'▼':'▲';
    btn.title=c?'Expand':'Collapse';
  });
})();
