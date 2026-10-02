// ============================================================================
//  FLUIDLAB · equations.js — typeset the Navier-Stokes panel as MathJax SVG
// ----------------------------------------------------------------------------
//  Typeset the four equations behind the solver into the #eq-* slots, and the
//  viscosity symbol of the slider label, then wire the collapse toggle.
//  lib/sci-math.js is an ES module; this classic script loads it with a
//  dynamic import(). If MathJax does not load, the TeX text stays in the slot
//  with the class "raw".
//
//  EQUATIONS (in solver order)
//    eq-mom   momentum          eq-cont  incompressibility (div u = 0)
//    eq-pois  pressure Poisson  eq-corr  velocity correction (projection)
//
//  SECTION MAP   (jump with grep -n "<anchor>" equations.js)
//    colors ....... "FL_RULES"        TeX symbol -> .m1 to .m6
//    equations .... "FL_EQ"           TeX of each slot
//    typeset ...... "sci-math.js"     typeset the slots and [data-tex]
//    toggle ....... "eq-toggle"       collapse/expand the panel
// ============================================================================
(function(){
// FL_RULES: the same color map as every Navier-Stokes page (widgets/ns):
// u velocity m1, p pressure m2, nu viscosity m3, rho density m5, f forcing
// m6. w is the intermediate velocity, so it uses the velocity class m1.
const FL_RULES=[['u','m1'],['w','m1'],['p','m2'],['\\nu','m3'],['\\rho','m5'],['f','m6']];
// FL_EQ: slot id -> TeX. Momentum: advection, pressure gradient, viscous
// diffusion and force. Incompressibility. Pressure Poisson (the jacobi
// stage). Velocity correction (the gradient stage).
const FL_EQ={
  'eq-mom': String.raw`\frac{\partial\vec{u}}{\partial t}+(\vec{u}\cdot\nabla)\vec{u}=-\frac{1}{\rho}\nabla p+\nu\nabla^2\vec{u}+\vec{f}`,
  'eq-cont':String.raw`\nabla\cdot\vec{u}=0`,
  'eq-pois':String.raw`\nabla^2 p=\frac{\rho}{\Delta t}\nabla\cdot\vec{w}`,
  'eq-corr':String.raw`\vec{u}=\vec{w}-\frac{\Delta t}{\rho}\nabla p`,
};
for(const id in FL_EQ){ const el=document.getElementById(id); el.classList.add('sci-eq'); el.dataset.tex=FL_EQ[id]; }
// Typeset the four slots (display) and the [data-inline] slider symbol.
import('../../lib/sci-math.js').then(m=>m.typesetAll(document,FL_RULES)).catch(err=>console.error('[math]',err));
// Collapse/expand the equation panel and flip its arrow.
document.getElementById('eq-toggle').addEventListener('click',()=>{const el=document.getElementById('eq-panel');const c=el.classList.toggle('collapsed');el.querySelector('.arrow').textContent=c?'▼':'▲';});})();
