#version 300 es
// ============================================================================
//  boid-sim.frag.glsl — GPU boid swarm update (one simulation tick)
// ----------------------------------------------------------------------------
//  Each pixel is one boid; the position and velocity textures hold the swarm.
//  This pass reads the current pos/vel, integrates the flocking forces, and
//  writes the next pos/vel to two MRT attachments (main.js ping-pongs them).
//
//  FORCES SUMMED INTO acc
//  ----------------------
//      wall avoid    push out along the density gradient when near/inside solid
//      separation    steer away from close neighbours (12 sampled cells)
//      alignment     match neighbours' velocity
//      cohesion      drift toward neighbours' centre
//      curl wander   a smooth divergence-free swirl for life
//      keep-near     pull back when farther than uRegion from the camera
//      wall cling    near a surface, slide tangentially and stick lightly
//  Speed is clamped to a band; boids that get buried or stray too far respawn
//  near the camera. density() here matches the scene and main.js versions.
//
//  SECTION MAP   (grep -n "<anchor>" boid-sim.frag.glsl)
//      noise/density . "float hash13"   value noise and the shared field
//      gradient ...... "vec3 dgrad"     density gradient (wall normal)
//      curl .......... "vec3 curl"      wander field
//      main .......... "void main"      integrate one boid, respawn if lost
// ============================================================================
precision highp float;
// Two outputs: new position (xyz + age in w) and new velocity (xyz + seed in w).
layout(location=0) out vec4 outPos;
layout(location=1) out vec4 outVel;
uniform sampler2D uPos,uVel;
uniform float uW,uDt,uTime;
uniform vec3 uRO,uSeedVec;
uniform float uFreq,uHeight,uThresh,uSlope,uMorphAmt,uMorphTime;
uniform int uOct;
uniform float uAvoid,uCling,uCohesion,uWander,uSpeed,uRegion;
// Value noise and the shared voxel density, identical to the scene shader so the
// swarm avoids exactly the terrain the renderer draws.
float hash13(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }
float vnoise(vec3 x){
  vec3 i=floor(x), f=fract(x); vec3 u=f*f*(3.0-2.0*f);
  float n000=hash13(i),n100=hash13(i+vec3(1,0,0)),n010=hash13(i+vec3(0,1,0)),n110=hash13(i+vec3(1,1,0));
  float n001=hash13(i+vec3(0,0,1)),n101=hash13(i+vec3(1,0,1)),n011=hash13(i+vec3(0,1,1)),n111=hash13(i+vec3(1,1,1));
  float x00=mix(n000,n100,u.x),x10=mix(n010,n110,u.x),x01=mix(n001,n101,u.x),x11=mix(n011,n111,u.x);
  return mix(mix(x00,x10,u.y),mix(x01,x11,u.y),u.z);
}
float density(vec3 p){
  vec3 q=p*uFreq+uSeedVec; q+=vec3(0.5,1.0,0.4)*(uMorphAmt*uMorphTime);
  float f=0.0,amp=0.5,fr=1.0,nrm=0.0;
  for(int i=0;i<8;i++){ if(i>=uOct)break; f+=amp*vnoise(q*fr); nrm+=amp; fr*=2.02; amp*=0.5; }
  f/=max(nrm,1e-4); return uHeight*f - uSlope*p.y - uThresh;
}
// Density gradient by central differences: points into solid, so -grad steers
// out toward open air.
vec3 dgrad(vec3 p){ float e=1.6; return vec3(
  density(p+vec3(e,0,0))-density(p-vec3(e,0,0)),
  density(p+vec3(0,e,0))-density(p-vec3(0,e,0)),
  density(p+vec3(0,0,e))-density(p-vec3(0,0,e))); }
// A smooth swirling field for organic wander (a cheap curl-noise stand-in).
vec3 curl(vec3 p){ float t=uTime*0.4; return vec3(
  sin(p.y*0.08+t)-cos(p.z*0.07-t), sin(p.z*0.06-t)-cos(p.x*0.09+t), sin(p.x*0.07+t)-cos(p.y*0.08-t)); }
void main(){
  vec2 uv=gl_FragCoord.xy/uW;
  vec4 P=texture(uPos,uv),V=texture(uVel,uv);
  vec3 pos=P.xyz; float age=P.w; vec3 vel=V.xyz; float seed=V.w;
  float dt=min(uDt,0.033);
  float d=density(pos);
  vec3 n=normalize(dgrad(pos)+1e-5);            // points INTO solid
  vec3 acc=vec3(0.0);
  float SAFE=3.0;
  if(d>-SAFE) acc += -n*(d+SAFE)*uAvoid;        // steer out of walls
  // Sample 12 nearby texels as neighbours and accumulate the three flocking
  // terms: separation (inverse-square push), alignment (mean velocity), cohesion
  // (mean position). The texture wraps, so neighbours are cheap fixed offsets.
  // boid neighbours (separation / alignment / cohesion)
  vec2 px=1.0/vec2(uW);
  vec2 offs[12]=vec2[12](vec2(1.,0.),vec2(0.,1.),vec2(-1.,0.),vec2(0.,-1.),vec2(1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(-1.,-1.),vec2(3.,2.),vec2(-2.,4.),vec2(6.,-5.),vec2(-7.,-3.));
  vec3 sep=vec3(0.0),ali=vec3(0.0),coh=vec3(0.0); float cnt=1e-3;
  for(int j=0;j<12;j++){
    vec2 nuv=fract(uv+offs[j]*px);
    vec3 np=texture(uPos,nuv).xyz; vec3 nv=texture(uVel,nuv).xyz;
    vec3 dl=pos-np; float ds=length(dl)+1e-3;
    if(ds<5.0) sep += dl/(ds*ds);
    ali+=nv; coh+=np; cnt+=1.0;
  }
  ali/=cnt; coh/=cnt;
  acc += sep*0.9*uCohesion + (ali-vel)*1.7*uCohesion + (coh-pos)*0.06*uCohesion;
  acc += curl(pos)*uWander;
  vec3 toCam=uRO-pos; float dc=length(toCam);
  if(dc>uRegion) acc += normalize(toCam)*(dc-uRegion)*0.06;   // keep near the viewed field
  vel += acc*dt;
  // wall cling: near a surface, slide tangentially and stick lightly
  float cling=smoothstep(2.6,0.0,abs(d));
  vel = mix(vel, vel - dot(vel,n)*n, cling*uCling);
  vel += -n*clamp(d,-1.0,1.0)*cling*uCling*0.8;
  // Clamp speed into a band (never fully stop, never overspeed), then integrate.
  float sp=length(vel), mx=uSpeed;
  if(sp>mx) vel*=mx/sp; else if(sp<mx*0.3 && sp>1e-4) vel*=(mx*0.3)/sp;
  pos += vel*dt; age+=dt;
  // Recycle boids that end up deep in solid, too far away, or past their lifespan.
  if(d>4.5 || dc>uRegion*1.9 || age>(18.0+seed*22.0)){       // respawn lost / buried boids
    vec3 r=vec3(hash13(pos+uTime),hash13(pos*1.3+uTime*1.7),hash13(pos*0.7+uTime*0.3))-0.5;
    pos=uRO+r*uRegion*1.1; vel=r*uSpeed; age=0.0;
  }
  outPos=vec4(pos,age); outVel=vec4(vel,seed);
}
