// ============================================================================
//  FIRE SIMULATION TESTS  ·  node stella-nova/pages/fire-simulation/tests.mjs
// ----------------------------------------------------------------------------
//  No browser. The CPU model (solver.js) is the reference of the GPU passes;
//  a Deno WebGPU run checked the GPU against it (not in this suite). upstream.js (the
//  v1 solver) is the "before" for cost and turbulence.
//    plume, burners      heat rises; every burner kind lights cells
//    projection          divergence after the multigrid solve, per V-cycle
//    turbulence          small-scale kinetic energy, v1 vs now (stated factor)
//    core and flicker    the core at the fuel is steady; the top flickers
//                        slowly (spectrum peak 1..5 Hz, little power > 5 Hz)
//    Turbulence control  higher value -> more small-scale energy
//    cost per step       v1 at its default size vs now at its default size
//    plan, uniforms      the GPU pass list reads only written textures; the
//                        step uniform order matches wgsl.js
//    shaders             naga (WGSL) and glslangValidator (GLSL ES 3.00), and
//                        no mixed && || or bitwise/arithmetic at one depth
//    governor            drops under load, climbs back; 30 / 120 Hz screens
//    random scenes, determinism, hash, guard, palette, render, saver, page
//    dom                 tests-dom.mjs in jsdom, desktop and phone (needs
//                        NODE_PATH or JSDOM_DIR with jsdom 24)
//  FIRE_FULL=1: 200 random seeds (default 30).
// ============================================================================
import * as SV from './solver.js';
import * as V1 from './upstream.js';
import * as SC from './scene.js';
import { draw, fitView, rampLut } from './render.js';
import * as PL from './palette.js';
import { makePlan, packStep, STEP_FLOATS } from './gpu.js';
import { STEP_FIELDS, WGSL } from './wgsl.js';
import { GLSL } from './glsl.js';
import { createGovernor, CELLS } from './governor.js';
import * as K from '../../widgets/sim-kit/core.js';
import { installDom, fakeCtx, makeCanvas } from '../../widgets/sim-kit/test/stubs.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const SCHEMA = SC.makeSchema(false);
const sceneOf = (seed, over = {}) => Object.assign(K.randomize(SCHEMA, seed, K.defaults(SCHEMA), { guard: SC.guard }).state, over);
const lcg = s => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
function run(st, seed, frames, cellsCap = 30000) {
  const S = SV.createSim(); SC.applyParams(S, st);
  SV.buildScene(S, SC.sceneConfig(Object.assign({}, st, { cells: Math.min(st.cells, cellsCap) }), SC.sceneRng(seed)), SC.sceneRng(seed + 1));
  for (let f = 0; f < frames; f++) SV.step(S);
  return S;
}
// probes in metres, the same for v1 (upstream.js) and the new grid
function probe(S, v1) {
  const f = S.f;
  if (v1) return { T: (x, y) => f.sampleField(x, y, 2), U: (x, y) => f.sampleField(x, y, 0), V: (x, y) => f.sampleField(x, y, 1), W: S.W, H: S.H };
  const s = (F, x, y, ox, oy) => { const gx = Math.min(Math.max(x / f.h - ox, 0), f.NX - 1.001), gy = Math.min(Math.max(y / f.h - oy, 0), f.NY - 1.001), i = Math.floor(gx), j = Math.floor(gy), tx = gx - i, ty = gy - j, k = j * f.NX + i; return (1 - tx) * (1 - ty) * F[k] + tx * (1 - ty) * F[k + 1] + (1 - tx) * ty * F[k + f.NX] + tx * ty * F[k + f.NX + 1]; };
  return { T: (x, y) => s(f.t, x, y, 0.5, 0.5), U: (x, y) => s(f.u, x, y, 0, 0.5), V: (x, y) => s(f.v, x, y, 0.5, 0), W: S.W, H: S.H };
}
// small-scale kinetic energy fraction in the plume (T > 0.05) on a 5 mm
// lattice: |u - box5(u)|^2 / |u|^2; and the mean |curl|
function turbOf(P) {
  const d = 0.005, nx = Math.floor(P.W / d) - 2, ny = Math.floor(P.H / d) - 2, u = new Float64Array(nx * ny), v = new Float64Array(nx * ny), t = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const x = (i + 1) * d, y = (j + 1) * d, k = j * nx + i; u[k] = P.U(x, y); v[k] = P.V(x, y); t[k] = P.T(x, y); }
  let ke = 0, kes = 0, cs = 0, cn = 0;
  for (let j = 2; j < ny - 2; j++) for (let i = 2; i < nx - 2; i++) {
    const k = j * nx + i; if (!(t[k] > 0.05)) continue;
    cs += Math.abs((v[k + 1] - v[k - 1] - u[k + nx] + u[k - nx]) / (2 * d)); cn++;
    let mu = 0, mv = 0; for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) { mu += u[k + b * nx + a]; mv += v[k + b * nx + a]; }
    mu /= 25; mv /= 25; ke += u[k] ** 2 + v[k] ** 2; kes += (u[k] - mu) ** 2 + (v[k] - mv) ** 2;
  }
  return { small: kes / Math.max(1e-12, ke), curl: cs / Math.max(1, cn) };
}
const boxT = (P, x0, x1, y0, y1) => { let s = 0, n = 0; for (let y = y0; y <= y1; y += 0.005) for (let x = x0; x <= x1; x += 0.005) { s += P.T(x, y); n++; } return s / n; };
const mean = a => a.reduce((p, c) => p + c, 0) / a.length;
const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
function spectrum(x, fs = 60) {
  const n = x.length, m = mean(x), P = [];
  for (let f = 0.25; f <= 30; f += 0.25) { let re = 0, im = 0; for (let k = 0; k < n; k++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * k / (n - 1)), a = 2 * Math.PI * f * k / fs; re += (x[k] - m) * w * Math.cos(a); im += (x[k] - m) * w * Math.sin(a); } P.push([f, re * re + im * im]); }
  const tot = P.reduce((a, p) => a + p[1], 0), hi = P.filter(p => p[0] >= 5).reduce((a, p) => a + p[1], 0);
  let best = P[0]; for (const p of P) if (p[1] > best[1]) best = p;
  return { peak: best[0], hi: hi / Math.max(1e-30, tot) };
}
// one ring at the default settings of each model; series of the core box
// (just above the ring) and the top box (0.4 .. 0.5 m above it)
function ringRun(M, v1, cells, over = {}, steps = 480) {
  const S = M.createSim(); Object.assign(S.cfg, over);
  M.buildScene(S, { cells, aspect: 1.6, burners: [{ kind: 'ring', fx: 0.5, fy: 0.3, r: 0.13 }] }, lcg(11));
  const P = probe(S, v1), b = S.cfg.burners[0], near = [], top = [], tb = [];
  for (let k = 0; k < 240; k++) M.step(S);
  for (let k = 0; k < steps; k++) {
    M.step(S);
    near.push(boxT(P, b.x - 0.04, b.x + 0.04, b.y + 0.02, b.y + 0.12)); top.push(boxT(P, b.x - 0.08, b.x + 0.08, b.y + 0.40, b.y + 0.50));
    if (k % 60 === 59) tb.push(turbOf(P));
  }
  return { S, near, top, small: mean(tb.map(x => x.small)), curl: mean(tb.map(x => x.curl)) };
}

// ---- plume and burners ------------------------------------------------------
function heatCentroid(S) { const f = S.f; let w = 0, y = 0; for (let j = 0; j < f.NY; j++) for (let i = 0; i < f.NX; i++) { const t = f.t[j * f.NX + i]; w += t; y += t * (j + 0.5) * f.h; } return w > 0 ? y / w : 0; }
{
  const st = Object.assign(K.defaults(SCHEMA), { preset: 'ring', nBurn: 1, motion: 'static', floor: false });
  const S = run(st, 1, 240, 40000), h = SV.health(S), b = S.cfg.burners[0], yc = heatCentroid(S), f = S.f;
  let sy = 0, sw = 0, fy = 0, fw = 0;
  for (let j = 0; j < f.NY; j++) for (let i = 0; i < f.NX; i++) { const t = f.t[j * f.NX + i], y = (j + 0.5) * f.h; if (t > 0.02 && t < 0.3) { sy += y; sw++; } else if (t >= 0.3) { fy += y; fw++; } }
  ok(h.bad === 0 && yc > b.y + 0.05 && sw > 100 && fw > 100 && sy / sw > fy / fw, 'plume: default ring: heat rises above the ring; smoke rides above the flame', `${f.NX}x${f.NY}, heat centroid ${yc.toFixed(2)} m, ring ${b.y.toFixed(2)} m; smoke at ${(sy / sw).toFixed(2)} m over flame at ${(fy / fw).toFixed(2)} m`);
}
{
  const f = SV.makeGrid(66, 42, 1 / 40);
  const lit = kind => { let c = 0; for (let i = 0; i < f.NX; i++) for (let j = 0; j < f.NY; j++) if (SV.burnCell(f, { kind, x: 0.75, y: 0.4, r: 0.15 }, i, j)) c++; return c; };
  const counts = SV.BURNERS.map(lit);
  ok(counts.every(c => c > 0), 'burners: every kind lights cells', SV.BURNERS.map((k, i) => `${k} ${counts[i]}`).join(', '));
  const st = Object.assign(K.defaults(SCHEMA), { preset: 'floor', nBurn: 1, floor: false });
  const S = run(st, 2, 60, 20000);
  ok(SV.health(S).heat === 0, 'burners: an unlit burner (the floor preset ring) gives no heat when the floor is off');
}

// ---- projection ---------------------------------------------------------------
{
  const rows = [];
  for (const it of [1, 2, 3]) {
    const S = SV.createSim(); S.cfg.iters = it;
    SV.buildScene(S, { cells: 48000, aspect: 1.6, burners: [{ kind: 'ring', fx: 0.5, fy: 0.3, r: 0.13 }] }, lcg(5));
    for (let k = 0; k < 200; k++) SV.step(S);
    rows.push(Object.assign({ it }, SV.projectionResidual(S)));
  }
  const r1 = rows[0].after / rows[0].before, r2 = rows[1].after / rows[1].before;
  ok(r1 < 0.15 && r2 < 0.02 && rows[1].after < 1e-3 && rows[1].max < 0.02, 'projection: multigrid divergence after the solve: 1 V-cycle < 0.15 of before, 2 (default) < 0.02, rms < 1e-3 m/s',
    rows.map(r => `${r.it} cycle(s): rms ${r.before.toExponential(2)} -> ${r.after.toExponential(2)} (x${(r.after / r.before).toFixed(4)}), max ${r.max.toExponential(2)}`).join('; '));
}

// ---- turbulence, core and flicker (v1 = before) ------------------------------
const v1Def = ringRun(V1, true, 100000), v1Same = ringRun(V1, true, 48000), now = ringRun(SV, false, 48000);
{
  const fDef = v1Def.small / now.small, fSame = v1Same.small / now.small;
  ok(fDef >= 8 && fSame >= 5, 'turbulence: small-scale kinetic energy at default settings is lower than v1 by a factor 8 or more (v1 default 100k cells) and 5 or more (both 48k cells)',
    `v1 100k ${v1Def.small.toFixed(4)}, v1 48k ${v1Same.small.toFixed(4)}, now ${now.small.toFixed(4)}: factor ${fDef.toFixed(1)} and ${fSame.toFixed(1)}; mean |curl| in the plume ${v1Def.curl.toFixed(1)} / ${v1Same.curl.toFixed(1)} -> ${now.curl.toFixed(1)} 1/s`);
  const sn = std(now.near), st_ = std(now.top), s1 = std(v1Def.near);
  ok(sn < 0.01 && st_ > 5 * sn && sn * 5 < s1, 'core and flicker: T just above the ring is steady (std < 0.01, 5x under v1) while the top flickers (std > 5x the core)',
    `core std ${sn.toFixed(4)} (v1 ${s1.toFixed(4)}), top std ${st_.toFixed(4)} (v1 ${std(v1Def.top).toFixed(4)})`);
  const sp = spectrum(now.top), spn = spectrum(now.near);
  ok(sp.peak >= 1 && sp.peak <= 5 && sp.hi < 0.1, 'flicker: the top moves slowly: spectrum peak 1..5 Hz, under 10 % of the power above 5 Hz',
    `top peak ${sp.peak} Hz, power above 5 Hz ${(100 * sp.hi).toFixed(1)} %; core peak ${spn.peak} Hz, ${(100 * spn.hi).toFixed(1)} % above 5 Hz; pool-fire puffing 1.5 / sqrt(D) = ${(1.5 / Math.sqrt(0.26)).toFixed(1)} Hz for D = 0.26 m`);
  const hi = ringRun(SV, false, 48000, { turbulence: 1 }, 240), lo = ringRun(SV, false, 48000, { turbulence: 0, swirlProbability: 0 }, 240);
  ok(hi.small > 3 * now.small && lo.small <= 1.25 * now.small, 'Turbulence control: 1.0 gives 3x or more the small-scale energy of the default; 0 gives about the default or less (both laminar)',
    `0: ${lo.small.toFixed(4)}, 0.25 (default): ${now.small.toFixed(4)}, 1: ${hi.small.toFixed(4)}`);
}

// ---- cost per step (CPU in node; the GPU number came from a Deno run) ---------
{
  const bench = (M, cells) => {
    const S = M.createSim();
    M.buildScene(S, { cells, aspect: 1.6, burners: [{ kind: 'ring', fx: 0.5, fy: 0.3, r: 0.13 }] }, lcg(3));
    for (let k = 0; k < 30; k++) M.step(S);
    const t0 = performance.now(); for (let k = 0; k < 60; k++) M.step(S);
    return { ms: (performance.now() - t0) / 60, grid: M === V1 ? `${S.f.numX}x${S.f.numY}` : `${S.f.NX}x${S.f.NY}` };
  };
  const a = bench(V1, 100000), b = bench(SV, 48000), c = bench(SV, 20000);
  ok(b.ms < a.ms, 'cost per step (node, CPU): now at the desktop default is cheaper than v1 at its default', `v1 ${a.grid} ${a.ms.toFixed(1)} ms; now ${b.grid} ${b.ms.toFixed(1)} ms (CPU fallback), phone ${c.grid} ${c.ms.toFixed(1)} ms; the page runs the GPU path (Deno check, not in this suite)`);
}

// ---- GPU plan and uniforms ------------------------------------------------------
{
  let bad = [], counts = [];
  for (const cyc of [1, 2, 3, 4]) for (let r = 0; r < 3; r++) for (const par of [0, 1]) {
    const plan = makePlan(290, 178, cyc, r, par), written = new Set([`S${r}`, `L0_${par}`, 'SRC']);
    for (const p of plan.passes) {
      for (const n of p.in) if (!written.has(n)) bad.push(`${cyc}/${r}/${par} ${p.k} reads unwritten ${n}`);
      if (p.in.includes(p.out)) bad.push(`${p.k} reads its output ${p.out}`);
      written.add(p.out);
    }
    const last = plan.passes[plan.passes.length - 1];
    if (last.out !== `S${plan.next.r}`) bad.push(`next state ${plan.next.r} is not the mac output ${last.out}`);
    const proj = plan.passes.find(p => p.k === 'project');
    if (proj.in[1] !== `L0_${plan.next.par}`) bad.push('next pressure is not the projected one');
    if (r === 0 && par === 0) counts.push(`${cyc}: ${plan.passes.length}`);
  }
  ok(!bad.length, 'plan: every GPU pass reads only textures written before it in the step (or kept from the last step); the next state and pressure line up', bad.length ? bad.slice(0, 3).join('; ') : `passes per step by V-cycles ${counts.join(', ')}; levels ${makePlan(290, 178, 1).levels.map(l => `${l.W}x${l.H}`).join(' ')}`);
  const wgslNames = WGSL.force.match(/struct Step \{([^}]*)\}/)[1].split(',').map(s => s.split(':')[0].trim()).filter(s => /^\w+$/.test(s) && s !== 'swirl' && !/^\d/.test(s));
  const S = SV.createSim(); SV.buildScene(S, { cells: 8000, aspect: 1.6, burners: [{ kind: 'ring', fx: 0.5, fy: 0.3, r: 0.13 }] }, lcg(2));
  S.swirls = [{ x: 1, y: 2, w: 3, R: 4 }];
  const P = SV.stepUniforms(S, 1 / 60), out = packStep(new Float32Array(STEP_FLOATS), S, P);
  const names = ['dt', 'h', 'nx', 'ny', 'lift', 'accel', 'gravity', 'eps', 'visc', 'drag', 'wind', 'floorH', 'pertX', 'pertY', 'kappa', 'fireCool', 'smokeCool', 'nSwirl', 'spin', 'flameT'];
  ok(JSON.stringify(wgslNames) === JSON.stringify(names) && STEP_FIELDS.length === 20 && out[2] === S.f.NX && out[17] === 1 && out[20] === 1 && out[23] === 4 && Math.abs(out[0] - 1 / 60) < 1e-7,
    'uniforms: packStep follows the WGSL Step struct (20 floats, then swirls x y spin radius)');
}

// ---- shaders -------------------------------------------------------------------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fire-sh-'));
  const naga = path.join(os.homedir(), '.cargo/bin/naga');
  const haveNaga = fs.existsSync(naga), haveGlslang = spawnSync('glslangValidator', ['--version']).status === 0;
  const errs = [];
  if (haveNaga) for (const [k, src] of Object.entries(WGSL)) { const p = path.join(tmp, k + '.wgsl'); fs.writeFileSync(p, src); const r = spawnSync(naga, [p], { encoding: 'utf8' }); if (r.status !== 0) errs.push(`naga ${k}: ${(r.stderr || r.stdout).split('\n').slice(0, 3).join(' ')}`); }
  if (haveGlslang) for (const [k, src] of Object.entries(GLSL)) { const p = path.join(tmp, k + (k === 'vs' ? '.vert' : '.frag')); fs.writeFileSync(p, src); const r = spawnSync('glslangValidator', [p], { encoding: 'utf8' }); if (r.status !== 0) errs.push(`glslang ${k}: ${(r.stdout || '').split('\n').filter(l => /ERROR/.test(l)).slice(0, 2).join(' ')}`); }
  fs.rmSync(tmp, { recursive: true, force: true });
  ok(haveNaga && haveGlslang && !errs.length, `shaders: naga validates ${Object.keys(WGSL).length} WGSL modules, glslangValidator ${Object.keys(GLSL).length} GLSL ES 3.00 shaders`, errs.length ? errs.slice(0, 3).join(' | ') : (!haveNaga || !haveGlslang ? 'a validator is missing' : ''));
  // Tint (Chrome) rejects && with || and bitwise with arithmetic at one depth
  const mixed = [];
  for (const [k, src] of Object.entries(WGSL)) {
    src.split('\n').forEach((line, n) => {
      const code = line.replace(/\/\/.*$/, ''), stack = [{ and: 0, or: 0, bit: 0, ar: 0 }];
      for (let c = 0; c < code.length; c++) {
        const ch = code[c], two = code.slice(c, c + 2), top = stack[stack.length - 1];
        if (ch === '(' || ch === '[') { stack.push({ and: 0, or: 0, bit: 0, ar: 0 }); continue; }
        if (ch === ')' || ch === ']') { const s = stack.pop(); if ((s.and && s.or) || (s.bit && s.ar)) mixed.push(`${k}:${n + 1}`); continue; }
        if (two === '&&') { top.and++; c++; continue; }
        if (two === '||') { top.or++; c++; continue; }
        if (two === '>>' || two === '<<' || two === '->' || two === '>=' || two === '<=' || two === '==' || two === '!=') { if (two === '>>' || two === '<<') top.bit++; c++; continue; }
        if (ch === '&' || ch === '|' || ch === '^') top.bit++;
        else if ('+*/%'.includes(ch) || (ch === '-' && /[\w)\]]\s*$/.test(code.slice(0, c)))) top.ar++;
      }
      const s = stack[0]; if ((s.and && s.or) || (s.bit && s.ar)) mixed.push(`${k}:${n + 1}`);
    });
  }
  ok(!mixed.length, 'shaders: WGSL has no && mixed with ||, and no bitwise op mixed with arithmetic, at one bracket depth (Chrome Tint rule)', mixed.slice(0, 5).join(', '));
}

// ---- governor ------------------------------------------------------------------
{
  // frame time = max(refresh, work x cell scale); a load phase in the middle
  function sim(refresh, work, loadFrom, loadTo, loadWork, secs) {
    const G = createGovernor(); let t = 0; const levels = [];
    while (t < secs * 1000) {
      const w = t >= loadFrom * 1000 && t < loadTo * 1000 ? loadWork : work;
      t += Math.max(refresh, w * CELLS[G.level] + 2);
      G.tick(t); levels.push([t / 1000, G.level]);
    }
    return { G, levels, at: s => { let l = 0; for (const [tt, lv] of levels) if (tt <= s) l = lv; return l; }, max: Math.max(...levels.map(x => x[1])) };
  }
  const a = sim(16.7, 8, 10, 40, 40, 120);
  ok(a.at(9) === 0 && a.at(39) >= 2 && a.at(119) === 0, 'governor: a heavy load drops the level and the level climbs back to full size after the load ends',
    `level at 9 s ${a.at(9)}, at 39 s ${a.at(39)}, at 119 s ${a.at(119)}; changes ${a.G.history.map(h => `${(h.t / 1000).toFixed(0)}s->${h.level}`).join(' ')}`);
  const b = sim(33.4, 10, 0, 0, 0, 60), c = sim(8.33, 5, 0, 0, 0, 60);
  ok(b.at(59) === 0 && b.G.history.length <= 2 && c.max === 0, 'governor: a 30 Hz screen and a 120 Hz screen with a light load stay at full size (a drop that does not help is undone)',
    `30 Hz: ${b.G.history.map(h => `${(h.t / 1000).toFixed(0)}s->${h.level}`).join(' ') || 'no change'}, refresh estimate ${b.G.ref.toFixed(1)} ms; 120 Hz: ${c.G.history.length} changes`);
  // a load that fits only at level 1: it must settle, and still retry the top
  const d = sim(16.7, 30, 0, 0, 0, 240), ups = d.G.history.filter(h => h.level === 0).length;
  ok(d.at(239) <= 2 && ups >= 2, 'governor: a load over the budget settles at a lower level and keeps trying the top level (no stuck floor)', `${d.G.history.length} changes, ${ups} climbs to 0, last level ${d.at(239)}, hold ${d.G.hold} s`);
}

// ---- resample ------------------------------------------------------------------
{
  const st = Object.assign(K.defaults(SCHEMA), { preset: 'ring', nBurn: 1, motion: 'static' });
  const S = run(st, 3, 120, 40000), h0 = SV.health(S).heat * S.f.numCells * S.f.h * S.f.h;
  SV.resample(S, 22000, st.aspect);
  const h1 = SV.health(S).heat * S.f.numCells * S.f.h * S.f.h;
  for (let k = 0; k < 30; k++) SV.step(S);
  ok(Math.abs(h1 / h0 - 1) < 0.08 && SV.health(S).bad === 0, 'resample: the governor resample keeps the heat (within 8 %) and the sim runs on', `heat ${h0.toFixed(4)} -> ${h1.toFixed(4)} m^2, grid ${S.f.NX}x${S.f.NY}`);
}

// ---- random scenes, determinism, hash, guard --------------------------------------
{
  const N = process.env.FIRE_FULL ? 200 : 30, bad = [], t0 = Date.now(), kinds = {};
  for (let s = 1; s <= N; s++) {
    const st = sceneOf(s * 7907); kinds[st.preset] = (kinds[st.preset] || 0) + 1;
    const S = run(st, s * 7907, 300, 12000), h = SV.health(S);
    if (h.bad || h.vmax > 80) bad.push(`seed ${s * 7907} ${st.preset}: bad ${h.bad} vmax ${h.vmax.toFixed(1)}`);
  }
  ok(!bad.length, `random scenes: ${N} seeds x 300 frames, finite, bounded`, bad.length ? bad.slice(0, 3).join('; ') : `${JSON.stringify(kinds)} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
{
  const st = sceneOf(4242), a = run(st, 4242, 90, 15000), b = run(st, 4242, 90, 15000);
  let same = true; for (let k = 0; k < a.f.numCells && same; k++) if (a.f.t[k] !== b.f.t[k] || a.f.u[k] !== b.f.u[k]) same = false;
  ok(same, 'determinism: one seed gives the same fire after 90 frames (seeded swirls)');
}
{
  let bad = 0;
  for (let s = 1; s <= 200; s++) { const st = sceneOf(s); const d = K.decodeHash(SCHEMA, K.encodeHash(SCHEMA, st, s)); if (d.seed !== s || JSON.stringify(d.state) !== JSON.stringify(st)) bad++; }
  ok(bad === 0, 'hash: 200 random scenes round-trip through the share link');
  const g = Array.from({ length: 300 }, (_, s) => sceneOf(s + 1));
  ok(g.every(st => st.floor === (st.preset === 'floor' || st.preset === 'both') && st.smokeCool <= st.fireCool * 0.8 + 1e-9), 'guard: the floor follows the preset; smoke cools slower than fire');
  const old = K.decodeHash(SCHEMA, 'iters=10&prob=50&cells=100000&s=7').state;
  ok(old.iters === 4 && old.prob === 50 && old.turb === 0.25 && old.cells === 100000, 'hash: a v1 link (iters 10, prob 50) still loads: iters clamps to 4 V-cycles, turbulence takes its default', `iters ${old.iters}, turb ${old.turb}`);
}

// ---- render and palette -----------------------------------------------------------
{
  let bad = 0, calls = 0; const t = K.themeById('night');
  for (const [preset, colorBy, fire] of [['ring', 'flame', 'blackbody'], ['ring', 'flame', 'upstream'], ['campfire', 'flame', 'campfire'], ['torches', 'map', 'blue'], ['mixed', 'speed', 'violet']]) {
    const st = sceneOf(5, { preset, colorBy, fire, showSwirls: true, nBurn: 3, prob: 60 }), S = run(st, 5, 40, 10000), ctx = fakeCtx(800, 500);
    draw(ctx, S, fitView(S, { x: 0, y: 0, w: 800, h: 500 }), { bg: t.bg, bg2: t.bg2, ink: t.ink, wall: t.wall, accent: t.accent, burner: '#444', log: '#5b3a24', lut: PL.paletteLut(fire), colorBy, glow: 0.6, showBurners: true, showSwirls: true, veil: 0.2 }, {}, makeCanvas, 800, 500);
    bad += ctx.bad; calls += ctx.calls;
  }
  ok(bad === 0 && calls > 20, 'render: every mode draws with finite canvas calls', `${calls} calls`);
  const up = rampLut(SC.FIRE.find(x => x.id === 'upstream').colors, SC.FIRE_STOPS);
  ok(up[0] === 0 && up[255 * 3] === 255 && up[255 * 3 + 1] === 255 && up[255 * 3 + 2] === 0, 'render: the Classic ramp runs black to yellow like upstream getFireColor');
}
{
  const D65 = PL.planckRGB(6504);
  ok(D65.every(v => v > 0.93), 'palette: Planck 6504 K is near white in linear sRGB (CIE 1931 fit + XYZ matrix)', D65.map(v => v.toFixed(3)).join(' '));
  const lo = PL.planckRGB(1000), mid = PL.planckRGB(2000);
  ok(lo[0] === 1 && lo[1] < 0.1 && lo[2] < 0.01 && mid[1] > 0.2 && mid[1] < 0.35, 'palette: Planck 1000 K is red, 2000 K is orange', `1000 K ${lo.map(v => v.toFixed(3)).join(' ')}, 2000 K ${mid.map(v => v.toFixed(3)).join(' ')}`);
  const E = 0.5 / 255;
  for (const id of ['blackbody', 'campfire', 'white']) {
    const p = PL.paletteById(id), N = 141, F = [], A = [];
    for (let k = 0; k < N; k++) { const t = 0.3 + 0.7 * k / (N - 1); F.push(PL.flameDisplay(p, t)); A.push(PL.samplePalette(p, t).rgb); }
    const Y = F.map(c => PL.luminance(c.map(PL.srgbDecode)));
    let order = 0, ratio = 0, lum = 0, hueDrop = 0, tailDrop = 0;
    for (let k = 0; k < N; k++) {
      for (const c of [F[k], A[k]]) if (c[1] > c[0] + E || c[2] > c[1] + E) order++;
      if (k && !(Math.max(...F[k - 1]) > 0)) { if (!(Y[k] > Y[k - 1])) lum++; continue; }
      if (k) {
        if ((F[k][1] >= 1 / 255 && F[k][1] / F[k][0] < F[k - 1][1] / F[k - 1][0] - 1e-6) || (F[k][2] >= 1 / 255 && F[k][2] / F[k][0] < F[k - 1][2] / F[k - 1][0] - 1e-6)) ratio++;
        if (!(Y[k] > Y[k - 1])) lum++;
        const sat = 1 - Math.min(...F[k]) / Math.max(...F[k]), dh = PL.hue(F[k - 1]) - PL.hue(F[k]);
        if (sat >= 0.5 && dh > 1e-6 && F[k][1] >= 1 / 255) hueDrop++;
        if (sat < 0.5) tailDrop = Math.max(tailDrop, dh);
      }
    }
    const h0 = PL.hue(F[1]), hN = PL.hue(F[N - 1]), cN = F[N - 1];
    ok(order === 0, `palette ${id}: red >= green >= blue at every flame sample (no green, no magenta)`, `${N} flame + ${N} composited samples`);
    ok(ratio === 0 && lum === 0, `palette ${id}: G/R and B/R rise and luminance rises with t (red, orange, yellow, white)`, `Y ${Y[0].toFixed(4)} .. ${Y[N - 1].toFixed(3)}`);
    ok(hueDrop === 0 && h0 < 8, `palette ${id}: hue rises from red while the colour is saturated`, `hue ${h0.toFixed(1)} .. ${hN.toFixed(1)} deg; near-white tail drift ${tailDrop.toFixed(1)} deg`);
    if (id === 'blackbody') ok(Math.min(...cN) > 0.75 && F[0].every(v => v === 0) && F[14][0] < 0.45 && F[14][1] < 0.1 * F[14][0], 'palette blackbody: emission starts at zero, the edge is a dim deep red, the core is near white', `t 0.37 ${F[14].map(v => Math.round(v * 255))}, core ${cN.map(v => Math.round(v * 255))}`);
  }
  {
    let glow = 0, light = 0, order = 0, prevA = 0, mono = 0;
    for (let k = 1; k < 60; k++) {
      const t = 0.3 * k / 60, s = PL.samplePalette(PL.paletteById('blackbody'), t);
      if (Math.max(...s.emit) > 0) glow++;
      if (Math.max(...s.rgb) > 70 / 255) light++;
      if (s.rgb[1] > s.rgb[0] + E || s.rgb[2] > s.rgb[1] + E) order++;
      if (!(s.a > prevA)) mono++; prevA = s.a;
    }
    ok(!glow && !light && !order && !mono, 'palette: smoke (t < 0.3) absorbs and does not glow: dark grey-brown, alpha rises with t');
  }
  {
    let worst = 0, cells = 0;
    for (const id of ['blackbody', 'campfire', 'sodium', 'blue']) {
      const L = PL.paletteLut(id), p = PL.paletteById(id);
      for (let k = 0; k < L.n; k++) { const s = PL.samplePalette(p, k / (L.n - 1)); for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(L.rgba[k * 4 + c] - Math.round(s.rgb[c] * 255))); worst = Math.max(worst, Math.abs(L.rgba[k * 4 + 3] - Math.round(s.a * 255))); }
    }
    const st = sceneOf(11, { preset: 'ring', colorBy: 'flame', fire: 'blackbody' }), S = run(st, 11, 60, 10000), cache = {}, t = K.themeById('night');
    draw(fakeCtx(800, 500), S, fitView(S, { x: 0, y: 0, w: 800, h: 500 }), { bg: t.bg, bg2: t.bg2, ink: t.ink, wall: t.wall, accent: t.accent, burner: '#444', log: '#5b3a24', lut: PL.paletteLut('blackbody'), colorBy: 'flame', glow: 0.6, showBurners: true, showSwirls: false, veil: 0 }, cache, makeCanvas, 800, 500);
    const f = S.f, d = cache.img.data, p = PL.paletteById('blackbody');
    let px = 0;
    for (let j = 0; j < f.NY; j++) for (let i = 0; i < f.NX; i++) {
      const tv = Math.min(1, Math.max(0, f.t[j * f.NX + i])), s = PL.samplePalette(p, tv), o = ((f.NY - 1 - j) * f.NX + i) * 4;
      if (tv > 0.3) cells++;
      for (let c = 0; c < 3; c++) px = Math.max(px, Math.abs(d[o + c] * d[o + 3] / 255 - s.rgb[c] * s.a * 255));
      px = Math.max(px, Math.abs(d[o + 3] - s.a * 255));
    }
    ok(worst === 0 && px <= 3, 'palette: the renderer LUT matches palette.js (table exact, per cell within 3/255 premultiplied after the 1024-step lookup)', `table max diff ${worst}, per-cell max diff ${px.toFixed(2)} over ${f.numCells} cells (${cells} flame)`);
  }
}

// ---- saver plan, page (stub DOM, CPU path) ------------------------------------------
{
  const { SHOTS } = await import('./saver.js');
  const plan = K.planShots(SHOTS, 5, 200);
  ok(SHOTS.length >= 6 && plan.every((p, i) => !i || p.key !== plan[i - 1].key) && plan.every(p => p.sec >= 6 && p.sec <= 12), `saver plan: ${SHOTS.length} shots, no repeats, 6-12 s cuts`);
  const r = K.rng(3), calm = SHOTS.map(s => s.scene(r)).every(sc => (sc.turb ?? 0.25) <= 0.35 && (sc.speed ?? 0.12) <= 0.12 && (sc.swirlW ?? 6) <= 14);
  ok(calm, 'saver: every shot is calm (Turbulence <= 0.35, motion <= 0.12 Hz, swirls <= 14 rad/s)');
}
{
  installDom({ w: 1280, h: 800 });
  globalThis.TMP = { page() {}, creditLines: () => ['Fire Simulation by Matthias Müller'] };
  const view = document.createElement('canvas'); view.id = 'view'; view.width = 1280; view.height = 800; document.body.appendChild(view);
  document.createElement = (orig => t => { const e = orig(t); if (t === 'canvas') { e.getContext = () => e._c || (e._c = fakeCtx(e.width, e.height)); } return e; })(document.createElement);
  view.getContext = () => view._c || (view._c = fakeCtx(1280, 800));
  await import('./main.js');
  const P = window.__fire;
  runRaf(20);
  const f0 = P.S.frame;
  ok(P.kit.playing && f0 > 0 && P.S.f && P.engine === 'cpu', 'page: boots on the CPU path (no GPU in node), builds a scene and autoplays', `${P.kit.state.preset}, ${P.S.f.NX}x${P.S.f.NY}, ${f0} frames, engine ${P.engine}`);
  const seed0 = P.kit.seed; P.kit.newScene(); runRaf(3);
  ok(P.kit.seed !== seed0 && P.S.frame < f0 + 5, 'page: a new scene rebuilds the sim');
  ok(view._c.bad === 0, 'page: no non-finite canvas calls while running');
  const n0 = P.S.f.numCells; P.gov.level = 2; P.applyLevel(); runRaf(5);
  const n1 = P.S.f.numCells; P.gov.level = 0; P.applyLevel(); runRaf(5);
  ok(n1 < n0 * 0.7 && P.S.f.numCells === n0 && SV.health(P.S).bad === 0, 'page: a governor level change resamples the sim down and back up', `${n0} -> ${n1} -> ${P.S.f.numCells} cells`);
  const labels = [];
  await window.snSaver.enter({ seed: 9, label: L => labels.push(L) });
  for (let k = 0; k < 9; k++) { window.snSaver.cut(); runRaf(4); }
  const hist = window.snSaver.debug().hist; let rep = 0; for (let i = 1; i < hist.length; i++) if (hist[i].shot === hist[i - 1].shot) rep++;
  ok(hist.length === 10 && rep === 0 && SV.health(P.S).bad === 0 && labels.every(L => L.tex && !L.code), 'page saver: 10 cuts, no repeats, finite sim, TeX plates, no code', hist.map(x => x.shot).join(' '));
  window.snSaver.exit();
  ok(!document.documentElement.classList.contains('sk-saver'), 'page saver: exit restores the page');
}
// ---- jsdom boot, desktop and phone (child processes: one page per process) ----
{
  for (const v of ['desktop', 'phone']) {
    const r = spawnSync(process.execPath, [path.join(HERE, 'tests-dom.mjs'), v], { encoding: 'utf8', env: process.env, timeout: 120000 });
    const out = (r.stdout || '') + (r.stderr || ''), last = out.trim().split('\n').pop();
    ok(r.status === 0 && /^DOM OK/.test(last), `dom: the page boots in jsdom (${v}) with no errors, runs, cuts the saver`, last);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
