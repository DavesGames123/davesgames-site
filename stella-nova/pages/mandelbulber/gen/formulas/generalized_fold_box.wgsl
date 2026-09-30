// generalized_fold_box.wgsl — override for Mandelbulber2 formula GeneralizedFoldBox.
// Upstream formula/opencl/generalized_fold_box.cl points a `__global REAL3 *Nv` at one of eight
// genFoldBox arrays of different lengths, chosen by genFoldBox.type. WGSL has no pointer to a
// storage array of unknown length, so gfb_nv() selects the array with a switch and returns the
// i-th plane normal. gfb_sides() returns the matching plane count. The fold math is unchanged.
// gfb_sides() clamps the count to the array length. For the upstream counts, this has no effect.
// Ported from Mandelbulber2 (https://github.com/buddhi1980/mandelbulber2), upstream commit 600da8d.
// Copyright (C) Mandelbulber Team. GPL-3.0-or-later, see ../COPYING.
//   GeneralizedFoldBoxIteration - Quaternion fractal with extended controls
//   @reference http://www.fractalforums.com/new-theories-and-research/generalized-box-fold/
//
// grep: F_generalized_fold_box, gfb_nv, gfb_sides

// The i-th plane normal of the fold type t. An unknown type uses the tetrahedron, as upstream.
fn gfb_nv(fi: u32, t: i32, i: i32) -> vec3f {
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

// The plane count of the fold type t, clamped to the length of its array.
fn gfb_sides(fi: u32, t: i32) -> i32 {
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

fn F_generalized_fold_box(z_in: vec4f, fi: u32, aux: ptr<function, Aux>) -> vec4f {
	var z: vec4f = z_in;
	var zXYZ: vec3f = z.xyz;
	let t: i32 = FR[fi].genFoldBox.type_;
	let sides: i32 = gfb_sides(fi, t);

	let melt: f32 = FR[fi].mandelbox.melt;
	let solid: f32 = FR[fi].mandelbox.solid;

	// Find the closest cutting plane that cuts the line from the origin to z.
	// The line is X = Y + L * a. The cutting plane is dot(X, Nv) = solid.
	var L: vec3f = zXYZ;
	var a: f32 = 1.0;
	var Y: vec3f = vec3f(0.0);
	var side: i32 = -1;
	var b: f32;
	var c: f32;

	for (var i: i32 = 0; i < sides; i++) {
		b = solid;
		c = dot(L, gfb_nv(fi, t, i));
		if ((c > 0.0) && ((a * c) > b)) {
			side = i;
			a = b / c;
		}
	}

	// If z is above the folding value, we may have to fold.
	if (side != -1) { // mirror check
		let side_m: i32 = side;
		let Nv_m: vec3f = gfb_nv(fi, t, side_m);
		let X_m: vec3f = zXYZ - Nv_m * (dot(zXYZ, Nv_m) - solid);

		// Find the plane closest to X_m that cuts the line between Nv_m and X_m.
		L = X_m - Nv_m;
		Y = Nv_m;
		a = 1.0;
		side = -1;

		for (var i: i32 = 0; i < sides; i++) {
			if (i != side_m) {
				let Nv_i: vec3f = gfb_nv(fi, t, i);
				b = solid - dot(Y, Nv_i);
				c = dot(L, Nv_i);
				if ((c > 0.0) && ((a * c) > b)) {
					side = i;
					a = b / c;
				}
			}
		}

		if (side != -1) { // rotation check
			let Xmr_intersect: vec3f = Y + L * a;
			let side_r: i32 = side;
			let Nv_r: vec3f = gfb_nv(fi, t, side_r);
			var L_r: vec3f = cross(Nv_m, Nv_r);
			var a_rmin: f32 = (dot(zXYZ, L_r) - dot(Xmr_intersect, L_r)) / dot(L_r, L_r);

			if (a_rmin < 0.0) {
				a_rmin = -a_rmin;
				L_r = L_r * (-1.0);
			}
			let X_r: vec3f = Xmr_intersect + L_r * a_rmin;

			// Find the plane closest to Xmr_intersect that cuts the line to X_r (inversion point).
			L = X_r - Xmr_intersect;
			Y = Xmr_intersect;
			a = 1.0;
			side = -1;

			for (var i: i32 = 0; i < sides; i++) {
				if ((i != side_m) && (i != side_r)) {
					let Nv_i: vec3f = gfb_nv(fi, t, i);
					b = solid - dot(Y, Nv_i);
					c = dot(L, Nv_i);
					if ((c > 0.0) && ((a * c) > b)) {
						side = i;
						a = b / c;
					}
				}
			}

			if (side != -1) { // inversion check
				let X_i: vec3f = Y + L * a;
				let z2X: vec3f = X_i - zXYZ;
				if (dot(z2X, z2X) > (melt * melt)) {
					let z2X_mag: f32 = length(z2X);
					zXYZ += z2X * (2.0 * (z2X_mag - melt) / (z2X_mag + 0.00000001));
					(*aux).color += FR[fi].mandelbox.color.factor.z;
				}
			} else {
				// Only a rotation line is possible. Check for melt.
				let z2X: vec3f = X_r - zXYZ;
				if (dot(z2X, z2X) > (melt * melt)) {
					let z2X_mag: f32 = length(z2X);
					zXYZ += z2X * (2.0 * (z2X_mag - melt) / (z2X_mag + 0.00000001));
					(*aux).color += FR[fi].mandelbox.color.factor.y;
				}
			}
		} else {
			// Only a mirror plane is possible. Check for melt.
			let z2X: vec3f = X_m - zXYZ;
			if (dot(z2X, z2X) > (melt * melt)) {
				let z2X_mag: f32 = length(z2X);
				zXYZ += z2X * (2.0 * (z2X_mag - melt) / (z2X_mag + 0.00000001));
				(*aux).color += FR[fi].mandelbox.color.factor.x;
			}
		}
	} // outside solid

	let r2: f32 = dot(zXYZ, zXYZ);

	z = vec4f(zXYZ.x, zXYZ.y, zXYZ.z, z.w);

	z += FR[fi].mandelbox.offset;

	if (r2 < FR[fi].mandelbox.mR2) {
		z *= FR[fi].mandelbox.mboxFactor1;
		(*aux).DE *= FR[fi].mandelbox.mboxFactor1;
		(*aux).color += FR[fi].mandelbox.color.factorSp1;
	} else if (r2 < FR[fi].mandelbox.fR2) {
		let tglad_factor2: f32 = FR[fi].mandelbox.fR2 / r2;
		z *= tglad_factor2;
		(*aux).DE *= tglad_factor2;
		(*aux).color += FR[fi].mandelbox.color.factorSp2;
	}

	z -= FR[fi].mandelbox.offset;

	if (FR[fi].mandelbox.mainRotationEnabled != 0) {
		z = Matrix33MulFloat4(FR[fi].mandelbox.mainRot, z);
	}

	z *= FR[fi].mandelbox.scale;
	(*aux).DE = (*aux).DE * abs(FR[fi].mandelbox.scale) + 1.0;
	return z;
}
