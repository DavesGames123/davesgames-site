// ============================================================================
//  CORAL REEF  ·  bloom.js  ·  the bloom of the bright emissive light
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "the bioluminescence across organisms is
//  poorly done. bloom on textures please". A mip-chain bloom on the HDR
//  scene target, before the tone map (shaders.js COMP_FS):
//    1. prefilter .. BLOOM_PRE_FS at half size: 4 texel taps of the scene,
//                    each through bright() (a threshold in exposed units
//                    with a soft knee), averaged
//    2. down ....... BLOOM_DOWN_FS: a 13-tap filter (weights sum to 1) to
//                    the next half size, levels - 1 times
//    3. up ......... BLOOM_UP_FS: up_i = (1 - mix) x down_i + mix x tent9
//                    (up_i+1). The level weights (1 - mix), mix (1 - mix),
//                    ..., mix^(n-1) sum to 1: a small mix keeps the glow
//                    tight (photophores are small)
//    4. COMP_FS .... c += strength x (bloom - bright(scene)): the bright
//                    part is spread, not added, so the light in the frame
//                    stays the same (energy conserving)
//  Only light over the threshold blooms: photophores, the esca, glowing
//  jellies, the lamp bezels and the ROV LEDs. Lit rock is at about the
//  exposure key (0.25 exposed, gpu-safe.js exposureFrom) and gives 0. The
//  marine snow of the main frame draws after the tone map (not in it).
//
//  CPU TWIN. bright, prefilter, down13, upTent and bloomCPU do the same
//  sums as the shaders (bilinear taps with clamp to the edge), so node
//  tests can check the threshold and the energy (tests/bioglow.test.mjs).
//
//  API
//    BLOOM_K ................ thresh, knee (exposed units), mix, strength
//    BLOOM_PROFILE[id] ...... { levels, strength } (phone-min: off)
//    createBloom(THREE, { tri, ortho, profile }) -> { size(w, h),
//      render(renderer, sceneTex, exposure) (false when off), texture,
//      strength, levels, targets, dispose() }
//
//  grep -n targets: "export const BLOOM_PRE_FS", "export const BLOOM_DOWN_FS",
//  "export const BLOOM_UP_FS", "export function bloomCPU", "export function createBloom"
// ============================================================================

export const BLOOM_K = { thresh: 1.8, knee: 0.6, mix: 0.35, strength: 0.45 };
export const BLOOM_PROFILE = {
  desktop: { levels: 5, strength: BLOOM_K.strength },
  'laptop-low': { levels: 4, strength: BLOOM_K.strength },
  phone: { levels: 3, strength: BLOOM_K.strength * 0.8 },
  'phone-min': { levels: 3, strength: 0 },
};

// the soft-knee threshold (exposed units) on the largest channel
const BRIGHT = /* glsl */`
vec3 bright(vec3 c, float e, float t, float k) {
  float br = max(c.r, max(c.g, c.b)) * e;
  float rq = clamp(br - t + k, 0.0, 2.0 * k);
  rq = rq * rq / (4.0 * k + 1e-5);
  return c * clamp(max(rq, br - t) / max(br, 1e-5), 0.0, 1.0);
}`;
export const BLOOM_BRIGHT = BRIGHT;

export const BLOOM_PRE_FS = /* glsl */`
precision highp float;
in vec2 vUv;
out vec4 oCol;
uniform sampler2D uSrc;
uniform vec2 uSrcSize;
uniform float uExposure, uThresh, uKnee;
${BRIGHT}
vec3 tap(vec2 p) {
  vec3 c = texture(uSrc, (p + 0.5) / uSrcSize).rgb;
  if (any(isnan(c)) || any(isinf(c))) return vec3(0.0);
  return bright(clamp(c, 0.0, 64.0), uExposure, uThresh, uKnee);
}
void main() {
  vec2 p = floor(gl_FragCoord.xy) * 2.0;
  vec3 s = tap(p) + tap(p + vec2(1.0, 0.0)) + tap(p + vec2(0.0, 1.0)) + tap(p + vec2(1.0, 1.0));
  oCol = vec4(s * 0.25, 1.0);
}`;

export const BLOOM_DOWN_FS = /* glsl */`
precision highp float;
in vec2 vUv;
out vec4 oCol;
uniform sampler2D uSrc;
uniform vec2 uTexel;
vec3 t(float x, float y) { return texture(uSrc, vUv + vec2(x, y) * uTexel).rgb; }
void main() {
  vec3 A = t(-2.0, -2.0), B = t(0.0, -2.0), C = t(2.0, -2.0), D = t(-1.0, -1.0), E = t(1.0, -1.0);
  vec3 F = t(-2.0, 0.0), G = t(0.0, 0.0), H = t(2.0, 0.0), I = t(-1.0, 1.0), J = t(1.0, 1.0);
  vec3 K = t(-2.0, 2.0), L = t(0.0, 2.0), M = t(2.0, 2.0);
  vec3 r = (D + E + I + J) * 0.125 + (A + B + F + G + B + C + G + H + F + G + K + L + G + H + L + M) * 0.03125;
  oCol = vec4(r, 1.0);
}`;

export const BLOOM_UP_FS = /* glsl */`
precision highp float;
in vec2 vUv;
out vec4 oCol;
uniform sampler2D uSrc, uDown;
uniform vec2 uTexel;
uniform float uMix;
vec3 t(float x, float y) { return texture(uSrc, vUv + vec2(x, y) * uTexel).rgb; }
void main() {
  vec3 tent = (t(-1.0, -1.0) + t(1.0, -1.0) + t(-1.0, 1.0) + t(1.0, 1.0)
    + 2.0 * (t(0.0, -1.0) + t(-1.0, 0.0) + t(1.0, 0.0) + t(0.0, 1.0)) + 4.0 * t(0.0, 0.0)) / 16.0;
  oCol = vec4((1.0 - uMix) * texture(uDown, vUv).rgb + uMix * tent, 1.0);
}`;

// ── the CPU twin (RGB Float32Array images, row 0 at the bottom) ─────────────
export function brightCPU(c, e, t = BLOOM_K.thresh, k = BLOOM_K.knee) {
  const br = Math.max(c[0], c[1], c[2]) * e;
  let rq = Math.min(2 * k, Math.max(0, br - t + k)); rq = rq * rq / (4 * k + 1e-5);
  const w = Math.min(1, Math.max(0, Math.max(rq, br - t) / Math.max(br, 1e-5)));
  return [c[0] * w, c[1] * w, c[2] * w];
}
const half = n => Math.max(1, n >> 1);
export function sampleCPU(img, w, h, u, v) {
  const x = u * w - 0.5, y = v * h - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const cx = i => Math.min(w - 1, Math.max(0, i)), cy = j => Math.min(h - 1, Math.max(0, j));
  const o = [0, 0, 0];
  for (const [i, j, wt] of [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]]) {
    const q = (cy(j) * w + cx(i)) * 3;
    o[0] += img[q] * wt; o[1] += img[q + 1] * wt; o[2] += img[q + 2] * wt;
  }
  return o;
}
export function prefilterCPU(img, w, h, e, t, k) {
  const W = half(w), H = half(h), out = new Float32Array(W * H * 3);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let r = 0, g = 0, b = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const x = Math.min(w - 1, i * 2 + dx), y = Math.min(h - 1, j * 2 + dy), q = (y * w + x) * 3;
      const c = brightCPU([Math.min(64, Math.max(0, img[q])), Math.min(64, Math.max(0, img[q + 1])), Math.min(64, Math.max(0, img[q + 2]))], e, t, k);
      r += c[0]; g += c[1]; b += c[2];
    }
    const o = (j * W + i) * 3; out[o] = r / 4; out[o + 1] = g / 4; out[o + 2] = b / 4;
  }
  return { img: out, w: W, h: H };
}
export function down13CPU(src) {
  const { img, w, h } = src, W = half(w), H = half(h), out = new Float32Array(W * H * 3);
  const taps = [[-1, -1, 0.125], [1, -1, 0.125], [-1, 1, 0.125], [1, 1, 0.125], [-2, -2, 0.03125], [0, -2, 0.0625], [2, -2, 0.03125], [-2, 0, 0.0625], [0, 0, 0.125], [2, 0, 0.0625], [-2, 2, 0.03125], [0, 2, 0.0625], [2, 2, 0.03125]];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const u = (i + 0.5) / W, v = (j + 0.5) / H, o = (j * W + i) * 3;
    for (const [dx, dy, wt] of taps) { const c = sampleCPU(img, w, h, u + dx / w, v + dy / h); out[o] += c[0] * wt; out[o + 1] += c[1] * wt; out[o + 2] += c[2] * wt; }
  }
  return { img: out, w: W, h: H };
}
export function upTentCPU(coarse, down, mix) {
  const { w, h } = down, out = new Float32Array(w * h * 3);
  const taps = [[-1, -1, 1], [0, -1, 2], [1, -1, 1], [-1, 0, 2], [0, 0, 4], [1, 0, 2], [-1, 1, 1], [0, 1, 2], [1, 1, 1]];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const u = (i + 0.5) / w, v = (j + 0.5) / h, o = (j * w + i) * 3;
    const d = sampleCPU(down.img, w, h, u, v), tn = [0, 0, 0];
    for (const [dx, dy, wt] of taps) { const c = sampleCPU(coarse.img, coarse.w, coarse.h, u + dx / coarse.w, v + dy / coarse.h); tn[0] += c[0] * wt / 16; tn[1] += c[1] * wt / 16; tn[2] += c[2] * wt / 16; }
    for (let k = 0; k < 3; k++) out[o + k] = (1 - mix) * d[k] + mix * tn[k];
  }
  return { img: out, w, h };
}
// the whole chain and the composite: { bright (full), bloom (half), out (full) }
export function bloomCPU(img, w, h, o = {}) {
  const e = o.exposure ?? 4, t = o.thresh ?? BLOOM_K.thresh, k = o.knee ?? BLOOM_K.knee, mix = o.mix ?? BLOOM_K.mix, s = o.strength ?? BLOOM_K.strength, n = o.levels ?? 5;
  const downs = [prefilterCPU(img, w, h, e, t, k)];
  for (let i = 1; i < n; i++) downs.push(down13CPU(downs[i - 1]));
  let up = downs[n - 1];
  for (let i = n - 2; i >= 0; i--) up = upTentCPU(up, downs[i], mix);
  const bright = new Float32Array(w * h * 3), out = new Float32Array(w * h * 3);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const q = (j * w + i) * 3, c = [img[q], img[q + 1], img[q + 2]], b = brightCPU(c.map(v => Math.min(64, Math.max(0, v))), e, t, k);
    const bl = sampleCPU(up.img, up.w, up.h, (i + 0.5) / w, (j + 0.5) / h);
    for (let m = 0; m < 3; m++) { bright[q + m] = b[m]; out[q + m] = Math.max(0, c[m] + s * (bl[m] - b[m])); }
  }
  return { bright, bloom: up, out, levels: downs.map(d => [d.w, d.h]) };
}

// ── the GPU passes ──────────────────────────────────────────────────────────
export function createBloom(THREE, o = {}) {
  const P = BLOOM_PROFILE[o.profile] || BLOOM_PROFILE.desktop;
  const n = Math.max(1, P.levels), FULL_VS = o.vs;
  const opts = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const downs = Array.from({ length: n }, () => new THREE.WebGLRenderTarget(1, 1, opts));
  const ups = Array.from({ length: Math.max(0, n - 1) }, () => new THREE.WebGLRenderTarget(1, 1, opts));
  const mk = (fs, u) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FULL_VS, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false });
  const preU = { uSrc: { value: null }, uSrcSize: { value: new THREE.Vector2(1, 1) }, uExposure: { value: 4 }, uThresh: { value: BLOOM_K.thresh }, uKnee: { value: BLOOM_K.knee } };
  const downU = { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() } };
  const upU = { uSrc: { value: null }, uDown: { value: null }, uTexel: { value: new THREE.Vector2() }, uMix: { value: BLOOM_K.mix } };
  const pre = mk(BLOOM_PRE_FS, preU), down = mk(BLOOM_DOWN_FS, downU), upM = mk(BLOOM_UP_FS, upU);
  const mesh = new THREE.Mesh(o.tri, pre); mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);
  const B = {
    strength: P.strength, levels: n, targets: downs.length + ups.length, thresh: preU.uThresh, knee: preU.uKnee, mix: upU.uMix,
    get texture() { return (n > 1 ? ups[0] : downs[0]).texture; },
    size(w, h) {
      let W = w, H = h;
      for (let i = 0; i < n; i++) { W = Math.max(1, W >> 1); H = Math.max(1, H >> 1); downs[i].setSize(W, H); if (i < n - 1) ups[i].setSize(W, H); }
      preU.uSrcSize.value.set(w, h);
    },
    render(renderer, src, exposure) {
      if (!(B.strength > 0)) return false;
      preU.uSrc.value = src; preU.uExposure.value = exposure;
      mesh.material = pre; renderer.setRenderTarget(downs[0]); renderer.render(scene, o.ortho);
      mesh.material = down;
      for (let i = 1; i < n; i++) { downU.uSrc.value = downs[i - 1].texture; downU.uTexel.value.set(1 / downs[i - 1].width, 1 / downs[i - 1].height); renderer.setRenderTarget(downs[i]); renderer.render(scene, o.ortho); }
      mesh.material = upM;
      let s = downs[n - 1];
      for (let i = n - 2; i >= 0; i--) { upU.uSrc.value = s.texture; upU.uDown.value = downs[i].texture; upU.uTexel.value.set(1 / s.width, 1 / s.height); renderer.setRenderTarget(ups[i]); renderer.render(scene, o.ortho); s = ups[i]; }
      return true;
    },
    dispose() { for (const t of [...downs, ...ups]) t.dispose(); pre.dispose(); down.dispose(); upM.dispose(); },
  };
  return B;
}
