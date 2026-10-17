// Chapter 3: Einstein summation. Beat schema: learn/index.js header.
const t = String.raw;

export default {
  id: 'summation',
  title: 'Einstein summation',
  blurb: 'A repeated index, once up and once down, means a sum. Learn to see every hidden term.',
  beats: [
    {
      title: 'Drop the sigma',
      text: [
        t`Tensor formulas are full of sums over indices. Einstein noticed that in every sum he wrote, the summed index appeared exactly twice, once up and once down. So he stopped writing the $\Sigma$.`,
        t`The rule is short: in one term, an index that appears once up and once down is summed over all its values. Nothing else is summed.`,
      ],
      tex: t`\sum_{i=1}^{n} v^{i}\,\vec e_{i}\ \equiv\ v^{i}\,\vec e_{i}`,
      show: { view: 'all', expr: t`v^{i}\,e_{i}`, entry: 'einsum-attention', step: 'expandSum' },
    },
    {
      title: 'Free and dummy indices',
      text: [
        t`In $A^{i}{}_{j}v^{j}$ the index $\I{j}$ appears twice, so it is summed. It is a dummy index: it names nothing outside the term, and you could call it $\I{k}$ without changing anything. The index $\I{i}$ appears once. It is free: it labels the components of the result, and the expression is really $n$ separate equations, one for each value of $\I{i}$.`,
        t`Expand it below. Change the dimension and watch the number of terms.`,
      ],
      tex: t`u^{i} = A^{i}{}_{j}\,v^{j}\quad\Longleftrightarrow\quad u^{i} = \sum_{j=1}^{n} A^{i}{}_{j}\,v^{j}\ \ \text{for each } i`,
      show: { view: 'all', expr: t`A^{i}{}_{j}\,v^{j}`, pick: 'j' },
      widget: { type: 'sum-expand', src: t`A^{i}{}_{j} v^{j}`, n: 3 },
    },
    {
      title: 'Count the terms',
      text: [
        t`Each dummy index multiplies the work by $n$. With two dummies, every component is a sum of $n^{2}$ products. With the four free indices of the Riemann tensor and the sums inside it, a hand calculation in four dimensions runs to thousands of products, which is why the notation matters.`,
        t`Here $\I{j}$ and $\I{k}$ are both dummies and $\I{i}$ is free, so each component of the result is a sum of $n^{2}$ terms.`,
      ],
      tex: t`w^{i} = T^{ij}\,S_{jk}\,u^{k}`,
      show: { view: 'all', scene: 'contraction', params: {}, expr: t`T^{ij}\,S_{jk}\,u^{k}`, style: 'penrose' },
      widget: { type: 'sum-expand', src: t`T^{ij} S_{jk} u^{k}`, n: 2 },
    },
    {
      title: 'Rename, never reuse',
      text: [
        t`Because a dummy name is private to its term, you may rename it at will: $a^{i}b_{i} = a^{j}b_{j}$. But one name can only be used for one sum. The square of $a^{i}b_{i}$ is not $a^{i}b_{i}a^{i}b_{i}$, where $\I{i}$ would appear four times. It is $a^{i}b_{i}\,a^{j}b_{j}$.`,
        t`Most errors in index calculations come from a name used twice. When you substitute one formula into another, rename the dummies first.`,
      ],
      tex: t`(a^{i}b_{i})^{2} = a^{i}b_{i}\,a^{j}b_{j}\ \neq\ a^{i}b_{i}\,a^{i}b_{i}`,
      show: { view: 'tex', expr: t`a^{i}b_{i}\,a^{j}b_{j}`, entry: 'dot-product-metric', step: 'contract' },
    },
    {
      title: 'Which index is free?',
      text: [
        t`A quick check of the rules. For each expression, mark the free indices. If an index appears twice at the same height, or three times, the expression is not valid.`,
      ],
      tex: t`\text{free: once per term}\qquad\text{dummy: once up, once down}`,
      show: { view: 'tex', expr: t`R^{\rho}{}_{\sigma\rho\nu}` },
      widget: {
        type: 'quiz', items: [
          { src: t`R^{\rho}{}_{\sigma\rho\nu}`, free: ['sigma', 'nu'] },
          { src: t`\Gamma^{\lambda}{}_{\mu\nu} v^{\mu} v^{\nu}`, free: ['lambda'] },
          { src: t`F_{\mu\nu} F^{\mu\nu}`, free: [] },
          { src: t`T^{a}{}_{b} u^{b} w^{b}`, free: null },
          { src: t`\partial_{\mu} F^{\mu\nu}`, free: ['nu'] },
          { src: t`A^{i}{}_{i}`, free: [] },
        ],
      },
    },
    {
      title: 'The delta substitutes',
      text: [
        t`The Kronecker delta in a sum does one thing: it renames. In $\delta^{i}{}_{j}v^{j}$ only the term with $j=i$ survives, so the result is $v^{i}$. When a delta meets an index, cross it out and replace the index.`,
        t`Its trace counts dimensions: $\delta^{i}{}_{i} = 1 + 1 + \cdots = n$.`,
      ],
      tex: t`\delta^{i}{}_{j}\,v^{j} = v^{i},\qquad \delta^{i}{}_{i} = n`,
      show: { view: 'all', entry: 'kronecker-delta', step: 'contract', style: 'penrose' },
      widget: { type: 'sum-expand', src: t`\delta^{i}{}_{j} v^{j}`, n: 3, values: 'delta' },
    },
    {
      title: 'Einsum in code',
      text: [
        t`Array libraries took the notation directly. In NumPy, PyTorch or JAX, einsum('ij,j->i', A, v) is $A^{i}{}_{j}v^{j}$: letters that appear in the inputs and not in the output are summed.`,
        t`Attention in a transformer is a contraction. The score of query $\I{i}$ against key $\I{j}$ is $Q_{ia}K_{ja}$, summed over the feature index $\I{a}$. Code does not track heights because it works in a fixed orthonormal basis, where upper and lower components are equal.`,
      ],
      tex: t`S_{ij} = Q_{ia}\,K_{ja}\quad\longleftrightarrow\quad \texttt{einsum('ia,ja->ij', Q, K)}`,
      show: { view: 'all', entry: 'einsum-attention', style: 'network' },
      deeper: {
        title: 'Summation is the natural pairing',
        text: t`The sum $\omega_{i}v^{i}$ is not a convention laid on top of the algebra. It is the only basis-free way to combine a vector and a covector into a number: the evaluation map $V^{*}\otimes V\to\mathbb{R}$. Every contraction in this page is that map applied to one upper and one lower slot.`,
      },
    },
  ],
};
