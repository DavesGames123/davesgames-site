// Chapter 4: the metric, raising and lowering. Beat schema: learn/index.js header.
const t = String.raw;

export default {
  id: 'metric',
  title: 'The metric, raising and lowering',
  blurb: 'The metric measures lengths and angles, and it is the bridge that turns arrows into planes and back.',
  beats: [
    {
      title: 'A rule for length',
      text: [
        t`Components alone do not tell you how long an arrow is. In a skewed basis, the arrow with components $(1,1)$ can be long or short. The metric $g_{ij}$ supplies the missing information: $g_{ij} = \vec e_{i}\cdot\vec e_{j}$, the dot products of the basis vectors.`,
        t`With it, the squared length of a small step $\mathrm{d}x^{i}$ is the line element $\mathrm{d}s^{2}$, and the dot product of any two vectors is one contraction.`,
      ],
      tex: t`\mathrm{d}s^{2} = g_{ij}\,\mathrm{d}x^{i}\,\mathrm{d}x^{j},\qquad \vec u\cdot\vec v = g_{ij}\,u^{i}v^{j}`,
      show: { view: 'all', scene: 'metric-field', params: {}, entry: 'dot-product-metric' },
    },
    {
      title: 'Polar coordinates',
      text: [
        t`In polar coordinates $(r,\theta)$ a step $\mathrm{d}\theta$ covers a distance $r\,\mathrm{d}\theta$, so the farther you are from the centre, the longer a unit of angle is. The coordinate basis vector $\vec e_{\theta}$ has length $r$.`,
        t`The metric is diagonal with entries $1$ and $r^{2}$. It is not the identity, even though the plane is flat. The metric depends on the coordinates; flatness is a separate question (chapter 9).`,
      ],
      tex: t`\mathrm{d}s^{2} = \mathrm{d}r^{2} + r^{2}\,\mathrm{d}\theta^{2},\qquad g_{ij} = \begin{pmatrix}1 & 0\\ 0 & r^{2}\end{pmatrix}`,
      show: { view: 'all', scene: 'curvilinear', params: { system: 'polar' }, expr: t`g_{ij}` },
    },
    {
      title: 'Lowering: arrows become planes',
      text: [
        t`Given an arrow $\vec v$, there is a covector that measures other arrows by their dot product with $\vec v$: $\vec u\mapsto \vec v\cdot\vec u$. Its components are $v_{i} = g_{ij}v^{j}$. This is lowering an index.`,
        t`Change the metric below. The arrow $v^{i}$ stays fixed. The plane stack $v_{i}$ turns and changes its spacing, because the metric decides which planes are perpendicular to the arrow.`,
      ],
      tex: t`v_{i} = g_{ij}\,v^{j}`,
      show: { view: 'all', scene: 'metric-field', params: {}, entry: 'raise-lower', step: 'lower', style: 'penrose' },
      widget: { type: 'raise-lower', v: [1, 0.6] },
    },
    {
      title: 'Raising with the inverse',
      text: [
        t`The inverse metric $g^{ij}$ is the matrix inverse of $g_{ij}$, written with both indices up. It undoes the lowering: $g^{ij}g_{jk} = \delta^{i}{}_{k}$.`,
        t`Raising is how a gradient becomes an arrow. The covector $\partial_{i}f$ is a stack of level lines. The gradient vector that points uphill has components $g^{ij}\partial_{j}f$. In polar coordinates that is $(\partial_{r}f,\ r^{-2}\,\partial_{\theta}f)$, not the naive $(\partial_{r}f, \partial_{\theta}f)$.`,
      ],
      tex: t`g^{ij}\,g_{jk} = \delta^{i}{}_{k},\qquad (\nabla f)^{i} = g^{ij}\,\partial_{j} f`,
      show: { view: 'all', scene: 'curvilinear', params: { system: 'polar' }, entry: 'raise-lower', step: 'raise' },
    },
    {
      title: 'One object, two sets of numbers',
      text: [
        t`$v^{i}$ and $v_{i}$ are two descriptions of one geometric thing, linked by the metric. In an orthonormal Cartesian frame $g_{ij} = \delta_{ij}$ and the two sets of numbers are equal. That is why school physics never needed the distinction.`,
        t`In polar coordinates at radius $r$, the arrow with $v^{i} = (1, 1)$ has $v_{i} = (1, r^{2})$. At $r=3$ the lower components are $(1, 9)$.`,
      ],
      tex: t`v^{i} = (1,\,1)\ \ \Rightarrow\ \ v_{i} = g_{ij}v^{j} = (1,\,r^{2})`,
      show: { view: 'all', scene: 'curvilinear', params: { system: 'polar' }, expr: t`v_{i} = g_{ij}\,v^{j}`, pick: 'i' },
    },
    {
      title: 'Spacetime: a metric with a minus sign',
      text: [
        t`Special relativity uses the Minkowski metric $\eta_{\mu\nu}$ with signature $(-,+,+,+)$. Lengths can be negative, zero or positive: time-like, light-like or space-like.`,
        t`Lowering an index flips the sign of the time component. The four-momentum $p^{\mu} = (E, \vec p\,)$ becomes $p_{\mu} = (-E, \vec p\,)$, and the contraction $p_{\mu}p^{\mu} = -E^{2} + |\vec p\,|^{2} = -m^{2}$ is the same for every observer (units with $c=1$).`,
      ],
      tex: t`\eta_{\mu\nu} = \mathrm{diag}(-1,1,1,1),\qquad p_{\mu}p^{\mu} = -m^{2}`,
      show: { view: 'all', scene: 'lorentz', params: { beta: 0 }, entry: 'four-momentum' },
    },
    {
      title: 'The metric of a sphere',
      text: [
        t`On a sphere of radius $R$ with colatitude $\theta$ and longitude $\phi$, a step in longitude near the pole is short: the circles of latitude shrink by $\sin\theta$.`,
        t`Every flat map of the sphere distorts this metric somewhere. Tissot's ellipses show it: a small circle on the globe becomes an ellipse on the map, and the ellipse is the metric drawn at that point.`,
      ],
      tex: t`\mathrm{d}s^{2} = R^{2}\left(\mathrm{d}\theta^{2} + \sin^{2}\theta\,\mathrm{d}\phi^{2}\right)`,
      show: { view: 'all', scene: 'metric-field', params: { chart: 'mercator' }, entry: 'sphere-metric' },
      deeper: {
        title: 'Musical isomorphisms',
        text: t`A metric is a non-degenerate symmetric bilinear form. Non-degenerate means the map $\flat: V\to V^{*}$, $\vec v\mapsto g(\vec v,\cdot)$ is invertible; its inverse is $\sharp$. Lowering is $\flat$, raising is $\sharp$. On a manifold $g$ is a smooth field of such forms, Riemannian when it is positive definite and Lorentzian when it has one minus sign.`,
      },
    },
  ],
};
