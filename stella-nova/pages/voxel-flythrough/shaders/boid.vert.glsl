#version 300 es
precision highp float;
uniform sampler2D uPos,uVel; uniform float uW;
uniform vec3 uRO,uRight,uUp,uFwd; uniform float uFocal,uPoint; uniform vec2 uRes;
out float vVZ; out float vSeed; out float vT; out float vSize;
void main(){
  int W=int(uW); int id=gl_VertexID;
  vec2 uv=(vec2(float(id-(id/W)*W),float(id/W))+0.5)/uW;
  vec3 pos=textureLod(uPos,uv,0.0).xyz; vec4 V=textureLod(uVel,uv,0.0); vec3 vel=V.xyz; float seed=V.w;
  vec3 rel=pos-uRO; float vz=dot(rel,uFwd);
  vec2 sp=uFocal*vec2(dot(rel,uRight),dot(rel,uUp))/max(vz,0.001);
  float aspect=uRes.x/uRes.y;
  gl_Position = vz>0.05 ? vec4(sp.x/aspect, sp.y, 0.0, 1.0) : vec4(2.0,2.0,2.0,1.0);
  float ps = clamp((0.45 + seed*1.0)*uPoint/max(vz,0.001), 1.0, 7.0);   // small, lightly varied
  gl_PointSize=ps; vSize=ps;
  vVZ=vz; vSeed=seed; vT=clamp(length(vel)*0.04,0.0,1.0);
}
