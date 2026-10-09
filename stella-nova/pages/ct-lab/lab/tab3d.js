// lab/tab3d.js - the CT lab 3D tab: a cone-beam scan of a 3D phantom, FDK, then a look
// at the volume (MIP, volume rendering, surfaces or slices) in the 3D colour map.
//
// LIFE CYCLE
//   enter()  asks for a WebGPU adapter and device, loads view3d (../view3d/index.js),
//            builds the scene and starts the scan. Without WebGPU it shows a note and,
//            when it can, a Canvas 2D preview of the phantom slices (drawSlices2D).
//   leave()  stops the frame loop, destroys the view and the GPUDevice. main.js calls it
//            when the tab closes, on pagehide and when the saver hides the chrome.
//   A leave() during the device request destroys the late device when it arrives.
//
// PHASES  scan (CPU cone projector, a few views per frame with a time budget) -> recon
//   (GPU FDK, 12 views per step) -> look (gantry hidden, closer camera, slow turn).
//
// deps (for tests): { gpu, load, raf, caf, phone, now, fallback }. The defaults use the
// browser globals.
//
// grep handles: createTab3D, PHANTOMS, LOOKS, enter, leave, frame, release, setMap

export const PHANTOMS = [['head', 'Head'], ['chest', 'Chest'], ['shepp-logan', 'Shepp-Logan 3D']];
export const LOOKS = [['mip', 'MIP'], ['dvr', 'Volume'], ['iso', 'Surfaces'], ['slices', 'Slices']];

export function createTab3D(el, deps = {}) {
  const gpu = 'gpu' in deps ? deps.gpu : globalThis.navigator?.gpu;
  const load = deps.load ?? (() => import('../view3d/index.js'));
  const raf = deps.raf ?? ((f) => requestAnimationFrame(f));
  const caf = deps.caf ?? ((id) => cancelAnimationFrame(id));
  const phone = deps.phone ?? (() => false);
  const now = deps.now ?? (() => performance.now());
  const S = {
    active: false, gen: 0, device: null, view: null, rafId: 0, last: 0,
    phase: 'idle', pending: false, phantom: 'head', mode: 'dvr',
    map: { id: 'bone', reverse: false, gamma: 1 }, live: 0, made: 0, error: '',
  };
  const text = (e, s) => { if (e) e.textContent = s; };

  function note(msg) {
    S.error = msg;
    if (el.note) { el.note.hidden = false; text(el.note, msg); }
    if (el.canvas) el.canvas.hidden = true;
  }

  async function enter() {
    if (S.active) return;
    S.active = true;
    const gen = ++S.gen;
    if (el.note) el.note.hidden = true;
    if (el.canvas) el.canvas.hidden = false;
    if (!gpu) {
      note('The 3D tab needs WebGPU, and this browser does not have it. The 2D lab works without it. Below: the phantom slices, drawn on the CPU.');
      drawFallback();
      return;
    }
    let device = null;
    try {
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('no adapter');
      device = await adapter.requestDevice();
    } catch (e) {
      if (gen === S.gen && S.active) { note('WebGPU did not give a device here, so the 3D view cannot run. The 2D lab works without it.'); drawFallback(); }
      return;
    }
    S.made++;
    if (gen !== S.gen || !S.active) { try { device.destroy(); } catch (e) { /* gone */ } return; }   // the tab closed during the wait
    S.device = device; S.live++;
    device.lost?.then?.(() => { if (S.device === device) { release(); if (S.active) note('The GPU device was lost. Open the 3D tab again to restart.'); } });
    let mod;
    try { mod = await load(); } catch (e) { if (gen === S.gen) { release(); note('The 3D view did not load.'); } return; }
    if (gen !== S.gen || !S.active) { release(); return; }
    const ph = phone();
    try {
      S.view = mod.createView3D(el.canvas, device, {
        phantom: S.phantom, n: ph ? 64 : 96, nAngles: ph ? 90 : 180, steps: ph ? 128 : 256,
        mode: S.mode, interactive: true, dprCap: ph ? 1.5 : 2,
        colormap: S.map.id, colormapOpts: { reverse: S.map.reverse, gamma: S.map.gamma }, tfFromMap: true,
      });
    } catch (e) {
      release(); note('The 3D view failed to start: ' + (e && e.message)); return;
    }
    rescan();
    S.last = 0;
    S.rafId = raf(frame);
  }

  function release() {
    if (S.rafId) { caf(S.rafId); S.rafId = 0; }
    if (S.view) { try { S.view.destroy(); } catch (e) { /* gone */ } S.view = null; }
    if (S.device) { try { S.device.destroy(); } catch (e) { /* gone */ } S.device = null; S.live--; }
    S.phase = 'idle'; S.pending = false;
  }

  function leave() {
    S.active = false;
    S.gen++;
    release();
  }

  function rescan() {
    const v = S.view; if (!v) return;
    v.setPhantom3D(S.phantom, { n: phone() ? 64 : 96, nAngles: phone() ? 90 : 180 });
    v.setShow({ gantry: true, rays: true, table: true, detector: true, volume: 'phantom' });
    v.setMode(S.mode);
    v.setCamera({ dist: 10.5, pitch: 0.3, autoRotate: 0.12 });
    S.phase = 'scan'; S.pending = false;
    status();
  }

  function goLook() {
    const v = S.view; if (!v || S.phase === 'look') return;
    S.phase = 'look';
    v.setShow({ gantry: false, rays: false, table: false, detector: false, volume: 'auto' });
    v.setCamera({ dist: 2.9, autoRotate: 0.18 });
    status();
  }

  function frame(t) {
    S.rafId = raf(frame);
    const v = S.view; if (!v) return;
    const dt = Math.min(0.1, S.last ? (t - S.last) / 1000 : 1 / 60); S.last = t;
    const st = v.state;
    if (S.phase === 'scan') {
      const t0 = now();
      v.scanStep({ views: 1, budgetMs: phone() ? 6 : 10 });
      if (v.state.scanned >= st.total) { S.phase = 'recon'; v.setShow({ rays: false, volume: 'auto' }); }
      S.scanMs = now() - t0;
      status();
    } else if (S.phase === 'recon' && !S.pending) {
      S.pending = true;
      const gen = S.gen;
      Promise.resolve(v.reconstructStep({ views: 12 })).then((r) => {
        if (gen !== S.gen || S.view !== v) return;
        S.pending = false; status();
        if (r && r.done >= r.total) goLook();
      }, () => { S.pending = false; goLook(); });
    }
    try { v.render({ dt }); } catch (e) { release(); note('The 3D view stopped: ' + (e && e.message)); }
  }

  function status() {
    const v = S.view; if (!v || !el.status) return;
    const st = v.state;
    const txt = S.phase === 'scan' ? `Cone-beam scan · view ${st.scanned} of ${st.total}`
      : S.phase === 'recon' ? `FDK reconstruction · ${st.reconstructed} of ${st.total} views back-projected`
        : `FDK done · ${st.n}³ voxels · rmse ${Number.isFinite(st.rmse) ? st.rmse.toFixed(3) : '-'} /cm · drag to turn, pinch or wheel to zoom`;
    text(el.status, txt);
  }

  async function drawFallback() {
    const fb = el.fallback; if (!fb || !fb.getContext) return;
    try {
      const [{ drawSlices2D }, { phantom3D }] = await Promise.all([load(), import('../engine/index.js')]);
      const vol = phantom3D(S.phantom, 48).volume;
      fb.hidden = false;
      fb.width = 4 * 160 + 18; fb.height = 160;
      drawSlices2D(fb.getContext('2d'), vol, { colormap: S.map.id });
    } catch (e) { /* the preview is optional */ }
  }

  return {
    enter, leave,
    get active() { return S.active; },
    setPhantom(name) { if (!PHANTOMS.some((p) => p[0] === name)) return; S.phantom = name; if (S.view) rescan(); else if (S.active && !gpu) drawFallback(); },
    setMode(m) { if (!LOOKS.some((x) => x[0] === m)) return; S.mode = m; if (S.view) S.view.setMode(m); },
    rescan,
    // m: { id, reverse, gamma } from lab/colour.js mapOf(params, 'v3d')
    setMap(m) {
      S.map = { id: m.id, reverse: !!m.reverse, gamma: m.gamma ?? 1 };
      if (S.view) S.view.setColormap(S.map.id, { reverse: S.map.reverse, gamma: S.map.gamma, tf: true });
      else if (S.active && !S.device) drawFallback();
    },
    state() { return { active: S.active, phase: S.phase, phantom: S.phantom, mode: S.mode, map: { ...S.map }, live: S.live, made: S.made, error: S.error, view: S.view ? S.view.state : null }; },
  };
}
