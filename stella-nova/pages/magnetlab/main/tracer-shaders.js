// ============================================================================
//  MAGNETLAB  ·  tracer GLSL  (part 8 of 20)
// ----------------------------------------------------------------------------
//  The vertex and fragment shader text of the instanced tracer draw, and
//  the GLSL ramp built from FIELD_RAMP_STOPS. tracer-gl.js compiles them.
//
//  grep -n targets: "function glslRamp", "const TR_VS", "const TR_FS", "uMode"
// ============================================================================

// GLSL ramp: the FIELD_RAMP_STOPS table as a chain of mix() calls. For s in
// [k,k+1], the mix calls before k are at full weight and those after are at
// zero, so the chain gives the same six-stop ramp as rampStopRGB.
function glslRamp(){
  const v=c=>`vec3(${c.map(x=>x.toFixed(3)).join(',')})`;
  let src=`vec3 ramp(float t){float s=clamp(t,0.0,1.0)*5.0;vec3 c=${v(FIELD_RAMP_STOPS[0])};`;
  for(let k=1;k<FIELD_RAMP_STOPS.length;k++) src+=`c=mix(c,${v(FIELD_RAMP_STOPS[k])},clamp(s-${(k-1).toFixed(1)},0.0,1.0));`;
  return src+'return c;}';
}
const TR_VS=`
attribute vec2 aCorner; attribute vec4 aP; attribute vec4 aA; attribute vec4 aB; attribute vec4 aN;
uniform vec2 uRes; uniform vec2 uCam; uniform float uZoom; uniform float uDpr;
varying float vDist; varying float vAlong; varying float vGlow; varying float vCore; varying float vFade; varying float vLc;
varying vec2 vDir;
vec2 toScreen(vec2 w){ return (w-0.5*uRes+uCam)*uZoom+0.5*uRes; }
vec2 dirOf(vec2 a,vec2 b,vec2 fb){ vec2 d=b-a; float l=length(d); return l>1e-5?d/l:fb; }
// Miter offset at a joint: the bisector of the two segment normals, scaled so
// the line keeps its width. The scale is clamped on sharp turns.
vec2 miter(vec2 n,vec2 dOther,bool has){
  if(!has) return n;
  vec2 m=normalize(n+vec2(-dOther.y,dOther.x)+1e-6);
  return m/max(dot(m,n),0.5);
}
void main(){
  vDist=0.0; vAlong=0.0; vGlow=0.0; vCore=0.0; vFade=0.0; vLc=0.0; vDir=vec2(1.0,0.0);
  if(aA.w<0.0||aB.w<0.0){ gl_Position=vec4(2.0,2.0,2.0,1.0); return; }
  vec2 sA=toScreen(aA.xy), sB=toScreen(aB.xy);
  vec2 d=sB-sA; float L=length(d);
  vec2 dir=L>1e-5?d/L:vec2(1.0,0.0);
  vec2 n=vec2(-dir.y,dir.x);
  // Joint normal at this end: A joins P->A, B joins B->N.
  bool atB=aCorner.x>0.5;
  vec2 j=atB?miter(n,dirOf(sB,toScreen(aN.xy),dir),aN.w>=0.0)
            :miter(n,dirOf(toScreen(aP.xy),sA,dir),aP.w>=0.0);
  float f=mix(aA.w,aB.w,aCorner.x);
  float px=uZoom*uDpr;
  float glow=max(1.0,5.0*f)*px, core=max(0.5,1.8*f)*px;
  float halfExt=0.5*max(glow,1.0)+1.0;
  float lcA=aA.z, cap=0.0;
  if(lcA>=2.0){ lcA-=2.0; cap=halfExt/uDpr; }
  float along=mix(-cap,L,aCorner.x);
  vec2 s=sA+dir*along+j*(aCorner.y*halfExt/uDpr);
  gl_Position=vec4(s.x/uRes.x*2.0-1.0,1.0-s.y/uRes.y*2.0,0.0,1.0);
  vDist=aCorner.y*halfExt; vAlong=along*uDpr; vGlow=glow; vCore=core; vFade=f; vLc=mix(lcA,aB.z,aCorner.x); vDir=dir;
}`;
const TR_FS=`
precision mediump float;
varying float vDist; varying float vAlong; varying float vGlow; varying float vCore; varying float vFade; varying float vLc;
varying vec2 vDir;
// uMode: 0 = |B| ramp (the page default), 1 = hue from the direction of B,
// 2 = silver, brightness from |B|. Only the screensaver sets 1 or 2.
uniform float uMode;
${glslRamp()}
float cov(float w,float d){ float we=max(w,1.0); return clamp(0.5*we+0.5-d,0.0,1.0)*(w/we); }
void main(){
  float dx=max(0.0,-vAlong);          // > 0 only inside the head cap
  float d=sqrt(dx*dx+vDist*vDist);
  vec3 col=ramp(vLc);
  if(uMode>0.5&&uMode<1.5){
    float h=atan(vDir.y,vDir.x)/6.2831853+0.5;
    col=clamp(abs(fract(h+vec3(0.0,2.0/3.0,1.0/3.0))*6.0-3.0)-1.0,0.0,1.0)*(0.35+0.75*vLc);
  } else if(uMode>1.5){
    col=vec3(0.80,0.86,0.96)*(0.25+0.9*vLc);
  }
  vec3 c=col*(vFade*(0.12*cov(vGlow,d)+0.55*cov(vCore,d)));
  gl_FragColor=vec4(c,max(c.r,max(c.g,c.b)));
}`;
