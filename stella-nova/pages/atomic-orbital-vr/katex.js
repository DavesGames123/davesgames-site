/* ═══════════════════ KaTeX EQUATION RENDERING ═══════════════════
   Color coding by physical role:
     ψ (wavefunction)     → yellow      (matches |ψ|² visualization)
     Ĥ (Hamiltonian)      → purple      (operator)
     E (energy eigenvalue) → green      (scalar invariant)
     R_{n,ℓ} (radial)     → orange      (radial component)
     Y_ℓ^m (angular)      → cyan        (spherical harmonic)
     B (magnetic field)   → cyan        (matches B-arrow viz)
     J (current density)  → amber       (source / current)
     Σ (sum operator)     → blue        (discrete summation)
*/
(function(){
  if (!window.katex) return;
  const C_psi = '#ffc832';
  const C_H   = '#c890ff';
  const C_E   = '#64c864';
  const C_R   = '#ff9050';
  const C_Y   = '#60e0ee';
  const C_B   = '#60e0ee';
  const C_J   = '#ffb84d';
  const C_sum = '#96c8ff';

  const opts = { throwOnError:false, displayMode:true };

  katex.render(
    String.raw`\textcolor{${C_H}}{\hat{H}}\,\textcolor{${C_psi}}{\psi_{n,\ell,m}} \;=\; \textcolor{${C_E}}{E_n}\,\textcolor{${C_psi}}{\psi_{n,\ell,m}}`,
    document.getElementById('eq-schrod'), opts
  );
  katex.render(
    String.raw`\textcolor{${C_psi}}{\psi_{n,\ell,m}}(r,\theta,\varphi) \;=\; \textcolor{${C_R}}{R_{n,\ell}(r)}\,\textcolor{${C_Y}}{Y_\ell^{\,m}(\theta,\varphi)}`,
    document.getElementById('eq-wavefn'), opts
  );
  katex.render(
    String.raw`\textcolor{${C_B}}{\vec{B}}(\vec{r}) \;=\; \tfrac{\mu_0}{4\pi}\,\textcolor{${C_sum}}{\sum_{i}}\, \frac{\textcolor{${C_J}}{\vec{J}_i}\,\times\,(\vec{r}-\vec{r}_i)}{|\vec{r}-\vec{r}_i|^{\,3}}`,
    document.getElementById('eq-biot'), opts
  );

  // Collapse toggle
  const panel = document.getElementById('eq-panel');
  const btn = document.getElementById('eq-collapse-btn');
  btn.addEventListener('click', () => {
    const isCollapsed = panel.classList.toggle('collapsed');
    btn.textContent = isCollapsed ? '▼' : '▲';
    btn.title = isCollapsed ? 'Expand equations' : 'Collapse equations';
  });
})();
