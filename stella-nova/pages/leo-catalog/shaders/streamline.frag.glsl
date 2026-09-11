
      varying float vBright;
      varying float vSpeed;
      vec3 speedColor(float t) {
        t = clamp(t, 0.0, 1.0);
        vec3 c0 = vec3(0.05, 0.02, 0.30);
        vec3 c1 = vec3(0.10, 0.30, 0.95);
        vec3 c2 = vec3(0.25, 0.95, 1.00);
        vec3 c3 = vec3(1.00, 0.55, 0.10);
        vec3 c4 = vec3(1.00, 1.00, 1.05);
        if (t < 0.25) return mix(c0, c1, t / 0.25);
        if (t < 0.50) return mix(c1, c2, (t - 0.25) / 0.25);
        if (t < 0.75) return mix(c2, c3, (t - 0.50) / 0.25);
        return            mix(c3, c4, (t - 0.75) / 0.25);
      }
      void main() {
        vec3 col = speedColor(vSpeed) * (0.35 + vBright * 1.1);
        float a  = 0.05 + vBright * 0.9;
        gl_FragColor = vec4(col, a);
      }