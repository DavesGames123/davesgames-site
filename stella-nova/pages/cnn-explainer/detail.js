// ============================================================================
//  CNN EXPLAINER  ·  detail.js  the zoom panel: one map, animated
// ----------------------------------------------------------------------------
//  The zoom panel (#detail) sits inside #netWrap, over the column (desktop)
//  or the block (phone) that the overview opens for it. main.js puts it in
//  place each frame (place): the panel has its final size, and a CSS
//  transform makes it grow out of the map it shows and shrink back into
//  it. The tile canvas (#detailTile) shows that map while the panel is
//  small, then the scene fades in over it.
//
//  The panel plays a scene of scenes.js on #detailCv. Two modes:
//    tour   the guided run owns the panel: main.js sets t from the run
//           clock (tour.js scanAt); the footer is hidden
//    user   the reader opened a map: the scan plays at the speed of the
//           slider, with pause, step, and a click on a cell to jump
//  A click or a step in tour mode tells main.js (page.detailTouched), which
//  makes the zoom a user zoom: the run waits until the reader closes it.
//
//  This module has no animation loop of its own. main.js calls tick(dt)
//  and draw() from its one frame loop.
//
//  The TeX line over the canvas is MathJax SVG (lib/sci-math.js). The
//  #detailLive line speaks the current step when the scan pauses or steps.
//
//  grep -n 'export function createDetail'
//  grep -n 'const TEX'       the formula of each layer type
//  grep -n 'const WORDS'     the plain-language text of each layer type
//  grep -n 'function tick'   the scan in user mode
//  grep -n 'function place'  the panel geometry and the grow transform
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

const ease = k => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };

export function createDetail({ doc = document, win = window, page }) {
  const $ = id => doc.getElementById(id);
  const el = $('detail'), cv = $('detailCv'), g = cv.getContext('2d'), tile = $('detailTile');
  const ui = { title: $('detailTitle'), sub: $('detailSub'), math: $('detailMath'), text: $('detailText'), live: $('detailLive'),
    play: $('dPlay'), prev: $('dPrev'), next: $('dNext'), speed: $('dSpeed'), speedVal: $('dSpeedVal'), close: $('dClose'), pos: $('dPos') };
  const st = { open: false, scene: null, spec: null, t: 0, playing: true, hits: [], speed: 6, sayAt: 0, acc: 0, mode: 'user', kind: '' };

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

  // spec = { li, c, gy, gx }; mode 'tour' or 'user'
  function open(spec, { mode = 'user', start = null } = {}) {
    const ctx = page.sceneContext(spec);
    if (!ctx) return;
    st.spec = spec; st.mode = mode;
    st.scene = makeScene(ctx);
    const n = st.scene.n || 1;
    st.t = start != null ? start : st.scene.count && spec.gy != null ? Math.min(st.scene.count - 1, spec.gy * n + spec.gx) : 0;
    st.acc = 0;
    const type = st.scene.kind;
    ui.title.textContent = st.scene.title;
    ui.sub.textContent = st.scene.sub;
    ui.text.textContent = WORDS[type] || '';
    if (type !== st.kind || !ui.math.firstChild) typeset(ui.math, TEX[type] || '', { display: true }).catch(() => {});
    st.kind = type;
    const posRow = !!st.scene.count;
    [ui.prev, ui.next, ui.speed, ui.speedVal, ui.pos].forEach(e => { if (e) e.hidden = !posRow; });
    if (ui.speed && ui.speed.parentElement && ui.speed.parentElement.classList.contains('d-speed')) ui.speed.parentElement.hidden = !posRow;
    el.hidden = false; el.dataset.kind = type; el.dataset.mode = mode;
    doc.body.classList.add('detail-open');
    st.open = true;
    setPlaying(true);
    say(false);
    paintTile(spec);
    page.onDetail && page.onDetail(spec);
  }
  function setMode(mode) { st.mode = mode; el.dataset.mode = mode; }

  // the tile: the map itself, crisp, for the first part of the growth
  function paintTile(spec) {
    if (!tile) return;
    const maps = page.maps && page.maps();
    const im = spec.li === 11 ? null : maps && maps.img(spec.li, spec.li === 0 ? spec.c : Math.max(0, spec.c));
    const tg = tile.getContext('2d');
    tile.width = im && im.width ? im.width : 2; tile.height = im && im.height ? im.height : 2;
    if (!tg) return;
    tg.clearRect(0, 0, tile.width, tile.height);
    if (im && im.width) { tg.imageSmoothingEnabled = false; tg.drawImage(im, 0, 0); }
    else { tg.fillStyle = '#ffa06e'; tg.fillRect(0, 0, tile.width, tile.height); }
  }

  function close() {
    if (!st.open) return;
    st.open = false; el.hidden = true; doc.body.classList.remove('detail-open');
    el.style.transform = '';
    page.onDetail && page.onDetail(null);
  }

  // final: the rectangle of the open panel; now: where it is in this frame
  // (null = at the final place). The CSS transform maps final -> now.
  function place(final, now, e, reduced = false) {
    el.style.left = final.x + 'px'; el.style.top = final.y + 'px';
    el.style.width = final.w + 'px'; el.style.height = final.h + 'px';
    if (reduced || !now) el.style.transform = '';
    else {
      const sx = Math.max(0.001, now.w / final.w), sy = Math.max(0.001, now.h / final.h);
      el.style.transform = `translate(${(now.x - final.x).toFixed(2)}px, ${(now.y - final.y).toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
    }
    // the content fades in over the second half of the growth; the tile out
    const zc = reduced ? 1 : ease((e - 0.45) / 0.5), zt = reduced ? 0 : 1 - ease((e - 0.25) / 0.5);
    el.style.setProperty('--zc', zc.toFixed(3));
    el.style.setProperty('--zt', zt.toFixed(3));
    return { zc, zt };
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
    if (st.scene.st) st.scene.st.hold = st.mode === 'user' && st.speed > 4;
    try { st.hits = st.scene.draw(g, w, h, st.t) || []; } catch (e) { st.hits = []; if (!st.warned) { st.warned = true; console.warn('cnn-explainer: detail frame', e); } }
  }

  // user mode: the scan moves at the slider speed; the dense scene plays
  // its phases once (6 s) and stays on the probabilities
  function tick(dt) {
    if (!st.open || st.mode !== 'user' || !st.playing || !st.scene) return false;
    const reduced = page.reducedMotion();
    if (st.scene.count) {
      if (reduced) { st.acc += dt; if (st.acc >= 1) { st.acc = 0; st.t = (Math.floor(st.t) + 1) % st.scene.count; } }
      else { st.t += dt * st.speed; if (st.t >= st.scene.count) st.t = 0; }
    } else st.t = reduced ? 0.999 : Math.min(0.999, st.t + dt / 6);
    const now = win.performance ? win.performance.now() : Date.now();
    if (now - st.sayAt > 400) { st.sayAt = now; say(false); }
    return st.scene.count > 0 || st.t < 0.999;
  }

  function step(d) {
    if (!st.scene) return;
    page.detailTouched && page.detailTouched();
    setPlaying(false);
    if (st.scene.count) st.t = (Math.floor(st.t) + d + st.scene.count) % st.scene.count;
    else st.t = d > 0 ? 0.999 : 0;
    say(true); draw();
  }

  ui.play.addEventListener('click', () => { page.detailTouched && page.detailTouched(); setPlaying(!st.playing); page.requestDraw && page.requestDraw(); });
  ui.prev && ui.prev.addEventListener('click', () => step(-1));
  ui.next && ui.next.addEventListener('click', () => step(1));
  ui.close.addEventListener('click', () => { page.closeZoom ? page.closeZoom() : close(); page.focusOverview && page.focusOverview(); });
  ui.speed && ui.speed.addEventListener('input', () => { page.detailTouched && page.detailTouched(); readSpeed(); page.requestDraw && page.requestDraw(); });
  readSpeed();
  cv.addEventListener('click', e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = st.hits.find(q => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
    if (!hit || !st.scene) return;
    page.detailTouched && page.detailTouched();
    if (hit.kind === 'out') { st.t = Math.floor((y - hit.y) / hit.h * hit.n) * hit.n + Math.floor((x - hit.x) / hit.w * hit.n); setPlaying(false); say(true); }
    else if (hit.kind === 'chan') { st.scene.st.ci = hit.ci; st.scene.st.auto = false; }
    else if (hit.kind === 'class') { st.scene.st.k = hit.k; st.t = 0; setPlaying(true); }
    draw(); page.requestDraw && page.requestDraw();
  });
  el.addEventListener('pointerdown', () => { if (st.mode === 'user') page.detailTouched && page.detailTouched(); });
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); page.closeZoom ? page.closeZoom() : close(); page.focusOverview && page.focusOverview(); }
    else if (e.key === ' ' && e.target === cv) { e.preventDefault(); page.detailTouched && page.detailTouched(); setPlaying(!st.playing); }
    else if (e.key === 'ArrowRight' && e.target === cv) { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft' && e.target === cv) { e.preventDefault(); step(-1); }
  });

  return {
    open, close, step, draw, tick, place, setPlaying, setMode,
    get isOpen() { return st.open; }, get spec() { return st.spec; }, get t() { return st.t; }, set t(v) { st.t = v; },
    get mode() { return st.mode; }, get playing() { return st.playing; },
    get scene() { return st.scene; },
    // after a new picture: the same map, new numbers
    refresh() { if (st.open && st.spec) { const t = st.t, p = st.playing; open(st.spec, { mode: st.mode }); st.t = t; setPlaying(p); } },
  };
}

export { TEX, WORDS, ARCH };
