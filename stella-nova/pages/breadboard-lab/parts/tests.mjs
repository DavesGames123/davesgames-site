// ============================================================================
//  BREADBOARD LAB  ·  parts/tests.mjs — node tests of the PARTS role
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/breadboard-lab/parts/tests.mjs
//  One line per check with the measured value. Exit 1 on any failure.
//  three r160 is loaded by path; nothing here needs a browser.
//
//  GREP MAP
//    check / near ........... the tiny harness
//    REGISTRY ............... defs validate, ids, contract ids, pin names
//    ELECTRICAL ............. expandElectrical, when, $refs, validator traps
//    GEOMETRY ............... hole counts, positions, strips, frames
//    RESOLVE ................ DIP across the channel, off-hole pins, spans
//    BANDS .................. colour code, E-series
//    MODELS ................. every part builds; budgets; pins; state; damage
//    MATERIALS .............. presets validate, build and cache
//    WIRES .................. wirePath ends, arch height, flat bend, mesh
//    BOARDS ................. buildBoard holes match geometry
//    HYGIENE ................ headers, fonts, trademark words
// ============================================================================
import * as THREE from '../../../vendor/three@0.160.0/build/three.module.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from './index.js';
import { countTriangles } from './models/kit.js';
import { patternBytes } from './materials.js';
import { dmmText } from './models/instruments.js';
import { encodeText, SEG_FONT } from './models/segments.js';
import { glyphRows } from './models/font5x7.js';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function check(name, ok, measured = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${measured !== '' ? '  [' + measured + ']' : ''}`);
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const G = P.G;

// ============================================================ REGISTRY
const reg = P.createRegistry();
const defs = P.BUILTIN_DEFS;
check('built-in count >= 65', defs.length >= 65, defs.length);
const ids = new Set(defs.map(d => d.id));
check('built-in ids unique', ids.size === defs.length, `${ids.size}/${defs.length}`);
let allValid = true;
for (const d of defs) {
  const e = reg.validate(d);
  if (e.length) { allValid = false; console.log('   ', e.join('\n    ')); }
}
check('every built-in def passes reg.validate', allValid);

const CONTRACT_IDS = ['supply-bench', 'battery-9v', 'battery-aa2', 'battery-aa4', 'coin-cr2032', 'usb-breakout', 'funcgen',
  'solar-panel', 'batt-18650-shield', 'res', 'pot', 'trimpot', 'cap-ceramic', 'cap-elec', 'inductor', 'fuse', 'ldr',
  'thermistor', 'diode-1n4148', 'diode-1n4007', 'diode-schottky', 'zener', 'led', 'led-rgb', 'npn-2n3904', 'npn-2n2222',
  'pnp-2n3906', 'nmos-2n7000', 'nmos-logic-to220', 'pmos-to220', 'ic-555', 'ic-lm358', 'ic-74hc00', 'ic-74hc02',
  'ic-74hc04', 'ic-74hc08', 'ic-74hc32', 'ic-74hc86', 'ic-74hc74', 'ic-74hc595', 'ic-cd4017', 'reg-7805', 'reg-3v3',
  'buzzer-active', 'buzzer-passive', 'speaker-8r', 'motor-dc', 'servo', 'relay-5v', 'seg7-1', 'seg7-4', 'lcd-1602',
  'lamp-6v', 'button-6mm', 'button-12mm', 'switch-slide', 'joystick', 'keypad-4x4', 'temp-analog', 'mcu-uno',
  'mcu-nano', 'mcu-esp32', 'mod-gps', 'mod-tft154', 'mod-rfid', 'mod-nrf24', 'mod-radar', 'mod-fm', 'mod-charger',
  'inst-dmm', 'inst-scope', 'inst-logic'];
const missing = CONTRACT_IDS.filter(id => !reg.get(id));
check('every contract part id exists', !missing.length, missing.join(',') || CONTRACT_IDS.length);

const MINUS = '−';
const PIN_SPEC = {
  'supply-bench': ['+', MINUS], 'battery-9v': ['+', MINUS], 'coin-cr2032': ['+', MINUS], 'usb-breakout': ['VBUS', 'GND'],
  funcgen: ['OUT', 'COM'], 'batt-18650-shield': ['3V', '5V', 'GND'], res: ['1', '2'], pot: ['1', 'W', '2'],
  'cap-elec': ['+', MINUS], led: ['A', 'K'], 'led-rgb': ['R', 'K', 'G', 'B'], 'npn-2n3904': ['E', 'B', 'C'],
  'nmos-2n7000': ['S', 'G', 'D'], 'nmos-logic-to220': ['G', 'D', 'S'], 'reg-7805': ['IN', 'GND', 'OUT'],
  'motor-dc': ['A', 'B'], servo: ['SIG', 'VCC', 'GND'], 'relay-5v': ['C1', 'C2', 'COM', 'NO', 'NC'],
  'seg7-1': ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp', 'COM1', 'COM2'],
  'seg7-4': ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp', 'D1', 'D2', 'D3', 'D4'],
  'lcd-1602': ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K'],
  'button-6mm': ['1', '2', '3', '4'], 'switch-slide': ['A', 'COM', 'B'], joystick: ['GND', '+5V', 'VRX', 'VRY', 'SW'],
  'keypad-4x4': ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'], 'temp-analog': ['+V', 'OUT', 'GND'],
  'mcu-uno': [...Array.from({ length: 14 }, (_, i) => 'D' + i), ...Array.from({ length: 6 }, (_, i) => 'A' + i),
    '5V', '3V3', 'GND.1', 'GND.2', 'GND.3', 'VIN', 'AREF', 'IOREF', 'RESET'],
  'mcu-nano': [...Array.from({ length: 14 }, (_, i) => 'D' + i), ...Array.from({ length: 8 }, (_, i) => 'A' + i),
    '5V', '3V3', 'GND.1', 'GND.2', 'VIN', 'AREF', 'RST.1', 'RST.2'],
  'mcu-esp32': ['EN', 'VP', 'VN', '34', '35', '32', '33', '25', '26', '27', '14', '12', '13', 'GND.1', 'VIN', '23', '22',
    'TX0', 'RX0', '21', '19', '18', '5', '17', '16', '4', '2', '15', 'GND.2', '3V3'],
};
let pinNamesOk = true;
for (const id in PIN_SPEC) {
  const got = reg.get(id).pins.map(p => p.name).sort().join('|');
  const want = PIN_SPEC[id].slice().sort().join('|');
  if (got !== want) { pinNamesOk = false; console.log(`    ${id}: got ${got}`); }
}
check('pin names match CONTRACT 3.5', pinNamesOk, Object.keys(PIN_SPEC).length + ' defs');
const DIP_COUNTS = { 'ic-555': 8, 'ic-lm358': 8, 'ic-74hc00': 14, 'ic-74hc74': 14, 'ic-74hc595': 16, 'ic-cd4017': 16 };
check('DIP pins named 1..N', Object.entries(DIP_COUNTS).every(([id, n]) => reg.get(id).pins.map(p => p.name).join() === Array.from({ length: n }, (_, i) => String(i + 1)).join()));
check('categories are the contract list', P.CATEGORIES.join() === 'power,passive,semis,ics,output,input,sensors,mcu,modules,instruments,custom');
check('every category used by a def is known', defs.every(d => reg.categories.includes(d.category)));
check('reg.list(category) filters', reg.list('mcu').length === 3 && reg.list().length === defs.length, reg.list('mcu').map(d => d.id).join());
const boardParts = defs.filter(d => d.mount === 'board');
check('board parts: pin 1 at grid (0,0)', boardParts.every(d => { const g = P.pinGrid(d, d.pins[0], {}); return g.x === 0 && g.z === 0; }), boardParts.length);
check('free parts: every pin is a socket', defs.filter(d => d.mount === 'free').every(d => d.pins.every(p => p.socket === true)));
check('mcu defs list their GPIO pins', reg.list('mcu').every(d => d.mcu && d.mcu.pins.length >= 20), reg.list('mcu').map(d => d.mcu.pins.length).join('/'));
check('modules are marked notSimulated', reg.list('modules').every(d => d.notSimulated === true));
check('instruments name their leads', reg.list('instruments').every(d => Array.isArray(d.leads) && d.leads.length >= 2));
check('built-in defs are frozen', Object.isFrozen(reg.get('res')) && Object.isFrozen(reg.get('res').pins[1]));
// legacy map
const legacyBad = Object.entries(P.LEGACY_MAP).filter(([, v]) => !reg.get(v.def));
check('LEGACY_MAP targets exist', !legacyBad.length, Object.keys(P.LEGACY_MAP).length + ' old ids');

// custom defs
const custom = {
  id: 'cp-and3', name: 'Triple AND', category: 'custom', mount: 'board', desc: 'test',
  pins: [{ name: 'A', x: 0, z: 0 }, { name: 'B', x: 1, z: 0 }, { name: 'C', x: 2, z: 0 }, { name: 'Y', x: 3, z: 0 }, { name: 'VCC', x: 4, z: 0 }, { name: 'GND', x: 5, z: 0 }],
  params: [], electrical: [{ id: 'main', type: 'logic-expr', nodes: { A: 'A', B: 'B', C: 'C', Y: 'Y', vcc: 'VCC', gnd: 'GND' }, params: { outputs: { Y: 'A&B&C' }, inputs: ['A', 'B', 'C'] } }],
  slots: [{ key: 'body', label: 'Body', default: 'epoxy-black' }], model: { template: 'dip', pins: 6, label: 'AND3' },
};
const r1 = reg.add(custom);
check('reg.add accepts a valid custom def', r1.ok && reg.get('cp-and3') === custom, r1.errors.join(';'));
check('reg.add refuses a built-in id', !reg.add({ ...custom, id: 'res' }).ok);
check('reg.remove removes a custom def only', reg.remove('cp-and3') && !reg.get('cp-and3') && !reg.remove('res') && !!reg.get('res'));

// ============================================================ ELECTRICAL
const bad = (mut, want) => {
  const d = JSON.parse(JSON.stringify(custom)); mut(d);
  const e = P.validateDef(d);
  return e.some(s => s.includes(want)) ? 'caught' : 'MISSED: ' + e.join(';');
};
check('validator: unknown element type', bad(d => { d.electrical[0].type = 'flux'; }, 'unknown element type') === 'caught');
check('validator: unknown terminal', bad(d => { d.electrical = [{ id: 'r', type: 'resistor', nodes: { a: 'A', q: 'B' }, params: { r: 1 } }]; }, 'has no terminal q') === 'caught');
check('validator: missing terminal', bad(d => { d.electrical = [{ id: 'r', type: 'resistor', nodes: { a: 'A' }, params: { r: 1 } }]; }, 'terminal b not connected') === 'caught');
check('validator: unknown pin', bad(d => { d.electrical = [{ id: 'r', type: 'resistor', nodes: { a: 'A', b: 'Z9' }, params: { r: 1 } }]; }, 'unknown pin Z9') === 'caught');
check('validator: unknown $param', bad(d => { d.electrical = [{ id: 'r', type: 'resistor', nodes: { a: 'A', b: 'B' }, params: { r: '$rr' } }]; }, 'unknown param $rr') === 'caught');
check('validator: bad element param', bad(d => { d.electrical = [{ id: 'r', type: 'resistor', nodes: { a: 'A', b: 'B' }, params: { ohms: 1 } }]; }, 'not a resistor param') === 'caught');
check('validator: pin 1 off the origin', bad(d => { d.pins[0].x = 1; d.pins[1].x = 7; }, 'pin 1') === 'caught');
check('validator: half-grid board pin', bad(d => { d.pins[1].x = 1.5; }, 'off the 0.1 inch grid') === 'caught');
check('validator: duplicate pin', bad(d => { d.pins[1].name = 'A'; }, 'duplicate pin A') === 'caught');
check('validator: logic chip pin count', bad(d => { d.electrical = [{ id: 'm', type: 'logic', nodes: { p1: 'A' }, params: { chip: '74hc00' } }]; }, 'terminal p14 not connected') === 'caught');
check('validator: unknown template', bad(d => { d.model.template = 'blob'; }, 'unknown model template') === 'caught');

const segC = P.expandElectrical(reg.get('seg7-1'), {});
const segA = P.expandElectrical(reg.get('seg7-1'), { common: 'anode' });
const segAa = segA.find(e => e.vis === 'a');
check('seg7-1 common cathode: 8 leds a -> COM1', segC.filter(e => e.type === 'led').length === 8 && segC.find(e => e.id === 'a').nodes.k === 'COM1');
check('seg7-1 common anode: leds reversed', segA.filter(e => e.type === 'led').length === 8 && segAa.nodes.a === 'COM1' && segAa.nodes.k === 'a', segAa.id);
check('seg7-1 COM1-COM2 joined', segC.some(e => e.type === 'wire' && e.nodes.a === 'COM1' && e.nodes.b === 'COM2'));
const seg4 = P.expandElectrical(reg.get('seg7-4'), {});
check('seg7-4: 32 leds d1a..d4dp', seg4.length === 32 && seg4.some(e => e.id === 'd1a' && e.nodes.k === 'D1') && seg4.some(e => e.id === 'd4dp' && e.nodes.a === 'dp'), seg4.length);
const resEl = P.expandElectrical(reg.get('res'), { r: 4700 })[0];
check('res: $r resolves', resEl.params.r === 4700 && resEl.params.pmax === 0.25, JSON.stringify(resEl.params));
const fg = P.expandElectrical(reg.get('funcgen'), { freq: 440, wave: 'square' })[0];
check('funcgen: nested wave params resolve', fg.params.wave.freq === 440 && fg.params.wave.kind === 'square' && fg.params.rint === 50, JSON.stringify(fg.params.wave));
const btn = P.expandElectrical(reg.get('button-6mm'), { pressed: true });
check('button-6mm: wire 1-2, 3-4, button 1-3', btn.length === 3 && btn.find(e => e.type === 'button').nodes.b === '3' && btn.find(e => e.type === 'button').params.pressed === true);
const kp = P.expandElectrical(reg.get('keypad-4x4'), { k23: true });
check('keypad: 16 buttons, k23 joins R2-C3', kp.length === 16 && kp.find(e => e.id === 'k23').params.pressed === true && kp.find(e => e.id === 'k23').nodes.a === 'R2' && kp.find(e => e.id === 'k23').nodes.b === 'C3');
const uno = P.expandElectrical(reg.get('mcu-uno'), {});
check('mcu-uno: usbpower, two regulators, L LED on D13 via 1k', uno.some(e => e.type === 'usbpower' && e.params.usb === true) &&
  uno.filter(e => e.type === 'regulator').length === 2 && uno.some(e => e.id === 'rL' && e.nodes.a === 'D13' && e.params.r === 1000) &&
  uno.some(e => e.vis === 'L') && uno.some(e => e.vis === 'ON'));
const esp = P.expandElectrical(reg.get('mcu-esp32'), {});
check('mcu-esp32: LED on GPIO 2, 3V3 regulator', esp.some(e => e.id === 'rLED' && e.nodes.a === '2') && esp.some(e => e.type === 'regulator' && e.params.model === 'ams1117-3.3'));
check('evalExpr', P.evalExpr('$span-1', { span: 4 }) === 3 && P.evalExpr('2*($n+1)/4', { n: 3 }) === 2 && P.evalExpr('-3') === -3);
let threw = false; try { P.evalExpr('$q+1', {}); } catch { threw = true; }
check('evalExpr rejects unknown $key', threw);
check('pinGrid reads the resistor span', P.pinGrid(reg.get('res'), '2', { span: 7 }).x === 7);

// ============================================================ GEOMETRY
const counts = Object.keys(P.BOARD_TYPES).map(t => P.holeList(t).length);
check('hole counts 830 / 400 / 170', counts.join() === '830,400,170', counts.join());
const H = (t, l) => P.holeLocal(t, l);
const posOk = [
  ['a1', -31 * G, -13.97], ['e1', -31 * G, -3.81], ['f1', -31 * G, 3.81], ['j63', 31 * G, 13.97],
  ['TP1', -29 * G, -20.32], ['BN50', 29 * G, 22.86], ['TN6', -23 * G, -22.86],
].every(([l, x, z]) => { const p = H('bb830', l); return near(p.x, x, 1e-6) && near(p.z, z, 1e-6); });
check('bb830 hole positions a1 e1 f1 j63 TP1 BN50 TN6', posOk, `a1=${JSON.stringify(H('bb830', 'a1'))} BN50=${JSON.stringify(H('bb830', 'BN50'))}`);
check('bb400 TP1 and TP25 symmetric', near(H('bb400', 'TP1').x, -H('bb400', 'TP25').x), H('bb400', 'TP25').x);
check('bb170 has no rails', P.holeLocal('bb170', 'TP1') === null && P.holeList('bb170').every(h => /^[a-j]\d+$/.test(h)));
check('bad hole ids give null', H('bb830', 'k3') === null && H('bb830', 'a64') === null && H('bb830', 'a0') === null && H('bb830', 'TP51') === null && H('bb830', 'a01') === null);
const S830 = P.strips('bb830');
check('bb830 strips: 63*2 columns + 4 rails', Object.keys(S830).length === 130 && S830['12T'].join() === 'a12,b12,c12,d12,e12' && S830.TP.length === 50, Object.keys(S830).length);
const S830s = P.strips('bb830', { splitRails: true });
check('bb830 split rails: TP.1 / TP.2 of 25', S830s['TP.1'].length === 25 && S830s['TP.2'].length === 25 && P.stripOf('bb830', 'TP26', { splitRails: true }) === 'TP.2', Object.keys(S830s).length);
check('bb400 ignores splitRails', P.stripOf('bb400', 'TP20', { splitRails: true }) === 'TP');
check('stripOf f..j is B', P.stripOf('bb400', 'f7') === '7B' && P.stripOf('bb400', 'e7') === '7T');
const r1w = P.rotXZ(3, 5, 1);
check('rot 1 maps (x,z) to (-z,x)', r1w.x === -5 && r1w.z === 3, JSON.stringify(r1w));
const brd = { id: 'b1', type: 'bb830', x: 40, z: -12, rot: 1 };
let rt = true;
for (const [x, z] of [[1, 2], [-30, 7], [0, 0]]) { const w = P.boardToWorld(brd, x, z); const b = P.worldToBoard(brd, w.x, w.z); if (!near(b.x, x) || !near(b.z, z)) rt = false; }
check('boardToWorld / worldToBoard round trip', rt);
const o3 = new THREE.Object3D(); o3.position.set(40, 0, -12); o3.rotation.y = -Math.PI / 2; o3.updateMatrixWorld();
const v3 = new THREE.Vector3(1, 0, 2).applyMatrix4(o3.matrixWorld), w3 = P.boardToWorld(brd, 1, 2);
check('three rotation.y = -rot*pi/2 agrees with boardToWorld', near(v3.x, w3.x, 1e-9) && near(v3.z, w3.z, 1e-9), `${v3.x.toFixed(3)},${v3.z.toFixed(3)}`);

// ============================================================ RESOLVE
const at = (doc, holeId) => P.holeWorld(doc, holeId);
function placeOn(doc, board, hole, def, extra = {}) {
  const l = P.holeLocal(doc.boards.find(b => b.id === board).type, hole);
  return { id: 'p' + (doc.parts.length + 1), def, place: { on: board, x: l.x, z: l.z, rot: extra.rot || 0 }, params: extra.params || {} };
}
let dipOk = true;
const dipMeasured = [];
for (const id of ['ic-555', 'ic-74hc00', 'ic-74hc595', 'ic-cd4017', 'ic-lm358']) {
  const doc = { boards: [{ id: 'b1', type: 'bb830', x: 0, z: 0, rot: 0 }], parts: [] };
  doc.parts.push(placeOn(doc, 'b1', 'f10', id));
  const n = reg.get(id).pins.length;
  const res = P.resolvePins(doc, reg);
  const want = 'b1:e' + (10 + n / 2 - 1);
  const got = res.pinHole['p1.' + (n / 2 + 1)];
  dipMeasured.push(`${id}:${got}`);
  if (got !== want || res.pinHole['p1.1'] !== 'b1:f10' || res.pinHole['p1.' + n] !== 'b1:e10') dipOk = false;
}
check('resolvePins: DIP pin 1 at f10 -> pin N/2+1 at e(10+N/2-1)', dipOk, dipMeasured.join(' '));
{
  const doc = { boards: [{ id: 'b1', type: 'bb400', x: 0, z: 0, rot: 0 }], parts: [] };
  const p = placeOn(doc, 'b1', 'a5', 'res'); p.place.x += 1.0;      // 1 mm off the grid
  doc.parts.push(p);
  const res = P.resolvePins(doc, reg);
  check('resolvePins: a pin off a hole gives null', res.pinHole['p1.1'] === null && res.pinHole['p1.2'] === null, JSON.stringify(res.pinHole));
}
{
  const doc = { boards: [{ id: 'b1', type: 'bb830', x: 0, z: 0, rot: 2 }], parts: [] };
  doc.parts.push(placeOn(doc, 'b1', 'f10', 'res', { rot: 3, params: { span: 7 } }));
  const res = P.resolvePins(doc, reg);
  check('resolvePins: rotated part on a rotated board', res.pinHole['p1.1'] === 'b1:f10' && res.pinHole['p1.2'] === 'b1:a10', res.pinHole['p1.2']);
}
{
  // two 830 boards side by side, rows touching: the ESP32 spans them
  const doc = { boards: [{ id: 'b1', type: 'bb830', x: 0, z: 0, rot: 0 }, { id: 'b2', type: 'bb830', x: 0, z: 54.6, rot: 0 }], parts: [] };
  const p = placeOn(doc, 'b1', 'i20', 'mcu-esp32');
  doc.parts.push(p);
  const res = P.resolvePins(doc, reg);
  const en = res.pinHole['p1.EN'], v33 = res.pinHole['p1.3V3'];
  check('ESP32 spanning two boards plugs into both', en === 'b1:i20' && /^b2:/.test(v33 || ''), `EN=${en} 3V3=${v33}`);
}
{
  const doc = { boards: [{ id: 'b1', type: 'bb830', x: 0, z: 0, rot: 0 }], parts: [] };
  doc.parts.push(placeOn(doc, 'b1', 'b20', 'mcu-esp32'));
  const res = P.resolvePins(doc, reg);
  const ok = res.pinHole['p1.EN'] === 'b1:b20' && res.pinHole['p1.23'] === 'b1:i20' && res.pinHole['p1.3V3'] === 'b1:i34';
  const cov = res.covered;
  check('ESP32 in rows b and i', ok, `23=${res.pinHole['p1.23']} 3V3=${res.pinHole['p1.3V3']}`);
  check('ESP32 covers rows c..h, leaves a and j free', cov.has('b1:c25') && cov.has('b1:h25') && cov.has('b1:e20') && !cov.has('b1:a25') && !cov.has('b1:j25') && !cov.has('b1:b20'), cov.size + ' holes covered');
}
{
  const doc = { boards: [{ id: 'b1', type: 'bb400', x: 0, z: 0, rot: 0 }], parts: [] };
  doc.parts.push(placeOn(doc, 'b1', 'c4', 'res'));
  doc.parts.push(placeOn(doc, 'b1', 'c8', 'led'));
  const res = P.resolvePins(doc, reg);
  check('pin overlap reported', res.overlaps.length === 1 && res.overlaps[0].hole === 'b1:c8' && res.overlaps[0].pins.length === 2, JSON.stringify(res.overlaps));
  check('free parts plug into nothing', (() => { doc.parts.push({ id: 'p9', def: 'supply-bench', place: { on: null, x: -100, z: 0, rot: 0 } }); return P.resolvePins(doc, reg).pinHole['p9.+'] === null; })());
}
{
  const doc = { boards: [{ id: 'b1', type: 'bb830', x: 0, z: 0, rot: 0 }], parts: [] };
  check('nearestHole snaps within 1.27 mm', P.nearestHole(doc, at(doc, 'b1:c12').x + 1.0, at(doc, 'b1:c12').z) === 'b1:c12' && P.nearestHole(doc, 300, 0) === null);
  const pw = P.partPinsWorld(doc, placeOn(doc, 'b1', 'f10', 'ic-555'), reg.get('ic-555'));
  check('partPinsWorld: y at the board top', pw.every(p => p.y === P.BOARD_H) && pw.length === 8);
}

// ============================================================ BANDS
const bandCase = (v, t, want) => { const b = P.resistorBands(v, t).join(' '); return [b === want, b]; };
for (const [v, t, want] of [[220, 0.05, 'red red brown gold'], [4700, 0.05, 'yellow violet red gold'], [1e6, 0.05, 'brown black green gold'],
  [10, 0.05, 'brown black black gold'], [4.7, 0.05, 'yellow violet gold gold'], [4700, 0.01, 'yellow violet black brown brown'], [1e5, 0.1, 'brown black yellow silver']]) {
  const [ok, b] = bandCase(v, t, want);
  check(`resistorBands(${v}, ${t})`, ok, b);
}
check('snapE E24 / E12', P.snapE(4600) === 4700 && P.snapE(5000, 'E12') === 4700 && P.snapE(1.05e-7, 'E12') === 1e-7, `${P.snapE(4600)} ${P.snapE(5000, 'E12')}`);
check('formatOhms', P.formatOhms(4700) === '4.7k' && P.formatOhms(220) === '220' && P.formatOhms(1e6) === '1M', P.formatOhms(4700));

// ============================================================ MODELS
const mats = P.materialResolver(THREE);
const BIG = new Set(['mcu-uno', 'mcu-nano', 'mcu-esp32', 'inst-dmm', 'inst-scope', 'inst-logic', 'lcd-1602', 'supply-bench', 'funcgen', 'keypad-4x4',
  'batt-18650-shield', 'solar-panel', 'battery-aa4']);
let buildFail = [], budgetFail = [], pinFail = [], callsFail = [], lowFail = [];
let maxSmall = 0, maxBig = 0;
for (const d of defs) {
  for (const quality of ['high', 'low']) {
    let h;
    try {
      h = P.buildPart(THREE, d, { id: 'p1', def: d.id, place: { on: d.mount === 'free' ? null : 'b1', x: 0, z: 0, rot: 0 }, params: {} }, { materials: mats, quality, debug: true });
      h.setState(undefined, 0.016);
      h.setState({ vis: {} }, 0.016);
      h.setState({ vis: { b: 1, on: true, amp: 1, freq: 440, omega: 300, angle: 45, v: 5, a: 0.1, leds: { a: 1, L: 1 }, rows: ['HI', ''] } }, 0.016);
      h.setDamage('burnt'); h.setDamage(null);
      if (h.object.position.lengthSq() !== 0 || h.object.rotation.y !== 0) buildFail.push(d.id + ': state moved the root object');
      const tri = countTriangles(h.object);
      const budget = BIG.has(d.id) ? 25000 : 3000;
      if (quality === 'high') {
        if (tri > budget) budgetFail.push(`${d.id}:${tri}`);
        if (BIG.has(d.id)) maxBig = Math.max(maxBig, tri); else maxSmall = Math.max(maxSmall, tri);
        let calls = 0; h.object.traverse(o => { if (o.isMesh || o.isSprite) calls++; });
        if (calls > (BIG.has(d.id) ? 30 : 22)) callsFail.push(`${d.id}:${calls}`);
        // pin locals within 0.01 mm of the def grid
        for (const p of d.pins) {
          const g = P.pinGrid(d, p, {});
          const hp = h.pins.find(q => q.name === p.name);
          if (!hp || Math.abs(hp.local.x - g.x * G) > 0.01 || Math.abs(hp.local.z - g.z * G) > 0.01) pinFail.push(`${d.id}.${p.name}`);
        }
        if (!h.pickables.length || !h.object.isGroup || typeof h.setLook !== 'function') buildFail.push(d.id + ':handle');
      } else if (tri > (BIG.has(d.id) ? 12500 : 1500) * 1.4) lowFail.push(`${d.id}:${tri}`);
      h.dispose();
    } catch (e) { buildFail.push(`${d.id}/${quality}: ${e.message}`); }
  }
}
check('every built-in builds with three r160 (high and low)', !buildFail.length, buildFail.join('; ') || defs.length + ' defs');
check('triangle budget: small <= 3k, boards and instruments <= 25k', !budgetFail.length, budgetFail.join(' ') || `max small ${maxSmall}, max big ${maxBig}`);
check('low quality stays near half the budget', !lowFail.length, lowFail.join(' ') || 'ok');
check('draw calls per part stay small', !callsFail.length, callsFail.join(' ') || 'ok');
{
  // the view budget: 3 boards + 60 board parts <= 250 draw calls (CONTRACT 4.2)
  const bp = defs.filter(d => d.mount !== 'free' && d.category !== 'instruments' && d.category !== 'mcu');
  let sum = 0;
  for (const d of bp) {
    const h = P.buildPart(THREE, d, { id: 'p1', params: {} }, { materials: mats });
    h.object.traverse(o => { if (o.isMesh) sum++; });
    h.dispose();
  }
  const mean = sum / bp.length;
  const b = P.buildBoard(THREE, { id: 'b1', type: 'bb830', x: 0, z: 0, rot: 0 }, { materials: mats });
  let bm = 0; b.object.traverse(o => { if (o.isMesh) bm++; });
  b.dispose();
  check('60 board parts + 3 boards leave 15 of the 250 draw calls to the view', 60 * mean + 3 * bm <= 235, `${mean.toFixed(2)} per part, ${bm} per board -> ${(60 * mean + 3 * bm).toFixed(0)}`);
}
check('pin locals within 0.01 mm of the def grid', !pinFail.length, pinFail.join(' ') || 'all pins');

// state: LED glow, seg7 digits, LCD text, supply readout, dmm text
{
  const h = P.buildPart(THREE, reg.get('led'), { id: 'p1', params: { color: 'green' } }, { materials: mats, debug: true });
  h.setState({ vis: { b: 1 } }, 0.016);
  const lens = h.slots.lens[0];
  const lit = lens.material.emissiveIntensity, hex = lens.material.emissive.getHexString();
  const shared = mats('led-green');
  h.setDamage('burnt');
  const dark = lens.material.emissiveIntensity;
  check('LED glows from vis.b and goes dark when burnt', lit > 1 && dark === 0 && hex === '3aff4a', `lit ${lit.toFixed(2)} #${hex} burnt ${dark}`);
  check('LED glow never edits the shared preset', shared.emissiveIntensity === 1 && lens.material !== shared);
  h.dispose();
}
{
  const h = P.buildPart(THREE, reg.get('seg7-1'), { id: 'p1' }, { materials: mats, debug: true });
  const disp = h.display;
  h.setState({ vis: { leds: { b: 1, c: 1 } } }, 0.016);
  const lv = Array.from(disp.level).map(v => (v > 0.5 ? 1 : 0)).join('');
  check('seg7-1 lights b and c for vis.leds', lv === '01100000', lv);
  h.dispose();
}
{
  const h = P.buildPart(THREE, reg.get('lcd-1602'), { id: 'p1' }, { materials: mats, debug: true });
  h.setState({ vis: { rows: ['TEMP 23.4 C', 'HELLO'], backlight: 1 } }, 0.016);
  const t = h.lcd.text();
  const M = h.lcd.mesh;
  check('lcd shows vis.rows', t[0].startsWith('TEMP 23.4 C') && t[1].startsWith('HELLO') && M.count === 16 * 2 * 40, JSON.stringify(t));
  h.dispose();
}
{
  const h = P.buildPart(THREE, reg.get('supply-bench'), { id: 'p1', params: { v: 5 } }, { materials: mats, debug: true });
  h.setState({ vis: { v: 4.98, a: 0.0136, cc: false, on: true } }, 0.016);
  const vm = Array.from(h.readouts.v.level).map(v => (v > 0.5 ? 1 : 0));
  check('supply shows V with a decimal point', vm.slice(8, 16).includes(1) && vm[8 + 7] === 1, vm.join(''));
  h.dispose();
}
check('dmmText: 0.0136 A -> 13.60 m', JSON.stringify(dmmText(0.0136, 'A')) === '{"text":"13.60","prefix":"m"}', JSON.stringify(dmmText(0.0136, 'A')));
check('dmmText: 4700 Ω -> 4.700 k', JSON.stringify(dmmText(4700, 'Ω')) === '{"text":"4.700","prefix":"k"}', JSON.stringify(dmmText(4700, 'Ω')));
check('dmmText: 5.002 V', dmmText(5.002, 'V').text === '5.002' && dmmText(-12.5, 'V').text === '-12.5', dmmText(-12.5, 'V').text);
check('segment text encoding', encodeText('5.00', 4)[1] === (SEG_FONT['5'] | 128) && encodeText('5.00', 4)[0] === 0);
check('lcd font: A has 7 rows, degree at 0xDF', glyphRows(65).length === 7 && glyphRows(65)[3] === 0b11111 && glyphRows(0xdf)[0] === 0b01100);
{
  const h = P.buildPart(THREE, reg.get('button-6mm'), { id: 'p1' }, { materials: mats });
  const cap = h.interact.meshes[0], y0 = cap.position.y;
  h.setParams({ pressed: true });
  check('button cap moves down on press; interact names the param', cap.position.y < y0 && h.interact.key === 'pressed' && cap.userData.interact === 'pressed', `${y0.toFixed(2)} -> ${cap.position.y.toFixed(2)}`);
  h.dispose();
}
{
  const h = P.buildPart(THREE, reg.get('res'), { id: 'p1', params: { r: 4700 } }, { materials: mats });
  const before = h.slots.body[0].material;
  h.setDamage('burnt'); const burnt = h.slots.body[0].material;
  h.setDamage(null); const after = h.slots.body[0].material;
  check('resistor bands survive burn and repair', burnt !== before && after === before && !!before.map && h.bands.join(' ') === 'yellow violet red gold', h.bands.join(' '));
  const geoCount = []; h.object.traverse(o => o.geometry && geoCount.push(o.geometry));
  h.dispose();
  check('dispose detaches the object', h.object.children.length === 0 && h.object.parent === null);
}
{
  const h = P.buildPart(THREE, reg.get('inst-dmm'), { id: 'm1', type: 'dmm', settings: { mode: 'V' } }, { materials: mats });
  check('dmm has red and black lead jacks', h.leads && h.leads.red && h.leads.black && h.leads.red.x !== h.leads.black.x);
  h.setState({ kind: 'dmm', value: 0.0136, unit: 'A', overload: false, fuse: 'ok', beep: false }, 0.016);
  h.setSettings({ mode: 'A' });
  h.dispose();
  const s = P.buildPart(THREE, reg.get('inst-scope'), { id: 'm2' }, { materials: mats });
  check('scope has ch1..ch4 and gnd jacks', ['ch1', 'ch2', 'ch3', 'ch4', 'gnd'].every(k => s.leads[k]));
  s.dispose();
}

// ============================================================ MATERIALS
check('>= 20 material presets', P.MATERIAL_PRESETS.length >= 20, P.MATERIAL_PRESETS.length);
const needIds = ['gold-pin', 'tin', 'copper', 'fr4-green', 'pcb-black', 'pcb-blue', 'epoxy-black', 'ceramic-tan', 'glass', 'led-red',
  'led-white', 'abs-white', 'abs-black', 'chrome', 'rubber', 'resistor-beige', 'resistor-blue', 'mat-teal'];
check('contract preset ids present', needIds.every(id => P.presetById(id)), needIds.filter(id => !P.presetById(id)).join() || needIds.length);
const matErr = P.MATERIAL_PRESETS.flatMap(m => P.validateMaterial(m));
check('every preset validates', !matErr.length, matErr.join(';'));
check('preset ids unique', new Set(P.MATERIAL_PRESETS.map(m => m.id)).size === P.MATERIAL_PRESETS.length);
check('validateMaterial catches bad specs', P.validateMaterial({ id: 'x', name: 'x', color: 'red', roughness: 2, metalness: 0, pattern: 'zig' }).length === 3);
const slotIds = defs.flatMap(d => d.slots.map(s => s.default));
check('every slot default is a preset', slotIds.every(id => P.presetById(id)), slotIds.filter(id => !P.presetById(id)).join() || slotIds.length + ' slots');
let builds = true;
for (const m of P.MATERIAL_PRESETS) { const mm = P.makeMaterial(THREE, m); if (!mm.isMeshPhysicalMaterial) builds = false; }
check('every preset builds a MeshPhysicalMaterial', builds);
const a1 = P.makeMaterial(THREE, P.presetById('fr4-green')), a2 = P.makeMaterial(THREE, { ...P.presetById('fr4-green'), id: 'mat-copy', name: 'copy' });
const a3 = P.makeMaterial(THREE, { ...P.presetById('fr4-green'), roughness: 0.9 });
check('makeMaterial caches by look', a1 === a2 && a1 !== a3 && !!a1.normalMap);
check('glass is transmissive, LED epoxy has clearcoat', P.makeMaterial(THREE, P.presetById('glass')).transmission > 0.9 && P.makeMaterial(THREE, P.presetById('led-red')).clearcoat === 1);
let patOk = true;
for (const pat of ['brushed', 'knurl', 'pcb', 'grain', 'bumps']) {
  const b = patternBytes(pat, 32);
  for (let i = 0; i < b.length; i += 4) {
    const x = b[i] / 127.5 - 1, y = b[i + 1] / 127.5 - 1, z = b[i + 2] / 127.5 - 1;
    if (Math.abs(Math.hypot(x, y, z) - 1) > 0.03 || z <= 0) { patOk = false; break; }
  }
}
check('pattern normal maps are unit normals facing out', patOk);

// ============================================================ WIRES
const A = [0, 8.5, 0], Bp = [40, 8.5, 10];
for (const style of ['arch', 'flat', 'free']) {
  const p = P.wirePath(A, Bp, style, [[20, 30, 5]]);
  check(`wirePath ${style} ends exactly at both points`, p[0].join() === A.join() && p[p.length - 1].join() === Bp.join(), p.length + ' points');
}
{
  const len = Math.hypot(40, 10);
  const p = P.wirePath(A, Bp, 'arch');
  const top = Math.max(...p.map(q => q[1]));
  const want = 8.5 + Math.min(25, 3 + 0.25 * len);
  check('arch height = min(25, 3 + 0.25 len) above the higher end', near(top, want, 1e-9), `${top.toFixed(4)} vs ${want.toFixed(4)}`);
  check('arch rises 3 mm straight up from each hole', p[1][0] === 0 && p[1][2] === 0 && near(p[1][1], 11.5) && near(p[p.length - 2][1], 11.5));
  const long = P.wirePath([0, 8.5, 0], [200, 8.5, 0], 'arch');
  check('arch height caps at 25 mm', near(Math.max(...long.map(q => q[1])), 33.5));
  const uneven = P.wirePath([0, 8.5, 0], [30, 20, 0], 'arch');
  check('arch top over uneven ends', near(Math.max(...uneven.map(q => q[1])), 20 + 3 + 0.25 * 30), Math.max(...uneven.map(q => q[1])).toFixed(3));
  const f = P.wirePath(A, Bp, 'flat');
  const bends = f.slice(1, -1).filter(q => q[1] > 9).length;
  check('flat: 0.8 mm above the board, one bend', f.every((q, i) => i === 0 || i === f.length - 1 || near(q[1], 9.3)) && bends === 3, JSON.stringify(f));
  const fr = P.wirePath(A, Bp, 'free', [[10, 20, 0], [30, 25, 10]]);
  check('free passes through the bend points', fr.length === 6 && fr[2][1] === 20 && fr[3][1] === 25);
  const w = P.buildWire(THREE, { points: p, color: '#2f80d6', gauge: 22 });
  const tri = countTriangles(w.object);
  w.setPoints(f);
  const tri2 = countTriangles(w.object);
  w.setColor('#d63b3b');
  check('buildWire builds, re-points and recolours', tri > 100 && tri2 > 20 && w.insulation.material.color.getHexString() === 'd63b3b', `${tri} -> ${tri2} triangles`);
  const box = new THREE.Box3().setFromObject(w.tips);
  check('wire tips go down into the hole', box.min.y < 8.5 - 2, box.min.y.toFixed(2));
  w.dispose();
}

// ============================================================ BOARDS
for (const type of Object.keys(P.BOARD_TYPES)) {
  const b = P.buildBoard(THREE, { id: 'b1', type, x: 10, z: 5, rot: 1 }, { materials: mats });
  const m = new THREE.Matrix4(), v = new THREE.Vector3();
  const i = b.holeIds.indexOf('f3');
  b.holes.getMatrixAt(i, m); v.setFromMatrixPosition(m);
  const l = P.holeLocal(type, 'f3');
  b.object.updateMatrixWorld();
  const wv = v.clone().applyMatrix4(b.object.matrixWorld);
  const w = P.boardToWorld({ id: 'b1', type, x: 10, z: 5, rot: 1 }, l.x, l.z);
  check(`buildBoard ${type}: ${b.holes.count} holes, f3 at holeLocal and world`, b.holes.count === P.holeList(type).length && near(v.x, l.x, 1e-4) && near(v.z, l.z, 1e-4) && near(wv.x, w.x, 1e-4) && near(wv.z, w.z, 1e-4),
    `${countTriangles(b.object)} triangles`);
  b.setHoleColors({ f3: '#ff7a1a' });
  b.clearHoleColors();
  b.dispose();
}

// ============================================================ CUSTOM DEFS
// a custom part on a board, with its def only in doc.customParts (a share
// link, the autosave, a file): its pins resolve to holes
{
  const reg = P.createRegistry();
  const cr = { id: 'cp-r', name: 'My R', category: 'custom', mount: 'board', desc: '', params: [],
    pins: [{ name: '1', x: 0, z: 0 }, { name: '2', x: 4, z: 0 }],
    electrical: [{ id: 'main', type: 'resistor', nodes: { a: '1', b: '2' }, params: { r: 1000 } }], slots: [], model: { template: 'box', w: 10, d: 3, h: 3 } };
  const h = P.holeLocal('bb400', 'a10');
  const doc = { boards: [{ id: 'b1', type: 'bb400', x: 0, z: 0, rot: 0 }], customParts: [cr], wires: [], parts: [{ id: 'p1', def: 'cp-r', place: { on: 'b1', x: h.x, z: h.z, rot: 0 }, params: {} }] };
  const r = P.resolvePins(doc, reg);
  check('resolvePins finds a custom def in doc.customParts (not in the registry)', r.pinHole['p1.1'] === 'b1:a10' && r.pinHole['p1.2'] === 'b1:a14', JSON.stringify(r.pinHole));
}

// ============================================================ HYGIENE
function walk(dir) {
  return readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
const files = walk(HERE).filter(f => f.endsWith('.js'));
const noMap = files.filter(f => !readFileSync(f, 'utf8').slice(0, 4000).includes('GREP MAP'));
check('every module has a GREP MAP header', !noMap.length, noMap.join(' ') || files.length + ' modules');
const banned = /Playfair|Cormorant|JetBrains|Arduino|Espressif|\bwindow\.|document\.body/;
const hits = files.filter(f => banned.test(readFileSync(f, 'utf8')));
check('no banned fonts, trademark names or window access', !hits.length, hits.join(' ') || 'clean');
const leaks = files.filter(f => /^import .* from 'three'/m.test(readFileSync(f, 'utf8')));
check('no bare three import (THREE is always injected)', !leaks.length, leaks.join(' ') || 'clean');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
