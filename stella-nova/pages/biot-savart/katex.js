// ============================================================================
//  BIOT-SAVART  ·  equation-panel renderer (KaTeX helper)
// ----------------------------------------------------------------------------
//  Renders the three formulas in the collapsible equation panel and wires its
//  collapse toggle. Runs once as an IIFE after the KaTeX CDN script loads. Each
//  symbol is tinted to match the color the same quantity uses on the canvas, so
//  the math and the drawing share a legend.
//
//  SECTION MAP   (jump with grep -n "<anchor>" katex.js)
//  ---------------------------------------------------------------------------
//      color legend ......... "const B="        per-symbol tint hex codes
//      formulas ............. "eq1"             general law, wire, superposition
//      render ............... "katex.render"    inject each formula into the DOM
//      collapse toggle ...... "eq-toggle"       show/hide the panel
// ============================================================================
(function(){
  // Bail if the KaTeX CDN script did not load; the panel just stays empty.
  if(!window.katex) return;
  // Symbol tints, matched to the canvas: B field, current I, μ₀, an operator
  // color, radius r, and the summation sign.
  const B='#60e0ee',I='#64c864',mu='#c890ff',op='#96c8ff',r='#ff9050',sum='#ffb84d';
  // Shared render options: never throw on a bad macro, render as display math.
  const o={throwOnError:false,displayMode:true};
  // General Biot-Savart line integral over a current path C.
  const eq1 = `\\textcolor{${B}}{\\vec{B}}(\\vec{r}) \\;=\\; \\frac{\\textcolor{${mu}}{\\mu_0}}{4\\pi} \\int_C \\frac{\\textcolor{${I}}{I}\\,d\\vec{\\ell} \\times \\hat{s}}{s^{2}}`;
  // Closed form for one infinite straight wire (what the sim actually computes).
  const eq2 = `\\textcolor{${B}}{\\vec{B}} \\;=\\; \\frac{\\textcolor{${mu}}{\\mu_0}\\;\\textcolor{${I}}{I}}{2\\pi\\;\\textcolor{${r}}{r}}\\;\\hat{\\varphi}`;
  // Superposition: total field is the sum of each wire's contribution.
  const eq3 = `\\textcolor{${B}}{\\vec{B}}_{\\text{total}} \\;=\\; \\textcolor{${sum}}{\\sum_i}\\;\\frac{\\textcolor{${mu}}{\\mu_0}\\;\\textcolor{${I}}{I_i}}{2\\pi\\;\\textcolor{${r}}{r_i}}\\;\\hat{\\varphi}_i`;
  // Inject each formula into its target element.
  katex.render(eq1, document.getElementById('eq-bs'), o);
  katex.render(eq2, document.getElementById('eq-wire'), o);
  katex.render(eq3, document.getElementById('eq-super'), o);
  // Collapse/expand the equation panel, flipping the arrow glyph to match.
  document.getElementById('eq-toggle').addEventListener('click',()=>{
    const p=document.getElementById('eq-panel');
    const c=p.classList.toggle('collapsed');
    p.querySelector('.arrow').textContent=c?'▼':'▲';
  });
})();
