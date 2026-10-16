// THERMAL CONVECTION · tests/sim.test.mjs — package SIM: sim/params.js,
// sim/ref.js (the CPU spec of the solver) and, when present, the WGSL and
// sim/gpu.js. No browser. Run through ../tests.mjs, or alone:
//   node -e "import('./tests/sim.test.mjs').then(m => m.default((n, c, i) => console.log(c ? 'ok  ' : 'FAIL', n, i || '')))"
import { PRESETS, GRIDS, TRACERS, clampParams, planFrame, cflDt, DT_MAX, MAX_FRAME_DT, TIME_RATE, RA_CRIT } from '../sim/params.js';
import { createRefSim, fftLine, radices, initialState, derived, pcg, u01 } from '../sim/ref.js';
import { UNIFORM_FIELDS, SHADER_FILES, COMMON_FILE, LAYOUTS, ENTRIES, radixCode, packUniform, cellGroups, createSim } from '../sim/gpu.js';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const finite = a => { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };

function growth(opts, p, dt, t1) {
  const r = createRefSim(opts, Object.assign({ noise: 1e-3 }, p));
  const n = Math.round(t1 / dt);
  for (let s = 0; s < n; s++) r.step(dt);
  const k1 = r.stats().ke;
  for (let s = 0; s < n; s++) r.step(dt);
  return Math.log(r.stats().ke / k1) / (2 * t1); // growth rate of the amplitude
}

export default async function (ok) {
  // ── params ──
  const d = clampParams({});
  ok('sim params: clampParams({}) gives the contract defaults',
    d.Ra === 1e5 && d.Pr === 1 && d.Ma === 80 && d.mode === 'plate' && d.top === 'free' && d.burner.r === 0.12 && d.Lx === 4);
  const c = clampParams({ Ra: 1e9, Pr: -1, Ma: 999, mode: 'x', top: 'y', speed: NaN, burner: { x: 1.25 } });
  ok('sim params: clampParams clamps and repairs bad values',
    c.Ra === 1e7 && c.Pr === 0.1 && c.Ma === 200 && c.mode === 'plate' && c.top === 'free' && c.speed === 1 && c.burner.x === 0.25, JSON.stringify(c));
  const want = ['granulation', 'soup', 'benard', 'hexagons', 'onset', 'turbulent'];
  ok('sim params: the six contract presets exist with params, palette and view',
    want.every(k => PRESETS[k] && PRESETS[k].params && PRESETS[k].palette && PRESETS[k].view && PRESETS[k].id === k));
  ok('sim params: preset modes match the contract',
    PRESETS.granulation.params.mode === 'sun' && PRESETS.granulation.params.Ra === 1e6 && PRESETS.granulation.palette === 'solar'
    && PRESETS.soup.params.mode === 'burner' && PRESETS.soup.palette === 'broth' && PRESETS.benard.params.Ra === 5e4
    && PRESETS.hexagons.params.mode === 'pan' && PRESETS.hexagons.params.Ma === 120 && PRESETS.onset.params.Ra === 3000
    && PRESETS.onset.fromRest === true && PRESETS.turbulent.params.Ra === 5e6);
  ok('sim params: every preset survives clampParams unchanged',
    want.every(k => Object.entries(PRESETS[k].params).every(([key, v]) => typeof v === 'object' || clampParams(PRESETS[k].params)[key] === v)));
  ok('sim params: GRIDS keep dx = dy = dz and Lx = 4',
    [0, 1, 2].every(q => GRIDS[q][0] / GRIDS[q][2] === 4 && GRIDS[q][1] / GRIDS[q][2] === 4) && GRIDS[2].join() === '128,128,32');
  ok('sim params: default tracer counts (phone 6000, desktop 20000)', TRACERS[0] === 6000 && TRACERS[2] === 20000);
  const pf = planFrame(1 / 60, 1, 0.3, 1 / 32, 3);
  ok('sim params: planFrame covers the frame in CFL-limited substeps',
    pf.n >= 1 && Math.abs(pf.simDt - TIME_RATE / 60) < 1e-12 && pf.dt <= cflDt(0.3, 1 / 32) + 1e-12, JSON.stringify(pf));
  const pc = planFrame(1 / 30, 8, 5, 1 / 32, 3);
  ok('sim params: planFrame caps substeps and loses speed, not stability',
    pc.n === 3 && Math.abs(pc.dt - cflDt(5, 1 / 32)) < 1e-12 && pc.simDt < (8 * TIME_RATE) / 30, JSON.stringify(pc));
  ok('sim params: a long frame is cut to MAX_FRAME_DT; speed 0 pauses',
    Math.abs(planFrame(5, 1, 0, 1 / 32, 8).simDt - MAX_FRAME_DT * TIME_RATE) < 1e-9 && planFrame(1 / 60, 0, 0, 1 / 32, 3).n === 0
    && cflDt(0, 1) === DT_MAX);

  // ── FFT ──
  let fftErr = 0;
  for (const N of [16, 24, 48, 64, 96, 128]) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) { re[i] = Math.sin(1.7 * i * i + 0.3); im[i] = Math.cos(0.9 * i); }
    const [or, oi] = fftLine(re.slice(), im.slice(), new Float64Array(N), new Float64Array(N), N, radices(N));
    for (let m = 0; m < N; m++) {
      let a = 0, b = 0;
      for (let i = 0; i < N; i++) { const t = (-2 * Math.PI * m * i) / N; a += re[i] * Math.cos(t) - im[i] * Math.sin(t); b += re[i] * Math.sin(t) + im[i] * Math.cos(t); }
      fftErr = Math.max(fftErr, Math.hypot(a - or[m], b - oi[m]));
    }
  }
  ok('sim ref: mixed-radix Stockham FFT equals the DFT (N = 16, 24, 48, 64, 96, 128)', fftErr < 1e-9, fftErr.toExponential(2));
  let threw = false; try { radices(20); } catch { threw = true; }
  ok('sim ref: radices() refuses sizes with a factor 5', threw);

  // ── conduction states are exact steady states ──
  for (const [mode, top] of [['plate', 'rigid'], ['plate', 'free'], ['sun', 'free'], ['pan', 'free'], ['burner', 'free']]) {
    const r = createRefSim({ nx: 16, ny: 16, nz: 8, seed: 1 }, { Ra: 1e4, mode, top, noise: 0 });
    for (let s = 0; s < 10; s++) r.step(0.1);
    const st = r.stats();
    if (mode === 'burner') { // Tb (1 - z) is not the 3D conduction state, but its wall flux is mean(Tb)
      const nu0 = createRefSim({ nx: 16, ny: 16, nz: 8, seed: 1 }, { mode, noise: 0 }).stats().Nu;
      ok('sim ref: burner start state has Nu = 1 (flux reference = mean Tb)', Math.abs(nu0 - 1) < 1e-4, nu0.toFixed(5));
      continue;
    }
    ok(`sim ref: ${mode} / ${top} conduction state stays at rest with Nu = 1`,
      st.ke < 1e-20 && Math.abs(st.Nu - 1) < 1e-4, `ke ${st.ke.toExponential(1)} Nu ${st.Nu.toFixed(5)}`);
  }

  // ── onset ──
  const g16 = { nx: 16, ny: 16, nz: 8, seed: 1 };
  {
    const r = createRefSim(g16, { Ra: 1000, mode: 'plate', top: 'rigid', noise: 1e-2 });
    for (let s = 0; s < 50; s++) r.step(0.1);
    const k1 = r.stats().ke;
    for (let s = 0; s < 300; s++) r.step(0.1);
    const st = r.stats();
    ok('sim ref: Ra 1000 rigid-rigid decays back to conduction', st.ke < k1 * 1e-3 && Math.abs(st.Nu - 1) < 1e-3, `ke ${k1.toExponential(1)} -> ${st.ke.toExponential(1)}`);
  }
  {
    const r = createRefSim(g16, { Ra: 5000, mode: 'plate', top: 'rigid', noise: 1e-3 });
    const k0 = (() => { r.step(0.1); return r.stats().ke; })();
    for (let s = 0; s < 250; s++) r.step(0.1);
    const st = r.stats();
    ok('sim ref: Ra 5000 rigid-rigid perturbation grows', st.ke > k0 * 1e3, `ke ${k0.toExponential(1)} -> ${st.ke.toExponential(1)}`);
  }
  const g2 = { nx: 32, ny: 4, nz: 16, seed: 2 }; // Lx = 2: k = pi, near the critical wave number
  const r1500 = growth(g2, { Ra: 1500, top: 'rigid' }, 0.05, 15), r1900 = growth(g2, { Ra: 1900, top: 'rigid' }, 0.05, 15);
  ok(`sim ref: rigid-rigid onset is bracketed near ${RA_CRIT.rigid} (Ra 1500 decays, 1900 grows)`, r1500 < 0 && r1900 > 0,
    `rates ${r1500.toFixed(4)}, ${r1900.toFixed(4)} per tff`);
  const f950 = growth(g2, { Ra: 950, top: 'free' }, 0.05, 15), f1300 = growth(g2, { Ra: 1300, top: 'free' }, 0.05, 15);
  ok(`sim ref: rigid-free onset is bracketed near ${RA_CRIT.free} (Ra 950 decays, 1300 grows)`, f950 < 0 && f1300 > 0,
    `rates ${f950.toFixed(4)}, ${f1300.toFixed(4)} per tff`);

  // ── developed flow: Nu, divergence ──
  {
    const r = createRefSim(g16, { Ra: 1e4, mode: 'plate', top: 'free' });
    let divWorst = 0;
    for (let s = 0; s < 600; s++) { r.step(0.1); if (s % 25 === 0) divWorst = Math.max(divWorst, r.stats().divMax * r.dims.dx); }
    const st = r.stats();
    divWorst = Math.max(divWorst, st.divMax * r.dims.dx);
    ok('sim ref: projection meets max |div u| dx < 1e-3 at 16 x 16 x 8 (every 25 steps of a developing run)', divWorst < 1e-3, divWorst.toExponential(2));
    ok('sim ref: Nu > 1 after developing at Ra 1e4', st.Nu > 1.5, `Nu ${st.Nu.toFixed(3)} at t ${st.simTime.toFixed(0)}`);
    ok('sim ref: developed Ra 1e4 flow has |u| of order 0.1 to 1 (free-fall units)', st.vmax > 0.05 && st.vmax < 1.5, st.vmax.toFixed(3));
  }

  // ── burner ──
  {
    const r = createRefSim({ nx: 24, ny: 24, nz: 8, seed: 5 }, { Ra: 1e5, Pr: 7, mode: 'burner', top: 'free' });
    for (let s = 0; s < 500; s++) r.step(0.1);
    const st = r.stats(), D = r.derived, nx = 24, nxy = 576, k = 4;
    let wIn = 0, nIn = 0, wOut = 0, nOut = 0;
    for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) / 8, y = (j + 0.5) / 8, rho = Math.hypot(x - D.bx, y - D.by);
      const w = r.vel[4 * (i + nx * j + nxy * k) + 2];
      if (rho < D.br) { wIn += w; nIn++; } else if (rho > 2 * D.br) { wOut += w; nOut++; }
    }
    wIn /= nIn; wOut /= nOut;
    const off = Math.hypot(st.plume[0] - D.bx, st.plume[1] - D.by);
    ok('sim ref: burner mode makes a central upflow over the hot patch', wIn > 0.05 && wIn > 5 * Math.abs(wOut),
      `mean w inside ${wIn.toFixed(3)}, outside ${wOut.toFixed(4)}`);
    ok('sim ref: burner plume (strongest mid-height upflow) sits over the burner', off < D.br * 1.5, `plume off by ${off.toFixed(2)}`);
  }

  // ── pan (Bénard–Marangoni) ──
  {
    const p = { Ra: 300, Pr: 7, mode: 'pan', noise: 1e-2 };
    const a = createRefSim(g16, Object.assign({ Ma: 0 }, p)), b = createRefSim(g16, Object.assign({ Ma: 150 }, p));
    for (let s = 0; s < 20; s++) { a.step(0.1); b.step(0.1); }
    const a0 = a.stats().ke, b0 = b.stats().ke;
    for (let s = 0; s < 480; s++) { a.step(0.1); b.step(0.1); }
    const sa = a.stats(), sb = b.stats();
    ok('sim ref: pan mode at Ra 300 with Ma 0 stays at rest (buoyancy alone is subcritical)', sa.ke < a0 * 1e-3, `ke ${a0.toExponential(1)} -> ${sa.ke.toExponential(1)}`);
    ok('sim ref: pan mode at Ra 300 with Ma 150 makes cells (surface tension drives them)', sb.ke > b0 * 1e3 && sb.Nu > 1.05,
      `ke ${b0.toExponential(1)} -> ${sb.ke.toExponential(1)}, Nu ${sb.Nu.toFixed(3)}`);
  }

  // ── periodic wrap: the scheme commutes with a periodic shift ──
  {
    const nx = 16, ny = 16, nz = 8, n = nx * ny * nz, si = 5, sj = 3;
    const p = { Ra: 2e4, mode: 'plate', top: 'free', noise: 0.05 };
    const a = createRefSim({ nx, ny, nz, seed: 7 }, p), b = createRefSim({ nx, ny, nz, seed: 99 }, p);
    const shift = A => { const o = new Float32Array(n); for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) o[(i + si) % nx + nx * ((j + sj) % ny + ny * k)] = A[i + nx * (j + ny * k)]; return o; };
    for (let s = 0; s < 60; s++) a.step(0.1);  // a developed, moving state
    b.load({ U: shift(a.U), V: shift(a.V), W: shift(a.W), T: shift(a.T) });
    a.load({});                                 // same (cleared) pressure history in both
    for (let s = 0; s < 40; s++) { a.step(0.1); b.step(0.1); }
    const sa = shift(a.T), sw = shift(a.W);
    let e = 0; for (let c2 = 0; c2 < n; c2++) e = Math.max(e, Math.abs(sa[c2] - b.T[c2]), Math.abs(sw[c2] - b.W[c2]));
    ok('sim ref: periodic wrap in x and y (a shifted state stays the shifted solution)', e < 1e-4 && a.stats().vmax > 0.01, `max diff ${e.toExponential(2)}`);
  }

  // ── determinism ──
  {
    const p = { Ra: 1e4, mode: 'plate' };
    const a = createRefSim({ nx: 16, ny: 16, nz: 8, seed: 42 }, p), b = createRefSim({ nx: 16, ny: 16, nz: 8, seed: 42 }, p), c3 = createRefSim({ nx: 16, ny: 16, nz: 8, seed: 43 }, p);
    a.setTracers(64); b.setTracers(64);
    for (let s = 0; s < 30; s++) { a.step(0.1); b.step(0.1); c3.step(0.1); }
    let same = true; for (let i = 0; i < a.T.length; i++) if (a.T[i] !== b.T[i] || a.U[i] !== b.U[i]) { same = false; break; }
    for (let i = 0; i < a.tracers.length; i++) if (a.tracers[i] !== b.tracers[i]) same = false;
    let diff = false; for (let i = 0; i < a.T.length; i++) if (a.T[i] !== c3.T[i]) { diff = true; break; }
    ok('sim ref: same seed gives bit-identical fields and tracers; another seed differs', same && diff);
    const s1 = initialState({ nx: 16, ny: 16, nz: 8 }, p, 42).T;
    ok('sim ref: initialState(seed) is the ref start state (gpu.js uploads it)', s1.every((v, i) => v === createRefSim({ nx: 16, ny: 16, nz: 8, seed: 42 }, p).T[i]));
  }

  // ── long run at Ra 1e7 with the CFL plan ──
  {
    const r = createRefSim(g16, { Ra: 1e7, mode: 'plate', top: 'rigid' });
    let subs = 0, vmaxHi = 0, ok1 = true;
    for (let f = 0; f < 2400; f++) {
      subs += r.frame(1 / 30, 3).n;
      if (f % 100 === 0) { const st = r.stats(); vmaxHi = Math.max(vmaxHi, st.vmax); if (!Number.isFinite(st.ke)) ok1 = false; }
    }
    const st = r.stats();
    ok('sim ref: no NaN over a long run at Ra 1e7 with the CFL cap', ok1 && finite(r.T) && finite(r.vel) && st.vmax < 3,
      `t ${st.simTime.toFixed(0)} tff, ${subs} substeps, vmax <= ${vmaxHi.toFixed(2)}, Nu ${st.Nu.toFixed(1)}`);
  }

  // ── tracers ──
  {
    const r = createRefSim(g16, { Ra: 1e4, mode: 'plate' });
    r.setTracers(500);
    for (let s = 0; s < 300; s++) r.step(0.2);
    const t = r.tracers; let inside = true, young = 0;
    for (let i = 0; i < 500; i++) {
      const x = t[4 * i], y = t[4 * i + 1], z = t[4 * i + 2], age = t[4 * i + 3];
      if (!(x >= 0 && x < 2 && y >= 0 && y < 2 && z >= 0 && z <= 1 && age >= 0)) inside = false;
      if (age < 20) young++;
    }
    ok('sim ref: tracers stay in the box and respawn after their life', inside && young > 50 && r.tracerCount === 500, `${young} younger than 20 tff`);
  }

  // ── sun mode coefficients ──
  {
    const D = derived({ mode: 'sun' }, { nx: 128, ny: 128, nz: 32 });
    ok('sim ref: sun mode heats an 8-layer bottom zone over an insulating wall, Robin top', D.botNeumann && D.nHeat === 8 && D.tRobin && D.rTop < 1 && D.Tcond[0] > D.Tcond[31]);
  }

  await gpuTests(ok);
}

// ───────────────────────── WGSL and gpu.js ─────────────────────────
const page = new URL('../', import.meta.url);
const readPage = p => readFileSync(new URL(p, page), 'utf8');
const stripComments = t => t.replace(/\/\/[^\n]*/g, '');

// WGSL operator-mix check (Chrome's Tint is stricter than naga): an operand
// of & | ^ << >> must be a unary expression, and && may not meet || without
// parentheses. Template brackets are removed first.
export function tintTraps(src) {
  const out = [];
  const lines = stripComments(src).split('\n');
  lines.forEach((line0, ln) => {
    let line = line0;
    for (let it = 0; it < 4; it++) line = line.replace(/\b(array|vec[234]|mat[234]x[234]|ptr|atomic|var|bitcast|texture_[a-z_0-9]+)<[^<>]*>/g, '$1');
    const toks = line.match(/<<=|>>=|<<|>>|&&|\|\||==|!=|<=|>=|->|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|\+\+|--|[A-Za-z_][A-Za-z0-9_]*|[0-9][0-9a-zA-Z_.]*|\S/g) || [];
    const stack = [new Set()];
    let prevOperand = false;
    const check = set => {
      const ops = [...set];
      const bit = ops.filter(o => o === '&' || o === '|' || o === '^');
      const sh = ops.filter(o => o === '<<' || o === '>>');
      if (bit.length && ops.some(o => o !== bit[0])) out.push(`${ln + 1}: mixed ${ops.join(' ')}`);
      if (sh.length && ops.some(o => ['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>'].includes(o) && o !== sh[0])) out.push(`${ln + 1}: shift mixed ${ops.join(' ')}`);
      if (set.has('&&') && set.has('||')) out.push(`${ln + 1}: && with ||`);
    };
    for (const t of toks) {
      if (t === '(' || t === '[') { stack.push(new Set()); prevOperand = false; continue; }
      if (t === ')' || t === ']') { check(stack.pop()); prevOperand = true; continue; }
      if ([',', ';', '{', '}', '=', '->', ':', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(t)) {
        check(stack[stack.length - 1]); stack[stack.length - 1] = new Set(); prevOperand = false; continue;
      }
      if (/^[A-Za-z_0-9]/.test(t)) { prevOperand = !['return', 'let', 'var', 'if', 'else', 'for', 'while', 'loop', 'const'].includes(t); continue; }
      if (['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '&&', '||', '<', '>', '<=', '>=', '==', '!='].includes(t)) {
        if (prevOperand) {
          const set = stack[stack.length - 1];
          if ((t === '<<' || t === '>>') && (set.has('<<') || set.has('>>'))) out.push(`${ln + 1}: chained shift`);
          set.add(t);
        }
        prevOperand = false; continue;
      }
      prevOperand = false;
    }
    while (stack.length) check(stack.pop());
  });
  return out;
}

const RESERVED = ('NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become cast catch class co_await co_return co_yield coherent column_major common compile compile_fragment concept const_cast consteval constexpr constinit crate debugger decltype delete demote demote_to_helper do dynamic_cast enum explicit export extends extern external fallthrough filter final finally friend from fxgroup get goto groupshared highp impl implements import inline instanceof interface layout lowp macro macro_rules match mediump meta mod module move mut mutable namespace new nil noexcept noinline nointerpolation noperspective null nullptr of operator package packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public readonly ref regardless register reinterpret_cast require resource restrict self set shared sizeof smooth snorm static static_assert static_cast std subroutine super target template this thread_local throw trait try type typedef typeid typename typeof union unless unorm unsafe unsized use using varying virtual volatile wgsl where with writeonly yield').split(' ');

function fakeDevice(log) {
  const mkBuf = d => ({
    size: d.size, usage: d.usage, label: d.label, state: 'unmapped', content: new Float32Array(Math.ceil(d.size / 4)),
    destroy() { this.destroyed = true; },
    mapAsync() { log.maps.push({ label: this.label, frame: log.frame }); this.state = 'mapped'; return Promise.resolve(); },
    getMappedRange() { return this.content.buffer; },
    unmap() { this.state = 'unmapped'; },
  });
  return {
    createBuffer(d) { const b = mkBuf(d); log.buffers.push(b); return b; },
    createShaderModule(d) { log.modules.push(d.code); return { code: d.code, getCompilationInfo: async () => ({ messages: [] }) }; },
    createBindGroupLayout(d) { return { entries: d.entries }; },
    createPipelineLayout(d) { return d; },
    createBindGroup(d) {
      const a = d.entries.map(e => e.binding).join(), b = d.layout.entries.map(e => e.binding).join();
      if (a !== b || d.entries.some(e => !e.resource.buffer)) log.errors.push(`bind group ${d.label}: ${a} vs ${b}`);
      for (const e of d.entries) {
        const want = d.layout.entries.find(x => x.binding === e.binding).buffer.type === 'uniform' ? 0x40 : 0x80;
        if (!(e.resource.buffer.usage & want)) log.errors.push(`binding ${e.binding} usage`);
      }
      return d;
    },
    async createComputePipelineAsync(d) {
      if (!new RegExp(`@compute[^\\n]*\\n\\s*fn ${d.compute.entryPoint}\\(`).test(d.compute.module.code)) log.errors.push(`no entry ${d.compute.entryPoint}`);
      return { entry: d.compute.entryPoint };
    },
    createCommandEncoder() {
      return {
        beginComputePass() {
          let cur = null;
          return { setPipeline(p) { cur = p; }, setBindGroup() {}, dispatchWorkgroups(x, y = 1) { if (x > 65535 || y > 65535) log.errors.push('dispatch > 65535'); log.dispatch.push(cur.entry); }, end() {} };
        },
        copyBufferToBuffer(src, _so, dst, _dof, size) {
          if (dst.state !== 'unmapped') log.errors.push('copy into a mapped buffer');
          dst.content.set(src.content.subarray(0, size / 4)); log.copies.push({ frame: log.frame, label: dst.label });
        },
        clearBuffer(b) { b.content.fill(0); },
        finish() { return {}; },
      };
    },
    queue: { writeBuffer() { log.writes++; }, submit() { log.submits++; } },
  };
}

async function gpuTests(ok) {
  // ── WGSL: naga, Tint traps, reserved words, layouts ──
  const common = readPage(`shaders/${COMMON_FILE}`);
  const naga = join(homedir(), '.cargo/bin/naga');
  const tmp = mkdtempSync(join(tmpdir(), 'tc-sim-'));
  const files = [COMMON_FILE, ...Object.values(SHADER_FILES)];
  ok('sim wgsl: every sim shader file exists', files.every(f => existsSync(new URL(`shaders/${f}`, page))));
  const composed = {};
  for (const [mod, file] of Object.entries(SHADER_FILES)) composed[mod] = common + '\n' + readPage(`shaders/${file}`);
  if (existsSync(naga)) {
    for (const [name, code] of [['common', common], ...Object.entries(composed)]) {
      const f = join(tmp, `${name}.wgsl`);
      writeFileSync(f, code);
      let msg = '';
      try { msg = execFileSync(naga, [f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { msg = 'ERROR ' + (e.stderr || e.message); }
      ok(`sim wgsl: naga validates ${name === 'common' ? COMMON_FILE : 'common + ' + SHADER_FILES[name]}`, /Validation successful/.test(msg), msg.trim().split('\n').slice(-3).join(' | '));
    }
  } else ok('sim wgsl: ~/.cargo/bin/naga is present', false, 'naga missing: WGSL not validated');
  for (const f of files) {
    const traps = tintTraps(readPage(`shaders/${f}`));
    ok(`sim wgsl: no Tint operator-mix traps in ${f}`, traps.length === 0, traps.slice(0, 4).join('; '));
    const ids = new Set(stripComments(readPage(`shaders/${f}`)).match(/[A-Za-z_][A-Za-z0-9_]*/g));
    const bad = RESERVED.filter(w => ids.has(w));
    ok(`sim wgsl: no WGSL reserved words as names in ${f}`, bad.length === 0, bad.join(' '));
  }
  ok('sim wgsl: tintTraps catches a ^ b * c, a << b + c and a && b || c',
    tintTraps('let x = a ^ b * c;').length > 0 && tintTraps('let x = a << b + c;').length > 0 && tintTraps('if (a && b || c) {}').length > 0
    && tintTraps('let x = (a ^ b) * c; let y = (s >> ((s >> 28u) + 4u)) ^ s;').length === 0);
  // struct Prm order
  const body = common.match(/struct Prm \{([^}]*)\}/)[1];
  const fields = [...body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(u32|f32)/g)].map(m => [m[1], m[2] === 'u32' ? 'u' : 'f']);
  ok('sim wgsl: struct Prm matches gpu.js UNIFORM_FIELDS (names, types, order)', JSON.stringify(fields) === JSON.stringify(UNIFORM_FIELDS), `${fields.length} vs ${UNIFORM_FIELDS.length}`);
  ok('sim wgsl: the uniform is 144 bytes (a multiple of 16)', UNIFORM_FIELDS.length * 4 === 144);
  for (const [mod, code] of Object.entries(composed)) {
    const own = stripComments(readPage(`shaders/${SHADER_FILES[mod]}`));
    const declared = new Map([...stripComments(code).matchAll(/@binding\((\d+)\)\s*var<(uniform|storage)/g)].map(m => [+m[1], m[2]]));
    const need = [0, ...[...own.matchAll(/@binding\((\d+)\)/g)].map(m => +m[1])];
    if (/velAt\(|vel\[/.test(own)) need.push(5);
    const lay = LAYOUTS[mod];
    ok(`sim wgsl: ${mod} layout = the bindings it uses, all declared`,
      need.every(b => lay.includes(b)) && lay.every(b => need.includes(b) && declared.has(b)), `layout ${lay.join(',')} needs ${need.join(',')}`);
    const storage = lay.filter(b => b !== 0).length;
    ok(`sim wgsl: ${mod} uses <= 8 storage buffers and binding 0 is the uniform`, storage <= 8 && declared.get(0) === 'uniform', `${storage} storage`);
    const wg = [...stripComments(code).matchAll(/@workgroup_size\((\d+)\)/g)].map(m => +m[1]);
    ok(`sim wgsl: ${mod} workgroup sizes <= 256`, wg.length > 0 && wg.every(v => v <= 256), wg.join(','));
    let wgBytes = 0;
    for (const m of stripComments(code).matchAll(/var<workgroup>\s*\w+\s*:\s*([^;]+);/g)) {
      const t = m[1].replace(/\s/g, '');
      const a2 = t.match(/^array<array<f32,(\d+)>,(\d+)>$/), v2 = t.match(/^array<vec2f,(\d+)>$/);
      if (a2) wgBytes += 4 * a2[1] * a2[2]; else if (v2) wgBytes += 8 * v2[1]; else wgBytes += 1e9;
    }
    ok(`sim wgsl: ${mod} workgroup memory <= 16 KB`, wgBytes <= 16384, `${wgBytes} B`);
    ok(`sim wgsl: ${mod} has its entry points and no vertex stage`,
      ENTRIES[mod].every(e => new RegExp(`@compute[^\\n]*\\n\\s*fn ${e}\\(`).test(code)) && !/@vertex/.test(code));
  }
  ok('sim wgsl: WGSL pcg / u01 match ref.js (spot values)', pcg(0) === 129708002 && u01(0xffffffff) < 1, `${pcg(0)} ${pcg(1)}`);

  // ── gpu.js pure helpers ──
  const r128 = radixCode(128), r96 = radixCode(96);
  ok('sim gpu: radixCode packs the stages 4 bits each (128 = 4.4.4.2, 96 = 4.4.2.3)', r128.stages === 4 && r128.code === 0x2444 && r96.code === 0x3244);
  const D = derived({ mode: 'pan', Ra: 300, Pr: 7, Ma: 120 }, { nx: 128, ny: 128, nz: 32 });
  const ub = packUniform(D, { nx: 128, ny: 128, nz: 32 }, { dt: 0.05, frame: 7, seed: 3, tracerCount: 100 });
  const u = new Uint32Array(ub), f = new Float32Array(ub), at = name => UNIFORM_FIELDS.findIndex(x => x[0] === name);
  ok('sim gpu: packUniform writes the derived values at the struct offsets',
    ub.byteLength === 144 && u[at('nh')] === 65 && u[at('specN')] === 65 * 128 * 32 && Math.abs(f[at('dt')] - 0.05) < 1e-7
    && u[at('mode')] === 3 && u[at('topFree')] === 1 && Math.abs(f[at('maEff')] - 120 / Math.sqrt(2100)) < 1e-5 && u[at('kMid')] === 16 && u[at('frame')] === 7);
  ok('sim gpu: cellGroups keeps each dispatch dimension <= 65535', cellGroups(524288).join() === '8192,1' && cellGroups(4 * 65536 * 64).every(v => v <= 65535));

  // ── createSim on a fake device: buffers, bind groups, dispatch order, stats readback ──
  const log = { buffers: [], modules: [], errors: [], dispatch: [], copies: [], maps: [], writes: 0, submits: 0, frame: 0 };
  const loadText = async url => readFileSync(new URL(url), 'utf8');
  const sim = await createSim(fakeDevice(log), { quality: 2, seed: 4, loadText });
  const big = Math.max(...log.buffers.map(b => b.size));
  ok('sim gpu: createSim builds 4 modules (common + file) and every bind group matches its layout',
    log.modules.length === 4 && log.modules.every(c => c.startsWith(common)) && log.errors.length === 0, log.errors.join('; '));
  ok('sim gpu: desktop dims and buffer sizes (largest < 128 MB, T f32 x n, vel vec4 x n)',
    sim.dims.nx === 128 && sim.dims.nz === 32 && sim.dims.Lx === 4 && sim.dims.dx === 1 / 32 && big < 128 * 2 ** 20
    && sim.buffers.T.size === 4 * 524288 && sim.buffers.vel.size === 16 * 524288 && sim.buffers.tracers.size >= 16 * 20000 && sim.tracerCount === 20000,
    `largest ${(big / 2 ** 20).toFixed(1)} MB`);
  ok('sim gpu: reset submits the start state and one vel pass', log.submits === 1 && log.dispatch.join() === 'velPass');
  sim.set({ Ra: 1e5, mode: 'plate' });
  const stOut = log.buffers.find(b => b.label === 'tc-stats');
  const nxy = 128 * 128, n = nxy * 32;
  // a crafted stats record: Nu 3, vmax 0.5, Tmean 0.5, ke 0.01, hot at column 130 (i 2, j 1)
  stOut.content.set([2 * 0.01 * n, 0.5 * n, 3 * nxy, 0.25, 0.9, 130, 0.1, 5, 0.3, 129, 0, 0.6 * nxy]);
  log.dispatch.length = 0; log.frame = 1;
  const enc = () => fakeDevice(log).createCommandEncoder();
  const plan1 = sim.step(enc(), 1 / 60);
  const perSub = ['advA', 'advB', 'fwdX', 'fwdY', 'tri', 'invY', 'invX', 'tracerStep', 'velPass'];
  ok('sim gpu: step encodes the substeps in ref.js order, then the stats pair',
    plan1.n >= 1 && log.dispatch.join() === [...Array(plan1.n)].flatMap(() => perSub).concat(['statsA', 'statsB']).join(), log.dispatch.join(' '));
  ok('sim gpu: the stats copy lands in a readback buffer, which is not mapped in the same frame',
    log.copies.length === 1 && log.maps.length === 0);
  log.frame = 2; log.dispatch.length = 0;
  sim.step(enc(), 1 / 60);
  await new Promise(r => setTimeout(r, 0));
  const s2 = sim.stats();
  ok('sim gpu: the next step maps the copy (mapAsync) and stats() parses it',
    log.maps.length === 1 && log.maps[0].frame === 2 && Math.abs(s2.Nu - 3) < 1e-6 && Math.abs(s2.vmax - 0.5) < 1e-6 && Math.abs(s2.Tmean - 0.5) < 1e-6
    && Math.abs(s2.hot[0] - 2.5 / 32) < 1e-9 && Math.abs(s2.hot[1] - 1.5 / 32) < 1e-9 && Math.abs(s2.Ttop[2] - 0.6) < 1e-6 && Math.abs(s2.ke - 0.01) < 1e-6,
    JSON.stringify(s2));
  ok('sim gpu: no stats pass within 250 ms of the last one (at most 4 Hz)', !log.dispatch.includes('statsA'));
  log.dispatch.length = 0;
  const plan3 = sim.step(enc(), 1 / 60);
  ok('sim gpu: the CFL plan uses the read vmax (x 1.2): dt <= 0.7 dx / 0.6', plan3.dt <= (0.7 / 32) / 0.6 + 1e-12 && plan3.n >= 1, JSON.stringify(plan3));
  sim.set({ speed: 0 }); log.dispatch.length = 0;
  sim.step(enc(), 1 / 60);
  ok('sim gpu: speed 0 encodes no substeps', !log.dispatch.includes('advA'));
  stOut.content[0] = NaN; sim.set({ speed: 1 });
  await new Promise(r => setTimeout(r, 300));
  const subs0 = log.submits;
  sim.step(enc(), 1 / 60); sim.step(enc(), 1 / 60);
  await new Promise(r => setTimeout(r, 0));
  ok('sim gpu: a NaN in the stats resets the field (counted in nanResets)', sim.stats().nanResets === 1 && log.submits > subs0 && sim.time < 0.2, `resets ${sim.stats().nanResets}`);
  sim.setTracers(1e9);
  ok('sim gpu: setTracers clamps to the buffer capacity', sim.tracerCount === sim.tracerCapacity);
  sim.destroy();
  ok('sim gpu: destroy releases every buffer that is not mid-map', log.buffers.filter(b => !/readback/.test(b.label)).every(b => b.destroyed));
}
