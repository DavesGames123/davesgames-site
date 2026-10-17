// Chapter 6: transformation laws. Beat schema: learn/index.js header.
const t = String.raw;

export default {
  id: 'transform',
  title: 'Transformation laws',
  blurb: 'Change coordinates and every index picks up one Jacobian. That single rule is what a tensor is.',
  beats: [
    {
      title: 'The Jacobian',
      text: [
        t`On a curved grid, a basis changes from point to point. So instead of one change-of-basis matrix we use the Jacobian of the coordinate change, $J^{\mu}{}_{\nu} = \partial x'^{\mu}/\partial x^{\nu}$, at each point.`,
        t`Its columns say how the new coordinates move when you step along one old coordinate. Its inverse goes the other way.`,
      ],
      tex: t`J^{\mu}{}_{\nu} = \frac{\partial x'^{\mu}}{\partial x^{\nu}},\qquad (J^{-1})^{\nu}{}_{\mu} = \frac{\partial x^{\nu}}{\partial x'^{\mu}}`,
      show: { view: 'all', scene: 'curvilinear', params: { system: 'polar' }, entry: 'change-of-basis' },
    },
    {
      title: 'One rule for each height',
      text: [
        t`A vector's components follow the chain rule for a small step: $\mathrm{d}x'^{\mu} = (\partial x'^{\mu}/\partial x^{\nu})\,\mathrm{d}x^{\nu}$. So an upper index takes $J$.`,
        t`A gradient's components follow the chain rule for derivatives: $\partial'_{\mu} = (\partial x^{\nu}/\partial x'^{\mu})\,\partial_{\nu}$. So a lower index takes $J^{-1}$. These two lines are the whole reason for the two heights.`,
      ],
      tex: t`v'^{\mu} = \frac{\partial x'^{\mu}}{\partial x^{\nu}}\,v^{\nu},\qquad \omega'_{\mu} = \frac{\partial x^{\nu}}{\partial x'^{\mu}}\,\omega_{\nu}`,
      show: { view: 'all', scene: 'upper-lower', params: { s: 1.5, covector: true }, entry: 'change-of-basis', step: 'transform' },
      widget: { type: 'basis-drag', v: [1, 1], w: [1, -0.5] },
    },
    {
      title: 'One factor per index',
      text: [
        t`A tensor with many indices takes one factor for each: a $J$ for every upper index, a $J^{-1}$ for every lower one. Nothing else is allowed, and nothing is left out.`,
        t`The rotation below is the simplest Jacobian. For a rotation the inverse is the transpose, which is why, in Cartesian frames, nobody notices that the two heights differ.`,
      ],
      tex: t`T'^{\mu}{}_{\nu} = \frac{\partial x'^{\mu}}{\partial x^{\alpha}}\,\frac{\partial x^{\beta}}{\partial x'^{\nu}}\,T^{\alpha}{}_{\beta}`,
      show: { view: 'all', scene: 'transform-rank2', params: { mode: 'passive', kind: 'general' }, entry: 'rank2-transform', step: 'contract', style: 'penrose' },
      widget: { type: 'rotate-rank2', T: [[1.6, -0.5], [-0.5, 0.7]] },
    },
    {
      title: 'Why contractions are invariant',
      text: [
        t`Contract an upper index with a lower one after a change of coordinates. The Jacobian of one and the inverse Jacobian of the other meet, and multiply to the delta. They cancel.`,
        t`That is the deep reason a full contraction is a scalar: every $J$ finds its own $J^{-1}$.`,
      ],
      tex: t`\omega'_{\mu}v'^{\mu} = \frac{\partial x^{\alpha}}{\partial x'^{\mu}}\frac{\partial x'^{\mu}}{\partial x^{\beta}}\,\omega_{\alpha}v^{\beta} = \delta^{\alpha}{}_{\beta}\,\omega_{\alpha}v^{\beta} = \omega_{\alpha}v^{\alpha}`,
      show: { view: 'all', scene: 'dual-basis', params: {}, expr: t`\omega_{\mu}\,v^{\mu}`, step: 'contract' },
    },
    {
      title: 'Cartesian to polar by hand',
      text: [
        t`With $x = r\cos\theta$ and $y = r\sin\theta$, the inverse Jacobian has columns $\vec e_{r} = (\cos\theta, \sin\theta)$ and $\vec e_{\theta} = (-r\sin\theta, r\cos\theta)$. The second column has length $r$, the same factor we met in the metric.`,
        t`Take the unit arrow $\hat x$ at the point $r=2$, $\theta=\pi/2$. Its polar components are $v^{r} = 0$ and $v^{\theta} = -1/2$: a step along $\hat x$ there is a step back in angle, half a radian per unit, because the circle has radius 2.`,
      ],
      tex: t`\frac{\partial(x,y)}{\partial(r,\theta)} = \begin{pmatrix}\cos\theta & -r\sin\theta\\ \sin\theta & r\cos\theta\end{pmatrix},\qquad v^{\theta} = -\frac{\sin\theta}{r}\,v^{x} + \frac{\cos\theta}{r}\,v^{y}`,
      show: { view: 'all', scene: 'curvilinear', params: { system: 'polar' }, expr: t`v^{\theta}` },
    },
    {
      title: 'A Lorentz boost',
      text: [
        t`In spacetime the Jacobian of a change of inertial frame is a Lorentz matrix $\Lambda^{\mu}{}_{\nu}$. The electromagnetic field $F^{\mu\nu}$ has two upper indices, so it takes two factors of $\Lambda$.`,
        t`Raise the boost speed. The light cone stays put, and the electric and magnetic fields mix into each other: what one observer calls a pure electric field, another sees with a magnetic part.`,
      ],
      tex: t`F'^{\mu\nu} = \Lambda^{\mu}{}_{\alpha}\,\Lambda^{\nu}{}_{\beta}\,F^{\alpha\beta}`,
      show: { view: 'all', scene: 'lorentz', params: { beta: 0.6 }, entry: 'maxwell-tensor', step: 'transform' },
    },
    {
      title: 'Failing the test',
      text: [
        t`Now we can say exactly why the Christoffel symbols are not a tensor. Their transformation law has the right Jacobians for a type $(1,2)$ tensor, plus one extra term with second derivatives of the coordinate change.`,
        t`That term is zero for linear coordinate changes, which is why the trouble only shows on curved grids. Chapter 8 explains what the extra term is doing there.`,
      ],
      tex: t`\Gamma'^{\lambda}{}_{\mu\nu} = \frac{\partial x'^{\lambda}}{\partial x^{\alpha}}\frac{\partial x^{\beta}}{\partial x'^{\mu}}\frac{\partial x^{\gamma}}{\partial x'^{\nu}}\,\Gamma^{\alpha}{}_{\beta\gamma} + \frac{\partial x'^{\lambda}}{\partial x^{\alpha}}\,\frac{\partial^{2} x^{\alpha}}{\partial x'^{\mu}\,\partial x'^{\nu}}`,
      show: { view: 'all', scene: 'christoffel', params: {}, entry: 'polar-christoffel', step: 'christoffel' },
      deeper: {
        title: 'Tensor fields on a manifold',
        text: t`On a manifold $M$, a vector at a point lives in the tangent space $T_{p}M$ and a covector in the cotangent space $T^{*}_{p}M$. A tensor field is a smooth choice of one element of $T_{p}M^{\otimes p}\otimes T^{*}_{p}M^{\otimes q}$ at every point: a section of the tensor bundle. The Jacobian is the derivative of the transition map between two charts, and the transformation law is how one section looks in two charts.`,
      },
    },
  ],
};
