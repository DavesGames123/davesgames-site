// ============================================================================
//  BREADBOARD LAB  ·  mcu/tests.mjs — node mcu/tests.mjs
// ----------------------------------------------------------------------------
//  The sketch compiler and runtime against a fake io (CONTRACT 7, MCU+UI).
//  One line per check with the measured value. Exit 1 on any failure.
//
//    features ...... one sketch per feature of CONTRACT 6, its Serial text
//    errors ........ line numbers, the stated messages for unsupported C++
//    timing ........ blink at 500 ms, millis, busy loops, interrupts, waits
//    io ............ analogRead 512 / 3103, analogWrite duty, Serial text
//    lcd ........... LiquidCrystal pin edges decoded to "HELLO"
//    examples ...... every sketch of mcu/sketches.js (and examples/*.json
//                    programs when INTEGRATE has written them) runs as its
//                    wiring line says
//    co-sim ........ SIM's engine (sim/engine.js, when present) drives this
//                    runtime: blink, LiquidCrystal into hd44780, tone into
//                    a buzzer, a HEX program
//    avr ........... the HEX runner, when mcu/avr.js is present
// ============================================================================
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSketch } from './compile.js';
import { createMcu, READ_LEAD } from './runtime.js';
import { BOARDS, pinName, boardOf } from './boards.js';
import { SKETCHES, STARTERS } from './sketches.js';
import * as L from './libs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (cond, name, val = '') => {
  if (cond) pass++; else fail++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${val !== '' ? '  -> ' + val : ''}`);
};
const section = s => console.log('\n== ' + s);

// A fake SIM: pins read `volts[pin]` (a number, or a function of t); `edges`
// are [t, pin, volts] input changes that also call mcu.pinChanged.
function sim(mcu, tEnd, { volts = {}, edges = [] } = {}) {
  const ev = [];
  let out = '';
  const V = { ...volts };
  const io = {
    t: 0,
    read: p => { const v = V[p]; return typeof v === 'function' ? v(io.t) : (v ?? 0); },
    vdd: () => mcu.B.vdd,
    drive: (p, c) => ev.push([io.t, p, { ...c }]),
    serial: s => { out += s; },
    now: () => io.t
  };
  const q = edges.slice().sort((a, b) => a[0] - b[0]);
  let runs = 0;
  for (;;) {
    const w = mcu.nextWake();
    const e = q.length ? q[0][0] : Infinity;
    const t = Math.min(w, e);
    if (!(t <= tEnd)) break;
    io.t = t;
    if (e <= w) {
      const [, pin, v] = q.shift();
      V[pin] = v;
      mcu.pinChanged(pin, v > mcu.B.vdd / 2 ? 1 : 0, t);
      continue;
    }
    mcu.run(t, io);
    if (++runs > 2e6) throw new Error('fake sim: too many runs');
  }
  io.t = tEnd;
  return { ev, out, runs, mcu, at: (pin, t) => { let s = null; for (const x of ev) { if (x[0] > t) break; if (x[1] === pin) s = x[2]; } return s; } };
}
function run(source, tEnd, board = 'uno328', opts = {}) {
  const mcu = createMcu({ board, program: { lang: 'sketch', source } });
  return sim(mcu, tEnd, opts);
}
// run setup() once (loop empty) and return the Serial text
function serialOf(body, board = 'uno328', globals = '') {
  const src = `${globals}\nvoid setup() {\n Serial.begin(115200);\n${body}\n}\nvoid loop() {}\n`;
  const c = compileSketch(src, { board });
  if (!c.ok) return 'COMPILE ERROR: ' + c.errors.map(e => `${e.line}:${e.msg}`).join('; ');
  const r = run(src, 0.5, board);
  const st = r.mcu.state();
  return r.out + (st.error ? 'RUNTIME ERROR: ' + st.error : '');
}
const lines = s => s.split(/\r?\n/).filter(x => x.length);

// ── features ────────────────────────────────────────────────────────────────
section('features (CONTRACT 6, one sketch each)');
const FEATURES = [
  ['int is 16 bits on the 328 and wraps', `int x = 32767; x++; Serial.println(x); unsigned int u = 0; u--; Serial.println(u);`, ['-32768', '65535']],
  ['byte, char, bool, long, unsigned long', `byte b = 255; b++; Serial.println(b); char c = (char)200; Serial.println((int)c); bool t = 5; Serial.println(t); long l = 2147483647L; l++; Serial.println(l); unsigned long ul = 0; ul--; Serial.println(ul);`, ['0', '-56', '1', '-2147483648', '4294967295']],
  ['stdint types', `uint8_t a = 250; a += 10; int8_t b = 127; b++; uint16_t c = 65535; c++; int16_t d = -32768; d--; uint32_t e = 1; e <<= 31; int32_t f = e; Serial.println(a); Serial.println(b); Serial.println(c); Serial.println(d); Serial.println(e); Serial.println(f);`, ['4', '-128', '0', '32767', '2147483648', '-2147483648']],
  ['integer / truncates, % keeps the sign', `Serial.println(7 / 2); Serial.println(-7 / 2); Serial.println(-7 % 2); Serial.println(7.0 / 2);`, ['3', '-3', '-1', '3.50']],
  ['usual arithmetic conversions', `Serial.println(-1 < 1u); Serial.println((long)-1 < 1u); Serial.println(30000 + 30000); Serial.println(30000L + 30000); unsigned long a = 5, b = 10; Serial.println(a - b);`, ['0', '1', '-5536', '60000', '4294967291']],
  ['float maths and float printing', `float f = 1.0 / 3; Serial.println(f); Serial.println(f, 4); double d = sqrt(2.0); Serial.println(d, 3); Serial.println(-2.5); Serial.println(round(-2.5));`, ['0.33', '0.3333', '1.414', '-2.50', '-3.00']],
  ['const, static locals, volatile', `for (int i = 0; i < 3; i++) Serial.println(counter());`, ['1', '2', '3'], 'const int STEP = 1; volatile int seen = 0;\nint counter() { static int n = 0; n += STEP; return n; }'],
  ['#define constants and macros', `Serial.println(TWICE(LED + 1)); Serial.println(SQ(3 + 1));`, ['28', '16'], '#define LED 13\n#define TWICE(x) ((x) * 2)\n#define SQ(x) ((x) * (x))'],
  ['#if / #ifdef / #else', `#ifdef __AVR__\nSerial.println("avr");\n#else\nSerial.println("other");\n#endif\n#if ARDUINO >= 100\nSerial.println("new");\n#endif`, ['avr', 'new']],
  ['#include of supported libraries', `Serial.println(abs(-4));`, ['4'], '#include <Arduino.h>\n#include <math.h>\n#include <Servo.h>\n#include <LiquidCrystal.h>'],
  ['1-D and 2-D arrays with initialisers, sizeof', `int a[] = {3, 1, 4, 1, 5}; int n = sizeof(a) / sizeof(a[0]); Serial.println(n); int m[2][3] = {{1, 2, 3}, {4, 5, 6}}; Serial.println(m[1][2]); m[0][1] += 40; Serial.println(m[0][1]); Serial.println(sizeof(m));`, ['5', '6', '42', '12']],
  ['char arrays and strings', `char msg[] = "hey"; Serial.println(msg); Serial.println(sizeof(msg)); msg[0] = 'H'; Serial.println(msg); Serial.println(strlen(msg));`, ['hey', '4', 'Hey', '3']],
  ['functions, recursion, array parameters', `Serial.println(fact(6)); int v[4] = {1, 2, 3, 4}; Serial.println(sum(v, 4)); bump(v); Serial.println(v[0]);`, ['720', '10', '11'], 'long fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }\nint sum(int a[], int n) { int s = 0; for (int i = 0; i < n; i++) s += a[i]; return s; }\nvoid bump(int a[]) { a[0] += 10; }'],
  ['default arguments and prototypes', `Serial.println(add(1)); Serial.println(add(1, 5));`, ['3', '6'], 'int add(int a, int b = 2);\nint add(int a, int b) { return a + b; }'],
  ['if / else, for, while, do', `int s = 0; for (int i = 0; i < 10; i++) { if (i % 2) continue; s += i; } Serial.println(s); int k = 0; while (true) { if (++k == 5) break; } Serial.println(k); int d = 0; do { d++; } while (d < 3); Serial.println(d);`, ['20', '5', '3']],
  ['switch with fall through and default', `for (int i = 0; i < 4; i++) { switch (i) { case 0: Serial.print("a"); case 1: Serial.print("b"); break; case 'x': break; default: Serial.print("z"); } } Serial.println();`, ['abbzz']],
  ['ternary, bit operators, shifts, casts', `int x = 0b1010; Serial.println(x & 6); Serial.println(x | 5); Serial.println(x ^ 15); Serial.println(~x); Serial.println(1 << 15); Serial.println(1UL << 31); Serial.println(-16 >> 2); Serial.println((byte)300); Serial.println(int(3.9)); Serial.println(x > 5 ? "big" : "small");`, ['2', '15', '5', '-11', '-32768', '2147483648', '-4', '44', '3', 'big']],
  ['compound assignment and ++/-- on array elements', `int a[3] = {1, 2, 3}; int i = 0; a[i++] += 10; a[i]--; a[2] <<= 2; Serial.println(a[0]); Serial.println(a[1]); Serial.println(a[2]); Serial.println(i);`, ['11', '1', '12', '1']],
  ['enum', `Serial.println(GREEN); Mode m = FAST; Serial.println(m);`, ['5', '11'], 'enum Color { RED, GREEN = 5, BLUE };\nenum Mode { SLOW = 10, FAST };'],
  ['String: concat, length, toInt, substring, indexOf', `String s = "Temp: "; s += 21; s = s + " C"; Serial.println(s); Serial.println(s.length()); Serial.println(String("42abc").toInt() + 1); Serial.println(s.substring(6, 8)); Serial.println(s.indexOf('C')); Serial.println(s.indexOf("zz"));`, ['Temp: 21 C', '10', '43', '21', '9', '-1']],
  ['String: mutating methods and comparison', `String s = "  Hello "; s.trim(); s.toUpperCase(); Serial.println(s); Serial.println(s == "HELLO"); Serial.println(s.equalsIgnoreCase("hello")); s.replace("L", "1"); Serial.println(s); s.remove(1, 2); Serial.println(s); s.setCharAt(0, 'J'); Serial.println(s);`, ['HELLO', '1', '1', 'HE11O', 'H1O', 'J1O']],
  ['String(x, base) is lower case, print(x, HEX) upper case', `Serial.println(String(255, HEX)); Serial.println(255, HEX); Serial.println(String(-1, HEX)); Serial.println(-1, HEX); Serial.println(5, BIN); Serial.println(String(3.14159, 3)); Serial.println(65, DEC); Serial.write(65); Serial.println();`, ['ff', 'FF', 'ffff', 'FFFFFFFF', '101', '3.142', '65', 'A']],
  ['Serial.print of chars, bools, floats', `char c = 'Z'; Serial.println(c); Serial.println((int)c); Serial.println(true); Serial.println(1e10); Serial.println(0.0 / 0.0);`, ['Z', '90', '1', 'ovf', 'nan']],
  ['map, constrain, min, max, abs, sq', `Serial.println(map(512, 0, 1023, 0, 255)); Serial.println(map(5, 0, 10, 100, 0)); Serial.println(constrain(300, 0, 255)); Serial.println(min(3, -2)); Serial.println(max(3u, 7u)); Serial.println(abs(-9)); Serial.println(sq(12));`, ['127', '50', '255', '-2', '7', '9', '144']],
  ['bitRead, bitSet, bitClear, bitWrite, bit, lowByte, highByte', `byte b = 0; bitSet(b, 3); bitWrite(b, 0, 1); Serial.println(b); bitClear(b, 3); Serial.println(b); Serial.println(bitRead(6, 1)); Serial.println(bit(4)); Serial.println(lowByte(0x1234), HEX); Serial.println(highByte(0x1234), HEX);`, ['9', '1', '1', '16', '34', '12']],
  ['random and randomSeed stay in range', `randomSeed(42); int bad = 0; for (int i = 0; i < 200; i++) { long r = random(10, 20); if (r < 10 || r >= 20) bad++; } Serial.println(bad); Serial.println(random(1));`, ['0', '0']],
  ['sprintf into a char array (no %f on the 328)', `char buf[24]; sprintf(buf, "%3d|%-4s|%02X|%f", 7, "ab", 10, 1.5); Serial.println(buf); dtostrf(3.14159, 6, 2, buf); Serial.println(buf);`, ['  7|ab  |0A|?', '  3.14']],
  ['millis and micros', `delay(123); Serial.println(millis() >= 123 && millis() < 125); unsigned long a = micros(); delayMicroseconds(40); Serial.println(micros() - a >= 40);`, ['1', '1']],
  ['F() and PROGMEM data', `Serial.println(F("flash text")); Serial.println(pgm_read_byte(&TABLE[2]));`, ['flash text', '30'], 'const byte TABLE[] PROGMEM = {10, 20, 30};'],
  ['global initialisers run in order', `Serial.println(b);`, ['8'], 'int a = 3;\nint b = a + 5;']
];
for (const [name, body, want, globals] of FEATURES) {
  const out = serialOf(body, 'uno328', globals || '');
  const got = lines(out);
  ok(JSON.stringify(got) === JSON.stringify(want), name, JSON.stringify(got));
}
// the ESP32 board: int is 32 bits, double is 64, printf has %f
{
  const out = lines(serialOf(`int x = 32767; x++; Serial.println(x); Serial.printf("%.3f|%5.1f|%d\\n", 3.14159, -2.25, 1 << 20); double d = 1.0 / 3; Serial.println(d, 10);`, 'esp32dev'));
  ok(JSON.stringify(out) === JSON.stringify(['32768', '3.142| -2.2|1048576', '0.3333333333']), 'ESP32: 32-bit int, printf with %f, 64-bit double', JSON.stringify(out));
}

// ── errors ──────────────────────────────────────────────────────────────────
section('errors: line numbers and the stated messages');
const ERRS = [
  ['missing value', 'void setup() {\n  int x = ;\n}\nvoid loop() {}', 2, /expected an expression/],
  ['missing semicolon', 'void setup() {\n  int x = 1\n  x++;\n}\nvoid loop() {}', 3, /expected ';'/],
  ['undeclared name', 'void setup() {\n\n  ledPin = 3;\n}\nvoid loop() {}', 3, /'ledPin' was not declared in this scope/],
  ['undeclared function', 'void setup() {\n  blinkk();\n}\nvoid loop() {}', 2, /'blinkk' was not declared/],
  ['pointers', 'int *p;\nvoid setup() {}\nvoid loop() {}', 1, /pointers are not supported/],
  ['address-of', 'void setup() {\n  int x = 1;\n  int y = &x;\n}\nvoid loop() {}', 3, /pointers are not supported/],
  ['classes', 'class Blinker {\n};\nvoid setup() {}\nvoid loop() {}', 1, /classes are not supported/],
  ['structs', 'struct P { int x; };\nvoid setup() {}\nvoid loop() {}', 1, /structs are not supported/],
  ['templates', 'template<typename T> T twice(T x) { return x * 2; }\nvoid setup() {}\nvoid loop() {}', 1, /templates are not supported/],
  ['references', 'void inc(int &x) { x++; }\nvoid setup() {}\nvoid loop() {}', 1, /references are not supported/],
  ['unknown library', '#include <Wire.h>\nvoid setup() {}\nvoid loop() {}', 1, /library Wire\.h is not available/],
  ['goto', 'void setup() {\n  goto end;\n}\nvoid loop() {}', 2, /goto is not supported/],
  ['new', 'void setup() {\n  int x = new int;\n}\nvoid loop() {}', 2, /new and delete are not supported/],
  ['long long', 'long long big = 1;\nvoid setup() {}\nvoid loop() {}', 1, /long long is not supported/],
  ['no loop()', 'void setup() {}', 1, /needs a loop\(\) function/],
  ['overloads', 'int f(int a) { return a; }\nint f(float a) { return 1; }\nvoid setup() {}\nvoid loop() {}', 2, /overloaded functions are not supported/],
  ['string literal + number', 'void setup() {\n  Serial.println("n=" + 3);\n}\nvoid loop() {}', 2, /use String/],
  ['Servo without include', 'Servo s;\nvoid setup() {}\nvoid loop() {}', 1, /add #include <Servo\.h>/],
  ['printf on the 328', 'void setup() {\n  Serial.printf("%d", 1);\n}\nvoid loop() {}', 2, /not available on the 328/],
  ['too many arguments', 'void setup() {\n  digitalWrite(13, 1, 2);\n}\nvoid loop() {}', 2, /too many arguments/],
  ['assign to const', 'const int A = 1;\nvoid setup() {\n  A = 2;\n}\nvoid loop() {}', 3, /read-only/],
  ['unterminated string', 'void setup() {\n  Serial.println("abc);\n}\nvoid loop() {}', 2, /missing terminating/]
];
for (const [name, src, line, re] of ERRS) {
  const r = compileSketch(src, { board: 'uno328' });
  const e = r.errors[0];
  ok(!r.ok && e && e.line === line && re.test(e.msg), `error: ${name} at line ${line}`, e ? `line ${e.line}: ${e.msg}` : 'no error');
}
{
  const r = compileSketch('void setup() {\n  int a[3];\n  a[5] = 1;\n}\nvoid loop() {}', { board: 'uno328' });
  const m = createMcu({ board: 'uno328', program: { lang: 'sketch', source: 'void setup() {\n  int a[3];\n  int i = 5;\n  a[i] = 1;\n}\nvoid loop() {}' } });
  sim(m, 0.1);
  ok(r.ok && /line 4: array index 5 is out of range/.test(m.state().error || ''), 'run-time error halts with the line', m.state().error);
  const z = createMcu({ board: 'uno328', program: { lang: 'sketch', source: 'int d = 0;\nvoid setup() {}\nvoid loop() {\n  int x = 10 / d;\n}' } });
  sim(z, 0.1);
  ok(/line 4: division by zero/.test(z.state().error || '') && !z.state().running, 'division by zero halts the MCU', z.state().error);
  const p = createMcu({ board: 'esp32dev', program: { lang: 'sketch', source: 'void setup() {\n  pinMode(34, OUTPUT);\n}\nvoid loop() {}' } });
  sim(p, 0.1);
  ok(/GPIO 34 is input only/.test(p.state().error || ''), 'ESP32 input-only pin as OUTPUT is an error', p.state().error);
  const c = createMcu({ board: 'uno328', program: { lang: 'sketch', source: 'void setup() { x(); }\nvoid loop() {}' } });
  ok(!c.state().running && /^compile: line 1/.test(c.state().error) && c.nextWake() === Infinity, 'a compile error leaves the MCU stopped with the message', c.state().error);
}

// ── timing ──────────────────────────────────────────────────────────────────
section('timing on the sim clock');
{
  const r = run(SKETCHES['uno-blink'].source, 5.2);
  const t = r.ev.filter(e => e[1] === 'D13' && e[2].mode === 'out').map(e => e[0]);
  const dts = t.slice(2).map((x, i) => x - t[i + 1]);
  const worst = Math.max(...dts.map(d => Math.abs(d - 0.5)));
  ok(dts.length >= 9 && worst < 2e-5, 'blink toggles D13 every 500 ms of sim time', `${dts.length} intervals, worst |dt - 0.5 s| = ${(worst * 1e6).toFixed(2)} us`);
  const lv = r.ev.filter(e => e[1] === 'D13').map(e => e[2].level).slice(1);
  ok(lv.every((v, i) => v === (i % 2 === 0 ? 1 : 0)), 'D13 alternates HIGH / LOW');
  ok(r.runs < 60, 'blink wakes the MCU only at its edges', `${r.runs} runs for 5.2 s`);
}
{
  const src = 'void setup() { Serial.begin(9600); }\nvoid loop() { Serial.println(millis()); delay(250); }';
  const r = run(src, 1.0);
  ok(JSON.stringify(lines(r.out).slice(0, 4)) === JSON.stringify(['0', '250', '500', '750']), 'millis advances with delay', JSON.stringify(lines(r.out)));
}
{
  // a busy loop on an input advances time and exits when the pin changes
  const src = 'void setup() {\n  Serial.begin(9600);\n  pinMode(2, INPUT);\n  while (digitalRead(2));\n  Serial.println(millis());\n}\nvoid loop() {}';
  const r = run(src, 1, 'uno328', { volts: { D2: 5 }, edges: [[0.25, 'D2', 0]] });
  const ms = Number(lines(r.out)[0]);
  ok(ms >= 250 && ms <= 250 + READ_LEAD * 1000 + 1, 'while(digitalRead(2)); advances time and ends at the edge', `millis = ${ms}, ${r.runs} runs`);
  const h = run('void setup() { pinMode(2, INPUT); while (digitalRead(2)); }\nvoid loop() {}', 2, 'uno328', { volts: { D2: 5 } });
  ok(h.mcu.state().running && h.mcu.state().millis >= 1999, 'a busy loop that never ends still advances the clock (no hang)', `millis = ${h.mcu.state().millis}, ${h.runs} runs`);
  const e = run('void setup() {}\nvoid loop() {}', 1);
  ok(e.mcu.state().millis >= 999 && e.runs < 2000, 'an empty loop() costs time per pass', `${e.runs} runs for 1 s`);
}
{
  // interrupts: count RISING edges on D2 (interrupt 0)
  const src = `volatile int count = 0;
void onEdge() { count++; }
void setup() { Serial.begin(9600); pinMode(2, INPUT); attachInterrupt(digitalPinToInterrupt(2), onEdge, RISING); }
void loop() { delay(100); noInterrupts(); int c = count; interrupts(); Serial.println(c); }`;
  const edges = [];
  for (let k = 0; k < 7; k++) { edges.push([0.0101 + k * 0.01, 'D2', 5]); edges.push([0.0151 + k * 0.01, 'D2', 0]); }
  const r = run(src, 0.35, 'uno328', { volts: { D2: 0 }, edges });
  const got = lines(r.out).map(Number);
  ok(got[0] === 7 && got[got.length - 1] === 7, 'attachInterrupt fires once per rising edge', JSON.stringify(got));
  const both = run(src.replace('RISING', 'CHANGE'), 0.25, 'uno328', { volts: { D2: 0 }, edges });
  ok(lines(both.out).map(Number)[0] === 14, 'CHANGE fires on both edges', lines(both.out)[0]);
  const wrong = run(src.replace('digitalPinToInterrupt(2)', '2'), 0.25, 'uno328', { volts: { D2: 0 }, edges });
  ok((wrong.mcu.state().warnings || []).some(w => /interrupt 2 does not exist/.test(w)), 'attachInterrupt(2, ...) on the 328 warns', (wrong.mcu.state().warnings || [])[0]);
}
{
  // pulseIn measures a 1.5 ms HIGH pulse
  const src = 'void setup() { Serial.begin(9600); pinMode(7, INPUT); Serial.println(pulseIn(7, HIGH)); Serial.println(pulseIn(7, HIGH, 3000)); }\nvoid loop() {}';
  const r = run(src, 0.2, 'uno328', { volts: { D7: 0 }, edges: [[0.02, 'D7', 5], [0.0215, 'D7', 0]] });
  const got = lines(r.out).map(Number);
  ok(got[0] === 1500 && got[1] === 0, 'pulseIn reads 1500 us, then times out to 0', JSON.stringify(got));
}
{
  // tone with a duration stops itself
  const r = run('void setup() { tone(8, 440, 100); }\nvoid loop() {}', 0.3);
  const on = r.at('D8', 0.05), off = r.at('D8', 0.2);
  ok(on && on.mode === 'tone' && on.freq === 440 && off && off.mode === 'out' && off.level === 0, 'tone(8, 440, 100) plays, then stops at 100 ms', `${JSON.stringify(on)} then ${JSON.stringify(off)}`);
}
{
  // Serial TX blocks only when the 64-byte buffer is full (9600 baud: 1.04 ms a byte)
  const src = 'void setup() { Serial.begin(9600); unsigned long a = micros(); Serial.print("0123456789"); unsigned long b = micros(); for (int i = 0; i < 20; i++) Serial.print("0123456789"); unsigned long c = micros(); Serial.println(b - a); Serial.println(c - b); }\nvoid loop() {}';
  const got = lines(run(src, 1).out.replace(/^(0123456789)+/, '')).map(Number);
  ok(got[0] < 100 && Math.abs(got[1] - (210 - 64) * 1041.67) < 3000, 'Serial.print blocks once the TX buffer is full', `first ${got[0]} us, then ${got[1]} us`);
}

// ── io ──────────────────────────────────────────────────────────────────────
section('io: analogRead, analogWrite, Serial');
{
  const r = lines(run('void setup() { Serial.begin(9600); Serial.println(analogRead(A0)); Serial.println(analogRead(0)); }\nvoid loop() {}', 0.1, 'uno328', { volts: { A0: 2.5 } }).out);
  ok(r[0] === '512' && r[1] === '512', 'analogRead(2.5 V) = 512 on a 328 board (5 V ref, 10 bits)', JSON.stringify(r));
  const e = lines(run('void setup() { Serial.begin(115200); Serial.println(analogRead(34)); Serial.println(analogRead(A0)); }\nvoid loop() {}', 0.1, 'esp32dev', { volts: { 34: 2.5, VP: 3.3 } }).out);
  ok(e[0] === '3103' && e[1] === '4095', 'analogRead(2.5 V) = 3103 on the ESP32 (3.3 V ref, 12 bits)', JSON.stringify(e));
  const w = run('void setup() { analogWrite(9, 128); analogWrite(6, 64); analogWrite(10, 255); }\nvoid loop() {}', 0.1);
  const d9 = w.at('D9', 1), d6 = w.at('D6', 1), d10 = w.at('D10', 1);
  ok(d9.mode === 'pwm' && Math.abs(d9.duty - 128 / 255) < 1e-12 && d9.freq === 490, 'analogWrite(9, 128) gives duty 128/255 at 490 Hz', JSON.stringify(d9));
  ok(d6.freq === 980 && d10.mode === 'out' && d10.level === 1, 'pin 6 PWM is 980 Hz; analogWrite 255 is a plain HIGH', `${JSON.stringify(d6)} ${JSON.stringify(d10)}`);
  const s = run('void setup() { Serial.begin(9600); Serial.println(42); }\nvoid loop() {}', 0.1);
  ok(s.out === '42\r\n', 'Serial.println(42) emits "42\\r\\n"', JSON.stringify(s.out));
  const i = run('void setup() { Serial.begin(9600); int x = 32767; Serial.println(x + 1); }\nvoid loop() {}', 0.1);
  ok(i.out === '-32768\r\n', 'int wraps at 32767 + 1 on the 328', JSON.stringify(i.out));
  const pu = run('void setup() { digitalWrite(13, HIGH); }\nvoid loop() {}', 0.1);
  ok(pu.at('D13', 1).mode === 'in_pullup' && (pu.mcu.state().warnings || []).some(x => /pinMode/.test(x)), 'digitalWrite on an INPUT turns on the pull-up (and warns)', JSON.stringify(pu.at('D13', 1)));
  // Serial input
  const m = createMcu({ board: 'uno328', program: { lang: 'sketch', source: 'void setup() { Serial.begin(9600); }\nvoid loop() { if (Serial.available()) { int n = Serial.parseInt(); Serial.print("got "); Serial.println(n * 2); } }' } });
  m.serialIn('21\n');
  ok(lines(sim(m, 0.5).out)[0] === 'got 42', 'Serial.parseInt reads input from the monitor');
  const se = createMcu({ board: 'uno328', program: { lang: 'sketch', source: 'String line;\nvoid setup() { Serial.begin(9600); }\nvoid loop() {}\nvoid serialEvent() { line = Serial.readStringUntil(\'\\n\'); line.toUpperCase(); Serial.println(line); }' } });
  se.serialIn('hello\n');
  ok(lines(sim(se, 0.5).out)[0] === 'HELLO', 'serialEvent() runs after loop() when input waits', lines(sim(se, 0.5).out)[0]);
  // shiftOut: data sampled at each clock rising edge
  const so = run('void setup() { pinMode(11, OUTPUT); pinMode(12, OUTPUT); shiftOut(11, 12, MSBFIRST, 0xA5); shiftOut(11, 12, LSBFIRST, 0x01); }\nvoid loop() {}', 0.1);
  let data = 0, bits = [];
  for (const [, p, c] of so.ev) { if (p === 'D11') data = c.level; if (p === 'D12' && c.level === 1) bits.push(data); }
  ok(bits.join('') === '10100101' + '10000000', 'shiftOut sends MSB first and LSB first', bits.join(''));
  const times = so.ev.filter(e => e[1] === 'D12').map(e => e[0]);
  ok(times.every((t, k) => k === 0 || t > times[k - 1]), 'every clock edge lands at its own sim time');
  // servo
  const sv = run('#include <Servo.h>\nServo s;\nvoid setup() { s.attach(9); s.write(90); }\nvoid loop() {}', 0.1);
  const p9 = sv.at('D9', 1);
  ok(p9.mode === 'servo' && Math.abs(p9.pulse - 1472e-6) < 1e-9 && p9.freq === 50, 'Servo.write(90) drives a 1.472 ms pulse at 50 Hz', JSON.stringify(p9));
  // ESP32 LEDC
  const ld = run('void setup() { ledcAttach(4, 5000, 10); ledcWrite(4, 256); }\nvoid loop() {}', 0.1, 'esp32dev');
  const p4 = ld.at('4', 1);
  ok(p4.mode === 'pwm' && p4.duty === 0.25 && p4.freq === 5000, 'ESP32 ledcAttach / ledcWrite: duty 256/1024 at 5 kHz', JSON.stringify(p4));
}

// ── lcd ─────────────────────────────────────────────────────────────────────
section('LiquidCrystal pin edges, decoded by an HD44780 model in the test');
// An HD44780 that listens to drive() records: data latched on E falling.
function decodeLcd(ev, pins) {
  const lv = {};
  let eight = true, half = null, addr = 0, inc = 1;
  const ddram = new Array(128).fill(32);
  const cmd = v => {
    if (v & 0x80) { addr = v & 0x7f; return; }
    if (v & 0x40) return;
    if (v & 0x20) { eight = !!(v & 0x10); return; }
    if (v & 0x04 && !(v & 0x08) && !(v & 0x10)) { inc = v & 2 ? 1 : -1; return; }
    if (v === 0x01) { ddram.fill(32); addr = 0; return; }
    if ((v & 0xfe) === 0x02) addr = 0;
  };
  for (const [, p, c] of ev) {
    const prevE = lv[pins.e];
    lv[p] = c.mode === 'out' ? c.level : 0;
    if (p === pins.e && prevE === 1 && lv[p] === 0) {
      const nib = pins.d.reduce((s, d, i) => s | ((lv[d] || 0) << i), 0);
      if (eight) { cmd(nib << 4); continue; }
      if (half === null) { half = nib; continue; }
      const byte = (half << 4) | nib; half = null;
      if (lv[pins.rs]) { ddram[addr] = byte; addr = (addr + inc) & 0x7f; } else cmd(byte);
    }
  }
  const row = base => String.fromCharCode(...ddram.slice(base, base + 16));
  return [row(0), row(0x40)];
}
{
  const src = '#include <LiquidCrystal.h>\nLiquidCrystal lcd(12, 11, 5, 4, 3, 2);\nvoid setup() { lcd.begin(16, 2); lcd.print("HELLO"); lcd.setCursor(3, 1); lcd.print(42); }\nvoid loop() {}';
  const r = run(src, 0.3);
  const rows = decodeLcd(r.ev, { rs: 'D12', e: 'D11', d: ['D5', 'D4', 'D3', 'D2'] });
  ok(rows[0].startsWith('HELLO'), 'LiquidCrystal drives pin edges that decode to "HELLO"', JSON.stringify(rows[0]));
  ok(rows[1] === '   42           ', 'setCursor(3, 1) then print(42) lands on row 2', JSON.stringify(rows[1]));
  const ep = r.ev.filter(e => e[1] === 'D11');
  let minHigh = Infinity;
  for (let k = 1; k < ep.length; k++) if (ep[k - 1][2].level === 1) minHigh = Math.min(minHigh, ep[k][0] - ep[k - 1][0]);
  ok(minHigh >= 1e-6, 'E pulses are at least 1 us wide (HD44780 timing)', `${(minHigh * 1e6).toFixed(2)} us`);
}

// ── examples ────────────────────────────────────────────────────────────────
section('example sketches (mcu/sketches.js)');
for (const [key, s] of Object.entries(SKETCHES)) {
  const c = compileSketch(s.source, { board: s.board });
  ok(c.ok && !c.warnings.length, `compiles: ${key}`, c.ok ? (c.warnings.length ? c.warnings.map(w => w.msg).join('; ') : `${s.source.split('\n').length} lines`) : c.errors.map(e => `${e.line}: ${e.msg}`).join('; '));
}
for (const [b, src] of Object.entries(STARTERS)) ok(compileSketch(src, { board: b }).ok, `starter sketch compiles on ${b}`);
{
  const r = run(SKETCHES['uno-button-serial'].source, 2, 'uno328', { volts: { D2: 5 }, edges: [[0.5, 'D2', 0], [0.505, 'D2', 5], [0.51, 'D2', 0], [0.8, 'D2', 5], [1.2, 'D2', 0], [1.5, 'D2', 5]] });
  const l = lines(r.out);
  ok(JSON.stringify(l) === JSON.stringify(['Ready: press the button', 'Press 1', 'Press 2']), 'uno-button-serial: two presses (one bouncy) print Press 1, Press 2', JSON.stringify(l));
}
{
  const r = run(SKETCHES['uno-fade-pot'].source, 0.2, 'uno328', { volts: { A0: 2.5 } });
  const d9 = r.at('D9', 0.2);
  ok(lines(r.out)[0] === 'pot:512,duty:127' && d9.mode === 'pwm' && Math.abs(d9.duty - 127 / 255) < 1e-12, 'uno-fade-pot: A0 at 2.5 V gives duty 127/255', `${lines(r.out)[0]} ${JSON.stringify(d9)}`);
}
{
  const r = run(SKETCHES['uno-595'].source, 1.2);
  let data = 0, sh = 0; const latched = [];
  for (const [, p, c] of r.ev) {
    if (p === 'D11') data = c.level;
    if (p === 'D12' && c.level === 1) sh = ((sh << 1) | data) & 255;
    if (p === 'D8' && c.level === 1) latched.push(sh);
  }
  ok(JSON.stringify(latched.slice(0, 10)) === JSON.stringify([0, 1, 2, 4, 8, 16, 32, 64, 128, 64]), 'uno-595: the latched bytes sweep 1, 2, 4 ... 128 and back', JSON.stringify(latched.slice(0, 11)));
}
{
  const r = run(SKETCHES['uno-7seg'].source, 6.5);
  const DIG = [0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110, 0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111];
  const seen = [];
  for (let d = 0; d < 10; d++) {
    const t = 0.3 + d * 0.6;
    seen.push([2, 3, 4, 5, 6, 7, 8].reduce((s, p, i) => s | ((r.at('D' + p, t) || {}).level << i), 0));
  }
  ok(JSON.stringify(seen) === JSON.stringify(DIG), 'uno-7seg: the segments show 0 to 9', seen.map(x => x.toString(2)).join(' '));
}
{
  // thermistor at 23.4 C: Rt = R25 exp(B (1/T - 1/T25)); ADC = 1023 Rt / (R + Rt)
  const T = 23.4 + 273.15, Rt = 10000 * Math.exp(3950 * (1 / T - 1 / 298.15));
  const adc = Math.round(1023 * Rt / (10000 + Rt));
  const v = (adc + 0.5) / 1024 * 5;
  const r = run(SKETCHES['uno-lcd-thermo'].source, 1.0, 'uno328', { volts: { A0: v } });
  const rows = decodeLcd(r.ev, { rs: 'D12', e: 'D11', d: ['D5', 'D4', 'D3', 'D2'] });
  const back = 1 / (1 / 298.15 + Math.log((10000 * adc / (1023 - adc)) / 10000) / 3950) - 273.15;
  ok(rows[0] === `TEMP ${L.fmtFloat(back, 1)} C     `.slice(0, 16) && Math.abs(back - 23.4) < 0.1, 'uno-lcd-thermo: the LCD shows "TEMP 23.4 C"', JSON.stringify(rows));
}
{
  const r = run(SKETCHES['uno-melody'].source, 3.2);
  const tones = r.ev.filter(e => e[1] === 'D8' && e[2].mode === 'tone').map(e => e[2].freq);
  ok(JSON.stringify(tones.slice(0, 8)) === JSON.stringify([262, 330, 392, 523, 392, 440, 494, 523]), 'uno-melody: tone() plays the notes in order', JSON.stringify(tones.slice(0, 8)));
}
{
  const r = run(SKETCHES['uno-servo'].source, 0.2, 'uno328', { volts: { A0: (t) => t < 0.1 ? 0 : 5 } });
  const a = r.at('D9', 0.05), b = r.at('D9', 0.19);
  ok(Math.abs(a.pulse - 544e-6) < 1e-9 && Math.abs(b.pulse - 2400e-6) < 1e-9, 'uno-servo: pot 0 V -> 0 deg (0.544 ms), 5 V -> 180 deg (2.4 ms)', `${a.pulse * 1e3} ms, ${b.pulse * 1e3} ms`);
}
{
  const r = run(SKETCHES['esp32-traffic'].source, 8.5, 'esp32dev');
  const at = t => ['25', '26', '27'].map(p => (r.at(p, t) || {}).level).join('');
  ok(at(1) === '100' && at(3.5) === '110' && at(5) === '001' && at(7.5) === '010', 'esp32-traffic: red, red+amber, green, amber', [1, 3.5, 5, 7.5].map(at).join(' '));
  ok(lines(r.out.replace(/\n/g, '\r\n'))[0] === 'RED    3000 ms', 'esp32-traffic: Serial.printf phase lines', JSON.stringify(lines(r.out.replace(/\n/g, '\r\n'))[0]));
}
{
  const r = run(SKETCHES['nano-joystick'].source, 0.2, 'nano328', { volts: { A0: 0, A1: 2.5, D2: 5 } });
  const x = r.at('D5', 0.2), y = r.at('D6', 0.2);
  ok(x.mode === 'out' && x.level === 1 && y.mode === 'out' && y.level === 0, 'nano-joystick: stick hard left -> LED X full, Y centred -> LED Y off', `${JSON.stringify(x)} ${JSON.stringify(y)}`);
}
// programs in INTEGRATE's example files, when they exist
{
  const dir = join(HERE, '..', 'examples');
  let files = [];
  try { files = readdirSync(dir).filter(f => f.endsWith('.json')); } catch (e) { /* not written yet */ }
  let n = 0, bad = [];
  for (const f of files) {
    let ex; try { ex = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch (e) { bad.push(f + ': bad JSON'); continue; }
    const doc = ex.doc || ex;
    for (const [pid, prog] of Object.entries(doc.programs || {})) {
      if (!prog || prog.lang !== 'sketch') continue;
      const part = (doc.parts || []).find(p => p.id === pid);
      const board = part && boardOf(part.def);
      if (!board) { bad.push(`${f}: program ${pid} is not on an MCU part`); continue; }
      const c = compileSketch(prog.source, { board }); n++;
      if (!c.ok) bad.push(`${f} ${pid}: ${c.errors.map(e => `${e.line}: ${e.msg}`).join('; ')}`);
    }
  }
  ok(!bad.length, `example files: every sketch compiles`, files.length ? `${n} sketches in ${files.length} files${bad.length ? '; ' + bad.join(' | ') : ''}` : 'no example files yet');
}

// ── co-simulation with SIM's engine (when sim/engine.js exists) ─────────────
if (existsSync(join(HERE, '..', 'sim', 'engine.js'))) {
  section('co-simulation: sim/engine.js drives this runtime');
  const { createEngine } = await import('../sim/engine.js');
  const mk = (elements, pins, source, extra = {}) => ({
    nodeCount: 12, nodeNames: Array.from({ length: 12 }, (_, i) => 'n' + i), ground: { node: 0, why: 'mcu GND' },
    elements: [{ id: 'src/main', owner: 'src', type: 'vsource', nodes: { p: 1, n: 0 }, params: { wave: { kind: 'dc', v: 5 } } }, ...elements],
    mcus: [{ id: 'u1', board: 'uno328', pins, gnd: 0, vdd: 1, program: extra.program || { lang: 'sketch', source } }],
    probes: [], holeNode: {}, pinNode: {}, wireIds: [], issues: []
  });
  try {
    const nl = mk([{ id: 'r/main', owner: 'r', type: 'resistor', nodes: { a: 2, b: 3 }, params: { r: 220 } }, { id: 'led/main', owner: 'led', type: 'led', nodes: { a: 3, k: 0 }, params: { color: 'red' } }], { D13: 2 }, SKETCHES['uno-blink'].source);
    const eng = createEngine(nl, { mcuFactory: spec => createMcu(spec) });
    eng.dcop();
    const I = [];
    for (let k = 1; k <= 22; k++) { eng.advanceTo(k * 0.1, 1e9); I.push(eng.i('led/main')); }
    const on = I.filter((_, k) => (k + 1) % 10 >= 1 && (k + 1) % 10 <= 4), off = I.filter((_, k) => (k + 1) % 10 >= 6 && (k + 1) % 10 <= 9);
    ok(on.every(i => i > 0.01) && off.every(i => i < 1e-4), 'uno-blink in the engine: the LED current is on for 0.5 s, off for 0.5 s', `on ${(on[0] * 1e3).toFixed(2)} mA, off ${(off[0] * 1e3).toFixed(4)} mA`);
  } catch (e) { ok(false, 'uno-blink in the engine', e.message); }
  try {
    const nl = mk([
      { id: 'lcd/main', owner: 'lcd', type: 'hd44780', nodes: { vss: 0, vdd: 1, v0: 8, rs: 2, rw: 0, e: 3, d0: 0, d1: 0, d2: 0, d3: 0, d4: 4, d5: 5, d6: 6, d7: 7 }, params: {} },
      { id: 'pot/main', owner: 'pot', type: 'resistor', nodes: { a: 8, b: 0 }, params: { r: 1000 } },
      { id: 'bz/main', owner: 'bz', type: 'buzzer', nodes: { a: 9, b: 0 }, params: { active: false } }
    ], { D12: 2, D11: 3, D5: 4, D4: 5, D3: 6, D2: 7, D8: 9 }, '#include <LiquidCrystal.h>\nLiquidCrystal lcd(12, 11, 5, 4, 3, 2);\nvoid setup() { lcd.begin(16, 2); lcd.print("HELLO"); tone(8, 440); }\nvoid loop() {}');
    const e2 = createEngine(nl, { mcuFactory: spec => createMcu(spec) });
    e2.dcop();
    const t0 = performance.now();
    e2.advanceTo(0.3, 1e9);
    const f = e2.frame(), ms = performance.now() - t0;
    const rows = f.parts.lcd && f.parts.lcd.vis && f.parts.lcd.vis.rows;
    ok(rows && rows[0].startsWith('HELLO'), "LiquidCrystal pin edges -> SIM's hd44780 shows HELLO", rows ? JSON.stringify(rows[0]) + ` (${ms.toFixed(0)} ms wall for 0.3 s)` : 'no rows');
    const fz = f.parts.bz && f.parts.bz.vis && f.parts.bz.vis.freq;
    ok(Math.abs(fz - 440) / 440 < 0.01, 'tone(8, 440) -> buzzer vis.freq within 1 % of 440 Hz', fz);
  } catch (e) { ok(false, 'LCD and tone in the engine', e.message); }
  if (existsSync(join(HERE, 'avr.js'))) {
    try {
      const { TOGGLE, toHex } = await import('./avr-tests.mjs');
      const bytes = []; for (const w of TOGGLE) bytes.push(w & 255, w >> 8);
      const nl = mk([{ id: 'r/main', owner: 'r', type: 'resistor', nodes: { a: 2, b: 3 }, params: { r: 220 } }, { id: 'led/main', owner: 'led', type: 'led', nodes: { a: 3, k: 0 }, params: { color: 'red' } }], { D13: 2 }, null, { program: { lang: 'hex', hex: toHex(bytes) } });
      const e3 = createEngine(nl, { mcuFactory: spec => createMcu(spec) });
      e3.dcop();
      const samples = [];
      for (let k = 1; k <= 12; k++) { e3.advanceTo(k * 0.001 - 0.0005, 1e9); samples.push(e3.i('led/main') > 0.005 ? 1 : 0); }
      const flips = samples.slice(1).filter((v, k) => v !== samples[k]).length;
      ok(flips >= 10, 'the HEX toggle program in the engine: the LED flips every millisecond', samples.join(''));
    } catch (e) { ok(false, 'the HEX program in the engine', e.message); }
  }
}

// ── the compiler modules (mcu/compile/) ─────────────────────────────────────
section('compiler modules: the exports of compile.js and the assembled Gen');
{
  const C = await import('./compile.js');
  const names = Object.keys(C).sort().join(' ');
  ok(names === 'BUILTINS CErr LIBS compileSketch isFloat isInt isNum lex', 'compile.js keeps its exports', names);
  const { Gen } = await import('./compile/gen.js');
  const want = ['program', 'funcBody', 'stmt', 'localVar', 'expr', 'incdec', 'call', 'objCall', 'conv', 'constEval'];
  const missing = want.filter(m => typeof Gen.prototype[m] !== 'function');
  ok(!missing.length, 'Gen has the methods of every part (core, decls, stmts, exprs, calls)', missing.join(', ') || want.length + ' methods');
  const e = C.compileSketch('void setup() {\n  struct P { int x; };\n}\nvoid loop() {}');
  ok(!e.ok && e.errors[0].line === 2 && e.errors[0].msg.includes('structs'), 'a CErr from the parser module keeps its line', JSON.stringify(e.errors[0]));
}

// ── speed ───────────────────────────────────────────────────────────────────
section('speed');
{
  const t0 = performance.now();
  const r = run('int n = 0;\nvoid setup() {}\nvoid loop() { for (int i = 0; i < 100; i++) n += i; digitalWrite(13, (n / 4950) & 1); }', 1.0);
  const ms = performance.now() - t0;
  ok(ms < 1500, 'a busy compute + pin loop runs 1 s of sim time', `${ms.toFixed(0)} ms wall, ${r.runs} runs, ${r.ev.length} pin changes`);
}

// ── avr ─────────────────────────────────────────────────────────────────────
if (existsSync(join(HERE, 'avr.js'))) {
  section('avr8js HEX runner');
  const { avrTests } = await import('./avr-tests.mjs').catch(() => ({}));
  if (avrTests) await avrTests({ ok, sim });
  else ok(false, 'mcu/avr-tests.mjs is missing');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
