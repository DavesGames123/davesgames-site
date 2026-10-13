// ============================================================================
//  BREADBOARD LAB  ·  sim/test/stubs.mjs — test stand-ins for other roles
// ----------------------------------------------------------------------------
//  The SIM tests must run before PARTS and MCU+UI deliver. This file holds:
//    geoStub ........ contract 3.2 / 3.10 geometry (holes, strips, pins)
//    stubRegistry ... a few part defs in the contract format
//    scriptMcu ...... an MCU that plays a list of [t, pin, cfg] actions
//    toggleMcu ...... an MCU that toggles one pin every period
//  sim/tests.mjs prefers the real parts/geometry.js when it imports.
//
//  GREP MAP
//    geoStub / stubRegistry / STUB_DEFS / scriptMcu / toggleMcu / lcdScript
// ============================================================================

const G = 2.54;
const TYPES = { bb830: { cols: 63, railHoles: 50 }, bb400: { cols: 30, railHoles: 25 }, bb170: { cols: 17, railHoles: 0 } };
const RAIL_Z = { TN: -22.86, TP: -20.32, BP: 20.32, BN: 22.86 };

function holeLocal(type, local) {
  const T = TYPES[type];
  let m = /^([a-j])(\d+)$/.exec(local);
  if (m) {
    const ri = m[1].charCodeAt(0) - 97, c = +m[2];
    return { x: (c - (T.cols + 1) / 2) * G, z: ri < 5 ? -3.81 - (4 - ri) * G : 3.81 + (ri - 5) * G };
  }
  m = /^(TP|TN|BP|BN)(\d+)$/.exec(local);
  if (m) {
    const k = +m[2], n = T.railHoles;
    return { x: (k - 1 + Math.floor((k - 1) / 5) - (n - 1 + Math.floor((n - 1) / 5)) / 2) * G, z: RAIL_Z[m[1]] };
  }
  return null;
}
function holeList(type) {
  const T = TYPES[type], out = [];
  for (const r of 'abcdefghij') for (let c = 1; c <= T.cols; c++) out.push(r + c);
  if (T.railHoles) for (const rl of ['TN', 'TP', 'BP', 'BN']) for (let k = 1; k <= T.railHoles; k++) out.push(rl + k);
  return out;
}
function stripOf(type, local, params = {}) {
  let m = /^([a-j])(\d+)$/.exec(local);
  if (m) return m[2] + (m[1] <= 'e' ? 'T' : 'B');
  m = /^(TP|TN|BP|BN)(\d+)$/.exec(local);
  if (m) return params.splitRails && type === 'bb830' ? `${m[1]}.${+m[2] <= 25 ? 1 : 2}` : m[1];
  return null;
}
const rot = (x, z, r) => { for (let i = 0; i < ((r % 4) + 4) % 4; i++) [x, z] = [-z, x]; return [x, z]; };
function boardToWorld(b, x, z) { const [rx, rz] = rot(x, z, b.rot || 0); return { x: b.x + rx, y: 8.5, z: b.z + rz }; }
function evalPin(v, params) {
  if (typeof v === 'number') return v;
  const s = String(v).replace(/\$([A-Za-z_]\w*)/g, (m, k) => `(${+params[k]})`);
  // only + - * / digits
  if (!/^[\d+\-*/(). ]+$/.test(s)) return 0;
  return Function(`return (${s})`)();
}
function pinLocal(def, pin, params) {
  const p = def.pins.find(q => q.name === pin);
  const vals = {};
  for (const d of def.params || []) vals[d.key] = d.default;
  Object.assign(vals, params || {});
  return { x: evalPin(p.x, vals) * G, z: evalPin(p.z, vals) * G };
}
function partPinsWorld(doc, part, def) {
  const out = [];
  for (const p of def.pins) {
    const l = pinLocal(def, p.name, part.params);
    const [rx, rz] = rot(l.x, l.z, part.place.rot || 0);
    let w;
    if (part.place.on) { const b = doc.boards.find(bb => bb.id === part.place.on); w = boardToWorld(b, part.place.x + rx, part.place.z + rz); }
    else w = { x: part.place.x + rx, y: 0, z: part.place.z + rz };
    out.push({ pin: p.name, x: w.x, y: w.y, z: w.z });
  }
  return out;
}
function nearestHole(doc, x, z, maxDist = 1.27) {
  let best = null, bd = maxDist;
  for (const b of doc.boards || []) {
    for (const h of holeList(b.type)) {
      const l = holeLocal(b.type, h);
      const w = boardToWorld(b, l.x, l.z);
      const d = Math.hypot(w.x - x, w.z - z);
      if (d <= bd) { bd = d; best = `${b.id}:${h}`; }
    }
  }
  return best;
}
function resolvePins(doc, registry) {
  const pinHole = {}, byHole = new Map();
  for (const part of doc.parts || []) {
    const def = registry.get(part.def);
    if (!def) continue;
    const mounted = part.place.on && def.mount !== 'free';
    for (const p of partPinsWorld(doc, part, def)) {
      const h = mounted ? nearestHole(doc, p.x, p.z, 0.6) : null;
      pinHole[`${part.id}.${p.pin}`] = h;
      if (h) { if (!byHole.has(h)) byHole.set(h, []); byHole.get(h).push(`${part.id}.${p.pin}`); }
    }
  }
  const overlaps = [];
  for (const [hole, pins] of byHole) if (pins.length > 1) overlaps.push({ hole, pins });
  return { pinHole, covered: new Set(), overlaps };
}
export const geoStub = { holeLocal, holeList, stripOf, boardToWorld, pinLocal, partPinsWorld, nearestHole, resolvePins };

// ------------------------------------------------------------- part defs
const two = (id, type, params, extra = {}) => ({
  id, name: id, category: 'passive', mount: 'board', desc: '',
  pins: [{ name: '1', x: 0, z: 0 }, { name: '2', x: '$span', z: 0 }],
  params: [{ key: 'span', type: 'int', default: 4 }, ...params],
  electrical: [{ id: 'main', type, nodes: { a: '1', b: '2' }, params: Object.fromEntries(params.map(p => [p.key, '$' + p.key])) }],
  slots: [], model: { template: 'axial' }, ...extra,
});
export const STUB_DEFS = [
  two('res', 'resistor', [{ key: 'r', type: 'number', default: 220 }, { key: 'pmax', type: 'number', default: 0.25 }]),
  {
    id: 'led', name: 'LED', category: 'semis', mount: 'board', desc: '',
    pins: [{ name: 'A', x: 0, z: 0 }, { name: 'K', x: 1, z: 0 }],
    params: [{ key: 'color', type: 'enum', default: 'red', options: ['red', 'green'] }],
    electrical: [{ id: 'main', type: 'led', nodes: { a: 'A', k: 'K' }, params: { color: '$color' } }],
    slots: [], model: { template: 'radial' }, visual: 'led',
  },
  {
    id: 'battery-9v', name: '9 V battery', category: 'power', mount: 'free', desc: '',
    pins: [{ name: '+', x: 0, z: 0, socket: true }, { name: '−', x: 2, z: 0, socket: true }],
    params: [{ key: 'v', type: 'number', default: 9 }],
    electrical: [{ id: 'main', type: 'battery', nodes: { p: '+', n: '−' }, params: { v: '$v', rint: 1.5, mah: 500 } }],
    slots: [], model: { template: 'box' },
  },
  {
    id: 'supply-bench', name: 'Bench supply', category: 'power', mount: 'free', desc: '',
    pins: [{ name: '+', x: 0, z: 0, socket: true }, { name: '−', x: 4, z: 0, socket: true }],
    params: [{ key: 'v', type: 'number', default: 5, live: true }, { key: 'ilim', type: 'number', default: 1, live: true }, { key: 'on', type: 'bool', default: true, live: true }],
    electrical: [{ id: 'main', type: 'supply', nodes: { p: '+', n: '−' }, params: { v: '$v', ilim: '$ilim', on: '$on' } }],
    slots: [], model: { template: 'box' }, visual: 'supply',
  },
  {
    id: 'ic-74hc00', name: '74HC00', category: 'ics', mount: 'board', desc: '',
    pins: Array.from({ length: 14 }, (_, i) => ({ name: String(i + 1), x: i < 7 ? i : 13 - i, z: i < 7 ? 0 : -3 })),
    params: [],
    electrical: [{ id: 'main', type: 'logic', nodes: Object.fromEntries(Array.from({ length: 14 }, (_, i) => ['p' + (i + 1), String(i + 1)])), params: { chip: '74hc00' } }],
    slots: [], model: { template: 'dip', pins: 14 },
  },
  {
    id: 'span2', name: 'span test part', category: 'mcu', mount: 'board', desc: '',
    pins: [{ name: 'X', x: 0, z: 0 }, { name: 'Y', x: 0, z: 9 }],
    params: [],
    electrical: [{ id: 'main', type: 'resistor', nodes: { a: 'X', b: 'Y' }, params: { r: 1000 } }],
    slots: [], model: { template: 'box' },
  },
];
export function stubRegistry(extra = []) {
  const m = new Map([...STUB_DEFS, ...extra].map(d => [d.id, d]));
  return { get: (id) => m.get(id) || null, list: () => [...m.values()] };
}

// ------------------------------------------------------------- MCU stubs
// actions: [[t, pin, cfg], …] sorted by t
export function scriptMcu(actions) {
  let i = 0, t0 = 0;
  const pins = {};
  return {
    reset(t) { i = 0; t0 = t; },
    nextWake() { return i < actions.length ? t0 + actions[i][0] : Infinity; },
    run(t, io) {
      while (i < actions.length && t0 + actions[i][0] <= t + 1e-15) {
        const [, pin, cfg] = actions[i++];
        pins[pin] = cfg;
        io.drive(pin, cfg);
      }
    },
    pinChanged() {}, serialIn() {},
    state() { return { running: true, millis: 0, pins: {} }; },
  };
}
export function toggleMcu(pin, period) {
  let level = 0, next = 0, t0 = 0;
  const edges = [];
  return {
    edges,
    reset(t) { level = 0; t0 = t; next = t; },
    nextWake() { return next; },
    run(t, io) {
      while (next <= t + 1e-15) {
        io.drive(pin, { mode: 'out', level });
        edges.push([next, level]);
        level ^= 1; next += period;
      }
    },
    pinChanged() {}, serialIn() {},
    state() { return { running: true, millis: 0, pins: {} }; },
  };
}

// LiquidCrystal-style 4-bit init plus text, as [t, pin, cfg] actions.
export function lcdScript(text, pins = { rs: 'D12', e: 'D11', d4: 'D5', d5: 'D4', d6: 'D3', d7: 'D2' }) {
  const acts = [];
  let t = 0.05;
  const out = (pin, v) => acts.push([t, pin, { mode: 'out', level: v ? 1 : 0 }]);
  const nib = (rs, v) => {
    out(pins.rs, rs);
    out(pins.d4, v & 1); out(pins.d5, v & 2); out(pins.d6, v & 4); out(pins.d7, v & 8);
    t += 2e-6; out(pins.e, 1); t += 2e-6; out(pins.e, 0); t += 100e-6;
  };
  const byte = (rs, v) => { nib(rs, v >> 4); nib(rs, v & 15); };
  nib(0, 3); t += 4.5e-3; nib(0, 3); t += 4.5e-3; nib(0, 3); t += 150e-6; nib(0, 2);
  byte(0, 0x28); byte(0, 0x0c); byte(0, 0x01); t += 2e-3; byte(0, 0x06);
  for (const ch of text) byte(1, ch.charCodeAt(0));
  return acts;
}
