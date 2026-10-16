#version 300 es
// vorticity.frag.glsl — vorticity stage B: vorticity confinement force
//
//   Semi-Lagrangian advection smears small swirls. Confinement (Fedkiw,
//   Stam and Jensen 2001) puts the lost spin back: N points up the gradient
//   of |w| toward the swirl centre, and the force eps (N x w) dt turns the
//   flow round that centre. uCurl is the eps scale; 0 turns it off.
//
//       N = grad|w| / |grad|w||     f = eps * (N.y * w, -N.x * w)
precision highp float;in vec2 vUV;out vec4 fragColor;
uniform sampler2D uVelocity,uCurlTex,uBarrier;uniform vec2 uInvRes;uniform float uCurl,uDt;
void main(){vec2 uv=vUV;vec2 vel=texture(uVelocity,uv).xy;
  if(texture(uBarrier,uv).r>.1){fragColor=vec4(vel,0,0);return;}
  float l=abs(texture(uCurlTex,uv-vec2(uInvRes.x,0)).x),r=abs(texture(uCurlTex,uv+vec2(uInvRes.x,0)).x);
  float d=abs(texture(uCurlTex,uv-vec2(0,uInvRes.y)).x),u=abs(texture(uCurlTex,uv+vec2(0,uInvRes.y)).x);
  float w=texture(uCurlTex,uv).x;
  vec2 n=vec2(r-l,u-d)*.5;n/=length(n)+1e-4;
  vel+=vec2(n.y*w,-n.x*w)*uCurl*uDt;
  fragColor=vec4(vel,0,0);}
