// ============================================================================
//  ALPHA QUDITS  ·  compare/scenes/look.js  ·  the look-elsewhere lab (DOM-free)
// ----------------------------------------------------------------------------
//  Drives MODEL's look-elsewhere count (model/look-elsewhere.js, run in the
//  module worker model/le-worker.js through startLookElsewhere): how many
//  distinct numbers x = (a + b√2 + c√3 + d√6)/D, with whole numbers
//  0 <= a, b, c, d <= M and D in a chosen set, have 1/x inside a window of
//  k CODATA 2022 standard deviations. Against it: lambda, the count
//  expected if values of that size were spread at the same density with no
//  structure, drawn with its Poisson one-sigma bar sqrt(lambda).
//
//  The text says what the count means and what it does not: the paper's
//  integers are counts of records and the readout dimension, computed from
//  its rules, not free fits; the fair look-elsewhere factor is the number
//  of rule sets, which the dials (Table S5) show and this count cannot.
//
//  grep -n targets:  export const DENS | export const COEFFS | export function
//  readResult | function start | draw(g | info(
// ============================================================================
import { C, text, line, dot, clamp, backdrop, fitSize, rgba, easeOut, roundRect } from '../draw.js';
import { model, fmtSigma } from '../data.js';

export const DENS = [
  { id: 'smooth', label: '3-smooth D ≤ 40 000', short: 'D = 2ⁱ3ʲ', den: { kind: 'smooth', max: 40000 } },
  { id: 'all', label: 'any D ≤ 40 000', short: 'any D', den: { kind: 'all', max: 40000 } },
  { id: 'all100k', label: 'any D ≤ 100 000', short: 'any D ≤ 10⁵', den: { kind: 'all', max: 100000 } },
];
export const COEFFS = [30, 60, 100, 160];
export const WINS = [1, 3];
const fmtInt = n => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');

// Plain reading of a result: { lambda, found, pAny, regime }.
export function readResult(r) {
  const lambda = r.expected, found = r.hits;
  return { lambda, found, pAny: 1 - Math.exp(-lambda), regime: lambda >= 5 ? 'dense' : lambda < 1 ? 'sparse' : 'middle', candidate: !!r.candidateFound };
}

export default {
  id: 'lookElsewhere',
  title: 'Look-elsewhere lab',
  init(env) {
    const st = { coeff: 100, den: 'smooth', win: 1, status: 'idle', progress: 0, raw: 0, result: null, doneT: 0, t: 0, job: null, reduced: !!env.reduced, fill: !!env.fill, err: '', auto: env.params?.autorun ?? true, redraw: null };
    if (env.params) this.show(st, env.params);
    return st;
  },
  show(st, p = {}) {
    let changed = false;
    if (p.coeff && p.coeff !== st.coeff) { st.coeff = p.coeff; changed = true; }
    if (p.den && p.den !== st.den) { st.den = p.den; changed = true; }
    if (p.win && p.win !== st.win) { st.win = p.win; changed = true; }
    if (changed && st.status !== 'idle') start(st);
  },
  params: st => paramsOf(st),
  height(w) { return w < 480 ? 300 : 280; },
  caption(st) {
    if (st.status === 'running') return `Counting in a background worker… ${Math.round(st.progress * 100)} %`;
    if (st.status === 'done' && st.result) {
      const r = readResult(st.result);
      return `Found ${r.found} distinct value${r.found === 1 ? '' : 's'} in the window; density alone expects ${r.lambda.toFixed(r.lambda < 10 ? 2 : 0)}. Run took ${st.result.ms} ms over ${fmtInt(st.result.scanned)} tuples.`;
    }
    if (st.status === 'error') return 'The count did not run: ' + st.err;
    return 'Pick the ranges, then run the count.';
  },
  controls(st, ui) {
    const g1 = ui.group('Coefficients a, b, c, d up to');
    for (const c of COEFFS) ui.button(g1, String(c), () => { st.coeff = c; start(st); ui.redraw(); }, { pressed: () => st.coeff === c, aria: `Coefficients up to ${c}` });
    const g2 = ui.group('Denominators');
    for (const d of DENS) ui.button(g2, d.label, () => { st.den = d.id; start(st); ui.redraw(); }, { pressed: () => st.den === d.id });
    const g3 = ui.group('Window around CODATA 2022');
    for (const k of WINS) ui.button(g3, `±${k}σ`, () => { st.win = k; start(st); ui.redraw(); }, { pressed: () => st.win === k, aria: `Window of plus or minus ${k} standard deviations` });
    const g4 = ui.group('Run');
    ui.button(g4, 'Run', () => { start(st); ui.redraw(); }, { pressed: () => st.status === 'running' });
    ui.button(g4, 'Stop', () => { if (st.job) st.job.cancel(); st.status = st.result ? 'done' : 'idle'; ui.redraw(); }, { aria: 'Stop the count' });
    st.redraw = ui.redraw;
  },
  info(st, F) {
    const n = F.cand.num, D = F.cand.den, s = F.sectors;
    const what = `<p><b>What the count is.</b> Every number (<i>a</i> + <i>b</i>√2 + <i>c</i>√3 + <i>d</i>√6)/<i>D</i> with whole numbers 0 ≤ <i>a</i>, <i>b</i>, <i>c</i>, <i>d</i> ≤ ${st.coeff} and <i>D</i> in the chosen set, whose inverse lands within ±${st.win}σ of CODATA 2022, each value counted once. Beside it, λ: how many would land if values of that size were spread evenly at the same density. The bar on λ is its Poisson one-sigma spread, √λ.</p>`;
    let now = '';
    if (st.status === 'done' && st.result) {
      const r = readResult(st.result);
      const lam = r.lambda.toFixed(r.lambda < 10 ? 2 : 0);
      if (st.coeff < Math.max(n.a, n.b, n.c, n.d)) now = `<p><b>This run.</b> The candidate is outside this family: its first coefficient, ${n.a}, is larger than ${st.coeff}. Found ${r.found}, expected ${lam}.</p>`;
      else if (r.regime === 'dense') now = `<p><b>This run.</b> Found ${r.found}, expected ${lam}. With a free denominator, numbers of this shape fill the window at about the density one would expect. A formula of this shape whose integers were free to choose could hit the window by luck, so agreement alone would say little about it.</p>`;
      else now = `<p><b>This run.</b> Found ${r.found}${r.candidate ? ' (the candidate is one of them)' : ''}, expected ${lam}. Restricted this way the window is sparse: by density alone, the chance of any hit is about ${Math.round(r.pAny * 100)} %. That is not a p-value for the paper, because this family (3-smooth denominators like ${D}, coefficients up to ${st.coeff}) was chosen here with the candidate in view.</p>`;
      const ex = (st.result.examples || []).slice(0, 4).map(e => `<li>(${e.a} + ${e.b}√2 + ${e.c}√3 + ${e.d}√6)/${e.D} → ${e.inverse.slice(0, 15)} (${fmtSigma(e.sigma)})${e.isCandidate ? ' <b>the candidate</b>' : ''}</li>`).join('');
      if (ex) now += `<p class="cmp-sub">Nearest hits to CODATA:</p><ul class="cmp-list">${ex}</ul>`;
    }
    const not = `<p><b>What it does not mean.</b> The paper did not search this family. Its integers are counts: ${n.a}, ${n.b}, ${n.c} and ${n.d} are the numbers of records in the four sectors${s ? ` (our model rebuilds them: ${s['++']}, ${s['+-']}, ${s['-+']}, ${s['--']})` : ''}, and ${D} = 24 · 36 · 36 is the readout dimension N. None was fitted to α. So the fair look-elsewhere factor is not the number of integer tuples. It is the number of rule sets one could have written down, and how many of them the paper's definitions really force. The dials above show the fifteen alternatives the paper lists; this count cannot weigh them.</p>`;
    return what + now + not;
  },
  draw(g, box, t, st, F) {
    st.t = t;
    backdrop(g, box, C.ro, 0.04);
    const M = model();
    if (!F.ready || !M) { text(g, 'Loading the model…', box.x + box.w / 2, box.y + box.h / 2, { size: 13, color: C.dim, align: 'center' }); return; }
    if (st.status === 'idle' && st.auto) { if (st.fill) runSync(st, M); else start(st); }
    const pad = box.w < 420 ? 12 : 22, x0 = box.x + pad, x1 = box.x + box.w - pad, W = x1 - x0;
    const total = (st.coeff + 1) ** 4;
    // progress
    const p = st.status === 'done' ? 1 : st.progress;
    const scanned = st.status === 'done' && st.result ? st.result.scanned : Math.round(p * total);
    const s1 = `scanned ${fmtInt(scanned)} of ${fmtInt(total)} tuples (a, b, c, d)`;
    text(g, s1, x0, box.y + 20, { size: fitSize(g, s1, W, 12), color: C.ink2 });
    roundRect(g, x0, box.y + 28, W, 6, 3); g.fillStyle = rgba('#ffffff', 0.07); g.fill();
    if (p > 0) { roundRect(g, x0, box.y + 28, Math.max(6, W * p), 6, 3); g.fillStyle = st.status === 'done' ? C.ro : C.val; g.fill(); }
    // the window strip, in CODATA sigma
    const k = st.result ? (st.result.params.window.sigmas || st.win) : st.win;
    const sy = box.y + 66, sh = box.w < 480 ? 92 : 84;
    const X = s => x0 + (s + k) / (2 * k) * W;
    roundRect(g, x0, sy, W, sh, 8); g.fillStyle = rgba(C.ro, 0.06); g.fill();
    line(g, X(0), sy, X(0), sy + sh, rgba(C.ink2, 0.35), 1, [3, 3]);
    for (let s = -k; s <= k; s++) { const x = X(s); line(g, x, sy + sh, x, sy + sh + 5, C.dim, 1); text(g, s === 0 ? 'CODATA' : (s > 0 ? '+' : '−') + Math.abs(s) + 'σ', x, sy + sh + 17, { size: 11, color: C.dim, align: s === -k ? 'left' : s === k ? 'right' : 'center' }); }
    text(g, `hits inside ±${k}σ`, x0 + 8, sy + 15, { size: 11, color: C.dim });
    const res = st.status === 'done' ? st.result : null;
    const age = res ? (st.reduced ? 9 : t - st.doneT) : 0;
    if (res) {
      const ex = res.examples || [];
      const cols = new Map();
      ex.forEach((e, i) => {
        const x = X(clamp(e.sigma, -k, k));
        const bin = Math.round(x / 7);
        const n = cols.get(bin) || 0; cols.set(bin, n + 1);
        const yT = sy + sh - 12 - (n % 8) * 9;
        const a = easeOut((age - i * 0.03) / 0.7);
        if (a <= 0) return;
        const y = sy + 10 + (yT - sy - 10) * a;
        if (e.isCandidate) { dot(g, x, y, 6.5, rgba(C.val, 0.25)); dot(g, x, y, 4.2, C.val); }
        else dot(g, x, y, 3.2, e.smooth ? C.qt : C.ink2);
      });
      const cand = ex.find(e => e.isCandidate);
      if (cand && age > 0.6) {
        const x = X(cand.sigma), s = `the candidate, ${fmtSigma(cand.sigma)}`;
        text(g, s, x + (x > x0 + W * 0.6 ? -10 : 10), sy + 30, { size: 11.5, color: C.val, align: x > x0 + W * 0.6 ? 'right' : 'left' });
      }
      if (res.hits > ex.length) text(g, `nearest ${ex.length} of ${res.hits} shown`, x1 - 8, sy + 15, { size: 11, color: C.dim, align: 'right' });
      if (!res.hits) text(g, 'no value of this family lands in the window', x0 + W / 2, sy + sh / 2 + 4, { size: 12, color: C.dim, align: 'center', it: true });
    } else if (st.status === 'running') {
      const s = `counting… ${st.raw} near-misses so far`;
      text(g, s, x0 + W / 2, sy + sh / 2 + 4, { size: 12, color: C.dim, align: 'center' });
    }
    // found against expected
    const by = sy + sh + 40;
    if (res) {
      const r = readResult(res);
      const sd = Math.sqrt(r.lambda);
      const max = Math.max(1, r.found, r.lambda + sd) * 1.12;
      const labW = box.w < 420 ? 74 : 92;
      const bx0 = x0 + labW, BW = x1 - bx0 - 44;
      const bw = v => BW * v / max;
      const grow = easeOut((age - 0.3) / 0.8);
      text(g, 'found', x0, by + 11, { size: 12, color: C.ink2 });
      roundRect(g, bx0, by, Math.max(2, bw(r.found) * grow), 14, 3); g.fillStyle = C.ro; g.fill();
      text(g, String(r.found), bx0 + bw(r.found) * grow + 6, by + 11, { size: 12, color: C.ink, w: 600 });
      const ey = by + 26;
      text(g, 'expected λ', x0, ey + 11, { size: 12, color: C.ink2 });
      roundRect(g, bx0, ey, Math.max(2, bw(r.lambda) * grow), 14, 3); g.fillStyle = rgba(C.ink2, 0.35); g.fill();
      if (grow > 0.95) {
        const ea = bx0 + bw(Math.max(0, r.lambda - sd)), eb = bx0 + bw(r.lambda + sd), ym = ey + 7;
        line(g, ea, ym, eb, ym, C.ink, 1.4); line(g, ea, ym - 5, ea, ym + 5, C.ink, 1.4); line(g, eb, ym - 5, eb, ym + 5, C.ink, 1.4);
      }
      text(g, r.lambda.toFixed(r.lambda < 10 ? 2 : 0), bx0 + bw(r.lambda + sd) * grow + 6, ey + 11, { size: 12, color: C.ink, w: 600 });
      const foot = 'bar on λ: Poisson one-sigma spread √λ';
      text(g, foot, x0, ey + 34, { size: fitSize(g, foot, W, 11), color: C.dim });
    } else if (st.status === 'error') {
      text(g, st.err, x0, by + 12, { size: 12, color: C.bad });
    }
  },
};

function start(st) {
  const M = model();
  if (!M || !M.startLookElsewhere) { st.status = 'error'; st.err = 'model not loaded'; return; }
  if (st.job) try { st.job.cancel(); } catch (e) { /* ignore */ }
  st.status = 'running'; st.progress = 0; st.raw = 0; st.result = null;
  const job = M.startLookElsewhere(paramsOf(st), {
    onProgress: m => { if (st.job !== job) return; st.progress = m.progress || 0; st.raw = m.rawHits || 0; },
    onError: msg => { if (st.job !== job) return; st.status = 'error'; st.err = msg; },
  });
  st.job = job;
  job.promise.then(r => {
    if (st.job !== job) return;
    st.job = null;
    if (r) { st.result = r; st.status = 'done'; st.doneT = st.t; }
    else if (st.status === 'running') st.status = st.result ? 'done' : 'idle';
    if (st.redraw) st.redraw();
  });
}
// The saver has no worker round trip to wait for: a small count, run once.
function runSync(st, M) {
  const v = M.value();
  st.result = M.lookElsewhere({ ...paramsOf(st), candidate: { ...v.numerator, D: v.denominator } });
  st.status = 'done'; st.doneT = st.t; st.progress = 1;
}
export function paramsOf(st) {
  return { coeffMax: st.coeff, denominators: (DENS.find(x => x.id === st.den) || DENS[0]).den, window: st.win, maxExamples: 40 };
}
