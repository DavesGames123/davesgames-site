// ============================================================================
//  MUJOCO LAB  ·  render/camera.js — free, track and model cameras
// ----------------------------------------------------------------------------
//  The free camera uses the terms of mjvCamera: lookat (MuJoCo world),
//  distance, azimuth and elevation in degrees. The camera looks along
//  f = (cos el cos az, cos el sin az, sin el), so a negative elevation
//  looks down. The three camera matrix is written directly (no lookAt
//  per frame on Object3D, no allocation).
//
//  GREP MAP
//    export function createCamCtl .. state, apply(), orbit/pan/zoom, set()
//    function applyFree ............ az/el/dist -> camera matrix
//    function applyModel ........... cam_xpos / cam_xmat -> camera matrix
// ============================================================================

const D2R = Math.PI / 180;

// mj -> three: (x, y, z) -> (x, z, -y)
export function createCamCtl(THREE, camera) {
  const eye = new THREE.Vector3(), tgt = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const C = {
    mode: 'free', body: -1, index: 0,
    azimuth: 90, elevation: -20, distance: 3, lookat: [0, 0, 0], fovy: 45,
    // camera right and up in MuJoCo axes (for pan and rotate drags)
    right: [1, 0, 0], upv: [0, 0, 1], fwd: [0, 1, 0],
    set(p) {
      for (const k of ['mode', 'body', 'index', 'azimuth', 'elevation', 'distance', 'fovy']) if (p[k] != null) C[k] = p[k];
      if (p.lookat) { C.lookat[0] = p.lookat[0]; C.lookat[1] = p.lookat[1]; C.lookat[2] = p.lookat[2]; }
      C.elevation = Math.max(-89.5, Math.min(89.5, C.elevation));
      C.distance = Math.max(1e-3, C.distance);
    },
    get() { return { mode: C.mode, body: C.body, index: C.index, azimuth: C.azimuth, elevation: C.elevation, distance: C.distance, lookat: C.lookat.slice() }; },
    orbit(dx, dy) { C.azimuth -= dx * 0.3; C.elevation = Math.max(-89.5, Math.min(89.5, C.elevation - dy * 0.3)); },
    // dx, dy in pixels, h the view height in pixels
    pan(dx, dy, h) {
      const s = 2 * C.distance * Math.tan(C.fovy * D2R / 2) / Math.max(1, h);
      for (let k = 0; k < 3; k++) C.lookat[k] += (-dx * C.right[k] + dy * C.upv[k]) * s;
    },
    zoom(f) { C.distance = Math.max(1e-3, C.distance * f); },
    // track: lookat follows the subtree COM of C.body
    apply(m, d, V, aspect) {
      if (C.mode === 'model' && C.index >= 0 && C.index < m.ncam) return applyModel(m, V, aspect);
      if (C.mode === 'track' && C.body > 0 && C.body < m.nbody) {
        const S = V.subtree_com, b = C.body, k = 0.25;
        for (let i = 0; i < 3; i++) C.lookat[i] += (S[3 * b + i] - C.lookat[i]) * k;
      }
      return applyFree(aspect);
    },
  };
  function finish() {
    camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
    camera.matrixWorld.copy(camera.matrix);
    camera.matrixWorldInverse.copy(camera.matrix).invert();
    camera.matrixWorldNeedsUpdate = false;
  }
  function applyFree(aspect) {
    const az = C.azimuth * D2R, el = C.elevation * D2R, ce = Math.cos(el);
    const f0 = ce * Math.cos(az), f1 = ce * Math.sin(az), f2 = Math.sin(el), L = C.lookat, dd = C.distance;
    C.fwd[0] = f0; C.fwd[1] = f1; C.fwd[2] = f2;
    // right = f x z, up = right x f
    let r0 = f1, r1 = -f0; const rl = Math.hypot(r0, r1) || 1; r0 /= rl; r1 /= rl;
    C.right[0] = r0; C.right[1] = r1; C.right[2] = 0;
    C.upv[0] = r1 * f2; C.upv[1] = -r0 * f2; C.upv[2] = r0 * f1 - r1 * f0;
    const ex = L[0] - dd * f0, ey = L[1] - dd * f1, ez = L[2] - dd * f2;
    eye.set(ex, ez, -ey); tgt.set(L[0], L[2], -L[1]);
    camera.matrix.lookAt(eye, tgt, up);
    camera.matrix.setPosition(eye);
    setProj(C.fovy, aspect);
    finish();
    return C;
  }
  function applyModel(m, V, aspect) {
    const i = C.index, P = V.cam_xpos, R = V.cam_xmat, o = 9 * i, e = camera.matrix.elements;
    // MuJoCo camera: x right, y up, looks along -z; columns of cam_xmat.
    // three columns = T * mujoco columns, T(x, y, z) = (x, z, -y)
    for (let c = 0; c < 3; c++) {
      const x = R[o + c], y = R[o + 3 + c], z = R[o + 6 + c];
      e[4 * c] = x; e[4 * c + 1] = z; e[4 * c + 2] = -y; e[4 * c + 3] = 0;
    }
    e[12] = P[3 * i]; e[13] = P[3 * i + 2]; e[14] = -P[3 * i + 1]; e[15] = 1;
    for (let k = 0; k < 3; k++) { C.right[k] = R[o + 3 * k]; C.upv[k] = R[o + 3 * k + 1]; C.fwd[k] = -R[o + 3 * k + 2]; }
    setProj(V.cam_fovy[i], aspect);
    finish();
    return C;
  }
  let lastF = 0, lastA = 0;
  function setProj(fovy, aspect) {
    if (fovy === lastF && aspect === lastA) return;
    lastF = fovy; lastA = aspect;
    camera.fov = fovy; camera.aspect = aspect; camera.updateProjectionMatrix();
  }
  camera.matrixAutoUpdate = false;
  return C;
}
