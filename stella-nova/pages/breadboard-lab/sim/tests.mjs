// ============================================================================
//  BREADBOARD LAB  ·  sim/tests.mjs — node tests of the simulator (SIM role)
// ----------------------------------------------------------------------------
//  Run: node stella-nova/pages/breadboard-lab/sim/tests.mjs
//  One line per check with the measured value. Exit 1 on any failure.
//  The checks follow CONTRACT.md section 7 (SIM): analytic circuits, device
//  models, logic chips, the LCD controller, damage, the netlist with the real
//  parts/geometry.js (or the stub), MCU co-simulation, PWM, speed, the
//  inline client, measureR and the static checks.
//
//  GREP MAP
//    check / near ........ the reporting helpers
//    E / net ............. hand-built netlists
//    lambertW ............ the diode reference solution
//    SECTION: …  ......... one block per area (grep "SECTION:")
// ============================================================================
import { createEngine, runFor, TYPES } from './engine.js';
import { buildNetlist } from './netlist.js';
import { checkCircuit } from './checks.js';
import { createSim } from './client.js';
import { ledModel, BJT_MODELS, MOS_MODELS } from './semis.js';
import { VT } from './devbase.js';
import { emfFrac } from './sources.js';
import { geoStub, stubRegistry, scriptMcu, toggleMcu, lcdScript, STUB_DEFS } from './test/stubs.mjs';

let fails = 0, count = 0;
const filter = process.argv[2] || '';
function check(name, ok, measured) {
  count++;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} — ${measured}`);
}
const rel = (a, b) => Math.abs(a / b - 1);
const pct = (a, b) => `${(100 * (a / b - 1)).toFixed(3)} %`;
const E = (id, type, nodes, params = {}) => ({ id, owner: id.split('/')[0], type, nodes, params });
const net = (nodeCount, elements, extra = {}) => ({ nodeCount, elements, probes: [], mcus: [], wireIds: [], labels: {}, ...extra });
const section = (name) => { const on = !filter || name.toLowerCase().includes(filter.toLowerCase()); if (on) console.log(`\n== ${name}`); return on; };
// sample a node over time with a fixed stride
function trace(eng, node, t1, dt) {
  const out = [];
  while (eng.t < t1 - 1e-15) { eng.advanceTo(Math.min(t1, eng.t + dt)); out.push([eng.t, eng.v(node)]); }
  return out;
}

// Lambert W (principal branch) by Halley iteration
function lambertW(x) {
  let w = Math.log(1 + x);
  if (x > 3) w = Math.log(x) - Math.log(Math.log(x));
  for (let i = 0; i < 60; i++) {
    const e = Math.exp(w), f = w * e - x;
    const d = e * (w + 1) - (w + 2) * f / (2 * w + 2);
    const nw = w - f / d;
    if (Math.abs(nw - w) < 1e-15 * Math.max(1, Math.abs(w))) { w = nw; break; }
    w = nw;
  }
  return w;
}

// ================================================================ speed (first: a clean JIT state)
const vsrc = (id, node, v = 0) => E(id + '/main', 'vsource', { p: node, n: 0 }, { v });
if (section('speed')) {
  // Timing uses process CPU time (other agents load this machine); wall time
  // is printed next to it.
  const timeIt = (fn) => { const c0 = process.cpuUsage(), w0 = performance.now(); fn(); const c = process.cpuUsage(c0); return [(c.user + c.system) / 1e6, (performance.now() - w0) / 1000]; };
  {
    // a breadboard-like bench: 5 V with wiring resistance and decoupling, a
    // 555 at about 1 kHz clocking a CD4017 with 10 LEDs, 8 NPN LED drivers on
    // the 555 output, and resistor dividers and LED branches to 200 nodes
    const els = [E('ps/main', 'vsource', { p: 1, n: 0 }, { v: 5, rint: 0.05 }),
      E('wr/main', 'wire', { a: 1, b: 2 }), E('cd1/main', 'capacitor', { a: 2, b: 0 }, { c: 100e-9 }), E('cd2/main', 'capacitor', { a: 2, b: 0 }, { c: 10e-6, polarized: true }),
      E('u/main', 'timer555', { gnd: 0, trig: 3, out: 5, reset: 2, ctrl: 6, thres: 3, dis: 4, vcc: 2 }),
      E('r1/main', 'resistor', { a: 2, b: 4 }, { r: 1000 }), E('r2/main', 'resistor', { a: 4, b: 3 }, { r: 6800 }), E('c/main', 'capacitor', { a: 3, b: 0 }, { c: 100e-9 }),
      E('cc/main', 'capacitor', { a: 6, b: 0 }, { c: 10e-9 })];
    let n = 7;
    const nodes = { p16: 2, p8: 0, p13: 0, p14: 5, p15: 0 };
    const q = [3, 2, 4, 7, 10, 1, 5, 6, 9, 11].map(p => { nodes['p' + p] = n; return n++; });
    nodes.p12 = n++;
    els.push(E('cnt/main', 'logic', nodes, { chip: 'cd4017' }));
    q.forEach((qn, i) => { els.push(E(`rq${i}/main`, 'resistor', { a: qn, b: n }, { r: 470 })); els.push(E(`lq${i}/main`, 'led', { a: n, k: 0 }, { color: 'green' })); n++; });
    for (let k = 0; k < 8; k++) {
      els.push(E(`rb${k}/main`, 'resistor', { a: 5, b: n }, { r: 4700 }), E(`q${k}/main`, 'npn', { c: n + 1, b: n, e: 0 }));
      els.push(E(`rc${k}/main`, 'resistor', { a: 2, b: n + 2 }, { r: 330 }), E(`lc${k}/main`, 'led', { a: n + 2, k: n + 1 }));
      n += 3;
    }
    while (n < 199) {
      els.push(E(`ra${n}/main`, 'resistor', { a: 2, b: n }, { r: 10000 }), E(`rz${n}/main`, 'resistor', { a: n, b: n + 1 }, { r: 4700 }));
      els.push(n % 4 === 0 ? E(`lz${n}/main`, 'led', { a: n + 1, k: 0 }, { color: 'yellow' }) : E(`ry${n}/main`, 'resistor', { a: n + 1, b: 0 }, { r: 2200 }));
      n += 2;
    }
    const eng = createEngine(net(n, els));
    const [cpu, wall] = timeIt(() => eng.advanceTo(1));
    const f = 1.44 / ((1000 + 2 * 6800) * 100e-9);
    check('200-node 555 bench (≈1 kHz) runs ≥ 1× real time', 1 / cpu >= 1, `${n} nodes, ${eng.n} unknowns, 555 at ${f.toFixed(0)} Hz: ratio ${(1 / cpu).toFixed(2)}× by CPU time (${(1 / wall).toFixed(2)}× wall), ${eng.stats.steps} steps, ${eng.stats.rejected} rejected, ${eng.stats.newton} Newton iterations`);
  }
  {
    // stiff case, printed only: 64 RC sections (τ 1–5 µs) excited at every edge
    const els = [vsrc('vcc', 1, 5), E('u/main', 'timer555', { gnd: 0, trig: 2, out: 4, reset: 1, thres: 2, dis: 3, vcc: 1 }),
      E('r1/main', 'resistor', { a: 1, b: 3 }, { r: 1000 }), E('r2/main', 'resistor', { a: 3, b: 2 }, { r: 6800 }), E('c/main', 'capacitor', { a: 2, b: 0 }, { c: 100e-9 })];
    let n = 5;
    for (let k = 0; k < 64; k++) {
      els.push(E(`ra${k}/main`, 'resistor', { a: 4, b: n }, { r: 1000 + k }), E(`ca${k}/main`, 'capacitor', { a: n, b: 0 }, { c: 1e-9 * (1 + k % 5) }));
      els.push(E(`rb${k}/main`, 'resistor', { a: n, b: n + 1 }, { r: 4700 }), E(`rc${k}/main`, 'resistor', { a: n + 1, b: n + 2 }, { r: 2200 }));
      els.push(k % 8 === 0 ? E(`d${k}/main`, 'led', { a: n + 2, k: 0 }) : E(`rd${k}/main`, 'resistor', { a: n + 2, b: 0 }, { r: 10000 }));
      n += 3;
    }
    const eng = createEngine(net(n, els));
    const [cpu, wall] = timeIt(() => eng.advanceTo(1));
    console.log(`info stiff 200-node bench (64 RC sections, τ 1–5 µs, excited at every edge): ratio ${(1 / cpu).toFixed(2)}× CPU (${(1 / wall).toFixed(2)}× wall), ${eng.stats.steps} steps`);
  }
  // tone into a buzzer with about 40 nodes
  const els2 = [vsrc('vcc', 1, 5), E('r/main', 'resistor', { a: 2, b: 3 }, { r: 100 }), E('bz/main', 'buzzer', { a: 3, b: 0 }, { active: false })];
  let m = 4;
  for (let k = 0; k < 16; k++) { els2.push(E(`x${k}/main`, 'resistor', { a: 1, b: m }, { r: 1000 })); els2.push(E(`y${k}/main`, 'capacitor', { a: m, b: m + 1 }, { c: 1e-6 })); els2.push(E(`z${k}/main`, 'resistor', { a: m + 1, b: 0 }, { r: 3300 })); m += 2; }
  els2.push(E('dl/main', 'led', { a: 2, k: m }), E('rl/main', 'resistor', { a: m, b: 0 }, { r: 330 })); m++;
  const nl2 = net(m, els2, { mcus: [{ id: 'mcu', board: 'uno328', pins: { D8: 2, '5V': 1, 'GND.1': 0 }, gnd: 0, vdd: 1, program: { lang: 'script' } }] });
  const e2 = createEngine(nl2, { mcuFactory: () => scriptMcu([[0, 'D8', { mode: 'tone', freq: 440 }]]) });
  const [cpu2, wall2] = timeIt(() => e2.advanceTo(1));
  check('~40-node circuit with tone(440) runs ≥ 1× real time', 1 / cpu2 >= 1, `${m} nodes: ratio ${(1 / cpu2).toFixed(2)}× CPU (${(1 / wall2).toFixed(2)}× wall), ${e2.stats.steps} steps`);
}

// ================================================================ analytic
if (section('linear DC')) {
  const eng = createEngine(net(3, [E('v/main', 'vsource', { p: 1, n: 0 }, { v: 9 }), E('r1/main', 'resistor', { a: 1, b: 2 }, { r: 1000 }), E('r2/main', 'resistor', { a: 2, b: 0 }, { r: 2000 })]));
  eng.dcop();
  check('divider 9 V, 1k over 2k = 6.000 V', Math.abs(eng.v(2) - 6) < 1e-6, `${eng.v(2).toFixed(9)} V, error ${Math.abs(eng.v(2) - 6).toExponential(2)}`);
  const e2 = createEngine(net(2, [E('i/main', 'isource', { p: 1, n: 0 }, { i: 1e-3 }), E('ra/main', 'resistor', { a: 1, b: 0 }, { r: 4700 }), E('rb/main', 'resistor', { a: 1, b: 0 }, { r: 4700 })]));
  e2.dcop();
  check('1 mA into 4.7k || 4.7k = 2.35 V', Math.abs(e2.v(1) - 2.35) < 1e-6, `${e2.v(1).toFixed(9)} V`);
  const e3 = createEngine(net(2, [E('b/main', 'battery', { p: 1, n: 0 }, { v: 9, rint: 1.5, mah: 500, soc: 0.6 }), E('r/main', 'resistor', { a: 1, b: 0 }, { r: 100 })]));
  e3.dcop();
  const Eb = 9 * emfFrac(0.6), I = e3.v(1) / 100;
  check('battery terminal V = E − I·Rint (soc 0.6)', rel(e3.v(1), Eb - I * 1.5) < 1e-3, `${e3.v(1).toFixed(5)} V vs ${(Eb - I * 1.5).toFixed(5)} V`);
}

if (section('diode and LED')) {
  const is = 2.52e-9, n = 1.752, rs = 0.568, R = 1000;
  const eng = createEngine(net(3, [E('v/main', 'vsource', { p: 1, n: 0 }, { v: 5 }), E('r/main', 'resistor', { a: 1, b: 2 }, { r: R }), E('d/main', 'diode', { a: 2, k: 0 }, { model: '1n4148' })]));
  eng.dcop();
  const nvt = n * VT, Rt = R + rs;
  const Iw = nvt / Rt * lambertW(is * Rt / nvt * Math.exp((5 + is * Rt) / nvt)) - is;
  const vref = 5 - Iw * R;
  check('1N4148, 5 V, 1 kΩ vs Lambert W', Math.abs(eng.v(2) - vref) < 1e-4, `${eng.v(2).toFixed(6)} V vs ${vref.toFixed(6)} V`);

  const m = ledModel('red');
  const e2 = createEngine(net(3, [E('v/main', 'vsource', { p: 1, n: 0 }, { v: 5 }), E('r/main', 'resistor', { a: 1, b: 2 }, { r: 220 }), E('d1/main', 'led', { a: 2, k: 0 }, { color: 'red' })]));
  e2.advanceTo(0.1);
  // own-model solve by bisection: 5 = 220 I + rs I + n VT ln(I/is + 1)
  let lo = 0, hi = 0.05;
  for (let k = 0; k < 200; k++) { const I = (lo + hi) / 2; const f = 5 - 220 * I - m.rs * I - m.n * VT * Math.log(I / m.is + 1); if (f > 0) lo = I; else hi = I; }
  const Iled = e2.i('d1/main');
  check('red LED, 220 Ω, 5 V: current vs own model', rel(Iled, lo) < 0.02, `${(Iled * 1e3).toFixed(4)} mA vs ${(lo * 1e3).toFixed(4)} mA`);
  const f = e2.frame();
  check('LED brightness vis.b ≈ I / 20 mA', Math.abs(f.parts.d1.vis.b - Iled / 0.02) < 0.01, `b = ${f.parts.d1.vis.b.toFixed(4)}, I/20mA = ${(Iled / 0.02).toFixed(4)}`);
}

if (section('RC RL LC RLC')) {
  for (const method of ['trap', 'be']) {
    const eng = createEngine(net(3, [E('v/main', 'vsource', { p: 1, n: 0 }, { v: 5 }), E('r/main', 'resistor', { a: 1, b: 2 }, { r: 10000 }), E('c/main', 'capacitor', { a: 2, b: 0 }, { c: 100e-6 })]), { method });
    eng.advanceTo(1);
    const v1 = eng.v(2);
    eng.advanceTo(5);
    const v5 = eng.v(2), r5 = 5 * (1 - Math.exp(-5));
    check(`RC charge v(τ) = 3.1606 V (${method})`, rel(v1, 3.16060279) < 0.005, `${v1.toFixed(5)} V (${pct(v1, 3.16060279)})`);
    check(`RC charge v(5τ) (${method})`, rel(v5, r5) < 0.001, `${v5.toFixed(5)} V (${pct(v5, r5)})`);
  }
  {
    const L = 10e-3, R = 10;
    const eng = createEngine(net(3, [E('v/main', 'vsource', { p: 1, n: 0 }, { v: 5 }), E('r/main', 'resistor', { a: 1, b: 2 }, { r: R }), E('l/main', 'inductor', { a: 2, b: 0 }, { l: L, rdc: 0 })]));
    eng.advanceTo(L / R);
    const i = eng.i('l/main'), ref = 5 / R * (1 - Math.exp(-1));
    check('RL i(L/R) = V/R·(1 − 1/e)', rel(i, ref) < 0.005, `${(i * 1e3).toFixed(4)} mA vs ${(ref * 1e3).toFixed(4)} mA (${pct(i, ref)})`);
  }
  {
    const L = 1e-3, C = 1e-6, f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
    const eng = createEngine(net(2, [E('c/main', 'capacitor', { a: 1, b: 0 }, { c: C, esr: 0, ic: 1 }), E('l/main', 'inductor', { a: 1, b: 0 }, { l: L, rdc: 0 })]));
    const tr = trace(eng, 1, 10.5 / f0, 1 / (f0 * 400));
    const ups = [];
    for (let k = 1; k < tr.length; k++) if (tr[k - 1][1] < 0 && tr[k][1] >= 0) ups.push(tr[k - 1][0] + (0 - tr[k - 1][1]) / (tr[k][1] - tr[k - 1][1]) * (tr[k][0] - tr[k - 1][0]));
    const fm = (ups.length - 1) / (ups[ups.length - 1] - ups[0]);
    const amp = Math.max(...tr.filter(p => p[0] > 9 / f0).map(p => Math.abs(p[1])));
    check('LC tank frequency 1/(2π√LC)', rel(fm, f0) < 0.005, `${fm.toFixed(2)} Hz vs ${f0.toFixed(2)} Hz (${pct(fm, f0)})`);
    check('LC tank amplitude after 10 periods (trap)', Math.abs(amp - 1) < 0.01, `${amp.toFixed(5)} V`);
  }
  {
    const R = 10, L = 1e-3, C = 1e-6;
    const w0 = 1 / Math.sqrt(L * C), z = R / 2 * Math.sqrt(C / L), wd = w0 * Math.sqrt(1 - z * z);
    const tp = Math.PI / wd, os = Math.exp(-z * Math.PI / Math.sqrt(1 - z * z));
    const eng = createEngine(net(4, [E('v/main', 'vsource', { p: 1, n: 0 }, { v: 1 }), E('r/main', 'resistor', { a: 1, b: 2 }, { r: R }), E('l/main', 'inductor', { a: 2, b: 3 }, { l: L, rdc: 0 }), E('c/main', 'capacitor', { a: 3, b: 0 }, { c: C, esr: 0 })]));
    const tr = trace(eng, 3, 2 * tp, tp / 2000);
    let pk = tr[0];
    for (const p of tr) if (p[1] > pk[1]) pk = p;
    check('series RLC peak time π/ωd', rel(pk[0], tp) < 0.02, `${(pk[0] * 1e6).toFixed(2)} µs vs ${(tp * 1e6).toFixed(2)} µs`);
    check('series RLC overshoot', rel(pk[1] - 1, os) < 0.02, `${(pk[1] - 1).toFixed(5)} vs ${os.toFixed(5)}`);
  }
}

if (section('transistors')) {
  {
    const eng = createEngine(net(5, [E('vc/main', 'vsource', { p: 1, n: 0 }, { v: 10 }), E('vb/main', 'vsource', { p: 2, n: 0 }, { v: 5 }), E('rc/main', 'resistor', { a: 1, b: 3 }, { r: 1000 }), E('rb/main', 'resistor', { a: 2, b: 4 }, { r: 1e6 }), E('q/main', 'npn', { c: 3, b: 4, e: 0 }, { model: '2n3904' })]));
    eng.dcop();
    const q = eng.dev('q/main');
    const [ic, ib] = q.terminal(eng.x);
    const vbc = eng.v(4) - eng.v(3), M = BJT_MODELS['2n3904'];
    const beta = M.bf * (1 - vbc / M.vaf);
    check('NPN active: Ic/Ib = βf·(1 − vbc/Vaf)', rel(ic / ib, beta) < 0.02, `Ic/Ib = ${(ic / ib).toFixed(2)}, model β = ${beta.toFixed(2)}, Vce = ${eng.v(3).toFixed(3)} V`);
    eng.setParam('rb', 'r', 10e3);
    const e2 = createEngine(net(5, [E('vc/main', 'vsource', { p: 1, n: 0 }, { v: 10 }), E('vb/main', 'vsource', { p: 2, n: 0 }, { v: 5 }), E('rc/main', 'resistor', { a: 1, b: 3 }, { r: 1000 }), E('rb/main', 'resistor', { a: 2, b: 4 }, { r: 10e3 }), E('q/main', 'npn', { c: 3, b: 4, e: 0 }, { model: '2n3904' })]));
    e2.dcop();
    check('NPN saturation: Vce < 0.2 V', e2.v(3) < 0.2, `Vce = ${e2.v(3).toFixed(4)} V`);
  }
  {
    const eng = createEngine(net(4, [E('vg/main', 'vsource', { p: 1, n: 0 }, { v: 4 }), E('vd/main', 'vsource', { p: 2, n: 0 }, { v: 10 }), E('rd/main', 'resistor', { a: 2, b: 3 }, { r: 10 }), E('m/main', 'nmos', { d: 3, g: 1, s: 0 }, { model: '2n7000' })]));
    eng.dcop();
    const M = MOS_MODELS['2n7000'], vds = eng.v(3);
    const ref = M.k / 2 * (4 - M.vth) ** 2 * (1 + M.lambda * vds);
    const id = eng.i('m/main');
    check('NMOS saturation Id = k/2·(Vgs − Vth)²(1 + λVds)', rel(id, ref) < 0.01, `${(id * 1e3).toFixed(3)} mA vs ${(ref * 1e3).toFixed(3)} mA, Vds = ${vds.toFixed(3)} V`);
  }
}

if (section('op-amp')) {
  const amp = (vin, vcc = 12) => createEngine(net(5, [
    E('vs/main', 'vsource', { p: 1, n: 0 }, { v: vcc }), E('vi/main', 'vsource', { p: 2, n: 0 }, { v: vin }),
    E('u/main', 'opamp', { inp: 2, inn: 3, out: 4, vcc: 1, vee: 0 }, { model: 'lm358' }),
    E('rf/main', 'resistor', { a: 4, b: 3 }, { r: 10000 }), E('rg/main', 'resistor', { a: 3, b: 0 }, { r: 1000 }),
    E('rl/main', 'resistor', { a: 4, b: 0 }, { r: 10000 })]));
  const e1 = amp(0.2); e1.dcop();
  check('LM358 non-inverting gain 11', rel(e1.v(4) / 0.2, 11) < 0.005, `gain ${(e1.v(4) / 0.2).toFixed(5)}`);
  const e2 = amp(1.5); e2.dcop();
  check('LM358 clips inside the model rails (0 … 12 − 1.5 V)', e2.v(4) <= 10.5 + 0.02 && e2.v(4) > 10.0, `out ${e2.v(4).toFixed(4)} V`);
  // −3 dB point: closed-loop gain 11 → GBW / 11
  const f3 = 1e6 / 11;
  const e3 = createEngine(net(5, [
    E('vs/main', 'vsource', { p: 1, n: 0 }, { v: 12 }), E('vi/main', 'vsource', { p: 2, n: 0 }, { wave: { kind: 'sine', amp: 0.01, freq: f3, offset: 0.5 } }),
    E('u/main', 'opamp', { inp: 2, inn: 3, out: 4, vcc: 1, vee: 0 }, { model: 'lm358' }),
    E('rf/main', 'resistor', { a: 4, b: 3 }, { r: 10000 }), E('rg/main', 'resistor', { a: 3, b: 0 }, { r: 1000 })]));
  const tr = trace(e3, 4, 30 / f3, 1 / (f3 * 200)).filter(p => p[0] > 15 / f3);
  const vmax = Math.max(...tr.map(p => p[1])), vmin = Math.min(...tr.map(p => p[1]));
  const g = (vmax - vmin) / 2 / 0.01;
  const f3m = f3 / Math.sqrt((11 / g) ** 2 - 1);
  check('LM358 −3 dB within 10 % of 1 MHz / 11', rel(f3m, f3) < 0.1, `gain at ${(f3 / 1e3).toFixed(1)} kHz = ${g.toFixed(3)} (${(20 * Math.log10(g / 11)).toFixed(2)} dB), implied f3 = ${(f3m / 1e3).toFixed(1)} kHz`);
}

if (section('555')) {
  const R1 = 1000, R2 = 10000, C = 10e-6;
  const eng = createEngine(net(5, [
    E('v/main', 'vsource', { p: 1, n: 0 }, { v: 5 }),
    E('u/main', 'timer555', { gnd: 0, trig: 2, out: 4, reset: 1, thres: 2, dis: 3, vcc: 1 }),
    E('r1/main', 'resistor', { a: 1, b: 3 }, { r: R1 }), E('r2/main', 'resistor', { a: 3, b: 2 }, { r: R2 }),
    E('c/main', 'capacitor', { a: 2, b: 0 }, { c: C }), E('rl/main', 'resistor', { a: 4, b: 0 }, { r: 10000 })]));
  const tr = trace(eng, 4, 2.5, 2e-5);
  const ed = [];
  for (let k = 1; k < tr.length; k++) { const a = tr[k - 1][1] > 2, b = tr[k][1] > 2; if (a !== b) ed.push([tr[k][0], b ? 1 : 0]); }
  const rises = ed.filter(e => e[1]).map(e => e[0]).slice(1), falls = ed.filter(e => !e[1]).map(e => e[0]).slice(1);
  const per = (rises[rises.length - 1] - rises[0]) / (rises.length - 1);
  const f = 1 / per, fr = 1.44 / ((R1 + 2 * R2) * C);
  const hiT = falls.find(t => t > rises[0]) - rises[0];
  const duty = hiT / per, dr = (R1 + R2) / (R1 + 2 * R2);
  check('555 astable f = 1.44/((R1 + 2R2)C)', rel(f, fr) < 0.05, `${f.toFixed(4)} Hz vs ${fr.toFixed(4)} Hz (${pct(f, fr)})`);
  check('555 astable duty', Math.abs(duty - dr) < 0.03, `${duty.toFixed(4)} vs ${dr.toFixed(4)}`);
}

if (section('zener regulator battery motor')) {
  for (const il of [1e-3, 5e-3, 10e-3]) {
    const eng = createEngine(net(3, [E('v/main', 'vsource', { p: 1, n: 0 }, { v: 9 }), E('r/main', 'resistor', { a: 1, b: 2 }, { r: 270 }), E('z/main', 'zener', { a: 0, k: 2 }, { vz: 5.1 }), E('l/main', 'isource', { p: 0, n: 2 }, { i: il })]));
    eng.dcop();
    check(`zener 5.1 V with ${il * 1e3} mA load`, rel(eng.v(2), 5.1) < 0.03, `${eng.v(2).toFixed(4)} V`);
  }
  for (const vin of [7, 9, 12, 20]) {
    const eng = createEngine(net(3, [E('v/main', 'vsource', { p: 1, n: 0 }, { v: vin }), E('u/main', 'regulator', { in: 1, gnd: 0, out: 2 }, { model: '7805' }), E('rl/main', 'resistor', { a: 2, b: 0 }, { r: 50 })]));
    eng.dcop();
    check(`7805 at Vin ${vin} V, 100 mA`, Math.abs(eng.v(2) - 5) <= 0.05, `${eng.v(2).toFixed(4)} V`);
  }
  {
    const eng = createEngine(net(3, [E('v/main', 'vsource', { p: 1, n: 0 }, { v: 6 }), E('u/main', 'regulator', { in: 1, gnd: 0, out: 2 }, { model: '7805' }), E('rl/main', 'resistor', { a: 2, b: 0 }, { r: 50 })]));
    eng.dcop();
    check('7805 dropout at Vin 6 V', eng.v(2) < 4.2 && eng.v(2) > 3.7, `${eng.v(2).toFixed(4)} V`);
  }
  {
    const eng = createEngine(net(2, [E('v/main', 'vsource', { p: 1, n: 0 }, { v: 5 }), E('m/main', 'motor', { a: 1, b: 0 }, { load: 0.0002 })]));
    eng.advanceTo(4);
    const d = eng.dev('m/main'), I = eng.i('m/main');
    const ref = (5 - I * d.p.r) / d.p.ke;
    check('motor steady state ω = (V − I·R)/ke', rel(d.w, ref) < 0.01, `ω ${d.w.toFixed(2)} rad/s vs ${ref.toFixed(2)} rad/s, I ${(I * 1e3).toFixed(1)} mA`);
  }
}

// ================================================================ logic
if (section('logic chips')) {
  const tables = { '74hc00': (a, b) => !(a && b), '74hc08': (a, b) => a && b, '74hc32': (a, b) => a || b, '74hc86': (a, b) => a !== b, '74hc02': (a, b) => !(a || b) };
  const QUAD = [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]];
  const NOR = [[2, 3, 1], [5, 6, 4], [8, 9, 10], [11, 12, 13]];
  for (const [chip, fn] of Object.entries(tables)) {
    const map = chip === '74hc02' ? NOR : QUAD;
    const nodes = {}; for (let p = 1; p <= 14; p++) nodes['p' + p] = p;
    nodes.p7 = 0;
    const els = [vsrc('vcc', 14, 5), E('u/main', 'logic', nodes, { chip })];
    for (const [a, b, y] of map) { els.push(vsrc('in' + a, a), vsrc('in' + b, b), E(`rl${y}/main`, 'resistor', { a: y, b: 0 }, { r: 10000 })); }
    const eng = createEngine(net(15, els));
    let ok = true, rows = [];
    for (const [A, B] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      for (const [a, b] of map) { eng.setParam('in' + a, 'v', A * 5); eng.setParam('in' + b, 'v', B * 5); }
      eng.dcop();
      const outs = map.map(([, , y]) => (eng.v(y) > 4.5 ? 1 : eng.v(y) < 0.5 ? 0 : NaN));
      const exp = fn(!!A, !!B) ? 1 : 0;
      if (!outs.every(o => o === exp)) ok = false;
      rows.push(`${A}${B}→${outs.join('')}`);
    }
    check(`${chip} truth table (4 gates)`, ok, rows.join(' '));
  }
  {
    const nodes = {}; for (let p = 1; p <= 14; p++) nodes['p' + p] = p;
    nodes.p7 = 0;
    const els = [vsrc('vcc', 14, 5), E('u/main', 'logic', nodes, { chip: '74hc04' })];
    for (const a of [1, 3, 5, 9, 11, 13]) els.push(vsrc('in' + a, a));
    const eng = createEngine(net(15, els));
    let ok = true;
    for (const A of [0, 1]) {
      for (const a of [1, 3, 5, 9, 11, 13]) eng.setParam('in' + a, 'v', A * 5);
      eng.dcop();
      for (const y of [2, 4, 6, 8, 10, 12]) if ((eng.v(y) > 2.5) === !!A) ok = false;
    }
    check('74hc04 truth table (6 inverters)', ok, 'all six invert');
  }
  {
    // 74HC74 divide by two: D1 = Q̄1, CLK1 from a 1 kHz square
    const nodes = { p1: 14, p2: 6, p3: 3, p4: 14, p5: 5, p6: 6, p7: 0, p8: 8, p9: 9, p10: 14, p11: 0, p12: 0, p13: 14, p14: 14 };
    const eng = createEngine(net(15, [vsrc('vcc', 14, 5), E('ck/main', 'vsource', { p: 3, n: 0 }, { wave: { kind: 'square', amp: 2.5, offset: 2.5, freq: 1000 } }), E('u/main', 'logic', nodes, { chip: '74hc74' })]));
    const tq = trace(eng, 5, 0.0105, 1e-5);
    let edges = 0;
    for (let k = 1; k < tq.length; k++) if ((tq[k - 1][1] > 2.5) !== (tq[k][1] > 2.5)) edges++;
    check('74hc74 toggles: Q at half the clock', edges === 10 || edges === 11, `${edges} Q edges in 10 clock periods`);
  }
  // shift register and counter through a script MCU
  const mcuNet = (els, pins, n) => net(n, els, { mcus: [{ id: 'mcu', board: 'uno328', pins, gnd: 0, vdd: 1, program: { lang: 'script' } }] });
  {
    // 595: D2 = SER, D3 = SRCLK, D4 = RCLK. Byte 0b10110010 shifted MSB first.
    const nodes = { p16: 1, p8: 0, p10: 1, p13: 0, p14: 2, p11: 3, p12: 4 };
    const Q = { QA: 15, QB: 1, QC: 2, QD: 3, QE: 4, QF: 5, QG: 6, QH: 7 };
    let nn = 5;
    const qn = {};
    for (const [k, p] of Object.entries(Q)) { qn[k] = nn; nodes['p' + p] = nn++; }
    nodes.p9 = nn++;
    const els = [vsrc('vcc', 1, 5), E('u/main', 'logic', nodes, { chip: '74hc595' })];
    for (const k in qn) els.push(E(`r${k}/main`, 'resistor', { a: qn[k], b: 0 }, { r: 10000 }));
    const acts = [];
    let t = 1e-3;
    const byte = 0b10110010;
    for (let b = 7; b >= 0; b--) {
      acts.push([t, 'D2', { mode: 'out', level: (byte >> b) & 1 }]); t += 10e-6;
      acts.push([t, 'D3', { mode: 'out', level: 1 }]); t += 10e-6;
      acts.push([t, 'D3', { mode: 'out', level: 0 }]); t += 10e-6;
    }
    acts.push([t, 'D4', { mode: 'out', level: 1 }]); t += 10e-6;
    acts.push([t, 'D4', { mode: 'out', level: 0 }]);
    const eng = createEngine(mcuNet(els, { D2: 2, D3: 3, D4: 4, '5V': 1, 'GND.1': 0 }, nn), { mcuFactory: () => scriptMcu(acts) });
    eng.advanceTo(t + 1e-3);
    // QA holds the last bit shifted in (bit 0), QH the first (bit 7)
    const got = ['QA', 'QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH'].map((k, i) => (eng.v(qn[k]) > 2.5 ? 1 : 0) << i).reduce((a, b) => a | b, 0);
    check('74hc595 shifts and latches a byte', got === byte, `latched 0b${got.toString(2).padStart(8, '0')}, sent 0b${byte.toString(2).padStart(8, '0')}`);
  }
  {
    // CD4017: CLK from D2, RESET from D3
    const order = [3, 2, 4, 7, 10, 1, 5, 6, 9, 11];
    const nodes = { p16: 1, p8: 0, p13: 0, p14: 2, p15: 3 };
    let nn = 4;
    const qn = order.map(p => { nodes['p' + p] = nn; return nn++; });
    nodes.p12 = nn++;
    const els = [vsrc('vdd', 1, 9), E('u/main', 'logic', nodes, { chip: 'cd4017' })];
    qn.forEach((n, i) => els.push(E(`r${i}/main`, 'resistor', { a: n, b: 0 }, { r: 100000 })));
    const acts = [];
    let t = 1e-3;
    const states = [];
    for (let k = 0; k < 12; k++) { acts.push([t, 'D2', { mode: 'out', level: 1 }]); t += 50e-6; acts.push([t, 'D2', { mode: 'out', level: 0 }]); t += 50e-6; states.push(t - 10e-6); }
    acts.push([t, 'D3', { mode: 'out', level: 1 }]); t += 50e-6; acts.push([t, 'D3', { mode: 'out', level: 0 }]);
    const eng = createEngine(mcuNet(els, { D2: 2, D3: 3, '5V': 1, 'GND.1': 0 }, nn), { mcuFactory: () => scriptMcu(acts), pwm: 'switch' });
    // the board runs on the 9 V node here; the stub MCU ignores vdd
    eng.hosts.get('mcu').info = { ...eng.hosts.get('mcu').info, vnom: 9 };
    const seen = [];
    for (const ts of states) { eng.advanceTo(ts); seen.push(qn.findIndex(n => eng.v(n) > 4.5)); }
    eng.advanceTo(t + 1e-4);
    const afterReset = qn.findIndex(n => eng.v(n) > 4.5);
    const exp = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2];
    check('CD4017 counts 0–9, wraps and resets', JSON.stringify(seen) === JSON.stringify(exp) && afterReset === 0, `outputs after each clock: ${seen.join(',')}; after reset Q${afterReset}`);
  }
  {
    // hd44780 4-bit: RS D12, E D11, D4..D7 = D5, D4, D3, D2
    const pins = { D12: 2, D11: 3, D5: 4, D4: 5, D3: 6, D2: 7, '5V': 1, 'GND.1': 0 };
    const els = [vsrc('vcc', 1, 5), E('lcd/main', 'hd44780', { vss: 0, vdd: 1, v0: 0, rs: 2, rw: 0, e: 3, d0: 0, d1: 0, d2: 0, d3: 0, d4: 4, d5: 5, d6: 6, d7: 7 })];
    const acts = lcdScript('HI');
    const eng = createEngine(mcuNet(els, pins, 8), { mcuFactory: () => scriptMcu(acts) });
    eng.advanceTo(acts[acts.length - 1][0] + 1e-3);
    const f = eng.frame();
    const rows = f.parts.lcd.vis.rows;
    check('hd44780 4-bit init and "HI" by pin edges', rows[0].startsWith('HI'), `rows[0] = "${rows[0]}"`);
  }
}

// ================================================================ damage
if (section('damage')) {
  {
    const { frames } = runFor(net(2, [E('b/main', 'battery', { p: 1, n: 0 }, { v: 9, rint: 1.7, mah: 500 }), E('d1/main', 'led', { a: 1, k: 0 }, { color: 'red' })]), 0.5);
    const ev = frames.flatMap(f => f.events).find(e => e.kind === 'damage' && e.owner === 'd1');
    check('LED on 9 V with no resistor burns within 0.5 s', !!ev && ev.smoke && ev.t <= 0.5, ev ? `t = ${ev.t.toFixed(3)} s: ${ev.msg}` : 'no damage event');
  }
  {
    const { eng, frames } = runFor(net(2, [E('v/main', 'vsource', { p: 1, n: 0 }, { v: 20 }), E('r/main', 'resistor', { a: 1, b: 0 }, { r: 400, pmax: 0.25 })]), 2);
    const ev = frames.flatMap(f => f.events).find(e => e.kind === 'damage' && e.owner === 'r');
    check('1/4 W resistor at 1 W burns (about 1 s)', !!ev && ev.t > 0.6 && ev.t < 1.5 && eng.dev('r/main').damaged === 'burnt', ev ? `t = ${ev.t.toFixed(3)} s` : 'no damage event');
  }
  {
    const { frames } = runFor(net(2, [E('v/main', 'vsource', { p: 1, n: 0 }, { v: 9 }), E('c/main', 'capacitor', { a: 0, b: 1 }, { c: 100e-6, polarized: true, vmax: 25 })]), 1);
    const ev = frames.flatMap(f => f.events).find(e => e.kind === 'damage' && e.owner === 'c');
    check('reversed electrolytic vents', !!ev && ev.smoke, ev ? `t = ${ev.t.toFixed(3)} s: ${ev.msg}` : 'no event');
  }
  {
    const { frames, eng } = runFor(net(3, [E('v/main', 'vsource', { p: 1, n: 0 }, { v: 2 }), E('f/main', 'fuse', { a: 1, b: 2 }, { rating: 1 }), E('r/main', 'resistor', { a: 2, b: 0 }, { r: 0.95, pmax: 100 })]), 0.5);
    const ev = frames.flatMap(f => f.events).find(e => e.kind === 'fuse');
    check('fuse blows at 2× rating', !!ev && eng.dev('f/main').damaged === 'blown', ev ? `t = ${ev.t.toFixed(3)} s` : 'no fuse event');
  }
  {
    const { frames, eng } = runFor(net(2, [E('s/main', 'supply', { p: 1, n: 0 }, { v: 5, ilim: 0.1, on: true }), E('w/main', 'wire', { a: 1, b: 0 })]), 0.2);
    const evs = frames.flatMap(f => f.events);
    const cc = evs.find(e => e.kind === 'cc'), dmg = evs.find(e => e.kind === 'damage');
    const f = eng.frame();
    check('bench supply short → cc event, no damage', !!cc && !dmg && f.parts.s.vis.cc === true, `cc at ${cc ? cc.t.toExponential(2) : '-'} s, output ${eng.v(1).toFixed(4)} V, ${(eng.i('s/main') * 1e3).toFixed(2)} mA`);
  }
  {
    const eng = createEngine(net(2, [E('b/main', 'battery', { p: 1, n: 0 }, { v: 9, rint: 1.7, mah: 500 }), E('d1/main', 'led', { a: 1, k: 0 })]));
    eng.advanceTo(0.3);
    eng.repair('d1');
    const ok = eng.dev('d1/main').damaged === null;
    check('repair clears damage', ok, `damaged = ${eng.dev('d1/main').damaged}`);
  }
}

// ================================================================ more models
if (section('relay motor comparator probes')) {
  {
    // NPN drives a 5 V relay; the contact switches a 6 V lamp; flyback diode
    const els = [vsrc('v5', 1, 5), vsrc('v6', 2, 6), E('sw/main', 'switch', { a: 1, b: 3 }, { on: false }), E('rb/main', 'resistor', { a: 3, b: 4 }, { r: 1000 }),
      E('q/main', 'npn', { c: 5, b: 4, e: 0 }), E('k/main', 'relay', { c1: 1, c2: 5, com: 2, no: 6, nc: 7 }), E('d/main', 'diode', { a: 5, k: 1 }, { model: '1n4007' }),
      E('la/main', 'lamp', { a: 6, b: 0 })];
    const eng = createEngine(net(8, els));
    eng.advanceTo(0.05);
    const off = eng.frame();
    eng.setParam('sw', 'on', true);
    eng.advanceTo(0.3);
    const on = eng.frame();
    check('relay picks up through an NPN and the lamp glows', off.parts.k.vis.on === false && on.parts.k.vis.on === true && on.parts.la.vis.on && on.parts.la.vis.b > 0.9, `relay ${off.parts.k.vis.on}→${on.parts.k.vis.on}, lamp b ${on.parts.la.vis.b.toFixed(3)}, coil ${(eng.i('k/main') * 1e3).toFixed(1)} mA`);
  }
  for (const withDiode of [true, false]) {
    const els = [vsrc('v', 1, 5), E('sw/main', 'switch', { a: 1, b: 2 }, { on: true }), E('rb/main', 'resistor', { a: 2, b: 3 }, { r: 470 }), E('rbe/main', 'resistor', { a: 3, b: 0 }, { r: 10000 }),
      E('q/main', 'npn', { c: 4, b: 3, e: 0 }, { model: '2n2222' }), E('m/main', 'motor', { a: 1, b: 4 })];
    if (withDiode) els.push(E('d/main', 'diode', { a: 4, k: 1 }, { model: '1n4007' }));
    const eng = createEngine(net(5, els));
    eng.advanceTo(1);
    eng.setParam('sw', 'on', false);
    let vmax = 0;
    while (eng.t < 1.002) { eng.advanceTo(eng.t + 2e-6); vmax = Math.max(vmax, eng.v(4)); }
    const ok = withDiode ? vmax < 6.5 : vmax > 25;
    check(`motor switched off ${withDiode ? 'with' : 'without'} a flyback diode: collector peak`, ok, `${vmax.toFixed(2)} V`);
  }
  {
    // LM358 as a comparator: thermistor divider against a set point
    const els = [vsrc('v', 1, 5), E('rt/main', 'resistor', { a: 1, b: 2 }, { r: 10000 }), E('th/main', 'thermistor', { a: 2, b: 0 }, { tempC: 20 }),
      E('r1/main', 'resistor', { a: 1, b: 3 }, { r: 10000 }), E('r2/main', 'resistor', { a: 3, b: 0 }, { r: 8000 }),
      E('u/main', 'opamp', { inp: 3, inn: 2, out: 4, vcc: 1, vee: 0 }, { model: 'lm358' }), E('rl/main', 'resistor', { a: 4, b: 0 }, { r: 10000 })];
    const eng = createEngine(net(5, els));
    eng.advanceTo(0.01);
    const lo = eng.v(4);
    eng.setParam('th', 'tempC', 35);
    eng.advanceTo(0.02);
    const hi = eng.v(4);
    check('LM358 comparator switches when the thermistor passes the set point', lo < 0.1 && hi > 3.3, `out ${lo.toFixed(3)} V at 20 °C, ${hi.toFixed(3)} V at 35 °C`);
  }
  {
    const els = [E('ck/main', 'vsource', { p: 1, n: 0 }, { wave: { kind: 'square', amp: 2.5, offset: 2.5, freq: 1000 } }), E('r/main', 'resistor', { a: 1, b: 0 }, { r: 1000 })];
    const eng = createEngine(net(2, els, { probes: [{ id: 'la', type: 'logic', leads: { d0: 1, gnd: 0 }, settings: { threshold: 1.4 } }] }));
    eng.advanceTo(0.0105);
    const f = eng.frame().probes.la;
    const rises = f.edges.filter(e => e[1] === 0 && e[2] === 1).map(e => e[0]);
    const per = (rises[rises.length - 1] - rises[0]) / (rises.length - 1);
    check('logic analyzer edges of a 1 kHz square', f.edges.length >= 20 && Math.abs(per - 1e-3) < 1e-7, `${f.edges.length} edges, period ${(per * 1e3).toFixed(6)} ms`);
  }
  {
    const els = [vsrc('v', 1, 0), E('r/main', 'resistor', { a: 2, b: 3 }, { r: 10 })];
    const eng = createEngine(net(4, els, { probes: [{ id: 'm', type: 'dmm', leads: { red: 2, black: 3 }, settings: { mode: 'cont' } }] }));
    eng.advanceTo(0.01);
    const f = eng.frame().probes.m;
    check('continuity mode beeps on 10 Ω', f.beep && Math.abs(f.value - 10) < 0.01, `${f.value.toFixed(4)} Ω, beep ${f.beep}`);
  }
  {
    const els = [E('usb/main', 'usbpower', { p: 1, n: 0 }), E('r/main', 'resistor', { a: 1, b: 0 }, { r: 4, pmax: 100 })];
    const { eng, frames } = runFor(net(2, els), 1.0);
    const ev = frames.flatMap(f => f.events).find(e => e.kind === 'fuse');
    check('USB polyfuse trips at about 1.2 A', !!ev && eng.dev('usb/main').tripped, ev ? `t = ${ev.t.toFixed(3)} s: ${ev.msg}` : 'no event');
  }
  {
    const els = [E('pv/main', 'solar', { p: 1, n: 0 }, { isc: 0.1, voc: 6, lux: 100000 })];
    const e1 = createEngine(net(2, els)); e1.dcop();
    const e2 = createEngine(net(2, [...els, E('r/main', 'resistor', { a: 1, b: 0 }, { r: 1 })])); e2.dcop();
    check('solar cell: Voc and Isc at full light', Math.abs(e1.v(1) - 6) < 0.15 && Math.abs(e2.v(1) / 1 - 0.1) < 0.005, `Voc ${e1.v(1).toFixed(3)} V, I into 1 Ω ${(e2.v(1) * 1e3).toFixed(2)} mA`);
  }
  {
    // a rebuild keeps capacitor charge (load with carry, as after a wire edit)
    const mk = (extra) => net(4, [vsrc('v', 1, 5), E('r/main', 'resistor', { a: 1, b: 2 }, { r: 10000 }), E('c/main', 'capacitor', { a: 2, b: 0 }, { c: 100e-6 }), ...extra]);
    const e1 = createEngine(mk([]));
    e1.advanceTo(0.5);
    const v1 = e1.v(2);
    const e2 = createEngine(mk([E('rx/main', 'resistor', { a: 3, b: 0 }, { r: 1000 })]));
    e2.restoreState(e1.snapshotState());
    const v2 = e2.v(2);
    e2.advanceTo(1.0);
    const ref = 5 * (1 - Math.exp(-1));
    check('restoreState carries capacitor charge across a rebuild', Math.abs(v2 - v1) < 1e-3 && rel(e2.v(2), ref) < 0.005, `${v1.toFixed(4)} V → ${v2.toFixed(4)} V; at 1 s ${e2.v(2).toFixed(4)} V (ref ${ref.toFixed(4)})`);
  }
}

// ================================================================ netlist
let realGeo = null, realReg = null;
try { realGeo = await import('../parts/geometry.js'); } catch (e) { realGeo = null; }
try { const P = await import('../parts/index.js'); realReg = P.createRegistry(); } catch (e) { realReg = null; }
if (section('netlist')) {
  const geo = realGeo || geoStub;
  console.log(`   geometry: ${realGeo ? 'parts/geometry.js (real)' : 'test stub'}`);
  const reg = stubRegistry();
  const G = 2.54;
  const hw = (type, local) => geo.holeLocal(type, local);
  const doc = (boards, parts, wires = []) => ({ format: 'breadboard-lab', version: 1, boards, parts, wires, probes: [], materials: [], customParts: [], programs: {} });
  const at = (b, local, extra = {}) => { const l = hw('bb830', local); return { on: b, x: l.x, z: l.z, rot: 0, ...extra }; };
  {
    const d = doc([{ id: 'b1', type: 'bb830', x: 0, z: 0, rot: 0 }], [
      { id: 'r1', def: 'res', place: at('b1', 'TP1', { rot: 1 }), params: { span: 4 } },
      { id: 'r2', def: 'res', place: at('b1', 'TP50', { rot: 1 }), params: { span: 4 } },
      { id: 'r3', def: 'res', place: at('b1', 'a5'), params: { span: 4 } },
      { id: 'r4', def: 'res', place: at('b1', 'e5'), params: { span: 4 } },
      { id: 'r5', def: 'res', place: at('b1', 'f5'), params: { span: 4 } },
    ]);
    const nl = buildNetlist(d, reg, geo);
    check('830 rail is one strip along its length', nl.pinNode['r1.1'] === nl.pinNode['r2.1'] && nl.pinNode['r1.1'] != null, `TP1 node ${nl.pinNode['r1.1']}, TP50 node ${nl.pinNode['r2.1']}`);
    check('a–e of a column is one strip, f–j another', nl.pinNode['r3.1'] === nl.pinNode['r4.1'] && nl.pinNode['r4.1'] !== nl.pinNode['r5.1'], `a5 ${nl.pinNode['r3.1']}, e5 ${nl.pinNode['r4.1']}, f5 ${nl.pinNode['r5.1']}`);
    d.boards[0].params = { splitRails: true };
    const nl2 = buildNetlist(d, reg, geo);
    check('split rails split at the middle', nl2.pinNode['r1.1'] !== nl2.pinNode['r2.1'], `TP1 node ${nl2.pinNode['r1.1']}, TP50 node ${nl2.pinNode['r2.1']}`);
  }
  {
    // a resistor turned to run down one column: both legs in a-e
    const d = doc([{ id: 'b1', type: 'bb830', x: 0, z: 0, rot: 0 }], [{ id: 'r1', def: 'res', place: at('b1', 'a12', { rot: 1 }), params: { span: 4 } }]);
    const nl = buildNetlist(d, reg, geo);
    const iss = nl.issues.find(i => i.code === 'shorted-part');
    check('resistor with both pins in one column is shorted-part', !!iss, iss ? iss.msg : JSON.stringify(nl.issues.map(i => i.code)));
  }
  {
    // a 9-pitch part over two boards: one pin on each board
    const b1 = { id: 'b1', type: 'bb830', x: 0, z: 0, rot: 0 };
    const lj = hw('bb830', 'j10');
    const b2 = { id: 'b2', type: 'bb830', x: 0, z: (lj.z + 9 * G) - hw('bb830', 'a10').z, rot: 0 };
    const d = doc([b1, b2], [{ id: 'u1', def: 'span2', place: { on: 'b1', x: lj.x, z: lj.z, rot: 0 }, params: {} }]);
    const nl = buildNetlist(d, reg, geo);
    check('a part that spans two boards connects on both', nl.pinHole['u1.X'] === 'b1:j10' && nl.pinHole['u1.Y'] === 'b2:a10' && nl.pinNode['u1.X'] !== nl.pinNode['u1.Y'], `pins in ${nl.pinHole['u1.X']} and ${nl.pinHole['u1.Y']}`);
  }
  {
    // first LED: supply sockets → wires → board; ground is the supply −
    const d = doc([{ id: 'b1', type: 'bb830', x: 0, z: 0, rot: 0 }], [
      { id: 'ps', def: 'supply-bench', place: { on: null, x: -60, z: 60, rot: 0 }, params: { v: 5 } },
      { id: 'r1', def: 'res', place: at('b1', 'a10'), params: { span: 4, r: 220 } },
      { id: 'd1', def: 'led', place: at('b1', 'b14'), params: {} },
    ], [
      { id: 'w1', a: { part: 'ps', pin: '+' }, b: { hole: 'b1:TP3' }, color: '#d63b3b', style: 'arch' },
      { id: 'w2', a: { part: 'ps', pin: '−' }, b: { hole: 'b1:TN3' }, color: '#2b2b2b', style: 'arch' },
      { id: 'w3', a: { hole: 'b1:TP9' }, b: { hole: 'b1:b10' }, color: '#d63b3b', style: 'flat' },
      { id: 'w4', a: { hole: 'b1:a15' }, b: { hole: 'b1:TN12' }, color: '#2b2b2b', style: 'flat' },
    ]);
    const nl = buildNetlist(d, reg, geo);
    check('first-led layout has no issues', nl.issues.length === 0, nl.issues.map(x => x.code).join(',') || 'none');
    check('ground is the first source negative', nl.ground.why === 'first source negative' && nl.pinNode['ps.−'] === 0, `why "${nl.ground.why}", supply − node ${nl.pinNode['ps.−']}`);
    check('wires are elements in wireIds order', nl.wireIds.join() === 'w1,w2,w3,w4' && nl.elements.filter(e => e.type === 'wire').length === 4, nl.wireIds.join());
    const { eng } = runFor(nl, 0.1);
    const i = eng.i('d1/main');
    check('first-led netlist runs: LED current', i > 0.012 && i < 0.0145, `${(i * 1e3).toFixed(2)} mA; issues: ${nl.issues.map(x => x.code).join(',') || 'none'}`);
    const f = eng.frame();
    check('frame wire currents follow wireIds', Math.abs(f.wires[0] - i) < 1e-4 && f.wires.length === 4, `w1 ${(f.wires[0] * 1e3).toFixed(3)} mA`);
    // checks: LED with no resistor
    const d2 = JSON.parse(JSON.stringify(d));
    d2.wires[2].b = { hole: 'b1:c14' };
    const nl2 = buildNetlist(d2, reg, geo);
    check('check led-no-resistor', nl2.issues.some(x => x.code === 'led-no-resistor'), nl2.issues.map(x => x.code).join(','));
    const d3 = JSON.parse(JSON.stringify(d));
    d3.wires.push({ id: 'w5', a: { hole: 'b1:TP20' }, b: { hole: 'b1:TN20' }, color: '#fff', style: 'flat' });
    const nl3 = buildNetlist(d3, reg, geo);
    check('check supply-short', nl3.issues.some(x => x.code === 'supply-short'), nl3.issues.map(x => x.code).join(','));
  }
  {
    // DIP on one side of the channel; floating inputs; rail with no feed
    const d = doc([{ id: 'b1', type: 'bb830', x: 0, z: 0, rot: 0 }], [
      { id: 'u1', def: 'ic-74hc00', place: at('b1', 'e10'), params: {} },
      { id: 'u2', def: 'ic-74hc00', place: at('b1', 'j30'), params: {} },
      { id: 'u3', def: 'ic-74hc00', place: at('b1', 'f45'), params: {} },
      { id: 'r9', def: 'res', place: at('b1', 'BP3'), params: { span: 4 } },
    ]);
    const nl = buildNetlist(d, reg, geo);
    const codes = nl.issues.map(x => x.code);
    check('check ic-not-straddling (2 of 3 chips)', codes.filter(c => c === 'ic-not-straddling').length === 2, [...new Set(codes)].join(','));
    check('check floating-input (8 inputs of the straddling chip)', codes.filter(c => c === 'floating-input').length === 8, `${codes.filter(c => c === 'floating-input').length} floating inputs`);
    check('check rail-no-feed', codes.includes('rail-no-feed'), [...new Set(codes)].join(','));
    check('check no-ground', codes.includes('no-ground'), [...new Set(codes)].join(','));
  }
}

// ================================================================ MCU
if (section('mcu co-sim')) {
  {
    const mcu = toggleMcu('D13', 0.5);
    const nl = net(4, [vsrc('vcc', 1, 5), E('r/main', 'resistor', { a: 2, b: 3 }, { r: 220 }), E('d1/main', 'led', { a: 3, k: 0 })],
      { mcus: [{ id: 'mcu', board: 'uno328', pins: { D13: 2, '5V': 1, 'GND.1': 0 }, gnd: 0, vdd: 1, program: { lang: 'script' } }] });
    const eng = createEngine(nl, { mcuFactory: () => mcu });
    const samp = [];
    for (const tt of [0.5 - 1e-6, 0.5 + 1e-6, 1.0 - 1e-6, 1.0 + 1e-6]) { eng.advanceTo(tt); samp.push(eng.i('d1/main')); }
    const ok = samp[0] < 1e-5 && samp[1] > 0.01 && samp[2] > 0.01 && samp[3] < 1e-5;
    check('stub MCU toggles D13 every 0.5 s: LED current toggles at 0.5 s ± 1 µs', ok, samp.map(v => `${(v * 1e3).toFixed(3)} mA`).join(' / ') + ` (edges at ${mcu.edges.slice(0, 3).map(e => e[0]).join(', ')})`);
  }
  {
    // brownout: board vdd from a supply that we switch off
    const mcu = toggleMcu('D13', 0.1);
    const nl = net(3, [E('ps/main', 'supply', { p: 1, n: 0 }, { v: 5, ilim: 1, on: true }), E('r/main', 'resistor', { a: 2, b: 0 }, { r: 1000 })],
      { mcus: [{ id: 'mcu', board: 'uno328', pins: { D13: 2, '5V': 1, 'GND.1': 0 }, gnd: 0, vdd: 1, program: { lang: 'script' } }] });
    const eng = createEngine(nl, { mcuFactory: () => mcu });
    eng.advanceTo(0.25);
    eng.setParam('ps', 'on', false);
    eng.advanceTo(0.3);
    const ev = eng.drainEvents().find(e => e.kind === 'brownout');
    const off = eng.frame().mcus.mcu;
    eng.setParam('ps', 'on', true);
    eng.advanceTo(0.45);
    check('brownout holds the MCU in reset and restarts it', !!ev && off.brownout && !off.running && eng.frame().mcus.mcu.running, ev ? ev.msg : 'no brownout event');
  }
  {
    // PWM on an LED: brightness ∝ duty (switched in auto mode)
    const b = [];
    for (const duty of [0.25, 0.75]) {
      const acts = [[0, 'D9', { mode: 'pwm', duty, freq: 490 }]];
      const nl = net(4, [vsrc('vcc', 1, 5), E('r/main', 'resistor', { a: 2, b: 3 }, { r: 220 }), E('d1/main', 'led', { a: 3, k: 0 })],
        { mcus: [{ id: 'mcu', board: 'uno328', pins: { D9: 2, '5V': 1, 'GND.1': 0 }, gnd: 0, vdd: 1, program: { lang: 'script' } }] });
      const eng = createEngine(nl, { mcuFactory: () => scriptMcu(acts) });
      eng.advanceTo(0.05); eng.frame();
      eng.advanceTo(0.15);
      b.push(eng.frame().parts.d1.vis.b);
    }
    check('LED on a PWM pin: brightness ∝ duty', Math.abs(b[1] / b[0] - 3) < 0.15, `b(25 %) = ${b[0].toFixed(4)}, b(75 %) = ${b[1].toFixed(4)}, ratio ${(b[1] / b[0]).toFixed(3)}`);
  }
  for (const via of ['100 Ω', 'NPN driver']) {
    const acts = [[0, 'D8', { mode: 'tone', freq: 440 }]];
    let els;
    if (via === '100 Ω') els = [vsrc('vcc', 1, 5), E('r/main', 'resistor', { a: 2, b: 3 }, { r: 100 }), E('bz/main', 'buzzer', { a: 3, b: 0 }, { active: false })];
    else els = [vsrc('vcc', 1, 5), E('rb/main', 'resistor', { a: 2, b: 3 }, { r: 1000 }), E('q/main', 'npn', { c: 4, b: 3, e: 0 }), E('bz/main', 'buzzer', { a: 1, b: 4 }, { active: false }), E('dd/main', 'diode', { a: 4, k: 1 }, { model: '1n4148' })];
    const nl = net(5, els, { mcus: [{ id: 'mcu', board: 'uno328', pins: { D8: 2, '5V': 1, 'GND.1': 0 }, gnd: 0, vdd: 1, program: { lang: 'script' } }] });
    const eng = createEngine(nl, { mcuFactory: () => scriptMcu(acts) });
    eng.advanceTo(0.2);
    const f = eng.frame().parts.bz.vis.freq;
    check(`tone(8, 440) through ${via}: buzzer vis.freq`, rel(f, 440) < 0.01, `${f.toFixed(3)} Hz`);
  }
}

// ================================================================ speed
// ================================================================ client / misc
if (section('client measureR probes')) {
  {
    const eng = createEngine(net(4, [vsrc('v', 1, 0), E('r1/main', 'resistor', { a: 2, b: 3 }, { r: 1000 }), E('r2/main', 'resistor', { a: 3, b: 0 }, { r: 2200 })]));
    eng.dcop();
    const R = eng.measureR(2, 0);
    check('measureR: 1 kΩ + 2.2 kΩ with the power off', rel(R, 3200) < 1e-4, `${R.toFixed(3)} Ω`);
  }
  {
    const nl = net(3, [vsrc('v', 1, 5), E('r1/main', 'resistor', { a: 1, b: 2 }, { r: 1000 }), E('r2/main', 'resistor', { a: 2, b: 0 }, { r: 1000 })],
      { probes: [{ id: 'm1', type: 'dmm', leads: { red: 2, black: 0 }, settings: { mode: 'V' } }, { id: 'm2', type: 'dmm', leads: { red: 1, black: 2 }, settings: { mode: 'R' } }, { id: 'sc', type: 'scope', leads: { ch1: 2, gnd: 0 }, settings: { tdiv: 1e-3 } }] });
    const eng = createEngine(nl);
    eng.advanceTo(0.02);
    const f = eng.frame();
    check('DMM V reads the divider', Math.abs(f.probes.m1.value - 2.5) < 0.01, `${f.probes.m1.value.toFixed(5)} V (10 MΩ meter load)`);
    check('DMM Ω on a live circuit reads overload and warns', f.probes.m2.overload && eng.drainEvents().some(e => /power off/.test(e.msg)), `overload ${f.probes.m2.overload}`);
    check('scope samples at tdiv/50', f.probes.sc.ch[0].length >= 990 && f.probes.sc.ch[0].length <= 1002 && Math.abs(f.probes.sc.dt - 2e-5) < 1e-12, `${f.probes.sc.ch[0].length} samples, dt ${f.probes.sc.dt}`);
    eng.addProbe({ id: 'm3', type: 'dmm', leads: { red: 1, black: 2 }, settings: { mode: 'A' } });
    eng.advanceTo(0.04);
    const f2 = eng.frame();
    check('addProbe: DMM in A mode across R1 shorts it: 5 V / (1 kΩ + 0.1 Ω)', rel(f2.probes.m3.value, 5 / 1000.1) < 0.002 && f2.probes.m3.fuse === 'ok', `${(f2.probes.m3.value * 1e3).toFixed(4)} mA`);
  }
  {
    const sim = createSim({ inline: true });
    const frames = [];
    sim.on('frame', f => frames.push(f));
    const res = await sim.load(net(3, [vsrc('v', 1, 5), E('r/main', 'resistor', { a: 1, b: 2 }, { r: 220 }), E('d1/main', 'led', { a: 2, k: 0 })], { probes: [{ id: 'm1', type: 'dmm', leads: { red: 1, black: 0 }, settings: { mode: 'R' } }] }));
    sim.start();
    await new Promise(r => setTimeout(r, 250));
    sim.pause();
    const last = frames[frames.length - 1];
    sim.dispose();
    check('inline client: load, run, frames at about 30 Hz', res.ok && frames.length >= 4 && last && last.t > 0.1, `${frames.length} frames in 0.25 s, t = ${last ? last.t.toFixed(3) : '-'} s, ratio ${last ? last.ratio.toFixed(2) : '-'}`);
  }
}

// ================================================================ real parts
if (section('builtin parts (cross-role)')) {
  if (!realReg) console.log('   parts/index.js did not import; skipped');
  else {
    const defs = realReg.list();
    const bad = [];
    for (const def of defs) {
      for (const tpl of def.electrical || []) {
        if (!TYPES[tpl.type]) bad.push(`${def.id}/${tpl.id}: unknown type ${tpl.type}`);
      }
      const doc = { format: 'breadboard-lab', version: 1, boards: [], parts: [{ id: 'p1', def: def.id, place: { on: null, x: 0, z: 0, rot: 0 }, params: {} }], wires: [], probes: [], materials: [], customParts: [], programs: {} };
      try {
        const nl = buildNetlist(doc, realReg, realGeo || geoStub);
        const eng = createEngine(nl);
        eng.advanceTo(1e-3);
        eng.frame();
        if (eng.warnings.length) bad.push(`${def.id}: ${eng.warnings.join('; ')}`);
      } catch (e) { bad.push(`${def.id}: ${e.message}`); }
    }
    check(`every builtin part def (${defs.length}) builds a netlist and runs 1 ms`, bad.length === 0, bad.length ? bad.slice(0, 12).join(' | ') : 'all ran');
  }
}

// ================================================================ real parts + MCU runtime
let realMcu = null;
try { realMcu = await import('../mcu/runtime.js'); } catch (e) { realMcu = null; }
if (section('real parts and MCU runtime (cross-role)')) {
  if (!realReg || !realMcu) console.log('   parts/index.js or mcu/runtime.js did not import; skipped');
  else {
    const { SKETCHES } = await import('../mcu/sketches.js');
    const geo = realGeo || geoStub;
    const factory = (spec) => realMcu.createMcu(spec);
    const end = (s) => { const i = s.indexOf('.'); return { part: s.slice(0, i), pin: s.slice(i + 1) }; };
    const mkDoc = (parts, wires, programs = {}) => ({
      format: 'breadboard-lab', version: 1, boards: [],
      parts: parts.map(([id, def, params = {}], i) => ({ id, def, place: { on: null, x: i * 40, z: 0, rot: 0 }, params })),
      wires: wires.map(([a, b], i) => ({ id: 'w' + (i + 1), a: end(a), b: end(b), color: '#d63b3b', style: 'arch' })),
      probes: [], materials: [], customParts: [], programs,
    });
    const prog = (key) => ({ u: { lang: 'sketch', source: SKETCHES[key].source } });
    const sample = (eng, times, fn) => times.map(t => { eng.advanceTo(t); return fn(); });
    {
      const doc = mkDoc([['u', 'mcu-uno'], ['r1', 'res', { r: 220 }], ['d1', 'led']], [['u.D13', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'u.GND.1']], prog('uno-blink'));
      const nl = buildNetlist(doc, realReg, geo);
      const eng = createEngine(nl, { mcuFactory: factory });
      const on = sample(eng, [0.25, 0.75, 1.25, 1.75], () => eng.i('d1/main') > 0.005 ? 1 : 0);
      eng.frame();
      eng.advanceTo(2.2);
      const f = eng.frame();
      const L = f.parts.u.vis && f.parts.u.vis.leds ? Object.entries(f.parts.u.vis.leds).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ') : 'none';
      check('uno-blink sketch (real runtime, real defs): D13 LED blinks at 1 Hz', on.join('') === '1010', `LED on at 0.25/0.75/1.25/1.75 s: ${on.join('')}; board LEDs: ${L}; mcu ${JSON.stringify(f.mcus.u.running)}`);
    }
    {
      const doc = mkDoc([['u', 'mcu-uno'], ['b1', 'button-6mm']], [['u.D2', 'b1.1'], ['b1.3', 'u.GND.1']], prog('uno-button-serial'));
      const eng = createEngine(buildNetlist(doc, realReg, geo), { mcuFactory: factory });
      eng.advanceTo(0.2);
      eng.press('b1', true); eng.advanceTo(0.4);
      eng.press('b1', false); eng.advanceTo(0.6);
      eng.press('b1', true); eng.advanceTo(0.8);
      eng.press('b1', false); eng.advanceTo(1.0);
      const text = eng.drainSerial().map(s => s.text).join('');
      check('uno-button-serial: INPUT_PULLUP button presses reach Serial', /Ready/.test(text) && /Press 1/.test(text) && /Press 2/.test(text), JSON.stringify(text));
    }
    {
      const doc = mkDoc([['u', 'mcu-uno'], ['lcd', 'lcd-1602'], ['tp', 'pot', { pos: 0.1 }], ['rf', 'res', { r: 10000 }], ['th', 'thermistor', { tempC: 23.4 }]], [
        ['u.D12', 'lcd.RS'], ['u.D11', 'lcd.E'], ['u.D5', 'lcd.D4'], ['u.D4', 'lcd.D5'], ['u.D3', 'lcd.D6'], ['u.D2', 'lcd.D7'],
        ['lcd.RW', 'u.GND.1'], ['lcd.VSS', 'u.GND.1'], ['lcd.K', 'u.GND.2'], ['lcd.VDD', 'u.5V'], ['lcd.A', 'u.5V'],
        ['tp.1', 'u.GND.2'], ['tp.2', 'u.5V'], ['tp.W', 'lcd.V0'],
        ['rf.1', 'u.5V'], ['rf.2', 'u.A0'], ['th.1', 'u.A0'], ['th.2', 'u.GND.3']], prog('uno-lcd-thermo'));
      const eng = createEngine(buildNetlist(doc, realReg, geo), { mcuFactory: factory });
      eng.advanceTo(1.0);
      const v = eng.frame().parts.lcd.vis || {};
      eng.setParam('th', 'tempC', 30);
      eng.advanceTo(1.6);
      const v2 = eng.frame().parts.lcd.vis || {};
      check('uno-lcd-thermo: LiquidCrystal text on the hd44780 follows the thermistor', v.rows && /^TEMP 23\.[345] C/.test(v.rows[0]) && /^TEMP (29\.\d|30\.[01]) C/.test(v2.rows[0]), `"${v.rows && v.rows[0]}" / "${v.rows && v.rows[1]}" then "${v2.rows && v2.rows[0]}", contrast ${v.contrast != null ? v.contrast.toFixed(2) : '-'}, backlight ${v.backlight != null ? v.backlight.toFixed(2) : '-'}`);
    }
    {
      const doc = mkDoc([['u', 'mcu-uno'], ['p1', 'pot', { pos: 0.25 }], ['r1', 'res', { r: 220 }], ['d1', 'led']], [
        ['p1.1', 'u.GND.1'], ['p1.2', 'u.5V'], ['p1.W', 'u.A0'], ['u.D9', 'r1.1'], ['r1.2', 'd1.A'], ['d1.K', 'u.GND.2']], prog('uno-fade-pot'));
      const eng = createEngine(buildNetlist(doc, realReg, geo), { mcuFactory: factory });
      eng.advanceTo(0.3); eng.frame(); eng.advanceTo(0.5);
      const b1 = eng.frame().parts.d1.vis.b;
      eng.setParam('p1', 'pos', 0.75);
      eng.advanceTo(0.8); eng.frame(); eng.advanceTo(1.0);
      const b2 = eng.frame().parts.d1.vis.b;
      const plot = eng.drainSerial().map(s => s.text).join('').trim().split(/\s+/).slice(-2).join(' ');
      check('uno-fade-pot: analogRead and analogWrite: LED brightness follows the pot', b2 > 2 * b1 && b1 > 0.05, `b at pos 0.25 = ${b1.toFixed(3)}, at 0.75 = ${b2.toFixed(3)}; last serial: ${plot}`);
    }
    {
      const doc = mkDoc([['u', 'mcu-uno'], ['r1', 'res', { r: 100 }], ['bz', 'buzzer-passive']], [['u.D8', 'r1.1'], ['r1.2', 'bz.+'], ['bz.−', 'u.GND.1']], prog('uno-melody'));
      const eng = createEngine(buildNetlist(doc, realReg, geo), { mcuFactory: factory });
      const fs = [];
      for (let k = 1; k <= 30; k++) { eng.advanceTo(k * 0.05); const fv = eng.frame().parts.bz.vis.freq; if (fv) fs.push(Math.round(fv)); }
      const notes = [262, 294, 330, 349, 392, 440, 494, 523];
      const off = fs.filter(f => !notes.some(n => Math.abs(f / n - 1) < 0.01));
      check('uno-melody: tone() notes reach the buzzer, no blended pitches', new Set(fs).size >= 3 && off.length === 0, `frequencies seen: ${[...new Set(fs)].join(', ')} Hz; off-note readings: ${off.length}`);
    }
    {
      const doc = mkDoc([['u', 'mcu-uno'], ['p1', 'pot', { pos: 0.2 }], ['sv', 'servo']], [
        ['p1.1', 'u.GND.1'], ['p1.2', 'u.5V'], ['p1.W', 'u.A0'], ['sv.SIG', 'u.D9'], ['sv.VCC', 'u.5V'], ['sv.GND', 'u.GND.2']], prog('uno-servo'));
      const eng = createEngine(buildNetlist(doc, realReg, geo), { mcuFactory: factory });
      eng.advanceTo(1.0);
      const a1 = eng.frame().parts.sv.vis.angle;
      eng.setParam('p1', 'pos', 0.8);
      eng.advanceTo(2.0);
      const a2 = eng.frame().parts.sv.vis.angle;
      check('uno-servo: the horn angle follows the pot', Math.abs(a1 - 36) < 2 && Math.abs(a2 - 144) < 2, `angle ${a1.toFixed(1)}° at pos 0.2, ${a2.toFixed(1)}° at pos 0.8`);
    }
    {
      const doc = mkDoc([['u', 'mcu-esp32'], ['rr', 'res', { r: 220 }], ['lr', 'led', { color: 'red' }], ['ry', 'res', { r: 220 }], ['ly', 'led', { color: 'yellow' }], ['rg', 'res', { r: 220 }], ['lg', 'led', { color: 'green' }]], [
        ['u.25', 'rr.1'], ['rr.2', 'lr.A'], ['lr.K', 'u.GND.1'], ['u.26', 'ry.1'], ['ry.2', 'ly.A'], ['ly.K', 'u.GND.1'], ['u.27', 'rg.1'], ['rg.2', 'lg.A'], ['lg.K', 'u.GND.2']],
        { u: { lang: 'sketch', source: SKETCHES['esp32-traffic'].source } });
      const eng = createEngine(buildNetlist(doc, realReg, geo), { mcuFactory: factory });
      const seen = new Set();
      let vhi = 0;
      for (let k = 1; k <= 120; k++) {
        eng.advanceTo(k * 0.1);
        const st = ['lr', 'ly', 'lg'].map(id => (eng.i(id + '/main') > 0.002 ? 1 : 0)).join('');
        seen.add(st);
        vhi = Math.max(vhi, eng.v(eng.nl.mcus[0].pins['25']));
      }
      check('esp32-traffic: 3.3 V logic runs the light sequence', seen.size >= 3 && vhi > 3.1 && vhi < 3.4, `LED states seen (r y g): ${[...seen].join(' ')}; GPIO 25 high level ${vhi.toFixed(3)} V`);
    }
  }
}

console.log(`\n${count - fails}/${count} checks passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
