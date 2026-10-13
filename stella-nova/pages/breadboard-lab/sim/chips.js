// ============================================================================
//  BREADBOARD LAB  ·  sim/chips.js — logic chip tables and the HD44780 core
// ----------------------------------------------------------------------------
//  Pure logic, no matrix. sim/digital.js wraps these in devices that read
//  pin voltages and drive output pins.
//
//  CHIPS maps a chip name ('74hc00', '00', 'cd4017', …) to its pin map and
//  a step function. step(st, lv, rise, fall) gets the input levels by DIP
//  pin number, the rising and falling edges since the last call, and the
//  chip state. It returns the output levels by pin: 1, 0 or 'z'.
//
//  PIN-OUTS (DIP, top view, pin 1 at the notch):
//    74HC00/08/32/86  1A 1B 1Y 2A 2B 2Y GND 3Y 3A 3B 4Y 4A 4B VCC
//    74HC02 (NOR)     1Y 1A 1B 2Y 2A 2B GND 3A 3B 3Y 4A 4B 4Y VCC
//    74HC04           1A 1Y 2A 2Y 3A 3Y GND 4Y 4A 5Y 5A 6Y 6A VCC
//    74HC74           1CLR 1D 1CLK 1PRE 1Q 1Q̄ GND 2Q̄ 2Q 2PRE 2CLK 2D 2CLR VCC
//    74HC595          QB QC QD QE QF QG QH GND QH' SRCLR SRCLK RCLK OE SER QA VCC
//    CD4017           Q5 Q1 Q0 Q2 Q6 Q7 Q3 VSS Q8 Q4 Q9 CO INH CLK RST VDD
//
//  HD44780. The controller of a 16×2 LCD: 8-bit and 4-bit bus, the
//  instruction set (clear, home, entry mode, display control, shift,
//  function set, CGRAM and DDRAM address), DDRAM of 2 × 40 and CGRAM of 8
//  characters. Character ROM A00 subset: ASCII, 0x5C '¥', 0x7E '→', 0x7F
//  '←', 0xDF '°'. CGRAM codes 0–7 (and 8–15) come out as U+E000–U+E007; the
//  bitmaps are in vis.cgram.
//
//  GREP MAP
//    gateChip ........... quad two-input gates and the hex inverter
//    CHIPS .............. the table (aliases '00' … 'cd4017')
//    chipOf ............. lookup by name
//    exprCompile ........ logic-expr parser (! ~ & | ^ and parentheses)
//    Hd44780 ............ the LCD controller: bus(), rows(), cursor()
//    lcdChar ............ the character ROM subset
// ============================================================================

const GATES = {
  nand: (a, b) => (a && b ? 0 : 1),
  and: (a, b) => (a && b ? 1 : 0),
  or: (a, b) => (a || b ? 1 : 0),
  nor: (a, b) => (a || b ? 0 : 1),
  xor: (a, b) => (a !== b ? 1 : 0),
};

function gateChip(fn, map) {
  // map: [[inA, inB, out], …]
  const inputs = [], outputs = [];
  for (const [a, b, y] of map) { inputs.push(a, b); outputs.push(y); }
  return {
    pins: 14, vcc: 14, gnd: 7, family: 'hc', inputs, outputs,
    step(st, lv) {
      const o = {};
      for (const [a, b, y] of map) o[y] = GATES[fn](lv[a], lv[b]);
      return o;
    },
  };
}
const QUAD = [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]];
const NOR_MAP = [[2, 3, 1], [5, 6, 4], [8, 9, 10], [11, 12, 13]];
const INV_MAP = [[1, 2], [3, 4], [5, 6], [9, 8], [11, 10], [13, 12]];

const HC04 = {
  pins: 14, vcc: 14, gnd: 7, family: 'hc',
  inputs: INV_MAP.map(m => m[0]), outputs: INV_MAP.map(m => m[1]),
  step(st, lv) { const o = {}; for (const [a, y] of INV_MAP) o[y] = lv[a] ? 0 : 1; return o; },
};

const HC74 = {
  pins: 14, vcc: 14, gnd: 7, family: 'hc',
  inputs: [1, 2, 3, 4, 10, 11, 12, 13], outputs: [5, 6, 8, 9],
  init() { return { q: [0, 0] }; },
  step(st, lv, rise) {
    const ffs = [{ clr: 1, d: 2, clk: 3, pre: 4, q: 5, qn: 6 }, { clr: 13, d: 12, clk: 11, pre: 10, q: 9, qn: 8 }];
    const o = {};
    ffs.forEach((f, i) => {
      const clr = !lv[f.clr], pre = !lv[f.pre];
      if (clr && pre) { st.q[i] = 1; o[f.q] = 1; o[f.qn] = 1; return; }
      if (clr) st.q[i] = 0;
      else if (pre) st.q[i] = 1;
      else if (rise[f.clk]) st.q[i] = lv[f.d] ? 1 : 0;
      o[f.q] = st.q[i]; o[f.qn] = st.q[i] ? 0 : 1;
    });
    return o;
  },
};

// 74HC595: QA = pin 15, QB..QH = pins 1..7, QH' = 9
const Q595 = [15, 1, 2, 3, 4, 5, 6, 7];
const HC595 = {
  pins: 16, vcc: 16, gnd: 8, family: 'hc',
  inputs: [10, 11, 12, 13, 14], outputs: [...Q595, 9],
  init() { return { sr: 0, latch: 0 }; },
  step(st, lv, rise) {
    // storage clock first: when both clocks rise together the latch takes
    // the old shift register (the datasheet "one clock behind" rule)
    if (rise[12]) st.latch = st.sr;
    if (!lv[10]) st.sr = 0;
    else if (rise[11]) st.sr = ((st.sr << 1) | (lv[14] ? 1 : 0)) & 0xff;
    const o = {};
    const oe = !lv[13];
    Q595.forEach((p, i) => { o[p] = oe ? (st.latch >> i) & 1 : 'z'; });
    o[9] = (st.sr >> 7) & 1;
    return o;
  },
};

// CD4017 decade counter
const Q4017 = [3, 2, 4, 7, 10, 1, 5, 6, 9, 11];
const CD4017 = {
  pins: 16, vcc: 16, gnd: 8, family: 'cmos4000',
  inputs: [13, 14, 15], outputs: [...Q4017, 12],
  init() { return { n: 0 }; },
  step(st, lv, rise, fall) {
    if (lv[15]) st.n = 0;
    else if ((rise[14] && !lv[13]) || (fall[13] && lv[14])) st.n = (st.n + 1) % 10;
    const o = {};
    Q4017.forEach((p, i) => { o[p] = st.n === i ? 1 : 0; });
    o[12] = st.n < 5 ? 1 : 0;
    return o;
  },
};

export const CHIPS = {
  '74hc00': gateChip('nand', QUAD),
  '74hc02': gateChip('nor', NOR_MAP),
  '74hc04': HC04,
  '74hc08': gateChip('and', QUAD),
  '74hc32': gateChip('or', QUAD),
  '74hc86': gateChip('xor', QUAD),
  '74hc74': HC74,
  '74hc595': HC595,
  cd4017: CD4017,
};
export const FAMILIES = {
  hc: { rout: 50, vil: 0.3, vih: 0.7, vmin: 1.5, iq: 2e-6 },
  cmos4000: { rout: 400, vil: 0.3, vih: 0.7, vmin: 1.5, iq: 1e-6 },
};

export function chipOf(name) {
  const k = String(name || '').toLowerCase().replace(/^ic-/, '');
  if (CHIPS[k]) return CHIPS[k];
  if (CHIPS['74hc' + k]) return CHIPS['74hc' + k];
  if (k === '4017' || k === 'cd4017') return CHIPS.cd4017;
  return null;
}

// --------------------------------------------------------- logic expressions
// Grammar: or := xor ('|' xor)* ; xor := and ('^' and)* ; and := un ('&' un)* ;
// un := ('!'|'~') un | '(' or ')' | name | 0 | 1. '+' is OR and '*' is AND.
export function exprCompile(src) {
  const toks = String(src).match(/[A-Za-z_][A-Za-z0-9_.]*|[01]|[!~&|^()+*]/g) || [];
  let i = 0;
  const names = new Set();
  const peek = () => toks[i];
  function un() {
    const t = toks[i++];
    if (t === '!' || t === '~') { const a = un(); return v => (a(v) ? 0 : 1); }
    if (t === '(') { const a = or(); if (toks[i++] !== ')') throw new Error('missing )'); return a; }
    if (t === '0') return () => 0;
    if (t === '1') return () => 1;
    if (t && /^[A-Za-z_]/.test(t)) { names.add(t); return v => (v[t] ? 1 : 0); }
    throw new Error(`unexpected "${t ?? 'end'}" in "${src}"`);
  }
  function and() { let a = un(); while (peek() === '&' || peek() === '*') { i++; const b = un(), c = a; a = v => c(v) & b(v); } return a; }
  function xor() { let a = and(); while (peek() === '^') { i++; const b = and(), c = a; a = v => c(v) ^ b(v); } return a; }
  function or() { let a = xor(); while (peek() === '|' || peek() === '+') { i++; const b = xor(), c = a; a = v => c(v) | b(v); } return a; }
  const f = or();
  if (i !== toks.length) throw new Error(`unexpected "${toks[i]}" in "${src}"`);
  return { fn: f, names: [...names] };
}

// ----------------------------------------------------------------- HD44780
export function lcdChar(c) {
  if (c < 16) return String.fromCharCode(0xe000 + (c & 7));
  if (c === 0x5c) return '¥';
  if (c === 0x7e) return '→';
  if (c === 0x7f) return '←';
  if (c === 0xdf) return '°';
  if (c >= 0x20 && c < 0x7e) return String.fromCharCode(c);
  if (c === 0xff) return '█';
  return ' ';
}

export class Hd44780 {
  constructor() { this.powerOn(); }
  powerOn() {
    this.dl8 = true; this.lines2 = false; this.ddram = new Uint8Array(128).fill(0x20);
    this.cgram = new Uint8Array(64); this.ac = 0; this.cg = false; this.inc = true; this.sh = false;
    this.disp = false; this.cur = false; this.blink = false; this.shift = 0; this.half = null;
  }
  // E falling edge: rs, rw levels and the 8 data levels (d0..d7)
  bus(rs, rw, data) {
    if (rw) return;
    if (this.dl8) { this.exec(rs, data & 0xff); return; }
    const nib = (data >> 4) & 0x0f;
    if (this.half == null) { this.half = nib; return; }
    const v = (this.half << 4) | nib;
    this.half = null;
    this.exec(rs, v);
  }
  exec(rs, v) {
    if (rs) { this.writeData(v); return; }
    if (v & 0x80) { this.cg = false; this.ac = v & 0x7f; return; }
    if (v & 0x40) { this.cg = true; this.ac = v & 0x3f; return; }
    if (v & 0x20) {
      const dl = !!(v & 0x10);
      if (dl !== this.dl8) { this.dl8 = dl; this.half = null; }
      this.lines2 = !!(v & 0x08);
      return;
    }
    if (v & 0x10) {
      const sc = v & 0x08, right = v & 0x04;
      if (sc) this.shift = (this.shift + (right ? -1 : 1) + 40) % 40;
      else this.moveAc(right ? 1 : -1);
      return;
    }
    if (v & 0x08) { this.disp = !!(v & 4); this.cur = !!(v & 2); this.blink = !!(v & 1); return; }
    if (v & 0x04) { this.inc = !!(v & 2); this.sh = !!(v & 1); return; }
    if (v & 0x02) { this.ac = 0; this.cg = false; this.shift = 0; return; }
    if (v & 0x01) { this.ddram.fill(0x20); this.ac = 0; this.cg = false; this.shift = 0; this.inc = true; return; }
  }
  moveAc(d) {
    if (this.cg) { this.ac = (this.ac + d + 64) % 64; return; }
    if (!this.lines2) { this.ac = (this.ac + d + 80) % 80; return; }
    let a = this.ac + d;
    if (this.ac <= 0x27 && a > 0x27) a = 0x40;
    else if (this.ac >= 0x40 && a > 0x67) a = 0x00;
    else if (this.ac === 0x40 && a < 0x40) a = 0x27;
    else if (this.ac === 0 && a < 0) a = 0x67;
    this.ac = a;
  }
  writeData(v) {
    if (this.cg) { this.cgram[this.ac & 63] = v & 0x1f; this.moveAc(this.inc ? 1 : -1); return; }
    this.ddram[this.ac & 127] = v;
    this.moveAc(this.inc ? 1 : -1);
    if (this.sh) this.shift = (this.shift + (this.inc ? 1 : -1) + 40) % 40;
  }
  rows() {
    if (!this.disp) return ['                ', '                '];
    const line = base => {
      let s = '';
      for (let i = 0; i < 16; i++) s += lcdChar(this.ddram[base + ((i + this.shift) % 40)]);
      return s;
    };
    if (!this.lines2) {
      let s = '';
      for (let i = 0; i < 16; i++) s += lcdChar(this.ddram[(i + this.shift) % 80]);
      return [s, '                '];
    }
    return [line(0), line(0x40)];
  }
  cursor() {
    if (this.cg) return { r: 0, c: 0, on: false };
    const r = this.lines2 && this.ac >= 0x40 ? 1 : 0;
    const col = ((this.ac - (r ? 0x40 : 0)) - this.shift + 40) % 40;
    return { r, c: col, on: this.disp && (this.cur || this.blink) && col < 16, blink: this.blink };
  }
  cgramRows() {
    const out = [];
    for (let k = 0; k < 8; k++) out.push(Array.from(this.cgram.subarray(k * 8, k * 8 + 8)));
    return out;
  }
  save() {
    return { dl8: this.dl8, lines2: this.lines2, ddram: Array.from(this.ddram), cgram: Array.from(this.cgram), ac: this.ac, cg: this.cg, inc: this.inc, sh: this.sh, disp: this.disp, cur: this.cur, blink: this.blink, shift: this.shift, half: this.half };
  }
  restore(s) {
    Object.assign(this, s);
    this.ddram = Uint8Array.from(s.ddram); this.cgram = Uint8Array.from(s.cgram);
  }
}
