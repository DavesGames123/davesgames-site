// ============================================================================
//  ENZYME DESIGN  ·  page logic (ES module)
// ----------------------------------------------------------------------------
//  Binds the figures and tables of index.html to the facts in data.js and to
//  the motif language in design.js. Each section starts when it first comes
//  near the view. Every chart is a 2D canvas or plain HTML, drawn by this
//  file with no chart library. No WebGL and no WebGPU context: the 3D view
//  comes from view3d.js, which draws on a 2D canvas.
//
//  SOURCES. data.js holds every paper fact and every repository fact. This
//  file types none of them. The preprint is All Rights Reserved, so the only
//  paper claims the page makes are the ones in PAPER.claims, already in our
//  own words.
//
//  LATE MODULES. motif.js, view3d.js and lab.js are separate modules of this
//  page. loadModule imports them when their section comes near the view. If
//  one of them is absent, the page still works and its card holds a plain
//  note.
//
//  GREP MAP
//    grep -n 'function fitCanvas'    canvas sizing at devicePixelRatio
//    grep -n 'function pointerOn'    hover + tap + drag on a canvas
//    grep -n 'function showTip'      shared tooltip
//    grep -n 'function loadModule'   import a module only if it is there
//    grep -n 'function bindNumbers'  data-d attributes to text
//    grep -n 'function initHeader'   citation, terms note, reference list
//    grep -n 'function initProblem'  section 01 claims and barrier chart
//    grep -n 'function initCampaigns' section 02 campaign cards
//    grep -n 'function initMotif'    section 02 3D view and live geometry
//    grep -n 'function initScaffold' section 03 motif_str box and diagram
//    grep -n 'function initLab'      sections 04 to 06: loads lab.js
//    grep -n 'function initPipeline' section 07 stages and tables
//    grep -n 'function initChips'    sticky section bar
// ============================================================================
import { PAPER, STAGES, DIFFUSION, CAMPAIGNS, METRICS, KEMP_MANIFEST, LICENCES } from './data.js';
import { parseMotifStr, planChain, rng } from './design.js';
import { typesetAll } from '../../lib/sci-math.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FONT = '11px Inter, system-ui, sans-serif';
const FONT_B = '500 11px Inter, system-ui, sans-serif';
const FONT_M = '11px ui-monospace, "SF Mono", Menlo, monospace';

// Colours, read once from style.css so the canvas and the HTML agree.
let C = null;
function colours() {
  C = {
    ink: css('--ink'), ink2: css('--ink2'), dim: css('--dim'), faint: css('--faint'),
    card: css('--card'), card2: css('--card2'), acc: css('--acc'),
    held: css('--held'), des: css('--des'), pass: css('--pass'), fail: css('--fail'),
    motif: css('--f-motif'), pocket: css('--f-pocket'), fold: css('--f-fold'), sc: css('--f-sc'),
    grid: 'rgba(255,255,255,0.08)', axis: 'rgba(255,255,255,0.25)',
  };
}

// ---------------------------------------------------------------- formats
function fmt(v, f) {
  if (v === null || v === undefined) return '–';
  switch (f) {
    case 'int': return Number(v).toLocaleString('en-US');
    case 'f1': return Number(v).toFixed(1);
    case 'f2': return Number(v).toFixed(2);
    case 'f3': return Number(v).toFixed(3);
    default: return String(v);
  }
}
// A large factor as a power of ten, for the rate speed-up. The exponent
// uses the superscript digits, because the output box holds plain text.
const SUP = '\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079';
const sup = n => String(n).replace(/\d/g, d => SUP[+d]);
function power(v) {
  if (!Number.isFinite(v)) return '\u2013';
  if (v < 1000) return Math.round(v).toLocaleString('en-US');
  const e = Math.floor(Math.log10(v));
  return `${(v / 10 ** e).toFixed(1)} \u00d7 10${sup(e)}`;
}

// ---------------------------------------------------------------- canvas
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
// Redraw after a width change, coalesced to one frame.
function watchSize(el, fn) {
  let pend = false, lastW = -1;
  new ResizeObserver(() => {
    if (pend) return; pend = true;
    requestAnimationFrame(() => { pend = false; const w = el.clientWidth; if (w !== lastW) { lastW = w; fn(); } });
  }).observe(el);
}
function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}
// A segmented button group. items = [{ v, label }]. fn(v) runs on a press.
function segFill(id, items, value, fn) {
  const el = $(id); if (!el) return;
  el.innerHTML = items.map(it => `<button data-v="${esc(it.v)}"${it.v === value ? ' class="on"' : ''}>${esc(it.label)}</button>`).join('');
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    el.querySelectorAll('button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    fn(b.dataset.v);
  });
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

// Hover, tap and drag on a canvas. fn(x, y, ev, kind): kind is 'hover',
// 'tap' (a press and release without much motion) or 'drag'. leave() runs
// when the mouse leaves the canvas.
function pointerOn(cv, fn, leave) {
  let down = null;
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => { down = { id: e.pointerId, x: e.clientX, y: e.clientY }; const [x, y] = pos(e); fn(x, y, e, 'drag'); });
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

// ---------------------------------------------------------------- late modules
// motif.js, view3d.js and lab.js are separate modules of this page. If one
// of them is absent or throws while it loads, the page keeps working and
// its card holds a plain note. loadModule records the name in PAGE.missing.
async function loadModule(rel) {
  try { return await import(new URL(rel, import.meta.url).href); }
  catch (e) { PAGE.missing.push(rel + ': ' + e.message); return null; }
}

// ---------------------------------------------------------------- numbers
// Every element with data-d="OBJ.path" gets the value from data.js, with
// the format in data-fmt (see fmt).
const DATA = { PAPER, STAGES, DIFFUSION, CAMPAIGNS, METRICS, KEMP_MANIFEST, LICENCES };
function bindNumbers(root = document) {
  for (const el of root.querySelectorAll('[data-d]')) {
    const v = el.dataset.d.split('.').reduce((o, k) => (o == null ? undefined : o[k]), DATA);
    if (v === undefined) { PAGE.errors.push('no data for ' + el.dataset.d); continue; }
    el.textContent = fmt(v, el.dataset.fmt);
  }
}

// ---------------------------------------------------------------- header
function initHeader() {
  const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`;
  $('citeLine').innerHTML = `${esc(PAPER.lead)}, ${link(PAPER.url, '<em>' + esc(PAPER.title) + '</em>')}, ` +
    `${esc(PAPER.venue)}, posted ${esc(PAPER.posted)}. ${esc(PAPER.groups)}. ` +
    `doi <span class="mono">${esc(PAPER.doi)}</span> · ${link(PAPER.code, 'code on GitHub')}`;

  const terms = what => (LICENCES.find(l => l.what === what) || {}).terms || '';
  $('termsNote').innerHTML = 'Nothing on this page is AlphaProtein Novo. The pipeline source code is ' +
    `<b>${esc(terms('Pipeline source code'))}</b>, and this page builds on what its documentation states. ` +
    `The generator's weights carry the <b>${esc(terms('Generator model weights'))}</b> and anything the model made ` +
    `carries the <b>${esc(terms('Model outputs'))}</b>: both are separate downloads and neither is on this site. ` +
    'The lab in sections 04 to 06 is our own simulation and holds no learned model of any kind. ' +
    'The preprint is <b>' + esc(terms('The preprint')) + '</b>, so this page states its claims in its own words.';

  $('refList').innerHTML = [
    `<div><b>Preprint.</b> ${esc(PAPER.lead)}, <em>${esc(PAPER.title)}</em>, ${esc(PAPER.venue)}. ` +
      `${link(PAPER.url, 'biorxiv.org')} · doi <span class="mono">${esc(PAPER.doi)}</span>. ` +
      `${esc((LICENCES.find(l => l.what === 'The preprint') || {}).can || '')}</div>`,
    `<div><b>Code.</b> ${link(PAPER.code, 'github.com/google-deepmind/alphaprotein-novo')}, ` +
      `${esc(terms('Pipeline source code'))}. The pipeline, the example manifests and the evaluation suites named on this page are documented there.</div>`,
    '<div><b>This page.</b> Our own code: the design format and the motif-language parser, the scaffolder, the sequence designer, the metrics and the 3D view. ' +
      'It copies no source from the repository and no figure from the preprint.</div>',
  ].join('');
}

// ---------------------------------------------------------------- 01 problem
function initProblem() {
  $('claimList').innerHTML = PAPER.claims.map(c =>
    `<li><b>${esc(({ outperform: 'Better than starting from nature', nitrene: 'New chemistry, one product', dehp: 'A pollutant, in hard conditions', model: 'Model reactions', enablers: 'What made it work' })[c.id] || c.id)}</b>${esc(c.text)}</li>`).join('');

  // A drawn free-energy profile. The numbers are illustration, not data:
  // the barrier is a round number and the relation is the textbook one.
  const cv = $('barrierCv'), inp = $('barrierIn'), out = $('barrierOut');
  const BARRIER = 95, DROP = -24, R = 8.314, T = 298.15;   // kJ/mol, K
  const prof = (x, top) => DROP * (x * x * (3 - 2 * x)) + top * Math.exp(-((x - 0.5) ** 2) / (2 * 0.145 ** 2));
  let cursor = null;
  const draw = () => {
    const { g, w, h } = fitCanvas(cv);
    const dd = +inp.value;
    const L = 34, Rm = 8, Tm = 12, B = 26;
    const X = x => L + x * (w - L - Rm);
    const lo = DROP - 8, hi = BARRIER + 10;
    const Y = v => Tm + (hi - v) / (hi - lo) * (h - Tm - B);
    g.font = FONT; g.textBaseline = 'middle';
    for (let v = 0; v <= BARRIER; v += 25) {
      g.strokeStyle = C.grid; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - Rm, Y(v)); g.stroke();
      g.fillStyle = C.dim; g.textAlign = 'right'; g.fillText(String(v), L - 5, Y(v));
    }
    g.strokeStyle = C.axis; g.beginPath(); g.moveTo(L, Y(lo)); g.lineTo(w - Rm, Y(lo)); g.stroke();
    const curve = (top, col, dash) => {
      g.save(); g.setLineDash(dash); g.strokeStyle = col; g.lineWidth = 2; g.beginPath();
      for (let i = 0; i <= 120; i++) { const x = i / 120, y = Y(prof(x, top)); i ? g.lineTo(X(x), y) : g.moveTo(X(x), y); }
      g.stroke(); g.restore();
    };
    curve(BARRIER, C.dim, [5, 4]);
    curve(BARRIER - dd, C.motif, []);
    // The gap the enzyme pays for, drawn between the two curve tops. The
    // profile peaks at prof(0.5, top), not at top, so the bracket is
    // anchored to the curves themselves or it floats above them.
    const topA = prof(0.5, BARRIER), topB = prof(0.5, BARRIER - dd);
    g.strokeStyle = C.acc; g.lineWidth = 1; g.beginPath();
    g.moveTo(X(0.5), Y(topA)); g.lineTo(X(0.5), Y(topB)); g.stroke();
    g.fillStyle = C.acc; g.font = FONT_M; g.textAlign = 'left';
    g.fillText(`${dd.toFixed(1)} kJ/mol`, X(0.5) + 6, (Y(topA) + Y(topB)) / 2);
    g.font = FONT; g.fillStyle = C.dim; g.textAlign = 'right';
    g.fillText('no enzyme', X(0.5) - 8, Y(topA) - 12);
    g.fillStyle = C.motif; g.fillText('with the motif held', X(0.5) - 8, Y(topB) + 14);
    g.fillStyle = C.dim; g.textAlign = 'center';
    g.fillText('reaction coordinate', (L + w - Rm) / 2, h - B + 14);
    g.textAlign = 'left'; g.fillText('kJ/mol', 0, Tm - 4);
    if (cursor !== null) {
      g.strokeStyle = C.axis; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(cursor), Tm); g.lineTo(X(cursor), Y(lo)); g.stroke(); g.setLineDash([]);
      for (const [top, col] of [[BARRIER, C.dim], [BARRIER - dd, C.motif]]) {
        g.fillStyle = col; g.beginPath(); g.arc(X(cursor), Y(prof(cursor, top)), 3.2, 0, 7); g.fill();
      }
    }
    const factor = Math.exp(dd * 1000 / (R * T));
    out.textContent = `${dd.toFixed(1)} kJ/mol → ${power(factor)} times faster`;
  };
  inp.addEventListener('input', draw);
  pointerOn(cv, (x, _y, e, kind) => {
    const { width } = cv.getBoundingClientRect();
    const L = 34, Rm = 8;
    cursor = clamp((x - L) / Math.max(1, width - L - Rm), 0, 1);
    draw();
    const dd = +inp.value;
    showTip(cv, e.clientX, e.clientY, `<b>reaction coordinate ${cursor.toFixed(2)}</b><br>` +
      `no enzyme <span class="v">${prof(cursor, BARRIER).toFixed(0)}</span> kJ/mol<br>` +
      `with the motif <span class="v">${prof(cursor, BARRIER - dd).toFixed(0)}</span> kJ/mol`);
    if (kind === 'tap') return;
  }, () => { cursor = null; hideTip(cv); draw(); });
  watchSize(cv, draw);
  draw();
}

// ---------------------------------------------------------------- 02 motif
// The three motifs come from motif.js and the view from view3d.js. Both are
// separate modules of this page, so the card says so if one is absent.
// The campaign cards need no module: they are repository facts in data.js.
function initCampaigns() {
  $('campCards').innerHTML = CAMPAIGNS.map(c => `<article class="camp">
    <h4>${esc(c.label)}</h4>
    <div class="did">${esc(c.design)}</div>
    <p>${esc(c.motif)}</p>
    <div class="states"><i class="n">folds:</i>${c.states.map(s => `<i>${esc(s)}</i>`).join('')}</div>
    <p class="note">${esc(c.note)} Manifest in <span class="mono">examples/${esc(c.dir)}</span>, scored by the <span class="mono">${esc(c.suite)}</span> suite.</p>
  </article>`).join('');
}

// The 3D view and the live measurements need motif.js and view3d.js.
async function initMotif() {
  const pend = msg => { const e = $('motifEmpty'); if (e) e.textContent = msg; $('geoTable').innerHTML = `<tbody><tr><td>${esc(msg)}</td></tr></tbody>`; };
  const [mod, v3] = await Promise.all([loadModule('./motif.js'), loadModule('./view3d.js')]);
  if (!mod || !Array.isArray(mod.MOTIFS) || !mod.MOTIFS.length) { pend('The motif models have not shipped yet.'); return; }
  if (!v3 || typeof v3.createView !== 'function') { pend('The 3D view has not shipped yet.'); return; }

  const cv = $('motifView');
  let view = null, motif = null;
  const onPick = (id, info) => {
    if (!motif) return;
    if (info && info.kind === 'ligand') {
      const a = (motif.ligand.atoms || [])[info.index] || {};
      showTip(cv, lastPt.x, lastPt.y, `<b>${esc(motif.ligand.name || 'ligand')}</b><br>atom <span class="v">${esc(a.name || '?')}</span>, element ${esc(a.el || '?')}`);
      return;
    }
    const r = motif.residues[id];
    if (!r) { hideTip(cv); return; }
    showTip(cv, lastPt.x, lastPt.y, `<b>${esc(r.name || r.code)} ${esc(String(r.chain || ''))}${esc(String(r.resId ?? ''))}</b><br>` +
      `held atoms: <span class="v">${esc((r.tip || []).join(' ') || '–')}</span>`);
  };
  const lastPt = { x: 0, y: 0 };
  cv.addEventListener('pointerdown', e => { lastPt.x = e.clientX; lastPt.y = e.clientY; });
  try { view = v3.createView(cv, { spin: true, onPick }); } catch (e) { PAGE.errors.push('createView: ' + e.message); pend('The 3D view could not start.'); return; }
  $('motifEmpty').hidden = true;

  // view3d draws a Design, so wrap the motif in the smallest design that
  // holds it: one residue per motif residue, with the chain tube hidden.
  // The motif residues are not neighbours in any chain, so a tube through
  // them would be a lie.
  const designFromMotif = m => {
    const n = m.residues.length;
    const ca = new Float32Array(n * 3), cb = new Float32Array(n * 3);
    m.residues.forEach((r, i) => {
      const at = r.atoms || [];
      const pick = name => at.find(a => a.name === name);
      const mean = () => at.reduce((s, a) => [s[0] + a.x / at.length, s[1] + a.y / at.length, s[2] + a.z / at.length], [0, 0, 0]);
      const A = pick('CA') || { x: mean()[0], y: mean()[1], z: mean()[2] };
      const B = pick('CB') || A;
      ca[i * 3] = A.x; ca[i * 3 + 1] = A.y; ca[i * 3 + 2] = A.z;
      cb[i * 3] = B.x; cb[i * 3 + 1] = B.y; cb[i * 3 + 2] = B.z;
    });
    return {
      n, ca, cb, fixed: new Uint8Array(n).fill(1), motifId: new Int32Array(n).map((_, i) => i),
      seq: m.residues.map(r => r.code || 'X').join(''), ss: 'L'.repeat(n), ligand: m.ligand, meta: { motif: m.id },
    };
  };

  // Resolve an atom reference of a geometry entry: 'res0:OE2' or 'lig:N3'.
  const atomOf = (m, ref) => {
    const [who, name] = String(ref).split(':');
    const list = who === 'lig' ? m.ligand.atoms : (m.residues[+who.replace(/\D/g, '')] || { atoms: [] }).atoms;
    return list.find(a => a.name === name) || null;
  };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const angle = (a, b, c) => {
    const u = [a.x - b.x, a.y - b.y, a.z - b.z], v = [c.x - b.x, c.y - b.y, c.z - b.z];
    const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const n = Math.hypot(...u) * Math.hypot(...v);
    return n ? Math.acos(clamp(d / n, -1, 1)) * 180 / Math.PI : NaN;
  };
  // Measure one geometry entry from the arrangement as it stands.
  const measure = (m, gm) => {
    const refs = (gm.atoms || []).map(r => atomOf(m, r));
    if (refs.some(a => !a)) return null;
    if (gm.kind === 'angle') return refs.length >= 3 ? angle(refs[0], refs[1], refs[2]) : null;
    return refs.length >= 2 ? dist(refs[0], refs[1]) : null;
  };

  const show = id => {
    try { motif = mod.motifById(id); } catch (e) { PAGE.errors.push('motifById: ' + e.message); return; }
    $('motifBlurb').textContent = motif.blurb || (mod.MOTIFS.find(x => x.id === id) || {}).blurb || '';
    const unit = gm => (gm.kind === 'angle' ? '°' : ' Å');
    $('geoTable').innerHTML = '<thead><tr><th>What is held</th><th>now</th><th>wanted</th><th>in</th></tr></thead><tbody>' +
      motif.geometry.map(gm => {
        const v = measure(motif, gm);
        const ok = v !== null && Math.abs(v - gm.ideal) <= gm.tol;
        return `<tr><td><b>${esc(gm.label)}</b><small>${esc(gm.why)}</small></td>` +
          `<td class="v" data-col="now">${v === null ? '–' : v.toFixed(2) + unit(gm)}</td>` +
          `<td class="v" data-col="wanted">${Number(gm.ideal).toFixed(2)} ± ${Number(gm.tol).toFixed(2)}</td>` +
          `<td class="p ${ok ? 'ok' : 'no'}">${v === null ? '?' : ok ? 'yes' : 'no'}</td></tr>`;
      }).join('') + '</tbody>';
    try {
      const scene = {
        design: designFromMotif(motif), motif, ligand: motif.ligand,
        trace: false, pocket: false, colorBy: 'uniform', selected: null,
      };
      // A motif is a few angstroms across, and the default camera holds a
      // whole protein. Pull it in, or the arrangement is a dot.
      const radius = Math.max(8, v3.sceneBounds(scene).radius * 0.62);
      view.draw(scene, { fit: true, camera: { radius } });
    } catch (e) { PAGE.errors.push('view.draw: ' + e.message); }
  };
  segFill('motifPick', mod.MOTIFS.map(m => ({ v: m.id, label: m.label })), mod.MOTIFS[0].id, show);
  const spin = $('spinBtn');
  spin.addEventListener('click', () => {
    const on = spin.getAttribute('aria-pressed') !== 'true';
    spin.setAttribute('aria-pressed', String(on));
    try { view.setSpin(on); } catch { /* the view may not spin */ }
  });
  // view3d keeps its own ResizeObserver, so the page does not resize it.
  show(mod.MOTIFS[0].id);
}

// ---------------------------------------------------------------- 03 scaffold
// The motif_str box. parseMotifStr and planChain come from design.js, so
// the diagram shows exactly what the generator would be given.
function initScaffold() {
  const inp = $('msIn'), len = $('msLen'), seed = $('msSeed'), btn = $('msBtn');
  const cv = $('msCv'), out = $('msOut'), err = $('msErr');
  inp.value = KEMP_MANIFEST.design.motif_str;
  len.value = KEMP_MANIFEST.design.seq_length;
  let blocks = [], plan = null, parsed = null;

  const read = () => {
    err.textContent = ''; inp.classList.remove('bad'); len.classList.remove('bad');
    parsed = null; plan = null;
    const rand = rng((+seed.value || 0) + 1);
    try { parsed = parseMotifStr(inp.value, rand); }
    catch (e) { inp.classList.add('bad'); err.textContent = 'motif_str: ' + e.message; return; }
    try { plan = planChain(parsed, { seqLength: len.value.trim() || null, rand }); }
    catch (e) { len.classList.add('bad'); err.textContent = 'seq_length: ' + e.message; return; }
  };
  const draw = () => {
    const { g, w, h } = fitCanvas(cv);
    blocks = [];
    if (!parsed || !plan) { g.fillStyle = C.dim; g.font = FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('fix the line above to see the chain', w / 2, h / 2); return; }
    const L = 2, Rm = 2, top = 26, bh = Math.min(54, h - top - 44);
    const total = plan.total;
    const X = n => L + n / total * (w - L - Rm);
    g.font = FONT; g.textBaseline = 'middle';
    g.fillStyle = C.ink2; g.textAlign = 'left';
    g.fillText(`${total} residues`, L, 12);
    g.textAlign = 'right';
    g.fillStyle = C.held; g.fillText('held', w - 52, 12);
    g.fillStyle = C.des; g.fillText('designed', w - Rm, 12);
    let at = 0;
    parsed.chain.forEach((s, i) => {
      const n = plan.lengths[i], x0 = X(at), x1 = X(at + n);
      const motif = s.kind === 'motif';
      g.fillStyle = motif ? C.held : C.des;
      roundRect(g, x0 + 0.6, top, Math.max(2.4, x1 - x0 - 1.2), bh, 4); g.fill();
      const tok = motif ? s.chain + s.from + (s.to > s.from ? '-' + s.to : '') : (s.lo === s.hi ? String(s.lo) : `${s.lo}-${s.hi}`);
      if (x1 - x0 > 34) {
        g.fillStyle = '#05070c'; g.font = FONT_B; g.textAlign = 'center';
        g.fillText(tok, (x0 + x1) / 2, top + bh / 2 - 7);
        g.font = FONT_M; g.fillText(String(n), (x0 + x1) / 2, top + bh / 2 + 8);
      } else if (!motif && x1 - x0 > 16) {
        g.fillStyle = '#05070c'; g.font = FONT_M; g.textAlign = 'center'; g.fillText(String(n), (x0 + x1) / 2, top + bh / 2);
      }
      blocks.push({ x0, x1, y0: top, y1: top + bh, tok, n, motif, from: at + 1, to: at + n, s });
      at += n;
    });
    // Residue ticks under the bar.
    const step = total > 220 ? 50 : total > 90 ? 20 : 10;
    g.font = FONT; g.fillStyle = C.dim; g.textAlign = 'center'; g.strokeStyle = C.grid;
    for (let n = 0; n <= total; n += step) {
      g.beginPath(); g.moveTo(X(n), top + bh + 2); g.lineTo(X(n), top + bh + 7); g.stroke();
      g.fillText(String(n), clamp(X(n), 10, w - 10), top + bh + 17);
    }
    g.textAlign = 'left'; g.fillStyle = C.ink2;
    g.fillText('resolved: ' + parsed.resolved, L, top + bh + 34);
  };
  const report = () => {
    if (!parsed || !plan) { out.innerHTML = ''; return; }
    const held = parsed.chain.reduce((s, x, i) => s + (x.kind === 'motif' ? plan.lengths[i] : 0), 0);
    const bits = [
      `<span>total length<b>${plan.total}</b></span>`,
      `<span>held residues<b>${held}</b></span>`,
      `<span>designed residues<b>${plan.total - held}</b></span>`,
      `<span>segments<b>${parsed.chain.length}</b></span>`,
      `<span>ligand chains<b>${parsed.ligandChains.length ? esc(parsed.ligandChains.join(' ')) : 'none'}</b></span>`,
    ];
    if (plan.missed) bits.push(`<span style="color:var(--fail)">this layout cannot reach the requested length: it can only make ${plan.missed.reach.lo} to ${plan.missed.reach.hi}</span>`);
    out.innerHTML = bits.join('');
  };
  const all = () => { read(); draw(); report(); };
  inp.addEventListener('input', all);
  len.addEventListener('input', all);
  seed.addEventListener('input', all);
  btn.addEventListener('click', () => { seed.value = String((+seed.value || 0) + 1); all(); });
  pointerOn(cv, (x, y, e, kind) => {
    if (kind === 'drag') return;
    const b = blocks.find(q => x >= q.x0 - 2 && x <= q.x1 + 2 && y >= q.y0 - 6 && y <= q.y1 + 6);
    if (!b) { hideTip(cv); return; }
    const what = b.motif
      ? `held at the input coordinates of chain ${esc(b.s.chain)}, residue${b.s.to > b.s.from ? 's' : ''} ${b.s.from}${b.s.to > b.s.from ? ' to ' + b.s.to : ''}`
      : (b.s.lo === b.s.hi ? 'a fixed run of designed chain' : `a designed run, sampled from ${b.s.lo} to ${b.s.hi}`);
    showTip(cv, e.clientX, e.clientY, `<b>${esc(b.tok)}</b><br>${what}<br>residues <span class="v">${b.from}–${b.to}</span>, length <span class="v">${b.n}</span>`);
  }, () => hideTip(cv));
  watchSize(cv, draw);
  all();

  // The real manifest, field for field.
  const rows = [];
  const push = (k, v, cls) => rows.push(`<tr${cls ? ' class="' + cls + '"' : ''}><td>${esc(k)}</td><td class="${/[_:|,-]/.test(String(v)) ? 'mono' : ''}">${esc(v)}</td></tr>`);
  const group = name => rows.push(`<tr><td class="grp" colspan="2">${esc(name)}</td></tr>`);
  group('defaults');
  for (const [k, v] of Object.entries(KEMP_MANIFEST.defaults)) push(k, v);
  group('design');
  for (const [k, v] of Object.entries(KEMP_MANIFEST.design)) push(k, v);
  group('resequence');
  for (const [k, v] of Object.entries(KEMP_MANIFEST.resequence)) push(k, String(v));
  group('folding');
  for (const [k, v] of Object.entries(KEMP_MANIFEST.folding)) push(k, Array.isArray(v) ? v.join(', ') : v);
  group('evaluation');
  for (const [k, v] of Object.entries(KEMP_MANIFEST.evaluation)) push(k, v);
  $('manifestTable').innerHTML = '<tbody>' + rows.join('') + '</tbody>';
}

// ---------------------------------------------------------------- 04 to 06 lab
// lab.js owns the controls of sections 04 to 06. This hook fills the
// controls that come from the manifest, then loads lab.js when the lab
// first comes near the view.
function initLabControls() {
  $('motifStr').value = KEMP_MANIFEST.design.motif_str;
  $('seqLen').value = KEMP_MANIFEST.design.seq_length;
}
async function initLab() {
  const mod = await loadModule('./lab.js');
  if (!mod || typeof mod.initLab !== 'function') {
    const msg = 'The lab has not shipped yet. Sections 01 to 03 and 07 need it for nothing.';
    $('runLog').textContent = msg;
    for (const id of ['labEmpty', 'funnelEmpty']) { const e = $(id); if (e) e.textContent = 'Not shipped yet.'; }
    const cp = $('campProg'); if (cp) cp.textContent = msg;
    for (const id of ['metricCard', 'seqPanel', 'scBox']) {
      const e = $(id); const slot = e && e.querySelector('.mc-empty');
      if (slot) slot.textContent = 'Not shipped yet.';
    }
    return;
  }
  try { await mod.initLab(PAGE); } catch (e) { PAGE.errors.push('lab: ' + e.message); $('runLog').textContent = 'The lab stopped: ' + e.message; }
}

// ---------------------------------------------------------------- 07 pipeline
function initPipeline() {
  $('stageList').innerHTML = STAGES.map(s => `<li class="stage">
    <div class="n">stage ${s.n}${s.optional ? '<span class="opt">optional</span>' : ''}</div>
    <b>${esc(s.label)}</b>
    <div class="script">${esc(s.script)}</div>
    <span>${esc(s.what)}</span>
    <div class="out">${esc(s.out)}</div>
  </li>`).join('');

  const rows = [`<tr><td>steps, default</td><td class="mono">${DIFFUSION.totalSteps}</td></tr>`];
  rows.push('<tr><td class="grp" colspan="2">partial diffusion: steps taken back, and what is left of the parent</td></tr>');
  for (const p of DIFFUSION.partial) {
    rows.push(`<tr><td>${p.steps} of ${DIFFUSION.totalSteps}</td><td>TM ≈ <span class="mono">${(p.tm / 100).toFixed(2)}</span> to the parent — ${esc(p.note)}</td></tr>`);
  }
  const ex = DIFFUSION.parentExample;
  rows.push('<tr><td class="grp" colspan="2">the shipped example</td></tr>');
  rows.push(`<tr><td>${ex.steps} steps back</td><td><span class="mono">${esc(ex.parent)}</span> → <span class="mono">${esc(ex.child)}</span></td></tr>`);
  $('diffTable').innerHTML = '<tbody>' + rows.join('') + '</tbody>';

  let last = null;
  $('metricTable').innerHTML = '<thead><tr><th>Family</th><th>Metric</th><th>Field</th><th>What it measures</th><th>Better</th><th>On this page</th></tr></thead><tbody>' +
    METRICS.map(m => {
      const start = m.group !== last; last = m.group;
      return `<tr${start ? ' class="gstart"' : ''}><td class="g">${start ? esc(m.group) : ''}</td>` +
        `<td>${esc(m.label)}</td><td class="k">${esc(m.key)}</td><td>${esc(m.what)}</td>` +
        `<td class="d">${m.lower ? 'lower' : 'higher'}${m.unit ? ' (' + esc(m.unit) + ')' : ''}</td>` +
        `<td class="t ${m.toy ? 'y' : 'n'}">${m.toy ? 'yes, our own' : 'no'}</td></tr>`;
    }).join('') + '</tbody>';

  $('licenceTable').innerHTML = '<thead><tr><th>What</th><th>Terms</th><th>What that means here</th></tr></thead><tbody>' +
    LICENCES.map(l => `<tr><td>${esc(l.what)}</td><td class="terms">${esc(l.terms)}</td><td>${esc(l.can)}</td></tr>`).join('') + '</tbody>';
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
      // Scroll the chip row only. scrollIntoView would also scroll the
      // window back to the sticky bar at the top of the page.
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
const PAGE = { booted: false, errors: [], missing: [], math: false };
window.__apn = PAGE;
function safe(name, fn) { try { fn(); } catch (e) { PAGE.errors.push(name + ': ' + e.message); console.error(e); } }
colours();
safe('numbers', () => bindNumbers());
safe('header', initHeader);
safe('labControls', initLabControls);
safe('problem', initProblem);
safe('campaigns', initCampaigns);
onVisible($('s2'), () => { initMotif().catch(e => PAGE.errors.push('motif: ' + e.message)); });
safe('scaffold', initScaffold);
safe('pipeline', initPipeline);
onVisible($('s4'), () => { initLab().catch(e => PAGE.errors.push('lab load: ' + e.message)); });
safe('chips', initChips);
typesetAll(document, [
  ['k_{\\rm cat}', 'm1'], ['\\Delta\\Delta G^{\\ddagger}', 'm2'], ['\\mathrm{RMSD}', 'm3'],
  ['\\mathrm{TM}', 'm4'], ['N_k', 'm5'], ['L', 'm6'],
]).then(ok => { PAGE.math = ok.every(Boolean); });
PAGE.booted = true;
