// ============================================================================
//  DLA TERRAIN  ·  gpu/upscale.js — the upscale pass of the frame graph (CORE)
// ----------------------------------------------------------------------------
//  When the render size is under the swap chain size (the dynamic scale,
//  the Safari near-ground pixel cap), render/post.js writes its LDR result
//  at the render size into a mid target, and this pass draws it to the swap
//  chain. Before, the post composite sampled the render-size image with
//  one bilinear tap per output pixel: a plain stretch (the user: the
//  "pixelated" trees at 1036 x 654 in a 2000 px window).
//
//  The filter (an EASU-like upscale, AMD FSR 1 is the model, the code is
//  our own): a 4 x 4 Catmull-Rom (bicubic) filter, clamped to the min and
//  max of the 2 x 2 nearest texels (no ringing halos), then a contrast
//  adaptive sharpen against the bilinear value (RCAS-like: less sharpen on
//  high-contrast edges, so no new aliasing). One pass, 16 loads a pixel.
//
//  createUpscaler(device, format) -> null (no pipeline API, a fake device)
//    or up = { ready, bindGroup(view), draw(enc, srcBindGroup, outView),
//    setSharpness(k) }. The pipeline is made with createRenderPipelineAsync
//    when there is one; up.ready is false until then and frame.js keeps
//    the old path (post to the swap chain).
//
//  grep -n targets: "export const UPSCALE_WGSL", "export function createUpscaler",
//  "fn up_fs", "fn up_cr"
// ============================================================================

export const UPSCALE_SHARPEN = 0.35;

export const UPSCALE_WGSL = /* wgsl */`
@group(0) @binding(0) var upSrc: texture_2d<f32>;
@group(0) @binding(1) var<uniform> upU: vec4f;   // x sharpen 0..1

struct UpOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn up_vs(@builtin(vertex_index) i: u32) -> UpOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: UpOut;
  o.pos = vec4f((p * 2.0) - vec2f(1.0), 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

fn up_ld(p: vec2i, mx: vec2i) -> vec3f {
  return textureLoad(upSrc, clamp(p, vec2i(0), mx), 0).rgb;
}

// Catmull-Rom weights of the taps -1, 0, 1, 2 at the fraction t
fn up_cr(t: f32) -> vec4f {
  let t2 = t * t;
  let t3 = t2 * t;
  return vec4f((-0.5 * t3) + t2 - (0.5 * t), (1.5 * t3) - (2.5 * t2) + 1.0,
    (-1.5 * t3) + (2.0 * t2) + (0.5 * t), (0.5 * t3) - (0.5 * t2));
}

@fragment fn up_fs(v: UpOut) -> @location(0) vec4f {
  let sz = vec2f(textureDimensions(upSrc));
  let mx = vec2i(sz) - vec2i(1);
  let p = (v.uv * sz) - vec2f(0.5);
  let fl = floor(p);
  let b = vec2i(fl);
  let f = p - fl;
  let wx = up_cr(f.x);
  let wy = up_cr(f.y);
  var c = vec3f(0.0);
  for (var j = 0; j < 4; j++) {
    var row = vec3f(0.0);
    for (var i = 0; i < 4; i++) {
      row += up_ld(b + vec2i(i - 1, j - 1), mx) * wx[i];
    }
    c += row * wy[j];
  }
  // the 2 x 2 nearest texels: the clamp range and the bilinear value
  let a00 = up_ld(b, mx);
  let a10 = up_ld(b + vec2i(1, 0), mx);
  let a01 = up_ld(b + vec2i(0, 1), mx);
  let a11 = up_ld(b + vec2i(1, 1), mx);
  let lo = min(min(a00, a10), min(a01, a11));
  let hi = max(max(a00, a10), max(a01, a11));
  let bil = mix(mix(a00, a10, f.x), mix(a01, a11, f.x), f.y);
  c = clamp(c, lo, hi);
  // the contrast adaptive sharpen: amount from the local range (RCAS-like)
  let l = dot(hi - lo, vec3f(0.299, 0.587, 0.114));
  let amt = clamp(upU.x, 0.0, 1.0) * (1.0 - smoothstep(0.08, 0.5, l));
  c = clamp(c + ((c - bil) * amt), lo, hi);
  return vec4f(c, 1.0);
}
`;

export function createUpscaler(device, format) {
  if (!device || typeof device.createShaderModule !== 'function' || typeof device.createBindGroupLayout !== 'function'
    || (typeof device.createRenderPipelineAsync !== 'function' && typeof device.createRenderPipeline !== 'function')) return null;
  const F = (typeof GPUShaderStage !== 'undefined') ? GPUShaderStage.FRAGMENT : 2;
  const BU = (typeof GPUBufferUsage !== 'undefined') ? GPUBufferUsage : { UNIFORM: 64, COPY_DST: 8 };
  const up = { ready: false, failed: false, pipe: null };
  try {
    const module = device.createShaderModule({ label: 'upscale', code: UPSCALE_WGSL });
    const layout = device.createBindGroupLayout({
      label: 'upscale',
      entries: [
        { binding: 0, visibility: F, texture: { sampleType: 'float' } },
        { binding: 1, visibility: F, buffer: { type: 'uniform' } },
      ],
    });
    const ubuf = device.createBuffer({ label: 'upscale U', size: 16, usage: BU.UNIFORM | BU.COPY_DST });
    const desc = {
      label: 'upscale', layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'up_vs' },
      fragment: { module, entryPoint: 'up_fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    };
    up.setSharpness = k => { device.queue.writeBuffer(ubuf, 0, new Float32Array([k, 0, 0, 0])); };
    up.setSharpness(UPSCALE_SHARPEN);
    up.bindGroup = view => device.createBindGroup({ label: 'upscale', layout, entries: [{ binding: 0, resource: view }, { binding: 1, resource: { buffer: ubuf } }] });
    up.draw = (enc, group, outView) => {
      const p = enc.beginRenderPass({ label: 'upscale', colorAttachments: [{ view: outView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      p.setPipeline(up.pipe); p.setBindGroup(0, group); p.draw(3); p.end();
    };
    const done = pipe => { if (pipe) { up.pipe = pipe; up.ready = true; if (up.onReady) up.onReady(); } };
    const fail = e => { up.failed = true; console.warn('dla-terrain: the upscale pass is off', e); };
    if (typeof device.createRenderPipelineAsync === 'function') {
      const pr = device.createRenderPipelineAsync(desc);
      if (pr && typeof pr.then === 'function') pr.then(done, fail); else done(pr);
    } else done(device.createRenderPipeline(desc));
  } catch (e) { console.warn('dla-terrain: no upscale pass', e); return null; }
  return up;
}
