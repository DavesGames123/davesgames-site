#version 300 es
precision highp float;
uniform vec2 u_res;
uniform vec3 u_camPos,u_camFwd,u_camRight,u_camUp;
uniform float u_focalLen,u_rs,u_discInner,u_discOuter;
uniform float u_geodesicDl,u_maxSteps,u_escapeR;
uniform float u_useGeodesic,u_useRK4,u_showDisc;
uniform float u_bgMode;
out vec4 fragColor;
const float PI=3.141592653589793;

float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
vec2 hash22(vec2 p){return vec2(hash21(p+vec2(17.0,59.4)),hash21(p+vec2(63.1,12.8)));}
vec2 bgUV(vec3 d){return vec2(atan(d.z,d.x)/(2.0*PI)+0.5,acos(clamp(d.y,-1.0,1.0))/PI);}

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

vec3 sampleBg(vec3 dir){
  if(u_bgMode<0.5)return sampleStars(dir);
  if(u_bgMode<1.5)return sampleGridBg(dir);
  if(u_bgMode<2.5)return sampleUVMap(dir);
  if(u_bgMode<3.5)return sampleNebula(dir);
  return sampleRings(dir);
}

vec3 sampleDisc(vec3 p){
  float rd=length(p.xz);float t=clamp((rd-u_discInner)/(u_discOuter-u_discInner),0.0,1.0);
  return clamp(mix(vec3(1.0,0.282,0.0),vec3(1.0,0.835,0.18),t)+vec3(0.11,0.024,0.0)*(1.0-t),vec3(0.0),vec3(1.0));
}

struct Isect{bool hit;float dist;vec3 color;};
Isect noHit(){return Isect(false,1e30,vec3(0.0));}
Isect closest(Isect a,Isect b){if(!b.hit)return a;if(!a.hit||b.dist<a.dist)return b;return a;}

Isect raySphere(vec3 ro,vec3 rd,vec3 c,float r,vec3 col){
  vec3 oc=ro-c;float b=2.0*dot(oc,rd),cc=dot(oc,oc)-r*r,disc=b*b-4.0*cc;
  if(disc<0.0)return noHit();float sq=sqrt(disc);
  float t1=(-b-sq)*0.5,t2=(-b+sq)*0.5;
  float t=t1>=0.0?t1:(t2>=0.0?t2:1e30);
  if(t>=1e30)return noHit();return Isect(true,t,col);}

Isect rayDisc(vec3 ro,vec3 rd){
  if(u_showDisc<0.5||abs(rd.y)<1e-9)return noHit();
  float t=-ro.y/rd.y;if(t<=0.0)return noHit();vec3 p=ro+rd*t;
  float r=length(p.xz),bias=u_rs*0.1;
  if(r<u_discInner+bias||r>u_discOuter)return noHit();
  return Isect(true,t,sampleDisc(p));}

Isect segSphere(vec3 s0,vec3 s1,vec3 c,float r,vec3 col){
  vec3 seg=s1-s0;float sl=length(seg);if(sl<1e-9)return noHit();
  vec3 d=seg/sl;vec3 oc=s0-c;float b=2.0*dot(oc,d),cc=dot(oc,oc)-r*r,disc=b*b-4.0*cc;
  if(disc<0.0)return noHit();float sq=sqrt(disc);
  float t1=(-b-sq)*0.5,t2=(-b+sq)*0.5,t=1e30;
  if(t1>=0.0&&t1<=sl)t=t1;else if(t2>=0.0&&t2<=sl)t=t2;
  if(t>=1e30)return noHit();return Isect(true,t,col);}

Isect segDisc(vec3 s0,vec3 s1){
  if(u_showDisc<0.5)return noHit();vec3 seg=s1-s0;
  if(abs(seg.y)<1e-9)return noHit();float t=-s0.y/seg.y;
  if(t<0.0||t>1.0)return noHit();vec3 p=s0+seg*t;
  float r=length(p.xz),bias=u_rs*0.1;
  if(r<u_discInner+bias||r>u_discOuter)return noHit();
  return Isect(true,length(seg)*t,sampleDisc(p));}

Isect traceRay(vec3 ro,vec3 rd,float bhR){
  return closest(closest(noHit(),raySphere(ro,rd,vec3(0.0),bhR,vec3(0.0))),rayDisc(ro,rd));}
Isect traceSeg(vec3 s0,vec3 s1,float bhR){
  return closest(closest(noHit(),segSphere(s0,s1,vec3(0.0),bhR,vec3(0.0))),segDisc(s0,s1));}

struct OrbPlane{vec3 radial;vec3 tangent;};
OrbPlane buildOrbPlane(vec3 lo,vec3 dir){
  vec3 rad=normalize(lo),nC=cross(lo,dir);
  vec3 fb;if(abs(rad.y)>0.9)fb=vec3(1,0,0);else fb=vec3(0,1,0);
  vec3 n;if(length(nC)<1e-6)n=normalize(cross(rad,fb));else n=normalize(nC);
  return OrbPlane(rad,normalize(cross(n,rad)));}

struct GRay{float r;float phi;float dr;float dphi;float E;};
GRay initGRay(vec3 lo,vec3 dir,OrbPlane op,float rs,float capR){
  float r=length(lo),dr=dot(dir,op.radial),dphi=dot(dir,op.tangent)/max(r,1e-9);
  float rE=max(r,capR),f=1.0-rs/rE;
  return GRay(r,0.0,dr,dphi,f*sqrt(dr*dr/(f*f)+rE*rE*dphi*dphi/f));}

vec4 gRHS(GRay g,float rs,float capR){
  float r=max(g.r,capR),f=1.0-rs/r,dtDl=g.E/f;
  return vec4(g.dr,g.dphi,-(rs/(2.0*r*r))*f*dtDl*dtDl+(rs/(2.0*r*r*f))*g.dr*g.dr+(r-rs)*g.dphi*g.dphi,-2.0*g.dr*g.dphi/r);}

GRay gApply(GRay g,vec4 k,float f){return GRay(g.r+k.x*f,g.phi+k.y*f,g.dr+k.z*f,g.dphi+k.w*f,g.E);}
GRay stepEuler(GRay g,float dl,float rs,float capR){vec4 k=gRHS(g,rs,capR);return GRay(g.r+dl*k.x,g.phi+dl*k.y,g.dr+dl*k.z,g.dphi+dl*k.w,g.E);}
GRay stepRK4(GRay g,float dl,float rs,float capR){
  vec4 k1=gRHS(g,rs,capR),k2=gRHS(gApply(g,k1,dl*0.5),rs,capR);
  vec4 k3=gRHS(gApply(g,k2,dl*0.5),rs,capR),k4=gRHS(gApply(g,k3,dl),rs,capR);
  vec4 t=(k1+2.0*k2+2.0*k3+k4)/6.0;
  return GRay(g.r+dl*t.x,g.phi+dl*t.y,g.dr+dl*t.z,g.dphi+dl*t.w,g.E);}

vec3 wPoint(GRay g,OrbPlane op){return op.radial*(g.r*cos(g.phi))+op.tangent*(g.r*sin(g.phi));}
vec3 wDir(GRay g,OrbPlane op){float cp=cos(g.phi),sp=sin(g.phi);
  return normalize(op.radial*(g.dr*cp-g.r*g.dphi*sp)+op.tangent*(g.dr*sp+g.r*g.dphi*cp));}

struct TR{bool hit;vec3 color;};

TR traceStraight(vec3 ro,vec3 rd){
  Isect h=traceRay(ro,rd,0.5*sqrt(27.0)*u_rs);
  if(!h.hit)return TR(false,vec3(0.0));return TR(true,h.color);}

TR traceGeodesic(vec3 ro,vec3 rd){
  float capR=u_rs*1.035;
  OrbPlane op=buildOrbPlane(ro,rd);
  GRay g=initGRay(ro,rd,op,u_rs,capR);
  float dl=u_geodesicDl;int maxS=int(u_maxSteps);
  float escR=u_escapeR*u_rs;bool rk4=u_useRK4>0.5;
  vec3 prev=ro;
  for(int i=0;i<8192;i++){
    if(i>=maxS)break;
    if(g.r<=capR)return TR(true,vec3(0.0));
    if(rk4){g=stepRK4(g,dl,u_rs,capR);}else{g=stepEuler(g,dl,u_rs,capR);}
    if(g.r<=capR)return TR(true,vec3(0.0));
    vec3 cur=wPoint(g,op);
    Isect h=traceSeg(prev,cur,capR);
    if(h.hit)return TR(true,h.color);
    if(g.r>=escR&&i>8)return TR(false,sampleBg(wDir(g,op)));
    prev=cur;
  }
  return TR(false,sampleBg(wDir(g,op)));
}

void main(){
  vec2 uv=gl_FragCoord.xy/u_res;
  float x=uv.x*u_res.x-u_res.x*0.5,y=(1.0-uv.y)*u_res.y-u_res.y*0.5;
  vec3 rd=normalize(u_camRight*x+u_camUp*(-y)+u_camFwd*u_focalLen);
  TR r;
  if(u_useGeodesic>0.5){r=traceGeodesic(u_camPos,rd);}
  else{r=traceStraight(u_camPos,rd);}
  if(r.hit){fragColor=vec4(r.color,1.0);}
  else if(u_useGeodesic>0.5){fragColor=vec4(r.color,1.0);}
  else{fragColor=vec4(sampleBg(rd),1.0);}
}

