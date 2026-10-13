// ============================================================================
//  BREADBOARD LAB  ·  sim/netlist.js — from the bench document to a netlist
// ----------------------------------------------------------------------------
//  buildNetlist(doc, registry, geo) → Netlist (contract 3.7). Pure: no DOM,
//  no three.js. geo is the parts/geometry.js module, injected.
//
//  NODES. A union-find over keys joins what is one conductor:
//    strip:<board>:<strip> .. a breadboard strip (a–e of a column, a rail)
//    pin:<part>.<pin> ........ a part pin; joined to its strip when it sits
//                              in a hole (geo.resolvePins)
//    int:<part>#<name> ....... an internal node of a part template
//  Pins of one part with the same base name (GND.1, GND.2) are one node, as
//  on a real board. A jumper wire does NOT join its ends: it becomes a 'wire'
//  element (0.02 Ω), so the sim knows its current (Frame.wires).
//
//  GROUND is the negative terminal of the first source in document order
//  (vsource, battery, supply, usbpower, solar), else the GND of the first
//  MCU board, else a free node 0 (Netlist.ground.why = 'none').
//
//  WHEN. A template with a `when` field joins only when the part params
//  match it (whenMatches), as parts/schema.js expandElectrical does.
//
//  PARAMS. A template param '$key' reads the part param (or the def
//  default). '$key*2+1' is an expression of + − * / and numbers. A plain
//  '$key' value is recorded in Element.bind (param path → part key), so
//  engine.setParam(part, key, v) reaches the element without a rebuild.
//
//  EXTRA FIELDS (not in the contract table; the checks and the UI use them):
//    labels {owner: text}, pinHole {part.pin: hole|null}, holeStrip
//    {hole: strip key}, covered [hole], overlaps [...], warnings [text].
//
//  GREP MAP
//    UF .................. union-find with readable roots
//    SOURCE_TERMS ........ which terminal of which source type is negative
//    MCU_BOARD ........... def id → board kind
//    resolveParams ....... '$key' and expressions, with the bind map
//    whenMatches ......... the template `when` filter
//    buildNetlist ........ the whole build
//    splitHole ........... 'b1:a12' → ['b1', 'a12']
// ============================================================================
import { checkCircuit } from './checks.js';

class UF {
  constructor() { this.p = new Map(); }
  add(k) { if (!this.p.has(k)) this.p.set(k, k); return k; }
  find(k) {
    this.add(k);
    let r = k;
    while (this.p.get(r) !== r) r = this.p.get(r);
    let c = k;
    while (this.p.get(c) !== r) { const n = this.p.get(c); this.p.set(c, r); c = n; }
    return r;
  }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(rb, ra); return ra; }
}

export const SOURCE_TYPES_NEG = { vsource: 'n', battery: 'n', supply: 'n', usbpower: 'n', solar: 'n' };
export const MCU_BOARD = { 'mcu-uno': 'uno328', 'mcu-nano': 'nano328', 'mcu-esp32': 'esp32dev' };

export function splitHole(id) {
  const s = String(id || '');
  const i = s.lastIndexOf(':');
  return i < 0 ? [null, s] : [s.slice(0, i), s.slice(i + 1)];
}

// A template with `when: { key: value | [values] }` exists only when the part
// params match (the 7-segment common cathode / common anode sets).
function whenMatches(when, vals) {
  if (!when) return true;
  for (const k in when) {
    const want = when[k];
    if (Array.isArray(want) ? !want.includes(vals[k]) : vals[k] !== want) return false;
  }
  return true;
}

function paramValues(part, def) {
  const v = {};
  for (const p of def.params || []) v[p.key] = p.default;
  Object.assign(v, part.params || {});
  return v;
}

function evalExpr(src, vals) {
  let bad = false;
  const s = src.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, k) => {
    const x = vals[k];
    if (typeof x === 'number') return `(${x})`;
    if (typeof x === 'boolean') return x ? '(1)' : '(0)';
    if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(+x)) return `(${+x})`;
    bad = true; return '0';
  });
  if (bad || !/^[0-9+\-*/().eE\s]*$/.test(s)) return undefined;
  // a tiny recursive descent: no eval
  let i = 0;
  const str = s.replace(/\s+/g, '');
  const num = () => {
    const m = /^(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/.exec(str.slice(i));
    if (!m) throw new Error('num');
    i += m[0].length; return +m[0];
  };
  const factor = () => {
    if (str[i] === '-') { i++; return -factor(); }
    if (str[i] === '+') { i++; return factor(); }
    if (str[i] === '(') { i++; const v = expr(); if (str[i++] !== ')') throw new Error(')'); return v; }
    return num();
  };
  const term = () => { let v = factor(); while (str[i] === '*' || str[i] === '/') { const o = str[i++]; const w = factor(); v = o === '*' ? v * w : v / w; } return v; };
  const expr = () => { let v = term(); while (str[i] === '+' || str[i] === '-') { const o = str[i++]; const w = term(); v = o === '+' ? v + w : v - w; } return v; };
  try { const v = expr(); return i === str.length ? v : undefined; } catch { return undefined; }
}

// Resolve template params against the part. Returns [params, bind].
export function resolveParams(tplParams, vals, path = '', bind = {}) {
  const out = Array.isArray(tplParams) ? [] : {};
  for (const k of Object.keys(tplParams || {})) {
    const v = tplParams[k];
    const p = path ? `${path}.${k}` : k;
    if (typeof v === 'string' && v.startsWith('$')) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(v);
      if (m) { out[k] = vals[m[1]]; bind[p] = m[1]; }
      else out[k] = evalExpr(v, vals);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = resolveParams(v, vals, p, bind)[0];
    } else out[k] = v;
  }
  return [out, bind];
}

export function buildNetlist(doc, registry, geo) {
  const warnings = [];
  const uf = new UF();
  const boards = new Map((doc.boards || []).map(b => [b.id, b]));
  const parts = doc.parts || [];
  const defOf = (id) => {
    let d = null;
    try { d = registry && registry.get ? registry.get(id) : null; } catch { d = null; }
    if (!d) d = (doc.customParts || []).find(c => c.id === id) || null;
    return d;
  };
  let rp = { pinHole: {}, covered: new Set(), overlaps: [] };
  try { rp = geo.resolvePins(doc, registry) || rp; } catch (e) { warnings.push(`pin resolve failed: ${e.message}`); }
  const pinHoleRaw = rp.pinHole || {};
  const holeStrip = {};
  const stripOfHole = (hole) => {
    if (hole in holeStrip) return holeStrip[hole];
    const [bid, local] = splitHole(hole);
    const b = boards.get(bid);
    let sk = null;
    if (b) {
      try { const sl = geo.stripOf(b.type, local, b.params || {}); if (sl != null) sk = `${bid}:${sl}`; } catch { sk = null; }
    }
    holeStrip[hole] = sk;
    return sk;
  };
  const usedHoles = new Map(); // hole → key
  const pinHole = {};
  const wiredPins = new Set();
  const labels = {};
  const defs = new Map();

  // pins
  for (const part of parts) {
    const def = defOf(part.def);
    if (!def) { warnings.push(`unknown part "${part.def}" (${part.id})`); continue; }
    defs.set(part.id, def);
    labels[part.id] = part.label || def.name || part.id;
    const base = new Map();
    for (const pin of def.pins || []) {
      const pk = `pin:${part.id}.${pin.name}`;
      uf.add(pk);
      const free = def.mount === 'free' || (def.mount === 'either' && !part.place?.on && false);
      let hole = free ? null : (pinHoleRaw[`${part.id}.${pin.name}`] ?? null);
      if (hole) {
        const sk = stripOfHole(hole);
        if (sk) { uf.union(`strip:${sk}`, pk); usedHoles.set(hole, pk); }
        else hole = null;
      }
      pinHole[`${part.id}.${pin.name}`] = hole;
      const bm = /^(.+)\.\d+$/.exec(pin.name);
      if (bm) { if (base.has(bm[1])) uf.union(base.get(bm[1]), pk); else base.set(bm[1], pk); }
    }
  }

  const endKey = (end) => {
    if (!end) return null;
    if (end.hole) { const sk = stripOfHole(end.hole); if (!sk) return null; const k = `strip:${sk}`; uf.add(k); if (!usedHoles.has(end.hole)) usedHoles.set(end.hole, k); return k; }
    if (end.part && end.pin != null) {
      const def = defs.get(end.part);
      if (!def || !(def.pins || []).some(p => p.name === String(end.pin))) return null;
      wiredPins.add(`${end.part}.${end.pin}`);
      return `pin:${end.part}.${end.pin}`;
    }
    return null;
  };

  // wires
  const wireEnds = [];
  for (const w of doc.wires || []) {
    const a = endKey(w.a), b = endKey(w.b);
    if (!a || !b) { warnings.push(`wire ${w.id} has an end that goes nowhere`); continue; }
    wireEnds.push([w, a, b]);
    labels[w.id] = `wire ${w.id}`;
  }
  // probes
  const probeEnds = [];
  for (const pr of doc.probes || []) {
    const leads = {};
    for (const [ln, end] of Object.entries(pr.leads || {})) leads[ln] = end ? endKey(end) : null;
    probeEnds.push([pr, leads]);
    labels[pr.id] = { dmm: 'Multimeter', scope: 'Oscilloscope', logic: 'Logic analyzer' }[pr.type] || pr.id;
  }

  // templates: internal keys, element list (nodes as keys for now)
  const rawEls = [];
  const mcus = [];
  for (const part of parts) {
    const def = defs.get(part.id);
    if (!def) continue;
    const vals = paramValues(part, def);
    const pinNames = new Set((def.pins || []).map(p => p.name));
    for (const tpl of def.electrical || []) {
      if (!whenMatches(tpl.when, vals)) continue;
      const nodes = {};
      for (const [term, ref] of Object.entries(tpl.nodes || {})) {
        if (ref == null) continue;
        const r = String(ref);
        if (r.startsWith('#')) nodes[term] = uf.find(`int:${part.id}${r}`);
        else {
          const pn = r.split('@')[0];
          if (!pinNames.has(pn)) { warnings.push(`${part.id}/${tpl.id}: pin "${pn}" is not a pin of ${def.id}`); nodes[term] = uf.find(`int:${part.id}#nopin:${pn}`); }
          else nodes[term] = uf.find(`pin:${part.id}.${pn}`);
        }
      }
      const [params, bind] = resolveParams(tpl.params || {}, vals);
      rawEls.push({ id: `${part.id}/${tpl.id ?? 'main'}`, owner: part.id, type: tpl.type, nodes, params, bind, vis: tpl.vis });
    }
    const board = MCU_BOARD[def.id] || (def.mcu && def.mcu.board) || null;
    if (board) mcus.push({ part, def, board });
  }

  // ground choice
  let groundKey = null, why = 'none';
  for (const el of rawEls) {
    const t = SOURCE_TYPES_NEG[el.type];
    if (t && el.nodes[t] != null) { groundKey = uf.find(el.nodes[t]); why = 'first source negative'; break; }
  }
  if (!groundKey && mcus.length) {
    const m = mcus[0];
    const g = (m.def.pins || []).find(p => /^GND/i.test(p.name));
    if (g) { groundKey = uf.find(`pin:${m.part.id}.${g.name}`); why = 'mcu GND'; }
  }

  // number the nodes
  const nodeOfRoot = new Map();
  const nodeNames = [];
  const rootName = new Map();
  const nameOf = (root) => {
    if (root.startsWith('strip:')) return root.slice(6);
    if (root.startsWith('pin:')) return root.slice(4);
    if (root.startsWith('int:')) return root.slice(4);
    return root;
  };
  // readable name: prefer a strip member of the class
  for (const k of uf.p.keys()) {
    const r = uf.find(k);
    const cur = rootName.get(r);
    if (!cur || (k.startsWith('strip:') && !cur.startsWith('strip:'))) rootName.set(r, k);
  }
  if (groundKey) { nodeOfRoot.set(groundKey, 0); nodeNames.push(nameOf(rootName.get(groundKey) || groundKey)); }
  else nodeNames.push('(ground)');
  const nodeOf = (key) => {
    const r = uf.find(key);
    let n = nodeOfRoot.get(r);
    if (n === undefined) { n = nodeNames.length; nodeOfRoot.set(r, n); nodeNames.push(nameOf(rootName.get(r) || r)); }
    return n;
  };

  const elements = [];
  for (const el of rawEls) {
    const nodes = {};
    for (const [t, k] of Object.entries(el.nodes)) nodes[t] = nodeOf(k);
    const e = { id: el.id, owner: el.owner, type: el.type, nodes, params: el.params };
    if (Object.keys(el.bind).length) e.bind = el.bind;
    if (el.vis != null) e.vis = el.vis;
    elements.push(e);
  }
  const wireIds = [];
  for (const [w, a, b] of wireEnds) {
    elements.push({ id: w.id, owner: w.id, type: 'wire', nodes: { a: nodeOf(a), b: nodeOf(b) }, params: { r: w.gauge && w.gauge < 22 ? 0.01 : 0.02, imax: 3 } });
    wireIds.push(w.id);
  }

  // pins → nodes; floating = not in a hole, no wire, no sibling of the same base
  const pinNode = {};
  const keyCount = new Map();
  const intCount = new Map();
  for (const k of uf.p.keys()) {
    const r = uf.find(k);
    keyCount.set(r, (keyCount.get(r) || 0) + 1);
    if (k.startsWith('int:')) intCount.set(r, (intCount.get(r) || 0) + 1);
  }
  const probeRoots = new Set();
  for (const [, L] of probeEnds) for (const k of Object.values(L)) if (k) probeRoots.add(uf.find(k));
  for (const part of parts) {
    const def = defs.get(part.id);
    if (!def) continue;
    for (const pin of def.pins || []) {
      const pk = `pin:${part.id}.${pin.name}`, id = `${part.id}.${pin.name}`;
      const r = uf.find(pk);
      const floating = !pinHole[id] && !wiredPins.has(id) && !probeRoots.has(r) && keyCount.get(r) <= 1 + (intCount.get(r) || 0);
      pinNode[id] = floating ? null : nodeOf(pk);
    }
  }
  const holeNode = {};
  for (const [hole, k] of usedHoles) holeNode[hole] = nodeOf(k);

  const mcuList = mcus.map(({ part, def, board }) => {
    const pins = {};
    for (const p of def.pins || []) pins[p.name] = nodeOf(`pin:${part.id}.${p.name}`);
    const g = (def.pins || []).find(p => /^GND/i.test(p.name));
    const vddName = board === 'esp32dev' ? '3V3' : '5V';
    const vdd = (def.pins || []).some(p => p.name === vddName) ? pins[vddName] : null;
    return { id: part.id, board, pins, gnd: g ? pins[g.name] : 0, vdd, program: (doc.programs && doc.programs[part.id]) || null };
  });

  const probes = probeEnds.map(([pr, L]) => {
    const leads = {};
    for (const [ln, k] of Object.entries(L)) leads[ln] = k ? nodeOf(k) : null;
    return { id: pr.id, type: pr.type, leads, settings: { ...(pr.settings || {}) } };
  });

  const nl = {
    nodeCount: nodeNames.length,
    nodeNames,
    ground: { node: 0, why },
    elements,
    mcus: mcuList,
    probes,
    holeNode,
    pinNode,
    wireIds,
    issues: [],
    labels,
    pinHole,
    holeStrip,
    covered: Array.from(rp.covered || []),
    overlaps: rp.overlaps || [],
    warnings,
  };
  try { nl.issues = checkCircuit(nl, doc, registry); } catch (e) { warnings.push(`checks failed: ${e.message}`); }
  return nl;
}

