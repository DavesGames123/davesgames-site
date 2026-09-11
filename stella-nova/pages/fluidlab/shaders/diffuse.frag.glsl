#version 300 es
precision highp float;in vec2 vUV;out vec4 fragColor;
uniform sampler2D uVel,uVel0,uBarrier;uniform vec2 uInvRes;uniform float uA;
void main(){vec2 uv=vUV;vec2 src=texture(uVel0,uv).xy;
  if(texture(uBarrier,uv).r>.1){fragColor=vec4(src,0,0);return;}
  vec2 l=texture(uVel,uv-vec2(uInvRes.x,0)).xy;
  vec2 r=texture(uVel,uv+vec2(uInvRes.x,0)).xy;
  vec2 d=texture(uVel,uv-vec2(0,uInvRes.y)).xy;
  vec2 u=texture(uVel,uv+vec2(0,uInvRes.y)).xy;
  fragColor=vec4((src+uA*(l+r+d+u))/(1.0+4.0*uA),0,0);}