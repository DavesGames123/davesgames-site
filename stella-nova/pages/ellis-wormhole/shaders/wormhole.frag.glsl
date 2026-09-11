// wormhole.frag.glsl — Ellis wormhole geodesic ray tracer, fragment stage
//
//   For each pixel it builds a view ray, then bends that ray through the Ellis
//   wormhole metric instead of letting it travel straight. The ray is followed
//   as a null geodesic in the curved space; where it finally escapes decides
//   which of two universes' skies it sees. A ray aimed near the throat crosses
//   to the far universe; a ray with too much angular momentum is turned back.
//
//   THROAT PROFILE   r(l) = sqrt(k^2 + [max(0, |l| - a)]^2)
//   --------------------------------------------------------------------------
//     Universe B                 throat                 Universe A
//     (l < 0, cool tint)     (l = 0, radius = k)    (l > 0, warm tint)
//          ◀──────────────────────●──────────────────────▶   l  (proper radial)
//                            flat throat of half-width a
//     l is the through-the-throat coordinate; the circumferential radius r
//     never shrinks below k, so the wormhole has no horizon.
//
//   PER-PIXEL TRACE
//   --------------------------------------------------------------------------
//     ray ─▶ buildOrbPlane()  reduce 3D ray to a 2D (radial, tangent) plane
//         ─▶ initWRay()       state = (l, theta, dl, dtheta), null-normalised
//         ─▶ step Euler/RK4   integrate the geodesic, adaptive dl near throat
//         ─▶ escape at |l| > escapeR ─▶ sampleSky of universe A (l>0) or B (l<0)
//         ─▶ segDisc()        optional accretion disc crossing in the y=0 plane
//
//   Uniforms come from main.js: camera basis, throat k/a, integrator choice,
//   step budget, background mode, and u_camL (which universe the camera is in).
#version 300 es
precision highp float;
uniform vec2 u_res;
uniform vec3 u_camPos,u_camFwd,u_camRight,u_camUp;
uniform float u_focalLen;
uniform float u_throatK,u_throatA;
uniform float u_discInner,u_discOuter;
uniform float u_dl,u_maxSteps,u_escapeR;
uniform float u_useGeodesic,u_useRK4,u_showDisc,u_showGlow;
uniform float u_bgMode,u_camL;
out vec4 fragColor;
const float PI=3.141592653589793;

// Value-noise helpers and a direction-to-equirectangular mapping for the skies.
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
vec2 hash22(vec2 p){return vec2(hash21(p+vec2(17.0,59.4)),hash21(p+vec2(63.1,12.8)));}
vec2 bgUV(vec3 d){return vec2(atan(d.z,d.x)/(2.0*PI)+0.5,acos(clamp(d.y,-1.0,1.0))/PI);}

// The Ellis throat radius r(l) and its derivative r'(l). The flat throat of
// half-width a keeps r constant (r'=0) across the neck; outside it, r grows.
float whR(float l){float x=max(0.0,abs(l)-u_throatA);return sqrt(u_throatK*u_throatK+x*x);}
float whRp(float l){float al=abs(l);if(al<=u_throatA)return 0.0;float x=al-u_throatA;return sign(l)*x/sqrt(u_throatK*u_throatK+x*x);}

// The five background skies (selected by u_bgMode). Each maps a ray direction
// to a procedural pattern; warm tints one universe orange, cool tints the other
// blue, so a traveller can tell which side they are looking into.
// Starfield: a Milky-Way band plus two hashed star layers.
vec3 sampleStars(vec3 dir,float warm){
  vec2 skyUv=bgUV(dir);vec3 col=vec3(0.01,0.012,0.028);
  vec3 mwN=normalize(vec3(0.26,0.9,-0.34));float pd=abs(dot(dir,mwN));
  float mwB=exp(-pow(pd/0.17,2.0)),mwR=exp(-pow(pd/0.024,2.0));
  float mwNs=0.55+0.45*hash21(skyUv*vec2(220.0,110.0));
  float mwS=mwB*mwNs*0.42,mwC=mwS*(0.45+1.25*mwB);
  col+=vec3(0.75,0.65,0.55)*mwS+vec3(1.0)*mwR*0.35;
  vec2 pUv=skyUv*vec2(720.0,360.0);vec2 pC=floor(pUv);
  float pD=clamp(0.046+mwC*0.085,0.0,0.56);
  for(int oy=-1;oy<=1;oy++)for(int ox=-1;ox<=1;ox++){
    vec2 c=pC+vec2(float(ox),float(oy));float s=hash21(c);
    if(s>1.0-pD){vec2 o=(hash22(c)-0.5)*0.7;float d=length(pUv-c-0.5-o);
    float g=smoothstep(0.14,0.0,d);col+=vec3(1.0)*g*(0.8+1.4*hash21(c+vec2(101.3,7.7))+mwC*3.2);}}
  vec2 sUv=skyUv*vec2(1200.0,600.0);vec2 sC=floor(sUv);
  float sD=clamp(0.022+mwC*0.05,0.0,0.44);
  for(int oy=-1;oy<=1;oy++)for(int ox=-1;ox<=1;ox++){
    vec2 c=sC+vec2(float(ox),float(oy));float s=hash21(c+vec2(211.0,503.0));
    if(s>1.0-sD){vec2 o=(hash22(c+vec2(5.2,91.7))-0.5)*0.5;float d=length(sUv-c-0.5-o);
    col+=vec3(1.0)*smoothstep(0.06,0.0,d)*(0.4+mwC*0.9);}}
  col*=mix(vec3(0.5,0.7,1.3),vec3(1.3,1.0,0.7),warm);
  return clamp(col,vec3(0.0),vec3(1.0));
}
// Lat/long grid: thin 5-degree and thick 15-degree lines over a checker.
vec3 sampleGridBg(vec3 dir,float warm){
  vec2 uv=bgUV(dir);float lon=uv.x*360.0,lat=(1.0-uv.y)*180.0-90.0;
  float lm5=mod(lon,5.0),am5=mod(lat+90.0,5.0),lm15=mod(lon,15.0),am15=mod(lat+90.0,15.0);
  float thin=max(1.0-smoothstep(0.0,0.35,min(lm5,5.0-lm5)),1.0-smoothstep(0.0,0.35,min(am5,5.0-am5)))*0.2;
  float thick=max(1.0-smoothstep(0.0,0.7,min(lm15,15.0-lm15)),1.0-smoothstep(0.0,0.7,min(am15,15.0-am15)))*0.45;
  float ck=mod(floor(lon/15.0)+floor((lat+90.0)/15.0),2.0);
  vec3 bg=mix(mix(vec3(0.01,0.015,0.04),vec3(0.04,0.02,0.01),warm),mix(vec3(0.02,0.03,0.05),vec3(0.05,0.035,0.02),warm),ck);
  vec3 lc=mix(vec3(0.2,0.4,0.65),vec3(0.65,0.4,0.15),warm);
  vec3 col=bg;col=mix(col,lc*0.5,thin);col=mix(col,lc,thick);return col;
}
// UV test map: coloured cells with a fine grid, for reading the lensing.
vec3 sampleUVMap(vec3 dir,float warm){
  vec2 uv=bgUV(dir);float cu=floor(uv.x*6.0),cv=floor(uv.y*3.0),hue=mod(cu+cv*2.0,6.0);
  vec3 cc;
  if(warm>0.5){if(hue<1.0)cc=vec3(.9,.3,.1);else if(hue<2.0)cc=vec3(.9,.65,.1);else if(hue<3.0)cc=vec3(.95,.9,.2);else if(hue<4.0)cc=vec3(.7,.35,.1);else if(hue<5.0)cc=vec3(.85,.2,.15);else cc=vec3(.95,.75,.3);}
  else{if(hue<1.0)cc=vec3(.1,.3,.9);else if(hue<2.0)cc=vec3(.1,.7,.85);else if(hue<3.0)cc=vec3(.15,.9,.6);else if(hue<4.0)cc=vec3(.2,.4,.95);else if(hue<5.0)cc=vec3(.1,.85,.9);else cc=vec3(.3,.6,.95);}
  float fck=mod(floor(uv.x*36.0)+floor(uv.y*18.0),2.0);vec3 col=cc*(0.5+0.5*fck);
  float gu6=fract(uv.x*6.0),gv3=fract(uv.y*3.0);
  float tl=max(1.0-smoothstep(0.0,0.015,min(gu6,1.0-gu6)),1.0-smoothstep(0.0,0.015,min(gv3,1.0-gv3)));
  col=mix(col,vec3(1.0),tl*0.7);return clamp(col,vec3(0),vec3(1));
}
// Nebula: six-octave value-noise clouds with scattered stars.
vec3 sampleNebula(vec3 dir,float warm){
  vec2 uv=bgUV(dir);float n=0.0,amp=1.0,freq=3.0;vec2 p=uv*vec2(6.0,3.0);
  for(int i=0;i<6;i++){vec2 f=fract(p*freq);vec2 fl=floor(p*freq);
  float a=hash21(fl),b=hash21(fl+vec2(1,0)),c=hash21(fl+vec2(0,1)),d=hash21(fl+vec2(1,1));
  vec2 u=f*f*(3.0-2.0*f);n+=mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*amp;amp*=0.5;freq*=2.1;}
  n/=1.98;float r1=smoothstep(0.25,0.65,n),r2=smoothstep(0.4,0.8,n);
  vec3 c1=mix(vec3(0.05,0.15,0.4),vec3(0.4,0.12,0.05),warm),c2=mix(vec3(0.15,0.4,0.5),vec3(0.7,0.3,0.05),warm);
  float band=sin(uv.y*8.0+uv.x*3.0+n*4.0)*0.5+0.5;
  vec3 col=vec3(0.02,0.01,0.06);col=mix(col,c1,r1*band);col=mix(col,c2,r1*(1.0-band)*0.7);
  col=mix(col,mix(vec3(.2,.6,.7),vec3(.9,.5,.1),warm),r2*0.4);
  vec2 sUv=uv*vec2(800.0,400.0);vec2 sC=floor(sUv);float sd=hash21(sC+vec2(77.0,133.0));
  if(sd>0.97){float dd=length(fract(sUv)-0.5-(hash22(sC)-0.5)*0.6);
  col+=vec3(1.0,0.9,0.8)*smoothstep(0.08,0.0,dd)*3.0;}
  return clamp(col,vec3(0),vec3(1));
}
// Concentric rings about the pole, a strong cue for gravitational distortion.
vec3 sampleRings(vec3 dir,float warm){
  float theta=acos(clamp(-dir.z,-1.0,1.0)),ring=theta*28.0,band=floor(ring),hue=mod(band,7.0);
  vec3 rc;
  if(warm>0.5){if(hue<1.0)rc=vec3(1,.2,.15);else if(hue<2.0)rc=vec3(1,.6,.05);else if(hue<3.0)rc=vec3(1,.95,.15);else if(hue<4.0)rc=vec3(.9,.6,.1);else if(hue<5.0)rc=vec3(.8,.3,.1);else if(hue<6.0)rc=vec3(1,.45,.15);else rc=vec3(.95,.8,.2);}
  else{if(hue<1.0)rc=vec3(.15,.5,1);else if(hue<2.0)rc=vec3(.1,.8,.9);else if(hue<3.0)rc=vec3(.2,.9,.5);else if(hue<4.0)rc=vec3(.15,.4,.95);else if(hue<5.0)rc=vec3(.3,.7,1);else if(hue<6.0)rc=vec3(.1,.9,.7);else rc=vec3(.4,.6,1);}
  float edg=1.0-smoothstep(0.0,0.08,min(fract(ring),1.0-fract(ring)));
  return clamp(rc*(0.6+0.4*mod(band,2.0))-vec3(edg*0.4),vec3(0),vec3(1));
}

// Dispatch to the selected sky. sampleSkyA/B fix the tint and flip Universe B's
// direction, so the two universes read as distinct places, not a mirror.
vec3 sampleSky(vec3 dir,float warm){
  if(u_bgMode<0.5)return sampleStars(dir,warm);if(u_bgMode<1.5)return sampleGridBg(dir,warm);
  if(u_bgMode<2.5)return sampleUVMap(dir,warm);if(u_bgMode<3.5)return sampleNebula(dir,warm);
  return sampleRings(dir,warm);
}
vec3 sampleSkyA(vec3 dir){return sampleSky(dir,1.0);}
vec3 sampleSkyB(vec3 dir){return sampleSky(vec3(-dir.x,dir.y,-dir.z),0.0);}

// The optional accretion disc in the y=0 plane: colour ramps inner-to-outer,
// warm or cool depending on which universe the camera occupies.
vec3 sampleDisc(vec3 p){
  float rd=length(p.xz),t=clamp((rd-u_discInner)/(u_discOuter-u_discInner),0.0,1.0);
  float fromA=step(0.0,u_camL);
  vec3 innerA=vec3(0.35,0.6,1.0),outerA=vec3(0.1,0.2,0.5);
  vec3 innerB=vec3(1.0,0.7,0.3),outerB=vec3(0.5,0.25,0.08);
  vec3 inner=mix(innerB,innerA,fromA),outer=mix(outerB,outerA,fromA);
  return clamp(mix(inner,outer,t)*1.3,vec3(0),vec3(1));
}
// Disc crossing test for one geodesic segment: where the segment pierces the
// y=0 plane inside the disc annulus, return the hit and its colour.
struct Isect{bool hit;float dist;vec3 color;};
Isect noHit(){return Isect(false,1e30,vec3(0));}
Isect segDisc(vec3 s0,vec3 s1){
  if(u_showDisc<0.5)return noHit();vec3 seg=s1-s0;if(abs(seg.y)<1e-9)return noHit();
  float t=-s0.y/seg.y;if(t<0.0||t>1.0)return noHit();vec3 p=s0+seg*t;float r=length(p.xz);
  if(r<u_discInner||r>u_discOuter)return noHit();return Isect(true,length(seg)*t,sampleDisc(p));
}

// A photon's path lies in a single plane through the origin. Reducing the 3D
// ray to this plane (a radial axis and a tangent axis) turns the geodesic into
// a cheap 2D integration in (l, theta). buildOrbPlane finds that basis.
struct OrbPlane{vec3 radial;vec3 tangent;};
OrbPlane buildOrbPlane(vec3 lo,vec3 dir){
  vec3 rad=normalize(lo),nC=cross(lo,dir);
  vec3 fb;if(abs(rad.y)>0.9)fb=vec3(1,0,0);else fb=vec3(0,1,0);
  vec3 n;if(length(nC)<1e-6)n=normalize(cross(rad,fb));else n=normalize(nC);
  return OrbPlane(rad,normalize(cross(n,rad)));
}

// The geodesic state: position (l, theta) in the orbit plane and its rate
// (dl, dtheta) along the ray parameter.
struct WRay{float l;float theta;float dl;float dtheta;};

// Seed the state from the camera: split the view direction into radial and
// tangential parts and normalise so the ray is null (light-like).
WRay initWRay(vec3 lo,vec3 dir,OrbPlane op){
  float l=u_camL;
  float vr=dot(dir,op.radial);float vt=dot(dir,op.tangent);
  if(l<0.0)vr=-vr;
  float r=whR(l),dth=vt/max(r,1e-6);
  float nm=sqrt(vr*vr+r*r*dth*dth);if(nm<1e-9)nm=1.0;
  return WRay(l,0.0,vr/nm,dth/nm);
}

// Geodesic equation of motion in (l, theta): the right-hand side gives the
// derivatives of the state. The dtheta term l''= r r' theta'^2 is the pull of
// curvature; dtheta'' conserves angular momentum as r changes.
vec4 wRHS(WRay w){float r=whR(w.l),rp=whRp(w.l);return vec4(w.dl,w.dtheta,r*rp*w.dtheta*w.dtheta,-2.0*rp/max(r,1e-9)*w.dl*w.dtheta);}
// Advance a scratch copy of the state by a fraction of a derivative (for RK4).
WRay wApply(WRay w,vec4 k,float f){return WRay(w.l+k.x*f,w.theta+k.y*f,w.dl+k.z*f,w.dtheta+k.w*f);}
// One explicit Euler step: cheap, adequate away from the throat.
WRay stepEuler(WRay w,float dl){vec4 k=wRHS(w);return WRay(w.l+dl*k.x,w.theta+dl*k.y,w.dl+dl*k.z,w.dtheta+dl*k.w);}
// One fourth-order Runge-Kutta step: costlier but stable through the sharp
// curvature at the throat.
WRay stepRK4(WRay w,float dl){vec4 k1=wRHS(w),k2=wRHS(wApply(w,k1,dl*0.5)),k3=wRHS(wApply(w,k2,dl*0.5)),k4=wRHS(wApply(w,k3,dl));
  vec4 t=(k1+2.0*k2+2.0*k3+k4)/6.0;return WRay(w.l+dl*t.x,w.theta+dl*t.y,w.dl+dl*t.z,w.dtheta+dl*t.w);}

// Recover a 3D world position from the 2D orbit-plane state, for the disc test.
vec3 wPoint(WRay w,OrbPlane op){float cp=cos(w.theta),sp=sin(w.theta);return op.radial*(w.l*cp)+op.tangent*(w.l*sp);}
// Recover the 3D travel direction at escape, used to look up the sky.
vec3 wDir(WRay w,OrbPlane op){
  float sl=w.l>=0.0?1.0:-1.0;
  float cp=cos(w.theta),sp=sin(w.theta);
  return normalize(op.radial*(sl*w.dl*cp-abs(w.l)*w.dtheta*sp)+op.tangent*(sl*w.dl*sp+abs(w.l)*w.dtheta*cp));
}

// Trace result: whether a disc was hit, the colour, and the closest approach to
// the throat (minL) which drives the glow in main().
struct TR{bool hitDisc;vec3 color;float minL;};
// The flat-space fallback (u_useGeodesic off): a straight ray, one disc-plane
// test, then the current universe's sky. Shows the scene with no lensing.
TR traceStraight(vec3 ro,vec3 rd){
  if(u_showDisc>0.5&&abs(rd.y)>1e-9){float t=-ro.y/rd.y;if(t>0.0){vec3 p=ro+rd*t;float r=length(p.xz);
    if(r>=u_discInner&&r<=u_discOuter)return TR(true,sampleDisc(p),length(ro));}}
  return TR(false,u_camL>=0.0?sampleSkyA(rd):sampleSkyB(rd),length(ro));
}

// The curved trace: integrate the geodesic step by step until the ray escapes
// far into one universe or hits the disc. Conserved angular momentum decides up
// front whether the ray can thread the throat; if not, its step budget is cut
// and it is allowed to turn back early, saving work on rays that cannot cross.
TR traceGeodesic(vec3 ro,vec3 rd){
  OrbPlane op=buildOrbPlane(ro,rd);WRay w=initWRay(ro,rd,op);
  float dl=u_dl;int maxS=int(u_maxSteps);float escR=u_escapeR;bool rk4=u_useRK4>0.5;
  vec3 prev=ro;float minL=abs(w.l);
  // Angular momentum sets whether the ray clears the throat (radius k).
  float rInit=whR(w.l);
  float angMom=rInit*rInit*abs(w.dtheta);
  bool canPassThrough=angMom<u_throatK*1.1;
  int effMax=canPassThrough?maxS:maxS/3;
  // Fixed loop bound (GLSL requires it); effMax is the real budget.
  for(int i=0;i<8192;i++){
    if(i>=effMax)break;
    // Take larger steps far from the throat, small steps where it curves hard.
    float adaptDl=dl*clamp(u_throatK*2.0/max(abs(w.l),0.01),1.0,2.5);
    if(rk4)w=stepRK4(w,adaptDl);else w=stepEuler(w,adaptDl);
    minL=min(minL,abs(w.l));
    // Check the just-traversed segment against the accretion disc.
    vec3 cur=wPoint(w,op);Isect h=segDisc(prev,cur);
    if(h.hit)return TR(true,h.color,minL);
    // Escape test: once far out (and past the throat region), read the sky of
    // whichever universe the sign of l places the ray in.
    bool movingOut=(w.l>0.0&&w.dl>0.0)||(w.l<0.0&&w.dl<0.0);
    if(abs(w.l)>=escR&&(i>4||(movingOut&&!canPassThrough))){
      vec3 dir=wDir(w,op);
      return TR(false,w.l>0.0?sampleSkyA(dir):sampleSkyB(dir),minL);}
    // A ray that cannot cross and is already heading back exits early.
    if(!canPassThrough&&movingOut&&abs(w.l)>escR*0.3&&i>2){
      vec3 dir=wDir(w,op);
      return TR(false,w.l>0.0?sampleSkyA(dir):sampleSkyB(dir),minL);}
    prev=cur;
  }
  vec3 dir=wDir(w,op);return TR(false,w.l>0.0?sampleSkyA(dir):sampleSkyB(dir),minL);
}

void main(){
  // Build the primary ray from the pinhole camera basis and focal length.
  vec2 uv=gl_FragCoord.xy/u_res;
  float x=uv.x*u_res.x-u_res.x*0.5,y=(1.0-uv.y)*u_res.y-u_res.y*0.5;
  vec3 rd=normalize(u_camRight*x+u_camUp*(-y)+u_camFwd*u_focalLen);
  TR r;
  if(u_useGeodesic>0.5)r=traceGeodesic(u_camPos,rd);else r=traceStraight(u_camPos,rd);
  vec3 col=r.color;
  // Throat glow: rays that passed close to the neck pick up a soft halo and a
  // tighter ring, tinted for the far universe, keyed off closest approach.
  if(u_showGlow>0.5&&u_useGeodesic>0.5){
    float glow=exp(-r.minL*r.minL/(u_throatK*u_throatK*0.6))*0.5;
    float ring=exp(-r.minL*r.minL/(u_throatK*u_throatK*0.08))*0.3;
    float fromA=step(0.0,u_camL);
    vec3 gc=mix(vec3(0.7,0.45,0.15),vec3(0.2,0.5,0.75),fromA);
    vec3 rc=mix(vec3(1.0,0.8,0.4),vec3(0.6,0.85,1.0),fromA);
    col+=gc*glow+rc*ring;
  }
  // Gentle vignette, then output.
  vec2 vc=(gl_FragCoord.xy/u_res)*2.0-1.0;col*=1.0-dot(vc,vc)*0.12;
  fragColor=vec4(col,1.0);
}
