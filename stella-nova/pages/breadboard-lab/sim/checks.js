// ============================================================================
//  BREADBOARD LAB  ·  sim/checks.js — static checks of a bench (the CHECKS list)
// ----------------------------------------------------------------------------
//  checkCircuit(netlist, doc, registry) → Issue[] (contract 3.9). It reads
//  the netlist that sim/netlist.js built (pinNode, pinHole, holeStrip,
//  covered, overlaps) and the document. It does not run the simulator.
//
//  LOW-IMPEDANCE GROUPS. Nodes joined by wires, closed switches, pressed
//  buttons, fuses and ammeters are one group. A source with both terminals in
//  one group is a supply short. An LED with a source positive (or an MCU pin)
//  in its anode group and a source negative or ground in its cathode group
//  has no series resistor.
//
//  CODES (level):
//    floating-input (warn) ..... a logic, 555 or op-amp input on a node with
//                                nothing else on it
//    unconnected-pin (warn/info) a board part pin not in a hole; or a pin in a
//                                strip with nothing else (info)
//    shorted-part (warn) ....... two pins of one part in one strip
//    ic-not-straddling (error) . a DIP chip not across the centre channel
//    led-no-resistor (warn) .... see above
//    supply-short (error) ...... see above
//    rail-no-feed (warn) ....... a rail with part pins and no wire or source
//    covered-hole (warn) ....... a wire end or lead in a hole under a part body
//    pin-overlap (error) ....... two pins in one hole
//    no-ground (warn) .......... no source and no board ground
//    not-simulated (info) ...... modules that are only a load
//
//  GREP MAP
//    INPUT_TERMS ......... the input terminals per element type
//    lowGroups ........... union-find of low-impedance nodes
//    checkCircuit ........ every rule, in the order of the code list
// ============================================================================
import { chipOf } from './chips.js';

const LOWZ = new Set(['wire', 'fuse', 'ameter']);
const POS_TERMS = { vsource: 'p', battery: 'p', supply: 'p', usbpower: 'p', solar: 'p', regulator: 'out' };
const NEG_TERMS = { vsource: 'n', battery: 'n', supply: 'n', usbpower: 'n', solar: 'n', regulator: 'gnd' };
const INPUT_TERMS = {
  timer555: ['trig', 'thres', 'reset'],
  opamp: ['inp', 'inn'],
  hd44780: ['rs', 'e', 'd4', 'd5', 'd6', 'd7'],
};

function lowGroups(nl) {
  const p = new Map();
  const find = (a) => { if (!p.has(a)) p.set(a, a); let r = a; while (p.get(r) !== r) r = p.get(r); p.set(a, r); return r; };
  const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) p.set(rb, ra); };
  for (const el of nl.elements || []) {
    const pr = el.params || {};
    const closed = LOWZ.has(el.type) || (el.type === 'switch' && pr.on) || (el.type === 'button' && pr.pressed);
    if (closed && el.nodes.a != null && el.nodes.b != null) uni(el.nodes.a, el.nodes.b);
  }
  return find;
}

const pinT = (part, pin) => ({ kind: 'pin', part, pin });
const partT = (id) => ({ kind: 'part', id });

export function checkCircuit(nl, doc, registry) {
  const issues = [];
  const add = (level, code, msg, targets) => issues.push({ level, code, msg, targets });
  const label = (id) => (nl.labels && nl.labels[id]) || id;
  const defOf = (id) => {
    let d = null;
    try { d = registry && registry.get ? registry.get(id) : null; } catch { d = null; }
    return d || (doc.customParts || []).find(c => c.id === id) || null;
  };
  const parts = doc.parts || [];
  const pinHole = nl.pinHole || {};
  const holeStrip = nl.holeStrip || {};
  const els = nl.elements || [];

  // node degree over element terminals (probe inputs do not count)
  const degree = new Map();
  for (const el of els) {
    if (el.type === 'vmeter') continue;
    for (const n of Object.values(el.nodes || {})) degree.set(n, (degree.get(n) || 0) + 1);
  }
  const mcuNodes = new Set();
  for (const m of nl.mcus || []) for (const [name, n] of Object.entries(m.pins || {})) if (!/^(GND|5V|3V3|VIN)/i.test(name)) mcuNodes.add(n);

  // ---- floating-input
  for (const el of els) {
    let ins = INPUT_TERMS[el.type];
    if (el.type === 'logic') { const c = chipOf(el.params && el.params.chip); ins = c ? c.inputs.map(n => 'p' + n) : []; }
    if (el.type === 'logic-expr') ins = Object.keys(el.nodes || {}).filter(k => k !== 'vcc' && k !== 'gnd' && !(el.params && el.params.outputs && k in el.params.outputs));
    if (!ins) continue;
    for (const t of ins) {
      const n = el.nodes[t];
      if (n == null) continue;
      if ((degree.get(n) || 0) <= 1 && !mcuNodes.has(n) && n !== 0) {
        add('warn', 'floating-input', `${label(el.owner)}: input ${t.replace(/^p/, 'pin ')} is not connected. A floating input reads at random; tie it high or low.`, [partT(el.owner)]);
      }
    }
  }

  // ---- unconnected-pin, shorted-part, ic-not-straddling, not-simulated
  for (const part of parts) {
    const def = defOf(part.def);
    if (!def) continue;
    const onBoard = def.mount === 'board' || (def.mount === 'either' && part.place && part.place.on);
    const pins = def.pins || [];
    if (onBoard) {
      const off = pins.filter(p => !pinHole[`${part.id}.${p.name}`]);
      if (off.length && off.length === pins.length) add('warn', 'unconnected-pin', `${label(part.id)} is not plugged into a breadboard.`, [partT(part.id)]);
      else for (const p of off) add('warn', 'unconnected-pin', `${label(part.id)} pin ${p.label || p.name} is not in a hole.`, [pinT(part.id, p.name)]);
      // info: a two- or three-pin part with a leg in an empty strip
      if (pins.length <= 4 && !['ics', 'mcu', 'modules'].includes(def.category)) {
        for (const p of pins) {
          const n = nl.pinNode[`${part.id}.${p.name}`];
          if (n != null && (degree.get(n) || 0) <= 1 && n !== 0) {
            add('info', 'unconnected-pin', `${label(part.id)} pin ${p.label || p.name} connects to nothing.`, [pinT(part.id, p.name)]);
          }
        }
      }
    }
    // shorted-part: two pins in one strip (ignore pins joined on purpose)
    const joined = new Set();
    for (const tpl of def.electrical || []) {
      if (tpl.type === 'wire' || tpl.type === 'button') { const ns = Object.values(tpl.nodes || {}).map(String); if (tpl.type === 'wire') joined.add(ns.sort().join('|')); }
    }
    const byStrip = new Map();
    for (const p of pins) {
      const h = pinHole[`${part.id}.${p.name}`];
      const sk = h ? holeStrip[h] : null;
      if (!sk) continue;
      if (!byStrip.has(sk)) byStrip.set(sk, []);
      byStrip.get(sk).push(p.name);
    }
    for (const [sk, names] of byStrip) {
      if (names.length < 2) continue;
      const bases = new Set(names.map(n => n.replace(/\.\d+$/, '')));
      if (bases.size < 2) continue;
      const pairOk = names.length === 2 && joined.has([...names].map(String).sort().join('|'));
      if (pairOk) continue;
      add('warn', 'shorted-part', `${label(part.id)}: pins ${names.join(' and ')} are in the same strip (${sk}), so the part is shorted out.`, [partT(part.id)]);
    }
    // DIP straddle
    const isDip = def.category === 'ics' && ((def.model && def.model.template === 'dip') || pins.every(p => /^\d+$/.test(p.name)));
    if (isDip && pins.length >= 4) {
      const N = pins.length;
      const h1 = pinHole[`${part.id}.1`], hN = pinHole[`${part.id}.${N}`];
      const row = (h) => { const loc = String(h).slice(String(h).lastIndexOf(':') + 1); return /^[a-j]/.test(loc) ? loc[0] : null; };
      if (h1 && hN) {
        const r1 = row(h1), rN = row(hN);
        const top = r => r && r <= 'e';
        if (!r1 || !rN || top(r1) === top(rN)) add('error', 'ic-not-straddling', `${label(part.id)} must sit across the centre channel: its two pin rows are on one side, so opposite pins are shorted.`, [partT(part.id)]);
      }
    }
    if (def.category === 'modules' || (def.tags || []).includes('not-simulated')) {
      add('info', 'not-simulated', `${label(part.id)} is not simulated. It is a supply load with 1 MΩ inputs.`, [partT(part.id)]);
    }
  }

  // ---- led-no-resistor, supply-short
  const g = lowGroups(nl);
  const pos = new Set(), neg = new Set([g(0)]);
  for (const el of els) {
    if (POS_TERMS[el.type] && el.nodes[POS_TERMS[el.type]] != null) pos.add(g(el.nodes[POS_TERMS[el.type]]));
    if (NEG_TERMS[el.type] && el.nodes[NEG_TERMS[el.type]] != null) neg.add(g(el.nodes[NEG_TERMS[el.type]]));
  }
  for (const m of nl.mcus || []) {
    for (const [name, n] of Object.entries(m.pins || {})) {
      if (/^GND/i.test(name)) neg.add(g(n));
      else if (/^(5V|3V3)$/i.test(name) || !/^(VIN|AREF|IOREF|RESET|RST|EN)/i.test(name)) pos.add(g(n));
    }
  }
  for (const el of els) {
    if (el.type === 'led') {
      const a = el.nodes.a, k = el.nodes.k;
      if (a == null || k == null) continue;
      if (pos.has(g(a)) && neg.has(g(k)) && g(a) !== g(k)) {
        add('warn', 'led-no-resistor', `${label(el.owner)}${el.vis ? ' (' + el.vis + ')' : ''} has no series resistor. It will burn out; add about 220 Ω.`, [partT(el.owner)]);
      }
    }
    if (NEG_TERMS[el.type] && POS_TERMS[el.type] && el.type !== 'regulator') {
      const p = el.nodes[POS_TERMS[el.type]], n = el.nodes[NEG_TERMS[el.type]];
      if (p != null && n != null && g(p) === g(n)) add('error', 'supply-short', `${label(el.owner)} is shorted: its + and − connect through wires only.`, [partT(el.owner)]);
    }
  }

  // ---- rail-no-feed
  const wireHoles = new Map();
  for (const w of doc.wires || []) for (const e of [w.a, w.b]) if (e && e.hole) { const sk = holeStrip[e.hole] || null; if (sk) wireHoles.set(sk, (wireHoles.get(sk) || 0) + 1); }
  const sourceParts = new Set(els.filter(e => POS_TERMS[e.type] || e.type === 'usbpower').map(e => e.owner));
  const railPins = new Map();
  for (const [pid, h] of Object.entries(pinHole)) {
    if (!h) continue;
    const sk = holeStrip[h];
    if (!sk || !/:(TP|TN|BP|BN)(\.\d)?$/.test(sk)) continue;
    if (!railPins.has(sk)) railPins.set(sk, []);
    railPins.get(sk).push(pid);
  }
  for (const [sk, pids] of railPins) {
    if (wireHoles.get(sk)) continue;
    if (pids.some(pid => sourceParts.has(pid.slice(0, pid.indexOf('.'))))) continue;
    const n = nl.pinNode[pids[0]];
    if (n === 0) continue;
    add('warn', 'rail-no-feed', `Rail ${sk} has parts on it but nothing feeds it. Run a wire from a supply to the rail.`, pids.map(pid => pinT(pid.slice(0, pid.indexOf('.')), pid.slice(pid.indexOf('.') + 1))));
  }

  // ---- covered-hole
  const covered = new Set(nl.covered || []);
  for (const w of doc.wires || []) for (const e of [w.a, w.b]) if (e && e.hole && covered.has(e.hole)) add('warn', 'covered-hole', `Wire ${w.id} goes into ${e.hole}, a hole under a part body.`, [{ kind: 'wire', id: w.id }, { kind: 'hole', hole: e.hole }]);
  for (const pr of doc.probes || []) for (const [ln, e] of Object.entries(pr.leads || {})) if (e && e.hole && covered.has(e.hole)) add('warn', 'covered-hole', `The ${ln} lead goes into ${e.hole}, a hole under a part body.`, [{ kind: 'lead', probe: pr.id, lead: ln }]);

  // ---- pin-overlap
  for (const o of nl.overlaps || []) {
    const hole = o.hole || (Array.isArray(o) ? o[0] : null);
    const pinsL = o.pins || (Array.isArray(o) ? o.slice(1) : []);
    const targets = [];
    if (hole) targets.push({ kind: 'hole', hole });
    for (const pp of pinsL) { const s = String(pp); const i = s.indexOf('.'); if (i > 0) targets.push(pinT(s.slice(0, i), s.slice(i + 1))); }
    add('error', 'pin-overlap', `Two pins share hole ${hole || '?'}.`, targets);
  }

  // ---- no-ground
  if (nl.ground && nl.ground.why === 'none' && els.some(e => e.type !== 'wire')) {
    add('warn', 'no-ground', 'The bench has no supply and no board ground, so voltages have no reference.', []);
  }
  return issues;
}

function isWiredNode(nl, n) {
  for (const id of nl.wireIds || []) {
    const el = (nl.elements || []).find(e => e.id === id);
    if (el && (el.nodes.a === n || el.nodes.b === n)) return true;
  }
  return false;
}
