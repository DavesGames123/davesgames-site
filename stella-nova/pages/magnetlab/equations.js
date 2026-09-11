(function(){
  if(!window.katex) return;
  const B='#60e0ee',E='#ffc832',J='#ffb84d',mu='#c890ff',op='#96c8ff',m='#ff9050';
  const o={throwOnError:false,displayMode:true};
  katex.render(String.raw`\textcolor{${op}}{\nabla}\cdot\textcolor{${B}}{\vec{B}}=0`,document.getElementById('eq-gauss-b'),o);
  katex.render(String.raw`\textcolor{${op}}{\nabla}\times\textcolor{${B}}{\vec{B}}=\textcolor{${mu}}{\mu_0}\textcolor{${J}}{\vec{J}}+\textcolor{${mu}}{\mu_0\epsilon_0}\frac{\partial\textcolor{${E}}{\vec{E}}}{\partial t}`,document.getElementById('eq-ampere'),o);
  katex.render(String.raw`\textcolor{${B}}{\vec{B}}(\vec{r})=\frac{\textcolor{${mu}}{\mu_0}}{4\pi}\frac{3(\textcolor{${m}}{\vec{m}}\cdot\hat{r})\hat{r}-\textcolor{${m}}{\vec{m}}}{r^3}`,document.getElementById('eq-dipole'),o);
  document.getElementById('eq-toggle').addEventListener('click',()=>{
    const p=document.getElementById('eq-panel');
    const c=p.classList.toggle('collapsed');
    p.querySelector('.arrow').textContent=c?'▼':'▲';
  });
})();
