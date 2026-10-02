#version 300 es
// The plate quad. aUv is 0..1 over the grid rect. World x is body x,
// world y is up the screen (the neck end at the top), z is out of the plate.
layout(location = 0) in vec2 aUv;
uniform mat4 uPV;
uniform vec4 uRect;     // x0, y0 (world), w, h
uniform float uZ;
out vec2 vUv;
void main() {
  vUv = aUv;
  vec3 w = vec3(uRect.x + aUv.x * uRect.z, uRect.y - aUv.y * uRect.w, uZ);
  gl_Position = uPV * vec4(w, 1.0);
}
