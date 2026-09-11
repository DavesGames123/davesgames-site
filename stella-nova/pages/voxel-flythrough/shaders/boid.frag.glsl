#version 300 es
// boid.frag.glsl — swarm point, fragment stage
//
//   Shade each boid point: discard it if it is behind the terrain (compare the
//   boid's view depth against the scene depth in uDepth's alpha). Small boids
//   draw as a soft dot, larger ones as a flickering "falling code" glyph.
//   Colour runs matrix-green to cyan with speed; fog fades it into the distance.
//   Drawn with additive blending, so this only ever adds light.
precision highp float;
in float vVZ; in float vSeed; in float vT; in float vSize;
uniform sampler2D uDepth; uniform vec2 uRes; uniform float uGlow,uFog,uTime;
out vec4 o;
// Procedural 3x5 dot-matrix glyph, seeded per boid, for the falling-code look.
float glyph(vec2 uv,float seed){
  vec2 g=floor(uv*vec2(3.0,5.0)); float gi=g.x+g.y*3.0;
  float on=step(0.45, fract(sin((gi+1.0)*12.9898 + seed*78.233)*43758.5453));
  vec2 f=fract(uv*vec2(3.0,5.0))-0.5;
  return on*smoothstep(0.5,0.12,length(f));
}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float sceneVZ=texture(uDepth,uv).a*1300.0;
  if(vVZ > sceneVZ+0.6) discard;                       // occluded by terrain
  vec2 pc=gl_PointCoord;
  float dotR=exp(-dot(pc-0.5,pc-0.5)*7.0);
  float gseed=vSeed*9.0 + floor(uTime*7.0)*0.2;        // glyph flips over time → falling code
  float g=glyph(pc,gseed);
  float shape=mix(dotR, g, smoothstep(2.5,5.0,vSize)); // tiny→dot, bigger→glyph
  if(shape<0.02) discard;
  float fa=uFog*vVZ; float fog=exp(-fa-0.14*fa*fa);    // fade into the distance like the geometry
  vec3 col=mix(vec3(0.18,1.0,0.5), vec3(0.42,1.0,0.86), vT);   // matrix green → cyan with speed
  o=vec4(col*shape*(0.55+vSeed*0.6)*uGlow*fog, 1.0);
}
