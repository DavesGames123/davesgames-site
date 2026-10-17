// Chapter 1: what a tensor is. Beat schema: learn/index.js header.
const t = String.raw;

export default {
  id: 'tensor',
  title: 'What a tensor is',
  blurb: 'A tensor is a machine with slots. It eats vectors and covectors and gives back a number, linear in each slot.',
  beats: [
    {
      title: 'A machine with slots',
      text: [
        t`Forget arrays of numbers for a moment. A tensor is a machine. It has a fixed number of slots, you put a geometric object in each slot, and it gives you back one number.`,
        t`The dot product is the first example most people meet. It has two slots, and it takes two arrows $\vec u$ and $\vec v$ to the number $\vec u\cdot\vec v$. That number does not care which axes you drew on the page.`,
      ],
      tex: t`T(\vec u,\vec v) \;=\; T_{ij}\,u^{i}\,v^{j}`,
      show: { view: 'all', scene: 'transform-rank2', params: { mode: 'passive', kind: 'rotate' }, expr: t`T_{ij}\,u^{i} v^{j}`, style: 'penrose' },
      deeper: {
        title: 'Multilinear maps',
        text: t`Formally, a tensor of type $(p,q)$ on a vector space $V$ is a multilinear map $T: V^{*}\times\cdots\times V^{*}\times V\times\cdots\times V \to \mathbb{R}$ with $p$ covector slots and $q$ vector slots. In finite dimensions this space is the tensor product $V\otimes\cdots\otimes V\otimes V^{*}\otimes\cdots\otimes V^{*}$.`,
      },
    },
    {
      title: 'Scalars, vectors and covectors',
      text: [
        t`A machine with no slots is a scalar: a single number, such as a temperature at one point. Every observer agrees on it.`,
        t`A vector is an arrow, a little displacement or a velocity. A covector is a machine with one vector slot. It measures arrows: feed it $\vec v$ and it gives the number $\omega(\vec v)$. The gradient of a function is the covector you know best. It tells you how fast the function rises along any arrow you choose.`,
      ],
      tex: t`\omega(\vec v) \;=\; \omega_{i}\,v^{i}`,
      show: { view: 'all', scene: 'dual-basis', params: {}, expr: t`\omega_{i}\,v^{i}` },
    },
    {
      title: 'Linear in every slot',
      text: [
        t`The word that makes all of this work is linear. Double the arrow in one slot, and the output doubles. Put a sum in a slot, and the output is the sum of the outputs.`,
        t`Because of that, you only need to know what the machine does to the basis vectors. The numbers $T_{ij} = T(\vec e_{i},\vec e_{j})$ are the components. They are the machine's answers on the basis, nothing more.`,
      ],
      tex: t`T(a\vec u + b\vec w,\ \vec v) = a\,T(\vec u,\vec v) + b\,T(\vec w,\vec v), \qquad T_{ij} = T(\vec e_{i},\vec e_{j})`,
      show: { scene: 'outer-product', params: {}, expr: t`T_{ij}` },
    },
    {
      title: 'Components are a shadow',
      text: [
        t`Here is the idea that the rest of the page builds on. The components depend on the basis. The tensor does not.`,
        t`Turn the slider. The frame rotates, all four numbers of $T_{ij}$ change, and yet the ellipse that $T$ draws stays where it is. The trace and the determinant also stay fixed, because they are properties of the machine, not of the frame.`,
      ],
      tex: t`T'_{ij} = R^{k}{}_{i}\,R^{l}{}_{j}\,T_{kl}`,
      show: { view: 'all', scene: 'transform-rank2', params: { mode: 'passive', kind: 'rotate' }, entry: 'change-of-basis', step: 'transform' },
      widget: { type: 'rotate-rank2', T: [[2, 0.6], [0.6, 1]] },
    },
    {
      title: 'The type of a tensor',
      text: [
        t`We count slots by kind. A tensor of type $(p,q)$ has $p$ upper indices and $q$ lower indices. Upper indices belong to vector-like slots, lower indices to covector-like slots. Chapter 2 says what that means in pictures.`,
        t`In $n$ dimensions a type $(p,q)$ tensor has $n^{p+q}$ components. The Riemann tensor $R^{\rho}{}_{\sigma\mu\nu}$ is type $(1,3)$, so in four dimensions it has $4^4 = 256$ components, before its symmetries cut the count to 20.`,
      ],
      tex: t`T^{i_1\cdots i_p}{}_{j_1\cdots j_q}\quad\longleftrightarrow\quad \text{type }(p,q),\ \ n^{p+q}\ \text{components}`,
      show: { scene: 'rank3-cube', params: {}, expr: t`R^{\rho}{}_{\sigma\mu\nu}`, style: 'penrose' },
    },
    {
      title: 'Old friends',
      text: [
        t`You have met many tensors without the name. The identity map is the Kronecker delta $\delta^{i}{}_{j}$, type $(1,1)$. A linear map is a type $(1,1)$ tensor: it takes a vector and gives a vector. The dot product is the metric $g_{ij}$, type $(0,2)$. The stress in a beam and the inertia of a spinning top are both type $(0,2)$ in their usual forms.`,
        t`The delta is the simplest of all. Its components are 1 on the diagonal and 0 elsewhere, and they stay that way in every basis.`,
      ],
      tex: t`\delta^{i}{}_{j} = \begin{cases}1 & i=j\\ 0 & i\neq j\end{cases}`,
      show: { view: 'all', entry: 'kronecker-delta' },
    },
    {
      title: 'Shape is not enough',
      text: [
        t`A grid of numbers is not a tensor just because it has the right shape. What makes it a tensor is how its numbers change when you change the basis: one factor of the change matrix, or its inverse, for each index.`,
        t`Chapter 8 shows a famous array with three indices that fails this test: the Christoffel symbols $\Gamma^{\lambda}{}_{\mu\nu}$. They have the shape of a type $(1,2)$ tensor but pick up an extra term when coordinates bend.`,
      ],
      tex: t`\text{tensor}\iff T'^{i}{}_{j} = (A^{-1})^{i}{}_{k}\,A^{l}{}_{j}\,T^{k}{}_{l}\ \text{for every basis change } A`,
      show: { scene: 'christoffel', params: {}, expr: t`\Gamma^{\lambda}{}_{\mu\nu}` },
      deeper: {
        title: 'Two definitions that agree',
        text: t`Physicists often define a tensor as "an array that transforms like a tensor". Mathematicians define it as a multilinear map, or as an element of $V^{\otimes p}\otimes (V^{*})^{\otimes q}$. They agree: if you write a multilinear map in two bases, multilinearity forces exactly the transformation law. The array definition is the shadow, the map is the object.`,
      },
    },
  ],
};
