// ============================================================================
//  4DCODEBENCH  ·  page logic (ES module)
// ----------------------------------------------------------------------------
//  Binds the figures of index.html to the paper numbers in data.js. Each
//  section starts when it first comes near the view. All charts are 2D
//  canvas or plain HTML, drawn by this file with no chart library. Every
//  chart answers hover (mouse) and tap (touch) through one shared tooltip.
//
//  One shared pick (PICK.model) links the leaderboard table, the Elo
//  scatter, the picked-model card and the static/dynamic chart. setPick()
//  changes it and calls each listener.
//
//  Section 06 (the playground) is not bound here. initPlay loads play.js
//  when #s6 first comes near the view; play.js binds the section.
//
//  GREP MAP
//    grep -n 'function fitCanvas'    canvas sizing at devicePixelRatio
//    grep -n 'function pointerOn'    hover + tap + drag on a canvas
//    grep -n 'function showTip'      shared tooltip
//    grep -n 'function bindNumbers'  data-d attributes to text
//    grep -n 'function initBench'    section 2 composition charts
//    grep -n 'function initScore'    section 3 family table, Elo curve
//    grep -n 'function initBoard'    section 4 table, scatter, pick card
//    grep -n 'function initMotion'   section 5 gap, effects, strategies
//    grep -n 'function initPlay'     section 6: loads play.js
//    grep -n 'function initChips'    sticky section bar
// ============================================================================
import { PAPER, LEADERBOARD, FAMILIES, COMPOSITION, STRATEGIES, HUMAN, EFFECTS, REASONING } from './data.js';
import { typesetAll } from '../../lib/sci-math.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FONT = '11px Inter, system-ui, sans-serif';
const FONT_B = '500 11px Inter, system-ui, sans-serif';
const FONT_M = '11px ui-monospace, "SF Mono", Menlo, monospace';
const SHORT = { perceptual: 'Perceptual', dyn2d: '2D Dyn.', geom25: '2.5D Geom.', geom3d: '3D Geom.', dyn3d: '3D Dyn.' };

// Colours, read once from style.css so the canvas and the HTML match.
let C = null;
function colours() {
  C = {
    ink: css('--ink'), ink2: css('--ink2'), dim: css('--dim'), faint: css('--faint'), card: css('--card'), card2: css('--card2'),
    acc: css('--acc'), real: css('--real'), syn: css('--syn'), neg: css('--neg'), pos: css('--pos'),
    stat: css('--static'), dyn: css('--dynamic'), grid: 'rgba(255,255,255,0.08)', axis: 'rgba(255,255,255,0.25)',
    fam: Object.fromEntries(FAMILIES.map(f => [f.key, css('--f-' + f.key)])),
  };
}

// ---------------------------------------------------------------- formats
// Format a paper number. f: int, f2, f3, p0 (value is a percent), p1,
// frac1 (value is a fraction, show a percent with one decimal).
function fmt(v, f) {
  if (v === null || v === undefined) return '–';
  switch (f) {
    case 'int': return Number(v).toLocaleString('en-US');
    case 'f2': return v.toFixed(2);
    case 'f3': return v.toFixed(3);
    case 'p0': return `${Math.round(v)}%`;
    case 'p1': return `${v.toFixed(1)}%`;
    case 'frac1': return `${(v * 100).toFixed(1)}%`;
    default: return String(v);
  }
}
const signed = d => (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d).toFixed(2);

// ---------------------------------------------------------------- shared helpers
// Size a 2D canvas to its CSS box at devicePixelRatio (capped at 2).
function fitCanvas(cv) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, r.width), h = Math.max(1, r.height);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}
function onVisible(el, fn) {
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: '400px' });
  io.observe(el);
}
// Redraw on a size change of an element, coalesced to one frame.
function watchSize(el, fn) {
  let pend = false, lastW = -1;
  new ResizeObserver(() => {
    if (pend) return; pend = true;
    requestAnimationFrame(() => { pend = false; const w = el.clientWidth; if (w !== lastW) { lastW = w; fn(); } });
  }).observe(el);
}
function seg(id, fn) {
  const el = $(id);
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    el.querySelectorAll('button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    fn(b.dataset.v);
  });
}
function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, h / 2);
  g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h);
}

// ---------------------------------------------------------------- tooltip
const tip = $('tip');
let tipOwner = null;
function showTip(owner, cx, cy, html) {
  tipOwner = owner;
  tip.innerHTML = html; tip.classList.add('on');
  const r = tip.getBoundingClientRect();
  let x = cx + 14, y = cy - r.height - 12;
  if (x + r.width > innerWidth - 8) x = cx - r.width - 14;
  if (x < 8) x = 8;
  if (y < 110) y = cy + 18;
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
function hideTip(owner) { if (!owner || owner === tipOwner) { tip.classList.remove('on'); tipOwner = null; } }
addEventListener('scroll', () => hideTip(), { passive: true });
document.addEventListener('pointerdown', e => { if (tipOwner && e.target !== tipOwner) hideTip(); });

// Hover, tap and drag on a canvas. fn(x, y, ev, kind): kind is 'hover'
// (mouse move), 'tap' (press and release without much motion), or 'drag'
// (a pressed pointer moves). leave() runs when the mouse leaves.
function pointerOn(cv, fn, leave) {
  let down = null;
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => { down = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointermove', e => {
    const [x, y] = pos(e);
    if (down && down.id === e.pointerId) fn(x, y, e, 'drag');
    else if (e.pointerType === 'mouse') fn(x, y, e, 'hover');
  });
  cv.addEventListener('pointerup', e => {
    if (!down || down.id !== e.pointerId) return;
    const [x, y] = pos(e);
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10) fn(x, y, e, 'tap');
    down = null;
  });
  cv.addEventListener('pointercancel', () => { down = null; });
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { down = null; if (leave) leave(); } });
}

// ---------------------------------------------------------------- numbers
// Every element with data-d="OBJ.path" gets the formatted value from
// data.js. data-fmt picks the format (see fmt).
const DATA = { PAPER, LEADERBOARD, FAMILIES, COMPOSITION, STRATEGIES, HUMAN, EFFECTS, REASONING };
function bindNumbers(root = document) {
  for (const el of root.querySelectorAll('[data-d]')) {
    const v = el.dataset.d.split('.').reduce((o, k) => (o == null ? undefined : o[k]), DATA);
    if (v === undefined) { PAGE.errors.push('no data for ' + el.dataset.d); continue; }
    el.textContent = fmt(v, el.dataset.fmt);
  }
  $('citeArxiv').href = PAPER.arxiv; $('citeSite').href = PAPER.site; $('citeCode').href = PAPER.code;
}

// ---------------------------------------------------------------- shared pick
const PICK = { model: LEADERBOARD[0].model, subs: [] };
function setPick(m) { if (m === PICK.model) return; PICK.model = m; for (const f of PICK.subs) f(); }
const rowOf = m => LEADERBOARD.find(r => r.model === m);
const rankOf = m => LEADERBOARD.findIndex(r => r.model === m) + 1;

// ---------------------------------------------------------------- 02 benchmark
function initBench() {
  // Matter families: grouped horizontal bars, real and synthetic.
  const fcv = $('famCv');
  let fHit = [];
  const drawFam = () => {
    const { g, w, h } = fitCanvas(fcv);
    const fams = COMPOSITION.families;
    const narrow = w < 480;
    const L = narrow ? 104 : 168, R = 34, T = 6, B = 26;
    const X = v => L + v / 100 * (w - L - R);
    const band = (h - T - B) / fams.length, bh = Math.min(16, band * 0.3);
    g.font = FONT; g.textBaseline = 'middle';
    for (const v of [0, 25, 50, 75, 100]) {
      g.strokeStyle = C.grid; g.beginPath(); g.moveTo(X(v), T); g.lineTo(X(v), h - B); g.stroke();
      g.fillStyle = C.dim; g.textAlign = 'center'; g.fillText(String(v), X(v), h - B + 13);
    }
    g.fillStyle = C.ink2; g.textAlign = 'left'; g.fillText('scenes', 0, h - B + 13);
    fHit = [];
    fams.forEach((f, i) => {
      const cy = T + band * (i + 0.5);
      const parts = f.label.split(' (');
      g.fillStyle = C.ink; g.textAlign = 'left'; g.font = FONT_B;
      if (parts.length > 1) {
        g.fillText(parts[0], 0, cy - 7); g.font = FONT; g.fillStyle = C.dim; g.fillText('(' + parts[1], 0, cy + 8);
      } else g.fillText(f.label, 0, cy);
      g.font = FONT;
      [['real', C.real, -1], ['synthetic', C.syn, 1]].forEach(([k, col, s]) => {
        const y = cy + s * (bh / 2 + 1) - bh / 2, x1 = X(f[k]);
        g.fillStyle = col; roundRect(g, X(0), y, x1 - X(0), bh, 3); g.fill();
        g.fillStyle = C.ink2; g.textAlign = 'left'; g.fillText(String(f[k]), x1 + 5, y + bh / 2 + 0.5);
        fHit.push({ x0: X(0), x1: Math.max(x1, X(0) + 24), y0: y - 3, y1: y + bh + 3, f, k });
      });
    });
  };
  pointerOn(fcv, (x, y, e, kind) => {
    if (kind === 'drag') return;
    const hit = fHit.find(b => x >= b.x0 - 4 && x <= b.x1 + 26 && y >= b.y0 && y <= b.y1);
    if (!hit) { hideTip(fcv); return; }
    showTip(fcv, e.clientX, e.clientY, `<b>${esc(hit.f.label)}</b><br>${hit.k === 'real' ? 'real videos' : 'synthetic scenes'}: <span class="v">${hit.f[hit.k]}</span> of ${PAPER[hit.k === 'real' ? 'real' : 'synthetic']}`);
  }, () => hideTip(fcv));
  watchSize(fcv, drawFam);
  drawFam();

  // Scene splits: 100% bars, real and synthetic, for three properties.
  const scv = $('splitCv');
  const groups = [
    { key: 'objects', title: 'Moving objects', a: 'single', b: 'many', la: 'one', lb: 'many' },
    { key: 'materials', title: 'Materials', a: 'single', b: 'many', la: 'one', lb: 'many' },
    { key: 'motion', title: 'Motion', a: 'passive', b: 'driven', la: 'passive', lb: 'driven' },
  ];
  let sHit = [];
  const drawSplit = () => {
    const { g, w, h } = fitCanvas(scv);
    const L = 46, R = 4, gh = h / groups.length, bh = Math.min(22, (gh - 26) / 2 - 3);
    const X = v => L + v / 100 * (w - L - R);
    sHit = [];
    g.textBaseline = 'middle';
    groups.forEach((gr, i) => {
      const y0 = i * gh + 2;
      g.font = FONT_B; g.fillStyle = C.ink; g.textAlign = 'left'; g.fillText(gr.title, 0, y0 + 8);
      ['real', 'synthetic'].forEach((sp, j) => {
        const y = y0 + 20 + j * (bh + 5), d = COMPOSITION[gr.key][sp];
        g.font = FONT; g.fillStyle = C.dim; g.textAlign = 'left'; g.fillText(sp === 'real' ? 'real' : 'synth.', 0, y + bh / 2);
        const xa = X(d[gr.a]);
        g.fillStyle = C.faint; roundRect(g, X(0), y, xa - X(0) - 1, bh, 3); g.fill();
        g.fillStyle = sp === 'real' ? C.real : C.syn; roundRect(g, xa + 1, y, X(100) - xa - 1, bh, 3); g.fill();
        g.font = FONT_M;
        g.fillStyle = C.ink; g.textAlign = 'left';
        if (xa - X(0) > 50) g.fillText(`${gr.la} ${d[gr.a]}`, X(0) + 6, y + bh / 2 + 0.5);
        else g.fillText(String(d[gr.a]), X(0) + 4, y + bh / 2 + 0.5);
        g.fillStyle = '#05070c'; g.textAlign = 'right';
        g.fillText(`${gr.lb} ${d[gr.b]}`, X(100) - 6, y + bh / 2 + 0.5);
        sHit.push({ y0: y, y1: y + bh, gr, sp, d });
      });
    });
  };
  pointerOn(scv, (_x, y, e, kind) => {
    if (kind === 'drag') return;
    const hit = sHit.find(b => y >= b.y0 - 2 && y <= b.y1 + 2);
    if (!hit) { hideTip(scv); return; }
    showTip(scv, e.clientX, e.clientY, `<b>${hit.gr.title}, ${hit.sp === 'real' ? 'real videos' : 'synthetic scenes'}</b><br>${hit.gr.la}: <span class="v">${hit.d[hit.gr.a]}%</span> · ${hit.gr.lb}: <span class="v">${hit.d[hit.gr.b]}%</span>`);
  }, () => hideTip(scv));
  watchSize(scv, drawSplit);
  drawSplit();
}

// ---------------------------------------------------------------- 03 scoring
function initScore() {
  // The five families as a table.
  const on = f => ({ real: f.on === 'all scenes' || f.on === 'real videos', syn: f.on === 'all scenes' || f.on === 'synthetic scenes' });
  $('famTable').innerHTML = '<thead><tr><th>Family</th><th>What it measures</th><th>Real</th><th>Synth.</th></tr></thead><tbody>' +
    FAMILIES.map(f => {
      const o = on(f);
      return `<tr><td><b style="--c:var(--f-${f.key})"><i></i>${esc(f.label)}</b></td><td>${esc(f.measure)}</td>` +
        `<td class="c${o.real ? ' y' : ''}">${o.real ? 'yes' : '–'}</td><td class="c${o.syn ? ' y' : ''}">${o.syn ? 'yes' : '–'}</td></tr>`;
    }).join('') + '</tbody>';

  // Bradley-Terry win probability against the Elo gap, with the paper's
  // single-judgment agreement points.
  const cv = $('btCv');
  let cursor = null, frame = null;
  const P = d => 1 / (1 + 10 ** (-d / 400));
  const draw = () => {
    const { g, w, h } = fitCanvas(cv);
    const L = 40, R = 10, T = 10, B = 30;
    const X = d => L + d / 600 * (w - L - R), Y = p => h - B - (p - 0.4) / 0.6 * (h - T - B);
    frame = { X, Y, L, R, w, h, T, B };
    g.font = FONT; g.textBaseline = 'middle';
    for (const p of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
      g.strokeStyle = C.grid; g.beginPath(); g.moveTo(L, Y(p)); g.lineTo(w - R, Y(p)); g.stroke();
      g.fillStyle = C.dim; g.textAlign = 'right'; g.fillText(`${Math.round(p * 100)}%`, L - 6, Y(p));
    }
    for (const d of [0, 100, 200, 300, 400, 500, 600]) { g.fillStyle = C.dim; g.textAlign = 'center'; g.fillText(String(d), X(d), h - B + 12); }
    g.fillStyle = C.ink2; g.fillText('Elo gap between the two models', (L + w - R) / 2, h - 6);
    g.strokeStyle = C.acc; g.lineWidth = 2; g.beginPath();
    for (let d = 0; d <= 600; d += 5) { const x = X(d), y = Y(P(d)); d ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.lineWidth = 1;
    // Inside 50 Elo the paper says only "near chance": a band, no value.
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(X(0), T, X(HUMAN.nearChanceWithin) - X(0), h - B - T);
    g.fillStyle = C.ink2; g.textAlign = 'left'; g.fillText('near chance', X(0) + 4, T + 12);
    for (const a of HUMAN.agreeByGap) {
      g.fillStyle = C.card; g.beginPath(); g.arc(X(a.gap), Y(a.pct / 100), 6.5, 0, 7); g.fill();
      g.fillStyle = C.dyn; g.beginPath(); g.arc(X(a.gap), Y(a.pct / 100), 4.5, 0, 7); g.fill();
      const lx = X(a.gap) - 40 < L; g.fillStyle = C.ink2; g.textAlign = lx ? 'left' : 'right'; g.fillText(`${a.pct}%`, X(a.gap) + (lx ? 9 : -9), Y(a.pct / 100) - 9);
    }
    if (cursor !== null) {
      const x = X(cursor), y = Y(P(cursor));
      g.strokeStyle = C.axis; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, T); g.lineTo(x, h - B); g.stroke(); g.setLineDash([]);
      g.fillStyle = C.card; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
      g.fillStyle = C.acc; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
    }
  };
  pointerOn(cv, (x, _y, e) => {
    if (!frame) return;
    const d = clamp(Math.round((x - frame.L) / (frame.w - frame.L - frame.R) * 600), 0, 600);
    cursor = d; draw();
    const near = HUMAN.agreeByGap.find(a => Math.abs(frame.X(a.gap) - x) < 14);
    showTip(cv, e.clientX, e.clientY, `gap <span class="v">${d}</span> Elo: higher-rated model wins <span class="v">${(P(d) * 100).toFixed(1)}%</span>` +
      (near ? `<br>paper, at ${near.gap}: one VLM judgment agrees with humans <span class="v">${near.pct}%</span>${near.note ? ` (${esc(near.note)})` : ''}` : ''));
  }, () => { cursor = null; draw(); hideTip(cv); });
  watchSize(cv, draw);
  draw();
}

// ---------------------------------------------------------------- 04 leaderboard
function initBoard() {
  const COLS = [
    { k: 'rank', label: '#', num: true },
    { k: 'model', label: 'Model' },
    { k: 'humanElo', label: 'Human Elo', num: true },
    { k: 'vlmElo', label: 'VLM Elo', num: true },
    { k: 'vqaPct', label: 'VQA', num: true },
    ...FAMILIES.map(f => ({ k: f.key, label: SHORT[f.key], num: true, fam: true })),
    { k: 'overall', label: 'Overall', num: true },
  ];
  const ST = { access: 'all', key: 'overall', asc: false };
  const tbl = $('lbTable');
  const val = (r, k) => (k === 'rank' ? rankOf(r.model) : r[k]);

  const head = () => '<thead><tr>' + COLS.map(c => {
    const s = c.k === ST.key;
    return `<th class="${s ? 'sorted' + (ST.asc ? ' asc' : '') : ''}" aria-sort="${s ? (ST.asc ? 'ascending' : 'descending') : 'none'}"><button data-k="${c.k}">${esc(c.label)}</button></th>`;
  }).join('') + '</tr></thead>';
  const body = () => {
    const rows = LEADERBOARD.filter(r => ST.access === 'all' || r.access === ST.access).slice();
    rows.sort((a, b) => {
      const va = val(a, ST.key), vb = val(b, ST.key);
      if (va === null) return 1; if (vb === null) return -1;     // no value: always last
      const d = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return ST.asc ? d : -d;
    });
    return '<tbody>' + rows.map(r => `<tr class="row${r.model === PICK.model ? ' on' : ''}" data-m="${esc(r.model)}" tabindex="0">` + COLS.map(c => {
      const v = val(r, c.k);
      if (c.k === 'model') return `<td class="m">${esc(r.model)}${r.access === 'open' ? '<small>open</small>' : ''}</td>`;
      if (c.fam) return `<td class="fb"><div class="fbar"><div class="bar"><i style="--c:var(--f-${c.k});width:${v * 100}%"></i></div>${v.toFixed(2)}</div></td>`;
      if (c.k === 'vqaPct') return `<td>${v.toFixed(1)}%</td>`;
      if (c.k === 'overall') return `<td class="ov">${v.toFixed(2)}</td>`;
      return `<td>${v === null ? '–' : v}</td>`;
    }).join('') + '</tr>').join('') + '</tbody>';
  };
  const render = () => { tbl.innerHTML = head() + body(); };
  tbl.addEventListener('click', e => {
    const b = e.target.closest('th button');
    if (b) {
      const k = b.dataset.k;
      if (k === ST.key) ST.asc = !ST.asc; else { ST.key = k; ST.asc = k === 'model' || k === 'rank'; }
      render(); return;
    }
    const tr = e.target.closest('tr.row');
    if (tr) setPick(tr.dataset.m);
  });
  tbl.addEventListener('keydown', e => {
    const tr = e.target.closest('tr.row');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setPick(tr.dataset.m); }
  });
  seg('lbAccess', v => { ST.access = v; render(); drawElo(); });
  render();

  // Scatter: human Elo (x) against VLM Elo (y). A model with no human Elo
  // sits on its own strip at the left of the axis.
  const cv = $('eloCv');
  let pts = [];
  const drawElo = () => {
    const { g, w, h } = fitCanvas(cv);
    const narrow = w < 480;
    const L = 46, R = 12, T = 12, B = 34, STRIP = narrow ? 34 : 44;
    const xa = 200, xb = 1800, ya = 0, yb = 1800;
    const AX0 = L + STRIP + 8;
    const X = v => AX0 + (v - xa) / (xb - xa) * (w - AX0 - R), Y = v => h - B - (v - ya) / (yb - ya) * (h - T - B);
    g.font = FONT; g.textBaseline = 'middle';
    for (const v of [0, 500, 1000, 1500]) {
      g.strokeStyle = C.grid; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - R, Y(v)); g.stroke();
      g.fillStyle = C.dim; g.textAlign = 'right'; g.fillText(String(v), L - 6, Y(v));
    }
    for (const v of [500, 1000, 1500]) {
      g.strokeStyle = C.grid; g.beginPath(); g.moveTo(X(v), T); g.lineTo(X(v), h - B); g.stroke();
      g.fillStyle = C.dim; g.textAlign = 'center'; g.fillText(String(v), X(v), h - B + 12);
    }
    // the strip for no human Elo
    g.fillStyle = 'rgba(255,255,255,0.025)'; g.fillRect(L, T, STRIP, h - T - B);
    g.strokeStyle = C.axis; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(L + STRIP + 4, T); g.lineTo(L + STRIP + 4, h - B); g.stroke(); g.setLineDash([]);
    g.fillStyle = C.dim; g.textAlign = 'center'; g.fillText('none', L + STRIP / 2, h - B + 12);
    g.fillStyle = C.ink2; g.fillText('human Elo', (AX0 + w - R) / 2, h - 7);
    g.save(); g.translate(11, (T + h - B) / 2); g.rotate(-Math.PI / 2); g.fillText('VLM Elo', 0, 0); g.restore();
    // equal ratings
    g.strokeStyle = C.dim; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(xa), Y(xa)); g.lineTo(X(yb), Y(yb)); g.stroke(); g.setLineDash([]);
    g.strokeStyle = C.axis; g.strokeRect(L, T, w - L - R, h - T - B);
    pts = LEADERBOARD.map(r => ({ r, x: r.humanElo === null ? L + STRIP / 2 : X(r.humanElo), y: Y(r.vlmElo) }));
    const pick = pts.find(p => p.r.model === PICK.model);
    for (const p of pts) {
      if (p === pick) continue;
      const on = ST.access === 'all' || p.r.access === ST.access;
      dot(g, p, on ? 1 : 0.18, false);
    }
    if (pick) {
      dot(g, pick, 1, true);
      g.font = FONT_B; g.fillStyle = '#fff';
      const right = pick.x < w * 0.62;
      g.textAlign = right ? 'left' : 'right';
      g.fillText(pick.r.model, pick.x + (right ? 11 : -11), pick.y - 11);
    }
  };
  function dot(g, p, alpha, picked) {
    g.globalAlpha = alpha;
    const rad = picked ? 7 : 5.5;
    g.fillStyle = C.card; g.beginPath(); g.arc(p.x, p.y, rad + 2, 0, 7); g.fill();
    if (p.r.access === 'open') { g.strokeStyle = C.acc; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, rad - 1, 0, 7); g.stroke(); g.lineWidth = 1; }
    else { g.fillStyle = C.acc; g.beginPath(); g.arc(p.x, p.y, rad, 0, 7); g.fill(); }
    if (picked) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(p.x, p.y, rad + 3.5, 0, 7); g.stroke(); g.lineWidth = 1; }
    g.globalAlpha = 1;
  }
  const near = (x, y) => {
    let best = null, bd = 22;
    for (const p of pts) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
    return best;
  };
  pointerOn(cv, (x, y, e, kind) => {
    if (kind === 'drag') return;
    const p = near(x, y);
    if (!p) { hideTip(cv); return; }
    const r = p.r;
    showTip(cv, e.clientX, e.clientY, `<b>${esc(r.model)}</b> · ${r.access === 'open' ? 'open-weight' : 'proprietary'}<br>human Elo <span class="v">${r.humanElo === null ? 'not in study' : r.humanElo}</span><br>VLM Elo <span class="v">${r.vlmElo}</span>`);
    if (kind === 'tap') setPick(r.model);
  }, () => hideTip(cv));
  watchSize(cv, drawElo);
  drawElo();

  // The picked-model card.
  const card = $('lbPick');
  const drawPick = () => {
    const r = rowOf(PICK.model);
    const note = STRATEGIES.notes.find(n => n.model === r.model);
    const gap = r.static - r.dynamic;
    card.innerHTML = `<h4>${esc(r.model)}</h4><div class="sub">${r.access === 'open' ? 'open-weight' : 'proprietary'} · rank ${rankOf(r.model)} of ${LEADERBOARD.length} by Overall</div>` +
      '<div class="rows">' + FAMILIES.map(f => `<div class="r"><span>${esc(f.label)}</span><div class="bar"><i style="--c:var(--f-${f.key});width:${r[f.key] * 100}%"></i></div><output>${r[f.key].toFixed(2)}</output></div>`).join('') +
      `<div class="r"><span><b style="color:var(--ink);font-weight:500">Overall</b></span><div class="bar"><i style="--c:var(--ink2);width:${r.overall * 100}%"></i></div><output>${r.overall.toFixed(2)}</output></div></div>` +
      '<div class="facts">' +
      `<div><b>${r.humanElo === null ? '–' : r.humanElo}</b><span>human Elo${r.humanElo === null ? ' (not in the study)' : ''}</span></div>` +
      `<div><b>${r.vlmElo}</b><span>VLM Elo</span></div>` +
      `<div><b>${r.vqaPct.toFixed(1)}%</b><span>mean VQA accuracy</span></div>` +
      `<div><b>${r.static.toFixed(2)} / ${r.dynamic.toFixed(2)}</b><span>static / dynamic (gap ${gap.toFixed(2)})</span></div>` +
      '</div>' +
      (note ? `<p class="note">Motion strategy: ${esc(note.text)} (Sec. 4.4).</p>` : '');
  };
  drawPick();
  PICK.subs.push(() => {
    tbl.querySelectorAll('tr.row').forEach(tr => tr.classList.toggle('on', tr.dataset.m === PICK.model));
    drawElo(); drawPick();
  });
}

// ---------------------------------------------------------------- 05 motion
function initMotion() {
  // Dumbbell: static and dynamic means for each model, in Overall order.
  const cv = $('gapCv');
  let rows = [];
  const draw = () => {
    const { g, w, h } = fitCanvas(cv);
    const narrow = w < 480;
    // The right margin holds the value label of the picked row's static dot.
    g.font = FONT_M;
    const L = narrow ? 128 : 160, R = Math.ceil(g.measureText('0.00').width) + 16, T = 6, B = 28;
    const X = v => L + v * (w - L - R);
    const n = LEADERBOARD.length, rh = (h - T - B) / n;
    g.font = FONT; g.textBaseline = 'middle';
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      g.strokeStyle = C.grid; g.beginPath(); g.moveTo(X(v), T); g.lineTo(X(v), h - B); g.stroke();
      g.fillStyle = C.dim; g.textAlign = 'center'; g.fillText(v === 0 || v === 1 ? String(v) : v.toFixed(2), X(v), h - B + 12);
    }
    g.fillStyle = C.ink2; g.textAlign = 'right'; g.fillText('score', w - R, h - 6);
    rows = [];
    LEADERBOARD.forEach((r, i) => {
      const cy = T + rh * (i + 0.5), picked = r.model === PICK.model;
      if (picked) { g.fillStyle = 'rgba(95,208,220,0.10)'; g.fillRect(0, cy - rh / 2, w, rh); }
      g.font = picked ? FONT_B : FONT; g.fillStyle = picked ? '#fff' : C.ink2; g.textAlign = 'left';
      let name = r.model;
      while (g.measureText(name).width > L - 10 && name.length > 4) name = name.slice(0, -2) + '…';
      g.fillText(name, 0, cy);
      const xs = X(r.static), xd = X(r.dynamic);
      g.strokeStyle = picked ? C.ink2 : C.faint; g.lineWidth = 2; g.beginPath(); g.moveTo(xd, cy); g.lineTo(xs, cy); g.stroke(); g.lineWidth = 1;
      const rad = Math.min(5, rh * 0.32);
      for (const [x, col] of [[xd, C.dyn], [xs, C.stat]]) {
        g.fillStyle = picked ? '#152530' : C.card; g.beginPath(); g.arc(x, cy, rad + 2, 0, 7); g.fill();
        g.fillStyle = col; g.beginPath(); g.arc(x, cy, rad, 0, 7); g.fill();
      }
      if (picked) {
        g.font = FONT_M; g.fillStyle = '#fff';
        g.textAlign = 'right'; g.fillText(r.dynamic.toFixed(2), xd - rad - 5, cy);
        g.textAlign = 'left'; g.fillText(r.static.toFixed(2), xs + rad + 5, cy);
      }
      rows.push({ r, y0: cy - rh / 2, y1: cy + rh / 2 });
    });
  };
  pointerOn(cv, (_x, y, e, kind) => {
    if (kind === 'drag') return;
    const hit = rows.find(o => y >= o.y0 && y < o.y1);
    if (!hit) { hideTip(cv); return; }
    const r = hit.r;
    showTip(cv, e.clientX, e.clientY, `<b>${esc(r.model)}</b><br>static <span class="v">${r.static.toFixed(3)}</span> · dynamic <span class="v">${r.dynamic.toFixed(3)}</span><br>gap <span class="v">${(r.static - r.dynamic).toFixed(3)}</span>`);
    if (kind === 'tap') setPick(r.model);
  }, () => hideTip(cv));
  watchSize(cv, draw);
  draw();
  PICK.subs.push(draw);
  // The caption states what the data shows, computed, not typed.
  const all = LEADERBOARD.every(r => r.dynamic < r.static);
  const top = LEADERBOARD[0];
  const meanGap = LEADERBOARD.reduce((s, r) => s + r.static - r.dynamic, 0) / LEADERBOARD.length;
  $('gapCap').innerHTML = `${all ? `For all ${LEADERBOARD.length} models` : 'For most models'} the dynamic dot sits to the left of the static one; the mean gap is ${meanGap.toFixed(2)}. ` +
    `Even ${esc(top.model)}, first on the board, scores ${top.static.toFixed(2)} on the static families and ${top.dynamic.toFixed(2)} on the dynamic ones. <b>Tap a row</b> to pick that model.`;

  // Category effects: diverging bars around zero.
  const ecv = $('effCv');
  let eRows = [];
  const drawEff = () => {
    const { g, w, h } = fitCanvas(ecv);
    const L = 4, R = 8, T = 4, B = 30, lo = -1, hi = 0.6;
    const X = v => L + (v - lo) / (hi - lo) * (w - L - R);
    const n = EFFECTS.length, rh = (h - T - B) / n, bh = Math.min(10, rh * 0.32);
    g.font = FONT; g.textBaseline = 'middle';
    for (const v of [-1, -0.5, 0, 0.5]) {
      g.strokeStyle = v === 0 ? C.axis : C.grid; g.beginPath(); g.moveTo(X(v), T); g.lineTo(X(v), h - B); g.stroke();
      g.fillStyle = C.dim; g.textAlign = 'center'; g.fillText({ '-1': '−1', '-0.5': '−0.5', '0': '0', '0.5': '+0.5' }[String(v)], X(v), h - B + 12);
    }
    g.fillStyle = C.ink2; g.textAlign = 'left'; g.fillText('effect size', L, h - 6);
    eRows = [];
    EFFECTS.forEach((e, i) => {
      const y0 = T + rh * i, by = y0 + rh - bh - 4;
      g.font = FONT; g.textAlign = 'left'; g.fillStyle = C.ink;
      g.fillText(e.contrast, L, y0 + 8);
      const cw = g.measureText(e.contrast + '  ').width;
      g.fillStyle = C.dim; g.fillText('· ' + e.metric, L + cw, y0 + 8);
      g.font = FONT_M; g.fillStyle = C.ink; g.textAlign = 'right'; g.fillText(signed(e.d), w - R, y0 + 8);
      const col = e.d < 0 ? C.neg : C.pos, x0 = X(0), x1 = X(e.d);
      const bx = Math.min(x0, x1), bw = Math.abs(x1 - x0);
      if (e.weak) {
        g.save(); roundRect(g, bx, by, bw, bh, 3); g.clip();
        g.strokeStyle = col; g.lineWidth = 1.5;
        for (let s = bx - bh; s < bx + bw + bh; s += 4) { g.beginPath(); g.moveTo(s, by + bh); g.lineTo(s + bh, by); g.stroke(); }
        g.restore(); g.strokeStyle = col; g.lineWidth = 1; roundRect(g, bx, by, bw, bh, 3); g.stroke();
      } else { g.fillStyle = col; roundRect(g, bx, by, bw, bh, 3); g.fill(); }
      eRows.push({ e, y0, y1: y0 + rh });
    });
  };
  pointerOn(ecv, (_x, y, ev, kind) => {
    if (kind === 'drag') return;
    const hit = eRows.find(o => y >= o.y0 && y < o.y1);
    if (!hit) { hideTip(ecv); return; }
    const e = hit.e;
    showTip(ecv, ev.clientX, ev.clientY, `<b>${esc(e.contrast)}</b> on ${esc(e.metric)}<br>effect <span class="v">${signed(e.d)}</span> (${e.d < 0 ? 'lower' : 'higher'} score)` + (e.weak ? '<br>not consistent across models' : ''));
  }, () => hideTip(ecv));
  watchSize(ecv, drawEff);
  drawEff();

  // Strategy shares: one 100% bar in HTML, a key and the per-model notes.
  const SC = [css('--f-perceptual'), css('--f-dyn2d'), css('--f-geom25'), css('--f-geom3d')];
  const tot = STRATEGIES.overall.reduce((s, o) => s + o.pct, 0);
  $('stratBar').innerHTML = STRATEGIES.overall.map((o, i) => `<i style="--c:${SC[i]};flex:${o.pct}" title="${esc(o.label)}: ${o.pct}%"></i>`).join('');
  $('stratKey').innerHTML = STRATEGIES.overall.map((o, i) => `<li><i class="sw" style="--c:${SC[i]}"></i><b>${o.pct}%</b>${esc(o.label)}</li>`).join('') +
    (tot !== 100 ? `<li style="color:var(--dim)">shares add to ${tot}%: the paper says a few solutions use other approaches</li>` : '');
  $('stratNotes').innerHTML = STRATEGIES.notes.map(n => `<li><b>${esc(n.model)}</b>${esc(n.text)}</li>`).join('');

  // Reasoning effort: three lines on one score axis, VQA as text.
  const rcv = $('reasonCv');
  const lines = [
    { k: 'overall', label: 'Overall', col: () => C.ink },
    { k: 'dyn3d', label: '3D Dynamics', col: () => C.fam.dyn3d },
    { k: 'dyn2d', label: '2D Dynamics', col: () => C.fam.dyn2d },
  ];
  let rPts = [];
  const drawR = () => {
    const { g, w, h } = fitCanvas(rcv);
    const L = 38, R = 92, T = 12, B = 26, lo = 0.4, hi = 0.85;
    const X = i => L + i / (REASONING.length - 1) * (w - L - R), Y = v => h - B - (v - lo) / (hi - lo) * (h - T - B);
    g.font = FONT; g.textBaseline = 'middle';
    for (const v of [0.4, 0.5, 0.6, 0.7, 0.8]) {
      g.strokeStyle = C.grid; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - R, Y(v)); g.stroke();
      g.fillStyle = C.dim; g.textAlign = 'right'; g.fillText(v.toFixed(1), L - 6, Y(v));
    }
    REASONING.forEach((o, i) => { g.fillStyle = C.ink2; g.textAlign = 'center'; g.fillText(o.effort, X(i), h - B + 13); });
    rPts = [];
    for (const ln of lines) {
      const col = ln.col();
      g.strokeStyle = col; g.lineWidth = 2; g.beginPath();
      REASONING.forEach((o, i) => { i ? g.lineTo(X(i), Y(o[ln.k])) : g.moveTo(X(i), Y(o[ln.k])); });
      g.stroke(); g.lineWidth = 1;
      REASONING.forEach((o, i) => {
        g.fillStyle = C.card; g.beginPath(); g.arc(X(i), Y(o[ln.k]), 6, 0, 7); g.fill();
        g.fillStyle = col; g.beginPath(); g.arc(X(i), Y(o[ln.k]), 4, 0, 7); g.fill();
        rPts.push({ x: X(i), y: Y(o[ln.k]), o, ln });
      });
      const last = REASONING[REASONING.length - 1];
      g.fillStyle = C.ink2; g.textAlign = 'left'; g.font = FONT;
      g.fillText(ln.label, X(REASONING.length - 1) + 10, Y(last[ln.k]));
      g.font = FONT;
    }
  };
  pointerOn(rcv, (x, y, e, kind) => {
    if (kind === 'drag') return;
    let best = null, bd = 22;
    for (const p of rPts) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
    if (!best) { hideTip(rcv); return; }
    showTip(rcv, e.clientX, e.clientY, `<b>${best.o.effort} effort</b><br>${best.ln.label} <span class="v">${best.o[best.ln.k].toFixed(2)}</span>`);
  }, () => hideTip(rcv));
  watchSize(rcv, drawR);
  drawR();
  $('reasonVqa').innerHTML = 'VQA accuracy' + REASONING.map(o => `<span>${o.effort}<b>${o.vqaPct.toFixed(1)}%</b></span>`).join('');
}

// ---------------------------------------------------------------- 06 playground hook
// play.js binds #s6 (see the LAYOUT list in index.html). This hook loads
// play.js only when #s6 comes near the view, so the scenes, the scorer
// and the WebGL2 contexts cost nothing before that.
function initPlay() {
  PAGE.playVisible = true;
  import('./play.js')
    .then(m => safe('play', () => m.initPlayground(PAGE)))
    .catch(e => {
      PAGE.errors.push('play load: ' + e.message);
      $('runLog').textContent = 'The playground could not load: ' + e.message;
    });
}

// ---------------------------------------------------------------- chips
function initChips() {
  const links = [...document.querySelectorAll('#chips a')];
  const secs = links.map(a => $(a.dataset.target));
  const ol = $('chips').querySelector('ol');
  const update = () => {
    let best = null;
    for (const s of secs) if (s.getBoundingClientRect().top < innerHeight * 0.4) best = s;
    links.forEach(a => {
      const on = !!best && a.dataset.target === best.id;
      // Scroll only the chip row. scrollIntoView would also scroll the
      // window back to the place of the sticky bar at the top of the page.
      if (on && !a.classList.contains('on')) {
        const l = a.offsetLeft - ol.offsetLeft;
        if (l < ol.scrollLeft || l + a.offsetWidth > ol.scrollLeft + ol.clientWidth) ol.scrollTo({ left: l - 12, behavior: 'smooth' });
      }
      a.classList.toggle('on', on);
    });
  };
  const io = new IntersectionObserver(update, { threshold: [0, 0.25, 0.5, 1] });
  secs.forEach(s => io.observe(s));
}

// ---------------------------------------------------------------- boot
const PAGE = { booted: false, errors: [], math: false };
window.__4dcb = PAGE;
function safe(name, fn) { try { fn(); } catch (e) { PAGE.errors.push(name + ': ' + e.message); console.error(e); } }
colours();
safe('numbers', () => bindNumbers());
onVisible($('s2'), () => safe('bench', initBench));
onVisible($('s3'), () => safe('score', initScore));
onVisible($('s4'), () => safe('board', initBoard));
onVisible($('s5'), () => safe('motion', initMotion));
onVisible($('s6'), () => safe('play', initPlay));
safe('chips', initChips);
typesetAll(document, [
  ['\\Gamma', 'm1'], ['\\mathcal{A}', 'm2'], ['x_{\\rm ref}', 'm3'], ['R_\\Gamma', 'm4'], ['s_\\Gamma', 'm5'],
]).then(() => { PAGE.math = true; });
PAGE.booted = true;
PAGE.pick = PICK;
