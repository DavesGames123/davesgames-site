
      // atmosphere.vert.glsl — atmosphere shell vertex stage.
      // Passes the view-space normal and position so the fragment stage can
      // compute a fresnel rim glow around the globe.
      varying vec3 vN; varying vec3 vP;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        vP = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }