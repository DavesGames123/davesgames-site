// ============================================================================
//  FACET HEAD MODEL  ·  main.js — tables, the two figures, the saver hook
// ----------------------------------------------------------------------------
//  Builds the byline and the paper tables from data.js. Runs the figures:
//    Figure 1 (#lab)   train both toy models (model.js) on N heads from
//                      head.js, fit one held-out head at budget K, plot the
//                      held-out curves of all 30 test heads (lab.js)
//    Figure 2 (#swap)  give head A the chosen regions of head B, once by the
//                      regional solve and once by cut and paste
//  A change of N retrains (about 30 ms); a change of K or head only refits.
//
//  grep -n: "function table"  "function buildTables"  "function retrain"
//           "function drawLab"  "function drawSwap"  "window.snSaver"
// ============================================================================
import { PAPER, E1, E2, E3 } from './data.js';
import { population, REGIONS, LATENT_DIMS, N_V, template } from './head.js';
import { globalModel, regionalModel, curves, swap, cutPaste, errors, v2v, laplacian } from './model.js';
import { drawHeads, drawChart, cutVertices, REGION_COLORS } from './lab.js';

const $ = id => document.getElementById(id);
const mm = x => x.toFixed(2) + ' mm';

// ── tables ──
function table(T, unit = '') {
  const head = T.cols.map(c => `<th>${c}${unit}</th>`).join('');
  const body = T.rows.map(([name, v]) => {
    const lo = Math.min(...v);
    return `<tr><td>${name}</td>${v.map(x => `<td class="${x === lo && v.length > 1 ? 'best' : ''}">${x.toFixed(2)}</td>`).join('')}</tr>`;
  }).join('');
  return `<table><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
function buildTables() {
  const T = { E1, E2, E3 };
  document.querySelectorAll('[data-table]').forEach(el => { el.innerHTML = table(T[el.dataset.table]); });
  $('byline').textContent = `${PAPER.authors} · ${PAPER.orgs} · arXiv:${PAPER.arxiv} · ${PAPER.date}`;
  $('cite').innerHTML = `${PAPER.authors}. <i>${PAPER.title}</i>. ${PAPER.venue}. <a href="${PAPER.url}" target="_blank" rel="noopener">arXiv:${PAPER.arxiv}</a>, <a href="${PAPER.doi}" target="_blank" rel="noopener">doi:10.1145/3829339.3847830</a>. Licence: <a href="${PAPER.licenceUrl}" target="_blank" rel="noopener">${PAPER.licence}</a>.`;
}

// ── state ──
const S = { N: 24, t: 0.62, head: 0, pair: [0, 1], regions: [4, 5], pop: null, G: null, R: null, curves: null };
const Kmax = () => S.R.maxK;
const kOf = t => Math.max(1, Math.round(Math.exp(t * Math.log(Kmax()))));
const budget = () => {
  const K = kOf(S.t), kg = Math.min(K, S.G.maxK), per = Math.max(1, Math.min(S.R.perBasis, Math.floor(K / (2 * S.R.R))));
  return { K, kg, per, kr: 2 * S.R.R * per };
};

function retrain() {
  S.pop = population(S.N);
  S.G = globalModel(S.pop.train); S.R = regionalModel(S.pop.train);
  S.curves = curves(S.G, S.R, S.pop.test);
  drawLab(); drawSwap();
}

function drawLab() {
  const h = S.pop.test[S.head % S.pop.test.length], b = budget();
  const fg = S.G.fit(h, b.kg), fr = S.R.assemble(S.R.coeffs(h), b.per);
  const eg = errors(fg, h), er = errors(fr, h);
  drawHeads($('heads'), [
    { label: 'Held-out head', pts: h, regions: true, sub: `test head ${S.head % S.pop.test.length + 1} of ${S.pop.test.length}` },
    { label: 'Global PCA', pts: fg, ref: h, err: eg, sub: `${b.kg} modes · ${mm(v2v(fg, h))}` },
    { label: 'Regional', pts: fr, ref: h, err: er, sub: `${b.kr} coefficients · ${mm(v2v(fr, h))}` },
  ]);
  drawChart($('chart'), S.curves, S.N - 1, { kg: b.kg, kr: b.kr });
  const gf = S.curves.global.at(-1)[1], rf = S.curves.regional.at(-1)[1];
  $('nV').textContent = String(S.N); $('kV').textContent = String(b.K);
  const rows = [
    ['Training heads N', `${S.N} (the toy has ${LATENT_DIMS} latent dimensions)`],
    ['Global ceiling N − 1', `${S.N - 1} modes`],
    [`Regional ceiling ${S.R.R} × 2 × modes per basis`, `${S.R.maxK} coefficients`],
    ['Budget K: global uses / regional uses', `${b.kg} / ${b.kr}`],
    ['Mean held-out error at full capacity', `global ${mm(gf)} · regional ${mm(rf)} · ${(gf / rf).toFixed(1)}× lower`],
  ];
  $('labNums').innerHTML = rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
}

function drawSwap() {
  const [ia, ib] = S.pair.map(i => i % S.pop.test.length), a = S.pop.test[ia], b = S.pop.test[ib];
  const fa = S.R.assemble(S.R.coeffs(a), S.R.perBasis);
  const sw = swap(S.R, a, b, S.regions), cp = cutPaste(a, b, S.regions);
  const cuts = cutVertices(S.regions);
  const kink = p => { const d = laplacian(p); let m = 0; for (const v of cuts) if (v > 0 && v < N_V - 1) m = Math.max(m, Math.hypot(d[2 * v], d[2 * v + 1])); return m; };
  const kinkRef = kink(fa);
  let out = 0;
  const ins = new Set(); S.regions.forEach(r => { const sp = template().span[r], s0 = Math.max(0, sp[0] - 8), s1 = Math.min(N_V, sp[1] + 8); for (let v = s0; v < s1; v++) ins.add(v); });
  for (let v = 0; v < N_V; v++) if (!ins.has(v)) { const d = Math.hypot(sw[2 * v] - fa[2 * v], sw[2 * v + 1] - fa[2 * v + 1]); out = Math.max(out, d); }
  const names = S.regions.map(r => REGIONS[r].name.toLowerCase()).join(' + ') || 'nothing';
  drawHeads($('swapCv'), [
    { label: 'Head A', pts: a, regions: true },
    { label: 'Head B', pts: b, regions: true },
    { label: 'A with B’s ' + (names.length > 18 ? 'regions' : names), pts: sw, ref: a, color: '#62c4ff', sub: 'regional coefficients, one solve' },
    { label: 'Cut and paste', pts: cp, ref: a, color: '#ff9a62', cuts, sub: 'vertices copied, no blend' },
  ]);
  const rows = [
    ['Regions taken from B', names],
    ['Largest move of A away from the swapped regions', mm(out)],
    ['Bend at the cuts (Laplacian): solve / cut and paste', S.regions.length ? `${mm(kink(sw))} / ${mm(kink(cp))} (A alone: ${mm(kinkRef)})` : '–'],
  ];
  $('swapNums').innerHTML = rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
  $('regionChips').querySelectorAll('button').forEach(btn => btn.classList.toggle('on', S.regions.includes(+btn.dataset.k)));
}

// ── controls ──
function buildControls() {
  $('nIn').oninput = () => { const v = +$('nIn').value; if (Number.isFinite(v)) { S.N = v; retrain(); } };
  $('kIn').oninput = () => { const v = +$('kIn').value; if (Number.isFinite(v)) { S.t = v / 1000; drawLab(); } };
  $('prevHead').onclick = () => { S.head = (S.head + S.pop.test.length - 1) % S.pop.test.length; drawLab(); };
  $('nextHead').onclick = () => { S.head = (S.head + 1) % S.pop.test.length; drawLab(); };
  const chips = $('regionChips'); chips.innerHTML = '';
  REGIONS.forEach((rg, r) => {
    const b = document.createElement('button'); b.textContent = rg.name; b.dataset.k = String(r);
    b.style.setProperty('--rc', REGION_COLORS[r]);
    b.onclick = () => { S.regions = S.regions.includes(r) ? S.regions.filter(x => x !== r) : [...S.regions, r].sort((x, y) => x - y); drawSwap(); };
    chips.appendChild(b);
  });
  $('newPair').onclick = () => { S.pair = [(S.pair[0] + 2) % 30, (S.pair[1] + 2) % 30]; drawSwap(); };
  let rz = 0;
  addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { drawLab(); drawSwap(); }); });
  $('nIn').value = String(S.N); $('kIn').value = String(Math.round(S.t * 1000));
}

// ── screensaver: Figure 1 alone, K sweeps up, then a new N and head ──
let saverTimer = 0;
window.snSaver = {
  enter(opts = {}) {
    document.documentElement.classList.add('facet-saver');
    let k = Math.abs(Math.floor(opts.seed ?? Math.random() * 1e6));
    const Ns = [12, 24, 36, 18, 48, 30];
    let frame = 0;
    const tick = () => {
      if (frame === 0) { S.N = Ns[k % Ns.length]; S.head = (k * 7) % 30; k++; $('nIn').value = String(S.N); retrain(); }
      S.t = Math.min(1, frame / 90); $('kIn').value = String(Math.round(S.t * 1000)); drawLab();
      frame = frame >= 130 ? 0 : frame + 1;
      saverTimer = setTimeout(tick, 80);
    };
    tick();
    return { canvas: $('chart'), warmupMs: 600 };
  },
  exit() { clearTimeout(saverTimer); document.documentElement.classList.remove('facet-saver'); },
};

buildTables();
buildControls();
retrain();
