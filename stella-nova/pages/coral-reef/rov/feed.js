// ============================================================================
//  CORAL REEF  ·  ROV  ·  the camera feed (three r160 render target + panel)
// ----------------------------------------------------------------------------
//  createFeed(THREE, o) owns:
//    rt ........ a 320 x 256 render target (half float when the GPU can
//                read it back, else 8 bit). When the link wants a frame,
//                the feed renders the scene from the camera of the chosen
//                vehicle into rt and reads the pixels back (one read per
//                picture, every 20 to 40 s, not per frame).
//    link ...... link.js SstvLink: AGC and camera curve (frameToMode),
//                encode and noise (in feed-worker.js when a Worker is
//                there, else on this thread), progressive decode
//    canvas .... the panel: hud.js drawHud with the received picture
//  update(dt) moves the link, copies new rows to the picture canvas and
//  redraws the panel at most 20 times a second.
//  With no renderer (node), o.source(vehicle) -> { w, h, data } (RGBA,
//  bottom-up, linear 0..1 floats or bytes) gives the frame instead.
//
//  grep -n targets
//    "function capture"     render target -> mode-size RGBA
//    "function startFrame"  capture, then encode (worker or here)
//    "export function createFeed"
// ============================================================================
import { SstvLink, frameToMode, makeSamples, byId } from './link.js';
import { HUD, drawHud, hudFields } from './hud.js';

let HALF = null;
function halfLut() {
  if (HALF) return HALF;
  HALF = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
    HALF[h] = e === 0 ? s * 5.960464477539063e-8 * f : e === 31 ? (f ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  return HALF;
}

function makeCanvas(doc, w, h) {
  if (doc && doc.createElement) { const c = doc.createElement('canvas'); c.width = w; c.height = h; return c; }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

// o: renderer, scene, getVehicle(id) -> vehicle, vehicle (id), mode
// ('r36' | 'm1'), speed, hold, seed, noise, canvas, document, dpr,
// worker (default true), source(vehicle), info(vehicle) -> { depth,
// heading, time }
export function createFeed(THREE, o = {}) {
  const doc = o.document !== undefined ? o.document : (typeof document !== 'undefined' ? document : null);
  const dpr = o.dpr ?? Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
  const canvas = o.canvas || makeCanvas(doc, Math.round(HUD.W * dpr), Math.round(HUD.H * dpr));
  if (canvas && o.canvas) { canvas.width = Math.round(HUD.W * dpr); canvas.height = Math.round(HUD.H * dpr); }
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  const link = new SstvLink({ mode: o.mode || 'r36', seed: o.seed ?? 1, speed: o.speed ?? 2, hold: o.hold ?? 2.5, noise: o.noise });
  let pic = null, picCtx = null, picData = null;
  function makePic() {
    const m = link.mode;
    pic = makeCanvas(doc, m.W, m.H);
    picCtx = pic && pic.getContext ? pic.getContext('2d') : null;
    picData = picCtx && picCtx.createImageData ? picCtx.createImageData(m.W, m.H) : null;
  }
  makePic();
  const R = o.renderer || null, RW = 320, RH = 256;
  let rt = null, half = false, buf = null;
  if (R && THREE) {
    const ext = R.extensions;
    half = !!(R.capabilities && R.capabilities.isWebGL2 && ext && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')));
    rt = new THREE.WebGLRenderTarget(RW, RH, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true });
    buf = half ? new Uint16Array(RW * RH * 4) : new Uint8Array(RW * RH * 4);
  }
  let worker = null, pending = 0, reqId = 0, vid = o.vehicle ?? 1;
  const agc = { g: 8 };
  if (o.worker !== false && typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./feed-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const d = e.data;
        if (d.id !== reqId) return;               // a stale frame (mode or vehicle change)
        pending = 0;
        if (d.error) { worker = null; return; }
        link.beginSamples({ samples: d.samples, env: d.env, envHz: d.envHz, params: d.params });
      };
      worker.onerror = () => { worker = null; pending = 0; };
    } catch { worker = null; }
  }

  function capture(v) {
    const m = link.mode;
    if (rt && v && v.camera) {
      const prev = R.getRenderTarget(), sm = R.shadowMap.autoUpdate;
      v.camera.aspect = RW / RH; v.camera.updateProjectionMatrix();
      if (o.beforeCapture) o.beforeCapture(v);
      R.setRenderTarget(rt);
      R.clear(true, true, false);
      R.render(o.scene, v.camera);
      R.setRenderTarget(prev);
      R.shadowMap.autoUpdate = sm;
      if (o.afterCapture) o.afterCapture(v);
      R.readRenderTargetPixels(rt, 0, 0, RW, RH, buf);
      let src = buf;
      if (half) { const L = halfLut(), f = new Float32Array(buf.length); for (let i = 0; i < buf.length; i++) f[i] = L[buf[i]]; src = f; }
      return frameToMode(src, RW, RH, m, { agc });
    }
    if (o.source) { const s = o.source(v); return frameToMode(s.data, s.w, s.h, m, { agc, gain: s.gain }); }
    return null;
  }
  function startFrame() {
    const v = o.getVehicle ? o.getVehicle(vid) : null;
    const img = capture(v);
    if (!img) return false;
    const params = link.nextParams();
    if (worker) {
      pending = ++reqId;
      worker.postMessage({ id: reqId, img: { w: img.w, h: img.h, data: img.data }, params }, [img.data.buffer]);
    } else link.beginSamples(makeSamples(img, params));
    return true;
  }

  let since = 1, wall = 0, last = null;
  function info() {
    const v = o.getVehicle ? o.getVehicle(vid) : null;
    const extra = o.info && v ? o.info(v) : {};
    return Object.assign({ id: vid, depth: 0, heading: 0, time: wall }, extra, { status: link.status(), t: wall });
  }
  function update(dt) {
    wall += dt;
    const st = link.advance(dt);
    if (st === 'need' && !pending) startFrame();
    const rows = link.take();
    if (rows && picCtx && picData) { picData.data.set(link.picture); picCtx.putImageData(picData, 0, 0); }
    since += dt;
    if (ctx && (since >= 0.05 || rows)) {
      since = 0;
      ctx.setTransform(canvas.width / HUD.W, 0, 0, canvas.height / HUD.H, 0, 0);
      last = drawHud(ctx, info(), pic);
    }
    return st;
  }
  return {
    canvas, link, HUD,
    get picture() { return { w: link.mode.W, h: link.mode.H, data: link.picture }; },
    setVehicle(id) { if (id !== vid) { vid = id; reqId++; pending = 0; if (link.state !== 'rx') link.state = 'need'; } },
    get vehicle() { return vid; },
    setMode(id) { if (!byId(id)) return; reqId++; pending = 0; link.setMode(id); makePic(); },
    setSpeed(s) { link.speed = s; },
    update,
    hud() { return hudFields(info()); },
    lastFields() { return last; },
    dispose() { if (worker) worker.terminate(); worker = null; if (rt) rt.dispose(); },
  };
}
