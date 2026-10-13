// ============================================================================
//  BREADBOARD LAB  ·  parts/defs/mcu.js — the three microcontroller boards
// ----------------------------------------------------------------------------
//  Generic boards: plain pin names, no logos, no trademark names.
//
//  THE MCU PINS ARE NOT ELEMENTS. The `mcu` field lists the pins that the
//  sketch runtime drives; SIM puts them in Netlist.mcus and makes the pin
//  drivers. The electrical list holds only the board's own circuit: USB
//  power, the regulators, the GND joins, the reset pull-up and the LEDs.
//
//  328 DEV BOARD (Uno layout) is a free part with female headers. Pin
//  positions follow that layout in inches, measured from D0, including the
//  0.16 inch gap between D7 and D8. Sockets sit 10 mm up (the header top).
//
//  NANO LAYOUT plugs in like a DIP-30 with rows 0.6 inch apart.
//  ESP32 DEVKIT is 1.0 inch wide with rows 0.9 inch apart: pin 1 (EN) goes in
//  row b and the far row lands in row i, so rows a and j stay free.
//
//  GREP MAP
//    UNO_PINS / mcu-uno ..... free, sockets
//    NANO_ORDER / mcu-nano .. board, DIP-30 order
//    ESP_TOP / ESP_BOT / mcu-esp32 ... board, 2 x 15
//    boardCircuit ........... shared USB, regulator and LED elements
// ============================================================================
import { bool, slot, el } from './util.js';

const SOCK_Y = 10;
function unoPins() {
  const P = [];
  const at = (name, xin, yin) => P.push({ name, x: +((xin - 2.6) * 10).toFixed(4), z: +(-(yin - 2.0) * 10).toFixed(4), y: SOCK_Y, socket: true });
  for (let k = 0; k <= 7; k++) at('D' + k, 2.6 - 0.1 * k, 2.0);
  for (let k = 8; k <= 13; k++) at('D' + k, 1.74 - 0.1 * (k - 8), 2.0);
  at('GND.3', 1.14, 2.0); at('AREF', 1.04, 2.0);
  at('IOREF', 1.0, 0.1); at('RESET', 1.1, 0.1); at('3V3', 1.2, 0.1); at('5V', 1.3, 0.1);
  at('GND.1', 1.4, 0.1); at('GND.2', 1.5, 0.1); at('VIN', 1.6, 0.1);
  for (let k = 0; k <= 5; k++) at('A' + k, 1.8 + 0.1 * k, 0.1);
  return P;
}
const NANO_ORDER = ['D1', 'D0', 'RST.1', 'GND.1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12',
  'D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST.2', 'GND.2', 'VIN'];
const ESP_TOP = ['EN', 'VP', 'VN', '34', '35', '32', '33', '25', '26', '27', '14', '12', '13', 'GND.1', 'VIN'];
const ESP_BOT = ['23', '22', 'TX0', 'RX0', '21', '19', '18', '5', '17', '16', '4', '2', '15', 'GND.2', '3V3'];

function avrCircuit(gndMore, rst) {
  return [
    el('usb', 'usbpower', { p: '5V', n: 'GND.1' }, { v: 5, rint: 0.2, trip: 0.5, usb: '$usb' }),
    ...gndMore.map((g, i) => el('gnd' + (i + 2), 'wire', { a: 'GND.1', b: g }, { r: 0.01 })),
    el('reg3', 'regulator', { in: '5V', gnd: 'GND.1', out: '3V3' }, { model: 'ams1117-3.3' }),
    el('regvin', 'regulator', { in: 'VIN', gnd: 'GND.1', out: '5V' }, { model: 'ncp1117-5' }),
    el('rL', 'resistor', { a: 'D13', b: '#L' }, { r: 1000 }),
    el('L', 'led', { a: '#L', k: 'GND.1' }, { color: 'yellow' }, { vis: 'L' }),
    el('rON', 'resistor', { a: '5V', b: '#on' }, { r: 1000 }),
    el('ON', 'led', { a: '#on', k: 'GND.1' }, { color: 'green' }, { vis: 'ON' }),
    el('rrst', 'resistor', { a: rst[0], b: '5V' }, { r: 10000 }),
    ...rst.slice(1).map((r, i) => el('rst' + (i + 2), 'wire', { a: rst[0], b: r }, { r: 0.01 })),
  ];
}
const mcuParams = () => [bool('usb', 'USB cable plugged in', true, { live: true })];

const D = n => Array.from({ length: n }, (_, i) => 'D' + i);
const A = n => Array.from({ length: n }, (_, i) => 'A' + i);

export const MCU_DEFS = [
  {
    id: 'mcu-uno', name: '328 dev board (Uno layout)', category: 'mcu', tags: ['mcu', 'avr', '328', 'uno-layout'],
    desc: 'A 5 V board with the 328 chip and the classic header layout: D0..D13, A0..A5, power pins. It sits on the mat; plug jumper wires into its sockets. The L LED is on D13. Write its sketch in the CODE panel.',
    mount: 'free',
    pins: unoPins(),
    params: mcuParams(),
    electrical: [...avrCircuit(['GND.2', 'GND.3'], ['RESET']), el('ioref', 'wire', { a: 'IOREF', b: '5V' }, { r: 0.01 })],
    mcu: { board: 'uno328', vdd: '5V', gnd: 'GND.1', pins: [...D(14), ...A(6)] },
    slots: [slot('pcb', 'Board', 'pcb-blue'), slot('body', 'Headers', 'abs-black'), slot('chip', 'Chip', 'epoxy-black'), slot('metal', 'Connectors', 'chrome'), slot('label', 'Silkscreen', 'silk-white')],
    model: { template: 'uno' }, visual: 'leds',
  },
  {
    id: 'mcu-nano', name: '328 Nano-layout board', category: 'mcu', tags: ['mcu', 'avr', '328', 'nano'],
    desc: 'The same 5 V 328 chip on a narrow board that plugs into the breadboard across the channel (rows 0.6 inch apart). Pin 1 is D1/TX.',
    mount: 'board',
    pins: NANO_ORDER.map((name, i) => i < 15 ? { name, x: i, z: 0 } : { name, x: 29 - i, z: -6 }),
    params: mcuParams(),
    electrical: avrCircuit(['GND.2'], ['RST.1', 'RST.2']),
    mcu: { board: 'nano328', vdd: '5V', gnd: 'GND.1', pins: [...D(14), ...A(8)] },
    footprint: { x0: -1.5, x1: 15.5, z0: -6.5, z1: 0.5 },
    slots: [slot('pcb', 'Board', 'pcb-blue'), slot('chip', 'Chip', 'epoxy-black'), slot('metal', 'USB', 'chrome'), slot('legs', 'Pins', 'gold-pin'), slot('label', 'Silkscreen', 'silk-white')],
    model: { template: 'nano' }, visual: 'leds',
  },
  {
    id: 'mcu-esp32', name: 'ESP32 devkit (30 pin)', category: 'mcu', tags: ['mcu', 'esp32', 'wifi', '3v3'],
    desc: 'A 3.3 V dual-core board, 30 pins. Its logic level is 3.3 V: never feed 5 V into a GPIO. Pins 34, 35, VP and VN are inputs only. It covers rows c..h of one board; a second board beside it reaches the other side.',
    mount: 'board',
    pins: [...ESP_TOP.map((name, i) => ({ name, x: i, z: 0 })), ...ESP_BOT.map((name, i) => ({ name, x: i, z: 9 }))],
    params: mcuParams(),
    electrical: [
      el('usb', 'usbpower', { p: 'VIN', n: 'GND.1' }, { v: 5, rint: 0.3, trip: 0.5, usb: '$usb' }),
      el('gnd2', 'wire', { a: 'GND.1', b: 'GND.2' }, { r: 0.01 }),
      el('reg3', 'regulator', { in: 'VIN', gnd: 'GND.1', out: '3V3' }, { model: 'ams1117-3.3' }),
      el('rLED', 'resistor', { a: '2', b: '#led' }, { r: 1000 }),
      el('LED', 'led', { a: '#led', k: 'GND.1' }, { color: 'blue' }, { vis: 'LED' }),
      el('rON', 'resistor', { a: '3V3', b: '#on' }, { r: 1000 }),
      el('ON', 'led', { a: '#on', k: 'GND.1' }, { color: 'red' }, { vis: 'ON' }),
      el('ren', 'resistor', { a: 'EN', b: '3V3' }, { r: 10000 }),
    ],
    mcu: { board: 'esp32dev', vdd: '3V3', gnd: 'GND.1',
      pins: ['VP', 'VN', '34', '35', '32', '33', '25', '26', '27', '14', '12', '13', '23', '22', 'TX0', 'RX0', '21', '19', '18', '5', '17', '16', '4', '2', '15'] },
    footprint: { x0: -2.5, x1: 15.5, z0: -0.5, z1: 9.5 },
    slots: [slot('pcb', 'Board', 'pcb-black'), slot('can', 'Module can', 'chrome'), slot('module', 'Module board', 'pcb-blue'), slot('metal', 'USB', 'chrome'), slot('legs', 'Pins', 'gold-pin'), slot('label', 'Silkscreen', 'silk-white')],
    model: { template: 'esp32' }, visual: 'leds',
  },
];
