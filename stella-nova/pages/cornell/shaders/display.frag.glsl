#version 300 es
precision highp float; out vec4 frag; uniform sampler2D uAccum; uniform vec2 uRes;
vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.,1.);}
void main(){ vec3 c=texture(uAccum,gl_FragCoord.xy/uRes).rgb; c=aces(c); c=pow(c,vec3(1.0/2.2)); frag=vec4(c,1.0); }
