(function(){
  if(!window.katex) return;
  const B='#60e0ee',I='#64c864',mu='#c890ff',op='#96c8ff',r='#ff9050',sum='#ffb84d';
  const o={throwOnError:false,displayMode:true};
  const eq1 = `\\textcolor{${B}}{\\vec{B}}(\\vec{r}) \\;=\\; \\frac{\\textcolor{${mu}}{\\mu_0}}{4\\pi} \\int_C \\frac{\\textcolor{${I}}{I}\\,d\\vec{\\ell} \\times \\hat{s}}{s^{2}}`;
  const eq2 = `\\textcolor{${B}}{\\vec{B}} \\;=\\; \\frac{\\textcolor{${mu}}{\\mu_0}\\;\\textcolor{${I}}{I}}{2\\pi\\;\\textcolor{${r}}{r}}\\;\\hat{\\varphi}`;
  const eq3 = `\\textcolor{${B}}{\\vec{B}}_{\\text{total}} \\;=\\; \\textcolor{${sum}}{\\sum_i}\\;\\frac{\\textcolor{${mu}}{\\mu_0}\\;\\textcolor{${I}}{I_i}}{2\\pi\\;\\textcolor{${r}}{r_i}}\\;\\hat{\\varphi}_i`;
  katex.render(eq1, document.getElementById('eq-bs'), o);
  katex.render(eq2, document.getElementById('eq-wire'), o);
  katex.render(eq3, document.getElementById('eq-super'), o);
  document.getElementById('eq-toggle').addEventListener('click',()=>{
    const p=document.getElementById('eq-panel');
    const c=p.classList.toggle('collapsed');
    p.querySelector('.arrow').textContent=c?'▼':'▲';
  });
})();
