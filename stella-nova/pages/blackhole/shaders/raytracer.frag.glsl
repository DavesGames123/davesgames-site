#version 300 es
// raytracer.frag.glsl — Schwarzschild geodesic ray tracer, fragment stage
//
//   For each pixel: build a view ray, then bend it through the curved spacetime
//   around a black hole. Light near mass does not travel straight; this shader
//   integrates the null geodesic equation step by step, checking each short
//   segment against the event horizon and the accretion disc, and finally
//   samples a background sphere in the ray's escaped direction. The disc is
//   semi-transparent: each crossing adds blackbody light at the shifted
//   temperature g T (shadeDisc) and the ray goes on through it.
//
//   RAY PATH  (curved, integrated in the ray's own orbital plane)
//   ------------------------------------------------------------------
//     camera ●
//             ╲   each step advances (r, phi) by the geodesic equation
//              ╲        ┌──────── accretion disc (y = 0 plane) ────────┐
//               ╲ ● ● ● │ ● ● ●                                        │
//                ╲     ╲│                                              │
//                 ● ● ● ●══▓▓▓══   event horizon sphere r = rs         │
//                      ╱ │   (ray captured -> black)                   │
//                    ╱   └──────────────────────────────────────────────┘
//                  ╱  ray survives -> sampleBg() in final direction
//
//   COORDINATE FRAME  (per ray)
//   ------------------------------------------------------------------
//     buildOrbPlane() reduces the 3D bend to a 2D problem: a plane spanned
//     by radial (toward the hole) and tangent. The ray keeps r and phi in
//     that plane; wPoint()/wDir() lift them back to world space each step.
//
//   INTEGRATOR
//     u_useGeodesic  off -> straight rays (flat space, no bending)
//     u_useRK4       off -> forward Euler step at fixed dl; on (default) -> 4th
//                    order Runge-Kutta, step grows with r (STEP_NEAR_RS)
//
//   SECTION MAP   (jump with grep -n "<anchor>" raytracer.frag.glsl)
//   ------------------------------------------------------------------
//     uniforms ............ "uniform vec2 u_res"     camera, disc, integrator
//     hash / sky uv ....... "float hash21"           noise and direction->uv
//     backgrounds ......... "vec3 sampleStars"       5 background modes
//     background switch ... "vec3 sampleBg"          pick a mode by u_bgMode
//     disc emission ....... "vec3 shadeDisc"         T(r), shift g, turbulence
//     blackbody colour .... "vec3 planckRGB"         B_lambda(T) / B_lambda(6500 K)
//     tone map ............ "vec3 discToDisplay"     exposure, ACES fit, gamma
//     intersections ....... "struct Isect"           ray/seg vs sphere and disc
//     orbital plane ....... "struct OrbPlane"        per-ray 2D frame
//     geodesic state ...... "struct GRay"            r, phi and their rates
//     geodesic RHS ........ "vec4 gRHS"              equation of motion
//     integrators ......... "GRay stepEuler"         Euler and RK4 steps
//     straight trace ...... "vec3 traceStraight"     flat-space fallback
//     geodesic trace ...... "vec3 traceGeodesic"     the bent-ray march
//     entry point ......... "void main"              build ray, trace, shade
precision highp float;
// Camera basis and screen size (u_res); u_focalLen sets the field of view.
uniform vec2 u_res;
uniform vec3 u_camPos,u_camFwd,u_camRight,u_camUp;
uniform float u_focalLen,u_rs,u_discInner,u_discOuter;
uniform float u_geodesicDl,u_maxSteps,u_escapeR;
uniform float u_useGeodesic,u_useRK4,u_showDisc;
// Which background sphere to sample: 0 stars, 1 grid, 2 UV, 3 nebula, 4 rings.
uniform float u_bgMode;
// Disc emission: u_time is the clock in units of r_s/c (main.js scales it so
// that the inner edge turns once in about 16 s), u_discTemp the peak emitted
// temperature in K, u_doppler 1 = full shift g, 0 = gravitational shift only.
uniform float u_time,u_discTemp,u_doppler;
out vec4 fragColor;
const float PI=3.141592653589793;

// Cheap hash noise: one and two channel pseudo-random from a 2D cell.
float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
vec2 hash22(vec2 p){return vec2(hash21(p+vec2(17.0,59.4)),hash21(p+vec2(63.1,12.8)));}
// Map a unit direction to equirectangular sky coordinates (longitude, latitude).
vec2 bgUV(vec3 d){return vec2(atan(d.z,d.x)/(2.0*PI)+0.5,acos(clamp(d.y,-1.0,1.0))/PI);}

// Star field background: a faint base sky, a Milky Way band, and three grids of
// procedural stars at different densities. Each grid tests a 3x3 neighbourhood
// so stars near a cell edge still splat correctly; brightness rises inside the
// galactic band (mwC). Star tint is chosen from a hash for rare warm giants.
vec3 sampleStars(vec3 dir){
  vec2 skyUv=bgUV(dir);
  vec3 col=vec3(0.012,0.016,0.032);
  vec3 mwN=normalize(vec3(0.26,0.9,-0.34));
  float pd=abs(dot(dir,mwN));
  float mwB=exp(-pow(pd/0.17,2.0)),mwR=exp(-pow(pd/0.0238,2.0));
  float mwNs=0.55+0.45*hash21(skyUv*vec2(220.0,110.0));
  float mwS=mwB*mwNs*0.42,mwC=mwS*(0.45+1.25*mwB);
  vec3 mwCol=mix(vec3(0.502,0.439,0.329),vec3(1.0,0.985,0.94),0.88);
  float mwRS=mwR*(0.58+0.92*hash21(vec2(skyUv.x*460.0+13.0,skyUv.y*28.0+5.0)))*0.42;
  col+=mwCol*mwS+vec3(1.0)*mwRS;
  vec2 pUv=skyUv*vec2(720.0,360.0);vec2 pC=floor(pUv);
  float pD=clamp(0.046+mwC*0.085,0.0,0.56);
  for(int oy=-1;oy<=1;oy++)for(int ox=-1;ox<=1;ox++){
    vec2 c=pC+vec2(float(ox),float(oy));float s=hash21(c);
    if(s>1.0-pD){vec2 o=(hash22(c)-0.5)*0.7;float d=length(pUv-c-0.5-o);
    float g=smoothstep(0.14,0.0,d);float ti=hash21(c+vec2(19.7,73.1));
    vec3 sc=vec3(1.0);if(ti>0.9975)sc=vec3(1.0,0.58,0.42);else if(ti>0.985)sc=vec3(1.0,0.9,0.62);
    col+=sc*g*(0.8+1.35*hash21(c+vec2(101.3,7.7))+mwC*3.2);}}
  vec2 sUv=skyUv*vec2(1200.0,600.0);vec2 sC=floor(sUv);
  float sD=clamp(0.022+mwC*0.05,0.0,0.44);
  for(int oy=-1;oy<=1;oy++)for(int ox=-1;ox<=1;ox++){
    vec2 c=sC+vec2(float(ox),float(oy));float s=hash21(c+vec2(211.0,503.0));
    if(s>1.0-sD){vec2 o=(hash22(c+vec2(5.2,91.7))-0.5)*0.5;float d=length(sUv-c-0.5-o);
    col+=vec3(1.0)*smoothstep(0.06,0.0,d)*(0.4+mwC*0.9);}}
  vec2 bUv=skyUv*vec2(520.0,260.0);vec2 bC=floor(bUv);
  float bD=clamp(mwC*0.32,0.0,0.24);
  for(int oy=-1;oy<=1;oy++)for(int ox=-1;ox<=1;ox++){
    vec2 c=bC+vec2(float(ox),float(oy));float s=hash21(c+vec2(401.0,887.0));
    if(s>1.0-bD){vec2 o=(hash22(c+vec2(13.0,37.0))-0.5)*0.65;float d=length(bUv-c-0.5-o);
    float g=smoothstep(0.18,0.0,d);float ti=hash21(c+vec2(97.0,31.0));
    vec3 sc=vec3(1.0);if(ti>0.9985)sc=vec3(1.0,0.6,0.45);else if(ti>0.992)sc=vec3(1.0,0.9,0.68);
    col+=sc*g*(1.25+mwC*5.5);}}
  return clamp(col,vec3(0.0),vec3(1.0));
}

// Coordinate grid background: draws a latitude/longitude graticule so the
// gravitational bending of straight lines is easy to read. Thin lines every 5
// degrees, thick every 15, and highlighted equator and prime meridian.
vec3 sampleGridBg(vec3 dir){
  vec2 uv=bgUV(dir);
  float lon=uv.x*360.0,lat=(1.0-uv.y)*180.0-90.0;
  float lw=0.35,tw=0.7;
  float lm5=mod(lon,5.0),am5=mod(lat+90.0,5.0);
  float lm15=mod(lon,15.0),am15=mod(lat+90.0,15.0);
  float lonL=1.0-smoothstep(0.0,lw,min(lm5,5.0-lm5));
  float latL=1.0-smoothstep(0.0,lw,min(am5,5.0-am5));
  float lonT=1.0-smoothstep(0.0,tw,min(lm15,15.0-lm15));
  float latT=1.0-smoothstep(0.0,tw,min(am15,15.0-am15));
  float eqL=1.0-smoothstep(0.0,1.2,abs(lat));
  float pmL=1.0-smoothstep(0.0,1.2,min(lon,360.0-lon));
  float thin=max(lonL,latL)*0.2,thick=max(lonT,latT)*0.45,special=max(eqL,pmL)*0.75;
  float ck=mod(floor(lon/15.0)+floor((lat+90.0)/15.0),2.0);
  vec3 bg=mix(vec3(0.015,0.02,0.035),vec3(0.025,0.03,0.048),ck);
  vec3 col=bg;
  col=mix(col,vec3(0.08,0.14,0.22),thin);
  col=mix(col,vec3(0.16,0.28,0.44),thick);
  col=mix(col,vec3(0.35,0.5,0.65),special);
  return col;
}

// UV test-pattern background: a 6x3 grid of primary-colored cells with a fine
// checker and white poles. A calibration target that makes the lensing warp of
// known cells and lines obvious.
vec3 sampleUVMap(vec3 dir){
  vec2 uv=bgUV(dir);
  float cu=floor(uv.x*6.0),cv=floor(uv.y*3.0);
  float hue=mod(cu+cv*2.0,6.0);
  vec3 cellCol;
  if(hue<1.0)      cellCol=vec3(0.9,0.15,0.1);
  else if(hue<2.0) cellCol=vec3(0.1,0.8,0.2);
  else if(hue<3.0) cellCol=vec3(0.15,0.3,0.95);
  else if(hue<4.0) cellCol=vec3(0.95,0.85,0.1);
  else if(hue<5.0) cellCol=vec3(0.85,0.15,0.85);
  else             cellCol=vec3(0.1,0.85,0.9);
  float fineCheck=mod(floor(uv.x*36.0)+floor(uv.y*18.0),2.0);
  vec3 col=cellCol*(0.5+0.5*fineCheck);
  col=mix(col, vec3(uv.x,uv.y,1.0-uv.x), 0.15);
  float gu6=fract(uv.x*6.0),gv3=fract(uv.y*3.0);
  float thickLine=max(1.0-smoothstep(0.0,0.015,min(gu6,1.0-gu6)),1.0-smoothstep(0.0,0.015,min(gv3,1.0-gv3)));
  float gu36=fract(uv.x*36.0),gv18=fract(uv.y*18.0);
  float thinLine=max(1.0-smoothstep(0.0,0.02,min(gu36,1.0-gu36)),1.0-smoothstep(0.0,0.02,min(gv18,1.0-gv18)));
  col=mix(col,vec3(0.0),thinLine*0.3);
  col=mix(col,vec3(1.0),thickLine*0.7);
  col+=vec3(1.0,1.0,1.0)*smoothstep(0.06,0.0,acos(clamp(dir.y,-1.0,1.0)))*3.0;
  col+=vec3(1.0,1.0,1.0)*smoothstep(0.06,0.0,acos(clamp(-dir.y,-1.0,1.0)))*3.0;
  col+=vec3(1.0)*smoothstep(0.015,0.0,abs(dir.y))*0.6;
  return clamp(col,vec3(0.0),vec3(1.0));
}

// Nebula background: six octaves of value-noise fBm build a cloud field, three
// smoothstep thresholds pick color bands (purple, teal, pink, gold), and a
// sparse star layer plus dust lanes sit on top.
vec3 sampleNebula(vec3 dir){
  vec2 uv=bgUV(dir);
  float n=0.0,amp=1.0,freq=3.0;
  vec2 p=uv*vec2(6.0,3.0);
  for(int i=0;i<6;i++){
    float h=hash21(floor(p*freq));
    vec2 f=fract(p*freq);
    float a=h,b=hash21(floor(p*freq)+vec2(1,0)),c=hash21(floor(p*freq)+vec2(0,1)),d=hash21(floor(p*freq)+vec2(1,1));
    vec2 u=f*f*(3.0-2.0*f);
    float v=mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
    n+=v*amp;
    amp*=0.5;freq*=2.1;
  }
  n=n/1.98;
  float r1=smoothstep(0.25,0.65,n);
  float r2=smoothstep(0.4,0.8,n);
  float r3=smoothstep(0.55,0.9,n);
  vec3 deep=vec3(0.02,0.01,0.06);
  vec3 purple=vec3(0.25,0.05,0.35);
  vec3 pink=vec3(0.7,0.15,0.3);
  vec3 teal=vec3(0.05,0.35,0.45);
  vec3 gold=vec3(0.9,0.7,0.2);
  float band1=sin(uv.y*8.0+uv.x*3.0+n*4.0)*0.5+0.5;
  float band2=cos(uv.x*5.0-uv.y*7.0+n*3.0)*0.5+0.5;
  vec3 col=deep;
  col=mix(col,purple,r1*band1);
  col=mix(col,teal,r1*(1.0-band1)*0.7);
  col=mix(col,pink,r2*band2*0.8);
  col=mix(col,gold,r3*0.3);
  vec2 sUv=uv*vec2(800.0,400.0);
  vec2 sC=floor(sUv);
  float sd=hash21(sC+vec2(77.0,133.0));
  if(sd>0.97){
    vec2 so=(hash22(sC)-0.5)*0.6;
    float d=length(fract(sUv)-0.5-so);
    float glow=smoothstep(0.08,0.0,d);
    float bright=2.0+hash21(sC+vec2(41.0,99.0))*3.0;
    col+=vec3(1.0,0.9,0.8)*glow*bright;
  }
  float dust=smoothstep(0.35,0.5,sin(uv.x*12.0+n*6.0)*0.5+0.5);
  col*=mix(1.0,0.3,dust*smoothstep(0.3,0.6,n));
  return clamp(col,vec3(0.0),vec3(1.0));
}

// Concentric-rings background: rings of the spectrum centred on the -z axis
// with radial spokes, useful for reading the Einstein ring and photon-ring
// structure the lensing produces.
vec3 sampleRings(vec3 dir){
  float theta=acos(clamp(-dir.z,-1.0,1.0));
  float phi=atan(dir.y,dir.x);
  float ringFreq=28.0;
  float ring=theta*ringFreq;
  float band=floor(ring);
  float frac=fract(ring);
  float hue=mod(band,7.0);
  vec3 ringCol;
  if(hue<1.0)      ringCol=vec3(1.0,0.2,0.15);
  else if(hue<2.0) ringCol=vec3(1.0,0.6,0.05);
  else if(hue<3.0) ringCol=vec3(1.0,0.95,0.15);
  else if(hue<4.0) ringCol=vec3(0.15,0.9,0.3);
  else if(hue<5.0) ringCol=vec3(0.15,0.5,1.0);
  else if(hue<6.0) ringCol=vec3(0.5,0.15,0.9);
  else             ringCol=vec3(0.9,0.15,0.6);
  float alt=mod(band,2.0);
  vec3 col=ringCol*(0.6+0.4*alt);
  float spoke=mod(phi*180.0/PI,15.0);
  float spokeLine=1.0-smoothstep(0.0,0.5,min(spoke,15.0-spoke));
  col=mix(col,vec3(0.0),spokeLine*0.25);
  float edgeLine=1.0-smoothstep(0.0,0.08,min(frac,1.0-frac));
  col=mix(col,vec3(0.0),edgeLine*0.4);
  float centerDist=theta/PI;
  col+=vec3(1.0)*smoothstep(0.03,0.0,centerDist)*2.0;
  col+=vec3(0.5,0.5,1.0)*smoothstep(0.03,0.0,abs(centerDist-1.0))*1.5;
  return clamp(col,vec3(0.0),vec3(1.0));
}

// Dispatch to one of the five backgrounds by u_bgMode (a float, compared with
// half-step thresholds because it arrives as a uniform, not an int).
vec3 sampleBg(vec3 dir){
  if(u_bgMode<0.5)return sampleStars(dir);
  if(u_bgMode<1.5)return sampleGridBg(dir);
  if(u_bgMode<2.5)return sampleUVMap(dir);
  if(u_bgMode<3.5)return sampleNebula(dir);
  return sampleRings(dir);
}

// ─── Accretion disc emission ───
// A thin disc in the y = 0 plane between u_discInner (the ISCO, 3 r_s) and
// u_discOuter. Gas moves on circular Keplerian orbits about +y. All radii
// here are x = r / r_s.
//
//   temperature  T(x) = T0 x^(-3/4) (1 - sqrt(x_in / x))^(1/4) / peak
//                (Shakura-Sunyaev / Page-Thorne shape, zero torque at the
//                ISCO; the peak is at x = 49/36 x_in and has T = T0)
//   angular vel. Omega = sqrt(1 / (2 x^3))           (units c / r_s)
//   shift        g = nu_obs / nu_em
//                  = sqrt(1 - 3/(2x)) / (1 - Omega lambda) / sqrt(1 - 1/x_cam)
//                lambda = L_z / E of the photon (constant along the ray, so
//                main() computes it once at the camera)
//   colour       a blackbody shifts to a blackbody: I_nu / nu^3 is invariant,
//                so the observed spectrum is B_nu(g T). The bolometric
//                intensity goes as g^4. planckRGB() samples B_lambda(g T)
//                at three wavelengths.
float discX(vec3 p){return length(p.xz)/u_rs;}
// Planck B_lambda at 610, 550 and 465 nm, divided by B_lambda at 6500 K, so a
// 6500 K body is (1,1,1). The lambda^-5 factor cancels in the ratio.
vec3 planckRGB(float T){
  const vec3 L=vec3(0.610,0.550,0.465);      // wavelengths in micrometres
  const float C2=14388.0;                    // h c / k in micrometre K
  vec3 ref=exp(C2/(L*6500.0))-1.0;
  return ref/(exp(min(C2/(L*max(T,300.0)),vec3(80.0)))-1.0);
}
// Value noise with period N cells in y, so the azimuth wraps with no seam.
float vnoiseP(vec2 p,float N){
  vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);
  float y0=mod(i.y,N),y1=mod(i.y+1.0,N);
  return mix(mix(hash21(vec2(i.x,y0)),hash21(vec2(i.x+1.0,y0)),u.x),
             mix(hash21(vec2(i.x,y1)),hash21(vec2(i.x+1.0,y1)),u.x),u.y);
}
// Gas density texture: two octaves stretched along the orbit (thin arcs).
// u = radius, v = turns x N, so one cell is 0.4 r_s across and 1/24 turn long.
float discFbm(float x,float ph,float seed){
  float v=ph*(1.0/(2.0*PI));
  vec2 q=vec2(x*2.5+seed,v*24.0);
  return 0.62*vnoiseP(q,24.0)+0.38*vnoiseP(q*vec2(2.3,2.0)+vec2(seed*1.7,5.0),48.0);
}
// Keplerian shear winds a texture up without limit, so two copies run with a
// phase offset of half a period (DISC_FLOW_P) and swap in turn; each copy
// resets at the moment its weight is zero.
const float DISC_FLOW_P=17.0;
// Shade one crossing of the disc plane at point p for a photon with
// lambda = L_z / E (units r_s). Returns linear HDR radiance times alpha, and
// writes the opacity to alpha.
vec3 shadeDisc(vec3 p,float lam,out float alpha){
  float x=discX(p),xin=u_discInner/u_rs,xout=u_discOuter/u_rs;
  float ph=atan(p.z,p.x);
  // Temperature profile, normalized to 1 at its peak (x = 49/36 xin).
  float xp=xin*49.0/36.0;
  float tPeak=pow(xp,-0.75)*pow(1.0/7.0,0.25);
  float tProf=pow(x,-0.75)*pow(max(1.0-sqrt(xin/x),0.0),0.25)/tPeak;
  // Redshift factor g. The camera is a static observer at x_cam.
  float om=inversesqrt(2.0*x*x*x);
  float camF=inversesqrt(max(1.0-u_rs/length(u_camPos),1e-3));
  float g=u_doppler>0.5?sqrt(max(1.0-1.5/x,0.0))/max(1.0-om*lam,0.05)
                       :sqrt(max(1.0-1.0/x,0.0));
  g*=camF;
  // Turbulence: the gas at angle ph now came from ph + om t, so the texture
  // turns with the local orbital speed (inner gas is faster).
  float f1=fract(u_time/DISC_FLOW_P),f2=fract(u_time/DISC_FLOW_P+0.5);
  float n1=discFbm(x,ph+om*f1*DISC_FLOW_P,0.0);
  float n2=discFbm(x,ph+om*f2*DISC_FLOW_P,31.7);
  float w1=1.0-abs(2.0*f1-1.0);
  float dens=mix(n2,n1,w1);
  dens=smoothstep(0.15,0.85,dens);
  // Soft edges: opacity rises over 0.5 r_s at the ISCO and fades over the
  // outer 35 percent, where the thin gas lets the far side show through.
  float edge=smoothstep(xin,xin+0.5,x)*(1.0-smoothstep(xout*0.65,xout,x));
  alpha=clamp(edge*(0.55+0.45*dens),0.0,0.95);
  vec3 B=planckRGB(g*u_discTemp*tProf);
  return B*(0.45+0.9*dens)*alpha;
}
// Filmic curve (Narkowicz ACES fit) and display gamma for the disc radiance.
// The exposure puts the green channel of a T0 blackbody at DISC_EXPOSURE, so
// the u_discTemp setting changes the colour but not the overall level.
// The sky samplers already return display values and are not mapped.
const float DISC_EXPOSURE=1.2;
vec3 discToDisplay(vec3 c){
  c*=DISC_EXPOSURE/planckRGB(u_discTemp).g;
  c=clamp((c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14),0.0,1.0);
  return pow(c,vec3(1.0/2.2));
}

// Intersection result: hit flag, distance along the ray, and a vec3 payload:
// the hit point for a disc hit (shadeDisc() shades it), black for the horizon.
struct Isect{bool hit;float dist;vec3 color;};
Isect noHit(){return Isect(false,1e30,vec3(0.0));}
// Keep whichever of two hits is nearer (used to merge horizon and disc tests).
Isect closest(Isect a,Isect b){if(!b.hit)return a;if(!a.hit||b.dist<a.dist)return b;return a;}

// Ray vs sphere for a whole ray: solves the quadratic, returns the nearest hit
// in front of the origin. Used for the event horizon in straight-ray mode.
Isect raySphere(vec3 ro,vec3 rd,vec3 c,float r,vec3 col){
  vec3 oc=ro-c;float b=2.0*dot(oc,rd),cc=dot(oc,oc)-r*r,disc=b*b-4.0*cc;
  if(disc<0.0)return noHit();float sq=sqrt(disc);
  float t1=(-b-sq)*0.5,t2=(-b+sq)*0.5;
  float t=t1>=0.0?t1:(t2>=0.0?t2:1e30);
  if(t>=1e30)return noHit();return Isect(true,t,col);}

// Ray vs disc for a whole ray: intersects the y=0 plane, then keeps the hit only
// inside the annulus between inner and outer radius. The payload is the hit point.
Isect rayDisc(vec3 ro,vec3 rd){
  if(u_showDisc<0.5||abs(rd.y)<1e-9)return noHit();
  float t=-ro.y/rd.y;if(t<=0.0)return noHit();vec3 p=ro+rd*t;
  float r=length(p.xz);
  if(r<u_discInner||r>u_discOuter)return noHit();
  return Isect(true,t,p);}

// Segment vs sphere: same test but bounded to a finite segment [s0, s1]. The
// geodesic march is piecewise-linear, so each bent step is one such segment.
Isect segSphere(vec3 s0,vec3 s1,vec3 c,float r,vec3 col){
  vec3 seg=s1-s0;float sl=length(seg);if(sl<1e-9)return noHit();
  vec3 d=seg/sl;vec3 oc=s0-c;float b=2.0*dot(oc,d),cc=dot(oc,oc)-r*r,disc=b*b-4.0*cc;
  if(disc<0.0)return noHit();float sq=sqrt(disc);
  float t1=(-b-sq)*0.5,t2=(-b+sq)*0.5,t=1e30;
  if(t1>=0.0&&t1<=sl)t=t1;else if(t2>=0.0&&t2<=sl)t=t2;
  if(t>=1e30)return noHit();return Isect(true,t,col);}

// Segment vs disc: crosses the y=0 plane within one bent step, inside the annulus.
// The payload is the hit point.
Isect segDisc(vec3 s0,vec3 s1){
  if(u_showDisc<0.5)return noHit();vec3 seg=s1-s0;
  if(abs(seg.y)<1e-9)return noHit();float t=-s0.y/seg.y;
  if(t<0.0||t>1.0)return noHit();vec3 p=s0+seg*t;
  float r=length(p.xz);
  if(r<u_discInner||r>u_discOuter)return noHit();
  return Isect(true,length(seg)*t,p);}

// Per-ray orbital plane: a null geodesic in Schwarzschild space stays in one
// plane through the center. radial points from the hole to the ray origin;
// tangent completes the plane in the ray's initial direction. This collapses
// the 3D bend to a 2D (r, phi) problem. Fallbacks handle a purely radial ray.
struct OrbPlane{vec3 radial;vec3 tangent;};
OrbPlane buildOrbPlane(vec3 lo,vec3 dir){
  vec3 rad=normalize(lo),nC=cross(lo,dir);
  vec3 fb;if(abs(rad.y)>0.9)fb=vec3(1,0,0);else fb=vec3(0,1,0);
  vec3 n;if(length(nC)<1e-6)n=normalize(cross(rad,fb));else n=normalize(nC);
  return OrbPlane(rad,normalize(cross(n,rad)));}

// Geodesic state in the orbital plane: radius r, angle phi, their rates of change
// with the affine parameter (dr, dphi), and the conserved energy E. E is fixed at
// init from the null condition and reused to keep the integration on the light cone.
struct GRay{float r;float phi;float dr;float dphi;float E;};
// Seed the state from the world-space origin and direction, projected onto the
// plane. capR clamps r away from the singularity so f=1-rs/r stays finite.
GRay initGRay(vec3 lo,vec3 dir,OrbPlane op,float rs,float capR){
  float r=length(lo),dr=dot(dir,op.radial),dphi=dot(dir,op.tangent)/max(r,1e-9);
  float rE=max(r,capR),f=1.0-rs/rE;
  return GRay(r,0.0,dr,dphi,f*sqrt(dr*dr/(f*f)+rE*rE*dphi*dphi/f));}

// Right-hand side of the geodesic equation: returns (dr, dphi, d2r, d2phi). The
// r acceleration mixes the metric potential f=1-rs/r; the phi acceleration is
// the -2 dr dphi / r Coriolis-like term. This is the physics of the bend.
vec4 gRHS(GRay g,float rs,float capR){
  float r=max(g.r,capR),f=1.0-rs/r,dtDl=g.E/f;
  return vec4(g.dr,g.dphi,-(rs/(2.0*r*r))*f*dtDl*dtDl+(rs/(2.0*r*r*f))*g.dr*g.dr+(r-rs)*g.dphi*g.dphi,-2.0*g.dr*g.dphi/r);}

// Add a scaled derivative to the state (RK4 helper).
GRay gApply(GRay g,vec4 k,float f){return GRay(g.r+k.x*f,g.phi+k.y*f,g.dr+k.z*f,g.dphi+k.w*f,g.E);}
// Forward Euler step: cheapest integrator, one RHS evaluation per step.
GRay stepEuler(GRay g,float dl,float rs,float capR){vec4 k=gRHS(g,rs,capR);return GRay(g.r+dl*k.x,g.phi+dl*k.y,g.dr+dl*k.z,g.dphi+dl*k.w,g.E);}
// Classic 4th-order Runge-Kutta step: four RHS samples for far less path error,
// which matters near the photon sphere where the curve is tight.
GRay stepRK4(GRay g,float dl,float rs,float capR){
  vec4 k1=gRHS(g,rs,capR),k2=gRHS(gApply(g,k1,dl*0.5),rs,capR);
  vec4 k3=gRHS(gApply(g,k2,dl*0.5),rs,capR),k4=gRHS(gApply(g,k3,dl),rs,capR);
  vec4 t=(k1+2.0*k2+2.0*k3+k4)/6.0;
  return GRay(g.r+dl*t.x,g.phi+dl*t.y,g.dr+dl*t.z,g.dphi+dl*t.w,g.E);}

// Lift the plane state back to world space: wPoint() the position, wDir() the
// tangent direction (used to sample the background where the ray finally escapes).
vec3 wPoint(GRay g,OrbPlane op){return op.radial*(g.r*cos(g.phi))+op.tangent*(g.r*sin(g.phi));}
vec3 wDir(GRay g,OrbPlane op){float cp=cos(g.phi),sp=sin(g.phi);
  return normalize(op.radial*(g.dr*cp-g.r*g.dphi*sp)+op.tangent*(g.dr*sp+g.r*g.dphi*cp));}

// Flat-space fallback (geodesic off): a single straight ray. The capture radius
// is the photon-sphere impact parameter b = sqrt(27)/2 * rs, so the black disc
// matches the true shadow size without integrating anything. A disc hit in
// front of the shadow is shaded over the shadow or the sky.
vec3 traceStraight(vec3 ro,vec3 rd,float lam){
  Isect hs=raySphere(ro,rd,vec3(0.0),0.5*sqrt(27.0)*u_rs,vec3(0.0));
  vec3 behind=hs.hit?vec3(0.0):sampleBg(rd);
  Isect hd=rayDisc(ro,rd);
  if(!hd.hit||(hs.hit&&hs.dist<hd.dist))return behind;
  float a;vec3 e=shadeDisc(hd.color,lam,a);
  return discToDisplay(e)+(1.0-a)*behind;
}

// The bent-ray march. Integrate the geodesic step by step; at each step test the
// short segment against horizon and disc, stop if captured (r <= capR), and once
// the ray is far out and receding, sample the background in its escape direction.
// The disc is semi-transparent: each crossing adds its emission times the
// transmittance so far (acc) and lowers the transmittance (trans), and the ray
// goes on. So the lensed far side and the photon-ring images show through
// the thin outer gas. The march stops when trans < 0.02.
// RK4 step growth: the step is dl inside STEP_NEAR_RS horizon radii, then
// grows as r, up to STEP_MAX_GAIN times dl. Escaping rays at the default
// zoom then take about 5x fewer steps.
const float STEP_NEAR_RS=2.0,STEP_MAX_GAIN=32.0;
vec3 traceGeodesic(vec3 ro,vec3 rd,float lam){
  float capR=u_rs*1.035;
  OrbPlane op=buildOrbPlane(ro,rd);
  GRay g=initGRay(ro,rd,op,u_rs,capR);
  float dl=u_geodesicDl;int maxS=int(u_maxSteps);
  float escR=u_escapeR*u_rs;bool rk4=u_useRK4>0.5;
  vec3 prev=ro,acc=vec3(0.0);float trans=1.0;
  // Fixed 8192 cap so the loop bound is constant (GLSL needs it); maxS is the
  // real per-frame step budget from the quality setting.
  for(int i=0;i<8192;i++){
    if(i>=maxS)break;
    // Captured before stepping: inside the horizon means black.
    if(g.r<=capR)return discToDisplay(acc);
    // Advance one step with the chosen integrator. The bend falls off as rs/r,
    // so RK4 steps grow with r (see STEP_NEAR_RS). Euler keeps the fixed dl:
    // the (r, phi) terms curve a straight ray, and a long Euler step moves
    // every star in the sky.
    float sdl=rk4?dl*clamp(g.r/(STEP_NEAR_RS*u_rs),1.0,STEP_MAX_GAIN):dl;
    if(rk4){g=stepRK4(g,sdl,u_rs,capR);}else{g=stepEuler(g,sdl,u_rs,capR);}
    // Test the segment just traversed against the disc, then the horizon.
    vec3 cur=wPoint(g,op);
    Isect hs=segSphere(prev,cur,vec3(0.0),capR,vec3(0.0));
    Isect hd=segDisc(prev,cur);
    if(hd.hit&&(!hs.hit||hd.dist<hs.dist)){
      float a;vec3 e=shadeDisc(hd.color,lam,a);
      acc+=trans*e;trans*=1.0-a;
      if(trans<0.02)return discToDisplay(acc);
    }
    if(hs.hit||g.r<=capR)return discToDisplay(acc);
    // Far out and moving away: the ray has escaped; read the sky it points at.
    if(g.r>=escR&&i>8)return discToDisplay(acc)+trans*sampleBg(wDir(g,op));
    prev=cur;
  }
  // Ran out of steps: fall back to the background in the current direction.
  return discToDisplay(acc)+trans*sampleBg(wDir(g,op));
}

// Entry point: build the view ray from the camera basis, trace it (geodesic or
// straight), and write the color. On a miss, straight mode samples the sky here
// while geodesic mode already carries its escaped-direction color.
void main(){
  vec2 uv=gl_FragCoord.xy/u_res;
  // Pixel offset from screen center, then a ray through the camera basis; the
  // focal length sets how far forward the image plane sits (field of view).
  float x=uv.x*u_res.x-u_res.x*0.5,y=(1.0-uv.y)*u_res.y-u_res.y*0.5;
  vec3 rd=normalize(u_camRight*x+u_camUp*(-y)+u_camFwd*u_focalLen);
  // lambda = L_z / E of the photon, in units of r_s. The photon moves along
  // -rd; a static observer at the camera sees b = r sin(alpha) / sqrt(f).
  float lam=cross(u_camPos/u_rs,-rd).y*inversesqrt(max(1.0-u_rs/length(u_camPos),1e-3));
  vec3 col=u_useGeodesic>0.5?traceGeodesic(u_camPos,rd,lam):traceStraight(u_camPos,rd,lam);
  fragColor=vec4(col,1.0);
}
