// ============================================================================
//  CORAL REEF  ·  haze.js  ·  the water dome and the depth haze (DOM-free)
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "sky rendering lack circle bug". The water
//  dome was a sphere of 300 m at the render origin. The floating origin
//  moves in steps of 1024 m and the eye goes down to 800 m, so the eye was
//  often far from the sphere centre: the far part of the sphere was past
//  the camera far plane (or the eye was out of the sphere), and the clear
//  colour (black) showed as a large disc. Now the dome is centred on the
//  camera that draws it (scene.js onBeforeRender, the main view and each
//  feed camera), with a radius under the far plane of that camera.
//
//  HAZE FLOOR. The fog colour of the deep water (main.js LOOK) goes near
//  zero. The dome and the far haze never go under HAZE_FLOOR: a dark blue,
//  not black.
//
//    domeRadius(far)                 the dome radius for a camera far plane
//    domeHit(eye, centre, r, dir)    the ray distance to the dome (or -1)
//    domeColour(fogCol, dirY)        the CPU copy of the dome colour (no window)
//    HAZE_FLOOR, HAZE_GLSL           the floor colour (linear), as GLSL vec3
//
//  grep -n targets: "export function domeRadius", "export function domeColour"
// ============================================================================

export const DOME_R = 300;
export const HAZE_FLOOR = [0.00012, 0.00045, 0.0010];
const g = (v) => v.toFixed(5);
export const HAZE_GLSL = `vec3(${HAZE_FLOOR.map(g).join(', ')})`;

// The dome must stay inside the far plane: 80 % of it, at most DOME_R.
export function domeRadius(far) { return Math.min(DOME_R, 0.8 * (far > 0 ? far : 400)); }

// The distance along the unit dir from eye to the sphere (centre, r), from
// the inside; -1 when the eye is outside it.
export function domeHit(eye, centre, r, dir) {
  const o = [eye[0] - centre[0], eye[1] - centre[1], eye[2] - centre[2]];
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r;
  if (c > 0) return -1;
  const b = o[0] * dir[0] + o[1] * dir[1] + o[2] * dir[2];
  return -b + Math.sqrt(b * b - c);
}

// scene.js dome fragment (the Snell window not added): the fog colour by
// the view direction, never under the floor.
export function domeColour(fogCol, dirY) {
  const k = 0.55 + 0.9 * Math.min(1, Math.max(0, dirY * 0.5 + 0.5));
  return fogCol.map((c, i) => Math.max(c * k, HAZE_FLOOR[i] * k));
}

// ── the fog of war ───────────────────────────────────────────────────────────
// The user said (2026-10-18): "we should not be able to see otside of the
// area we explored inside of the ROV map" and "we should get a dark blue
// haze outside of unexplored regions instead o fjust going totally black".
// The explored field is a FOW_N x FOW_N texture (one byte a cell) of the
// 12 m cells of rov/squad.js visited (the same keys), round the eye, in
// world cells: texel i is the cell gx0 + i, so the field does not move
// when the floating origin moves (box() gives it in render space). The
// cells that a ROV lamp lights (4 to 18 m along the line from the ROV to
// its look point) are added to it and stay. The shader (shaders.js WATER
// fowSeen) takes one linear sample and a smoothstep (0.1 .. 0.9): the edge
// is about 9 m wide on the cell border. The lamps also show what they
// light now (fowSeen, uSpotP). Out of the explored field, underwater()
// gives fowHaze: the fog colour of the view direction (not under the
// floor), a little lighter where the surface is over the eye, so the large
// shapes keep a faint silhouette.
//
//    const E = createExplored();  E.update({ visited, eye, vehicles }) -> changed
//    E.data (Uint8Array n x n), E.n, E.cell, E.box(origin) -> [x0, z0, 1 / size, 1]
//    E.sample(wx, wz)    the CPU copy of the linear texture sample
//    fowSeen(E, wx, wz)  the explored weight (no lamp), as the shader
//    fowHaze(fogCol, dirY, dy) and shadeFow(...) the CPU copy of underwater()
export const FOW_N = 64, FOW_CELL = 12, LAMP_MARKS = [4, 8, 13, 18];

export function createExplored({ n = FOW_N, cell = FOW_CELL } = {}) {
  const data = new Uint8Array(n * n), lit = new Set();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  let gx0 = null, gz0 = null, known = -1, litN = -1;
  const E = {
    n, cell, data, lit,
    get gx0() { return gx0; }, get gz0() { return gz0; },
    update({ visited, eye, vehicles }) {
      for (const st of vehicles || []) {
        if (!st || !st.p || !st.look) continue;
        const dx = st.look[0] - st.p[0], dz = st.look[2] - st.p[2], l = Math.hypot(dx, st.look[1] - st.p[1], dz);
        if (!(l > 1e-3)) continue;
        for (const t of LAMP_MARKS) lit.add(key(st.p[0] + dx / l * t, st.p[2] + dz / l * t));
      }
      const ci = Math.floor(eye[0] / cell), cj = Math.floor(eye[2] / cell);
      const moved = gx0 === null || Math.abs(ci - (gx0 + n / 2)) > n / 4 || Math.abs(cj - (gz0 + n / 2)) > n / 4;
      if (moved) { gx0 = ci - n / 2; gz0 = cj - n / 2; }
      const size = visited ? visited.size : 0;
      if (!moved && size === known && lit.size === litN) return false;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = `${gx0 + i},${gz0 + j}`;
        data[j * n + i] = (visited && visited.has(k)) || lit.has(k) ? 255 : 0;
      }
      known = size; litN = lit.size;
      return true;
    },
    box(origin = [0, 0]) { return [gx0 * cell - origin[0], gz0 * cell - origin[1], 1 / (n * cell), 1]; },
    // LinearFilter, ClampToEdge, as WebGL: texel centres at (i + 0.5) / n
    sample(wx, wz) {
      const u = (wx - gx0 * cell) / (n * cell), v = (wz - gz0 * cell) / (n * cell);
      if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
      const fx = u * n - 0.5, fz = v * n - 0.5, i0 = Math.floor(fx), j0 = Math.floor(fz), ax = fx - i0, az = fz - j0;
      const T = (i, j) => data[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))] / 255;
      return (T(i0, j0) * (1 - ax) + T(i0 + 1, j0) * ax) * (1 - az) + (T(i0, j0 + 1) * (1 - ax) + T(i0 + 1, j0 + 1) * ax) * az;
    },
  };
  return E;
}

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function fowSeen(E, wx, wz) { return sstep(0.1, 0.9, E.sample(wx, wz)); }
// shaders.js fowHaze: dy = the surface height over the eye (m)
export function fowHaze(fogCol, dirY, dy) {
  const k = (0.55 + 0.9 * Math.min(1, Math.max(0, dirY * 0.5 + 0.5))) * (0.8 + 0.4 * sstep(-30, 30, dy));
  return fogCol.map((c, i) => Math.max(c, HAZE_FLOOR[i]) * k);
}
// shaders.js underwater(): col at w seen from eye, fog (fogCol, fogK), seen weight e
export function shadeFow(col, w, eye, fogCol, fogK, e) {
  const d = [w[0] - eye[0], w[1] - eye[1], w[2] - eye[2]], dist = Math.hypot(...d), dirY = d[1] / Math.max(dist, 1e-3);
  const fc = fogCol.map(c => c * (0.55 + 0.9 * Math.min(1, Math.max(0, dirY * 0.5 + 0.5))));
  const o = col.map((c, i) => { const tr = Math.exp(-dist * fogK[i]); return c * tr + fc[i] * (1 - tr); });
  const h = fowHaze(fogCol, dirY, w[1] - eye[1]);
  return o.map((c, i) => h[i] + (c - h[i]) * e);
}
