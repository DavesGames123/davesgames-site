#version 300 es
precision highp float;in vec2 vUV;out vec4 fragColor;uniform sampler2D uVelocity,uDye,uBarrier;uniform float uGain,uBloom;uniform int uCmap;
${TEX_CAN_LINEAR?'':
`vec4 bilerp2(sampler2D tex,vec2 uv){
  vec2 res=vec2(textureSize(tex,0));vec2 st=uv*res-0.5;
  vec2 iuv=floor(st);vec2 fuv=fract(st);vec2 inv=1.0/res;
  vec4 a=texture(tex,(iuv+vec2(0.5,0.5))*inv);
  vec4 b=texture(tex,(iuv+vec2(1.5,0.5))*inv);
  vec4 c=texture(tex,(iuv+vec2(0.5,1.5))*inv);
  vec4 d=texture(tex,(iuv+vec2(1.5,1.5))*inv);
  return mix(mix(a,b,fuv.x),mix(c,d,fuv.x),fuv.y);}`}
vec3 cmP(float t){t=clamp(t,0.,1.);const vec3 c[8]=vec3[8](vec3(0),vec3(.08,.02,.22),vec3(.25,.05,.45),vec3(.55,.08,.35),vec3(.8,.2,.05),vec3(1,.55,0),vec3(1,.85,.3),vec3(1,1,.92));float s=t*7.;if(s>=7.)return c[7];int i=int(s);return mix(c[i],c[i+1],fract(s));}
vec3 cmV(float t){t=clamp(t,0.,1.);const vec3 c[8]=vec3[8](vec3(.267,.004,.329),vec3(.283,.141,.458),vec3(.254,.265,.530),vec3(.164,.471,.558),vec3(.128,.567,.551),vec3(.134,.658,.517),vec3(.478,.821,.318),vec3(.993,.906,.144));float s=t*7.;if(s>=7.)return c[7];int i=int(s);return mix(c[i],c[i+1],fract(s));}
vec3 cmO(float t){t=clamp(t,0.,1.);const vec3 c[8]=vec3[8](vec3(.02,.02,.15),vec3(.02,.1,.35),vec3(0,.25,.55),vec3(0,.45,.55),vec3(0,.6,.5),vec3(.1,.75,.45),vec3(.4,.85,.3),vec3(1,.95,.3));float s=t*7.;if(s>=7.)return c[7];int i=int(s);return mix(c[i],c[i+1],fract(s));}
void main(){vec2 uv=vUV;float barrier=texture(uBarrier,uv).r;${TEX_CAN_LINEAR?'vec2 vel=texture(uVelocity,uv).xy;vec3 dye=texture(uDye,uv).rgb;':'vec2 vel=bilerp2(uVelocity,uv).xy;vec3 dye=bilerp2(uDye,uv).rgb;'}vec3 col;
  if(barrier>.1){col=vec3(.10,.14,.20);vec2 ts=vec2(1)/vec2(textureSize(uBarrier,0));float edge=abs(texture(uBarrier,uv+vec2(ts.x,0)).r-texture(uBarrier,uv-vec2(ts.x,0)).r)+abs(texture(uBarrier,uv+vec2(0,ts.y)).r-texture(uBarrier,uv-vec2(0,ts.y)).r);col+=vec3(.12,.25,.35)*clamp(edge*3.,0.,1.);}
  else{float speed=length(vel);float t=clamp(log(1.+speed*uGain*.2)/2.5,0.,1.);
    if(uCmap==0)col=cmP(t);else if(uCmap==1)col=cmV(t);else if(uCmap==2)col=cmO(t);else{col=dye*uGain*1.5+vec3(t*.04);}col+=col*uBloom;}
  fragColor=vec4(col,1);}