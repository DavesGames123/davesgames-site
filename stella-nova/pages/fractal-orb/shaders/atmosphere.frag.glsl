uniform vec3 uColor;uniform float uGlow;uniform float uLevel;
varying vec3 vNormal;varying vec3 vViewPosition;
void main(){
  vec3 n=normalize(vNormal);vec3 v=normalize(vViewPosition);
  float vdn=max(dot(n,v),0.0);
  float edgeFade=smoothstep(0.0,0.15,vdn);
  float innerFadePoint=clamp(1.0-uLevel,0.0,0.99);
  float centerFade=smoothstep(1.0,innerFadePoint,vdn);
  float alpha=edgeFade*centerFade*uGlow;
  gl_FragColor=vec4(uColor,alpha);
}
