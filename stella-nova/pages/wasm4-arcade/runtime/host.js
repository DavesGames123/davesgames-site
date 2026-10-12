// ============================================================================
//  WASM-4 ARCADE  ·  runtime/host.js — one WASM-4 console, no DOM
// ----------------------------------------------------------------------------
//  The host that runs one cart. It follows runtimes/web/src/runtime.ts of
//  WASM-4 (https://github.com/aduros/wasm4, ISC licence, Copyright (c)
//  Bruno Garcia, see runtime/LICENSE.txt), with the DOM, WebGL, netplay and
//  devtools parts removed. The API is the one in wasm4.org/docs/reference:
//
//    memory   64 KiB, imported by the cart as env.memory (1 page, max 1)
//    drawing  blit blitSub line hline vline oval rect text textUtf8
//             textUtf16 (framebuffer.js)
//    sound    tone -> the apu object that the caller gives (apu.js, or
//             null for a silent console: the saver and the node tests)
//    storage  diskr diskw, 1024 bytes -> the disk object that the caller
//             gives ({ read() -> Uint8Array, write(bytes) })
//    debug    trace traceUtf8 traceUtf16 tracef -> onTrace(text)
//    exports  start() once, then update() 60 times a second
//
//  Frame order, as upstream: on the first update call start(); on later
//  frames clear the framebuffer unless SYSTEM_PRESERVE_FRAMEBUFFER is set;
//  call update(); tick the APU. composite() maps the 2-bit pixels through
//  the 4-colour PALETTE into RGBA bytes for the CRT.
//
//  A trap (unreachable, out of bounds) stops the console and paints a blue
//  screen with the reason, as the official runtime does. host.crashed then
//  holds the error.
//
//  grep -n targets
//    "export class Wasm4"   "  async load("   "  update("   "  composite("
//    "  blueScreen("        "export function memoryDisk"
// ============================================================================
import * as K from './constants.js';
import { Framebuffer } from './framebuffer.js';

// A disk that lives only in memory (the saver, tests, a cart with no id).
export function memoryDisk(init) {
  let bytes = init ? Uint8Array.from(init).slice(0, K.STORAGE_SIZE) : new Uint8Array(0);
  return { read: () => bytes, write: b => { bytes = Uint8Array.from(b); } };
}

export class Wasm4 {
  constructor({ disk = memoryDisk(), apu = null, onTrace = null } = {}) {
    this.memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
    this.data = new DataView(this.memory.buffer);
    this.fb = new Framebuffer(this.memory.buffer);
    this.disk = disk; this.apu = apu; this.onTrace = onTrace;
    this.diskBuffer = new Uint8Array(K.STORAGE_SIZE); this.diskSize = 0;
    this.loadDisk();
    this.instance = null; this.crashed = null; this.frame = 0; this.started = false;
    this.reset();
  }

  loadDisk() {
    let b = null;
    try { b = this.disk.read(); } catch (e) { b = null; }
    this.diskBuffer.fill(0);
    if (b && b.length) { const n = Math.min(b.length, K.STORAGE_SIZE); this.diskBuffer.set(b.subarray(0, n)); this.diskSize = n; } else this.diskSize = 0;
  }

  reset() {
    const mem32 = new Uint32Array(this.memory.buffer);
    mem32.fill(0);
    mem32.set(K.COLORS, K.ADDR_PALETTE >> 2);
    this.data.setUint16(K.ADDR_DRAW_COLORS, 0x1203, true);
    this.data.setInt16(K.ADDR_MOUSE_X, 0x7fff, true);
    this.data.setInt16(K.ADDR_MOUSE_Y, 0x7fff, true);
    this.crashed = null; this.frame = 0; this.started = false;
  }

  env() {
    const fb = this.fb;
    return {
      memory: this.memory,
      rect: (x, y, w, h) => fb.drawRect(x, y, w, h),
      oval: (x, y, w, h) => fb.drawOval(x, y, w, h),
      line: (x1, y1, x2, y2) => fb.drawLine(x1, y1, x2, y2),
      hline: (x, y, len) => fb.drawHLine(x, y, len),
      vline: (x, y, len) => fb.drawVLine(x, y, len),
      text: (p, x, y) => fb.drawText(new Uint8Array(this.memory.buffer, p), x, y),
      textUtf8: (p, n, x, y) => fb.drawText(new Uint8Array(this.memory.buffer, p, n), x, y),
      textUtf16: (p, n, x, y) => fb.drawText(new Uint16Array(this.memory.buffer, p, n >> 1), x, y),
      blit: (p, x, y, w, h, flags) => this.blitSub(p, x, y, w, h, 0, 0, w, flags),
      blitSub: (p, x, y, w, h, sx, sy, stride, flags) => this.blitSub(p, x, y, w, h, sx, sy, stride, flags),
      tone: (f, d, v, flags) => { this.tones = (this.tones || 0) + 1; if (this.apu) this.apu.tone(f, d, v, flags); },
      diskr: (p, size) => this.diskr(p, size),
      diskw: (p, size) => this.diskw(p, size),
      trace: p => this.print(this.cstr(p)),
      traceUtf8: (p, n) => this.print(new TextDecoder().decode(new Uint8Array(this.memory.buffer, p, n))),
      traceUtf16: (p, n) => this.print(new TextDecoder('utf-16').decode(new Uint8Array(this.memory.buffer, p, n))),
      tracef: (f, a) => this.tracef(f, a),
    };
  }

  blitSub(p, x, y, w, h, sx, sy, stride, flags) {
    const sprite = new Uint8Array(this.memory.buffer, p);
    this.fb.blit(sprite, x, y, w, h, sx, sy, stride, flags & 1, flags & 2, flags & 4, flags & 8);
  }

  diskr(p, size) {
    const n = Math.min(size, this.diskSize);
    new Uint8Array(this.memory.buffer, p).set(this.diskBuffer.subarray(0, n));
    return n;
  }

  diskw(p, size) {
    const n = Math.min(size, K.STORAGE_SIZE);
    const src = new Uint8Array(this.memory.buffer, p, n);
    this.diskBuffer.fill(0); this.diskBuffer.set(src); this.diskSize = n;
    try { this.disk.write(src.slice()); } catch (e) { /* storage full or blocked: the save stays in memory */ }
    return n;
  }

  cstr(p) {
    let s = '';
    for (;;) { const c = this.data.getUint8(p++); if (c === 0) break; s += String.fromCharCode(c); }
    return s;
  }

  tracef(f, a) {
    let out = '', ch;
    while ((ch = this.data.getUint8(f++))) {
      if (ch === 37) {
        switch ((ch = this.data.getUint8(f++))) {
          case 37: out += '%'; break;
          case 99: out += String.fromCharCode(this.data.getInt32(a, true)); a += 4; break;
          case 100: case 120: out += this.data.getInt32(a, true).toString(ch === 100 ? 10 : 16); a += 4; break;
          case 115: out += this.cstr(this.data.getUint32(a, true)); a += 4; break;
          case 102: out += this.data.getFloat64(a, true); a += 8; break;
          default: out += '%' + String.fromCharCode(ch);
        }
      } else out += String.fromCharCode(ch);
    }
    this.print(out);
  }

  print(s) { if (this.onTrace) { try { this.onTrace(s); } catch (e) { /* ignore */ } } }

  // Instantiate a cart. Throws on a bad or too large cart (and paints the
  // blue screen), as upstream does outside its developer mode.
  async load(bytes, { enforceSizeLimit = true } = {}) {
    this.instance = null;
    this.reset();
    this.loadDisk();
    try {
      const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (enforceSizeLimit && b.byteLength > K.CART_LIMIT) throw new CartError(`The cartridge is\n${b.byteLength} bytes.\nThe limit is\n65536 bytes.`);
      const { instance } = await WebAssembly.instantiate(b, { env: this.env() });
      this.instance = instance;
      const ex = instance.exports;
      if (typeof ex._start === 'function') ex._start();
      if (typeof ex._initialize === 'function') ex._initialize();
    } catch (e) {
      this.crash(e);
      throw e;
    }
  }

  getSystemFlag(mask) { return this.data.getUint8(K.ADDR_SYSTEM_FLAGS) & mask; }
  setGamepad(i, buttons) { this.data.setUint8(K.ADDR_GAMEPAD1 + i, buttons & 0xff); }
  setMouse(x, y, buttons) {
    this.data.setInt16(K.ADDR_MOUSE_X, x, true);
    this.data.setInt16(K.ADDR_MOUSE_Y, y, true);
    this.data.setUint8(K.ADDR_MOUSE_BUTTONS, buttons);
  }

  // One 60 Hz frame. Returns false when the console is stopped.
  update() {
    if (!this.instance || this.crashed) return false;
    const ex = this.instance.exports;
    try {
      if (!this.started) {
        this.started = true;
        if (typeof ex.start === 'function') ex.start();
      } else if (!this.getSystemFlag(K.SYSTEM_PRESERVE_FRAMEBUFFER)) {
        this.fb.clear();
      }
      if (typeof ex.update === 'function') ex.update();
    } catch (e) {
      this.crash(e);
      return false;
    }
    if (this.apu) this.apu.tick();
    this.frame++;
    return true;
  }

  crash(e) {
    this.crashed = e || new Error('crash');
    try { this.blueScreen(explain(e)); } catch (err) { /* memory may be gone */ }
  }

  // The upstream blue screen: a title bar and the reason in the 8x8 font.
  blueScreen(text) {
    const COLORS = [0x1111ee, 0x86c06c, 0xaaaaaa, 0xffffff];
    const chars = s => [...s].map(c => c.charCodeAt(0) & 0xff);
    const title = ' WASM-4 ', hw = 8 * title.length, hx = (160 - hw) / 2, hy = 20;
    new Uint32Array(this.memory.buffer).set(COLORS, K.ADDR_PALETTE >> 2);
    this.data.setUint16(K.ADDR_DRAW_COLORS, 0x1203, true);
    this.fb.clear();
    this.fb.drawHLine(hx, hy - 1, hw);
    this.data.setUint16(K.ADDR_DRAW_COLORS, 0x1131, true);
    this.fb.drawText(chars(title), hx, hy);
    this.data.setUint16(K.ADDR_DRAW_COLORS, 0x1203, true);
    this.fb.drawText(chars(text), 9, 60);
  }

  // The palette as four [r, g, b] colours.
  palette() {
    const out = [];
    for (let i = 0; i < 4; i++) { const c = this.data.getUint32(K.ADDR_PALETTE + 4 * i, true); out.push([(c >> 16) & 255, (c >> 8) & 255, c & 255]); }
    return out;
  }

  // 2-bit framebuffer -> RGBA bytes (160 x 160 x 4).
  composite(rgba) {
    const pal = this.palette(), fb = this.fb.bytes;
    for (let i = 0, o = 0; i < fb.length; i++) {
      const b = fb[i];
      for (let k = 0; k < 4; k++, o += 4) {
        const c = pal[(b >> (k << 1)) & 3];
        rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
      }
    }
    return rgba;
  }
}

export class CartError extends Error {
  constructor(msg) { super(msg.replace(/\n/g, ' ')); this.name = 'CartError'; this.w4 = msg; }
}

// The reason text of the blue screen (upstream errorToBlueScreenText).
export function explain(err) {
  if (err && err.w4) return err.w4;
  const R = typeof WebAssembly !== 'undefined' ? WebAssembly : {};
  if (R.RuntimeError && err instanceof R.RuntimeError) {
    let m = 'The cartridge has\nstopped.';
    if (/unreachable/.test(err.message)) m = 'The cartridge has\nreached a code \nsegment marked as\nunreachable.';
    else if (/out of bounds/.test(err.message)) m = 'The cartridge has\nattempted a memory\naccess that is\nout of bounds.';
    return m + '\n\n\n\n\nPress R to reboot.';
  }
  if (R.LinkError && err instanceof R.LinkError) return 'The cartridge has\ntried to import\na missing function.';
  if (R.CompileError && err instanceof R.CompileError) return 'The cartridge is\ncorrupted.';
  return 'Unknown error.\n\n\n\nPress R to reboot.';
}
