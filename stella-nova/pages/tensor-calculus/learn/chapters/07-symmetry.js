// Chapter 7: symmetry and counting components. Beat schema: learn/index.js header.
const t = String.raw;

export default {
  id: 'symmetry',
  title: 'Symmetry and counting components',
  blurb: 'Symmetries tie components together. Count what is left and you know how much a tensor can really say.',
  beats: [
    {
      title: 'Symmetric and antisymmetric parts',
      text: [
        t`A tensor $T_{ij}$ is symmetric when swapping its two slots changes nothing, $T_{ij} = T_{ji}$, and antisymmetric when the swap flips the sign, $T_{ij} = -T_{ji}$.`,
        t`Every two-slot tensor splits into one of each. Round brackets on indices mean the symmetric part, square brackets the antisymmetric part.`,
      ],
      tex: t`T_{ij} = \underbrace{\tfrac12\left(T_{ij}+T_{ji}\right)}_{T_{(ij)}} + \underbrace{\tfrac12\left(T_{ij}-T_{ji}\right)}_{T_{[ij]}}`,
      show: { view: 'all', scene: 'transform-rank2', params: { kind: 'general' }, entry: 'sym-antisym', step: 'symmetrize', style: 'penrose' },
    },
    {
      title: 'Symmetry is a property of the tensor',
      text: [
        t`If $T_{ij}$ is symmetric in one basis it is symmetric in all of them, because both slots take the same factor under a change of basis. The symmetry belongs to the machine, not to the frame.`,
        t`Careful with mixed heights: a symmetry between an upper and a lower slot, $A^{i}{}_{j} = A^{j}{}_{i}$, is not basis-free. Lower the index first with the metric, then ask if $A_{ij}$ is symmetric.`,
      ],
      tex: t`T'_{ij} = A^{k}{}_{i}A^{l}{}_{j}T_{kl} = A^{k}{}_{i}A^{l}{}_{j}T_{lk} = T'_{ji}`,
      show: { view: 'tex', expr: t`T_{ij} = T_{ji}` },
    },
    {
      title: 'Counting components',
      text: [
        t`A symmetric $n\times n$ tensor has only $n(n+1)/2$ independent components: the diagonal and one triangle. An antisymmetric one has $n(n-1)/2$, since its diagonal is zero.`,
        t`For more slots the counts are binomial coefficients. Choose the rank, the dimension and the symmetry below. The tool counts with the formula, and checks it by solving the symmetry equations directly.`,
      ],
      tex: t`\text{general } n^{r},\qquad \text{symmetric } \binom{n+r-1}{r},\qquad \text{antisymmetric } \binom{n}{r}`,
      show: { view: 'viz', scene: 'rank3-cube', params: { tensor: 'random' } },
      widget: { type: 'count', n: 3, r: 2, kind: 'symmetric' },
    },
    {
      title: 'Stress and inertia',
      text: [
        t`The Cauchy stress $\sigma_{ij}$ is symmetric, because a tiny cube with unequal shear on its faces would spin up without limit. So stress has 6 components in three dimensions, not 9.`,
        t`A symmetric tensor has a set of perpendicular principal axes where it is diagonal. For stress these are the directions of pure tension or compression; for the inertia tensor they are the axes a body spins about without wobble.`,
      ],
      tex: t`t_{i} = \sigma_{ij}\,n^{j},\qquad \sigma_{ij} = \sigma_{ji}`,
      show: { view: 'all', scene: 'stress-cube', params: {}, entry: 'cauchy-stress' },
    },
    {
      title: 'The field strength is antisymmetric',
      text: [
        t`The electromagnetic field tensor $F_{\mu\nu}$ is antisymmetric. In four dimensions that leaves $4\cdot 3/2 = 6$ components, exactly the three of the electric field and the three of the magnetic field.`,
        t`It is built as an antisymmetrised derivative of the potential, which makes the antisymmetry automatic.`,
      ],
      tex: t`F_{\mu\nu} = \partial_{\mu}A_{\nu} - \partial_{\nu}A_{\mu} = 2\,\partial_{[\mu}A_{\nu]}`,
      show: { view: 'all', scene: 'lorentz', params: { beta: 0.5 }, entry: 'maxwell-tensor', step: 'antisymmetrize' },
      widget: { type: 'count', n: 4, r: 2, kind: 'antisymmetric' },
    },
    {
      title: 'Symmetric meets antisymmetric',
      text: [
        t`Contract a symmetric tensor with an antisymmetric one over both slots and you always get zero. The proof is three moves: rename the dummies, use both symmetries, and notice the expression equals its own negative.`,
        t`This small fact is used everywhere. For example, the geodesic equation contracts $\Gamma^{\lambda}{}_{\mu\nu}$ with the symmetric $\dot x^{\mu}\dot x^{\nu}$, so the antisymmetric part of a connection, its torsion, never changes a geodesic.`,
      ],
      tex: t`S^{ij}A_{ij} = S^{ji}A_{ji} = S^{ij}(-A_{ij}) \;\Rightarrow\; S^{ij}A_{ij} = 0`,
      show: { view: 'all', expr: t`S^{ij}\,A_{ij}`, style: 'penrose', step: 'relabel' },
    },
    {
      title: 'The symmetries of Riemann',
      text: [
        t`The Riemann tensor $R_{\rho\sigma\mu\nu}$ is antisymmetric in its first pair and in its last pair, symmetric under swapping the pairs, and obeys a cyclic identity. Together these leave $n^{2}(n^{2}-1)/12$ components.`,
        t`That gives 1 in two dimensions (the Gaussian curvature), 6 in three and 20 in four. Set the counter to Riemann and check it.`,
      ],
      tex: t`R_{\rho\sigma\mu\nu} = -R_{\sigma\rho\mu\nu} = -R_{\rho\sigma\nu\mu} = R_{\mu\nu\rho\sigma},\qquad R_{\rho[\sigma\mu\nu]} = 0`,
      show: { view: 'all', scene: 'rank3-cube', params: { tensor: 'random' }, entry: 'riemann-tensor' },
      widget: { type: 'count', n: 4, r: 4, kind: 'riemann' },
      deeper: {
        title: 'Young tableaux',
        text: t`The ways a tensor's slots can be symmetrised are classified by Young tableaux, which label the irreducible representations of $GL(n)$ inside $V^{\otimes r}$. The Riemann tensor lives in the representation of the $2\times 2$ square tableau. With a metric you can also split off traces: the trace-free part of Riemann is the Weyl tensor.`,
      },
    },
  ],
};
