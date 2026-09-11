#version 300 es
// refraction.vert.glsl — full-screen quad, vertex stage
//
//   Pass the four clip-space corners straight through. No projection: the quad
//   already covers the screen, so all the real work happens in the fragment
//   stage, which reconstructs a camera ray per pixel from gl_FragCoord.
in vec2 a_pos;void main(){gl_Position=vec4(a_pos,0,1);}
