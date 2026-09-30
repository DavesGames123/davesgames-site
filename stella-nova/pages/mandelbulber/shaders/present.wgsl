// present.wgsl - full-screen pass: average the accumulated samples, upscale the preview, and
// apply the image adjustments (brightness, contrast, HDR tone curve, saturation, gamma).
// The adjustments are ported from Mandelbulber v2 src/cimage.cpp (cImage::CalculatePixel),
// with the parameters of opencl/image_adjustments_cl.h.
// Copyright (C) 2017-24 Mandelbulber Team. Authors: Krzysztof Marczak (buddhi1980@gmail.com).
// Mandelbulber is free software under the GNU General Public License v3 or later.
// This port is also GPL-3.0. See COPYING in the page folder.
//
// grep: PresentParams ImageAdjust presentVertex presentFragment

struct PresentParams {
  renderWidth: f32,
  renderHeight: f32,
  canvasWidth: f32,
  canvasHeight: f32,
  invSamples: f32,
  brightness: f32,
  contrast: f32,
  imageGamma: f32,
  saturation: f32,
  hdrEnabled: i32,
  pad0: f32,
  pad1: f32,
}

@group(0) @binding(0) var<uniform> PP: PresentParams;
@group(0) @binding(1) var<storage, read> ACCR: array<vec4f>;

struct VSOut {
  @builtin(position) pos: vec4f,
}

@vertex
fn presentVertex(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VSOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  return o;
}

fn fetchAcc(x: i32, y: i32) -> vec3f {
  let w = i32(PP.renderWidth);
  let h = i32(PP.renderHeight);
  let xx = clamp(x, 0, w - 1);
  let yy = clamp(y, 0, h - 1);
  return ACCR[xx + yy * w].xyz * PP.invSamples;
}

// cImage::CalculatePixel
fn ImageAdjust(pixel: vec3f) -> vec3f {
  var c = pixel * PP.brightness;
  c = (c - 0.5) * PP.contrast + 0.5;
  c = max(c, vec3f(0.0));
  if (PP.hdrEnabled != 0) { c = tanh(c); }
  let V = sqrt(c.r * c.r * 0.299 + c.g * c.g * 0.587 + c.b * c.b * 0.114);
  c = V + (c - V) * PP.saturation;
  c = clamp(c, vec3f(0.0), vec3f(1.0));
  return pow(c, vec3f(1.0 / PP.imageGamma));
}

@fragment
fn presentFragment(in: VSOut) -> @location(0) vec4f {
  let sx = in.pos.x * PP.renderWidth / PP.canvasWidth - 0.5;
  let sy = in.pos.y * PP.renderHeight / PP.canvasHeight - 0.5;
  var c: vec3f;
  if (PP.renderWidth == PP.canvasWidth && PP.renderHeight == PP.canvasHeight) {
    c = fetchAcc(i32(in.pos.x), i32(in.pos.y));
  } else {
    // bilinear upscale of the low resolution preview
    let x0 = i32(floor(sx));
    let y0 = i32(floor(sy));
    let fx = sx - floor(sx);
    let fy = sy - floor(sy);
    let a = mix(fetchAcc(x0, y0), fetchAcc(x0 + 1, y0), fx);
    let b = mix(fetchAcc(x0, y0 + 1), fetchAcc(x0 + 1, y0 + 1), fx);
    c = mix(a, b, fy);
  }
  return vec4f(ImageAdjust(c), 1.0);
}
