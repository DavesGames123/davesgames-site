#version 300 es
// ============================================================================
//  refraction.frag.glsl — glass cube, fragment stage (the whole renderer)
// ----------------------------------------------------------------------------
//  One pass, per pixel: build a camera ray, hit the outer cube, refract into
//  the glass, trace the ornament floating inside it, and mix the refracted
//  interior against a Fresnel reflection at the surface.
//
//  RAY PATH (per pixel)
//  --------------------
//      eye ●──rd──▶ box() outer cube face ──▶ refract(1/ior) into glass
//                         │                        │
//                         │            insides(): 3 rotated bilinear patches
//                         │            form the ornament; calcColor shades hits
//                         ▼                        │
//                   Fresnel(rd,n) ◀── mix ─────────┘  interior vs reflection
//                         ▼
//                   fragColor
//
//  The interior loop bounces up to 2 times: on a miss or partial coverage it
//  refracts through the far wall, accumulating Fresnel weight (total internal
//  reflection). insides() traces THREE bilinear patches rotated 60° apart on
//  the hit face, depth-sorts them, and composites front to back.
//
//  SECTION MAP   (jump with grep -n "<anchor>" refraction.frag.glsl)
//  --------------------------------------------------------------------------
//      uniforms ......... "uniform"          camera / optics / colour controls
//      rotation mats .... "mat3 rotx"        axis rotations
//      palette .......... "vec3 fcos"        anti-aliased cosine palette basis
//      colour ........... "getColor"         position → iridescent colour
//      shade hit ........ "void calcColor"   colour + coverage at a patch hit
//      patch trace ...... "iBilinearPatch"   ray vs bilinear patch (quadratic)
//      box intersect .... "float box"        ray vs axis-aligned cube
//      interior ......... "vec4 insides"     the 3-patch ornament, sorted
//      main image ....... "void mainImage"   camera, refraction, Fresnel mix
// ============================================================================
precision highp float;
// Camera / animation inputs from main.js: viewport, seconds, pointer.
uniform vec3 iResolution;uniform float iTime;uniform vec4 iMouse;
// Camera framing and the curvature of the interior patches.
uniform float u_zoom,u_fov,u_height,u_spin,u_curvature;
// Glass optics: index of refraction and the two Fresnel exponents (outer rim,
// inner bounces).
uniform float u_ior,u_fresnel,u_fresnelIn;
// Lighting: key light angle plus ambient / diffuse / accent weights.
uniform float u_lightAng,u_ambient,u_diffuse,u_accent;
// Palette controls: phase, saturation, frequency, and the patch edge feather.
uniform float u_cPhase,u_cSat,u_cFreq,u_edgeFade;
out vec4 outColor;
// tshift offsets the auto-spin so frame 0 is not a symmetric pose.
#define tshift 53.
#define PI 3.1415926
// Axis rotation matrices, used to orbit the camera and to rotate the interior
// patches into their three orientations.
mat3 rotx(float a){float s=sin(a),c=cos(a);return mat3(1,0,0,0,c,s,0,-s,c);}
mat3 roty(float a){float s=sin(a),c=cos(a);return mat3(c,0,s,0,1,0,-s,0,c);}
mat3 rotz(float a){float s=sin(a),c=cos(a);return mat3(c,s,0,-s,c,0,0,0,1);}
// Band-limited cosine. Fades high frequencies out with the pixel footprint
// (fwidth) so the palette does not alias; the loop is a fallback where the
// derivative is degenerate (zero, NaN, or infinite).
vec3 fcos(vec3 x){vec3 w=fwidth(x);float lw=length(w);if(lw==0.||isnan(lw)||isinf(lw)){vec3 tc=vec3(0.);for(int i=0;i<8;i++)tc+=cos(x+x*float(i-4)*(0.01*400./iResolution.y));return tc/8.;}return cos(x)*smoothstep(PI*2.,0.,w);}
// Position → iridescent colour. Inversion (p/dot(p,p)) warps space so the
// palette swirls, then a stack of fcos harmonics at rising frequencies builds
// the spectrum. u_cFreq scales the harmonics, u_cSat pulls toward/away grey.
vec3 getColor(vec3 p){p=abs(p)*1.25;p=0.5*p/dot(p,p);p+=u_cPhase;float t=0.13*length(p);float f=u_cFreq;vec3 col=vec3(0.3,0.4,0.5);col+=0.12*fcos(6.28318*t*1.0*f+vec3(0.0,0.8,1.1));col+=0.11*fcos(6.28318*t*3.1*f+vec3(0.3,0.4,0.1));col+=0.10*fcos(6.28318*t*5.1*f+vec3(0.1,0.7,1.1));col+=0.10*fcos(6.28318*t*17.1*f+vec3(0.2,0.6,0.7));col+=0.10*fcos(6.28318*t*31.1*f+vec3(0.1,0.6,0.7));col+=0.10*fcos(6.28318*t*65.1*f+vec3(0.0,0.5,0.8));col+=0.10*fcos(6.28318*t*115.1*f+vec3(0.1,0.4,0.7));col+=0.10*fcos(6.28318*t*265.1*f+vec3(1.1,1.4,2.7));col=clamp(col,0.,1.);col=mix(vec3(dot(col,vec3(.299,.587,.114))),col,u_cSat);return clamp(col,0.,1.);}
// Shade one patch hit: colour from getColor at the hit point, alpha feathered
// by u_edgeFade so the round patch fades at its rim. When si is set, the ray
// also grazes the patch's second (back) intersection, shaded into colsi.
void calcColor(vec3 ro,vec3 rd,vec3 nor,float d,float len,int idx,bool si,float td,out vec4 colx,out vec4 colsi){vec3 pos=ro+rd*d;float a=1.-smoothstep(len-u_edgeFade,len+.00001,length(pos));colx=vec4(getColor(pos),a);if(si){pos=ro+rd*td;float ta=1.-smoothstep(len-u_edgeFade,len+.00001,length(pos));colsi=vec4(getColor(pos),ta);}}
// Ray vs bilinear patch. A bilinear patch is a saddle surface; substituting the
// ray into its implicit form gives a quadratic p*t^2 + q*t + r = 0. Solve it,
// keep the nearest root inside the patch radius sz, and return the hit distance
// and analytic normal (gradient of the implicit surface). si/tsi report a valid
// second root, so translucent patches can show their far side.
//   ps/ph encode the four corner heights; p,q,r are the quadratic coefficients.
bool iBilinearPatch(vec3 ro,vec3 rd,vec4 ps,vec4 ph,float sz,out float t,out vec3 norm,out bool si,out float tsi,out vec3 normsi,out float fade,out float fadesi){vec3 va=vec3(0.,0.,ph.x+ph.w-ph.y-ph.z);vec3 vb=vec3(0.,ps.w-ps.y,ph.z-ph.x);vec3 vc=vec3(ps.z-ps.x,0.,ph.y-ph.x);vec3 vd=vec3(ps.xy,ph.x);t=-1.;tsi=-1.;si=false;fade=1.;fadesi=1.;norm=vec3(0.,1.,0.);normsi=vec3(0.,1.,0.);float tmp=1./(vb.y*vc.x);float a=0.,b=0.,c=0.,d2=va.z*tmp,e=0.,f2=0.;float g=(vc.z*vb.y-vd.y*va.z)*tmp;float h=(vb.z*vc.x-va.z*vd.x)*tmp;float ii=-1.;float j=(vd.x*vd.y*va.z+vd.z*vb.y*vc.x)*tmp-(vd.y*vb.z*vc.x+vd.x*vc.z*vb.y)*tmp;float p=dot(vec3(a,b,c),rd.xzy*rd.xzy)+dot(vec3(d2,e,f2),rd.xzy*rd.zyx);float q=dot(vec3(2.)*ro.xzy*rd.xyz,vec3(a,b,c))+dot(ro.xzz*rd.zxy,vec3(d2,d2,e))+dot(ro.yyx*rd.zxy,vec3(e,f2,f2))+dot(vec3(g,h,ii),rd.xzy);float r=dot(vec3(a,b,c),ro.xzy*ro.xzy)+dot(vec3(d2,e,f2),ro.xzy*ro.zyx)+dot(vec3(g,h,ii),ro.xzy)+j;if(abs(p)<.000001){float tt=-r/q;if(tt<=0.)return false;t=tt;vec3 pos=ro+t*rd;if(length(pos)>sz)return false;vec3 grad=vec3(2.)*pos.xzy*vec3(a,b,c)+pos.zxz*vec3(d2,d2,e)+pos.yyx*vec3(f2,e,f2)+vec3(g,h,ii);norm=-normalize(grad);return true;}else{float sq=q*q-4.*p*r;if(sq<0.)return false;float s=sqrt(sq),t0=(-q+s)/(2.*p),t1=(-q-s)/(2.*p);float tt1=min(t0<0.?t1:t0,t1<0.?t0:t1);float tt2=max(t0>0.?t1:t0,t1>0.?t0:t1);float tt0=tt1;if(tt0<=0.)return false;vec3 pos=ro+tt0*rd;bool ru=step(sz,length(pos))>.5;if(ru){tt0=tt2;pos=ro+tt0*rd;}if(tt0<=0.)return false;if(step(sz,length(pos))>.5)return false;if(tt2>0.&&(!ru)&&!(step(sz,length(ro+tt2*rd))>.5)){si=true;fadesi=s;tsi=tt2;vec3 tpos=ro+tsi*rd;vec3 tgrad=vec3(2.)*tpos.xzy*vec3(a,b,c)+tpos.zxz*vec3(d2,d2,e)+tpos.yyx*vec3(f2,e,f2)+vec3(g,h,ii);normsi=-normalize(tgrad);}fade=s;t=tt0;vec3 grad=vec3(2.)*pos.xzy*vec3(a,b,c)+pos.zxz*vec3(d2,d2,e)+pos.yyx*vec3(f2,e,f2)+vec3(g,h,ii);norm=-normalize(grad);return true;}}
// Ray vs axis-aligned box (slab test). Returns the entry distance when entering
// is true, else the exit distance, and writes the face normal nn. The tiny rd
// nudge avoids a divide-by-zero when a ray component is exactly axis-aligned.
float box(vec3 ro,vec3 rd,vec3 r,out vec3 nn,bool entering){rd+=.0001*(1.-abs(sign(rd)));vec3 dr=1./rd,n=ro*dr,k=r*abs(dr);vec3 pin=-k-n,pout=k-n;float tin=max(pin.x,max(pin.y,pin.z)),tout=min(pout.x,min(pout.y,pout.z));if(tin>tout)return -1.;if(entering)nn=-sign(rd)*step(pin.zxy,pin.xyz)*step(pin.yzx,pin.xyz);else nn=sign(rd)*step(pout.xyz,pout.zxy)*step(pout.xyz,pout.yzx);return entering?tin:tout;}
// In-place swap macro, used by the depth sort in insides().
#define swap(a,b) tv=a;a=b;b=tv
// Trace the ornament inside the glass. Rotate the ray into a canonical frame for
// whichever cube face was hit, then intersect THREE bilinear patches spaced 60°
// apart (the rotz/rotx steps in the loop). Shade each with lighting and the
// accent rim, depth-sort the three by hit distance, and composite front to back
// (translucent patches let the ones behind show through). tout is the farthest
// interior hit, used by the caller to decide whether the ray exits the glass.
vec4 insides(vec3 ro,vec3 rd,vec3 nor_c,vec3 l_dir,out float tout){tout=-1.;vec3 col=vec3(0.);if(abs(nor_c.x)>.5){rd=rd.xzy*nor_c.x;ro=ro.xzy*nor_c.x;}else if(abs(nor_c.z)>.5){l_dir*=roty(PI);rd=rd.yxz*nor_c.z;ro=ro.yxz*nor_c.z;}else if(abs(nor_c.y)>.5){l_dir*=rotz(-PI*.5);rd=rd*nor_c.y;ro=ro*nor_c.y;}float bil_size=1.;vec4 ps=vec4(-bil_size,-bil_size,bil_size,bil_size)*u_curvature;vec4 ph=vec4(-bil_size,bil_size,bil_size,-bil_size)*u_curvature;vec4 colx[3]=vec4[3](vec4(0),vec4(0),vec4(0));vec3 dx[3]=vec3[3](vec3(-1),vec3(-1),vec3(-1));vec4 colxsi[3]=vec4[3](vec4(0),vec4(0),vec4(0));int order[3]=int[3](0,1,2);for(int i=0;i<3;i++){if(abs(nor_c.x)>.5){ro*=rotz(-PI/3.);rd*=rotz(-PI/3.);}else if(abs(nor_c.z)>.5){ro*=rotz(PI/3.);rd*=rotz(PI/3.);}else if(abs(nor_c.y)>.5){ro*=rotx(PI/3.);rd*=rotx(PI/3.);}vec3 normnew;float tnew;bool si;float tsi;vec3 normsi;float fade,fadesi;if(iBilinearPatch(ro,rd,ps,ph,bil_size,tnew,normnew,si,tsi,normsi,fade,fadesi)){if(tnew>0.){vec4 tcol,tcolsi;calcColor(ro,rd,normnew,tnew,bil_size,i,si,tsi,tcol,tcolsi);if(tcol.a>0.){dx[i]=vec3(tnew,float(si),tsi);float dif=clamp(dot(normnew,l_dir),0.,1.);float amb=clamp(.5+.5*dot(normnew,l_dir),0.,1.);vec3 shad=vec3(.32,.43,.54)*amb*u_ambient+vec3(1.,.9,.7)*dif*u_diffuse;vec3 tcr=vec3(1.,.21,.11);float ta=clamp(length(tcol.rgb),0.,1.);tcol=clamp(tcol*tcol*2.,0.,1.);vec4 tv4=vec4(tcol.rgb*shad*1.4+u_accent*(tcr*tcol.rgb)*clamp(1.-(amb+dif),0.,1.),min(tcol.a,ta));tv4.rgb=clamp(2.*tv4.rgb*tv4.rgb,0.,1.);tv4*=min(fade*5.,1.);colx[i]=tv4;if(si){dif=clamp(dot(normsi,l_dir),0.,1.);amb=clamp(.5+.5*dot(normsi,l_dir),0.,1.);shad=vec3(.32,.43,.54)*amb*u_ambient+vec3(1.,.9,.7)*dif*u_diffuse;ta=clamp(length(tcolsi.rgb),0.,1.);tcolsi=clamp(tcolsi*tcolsi*2.,0.,1.);vec4 sv4=vec4(tcolsi.rgb*shad+u_accent*(tcr*tcolsi.rgb)*clamp(1.-(amb+dif),0.,1.),min(tcolsi.a,ta));sv4.rgb=clamp(2.*sv4.rgb*sv4.rgb,0.,1.);sv4.rgb*=min(fadesi*5.,1.);colxsi[i]=sv4;}}}}}float a=1.;if(dx[0].x<dx[1].x){{vec3 swap(dx[0],dx[1]);}{int swap(order[0],order[1]);}}if(dx[1].x<dx[2].x){{vec3 swap(dx[1],dx[2]);}{int swap(order[1],order[2]);}}if(dx[0].x<dx[1].x){{vec3 swap(dx[0],dx[1]);}{int swap(order[0],order[1]);}}tout=max(max(dx[0].x,dx[1].x),dx[2].x);if(dx[0].y<.5)a=colx[order[0]].a;bool rul[3]=bool[3]((dx[0].y>.5)&&(dx[1].x<=0.),(dx[1].y>.5)&&(dx[0].x>dx[1].z),(dx[2].y>.5)&&(dx[1].x>dx[2].z));for(int k=0;k<3;k++){if(rul[k]){vec4 tcolxsi=colxsi[order[k]],tcolx=colx[order[k]];vec4 tv_=mix(tcolxsi,tcolx,tcolx.a);colx[order[k]]=mix(vec4(0),tv_,max(tcolx.a,tcolxsi.a));}}float a1=(dx[1].y<.5)?colx[order[1]].a:((dx[1].z>dx[0].x)?colx[order[1]].a:1.);float a2=(dx[2].y<.5)?colx[order[2]].a:((dx[2].z>dx[1].x)?colx[order[2]].a:1.);col=mix(mix(colx[order[0]].rgb,colx[order[1]].rgb,a1),colx[order[2]].rgb,a2);a=max(max(a,a1),a2);return vec4(col,a);}
// Per-pixel entry point. Builds an orbiting camera (angle from time/spin and the
// pointer), casts a ray, and hits the outer cube. On a hit it refracts into the
// glass, traces the interior over up to two bounces accumulating Fresnel weight,
// then mixes the refracted interior against the surface reflection by the outer
// Fresnel term. A miss writes black.
//   R0 is the Schlick base reflectance from the index of refraction u_ior.
void mainImage(out vec4 fragColor,vec2 fragCoord){vec3 l_dir=normalize(vec3(0.,1.,0.))*rotz(u_lightAng);vec3 boxD=vec3(1.0);float camY=PI*u_height;if(iMouse.y>=1.)camY=(1.-1.15*iMouse.y/iResolution.y)*.5*PI;float camX=-2.*PI-.25*(iTime*u_spin+tshift);camX+=-(iMouse.x/iResolution.x)*2.*PI;vec3 eye=u_zoom*vec3(cos(camX)*cos(camY),sin(camX)*cos(camY),sin(camY));vec3 w=normalize(-eye),up=vec3(0,0,1);vec3 u=normalize(cross(w,up)),v=cross(u,w);vec2 uv=(fragCoord-.5*iResolution.xy)/iResolution.x;vec3 rd=normalize(w*u_fov+uv.x*u+uv.y*v);vec3 ni;float t=box(eye,rd,boxD,ni,true);vec3 ro=eye+t*rd;vec2 coords=ro.xy*ni.z+ro.yz*ni.x+ro.zx*ni.y;float fadeborders=(1.-smoothstep(.915,1.05,abs(coords.x)))*(1.-smoothstep(.915,1.05,abs(coords.y)));if(t>0.){float R0=(u_ior-1.)/(u_ior+1.);R0*=R0;vec2 theta=vec2(0.);vec3 n=vec3(cos(theta.x)*sin(theta.y),sin(theta.x)*sin(theta.y),cos(theta.y));vec3 nr=n.zxy*ni.x+n.yzx*ni.y+n.xyz*ni.z;vec3 reflcol=vec3(0.);vec3 rd2=refract(rd,nr,1./u_ior);float accum=1.;vec3 no2=ni;vec3 ro_refr=ro;vec4 colo[2]=vec4[2](vec4(0),vec4(0));for(int j=0;j<2;j++){float tb;vec2 coords2=ro_refr.xy*no2.z+ro_refr.yz*no2.x+ro_refr.zx*no2.y;vec3 eye2=vec3(coords2,-1.);vec3 rd2trans=rd2.yzx*no2.x+rd2.zxy*no2.y+rd2.xyz*no2.z;rd2trans.z=-rd2trans.z;vec4 internalcol=insides(eye2,rd2trans,no2,l_dir,tb);if(tb>0.){internalcol.rgb*=accum;colo[j]=internalcol;}if(tb<=0.||internalcol.a<1.){float tout2=box(ro_refr,rd2,boxD,no2,false);no2=n.zyx*no2.x+n.xzy*no2.y+n.yxz*no2.z;vec3 rout=ro_refr+tout2*rd2;vec3 rdout=refract(rd2,-no2,u_ior);float fresnel2=R0+(1.-R0)*pow(1.-dot(rdout,no2),u_fresnelIn);rd2=reflect(rd2,-no2);ro_refr=rout;ro_refr.z=max(ro_refr.z,-.999);accum*=fresnel2;}}float fresnel=R0+(1.-R0)*pow(1.-dot(-rd,nr),u_fresnel);vec3 col=mix(mix(colo[1].rgb*colo[1].a,colo[0].rgb,colo[0].a)*fadeborders,reflcol,pow(fresnel,1.5));fragColor=vec4(clamp(col,0.,1.),1.);}else{fragColor=vec4(0.,0.,0.,1.);}}
// GLSL entry: run mainImage for this fragment and write the result.
void main(){mainImage(outColor,gl_FragCoord.xy);}
