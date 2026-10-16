#version 300 es
// curl.frag.glsl — vorticity stage A: scalar curl of the velocity
//
//   Compute w = dv/dx - du/dy by central differences. The vorticity stage
//   reads this field to find the swirl centres. Barrier cells output zero.
//
//       (l)───(r)   w = ((r.y - l.y) - (u.x - d.x)) / 2
//         │  ·  │   stored in the red channel
//       (d)───(u)
precision highp float;in vec2 vUV;out vec4 fragColor;uniform sampler2D uVelocity,uBarrier;uniform vec2 uInvRes;
void main(){vec2 uv=vUV;if(texture(uBarrier,uv).r>.1){fragColor=vec4(0);return;}
float l=texture(uVelocity,uv-vec2(uInvRes.x,0)).y,r=texture(uVelocity,uv+vec2(uInvRes.x,0)).y;
float d=texture(uVelocity,uv-vec2(0,uInvRes.y)).x,u=texture(uVelocity,uv+vec2(0,uInvRes.y)).x;
fragColor=vec4(((r-l)-(u-d))*.5,0,0,0);}
