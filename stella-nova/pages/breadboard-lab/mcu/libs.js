// ============================================================================
//  BREADBOARD LAB  ·  mcu/libs.js — the Arduino libraries of the sketch runtime
// ----------------------------------------------------------------------------
//  Original implementations written for this page. They follow the PUBLIC
//  behaviour of the Arduino core (what a sketch can observe), not its code:
//
//    Print .......... print(int) in decimal, print(x, HEX) in upper case and
//                     as unsigned long for negative values, print(float) with
//                     2 decimals rounded half up, "nan" / "inf" / "ovf".
//    String ......... String(x, HEX) in lower case, String(float) with 2
//                     decimals, toInt() as atol, mutating toUpperCase/trim.
//    Serial ......... a 64-byte RX buffer, a 64-byte TX buffer drained at
//                     10 bits per byte at the baud rate: a print blocks only
//                     when the TX buffer is full (CONTRACT 6).
//    LiquidCrystal .. drives the real RS / E / D pins with the HD44780
//                     4-bit (or 8-bit) protocol and its timing; the hd44780
//                     element of SIM decodes those pin edges.
//    Servo .......... 50 Hz pulses, 544..2400 us for 0..180 degrees.
//
//  Every method that touches a pin or blocks is a generator, called by the
//  generated code with yield*. `rt` is the runtime of one MCU (runtime.js).
//
//  GREP MAP
//    SketchError .............. a run-time error with the sketch line
//    fmtFloat / printText ..... the Print formatting rules
//    strText / STRING ......... String(x) and the String methods ($.sm)
//    cprintf .................. printf / sprintf (no %f on the 328 boards)
//    cstr / mkArr / ix ........ char arrays, typed arrays, bounds checks
//    makeSerial ............... Serial
//    makeLCD .................. LiquidCrystal
//    makeServo ................ Servo
// ============================================================================

export class SketchError extends Error {}

// ── Print formatting ─────────────────────────────────────────────────────────
export function fmtFloat(x, digits = 2) {
  digits = Math.max(0, Math.trunc(digits));
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return 'inf';
  if (x > 4294967040 || x < -4294967040) return 'ovf';
  let s = '';
  if (x < 0) { s = '-'; x = -x; }
  let r = 0.5;
  for (let i = 0; i < digits; i++) r /= 10;
  x += r;
  const ip = Math.floor(x);
  let rem = x - ip;
  s += String(ip);
  if (digits > 0) s += '.';
  for (let i = 0; i < digits; i++) { rem *= 10; const d = Math.min(9, Math.floor(rem)); s += d; rem -= d; }
  return s;
}
const SIGNED = new Set(['char', 'i8', 'i16', 'i32']);
const BITS = { bool: 8, char: 8, i8: 8, u8: 8, i16: 16, u16: 16, i32: 32, u32: 32 };

// print(v) / print(v, fmt) as Print does it. tag: the C type of v (compile.js)
export function printText(v, tag, fmt) {
  if (tag === 'cstr' || tag === 'String') return String(v);
  if (tag === 'chararr') return cstr(v);
  if (tag === 'f32' || tag === 'f64') return fmtFloat(v, fmt === undefined ? 2 : fmt);
  if (tag === 'char' && fmt === undefined) return String.fromCharCode(v & 255);
  const base = fmt === undefined ? 10 : fmt;
  if (base === 0) return String.fromCharCode(v & 255);
  if (base < 2 || base > 36) return printText(v, tag, 10);
  if (base === 10) return String(SIGNED.has(tag) ? v : (v >>> 0));
  // Print widens to long, then prints the unsigned value: -1 as int -> FFFFFFFF
  return (v >>> 0).toString(base).toUpperCase();
}

// String(v, arg): String's own rules (lower-case hex, itoa width)
export function strText(v, t, arg) {
  if (t === 'String' || t === 'cstr') return String(v);
  if (t === 'char') return String.fromCharCode(v & 255);
  if (t === 'f32' || t === 'f64') {
    const d = arg === undefined ? 2 : Math.max(0, Math.trunc(arg));
    if (Number.isNaN(v)) return 'nan';
    if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
    return fixed(v, d);
  }
  if (t === 'bool') return v ? '1' : '0';
  const base = arg === undefined ? 10 : arg;
  if (base === 10 || !(base >= 2 && base <= 36)) return String(v);
  const bits = BITS[t] || 32;
  const u = bits === 32 ? v >>> 0 : (v & ((1 << bits) - 1)) >>> 0;
  return u.toString(base);
}
// round half away from zero to d decimals (dtostrf), without toFixed's binary surprises
function fixed(v, d) {
  const neg = v < 0; let a = Math.abs(v);
  const m = Math.pow(10, d);
  let n = Math.round(a * m + 1e-9 * Math.max(1, a * m));
  let s = String(Math.floor(n / m));
  if (d > 0) s += '.' + String(n % m).padStart(d, '0');
  return (neg && n !== 0 ? '-' : '') + s;
}

// ── C strings and arrays ─────────────────────────────────────────────────────
export function cstr(arr) {
  if (typeof arr === 'string') return arr;
  let s = '';
  for (let i = 0; i < arr.length; i++) { const c = arr[i] & 255; if (c === 0) break; s += String.fromCharCode(c); }
  return s;
}
const CT = { char: Int8Array, i8: Int8Array, u8: Uint8Array, bool: Uint8Array, i16: Int16Array, u16: Uint16Array, i32: Int32Array, u32: Uint32Array, f32: Float32Array, f64: Float64Array };
export function mkArr(el, dims, init) {
  const mk = (d, ini) => {
    const n = dims[d];
    if (d < dims.length - 1) return Array.from({ length: n }, (_, i) => mk(d + 1, ini ? ini[i] : null));
    const C = CT[el];
    const a = C ? new C(n) : new Array(n).fill(el === 'String' || el === 'cstr' ? '' : 0);
    if (typeof ini === 'string') { for (let i = 0; i < ini.length && i < n; i++) a[i] = ini.charCodeAt(i); }
    else if (ini) for (let i = 0; i < ini.length && i < n; i++) a[i] = ini[i];
    return a;
  };
  return mk(0, init);
}
export function mkObjArr(make, dims) {
  const mk = d => Array.from({ length: dims[d] }, () => d < dims.length - 1 ? mk(d + 1) : make());
  return mk(0);
}
export function writeChars(buf, s, size) {
  const room = Math.min(buf.length, size === undefined ? Infinity : size) - 1;
  if (s.length > room && size === Infinity) throw new SketchError(`the text (${s.length} chars) does not fit in the char array (${buf.length - 1} chars and the end mark): this would overwrite memory`);
  const n = Math.max(0, Math.min(s.length, room));
  for (let i = 0; i < n; i++) buf[i] = s.charCodeAt(i);
  if (room >= 0) buf[n] = 0;
}

// printf: flags - + space 0 #, width, precision, h/l, d i u x X o c s f F e E g G %
export function cprintf(fmt, args, family) {
  let ai = 0, out = '';
  const re = /%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?(hh|h|ll|l|z|j|t|L)?([diouxXcsfFeEgGp%])/g;
  let last = 0, m;
  const intBits = family === 'avr' ? 16 : 32;
  while ((m = re.exec(fmt))) {
    out += fmt.slice(last, m.index); last = re.lastIndex;
    const [, flags, w0, p0, len, conv] = m;
    if (conv === '%') { out += '%'; continue; }
    let width = w0 === '*' ? Number(args[ai++]) : w0 ? Number(w0) : 0;
    let prec = p0 === '*' ? Number(args[ai++]) : p0 !== undefined ? Number(p0) : undefined;
    let left = flags.includes('-');
    if (width < 0) { left = true; width = -width; }
    const arg = args[ai++];
    let body = '', sign = '', prefix = '';
    const bits = len === 'l' || len === 'll' ? 32 : len === 'hh' ? 8 : len === 'h' ? 16 : intBits;
    switch (conv) {
      case 'd': case 'i': {
        let n = Math.trunc(Number(arg) || 0);
        n = bits === 32 ? n | 0 : (n << (32 - bits)) >> (32 - bits);
        if (n < 0) { sign = '-'; n = -n; } else if (flags.includes('+')) sign = '+'; else if (flags.includes(' ')) sign = ' ';
        body = String(n);
        if (prec !== undefined) body = body.padStart(prec, '0');
        break;
      }
      case 'u': case 'x': case 'X': case 'o': {
        let n = Math.trunc(Number(arg) || 0) >>> 0;
        if (bits < 32) n = n & ((1 << bits) - 1);
        body = n.toString(conv === 'u' ? 10 : conv === 'o' ? 8 : 16);
        if (conv === 'X') body = body.toUpperCase();
        if (prec !== undefined) body = body.padStart(prec, '0');
        if (flags.includes('#') && n !== 0) prefix = conv === 'o' ? '0' : conv === 'x' ? '0x' : conv === 'X' ? '0X' : '';
        break;
      }
      case 'c': body = String.fromCharCode(Number(arg) & 255); break;
      case 's': body = String(arg ?? '(null)'); if (prec !== undefined) body = body.slice(0, prec); break;
      case 'p': body = '0x0'; break;
      default: {
        // floats: avr-libc's default printf prints '?' for %f
        if (family === 'avr') { body = '?'; break; }
        let x = Number(arg);
        if (x < 0 || Object.is(x, -0)) { sign = '-'; x = -x; } else if (flags.includes('+')) sign = '+'; else if (flags.includes(' ')) sign = ' ';
        const p = prec === undefined ? 6 : prec;
        if (!Number.isFinite(x)) body = Number.isNaN(x) ? 'nan' : 'inf';
        else if (conv === 'f' || conv === 'F') body = fixedEven(x, p);
        else if (conv === 'e' || conv === 'E') body = x.toExponential(p).replace(/e([+-])(\d)$/, 'e$10$2');
        else { body = x === 0 ? '0' : String(Number(x.toPrecision(p || 1))); }
        if (conv === 'E' || conv === 'G') body = body.toUpperCase();
      }
    }
    let s = sign + prefix + body;
    if (s.length < width) {
      if (left) s = s.padEnd(width, ' ');
      else if (flags.includes('0') && conv !== 's' && conv !== 'c' && prec === undefined) s = sign + prefix + body.padStart(width - sign.length - prefix.length, '0');
      else s = s.padStart(width, ' ');
    }
    out += s;
  }
  return out + fmt.slice(last);
}

// printf's %f: round to nearest, exact ties to even (as newlib and glibc do)
function fixedEven(x, p) {
  const y = x * Math.pow(10, p);
  if (Number.isFinite(y) && Math.abs(y) < 9e15 && !Number.isInteger(y) && Number.isInteger(y * 2)) {
    const lo = Math.floor(y), n = lo % 2 === 0 ? lo : lo + 1;
    const s = String(n).padStart(p + 1, '0');
    return p ? s.slice(0, s.length - p) + '.' + s.slice(s.length - p) : s;
  }
  return x.toFixed(p);
}

// atol / atof on a JS string
export function atol(s) {
  const m = /^[\s]*([+-]?\d+)/.exec(String(s));
  return m ? (parseInt(m[1], 10) | 0) : 0;
}
export function atof(s) {
  const m = /^[\s]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(String(s));
  return m ? parseFloat(m[1]) : 0;
}

// ── the String methods (called as $.sm.name(s, ...)) ─────────────────────────
const SPACE = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;
export const STRING = {
  length: s => s.length,
  charAt: (s, i) => (i >= 0 && i < s.length ? s.charCodeAt(i) << 24 >> 24 : 0),
  substring: (s, a, b) => {
    if (b === undefined) return a > s.length ? '' : s.substring(a);
    return s.substring(Math.max(0, a), Math.max(0, b));
  },
  indexOf: (s, x, from = 0) => s.indexOf(x, from),
  lastIndexOf: (s, x, from) => (from === undefined ? s.lastIndexOf(x) : s.lastIndexOf(x, from)),
  toInt: s => atol(s),
  toFloat: s => Math.fround(atof(s)),
  toDouble: s => atof(s),
  equals: (s, x) => (s === x ? 1 : 0),
  equalsIgnoreCase: (s, x) => (s.toLowerCase() === x.toLowerCase() ? 1 : 0),
  startsWith: (s, x) => (s.startsWith(x) ? 1 : 0),
  endsWith: (s, x) => (s.endsWith(x) ? 1 : 0),
  compareTo: (s, x) => {
    const n = Math.min(s.length, x.length);
    for (let i = 0; i < n; i++) { const d = s.charCodeAt(i) - x.charCodeAt(i); if (d) return d; }
    return s.length - x.length;
  },
  c_str: s => s,
  isEmpty: s => (s.length ? 0 : 1),
  reserve: () => 1,
  concat: (s, x) => s + x,
  toUpperCase: s => s.toUpperCase(),
  toLowerCase: s => s.toLowerCase(),
  trim: s => s.replace(SPACE, ''),
  replace: (s, a, b) => (a.length ? s.split(a).join(b) : s),
  remove: (s, i, n) => (i >= s.length ? s : n === undefined ? s.slice(0, i) : s.slice(0, i) + s.slice(i + Math.max(0, n))),
  setCharAt: (s, i, c) => (i >= 0 && i < s.length ? s.slice(0, i) + String.fromCharCode(c & 255) + s.slice(i + 1) : s)
};

// ── Serial ───────────────────────────────────────────────────────────────────
export function makeSerial(rt) {
  const S = {
    baud: 0, rx: [], timeout: 1000, txBusy: 0,
    reset() { S.baud = 0; S.rx = []; S.timeout = 1000; S.txBusy = 0; },
    *begin(baud) { S.baud = baud > 0 ? baud : 9600; S.txBusy = rt.tm; rt.cost(rt.B.family === 'avr' ? 20e-6 : 5e-6); },
    *end() { S.baud = 0; },
    *_out(text) {
      if (!text.length) return 0;
      rt.emitSerial(text);
      if (S.baud) {
        const bt = 10 / S.baud;
        const start = Math.max(S.txBusy, rt.tm);
        S.txBusy = start + text.length * bt;
        const over = S.txBusy - rt.tm - 64 * bt;       // bytes beyond the 64-byte buffer
        if (over > 0) yield* rt.waitFor(over);
      }
      return text.length;
    },
    *print(v, tag, fmt) { return yield* S._out(printText(v, tag, fmt)); },
    *println(v, tag, fmt) { return yield* S._out(printText(v, tag, fmt) + '\r\n'); },
    *write(x) { return yield* S._out(typeof x === 'number' ? String.fromCharCode(x & 255) : String(x)); },
    *writeBuf(arr, n) { let s = ''; for (let i = 0; i < Math.min(n, arr.length); i++) s += String.fromCharCode(arr[i] & 255); return yield* S._out(s); },
    *printf(fmt, ...args) { return yield* S._out(cprintf(fmt, args, rt.B.family)); },
    available() { return S.rx.length; },
    availableForWrite() {
      if (!S.baud) return 63;
      const bt = 10 / S.baud, queued = Math.max(0, (S.txBusy - rt.tm) / bt);
      return Math.max(0, Math.floor(63 - queued));
    },
    read() { return S.rx.length ? S.rx.shift() : -1; },
    peek() { return S.rx.length ? S.rx[0] : -1; },
    *flush() { if (S.txBusy > rt.tm) yield* rt.waitFor(S.txBusy - rt.tm); },
    setTimeout(ms) { S.timeout = ms >>> 0; },
    *timedRead() {
      const end = rt.tm + S.timeout / 1000;
      while (!S.rx.length) {
        if (rt.tm >= end - 1e-12) return -1;
        yield* rt.waitFor(Math.min(1e-3, end - rt.tm));
      }
      return S.rx.shift();
    },
    *timedPeek() {
      const end = rt.tm + S.timeout / 1000;
      while (!S.rx.length) {
        if (rt.tm >= end - 1e-12) return -1;
        yield* rt.waitFor(Math.min(1e-3, end - rt.tm));
      }
      return S.rx[0];
    },
    *parseInt() {
      let c;
      // skip until a digit or '-'
      for (;;) { c = yield* S.timedPeek(); if (c < 0) return 0; if ((c >= 48 && c <= 57) || c === 45) break; S.rx.shift(); }
      let neg = false, v = 0, any = false;
      for (;;) {
        c = yield* S.timedPeek();
        if (c === 45 && !any && !neg) { neg = true; S.rx.shift(); continue; }
        if (c >= 48 && c <= 57) { v = v * 10 + (c - 48); any = true; S.rx.shift(); continue; }
        break;
      }
      return (neg ? -v : v) | 0;
    },
    *parseFloat() {
      let c, s = '';
      for (;;) { c = yield* S.timedPeek(); if (c < 0) return 0; if ((c >= 48 && c <= 57) || c === 45 || c === 46) break; S.rx.shift(); }
      for (;;) {
        c = yield* S.timedPeek();
        if ((c >= 48 && c <= 57) || (c === 45 && !s.length) || (c === 46 && !s.includes('.'))) { s += String.fromCharCode(c); S.rx.shift(); continue; }
        break;
      }
      return Math.fround(parseFloat(s) || 0);
    },
    *readString() { let s = ''; for (;;) { const c = yield* S.timedRead(); if (c < 0) return s; s += String.fromCharCode(c); } },
    *readStringUntil(term) {
      let s = ''; const t = term.charCodeAt(0);
      for (;;) { const c = yield* S.timedRead(); if (c < 0 || c === t) return s; s += String.fromCharCode(c); }
    },
    *find(target) {
      let k = 0;
      for (;;) {
        const c = yield* S.timedRead(); if (c < 0) return 0;
        if (c === target.charCodeAt(k)) { k++; if (k === target.length) return 1; } else k = c === target.charCodeAt(0) ? 1 : 0;
      }
    },
    input(text) {
      for (let i = 0; i < text.length; i++) { if (S.rx.length >= 64) { rt.warn('Serial input buffer overflow: bytes were lost (the sketch reads too slowly)'); break; } S.rx.push(text.charCodeAt(i) & 255); }
    }
  };
  return S;
}

// ── LiquidCrystal (HD44780 over real pins) ───────────────────────────────────
export function makeLCD(rt, B, pins) {
  let rs, rw = -1, en, data;
  if (pins.length === 6) { [rs, en] = pins; data = pins.slice(2); }
  else if (pins.length === 7) { [rs, rw, en] = pins; data = pins.slice(3); }
  else if (pins.length === 10) { [rs, en] = pins; data = pins.slice(2); }
  else { [rs, rw, en] = pins; data = pins.slice(3); }
  const eight = data.length === 8;
  let fn = eight ? 0x10 : 0x00, ctrl = 0, mode = 0, lines = 1, cols = 16;
  const OFF = [0x00, 0x40, 0x14, 0x54];
  const L = {
    *pulse() {
      yield* B.digitalWrite(en, 0); yield* B.delayMicroseconds(1);
      yield* B.digitalWrite(en, 1); yield* B.delayMicroseconds(1);
      yield* B.digitalWrite(en, 0); yield* B.delayMicroseconds(100);
    },
    *write4(v) { for (let i = 0; i < 4; i++) yield* B.digitalWrite(data[i], (v >> i) & 1); yield* L.pulse(); },
    *write8(v) { for (let i = 0; i < 8; i++) yield* B.digitalWrite(data[i], (v >> i) & 1); yield* L.pulse(); },
    *send(v, rsLevel) {
      yield* B.digitalWrite(rs, rsLevel);
      if (rw >= 0) yield* B.digitalWrite(rw, 0);
      if (eight) yield* L.write8(v); else { yield* L.write4(v >> 4); yield* L.write4(v & 15); }
    },
    *command(v) { yield* L.send(v & 255, 0); },
    *begin(c, r, dots) {
      cols = c; lines = r;
      if (r > 1) fn |= 0x08;
      if (dots && r === 1) fn |= 0x04;
      yield* B.pinMode(rs, 1); if (rw >= 0) yield* B.pinMode(rw, 1); yield* B.pinMode(en, 1);
      for (const d of data) yield* B.pinMode(d, 1);
      yield* B.delayMicroseconds(50000);
      yield* B.digitalWrite(rs, 0); yield* B.digitalWrite(en, 0); if (rw >= 0) yield* B.digitalWrite(rw, 0);
      if (!eight) {
        yield* L.write4(0x03); yield* B.delayMicroseconds(4500);
        yield* L.write4(0x03); yield* B.delayMicroseconds(4500);
        yield* L.write4(0x03); yield* B.delayMicroseconds(150);
        yield* L.write4(0x02);
      } else {
        yield* L.command(0x20 | fn); yield* B.delayMicroseconds(4500);
        yield* L.command(0x20 | fn); yield* B.delayMicroseconds(150);
        yield* L.command(0x20 | fn);
      }
      yield* L.command(0x20 | fn);
      ctrl = 0x04; yield* L.command(0x08 | ctrl);
      yield* L.clear();
      mode = 0x02; yield* L.command(0x04 | mode);
    },
    *clear() { yield* L.command(0x01); yield* B.delayMicroseconds(2000); },
    *home() { yield* L.command(0x02); yield* B.delayMicroseconds(2000); },
    *setCursor(c, r) {
      if (r >= 4) r = 3;
      if (r >= lines) r = lines - 1;
      if (r < 0) r = 0;
      yield* L.command(0x80 | ((c + OFF[r]) & 0x7f));
    },
    *writeText(s) { for (let i = 0; i < s.length; i++) yield* L.send(s.charCodeAt(i) & 255, 1); return s.length; },
    *print(v, tag, fmt) { return yield* L.writeText(printText(v, tag, fmt)); },
    *write(x) { return yield* L.writeText(typeof x === 'number' ? String.fromCharCode(x & 255) : String(x)); },
    *writeBuf(arr, n) { let s = ''; for (let i = 0; i < Math.min(n, arr.length); i++) s += String.fromCharCode(arr[i] & 255); return yield* L.writeText(s); },
    *display() { ctrl |= 0x04; yield* L.command(0x08 | ctrl); },
    *noDisplay() { ctrl &= ~0x04; yield* L.command(0x08 | ctrl); },
    *cursor() { ctrl |= 0x02; yield* L.command(0x08 | ctrl); },
    *noCursor() { ctrl &= ~0x02; yield* L.command(0x08 | ctrl); },
    *blink() { ctrl |= 0x01; yield* L.command(0x08 | ctrl); },
    *noBlink() { ctrl &= ~0x01; yield* L.command(0x08 | ctrl); },
    *scrollDisplayLeft() { yield* L.command(0x10 | 0x08); },
    *scrollDisplayRight() { yield* L.command(0x10 | 0x08 | 0x04); },
    *leftToRight() { mode |= 0x02; yield* L.command(0x04 | mode); },
    *rightToLeft() { mode &= ~0x02; yield* L.command(0x04 | mode); },
    *autoscroll() { mode |= 0x01; yield* L.command(0x04 | mode); },
    *noAutoscroll() { mode &= ~0x01; yield* L.command(0x04 | mode); },
    *createChar(loc, rows) {
      yield* L.command(0x40 | ((loc & 7) << 3));
      for (let i = 0; i < 8; i++) yield* L.send((rows[i] | 0) & 255, 1);
    },
    get cols() { return cols; }
  };
  return L;
}

// ── Servo ────────────────────────────────────────────────────────────────────
export function makeServo(rt) {
  let pin = null, min = 544, max = 2400, us = 1500;
  const V = {
    *attach(p, lo, hi) {
      if (lo !== undefined) min = lo; if (hi !== undefined) max = hi;
      pin = p;
      yield* rt.servoDrive(pin, us);
      return 1;
    },
    *detach() { if (pin !== null) yield* rt.servoDrive(pin, null); pin = null; },
    *write(v) {
      if (v < min) {
        const a = Math.max(0, Math.min(180, v));
        v = Math.round(min + (a * (max - min)) / 180);
      }
      yield* V.writeMicroseconds(v);
    },
    *writeMicroseconds(v) {
      us = Math.max(min, Math.min(max, Math.trunc(v)));
      if (pin !== null) yield* rt.servoDrive(pin, us);
    },
    read() { return Math.trunc(((us + 1 - min) * 180) / (max - min)); },
    readMicroseconds() { return us; },
    attached() { return pin !== null ? 1 : 0; }
  };
  return V;
}
