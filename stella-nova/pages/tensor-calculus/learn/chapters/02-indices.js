// Chapter 2: upper and lower indices. Beat schema: learn/index.js header.
const t = String.raw;

export default {
  id: 'indices',
  title: 'Upper and lower indices',
  blurb: 'Why some indices sit up and some sit down: arrows change against the basis, measurements change with it.',
  beats: [
    {
      title: 'Components of an arrow',
      text: [
        t`Pick a basis: two arrows $\vec e_{1}$ and $\vec e_{2}$ in the plane. Any arrow $\vec v$ is some amount of the first plus some amount of the second. Those amounts are the components $v^{1}$ and $v^{2}$.`,
        t`We write the label of a component upstairs, $v^{i}$, and the label of a basis vector downstairs, $\vec e_{i}$. The two heights are a promise: in $v^{i}\vec e_{i}$ every upper label meets a lower one, and the whole thing is the same arrow in any basis.`,
      ],
      tex: t`\vec v = v^{1}\vec e_{1} + v^{2}\vec e_{2} = v^{i}\,\vec e_{i}`,
      show: { view: 'all', scene: 'upper-lower', params: { s: 1 }, expr: t`v^{i}\,e_{i}`, pick: 'i' },
    },
    {
      title: 'Stretch the ruler',
      text: [
        t`Now measure in centimetres instead of metres. The new basis arrows are a hundred times shorter, so you need a hundred times more of them to build the same $\vec v$. The components grow while the basis shrinks.`,
        t`That is what contravariant means: the components vary against the basis. Drag the slider. The arrow in the 3D view stays still, the basis arrows shrink or grow, and the numbers move the other way.`,
      ],
      tex: t`\vec e'_{i} = \tfrac{1}{s}\,\vec e_{i}\quad\Longrightarrow\quad v'^{i} = s\,v^{i}`,
      show: { view: 'all', scene: 'upper-lower', params: { s: 2 } },
      widget: { type: 'stretch', v: [1.2, 0.8], w: [0.9, 0.5] },
    },
    {
      title: 'The gradient is a covector',
      text: [
        t`Take a temperature field $f(x)$ and ask how fast it rises along each axis. The answers $\partial_{i} f = \partial f/\partial x^{i}$ are numbers, but they behave in the opposite way.`,
        t`Switch to centimetres again. The temperature rises a hundred times less per centimetre than per metre, so the components shrink when the basis shrinks. They vary with the basis: covariant. Their index sits downstairs.`,
        t`Picture a covector as a stack of level planes, the surfaces where $f$ is constant. The closer the planes, the larger the components.`,
      ],
      tex: t`\partial'_{i} f = \frac{\partial x^{j}}{\partial x'^{i}}\,\partial_{j} f,\qquad x' = s\,x\ \Rightarrow\ \partial'_{i} f = \tfrac{1}{s}\,\partial_{i} f`,
      show: { view: 'viz', scene: 'upper-lower', params: { s: 0.5, covector: true }, expr: t`\partial_{i} f` },
    },
    {
      title: 'Arrows pierce planes',
      text: [
        t`An arrow and a stack of planes give a number together: how many planes the arrow crosses. That count is $\omega_{i}v^{i}$, and it is the same in every basis, because one side grows exactly as much as the other shrinks.`,
        t`Drag the tips of $\vec e_{1}$ and $\vec e_{2}$ below. The components $v^{i}$ and $\omega_{i}$ jump around, and the pairing does not move.`,
      ],
      tex: t`\omega(\vec v) = \omega_{i}\,v^{i} = \omega'_{i}\,v'^{i}`,
      show: { view: 'all', scene: 'dual-basis', params: {}, expr: t`\omega_{i}\,v^{i}`, step: 'contract' },
      widget: { type: 'basis-drag', v: [1.4, 0.9], w: [0.7, -0.4] },
    },
    {
      title: 'The dual basis',
      text: [
        t`For each basis there is a matching set of covectors, the dual basis $\vec e^{\,i}$. Each one reads off one component: $\vec e^{\,i}(\vec v) = v^{i}$. In pictures, the planes of $\vec e^{\,1}$ are parallel to $\vec e_{2}$ and spaced so that $\vec e_{1}$ crosses exactly one gap.`,
        t`Now the heights flip: a covector's components have lower labels and its basis covectors have upper labels, so $\omega = \omega_{i}\vec e^{\,i}$ again pairs every upper label with a lower one.`,
      ],
      tex: t`\vec e^{\,i}(\vec e_{j}) = \delta^{i}{}_{j},\qquad v^{i} = \vec e^{\,i}(\vec v),\qquad \omega_{i} = \omega(\vec e_{i})`,
      show: { view: 'all', scene: 'dual-basis', params: { shear: 0.4 }, entry: 'kronecker-delta' },
      deeper: {
        title: 'The dual space',
        text: t`The covectors on $V$ form their own vector space $V^{*}$, the dual space, of the same dimension. There is no natural way to match a vector with a covector until you choose extra structure (a metric, chapter 4). But $V^{**}$ is naturally the same as $V$: a vector is a machine that eats covectors, $\vec v(\omega) = \omega(\vec v)$. That symmetry is why upper and lower indices play such even roles.`,
      },
    },
    {
      title: 'Heights are type checking',
      text: [
        t`An index height tells you how a quantity changes under a change of basis. So the heights work like types in a program. A valid equation has the same free indices on both sides, at the same heights, and each summed index appears once up and once down.`,
        t`Try it. In each expression, mark the indices that are free (not summed), or say that the expression breaks the rule.`,
      ],
      tex: t`\underbrace{A^{i}{}_{j}\,v^{j}}_{\text{free } i} = \underbrace{u^{i}}_{\text{free } i}`,
      show: { view: 'tex', expr: t`A^{i}{}_{j}\,v^{j} = u^{i}` },
      widget: {
        type: 'quiz', items: [
          { src: t`A^{i}{}_{j} v^{j}`, free: ['i'] },
          { src: t`\omega_{i} v^{i}`, free: [] },
          { src: t`T^{ij} S_{jk}`, free: ['i', 'k'] },
          { src: t`v^{i} w^{i}`, free: null },
          { src: t`g_{ij} u^{i} + w_{j}`, free: ['j'] },
        ],
      },
    },
    {
      title: 'Arrows and stacks in three dimensions',
      text: [
        t`The 3D view keeps one rule everywhere. Each upper index is drawn as an arrow. Each lower index is drawn as a stack of planes. A type $(1,1)$ tensor such as a linear map takes an arrow to an arrow; a type $(0,2)$ tensor takes two arrows to a number.`,
        t`The same colours run through the TeX, the Penrose diagram legs and the 3D glyphs. Pick an index with the Indices lens and it lights up in all three views.`,
      ],
      tex: t`A^{i}{}_{j}:\ \text{arrow}\mapsto\text{arrow},\qquad g_{ij}:\ (\text{arrow},\text{arrow})\mapsto\text{number}`,
      show: { view: 'all', scene: 'upper-lower', params: { s: 1, covector: true }, expr: t`A^{i}{}_{j}\,v^{j}`, pick: 'j', style: 'penrose' },
    },
  ],
};
