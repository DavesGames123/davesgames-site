// ============================================================================
//  DIAGRAM LEGEND  ·  one small panel per style: glyph + plain sentence
// ----------------------------------------------------------------------------
//  Each glyph is a real layout of a tiny expression, drawn with the same
//  renderer as the main diagram, so the legend can never disagree with it.
//  legendItems() is DOM-free (tests read it). mountLegend() writes the panel
//  into an element. The page calls this view the Penrose diagram, in
//  three styles. Feynman diagrams are on the particle-collider page, and
//  the CORE credits link there; the legend does not name them.
//
//  EXPORTS   (jump with grep -n "<anchor>" legend.js)
//      LEGEND_NOTE .... "export const LEGEND_NOTE"
//      STYLE_INFO ..... "export const STYLE_INFO"   name, origin, one line
//      legendItems .... "export function legendItems"
//      mountLegend .... "export function mountLegend"
// ============================================================================

import { layoutExpr } from './layout.js';
import { toSvgString } from './render.js';
import { parseStub } from './fixtures.js';

export const LEGEND_NOTE =
  'Penrose diagram (Roger Penrose, 1971). A line that joins two legs is a summed (contracted) index, ' +
  'so a Penrose diagram with no loose legs is a number.';

export const STYLE_INFO = {
  penrose: { name: 'Penrose diagram', origin: 'Roger Penrose, 1971',
    line: 'A tensor is a shape. Upper indices are legs up, lower indices are legs down. Joined legs are summed.' },
  birdtrack: { name: 'Penrose diagram, birdtrack style', origin: 'Predrag Cvitanović, Group Theory: Birdtracks, 2008',
    line: 'Each line has an arrow: it leaves an upper slot and enters a lower slot. Boxes symmetrise.' },
  network: { name: 'Penrose diagram, tensor-network style', origin: 'Physics and machine learning (einsum)',
    line: 'Boxes with legs. A bond is a summed index of size d. The einsum string under it does the same sum.' },
};

const GLYPHS = {
  penrose: [
    ['v^a', 'Vector', 'One leg up: one upper (contravariant) index.'],
    ['w_a', 'Covector', 'One leg down: one lower (covariant) index.'],
    ['v^a w_a', 'Contraction', 'An upper leg joins a lower leg. The joined line is a summed index, so this is a number.'],
    ['g_{ab}', 'Metric', 'A cap. It turns a leg over and so lowers an index.'],
    ['g^{ab}', 'Inverse metric', 'A cup. It raises an index.'],
    ['\\delta^a{}_b', 'Kronecker delta', 'A plain line: it changes nothing.'],
    ['\\epsilon_{abc}', 'Levi-Civita', 'A horizontal bar with one leg for each slot.'],
    ['T_{(ab)}', 'Symmetrise', 'A wavy bar: the mean over all orders of the legs, weight 1/n!.'],
    ['T_{[ab]}', 'Antisymmetrise', 'A straight bar: the same mean with a minus sign for odd orders.'],
    ['\\nabla_a v^b', 'Covariant derivative', 'A solid ring round the node, with one more lower leg. A dashed ring is the partial derivative.'],
    ['\\Gamma^a_{bc}', 'Christoffel symbol', 'A dashed outline: it is not a tensor.'],
  ],
  birdtrack: [
    ['v^a', 'Vector', 'The arrow leaves the node: an upper index.'],
    ['w_a', 'Covector', 'The arrow enters the node: a lower index.'],
    ['v^a w_a', 'Contraction', 'One line with one arrow, from the upper slot to the lower slot.'],
    ['\\delta^a{}_b', 'Kronecker delta', 'A plain line with an arrow.'],
    ['g^{ab}', 'Inverse metric', 'Both arrows leave: the metric turns the arrow round.'],
    ['T_{(ab)}', 'Symmetriser', 'A hollow box across the lines, weight 1/n!.'],
    ['T_{[ab]}', 'Antisymmetriser', 'A solid box across the lines, weight 1/n!, signs alternate.'],
    ['\\epsilon_{abc}', 'Levi-Civita', 'A bar with all lines in.'],
    ['\\nabla_a v^b', 'Derivative', 'A ring round the node with its own line.'],
  ],
  network: [
    ['v_i', 'Vector', 'A box with one open leg.'],
    ['A_{ij}', 'Matrix', 'Two open legs. The box does not show which index is upper.'],
    ['A_{ij} B_{jk}', 'Bond', 'A shared leg is summed. The number is its size d.'],
    ['A^i{}_i', 'Trace', 'A leg that loops back to its own box.'],
    ['Q_{id} K_{jd}', 'Attention scores', 'Queries and keys share the feature leg d: einsum("id,jd->ij").'],
  ],
};

export function legendItems(style = 'penrose', opts = {}) {
  const list = GLYPHS[style] || GLYPHS.penrose;
  return list.map(([tex, title, text]) => {
    const scene = layoutExpr(parseStub(tex), { style, indexColor: opts.indexColor, maxWidth: 400 });
    return { tex, title, text, svg: toSvgString(scene, { style, theme: opts.theme, background: false, scale: 0.7 }), scene };
  });
}

const LEGEND_CSS = `
.dg-legend{font:13px/1.45 Inter,system-ui,sans-serif}
.dg-legend-head{margin:0 0 2px}.dg-legend-head span{opacity:.65;font-size:12px}
.dg-legend-line{margin:0 0 8px;opacity:.85}
.dg-legend-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px 14px}
.dg-legend-list li{display:flex;gap:8px;align-items:center}
.dg-glyph{flex:0 0 auto;display:flex;align-items:center;justify-content:center;min-width:56px}
.dg-glyph svg{max-width:96px;height:auto}
.dg-legend-note{margin:10px 0 0;opacity:.75;font-size:12px}
`;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function mountLegend(el, style = 'penrose', opts = {}) {
  const info = STYLE_INFO[style] || STYLE_INFO.penrose;
  const items = legendItems(style, opts);
  el.classList.add('dg-legend');
  const doc = el.ownerDocument;
  if (doc && !doc.getElementById('dg-legend-style')) {
    const st = doc.createElement('style');
    st.id = 'dg-legend-style';
    st.textContent = LEGEND_CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }
  el.innerHTML =
    `<p class="dg-legend-head"><strong>${esc(info.name)}</strong> <span>${esc(info.origin)}</span></p>` +
    `<p class="dg-legend-line">${esc(info.line)}</p>` +
    `<ul class="dg-legend-list">` +
    items.map(it => `<li><span class="dg-glyph">${it.svg}</span><span class="dg-text"><b>${esc(it.title)}</b> ${esc(it.text)}</span></li>`).join('') +
    `</ul><p class="dg-legend-note">${esc(LEGEND_NOTE)}</p>`;
  return items;
}
