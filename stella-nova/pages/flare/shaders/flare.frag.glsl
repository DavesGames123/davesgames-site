#version 300 es
// flare.frag.glsl — animated lens-flare / plasma streak, fragment stage
//
//   For each pixel it sums the light of many small "particles" streaming from
//   one origin. Each particle iteration shifts the sampling position along a
//   trail, tints it a rotating hue, modulates brightness with a flicker, warps
//   the trail width with the nebula noise texture, and adds an inverse-distance
//   falloff. The accumulated colour is squared for contrast and tanh-tonemapped.
//
//     origin (u_flarePos)
//         ●╲
//          ╲╲   for i in 0..u_particleCount:
//           ╲╲    hue    = cos(sin(i)·C + u_colorShift)
//            ╲╲   bright = u_intensity · exp(flicker)
//             ╲╲  ns     = noise(u_ch0) → trail width warp
//              ╲╲ falloff= 1 / (|stretched pos| · 1e4)
//               ╲ colorSum += hue·bright·falloff ; advance pos along trail
//
//   Uniforms come from main.js per instance (u_flarePos, u_intensity, the trail
//   and flicker controls, u_colorShift, u_noiseStrength).
precision highp float;
uniform vec2  u_res;
uniform float u_time;
uniform sampler2D u_ch0;
uniform vec2  u_flarePos;
uniform float u_intensity;
uniform float u_flickerSpeed;
uniform float u_flickerAmt;
uniform float u_trailLength;
uniform float u_trailSpread;
uniform float u_trailWidth;
uniform float u_particleCount;
uniform float u_colorShift;
uniform float u_noiseStrength;
out vec4 fragColor;
void main(){
  // Flare origin in pixels (y flipped to screen space), then this pixel's
  // offset from it, scaled by height so the shape is aspect-independent.
  vec2 origin=vec2(u_flarePos.x,1.-u_flarePos.y)*u_res;
  vec2 pos=(gl_FragCoord.xy-origin)/u_res.y;
  // C is a fixed (1,2,3) basis that spreads the per-channel hue and spacing.
  vec4 C=vec4(1.,2.,3.,0.);
  // Global flicker phase, biased by height so the streak shimmers along y.
  float phase=u_flickerSpeed*u_time+pos.y*0.25;
  vec4 colorSum=vec4(0.);
  // Accumulate one particle per iteration, up to the count control.
  for(float i=0.;i<50.;i++){
    if(i>=u_particleCount)break;
    // Per-particle weight and rotating hue.
    vec4 W=sin(i)*C;
    vec4 hue=cos(W+u_colorShift)+1.;
    // Brightness with an exponential flicker term.
    float bright=u_intensity*exp(u_flickerAmt*sin(i+i*phase));
    // Sample the nebula noise (scrolling) to warp this particle's trail width.
    vec2 nuv=pos/exp(W.x)+vec2(i,u_time*u_flickerSpeed)/8.;
    float ns=texture(u_ch0,fract(nuv)).r*40.*u_noiseStrength;
    ns=max(ns,0.01);
    // Stretch the position anisotropically, then an inverse-distance falloff
    // makes a thin bright streak that fades with distance from the core.
    vec2 ap=max(pos,pos/vec2(u_trailWidth,ns));
    float falloff=1./(length(ap)*1e4);
    colorSum+=hue*bright*falloff;
    // Step the sampling point along the trail for the next particle.
    pos.x+=u_trailLength*0.02;
    pos.y+=u_trailSpread*0.015*cos(i*(C.z+8.+i)+2.*phase);
  }
  // Faint coloured background gradient, then square for contrast and tanh
  // tonemap so bright cores roll off instead of clipping.
  vec4 bg=pos.x*(C-1.)*0.018;
  fragColor=vec4(tanh((bg+colorSum*colorSum).rgb),1.);
}
