#version 300 es
// jacobi.frag.glsl — solver stage 5: one Jacobi sweep of the pressure Poisson
//
//   Solve laplacian(p) = div u iteratively. Each pass sets a cell to the average
//   of its four neighbours minus the divergence, over a quarter. main.js runs
//   many of these sweeps (SIM.jacobiIters) ping-ponging the pressure texture;
//   more sweeps converge closer to a divergence-free result.
//
//   sP() enforces Neumann-like walls: pressure reads as 0 in barrier cells and
//   just outside the domain border, so flow does not leak through them.
//
//       p_new = ( p_left + p_right + p_down + p_up - divergence ) * 0.25
precision highp float;in vec2 vUV;out vec4 fragColor;uniform sampler2D uPressure,uDivergence,uBarrier;uniform vec2 uInvRes;
// Sample pressure, returning 0 inside barriers and at the domain border.
float sP(vec2 p){if(texture(uBarrier,p).r>.1)return 0.;vec2 b=uInvRes*2.;if(p.x<b.x||p.x>1.-b.x||p.y<b.y||p.y>1.-b.y)return 0.;return texture(uPressure,p).x;}
void main(){vec2 uv=vUV;fragColor=vec4((sP(uv-vec2(uInvRes.x,0))+sP(uv+vec2(uInvRes.x,0))+sP(uv-vec2(0,uInvRes.y))+sP(uv+vec2(0,uInvRes.y))-texture(uDivergence,uv).x)*.25,0,0,0);}