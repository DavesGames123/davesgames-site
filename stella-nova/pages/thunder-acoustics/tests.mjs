// ============================================================================
//  THUNDER ACOUSTICS  ·  tests.mjs — node tests
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/thunder-acoustics/tests.mjs
//  Each check prints its numbers. The exit code is 1 if a check fails.
//    1  Few: R0 and f_m at 5e5 J/m; sound speed at 20 C
//    2  ISO 9613-1 absorption against the standard's table values
//    3  the N-wave kernel spectrum peaks near f_m
//    4  tortuous channel: same seed same channel, reaches the ground,
//       mean change in direction near sigma
//    5  FDTD: the pulse arrives at r / c; energy holds in a closed box
//    6  FDTD: rigid ground gives an image arrival at the image delay
//    7  FDTD: the standard atmosphere tilts the front up (c falls with z)
//    8  synthesis: calibration P_REF, first arrival r_min / c, 1/r far
//    9  synthesis: side-on segment louder and shorter than end-on
//   10  synthesis: a ridge lowers the peak and adds path; absorption
//       takes high frequencies first
//   11  every preset: finite signal, sane arrival times, fast enough
//   12  main.js boots and runs frames in a DOM stub, every tool works
// ============================================================================
import * as C from './channel.js';
import * as SC from './scene.js';
import * as F from './fdtd.js';
import * as T from './thunder.js';
import { fft, nextPow2 } from './fft.js';

let fails = 0;
function check(name, ok, info) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 1
{
  const R0 = C.fewRadius(5e5), fm = C.fewFrequency(5e5, 343), c20 = C.soundSpeed(20);
  check('1 Few R0, f_m and c(20 C)', near(R0, 2.22, 0.01) && near(fm, 97.3, 0.5) && near(c20, 343.3, 0.3), `R0 ${R0.toFixed(3)} m, f_m ${fm.toFixed(1)} Hz, c ${c20.toFixed(2)} m/s`);
}
// 2  ISO 9613-2 table 2 (20 C, 70 % RH): 250 Hz 1.1, 1 kHz 5.0, 4 kHz 22.9 dB/km
{
  const a = f => SC.isoAlpha(f, 20, 70) * 1000;
  const v = [a(250), a(1000), a(4000)];
  check('2 ISO 9613-1 absorption', near(v[0], 1.1, 0.1) && near(v[1], 5.0, 0.2) && near(v[2], 22.9, 0.8), v.map(x => x.toFixed(3)).join(', ') + ' dB/km');
}
// 3
{
  const fm = 97, fs = 22050, k = T.nKernel(fm, 0, fs, 20, 50).k;
  const n = nextPow2(k.length * 16), re = new Float64Array(n), im = new Float64Array(n);
  re.set(k); fft(re, im);
  let best = 0, bf = 0;
  for (let i = 1; i < n / 2; i++) { const f = i * fs / n; if (f < 10 || f > 1000) continue; const m = Math.hypot(re[i], im[i]); if (m > best) { best = m; bf = f; } }
  check('3 N-wave spectrum peak near f_m', near(bf, fm, 0.15 * fm), `peak ${bf.toFixed(1)} Hz for f_m ${fm}`);
}
// 4
{
  const st = [[5000, 4500], [6000, 2000], [5500, 0]];
  const a = C.tortuous(st, { seed: 9, sigmaDeg: 16 }), b = C.tortuous(st, { seed: 9, sigmaDeg: 16 });
  const same = a.segs.length === b.segs.length && a.segs.every((s, i) => s.x1 === b.segs[i].x1 && s.z1 === b.segs[i].z1);
  const main = a.segs.filter(s => s.order === 0);
  let sum = 0, n = 0;
  for (let i = 1; i < main.length; i++) {
    const h0 = Math.atan2(main[i - 1].z1 - main[i - 1].z0, main[i - 1].x1 - main[i - 1].x0), h1 = Math.atan2(main[i].z1 - main[i].z0, main[i].x1 - main[i].x0);
    let d = Math.abs(h1 - h0); if (d > Math.PI) d = 2 * Math.PI - d; sum += d; n++;
  }
  const mean = sum / n * 180 / Math.PI;
  check('4 tortuous channel', same && a.end[1] === 0 && mean > 12 && mean < 26 && a.segs.some(s => s.order > 0), `segs ${a.segs.length}, main ${(a.mainLength / 1000).toFixed(2)} km, end z ${a.end[1]}, mean turn ${mean.toFixed(1)} deg`);
}
// 5
{
  const sc = SC.createScene(); sc.atm.profile = 'isothermal';
  const g = F.createGrid(sc, 25);
  F.inject(g, [{ x0: 8000, z0: 3000, x1: 8000.1, z1: 3000, w: 1 }], 1);
  const c = SC.cAt(sc, 0), r = 2000;
  let tp = 0, pk = 0;
  while (g.t < 9) { F.step(g); const v = F.probe(g, 8000 + r, 3000); if (v > pk) { pk = v; tp = g.t; } }
  check('5a pulse arrives at r / c', near(tp, r / c, 0.03 * r / c), `t ${tp.toFixed(3)} s, r/c ${(r / c).toFixed(3)} s`);
  // closed box: no sponge
  const g2 = F.createGrid(sc, 25); g2.dampP.fill(1);
  F.inject(g2, [{ x0: 8000, z0: 3000, x1: 8200, z1: 3200, w: 1 }], 1);
  // The energy sum mixes p(n) with v(n-1/2), so it swings a few percent
  // over a step for a sharp pulse; check that it does not drift.
  for (let i = 0; i < 50; i++) F.step(g2);
  const E0 = F.energy(g2);
  for (let i = 0; i < 400; i++) F.step(g2);
  const E1 = F.energy(g2);
  check('5b energy holds in a closed box', near(E1 / E0, 1, 0.03), `E(450)/E(50) ${(E1 / E0).toFixed(4)}`);
}
// 6  rigid ground vs a control run whose bottom rows absorb (the 2D
//    pulse has a long wake, so compare the two traces, not raw levels)
{
  const sc = SC.createScene(); sc.atm.profile = 'isothermal';
  const zs = 1800, r = 1500;
  const run = absorbBottom => {
    const g = F.createGrid(sc, 25);
    if (absorbBottom) for (let k = 0; k < F.SPONGE; k++) for (let i = 0; i < g.nx; i++) { const d = (F.SPONGE - k) / F.SPONGE; g.dampP[i + k * g.nx] = Math.min(g.dampP[i + k * g.nx], 1 - 0.22 * d * d); }
    F.inject(g, [{ x0: 8000, z0: zs, x1: 8000.1, z1: zs, w: 1 }], 1);
    const tr = [];
    while (g.t < 13) { F.step(g); tr.push([g.t, F.probe(g, 8000 + r, zs)]); }
    return tr;
  };
  const A = run(false), B = run(true), c = SC.cAt(sc, 0);
  const tImg = Math.hypot(r, 2 * zs) / c;
  const diff = A.map(([t, v], i) => [t, Math.abs(v - B[i][1])]);
  const win = Math.max(...diff.filter(([t]) => Math.abs(t - tImg) < 0.3).map(v => v[1]));
  const pre = Math.max(...diff.filter(([t]) => t < tImg - 0.8).map(v => v[1]));
  const onset = (diff.find(([t, v]) => v > 0.25 * win) || [NaN])[0];
  check('6 rigid ground image arrival', win > 5 * pre && Math.abs(onset - tImg) < 0.3, `reflection starts at ${onset.toFixed(2)} s (image path ${tImg.toFixed(2)} s): ${win.toExponential(2)} vs before ${pre.toExponential(2)}`);
}
// 7
{
  const sc = SC.createScene(); sc.atm.profile = 'superadiabatic';
  const g = F.createGrid(sc, 25);
  F.inject(g, [{ x0: 8000, z0: 3000, x1: 8000.1, z1: 3000, w: 1 }], 1);
  const ta = { lo: 0, hi: 0 }, pk = { lo: 0, hi: 0 };
  while (g.t < 9) { F.step(g); for (const [k, z] of [['lo', 1000], ['hi', 5000]]) { const v = F.probe(g, 8000, z); if (v > pk[k]) { pk[k] = v; ta[k] = g.t; } } }
  check('7 lower air is faster: front from below arrives first', ta.lo < ta.hi, `2 km down ${ta.lo.toFixed(3)} s, 2 km up ${ta.hi.toFixed(3)} s`);
}
// 8
{
  const sc = { W: 8000, H: 6000, terrain: new Float32Array(801), buildings: [], atm: { profile: 'isothermal', T0: 20, RH: 50 } };
  const seg = [{ x0: 0, z0: 0, x1: 0, z1: 2000, w: 1, order: 0 }];
  const raw = T.synthesize({ segs: seg, El: T.E_REF, sc, mic: [1000, 1000] });
  const c = SC.cAt(sc, 1000);
  const small = [{ x0: 0, z0: 3000, x1: 0, z1: 3010, w: 1, order: 0 }];
  const p1 = T.synthesize({ segs: small, El: T.E_REF, sc, mic: [1000, 3000] }).peak, p2 = T.synthesize({ segs: small, El: T.E_REF, sc, mic: [2000, 3000] }).peak;
  check('8a calibration near P_REF', raw.peak > 0.7 * T.P_REF && raw.peak < 1.3 * T.P_REF, `peak ${raw.peak.toFixed(2)} Pa (P_REF ${T.P_REF}, with absorption and scatter)`);
  check('8b first arrival = r_min / c', near(raw.tFirst, 1000 / c, 0.01), `t ${raw.tFirst.toFixed(4)} s, r/c ${(1000 / c).toFixed(4)} s`);
  // absorption rounds the shock a little more at 2 km, so the ratio is a bit above 2
  check('8c short source falls as 1/r', p1 / p2 > 1.9 && p1 / p2 < 2.35, `p(1 km)/p(2 km) ${(p1 / p2).toFixed(3)}`);
}
// 9
{
  const sc = { W: 8000, H: 6000, terrain: new Float32Array(801), buildings: [], atm: { profile: 'isothermal', T0: 20, RH: 50 } };
  const side = T.synthesize({ segs: [{ x0: 4000, z0: 2500, x1: 4000, z1: 3500, w: 1, order: 0 }], El: 5e5, sc, mic: [6000, 3000], dur: 10 });
  const end = T.synthesize({ segs: [{ x0: 3000, z0: 3000, x1: 4000, z1: 3000, w: 1, order: 0 }], El: 5e5, sc, mic: [6000, 3000], dur: 10 });
  check('9 side-on clap vs end-on rumble', side.peak > 4 * end.peak && (end.tLast - end.tFirst) > 5 * (side.tLast - side.tFirst + 1e-3), `peak ${side.peak.toFixed(3)} vs ${end.peak.toFixed(3)} Pa, spread ${(side.tLast - side.tFirst).toFixed(3)} vs ${(end.tLast - end.tFirst).toFixed(3)} s`);
}
// 10
{
  const mk = h => { const sc = SC.createScene(); sc.atm.profile = 'isothermal'; if (h) SC.hill(sc, 8000, h, 600); SC.settle(sc); return sc; };
  const segs = [{ x0: 5000, z0: 0, x1: 5000, z1: 1500, w: 1, order: 0 }];
  const a = T.synthesize({ segs, El: 5e5, sc: mk(0), mic: [11000, 2] }), b = T.synthesize({ segs, El: 5e5, sc: mk(700), mic: [11000, 2] });
  check('10a ridge: lower peak, later arrival', b.peak < 0.6 * a.peak && b.tFirst > a.tFirst && b.nShadow > 0, `peak ${a.peak.toFixed(3)} -> ${b.peak.toFixed(3)} Pa, first ${a.tFirst.toFixed(3)} -> ${b.tFirst.toFixed(3)} s, shadowed ${b.nShadow}/${b.nPieces}`);
  const hf = (k) => { const n = nextPow2(k.length * 4), re = new Float64Array(n), im = new Float64Array(n); re.set(k); fft(re, im); let lo = 0, hi = 0; for (let i = 1; i < n / 2; i++) { const f = i * 22050 / n, m = re[i] * re[i] + im[i] * im[i]; if (f > 60 && f < 140) lo += m; if (f > 2000 && f < 6000) hi += m; } return hi / lo; };
  const r1 = hf(T.nKernel(97, 300, 22050, 20, 50).k), r2 = hf(T.nKernel(97, 15000, 22050, 20, 50).k);
  check('10b absorption takes the crack first', r2 < r1 * 0.05, `HF/LF energy at 0.3 km ${r1.toExponential(2)}, at 15 km ${r2.toExponential(2)}`);
}
// 11
{
  let ok = true; const info = [];
  for (const key of Object.keys(SC.PRESETS)) {
    const sc = SC.createScene(), P = SC.applyPreset(sc, key);
    const ch = C.tortuous(P.stroke, { seed: P.seed, ground: x => SC.surfaceAt(sc, x) });
    const t0 = performance.now();
    const r = T.synthesize({ segs: ch.segs, El: 5e5, sc, mic: [P.mic[0], SC.surfaceAt(sc, P.mic[0]) + P.mic[1]] });
    const ms = performance.now() - t0;
    let finite = true; for (let i = 0; i < r.signal.length; i += 7) if (!Number.isFinite(r.signal[i])) { finite = false; break; }
    const good = finite && r.peak > 0 && r.tFirst > 1 && r.tLast > r.tFirst && r.dur < 61 && ms < 1500;
    ok = ok && good; info.push(`${key} ${r.peak.toFixed(2)} Pa ${r.tFirst.toFixed(1)}-${r.tLast.toFixed(1)} s ${ms.toFixed(0)} ms`);
  }
  check('11 presets synthesise', ok, info.join(' | '));
}
// 12  boot main.js in a DOM stub
{
  const els = new Map();
  const ctxStub = new Proxy({}, { get: (o, k) => k in o ? o[k] : (k === 'createImageData' ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) : () => ({ data: new Uint8ClampedArray(4) })), set: (o, k, v) => { o[k] = v; return true; } });
  const classList = () => { const s = new Set(); return { add: c => s.add(c), remove: c => s.delete(c), toggle: (c, on) => { const v = on === undefined ? !s.has(c) : !!on; v ? s.add(c) : s.delete(c); return v; }, contains: c => s.has(c) }; };
  const mkEl = (id) => {
    const kids = [];
    const e = {
      id, hidden: false, style: {}, dataset: {}, textContent: '', innerHTML: '', className: '', value: '0', classList: classList(), width: 300, height: 150, clientWidth: 280, clientHeight: 120,
      children: kids, appendChild: c => { kids.push(c); return c; }, setAttribute() {}, getAttribute: () => null, addEventListener(t, f) { (e._l ||= {})[t] = f; }, setPointerCapture() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800, bottom: 44, right: 1280 }), getContext: () => ctxStub, closest: () => null, click() { e.onclick && e.onclick(); },
      querySelector: (q) => { const c = mkEl(q); if (q === 'input') e._inp = c; return c; },
    };
    return e;
  };
  const get = id => { if (!els.has(id)) els.set(id, mkEl(id)); return els.get(id); };
  const qsa = new Map();
  globalThis.window = globalThis; globalThis.innerWidth = 1280; globalThis.innerHeight = 800; globalThis.devicePixelRatio = 1;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  const winL = {};
  globalThis.addEventListener = (t, f) => { winL[t] = f; };
  let raf = null; globalThis.requestAnimationFrame = f => { raf = f; return 1; };
  globalThis.document = {
    getElementById: get, documentElement: mkEl('html'), body: mkEl('body'),
    querySelector: q => get(q), querySelectorAll: q => { if (!qsa.has(q)) { const kind = q.split(' ')[0]; const list = []; const n = { '#views': ['p', 'e'], '#grids': ['25', '16', '10'], '#speeds': ['1', '2', '4'], '#togs': ['auto', 'front', 'grid', 'norm'], '#tools': ['channel', 'mic', 'raise', 'lower', 'building'] }[kind] || []; for (const v of n) { const b = mkEl(kind.slice(1) + v); const key = { '#views': 'view', '#grids': 'dx', '#speeds': 'speed', '#togs': 'tog', '#tools': 'tool' }[kind]; b.dataset[key] = v; list.push(b); } qsa.set(q, list); } return qsa.get(q); },
    createElement: (t) => mkEl(t),
  };
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctxStub; } };
  let err = null, frames = 0;
  try {
    await import('./main.js');
    let t = 0;
    const run = n => { for (let i = 0; i < n; i++) { const f = raf; raf = null; t += 16.7; f(t); frames++; } };
    run(5);
    get('strike').onclick(); run(30);
    const fig = get('fig');
    const ev = (x, y) => ({ clientX: x, clientY: y, pointerId: 1 });
    for (const tool of ['channel', 'raise', 'lower', 'building', 'mic']) {
      document.querySelectorAll('#tools button').find(b => b.dataset.tool === tool).onclick();
      fig._l.pointerdown(ev(600, 250)); fig._l.pointermove(ev(640, 330)); fig._l.pointermove(ev(700, 420)); fig._l.pointermove(ev(720, 470)); fig._l.pointerup(ev(720, 470));
      run(3);
    }
    for (const b of document.querySelectorAll('#grids button')) { b.onclick(); run(2); }
    document.querySelectorAll('#views button')[1].onclick(); run(3);
    get('newChannel').onclick(); run(3);
    const sv = window.snSaver.enter({ seed: 3 }); run(5); window.snSaver.exit();
    if (!sv || !sv.canvas) throw new Error('saver gave no canvas');
  } catch (e) { err = e; }
  check('12 main.js boots and every tool runs', !err && frames > 50, err ? String(err.stack || err).split('\n').slice(0, 3).join(' / ') : `${frames} frames`);
}

console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
