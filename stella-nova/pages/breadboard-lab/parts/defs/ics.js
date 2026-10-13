// ============================================================================
//  BREADBOARD LAB  ·  parts/defs/ics.js — DIP chips and regulators
// ----------------------------------------------------------------------------
//  DIP pins are named '1'..'N' and carry the datasheet function as a label.
//  Pin 1 at (0, 0), pins run along +X, and the second row comes back 0.3 inch
//  toward -Z: placed with pin 1 in row f, the chip straddles the channel.
//
//  The logic chips are one `logic` element with terminals p1..pN wired to
//  pins 1..N. SIM knows each chip's function by its `chip` name.
//
//  GREP MAP
//    ic-555 / ic-lm358 ...... analog
//    logicChip .............. the 74HC family and the CD4017
//    reg-7805 / reg-3v3 ..... regulators
// ============================================================================
import { slot, el, dip } from './util.js';

const DIP_SLOTS = () => [slot('body', 'Body', 'epoxy-black'), slot('legs', 'Legs', 'tin'), slot('label', 'Marking', 'silk-white')];
const dipFoot = n => ({ x0: -0.5, x1: n / 2 - 0.5, z0: -3, z1: 0 });

function logicChip(id, chip, name, labels, desc, mark) {
  const n = labels.length;
  const nodes = {};
  for (let i = 1; i <= n; i++) nodes['p' + i] = String(i);
  return {
    id, name, category: 'ics', tags: ['logic', 'dip', chip], desc, mount: 'board',
    pins: dip(n, labels), params: [],
    electrical: [el('main', 'logic', nodes, { chip })],
    footprint: dipFoot(n),
    slots: DIP_SLOTS(), model: { template: 'dip', pins: n, label: mark }, visual: 'none',
  };
}
const QUAD2 = ['1A', '1B', '1Y', '2A', '2B', '2Y', 'GND', '3Y', '3A', '3B', '4Y', '4A', '4B', 'VCC'];

export const ICS_DEFS = [
  {
    id: 'ic-555', name: '555 timer', category: 'ics', tags: ['timer', 'oscillator', 'dip'],
    desc: 'The classic timer: two comparators at 1/3 and 2/3 of VCC, a latch, a discharge switch and an output stage. Astable, monostable and PWM circuits.',
    mount: 'board',
    pins: dip(8, ['GND', 'TRIG', 'OUT', 'RESET', 'CTRL', 'THRES', 'DIS', 'VCC']), params: [],
    electrical: [el('main', 'timer555', { gnd: '1', trig: '2', out: '3', reset: '4', ctrl: '5', thres: '6', dis: '7', vcc: '8' })],
    footprint: dipFoot(8),
    slots: DIP_SLOTS(), model: { template: 'dip', pins: 8, label: '555' }, visual: 'none',
  },
  {
    id: 'ic-lm358', name: 'LM358 dual op-amp', category: 'ics', tags: ['opamp', 'comparator', 'dip'],
    desc: 'Two op-amps that work from one supply. The output swings to about 1.5 V below VCC and close to GND.',
    mount: 'board',
    pins: dip(8, ['1OUT', '1IN−', '1IN+', 'GND', '2IN+', '2IN−', '2OUT', 'VCC']), params: [],
    electrical: [
      el('a', 'opamp', { inp: '3', inn: '2', out: '1', vcc: '8', vee: '4' }, { model: 'lm358' }),
      el('b', 'opamp', { inp: '5', inn: '6', out: '7', vcc: '8', vee: '4' }, { model: 'lm358' }),
    ],
    footprint: dipFoot(8),
    slots: DIP_SLOTS(), model: { template: 'dip', pins: 8, label: 'LM358' }, visual: 'none',
  },
  logicChip('ic-74hc00', '74hc00', '74HC00 quad NAND', QUAD2, 'Four 2-input NAND gates. Y = !(A & B).', '74HC00'),
  logicChip('ic-74hc02', '74hc02', '74HC02 quad NOR',
    ['1Y', '1A', '1B', '2Y', '2A', '2B', 'GND', '3A', '3B', '3Y', '4A', '4B', '4Y', 'VCC'], 'Four 2-input NOR gates. Y = !(A | B). Note the output comes first on this chip.', '74HC02'),
  logicChip('ic-74hc04', '74hc04', '74HC04 hex inverter',
    ['1A', '1Y', '2A', '2Y', '3A', '3Y', 'GND', '4Y', '4A', '5Y', '5A', '6Y', '6A', 'VCC'], 'Six inverters. Y = !A.', '74HC04'),
  logicChip('ic-74hc08', '74hc08', '74HC08 quad AND', QUAD2, 'Four 2-input AND gates. Y = A & B.', '74HC08'),
  logicChip('ic-74hc32', '74hc32', '74HC32 quad OR', QUAD2, 'Four 2-input OR gates. Y = A | B.', '74HC32'),
  logicChip('ic-74hc86', '74hc86', '74HC86 quad XOR', QUAD2, 'Four 2-input XOR gates. Y = A ^ B.', '74HC86'),
  logicChip('ic-74hc74', '74hc74', '74HC74 dual D flip-flop',
    ['1CLR', '1D', '1CLK', '1PRE', '1Q', '1Q̅', 'GND', '2Q̅', '2Q', '2PRE', '2CLK', '2D', '2CLR', 'VCC'],
    'Two D flip-flops with active-low preset and clear. Q takes D on the rising clock edge. Tie Q̅ to D to divide by two.', '74HC74'),
  logicChip('ic-74hc595', '74hc595', '74HC595 shift register',
    ['QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'GND', "QH'", 'SRCLR', 'SRCLK', 'RCLK', 'OE', 'SER', 'QA', 'VCC'],
    'An 8-bit shift register with an output latch. SER shifts in on SRCLK; RCLK copies the byte to QA..QH. OE low enables the outputs.', '74HC595'),
  logicChip('ic-cd4017', 'cd4017', 'CD4017 decade counter',
    ['Q5', 'Q1', 'Q0', 'Q2', 'Q6', 'Q7', 'Q3', 'VSS', 'Q8', 'Q4', 'Q9', 'CO', 'CE', 'CLK', 'RST', 'VDD'],
    'A counter with ten decoded outputs: one of Q0..Q9 is high and it moves on at each rising clock. CE high holds; RST high returns to Q0. Works from 3 V to 15 V.', 'CD4017'),
  {
    id: 'reg-7805', name: '7805 regulator', category: 'ics', tags: ['regulator', 'to220', '5v'],
    desc: 'A 5 V linear regulator. It needs about 2 V of headroom, burns the difference as heat, and goes into thermal limit before it dies. Pins: IN GND OUT.',
    mount: 'board',
    pins: [{ name: 'IN', x: 0, z: 0 }, { name: 'GND', x: 1, z: 0 }, { name: 'OUT', x: 2, z: 0 }], params: [],
    electrical: [el('main', 'regulator', { in: 'IN', gnd: 'GND', out: 'OUT' }, { model: '7805' })],
    slots: [slot('body', 'Body', 'epoxy-black'), slot('tab', 'Tab', 'tin'), slot('legs', 'Legs', 'tin')],
    model: { template: 'to220', label: '7805' }, visual: 'none',
  },
  {
    id: 'reg-3v3', name: '3.3 V regulator board', category: 'ics', tags: ['regulator', 'ldo', '3v3'],
    desc: 'A low-dropout 3.3 V regulator (1117 type) on a small board with its capacitors. About 1.1 V dropout.',
    mount: 'board',
    pins: [{ name: 'IN', x: 0, z: 0 }, { name: 'GND', x: 1, z: 0 }, { name: 'OUT', x: 2, z: 0 }], params: [],
    electrical: [el('main', 'regulator', { in: 'IN', gnd: 'GND', out: 'OUT' }, { model: 'ams1117-3.3' })],
    footprint: { x0: -1, x1: 3, z0: -5, z1: -0.5 },
    slots: [slot('pcb', 'Board', 'pcb-blue'), slot('body', 'Chip', 'epoxy-black'), slot('metal', 'Tab', 'tin'), slot('legs', 'Pins', 'gold-pin')],
    model: { template: 'reg-breakout' }, visual: 'none',
  },
];
