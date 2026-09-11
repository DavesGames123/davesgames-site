const R = String.raw;
const MATH = {
equations: [
 ['h','Fluid as a continuum'],
 ['p','Forget molecules. At every point x and time t there is a velocity u(x,t) and a pressure p(x,t). Newton\'s second law applied to a small parcel that <b>moves with the flow</b> gives the equations. The acceleration of that parcel is not ∂ₜu — the parcel has moved — but the material derivative:'],
 ['e', R`\frac{Du}{Dt}=\partial_t u+(u\cdot\nabla)u`],
 ['p','That second term is the only nonlinearity in the whole problem. Everything difficult about fluids comes from it.'],
 ['h','The equations'],
 ['e', R`\partial_t u+(u\cdot\nabla)u=-\nabla p+\nu\Delta u+f,\qquad \nabla\cdot u=0`],
 ['c','transport · pressure · viscosity · body force · incompressibility'],
 ['p','ν is the kinematic viscosity, units L²/T: momentum diffuses like heat. For a flow of size L and speed U the ratio of transport to viscosity is the Reynolds number Re = UL/ν. Honey has Re ≪ 1 and the nonlinearity barely matters; air past a wing has Re ~ 10⁷ and the nonlinearity is everything.'],
 ['h','Pressure is not a state variable'],
 ['p','Incompressibility is a <b>constraint</b>, and p is its Lagrange multiplier. Take the divergence of the momentum equation and use ∇·u = 0:'],
 ['e', R`-\Delta p=\partial_i\partial_j(u_iu_j)=\operatorname{tr}\big[(\nabla u)^2\big]`],
 ['p','So p is determined <b>instantly</b> and <b>nonlocally</b> by u: a change of velocity anywhere changes the pressure everywhere. Equivalently, the transport term is projected onto divergence-free fields by the Leray projector P = I − ∇Δ⁻¹∇·:'],
 ['e', R`\partial_t u=\mathbb{P}\big[-(u\cdot\nabla)u\big]+\nu\Delta u+\mathbb P f`],
 ['p','The demo on the stage is exactly P. Any smooth vector field splits uniquely into a divergence-free part and a gradient (Helmholtz). Pressure is the gradient the fluid throws away. Press <code>new field</code> a few times.'],
 ['h','Vorticity'],
 ['e', R`\omega=\nabla\times u,\qquad \partial_t\omega+(u\cdot\nabla)\omega=(\omega\cdot\nabla)u+\nu\Delta\omega`],
 ['p','Taking the curl removes the pressure entirely. What is left: vorticity is carried by the flow, diffused by viscosity, and — in three dimensions only — <b>stretched</b> by the velocity gradient. (ω·∇)u is the term that makes 3D different. Velocity is recovered from vorticity by Biot–Savart, u = K∗ω, a nonlocal integral with a kernel decaying like |x|⁻² in 3D.'],
 ['h','Energy: the one thing we know for sure'],
 ['e', R`\frac{d}{dt}\,\frac12\!\int|u|^2\,dx=-\nu\!\int|\nabla u|^2\,dx=-2\nu Z,\qquad Z=\tfrac12\!\int|\omega|^2`],
 ['p','Transport and pressure move energy around but create none: ∫u·(u·∇)u = 0 and ∫u·∇p = 0 whenever ∇·u = 0. Viscosity only removes it, at a rate set by the enstrophy Z. This identity is the <b>only</b> a priori bound available in 3D. Leray (1934) used it to build weak solutions for all time; whether they are smooth is the Millennium question.'],
 ['h','Scaling, and why 3D was hard'],
 ['e', R`u_\mu(x,t)=\mu\,u(\mu x,\mu^2t)\ \text{ solves NS if } u \text{ does;}\qquad E(u_\mu)=\mu^{2-d}E(u)`],
 ['p','In d = 3 the energy of a zoomed-in solution is <b>smaller</b> by μ⁻¹: the one quantity we control gets weaker exactly at the small scales where a singularity would live. That is what "supercritical" means. In d = 2 energy is scale-invariant and there is a second conserved quantity (enstrophy, in the inviscid limit) that is subcritical — which is why the 2D problem was settled sixty years ago. Tao\'s 2007 essay <i>Why global regularity for Navier–Stokes is hard</i> is the cleanest account.'],
 ['h','What "well-behaved" means precisely'],
 ['p','For smooth data a smooth solution exists for a short time (Leray, Kato). It stays smooth for all time if any one of these holds: the Beale–Kato–Majda integral ∫₀ᵀ‖ω(t)‖∞ dt is finite; a Ladyzhenskaya–Prodi–Serrin norm ‖u‖_{L^q_t L^p_x} with 2/q + 3/p = 1 is finite; or (Escauriaza–Seregin–Šverák) ‖u(t)‖_{L³} stays bounded. Caffarelli–Kohn–Nirenberg: even for weak solutions the singular set has zero one-dimensional parabolic measure — a singularity, if any, is a point-like event, not a surface. Small data, or large viscosity, gives global smoothness outright. The next three chapters watch each of these quantities in a running simulation.'],
 ['s','Standard references: Constantin &amp; Foias, <i>Navier–Stokes Equations</i>; Tao, <a href="https://terrytao.wordpress.com/2007/03/18/why-global-regularity-for-navier-stokes-is-hard/" target="_blank" rel="noopener">Why global regularity for Navier–Stokes is hard</a> (2007); the Clay problem statement by Fefferman.']
],
burgers: [
 ['h','Navier–Stokes with everything removed but the fight'],
 ['e', R`\partial_t u+u\,\partial_x u=\nu\,\partial_{xx}u`],
 ['p','One space dimension, no pressure, no incompressibility. What remains is the transport nonlinearity against diffusion. Burgers is where you learn what each one does before they are entangled.'],
 ['h','Inviscid: characteristics and breaking'],
 ['p','With ν = 0, u is constant along the curves dx/dt = u. Fast fluid overtakes slow fluid; the profile steepens. Differentiate along a characteristic, with q = ∂ₓu:'],
 ['e', R`\frac{Dq}{Dt}=-q^2\quad\Longrightarrow\quad q(t)=\frac{q_0}{1+q_0t}`],
 ['p','Wherever the initial slope is negative the gradient reaches −∞ at the <b>breaking time</b> t_b = 1/max(−u₀′). The characteristics cross in the x–t diagram on the stage; a shock forms. This is the simplest finite-time singularity in fluid mechanics, and the dashed curve in the slope plot is exactly q₀/(1 − q₀t).'],
 ['h','Viscous: the singularity is always avoided'],
 ['p','Two facts save the day. First, a <b>maximum principle</b>: the transport term does not change the max or min of u, and diffusion can only pull them inward, so ‖u(t)‖∞ ≤ ‖u₀‖∞ forever. Second, the Cole–Hopf transformation turns the equation into the heat equation, which is as well-behaved as an equation can be:'],
 ['e', R`u=-2\nu\,\frac{\partial_x\varphi}{\varphi}\qquad\Longrightarrow\qquad \partial_t\varphi=\nu\,\partial_{xx}\varphi`],
 ['p','So the solution is smooth for all time, for every ν > 0. The steepening still happens — the slope follows the inviscid curve almost perfectly until t ≈ t_b — but instead of diverging it saturates at a shock of width ~ 4ν/Δu, where diffusion and steepening exactly balance in a tanh profile. Lower ν and the ceiling rises like 1/ν, but it never disappears.'],
 ['h','What carries over, and what does not'],
 ['p','Carries over: nonlinear steepening creating small scales, viscosity smoothing them, and the scaling ν ↔ length². The energy plot shows something deeper: as ν → 0 the dissipation rate does <b>not</b> go to zero — the shock burns energy at an O(1) rate however small the viscosity. That is the one-dimensional face of turbulence\'s dissipation anomaly.'],
 ['p','Does not carry over: the maximum principle. In 3D Navier–Stokes there is no pointwise bound on u or ω; vortex stretching can amplify vorticity without limit as far as anyone could prove. Every "toy" blowup result — Tao\'s averaged Navier–Stokes (2016), the dyadic and shell models, and now the layered constructions — is about engineering a version of this steepening that viscosity cannot reach in time.'],
 ['s','Cole (1951), Hopf (1950). The x–t characteristics picture is in any PDE text, e.g. Evans, <i>Partial Differential Equations</i>, §3.4.']
],
flow2d: [
 ['h','The vorticity–streamfunction form'],
 ['e', R`\partial_t\omega+u\cdot\nabla\omega=\nu\Delta\omega,\qquad u=\nabla^\perp\psi,\quad \Delta\psi=\omega`],
 ['p','In two dimensions ω is a scalar and the stretching term is gone. Vorticity is simply <b>carried and diffused</b>, like dye. The velocity that carries it is recovered from ω by solving one Poisson equation — that is what the solver on the stage does every step, in Fourier space.'],
 ['h','Why 2D is a solved problem'],
 ['p','A carried-and-diffused scalar obeys the maximum principle, so ‖ω(t)‖∞ ≤ ‖ω₀‖∞ for all time. The Beale–Kato–Majda integral is then trivially finite, and the solution is smooth forever (Ladyzhenskaya; Lions–Prodi, 1959; Yudovich 1963 even for bounded vorticity with ν = 0). Enstrophy is also monotone:'],
 ['e', R`\frac{dZ}{dt}=-\nu\!\int|\nabla\omega|^2\le 0,\qquad \frac{dE}{dt}=-2\nu Z`],
 ['p','Both plots on the stage are these two identities. The second one is checked live: −dE/dt measured by finite differences against 2νZ computed from the field. They coincide to the accuracy of the time step — that agreement is the numerical signature of a healthy solver applied to a healthy equation.'],
 ['h','Exact solutions to test against'],
 ['e', R`\text{Taylor–Green:}\quad \omega=2\sin x\sin y\;e^{-2\nu t},\qquad\text{Lamb–Oseen:}\quad \omega=\frac{\Gamma}{4\pi\nu t}\,e^{-r^2/4\nu t}`],
 ['p','Taylor–Green is special: ω is a function of ψ alone, so u·∇ω = ∇⊥ψ·∇ω(ψ) = 0 and the nonlinearity vanishes identically. Only diffusion acts; the dashed red curve is the exact decay and the simulation sits on top of it. Lamb–Oseen is a Gaussian vortex spreading by pure diffusion — the same reason: a radial vortex is advected by a purely azimuthal velocity. Every chapter of this page, including the blowup, is built on ansätze whose nonlinearity <b>cancels exactly</b>; these are the friendly ones.'],
 ['h','What 2D does when the nonlinearity is not zero'],
 ['p','Run <code>random</code> or <code>shear</code>. Vortices of like sign merge; the shear layer rolls up (Kelvin–Helmholtz) into a few large vortices. Energy moves to <b>large</b> scales — the inverse cascade of Kraichnan (1967) — while enstrophy is passed down to small scales where viscosity eats it. Hurricanes and Jupiter\'s Great Red Spot are this picture. Nothing steepens without bound because there is no way to intensify vorticity, only to rearrange it.'],
 ['h','About the numerics'],
 ['p','128² grid, pseudo-spectral: derivatives are exact in Fourier space, products are computed in physical space, and the top third of wavenumbers is zeroed each step (the 2/3 rule) so the quadratic product cannot alias back into the resolved range. Time stepping is classical RK4 with the step set by the CFL condition. Re shown is U·2π/ν with U = √(2E).'],
 ['s','Kraichnan, <i>Inertial ranges in two-dimensional turbulence</i> (1967); Yudovich (1963); Majda &amp; Bertozzi, <i>Vorticity and Incompressible Flow</i>, ch. 2–3.']
],
flow3d: [
 ['live',[['mp-c1','energy · enstrophy · max|ω| — live from the solver on the stage'],['mp-c2','Beale–Kato–Majda integral ∫‖ω‖∞ and 2νZ = −dE/dt']]],
 ['h','Now the stretching term is alive'],
 ['e', R`\partial_t\omega+(u\cdot\nabla)\omega=\underbrace{(\omega\cdot\nabla)u}_{\text{stretching}}+\nu\Delta\omega`],
 ['p','Vortex lines are material lines (Helmholtz): they move with the fluid and their strength is proportional to their length. Pull a vortex tube and it thins and spins faster — angular momentum conservation, in local form. Write S for the symmetric part of ∇u; then'],
 ['e', R`\frac{dZ}{dt}=\int\omega\cdot S\,\omega\;-\;\nu\!\int|\nabla\omega|^2`],
 ['p','The first term has no sign. Whenever ω aligns with a stretching eigenvector of S, enstrophy is <b>created</b>. That is the whole difference between two and three dimensions, and it is visible on the stage: the Taylor–Green vortex\'s enstrophy climbs before viscosity wins. Energy still obeys dE/dt = −2νZ exactly — but a growing Z now means energy is destroyed faster, which is turbulence.'],
 ['h','Two initial conditions'],
 ['e', R`\text{Taylor–Green:}\quad u=(\sin x\cos y\cos z,\ -\cos x\sin y\cos z,\ 0)`],
 ['p','The classic benchmark (1937). Planar vortex sheets form on the cell walls, roll up, and stretch; at moderate Re the enstrophy peaks around t ≈ 5–9. Set the threshold slider low to see the sheets, high to see only the tubes into which they collapse.'],
 ['e', R`\text{ABC:}\quad u=(A\sin z+C\cos y,\ B\sin x+A\cos z,\ C\sin y+B\cos x),\qquad \omega=u`],
 ['p','A Beltrami flow: vorticity is parallel to velocity, so u × ω = 0 and the nonlinearity — in rotational form (u·∇)u = ω × u + ∇(|u|²/2) — is a pure gradient absorbed by the pressure. Nothing stretches. The exact solution is u(t) = u₀ e^{−νt}, E decays as e^{−2νt}, and the red dashed line on the plot is that prediction. The most nonlinear-looking flow you can write down, with chaotic streamlines, is an exact linear decay. Nonlinearity that cancels, again.'],
 ['h','The regularity ledger'],
 ['p','The lower plot tracks ∫₀ᵗ‖ω‖∞. Beale–Kato–Majda: as long as this stays finite up to time T the solution is smooth on [0,T]. In every simulation you will run here it grows and then flattens as viscosity wins — that is what "well-behaved" looks like numerically. No one has ever produced honest data for the unforced equations that does otherwise; the hardest attempts (Hou–Luo, Kerr, and others) get vorticity growth that is fast but, so far, not fast enough.'],
 ['h','Resolution, Reynolds number, and honesty'],
 ['p','Kolmogorov: the smallest dynamically active scale is η = (ν³/ε)^{1/4}, and the number of degrees of freedom needed grows like Re^{9/4}. A 32³ grid dealiased to 21³ resolves Re of order 100 for Taylor–Green; push ν down and the simulation is simply wrong past the enstrophy peak, though the diagnostics still tell the story. The ms/step readout is the price of nine three-dimensional FFTs per right-hand side, in JavaScript.'],
 ['h','The bridge to the blowup chapters'],
 ['p','The forced constructions win the race between stretching and viscosity by stacking exactly-solvable pieces: at each stage the background is an <b>affine</b> strain D·x near the origin — precisely the thing that stretches vortex lines at a constant exponential rate — and a plane wave riding on it feels only that strain, never its own nonlinearity. The next chapter is that single piece, alone.'],
 ['s','Taylor &amp; Green (1937); Brachet et al., <i>Small-scale structure of the Taylor–Green vortex</i> (1983); Beale–Kato–Majda (1984); Dombre et al. on ABC flows (1986).']
],
wave: [
 ['h','The equation'],
 ['p','Inviscid Boussinesq on the plane: a temperature anomaly θ carried by a divergence-free velocity u, feeding back through buoyancy. Vorticity ω = curl u is created wherever temperature varies horizontally.'],
 ['e', R`\partial_t\theta + u\cdot\nabla\theta = f_\theta,\qquad \partial_t\omega + u\cdot\nabla\omega = \partial_1\theta + \operatorname{curl} f_u`],
 ['p','The initial state is Rayleigh–Taylor unstable: cold, heavy fluid sits above warm, light fluid. Near the origin θ ≈ −A x₂. Push a parcel up and buoyancy pushes it further.'],
 ['h','The ansatz that solves the equation exactly'],
 ['p','Suppose the fields already built are affine near the origin, then add a plane wave with a slowly turning wavevector λζ(t):'],
 ['e', R`u_{\text{old}} = D(t)\,x,\quad \theta_{\text{old}} = G(t)\cdot x,\qquad \vartheta=\Theta(t)\sin s,\;\; \varpi=\Omega(t)\cos s,\;\; s=\lambda\,\zeta(t)\cdot x`],
 ['p','The wave velocity is v = (Ω / λ|ζ|²) Jζ sin s, with J the quarter-turn. Because v ⟂ ζ while ∇ϑ ∥ ζ, the wave cannot transport itself: v·∇ϑ = v·∇ϖ = 0. The nonlinearity evaluated on this ansatz is <b>identically zero</b>. No error term, no approximation.'],
 ['h','Three ODEs'],
 ['p','Matching the sin s and cos s coefficients leaves a closed finite-dimensional system:'],
 ['e', R`\dot\zeta = -D^{\mathsf T}\zeta,\qquad \dot\Theta = -\frac{J\zeta\cdot G}{\lambda|\zeta|^2}\,\Omega,\qquad \dot\Omega = \lambda\,\zeta_1\,\Theta`],
 ['c','left: old velocity turns the wavevector · middle: new velocity moves old temperature · right: horizontal temperature gradient makes vorticity'],
 ['h','Growth'],
 ['p','Freeze D = 0, G = −A e₂, ζ = (sin φ, cos φ). The system is a 2×2 hyperbolic linear ODE:'],
 ['e', R`\frac{d}{dt}\begin{pmatrix}\Theta\\ \Omega\end{pmatrix}=\begin{pmatrix}0 & A\sin\varphi/\lambda\\ \lambda\sin\varphi & 0\end{pmatrix}\begin{pmatrix}\Theta\\ \Omega\end{pmatrix},\qquad \text{eigenvalues } \pm\sqrt{A}\,\sin\varphi`],
 ['p','On the growing eigenline both amplitudes multiply by e^{√A sin φ · t}. The growth rate is set by the background gradient A, <b>not</b> by the frequency λ. That decoupling is the whole trick:'],
 ['e', R`\nabla\vartheta(0,t)=\lambda\,\Theta\,\zeta \qquad\Longrightarrow\qquad |\Theta|\ \text{tiny},\quad |\nabla\vartheta|=\lambda|\Theta|\ \text{huge}`],
 ['h','Steering, then hold'],
 ['p','Growth also leaves behind a shear Ω that would sabotage the next layer. The fix is to rotate G and ζ <b>together</b> by a common angle α(t). A common rotation preserves Jζ·G and |ζ| — the Θ-equation is untouched — but flips the sign of the laboratory component ζ₁, so Ω̇ = λζ₁Θ reverses. A short overshoot past vertical drives Ω back to exactly zero; the pulse amplitude is selected by shooting. Then hold ζ₁ = 0: both derivatives vanish, the temperature gain is frozen, and the next layer grows on top.'],
 ['e', R`\text{end of steering:}\quad \Omega=0,\ \ \zeta_1=0,\ \ \nabla\vartheta(0)=\lambda\Theta\zeta \ \text{retained}`],
 ['s','Alpöge &amp; Buckmaster, <a href="https://cims.nyu.edu/~tristanb/boussinesq.pdf" target="_blank" rel="noopener">Blowup for the Boussinesq equations with smooth forcing</a>, §1.2 and Lemma 3.1; the multiscale strategy is Córdoba &amp; Martínez-Zoroa (IPM, arXiv 2410.22920). Tao\'s summary: <a href="https://terrytao.wordpress.com/2026/09/07/" target="_blank" rel="noopener">What\'s new, 7 Sep 2026</a>.']
],
cascade: [
 ['h','Layers inside layers'],
 ['p','Replace sin s by a profile F(s) that is exactly linear near s = 0. Then wherever |λ_q ζ_q·x| is small, layer q is not a wave but a <b>straight ramp</b> — an affine background. Insert layer q+1 there, at a far higher frequency. It sees only the sum of all earlier ramps, so the same exact ODE applies with a steeper G.'],
 ['e', R`\theta=\theta^{b}+\sum_{q\ge 1}\theta_q,\qquad \theta_q=\Theta_q\,F(\lambda_q\zeta_q\!\cdot x)\,g_q(x)`],
 ['c','g_q: a transported cutoff, equal to 1 near the origin, supported inside the linear zone of every earlier layer'],
 ['h','The schedule'],
 ['p','Frequencies grow super-exponentially. Each layer is stopped at a prescribed amplitude, so its gradient contribution and the next growth scale are known in advance:'],
 ['e', R`\lambda_q=\lambda_{q-1}^{\,Q_q},\quad Q_q\ge 200;\qquad |\Theta_q|\ \text{stopped at}\ \lambda_q^{-7/8};\qquad A_q=\lambda_q|\zeta_q||\Theta_q|\sim\lambda_q^{1/8}`],
 ['e', R`\sigma_q^{\,2}=|G_{<q+1}|\ \approx A_q,\qquad \text{growth rate of layer } q\ \approx\ \sigma_{q-1}\sin s_q`],
 ['h','Why the time is finite'],
 ['p','Layer q must grow by a factor e^{L_q} at rate ≈ σ_{q−1} sin s_q. The insertion angle is chosen as s_q = L_q σ_{q−2}/σ_{q−1}, which makes the stage length collapse to the previous growth scale:'],
 ['e', R`|\text{stage }q|\;\lesssim\;\frac{L_q+3}{\sigma_{q-1}\sin s_q}\;\approx\;\frac{1}{\sigma_{q-2}},\qquad T_*=\sum_q|\text{stage }q|<\infty`],
 ['p','Because σ_q grows like λ_q^{1/16} and λ_q is a tower, the series of stage lengths converges brutally fast. Infinitely many layers fit before T_*.'],
 ['h','What blows up and what does not'],
 ['e', R`\sup_t\|\theta\|_\infty<\infty,\qquad \|\nabla\theta(t)\|_\infty\xrightarrow[t\uparrow T_*]{}\infty,\qquad \limsup_{t\uparrow T_*}\|\omega(t)\|_\infty=\infty`],
 ['p','The temperature itself stays bounded — the amplitudes λ_q^{−7/8} are summable — but every layer\'s gradient points into one acute cone, so the gains add without cancelling. The vorticity bound is only a limsup: it is read off at the ends of steering intervals, when the newest Ω is zero and the older ones share a sign.'],
 ['h','Keeping the force smooth'],
 ['p','Away from the origin the cutoffs g_q create localization errors. Each layer adds a finite tower of corrections cancelling those errors to an order that increases with q, and the leftover is declared to be the force. Summability of that leftover, with every mixed derivative, is what makes f ∈ C^∞ through T_*. This bookkeeping is most of the 76 pages.'],
 ['s','Same sources as the Wave view. The 3D Euler paper of Alpöge–Buckmaster runs the identical program on a different linearization; OpenAI reports the same layer-and-cancel strategy for Navier–Stokes with viscosity, but their writeup has not yet been digested by the community.']
],
vortex: [
 ['h','What OpenAI reports'],
 ['p','An initially resting fluid, pushed by a smooth force, develops a vortex that spirals inward and elongates like spaghetti. The core shrinks while speeding up so that kinetic energy stays finite. The technical content: every term in the equation — acceleration, pressure gradient, advection, viscosity — becomes large, yet they <b>cancel</b> to leave a smooth force. Statements C and D of the Clay formulation are claimed, with a Lean formalization.'],
 ['h','The scaling symmetry'],
 ['p','Navier–Stokes is invariant under parabolic rescaling, and that fixes the only self-consistent shape of a collapse:'],
 ['e', R`u_\mu(x,t)=\mu\,u(\mu x,\mu^2 t),\qquad p_\mu=\mu^2 p(\mu x,\mu^2 t)`],
 ['e', R`u(x,t)=\frac{1}{\sqrt{T_*-t}}\;U\!\left(\frac{x}{\sqrt{T_*-t}}\right)\qquad(\text{Leray, 1934})`],
 ['p','Core length ℓ = (T_*−t)^{1/2}, velocity ∼ ℓ^{−1}, vorticity ∼ ℓ^{−2}. The slider γ lets you see other collapse rates; γ = 1/2 is the one the equations themselves prefer.'],
 ['h','Energy finite, velocity infinite'],
 ['e', R`E(t)=\tfrac12\!\int|u|^2\,dx\ \sim\ \ell^{-2}\cdot\ell^{3}=\ell\to 0,\qquad \int_0^{T_*}\!\!\|\nabla u\|_2^2\,dt\ \sim\ \int_0^{T_*}\!\frac{dt}{\sqrt{T_*-t}}<\infty`],
 ['p','Both Leray–Hopf quantities stay finite while sup|u| → ∞. The Millennium formulation only demands bounded energy, so a Leray-type collapse is dimensionally allowed. Without forcing, Nečas–Růžička–Šverák (1996) ruled out exact Leray profiles in L³; with a smooth force the obstruction changes, and that is the room the construction lives in.'],
 ['h','Why this is the same story as the wave'],
 ['p','In 3D Euler the linearized operator about an affine flow D x again admits exact plane waves with a transported wavevector, ζ̇ = −Dᵀζ — Kelvin modes. A straining background with axial stretching amplifies them, and axial stretching is exactly what the reported vortex does. The forced-Euler paper of Alpöge–Buckmaster runs the same layer program on 3D Euler; I have not been able to check its precise ansatz yet. Adding viscosity −νΔu damps a mode at rate νλ²|ζ|², which each layer must out-grow before it is stopped. That race is the new difficulty for Navier–Stokes, and it is where the Euler papers stop and OpenAI\'s claim begins.'],
 ['s','OpenAI, <a href="https://openai.com/index/navier-stokes-solution/" target="_blank" rel="noopener">On the Navier–Stokes Millennium Prize Problem</a>, 8 Sep 2026 (proof PDF and Lean repo linked there). The 3D field in this view is a kinematic illustration, not their solution.']
]
};
function buildMath(view){
  const body=document.getElementById('mp-body'); body.innerHTML='';
  for(const [k,v] of MATH[view]){
    let el;
    if(k==='h'){el=document.createElement('h3');el.textContent=v}
    else if(k==='p'){el=document.createElement('p');el.innerHTML=v}
    else if(k==='c'){el=document.createElement('div');el.className='eq-cap';el.textContent=v}
    else if(k==='s'){el=document.createElement('div');el.className='src';el.innerHTML=v}
    else if(k==='e'){el=document.createElement('div');el.className='eq';try{katex.render(v,el,{displayMode:true,throwOnError:false})}catch(e){el.textContent=v}}
    else if(k==='live'){el=document.createElement('div');el.className='live';el.innerHTML=v.map(([id,cap])=>`<div class="eq-cap" style="margin:0 0 4px">${cap}</div><div class="livebox"><canvas id="${id}"></canvas></div>`).join('')}
    body.appendChild(el);
  }
}
