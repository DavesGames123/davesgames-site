// ============================================================================
//  PERIODIC TABLE  ·  saver-plan.js  ·  the screensaver shot plan (no DOM)
// ----------------------------------------------------------------------------
//  planShots(seed, n, { calm }) -> [{ kind, dur, seed, ... }]. A seeded
//  bag: every kind once in a shuffled order, then a new bag. A draw that
//  repeats the last kind swaps with the next one, so no kind plays twice
//  in a row. Each shot has its own random settings, so two runs differ.
//  A shot holds 6 to 12 s. calm (0..1) makes it longer, never past 12 s.
//
//    flight    the 118 tiles fly through three of the six table views;
//              the camera rides the wave of tiles, then pushes in
//    walk      the camera walks one family tile by tile (alkali metals,
//              halogens, period 2 ...); the rest of the table goes dim
//    atom      a push-in on one tile; the tile opens into its live atom
//              (Bohr shells, then orbital clouds) with the ionization
//              staircase and the isotopes beside it
//    melt      a temperature sweep melts and boils the table, live
//    timeline  the discovery years run, a year counter, a flash for each
//              new element
//    tower     a property as height, the 3D tower turns and cranes
//    heat      a heat map; a scan line wipes in a second property
//    scatter   property against property; one family lights up
//    orbit     the spiral or the shells view, a push-in on three elements
//
//  Pure helpers for saver.js and tests.mjs:
//    plateFor(shot, k)   the label plate: title, sub, params, one TeX line
//    spring(...)         a critically damped spring step (the camera)
//    aimUser(T, S, ...)  the T.user pan that centres a world point
//    ieSteps(e)          successive ionization energies by shell
//    isoBars(e)          the isotopes with a natural abundance
//    known(year)         the elements found by a year, and the newest
//    frameOf(band, kind) the table frame (the band less the counter strip)
//    atomLayout(f)       the atom and its two panels in the band
//
//  GREP MAP
//    grep -n "export const KINDS"         the shot kinds
//    grep -n "export const FAMILIES"      the walk families
//    grep -n "export function planShots"  the seeded bag
//    grep -n "export function plateFor"   the plate payload of a shot
//    grep -n "const PROP_TEX"             TeX line of each property
//    grep -n "export function atomLayout" the close-up boxes
// ============================================================================
import { ELEMENTS, CAT, PROP, cfgUnicode, valence, zeff, expand, fmt, fmtMass, L_LETTER, SHELL_LETTER } from './chem.js';
import { VIEW } from './layouts.js';

export const KINDS = ['flight', 'walk', 'atom', 'melt', 'timeline', 'tower', 'heat', 'scatter', 'orbit'];

// The six views that read as a table; flight picks three of them.
export const FLIGHT_VIEWS = ['standard', 'long', 'spiral', 'radial', 'janet', 'blocks'];
const PROPS_H = ['density', 'ie1', 'en', 'mp', 'bp', 'radius', 'mass', 'zeff'];
const PROPS_HEAT = ['en', 'ie1', 'radius', 'density', 'mp', 'bp', 'ea', 'crust', 'universe', 'year', 'zeff'];
export const MAPS = ['magma', 'inferno', 'viridis', 'plasma', 'mako', 'rocket', 'turbo', 'aurora', 'nebula', 'ember', 'glacier', 'synthwave', 'gold-leaf', 'cubehelix', 'ice', 'hot-iron'];
const PAIRS = [['radius', 'ie1'], ['mass', 'density'], ['en', 'ie1'], ['radius', 'en'], ['mp', 'bp'], ['z', 'zeff']];
// Elements that make a good close-up (light, transition, heavy, odd ones).
export const ATOMS = [1, 2, 6, 7, 8, 10, 11, 15, 17, 24, 26, 29, 36, 47, 54, 55, 64, 79, 80, 82, 86, 92, 94, 118];
// Families for the walk: Z in walk order, and the property the plate follows.
export const FAMILIES = [
  { id: 'alkali', name: 'The alkali metals', z: [3, 11, 19, 37, 55, 87], prop: 'ie1', note: 'one s electron outside a noble-gas core' },
  { id: 'halogen', name: 'The halogens', z: [9, 17, 35, 53, 85], prop: 'en', note: 'one electron short of a full p shell' },
  { id: 'noble', name: 'The noble gases', z: [2, 10, 18, 36, 54, 86], prop: 'ie1', note: 'full shells: the peaks of ionization energy' },
  { id: 'coinage', name: 'The coinage metals', z: [29, 47, 79], prop: 'density', note: 'd10 s1: the Aufbau exceptions Cu, Ag, Au' },
  { id: 'carbon', name: 'The carbon group', z: [6, 14, 32, 50, 82], prop: 'radius', note: 'from nonmetal to metal down one group' },
  { id: 'period2', name: 'Across period 2', z: [3, 4, 5, 6, 7, 8, 9, 10], prop: 'radius', note: 'Z_eff grows, the atoms shrink' },
  { id: 'lanthanide', name: 'The lanthanides', z: [57, 60, 63, 64, 68, 71], prop: 'radius', note: 'the 4f shell fills: the lanthanide contraction' },
  { id: 'transition', name: 'The 3d metals', z: [22, 24, 26, 28, 29, 30], prop: 'density', note: 'the 3d shell fills across period 4' },
];
export const FAMILY = Object.fromEntries(FAMILIES.map(f => [f.id, f]));

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
function shuffle(r, a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export function planShots(seed = 1, n = 24, { calm = 0 } = {}) {
  const r = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const slow = 1 + 0.45 * clamp(+calm || 0, 0, 1);
  const out = [];
  let bag = [], lastMap = '', lastView = '';
  while (out.length < n) {
    if (!bag.length) bag = shuffle(r, KINDS.slice());
    let kind = bag.shift();
    if (out.length && kind === out[out.length - 1].kind) {
      if (bag.length) { const k2 = bag.shift(); bag.unshift(kind); kind = k2; }
      else { bag = shuffle(r, KINDS.filter(k => k !== kind)); bag.push(kind); kind = bag.shift(); }
    }
    let dur = 6 + 6 * r();
    const S = { kind, dur: 0, seed: Math.floor(r() * 1e9) };
    const map = () => { const m = pick(r, MAPS.filter(x => x !== lastMap)); lastMap = m; return m; };
    if (kind === 'flight') {
      S.views = shuffle(r, FLIGHT_VIEWS.filter(v => v !== lastView)).slice(0, 3);
      S.focus = shuffle(r, ATOMS.slice()).slice(0, 3);
      dur = 9 + 3 * r();
    }
    if (kind === 'walk') {
      const f = pick(r, FAMILIES);
      S.family = f.id; S.view = pick(r, ['standard', 'long', 'standard']);
      dur = f.z.length * 1.7 + 0.8;
    }
    if (kind === 'atom') { S.z = pick(r, ATOMS); S.view = pick(r, ['standard', 'long', 'blocks', 'janet']); dur = 10 + 2 * r(); }
    if (kind === 'melt') { S.from = pick(r, [10, 50, 200]); S.to = pick(r, [2500, 4000, 6000]); S.view = pick(r, ['standard', 'long', 'spiral', 'janet']); dur = 9 + 3 * r(); }
    if (kind === 'timeline') { S.from = pick(r, [1650, 1700, 1750]); S.view = 'timeline'; dur = 10 + 2 * r(); }
    if (kind === 'tower') { S.prop = pick(r, PROPS_H); S.cmap = map(); S.turn = (r() < 0.5 ? -1 : 1) * (0.3 + 0.25 * r()); S.yaw0 = -1.1 + 0.9 * r(); }
    if (kind === 'heat') { S.props = shuffle(r, PROPS_HEAT.slice()).slice(0, 2); S.cmaps = [map(), map()]; S.view = pick(r, ['heat', 'long', 'spiral', 'janet', 'radial']); dur = 8 + 4 * r(); }
    if (kind === 'scatter') { const p = pick(r, PAIRS); S.x = p[0]; S.y = p[1]; S.cmap = map(); S.family = pick(r, ['alkali', 'noble', 'halogen', 'transition']); }
    if (kind === 'orbit') { S.view = pick(r, ['spiral', 'radial']); S.focus = shuffle(r, ATOMS.slice()).slice(0, 3); dur = 8 + 4 * r(); }
    S.dur = Math.round(clamp(dur * slow, 6, 12) * 10) / 10;
    lastView = S.views ? S.views[2] : S.view || lastView;
    out.push(S);
  }
  return out;
}

// ── TeX lines ──────────────────────────────────────────────────────────────
export const TEX = {
  aufbau: '\\text{fill order: } n + \\ell \\uparrow,\\ \\text{then } n \\uparrow',
  shell: 'N_{\\max}(n) = 2n^2',
  gibbs: '\\Delta G = \\Delta H - T\\,\\Delta S = 0 \\ \\text{at the phase change}',
  zeff: 'Z_{\\mathrm{eff}} = Z - S',
  ie: 'E_n \\approx -13.6\\,\\mathrm{eV}\\,\\frac{Z_{\\mathrm{eff}}^2}{n^2}',
  radius: 'r_n \\approx a_0\\,\\frac{n^2}{Z_{\\mathrm{eff}}}',
  en: '\\chi_A - \\chi_B = \\sqrt{E_{AB} - \\tfrac{1}{2}(E_{AA} + E_{BB})}',
  density: '\\rho = \\frac{m}{V}',
  mass: 'm \\approx Z\\,m_p + N\\,m_n - \\frac{E_B}{c^2}',
  abund: '\\log_{10} \\text{ abundance (ppb)}',
};
const PROP_TEX = { ie1: TEX.ie, en: TEX.en, radius: TEX.radius, density: TEX.density, mp: TEX.gibbs, bp: TEX.gibbs, zeff: TEX.zeff, mass: TEX.mass, ea: TEX.ie, crust: TEX.abund, universe: TEX.abund, z: TEX.zeff };
const VIEW_TEX = { standard: TEX.zeff, long: TEX.aufbau, spiral: TEX.shell, radial: TEX.shell, janet: TEX.aufbau, blocks: TEX.aufbau, heat: TEX.zeff };
const CREDIT = 'Data: komed3/periodic-table (MIT), PubChem (public domain)';

const unit = id => PROP[id].unit ? ' ' + PROP[id].unit : '';
export function valueOf(id, e) { const p = PROP[id], v = p.get(e); return v == null || !isFinite(v) ? '—' : fmt(v, p.digits > 2 ? 2 : p.digits) + unit(id); }
function zeffText(e) { const v = valence(e); return `${fmt(zeff(e.z, expand(e.cfg), v[0], v[1]), 2)} (${v[0]}${L_LETTER[v[1]]})`; }
const elParams = e => [
  { name: 'Z', value: String(e.z) },
  { name: 'mass', value: fmtMass(e) + ' u' },
  { name: 'shells', value: e.shells.join(' · ') },
];

// The plate of a shot. k: the sub-state that the plate follows (the view
// index of a flight, the member of a walk, { year, newest } of a timeline,
// the property index of a heat map, the focus index of an orbit).
export function plateFor(sh, k = 0) {
  let P;
  if (sh.kind === 'flight') {
    const v = VIEW[sh.views[clamp(k | 0, 0, sh.views.length - 1)]];
    P = { title: v.name, sub: v.hint, tex: [VIEW_TEX[v.id] || TEX.aufbau],
      params: [{ name: 'view', value: `${(k | 0) + 1} of ${sh.views.length}` }, { name: 'elements', value: '118' }] };
  } else if (sh.kind === 'walk') {
    const f = FAMILY[sh.family], e = ELEMENTS[f.z[clamp(k | 0, 0, f.z.length - 1)] - 1];
    P = { title: f.name, sub: `${e.name} · ${e.sym}: ${cfgUnicode(e)}`, tex: [PROP_TEX[f.prop] || TEX.zeff],
      params: [{ name: 'Z', value: String(e.z) }, { name: PROP[f.prop].short || PROP[f.prop].name, value: valueOf(f.prop, e) }, { name: 'valence Z_eff', value: zeffText(e) }],
      lines: [f.note, CREDIT] };
  } else if (sh.kind === 'atom') {
    const e = ELEMENTS[sh.z - 1];
    P = { title: `${e.name} · ${e.sym}`, sub: `${CAT[e.cat].name}: ${cfgUnicode(e)}`, tex: [k ? TEX.ie : TEX.zeff],
      params: [...elParams(e), { name: 'valence Z_eff', value: zeffText(e) }],
      lines: ['Bohr shells, then orbital clouds; sizes for legibility, not to scale', CREDIT] };
  } else if (sh.kind === 'melt') {
    P = { title: 'Melting the table', sub: `${sh.from} K to ${sh.to.toLocaleString('en-US')} K at 1 atm: solid, liquid, gas`, tex: [TEX.gibbs],
      params: [{ name: 'view', value: VIEW[sh.view].name }] };
  } else if (sh.kind === 'timeline') {
    const s = k && typeof k === 'object' ? k : { year: sh.from, newest: [] };
    const n = s.newest || [];
    P = { title: 'The discovery of the elements',
      sub: n.length ? `${s.year}: ${n.map(e => e.name).join(', ')}${n[0].disc.by ? ' · ' + n[0].disc.by : ''}` : `from ${sh.from} to today`,
      tex: [], params: [{ name: 'year', value: String(s.year) }, { name: 'known', value: String(known(s.year).count) }] };
  } else if (sh.kind === 'tower') {
    const top = topBy(sh.prop, 3);
    P = { title: PROP[sh.prop].name, sub: 'a property as height, across the table', tex: [PROP_TEX[sh.prop] || TEX.zeff],
      params: [{ name: 'highest', value: top.map(e => e.sym).join(' · ') }, { name: 'colour map', value: sh.cmap }] };
  } else if (sh.kind === 'heat') {
    const j = clamp(k | 0, 0, 1), id = sh.props[j];
    P = { title: PROP[id].name, sub: `a heat map on the ${sh.view === 'heat' ? 'standard' : VIEW[sh.view].name.toLowerCase()} table`, tex: [PROP_TEX[id] || TEX.zeff].filter(Boolean),
      params: [{ name: 'highest', value: topBy(id, 3).map(e => e.sym).join(' · ') }, { name: 'colour map', value: sh.cmaps[j] }] };
  } else if (sh.kind === 'scatter') {
    P = { title: `${PROP[sh.y].name} against ${PROP[sh.x].name}`, sub: k ? `every element as a point; ${FAMILY[sh.family].name.toLowerCase()} lit` : 'every element as a point',
      tex: [PROP_TEX[sh.y] || TEX.zeff], params: [{ name: 'colour map', value: sh.cmap }] };
  } else if (sh.kind === 'orbit') {
    const e = ELEMENTS[sh.focus[clamp(k | 0, 0, sh.focus.length - 1)] - 1];
    P = { title: VIEW[sh.view].name, sub: `${e.name} · ${e.sym}: ${cfgUnicode(e)}`, tex: [TEX.shell],
      params: [{ name: 'Z', value: String(e.z) }, { name: 'shell n', value: String(e.shells.length) }, { name: 'shells', value: e.shells.join(' · ') }] };
  }
  P.lines = P.lines || [CREDIT];
  return P;
}

// The n elements with the largest value of a property (cached: the plate
// asks for it every frame, and some getters are slow, for example Z_eff).
const TOP = new Map();
export function topBy(id, n) {
  if (!TOP.has(id)) {
    const p = PROP[id];
    TOP.set(id, ELEMENTS.map(e => [e, p.get(e)]).filter(([, v]) => v != null && isFinite(v)).sort((a, b) => b[1] - a[1]).map(([e]) => e));
  }
  return TOP.get(id).slice(0, n);
}

// ── discovery ──────────────────────────────────────────────────────────────
// The elements known by a year: count, and the ones found in the newest
// year of discovery up to it. Antiquity counts as known from the start.
export function known(year) {
  let count = 0, best = -Infinity, newest = [];
  for (const e of ELEMENTS) {
    const y = e.disc.year;
    if (y != null && y > year) continue;
    count++;
    if (y == null) continue;
    if (y > best) { best = y; newest = [e]; } else if (y === best) newest.push(e);
  }
  return { count, newest, year: best };
}

// ── atom panels ────────────────────────────────────────────────────────────
// Successive ionization energies: [{ k, eV, shell, jump }]. The k-th
// electron comes from the outermost shell that still holds one; jump is
// true on the first electron of a new (inner) shell.
export function ieSteps(e) {
  const left = e.shells.slice();
  const out = [];
  let prev = -1;
  for (let k = 0; k < e.ie.length; k++) {
    const v = e.ie[k];
    if (v == null || !isFinite(v)) break;
    let s = left.length - 1;
    while (s > 0 && left[s] === 0) s--;
    if (left[s] > 0) left[s]--;
    out.push({ k: k + 1, eV: v, shell: SHELL_LETTER[s], jump: prev >= 0 && s !== prev });
    prev = s;
  }
  return out;
}
// The isotopes with a natural abundance (percent), largest first.
export function isoBars(e, n = 6) {
  return e.iso.filter(i => i[1] != null && i[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([A, pct]) => ({ A, pct }));
}

// ── camera ─────────────────────────────────────────────────────────────────
// One step of a critically damped spring: x toward target with angular
// frequency w. Returns [x, v]. Stable at any dt (closed form).
export function spring(x, v, target, w, dt) {
  const d = x - target, e = Math.exp(-w * dt);
  const c = v + w * d;
  return [target + (d + c * dt) * e, (v - c * w * dt) * e];
}
// T.user { zoom, px, py } that puts world point (x, y) at the centre of
// S.frame at a given zoom. It probes the Table's own fitCamera with no
// pan (camSnap), reads the centre and scale, then puts the camera back.
// fitCamera has the form cx = base - px / k, so the pan is exact for any
// base that fitCamera picks (a left anchor on a phone, a legend offset).
// k1 is the screen px of one world unit at zoom 1.
export function aimUser(T, S, x, y, zoom) {
  const cam = { ...T.cam }, snap = T.camSnap, user = { ...T.user }, hint = T.panHint;
  T.user.zoom = zoom; T.user.px = 0; T.user.py = 0;
  T.camSnap = true; T.fitCamera(S, S.frame.w, S.frame.h, 0);
  const { k, cx, cy } = T.cam;
  Object.assign(T.cam, cam); Object.assign(T.user, user); T.camSnap = snap; T.panHint = hint;
  return { zoom, px: (cx - x) * k, py: (cy - y) * k, k1: k / zoom };
}

// ── layout in the clear band ───────────────────────────────────────────────
// The table frame of a shot: the band, less a strip for the year counter.
export function frameOf(band, kind) {
  if (kind !== 'timeline') return band;
  if (band.w > band.h * 1.2) { const s = Math.round(band.w * 0.22); return { x: band.x, y: band.y, w: band.w - s, h: band.h, strip: { x: band.x + band.w - s, y: band.y, w: s, h: band.h } }; }
  const s = Math.round(band.h * 0.2);
  return { x: band.x, y: band.y + s, w: band.w, h: band.h - s, strip: { x: band.x, y: band.y, w: band.w, h: s } };
}
// The atom and its two panels in the band: wide band, atom on the left;
// tall band, atom on top.
export function atomLayout(f) {
  if (f.w > f.h * 1.25) {
    const side = Math.min(f.h, f.w * 0.56);
    const atom = { x: f.x + f.w * 0.3 - side / 2, y: f.y + (f.h - side) / 2, w: side, h: side };
    const px = Math.max(atom.x + side + f.w * 0.04, f.x + f.w * 0.6), pw = Math.min(f.x + f.w - px, 420);
    const ph = Math.min(f.h * 0.44, 220);
    return { atom, ie: { x: px, y: f.y + f.h / 2 - ph - 10, w: pw, h: ph }, iso: { x: px, y: f.y + f.h / 2 + 18, w: pw, h: ph * 0.8 } };
  }
  const side = Math.min(f.w * 0.9, f.h * 0.62);
  const atom = { x: f.x + (f.w - side) / 2, y: f.y, w: side, h: side };
  const py = f.y + side + 12, ph = Math.max(0, f.y + f.h - py), pw = f.w / 2 - 10;
  return { atom, ie: { x: f.x, y: py, w: pw, h: ph }, iso: { x: f.x + pw + 20, y: py, w: pw, h: ph } };
}
