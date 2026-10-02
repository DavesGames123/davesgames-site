// ============================================================================
//  PLANETARY GEARBOX  ·  analysis.js — ratio, lever diagram, speeds, equations
// ────────────────────────────────────────────────────────────────────────────
//  createAnalysis(els) fills the analysis panel for one gear set and mode:
//    #ratio .... the ratio i = ωin / ωout and its kind (reduction, overdrive,
//                reverse, direct, neutral)
//    #lever .... the lever diagram. The members sit on a line at places set
//                by the tooth counts (sun 0, carrier 1, ring 1 + Zs/Zr). Each
//                member's speed is drawn across the line. The Willis equation
//                says the speeds are a linear function of place, so the tips
//                always lie on one straight lever. A held member is a pivot.
//    #nums ..... live speeds and the derived numbers
//    #eqs ...... the equations with the live values put in
//  Plain Unicode maths in HTML (no KaTeX).
//
//  GREP MAP
//    const LEVER ......... member places on the lever
//    function formula .... the ratio formula of the current mode
//    function drawLever .. the lever diagram
//    function frame ...... per-frame numbers (every third frame)
// ============================================================================
import { NAMES, TAU } from './gears.js';

const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const MCOL = { S: '#ffd27a', C: '#8fa8ff', R: '#ff9f80', R1: '#ff9f80', C1: '#f0c060', C2: '#8fa8ff' };
export const SHORT = { S: 'Sun', C: 'Carrier', R: 'Ring', R1: 'Front ring', C1: 'Output', C2: 'Rear carrier' };
// places on the lever (sun at 0, the carrier of the set at 1)
const LEVER = {
  simple: (ks) => ({ S: 0, C: 1, R: 1 + 1 / ks[0] }),
  simpson: (ks) => ({ S: 0, C2: ks[1] / (1 + ks[1]), C1: 1, R1: 1 + 1 / ks[0] }),
};
const sub = s => s.replace(/_(\w+)/g, '<sub>$1</sub>');
export const fmtRpm = v => `${Math.abs(v) < 0.05 ? '0.0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1)} rpm`;

// i as text and its kind
export function ratioText(i) {
  if (!isFinite(i)) return { v: '—', kind: 'Neutral: the output is free' };
  const a = Math.abs(i), v = `${i < 0 ? '−' : ''}${a.toFixed(a < 10 ? 3 : 2)} : 1`;
  if (Math.abs(i - 1) < 1e-9) return { v, kind: 'Direct drive: all members turn as one' };
  if (i < 0) return { v, kind: `Reverse${a > 1 ? ', reduction' : ', step-up'}` };
  return { v, kind: a > 1 ? 'Reduction: output slower, torque up' : 'Overdrive: output faster, torque down' };
}
// the ratio formula of a mode, with tooth counts
function formula(L, md, gear) {
  const Zs = L.sets[0].Zs, Zr = L.sets[0].Zr;
  if (L.id === 'simpson') {
    const F = { 1: ['i = 2 + Z_s/Z_r', 2 + Zs / Zr], 2: ['i = 1 + Z_s/Z_r', 1 + Zs / Zr], 3: ['i = 1 (sun locked to the input ring)', 1], R: ['i = −Z_r/Z_s', -Zr / Zs], N: ['no member held: the output is free', NaN] }[gear];
    return F;
  }
  if (md.direct) return ['i = 1 (two members locked together)', 1];
  const h = md.hold[0], key = h + md.input;
  return {
    RS: ['i = 1 + Z_r/Z_s', 1 + Zr / Zs], RC: ['i = Z_s/(Z_s + Z_r)', Zs / (Zs + Zr)],
    SR: ['i = 1 + Z_s/Z_r', 1 + Zs / Zr], SC: ['i = Z_r/(Z_s + Z_r)', Zr / (Zs + Zr)],
    CS: ['i = −Z_r/Z_s', -Zr / Zs], CR: ['i = −Z_s/Z_r', -Zs / Zr],
  }[key];
}

export function createAnalysis(el) {
  const A = { L: null, md: null, gear: null, pos: null };
  let dpr = 1;
  function size(c) {
    dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(10, c.clientWidth), h = Math.max(10, c.clientHeight);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  }
  // L: layout, md: mode, gear: Simpson gear key, model: gears.js MODELS entry
  function set(L, md, gear, model) {
    A.L = L; A.md = md; A.gear = gear; A.model = model;
    A.pos = LEVER[L.id](L.sets.map(s => s.k));
    A.dirty = true;
  }
  function role(m) {
    const md = A.md;
    if (md.hold.includes(m)) return 'held';
    if (md.input === m || md.lock.some(p => p.includes(m) && p.includes(md.input))) return 'in';
    if (md.out === m) return 'out';
    return '';
  }
  // the lever: members down the canvas, speeds across it
  function drawLever(sp) {
    const c = el.lever; if (!c.clientWidth) return;
    size(c);
    const g = c.getContext('2d'), W = c.width / dpr, H = c.height / dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const P = A.pos, mem = Object.keys(P), pmax = Math.max(...mem.map(m => P[m]));
    const top = 22, bot = H - 18, x0 = W * 0.56, span = Math.min(W - x0 - 14, x0 - 92);
    const vmax = Math.max(1e-9, ...mem.map(m => Math.abs(sp[m])));
    const Y = p => top + p / pmax * (bot - top), X = v => x0 + v / vmax * span;
    const mono = css('--mono') || 'monospace', sans = css('--sans') || 'sans-serif';
    // zero line and scale
    g.strokeStyle = 'rgba(217,179,106,0.22)'; g.lineWidth = 1; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(x0, 13); g.lineTo(x0, H - 4); g.stroke(); g.setLineDash([]);
    g.fillStyle = css('--dim') || '#8d90a6'; g.font = `9px ${mono}`; g.textAlign = 'center';
    g.fillText('ω = 0', x0, 9);
    // the lever through the tips (a straight line: Willis)
    const pts = mem.map(m => [X(sp[m]), Y(P[m])]).sort((a, b) => a[1] - b[1]);
    g.strokeStyle = 'rgba(255,224,170,0.85)'; g.lineWidth = 2.2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(...pts[0]); g.lineTo(...pts[pts.length - 1]); g.stroke();
    for (const m of mem) {
      const y = Y(P[m]), x = X(sp[m]), col = MCOL[m], r = role(m);
      // the speed arrow from the zero line
      g.strokeStyle = col; g.lineWidth = 1.6; g.globalAlpha = 0.7;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x, y); g.stroke(); g.globalAlpha = 1;
      if (Math.abs(x - x0) > 6) { const s = Math.sign(x - x0); g.fillStyle = col; g.beginPath(); g.moveTo(x, y); g.lineTo(x - s * 6, y - 3.5); g.lineTo(x - s * 6, y + 3.5); g.closePath(); g.fill(); }
      // node: a pivot (held), a ring (output) or a dot
      if (r === 'held') {
        g.strokeStyle = '#ff7a7a'; g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(x - 8, y + 8); g.lineTo(x, y); g.lineTo(x + 8, y + 8); g.closePath(); g.stroke();
        for (let k = -8; k <= 6; k += 4) { g.beginPath(); g.moveTo(x + k, y + 11); g.lineTo(x + k + 3, y + 8); g.stroke(); }
      }
      g.fillStyle = '#fff6e6'; g.beginPath(); g.arc(x, y, 3.6, 0, TAU); g.fill();
      g.strokeStyle = r === 'in' ? '#7ee0a0' : r === 'out' ? '#f0c060' : col; g.lineWidth = r ? 2.2 : 1.4;
      g.beginPath(); g.arc(x, y, r ? 6 : 4.4, 0, TAU); g.stroke();
      // name and role at the left
      g.textAlign = 'left'; g.font = `600 10px ${sans}`; g.fillStyle = col;
      g.fillText(SHORT[m], 6, y - 1);
      g.font = `9px ${mono}`; g.fillStyle = r === 'held' ? '#ff9a9a' : r === 'in' ? '#7ee0a0' : r === 'out' ? '#f0c060' : (css('--dim') || '#8d90a6');
      g.fillText(r === 'held' ? 'held' : r === 'in' ? 'input' : r === 'out' ? 'output' : 'free', 6, y + 10);
    }
  }

  let tick = 0;
  // st: { sp: rpm per member, rpm, pspin: [rpm per set] }
  function frame(st) {
    if (!A.L) return;
    if (++tick % 3 && !A.dirty) return;
    A.dirty = false;
    const L = A.L, md = A.md, S0 = L.sets[0], sp = st.sp;
    drawLever(sp);
    const [fx, fv] = formula(L, md, A.gear);
    const i = st.ratio, rt = ratioText(i);
    const rh = `<b>${rt.v}</b><span>i = ω<sub>in</sub> ⁄ ω<sub>out</sub> · ${rt.kind}</span>`;
    if (el.ratio._h !== rh) { el.ratio.innerHTML = rh; el.ratio._h = rh; }
    const name = m => SHORT[m];
    const rows = [
      ['Input · ' + name(md.input), fmtRpm(sp[md.input])],
      ['Output · ' + name(md.out), fmtRpm(sp[md.out])],
      ['Output torque (no losses)', isFinite(i) ? `${(i).toFixed(2)} × input` : '0'],
      ...L.sets.map((T, j) => [`Planet spin on pin${L.sets.length > 1 ? (j ? ' · rear' : ' · front') : ''}`, fmtRpm(st.pspin[j])]),
      ...L.sets.map((T, j) => { const ms = A.model.sets[j], f = Math.abs(T.Zr * (sp[ms.r] - sp[ms.c])) / 60; return [`Tooth meshes per second${L.sets.length > 1 ? (j ? ' · rear' : ' · front') : ''}`, `${f.toFixed(1)} Hz`]; }),
      ['Teeth Zs · Zp · Zr', `${S0.Zs} · ${S0.Zp} · ${S0.Zr}`],
      ['Planets N', L.sets.map(T => T.N).join(' + ')],
    ];
    const html = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    if (el.nums._h !== html) { el.nums.innerHTML = html; el.nums._h = html; }
    const f1 = v => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);
    const eq = [];
    L.sets.forEach((T, j) => {
      const ms = A.model.sets[j], s = sp[ms.s], c = sp[ms.c], r = sp[ms.r];
      const tag = L.sets.length > 1 ? (j ? ' · rear set' : ' · front set') : '';
      const ws = `ω_${ms.s === 'S' ? 's' : ms.s}`, wc = `ω_${ms.c === 'C' ? 'c' : ms.c}`, wr = `ω_${ms.r === 'R' ? 'r' : ms.r}`;
      const willis = Math.abs(r - c) > 1e-6
        ? `(${ws} − ${wc}) ⁄ (${wr} − ${wc}) = −Z_r/Z_s<br><span class="num">(${f1(s)} − ${f1(c)}) ⁄ (${f1(r)} − ${f1(c)}) = ${f1((s - c) / (r - c))} = −${T.Zr}/${T.Zs}</span>`
        : `(${ws} − ${wc}) ⁄ (${wr} − ${wc}) = −Z_r/Z_s<br><span class="num">${wr} = ${wc}: the set turns as one block</span>`;
      eq.push(['Willis' + tag, willis]);
      eq.push(['Same, without a fraction' + tag, `Z_s ${ws} + Z_r ${wr} = (Z_s + Z_r) ${wc}<br><span class="num">${T.Zs}·${f1(s)} + ${T.Zr}·${f1(r)} = ${T.Zs + T.Zr}·${f1(c)}</span>`]);
    });
    eq.push(['Ratio of this mode', `${fx}${isFinite(fv) ? ` = ${fv.toFixed(3)}` : ''}`]);
    eq.push(['Ring size', `Z_r = Z_s + 2 Z_p = ${S0.Zs} + 2·${S0.Zp} = ${S0.Zr}`]);
    eq.push(['Equal spacing', `(Z_s + Z_r) ⁄ N = ${S0.Zs + S0.Zr}/${S0.N} = ${(S0.Zs + S0.Zr) / S0.N} (a whole number)`]);
    eq.push(['Planet spin', `ω_p − ω_c = −(Z_s/Z_p)(ω_s − ω_c)`]);
    const eh = eq.map(([k, v]) => `<div class="eq"><span>${k}</span><div>${sub(v)}</div></div>`).join('');
    if (el.eqs._h !== eh) { el.eqs.innerHTML = eh; el.eqs._h = eh; }
  }
  return { set, frame, role, redraw: () => { A.dirty = true; } };
}
export { NAMES };
