// ============================================================================
//  PARTICLE COLLIDER  ·  labels.js — particle labels with no overlaps
// ----------------------------------------------------------------------------
//  No DOM. The diagrams label each product where it enters the detector:
//  a charged track where it crosses r = 300 mm, a photon at the face of
//  the crystal calorimeter, a jet at the hadron calorimeter, MET at the
//  tip of its arrow. place() puts each label near its anchor without
//  overlap:
//    - labels go in order of priority (hard objects first, then by pT)
//    - each label tries positions outward along its direction (the
//      direction of flight on screen), at 4 distances and 5 angular
//      offsets (0, +-25, +-50 degrees), and takes the first that fits
//      inside the bounds and clear of every placed label and of the
//      reserved rectangles (for example the event card)
//    - a label that finds no place is dropped when it is soft, or put at
//      its first candidate when it is hard (rare; it then may overlap)
//  The caller draws a leader line from the anchor to the label box.
//
//  place(items, bounds, reserved) -> [{ item, x, y, w, h }] (box top left)
//    item: { x, y (anchor px), dx, dy (outward unit), w, h, prio, hard, pref }
// ============================================================================
const overlap = (a, b, pad = 2) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

export function place(items, bounds, reserved = []) {
  const out = [], taken = reserved.slice();
  const order = items.slice().sort((a, b) => (b.hard - a.hard) || b.prio - a.prio);
  const DIST = [16, 30, 48, 72], ANG = [0, 0.44, -0.44, 0.87, -0.87];
  for (const it of order) {
    let first = null, done = null;
    if (it.pref) {
      const box = { x: it.x + it.pref.ox, y: it.y + it.pref.oy, w: it.w, h: it.h };
      if (box.x >= bounds.x && box.y >= bounds.y && box.x + box.w <= bounds.x + bounds.w && box.y + box.h <= bounds.y + bounds.h && !taken.some(t => overlap(t, box))) done = box;
    }
    if (!done) for (const D of DIST) {
      for (const a of ANG) {
        const c = Math.cos(a), s = Math.sin(a), dx = it.dx * c - it.dy * s, dy = it.dx * s + it.dy * c;
        const px = it.x + dx * D, py = it.y + dy * D;
        // the box hangs off its anchor side: left of the point when it points left
        const box = { x: dx >= 0 ? px : px - it.w, y: py - it.h / 2, w: it.w, h: it.h };
        if (!first) first = box;
        if (box.x < bounds.x || box.y < bounds.y || box.x + box.w > bounds.x + bounds.w || box.y + box.h > bounds.y + bounds.h) continue;
        if (taken.some(t => overlap(t, box))) continue;
        done = box; break;
      }
      if (done) break;
    }
    if (!done && it.hard && first) done = first;
    if (!done) continue;
    taken.push(done);
    out.push({ item: it, ...done });
  }
  return out;
}
export { overlap };
