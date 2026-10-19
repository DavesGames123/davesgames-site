// ============================================================================
//  CORAL REEF  ·  ROV  ·  the camera feed (three r160 render target + panel)
// ----------------------------------------------------------------------------
//  Two kinds of feed, one panel (hud.js). setMode(id) changes the kind:
//
//  LIVE ('live', the page default). The ROV camera at 10 to 30 fps (o.fps or
//  o.size.fps, by profile) at a small size (o.size, for example 320 x 256
//  on a desktop, 224 x 180 on a phone; budget.js PROF.feed), with an
//  analog video look that has some SSTV flavour: scanlines, mild noise, a
//  rolling sync bar, chroma bleed, a little slant, line jitter, rare
//  streaks (about 1 a second, more in a glitch burst) and a vertical roll
//  when the vehicle changes. All on the GPU,
//  with no read back:
//    1. the scene from the vehicle camera into rtLive (half float, with
//       mipmaps). The shadow maps are not drawn again (the main frame
//       made them).
//    2. AGC_FS into a 1 x 1 target (ping-pong): the gain from the mean
//       (the last mip) and the bright parts (a 4 x 3 mip), eased in time.
//    3. ANALOG_FS into rtOut (8 bit, the live size): gain, knee, sRGB and
//       the analog look.
//    4. present(rect) each main frame, after the main render: BLIT_FS
//       draws rtOut into the canvas at the picture rect of the card, with
//       the scanlines at the display size. The HUD canvas has a clear
//       hole there (hud.js drawHud with o.hole).
//  The live frames come at their own rate (an accumulator: never more than
//  one per update, never a burst). A governor drops the rate by steps
//  (30, 24, 20, 15, 12, 10) when the main frame time goes up or the feed
//  render takes more than its budget, and steps up again after 4 s.
//  setActive(false) (the card is hidden) stops the live renders, the new
//  SSTV captures and the panel redraws.
//
//  MANY FEEDS (rov/feeds.js, one card per ROV). o.drive 'external': update()
//  does not render live frames; the feed set calls liveFrame(dt) when its
//  shared rate (o.rate, one liveRate for all the feeds) and its weighted
//  round robin give this feed the next frame. o.gate() -> false defers a
//  new SSTV capture (the set allows one capture per main frame). o.port:
//  one feed worker for all the feeds ({ post(msg, transfer), listen(stream,
//  fn) }; o.stream is the key of this feed). setLook({ colour, compact }):
//  the ROV colour and the small card of hud.js.
//
//  SSTV ('r8', 'r36', 'm1': Robot 8 B&W, Robot 36, Martin M1). The true
//  slow-scan link (link.js SstvLink over pages/sstv):
//    rt ........ a 320 x 256 render target. When the link wants a frame,
//                the feed renders the vehicle camera into rt; CURVE_FS
//                (gain, knee, sRGB) goes into rt8 (8 bit), and the feed
//                reads rt8 back: one read per picture (every 7 to 40 s).
//                The AGC sets the gain of the next frame from the 97th
//                percentile of this one.
//    link ...... encode and noise (in feed-worker.js when a Worker is
//                there, else on this thread), progressive decode
//    canvas .... the panel: hud.js drawHud with the received picture
//
//  update(dt) moves the feed and redraws the panel at most 20 (SSTV) or 10
//  (live) times a second. With no renderer (node), o.source(vehicle) ->
//  { w, h, data } (RGBA, bottom-up, linear 0..1 floats or bytes) gives the
//  frames; in live mode analogFrame() (the same look on the CPU) makes the
//  picture.
//
//  grep -n targets
//    "export const CURVE_FS"    the SSTV camera curve pass
//    "export const AGC_FS"      the live gain pass
//    "export const ANALOG_FS"   the live analog look
//    "export const BLIT_FS"     the live picture into the canvas
//    "export function analogFrame"  the live look on the CPU (node)
//    "export function liveRate"     the frame accumulator and governor
//    "function capture"  "function startFrame"  "function renderLive"
//    "function drawScene"  the scene render, cleared to o.clearColour()
//    "liveFrame(dt)"     one live frame now (the feed set of rov/feeds.js)
//    "export function createFeed"
// ============================================================================
import { SstvLink, frameToMode, makeSamples, byId } from './link.js';
import { HUD, drawHud, hudFields } from './hud.js';

export const FEED_MODES = ['live', 'r8', 'r36', 'm1'];

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

// Live gain: log gain in 0..1 (so an 8 bit target holds it too).
export const GAIN_LO = 0.5, GAIN_HI = 60;
export const AGC_FS = [
  'uniform sampler2D map;',
  'uniform sampler2D prev;',
  'uniform float lodMean;',
  'uniform float lodHi;',
  'uniform float rate;',
  'varying vec2 vUv;',
  'const float LO = log(' + GAIN_LO.toFixed(1) + '), HI = log(' + GAIN_HI.toFixed(1) + ');',
  'float lum(vec3 c) { return dot(max(c, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722)); }',
  'void main() {',
  '  float m = lum(textureLod(map, vec2(0.5), lodMean).rgb);',
  '  float hi = 0.0;',
  '  for (int j = 0; j < 3; j++) for (int i = 0; i < 4; i++) hi = max(hi, lum(textureLod(map, vec2((float(i) + 0.5) / 4.0, (float(j) + 0.5) / 3.0), lodHi).rgb));',
  '  float want = clamp(min(0.16 / max(m, 1e-5), 0.9 / max(hi, 1e-5)), ' + GAIN_LO.toFixed(1) + ', ' + GAIN_HI.toFixed(1) + ');',
  '  float p = mix(LO, HI, texture2D(prev, vec2(0.5)).r);',
  '  float g = mix(p, log(want), rate);',
  '  gl_FragColor = vec4((g - LO) / (HI - LO), 0.0, 0.0, 1.0);',
  '}'].join('\n');

// The analog look. time: s; seed; noise 0..1 (from the signal); slant
// (picture lean, x shift per unit y); bar: the sync bar position 0..1;
// roll: vertical roll 0..1; res: the live size (px).
export const ANALOG_FS = [
  'uniform sampler2D map;',
  'uniform sampler2D agc;',
  'uniform float time;',
  'uniform float seed;',
  'uniform float noise;',
  'uniform float slant;',
  'uniform float bar;',
  'uniform float roll;',
  'uniform vec2 res;',
  'varying vec2 vUv;',
  'const float LO = log(' + GAIN_LO.toFixed(1) + '), HI = log(' + GAIN_HI.toFixed(1) + ');',
  'float h1(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
  'vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }',
  'vec3 cam(vec2 uv, float g) { vec3 c = max(texture2D(map, clamp(uv, vec2(0.0), vec2(1.0))).rgb, vec3(0.0)) * g; c = c / (1.0 + 0.35 * c); return srgb(clamp(c, 0.0, 1.0)); }',
  'void main() {',
  '  float g = exp(mix(LO, HI, texture2D(agc, vec2(0.5)).r));',
  '  vec2 uv = vUv;',
  '  uv.y = fract(uv.y + roll);',
  '  float line = floor(uv.y * res.y), fr = floor(time * 30.0);',
  '  float db = uv.y - bar; db -= floor(db + 0.5);',
  '  float band = exp(-db * db / 0.0016);',
  '  float jit = (h1(vec2(line, fr + seed)) - 0.5) * 0.0022 * (1.0 + 4.0 * noise);',
  '  uv.x += slant * (uv.y - 0.5) + jit + band * 0.006 * sin(line * 0.7 + time * 9.0);',
  '  vec2 px = vec2(1.0 / res.x, 0.0);',
  '  vec3 c0 = cam(uv, g), c1 = cam(uv - 1.5 * px, g), c2 = cam(uv - 3.0 * px, g), c3 = cam(uv - 5.0 * px, g);',
  '  const vec3 YW = vec3(0.299, 0.587, 0.114);',
  '  vec3 cs = (c0 + c1 + c2 + c3) * 0.25;',
  '  vec3 col = vec3(dot(c0, YW)) + (cs - vec3(dot(cs, YW))) * 1.05;',
  '  col *= 1.0 - 0.22 * band;',
  '  float e = (db - 0.03) / 0.006; col += 0.05 * exp(-e * e);',
  '  float n = h1(vUv * res + vec2(time * 61.7, seed)) - 0.5, nc = h1(vUv.yx * res.yx + time * 13.1) - 0.5;',
  '  col += n * noise * 0.5 + vec3(nc, -0.5 * nc, 0.3 * nc) * noise * 0.25;',
  '  float streak = step(0.99985 - max(noise - 0.3, 0.0) * 0.01, h1(vec2(line, fr * 1.7 + seed)));',
  '  col = mix(col, vec3(0.9), streak * 0.5 * h1(vec2(floor(vUv.x * res.x / 8.0), line)));',
  '  vec2 q = vUv - 0.5; col *= 1.0 - 0.7 * dot(q, q);',
  '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
  '}'].join('\n');

// The live picture into the canvas: scanlines at the display size (they
// fade out when a source row is under 2 display px, so no moire).
export const BLIT_FS = [
  'uniform sampler2D map;',
  'uniform float opacity;',
  'uniform float rows;',
  'uniform float pxPerRow;',
  'varying vec2 vUv;',
  'void main() {',
  '  vec3 c = texture2D(map, vUv).rgb;',
  '  float k = clamp(pxPerRow - 1.0, 0.0, 1.0);',
  '  float s = 0.5 + 0.5 * cos(6.2831853 * vUv.y * rows);',
  '  c *= 1.0 - k * 0.3 * (1.0 - s);',
  '  gl_FragColor = vec4(c, opacity);',
  '}'].join('\n');

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fract = (x) => x - Math.floor(x);
const h1 = (x, y) => fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
const srgb1 = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

// The live look on the CPU, as ANALOG_FS (for node and the PNG check).
// src: RGBA bottom-up (GL order), linear floats or bytes; o: { time, seed,
// noise, slant, bar, roll, gain (else from the mean and bright parts),
// rows (scanlines: display px per row, 0 = none) }. Out: RGBA top-down.
export function analogFrame(src, w, h, o = {}) {
  const sc = src instanceof Uint8Array || src instanceof Uint8ClampedArray ? 1 / 255 : 1;
  const L = (i) => (0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]) * sc;
  let g = o.gain;
  if (g == null) {
    let m = 0, hi = 0;
    for (let i = 0; i < w * h; i++) m += L(i * 4);
    m /= w * h;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) {
      let s = 0, n = 0;
      for (let y = Math.floor(j * h / 3); y < Math.floor((j + 1) * h / 3); y++) for (let x = Math.floor(i * w / 4); x < Math.floor((i + 1) * w / 4); x++) { s += L((y * w + x) * 4); n++; }
      hi = Math.max(hi, s / Math.max(1, n));
    }
    g = clamp(Math.min(0.16 / Math.max(m, 1e-5), 0.9 / Math.max(hi, 1e-5)), GAIN_LO, GAIN_HI);
  }
  const t = o.time || 0, seed = o.seed || 0, noise = o.noise ?? 0.15, slant = o.slant ?? 0.012, bar = o.bar ?? 0.3, roll = o.roll || 0;
  const fr = Math.floor(t * 30), out = new Uint8ClampedArray(w * h * 4);
  const cam = (u, v, c) => {
    const x = clamp(Math.floor(clamp(u, 0, 1) * w), 0, w - 1), y = clamp(Math.floor(clamp(v, 0, 1) * h), 0, h - 1), i = (y * w + x) * 4;
    let s = Math.max(0, src[i + c] * sc) * g; s = s / (1 + 0.35 * s); return srgb1(clamp(s, 0, 1));
  };
  for (let Y = 0; Y < h; Y++) {
    const vy = 1 - (Y + 0.5) / h;          // GL v of this output row
    for (let X = 0; X < w; X++) {
      const vx = (X + 0.5) / w;
      let v = fract(vy + roll);
      const line = Math.floor(v * h);
      let db = v - bar; db -= Math.floor(db + 0.5);
      const band = Math.exp(-db * db / 0.0016);
      const jit = (h1(line, fr + seed) - 0.5) * 0.0022 * (1 + 4 * noise);
      const u = vx + slant * (v - 0.5) + jit + band * 0.006 * Math.sin(line * 0.7 + t * 9);
      const px = 1 / w, C = [0, 1, 2].map(c => [cam(u, v, c), cam(u - 1.5 * px, v, c), cam(u - 3 * px, v, c), cam(u - 5 * px, v, c)]);
      const y0 = 0.299 * C[0][0] + 0.587 * C[1][0] + 0.114 * C[2][0];
      const cs = C.map(a => (a[0] + a[1] + a[2] + a[3]) / 4), ys = 0.299 * cs[0] + 0.587 * cs[1] + 0.114 * cs[2];
      const n = h1(vx * w + t * 61.7, vy * h + seed) - 0.5, nc = h1(vy * h + t * 13.1, vx * w + t * 13.1) - 0.5;
      const streak = h1(line, fr * 1.7 + seed) > 0.99985 - Math.max(noise - 0.3, 0) * 0.01 ? 0.5 * h1(Math.floor(vx * w / 8), line) : 0;
      const q = (vx - 0.5) ** 2 + (vy - 0.5) ** 2, vig = 1 - 0.7 * q;
      const sl = o.rows ? 1 - clamp(o.rows - 1, 0, 1) * 0.3 * (1 - (0.5 + 0.5 * Math.cos(2 * Math.PI * vy * h))) : 1;
      const nk = [nc, -0.5 * nc, 0.3 * nc], j = (Y * w + X) * 4;
      for (let c = 0; c < 3; c++) {
        let col = y0 + (cs[c] - ys) * 1.05;
        col *= 1 - 0.22 * band;
        const e = (db - 0.03) / 0.006; col += 0.05 * Math.exp(-e * e);
        col += n * noise * 0.5 + nk[c] * noise * 0.25;
        col = col + (0.9 - col) * streak;
        out[j + c] = Math.round(clamp(col * vig * sl, 0, 1) * 255);
      }
      out[j + 3] = 255;
    }
  }
  return { w, h, data: out, gain: g };
}

// The live frame accumulator and the rate governor (DOM-free).
// o: { fps (target), min (10), budgetMs (feed render time), adapt
// (default true; false holds the target rate) }.
// tick(dt, costMs) -> true when a frame is due now.
export const LIVE_STEPS = [30, 24, 20, 15, 12, 10];
export function liveRate(o = {}) {
  const target = clamp(o.fps || 30, 5, 60), min = o.min || 10, budget = o.budgetMs ?? 3;
  const steps = [target, ...LIVE_STEPS.filter(s => s < target && s >= min)];
  const R = { fps: target, target, acc: 0, frames: 0, ema: 0, best: Infinity, slow: 0, good: 0, cost: 0, steps };
  R.tick = (dt) => {
    // the main frame time: a slow EMA, and the best one (the display rate)
    R.ema = R.ema ? R.ema + (dt - R.ema) * 0.1 : dt;
    R.best = Math.min(R.best * (1 + dt * 0.02), R.ema);
    const over = R.ema > R.best * 1.3 + 0.002 || R.cost > budget;
    if (over) { R.slow += dt; R.good = 0; } else { R.good += dt; R.slow = Math.max(0, R.slow - dt); }
    const i = steps.indexOf(R.fps);
    if (o.adapt !== false) {
      if (R.slow > 1 && i < steps.length - 1) { R.fps = steps[i + 1]; R.slow = 0; }
      else if (R.good > 4 && i > 0) { R.fps = steps[i - 1]; R.good = 0; }
    }
    const per = 1 / R.fps;
    R.acc += dt;
    if (R.acc < per) return false;
    R.acc -= per;
    if (R.acc > per) R.acc = 0;            // a long frame: no burst after it
    R.frames++;
    return true;
  };
  R.used = (ms) => { R.cost = R.cost ? R.cost + (ms - R.cost) * 0.2 : ms; };
  R.reset = () => { R.acc = 0; R.slow = 0; R.good = 0; R.ema = 0; R.best = Infinity; R.fps = target; };
  return R;
}

function makeCanvas(doc, w, h) {
  if (doc && doc.createElement) { const c = doc.createElement('canvas'); c.width = w; c.height = h; return c; }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// o: renderer, scene, getVehicle(id) -> vehicle, vehicle (id), mode
// ('live' | 'r8' | 'r36' | 'm1'; default 'r36'), size ([w, h] or { w, h,
// fps }, budget.js PROF.feed) and fps (live),
// budgetMs, speed, hold, seed, noise, canvas, document, dpr, worker
// (default true), source(vehicle), info(vehicle) -> { depth, heading, time },
// clearColour() -> THREE.Color (linear) the clear colour of the scene render
export function createFeed(THREE, o = {}) {
  const doc = o.document !== undefined ? o.document : (typeof document !== 'undefined' ? document : null);
  const dpr = o.dpr ?? Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
  const canvas = o.canvas || makeCanvas(doc, Math.round(HUD.W * dpr), Math.round(HUD.H * dpr));
  if (canvas && o.canvas) { canvas.width = Math.round(HUD.W * dpr); canvas.height = Math.round(HUD.H * dpr); }
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  let live = o.mode === 'live';
  const link = new SstvLink({ mode: live ? (o.sstv || 'r36') : (o.mode || 'r36'), seed: o.seed ?? 1, speed: o.speed ?? 2, hold: o.hold ?? 2.5, noise: o.noise });
  let pic = null, picCtx = null, picData = null;
  function makePic() {
    const m = link.mode;
    pic = makeCanvas(doc, m.W, m.H);
    picCtx = pic && pic.getContext ? pic.getContext('2d') : null;
    picData = picCtx && picCtx.createImageData ? picCtx.createImageData(m.W, m.H) : null;
  }
  makePic();
  const R = o.renderer || null, RW = 320, RH = 256;
  // o.size: [w, h] or { w, h, fps } (budget.js PROF.feed)
  const sz = o.size || null, LW = Math.round((sz && (sz.w ?? sz[0])) || 320), LH = Math.round((sz && (sz.h ?? sz[1])) || 240);
  const FPS = o.fps || (sz && sz.fps) || 30;
  let rt = null, rt8 = null, buf = null, post = null;
  const ext = R && R.extensions;
  const half = !!(R && R.capabilities && R.capabilities.isWebGL2 && ext && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')));
  const quadCam = THREE && R ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) : null;
  // The scene into a target, cleared to o.clearColour() (scene.js
  // hazeColour: the water, never black) when the page gives one. The old
  // clear colour (the main view black) comes back after the render.
  const clearWas = THREE && R ? new THREE.Color() : null;
  function drawScene(target, cam) {
    const cc = o.clearColour ? o.clearColour() : null, a = cc && R.getClearAlpha ? R.getClearAlpha() : 1;
    if (cc && R.getClearColor) { R.getClearColor(clearWas); R.setClearColor(cc, 1); }
    R.setRenderTarget(target); R.clear(true, true, false); R.render(o.scene, cam);
    if (cc && R.getClearColor) R.setClearColor(clearWas, a);
  }
  // the SSTV targets, on the first SSTV capture (live mode does not need them)
  function makeSstv() {
    if (rt || !R || !THREE) return;
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
    post = { mat, quad, sc, cam: quadCam };
  }
  // ── live: render targets and passes (made on first use) ────────────────────
  let L = null;
  function makeLive() {
    if (L || !R || !THREE) return L;
    const T = THREE;
    const rtLive = new T.WebGLRenderTarget(LW, LH, { type: half ? T.HalfFloatType : T.UnsignedByteType, depthBuffer: true, generateMipmaps: true, minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter });
    const g1 = () => new T.WebGLRenderTarget(1, 1, { type: T.UnsignedByteType, depthBuffer: false, minFilter: T.NearestFilter, magFilter: T.NearestFilter });
    const agcA = g1(), agcB = g1();
    const rtOut = new T.WebGLRenderTarget(LW, LH, { type: T.UnsignedByteType, depthBuffer: false, minFilter: T.LinearFilter, magFilter: T.LinearFilter });
    const levels = Math.floor(Math.log2(Math.max(LW, LH)));
    const mk = (fs, uniforms, extra = {}) => {
      const m = new T.ShaderMaterial(Object.assign({ uniforms, vertexShader: CURVE_VS, fragmentShader: fs, depthTest: false, depthWrite: false }, extra));
      const q = new T.Mesh(new T.PlaneGeometry(2, 2), m); q.frustumCulled = false;
      const s = new T.Scene(); s.add(q); return { m, q, s };
    };
    const agc = mk(AGC_FS, { map: { value: rtLive.texture }, prev: { value: agcA.texture }, lodMean: { value: levels }, lodHi: { value: Math.max(0, levels - 2) }, rate: { value: 0.2 } });
    const ana = mk(ANALOG_FS, { map: { value: rtLive.texture }, agc: { value: agcB.texture }, time: { value: 0 }, seed: { value: 0 }, noise: { value: 0.15 }, slant: { value: 0.012 }, bar: { value: 0 }, roll: { value: 0 }, res: { value: new T.Vector2(LW, LH) } });
    const blit = mk(BLIT_FS, { map: { value: rtOut.texture }, opacity: { value: 1 }, rows: { value: LH }, pxPerRow: { value: 2 } }, { transparent: true });
    L = { rtLive, agcA, agcB, rtOut, agc, ana, blit, v4: new T.Vector4(), s4: new T.Vector4(), v2: new T.Vector2(), ready: false };
    // the first AGC value: a gain of 8
    return L;
  }
  const rate = o.rate || liveRate({ fps: FPS, min: o.minFps || Math.min(10, FPS), budgetMs: o.budgetMs ?? 3, adapt: o.adapt });
  const external = o.drive === 'external';
  const look = { colour: o.colour || null, compact: !!o.compact };
  let active = true, liveT = 0, roll = 0, liveFrames = 0, fpsWin = [], livePic = null;
  const lr = { R: (o.seed ?? 1) * 9301 + 49297, slant: 0.012, bar: 0.2, glitch: 0, snr: 34 };
  const rnd = () => { lr.R = (lr.R * 16807) % 2147483647; return lr.R / 2147483647; };
  lr.slant = (rnd() < 0.5 ? -1 : 1) * (0.006 + 0.01 * rnd());

  let worker = null, pending = 0, reqId = 0, vid = o.vehicle ?? 1;
  const agc = { g: 8 };
  const onResult = (d) => {
    if (d.id !== reqId && d.id !== '*') return;   // a stale frame (mode or vehicle change); '*': the shared worker failed
    pending = 0;
    if (d.error) { worker = null; return; }
    link.beginSamples({ samples: d.samples, env: d.env, envHz: d.envHz, params: d.params });
  };
  function ensureWorker() {
    if (o.port) {
      // one worker for all the feeds (rov/feeds.js): post with the stream
      // key; a dead port leaves the encode on this thread
      if (!o.port.dead && !worker) {
        worker = { postMessage: (m, tr) => o.port.post(Object.assign(m, { stream: o.stream }), tr), terminate() {} };
        o.port.listen(o.stream, onResult);
      }
      return;
    }
    if (worker || o.worker === false || typeof Worker === 'undefined') return;
    try {
      worker = new Worker(new URL('./feed-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => onResult(e.data);
      worker.onerror = () => { worker = null; pending = 0; };
    } catch { worker = null; }
  }
  if (!live) ensureWorker();

  function capture(v) {
    const m = link.mode;
    if (R && v && v.camera) makeSstv();
    if (rt && v && v.camera) {
      const prev = R.getRenderTarget();
      v.camera.aspect = RW / RH; v.camera.updateProjectionMatrix();
      if (o.beforeCapture) o.beforeCapture(v);
      drawScene(rt, v.camera);
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
      try { worker.postMessage({ id: reqId, img: { w: img.w, h: img.h, data: img.data }, params }, [img.data.buffer]); return true; }
      catch { worker = null; pending = 0; }      // a dead shared worker: encode here
    }
    link.beginSamples(makeSamples(img, params));
    return true;
  }

  // One live frame: the scene from the vehicle camera, then the passes.
  function liveParams(dt) {
    // the signal: a slow walk of the SNR, and rare glitch bursts
    lr.snr = clamp(lr.snr + (rnd() - 0.5) * 2.2 * Math.sqrt(dt * 30) + (34 - lr.snr) * 0.02, 22, 42);
    if (lr.glitch > 0) lr.glitch -= dt; else if (rnd() < dt / 11) lr.glitch = 0.15 + 0.3 * rnd();
    lr.bar = fract(lr.bar - dt * 0.09);
    roll = Math.max(0, roll - dt * 2.2);
    const noise = clamp((40 - lr.snr) / 30, 0.04, 0.6) + (lr.glitch > 0 ? 0.35 : 0);
    return { time: liveT, seed: (lr.R % 997) / 997 * 100, noise, slant: lr.slant, bar: lr.bar, roll: roll > 0 ? (1 - Math.cos(roll * Math.PI)) * 0.5 : 0 };
  }
  function renderLive(dt) {
    const v = o.getVehicle ? o.getVehicle(vid) : null;
    const p = liveParams(dt);
    if (R && v && v.camera && makeLive()) {
      const t0 = nowMs(), prev = R.getRenderTarget(), au = R.shadowMap ? R.shadowMap.autoUpdate : null;
      v.camera.aspect = LW / LH; v.camera.updateProjectionMatrix();
      if (o.beforeCapture) o.beforeCapture(v);
      if (R.shadowMap) R.shadowMap.autoUpdate = false;           // the main frame made the shadow maps
      drawScene(L.rtLive, v.camera);
      if (R.shadowMap) R.shadowMap.autoUpdate = au;
      // AGC: B = mix(A, want); then swap so that prev is the newest
      L.agc.m.uniforms.prev.value = L.agcA.texture;
      L.agc.m.uniforms.rate.value = L.ready ? 1 - Math.exp(-Math.max(dt, 1 / 60) * 2.5) : 1;
      R.setRenderTarget(L.agcB); R.render(L.agc.s, quadCam);
      const U = L.ana.m.uniforms;
      U.agc.value = L.agcB.texture; U.time.value = p.time; U.seed.value = p.seed; U.noise.value = p.noise;
      U.slant.value = p.slant; U.bar.value = p.bar; U.roll.value = p.roll;
      R.setRenderTarget(L.rtOut); R.render(L.ana.s, quadCam);
      const t = L.agcA; L.agcA = L.agcB; L.agcB = t;
      R.setRenderTarget(prev);
      if (o.afterCapture) o.afterCapture(v);
      L.ready = true;
      rate.used(nowMs() - t0);
    } else if (o.source) {
      const s = o.source(v);
      if (s) livePic = analogFrame(s.data, s.w, s.h, p);
    }
    liveFrames++;
    fpsWin.push(liveT);
  }
  // Draw the live picture into the canvas at rect (CSS px of the main
  // canvas: x, y from the top left, w, h). Call after the main render.
  function present(rect, opacity = 1) {
    if (!live || !active || !R || !L || !L.ready || !rect || rect.w < 4 || rect.h < 4 || opacity <= 0.01) return false;
    const vp = R.getViewport(L.v4).clone(), sc = R.getScissor(L.s4).clone(), st = R.getScissorTest(), ac = R.autoClear, prev = R.getRenderTarget();
    const size = R.getSize(L.v2), H = size.y, pr = R.getPixelRatio();
    const x = Math.round(rect.x), y = Math.round(H - rect.y - rect.h), w = Math.round(rect.w), h = Math.round(rect.h);
    R.setRenderTarget(null); R.autoClear = false;
    R.setViewport(x, y, w, h); R.setScissor(x, y, w, h); R.setScissorTest(true);
    const U = L.blit.m.uniforms;
    U.opacity.value = opacity; U.pxPerRow.value = h * pr / LH;
    R.render(L.blit.s, quadCam);
    R.setScissorTest(st); R.setScissor(sc); R.setViewport(vp); R.autoClear = ac; R.setRenderTarget(prev);
    return true;
  }
  // The picture rect of the panel in CSS px, from the CSS rect of the
  // panel canvas: the live picture fills the HUD picture box at its aspect.
  function pictureRect(r) {
    const k = r.w / HUD.W, P = HUD.pic, ar = LW / LH;
    const ph = Math.min(P.h, Math.round(P.w / ar)), py = P.y + Math.round((P.h - ph) / 2);
    return { x: r.x + P.x * k, y: r.y + py * k, w: P.w * k, h: ph * k };
  }

  let since = 1, wall = 0, last = null;
  function liveStatus() {
    while (fpsWin.length && fpsWin[0] < liveT - 1) fpsWin.shift();
    const db = lr.snr - (lr.glitch > 0 ? 9 : 0);
    return { live: true, phase: 'live', mode: 'Live video', fps: fpsWin.length, target: rate.fps, frames: liveFrames, signal: { db, level: clamp((db + 6) / 48, 0, 1) }, glitch: lr.glitch > 0 };
  }
  function info() {
    const v = o.getVehicle ? o.getVehicle(vid) : null;
    const extra = o.info && v ? o.info(v) : {};
    return Object.assign({ id: vid, depth: 0, heading: 0, time: wall }, extra, { status: live ? liveStatus() : link.status(), t: wall });
  }
  // the panel redraw: 10 Hz (live; 5 Hz on a small card) or 20 Hz (SSTV)
  const hudO = (hole) => ({ hole, aspect: LW / LH, colour: look.colour, compact: look.compact });
  function update(dt) {
    wall += dt;
    if (live) {
      liveT += dt;
      if (!external && rate.tick(dt) && active) renderLive(Math.max(dt, 1 / rate.fps));
      since += dt;
      if (ctx && active && since >= (look.compact ? 0.2 : 0.1)) {
        since = 0;
        ctx.setTransform(canvas.width / HUD.W, 0, 0, canvas.height / HUD.H, 0, 0);
        last = drawHud(ctx, info(), null, hudO(true));
      }
      return 'live';
    }
    const st = link.advance(dt);
    if (st === 'need' && !pending && active && (!o.gate || o.gate())) startFrame();
    const rows = link.take();
    if (rows && picCtx && picData) { picData.data.set(link.picture); picCtx.putImageData(picData, 0, 0); }
    since += dt;
    if (ctx && active && (since >= (look.compact ? 0.1 : 0.05) || rows)) {
      since = 0;
      ctx.setTransform(canvas.width / HUD.W, 0, 0, canvas.height / HUD.H, 0, 0);
      last = drawHud(ctx, info(), pic, hudO(false));
    }
    return st;
  }
  // One live frame now (the feed set decides when): dt is the time since
  // the last live frame of this feed (the AGC and the signal walk use it).
  function liveFrame(dt) {
    if (!live || !active) return false;
    renderLive(Math.max(dt || 0, 1 / 60));
    return true;
  }
  return {
    canvas, link, HUD, rate,
    get live() { return live; },
    get mode() { return live ? 'live' : link.mode.id; },
    get picture() { return live ? (livePic || { w: LW, h: LH, data: null }) : { w: link.mode.W, h: link.mode.H, data: link.picture }; },
    get liveFrames() { return liveFrames; },
    get liveSize() { return [LW, LH]; },
    setVehicle(id) { if (id !== vid) { vid = id; reqId++; pending = 0; roll = 1; if (link.state !== 'rx') link.state = 'need'; } },
    get vehicle() { return vid; },
    setMode(id) {
      if (id === 'live') { if (!live) { live = true; reqId++; pending = 0; rate.reset(); since = 1; } return; }
      if (!byId(id)) return;
      const was = live; live = false; ensureWorker();
      reqId++; pending = 0;
      if (link.mode.id !== id) { link.setMode(id); makePic(); } else if (was) { link.state = 'need'; }
      since = 1;
    },
    setSpeed(s) { link.speed = s; },
    setActive(v) { active = !!v; },
    get active() { return active; },
    present, pictureRect,
    update, liveFrame,
    setLook(l = {}) { if ('colour' in l) look.colour = l.colour; if ('compact' in l) look.compact = !!l.compact; since = 1; },
    get look() { return Object.assign({}, look); },
    hud() { return hudFields(info()); },
    lastFields() { return last; },
    dispose() {
      if (worker) worker.terminate(); worker = null;
      if (rt) { rt.dispose(); rt8.dispose(); post.mat.dispose(); post.quad.geometry.dispose(); rt = null; }
      if (L) { for (const t of [L.rtLive, L.agcA, L.agcB, L.rtOut]) t.dispose(); for (const p of [L.agc, L.ana, L.blit]) { p.m.dispose(); p.q.geometry.dispose(); } L = null; }
    },
  };
}
