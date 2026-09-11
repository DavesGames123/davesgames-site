varying vec3 vLocalPosition;
varying vec3 vNormal;
varying vec3 vViewPosition;
void main(){
  vLocalPosition=position;
  vNormal=normalize(normalMatrix*normal);
  vec4 mvPos=modelViewMatrix*vec4(position,1.0);
  vViewPosition=-mvPos.xyz;
  gl_Position=projectionMatrix*mvPos;
}
