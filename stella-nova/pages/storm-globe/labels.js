// ============================================================================
//  STORM GLOBE  ·  labels.js — which globe labels show (pure, no DOM)
// ----------------------------------------------------------------------------
//  pickLabels(cands, clear, opts) -> Set of ids to show
//    cands  [{ id, x, y, w, h, pri, sel }]  x, y: the top centre of the
//           label box in CSS px (the box spans x - w/2 .. x + w/2, y .. y + h)
//    clear  { l, r, t, b }  the clear area of main.js occlusion()
//    opts   { max, pad }    max labels (the selected one always counts),
//                           pad: the gap in px kept between two boxes
//  Order: the selected label first, then higher pri, then nearer the
//  centre of the clear area. A label shows only when its box is inside
//  the clear area and does not touch a box that shows already. The
//  selected label is kept when it is inside, even over another box.
//
//  GREP MAP
//    grep -n 'export function pickLabels'   the pick
//    grep -n 'export function labelPri'     the priority of a stop kind
// ============================================================================

export function labelPri(kind, wind = 0) {
  if (kind === 'storm') return 3 + Math.min(1, wind / 160);
  if (kind === 'low') return 2;
  if (kind === 'jet') return 1;
  return 0.5;
}

export function pickLabels(cands, clear, { max = 12, pad = 4 } = {}) {
  const cx = (clear.l + clear.r) / 2, cy = (clear.t + clear.b) / 2;
  const order = cands.slice().sort((a, b) =>
    (b.sel ? 1 : 0) - (a.sel ? 1 : 0) || b.pri - a.pri || Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  const shown = new Set(), boxes = [];
  for (const c of order) {
    if (shown.size >= max) break;
    const bx = { l: c.x - c.w / 2, r: c.x + c.w / 2, t: c.y, b: c.y + c.h };
    if (bx.l < clear.l || bx.r > clear.r || bx.t < clear.t || bx.b > clear.b) continue;
    if (!c.sel && boxes.some(o => bx.l < o.r + pad && bx.r > o.l - pad && bx.t < o.b + pad && bx.b > o.t - pad)) continue;
    shown.add(c.id); boxes.push(bx);
  }
  return shown;
}
