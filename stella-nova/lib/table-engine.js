// ============================================================================
//  TABLE ENGINE  ·  shared runtime for the Stella Nova periodic-table pages
// ────────────────────────────────────────────────────────────────────────────
//  bootTable(PAGE, data) builds the sidebar, the signal generators, the palette,
//  the WGSL colorizer, the inspector and the frame loop from the spec, then
//  drives one PAGE object that owns the GPU work for a page. simulation-table,
//  color-table and postfx-table each pass their own PAGE and data.
//
//  data = { spec, pack, aux? }
//      spec .... the parsed spec.json (cells, gens, swatches, cols, uniform_bytes)
//      pack .... the main WGSL pack text
//      aux ..... extra fields merged into ctx (for example noisePack, photos)
//
//  PAGE hooks (all optional except init/draw): init(ctx), draw(enc,t,surf,rect,
//  dpr,dt,now,moving), tick(dt,now), leave(t), knob(t,i), source(t), library().
//  ctx gives the PAGE the device, format, tiles, G, PACK, STYLES, helpers and
//  the aux fields. The engine reads no DOM data; main.js fetches it and passes it.
//
//  PHONE AND TOUCH: table-mobile.js sets the column count, turns the sidebar
//  into a bottom sheet and caps the pixel ratio. On a touch screen with no
//  hover, the tiles under playhead() animate (t.focus) and carry .tm-live.
//
//  SCREENSAVER: when spec.saver exists, the engine defines window.snSaver for
//  the shell screensaver (lib/screensaver.js). enter() hides the page, adds
//  one full-window canvas and draws one calm cell into it on each frame.
//    spec.saver = { cells: [calm cell names], tempo: [at calm 0, at calm 1],
//                   dpr: pixel-ratio cap, warmup: ms before a recording,
//                   gens: { id: { fn, period, amp, bias } } generator settings,
//                   knobs: [k0..k3 or null] knob values for the saver cell,
//                   cycle: cells per dwell, fade: seconds, minDwell: seconds }
//  A gens period is multiplied by (0.5 + calm). PAGE.saver(t, opts), if the
//  PAGE has it, sets page state (for example the source) for the saver cell.
//  With cycle, the cells play in a seeded order, each for max(minDwell,
//  seconds / cycle), behind a fade to black drawn in the saver canvas (so a
//  recording has it). PAGE.leave(t) runs on the cell that goes off.
//  A page with no spec.saver gets the generic screensaver mode.
//
//  SAVER LABEL: when a saver cell goes on, the engine calls opts.label (the
//  shell plate, lower right) with the cell name, its family, the
//  species text, the named knob values, the generator values (tempo and so
//  on) and the cell equation. The equation is cell.eq in spec.json (a string
//  or a list of lines, plain Unicode maths). With no cell.eq, the engine uses
//  spec.saver.eq[family]. The engine sends the label again each second with
//  the same title, so the live values change in place. PAGE.saverLabel(t,
//  info), if the PAGE has it, can change info before it goes to the shell.
//
//  grep -n targets: "function frame", "function sizeSurf", "function makeSurface",
//  "function saverEnter", "function saverStep", "function saverFade", "saver.t === t",
//  "function saverLabel"
// ============================================================================
import { TOUCH, HOVER_LABEL, fitTable, playhead, maxDpr, initMobile } from './table-mobile.js';

export async function bootTable(PAGE, data) {
  const SPEC = data.spec;
  const STYLES = SPEC.cells;
  const PACK = data.pack || '';
  const $ = id => document.getElementById(id);
  const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const sstep = x => { const t = Math.min(Math.max(x, 0), 1); return t * t * (3 - 2 * t); };
  const G = { hoverOnly: true, tempo: 1 };
  for (const sw of SPEC.swatches) G[sw.id] = hexToRgb(sw.hex);

  // ---------------------------------------------------------- screensaver hook
  // The hook is defined now, so the shell finds it before the GPU is ready.
  // enter() waits for PAGE.init. If the GPU fails, enter() rejects and the
  // shell uses its generic mode. See saverEnter.
  const SAVER_WAIT_MS = 12000;
  let saver = null, saverReady = null;
  if (SPEC.saver) {
    let ok, fail; saverReady = new Promise((a, b) => { ok = a; fail = b; }); saverReady.catch(() => {});
    saverReady.ok = ok; saverReady.fail = fail;
    window.snSaver = { enter: opts => saverReady.then(() => saverEnter(opts || {})), exit: () => saverExit() };
  }
  const saverFail = msg => { if (saverReady) saverReady.fail(new Error(msg)); };

  // ---------------------------------------------------------- table sizing
  const COLS = SPEC.cols; const stage = $('stage');
  const fit = () => fitTable(stage, COLS);
  new ResizeObserver(fit).observe(stage); fit();

  // ---------------------------------------------------------- signal generators
  const hash1 = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const FNS = {
    sine:     { f: x => 0.5 + 0.5 * Math.sin(2 * Math.PI * x),        path: 'M2 8 C7 -2 10 -2 14 8 S21 18 26 8' },
    triangle: { f: x => 1 - Math.abs(2 * (x - Math.floor(x)) - 1),       path: 'M2 14 L8 2 L14 14 L20 2 L26 14' },
    square:   { f: x => (x - Math.floor(x)) < 0.5 ? 1 : 0,               path: 'M2 14 L2 2 L10 2 L10 14 L18 14 L18 2 L26 2 L26 14' },
    saw:      { f: x => x - Math.floor(x),                               path: 'M2 14 L14 2 L14 14 L26 2' },
    pulse:    { f: x => { const u = (x - Math.floor(x)) - 0.5; return Math.exp(-u * u * 90); }, path: 'M2 14 L9 14 L13 2 L17 14 L26 14' },
    noise:    { f: x => { const i = Math.floor(x), u = x - i, k = u * u * (3 - 2 * u); return hash1(i) * (1 - k) + hash1(i + 1) * k; }, path: 'M2 9 L6 4 L9 12 L12 7 L15 13 L18 3 L21 10 L26 6' },
    flat:     { f: x => 0.5,                                              path: 'M2 8 L26 8' },
  };
  const GENS = SPEC.gens.map(g => Object.assign({}, g, { map: new Function('y', 'return (' + g.map + ')(y)'), unit: new Function('v', 'return (' + g.unit + ')(v)') }));
  const gensEl = $('gens');
  for (const g of GENS) {
    const sec = document.createElement('div'); sec.className = 'sec'; sec.id = 'gen-' + g.id;
    sec.innerHTML = `<div class="sec-lbl">${g.title}<span class="now" id="${g.id}-now"></span></div>
      <div class="fns" role="group" aria-label="${g.id} function">${Object.entries(FNS).map(([k, v]) => `<button type="button" data-fn="${k}" class="${k === g.fn ? 'active' : ''}" title="${k}" aria-label="${k}"><svg viewBox="0 0 28 16"><path d="${v.path}"/></svg></button>`).join('')}</div>
      <canvas class="graph" id="${g.id}-graph" width="560" height="192"></canvas>
      <div class="row"><span class="row-lbl">Period</span><input type="range" id="${g.id}-period" min="0.25" max="30" step="0.05" value="${g.period}"><span class="val" id="${g.id}-period-v"></span></div>
      <div class="row"><span class="row-lbl">Amplitude</span><input type="range" id="${g.id}-amp" min="0" max="1" step="0.01" value="${g.amp}"><span class="val" id="${g.id}-amp-v"></span></div>
      <div class="row"><span class="row-lbl">Bias</span><input type="range" id="${g.id}-bias" min="0" max="1" step="0.01" value="${g.bias}"><span class="val" id="${g.id}-bias-v"></span></div>
      <div class="row"><span class="row-lbl">Phase</span><input type="range" id="${g.id}-phase" min="0" max="1" step="0.01" value="${g.phase}"><span class="val" id="${g.id}-phase-v"></span></div>`;
    gensEl.appendChild(sec);
    sec.querySelectorAll('.fns button').forEach(b => b.addEventListener('click', () => { g.fn = b.dataset.fn; sec.querySelectorAll('.fns button').forEach(x => x.classList.toggle('active', x === b)); }));
    const bind = (key, fmtv) => { const inp = $(`${g.id}-${key}`), out = $(`${g.id}-${key}-v`); const upd = () => { g[key] = +inp.value; out.textContent = fmtv(g[key]); }; inp.addEventListener('input', upd); upd(); };
    bind('period', v => v.toFixed(2) + 's'); bind('amp', v => v.toFixed(2)); bind('bias', v => g.unit(g.map(v))); bind('phase', v => v.toFixed(2));
    g.canvas = $(g.id + '-graph'); g.ctx2 = g.canvas.getContext('2d');
  }
  function genValue(g, t) { const f = FNS[g.fn].f(t / g.period + g.phase); return Math.min(1, Math.max(0, g.bias + g.amp * (g.fn === 'flat' ? 0 : f - 0.5))); }
  function drawGraph(g, now) {
    const c = g.canvas, cx = g.ctx2, W = c.width, H = c.height, pad = 8;
    const span = Math.max(g.period * 2.5, 1.5); const t0 = now - span * 0.75;
    cx.clearRect(0, 0, W, H);
    cx.strokeStyle = 'rgba(150,200,255,0.10)'; cx.lineWidth = 1; cx.beginPath();
    for (let k = 0; k <= 4; k++) { const y = pad + (H - 2 * pad) * k / 4; cx.moveTo(0, y); cx.lineTo(W, y); } cx.stroke();
    cx.strokeStyle = 'rgba(150,200,255,0.16)'; cx.beginPath();
    for (let k = Math.ceil(t0 / g.period); k * g.period < t0 + span; k++) { const x = (k * g.period - t0) / span * W; cx.moveTo(x, 0); cx.lineTo(x, H); } cx.stroke();
    cx.strokeStyle = '#96c8ff'; cx.lineWidth = 2; cx.beginPath();
    for (let i = 0; i <= W; i += 2) { const t = t0 + i / W * span; const y = pad + (1 - genValue(g, t)) * (H - 2 * pad); i ? cx.lineTo(i, y) : cx.moveTo(i, y); }
    cx.stroke();
    const xp = W * 0.75, yp = pad + (1 - genValue(g, now)) * (H - 2 * pad);
    cx.strokeStyle = 'rgba(255,200,50,0.5)'; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(xp, 0); cx.lineTo(xp, H); cx.stroke();
    cx.fillStyle = '#ffc832'; cx.beginPath(); cx.arc(xp, yp, 4, 0, Math.PI * 2); cx.fill();
  }
  let sigT = 0, sigLast = performance.now();
  function tickSignals() {
    const n = performance.now(); const dt = Math.min((n - sigLast) / 1000, 0.25); sigLast = n; sigT += dt;
    for (const g of GENS) { const y = genValue(g, sigT); G[g.id] = g.map(y); $(g.id + '-now').textContent = g.unit(G[g.id]); drawGraph(g, sigT); }
    return dt;
  }
  const setChip = (id, on) => { $(id).classList.toggle('on', on); $(id).setAttribute('aria-pressed', String(on)); };
  let globalDirty = true;
  for (const sw of SPEC.swatches) $('sw-' + sw.id).addEventListener('input', e => { G[sw.id] = hexToRgb(e.target.value); globalDirty = true; });
  $('hoveronly').addEventListener('click', () => { G.hoverOnly = !G.hoverOnly; setChip('hoveronly', G.hoverOnly); $('hoveronly').textContent = G.hoverOnly ? HOVER_LABEL : '◉ animate everything'; });
  initMobile();

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
  const fnIndex = indexFns(PACK);
  function fnSourceFrom(idx, name) {
    const seen = new Set(), order = [];
    const visit = n => { if (seen.has(n) || !idx[n]) return; seen.add(n); for (const [, callee] of idx[n].matchAll(/\b(\w+)\(/g)) if (callee !== n && idx[callee]) visit(callee); order.push(n); };
    visit(name); return order.map(n => idx[n]).join('\n\n');
  }
  const fnSource = name => fnSourceFrom(fnIndex, name);

  // ---------------------------------------------------------- cells
  const tiles = [];
  for (const s of STYLES) {
    const el = $('tile-' + s.name);
    const t = { s, el, canvas: el.querySelector('canvas'), status: el.querySelector('.orb-status'), phase: 0, rate: 0, hover: false, dirty: true, knobs: s.defaults.slice(), pipeline: null, surf: null, page: {} };
    el.addEventListener('pointerenter', () => { t.hover = true; });
    el.addEventListener('pointerdown', e => { if (e.button !== 0) return; t.drag = { x: e.clientX, y: e.clientY, moved: false }; try { el.setPointerCapture(e.pointerId); } catch (_) {} if (PAGE.pointer) PAGE.pointer(t, 'down', e, el); });
    el.addEventListener('pointermove', e => { if (!t.drag) return; if (Math.hypot(e.clientX - t.drag.x, e.clientY - t.drag.y) > 4) t.drag.moved = true; if (t.drag.moved && PAGE.pointer) PAGE.pointer(t, 'move', e, el); });
    const endDrag = e => { if (!t.drag) return; const moved = t.drag.moved; t.drag = null; t.dragMoved = moved; if (PAGE.pointer) PAGE.pointer(t, 'up', e, el); };
    el.addEventListener('pointerup', endDrag); el.addEventListener('pointercancel', endDrag); el.addEventListener('pointerleave', () => { t.hover = false; if (PAGE.leave && inspected !== t) PAGE.leave(t); });
    tiles.push(t);
  }
  const visible = new Set();
  const io = new IntersectionObserver(es => { for (const e of es) { const t = e.target._tile; if (e.isIntersecting) visible.add(t); else visible.delete(t); } }, { root: stage, rootMargin: '100px' });
  for (const t of tiles) { t.el._tile = t; io.observe(t.el); }

  // ---------------------------------------------------------- inspector
  let inspected = null; const modal = $('modal');
  function open(t) {
    inspected = t; t.dirty = true;
    $('m-name').textContent = t.s.name.replace(/_/g, ' '); $('m-fn').textContent = (t.s.fn || '') + (t.s.fn ? ' · ' : '') + t.s.family;
    $('m-species').textContent = t.s.species; $('m-src-lbl').textContent = 'WGSL · ' + (t.s.fn || t.s.name);
    const src = (PAGE.source) ? PAGE.source(t) : fnSource(t.s.fn || ('n_' + t.s.name));
    $('m-src').innerHTML = highlight(src); $('m-src')._raw = src;
    const kn = $('m-knobs'); kn.innerHTML = '';
    t.s.knobs.forEach((k, i) => {
      if (!k) return;
      const w = document.createElement('div'); w.className = 'knob'; const id = 'knob-' + t.s.name + '-' + i;
      w.innerHTML = `<label for="${id}">k${i} · ${k}</label><output>${t.knobs[i].toFixed(2)}</output><input type="range" id="${id}" min="0" max="1" step="0.01" value="${t.knobs[i]}">`;
      w.querySelector('input').addEventListener('input', e => { t.knobs[i] = +e.target.value; t.dirty = true; w.querySelector('output').textContent = t.knobs[i].toFixed(2); if (PAGE.knob) PAGE.knob(t, i); });
      kn.appendChild(w);
    });
    modal.classList.add('open'); $('m-close').focus();
  }
  function close() { modal.classList.remove('open'); inspected = null; }
  { const mc = $('m-orb'); let md = null; if (PAGE.pointer) mc.style.touchAction = 'none';
    mc.addEventListener('pointerdown', e => { if (!inspected || e.button !== 0) return; md = true; try { mc.setPointerCapture(e.pointerId); } catch (_) {} if (PAGE.pointer) PAGE.pointer(inspected, 'down', e, mc); });
    mc.addEventListener('pointermove', e => { if (md && PAGE.pointer) PAGE.pointer(inspected, 'move', e, mc); });
    const mend = e => { if (!md) return; md = null; if (PAGE.pointer) PAGE.pointer(inspected, 'up', e, mc); };
    mc.addEventListener('pointerup', mend); mc.addEventListener('pointercancel', mend); }
  for (const t of tiles) { t.el.addEventListener('click', () => { if (t.dragMoved) { t.dragMoved = false; return; } open(t); }); t.el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(t); } }); }
  $('m-close').addEventListener('click', close); modal.addEventListener('click', e => { if (e.target === modal) close(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  const copy = (text, btn, label) => navigator.clipboard.writeText(text).then(() => { btn.textContent = 'Copied'; setTimeout(() => btn.textContent = label, 1200); }).catch(() => { btn.textContent = 'Select the text to copy'; setTimeout(() => btn.textContent = label, 2000); });
  $('m-copy').addEventListener('click', e => inspected && copy($('m-src')._raw, e.currentTarget, 'Copy function'));
  $('m-copy-pack').addEventListener('click', e => copy((PAGE.library) ? PAGE.library() : PACK, e.currentTarget, 'Copy library'));

  // ---------------------------------------------------------- GPU
  if (!navigator.gpu) { saverFail('no WebGPU'); $('nogpu').hidden = false; $('fps').textContent = 'no WebGPU'; (function loop() { requestAnimationFrame(loop); tickSignals(); })(); return; }
  let device;
  try { const adapter = await navigator.gpu.requestAdapter(); device = await adapter.requestDevice(); }
  catch (e) { saverFail('no WebGPU device'); $('nogpu').hidden = false; $('fps').textContent = 'no WebGPU device'; return; }
  // The tab shell swaps pages by removing this iframe. Removal fires pagehide,
  // so a handler here releases the device and stops the loop. Without it every
  // swap orphans a live device and the renderer runs out of GPU memory.
  let torn = false;
  const teardown = () => { if (torn) return; torn = true; try { device.destroy(); } catch (_) {} };
  addEventListener('pagehide', teardown);
  const format = navigator.gpu.getPreferredCanvasFormat();
  // A surface draws into its own persistent texture (surf.cache), not into
  // the canvas. surf.ctx is a shim, so PAGE.draw still calls
  // surf.ctx.getCurrentTexture() and gets the cache. present() copies the
  // cache into the real canvas texture (surf.gpu). The frame loop presents
  // every visible surface on each active frame, so no canvas is composited
  // with a swap-chain buffer that was not drawn in that frame. Safari shows
  // such a buffer (stale or cleared) as a flash when many tiles ease at once.
  function makeSurface(canvas) {
    const gpu = canvas.getContext('webgpu'); gpu.configure({ device, format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST });
    const buf = device.createBuffer({ size: SPEC.uniform_bytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const surf = { canvas, gpu, cache: null, drawn: false, buf, data: new Float32Array(SPEC.uniform_bytes / 4), w: 0, h: 0, page: {} };
    surf.ctx = { getCurrentTexture: () => { surf.drawn = true; return surf.cache; } };
    return surf;
  }
  function present(enc, surf) {
    if (!surf.drawn) return;
    enc.copyTextureToTexture({ texture: surf.cache }, { texture: surf.gpu.getCurrentTexture() }, [surf.cache.width, surf.cache.height]);
  }
  for (const t of tiles) t.surf = makeSurface(t.canvas);
  const msurf = makeSurface($('m-orb'));
  const ctx = { device, format, tiles, G, PACK, STYLES, $, sstep, makeSurface, msurf, fnSource, fnSourceFrom, indexFns, highlight, setStatus: (t, msg, err) => { t.status.textContent = msg; t.status.classList.toggle('err', !!err); }, markAllDirty: () => { for (const t of tiles) t.dirty = true; }, inspected: () => inspected, sigTime: () => sigT };
  Object.assign(ctx, data.aux || {});
  try { await PAGE.init(ctx); } catch (e) { $('fps').textContent = 'init failed: ' + String(e.message || e).slice(0, 80); console.error(e); saverFail('init failed'); return; }
  if (saverReady) saverReady.ok();

  // ---------------------------------------------------------- frame loop
  // ANIM_CAP bounds how many easing-out tiles run the shader in one frame. A
  // mouse sweep leaves many tiles easing out at once. Hovered and inspected
  // tiles always draw. The overflow goes to the tiles that drew least
  // recently, and a tile that does not draw does not advance its clock, so
  // it pauses and continues. It does not jump.
  //
  // Presentation is separate from drawing. On an active frame (a draw, a
  // scroll, or HOLD seconds after one), every visible surface copies its
  // cache into its canvas, drawn or not. See makeSurface.
  const ANIM_CAP = 12, HOLD = 0.5;
  let fpsT = 0, frames = 0, frameNo = 0, activeUntil = 0;
  stage.addEventListener('scroll', () => { activeUntil = sigT + HOLD; }, { passive: true });
  function frame() {
    if (torn) return;
    requestAnimationFrame(frame);
    const dt = tickSignals(); const now = sigT; frameNo++;
    if (saver && saver.per) saverStep();
    frames++; if (now - fpsT > 1) { $('fps').textContent = `${Math.round(frames / (now - fpsT))} FPS · ${tiles.filter(t => t.pipeline).length}/${tiles.length}`; fpsT = now; frames = 0; }
    if (PAGE.tick) { if (PAGE.tick(dt, now) === true) globalDirty = true; }
    const dpr = Math.min(devicePixelRatio || 1, maxDpr());
    const band = (TOUCH && G.hoverOnly && !inspected) ? playhead(stage) : null;
    const enc = device.createCommandEncoder(); let any = false;
    // pass 1: ease the rates, size the surfaces, pick the tiles that draw
    const eased = [];
    for (const t of tiles) {
      t.go = false; t.rect = null;
      if (t.pipeline && visible.has(t)) { const rect = t.canvas.getBoundingClientRect(); if (rect.width >= 1) t.rect = rect; }
      const focus = band !== null && !!t.rect && t.rect.top <= band && t.rect.bottom > band;
      if (focus !== !!t.focus) { t.focus = focus; t.el.classList.toggle('tm-live', focus); }
      const want = (!G.hoverOnly || t.hover || t.focus || inspected === t || (saver && saver.t === t)) ? 1 : 0;
      t.rate += (want - t.rate) * (1 - Math.exp(-dt / 0.18));
      t.moving = t.rate > 0.002;
      if (!t.pipeline) { if (t.moving) t.phase += dt * t.rate * (G.tempo || 1); continue; }
      if (t.rect) {
        // a resized surface has a new, empty cache, so a size change is a reason to draw on its own
        const resized = sizeSurf(t.surf, t.rect, dpr);
        if (t.dirty || globalDirty || resized || t.hover || t.focus || inspected === t) t.go = true;
        else if (t.moving) eased.push(t);
      }
      if (inspected === t) t.go = true;
    }
    eased.sort((a, b) => (a.lastDraw || 0) - (b.lastDraw || 0));
    for (let i = 0; i < eased.length && i < ANIM_CAP; i++) eased[i].go = true;
    // pass 2: advance the clocks of the tiles that draw, then draw
    for (const t of tiles) {
      if (!t.pipeline) continue;
      if (t.moving && (t.go || !t.rect || (saver && saver.t === t))) t.phase += dt * t.rate * (G.tempo || 1);
      if (inspected === t) { const r = msurf.canvas.getBoundingClientRect(); const rs = sizeSurf(msurf, r, dpr); if (t.moving || t.dirty || globalDirty || rs) { PAGE.draw(enc, t, msurf, r, dpr, dt, now, t.moving); any = true; } }
      if (saver && saver.t === t) { const r = saver.canvas.getBoundingClientRect(), sd = Math.min(devicePixelRatio || 1, saver.dpr); sizeSurf(saver.surf, r, sd); PAGE.draw(enc, t, saver.surf, r, sd, dt, now, true); any = true; }
      if (!t.go || !t.rect) continue;
      PAGE.draw(enc, t, t.surf, t.rect, dpr, dt, now, t.moving); t.dirty = false; t.lastDraw = frameNo; any = true;
    }
    globalDirty = false;
    if (any) activeUntil = now + HOLD;
    if (now <= activeUntil) {
      for (const t of tiles) if (t.rect) present(enc, t.surf);
      if (inspected) present(enc, msurf);
      if (saver) { present(enc, saver.surf); saverFade(enc); }
      device.queue.submit([enc.finish()]);
    }
  }
  function sizeSurf(surf, rect, dpr) {
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
    if (surf.cache && surf.canvas.width === w && surf.canvas.height === h) { surf.resized = false; return false; }
    surf.canvas.width = w; surf.canvas.height = h;
    if (surf.cache) surf.cache.destroy();
    surf.cache = device.createTexture({ size: [w, h], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING });
    surf.drawn = false; surf.resized = true; return true;
  }
  // Screensaver mode: one calm cell from spec.saver.cells (chosen by the
  // seed) draws into a full-window canvas. The stage is hidden, so no other
  // tile draws. The tempo generator is set flat at a speed from opts.calm
  // (1 = slowest). The shell reloads the page when the screensaver stops.
  // PAGE.init can return before the cell pipelines compile, so enter() waits
  // up to SAVER_WAIT_MS for the chosen cell, then takes any compiled cell.
  async function saverEnter(opts) {
    const cfg = SPEC.saver, calm = Math.min(1, Math.max(0, opts.calm ?? 0.7));
    const pool = tiles.filter(t => (cfg.cells || []).includes(t.s.name));
    const list = pool.length ? pool : tiles;
    let t = list[(opts.seed >>> 0) % list.length];
    for (const t0 = performance.now(); !t.pipeline && performance.now() - t0 < SAVER_WAIT_MS;) await new Promise(r => setTimeout(r, 100));
    if (!t.pipeline) t = list.find(x => x.pipeline) || tiles.find(x => x.pipeline);
    if (!t) throw new Error('no cell compiled');
    const tg = GENS.find(g => g.id === 'tempo');
    if (tg && cfg.tempo) {
      const want = cfg.tempo[0] + (cfg.tempo[1] - cfg.tempo[0]) * calm; let best = 0.5, err = Infinity;
      for (let i = 0; i <= 200; i++) { const e = Math.abs(tg.map(i / 200) - want); if (e < err) { err = e; best = i / 200; } }
      tg.fn = 'flat'; tg.bias = best;
    }
    for (const g of GENS) { const o = (cfg.gens || {})[g.id]; if (o) { Object.assign(g, o); if (o.period) g.period = o.period * (0.5 + calm); } }
    saverCell(t, opts);
    const style = document.createElement('style');
    style.textContent = `html.tbl-saver, html.tbl-saver body { background: #000 !important; overflow: hidden !important; cursor: none !important; }
html.tbl-saver body > :not(.tbl-saver-canvas) { display: none !important; }
.tbl-saver-canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; z-index: 2147483647; background: #000; }`;
    document.head.appendChild(style);
    const canvas = document.createElement('canvas'); canvas.className = 'tbl-saver-canvas';
    document.body.appendChild(canvas); document.documentElement.classList.add('tbl-saver');
    close();
    saver = { t, canvas, style, surf: makeSurface(canvas), dpr: cfg.dpr || 2, opts };
    saverLabel();
    if (typeof opts.label === 'function' && opts.labels !== false) saver.labelTimer = setInterval(saverLabel, 1000);
    if (cfg.cycle && list.length > 1) {
      // seeded order that starts at the first cell; fade pass: out = canvas * (1 - a)
      let r = (opts.seed >>> 0) || 1; const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
      const rest = list.filter(x => x !== t);
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      const fm = device.createShaderModule({ code: `@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0)); return vec4f(p[i], 0.0, 1.0); }
@fragment fn fs() -> @location(0) vec4f { return vec4f(0.0, 0.0, 0.0, 1.0); }` });
      Object.assign(saver, { opts, order: [t, ...rest], i: 0, t0: performance.now() / 1000, dim: 1, fadeS: cfg.fade || 1.2,
        per: Math.max(cfg.minDwell || 8, (+opts.seconds || 60) / cfg.cycle),
        fadePipe: device.createRenderPipeline({ layout: 'auto', vertex: { module: fm, entryPoint: 'vs' }, primitive: { topology: 'triangle-list' },
          fragment: { module: fm, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'zero', dstFactor: 'one-minus-constant' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] } }) });
    }
    return { canvas, warmupMs: cfg.warmup || 800 };
  }
  // the knobs and the page state for a cell that goes on in the saver
  function saverCell(t, opts) {
    (SPEC.saver.knobs || []).forEach((v, i) => { if (v !== null) t.knobs[i] = v; });
    if (PAGE.saver) PAGE.saver(t, opts);
  }
  // Cycle mode: at the end of a dwell the next compiled cell goes on. dim is
  // 1 at each end of a dwell and 0 in the middle, eased over fadeS seconds.
  function saverStep() {
    const s = saver, now = performance.now() / 1000;
    if (now - s.t0 >= s.per) {
      for (let k = 1; k < s.order.length; k++) {
        const j = (s.i + k) % s.order.length, c = s.order[j];
        if (!c.pipeline) continue;
        if (PAGE.leave) PAGE.leave(s.t);
        s.i = j; s.t = c; saverCell(c, s.opts); saverLabel(); break;
      }
      s.t0 = now;
    }
    const u = Math.min(now - s.t0, s.per - (now - s.t0)) / s.fadeS;
    s.dim = 1 - sstep(u);
  }
  // The plate for the saver cell: name, family, species, live knob and
  // generator values, and the equation (cell.eq, else spec.saver.eq[family]).
  // A second call with the same title swaps the text in place in the shell.
  function saverLabel() {
    const s = saver;
    if (!s || !s.opts || typeof s.opts.label !== 'function' || s.opts.labels === false) return;
    const c = s.t.s, eqs = c.eq || ((SPEC.saver.eq || {})[c.family]) || [];
    const knobs = c.knobs.map((k, i) => k ? `${k} ${s.t.knobs[i].toFixed(2)}` : '').filter(Boolean);
    const gens = GENS.map(g => `${String(g.title || g.id).split(' · ')[0].toLowerCase()} ${g.unit(G[g.id])}`);
    let info = {
      title: c.name.replace(/_/g, ' ').replace(/^./, m => m.toUpperCase()),
      sub: c.family,
      lines: [c.species, knobs.length ? 'knobs  ' + knobs.join(' · ') : '', gens.join(' · ')].filter(Boolean),
      eq: Array.isArray(eqs) ? eqs : [eqs],
    };
    if (PAGE.saverLabel) info = PAGE.saverLabel(s.t, info) || info;
    try { s.opts.label(info); } catch (_) {}
  }
  function saverFade(enc) {
    const s = saver, a = s.dim;
    if (!s.fadePipe || !s.surf.drawn || !(a > 0.001)) return;
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: s.surf.gpu.getCurrentTexture().createView(), loadOp: 'load', storeOp: 'store' }] });
    pass.setPipeline(s.fadePipe); pass.setBlendConstant({ r: a, g: a, b: a, a }); pass.draw(3); pass.end();
  }
  function saverExit() {
    if (!saver) return;
    clearInterval(saver.labelTimer);
    saver.canvas.remove(); saver.style.remove(); document.documentElement.classList.remove('tbl-saver'); saver = null;
  }
  requestAnimationFrame(frame);
}
