
      varying vec2 vUv; varying vec3 vN;
      void main() {
        vUv = uv; vN = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }