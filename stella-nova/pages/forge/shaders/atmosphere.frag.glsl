
    // atmosphere.frag.glsl — atmosphere shell, fragment stage (fresnel rim glow)
    //
    //   The shell is drawn additively over the planet. Its opacity is a fresnel
    //   rim (bright where the surface turns away from the eye) modulated by how
    //   much that point faces the sun, so the lit limb glows and the dark side
    //   fades. Colour comes from uColor (set per planet type in main.js).
    //
    //       eye ─▶ ( planet )   rim = 1 - dot(view,normal)  → bright at the edge
    //               sunView ↘   sunFac dims the rim on the night side
    uniform vec3 uSunDir;uniform vec3 uColor;uniform float uIntensity;uniform float uPow;
    varying vec3 vNorm;varying vec3 vPos;
    void main(){
      // View direction in view space (camera is at the origin).
      vec3 viewDir=normalize(-vPos);
      // Fresnel term: 0 facing the eye, 1 at the grazing rim; uPow sharpens it.
      float rim=1.0-max(dot(viewDir,vNorm),0.0);
      rim=pow(rim,uPow);
      // Sun facing factor in view space, remapped to [0.5,1] so the night side
      // keeps a faint glow rather than going fully black.
      vec3 sunWorld=normalize(uSunDir);
      vec3 sunView=normalize((viewMatrix*vec4(sunWorld,0.0)).xyz);
      float sunFac=max(dot(vNorm,sunView),0.0)*.5+.5;
      // Opacity is rim glow scaled by intensity and sun facing; 0.65 caps it.
      float alpha=rim*uIntensity*sunFac;
      gl_FragColor=vec4(uColor,alpha*0.65);
    }
  