// ============================================================================
//  ALPHA QUDITS  ·  webs/scenes/genres.js  ·  the six genres of link
// ----------------------------------------------------------------------------
//  A link's genre is the pair of its end dimensions, larger end first. With
//  ends of dimension 2 to 4 there are six. The upper part of each cell is
//  derived (the read cap of the Letter: readable when d1 d2 <= 6); the amber
//  band under it is the deck's conjectured sector of physics.
//
//  step 'derived'  the six cells, d1 d2 and readable or dark
//  step 'sectors'  the conjectured sector band; "by name" on four cells
//  step 'parts'    the compendium Part of each cell and its counts of
//                  theorems, conditional theorems and open results
//
//  GREP MAP   (grep -n "<anchor>" genres.js)
//    function cells ... the triangle layout (larger end = row)
//    draw( ............ the frame
// ============================================================================
import { C, font, label, setBounds, clamp, rgba, ease, rrect } from '../draw.js';
import { gradeChip } from '../draw.js';
import { GENRES, PARTS, GRADE_COLORS } from '../data.js';

const STEPS = [{ id: 'derived', label: 'Derived' }, { id: 'sectors', label: 'Conjectured sectors' }, { id: 'parts', label: 'Parts' }];
const PERIOD = 8;

export function cells(v) {
  const gap = 8, s = clamp(Math.min((v.w - 24 - 2 * gap) / 3, (v.h - 96 - 2 * gap) / 3), 70, 200);
  const x0 = v.x + (v.w - 3 * s - 2 * gap) / 2, y0 = v.y + 34;
  return GENRES.map(gn => {
    const row = gn.d[0] - 2, col = gn.d[1] - 2;
    return { gn, x: x0 + col * (s + gap), y: y0 + row * (s + gap), s };
  });
}

export default {
  id: 'genres',
  title: 'Six genres of link',
  steps: STEPS,
  autoKey: 'step',
  analogy: {
    right: 'A table of types sorts every link by one pair of numbers, its two end dimensions, the way the periodic table sorts atoms by one number. The read cap of the Letter splits the table cleanly: two readable cells and four dark ones.',
    breaks: 'A periodic table is filled in from measurement. Here only the top of each cell is derived. Which part of physics a cell stands for is a conjecture, and for four cells the deck says the match is by name only.',
  },
  height: W => Math.round(clamp(W * 1.02 + 70, 400, 690)),
  init(p) { return { step: STEPS.some(s => s.id === p.step) ? p.step : 'derived' }; },
  controls() { return [{ key: 'step', label: 'Step', options: STEPS.map(s => ({ v: s.id, label: s.label })) }]; },
  caption(st) {
    if (st.step === 'derived') return 'Derived: a link is readable exactly when the product of its end dimensions is at most 6. That leaves (2,2) and (3,2) readable and the other four dark.';
    if (st.step === 'sectors') return 'Conjectured: the deck matches each genre to a sector of physics. For (4,2), (3,3), (4,3) and (4,4) it says the match is by name only.';
    return 'The compendium has one Part per genre, VI to XI. Together they hold 17 theorems, 68 conditional theorems and 78 open results (counts from the talk deck).';
  },
  draw(g, env, st, t) {
    const v = env.view; setBounds(v);
    if (st.auto) { const k = Math.floor((t - st.since) / PERIOD); st.step = STEPS[((k % STEPS.length) + STEPS.length) % STEPS.length].id; }
    const cs = cells(v), s = cs[0].s, fs = clamp(s / 9.5, 11, 15);
    const phase = ease(((t - st.since) % PERIOD) / 0.8);
    label(g, 'larger end →  rows 2, 3, 4   ·   smaller end →  columns 2, 3, 4', v.x + v.w / 2, v.y + 14, { font: font(Math.max(11, fs * 0.85)), color: C.dim });
    const band = st.step !== 'derived';
    for (const c of cs) {
      const { gn, x, y } = c, top = band ? s * 0.5 : s, col = gn.readable ? C.read : C.dark;
      g.save(); g.fillStyle = rgba(col, 0.08); g.strokeStyle = rgba(col, 0.6); g.lineWidth = 1.4;
      rrect(g, x, y, s, s, 10); g.fill(); g.stroke(); g.restore();
      label(g, `(${gn.d[0]},${gn.d[1]})`, x + s / 2, y + top * 0.3, { font: font(fs * 1.35, 600, true) });
      label(g, `d₁d₂ = ${gn.product}`, x + s / 2, y + top * 0.56, { font: font(fs * 0.9), color: C.dim });
      label(g, gn.readable ? 'readable' : 'dark', x + s / 2, y + top * 0.8, { font: font(fs, 600), color: col });
      if (band) {
        const a = st.auto ? phase : 1, by = y + s * 0.52, bh = s * 0.46, amb = GRADE_COLORS.conjectured;
        g.save(); g.globalAlpha *= a; g.fillStyle = rgba(amb, 0.16); g.strokeStyle = rgba(amb, 0.55);
        rrect(g, x + 4, by, s - 8, bh, 7); g.fill(); g.stroke(); g.restore();
        if (st.step === 'sectors') {
          label(g, gn.sector, x + s / 2, by + bh * 0.36, { font: font(fs * 0.9, 600), color: amb, alpha: a });
          label(g, gn.byName ? 'by name only' : 'conjectured', x + s / 2, by + bh * 0.72, { font: font(fs * 0.8), color: C.dim, alpha: a });
        } else {
          const P = PARTS.find(p => p.part === gn.part);
          label(g, 'Part ' + gn.part, x + s / 2, by + bh * 0.3, { font: font(fs * 0.9, 600), color: amb, alpha: a });
          const n = P.n, w3 = (s - 20) / 3;
          ['theorem', 'conditional', 'open'].forEach((k, i) => label(g, String(n[i]), x + 10 + w3 * (i + 0.5), by + bh * 0.7, { font: font(fs, 600), color: GRADE_COLORS[k], alpha: a }));
        }
      }
    }
    // the empty upper-right of the triangle holds the key
    const k = cs.find(c => c.gn.d[0] === 2 && c.gn.d[1] === 2), kx = k.x + k.s + 8 + k.s, ky = k.y + 6;
    const right = v.x + v.w - 12;
    if (st.step === 'parts') {
      let yy = ky + 10;
      for (const g0 of ['theorem', 'conditional', 'open']) { gradeChip(g, right, yy, g0, { align: 'right', px: Math.max(11, fs * 0.8) }); yy += 26; }
    } else {
      label(g, 'a link of type', right, ky + 10, { font: font(fs * 0.85), color: C.dim, align: 'right' });
      label(g, '(larger end, smaller end)', right, ky + 30, { font: font(fs * 0.85), color: C.dim, align: 'right' });
    }
    const ny = cs[cs.length - 1].y + s + 22;
    label(g, 'Ends of dimension 2 to 4: box 1.7, "Conjecture 0", graded a conditional theorem.', v.x + v.w / 2, ny, { font: font(Math.max(11, fs * 0.82)), color: C.dim });
    label(g, 'A one-dimensional end is excluded at the axiom (theorem 2.9).', v.x + v.w / 2, ny + 18, { font: font(Math.max(11, fs * 0.82)), color: C.dim });
  },
};
