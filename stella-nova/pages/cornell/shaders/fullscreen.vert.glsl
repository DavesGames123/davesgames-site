// fullscreen.vert.glsl — shared vertex stage for both fragment passes
//
//   A pass-through for the fullscreen triangle. Positions arrive in clip space
//   (the JS uploads (-1,-1),(3,-1),(-1,3)), so this only forwards them. Both the
//   tracer and the display program use this same vertex shader; all the work is
//   per-fragment.
#version 300 es
in vec2 p; void main(){ gl_Position=vec4(p,0.,1.); }
