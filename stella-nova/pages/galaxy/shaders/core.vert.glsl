#version 300 es
// core.vert.glsl — galaxy core glow, vertex stage
//
//   Pass-through for the fullscreen quad. Positions arrive already in clip
//   space (-1..1), so this only forwards them; the core fragment shader does
//   all the work in gl_FragCoord space.
in vec2 a_pos;
void main(){ gl_Position = vec4(a_pos,0,1); }
