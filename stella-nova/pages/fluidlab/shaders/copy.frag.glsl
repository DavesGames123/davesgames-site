#version 300 es
// copy.frag.glsl — copy pass
//
//   Copy one texture verbatim. Used by the viscous solve to stash the
//   post-advection velocity u* as the fixed right-hand side before the
//   diffusion sweeps overwrite the velocity field.
precision highp float;in vec2 vUV;out vec4 fragColor;uniform sampler2D uTex;
void main(){fragColor=texture(uTex,vUV);}