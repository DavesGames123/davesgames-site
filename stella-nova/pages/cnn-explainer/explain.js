// ============================================================================
//  CNN EXPLAINER  ·  explain.js  the explainer column and its widgets
// ----------------------------------------------------------------------------
//  Fills #learn with the walk through the network, step by step, in plain
//  words. The guided run (tour.js) lights the step it plays (mark) and
//  scrolls the column to it. Each step has a "Show me" button that moves
//  the run to that layer (page.jumpTo). Two small widgets:
//    kernel playground   input size, kernel size, stride and padding on a
//                        small grid; the kernel slides and the output fills
//                        in; o = floor((n + 2p - k) / s) + 1 with numbers
//    activation picker   ReLU, leaky ReLU, sigmoid, tanh or none: the curve,
//                        and one real map of Conv 1·1 before and after
//  The maths of both widgets is in playground.js (node tests).
//
//  grep -n 'export function createExplain'
//  grep -n 'function mark'           light a step and scroll to it
//  grep -n 'const SECTIONS'          the text of each step
//  grep -n 'function mountPlayground'
//  grep -n 'function mountActivation'
// ============================================================================
import { playSize, tinyConv, demoInput, edgeKernel, ACTIVATIONS, ACTIVATION_IDS } from './playground.js';
import { SOURCE } from './data.js';
import { paintMap } from './colour.js';
import { THEME as T, roundRect } from './draw.js';
import { typeset } from '../../lib/sci-math.js';

const SECTIONS = [
  { id: 'intro', h: 'What you are looking at', body: [
    'This is a small convolutional neural network (CNN) that runs in your browser. It looks at a 64 × 64 picture and says which of ten things it shows: a lifeboat, a ladybug, a pizza, a bell pepper, a school bus, a koala, an espresso, a red panda, an orange or a sport car.',
    'Each square on the right is a feature map: a grid of numbers that one part of the network computed, drawn as colour. The picture goes in at the left and the answer comes out at the right. The run plays the network one layer at a time and opens a few maps to show the maths. Pause it, step it, or click any map to zoom in.',
  ], show: null },
  { id: 'input', h: '1 · The picture is numbers', body: [
    'A colour picture is three grids: red, green and blue. Each cell holds a value from 0 to 255, which the network divides by 255. So the input is 64 × 64 × 3 = 12,288 numbers between 0 and 1.',
  ], show: { li: 0, c: -1, label: 'Show the pixels' } },
  { id: 'conv', h: '2 · Convolution: a small filter slides', body: [
    'A kernel is a 3 × 3 grid of weights that the network learned in training. It slides over the input one step at a time. At each step it multiplies the nine values under it by its nine weights and adds them up. A layer has one kernel for each input map, and it adds all their sums and a bias: that is one cell of one output map.',
    'Ten different kernels make ten output maps. Each one answers to a different pattern: an edge in one direction, a patch of one colour, a texture.',
  ], widget: 'playground', show: { li: 1, c: 0, label: 'Show Conv 1·1' } },
  { id: 'relu', h: '3 · ReLU: keep what fires', body: [
    'After each convolution, ReLU sets every negative value to zero and keeps every positive value. This bend is what lets a stack of layers learn shapes that no single filter can describe.',
  ], widget: 'activation', show: { li: 2, c: 0, label: 'Show ReLU 1·1' } },
  { id: 'pool', h: '4 · Max pooling: shrink, keep the strongest', body: [
    'Max pooling cuts each map into 2 × 2 tiles and keeps the largest value of each tile. The map gets half as wide and half as tall. The network keeps that a pattern is there and cares less about where exactly it is.',
  ], show: { li: 5, c: 0, label: 'Show Max pool 1' } },
  { id: 'deep', h: '5 · Deeper layers see more', body: [
    'A cell of Conv 1·1 sees a 3 × 3 patch of the picture, a cell of Conv 1·2 sees 5 × 5 and a cell of Max pool 1 sees 6 × 6. Conv 2·1 sees 10 × 10, and a cell of the last pooled map sees 16 × 16 pixels: a quarter of the width of the picture. Point at a cell of any map: the yellow squares show which values feed it, down to the picture.',
    'This network has two blocks of conv, ReLU, conv, ReLU and pooling. Its design is Tiny VGG, a small copy of the VGG networks.',
  ], show: { li: 6, c: 0, label: 'Show Conv 2·1' } },
  { id: 'out', h: '6 · Flatten, score and softmax', body: [
    'The ten last maps (13 × 13 each) are read out in one row of 1690 numbers. Each class has 1690 weights and a bias; the score of a class is the sum of each number times its weight, plus the bias. Softmax turns the ten scores into probabilities:',
  ], tex: 'p_k = \\frac{e^{z_k}}{\\sum_{j=1}^{10} e^{z_j}}', after: 'The exponential makes every value positive and makes the largest score win by a wide margin. The ten values add up to 1.', show: { li: 11, c: null, label: 'Show the output' } },
  { id: 'try', h: '7 · Try your own picture', body: [
    'Use the photo buttons above the network: pick a file or take a picture with your camera. The page crops the centre square and shrinks it to 64 × 64. Your picture stays in your browser.',
    'The network knows only ten classes and saw only small 64 × 64 photos in training, so it is often wrong, and it always picks one of its ten classes, even for a cat. The example photos on this page are ones it gets right.',
  ], show: null },
];

export function createExplain({ doc = document, win = window, host, page }) {
  host.textContent = '';
  const make = (tag, cls, txt) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const head = make('header', 'ex-head');
  head.appendChild(make('h2', 'ex-title', 'How a CNN sees a picture'));
  const cite = make('p', 'ex-cite');
  cite.innerHTML = `After <a href="${SOURCE.repo}" target="_blank" rel="noopener">CNN Explainer</a> by Wang, Turko, Shaikh, Park, Das, Hohman, Kahng and Chau (<a href="${SOURCE.doi}" target="_blank" rel="noopener">IEEE VIS 2020</a>). Their trained network, our own page.`;
  head.appendChild(cite);
  host.appendChild(head);
  const widgets = {};
  for (const s of SECTIONS) {
    const sec = make('section', 'ex-sec'); sec.id = 'ex-' + s.id;
    sec.appendChild(make('h3', 'ex-h', s.h));
    for (const p of s.body) sec.appendChild(make('p', 'ex-p', p));
    if (s.tex) { const m = make('div', 'sci-eq ex-eq'); m.dataset.tex = s.tex; sec.appendChild(m); typeset(m, s.tex).catch(() => {}); }
    if (s.after) sec.appendChild(make('p', 'ex-p', s.after));
    if (s.widget === 'playground') widgets.playground = mountPlayground(sec, { doc, win, page });
    if (s.widget === 'activation') widgets.activation = mountActivation(sec, { doc, win, page });
    if (s.show) {
      const b = make('button', 'ex-show', s.show.label); b.type = 'button';
      b.dataset.li = s.show.li;
      b.addEventListener('click', () => (page.jumpTo ? page.jumpTo(s.show.li) : page.openDetail({ li: s.show.li, c: s.show.c })));
      sec.appendChild(b);
    }
    host.appendChild(sec);
  }
  const foot = make('section', 'ex-sec ex-foot');
  const cb = make('button', 'ex-show ghost-btn', 'Credits and licences'); cb.type = 'button';
  cb.addEventListener('click', () => page.openCredits());
  foot.appendChild(cb);
  host.appendChild(foot);
  // light the step with id and scroll the column to it (unless the reader
  // scrolled the column in the last 5 s)
  const scroller = host.closest ? host.closest('#learn') || host : host;
  const st = { current: '', lastScroll: null, userAt: -1e9 };
  const now = () => (win.performance ? win.performance.now() : Date.now());
  for (const ev of ['wheel', 'touchmove']) scroller.addEventListener(ev, () => { st.userAt = now(); }, { passive: true });
  function mark(id, { smooth = true, scroll = true } = {}) {
    for (const sec of host.querySelectorAll('.ex-sec')) {
      const on = sec.id === 'ex-' + id;
      sec.classList.toggle('on', on);
      if (on) sec.setAttribute('aria-current', 'step'); else sec.removeAttribute('aria-current');
    }
    if (id === st.current) return;
    st.current = id;
    const sec = host.querySelector('#ex-' + id);
    if (!sec || !scroll || now() - st.userAt < 5000) return;
    const top = Math.max(0, (sec.offsetTop || 0) - 14);
    st.lastScroll = { id, top, behavior: smooth ? 'smooth' : 'auto' };
    if (scroller.scrollTo) { try { scroller.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' }); } catch (e) { scroller.scrollTop = top; } }
    else scroller.scrollTop = top;
  }
  return { widgets, mark, st, refresh() { widgets.activation && widgets.activation.draw(); } };
}

// ── kernel playground ──────────────────────────────────────────────────────
function mountPlayground(sec, { doc, win, page }) {
  const box = doc.createElement('div'); box.className = 'ex-widget pg';
  box.innerHTML = `
    <div class="w-title">Kernel playground</div>
    <canvas class="pg-cv" aria-label="A small input grid, the kernel window and the output grid"></canvas>
    <div class="pg-ctl">
      <label class="sl"><span>Input <b class="pg-n"></b></span><input type="range" min="4" max="9" step="1" value="7" data-k="n" aria-label="Input size"></label>
      <label class="sl"><span>Kernel <b class="pg-k"></b></span><input type="range" min="1" max="5" step="1" value="3" data-k="k" aria-label="Kernel size"></label>
      <label class="sl"><span>Stride <b class="pg-s"></b></span><input type="range" min="1" max="3" step="1" value="1" data-k="s" aria-label="Stride"></label>
      <label class="sl"><span>Padding <b class="pg-p"></b></span><input type="range" min="0" max="2" step="1" value="0" data-k="p" aria-label="Padding"></label>
    </div>
    <div class="sci-eq pg-eq" aria-live="polite"></div>
    <p class="pg-note" aria-live="polite"></p>`;
  sec.appendChild(box);
  const cv = box.querySelector('canvas'), g = cv.getContext('2d');
  const st = { n: 7, k: 3, s: 1, p: 0, t: 0, raf: 0, last: 0, conv: null, visible: true };
  const eq = box.querySelector('.pg-eq'), note = box.querySelector('.pg-note');
  function rebuild() {
    for (const inp of box.querySelectorAll('input[type=range]')) st[inp.dataset.k] = +inp.value;
    for (const k of ['n', 'k', 's', 'p']) box.querySelector('.pg-' + k).textContent = st[k];
    const sz = playSize(st.n, st.k, st.s, st.p);
    st.grid = demoInput(st.n); st.ker = edgeKernel(st.k);
    st.conv = sz.valid ? tinyConv(st.grid, st.n, st.ker, st.k, st.s, st.p) : null;
    st.t = 0;
    const tex = `o = \\left\\lfloor \\frac{${st.n} + 2 \\cdot ${st.p} - ${st.k}}{${st.s}} \\right\\rfloor + 1 = ${sz.valid ? sz.o : '\\text{none}'}`;
    typeset(eq, tex).catch(() => {});
    note.textContent = !sz.valid ? 'The kernel is larger than the padded input, so there is no output.'
      : !sz.exact ? `The stride does not fit: the last ${sz.span % st.s} row${sz.span % st.s > 1 ? 's' : ''} and column${sz.span % st.s > 1 ? 's' : ''} of the padded input are never under the kernel.`
      : st.p > 0 ? `Padding adds a border of zeros, so the edge cells are seen as often as the middle. Output ${sz.o} × ${sz.o}.`
      : `Output ${sz.o} × ${sz.o}. This network uses kernel 3, stride 1 and no padding, so each convolution loses one cell on each side.`;
    draw();
  }
  function draw() {
    if (!g) return;
    const dpr = Math.min(2, win.devicePixelRatio || 1), w = Math.max(200, cv.clientWidth || 320), h = Math.round(w * 0.5);
    if (cv.width !== Math.round(w * dpr)) cv.width = Math.round(w * dpr);
    if (cv.height !== Math.round(h * dpr)) cv.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const N = st.n + 2 * st.p, cs = Math.min((w * 0.56 - 8) / N, (h - 24) / N), ox = 4, oy = 18;
    g.font = `400 11px ${T.sans}`; g.fillStyle = T.dim; g.textAlign = 'left';
    g.fillText('Input' + (st.p ? ' + padding' : ''), ox, 12);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const iy = y - st.p, ix = x - st.p, inside = iy >= 0 && iy < st.n && ix >= 0 && ix < st.n;
      const v = inside ? st.grid[iy * st.n + ix] : 0;
      g.fillStyle = inside ? `rgba(230,233,240,${0.06 + 0.5 * v})` : 'rgba(255,255,255,0.02)';
      g.fillRect(ox + x * cs + 1, oy + y * cs + 1, cs - 2, cs - 2);
      if (!inside) { g.strokeStyle = 'rgba(255,255,255,0.07)'; g.setLineDash([2, 2]); g.strokeRect(ox + x * cs + 1.5, oy + y * cs + 1.5, cs - 3, cs - 3); g.setLineDash([]); }
    }
    const C = st.conv;
    if (C && C.windows.length) {
      const i = Math.floor(st.t) % C.windows.length, wdw = C.windows[i];
      g.strokeStyle = T.field; g.lineWidth = 2;
      g.strokeRect(ox + wdw.px * cs + 1, oy + wdw.py * cs + 1, st.k * cs - 2, st.k * cs - 2);
      // output grid
      const ocs = Math.min((w * 0.42 - 8) / C.o, (h - 24) / C.o, cs * 1.4), ox2 = w - C.o * ocs - 4;
      g.fillStyle = T.dim; g.textAlign = 'left'; g.fillText(`Output ${C.o} × ${C.o}`, ox2, 12);
      let m = 1e-6; for (const v of C.out) m = Math.max(m, Math.abs(v));
      for (let j = 0; j < C.out.length; j++) {
        const x = j % C.o, y = Math.floor(j / C.o), done = j <= i;
        const v = C.out[j];
        g.fillStyle = !done ? 'rgba(255,255,255,0.03)' : v >= 0 ? `rgba(98,196,255,${0.12 + 0.6 * v / m})` : `rgba(255,154,98,${0.12 + 0.6 * -v / m})`;
        g.fillRect(ox2 + x * ocs + 1, oy + y * ocs + 1, ocs - 2, ocs - 2);
        if (j === i) { g.strokeStyle = T.accent; g.lineWidth = 2; g.strokeRect(ox2 + x * ocs + 1, oy + y * ocs + 1, ocs - 2, ocs - 2); }
        if (done && ocs >= 22) { g.fillStyle = T.ink; g.textAlign = 'center'; g.font = `400 ${Math.min(11, ocs * 0.34)}px ${T.mono}`; g.fillText((v < 0 ? '−' : '') + Math.abs(v).toFixed(1), ox2 + (x + 0.5) * ocs, oy + (y + 0.5) * ocs + 4); g.font = `400 11px ${T.sans}`; }
      }
    }
  }
  function frame(now) {
    st.raf = 0;
    const dt = st.last ? Math.min(0.1, (now - st.last) / 1000) : 0; st.last = now;
    if (st.conv && !page.reducedMotion() && st.visible) {
      const prev = Math.floor(st.t); st.t += dt * 1.6;
      if (st.t >= st.conv.windows.length + 1.5) st.t = 0;
      if (Math.floor(st.t) !== prev) draw();
    }
    st.raf = win.requestAnimationFrame(frame);
  }
  box.addEventListener('input', rebuild);
  if ('IntersectionObserver' in win) new win.IntersectionObserver(es => { st.visible = es.some(e => e.isIntersecting); }).observe(box);
  rebuild();
  st.raf = win.requestAnimationFrame(frame);
  return { draw, rebuild, st };
}

// ── activation picker ──────────────────────────────────────────────────────
function mountActivation(sec, { doc, win, page }) {
  const box = doc.createElement('div'); box.className = 'ex-widget act';
  box.innerHTML = `
    <div class="w-title">Activation picker</div>
    <div class="seg act-seg" role="radiogroup" aria-label="Activation function"></div>
    <div class="act-row">
      <canvas class="act-plot" aria-label="The curve of the activation"></canvas>
      <figure><canvas class="act-map" data-w="before"></canvas><figcaption>Conv 1·1 map, before</figcaption></figure>
      <figure><canvas class="act-map" data-w="after"></canvas><figcaption>after <span class="act-name"></span></figcaption></figure>
    </div>
    <div class="sci-eq act-eq"></div>
    <p class="act-note"></p>`;
  sec.appendChild(box);
  const seg = box.querySelector('.act-seg');
  const st = { id: 'relu' };
  const btns = ACTIVATION_IDS.map(id => {
    const b = doc.createElement('button'); b.type = 'button'; b.textContent = ACTIVATIONS[id].label;
    b.setAttribute('role', 'radio'); b.dataset.id = id;
    b.addEventListener('click', () => { st.id = id; draw(); });
    seg.appendChild(b); return b;
  });
  const plot = box.querySelector('.act-plot'), mb = box.querySelector('[data-w=before]'), ma = box.querySelector('[data-w=after]');
  function draw() {
    const A = ACTIVATIONS[st.id];
    btns.forEach(b => { const on = b.dataset.id === st.id; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    box.querySelector('.act-name').textContent = A.label;
    box.querySelector('.act-note').textContent = A.note;
    typeset(box.querySelector('.act-eq'), A.tex).catch(() => {});
    const g = plot.getContext('2d');
    if (g) {
      const dpr = Math.min(2, win.devicePixelRatio || 1), s = 96;
      plot.width = s * dpr; plot.height = s * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, s, s);
      const X = x => (x + 3) / 6 * s, Y = y => s / 2 - y / 6 * s;
      g.strokeStyle = T.line; g.lineWidth = 1; g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke();
      g.strokeStyle = T.pos; g.lineWidth = 2; g.beginPath();
      for (let i = 0; i <= 60; i++) { const x = -3 + i / 10; const y = A.f(x); i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)); }
      g.stroke();
    }
    // one real map of conv 1·1 (the one with the most negative values), before and after
    const res = page.result && page.result();
    const maps = page.maps && page.maps();
    if (!res || !maps) return;
    const L = res.layers[1];
    let best = 0, bestNeg = -1;
    for (let c = 0; c < L.C; c++) { let neg = 0; for (let i = 0; i < L.H * L.W; i++) if (L.data[i * L.C + c] < 0) neg++; if (neg > bestNeg && neg < L.H * L.W * 0.9) { bestNeg = neg; best = c; } }
    const before = { H: L.H, W: L.W, C: 1, data: new Float32Array(L.H * L.W) };
    for (let i = 0; i < L.H * L.W; i++) before.data[i] = L.data[i * L.C + best];
    const after = { H: L.H, W: L.W, C: 1, data: before.data.map(A.f) };
    let lo = Infinity, hi = -Infinity;
    for (const d of [before.data, after.data]) for (const v of d) { if (v < lo) lo = v; if (v > hi) hi = v; }
    for (const [cv, Lm] of [[mb, before], [ma, after]]) {
      cv.width = L.W; cv.height = L.H;
      const c2 = cv.getContext('2d'); if (!c2) continue;
      const id = c2.createImageData(L.W, L.H); paintMap(Lm, 0, lo, hi, maps.st.lut, id.data); c2.putImageData(id, 0, 0);
    }
  }
  draw();
  return { draw, st };
}

export { SECTIONS, roundRect };
