// ============================================================================
//  CORAL REEF  ·  ROV  ·  the soft fill light on the vehicles (three r160)
// ----------------------------------------------------------------------------
//  The user (2026-10-18): "i know it's technically physically accurate but
//  i would love to see a little more lighting on the ROV itself ... i would
//  love just a little bit of ambient light back from the the rov's". In
//  the dark water the vehicles showed as black shapes in front of their own
//  lamp glow. This file adds light ONLY to the ROV materials (rov/build.js
//  calls apply() on each of them); the rock, coral, sand and water shaders
//  of scene.js do not change, and no light goes into the scene.
//
//  Terms (added in the MeshStandardMaterial fragment after the lights):
//    ambient .... a hemisphere: a dim blue-grey from above, a dimmer warm
//                 grey from below, on the diffuse and (a little) on the
//                 specular colour, so the yellow foam and the metal read
//    spill ...... light from the vehicle's own lamps that comes back off
//                 the near water: 1 / (1 + d^2 / R^2) round each lamp
//                 head, times the lamp level (the flicker), so the light
//                 bar, the front frame and the camera pod glow a little
//    rim ........ the scattered water glow at grazing angles (Fresnel
//                 power 3): a thin blue edge that keeps the outline
//    highlight .. setHighlight(on, colour): an added glow (the HUD uses it
//                 for the selected vehicle)
//  All terms are display referred: they are multiplied by uRovGain = 1 /
//  exposure (scene.js auto exposure; the page puts it in
//  scene.userData.exposure). So the vehicle is about the same brightness
//  on the screen at any exposure, and the dark mood of the scene stays.
//  FILL holds the levels: the top of the foam reads at about 0.09 before
//  the tone map (with the lamp spill), the back of the frame at about 0.06.
//
//  USE
//    const fill = createFill(THREE, { scale });
//    fill.apply(material)                 each ROV material (build.js)
//    fill.update(exposure, lampK, lamps)  each frame (rov/index.js):
//                                         lamps: [Object3D] lamp faces
//    fill.setHighlight(on, colour, k)
//    fill.uniforms                        the shared uniform objects
//    fillAt(o) -> rgb                     the CPU copy of the light (tests)
//
//  grep -n targets: "export const FILL", "export const FILL_FS",
//  "export function createFill", "export function fillAt"
// ============================================================================

export const FILL = {
  sky: [0.05, 0.065, 0.08],          // the ambient from above (display: x exposure)
  ground: [0.022, 0.021, 0.018],     // and from below
  spec: 0.6,                         // the share of the ambient on the specular colour
  spill: [0.22, 0.21, 0.18],         // the lamp spill at the lamp head
  spillR: 0.28,                      // m (render space, scale 0.6): the spill radius
  rim: [0.018, 0.045, 0.06],         // the water glow at grazing angles
  hi: [0.31, 0.85, 1.0],             // the default highlight colour
  hiK: 0.18,
};

export const FILL_VS_HEAD = /* glsl */`
varying vec3 vRovW;`;
export const FILL_VS_BODY = /* glsl */`
vRovW = (modelMatrix * vec4(transformed, 1.0)).xyz;`;
export const FILL_FS_HEAD = /* glsl */`
uniform vec3 uRovSky, uRovGround, uRovSpill, uRovRim, uRovLamp[4];
uniform vec4 uRovHi;
uniform float uRovGain, uRovSpillR, uRovSpec;
varying vec3 vRovW;`;
// after #include <lights_fragment_end>: normal (view space), vViewPosition,
// material (PhysicalMaterial), reflectedLight, totalEmissiveRadiance
export const FILL_FS = /* glsl */`
{
  vec3 rovN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  vec3 rovAmb = mix(uRovGround, uRovSky, rovN.y * 0.5 + 0.5);
  vec3 rovSp = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 d = uRovLamp[i] - vRovW;
    float l2 = max(dot(d, d), 1e-4);
    rovSp += vec3((0.55 + 0.45 * max(dot(rovN, d * inversesqrt(l2)), 0.0)) / (1.0 + l2 * uRovSpillR));
  }
  vec3 rovL = (rovAmb + uRovSpill * rovSp) * uRovGain;
  reflectedLight.indirectDiffuse += material.diffuseColor * rovL;
  reflectedLight.indirectSpecular += material.specularColor * rovL * uRovSpec;
  float rovRim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
  totalEmissiveRadiance += (uRovRim * rovRim + uRovHi.rgb * uRovHi.a * (0.3 + 0.7 * rovRim)) * uRovGain;
}`;

export function createFill(THREE, o = {}) {
  const v3 = a => new THREE.Vector3(a[0], a[1], a[2]);
  const R = (o.spillR ?? FILL.spillR) * (o.scale ?? 1) / 0.6;
  const U = {
    uRovSky: { value: v3(FILL.sky) }, uRovGround: { value: v3(FILL.ground) }, uRovSpill: { value: v3(FILL.spill) }, uRovRim: { value: v3(FILL.rim) },
    uRovLamp: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(0, -1e4, 0)) }, uRovHi: { value: new THREE.Vector4(FILL.hi[0], FILL.hi[1], FILL.hi[2], 0) },
    uRovGain: { value: 1 / 4 }, uRovSpillR: { value: 1 / (R * R) }, uRovSpec: { value: FILL.spec },
  };
  const P = new THREE.Vector3();
  return {
    uniforms: U,
    apply(mat) {
      mat.userData.rovFill = true;
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + FILL_VS_HEAD).replace('#include <project_vertex>', '#include <project_vertex>' + FILL_VS_BODY);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + FILL_FS_HEAD).replace('#include <lights_fragment_end>', '#include <lights_fragment_end>' + FILL_FS);
      };
      mat.customProgramCacheKey = () => 'rov-fill-1';
      mat.needsUpdate = true;
      return mat;
    },
    // exposure: the composite exposure (1 .. 8); lampK: the lamp level (0
    // off, 1 full, the flicker); lamps: the lamp faces (up to 4)
    update(exposure, lampK, lamps) {
      U.uRovGain.value = 1 / Math.max(0.5, exposure || 4);
      const k = Math.max(0, lampK ?? 1);
      U.uRovSpill.value.set(FILL.spill[0] * k, FILL.spill[1] * k, FILL.spill[2] * k);
      for (let i = 0; i < 4; i++) {
        const l = lamps && lamps[i];
        if (l) { l.getWorldPosition(P); U.uRovLamp.value[i].copy(P); } else U.uRovLamp.value[i].set(0, -1e4, 0);
      }
    },
    setHighlight(on, colour, k = FILL.hiK) {
      const c = colour === undefined || colour === null ? null : new THREE.Color(colour);
      const v = U.uRovHi.value;
      if (c) v.set(c.r, c.g, c.b, on ? k : 0); else v.w = on ? k : 0;
    },
  };
}

// The CPU copy of FILL_FS (diffuse part, no rim): rgb light on a surface
// of albedo 1 at position p with world normal n. o: { exposure, lampK,
// lamps: [[x, y, z]], spillR }.
export function fillAt(p, n, o = {}) {
  const gain = 1 / Math.max(0.5, o.exposure || 4), up = n[1] * 0.5 + 0.5, k = o.lampK ?? 1, R = o.spillR ?? FILL.spillR;
  let sp = 0;
  for (const L of o.lamps || []) {
    const d = [L[0] - p[0], L[1] - p[1], L[2] - p[2]], l2 = Math.max(d[0] * d[0] + d[1] * d[1] + d[2] * d[2], 1e-4), il = 1 / Math.sqrt(l2);
    sp += (0.55 + 0.45 * Math.max((n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) * il, 0)) / (1 + l2 / (R * R));
  }
  return [0, 1, 2].map(c => (FILL.ground[c] + (FILL.sky[c] - FILL.ground[c]) * up + FILL.spill[c] * k * sp) * gain);
}
