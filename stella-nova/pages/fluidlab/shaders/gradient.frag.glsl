#version 300 es
precision highp float;in vec2 vUV;out vec4 fragColor;uniform sampler2D uPressure,uVelocity,uBarrier;uniform vec2 uInvRes;
void main(){vec2 uv=vUV;if(texture(uBarrier,uv).r>.1){fragColor=texture(uVelocity,uv);return;}
fragColor=vec4(texture(uVelocity,uv).xy-vec2(texture(uPressure,uv+vec2(uInvRes.x,0)).x-texture(uPressure,uv-vec2(uInvRes.x,0)).x,texture(uPressure,uv+vec2(0,uInvRes.y)).x-texture(uPressure,uv-vec2(0,uInvRes.y)).x)*.5,0,0);}