
      // earth.vert.glsl — Earth globe vertex stage.
      // Passes the texture uv and the object-space normal (the unit sphere
      // position) to the fragment stage for the day/night terminator shading.
      varying vec2 vUv; varying vec3 vN;
      void main() {
        vUv = uv; vN = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }