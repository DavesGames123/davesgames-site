// orb.frag.glsl — orb volume, fragment stage (the ray-marcher)
//
//   For each pixel on the sphere: build a ray from the camera through the
//   fragment's local position, clip it to the sphere, then march it, summing
//   emitted light from a folded fractal density field.
//
//     ro ●───rd──▶  getVolumeBounds() clips ray to sphere -> [tNear, tFar]
//                   traceEnergy() steps t from tNear to tFar (<=64 steps)
//                   at each step: d = evaluateStructure(p)  (fractal density)
//                   emission += color(d) * d ; front-to-back accumulate
//
//   Uniforms are driven from main.js (see uDensity, uFractalIters, ...).
uniform float uTime;
uniform vec3 uLocalCamPos;
uniform vec3 uPrimaryColor;
uniform vec3 uSecondaryColor;
uniform float uDensity;
uniform float uFractalIters;
uniform float uFractalScale;
uniform float uFractalDecay;
uniform float uInternalAnim;
uniform float uSmoothness;
uniform float uAsymmetry;
uniform float uAtmosphereGlow;

varying vec3 vLocalPosition;
varying vec3 vNormal;
varying vec3 vViewPosition;

// Fold space repeatedly (rotate, square, invert) to build a fractal, and return
// an accumulated density. uFractalIters controls depth; the animation twist and
// asymmetry rotations make it churn and break symmetry.
float evaluateStructure(vec3 pos){
  float densityAcc=0.0;
  vec3 anchor=pos;
  float animTime=uTime*uInternalAnim;
  float s=sin(animTime),c=cos(animTime);
  mat2 rotAnim=mat2(c,s,-s,c);
  float a=0.5*uAsymmetry;
  mat2 rotAsym1=mat2(cos(a),sin(a),-sin(a),cos(a));
  float b=0.3*uAsymmetry;
  mat2 rotAsym2=mat2(cos(b),sin(b),-sin(b),cos(b));
  for(int step=0;step<12;++step){
    if(float(step)>=uFractalIters)break;
    pos.xy*=rotAnim;pos.yz*=rotAnim;
    pos.xz*=rotAsym1;pos.yz*=rotAsym2;
    pos+=vec3(0.05,-0.02,0.03)*uAsymmetry;
    vec3 foldedPos=sqrt(pos*pos+uSmoothness);
    float magnitudeSq=max(dot(foldedPos,foldedPos),0.00001);
    pos=(uFractalScale*foldedPos/magnitudeSq)-uFractalScale;
    float ySq=pos.y*pos.y,zSq=pos.z*pos.z,yz2=2.0*pos.y*pos.z;
    pos.yz=vec2(ySq-zSq,yz2);
    pos=vec3(pos.z,pos.x,pos.y);
    densityAcc+=exp(uFractalDecay*abs(dot(pos,anchor)));
  }
  return densityAcc*0.5;
}

// Ray/sphere intersection. Returns the two hit distances, or negative if the
// ray misses, so the marcher knows where to start and stop.
vec2 getVolumeBounds(vec3 origin,vec3 dir,float radius){
  float b=dot(origin,dir),c=dot(origin,origin)-radius*radius;
  float discriminant=b*b-c;
  if(discriminant<0.0)return vec2(-1.0);
  float root=sqrt(discriminant);
  return vec2(-b-root,-b+root);
}

// March the ray through the volume, front to back, accumulating emitted light.
// Step size grows where the field is thin (exp term) to save samples.
vec3 traceEnergy(vec3 origin,vec3 dir,vec2 limits){
  float currentDepth=limits.x,marchStep=0.02;
  vec3 finalEnergy=vec3(0.0);
  float fieldVal=0.0;
  for(int i=0;i<64;i++){
    currentDepth+=marchStep*exp(-2.0*fieldVal);
    if(currentDepth>limits.y)break;
    vec3 samplePoint=origin+currentDepth*dir;
    fieldVal=evaluateStructure(samplePoint);
    float vSq=fieldVal*fieldVal;
    float gradientBlend=smoothstep(0.0,0.4,fieldVal);
    vec3 currentGradient=mix(uSecondaryColor,uPrimaryColor,gradientBlend);
    vec3 emission=currentGradient*(fieldVal*1.8+vSq*1.0);
    finalEnergy=0.99*finalEnergy+(0.08*uDensity)*emission;
  }
  return finalEnergy;
}

// Build the view ray in local space, spin it slowly over time, clip to the
// sphere, march it, then shade the rim and write colour with density-based alpha.
void main(){
  vec3 rayOrig=uLocalCamPos;
  vec3 rayDir=normalize(vLocalPosition-uLocalCamPos);
  float t=uTime*0.001,s=sin(t),c=cos(t);
  mat2 rotXZ=mat2(c,s,-s,c);
  rayOrig.xz*=rotXZ;rayDir.xz*=rotXZ;
  vec2 limits=getVolumeBounds(rayOrig,rayDir,2.0);
  if(limits.x<0.0)discard;
  vec3 volumeColor=traceEnergy(rayOrig,rayDir,limits);
  vec3 normal=normalize(vNormal);
  vec3 viewDir=normalize(vViewPosition);
  float facingRatio=max(dot(normal,viewDir),0.0);
  float edgeAA=smoothstep(0.0,0.05,facingRatio);
  vec3 finalColor=0.5*log(1.0+volumeColor);
  finalColor=clamp(finalColor,0.0,1.0)*edgeAA;
  float maxLuma=max(finalColor.r,max(finalColor.g,finalColor.b));
  float alpha=clamp(maxLuma*1.5,0.0,1.0)*edgeAA;
  gl_FragColor=vec4(finalColor,alpha);
}
