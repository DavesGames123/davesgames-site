#version 300 es
// wormhole.vert.glsl — fullscreen pass, vertex stage
//
//   Pass-through for the fullscreen quad. The four corner positions arrive in
//   clip space (-1..1), so this only forwards them; every ray and all of the
//   lensing happen per pixel in wormhole.frag.glsl.
in vec2 a_pos;
void main(){gl_Position=vec4(a_pos,0,1);}
