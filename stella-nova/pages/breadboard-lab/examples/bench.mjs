// ============================================================================
//  BREADBOARD LAB  ·  examples/bench.mjs — a small language for example benches
// ----------------------------------------------------------------------------
//  examples/build.mjs writes every example document with these helpers, so
//  the JSON files never hold hand-typed millimetres. A part goes in by the
//  hole of its pin 1 ('b1:f20'); a wire goes from a hole or a pin
//  ('p3.GND.1': the part id, a dot, the pin name) to another one.
//
//  After the build, check() resolves every pin with parts/geometry.js and
//  builds the netlist with sim/netlist.js. It fails when a board pin is not
//  in a hole, two pins share a hole, the netlist warns, or an issue of level
//  warn or error is not in the example's expectIssues list.
//
//  Node only (the build tool). The page reads the JSON files.
//
//  GREP MAP
//    COLORS .............. wire colour names -> the eight jumper colours
//    createBench ......... the builder: board, part, free, wire, probe, ...
//    ledUnit ............. resistor + LED + ground wire, one block
//    check ............... the pin, netlist and issue gate
// ============================================================================

export const COLORS = {
  red: '#d63b3b', black: '#2b2b2b', blue: '#2f80d6', green: '#4e9a2e',
  yellow: '#e0c126', purple: '#7a6fd8', orange: '#e2704a', white: '#edede6',
};

const r3 = v => Math.round(v * 1000) / 1000;

// deps: { registry, geo }
export function createBench(deps, meta) {
  const { registry, geo } = deps;
  const doc = {
    format: 'breadboard-lab', version: 1,
    title: meta.title, notes: meta.notes || '',
    boards: [], parts: [], wires: [], probes: [],
    materials: [], customParts: [], programs: {},
    sim: { speed: 1, pwm: 'auto' },
    nextId: 1,
  };
  let n = 1;
  const next = p => p + (n++);
  const usedHoles = new Set();     // wire ends and probe leads, so rail() picks a free hole
  const boardOf = id => doc.boards.find(b => b.id === id);
  const end = (s) => {
    if (s && typeof s === 'object') return s;
    const str = String(s);
    if (str.includes(':')) return { hole: str };
    const i = str.indexOf('.');
    if (i < 1) throw new Error(`bad end "${str}"`);
    return { part: str.slice(0, i), pin: str.slice(i + 1) };
  };
  const endPos = (e) => {
    if (e.hole) return geo.holeWorld(doc, e.hole);
    const part = doc.parts.find(p => p.id === e.part);
    const def = registry.get(part.def);
    const pw = geo.partPinsWorld(doc, part, def).find(q => q.pin === e.pin);
    if (!pw) throw new Error(`no pin ${e.pin} on ${part.def}`);
    return pw;
  };

  const B = {
    doc,
    expect: { pins: {} },
    board(type = 'bb830', x = 0, z = 0, rot = 0, params) {
      const id = next('b');
      const b = { id, type, x, z, rot };
      if (params) b.params = params;
      doc.boards.push(b);
      return id;
    },
    // a board part with pin 1 in `hole`
    part(def, hole, params = {}, o = {}) {
      if (!registry.get(def)) throw new Error(`unknown def ${def}`);
      const i = hole.indexOf(':');
      const bid = hole.slice(0, i), local = hole.slice(i + 1);
      const b = boardOf(bid);
      const l = geo.holeLocal(b.type, local);
      if (!l) throw new Error(`no hole ${hole}`);
      const id = next('p');
      const p = { id, def, place: { on: bid, x: l.x, z: l.z, rot: o.rot || 0 }, params: { ...params } };
      if (o.label) p.label = o.label;
      if (o.looks) p.looks = o.looks;
      doc.parts.push(p);
      return id;
    },
    // a part on the mat, pin 1 at world (x, z)
    free(def, x, z, params = {}, o = {}) {
      if (!registry.get(def)) throw new Error(`unknown def ${def}`);
      const id = next('p');
      const p = { id, def, place: { on: null, x, z, rot: o.rot || 0 }, params: { ...params } };
      if (o.label) p.label = o.label;
      if (o.looks) p.looks = o.looks;
      doc.parts.push(p);
      return id;
    },
    wire(a, b, color = 'red', style) {
      const ea = end(a), eb = end(b);
      let st = style;
      if (!st) {
        const pa = endPos(ea), pb = endPos(eb);
        const d = Math.hypot(pa.x - pb.x, pa.z - pb.z);
        st = ea.hole && eb.hole && d < 26 ? 'flat' : 'arch';
      }
      const id = next('w');
      for (const e of [ea, eb]) if (e.hole) usedHoles.add(e.hole);
      doc.wires.push({ id, a: ea, b: eb, color: COLORS[color] || color, style: st });
      return id;
    },
    probe(type, x, z, leads = {}, settings = {}, rot = 0) {
      const id = next('m');
      const L = {};
      for (const [k, v] of Object.entries(leads)) { L[k] = v == null ? null : end(v); if (L[k] && L[k].hole) usedHoles.add(L[k].hole); }
      doc.probes.push({ id, type, place: { x, z, rot }, leads: L, settings });
      return id;
    },
    program(partId, source) { doc.programs[partId] = { lang: 'sketch', source }; },
    // bench supply on the mat, its posts wired to two rail holes
    supply(v, ilim = 0.5, x = -50, z = -40, plus = 'b1:TP2', minus = 'b1:TN2') {
      const id = B.free('supply-bench', x, z, { v, ilim, on: true }, { label: 'PSU' });
      B.wire(id + '.+', plus, 'red', 'arch');
      B.wire(id + '.−', minus, 'black', 'arch');
      return id;
    },
    // carry both top rails to the bottom rails at rail hole k
    bridge(bid = 'b1', k = 50) {
      B.wire(`${bid}:TP${k}`, `${bid}:BP${k}`, 'red', 'arch');
      B.wire(`${bid}:TN${k}`, `${bid}:BN${k}`, 'black', 'arch');
    },
    // the free rail hole nearest a column (TP/TN or BP/BN); skip: k list
    rail(bid, rail, col, skip = []) {
      const b = boardOf(bid);
      const n = geo.BOARD_TYPES[b.type].railHoles;
      const x = geo.colX(b.type, col);
      let best = null, bd = Infinity;
      for (let k = 1; k <= n; k++) {
        const h = `${bid}:${rail}${k}`;
        if (usedHoles.has(h) || skip.includes(k)) continue;
        const d = Math.abs(geo.railX(b.type, k) - x);
        if (d < bd - 1e-9) { bd = d; best = h; }
      }
      if (!best) throw new Error(`no free ${rail} hole`);
      usedHoles.add(best);
      return best;
    },
    use(hole) { usedHoles.add(hole); },
    // mark the rail holes under a body that hangs over columns c0..c1
    block(bid, rails, c0, c1) {
      const b = boardOf(bid);
      const n = geo.BOARD_TYPES[b.type].railHoles;
      for (let k = 1; k <= n; k++) {
        const c = geo.railX(b.type, k) / geo.G + (geo.BOARD_TYPES[b.type].cols + 1) / 2;
        if (c >= c0 - 0.5 && c <= c1 + 0.5) for (const r of rails) usedHoles.add(`${bid}:${r}${k}`);
      }
    },
    end, endPos,
  };
  return B;
}

// One LED block on an 830 board: resistor from column X to X+4, LED anode in
// X+4 and cathode in X+5, a ground wire from the cathode column to the rail.
// top: rows c (R), d (LED), a (ground wire to TN), b (input).
// bottom: rows h (R), g (LED), j (ground wire to BN), i (input).
// Returns { r, led, input } where input is a free hole of column X.
export function ledUnit(B, { bid = 'b1', X, top = true, color = 'red', r = 220, from = null, wire = 'yellow', label }) {
  const rr = top ? 'c' : 'h', lr = top ? 'd' : 'g', gr = top ? 'a' : 'j', ir = top ? 'b' : 'i';
  const R = B.part('res', `${bid}:${rr}${X}`, { r }, { label: label ? 'R ' + label : undefined });
  const L = B.part('led', `${bid}:${lr}${X + 4}`, { color }, { label });
  B.wire(`${bid}:${gr}${X + 5}`, B.rail(bid, top ? 'TN' : 'BN', X + 5), 'black');
  const input = `${bid}:${ir}${X}`;
  if (from) B.wire(from, input, wire);
  return { r: R, led: L, input };
}

// The gate: every board pin in a hole, no overlaps, no netlist warnings, and
// only the expected warn/error issues. Returns { nl, issues, problems }.
export function check(B, deps, expectIssues = []) {
  const { registry, geo, buildNetlist } = deps;
  const doc = B.doc;
  const problems = [];
  const rp = geo.resolvePins(doc, registry);
  for (const p of doc.parts) {
    const def = registry.get(p.def);
    if (!geo.isBoardMounted(p, def)) continue;
    for (const pin of def.pins) if (!rp.pinHole[`${p.id}.${pin.name}`]) problems.push(`${p.id} (${p.def}) pin ${pin.name} is not in a hole`);
  }
  for (const o of rp.overlaps) problems.push(`two pins in ${o.hole}: ${o.pins.join(', ')}`);
  // one thing per hole: pins, wire ends and probe leads
  const used = new Map();
  const use = (h, what) => { if (!h) return; if (used.has(h)) problems.push(`${h} holds both ${used.get(h)} and ${what}`); else used.set(h, what); };
  for (const [k, h] of Object.entries(rp.pinHole)) use(h, 'pin ' + k);
  for (const w of doc.wires) for (const e of [w.a, w.b]) if (e.hole) use(e.hole, 'wire ' + w.id);
  for (const pr of doc.probes) for (const [ln, e] of Object.entries(pr.leads)) if (e && e.hole) use(e.hole, `lead ${pr.id}.${ln}`);
  const nl = buildNetlist(doc, registry, geo);
  for (const w of nl.warnings) problems.push('netlist: ' + w);
  const bad = nl.issues.filter(i => i.level !== 'info' && !expectIssues.includes(i.code));
  for (const i of bad) problems.push(`issue ${i.code}: ${i.msg}`);
  for (const code of expectIssues) if (!nl.issues.some(i => i.code === code)) problems.push(`expected issue ${code} is missing`);
  return { nl, issues: nl.issues, problems };
}

export { r3 };
