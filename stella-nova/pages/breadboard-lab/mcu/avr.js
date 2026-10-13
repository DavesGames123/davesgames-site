// ============================================================================
//  BREADBOARD LAB  ·  mcu/avr.js — a real ATmega328P for .hex programs
// ----------------------------------------------------------------------------
//  The second MCU path of CONTRACT 6: a user can load a .hex file built
//  elsewhere (for example the Arduino IDE's "Export compiled binary") onto
//  a 328 board. The CPU is avr8js 0.21.1 (MIT, vendored in
//  stella-nova/vendor/avr8js@0.21.1, see VENDORED.txt there). This file
//  puts it on the sim clock behind the createMcu interface of runtime.js.
//
//  TIME. 16 MHz: MCU time = t0 + cycles / 16e6. run(t, io) executes
//  instructions until the MCU is LEAD (1 ms) ahead of t, or until a pin
//  output changes. A change at an MCU time later than t is held back and
//  applied at the start of the next run, when the sim has reached that
//  time, so every edge lands at its own sim time (the same rule as the
//  sketch runtime's output sync). Timer PWM makes real edges on OC0A/B,
//  OC1A/B and OC2A/B.
//
//  INPUTS. At the start of each run every input pin reads io.read(pin)
//  against the AVR thresholds (0.6 / 0.3 Vcc, with hysteresis) and goes
//  into the port with setPin, so INT0/INT1 and pin-change interrupts work.
//  pinChanged() sets a pin at once. The ADC reads io.read on A0..A7 with
//  AVcc = io.vdd().
//
//  SERIAL. USART0 transmit -> io.serial; serialIn queues bytes that enter
//  the receiver one at a time when it is free.
//
//  GREP MAP
//    parseHex ............ Intel HEX -> flash bytes (types 00 01 02 04)
//    PORT_PINS ........... port bit -> pin name on the 328 boards
//    createAvrMcu ........ the MCU object (reset, run, nextWake, …)
//    build ............... CPU and peripherals from the flash image
//    syncInputs .......... voltages -> port pins and ADC channels
// ============================================================================
import {
  CPU, avrInstruction, AVRIOPort, portBConfig, portCConfig, portDConfig, PinState,
  AVRTimer, timer0Config, timer1Config, timer2Config, AVRUSART, usart0Config, AVRADC, adcConfig
} from '../../../vendor/avr8js@0.21.1/index.js';
import { BOARDS } from './boards.js';

export const F_CPU = 16e6;
export const AVR_LEAD = 1e-3;
const FLASH = 32768;

export function parseHex(text) {
  const bytes = new Uint8Array(FLASH);
  bytes.fill(0xff);
  let base = 0, max = 0, eof = false;
  const lines = String(text).split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || eof) return;
    if (line[0] !== ':') throw new Error(`HEX line ${i + 1}: a record starts with ':'`);
    if (!/^:[0-9a-fA-F]+$/.test(line) || line.length % 2 !== 1) throw new Error(`HEX line ${i + 1}: not hexadecimal`);
    const b = [];
    for (let k = 1; k < line.length; k += 2) b.push(parseInt(line.slice(k, k + 2), 16));
    const n = b[0];
    if (b.length !== n + 5) throw new Error(`HEX line ${i + 1}: the length does not match`);
    const sum = b.reduce((s, x) => s + x, 0) & 255;
    if (sum !== 0) throw new Error(`HEX line ${i + 1}: bad checksum`);
    const addr = (b[1] << 8) | b[2], type = b[3], data = b.slice(4, 4 + n);
    if (type === 0) {
      for (let k = 0; k < n; k++) {
        const a = base + addr + k;
        if (a >= FLASH) throw new Error(`HEX line ${i + 1}: address 0x${a.toString(16)} is past the 32 KB flash`);
        bytes[a] = data[k]; max = Math.max(max, a + 1);
      }
    } else if (type === 1) eof = true;
    else if (type === 2) base = ((data[0] << 8) | data[1]) * 16;
    else if (type === 4) base = ((data[0] << 8) | data[1]) << 16;
  });
  if (!max) throw new Error('HEX: the file holds no program bytes');
  return { bytes, size: max };
}

// port bit -> pin name (Uno and Nano layouts share the 328P port map)
const PORT_PINS = {
  B: ['D8', 'D9', 'D10', 'D11', 'D12', 'D13', null, null],
  C: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', null, null],
  D: ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']
};
const CFG = { B: portBConfig, C: portCConfig, D: portDConfig };

export function createAvrMcu({ board, program }) {
  const B = BOARDS[board];
  let flash = null, error = null;
  if (!B || B.family !== 'avr') error = 'HEX programs run on the 328 boards only';
  else {
    try { flash = parseHex(program && program.hex); } catch (e) { error = e.message; }
  }
  const m = {
    board, B, compiled: null,
    cpu: null, ports: {}, usart: null, adc: null,
    t0: 0, wake: Infinity, io: null, running: false, error,
    pins: {}, pending: new Map(), lvl: {}, rx: [], serialOut: '', changed: false
  };
  const tm = () => m.t0 + m.cpu.cycles / F_CPU;
  const cfgOf = st => (st === PinState.High ? { mode: 'out', level: 1 } : st === PinState.Low ? { mode: 'out', level: 0 } : st === PinState.InputPullUp ? { mode: 'in_pullup' } : { mode: 'in' });
  const same = (a, b) => a && b && a.mode === b.mode && a.level === b.level;

  function build() {
    const words = new Uint16Array(FLASH / 2);
    for (let i = 0; i < words.length; i++) words[i] = flash.bytes[2 * i] | (flash.bytes[2 * i + 1] << 8);
    const cpu = new CPU(words);
    m.cpu = cpu;
    m.ports = {};
    for (const P of ['B', 'C', 'D']) {
      const port = new AVRIOPort(cpu, CFG[P]);
      m.ports[P] = port;
      port.addListener(() => {
        PORT_PINS[P].forEach((name, i) => {
          if (!name) return;
          const c = cfgOf(port.pinState(i));
          const last = m.pending.get(name) || m.pins[name];
          if (same(c, last)) return;
          m.pending.set(name, c);
          m.changed = true;
        });
      });
    }
    new AVRTimer(cpu, timer0Config); new AVRTimer(cpu, timer1Config); new AVRTimer(cpu, timer2Config);
    m.usart = new AVRUSART(cpu, usart0Config, F_CPU);
    m.usart.onByteTransmit = byte => { const ch = String.fromCharCode(byte); if (m.io && m.io.serial) m.io.serial(ch); else m.serialOut += ch; };
    m.adc = new AVRADC(cpu, adcConfig);
  }
  function flush(io) {
    for (const [name, c] of m.pending) { m.pins[name] = c; if (io) io.drive(name, c); }
    m.pending.clear();
    m.changed = false;
  }
  function level(name, v, vdd) {
    let l = m.lvl[name];
    if (v >= B.vih * vdd) l = 1; else if (v <= B.vil * vdd) l = 0; else if (l === undefined) l = v > vdd / 2 ? 1 : 0;
    m.lvl[name] = l;
    return l;
  }
  function syncInputs(io) {
    const vdd = (io.vdd && io.vdd()) || B.vdd;
    for (const P of ['B', 'C', 'D']) {
      PORT_PINS[P].forEach((name, i) => {
        if (!name) return;
        const p = m.pins[name];
        if (p && p.mode === 'out') return;
        m.ports[P].setPin(i, !!level(name, io.read(name), vdd));
      });
    }
    m.adc.avcc = vdd;
    for (let ch = 0; ch < 8; ch++) { const name = 'A' + ch; if (B.pins[name]) m.adc.channelValues[ch] = io.read(name); }
    if (m.rx.length && !m.usart.rxBusy) m.usart.writeByte(m.rx.shift());
  }

  m.reset = function (t = 0) {
    for (const name of Object.keys(m.pins)) m.pending.set(name, { mode: 'in' });
    m.pins = {}; m.lvl = {}; m.rx = [];
    m.t0 = t;
    if (m.error && !flash) { m.running = false; m.wake = Infinity; return; }
    build();
    m.running = true; m.error = null; m.wake = t;
  };
  m.run = function (t, io) {
    if (!m.running) return;
    m.io = io;
    if (m.serialOut && io.serial) { io.serial(m.serialOut); m.serialOut = ''; }
    flush(io);
    syncInputs(io);
    const cpu = m.cpu;
    const end = (Math.max(t, tm()) + AVR_LEAD - m.t0) * F_CPU;
    try {
      while (cpu.cycles < end) {
        avrInstruction(cpu);
        cpu.tick();
        if (m.changed) {
          if (tm() > t) { m.wake = tm(); return; }
          flush(io);
        }
      }
    } catch (e) { m.error = 'AVR: ' + e.message; m.running = false; m.wake = Infinity; return; }
    m.wake = tm();
  };
  m.nextWake = () => (m.running ? m.wake : Infinity);
  m.pinChanged = function (pin, lvl) {
    m.lvl[pin] = lvl ? 1 : 0;
    if (!m.running) return;
    for (const P of ['B', 'C', 'D']) {
      const i = PORT_PINS[P].indexOf(pin);
      if (i >= 0) { const p = m.pins[pin]; if (!p || p.mode !== 'out') m.ports[P].setPin(i, !!lvl); }
    }
  };
  m.watching = pin => { const p = m.pins[pin]; return !!B && !!B.pins[pin] && (!p || p.mode !== 'out'); };
  m.serialIn = text => { for (const ch of String(text)) if (m.rx.length < 256) m.rx.push(ch.charCodeAt(0) & 255); };
  m.state = function () {
    const pins = {};
    for (const [name, p] of Object.entries(m.pins)) pins[name] = { mode: p.mode, level: p.mode === 'out' ? p.level : (m.lvl[name] ?? 0) };
    const s = { running: m.running, millis: m.cpu ? Math.floor((m.cpu.cycles / F_CPU) * 1000) : 0, pins };
    if (m.error) s.error = m.error;
    return s;
  };
  m.reset(0);
  return m;
}
