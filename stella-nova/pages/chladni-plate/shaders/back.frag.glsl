#version 300 es
// The room behind the plate: a dark warm vignette with a little dither.
precision highp float;
in vec2 vUv;
uniform vec2 uRes;
uniform vec2 uCenter;   // plate center in 0..1 screen space
out vec4 o;
void main() {
  vec2 p = (vUv - uCenter) * vec2(uRes.x / uRes.y, 1.0);
  float r = length(p);
  vec3 c = mix(vec3(0.085, 0.078, 0.068), vec3(0.022, 0.020, 0.018), smoothstep(0.0, 0.95, r));
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  o = vec4(c + (n - 0.5) / 255.0, 1.0);
}
