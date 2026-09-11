
    // atmosphere.vert.glsl — atmosphere shell, vertex stage
    //
    //   Pass the view-space normal and position to the fragment stage, which uses
    //   them for the fresnel rim. Standard model-view then projection transform.
    varying vec3 vNorm;varying vec3 vPos;
    void main(){vNorm=normalize(normalMatrix*normal);vPos=(modelViewMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*vec4(vPos,1.0);}
  