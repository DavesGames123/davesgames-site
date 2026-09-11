
struct Uniforms {
  resolution: vec2f,
  time: f32,
  mouseX: f32,
  zoom: f32,
  density_scale: f32,
  quality: f32,
  brightness: f32,
  seed: f32,
  scale: f32,
  _p0: f32, _p1: f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var iChannel0: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

fn glsl_mod(x:f32,y:f32)->f32{return x-y*floor(x/y);}

fn noise(x:vec3f)->f32{
  let p=floor(x);let f_raw=fract(x);let f=f_raw*f_raw*(3.0-2.0*f_raw);
  let uv=(p.xy+vec2f(37.0,17.0)*p.z)+f.xy;
  let rg=textureSampleLevel(iChannel0,samp,(uv+0.5)/256.0,0.0).yx;
  return 1.0-0.82*mix(rg.x,rg.y,f.z);
}
fn fbm(p:vec3f)->f32{return noise(p*0.06125)*0.5+noise(p*0.125)*0.25+noise(p*0.25)*0.125+noise(p*0.4)*0.1;}
fn Sphere(p:vec3f,r:f32)->f32{return length(p)-r;}

fn SpiralNoiseC(p_in:vec3f)->f32{
  let nudge=4.0;let normalizer=1.0/sqrt(1.0+nudge*nudge);
  var n=-glsl_mod(u.time*0.2,-2.0);var iter=2.0;var p=p_in;
  for(var i=0;i<8;i++){
    // smooth — no abs(), removes the ridged/topographic contour lines
    n+=(sin(p.y*iter)+cos(p.x*iter))/iter;
    p=vec3f((p.x+p.y*nudge)*normalizer,(p.y-p.x*nudge)*normalizer,p.z);
    p=vec3f((p.x+p.z*nudge)*normalizer,p.y,(p.z-p.x*nudge)*normalizer);
    iter*=1.733733;
  }
  return n;
}

fn VolumetricExplosion(p:vec3f)->f32{
  let so=vec3f(u.seed*100.0,u.seed*73.0,u.seed*37.0);
  var r=Sphere(p,4.0);
  r+=fbm((p+so)*50.0);
  r+=SpiralNoiseC(p.zxy*0.4132+333.0+so*0.01)*2.0;
  return r;
}

fn mapScene(p_in:vec3f)->f32{
  // Mouse rotation only — no time rotation
  let a=u.mouseX*0.008*3.14159265;
  let ca=cos(a);let sa=sin(a);
  let p=vec3f(ca*p_in.x+sa*p_in.z,p_in.y,-sa*p_in.x+ca*p_in.z);
  // Scale from dope sheet
  let s=u.scale;
  return VolumetricExplosion(p/s)*s;
}

fn computeColor(density:f32,radius:f32)->vec3f{
  var result=mix(vec3f(1.0,0.9,0.8),vec3f(0.4,0.15,0.1),density);
  let colCenter=12.0*vec3f(0.8,1.0,1.0);
  let colEdge=3.0*vec3f(0.48,0.53,0.5);
  result*=mix(colCenter,colEdge,min((radius+0.05)/0.9,1.15));
  return result;
}

fn boundRadiusSq()->f32{
  let r=4.0*u.scale*1.3;
  return r*r;
}

fn RaySphereIntersect(org:vec3f,dir:vec3f,near:ptr<function,f32>,far:ptr<function,f32>)->bool{
  let b=dot(dir,org);let c=dot(org,org)-boundRadiusSq();
  let delta=b*b-c;if(delta<0.0){return false;}
  let sq=sqrt(delta);*near=-b-sq;*far=-b+sq;return *far>0.0;
}

@fragment fn fs(@builtin(position) fragCoord:vec4f)->@location(0) vec4f{
  let uv=fragCoord.xy/u.resolution;
  let rd=normalize(vec3f((fragCoord.xy-0.5*u.resolution)/u.resolution.y,1.0));
  let ro=vec3f(0.0,0.0,-6.0+u.zoom*1.6);
  var ld=0.0;var td=0.0;var w=0.0;var d_outer=1.0;var t=0.0;let h=0.1;
  var sum=vec4f(0.0);var min_dist=0.0;var max_dist=0.0;

  if(RaySphereIntersect(ro,rd,&min_dist,&max_dist)){
    t=min_dist*step(t,min_dist);
    let maxIter=select(select(56,86,u.quality>0.5),128,u.quality>1.5);
    for(var i=0;i<128;i++){
      if(i>=maxIter){break;}
      let pos=ro+t*rd;
      if(td>0.9||d_outer<0.12*t||t>10.0||sum.a>0.99||t>max_dist){break;}
      var d=mapScene(pos);
      d=max(d,0.04);
      let ldst=-pos;let lDist=max(length(ldst),0.001);
      let lightColor=vec3f(1.0,0.5,0.25);
      sum=vec4f(sum.rgb+lightColor/exp(lDist*lDist*lDist*0.08)/8.0,sum.a);
      if(d<h){
        ld=h-d;w=(1.0-td)*ld;td+=w+1.0/200.0;
        var col=vec4f(computeColor(td,lDist),td);
        sum+=sum.a*vec4f(sum.rgb,0.0)*0.5/lDist;
        col=vec4f(col.rgb,col.a*0.2);col=vec4f(col.rgb*col.a,col.a);
        sum=sum+col*(1.0-sum.a);
      }
      td+=1.0/70.0;
      let uvd=vec2f(uv.x*280.0,uv.y*120.0);
      let dith=textureSampleLevel(iChannel0,samp,vec2f(uvd.y,-uvd.x+0.5*sin(4.0*u.time+uvd.y*4.0))/256.0,0.0).r;
      let d_step=abs(d)*(0.8+0.08*dith);
      d_outer=d;
      t+=max(d_step*0.1*max(min(length(ldst),d_step),2.0),0.02);
    }
    sum*=1.0/exp(ld*0.2)*1.5*u.density_scale;
    sum=vec4f(sum.xyz*u.brightness,sum.a);
    sum=clamp(sum,vec4f(0.0),vec4f(1.0));
    sum=vec4f(sum.xyz*sum.xyz*(3.0-2.0*sum.xyz),sum.a);
  }
  return vec4f(sum.xyz,1.0);
}
struct VSOut{@builtin(position) pos:vec4f};
@vertex fn vs(@builtin(vertex_index) vi:u32)->VSOut{
  var p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var o:VSOut;o.pos=vec4f(p[vi],0,1);return o;
}
