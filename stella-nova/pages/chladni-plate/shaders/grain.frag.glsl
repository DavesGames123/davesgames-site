#version 300 es
precision mediump float;
uniform float uW;
in float vW;
out vec4 o;
void main() { o = vec4(uW * vW); }
