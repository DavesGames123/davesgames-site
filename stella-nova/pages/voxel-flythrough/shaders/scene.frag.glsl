#version 300 es
// ============================================================================
//  scene.frag.glsl — voxel field, fragment stage (the raymarcher)
// ----------------------------------------------------------------------------
//  Per pixel: build a camera ray, DDA-step through the integer voxel grid until
//  a solid cell is hit, then shade that cell face with lighting, ambient
//  occlusion, and glowing exposed edges. Distance fades to black; the alpha
//  channel carries view-space depth for the boid pass and the CRT post pass.
//
//  DDA GRID TRAVERSAL  (amanatides-woo)
//  -----------------------------------
//      ro ●──rd──▶  step to the nearest cell boundary each iteration:
//        ┌──┬──┬──┐   mask = which axis boundary (dis) is closest
//        │  │▓▓│  │   dis += mask*dlt ; pos += mask*rs   (advance one cell)
//        └──┴──┴──┘   stop when solid(pos), a far cap, or uMaxSteps
//
//  DENSITY: fBm value noise minus a height slope and threshold; solid where it
//  is positive. This function is duplicated in main.js (densJS) and
//  boid-sim.frag.glsl and all three must agree. uClearR carves an empty bubble
//  around the camera so the eye never sits inside a wall.
//
//  EDGE TEST: an edge is drawn only where the in-plane neighbour cell is empty
//  (a silhouette) or the cell above it is solid (a concave seam); coplanar
//  interior grid lines stay hidden.
//
//  SECTION MAP   (grep -n "<anchor>" scene.frag.glsl)
//      palette ...... "const vec3 PAL"  the voxel colour set
//      noise ........ "float hash13"    value-noise basis
//      density ...... "float density"   the signed voxel field
//      solid ........ "bool solid"      cell occupancy (+ camera bubble)
//      colour ....... "vec3 voxColor"   per-voxel hue from iso-bands
//      main ......... "void main"       ray build, DDA, face shading
// ============================================================================
precision highp float;
out vec4 outColor;
uniform vec2 uRes;
uniform vec3 uRO, uRight, uUp, uFwd;
uniform float uFocal;
uniform float uMorphTime;
uniform vec3 uSeedVec;
uniform float uRegion;
uniform float uFreq, uHeight, uThresh, uSlope, uMorphAmt, uClearR;
uniform int uOct, uMaxSteps;
uniform float uEdgeGlow, uEdgeW, uBaseBright, uSat, uFog;
uniform int uDuotone;

const vec3 PAL[8]=vec3[8](
  vec3(0.130,0.880,1.000),  // 0 cyan
  vec3(0.160,0.470,1.000),  // 1 blue
  vec3(0.090,0.800,0.720),  // 2 teal
  vec3(1.000,0.520,0.140),  // 3 orange
  vec3(1.000,0.800,0.250),  // 4 gold
  vec3(0.300,0.920,0.430),  // 5 green
  vec3(0.600,0.340,1.000),  // 6 purple
  vec3(0.130,0.880,1.000)); // 7 (spare cyan)

// Hash-based value noise: hash13 gives a pseudo-random scalar per lattice point,
// vnoise trilinearly interpolates it with a smoothstep fade for smooth noise.
float hash13(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }
float vnoise(vec3 x){
  vec3 i=floor(x), f=fract(x); vec3 u=f*f*(3.0-2.0*f);
  float n000=hash13(i), n100=hash13(i+vec3(1,0,0)), n010=hash13(i+vec3(0,1,0)), n110=hash13(i+vec3(1,1,0));
  float n001=hash13(i+vec3(0,0,1)), n101=hash13(i+vec3(1,0,1)), n011=hash13(i+vec3(0,1,1)), n111=hash13(i+vec3(1,1,1));
  float x00=mix(n000,n100,u.x), x10=mix(n010,n110,u.x), x01=mix(n001,n101,u.x), x11=mix(n011,n111,u.x);
  return mix(mix(x00,x10,u.y), mix(x01,x11,u.y), u.z);
}
// Signed voxel density: fBm of value noise scaled by height, minus a vertical
// slope and a threshold. Positive is solid. The morph offset slides the noise
// so the terrain evolves. Kept identical to densJS in main.js.
float density(vec3 p){
  vec3 q=p*uFreq + uSeedVec;
  q += vec3(0.5,1.0,0.4)*(uMorphAmt*uMorphTime);
  float f=0.0, amp=0.5, fr=1.0, nrm=0.0;
  for(int i=0;i<8;i++){ if(i>=uOct) break; f+=amp*vnoise(q*fr); nrm+=amp; fr*=2.02; amp*=0.5; }
  f/=max(nrm,1e-4);
  return uHeight*f - uSlope*p.y - uThresh;
}
// Is a grid cell solid? Test density at its centre, but force empty inside the
// clear bubble of radius uClearR around the camera so the eye stays in open air.
bool solid(vec3 cell){
  vec3 c=cell+0.5;
  bool s = density(c) > 0.0;
  if(uClearR>0.5 && length(c-uRO)<uClearR) s=false;
  return s;
}
// Per-voxel colour. Quantize a coarse noise sample into iso-bands, hash each
// band to a hue, and pick from the palette so colour patches drape along the
// terrain's contours (duotone mode collapses to two hues).
vec3 voxColor(vec3 cell){
  // sample the SAME field that sculpts the terrain (coarse) so colour patches
  // drape along the geometry's form — boundaries fall on the shape's iso-contours
  vec3 qc = (cell+0.5)*uFreq*(14.0/max(uRegion,1.0)) + uSeedVec
          + vec3(0.5,1.0,0.4)*(uMorphAmt*uMorphTime);
  float cf = clamp(vnoise(qc), 0.0, 0.9999);
  int band = int(floor(cf*8.0));
  // permute iso-bands so adjacent levels get distinct hues (splashes, not a ramp)
  float h = hash13(vec3(float(band)*12.73 + 3.1) + uSeedVec*0.017);
  if(uDuotone==1){ return (h<0.5)?PAL[3]:PAL[0]; }   // orange / cyan
  // weighted: blue·cyan·teal primary  ·  orange·gold accents  ·  green·purple occasional
  int idx;
  if(h<0.26)       idx=0;   // cyan
  else if(h<0.48)  idx=1;   // blue
  else if(h<0.66)  idx=2;   // teal
  else if(h<0.80)  idx=3;   // orange
  else if(h<0.91)  idx=4;   // gold
  else if(h<0.965) idx=5;   // green
  else             idx=6;   // purple
  return PAL[idx];
}

void main(){
  // Build the camera ray for this pixel from the camera basis and focal length;
  // nudge near-zero components so the 1/rd reciprocals below stay finite.
  vec2 uv=(2.0*gl_FragCoord.xy-uRes)/uRes.y;
  vec3 rd=normalize(uv.x*uRight + uv.y*uUp + uFocal*uFwd);
  rd += step(abs(rd),vec3(1e-4))*1e-4;
  vec3 ro=uRO;

  // DDA setup: start cell, step direction per axis (rs), distance to cross one
  // cell per axis (dlt), and distance to the first boundary per axis (dis).
  vec3 pos=floor(ro);
  vec3 rs=sign(rd);
  vec3 ri=1.0/rd;
  vec3 dlt=min(abs(ri),1e4);
  vec3 dis=(pos-ro + 0.5 + rs*0.5)*ri;

  // Walk the grid: each step advances along whichever axis boundary is nearest
  // (mask), until a solid cell is hit, the ray runs past FAR, or steps run out.
  bvec3 mask=bvec3(false);
  bool hit=false;
  const float FAR=1300.0;
  for(int i=0;i<256;i++){
    if(i>=uMaxSteps) break;
    if(solid(pos)){ hit=true; break; }
    if(min(dis.x,min(dis.y,dis.z))>FAR) break;
    mask = lessThanEqual(dis.xyz, min(dis.yzx, dis.zxy));
    dis += vec3(mask)*dlt;
    pos += vec3(mask)*rs;
  }

  vec3 col=vec3(0.0); float vz=1e4;  // black void — distant geometry fades into it

  if(hit){
    // The face normal is the axis we last stepped along; recover the exact hit
    // distance t and point hp, and the view-space depth vz for compositing.
    vec3 n=-vec3(mask)*rs;
    vec3 mini=(pos-ro + 0.5 - 0.5*rs)*ri;
    float t=max(mini.x,max(mini.y,mini.z));
    vec3 hp=ro+rd*t;
    vz=dot(hp-ro,uFwd);
    vec3 fp=hp-pos;

    // face-local uv (the two axes that aren't the normal)
    vec2 fuv = mask.x ? fp.zy : (mask.y ? fp.xz : fp.xy);

    // tangent axes (the two that aren't the face normal)
    vec3 t1 = mask.x ? vec3(0,0,1) : vec3(1,0,0);
    vec3 t2 = mask.x ? vec3(0,1,0) : (mask.y ? vec3(0,0,1) : vec3(0,1,0));

    // neighbour occupancy: in-plane neighbours + the cells directly above them
    vec3 fc = pos + n;                       // empty cell in front of the face
    float a1=solid(fc+t1)?1.0:0.0, a2=solid(fc-t1)?1.0:0.0;   // above +t1 / -t1
    float a3=solid(fc+t2)?1.0:0.0, a4=solid(fc-t2)?1.0:0.0;   // above +t2 / -t2
    float s1=solid(pos+t1)?1.0:0.0, s2=solid(pos-t1)?1.0:0.0; // in-plane +t1 / -t1
    float s3=solid(pos+t2)?1.0:0.0, s4=solid(pos-t2)?1.0:0.0; // in-plane +t2 / -t2

    // an edge is EXPOSED (drawn) when its in-plane neighbour is empty (silhouette),
    // OR the cell above that neighbour is solid (concave seam against a wall).
    // It is hidden when the neighbour is solid and coplanar (flat interior grid line).
    float gPx=max(1.0-s1,a1), gNx=max(1.0-s2,a2);
    float gPy=max(1.0-s3,a3), gNy=max(1.0-s4,a4);

    // Feather each of the four face borders by uEdgeW, gated by the exposure
    // flags above, and take the strongest as the edge intensity.
    float w=uEdgeW;
    vec2 aaw=clamp(fwidth(fuv)*0.9, vec2(1e-4), vec2(0.5));  // screen footprint → analytic AA
    float bNx=1.0-smoothstep(w-aaw.x, w+aaw.x, fuv.x);
    float bPx=1.0-smoothstep(w-aaw.x, w+aaw.x, 1.0-fuv.x);
    float bNy=1.0-smoothstep(w-aaw.y, w+aaw.y, fuv.y);
    float bPy=1.0-smoothstep(w-aaw.y, w+aaw.y, 1.0-fuv.y);
    float edge=max(max(bNx*gNx,bPx*gPx),max(bNy*gNy,bPy*gPy));

    // ambient occlusion reuses the in-plane neighbour samples
    float side = mix(s2,s1,fuv.x) + mix(s4,s3,fuv.y);
    float ao = clamp(1.0 - 0.42*side, 0.32, 1.0);

    vec3 base=voxColor(pos);   // this voxel's colour — same hue as its glowing edges
    // FACE = a brighter, shaded version of that same colour
    vec3 albedo = base * mix(0.34, 0.68, uBaseBright);
    albedo = mix(vec3(dot(albedo,vec3(0.299,0.587,0.114))), albedo, uSat);

    // Shade the face: directional key light plus a sky term, times AO, on the
    // voxel's albedo; add the emissive edge glow; then fade both into black with
    // distance. The alpha out is normalized view depth for later passes.
    vec3 L=normalize(vec3(0.0,0.30,1.0));   // directly northward, low on the horizon
    float dif=clamp(dot(n,L),0.0,1.0);
    float sky=0.5+0.5*n.y;
    float shade = 0.50 + 0.55*dif + 0.16*sky;             // bright, with clear orientation gradient
    vec3 lit = albedo*shade*ao;

    vec3 glow=base*edge*edge*uEdgeGlow*2.0;                // bright emissive seam

    // DISTANCE FALLOFF: gentle near, fading fully into black so the most distant
    // geometry disappears (matches the original's mood).
    float fa=uFog*t;
    float fog=exp(-fa - 0.14*fa*fa);                      // 1 near → 0 far, gentle
    col = lit*fog + glow*fog;                             // everything fades into black with depth
  }
  outColor=vec4(col, clamp(vz/1300.0,0.0,1.0));
}
