// ════════════════════════════════════════════════════════════════════════════
//  STRING LAB · tests.mjs — page-level checks (node, no browser)
// ────────────────────────────────────────────────────────────────────────────
//  node stella-nova/pages/string-lab/tests.mjs
//  The engine, the 3D view, the playback panel and the saver have their own
//  test files. This file checks what sits between them:
//    floor   every colour map (and its reverse) keeps a resting string
//            above CIE L* L_FLOOR, and leaves bright entries unchanged
//    math    "The mathematics of a string" (mathsec.js): the Fourier figure
//            matches the engine's measured mode amplitudes, B matches the
//            engine's partials (scheme formula and an FFT of the bridge
//            force), the energy sum, the reflection numbers, every "see it"
//            action names a real page API call, and every equation of the
//            #math article typesets through lib/sci-math.js in jsdom (set
//            NODE_PATH to a folder with jsdom, else SKIP)
// ════════════════════════════════════════════════════════════════════════════

import * as CM from '../ct-lab/colormaps/maps.js';
import { floorLut, L_FLOOR } from './stringlut.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { MATH, fourierData, SEE, FIGURES } from './mathsec.js';
import { StringSim, pluckCoefficients, modalFrequencies, inharmonicity, paramsB } from './engine/strings.js';
import { INSTRUMENTS, stringParams } from './engine/instruments.js';
import { magnitudeSpectrum, peakNear } from './engine/fft.js';

const here = fileURLToPath(new URL('.', import.meta.url));

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else fail++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

// ── floor ──────────────────────────────────────────────────────────────────
{
  let worst = 101, worstId = '', changedBright = 0, maps = 0, restBefore = 101;
  for (const id of CM.ids()) for (const reverse of [false, true]) {
    maps++;
    const lut = CM.variant(id, { reverse }), f = floorLut(lut);
    for (let i = 0; i < 256; i++) {
      const o = i * 3, L = CM.cieL(f[o], f[o + 1], f[o + 2]);
      if (L < worst) { worst = L; worstId = `${id}${reverse ? ' (reversed)' : ''} entry ${i}`; }
      if (CM.cieL(lut[o], lut[o + 1], lut[o + 2]) >= L_FLOOR && (f[o] !== lut[o] || f[o + 1] !== lut[o + 1] || f[o + 2] !== lut[o + 2])) changedBright++;
    }
    if (!reverse) restBefore = Math.min(restBefore, CM.cieL(lut[0], lut[1], lut[2]));
  }
  ok(worst >= L_FLOOR, `floor: every entry of ${maps} maps (41 and their reverses) has L* >= ${L_FLOOR}`, `darkest ${worst.toFixed(1)} at ${worstId}`);
  ok(changedBright === 0, 'floor: entries already above the floor are unchanged', `${changedBright} changed`);
  const mag = CM.variant('magma'), m0 = CM.cieL(mag[0], mag[1], mag[2]), f0 = floorLut(mag);
  ok(m0 < 5 && CM.cieL(f0[0], f0[1], f0[2]) >= L_FLOOR, 'floor: magma at zero field was black and is now a visible core', `L* ${m0.toFixed(1)} -> ${CM.cieL(f0[0], f0[1], f0[2]).toFixed(1)}; darkest raw map start L* ${restBefore.toFixed(1)}`);
}

// ── math ───────────────────────────────────────────────────────────────────
{
  // Fourier: formula vs projection of the engine's plucked shape
  let worst = 0, at = '';
  for (const p of [0.2, 0.125, 0.37, 0.5, 0.06]) {
    const { theory, measured } = fourierData(p, 16);
    const max = Math.max(...theory.map(Math.abs));
    theory.forEach((b, i) => { const e = Math.abs(b - measured[i]) / max; if (e > worst) { worst = e; at = `p ${p} n ${i + 1}`; } });
  }
  ok(worst < 0.01, 'math: Fourier bars match the StringSim pluck projection (5 pluck points, n 1..16)', `worst ${(worst * 100).toFixed(3)} % of the largest bar at ${at}`);
  const d5 = fourierData(0.2, 16);
  const mx = Math.max(...d5.measured.map(Math.abs));
  ok([5, 10, 15].every((n) => Math.abs(d5.measured[n - 1]) / mx < 1e-3), 'math: a pluck at L/5 leaves harmonics 5, 10, 15 out of the simulated string');
}
{
  // B: formula vs the engine's parameters and its exact scheme partials
  // the explicit scheme is a little flat on high partials of very stiff
  // strings (CONTRACT.md); the guitars must be within 2 cents, the violin
  // (plain steel E5, the stiffest) within 5
  let worstB = 0, worstC = 0, at = '', worstV = 0, atV = '';
  for (const key of ['steel', 'classical', 'violin']) {
    const inst = INSTRUMENTS[key];
    inst.strings.forEach((s, i) => {
      const P = stringParams(inst, i, 0), B = inharmonicity({ E: s.E, d: s.d, T: s.T, L: inst.scaleM });
      worstB = Math.max(worstB, Math.abs(B - paramsB(P)) / B);
      const sim = new StringSim(P), f1 = sim.schemeFrequency(1) / Math.sqrt(1 + B);
      for (let n = 1; n <= 8; n++) {
        const c = Math.abs(1200 * Math.log2(sim.schemeFrequency(n) / (n * f1 * Math.sqrt(1 + B * n * n))));
        if (key === 'violin') { if (c > worstV) { worstV = c; atV = `${s.name} n ${n}`; } }
        else if (c > worstC) { worstC = c; at = `${key} ${s.name} n ${n}`; }
      }
    });
  }
  ok(worstB < 1e-9, 'math: B = pi^3 E d^4 / (64 T L^2) equals the engine B of all 16 strings', `worst relative ${worstB.toExponential(1)}`);
  ok(worstC < 2, 'math: guitar scheme partials 1..8 follow n f1 sqrt(1 + B n^2) within 2 cents', `worst ${worstC.toFixed(2)} cents at ${at}`);
  ok(worstV < 5, 'math: violin scheme partials 1..8 follow the formula within 5 cents', `worst ${worstV.toFixed(2)} cents at ${atV}`);
  // FFT of the bridge force of the plain B3 steel string
  const inst = INSTRUMENTS.steel, P = stringParams(inst, 4, 0), sim = new StringSim(P);
  sim.pluck({ pos: 0.13, amp: 0.002, width: 0.01 });
  const n = 32768, sig = new Float64Array(n);
  for (let k = 0; k < n; k++) { sim.step(1); sig[k] = sim.bridgeForce(); }
  const spec = magnitudeSpectrum(sig, 1 / sim.k, 4 * n), B = paramsB(P), f1 = modalFrequencies(P, 1)[0] / Math.sqrt(1 + B);
  let wc = 0; const rows = [];
  for (let m = 1; m <= 6; m++) {
    const want = m * f1 * Math.sqrt(1 + B * m * m), got = peakNear(spec, want, 40).f, c = 1200 * Math.log2(got / want);
    wc = Math.max(wc, Math.abs(c)); rows.push(c.toFixed(2));
  }
  ok(wc < 3, 'math: FFT partials 1..6 of the simulated plain B3 string match the B formula within 3 cents', `cents off: ${rows.join(' ')}`);
}
{
  // energy: sum over modes = pluck work = the engine energy just after the pluck
  const inst = INSTRUMENTS.steel, s = inst.strings[1], L = inst.scaleM, P = stringParams(inst, 1, 0), p = 0.2, h = 0.002, NM = 4000;
  const b = pluckCoefficients(p, h, NM), f = Array.from({ length: NM }, (_, i) => ((i + 1) / (2 * L)) * Math.sqrt(s.T / s.mu));
  let sum = 0; for (let i = 0; i < NM; i++) sum += MATH.modeEnergy(s.mu, L, f[i], b[i]);
  const work = MATH.pluckEnergy(s.T, L, p, h);
  const sim = new StringSim({ ...P, kappa: 0, sigma0: 0, sigma1: 0 }); sim.pluck({ pos: p, amp: h, width: 0 });
  const eSim = sim.energy();
  ok(Math.abs(sum / work - 1) < 1e-3 && Math.abs(eSim / work - 1) < 0.02, 'math: sum of mode energies = pluck work = StringSim energy',
    `sum/work ${(sum / work).toFixed(5)}, sim/work ${(eSim / work).toFixed(4)}`);
  const s2 = new StringSim({ ...P, kappa: 0, sigma0: 0, sigma1: 0 }); s2.pluck({ pos: p, amp: h, width: 0.02 });
  const e0 = s2.energy(); s2.step(20000);
  ok(Math.abs(s2.energy() / e0 - 1) < 1e-6, 'math: with no damping the energy stays constant (20000 steps)', `ratio ${(s2.energy() / e0).toFixed(9)}`);
}
{
  // reflection
  const r1 = MATH.reflection(1, 1), rInf = MATH.reflection(1, 1e9), r = MATH.reflection(1, 3);
  const pt = (Z1, Z2) => { const q = MATH.reflection(Z1, Z2); return (Z2 / Z1) * q.tU * q.tU; };
  ok(r1.rF === 0 && r1.tU === 1 && Math.abs(rInf.rU + 1) < 1e-8 && Math.abs(r.rF - 0.5) < 1e-12 && Math.abs(r.energyIn - 0.75) < 1e-12,
    'math: reflection r_F = (Z2 - Z1)/(Z2 + Z1): 0 when matched, -1 displacement at a rigid end, 0.5 and 75 % at Z2 = 3 Z1');
  ok([[1, 3], [1, 0.2], [0.7, 900]].every(([a, c]) => Math.abs(MATH.reflection(a, c).rF ** 2 + pt(a, c) - 1) < 1e-12), 'math: reflected + transmitted power = incident power');
  const s = INSTRUMENTS.steel.strings[1], Z = Math.sqrt(s.T * s.mu), q = MATH.reflection(Z, 300);
  const sigma = MATH.bridgeDecay(110, q.rF);
  ok(Z > 0.5 && Z < 2 && q.energyIn < 0.02 && MATH.t60(sigma) > 1, 'math: steel A2 into a 300 kg/s bridge leaks under 2 % per bounce, T60 from the bridge alone > 1 s',
    `Z ${Z.toFixed(3)} kg/s, ${(q.energyIn * 100).toFixed(3)} %, T60 ${MATH.t60(sigma).toFixed(1)} s`);
  const [wa, wb] = MATH.coupled(10, 10, 4);
  ok(Math.abs(wa - 10) < 1e-12 && Math.abs(wb - Math.sqrt(108)) < 1e-12, 'math: coupled equal strings split into w and sqrt(w^2 + 2k)');
  ok(Math.abs(MATH.cents(1.5) - 701.955) < 1e-3 && Math.abs(MATH.cents(1.25) - 386.314) < 1e-3, 'math: cents of 3:2 and 5:4');
}
{
  // every see-it button has an action, and actions only call real page API methods
  const html = readFileSync(here + 'index.html', 'utf8');
  const sees = [...html.matchAll(/data-see="([^"]+)"/g)].map((m) => m[1]), figs = [...html.matchAll(/data-mfig="([^"]+)"/g)].map((m) => m[1]);
  const api = new Set(['loadInstrument', 'selectString', 'setFret', 'pluck', 'strike', 'bow', 'stopBow', 'harmonic', 'playNote', 'playChord', 'setTimeScale', 'setExaggeration', 'setField', 'setColormap', 'setTool', 'showAll', 'camera', 'pause']);
  const called = new Set(), S = new Proxy({}, { get: (t, k) => (...a) => { called.add(k); } });
  sees.forEach((k) => SEE[k] && SEE[k](S));
  const mainSrc = readFileSync(here + 'main.js', 'utf8');
  const missing = [...called].filter((k) => !api.has(k) || !new RegExp(`\\b${k}\\s*[:(]`).test(mainSrc));
  ok(sees.length === 12 && sees.every((k) => SEE[k]) && figs.length === 12 && figs.every((k) => FIGURES[k]), 'math: 12 sections, each with a figure and a "see it" action', `${sees.length} buttons, ${figs.length} figures`);
  ok(!missing.length, 'math: "see it" actions call only methods that window.__strings defines', missing.join(' '));
}
{
  // TeX: every equation of the #math article through lib/sci-math.js in jsdom
  let JSDOM = null;
  try { JSDOM = createRequire((process.env.NODE_PATH || '/nonexistent') + '/')('jsdom').JSDOM; } catch (e) { JSDOM = null; }
  const html = readFileSync(here + 'index.html', 'utf8');
  const art = html.slice(html.indexOf('<article id="math">'), html.indexOf('</article>', html.indexOf('<article id="math">')));
  const dec = (t) => t.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const eqs = [...art.matchAll(/data-tex="([^"]*)"/g)].map((m) => dec(m[1]));
  if (!JSDOM) console.log(`SKIP  math: TeX browser path (${eqs.length} equations): jsdom not on NODE_PATH`);
  else {
    const lib = here + '../../lib/sci-math.js';
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: pathToFileURL(here + 'index.html').href, runScripts: 'dangerously', resources: 'usable' });
    const w = dom.window;
    const src = readFileSync(lib, 'utf8').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(lib).href)).replace(/^export /gm, '');
    w.eval(`(function () { ${src}\n window.__sm = { typeset }; })();`);
    const els = eqs.map(() => w.document.body.appendChild(w.document.createElement('div')));
    const out = await Promise.race([Promise.all(eqs.map((tex, i) => w.__sm.typeset(els[i], tex, { display: true }))), new Promise((r) => setTimeout(() => r(null), 120000))]);
    const bad = out ? eqs.filter((e, i) => !out[i] || els[i].classList.contains('raw') || !els[i].querySelector('svg')) : eqs;
    ok(!!out && !bad.length && eqs.length >= 20, `math: every equation of the #math article typesets (${eqs.length})`, bad.slice(0, 2).join(' | '));
    w.close();
  }
}

export { ok };
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
