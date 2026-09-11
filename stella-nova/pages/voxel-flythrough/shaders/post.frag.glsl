#version 300 es
// ============================================================================
//  post.frag.glsl — CRT post pass (composite the scene to screen)
// ----------------------------------------------------------------------------
//  Take the raymarched scene texture and finish it: FXAA edge smoothing, a
//  faint chromatic split, a thresholded multi-ring bloom for the CRT glow, a
//  hue-preserving tonemap, and optional scanlines plus a vignette.
//
//  PIPELINE
//      uScene ─▶ fxaa ─▶ chroma split ─▶ + bloom ─▶ tonemap ─▶ scanlines/vignette
//
//  SECTION MAP   (grep -n "<anchor>" post.frag.glsl)
//      tonemap ...... "vec3 tonemap"   luminance tonemap that keeps chroma
//      fxaa ......... "vec3 fxaa"      edge-directed antialiasing
//      main ......... "void main"      chroma, bloom, tone, scanlines, vignette
// ============================================================================
precision highp float;
out vec4 outColor;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uBloom, uScan;
uniform int uScanOn;

// hue-preserving tonemap: tonemap luminance, keep chroma → neon stays neon
vec3 tonemap(vec3 c){
  float l=dot(c,vec3(0.2126,0.7152,0.0722));
  float lt=l/(1.0+l*0.55);
  c = (l>1e-5) ? c*(lt/l) : vec3(0.0);
  float l2=dot(c,vec3(0.2126,0.7152,0.0722));
  c=mix(vec3(l2),c,1.10);                 // saturation lift
  return clamp(c,0.0,1.0);
}

// FXAA (console edition) — softens jagged edges, incl. far silhouettes in the background
vec3 fxaa(vec2 uv, vec2 px){
  const vec3 LUM=vec3(0.299,0.587,0.114);
  vec3 rgbM =texture(uScene,uv).rgb;
  vec3 rgbNW=texture(uScene,uv+vec2(-1.0,-1.0)*px).rgb;
  vec3 rgbNE=texture(uScene,uv+vec2( 1.0,-1.0)*px).rgb;
  vec3 rgbSW=texture(uScene,uv+vec2(-1.0, 1.0)*px).rgb;
  vec3 rgbSE=texture(uScene,uv+vec2( 1.0, 1.0)*px).rgb;
  float lM=dot(rgbM,LUM),lNW=dot(rgbNW,LUM),lNE=dot(rgbNE,LUM),lSW=dot(rgbSW,LUM),lSE=dot(rgbSE,LUM);
  float lMin=min(lM,min(min(lNW,lNE),min(lSW,lSE)));
  float lMax=max(lM,max(max(lNW,lNE),max(lSW,lSE)));
  vec2 dir=vec2(-((lNW+lNE)-(lSW+lSE)), ((lNW+lSW)-(lNE+lSE)));
  float red=max((lNW+lNE+lSW+lSE)*0.25*0.125, 1.0/128.0);
  float rcp=1.0/(min(abs(dir.x),abs(dir.y))+red);
  dir=clamp(dir*rcp,-8.0,8.0)*px;
  vec3 rA=0.5*(texture(uScene,uv+dir*(1.0/3.0-0.5)).rgb + texture(uScene,uv+dir*(2.0/3.0-0.5)).rgb);
  vec3 rB=rA*0.5 + 0.25*(texture(uScene,uv+dir*-0.5).rgb + texture(uScene,uv+dir*0.5).rgb);
  float lB=dot(rB,LUM);
  return (lB<lMin||lB>lMax)? rA : rB;
}

void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 px=1.0/uRes;
  // Start from the FXAA-resolved scene, then split R and B slightly for a lens
  // chromatic shimmer.
  // anti-aliased scene (FXAA), with a subtle chromatic shimmer on top
  vec3 c=fxaa(uv,px);
  vec2 ca=(uv-0.5)*0.0035;
  c.r=mix(c.r, texture(uScene,uv+ca).r, 0.5);
  c.b=mix(c.b, texture(uScene,uv-ca).b, 0.5);

  // bloom: thresholded multi-ring disk blur — wide halo for a broad CRT glow
  vec3 b=vec3(0.0); float wsum=0.0;
  const int N=14;
  for(int i=0;i<N;i++){
    float a=6.2831853*float(i)/float(N);
    vec2 d=vec2(cos(a),sin(a));
    for(int r=1;r<=6;r++){
      float rad=float(r)*5.5;                 // reaches ~33px → much wider edge glow
      vec3 s=texture(uScene,uv+d*px*rad).rgb;
      vec3 hi=max(s-0.66,0.0);
      float w=1.0/float(r);
      b+=hi*w; wsum+=w;
    }
  }
  b/=max(wsum,1e-4);
  c += b*uBloom*2.2;

  // Tonemap, then optional CRT scanlines and a corner vignette.
  c=tonemap(c*1.1);

  if(uScanOn==1){
    float s=1.0 - uScan*pow(0.5+0.5*sin(3.14159265*gl_FragCoord.y), 2.0);
    c*=s;
    c*=0.985 + 0.015*sin(uv.x*3.14159);
  }
  // vignette
  vec2 q=uv;
  c*=0.55+0.45*pow(16.0*q.x*q.y*(1.0-q.x)*(1.0-q.y),0.16);

  outColor=vec4(c,1.0);
}
