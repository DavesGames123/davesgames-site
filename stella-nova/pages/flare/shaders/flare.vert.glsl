#version 300 es
// flare.vert.glsl — fullscreen pass, vertex stage
//
//   Pass-through for the two-triangle fullscreen quad. Corner positions arrive
//   in clip space (-1..1); the flare is drawn entirely per pixel in the
//   fragment stage (flare.frag.glsl).
in vec2 a_pos;
void main(){gl_Position=vec4(a_pos,0.,1.);}
