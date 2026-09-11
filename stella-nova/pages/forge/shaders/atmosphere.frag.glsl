
    uniform vec3 uSunDir;uniform vec3 uColor;uniform float uIntensity;uniform float uPow;
    varying vec3 vNorm;varying vec3 vPos;
    void main(){
      vec3 viewDir=normalize(-vPos);
      float rim=1.0-max(dot(viewDir,vNorm),0.0);
      rim=pow(rim,uPow);
      vec3 sunWorld=normalize(uSunDir);
      vec3 sunView=normalize((viewMatrix*vec4(sunWorld,0.0)).xyz);
      float sunFac=max(dot(vNorm,sunView),0.0)*.5+.5;
      float alpha=rim*uIntensity*sunFac;
      gl_FragColor=vec4(uColor,alpha*0.65);
    }
  