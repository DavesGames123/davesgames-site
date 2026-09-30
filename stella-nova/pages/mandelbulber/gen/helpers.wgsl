// helpers.wgsl — WGSL ports of the OpenCL helpers that the formulas call: C-semantics shims
// for OpenCL builtins (fmod, round, pow, copysign, cbrt, log10, isnan) and the functions of
// opencl/opencl_algebra.h (Matrix33MulFloat4, RotateAroundVectorByAngle4, SmoothConditionALessB, ...),
// translated by tools/translate.mjs. Do not edit.
// Ported from Mandelbulber2 (https://github.com/buddhi1980/mandelbulber2), upstream commit 600da8d.
// Copyright (C) Mandelbulber Team. GPL-3.0-or-later, see ../COPYING. Algebra authors: Krzysztof Marczak, Sebastian Jennen.
//
// grep: c_fmod_ c_round_ c_pow_ c_copysign_ c_cbrt_ c_log10_ c_isnan Matrix33MulFloat4 Matrix33MulFloat3 Matrix44TransformPoint Matrix33MulMatrix33 RotateX RotateY RotateZ RotateAroundVectorByAngle RotateAroundVectorByAngle4 TransposeMatrix SmoothConditionAGreaterB SmoothConditionALessB wrap opSmoothUnion vectorMod modRepeat LengthPow GetAlpha GetBeta
//
// Not ported (not used by any formula): RandomInt, RandomLong, Random, RandomL

// C fmod: x - y * trunc(x / y) (WGSL % would also do, kept explicit).
fn c_fmod_f32(x: f32, y: f32) -> f32 { return x - y * trunc(x / y); }

// C round: halfway cases away from zero (WGSL round() rounds them to even).
fn c_round_f32(x: f32) -> f32 { return sign(x) * floor(abs(x) + 0.5); }

fn c_cbrt_f32(x: f32) -> f32 { return sign(x) * pow(abs(x), (1.0 / 3.0)); }

fn c_log10_f32(x: f32) -> f32 { return log(x) * 0.43429448190325182; }

fn c_copysign_f32(x: f32, y: f32) -> f32 {
	return bitcast<f32>((bitcast<u32>(x) & 0x7fffffffu) | (bitcast<u32>(y) & 0x80000000u));
}

// C pow: a negative base with an integer exponent gives a real result.
fn c_pow_f32(x: f32, y: f32) -> f32 {
	if (y == 0.0) { return 1.0; }
	if (x >= 0.0) { return pow(x, y); }
	let r = pow(-x, y);
	if (floor(y) != y) { return pow(x, y); }
	if (floor(y * 0.5) * 2.0 == y) { return r; }
	return -r;
}

// C fmod: x - y * trunc(x / y) (WGSL % would also do, kept explicit).
fn c_fmod_vec2f(x: vec2f, y: vec2f) -> vec2f { return x - y * trunc(x / y); }

// C round: halfway cases away from zero (WGSL round() rounds them to even).
fn c_round_vec2f(x: vec2f) -> vec2f { return sign(x) * floor(abs(x) + 0.5); }

fn c_cbrt_vec2f(x: vec2f) -> vec2f { return sign(x) * pow(abs(x), vec2f(1.0 / 3.0)); }

fn c_log10_vec2f(x: vec2f) -> vec2f { return log(x) * 0.43429448190325182; }

fn c_copysign_vec2f(x: vec2f, y: vec2f) -> vec2f { return vec2f(c_copysign_f32(x.x, y.x), c_copysign_f32(x.y, y.y)); }

fn c_pow_vec2f(x: vec2f, y: vec2f) -> vec2f { return vec2f(c_pow_f32(x.x, y.x), c_pow_f32(x.y, y.y)); }

// C fmod: x - y * trunc(x / y) (WGSL % would also do, kept explicit).
fn c_fmod_vec3f(x: vec3f, y: vec3f) -> vec3f { return x - y * trunc(x / y); }

// C round: halfway cases away from zero (WGSL round() rounds them to even).
fn c_round_vec3f(x: vec3f) -> vec3f { return sign(x) * floor(abs(x) + 0.5); }

fn c_cbrt_vec3f(x: vec3f) -> vec3f { return sign(x) * pow(abs(x), vec3f(1.0 / 3.0)); }

fn c_log10_vec3f(x: vec3f) -> vec3f { return log(x) * 0.43429448190325182; }

fn c_copysign_vec3f(x: vec3f, y: vec3f) -> vec3f { return vec3f(c_copysign_f32(x.x, y.x), c_copysign_f32(x.y, y.y), c_copysign_f32(x.z, y.z)); }

fn c_pow_vec3f(x: vec3f, y: vec3f) -> vec3f { return vec3f(c_pow_f32(x.x, y.x), c_pow_f32(x.y, y.y), c_pow_f32(x.z, y.z)); }

// C fmod: x - y * trunc(x / y) (WGSL % would also do, kept explicit).
fn c_fmod_vec4f(x: vec4f, y: vec4f) -> vec4f { return x - y * trunc(x / y); }

// C round: halfway cases away from zero (WGSL round() rounds them to even).
fn c_round_vec4f(x: vec4f) -> vec4f { return sign(x) * floor(abs(x) + 0.5); }

fn c_cbrt_vec4f(x: vec4f) -> vec4f { return sign(x) * pow(abs(x), vec4f(1.0 / 3.0)); }

fn c_log10_vec4f(x: vec4f) -> vec4f { return log(x) * 0.43429448190325182; }

fn c_copysign_vec4f(x: vec4f, y: vec4f) -> vec4f { return vec4f(c_copysign_f32(x.x, y.x), c_copysign_f32(x.y, y.y), c_copysign_f32(x.z, y.z), c_copysign_f32(x.w, y.w)); }

fn c_pow_vec4f(x: vec4f, y: vec4f) -> vec4f { return vec4f(c_pow_f32(x.x, y.x), c_pow_f32(x.y, y.y), c_pow_f32(x.z, y.z), c_pow_f32(x.w, y.w)); }

fn c_isnan(x: f32) -> i32 { return i32((bitcast<u32>(x) & 0x7fffffffu) > 0x7f800000u); }
fn c_isinf(x: f32) -> i32 { return i32((bitcast<u32>(x) & 0x7fffffffu) == 0x7f800000u); }
fn c_isfinite(x: f32) -> i32 { return i32((bitcast<u32>(x) & 0x7fffffffu) < 0x7f800000u); }

fn Matrix33MulFloat4(matrix: matrix33, vect: vec4f) -> vec4f {
	var out: vec4f;
	out.x = dot(vect.xyz, matrix.m1);
	out.y = dot(vect.xyz, matrix.m2);
	out.z = dot(vect.xyz, matrix.m3);
	out.w = vect.w;
	return out;
}

fn Matrix33MulFloat3(matrix: matrix33, vect: vec3f) -> vec3f {
	var out: vec3f;
	out.x = dot(vect.xyz, matrix.m1);
	out.y = dot(vect.xyz, matrix.m2);
	out.z = dot(vect.xyz, matrix.m3);
	return out;
}

fn Matrix44TransformPoint(matrix: matrix44, point: vec3f) -> vec3f {
	var out: vec3f;
	out.x = dot(vec4f(point.x, point.y, point.z, 1.0), matrix.r1);
	out.y = dot(vec4f(point.x, point.y, point.z, 1.0), matrix.r2);
	out.z = dot(vec4f(point.x, point.y, point.z, 1.0), matrix.r3);
	return out;
}

fn Matrix33MulMatrix33(m1: matrix33, m2: matrix33) -> matrix33 {
	var out: matrix33;
	out.m1.x = (((m1.m1.x * m2.m1.x) + (m1.m1.y * m2.m2.x)) + (m1.m1.z * m2.m3.x));
	out.m1.y = (((m1.m1.x * m2.m1.y) + (m1.m1.y * m2.m2.y)) + (m1.m1.z * m2.m3.y));
	out.m1.z = (((m1.m1.x * m2.m1.z) + (m1.m1.y * m2.m2.z)) + (m1.m1.z * m2.m3.z));
	out.m2.x = (((m1.m2.x * m2.m1.x) + (m1.m2.y * m2.m2.x)) + (m1.m2.z * m2.m3.x));
	out.m2.y = (((m1.m2.x * m2.m1.y) + (m1.m2.y * m2.m2.y)) + (m1.m2.z * m2.m3.y));
	out.m2.z = (((m1.m2.x * m2.m1.z) + (m1.m2.y * m2.m2.z)) + (m1.m2.z * m2.m3.z));
	out.m3.x = (((m1.m3.x * m2.m1.x) + (m1.m3.y * m2.m2.x)) + (m1.m3.z * m2.m3.x));
	out.m3.y = (((m1.m3.x * m2.m1.y) + (m1.m3.y * m2.m2.y)) + (m1.m3.z * m2.m3.y));
	out.m3.z = (((m1.m3.x * m2.m1.z) + (m1.m3.y * m2.m2.z)) + (m1.m3.z * m2.m3.z));
	return out;
}

fn RotateX(m: matrix33, angle: f32) -> matrix33 {
	var out: matrix33;
	var rot: matrix33;
	var s: f32 = sin(angle);
	var c: f32 = cos(angle);
	rot.m1 = vec3f(1.0, 0.0, 0.0);
	rot.m2 = vec3f(0.0, c, -s);
	rot.m3 = vec3f(0.0, s, c);
	out = Matrix33MulMatrix33(m, rot);
	return out;
}

fn RotateY(m: matrix33, angle: f32) -> matrix33 {
	var out: matrix33;
	var rot: matrix33;
	var s: f32 = sin(angle);
	var c: f32 = cos(angle);
	rot.m1 = vec3f(c, 0.0, s);
	rot.m2 = vec3f(0.0, 1.0, 0.0);
	rot.m3 = vec3f(-s, 0.0, c);
	out = Matrix33MulMatrix33(m, rot);
	return out;
}

fn RotateZ(m: matrix33, angle: f32) -> matrix33 {
	var out: matrix33;
	var rot: matrix33;
	var s: f32 = sin(angle);
	var c: f32 = cos(angle);
	rot.m1 = vec3f(c, -s, 0.0);
	rot.m2 = vec3f(s, c, 0.0);
	rot.m3 = vec3f(0.0, 0.0, 1.0);
	out = Matrix33MulMatrix33(m, rot);
	return out;
}

fn RotateAroundVectorByAngle(origin: vec3f, axis: vec3f, angle: f32) -> vec3f {
	var vector: vec3f = (origin * cos(angle));
	vector += (cross(axis, origin) * sin(angle));
	vector += ((axis * dot(axis, origin)) * (1.0 - cos(angle)));
	return vector;
}

fn RotateAroundVectorByAngle4(origin4d: vec4f, axis: vec3f, angle: f32) -> vec4f {
	var origin: vec3f = origin4d.xyz;
	var vector: vec3f = (origin * cos(angle));
	vector += (cross(axis, origin) * sin(angle));
	vector += ((axis * dot(axis, origin)) * (1.0 - cos(angle)));
	return vec4f(vector.x, vector.y, vector.z, origin4d.w);
}

fn TransposeMatrix(m: matrix33) -> matrix33 {
	var out: matrix33;
	out.m1 = vec3f(m.m1.x, m.m2.x, m.m3.x);
	out.m2 = vec3f(m.m1.y, m.m2.y, m.m3.y);
	out.m3 = vec3f(m.m1.z, m.m2.z, m.m3.z);
	return out;
}

fn SmoothConditionAGreaterB(a: f32, b: f32, sharpness: f32) -> f32 {
	return (1.0 / (1.0 + exp((sharpness * (b - a)))));
}

fn SmoothConditionALessB(a: f32, b: f32, sharpness: f32) -> f32 {
	return (1.0 / (1.0 + exp((sharpness * (a - b)))));
}

fn wrap(x_in: vec3f, a: vec3f, s: vec3f) -> vec3f {
	var x: vec3f = x_in;
	x -= s;
	var out: vec3f;
	out.x = ((x.x - (a.x * floor((x.x / a.x)))) + s.x);
	out.y = ((x.y - (a.y * floor((x.y / a.y)))) + s.y);
	out.z = ((x.z - (a.z * floor((x.z / a.z)))) + s.z);
	return out;
}

fn opSmoothUnion(d1: f32, d2: f32, k: f32) -> f32 {
	var h: f32 = clamp((0.5 + ((0.5 * (d2 - d1)) / k)), 0.0, 1.0);
	return (mix(d2, d1, h) - ((k * h) * (1.0 - h)));
}

fn vectorMod(vector1: vec3f, vector2: vec3f) -> vec3f {
	return vec3f(select(vector1.x, c_fmod_f32(vector1.x, vector2.x), (vector2.x > 0.0)), select(vector1.y, c_fmod_f32(vector1.y, vector2.y), (vector2.y > 0.0)), select(vector1.z, c_fmod_f32(vector1.z, vector2.z), (vector2.z > 0.0)));
}

fn modRepeat(vector1: vec3f, repeat: vec3f) -> vec3f {
	if ((length(repeat) == 0.0)) {
		return vector1;
	}
	return (vectorMod((vectorMod((vector1 - (repeat * 0.5)), repeat) + repeat), repeat) - (repeat * 0.5));
}

fn LengthPow(vect: vec2f, p: f32) -> f32 {
	return c_pow_f32((c_pow_f32(vect.x, p) + c_pow_f32(vect.y, p)), (1.0 / p));
}

fn GetAlpha(vect: vec3f) -> f32 {
	return atan2(vect.y, vect.x);
}

fn GetBeta(vect: vec3f) -> f32 {
	return atan2(vect.z, length(vect.xy));
}
