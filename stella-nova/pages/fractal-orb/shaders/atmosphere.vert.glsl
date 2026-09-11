varying vec3 vNormal;varying vec3 vViewPosition;
void main(){vNormal=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.0);vViewPosition=-mv.xyz;gl_Position=projectionMatrix*mv;}
