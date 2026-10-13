// ============================================================================
//  BREADBOARD LAB  ·  examples/build.mjs — writes examples/*.json and index.js
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/breadboard-lab/examples/build.mjs [--check] [key]
//  Each example is a function that builds its bench with examples/bench.mjs
//  and returns its meta: title, level, blurb, "what you should see" lines,
//  the script (live param changes) and the checks that the page tests grade
//  (examples/verify.mjs). The build gate (bench.mjs check) refuses a bench
//  with a pin out of a hole, an overlap, or an unexpected warning.
//  --check builds every bench and compares it with the files on disk; it
//  writes nothing and exits 1 on drift.
//
//  LAYOUT HABITS. Board b1 is an 830 at the mat centre. TP/TN (top rails)
//  carry + and GND; bridge() copies them to BP/BN. Parts with a body that
//  hangs over the holes (pots, the joystick, the LCD) sit with their pins in
//  row a, so the body rests over the rails. LED blocks come from ledUnit().
//
//  GREP MAP
//    EX['<key>'] ............ one builder per example, in CONTRACT 5 order
//    SKETCHES ............... MCU programs come from mcu/sketches.js
//    main ................... build, gate, write or --check
// ============================================================================
import { createBench, ledUnit, check } from './bench.mjs';
import { SKETCHES } from '../mcu/sketches.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const EX = {};
const ORDER = [];
const def = (key, fn) => { EX[key] = fn; ORDER.push(key); };

// common spots on the mat (world mm)
const PSU = [-60, -42];             // bench supply + post (body behind, left)
const DMM_R = [140, 108];           // multimeter front right (body runs to -Z)
const SCOPE = [60, -48];            // oscilloscope behind the board
const LOGIC = [-30, 72];            // logic analyzer in front
const UNO = [-60, -48];             // 328 board D0 socket (board runs to -X, +Z)

// ---------------------------------------------------------------- 1
def('first-led', (B) => {
  B.board();
  const ps = B.supply(5, 0.5, ...PSU);
  const r = B.part('res', 'b1:b10', { r: 220 }, { label: 'R1' });
  const d = B.part('led', 'b1:c14', { color: 'red' }, { label: 'D1' });
  B.wire('b1:a15', B.rail('b1', 'TN', 15), 'black');
  const m = B.probe('dmm', ...DMM_R, { red: 'b1:TP8', black: 'b1:a10' }, { mode: 'A', range: 'auto' });
  void ps;
  return {
    title: 'First LED', level: 1,
    blurb: 'A 5 V supply, a 220 Ω resistor and a red LED, with the multimeter in series to read the current.',
    see: ['The LED glows red.', 'The multimeter in A mode reads about 13.6 mA: (5 V − 2 V) / 220 Ω.', 'Turn the supply up and the current rises; past about 50 mA the LED burns.'],
    checks: [
      { at: 0.5, probe: m, quantity: 'value', value: (5 - 2.0) / 220, tol: 0.1 },
      { at: 0.5, part: d, quantity: 'i', value: (5 - 2.0) / 220, tol: 0.1 },
      { at: 0.5, part: d, quantity: 'vis.b', min: 0.5, max: 0.8 },
      { at: 0.5, part: r, quantity: 'i', value: (5 - 2.0) / 220, tol: 0.1 },
    ],
  };
});

// ---------------------------------------------------------------- 2
def('no-resistor', (B) => {
  B.board();
  const bat = B.free('battery-9v', -105, 12, {}, { label: '9 V' });
  B.wire(bat + '.+', 'b1:TP2', 'red', 'arch');
  B.wire(bat + '.−', 'b1:TN2', 'black', 'arch');
  const d = B.part('led', 'b1:c20', { color: 'red' }, { label: 'D1' });
  B.wire(B.rail('b1', 'TP', 20), 'b1:a20', 'red');
  B.wire('b1:a21', B.rail('b1', 'TN', 21), 'black');
  return {
    title: 'LED with no resistor', level: 1,
    blurb: 'A red LED straight across a 9 V battery. Nothing limits the current, so the LED dies.',
    see: ['The LED flashes very bright for a moment.', 'Smoke rises, the LED goes dark and chars, and a toast names the missing resistor.', 'Click "Replace part", add a 470 Ω resistor in series, and run again.'],
    expectIssues: ['led-no-resistor'],
    checks: [
      { at: 0.5, event: 'damage', owner: d },
      { at: 1.0, part: d, quantity: 'damaged', equals: 'burnt' },
      { at: 1.0, part: d, quantity: 'i', max: 1e-4 },
    ],
  };
});

// ---------------------------------------------------------------- 3
def('ohms-law', (B) => {
  B.board();
  B.supply(9, 0.5, ...PSU);
  const r1 = B.part('res', 'b1:a10', { r: 1000 }, { label: 'R1 1k' });
  const r2 = B.part('res', 'b1:b14', { r: 2000 }, { label: 'R2 2k' });
  B.wire(B.rail('b1', 'TP', 10), 'b1:c10', 'red');
  B.wire('b1:c18', B.rail('b1', 'TN', 18), 'black');
  B.part('res', 'b1:f30', { r: 2200 }, { label: 'R3 2.2k' });
  B.part('res', 'b1:g30', { r: 2200 }, { label: 'R4 2.2k' });
  const mv = B.probe('dmm', 110, 108, { red: 'b1:d14', black: 'b1:d18' }, { mode: 'V', range: 'auto' });
  const mr = B.probe('dmm', 205, 108, { red: 'b1:h30', black: 'b1:h34' }, { mode: 'R', range: 'auto' });
  return {
    title: "Ohm's law", level: 1,
    blurb: 'A 1 kΩ and a 2 kΩ resistor in series across 9 V, and two 2.2 kΩ resistors in parallel on their own.',
    see: ['Meter 1 (V) across the 2 kΩ reads 6.00 V: 9 V × 2k / (1k + 2k).', 'Meter 2 (Ω) across the parallel pair reads 1.10 kΩ: half of 2.2 kΩ.', 'Move meter 2 onto the powered pair and it reads OL: an ohmmeter works only with the power off.'],
    checks: [
      { at: 0.3, probe: mv, quantity: 'value', value: 6.0, tol: 0.01 },
      { at: 0.3, probe: mr, quantity: 'value', value: 1100, tol: 0.01 },
      { at: 0.3, part: r1, quantity: 'i', value: 0.003, tol: 0.01 },
      { at: 0.3, part: r2, quantity: 'p', value: 0.018, tol: 0.02 },
    ],
  };
});

// ---------------------------------------------------------------- 4
def('divider-pot', (B) => {
  B.board();
  B.supply(5, 0.5, ...PSU);
  B.block('b1', ['TP', 'TN'], 9, 15); B.block('b1', ['TP', 'TN'], 29, 35);
  const p1 = B.part('pot', 'b1:a10', { r: 10000, pos: 0.5 }, { label: 'Divider' });
  B.wire('b1:b10', B.rail('b1', 'TN', 10), 'black');
  B.wire('b1:b14', B.rail('b1', 'TP', 14), 'red');
  const m = B.probe('dmm', ...DMM_R, { red: 'b1:c12', black: B.rail('b1', 'TN', 22) }, { mode: 'V', range: 'auto' });
  const p2 = B.part('pot', 'b1:a30', { r: 10000, pos: 0.05 }, { label: 'Rheostat' });
  B.wire(B.rail('b1', 'TP', 26), 'b1:b30', 'red');
  B.part('res', 'b1:c32', { r: 220 }, { label: 'R1' });
  const d = B.part('led', 'b1:d36', { color: 'green' }, { label: 'D1' });
  B.wire('b1:a37', B.rail('b1', 'TN', 37), 'black');
  return {
    title: 'Pot as a divider and a rheostat', level: 1,
    blurb: 'One pot divides 5 V for the meter; a second pot is a variable resistor in series with an LED.',
    see: ['The meter reads the wiper voltage: 2.50 V at mid travel. Turn the left knob and it follows.', 'The right pot sets the LED current: near 0 it is bright, near the middle it is dim.'],
    script: [{ at: 0.6, part: p1, key: 'pos', value: 0.2 }, { at: 0.6, part: p2, key: 'pos', value: 0.5 }],
    checks: [
      { at: 0.5, probe: m, quantity: 'value', value: 2.5, tol: 0.02 },
      { at: 0.5, part: d, quantity: 'i', value: (5 - 2.05) / 720, tol: 0.12 },
      { at: 1.0, probe: m, quantity: 'value', value: 1.0, tol: 0.02 },
      { at: 1.0, part: d, quantity: 'i', value: (5 - 1.85) / 5220, tol: 0.15 },
    ],
  };
});

// ---------------------------------------------------------------- 5
def('button-pulldown', (B) => {
  B.board();
  B.supply(5, 0.5, ...PSU);
  B.bridge();
  const sw = B.part('button-6mm', 'b1:f20', {}, { label: 'S1' });
  B.wire(B.rail('b1', 'TP', 20), 'b1:a20', 'red');
  B.part('res', 'b1:j22', { r: 10000 }, { rot: 2, label: 'R pull-down' });
  B.wire('b1:h18', B.rail('b1', 'BN', 18), 'black');
  B.part('res', 'b1:g22', { r: 220 }, { label: 'R1' });
  const d = B.part('led', 'b1:h26', { color: 'yellow' }, { label: 'D1' });
  B.wire('b1:j27', B.rail('b1', 'BN', 27), 'black');
  return {
    title: 'Button with a pull-down', level: 1,
    blurb: 'A push button feeds 5 V to an LED; a 10 kΩ pull-down holds the line low when the button is up.',
    see: ['Click and hold the button cap: the LED lights.', 'Let go: the 10 kΩ pull-down takes the line back to 0 V and the LED goes out.', 'Probe the button output with P to see 0 V and 5 V.'],
    script: [{ at: 0.5, part: sw, key: 'pressed', value: true }, { at: 1.0, part: sw, key: 'pressed', value: false }],
    checks: [
      { at: 0.4, part: d, quantity: 'i', max: 1e-5 },
      { at: 0.9, part: d, quantity: 'i', value: (5 - 2.1) / 220, tol: 0.1 },
      { at: 1.4, part: d, quantity: 'i', max: 1e-5 },
    ],
  };
});

// ---------------------------------------------------------------- 6
def('rc-charge', (B) => {
  B.board();
  B.supply(5, 0.5, ...PSU);
  const sw = B.part('switch-slide', 'b1:c10', { pos: 0 }, { label: 'S1' });
  B.wire('b1:a10', B.rail('b1', 'TN', 10), 'black');
  B.wire('b1:a12', B.rail('b1', 'TP', 12), 'red');
  B.part('res', 'b1:d11', { r: 10000 }, { label: 'R 10k' });
  B.part('cap-elec', 'b1:e15', { c: 100e-6, vmax: 16 }, { label: 'C 100µ' });
  B.wire('b1:a16', B.rail('b1', 'TN', 16), 'black');
  const sc = B.probe('scope', ...SCOPE, { ch1: 'b1:c15', gnd: B.rail('b1', 'TN', 30) }, { tdiv: 0.5, vdiv: [1, 1, 1, 1], offset: [-2.5, 0, 0, 0], trig: { ch: 1, level: 1, edge: 'rise', mode: 'auto' } });
  return {
    title: 'RC charge curve', level: 1,
    blurb: '10 kΩ and 100 µF: τ = RC = 1 s. Slide the switch to charge the capacitor and watch the curve on the scope.',
    see: ['Slide the switch: the scope trace rises fast, then slower and slower.', 'After τ = 1 s the capacitor holds 63 % of 5 V (3.16 V); put a cursor there.', 'Slide back to discharge it through the same resistor.'],
    script: [{ at: 0.5, part: sw, key: 'pos', value: 1 }],
    checks: [
      { at: 0.45, node: 'b1:c15', quantity: 'v', max: 0.01 },
      { at: 1.5, node: 'b1:c15', quantity: 'v', value: 5 * (1 - Math.exp(-1)), tol: 0.02 },
      { at: 3.5, node: 'b1:c15', quantity: 'v', value: 5 * (1 - Math.exp(-3)), tol: 0.02 },
      { at: 3.5, probe: sc, quantity: 'vmax:ch1', value: 5 * (1 - Math.exp(-3)), tol: 0.02, win: 0.5 },
    ],
  };
});

// ---------------------------------------------------------------- 7
def('night-light', (B) => {
  B.board();
  B.supply(5, 0.5, ...PSU);
  B.part('res', 'b1:b10', { r: 10000 }, { label: 'R1 10k' });
  B.wire(B.rail('b1', 'TP', 10), 'b1:a10', 'red');
  const ldr = B.part('ldr', 'b1:c14', { lux: 300 }, { label: 'LDR' });
  B.wire('b1:a16', B.rail('b1', 'TN', 16), 'black');
  B.part('res', 'b1:d14', { r: 4700 }, { label: 'Rb 4.7k' });
  B.part('npn-2n3904', 'b1:e17', {}, { label: 'Q1' });
  B.wire('b1:a17', B.rail('b1', 'TN', 17), 'black');
  const d = B.part('led', 'b1:c20', { color: 'white' }, { rot: 2, label: 'D1' });
  B.part('res', 'b1:b20', { r: 100 }, { label: 'R2' });
  B.wire('b1:a24', B.rail('b1', 'TP', 24), 'red');
  return {
    title: 'Night light', level: 1,
    blurb: 'A light sensor and a resistor divide 5 V; in the dark the divider turns on an NPN transistor and a white LED.',
    see: ['In room light (300 lx) the LED is off.', 'Drag the LDR light slider down to 1 lx: the base voltage rises, the transistor turns on and the LED lights.'],
    script: [{ at: 0.5, part: ldr, key: 'lux', value: 1 }],
    checks: [
      { at: 0.4, part: d, quantity: 'i', max: 1e-4 },
      { at: 1.0, part: d, quantity: 'i', min: 0.012 },
    ],
  };
});

// ---------------------------------------------------------------- 8
def('transistor-motor', (B) => {
  B.board();
  B.supply(5, 2, ...PSU);
  B.bridge();
  const sw = B.part('switch-slide', 'b1:c10', { pos: 0 }, { label: 'S1' });
  B.wire('b1:a10', B.rail('b1', 'TN', 10), 'black');
  B.wire('b1:a12', B.rail('b1', 'TP', 12), 'red');
  B.part('res', 'b1:d11', { r: 470 }, { label: 'Rb 470' });
  B.part('npn-2n2222', 'b1:e14', {}, { label: 'Q1' });
  B.wire('b1:a14', B.rail('b1', 'TN', 14), 'black');
  const mot = B.free('motor-dc', 40, 52, {}, { label: 'M1' });
  B.wire('b1:b16', mot + '.B', 'blue', 'arch');
  B.wire(B.rail('b1', 'BP', 30), mot + '.A', 'red', 'arch');
  B.part('diode-1n4007', 'b1:c16', {}, { label: 'D1 flyback' });
  B.wire('b1:a20', B.rail('b1', 'TP', 20), 'red');
  const sc = B.probe('scope', 90, -48, { ch1: 'b1:d16', gnd: B.rail('b1', 'TN', 40) }, { tdiv: 2e-4, vdiv: [2, 1, 1, 1], offset: [-2.5, 0, 0, 0], trig: { ch: 1, level: 4, edge: 'rise', mode: 'normal' } });
  return {
    title: 'Transistor motor switch', level: 2,
    blurb: 'An NPN transistor switches a DC motor from a slide switch. A diode across the motor catches the spike when it turns off.',
    see: ['Slide the switch: the motor spins up.', 'Slide it back: the scope shows the collector rise to about 5.7 V, held by the diode.', 'Delete the diode and switch off again: the collector spikes far above the supply.'],
    script: [{ at: 0.3, part: sw, key: 'pos', value: 1 }, { at: 1.5, part: sw, key: 'pos', value: 0 }],
    checks: [
      { at: 0.25, part: mot, quantity: 'vis.omega', max: 1 },
      { at: 1.45, part: mot, quantity: 'vis.omega', min: 300 },
      { at: 1.45, node: 'b1:d16', quantity: 'v', max: 1.0 },
      { at: 1.55, probe: sc, quantity: 'vmax:ch1', max: 6.2, min: 5.2, win: 0.05 },
      { at: 1.9, part: mot, quantity: 'vis.omega', max: 900 },
    ],
  };
});

// 555 at f20 (pins 1-4 in row f, cols 20-23; pins 8-5 in row e): power, reset
// and the TRIG-THRES jumper, the common start of three examples
function timer555(B, col = 20) {
  const u = B.part('ic-555', `b1:f${col}`, {}, { label: 'U1 555' });
  B.wire(B.rail('b1', 'TP', col), `b1:a${col}`, 'red');
  B.wire(`b1:j${col}`, B.rail('b1', 'BN', col), 'black');
  B.wire(`b1:j${col + 3}`, B.rail('b1', 'BP', col + 3), 'red');
  B.wire(`b1:g${col + 1}`, `b1:d${col + 2}`, 'yellow');
  return u;
}

// ---------------------------------------------------------------- 9
def('blink-555', (B) => {
  B.board();
  B.supply(5, 0.5, ...PSU);
  B.bridge();
  timer555(B, 20);
  B.part('res', 'b1:b21', { r: 1000 }, { rot: 2, label: 'R1 1k' });
  B.wire('b1:a17', B.rail('b1', 'TP', 17), 'red');
  B.part('res', 'b1:c21', { r: 51000 }, { label: 'R2 51k' });
  B.wire('b1:d25', 'b1:c22', 'yellow');
  B.part('cap-elec', 'b1:h21', { c: 10e-6, vmax: 16 }, { rot: 2, label: 'C 10µ' });
  B.part('res', 'b1:i22', { r: 220 }, { label: 'R3' });
  const d1 = B.part('led', 'b1:h26', { color: 'red' }, { label: 'D1' });
  B.wire('b1:j27', B.rail('b1', 'BN', 27), 'black');
  B.part('res', 'b1:j22', { r: 220 }, { rot: 2, label: 'R4' });
  const d2 = B.part('led', 'b1:g17', { color: 'green' }, { label: 'D2' });
  B.wire('b1:i17', B.rail('b1', 'BP', 17), 'red');
  const sc = B.probe('scope', ...SCOPE, { ch1: 'b1:j21', ch2: 'b1:g22', gnd: B.rail('b1', 'BN', 40) }, { tdiv: 0.2, vdiv: [1, 2, 1, 1], offset: [-2.5, -2.5, 0, 0], trig: { ch: 2, level: 2.5, edge: 'rise', mode: 'auto' } });
  const f = 1.44 / ((1000 + 2 * 51000) * 10e-6);
  return {
    title: '555 blinker', level: 2,
    blurb: 'A 555 timer in astable mode: 1 kΩ, 51 kΩ and 10 µF make about 1.4 Hz. Two LEDs take turns.',
    see: [`The red and green LEDs swap about ${f.toFixed(1)} times a second.`, 'Scope channel 1 shows the capacitor ramp between 1/3 and 2/3 of 5 V (1.67 V and 3.33 V).', 'Channel 2 shows the square output; change R2 or C to change the rate.'],
    checks: [
      { at: 4.0, probe: sc, quantity: 'freq:ch2', value: f, tol: 0.08, win: 2.6 },
      { at: 4.0, probe: sc, quantity: 'vmax:ch1', value: 5 * 2 / 3, tol: 0.05, win: 2.6 },
      { at: 4.0, probe: sc, quantity: 'vmin:ch1', value: 5 / 3, tol: 0.05, win: 2.6 },
      { at: 4.0, part: d1, quantity: 'i', agg: 'max', win: 3, min: 0.005 },
      { at: 4.0, part: d2, quantity: 'i', agg: 'max', win: 3, min: 0.005 },
      { at: 4.0, part: d1, quantity: 'i', agg: 'min', win: 3, max: 1e-4 },
    ],
  };
});

// ---------------------------------------------------------------- 10
def('tone-555', (B) => {
  B.board();
  B.supply(5, 0.5, ...PSU);
  B.bridge();
  B.block('b1', ['TP', 'TN'], 29, 35);
  timer555(B, 20);
  B.part('res', 'b1:c21', { r: 1000 }, { rot: 2, label: 'R1 1k' });
  B.wire('b1:a17', B.rail('b1', 'TP', 17), 'red');
  B.part('res', 'b1:b21', { r: 1000 }, { label: 'R2 1k' });
  const pot = B.part('pot', 'b1:a30', { r: 10000, pos: 0.5 }, { label: 'Pitch' });
  B.wire('b1:c25', 'b1:b30', 'yellow');
  B.wire('b1:c32', 'b1:c22', 'yellow');
  B.part('cap-ceramic', 'b1:h21', { c: 100e-9 }, { rot: 2, label: 'C 100n' });
  B.wire('b1:j19', B.rail('b1', 'BN', 19), 'black');
  B.part('res', 'b1:g22', { r: 100 }, { label: 'R3 100' });
  const bz = B.part('buzzer-passive', 'b1:j26', {}, { label: 'BZ1' });
  B.wire('b1:f29', B.rail('b1', 'BN', 29), 'black');
  const f = pos => 1.44 / ((1000 + 2 * (1000 + pos * 10000)) * 100e-9);
  return {
    title: '555 tone generator', level: 2,
    blurb: 'The 555 runs at audio rate and drives a passive buzzer. A pot in the timing chain sets the pitch.',
    see: [`A tone of about ${Math.round(f(0.5))} Hz plays (press run and unmute).`, 'Turn the pot down and the pitch rises: f = 1.44 / ((R1 + 2·R2) · C).', `At 20 % travel it is about ${Math.round(f(0.2))} Hz.`],
    script: [{ at: 0.3, part: pot, key: 'pos', value: 0.2 }],
    checks: [
      { at: 0.25, part: bz, quantity: 'vis.freq', value: f(0.5), tol: 0.05 },
      { at: 0.6, part: bz, quantity: 'vis.freq', value: f(0.2), tol: 0.05 },
    ],
  };
});

// ---------------------------------------------------------------- 11
def('zener-reg', (B) => {
  B.board();
  B.supply(9, 0.5, ...PSU);
  B.part('res', 'b1:b10', { r: 220 }, { label: 'R1 220' });
  B.wire(B.rail('b1', 'TP', 10), 'b1:a10', 'red');
  B.part('zener', 'b1:c18', { vz: 5.1 }, { rot: 2, label: 'Z1 5.1 V' });
  const load = B.part('res', 'b1:d14', { r: 1000 }, { label: 'Load' });
  B.wire('b1:a18', B.rail('b1', 'TN', 18), 'black');
  const m = B.probe('dmm', ...DMM_R, { red: 'b1:e14', black: 'b1:e18' }, { mode: 'V', range: 'auto' });
  return {
    title: 'Zener regulator', level: 2,
    blurb: 'A 5.1 V zener and a 220 Ω resistor hold a load at about 5.1 V from 9 V.',
    see: ['The meter reads about 5.1 V across the load.', 'Change the load from 1 kΩ to 470 Ω: the zener current falls, the voltage hardly moves.', 'Try 100 Ω: the zener runs out of current and the voltage drops.'],
    script: [{ at: 0.5, part: load, key: 'r', value: 470 }],
    checks: [
      { at: 0.4, probe: m, quantity: 'value', value: 5.1, tol: 0.03 },
      { at: 0.9, probe: m, quantity: 'value', value: 5.1, tol: 0.03 },
    ],
  };
});

// ---------------------------------------------------------------- 12
def('reg-7805', (B) => {
  B.board();
  const bat = B.free('battery-9v', -105, 12, { soc: 1 }, { label: '9 V' });
  B.wire(bat + '.+', 'b1:TP2', 'red', 'arch');
  B.wire(bat + '.−', 'b1:TN2', 'black', 'arch');
  B.wire('b1:TN50', 'b1:BN50', 'black', 'arch');
  B.part('reg-7805', 'b1:c20', {}, { label: 'U1 7805' });
  B.wire('b1:a20', B.rail('b1', 'TP', 20), 'red');
  B.wire('b1:a21', B.rail('b1', 'TN', 21), 'black');
  B.part('cap-ceramic', 'b1:b20', { c: 330e-9 }, { rot: 2, label: 'C in' });
  B.wire('b1:a18', B.rail('b1', 'TN', 18), 'black');
  B.wire('b1:d22', B.rail('b1', 'BP', 22), 'orange');
  B.part('cap-elec', 'b1:f30', { c: 10e-6, vmax: 16 }, { label: 'C out' });
  B.wire('b1:j30', B.rail('b1', 'BP', 30), 'red');
  B.wire('b1:j31', B.rail('b1', 'BN', 31), 'black');
  const u1 = ledUnit(B, { X: 36, top: false, color: 'red', r: 330, from: B.rail('b1', 'BP', 34), wire: 'red', label: 'D1' });
  const u2 = ledUnit(B, { X: 44, top: false, color: 'green', r: 330, from: B.rail('b1', 'BP', 42), wire: 'red', label: 'D2' });
  const m = B.probe('dmm', ...DMM_R, { red: B.rail('b1', 'BP', 56), black: B.rail('b1', 'BN', 56) }, { mode: 'V', range: 'auto' });
  void u1; void u2;
  return {
    title: '7805 regulator', level: 2,
    blurb: 'A 9 V battery through a 7805 linear regulator gives a steady 5 V rail for two LEDs.',
    see: ['The meter on the output rail reads 5.00 V.', 'The battery charge falls slowly while it runs (see the inspector).', 'Set the battery charge to 0: its voltage sags to about 6 V, below the 7 V the 7805 needs, and the output drops out.'],
    script: [{ at: 0.5, part: bat, key: 'soc', value: 0 }],
    checks: [
      { at: 0.4, probe: m, quantity: 'value', value: 5.0, tol: 0.015 },
      { at: 0.4, part: bat, quantity: 'vis.v', value: 9, tol: 0.03 },
      { at: 1.0, probe: m, quantity: 'value', max: 4.8, min: 3 },
    ],
  };
});

// ---------------------------------------------------------------- 13
def('opamp-amp', (B) => {
  B.board();
  B.supply(9, 0.5, ...PSU);
  B.bridge();
  B.part('ic-lm358', 'b1:f20', {}, { label: 'U1 LM358' });
  B.wire(B.rail('b1', 'TP', 20), 'b1:a20', 'red');
  B.wire('b1:a23', B.rail('b1', 'TN', 23), 'black');
  B.wire('b1:b22', 'b1:b21', 'yellow', 'flat');
  B.wire('b1:j23', B.rail('b1', 'BN', 23), 'black');
  const fg = B.free('funcgen', -120, 92, { wave: 'sine', freq: 1000, amp: 0.1, offset: 2.5 }, { label: 'GEN' });
  B.wire(fg + '.OUT', 'b1:j22', 'yellow', 'arch');
  B.wire(fg + '.COM', B.rail('b1', 'BN', 10), 'black', 'arch');
  B.part('res', 'b1:h21', { r: 10000 }, { label: 'Rf 10k' });
  B.wire('b1:i25', 'b1:i20', 'blue');
  B.part('res', 'b1:g21', { r: 1000 }, { rot: 2, label: 'Rg 1k' });
  B.part('cap-elec', 'b1:h17', { c: 10e-6, vmax: 16 }, { rot: 2, label: 'C 10µ' });
  B.wire('b1:j16', B.rail('b1', 'BN', 16), 'black');
  const sc = B.probe('scope', 70, -48, { ch1: 'b1:g22', ch2: 'b1:j20', gnd: B.rail('b1', 'BN', 34) }, { tdiv: 0.5e-3, vdiv: [0.1, 0.5, 1, 1], offset: [-2.5, -2.5, 0, 0], trig: { ch: 1, level: 2.5, edge: 'rise', mode: 'auto' } });
  return {
    title: 'Op-amp amplifier, gain 11', level: 2,
    blurb: 'An LM358 as a non-inverting amplifier on one 9 V supply: Rf 10 kΩ over Rg 1 kΩ gives a gain of 11.',
    see: ['Channel 1: 0.2 V peak to peak in. Channel 2: 2.2 V peak to peak out, in phase.', 'The 10 µF capacitor keeps the DC gain at 1, so the output sits at the 2.5 V input level.', 'Raise the generator amplitude past about 0.4 V: the output flattens at the LM358 rails.'],
    checks: [
      { at: 0.2, probe: sc, quantity: 'vpp:ch1', value: 0.2, tol: 0.06, win: 0.01 },
      { at: 0.2, probe: sc, quantity: 'vpp:ch2', value: 2.2, tol: 0.06, win: 0.01 },
      { at: 0.2, probe: sc, quantity: 'gain:ch2/ch1', value: 11, tol: 0.04, win: 0.01 },
      { at: 0.2, probe: sc, quantity: 'vavg:ch2', value: 2.5, tol: 0.04, win: 0.01 },
    ],
  };
});

// ---------------------------------------------------------------- 14
def('rc-lowpass', (B) => {
  B.board();
  const fc = 1 / (2 * Math.PI * 1000 * 100e-9);
  const fg = B.free('funcgen', ...PSU, { wave: 'sine', freq: +fc.toFixed(1), amp: 1, offset: 0 }, { label: 'GEN' });
  B.wire(fg + '.OUT', 'b1:a20', 'yellow', 'arch');
  B.wire(fg + '.COM', 'b1:TN2', 'black', 'arch');
  B.part('res', 'b1:b20', { r: 1000 }, { label: 'R 1k' });
  B.part('cap-ceramic', 'b1:c24', { c: 100e-9 }, { label: 'C 100n' });
  B.wire('b1:a26', B.rail('b1', 'TN', 26), 'black');
  const sc = B.probe('scope', ...SCOPE, { ch1: 'b1:c20', ch2: 'b1:d24', gnd: B.rail('b1', 'TN', 36) }, { tdiv: 0.2e-3, vdiv: [0.5, 0.5, 1, 1], offset: [0, 0, 0, 0], trig: { ch: 1, level: 0, edge: 'rise', mode: 'auto' } });
  return {
    title: 'RC low-pass filter', level: 2,
    blurb: `1 kΩ and 100 nF make a low-pass filter with a corner at fc = 1/(2πRC) ≈ ${Math.round(fc)} Hz. The generator sits right at fc.`,
    see: ['At fc the output (channel 2) is 0.707 of the input: −3 dB.', 'The output lags the input by 45°: a quarter of the way to the next peak is one eighth of a period.', 'Turn the frequency up ten times: the output falls to about 0.1 and the lag nears 90°.'],
    checks: [
      { at: 0.03, probe: sc, quantity: 'gain:ch2/ch1', value: Math.SQRT1_2, tol: 0.03, win: 0.006 },
      { at: 0.03, probe: sc, quantity: 'phase:ch2/ch1', value: -45, abs: 5, win: 0.006 },
    ],
  };
});

// ---------------------------------------------------------------- 15
def('thermostat', (B) => {
  B.board();
  B.supply(5, 2, ...PSU);
  B.bridge();
  B.part('ic-lm358', 'b1:f30', {}, { label: 'U1 LM358' });
  B.wire(B.rail('b1', 'TP', 30), 'b1:a30', 'red');
  B.wire('b1:a33', B.rail('b1', 'TN', 33), 'black');
  B.wire('b1:b32', 'b1:b31', 'yellow', 'flat');
  B.wire('b1:j33', B.rail('b1', 'BN', 33), 'black');
  const th = B.part('thermistor', 'b1:h32', { tempC: 25 }, { label: 'NTC' });
  B.wire('b1:j34', B.rail('b1', 'BP', 34), 'red');
  B.part('res', 'b1:i32', { r: 10000 }, { rot: 2, label: 'R1 10k' });
  B.wire('b1:j28', B.rail('b1', 'BN', 28), 'black');
  B.part('trimpot', 'b1:c40', { r: 10000, pos: 0.58 }, { label: 'Set point' });
  B.wire('b1:a40', B.rail('b1', 'TN', 40), 'black');
  B.wire('b1:a42', B.rail('b1', 'TP', 42), 'red');
  B.wire('b1:b41', 'b1:g31', 'yellow');
  B.part('res', 'b1:g30', { r: 1000 }, { rot: 2, label: 'Rb 1k' });
  B.part('npn-2n2222', 'b1:h25', {}, { label: 'Q1' });
  B.wire('b1:j25', B.rail('b1', 'BN', 25), 'black');
  B.part('diode-1n4007', 'b1:i27', {}, { rot: 2, label: 'D1' });
  B.wire('b1:j23', B.rail('b1', 'BP', 23), 'red');
  const mot = B.free('motor-dc', 40, 52, {}, { label: 'Fan' });
  B.wire('b1:j27', mot + '.B', 'blue', 'arch');
  B.wire(B.rail('b1', 'BP', 14), mot + '.A', 'red', 'arch');
  return {
    title: 'Thermostat fan', level: 3,
    blurb: 'A thermistor divider and a set-point trimmer feed an LM358 comparator. Above the set point it switches a fan through an NPN transistor.',
    see: ['At 25 °C the thermistor input (2.5 V) is below the 2.9 V set point: the fan is still.', 'Drag the thermistor temperature to 40 °C: the input passes the set point, the comparator output goes high and the fan spins.', 'Turn the set-point trimmer to change the switching temperature.'],
    script: [{ at: 0.3, part: th, key: 'tempC', value: 40 }],
    checks: [
      { at: 0.25, part: mot, quantity: 'vis.omega', max: 1 },
      { at: 2.0, part: mot, quantity: 'vis.omega', min: 200 },
    ],
  };
});

// ---------------------------------------------------------------- 16
def('logic-gates', (B) => {
  B.board();
  B.supply(5, 0.5, ...PSU);
  B.bridge();
  const chips = [['ic-74hc08', 10, 'U1 AND'], ['ic-74hc32', 30, 'U2 OR']];
  const leds = [];
  for (const [id, c, label] of chips) {
    B.part(id, `b1:f${c}`, {}, { label });
    B.wire(B.rail('b1', 'TP', c), `b1:a${c}`, 'red');
    for (const k of [1, 2, 4, 5]) B.wire(`b1:a${c + k}`, B.rail('b1', 'TN', c + k), 'black');      // 4B 4A 3B 3A low
    for (const k of [3, 4]) B.wire(`b1:j${c + k}`, B.rail('b1', 'BN', c + k), 'black');            // 2A 2B low
    B.wire(`b1:j${c + 6}`, B.rail('b1', 'BN', c + 6), 'black');                                     // GND
    B.part('res', `b1:h${c + 2}`, { r: 470 }, { rot: 2 });
    leds.push(B.part('led', `b1:i${c - 2}`, { color: c === 10 ? 'green' : 'blue' }, { rot: 2, label: c === 10 ? 'A AND B' : 'A OR B' }));
    B.wire(`b1:j${c - 3}`, B.rail('b1', 'BN', c - 3), 'black');
  }
  const swA = B.part('switch-slide', 'b1:c40', { pos: 0 }, { label: 'A' });
  const swB = B.part('switch-slide', 'b1:c46', { pos: 0 }, { label: 'B' });
  for (const c of [40, 46]) { B.wire(`b1:a${c}`, B.rail('b1', 'TN', c), 'black'); B.wire(`b1:a${c + 2}`, B.rail('b1', 'TP', c + 2), 'red'); }
  B.wire('b1:b41', 'b1:g10', 'yellow'); B.wire('b1:d41', 'b1:g30', 'yellow');
  B.wire('b1:b47', 'b1:g11', 'orange'); B.wire('b1:d47', 'b1:g31', 'orange');
  const la = B.probe('logic', ...LOGIC, { d0: 'b1:e41', d1: 'b1:e47', d2: 'b1:g12', d3: 'b1:g32', gnd: B.rail('b1', 'BN', 56) }, { threshold: 1.4, rate: 1e6 });
  const [and, or] = leds;
  const t = (at, a, o) => [
    { at, part: and, quantity: 'i', ...(a ? { min: 0.004 } : { max: 1e-4 }) },
    { at, part: or, quantity: 'i', ...(o ? { min: 0.004 } : { max: 1e-4 }) },
    { at, probe: la, quantity: 'level:d2', equals: a },
    { at, probe: la, quantity: 'level:d3', equals: o },
  ];
  return {
    title: 'AND and OR gates', level: 2,
    blurb: 'Two slide switches feed a 74HC08 (AND) and a 74HC32 (OR). The unused gate inputs are tied low, as they should be.',
    see: ['Flip A and B through 00, 10, 11, 01: the green LED (AND) lights only for 11; the blue LED (OR) for all but 00.', 'The logic analyzer draws A, B, AND and OR as four timing rows: a truth table in time.'],
    script: [{ at: 0.25, part: swA, key: 'pos', value: 1 }, { at: 0.5, part: swB, key: 'pos', value: 1 }, { at: 0.75, part: swA, key: 'pos', value: 0 }],
    checks: [...t(0.2, 0, 0), ...t(0.45, 0, 1), ...t(0.7, 1, 1), ...t(0.95, 0, 1)],
  };
});

// ---------------------------------------------------------------- 17
def('chaser-4017', (B) => {
  B.board();
  B.supply(5, 0.5, -60, -42, 'b1:TP20', 'b1:TN20');
  B.bridge();
  // 555 clock at f4
  B.part('ic-555', 'b1:f4', {}, { label: 'U1 555' });
  B.wire(B.rail('b1', 'TP', 4), 'b1:a4', 'red');
  B.wire('b1:j4', B.rail('b1', 'BN', 4), 'black');
  B.wire('b1:j7', B.rail('b1', 'BP', 7), 'red');
  B.wire('b1:g5', 'b1:d6', 'yellow');
  B.part('res', 'b1:b5', { r: 1000 }, { rot: 2, label: 'R1 1k' });
  B.wire('b1:a1', B.rail('b1', 'TP', 1), 'red');
  B.part('res', 'b1:c5', { r: 150000 }, { label: 'R2 150k' });
  B.wire('b1:d9', 'b1:c6', 'yellow');
  B.part('cap-ceramic', 'b1:h5', { c: 1e-6 }, { rot: 2, label: 'C 1µ' });
  B.wire('b1:j3', B.rail('b1', 'BN', 3), 'black');
  // CD4017 at f14
  B.part('ic-cd4017', 'b1:f14', {}, { label: 'U2 4017' });
  B.wire(B.rail('b1', 'TP', 14), 'b1:a14', 'red');
  B.wire('b1:a15', B.rail('b1', 'TN', 15), 'black');
  B.wire('b1:a17', B.rail('b1', 'TN', 17), 'black');
  B.wire('b1:j21', B.rail('b1', 'BN', 21), 'black');
  B.wire('b1:i6', 'b1:d16', 'orange');
  const Q = ['j16', 'j15', 'j17', 'j20', 'b20', 'j14', 'j18', 'j19', 'b21', 'b19'];
  const leds = [];
  for (let k = 0; k < 10; k++) {
    const a = 30 + 2 * k;
    leds.push(B.part('led', `b1:h${a}`, { color: k < 9 ? 'red' : 'yellow' }, { label: 'Q' + k }));
    B.wire('b1:' + Q[k], `b1:g${a}`, k % 2 ? 'blue' : 'green');
    B.wire(`b1:j${a + 1}`, B.rail('b1', 'BN', a + 1), 'black');
  }
  const la = B.probe('logic', ...LOGIC, { d0: 'b1:g6', d1: 'b1:g16', d2: 'b1:g15', d3: 'b1:g17', d4: 'b1:g20', gnd: B.rail('b1', 'BN', 60) }, { threshold: 1.4, rate: 1e6 });
  const f = 1.44 / ((1000 + 2 * 150000) * 1e-6);
  return {
    title: '4017 LED chaser', level: 3,
    blurb: `A 555 clock (about ${f.toFixed(1)} Hz) steps a CD4017 decade counter; ten LEDs light one after another.`,
    see: ['A single light runs along the ten LEDs and starts again.', 'The analyzer shows the clock on D0 and Q0 to Q3 on D1 to D4: each Q is high for one clock in ten.', 'The 4017 outputs are weak (about 400 Ω), which limits each LED to a few mA here; a real build adds a resistor.'],
    checks: [
      { at: 3.5, probe: la, quantity: 'freq:d0', value: f, tol: 0.1, win: 3 },
      { at: 3.5, probe: la, quantity: 'rises:d2', min: 1, win: 3.4 },
      { at: 3.5, part: leds[0], quantity: 'i', agg: 'max', win: 3.4, min: 0.003 },
      { at: 3.5, part: leds[5], quantity: 'i', agg: 'max', win: 3.4, min: 0.003 },
      { at: 3.5, part: leds[9], quantity: 'i', agg: 'max', win: 3.4, min: 0.003 },
    ],
  };
});

// ---------------------------------------------------------------- 18
def('flipflop-74', (B) => {
  B.board();
  B.supply(5, 0.5, ...PSU);
  B.bridge();
  B.part('ic-74hc74', 'b1:f20', {}, { label: 'U1 74HC74' });
  B.wire(B.rail('b1', 'TP', 20), 'b1:a20', 'red');
  B.wire('b1:j20', B.rail('b1', 'BP', 20), 'red');      // 1CLR high
  B.wire('b1:j23', B.rail('b1', 'BP', 23), 'red');      // 1PRE high
  B.wire('b1:h21', 'b1:h25', 'yellow');                 // 1D <- 1Q-bar
  B.wire('b1:a21', B.rail('b1', 'TP', 21), 'red');      // 2CLR high
  B.wire('b1:a22', B.rail('b1', 'TN', 22), 'black');    // 2D low
  B.wire('b1:a23', B.rail('b1', 'TN', 23), 'black');    // 2CLK low
  B.wire('b1:a24', B.rail('b1', 'TP', 24), 'red');      // 2PRE high
  B.wire('b1:j26', B.rail('b1', 'BN', 26), 'black');
  const btn = B.part('button-6mm', 'b1:f40', {}, { label: 'CLK' });
  B.wire(B.rail('b1', 'TP', 40), 'b1:a40', 'red');
  B.part('res', 'b1:j42', { r: 10000 }, { label: 'R pull-down' });
  B.wire('b1:h46', B.rail('b1', 'BN', 46), 'black');
  B.wire('b1:g42', 'b1:g22', 'orange');
  B.part('res', 'b1:i24', { r: 220 }, { label: 'R1' });
  const d = B.part('led', 'b1:h28', { color: 'red' }, { label: 'Q' });
  B.wire('b1:j29', B.rail('b1', 'BN', 29), 'black');
  const la = B.probe('logic', ...LOGIC, { d0: 'b1:h42', d1: 'b1:g24', gnd: B.rail('b1', 'BN', 56) }, { threshold: 2.5, rate: 1e6 });
  const press = (a, b) => [{ at: a, part: btn, key: 'pressed', value: true }, { at: b, part: btn, key: 'pressed', value: false }];
  return {
    title: 'D flip-flop divides by two', level: 2,
    blurb: 'A 74HC74 with its Q̅ output fed back to D toggles on each rising clock edge. The clock is a push button with a pull-down.',
    see: ['Click the button cap: the LED toggles on each press.', 'The analyzer shows the clock on D0 and Q on D1: Q has one edge per press, so it runs at half the clock rate.'],
    script: [...press(0.3, 0.5), ...press(0.8, 1.0), ...press(1.3, 1.5), ...press(1.8, 2.0)],
    checks: [
      { at: 0.6, part: d, quantity: 'i', min: 0.008 },
      { at: 1.1, part: d, quantity: 'i', max: 1e-4 },
      { at: 1.6, part: d, quantity: 'i', min: 0.008 },
      { at: 2.1, part: d, quantity: 'i', max: 1e-4 },
      { at: 2.2, probe: la, quantity: 'rises:d0', equals: 4, win: 2.1 },
      { at: 2.2, probe: la, quantity: 'rises:d1', equals: 2, win: 2.1 },
    ],
  };
});

// ---------------------------------------------------------------- 19
def('relay-lamp', (B) => {
  B.board();
  B.supply(5, 0.5, ...PSU);
  B.bridge();
  const sw = B.part('switch-slide', 'b1:c10', { pos: 0 }, { label: 'S1' });
  B.wire('b1:a10', B.rail('b1', 'TN', 10), 'black');
  B.wire('b1:a12', B.rail('b1', 'TP', 12), 'red');
  B.wire('b1:b11', 'b1:e17', 'yellow');
  B.part('res', 'b1:d21', { r: 1000 }, { rot: 2, label: 'Rb 1k' });
  B.part('npn-2n2222', 'b1:b20', {}, { label: 'Q1' });
  B.wire('b1:a20', B.rail('b1', 'TN', 20), 'black');
  B.part('diode-1n4148', 'b1:d22', {}, { label: 'D1' });
  B.wire('b1:a26', B.rail('b1', 'TP', 26), 'red');
  const rl = B.part('relay-5v', 'b1:f30', {}, { label: 'K1' });
  B.wire('b1:j30', B.rail('b1', 'BP', 30), 'red');
  B.wire('b1:b30', 'b1:c22', 'blue');
  const pack = B.free('battery-aa4', 128, 80, {}, { label: '6 V' });
  const lamp = B.free('lamp-6v', 60, 66, {}, { label: 'Lamp' });
  B.wire(pack + '.+', 'b1:j32', 'red', 'arch');
  B.wire('b1:j36', lamp + '.1', 'orange', 'arch');
  B.wire(lamp + '.2', B.rail('b1', 'BN', 45), 'black', 'arch');
  B.wire(pack + '.−', B.rail('b1', 'BN', 52), 'black', 'arch');
  return {
    title: 'Relay switches a lamp', level: 3,
    blurb: 'An NPN transistor drives a 5 V relay coil; the relay contacts switch a 6 V lamp on its own battery. A diode clamps the coil.',
    see: ['Slide the switch: the relay clicks and the lamp lights.', 'The lamp current flows only in the 6 V loop: the 5 V side never carries it.', 'Slide back: the relay drops out and the diode catches the coil spike.'],
    script: [{ at: 0.3, part: sw, key: 'pos', value: 1 }],
    checks: [
      { at: 0.25, part: lamp, quantity: 'i', max: 1e-3 },
      { at: 0.6, part: rl, quantity: 'vis.contact', equals: 'no' },
      { at: 1.2, part: lamp, quantity: 'i', min: 0.06 },
    ],
  };
});

// ---------------------------------------------------------------- 20
def('mosfet-pwm', (B) => {
  B.board();
  B.supply(5, 2, ...PSU);
  B.bridge();
  B.block('b1', ['TP', 'TN'], 29, 35);
  timer555(B, 20);
  B.part('res', 'b1:b21', { r: 1000 }, { rot: 2, label: 'R1 1k' });
  B.wire('b1:a17', B.rail('b1', 'TP', 17), 'red');
  const pot = B.part('pot', 'b1:a30', { r: 10000, pos: 0.3 }, { label: 'Duty' });
  B.wire('b1:c21', 'b1:b32', 'yellow');
  B.part('diode-1n4148', 'b1:c30', {}, { rot: 2, label: 'D1' });
  B.wire('b1:b26', 'b1:c22', 'yellow');
  B.part('diode-1n4148', 'b1:c38', {}, { rot: 2, label: 'D2' });
  B.wire('b1:b38', 'b1:b22', 'yellow');
  B.part('cap-ceramic', 'b1:h21', { c: 220e-9 }, { rot: 2, label: 'C 220n' });
  B.wire('b1:j19', B.rail('b1', 'BN', 19), 'black');
  B.part('res', 'b1:g22', { r: 100 }, { label: 'Rg 100' });
  B.part('nmos-logic-to220', 'b1:h26', {}, { label: 'Q1' });
  B.wire('b1:j28', B.rail('b1', 'BN', 28), 'black');
  B.part('diode-1n4007', 'b1:i27', {}, { rot: 2, label: 'D3' });
  const mot = B.free('motor-dc', 40, 52, {}, { label: 'M1' });
  B.wire('b1:j27', mot + '.B', 'blue', 'arch');
  B.wire(B.rail('b1', 'BP', 12), mot + '.A', 'red', 'arch');
  const sc = B.probe('scope', 90, -48, { ch1: 'b1:i22', ch2: 'b1:j21', gnd: B.rail('b1', 'BN', 44) }, { tdiv: 0.5e-3, vdiv: [2, 1, 1, 1], offset: [-2.5, -2.5, 0, 0], trig: { ch: 1, level: 2.5, edge: 'rise', mode: 'auto' } });
  return {
    title: 'PWM motor speed', level: 3,
    blurb: 'A 555 with two steering diodes makes PWM at a fixed rate; the pot sets the duty. A logic-level MOSFET switches the motor.',
    see: ['The scope shows the 555 output: a square wave whose high time follows the pot.', 'Turn the pot from 30 % to 80 %: the duty rises and the motor speeds up.', 'The diode across the motor carries its current between pulses.'],
    script: [{ at: 1.5, part: pot, key: 'pos', value: 0.8 }],
    checks: [
      { at: 1.4, probe: sc, quantity: 'duty:ch1', value: 0.36, abs: 0.07, win: 0.03 },
      { at: 3.2, probe: sc, quantity: 'duty:ch1', value: 0.8, abs: 0.07, win: 0.03 },
      { at: 1.4, part: mot, quantity: 'vis.omega', min: 100 },
      { at: 3.2, part: mot, quantity: 'vis.omega', min: 400 },
    ],
  };
});

// ---------------------------------------------------------------- 21
def('cc-limit', (B) => {
  B.board();
  const ps = B.supply(5, 0.1, ...PSU);
  B.wire('b1:TN50', 'b1:BN50', 'black', 'arch');
  B.part('res', 'b1:b10', { r: 220 }, { label: 'R1' });
  B.wire(B.rail('b1', 'TP', 10), 'b1:a10', 'red');
  const d = B.part('led', 'b1:c14', { color: 'green' }, { label: 'D1' });
  B.wire('b1:a15', B.rail('b1', 'TN', 15), 'black');
  const btn = B.part('button-12mm', 'b1:f40', { cap: 'red' }, { label: 'SHORT' });
  B.wire(B.rail('b1', 'TP', 40), 'b1:a40', 'red');
  B.wire('b1:j42', B.rail('b1', 'BN', 42), 'black');
  return {
    title: 'Current limit saves the day', level: 2,
    blurb: 'The bench supply is set to 5 V with a 100 mA limit. The red button shorts the rail to ground.',
    see: ['Hold the red button: the supply drops into CC mode, the CC lamp lights and the display reads 0.100 A at almost 0 V.', 'The LED goes dark, but nothing burns: the limit holds the current.', 'Let go: the rail comes back to 5 V.'],
    script: [{ at: 0.3, part: btn, key: 'pressed', value: true }, { at: 0.8, part: btn, key: 'pressed', value: false }],
    checks: [
      { at: 0.25, part: d, quantity: 'i', value: (5 - 2.2) / 220, tol: 0.1 },
      { at: 0.6, part: ps, quantity: 'vis.cc', equals: true },
      { at: 0.6, part: ps, quantity: 'vis.a', value: 0.1, tol: 0.05 },
      { at: 0.6, part: d, quantity: 'i', max: 1e-4 },
      { at: 1.1, part: ps, quantity: 'vis.cc', equals: false },
      { at: 1.1, part: d, quantity: 'i', value: (5 - 2.2) / 220, tol: 0.1 },
      { at: 1.1, event: 'cc' },
      { at: 1.1, noEvent: 'damage' },
    ],
  };
});

// ---------------------------------------------------------------- 22
def('reverse-cap', (B) => {
  B.board();
  const bat = B.free('battery-9v', -105, 12, {}, { label: '9 V' });
  B.wire(bat + '.+', 'b1:TP2', 'red', 'arch');
  B.wire(bat + '.−', 'b1:TN2', 'black', 'arch');
  const c = B.part('cap-elec', 'b1:c20', { c: 100e-6, vmax: 16 }, { label: 'C1 (reversed)' });
  B.wire('b1:a20', B.rail('b1', 'TN', 20), 'black');
  B.wire('b1:a21', B.rail('b1', 'TP', 21), 'red');
  return {
    title: 'Reversed electrolytic', level: 2,
    blurb: 'A 100 µF electrolytic in backwards: its + lead on ground, its − lead (the stripe) on 9 V.',
    see: ['For a moment nothing happens.', 'Then the capacitor vents: smoke, a burst top, and a toast that says it was reversed.', 'Electrolytics have a + and a − lead: the stripe marks −.'],
    checks: [
      { at: 1.0, event: 'damage', owner: c },
      { at: 1.2, part: c, quantity: 'damaged', equals: 'vented' },
    ],
  };
});

// The 328 board on the mat, left of an 830 board centred at x = 40.
function unoBench(B, key) {
  B.board('bb830', 40, 0);
  const u = B.free('mcu-uno', ...UNO, {}, { label: 'MCU' });
  B.program(u, SKETCHES[key].source);
  return u;
}

// ---------------------------------------------------------------- 23
def('uno-blink', (B) => {
  const u = unoBench(B, 'uno-blink');
  B.wire(u + '.D13', 'b1:a20', 'yellow', 'arch');
  B.part('res', 'b1:b20', { r: 220 }, { label: 'R1' });
  const d = B.part('led', 'b1:c24', { color: 'red' }, { label: 'D1' });
  B.wire('b1:a25', B.rail('b1', 'TN', 25), 'black');
  B.wire(u + '.GND.1', B.rail('b1', 'TN', 8), 'black', 'arch');
  return {
    title: 'Blink', level: 1,
    blurb: 'The first sketch: pin 13 drives an LED through 220 Ω, half a second on, half a second off.',
    see: ['The red LED and the on-board L LED blink together at 1 Hz.', 'Open CODE to read the sketch; change delay(500) to delay(100) and compile: it blinks faster.'],
    checks: [
      { at: 0.25, part: d, quantity: 'i', min: 0.01 },
      { at: 0.75, part: d, quantity: 'i', max: 1e-4 },
      { at: 1.25, part: d, quantity: 'i', min: 0.01 },
      { at: 1.75, part: d, quantity: 'i', max: 1e-4 },
      { at: 1.25, part: u, quantity: 'vis.leds.L', min: 0.05 },
    ],
  };
});

// ---------------------------------------------------------------- 24
def('uno-button-serial', (B) => {
  const u = unoBench(B, 'uno-button-serial');
  const btn = B.part('button-6mm', 'b1:f20', {}, { label: 'S1' });
  B.wire(u + '.D2', 'b1:j20', 'yellow', 'arch');
  B.wire('b1:a22', B.rail('b1', 'TN', 22), 'black');
  B.wire(u + '.GND.1', B.rail('b1', 'TN', 8), 'black', 'arch');
  const press = (a, b) => [{ at: a, part: btn, key: 'pressed', value: true }, { at: b, part: btn, key: 'pressed', value: false }];
  return {
    title: 'Button and serial monitor', level: 2,
    blurb: 'A button on pin 2 with the internal pull-up (INPUT_PULLUP), a 30 ms debounce in code, and a count on Serial.',
    see: ['Open CODE and the serial monitor: "Ready" prints at start.', 'Each click of the button prints "Press 1", "Press 2" and so on; the L LED shows the button state.', 'No resistor is needed: the pin pulls itself up to 5 V and the button pulls it to ground.'],
    script: [...press(0.3, 0.5), ...press(0.8, 1.0)],
    checks: [
      { at: 0.2, serial: u, match: 'Ready' },
      { at: 0.45, part: u, quantity: 'vis.leds.L', min: 0.05 },
      { at: 0.6, serial: u, match: 'Press 1' },
      { at: 1.2, serial: u, match: 'Press 2' },
    ],
  };
});

// ---------------------------------------------------------------- 25
def('uno-fade-pot', (B) => {
  const u = unoBench(B, 'uno-fade-pot');
  B.block('b1', ['TP', 'TN'], 19, 25);
  const pot = B.part('pot', 'b1:a20', { r: 10000, pos: 0.25 }, { label: 'Pot' });
  B.wire(u + '.GND.1', 'b1:b20', 'black', 'arch');
  B.wire(u + '.5V', 'b1:b24', 'red', 'arch');
  B.wire(u + '.A0', 'b1:b22', 'green', 'arch');
  const L = ledUnit(B, { X: 40, top: true, color: 'blue', r: 220, label: 'D1' });
  B.wire(u + '.D9', L.input, 'yellow', 'arch');
  B.wire(u + '.GND.2', B.rail('b1', 'TN', 50), 'black', 'arch');
  return {
    title: 'Pot fades an LED', level: 2,
    blurb: 'analogRead on A0 reads the pot (0 to 1023); analogWrite on pin 9 sets the LED brightness by PWM.',
    see: ['Turn the pot: the LED brightness follows it.', 'Open the serial plotter: the line follows the reading.', 'A logic analyzer on pin 9 would show 490 Hz pulses whose width follows the pot.'],
    script: [{ at: 0.6, part: pot, key: 'pos', value: 0.75 }],
    checks: [
      { at: 0.5, part: L.led, quantity: 'vis.b', min: 0.07, max: 0.16 },
      { at: 1.0, part: L.led, quantity: 'vis.b', min: 0.26, max: 0.4 },
      { at: 0.5, serial: u, match: '\\d' },
    ],
  };
});

// ---------------------------------------------------------------- 26
def('uno-595', (B) => {
  const u = unoBench(B, 'uno-595');
  B.bridge();
  B.part('ic-74hc595', 'b1:f20', {}, { label: 'U1 595' });
  B.wire(u + '.5V', B.rail('b1', 'TP', 10), 'red', 'arch');
  B.wire(u + '.GND.1', B.rail('b1', 'TN', 10), 'black', 'arch');
  B.wire(B.rail('b1', 'TP', 20), 'b1:a20', 'red');
  B.wire('b1:j27', B.rail('b1', 'BN', 27), 'black');
  B.wire('b1:a23', B.rail('b1', 'TN', 23), 'black');      // OE low
  B.wire('b1:a26', B.rail('b1', 'TP', 26), 'red');        // SRCLR high
  B.wire(u + '.D11', 'b1:b22', 'yellow', 'arch');
  B.wire(u + '.D12', 'b1:b25', 'green', 'arch');
  B.wire(u + '.D8', 'b1:b24', 'blue', 'arch');
  const src = ['d21', 'h20', 'h21', 'h22', 'h23', 'h24', 'h25', 'h26'];
  const leds = [];
  src.forEach((s, k) => {
    const top = k < 4, X = 34 + 6 * (k % 4);
    const U = ledUnit(B, { X, top, color: 'red', r: 220, from: 'b1:' + s, wire: 'orange', label: 'Q' + 'ABCDEFGH'[k] });
    leds.push(U.led);
  });
  const la = B.probe('logic', ...LOGIC, { d0: 'b1:c22', d1: 'b1:c25', d2: 'b1:c24', gnd: B.rail('b1', 'BN', 60) }, { threshold: 2.5, rate: 1e6 });
  return {
    title: 'Shift register scanner', level: 3,
    blurb: 'Three pins drive eight LEDs through a 74HC595: shiftOut clocks a byte in, the latch shows it.',
    see: ['A single light sweeps back and forth across the eight LEDs.', 'The analyzer shows data (D0), the shift clock (D1, eight pulses per byte) and the latch (D2, once per step).'],
    checks: [
      ...leds.map(d => ({ at: 2.3, part: d, quantity: 'i', agg: 'max', win: 2.2, min: 0.008 })),
      { at: 2.3, probe: la, quantity: 'freq:d2', value: 1 / 0.1205, tol: 0.08, win: 2.0 },
      { at: 2.3, probe: la, quantity: 'rises:d1', min: 100, win: 2.0 },
    ],
  };
});

// ---------------------------------------------------------------- 27
def('uno-7seg', (B) => {
  const u = unoBench(B, 'uno-7seg');
  const seg = B.part('seg7-1', 'b1:g40', { common: 'cathode', color: 'red' }, { label: 'DIGIT' });
  const R = (hole, rot, to, pin, color) => { B.part('res', 'b1:' + hole, { r: 220 }, { rot, label: 'R ' + pin }); B.wire(u + '.' + to, 'b1:' + color, 'yellow', 'arch'); };
  R('a43', 0, 'D2', 'a', 'c47');
  R('b44', 0, 'D3', 'b', 'c48');
  R('i43', 0, 'D4', 'c', 'h47');
  R('i41', 2, 'D5', 'd', 'h37');
  R('j40', 2, 'D6', 'e', 'h36');
  R('a41', 2, 'D7', 'f', 'c37');
  R('b40', 2, 'D8', 'g', 'c36');
  B.wire('b1:h42', B.rail('b1', 'BN', 42), 'black');
  B.wire(u + '.GND.1', B.rail('b1', 'BN', 20), 'black', 'arch');
  const on = (at, s) => ({ at, part: seg, quantity: 'vis.leds.' + s, min: 0.4 });
  const off = (at, s) => ({ at, part: seg, quantity: 'vis.leds.' + s, max: 0.05 });
  return {
    title: '7-segment counter', level: 2,
    blurb: 'Seven pins light the seven segments of a common-cathode digit, each through its own 220 Ω resistor. The sketch counts 0 to 9.',
    see: ['The digit counts 0, 1, 2 … 9 and starts again, a step every 0.6 s.', 'Each segment is an LED: a table of bit patterns in the sketch says which ones light for each digit.'],
    checks: [on(0.3, 'a'), on(0.3, 'f'), off(0.3, 'g'), on(0.9, 'b'), on(0.9, 'c'), off(0.9, 'a'), on(1.5, 'g'), on(1.5, 'e'), off(1.5, 'c')],
  };
});

// ---------------------------------------------------------------- 28
def('uno-lcd-thermo', (B) => {
  const u = unoBench(B, 'uno-lcd-thermo');
  B.block('b1', ['TP', 'TN'], 6, 39);
  const lcd = B.part('lcd-1602', 'b1:a10', {}, { label: 'LCD' });
  B.wire(u + '.5V', B.rail('b1', 'BP', 6), 'red', 'arch');
  B.wire(u + '.GND.1', B.rail('b1', 'BN', 6), 'black', 'arch');
  B.wire('b1:e10', B.rail('b1', 'BN', 10), 'black');     // VSS
  B.wire('b1:e11', B.rail('b1', 'BP', 11), 'red');       // VDD
  B.wire('b1:e14', B.rail('b1', 'BN', 14), 'black');     // RW
  B.wire('b1:e24', B.rail('b1', 'BP', 24), 'red');       // backlight A
  B.wire('b1:e25', B.rail('b1', 'BN', 25), 'black');     // backlight K
  B.part('trimpot', 'b1:g40', { r: 10000, pos: 0.1 }, { label: 'Contrast' });
  B.wire('b1:j40', B.rail('b1', 'BN', 40), 'black');
  B.wire('b1:j42', B.rail('b1', 'BP', 42), 'red');
  B.wire('b1:h41', 'b1:d12', 'blue');
  for (const [pin, hole, c] of [['D12', 'd13', 'yellow'], ['D11', 'd15', 'green'], ['D5', 'd20', 'orange'], ['D4', 'd21', 'orange'], ['D3', 'd22', 'orange'], ['D2', 'd23', 'orange']]) B.wire(u + '.' + pin, 'b1:' + hole, c, 'arch');
  B.part('res', 'b1:g46', { r: 10000 }, { label: 'R 10k' });
  B.wire('b1:j46', B.rail('b1', 'BP', 46), 'red');
  const th = B.part('thermistor', 'b1:h50', { tempC: 23.4 }, { label: 'NTC' });
  B.wire('b1:j52', B.rail('b1', 'BN', 52), 'black');
  B.wire(u + '.A0', 'b1:i50', 'green', 'arch');
  return {
    title: 'LCD thermometer', level: 3,
    blurb: 'A 10 kΩ NTC thermistor divider on A0; the sketch turns the reading into °C and prints it on a 16 × 2 LCD in 4-bit mode.',
    see: ['The LCD shows "TEMP 23.4 C".', 'Drag the thermistor temperature: the reading follows within a second.', 'The contrast trimmer sets V0; turn it up and the text fades.'],
    script: [{ at: 1.0, part: th, key: 'tempC', value: 30 }],
    checks: [
      { at: 1.0, part: lcd, quantity: 'vis.rows.0', match: '^TEMP 23\\.[345] C' },
      { at: 1.6, part: lcd, quantity: 'vis.rows.0', match: '^TEMP (29\\.[89]|30\\.[01]) C' },
    ],
  };
});

// ---------------------------------------------------------------- 29
def('uno-melody', (B) => {
  const u = unoBench(B, 'uno-melody');
  B.wire(u + '.D8', 'b1:a20', 'yellow', 'arch');
  B.part('res', 'b1:b20', { r: 100 }, { label: 'R 100' });
  const bz = B.part('buzzer-passive', 'b1:e24', {}, { label: 'BZ1' });
  B.wire('b1:a27', B.rail('b1', 'TN', 27), 'black');
  B.wire(u + '.GND.1', B.rail('b1', 'TN', 8), 'black', 'arch');
  return {
    title: 'Melody with tone()', level: 2,
    blurb: 'tone() drives a passive buzzer through 100 Ω: an arpeggio C E G C, a rest, and a run up to C again.',
    see: ['Press run and unmute: the tune plays through the speakers, then repeats after a pause.', 'The inspector shows the buzzer frequency of each note: 262, 330, 392, 523 Hz …'],
    checks: [
      { at: 0.15, part: bz, quantity: 'vis.freq', value: 262, tol: 0.01 },
      { at: 0.45, part: bz, quantity: 'vis.freq', value: 330, tol: 0.01 },
      { at: 0.8, part: bz, quantity: 'vis.freq', value: 392, tol: 0.01 },
    ],
  };
});

// ---------------------------------------------------------------- 30
def('uno-servo', (B) => {
  const u = unoBench(B, 'uno-servo');
  B.block('b1', ['TP', 'TN'], 19, 25);
  const pot = B.part('pot', 'b1:a20', { r: 10000, pos: 0.2 }, { label: 'Pot' });
  B.wire(u + '.GND.1', 'b1:b20', 'black', 'arch');
  B.wire(u + '.5V', 'b1:b24', 'red', 'arch');
  B.wire(u + '.A0', 'b1:b22', 'green', 'arch');
  const sv = B.free('servo', 60, 64, {}, { label: 'Servo' });
  B.wire(u + '.D9', sv + '.SIG', 'yellow', 'arch');
  B.wire('b1:c24', sv + '.VCC', 'red', 'arch');
  B.wire('b1:c20', sv + '.GND', 'black', 'arch');
  return {
    title: 'Pot steers a servo', level: 2,
    blurb: 'The pot reading on A0 maps to 0–180°; the Servo library sends a 50 Hz pulse of 0.54–2.4 ms on pin 9.',
    see: ['Turn the pot: the servo horn follows it.', 'At 20 % travel the horn sits at about 36°, at 80 % about 144°.'],
    script: [{ at: 1.0, part: pot, key: 'pos', value: 0.8 }],
    checks: [
      { at: 1.0, part: sv, quantity: 'vis.angle', value: 36, abs: 3 },
      { at: 2.0, part: sv, quantity: 'vis.angle', value: 144, abs: 3 },
    ],
  };
});

// ---------------------------------------------------------------- 31
def('esp32-traffic', (B) => {
  B.board();
  const u = B.part('mcu-esp32', 'b1:b20', {}, { label: 'ESP32' });
  B.program(u, SKETCHES['esp32-traffic'].source);
  B.wire('b1:a33', B.rail('b1', 'TN', 33), 'black');
  const units = [['a27', 40, 'red'], ['a28', 46, 'yellow'], ['a29', 52, 'green']].map(([from, X, color]) => ledUnit(B, { X, top: true, color, r: 220, from: 'b1:' + from, wire: color === 'yellow' ? 'yellow' : color, label: color.toUpperCase() }));
  const m = B.probe('dmm', ...DMM_R, { red: 'b1:e40', black: B.rail('b1', 'TN', 58) }, { mode: 'V', range: 'auto' });
  const [r, y, g] = units.map(x => x.led);
  const lit = (at, part, on) => ({ at, part, quantity: 'i', ...(on ? { min: 0.003 } : { max: 1e-4 }) });
  return {
    title: 'ESP32 traffic light', level: 3,
    blurb: 'A 30-pin ESP32 devkit on 3.3 V logic runs a traffic light on GPIO 25, 26 and 27. Its rows sit in b and i, so a and j stay free for wires.',
    see: ['Red for 3 s, red and amber for 1 s, green for 3 s, amber for 1 s, then again.', 'The meter on GPIO 25 reads about 3.2 V when it is high: 3.3 V logic, not 5 V.', 'The serial monitor names each phase.'],
    checks: [
      lit(1.0, r, true), lit(1.0, y, false), lit(1.0, g, false),
      { at: 1.0, probe: m, quantity: 'value', min: 3.0, max: 3.35 },
      lit(3.5, r, true), lit(3.5, y, true),
      lit(5.0, r, false), lit(5.0, g, true),
      { at: 5.0, probe: m, quantity: 'value', max: 0.05 },
      { at: 5.0, serial: u, match: 'GREEN' },
    ],
  };
});

// ---------------------------------------------------------------- 32
def('nano-joystick', (B) => {
  B.board();
  const u = B.part('mcu-nano', 'b1:g10', {}, { label: 'NANO' });
  B.program(u, SKETCHES['nano-joystick'].source);
  B.block('b1', ['TP', 'TN'], 39, 45);
  const js = B.part('joystick', 'b1:a40', { x: 0.5, y: 0.5 }, { label: 'Stick' });
  B.wire('b1:b42', 'b1:b21', 'green');      // VRX -> A0
  B.wire('b1:b43', 'b1:b20', 'blue');       // VRY -> A1
  B.wire('b1:b44', 'b1:j14', 'yellow');     // SW -> D2
  B.wire('b1:b41', 'b1:b13', 'red');        // +5V -> 5V
  B.wire('b1:b40', 'b1:b11', 'black');      // GND -> GND.2
  B.wire('b1:j13', B.rail('b1', 'BN', 13), 'black');
  const X = ledUnit(B, { X: 48, top: false, color: 'green', r: 220, from: 'b1:j17', wire: 'green', label: 'LED X' });
  const Y = ledUnit(B, { X: 55, top: false, color: 'blue', r: 220, from: 'b1:j18', wire: 'blue', label: 'LED Y' });
  return {
    title: 'Joystick and PWM LEDs', level: 3,
    blurb: 'A Nano-layout board reads a two-axis joystick on A0 and A1 and sets two LEDs by PWM: brightness is the distance from centre.',
    see: ['At rest both LEDs are dark.', 'Push the stick along X: the green LED brightens, the blue one stays dark. Y works the same way.', 'Press the stick (SW): both LEDs go full on.'],
    script: [{ at: 0.4, part: js, key: 'x', value: 0.95 }, { at: 1.2, part: js, key: 'sw', value: true }],
    checks: [
      { at: 0.35, part: X.led, quantity: 'vis.b', max: 0.03 },
      { at: 0.35, part: Y.led, quantity: 'vis.b', max: 0.03 },
      { at: 1.0, part: X.led, quantity: 'vis.b', min: 0.4 },
      { at: 1.0, part: Y.led, quantity: 'vis.b', max: 0.03 },
      { at: 1.5, part: Y.led, quantity: 'vis.b', min: 0.35 },
    ],
  };
});

// ---------------------------------------------------------------- main
async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const only = args.find(a => !a.startsWith('--'));
  const { loadDeps } = await import('./verify.mjs');
  const deps = await loadDeps();
  let fail = 0;
  const index = [];
  for (const key of ORDER) {
    const B = createBench(deps, { title: key });
    const meta = EX[key](B);
    const doc = B.doc;
    doc.title = meta.title;
    doc.notes = meta.blurb;
    doc.nextId = 1 + Math.max(0, ...[...doc.boards, ...doc.parts, ...doc.wires, ...doc.probes].map(x => +String(x.id).replace(/\D/g, '')));
    const { problems, issues } = check(B, deps, meta.expectIssues || []);
    const full = { meta: { key, title: meta.title, level: meta.level, blurb: meta.blurb, see: meta.see, script: meta.script || [], checks: meta.checks || [], expectIssues: meta.expectIssues || [] }, doc };
    index.push({ key, title: meta.title, level: meta.level, blurb: meta.blurb, see: meta.see });
    if (only && key !== only) continue;
    const info = issues.filter(i => i.level === 'info').map(i => i.code);
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${key}: ${doc.parts.length} parts, ${doc.wires.length} wires, ${doc.probes.length} probes${info.length ? `; info: ${[...new Set(info)].join(',')}` : ''}`);
    for (const p of problems) console.log('       ' + p);
    if (problems.length) fail++;
    const text = JSON.stringify(full, null, 1) + '\n';
    const file = path.join(DIR, key + '.json');
    if (checkOnly) {
      const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (old !== text) { console.log(`       drift: ${key}.json differs from the build`); fail++; }
    } else if (!problems.length) fs.writeFileSync(file, text);
  }
  const idx = indexModule(index);
  const idxFile = path.join(DIR, 'index.js');
  if (!only) {
    if (checkOnly) { if ((fs.existsSync(idxFile) ? fs.readFileSync(idxFile, 'utf8') : '') !== idx) { console.log('drift: index.js differs from the build'); fail++; } }
    else fs.writeFileSync(idxFile, idx);
  }
  console.log(`${ORDER.length} examples, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

function indexModule(index) {
  return `// ============================================================================
//  BREADBOARD LAB  ·  examples/index.js — the example list (written by build.mjs)
// ----------------------------------------------------------------------------
//  Do not edit by hand: run node examples/build.mjs. EXAMPLES holds the meta
//  of each example in CONTRACT 5 order; load(key) fetches its JSON file.
//  ui.examples(list()) takes { meta, load } entries.
//
//  GREP MAP
//    EXAMPLES ........ key, title, level, blurb, see
//    exampleUrl ...... the JSON file of a key
//    loadExample ..... fetch and parse one example ({ meta, doc })
//    list ............ the entries for the EXAMPLES panel
// ============================================================================
export const EXAMPLES = ${JSON.stringify(index, null, 1)};

export const exampleUrl = key => new URL(\`./\${key}.json\`, import.meta.url).href;

export async function loadExample(key) {
  const r = await fetch(exampleUrl(key));
  if (!r.ok) throw new Error(\`example \${key}: HTTP \${r.status}\`);
  return r.json();
}

export const list = () => EXAMPLES.map(meta => ({ meta, load: () => loadExample(meta.key) }));
`;
}

export { EX, ORDER, SKETCHES };
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
