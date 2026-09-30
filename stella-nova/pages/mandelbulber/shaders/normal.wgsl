// normal.wgsl - surface normal from central differences of the distance estimate.
// Ported from Mandelbulber v2 opencl/engines/normal_vector.cl (the default path; the
// SLOW_SHADING path that sums pseudo distances over a 11x11x11 grid is not ported).
// Copyright (C) 2017-24 Mandelbulber Team. Authors: Krzysztof Marczak (buddhi1980@gmail.com).
// Mandelbulber is free software under the GNU General Public License v3 or later.
// This port is also GPL-3.0. See COPYING in the page folder.
//
// grep: NormalVector

fn NormalVector(point: vec3f, mainDistance: f32, distThresh: f32, invertMode: bool,
  calcParam: ptr<function, CalcParams>) -> vec3f {
  var delta = distThresh * P.smoothness;
  if (P.interiorMode != 0) { delta = (*calcParam).distThresh * 0.2 * P.smoothness; }

  (*calcParam).distThresh = distThresh;
  (*calcParam).detailSize = distThresh;
  (*calcParam).normalCalculationMode = 1;

  let s0 = CalculateDistance(point + vec3f(delta, 0.0, 0.0), calcParam).distance;
  let s1 = CalculateDistance(point + vec3f(-delta, 0.0, 0.0), calcParam).distance;
  let s2 = CalculateDistance(point + vec3f(0.0, delta, 0.0), calcParam).distance;
  let s3 = CalculateDistance(point + vec3f(0.0, -delta, 0.0), calcParam).distance;
  let s4 = CalculateDistance(point + vec3f(0.0, 0.0, delta), calcParam).distance;
  let s5 = CalculateDistance(point + vec3f(0.0, 0.0, -delta), calcParam).distance;

  var normal = vec3f(s0 - s1, s2 - s3, s4 - s5);
  let len = length(normal);
  if (len > 0.0) { normal = normal / len; } else { normal = vec3f(0.0, 0.0, 1.0); }
  (*calcParam).normalCalculationMode = 0;

  if (invertMode) { normal *= -1.0; }
  return normal;
}
