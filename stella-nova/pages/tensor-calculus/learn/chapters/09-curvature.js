// Chapter 9: curvature. Beat schema: learn/index.js header.
const t = String.raw;

export default {
  id: 'curvature',
  title: 'Curvature',
  blurb: 'Carry an arrow round a loop and it comes back turned. The Riemann tensor is that turn, per unit area, in every direction.',
  beats: [
    {
      title: 'Round a loop',
      text: [
        t`Stand at the north pole with an arrow pointing along a meridian. Walk down to the equator, a quarter of the way round the equator, and back up to the pole, never turning the arrow. It comes back turned through a right angle.`,
        t`In the flat plane no loop does this. The turn is a signature of curvature that a creature living on the surface can measure without ever leaving it.`,
      ],
      tex: t`\text{holonomy angle} = \oint \text{(turn)} \neq 0\ \Longleftrightarrow\ \text{curvature inside the loop}`,
      show: { view: 'all', scene: 'parallel-transport', params: { path: 'triangle' }, entry: 'parallel-transport' },
    },
    {
      title: 'The turn is the area',
      text: [
        t`Transport a vector once round the circle of colatitude $\theta$ on a unit sphere. It comes back turned by the solid angle of the cap the circle encloses. For a sphere of radius $R$ the turn is the enclosed area divided by $R^{2}$.`,
        t`Move the slider. The number from the closed form and the number from integrating the transport equation step by step agree. The ratio of turn to area is the Gaussian curvature, $K = 1/R^{2}$.`,
      ],
      tex: t`\Delta\alpha = 2\pi\,(1-\cos\theta) = \frac{A}{R^{2}},\qquad K = \frac{\Delta\alpha}{A}`,
      show: { view: 'all', scene: 'parallel-transport', params: { path: 'latitude', th0: 1.0 }, entry: 'parallel-transport' },
      widget: { type: 'holonomy', colat: 1.0 },
    },
    {
      title: 'The Riemann tensor',
      text: [
        t`Make the loop a tiny parallelogram spanned by two directions $\mu$ and $\nu$. Going round it is the same as taking covariant derivatives in two orders and subtracting. The difference is linear in the vector, so it is a tensor: the Riemann tensor.`,
        t`Read its indices as a sentence: $R^{\rho}{}_{\sigma\mu\nu}$ is the change in the $\I{\rho}$ component of a vector that started along $\I{\sigma}$, after a loop in the $\I{\mu}\I{\nu}$ plane.`,
      ],
      tex: t`[\nabla_{\mu},\nabla_{\nu}]\,V^{\rho} = R^{\rho}{}_{\sigma\mu\nu}\,V^{\sigma}`,
      show: { view: 'all', scene: 'curvature-loop', params: {}, entry: 'riemann-tensor', style: 'penrose' },
    },
    {
      title: 'Riemann from Christoffel',
      text: [
        t`Expand the commutator and the Riemann tensor comes out in terms of the Christoffel symbols and their first derivatives, so in terms of the metric and its first two derivatives.`,
        t`The step player works through this formula term by term for the metric of the library entry.`,
      ],
      tex: t`R^{\rho}{}_{\sigma\mu\nu} = \partial_{\mu}\Gamma^{\rho}{}_{\nu\sigma} - \partial_{\nu}\Gamma^{\rho}{}_{\mu\sigma} + \Gamma^{\rho}{}_{\mu\lambda}\Gamma^{\lambda}{}_{\nu\sigma} - \Gamma^{\rho}{}_{\nu\lambda}\Gamma^{\lambda}{}_{\mu\sigma}`,
      show: { view: 'all', entry: 'riemann-tensor', step: 'partial' },
    },
    {
      title: 'Ricci and the scalar curvature',
      text: [
        t`Contract Riemann once and you get the Ricci tensor $R_{\sigma\nu}$, which measures how a small ball of free-falling dust changes volume. Contract again with the inverse metric and you get the scalar curvature $R$.`,
        t`For a sphere of radius $r$ the scalar curvature is $2/r^{2}$ everywhere: twice the Gaussian curvature.`,
      ],
      tex: t`R_{\sigma\nu} = R^{\rho}{}_{\sigma\rho\nu},\qquad R = g^{\sigma\nu}R_{\sigma\nu} = \frac{2}{r^{2}}\ \ \text{(sphere)}`,
      show: { view: 'all', scene: 'curvilinear', params: { system: 'spherical' }, entry: 'ricci-scalar', step: 'contract' },
    },
    {
      title: 'Tides: geodesic deviation',
      text: [
        t`Two nearby free-falling bodies follow geodesics that start parallel. In curved space they drift apart or together. Their separation $\xi^{\mu}$ accelerates at a rate set by the Riemann tensor.`,
        t`In gravity this is the tidal force: the stretch of the oceans along the Earth to Moon line and the squeeze across it.`,
      ],
      tex: t`\frac{D^{2}\xi^{\mu}}{\mathrm{d}\tau^{2}} = -R^{\mu}{}_{\nu\rho\sigma}\,u^{\nu}\,\xi^{\rho}\,u^{\sigma}`,
      show: { view: 'all', scene: 'geodesic-deviation', params: { surface: 'sphere' }, entry: 'geodesic-deviation' },
    },
    {
      title: 'Bianchi and Einstein',
      text: [
        t`The Riemann tensor obeys a differential identity, the second Bianchi identity. Contract it twice and it says that the Einstein tensor $G_{\mu\nu}$ has zero divergence.`,
        t`Energy and momentum are conserved, $\nabla_{\mu}T^{\mu\nu} = 0$. So the one natural equation that links geometry to matter sets the two divergence-free tensors equal (units with $c=1$): the Einstein field equations.`,
      ],
      tex: t`\nabla_{[\lambda}R^{\rho}{}_{|\sigma|\mu\nu]} = 0\ \Rightarrow\ \nabla_{\mu}G^{\mu\nu} = 0,\qquad G_{\mu\nu} = R_{\mu\nu} - \tfrac12 R\,g_{\mu\nu} = 8\pi G\,T_{\mu\nu}`,
      show: { view: 'all', entry: 'einstein-field-equations', style: 'penrose' },
    },
    {
      title: 'Empty but curved',
      text: [
        t`Outside a star there is no matter, so $T_{\mu\nu} = 0$ and the Ricci tensor vanishes. The Riemann tensor does not: the tidal part survives in the Weyl tensor. The Schwarzschild metric is the exact solution, and its spatial slice can be drawn as the Flamm paraboloid.`,
      ],
      tex: t`\mathrm{d}s^{2} = -\Big(1-\frac{r_{\mathrm{s}}}{r}\Big)\mathrm{d}t^{2} + \Big(1-\frac{r_{\mathrm{s}}}{r}\Big)^{-1}\mathrm{d}r^{2} + r^{2}\,\mathrm{d}\Omega^{2},\qquad R_{\mu\nu} = 0`,
      show: { view: 'all', scene: 'flamm', params: {}, entry: 'schwarzschild-metric' },
      deeper: {
        title: 'Curvature as a 2-form',
        text: t`For fixed $\rho$ and $\sigma$, $R^{\rho}{}_{\sigma\mu\nu}$ is antisymmetric in $\mu\nu$: a 2-form, something you integrate over a small surface. The curvature of a connection is an endomorphism-valued 2-form $\Omega = \mathrm{d}\omega + \omega\wedge\omega$, and the holonomy round a small loop is $1 + \Omega(\text{loop}) + \cdots$. Gauss's Theorema Egregium is the statement that this curvature depends on the metric alone.`,
      },
    },
  ],
};
