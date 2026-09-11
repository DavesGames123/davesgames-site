
      uniform sampler2D uMap; uniform vec3 uSunDir;
      varying vec2 vUv; varying vec3 vN;
      void main() {
        vec4 t = texture2D(uMap, vec2(vUv.x, vUv.y));
        float dlit = dot(vN, uSunDir);
        float lit = smoothstep(-0.20, 0.25, dlit);
        vec3 dayCol   = t.rgb * 1.45;
        vec3 nightCol = t.rgb * 0.48 + vec3(0.0, 0.004, 0.002);
        gl_FragColor = vec4(mix(nightCol, dayCol, lit), 1.0);
      }