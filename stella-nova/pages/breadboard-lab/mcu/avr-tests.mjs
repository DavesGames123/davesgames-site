// ============================================================================
//  BREADBOARD LAB  ·  mcu/avr-tests.mjs — the HEX runner (avr8js)
// ----------------------------------------------------------------------------
//  Called by mcu/tests.mjs when mcu/avr.js exists (CONTRACT 7: "a hand-
//  assembled 20-byte AVR program, written as bytes in the test, toggles
//  PB5; the runtime reports the edges").
//
//    TOGGLE ......... the program, word by word, with its assembly
//    toHex .......... bytes -> Intel HEX text (so the test goes through the
//                     same parser a user's file does)
//    avrTests ....... the checks
// ============================================================================
import { createMcu } from './runtime.js';
import { parseHex, F_CPU } from './avr.js';

// PB5 (D13) toggles about every millisecond.
//   0: E200  ldi  r16, 0x20      ; PB5 mask
//   1: B904  out  DDRB, r16      ; PB5 is an output
//   2: B115  in   r17, PORTB     ; loop:
//   3: 2710  eor  r17, r16
//   4: B915  out  PORTB, r17     ; toggle PB5
//   5: EA80  ldi  r24, 0xA0
//   6: E09F  ldi  r25, 0x0F      ; r25:r24 = 4000
//   7: 9701  sbiw r24, 1         ; dl: 2 cycles
//   8: F7F1  brne dl             ; 2 cycles when taken
//   9: CFF8  rjmp loop
// One pass: 1+1+1+1+1 + 4000*4 - 1 + 2 = 16006 cycles = 1.000375 ms.
export const TOGGLE = [0xE200, 0xB904, 0xB115, 0x2710, 0xB915, 0xEA80, 0xE09F, 0x9701, 0xF7F1, 0xCFF8];
export const TOGGLE_CYCLES = 16006;

export function toHex(bytes, perLine = 16) {
  const out = [];
  for (let a = 0; a < bytes.length; a += perLine) {
    const d = bytes.slice(a, a + perLine);
    const rec = [d.length, (a >> 8) & 255, a & 255, 0, ...d];
    const sum = (256 - (rec.reduce((s, x) => s + x, 0) & 255)) & 255;
    out.push(':' + [...rec, sum].map(x => x.toString(16).toUpperCase().padStart(2, '0')).join(''));
  }
  out.push(':00000001FF');
  return out.join('\n') + '\n';
}

// D2 (PD2) copied to D13 (PB5) in a loop: reads go through the port pins.
//   E200 ldi r16,0x20 / B904 out DDRB,r16 / B119 loop: in r17,PIND / 0F11 lsl r17 (x3)
//   7210 andi r17,0x20 / B915 out PORTB,r17 / CFF9 rjmp loop (k = 2 - 9 = -7)
export const FOLLOW = [0xE200, 0xB904, 0xB119, 0x0F11, 0x0F11, 0x0F11, 0x7210, 0xB915, 0xCFF9];

export async function avrTests({ ok, sim }) {
  const bytes = [];
  for (const w of TOGGLE) bytes.push(w & 255, w >> 8);
  ok(bytes.length === 20, 'the hand-assembled program is 20 bytes');
  const hex = toHex(bytes);
  const parsed = parseHex(hex);
  ok(parsed.size === 20 && parsed.bytes[0] === 0x00 && parsed.bytes[1] === 0xE2, 'parseHex reads the Intel HEX back', `${parsed.size} bytes`);
  let threw = '';
  try { parseHex(hex.replace(':00000001FF', ':00000001FE')); } catch (e) { threw = e.message; }
  ok(/checksum/.test(threw), 'a bad checksum is an error', threw);

  const mcu = createMcu({ board: 'uno328', program: { lang: 'hex', hex } });
  ok(mcu.state().running, 'createMcu({ lang: "hex" }) makes a running ATmega328P');
  const r = sim(mcu, 0.0105);
  const all = r.ev.filter(e => e[1] === 'D13' && e[2].mode === 'out');
  ok(all[0] && all[0][2].level === 0 && all[0][0] < 1e-6, 'out DDRB makes PB5 an output LOW in the first cycles', all[0] ? `${(all[0][0] * 1e9).toFixed(1)} ns` : 'no edge');
  const edges = all.slice(1);
  const dts = edges.slice(1).map((e, i) => e[0] - edges[i][0]);
  const want = TOGGLE_CYCLES / F_CPU;
  const worst = dts.length ? Math.max(...dts.map(d => Math.abs(d - want))) : Infinity;
  ok(edges.length >= 10 && worst < 1e-9, 'PB5 (D13) toggles every 16006 cycles; the runtime reports each edge at its sim time', `${edges.length} edges, period ${(dts[1] * 1e3).toFixed(6)} ms, worst error ${(worst * 1e9).toFixed(3)} ns`);
  ok(edges.map(e => e[2].level).slice(0, 4).join('') === '1010', 'the levels alternate, starting HIGH', edges.map(e => e[2].level).slice(0, 6).join(''));
  ok(r.runs < 60, 'the MCU wakes the sim about once per edge', `${r.runs} runs for 10.5 ms`);
  const fb = []; for (const w of FOLLOW) fb.push(w & 255, w >> 8);
  const f = createMcu({ board: 'uno328', program: { lang: 'hex', hex: toHex(fb) } });
  const rf = sim(f, 0.01, { volts: { D2: 0 }, edges: [[0.003, 'D2', 5], [0.006, 'D2', 0]] });
  const up = rf.ev.find(e => e[1] === 'D13' && e[2].level === 1), dn = up && rf.ev.find(e => e[1] === 'D13' && e[2].level === 0 && e[0] > up[0]);
  ok(up && dn && up[0] >= 0.003 && up[0] - 0.003 < 1.1e-3 && dn[0] >= 0.006 && dn[0] - 0.006 < 1.1e-3, 'a program that copies D2 to D13 follows the input edges (within the 1 ms lead)', up && dn ? `rise after ${((up[0] - 0.003) * 1e6).toFixed(1)} us, fall after ${((dn[0] - 0.006) * 1e6).toFixed(1)} us` : 'no edges');
  const bad = createMcu({ board: 'esp32dev', program: { lang: 'hex', hex } });
  ok(!bad.state().running && /328 boards only/.test(bad.state().error), 'HEX on the ESP32 is refused with a message', bad.state().error);
  const junk = createMcu({ board: 'uno328', program: { lang: 'hex', hex: 'hello' } });
  ok(!junk.state().running && /HEX line 1/.test(junk.state().error), 'a broken HEX file is refused with its line', junk.state().error);
}
