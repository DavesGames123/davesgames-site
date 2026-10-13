// ============================================================================
//  BREADBOARD LAB  ·  sim/mcuhost.js — the bridge between a board and the sim
// ----------------------------------------------------------------------------
//  One McuHost per microcontroller board in the netlist (Netlist.mcus). It
//  makes a 'mcupin' element for every GPIO of the board and a 'mcucore'
//  element (the board current draw), and it holds the program runtime made by
//  the injected factory (mcu/runtime.js createMcu, contract 3.11).
//
//  THE CLOCK IS THE SIM CLOCK. The engine makes mcu.nextWake() a breakpoint.
//  At that accepted time it calls process(t): pending input edges go to
//  mcu.pinChanged, then mcu.run(t, io) runs until the program blocks at a
//  later time. io.drive changes a pin device; a change is a discontinuity, so
//  the next step starts with backward Euler at that time.
//
//  BROWNOUT. When vdd − gnd of the board falls below 80 % of nominal, the host
//  calls reset, holds every pin off and stops running. Above 85 % it resets
//  again and starts the program from setup().
//
//  PIN NAMES. io calls use the part pin names (D13, A0, '2', 'TX0' …). The
//  host also takes numbers and 'GPIOn' (2 → D2 on a 328 board, 14 → A0,
//  2 → '2' on the ESP32) and LED_BUILTIN.
//
//  GREP MAP
//    POWER_PIN ........... pin names that are not GPIO
//    BOARD_INFO .......... vdd, pin profile, core current per board
//    McuHost ............. elements, resolve, io, process, state
// ============================================================================

export const POWER_PIN = /^(5V|3V3|3\.3V|GND(\.\d+)?|VIN|AREF|IOREF|RESET|RST(\.\d+)?|EN|VBUS)$/i;
export const BOARD_INFO = {
  uno328: { vnom: 5, profile: 'avr', idd: 0.045, led: 'D13' },
  nano328: { vnom: 5, profile: 'avr', idd: 0.02, led: 'D13' },
  esp32dev: { vnom: 3.3, profile: 'esp32', idd: 0.04, led: '2' },
};
const ESP_ALIAS = { 1: 'TX0', 3: 'RX0', 36: 'VP', 39: 'VN' };

export class McuHost {
  constructor(eng, spec) {
    this.eng = eng; this.spec = spec; this.id = spec.id;
    this.info = BOARD_INFO[spec.board] || BOARD_INFO.uno328;
    this.program = spec.program || null;
    this.mcu = null; this.error = null;
    this.brownout = true; this.everRan = false;
    this.pending = []; this.pins = {}; this.watch = true; this.changed = false;
    this.io = {
      read: (pin) => { const d = this.resolve(pin); return d ? this.eng.vNode(d.el.nodes.p) - this.eng.vNode(this.spec.gnd) : 0; },
      vdd: () => this.eng.vNode(this.spec.vdd) - this.eng.vNode(this.spec.gnd),
      drive: (pin, cfg) => {
        const d = this.resolve(pin);
        if (!d || !cfg) return;
        const sw = this.eng.pinSwitched(this.id, d.pin);
        if (d.setCfg(cfg, this.eng.t, sw)) { this.changed = true; }
      },
      serial: (text) => { if (text) this.eng.serial.push({ mcu: this.id, text: String(text) }); },
      now: () => this.eng.t,
    };
  }
  gpioNames() { return Object.keys(this.spec.pins || {}).filter(n => !POWER_PIN.test(n) && this.spec.pins[n] != null); }
  elements() {
    const out = [];
    for (const name of this.gpioNames()) {
      out.push({ id: `${this.id}/pin:${name}`, owner: this.id, type: 'mcupin', nodes: { p: this.spec.pins[name], gnd: this.spec.gnd, vdd: this.spec.vdd }, params: { profile: this.info.profile, pin: name } });
    }
    if (this.spec.vdd != null && this.spec.gnd != null) out.push({ id: `${this.id}/core`, owner: this.id, type: 'mcucore', nodes: { vdd: this.spec.vdd, gnd: this.spec.gnd }, params: { idd: this.info.idd, vnom: this.info.vnom } });
    return out;
  }
  attach(devById) {
    this.pins = {};
    for (const name of this.gpioNames()) {
      const d = devById.get(`${this.id}/pin:${name}`);
      if (d) { d.host = this; this.pins[name] = d; }
    }
  }
  resolve(pin) {
    if (pin == null) return null;
    let k = String(pin);
    if (this.pins[k]) return this.pins[k];
    if (k === 'LED_BUILTIN') return this.pins[this.info.led] || null;
    const esp = this.spec.board === 'esp32dev';
    let m = /^(?:GPIO|IO|D)?(\d+)$/i.exec(k);
    if (m) {
      const n = +m[1];
      if (esp) return this.pins[ESP_ALIAS[n] || String(n)] || null;
      if (n <= 13) return this.pins['D' + n] || null;
      if (n <= 21) return this.pins['A' + (n - 14)] || null;
    }
    m = /^A(\d)$/i.exec(k);
    if (m && esp) return this.pins[{ 0: 'VP', 3: 'VN' }[m[1]]] || null;
    return this.pins[k.toUpperCase()] || null;
  }
  create(factory, t) {
    this.mcu = null; this.error = null;
    if (!this.program || !factory) return { ok: !this.program, errors: this.program ? [{ line: 0, col: 0, msg: 'No MCU runtime is loaded.' }] : [] };
    try {
      const m = factory({ board: this.spec.board, program: this.program, id: this.id });
      if (!m || typeof m.run !== 'function') {
        const errs = (m && m.errors) || [{ line: 0, col: 0, msg: 'The program did not compile.' }];
        this.error = errs.map(e => e.msg).join('; ');
        return { ok: false, errors: errs };
      }
      if (m.compiled && m.compiled.ok === false) {
        this.error = 'compile error';
        return { ok: false, errors: m.compiled.errors || [] };
      }
      this.mcu = m;
      const st = m.state ? m.state() : null;
      if (st && st.error) { this.error = st.error; return { ok: false, errors: [{ line: 0, col: 0, msg: st.error }] }; }
      this.brownout = true; // start at the next process() when vdd is good
      return { ok: true, errors: [] };
    } catch (e) {
      const errs = e && e.errors ? e.errors : [{ line: e && e.line || 0, col: 0, msg: String(e && e.message || e) }];
      this.error = errs.map(x => x.msg).join('; ');
      return { ok: false, errors: errs };
    }
  }
  allPins(cfg) {
    let ch = false;
    for (const k in this.pins) if (this.pins[k].setCfg(cfg, this.eng.t, true)) ch = true;
    return ch;
  }
  pinEvent(pin, level, t) { if (this.mcu && !this.brownout && this.watching(pin)) this.pending.push([pin, level, t]); }
  // the runtime may say which pins it waits on (interrupts, pulseIn)
  watching(pin) { return !this.mcu || !this.mcu.watching || this.mcu.watching(pin); }
  nextWake() {
    if (!this.mcu || this.brownout || this.error) return Infinity;
    const w = this.mcu.nextWake();
    return Number.isFinite(w) ? w : Infinity;
  }
  process(t) {
    this.changed = false;
    if (!this.mcu || this.error) return false;
    const vdd = this.io.vdd(), vn = this.info.vnom;
    if (this.brownout) {
      if (vdd < 0.85 * vn) return false;
      this.brownout = false;
      this.allPins({ mode: 'in' });
      try { this.mcu.reset(t); } catch (e) { return this.fail(e, t); }
      if (this.everRan) this.eng._event({ t, kind: 'info', owner: this.id, severity: 'info', msg: `${this.eng.labelOf(this.id)} has power again and restarts.` });
      this.everRan = true;
      this.changed = true;
    } else if (vdd < 0.8 * vn) {
      this.brownout = true;
      this.pending = [];
      try { this.mcu.reset(t); } catch (e) { /* hold anyway */ }
      this.allPins({ mode: 'off' });
      this.eng._event({ t, kind: 'brownout', owner: this.id, severity: 'warn', msg: `${this.eng.labelOf(this.id)} browned out: its supply fell to ${vdd.toFixed(2)} V (needs ${(0.8 * vn).toFixed(2)} V). It holds in reset.` });
      return true;
    }
    try {
      const pend = this.pending; this.pending = [];
      for (const [pin, level, tp] of pend) this.mcu.pinChanged(pin, level, tp);
      for (let k = 0; k < 8; k++) {
        const w = this.mcu.nextWake();
        if (!(w <= t + 1e-12 * Math.max(1, t) + 1e-15)) break;
        this.mcu.run(t, this.io);
      }
    } catch (e) { return this.fail(e, t); }
    const st = this.mcu.state ? this.mcu.state() : null;
    if (st && st.error && !this.error) { this.error = st.error; this.eng._event({ t, kind: 'warn', owner: this.id, severity: 'error', msg: `${this.eng.labelOf(this.id)} stopped: ${st.error}` }); }
    return this.changed;
  }
  fail(e, t) {
    this.error = String(e && e.message || e);
    this.eng._event({ t, kind: 'warn', owner: this.id, severity: 'error', msg: `${this.eng.labelOf(this.id)} program error: ${this.error}` });
    return this.allPins({ mode: 'off' });
  }
  state() {
    let st = null;
    try { st = this.mcu && this.mcu.state ? this.mcu.state() : null; } catch (e) { st = null; }
    const pins = {};
    for (const k in this.pins) {
      const d = this.pins[k];
      pins[k] = { mode: d.damaged ? 'dead' : d.cfg.mode, level: d.timed() ? d.lvl : d.cfg.mode === 'out' ? (d.cfg.level ? 1 : 0) : d.din.level };
      if (d.timed()) { pins[k].duty = d.cfg.duty; pins[k].freq = d.cfg.freq; }
    }
    if (st && st.pins) for (const k in st.pins) pins[k] = { ...st.pins[k], ...(pins[k] && pins[k].mode === 'dead' ? { mode: 'dead' } : {}) };
    return {
      running: !!(this.mcu && !this.brownout && !this.error && (!st || st.running !== false)),
      error: this.error || (st && st.error) || undefined,
      brownout: this.brownout,
      millis: st && st.millis != null ? st.millis : 0,
      pins,
    };
  }
}
