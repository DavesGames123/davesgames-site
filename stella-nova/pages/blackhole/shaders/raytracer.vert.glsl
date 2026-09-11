#version 300 es
// raytracer.vert.glsl — fullscreen pass, vertex stage
//
//   The whole scene is a fragment-shader job. This stage only puts a screen
//   covering quad on the clip plane so the fragment stage runs once per pixel.
//   The JS binds a 4 vertex TRIANGLE_STRIP of clip space corners in a_pos:
//
//       (-1, 1) ●─────● (1, 1)      no camera matrix, no projection;
//               │    ╱│              a_pos already lives in clip space, so
//               │  ╱  │              gl_Position is a straight pass through.
//       (-1,-1) ●─────● (1,-1)      z=0, w=1 puts the quad on the near plane.
//
//   All ray setup and marching happens in raytracer.frag.glsl.
// a_pos: one clip space corner of the fullscreen quad (bound to location 0).
in vec2 a_pos;
// Pass the corner straight to clip space; z=0 pins the quad to the near plane.
void main(){gl_Position=vec4(a_pos,0,1);}
