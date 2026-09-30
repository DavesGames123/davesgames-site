// tinker_towers.wgsl — override for Mandelbulber2 formula TinkerTowers.
// Upstream formula/opencl/tinker_towers.cl points a `__global REAL3 *u_Fv` at one of eight
// genFoldBox arrays of different lengths, chosen by genFoldBox.type. WGSL has no pointer to a
// storage array of unknown length, so tt_fv() selects the array with a switch and returns the
// i-th facet vector. tt_sides() returns the matching facet count, clamped to the array length.
// Upstream also fills a local `REAL mag_Fv[64]` with the same value (offset05) at every index,
// and reads it only at indices below sides. This port reads that value directly, so the result
// is the same.
// Ported from Mandelbulber2 (https://github.com/buddhi1980/mandelbulber2), upstream commit 600da8d.
// Copyright (C) Mandelbulber Team. GPL-3.0-or-later, see ../COPYING.
//   GeneralizedFoldBoxIteration - Prototype Tinker Towers
//   @reference http://www.fractalforums.com/new-theories-and-research/tinker-towers/
//
// grep: F_tinker_towers, tt_fv, tt_sides

// The i-th facet vector of the fold type t. An unknown type uses the tetrahedron, as upstream.
fn tt_fv(fi: u32, t: i32, i: i32) -> vec3f {
	switch (t) {
		case 1: { return FR[fi].genFoldBox.Nv_cube[i]; }
		case 2: { return FR[fi].genFoldBox.Nv_oct[i]; }
		case 3: { return FR[fi].genFoldBox.Nv_dodeca[i]; }
		case 4: { return FR[fi].genFoldBox.Nv_oct_cube[i]; }
		case 5: { return FR[fi].genFoldBox.Nv_icosa[i]; }
		case 6: { return FR[fi].genFoldBox.Nv_box6[i]; }
		case 7: { return FR[fi].genFoldBox.Nv_box5[i]; }
		default: { return FR[fi].genFoldBox.Nv_tet[i]; }
	}
}

// The facet count of the fold type t, clamped to the length of its array.
fn tt_sides(fi: u32, t: i32) -> i32 {
	switch (t) {
		case 1: { return min(FR[fi].genFoldBox.sides_cube, 6); }
		case 2: { return min(FR[fi].genFoldBox.sides_oct, 8); }
		case 3: { return min(FR[fi].genFoldBox.sides_dodeca, 12); }
		case 4: { return min(FR[fi].genFoldBox.sides_oct_cube, 14); }
		case 5: { return min(FR[fi].genFoldBox.sides_icosa, 20); }
		case 6: { return min(FR[fi].genFoldBox.sides_box6, 8); }
		case 7: { return min(FR[fi].genFoldBox.sides_box5, 7); }
		default: { return min(FR[fi].genFoldBox.sides_tet, 4); }
	}
}

fn F_tinker_towers(z_in: vec4f, fi: u32, aux: ptr<function, Aux>) -> vec4f {
	var z: vec4f = z_in;
	var t: f32 = 0.0;
	var tv: vec3f = vec3f(0.0, 0.0, 0.0);
	var zXYZ: vec3f = z.xyz;

	var u_zXYZ: vec3f = vec3f(0.0, 0.0, 1.0); // the angle matters if mag_zXYZ == 0
	var mag_zXYZ: f32 = 0.0;

	t = dot(zXYZ, zXYZ);
	if (t > 0.0) {
		t = sqrt(t);
		u_zXYZ = zXYZ / t;
		mag_zXYZ = t;
	}

	var flat_: f32 = 0.0;
	let ft: i32 = FR[fi].genFoldBox.type_;
	let sides: i32 = tt_sides(fi, ft);

	// melt is the height of every facet (upstream mag_Fv[i], the same for each i).
	let melt: f32 = FR[fi].transformCommon.offset05;

	// Scale is used as the power.
	let power: f32 = FR[fi].transformCommon.pwr4;

	// Find the lowest cutting plane that cuts the ray from the origin through zXYZ.
	var side: i32 = -1;
	var h: f32 = 1.0;
	var my_h: f32;
	for (var i: i32 = 0; i < sides; i++) {
		my_h = 2.0; // only needs to be > 1
		let u_zXYZ_dot_u_Fvi: f32 = dot(u_zXYZ, tt_fv(fi, ft, i));
		if (u_zXYZ_dot_u_Fvi > 0.0) {
			my_h = melt / u_zXYZ_dot_u_Fvi;
		}
		if (my_h < h) {
			h = my_h;
			side = i;
		}
	}

	var w: f32;
	var my_w: f32;
	var edge: i32 = -1;
	// The intersection point is Zc.
	let Zc: vec3f = h * u_zXYZ;

	if (side != -1) {
		let Fv_side: vec3f = tt_fv(fi, ft, side);
		tv = (Zc - melt * Fv_side);
		t = dot(tv, Zc - melt * Fv_side);
		let D_u_Fv_to_Zc: f32 = sqrt(t);

		var u_Fv_to_Zc: vec3f = (Zc - melt * Fv_side);
		if (D_u_Fv_to_Zc > 0.0) {
			u_Fv_to_Zc = u_Fv_to_Zc / D_u_Fv_to_Zc;
		}

		// Assume no cutting plane before the unit sphere.
		w = sqrt(1.0 - melt * melt);

		for (var i: i32 = 0; i < sides; i++) {
			if (side != i) {
				let Fv_i: vec3f = tt_fv(fi, ft, i);
				if (dot(u_Fv_to_Zc, Fv_i) > 0.0) {
					// Distance from melt * u_Fv to cutting plane i.
					my_w = (melt - melt * dot(Fv_side, Fv_i)) / dot(u_Fv_to_Zc, Fv_i);
					if (my_w < w) {
						w = my_w;
						edge = i;
					}
				}
			}
		}

		var D: f32 = 0.0;
		var Axis: vec3f = vec3f(0.0, 0.0, 1.0); // the angle does not matter if D = 0
		if (w > 0.0) {
			D = D_u_Fv_to_Zc / w;
			Axis = cross(Fv_side, zXYZ);
			Axis = Axis / sqrt(dot(Axis, Axis));
		}
		flat_ = dot(Zc, u_zXYZ);
		if (FR[fi].transformCommon.functionEnabledAFalse == 0) {
			var rot_angle: f32 = 3.14159274101257 * (1.0 - D); // linear

			if (FR[fi].transformCommon.functionEnabledBFalse == 0) {
				rot_angle = -rot_angle;
			}

			var v4: vec4f = vec4f(zXYZ.x, zXYZ.y, zXYZ.z, 0.0);
			v4 = RotateAroundVectorByAngle4(v4, Axis, rot_angle);
			zXYZ = vec3f(v4.x, v4.y, v4.z);
		} else {
			zXYZ = zXYZ / flat_;
			let ramp: f32 = 5.0 * D - f32(i32(5.0 * D));
			var saw: f32 = -1.0 + 2.0 * abs(ramp - 0.5);
			saw = (saw + 0.6) + abs(saw + 0.6);
			saw = 0.02 * saw * saw;
			var rings: f32 = 1.0 - (saw * (1.0 - 0.1 * ramp));
			if (D < 0.02) {
				rings = rings * 0.98;
			}
			zXYZ = zXYZ * rings;
		}
	}

	// The zXYZ ray hits the unit sphere first.
	let rp: f32 = c_pow_f32(mag_zXYZ, power - 1.0);

	(*aux).DE = rp * (*aux).DE * power + 1.0;

	zXYZ = zXYZ * rp;

	(*aux).DE = (*aux).DE * FR[fi].analyticDE.scale1 + FR[fi].analyticDE.offset0;
	z = vec4f(zXYZ.x, zXYZ.y, zXYZ.z, z.w);
	return z;
}
