// ============================================================================
//  FLUIDLAB · equations.js — render the Navier-Stokes panel with KaTeX
// ----------------------------------------------------------------------------
//  Typeset the four equations behind the solver into the #eq-* slots and wire
//  the collapse toggle. Colour is keyed to the same quantities the shaders use:
//  velocity u, pressure p, force f, the nabla operator, and viscosity nu.
//  Runs only if KaTeX loaded (it is a CDN dependency), and does nothing else.
//
//  EQUATIONS (in solver order)
//    eq-mom   momentum          eq-cont  incompressibility (div u = 0)
//    eq-pois  pressure Poisson  eq-corr  velocity correction (projection)
//
//  SECTION MAP   (jump with grep -n "<anchor>" equations.js)
//    colours ...... "const u="        per-quantity KaTeX colours
//    render ....... "katex.render"     typeset each equation slot
//    toggle ....... "eq-toggle"        collapse/expand the panel
// ============================================================================
// Bail if the KaTeX CDN script did not load. Colours match the shader quantities.
(function(){if(!window.katex)return;const u='#60e0ee',p='#ffc832',v='#ff9050',op='#96c8ff',mu='#c890ff';const o={throwOnError:false,displayMode:true};
// Momentum equation: advection, pressure gradient, viscous diffusion, and force.
katex.render(String.raw`\frac{\partial \textcolor{${u}}{\vec{u}}}{\partial t}+(\textcolor{${u}}{\vec{u}}\cdot\textcolor{${op}}{\nabla})\textcolor{${u}}{\vec{u}}=-\frac{1}{\rho}\textcolor{${op}}{\nabla}\textcolor{${p}}{p}+\textcolor{${mu}}{\nu}\textcolor{${op}}{\nabla}^2\textcolor{${u}}{\vec{u}}+\textcolor{${v}}{\vec{f}}`,document.getElementById('eq-mom'),o);
// Incompressibility: a divergence-free velocity field.
katex.render(String.raw`\textcolor{${op}}{\nabla}\cdot\textcolor{${u}}{\vec{u}}=0`,document.getElementById('eq-cont'),o);
// Pressure Poisson: the equation the jacobi stage solves (w is the intermediate velocity).
katex.render(String.raw`\textcolor{${op}}{\nabla}^2\textcolor{${p}}{p}=\frac{\rho}{\Delta t}\textcolor{${op}}{\nabla}\cdot\textcolor{${u}}{\vec{w}}`,document.getElementById('eq-pois'),o);
// Velocity correction: subtract the pressure gradient (the gradient stage).
katex.render(String.raw`\textcolor{${u}}{\vec{u}}=\textcolor{${u}}{\vec{w}}-\frac{\Delta t}{\rho}\textcolor{${op}}{\nabla}\textcolor{${p}}{p}`,document.getElementById('eq-corr'),o);
// Collapse/expand the equation panel and flip its arrow.
document.getElementById('eq-toggle').addEventListener('click',()=>{const el=document.getElementById('eq-panel');const c=el.classList.toggle('collapsed');el.querySelector('.arrow').textContent=c?'▼':'▲';});})();
