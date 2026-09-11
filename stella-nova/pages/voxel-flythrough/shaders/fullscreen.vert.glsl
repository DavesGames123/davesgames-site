#version 300 es
// fullscreen.vert.glsl — attribute-less full-screen triangle (scene and post)
//
//   Generate one oversized triangle from gl_VertexID alone (no vertex buffer):
//   IDs 0,1,2 map to clip-space corners that cover the screen. Both the scene
//   raymarch and the CRT post pass draw with three vertices and this shader.
void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }
