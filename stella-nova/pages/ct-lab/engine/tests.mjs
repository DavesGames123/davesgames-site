// tests.mjs - node tests for the CT engine. Run: node stella-nova/pages/ct-lab/engine/tests.mjs
// Optional: CT_PERF=1 prints CPU timings. The WebGPU part runs in Deno (gpu-tests.mjs) if deno exists.
import * as ct from './index.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (cond, name, info = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rnd = ct.mulberry32(42);
const randArr = (n) => Float32Array.from({ length: n }, () => rnd() - 0.5);
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const relErr = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));

// 1. adjointness <Ax, y> = <x, A^T y>
{
  const dims = { nx: 48, ny: 40, width: 2 };
  for (const kind of ['parallel', 'fan', 'fan-arc']) {
    const g = ct.fitGeometry(kind, dims, { nAngles: 37 });
    const x = { ...dims, data: randArr(48 * 40) };
    const y = { nAngles: g.nAngles, nDet: g.nDet, data: randArr(g.nAngles * g.nDet) };
    const e = relErr(dot(ct.forwardProject(x, g).data, y.data), dot(x.data, ct.backProject(y, g, dims).data));
    ok(e < 1e-5, `adjoint ${kind}`, `rel err ${e.toExponential(2)}`);
  }
  const vd = { nx: 20, ny: 18, nz: 16, width: 2 };
  const g = ct.fitGeometry('cone', vd, { nAngles: 13 });
  const x = { ...vd, data: randArr(20 * 18 * 16) };
  const y = { nAngles: g.nAngles, nu: g.nu, nv: g.nv, data: randArr(g.nAngles * g.nu * g.nv) };
  const e = relErr(dot(ct.forwardProjectCone(x, g).data, y.data), dot(x.data, ct.backProjectCone(y, g, vd).data));
  ok(e < 1e-5, 'adjoint cone', `rel err ${e.toExponential(2)}`);
}

// 2. Joseph agrees with exact (analytic) line integrals
{
  const ph = ct.phantom2D('shepp-logan-modified', 256);
  const g = ct.fitGeometry('parallel', ph.image, { nAngles: 30 });
  const a = ct.analyticSinogram(ph.shapes, g), j = ct.forwardProject(ph.image, g);
  const e = ct.rmse(a, j) / 0.69 / 2;
  ok(e < 0.01, 'joseph vs analytic sinogram', `rmse/peak ${e.toFixed(4)}`);
}

// 3. FBP of Shepp-Logan at 256 with 360 views, analytic data (no inverse crime)
const PSNR_MIN = 33.0; // measured 2026-10-08, see CONTRACT.md
let refPar;
{
  const ph = ct.phantom2D('shepp-logan-modified', 256);
  const g = ct.fitGeometry('parallel', ph.image, { nAngles: 360 });
  const sino = ct.analyticSinogram(ph.shapes, g);
  const r = {};
  for (const f of ct.FILTERS) { const rec = ct.fbp(sino, g, ph.image, { filter: f }); r[f] = ct.psnr(ph.image, rec); if (f === 'ram-lak') refPar = rec; }
  ok(r['ram-lak'] > PSNR_MIN, 'FBP shepp-logan 256x360 ram-lak', `PSNR ${r['ram-lak'].toFixed(2)} dB (min ${PSNR_MIN})`);
  console.log('     PSNR by filter: ' + ct.FILTERS.map((f) => `${f} ${r[f].toFixed(2)}`).join(', '));
  ok(ct.ssim(ph.image, refPar) > 0.5, 'FBP shepp-logan SSIM', ct.ssim(ph.image, refPar).toFixed(3));
}

// 4. fan FBP (flat, arc) and rebinning against the parallel reference
{
  const ph = ct.phantom2D('shepp-logan-modified', 256);
  const pr = ct.psnr(ph.image, refPar);
  for (const kind of ['fan', 'fan-arc']) {
    const g = ct.fitGeometry(kind, ph.image, { nAngles: 720, nDet: 512 });
    const sino = ct.analyticSinogram(ph.shapes, g);
    const rec = ct.fbp(sino, g, ph.image);
    const d = ct.rmse(refPar, rec) / 1.0;
    ok(d < 0.05, `fan FBP ${g.detector} vs parallel`, `rmse to parallel ${d.toFixed(4)}, PSNR ${ct.psnr(ph.image, rec).toFixed(2)} (parallel ${pr.toFixed(2)})`);
    if (kind === 'fan') {
      const rb = ct.rebinFanToParallel(sino, g, { nAngles: 360, nDet: 363, du: 2 * Math.SQRT2 / 362 });
      const rec2 = ct.fbp(rb.sino, rb.geom, ph.image);
      ok(ct.rmse(refPar, rec2) < 0.06, 'fan rebinned to parallel FBP', `rmse to parallel ${ct.rmse(refPar, rec2).toFixed(4)}`);
    }
  }
}

// 5. FDK central slice vs parallel FBP of the same slice
{
  const n = 64, vd = { nx: n, ny: n, nz: n, width: 2 };
  const vol = ct.phantom3D('shepp-logan', n).volume;
  const shapes = ct.SHEPP_LOGAN_3D;
  const g = ct.fitGeometry('cone', vd, { nAngles: 180 });
  const proj = ct.analyticConeProjections(shapes, g);
  const rec = ct.fdk(proj, g, vd);
  const mid = n / 2; // slices n/2-1 and n/2 straddle z = 0; average both
  const sl = (v) => { const o = new Float32Array(n * n); for (let i = 0; i < n * n; i++) o[i] = 0.5 * (v.data[(mid - 1) * n * n + i] + v.data[mid * n * n + i]); return { nx: n, ny: n, width: 2, data: o }; };
  const truth = sl(vol), fd = sl(rec);
  const gp = ct.fitGeometry('parallel', truth, { nAngles: 180 });
  const parRec = ct.fbp(ct.forwardProject(truth, gp), gp, truth);
  const eF = ct.rmse(truth, fd), eP = ct.rmse(truth, parRec), eFP = ct.rmse(parRec, fd);
  ok(eFP < 0.06, 'FDK central slice vs parallel FBP', `rmse FDK-vs-parallel ${eFP.toFixed(4)}; to truth: FDK ${eF.toFixed(4)}, parallel ${eP.toFixed(4)}`);
}

// 6. iterative residuals decrease monotonically
{
  const ph = ct.phantom2D('shepp-logan-modified', 64);
  const g = ct.fitGeometry('parallel', ph.image, { nAngles: 60 });
  const sino = ct.forwardProject(ph.image, g);
  for (const m of ['sirt', 'cgls', 'sart', 'art']) {
    const res = [];
    const img = ct.runIterative(m, sino, g, ph.image, { iterations: m === 'art' || m === 'sart' ? 8 : 30, onIter: (r) => { res.push(r.residual); } });
    let mono = true; for (let k = 1; k < res.length; k++) if (res[k] > res[k - 1] * (1 + 1e-6)) mono = false;
    ok(mono && res[res.length - 1] < 0.5 * res[0], `${m} residual decreases`, `${res[0].toFixed(3)} -> ${res[res.length - 1].toFixed(3)} in ${res.length} it, PSNR ${ct.psnr(ph.image, img).toFixed(2)}`);
  }
  const tv = ct.runIterative('sirt', sino, g, ph.image, { iterations: 30, tv: { weight: 0.01, steps: 3 } });
  ok(Number.isFinite(ct.psnr(ph.image, tv)), 'sirt + tv runs', `PSNR ${ct.psnr(ph.image, tv).toFixed(2)}`);
}

// 7. noise scales as 1/sqrt(dose)
{
  const dims = { nx: 128, ny: 128, width: 20 };
  const water = ct.rasterize2D([{ t: 'e', x: 0, y: 0, a: 8, b: 8, mat: 'water' }], 128, 20);
  const g = ct.fitGeometry('parallel', dims, { nAngles: 180 });
  const sd = (dose) => {
    const { sino } = ct.simulateScan(water, g, { dose, seed: 3 });
    const rec = ct.fbp(sino, g, dims);
    let s = 0, s2 = 0, c = 0;
    for (let y = 44; y < 84; y++) for (let x = 44; x < 84; x++) { const v = rec.data[y * 128 + x]; s += v; s2 += v * v; c++; }
    return Math.sqrt(s2 / c - (s / c) ** 2);
  };
  const lo = sd(1e4), hi = sd(1e6), ratio = lo / hi;
  ok(Math.abs(ratio - 10) < 1.5, 'noise ~ 1/sqrt(dose)', `sd(1e4)/sd(1e6) = ${ratio.toFixed(2)} (expect 10)`);
}

// 8. sinogram of a point is a sine curve
{
  const n = 128, dims = { nx: n, ny: n, width: 2 }, img = ct.emptyImage(dims);
  const ix = 96, iy = 40, px = 2 / n, x0 = (ix + 0.5) * px - 1, y0 = 1 - (iy + 0.5) * px;
  img.data[iy * n + ix] = 1;
  const g = ct.fitGeometry('parallel', dims, { nAngles: 90 });
  const s = ct.forwardProject(img, g);
  let worst = 0;
  for (let a = 0; a < g.nAngles; a++) {
    let best = 0, sum = 0, mom = 0;
    for (let i = 0; i < g.nDet; i++) { const v = s.data[a * g.nDet + i]; sum += v; mom += v * ct.detCoord(g, i); if (v > best) best = v; }
    const want = x0 * Math.cos(g.angles[a]) + y0 * Math.sin(g.angles[a]);
    worst = Math.max(worst, Math.abs(mom / sum - want) / g.du);
  }
  ok(worst < 0.5, 'point sinogram is s = x0 cos b + y0 sin b', `worst centroid error ${worst.toFixed(3)} detector bins`);
}

// 9. physics: beam hardening gives cupping in a water disc
{
  const dims = { nx: 128, ny: 128, width: 40 };
  const w = ct.rasterize2D([{ t: 'e', x: 0, y: 0, a: 16, b: 16, mat: 'water' }], 128, 40);
  const g = ct.fitGeometry('parallel', dims, { nAngles: 180 });
  const rec = ct.fbp(ct.simulateScan(w, g, { poly: true, kVp: 120 }).sino, g, dims);
  const c = rec.data[64 * 128 + 64], e = rec.data[64 * 128 + 64 + 46];
  ok(c < e * 0.97, 'polychromatic water disc shows cupping', `centre ${c.toFixed(4)} < edge ${e.toFixed(4)} /cm`);
  const sp = ct.spectrum(120);
  ok(sp.meanKeV > 50 && sp.meanKeV < 75, 'spectrum mean energy', `${sp.meanKeV.toFixed(1)} keV at 120 kVp`);
}

// 10. every phantom builds, finite and nonnegative
{
  let bad = [];
  for (const p of ct.PHANTOMS_2D) { const ph = ct.phantom2D(p.key, 64); if (!ph.image.data.every((v) => Number.isFinite(v)) || (!p.key.startsWith('shepp') && ph.image.data.some((v) => v < -1e-6))) bad.push(p.key); }
  for (const p of ct.PHANTOMS_3D) { const ph = ct.phantom3D(p.key, 24); if (!ph.volume.data.every((v) => Number.isFinite(v))) bad.push('3d ' + p.key); }
  ok(bad.length === 0, 'all phantoms build', bad.join(' '));
}

// 11. WGSL passes naga (Tint parenthesis rule is kept by hand, see wgsl.js)
{
  const naga = join(homedir(), '.cargo/bin/naga');
  const dir = mkdtempSync(join(tmpdir(), 'ct-wgsl-'));
  const W = await import('./wgsl.js');
  for (const k of ['FORWARD_2D', 'BACKPROJECT_2D', 'BACKPROJECT_CONE']) {
    const f = join(dir, k + '.wgsl'); writeFileSync(f, W[k]);
    if (!existsSync(naga)) { console.log(`skip naga ${k} (no ${naga})`); continue; }
    const r = spawnSync(naga, [f], { encoding: 'utf8' });
    ok(r.status === 0, `naga ${k}`, r.status === 0 ? '' : (r.stderr || r.stdout).slice(0, 400));
  }
}

// 12. WebGPU vs CPU (Deno)
{
  const here = dirname(fileURLToPath(import.meta.url));
  const deno = ['/opt/homebrew/bin/deno', '/usr/local/bin/deno'].find(existsSync);
  if (!deno || process.env.CT_NO_GPU) console.log('skip WebGPU check (no deno or CT_NO_GPU)');
  else {
    const r = spawnSync(deno, ['run', '-A', join(here, 'gpu-tests.mjs')], { encoding: 'utf8', timeout: 300000 });
    const out = (r.stdout || '') + (r.stderr || '');
    for (const line of out.trim().split('\n')) {
      if (line.startsWith('ok  ')) { pass++; console.log(line); }
      else if (line.startsWith('FAIL')) { fail++; console.log(line); }
      else if (line.trim()) console.log('     ' + line);
    }
    if (r.status !== 0 && !/^ok|^FAIL/m.test(out)) { fail++; console.log('FAIL deno gpu-tests exit ' + r.status); }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
