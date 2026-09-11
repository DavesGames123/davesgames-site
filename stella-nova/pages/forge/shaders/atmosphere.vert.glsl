
    varying vec3 vNorm;varying vec3 vPos;
    void main(){vNorm=normalize(normalMatrix*normal);vPos=(modelViewMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*vec4(vPos,1.0);}
  