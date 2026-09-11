#version 300 es
// raymarch.vert.glsl — full-screen quad, vertex stage
//
//   Pass the four clip-space corners straight through. The fragment stage
//   rebuilds a camera ray per pixel from gl_FragCoord, so no transform is needed
//   here.
in vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0, 1); }
