#version 300 es
// The sand trail fades: the blend is dst * src (ZERO, SRC_COLOR).
precision mediump float;
uniform float uDecay;
out vec4 o;
void main() { o = vec4(uDecay); }
