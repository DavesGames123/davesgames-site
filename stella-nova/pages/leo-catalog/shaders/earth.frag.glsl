
      // earth.frag.glsl — Earth globe fragment stage.
      // Samples the surface texture and blends a bright day tint with a dim
      // night tint across the terminator, set by the normal-to-sun angle.
      uniform sampler2D uMap; uniform vec3 uSunDir;
      varying vec2 vUv; varying vec3 vN;
      void main() {
        vec4 t = texture2D(uMap, vec2(vUv.x, vUv.y));
        // Cosine of the angle between the surface normal and the sun direction.
        float dlit = dot(vN, uSunDir);
        // Soft day/night mask; the band around zero is the terminator.
        float lit = smoothstep(-0.20, 0.25, dlit);
        vec3 dayCol   = t.rgb * 1.45;
        // Night side keeps a faint blue-green so it is not pure black.
        vec3 nightCol = t.rgb * 0.48 + vec3(0.0, 0.004, 0.002);
        gl_FragColor = vec4(mix(nightCol, dayCol, lit), 1.0);
      }