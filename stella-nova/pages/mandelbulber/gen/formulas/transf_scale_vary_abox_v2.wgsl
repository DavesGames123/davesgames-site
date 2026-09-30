// transf_scale_vary_abox_v2.wgsl — override for Mandelbulber2 formula TransfScaleVaryAboxV2.
// Upstream formula/opencl/transf_scale_vary_abox_v2.cl writes aux->r_dz, a field that sExtendedAuxCl
// does not have, so the upstream OpenCL does not compile. This override is the tools/translate.mjs
// output with the r_dz lines removed; r_dz feeds no other value, so z, DE and color are unchanged.
// Ported from Mandelbulber2 (https://github.com/buddhi1980/mandelbulber2), upstream commit 600da8d.
// Copyright (C) Mandelbulber Team. GPL-3.0-or-later, see ../COPYING.
//   scale vary Abox v2- based on DarkBeams maths
//   @reference
//   http://www.fractalforums.com/mandelbulb-3d/custom-formulas-and-transforms-release-t17106/
//
// grep: F_transf_scale_vary_abox_v2

fn F_transf_scale_vary_abox_v2(z_in: vec4f, fi: u32, aux: ptr<function, Aux>) -> vec4f {
	var z: vec4f = z_in;
	if ((((*aux).i >= FR[fi].transformCommon.startIterations) && ((*aux).i < FR[fi].transformCommon.stopIterations))) {
		z *= (*aux).actualScale;
		(*aux).DE = fma((*aux).DE, abs((*aux).actualScale), 1.0);
		var base: f32 = FR[fi].mandelbox.scale;
		var vary: f32 = (abs((*aux).actualScale) - FR[fi].transformCommon.offset1);
		if ((FR[fi].transformCommon.functionEnabled != 0)) {
			(*aux).actualScale = fma(vary, FR[fi].mandelboxVary4D.scaleVary, base);
		} else if ((FR[fi].transformCommon.functionEnabledBxFalse != 0)) {
			base = (*aux).actualScale;
			(*aux).actualScale = fma(vary, FR[fi].transformCommon.scale0, base);
		} else if ((FR[fi].transformCommon.functionEnabledByFalse != 0)) {
			var base2: f32 = fma((abs((*aux).actualScale) - FR[fi].transformCommon.offset1), FR[fi].mandelboxVary4D.scaleVary, base);
			(*aux).actualScale = fma((abs((*aux).actualScale) - FR[fi].transformCommon.offset1), FR[fi].transformCommon.scale0, base2);
		} else if ((FR[fi].transformCommon.functionEnabledBzFalse != 0)) {
			base = (*aux).actualScale;
			var base2: f32 = fma((abs((*aux).actualScale) - FR[fi].transformCommon.offset1), FR[fi].transformCommon.scale0, base);
			(*aux).actualScale = fma((abs((*aux).actualScale) - FR[fi].transformCommon.offset1), FR[fi].mandelboxVary4D.scaleVary, base2);
		}
	} else {
		z *= FR[fi].mandelbox.scale;
		(*aux).DE = fma((*aux).DE, abs(FR[fi].mandelbox.scale), 1.0);
	}
	return z;
}
