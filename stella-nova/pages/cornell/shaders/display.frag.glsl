// display.frag.glsl — tonemap pass
//
//   The final present. It reads one texel of the accumulation buffer (the running
//   average of all path-traced samples, in linear HDR), applies the ACES filmic
//   curve to compress highlights, then gamma-encodes to sRGB for the screen. This
//   is the only pass that writes the visible canvas; the tracer pass writes only
//   the float accumulation texture.
//
//     uAccum (linear HDR average) ─▶ ACES tonemap ─▶ gamma 1/2.2 ─▶ canvas
#version 300 es
precision highp float; out vec4 frag; uniform sampler2D uAccum; uniform vec2 uRes;
// ACES filmic tonemap curve (matches acesT in main.js for CPU/GPU parity).
vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.,1.);}
void main(){ vec3 c=texture(uAccum,gl_FragCoord.xy/uRes).rgb; c=aces(c); c=pow(c,vec3(1.0/2.2)); frag=vec4(c,1.0); }
