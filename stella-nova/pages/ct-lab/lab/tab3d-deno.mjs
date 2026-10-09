// lab/tab3d-deno.mjs - Deno: the 3D tab on a real WebGPU device. Runs scan -> FDK -> look, then leave(), and
// checks that the device is lost with reason 'destroyed'.
// Run: deno run -A lab/tab3d-deno.mjs (lab/tests.mjs runs it when deno exists).
const L = new URL('../', import.meta.url).href;
const { createTab3D } = await import(L + 'lab/tab3d.js');
if (!navigator.gpu || !(await navigator.gpu.requestAdapter())) { console.log('skip: no WebGPU adapter'); Deno.exit(0); }
const m = await import(L + 'view3d/index.js');
let q = [], id = 0, dev = null;
const gpu = { requestAdapter: async (o) => { const a = await navigator.gpu.requestAdapter(o); return { requestDevice: async () => (dev = await a.requestDevice()) }; } };
const T = createTab3D({ canvas: null, note: { hidden: true }, status: { textContent: '' } }, {
  gpu, load: async () => ({ createView3D: (c, d, o) => m.createView3D(null, d, { ...o, width: 320, height: 200, format: 'rgba8unorm' }) }),
  raf: (f) => { q.push([++id, f]); return id; }, caf: (k) => { q = q.filter((x) => x[0] !== k); }, phone: () => true, now: () => performance.now(),
});
T.setMap({ id: 'magma', reverse: false, gamma: 1 });
await T.enter();
const errs = []; dev.addEventListener?.('uncapturederror', (e) => errs.push(e.error?.message));
const t0 = performance.now();
for (let i = 0; i < 3000 && T.state().phase !== 'look'; i++) { const qq = q; q = []; for (const [, f] of qq) { try { f(i * 16); } catch (e) { errs.push(String(e)); } } await new Promise((r) => setTimeout(r, 0)); }
const st = T.state();
console.log(`${st.phase === 'look' ? 'ok  ' : 'FAIL'} real device: phase ${st.phase}, ${st.view?.scanned}/${st.view?.total} views, rmse ${st.view?.rmse?.toFixed(4)}, ${(performance.now() - t0).toFixed(0)} ms (render errors: ${st.error || 'none'})`);
const lost = dev.lost;
T.leave();
const info = await Promise.race([lost, new Promise((r) => setTimeout(() => r(null), 2000))]);
console.log(`${info && info.reason === 'destroyed' ? 'ok  ' : 'FAIL'} leave() destroys the device (lost reason: ${info && info.reason})`);
console.log(`${errs.length === 0 ? 'ok  ' : 'FAIL'} no WebGPU errors ${errs.slice(0, 2).join('; ')}`);
console.log(`${T.state().live === 0 ? 'ok  ' : 'FAIL'} live devices 0`);
if (st.phase !== 'look' || !info || info.reason !== 'destroyed' || errs.length || T.state().live !== 0) Deno.exit(1);
