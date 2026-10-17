// Chapter 10: notation. Beat schema: learn/index.js header.
const t = String.raw;

export default {
  id: 'notation',
  title: 'Notation: four ways to write one thing',
  blurb: 'Component, abstract index, index-free and Penrose diagrams: four languages for the same tensors, each good at something.',
  beats: [
    {
      title: 'One statement, four languages',
      text: [
        t`Take the statement "the linear map $A$ applied to the vector $v$ gives $u$". Tensor calculus has four common ways to write it. Switch between them below; the content never changes, only what the notation makes easy to see.`,
      ],
      tex: t`u^{i} = A^{i}{}_{j}\,v^{j}`,
      show: { view: 'all', expr: t`A^{a}{}_{b}\,v^{b}`, style: 'penrose' },
      widget: { type: 'notation', form: 'component' },
    },
    {
      title: 'Component notation',
      text: [
        t`Here the indices are numbers from 1 to $n$ in a chosen basis or chart, and every symbol stands for an actual array of numbers. It is the notation for computing: you can put it straight into a program.`,
        t`Its weakness is that it hides which statements are true in every basis. $T^{1}{}_{1} = 0$ is a fact about one basis; $T^{i}{}_{i} = 0$ is a fact about the tensor.`,
      ],
      tex: t`u^{1} = A^{1}{}_{1}v^{1} + A^{1}{}_{2}v^{2},\qquad u^{2} = A^{2}{}_{1}v^{1} + A^{2}{}_{2}v^{2}`,
      show: { view: 'all', entry: 'change-of-basis', step: 'transform' },
      widget: { type: 'notation', form: 'component' },
    },
    {
      title: 'Abstract index notation',
      text: [
        t`Penrose's idea (1968): keep the indices, but let them name slots, not numbers. In $A^{a}{}_{b}v^{b}$ the letter $\I{a}$ says "this result has one upper slot" and the repeated $\I{b}$ says "these two slots are joined". No basis is chosen.`,
        t`Many relativity texts, following Wald, use Latin letters $a, b, c$ for abstract slots and Greek letters $\mu, \nu$ for components in a chart. An equation in abstract indices is true in every basis at once.`,
      ],
      tex: t`u^{a} = A^{a}{}_{b}\,v^{b}\qquad\text{(slots, not numbers)}`,
      show: { view: 'all', expr: t`A^{a}{}_{b}\,v^{b}`, style: 'penrose', pick: 'b' },
      widget: { type: 'notation', form: 'abstract' },
    },
    {
      title: 'Index-free notation',
      text: [
        t`Mathematicians often drop indices entirely. A tensor is a map and you write what it does to its arguments: $u = A(v)$, $g(X, Y)$, $\nabla_{X}Y$. The definition of curvature becomes a short statement about vector fields.`,
        t`This is clean for proofs, but every contraction must be spelled out in words, and long contractions of many tensors become hard to read.`,
      ],
      tex: t`R(X,Y)Z = \nabla_{X}\nabla_{Y}Z - \nabla_{Y}\nabla_{X}Z - \nabla_{[X,Y]}Z`,
      show: { view: 'tex', entry: 'riemann-tensor' },
      widget: { type: 'notation', form: 'free' },
    },
    {
      title: 'Penrose graphical notation',
      text: [
        t`Draw each tensor as a node. Each upper index is a leg going up, each lower index a leg going down. A contraction joins an upper leg to a lower leg. Free legs are free indices, so you can read the type of the result off the picture.`,
        t`The metric is a bend with two lower ends, so it turns an upward leg down; the inverse metric is the bend the other way. The delta is a plain line, which is why it disappears when you contract it. Epsilon is a bar across its legs.`,
      ],
      tex: t`A^{a}{}_{b}\,v^{b}\ \longleftrightarrow\ \text{node } A \text{ with its lower leg joined to the leg of } v`,
      show: { view: 'diagram', expr: t`A^{a}{}_{b}\,v^{b}`, style: 'penrose', step: 'contract' },
      widget: { type: 'notation', form: 'penrose' },
    },
    {
      title: 'Birdtracks and tensor networks',
      text: [
        t`Cvitanović's birdtracks extend Penrose's pictures for group theory: symmetrisers and antisymmetrisers become boxes across legs, and long algebra becomes moving lines around.`,
        t`Physics and machine learning use the same idea as tensor networks: matrix product states for quantum spin chains, and the einsum graphs of a neural network. Switch the diagram style to compare.`,
      ],
      tex: t`S_{ij} = Q_{ia}\,K_{ja}\quad\longleftrightarrow\quad Q\ \text{---}\ K`,
      show: { view: 'diagram', entry: 'einsum-attention', style: 'network' },
    },
    {
      title: 'Not Feynman diagrams',
      text: [
        t`Penrose diagrams can look like Feynman diagrams: lines and vertices. They are different tools. A Feynman diagram is one term in a perturbation series for a quantum scattering amplitude; its lines are particle propagators and it comes with an integral over momenta.`,
        t`A Penrose diagram is an exact equation in multilinear algebra. Every line is a summed index, every node a tensor, and two diagrams that can be deformed into each other are equal.`,
      ],
      tex: t`\text{Penrose: } T^{a}{}_{b}S^{b}{}_{c}\ \text{(exact)}\qquad \text{Feynman: a term in } \langle f\,|\,S\,|\,i\rangle\ \text{(a series)}`,
      show: { view: 'diagram', expr: t`T^{a}{}_{b}\,S^{b}{}_{c}`, style: 'birdtrack' },
    },
    {
      title: 'Shapes at a glance',
      text: [
        t`A last check that ties the notations together. The type $(p,q)$, the number of up and down legs, and the shape of the component array all carry the same information. A type $(1,2)$ tensor in three dimensions is a $3\times3\times3$ array with variance (up, down, down), drawn as a node with one leg up and two down.`,
        t`Mark the free indices of each expression. The free indices are the legs left loose in the diagram, and they decide the shape of the result.`,
      ],
      tex: t`T^{\mu}{}_{\nu\rho}\ \longleftrightarrow\ (1,2)\ \longleftrightarrow\ n\times n\times n,\ (\uparrow,\downarrow,\downarrow)`,
      show: { view: 'all', expr: t`\Gamma^{\lambda}{}_{\mu\nu}`, scene: 'rank3-cube', params: { tensor: 'christoffel' }, style: 'penrose' },
      widget: {
        type: 'quiz', items: [
          { src: t`R^{\rho}{}_{\sigma\mu\nu} V^{\sigma}`, free: ['rho', 'mu', 'nu'] },
          { src: t`g^{\mu\nu} R_{\mu\nu}`, free: [] },
          { src: t`\varepsilon_{ijk} u^{j} v^{k}`, free: ['i'] },
          { src: t`\nabla_{\mu} T^{\mu\nu} = 0`, free: ['nu'] },
          { src: t`F_{\mu\nu} = \partial_{\mu} A_{\rho}`, free: null },
        ],
      },
      deeper: {
        title: 'String diagrams',
        text: t`Penrose notation is the first example of a string diagram: the graphical language of a monoidal category, here finite-dimensional vector spaces with $\otimes$. Wires are objects (vector spaces), boxes are maps, joining wires is composition, the cup and cap are the duality maps $V\otimes V\to\mathbb{R}$ and $\mathbb{R}\to V\otimes V$ from a metric. The rules that let you slide and straighten wires are theorems of that category.`,
      },
    },
  ],
};
