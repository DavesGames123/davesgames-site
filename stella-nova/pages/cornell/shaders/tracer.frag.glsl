// tracer.frag.glsl — Cornell box path tracer, fragment stage (GPU port)
//
//   One fragment = one pixel = one new path sample this frame. It shoots a jittered
//   camera ray into the box, bounces it up to uMaxB times gathering light, then
//   folds the result into the running average read from uAccum. The display pass
//   tonemaps that average. This is the GPU twin of radiance() in main.js.
//
//   SCENE  (a unit box, walls at +/-1 on each axis)
//   --------------------------------------------------------------------------
//         +y ceiling (light patch in the centre)
//          ┌───────────────┐
//     uColL│               │uColR      left/right walls tinted,
//     (x=-1)│    objects    │(x=+1)     back + floor + ceiling = uColW
//          │   (SDF, <=8)   │           up to 8 ray-marched SDF primitives
//          └───────────────┘           sit inside, hit by marchObjects
//         -y floor
//
//   PER-PIXEL PATH
//   --------------------------------------------------------------------------
//     camRay(jittered) ─▶ radiance():
//        loop b: hitScene() ─┬─ walls  (analytic plane clips)
//                            └─ objects(marchObjects over shapeSDF)
//                 at diffuse: sampleLight() next-event + cosine bounce
//                 mirror / glass / glossy: reflect or refract, keep going
//                 Russian roulette after 3 bounces
//     running average: out = prev + (sample - prev) / (uSamples+1)
//
//   Materials (h.type): 0 diffuse, 1 emissive light face, 2 mirror, 3 glass,
//   5 object emitter, else glossy. Uniforms mirror the JS SCENE object.
#version 300 es
precision highp float; out vec4 frag;
uniform vec2 uRes; uniform int uFrame; uniform int uSamples; uniform vec3 uCamPos,uFwd,uRight,uUp; uniform float uTan,uAspect;
uniform vec3 uColL,uColR,uColW,uLightCol; uniform float uLightInt,uLightSize; uniform int uNumSph,uMaxB,uMSteps;
uniform vec4 uSph[8]; uniform vec4 uSphMat[8]; uniform vec4 uSphMat2[8];
uniform vec3 uRotInvR0[8]; uniform vec3 uRotInvR1[8]; uniform vec3 uRotInvR2[8]; uniform float uVis[8];
uniform sampler2D uAccum;
uniform sampler2D uTextSDF; uniform float uTextAspect;
const float PI=3.14159265359; const float INF=1e9;
// Per-pixel PRNG: an integer hash advanced each call, seeded from pixel + frame
// so every sample and every bounce draws fresh, decorrelated random numbers.
uint seed; uint hash(uint x){x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return x;}
float rnd(){ seed=hash(seed); return float(seed&0x00ffffffu)/float(0x01000000u); }
// Cosine-weighted hemisphere direction about n, for diffuse and glossy bounces.
vec3 cosineHemi(vec3 n){ float u1=rnd(),u2=rnd(); float r=sqrt(u1),th=6.2831853*u2;
  vec3 t=normalize(abs(n.x)>0.9?vec3(0,1,0):vec3(1,0,0)); t=normalize(cross(t,n)); vec3 b=cross(n,t);
  return normalize(t*r*cos(th)+b*r*sin(th)+n*sqrt(max(0.,1.-u1))); }
// Schlick fresnel reflectance for the glass material.
float fresnel(float ci,float ior){ float r0=(1.0-ior)/(1.0+ior); r0*=r0; return r0+(1.0-r0)*pow(1.0-ci,5.0); }
// Box distance, then the same per-shape SDF dispatch as the CPU core, so both
// backends render identical geometry (0 sphere .. 8 extruded text, default cone).
float sdBox(vec3 p, vec3 b){ vec3 q=abs(p)-b; return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0); }
float shapeSDF(int sh, vec3 p, float r){
  if(sh==0) return length(p)-r;
  if(sh==1) return sdBox(p, vec3(r*0.82));
  if(sh==2){ float b=r*0.70, rr=r*0.18; return sdBox(p, vec3(b-rr))-rr; }
  if(sh==3){ float ta=r*0.72, tb=r*0.30; vec2 q=vec2(length(p.xz)-ta, p.y); return length(q)-tb; }
  if(sh==4){ float rad=r*0.60,h=r*0.85; vec2 d=vec2(length(p.xz)-rad, abs(p.y)-h); return min(max(d.x,d.y),0.0)+length(max(d,0.0)); }
  if(sh==5){ float s=r*1.15; return (abs(p.x)+abs(p.y)+abs(p.z)-s)*0.57735027; }
  if(sh==6){ float hh=r*0.5; vec3 pp=p; pp.y-=clamp(pp.y,-hh,hh); return length(pp)-r*0.5; }
  if(sh==8){ float th=r*0.16; vec2 uv=clamp(vec2(0.5 + p.x/(2.0*uTextAspect*r), 0.5 - p.y/(2.0*r)),0.0,1.0);
    float nrm=textureLod(uTextSDF,uv,0.0).r*2.0-1.0; float d2=nrm*r, dz=abs(p.z)-th;
    vec2 w=vec2(d2,dz); return min(max(d2,dz),0.0)+length(max(w,0.0)); }
  float CH=r*0.85, rb=r*0.62, rt=0.0001; vec2 q=vec2(length(p.xz),p.y);
  vec2 k1=vec2(rt,CH), k2=vec2(rt-rb,2.0*CH);
  vec2 ca=vec2(q.x-min(q.x,(q.y<0.0)?rb:rt), abs(q.y)-CH);
  vec2 cb=q-k1+k2*clamp(dot(k1-q,k2)/dot(k2,k2),0.0,1.0);
  float s2=(cb.x<0.0&&ca.y<0.0)?-1.0:1.0;
  return s2*sqrt(min(dot(ca,ca),dot(cb,cb)));
}
// Nearest object to p (in world space) and its id; each object is tested in its
// own rotated frame via the uRotInv rows.
float mapObjects(vec3 p, out int id){ float best=1e9; id=0;
  for(int i=0;i<8;i++){ if(i>=uNumSph) break; if(uVis[i]<0.5) continue; vec3 d=p-uSph[i].xyz;
    vec3 l=vec3(dot(uRotInvR0[i],d),dot(uRotInvR1[i],d),dot(uRotInvR2[i],d));
    float dd=shapeSDF(int(uSphMat2[i].z+0.5), l, uSph[i].w); if(dd<best){best=dd;id=i;} }
  return best; }
// Sphere-trace the object field to tMax; returns hit distance or -1.
float marchObjects(vec3 ro, vec3 rd, float tMax, out int id){ float t=2e-3; id=0;
  for(int i=0;i<256;i++){ if(i>=uMSteps) break; int oid; float d=mapObjects(ro+rd*t,oid); float ad=abs(d);
    if(ad<6e-4*(1.0+t*0.5)){ id=oid; return t; } t+=ad*0.9; if(t>tMax) break; } return -1.0; }
// SDF gradient (central differences) gives the object surface normal.
vec3 normalObjects(vec3 p){ float e=5e-4; int d;
  float nx=mapObjects(p+vec3(e,0,0),d)-mapObjects(p-vec3(e,0,0),d);
  float ny=mapObjects(p+vec3(0,e,0),d)-mapObjects(p-vec3(0,e,0),d);
  float nz=mapObjects(p+vec3(0,0,e),d)-mapObjects(p-vec3(0,0,e),d); return normalize(vec3(nx,ny,nz)); }
// A ray hit: distance, normal, albedo, material type, roughness, ior, emission.
struct Hit{ float t; vec3 n; vec3 alb; int type; float rough; float ior; vec3 emis; };
// Record a wall-plane hit if it is the nearest so far.
void face(inout Hit h,float t,vec3 n,vec3 alb,vec3 e,int ty){ if(t>0.001&&t<h.t){h.t=t;h.n=n;h.alb=alb;h.emis=e;h.type=ty;h.rough=1.0;h.ior=1.0;} }
// Intersect the whole scene: the six box walls as clipped planes (the +y face
// carries the light patch in its centre), then the SDF objects via marchObjects.
Hit hitScene(vec3 ro,vec3 rd){ Hit h; h.t=INF; h.type=-1; h.emis=vec3(0.0); float t; vec3 p;
  if(abs(rd.x)>1e-6){ t=(-1.0-ro.x)/rd.x; p=ro+rd*t; if(all(lessThanEqual(abs(p.yz),vec2(1.0)))) face(h,t,vec3(1,0,0),uColL,vec3(0),0);
                      t=( 1.0-ro.x)/rd.x; p=ro+rd*t; if(all(lessThanEqual(abs(p.yz),vec2(1.0)))) face(h,t,vec3(-1,0,0),uColR,vec3(0),0); }
  if(abs(rd.y)>1e-6){ t=(-1.0-ro.y)/rd.y; p=ro+rd*t; if(all(lessThanEqual(abs(p.xz),vec2(1.0)))) face(h,t,vec3(0,1,0),uColW,vec3(0),0);
                      t=( 1.0-ro.y)/rd.y; p=ro+rd*t; if(all(lessThanEqual(abs(p.xz),vec2(1.0)))){ bool lit=abs(p.x)<uLightSize&&abs(p.z)<uLightSize;
                        face(h,t,vec3(0,-1,0), lit?vec3(0):uColW, lit?uLightCol*uLightInt:vec3(0), lit?1:0); } }
  if(abs(rd.z)>1e-6){ t=(-1.0-ro.z)/rd.z; p=ro+rd*t; if(all(lessThanEqual(abs(p.xy),vec2(1.0)))) face(h,t,vec3(0,0,1),uColW,vec3(0),0); }
  { int oid; float tObj=marchObjects(ro,rd,(h.t>1e8?6.0:h.t),oid); if(tObj>0.0&&tObj<h.t){ vec3 q=ro+rd*tObj; h.t=tObj; h.n=normalObjects(q); h.alb=uSphMat[oid].yzw; h.type=int(uSphMat[oid].x+0.5); h.rough=uSphMat2[oid].x; h.ior=uSphMat2[oid].y; h.emis=(h.type==5)?(uSphMat[oid].yzw*uSphMat2[oid].w):vec3(0); } }
  return h; }
// Next-event estimation: sample a point on the ceiling light, test the shadow
// ray, and return its direct contribution (BRDF x geometry x area).
vec3 sampleLight(vec3 p,vec3 n,vec3 alb){ float lx=(rnd()*2.0-1.0)*uLightSize, lz=(rnd()*2.0-1.0)*uLightSize; vec3 lp=vec3(lx,0.999,lz);
  vec3 d=lp-p; float dist=length(d); vec3 L=d/dist; float ndl=max(dot(n,L),0.0); if(ndl<=0.0) return vec3(0);
  float cosl=max(dot(vec3(0,-1,0),-L),0.0); if(cosl<=0.0) return vec3(0);
  Hit s=hitScene(p+n*1.5e-3,L); if(s.t<dist-2e-3) return vec3(0);
  float area=pow(2.0*uLightSize,2.0); return alb/PI*ndl*uLightCol*uLightInt*cosl/(dist*dist)*area; }
// The path integrator: bounce the ray, adding direct light at diffuse hits and
// carrying throughput thr. spec tracks whether the last bounce was specular, so
// emitters are only counted once (either directly or via next-event). Russian
// roulette terminates dim paths after 3 bounces.
vec3 radiance(vec3 ro,vec3 rd){ vec3 col=vec3(0), thr=vec3(1); bool spec=true;
  for(int b=0;b<12;b++){ if(b>=uMaxB) break; Hit h=hitScene(ro,rd); if(h.type==-1) break; vec3 p=ro+rd*h.t, n=h.n;
    if(h.type==1){ if(spec) col+=thr*h.emis; break; }
    else if(h.type==5){ col+=thr*h.emis; break; }
    else if(h.type==0){ col+=thr*sampleLight(p,n,h.alb); thr*=h.alb; ro=p+n*1.5e-3; rd=cosineHemi(n); spec=false; }
    else if(h.type==2){ vec3 rr=normalize(reflect(rd,n)+cosineHemi(n)*h.rough); thr*=h.alb; ro=p+n*1.5e-3; rd=rr; spec=true; }
    else if(h.type==3){ float ci=dot(-rd,n); vec3 nn=n; float eta=1.0/h.ior; if(ci<0.0){nn=-n;ci=-ci;eta=h.ior;}
       float F=fresnel(ci,h.ior); vec3 rf=refract(rd,nn,eta); if(rf==vec3(0.0)||rnd()<F) rd=reflect(rd,nn); else rd=rf; ro=p+rd*1.5e-3; thr*=h.alb; spec=true; }
    else { vec3 rr=normalize(reflect(rd,n)+cosineHemi(n)*h.rough); thr*=h.alb; ro=p+n*1.5e-3; rd=rr; spec=true; }
    if(b>3){ float q=max(thr.r,max(thr.g,thr.b)); if(rnd()>q) break; thr/=q; } }
  return col; }
// Build one jittered camera ray, trace it, and blend the new sample into the
// running average from uAccum so the image converges frame over frame.
void main(){ vec2 uv=gl_FragCoord.xy; seed=hash(uint(uv.x)+uint(uv.y)*1973u+uint(uFrame)*9277u+1u);
  vec2 j=vec2(rnd(),rnd()); vec2 ndc=((uv+j)/uRes)*2.0-1.0;
  vec3 rd=normalize(uFwd+uRight*ndc.x*uTan*uAspect+uUp*ndc.y*uTan); vec3 c=radiance(uCamPos,rd);
  vec3 prev=texture(uAccum,uv/uRes).rgb; vec3 outc=(uSamples==0)?c:prev+(c-prev)/float(uSamples+1); frag=vec4(outc,1.0); }
