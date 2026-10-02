#version 300 es
precision mediump float;
uniform vec3 uSandCol;
uniform float uFade;
in float vA;
out vec4 o;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.25, 0.12, dot(d, d)) * min(1.0, vA * 1.4) * 0.85 * uFade;
  if (a < 0.01) discard;
  o = vec4(uSandCol * 1.12, a);
}
