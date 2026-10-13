// ============================================================================
//  BREADBOARD LAB  ·  mcu/runtime.js — one microcontroller on the sim clock
// ----------------------------------------------------------------------------
//  createMcu({ board, program }) -> mcu, the interface of CONTRACT 3.11:
//    mcu.reset(t) / mcu.nextWake() / mcu.run(t, io) / mcu.pinChanged(pin,
//    level, t) / mcu.serialIn(text) / mcu.state()
//  plus mcu.watching(pin) (SIM may skip pinChanged for other pins) and
//  mcu.compiled (the compileSketch result, for the CODE panel).
//
//  TIME. The MCU keeps its own clock `tm`. It never runs behind the sim: run
//  (t) first sets tm = max(tm, t). The sketch is a generator; it yields at
//  each loop back-edge and around each pin access. After a yield the runtime
//  decides whether to stop and hand control back to SIM:
//    0 tick ........ tm += tick cost; stop when tm > t + LEAD (1 ms)
//    3 output sync . stop when tm > t, so every pin change lands at the
//                    exact sim time the MCU makes it
//    4 input sync .. stop when tm > t + READ_LEAD (0.2 ms): a polling loop
//                    reads values at most 0.2 ms old
//    2 wait ........ delay(), pulseIn(), a full Serial buffer: resume at
//                    waitUntil, or at a pin edge for a pin wait
//  On a stop, nextWake() tells SIM when to call run again.
//
//  INTERRUPTS. pinChanged(pin, level, t) queues an attached handler at t and
//  pulls nextWake down to t. A handler runs to completion (its delays only
//  move the clock, as on the real part). noInterrupts() defers the queue.
//
//  ERRORS. A run-time error (array index out of range, division by zero, an
//  absent pin) halts the MCU with `error: 'line N: ...'`. Pins keep their
//  last state, as on a crashed part.
//
//  GREP MAP
//    LEAD / READ_LEAD ....... how far the MCU may run ahead of the sim
//    createMcu .............. the export; program -> compile -> factory;
//                             { lang:'hex' } goes to mcu/avr.js (avr8js)
//    makeEnv ................ the `$` object the generated code sees
//    pinOf / drive .......... pin numbers -> names, io.drive bookkeeping
//    B. ..................... the Arduino built-ins (pinMode ... ledcWrite)
//    waitFor / waitLevel .... the blocking primitives
//    run .................... the scheduler loop
//    runIsr ................. one interrupt handler
//    pinChanged / watching .. input edges from SIM
//    state .................. the frame record of CONTRACT 3.8 `mcus`
// ============================================================================
import { BOARDS, pinName } from './boards.js';
import { compileSketch } from './compile.js';
import { SketchError, makeSerial, makeLCD, makeServo, strText, cstr, mkArr, mkObjArr, STRING, cprintf, writeChars, atol, atof } from './libs.js';
import { createAvrMcu } from './avr.js';

export const LEAD = 1e-3;
export const READ_LEAD = 2e-4;
const MAX_STEPS = 4e6;

export function createMcu({ board, program = null } = {}) {
  const B = BOARDS[board];
  if (!B) throw new Error(`unknown board '${board}'`);
  if (program && program.lang === 'hex') return createAvrMcu({ board, program });
  let compiled = null, factory = null, compileError = null;
  if (program && program.lang === 'sketch') {
    compiled = compileSketch(program.source, { board });
    if (compiled.ok) factory = new Function('$', compiled.code);
    else compileError = compiled.errors.map(e => (e.line ? `line ${e.line}: ` : '') + e.msg).join('\n');
  }
  const C = B.costs, esp = B.family === 'esp32';

  const m = {
    board, B, compiled,
    tm: 0, t0: 0, wake: Infinity, tLimit: 0, io: null,
    running: false, error: compileError ? 'compile: ' + compileError : null,
    pins: {}, latch: {}, lvl: {}, resetPins: [],
    waiting: false, waitUntil: 0, waitPin: null,
    isrQ: [], isr: {}, timers: [], intOn: true, inIsr: false,
    gen: null, prog: null, env: null,
    adcBits: B.adcBits, pwmBits: 8, ledc: { pins: {}, ch: {}, chPins: {}, legacy: false },
    rng: 1, warnings: [], warned: new Set(), serialOut: [],
    Serial: null
  };
  m.Serial = makeSerial(m);

  m.warn = msg => { if (!m.warned.has(msg)) { m.warned.add(msg); m.warnings.push(msg); } };
  m.cost = dt => { m.tm += dt; };
  m.emitSerial = text => { if (m.io && m.io.serial) m.io.serial(text); else m.serialOut.push(text); };
  const fail = msg => { throw new SketchError(msg); };

  // ── pins ──
  function pinOf(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) fail(`pin ${n} is not a pin number`);
    const name = pinName(B, Math.trunc(n));
    if (!name) fail(esp ? `GPIO ${n} is not on the ESP32 devkit` : `pin ${n} does not exist on the ${B.name}`);
    return name;
  }
  function drive(name, cfg) {
    const prev = m.pins[name];
    if (prev && prev.mode === cfg.mode && prev.level === cfg.level && prev.duty === cfg.duty && prev.freq === cfg.freq && prev.pulse === cfg.pulse) return;
    m.pins[name] = cfg;
    if (m.io) m.io.drive(name, cfg);
  }
  function readV(name) { return m.io ? m.io.read(name) : 0; }
  function vdd() { const v = m.io && m.io.vdd ? m.io.vdd() : B.vdd; return v > 0 ? v : B.vdd; }
  function level(name) {
    const v = readV(name), hi = B.vih * vdd(), lo = B.vil * vdd();
    let l = m.lvl[name];
    if (v >= hi) l = 1; else if (v <= lo) l = 0; else if (l === undefined) l = v > vdd() / 2 ? 1 : 0;
    m.lvl[name] = l;
    return l;
  }
  const outMode = name => { const p = m.pins[name]; return p && p.mode !== 'in' && p.mode !== 'in_pullup' && p.mode !== 'off'; };
  function checkOut(name, n) {
    const P = B.pins[name];
    if (P.inputOnly) fail(`GPIO ${n} is input only on the ESP32`);
    if (P.analogOnly) fail(`${name} is analog only on this board: it cannot drive a pin`);
  }

  // ── blocking primitives ──
  m.waitFor = function* (dt) {
    if (!(dt > 0)) return;
    m.waitUntil = m.tm + dt; m.waiting = true;
    yield 2;
  };
  // wait until `name` reads `want`; false at the deadline
  function* waitLevel(name, want, deadline) {
    yield 4;
    if (level(name) === want) return true;
    m.waitPin = { pin: name, level: want, hit: null };
    m.waitUntil = deadline; m.waiting = true;
    yield 2;
    const hit = m.waitPin ? m.waitPin.hit : null;
    m.waitPin = null;
    if (hit !== null) { m.lvl[name] = want; return true; }
    return false;
  }
  m.servoDrive = function* (n, us) {
    yield 3;
    const name = pinOf(n);
    checkOut(name, n);
    drive(name, us === null ? { mode: 'out', level: 0 } : { mode: 'servo', pulse: us * 1e-6, freq: 50 });
    m.tm += C.call;
  };

  const modeOf = v => {
    if (esp) return v === 3 || v === 2 ? 'out' : v === 5 || v === 4 ? 'in_pullup' : 'in';
    return v === 1 ? 'out' : v === 2 ? 'in_pullup' : 'in';
  };
  const irqMode = v => esp ? ({ 1: 'rise', 2: 'fall', 3: 'change', 4: 'low', 5: 'high' })[v] : ({ 0: 'low', 1: 'change', 2: 'fall', 3: 'rise' })[v];

  // ── the Arduino built-ins ──
  const BI = {
    *pinMode(n, v) {
      yield 3;
      const name = pinOf(n), md = modeOf(v), P = B.pins[name];
      if (v === 9 && esp) m.warn('INPUT_PULLDOWN is treated as INPUT (no pull-down model)');
      if (P.analogOnly) { m.warn(`${name} is analog only: pinMode has no effect`); return; }
      if (md === 'out') { checkOut(name, n); drive(name, { mode: 'out', level: m.latch[name] || 0 }); }
      else { drive(name, { mode: md }); if (!esp && md === 'in_pullup') m.latch[name] = 1; else if (!esp && md === 'in') m.latch[name] = 0; }
      m.tm += C.pinMode;
    },
    *digitalWrite(n, v) {
      yield 3;
      const name = pinOf(n), l = v ? 1 : 0;
      if (B.pins[name].analogOnly) fail(`${name} is analog only on this board: digitalWrite cannot use it`);
      m.latch[name] = l;
      if (outMode(name)) { if (B.pins[name].inputOnly) fail(`GPIO ${n} is input only on the ESP32`); drive(name, { mode: 'out', level: l }); }
      else if (!esp) {
        // AVR: writing an input pin switches its pull-up (a classic missing pinMode)
        drive(name, { mode: l ? 'in_pullup' : 'in' });
        if (l) m.warn(`${name} was written HIGH while it is an INPUT: that turns on the pull-up only. Call pinMode(${n}, OUTPUT) first.`);
      }
      m.tm += C.digitalWrite;
    },
    *digitalRead(n) {
      yield 4;
      const name = pinOf(n);
      if (B.pins[name].analogOnly) { m.warn(`${name} is analog only: digitalRead returns 0; use analogRead`); m.tm += C.digitalRead; return 0; }
      const l = level(name);
      m.tm += C.digitalRead;
      return l;
    },
    *analogRead(n) {
      yield 4;
      let name;
      if (!esp && n >= 0 && n < 14) { name = 'A' + Math.trunc(n); if (!B.pins[name]) fail(`analog channel ${n} does not exist on the ${B.name}`); }
      else name = pinOf(n);
      const P = B.pins[name];
      if (P.adc === undefined) fail(esp ? `GPIO ${n} has no ADC` : `${name} is not an analog pin`);
      const ref = esp ? B.vref : vdd();
      const full = 1 << m.adcBits;
      const code = Math.floor((readV(name) / ref) * full);
      m.tm += C.analogRead;
      return Math.max(0, Math.min(full - 1, code));
    },
    *analogWrite(n, v) {
      yield 3;
      const name = pinOf(n);
      checkOut(name, n);
      const P = B.pins[name], max = (1 << m.pwmBits) - 1;
      v = Math.trunc(v);
      m.tm += C.analogWrite;
      if (!P.pwm) {
        m.warn(`pin ${n} has no PWM: analogWrite rounds to LOW or HIGH`);
        drive(name, { mode: 'out', level: v < (max + 1) / 2 ? 0 : 1 }); return;
      }
      if (v <= 0) { drive(name, { mode: 'out', level: 0 }); m.latch[name] = 0; return; }
      if (v >= max) { drive(name, { mode: 'out', level: 1 }); m.latch[name] = 1; return; }
      drive(name, { mode: 'pwm', duty: v / max, freq: P.pwmFreq || B.pwmFreq });
    },
    *delay(ms) {
      const d = Math.trunc(ms) >>> 0;
      if (d > 0) yield* m.waitFor(d / 1000);
      else yield 0;
    },
    *delayMicroseconds(us) {
      const d = esp ? Math.trunc(us) >>> 0 : Math.trunc(us) & 0xffff;
      if (d > 0) yield* m.waitFor(d * 1e-6);
    },
    *tone(n, f, dur) {
      yield 3;
      const name = pinOf(n); checkOut(name, n);
      const fr = Math.trunc(f) >>> 0;
      m.timers = m.timers.filter(x => x.pin !== name);
      if (fr <= 0) drive(name, { mode: 'out', level: 0 });
      else drive(name, { mode: 'tone', freq: fr });
      if (dur !== undefined && dur > 0) {
        m.timers.push({ t: m.tm + (dur >>> 0) / 1000, pin: name, fn: () => drive(name, { mode: 'out', level: 0 }) });
        m.timers.sort((a, b) => a.t - b.t);
      }
      m.tm += C.call * 4;
    },
    *noTone(n) {
      yield 3;
      const name = pinOf(n);
      m.timers = m.timers.filter(x => x.pin !== name);
      drive(name, { mode: 'out', level: 0 });
      m.tm += C.call;
    },
    *pulseIn(n, state, timeout) {
      const name = pinOf(n);
      const want = state ? 1 : 0;
      const tmo = timeout === undefined ? 1 : (timeout >>> 0) * 1e-6;
      const deadline = m.tm + tmo;
      if (!(yield* waitLevel(name, 1 - want, deadline))) return 0;
      if (!(yield* waitLevel(name, want, deadline))) return 0;
      const start = m.tm;
      if (!(yield* waitLevel(name, 1 - want, deadline))) return 0;
      return Math.round((m.tm - start) * 1e6) >>> 0;
    },
    *pulseInLong(n, state, timeout) { return yield* BI.pulseIn(n, state, timeout); },
    *shiftOut(data, clock, order, val) {
      for (let i = 0; i < 8; i++) {
        const bit = order === 0 ? (val >> i) & 1 : (val >> (7 - i)) & 1;
        yield* BI.digitalWrite(data, bit);
        yield* BI.digitalWrite(clock, 1);
        yield* BI.digitalWrite(clock, 0);
      }
    },
    *shiftIn(data, clock, order) {
      let v = 0;
      for (let i = 0; i < 8; i++) {
        yield* BI.digitalWrite(clock, 1);
        const b = yield* BI.digitalRead(data);
        if (order === 0) v |= b << i; else v |= b << (7 - i);
        yield* BI.digitalWrite(clock, 0);
      }
      return v & 255;
    },
    *yield() { yield 0; },
    millis() { return Math.floor((m.tm - m.t0) * 1000 + 1e-6) >>> 0; },
    micros() {
      const us = (m.tm - m.t0) * 1e6 + 1e-3;
      return (esp ? Math.floor(us) : Math.floor(us / 4) * 4) >>> 0;
    },
    map(x, a, b, c, d) {
      if (b === a) fail('map(): the input range is empty (division by zero)');
      return (Math.trunc(((x - a) * (d - c)) / (b - a)) + c) | 0;
    },
    random(a, b) {
      const r = () => { m.rng = (m.rng + 0x6D2B79F5) | 0; let t = m.rng; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      if (b === undefined) { if (a <= 0) return 0; return Math.floor(r() * a) | 0; }
      if (a >= b) return a | 0;
      return (a + Math.floor(r() * (b - a))) | 0;
    },
    randomSeed(s) { if (s) m.rng = s | 0; },
    attachInterrupt(num, fn, mode) {
      let name;
      if (esp) name = pinName(B, num);
      else name = num === 0 ? 'D2' : num === 1 ? 'D3' : null;
      if (!name) { m.warn(esp ? `attachInterrupt: GPIO ${num} is not on this board` : `attachInterrupt: interrupt ${num} does not exist on the 328 (use digitalPinToInterrupt(2) or (3))`); return; }
      const md = irqMode(mode);
      if (!md) { m.warn(`attachInterrupt: unknown mode ${mode}`); return; }
      if (md === 'low' || md === 'high') m.warn('LOW/HIGH level interrupts fire once per edge in this simulator');
      m.isr[name] = { fn, mode: md };
      level(name);
    },
    detachInterrupt(num) {
      const name = esp ? pinName(B, num) : num === 0 ? 'D2' : num === 1 ? 'D3' : null;
      if (name) delete m.isr[name];
    },
    digitalPinToInterrupt(p) { if (esp) return pinName(B, p) ? p : -1; return p === 2 ? 0 : p === 3 ? 1 : -1; },
    interrupts() { m.intOn = true; if (m.isrQ.length) m.wake = Math.min(m.wake, m.tm); },
    noInterrupts() { m.intOn = false; },
    sei() { BI.interrupts(); },
    cli() { BI.noInterrupts(); },
    analogReadResolution(bits) { m.adcBits = Math.max(9, Math.min(12, bits | 0)); },
    analogWriteResolution(bits) { m.pwmBits = Math.max(1, Math.min(16, bits | 0)); },
    ledcAttach(n, freq, bits) { const name = pinOf(n); checkOut(name, n); m.ledc.pins[name] = { freq, bits }; return 1; },
    ledcSetup(ch, freq, bits) { m.ledc.legacy = true; m.ledc.ch[ch] = { freq, bits }; return freq; },
    ledcAttachPin(n, ch) { const name = pinOf(n); checkOut(name, n); (m.ledc.chPins[ch] = m.ledc.chPins[ch] || []).push(name); },
    *ledcWrite(target, duty) {
      yield 3;
      const list = m.ledc.legacy && m.ledc.ch[target] ? (m.ledc.chPins[target] || []).map(nm => [nm, m.ledc.ch[target]]) : [[pinOf(target), m.ledc.pins[pinOf(target)]]];
      for (const [name, cfg] of list) {
        if (!cfg) { m.warn(`ledcWrite on ${name} before ledcAttach`); continue; }
        const full = 1 << cfg.bits;
        if (duty <= 0) drive(name, { mode: 'out', level: 0 });
        else if (duty >= full) drive(name, { mode: 'out', level: 1 });
        else drive(name, { mode: 'pwm', duty: duty / full, freq: cfg.freq });
      }
      m.tm += C.analogWrite;
      return 1;
    },
    *ledcWriteTone(target, f) {
      yield 3;
      const names = m.ledc.legacy && m.ledc.ch[target] ? (m.ledc.chPins[target] || []) : [pinOf(target)];
      for (const name of names) drive(name, f > 0 ? { mode: 'tone', freq: f } : { mode: 'out', level: 0 });
      m.tm += C.call;
      return f;
    },
    *ledcDetach(n) { yield 3; const name = pinOf(n); delete m.ledc.pins[name]; drive(name, { mode: 'in' }); return 1; },
    *ledcDetachPin(n) { yield* BI.ledcDetach(n); },
    word(h, l) { return l === undefined ? h & 0xffff : ((h & 255) << 8) | (l & 255); },
    isDigit: c => (c >= 48 && c <= 57 ? 1 : 0),
    isAlpha: c => ((c | 32) >= 97 && (c | 32) <= 122 ? 1 : 0),
    isAlphaNumeric: c => (BI.isDigit(c) || BI.isAlpha(c) ? 1 : 0),
    isSpace: c => (c === 32 || (c >= 9 && c <= 13) ? 1 : 0),
    isWhitespace: c => (c === 32 || c === 9 ? 1 : 0),
    isUpperCase: c => (c >= 65 && c <= 90 ? 1 : 0),
    isLowerCase: c => (c >= 97 && c <= 122 ? 1 : 0),
    isPunct: c => (c > 32 && c < 127 && !BI.isAlphaNumeric(c) ? 1 : 0),
    isHexadecimalDigit: c => (BI.isDigit(c) || ((c | 32) >= 97 && (c | 32) <= 102) ? 1 : 0),
    isPrintable: c => (c >= 32 && c < 127 ? 1 : 0),
    toupper: c => (c >= 97 && c <= 122 ? c - 32 : c),
    tolower: c => (c >= 65 && c <= 90 ? c + 32 : c),
    strlen: s => s.length,
    strcmp: (a, b) => STRING.compareTo(a, b),
    atoi: s => (esp ? atol(s) : (atol(s) << 16) >> 16),
    atol: s => atol(s),
    atof: s => atof(s),
    isnan: x => (Number.isNaN(x) ? 1 : 0),
    isinf: x => (!Number.isFinite(x) && !Number.isNaN(x) ? 1 : 0)
  };
  m.B_ = BI;

  function makeEnv() {
    const $ = {
      ln: 0, B: BI, Serial: m.Serial,
      div(a, b) { if (b === 0) fail('division by zero'); return Math.trunc(a / b); },
      mod(a, b) { if (b === 0) fail('division by zero (the % operator)'); return a % b; },
      ix(arr, i) { if (i >= 0 && i < arr.length) return i; fail(`array index ${i} is out of range (the array has ${arr.length} element${arr.length === 1 ? '' : 's'})`); },
      mkArr, mkObjArr, cstr,
      str: (v, t, arg) => strText(v, t, arg),
      sAt: (s, i) => (typeof s === 'string' ? (i >= 0 && i < s.length ? s.charCodeAt(i) << 24 >> 24 : 0) : 0),
      sm: STRING,
      fmod: (a, b) => a % b,
      round: x => (x < 0 ? -Math.round(-x) : Math.round(x)),
      square: x => x * x,
      constrain: (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x),
      sprintf(buf, size, fmt, ...args) { const s = cprintf(fmt, args, B.family); writeChars(buf, s, size); return s.length; },
      dtostrf(v, w, p, buf) {
        let s = strText(v, 'f64', p);
        const wd = Math.trunc(w);
        s = wd < 0 ? s.padEnd(-wd, ' ') : s.padStart(wd, ' ');
        writeChars(buf, s, Infinity);
        return s;
      },
      newLCD: pins => makeLCD(m, BI, pins),
      newServo: () => makeServo(m)
    };
    return $;
  }

  // ── lifecycle ──
  m.reset = function (t = 0) {
    for (const name of Object.keys(m.pins)) m.resetPins.push(name);
    m.tm = t; m.t0 = t; m.wake = t; m.tLimit = t;
    m.waiting = false; m.waitPin = null; m.waitUntil = t;
    m.isrQ = []; m.isr = {}; m.timers = []; m.intOn = true; m.inIsr = false;
    m.pins = {}; m.latch = {}; m.lvl = {};
    m.adcBits = B.adcBits; m.pwmBits = 8; m.ledc = { pins: {}, ch: {}, chPins: {}, legacy: false };
    m.rng = 1; m.Serial.reset();
    m.warnings = []; m.warned = new Set();
    if (!factory) { m.running = false; m.wake = Infinity; return; }
    m.error = null;
    m.env = makeEnv();
    try { m.prog = factory(m.env); }
    catch (e) { m.running = false; m.error = 'internal: ' + e.message; m.wake = Infinity; return; }
    const P = m.prog, S = m.Serial;
    m.gen = (function* main() {
      yield* P.init();
      yield* P.setup();
      const se = P.fns.serialEvent;
      for (;;) { yield* P.loop(); if (se && S.rx.length) yield* se(); yield 0; }
    })();
    m.running = true;
  };

  function failNow(e) {
    let msg;
    if (e instanceof SketchError) msg = e.message;
    else if (e instanceof RangeError) msg = 'stack overflow: a function calls itself too deeply';
    else msg = 'run-time error: ' + (e && e.message);
    const line = m.env ? m.env.ln : 0;
    m.error = (line ? `line ${line}: ` : '') + msg;
    m.running = false; m.wake = Infinity;
  }

  function nextEvent() {
    let t = Infinity;
    if (m.timers.length) t = m.timers[0].t;
    if (m.isrQ.length && m.intOn) t = Math.min(t, m.isrQ[0].t);
    return t;
  }

  function runIsr(fn) {
    const saved = { waiting: m.waiting, waitUntil: m.waitUntil, waitPin: m.waitPin };
    m.waiting = false; m.waitPin = null; m.inIsr = true;
    const g = fn();
    let n = 0;
    for (;;) {
      const r = g.next();
      if (r.done) break;
      if (r.value === 0) m.tm += C.tick;
      else if (r.value === 2) { if (m.waitUntil > m.tm) m.tm = m.waitUntil; m.waiting = false; m.waitPin = null; }
      if (++n > 2e6) fail('the interrupt handler never returns');
    }
    m.inIsr = false;
    m.waiting = saved.waiting; m.waitUntil = saved.waitUntil; m.waitPin = saved.waitPin;
  }

  m.run = function (t, io) {
    if (!m.running) return;
    m.io = io; m.tLimit = t;
    if (m.tm < t) m.tm = t;
    if (m.resetPins.length) { for (const name of m.resetPins) if (!m.pins[name] && io) io.drive(name, { mode: 'in' }); m.resetPins = []; }
    if (m.serialOut.length && io && io.serial) { io.serial(m.serialOut.join('')); m.serialOut = []; }
    let steps = 0;
    try {
      for (;;) {
        while (m.timers.length && m.timers[0].t <= m.tm) m.timers.shift().fn();
        if (m.isrQ.length && m.intOn && m.isrQ[0].t <= m.tm) { runIsr(m.isrQ.shift().fn); continue; }
        if (m.waiting) {
          let at = m.waitUntil;
          if (m.waitPin && m.waitPin.hit !== null) at = Math.min(at, m.waitPin.hit);
          const ev = nextEvent();
          if (ev < at && ev <= t) { if (ev > m.tm) m.tm = ev; continue; }
          if (at > t) { m.wake = Math.min(at, ev); return; }
          if (at > m.tm) m.tm = at;
          m.waiting = false;
        }
        const r = m.gen.next();
        if (r.done) { m.running = false; m.wake = Infinity; return; }
        switch (r.value) {
          case 0: m.tm += C.tick; if (m.tm > t + LEAD) { m.wake = m.tm; return; } break;
          case 3: if (m.tm > t) { m.wake = m.tm; return; } break;
          case 4: if (m.tm > t + READ_LEAD) { m.wake = m.tm; return; } break;
          default: break;
        }
        if (++steps > MAX_STEPS) fail('the sketch keeps running without time passing');
      }
    } catch (e) { failNow(e); }
  };

  m.nextWake = function () {
    if (!m.running) return Infinity;
    return Math.min(m.wake, nextEvent());
  };

  m.pinChanged = function (pin, lvl, t) {
    const l = lvl ? 1 : 0;
    const prev = m.lvl[pin];
    m.lvl[pin] = l;
    if (!m.running) return;
    const w = m.waitPin;
    if (w && w.pin === pin && w.level === l && w.hit === null) { w.hit = t; m.wake = Math.min(m.wake, t); }
    if (prev === l) return;
    const h = m.isr[pin];
    if (h) {
      const fire = h.mode === 'change' || (h.mode === 'rise' && l) || (h.mode === 'fall' && !l) || (h.mode === 'low' && !l) || (h.mode === 'high' && l);
      if (fire) { m.isrQ.push({ t, fn: h.fn }); if (m.intOn) m.wake = Math.min(m.wake, t); }
    }
  };
  m.watching = pin => !!(m.isr[pin] || (m.waitPin && m.waitPin.pin === pin));
  m.serialIn = text => m.Serial.input(String(text));
  m.state = function () {
    const pins = {};
    for (const [name, p] of Object.entries(m.pins)) {
      const r = { mode: p.mode, level: p.mode === 'out' ? p.level : p.mode === 'pwm' ? (p.duty >= 0.5 ? 1 : 0) : (m.lvl[name] ?? 0) };
      if (p.duty !== undefined) r.duty = p.duty;
      if (p.freq !== undefined) r.freq = p.freq;
      if (p.pulse !== undefined) r.pulse = p.pulse;
      pins[name] = r;
    }
    const s = { running: m.running, millis: Math.floor(Math.max(0, m.tm - m.t0) * 1000), pins };
    if (m.error) s.error = m.error;
    if (m.warnings.length) s.warnings = m.warnings.slice();
    return s;
  };
  m.reset(0);
  if (!factory) { m.running = false; m.wake = Infinity; }
  return m;
}
