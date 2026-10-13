// ============================================================================
//  BREADBOARD LAB  ·  ui/legacy.js — import the old 2D bench (designer-3)
// ----------------------------------------------------------------------------
//  The old page (~/Downloads/breadboard-designer-3.html) saved
//  { placed:[{ uid, defId, board, row, col, rot, mode, side, x, y }],
//    wires:[{ a, b, color }], boards:[{ bx, by }] } with ends
//  { type:'hole', board, row, col } and { type:'pin', uid, pin }.
//  importLegacy() turns that into a Doc (CONTRACT 3.3, 3.10). It is
//  approximate by nature, and says so in its warning list.
//
//  BOARDS. Old boards were 400-point boards on a px grid (686 px per board
//  across, 400 px per board down). Each becomes a bb400 at the same grid
//  place, 4 mm apart.
//
//  PARTS ON A BOARD: A FIT, NOT A COPY. The old pin rows differ from the new
//  3D parts (the old ESP32 straddled rows a and i; the new devkit uses rows
//  b and i). For each of the 4 rotations and each pin as an anchor, the
//  importer puts that pin into its old hole and counts how many other pins
//  also land in their old holes. The best count wins; a partial fit adds a
//  warning that names the part and the count.
//
//  WIRES. A hole end maps to its hole id (rails P1 -> TP, N1 -> TN, P2 -> BP,
//  N2 -> BN, rail col 0..24 -> k 1..25). A wire that ended on a pin of a
//  board part lands in the nearest free hole of that pin's strip (the old
//  "one hole over" rule). A pin of a part on the mat stays a pin end.
//
//  GREP MAP
//    OLD_DEFS ........... the old part kinds and pin names (from designer-3)
//    LEGACY_DEFS ........ old id -> { def, params } (CONTRACT 3.10)
//    oldPinHoles ........ the hole of every old pin (the old pinPoint rules)
//    holeLocal400 ....... board-local mm of a bb400 hole (CONTRACT 3.2)
//    fitPart ............ the rotation and anchor search
//    importLegacy ....... the export: old JSON -> { doc, warnings }
// ============================================================================

const G = 2.54;
export const OLD_COLORS = ['#D63B3B', '#2B2B2B', '#2F80D6', '#4E9A2E', '#E0A126', '#7A6FD8', '#E2704A', '#EDEDE6'];
export const NEW_COLORS = ['#d63b3b', '#2b2b2b', '#2f80d6', '#4e9a2e', '#e0c126', '#7a6fd8', '#e2704a', '#edede6'];
const ESP_TOP = ['EN', 'VP', 'VN', '34', '35', '32', '33', '25', '26', '27', '14', '12', '13', 'GND', 'VIN'];
const ESP_BOT = ['23', '22', 'TX0', 'RX0', '21', '19', '18', '5', '17', '16', '4', '2', '15', 'GND', '3V3'];
export const OLD_DEFS = {
  esp32: { kind: 'dip', top: ESP_TOP, bot: ESP_BOT },
  esp32e: { kind: 'edge', top: ESP_TOP, bot: ESP_BOT },
  esp32sp: { kind: 'span', top: ESP_TOP, bot: ESP_BOT },
  gps: { kind: 'sip', pins: ['VCC', 'RX', 'TX', 'GND', 'PPS'] },
  tft: { kind: 'sip', pins: ['GND', 'VCC', 'SCL', 'SDA', 'RES', 'DC', 'CS', 'BLK'] },
  keypad: { kind: 'sip', pins: ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'] },
  lcd: { kind: 'sip', pins: ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K'] },
  rc522: { kind: 'sip', pins: ['SDA', 'SCK', 'MOSI', 'MISO', 'IRQ', 'GND', 'RST', '3V3'] },
  joy: { kind: 'sip', pins: ['GND', '+5V', 'VRX', 'VRY', 'SW'] },
  seg7: { kind: 'dip2', pad: 2, top: ['D1', 'A', 'F', 'D2', 'D3', 'B'], bot: ['E', 'D', 'DP', 'C', 'G', 'D4'] },
  btnr: { kind: 'dip2', rows: ['d', 'g'], stride: 2, top: ['1', '2'], bot: ['3', '4'] },
  btnb: { kind: 'dip2', rows: ['d', 'g'], stride: 2, top: ['1', '2'], bot: ['3', '4'] },
  btnm: { kind: 'dip2', top: ['1', '2'], bot: ['3', '4'] },
  nrf: { kind: 'off', pins: ['GND', 'VCC', 'CE', 'CSN', 'SCK', 'MOSI', 'MISO', 'IRQ'] },
  radar: { kind: 'off', pins: ['3V3', 'GND', 'OT1', 'RX'] },
  fm: { kind: 'off', pins: ['SDA', 'SCL', '3V3', 'GND', 'ANT'] },
  vshield: { kind: 'off', pins: ['3V', '5V', 'GND'] },
  tp: { kind: 'off', pins: ['OUT+', 'OUT−', 'B+', 'B−'] },
  spk: { kind: 'off', pins: ['+', '−'] },
  solar: { kind: 'off', pins: ['+', '−'] }
};
export const LEGACY_DEFS = {
  esp32: { def: 'mcu-esp32' }, esp32e: { def: 'mcu-esp32' }, esp32sp: { def: 'mcu-esp32' },
  gps: { def: 'mod-gps' }, tft: { def: 'mod-tft154' }, keypad: { def: 'keypad-4x4' }, lcd: { def: 'lcd-1602' },
  rc522: { def: 'mod-rfid' }, joy: { def: 'joystick' }, seg7: { def: 'seg7-4' },
  btnr: { def: 'button-12mm', params: { cap: 'red' } }, btnb: { def: 'button-12mm', params: { cap: 'blue' } },
  btnm: { def: 'button-6mm' }, nrf: { def: 'mod-nrf24' }, radar: { def: 'mod-radar' }, fm: { def: 'mod-fm' },
  vshield: { def: 'batt-18650-shield' }, tp: { def: 'mod-charger' }, spk: { def: 'speaker-8r' }, solar: { def: 'solar-panel' }
};
const ROWS = 'abcdefghij';
const RAIL = { P1: 'TP', N1: 'TN', P2: 'BP', N2: 'BN' };

// bb400 hole -> board-local mm (CONTRACT 3.2)
export function holeLocal400(local) {
  const m = /^([a-j])(\d+)$/.exec(local);
  if (m) {
    const c = +m[2], ri = ROWS.indexOf(m[1]);
    return { x: (c - 15.5) * G, z: ri <= 4 ? -3.81 - (4 - ri) * G : 3.81 + (ri - 5) * G };
  }
  const r = /^(TP|TN|BP|BN)(\d+)$/.exec(local);
  if (!r) return null;
  const k = +r[2], n = 25, u = k - 1 + Math.floor((k - 1) / 5), un = n - 1 + Math.floor((n - 1) / 5);
  return { x: (u - un / 2) * G, z: { TN: -22.86, TP: -20.32, BP: 20.32, BN: 22.86 }[r[1]] };
}
const ALL_HOLES = [];
for (let c = 1; c <= 30; c++) for (const r of ROWS) ALL_HOLES.push(r + c);
for (const rail of ['TP', 'TN', 'BP', 'BN']) for (let k = 1; k <= 25; k++) ALL_HOLES.push(rail + k);
const HOLE_POS = ALL_HOLES.map(id => [id, holeLocal400(id)]);
function nearestHole400(x, z, max = 0.6) {
  let best = null, bd = max;
  for (const [id, p] of HOLE_POS) { const d = Math.hypot(p.x - x, p.z - z); if (d <= bd) { bd = d; best = id; } }
  return best;
}
const stripOf = local => { const m = /^([a-j])(\d+)$/.exec(local); if (m) return m[2] + (ROWS.indexOf(m[1]) < 5 ? 'T' : 'B'); return local.slice(0, 2); };

// the old hole of every pin of an old placed part: [{ idx, name, board, local }]
export function oldPinHoles(p, boards) {
  const d = OLD_DEFS[p.defId];
  const out = [];
  if (!d) return out;
  const rot = (p.rot || 0) & 2;
  const hole = (b, row, col) => ({ board: b, local: row + (col + 1) });
  const names = d.pins || [...d.top, ...d.bot];
  if (d.kind === 'off' && p.mode !== 'board') return names.map((name, idx) => ({ idx, name, board: null, local: null }));
  if (d.kind === 'dip') {
    names.forEach((name, idx) => { const top = idx < 15, n = top ? idx : idx - 15, nn = rot ? 14 - n : n; const row = rot ? (top ? 'i' : 'a') : (top ? 'a' : 'i'); out.push({ idx, name, ...hole(p.board, row, p.col + nn) }); });
  } else if (d.kind === 'dip2') {
    const r0 = (d.rows && d.rows[0]) || 'e', r1 = (d.rows && d.rows[1]) || 'f', stride = d.stride || 1, half = d.top.length;
    names.forEach((name, idx) => { const top = idx < half, n = top ? idx : idx - half, nn = (rot ? half - 1 - n : n) * stride; const row = rot ? (top ? r1 : r0) : (top ? r0 : r1); out.push({ idx, name, ...hole(p.board, row, p.col + nn) }); });
  } else if (d.kind === 'span') {
    const up = spanUpper(p, boards);
    names.forEach((name, idx) => {
      if (idx < 15) out.push(up === null ? { idx, name, board: null, local: null } : { idx, name, ...hole(up, 'i', p.col + idx) });
      else out.push({ idx, name, ...hole(p.board, 'b', p.col + idx - 15) });
    });
  } else if (d.kind === 'edge') {
    names.forEach((name, idx) => {
      const top = idx < 15, n = top ? idx : idx - 15, nn = rot ? 14 - n : n;
      out.push(top ? { idx, name, board: null, local: null } : { idx, name, ...hole(p.board, rot ? 'i' : 'b', p.col + nn) });
    });
  } else {
    const n = names.length;
    names.forEach((name, idx) => out.push({ idx, name, ...hole(p.board, p.row, p.col + (rot ? n - 1 - idx : idx)) }));
  }
  return out;
}
function spanUpper(p, boards) {
  const b = boards[p.board]; if (!b) return null;
  for (let i = 0; i < boards.length; i++) {
    if (i === p.board) continue;
    const o = boards[i];
    if (Math.abs(o.bx - b.bx) < 40 && b.by - o.by > 300 && b.by - o.by < 520) return i;
  }
  return null;
}

const norm = s => String(s).replace(/−/g, '-').toUpperCase();
// old pin names -> new pin names (GND twice -> GND.1, GND.2)
function nameMap(oldNames, def) {
  const newNames = def.pins.map(p => p.name);
  const byNorm = new Map(newNames.map(n => [norm(n), n]));
  const seen = {};
  return oldNames.map((o, idx) => {
    const k = norm(o);
    seen[k] = (seen[k] || 0) + 1;
    if (byNorm.has(k) && !byNorm.has(k + '.1')) return byNorm.get(k);
    if (byNorm.has(`${k}.${seen[k]}`)) return byNorm.get(`${k}.${seen[k]}`);
    if (byNorm.has(k)) return byNorm.get(k);
    return newNames[idx] ?? null;
  });
}
const num = v => (typeof v === 'number' ? v : Number(v) || 0);
const rotXZ = (x, z, rot) => { for (let i = 0; i < (rot & 3); i++) [x, z] = [-z, x]; return [x, z]; };

// O(1): is (x, z) on a bb400 terminal hole? (the rails do not take part pins here)
const ROW_Z = [...ROWS].map((r, ri) => (ri <= 4 ? -3.81 - (4 - ri) * G : 3.81 + (ri - 5) * G));
function onHole400(x, z) {
  const c = x / G + 15.5, rc = Math.round(c);
  if (Math.abs(c - rc) > 0.12 || rc < 1 || rc > 30) return false;
  return ROW_Z.some(rz => Math.abs(rz - z) < 0.3);
}
// pins: [{ name, lx, lz (mm, rot 0, pin 1 at 0,0), tx, tz (old hole mm) }];
// all: every pin of the new def as [lx, lz] (they must all land in holes)
// Score, in order: pins in holes, pins in their old holes, the part centred
// across the channel, the distance to the old holes.
export function fitPart(pins, all = null) {
  const every = all || pins.map(q => [q.lx, q.lz]);
  let best = null;
  const better = (c, b) => !b || c.on > b.on || (c.on === b.on && (c.match > b.match || (c.match === b.match && (c.cz < b.cz - 1e-6 || (Math.abs(c.cz - b.cz) <= 1e-6 && c.err < b.err - 1e-6)))));
  const score = (px, pz, rot) => {
    let match = 0, err = 0, on = 0, sz = 0;
    for (const q of pins) {
      const [qx, qz] = rotXZ(q.lx, q.lz, rot);
      const d = Math.hypot(px + qx - q.tx, pz + qz - q.tz);
      if (d < 0.3) match++;
      err += d;
    }
    for (const [lx, lz] of every) { const [qx, qz] = rotXZ(lx, lz, rot); if (onHole400(px + qx, pz + qz)) on++; sz += pz + qz; }
    return { x: px, z: pz, rot, match, err, on, cz: Math.abs(sz / every.length) };
  };
  for (let rot = 0; rot < 4; rot++) {
    for (let a = pins.length - 1; a >= 0; a--) {
      const A = pins[a];
      const [rx, rz] = rotXZ(A.lx, A.lz, rot);
      const px = A.tx - rx, pz = A.tz - rz;
      const c = score(px, pz, rot);
      if (better(c, best)) best = c;
      if (c.on < every.length) {
        // some pins miss the board: try whole-row and whole-column shifts
        for (let dz = -12; dz <= 12; dz++) for (let dx = -4; dx <= 4; dx++) {
          if (!dz && !dx) continue;
          const s = score(px + dx * G, pz + dz * G, rot);
          if (better(s, best)) best = s;
        }
      }
    }
  }
  return best;
}

export function importLegacy(old, { registry = null } = {}) {
  const warnings = [];
  const warn = m => warnings.push(m);
  if (!old || !Array.isArray(old.placed) || !Array.isArray(old.wires)) throw new Error('not an old bench file: it needs "placed" and "wires" lists');
  const OX = 110, BY = 132, BW = 686, BH = 400;
  const oldBoards = (old.boards && old.boards.length) ? old.boards : [0, 1, 2].map(i => ({ bx: OX + i * BW, by: BY }));
  const minX = Math.min(...oldBoards.map(b => b.bx)), minY = Math.min(...oldBoards.map(b => b.by));
  const grid = oldBoards.map(b => [Math.round((b.bx - minX) / BW), Math.round((b.by - minY) / BH)]);
  const gx = Math.max(...grid.map(g => g[0])), gz = Math.max(...grid.map(g => g[1]));
  const boards = grid.map(([ix, iz], i) => ({ id: 'b' + (i + 1), type: 'bb400', x: +((ix - gx / 2) * 86.6).toFixed(2), z: +((iz - gz / 2) * 58.6).toFixed(2), rot: 0 }));
  if (grid.some((g, i) => grid.findIndex(h => h[0] === g[0] && h[1] === g[1]) !== i)) warn('two old boards sat on the same spot; they now overlap');
  let next = boards.length + 1;
  const parts = [], wires = [];
  const partOf = new Map();            // old uid -> { id, free, pinName[], pinHole{} }
  const used = new Set();              // board holes taken by pins or wire ends
  let freeK = 0;
  const bottom = Math.max(...boards.map(b => b.z)) + 27.3 + 30, left = Math.min(...boards.map(b => b.x)) - 41.3;

  for (const p of old.placed) {
    const map = LEGACY_DEFS[p.defId], od = OLD_DEFS[p.defId];
    if (!map || !od) { warn(`old part "${p.defId}" (uid ${p.uid}) has no new part; it was left out`); continue; }
    const def = registry && registry.get ? registry.get(map.def) : null;
    const id = 'p' + (next++);
    const part = { id, def: map.def, label: undefined, place: { on: null, x: 0, z: 0, rot: 0 }, params: { ...(map.params || {}) } };
    delete part.label;
    const holes = oldPinHoles(p, oldBoards);
    const oldNames = holes.map(hh => hh.name);
    const names = def ? nameMap(oldNames, def) : oldNames;
    const rec = { id, free: true, names, pinHole: {} };
    const onBoard = holes.some(hh => hh.local) && (!def || def.mount !== 'free');
    if (onBoard) {
      // fit on the board that holds most of the old pins
      const count = {};
      for (const hh of holes) if (hh.local) count[hh.board] = (count[hh.board] || 0) + 1;
      const bi = +Object.entries(count).sort((a, b) => b[1] - a[1] || (+b[0] === p.board) - (+a[0] === p.board))[0][0];
      if (Object.keys(count).length > 1) warn(`${map.def} (old ${p.defId}) spanned two boards; it now sits on board ${bi + 1}`);
      if (def) {
        const pins = [];
        holes.forEach((hh, i) => {
          if (hh.board !== bi || !hh.local || !names[i]) return;
          const dp = def.pins.find(q => q.name === names[i]);
          const t = holeLocal400(hh.local);
          if (!dp || !t) return;
          pins.push({ name: names[i], lx: num(dp.x) * G, lz: num(dp.z) * G, tx: t.x, tz: t.z });
        });
        const f = pins.length ? fitPart(pins, def.pins.map(q => [num(q.x) * G, num(q.z) * G])) : null;
        if (f) {
          part.place = { on: boards[bi].id, x: +f.x.toFixed(3), z: +f.z.toFixed(3), rot: f.rot };
          if (f.match < pins.length) warn(`${map.def} (old ${p.defId}): ${f.match} of ${pins.length} pins land in their old holes; the new part has a different pin layout`);
          if (f.on < def.pins.length) warn(`${map.def} (old ${p.defId}): ${def.pins.length - f.on} pins do not reach a hole`);
          // where every new pin lands now
          for (const dp of def.pins) {
            const [rx, rz] = rotXZ(num(dp.x) * G, num(dp.z) * G, f.rot);
            const local = nearestHole400(f.x + rx, f.z + rz);
            if (local) { rec.pinHole[dp.name] = `${boards[bi].id}:${local}`; used.add(rec.pinHole[dp.name]); }
            else warn(`${map.def} pin ${dp.name} is off the board`);
          }
          rec.free = false;
        }
      } else {
        const h0 = holes.find(hh => hh.board === bi && hh.local);
        const t = holeLocal400(h0.local);
        part.place = { on: boards[bi].id, x: t.x, z: t.z, rot: 0 };
        warn(`${map.def}: no part registry, pin 1 is at ${h0.local} and the rotation is a guess`);
        holes.forEach((hh, i) => { if (hh.board === bi && hh.local) { rec.pinHole[names[i]] = `${boards[bi].id}:${hh.local}`; used.add(rec.pinHole[names[i]]); } });
        rec.free = false;
      }
    }
    if (rec.free) {
      if (holes.some(hh => hh.local)) warn(`${map.def} (old ${p.defId}) was on a board; the new part sits on the mat, wire it from its terminals`);
      part.place = { on: null, x: +(left + (freeK % 6) * 30).toFixed(2), z: +(bottom + Math.floor(freeK / 6) * 34).toFixed(2), rot: 0 };
      freeK++;
    }
    parts.push(part);
    partOf.set(p.uid, rec);
  }

  const endOf = (e, wi) => {
    if (!e) return null;
    if (e.type === 'hole') {
      if (!boards[e.board]) { warn(`wire ${wi + 1}: board ${e.board + 1} does not exist`); return null; }
      if (RAIL[e.row]) return { hole: `${boards[e.board].id}:${RAIL[e.row]}${e.col + 1}` };
      if (ROWS.includes(e.row)) return { hole: `${boards[e.board].id}:${e.row}${e.col + 1}` };
      warn(`wire ${wi + 1}: unknown row ${e.row}`); return null;
    }
    if (e.type === 'pin') {
      const rec = partOf.get(e.uid);
      if (!rec) { warn(`wire ${wi + 1}: its part (uid ${e.uid}) was not imported`); return null; }
      const name = rec.names[e.pin];
      if (!name) { warn(`wire ${wi + 1}: pin ${e.pin} has no new pin`); return null; }
      if (rec.free) return { part: rec.id, pin: name };
      const ph = rec.pinHole[name];
      if (!ph) { warn(`wire ${wi + 1}: pin ${name} of ${rec.id} is not in a hole`); return { part: rec.id, pin: name }; }
      // the nearest free hole of the pin's strip
      const [bid, local] = ph.split(':');
      const strip = stripOf(local);
      const m = /^([a-j])(\d+)$/.exec(local);
      if (!m) return { hole: ph };
      const ri = ROWS.indexOf(m[1]);
      const cands = (ri < 5 ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9]).filter(r => r !== ri).sort((a, b) => Math.abs(a - ri) - Math.abs(b - ri));
      for (const r of cands) {
        const id = `${bid}:${ROWS[r]}${m[2]}`;
        if (!used.has(id)) { used.add(id); return { hole: id }; }
      }
      warn(`wire ${wi + 1}: strip ${strip} of ${bid} has no free hole for ${rec.id}.${name}`);
      return null;
    }
    return null;
  };
  // hole ends first, so the "one hole over" search knows which holes they take
  for (const w of old.wires) for (const e of [w.a, w.b]) if (e && e.type === 'hole') { const x = endOf(e, 0); if (x) used.add(x.hole); }
  old.wires.forEach((w, wi) => {
    const a = endOf(w.a, wi), b = endOf(w.b, wi);
    if (!a || !b) { warn(`wire ${wi + 1} was left out`); return; }
    if (a.hole && a.hole === b.hole) { warn(`wire ${wi + 1} starts and ends in one hole; left out`); return; }
    const ci = OLD_COLORS.findIndex(c => c.toLowerCase() === String(w.color || '').toLowerCase());
    wires.push({ id: 'w' + (next++), a, b, color: ci >= 0 ? NEW_COLORS[ci] : (/^#[0-9a-f]{6}$/i.test(w.color || '') ? w.color.toLowerCase() : NEW_COLORS[0]), style: 'arch' });
  });
  const doc = {
    format: 'breadboard-lab', version: 1,
    title: 'Imported bench', notes: `Imported from the old 2D bench (${old.placed.length} parts, ${old.wires.length} wires).`,
    boards, parts, wires, probes: [], materials: [], customParts: [], programs: {},
    sim: { speed: 1, pwm: 'auto' }, nextId: next
  };
  return { doc, warnings };
}
