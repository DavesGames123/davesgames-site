// ============================================================================
//  ALPHA QUDITS  ·  webs/scenes/grades.js  ·  the compendium, Part by Part
// ----------------------------------------------------------------------------
//  Stacked bars of the compendium's boxed statements by Part: theorems,
//  conditional theorems, open results. Counts from the talk deck (generated
//  there by the compendium's index tool); the rows sum to 100, 109, 198.
//
//  step 'parts'    every Part, bars grow in from the left
//  step 'cells'    Parts VI to XI, one per genre, picked out
//  step 'webs'     the 17 particles on 16 webs, by the grade they rest on
//
//  GREP MAP   (grep -n "<anchor>" grades.js)
//    function bars ... the rows
//    function webs ... the particle tally bar
//    draw( ........... the frame
// ============================================================================
import { C, font, label, setBounds, clamp, rgba, ease } from '../draw.js';
import { legendRow } from '../draw.js';
import { PARTS, TOTALS, WEB_TALLY, GRADE_COLORS, GENRES, sum3 } from '../data.js';

const STEPS = [{ id: 'parts', label: 'All Parts' }, { id: 'cells', label: 'The six cells' }, { id: 'webs', label: 'Particle webs' }];
const PERIOD = 8;
const KEYS = ['theorem', 'conditional', 'open'];
const CELL_PARTS = new Set(GENRES.map(g => g.part));

function bars(g, v, st, grow, fs) {
  const lw = st.step === 'cells' ? clamp(v.w * 0.22, 80, 130) : clamp(v.w * 0.16, 46, 90), top = v.y + 40, rows = PARTS.length;
  const rh = clamp((v.h - 96) / (rows + 1.4), 14, 30), bw = v.w - lw - 52;
  const max = Math.max(...PARTS.map(p => p.n[0] + p.n[1] + p.n[2]));
  PARTS.forEach((p, i) => {
    const y = top + i * rh, dim = st.step === 'cells' && !CELL_PARTS.has(p.part);
    const al = dim ? 0.25 : 1;
    label(g, p.part, v.x + lw - 8, y + rh / 2, { font: font(fs, 600, true), color: C.text, align: 'right', alpha: al });
    let x = v.x + lw;
    KEYS.forEach((k, j) => {
      const w = bw * p.n[j] / max * grow;
      g.save(); g.globalAlpha *= al; g.fillStyle = rgba(GRADE_COLORS[k], 0.75); g.fillRect(x, y + 2, Math.max(0, w - 1), rh - 4); g.restore();
      x += w;
    });
    const tot = p.n[0] + p.n[1] + p.n[2];
    label(g, `${p.n.join(' · ')}`, x + 6, y + rh / 2, { font: font(Math.max(11, fs * 0.85)), color: C.dim, align: 'left', alpha: al * grow });
    if (st.step === 'cells' && !dim) {
      const gn = GENRES.find(q => q.part === p.part);
      label(g, `(${gn.d[0]},${gn.d[1]})`, v.x + 4, y + rh / 2, { font: font(Math.max(11, fs * 0.85), 500, true), color: C.accent, align: 'left' });
    }
    return tot;
  });
  const y = top + rows * rh + 8, s = sum3(PARTS);
  const txt = st.step === 'cells'
    ? `Parts VI to XI: ${TOTALS.cells.join(' · ')}`
    : `All: ${s.join(' · ')}   (theorems · conditional · open)`;
  label(g, txt, v.x + v.w / 2, y + 10, { font: font(fs, 600), color: C.text });
}

function webs(g, v, grow, fs) {
  const T = WEB_TALLY, parts = [['theorem', T.theorem], ['conditional', T.conditional], ['open', T.open], ['notInRelease', T.notInRelease]];
  const w = Math.min(v.w - 32, 620), x0 = v.x + (v.w - w) / 2, y = v.y + v.h * 0.42, h = clamp(v.h * 0.12, 30, 56);
  label(g, `${T.particles} particles drawn on ${T.webs} webs, by what each rests on`, v.x + v.w / 2, y - h * 0.9, { font: font(fs * 1.05, 600) });
  let x = x0;
  for (const [k, n] of parts) {
    const ww = w * n / T.particles * grow;
    g.save(); g.fillStyle = rgba(GRADE_COLORS[k], 0.8); g.fillRect(x, y, Math.max(0, ww - 2), h); g.restore();
    if (ww > 18) label(g, String(n), x + ww / 2, y + h / 2, { font: font(fs, 700), color: '#071014', halo: false });
    x += ww;
  }
  legendRow(g, x0, y + h + 22, w, ['theorem', 'conditional', 'open', 'notInRelease']);
  label(g, 'That a web is the named particle is a conjecture.', v.x + v.w / 2, y + h + 88, { font: font(fs * 0.95), color: GRADE_COLORS.conjectured });
}

export default {
  id: 'grades',
  title: 'The compendium, graded',
  steps: STEPS,
  autoKey: 'step',
  analogy: {
    right: 'A ledger with three columns keeps proved, conditional and open claims apart, so a reader can see at a glance how much of a large program rests on what. The deck counts every boxed statement this way.',
    breaks: 'A count of boxes is not a measure of truth. The deck itself warns that many theorems are exhaustive checks over a finite catalogue of webs, not proofs for every web, and every count here comes from the deck, not from the compendium.',
  },
  height: W => Math.round(clamp(W * 0.9 + 120, 440, 640)),
  init(p) { return { step: STEPS.some(s => s.id === p.step) ? p.step : 'parts' }; },
  controls() { return [{ key: 'step', label: 'Step', options: STEPS.map(s => ({ v: s.id, label: s.label })) }]; },
  caption(st) {
    return {
      parts: 'Release 0.1 of the compendium, a working draft: 100 theorems, 109 conditional theorems and 198 open results, by Part. Parts II and XVI hold tables only.',
      cells: 'Parts VI to XI, one per genre of link, hold 17 theorems, 68 conditional theorems and 78 open results.',
      webs: 'Of the 17 particles the deck draws on 16 webs, 1 rests on a theorem, 11 on conditional theorems, 2 on open results and 3 on results not in this release.',
    }[st.step];
  },
  draw(g, env, st, t) {
    const v = env.view; setBounds(v);
    if (st.auto) { const k = Math.floor((t - st.since) / PERIOD); st.step = STEPS[((k % STEPS.length) + STEPS.length) % STEPS.length].id; }
    const fs = clamp(v.w / 34, 11, 14), grow = st.auto ? ease(((t - st.since) % PERIOD) / 1.4) : 1;
    legendRow(g, v.x + 12, v.y + 14, v.w - 24, ['theorem', 'conditional', 'open']);
    if (st.step === 'webs') webs(g, v, grow, fs);
    else bars(g, v, st, grow, fs);
  },
};
