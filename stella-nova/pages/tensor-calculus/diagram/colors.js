// ============================================================================
//  DIAGRAM COLORS  ·  index colours and theme inks  (DOM-free ES module)
// ----------------------------------------------------------------------------
//  The page has one index colour language (CONTRACT.md). CORE owns it in
//  ../palette.js (INDEX_COLORS, indexColor). index.js loads that module when
//  it exists and passes its indexColor to the layout. Until CORE lands, and
//  in node tests, fallbackIndexColor gives a stand-in with the same idea: a
//  fixed slot for the usual letters, a hash for the rest, primes ignored.
//
//  EXPORTS   (jump with grep -n "<anchor>" colors.js)
//      FALLBACK_COLORS ...... "export const FALLBACK_COLORS"
//      fallbackIndexColor ... "export function fallbackIndexColor"
//      THEMES ............... "export const THEMES"   dark and light inks
//      lerpColor ............ "export function lerpColor"
// ============================================================================

export const FALLBACK_COLORS = [
  '#ff9f43', '#4cc9f0', '#f72585', '#7bd389', '#c77dff', '#ffd166', '#ff6b6b', '#56cfe1',
];

const SLOT = {
  mu: 0, a: 0, i: 0, alpha: 0, q: 0,
  nu: 1, b: 1, j: 1, beta: 1,
  rho: 2, c: 2, k: 2, gamma: 2,
  sigma: 3, d: 3, l: 3, delta: 3,
  lambda: 4, e: 4, m: 4, kappa: 4,
  tau: 5, f: 5, n: 5, theta: 5, v: 5,
  phi: 6, g: 6, p: 6, eta: 6, r: 6,
  psi: 7, h: 7, s: 7, chi: 7, omega: 7, t: 7,
};

export function fallbackIndexColor(sym) {
  const base = String(sym).replace(/^\\/, '').replace(/['′]+$/, '');
  if (base in SLOT) return FALLBACK_COLORS[SLOT[base]];
  let h = 0;
  for (const ch of base) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

export const THEMES = {
  dark: { ink: '#e8e4d8', dim: '#8d93a1', faint: '#3a4150', node: '#161b26', blob: '#2a3242',
          box: '#1c2533', boxEdge: '#6b7a93', cut: '#ff6b6b', bg: '#0b0e14' },
  light: { ink: '#1d2230', dim: '#5d6573', faint: '#c9ccd3', node: '#fbfaf6', blob: '#d9dde5',
           box: '#eef2f8', boxEdge: '#6b7a93', cut: '#c0392b', bg: '#ffffff' },
};

function hex(c) {
  const s = String(c).trim();
  let m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) return [...m[1]].map(ch => parseInt(ch + ch, 16));
  m = s.match(/^rgba?\(([^)]+)\)/i);
  if (m) return m[1].split(',').slice(0, 3).map(v => parseFloat(v));
  return null;
}

export function lerpColor(a, b, t) {
  if (a === b || t <= 0) return a;
  if (t >= 1) return b;
  const A = hex(a), B = hex(b);
  if (!A || !B) return t < 0.5 ? a : b;
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}
