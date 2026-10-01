// ============================================================================
//  COMPOSITION BENCH  ·  main.js — the node-graph runtime (entry module)
// ────────────────────────────────────────────────────────────────────────────
//  A node graph where each pass owns editable WGSL and wires carry 512² textures.
//  This runtime stays one module: the graph model, the WGSL assembly, the canvas
//  pan/zoom UI, the code editor, the toolbar and the GPU passes share one mutable
//  state (nodes, links, view, device) and call each other both ways.
//
//  SECTIONS  (grep the banner to jump)
//      library catalog ............ LIBS / ensureLib / ensureLibs (from lib/bench-wgsl.js)
//      WGSL syntax highlighting ... highlight
//      node model ................. addNode / link / topo / templateCode
//      WGSL assembly .............. packSrc (moduleFor comes from lib/bench-wgsl.js)
//      canvas ..................... pan/zoom/pinch, buildNodeEl, drawWires
//      editor pane ................ openEditor / showEditor / apply / revert
//      toolbar .................... picker, search, add, examples, graph i/o
//      phone ...................... dock, sheet, zoom buttons
//      examples ................... EXAMPLES (preset graphs)
//      GPU ........................ gpuOf / compileNode / bindOf / fillU / stepSim / frame
//      self test .................. __bench.selfTest(key): compile every node
//
//  DATA
//      libs/index.json ............ catalog: groups, libraries, cells (no WGSL)
//      libs/<key>.json ............ one library's WGSL, fetched on first use
//      tools/build-libs.mjs ....... writes libs/ from the shader-table pages
//      generic.json ............... the generic node kinds (transform, blend, ...)
//      shaders/{head,genu,vs,blit}.wgsl  the WGSL headers assembled into each pass
//
//  SHARED CODE
//      ../../lib/bench-wgsl.js .... the DOM-free part: catalog fetch, the lazy
//                                   library cache, WGSL assembly (templateCode,
//                                   entryOf, moduleFor), the uniform packing
//                                   (fillUniform) and the bind group layouts.
//                                   Material Studio uses the same module.
// ============================================================================
import { loadBenchCatalog, BENCH_TEX, BENCH_UBYTES, BENCH_STATES, BENCH_BGL_ENTRIES, BENCH_CBGL_ENTRIES, BENCH_PBGL_ENTRIES, hexToRgb } from '../../lib/bench-wgsl.js';
const $ = id => document.getElementById(id);
const CAT = await loadBenchCatalog(new URL('./', import.meta.url));
const { INDEX, GENERIC, BLIT, ensureLib, ensureLibs, cellOf, templateCode, entryOf, moduleFor } = CAT;
const TEX = BENCH_TEX, UBYTES = BENCH_UBYTES;
const G = { ink: hexToRgb('#0e1118'), tone: hexToRgb('#5a8cc0'), cream: hexToRgb('#e8ecf4'), paused: false, tempo: 1 };

// ------------------------------------------------------------ library catalog
// LIBS holds the catalog metadata at boot. ensureLib (lib/bench-wgsl.js) merges
// in the WGSL (uniform, core, entries, adapter, fams, fill) the first time a
// library is used.
const LIBS = CAT.LIBS;

// ------------------------------------------------------------ WGSL syntax highlighting
const KW = new Set('fn let var const struct return if else for while loop break continue continuing switch case default discard true false override alias enable requires const_assert'.split(' '));
const BI = new Set('select mix min max clamp step smoothstep length normalize dot cross abs sign floor ceil fract round trunc sqrt exp exp2 log log2 pow sin cos tan asin acos atan atan2 sinh cosh tanh saturate fma any all fwidth dpdx dpdy inverseSqrt transpose determinant distance reflect refract array textureSample textureLoad textureStore textureDimensions workgroupBarrier'.split(' '));
const TY = /^(f32|i32|u32|f16|bool|vec[234][fiu]?|mat[234]x[234]f?|texture_2d|texture_storage_2d|sampler)$/;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const RE = /(\/\/[^\n]*)|(@[A-Za-z_]+)|(0[xX][0-9a-fA-F]+u?|\d+\.\d*(?:[eE][+-]?\d+)?[fh]?|\.\d+(?:[eE][+-]?\d+)?[fh]?|\d+(?:[eE][+-]?\d+)?[fhiu]?)|([A-Za-z_]\w*)|(\.[xyzwrgba]{1,4}\b)|([-+*\/%<>=!&|^~?:]+)|([\s\S])/g;
function highlight(src) {
  let out = '';
  src.replace(RE, (m, cm, at, num, id, sw, op, ch, off) => {
    if (cm) out += `<span class="tk-cm">${esc(cm)}</span>`;
    else if (at) out += `<span class="tk-at">${esc(at)}</span>`;
    else if (num) out += `<span class="tk-num">${num}</span>`;
    else if (id) { if (KW.has(id)) out += `<span class="tk-kw">${id}</span>`; else if (TY.test(id)) out += `<span class="tk-ty">${id}</span>`; else if (BI.has(id)) out += `<span class="tk-bi">${id}</span>`; else if (src[off + id.length] === '(') out += `<span class="tk-fn">${id}</span>`; else out += id; }
    else if (sw) out += `<span class="tk-sw">${sw}</span>`;
    else if (op) out += `<span class="tk-op">${esc(op)}</span>`;
    else out += esc(ch);
    return m;
  });
  return out;
}
const STATES = BENCH_STATES;

// ------------------------------------------------------------ node model
const def = n => LIBS[n.kind] || GENERIC[n.kind];
const title = n => n.fn ? n.fn.replace(/_/g, ' ') : (n.op || def(n).label.toLowerCase());
let nodes = [], links = [], nextId = 1, selected = null;
const byId = id => nodes.find(n => n.id === id);
// A library node needs its library loaded (ensureLib) before addNode runs.
function addNode(kind, x, y, extra) {
  const n = Object.assign({ id: nextId++, kind, x, y, k: null, xk: null, err: '' }, extra || {});
  if (LIBS[kind]) { const L = LIBS[kind]; if (!n.fn || !L.cells.some(c => c.name === n.fn)) n.fn = L.cells[0].name; const c = cellOf(n); n.k = (c.defaults || [0.5, 0.5, 0.5, 0.5]).slice(); n.xk = L.extras.map(e => e.d); if (L.orb) n.state = 0; }
  else { const Gk = GENERIC[kind]; n.k = Gk.defaults.slice(); n.xk = []; if (Gk.ops && !n.op) n.op = Object.keys(Gk.ops)[0]; }
  n.code = templateCode(n); n.custom = false; nodes.push(n); return n;
}
function link(from, to, input) {
  if (!from || !to || from === to) return false;
  const tt = def(to).inputs.find(i => i[0] === input); if (!tt || tt[1] !== def(from).out) return false;
  if (reaches(to, from)) return false;
  links = links.filter(l => !(l.to === to.id && l.input === input)); links.push({ from: from.id, to: to.id, input }); return true;
}
function reaches(a, b) { if (a === b) return true; return links.filter(l => l.from === a.id).some(l => reaches(byId(l.to), b)); }
function freeGpu(n) { const g = n.gpu; if (!g) return; g.tex.destroy(); g.ubuf.destroy(); g.bbuf.destroy(); if (g.blitU) g.blitU.destroy(); if (g.sim) { for (const t of g.sim.tex) t.destroy(); for (const b of g.sim.ubufs) b.destroy(); g.sim.pbuf.destroy(); } if (g.ctx) try { g.ctx.unconfigure(); } catch (e) {} n.gpu = null; }
function removeNode(n) { if (n.kind === 'output') return; nodes = nodes.filter(x => x !== n); links = links.filter(l => l.from !== n.id && l.to !== n.id); freeGpu(n); }
function topo() { const order = [], seen = new Set(); const visit = n => { if (seen.has(n.id)) return; seen.add(n.id); for (const l of links) if (l.to === n.id) visit(byId(l.from)); order.push(n); }; for (const n of nodes) visit(n); return order; }
const inputOf = (n, name) => { const l = links.find(x => x.to === n.id && x.input === name); return l ? byId(l.from) : null; };

// ------------------------------------------------------------ WGSL assembly
// moduleFor (lib/bench-wgsl.js) assembles one pass. packSrc prints the whole
// graph as one readable listing, each library core once.
function packSrc() {
  const order = topo(); const lines = [`// composition bench pack · ${nodes.length} passes, ${links.length} wires`, '// each pass renders a 512² rgba16float texture; in0/in1 are the wired upstream textures, b.has0/has1 say which are wired', '// bindings: 0 uniform (the library struct), 1 in0, 2 sampler, 3 in1, 4 BenchB', ''];
  lines.push('// ── pass order and wiring');
  for (const n of order) { const ins = def(n).inputs.map(([nm]) => { const s = inputOf(n, nm); return `${nm} ← ${s ? 'pass ' + s.id : '—'}`; }).join(', '); lines.push(`//   pass ${n.id}: ${n.kind}${n.fn ? ' · ' + n.fn : ''}${n.op ? ' · ' + n.op : ''}  [${ins}]  knobs ${JSON.stringify(n.k.map(v => +v.toFixed(3)))}${n.xk.length ? ' extras ' + JSON.stringify(n.xk.map(v => +v.toFixed(3))) : ''}`); }
  lines.push('', CAT.HEAD.trim(), '');
  const cores = new Set();
  for (const n of order) {
    const key = CAT.coreKeyOf(n);
    if (!cores.has(key)) { cores.add(key); lines.push(`// ══ ${key} library core ══`, CAT.coreSrcOf(n), ''); }
  }
  for (const n of order) lines.push(`// ══ pass ${n.id} · ${n.kind}${n.fn ? ' · ' + n.fn : ''}${n.op ? ' · ' + n.op : ''} · entry ${entryOf(n)} ══`, n.code, '');
  return lines.join('\n');
}

// ------------------------------------------------------------ canvas: pan / zoom / pinch / nodes / wires
const world = $('world'), xf = $('xf'), wires = $('wires'), nodesEl = $('nodes');
let view = { x: 80, y: 60, z: 1 };
const applyView = () => { xf.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`; };
applyView();
const toWorld = (cx, cy) => { const r = world.getBoundingClientRect(); return [(cx - r.left - view.x) / view.z, (cy - r.top - view.y) / view.z]; };
const zoomAt = (cx, cy, z) => { const [wx, wy] = toWorld(cx, cy); z = Math.min(2.5, Math.max(0.15, z)); view.x += wx * (view.z - z); view.y += wy * (view.z - z); view.z = z; applyView(); };
// one pointer pans, two pointers pinch
const ptrs = new Map(); let pan = null, pinch = null;
const isBg = t => t === world || t === xf || t === wires || t === nodesEl;
world.addEventListener('pointerdown', e => {
  if (!isBg(e.target)) return;
  ptrs.set(e.pointerId, [e.clientX, e.clientY]); world.setPointerCapture(e.pointerId);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pan = null; const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2; pinch = { d: Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), 1), z: view.z, w: toWorld(cx, cy) }; }
  else { pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; world.classList.add('panning'); select(null); }
});
world.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinch && ptrs.size >= 2) {
    // keep the world point that was under the two fingers under their midpoint
    const [a, b] = [...ptrs.values()]; const r = world.getBoundingClientRect(); const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
    const z = Math.min(2.5, Math.max(0.15, pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d));
    view = { z, x: cx - r.left - pinch.w[0] * z, y: cy - r.top - pinch.w[1] * z }; applyView();
  }
  else if (pan) { view.x = pan.vx + e.clientX - pan.x; view.y = pan.vy + e.clientY - pan.y; applyView(); }
});
const endPtr = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) { pan = null; world.classList.remove('panning'); } };
world.addEventListener('pointerup', endPtr); world.addEventListener('pointercancel', endPtr);
world.addEventListener('wheel', e => { if (e.target.closest && e.target.closest('.nd-w')) return; e.preventDefault(); zoomAt(e.clientX, e.clientY, view.z * Math.exp(-e.deltaY * 0.0012)); }, { passive: false });
const PHONE = () => matchMedia('(max-width: 768px)').matches;
function fit() {
  if (!nodes.length) return; const r = world.getBoundingClientRect();
  const left = PHONE() ? 10 : ($('tools').getBoundingClientRect().right - r.left + 16), bottom = PHONE() ? 10 : 30;
  const x0 = Math.min(...nodes.map(n => n.x)), y0 = Math.min(...nodes.map(n => n.y)), x1 = Math.max(...nodes.map(n => n.x + 224)), y1 = Math.max(...nodes.map(n => n.y + (n.el ? n.el.offsetHeight : 320)));
  const W = r.width - left - 10, H = r.height - bottom - 10;
  const z = Math.min(1.2, Math.max(0.15, Math.min(W / (x1 - x0 + 40), H / (y1 - y0 + 40))));
  view = { z, x: left + (W - (x1 - x0) * z) / 2 - x0 * z, y: 10 + (H - (y1 - y0) * z) / 2 - y0 * z }; applyView(); drawWires();
}
function select(n) { selected = n; for (const m of nodes) if (m.el) m.el.classList.toggle('sel', m === n); if (n && $('codepane').classList.contains('open')) showEditor(n); }
window.addEventListener('keydown', e => { const tag = document.activeElement.tagName; if ((e.key === 'Delete' || e.key === 'Backspace') && selected && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') { removeNode(selected); selected = null; rebuildAll(); } });

const bez = (x0, y0, x1, y1) => { const dx = Math.max(40, Math.abs(x1 - x0) * 0.5); return `M${x0},${y0} C${x0 + dx},${y0} ${x1 - dx},${y1} ${x1},${y1}`; };
function sockPos(dot) { const r = dot.getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); }
const opt = (v, cur, label) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
const attr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function buildNodeEl(n) {
  const D = def(n); const L = LIBS[n.kind]; const el = document.createElement('div'); el.className = 'nd kind-' + n.kind + (L ? ' grp-' + L.group.replace(/[^A-Za-z]/g, '').toLowerCase() : ''); el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; n.el = el;
  const ins = D.inputs.map(([nm, ty, o]) => `<div class="sock in"><i class="dot ${ty}" data-sock="in" data-in="${nm}"></i>${nm}${o ? ' <span class="opt">·</span>' : ''}</div>`).join('');
  const outs = D.out ? `<div class="sock out"><i class="dot ${D.out}" data-sock="out"></i>${D.out === 'coord' ? 'p' : 'img'}</div>` : '';
  let w = '';
  if (L) w += `<select class="sel" data-w="fn">${L.cells.map(c => opt(c.name, n.fn, c.name.replace(/_/g, ' ') + ' · ' + c.family)).join('')}</select>`;
  if (D.ops) w += `<select class="sel" data-w="op">${Object.keys(D.ops).map(o => opt(o, n.op, o)).join('')}</select>`;
  if (L && L.orb) w += `<select class="sel" data-w="state">${STATES.map((s, i) => opt(String(i), String(n.state), s)).join('')}</select>`;
  const knob = (lbl, val, role, idx) => `<div class="knob"><label>${esc(lbl)}</label><output>${val.toFixed(2)}</output><input type="range" min="0" max="1" step="0.01" value="${val}" data-role="${role}" data-i="${idx}"></div>`;
  const knobNames = L ? cellOf(n).knobs : D.knobs;
  knobNames.forEach((kn, j) => { if (kn) w += knob('k' + j + ' · ' + kn, n.k[j], 'k', j); });
  if (L) L.extras.forEach((e, j) => { w += knob(e.name, n.xk[j], 'x', j); });
  if (L && L.sim) w += `<button class="chip" type="button" data-act="reset">↺ reset</button>`;
  const c = cellOf(n);
  el.innerHTML = `<div class="nd-h"><span class="t" title="${c ? attr(c.line) : ''}">${esc(title(n))}</span><span class="k">${esc(D.label.toLowerCase())}</span><span class="ed" title="edit this node's shader">&lt;/&gt;</span>${n.kind !== 'output' ? '<span class="x" title="remove">✕</span>' : ''}</div>
    <div class="nd-io"><div>${ins}</div><div>${outs}</div></div><canvas width="224" height="140"></canvas><div class="st"></div><div class="nd-w">${w}</div>`;
  const h = el.querySelector('.nd-h'); let drag = null;
  h.addEventListener('pointerdown', e => { if (e.target.classList.contains('x') || e.target.classList.contains('ed')) return; drag = { x: e.clientX, y: e.clientY, nx: n.x, ny: n.y }; h.setPointerCapture(e.pointerId); select(n); e.stopPropagation(); });
  h.addEventListener('pointermove', e => { if (!drag) return; n.x = drag.nx + (e.clientX - drag.x) / view.z; n.y = drag.ny + (e.clientY - drag.y) / view.z; el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; drawWires(); });
  h.addEventListener('pointerup', () => { drag = null; }); h.addEventListener('pointercancel', () => { drag = null; });
  el.addEventListener('pointerdown', e => { select(n); e.stopPropagation(); });
  const x = el.querySelector('.x'); if (x) x.addEventListener('click', () => { removeNode(n); rebuildAll(); });
  el.querySelector('.ed').addEventListener('click', () => { select(n); openEditor(n); });
  el.querySelectorAll('select').forEach(s => s.addEventListener('change', () => {
    if (s.dataset.w === 'fn') { n.fn = s.value; const cc = cellOf(n); n.k = (cc.defaults || [0.5, 0.5, 0.5, 0.5]).slice(); n.code = templateCode(n); n.custom = false; }
    else if (s.dataset.w === 'op') { n.op = s.value; n.code = templateCode(n); n.custom = false; }
    else if (s.dataset.w === 'state') { n.state = +s.value; n.stateAt = T; return; }
    if (n.gpu && n.gpu.sim) n.gpu.sim.reset = true;
    renderNodes(); compileNode(n); packDirty = true; if (selected === n && $('codepane').classList.contains('open')) showEditor(n);
  }));
  el.querySelectorAll('input[type=range]').forEach(r => r.addEventListener('input', () => { const v = +r.value; r.previousElementSibling.textContent = v.toFixed(2); if (r.dataset.role === 'k') n.k[+r.dataset.i] = v; else n.xk[+r.dataset.i] = v; packDirty = true; }));
  const rb = el.querySelector('[data-act=reset]'); if (rb) rb.addEventListener('click', () => { if (n.gpu && n.gpu.sim) n.gpu.sim.reset = true; });
  el.querySelectorAll('.dot').forEach(d => d.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault();
    let from = n;
    if (d.dataset.sock === 'in') { const l = links.find(x => x.to === n.id && x.input === d.dataset.in); if (!l) return; from = byId(l.from); links = links.filter(x => x !== l); drawWires(); }
    const live = document.createElementNS('http://www.w3.org/2000/svg', 'path'); live.setAttribute('class', 'live'); wires.appendChild(live);
    const move = ev => { const [wx, wy] = toWorld(ev.clientX, ev.clientY); const a = sockPos(from.el.querySelector('.dot[data-sock=out]')); live.setAttribute('d', bez(a[0], a[1], wx, wy)); };
    const up = ev => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); live.remove();
      const t = document.elementFromPoint(ev.clientX, ev.clientY); const dot = t && t.closest ? t.closest('.dot[data-sock=in]') : null;
      if (dot) { const to = nodes.find(m => m.el && m.el.contains(dot)); link(from, to, dot.dataset.in); }
      wireChanged(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up); move(e);
  }));
  return el;
}
function drawWires() {
  for (const p of [...wires.querySelectorAll('path:not(.live)')]) p.remove();
  for (const l of links) {
    const a = byId(l.from), b = byId(l.to); if (!a || !b || !a.el || !b.el) continue;
    const p0 = sockPos(a.el.querySelector('.dot[data-sock=out]')), p1 = sockPos(b.el.querySelector(`.dot[data-sock=in][data-in=${l.input}]`));
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', bez(p0[0], p0[1], p1[0], p1[1])); path.setAttribute('class', def(a).out);
    path.addEventListener('pointerdown', e => { e.stopPropagation(); links = links.filter(x => x !== l); wireChanged(); });
    wires.appendChild(path);
  }
  for (const n of nodes) if (n.el) for (const d of n.el.querySelectorAll('.dot')) { const on = d.dataset.sock === 'out' ? links.some(l => l.from === n.id) : links.some(l => l.to === n.id && l.input === d.dataset.in); d.classList.toggle('on', on); }
}
function renderNodes() {
  nodesEl.innerHTML = '';
  for (const n of nodes) { nodesEl.appendChild(buildNodeEl(n)); if (n.gpu) { n.gpu.canvas = null; n.gpu.ctx = null; } n.el.querySelector('.st').textContent = n.err; n.el.classList.toggle('err', !!n.err); }
  for (const n of nodes) n.el.classList.toggle('sel', n === selected);
  drawWires();
}
function wireChanged() { drawWires(); for (const n of nodes) if (n.gpu) n.gpu.bind = null; packDirty = true; }
function rebuildAll() { renderNodes(); for (const n of nodes) if (!n.gpu || !n.gpu.pipeline) compileNode(n); wireChanged(); }

// ------------------------------------------------------------ editor pane
function openEditor(n) { $('codepane').classList.add('open'); $('codepane').classList.remove('pack'); $('code').classList.add('on'); showEditor(n); }
function showEditor(n) { if (!n) return; $('ed-title').textContent = `pass ${n.id} · ${n.kind}${n.fn ? ' · ' + n.fn.replace(/_/g, ' ') : ''}${n.op ? ' · ' + n.op : ''} · entry ${entryOf(n)}`; $('editor').value = n.code; $('editor')._node = n; setEdStatus(n.err || (n.custom ? 'edited · applied' : 'the node\'s own shader: helpers of its library are in scope, plus in0/in1/smp, u (its uniform) and b (wiring flags)'), !!n.err); }
const setEdStatus = (msg, err) => { $('edstatus').textContent = msg; $('edstatus').classList.toggle('err', !!err); };
$('ed-apply').addEventListener('click', () => { const n = $('editor')._node; if (!n) return; n.code = $('editor').value; n.custom = true; compileNode(n).then(() => showEditor(n)); packDirty = true; });
$('editor').addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); $('ed-apply').click(); } if (e.key === 'Tab') { e.preventDefault(); const t = e.target; const s = t.selectionStart; t.value = t.value.slice(0, s) + '    ' + t.value.slice(t.selectionEnd); t.selectionStart = t.selectionEnd = s + 4; } });
$('ed-revert').addEventListener('click', () => { const n = $('editor')._node; if (!n) return; n.code = templateCode(n); n.custom = false; compileNode(n).then(() => showEditor(n)); packDirty = true; });
$('ed-copy').addEventListener('click', e => copy($('editor').value, e.currentTarget, 'Copy'));
$('ed-pack').addEventListener('click', () => { const on = $('codepane').classList.toggle('pack'); $('ed-pack').classList.toggle('on', on); if (on) $('packview').innerHTML = highlight(packSrc()); });
const closeCode = () => { $('codepane').classList.remove('open'); $('code').classList.remove('on'); $('dock-code').classList.remove('on'); };
$('close-code').addEventListener('click', closeCode);
const toggleCode = () => { if ($('codepane').classList.contains('open')) closeCode(); else { setSheet(false); openEditor(selected || nodes.find(n => n.kind === 'output')); $('dock-code').classList.add('on'); } };
$('code').addEventListener('click', toggleCode);
const copy = (text, btn, label) => navigator.clipboard.writeText(text).then(() => { btn.textContent = 'Copied'; setTimeout(() => btn.textContent = label, 1200); }).catch(() => { btn.textContent = 'Select the text to copy'; setTimeout(() => btn.textContent = label, 2000); });
$('copy-pack').addEventListener('click', e => copy(packSrc(), e.currentTarget, 'Copy pack'));
const status = msg => { $('fps').textContent = msg; statusUntil = performance.now() + 2500; };
let statusUntil = 0;

// ------------------------------------------------------------ toolbar: library picker, search, add
const spawnAt = () => { const r = world.getBoundingClientRect(); const cx = PHONE() ? r.left + r.width * 0.3 : r.left + 280 + Math.random() * 140; return toWorld(cx, r.top + 60 + Math.random() * 120); };
const libsel = $('libpick'), fnsel = $('fnpick'), search = $('search'), results = $('results');
libsel.innerHTML = INDEX.groups.filter(g => g.libs.length).map(g => `<optgroup label="${attr(g.name)}">${g.libs.map(k => opt(k, 'noise', `${LIBS[k].label} · ${LIBS[k].cells.length}`)).join('')}</optgroup>`).join('');
const fillFns = () => { const L = LIBS[libsel.value]; const fams = [...new Set(L.cells.map(c => c.family))]; fnsel.innerHTML = fams.map(f => `<optgroup label="${attr(f)}">${L.cells.filter(c => c.family === f).map(c => opt(c.name, null, c.name.replace(/_/g, ' '))).join('')}</optgroup>`).join(''); $('libinfo').textContent = `${L.label}: ${L.cells.length} nodes from ${L.page}${L.inputs.length ? ' · takes ' + L.inputs.map(i => i[0] + ' (' + i[1] + ')').join(', ') : ' · a source'}`; };
libsel.addEventListener('change', fillFns); fillFns();
async function addLibNode(kind, fn) {
  try { await ensureLib(kind); } catch (e) { status('could not load ' + kind + ': ' + e.message); return; }
  const [x, y] = spawnAt(); const n = addNode(kind, x, y, { fn }); select(n); rebuildAll();
  if (PHONE()) { setSheet(false); centerOn(n); }
}
$('add-lib').addEventListener('click', () => addLibNode(libsel.value, fnsel.value));
// search across every node of every library: name, family, library, description
const ALL = []; for (const g of INDEX.groups) for (const k of g.libs) for (const c of LIBS[k].cells) ALL.push({ k, c, g: g.name, hay: (c.name.replace(/_/g, ' ') + ' ' + c.family + ' ' + LIBS[k].label + ' ' + k + ' ' + g.name + ' ' + c.line).toLowerCase() });
let hit = 0;
$('ncount').textContent = ALL.length + ' nodes'; search.placeholder = `search ${ALL.length} nodes`;
function runSearch() {
  const q = search.value.trim().toLowerCase(); results.hidden = !q; $('pickrow').hidden = !!q; if (!q) return;
  const words = q.split(/\s+/); const found = ALL.filter(a => words.every(w => a.hay.includes(w)));
  found.sort((a, b) => (b.c.name.startsWith(words[0]) - a.c.name.startsWith(words[0])) || (b.c.name.includes(words[0]) - a.c.name.includes(words[0])));
  hit = 0;
  results.innerHTML = `<div class="rcount">${found.length} node${found.length === 1 ? '' : 's'}${found.length > 60 ? ' · first 60' : ''}</div>` + found.slice(0, 60).map((a, i) => `<button type="button" class="res${i === 0 ? ' hit' : ''}" data-k="${a.k}" data-fn="${a.c.name}" title="${attr(a.c.line)}"><b>${esc(a.c.name.replace(/_/g, ' '))}</b><span>${esc(LIBS[a.k].label)} · ${esc(a.c.family)}</span></button>`).join('');
}
search.addEventListener('input', runSearch);
search.addEventListener('keydown', e => {
  const rs = [...results.querySelectorAll('.res')]; if (!rs.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); rs[hit].classList.remove('hit'); hit = (hit + (e.key === 'ArrowDown' ? 1 : rs.length - 1)) % rs.length; rs[hit].classList.add('hit'); rs[hit].scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'Enter') { e.preventDefault(); rs[hit].click(); }
  else if (e.key === 'Escape') { search.value = ''; runSearch(); }
});
results.addEventListener('click', e => { const b = e.target.closest('.res'); if (b) addLibNode(b.dataset.k, b.dataset.fn); });
for (const kind of Object.keys(GENERIC)) { if (kind === 'output') continue; $('add-' + kind).addEventListener('click', () => { const [x, y] = spawnAt(); const n = addNode(kind, x, y); select(n); rebuildAll(); if (PHONE()) { setSheet(false); centerOn(n); } }); }
$('fit').addEventListener('click', fit);
$('clear').addEventListener('click', () => preset('minimal'));
$('shuffle').addEventListener('click', () => preset('random'));
$('pause').addEventListener('click', () => { G.paused = !G.paused; $('pause').classList.toggle('on', G.paused); $('pause').textContent = G.paused ? '▶ resume' : '❚❚ pause'; });
$('tempo').addEventListener('input', e => { G.tempo = Math.pow(2, (+e.target.value - 0.5) * 4); $('tempo-now').textContent = G.tempo.toFixed(2) + 'x'; });
for (const id of ['ink', 'tone', 'cream']) $('sw-' + id).addEventListener('input', e => { G[id] = hexToRgb(e.target.value); });
const graphJSON = () => JSON.stringify({ nodes: nodes.map(({ id, kind, x, y, k, xk, fn, op, state, code, custom }) => ({ id, kind, x, y, k, xk, fn, op, state, code: custom ? code : undefined })), links }, null, 1);
$('save').addEventListener('click', e => copy(graphJSON(), e.currentTarget, 'copy graph'));
$('load').addEventListener('click', () => { const txt = prompt('paste a graph JSON'); if (!txt) return; let g; try { g = JSON.parse(txt); } catch (err) { status('could not read that graph'); return; } loadGraph(g).catch(err => status('could not load that graph: ' + err.message)); });
let graphGen = 0;
function clearGraph() { for (const n of nodes) freeGpu(n); nodes = []; links = []; selected = null; }
async function loadGraph(g) {
  const gen = ++graphGen; const known = g.nodes.filter(n => LIBS[n.kind] || GENERIC[n.kind]); const dropped = g.nodes.length - known.length;
  await ensureLibs(known.map(n => n.kind)); if (gen !== graphGen) return;
  clearGraph(); $('exnote').textContent = '';
  for (const n of known) { const m = addNode(n.kind, n.x, n.y, { fn: n.fn, op: n.op }); if (n.k) m.k = n.k; if (n.xk && n.xk.length === m.xk.length) m.xk = n.xk; if (n.state != null) m.state = n.state; if (n.code) { m.code = n.code; m.custom = true; } m.id = n.id; }
  nextId = Math.max(0, ...nodes.map(n => n.id)) + 1; links = g.links.filter(l => byId(l.from) && byId(l.to)); rebuildAll(); setTimeout(fit, 0);
  if (dropped) status(`${dropped} node${dropped > 1 ? 's' : ''} of an unknown kind left out`);
}

// ------------------------------------------------------------ phone: dock, sheet, zoom buttons
// Below 768 px the toolbar is a bottom sheet above a dock (the wave-membrane pattern).
const setSheet = open => { document.body.classList.toggle('sheet-open', open); $('dock-nodes').classList.toggle('on', open); $('dock-nodes').setAttribute('aria-expanded', String(open)); };
$('dock-nodes').addEventListener('click', () => { const open = !document.body.classList.contains('sheet-open'); if (open) closeCode(); setSheet(open); });
$('sheet-grip').addEventListener('click', () => setSheet(false));
$('dock-fit').addEventListener('click', fit);
$('dock-zin').addEventListener('click', () => { const r = world.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, view.z * 1.25); });
$('dock-zout').addEventListener('click', () => { const r = world.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, view.z / 1.25); });
$('dock-code').addEventListener('click', toggleCode);
function centerOn(n) { const r = world.getBoundingClientRect(); view.z = Math.max(view.z, 0.75); view.x = r.width / 2 - (n.x + 112) * view.z; view.y = r.height * 0.4 - (n.y + 120) * view.z; applyView(); drawWires(); }

// ------------------------------------------------------------ examples
// Each example lists nodes as [kind, fn or op, x, y, knobs?, extras?] and wires as [from, to, input].
const EXAMPLES = {
  classic: { label: 'classic', note: 'vortex field warps fbm and worley, blended, colored and post-processed',
    nodes: [['field', 'vortex', 0, 0, null, [0.3]], ['noise', 'fbm', 320, -80, [0.45, 0.6, 0.5, 0.3]], ['noise', 'worley_edge', 320, 320, [0.4, 0.8, 0.4, 0.2]], ['blend', 'multiply', 640, 120, [0.6, 0.5, 0.5, 0.5]], ['color', 'oklch_sweep', 960, 20], ['postfx', 'aberration', 1280, 20], ['output', null, 1600, 20]],
    wires: [[0, 1, 'p'], [0, 2, 'p'], [1, 3, 'a'], [2, 3, 'b'], [3, 4, 'v'], [4, 5, 'img'], [5, 6, 'img']] },
  polar_metal: { label: 'polar metal', note: 'a polar lattice displaces liquid gold, then bloom',
    nodes: [['polar', 'hex_rings', 0, 300], ['metal', 'liquid_gold', 0, -60], ['displace', null, 330, 120, [0.35, 0.5, 0.5, 0.5]], ['blend', 'screen', 660, 120, [0.35, 0.5, 0.5, 0.5]], ['postfx', 'bloom', 990, 120], ['output', null, 1320, 120]],
    wires: [[1, 2, 'img'], [0, 2, 'by'], [2, 3, 'a'], [0, 3, 'b'], [3, 4, 'img'], [4, 5, 'img']] },
  frost_beam: { label: 'frost beam', note: 'a ground telegraph sweeps over frost fern veins, then bloom',
    nodes: [['frost', 'fern_veins', 0, -60], ['beam', 'tg_sweep', 0, 320], ['blend', 'add', 330, 120, [0.9, 0.5, 0.5, 0.5]], ['postfx', 'bloom_softknee', 660, 120, null, [0.6, 0.5]], ['output', null, 990, 120]],
    wires: [[0, 2, 'a'], [1, 2, 'b'], [2, 3, 'img'], [3, 4, 'img']] },
  fire_smoke: { label: 'fire and smoke', note: 'smoke over a bonfire, seen through rising heat haze',
    nodes: [['fire', 'bonfire', 0, -60], ['smoke', 'column', 0, 320], ['blend', 'screen', 330, 120, [0.7, 0.5, 0.5, 0.5]], ['heat_haze', 'rising_haze', 660, 120], ['postfx', 'grain', 990, 120], ['output', null, 1320, 120]],
    wires: [[0, 2, 'a'], [1, 2, 'b'], [2, 3, 'img'], [3, 4, 'img'], [4, 5, 'img']] },
  glass_lattice: { label: 'glass on halftone', note: 'a refraction pill lenses a CMY rosette',
    nodes: [['dotfield', 'cmy_rosette', 0, 60], ['refraction', 'pill', 330, 60], ['color', 'agx', 660, 60], ['output', null, 990, 60]],
    wires: [[0, 1, 'img'], [1, 2, 'v'], [2, 3, 'img']] },
  forge: { label: 'forge', note: 'a wandering heat-metal source over an SDF glass torus, bloomed',
    nodes: [['heat_metal', 'orbit', 0, -60], ['solids', 'ring_torus', 0, 320], ['blend', 'add', 330, 120, [0.6, 0.5, 0.5, 0.5]], ['postfx', 'bloom_softknee', 660, 120], ['output', null, 990, 120]],
    wires: [[0, 2, 'a'], [1, 2, 'b'], [2, 3, 'img'], [3, 4, 'img']] },
};
$('examples').innerHTML = Object.entries(EXAMPLES).map(([k, E]) => `<button class="chip" type="button" data-ex="${k}" title="${attr(E.note)}">${esc(E.label)}</button>`).join('');
$('examples').addEventListener('click', e => { const b = e.target.closest('[data-ex]'); if (b) { preset(b.dataset.ex); if (PHONE()) setSheet(false); } });
const pick = a => a[Math.floor(Math.random() * a.length)];
const rk = () => [0, 1, 2, 3].map(() => Math.random());
async function preset(which) {
  const gen = ++graphGen;
  const E = EXAMPLES[which];
  const SOURCES = Object.keys(LIBS).filter(k => !LIBS[k].inputs.length || LIBS[k].inputs[0][2]).filter(k => k !== 'field');
  const IMAGE_OPS = Object.keys(LIBS).filter(k => LIBS[k].inputs.length && LIBS[k].inputs[0][1] === 'img');
  let plan = null;
  if (which === 'random') plan = { src: pick(SOURCES), ops: Array.from({ length: 1 + Math.floor(Math.random() * 4) }, () => Math.random()), op: pick(IMAGE_OPS), op2: pick(IMAGE_OPS) };
  try { await ensureLibs(E ? E.nodes.map(n => n[0]) : which === 'random' ? ['field', 'noise', plan.src, plan.op, plan.op2] : ['noise']); }
  catch (e) { status('could not load a library: ' + e.message); return; }
  if (gen !== graphGen) return;
  clearGraph(); nextId = 1;
  $('exnote').textContent = which === 'random' ? 'a random chain from one source' : '';
  if (which === 'minimal') { const a = addNode('noise', 0, 40, { fn: 'fbm' }); const o = addNode('output', 340, 40); link(a, o, 'img'); }
  else if (E) {
    const made = E.nodes.map(([kind, f, x, y, k, xk]) => { const n = addNode(kind, x, y, LIBS[kind] ? { fn: f } : (f ? { op: f } : {})); if (k) n.k = k.slice(); if (xk) n.xk = xk.slice(); return n; });
    for (const [a, b, inp] of E.wires) if (!link(made[a], made[b], inp)) console.warn('example', which, 'wire failed', a, b, inp);
    $('exnote').textContent = E.note;
  } else {
    const src = addNode(plan.src, 0, 0); src.fn = pick(LIBS[src.kind].cells).name; src.k = (cellOf(src).defaults || rk()).slice(); src.code = templateCode(src);
    let cur = src, x = 340;
    for (const r of plan.ops) {
      if (r < 0.25) { const f = addNode('field', x, 320, { fn: pick(LIBS.field.cells).name }); const w = addNode('warp', x + 340, 0); link(cur, w, 'img'); link(f, w, 'p'); cur = w; x += 680; }
      else if (r < 0.5) { const s = addNode('noise', x, 320, { fn: pick(LIBS.noise.cells).name }); s.k = rk(); const b = addNode('blend', x + 340, 0, { op: pick(Object.keys(GENERIC.blend.ops)) }); b.k = [0.3 + Math.random() * 0.6, 0, 0, 0]; link(cur, b, 'a'); link(s, b, 'b'); cur = b; x += 680; }
      else { const kind = r < 0.75 ? plan.op : plan.op2; const c = addNode(kind, x, 0, { fn: pick(LIBS[kind].cells).name }); link(cur, c, LIBS[kind].inputs[0][0]); cur = c; x += 340; }
    }
    const o = addNode('output', x, 0); link(cur, o, 'img');
  }
  rebuildAll(); setTimeout(fit, 0);
}

// ------------------------------------------------------------ GPU
let device = null, format, bgl, layout, cbgl, clayout, pbgl, playout, sampler, dummy, dummyView, blitPipe, packDirty = true, T = 0, alive = true;
const simPresent = {};   // per sim library: the fs_present pipeline from its core
if (navigator.gpu) { try { const adapter = await navigator.gpu.requestAdapter(); device = await adapter.requestDevice(); } catch (e) { device = null; } }
if (!device) { $('nogpu').hidden = false; $('fps').textContent = 'no WebGPU'; }
else {
  // The tab shell removes this iframe on a page swap. Release the device so
  // the renderer does not run out of GPU memory during heavy swapping.
  window.addEventListener('pagehide', () => { alive = false; for (const n of nodes) freeGpu(n); try { device.destroy(); } catch (e) {} });
  device.lost.then(info => { alive = false; window.__benchLost = info.reason || 'lost'; });
  format = navigator.gpu.getPreferredCanvasFormat();
  bgl = device.createBindGroupLayout({ entries: BENCH_BGL_ENTRIES() });
  layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
  cbgl = device.createBindGroupLayout({ entries: BENCH_CBGL_ENTRIES() });
  clayout = device.createPipelineLayout({ bindGroupLayouts: [cbgl] });
  pbgl = device.createBindGroupLayout({ entries: BENCH_PBGL_ENTRIES() });
  playout = device.createPipelineLayout({ bindGroupLayouts: [pbgl] });
  sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'mirror-repeat', addressModeV: 'mirror-repeat' });
  dummy = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }); dummyView = dummy.createView();
  const bm = device.createShaderModule({ code: BLIT });
  blitPipe = device.createRenderPipeline({ layout, vertex: { module: bm, entryPoint: 'vs_main' }, fragment: { module: bm, entryPoint: 'fs_blit', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
}
function gpuOf(n) {
  if (n.gpu) return n.gpu;
  const g = { tex: device.createTexture({ size: [TEX, TEX], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }), ubuf: device.createBuffer({ size: UBYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), udata: new Float32Array(UBYTES / 4), bbuf: device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), pipeline: null, bind: null, blitBind: null, canvas: null, ctx: null };
  g.view = g.tex.createView();
  n.gpu = g; return g;
}
function presentFor(kind) {
  if (!simPresent[kind]) { const pm = device.createShaderModule({ code: LIBS[kind].core }); simPresent[kind] = device.createRenderPipelineAsync({ layout: playout, vertex: { module: pm, entryPoint: 'vs_main' }, fragment: { module: pm, entryPoint: 'fs_present', targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' } }); }
  return simPresent[kind];
}
async function compileNode(n) {
  if (!device || !alive) return; const g = gpuOf(n); const L = LIBS[n.kind]; g.gen = (g.gen || 0) + 1; const gen = g.gen;
  const code = moduleFor(n); const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo(); const errs = info.messages.filter(m => m.type === 'error');
  const setErr = msg => { n.err = msg; if (n.el) { n.el.querySelector('.st').textContent = msg; n.el.classList.toggle('err', !!msg); } if ($('editor')._node === n) setEdStatus(msg || (n.custom ? 'edited · applied' : 'compiled'), !!msg); };
  if (errs.length) { const e = errs[0]; const off = code.length - n.code.length; const ln = e.lineNum - code.slice(0, off).split('\n').length + 1; setErr(`line ${ln}: ${e.message.slice(0, 160)}`); return; }
  try {
    if (L && L.sim) {
      const cp = await device.createComputePipelineAsync({ layout: clayout, compute: { module, entryPoint: entryOf(n) } });
      g.present = await presentFor(n.kind);
      if (g.gen !== gen || !n.gpu) return;
      if (!g.sim) { const N = 128; const s = { N, cur: 0, frame: 0, seed: Math.random() * 100, reset: true, acc: 0, ring: 0, ubufs: [], cbind: [], udata: new Float32Array(24) };
        s.tex = [0, 1].map(() => device.createTexture({ size: [N, N], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING }));
        s.pbuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); s.pdata = new Float32Array(24);
        s.pbind = [0, 1].map(i => device.createBindGroup({ layout: pbgl, entries: [{ binding: 0, resource: { buffer: s.pbuf } }, { binding: 1, resource: s.tex[i].createView() }] }));
        for (let r = 0; r < 8; r++) { const b = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); s.ubufs.push(b); s.cbind.push([0, 1].map(i => device.createBindGroup({ layout: cbgl, entries: [{ binding: 0, resource: { buffer: b } }, { binding: 1, resource: s.tex[i].createView() }, { binding: 2, resource: s.tex[1 - i].createView() }] }))); }
        g.sim = s; }
      g.sim.reset = true; g.pipeline = cp;
    } else {
      const p = await device.createRenderPipelineAsync({ layout, vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: entryOf(n), targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' } });
      if (g.gen !== gen || !n.gpu) return; g.pipeline = p;
    }
    setErr('');
  } catch (e) { setErr(String(e.message || e).slice(0, 160)); }
}
function bindOf(n) {
  const g = n.gpu; if (g.bind) return g.bind; const D = def(n);
  const src = i => { const s = D.inputs[i] ? inputOf(n, D.inputs[i][0]) : null; return s && s.gpu ? s.gpu.view : dummyView; };
  g.bind = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: g.ubuf } }, { binding: 1, resource: src(0) }, { binding: 2, resource: sampler }, { binding: 3, resource: src(1) }, { binding: 4, resource: { buffer: g.bbuf } }] });
  const has = i => D.inputs[i] && inputOf(n, D.inputs[i][0]) ? 1 : 0;
  device.queue.writeBuffer(g.bbuf, 0, new Float32Array([has(0), has(1), D.view, 0]));
  return g.bind;
}
// The bench uniform (lib/bench-wgsl.js fillUniform): floats 0..15 are size,
// time, pixelScale and the swatches, as in every table. L.kAt places the
// knobs, L.extras the sliders, L.fixed constants, L.fillFn the rest.
const fillU = (n, d) => CAT.fillUniform(n, d, { T, TEX, G });
function stepSim(enc, n, dt) {
  const g = n.gpu, s = g.sim, c = cellOf(n); if (!s || !g.pipeline || !g.present) return;
  const doStep = reset => { const d = s.udata; d.fill(0); d[0] = s.N; d[1] = s.N; d[2] = T; d[3] = 1; d.set(n.k, 16); d[20] = s.frame; d[21] = s.seed; d[22] = 1 / 60; d[23] = reset ? 1 : 0;
    const r = s.ring; s.ring = (s.ring + 1) % 8; device.queue.writeBuffer(s.ubufs[r], 0, d);
    const pass = enc.beginComputePass(); pass.setPipeline(g.pipeline); pass.setBindGroup(0, s.cbind[r][s.cur]); pass.dispatchWorkgroups(s.N / 8, s.N / 8); pass.end(); s.cur = 1 - s.cur; s.frame++; };
  if (s.reset) { s.reset = false; s.frame = 0; s.seed = Math.random() * 100; doStep(true); }
  else if (!G.paused) { s.acc += dt * c.steps * 12 * G.tempo; const k = Math.min(8, Math.floor(s.acc)); s.acc -= k; for (let i = 0; i < k; i++) doStep(false); }
  const d = s.pdata; d[0] = TEX; d[1] = TEX; d[2] = T; d[3] = 1; d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12); d.set(n.k, 16); d[20] = s.frame; d[21] = s.seed; d[22] = 0; d[23] = c.mode;
  device.queue.writeBuffer(s.pbuf, 0, d);
  const pass = enc.beginRenderPass({ colorAttachments: [{ view: g.view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
  pass.setPipeline(g.present); pass.setBindGroup(0, s.pbind[s.cur]); pass.draw(3); pass.end();
}
let last = performance.now(), fpsT = 0, frames = 0, packT = 0;
const blitData = new Float32Array(UBYTES / 4);
function frame() {
  if (!alive) return;
  requestAnimationFrame(frame);
  const now = performance.now(); const dt = Math.min((now - last) / 1000, 0.25); last = now; if (!G.paused) T += dt * G.tempo;
  frames++; if (now / 1000 - fpsT > 1) { if (now > statusUntil) $('fps').textContent = `${Math.round(frames / (now / 1000 - fpsT))} FPS · ${nodes.length} passes · ${links.length} wires`; fpsT = now / 1000; frames = 0; }
  if (packDirty && now - packT > 400 && $('codepane').classList.contains('pack')) { packDirty = false; packT = now; $('packview').innerHTML = highlight(packSrc()); }
  if (!device) return;
  const enc = device.createCommandEncoder(); let any = false;
  for (const n of topo()) {
    const g = n.gpu; if (!g || !g.pipeline) continue;
    if (g.sim) { stepSim(enc, n, dt); any = true; continue; }
    fillU(n, g.udata); device.queue.writeBuffer(g.ubuf, 0, g.udata);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: g.view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(g.pipeline); pass.setBindGroup(0, bindOf(n)); pass.draw(3); pass.end(); any = true;
  }
  const wr = world.getBoundingClientRect();
  for (const n of nodes) {
    const g = n.gpu; if (!g || !n.el) continue;
    const cv = n.el.querySelector('canvas'); const r = cv.getBoundingClientRect();
    if (r.right < wr.left || r.left > wr.right || r.bottom < wr.top || r.top > wr.bottom) continue;
    if (g.canvas !== cv) { g.canvas = cv; g.ctx = cv.getContext('webgpu'); g.ctx.configure({ device, format, alphaMode: 'opaque' }); }
    if (!g.bind && g.pipeline && !g.sim) bindOf(n);
    const d = blitData; d[0] = cv.width; d[1] = cv.height; d[2] = T; d[3] = 1; d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    if (!g.blitU) { g.blitU = device.createBuffer({ size: UBYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); g.blitBind = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: g.blitU } }, { binding: 1, resource: g.view }, { binding: 2, resource: sampler }, { binding: 3, resource: dummyView }, { binding: 4, resource: { buffer: g.bbuf } }] }); }
    if (g.sim) device.queue.writeBuffer(g.bbuf, 0, new Float32Array([0, 0, 0, 0]));
    device.queue.writeBuffer(g.blitU, 0, d);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: g.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(blitPipe); pass.setBindGroup(0, g.blitBind); pass.draw(3); pass.end(); any = true;
  }
  if (any) device.queue.submit([enc.finish()]);
}

// ------------------------------------------------------------ self test
// Compile every node of one library through the same assembly and the same
// pipeline layouts the graph uses. Returns { pass, fail: [{ fn, msg }] }.
async function selfTest(key) {
  const L = await ensureLib(key); const out = { lib: key, pass: 0, fail: [] };
  for (const c of L.cells) {
    const n = { kind: key, fn: c.name }; n.code = templateCode(n);
    try {
      const module = device.createShaderModule({ code: moduleFor(n) }); const info = await module.getCompilationInfo();
      const e = info.messages.find(m => m.type === 'error'); if (e) { out.fail.push({ fn: c.name, msg: `line ${e.lineNum}: ${e.message.slice(0, 200)}` }); continue; }
      if (L.sim) { await device.createComputePipelineAsync({ layout: clayout, compute: { module, entryPoint: entryOf(n) } }); await presentFor(key); }
      else await device.createRenderPipelineAsync({ layout, vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: entryOf(n), targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' } });
      out.pass++;
    } catch (e) { out.fail.push({ fn: c.name, msg: String(e.message || e).slice(0, 200) }); }
  }
  return out;
}

await preset('classic');
window.__bench = { moduleFor, packSrc, preset, graph: () => ({ nodes, links }), addNode, link, rebuildAll, LIBS, GENERIC, INDEX, EXAMPLES, cellOf, ensureLib, selfTest, templateCode, fit, alive: () => alive, view: () => view };
requestAnimationFrame(frame);
