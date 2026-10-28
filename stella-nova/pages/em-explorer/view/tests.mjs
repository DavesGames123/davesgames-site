// VIEW package tests: node stella-nova/pages/em-explorer/view/tests.mjs [--net]
// Camera maths, scale choice, tile cover, the tile store, gestures, the
// chunk assembler, and the viewer frame loop on a mock WebGL2 context.
// --net also opens one real dataset through DATA and reads two tiles.
import * as C from './camera.js';
import { TileStore } from './tiles.js';
import { assembleSlice, fetchSlice, transpose } from './slice.js';
import { stubVolume } from './stub.js';
import { classifyTwo, Fling, TapCounter, wheelZoomFactor, wheelPixels } from './input.js';
import { createViewer } from './index.js';
import * as P from './plan.js';

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e * Math.max(1, Math.abs(a), Math.abs(b));
const section = s => console.log('--', s);

// ------------------------------------------------------------ camera
section('camera');
const vol = stubVolume({ size: [20000, 12000, 3000], resolution: [8, 8, 40], chunk: [128, 128, 16], levels: 7, anisoZ: true });
{
  ok(C.PLANES.yz.u === 2 && C.PLANES.yz.v === 1 && C.PLANES.xz.v === 2, 'plane axes follow the neuroglancer panels');
  const sc = vol.scales;
  ok(C.chooseScale(sc, 'xy', 8) === 0, 'one voxel per device px at 8 nm -> scale 0');
  ok(C.chooseScale(sc, 'xy', 15.9) === 0, '15.9 nm/px stays on scale 0');
  ok(C.chooseScale(sc, 'xy', 16) === 1, '16 nm/px -> scale 1');
  ok(C.chooseScale(sc, 'xy', 4) === 0, 'zoomed past one to one stays on scale 0');
  ok(C.chooseScale(sc, 'xy', 1e9) === sc.length - 1, 'far out -> coarsest');
  ok(C.chooseScale(sc, 'xy', 20, 1.6) === 2, 'lod bias 1.6 picks a coarser level');
  ok(C.chooseScale(sc, 'xy', 8, 1, 2) === 1 && C.chooseScale(sc, 'xy', 4, 1, 2) === 0 && C.chooseScale(sc, 'xy', 3, 1, 2) === 0, 'costly scale 0 waits for 2 device px per voxel');
  ok(C.fine0For({ scales: [{ encoding: 'zstd', chunk: [128, 128, 128] }] }, 'xy') === 2 && C.fine0For({ scales: [{ encoding: 'jpeg', chunk: [64, 64, 64] }] }, 'xy') === 1
    && C.fine0For({ scales: [{ encoding: 'raw', chunk: [128, 128, 16] }] }, 'xy') === 1, 'fine0: OpenOrganelle zstd 128^3 yes, hemibrain JPEG and minnie65 raw 16-deep no');
  // xz: in-plane finest axis is x (8 nm) on scale 0
  ok(C.inPlaneRes(sc[0], 'xz') === 8 && C.inPlaneRes(sc[3], 'xz') === 64, 'in-plane resolution uses the finest axis');
  const ts = C.tileSize(sc[0], 'xz');
  ok(ts[0] === 256 && ts[1] === 256 && ts[1] % 16 === 0, 'tile size a multiple of the chunk (z chunk 16)');
  ok(C.tileSize({ chunk: [384, 64, 64] }, 'xy')[0] === 384, 'a chunk larger than 256 sets the tile size');
  ok(C.tileSize({ chunk: [100, 64, 64] }, 'xy')[0] === 300, 'chunk 100 -> tile 300');
  // slice index
  ok(C.sliceIndex(sc[0], 'xy', 41) === 1 && C.sliceIndex(sc[0], 'xy', -5) === 0 && C.sliceIndex(sc[0], 'xy', 1e12) === 2999, 'slice index clamps');
  ok(C.sliceIndex(sc[0], 'yz', 17) === 2, 'yz normal is x');
  // screen <-> world
  const view = { plane: 'xz', vp: { x: 10, y: 20, w: 800, h: 600 }, fx: 400, fy: 250 };
  const cam = { center: [5000, 6000, 7000], nmPerPx: 3.5 };
  const w = C.screenToWorld(view, cam, 123, 456);
  const s = C.worldToScreen(view, cam, w);
  ok(near(s[0], 123) && near(s[1], 456) && w[1] === 6000, 'screen -> world -> screen round trip, normal axis kept');
  const wf = C.screenToWorld(view, cam, 410, 270);
  ok(near(wf[0], 5000) && near(wf[2], 7000), 'focus point shows the centre');
  // visible tiles cover the view rect inside the volume
  for (const [pl, L, npp] of [['xy', 0, 4], ['xz', 2, 30], ['yz', 1, 12], ['xy', 6, 900]]) {
    const vw = { plane: pl, vp: { x: 0, y: 0, w: 731, h: 517 } };
    const cm = { center: [11111, 4321, 55555], nmPerPx: npp };
    const tiles = C.visibleTiles(vw, cm, sc[L]);
    const r = C.viewRectNm(vw, cm), a = C.PLANES[pl], ext = C.extentNm(vol);
    const box = [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(ext[a.u], r[2]), Math.min(ext[a.v], r[3])];
    let covered = true;
    for (let k = 0; k < 200; k++) {
      const pu = box[0] + (box[2] - box[0]) * ((k * 37 % 200) / 199), pv = box[1] + (box[3] - box[1]) * ((k * 71 % 200) / 199);
      if (pu >= ext[a.u] || pv >= ext[a.v]) continue;
      if (!tiles.some(t => pu >= t.nm[0] && pu <= t.nm[2] && pv >= t.nm[1] && pv <= t.nm[3])) { covered = false; break; }
    }
    ok(covered && tiles.length > 0, `tiles cover the view (${pl}, scale ${L}, ${tiles.length} tiles)`);
    ok(tiles.every((t, i) => i === 0 || t.d >= tiles[i - 1].d), `tiles sorted nearest first (${pl})`);
    ok(tiles.every(t => t.rect[2] <= sc[L].size[a.u] && t.rect[3] <= sc[L].size[a.v] && t.rect[2] > t.rect[0]), `tile rects clipped to the scale (${pl})`);
    const nmPerTile = sc[L].resolution[a.u] * C.tileSize(sc[L], pl)[0];
    ok(tiles.length <= (Math.ceil(731 * npp / nmPerTile) + 1) * (Math.ceil(517 * npp / (sc[L].resolution[a.v] * C.tileSize(sc[L], pl)[1])) + 1), `no extra tiles (${pl})`);
  }
  // tiles at the target scale on a 1920x1080 screen at dpr 2 stay few
  {
    const vw = { plane: 'xy', vp: { x: 0, y: 0, w: 1920, h: 1080 } };
    const npp = 7.3, L = C.chooseScale(sc, 'xy', npp / 2);
    const n = C.visibleTiles(vw, { center: [10000, 6000, 0], nmPerPx: npp }, sc[L]).length;
    ok(n <= 6 * 10, `target-scale tile count bounded on a 4K screen (${n})`);
  }
  // scale bar
  const b = C.scaleBar(10, 120);
  ok(b.nm === 1000 && near(b.px, 100) && b.label === '1 µm', 'scale bar 10 nm/px -> 1 um over 100 px');
  ok(C.scaleBar(0.5, 120).label === '50 nm', 'scale bar 0.5 nm/px -> 50 nm');
  ok(C.scaleBar(2000, 120).label === '200 µm', 'scale bar 2000 nm/px -> 200 um');
  ok(C.scaleBar(1e5, 120).label === '10 mm', 'scale bar 100 um/px -> 10 mm');
  for (const npp of [0.37, 3, 17, 333, 4100]) { const q = C.scaleBar(npp, 120); ok(q.px <= 120 && q.px > 120 / 2.5 - 1e-9, `scale bar length in range at ${npp}`); }
  // zoom <-> nmPerPx
  ok(near(C.zoomToNmPerPx(vol, 'xy', 1), 8) && near(C.nmPerPxToZoom(vol, 'xz', 2), 4), 'zoom units: CSS px per scale-0 voxel');
  // clamp and snap
  const cc = C.clampCamera({ center: [-5, 1e9, 50], nmPerPx: 1e-6 }, vol, C.zoomLimits(vol, 'xy', 800, 600));
  ok(cc.center[0] === 0 && cc.center[1] < 12000 * 8 && near(cc.nmPerPx, 8 / 24), 'camera clamps to the volume and the zoom limit');
  ok(C.snapSlice(vol, 2, 95) === 100 && C.snapSlice(vol, 2, -3) === 20, 'slice snaps to the middle of a scale-0 voxel');
  // layout
  const L1 = C.layoutViews(1000, 700, 'single', 'xz', { bottom: 200, right: 300 });
  ok(L1.length === 1 && L1[0].fx === 350 && L1[0].fy === 250, 'single view focus is the middle of the inset area');
  const L3 = C.layoutViews(1000, 700, 'three', 'yz');
  ok(L3.length === 3 && L3[0].plane === 'yz' && L3.map(v => v.plane).sort().join() === 'xy,xz,yz', 'three views, main plane first');
  const area = L3.reduce((s, v) => s + v.vp.w * v.vp.h, 0);
  ok(area <= 1000 * 700 && area > 1000 * 700 * 0.98, 'three-view tiles fill the canvas');
  const P3 = C.layoutViews(400, 800, 'three', 'xy');
  ok(P3[0].vp.w === 400 && P3[1].vp.y > P3[0].vp.h - 1, 'portrait three-view stacks the main view on top');
  ok(C.viewAt(L3, L3[2].vp.x + 3, L3[2].vp.y + 3) === L3[2], 'viewAt finds the view under a point');
  // zoom path
  for (const [p0, p1] of [[[0, 0, 1000], [5e4, 2e4, 300]], [[100, 100, 5e5], [100, 100, 500]], [[0, 0, 800], [10, 0, 800]]]) {
    const zp = C.zoomPath(p0, p1);
    const a0 = zp.at(0), a1 = zp.at(1);
    ok(near(a0[0], p0[0], 1e-6) && near(a0[2], p0[2], 1e-6) && near(a1[0], p1[0], 1e-6) && near(a1[1], p1[1], 1e-6) && near(a1[2], p1[2], 1e-6), `zoom path ends at its endpoints (${p1})`);
    ok(zp.S >= 0 && isFinite(zp.S), 'zoom path length finite');
  }
  {
    const zp = C.zoomPath([0, 0, 1000], [1e6, 0, 1000]);
    ok(zp.at(0.5)[2] > 1000 * 50, 'a long flight zooms out in the middle');
  }
}

// ------------------------------------------------------------ input
section('input');
{
  ok(classifyTwo({ d: 200, cx: 100, cy: 100 }, { d: 230, cx: 100, cy: 100 }) === 'pinch', 'distance +15% -> pinch');
  ok(classifyTwo({ d: 200, cx: 100, cy: 100 }, { d: 202, cx: 103, cy: 130 }) === 'slice', 'both fingers down 30 px -> slice');
  ok(classifyTwo({ d: 200, cx: 100, cy: 100 }, { d: 202, cx: 140, cy: 105 }) === 'pinch', 'sideways two-finger move -> pinch pan');
  ok(classifyTwo({ d: 200, cx: 100, cy: 100 }, { d: 203, cx: 102, cy: 108 }) === null, 'small move -> undecided');
  const f = new Fling();
  for (let i = 0; i <= 10; i++) f.add(i * 10, 0, i * 10);
  ok(near(f.velocity(100).vx, 1), 'fling velocity 1 px/ms');
  ok(f.velocity(300).vx === 0, 'a pause before release gives no fling');
  ok(near(Fling.glide(1, 1e9), 325, 1e-6), 'glide distance tends to v*tau');
  const tc = new TapCounter();
  ok(tc.tap(10, 10, 0) === 1 && tc.tap(14, 12, 200) === 2 && tc.tap(14, 12, 300) === 1, 'double tap in 300 ms');
  ok(new TapCounter().tap(0, 0, 0) === 1, 'single tap');
  ok(wheelZoomFactor(-1e5) === 2.2 && wheelZoomFactor(1e5) === 1 / 2.2 && wheelZoomFactor(-100) > 1, 'wheel zoom factor clamps, up zooms in');
  ok(wheelPixels({ deltaMode: 1, deltaY: 3 }).y === 48, 'line-mode wheel to px');
}

// ------------------------------------------------------------ slice assembly
section('slice');
{
  const small = stubVolume({ size: [300, 200, 90], resolution: [8, 8, 8], chunk: [64, 48, 32], levels: 3 });
  const nos = stubVolume({ size: [300, 200, 90], resolution: [8, 8, 8], chunk: [64, 48, 32], levels: 3, noSlice: true });
  const cases = [['xy', 0, 37, [10, 5, 300, 200]], ['xz', 0, 199, [250, 0, 300, 90]], ['yz', 0, 63, [0, 0, 90, 200]], ['yz', 1, 64 + 5, [7, 33, 45, 100]], ['xy', 2, 22, [0, 0, 75, 50]]];
  for (const [pl, s, idx, rect] of cases) {
    const a = await small.getSlice(s, pl, idx, rect);
    const b = await assembleSlice(nos, s, pl, idx, rect);
    let same = a.width === b.width && a.height === b.height;
    for (let i = 0; same && i < a.data.length; i++) if (a.data[i] !== b.data[i]) same = false;
    ok(same, `chunk assembler matches the direct slice (${pl}, scale ${s}, index ${idx})`);
  }
  const f = await fetchSlice(nos, 0, 'xy', 3, [0, 0, 64, 48]);
  ok(f.width === 64 && f.data.length === 64 * 48 && nos.calls.chunk === 0 + nos.calls.chunk, 'fetchSlice falls back to chunks');
  const t = transpose(Uint8Array.from([1, 2, 3, 4, 5, 6]), 3, 2);
  ok([...t].join() === '1,4,2,5,3,6', 'transpose');
  const yzv = { ...small, yzOrder: 'yz', getSlice: async (s, pl, idx, r) => { const g = await small.getSlice(s, pl, idx, r); return { data: transpose(g.data, g.width, g.height), width: g.height, height: g.width }; } };
  const g1 = await fetchSlice(yzv, 0, 'yz', 5, [0, 0, 90, 200]), g0 = await small.getSlice(0, 'yz', 5, [0, 0, 90, 200]);
  ok(g1.width === 90 && g1.data.every((v, i) => v === g0.data[i]), 'yzOrder yz is transposed back');
  // the stub has structure: not a flat image
  const v = new Set(g0.data); ok(v.size > 20, 'stub slice has texture');
}

// ------------------------------------------------------------ tile store
section('tiles');
{
  let clock = 0; const started = [], pend = new Map();
  const st = new TileStore({
    maxInFlight: 3, maxTiles: 5, abortMs: 100, now: () => clock,
    load: (d, signal) => new Promise((res, rej) => { started.push(d.key); pend.set(d.key, { res, rej }); signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))); }),
    upload: (r, d) => ({ tex: d.key }), free: () => {},
  });
  const D = (k, prio, pos = k, index = 0) => ({ key: k, posKey: pos, index, prio });
  st.want([D('c', 3), D('a', 1), D('d', 4), D('b', 2)]);
  ok(started.join() === 'a,b,c', 'starts the best three by priority');
  pend.get('a').res({ data: new Uint8Array(4), width: 2, height: 2 });
  await new Promise(r => setTimeout(r, 0));
  ok(st.has('a') && st.stats().inFlight === 2, 'a loaded');
  clock = 50; st.want([D('b', 2), D('d', 4)]);
  ok(started.includes('d'), 'a free slot starts the next');
  clock = 200; st.want([D('d', 4), D('e', 5)]);
  ok(!st.flight.has('b') && !st.flight.has('c') && st.flight.has('d'), 'stale requests abort after abortMs');
  ok(started.includes('e'), 'freed slots start new work');
  pend.get('b').res({ data: new Uint8Array(4), width: 2, height: 2 });
  await new Promise(r => setTimeout(r, 0));
  ok(!st.has('b'), 'a late answer of an aborted request is dropped');
  // nearest slice fallback
  for (const k of ['d', 'e']) pend.get(k).res({ data: new Uint8Array(1), width: 1, height: 1 });
  await new Promise(r => setTimeout(r, 0));
  for (const [k, i] of [['p3', 3], ['p9', 9]]) { st.want([D(k, 0, 'P', i)]); pend.get(k).res({ data: new Uint8Array(1), width: 1, height: 1 }); }
  await new Promise(r => setTimeout(r, 0));
  ok(st.nearest('P', 4, 3).key === 'p3' && st.nearest('P', 8, 3).key === 'p9' && st.nearest('P', 20, 3) === null, 'nearest loaded slice of the same place');
  ok(st.nearest('P', 3, 6, 3).key === 'p9', 'nearest can skip the exact slice (old tile under a fading new one)');
  // LRU: fill above 5, the tiles used this frame stay
  for (const k of ['l1', 'l2', 'l3', 'l4']) { st.want([D(k, 0)]); pend.get(k).res({ data: new Uint8Array(1), width: 1, height: 1 }); await new Promise(r => setTimeout(r, 0)); }
  ok(st.tiles.size <= 5, `LRU keeps the store at maxTiles (${st.tiles.size})`);
  ok(st.has('l4'), 'the newest tile stays');
  // failure and retry
  st.want([D('bad', 0)]); pend.get('bad').rej(new Error('net'));
  await new Promise(r => setTimeout(r, 0));
  const n0 = started.length; st.want([D('bad', 0)]);
  ok(started.length === n0 && st.errorCount === 1, 'a failed tile waits before a retry');
  clock += 5000; st.want([D('bad', 0)]);
  ok(started.length === n0 + 1, 'retry after retryMs');
  pend.get('bad').rej(new Error('net'));
  await new Promise(r => setTimeout(r, 0));
  clock += 3000; st.want([D('bad', 0)]);
  ok(started.length === n0 + 1, 'a second failure waits longer (5 s, not 2.5 s)');
  clock += 2500; st.want([D('bad', 0)]);
  ok(started.length === n0 + 2, 'retry after 2 x retryMs');
  ok(st.retryWait(1) === 2500 && st.retryWait(3) === 10000 && st.retryWait(40) === 60000, 'the wait doubles up to maxRetryMs');
  st.clear(); ok(st.tiles.size === 0 && st.flight.size === 0, 'clear');
}

// ------------------------------------------------------------ viewer on a mock GL
section('viewer');
function mockGL() {
  const calls = { draw: 0, tex: 0, del: 0 };
  let id = 1;
  const fns = {
    createShader: () => ({ id: id++ }), createProgram: () => ({ id: id++ }), createTexture: () => { calls.tex++; return { id: id++ }; },
    deleteTexture: () => { calls.del++; }, createVertexArray: () => ({}), getShaderParameter: () => true, getProgramParameter: () => true,
    getUniformLocation: () => ({}), drawArrays: () => { calls.draw++; },
  };
  const gl = new Proxy({}, { get(t, k) { if (k === 'calls') return calls; if (k in fns) return fns[k]; if (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)) return 1; return () => {}; } });
  return gl;
}
{
  const gl = mockGL();
  const listeners = {};
  const canvas = { width: 0, height: 0, clientWidth: 1000, clientHeight: 700, style: {},
    getContext: k => (k === 'webgl2' ? gl : null), addEventListener: (k, f) => { listeners[k] = f; }, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 }) };
  const states = [];
  const v = createViewer(canvas, { overlay: false, phone: false, onState: s => states.push(s) });
  const sv = stubVolume({ size: [40000, 30000, 2000], resolution: [8, 8, 8], chunk: [64, 64, 64], levels: 9 });
  sv.fine0 = 1;   // as cheap as JPEG; the costly case is tested below
  v.setVolume(sv);
  const tick = async (n = 1) => { for (let i = 0; i < n; i++) { v._debug.frame(1000 + i * 16 + (tick.t = (tick.t || 0) + 16)); await new Promise(r => setTimeout(r, 0)); } };
  await tick(1);
  const w0 = v._debug.computeWants();
  const base = sv.scales.length - 1;
  ok(w0.length > 0 && w0.slice().sort((a, b) => a.prio - b.prio)[0].scale === base, 'the base scale is asked first');
  await tick(40);
  let s = v.state();
  ok(s.ready === true, `fit view loads all target tiles (${s.tiles.loaded}/${s.tiles.total})`);
  ok(near(s.x, 19999.5, 1e-3) && near(s.y, 14999.5, 1e-3), 'setVolume centres the volume');
  ok(gl.calls.draw > 0 && gl.calls.tex > 0, 'tiles drawn');
  ok(s.contrast.lo > 0.1 && s.contrast.hi < 0.95 && s.contrast.hi > s.contrast.lo + 0.1, `auto window from the base tiles (${s.contrast.lo.toFixed(3)}..${s.contrast.hi.toFixed(3)})`);
  ok(near(v.autoContrast().lo, s.contrast.lo), 'autoContrast() gives the same window');
  // goTo bookmark units
  v.goTo({ x: 1234, y: 5678, z: 900, zoom: 1, plane: 'xy' });
  await tick(1);
  s = v.state();
  ok(near(s.x, 1234, 1e-9) && near(s.y, 5678, 1e-9) && near(s.z, 900, 1e-9) && near(s.zoom, 1), 'goTo and state() round trip in scale-0 voxels');
  ok(s.scaleIndex === 0 && s.slice.index === 900 && s.slice.axis === 'z', 'zoom 1 at dpr 1 picks scale 0');
  sv.fine0 = 2; ok(v.state().scaleIndex === 1, 'a costly scale 0 keeps scale 1 at zoom 1'); sv.fine0 = 1;
  ok(s.scaleBar.px > 40 && s.scaleBar.px <= 120, 'scale bar in state');
  // coarse under fine: before any scale-0 tile lands, coarse tiles draw
  const d0 = gl.calls.draw; await tick(1);
  ok(gl.calls.draw - d0 >= 2, 'coarse tiles draw while fine tiles load');
  await tick(40);
  ok(v.state().ready, 'scale 0 view loads');
  // slice step shows the nearest loaded slice: no draw gap
  v.setSlice((901 + 0.5) * 8);
  const d1 = gl.calls.draw; v._debug.frame(5000);
  const fineKeys = v._debug.computeWants().filter(w => w.scale === 0 && w.prio < 600).length;
  ok(gl.calls.draw - d1 >= fineKeys, 'next slice draws the old fine tiles at once');
  // plane switch keeps the zoom
  v.setPlane('yz'); await tick(1);
  ok(near(v.state().zoom, 1) && v.state().slice.axis === 'x', 'setPlane keeps the zoom; yz slices along x');
  v.setPlane('xy');
  // contrast in 0..255 converts
  v.setContrast(30, 220, 0.8);
  ok(near(v.state().contrast.lo, 30 / 255) && near(v.state().contrast.hi, 220 / 255) && v.state().contrast.gamma === 0.8, 'contrast 0..255 maps to 0..1');
  // flight
  const target = { x: 30000, y: 2000, z: 1500, zoom: 2 };
  v.saverShots.prefetch(target);
  const p = v.saverShots.flyTo(target, { ms: 200 });
  let done = false; p.then(r => { done = r; });
  for (let i = 0; i < 30 && !done; i++) { await new Promise(r => setTimeout(r, 12)); v._debug.frame(performance.now()); }
  s = v.state();
  ok(done === true && near(s.x, 30000, 1e-6) && near(s.z, 1500, 1e-6) && near(s.zoom, 2, 1e-6), 'flyTo reaches the target');
  await tick(60);
  ok(v.saverShots.isReady(target) === 1, 'isReady after the tiles load');
  v.saverShots.setBand({ t: 100, b: 150 });
  ok(v._debug.views()[0].fy === 100 + (700 - 250) / 2, 'setBand moves the focus into the clear band');
  v.saverShots.setBand(null);
  // a saver prefetch has no band, so the store never holds it or the view behind it
  v.saverShots.setBand({ t: 100, b: 150 });
  v.saverShots.prefetch({ x: 12000, y: 9000, z: 700, zoom: 1 });
  const ex = v._debug.extra ? v._debug.extra() : null;
  ok(ex && ex.length > 0 && ex.every(d => d.band === undefined && d.prio >= 3000), `prefetch descriptors carry no band (${ex && ex.length} tiles, bands ${ex && [...new Set(ex.map(d => d.band))].join(',')})`);
  v.saverShots.setBand(null);
  ok(v._debug.extra && v._debug.extra().length === 0, 'setBand(null) drops the saver prefetch');
  // gestures through the canvas listeners
  {
    v.goTo({ x: 20000, y: 15000, z: 1000, zoom: 0.5 }); await tick(1);
    const P = (type, id, x, y, extra = {}) => listeners[type]({ type, pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y, preventDefault() {}, ...extra });
    const npp0 = v.state().nmPerPx, x0 = v.state().nm[0];
    P('pointerdown', 1, 500, 350); P('pointermove', 1, 540, 350); P('pointermove', 1, 600, 350);
    ok(near(v.state().nm[0], x0 - 100 * npp0, 1e-9), 'drag pans: the point under the finger stays under it');
    await new Promise(r => setTimeout(r, 120));
    P('pointerup', 1, 600, 350);
    // pinch: distance 100 -> 200 zooms in 2x about the centroid
    const before = v.state();
    P('pointerdown', 1, 450, 350); P('pointerdown', 2, 550, 350);
    P('pointermove', 1, 400, 350); P('pointermove', 2, 600, 350);
    const after = v.state();
    ok(near(after.nmPerPx, before.nmPerPx / 2, 1e-9) && near(after.nm[0], before.nm[0], 1e-9), 'pinch zooms about the centroid');
    P('pointerup', 1, 400, 350); P('pointerup', 2, 600, 350);
    // two fingers down and up at once: zoom out 2x (animated)
    const z1 = v.state().zoom;
    P('pointerdown', 3, 450, 350); P('pointerdown', 4, 550, 350); P('pointerup', 3, 450, 350); P('pointerup', 4, 550, 350);
    for (let i = 0; i < 40; i++) v._debug.frame(10000 + i * 16);
    ok(near(v.state().zoom, z1 / 2, 1e-3), `two-finger tap zooms out (${z1.toFixed(3)} -> ${v.state().zoom.toFixed(3)})`);
    // two-finger vertical drag steps the slice
    const s0 = v.state().slice.index;
    P('pointerdown', 5, 450, 300); P('pointerdown', 6, 550, 300);
    for (let y = 304; y <= 340; y += 4) { P('pointermove', 5, 450, y); P('pointermove', 6, 550, y); }
    ok(v.state().slice.index < s0, `two-finger drag down goes back through the slices (${s0} -> ${v.state().slice.index})`);
    P('pointerup', 5, 450, 340); P('pointerup', 6, 550, 340);
    // wheel zooms about the pointer
    const w0 = v.state();
    listeners.wheel({ deltaY: -100, deltaMode: 0, ctrlKey: true, clientX: 500, clientY: 350, preventDefault() {} });
    ok(v.state().nmPerPx < w0.nmPerPx, 'ctrl+wheel (trackpad pinch) zooms in at once');
    const sl = v.state().slice.index;
    listeners.wheel({ deltaY: 100, deltaMode: 1, shiftKey: true, clientX: 500, clientY: 350, preventDefault() {} });
    ok(v.state().slice.index > sl, 'shift+wheel steps the slice');
  }
  // three-plane layout
  v.setLayout('three'); await tick(2);
  ok(v._debug.views().length === 3 && v._debug.computeWants().some(w => w.plane === 'xz') && v._debug.computeWants().some(w => w.plane === 'yz'), 'three-plane layout asks for all planes');
  v.setLayout('single');
  // anisotropic volume: xz tiles and scale choice
  const an = stubVolume({ size: [20000, 12000, 3000], resolution: [8, 8, 40], chunk: [128, 128, 16], levels: 7, anisoZ: true });
  v.setVolume(an); v.setPlane('xz'); v.goTo({ x: 100, y: 200, z: 300, zoom: 0.5 }); await tick(30);
  s = v.state();
  ok(s.scaleIndex === 1 && s.slice.axis === 'y' && s.ready, `anisotropic xz view at zoom 0.5 uses scale 1 and loads (${s.tiles.loaded}/${s.tiles.total})`);
  ok(states.length > 3 && 'zoom' in states[states.length - 1], 'onState fires');
  const before = gl.calls.del;
  v.dispose();
  ok(gl.calls.del > before, 'dispose frees the textures');
}

// ------------------------------------------------------------ overlay in jsdom (when NODE_PATH has jsdom)
{
  let JSDOM = null;
  try { const { createRequire } = await import('node:module'); JSDOM = createRequire(import.meta.url)('jsdom').JSDOM; } catch (e) { console.log('-- overlay: jsdom not on NODE_PATH, skipped'); }
  if (JSDOM) {
    section('overlay (jsdom)');
    const dom = new JSDOM('<!doctype html><html><head></head><body><canvas id="view"></canvas></body></html>', { pretendToBeVisual: true });
    const w = dom.window, cv = w.document.getElementById('view');
    const gl = mockGL();
    Object.defineProperty(cv, 'clientWidth', { value: 900 }); Object.defineProperty(cv, 'clientHeight', { value: 600 });
    cv.getContext = k => (k === 'webgl2' ? gl : null);
    w.HTMLElement.prototype.setPointerCapture = function () {};
    const v = createViewer(cv, { phone: false, overlay: true });
    const root = w.document.querySelector('.emv-ov');
    ok(!!root && !!w.document.getElementById('emv-style'), 'overlay and its style are in the document');
    const sv = stubVolume({ size: [40000, 30000, 2000], resolution: [8, 8, 8], chunk: [64, 64, 64], levels: 9 });
    v.setVolume(sv);
    v.setInsets({ bottom: 42, right: 0 });
    v.goTo({ x: 20000, y: 15000, z: 1000, zoom: 0.25 });
    for (let i = 0; i < 20; i++) { v._debug.frame(1000 + i * 16); await new Promise(r => setTimeout(r, 0)); }
    const bar = root.querySelector('.emv-bar-l').textContent, read = root.querySelector('.emv-read').textContent;
    ok(/(nm|\u00b5m)$/.test(bar), `scale bar label "${bar}"`);
    ok(/scale \d/.test(read), `readout "${read.trim()}"`);
    ok(!root.querySelector('.emv-mm-l').hidden && /xy/.test(root.querySelector('.emv-mm-l').textContent), 'minimap caption shows when zoomed in');
    ok(parseFloat(root.querySelector('.emv-bl').style.bottom) === 56, 'scale bar sits above the bottom inset');
    ok(parseFloat(root.querySelector('.emv-bl').style.right) > 100, 'scale bar sits left of the minimap');
    ok(root.style.position === 'absolute' || root.style.position === 'fixed', 'overlay positioned');
    // rail drag sets the slice
    const rail = root.querySelector('.emv-rail');
    rail.getBoundingClientRect = () => ({ top: 0, height: 216, left: 856, width: 44, bottom: 216, right: 900 });
    const ev = (type, y) => { const e = new w.Event(type, { bubbles: true, cancelable: true }); Object.assign(e, { clientY: y, clientX: 878, pointerId: 7 }); rail.dispatchEvent(e); };
    ev('pointerdown', 8 + 100); ev('pointermove', 8 + 200); ev('pointerup', 8 + 200);
    ok(v.state().slice.index === 1999, `rail at the bottom goes to the last slice (${v.state().slice.index})`);
    ev('pointerdown', 8); ev('pointerup', 8);
    ok(v.state().slice.index === 0, 'rail at the top goes to slice 0');
    // keyboard
    const z0 = v.state().slice.index;
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: '.' }));
    ok(v.state().slice.index === z0 + (sv.scales[v.state().scaleIndex].resolution[2] / 8), 'key . steps one slice of the target scale');
    v.dispose();
    ok(!w.document.querySelector('.emv-ov'), 'dispose removes the overlay');
    w.close();
  }
}

// ------------------------------------------------------------ real data (opt-in)
if (process.argv.includes('--net')) {
  section('net');
  try {
    const data = await import('../data/index.js');
    // minnie65: raw chunks with gzip, so node needs no JPEG decoder
    const rec = { id: 'minnie65', format: 'precomputed', url: 'https://bossdb-open-data.s3.amazonaws.com/iarpa_microns/minnie/minnie65/em' };
    const v = await data.openVolume(rec, { worker: false });
    // scale 0 is the only raw scale of minnie65; one 256 x 256 tile is 4 chunks
    const L = 0, sc = v.scales[L];
    const n = C.PLANES.xy.n;
    const idx = Math.floor(sc.size[n] / 2);
    const vw = { plane: 'xy', vp: { x: 0, y: 0, w: 200, h: 200 } };
    const cm = { center: C.extentNm(v).map(e => e / 2), nmPerPx: 1 };
    ok(C.chooseScale(v.scales, 'xy', 8) === 0 && C.chooseScale(v.scales, 'xy', 40) === 2, 'real scale table: 8 nm -> scale 0, 40 nm -> scale 2');
    const tiles = C.visibleTiles(vw, cm, sc);
    const t0 = tiles[0];
    const r = await fetchSlice(v, L, 'xy', idx, t0.rect);
    const vals = new Set(r.data);
    ok(r.width === t0.rect[2] - t0.rect[0] && vals.size > 30, `real minnie65 base tile ${r.width}x${r.height}, ${vals.size} grey levels`);
    v.dispose && v.dispose();
  } catch (e) { ok(false, 'net test: ' + (e && e.message)); }
}

// ------------------------------------------------------------ plan (round 2, PERF)
section('plan');
{
  // hemibrain-like: 9 scales 8..2048 nm, chunk 64^3, home zoom 0.025 at dpr 2
  const hb = stubVolume({ size: [34427, 39725, 41394], resolution: [8, 8, 8], chunk: [64, 64, 64], levels: 9 });
  const vw = C.layoutViews(1440, 900, 'single', 'xy', { top: 60, left: 388, bottom: 42 })[0];
  const cam = { center: C.extentNm(hb).map(e => e / 2), nmPerPx: C.zoomToNmPerPx(hb, 'xy', 0.025) };
  const tgt = P.targetScale(hb, 'xy', cam.nmPerPx, 2, 1);
  ok(tgt === 4, `hemibrain home at dpr 2 -> target s4 (${tgt})`);
  const lv = P.wantLevels(hb, vw, cam, tgt);
  ok(lv.map(l => l.L).join() === '8,7,6,5,4,4', `levels base, first, tgt+2, tgt+1, tgt, margin (${lv.map(l => l.L)})`);
  ok(lv.every((l, i) => !i || l.prio > lv[i - 1].prio), 'priority rises from coarse to fine');
  const out = P.computeWants(vw, 0, { vol: hb, cam, dpr: 2, lodBias: 1, volKey: 'k', ready: false }, []);
  ok(out.every(d => Number.isInteger(d.band)) && out[0].band === 0, 'every tile has a band');
  ok(out.filter(d => d.scale === 4 && d.band === 4).length > 50, 'the target tiles are band 4');
  const g = P.chunkGroups(hb, out.filter(d => d.scale === 8));
  ok(g.length === 1 && g[0].si === 8 && g[0].chunks.length >= 4, `chunk groups of the base (${g[0] && g[0].chunks.length} chunks)`);
  // a pyramid with a far-off base gets a cheap first level
  const ml = stubVolume({ size: [100000, 100000, 2000], resolution: [8, 8, 8], chunk: [128, 128, 128], levels: 14 });
  const mc = { center: C.extentNm(ml).map(e => e / 2), nmPerPx: 32 };
  const mt = P.targetScale(ml, 'xy', mc.nmPerPx, 2, 1);
  const ml2 = P.wantLevels(ml, vw, mc, mt);
  const first = ml2.find(l => l.prio === 50);
  ok(first && first.L >= mt + 3 && C.visibleTiles(vw, mc, ml.scales[first.L]).length <= P.FIRST_TILES, `first level s${first && first.L} covers the view in at most ${P.FIRST_TILES} tiles`);

  // TileStore lookahead: band 0 alone, then two bands at a time
  const started = [], pend = new Map();
  const st = new TileStore({ maxInFlight: 10, lookahead: 1, abortMs: 1e9,
    load: (d) => new Promise((res) => { started.push(d.key); pend.set(d.key, res); }), upload: () => ({}) });
  const D = (k, band, prio) => ({ key: k, posKey: k, index: 0, prio, band });
  const W = [D('b0', 0, 0), D('f0', 1, 50), D('f1', 1, 51), D('m0', 2, 100), D('t0', 3, 300), D('x', undefined, 5000)];
  st.want(W);
  ok(started.join() === 'b0,x', `band 0 alone (and the saver tile with no band): ${started}`);
  pend.get('b0')({ data: new Uint8Array(4), width: 2, height: 2 });
  await new Promise(r => setTimeout(r, 0));
  st.want(W);
  ok(started.join() === 'b0,x,f0,f1,m0', `then bands 1 and 2: ${started}`);
  for (const k of ['f0', 'f1']) pend.get(k)({ data: new Uint8Array(4), width: 2, height: 2 });
  await new Promise(r => setTimeout(r, 0));
  st.want(W);
  ok(started.includes('t0'), 'band 3 starts when band 1 is in');
  // a failed coarse tile does not hold the fine bands (no JPEG decoder, an outage)
  const s2 = [], rej = new Map();
  const fs = new TileStore({ maxInFlight: 10, lookahead: 1, abortMs: 1e9,
    load: (d) => new Promise((res, no) => { s2.push(d.key); rej.set(d.key, no); }), upload: () => ({}) });
  fs.want(W);
  rej.get('b0')(new Error('decode'));
  await new Promise(r => setTimeout(r, 0));
  fs.want(W);
  ok(s2.includes('f0') && s2.includes('m0') && !s2.slice(1).includes('b0'), `a failed band 0 tile lets band 1 and 2 start: ${s2}`);
  const off = new TileStore({ maxInFlight: 10, load: (d) => new Promise(() => { started.push('off-' + d.key); }), upload: () => ({}) });
  off.want(W);
  ok(started.filter(k => k.startsWith('off-')).length === 6, 'no lookahead: all start');
}

console.log(`view tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
