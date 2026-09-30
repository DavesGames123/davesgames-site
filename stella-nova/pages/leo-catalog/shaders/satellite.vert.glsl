
      // satellite.vert.glsl — satellite point-sprite vertex stage.
      // Each satellite is one GL point. Per-point attributes (size, alpha, glyph
      // id, colour) pass through to the fragment stage, which draws the glyph.
      // gl_PointSize is scaled by device pixel ratio so sprites stay crisp.
      //
      // Arrival: aBirth is the uTime (s) at which the object lands. Before it the
      // point is not drawn. For SPAWN_S after it, the point falls radially from
      // SPAWN_R x its orbit radius to its orbit, large and white-hot, and vFlash
      // (1 → 0) tells the fragment stage to mix in the flash and halo.
      attribute float aSize; attribute float aAlpha; attribute float aGlyph;
      attribute float aBirth;
      attribute vec3 aColor;
      varying vec3 vColor; varying float vAlpha; varying float vGlyph;
      varying float vFlash;
      uniform float uPixelRatio;
      uniform float uTime;
      const float SPAWN_S = 1.4;
      const float SPAWN_R = 1.6;
      void main() {
        float k = clamp((uTime - aBirth) / SPAWN_S, 0.0, 1.0);
        float e = 1.0 - pow(1.0 - k, 3.0);           // ease-out cubic
        float born = step(aBirth, uTime);
        vFlash = born * (1.0 - e);
        vColor = aColor; vGlyph = aGlyph;
        vAlpha = aAlpha * born * smoothstep(0.0, 0.12, k);
        vec3 p = position * mix(SPAWN_R, 1.0, e);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = born * aSize * (1.0 + 1.6 * vFlash) * uPixelRatio;
        gl_Position = projectionMatrix * mv;
      }
