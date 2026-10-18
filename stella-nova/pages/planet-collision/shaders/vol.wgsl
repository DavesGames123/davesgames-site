// ============================================================================
//  PLANET COLLISION  ·  shaders/vol.wgsl — the density volume (after
//  common.wgsl)
// ----------------------------------------------------------------------------
//  Two compute passes fill a cube of G^3 cells round the framed bodies
//  (render.js "_volume" sets U.vol0, U.vol1 and dispatches them):
//
//    cs_volScatter   one workgroup per particle (fluid and debris; vapour
//                    and empty rows out). Its 64 threads add the kernel
//                    (1 - r^2/Rk^2)^3, Rk = U.vol1.z spacing0, to every
//                    cell in reach (fixed point 1/65536, atomicAdd).
//    cs_volResolve   one thread per cell: the field f and its gradient
//                    (central differences, per world unit) to the 3D
//                    texture volOut (rgba16float: grad xyz, f); and the
//                    brick marks: a brick of 8^3 cells is marked when a
//                    ray sample in it can reach the iso level (a corner
//                    cell of the sample is at or over it), so march.wgsl
//                    can skip the other bricks.
//
//  The kernel is wide (Rk 1.8 spacings): the iso surface of a settled body
//  has a radius spread of about 0.01 spacing, against 0.28 for the union of
//  particle spheres (tests.mjs 12). Normals come from the interpolated
//  gradient, so they have no step at the cell faces.
//
//  Binding 2 of group 2 is a storage texture: write only. Bit and
//  arithmetic operators are not mixed without parentheses (Tint).
//
//  grep -n targets: "fn cs_volScatter", "fn cs_volResolve", "fn cellIndex"
// ============================================================================

@group(2) @binding(0) var<storage, read_write> acc: array<atomic<u32>>;
@group(2) @binding(1) var<storage, read_write> bricks: array<atomic<u32>>;
@group(2) @binding(2) var volOut: texture_storage_3d<rgba16float, write>;

const FIX: f32 = 65536.0;

fn cellIndex(c: vec3i, G: i32) -> u32 { return u32(c.x + G * (c.y + G * c.z)); }

@compute @workgroup_size(64)
fn cs_volScatter(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let ii = wg.x + wg.y * 65535u;
  if (ii >= arrayLength(&pTag)) { return; }
  if (pVel[ii].w <= 0.0) { return; }
  if (klass(ii) == K_VAPOUR) { return; }
  let G = i32(U0.vol1.x);
  let g = toGrid(pPos[ii].xyz);
  // An expanded particle (rho under 0.6 rho0) has a wider, lower kernel
  // (up to 1.35 x, amplitude sqrt(rho / 0.6 rho0)): a thinning sheet stays
  // smooth instead of breaking into one bead per particle. It is also
  // drawn out along its velocity (up to 2.2 x along, volume kept), so
  // the stretched flow joins into filaments and then pinches into drops.
  let m = matOf(ii) & 3u;
  let rr = clamp(pTh[ii].x / U0.mats[m].x, 0.05, 1.0);
  let ex1 = select(1.0, clamp(pow(rr / 0.6, -1.0 / 3.0), 1.0, 1.35), rr < 0.6);
  let v = pVel[ii].xyz;
  let sp = length(v);
  let sf = select(1.0, clamp(1.0 + 3.0 * (0.6 - rr), 1.0, 2.2), (rr < 0.6) && (sp > 1e-6));
  let ax = select(vec3f(0.0, 0.0, 1.0), v / max(sp, 1e-9), sp > 1e-6);
  let rc0 = kernelCells(ii) * ex1;
  let ra = rc0 * pow(sf, 2.0 / 3.0);
  let rx = rc0 * pow(sf, -1.0 / 3.0);
  let amp = sqrt(select(1.0, max(rr / 0.6, 0.4), rr < 0.6));
  let rc = ra;
  let lo = max(vec3i(ceil(g - vec3f(rc))), vec3i(0));
  let hi = min(vec3i(floor(g + vec3f(rc))), vec3i(G - 1));
  if (any(hi < lo)) { return; }
  let ext = hi - lo + vec3i(1);
  let ex = u32(ext.x);
  let exy = u32(ext.x * ext.y);
  let tot = exy * u32(ext.z);
  let ia = 1.0 / (ra * ra);
  let ix = 1.0 / (rx * rx);
  for (var k = li; k < tot; k = k + 64u) {
    let c = lo + vec3i(i32(k % ex), i32((k / ex) % u32(ext.y)), i32(k / exy));
    let d = vec3f(c) - g;
    let da = dot(d, ax);
    let q = da * da * ia + (dot(d, d) - da * da) * ix;
    if (q < 1.0) {
      let u = 1.0 - q;
      atomicAdd(&acc[cellIndex(c, G)], u32(amp * u * u * u * FIX));
    }
  }
}

fn accAt(c: vec3i, G: i32) -> f32 {
  let q = clamp(c, vec3i(0), vec3i(G - 1));
  return f32(atomicLoad(&acc[cellIndex(q, G)])) / FIX;
}
@compute @workgroup_size(4, 4, 4)
fn cs_volResolve(@builtin(global_invocation_id) gid: vec3u) {
  let G = i32(U0.vol1.x);
  let c = vec3i(gid);
  if (any(c >= vec3i(G))) { return; }
  let f = accAt(c, G);
  let gx = accAt(c + vec3i(1, 0, 0), G) - accAt(c - vec3i(1, 0, 0), G);
  let gy = accAt(c + vec3i(0, 1, 0), G) - accAt(c - vec3i(0, 1, 0), G);
  let gz = accAt(c + vec3i(0, 0, 1), G) - accAt(c - vec3i(0, 0, 1), G);
  textureStore(volOut, c, vec4f(vec3f(gx, gy, gz) * (0.5 / U0.vol0.w), f));
  if (f < U0.vol1.y) { return; }
  // the bricks of the samples that have this cell as a corner
  let NB = G / 8;
  let own = c / 8;
  for (var k = 0; k < 8; k++) {
    let d = vec3i(k & 1, (k >> 1u) & 1, (k >> 2u) & 1);
    let q = c - d;
    if (any(q < vec3i(0))) { continue; }
    let b = q / 8;
    if (k > 0 && all(b == own)) { continue; }
    atomicMax(&bricks[u32(b.x + NB * (b.y + NB * b.z))], 1u);
  }
}
