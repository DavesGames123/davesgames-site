// ============================================================================
//  BREADBOARD LAB  ·  parts/defs/input.js — buttons, switches, joystick, keypad
// ----------------------------------------------------------------------------
//  Interactive parts carry `interact`: the view makes their cap, lever or keys
//  clickable and writes the param (pressed, pos, x, y, k11..k44) live.
//
//  TACTILE BUTTONS. Pins 1-2 are joined inside, and so are 3-4. A press joins
//  the pairs. The 6 mm button straddles the channel: pins 3 and 4 sit 3 grid
//  units toward -Z (CONTRACT 3.5).
//
//  GREP MAP
//    button-6mm / button-12mm .. tactile switches
//    switch-slide ............ SPDT slide switch
//    joystick ................ two pots and a push switch
//    keypad-4x4 .............. 16 keys on a row/column matrix
// ============================================================================
import { num, int, en, bool, slot, el, row } from './util.js';

function tactile(id, name, dz, desc, extra = {}) {
  return {
    id, name, category: 'input', tags: ['button', 'switch', 'tactile'], desc, mount: 'board',
    pins: [{ name: '1', x: 0, z: 0 }, { name: '2', x: 2, z: 0 }, { name: '3', x: 0, z: -dz }, { name: '4', x: 2, z: -dz }],
    params: [bool('pressed', 'Pressed', false, { live: true }), ...(extra.params || [])],
    electrical: [
      el('j12', 'wire', { a: '1', b: '2' }, { r: 0.01 }),
      el('j34', 'wire', { a: '3', b: '4' }, { r: 0.01 }),
      el('main', 'button', { a: '1', b: '3' }, { pressed: '$pressed', ron: 0.05 }),
    ],
    interact: { kind: 'press', key: 'pressed' },
    footprint: { x0: -0.3, x1: 2.3, z0: -dz, z1: 0 },
    slots: extra.slots, model: { template: 'button', size: extra.size }, visual: 'none',
  };
}

const KEY_LABELS = [['1', '2', '3', 'A'], ['4', '5', '6', 'B'], ['7', '8', '9', 'C'], ['*', '0', '#', 'D']];
const KEYS = [];
for (let r = 1; r <= 4; r++) for (let c = 1; c <= 4; c++) KEYS.push({ key: `k${r}${c}`, r, c, label: KEY_LABELS[r - 1][c - 1] });

export const INPUT_DEFS = [
  tactile('button-6mm', 'Push button 6 mm', 3, 'A small tactile switch across the channel. Click its cap to press it.', {
    size: 6, slots: [slot('body', 'Body', 'abs-black'), slot('cap', 'Cap', 'abs-black'), slot('legs', 'Legs', 'tin')],
  }),
  tactile('button-12mm', 'Push button 12 mm', 5, 'A big tactile switch with a coloured cap. Click its cap to press it.', {
    size: 12, params: [en('cap', 'Cap colour', 'red', ['red', 'blue', 'black', 'yellow', 'green', 'white'])],
    slots: [slot('body', 'Body', 'abs-black'), slot('cap', 'Cap', 'abs-red'), slot('metal', 'Frame', 'chrome'), slot('legs', 'Legs', 'tin')],
  }),
  {
    id: 'switch-slide', name: 'Slide switch', category: 'input', tags: ['switch', 'spdt'],
    desc: 'A single-pole changeover switch: COM joins A in position 0 and B in position 1. Click the lever to move it.',
    mount: 'board',
    pins: [{ name: 'A', x: 0, z: 0 }, { name: 'COM', x: 1, z: 0 }, { name: 'B', x: 2, z: 0 }],
    params: [int('pos', 'Position', 0, 0, 1, { live: true })],
    electrical: [el('main', 'spdt', { com: 'COM', a: 'A', b: 'B' }, { pos: '$pos' })],
    interact: { kind: 'toggle', key: 'pos' },
    slots: [slot('body', 'Body', 'abs-black'), slot('metal', 'Frame', 'chrome'), slot('cap', 'Lever', 'abs-white'), slot('legs', 'Legs', 'tin')],
    model: { template: 'switch-slide' }, visual: 'none',
  },
  {
    id: 'joystick', name: 'Joystick module', category: 'input', tags: ['joystick', 'analog', 'pot'],
    desc: 'A thumb stick: two 10 kΩ pots (X and Y) and a push switch to GND. At rest each axis gives half the supply.',
    mount: 'board',
    pins: row(['GND', '+5V', 'VRX', 'VRY', 'SW'], 0),
    params: [
      num('x', 'X', '', 0.5, 0, 1, { step: 0.001, live: true }),
      num('y', 'Y', '', 0.5, 0, 1, { step: 0.001, live: true }),
      bool('sw', 'Pressed', false, { live: true }),
    ],
    electrical: [
      el('x', 'pot', { a: 'GND', w: 'VRX', b: '+5V' }, { r: 10000, pos: '$x', taper: 'lin' }),
      el('y', 'pot', { a: 'GND', w: 'VRY', b: '+5V' }, { r: 10000, pos: '$y', taper: 'lin' }),
      el('sw', 'button', { a: 'SW', b: 'GND' }, { pressed: '$sw' }),
    ],
    interact: { kind: 'knob', key: 'x', keys: ['x', 'y', 'sw'] },
    footprint: { x0: -1, x1: 5, z0: -13, z1: -0.5 },
    slots: [slot('pcb', 'Board', 'pcb-black'), slot('body', 'Gimbal', 'abs-black'), slot('cap', 'Thumb cap', 'abs-black'), slot('legs', 'Pins', 'gold-pin')],
    model: { template: 'joystick' }, visual: 'none',
  },
  {
    id: 'keypad-4x4', name: '4 × 4 keypad', category: 'input', tags: ['keypad', 'matrix'],
    desc: 'A membrane keypad: each key joins one row line R1..R4 to one column line C1..C4. Scan it: drive a row low, read the columns with pull-ups.',
    mount: 'board',
    pins: row(['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'], 0),
    params: KEYS.map(k => bool(k.key, `Key ${k.label}`, false, { live: true })),
    electrical: KEYS.map(k => el(k.key, 'button', { a: 'R' + k.r, b: 'C' + k.c }, { pressed: '$' + k.key })),
    interact: { kind: 'press', key: 'k11', keys: KEYS.map(k => k.key) },
    keyLabels: Object.fromEntries(KEYS.map(k => [k.key, k.label])),
    slots: [slot('body', 'Membrane', 'abs-black'), slot('cap', 'Keys', 'abs-white'), slot('cable', 'Ribbon', 'abs-grey'), slot('legs', 'Pins', 'gold-pin')],
    model: { template: 'keypad' }, visual: 'none',
  },
];
