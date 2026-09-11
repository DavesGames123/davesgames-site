(function(){if(!window.katex)return;const E='#ffc832',H='#60e0ee',T='#ff9050',F='#c890ff',K='#64c864',o={throwOnError:false,displayMode:true};window._C={E,H,T,F,K};window._ko=o;
katex.render(String.raw`\textcolor{${F}}{\nabla^2}\textcolor{${E}}{E} + \textcolor{${K}}{k}^2 \textcolor{${E}}{E} = 0 \,,\qquad \textcolor{${K}}{k} = \dfrac{2\pi}{\lambda}`,document.getElementById('eq-helm'),o);
katex.render(String.raw`\textcolor{${E}}{E}(z) = \textcolor{${F}}{\mathcal{F}^{-1}}\!\left\{ \textcolor{${F}}{\mathcal{F}}\!\left\{ \textcolor{${T}}{t} \cdot \textcolor{${E}}{E_0} \right\} \cdot e^{\,i\,\textcolor{${K}}{k_z}\, z} \right\}`,document.getElementById('eq-asm'),o);
katex.render(String.raw`\textcolor{${T}}{t} = \begin{cases} 1 & |x| + |y|\,/\sqrt{3} \le R \\ 0 & \text{otherwise} \end{cases}`,document.getElementById('eq-trans'),o);
katex.render(String.raw`\textcolor{red}{R},\,\textcolor{green}{G},\,\textcolor{${H}}{B} \;=\; \gamma\!\!\left(\, \mathbf{M} \!\int_{\lambda} S(\lambda)\; \textcolor{${E}}{I}(\lambda)\; [\bar{x},\,\bar{y},\,\bar{z}]\; d\lambda \,\right)`,document.getElementById('eq-cie'),o);
document.getElementById('eq-collapse-btn').addEventListener('click',()=>{const p=document.getElementById('eq-panel'),c=p.classList.toggle('collapsed');document.getElementById('eq-collapse-btn').textContent=c?'▼':'▲'});
})();
