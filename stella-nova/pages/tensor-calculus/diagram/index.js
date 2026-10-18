// ============================================================================
//  DIAGRAM  ·  Penrose, birdtrack and tensor-network views of a TensorExpr
// ----------------------------------------------------------------------------
//  The page calls this view the Penrose diagram: Penrose graphical
//  notation (1971), the diagram that shows tensor operations. This package
//  draws it in three styles: Penrose, Cvitanovic birdtracks (arrows on
//  lines) and tensor-network diagrams (boxes, bonds, einsum). Feynman
//  diagrams are a different tool; they are on the particle-collider page.
//
//  PUBLIC API (CONTRACT.md "DIAGRAM API"):
//
//    createDiagram(svgHost, opts) -> {
//      show(expr, { animate = true })   draw a TensorExpr (morph from the last)
//      play(step, t)                    OpTrace step at t in 0..1 (no clock;
//                                       CORE scrubs all views in lock step)
//      setStyle('penrose' | 'birdtrack' | 'network')   morphs to the style
//      pickIndex(sym | null)            highlight one index (legs + labels)
//      dispose()
//      -- extras --
//      resize()                         re-wrap rows for a new host width,
//                                       and fit the viewBox to the host
//      viewBox() / bounds()             the fitted viewBox [x, y, w, h] and
//                                       the content box (fit.js)
//      legend(el)                       write the legend panel for the style
//      svgString()                      the current frame as an SVG document
//      scene()                          the current scene (items, crossings)
//      get style
//    }
//
//    svgHost   an <svg> element (drawn into) or a container (an <svg> is
//              made inside it)
//    opts      { style = 'penrose', theme = 'dark' | 'light' | {inks},
//                indexColor(sym) (default: ../palette.js when present, else
//                the stand-in in colors.js), onPickIndex(sym | null),
//                maxWidth (layout units; default from host width),
//                dim (bond size label, default 4), animateMs = 520 }
//
//  Hover a leg (mouse) or tap it (touch, pen) to pick its index; the
//  diagram highlights it and calls opts.onPickIndex(sym). A second tap or a
//  tap on empty space clears it.
//
//  Modules (all DOM-free except applyPrims and mountLegend):
//      layout.js ...... TensorExpr -> keyed scene (nodes, legs, rings, bars)
//      transition.js .. stepFrame(step, A, B, t): legs swing and join, caps
//                       bend, Jacobians wrap, bars and rings grow, sums
//                       expand, cancelled terms fade
//      render.js ...... scene -> SVG primitives, SVG string, live DOM diff
//      legend.js ...... legend panel per style and its note
//      fit.js ......... content bounds and the viewBox fit (centred, padded,
//                       host aspect, at most opts.maxScale px per unit)
//      geom.js ........ curves, resampling, crossing count
//      text.js ........ TeX names to Unicode, coefficients, einsum strings
//      colors.js ...... stand-in index colours, theme inks
//      fixtures.js .... stand-in TeX parser and 40+ library expressions
//
//  EXPORTS   (jump with grep -n "<anchor>" index.js)
//      createDiagram .. "export function createDiagram"
//      re-exports ..... "export {"
// ============================================================================

import { layoutExpr, STYLES } from './layout.js';
import { stepFrame, ease } from './transition.js';
import { scenePrims, toSvgString, applyPrims } from './render.js';
import { mountLegend, legendItems, LEGEND_NOTE, STYLE_INFO } from './legend.js';
import { fallbackIndexColor } from './colors.js';
import { sceneBounds, unionBounds, fitViewBox, viewBoxString } from './fit.js';

export { layoutExpr, STYLES, stepFrame, toSvgString, scenePrims, legendItems, mountLegend, LEGEND_NOTE, STYLE_INFO };
export { sceneBounds, unionBounds, fitViewBox } from './fit.js';

let paletteColor = null;
const paletteReady = import('../palette.js')
  .then(m => { if (m && typeof m.indexColor === 'function') paletteColor = m.indexColor; })
  .catch(() => {});

const NS = 'http://www.w3.org/2000/svg';

export function createDiagram(svgHost, opts = {}) {
  const doc = svgHost.ownerDocument;
  const win = doc && doc.defaultView;
  const owned = String(svgHost.tagName || '').toLowerCase() !== 'svg';
  const svg = owned ? doc.createElementNS(NS, 'svg') : svgHost;
  if (owned) svgHost.appendChild(svg);
  svg.setAttribute('role', 'img');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  if (owned) svg.setAttribute('style', 'width:100%;height:100%;display:block;touch-action:manipulation');
  svg.classList && svg.classList.add('tc-diagram');

  let style = STYLES.includes(opts.style) ? opts.style : 'penrose';
  let expr = null, current = null, pick = null, locked = null;
  let lastPlay = null;
  let raf = 0, cache = {};
  let layouts = new WeakMap();
  let lastMaxW = 0;
  const animateMs = opts.animateMs ?? 520;
  const raff = win && win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : null;
  const caf = win && win.cancelAnimationFrame ? win.cancelAnimationFrame.bind(win) : () => {};
  const now = () => (win && win.performance ? win.performance.now() : Date.now());

  const color = sym => (opts.indexColor || paletteColor || fallbackIndexColor)(sym);

  function maxWidth() {
    if (opts.maxWidth) return opts.maxWidth;
    const w = (svg.clientWidth || (owned ? svgHost.clientWidth : 0) || 800);
    return Math.max(340, Math.min(1100, w * 1.15));
  }

  function layout(e) {
    if (!e) return { width: 10, height: 10, items: [], crossings: 0, style };
    const mw = maxWidth();
    let per = layouts.get(e);
    if (!per) { per = new Map(); layouts.set(e, per); }
    const k = `${style}|${Math.round(mw)}`;
    if (!per.has(k)) per.set(k, layoutExpr(e, { style, maxWidth: mw, indexColor: color, dim: opts.dim }));
    lastMaxW = mw;
    return per.get(k);
  }

  // The viewBox fits the drawn content (fit.js), centred, with the aspect
  // of the host. box: the content box to fit; a step passes the union of
  // its two scenes, so the zoom holds still during the step.
  const boundsCache = new WeakMap();
  function boundsOf(scene) {
    if (!scene) return null;
    if (!boundsCache.has(scene)) boundsCache.set(scene, sceneBounds(scene));
    return boundsCache.get(scene);
  }
  let lastBox = null, lastVB = null;
  function hostSize() {
    const el = owned ? svgHost : svg;
    return [el.clientWidth || svg.clientWidth || 0, el.clientHeight || svg.clientHeight || 0];
  }
  function draw(scene, box) {
    current = scene;
    applyPrims(svg, scenePrims(scene, { style, theme: opts.theme, pick }), cache);
    lastBox = box || boundsOf(scene) || { x0: 0, y0: 0, x1: Math.max(1, scene.width), y1: Math.max(1, scene.height) };
    const [w, h] = hostSize();
    lastVB = fitViewBox(lastBox, w, h, { maxScale: opts.maxScale });
    svg.setAttribute('viewBox', viewBoxString(lastVB));
  }

  function stop() { if (raf) { caf(raf); raf = 0; } }

  function morphTo(target) {
    stop();
    if (!current || !raff || animateMs <= 0) { draw(target); return; }
    const from = current, t0 = now();
    const box = unionBounds(boundsOf(from), boundsOf(target));
    const tick = () => {
      const t = Math.min(1, (now() - t0) / animateMs);
      draw(t >= 1 ? target : stepFrame(null, from, target, t), t >= 1 ? null : box);
      raf = t < 1 ? raff(tick) : 0;
    };
    raf = raff(tick);
  }

  function show(e, o = {}) {
    expr = e; lastPlay = null;
    if (e && e.tex) svg.setAttribute('aria-label', `Penrose diagram of ${e.tex}`);
    const target = layout(e);
    if (o.animate === false) { stop(); draw(target); } else morphTo(target);
  }

  function play(step, t) {
    if (!step) return;
    stop();
    const tt = Math.min(1, Math.max(0, +t || 0));
    lastPlay = { step, t: tt };
    expr = tt >= 1 ? step.after : step.before;
    const A = layout(step.before), B = layout(step.after);
    draw(stepFrame(step, A, B, tt), unionBounds(boundsOf(A), boundsOf(B)));
  }

  function redraw(animate) {
    if (lastPlay) { const { step, t } = lastPlay; play(step, t); return; }
    if (!expr) return;
    animate ? morphTo(layout(expr)) : draw(layout(expr));
  }

  function setStyle(s) {
    if (!STYLES.includes(s) || s === style) return;
    style = s;
    redraw(true);
  }

  function setPick(sym) {
    pick = sym || null;
    if (current) draw(current);
  }

  function pickIndex(sym) { locked = null; setPick(sym); }

  function symAt(ev) {
    let el = ev.target;
    while (el && el !== svg) {
      if (el.getAttribute && el.getAttribute('data-sym')) return el.getAttribute('data-sym');
      el = el.parentNode;
    }
    return null;
  }
  const onOver = ev => {
    if (ev.pointerType && ev.pointerType !== 'mouse') return;
    if (locked) return;
    const s = symAt(ev);
    if (s && s !== pick) { setPick(s); opts.onPickIndex && opts.onPickIndex(s); }
  };
  const onOut = ev => {
    if (ev.pointerType && ev.pointerType !== 'mouse') return;
    if (locked || !pick) return;
    if (symAt(ev) && !ev.relatedTarget) return;
    const rel = ev.relatedTarget && ev.relatedTarget.getAttribute ? ev.relatedTarget.getAttribute('data-sym') : null;
    if (rel === pick) return;
    setPick(null); opts.onPickIndex && opts.onPickIndex(null);
  };
  const onClick = ev => {
    const s = symAt(ev);
    if (!s || locked === s) { locked = null; setPick(null); opts.onPickIndex && opts.onPickIndex(null); return; }
    locked = s; setPick(s); opts.onPickIndex && opts.onPickIndex(s);
  };
  svg.addEventListener('pointerover', onOver);
  svg.addEventListener('pointerout', onOut);
  svg.addEventListener('click', onClick);

  paletteReady.then(() => {
    if (!opts.indexColor && paletteColor && cache) { layouts = new WeakMap(); redraw(false); }
  });

  function resize() {
    if (Math.abs(maxWidth() - lastMaxW) > 1) { redraw(false); return; }
    // same row wrap: only the host aspect changed, so fit the viewBox again
    if (current && lastBox) {
      const [w, h] = hostSize();
      lastVB = fitViewBox(lastBox, w, h, { maxScale: opts.maxScale });
      svg.setAttribute('viewBox', viewBoxString(lastVB));
    }
  }

  function dispose() {
    stop();
    svg.removeEventListener('pointerover', onOver);
    svg.removeEventListener('pointerout', onOut);
    svg.removeEventListener('click', onClick);
    if (cache.groups) for (const g of cache.groups.values()) g.remove();
    cache = null;
    if (owned) svg.remove();
  }

  if (opts.expr) show(opts.expr, { animate: false });

  return {
    show, play, setStyle, pickIndex, dispose, resize,
    legend: el => mountLegend(el, style, { indexColor: color, theme: opts.theme }),
    svgString: () => (current ? toSvgString(current, { style, theme: opts.theme, pick }) : ''),
    scene: () => current,
    viewBox: () => (lastVB ? lastVB.slice() : null),
    bounds: () => (lastBox ? { ...lastBox } : null),
    get style() { return style; },
    ease,
  };
}
