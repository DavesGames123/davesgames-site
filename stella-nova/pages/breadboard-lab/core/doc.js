// ============================================================================
//  BREADBOARD LAB  ·  core/doc.js — the circuit document
// ----------------------------------------------------------------------------
//  The document is plain JSON (CONTRACT 3.3). This module makes an empty one,
//  repairs one that came from a file, a link, the autosave or an old version
//  (normalizeDoc), and lists what is wrong with one (validateDoc).
//
//  normalizeDoc never throws. It fills defaults, renames ids with a wrong
//  prefix (and moves the references with them), gives a new id to the second
//  copy of a duplicate id (references stay with the first copy), drops items
//  that point at nothing, and returns one warning per repair. With
//  opts.registry it also drops parts of unknown definitions and wire ends at
//  pins that the definition does not have. A normalized document passes
//  validateDoc with the same opts.
//
//  GREP MAP
//    PREFIX / ID_RE ........ id prefixes per kind
//    emptyDoc / starterDoc . new documents
//    probeDefaults ......... lead names and settings per instrument
//    normalizeDoc .......... repair (boards, parts, wires, probes, programs …)
//    validateDoc ........... strict check, returns error strings
//    newIdFrom / idNumber .. the shared id counter
//    lookupDef ............. registry or document custom part
// ============================================================================
import { BOARD_TYPES, normRot, parseHoleId, parseLocal } from './space.js';

export const FORMAT = 'breadboard-lab';
export const VERSION = 1;

export const PREFIX = { board: 'b', part: 'p', wire: 'w', probe: 'm', material: 'mat-', customPart: 'cp-' };
export const COLLECTION = { board: 'boards', part: 'parts', wire: 'wires', probe: 'probes', material: 'materials', customPart: 'customParts' };
export const ID_RE = {
  board: /^b\d+$/, part: /^p\d+$/, wire: /^w\d+$/, probe: /^m\d+$/,
  material: /^mat-[A-Za-z0-9_-]+$/, customPart: /^cp-[A-Za-z0-9_-]+$/,
};
export const WIRE_COLORS = ['#d63b3b', '#2b2b2b', '#2f80d6', '#4e9a2e', '#e0c126', '#7a6fd8', '#e2704a', '#edede6'];
export const WIRE_STYLES = ['arch', 'flat', 'free'];
export const PROBE_TYPES = ['dmm', 'scope', 'logic'];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isPrim = v => typeof v === 'number' ? Number.isFinite(v) : (typeof v === 'string' || typeof v === 'boolean');
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function kindOfId(id) {
  if (typeof id !== 'string') return null;
  for (const k of ['material', 'customPart', 'board', 'part', 'wire', 'probe']) if (ID_RE[k].test(id)) return k;
  return null;
}

// Numeric tail of an id ('p12' → 12, 'mat-7' → 7, 'mat-copper' → 0).
export function idNumber(id) {
  const m = /(\d+)$/.exec(String(id));
  return m ? +m[1] : 0;
}

export function newIdFrom(doc, kind) {
  const n = Math.max(1, doc.nextId | 0);
  return PREFIX[kind] + n;
}

export function probeDefaults(type) {
  if (type === 'dmm') return { leads: ['red', 'black'], settings: { mode: 'V', range: 'auto' } };
  if (type === 'scope') return {
    leads: ['ch1', 'ch2', 'ch3', 'ch4', 'gnd'],
    settings: { tdiv: 1e-3, vdiv: [1, 1, 1, 1], offset: [0, 0, 0, 0], trig: { ch: 1, level: 1, edge: 'rise', mode: 'auto' } },
  };
  if (type === 'logic') return {
    leads: ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'gnd'],
    settings: { threshold: 1.4, rate: 1e6 },
  };
  return null;
}

export function emptyDoc() {
  return {
    format: FORMAT, version: VERSION,
    title: 'Untitled bench', notes: '',
    boards: [], parts: [], wires: [], probes: [],
    materials: [], customParts: [], programs: {},
    sim: { speed: 1, pwm: 'auto' },
    nextId: 1,
  };
}

// One full board in the middle of the mat: the default bench.
export function starterDoc() {
  const d = emptyDoc();
  d.boards.push({ id: 'b1', type: 'bb830', x: 0, z: 0, rot: 0 });
  d.nextId = 2;
  return d;
}

export function lookupDef(doc, registry, defId) {
  if (doc && Array.isArray(doc.customParts)) {
    const c = doc.customParts.find(d => d && d.id === defId);
    if (c) return c;
  }
  if (registry && typeof registry.get === 'function') {
    try { return registry.get(defId) || null; } catch { return null; }
  }
  return null;
}

// ── normalize ──────────────────────────────────────────────────────────────
export function normalizeDoc(raw, opts = {}) {
  const warnings = [];
  const warn = msg => warnings.push(msg);
  const registry = opts.registry || null;

  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { warn('The document is not valid JSON. An empty bench is used.'); raw = null; }
  }
  if (!isObj(raw)) {
    if (raw !== null && raw !== undefined) warn('The document is not an object. An empty bench is used.');
    else if (!warnings.length) warn('No document. An empty bench is used.');
    return { doc: emptyDoc(), warnings };
  }
  if (raw.format !== undefined && raw.format !== FORMAT) warn(`Unknown format "${raw.format}". The bench reads it as ${FORMAT}.`);
  const ver = isNum(raw.version) ? raw.version : 1;
  if (ver > VERSION) warn(`The document is version ${ver}. This page knows version ${VERSION}; new fields can be lost.`);

  const doc = emptyDoc();
  doc.title = typeof raw.title === 'string' ? raw.title.slice(0, 200) : doc.title;
  doc.notes = typeof raw.notes === 'string' ? raw.notes : '';

  // Pass 1: the highest id number in use, so new ids never collide.
  let maxN = 0;
  for (const kind of Object.keys(COLLECTION)) {
    const arr = Array.isArray(raw[COLLECTION[kind]]) ? raw[COLLECTION[kind]] : [];
    for (const it of arr) if (isObj(it) && typeof it.id === 'string' && ID_RE[kind].test(it.id)) maxN = Math.max(maxN, idNumber(it.id));
  }
  let counter = Math.max(maxN + 1, isNum(raw.nextId) ? Math.floor(raw.nextId) : 1);
  const seen = new Set();
  const remap = {};                                   // bad-prefix id → new id
  const fresh = kind => { let id; do id = PREFIX[kind] + counter++; while (seen.has(id)); return id; };
  function takeId(kind, item, what) {
    const id = item.id;
    if (typeof id === 'string' && ID_RE[kind].test(id) && !seen.has(id)) { seen.add(id); return id; }
    const nid = fresh(kind);
    seen.add(nid);
    if (typeof id === 'string' && seen.has(id) && ID_RE[kind].test(id)) warn(`Duplicate id "${id}" (${what}) is now "${nid}".`);
    else {
      if (typeof id === 'string' && id && !(id in remap)) remap[id] = nid;
      warn(`${what} id "${id === undefined ? '' : id}" is not valid; it is now "${nid}".`);
    }
    return nid;
  }
  const mapId = id => (typeof id === 'string' && id in remap ? remap[id] : id);

  // Boards
  const boardById = new Map();
  for (const b of Array.isArray(raw.boards) ? raw.boards : []) {
    if (!isObj(b)) { warn('A board entry is not an object; it was dropped.'); continue; }
    if (!BOARD_TYPES[b.type]) { warn(`Board "${b.id}" has unknown type "${b.type}"; it was dropped.`); continue; }
    const id = takeId('board', b, 'Board');
    const nb = { id, type: b.type, x: isNum(b.x) ? b.x : 0, z: isNum(b.z) ? b.z : 0, rot: normRot(b.rot) };
    if (isObj(b.params) && b.type === 'bb830' && typeof b.params.splitRails === 'boolean') nb.params = { splitRails: b.params.splitRails };
    if (isObj(b.looks)) nb.looks = cleanLooks(b.looks);
    doc.boards.push(nb);
    if (!boardById.has(id)) boardById.set(id, nb);
  }

  // Materials and custom parts come before parts, so defs and looks resolve.
  for (const m of Array.isArray(raw.materials) ? raw.materials : []) {
    if (!isObj(m) || typeof m.color !== 'string' || !HEX_RE.test(m.color)) { warn('A custom material has no valid colour; it was dropped.'); continue; }
    const id = takeId('material', m, 'Material');
    const nm = clone(m);
    nm.id = id;
    nm.name = typeof m.name === 'string' && m.name ? m.name : id;
    nm.roughness = isNum(m.roughness) ? Math.min(1, Math.max(0, m.roughness)) : 0.5;
    nm.metalness = isNum(m.metalness) ? Math.min(1, Math.max(0, m.metalness)) : 0;
    if (opts.validateMaterial) {
      const errs = opts.validateMaterial(nm) || [];
      if (errs.length) { warn(`Material "${id}": ${errs[0]}; it was dropped.`); continue; }
    }
    doc.materials.push(nm);
  }
  for (const c of Array.isArray(raw.customParts) ? raw.customParts : []) {
    if (!isObj(c) || !Array.isArray(c.pins)) { warn('A custom part has no pin list; it was dropped.'); continue; }
    const id = takeId('customPart', c, 'Custom part');
    const nc = clone(c);
    nc.id = id;
    nc.name = typeof c.name === 'string' && c.name ? c.name : id;
    nc.category = 'custom';
    delete nc.build;
    doc.customParts.push(nc);
  }

  // Parts
  const partById = new Map();
  for (const p of Array.isArray(raw.parts) ? raw.parts : []) {
    if (!isObj(p) || typeof p.def !== 'string') { warn('A part has no definition id; it was dropped.'); continue; }
    const defId = mapId(p.def);
    const def = lookupDef(doc, registry, defId);
    if (registry && !def) { warn(`Part "${p.id}" uses unknown part "${p.def}"; it was dropped.`); continue; }
    const id = takeId('part', p, 'Part');
    const pl = isObj(p.place) ? p.place : {};
    const place = { on: null, x: isNum(pl.x) ? pl.x : 0, z: isNum(pl.z) ? pl.z : 0, rot: normRot(pl.rot) };
    if (pl.on !== undefined && pl.on !== null) {
      const on = mapId(pl.on);
      if (boardById.has(on)) place.on = on;
      else warn(`Part "${id}" sat on missing board "${pl.on}"; it now sits on the mat.`);
    }
    const np = { id, def: defId };
    if (typeof p.label === 'string' && p.label) np.label = p.label.slice(0, 40);
    np.place = place;
    np.params = {};
    if (isObj(p.params)) {
      const known = def && Array.isArray(def.params) ? new Set(def.params.map(q => q.key)) : null;
      for (const [k, v] of Object.entries(p.params)) {
        if (!isPrim(v)) { warn(`Part "${id}" param "${k}" is not a plain value; it was dropped.`); continue; }
        if (known && !known.has(k)) { warn(`Part "${id}" has unknown param "${k}"; it was dropped.`); continue; }
        np.params[k] = v;
      }
    }
    if (isObj(p.looks)) np.looks = cleanLooks(p.looks, mapId);
    doc.parts.push(np);
    if (!partById.has(id)) partById.set(id, { part: np, def });
  }

  // Wire and lead ends
  function cleanEnd(e, where) {
    if (!isObj(e)) return null;
    if (typeof e.hole === 'string') {
      const h = parseHoleId(e.hole);
      if (!h) { warn(`${where}: bad hole id "${e.hole}".`); return null; }
      const bid = mapId(h.board);
      const b = boardById.get(bid);
      if (!b) { warn(`${where}: hole "${e.hole}" is on a missing board.`); return null; }
      if (!parseLocal(b.type, h.local)) { warn(`${where}: hole "${e.hole}" does not exist on a ${b.type}.`); return null; }
      return { hole: bid + ':' + h.local };
    }
    if (typeof e.part === 'string' && (typeof e.pin === 'string' || typeof e.pin === 'number')) {
      const pid = mapId(e.part);
      const rec = partById.get(pid);
      if (!rec) { warn(`${where}: part "${e.part}" is missing.`); return null; }
      const pin = String(e.pin);
      if (rec.def && Array.isArray(rec.def.pins) && !rec.def.pins.some(q => q.name === pin)) {
        warn(`${where}: part "${pid}" has no pin "${pin}".`);
        return null;
      }
      return { part: pid, pin };
    }
    warn(`${where}: the end is neither a hole nor a pin.`);
    return null;
  }
  const endKey = e => (e.hole ? 'h:' + e.hole : 'p:' + e.part + '.' + e.pin);

  for (const w of Array.isArray(raw.wires) ? raw.wires : []) {
    if (!isObj(w)) { warn('A wire entry is not an object; it was dropped.'); continue; }
    const label = `Wire "${w.id}"`;
    const a = cleanEnd(w.a, label), b = cleanEnd(w.b, label);
    if (!a || !b) { warn(`${label} lost an end; it was dropped.`); continue; }
    if (endKey(a) === endKey(b)) { warn(`${label} starts and ends at one point; it was dropped.`); continue; }
    const id = takeId('wire', w, 'Wire');
    const nw = { id, a, b, color: typeof w.color === 'string' && HEX_RE.test(w.color) ? w.color.toLowerCase() : WIRE_COLORS[0], style: WIRE_STYLES.includes(w.style) ? w.style : 'arch' };
    if (nw.style === 'free' && Array.isArray(w.via)) {
      const via = w.via.filter(v => Array.isArray(v) && v.length === 3 && v.every(isNum)).map(v => v.slice());
      if (via.length) nw.via = via;
    }
    if (isNum(w.gauge) && w.gauge >= 16 && w.gauge <= 30) nw.gauge = Math.round(w.gauge);
    doc.wires.push(nw);
  }

  // Probes
  for (const m of Array.isArray(raw.probes) ? raw.probes : []) {
    if (!isObj(m) || !PROBE_TYPES.includes(m.type)) { warn(`Probe "${m && m.id}" has an unknown type; it was dropped.`); continue; }
    const id = takeId('probe', m, 'Probe');
    const dflt = probeDefaults(m.type);
    const pl = isObj(m.place) ? m.place : {};
    const leads = {};
    const rawLeads = isObj(m.leads) ? m.leads : {};
    for (const name of dflt.leads) leads[name] = rawLeads[name] ? cleanEnd(rawLeads[name], `Probe "${id}" lead ${name}`) : null;
    for (const k of Object.keys(rawLeads)) if (!dflt.leads.includes(k)) warn(`Probe "${id}" has unknown lead "${k}"; it was dropped.`);
    const settings = Object.assign(clone(dflt.settings), isObj(m.settings) ? clone(m.settings) : {});
    doc.probes.push({ id, type: m.type, place: { x: isNum(pl.x) ? pl.x : 0, z: isNum(pl.z) ? pl.z : 0, rot: normRot(pl.rot) }, leads, settings });
  }

  // Programs
  if (isObj(raw.programs)) {
    for (const [k, prog] of Object.entries(raw.programs)) {
      const pid = mapId(k);
      if (!partById.has(pid)) { warn(`A program belongs to missing part "${k}"; it was dropped.`); continue; }
      if (isObj(prog) && prog.lang === 'sketch' && typeof prog.source === 'string') doc.programs[pid] = { lang: 'sketch', source: prog.source };
      else if (isObj(prog) && prog.lang === 'hex' && typeof prog.hex === 'string') doc.programs[pid] = { lang: 'hex', hex: prog.hex };
      else warn(`The program of "${pid}" is not a sketch or a hex file; it was dropped.`);
    }
  }

  // Sim and view
  if (isObj(raw.sim)) {
    if (isNum(raw.sim.speed) && raw.sim.speed > 0) doc.sim.speed = raw.sim.speed;
    if (['auto', 'average', 'switch'].includes(raw.sim.pwm)) doc.sim.pwm = raw.sim.pwm;
  }
  if (isObj(raw.view) && isVec3(raw.view.pos) && isVec3(raw.view.target)) doc.view = { pos: raw.view.pos.slice(), target: raw.view.target.slice() };

  doc.nextId = Math.max(counter, 1);
  return { doc, warnings };
}

function isVec3(v) { return Array.isArray(v) && v.length === 3 && v.every(isNum); }

function cleanLooks(looks, mapId = x => x) {
  const out = {};
  for (const [k, v] of Object.entries(looks)) if (typeof v === 'string' && v) out[k] = mapId(v);
  return out;
}

// ── validate ───────────────────────────────────────────────────────────────
export function validateDoc(doc, opts = {}) {
  const errors = [];
  const err = m => errors.push(m);
  if (!isObj(doc)) return ['document is not an object'];
  if (doc.format !== FORMAT) err(`format is "${doc.format}", not "${FORMAT}"`);
  if (doc.version !== VERSION) err(`version is ${doc.version}, not ${VERSION}`);
  if (typeof doc.title !== 'string') err('title is not a string');
  if (typeof doc.notes !== 'string') err('notes is not a string');
  for (const kind of Object.keys(COLLECTION)) if (!Array.isArray(doc[COLLECTION[kind]])) err(`${COLLECTION[kind]} is not an array`);
  if (errors.length) return errors;
  if (!isObj(doc.programs)) err('programs is not an object');
  if (!isObj(doc.sim) || !(isNum(doc.sim.speed) && doc.sim.speed > 0) || !['auto', 'average', 'switch'].includes(doc.sim.pwm)) err('sim settings are not valid');
  if (!isNum(doc.nextId) || doc.nextId < 1) err('nextId is not a positive number');

  const ids = new Set();
  let maxN = 0;
  for (const kind of Object.keys(COLLECTION)) {
    for (const it of doc[COLLECTION[kind]]) {
      if (!isObj(it)) { err(`${COLLECTION[kind]} holds a non-object`); continue; }
      if (!ID_RE[kind].test(it.id)) err(`${kind} id "${it.id}" has the wrong form`);
      if (ids.has(it.id)) err(`id "${it.id}" is used twice`);
      ids.add(it.id);
      if (kind !== 'material' && kind !== 'customPart') maxN = Math.max(maxN, idNumber(it.id));
    }
  }
  if (isNum(doc.nextId) && doc.nextId <= maxN) err(`nextId ${doc.nextId} is not above the highest id number ${maxN}`);

  const boards = new Map(doc.boards.map(b => [b.id, b]));
  for (const b of doc.boards) {
    if (!BOARD_TYPES[b.type]) err(`board ${b.id} has unknown type ${b.type}`);
    if (!isNum(b.x) || !isNum(b.z)) err(`board ${b.id} has no position`);
    if (![0, 1, 2, 3].includes(b.rot)) err(`board ${b.id} rot ${b.rot} is not 0..3`);
  }
  const parts = new Map();
  for (const p of doc.parts) {
    parts.set(p.id, p);
    const def = lookupDef(doc, opts.registry, p.def);
    if (opts.registry && !def) err(`part ${p.id} uses unknown def ${p.def}`);
    if (!isObj(p.place)) { err(`part ${p.id} has no place`); continue; }
    if (p.place.on !== null && !boards.has(p.place.on)) err(`part ${p.id} sits on missing board ${p.place.on}`);
    if (!isNum(p.place.x) || !isNum(p.place.z)) err(`part ${p.id} has no position`);
    if (![0, 1, 2, 3].includes(p.place.rot)) err(`part ${p.id} rot is not 0..3`);
    if (!isObj(p.params)) err(`part ${p.id} params is not an object`);
    else for (const [k, v] of Object.entries(p.params)) if (!isPrim(v)) err(`part ${p.id} param ${k} is not a plain value`);
  }
  const checkEnd = (e, where) => {
    if (!isObj(e)) { err(`${where}: end is missing`); return; }
    if (typeof e.hole === 'string') {
      const h = parseHoleId(e.hole);
      const b = h && boards.get(h.board);
      if (!b || !parseLocal(b.type, h.local)) err(`${where}: hole ${e.hole} does not exist`);
    } else if (typeof e.part === 'string') {
      const p = parts.get(e.part);
      if (!p) { err(`${where}: part ${e.part} is missing`); return; }
      const def = lookupDef(doc, opts.registry, p.def);
      if (def && Array.isArray(def.pins) && !def.pins.some(q => q.name === e.pin)) err(`${where}: part ${e.part} has no pin ${e.pin}`);
    } else err(`${where}: end is neither a hole nor a pin`);
  };
  for (const w of doc.wires) {
    checkEnd(w.a, `wire ${w.id} a`);
    checkEnd(w.b, `wire ${w.id} b`);
    if (!HEX_RE.test(w.color)) err(`wire ${w.id} colour ${w.color} is not #rrggbb`);
    if (!WIRE_STYLES.includes(w.style)) err(`wire ${w.id} style ${w.style} is not known`);
  }
  for (const m of doc.probes) {
    const d = probeDefaults(m.type);
    if (!d) { err(`probe ${m.id} type ${m.type} is not known`); continue; }
    if (!isObj(m.leads)) { err(`probe ${m.id} has no leads`); continue; }
    for (const [k, e] of Object.entries(m.leads)) {
      if (!d.leads.includes(k)) err(`probe ${m.id} has unknown lead ${k}`);
      else if (e !== null) checkEnd(e, `probe ${m.id} lead ${k}`);
    }
  }
  for (const k of Object.keys(doc.programs || {})) if (!parts.has(k)) err(`program for missing part ${k}`);
  return errors;
}
