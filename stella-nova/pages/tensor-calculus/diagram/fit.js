// ============================================================================
//  DIAGRAM FIT  ·  content bounds and the SVG viewBox  (DOM-free)
// ----------------------------------------------------------------------------
//  A layout scene has a width and a height, but the drawn content can be
//  smaller (a short row in a wide scene) or larger (labels and weights that
//  stick out). The old viewBox was "0 0 width height", so a tall pane drew a
//  small diagram with empty space round it. These functions fit the
//  viewBox to the drawn content instead:
//
//    sceneBounds(scene)          the box of every item: nodes, rings, legs
//                                and their labels, bars and their weights,
//                                and text. null for an empty scene.
//    unionBounds(a, b)           the box round two boxes (null-safe)
//    fitViewBox(b, w, h, opts)   [x, y, vw, vh]: the padded box, centred,
//                                with the aspect of the host (w x h CSS
//                                px). opts.maxScale caps the px per layout
//                                unit, so a small expression does not fill
//                                a big pane with a giant node.
//    viewBoxString(vb)           "x y w h" with one decimal
//
//  index.js fits a still scene to its own bounds, and a played step to the
//  union of the bounds before and after, so the zoom stays the same during
//  the step.
//
//  EXPORTS   (grep -n "export function" fit.js)
//      sceneBounds, unionBounds, fitViewBox, viewBoxString, FIT
// ============================================================================

export const FIT = Object.freeze({ pad: 16, maxScale: 1.7, charW: 0.56, labelR: 9 });

function grow(b, x0, y0, x1, y1) {
  if (!(Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1))) return;
  if (x0 < b.x0) b.x0 = x0; if (y0 < b.y0) b.y0 = y0;
  if (x1 > b.x1) b.x1 = x1; if (y1 > b.y1) b.y1 = y1;
  b.n++;
}

function textBox(b, x, y, text, size, anchor) {
  const w = String(text == null ? '' : text).length * size * FIT.charW;
  const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  grow(b, x0, y - size * 0.8, x0 + w, y + size * 0.3);
}

export function sceneBounds(scene) {
  if (!scene || !Array.isArray(scene.items)) return null;
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, n: 0 };
  const r = FIT.labelR;
  for (const it of scene.items) {
    if ((it.o ?? 1) <= 0.01) continue;
    switch (it.type) {
      case 'node': {
        const w = Math.max(4, it.w || 0), h = Math.max(4, it.h || 0);
        grow(b, it.x - w / 2, it.y - h / 2, it.x + w / 2, it.y + h / 2);
        if (it.label && (it.shape === 'cap' || it.shape === 'cup')) textBox(b, it.x + w / 2 + 5, it.y + 4, it.label, 12, 'start');
        break;
      }
      case 'circle':
        grow(b, it.x0, it.y0, it.x1 + 14, it.y1);
        break;
      case 'leg':
        for (const p of it.pts || []) grow(b, p[0], p[1], p[0], p[1]);
        if (it.labelX !== undefined && it.labelY !== undefined) grow(b, it.labelX - r, it.labelY - r - 4, it.labelX + r, it.labelY + r);
        break;
      case 'bar':
        grow(b, it.x0, (it.y ?? 0) - 8, it.x1, (it.y ?? 0) + 8);
        if (it.weight) textBox(b, it.wx ?? it.x1 + 5, it.wy ?? (it.y ?? 0) + 4, it.weight, 12, it.wa || 'start');
        break;
      case 'text':
        textBox(b, it.x, it.y, it.text, it.size || 14, it.anchor === 'middle' ? 'middle' : it.anchor || 'middle');
        break;
      default:
        if (Number.isFinite(it.x) && Number.isFinite(it.y)) grow(b, it.x, it.y, it.x, it.y);
    }
  }
  if (!b.n) return null;
  return { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
}

export function unionBounds(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

// b: content box in layout units. w, h: host size in CSS px (0 = unknown).
export function fitViewBox(b, w, h, opts = {}) {
  const pad = opts.pad ?? FIT.pad, maxScale = opts.maxScale ?? FIT.maxScale;
  if (!b) return [0, 0, 10, 10];
  let x = b.x0 - pad, y = b.y0 - pad, vw = Math.max(1, b.x1 - b.x0 + 2 * pad), vh = Math.max(1, b.y1 - b.y0 + 2 * pad);
  if (!(w > 1 && h > 1)) return [x, y, vw, vh];
  const s = Math.min(maxScale, w / vw, h / vh);
  const cx = x + vw / 2, cy = y + vh / 2;
  vw = w / s; vh = h / s;
  return [cx - vw / 2, cy - vh / 2, vw, vh];
}

export function viewBoxString(vb) { return vb.map(v => (Math.round(v * 10) / 10).toFixed(1)).join(' '); }
