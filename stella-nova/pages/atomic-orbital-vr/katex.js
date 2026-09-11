// ============================================================================
//  ATOMIC ORBITAL VR  ·  governing-equation renderer
// ----------------------------------------------------------------------------
//  A classic (non-module) script that runs after the KaTeX CDN bundle loads and
//  before main.js. It typesets the three governing equations into the fixed
//  equations panel, then wires that panel's collapse toggle. Each symbol is
//  colored by its physical role, so the math reads at a glance and the colors
//  agree with the 3D scene (yellow ψ, cyan Y and B, amber current, and so on).
//
//  RENDER FLOW
//  -----------
//      window.katex ──▶ katex.render(TeX, target, opts) ×3
//        ├─ #eq-schrod   Hamiltonian eigenvalue equation   Ĥψ = Eψ
//        ├─ #eq-wavefn   separable wavefunction            ψ = R·Y
//        └─ #eq-biot     discrete Biot-Savart sum for B
//      #eq-collapse-btn click ──▶ toggle .collapsed on #eq-panel
//
//  SECTION MAP   (jump with grep -n "<anchor>" katex.js)
//  ----------------------------------------------------------------------------
//      role colors ......... "C_psi"           per-role hex color constants
//      render options ...... "const opts"      throwOnError off, display mode on
//      equations ........... "katex.render"    the three typeset equations
//      collapse toggle ..... "Collapse toggle" panel show/hide wiring
// ============================================================================

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
// Self-invoking so the color constants and options stay out of global scope.
(function(){
  // Bail out silently if the KaTeX CDN script failed to load; the panel then
  // shows nothing rather than throwing during page start.
  if (!window.katex) return;
  const C_psi = '#ffc832';
  const C_H   = '#c890ff';
  const C_E   = '#64c864';
  const C_R   = '#ff9050';
  const C_Y   = '#60e0ee';
  const C_B   = '#60e0ee';
  const C_J   = '#ffb84d';
  const C_sum = '#96c8ff';

  // throwOnError off so one bad glyph never blanks the whole panel; display
  // mode centers each equation as a block.
  const opts = { throwOnError:false, displayMode:true };

  // Schrödinger eigenvalue equation: the Hamiltonian acting on the eigenstate
  // returns the energy eigenvalue times the same state.
  katex.render(
    String.raw`\textcolor{${C_H}}{\hat{H}}\,\textcolor{${C_psi}}{\psi_{n,\ell,m}} \;=\; \textcolor{${C_E}}{E_n}\,\textcolor{${C_psi}}{\psi_{n,\ell,m}}`,
    document.getElementById('eq-schrod'), opts
  );
  // Separable hydrogenic wavefunction: a radial part times a spherical harmonic.
  // main.js samples exactly these two factors (radialR and legendrePlm) per point.
  katex.render(
    String.raw`\textcolor{${C_psi}}{\psi_{n,\ell,m}}(r,\theta,\varphi) \;=\; \textcolor{${C_R}}{R_{n,\ell}(r)}\,\textcolor{${C_Y}}{Y_\ell^{\,m}(\theta,\varphi)}`,
    document.getElementById('eq-wavefn'), opts
  );
  // Discrete Biot-Savart law: the field is a sum over probability-current
  // sources. main.js evaluates exactly this sum on a grid in computeBField().
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
