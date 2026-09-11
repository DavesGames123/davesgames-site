
      uniform vec3 uColor; varying vec3 vN; varying vec3 vP;
      void main() {
        vec3 V = normalize(-vP);
        float f = 1.0 - max(dot(V, vN), 0.0);
        f = pow(f, 3.4);
        gl_FragColor = vec4(uColor, f * 0.35);
      }