// ============================================================================
//  PERIODIC TABLE  ·  chem.js  ·  the element model  (pure ES module, no DOM)
// ----------------------------------------------------------------------------
//  This module joins data/elements.js (numbers) and data/text.js (our prose)
//  into one record per element, and gives the chemistry that the views, the
//  inspect card, the atom view and the tests share:
//    the Madelung (Aufbau) filling order and its exceptions
//    the electron configuration, expanded from a noble-gas core
//    the shells, from the configuration
//    Slater's rules for the effective nuclear charge Z_eff
//    the phase of an element at a temperature (1 atm)
//    the catalogue of numeric properties for heat maps, towers and scatter
//
//  GREP MAP
//    grep -n "export const CATS"         category names and colours
//    grep -n "export const MADELUNG"     the n + l filling order
//    grep -n "export function madelung"  the ideal configuration of Z
//    grep -n "export function expand"    a configuration, core expanded
//    grep -n "export const EXCEPTIONS"   the elements that break Madelung
//    grep -n "export function zeff"      Slater's rules
//    grep -n "export function phaseAt"   solid, liquid or gas at T
//    grep -n "export const PROPS"        the numeric properties
//    grep -n "export function fmt"       number formatting
// ============================================================================
import { ELEMENTS as RAW } from './data/elements.js';
import { TEXT } from './data/text.js';

// Categories: order of the legend, a display name and a colour. The colours
// are bright on the dark page and differ in hue so that neighbours in the
// table stay apart.
export const CATS = [
  { id: 'alkali', name: 'Alkali metal', color: '#ff5d6c' },
  { id: 'alkaline-earth', name: 'Alkaline-earth metal', color: '#ff9a3c' },
  { id: 'transition', name: 'Transition metal', color: '#4aa8ff' },
  { id: 'post-transition', name: 'Post-transition metal', color: '#2fd3c1' },
  { id: 'metalloid', name: 'Metalloid', color: '#9be15d' },
  { id: 'nonmetal', name: 'Reactive nonmetal', color: '#ffd166' },
  { id: 'halogen', name: 'Halogen', color: '#ff6fcf' },
  { id: 'noble-gas', name: 'Noble gas', color: '#8c8cff' },
  { id: 'lanthanide', name: 'Lanthanide', color: '#d38bff' },
  { id: 'actinide', name: 'Actinide', color: '#e8a87c' },
  { id: 'unknown', name: 'Properties not known', color: '#8a94a8' },
];
export const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));

export const BLOCKS = [
  { id: 's', name: 's-block', color: '#ff6b8b', l: 0 },
  { id: 'p', name: 'p-block', color: '#ffc14d', l: 1 },
  { id: 'd', name: 'd-block', color: '#4ab8ff', l: 2 },
  { id: 'f', name: 'f-block', color: '#b88cff', l: 3 },
];
export const BLOCK = Object.fromEntries(BLOCKS.map(b => [b.id, b]));
export const L_LETTER = 'spdf';
export const SHELL_LETTER = 'KLMNOPQ';

// ── element records ─────────────────────────────────────────────────────────
export const ELEMENTS = RAW.map(r => {
  const t = TEXT[r.z] || {};
  return { ...r, origin: t.o || '', uses: t.u || '', desc: t.d || '' };
});
export const BY_Z = [null, ...ELEMENTS];
export const BY_SYM = Object.fromEntries(ELEMENTS.map(e => [e.sym.toLowerCase(), e]));

// ── Madelung (Aufbau) order ────────────────────────────────────────────────
// Subshells in order of n + l, then of n.
export const MADELUNG = (() => {
  const out = [];
  for (let s = 1; s <= 8; s++) {
    for (let n = 1; n <= s; n++) {
      const l = s - n;
      if (l < n && l <= 3) out.push([n, l]);
    }
  }
  return out;
})();
export const cap = l => 2 * (2 * l + 1);
export const subName = (n, l) => n + L_LETTER[l];

// The ideal configuration of Z: [[n, l, count], ...] in filling order.
export function madelung(z) {
  const out = [];
  let left = z;
  for (const [n, l] of MADELUNG) {
    if (left <= 0) break;
    const k = Math.min(cap(l), left);
    out.push([n, l, k]);
    left -= k;
  }
  return out;
}

// The last subshell that the Madelung rule fills for Z: [n, l, count].
export function lastSubshell(z) { const m = madelung(z); return m[m.length - 1]; }

const CORES = { He: 2, Ne: 10, Ar: 18, Kr: 36, Xe: 54, Rn: 86 };

// Parse '[Ar] 3d6 4s2' into [[n, l, count], ...] with the core expanded,
// sorted by n then l (the order chemists write a configuration).
export function expand(cfg) {
  const out = new Map();
  for (const tok of cfg.trim().split(/\s+/)) {
    const core = /^\[(\w+)\]$/.exec(tok);
    if (core) {
      const z = CORES[core[1]];
      if (!z) throw new Error('unknown core ' + tok);
      for (const [n, l, k] of expand(BY_Z[z].cfg)) out.set(n * 10 + l, [n, l, k]);
      continue;
    }
    const m = /^(\d)([spdf])(\d+)$/.exec(tok);
    if (!m) throw new Error('bad subshell ' + tok);
    const n = +m[1], l = L_LETTER.indexOf(m[2]);
    out.set(n * 10 + l, [n, l, +m[3]]);
  }
  return [...out.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// Electrons per shell n = 1.. from a configuration.
export function shellsOf(sub) {
  const s = [];
  for (const [n, , k] of sub) s[n - 1] = (s[n - 1] || 0) + k;
  for (let i = 0; i < s.length; i++) s[i] = s[i] || 0;
  return s;
}

const key = sub => sub.filter(x => x[2] > 0).map(([n, l, k]) => n + L_LETTER[l] + k).sort().join(' ');

// The elements whose ground-state configuration (in data/elements.js) is
// not the Madelung one. Computed, and the tests check it against the list
// in chemistry textbooks.
export const EXCEPTIONS = ELEMENTS.filter(e => key(expand(e.cfg)) !== key(madelung(e.z))).map(e => e.sym);

// Configuration as display parts: core, then [label, count] per subshell
// in n then l order. Used for the HTML superscripts and the canvas text.
export function cfgParts(e) {
  const toks = e.cfg.trim().split(/\s+/);
  const core = /^\[(\w+)\]$/.exec(toks[0]) ? toks.shift().slice(1, -1) : null;
  const subs = toks.map(t => { const m = /^(\d[spdf])(\d+)$/.exec(t); return [m[1], +m[2]]; });
  subs.sort((a, b) => +a[0][0] - +b[0][0] || L_LETTER.indexOf(a[0][1]) - L_LETTER.indexOf(b[0][1]));
  return { core, subs };
}
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export const sup = n => String(n).split('').map(d => SUP[+d]).join('');
export function cfgUnicode(e) {
  const { core, subs } = cfgParts(e);
  return (core ? '[' + core + '] ' : '') + subs.map(([s, k]) => s + sup(k)).join(' ');
}
export function madelungUnicode(z) {
  const m = madelung(z);
  // the same noble-gas core as the real configuration, when it has one
  const zc = [86, 54, 36, 18, 10, 2].find(c => c < z && key(madelung(c)) === key(m.slice(0, madelung(c).length)));
  const core = zc ? madelung(zc).length : 0;
  const rest = m.slice(core).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return (zc ? '[' + BY_Z[zc].sym + '] ' : '') + rest.map(([n, l, k]) => n + L_LETTER[l] + sup(k)).join(' ');
}

// ── Slater's rules ──────────────────────────────────────────────────────────
// Z_eff = Z - S for an electron in subshell (n, l). Groups: (1s) (2s,2p)
// (3s,3p) (3d) (4s,4p) (4d) (4f) (5s,5p) (5d) (5f) ... Slater 1930.
export function zeff(z, sub, n, l) {
  const grp = (nn, ll) => ll <= 1 ? nn * 10 : nn * 10 + ll;      // s and p share a group
  const order = (nn, ll) => ll <= 1 ? nn * 4 : nn * 4 + ll;       // group order (s,p) < d < f of the same n
  const g = grp(n, l), o = order(n, l);
  let S = 0;
  for (const [m, q, k] of sub) {
    if (!k) continue;
    const same = grp(m, q) === g;
    const kk = m === n && q === l ? k - 1 : k;   // the electron does not screen itself
    if (kk <= 0) continue;
    if (same) S += kk * (n === 1 ? 0.30 : 0.35);
    else if (order(m, q) > o) continue;           // outer groups do not screen
    else if (l <= 1) S += kk * (m === n - 1 ? 0.85 : 1.0);   // n - 1 shell 0.85, deeper 1.0
    else S += kk * 1.0;                            // d and f: every inner group screens fully
  }
  return z - S;
}
// Slater exponents use an effective n* for n > 3.
export const nStar = n => [0, 1, 2, 3, 3.7, 4.0, 4.2, 4.4][n] || n;

// The outermost (valence) subshell of an element: the largest n, then the
// subshell that the Madelung order filled last among those of the real
// configuration.
export function valence(e) {
  const sub = expand(e.cfg);
  const nMax = Math.max(...sub.map(s => s[0]));
  return sub.filter(s => s[0] === nMax).sort((a, b) => b[1] - a[1])[0];
}

// ── phase at a temperature (1 atm) ─────────────────────────────────────────
// 'solid', 'liquid', 'gas' or 'unknown'. An element that sublimes (carbon,
// arsenic) goes from solid to gas at one temperature. Helium has no solid
// at 1 atm. With no data, the phase at STP stands for all temperatures and
// the result is 'unknown' when the STP phase is also missing.
export function phaseAt(e, T) {
  const { mp, bp } = e;
  if (mp == null && bp == null) return e.phase || 'unknown';
  if (e.sublimes) return T < mp ? 'solid' : 'gas';
  if (mp == null) return T < bp ? 'liquid' : 'gas';
  if (bp == null) return T < mp ? 'solid' : 'liquid';
  return T < mp ? 'solid' : T < bp ? 'liquid' : 'gas';
}
// How far an element is into its current phase band, 0..1 (for the melt
// animation): 0 at the lower transition, 1 at the upper one.
export function phaseFrac(e, T) {
  const p = phaseAt(e, T);
  if (p === 'liquid' && e.mp != null && e.bp != null) return Math.min(1, Math.max(0, (T - e.mp) / Math.max(1, e.bp - e.mp)));
  if (p === 'solid' && e.mp != null) return Math.min(1, Math.max(0, T / e.mp));
  if (p === 'gas' && e.bp != null) return Math.min(1, Math.max(0, (T - e.bp) / 2000));
  return 0.5;
}

// ── isotopes ────────────────────────────────────────────────────────────────
// The isotope whose nucleus the atom view draws: the most abundant natural
// isotope, else the longest-lived one.
export function mainIsotope(e) {
  const nat = e.iso.filter(i => i[1] > 0).sort((a, b) => b[1] - a[1]);
  if (nat.length) return nat[0][0];
  const lived = e.iso.filter(i => i[2] != null).sort((a, b) => b[2] - a[2]);
  return lived.length ? lived[0][0] : Math.round(e.mass);
}
export const stableCount = e => e.iso.filter(i => i[2] == null).length;
export const longestHalfLife = e => {
  if (stableCount(e)) return Infinity;
  const h = e.iso.map(i => i[2]).filter(x => x > 0);
  return h.length ? Math.max(...h) : null;
};

// ── numeric properties ─────────────────────────────────────────────────────
// id, name, unit, the value of an element (null when not known), log: plot
// on a log axis, fmt: digits. A view that needs a property reads this list.
const atomicR = e => e.r.emp ?? e.r.calc ?? null;
export const PROPS = [
  { id: 'mass', name: 'Atomic mass', unit: 'u', get: e => e.mass, digits: 3 },
  { id: 'en', name: 'Electronegativity', short: 'Pauling χ', unit: '', get: e => e.en, digits: 2 },
  { id: 'ie1', name: 'First ionization energy', short: 'Ionization', unit: 'eV', get: e => e.ie[0] ?? null, digits: 2 },
  { id: 'ea', name: 'Electron affinity', unit: 'eV', get: e => e.ea, digits: 2 },
  { id: 'radius', name: 'Atomic radius', unit: 'pm', get: atomicR, digits: 0 },
  { id: 'cov', name: 'Covalent radius', unit: 'pm', get: e => e.r.cov, digits: 0 },
  { id: 'vdw', name: 'Van der Waals radius', unit: 'pm', get: e => e.r.vdw, digits: 0 },
  { id: 'mp', name: 'Melting point', unit: 'K', get: e => e.sublimes ? null : e.mp, digits: 0 },
  { id: 'bp', name: 'Boiling point', unit: 'K', get: e => e.bp, digits: 0 },
  { id: 'density', name: 'Density', unit: 'g/cm³', get: e => e.density, digits: 3, log: true },
  { id: 'crust', name: 'Abundance in the crust', short: 'Crust', unit: 'ppb', get: e => e.ab.crust, log: true, digits: 2 },
  { id: 'ocean', name: 'Abundance in the ocean', short: 'Ocean', unit: 'ppb', get: e => e.ab.ocean, log: true, digits: 2 },
  { id: 'universe', name: 'Abundance in the universe', short: 'Universe', unit: 'ppb', get: e => e.ab.universe, log: true, digits: 2 },
  { id: 'year', name: 'Year of discovery', unit: '', get: e => e.disc.year, digits: 0 },
  { id: 'zeff', name: 'Valence Z_eff (Slater)', short: 'Z_eff', unit: '', get: e => { const v = valence(e); return zeff(e.z, expand(e.cfg), v[0], v[1]); }, digits: 2 },
  { id: 'isotopes', name: 'Stable isotopes', unit: '', get: e => stableCount(e), digits: 0 },
  { id: 'halflife', name: 'Longest half-life', unit: 's', get: e => { const h = longestHalfLife(e); return h === Infinity ? null : h; }, log: true, digits: 2 },
  { id: 'z', name: 'Atomic number', unit: '', get: e => e.z, digits: 0 },
];
export const PROP = Object.fromEntries(PROPS.map(p => [p.id, p]));

// The value range of a property over the table: [lo, hi] (finite and > 0
// for a log property).
const RANGE = new Map();
export function propRange(id) {
  if (RANGE.has(id)) return RANGE.get(id);
  const p = PROP[id];
  const v = ELEMENTS.map(p.get).filter(x => x != null && isFinite(x) && (!p.log || x > 0));
  const r = [Math.min(...v), Math.max(...v)];
  RANGE.set(id, r);
  return r;
}
// 0..1 position of a value in the range of its property, or null.
export function propT(id, e) {
  const p = PROP[id], v = p.get(e);
  if (v == null || !isFinite(v) || (p.log && v <= 0)) return null;
  const [lo, hi] = propRange(id);
  if (hi === lo) return 0.5;
  return p.log ? (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) : (v - lo) / (hi - lo);
}

// 0..1 as a share of the largest value (a linear scale from zero), for the
// tower heights: a bar twice as tall has twice the value.
export function propLinear(id, e) {
  const p = PROP[id], v = p.get(e);
  if (v == null || !isFinite(v)) return null;
  const [lo, hi] = propRange(id);
  if (lo >= 0) return hi > 0 ? v / hi : 0;
  return (v - lo) / (hi - lo);
}

// ── formatting ─────────────────────────────────────────────────────────────
export function fmt(v, digits = 2) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) {
    const ex = Math.floor(Math.log10(a));
    const m = v / Math.pow(10, ex);
    return m.toFixed(m === Math.round(m) ? 0 : 2) + '×10' + supSigned(ex);
  }
  if (digits === 0) return Math.round(v).toLocaleString('en-US');
  const s = v.toFixed(digits);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}
export function supSigned(n) { return (n < 0 ? '⁻' : '') + sup(Math.abs(n)); }
export const kToC = k => k - 273.15;
export function fmtTemp(k) {
  if (k == null) return '—';
  return Math.round(k).toLocaleString('en-US') + ' K · ' + Math.round(kToC(k)).toLocaleString('en-US') + ' °C';
}
export function fmtMass(e) { return e.massNum ? '(' + e.massNum + ')' : fmt(e.mass, e.mass > 100 ? 3 : 4); }
export function fmtHalfLife(s) {
  if (s == null) return 'stable';
  if (s < 0) return 'unstable';
  const Y = 365.25 * 86400;
  const U = [[Y * 1e9, 'Gyr'], [Y * 1e6, 'Myr'], [Y * 1e3, 'kyr'], [Y, 'yr'], [86400, 'd'], [3600, 'h'], [60, 'min'], [1, 's'], [1e-3, 'ms'], [1e-6, 'µs'], [1e-9, 'ns']];
  for (const [k, u] of U) if (s >= k) { const v = s / k; return (v >= 1e4 ? fmt(v, 2) : v >= 100 ? Math.round(v).toString() : v.toPrecision(3).replace(/\.?0+$/, '')) + ' ' + u; }
  return fmt(s, 2) + ' s';
}
export const fmtOx = n => n > 0 ? '+' + n : n < 0 ? '−' + (-n) : '0';
// Abundance in ppb by mass, as text in the most readable unit.
export function fmtPpb(v) {
  if (v == null) return '—';
  if (v >= 1e7) return fmt(v / 1e7, 2) + ' %';
  if (v >= 1e3) return fmt(v / 1e3, 3) + ' ppm';
  return fmt(v, 3) + ' ppb';
}
export const discText = e => e.disc.year ? e.disc.year + (e.disc.by ? ' · ' + e.disc.by : '') : 'Known since antiquity';
