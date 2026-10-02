#version 300 es
// The plate: dark wood, metal or glass, the sand layer with a soft shadow,
// the optional motion tint, and the drive point.
precision highp float;
in vec2 vUv;
uniform sampler2D uMask;   // r: 1 on the plate, 0 off it or in a hole
uniform sampler2D uSand;   // r: grain density (the trail)
uniform sampler2D uAmp;    // r: |w| / max |w|, on the grid nodes
uniform vec2 uGrid;        // nx, ny
uniform vec2 uTexel;       // one sand texel in uv
uniform vec2 uCm;          // grid rect size in cm
uniform vec3 uSandCol;
uniform float uKind;       // 0 alu, 1 brass, 2 glass, 3 spruce, 4 maple
uniform float uShowAmp;
uniform vec2 uDrive;       // drive point in uv
uniform float uFade;
uniform float uShadow;     // 1 = draw the drop shadow only
uniform float uGain;       // sand tone curve
out vec4 o;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }

vec3 surface(vec2 cm) {
  if (uKind > 3.5) {          // maple: dark red-brown with flame across the grain
    float w = fbm(cm * vec2(0.35, 1.2));
    float flame = sin(cm.y * 2.6 + w * 6.0 + sin(cm.x * 0.9) * 1.4);
    float grain = fbm(vec2(cm.x * 6.0, cm.y * 0.25));
    return vec3(0.135, 0.075, 0.048) * (0.86 + 0.16 * flame + 0.10 * grain);
  }
  if (uKind > 2.5) {          // spruce: dark stained, fine straight grain along y
    float wob = fbm(vec2(cm.x * 0.15, cm.y * 0.08)) * 2.5;
    float lines = smoothstep(0.55, 1.0, sin((cm.x + wob) * 9.0) * 0.5 + 0.5);
    float soft = fbm(vec2(cm.x * 3.0, cm.y * 0.12));
    return vec3(0.118, 0.090, 0.064) * (0.88 + 0.22 * lines + 0.12 * soft);
  }
  if (uKind > 1.5) {          // glass: blue-black with a faint sheen
    return vec3(0.050, 0.068, 0.078) * (0.9 + 0.25 * smoothstep(0.2, 0.9, fbm(cm * 0.06)));
  }
  float brushed = fbm(vec2(cm.x * 12.0, cm.y * 0.4));
  if (uKind > 0.5) return vec3(0.150, 0.118, 0.070) * (0.86 + 0.2 * brushed);   // brass
  return vec3(0.102, 0.108, 0.118) * (0.86 + 0.2 * brushed);                     // aluminium
}

float dens(vec2 uv) { return 1.0 - exp(-uGain * texture(uSand, uv).r); }

void main() {
  float m = texture(uMask, vUv).r;
  if (uShadow > 0.5) {
    float s = textureLod(uMask, vUv, 3.0).r;
    o = vec4(0.0, 0.0, 0.0, 0.55 * s * uFade);
    return;
  }
  if (m < 0.02) discard;
  vec2 cm = vUv * uCm;
  vec3 col = surface(cm);
  // a brace under the plate (green channel 0): a faint lighter strip
  col *= 1.0 + 0.22 * (1.0 - texture(uMask, vUv).g) * m;
  // a light from the upper left: rim light on the edge, from the mask slope
  vec2 e = uTexel * 1.5;
  float gx = texture(uMask, vUv + vec2(e.x, 0.0)).r - texture(uMask, vUv - vec2(e.x, 0.0)).r;
  float gy = texture(uMask, vUv + vec2(0.0, e.y)).r - texture(uMask, vUv - vec2(0.0, e.y)).r;
  col += vec3(0.20, 0.17, 0.13) * clamp(-(gx + gy) * 0.7, 0.0, 1.0);
  col *= 1.0 - 0.35 * clamp((gx + gy) * 0.7, 0.0, 1.0);
  // motion tint: bright where the plate moves, dark on the nodes
  if (uShowAmp > 0.0) {
    vec2 g = (vUv * (uGrid - 1.0) + 0.5) / uGrid;
    float a = texture(uAmp, g).r;
    col += uShowAmp * (vec3(0.06, 0.16, 0.20) * pow(a, 0.7) + vec3(0.10, 0.05, 0.02) * a * a);
  }
  // sand, with a shadow cast to the lower right and a lit upper-left face
  vec2 L = vec2(-1.0, -1.0) * uTexel;
  float d = dens(vUv), dl = dens(vUv + 1.2 * L), ds = dens(vUv + 2.2 * L);
  col *= 1.0 - 0.55 * ds * (1.0 - d);
  float lit = clamp((d - dl) * 1.6, -0.6, 1.0);
  vec3 sand = uSandCol * (0.80 + 0.30 * lit) * (0.92 + 0.16 * hash(floor(vUv / uTexel)));
  col = mix(col, sand, d);
  // the drive point: a thin ring
  vec2 dv = (vUv - uDrive) * uCm;
  float r = length(dv);
  float ring = smoothstep(0.09, 0.0, abs(r - 0.55)) + smoothstep(0.16, 0.05, r);
  col = mix(col, vec3(0.95, 0.66, 0.34), 0.55 * ring);
  o = vec4(col, m * uFade);
}
