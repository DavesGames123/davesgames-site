#version 300 es
// Grains in the air, drawn in 3D above the plate. The hop height is a
// look only: a grain with act > 0 jumps with its own phase.
layout(location = 0) in vec3 aP;
uniform mat4 uPV;
uniform vec4 uRect;
uniform vec2 uGridInv;
uniform float uTime, uHop, uSize;
out float vA;
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  vec2 uv = aP.xy * uGridInv;
  float ph = hash(float(gl_VertexID));
  float z = uHop * aP.z * abs(sin(uTime * (7.0 + 5.0 * ph) + ph * 6.283));
  vec3 w = vec3(uRect.x + uv.x * uRect.z, uRect.y - uv.y * uRect.w, z);
  gl_Position = uPV * vec4(w, 1.0);
  gl_PointSize = aP.z > 0.04 ? uSize : 0.0;
  vA = aP.z;
}
