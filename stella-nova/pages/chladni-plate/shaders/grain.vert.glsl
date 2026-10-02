#version 300 es
// Sand grains into the plate-space trail texture. aP = (u, v, act) with
// u, v in grid cells and act in 0..1 (1 = in the air).
layout(location = 0) in vec3 aP;
uniform vec2 uGridInv;   // 1 / (nx - 1), 1 / (ny - 1)
uniform float uSize;
out float vW;
void main() {
  vec2 uv = aP.xy * uGridInv;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = uSize;
  vW = 1.0 - 0.8 * aP.z;   // a grain in the air leaves less on the plate
}
