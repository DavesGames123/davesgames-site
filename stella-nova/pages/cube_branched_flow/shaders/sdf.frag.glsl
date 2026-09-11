#version 300 es
precision highp float;
uniform vec2 u_res;uniform float u_time;uniform vec3 u_ro;
uniform float u_sR,u_pK,u_tO,u_tM,u_tm,u_cD,u_pM,u_rS,u_gP,u_gH,u_mode;
uniform float u_mBase,u_mMetal,u_mFres,u_mEnv,u_mRough,u_mBrush;
uniform float u_rA,u_rB,u_rC,u_pulse,u_pulseR;
uniform sampler2D u_filTex;
uniform mat4 u_vp;
out vec4 outColor;
#define TAU 6.283185307
#define MD 500.0
float g_gd;mat3 gR;int g_i;
const vec4 hK=vec4(1,.6667,.3333,3);
vec3 hsv(vec3 c){vec3 p=abs(fract(c.xxx+hK.xyz)*6.-hK.www);return c.z*mix(hK.xxx,clamp(p-hK.xxx,0.,1.),c.y);}
vec3 aces(vec3 v){v=max(v,vec3(0))*.6;return clamp((v*(2.51*v+.03))/(v*(2.43*v+.59)+.14),vec3(0),vec3(1));}
float pm(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
vec3 pm3(vec3 a,vec3 b,float k){vec3 h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float px(float a,float b,float k){return-pm(-a,-b,k);}
vec3 pa3(vec3 a,float k){return-pm3(a,-a,k);}
float s8(vec3 p,float r){p*=p;p*=p;return pow(dot(p,p),.125)-r;}
float tor(vec3 p,vec2 t){return length(vec2(length(p.xz)-t.x,p.y))-t.y;}
mat3 rX(float a){float c=cos(a),s=sin(a);return mat3(1,0,0,0,c,s,0,-s,c);}
mat3 rY(float a){float c=cos(a),s=sin(a);return mat3(c,0,s,0,1,0,-s,0,c);}
mat3 rZ(float a){float c=cos(a),s=sin(a);return mat3(c,s,0,-s,c,0,0,0,1);}
float df(vec3 p){p*=gR;vec3 p0=p,p1=p*gR;p1=pa3(p1,u_pK);p1-=u_tO+sin(u_time*u_pulseR)*u_pulse;p1*=gR;
  float d0=s8(p0,u_sR),d1=tor(p1,vec2(u_tM,u_tm));float d=d0;d=px(d,-(d1-u_cD),u_pM);
  d=min(d,d1);g_gd=min(g_gd,d1);return d;}
vec3 calcN(vec3 p){vec2 e=vec2(.005,0);return normalize(vec3(
  df(p+e.xyy)-df(p-e.xyy),df(p+e.yxy)-df(p-e.yxy),df(p+e.yyx)-df(p-e.yyx)));}
float marchHi(vec3 ro,vec3 rd){float t=0.;vec2 dti=vec2(1e10,0);int i;
  for(i=0;i<70;i++){float d=df(ro+rd*t);if(d<dti.x)dti=vec2(d,t);
  if(d<.0001||t>MD)break;t+=d;}if(i==70)t=dti.y;g_i=i;return t;}
float marchLo(vec3 ro,vec3 rd,float ts){float t=ts;vec2 dti=vec2(1e10,0);int i;
  for(i=0;i<30;i++){float d=df(ro+rd*t);if(d<dti.x)dti=vec2(d,t);
  if(d<.0001||t>MD)break;t+=d;}if(i==30)t=dti.y;return t;}
vec3 env(vec3 rd){float y=.5+.5*rd.y;vec3 b=mix(vec3(.03,.03,.06),vec3(.06,.07,.12),y);
  b+=.015*exp(-3.*abs(rd.y));return b;}
void main(){vec2 uv=(gl_FragCoord.xy-.5*u_res)/u_res.y;vec3 ro=u_ro;
  vec3 ww=normalize(-ro);vec3 uu=normalize(cross(vec3(0,1,0),ww));vec3 vv=cross(ww,uu);
  float fov=tan(TAU/6.);vec3 rd=normalize(uv.x*uu+uv.y*vv+fov*ww);
  float tm=u_time*u_rS;gR=rX(u_rA*tm)*rZ(u_rB*tm)*rY(u_rC*tm);
  g_gd=1e3;float t=marchHi(ro,rd);float gd=g_gd;int it=g_i;
  if(u_mode>0.5){outColor=vec4(t<MD?t/MD:1.,0,0,1);return;}
  vec3 gC=hsv(vec3(u_gH,.75,.2))*u_gP,snC=hsv(vec3(u_gH+.1,.5,.5)),
    diC=hsv(vec3(u_gH-.25,.75,.125)),frC=hsv(vec3(u_gH+.15,.5,1));
  vec3 ggc=gC*inversesqrt(max(gd,.00025));vec3 col=env(rd)*u_mEnv;
  if(t<MD){vec3 p=ro+rd*t,n=calcN(p);
    float brush=sin(dot(p,normalize(vec3(1.7,2.3,.9)))*40.)*u_mBrush;
    vec3 bn=normalize(n+cross(n,normalize(vec3(.3,1,.7)))*brush*.1);
    vec3 r=reflect(rd,bn);float fr=pow(abs(1.+dot(rd,n)),u_mFres);
    float ao=1.-float(it)/70.;float fo=mix(.2,1.,ao);
    col+=snC*pow(max(dot(normalize(vec3(3,3,-7)),n),0.),2.)*diC*fo*u_mBase;
    g_gd=1e3;float rt=marchLo(p,r,1.);float rgd=g_gd;
    vec3 rgg=gC*inversesqrt(max(rgd,.00025));vec3 rc=clamp(rgg,vec3(0),vec3(4));
    rc+=(rt<MD)?diC*.2*u_mBase:env(r)*u_mEnv;
    vec2 scrUV=gl_FragCoord.xy/u_res;
    vec2 rOff=vec2(-dot(r,uu),dot(r,vv))*(.1+u_mRough*.2);
    vec3 fRef=texture(u_filTex,clamp(scrUV+rOff,0.,1.)).rgb;
    float refl=mix(.15,1.,fr)*fo*u_mMetal;
    col+=refl*(rc+fRef*2.)*frC;}
  col+=clamp(ggc,vec3(0),vec3(4));col=aces(col);col=sqrt(col);outColor=vec4(col,1);}
