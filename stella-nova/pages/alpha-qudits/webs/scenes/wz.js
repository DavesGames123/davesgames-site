// ============================================================================
//  ALPHA QUDITS  ·  webs/scenes/wz.js  ·  the W and the Z: one web, two reads
// ----------------------------------------------------------------------------
//  The deck's claim: the W and the Z are one web, and what tells them apart
//  is the read. The W is read along one line, the Z along two. The deck's
//  text does not give the web's structure, so the web is drawn as an
//  unlabelled region with faint strands, marked "structure not given"; only
//  the read lines are drawn firmly.
//
//  step 'web'     the one web
//  step 'w'       read along one line
//  step 'z'       read along two lines
//  step 'grades'  the four boxed results and their grades
//
//  GREP MAP   (grep -n "<anchor>" wz.js)
//    function region ... the web region and its faint strands
//    draw( ............. the frame
// ============================================================================
import { C, font, label, setBounds, clamp, rgba, ease } from '../draw.js';
import { gradeChip, panel } from '../draw.js';
import { WZ } from '../data.js';

const STEPS = [{ id: 'web', label: 'One web' }, { id: 'w', label: 'W: one line' }, { id: 'z', label: 'Z: two lines' }, { id: 'grades', label: 'Grades' }];
const PERIOD = 6.5;

function region(g, cx, cy, rx, ry, t) {
  g.save();
  g.fillStyle = rgba(C.imag, 0.06); g.strokeStyle = rgba(C.imag, 0.35); g.lineWidth = 1.2; g.setLineDash([4, 5]);
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.setLineDash([]); g.strokeStyle = rgba(C.dim, 0.18); g.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9 + 0.15 * Math.sin(t * 0.3 + i), b = a + 2.1;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * rx * 0.8, cy + Math.sin(a) * ry * 0.8);
    g.quadraticCurveTo(cx + Math.cos(a + 1) * rx * 0.2, cy + Math.sin(a + 1) * ry * 0.2, cx + Math.cos(b) * rx * 0.8, cy + Math.sin(b) * ry * 0.8);
    g.stroke();
  }
  g.restore();
}
function readLine(g, x0, y0, x1, y1, col, a) {
  g.save(); g.globalAlpha *= a; g.strokeStyle = col; g.lineWidth = 6; g.lineCap = 'round';
  g.shadowColor = col; g.shadowBlur = 10;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.restore();
}

export default {
  id: 'wz',
  title: 'The W and the Z',
  steps: STEPS,
  autoKey: 'step',
  analogy: {
    right: 'One object read two ways can give two different results, as one crystal shows different patterns along different axes. The deck makes the W and the Z one web and puts the difference in how it is read: along one line or along two.',
    breaks: 'A crystal has its structure in space, and the axes are directions. Here a read is an act of distillation, not a direction, and the deck does not give the web in a form we can draw. The region and its faint strands are a placeholder, not the compendium\'s web.',
  },
  height: W => Math.round(clamp(W * 0.86 + 40, 360, 560)),
  init(p) { return { step: STEPS.some(s => s.id === p.step) ? p.step : 'web' }; },
  controls() { return [{ key: 'step', label: 'Step', options: STEPS.map(s => ({ v: s.id, label: s.label })) }]; },
  caption(st) {
    return {
      web: 'The deck draws the W and the Z as one web. Its structure is not given in the deck text, so it is drawn here as a region only.',
      w: 'The W: the web read along one line. That this is the W is an open result (box 159.2).',
      z: 'The Z: the same web read along two lines. That this is the Z is an open result (box 159.1).',
      grades: 'The four boxed results: two open identifications, one conditional ratio of exactly 1/2, and the W to Z mass ratio, still open.',
    }[st.step];
  },
  draw(g, env, st, t) {
    const v = env.view; setBounds(v);
    if (st.auto) { const k = Math.floor((t - st.since) / PERIOD); st.step = STEPS[((k % STEPS.length) + STEPS.length) % STEPS.length].id; }
    const fs = clamp(v.w / 32, 11, 15), a = st.auto ? ease(((t - st.since) % PERIOD) / 0.8) : 1;
    const grades = st.step === 'grades';
    const rh = grades ? v.h * 0.32 : v.h * 0.62;
    const cx = v.x + v.w / 2, cy = v.y + 26 + rh / 2, rx = Math.min(v.w * 0.4, rh * 1.1), ry = rh * 0.42;
    region(g, cx, cy, rx, ry, t);
    label(g, 'one web (structure not given in the deck)', cx, cy - ry - 10, { font: font(fs * 0.9), color: C.dim });
    const L1 = [cx - rx * 0.92, cy - ry * 0.15, cx + rx * 0.92, cy + ry * 0.15];
    const L2 = [cx - rx * 0.8, cy + ry * 0.35, cx + rx * 0.8, cy + ry * 0.55];
    if (st.step === 'w' || st.step === 'z' || grades) readLine(g, ...L1, C.accent, grades ? 0.5 : a);
    if (st.step === 'z' || grades) readLine(g, ...L2, C.accent, grades ? 0.5 : a);
    if (st.step === 'w') label(g, 'W: read along one line', cx, cy + ry + 18, { font: font(fs * 1.1, 600), color: C.accent, alpha: a });
    if (st.step === 'z') label(g, 'Z: read along two lines', cx, cy + ry + 18, { font: font(fs * 1.1, 600), color: C.accent, alpha: a });
    if (!grades) {
      const y = v.y + v.h - 16;
      if (st.step !== 'web') gradeChip(g, cx, y, 'open', { align: 'center', text: st.step === 'w' ? 'that this read is the W: open (159.2)' : 'that this read is the Z: open (159.1)', px: Math.max(11, fs * 0.85) });
      else gradeChip(g, cx, y, 'conjectured', { align: 'center', text: 'that this web is the W and the Z: conjectured', px: Math.max(11, fs * 0.85) });
      return;
    }
    // the four results as rows
    const top = cy + ry + 22, rowH = Math.max(40, (v.y + v.h - top - 8) / WZ.length), pw = Math.min(v.w - 16, 640), px0 = cx - pw / 2;
    panel(g, px0, top - 6, pw, rowH * WZ.length + 4);
    WZ.forEach((r, i) => {
      const y = top + rowH * (i + 0.5) - 2;
      gradeChip(g, px0 + 10, y - (pw < 480 ? 9 : 0), r.grade, { px: 11 });
      const tx = pw < 480 ? px0 + 10 : px0 + 150;
      label(g, `${r.claim} (${r.box})`, tx, y + (pw < 480 ? 10 : 0), { font: font(Math.max(11, fs * 0.85)), align: 'left', color: C.text, alpha: a });
    });
  },
};
