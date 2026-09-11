#version 300 es
// quad.vert.glsl — full-screen quad, vertex stage (shared by every solver pass)
//
//   Pass the clip-space corners through and hand the fragment stage a 0..1 UV
//   (aPosition*.5+.5). Every fluid pass samples its textures by this vUV.
in vec2 aPosition;out vec2 vUV;void main(){vUV=aPosition*.5+.5;gl_Position=vec4(aPosition,0,1);}