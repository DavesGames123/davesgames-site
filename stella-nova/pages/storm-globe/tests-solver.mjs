// ============================================================================
//  STORM GLOBE  ·  tests-solver.mjs  ·  GPU tests of shaders/solver.wgsl
// ----------------------------------------------------------------------------
//  tests.mjs imports this file when navigator.gpu exists (Deno). Each test
//  runs the real WGSL on the GPU and reads the state back.
//    projection   one step makes the discrete divergence zero (mass is
//                 conserved cell by cell) and keeps the dye mass
//    TC2          Williamson et al. (1992) test case 2 style: solid-body
//                 zonal flow in balance with Coriolis stays steady 5 days;
//                 the same flow over the poles (alpha = 45 deg, no Coriolis)
//                 tests the cross-pole advection and the polar filter
//    beta drift   one vortex at 20N on a resting planet drifts north-west
//                 (the beta effect), at about 1-4 m/s
//
//  grep -n targets: "async function runSolverTests", "function vortexState"
// ============================================================================
import { createSolver, gridGeom, divergence, dyeMass, R_EARTH } from './solver.js';

const D = Math.PI / 180, DAY = 86400;

function zeroFrames(fnx = 4, fny = 3) { const z = new Float32Array(fnx * fny); return { u: z, v: z, p: z.map(() => 1010) }; }
async function make(device, nx, ny, set) {
  const s = await createSolver(device, { nx, ny, fnx: 4, fny: 3 });
  const z = zeroFrames(); s.setFrames(z, z); s.setStorms([]);
  s.set({ nudge: 0, dyeRelax: 0, ...set });
  return s;
}
// face values of a 3D velocity field w(x) (m/s)
function fieldState(nx, ny, w, dye = null) {
  const g = gridGeom(nx, ny), n = nx * ny, u = new Float32Array(n), v = new Float32Array(n), d = new Float32Array(n);
  const P = (lat, lon) => [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const E = lon => [-Math.sin(lon), Math.cos(lon), 0], N = (lat, lon) => [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = j * nx + i;
    const lu = (i + 1) * g.dl, la = g.latC(j);
    u[c] = dot(w(P(la, lu)), E(lu));
    if (j < ny - 1) { const lv = (i + 0.5) * g.dl, lf = g.latF(j); v[c] = dot(w(P(lf, lv)), N(lf, lv)); }
    if (dye) d[c] = dye(la, (i + 0.5) * g.dl);
  }
  return { u, v, dye: d };
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// area-weighted relative L2 difference of the u and v faces
function relL2(a, b, nx, ny) {
  const g = gridGeom(nx, ny); let num = 0, den = 0;
  for (let j = 0; j < ny; j++) {
    const c = Math.cos(g.latC(j));
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      num += c * ((a.u[k] - b.u[k]) ** 2 + (a.v[k] - b.v[k]) ** 2);
      den += c * (b.u[k] ** 2 + b.v[k] ** 2);
    }
  }
  return Math.sqrt(num / den);
}
// relative vorticity at cell centres (1/s), as solver.wgsl "fn diag"
function vorticity(st, nx, ny) {
  const g = gridGeom(nx, ny), z = new Float32Array(nx * ny);
  const w = (i, j) => { i = ((i % nx) + nx) % nx; j = Math.max(0, Math.min(ny - 1, j));
    const vS = jj => (jj < 0 || jj >= ny - 1) ? 0 : st.v[jj * nx + i];
    return [0.5 * (st.u[j * nx + i] + st.u[j * nx + (i + nx - 1) % nx]), 0.5 * (vS(j) + vS(j - 1))]; };
  for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx; i++) {
    const dv = (w(i + 1, j)[1] - w(i - 1, j)[1]) / (2 * g.dl);
    const du = (w(i, j + 1)[0] * Math.cos(g.latC(j + 1)) - w(i, j - 1)[0] * Math.cos(g.latC(j - 1))) / (2 * g.dp);
    z[j * nx + i] = (dv - du) / (R_EARTH * Math.cos(g.latC(j)));
  }
  return z;
}
// vortex centre: the vorticity-weighted centroid (3D) of cells above half
// of the peak, within 8 degrees of the peak
function vortexCentre(st, nx, ny) {
  const g = gridGeom(nx, ny), z = vorticity(st, nx, ny);
  let k = 0; for (let i = 1; i < z.length; i++) if (z[i] > z[k]) k = i;
  const lat0 = g.latC(Math.floor(k / nx)), lon0 = (k % nx + 0.5) * g.dl;
  const p0 = [Math.cos(lat0) * Math.cos(lon0), Math.cos(lat0) * Math.sin(lon0), Math.sin(lat0)];
  let s = [0, 0, 0], ws = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const zz = z[j * nx + i]; if (zz < 0.5 * z[k]) continue;
    const la = g.latC(j), lo = (i + 0.5) * g.dl, p = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
    if (p[0] * p0[0] + p[1] * p0[1] + p[2] * p0[2] < Math.cos(8 * D)) continue;
    const ww = zz * Math.cos(la); s = s.map((v, q) => v + ww * p[q]); ws += ww;
  }
  const n = Math.hypot(...s);
  return { lat: Math.asin(s[2] / n) / D, lon: Math.atan2(s[1], s[0]) / D, peak: z[k] };
}
export function vortexState(nx, ny, lat0, lon0, vm, rm) {
  const c = [Math.cos(lat0 * D) * Math.cos(lon0 * D), Math.cos(lat0 * D) * Math.sin(lon0 * D), Math.sin(lat0 * D)];
  return fieldState(nx, ny, x => {
    const r = Math.acos(Math.max(-1, Math.min(1, x[0] * c[0] + x[1] * c[1] + x[2] * c[2]))) * R_EARTH;
    if (r < 1) return [0, 0, 0];
    const V = vm * (r / rm) * Math.exp(1 - r / rm);          // b = 1 profile
    const t = cross(c, x), tl = Math.hypot(...t);
    return t.map(q => q / tl * V);
  });
}

export async function runSolverTests({ section, check, near }) {
  const ad = await navigator.gpu.requestAdapter();
  const device = await ad.requestDevice();
  let err = null;
  device.addEventListener && device.addEventListener('uncapturederror', e => { err = e.error.message; });

  // ── projection and mass ────────────────────────────────────────────────
  section('Solver: projection and mass (GPU, 256 x 128)');
  {
    const nx = 256, ny = 128;
    const s = await make(device, nx, ny, { coriolis: 0, dt: 1, massFix: 1, filterOn: 1 });
    // a divergent field: rotation plus a source-sink pair, plus a dye blob
    const st = fieldState(nx, ny, x => {
      const a = cross([0, 0, 1], x).map(q => 20 * q);
      const g = [-x[0] * x[2], -x[1] * x[2], 1 - x[2] * x[2]].map(q => 15 * q * Math.sin(3 * Math.atan2(x[1], x[0])));
      return a.map((q, i) => q + g[i]);
    }, (la, lo) => Math.exp(-((la - 0.3) ** 2 + (lo - 2) ** 2) * 6));
    s.setState(st);
    const d0 = divergence(st, nx, ny);
    s.step(1);
    const a = await s.readState(), d1 = divergence(a, nx, ny);
    // float32 rounding of u (~35 m/s) over the polar rows (cos ~ 0.012)
    // sets the floor: 35 * 6e-8 / (R dl cos) ~ 1e-9 1/s
    check('one step: RMS div drops by > 1e4, max to the float32 floor (< 2e-9)', d1.rms < d0.rms * 1e-4 && d1.max < 2e-9, `RMS ${d0.rms.toExponential(2)} -> ${d1.rms.toExponential(2)}, max ${d0.max.toExponential(2)} -> ${d1.max.toExponential(2)} 1/s`);
    // 150 steps of strong advection (dt 1200 s): dye mass with and without the fixer
    const flow = fieldState(nx, ny, x => cross([0.3, 0.2, 0.93], x).map(q => 35 * q), (la, lo) => 0.5 + 0.5 * Math.sin(5 * lo) * Math.cos(4 * la));
    s.set({ dt: 1200 }); s.setState(flow);
    const m0 = dyeMass(flow, nx, ny);
    await s.run(150);
    const b = await s.readState(), m1 = dyeMass(b, nx, ny), db = divergence(b, nx, ny);
    s.set({ massFix: 0 }); s.setState(flow); await s.run(150);
    const c = await s.readState(), m2 = dyeMass(c, nx, ny);
    check('dye mass with the fixer: |dM/M| < 1e-5 after 150 steps', Math.abs(m1 / m0 - 1) < 1e-5, `${(m1 / m0 - 1).toExponential(2)}; without the fixer ${(m2 / m0 - 1).toExponential(2)}`);
    check('divergence stays at rounding level (RMS < 1e-10 1/s)', db.rms < 1e-10, db.rms.toExponential(2));
    s.destroy();
  }

  // ── TC2 ────────────────────────────────────────────────────────────────
  section('Solver: Williamson TC2 style solid-body flow, 5 days (GPU, 256 x 128, dt 900 s)');
  {
    const nx = 256, ny = 128, u0 = 2 * Math.PI * R_EARTH / (12 * DAY);
    const s = await make(device, nx, ny, { coriolis: 1, dt: 900, massFix: 0, filterOn: 1 });
    const st = fieldState(nx, ny, x => cross([0, 0, 1], x).map(q => u0 * q));
    s.setState(st); await s.run(480);
    const a = await s.readState();
    const e = relL2(a, st, nx, ny);
    let vmax = 0; for (const q of a.v) vmax = Math.max(vmax, Math.abs(q));
    check('alpha 0, Coriolis on: relative L2 error < 1% after 5 days', e < 0.01, `${(e * 100).toFixed(3)} %, max |v| ${vmax.toFixed(3)} m/s, u0 ${u0.toFixed(2)} m/s`);
    const ax = [Math.sin(45 * D), 0, Math.cos(45 * D)];
    const s2 = await make(device, nx, ny, { coriolis: 0, dt: 900, massFix: 0, filterOn: 1 });
    const st2 = fieldState(nx, ny, x => cross(ax, x).map(q => u0 * q));
    s2.setState(st2); await s2.run(480);
    const b = await s2.readState(), e2 = relL2(b, st2, nx, ny);
    check('alpha 45 deg over the poles, no Coriolis: relative L2 error < 3%', e2 < 0.03, `${(e2 * 100).toFixed(3)} %`);
    s2.set({ filterOn: 0 }); s2.setState(st2); await s2.run(480);
    const b2 = await s2.readState(), e3 = relL2(b2, st2, nx, ny);
    console.log(`        (the same with the polar filter off: ${(e3 * 100).toFixed(3)} %)`);
    s.destroy(); s2.destroy();
  }

  // ── beta drift ─────────────────────────────────────────────────────────
  section('Solver: beta drift of one vortex at 20N 140E, 72 h (GPU, 512 x 256, dt 600 s)');
  {
    const nx = 512, ny = 256;
    const s = await make(device, nx, ny, { coriolis: 1, dt: 600, massFix: 0, filterOn: 1 });
    const st = vortexState(nx, ny, 20, 140, 35, 250e3);
    s.setState(st); s.step(1);
    const c0 = vortexCentre(await s.readState(), nx, ny);
    await s.run(431);
    const c1 = vortexCentre(await s.readState(), nx, ny);
    const dN = (c1.lat - c0.lat) * D * R_EARTH, dE = (c1.lon - c0.lon) * D * R_EARTH * Math.cos(20 * D);
    const spd = Math.hypot(dN, dE) / (72 * 3600), hdg = (Math.atan2(dE, dN) / D + 360) % 360;
    check('vortex moves north-west (heading 280..350 deg)', hdg > 280 && hdg < 350, `from ${c0.lat.toFixed(2)}N ${c0.lon.toFixed(2)}E to ${c1.lat.toFixed(2)}N ${c1.lon.toFixed(2)}E, heading ${hdg.toFixed(0)} deg`);
    check('drift speed 0.5..5 m/s', spd > 0.5 && spd < 5, `${spd.toFixed(2)} m/s`);
    check('vortex survives (peak vorticity > 40% of start)', c1.peak > 0.4 * c0.peak, `${(c1.peak / c0.peak * 100).toFixed(0)} %`);
    // control: no Coriolis -> no beta effect -> almost no drift
    const s2 = await make(device, nx, ny, { coriolis: 0, dt: 600, massFix: 0, filterOn: 1 });
    s2.setState(st); s2.step(1);
    const k0 = vortexCentre(await s2.readState(), nx, ny); await s2.run(431);
    const k1 = vortexCentre(await s2.readState(), nx, ny);
    const drift0 = Math.hypot((k1.lat - k0.lat) * D, (k1.lon - k0.lon) * D * Math.cos(20 * D)) * R_EARTH / (72 * 3600);
    check('control without Coriolis drifts < 1/3 as fast', drift0 < spd / 3, `${drift0.toFixed(2)} m/s`);
    console.log(`        (peak vorticity kept: ${(c1.peak / c0.peak * 100).toFixed(0)} % with beta, ${(k1.peak / k0.peak * 100).toFixed(0)} % in the control)`);
    s.destroy(); s2.destroy();
  }
  check('no GPU validation errors', !err, err || '');
  device.destroy();
}
