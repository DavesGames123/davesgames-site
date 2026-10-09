// ============================================================================
//  PERIODIC TABLE  ·  card.js  ·  the inspect card and the compare table
// ----------------------------------------------------------------------------
//  HTML strings only (no DOM), so node tests read the same text as the page.
//  main.js puts the string into #card or #panel and then draws the small
//  canvases that the string leaves as placeholders:
//    <canvas data-atom>     the live atom (atom.js drawAtom)
//    <canvas data-ie>       successive ionization energies, a sparkline
//    <canvas data-radius>   the atom against H, C and Cs, to scale
//  The card is built in layers that slide in one after the other (CSS
//  animation-delay from --i): the header, the atom, the key bars, the
//  configuration, then the text. full: true adds the isotopes, all
//  numbers, the uses and the description (the pinned inspect panel).
//
//  GREP MAP
//    grep -n "export function cardHTML"     hover card and inspect panel
//    grep -n "export function compareHTML"  two elements side by side
//    grep -n "const BARS"                   the key bars and their scales
//    grep -n "export function drawIE"       the ionization sparkline
//    grep -n "export function drawRadius"   the radius comparison
// ============================================================================
import { ELEMENTS, CAT, BLOCK, PROP, propRange, fmt, fmtMass, fmtTemp, fmtHalfLife, fmtOx, fmtPpb,
  cfgParts, madelungUnicode, EXCEPTIONS, discText, mainIsotope, valence, zeff, expand, L_LETTER, SHELL_LETTER } from './chem.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// '{2}' in the data marks a subscript (H{2}, O{2})
const subs = s => esc(s).replace(/\{(\d+)\}/g, '<sub>$1</sub>');

// Key bars: the value as a fraction of the table's range (log where the
// property spans decades). Missing values show a dash and no bar.
const BARS = [
  ['en', 'Electronegativity', ''],
  ['ie1', 'Ionization energy', 'eV'],
  ['radius', 'Atomic radius', 'pm'],
  ['density', 'Density', 'g/cm³'],
  ['mp', 'Melting point', 'K'],
  ['bp', 'Boiling point', 'K'],
];
function barFrac(id, v) {
  const [lo, hi] = propRange(id), p = PROP[id];
  if (v == null || !isFinite(v)) return null;
  if (p.log) return Math.max(0, Math.min(1, (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))));
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
}
function bar(e, [id, name, unit], col) {
  const p = PROP[id], v = p.get(e), f = barFrac(id, v);
  const pred = (id === 'mp' || id === 'bp') && e.tPred || id === 'density' && e.densPred;
  const val = v == null ? '—' : fmt(v, p.digits > 2 ? 2 : p.digits) + (unit ? ' ' + unit : '') + (pred ? ' *' : '');
  return `<div class="bar"><span class="bl">${name}</span><span class="bv">${esc(val)}</span>` +
    `<i class="bt"><b style="width:${f == null ? 0 : (4 + 96 * f).toFixed(1)}%;background:${col}"></b></i></div>`;
}
function cfgHTML(e) {
  const { core, subs: ss } = cfgParts(e);
  return (core ? `<span class="core">[${core}]</span> ` : '') +
    ss.map(([s, k]) => `<span class="sub l${L_LETTER.indexOf(s[1])}">${s}<sup>${k}</sup></span>`).join(' ');
}
function shellsHTML(e) {
  return e.shells.map((k, i) => `<span class="sh"><b>${k}</b><i>${SHELL_LETTER[i]}</i></span>`).join('');
}
function isoRows(e) {
  const rows = e.iso.slice().sort((a, b) => (b[1] || 0) - (a[1] || 0) || (b[2] ?? Infinity) - (a[2] ?? Infinity)).slice(0, 8);
  if (!rows.length) return '<p class="muted">No isotope data.</p>';
  return `<table class="iso"><thead><tr><th>Isotope</th><th>Natural</th><th>Half-life</th></tr></thead><tbody>` +
    rows.map(([A, ab, hl]) => `<tr><td><sup>${A}</sup>${esc(e.sym)}</td><td>${ab == null ? '—' : fmt(ab, 3) + ' %'}</td><td>${fmtHalfLife(hl)}</td></tr>`).join('') +
    `</tbody></table>`;
}
function exceptionNote(e) {
  if (!EXCEPTIONS.includes(e.sym)) return '';
  return `<p class="note">Breaks the Aufbau order: the Madelung rule predicts ${esc(madelungUnicode(e.z))}.</p>`;
}

export function cardHTML(e, { full = false } = {}) {
  const cat = CAT[e.cat], col = cat.color, blk = BLOCK[e.block];
  const v = valence(e), ze = zeff(e.z, expand(e.cfg), v[0], v[1]);
  const A = mainIsotope(e);
  const ox = (e.oxCommon && e.oxCommon.length ? e.oxCommon : e.ox || []).map(fmtOx).join(', ') || '—';
  const head = `<header class="ch" style="--c:${col};--i:0">
      <div class="tile"><span class="z">${e.z}</span><span class="sym">${esc(e.sym)}</span><span class="m">${fmtMass(e)}</span></div>
      <div class="ht"><h3>${esc(e.name)}</h3>
        <p><span class="chip" style="--c:${col}">${esc(cat.name)}</span><span class="chip" style="--c:${blk.color}">${blk.name}</span></p>
        <p class="meta">Period ${e.period}${e.group ? ' · Group ' + e.group : ''} · ${esc(e.phase || '—')} at 25 °C</p></div>
    </header>`;
  const atom = `<div class="atomwrap" style="--i:1"><canvas data-atom aria-label="Atomic structure of ${esc(e.name)}"></canvas>
      <div class="atomcap"><span>${e.z} p⁺ · ${A - e.z} n⁰ · ${e.z} e⁻ <em>(${A}${esc(e.sym)})</em></span>
      <button class="atomtog" type="button" data-atomtog>Bohr · Orbitals</button></div></div>`;
  const bars = `<div class="bars" style="--i:2">${BARS.map(b => bar(e, b, col)).join('')}</div>`;
  const cfg = `<div class="cfg" style="--i:3"><h4>Configuration</h4><p class="cf">${cfgHTML(e)}</p>
      <h4>Shells</h4><p class="shells">${shellsHTML(e)}</p>${exceptionNote(e)}
      <p class="meta">Valence ${v[0]}${L_LETTER[v[1]]} · Z<sub>eff</sub> ≈ ${fmt(ze, 2)} (Slater) · Oxidation ${esc(ox)}</p></div>`;
  const ie = e.ie && e.ie.length > 1 ? `<div class="ie" style="--i:4"><h4>Ionization energies</h4><canvas data-ie></canvas></div>` : '';
  const facts = `<dl class="facts" style="--i:5">
      <dt>Discovered</dt><dd>${esc(discText(e))}</dd>
      <dt>Name</dt><dd>${esc(e.origin)}</dd>
      ${e.look ? `<dt>Looks</dt><dd>${subs(e.look)}</dd>` : ''}
      ${e.xtal ? `<dt>Crystal</dt><dd>${esc(e.xtal)}</dd>` : ''}
    </dl>`;
  if (!full) return `<div class="card" style="--c:${col}">${head}${atom}${bars}${cfg}${facts}<p class="hint">Click to pin and see everything.</p></div>`;
  const nums = `<dl class="nums" style="--i:6">
      <dt>Atomic mass</dt><dd>${fmtMass(e)} u</dd>
      <dt>Melting point</dt><dd>${fmtTemp(e.sublimes ? null : e.mp)}${e.sublimes ? ' (sublimes)' : ''}${e.tPred ? ' *' : ''}</dd>
      <dt>Boiling point</dt><dd>${fmtTemp(e.bp)}${e.sublimes ? ' (sublimes)' : ''}${e.tPred ? ' *' : ''}</dd>
      <dt>Density</dt><dd>${e.density == null ? '—' : fmt(e.density, 3) + ' g/cm³'}${e.densPred ? ' *' : ''}</dd>
      <dt>Electron affinity</dt><dd>${e.ea == null ? '—' : fmt(e.ea, 3) + ' eV'}</dd>
      <dt>Radii</dt><dd>atomic ${e.r.emp ?? e.r.calc ?? '—'} · covalent ${e.r.cov ?? '—'} · van der Waals ${e.r.vdw ?? '—'} pm</dd>
      <dt>Crust</dt><dd>${fmtPpb(e.ab.crust)}</dd>
      <dt>Ocean</dt><dd>${fmtPpb(e.ab.ocean)}</dd>
      <dt>Universe</dt><dd>${fmtPpb(e.ab.universe)}</dd>
      <dt>Human body</dt><dd>${fmtPpb(e.ab.human)}</dd>
      <dt>All oxidation states</dt><dd>${esc((e.ox || []).map(fmtOx).join(', ') || '—')}</dd>
    </dl>`;
  const rad = `<div class="radius" style="--i:7"><h4>Size against H, C and Cs</h4><canvas data-radius></canvas></div>`;
  const text = `<div class="text" style="--i:8"><h4>About</h4><p>${subs(e.desc)}</p><h4>Uses</h4><p>${esc(e.uses)}</p></div>`;
  const iso = `<div class="isos" style="--i:9"><h4>Isotopes</h4>${isoRows(e)}</div>`;
  const pred = e.tPred || e.densPred ? '<p class="note">* predicted, not measured.</p>' : '';
  const links = `<p class="links" style="--i:10"><a href="../molecules/index.html">Molecule Explorer</a> <a href="../reactions/index.html">Reaction Explorer</a>` +
    (e.z === 1 ? ` <a href="../hydrogen-table/index.html">Hydrogen wave functions</a>` : '') + `</p>`;
  return `<div class="card full" style="--c:${col}">${head}${atom}${bars}${cfg}${ie}${rad}${nums}${text}${iso}${facts}${pred}${links}</div>`;
}

// Two elements side by side: every key number, the larger value marked.
export function compareHTML(a, b) {
  const rows = ['mass', 'en', 'ie1', 'ea', 'radius', 'cov', 'mp', 'bp', 'density', 'crust', 'year', 'zeff'];
  const cell = (e, id) => { const v = PROP[id].get(e); return v == null ? '—' : fmt(v, PROP[id].digits > 2 ? 2 : PROP[id].digits); };
  const hd = e => `<th style="--c:${CAT[e.cat].color}"><span class="sym">${esc(e.sym)}</span>${esc(e.name)}</th>`;
  return `<table class="cmp"><thead><tr><th></th>${hd(a)}${hd(b)}</tr></thead><tbody>` +
    rows.map(id => {
      const p = PROP[id], va = p.get(a), vb = p.get(b);
      const win = va != null && vb != null && va !== vb ? (va > vb ? 0 : 1) : -1;
      return `<tr><td>${esc(p.name)}${p.unit ? ' <em>' + esc(p.unit) + '</em>' : ''}</td><td class="${win === 0 ? 'hi' : ''}">${cell(a, id)}</td><td class="${win === 1 ? 'hi' : ''}">${cell(b, id)}</td></tr>`;
    }).join('') +
    `<tr><td>Configuration</td><td>${cfgHTML(a)}</td><td>${cfgHTML(b)}</td></tr></tbody></table>`;
}

// ── small canvases ──────────────────────────────────────────────────────────
// Successive ionization energies on a log axis: the jump after the valence
// electrons is the shell structure made visible.
export function drawIE(g, e, w, h, col) {
  const ie = e.ie.filter(v => v != null && v > 0);
  g.clearRect(0, 0, w, h);
  if (ie.length < 2) return;
  const lo = Math.log(Math.min(...ie)) - 0.2, hi = Math.log(Math.max(...ie)) + 0.2;
  const x = i => 10 + i * (w - 20) / Math.max(1, ie.length - 1), y = v => h - 16 - (Math.log(v) - lo) / (hi - lo) * (h - 26);
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
  for (let k = 0; k < 4; k++) { const yy = 10 + k * (h - 26) / 3; g.beginPath(); g.moveTo(8, yy); g.lineTo(w - 8, yy); g.stroke(); }
  const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, col); gr.addColorStop(1, '#ffffff');
  g.strokeStyle = gr; g.lineWidth = 2; g.lineJoin = 'round';
  g.beginPath(); ie.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)))); g.stroke();
  // the biggest jump (a shell boundary)
  let jb = 1, jr = 0;
  for (let i = 1; i < ie.length; i++) { const r = ie[i] / ie[i - 1]; if (r > jr) { jr = r; jb = i; } }
  g.font = '500 10px Inter, system-ui, sans-serif'; g.textBaseline = 'top';
  ie.forEach((v, i) => {
    g.fillStyle = i === jb ? '#ffffff' : col;
    g.beginPath(); g.arc(x(i), y(v), i === jb ? 3.5 : 2.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(205,215,235,0.75)'; g.textAlign = 'center'; g.fillText(String(i + 1), x(i), h - 12);
  });
  g.textAlign = 'right'; g.fillStyle = 'rgba(205,215,235,0.85)';
  g.fillText(`${fmt(ie[0], 2)} → ${fmt(ie[ie.length - 1], 0)} eV · jump ×${jr.toFixed(1)} after e⁻ ${jb}`, w - 8, 0);
}
// The atom as a disc against hydrogen, carbon and caesium, to scale.
export function drawRadius(g, e, w, h, col) {
  g.clearRect(0, 0, w, h);
  const ref = [['H', ELEMENTS[0]], ['C', ELEMENTS[5]], ['Cs', ELEMENTS[54]]];
  const R = el => el.r.emp ?? el.r.calc ?? el.r.cov ?? null;
  const list = [...ref.map(([, el]) => el), e].filter((el, i, a) => a.indexOf(el) === i);
  const maxR = Math.max(...list.map(el => R(el) || 0), 1);
  const k = (h / 2 - 14) / maxR;
  let x = 10;
  g.font = '500 11px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
  for (const el of list) {
    const r = (R(el) || 0) * k, me = el === e;
    if (!r) continue;
    x += r;
    const gr = g.createRadialGradient(x - r * 0.3, h / 2 - 8 - r * 0.3, r * 0.1, x, h / 2 - 8, r);
    gr.addColorStop(0, me ? '#ffffff' : 'rgba(220,230,250,0.6)'); gr.addColorStop(1, me ? col : 'rgba(110,125,160,0.35)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, h / 2 - 8, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = me ? '#fff' : 'rgba(205,215,235,0.8)';
    g.fillText(`${el.sym} ${R(el)} pm`, x, h - 14);
    x += r + 14;
  }
}
