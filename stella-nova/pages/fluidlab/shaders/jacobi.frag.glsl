#version 300 es
precision highp float;in vec2 vUV;out vec4 fragColor;uniform sampler2D uPressure,uDivergence,uBarrier;uniform vec2 uInvRes;
float sP(vec2 p){if(texture(uBarrier,p).r>.1)return 0.;vec2 b=uInvRes*2.;if(p.x<b.x||p.x>1.-b.x||p.y<b.y||p.y>1.-b.y)return 0.;return texture(uPressure,p).x;}
void main(){vec2 uv=vUV;fragColor=vec4((sP(uv-vec2(uInvRes.x,0))+sP(uv+vec2(uInvRes.x,0))+sP(uv-vec2(0,uInvRes.y))+sP(uv+vec2(0,uInvRes.y))-texture(uDivergence,uv).x)*.25,0,0,0);}