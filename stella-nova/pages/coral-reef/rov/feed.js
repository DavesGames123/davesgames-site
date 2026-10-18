// ============================================================================
//  CORAL REEF  ·  ROV  ·  the camera feed (three r160 render target + panel)
// ----------------------------------------------------------------------------
//  createFeed(THREE, o) owns:
//    rt ........ a 320 x 256 render target (half float when the GPU can
//                render to it, else 8 bit). When the link wants a frame,
//                the feed renders the scene from the camera of the chosen
//                vehicle into rt. A full-screen pass then applies the
//                camera gain, a soft knee and the sRGB curve into rt8 (8
//                bit), and the feed reads rt8 back: bytes can always be
//                read, a float target not on every GPU. One read per
//                picture, every 20 to 40 s, not per frame. The AGC sets
//                the gain of the next frame from the 97th percentile of
//                this one.
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
//    "export const CURVE_FS"  the camera curve pass
//    "function startFrame"  capture, then encode (worker or here)
//    "export function createFeed"
// ============================================================================
import { SstvLink, frameToMode, makeSamples, byId } from './link.js';
import { HUD, drawHud, hudFields } from './hud.js';

// The camera curve on the GPU (three.js ShaderMaterial, GLSL ES 3.00 with
// the three prefix): gain, soft knee, sRGB. The output is the final byte.
export const CURVE_VS = 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
export const CURVE_FS = [
  'uniform sampler2D map;',
  'uniform float gain;',
  'varying vec2 vUv;',
  'vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }',
  'void main() {',
  '  vec3 c = max(texture2D(map, vUv).rgb, vec3(0.0)) * gain;',
  '  c = c / (1.0 + 0.35 * c);',
  '  gl_FragColor = vec4(srgb(clamp(c, 0.0, 1.0)), 1.0);',
  '}'].join('\n');

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
  let rt = null, rt8 = null, buf = null, post = null;
  if (R && THREE) {
    const ext = R.extensions;
    const half = !!(R.capabilities && R.capabilities.isWebGL2 && ext && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')));
    rt = new THREE.WebGLRenderTarget(RW, RH, { type: half ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: true });
    rt8 = new THREE.WebGLRenderTarget(RW, RH, { type: THREE.UnsignedByteType, depthBuffer: false });
    buf = new Uint8Array(RW * RH * 4);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: rt.texture }, gain: { value: 8 } },
      vertexShader: CURVE_VS, fragmentShader: CURVE_FS,
      depthTest: false, depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
    const sc = new THREE.Scene(); sc.add(quad);
    post = { mat, quad, sc, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
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
      const prev = R.getRenderTarget();
      v.camera.aspect = RW / RH; v.camera.updateProjectionMatrix();
      if (o.beforeCapture) o.beforeCapture(v);
      R.setRenderTarget(rt); R.clear(true, true, false); R.render(o.scene, v.camera);
      post.mat.uniforms.gain.value = agc.g;
      R.setRenderTarget(rt8); R.render(post.sc, post.cam);
      R.setRenderTarget(prev);
      if (o.afterCapture) o.afterCapture(v);
      R.readRenderTargetPixels(rt8, 0, 0, RW, RH, buf);
      // AGC for the next frame: the 97th percentile to about 80 % white
      const hist = new Uint32Array(256);
      for (let i = 0; i < RW * RH; i += 3) hist[(buf[i * 4] * 54 + buf[i * 4 + 1] * 183 + buf[i * 4 + 2] * 19) >> 8]++;
      let n = 0, p = 255; const total = Math.ceil(RW * RH / 3);
      for (let i = 255; i >= 0; i--) { n += hist[i]; if (n > total * 0.03) { p = i; break; } }
      const lin = Math.pow(Math.max(p, 4) / 255, 2.2), want = Math.pow(0.8, 2.2);
      agc.g = Math.min(80, Math.max(0.5, agc.g * Math.pow(want / lin, 0.7)));
      return frameToMode(buf, RW, RH, m, { raw: true });
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
    dispose() { if (worker) worker.terminate(); worker = null; if (rt) { rt.dispose(); rt8.dispose(); post.mat.dispose(); post.quad.geometry.dispose(); } },
  };
}
