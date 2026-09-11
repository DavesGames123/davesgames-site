#version 300 es
precision highp float;
layout(location=0) in vec3 a_pA;layout(location=1) in vec3 a_pB;
layout(location=2) in float a_along;layout(location=3) in float a_bright;
uniform mat4 u_vp;uniform vec2 u_res;uniform float u_width,u_taper,u_eStep;
out float v_edge,v_along,v_bright;
out vec3 v_wpos;
out float v_ringPhase;
void main(){int vi=gl_VertexID;
  float side=(vi==1||vi==4||vi==5)?1.:-1.;
  float end=(vi>=2&&vi!=4)?1.:0.;
  vec3 P=mix(a_pA,a_pB,end);
  v_wpos=P;
  v_ringPhase=fract(dot(a_pA,vec3(.137,.293,.517))*10.);
  vec4 cA=u_vp*vec4(a_pA,1),cB=u_vp*vec4(a_pB,1),cP=u_vp*vec4(P,1);
  vec2 dir=cB.xy/cB.w-cA.xy/cA.w;float len=length(dir);
  dir=len>1e-6?dir/len:vec2(0,1);vec2 perp=vec2(-dir.y,dir.x);
  float al=a_along+end*u_eStep;float w=u_width*(1.-al*u_taper)/u_res.y;
  cP.xy+=perp*side*w*cP.w;gl_Position=cP;
  v_edge=side;v_along=al;v_bright=a_bright;}
