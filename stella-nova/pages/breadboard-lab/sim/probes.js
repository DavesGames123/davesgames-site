// ============================================================================
//  BREADBOARD LAB  ·  sim/probes.js — multimeter, oscilloscope, logic analyzer
// ----------------------------------------------------------------------------
//  An instrument on the mat is a netlist probe { id, type, leads, settings }.
//  This module turns it into its input elements and reads it out per frame.
//
//  DMM. V mode: a 10 MΩ 'vmeter' from red to black; the reading is the time
//  average over the frame (a real meter integrates). A mode: a 0.1 Ω
//  'ameter' in series from red to black with a 10 A fuse; + when current
//  enters the red lead. Ω and continuity: no element; the engine measures
//  with all sources zeroed and a 1 mA test current (eng.measureR). With a
//  voltage across the leads, Ω mode reads overload and warns once: an
//  ohmmeter only works with the power off. Continuity beeps below 50 Ω.
//
//  SCOPE. Up to 4 channels, each a 1 MΩ input to the gnd lead (or to circuit
//  ground when the gnd lead is free). Samples every tdiv/50, linear between
//  accepted time points, at most SCOPE_CAP per channel per frame (the newest).
//
//  LOGIC. 8 channels, 1 MΩ inputs, one threshold (default 1.4 V). Edges are
//  [t, ch, level] at the interpolated crossing time.
//
//  GREP MAP
//    probeElements ...... the input elements of a probe
//    ProbeReader ........ per-probe sampling (sample) and readout (frame)
//    SCOPE_CAP / LOGIC_CAP
// ============================================================================

export const SCOPE_CAP = 16384;
export const LOGIC_CAP = 20000;
const nv = (x, n) => (n > 0 ? x[n - 1] : 0);

export function probeElements(pr) {
  const L = pr.leads || {}, st = pr.settings || {}, out = [];
  if (pr.type === 'dmm') {
    const mode = st.mode || 'V';
    if (L.red == null || L.black == null) return out;
    if (mode === 'V') out.push({ id: `${pr.id}/v`, owner: pr.id, type: 'vmeter', nodes: { a: L.red, b: L.black }, params: { r: 1e7 } });
    else if (mode === 'A') out.push({ id: `${pr.id}/a`, owner: pr.id, type: 'ameter', nodes: { a: L.red, b: L.black }, params: { r: 0.1, fuse: st.fuse ?? 10 } });
  } else if (pr.type === 'scope') {
    const g = L.gnd ?? 0;
    for (const ch of ['ch1', 'ch2', 'ch3', 'ch4']) if (L[ch] != null) out.push({ id: `${pr.id}/${ch}`, owner: pr.id, type: 'vmeter', nodes: { a: L[ch], b: g }, params: { r: 1e6 } });
  } else if (pr.type === 'logic') {
    const g = L.gnd ?? 0;
    for (let i = 0; i < 8; i++) { const k = 'd' + i; if (L[k] != null) out.push({ id: `${pr.id}/${k}`, owner: pr.id, type: 'vmeter', nodes: { a: L[k], b: g }, params: { r: 1e6 } }); }
  }
  return out;
}

export class ProbeReader {
  constructor(pr, eng) {
    this.pr = pr; this.eng = eng; this.id = pr.id; this.type = pr.type;
    this.st = pr.settings || {};
    this.L = pr.leads || {};
    this.reset(eng.t);
  }
  reset(t) {
    this.acc = 0; this.win = 0; this.warned = false;
    if (this.type === 'scope') {
      this.dt = Math.max(1e-9, (+this.st.tdiv || 1e-3) / 50);
      this.next = Math.ceil(t / this.dt - 1e-9) * this.dt;
      this.chs = ['ch1', 'ch2', 'ch3', 'ch4'];
      this.buf = this.chs.map(() => []);
      this.t0 = this.next;
    }
    if (this.type === 'logic') {
      this.th = this.st.threshold ?? 1.4;
      this.lv = new Array(8).fill(0); this.edges = [];
      this.primed = false;
    }
  }
  vdiff(x, a, b) { return nv(x, a) - nv(x, b ?? 0); }
  sample(t0, x0, t1, x1) {
    const h = t1 - t0;
    if (h <= 0) return;
    const L = this.L;
    if (this.type === 'dmm') {
      const mode = this.st.mode || 'V';
      if (mode === 'V' && L.red != null && L.black != null) {
        this.acc += 0.5 * (this.vdiff(x0, L.red, L.black) + this.vdiff(x1, L.red, L.black)) * h;
      } else if (mode === 'A') {
        const d = this.eng.devById.get(`${this.id}/a`);
        if (d) { const i0 = d._iPrev ?? d.current(x0), i1 = d.current(x1); this.acc += 0.5 * (i0 + i1) * h; d._iPrev = i1; }
      }
      this.win += h;
    } else if (this.type === 'scope') {
      const g = L.gnd ?? 0;
      while (this.next <= t1 + 1e-15) {
        const f = (this.next - t0) / h;
        for (let c = 0; c < 4; c++) {
          const n = L[this.chs[c]];
          if (n == null) continue;
          const a = this.vdiff(x0, n, g), b = this.vdiff(x1, n, g);
          this.buf[c].push(a + (b - a) * f);
        }
        this.next += this.dt;
        if (this.buf.some(bb => bb.length > 2 * SCOPE_CAP)) this.trim();
      }
    } else if (this.type === 'logic') {
      const g = L.gnd ?? 0;
      for (let c = 0; c < 8; c++) {
        const n = L['d' + c];
        if (n == null) continue;
        const a = this.vdiff(x0, n, g), b = this.vdiff(x1, n, g);
        if (!this.primed) { this.lv[c] = a > this.th ? 1 : 0; }
        const nl = b > this.th ? 1 : 0;
        if (nl !== this.lv[c]) {
          const f = a === b ? 1 : Math.min(1, Math.max(0, (this.th - a) / (b - a)));
          this.edges.push([t0 + f * h, c, nl]);
          this.lv[c] = nl;
        }
      }
      this.primed = true;
      if (this.edges.length > LOGIC_CAP) this.edges.splice(0, this.edges.length - LOGIC_CAP);
    }
  }
  trim() {
    const n = this.buf.reduce((m, b) => Math.max(m, b.length), 0);
    const drop = n - SCOPE_CAP;
    if (drop <= 0) return;
    for (const b of this.buf) b.splice(0, Math.min(drop, b.length));
    this.t0 += drop * this.dt;
  }
  frame(x) {
    const L = this.L;
    if (this.type === 'dmm') {
      const mode = this.st.mode || 'V';
      const out = { kind: 'dmm', value: 0, unit: mode === 'A' ? 'A' : mode === 'V' ? 'V' : 'Ω', overload: false, fuse: 'ok', beep: false, mode };
      if (mode === 'V') out.value = this.win > 0 ? this.acc / this.win : (L.red != null && L.black != null ? this.vdiff(x, L.red, L.black) : 0);
      else if (mode === 'A') {
        const d = this.eng.devById.get(`${this.id}/a`);
        out.fuse = d && d.damaged ? 'blown' : 'ok';
        out.value = this.win > 0 ? this.acc / this.win : (d ? d.current(x) : 0);
      } else {
        if (L.red == null || L.black == null) { out.value = Infinity; out.overload = true; }
        else {
          const v = this.vdiff(x, L.red, L.black);
          if (Math.abs(v) > 0.05) {
            out.value = NaN; out.overload = true; out.powered = true;
            if (!this.warned) {
              this.warned = true;
              this.eng._event({ t: this.eng.t, kind: 'warn', owner: this.id, severity: 'warn', msg: 'The ohmmeter sees a voltage. Turn the power off before you measure resistance.' });
            }
          } else {
            const R = this.eng.measureR(L.red, L.black);
            out.value = R; out.overload = !Number.isFinite(R) || R > 4e7;
            if (mode === 'cont') out.beep = R < 50;
          }
        }
      }
      const rg = this.st.range;
      if (typeof rg === 'number' && Number.isFinite(out.value) && Math.abs(out.value) > rg) out.overload = true;
      this.acc = 0; this.win = 0;
      return out;
    }
    if (this.type === 'scope') {
      const ch = this.buf.map(b => Float32Array.from(b));
      const out = { kind: 'scope', t0: this.t0, dt: this.dt, ch };
      this.buf = this.chs.map(() => []);
      this.t0 = this.next;
      return out;
    }
    if (this.type === 'logic') {
      let levels = 0;
      for (let c = 0; c < 8; c++) if (this.lv[c]) levels |= 1 << c;
      const out = { kind: 'logic', t0: this.eng.t, edges: this.edges, levels };
      this.edges = [];
      return out;
    }
    return { kind: this.type };
  }
}
