// ============================================================================
//  PROTEIN VIEWER  ·  post.js — ambient occlusion, outlines, fog, tone map
// ────────────────────────────────────────────────────────────────────────────
//  Three passes over full-screen triangles:
//    1. scene ..... the molecule into a float colour target with a depth
//                   texture (linear light, no tone map)
//    2. ao ........ at half size: rebuild the view-space point and normal
//                   from depth, test 14 points in the normal hemisphere
//                   (rotated per pixel on a 4x4 pattern), and count how
//                   many sit behind the depth buffer
//    3. composite . a 4x4 depth-aware blur of the AO (it cancels the 4x4
//                   pattern), depth-edge outlines, depth fog into the
//                   background gradient, a filmic tone curve, sRGB, dither;
//                   Post.fade (0..1) mixes all of it into the background
//  A transparent surface writes no depth, so it gets no AO or outline.
//  On a screen of pixel ratio below 1.5 the scene target is 1.5x larger,
//  for a little supersampling.
//
//  grep: export class Post  const AO_FRAG  const COMP_FRAG  function kernel
// ============================================================================
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const AO_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform mat4 proj, invProj;
uniform vec3 kern[14];
uniform float radius;
vec3 viewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  vec4 v = invProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
void main() {
  float d = texture2D(tDepth, vUv).x;
  if (d >= 1.0) { gl_FragColor = vec4(1.0); return; }
  vec3 p = viewPos(vUv);
  vec3 pr = viewPos(vUv + vec2(texel.x, 0.0)), pl = viewPos(vUv - vec2(texel.x, 0.0));
  vec3 pu = viewPos(vUv + vec2(0.0, texel.y)), pd = viewPos(vUv - vec2(0.0, texel.y));
  vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
  vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
  vec3 n = normalize(cross(dx, dy));
  // a 4x4 rotation pattern, cancelled by the 4x4 blur in the composite
  vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
  float ang = (cell.x * 4.0 + cell.y) * 0.3926991 + 0.37;
  vec3 rv = vec3(cos(ang), sin(ang), 0.0);
  vec3 t = normalize(rv - n * dot(rv, n));
  vec3 b = cross(n, t);
  mat3 tbn = mat3(t, b, n);
  float occ = 0.0;
  for (int i = 0; i < 14; i++) {
    vec3 sp = p + tbn * kern[i] * radius;
    vec4 c = proj * vec4(sp, 1.0);
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    float sz = viewPos(suv).z;
    float range = smoothstep(0.0, 1.0, radius / max(abs(p.z - sz), 1e-3));
    occ += (sz >= sp.z + 0.12 ? 1.0 : 0.0) * range;
  }
  gl_FragColor = vec4(vec3(1.0 - occ / 14.0), 1.0);
}`;

const COMP_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor, tDepth, tAO;
uniform vec2 aoTexel, px, res;
uniform float near, far, aoAmt, edgeAmt, fogNear, fogFar, fogAmt, ortho, fade;
uniform vec3 bgIn, bgOut, edgeCol;
float linZ(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * near * far / (far + near - z * (far - near));
}
vec3 bg(vec2 uv) {
  vec2 q = (uv - vec2(0.55, 0.6)) * vec2(res.x / res.y, 1.0);
  return mix(bgIn, bgOut, smoothstep(0.0, 1.25, length(q)));
}
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec4 col = texture2D(tColor, vUv);
  float d = texture2D(tDepth, vUv).x;
  vec3 back = bg(vUv);
  // the target holds premultiplied colour (alpha blending over clear black)
  vec3 c = col.rgb + back * (1.0 - clamp(col.a, 0.0, 1.0));
  {
    if (d < 1.0) {
      float zc = linZ(d);
      // AO, blurred over 4x4 half-size texels, skipping other depths
      float sum = 0.0, wsum = 0.0;
      for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) {
        vec2 o = (vec2(float(i), float(j)) - 1.5) * aoTexel;
        float zs = linZ(texture2D(tDepth, vUv + o).x);
        float w = 1.0 / (1.0 + abs(zs - zc) * 2.0);
        sum += texture2D(tAO, vUv + o).r * w; wsum += w;
      }
      float ao = sum / max(wsum, 1e-4);
      c *= mix(1.0, ao * ao, aoAmt);
      // outlines where depth jumps
      float e = 0.0;
      for (int k = 0; k < 4; k++) {
        vec2 o = k == 0 ? vec2(px.x, 0.0) : k == 1 ? vec2(-px.x, 0.0) : k == 2 ? vec2(0.0, px.y) : vec2(0.0, -px.y);
        float zn = linZ(texture2D(tDepth, vUv + o).x);
        e = max(e, (zn - zc) / zc);
      }
      e = smoothstep(0.012, 0.05, e) * edgeAmt;
      c = mix(c, edgeCol, e);
      // fog into the background
      float f = smoothstep(fogNear, fogFar, zc) * fogAmt;
      c = mix(c, back, f);
    }
  }
  // fade: 0 = the scene, 1 = only the background (the screensaver hook)
  c = mix(c, back, fade);
  c = srgb(aces(c * 1.05));
  // dither against banding in the dark gradient
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;

function kernel(n) {
  const out = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    let v;
    do { v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd()); } while (v.lengthSq() > 1 || v.lengthSq() < 0.01);
    v.normalize();
    const s = i / n;
    v.multiplyScalar(0.15 + 0.85 * s * s);
    v.z = Math.max(v.z, 0.12);
    out.push(v);
  }
  return out;
}

export class Post {
  constructor(renderer, coarse) {
    this.r = renderer;
    this.coarse = coarse;
    const gl = renderer.getContext();
    const floatOK = !!(renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
    this.type = floatOK ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: this.type, depthTexture: this.depth, depthBuffer: true, samples: 0 });
    this.rt.texture.minFilter = this.rt.texture.magFilter = THREE.LinearFilter;
    this.depth.minFilter = this.depth.magFilter = THREE.NearestFilter;
    this.aoRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.aoRT.texture.minFilter = this.aoRT.texture.magFilter = THREE.LinearFilter;
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.aoMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: AO_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tDepth: { value: this.depth }, texel: { value: new THREE.Vector2() }, proj: { value: new THREE.Matrix4() }, invProj: { value: new THREE.Matrix4() }, kern: { value: kernel(14) }, radius: { value: 4 } },
    });
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: COMP_FRAG, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: {
        tColor: { value: this.rt.texture }, tDepth: { value: this.depth }, tAO: { value: this.aoRT.texture },
        aoTexel: { value: new THREE.Vector2() }, px: { value: new THREE.Vector2() }, res: { value: new THREE.Vector2() },
        near: { value: 1 }, far: { value: 100 }, aoAmt: { value: 0.85 }, edgeAmt: { value: 0.75 },
        fogNear: { value: 50 }, fogFar: { value: 100 }, fogAmt: { value: 0.85 }, ortho: { value: 0 }, fade: { value: 0 },
        bgIn: { value: new THREE.Color('#161a2a') }, bgOut: { value: new THREE.Color('#05060a') }, edgeCol: { value: new THREE.Color('#020306') },
      },
    });
    this.aoQ = new THREE.Mesh(tri, this.aoMat); this.aoQ.frustumCulled = false;
    this.compQ = new THREE.Mesh(tri, this.compMat); this.compQ.frustumCulled = false;
    this.aoScene = new THREE.Scene(); this.aoScene.add(this.aoQ);
    this.compScene = new THREE.Scene(); this.compScene.add(this.compQ);
    this.opts = { ao: true, outline: true, fog: true };
    this.w = this.h = 0;
    this.fade = 0;   // 0..1, the molecule fades into the background
  }
  setSize(w, h, dpr) {
    const ss = !this.coarse && dpr < 1.5 ? 1.5 : 1;
    const W = Math.max(1, Math.round(w * dpr * ss)), H = Math.max(1, Math.round(h * dpr * ss));
    if (W === this.w && H === this.h) return;
    this.w = W; this.h = H;
    this.rt.setSize(W, H);
    const aw = Math.max(1, Math.round(W / 2)), ah = Math.max(1, Math.round(H / 2));
    this.aoRT.setSize(aw, ah);
    this.aoMat.uniforms.texel.value.set(1 / aw, 1 / ah);
    const u = this.compMat.uniforms;
    u.aoTexel.value.set(1 / aw, 1 / ah);
    const th = Math.max(1, dpr * ss * 0.8);
    u.px.value.set(th / W, th / H);
    u.res.value.set(W, H);
  }
  // fog: the near and far view depths of the molecule's bounding sphere
  render(scene, camera, fog) {
    const r = this.r, u = this.compMat.uniforms;
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    r.render(scene, camera);
    if (this.opts.ao) {
      this.aoMat.uniforms.proj.value.copy(camera.projectionMatrix);
      this.aoMat.uniforms.invProj.value.copy(camera.projectionMatrixInverse);
      r.setRenderTarget(this.aoRT);
      r.render(this.aoScene, this.cam);
    }
    u.near.value = camera.near; u.far.value = camera.far;
    u.aoAmt.value = this.opts.ao ? 0.9 : 0;
    u.edgeAmt.value = this.opts.outline ? 0.8 : 0;
    u.fogAmt.value = this.opts.fog ? 0.78 : 0;
    u.fogNear.value = fog[0]; u.fogFar.value = fog[1];
    u.fade.value = this.fade;
    r.setRenderTarget(null);
    r.render(this.compScene, this.cam);
  }
  set aoRadius(v) { this.aoMat.uniforms.radius.value = v; }
  dispose() {
    this.rt.dispose(); this.aoRT.dispose(); this.depth.dispose();
    this.aoMat.dispose(); this.compMat.dispose(); this.aoQ.geometry.dispose();
  }
}
