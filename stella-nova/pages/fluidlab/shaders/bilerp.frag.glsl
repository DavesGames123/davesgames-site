
// bilerp.frag.glsl — manual bilinear sampling (GLSL fragment, not a full shader)
//
//   Spliced into advect.frag.glsl on GPUs that cannot linearly filter float
//   textures. Reads the four texels around uv and blends them by the fractional
//   position, reproducing hardware LINEAR filtering by hand. Has no #version or
//   main; main.js injects it as a helper function.
//
//       a───b     blend a,b by fuv.x (top), c,d by fuv.x (bottom),
//       │ · │     then blend those two by fuv.y  ->  smooth sample at ·
//       c───d
vec4 bilerp(sampler2D tex,vec2 uv,vec2 invRes){
  vec2 res=1.0/invRes;vec2 st=uv*res-0.5;
  vec2 iuv=floor(st);vec2 fuv=fract(st);
  vec4 a=texture(tex,(iuv+vec2(0.5,0.5))*invRes);
  vec4 b=texture(tex,(iuv+vec2(1.5,0.5))*invRes);
  vec4 c=texture(tex,(iuv+vec2(0.5,1.5))*invRes);
  vec4 d=texture(tex,(iuv+vec2(1.5,1.5))*invRes);
  return mix(mix(a,b,fuv.x),mix(c,d,fuv.x),fuv.y);}