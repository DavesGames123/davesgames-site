// ============================================================================
//  HYDROGEN TABLE  ·  equation renderer
// ----------------------------------------------------------------------------
//  Renders the wave function in the header with KaTeX. The markup already
//  holds a plain Unicode copy of each formula. If the KaTeX library did not
//  load, this script does nothing and the plain copy stays.
//
//  window.HydEq.setKind(kind) swaps the second line. Complex tiles show rho
//  and E_n. Real tiles show how a real orbital comes from Y_l^|m|.
//
//  SECTION MAP   (jump with grep -n "<anchor>" equations.js)
//      wave function ....... "eqPsi"     psi_nlm = R_nl * Y_lm, in full
//      second line ......... "eqRho"     rho and E_n, or the real mix
// ============================================================================
(function(){
  const api = { setKind(){} };
  window.HydEq = api;
  if(!window.katex) return;
  const opts = { throwOnError:false, displayMode:true };
  katex.render(
    String.raw`\psi_{n\ell m}(r,\vartheta,\varphi)=\sqrt{\left(\frac{2}{n a_0}\right)^{3}\frac{(n-\ell-1)!}{2n\,[(n+\ell)!]}}\;e^{-\rho/2}\,\rho^{\ell}\,L^{2\ell+1}_{n-\ell-1}(\rho)\cdot Y_{\ell m}(\vartheta,\varphi)`,
    document.getElementById('eqPsi'), opts
  );
  const LINES = {
    complex: String.raw`\rho=\frac{2r}{n a_0},\qquad E_n=-\frac{13.6\ \text{eV}}{n^{2}},\qquad |Y_{\ell m}|^{2}\ \text{does not depend on}\ \varphi`,
    real: String.raw`Y^{\text{real}}_{\ell m}=\sqrt2\,(-1)^{m}\begin{cases}\operatorname{Re}\,Y_{\ell}^{|m|}\propto\cos m\varphi & m>0\\[2pt]\operatorname{Im}\,Y_{\ell}^{|m|}\propto\sin|m|\varphi & m<0\end{cases}`,
  };
  api.setKind = kind => katex.render(LINES[kind] || LINES.complex, document.getElementById('eqRho'), opts);
  api.setKind('complex');
})();
