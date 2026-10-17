// Chapter 8: the covariant derivative and Christoffel symbols. Beat schema: learn/index.js header.
const t = String.raw;

export default {
  id: 'covariant',
  title: 'The covariant derivative',
  blurb: 'On a curved grid the basis turns as you move. The Christoffel symbols measure the turn, and the covariant derivative corrects for it.',
  beats: [
    {
      title: 'Components lie on a curved grid',
      text: [
        t`Take a constant vector field in the plane: the same arrow everywhere. In Cartesian coordinates its components are constant, so their derivatives are zero, as they should be.`,
        t`In polar coordinates the same field has components that change from point to point, because $\vec e_{r}$ and $\vec e_{\theta}$ turn and stretch as you move. Differentiate a vector and you must differentiate the basis too.`,
      ],
      tex: t`\partial_{j}\vec v = (\partial_{j}v^{i})\,\vec e_{i} + v^{i}\,\partial_{j}\vec e_{i}`,
      show: { view: 'all', scene: 'christoffel', params: { surface: 'polar', line: 'theta' }, entry: 'polar-christoffel', step: 'partial' },
    },
    {
      title: 'Christoffel symbols: how the basis turns',
      text: [
        t`The derivative of a basis vector is again a vector, so it is a combination of basis vectors. The coefficients are the Christoffel symbols $\Gamma^{k}{}_{ji}$: the $\I{k}$ component of the change of $\vec e_{i}$ as you step along $x^{j}$.`,
        t`In polar coordinates, stepping out in $r$ stretches $\vec e_{\theta}$ in proportion: $\Gamma^{\theta}{}_{r\theta} = 1/r$. Stepping round in $\theta$ turns $\vec e_{\theta}$ inwards: $\Gamma^{r}{}_{\theta\theta} = -r$. Move the slider to see both change with $r$.`,
      ],
      tex: t`\partial_{j}\vec e_{i} = \Gamma^{k}{}_{ji}\,\vec e_{k},\qquad \Gamma^{\theta}{}_{r\theta} = \Gamma^{\theta}{}_{\theta r} = \frac{1}{r},\quad \Gamma^{r}{}_{\theta\theta} = -r`,
      show: { view: 'all', scene: 'christoffel', params: { surface: 'polar', line: 'theta' }, entry: 'polar-christoffel', step: 'christoffel' },
      widget: { type: 'christoffel-polar', r: 1.5 },
    },
    {
      title: 'The covariant derivative',
      text: [
        t`Collect the two pieces and rename the dummies. The result is the covariant derivative: the partial derivative of the components plus one Christoffel term that accounts for the turning basis.`,
        t`Unlike $\partial_{j}v^{i}$, the combination $\nabla_{j}v^{i}$ is a genuine type $(1,1)$ tensor. The extra term in the transformation of $\Gamma$ (chapter 6) exactly cancels the extra term in the transformation of $\partial_{j}v^{i}$.`,
      ],
      tex: t`\nabla_{j}v^{i} = \partial_{j}v^{i} + \Gamma^{i}{}_{jk}\,v^{k}`,
      show: { view: 'all', scene: 'christoffel', params: { surface: 'polar', line: 'r' }, entry: 'covariant-derivative', step: 'covariant', style: 'penrose' },
    },
    {
      title: 'One correction per index',
      text: [
        t`For a covector the correction comes with a minus sign, which follows from asking that $\nabla$ obey the product rule and leave the scalar $\omega_{i}v^{i}$ with its ordinary derivative.`,
        t`A tensor with many indices gets one $+\Gamma$ term for each upper index and one $-\Gamma$ term for each lower index.`,
      ],
      tex: t`\nabla_{j}\omega_{i} = \partial_{j}\omega_{i} - \Gamma^{k}{}_{ji}\,\omega_{k},\qquad \nabla_{\rho}T^{\mu}{}_{\nu} = \partial_{\rho}T^{\mu}{}_{\nu} + \Gamma^{\mu}{}_{\rho\lambda}T^{\lambda}{}_{\nu} - \Gamma^{\lambda}{}_{\rho\nu}T^{\mu}{}_{\lambda}`,
      show: { view: 'tex', entry: 'covariant-derivative', step: 'covariant' },
    },
    {
      title: 'Christoffel symbols from the metric',
      text: [
        t`There are many ways to choose $\Gamma$. Exactly one choice is symmetric in its lower indices (no torsion) and keeps the metric constant under $\nabla$, so lengths and angles survive transport. It is the Levi-Civita connection, and it is built from first derivatives of the metric alone.`,
        t`Put the polar metric $g = \mathrm{diag}(1, r^{2})$ into this formula and you get back the two symbols above.`,
      ],
      tex: t`\Gamma^{\lambda}{}_{\mu\nu} = \tfrac12\,g^{\lambda\sigma}\left(\partial_{\mu}g_{\sigma\nu} + \partial_{\nu}g_{\sigma\mu} - \partial_{\sigma}g_{\mu\nu}\right),\qquad \nabla_{\rho}g_{\mu\nu} = 0`,
      show: { view: 'all', entry: 'polar-christoffel', step: 'christoffel' },
    },
    {
      title: 'Parallel transport',
      text: [
        t`Carry a vector along a curve $x^{\mu}(t)$ and keep it as constant as the geometry allows: its covariant derivative along the curve is zero. That is parallel transport.`,
        t`In the plane, this just slides the arrow without turning it, whatever the coordinates. On a sphere it can turn the arrow, and chapter 9 shows how much.`,
      ],
      tex: t`\frac{\mathrm{d}V^{\lambda}}{\mathrm{d}t} + \Gamma^{\lambda}{}_{\mu\nu}\,\dot x^{\mu}\,V^{\nu} = 0`,
      show: { view: 'all', scene: 'parallel-transport', params: { path: 'latitude', th0: 1.0 }, entry: 'parallel-transport' },
    },
    {
      title: 'Geodesics',
      text: [
        t`A geodesic is a curve that transports its own velocity: it never turns, as far as the geometry can tell. On a sphere the geodesics are great circles; in spacetime they are the paths of free-falling bodies.`,
        t`Set $V = \dot x$ in the transport equation and you get the geodesic equation, a second-order equation for the curve itself.`,
      ],
      tex: t`\ddot x^{\lambda} + \Gamma^{\lambda}{}_{\mu\nu}\,\dot x^{\mu}\,\dot x^{\nu} = 0`,
      show: { view: 'all', scene: 'geodesic-deviation', params: {}, entry: 'geodesic-equation', step: 'contract' },
      deeper: {
        title: 'Connections in general',
        text: t`A connection is extra structure on a vector bundle that says how to compare fibres at nearby points. The Christoffel symbols are its components in a chart, which is why they are not a tensor. The difference of two connections, however, is a tensor, and the torsion $T^{\lambda}{}_{\mu\nu} = \Gamma^{\lambda}{}_{\mu\nu} - \Gamma^{\lambda}{}_{\nu\mu}$ is one. The fundamental theorem of Riemannian geometry says the torsion-free metric connection exists and is unique.`,
      },
    },
  ],
};
