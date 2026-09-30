// calculate_distance.wgsl - distance estimation around ComputeFractal: analytic DE, delta DE,
// DE thresholds, limits and the view distance minimum.
// Ported from Mandelbulber v2 opencl/engines/calculate_distance.cl.
// Copyright (C) 2017-24 Mandelbulber Team. Authors: Krzysztof Marczak (buddhi1980@gmail.com).
// Mandelbulber is free software under the GNU General Public License v3 or later.
// This port is also GPL-3.0. See COPYING in the page folder.
//
// The objects tree (boolean nodes, primitives, per-node transforms) is not ported: the scene is
// one fractal object, with the legacy fractal_position / fractal_rotation / repeat transform.
//
// grep: CalcDistThresh CalcDelta CalculateDistanceSimple CalculateDistance engModRepeat

fn CalcDistThresh(point: vec3f) -> f32 {
  var distThresh: f32;
  if (P.iterThreshMode != 0) {
    distThresh = length(P.camera - point) * P.resolution * P.fov;
  } else {
    if (P.constantDEThreshold != 0) {
      distThresh = P.DEThresh;
    } else {
      distThresh = length(P.camera - point) * P.resolution * P.fov / P.detailLevel;
    }
  }
  if (P.perspectiveType == 2) { distThresh *= 0.5; } // PERSP_EQUIRECTANGULAR
  if (P.advancedQuality != 0) {
    distThresh = clamp(distThresh, P.detailSizeMin, P.detailSizeMax);
  } else {
    distThresh = max(distThresh, 1e-6);
  }
  return distThresh;
}

// calculation of "voxel" size
fn CalcDelta(point: vec3f) -> f32 {
  var delta = length(P.camera - point) * P.resolution * P.fov;
  if (P.perspectiveType == 2) { delta *= 0.5; }
  delta = max(delta, 1e-6);
  return delta;
}

fn engVectorMod(v1: vec3f, v2: vec3f) -> vec3f {
  var out = v1;
  if (v2.x > 0.0) { out.x = v1.x - v2.x * trunc(v1.x / v2.x); }
  if (v2.y > 0.0) { out.y = v1.y - v2.y * trunc(v1.y / v2.y); }
  if (v2.z > 0.0) { out.z = v1.z - v2.z * trunc(v1.z / v2.z); }
  return out;
}

fn engModRepeat(v: vec3f, repeat: vec3f) -> vec3f {
  if (length(repeat) == 0.0) { return v; }
  return engVectorMod(engVectorMod(v - repeat * 0.5, repeat) + repeat, repeat) - repeat * 0.5;
}

// bit tests, because a WGSL compiler may assume that floats are never NaN or infinite
fn engIsNan(x: f32) -> bool { return (bitcast<u32>(x) & 0x7fffffffu) > 0x7f800000u; }
fn engIsInf(x: f32) -> bool { return (bitcast<u32>(x) & 0x7fffffffu) == 0x7f800000u; }

fn CalculateDistanceSimple(point: vec3f, calcParam: ptr<function, CalcParams>) -> FormulaOut {
  var out: FormulaOut;
  out.z = vec4f(0.0);
  out.iters = 0.0;
  out.distance = 0.0;
  out.colorIndex = 0.0;
  out.orbitTrapR = 0.0;
  out.maxiter = false;

  if (P.DEType == 0) {
    // ANALYTIC_DE
    out = ComputeFractal(point, calcParam, calcModeNormal);
    var maxiter = out.maxiter;

    // don't use maxiter when limits are disabled and iterThresh mode is not used
    if (P.iterThreshMode == 0) { maxiter = false; }
    // never use maxiter if normal vectors are calculated
    if ((*calcParam).normalCalculationMode != 0) { maxiter = false; }
    if (maxiter) { out.distance = 0.0; }

    if (out.iters < f32(P.minN) && out.distance < (*calcParam).detailSize) {
      out.distance = (*calcParam).detailSize;
    }

    if (P.interiorMode != 0) {
      if ((*calcParam).normalCalculationMode == 0) {
        if (out.distance < 0.5 * (*calcParam).detailSize || maxiter) {
          out.distance = (*calcParam).detailSize;
          out.maxiter = false;
        }
      } else {
        if (out.distance < 0.9 * (*calcParam).detailSize) {
          out.distance = (*calcParam).detailSize - out.distance;
          out.maxiter = false;
        }
      }
    }

    if (P.iterThreshMode != 0 && (*calcParam).normalCalculationMode == 0 && !maxiter) {
      if (out.distance < (*calcParam).detailSize) {
        out.distance = (*calcParam).detailSize * 1.01;
      }
    }

    if (engIsNan(out.distance)) { out.distance = 0.0; }
    if (engIsInf(out.distance)) { out.distance = 0.0; }
    if (out.distance < 0.0) { out.distance = 0.0; }
    if (out.distance > 5.0) { out.distance = 5.0; }
  } else {
    // DELTA_DE
    var delta: f32;
    if (P.advancedQuality != 0) {
      delta = max(length(point) * 1.0e-6, (*calcParam).detailSize * P.deltaDERelativeDelta);
    } else {
      delta = max(length(point) * 1.0e-6, (*calcParam).detailSize * 0.1);
    }
    var dr = vec3f(0.0);

    out = ComputeFractal(point, calcParam, calcModeDeltaDE1);
    (*calcParam).deltaDEMaxN = i32(out.iters) - 1;
    let r = length(out.z);
    let zFromIters = out.z;

    var maxiter = out.maxiter;
    if (P.limitsEnabled == 0) {
      if (P.iterThreshMode == 0) { maxiter = false; }
    } else {
      if ((*calcParam).normalCalculationMode != 0) { maxiter = false; }
    }

    var deltas = array<vec3f, 6>(
      vec3f(delta, 0.0, 0.0), vec3f(-delta, 0.0, 0.0),
      vec3f(0.0, delta, 0.0), vec3f(0.0, -delta, 0.0),
      vec3f(0.0, 0.0, delta), vec3f(0.0, 0.0, -delta));

    var rDelta: array<f32, 6>;
    for (var k = 0; k < 6; k++) {
      rDelta[k] = length(ComputeFractal(point + deltas[k], calcParam, calcModeDeltaDE2).z);
      if (engIsNan(rDelta[k]) || engIsInf(rDelta[k])) { rDelta[k] = 0.0; }
    }
    dr.x = min(abs(rDelta[0] - r), abs(rDelta[1] - r)) / delta;
    dr.y = min(abs(rDelta[2] - r), abs(rDelta[3] - r)) / delta;
    dr.z = min(abs(rDelta[4] - r), abs(rDelta[5] - r)) / delta;

    let d = length(dr);

    if (engIsInf(r) || engIsInf(d) || engIsNan(r) || engIsNan(d) || d < 1e-10) {
      out.distance = (*calcParam).detailSize;
    } else {
      switch (P.DEFunctionType) {
        case 2: { // DELTA_LOG_DE
          out.distance = 0.5 * r * log(r) / d;
        }
        case 3: { // DELTA_PSEUDO_KLEINIAN_DE
          let rxy = sqrt(out.z.x * out.z.x + out.z.y * out.z.y);
          out.distance = max(rxy - 0.92784, abs(rxy * out.z.z) / r) / d;
        }
        case 4: { // DELTA_JOS_KLEINIAN_DE
          let zz = out.z;
          let rxy = sqrt(zz.x * zz.x + zz.z * zz.z);
          out.distance = (abs(rxy * zz.y) / r) / d;
          out.maxiter = false;
        }
        case 6: { // DELTA_MAXAXIS_DE
          let absZ = abs(zFromIters);
          let maxZ = max(max(absZ.x, absZ.y), absZ.z);
          let maxDr = max(max(abs(dr.x), abs(dr.y)), abs(dr.z));
          out.distance = 0.5 * maxZ / maxDr;
        }
        default: { // DELTA_LINEAR_DE (and custom dIFS, which has no delta branch upstream)
          out.distance = 0.5 * r / d;
        }
      }
    }

    if (P.iterThreshMode == 0) { maxiter = false; }
    if ((*calcParam).normalCalculationMode != 0) { maxiter = false; }
    if (maxiter) { out.distance = 0.0; }

    if (out.iters < f32(P.minN) && out.distance < (*calcParam).detailSize) {
      out.distance = (*calcParam).detailSize;
    }

    if (P.interiorMode != 0) {
      if ((*calcParam).normalCalculationMode == 0) {
        if (out.distance < 0.5 * (*calcParam).detailSize || maxiter) {
          out.distance = (*calcParam).detailSize;
          out.maxiter = false;
        }
      } else {
        if (out.distance < 0.9 * (*calcParam).detailSize) {
          out.distance = (*calcParam).detailSize - out.distance;
          out.maxiter = false;
        }
      }
    }

    if (P.iterThreshMode != 0 && (*calcParam).normalCalculationMode == 0 && !maxiter) {
      if (out.distance < (*calcParam).detailSize) {
        out.distance = (*calcParam).detailSize * 1.01;
      }
    }

    if (engIsNan(out.distance)) { out.distance = 0.0; }
    if (out.distance < 0.0) { out.distance = 0.0; }
    if (out.distance > 5.0) { out.distance = 5.0; }
  }
  return out;
}

// the legacy per-scene fractal transform (fractal_position, fractal_rotation, repeat)
fn FractalLocalPoint(point: vec3f) -> vec3f {
  let p = point - P.fractalPosition;
  let pr = vec3f(dot(p, P.mRotFractal1), dot(p, P.mRotFractal2), dot(p, P.mRotFractal3));
  return engModRepeat(pr, P.repeat);
}

fn CalculateDistance(point: vec3f, calcParam: ptr<function, CalcParams>) -> FormulaOut {
  var out: FormulaOut;
  out.z = vec4f(0.0);
  out.iters = 0.0;
  out.distance = 0.0;
  out.colorIndex = 0.0;
  out.orbitTrapR = 0.0;
  out.maxiter = false;

  var limitBoxDist = 0.0;
  if (P.limitsEnabled != 0) {
    let boxDistance = max(point - P.limitMax, -(point - P.limitMin));
    limitBoxDist = max(max(boxDistance.x, boxDistance.y), boxDistance.z);
    if (limitBoxDist > (*calcParam).detailSize) {
      out.maxiter = false;
      out.distance = limitBoxDist;
      out.iters = 0.0;
      return out;
    }
  }

  out = CalculateDistanceSimple(FractalLocalPoint(point), calcParam);

  if (P.limitsEnabled != 0) {
    if (limitBoxDist < (*calcParam).detailSize) {
      out.distance = max(out.distance, limitBoxDist);
    }
  }

  let distFromCamera = length(point - P.camera);
  let distanceLimitMin = P.viewDistanceMin - distFromCamera;
  out.distance = max(out.distance, distanceLimitMin);
  if (distanceLimitMin > (*calcParam).detailSize) {
    out.maxiter = false;
    out.iters = 0.0;
  }
  return out;
}
