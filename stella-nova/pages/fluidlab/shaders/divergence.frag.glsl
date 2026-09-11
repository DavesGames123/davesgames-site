#version 300 es
// divergence.frag.glsl — solver stage 4: velocity divergence
//
//   Compute div u = du/dx + dv/dy by central differences on the advected
//   velocity. This scalar field is the right-hand side of the pressure Poisson
//   equation that the jacobi stage solves. Barrier cells output zero.
//
//       (l)───(r)   d/dx = (r.x - l.x)/2 , d/dy = (u.y - d.y)/2
//         │  ·  │    div  = their sum  ->  stored in the red channel
//       (d)───(u)
precision highp float;in vec2 vUV;out vec4 fragColor;uniform sampler2D uVelocity,uBarrier;uniform vec2 uInvRes;
void main(){vec2 uv=vUV;if(texture(uBarrier,uv).r>.1){fragColor=vec4(0);return;}
fragColor=vec4((texture(uVelocity,uv+vec2(uInvRes.x,0)).x-texture(uVelocity,uv-vec2(uInvRes.x,0)).x+texture(uVelocity,uv+vec2(0,uInvRes.y)).y-texture(uVelocity,uv-vec2(0,uInvRes.y)).y)*.5,0,0,0);}