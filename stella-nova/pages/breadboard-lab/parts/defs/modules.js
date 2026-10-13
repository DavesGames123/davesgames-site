// ============================================================================
//  BREADBOARD LAB  ·  parts/defs/modules.js — old-inventory modules, instruments
// ----------------------------------------------------------------------------
//  The modules come from the old bench's inventory (breadboard-designer-3).
//  Their pin names and pin order are the old ones, so the legacy import maps
//  pin indexes one to one. They are NOT SIMULATED: each is a supply load
//  between its power pins and 1 MΩ from every other pin to GND, so nothing
//  floats. `notSimulated: true` tells the inspector and the checks.
//
//  INSTRUMENTS are 3D models only: the probes of the document use them. They
//  have no pins; `leads` names the jacks the view hangs probe leads on.
//
//  GREP MAP
//    moduleDef .............. one module: pins, load, 1 MΩ inputs, look
//    mod-gps / mod-tft154 / mod-rfid ... board modules (pins in a row)
//    mod-nrf24 / mod-radar / mod-fm / mod-charger ... free modules (sockets)
//    inst-dmm / inst-scope / inst-logic ... instruments
//    LEGACY_MAP ............. old bench def id -> new def id (+ params)
// ============================================================================
import { slot, el, row } from './util.js';

function moduleDef(o) {
  const free = o.mount === 'free';
  const pins = o.pins.map((p, i) => typeof p === 'string'
    ? { name: p, x: i, z: 0, ...(free ? { y: 10, socket: true } : {}) }
    : { ...p, ...(free ? { y: 10, socket: true } : {}) });
  const names = pins.map(p => p.name);
  const electrical = [];
  if (o.load) electrical.push(el('load', 'resistor', { a: o.vcc, b: o.gnd }, { r: o.load }));
  for (const n of names) if (n !== o.vcc && n !== o.gnd && !(o.skip || []).includes(n)) {
    electrical.push(el('in_' + n.replace(/[^A-Za-z0-9]/g, '_'), 'resistor', { a: n, b: o.gnd }, { r: 1e6 }));
  }
  electrical.push(...(o.extra || []));
  return {
    id: o.id, name: o.name, category: 'modules', tags: ['module', ...(o.tags || [])], desc: o.desc,
    mount: o.mount || 'board', pins, params: [], electrical, notSimulated: true,
    footprint: o.footprint,
    slots: [slot('pcb', 'Board', o.pcb || 'pcb-blue'), slot('body', 'Parts', 'epoxy-black'), slot('top', 'Top', o.topMat || 'ceramic-tan'), slot('legs', 'Pins', 'gold-pin'), slot('label', 'Silkscreen', 'silk-white')],
    model: { template: 'module', bodyW: o.w, bodyD: o.d, top: o.top || 'chip', label: o.label, header: o.header || 'row' },
    visual: 'none',
  };
}

export const MODULE_DEFS = [
  moduleDef({ id: 'mod-gps', name: 'GPS receiver module', label: 'GPS', tags: ['gps'], pins: ['VCC', 'RX', 'TX', 'GND', 'PPS'],
    vcc: 'VCC', gnd: 'GND', load: 110, w: 25, d: 35, top: 'lens', topMat: 'ceramic-tan', pcb: 'pcb-blue',
    footprint: { x0: -3, x1: 7, z0: -14, z1: -0.5 },
    desc: 'A serial GPS receiver with a patch antenna (from the old bench). Not simulated: a 30 mA load and 1 MΩ inputs.' }),
  moduleDef({ id: 'mod-tft154', name: '1.54 inch colour TFT', label: 'TFT', tags: ['display', 'spi'], pins: ['GND', 'VCC', 'SCL', 'SDA', 'RES', 'DC', 'CS', 'BLK'],
    vcc: 'VCC', gnd: 'GND', load: 110, w: 31, d: 38, top: 'screen', topMat: 'screen-dark', pcb: 'pcb-red',
    footprint: { x0: -5, x1: 12, z0: -15, z1: -0.5 },
    desc: 'A small SPI colour screen (from the old bench). Not simulated: a 30 mA load and 1 MΩ inputs.' }),
  moduleDef({ id: 'mod-rfid', name: 'RFID reader module', label: 'RFID', tags: ['rfid', 'spi'], pins: ['SDA', 'SCK', 'MOSI', 'MISO', 'IRQ', 'GND', 'RST', '3V3'],
    vcc: '3V3', gnd: 'GND', load: 250, w: 40, d: 60, top: 'coil', topMat: 'copper', pcb: 'pcb-blue',
    footprint: { x0: -5, x1: 12, z0: -23, z1: -0.5 },
    desc: 'A 13.56 MHz card reader on SPI (from the old bench). 3.3 V only. Not simulated: a 13 mA load and 1 MΩ inputs.' }),
  moduleDef({ id: 'mod-nrf24', name: '2.4 GHz radio (PA+LNA)', label: 'RADIO', tags: ['radio', 'spi'], mount: 'free',
    pins: [{ name: 'GND', x: 0, z: 0 }, { name: 'VCC', x: 0, z: -1 }, { name: 'CE', x: 1, z: 0 }, { name: 'CSN', x: 1, z: -1 },
      { name: 'SCK', x: 2, z: 0 }, { name: 'MOSI', x: 2, z: -1 }, { name: 'MISO', x: 3, z: 0 }, { name: 'IRQ', x: 3, z: -1 }],
    vcc: 'VCC', gnd: 'GND', load: 220, w: 16, d: 41, top: 'antenna', topMat: 'chrome', pcb: 'pcb-black', header: 'grid',
    desc: 'A long-range 2.4 GHz radio on SPI (from the old bench). Wants a clean 3.3 V and a 100 µF capacitor at VCC. Not simulated.' }),
  moduleDef({ id: 'mod-radar', name: 'Presence radar module', label: 'RADAR', tags: ['radar', 'presence'], mount: 'free',
    pins: ['3V3', 'GND', 'OT1', 'RX'], vcc: '3V3', gnd: 'GND', load: 66, w: 20, d: 20, top: 'chip', pcb: 'pcb-purple',
    desc: 'A 24 GHz human presence sensor (from the old bench). Its header has a 1.27 mm pitch: it needs an adapter. Not simulated.' }),
  moduleDef({ id: 'mod-fm', name: 'FM radio module', label: 'FM', tags: ['radio', 'i2c'], mount: 'free',
    pins: ['SDA', 'SCL', '3V3', 'GND', 'ANT'], vcc: '3V3', gnd: 'GND', load: 300, w: 22, d: 20, top: 'chip', pcb: 'pcb-blue',
    desc: 'An I2C FM receiver (from the old bench). Not simulated.' }),
  moduleDef({ id: 'mod-charger', name: 'Li-ion charger board', label: 'CHG', tags: ['charger', 'li-ion'], mount: 'free',
    pins: ['OUT+', 'OUT−', 'B+', 'B−'], vcc: 'OUT+', gnd: 'OUT−', w: 26, d: 17, top: 'chip', pcb: 'pcb-blue', skip: ['B+', 'B−'],
    extra: [el('jp', 'wire', { a: 'B+', b: 'OUT+' }, { r: 0.05 }), el('jn', 'wire', { a: 'B−', b: 'OUT−' }, { r: 0.05 })],
    desc: 'A single-cell charger with protection (from the old bench). Only its pass-through from B to OUT is modelled.' }),
  {
    id: 'inst-dmm', name: 'Multimeter', category: 'instruments', tags: ['meter', 'dmm'],
    desc: 'A digital multimeter: DC volts, DC amps (in series, fused), ohms and continuity.',
    mount: 'free', pins: [], params: [], electrical: [], leads: ['red', 'black'],
    slots: [slot('body', 'Boot', 'rubber-yellow'), slot('face', 'Face', 'abs-dark'), slot('knob', 'Dial', 'abs-black'), slot('screen', 'Display', 'lcd-green'), slot('metal', 'Jacks', 'brass')],
    model: { template: 'dmm' }, visual: 'meter',
  },
  {
    id: 'inst-scope', name: 'Oscilloscope', category: 'instruments', tags: ['scope'],
    desc: 'A 4-channel scope. The trace shows on its screen and in the SCOPE panel.',
    mount: 'free', pins: [], params: [], electrical: [], leads: ['ch1', 'ch2', 'ch3', 'ch4', 'gnd'],
    slots: [slot('body', 'Case', 'abs-dark'), slot('face', 'Face', 'abs-grey'), slot('knob', 'Knobs', 'abs-black'), slot('screen', 'Screen', 'screen-dark'), slot('metal', 'Jacks', 'chrome')],
    model: { template: 'scope' }, visual: 'meter',
  },
  {
    id: 'inst-logic', name: 'Logic analyzer', category: 'instruments', tags: ['logic', 'analyzer'],
    desc: 'An 8-channel logic analyzer pod. Its timing view shows in the LOGIC panel.',
    mount: 'free', pins: [], params: [], electrical: [], leads: ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'gnd'],
    slots: [slot('body', 'Case', 'aluminium'), slot('face', 'Label', 'abs-black'), slot('metal', 'Header', 'gold-pin'), slot('screen', 'Status', 'screen-dark')],
    model: { template: 'logic' }, visual: 'meter',
  },
];

// The old bench (breadboard-designer-3) def ids -> new def ids (CONTRACT 3.10).
export const LEGACY_MAP = {
  esp32: { def: 'mcu-esp32' }, esp32e: { def: 'mcu-esp32' }, esp32sp: { def: 'mcu-esp32' },
  gps: { def: 'mod-gps' }, tft: { def: 'mod-tft154' }, keypad: { def: 'keypad-4x4' }, lcd: { def: 'lcd-1602' },
  rc522: { def: 'mod-rfid' }, joy: { def: 'joystick' }, seg7: { def: 'seg7-4' },
  btnr: { def: 'button-12mm', params: { cap: 'red' } }, btnb: { def: 'button-12mm', params: { cap: 'blue' } },
  btnm: { def: 'button-6mm' }, nrf: { def: 'mod-nrf24' }, radar: { def: 'mod-radar' }, fm: { def: 'mod-fm' },
  vshield: { def: 'batt-18650-shield' }, tp: { def: 'mod-charger' }, spk: { def: 'speaker-8r' }, solar: { def: 'solar-panel' },
};
