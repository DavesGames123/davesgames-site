// ============================================================================
//  SCIENCE TOOLKIT  ·  main.js  ·  the page shell
// ----------------------------------------------------------------------------
//  Three views in one page:
//    pad    the home view: the scratchpad (pad.js). One line in, an answer
//           with its method out.
//    index  "All tools": the category tabs and the tool cards from
//           registry.js.
//    tool   one tool in full: inputs, result, plots, method, references.
//  A tool's code (tools/<category>.js) loads the first time a tool of that
//  category opens in the full view. The scratchpad loads intent.js, which
//  holds every tool definition for the inline forms.
//
//  A tool definition gives inputs, run(values), TeX, a method text and
//  references (see the header of tools/units.js). The full view makes the
//  form, calls run() on each edit (debounced), and shows the rows, extra
//  HTML, a plot (SVG) and the method.
//
//  HASH   ""               the scratchpad, lines from this device
//         "#pad=<text>"    the scratchpad with these lines (a shared link)
//         "#cat=<id>"      all tools, one category ("all" for every one)
//         "#<tool>?k=v&…"  one tool; only inputs that differ from the default
//
//  window.__sciTools exposes open(), show(), the current tool, the pad and
//  an error list for the node boot test (tests.mjs).
//
//  GREP MAP
//    grep -n "function show("         switch between pad, index and tool
//    grep -n "function renderGrid"    tabs and cards
//    grep -n "async function openTool"  load a module, build the form
//    grep -n "function runTool"       run() and the result view
//    grep -n "function exportFig"     SVG and PNG download
//    grep -n "PALETTE"                the command palette
//    grep -n "function route"         hash routing
//    grep -n "const ready"            boot: grid, pad, first route
// ============================================================================
import { CATS, TOOLS, BY_ID, search, RELATED } from './registry.js';
import { esc } from './kit.js';
import { field, valueOf, texInto, copyText } from './view.js';
import { initPad } from './pad.js';
import { initSheet } from './sheet.js';

export { texInto };

const $ = (s) => document.querySelector(s);
const errors = [];
const mods = {};
const loadCat = (cat) => (mods[cat] ||= import(`./tools/${cat}.js`));

let tab = 'all';
let view = 'pad';         // 'pad' | 'index' | 'tool'
let back = 'pad';         // the view the back button of a tool returns to
let cur = null;           // { id, meta, def, els }
let lastHash = null;
let pad = null;
let padShared = false;    // true after an edit: the hash then carries the lines

// ── hash ────────────────────────────────────────────────────────────────────
function parseHash(h = location.hash) {
  h = String(h || '').replace(/^#\/?/, '');
  if (!h) return { view: 'pad' };
  if (h.startsWith('pad=')) { let t = h.slice(4); try { t = decodeURIComponent(t); } catch (e) { /* raw text */ } return { view: 'pad', text: t }; }
  if (h.startsWith('cat=')) return { view: 'index', cat: decodeURIComponent(h.slice(4)) };
  const q = h.indexOf('?');
  const id = decodeURIComponent(q < 0 ? h : h.slice(0, q));
  const params = {};
  if (q >= 0) for (const [k, v] of new URLSearchParams(h.slice(q + 1))) params[k] = v;
  return { view: 'tool', id, params };
}

function toolHash() {
  if (view === 'pad') return padShared && pad && pad.text ? `#pad=${encodeURIComponent(pad.text)}` : '';
  if (view === 'index' || !cur) return `#cat=${tab}`;
  const p = new URLSearchParams();
  for (const inp of cur.def.inputs) {
    const v = valueOf(cur.els[inp.k], inp);
    if (String(v) !== String(inp.def ?? '')) p.set(inp.k, v);
  }
  const s = p.toString();
  return `#${cur.id}${s ? '?' + s : ''}`;
}

function writeHash(push) {
  const h = toolHash();
  if (h === lastHash) return;
  lastHash = h;
  const url = location.href.split('#')[0] + (h || '#');
  try {
    if (push) location.hash = h || '#';
    else location.replace(url);
  } catch (e) { /* sandboxed frame */ }
}

// ── grid ────────────────────────────────────────────────────────────────────
function renderGrid() {
  const tabs = $('#tabs');
  tabs.innerHTML = [['all', 'All', TOOLS.length], ...CATS.map(c => [c.id, c.name, TOOLS.filter(t => t.cat === c.id).length])]
    .map(([id, name, n]) => `<button role="tab" type="button" data-cat="${id}" aria-selected="${id === tab}">${esc(name)}<span class="n">${n}</span></button>`).join('');
  const cats = tab === 'all' ? CATS : CATS.filter(c => c.id === tab);
  $('#grid').innerHTML = cats.map(c => {
    const list = TOOLS.filter(t => t.cat === c.id);
    return `<h3 class="cat-h">${esc(c.name)}</h3><div class="cards">${list.map(t =>
      `<button class="card" type="button" data-tool="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.blurb)}</span></button>`).join('')}</div>`;
  }).join('');
}

// Show one of the three views.
function show(v) {
  view = v;
  if (v !== 'tool') cur = null;
  $('#desk').hidden = v !== 'pad';
  $('#intro').hidden = v !== 'pad';
  $('#index').hidden = v !== 'index';
  $('#tool').hidden = v !== 'tool';
  if (v === 'index') renderGrid();
  if (v !== 'tool') document.title = 'Science Toolkit — Stella Nova · davesgames.io';
}

// ── tool ────────────────────────────────────────────────────────────────────

async function openTool(id, params = {}, push = true) {
  const meta = BY_ID[id];
  if (!meta) { show('pad'); return false; }
  let mod;
  try { mod = await loadCat(meta.cat); }
  catch (e) { errors.push(`load ${meta.cat}: ${e.message}`); show('pad'); return false; }
  const def = mod.TOOLS[id];
  if (!def) { errors.push(`no definition for ${id}`); show('pad'); return false; }
  if (view !== 'tool') back = view;
  show('tool');
  cur = { id, meta, def, els: {} };
  $('#back').textContent = back === 'index' ? '← All tools' : '← Scratchpad';
  $('#toolName').textContent = meta.name;
  $('#toolBlurb').textContent = meta.blurb;
  const form = $('#form');
  form.replaceChildren();
  for (const inp of def.inputs) {
    const [w, el] = field(inp, params[inp.k] ?? inp.def ?? '');
    cur.els[inp.k] = el;
    form.append(w);
  }
  $('#examples').innerHTML = (def.examples || []).map((ex, i) => `<button type="button" data-ex="${i}">${esc(ex.label)}</button>`).join('');
  $('#eqs').innerHTML = (def.tex || []).map(() => '<div class="sci-eq"></div>').join('');
  [...$('#eqs').children].forEach((el, i) => texInto(el, def.tex[i], true));
  $('#how').textContent = def.how || '';
  $('#refs').innerHTML = (def.refs || []).map(r => `<li>${esc(r)}</li>`).join('');
  document.title = `${meta.name} — Science Toolkit — Stella Nova`;
  runTool();
  writeHash(push);
  if (typeof window.scrollTo === 'function') try { window.scrollTo(0, 0); } catch (e) { /* jsdom */ }
  return true;
}

let timer = 0;
function schedule() { clearTimeout(timer); timer = setTimeout(() => { runTool(); writeHash(false); }, 140); }

function runTool() {
  if (!cur) return null;
  const vals = {};
  for (const inp of cur.def.inputs) vals[inp.k] = valueOf(cur.els[inp.k], inp);
  const out = $('#out'), err = $('#err');
  let res;
  try { res = cur.def.run(vals) || {}; }
  catch (e) {
    err.textContent = e.message || String(e);
    err.hidden = false;
    out.classList.add('stale');
    return { error: e.message };
  }
  err.hidden = true; out.classList.remove('stale');
  const parts = [];
  const rows = res.rows || [];
  if (rows.length) {
    parts.push(`<table class="res"><tbody>${rows.map(([k, v, note]) =>
      `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}${note ? `<small>${esc(note)}</small>` : ''}</td><td class="c"><button class="mini" type="button" data-copy="${esc(v)}" aria-label="Copy ${esc(k)}">copy</button></td></tr>`).join('')}</tbody></table>`);
  }
  const copy = res.copy ?? (rows[0] ? rows[0][1] : '');
  parts.push(`<div class="actions">${copy ? `<button class="ghost" type="button" data-copy="${esc(copy)}">Copy result</button>` : ''}${res.actions || ''}</div>`);
  if (res.texOut != null) parts.push(`<div class="fig tex" data-fig="tex"><div class="sci-eq" id="texOut"></div></div><div class="actions"><button class="ghost" type="button" data-texsvg>Copy SVG</button><button class="ghost" type="button" data-export="svg">Download SVG</button></div>`);
  const svgs = res.svg ? [].concat(res.svg) : [];
  svgs.forEach((s, i) => parts.push(`<div class="fig" data-fig="${i}">${s}</div><div class="actions"><button class="mini" type="button" data-export="svg" data-i="${i}">SVG</button><button class="mini" type="button" data-export="png" data-i="${i}">PNG</button><button class="mini" type="button" data-copysvg="${i}">copy SVG</button></div>`));
  if (res.html) parts.push(`<div class="scroll">${res.html}</div>`);
  out.innerHTML = parts.join('');
  if (res.texOut != null) texInto($('#texOut'), res.texOut, res.display !== false);
  out.querySelectorAll('[data-tex]').forEach(el => texInto(el, el.dataset.tex, !('inline' in el.dataset)));
  cur.res = res;
  return res;
}

// ── export ──────────────────────────────────────────────────────────────────

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function exportFig(kind, svgText) {
  const name = `${cur ? cur.id : 'figure'}.${kind}`;
  if (kind === 'svg') { download(name, new Blob([svgText], { type: 'image/svg+xml' })); return; }
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  img.onload = () => {
    const c = document.createElement('canvas');
    const w = img.naturalWidth || 640, h = img.naturalHeight || 360;
    c.width = w * 2; c.height = h * 2;
    const g = c.getContext('2d');
    g.scale(2, 2); g.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    c.toBlob((b) => b && download(name, b), 'image/png');
  };
  img.src = url;
}

function figSvg(i) {
  const f = $(`#out [data-fig="${i}"] svg`);
  if (!f) return '';
  const s = f.outerHTML;
  return s.includes('xmlns=') ? s : s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
}

// ── PALETTE ─────────────────────────────────────────────────────────────────
let pSel = 0, pList = [];
function openPalette() {
  $('#palette').hidden = false;
  const q = $('#pq');
  q.value = '';
  renderPalette();
  q.focus();
}
function closePalette() { $('#palette').hidden = true; }
function renderPalette() {
  pList = search($('#pq').value);
  pSel = Math.min(pSel, Math.max(0, pList.length - 1));
  const catName = Object.fromEntries(CATS.map(c => [c.id, c.name]));
  $('#plist').innerHTML = pList.length ? pList.map((t, i) =>
    `<li role="option" data-tool="${t.id}" aria-selected="${i === pSel}"><b>${esc(t.name)}</b><span>${esc(t.blurb)}</span><em>${esc(catName[t.cat])}</em></li>`).join('')
    : '<li class="none">No tool matches.</li>';
  const sel = $('#plist [aria-selected="true"]');
  if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
}

// ── events ──────────────────────────────────────────────────────────────────
function bind() {
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    tab = b.dataset.cat;
    renderGrid();
    writeHash(false);
  });
  $('#grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (b) openTool(b.dataset.tool, {}, true);
  });
  $('#back').addEventListener('click', () => { show(back); writeHash(true); });
  $('#openIndex').addEventListener('click', () => { show('index'); writeHash(true); });
  $('#sheetBtn').hidden = false;
  $('#indexBack').addEventListener('click', () => { show('pad'); writeHash(true); });
  $('#padLink').addEventListener('click', (e) => { padShared = true; writeHash(false); copyText(location.href, e.currentTarget); });
  $('#padClear').addEventListener('click', () => { pad.clear(); pad.focusLast(); });
  $('#copyLink').addEventListener('click', (e) => copyText(location.href, e.currentTarget));
  $('#form').addEventListener('input', schedule);
  $('#form').addEventListener('change', schedule);
  $('#examples').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ex]');
    if (!b || !cur) return;
    const ex = cur.def.examples[+b.dataset.ex];
    for (const inp of cur.def.inputs) {
      const el = cur.els[inp.k];
      const v = ex.v[inp.k] ?? inp.def ?? '';
      if (inp.type === 'check') el.checked = v === '1' || v === true; else el.value = v;
    }
    runTool(); writeHash(false);
  });
  $('#out').addEventListener('click', (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { copyText(c.dataset.copy, c); return; }
    const x = e.target.closest('[data-export]');
    if (x) {
      const svg = x.dataset.i != null ? figSvg(x.dataset.i) : texSvg();
      if (svg) exportFig(x.dataset.export, svg);
      return;
    }
    const cs = e.target.closest('[data-copysvg]');
    if (cs) { copyText(figSvg(cs.dataset.copysvg), cs); return; }
    const ts = e.target.closest('[data-texsvg]');
    if (ts) copyText(texSvg(), ts);
  });
  $('#openPalette').addEventListener('click', openPalette);
  $('#palette').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { closePalette(); return; }
    const li = e.target.closest('[data-tool]');
    if (li) { closePalette(); openTool(li.dataset.tool, {}, true); }
  });
  $('#pq').addEventListener('input', () => { pSel = 0; renderPalette(); });
  $('#pq').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { pSel = Math.min(pList.length - 1, pSel + 1); renderPalette(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { pSel = Math.max(0, pSel - 1); renderPalette(); e.preventDefault(); }
    else if (e.key === 'Enter') { const t = pList[pSel]; if (t) { closePalette(); openTool(t.id, {}, true); } e.preventDefault(); }
    else if (e.key === 'Escape') { closePalette(); e.preventDefault(); e.stopPropagation(); }
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openPalette(); return; }
    if (e.key === '/' && !typing) { e.preventDefault(); openPalette(); return; }
    if (e.key === 'Escape') {
      if (!$('#palette').hidden) { closePalette(); return; }
      if (typing) { t.blur(); return; }
      if (view === 'tool') { show(back); writeHash(true); }
      else if (view === 'index') { show('pad'); writeHash(true); }
    }
  });
  window.addEventListener('hashchange', route);
}

function texSvg() {
  const s = $('#texOut svg');
  if (!s) return '';
  const c = s.cloneNode(true);
  c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  c.style.color = '#eef2f4';
  return c.outerHTML.replace(/currentColor/g, '#eef2f4');
}

async function route() {
  const h = location.hash.replace(/^#$/, '');
  if (h === lastHash) return;
  lastHash = h;
  const r = parseHash(h);
  if (r.view === 'tool') { await openTool(r.id, r.params, false); return; }
  if (r.view === 'index') {
    tab = r.cat && (r.cat === 'all' || CATS.some(c => c.id === r.cat)) ? r.cat : 'all';
    show('index');
    return;
  }
  if (r.text != null && pad && r.text !== pad.text) { padShared = true; pad.setLines(r.text.split('\n')); }
  show('pad');
}

function renderRelated() {
  $('#related').innerHTML = 'Related pages: ' + RELATED.map(([k, label, what]) =>
    `<a href="/stella-nova/#${k}" target="_top">${esc(label)}</a> <span class="dim">(${esc(what)})</span>`).join(' · ');
}

const ready = (async () => {
  try {
    renderRelated();
    renderGrid();
    pad = initPad({
      root: $('#pad'),
      onOpenTool: (id, vals) => openTool(id, vals || {}, true),
      onChange: () => { padShared = true; if (view === 'pad') writeHash(false); },
    });
    initSheet({ root: $('#sheet'), onInsert: (t) => pad.insert(t), button: $('#sheetBtn') });
    const first = parseHash();
    if (first.view === 'pad' && first.text != null) padShared = true;
    pad.boot(first.view === 'pad' && first.text != null ? first.text : null);
    bind();
    lastHash = null;
    await route();
  } catch (e) { errors.push(e.message || String(e)); throw e; }
})();

window.__sciTools = { open: openTool, run: runTool, show, get current() { return cur; }, get view() { return view; }, get pad() { return pad; }, errors, ready, search, parseHash };
