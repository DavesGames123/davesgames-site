// ============================================================================
//  VIRUS ATLAS  ·  regions.js — capsomers, regions and the exploded view
// ----------------------------------------------------------------------------
//  No DOM and no three.js: tests.mjs runs this file in Node on the real
//  bead files. Lengths are in nm. A unit is one chain of one copy, index
//  u = k * nChains + c (symmetry.js unitCentroids).
//
//  TABLE      unitTable(d, ops): centroids, chain roles, "big" chains (main
//             chains of 40 % of the longest main chain or more)
//  CAPSOMERS  capsomers(T, entry, axes): every ring in the shell
//               pentamer   5 copies of the chain nearest a 5-fold axis
//               hexamer    6 units around a 3-fold axis (T = 3), a 2-fold
//                          axis (T = 4), or a ring of 6 in contact
//                          (T = 7, the HIV cone)
//               trimer     3 units in contact (the adenovirus hexon)
//               pentamer6  a pentamer on a 6-coordinated site (HPV)
//             Contact rings: same entity, each pair closer than 1.3 times
//             the nearest-neighbour distance of both units.
//  REGIONS    regionsOf(entry, parts): the region kinds of one entry, each
//             with every instance: { kind, inst: [{ units, centre, axis }],
//             n, chains, sym, tex }. Kinds: pentamer, hexamer, trimer,
//             pentamer6, au (one asymmetric unit), face (one face of the
//             icosahedron), section (3 turns of the TMV rod), layers (5
//             fibril layers), filament (one protofilament), spike (one
//             spike of a virion), protomer (one chain of a protein), rbd
//             (the receptor-binding domain on ACE2)
//  EXPLODE    explodePlan(T, opts): a direction, a stagger key (0..1) and
//             a group per unit, for one axis set (5, 3, 2), radial (-1) or
//             capsomer ('cap') and one stagger ('distance', 'ring', 'copy',
//             'type'). explodeAmount and unitOffset are the same curve
//             that glsl.js unitMove uses (uExT, uExStag), so a camera can
//             follow a part. selTable packs it for pack.js packSel.
//             TIMELINE: exT and the isolation over one shot (0..1).
//  EXTENT     regionExtent: the bead radius of a set of units round a point
//  FRAME      fitDistance(r, view) and screenOf(p, cam, view): the camera
//             distance that fits a ball in the clear band, and the pixel
//             of a point (main.js and the tests share these)
//
//  grep -n targets: "export function unitTable", "export function capsomers",
//    "export function regionsOf", "export function explodePlan",
//    "export function explodeAmount", "export function unitOffset", "export const TIMELINE",
//    "export function regionExtent", "export function fitDistance",
//    "export function screenOf", "export function selTable"
// ============================================================================
import { unitCentroids, easeInOut } from './symmetry.js';

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
const neg = a => [-a[0], -a[1], -a[2]];

// ── the unit table ─────────────────────────────────────────────────────────
export function unitTable(d, ops) {
  const nc = d.info.chains.length, m = ops.length / 12, cent = unitCentroids(d, ops), U = cent.length / 3;
  const len = d.info.chains.map(c => c[3]), ent = d.info.chains.map(c => c[2]);
  const role = d.info.chains.map(c => d.info.entities[c[2]].role);
  const maxMain = Math.max(1, ...len.filter((_, i) => role[i] === 'main'));
  const big = role.map((r, i) => r === 'main' && len[i] >= 0.4 * maxMain);
  const P = u => [cent[3 * u], cent[3 * u + 1], cent[3 * u + 2]];
  return { d, ops, nc, m, U, cent, len, ent, role, big, P, dir: u => norm(P(u)) };
}
const centreOf = (T, units) => {
  const c = [0, 0, 0];
  for (const u of units) { c[0] += T.cent[3 * u]; c[1] += T.cent[3 * u + 1]; c[2] += T.cent[3 * u + 2]; }
  const n = Math.max(1, units.length);
  return [c[0] / n, c[1] / n, c[2] / n];
};

// The n big units nearest (in angle) to the line dir; ok when the next one
// is clearly farther (a gap of 20 %).
function ringOnAxis(T, dir, n) {
  const list = [];
  for (let u = 0; u < T.U; u++) if (T.big[u % T.nc]) list.push([angle(T.dir(u), dir), u]);
  list.sort((a, b) => a[0] - b[0]);
  const ring = list.slice(0, n), next = list[n];
  const ok = ring.length === n && (!next || next[0] > 1.2 * ring[n - 1][0]);
  return { units: ring.map(x => x[1]), ok };
}

// Rings in contact: same entity, mutual near neighbours.
function contactRings(T) {
  const us = [];
  for (let u = 0; u < T.U; u++) if (T.big[u % T.nc]) us.push(u);
  // no n x n table: the HIV cone has 1356 units (a 7 MB table on a phone)
  const n = us.length, nn = new Float64Array(n).fill(Infinity);
  const dist = (a, b) => Math.hypot(T.cent[3 * a] - T.cent[3 * b], T.cent[3 * a + 1] - T.cent[3 * b + 1], T.cent[3 * a + 2] - T.cent[3 * b + 2]);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (T.ent[us[i] % T.nc] !== T.ent[us[j] % T.nc]) continue;
    const d = dist(us[i], us[j]);
    if (d < nn[i]) nn[i] = d; if (d < nn[j]) nn[j] = d;
  }
  const par = Int32Array.from({ length: n }, (_, i) => i);
  const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (T.ent[us[i] % T.nc] !== T.ent[us[j] % T.nc]) continue;
    const d = dist(us[i], us[j]);
    if (d < 1.3 * nn[i] && d < 1.3 * nn[j]) par[find(i)] = find(j);
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(us[i]); }
  const out = [];
  for (const g of groups.values()) {
    if (g.length !== 3 && g.length !== 5 && g.length !== 6) continue;
    // a ring: every unit at about the same distance from the centre
    const c = centreOf(T, g), r = g.map(u => Math.hypot(T.cent[3 * u] - c[0], T.cent[3 * u + 1] - c[1], T.cent[3 * u + 2] - c[2]));
    const mean = r.reduce((a, v) => a + v, 0) / r.length;
    if (r.every(v => Math.abs(v - mean) < 0.25 * mean)) out.push(g.sort((a, b) => a - b));
  }
  return out;
}

// Every capsomer of a shell: [{ type, units, centre, axis }]
export function capsomers(T, entry, axes = []) {
  const out = [];
  const fives = axes.filter(a => a.order === 5).flatMap(a => [a.dir, neg(a.dir)]);
  for (const a of fives) {
    const r = ringOnAxis(T, a, 5);
    if (r.ok) out.push({ type: 'pentamer', units: r.units.sort((p, q) => p - q), centre: centreOf(T, r.units), axis: a });
  }
  const Tn = entry && entry.T ? entry.T.T : 0;
  const hexOrder = Tn === 3 ? 3 : Tn === 4 ? 2 : 0;
  if (hexOrder) {
    for (const a of axes.filter(x => x.order === hexOrder).flatMap(x => [x.dir, neg(x.dir)])) {
      const r = ringOnAxis(T, a, 6);
      if (r.ok) out.push({ type: 'hexamer', units: r.units.sort((p, q) => p - q), centre: centreOf(T, r.units), axis: a, on: hexOrder });
    }
  } else if (Tn >= 7 || (entry && entry.look === 'cone')) {
    for (const g of contactRings(T)) {
      const c = centreOf(T, g), ax = norm(c);
      if (fives.some(a => angle(a, ax) < 0.07)) continue;   // a 5-fold ring, found above
      const type = g.length === 6 ? 'hexamer' : g.length === 3 ? 'trimer' : entry.look === 'cone' ? 'pentamer' : 'pentamer6';
      out.push({ type, units: g, centre: c, axis: ax });
    }
  }
  return out;
}

// ── region kinds ───────────────────────────────────────────────────────────
const cleanDesc = s => {
  let t = String(s || '').split(',').pop().trim();
  const par = /^(.*?)\s*\((.*)\)$/.exec(t);
  if (par) { const sub = /SUBUNIT (\w+)/i.exec(par[2]); t = sub ? 'coat protein ' + sub[1] : par[2]; }
  if (t === t.toUpperCase()) t = t.toLowerCase().replace(/\b(vp\d|l1|ca|gp\d+|hbv)\b/g, w => w.toUpperCase());
  return t;
};
export function chainName(d, c) { return cleanDesc(d.info.entities[d.info.chains[c][2]].desc); }
// "5 × coat protein VP1 (chain A)" for a set of units
export function chainsText(T, units) {
  const by = new Map();
  for (const u of units) {
    const c = u % T.nc;
    if (T.role[c] === 'glycan') continue;
    const name = chainName(T.d, c);
    if (!by.has(name)) by.set(name, { n: 0, ids: new Set() });
    const b = by.get(name); b.n++; b.ids.add(T.d.info.chains[c][0]);
  }
  return [...by.entries()].map(([name, b]) => `${b.n} × ${name}` + (b.ids.size <= 3 ? ` (chain ${[...b.ids].join(', ')})` : '')).join(', ');
}
const mainCount = (T, units) => units.filter(u => T.role[u % T.nc] !== 'glycan' && T.role[u % T.nc] !== 'antibody').length;
const copyUnits = (T, k, keep = () => true) => { const o = []; for (let c = 0; c < T.nc; c++) if (keep(c)) o.push(k * T.nc + c); return o; };

export const REGION_NAMES = {
  pentamer: 'a pentamer at a 5-fold vertex', hexamer: 'a hexamer', trimer: 'a hexon trimer', pentamer6: 'a pentamer on a 6-fold site',
  au: 'one asymmetric unit', face: 'one face of the icosahedron', section: 'three turns of the rod', layers: 'five layers of the fibril',
  filament: 'one protofilament', spike: 'one spike', protomer: 'one protomer', rbd: 'the receptor-binding domain (RBD)',
};

// parts: [{ d, ops, axes }] as main.js builds them (one part, or the
// spike parts of a virion). -> [{ kind, part, inst: [{ units, centre,
// axis }], label, sym, tex }]
export function regionsOf(entry, parts) {
  const look = entry.look, out = [];
  const p0 = parts[0], T = p0.T || unitTable(p0.d, p0.ops);
  const add = (kind, inst, extra = {}) => { if (inst.length && inst[0].units.length) out.push({ kind, part: 0, inst, label: extra.label || REGION_NAMES[kind], ...extra }); };
  if (look === 'capsid' || look === 'cone') {
    const caps = p0.caps || capsomers(T, entry, p0.axes || []);
    for (const type of ['pentamer', 'hexamer', 'trimer', 'pentamer6']) {
      const inst = caps.filter(c => c.type === type).map(c => ({ units: c.units, centre: c.centre, axis: norm(c.axis) }));
      const order = type === 'hexamer' ? 6 : type === 'trimer' ? 3 : 5, on = (caps.find(c => c.type === type) || {}).on;
      // only the 5-fold ring is exact; the others are quasi-symmetric
      const exact = type === 'pentamer' && look === 'capsid';
      add(type, inst, { sym: exact ? `C_${order}` : 'quasi', label: on ? `a hexamer on a ${on}-fold axis` : REGION_NAMES[type],
        tex: exact ? `\\theta = 360^\\circ / ${order} = ${360 / order}^\\circ` : `\\text{quasi-}C_${order}:\\ \\theta \\approx ${360 / order}^\\circ` });
    }
    if (look === 'capsid') {
      const keep = c => T.role[c] === 'main' || T.role[c] === 'nucleic';
      add('au', Array.from({ length: T.m }, (_, k) => { const units = copyUnits(T, k, keep); const c = centreOf(T, units); return { units, centre: c, axis: norm(c) }; }),
        { sym: 'C_1', tex: '\\tfrac{1}{60}\\ \\text{of the shell}' });
      const threes = (p0.axes || []).filter(a => a.order === 3).flatMap(a => [a.dir, neg(a.dir)]);
      if (threes.length === 20) {
        const cells = threes.map(() => []);
        for (let u = 0; u < T.U; u++) {
          if (!keep(u % T.nc)) continue;
          const p = T.dir(u); let best = -2, bi = 0;
          threes.forEach((a, i) => { const v = dot(a, p); if (v > best) { best = v; bi = i; } });
          cells[bi].push(u);
        }
        add('face', cells.map((units, i) => ({ units, centre: centreOf(T, units), axis: threes[i] })), { sym: 'C_3', tex: '20\\ \\text{faces} \\times 3\\ \\text{copies} = 60' });
      }
    }
  } else if (look === 'rod') {
    const h = T.d.info.helix, spt = 2 * Math.PI / Math.abs(h.twist), n = Math.round(3 * spt), k0 = Math.floor((T.m - n) / 2);
    const inst = [];
    for (const k1 of [k0 - 2 * n, k0, k0 + 2 * n]) {
      const units = [];
      for (let k = k1; k < k1 + n; k++) units.push(...copyUnits(T, k));
      inst.push({ units, centre: centreOf(T, units), axis: null });
    }
    add('section', inst, { sym: 'helix', tex: `P = ${spt.toFixed(2)} \\times ${(Math.abs(h.rise) / 10).toFixed(3)}\\,\\text{nm} = ${(spt * Math.abs(h.rise) / 10).toFixed(2)}\\,\\text{nm}` });
    add('au', [Math.floor(T.m / 2)].map(k => { const units = copyUnits(T, k); return { units, centre: centreOf(T, units), axis: null }; }), { sym: 'C_1', tex: '3\\ \\text{nucleotides per subunit}' });
  } else if (look === 'fibril') {
    const h = T.d.info.helix, n = 5, mid = Math.floor(T.m / 2);
    const inst = [mid - 9, mid - 2, mid + 5].map(k0 => { const units = []; for (let k = k0; k < k0 + n; k++) units.push(...copyUnits(T, k)); return { units, centre: centreOf(T, units), axis: null }; });
    add('layers', inst, { sym: 'cross-β', tex: `${n} \\times ${(Math.abs(h.rise) / 10).toFixed(2)}\\,\\text{nm} = ${(n * Math.abs(h.rise) / 10).toFixed(1)}\\,\\text{nm}` });
    if (T.nc === 2) add('filament', [0, 1].map(c => { const units = []; for (let k = 0; k < T.m; k++) units.push(k * T.nc + c); const ce = centreOf(T, units); return { units, centre: ce, axis: norm([ce[0], 0, ce[2]]) }; }),
      { sym: '2_1', tex: '2\\ \\text{protofilaments}' });
  } else if (look === 'virion') {
    add('spike', Array.from({ length: T.m }, (_, k) => {
      const units = copyUnits(T, k), o = 12 * k;
      return { units, centre: centreOf(T, units), axis: norm([T.ops[o + 3], T.ops[o + 7], T.ops[o + 11]]) };
    }), { sym: 'C_3', tex: '3\\ \\text{protomers}' });
  } else if (look === 'protein') {
    if (T.role.includes('receptor')) {
      const units = copyUnits(T, 0, c => T.role[c] === 'main');
      add('rbd', [{ units, centre: centreOf(T, units), axis: null }], { sym: '1:1', tex: '\\text{RBD} + \\text{ACE2}' });
    } else if (T.m > 1) {
      add('protomer', Array.from({ length: T.m }, (_, k) => { const units = copyUnits(T, k, c => T.role[c] === 'main'); const c = centreOf(T, units); return { units, centre: c, axis: norm([c[0], 0, c[2]]) }; }),
        { sym: `C_${T.m}`, tex: `1\\ \\text{of}\\ ${T.m}\\ \\text{copies}` });
    } else {
      const mains = []; for (let c = 0; c < T.nc; c++) if (T.role[c] === 'main' && T.big[c]) mains.push(c);
      if (mains.length > 1) add('protomer', mains.map(c => { const ce = centreOf(T, [c]); return { units: [c], centre: ce, axis: norm([ce[0], 0, ce[2]]) }; }),
        { sym: `C_${mains.length}`, tex: `1\\ \\text{of}\\ ${mains.length}\\ \\text{chains}` });
    }
  }
  for (const r of out) { r.n = mainCount(T, r.inst[0].units); r.chains = chainsText(T, r.inst[0].units); }
  return out;
}
// The region kinds each entry can show (the plan draws from these)
export const REGION_KINDS = {
  polio: ['pentamer', 'hexamer', 'au', 'face'], rhino: ['pentamer', 'hexamer', 'au', 'face'], noro: ['pentamer', 'hexamer', 'au', 'face'],
  hbv: ['pentamer', 'hexamer', 'au', 'face'], hpv: ['pentamer', 'pentamer6', 'au', 'face'], adeno: ['pentamer', 'trimer', 'au', 'face'],
  zika: ['pentamer', 'au', 'face'], hk97: ['pentamer', 'hexamer', 'au', 'face'], tmv: ['section', 'au'], 'hiv-cone': ['hexamer', 'pentamer'],
  'sars2-virion': ['spike'], 'flu-virion': ['spike'], 'prion-263k': ['layers'], 'prion-rml': ['layers'], 'prp-fibril': ['layers', 'filament'],
  tau: ['layers', 'filament'], asyn: ['layers', 'filament'], spike: ['protomer'], ha: ['protomer'], na: ['protomer'], env: ['protomer'],
  'hiv-ca': ['protomer'], ebola: ['protomer'], rabies: ['protomer'], measles: ['protomer'], 'rbd-ace2': ['rbd'],
};

// ── the exploded view ──────────────────────────────────────────────────────
// opts: { mode: 5 | 3 | 2 | -1 | 'cap', stagger: 'distance' | 'ring' |
// 'copy' | 'type', pole: [x,y,z], axes, caps, look }
// -> { dirs Float32Array(3U), keys Float32Array(U) in [0, 1], group
//      Int32Array(U), groups: [{ units, centre, dir }] }
// Each unit moves as part of a group (the units round one axis, or one
// capsomer, or one copy), and a group leaves at one time, so the parts
// read as blocks.
export function explodePlan(T, opts = {}) {
  const U = T.U, dirs = new Float32Array(3 * U), keys = new Float32Array(U), group = new Int32Array(U).fill(-1);
  const pole = norm(opts.pole || [0, 1, 0]), mode = opts.mode, axes = opts.axes || [];
  let centres = [];   // group directions
  const caps = mode === 'cap' ? (opts.caps || []) : null;
  if (caps && caps.length) {
    centres = caps.map(c => norm(c.centre));
    caps.forEach((c, g) => { for (const u of c.units) group[u] = g; });
  } else if (mode === 5 || mode === 3 || mode === 2) {
    centres = axes.filter(a => a.order === mode).flatMap(a => [a.dir, neg(a.dir)]);
  }
  if (!centres.length && opts.look === 'capsid') centres = axes.filter(a => a.order === 5).flatMap(a => [a.dir, neg(a.dir)]);
  for (let u = 0; u < U; u++) {
    const p = T.dir(u);
    if (group[u] < 0) {
      if (centres.length) { let best = -2; centres.forEach((a, i) => { const v = dot(a, p); if (v > best) { best = v; group[u] = i; } }); }
      else group[u] = Math.floor(u / T.nc);   // one copy (a spike) per group
    }
    let d;
    if (mode === 5 || mode === 3 || mode === 2) { const a = centres[group[u]] || p; d = norm([0.85 * a[0] + 0.15 * p[0], 0.85 * a[1] + 0.15 * p[1], 0.85 * a[2] + 0.15 * p[2]]); }
    else if (mode === 'cap' && caps && caps.length) d = centres[group[u]];
    else d = Math.hypot(T.cent[3 * u], T.cent[3 * u + 1], T.cent[3 * u + 2]) > 1e-6 ? p : [0, 1, 0];
    dirs[3 * u] = d[0]; dirs[3 * u + 1] = d[1]; dirs[3 * u + 2] = d[2];
  }
  const G = Math.max(...group) + 1, gu = Array.from({ length: G }, () => []);
  for (let u = 0; u < U; u++) gu[group[u]].push(u);
  const groups = gu.map((units, g) => {
    const c = centreOf(T, units);
    return { units, centre: c, dir: centres[g] ? centres[g].slice() : norm(c), type: caps && caps[g] ? caps[g].type : null };
  });
  // stagger key per group
  const st = opts.stagger || 'distance';
  const gk = groups.map((g, i) => {
    const a = g.units.length ? angle(norm(g.centre), pole) / Math.PI : 0;
    if (st === 'ring') return Math.round(a * 5) / 5;
    if (st === 'copy') return i;
    if (st === 'type') return (g.type === 'pentamer' ? 0 : 1) + 0.6 * a;
    return a;
  });
  let lo = Infinity, hi = -Infinity;
  gk.forEach((v, i) => { if (groups[i].units.length) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
  const span = hi - lo > 1e-9 ? hi - lo : 1;
  for (let u = 0; u < U; u++) keys[u] = Math.min(1, Math.max(0, (gk[group[u]] - lo) / span));
  groups.forEach((g, i) => { g.key = Math.min(1, Math.max(0, (gk[i] - lo) / span)); });
  return { dirs, keys, group, groups };
}
// The part of the full move a unit with this key has made at exT (0..1),
// as glsl.js unitMove: easeInOut((exT - key stag) / (1 - stag)).
export function explodeAmount(exT, key, stag) {
  const s = Math.min(0.95, Math.max(0, stag));
  return easeInOut((exT - key * s) / (1 - s));
}
// The offset (nm) of unit u: dir * amp * explodeAmount
export function unitOffset(plan, u, exT, stag, amp) {
  const f = amp * explodeAmount(exT, plan.keys[u], stag);
  return [plan.dirs[3 * u] * f, plan.dirs[3 * u + 1] * f, plan.dirs[3 * u + 2] * f];
}
// The saver timelines, u = shot time / shot length (0..1):
//   exview   exT: opens over 0.05..0.36, holds, closes over 0.72..0.95
//            (hold: stays open for the next shot of a chapter)
//   iso      the region lifts and the rest fades over 0.10..0.32, and
//            back over 0.74..0.94 (smoothstep)
//   inspect  exT of a shot that starts open: closes over 0.74..0.96
const lin01 = (u, a, b) => Math.min(1, Math.max(0, (u - a) / (b - a)));
const sstep = (u, a, b) => { const t = lin01(u, a, b); return t * t * (3 - 2 * t); };
export const TIMELINE = {
  exview: (u, hold) => hold ? lin01(u, 0.05, 0.36) : lin01(u, 0.05, 0.36) - lin01(u, 0.72, 0.95),
  iso: u => sstep(u, 0.1, 0.32) - sstep(u, 0.74, 0.94),
  inspectEx: (u, fromEx) => fromEx ? 1 - lin01(u, 0.74, 0.96) : 0,
};
// The centre of a set of units at exT (the camera follows a part with it)
export function partCentre(T, plan, units, exT, stag, amp) {
  const c = [0, 0, 0];
  for (const u of units) { const o = unitOffset(plan, u, exT, stag, amp); c[0] += T.cent[3 * u] + o[0]; c[1] += T.cent[3 * u + 1] + o[1]; c[2] += T.cent[3 * u + 2] + o[2]; }
  const n = Math.max(1, units.length);
  return [c[0] / n, c[1] / n, c[2] / n];
}
// The per-unit data that pack.js packSel uploads: explode direction, key,
// selected flag and the direction a not-selected unit moves away in.
// sel: Set or array of selected units (may be empty); away from 'from'.
export function selTable(T, plan, sel = [], from = null) {
  const U = T.U, on = new Uint8Array(U), away = new Float32Array(3 * U);
  for (const u of sel) on[u] = 1;
  for (let u = 0; u < U; u++) {
    const d = from ? norm([T.cent[3 * u] - from[0], T.cent[3 * u + 1] - from[1], T.cent[3 * u + 2] - from[2]]) : T.dir(u);
    away[3 * u] = d[0]; away[3 * u + 1] = d[1]; away[3 * u + 2] = d[2];
  }
  return { dirs: plan ? plan.dirs : new Float32Array(3 * U), keys: plan ? plan.keys : new Float32Array(U), sel: on, away };
}

// ── extent ─────────────────────────────────────────────────────────────────
// The largest distance (nm) from c of any bead of the units (step: every
// step-th bead).
export function regionExtent(T, units, c, step = 1) {
  const d = T.d;
  if (!d._byChain) {
    const by = Array.from({ length: T.nc }, () => []);
    for (let i = 0; i < d.n; i++) by[d.chain[i]].push(i);
    d._byChain = by.map(a => Int32Array.from(a));
  }
  let r2 = 0;
  const ops = T.ops;
  for (const u of units) {
    const k = Math.floor(u / T.nc), ch = u % T.nc, o = 12 * k, idx = d._byChain[ch];
    for (let j = 0; j < idx.length; j += step) {
      const i = idx[j], x = d.pos[3 * i], y = d.pos[3 * i + 1], z = d.pos[3 * i + 2];
      const X = ops[o] * x + ops[o + 1] * y + ops[o + 2] * z + ops[o + 3] - c[0];
      const Y = ops[o + 4] * x + ops[o + 5] * y + ops[o + 6] * z + ops[o + 7] - c[1];
      const Z = ops[o + 8] * x + ops[o + 9] * y + ops[o + 10] * z + ops[o + 11] - c[2];
      r2 = Math.max(r2, X * X + Y * Y + Z * Z);
    }
  }
  return Math.sqrt(r2);
}

// ── framing ────────────────────────────────────────────────────────────────
// view: { w, h, occ: { l, r, t, b }, fov (deg, vertical) }. The camera
// distance that fits a ball of radius r in the clear part (the view
// offset of main.js centres the clear part).
export function fitDistance(r, view) {
  const { w, h, occ } = view;
  const wV = Math.max(80, w - occ.l - occ.r), hV = Math.max(80, h - occ.t - occ.b);
  const fov = view.fov * Math.PI / 180, half = Math.atan(Math.tan(fov / 2) * Math.min(hV, wV) / h);
  return r / Math.sin(half) * 1.04;
}
// The pixel of world point p for a camera at eye looking at target (up
// +y), with main.js setViewOffset(w, h, -(l - r) / 2, -(t - b) / 2).
export function screenOf(p, eye, target, view) {
  const f = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  let s = [f[1] * 0 - f[2] * 1, f[2] * 0 - f[0] * 0, f[0] * 1 - f[1] * 0];   // f x up
  s = norm(Math.hypot(...s) < 1e-6 ? [1, 0, 0] : s);
  const up = [s[1] * f[2] - s[2] * f[1], s[2] * f[0] - s[0] * f[2], s[0] * f[1] - s[1] * f[0]];
  const q = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
  const X = dot(q, s), Y = dot(q, up), Z = dot(q, f);
  const k = (view.h / 2) / Math.tan(view.fov * Math.PI / 360), o = view.occ;
  return { x: view.w / 2 + (o.l - o.r) / 2 + k * X / Z, y: view.h / 2 + (o.t - o.b) / 2 - k * Y / Z, z: Z };
}
