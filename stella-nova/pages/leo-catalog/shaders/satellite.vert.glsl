
      // satellite.vert.glsl — satellite point-sprite vertex stage.
      // Each satellite is one GL point. Per-point attributes (size, alpha, glyph
      // id, colour) pass through to the fragment stage, which draws the glyph.
      // gl_PointSize is scaled by device pixel ratio so sprites stay crisp.
      attribute float aSize; attribute float aAlpha; attribute float aGlyph;
      attribute vec3 aColor;
      varying vec3 vColor; varying float vAlpha; varying float vGlyph;
      uniform float uPixelRatio;
      void main() {
        vColor = aColor; vAlpha = aAlpha; vGlyph = aGlyph;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * mv;
      }