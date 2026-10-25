// ============================================================================
//  EM EXPLORER  ·  ui/hash.js — the view state in the URL hash
// ----------------------------------------------------------------------------
//  The page hash holds the view, so a copied link opens the same place:
//
//    #d=hemibrain&p=xy&x=17000&y=19800&z=20100&zm=0.5&c=20,235,1&inv=1&b=syn-1
//
//    d    dataset id                 p    plane xy | xz | yz
//    x y z  centre, voxels of scale 0 zm  zoom, CSS px per scale-0 voxel
//    c    contrast lo,hi,gamma        inv  1 when the image is inverted
//    b    bookmark id (the caption card shows again)
//
//  Pure functions, no DOM. tests.mjs tests them in node.
//
//  grep -n targets
//    read ............ "export function parseHash"
//    write ........... "export function formatHash"
//    round ........... "function roundTo"
// ============================================================================

export const PLANES = ['xy', 'xz', 'yz'];
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

function num(v, lo, hi) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

// parseHash(hash) -> { dataset, plane, x, y, z, zoom, contrast, invert, bookmark }
// Each field is null when the hash does not give a valid value.
export function parseHash(hash) {
  const h = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const out = { dataset: null, plane: null, x: null, y: null, z: null, zoom: null, contrast: null, invert: null, bookmark: null };
  const d = h.get('d'); if (d && ID.test(d)) out.dataset = d;
  const p = h.get('p'); if (PLANES.includes(p)) out.plane = p;
  out.x = num(h.get('x'), -1e7, 1e8); out.y = num(h.get('y'), -1e7, 1e8); out.z = num(h.get('z'), -1e7, 1e8);
  out.zoom = num(h.get('zm'), 1e-6, 1e3);
  const c = (h.get('c') || '').split(',');
  if (c.length === 3) {
    const lo = num(c[0], 0, 255), hi = num(c[1], 0, 255), g = num(c[2], 0.1, 10);
    if (lo != null && hi != null && g != null && hi > lo) out.contrast = { lo, hi, gamma: g };
  }
  if (h.has('inv')) out.invert = h.get('inv') === '1';
  const b = h.get('b'); if (b && ID.test(b)) out.bookmark = b;
  return out;
}

function roundTo(v, digits) {
  const s = Number(v).toFixed(digits);
  return s.indexOf('.') < 0 ? s : s.replace(/\.?0+$/, '');
}

// Zoom keeps three significant figures, so a far view (0.004) stays exact enough.
function roundZoom(z) {
  if (!(z > 0)) return '1';
  const d = Math.max(0, 2 - Math.floor(Math.log10(z)));
  return roundTo(z, Math.min(d, 8));
}

// formatHash(state) -> 'd=...&p=...' (no leading '#'). Leaves out null fields.
export function formatHash(s) {
  const parts = [];
  if (s.dataset) parts.push('d=' + encodeURIComponent(s.dataset));
  if (PLANES.includes(s.plane)) parts.push('p=' + s.plane);
  for (const k of ['x', 'y', 'z']) if (Number.isFinite(s[k])) parts.push(k + '=' + roundTo(s[k], 1));
  if (Number.isFinite(s.zoom)) parts.push('zm=' + roundZoom(s.zoom));
  const c = s.contrast;
  if (c && !(c.lo === 0 && c.hi === 255 && c.gamma === 1)) parts.push('c=' + [roundTo(c.lo, 0), roundTo(c.hi, 0), roundTo(c.gamma, 2)].join(','));
  if (s.invert) parts.push('inv=1');
  if (s.bookmark) parts.push('b=' + encodeURIComponent(s.bookmark));
  return parts.join('&');
}
