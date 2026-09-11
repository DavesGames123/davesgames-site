
vec4 bilerp(sampler2D tex,vec2 uv,vec2 invRes){
  vec2 res=1.0/invRes;vec2 st=uv*res-0.5;
  vec2 iuv=floor(st);vec2 fuv=fract(st);
  vec4 a=texture(tex,(iuv+vec2(0.5,0.5))*invRes);
  vec4 b=texture(tex,(iuv+vec2(1.5,0.5))*invRes);
  vec4 c=texture(tex,(iuv+vec2(0.5,1.5))*invRes);
  vec4 d=texture(tex,(iuv+vec2(1.5,1.5))*invRes);
  return mix(mix(a,b,fuv.x),mix(c,d,fuv.x),fuv.y);}