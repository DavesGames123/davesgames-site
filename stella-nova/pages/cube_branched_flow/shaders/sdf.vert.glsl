#version 300 es
// sdf.vert.glsl — fullscreen triangle, vertex stage
//
//   Emits one oversized triangle (no vertex buffer) that covers the screen:
//   vertices (-1,-1), (3,-1), (-1,3). The part outside the viewport is clipped,
//   leaving a full-screen surface for the ray-marcher in sdf.frag.glsl.
void main(){float x=gl_VertexID==1?3.:-1.;float y=gl_VertexID==2?3.:-1.;gl_Position=vec4(x,y,0,1);}
