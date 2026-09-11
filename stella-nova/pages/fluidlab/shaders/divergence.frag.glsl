#version 300 es
precision highp float;in vec2 vUV;out vec4 fragColor;uniform sampler2D uVelocity,uBarrier;uniform vec2 uInvRes;
void main(){vec2 uv=vUV;if(texture(uBarrier,uv).r>.1){fragColor=vec4(0);return;}
fragColor=vec4((texture(uVelocity,uv+vec2(uInvRes.x,0)).x-texture(uVelocity,uv-vec2(uInvRes.x,0)).x+texture(uVelocity,uv+vec2(0,uInvRes.y)).y-texture(uVelocity,uv-vec2(0,uInvRes.y)).y)*.5,0,0,0);}