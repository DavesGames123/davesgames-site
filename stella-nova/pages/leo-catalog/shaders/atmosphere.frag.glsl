
      // atmosphere.frag.glsl — atmosphere shell fragment stage.
      // Fresnel term: transparent where the surface faces the camera, opaque at
      // the grazing rim, so the shell reads as a soft glow around the globe.
      uniform vec3 uColor; varying vec3 vN; varying vec3 vP;
      void main() {
        vec3 V = normalize(-vP);
        // Rim factor rises toward the silhouette edge.
        float f = 1.0 - max(dot(V, vN), 0.0);
        // Tighten the rim to a thin bright band.
        f = pow(f, 3.4);
        gl_FragColor = vec4(uColor, f * 0.35);
      }