// ============================================================================
//  DLA TERRAIN  ·  gpu/detail-stub.wgsl — stand-in for lib/dla-terrain-detail.wgsl
// ----------------------------------------------------------------------------
//  gpu.loadWGSL uses this file only when the LIB file is missing. It adds
//  no relief under one texel. LIB's file gives the real fractal detail.
// ============================================================================
fn detailHeight(xz: vec2f) -> f32 { return 0.0 * xz.x; }
