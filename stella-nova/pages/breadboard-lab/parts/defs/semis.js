// ============================================================================
//  BREADBOARD LAB  ·  parts/defs/semis.js — diodes, LEDs, transistors
// ----------------------------------------------------------------------------
//  Pin order follows the real packages. TO-92 parts are read with the flat
//  face toward you, legs down, left to right: the 2N3904 family is E B C, the
//  2N7000 is S G D. TO-220 parts are read the same way: G D S.
//
//  An LED lens takes its colour from the color param unless the user put a
//  material on the lens slot.
//
//  GREP MAP
//    diode-1n4148 / diode-1n4007 / diode-schottky / zener ... axial diodes
//    led / led-rgb .......... 5 mm LEDs
//    npn-2n3904 / npn-2n2222 / pnp-2n3906 ... bipolar, TO-92
//    nmos-2n7000 / nmos-logic-to220 / pmos-to220 ... MOSFETs
// ============================================================================
import { int, en, slot, el } from './util.js';

const span = () => int('span', 'Lead span', 4, 3, 10, { geometric: true, unit: 'G' });
const axialPins = [{ name: 'A', x: 0, z: 0 }, { name: 'K', x: '$span', z: 0 }];

function diode(id, name, model, look, desc, extra = {}) {
  return {
    id, name, category: 'semis', tags: ['diode'], desc, mount: 'board',
    pins: axialPins, params: [span(), ...(extra.params || [])],
    electrical: extra.electrical || [el('main', 'diode', { a: 'A', k: 'K' }, { model })],
    slots: [slot('body', 'Body', look.body), slot('band', 'Cathode band', look.band), slot('legs', 'Leads', 'tin')],
    model: { template: 'diode', kind: look.kind, label: look.label }, visual: 'none',
  };
}

const LED_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'white', 'ir'];

function to92(id, name, pins, type, model, desc, label) {
  return {
    id, name, category: 'semis', tags: ['transistor', type], desc, mount: 'board',
    pins: pins.map((n, i) => ({ name: n, x: i, z: 0 })), params: [],
    electrical: [el('main', type, type === 'npn' || type === 'pnp'
      ? { c: 'C', b: 'B', e: 'E' } : { d: 'D', g: 'G', s: 'S' }, { model })],
    slots: [slot('body', 'Body', 'epoxy-black'), slot('legs', 'Legs', 'tin')],
    model: { template: 'to92', label }, visual: 'none',
  };
}
function to220(id, name, type, model, desc, label) {
  return {
    id, name, category: 'semis', tags: ['mosfet', type, 'to220'], desc, mount: 'board',
    pins: [{ name: 'G', x: 0, z: 0 }, { name: 'D', x: 1, z: 0 }, { name: 'S', x: 2, z: 0 }], params: [],
    electrical: [el('main', type, { d: 'D', g: 'G', s: 'S' }, { model })],
    slots: [slot('body', 'Body', 'epoxy-black'), slot('tab', 'Tab', 'tin'), slot('legs', 'Legs', 'tin')],
    model: { template: 'to220', label }, visual: 'none',
  };
}

export const SEMIS_DEFS = [
  diode('diode-1n4148', 'Signal diode 1N4148', '1n4148', { body: 'led-orange', band: 'abs-black', kind: 'glass', label: '4148' },
    'A fast small-signal diode: about 0.65 V forward at a few mA. Band = cathode (K).'),
  diode('diode-1n4007', 'Rectifier 1N4007', '1n4007', { body: 'epoxy-black', band: 'abs-grey', kind: 'plastic', label: '4007' },
    'A 1 A rectifier diode. Use it as the flyback diode across motors and relay coils.'),
  diode('diode-schottky', 'Schottky diode', 'schottky', { body: 'epoxy-black', band: 'abs-grey', kind: 'plastic', label: '5819' },
    'A Schottky diode: about 0.3 V forward, fast, more leakage.'),
  diode('zener', 'Zener diode', null, { body: 'led-white', band: 'abs-black', kind: 'glass', label: 'Z' },
    'Forward it is a diode; reversed it holds its zener voltage once the current passes a few mA.', {
      params: [en('vz', 'Zener voltage', 5.1, [2.7, 3.3, 3.9, 4.7, 5.1, 5.6, 6.2, 6.8, 8.2, 9.1, 12])],
      electrical: [el('main', 'zener', { a: 'A', k: 'K' }, { vz: '$vz', rz: 5 })],
    }),
  {
    id: 'led', name: 'LED 5 mm', category: 'semis', tags: ['led', 'light'],
    desc: 'A light emitting diode. Long leg = anode (A). It drops about 2 V (red) to 3.1 V (blue, white) and wants 20 mA at most: always use a series resistor.',
    mount: 'board',
    pins: [{ name: 'A', x: 0, z: 0 }, { name: 'K', x: 1, z: 0 }],
    params: [en('color', 'Colour', 'red', LED_COLORS)],
    electrical: [el('main', 'led', { a: 'A', k: 'K' }, { color: '$color', imax: 0.02, iabs: 0.05, vrmax: 5 })],
    slots: [slot('lens', 'Lens', 'led-red'), slot('legs', 'Leads', 'tin')],
    model: { template: 'led' }, visual: 'led',
  },
  {
    id: 'led-rgb', name: 'RGB LED (common cathode)', category: 'semis', tags: ['led', 'rgb'],
    desc: 'Three LEDs in one diffused lens with a shared cathode K (the longest leg). Mix colours with PWM.',
    mount: 'board',
    pins: [{ name: 'R', x: 0, z: 0 }, { name: 'K', x: 1, z: 0 }, { name: 'G', x: 2, z: 0 }, { name: 'B', x: 3, z: 0 }],
    params: [],
    electrical: [
      el('r', 'led', { a: 'R', k: 'K' }, { color: 'red' }, { vis: 'r' }),
      el('g', 'led', { a: 'G', k: 'K' }, { color: 'green' }, { vis: 'g' }),
      el('b', 'led', { a: 'B', k: 'K' }, { color: 'blue' }, { vis: 'b' }),
    ],
    slots: [slot('lens', 'Lens', 'led-diffuse'), slot('legs', 'Leads', 'tin')],
    model: { template: 'led-rgb' }, visual: 'leds',
  },
  to92('npn-2n3904', 'NPN 2N3904', ['E', 'B', 'C'], 'npn', '2n3904', 'A small NPN transistor (β about 150, 200 mA). Flat face toward you: E B C.', '3904'),
  to92('npn-2n2222', 'NPN 2N2222', ['E', 'B', 'C'], 'npn', '2n2222', 'A general NPN for up to about 600 mA (TO-92 version, E B C).', '2222'),
  to92('pnp-2n3906', 'PNP 2N3906', ['E', 'B', 'C'], 'pnp', '2n3906', 'The PNP partner of the 2N3904. Flat face toward you: E B C.', '3906'),
  to92('nmos-2n7000', 'N-MOSFET 2N7000', ['S', 'G', 'D'], 'nmos', '2n7000', 'A small N-channel MOSFET, threshold about 2 V, 200 mA. Flat face toward you: S G D.', '7000'),
  to220('nmos-logic-to220', 'N-MOSFET logic level (TO-220)', 'nmos', 'logic-to220', 'A power N-MOSFET that turns fully on at 5 V on the gate. G D S.', 'N-FET'),
  to220('pmos-to220', 'P-MOSFET (TO-220)', 'pmos', 'p-to220', 'A power P-MOSFET for high-side switching. Gate below source turns it on. G D S.', 'P-FET'),
];
