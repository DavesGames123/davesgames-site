// ============================================================================
//  BREADBOARD LAB  ·  parts/schema.js — the part definition schema
// ----------------------------------------------------------------------------
//  A PartDef is data. It names the pins on a 0.1 inch grid, the parameters,
//  the material slots, the 3D template and the electrical elements. This file
//  checks a def against CONTRACT.md 3.5 and 3.7, and turns a def plus the
//  params of one part into concrete pin positions and elements.
//
//  PIN 1 IS THE ORIGIN. A board part has pin 1 at grid (0, 0). The place of a
//  part in the document is the place of pin 1, so a part snaps by pin 1.
//
//  A PIN COORDINATE CAN READ A PARAM. '$span' or '$span-1' or '2*$n' is an
//  expression of + - * / ( ) integers and $keys. The resistor span uses it.
//
//  AN ELEMENT PARAM CAN READ A PARAM. A string '$key' is the value of that
//  part param. Objects resolve deep, so a vsource wave can read '$freq'.
//  An element with `when: { key: value }` exists only when the param matches
//  (the 7-segment common anode and common cathode wiring use it).
//
//  Nothing here touches THREE, window or document: the worker and node load it.
//
//  GREP MAP
//    G / CATEGORIES ......... grid pitch, the category list, mounts, visuals
//    TEMPLATE_IDS ........... data model templates (custom parts) + built-in ids
//    ELEMENT_TYPES .......... every element type: terminals and param keys
//    terminalsOf ............ the terminal list of an element (logic is p1..pN)
//    evalExpr ............... the tiny pin-coordinate expression evaluator
//    paramDefaults / resolveParams ... def defaults merged with part params
//    pinGrid ................ one pin in grid units for given params
//    expandElectrical ....... def + params -> concrete element list
//    validateDef ............ every rule a def must pass, as error strings
// ============================================================================

export const G = 2.54;

export const CATEGORIES = ['power', 'passive', 'semis', 'ics', 'output', 'input',
  'sensors', 'mcu', 'modules', 'instruments', 'custom'];

export const MOUNTS = ['board', 'free', 'either'];

export const VISUALS = ['led', 'leds', 'motor', 'buzzer', 'speaker', 'seg7', 'lcd',
  'relay', 'fuse', 'supply', 'meter', 'lamp', 'servo', 'none'];

export const PARAM_TYPES = ['number', 'int', 'enum', 'bool', 'string'];

// Data templates (3.5) that a custom part may use, then the ids of the
// built-in builders in parts/models (a custom part may use those too).
export const DATA_TEMPLATES = ['dip', 'sip-module', 'axial', 'radial', 'box', 'to92',
  'to220', 'cylinder', 'header-board'];
export const BUILTIN_TEMPLATES = ['res', 'pot', 'trimpot', 'cap-ceramic', 'cap-elec', 'inductor',
  'fuse', 'diode', 'ldr', 'thermistor', 'led', 'led-rgb', 'button', 'switch-slide', 'joystick',
  'keypad', 'seg7', 'seg7-4', 'lcd', 'buzzer', 'speaker', 'motor', 'servo', 'relay', 'lamp',
  'bench-supply', 'battery-9v', 'battery-pack', 'coin-cell', 'usb-breakout', 'funcgen', 'solar',
  'shield-18650', 'reg-breakout', 'uno', 'nano', 'esp32', 'dmm', 'scope', 'logic', 'module'];
export const TEMPLATE_IDS = DATA_TEMPLATES.concat(BUILTIN_TEMPLATES);

// Element types of CONTRACT 3.7. `t` = terminals, `p` = allowed param keys.
const T2 = ['a', 'b'], PN = ['p', 'n'], AK = ['a', 'k'];
export const ELEMENT_TYPES = {
  resistor:   { t: T2, p: ['r', 'pmax'] },
  wire:       { t: T2, p: ['r', 'imax'] },
  pot:        { t: ['a', 'w', 'b'], p: ['r', 'pos', 'taper', 'pmax'] },
  capacitor:  { t: T2, p: ['c', 'esr', 'polarized', 'vmax', 'leak'] },
  inductor:   { t: T2, p: ['l', 'rdc'] },
  vsource:    { t: PN, p: ['wave', 'rint'] },
  isource:    { t: PN, p: ['i'] },
  supply:     { t: PN, p: ['v', 'ilim', 'on'] },
  battery:    { t: PN, p: ['v', 'rint', 'mah', 'soc'] },
  usbpower:   { t: PN, p: ['v', 'rint', 'trip', 'usb'] },
  diode:      { t: AK, p: ['model', 'is', 'n', 'rs', 'bv', 'ibv', 'cj'] },
  zener:      { t: AK, p: ['vz', 'rz', 'model', 'is', 'n', 'rs'] },
  led:        { t: AK, p: ['color', 'imax', 'iabs', 'vrmax'] },
  npn:        { t: ['c', 'b', 'e'], p: ['model', 'bf', 'br', 'is', 'vaf', 'pmax', 'cje', 'cjc', 'rb', 'ikf'] },
  pnp:        { t: ['c', 'b', 'e'], p: ['model', 'bf', 'br', 'is', 'vaf', 'pmax', 'cje', 'cjc', 'rb', 'ikf'] },
  nmos:       { t: ['d', 'g', 's'], p: ['model', 'vth', 'k', 'lambda', 'pmax'] },
  pmos:       { t: ['d', 'g', 's'], p: ['model', 'vth', 'k', 'lambda', 'pmax'] },
  opamp:      { t: ['inp', 'inn', 'out', 'vcc', 'vee'], p: ['model', 'a0', 'gbw', 'rout', 'slew'] },
  timer555:   { t: ['gnd', 'trig', 'out', 'reset', 'ctrl', 'thres', 'dis', 'vcc'], p: ['model'] },
  switch:     { t: T2, p: ['on', 'ron'] },
  spdt:       { t: ['com', 'a', 'b'], p: ['pos', 'ron'] },
  button:     { t: T2, p: ['pressed', 'ron', 'bounce'] },
  relay:      { t: ['c1', 'c2', 'com', 'no', 'nc'], p: ['coilR', 'vpick', 'vdrop', 'tmove'] },
  ldr:        { t: T2, p: ['lux', 'r10', 'gamma'] },
  thermistor: { t: T2, p: ['r25', 'beta', 'tempC'] },
  tempsensor: { t: ['vs', 'out', 'gnd'], p: ['tempC'] },
  motor:      { t: T2, p: ['r', 'l', 'ke', 'j', 'bfric', 'load'] },
  servo:      { t: ['sig', 'vcc', 'gnd'], p: ['iidle', 'istall'] },
  buzzer:     { t: T2, p: ['active', 'r', 'vmin', 'freq'] },
  speaker:    { t: T2, p: ['r'] },
  lamp:       { t: T2, p: ['vnom', 'pnom', 'ratio'] },
  fuse:       { t: T2, p: ['rating', 'i2t'] },
  regulator:  { t: ['in', 'gnd', 'out'], p: ['model', 'vout', 'dropout', 'iq', 'imax', 'boost', 'uvlo'] },
  logic:      { t: null, p: ['chip'] },          // p1..pN, N from the chip
  'logic-expr': { t: null, p: ['outputs', 'inputs', 'rout', 'vil', 'vih'] },
  hd44780:    { t: ['vss', 'vdd', 'v0', 'rs', 'rw', 'e', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'], p: ['cols', 'rows'] },
  solar:      { t: PN, p: ['isc', 'voc', 'lux'] },
  vmeter:     { t: T2, p: ['r'] },
  ameter:     { t: T2, p: ['r', 'fuse'] },
  mcupin:     { t: ['p', 'gnd'], p: [] },
};

export const LOGIC_CHIPS = { '74hc00': 14, '74hc02': 14, '74hc04': 14, '74hc08': 14,
  '74hc32': 14, '74hc86': 14, '74hc74': 14, '74hc595': 16, cd4017: 16 };

// The terminal list of one element (after its params resolve).
export function terminalsOf(el) {
  const ty = ELEMENT_TYPES[el.type];
  if (!ty) return null;
  if (ty.t) return ty.t;
  if (el.type === 'logic') {
    const n = LOGIC_CHIPS[el.params && el.params.chip];
    return n ? Array.from({ length: n }, (_, i) => 'p' + (i + 1)) : null;
  }
  return Object.keys(el.nodes || {});            // logic-expr: named
}

// ---------------------------------------------------------------- evalExpr
// Grammar: expr = term (('+'|'-') term)* ; term = unary (('*'|'/') unary)* ;
// unary = '-' unary | atom ; atom = int | '$'key | '(' expr ')'.
export function evalExpr(src, params = {}) {
  if (typeof src === 'number') return src;
  const s = String(src);
  let i = 0;
  const ws = () => { while (s[i] === ' ') i++; };
  const fail = m => { throw new Error(`bad expression "${s}": ${m}`); };
  function atom() {
    ws();
    if (s[i] === '(') { i++; const v = expr(); ws(); if (s[i++] !== ')') fail('missing )'); return v; }
    if (s[i] === '$') {
      i++; const j = i;
      while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) i++;
      const k = s.slice(j, i);
      if (!k) fail('empty $key');
      const v = Number(params[k]);
      if (!(k in params) || !Number.isFinite(v)) fail(`unknown param $${k}`);
      return v;
    }
    const j = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    if (j === i) fail(`unexpected "${s[i] ?? 'end'}" at ${i}`);
    return Number(s.slice(j, i));
  }
  function unary() { ws(); if (s[i] === '-') { i++; return -unary(); } return atom(); }
  function term() {
    let v = unary();
    for (;;) { ws(); const c = s[i]; if (c !== '*' && c !== '/') return v; i++; const r = unary(); v = c === '*' ? v * r : v / r; }
  }
  function expr() {
    let v = term();
    for (;;) { ws(); const c = s[i]; if (c !== '+' && c !== '-') return v; i++; const r = term(); v = c === '+' ? v + r : v - r; }
  }
  const v = expr(); ws();
  if (i < s.length) fail(`trailing "${s.slice(i)}"`);
  return v;
}

// ---------------------------------------------------------------- params
export function paramDefaults(def) {
  const o = {};
  for (const p of def.params || []) o[p.key] = p.default;
  return o;
}
export function resolveParams(def, params) {
  const o = paramDefaults(def);
  if (params) for (const k in params) if (params[k] !== undefined) o[k] = params[k];
  return o;
}

// One pin in grid units for these params: { x, z } (numbers).
export function pinGrid(def, pin, params) {
  const pp = resolveParams(def, params);
  const p = typeof pin === 'string' ? (def.pins || []).find(q => q.name === pin) : pin;
  if (!p) throw new Error(`no pin ${pin} on ${def.id}`);
  return { x: evalExpr(p.x, pp), z: evalExpr(p.z, pp) };
}

// ---------------------------------------------------------------- electrical
function resolveValue(v, pp) {
  if (typeof v === 'string' && v[0] === '$' && /^\$[A-Za-z0-9_]+$/.test(v)) return pp[v.slice(1)];
  if (Array.isArray(v)) return v.map(x => resolveValue(x, pp));
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = resolveValue(v[k], pp); return o; }
  return v;
}
function whenMatches(when, pp) {
  if (!when) return true;
  for (const k in when) {
    const want = when[k];
    if (Array.isArray(want) ? !want.includes(pp[k]) : pp[k] !== want) return false;
  }
  return true;
}
// def + part params -> [{ id, type, nodes:{ terminal: pinName|'#x' }, params, vis? }]
// SIM maps the pin names to nodes. `when` is applied here and dropped.
export function expandElectrical(def, params) {
  const pp = resolveParams(def, params);
  const out = [];
  for (const el of def.electrical || []) {
    if (!whenMatches(el.when, pp)) continue;
    const e = { id: el.id, type: el.type, nodes: { ...el.nodes }, params: resolveValue(el.params || {}, pp) };
    if (el.vis) e.vis = el.vis;
    out.push(e);
  }
  return out;
}

// ---------------------------------------------------------------- validateDef
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
function refsIn(v, acc) {
  if (typeof v === 'string' && v[0] === '$') acc.push(v.slice(1));
  else if (Array.isArray(v)) v.forEach(x => refsIn(x, acc));
  else if (v && typeof v === 'object') for (const k in v) refsIn(v[k], acc);
  return acc;
}
function exprRefs(v) {
  if (typeof v !== 'string') return [];
  return (v.match(/\$[A-Za-z0-9_]+/g) || []).map(s => s.slice(1));
}

export function validateDef(def) {
  const E = [];
  const err = m => E.push(m);
  if (!def || typeof def !== 'object') return ['def is not an object'];
  const who = def.id || '(no id)';
  if (typeof def.id !== 'string' || !ID_RE.test(def.id)) err(`${who}: id must match ${ID_RE}`);
  if (typeof def.name !== 'string' || !def.name.trim()) err(`${who}: name missing`);
  if (!CATEGORIES.includes(def.category)) err(`${who}: unknown category "${def.category}"`);
  if (!MOUNTS.includes(def.mount)) err(`${who}: mount must be one of ${MOUNTS.join(', ')}`);
  if (def.visual !== undefined && !VISUALS.includes(def.visual)) err(`${who}: unknown visual "${def.visual}"`);

  // params
  const keys = new Set();
  if (!Array.isArray(def.params)) err(`${who}: params must be an array`);
  for (const p of def.params || []) {
    if (!p || typeof p.key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.key)) { err(`${who}: bad param key ${p && p.key}`); continue; }
    if (keys.has(p.key)) err(`${who}: duplicate param ${p.key}`);
    keys.add(p.key);
    if (!PARAM_TYPES.includes(p.type)) { err(`${who}: param ${p.key} has bad type ${p.type}`); continue; }
    const d = p.default;
    if (p.type === 'number' || p.type === 'int') {
      if (typeof d !== 'number' || !Number.isFinite(d)) err(`${who}: param ${p.key} default must be a number`);
      else {
        if (p.type === 'int' && !Number.isInteger(d)) err(`${who}: param ${p.key} default must be an int`);
        if (p.min !== undefined && d < p.min) err(`${who}: param ${p.key} default below min`);
        if (p.max !== undefined && d > p.max) err(`${who}: param ${p.key} default above max`);
      }
      if (p.scale === 'log' && !(p.min > 0)) err(`${who}: log param ${p.key} needs min > 0`);
      if (p.series && !['E12', 'E24'].includes(p.series)) err(`${who}: param ${p.key} bad series`);
    } else if (p.type === 'enum') {
      if (!Array.isArray(p.options) || !p.options.length) err(`${who}: enum ${p.key} needs options`);
      else if (!p.options.includes(d)) err(`${who}: enum ${p.key} default not in options`);
    } else if (p.type === 'bool') {
      if (typeof d !== 'boolean') err(`${who}: bool ${p.key} default must be true or false`);
    } else if (typeof d !== 'string') err(`${who}: string ${p.key} default must be a string`);
  }
  const defaults = paramDefaults(def);

  // pins
  const pinNames = new Set();
  if (!Array.isArray(def.pins)) err(`${who}: pins must be an array`);
  for (const p of def.pins || []) {
    if (!p || typeof p.name !== 'string' || !p.name) { err(`${who}: pin without a name`); continue; }
    if (pinNames.has(p.name)) err(`${who}: duplicate pin ${p.name}`);
    pinNames.add(p.name);
    for (const ax of ['x', 'z']) {
      const v = p[ax];
      if (typeof v === 'number') { if (!Number.isFinite(v)) err(`${who}: pin ${p.name}.${ax} not finite`); continue; }
      if (typeof v !== 'string') { err(`${who}: pin ${p.name}.${ax} must be a number or expression`); continue; }
      for (const r of exprRefs(v)) if (!keys.has(r)) err(`${who}: pin ${p.name}.${ax} reads unknown param $${r}`);
      try { evalExpr(v, defaults); } catch (e) { err(`${who}: pin ${p.name}.${ax}: ${e.message}`); }
    }
  }
  if (def.mount !== 'free' && (def.pins || []).length) {
    try {
      const g = pinGrid(def, def.pins[0], defaults);
      if (Math.abs(g.x) > 1e-9 || Math.abs(g.z) > 1e-9) err(`${who}: pin 1 (${def.pins[0].name}) must sit at grid (0, 0)`);
    } catch { /* reported above */ }
  }
  if (def.mount === 'board' || def.mount === 'either') {
    for (const p of def.pins || []) {
      try {
        const g = pinGrid(def, p, defaults);
        if (Math.abs(g.x - Math.round(g.x)) > 1e-9 || Math.abs(g.z - Math.round(g.z)) > 1e-9) err(`${who}: board pin ${p.name} is off the 0.1 inch grid`);
      } catch { /* reported */ }
    }
  }
  // the hole check of pins with an unusual pitch is the job of resolvePins

  // slots
  const slotKeys = new Set();
  if (!Array.isArray(def.slots) || !def.slots.length) err(`${who}: slots must be a non-empty array`);
  for (const s of def.slots || []) {
    if (!s || typeof s.key !== 'string') { err(`${who}: slot without key`); continue; }
    if (slotKeys.has(s.key)) err(`${who}: duplicate slot ${s.key}`);
    slotKeys.add(s.key);
    if (typeof s.default !== 'string' || !s.default) err(`${who}: slot ${s.key} needs a default material id`);
  }

  // model
  if (!def.model || typeof def.model !== 'object') err(`${who}: model missing`);
  else if (!TEMPLATE_IDS.includes(def.model.template) && typeof def.build !== 'function') err(`${who}: unknown model template "${def.model.template}"`);

  // electrical
  const elIds = new Set();
  if (!Array.isArray(def.electrical)) err(`${who}: electrical must be an array`);
  for (const el of def.electrical || []) {
    const ew = `${who}/${el && el.id}`;
    if (!el || typeof el.id !== 'string' || !el.id) { err(`${who}: element without id`); continue; }
    if (elIds.has(el.id)) err(`${ew}: duplicate element id`);
    elIds.add(el.id);
    const ty = ELEMENT_TYPES[el.type];
    if (!ty) { err(`${ew}: unknown element type "${el.type}"`); continue; }
    if (!el.nodes || typeof el.nodes !== 'object') { err(`${ew}: nodes missing`); continue; }
    for (const k of Object.keys(el.params || {})) if (!ty.p.includes(k)) err(`${ew}: param "${k}" is not a ${el.type} param`);
    for (const r of refsIn(el.params || {}, [])) if (!keys.has(r)) err(`${ew}: reads unknown param $${r}`);
    if (el.when) for (const k in el.when) if (!keys.has(k)) err(`${ew}: when reads unknown param ${k}`);
    const resolved = { type: el.type, nodes: el.nodes, params: resolveValue(el.params || {}, defaults) };
    let terms = terminalsOf(resolved);
    if (el.type === 'logic' && !terms) {
      // a $chip param: check against every option of that param
      err(`${ew}: logic needs a known chip (${Object.keys(LOGIC_CHIPS).join(', ')})`);
      terms = [];
    }
    const given = Object.keys(el.nodes);
    for (const t of terms) if (!given.includes(t)) err(`${ew}: terminal ${t} not connected`);
    for (const t of given) if (!terms.includes(t)) err(`${ew}: ${el.type} has no terminal ${t}`);
    for (const t of given) {
      const n = el.nodes[t];
      if (typeof n !== 'string' || !n) { err(`${ew}: terminal ${t} maps to nothing`); continue; }
      if (n[0] === '#') { if (!/^#[A-Za-z0-9_]+$/.test(n)) err(`${ew}: bad internal node ${n}`); continue; }
      const at = n.indexOf('@');
      const pin = at > 0 ? n.slice(at + 1) : n;
      if (!pinNames.has(pin)) err(`${ew}: terminal ${t} maps to unknown pin ${pin}`);
    }
    if (el.vis !== undefined && typeof el.vis !== 'string') err(`${ew}: vis must be a string`);
  }

  // interact
  if (def.interact) {
    const ik = def.interact;
    if (!['press', 'toggle', 'knob', 'slider'].includes(ik.kind)) err(`${who}: bad interact kind ${ik.kind}`);
    const ks = ik.keys || [ik.key];
    for (const k of ks) if (!keys.has(k)) err(`${who}: interact reads unknown param ${k}`);
  }

  // footprint (grid units, optional)
  if (def.footprint) {
    const f = def.footprint;
    for (const k of ['x0', 'z0', 'x1', 'z1']) if (typeof f[k] !== 'number') err(`${who}: footprint.${k} must be a number`);
    if (f.x1 < f.x0 || f.z1 < f.z0) err(`${who}: footprint is inverted`);
  }
  // mcu (pins that SIM drives)
  if (def.mcu) {
    const m = def.mcu;
    if (!['uno328', 'nano328', 'esp32dev'].includes(m.board)) err(`${who}: mcu.board unknown`);
    for (const k of ['vdd', 'gnd']) if (!pinNames.has(m[k])) err(`${who}: mcu.${k} is not a pin`);
    for (const p of m.pins || []) if (!pinNames.has(p)) err(`${who}: mcu pin ${p} is not a pin`);
  }
  return E;
}
