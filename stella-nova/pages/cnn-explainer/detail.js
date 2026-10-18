// ============================================================================
//  CNN EXPLAINER  ·  detail.js  the detail view: one map, animated
// ----------------------------------------------------------------------------
//  The detail view opens when the reader clicks a feature map or the output.
//  It plays a scene of scenes.js on #detailCv: the scan goes over the map at
//  a calm speed (the reader can change it, pause, step, or click a cell of
//  the output map to jump there). On a desktop it is a card over the
//  network; on a phone it is a bottom sheet (style.css PHONE).
//
//  The TeX line over the canvas is MathJax SVG (lib/sci-math.js). The
//  #detailLive line speaks the current step when the scan pauses or steps.
//
//  grep -n 'export function createDetail'
//  grep -n 'const TEX'       the formula of each layer type
//  grep -n 'const WORDS'     the plain-language text of each layer type
//  grep -n 'function frame'  the animation loop
// ============================================================================
import { ARCH } from './net.js';
import { makeScene } from './scenes.js';
import { typeset } from '../../lib/sci-math.js';

const TEX = {
  input: 'x = \\frac{\\text{pixel value}}{255}',
  conv: 'z_{y,x} = \\sum_{c} \\sum_{i=0}^{2} \\sum_{j=0}^{2} \\class{m1}{a_{c,\\,y+i,\\,x+j}} \\, \\class{m2}{w_{c,i,j}} + \\class{m3}{b}',
  relu: '\\mathrm{ReLU}(x) = \\max(0,\\, x)',
  pool: 'y = \\max\\left(x_{1},\\, x_{2},\\, x_{3},\\, x_{4}\\right)',
  dense: '\\class{m1}{z_k} = \\sum_{i=1}^{1690} a_i\\, w_{i,k} + b_k \\qquad p_k = \\frac{e^{\\class{m1}{z_k}}}{\\sum_{j=1}^{10} e^{\\class{m1}{z_j}}}',
};

const WORDS = {
  input: 'A colour picture is three grids of numbers, one each for red, green and blue. The network divides each value by 255, so every number is between 0 and 1.',
  conv: 'A kernel is a 3 × 3 grid of learned weights for each input map. At each position the network multiplies the window under the kernel by the kernel, value by value, and adds the nine products. It does this for every input map, adds the results and adds a bias. That one number is one cell of the output map. Click a small map or a chip to see another input channel; click the output map to jump.',
  relu: 'ReLU looks at one number at a time. A negative value becomes 0; a positive value passes as it is. Without this bend, any stack of convolutions would be one big linear filter.',
  pool: 'Max pooling cuts the map into 2 × 2 tiles and keeps the largest value of each tile. The map is half as wide and half as tall, and a strong response survives even if it moves by a pixel.',
  dense: 'The last ten maps are read out in a row: 1690 numbers. For each class the network multiplies every number by a weight of that class and adds them up: a score. Softmax turns the ten scores into probabilities that add up to 1; a larger score gets a much larger share. Click a class to see its weights.',
};

export function createDetail({ doc = document, win = window, page }) {
  const $ = id => doc.getElementById(id);
  const el = $('detail'), cv = $('detailCv'), g = cv.getContext('2d');
  const ui = { title: $('detailTitle'), sub: $('detailSub'), math: $('detailMath'), text: $('detailText'), live: $('detailLive'),
    play: $('dPlay'), prev: $('dPrev'), next: $('dNext'), speed: $('dSpeed'), speedVal: $('dSpeedVal'), close: $('dClose'), pos: $('dPos') };
  const st = { open: false, scene: null, spec: null, t: 0, playing: true, raf: 0, last: 0, hits: [], speed: 6, sayAt: 0 };

  const speedOf = v => 1.5 * Math.pow(10, v / 40);   // slider 0..100 -> 1.5 .. 474 positions per second
  function readSpeed() { st.speed = speedOf(+ui.speed.value); ui.speedVal.textContent = st.speed < 10 ? st.speed.toFixed(1) + '/s' : Math.round(st.speed) + '/s'; }

  function setPlaying(on) {
    st.playing = on;
    ui.play.textContent = on ? '❚❚' : '▶';
    ui.play.setAttribute('aria-label', on ? 'Pause' : 'Play');
    if (!on) say(true);
  }
  function say(now) {
    if (!st.scene || !ui.live) return;
    const p = st.scene.count ? Math.floor(st.t) % st.scene.count : 0;
    const txt = st.scene.say(p);
    if (now) ui.live.textContent = txt;
    if (ui.pos) ui.pos.textContent = st.scene.count ? `${p + 1} / ${st.scene.count}` : '';
  }

  function open(spec) {
    const ctx = page.sceneContext(spec);
    if (!ctx) return;
    st.spec = spec;
    st.scene = makeScene(ctx);
    const n = st.scene.n || 1;
    st.t = st.scene.count && spec.gy != null ? Math.min(st.scene.count - 1, spec.gy * n + spec.gx) : 0;
    const type = st.scene.kind;
    ui.title.textContent = st.scene.title;
    ui.sub.textContent = st.scene.sub;
    ui.text.textContent = WORDS[type] || '';
    typeset(ui.math, TEX[type] || '', { display: true }).catch(() => {});
    const posRow = !!st.scene.count;
    [ui.prev, ui.next, ui.speed, ui.speedVal, ui.pos].forEach(e => { if (e) e.hidden = !posRow; });
    if (ui.speed && ui.speed.parentElement && ui.speed.parentElement.classList.contains('d-speed')) ui.speed.parentElement.hidden = !posRow;
    el.hidden = false; el.dataset.kind = type;
    doc.body.classList.add('detail-open');
    st.open = true;
    setPlaying(true);
    say(false);
    if (!st.raf) { st.last = 0; st.raf = win.requestAnimationFrame(frame); }
    page.onDetail && page.onDetail(spec);
  }

  function close() {
    if (!st.open) return;
    st.open = false; el.hidden = true; doc.body.classList.remove('detail-open');
    if (st.raf) win.cancelAnimationFrame(st.raf); st.raf = 0;
    page.onDetail && page.onDetail(null);
  }

  function size() {
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    const w = Math.max(10, cv.clientWidth || 640), h = Math.max(10, cv.clientHeight || 360);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    return { w, h, dpr };
  }

  function draw() {
    if (!g || !st.scene) return;
    const { w, h, dpr } = size();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (st.scene.st) st.scene.st.hold = st.speed > 4;
    try { st.hits = st.scene.draw(g, w, h, st.t) || []; } catch (e) { st.hits = []; if (!st.warned) { st.warned = true; console.warn('cnn-explainer: detail frame', e); } }
  }

  function frame(now) {
    st.raf = 0;
    if (!st.open) return;
    const dt = st.last ? Math.min(0.1, (now - st.last) / 1000) : 0; st.last = now;
    if (st.playing && !page.reducedMotion()) {
      if (st.scene.count) {
        st.t += dt * st.speed;
        if (st.t >= st.scene.count) st.t = 0;
      } else st.t = (st.t + dt / 10) % 1;
      if (now - st.sayAt > 400) { st.sayAt = now; say(false); }
    } else if (st.playing && page.reducedMotion()) {
      // reduced motion: jump a cell at a time, no glide
      if (st.scene.count) { st.t = Math.floor(st.t + dt * Math.min(st.speed, 4)); if (st.t >= st.scene.count) st.t = 0; }
      else st.t = 0.99;
    }
    draw();
    st.raf = win.requestAnimationFrame(frame);
  }

  function step(d) {
    if (!st.scene) return;
    setPlaying(false);
    if (st.scene.count) st.t = (Math.floor(st.t) + d + st.scene.count) % st.scene.count;
    else st.t = d > 0 ? 0.99 : 0;
    say(true); draw();
  }

  ui.play.addEventListener('click', () => setPlaying(!st.playing));
  ui.prev && ui.prev.addEventListener('click', () => step(-1));
  ui.next && ui.next.addEventListener('click', () => step(1));
  ui.close.addEventListener('click', () => { close(); page.focusOverview && page.focusOverview(); });
  ui.speed && ui.speed.addEventListener('input', readSpeed);
  readSpeed();
  cv.addEventListener('click', e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = st.hits.find(q => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
    if (!hit || !st.scene) return;
    if (hit.kind === 'out') { st.t = Math.floor((y - hit.y) / hit.h * hit.n) * hit.n + Math.floor((x - hit.x) / hit.w * hit.n); setPlaying(false); say(true); }
    else if (hit.kind === 'chan') { st.scene.st.ci = hit.ci; st.scene.st.auto = false; }
    else if (hit.kind === 'class') { st.scene.st.k = hit.k; st.t = 0; setPlaying(true); }
    draw();
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); page.focusOverview && page.focusOverview(); }
    else if (e.key === ' ' && e.target === cv) { e.preventDefault(); setPlaying(!st.playing); }
    else if (e.key === 'ArrowRight' && e.target === cv) { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' && e.target === cv) { e.preventDefault(); step(-1); }
  });

  return {
    open, close, step, draw, setPlaying,
    get isOpen() { return st.open; }, get spec() { return st.spec; }, get t() { return st.t; }, set t(v) { st.t = v; },
    get scene() { return st.scene; },
    // after a new picture: the same map, new numbers
    refresh() { if (st.open && st.spec) { const t = st.t, p = st.playing; open(st.spec); st.t = t; setPlaying(p); } },
  };
}

export { TEX, WORDS, ARCH };
