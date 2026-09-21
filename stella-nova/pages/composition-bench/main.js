// ============================================================================
//  COMPOSITION BENCH  ·  main.js — the node-graph runtime (entry module)
// ────────────────────────────────────────────────────────────────────────────
//  A node graph where each pass owns editable WGSL and wires carry 512² textures.
//  This runtime stays one module: the graph model, the WGSL assembly, the canvas
//  pan/zoom UI, the code editor, the toolbar and the GPU passes share one mutable
//  state (nodes, links, view, device) and call each other both ways, so a finer
//  split would risk behavior. The monolith is broken down at the file level only:
//  the styles, the two JSON libraries and the four WGSL headers now load from
//  files, and this module fetches them before it builds the graph.
//
//  SECTIONS  (grep the banner to jump)
//      WGSL syntax highlighting ... highlight / indexFns / fnSourceFrom
//      node model ................. addNode / link / topo / templateCode
//      WGSL assembly .............. moduleFor / packSrc
//      canvas ..................... pan/zoom, buildNodeEl, drawWires, renderNodes
//      editor pane ................ openEditor / showEditor / apply / revert
//      toolbar .................... add, presets, save/load graph
//      GPU ........................ gpuOf / compileNode / bindOf / stepSim / frame
//
//  DATA
//      libs.json / generic.json ... the node libraries and the generic node kinds
//      shaders/{head,genu,vs,blit}.wgsl  the WGSL headers assembled into each pass
// ============================================================================
import { loadShaders } from '../../lib/shaders.js';
  const $ = id => document.getElementById(id);
  const [LIBS, GENERIC] = await Promise.all([
    fetch(new URL('libs.json', import.meta.url)).then(r => r.json()),
    fetch(new URL('generic.json', import.meta.url)).then(r => r.json()),
  ]);
  const SH = await loadShaders(import.meta.url, ['shaders/head.wgsl', 'shaders/genu.wgsl', 'shaders/vs.wgsl', 'shaders/blit.wgsl']);
  const HEAD = SH['shaders/head.wgsl'], GEN_UNIFORM = SH['shaders/genu.wgsl'], VS = SH['shaders/vs.wgsl'], BLIT = SH['shaders/blit.wgsl'];
  for (const L of Object.values(LIBS)) for (const e of L.extras) e.fn = new Function('return (' + e.map + ')')();
  const TEX = 512, UBYTES = 256;
  const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const G = { ink: hexToRgb('#0e1118'), tone: hexToRgb('#5a8cc0'), cream: hexToRgb('#e8ecf4'), paused: false, tempo: 1 };
  // ---------------------------------------------------------- WGSL syntax highlighting
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
  const FN_RE = /\n(?:\/\/[^\n]*\n)*(?:@\w+(?:\([^)]*\))?\s*)*fn (\w+)\([^{]*\{/g;
  function indexFns(src) {
    const idx = {}; let m; const heads = [];
    while ((m = FN_RE.exec(src))) heads.push({ name: m[1], start: m.index + 1, body: m.index + m[0].length - 1 });
    for (const h of heads) { let depth = 0, j = h.body; for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) break; } } idx[h.name] = src.slice(h.start, j + 1); }
    return idx;
  }
  
  function fnSourceFrom(idx, name) {
    const seen = new Set(), order = [];
    const visit = n => { if (seen.has(n) || !idx[n]) return; seen.add(n); for (const [, callee] of idx[n].matchAll(/\b(\w+)\(/g)) if (callee !== n && idx[callee]) visit(callee); order.push(n); };
    visit(name); return order.map(n => idx[n]).join('\n\n');
  }
  
  const STATES = ['idle', 'listening', 'thinking', 'responding', 'success', 'error'];

  // ------------------------------------------------------------ node model
  const cellOf = n => LIBS[n.kind] ? LIBS[n.kind].cells.find(c => c.name === n.fn) : null;
  const def = n => LIBS[n.kind] || GENERIC[n.kind];
  const title = n => n.fn ? n.fn.replace(/_/g, ' ') : (n.op || def(n).label.toLowerCase());
  function templateCode(n) {
    if (LIBS[n.kind]) { const L = LIBS[n.kind]; return (L.entries[n.fn] + L.adapter.replace(/__NAME__/g, n.fn)).trim() + '\n'; }
    const Gk = GENERIC[n.kind]; return (Gk.ops ? Gk.code.replace('__OP__', Gk.ops[n.op]) : Gk.code).trim() + '\n';
  }
  const entryOf = n => LIBS[n.kind] ? LIBS[n.kind].entry.replace(/__NAME__/g, n.fn) : 'fs_main';
  let nodes = [], links = [], nextId = 1, selected = null;
  const byId = id => nodes.find(n => n.id === id);
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
  function removeNode(n) { if (n.kind === 'output') return; nodes = nodes.filter(x => x !== n); links = links.filter(l => l.from !== n.id && l.to !== n.id); if (n.gpu) { n.gpu.tex.destroy(); } }
  function topo() { const order = [], seen = new Set(); const visit = n => { if (seen.has(n.id)) return; seen.add(n.id); for (const l of links) if (l.to === n.id) visit(byId(l.from)); order.push(n); }; for (const n of nodes) visit(n); return order; }
  const inputOf = (n, name) => { const l = links.find(x => x.to === n.id && x.input === name); return l ? byId(l.from) : null; };

  // ------------------------------------------------------------ WGSL assembly
  function moduleFor(n) {
    if (LIBS[n.kind]) {
      const L = LIBS[n.kind];
      if (L.sim) return L.core + '\n' + n.code;
      const core = L.orb ? L.fams[cellOf(n).family].core : L.core;
      return L.uniform + HEAD + VS + core + '\n' + n.code;
    }
    return GEN_UNIFORM + HEAD + VS + '\n' + n.code;
  }
  function packSrc() {
    const order = topo(); const lines = [`// composition bench pack · ${nodes.length} passes, ${links.length} wires`, '// each pass renders a 512² rgba16float texture; in0/in1 are the wired upstream textures, b.has0/has1 say which are wired', '// bindings: 0 uniform (the library struct), 1 in0, 2 sampler, 3 in1, 4 BenchB', ''];
    lines.push('// ── pass order and wiring');
    for (const n of order) { const ins = def(n).inputs.map(([nm]) => { const s = inputOf(n, nm); return `${nm} ← ${s ? 'pass ' + s.id : '—'}`; }).join(', '); lines.push(`//   pass ${n.id}: ${n.kind}${n.fn ? ' · ' + n.fn : ''}${n.op ? ' · ' + n.op : ''}  [${ins}]  knobs ${JSON.stringify(n.k.map(v => +v.toFixed(3)))}${n.xk.length ? ' extras ' + JSON.stringify(n.xk.map(v => +v.toFixed(3))) : ''}`); }
    lines.push('', HEAD.trim(), '');
    const cores = new Set();
    for (const n of order) {
      const L = LIBS[n.kind]; const key = L ? (L.orb ? 'orb:' + cellOf(n).family : n.kind) : 'generic';
      if (!cores.has(key)) { cores.add(key); lines.push(`// ══ ${key} library core ══`, L ? (L.sim ? L.core : (L.uniform + (L.orb ? L.fams[cellOf(n).family].core : L.core))) : GEN_UNIFORM, ''); }
    }
    for (const n of order) lines.push(`// ══ pass ${n.id} · ${n.kind}${n.fn ? ' · ' + n.fn : ''}${n.op ? ' · ' + n.op : ''} · entry ${entryOf(n)} ══`, n.code, '');
    return lines.join('\n');
  }

  // ------------------------------------------------------------ canvas: pan / zoom / nodes / wires
  const world = $('world'), xf = $('xf'), wires = $('wires'), nodesEl = $('nodes');
  let view = { x: 80, y: 60, z: 1 };
  const applyView = () => { xf.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`; };
  applyView();
  const toWorld = (cx, cy) => { const r = world.getBoundingClientRect(); return [(cx - r.left - view.x) / view.z, (cy - r.top - view.y) / view.z]; };
  let pan = null;
  world.addEventListener('pointerdown', e => { if (e.target !== world && e.target !== xf && e.target !== wires && e.target !== nodesEl) return; pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; world.classList.add('panning'); world.setPointerCapture(e.pointerId); select(null); });
  world.addEventListener('pointermove', e => { if (pan) { view.x = pan.vx + e.clientX - pan.x; view.y = pan.vy + e.clientY - pan.y; applyView(); } });
  const endPan = () => { pan = null; world.classList.remove('panning'); };
  world.addEventListener('pointerup', endPan); world.addEventListener('pointercancel', endPan);
  world.addEventListener('wheel', e => { if (e.target.closest && e.target.closest('.nd-w')) return; e.preventDefault(); const [wx, wy] = toWorld(e.clientX, e.clientY); const z = Math.min(2.5, Math.max(0.25, view.z * Math.exp(-e.deltaY * 0.0012))); view.x += wx * (view.z - z); view.y += wy * (view.z - z); view.z = z; applyView(); }, { passive: false });
  function fit() {
    if (!nodes.length) return; const r = world.getBoundingClientRect();
    const x0 = Math.min(...nodes.map(n => n.x)), y0 = Math.min(...nodes.map(n => n.y)), x1 = Math.max(...nodes.map(n => n.x + 224)), y1 = Math.max(...nodes.map(n => n.y + (n.el ? n.el.offsetHeight : 320)));
    const z = Math.min(1.2, Math.max(0.25, Math.min((r.width - 260) / (x1 - x0 + 40), (r.height - 60) / (y1 - y0 + 40))));
    view = { z, x: 230 + ((r.width - 230) - (x1 - x0) * z) / 2 - x0 * z, y: (r.height - (y1 - y0) * z) / 2 - y0 * z }; applyView(); drawWires();
  }
  function select(n) { selected = n; for (const m of nodes) if (m.el) m.el.classList.toggle('sel', m === n); if (n && $('codepane').classList.contains('open')) showEditor(n); }
  window.addEventListener('keydown', e => { const tag = document.activeElement.tagName; if ((e.key === 'Delete' || e.key === 'Backspace') && selected && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') { removeNode(selected); selected = null; rebuildAll(); } });

  const bez = (x0, y0, x1, y1) => { const dx = Math.max(40, Math.abs(x1 - x0) * 0.5); return `M${x0},${y0} C${x0 + dx},${y0} ${x1 - dx},${y1} ${x1},${y1}`; };
  function sockPos(dot) { const r = dot.getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); }
  const opt = (v, cur, label) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
  function buildNodeEl(n) {
    const D = def(n); const L = LIBS[n.kind]; const el = document.createElement('div'); el.className = 'nd kind-' + n.kind; el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; n.el = el;
    const ins = D.inputs.map(([nm, ty, o]) => `<div class="sock in"><i class="dot ${ty}" data-sock="in" data-in="${nm}"></i>${nm}${o ? ' <span class="opt">·</span>' : ''}</div>`).join('');
    const outs = D.out ? `<div class="sock out"><i class="dot ${D.out}" data-sock="out"></i>${D.out === 'coord' ? 'p' : 'img'}</div>` : '';
    let w = '';
    if (L) w += `<select class="sel" data-w="fn">${L.cells.map(c => opt(c.name, n.fn, c.name.replace(/_/g, ' ') + ' · ' + c.family)).join('')}</select>`;
    if (D.ops) w += `<select class="sel" data-w="op">${Object.keys(D.ops).map(o => opt(o, n.op, o)).join('')}</select>`;
    if (L && L.orb) w += `<select class="sel" data-w="state">${STATES.map((s, i) => opt(String(i), String(n.state), s)).join('')}</select>`;
    const knob = (lbl, val, role, idx) => `<div class="knob"><label>${lbl}</label><output>${val.toFixed(2)}</output><input type="range" min="0" max="1" step="0.01" value="${val}" data-role="${role}" data-i="${idx}"></div>`;
    const knobNames = L ? cellOf(n).knobs : D.knobs;
    knobNames.forEach((kn, j) => { if (kn) w += knob('k' + j + ' · ' + kn, n.k[j], 'k', j); });
    if (L) L.extras.forEach((e, j) => { w += knob(e.name, n.xk[j], 'x', j); });
    if (L && L.sim) w += `<button class="chip" type="button" data-act="reset">↺ reset</button>`;
    const c = cellOf(n);
    el.innerHTML = `<div class="nd-h"><span class="t" title="${c ? c.line.replace(/"/g, '&quot;') : ''}">${title(n)}</span><span class="k">${D.label.toLowerCase()}</span><span class="ed" title="edit this node's shader">&lt;/&gt;</span>${n.kind !== 'output' ? '<span class="x" title="remove">✕</span>' : ''}</div>
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
      const up = ev => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); live.remove();
        const t = document.elementFromPoint(ev.clientX, ev.clientY); const dot = t && t.closest ? t.closest('.dot[data-sock=in]') : null;
        if (dot) { const to = nodes.find(m => m.el && m.el.contains(dot)); link(from, to, dot.dataset.in); }
        wireChanged(); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); move(e);
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
  $('close-code').addEventListener('click', () => { $('codepane').classList.remove('open'); $('code').classList.remove('on'); });
  $('code').addEventListener('click', () => { if ($('codepane').classList.contains('open')) { $('codepane').classList.remove('open'); $('code').classList.remove('on'); } else openEditor(selected || nodes.find(n => n.kind === 'output')); });
  const copy = (text, btn, label) => navigator.clipboard.writeText(text).then(() => { btn.textContent = 'Copied'; setTimeout(() => btn.textContent = label, 1200); }).catch(() => { btn.textContent = 'Select the text to copy'; setTimeout(() => btn.textContent = label, 2000); });
  $('copy-pack').addEventListener('click', e => copy(packSrc(), e.currentTarget, 'Copy pack'));

  // ------------------------------------------------------------ toolbar
  const spawnAt = () => { const r = world.getBoundingClientRect(); return toWorld(r.left + 280 + Math.random() * 140, r.top + 80 + Math.random() * 140); };
  const libsel = $('libpick'); const fnsel = $('fnpick');
  libsel.innerHTML = Object.entries(LIBS).map(([k, L]) => opt(k, 'noise', `${L.label} · ${L.cells.length}`)).join('');
  const fillFns = () => { const L = LIBS[libsel.value]; fnsel.innerHTML = L.cells.map(c => opt(c.name, null, c.name.replace(/_/g, ' ') + ' · ' + c.family)).join(''); };
  libsel.addEventListener('change', fillFns); fillFns();
  $('add-lib').addEventListener('click', () => { const [x, y] = spawnAt(); const n = addNode(libsel.value, x, y, { fn: fnsel.value }); select(n); rebuildAll(); });
  for (const kind of Object.keys(GENERIC)) { if (kind === 'output') continue; $('add-' + kind).addEventListener('click', () => { const [x, y] = spawnAt(); const n = addNode(kind, x, y); select(n); rebuildAll(); }); }
  $('fit').addEventListener('click', fit);
  $('clear').addEventListener('click', () => preset('minimal'));
  $('preset').addEventListener('click', () => preset('default'));
  $('shuffle').addEventListener('click', () => preset('random'));
  $('pause').addEventListener('click', () => { G.paused = !G.paused; $('pause').classList.toggle('on', G.paused); $('pause').textContent = G.paused ? '▶ resume' : '❚❚ pause'; });
  $('tempo').addEventListener('input', e => { G.tempo = Math.pow(2, (+e.target.value - 0.5) * 4); $('tempo-now').textContent = G.tempo.toFixed(2) + 'x'; });
  for (const id of ['ink', 'tone', 'cream']) $('sw-' + id).addEventListener('input', e => { G[id] = hexToRgb(e.target.value); });
  const graphJSON = () => JSON.stringify({ nodes: nodes.map(({ id, kind, x, y, k, xk, fn, op, state, code, custom }) => ({ id, kind, x, y, k, xk, fn, op, state, code: custom ? code : undefined })), links }, null, 1);
  $('save').addEventListener('click', e => copy(graphJSON(), e.currentTarget, 'copy graph'));
  $('load').addEventListener('click', () => { const txt = prompt('paste a graph JSON'); if (!txt) return; try { loadGraph(JSON.parse(txt)); } catch (err) { $('fps').textContent = 'could not read that graph'; } });
  function loadGraph(g) {
    for (const n of nodes) if (n.gpu) n.gpu.tex.destroy();
    nodes = []; links = [];
    for (const n of g.nodes) { const m = addNode(n.kind, n.x, n.y, { fn: n.fn, op: n.op }); if (n.k) m.k = n.k; if (n.xk) m.xk = n.xk; if (n.state != null) m.state = n.state; if (n.code) { m.code = n.code; m.custom = true; } m.id = n.id; }
    nextId = Math.max(...nodes.map(n => n.id)) + 1; links = g.links.filter(l => byId(l.from) && byId(l.to)); rebuildAll(); setTimeout(fit, 0);
  }
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const rk = () => [0, 1, 2, 3].map(() => Math.random());
  function preset(which) {
    for (const n of nodes) if (n.gpu) n.gpu.tex.destroy();
    nodes = []; links = []; nextId = 1; selected = null;
    if (which === 'minimal') { const a = addNode('noise', 0, 40, { fn: 'fbm' }); const o = addNode('output', 340, 40); link(a, o, 'img'); }
    else if (which === 'default') {
      const f = addNode('field', 0, 0, { fn: 'vortex' }); f.xk = [0.3];
      const s2 = addNode('noise', 320, -80, { fn: 'fbm' }); s2.k = [0.45, 0.6, 0.5, 0.3];
      const s3 = addNode('noise', 320, 320, { fn: 'worley_edge' }); s3.k = [0.4, 0.8, 0.4, 0.2];
      const b = addNode('blend', 640, 120, { op: 'multiply' }); b.k = [0.6, 0.5, 0.5, 0.5];
      const c = addNode('color', 960, 20, { fn: 'oklch_sweep' });
      const p = addNode('postfx', 1280, 20, { fn: 'aberration' });
      const o = addNode('output', 1600, 20);
      link(f, s2, 'p'); link(f, s3, 'p'); link(s2, b, 'a'); link(s3, b, 'b'); link(b, c, 'v'); link(c, p, 'img'); link(p, o, 'img');
      if (!links.some(l => l.to === p.id)) { link(c, o, 'img'); }
    } else {
      const src = addNode(pick(['noise', 'noise', 'sampling', 'lighting', 'orb', 'sim']), 0, 0); src.fn = pick(LIBS[src.kind].cells).name; src.k = (cellOf(src).defaults || rk()).slice(); src.code = templateCode(src);
      let cur = src, x = 340;
      const n = 1 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const r = Math.random();
        if (r < 0.25) { const f = addNode('field', x, 320, { fn: pick(LIBS.field.cells).name }); const w = addNode('warp', x + 340, 0); link(cur, w, 'img'); link(f, w, 'p'); cur = w; x += 680; }
        else if (r < 0.5) { const s = addNode('noise', x, 320, { fn: pick(LIBS.noise.cells).name }); s.k = rk(); const b = addNode('blend', x + 340, 0, { op: pick(Object.keys(GENERIC.blend.ops)) }); b.k = [0.3 + Math.random() * 0.6, 0, 0, 0]; link(cur, b, 'a'); link(s, b, 'b'); cur = b; x += 680; }
        else if (r < 0.7) { const c = addNode('color', x, 0, { fn: pick(LIBS.color.cells).name }); link(cur, c, 'v'); cur = c; x += 340; }
        else { const p = addNode('postfx', x, 0, { fn: pick(LIBS.postfx.cells).name }); link(cur, p, 'img'); cur = p; x += 340; }
      }
      const o = addNode('output', x, 0); link(cur, o, 'img');
    }
    rebuildAll(); setTimeout(fit, 0);
  }

  // ------------------------------------------------------------ GPU
  let device = null, format, bgl, layout, cbgl, clayout, pbgl, playout, sampler, dummy, blitPipe, blitBuf, blitData, packDirty = true, T = 0;
  if (navigator.gpu) { try { const adapter = await navigator.gpu.requestAdapter(); device = await adapter.requestDevice(); } catch (e) { device = null; } }
  if (!device) { $('nogpu').hidden = false; $('fps').textContent = 'no WebGPU'; }
  else {
    // The tab shell removes this iframe on a page swap. Release the device so
    // the renderer does not run out of GPU memory during heavy swapping.
    window.addEventListener('pagehide', () => { try { device.destroy(); } catch (e) {} });
    format = navigator.gpu.getPreferredCanvasFormat();
    bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} }, { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} }, { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
    layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
    cbgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } }, { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba32float', access: 'write-only' } }] });
    clayout = device.createPipelineLayout({ bindGroupLayouts: [cbgl] });
    pbgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
    playout = device.createPipelineLayout({ bindGroupLayouts: [pbgl] });
    sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'mirror-repeat', addressModeV: 'mirror-repeat' });
    dummy = device.createTexture({ size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
    const bm = device.createShaderModule({ code: BLIT });
    blitPipe = device.createRenderPipeline({ layout, vertex: { module: bm, entryPoint: 'vs_main' }, fragment: { module: bm, entryPoint: 'fs_blit', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
    blitBuf = device.createBuffer({ size: UBYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); blitData = new Float32Array(UBYTES / 4);
    this_simPresent = {};
  }
  var this_simPresent;
  function gpuOf(n) {
    if (n.gpu) return n.gpu;
    const g = { tex: device.createTexture({ size: [TEX, TEX], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }), ubuf: device.createBuffer({ size: UBYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), udata: new Float32Array(UBYTES / 4), bbuf: device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), pipeline: null, bind: null, blitBind: null, canvas: null, ctx: null };
    g.view = g.tex.createView();
    g.blitBind = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: blitBuf } }, { binding: 1, resource: g.view }, { binding: 2, resource: sampler }, { binding: 3, resource: dummy.createView() }, { binding: 4, resource: { buffer: g.bbuf } }] });
    n.gpu = g; return g;
  }
  async function compileNode(n) {
    if (!device) return; const g = gpuOf(n); const L = LIBS[n.kind]; g.gen = (g.gen || 0) + 1; const gen = g.gen;
    const code = moduleFor(n); const module = device.createShaderModule({ code });
    const info = await module.getCompilationInfo(); const errs = info.messages.filter(m => m.type === 'error');
    const setErr = msg => { n.err = msg; if (n.el) { n.el.querySelector('.st').textContent = msg; n.el.classList.toggle('err', !!msg); } if ($('editor')._node === n) setEdStatus(msg || (n.custom ? 'edited · applied' : 'compiled'), !!msg); };
    if (errs.length) { const e = errs[0]; const off = code.length - n.code.length; const ln = e.lineNum - code.slice(0, off).split('\n').length + 1; setErr(`line ${ln}: ${e.message.slice(0, 160)}`); return; }
    try {
      if (L && L.sim) {
        const cp = await device.createComputePipelineAsync({ layout: clayout, compute: { module, entryPoint: entryOf(n) } });
        if (!this_simPresent.pipe) { const pm = device.createShaderModule({ code: L.core }); this_simPresent.pipe = await device.createRenderPipelineAsync({ layout: playout, vertex: { module: pm, entryPoint: 'vs_main' }, fragment: { module: pm, entryPoint: 'fs_present', targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' } }); }
        if (g.gen !== gen) return;
        if (!g.sim) { const N = 128; const s = { N, cur: 0, frame: 0, seed: Math.random() * 100, reset: true, acc: 0, ring: 0, ubufs: [], cbind: [], udata: new Float32Array(24) };
          s.tex = [0, 1].map(() => device.createTexture({ size: [N, N], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING }));
          s.pbuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); s.pdata = new Float32Array(24);
          s.pbind = [0, 1].map(i => device.createBindGroup({ layout: pbgl, entries: [{ binding: 0, resource: { buffer: s.pbuf } }, { binding: 1, resource: s.tex[i].createView() }] }));
          for (let r = 0; r < 8; r++) { const b = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); s.ubufs.push(b); s.cbind.push([0, 1].map(i => device.createBindGroup({ layout: cbgl, entries: [{ binding: 0, resource: { buffer: b } }, { binding: 1, resource: s.tex[i].createView() }, { binding: 2, resource: s.tex[1 - i].createView() }] }))); }
          g.sim = s; }
        g.sim.reset = true; g.pipeline = cp;
      } else {
        const p = await device.createRenderPipelineAsync({ layout, vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: entryOf(n), targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' } });
        if (g.gen !== gen) return; g.pipeline = p;
      }
      setErr('');
    } catch (e) { setErr(String(e.message || e).slice(0, 160)); }
  }
  function bindOf(n) {
    const g = n.gpu; if (g.bind) return g.bind; const D = def(n);
    const src = i => { const s = D.inputs[i] ? inputOf(n, D.inputs[i][0]) : null; return s && s.gpu ? s.gpu.view : dummy.createView(); };
    g.bind = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: g.ubuf } }, { binding: 1, resource: src(0) }, { binding: 2, resource: sampler }, { binding: 3, resource: src(1) }, { binding: 4, resource: { buffer: g.bbuf } }] });
    const has = i => D.inputs[i] && inputOf(n, D.inputs[i][0]) ? 1 : 0;
    device.queue.writeBuffer(g.bbuf, 0, new Float32Array([has(0), has(1), D.view, 0]));
    return g.bind;
  }
  function fillU(n, d) {
    d.fill(0); const L = LIBS[n.kind];
    if (L && L.orb) {
      d[0] = TEX; d[1] = TEX; d[2] = 0; d[3] = 0; d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
      d[16] = 0; d[17] = 0; d[18] = T; d[19] = 1; d[21] = 1; d[22] = 1; d.set(n.k, 25); d[29] = 0; d[30] = n.state || 0; d[31] = Math.max(T - (n.stateAt || 0), 0);
      for (let j = 0; j < L.extras.length; j++) d[L.extras[j].i] = L.extras[j].fn(n.xk[j]);
      const lv = d[32], ac = d[33]; d.set([T * 0.6, T * 0.6, T * 0.6, T * 0.6, T * 0.6, T * lv, T * ac], 34); return;
    }
    d[0] = TEX; d[1] = TEX; d[2] = T; d[3] = 1; d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12);
    if (!L) { d.set(n.k, 16); return; }
    if (L.sim) { d.set(n.k, 16); return; }
    const kAt = n.kind === 'field' ? 16 : 20; d.set(n.k, kAt);
    for (const [i, v] of Object.entries(L.fixed)) d[+i] = v;
    for (let j = 0; j < L.extras.length; j++) d[L.extras[j].i] = L.extras[j].fn(n.xk[j]);
    if (L.samp) { d[16] = Math.round(32 + 480 * n.k[0] * n.k[0]); d[17] = (1.2 + 3.0 * n.k[1]) * TEX / 174; }
  }
  function stepSim(enc, n, dt) {
    const g = n.gpu, s = g.sim, c = cellOf(n); if (!s || !g.pipeline) return;
    const doStep = reset => { const d = s.udata; d.fill(0); d[0] = s.N; d[1] = s.N; d[2] = T; d[3] = 1; d.set(n.k, 16); d[20] = s.frame; d[21] = s.seed; d[22] = 1 / 60; d[23] = reset ? 1 : 0;
      const r = s.ring; s.ring = (s.ring + 1) % 8; device.queue.writeBuffer(s.ubufs[r], 0, d);
      const pass = enc.beginComputePass(); pass.setPipeline(g.pipeline); pass.setBindGroup(0, s.cbind[r][s.cur]); pass.dispatchWorkgroups(s.N / 8, s.N / 8); pass.end(); s.cur = 1 - s.cur; s.frame++; };
    if (s.reset) { s.reset = false; s.frame = 0; s.seed = Math.random() * 100; doStep(true); }
    else if (!G.paused) { s.acc += dt * c.steps * 12 * G.tempo; const k = Math.min(8, Math.floor(s.acc)); s.acc -= k; for (let i = 0; i < k; i++) doStep(false); }
    const d = s.pdata; d[0] = TEX; d[1] = TEX; d[2] = T; d[3] = 1; d.set([G.ink[0], G.ink[1], G.ink[2], 1], 4); d.set([G.tone[0], G.tone[1], G.tone[2], 1], 8); d.set([G.cream[0], G.cream[1], G.cream[2], 1], 12); d.set(n.k, 16); d[20] = s.frame; d[21] = s.seed; d[22] = 0; d[23] = c.mode;
    device.queue.writeBuffer(s.pbuf, 0, d);
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: g.view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(this_simPresent.pipe); pass.setBindGroup(0, s.pbind[s.cur]); pass.draw(3); pass.end();
  }
  let last = performance.now(), fpsT = 0, frames = 0, packT = 0;
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now(); const dt = Math.min((now - last) / 1000, 0.25); last = now; if (!G.paused) T += dt * G.tempo;
    frames++; if (now / 1000 - fpsT > 1) { $('fps').textContent = `${Math.round(frames / (now / 1000 - fpsT))} FPS · ${nodes.length} passes · ${links.length} wires`; fpsT = now / 1000; frames = 0; }
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
      if (!g.blitU) { g.blitU = device.createBuffer({ size: UBYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); g.blitBind = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: g.blitU } }, { binding: 1, resource: g.view }, { binding: 2, resource: sampler }, { binding: 3, resource: dummy.createView() }, { binding: 4, resource: { buffer: g.bbuf } }] }); }
      if (g.sim) device.queue.writeBuffer(g.bbuf, 0, new Float32Array([0, 0, 0, 0]));
      device.queue.writeBuffer(g.blitU, 0, d);
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: g.ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(blitPipe); pass.setBindGroup(0, g.blitBind); pass.draw(3); pass.end(); any = true;
    }
    if (any) device.queue.submit([enc.finish()]);
  }
  preset('default');
  window.__bench = { moduleFor, packSrc, preset, graph: () => ({ nodes, links }), addNode, link, rebuildAll, LIBS, GENERIC, cellOf };
  requestAnimationFrame(frame);

