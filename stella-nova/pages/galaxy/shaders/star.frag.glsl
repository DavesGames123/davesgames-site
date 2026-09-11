#version 300 es
precision highp float;
in vec3 v_color;
in float v_lum;
out vec4 O;

void main(){
    vec2 pc = gl_PointCoord * 2.0 - 1.0;
    float d2 = dot(pc, pc);

    // Point-spread: core + bloom + haze
    float core  = smoothstep(0.3, 0.0, d2) * 1.3;
    float bloom = exp(-d2 * 3.5) * 0.5;
    float haze  = exp(-d2 * 1.2) * 0.12;
    float shape = core + bloom + haze;

    // Brightness from luminosity, applied to shape
    float intensity = shape * v_lum;

    // Only the tiniest white-hot core for the BRIGHTEST stars
    // This keeps colors visible — no white washout
    float whiteBlend = smoothstep(0.06, 0.0, d2) * 0.12 * clamp(v_lum - 2.0, 0.0, 1.0);
    vec3 col = mix(v_color, vec3(1.0), whiteBlend);

    // Apply intensity to color
    col *= intensity;

    float alpha = min(intensity * 0.75, 1.0);
    O = vec4(col, alpha);
}
