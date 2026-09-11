
// ============================================================================
//  explosion.wgsl · single-pass volumetric explosion (WGSL, WebGPU)
// ----------------------------------------------------------------------------
//  A full-screen triangle runs the fragment stage once per pixel. Each pixel
//  builds a camera ray, clips it to a bounding sphere, then ray-marches a
//  procedural density field (fbm + spiral noise displacing a sphere SDF),
//  accumulating emissive fireball colour front-to-back. There is no geometry
//  and no compute pass: the whole explosion is evaluated in fs().
//
//  RAY-MARCH (fs)
//  --------------
//      ro ●───rd──▶        RaySphereIntersect() clips ray to bound → [near,far]
//         ╱  bound sphere ╲  t starts at near, steps while sum.a < ~1
//        (   •▶•▶•▶•▶•     )  at each step: d = mapScene(p)  (signed distance)
//         ╲  accumulate   ╱   when d < h: convert shell to colour, blend front-
//          ╲────────────╱     to-back; step size shrinks near the surface
//
//  DENSITY FIELD  (mapScene → VolumetricExplosion)
//  ----------------------------------------------
//      Sphere(p,4) SDF  +  fbm(high-freq detail)  +  SpiralNoiseC(swirl) · 2
//      mouseX rotates the field about Y; u.scale zooms it (dope-sheet driven).
//
//  BINDINGS (see main.js bind group)
//      @binding(0) Uniforms u   resolution/time/mouse/zoom + dope-sheet values
//      @binding(1) iChannel0    256x256 noise texture (value-noise source)
//      @binding(2) samp         linear repeat sampler
//
//  SECTION MAP  (jump with grep -n "<anchor>" explosion.wgsl)
//  ----------------------------------------------------------------------------
//      uniforms ............. "struct Uniforms"      the per-frame inputs
//      value noise .......... "fn noise"             texture-fetched 3D noise
//      fbm .................. "fn fbm"               4-octave fractal noise
//      swirl ................ "fn SpiralNoiseC"      rotating spiral turbulence
//      density field ........ "fn VolumetricExplosion"  sphere + noise combine
//      scene map ............ "fn mapScene"          rotate/scale then evaluate
//      fireball colour ...... "fn computeColor"      density/radius → emission
//      ray/sphere clip ...... "fn RaySphereIntersect"  bound the march
//      fragment march ....... "@fragment fn fs"      the accumulation loop
//      full-screen tri ...... "@vertex fn vs"        3-vertex covering triangle
// ============================================================================
struct Uniforms {
  resolution: vec2f,
  time: f32,
  mouseX: f32,
  zoom: f32,
  density_scale: f32,
  quality: f32,
  brightness: f32,
  seed: f32,
  scale: f32,
  _p0: f32, _p1: f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var iChannel0: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

// GLSL-style mod: WGSL's % follows sign of the dividend, this wraps positive.
fn glsl_mod(x:f32,y:f32)->f32{return x-y*floor(x/y);}

// 3D value noise sampled from the noise texture. The integer lattice cell is
// packed into a 2D texture lookup (the z plane offsets the uv), and the two
// fetched channels are blended along z with a smoothstep-eased fraction.
fn noise(x:vec3f)->f32{
  let p=floor(x);let f_raw=fract(x);let f=f_raw*f_raw*(3.0-2.0*f_raw);
  let uv=(p.xy+vec2f(37.0,17.0)*p.z)+f.xy;
  let rg=textureSampleLevel(iChannel0,samp,(uv+0.5)/256.0,0.0).yx;
  return 1.0-0.82*mix(rg.x,rg.y,f.z);
}
// Fractal Brownian motion: four noise octaves at rising frequency and falling
// weight, summed into the fine surface detail of the fireball.
fn fbm(p:vec3f)->f32{return noise(p*0.06125)*0.5+noise(p*0.125)*0.25+noise(p*0.25)*0.125+noise(p*0.4)*0.1;}
// Signed distance to a sphere of radius r centred at the origin.
fn Sphere(p:vec3f,r:f32)->f32{return length(p)-r;}

// Rotating spiral turbulence. Eight octaves each add a sin/cos ripple, then
// twist space by a fixed-angle rotation on two planes; u.time slowly drifts
// the phase so the swirl churns. Ridge-free (no abs) for a smooth billow.
fn SpiralNoiseC(p_in:vec3f)->f32{
  let nudge=4.0;let normalizer=1.0/sqrt(1.0+nudge*nudge);
  var n=-glsl_mod(u.time*0.2,-2.0);var iter=2.0;var p=p_in;
  for(var i=0;i<8;i++){
    // smooth — no abs(), removes the ridged/topographic contour lines
    n+=(sin(p.y*iter)+cos(p.x*iter))/iter;
    p=vec3f((p.x+p.y*nudge)*normalizer,(p.y-p.x*nudge)*normalizer,p.z);
    p=vec3f((p.x+p.z*nudge)*normalizer,p.y,(p.z-p.x*nudge)*normalizer);
    iter*=1.733733;
  }
  return n;
}

// The density field. A radius-4 sphere SDF is perturbed by high-frequency fbm
// and a strong spiral swirl, so its surface breaks into billowing detail. The
// seed offsets every sample so each explosion looks different.
fn VolumetricExplosion(p:vec3f)->f32{
  // Per-seed spatial offset: shifts the noise domain so seeds diverge.
  let so=vec3f(u.seed*100.0,u.seed*73.0,u.seed*37.0);
  var r=Sphere(p,4.0);
  r+=fbm((p+so)*50.0);
  r+=SpiralNoiseC(p.zxy*0.4132+333.0+so*0.01)*2.0;
  return r;
}

// Scene map: place the sample point into the field's frame, then evaluate it.
// Mouse drag rotates the field about Y; the dope-sheet scale zooms it, kept
// distance-correct by dividing the point and multiplying the result by s.
fn mapScene(p_in:vec3f)->f32{
  // Mouse rotation only — no time rotation
  let a=u.mouseX*0.008*3.14159265;
  let ca=cos(a);let sa=sin(a);
  let p=vec3f(ca*p_in.x+sa*p_in.z,p_in.y,-sa*p_in.x+ca*p_in.z);
  // Scale from dope sheet
  let s=u.scale;
  return VolumetricExplosion(p/s)*s;
}

// Map accumulated density and distance-to-centre to emissive colour. Low
// density reads as hot white, high density as deep ember red; a second mix
// cools the outer shell toward the edge tint so the core stays brightest.
fn computeColor(density:f32,radius:f32)->vec3f{
  // Body gradient: white-hot core to dark ember as density rises.
  var result=mix(vec3f(1.0,0.9,0.8),vec3f(0.4,0.15,0.1),density);
  let colCenter=12.0*vec3f(0.8,1.0,1.0);
  let colEdge=3.0*vec3f(0.48,0.53,0.5);
  result*=mix(colCenter,colEdge,min((radius+0.05)/0.9,1.15));
  return result;
}

// Squared radius of the sphere that bounds the whole effect. It tracks the
// dope-sheet scale (radius 4 grown by the scale and a 1.3 safety margin) so
// the march never starts before the fireball can possibly appear.
fn boundRadiusSq()->f32{
  let r=4.0*u.scale*1.3;
  return r*r;
}

// Ray/bounding-sphere intersection. Writes the two hit distances through the
// pointers and returns false when the ray misses, so fs() can skip empty
// pixels instead of marching them.
fn RaySphereIntersect(org:vec3f,dir:vec3f,near:ptr<function,f32>,far:ptr<function,f32>)->bool{
  let b=dot(dir,org);let c=dot(org,org)-boundRadiusSq();
  let delta=b*b-c;if(delta<0.0){return false;}
  let sq=sqrt(delta);*near=-b-sq;*far=-b+sq;return *far>0.0;
}

// Fragment stage: build the camera ray for this pixel and ray-march the volume.
@fragment fn fs(@builtin(position) fragCoord:vec4f)->@location(0) vec4f{
  // Screen uv, and the ray direction rd through this pixel (perspective by /y).
  let uv=fragCoord.xy/u.resolution;
  let rd=normalize(vec3f((fragCoord.xy-0.5*u.resolution)/u.resolution.y,1.0));
  // Camera origin pulls back with zoom so scrolling dollies the view.
  let ro=vec3f(0.0,0.0,-6.0+u.zoom*1.6);
  // March accumulators: ld/w local density, td transmittance, t ray distance,
  // d_outer last distance (early-out), h the surface threshold.
  var ld=0.0;var td=0.0;var w=0.0;var d_outer=1.0;var t=0.0;let h=0.1;
  // sum is premultiplied RGBA colour; min/max are the bounding-sphere hits.
  var sum=vec4f(0.0);var min_dist=0.0;var max_dist=0.0;

  // Only march pixels whose ray meets the bounding sphere.
  if(RaySphereIntersect(ro,rd,&min_dist,&max_dist)){
    // Jump the ray start forward to the sphere entry (step() guards t<near).
    t=min_dist*step(t,min_dist);
    // Quality tier picks the step budget: 56 / 86 / 128 iterations.
    let maxIter=select(select(56,86,u.quality>0.5),128,u.quality>1.5);
    for(var i=0;i<128;i++){
      if(i>=maxIter){break;}
      let pos=ro+t*rd;
      // Stop when opaque, past the volume, or the field went flat/empty.
      if(td>0.9||d_outer<0.12*t||t>10.0||sum.a>0.99||t>max_dist){break;}
      // Signed distance at this sample, floored so the march always advances.
      var d=mapScene(pos);
      d=max(d,0.04);
      // Distance to the origin light, and a warm point-light colour.
      let ldst=-pos;let lDist=max(length(ldst),0.001);
      let lightColor=vec3f(1.0,0.5,0.25);
      // Add glow that falls off very fast with cube-of-distance, so the core lights.
      sum=vec4f(sum.rgb+lightColor/exp(lDist*lDist*lDist*0.08)/8.0,sum.a);
      // Inside the shell: turn depth-below-surface into density and composite.
      if(d<h){
        ld=h-d;w=(1.0-td)*ld;td+=w+1.0/200.0;
        var col=vec4f(computeColor(td,lDist),td);
        // Self-illumination boost near the bright core.
        sum+=sum.a*vec4f(sum.rgb,0.0)*0.5/lDist;
        // Premultiply alpha, then blend this sample under what is already there.
        col=vec4f(col.rgb,col.a*0.2);col=vec4f(col.rgb*col.a,col.a);
        sum=sum+col*(1.0-sum.a);
      }
      // Bleed a little density every step so thin haze still registers.
      td+=1.0/70.0;
      // Dither the step from the noise texture to break up banding.
      let uvd=vec2f(uv.x*280.0,uv.y*120.0);
      let dith=textureSampleLevel(iChannel0,samp,vec2f(uvd.y,-uvd.x+0.5*sin(4.0*u.time+uvd.y*4.0))/256.0,0.0).r;
      let d_step=abs(d)*(0.8+0.08*dith);
      d_outer=d;
      // Adaptive advance: big empty-space strides, small steps near the surface.
      t+=max(d_step*0.1*max(min(length(ldst),d_step),2.0),0.02);
    }
    // Tone the accumulation: density scale, brightness, clamp, then smoothstep.
    sum*=1.0/exp(ld*0.2)*1.5*u.density_scale;
    sum=vec4f(sum.xyz*u.brightness,sum.a);
    sum=clamp(sum,vec4f(0.0),vec4f(1.0));
    sum=vec4f(sum.xyz*sum.xyz*(3.0-2.0*sum.xyz),sum.a);
  }
  // Opaque black background; only the fireball colour survives.
  return vec4f(sum.xyz,1.0);
}
// Vertex stage: emit one oversized triangle that covers the whole screen, so
// the fragment shader runs on every pixel with no vertex buffer.
struct VSOut{@builtin(position) pos:vec4f};
@vertex fn vs(@builtin(vertex_index) vi:u32)->VSOut{
  var p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
  var o:VSOut;o.pos=vec4f(p[vi],0,1);return o;
}
