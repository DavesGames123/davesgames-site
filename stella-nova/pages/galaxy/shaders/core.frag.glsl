#version 300 es
precision highp float;
uniform vec2  u_res;
uniform vec4  u_mouse;
uniform float u_zoom;
uniform float u_tilt;
out vec4 O;

void main(){
    vec2 fc = gl_FragCoord.xy;
    float rotAngle = 0.45 + u_mouse.x * 0.5;
    float tilt = max(1.2, u_tilt + u_mouse.y * 2.0);
    vec2 center = u_res * 0.5;
    vec2 p = (fc - center) / u_zoom;
    float cR = cos(rotAngle), sR = sin(rotAngle);

    // Disk glow (squashed)
    vec2 pd = p / vec2(1.0, tilt);
    pd = vec2(cR*pd.x - sR*pd.y, sR*pd.x + cR*pd.y);
    float dD = length(pd);

    // Bulge glow (nearly spherical, much larger)
    float bTilt = 1.0 + (tilt - 1.0) * 0.2;
    vec2 pb = p / vec2(1.0, bTilt);
    pb = vec2(cR*pb.x - sR*pb.y, sR*pb.x + cR*pb.y);
    float dB = length(pb);

    vec3 col = vec3(0.0);
    // Prominent warm bulge
    col += 8.0 / (dB + 0.6) * vec3(1.0, 0.86, 0.65);
    col += 500.0 / (dB*dB + 15.0) * vec3(1.0, 0.82, 0.58) * 0.08;
    col += 8000.0 / (dB*dB + 300.0) * vec3(1.0, 0.76, 0.50) * 0.03;
    col += 40000.0 / (dB*dB + 3000.0) * vec3(0.95, 0.70, 0.42) * 0.02;
    // Wide disk haze
    col += 30000.0 / (dD*dD + 8000.0) * vec3(0.9, 0.74, 0.55) * 0.01;
    col += 150000.0 / (dD*dD + 60000.0) * vec3(0.8, 0.66, 0.50) * 0.006;

    vec2 vuv = fc / u_res - 0.5;
    col *= 1.0 - dot(vuv, vuv) * 0.5;
    col = col / (1.0 + col * 0.1);
    O = vec4(col, 1.0);
}
