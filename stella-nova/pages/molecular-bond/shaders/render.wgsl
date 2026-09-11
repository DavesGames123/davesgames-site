// ============================================================================
//  render.wgsl · billboarded point-sprite renderer (WGSL)
// ----------------------------------------------------------------------------
//  Draws one camera-facing quad per particle by instancing: draw(6, count)
//  runs 6 vertices (two triangles) per instance. The vertex stage offsets the
//  quad corners in view space so every sprite faces the camera; the fragment
//  stage fades each sprite to a soft round dot. Colours come from compute.wgsl.
//
//  BINDINGS
//      @binding(0) RU u    uniforms: view, proj, pointSize, count
//      @binding(1) pos     particle positions (xyz, w=size multiplier)
//      @binding(2) col     per-particle RGBA from the compute pass
// ============================================================================
// Render uniforms: camera matrices, base sprite size, and the live count.
struct RU{view:mat4x4f,proj:mat4x4f,pointSize:f32,count:u32,p0:f32,p1:f32};
@group(0)@binding(0) var<uniform> u:RU;@group(0)@binding(1) var<storage,read> pos:array<vec4f>;@group(0)@binding(2) var<storage,read> col:array<vec4f>;
// Interpolated to the fragment stage: clip position, colour, quad uv, alpha.
struct V{@builtin(position) p:vec4f,@location(0) c:vec3f,@location(1) uv:vec2f,@location(2) a:f32};
// Vertex stage: expand instance ii into a view-space billboard quad.
@vertex fn vs(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32)->V{
  // The six quad corners and their matching uv coordinates.
  var cs=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  var us=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1));
  // Cull padding instances by emitting a degenerate, transparent vertex.
  var o:V;if(ii>=u.count){o.p=vec4f(0,0,-2,1);o.a=0;o.c=vec3f(0);o.uv=vec2f(0);return o;}
  // Transform the centre to view space, then offset corners so the quad faces us.
  let pp=pos[ii];let sz=u.pointSize*pp.w;let vp=u.view*vec4f(pp.xyz,1);
  o.p=u.proj*vec4f(vp.xyz+vec3f(cs[vi].x*sz,cs[vi].y*sz,0),1);o.c=col[ii].xyz;o.uv=us[vi];o.a=col[ii].w;return o;}
// Fragment stage: radial soft-edge falloff plus a faint core glow; discard the
// transparent corners so sprites read as round dots, not squares.
@fragment fn fs(i:V)->@location(0) vec4f{let d=length(i.uv-vec2f(.5))*2;let a=(1-smoothstep(.5,1,d))*i.a;if(a<.01){discard;}let g=exp(-d*d*3)*.15;return vec4f(i.c*(a+g),a+g);}