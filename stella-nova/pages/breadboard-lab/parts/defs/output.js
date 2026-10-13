// ============================================================================
//  BREADBOARD LAB  ·  parts/defs/output.js — things that light, move or sound
// ----------------------------------------------------------------------------
//  Buzzers, speaker, DC motor, servo, relay, 7-segment displays, the 16 x 2
//  character LCD and a 6 V lamp.
//
//  7-SEGMENT WIRING READS A PARAM. One led element per segment; the `when`
//  field picks the common cathode or the common anode version, so one def
//  serves both (parts/schema.js expandElectrical).
//
//  GREP MAP
//    buzzer-active / buzzer-passive / speaker-8r
//    motor-dc / servo / relay-5v / lamp-6v
//    seg7-1 / seg7-4 ........ displays (vis ids a..g, dp and d1a..d4dp)
//    lcd-1602 ............... hd44780 + backlight LED behind 100 Ω
// ============================================================================
import { num, en, slot, el, row } from './util.js';

const MINUS = '−';
const SEGS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
const SEG_COLORS = ['red', 'green', 'blue', 'yellow', 'white', 'orange'];

function segLeds(prefix, seg, com, color = '$color') {
  return [
    el(prefix + seg, 'led', { a: seg, k: com }, { color }, { vis: prefix + seg, when: { common: 'cathode' } }),
    el(prefix + seg + '_ca', 'led', { a: com, k: seg }, { color }, { vis: prefix + seg, when: { common: 'anode' } }),
  ];
}

export const OUTPUT_DEFS = [
  {
    id: 'buzzer-active', name: 'Active buzzer', category: 'output', tags: ['buzzer', 'sound'],
    desc: 'A buzzer with its own oscillator: give it DC (above about 2.5 V) and it beeps at its fixed pitch. Long leg +.',
    mount: 'board',
    pins: [{ name: '+', x: 0, z: 0 }, { name: MINUS, x: 3, z: 0 }], params: [],
    electrical: [el('main', 'buzzer', { a: '+', b: MINUS }, { active: true, r: 160, vmin: 2.5, freq: 2300 })],
    footprint: { x0: -1, x1: 4, z0: -2, z1: 2 },
    slots: [slot('body', 'Body', 'abs-black'), slot('label', 'Seal', 'abs-white'), slot('legs', 'Legs', 'tin')],
    model: { template: 'buzzer', active: true }, visual: 'buzzer',
  },
  {
    id: 'buzzer-passive', name: 'Passive buzzer', category: 'output', tags: ['buzzer', 'sound', 'tone'],
    desc: 'A small magnetic sounder with no oscillator: it sounds at the frequency you drive it with (tone(), a 555).',
    mount: 'board',
    pins: [{ name: '+', x: 0, z: 0 }, { name: MINUS, x: 3, z: 0 }], params: [],
    electrical: [el('main', 'buzzer', { a: '+', b: MINUS }, { active: false, r: 40 })],
    footprint: { x0: -1, x1: 4, z0: -2, z1: 2 },
    slots: [slot('body', 'Body', 'abs-black'), slot('label', 'Board', 'fr4-green'), slot('legs', 'Legs', 'tin')],
    model: { template: 'buzzer', active: false }, visual: 'buzzer',
  },
  {
    id: 'speaker-8r', name: 'Speaker 8 Ω', category: 'output', tags: ['speaker', 'sound'],
    desc: 'A small 8 Ω speaker on the mat. Drive it through a resistor or a transistor, never straight from a pin.',
    mount: 'free',
    pins: [{ name: '+', x: 0, z: 0, y: 5, socket: true }, { name: MINUS, x: 2, z: 0, y: 5, socket: true }], params: [],
    electrical: [el('main', 'speaker', { a: '+', b: MINUS }, { r: 8 })],
    slots: [slot('body', 'Frame', 'abs-black'), slot('cone', 'Cone', 'pcb-black'), slot('metal', 'Terminals', 'tin')],
    model: { template: 'speaker' }, visual: 'speaker',
  },
  {
    id: 'motor-dc', name: 'DC motor', category: 'output', tags: ['motor', 'spin'],
    desc: 'A small brushed DC motor. Its back EMF rises with speed, so it draws a big current at start and less when it spins. Put a diode across it when a transistor switches it.',
    mount: 'free',
    pins: [{ name: 'A', x: 0, z: 0, y: 17, socket: true }, { name: 'B', x: 0, z: 3, y: 17, socket: true }],
    params: [
      num('r', 'Winding resistance', 'Ω', 5, 0.5, 100),
      num('ke', 'Back EMF constant', 'V·s/rad', 0.005, 0.0005, 0.1, { scale: 'log' }),
      num('load', 'Load torque', 'N·m', 0, 0, 0.01, { step: 0.0001, live: true }),
    ],
    electrical: [el('main', 'motor', { a: 'A', b: 'B' }, { r: '$r', l: 0.001, ke: '$ke', j: 2e-6, bfric: 2e-7, load: '$load' })],
    slots: [slot('body', 'Can', 'chrome'), slot('cap', 'End cap', 'abs-white'), slot('shaft', 'Shaft', 'chrome'), slot('wheel', 'Wheel', 'abs-yellow'), slot('metal', 'Tabs', 'copper')],
    model: { template: 'motor' }, visual: 'motor',
  },
  {
    id: 'servo', name: 'Hobby servo', category: 'output', tags: ['servo', 'pwm'],
    desc: 'A small servo. A 50 Hz pulse of 0.5 to 2.5 ms on SIG sets the horn from 0° to 180°. Brown GND, red VCC, orange SIG.',
    mount: 'free',
    pins: [{ name: 'SIG', x: 0, z: 0, y: 2.5, socket: true }, { name: 'VCC', x: 1, z: 0, y: 2.5, socket: true }, { name: 'GND', x: 2, z: 0, y: 2.5, socket: true }],
    params: [],
    electrical: [el('main', 'servo', { sig: 'SIG', vcc: 'VCC', gnd: 'GND' })],
    slots: [slot('body', 'Case', 'abs-blue'), slot('horn', 'Horn', 'abs-white'), slot('cable', 'Cable', 'abs-black'), slot('metal', 'Pins', 'tin')],
    model: { template: 'servo' }, visual: 'servo',
  },
  {
    id: 'relay-5v', name: '5 V relay', category: 'output', tags: ['relay', 'switch', 'coil'],
    desc: 'A relay with a 70 Ω 5 V coil. It pulls in at about 3.75 V and drops out below 1.5 V; COM moves from NC to NO. Put a diode across the coil.',
    mount: 'board',
    pins: [{ name: 'C1', x: 0, z: 0 }, { name: 'C2', x: 0, z: -4 }, { name: 'COM', x: 2, z: 0 }, { name: 'NO', x: 6, z: 0 }, { name: 'NC', x: 6, z: -4 }],
    params: [],
    electrical: [el('main', 'relay', { c1: 'C1', c2: 'C2', com: 'COM', no: 'NO', nc: 'NC' }, { coilR: 70, vpick: 3.75, vdrop: 1.5, tmove: 0.005 })],
    footprint: { x0: -1, x1: 7, z0: -5, z1: 1 },
    slots: [slot('body', 'Case', 'abs-blue'), slot('label', 'Label', 'silk-white'), slot('legs', 'Pins', 'tin')],
    model: { template: 'relay' }, visual: 'relay',
  },
  {
    id: 'seg7-1', name: '7-segment digit', category: 'output', tags: ['display', '7-segment'],
    desc: 'One 0.56 inch digit: eight LEDs (a..g and the point) with a shared pin. Each segment needs its own resistor.',
    mount: 'board',
    pins: [
      { name: 'e', x: 0, z: 0 }, { name: 'd', x: 1, z: 0 }, { name: 'COM1', x: 2, z: 0 }, { name: 'c', x: 3, z: 0 }, { name: 'dp', x: 4, z: 0 },
      { name: 'b', x: 4, z: -6 }, { name: 'a', x: 3, z: -6 }, { name: 'COM2', x: 2, z: -6 }, { name: 'f', x: 1, z: -6 }, { name: 'g', x: 0, z: -6 },
    ],
    params: [en('common', 'Common pin', 'cathode', ['cathode', 'anode']), en('color', 'Colour', 'red', SEG_COLORS)],
    electrical: [
      ...SEGS.flatMap(s => segLeds('', s, 'COM1')),
      el('com', 'wire', { a: 'COM1', b: 'COM2' }, { r: 0.01 }),
    ],
    footprint: { x0: -0.5, x1: 4.5, z0: -6, z1: 0 },
    slots: [slot('body', 'Body', 'abs-black'), slot('face', 'Face', 'epoxy-black'), slot('legs', 'Pins', 'tin')],
    model: { template: 'seg7', digits: 1 }, visual: 'seg7',
  },
  {
    id: 'seg7-4', name: '4-digit 7-segment', category: 'output', tags: ['display', '7-segment', 'multiplex'],
    desc: 'Four digits that share the segment pins a..g, dp. Each digit has its own common pin D1..D4: light one digit at a time, fast (multiplexing).',
    mount: 'board',
    pins: [
      ...row(['e', 'd', 'dp', 'c', 'g', 'D4'], 0),
      { name: 'b', x: 5, z: -4 }, { name: 'D3', x: 4, z: -4 }, { name: 'D2', x: 3, z: -4 }, { name: 'f', x: 2, z: -4 }, { name: 'a', x: 1, z: -4 }, { name: 'D1', x: 0, z: -4 },
    ],
    params: [en('common', 'Common pins', 'cathode', ['cathode', 'anode']), en('color', 'Colour', 'red', SEG_COLORS)],
    electrical: [1, 2, 3, 4].flatMap(d => SEGS.flatMap(s => segLeds('d' + d, s, 'D' + d))),
    footprint: { x0: -0.5, x1: 5.5, z0: -4, z1: 0 },
    slots: [slot('body', 'Body', 'abs-black'), slot('face', 'Face', 'epoxy-black'), slot('legs', 'Pins', 'tin')],
    model: { template: 'seg7-4', digits: 4 }, visual: 'seg7',
  },
  {
    id: 'lcd-1602', name: '16 × 2 character LCD', category: 'output', tags: ['lcd', 'display', 'hd44780'],
    desc: 'A character LCD with the common controller: 16 columns, 2 rows, 4-bit or 8-bit bus. V0 sets the contrast (about 0.5 V); A and K feed the backlight through a 100 Ω resistor on the board.',
    mount: 'board',
    pins: row(['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K'], 0),
    params: [en('screen', 'Screen', 'green', ['green', 'blue'])],
    electrical: [
      el('main', 'hd44780', { vss: 'VSS', vdd: 'VDD', v0: 'V0', rs: 'RS', rw: 'RW', e: 'E', d0: 'D0', d1: 'D1', d2: 'D2', d3: 'D3', d4: 'D4', d5: 'D5', d6: 'D6', d7: 'D7' }, { cols: 16, rows: 2 }),
      el('rbl', 'resistor', { a: 'A', b: '#bl' }, { r: 100 }),
      el('bl', 'led', { a: '#bl', k: 'K' }, { color: 'green' }, { vis: 'bl' }),
    ],
    footprint: { x0: -3.2, x1: 28.3, z0: -14.2, z1: -0.5 },
    slots: [slot('pcb', 'Board', 'fr4-green'), slot('body', 'Bezel', 'abs-black'), slot('screen', 'Glass', 'lcd-green'), slot('legs', 'Pins', 'gold-pin')],
    model: { template: 'lcd' }, visual: 'lcd',
  },
  {
    id: 'lamp-6v', name: '6 V lamp', category: 'output', tags: ['lamp', 'bulb', 'incandescent'],
    desc: 'A 6 V 100 mA bulb in a holder. Its filament is ten times lower in resistance when cold, so it takes a surge at switch-on.',
    mount: 'free',
    pins: [{ name: '1', x: 0, z: 0, y: 7, socket: true }, { name: '2', x: 3, z: 0, y: 7, socket: true }], params: [],
    electrical: [el('main', 'lamp', { a: '1', b: '2' }, { vnom: 6, pnom: 0.6, ratio: 10 })],
    slots: [slot('body', 'Base', 'abs-black'), slot('glass', 'Bulb', 'glass'), slot('metal', 'Screw', 'brass')],
    model: { template: 'lamp' }, visual: 'lamp',
  },
];
