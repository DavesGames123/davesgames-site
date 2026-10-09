// gpu-tests.mjs - WebGPU checks for the CT engine. Run: deno run -A gpu-tests.mjs
// tests.mjs runs this file when deno exists. Prints "ok"/"FAIL" lines and timings.
import * as ct from './index.js';

const adapter = await navigator.gpu?.requestAdapter();
if (!adapter) { console.log('skip: no WebGPU adapter'); Deno.exit(0); }
const device = await adapter.requestDevice({
  requiredLimits: { maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize },
});
const errs = [];
device.addEventListener?.('uncapturederror', (e) => errs.push(e.error?.message));
const gpu = ct.createGpuCT(device);
const ok = (c, n, i = '') => console.log(`${c ? 'ok  ' : 'FAIL'} ${n}${i ? '  ' + i : ''}`);
const now = () => performance.now();
const relMax = (a, b) => { let m = 0, s = 0; for (let i = 0; i < a.length; i++) { m = Math.max(m, Math.abs(a[i] - b[i])); s = Math.max(s, Math.abs(a[i])); } return m / s; };

for (const kind of ['parallel', 'fan', 'fan-arc']) {
  const ph = ct.phantom2D('shepp-logan-modified', 128);
  const g = ct.fitGeometry(kind, ph.image, { nAngles: 90 });
  const c = ct.forwardProject(ph.image, g), gg = await gpu.forward2D(ph.image, g);
  const e = relMax(c.data, gg.data);
  ok(e < 1e-4, `gpu forward2D ${kind} matches CPU`, `max rel err ${e.toExponential(2)}`);
  const q = ct.filterSinogram(c, g);
  const w = ct.angleWeights(g);
  if (g.type === 'parallel' && ct.coverage(g) > 1.5 * Math.PI) for (let k = 0; k < w.length; k++) w[k] *= 0.5;
  const cb = ct.fbpBackProject(q, g, ph.image, { weights: w }), gb = await gpu.backProject2D(q, g, ph.image, { fbp: true });
  const e2 = relMax(cb.data, gb.data);
  ok(e2 < 1e-3, `gpu backProject2D ${kind} (fbp) matches CPU`, `max rel err ${e2.toExponential(2)}`);
}
{
  const n = 48, vd = { nx: n, ny: n, nz: n, width: 2 };
  const g = ct.fitGeometry('cone', vd, { nAngles: 60 });
  const proj = ct.analyticConeProjections(ct.SHEPP_LOGAN_3D, g);
  const q = ct.fdkFilter(proj, g);
  const cv = ct.coneBackProjectFDK(q, g, vd, { weights: ct.angleWeights(g) });
  const gv = await gpu.backProjectCone(q, g, vd);
  const e = relMax(cv.data, gv.data);
  ok(e < 1e-3, 'gpu backProjectCone (FDK) matches CPU', `max rel err ${e.toExponential(2)}`);
}

// timings (GPU includes upload and read back)
for (const n of [256, 512]) {
  const ph = ct.phantom2D('shepp-logan-modified', n);
  const g = ct.fitGeometry('parallel', ph.image, { nAngles: 360 });
  await gpu.forward2D(ph.image, g); // warm up
  let t = now(); const s = await gpu.forward2D(ph.image, g); const tf = now() - t;
  const q = ct.filterSinogram(s, g);
  await gpu.backProject2D(q, g, ph.image, { fbp: true });
  t = now(); await gpu.backProject2D(q, g, ph.image, { fbp: true }); const tb = now() - t;
  console.log(`time gpu ${n}^2 x 360 views: forward ${tf.toFixed(1)} ms, fbp back-projection ${tb.toFixed(1)} ms`);
}
{
  const n = 256, vd = { nx: n, ny: n, nz: n, width: 2 };
  const g = ct.fitGeometry('cone', vd, { nAngles: 360, nu: 384, nv: 384 });
  const q = { nAngles: g.nAngles, nu: g.nu, nv: g.nv, data: new Float32Array(g.nAngles * g.nu * g.nv).fill(0.01) };
  await gpu.backProjectCone(q, g, { nx: 32, ny: 32, nz: 32, width: 2 });
  const t = now(); await gpu.backProjectCone(q, g, vd); 
  console.log(`time gpu FDK back-projection 256^3 from 360 x 384 x 384: ${(now() - t).toFixed(0)} ms`);
}
ok(errs.length === 0, 'no WebGPU validation errors', errs.join('; '));
gpu.destroy();
device.destroy();
