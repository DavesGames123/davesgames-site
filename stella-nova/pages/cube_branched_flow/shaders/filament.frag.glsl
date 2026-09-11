// filament.frag.glsl — filament ribbon shading + occlusion, fragment stage
//
//   Shades one pixel of a ribbon. Across the ribbon (v_edge in -1..1) it builds
//   a soft core-plus-glow falloff; along the ribbon (v_along, root to tip) it
//   ramps hue from root to tip and adds a hot color where the pixel is bright.
//   Before shading it tests the SDF depth texture: if the pixel is farther than
//   the solid surface at that screen position, it is behind the cube and is
//   discarded, so the surface occludes the filaments.
//
//     sample u_sdfDist ─▶ sdfT ; if myT > sdfT + 1  ─▶ discard (behind surface)
//     v_edge ─▶ core/glow falloff ; v_along ─▶ root→tip hue ; heat ─▶ hot tint
//
//   Uniforms come from main.js: hue/saturation/value, hot-core controls, ring
//   spread, gradient, per-pass brightness/width, camera, and the depth texture.
#version 300 es
precision highp float;
in float v_edge,v_along,v_bright,v_ringPhase;
in vec3 v_wpos;
uniform float u_rootHue,u_tipHue,u_sat,u_val;
uniform float u_hotHue,u_hotThresh,u_hotInt;
uniform float u_ringSpread,u_grad,u_bright;
uniform vec3 u_cam;
uniform sampler2D u_sdfDist;
uniform vec2 u_res;
out vec4 outColor;
// HSV to RGB.
vec3 hsvRgb(float h,float s,float v){
  vec3 p=abs(fract(vec3(h)+vec3(0.,.667,.333))*6.-3.);
  return v*mix(vec3(1.),clamp(p-1.,0.,1.),s);}
void main(){
  // Occlusion: decode the SDF depth at this pixel; discard if behind the solid.
  vec2 uv=gl_FragCoord.xy/u_res;
  float sdfT=texture(u_sdfDist,uv).r*500.;
  float myT=length(v_wpos-u_cam);
  if(myT>sdfT+1.)discard;
  // Cross-ribbon falloff: p is edge nearness, s the core, h the sharp hotline.
  float p=1.-abs(v_edge);float s=p*p;float h=s*s*p;
  float lum=v_bright*(.55+.75*s+.9*h);
  float a=(s*.5+h*.5)*v_bright;
  // Per-filament hue offset, then a root-to-tip hue gradient along the length.
  float rh=v_ringPhase*u_ringSpread;
  vec3 rootC=hsvRgb(u_rootHue+rh,u_sat,u_val);
  vec3 tipC=hsvRgb(u_tipHue+rh,u_sat,u_val);
  vec3 baseC=mix(rootC,mix(rootC,tipC,v_along),u_grad);
  // Blend toward a hot color where the pixel is bright, then output premultiplied.
  float heat=smoothstep(u_hotThresh,1.,lum)*u_hotInt;
  vec3 hotC=hsvRgb(u_hotHue+rh*.5,1.,1.);
  vec3 c=mix(baseC,hotC,heat);
  outColor=vec4(c*a*u_bright,1.);}
