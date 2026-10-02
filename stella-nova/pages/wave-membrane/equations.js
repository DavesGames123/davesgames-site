// ============================================================================
//  WAVE MEMBRANE  ·  equation renderer
// ----------------------------------------------------------------------------
//  Typesets the two equations in #eqPanel, the slider symbols and the readout
//  symbols ([data-tex]) as MathJax SVG, and wires the collapse toggle of the
//  panel. lib/sci-math.js is an ES module; this classic script loads it with a
//  dynamic import(). If MathJax does not load, the TeX text stays in the box
//  with the class "raw".
//
//  SECTION MAP   (jump with grep -n "<anchor>" equations.js)
//  --------------------------------------------------------------------------
//      color map ........... "WM_RULES"   symbol -> .m1 to .m6
//      equations ........... "WM_EQ"      TeX of eq-wave and eq-mode
//      collapse toggle ..... "eqCollapse" show or hide the equation blocks
//      legend hook ......... "WM_MATH"    inline typeset for main.js
// ============================================================================
(function(){
  // Collapse toggle. On a phone the panel starts collapsed, so it does not
  // cover the membrane until the user opens it.
  const panel=document.getElementById('eqPanel'), btn=document.getElementById('eqCollapse');
  const setCollapsed=on=>{
    panel.classList.toggle('collapsed',on);
    btn.textContent=on?'▼':'▲';
    btn.title=btn.ariaLabel=on?'Expand equations':'Collapse equations';
  };
  setCollapsed(window.matchMedia('(max-width:768px), (max-height:500px) and (pointer:coarse)').matches);
  btn.addEventListener('click',()=>setCollapsed(!panel.classList.contains('collapsed')));

  // WM_RULES: displacement u m1, wave speed c m2, angular frequency omega m3,
  // amplitude A m4, energy E m5. The same classes color the slider labels and
  // the readout. Operators, t and pi keep the default color.
  const WM_RULES=[['u','m1'],['c','m2'],['\\omega','m3'],['A','m4'],['A_2','m4'],['E','m5']];
  // WM_EQ: the 2D wave equation, and one mode: acceleration = -omega^2 u.
  const WM_EQ={
    'eq-wave':String.raw`\nabla^2 u=\frac{1}{c^2}\,\frac{\partial^2 u}{\partial t^2}`,
    'eq-mode':String.raw`\frac{\partial^2 u}{\partial t^2}=c^2\nabla^2 u=-\omega^2 u`,
  };
  for(const id in WM_EQ){ const el=document.getElementById(id); el.classList.add('sci-eq'); el.dataset.tex=WM_EQ[id]; }
  const lib=import('../../lib/sci-math.js');
  lib.then(m=>m.typesetAll(document,WM_RULES)).catch(err=>console.error('[math]',err));
  // main.js typesets the legend title through this hook (inline, same rules).
  window.WM_MATH={typeset:(el,tex)=>lib.then(m=>m.typeset(el,tex,{display:false,rules:WM_RULES})).catch(()=>{el.textContent=tex;})};
})();
