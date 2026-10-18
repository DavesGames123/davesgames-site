// Chapter 5: tensor product and contraction. Beat schema: learn/index.js header.
const t = String.raw;

export default {
  id: 'product',
  title: 'Tensor product and contraction',
  blurb: 'Two moves build every tensor expression: multiply to add slots, contract to remove them.',
  beats: [
    {
      title: 'The outer product',
      text: [
        t`Put two tensors side by side and you get a bigger one. The tensor product of a vector $\vec u$ and a covector $\omega$ is the type $(1,1)$ tensor with components $u^{i}\omega_{j}$: every component of one times every component of the other.`,
        t`From $2n$ numbers you get $n^{2}$. Move the sliders and watch the block of components: each row is a copy of $\omega$, scaled by one component of $\vec u$.`,
      ],
      tex: t`(\vec u\otimes\omega)^{i}{}_{j} = u^{i}\,\omega_{j}`,
      show: { view: 'all', scene: 'outer-product', params: {}, entry: 'tensor-product', step: 'product', style: 'penrose' },
      widget: { type: 'outer-product', u: [1, 2, -1], w: [0.5, -1, 2] },
    },
    {
      title: 'Types add',
      text: [
        t`The product of a type $(p,q)$ tensor and a type $(r,s)$ tensor has type $(p+r,\,q+s)$. The indices simply sit next to each other. No index is shared, so nothing is summed.`,
        t`In the Penrose diagram this is just drawing two nodes next to each other: the legs keep their places.`,
      ],
      tex: t`(T\otimes S)^{ab}{}_{c}{}^{d}{}_{ef} = T^{ab}{}_{c}\,S^{d}{}_{ef}`,
      show: { view: 'diagram', expr: t`T^{ab}{}_{c}\,S^{d}{}_{ef}`, style: 'penrose' },
    },
    {
      title: 'Contraction',
      text: [
        t`Contraction is the opposite move. Choose one upper slot and one lower slot, give them the same name, and sum. Each contraction removes one upper and one lower index, so the type drops from $(p,q)$ to $(p-1,q-1)$.`,
        t`In the 3D view the component block folds along the two matched axes and only the diagonal survives, summed. In the Penrose diagram the two legs join into one line.`,
      ],
      tex: t`T^{i}{}_{j}\ \longmapsto\ T^{i}{}_{i} = T^{1}{}_{1} + T^{2}{}_{2} + \cdots + T^{n}{}_{n}`,
      show: { view: 'all', scene: 'contraction', params: { mode: 'trace' }, entry: 'matrix-trace', step: 'trace', style: 'penrose' },
    },
    {
      title: 'Matrix multiplication is a contraction',
      text: [
        t`Form the product $A^{i}{}_{j}B^{k}{}_{l}$, a type $(2,2)$ tensor, then contract the lower index of $A$ with the upper index of $B$. What remains is the matrix product.`,
        t`Seen this way, a matrix times a vector, a matrix times a matrix and a dot product are the same operation with different slot counts.`,
      ],
      tex: t`(AB)^{i}{}_{l} = A^{i}{}_{j}\,B^{j}{}_{l}`,
      show: { view: 'all', scene: 'contraction', params: { mode: 'matvec' }, expr: t`A^{i}{}_{j}\,B^{j}{}_{l}` },
      widget: { type: 'sum-expand', src: t`A^{i}{}_{j} B^{j}{}_{l}`, n: 2 },
    },
    {
      title: 'Trace and determinant',
      text: [
        t`A full contraction leaves no free index, so it is a scalar, the same in every basis. The trace $A^{i}{}_{i}$ is the simplest.`,
        t`The determinant comes from the Levi-Civita symbol $\varepsilon_{ijk}$, which is $+1$ for an even permutation of $123$, $-1$ for an odd one and $0$ when two indices are equal. It is the signed volume of the box spanned by the columns.`,
      ],
      tex: t`\operatorname{tr}A = A^{i}{}_{i},\qquad \det A = \varepsilon_{ijk}\,A^{i}{}_{1}\,A^{j}{}_{2}\,A^{k}{}_{3}`,
      show: { view: 'all', scene: 'levi-civita', params: {}, entry: 'determinant-epsilon', step: 'contract' },
    },
    {
      title: 'Contract only up with down',
      text: [
        t`You cannot contract two lower indices directly, since the sum $T_{ii}$ is not the same in every basis. First raise one of them with the metric. The metric is what makes the contraction legal.`,
        t`This is how the Ricci tensor comes from Riemann: contract the upper index with the middle lower one. The scalar curvature needs the inverse metric for the last step.`,
      ],
      tex: t`R_{\sigma\nu} = R^{\rho}{}_{\sigma\rho\nu},\qquad R = g^{\sigma\nu}R_{\sigma\nu}`,
      show: { view: 'all', entry: 'ricci-scalar', step: 'contract', style: 'penrose' },
    },
    {
      title: 'The cross product, honestly',
      text: [
        t`The cross product of two vectors in three dimensions is a contraction with $\varepsilon$. Strictly the result is a covector (or a pseudovector): it changes sign under a mirror, which is how you can tell it was never an ordinary arrow.`,
        t`The orientation cube in the 3D view shows the six non-zero entries of $\varepsilon_{ijk}$, three positive and three negative.`,
      ],
      tex: t`(\vec u\times\vec v)_{i} = \varepsilon_{ijk}\,u^{j}\,v^{k}`,
      show: { view: 'all', scene: 'levi-civita', params: {}, entry: 'levi-civita-cross' },
      deeper: {
        title: 'Simple and entangled tensors',
        text: t`Not every tensor is a product $\vec u\otimes\omega$. A general $T^{i}{}_{j}$ is a sum of such products, and the least number of terms needed is its tensor rank (for matrices, the ordinary rank). For three or more slots, computing that rank is hard, and the same question in quantum mechanics is entanglement: a product state is a simple tensor.`,
      },
    },
  ],
};
