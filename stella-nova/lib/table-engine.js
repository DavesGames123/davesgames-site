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
// ============================================================================
export async function bootTable(PAGE, data) {
  const SPEC = data.spec;
  const STYLES = SPEC.cells;
  const PACK = data.pack || '';
  const $ = id => document.getElementById(id);
  const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const sstep = x => { const t = Math.min(Math.max(x, 0), 1); return t * t * (3 - 2 * t); };
  const G = { hoverOnly: true, tempo: 1 };
  for (const sw of SPEC.swatches) G[sw.id] = hexToRgb(sw.hex);

  // ---------------------------------------------------------- table sizing
  const COLS = SPEC.cols; const stage = $('stage');
  function fit() { const w = stage.clientWidth - 24; document.documentElement.style.setProperty('--cell', Math.max(40, Math.floor(w / COLS)) + 'px'); }
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
  $('hoveronly').addEventListener('click', () => { G.hoverOnly = !G.hoverOnly; setChip('hoveronly', G.hoverOnly); $('hoveronly').textContent = G.hoverOnly ? '◉ animate on hover only' : '◉ animate everything'; });

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
  { const mc = $('m-orb'); let md = null;
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
  if (!navigator.gpu) { $('nogpu').hidden = false; $('fps').textContent = 'no WebGPU'; (function loop() { requestAnimationFrame(loop); tickSignals(); })(); return; }
  let device;
  try { const adapter = await navigator.gpu.requestAdapter(); device = await adapter.requestDevice(); }
  catch (e) { $('nogpu').hidden = false; $('fps').textContent = 'no WebGPU device'; return; }
  // The tab shell swaps pages by removing this iframe. Removal fires pagehide,
  // so a handler here releases the device and stops the loop. Without it every
  // swap orphans a live device and the renderer runs out of GPU memory.
  let torn = false;
  const teardown = () => { if (torn) return; torn = true; try { device.destroy(); } catch (_) {} };
  addEventListener('pagehide', teardown);
  const format = navigator.gpu.getPreferredCanvasFormat();
  function makeSurface(canvas) {
    const ctx = canvas.getContext('webgpu'); ctx.configure({ device, format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING });
    const buf = device.createBuffer({ size: SPEC.uniform_bytes, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    return { canvas, ctx, buf, data: new Float32Array(SPEC.uniform_bytes / 4), w: 0, h: 0, page: {} };
  }
  for (const t of tiles) t.surf = makeSurface(t.canvas);
  const msurf = makeSurface($('m-orb'));
  const ctx = { device, format, tiles, G, PACK, STYLES, $, sstep, makeSurface, msurf, fnSource, fnSourceFrom, indexFns, highlight, setStatus: (t, msg, err) => { t.status.textContent = msg; t.status.classList.toggle('err', !!err); }, markAllDirty: () => { for (const t of tiles) t.dirty = true; }, inspected: () => inspected, sigTime: () => sigT };
  Object.assign(ctx, data.aux || {});
  try { await PAGE.init(ctx); } catch (e) { $('fps').textContent = 'init failed: ' + String(e.message || e).slice(0, 80); console.error(e); return; }

  // ---------------------------------------------------------- frame loop
  // ANIM_CAP bounds how many tiles run the animated redraw in one frame. A
  // mouse sweep leaves many tiles easing out at once. Each tile owns its own
  // canvas, so an overrun frame lets neighbours present out of step, which
  // reads as flicker. Hovered and inspected tiles always draw; the easing-out
  // overflow holds its last frame until the budget frees.
  const ANIM_CAP = 12;
  let fpsT = 0, frames = 0;
  function frame() {
    if (torn) return;
    requestAnimationFrame(frame);
    const dt = tickSignals(); const now = sigT;
    let animBudget = ANIM_CAP;
    frames++; if (now - fpsT > 1) { $('fps').textContent = `${Math.round(frames / (now - fpsT))} FPS · ${tiles.filter(t => t.pipeline).length}/${tiles.length}`; fpsT = now; frames = 0; }
    if (PAGE.tick) { if (PAGE.tick(dt, now) === true) globalDirty = true; }
    const dpr = Math.min(devicePixelRatio || 1, 3);
    const enc = device.createCommandEncoder(); let any = false;
    for (const t of tiles) {
      const want = (!G.hoverOnly || t.hover || inspected === t) ? 1 : 0;
      t.rate += (want - t.rate) * (1 - Math.exp(-dt / 0.18));
      const moving = t.rate > 0.002;
      if (moving) t.phase += dt * t.rate * (G.tempo || 1);
      if (!t.pipeline) continue;
      if (inspected === t) { const r = msurf.canvas.getBoundingClientRect(); const rs = sizeSurf(msurf, r, dpr); if (moving || t.dirty || globalDirty || rs) { PAGE.draw(enc, t, msurf, r, dpr, dt, now, moving); any = true; } }
      if (!visible.has(t)) continue;
      const rect = t.canvas.getBoundingClientRect(); if (rect.width < 1) continue;
      // a resized canvas comes back blank, so a size change is a reason to draw on its own
      const resized = sizeSurf(t.surf, rect, dpr);
      const mustDraw = t.dirty || globalDirty || resized;
      if (!mustDraw) {
        if (!moving) continue;
        const priority = t.hover || inspected === t;   // what the pointer is on draws every frame
        if (!priority) { if (animBudget <= 0) continue; animBudget--; }
      }
      PAGE.draw(enc, t, t.surf, rect, dpr, dt, now, moving); t.dirty = false; any = true;
    }
    globalDirty = false;
    if (any) device.queue.submit([enc.finish()]);
  }
  function sizeSurf(surf, rect, dpr) {
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
    if (surf.canvas.width !== w || surf.canvas.height !== h) { surf.canvas.width = w; surf.canvas.height = h; surf.resized = true; return true; }
    surf.resized = false; return false;
  }
  requestAnimationFrame(frame);
}
