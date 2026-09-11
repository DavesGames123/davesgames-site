
      varying vec3 vColor; varying float vAlpha; varying float vGlyph;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float ax = abs(c.x), ay = abs(c.y);
        float intensity = 0.0;
        if (vGlyph < 0.5) {
          // diamond — PAYLOAD
          float d = ax + ay;
          intensity = step(d, 0.42);
        } else if (vGlyph < 1.5) {
          // framed square — STATION
          float outer = max(ax, ay);
          float frame = step(0.32, outer) * step(outer, 0.46);
          float cross = step(ax, 0.05) * step(ay, 0.42)
                      + step(ay, 0.05) * step(ax, 0.42);
          intensity = max(frame, cross);
        } else if (vGlyph < 2.5) {
          // bar — ROCKET BODY
          float bar = step(ax, 0.10) * step(ay, 0.46);
          float pip = step(length(c), 0.07);
          intensity = max(bar, pip);
        } else if (vGlyph < 3.5) {
          // X — DEBRIS
          float x1 = step(abs(c.x - c.y), 0.08) * step(abs(c.x + c.y), 0.34);
          float x2 = step(abs(c.x + c.y), 0.08) * step(abs(c.x - c.y), 0.34);
          intensity = max(x1, x2);
        } else if (vGlyph < 4.5) {
          // ring — STORM
          float d = length(c);
          intensity = step(0.30, d) * step(d, 0.46);
        } else {
          // upward triangle — STARLINK
          float yTop = 0.42, yBot = -0.42;
          float t01  = (yTop - c.y) / (yTop - yBot);
          float maxX = t01 * 0.45;
          intensity = step(yBot, c.y) * step(c.y, yTop) * step(abs(c.x), maxX);
        }
        if (intensity < 0.01) discard;
        gl_FragColor = vec4(vColor, vAlpha * intensity);
      }