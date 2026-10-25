// ============================================================================
//  ALPHA QUDITS  ·  saver/probe.js  ·  fit a renderShot drawing into its box
// ----------------------------------------------------------------------------
//  STRANDS and COMPARE lay a shot out for the box they get. In a short band
//  (a phone in 9:16, a long plate) some layouts need more height than the
//  box has, and their text runs out of it. fitScale() draws the shot into a
//  probe context that only records where text goes, and picks the largest
//  scale at which all text stays in the box. saver/index.js then draws into
//  a virtual box of (w / s, h / s), scaled by s. node tests use the same
//  probe as their mock canvas.
//
//  grep -n targets
//    probe context ........ "export function probeContext"
//    scale search ......... "export function fitScale"
// ============================================================================

// A 2D context that draws nothing. It keeps the transform, records each
// fillText anchor in frame px ({ t, x, y }) in __texts, and the first NaN
// argument in __nan. measureText uses 0.55 em per character.
export function probeContext() {
  let m = [1, 0, 0, 1, 0, 0]; const stack = [], texts = []; let nan = null;
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const grad = { addColorStop() {} };
  const state = { font: '12px sans-serif', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, textAlign: 'left', textBaseline: 'alphabetic', globalCompositeOperation: 'source-over', lineCap: 'butt', lineJoin: 'miter', shadowBlur: 0, shadowColor: '', filter: 'none', imageSmoothingEnabled: true, lineDashOffset: 0, direction: 'ltr', letterSpacing: '0px' };
  const fns = {
    save() { stack.push(m.slice()); }, restore() { if (stack.length) m = stack.pop(); },
    setTransform(a, b, c, d, e, f) { m = typeof a === 'object' && a ? [a.a, a.b, a.c, a.d, a.e, a.f] : [a, b, c, d, e, f]; },
    resetTransform() { m = [1, 0, 0, 1, 0, 0]; },
    getTransform() { return { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5], inverse() { return this; } }; },
    translate(x, y) { m = mul(m, [1, 0, 0, 1, x, y]); }, scale(x, y) { m = mul(m, [x, 0, 0, y, 0, 0]); },
    rotate(r) { const c = Math.cos(r), s = Math.sin(r); m = mul(m, [c, s, -s, c, 0, 0]); },
    transform(a, b, c, d, e, f) { m = mul(m, [a, b, c, d, e, f]); },
    fillText(t, x, y) { texts.push({ t: String(t), x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }); },
    measureText(t) { const px = parseFloat((/(\d+(?:\.\d+)?)px/.exec(state.font) || [0, 12])[1]); return { width: String(t).length * px * 0.55, actualBoundingBoxAscent: px * 0.75, actualBoundingBoxDescent: px * 0.2 }; },
    createLinearGradient: () => grad, createRadialGradient: () => grad, createConicGradient: () => grad, createPattern: () => null,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
    isPointInPath: () => false, getLineDash: () => [],
  };
  const watch = (k, a) => { if (!nan) for (const v of a) if (typeof v === 'number' && Number.isNaN(v)) { nan = `${String(k)}(${a.join(', ')})`; break; } };
  return new Proxy(state, {
    get(o, k) {
      if (k === '__texts') return texts;
      if (k === '__nan') return nan;
      if (k === 'canvas') return { width: 1920, height: 1080 };
      if (k in fns) return (...a) => { watch(k, a); return fns[k](...a); };
      if (k in o) return o[k];
      return (...a) => { watch(k, a); };
    },
    set(o, k, v) { o[k] = v; return true; },
  });
}

// Largest s in steps at which draw(g, t, virtualBox) keeps every text
// anchor within slack px of box at every probe time. draw must not change
// the state of the real shot (COMPARE keeps a state per shot id, so the
// saver probes with a copy of the shot under another id).
export function textsInBox(texts, box, slack = 6) {
  return texts.every(q => q.x >= box.x - slack && q.x <= box.x + box.w + slack && q.y >= box.y - slack && q.y <= box.y + box.h + slack);
}
export function fitScale(draw, box, times = [0, 2, 5], steps = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.45]) {
  for (const s of steps) {
    const vb = { x: 0, y: 0, w: box.w / s, h: box.h / s };
    let ok = true;
    for (const t of times) {
      const g = probeContext();
      g.setTransform(s, 0, 0, s, box.x, box.y);
      try { draw(g, t, vb); } catch (e) { ok = false; break; }
      if (!textsInBox(g.__texts, box)) { ok = false; break; }
    }
    if (ok) return s;
  }
  return steps[steps.length - 1];
}
