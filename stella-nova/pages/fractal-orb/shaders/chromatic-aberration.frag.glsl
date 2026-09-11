uniform sampler2D tDiffuse;uniform float uAmount;varying vec2 vUv;
void main(){
  vec4 base=texture2D(tDiffuse,vUv);
  float luma=max(base.r,max(base.g,base.b));
  float mask=smoothstep(0.01,0.1,luma);
  vec2 offset=(vUv-0.5)*uAmount;
  float r=texture2D(tDiffuse,vUv+offset).r;
  float g=texture2D(tDiffuse,vUv).g;
  float b=texture2D(tDiffuse,vUv-offset).b;
  gl_FragColor=vec4(mix(base.rgb,vec3(r,g,b),mask),1.0);
}
