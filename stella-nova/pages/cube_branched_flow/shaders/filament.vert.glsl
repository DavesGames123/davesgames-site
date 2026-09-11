#version 300 es
// filament.vert.glsl — instanced filament ribbon, vertex stage
//
//   One instance per filament edge. The instance carries the edge's two world
//   endpoints (a_pA, a_pB); the six vertices of the instance form a screen-space
//   quad along that edge. This shader projects both endpoints, builds a
//   screen-space perpendicular, and offsets each corner by the ribbon half-width
//   (tapering along the filament), so the line reads as a solid-width ribbon at
//   any distance. It passes the edge coordinate and world position downstream.
//
//     a_pA ●━━━━━━━━━● a_pB          side = -1 / +1 across the ribbon
//          │ quad    │               end  =  0 / 1  along the edge (A -> B)
//          ●━━━━━━━━━●               offset = perp * side * width
//
//   The six vertex ids map to the two triangles of the quad (see side/end).
precision highp float;
layout(location=0) in vec3 a_pA;layout(location=1) in vec3 a_pB;
layout(location=2) in float a_along;layout(location=3) in float a_bright;
uniform mat4 u_vp;uniform vec2 u_res;uniform float u_width,u_taper,u_eStep;
out float v_edge,v_along,v_bright;
out vec3 v_wpos;
out float v_ringPhase;
void main(){int vi=gl_VertexID;
  // Map the vertex id to a corner: side across the ribbon, end along the edge.
  float side=(vi==1||vi==4||vi==5)?1.:-1.;
  float end=(vi>=2&&vi!=4)?1.:0.;
  // This corner's world point (A or B) and a per-filament ring phase for hue.
  vec3 P=mix(a_pA,a_pB,end);
  v_wpos=P;
  v_ringPhase=fract(dot(a_pA,vec3(.137,.293,.517))*10.);
  // Project both endpoints, take the screen-space direction, and its perpendicular.
  vec4 cA=u_vp*vec4(a_pA,1),cB=u_vp*vec4(a_pB,1),cP=u_vp*vec4(P,1);
  vec2 dir=cB.xy/cB.w-cA.xy/cA.w;float len=length(dir);
  dir=len>1e-6?dir/len:vec2(0,1);vec2 perp=vec2(-dir.y,dir.x);
  // Width in pixels, tapering along the filament; offset the clip pos sideways.
  float al=a_along+end*u_eStep;float w=u_width*(1.-al*u_taper)/u_res.y;
  cP.xy+=perp*side*w*cP.w;gl_Position=cP;
  v_edge=side;v_along=al;v_bright=a_bright;}
