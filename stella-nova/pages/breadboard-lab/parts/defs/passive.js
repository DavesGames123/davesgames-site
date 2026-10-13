// ============================================================================
//  BREADBOARD LAB  ·  parts/defs/passive.js — passives and sensors
// ----------------------------------------------------------------------------
//  Resistor, pots, capacitors, inductor, fuse, and the sensors (LDR,
//  thermistor, analog temperature sensor). Values carry SI units; the
//  inspector snaps R and C to the E-series named on the param.
//
//  The resistor span is a geometric param: pin 2 sits at ($span, 0), so a
//  change of span moves a pin and rebuilds the netlist.
//
//  GREP MAP
//    res / pot / trimpot .... resistors
//    cap-ceramic / cap-elec . capacitors (the electrolytic is polarized)
//    inductor / fuse
//    ldr / thermistor / temp-analog ... sensors (live light and temperature)
// ============================================================================
import { num, int, en, bool, slot, el } from './util.js';

const MINUS = '−';

export const PASSIVE_DEFS = [
  {
    id: 'res', name: 'Resistor', category: 'passive', tags: ['resistor', 'ohm'],
    desc: 'A carbon film resistor. The colour bands follow the value. Above its power rating it heats; at four times the rating it burns in about a second.',
    mount: 'board',
    pins: [{ name: '1', x: 0, z: 0 }, { name: '2', x: '$span', z: 0 }],
    params: [
      num('r', 'Resistance', 'Ω', 220, 0.1, 1e7, { scale: 'log', series: 'E24' }),
      en('tol', 'Tolerance', 0.05, [0.01, 0.02, 0.05, 0.1]),
      en('pmax', 'Power rating', 0.25, [0.125, 0.25, 0.5, 1]),
      int('span', 'Lead span', 4, 3, 12, { geometric: true, unit: 'G' }),
    ],
    electrical: [el('main', 'resistor', { a: '1', b: '2' }, { r: '$r', pmax: '$pmax' })],
    slots: [slot('body', 'Body', 'resistor-beige'), slot('legs', 'Leads', 'tin')],
    model: { template: 'res' }, visual: 'none',
  },
  {
    id: 'pot', name: 'Potentiometer', category: 'passive', tags: ['pot', 'knob', 'divider'],
    desc: 'A rotary potentiometer. The wiper W moves from pin 1 (position 0) to pin 2 (position 1). Turn the knob live.',
    mount: 'board',
    pins: [{ name: '1', x: 0, z: 0 }, { name: 'W', x: 2, z: 0 }, { name: '2', x: 4, z: 0 }],
    params: [
      num('r', 'Resistance', 'Ω', 10000, 100, 1e6, { scale: 'log', series: 'E12' }),
      num('pos', 'Position', '', 0.5, 0, 1, { step: 0.001, live: true }),
      en('taper', 'Taper', 'lin', ['lin', 'log']),
    ],
    electrical: [el('main', 'pot', { a: '1', w: 'W', b: '2' }, { r: '$r', pos: '$pos', taper: '$taper' })],
    interact: { kind: 'knob', key: 'pos' },
    footprint: { x0: -1, x1: 5, z0: -6, z1: -1 },
    slots: [slot('body', 'Body', 'abs-blue'), slot('knob', 'Knob', 'abs-black'), slot('metal', 'Bushing', 'aluminium'), slot('legs', 'Legs', 'tin')],
    model: { template: 'pot' }, visual: 'none',
  },
  {
    id: 'trimpot', name: 'Trimmer pot', category: 'passive', tags: ['pot', 'trimmer'],
    desc: 'A small trimmer with a screwdriver slot. Same model as the potentiometer.',
    mount: 'board',
    pins: [{ name: '1', x: 0, z: 0 }, { name: 'W', x: 1, z: 0 }, { name: '2', x: 2, z: 0 }],
    params: [
      num('r', 'Resistance', 'Ω', 10000, 100, 1e6, { scale: 'log', series: 'E12' }),
      num('pos', 'Position', '', 0.5, 0, 1, { step: 0.001, live: true }),
    ],
    electrical: [el('main', 'pot', { a: '1', w: 'W', b: '2' }, { r: '$r', pos: '$pos', taper: 'lin' })],
    interact: { kind: 'knob', key: 'pos' },
    slots: [slot('body', 'Body', 'abs-blue'), slot('knob', 'Rotor', 'abs-white'), slot('legs', 'Legs', 'tin')],
    model: { template: 'trimpot' }, visual: 'none',
  },
  {
    id: 'cap-ceramic', name: 'Ceramic capacitor', category: 'passive', tags: ['capacitor', 'decoupling'],
    desc: 'A ceramic disc capacitor. Not polarized.',
    mount: 'board',
    pins: [{ name: '1', x: 0, z: 0 }, { name: '2', x: 2, z: 0 }],
    params: [
      num('c', 'Capacitance', 'F', 1e-7, 1e-12, 1e-5, { scale: 'log', series: 'E12' }),
      num('vmax', 'Voltage rating', 'V', 50, 6, 1000),
    ],
    electrical: [el('main', 'capacitor', { a: '1', b: '2' }, { c: '$c', esr: 0.01, polarized: false, vmax: '$vmax' })],
    slots: [slot('body', 'Body', 'ceramic-yellow'), slot('legs', 'Leads', 'tin')],
    model: { template: 'cap-ceramic' }, visual: 'none',
  },
  {
    id: 'cap-elec', name: 'Electrolytic capacitor', category: 'passive', tags: ['capacitor', 'polarized'],
    desc: 'An aluminium electrolytic. The stripe marks the − lead. Reversed by more than 1 V for half a second, it vents.',
    mount: 'board',
    pins: [{ name: '+', x: 0, z: 0 }, { name: MINUS, x: 1, z: 0 }],
    params: [
      num('c', 'Capacitance', 'F', 1e-4, 1e-7, 1e-2, { scale: 'log', series: 'E12' }),
      en('vmax', 'Voltage rating', 16, [6.3, 10, 16, 25, 35, 50]),
    ],
    electrical: [el('main', 'capacitor', { a: '+', b: MINUS }, { c: '$c', esr: 0.1, polarized: true, vmax: '$vmax' })],
    slots: [slot('body', 'Sleeve', 'sleeve-black'), slot('stripe', 'Stripe', 'sleeve-stripe'), slot('metal', 'Top', 'aluminium'), slot('legs', 'Leads', 'tin')],
    model: { template: 'cap-elec' }, visual: 'none',
  },
  {
    id: 'inductor', name: 'Inductor', category: 'passive', tags: ['coil', 'choke'],
    desc: 'A drum-core inductor with its winding resistance.',
    mount: 'board',
    pins: [{ name: '1', x: 0, z: 0 }, { name: '2', x: 2, z: 0 }],
    params: [
      num('l', 'Inductance', 'H', 1e-3, 1e-6, 1, { scale: 'log', series: 'E12' }),
      num('rdc', 'Winding resistance', 'Ω', 0.5, 0.001, 100, { scale: 'log' }),
    ],
    electrical: [el('main', 'inductor', { a: '1', b: '2' }, { l: '$l', rdc: '$rdc' })],
    slots: [slot('body', 'Core', 'ferrite'), slot('winding', 'Winding', 'enamel-copper'), slot('legs', 'Leads', 'tin')],
    model: { template: 'inductor' }, visual: 'none',
  },
  {
    id: 'fuse', name: 'Glass fuse', category: 'passive', tags: ['fuse', 'protection'],
    desc: 'A fast glass fuse with leads. It blows when the current squared times time passes its rating.',
    mount: 'board',
    pins: [{ name: '1', x: 0, z: 0 }, { name: '2', x: 6, z: 0 }],
    params: [en('rating', 'Rating', 0.5, [0.1, 0.25, 0.5, 1, 2, 3, 5])],
    electrical: [el('main', 'fuse', { a: '1', b: '2' }, { rating: '$rating' })],
    slots: [slot('body', 'Glass', 'glass'), slot('metal', 'Caps', 'chrome'), slot('legs', 'Leads', 'tin')],
    model: { template: 'fuse' }, visual: 'fuse',
  },
  {
    id: 'ldr', name: 'Light sensor (LDR)', category: 'sensors', tags: ['ldr', 'photoresistor', 'light'],
    desc: 'A photoresistor: about 10 kΩ at 10 lux, lower in brighter light (R falls as lux^-0.7). Set the light live.',
    mount: 'board',
    pins: [{ name: '1', x: 0, z: 0 }, { name: '2', x: 2, z: 0 }],
    params: [
      num('lux', 'Light', 'lx', 300, 0.1, 10000, { scale: 'log', live: true }),
      num('r10', 'R at 10 lux', 'Ω', 10000, 1000, 1e6, { scale: 'log' }),
      num('gamma', 'Gamma', '', 0.7, 0.4, 1.0, { step: 0.01 }),
    ],
    electrical: [el('main', 'ldr', { a: '1', b: '2' }, { lux: '$lux', r10: '$r10', gamma: '$gamma' })],
    interact: { kind: 'slider', key: 'lux' },
    slots: [slot('body', 'Face', 'ceramic-tan'), slot('track', 'Track', 'copper'), slot('legs', 'Leads', 'tin')],
    model: { template: 'ldr' }, visual: 'none',
  },
  {
    id: 'thermistor', name: 'NTC thermistor', category: 'sensors', tags: ['ntc', 'temperature'],
    desc: 'A 10 kΩ NTC thermistor (beta 3950). Resistance falls as it warms. Set the temperature live.',
    mount: 'board',
    pins: [{ name: '1', x: 0, z: 0 }, { name: '2', x: 2, z: 0 }],
    params: [
      num('tempC', 'Temperature', '°C', 25, -40, 150, { step: 0.1, live: true }),
      num('r25', 'R at 25 °C', 'Ω', 10000, 100, 1e6, { scale: 'log', series: 'E12' }),
      num('beta', 'Beta', 'K', 3950, 2000, 5000),
    ],
    electrical: [el('main', 'thermistor', { a: '1', b: '2' }, { r25: '$r25', beta: '$beta', tempC: '$tempC' })],
    interact: { kind: 'slider', key: 'tempC' },
    slots: [slot('body', 'Bead', 'epoxy-black'), slot('legs', 'Leads', 'tin')],
    model: { template: 'thermistor' }, visual: 'none',
  },
  {
    id: 'temp-analog', name: 'Analog temperature sensor', category: 'sensors', tags: ['temperature', 'to92'],
    desc: 'A TO-92 sensor: 10 mV per °C with 0.5 V at 0 °C (750 mV at 25 °C). Flat face toward you: +V, OUT, GND.',
    mount: 'board',
    pins: [{ name: '+V', x: 0, z: 0 }, { name: 'OUT', x: 1, z: 0 }, { name: 'GND', x: 2, z: 0 }],
    params: [num('tempC', 'Temperature', '°C', 25, -40, 125, { step: 0.1, live: true })],
    electrical: [el('main', 'tempsensor', { vs: '+V', out: 'OUT', gnd: 'GND' }, { tempC: '$tempC' })],
    interact: { kind: 'slider', key: 'tempC' },
    slots: [slot('body', 'Body', 'epoxy-black'), slot('legs', 'Legs', 'tin')],
    model: { template: 'to92', label: 'TEMP' }, visual: 'none',
  },
];
