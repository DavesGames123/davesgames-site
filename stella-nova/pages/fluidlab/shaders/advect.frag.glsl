#version 300 es
precision highp float;in vec2 vUV;out vec4 fragColor;
uniform sampler2D uVelocity,uDye,uBarrier;uniform vec2 uInvRes;uniform float uDt,uAspect;uniform int uMode;
uniform int uNumEmitters,uNumShapes;uniform vec4 uEmitA[${MAX_E}],uEmitB[${MAX_E}],uEmitC[${MAX_E}];uniform vec4 uShapeA[${MAX_S}];
uniform vec2 uMousePos;uniform float uMouseDown,uMouseVortex,uGravity;
${BILERP_GLSL}
void main(){vec2 uv=vUV;float barrier=texture(uBarrier,uv).r;vec2 oldVel=texture(uVelocity,uv).xy;
if(uMode==0){
  if(barrier>.1){vec2 sv=vec2(0);for(int i=0;i<${MAX_S};i++){if(i>=uNumShapes)break;vec2 sc=uShapeA[i].xy;float om=uShapeA[i].z,rad=uShapeA[i].w;vec2 d=uv-sc;d.x*=uAspect;if(length(d)<rad*1.3&&abs(om)>.001){sv=vec2(-(uv.y-sc.y),(uv.x-sc.x))*om*800.0;}}fragColor=vec4(sv,0,0);return;}
  vec2 sp=uv-oldVel*uDt*uInvRes;vec2 vel=${SAMPLE_VEL};
  for(int i=0;i<${MAX_E};i++){if(i>=uNumEmitters)break;if(uEmitB[i].w<.5)continue;
    vec2 ep=uEmitA[i].xy,ed=uEmitA[i].zw;float es=uEmitB[i].x,ew=uEmitB[i].y;int et=int(uEmitB[i].z);
    vec2 d=uv-ep;
    if(et==0){
      d.x*=uAspect;
      vec2 edN=normalize(vec2(ed.x*uAspect,ed.y));
      vec2 perpN=vec2(-edN.y,edN.x);
      float along=dot(d,edN);
      float across=dot(d,perpN);
      float depth=max(uInvRes.x,uInvRes.y)*4.0;
      if(abs(across)<ew && abs(along)<depth){vel+=ed*es*uDt;}
    } else if(et==2){
      d.x*=uAspect;float dist=length(d);
      if(dist<ew){float t=smoothstep(ew,ew*.85,dist);
        vec2 tg=vec2(-d.y,d.x);if(length(tg)>.001)tg=normalize(tg);vel+=tg*es*t*uDt;}
    } else {
      d.x*=uAspect;float dist=length(d);
      if(dist<ew){float t=smoothstep(ew,ew*.85,dist);vel+=ed*es*t*uDt;}
    }}
  if(uMouseDown>.5){vec2 d=uv-uMousePos;d.x*=uAspect;float dist2=dot(d,d);
    vec2 tang=vec2(-d.y,d.x);float r=length(d);
    if(r>.002){tang/=r;vel+=tang*exp(-dist2/.004)*uMouseVortex*175.0*uDt;}}
  vel.y-=uGravity*uDt;
  float bw=uInvRes.x,bh=uInvRes.y;if(uv.x<bw||uv.x>1.0-bw||uv.y<bh||uv.y>1.0-bh)vel=vec2(0);
  fragColor=vec4(vel,0,0);
}else{
  vec2 sp=uv-oldVel*uDt*uInvRes;vec4 dye=${SAMPLE_DYE};if(barrier>.1){fragColor=vec4(0);return;}dye*=.997;
  for(int i=0;i<${MAX_E};i++){if(i>=uNumEmitters)break;if(uEmitB[i].w<.5)continue;
    vec2 ep=uEmitA[i].xy,ed=uEmitA[i].zw;float ew=uEmitB[i].y;int et=int(uEmitB[i].z);vec3 ec=uEmitC[i].rgb;vec2 d=uv-ep;
    if(et==0){
      d.x*=uAspect;vec2 edN=normalize(vec2(ed.x*uAspect,ed.y));vec2 perpN=vec2(-edN.y,edN.x);
      float along=dot(d,edN);float across=dot(d,perpN);float depth=max(uInvRes.x,uInvRes.y)*4.0;
      if(abs(across)<ew && abs(along)<depth){dye.rgb+=ec*.03;}
    } else {
      d.x*=uAspect;float dist=length(d);
      if(dist<ew){float t=smoothstep(ew,ew*.85,dist);dye.rgb+=ec*t*.03;}
    }}
  fragColor=dye;}}