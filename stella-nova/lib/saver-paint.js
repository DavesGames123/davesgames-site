// ============================================================================
//  SAVER PAINT  ·  lib/saver-paint.js — draw the saver GUI into video frames
// ----------------------------------------------------------------------------
//  Safari and Firefox cannot capture a tab. In those browsers the screensaver
//  recorder (lib/screensaver.js, "PAINT") records a composite canvas: the
//  page canvas first, then the GUI over it. This file makes that composite.
//  lib/screensaver.js loads it only when a run records without tab capture.
//
//  The GUI comes from the live DOM of the shell: the plate (#sn-saver-label),
//  the leader line (#sn-saver-lead) and the caption (#sn-saver-cap). The
//  painter reads their layout from the browser, so a frame has the same
//  positions, fonts, colours and fades as the screen. It draws only the
//  parts that the plate uses:
//    box backgrounds  a colour, or a linear-gradient (angle and stops)
//    box borders      one width and colour for each side
//    text             each character at its own Range rect, in the computed
//                     font, colour, text-transform and first text-shadow
//    SVG              path, rect, line, circle and use, through
//                     getScreenCTM(). The MathJax equations (fontCache
//                     'local') draw as canvas paths, not as images: an image
//                     of an SVG can taint the canvas in Safari, and a tainted
//                     canvas cannot be recorded.
//  Opacity is the product of an element and its ancestors. A box with
//  overflow other than visible clips its children.
//
//  The GUI layer is a canvas of its own. It is drawn again only when the GUI
//  DOM changes (MutationObserver) or a CSS transition in it runs, so a frame
//  with a still plate costs two drawImage calls.
//
//  API
//    snSaverPaint.composite({ region, source, fps })
//      region  the element whose box is the frame (#content)
//      source  the page canvas (in the page iframe), or null
//      returns { canvas, stream, stop() }. stream is canvas.captureStream().
//
//  grep -n targets
//    display list ......... "function build"
//    one element .......... "function walk"
//    text ................. "function addText"
//    SVG .................. "function addSvg"
//    gradient ............. "function gradientOf"
//    frame loop ........... "function composite"
// ============================================================================
(function () {
'use strict';
if (window.snSaverPaint) return;

const ROOT_IDS = ['sn-saver-label', 'sn-saver-lead', 'sn-saver-cap'];
const MAX_SIDE = 3840;   // the longest side of a frame, in pixels

// ── display list ───────────────────────────────────────────────────────────
// build() walks the GUI roots and returns draw items in paint order. Each
// item has a viewport rect or matrix, an alpha and a clip rect (or null).
function build() {
  const out = [];
  for (const id of ROOT_IDS) {
    const e = document.getElementById(id);
    if (e) walk(e, 1, null, out);
  }
  return out;
}

function visibleBox(e, cs) {
  if (cs.display === 'none' || cs.visibility === 'hidden' || e.hidden) return false;
  return true;
}
function clipOf(r, clip) {
  if (!clip) return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
  return { x0: Math.max(clip.x0, r.left), y0: Math.max(clip.y0, r.top), x1: Math.min(clip.x1, r.right), y1: Math.min(clip.y1, r.bottom) };
}

function walk(e, alpha, clip, out) {
  if (e.nodeType !== 1) return;
  const cs = getComputedStyle(e);
  if (!visibleBox(e, cs)) return;
  const a = alpha * (+cs.opacity || 0);
  if (a <= 0.003) return;
  if (e instanceof SVGSVGElement) { addSvg(e, a, clip, out); return; }
  const r = e.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) {
    const g = gradientOf(cs.backgroundImage);
    if (g) out.push({ k: 'grad', r, g, a, clip, rad: parseFloat(cs.borderTopLeftRadius) || 0 });
    else if (!transparent(cs.backgroundColor)) out.push({ k: 'fill', r, c: cs.backgroundColor, a, clip, rad: parseFloat(cs.borderTopLeftRadius) || 0 });
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const w = parseFloat(cs['border' + side + 'Width']) || 0;
      if (w > 0 && cs['border' + side + 'Style'] !== 'none') out.push({ k: 'side', side, r, w, c: cs['border' + side + 'Color'], a, clip });
    }
  }
  const kidClip = cs.overflow !== 'visible' && r.width > 0 ? clipOf(r, clip) : clip;
  for (const n of e.childNodes) {
    if (n.nodeType === 3) addText(n, cs, a, kidClip, out);
    else walk(n, a, kidClip, out);
  }
}

function transparent(c) { return !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c); }

// ── text ───────────────────────────────────────────────────────────────────
// One item per visible character, at the rect the browser gives its Range.
// So letter-spacing, justification and line breaks need no layout here.
const range = document.createRange();
const measure = document.createElement('canvas').getContext('2d');
const metricCache = new Map();
function fontOf(cs) { return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; }
function ascentRatio(font) {
  if (metricCache.has(font)) return metricCache.get(font);
  measure.font = font;
  const m = measure.measureText('Mg');
  const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
  const v = asc > 0 && desc >= 0 ? asc / (asc + desc) : 0.8;
  metricCache.set(font, v);
  return v;
}
function shadowOf(cs) {
  const t = cs.textShadow;
  if (!t || t === 'none') return null;
  const first = t.split(/,(?![^(]*\))/)[0].trim();
  const col = (first.match(/(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]+)/i) || [])[0];
  const nums = first.replace(col || '', '').trim().split(/\s+/).map(parseFloat).filter(n => !isNaN(n));
  if (!col || nums.length < 2) return null;
  return { c: col, x: nums[0], y: nums[1], b: nums[2] || 0 };
}
function addText(n, cs, a, clip, out) {
  const s = n.data;
  if (!s || !s.trim()) return;
  const font = fontOf(cs), ratio = ascentRatio(font), shadow = shadowOf(cs);
  const upper = cs.textTransform === 'uppercase', lower = cs.textTransform === 'lowercase';
  for (let i = 0; i < s.length; i++) {
    let ch = s[i];
    if (/\s/.test(ch)) continue;
    // A surrogate pair is one character.
    let j = i + 1;
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) { ch = s.slice(i, i + 2); j = i + 2; }
    range.setStart(n, i); range.setEnd(n, j);
    const rs = range.getClientRects();
    i = j - 1;
    if (!rs.length) continue;
    const r = rs[0];
    if (r.width === 0 && r.height === 0) continue;
    if (upper) ch = ch.toUpperCase(); else if (lower) ch = ch.toLowerCase();
    out.push({ k: 'text', ch, x: r.left, y: r.top + r.height * ratio, font, c: cs.color, a, clip, shadow });
  }
}

// ── SVG ────────────────────────────────────────────────────────────────────
// Each shape draws with its screen matrix (getScreenCTM), so viewBox,
// nested transforms and the MathJax scale need no code here. <use> adds its
// x and y, then the matrix of the shape that it refers to.
function addSvg(svg, alpha, clip, out) {
  const r = svg.getBoundingClientRect();
  const svgClip = getComputedStyle(svg).overflow === 'hidden' ? clipOf(r, clip) : clip;
  (function rec(node, a) {
    for (const e of node.children) {
      const tag = e.localName;
      if (tag === 'defs' || tag === 'title' || tag === 'desc' || tag === 'style') continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const ea = a * (+cs.opacity || 0);
      if (ea <= 0.003) continue;
      if (tag === 'g' || tag === 'svg' || tag === 'a') { rec(e, ea); continue; }
      let m = e.getScreenCTM && e.getScreenCTM();
      if (!m) continue;
      let shape = e;
      if (tag === 'use') {
        const id = (e.getAttribute('href') || e.getAttribute('xlink:href') || '').replace(/^#/, '');
        const ref = id && (svg.getElementById ? svg.getElementById(id) : svg.querySelector('#' + CSS.escape(id)));
        if (!ref) continue;
        m = m.translate(e.x.baseVal.value, e.y.baseVal.value);
        const own = ref.transform && ref.transform.baseVal.consolidate();
        if (own) m = m.multiply(own.matrix);
        shape = ref;
      }
      const path = pathOf(shape);
      if (!path) continue;
      const fill = cs.fill, stroke = cs.stroke, sw = parseFloat(cs.strokeWidth) || 0;
      const fo = +cs.fillOpacity || 1, so = +cs.strokeOpacity || 1;
      out.push({ k: 'path', m: new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]), path, fill: fill && fill !== 'none' ? fill : null, fo, stroke: stroke && stroke !== 'none' && sw > 0 ? stroke : null, sw, so, a: ea, clip: svgClip, evenodd: cs.fillRule === 'evenodd' });
    }
  })(svg, alpha);
}
const pathCache = new WeakMap();
function pathOf(e) {
  if (pathCache.has(e)) return pathCache.get(e);
  const n = v => parseFloat(e.getAttribute(v)) || 0;
  let p = null;
  switch (e.localName) {
    case 'path': { const d = e.getAttribute('d'); if (d) p = new Path2D(d); break; }
    case 'rect': p = new Path2D(); p.rect(n('x'), n('y'), n('width'), n('height')); break;
    case 'line': p = new Path2D(); p.moveTo(n('x1'), n('y1')); p.lineTo(n('x2'), n('y2')); break;
    case 'circle': p = new Path2D(); p.arc(n('cx'), n('cy'), n('r'), 0, Math.PI * 2); break;
    case 'ellipse': p = new Path2D(); p.ellipse(n('cx'), n('cy'), n('rx'), n('ry'), 0, 0, Math.PI * 2); break;
    case 'polyline': case 'polygon': {
      const pts = (e.getAttribute('points') || '').trim().split(/[\s,]+/).map(parseFloat);
      if (pts.length >= 4) { p = new Path2D(); p.moveTo(pts[0], pts[1]); for (let i = 2; i + 1 < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]); if (e.localName === 'polygon') p.closePath(); }
      break;
    }
  }
  // MathJax rewrites the d of a glyph only when it typesets again, which
  // makes new elements, so the cache by element stays right.
  pathCache.set(e, p);
  return p;
}

// ── gradient ───────────────────────────────────────────────────────────────
// The computed value of one linear-gradient: an optional angle or "to side",
// then colour stops with an optional percent or px. Other images: null.
function splitTop(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function gradientOf(img) {
  if (!img || img === 'none') return null;
  const m = /^linear-gradient\((.*)\)$/.exec(img.trim());
  if (!m) return null;
  const parts = splitTop(m[1]);
  let deg = 180;
  const head = parts[0];
  const sides = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270 };
  if (/^-?[\d.]+deg$/.test(head)) { deg = parseFloat(head); parts.shift(); }
  else if (/^-?[\d.]+turn$/.test(head)) { deg = parseFloat(head) * 360; parts.shift(); }
  else if (head in sides) { deg = sides[head]; parts.shift(); }
  else if (/^to /.test(head)) { parts.shift(); }
  const stops = parts.map(p => {
    const pm = /^(.*?)\s+(-?[\d.]+)(%|px)$/.exec(p);
    return pm ? { c: pm[1], v: parseFloat(pm[2]), u: pm[3] } : { c: p, v: null, u: '%' };
  });
  if (stops.length < 2) return null;
  return { deg, stops };
}
function paintGradient(ctx, it) {
  const { r, g } = it;
  const a = g.deg * Math.PI / 180, sx = Math.sin(a), sy = -Math.cos(a);
  const len = Math.abs(r.width * sx) + Math.abs(r.height * sy);
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const lg = ctx.createLinearGradient(cx - sx * len / 2, cy - sy * len / 2, cx + sx * len / 2, cy + sy * len / 2);
  const n = g.stops.length;
  let last = 0;
  g.stops.forEach((s, i) => {
    let t = s.v == null ? (i === 0 ? 0 : i === n - 1 ? 1 : null) : s.u === 'px' ? s.v / len : s.v / 100;
    if (t == null) t = last + (1 - last) / (n - i);
    t = Math.min(1, Math.max(last, t));
    last = t;
    try { lg.addColorStop(t, s.c); } catch (e) { /* a colour form canvas does not take */ }
  });
  ctx.fillStyle = lg;
  boxPath(ctx, r, it.rad);
  ctx.fill();
}
function boxPath(ctx, r, rad) {
  ctx.beginPath();
  if (rad > 0 && ctx.roundRect) ctx.roundRect(r.left, r.top, r.width, r.height, rad);
  else ctx.rect(r.left, r.top, r.width, r.height);
}

// ── paint ──────────────────────────────────────────────────────────────────
// Draw a display list into ctx. base maps viewport CSS px to frame pixels.
function paint(ctx, list, base) {
  for (const it of list) {
    ctx.save();
    ctx.setTransform(base);
    ctx.globalAlpha = Math.min(1, it.a);
    if (it.clip) { ctx.beginPath(); ctx.rect(it.clip.x0, it.clip.y0, Math.max(0, it.clip.x1 - it.clip.x0), Math.max(0, it.clip.y1 - it.clip.y0)); ctx.clip(); }
    if (it.k === 'fill') { ctx.fillStyle = it.c; boxPath(ctx, it.r, it.rad); ctx.fill(); }
    else if (it.k === 'grad') paintGradient(ctx, it);
    else if (it.k === 'side') {
      const { r, w } = it; ctx.fillStyle = it.c;
      if (it.side === 'Top') ctx.fillRect(r.left, r.top, r.width, w);
      else if (it.side === 'Bottom') ctx.fillRect(r.left, r.bottom - w, r.width, w);
      else if (it.side === 'Left') ctx.fillRect(r.left, r.top, w, r.height);
      else ctx.fillRect(r.right - w, r.top, w, r.height);
    } else if (it.k === 'text') {
      ctx.font = it.font; ctx.fillStyle = it.c; ctx.textBaseline = 'alphabetic';
      if (it.shadow) {
        const sc = base.a;
        ctx.shadowColor = it.shadow.c; ctx.shadowOffsetX = it.shadow.x * sc; ctx.shadowOffsetY = it.shadow.y * sc; ctx.shadowBlur = it.shadow.b * sc;
      }
      ctx.fillText(it.ch, it.x, it.y);
    } else if (it.k === 'path') {
      ctx.setTransform(base.multiply(it.m));
      if (it.fill) { ctx.fillStyle = it.fill; ctx.globalAlpha = Math.min(1, it.a * it.fo); ctx.fill(it.path, it.evenodd ? 'evenodd' : 'nonzero'); }
      if (it.stroke) {
        ctx.strokeStyle = it.stroke; ctx.globalAlpha = Math.min(1, it.a * it.so);
        // Stroke width is in user units of the shape, as in SVG.
        ctx.lineWidth = it.sw;
        ctx.stroke(it.path);
      }
    }
    ctx.restore();
  }
}

// True while a CSS transition or animation runs in a GUI root.
function animating() {
  for (const id of ROOT_IDS) {
    const e = document.getElementById(id);
    if (!e || !e.getAnimations) continue;
    if (e.getAnimations({ subtree: true }).some(x => x.playState === 'running')) return true;
  }
  return false;
}

// ── frame loop ─────────────────────────────────────────────────────────────
// The frame is the region box at device pixels (capped at MAX_SIDE). Each
// animation frame: background, the page canvas (through a <video> of its
// captureStream, which works for WebGL and WebGPU canvases alike), then the
// GUI layer.
function composite(opts) {
  const region = opts.region, fps = opts.fps || 30;
  const out = document.createElement('canvas');
  const ctx = out.getContext('2d', { alpha: false });
  const layer = document.createElement('canvas');
  const lctx = layer.getContext('2d');
  let video = null, srcStream = null;
  if (opts.source && opts.source.captureStream) {
    try {
      srcStream = opts.source.captureStream(fps);
      video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.srcObject = srcStream;
      video.play().catch(() => {});
    } catch (e) { video = null; }
  }
  let dirty = true, live = true, raf = 0, rr = null, scale = 1;
  const mo = new MutationObserver(() => { dirty = true; });
  const watch = () => { for (const id of ROOT_IDS) { const e = document.getElementById(id); if (e && !e.snPaintWatched) { e.snPaintWatched = true; mo.observe(e, { subtree: true, childList: true, attributes: true, characterData: true }); } } };
  watch();
  const onResize = () => { dirty = true; };
  window.addEventListener('resize', onResize);

  function size() {
    const r = region.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    scale = Math.min(dpr, MAX_SIDE / Math.max(r.width, r.height, 1));
    const w = Math.max(2, Math.round(r.width * scale / 2) * 2), h = Math.max(2, Math.round(r.height * scale / 2) * 2);
    if (out.width !== w || out.height !== h) { out.width = w; out.height = h; layer.width = w; layer.height = h; dirty = true; }
    rr = r;
  }
  function bg() {
    try {
      const d = opts.source && opts.source.ownerDocument;
      const c = d && getComputedStyle(d.body).backgroundColor;
      return c && !transparent(c) ? c : '#000';
    } catch (e) { return '#000'; }
  }
  const back = bg();
  function frame() {
    if (!live) return;
    raf = requestAnimationFrame(frame);
    size();
    watch();
    if (dirty || animating()) {
      dirty = false;
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, layer.width, layer.height);
      paint(lctx, build(), new DOMMatrix([scale, 0, 0, scale, -rr.left * scale, -rr.top * scale]));
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = back;
    ctx.fillRect(0, 0, out.width, out.height);
    if (video && video.readyState >= 2) {
      try {
        const cr = opts.source.getBoundingClientRect();
        const fr = opts.source.ownerDocument.defaultView.frameElement;
        const off = fr ? fr.getBoundingClientRect() : { left: 0, top: 0 };
        ctx.drawImage(video, (off.left + cr.left - rr.left) * scale, (off.top + cr.top - rr.top) * scale, cr.width * scale, cr.height * scale);
      } catch (e) { /* the page left: keep the background */ }
    }
    ctx.drawImage(layer, 0, 0);
  }
  size();
  frame();
  const stream = out.captureStream(fps);
  return {
    canvas: out,
    stream,
    stop() {
      live = false;
      cancelAnimationFrame(raf);
      mo.disconnect();
      for (const id of ROOT_IDS) { const e = document.getElementById(id); if (e) e.snPaintWatched = false; }
      window.removeEventListener('resize', onResize);
      stream.getTracks().forEach(t => t.stop());
      if (srcStream) srcStream.getTracks().forEach(t => t.stop());
      if (video) { video.srcObject = null; }
    },
  };
}

window.snSaverPaint = { composite, build, paint };
})();
