// star.vert.glsl — per-star placement, vertex stage
//
//   Runs once per star. It advances the star's circular orbit analytically for
//   the current time, tilts that orbit in 3D (inclination + node), rotates and
//   flattens the whole galaxy for the view, and projects to clip space. It also
//   derives the star's spectral colour and luminosity from its hashes, passing
//   colour and brightness to the fragment stage on SEPARATE channels so tint
//   survives additive blending.
//
//     orbit(t) in disk plane ──▶ incline by a_incl about node a_node ──▶ 3D pos
//         │                                                                │
//         └─ r = a_radius·a_radScatter·(1 + a_ecc·cos(t/2))                ▼
//                                  view rotate + flatten by tilt ──▶ screen ──▶ ndc
//
//   gl_PointSize scales with luminosity and zoom; the fragment shader shapes
//   the sprite. specHash drives a pow(h,4) skew toward redder, dimmer stars.
#version 300 es
precision highp float;

in float a_radius;
in float a_speed;
in float a_phase;
in float a_ecc;
in float a_radScatter;
in float a_spiralOff;
in float a_specHash;
in float a_briHash;
in float a_incl;
in float a_node;

uniform float u_time;
uniform float u_timescale;
uniform vec2  u_res;
uniform vec4  u_mouse;
uniform float u_zoom;
uniform float u_tilt;
uniform float u_spiral;

out vec3 v_color;  // spectral tint (NOT multiplied by brightness)
out float v_lum;   // brightness, separate channel

// ── Blackbody RGB from temperature (measured data) ──
// Then saturation-boosted 1.6× so tints survive additive blending.
vec3 blackbodyColor(float h){
    float t = h * h * h * h; // pow(h,4) — IMF skew

    vec3 c;
    if(t < 0.08){
        // M-class 2400–3700K
        c = mix(vec3(1.00, 0.54, 0.22), vec3(1.00, 0.65, 0.34), t / 0.08);
    } else if(t < 0.22){
        // K-class 3700–5200K
        c = mix(vec3(1.00, 0.65, 0.34), vec3(1.00, 0.82, 0.58), (t-0.08)/0.14);
    } else if(t < 0.42){
        // G-class 5200–6000K
        c = mix(vec3(1.00, 0.82, 0.58), vec3(1.00, 0.90, 0.72), (t-0.22)/0.20);
    } else if(t < 0.65){
        // F-class 6000–7500K
        c = mix(vec3(1.00, 0.90, 0.72), vec3(1.00, 0.97, 0.91), (t-0.42)/0.23);
    } else if(t < 0.85){
        // A-class 7500–10000K
        c = mix(vec3(1.00, 0.97, 0.91), vec3(0.88, 0.91, 1.00), (t-0.65)/0.20);
    } else {
        // B/O-class 10000–40000K
        c = mix(vec3(0.88, 0.91, 1.00), vec3(0.62, 0.72, 1.00), (t-0.85)/0.15);
    }

    // Boost saturation 1.6× so color tints remain visible
    float gray = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(gray), c, 1.6);
    return clamp(c, 0.0, 1.0);
}

// Luminosity by spectral class: hotter (higher t) stars are far brighter,
// following the same class breakpoints as blackbodyColor. scatter adds spread.
float starLuminosity(float h, float scatter){
    float t = h * h * h * h;
    float lum;
    if(t < 0.08)       lum = 0.08 + t * 1.5;
    else if(t < 0.22)  lum = 0.20 + (t-0.08) * 2.5;
    else if(t < 0.42)  lum = 0.55 + (t-0.22) * 3.0;
    else if(t < 0.65)  lum = 1.15 + (t-0.42) * 5.0;
    else if(t < 0.85)  lum = 2.30 + (t-0.65) * 8.0;
    else                lum = 3.90 + (t-0.85) * 16.0;
    lum *= 0.4 + scatter * 1.2;
    return lum;
}

void main(){
    // Orbit angle: advances with time; u_spiral shears outer stars back to
    // wind the arms. Radius breathes slightly with eccentricity.
    float time = u_time * u_timescale;
    float tOrb = time * a_speed + a_phase + u_spiral * a_spiralOff;
    float r = a_radius * a_radScatter * (1.0 + a_ecc * cos(tOrb * 0.5));

    // Position on the flat orbit, then tilt it out of plane by inclination and
    // rotate that tilt about the ascending node, giving a 3D galactic position.
    float ox = cos(tOrb) * r, oy = sin(tOrb) * r;
    float ci = cos(a_incl), si = sin(a_incl);
    float cn = cos(a_node), sn = sin(a_node);
    float ix = ox, iy = oy * ci, iz = oy * si;
    float gx = cn*ix - sn*iy, gy = sn*ix + cn*iy, gz = iz;

    // View transform: rotate in-plane, then flatten by tilt to fake perspective.
    float tilt = max(1.2, u_tilt + u_mouse.y * 2.0);
    float rotAngle = 0.45 + u_mouse.x * 0.5;
    float cR = cos(rotAngle), sR = sin(rotAngle);
    float rx = cR*gx - sR*gy, ry = sR*gx + cR*gy;

    vec2 screen = vec2(rx, ry / tilt + gz);
    screen *= u_zoom;
    vec2 ndc = (screen + u_res * 0.5) / u_res * 2.0 - 1.0;

    float lum = starLuminosity(a_specHash, a_briHash);

    // Color and brightness are SEPARATE — color stays pure
    v_color = blackbodyColor(a_specHash);
    v_lum = lum;

    // Sprite size grows with brightness and zoom, clamped to a sane pixel range.
    float sz = (0.4 + lum * 0.8) * u_zoom;
    sz = clamp(sz, 0.4, 6.0);
    gl_PointSize = sz;

    gl_Position = vec4(ndc, 0.0, 1.0);
}
