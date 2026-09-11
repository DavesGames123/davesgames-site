
      attribute float arclen;
      attribute float streamId;
      attribute float speed;
      attribute float segPos;
      uniform float flowTime;
      varying float vBright;
      varying float vSpeed;
      void main() {
        // Per-streamline phase offset (golden ratio so heads desynchronize naturally)
        float offset = fract(streamId * 0.6180339);
        // Distance BEHIND the current bright head along this streamline.
        // The head moves through segPos space at unit rate as flowTime advances;
        // wrapping mod(1.0) gives a continuously translating bright comet.
        float behind = mod(flowTime + offset - segPos, 1.0);
        // Sharp Gaussian comet head, ~12% streamline length tail
        vBright = exp(-behind * behind * 80.0);
        vSpeed  = clamp(speed / 45.0, 0.0, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }