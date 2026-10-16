#version 300 es
// ============================================================================
//  splat.frag.glsl — pointer and burst forcing: Gaussian splats
// ----------------------------------------------------------------------------
//  Add up to MAX_SPL Gaussian splats to one field in one pass. main.js runs it
//  twice per batch: uKind 0 on the velocity, uKind 1 on the dye. A splat is
//  three vec4 uniforms:
//      uSplatP  x, y (uv, y up), radius r (height units), mode
//      uSplatF  force: vx, vy in cells/s (mode 0), or swirl rate in x (mode 1)
//      uSplatC  dye colour rgb
//  The weight is exp(-d^2 / r^2), with d.x scaled by uAspect so a splat is
//  round on screen. Mode 0 pushes along uSplatF.xy; mode 1 turns the flow
//  round the centre; mode 2 adds dye only. Barrier cells pass through.
//
//  This is a JS template literal: main.js fills MAX_SPL before compiling.
// ============================================================================
precision highp float;in vec2 vUV;out vec4 fragColor;
uniform sampler2D uTarget,uBarrier;uniform float uAspect;uniform int uKind,uCount;
uniform vec4 uSplatP[${MAX_SPL}],uSplatF[${MAX_SPL}],uSplatC[${MAX_SPL}];
void main(){vec2 uv=vUV;vec4 base=texture(uTarget,uv);
  if(texture(uBarrier,uv).r>.1){fragColor=base;return;}
  for(int i=0;i<${MAX_SPL};i++){if(i>=uCount)break;
    vec2 d=uv-uSplatP[i].xy;d.x*=uAspect;float r=uSplatP[i].z;float g=exp(-dot(d,d)/(r*r));int m=int(uSplatP[i].w+.5);
    if(uKind==0){
      if(m==0)base.xy+=uSplatF[i].xy*g;
      else if(m==1){float l=length(d);if(l>1e-4)base.xy+=vec2(-d.y,d.x)/l*uSplatF[i].x*g;}
    }else base.rgb+=uSplatC[i].rgb*g;}
  fragColor=base;}
