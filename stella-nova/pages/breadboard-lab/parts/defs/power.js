// ============================================================================
//  BREADBOARD LAB  ·  parts/defs/power.js — sources
// ----------------------------------------------------------------------------
//  Bench supply, batteries, the coin cell, USB, the function generator, the
//  solar panel and the 18650 shield. Free parts sit on the mat; their pins
//  are sockets (socket: true) at a height y (mm) that a wire end plugs into.
//
//  Pin names use the minus sign U+2212 ('−') as CONTRACT 3.5 writes them.
//
//  GREP MAP
//    supply-bench ........... CV/CC supply, binding posts + and −
//    battery-9v / battery-aa2 / battery-aa4 ... cells with snap leads
//    coin-cr2032 / usb-breakout ... board-mounted sources
//    funcgen ................ sine / square / triangle / dc into 50 Ω
//    solar-panel / batt-18650-shield
// ============================================================================
import { num, en, bool, slot, el } from './util.js';

const MINUS = '−';

export const POWER_DEFS = [
  {
    id: 'supply-bench', name: 'Bench supply', category: 'power', tags: ['supply', 'cv', 'cc'],
    desc: 'A lab supply with a voltage set point and a current limit. When the load asks for more than the limit, the supply drops its voltage to hold the current (CC mode) and the CC lamp lights.',
    mount: 'free',
    pins: [{ name: '+', label: '+ (red post)', x: 0, z: 0, y: 16, socket: true }, { name: MINUS, label: '− (black post)', x: 4, z: 0, y: 16, socket: true }],
    params: [
      num('v', 'Voltage', 'V', 5, 0, 30, { step: 0.01, live: true }),
      num('ilim', 'Current limit', 'A', 0.5, 0.001, 3, { step: 0.001, scale: 'log', live: true }),
      bool('on', 'Output on', true, { live: true }),
    ],
    electrical: [el('main', 'supply', { p: '+', n: MINUS }, { v: '$v', ilim: '$ilim', on: '$on' })],
    interact: { kind: 'toggle', key: 'on' },
    slots: [slot('body', 'Case', 'abs-dark'), slot('face', 'Front panel', 'abs-black'), slot('knob', 'Knobs', 'abs-grey'), slot('metal', 'Posts', 'brass')],
    model: { template: 'bench-supply' }, visual: 'supply',
  },
  {
    id: 'battery-9v', name: '9 V battery', category: 'power', tags: ['battery', 'pp3'],
    desc: 'A 9 V alkaline cell with a snap clip. Its leads end in pins you plug a wire into. Internal resistance about 1.7 Ω, so a short drops it hard.',
    mount: 'free',
    pins: [{ name: '+', label: '+ (red lead)', x: 0, z: 0, y: 1.2, socket: true }, { name: MINUS, label: '− (black lead)', x: 2, z: 0, y: 1.2, socket: true }],
    params: [
      num('v', 'Fresh EMF', 'V', 9, 6, 9.6, { step: 0.1 }),
      num('soc', 'Charge left', '', 1, 0, 1, { step: 0.01, live: true }),
      num('mah', 'Capacity', 'mAh', 550, 50, 1200),
    ],
    electrical: [el('main', 'battery', { p: '+', n: MINUS }, { v: '$v', rint: 1.7, mah: '$mah', soc: '$soc' })],
    slots: [slot('body', 'Wrapper', 'abs-black'), slot('band', 'Band', 'abs-yellow'), slot('metal', 'Snap', 'chrome'), slot('leads', 'Leads', 'abs-red')],
    model: { template: 'battery-9v' }, visual: 'none',
  },
  {
    id: 'battery-aa2', name: '2 × AA pack', category: 'power', tags: ['battery', 'aa'],
    desc: 'Two AA cells in series in a holder: 3 V, about 0.3 Ω inside.',
    mount: 'free',
    pins: [{ name: '+', x: 0, z: 0, y: 1.2, socket: true }, { name: MINUS, x: 2, z: 0, y: 1.2, socket: true }],
    params: [num('soc', 'Charge left', '', 1, 0, 1, { step: 0.01, live: true }), num('mah', 'Capacity', 'mAh', 2400, 100, 3500)],
    electrical: [el('main', 'battery', { p: '+', n: MINUS }, { v: 3.0, rint: 0.3, mah: '$mah', soc: '$soc' })],
    slots: [slot('body', 'Holder', 'abs-black'), slot('cell', 'Cells', 'abs-green'), slot('metal', 'Contacts', 'chrome'), slot('leads', 'Leads', 'abs-red')],
    model: { template: 'battery-pack', cells: 2 }, visual: 'none',
  },
  {
    id: 'battery-aa4', name: '4 × AA pack', category: 'power', tags: ['battery', 'aa'],
    desc: 'Four AA cells in series in a holder: 6 V, about 0.6 Ω inside.',
    mount: 'free',
    pins: [{ name: '+', x: 0, z: 0, y: 1.2, socket: true }, { name: MINUS, x: 2, z: 0, y: 1.2, socket: true }],
    params: [num('soc', 'Charge left', '', 1, 0, 1, { step: 0.01, live: true }), num('mah', 'Capacity', 'mAh', 2400, 100, 3500)],
    electrical: [el('main', 'battery', { p: '+', n: MINUS }, { v: 6.0, rint: 0.6, mah: '$mah', soc: '$soc' })],
    slots: [slot('body', 'Holder', 'abs-black'), slot('cell', 'Cells', 'abs-blue'), slot('metal', 'Contacts', 'chrome'), slot('leads', 'Leads', 'abs-red')],
    model: { template: 'battery-pack', cells: 4 }, visual: 'none',
  },
  {
    id: 'coin-cr2032', name: 'CR2032 coin cell', category: 'power', tags: ['battery', 'coin'],
    desc: 'A 3 V lithium coin cell in a holder that plugs into the board. About 15 Ω inside: it lights an LED, it cannot drive a motor.',
    mount: 'board',
    pins: [{ name: '+', x: 0, z: 0 }, { name: MINUS, x: 8, z: 0 }],
    params: [num('soc', 'Charge left', '', 1, 0, 1, { step: 0.01, live: true })],
    electrical: [el('main', 'battery', { p: '+', n: MINUS }, { v: 3.0, rint: 15, mah: 220, soc: '$soc' })],
    footprint: { x0: 0, x1: 8, z0: -3.5, z1: 3.5 },
    slots: [slot('body', 'Holder', 'abs-black'), slot('cell', 'Cell', 'chrome'), slot('legs', 'Pins', 'tin')],
    model: { template: 'coin-cell' }, visual: 'none',
  },
  {
    id: 'usb-breakout', name: 'USB 5 V breakout', category: 'power', tags: ['usb', 'supply'],
    desc: 'A USB socket on a small board: 5 V through a 500 mA polyfuse that trips on overload and resets when it cools.',
    mount: 'board',
    pins: [{ name: 'VBUS', x: 0, z: 0 }, { name: 'GND', x: 4, z: 0 }],
    params: [bool('usb', 'Cable plugged in', true, { live: true })],
    electrical: [el('main', 'usbpower', { p: 'VBUS', n: 'GND' }, { v: 5, rint: 0.2, trip: 0.5, usb: '$usb' })],
    interact: { kind: 'toggle', key: 'usb' },
    footprint: { x0: -0.5, x1: 4.5, z0: -5, z1: -0.5 },
    slots: [slot('pcb', 'Board', 'pcb-purple'), slot('metal', 'Socket', 'chrome'), slot('legs', 'Pins', 'gold-pin')],
    model: { template: 'usb-breakout' }, visual: 'none',
  },
  {
    id: 'funcgen', name: 'Function generator', category: 'power', tags: ['signal', 'generator', 'sine', 'square'],
    desc: 'A signal source with a 50 Ω output: sine, square, triangle or DC. Amplitude is the peak value; the offset adds a DC level.',
    mount: 'free',
    pins: [{ name: 'OUT', label: 'OUT (red)', x: 0, z: 0, y: 14, socket: true }, { name: 'COM', label: 'COM (black)', x: 3, z: 0, y: 14, socket: true }],
    params: [
      en('wave', 'Wave', 'sine', ['sine', 'square', 'tri', 'dc'], { live: true }),
      num('freq', 'Frequency', 'Hz', 1000, 0.01, 1e6, { scale: 'log', live: true }),
      num('amp', 'Amplitude (peak)', 'V', 1, 0, 10, { step: 0.01, live: true }),
      num('offset', 'Offset', 'V', 0, -10, 10, { step: 0.01, live: true }),
      num('duty', 'Duty (square)', '', 0.5, 0.01, 0.99, { step: 0.01, live: true }),
    ],
    electrical: [el('main', 'vsource', { p: 'OUT', n: 'COM' },
      { wave: { kind: '$wave', amp: '$amp', freq: '$freq', offset: '$offset', phase: 0, duty: '$duty', v: '$offset' }, rint: 50 })],
    slots: [slot('body', 'Case', 'abs-dark'), slot('face', 'Front panel', 'abs-black'), slot('knob', 'Knobs', 'abs-grey'), slot('metal', 'Terminals', 'brass')],
    model: { template: 'funcgen' }, visual: 'supply',
  },
  {
    id: 'solar-panel', name: 'Solar panel', category: 'power', tags: ['solar', 'pv'],
    desc: 'A small 6 V panel. Short-circuit current follows the light level; open-circuit voltage falls slowly as the light dims.',
    mount: 'free',
    pins: [{ name: '+', x: 0, z: 0, y: 4, socket: true }, { name: MINUS, x: 2, z: 0, y: 4, socket: true }],
    params: [
      num('lux', 'Light', 'lx', 20000, 1, 100000, { scale: 'log', live: true }),
      num('isc', 'Isc at 100 klx', 'A', 0.15, 0.01, 2),
      num('voc', 'Voc', 'V', 6, 1, 24),
    ],
    electrical: [el('main', 'solar', { p: '+', n: MINUS }, { isc: '$isc', voc: '$voc', lux: '$lux' })],
    interact: { kind: 'slider', key: 'lux' },
    slots: [slot('cell', 'Cells', 'solar-cell'), slot('body', 'Frame', 'aluminium'), slot('metal', 'Terminals', 'brass')],
    model: { template: 'solar' }, visual: 'none',
  },
  {
    id: 'batt-18650-shield', name: '18650 shield', category: 'power', tags: ['battery', 'li-ion', '18650'],
    desc: 'A Li-ion 18650 cell on a board with a switch, a 5 V boost converter and a 3.3 V regulator. The boost is modelled as an ideal regulator.',
    mount: 'free',
    pins: [{ name: '3V', x: 0, z: 0, y: 10, socket: true }, { name: '5V', x: 1, z: 0, y: 10, socket: true }, { name: 'GND', x: 2, z: 0, y: 10, socket: true }],
    params: [num('soc', 'Charge left', '', 0.9, 0, 1, { step: 0.01, live: true }), bool('on', 'Switch on', true, { live: true })],
    electrical: [
      el('cell', 'battery', { p: '#b', n: 'GND' }, { v: 4.1, rint: 0.06, mah: 2600, soc: '$soc' }),
      el('sw', 'switch', { a: '#b', b: '#s' }, { on: '$on' }),
      el('boost', 'regulator', { in: '#s', gnd: 'GND', out: '5V' }, { vout: 5, dropout: 0, iq: 0.002, imax: 2, boost: true }),
      el('reg3', 'regulator', { in: '5V', gnd: 'GND', out: '3V' }, { model: 'ams1117-3.3' }),
    ],
    interact: { kind: 'toggle', key: 'on' },
    slots: [slot('pcb', 'Board', 'pcb-black'), slot('cell', 'Cell', 'abs-blue'), slot('body', 'Holder', 'abs-black'), slot('metal', 'Pins', 'gold-pin')],
    model: { template: 'shield-18650' }, visual: 'none',
  },
];
