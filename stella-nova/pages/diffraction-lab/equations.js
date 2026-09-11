// ============================================================================
//  APERTURE DIFFRACTION  ·  equation panel renderer
// ----------------------------------------------------------------------------
//  Renders the four governing equations of the diffraction engine with KaTeX,
//  color-coding each symbol to match the sim. It also publishes the shared color
//  palette and KaTeX options on window (_C and _ko) so main.js can re-render the
//  per-element transmittance equation as the aperture changes. Self-invoking;
//  bails out quietly if KaTeX did not load.
//
//  SECTION MAP   (jump with grep -n "<anchor>" equations.js)
//  --------------------------------------------------------------------------
//      shared palette ...... "window._C"       colors and opts exported to main
//      Helmholtz ........... "eq-helm"         the wave equation and wavenumber
//      angular spectrum .... "eq-asm"          the propagation transform
//      transmittance ....... "eq-trans"        the aperture mask (updated live)
//      CIE to sRGB ......... "eq-cie"          the white-light color path
//      collapse toggle ..... "eq-collapse-btn" show/hide the panel
// ============================================================================
// Bail out if KaTeX is unavailable. Symbol tints are published on window so
// main.js reuses them in each element's transmittance tex().
(function(){if(!window.katex)return;const E='#ffc832',H='#60e0ee',T='#ff9050',F='#c890ff',K='#64c864',o={throwOnError:false,displayMode:true};window._C={E,H,T,F,K};window._ko=o;
// Helmholtz equation: the time-independent wave equation with wavenumber k=2π/λ.
katex.render(String.raw`\textcolor{${F}}{\nabla^2}\textcolor{${E}}{E} + \textcolor{${K}}{k}^2 \textcolor{${E}}{E} = 0 \,,\qquad \textcolor{${K}}{k} = \dfrac{2\pi}{\lambda}`,document.getElementById('eq-helm'),o);
// Angular spectrum method: forward FFT, phase advance by exp(i·kz·z), inverse FFT.
katex.render(String.raw`\textcolor{${E}}{E}(z) = \textcolor{${F}}{\mathcal{F}^{-1}}\!\left\{ \textcolor{${F}}{\mathcal{F}}\!\left\{ \textcolor{${T}}{t} \cdot \textcolor{${E}}{E_0} \right\} \cdot e^{\,i\,\textcolor{${K}}{k_z}\, z} \right\}`,document.getElementById('eq-asm'),o);
// Transmittance placeholder (hexagon), replaced live by main.js per element.
katex.render(String.raw`\textcolor{${T}}{t} = \begin{cases} 1 & |x| + |y|\,/\sqrt{3} \le R \\ 0 & \text{otherwise} \end{cases}`,document.getElementById('eq-trans'),o);
// CIE to sRGB: integrate intensity against the D65 spectrum and color-matching
// functions to get XYZ, then apply the matrix M and gamma γ to reach sRGB.
katex.render(String.raw`\textcolor{red}{R},\,\textcolor{green}{G},\,\textcolor{${H}}{B} \;=\; \gamma\!\!\left(\, \mathbf{M} \!\int_{\lambda} S(\lambda)\; \textcolor{${E}}{I}(\lambda)\; [\bar{x},\,\bar{y},\,\bar{z}]\; d\lambda \,\right)`,document.getElementById('eq-cie'),o);
// Collapse toggle: fold the panel and flip the caret.
document.getElementById('eq-collapse-btn').addEventListener('click',()=>{const p=document.getElementById('eq-panel'),c=p.classList.toggle('collapsed');document.getElementById('eq-collapse-btn').textContent=c?'▼':'▲'});
})();
