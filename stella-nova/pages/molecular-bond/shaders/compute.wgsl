struct CU{scaler:f32,colorMode:u32,numAtoms:u32,invScale:f32,count:u32,p0:u32,p1:u32,p2:u32};
@group(0)@binding(0) var<uniform> cu:CU;@group(0)@binding(1) var<storage,read> pos:array<vec4f>;
@group(0)@binding(2) var<storage,read_write> col:array<vec4f>;@group(0)@binding(3) var<storage,read> ad:array<vec4f>;
fn eo(lx:f32,ly:f32,lz:f32,ot:u32)->f32{let r=length(vec3f(lx,ly,lz));if(r<.001){return 0.0;}
  switch(ot){case 0u:{return .5642*exp(-r);}case 1u:{return .09973*(2-r)*exp(-r*.5);}
  case 2u:{return .09973*lx*exp(-r*.5);}case 3u:{return .09973*ly*exp(-r*.5);}
  case 4u:{return .004022*(27-18*r+2*r*r)*exp(-r/3);}case 5u:{return .01478*lx*(4-2*r/3)*exp(-r/3);}
  case 6u:{return .01478*ly*(4-2*r/3)*exp(-r/3);}case 7u:{return .002842*(2*lx*lx-ly*ly-lz*lz)*exp(-r/3);}
  case 8u:{return .009847*lx*ly*exp(-r/3);}case 9u:{return .009847*ly*lz*exp(-r/3);}default:{return 0.0;}}}
fn heat(hv:f32)->vec3f{let v=clamp(hv,0.0,1.0);
  if(v<.2){return mix(vec3f(0,0,.03),vec3f(.12,.02,.42),v*5);}
  if(v<.4){return mix(vec3f(.12,.02,.42),vec3f(.15,.3,.85),(v-.2)*5);}
  if(v<.6){return mix(vec3f(.15,.3,.85),vec3f(.15,.72,.95),(v-.4)*5);}
  if(v<.8){return mix(vec3f(.15,.72,.95),vec3f(.7,.92,.5),(v-.6)*5);}
  return mix(vec3f(.7,.92,.5),vec3f(1,1,1),(v-.8)*5);}
@compute @workgroup_size(256) fn cs(@builtin(global_invocation_id) gid:vec3u){
  let idx=gid.x;if(idx>=cu.count){return;}
  if(idx<cu.numAtoms){col[idx]=vec4f(.6,.8,1,1);return;}
  let p=pos[idx];let ax=p.x*cu.invScale;let ay=p.y*cu.invScale;let az=p.z*cu.invScale;
  var psi:f32=0;var sI:f32=0;
  for(var i:u32=0u;i<cu.numAtoms;i=i+1u){
    let pp=ad[i*2u];let oi=ad[i*2u+1u];let Z=oi.y;
    let dx=(ax-pp.x)*Z;let dy=(ay-pp.y)*Z;let dz=(az-pp.z)*Z;
    let phi=pow(Z,1.5)*eo(dx,dy,dz,u32(oi.x));
    psi=psi+pp.w*phi;sI=sI+phi*phi;}
  let dens=psi*psi;var c:vec3f;
  if(cu.colorMode==0u){c=heat(dens*cu.scaler);}
  else if(cu.colorMode==1u){let avg=sI/f32(cu.numAtoms);let dl=(dens-avg)*cu.scaler*2.5;let ct=clamp(dl,-1.0,1.0);
    if(ct>=0){c=mix(vec3f(.02,.02,.04),vec3f(.2,.9,1),sqrt(ct));}else{c=mix(vec3f(.02,.02,.04),vec3f(1,.2,.1),sqrt(-ct));}}
  else{let mg=clamp(abs(psi)*cu.scaler*.4,0.0,1.0);
    if(psi>=0){c=mix(vec3f(.02,.02,.06),vec3f(.3,.7,1),mg);}else{c=mix(vec3f(.06,.02,.02),vec3f(1,.25,.12),mg);}}
  col[idx]=vec4f(c,.85);}