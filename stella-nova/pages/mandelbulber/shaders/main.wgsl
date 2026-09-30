// main.wgsl - the per-sample render entry point: camera ray, ray marching, shading, and
// accumulation of one jittered sample per pixel into ACC.
// Ported from Mandelbulber v2 opencl/engines/full_engine.cl (fractal3D), ray_recursion.cl
// (RayMarching and the shading half of RayRecursion) and projection_3d.cl.
// Copyright (C) 2017-24 Mandelbulber Team. Authors: Krzysztof Marczak (buddhi1980@gmail.com).
// Mandelbulber is free software under the GNU General Public License v3 or later.
// This port is also GPL-3.0. See COPYING in the page folder.
//
// Each dispatch renders one sample for one band: the 8-row stripes s of the image with
// s % bandCount == bandIndex. Interleaved stripes keep every dispatch large enough to fill the
// GPU, and give each band about the same cost. The accumulation keeps the sum of samples;
// present.wgsl divides by the sample count.
// Not ported: reflections and refraction recursion (one ray level only), DOF, stereo,
// chromatic aberration, rough surface texture paths, optional image channels.
//
// grep: RayMarchingOut RayMarching CalculateViewVector renderSample engHash probeRays PROBE

struct RayMarchingOut {
  point: vec3f,
  lastDist: f32,
  depth: f32,
  distThresh: f32,
  found: bool,
  count: i32,
}

fn RayMarching(start: vec3f, direction: vec3f, minScan: f32, maxScan: f32) -> RayMarchingOut {
  var out: RayMarchingOut;
  var found = false;
  var count = 0;
  var point: vec3f;
  var scan = minScan;
  var distance = 0.0;

  var calcParam: CalcParams;
  calcParam.N = P.N;
  calcParam.normalCalculationMode = 0;
  calcParam.iterThreshMode = P.iterThreshMode;
  var distThresh = 1e-6;
  var step = 0.0;

  let searchAccuracy = 0.001 * P.detailLevel;
  let searchLimit = 1.0 - searchAccuracy;

  // ray-marching (the preview caps the step count and uses a 2x coarser threshold)
  var maxSteps = P.maxRaymarching;
  var threshScale = 1.0;
  if (P.previewMode != 0u) { maxSteps = min(maxSteps, 1000); threshScale = 2.0; }
  for (count = 0; count < maxSteps && scan < maxScan; count++) {
    point = start + direction * scan;
    distThresh = CalcDistThresh(point) * threshScale;
    calcParam.distThresh = distThresh;
    calcParam.detailSize = distThresh;
    let outF = CalculateDistance(point, &calcParam);
    distance = outF.distance;

    if (distance < distThresh) {
      found = true;
      break;
    }

    if (P.interiorMode != 0) {
      step = (distance - 0.8 * distThresh) * P.DEFactor;
    } else {
      step = (distance - 0.5 * distThresh) * P.DEFactor;
    }
    step *= (1.0 - f32(RandomS(1000)) / 10000.0);

    if (P.advancedQuality != 0) {
      step = clamp(step, P.absMinMarchingStep, P.absMaxMarchingStep);
      if (distThresh > P.absMinMarchingStep) {
        step = clamp(step, P.relMinMarchingStep * distThresh, P.relMaxMarchingStep * distThresh);
      }
    }
    scan += step / length(direction);
  }

  point = start + direction * scan;

  // final binary searching
  if (found) {
    step *= 0.5;
    for (var i = 0; i < 30; i++) {
      if (distance < distThresh && distance > distThresh * searchLimit) {
        break;
      } else {
        if (distance > distThresh) {
          scan += step;
          point = start + direction * scan;
        } else if (distance < distThresh * searchLimit) {
          scan -= step;
          point = start + direction * scan;
        }
      }
      let outF = CalculateDistance(point, &calcParam);
      distance = outF.distance;
      step *= 0.5;
    }
  }

  out.found = found;
  out.lastDist = distance;
  out.depth = scan;
  out.distThresh = distThresh;
  out.point = point;
  out.count = count;
  return out;
}

// projection_3d.cl
fn CalculateViewVector(normalizedPoint: vec2f, fov: f32) -> vec3f {
  var viewVector: vec3f;
  if (P.perspectiveType == 1 || P.perspectiveType == 3) { // PERSP_FISH_EYE (_CUT)
    let v = normalizedPoint;
    let r = length(v);
    if (r == 0.0) {
      viewVector = vec3f(0.0, 1.0, 0.0);
    } else {
      viewVector.x = v.x / r * sin(r * fov);
      viewVector.z = v.y / r * sin(r * fov);
      viewVector.y = cos(r * fov);
    }
    viewVector = normalize(viewVector);
  } else if (P.perspectiveType == 2) { // PERSP_EQUIRECTANGULAR
    let v = normalizedPoint * 0.5;
    viewVector.x = sin(fov * v.x) * cos(fov * v.y);
    viewVector.z = sin(fov * v.y);
    viewVector.y = cos(fov * v.x) * cos(fov * v.y);
    viewVector = normalize(viewVector);
  } else { // PERSP_THREE_POINT
    viewVector.x = normalizedPoint.x * fov;
    viewVector.y = 1.0;
    viewVector.z = normalizedPoint.y * fov;
    viewVector = normalize(viewVector);
  }
  return viewVector;
}

fn engHash(x: u32) -> u32 {
  var h = x;
  h ^= h >> 16u;
  h *= 0x7feb352du;
  h ^= h >> 15u;
  h *= 0x846ca68bu;
  h ^= h >> 16u;
  return h;
}

@compute @workgroup_size(8, 8, 1)
fn renderSample(@builtin(global_invocation_id) gid: vec3u) {
  let widthI = u32(P.width);
  let heightI = u32(P.height);
  let imageX = gid.x;
  let stripe = (gid.y / 8u) * P.bandCount + P.bandIndex;
  let imageY = stripe * 8u + gid.y % 8u;
  if (imageX >= widthI || imageY >= heightI) { return; }
  let buffIndex = imageX + imageY * widthI;

  // randomizing random seed
  engRandomSeed = engHash(imageX + imageY * widthI + engHash(P.frameSeed + P.sampleIndex * 0x9e3779b9u));
  for (var i = 0; i < 3; i++) { _ = RandomS(1000); }

  let width = P.width;
  let height = P.height;

  var aspectRatio = width / height;
  if (P.perspectiveType == 2) { aspectRatio = 2.0; }

  var normalizedScreenPoint: vec2f;
  normalizedScreenPoint.x = (f32(imageX) / width - 0.5);
  normalizedScreenPoint.y = -(f32(imageY) / height - 0.5);
  if (P.legacyCoordinateSystem != 0) { normalizedScreenPoint.y *= -1.0; }
  normalizedScreenPoint.x *= aspectRatio;

  // MONTE_CARLO_ANTI_ALIASING: the first sample shoots through the pixel corner as upstream
  if (P.jitterEnable != 0u) {
    normalizedScreenPoint.x += (f32(RandomS(1000)) / 1000.0 - 0.5) / width * aspectRatio;
    normalizedScreenPoint.y += (f32(RandomS(1000)) / 1000.0 - 0.5) / height;
  }

  let viewVectorNotRotated = CalculateViewVector(normalizedScreenPoint, P.fov);
  let viewVector = vec3f(dot(viewVectorNotRotated, P.rotM1), dot(viewVectorNotRotated, P.rotM2),
    dot(viewVectorNotRotated, P.rotM3));

  var hemisphereCut = false;
  if (P.perspectiveType == 3) {
    if (length(normalizedScreenPoint) > 3.14159265 * 0.5 / P.fov) { hemisphereCut = true; }
  }

  let start = P.camera;
  let direction = normalize(viewVector);

  var resultShader = vec4f(0.0);
  if (hemisphereCut) {
    if (P.sampleIndex == 0u) { ACC[buffIndex] = resultShader; }
    return;
  }

  let rm = RayMarching(start, direction, 0.0, P.viewDistanceMax);
  let point = rm.point;

  var calcParam: CalcParams;
  calcParam.N = P.N;
  calcParam.normalCalculationMode = 0;
  calcParam.iterThreshMode = P.iterThreshMode;

  var input: ShaderInput;
  input.distThresh = CalcDistThresh(point);
  input.delta = CalcDelta(point);
  input.point = point;
  input.viewVector = direction;
  input.normal = direction;
  input.lastDist = rm.lastDist;
  input.depth = rm.depth;
  input.invertMode = false;
  input.stepCount = rm.count;

  calcParam.distThresh = input.distThresh;
  calcParam.detailSize = input.delta;

  if (rm.found) {
    var normal = NormalVector(input.point, input.lastDist, input.distThresh, input.invertMode, &calcParam);
    if (P.material.roughSurface != 0) {
      let roughness = P.material.surfaceRoughness;
      normal.x += roughness * (f32(RandomS(20000)) / 10000.0 - 1.0);
      normal.x += roughness * (f32(RandomS(20000)) / 10000.0 - 1.0);
      normal.y += roughness * (f32(RandomS(20000)) / 10000.0 - 1.0);
      normal.y += roughness * (f32(RandomS(20000)) / 10000.0 - 1.0);
      normal.z += roughness * (f32(RandomS(20000)) / 10000.0 - 1.0);
      normal.z += roughness * (f32(RandomS(20000)) / 10000.0 - 1.0);
      normal = normalize(normal);
    }
    input.normal = normal;

    calcParam.distThresh = input.distThresh;
    calcParam.detailSize = input.delta;

    var gradients: Gradients;
    var objectColour = vec3f(0.0);
    var specular = vec3f(0.0);
    var shadow = vec3f(1.0);
    let objectShader = ObjectShader(&input, &calcParam, &objectColour, &specular, &shadow, &gradients);
    resultShader = vec4f(max(objectShader, vec3f(0.0)), 1.0);
  } else {
    resultShader = vec4f(BackgroundShader(&input), 0.0);
  }

  var opacityOut = 0.0;
  resultShader = VolumetricShader(&input, &calcParam, resultShader, &opacityOut);

  // a NaN or infinite sample would poison the whole accumulation of this pixel
  var safe = resultShader;
  for (var c = 0; c < 4; c++) {
    if (engIsNan(safe[c]) || engIsInf(safe[c])) { safe[c] = 0.0; }
  }
  // sample 0 overwrites, so a reset needs no buffer clear and a preview can roll on
  if (P.sampleIndex == 0u) { ACC[buffIndex] = safe; } else { ACC[buffIndex] += safe; }
}

// Probe rays for the Frame action (engine.js frameView). This part is not upstream code.
// PROBE[2i] = (origin, maxScan) and PROBE[2i + 1] = (direction, out); the entry writes the
// hit distance to out, or -1 when the ray finds no surface.
@group(0) @binding(4) var<storage, read_write> PROBE: array<vec4f>;

@compute @workgroup_size(64, 1, 1)
fn probeRays(@builtin(global_invocation_id) gid: vec3u) {
  let n = arrayLength(&PROBE) / 2u;
  if (gid.x >= n) { return; }
  let o = PROBE[2u * gid.x];
  let d = PROBE[2u * gid.x + 1u];
  engRandomSeed = engHash(gid.x + 1u);
  let rm = RayMarching(o.xyz, normalize(d.xyz), 0.0, o.w);
  var hit = -1.0;
  if (rm.found) { hit = rm.depth; }
  PROBE[2u * gid.x + 1u] = vec4f(d.xyz, hit);
}
