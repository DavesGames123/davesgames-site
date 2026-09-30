// shading.wgsl - surface and volume shaders: surface colour and gradients, light shading with
// soft shadows, specular highlights, ambient occlusion, background, glow and fogs.
// Ported from Mandelbulber v2 opencl/engines: shader_surface_color.cl, shader_light_shading.cl,
// shader_aux_lights_shader.cl, shader_aux_shadow.cl, shader_specular_highlight(_combined).cl,
// shader_fast_ambient_occlusion.cl, shader_ambient_occlusion.cl, shader_object.cl,
// shader_background.cl, shader_iter_opacity.cl, shader_distance_fog_opacity.cl,
// shader_volumetric.cl. Random from opencl_algebra.h.
// Copyright (C) 2017-24 Mandelbulber Team. Authors: Krzysztof Marczak (buddhi1980@gmail.com).
// Mandelbulber is free software under the GNU General Public License v3 or later.
// This port is also GPL-3.0. See COPYING in the page folder.
//
// Not ported: textures, perlin noise, iridescence, env mapping, fake lights, clouds,
// volumetric and visible aux lights, Monte Carlo soft shadows, global illumination, Rayleigh
// scattering. The multiple-rays AO uses one random direction per sample (the upstream
// MONTE_CARLO path) with a white light map, and the screen space AO mode runs as that mode too.
//
// grep: RandomS ShaderInput Gradients GetColorFromGradient SurfaceColor SpecularHighlight
//       SpecularHighlightCombined CalculateLightVector LightShading AuxLightsShader AuxShadow
//       FastAmbientOcclusion AmbientOcclusion ObjectShader BackgroundShader IterOpacity
//       DistanceFogOpacity VolumetricShader

// Random(max): integer in 0..max. Upstream keeps the seed in the shader input and calc params;
// here one private seed per invocation holds the state, and a PCG step stands in for the 48-bit
// LCG of the OpenCL code, because WGSL has no 64-bit integers.
var<private> engRandomSeed: u32;

fn RandomS(max: i32) -> i32 {
  let s = engRandomSeed * 747796405u + 2891336453u;
  var w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  w = (w >> 22u) ^ w;
  engRandomSeed = w;
  return i32((w >> 1u) % u32(max + 1));
}

// sShaderInputDataCl subset
struct ShaderInput {
  point: vec3f,
  viewVector: vec3f,
  normal: vec3f,
  lastDist: f32,
  depth: f32,
  distThresh: f32,
  delta: f32,
  stepCount: i32,
  invertMode: bool,
}

// sClGradientsCollection subset
struct Gradients {
  surface: vec3f,
  specular: vec3f,
  diffuse: vec3f,
  luminosity: vec3f,
}

// light types (enumLightTypeCl)
const lightDirectional: i32 = 0;
const lightPoint: i32 = 1;
const lightConical: i32 = 2;
const lightProjection: i32 = 3;
const lightBeam: i32 = 4;

//---------------- gradients (shader_surface_color.cl) ----------------

fn GradientInterpolate(paletteIndex: i32, pos: f32, smoothIp: bool, gradientSize: i32, paletteOffset: i32) -> vec3f {
  var color = vec3f(0.0);
  if (paletteIndex == gradientSize - 1) {
    color = P.palette[paletteOffset + paletteIndex - 1].xyz;
  } else {
    let color1 = P.palette[paletteOffset + paletteIndex].xyz;
    let pos1 = P.palette[paletteOffset + paletteIndex].w;
    let color2 = P.palette[paletteOffset + paletteIndex + 1].xyz;
    let pos2 = P.palette[paletteOffset + paletteIndex + 1].w;
    if (pos2 - pos1 > 0.0) {
      var delta = (pos - pos1) / (pos2 - pos1);
      if (smoothIp) { delta = 0.5 * (1.0 - cos(delta * 3.14159265)); }
      let nDelta = 1.0 - delta;
      color = color1 * nDelta + color2 * delta;
    } else {
      color = color1;
    }
  }
  return color;
}

fn GradientIterator(paletteIndex: i32, colorPosition: f32, gradientSize: i32, paletteOffset: i32) -> i32 {
  var newIndex = paletteIndex;
  while (newIndex < gradientSize - 1 && colorPosition > P.palette[paletteOffset + newIndex + 1].w) {
    newIndex++;
  }
  return newIndex;
}

fn GetColorFromGradient(position: f32, smoothIp: bool, gradientSize: i32, paletteOffset: i32) -> vec3f {
  if (gradientSize < 2) { return vec3f(1.0); }
  let paletteIndex = GradientIterator(0, position, gradientSize, paletteOffset);
  return GradientInterpolate(paletteIndex, position, smoothIp, gradientSize, paletteOffset);
}

fn SurfaceColor(input: ptr<function, ShaderInput>, calcParam: ptr<function, CalcParams>,
  gradients: ptr<function, Gradients>) -> vec3f {
  (*calcParam).distThresh = (*input).distThresh;
  (*calcParam).detailSize = (*input).delta;

  (*gradients).surface = vec3f(1.0);
  (*gradients).specular = vec3f(1.0);
  (*gradients).diffuse = vec3f(1.0);
  (*gradients).luminosity = vec3f(0.0);

  var color = vec3f(1.0);
  let material = P.material;

  if (material.useColorsFromPalette != 0) {
    let fout = ComputeFractal(FractalLocalPoint((*input).point), calcParam, calcModeColouring);
    let a = abs(fout.colorIndex);
    let m = 248.0 * 256.0;
    let nCol = a - m * trunc(a / m);

    let cp = nCol / 256.0 / 10.0 * material.coloring_speed + material.paletteOffset;
    let colorPosition = cp - trunc(cp);

    if (material.surfaceGradientEnable != 0) {
      color = GetColorFromGradient(colorPosition, false, material.paletteSurfaceLength, material.paletteSurfaceOffset);
      (*gradients).surface = color;
    } else {
      color = material.color;
    }
    if (material.specularGradientEnable != 0) {
      (*gradients).specular = GetColorFromGradient(colorPosition, false,
        material.paletteSpecularLength, material.paletteSpecularOffset);
    }
    if (material.diffuseGradientEnable != 0) {
      (*gradients).diffuse = GetColorFromGradient(colorPosition, false,
        material.paletteDiffuseLength, material.paletteDiffuseOffset);
    }
    if (material.luminosityGradientEnable != 0) {
      (*gradients).luminosity = GetColorFromGradient(colorPosition, false,
        material.paletteLuminosityLength, material.paletteLuminosityOffset);
    }
  } else {
    color = material.color;
  }
  return color;
}

//---------------- specular (shader_specular_highlight*.cl) ----------------

fn SpecularHighlight(input: ptr<function, ShaderInput>, calcParam: ptr<function, CalcParams>,
  lightVector: vec3f, specularWidth: f32, roughnessIn: f32, gradients: ptr<function, Gradients>) -> vec3f {
  let material = P.material;
  let halfVector = normalize(lightVector - (*input).viewVector);
  var specular = dot((*input).normal, halfVector);
  if (specular < 0.0) { specular = 0.0; }

  var diffuse = 1.0;
  let roughness = roughnessIn;

  if (material.useColorsFromPalette != 0 && material.diffuseGradientEnable != 0) {
    let gd = (*gradients).diffuse;
    diffuse *= 10.0 * (1.1 - (gd.x + gd.y + gd.z) / 3.0);
  }

  specular = pow(specular, 30.0 / specularWidth / diffuse) / diffuse;

  if (roughness > 0.0) {
    specular *= (1.0 + f32(RandomS(1000)) / 1000.0 * roughness);
  }
  if (specular > 15.0) { specular = 15.0; }
  return vec3f(specular) * material.specularColor;
}

fn SpecularHighlightCombined(input: ptr<function, ShaderInput>, calcParam: ptr<function, CalcParams>,
  lightVector: vec3f, surfaceColor: vec3f, gradients: ptr<function, Gradients>) -> vec3f {
  let material = P.material;
  var specularPlastic = vec3f(0.0);
  if (material.specularPlasticEnable != 0) {
    specularPlastic = SpecularHighlight(input, calcParam, lightVector, material.specularWidth, 0.0, gradients);
    specularPlastic *= material.specular;
  }
  var specularMetallic = vec3f(0.0);
  if (material.metallic != 0) {
    specularMetallic = SpecularHighlight(input, calcParam, lightVector, material.specularMetallicWidth,
      material.specularMetallicRoughness, gradients);
    specularMetallic *= material.specularMetallic * surfaceColor;
  }
  return specularPlastic + specularMetallic;
}

//---------------- lights (shader_light_shading.cl) ----------------

fn CalculateLightVector(light: LightCl, point: vec3f, delta: f32, outDistance: ptr<function, f32>) -> vec3f {
  var lightVector: vec3f;
  if (light.ltype == lightDirectional) {
    lightVector = light.lightDirection;
    if (light.penetrating != 0) {
      *outDistance = delta / P.resolution;
    } else {
      *outDistance = P.viewDistanceMax;
    }
  } else {
    var lp = light.position;
    if (light.ltype == lightBeam) {
      lp = light.position + (light.targetPos - light.position) * f32(RandomS(10000)) / 10000.0;
    }
    let d = lp - point;
    lightVector = normalize(d);
    *outDistance = length(d);
  }
  return lightVector;
}

fn LightDecay(dist: f32, decayFunction: i32) -> f32 {
  return pow(dist, f32(decayFunction + 1));
}

fn CalculateLightCone(light: LightCl, point: vec3f, lightVector: vec3f) -> f32 {
  var intensity = 1.0;
  if (light.ltype == lightConical) {
    if (dot(point - light.position, light.lightDirection) > 0.0) {
      intensity = 0.0;
    } else {
      let tipSize = light.size * 0.5;
      let distanceToAxis = length(cross(point - light.position, light.lightDirection));
      let cone = length(point - light.position);
      let cone1 = cone * light.coneRatio;
      let cone2 = cone * light.coneSoftRatio;
      if (distanceToAxis < tipSize + cone1) {
        intensity = 1.0;
      } else if (distanceToAxis < tipSize + cone2) {
        intensity = (tipSize + cone2 - distanceToAxis) / (cone2 - cone1);
      } else {
        intensity = 0.0;
      }
      intensity = intensity * (tipSize * tipSize) / ((tipSize + cone1) * (tipSize + cone1));
    }
  }
  // projection lights need a texture, which is not ported: they shine like point lights
  return intensity;
}

//---------------- shadows (shader_aux_shadow.cl) ----------------

fn AuxShadow(input: ptr<function, ShaderInput>, light: LightCl, distance: f32, lightVector: vec3f,
  calcParam: ptr<function, CalcParams>, intensity: f32) -> f32 {
  var totalOpacity = 0.0;
  var shadowTemp = 1.0;

  var DEFactor = P.DEFactor;
  if (P.iterFogEnabled != 0 || P.distanceFogShadows != 0 || light.volumetric != 0) { DEFactor = 1.0; }

  let start = (*input).distThresh;
  let softRange = tan(light.softShadowCone);

  var maxSoft = 0.0;
  let bSoft = P.iterFogEnabled == 0 && P.distanceFogShadows == 0 && P.fogCastShadows == 0
    && P.iterThreshMode == 0 && P.interiorMode == 0 && softRange > 0.0;

  var count = 0;
  var step = 0.0;
  var point2 = (*input).point + start * lightVector;

  for (var i = start; i < distance; i += step) {
    point2 += lightVector * step;

    var dist_thresh: f32;
    if (P.iterFogEnabled != 0 || P.distanceFogShadows != 0 || light.volumetric != 0) {
      dist_thresh = CalcDistThresh(point2);
    } else {
      dist_thresh = (*input).distThresh;
    }

    (*calcParam).distThresh = dist_thresh;
    let outF = CalculateDistance(point2, calcParam);
    let dist = outF.distance;

    var limitsAcheved = false;
    if (P.limitsEnabled != 0) {
      limitsAcheved = any(point2 < P.limitMin) || any(point2 > P.limitMax);
    }

    if (bSoft && !limitsAcheved) {
      var angle = (dist - dist_thresh) / i;
      if (angle < 0.0) { angle = 0.0; }
      if (dist < dist_thresh) { angle = 0.0; }
      var softShadow = 1.0 - angle / softRange;
      if (light.penetrating != 0) { softShadow *= (distance - i) / distance; }
      if (softShadow < 0.0) { softShadow = 0.0; }
      if (softShadow > maxSoft) { maxSoft = softShadow; }
    }

    if (P.iterFogEnabled != 0) {
      var opacity = IterOpacity(step, outF.iters, f32(P.N), P.iterFogOpacityTrim,
        P.iterFogOpacityTrimHigh, P.iterFogOpacity);
      opacity *= (distance - i) / distance;
      opacity = min(opacity, 1.0);
      totalOpacity = opacity + (1.0 - opacity) * totalOpacity;
    }

    if (P.volFogEnabled != 0 && P.distanceFogShadows != 0) {
      var distanceShifted = 0.0;
      var opacity = DistanceFogOpacity(step, dist, P.volFogDistanceFromSurface,
        P.volFogDistanceFactor, P.volFogDensity, &distanceShifted);
      opacity *= (distance - i) / distance;
      opacity = min(opacity, 1.0);
      totalOpacity = opacity + (1.0 - opacity) * totalOpacity;
    }

    if (P.fogEnabled != 0 && P.fogCastShadows != 0) {
      var opacity = step / P.fogVisibility;
      opacity *= (distance - i) / distance;
      opacity = min(opacity, 1.0);
      totalOpacity = opacity + (1.0 - opacity) * totalOpacity;
    }

    shadowTemp = 1.0 - totalOpacity;

    if (dist < dist_thresh || shadowTemp < 0.0) {
      if (light.penetrating != 0) {
        shadowTemp -= (distance - i) / distance;
        if (shadowTemp < 0.0) { shadowTemp = 0.0; }
      } else {
        shadowTemp = 0.0;
      }
      break;
    }
    step = dist * DEFactor;
    step = max(step, 1e-6);

    count++;
    if (count > P.maxRaymarching) { break; }
  }

  if (!bSoft) { return shadowTemp; }
  return 1.0 - maxSoft;
}

fn LightShading(input: ptr<function, ShaderInput>, calcParam: ptr<function, CalcParams>,
  surfaceColor: vec3f, light: LightCl, gradients: ptr<function, Gradients>,
  outSpecular: ptr<function, vec3f>, outShadow: ptr<function, vec3f>) -> vec3f {
  let material = P.material;
  var dist = 0.0;
  let lightVector = CalculateLightVector(light, (*input).point, (*input).delta, &dist);

  var intensity = 0.0;
  if (light.ltype == lightDirectional) {
    intensity = light.intensity;
  } else if (light.ltype == lightConical) {
    intensity = 10.0 * light.intensity;
  } else {
    intensity = 100.0 * light.intensity / LightDecay(dist, light.decayFunction) / 6.0;
  }

  intensity *= CalculateLightCone(light, (*input).point, lightVector);

  var shade = dot((*input).normal, lightVector);
  if (shade < 0.0) { shade = 0.0; }
  shade = 1.0 - material.shading + shade * material.shading;
  shade = shade * intensity;
  if (shade > 500.0) { shade = 500.0; }

  // specular
  var specular = SpecularHighlightCombined(input, calcParam, lightVector, surfaceColor, gradients) * intensity;
  if (material.useColorsFromPalette != 0 && material.specularGradientEnable != 0) {
    specular *= (*gradients).specular;
  }
  let specularMax = max(max(specular.x, specular.y), specular.z);

  // calculate shadow
  var auxShadow = 1.0;
  if (P.shadowsEnabled != 0 && light.castShadows != 0 && P.previewMode == 0u) { // no preview shadows
    if (shade > 0.001 || specularMax > 0.001) {
      auxShadow = AuxShadow(input, light, dist, lightVector, calcParam, light.intensity);
      specular *= auxShadow;
    } else {
      auxShadow = 0.0;
      specular = vec3f(0.0);
    }
  }

  *outSpecular = specular * light.color;
  *outShadow = vec3f(auxShadow);
  return shade * light.color * auxShadow;
}

fn AuxLightsShader(input: ptr<function, ShaderInput>, calcParam: ptr<function, CalcParams>,
  surfaceColor: vec3f, gradients: ptr<function, Gradients>, specularOut: ptr<function, vec3f>,
  outShadow: ptr<function, vec3f>) -> vec3f {
  var shadeAuxSum = vec3f(0.0);
  var specularAuxSum = vec3f(0.0);
  for (var i = 0; i < P.numberOfLights; i++) {
    let light = P.lights[i];
    if (light.enabled != 0) {
      var specularAuxOutTemp = vec3f(0.0);
      let shadeAux = LightShading(input, calcParam, surfaceColor, light, gradients,
        &specularAuxOutTemp, outShadow);
      shadeAuxSum += shadeAux;
      specularAuxSum += specularAuxOutTemp;
    }
  }
  *specularOut = specularAuxSum;
  return shadeAuxSum;
}

//---------------- ambient occlusion ----------------

fn FastAmbientOcclusion(input: ptr<function, ShaderInput>, calcParam: ptr<function, CalcParams>) -> vec3f {
  // reference Inigo Quilez - iq/rgba: http://www.iquilezles.org/www/material/nvscene2008/rwwtt.pdf
  let delta = (*input).distThresh;
  var aoTemp = 0.0;
  let quality = P.ambientOcclusionQuality;
  var lastDist = 1e20;
  let n = i32(quality * quality);
  for (var i = 1; i < n; i++) {
    let scan = f32(i * i) * delta;
    let pointTemp = (*input).point + (*input).normal * scan;
    (*calcParam).distThresh = (*input).distThresh;
    var dist = CalculateDistance(pointTemp, calcParam).distance;
    if (dist > lastDist * 2.0) { dist = lastDist * 2.0; }
    lastDist = dist;
    aoTemp += 1.0 / pow(2.0, f32(i)) * (scan - P.ambientOcclusionFastTune * dist) / (*input).distThresh;
  }
  var ao = 1.0 - 0.2 * aoTemp;
  if (ao < 0.0) { ao = 0.0; }
  return vec3f(ao);
}

// AO_MODE_MULTIPLE_RAYS with MONTE_CARLO: one random direction on the sphere per sample
fn AmbientOcclusion(input: ptr<function, ShaderInput>, calcParam: ptr<function, CalcParams>) -> vec3f {
  let start_dist = (*input).distThresh;
  let end_dist = (*input).delta / P.resolution;

  let u = f32(RandomS(10000)) / 10000.0;
  let vv = f32(RandomS(10000)) / 10000.0;
  let zc = u * 2.0 - 1.0;
  let ang = vv * 6.2831853;
  let rxy = sqrt(max(0.0, 1.0 - zc * zc));
  let v = vec3f(cos(ang) * rxy, sin(ang) * rxy, zc);

  var dist = 0.0;
  var opacity = 0.0;
  var shadowTemp = 1.0;
  var count = 0;

  for (var r = start_dist; r < end_dist; r += dist * 2.0) {
    let point2 = (*input).point + v * r;
    (*calcParam).distThresh = (*input).distThresh;
    let outF = CalculateDistance(point2, calcParam);
    dist = outF.distance;

    var dist_thresh: f32;
    if (P.iterFogEnabled != 0) {
      dist_thresh = CalcDistThresh(point2);
    } else {
      dist_thresh = (*input).distThresh;
    }

    if (P.iterFogEnabled != 0) {
      opacity = IterOpacity(dist * 2.0, outF.iters, f32(P.N), P.iterFogOpacityTrim,
        P.iterFogOpacityTrimHigh, P.iterFogOpacity);
    }

    shadowTemp -= opacity * (end_dist - r) / end_dist;

    if (dist < dist_thresh || shadowTemp < 0.0) {
      shadowTemp -= (end_dist - r) / end_dist;
      if (shadowTemp < 0.0) { shadowTemp = 0.0; }
      break;
    }
    count++;
    if (count > P.maxRaymarching) { break; }
    dist = max(dist, 1e-7);
  }
  return vec3f(shadowTemp);
}

//---------------- object shader (shader_object.cl) ----------------

fn ObjectShader(input: ptr<function, ShaderInput>, calcParam: ptr<function, CalcParams>,
  outSurfaceColor: ptr<function, vec3f>, outSpecular: ptr<function, vec3f>,
  outShadow: ptr<function, vec3f>, gradients: ptr<function, Gradients>) -> vec3f {
  let material = P.material;
  let fillLight = P.fillLightColor;

  let surfaceColor = SurfaceColor(input, calcParam, gradients);

  var AO = vec3f(0.0);
  if (P.ambientOcclusionEnabled != 0 && P.previewMode == 0u) { // the preview skips AO
    if (P.ambientOcclusionMode == 0) {
      AO = FastAmbientOcclusion(input, calcParam);
    } else {
      AO = AmbientOcclusion(input, calcParam);
    }
    AO *= P.ambientOcclusion * P.ambientOcclusionColor;
  }

  var auxSpecular = vec3f(0.0);
  let auxLights = AuxLightsShader(input, calcParam, surfaceColor, gradients, &auxSpecular, outShadow);

  let iridescence = vec3f(1.0);
  let totalSpecular = auxSpecular * iridescence;

  var luminosity: vec3f;
  if (material.useColorsFromPalette != 0 && material.luminosityGradientEnable != 0) {
    luminosity = material.luminosity * (*gradients).luminosity;
  } else {
    luminosity = material.luminosity * material.luminosityColor;
  }

  let color = surfaceColor * (fillLight + auxLights + AO) + totalSpecular + luminosity;
  *outSpecular = totalSpecular;
  *outSurfaceColor = surfaceColor;
  return color;
}

//---------------- background (shader_background.cl) ----------------

fn BackgroundShader(input: ptr<function, ShaderInput>) -> vec3f {
  var pixel: vec3f;
  let viewVectorNorm = normalize((*input).viewVector);

  if (P.background3ColorsEnable != 0) {
    let vector = vec3f(0.0, 0.0, 1.0);
    var grad = dot(viewVectorNorm, vector) + 1.0;
    if (grad < 1.0) {
      let gradN = 1.0 - grad;
      pixel = P.background_color3 * gradN + P.background_color2 * grad;
    } else {
      grad = grad - 1.0;
      let gradN = 1.0 - grad;
      pixel = P.background_color2 * gradN + P.background_color1 * grad;
    }
  } else {
    pixel = P.background_color1;
  }

  pixel *= P.background_brightness;
  pixel = pow(max(pixel, vec3f(0.0)), vec3f(1.0 / P.background_gamma));

  for (var i = 0; i < P.numberOfLights; i++) {
    let light = P.lights[i];
    if (light.enabled != 0 && light.ltype == lightDirectional) {
      var intensity = -(dot(viewVectorNorm, light.lightDirection) - 1.0) * 360.0 / light.size;
      intensity = 1.0 / (1.0 + pow(max(intensity, 0.0), 6.0 * light.contourSharpness))
        * light.visibility * light.intensity;
      pixel += intensity * light.color;
    }
  }
  return pixel;
}

//---------------- fog opacities ----------------

fn IterOpacity(step: f32, iters: f32, maxN: f32, trim: f32, trimHigh: f32, opacitySp: f32) -> f32 {
  var opacity = (iters - trim) / maxN;
  if (iters > trimHigh) {
    var trim2 = trimHigh + 1.0 - iters;
    trim2 = max(trim2, 0.0);
    opacity *= trim2;
  }
  if (opacity < 0.0) { opacity = 0.0; }
  opacity *= opacity;
  opacity *= step * opacitySp;
  if (opacity > 1.0) { opacity = 1.0; }
  return opacity;
}

fn DistanceFogOpacity(step: f32, distance: f32, volFogDistanceFromSurface: f32,
  volFogDistanceFactor: f32, volFogDensity: f32, distanceShifted: ptr<function, f32>) -> f32 {
  *distanceShifted = abs(distance - volFogDistanceFromSurface) + 0.1 * volFogDistanceFromSurface;
  let densityTemp = step * volFogDistanceFactor
    / (*distanceShifted * *distanceShifted + volFogDistanceFactor * volFogDistanceFactor);
  var distFogOpacity = 0.3 * volFogDensity * densityTemp / (1.0 + volFogDensity * densityTemp) - 0.001;
  distFogOpacity = clamp(distFogOpacity, 0.0, 1.0);
  return distFogOpacity;
}

//---------------- volumetric shader (shader_volumetric.cl) ----------------

fn VolumetricShader(input: ptr<function, ShaderInput>, calcParam: ptr<function, CalcParams>,
  oldPixel: vec4f, opacityOut: ptr<function, f32>) -> vec4f {
  var out4 = oldPixel;
  var output = oldPixel.xyz;
  var totalOpacity = 0.0;

  // glow init
  var glow = f32((*input).stepCount) * P.glowIntensity / 512.0 * P.DEFactor;
  var glowN = 1.0 - glow;
  if (glowN < 0.0) { glowN = 0.0; }
  let glowColor = glowN * P.glowColor1 + P.glowColor2 * glow;

  // the preview replaces the volumetric march (fog, iteration fog) with the simple glow
  if (P.simpleGlow != 0 || P.previewMode != 0u) {
    if (P.glowEnabled != 0) {
      glow *= 0.7;
      var glowOpacity = 1.0 * glow;
      if (glowOpacity > 1.0) { glowOpacity = 1.0; }
      output = glow * glowColor + (1.0 - glowOpacity) * output;
      out4.w += glowOpacity;
    }
    out4 = vec4f(output, out4.w);
    return out4;
  }

  var scan = CalcDistThresh((*input).point);
  var input2 = *input;

  for (var i = 0; i < P.maxRaymarching; i++) {
    let point = (*input).point - (*input).viewVector * scan;

    input2.point = point;
    input2.distThresh = CalcDistThresh(point);
    input2.delta = CalcDelta(point);

    (*calcParam).distThresh = input2.distThresh;
    (*calcParam).detailSize = input2.distThresh;

    let outF = CalculateDistance(point, calcParam);
    let distance = outF.distance;

    // lastCloudDistance stays at clouds_period while clouds are off
    var step = (min(distance, P.cloudsPeriod) - 0.5 * input2.distThresh) * P.DEFactor * P.volumetricLightDEFactor;
    step *= (1.0 - f32(RandomS(1000)) / 4000.0);

    if (P.advancedQuality != 0) {
      step = clamp(step, P.absMinMarchingStep, P.absMaxMarchingStep);
      if (input2.distThresh > P.absMinMarchingStep) {
        step = clamp(step, P.relMinMarchingStep * input2.distThresh, P.relMaxMarchingStep * input2.distThresh);
      }
    }

    step = max(step, input2.distThresh);

    var end = false;
    if (step > (*input).depth - scan) {
      step = (*input).depth - scan;
      end = true;
    }
    scan += step;

    //------------------- glow
    if (P.glowEnabled != 0) {
      if ((*input).stepCount > 0) {
        var glowOpacity = glow / f32((*input).stepCount) * P.volumetricLightDEFactor;
        if (glowOpacity > 1.0) { glowOpacity = 1.0; }
        output = glowOpacity * glowColor + (1.0 - glowOpacity) * output;
        out4.w += glowOpacity;
      }
    }

    var basicFogOpacity = 0.0;
    if (P.fogEnabled != 0) {
      basicFogOpacity = step / P.fogVisibility;
    }

    var iterFogOpacity = 0.0;
    var iterFogCol = vec3f(0.0);
    if (P.iterFogEnabled != 0) {
      let L = outF.iters;
      iterFogOpacity = IterOpacity(step, L, f32(P.N), P.iterFogOpacityTrim,
        P.iterFogOpacityTrimHigh, P.iterFogOpacity);
      if (iterFogOpacity > 0.0) {
        let iterFactor1 = (L - P.iterFogOpacityTrim) / (P.iterFogColor1Maxiter - P.iterFogOpacityTrim);
        let k = clamp(iterFactor1, 0.0, 1.0);
        var kn = 1.0 - k;
        iterFogCol = P.iterFogColour1 * kn + P.iterFogColour2 * k;
        let iterFactor2 = (L - P.iterFogColor1Maxiter) / (P.iterFogColor2Maxiter - P.iterFogColor1Maxiter);
        let k2 = clamp(iterFactor2, 0.0, 1.0);
        kn = 1.0 - k2;
        iterFogCol = iterFogCol * kn + P.iterFogColour3 * k2;
      }
    }

    var distFogOpacity = 0.0;
    var distFogColor = vec3f(0.0);
    if (P.volFogEnabled != 0) {
      var distanceShifted = 0.0;
      distFogOpacity = DistanceFogOpacity(step, distance, P.volFogDistanceFromSurface,
        P.volFogDistanceFactor, P.volFogDensity, &distanceShifted);
      var k = distanceShifted / P.volFogColour1Distance;
      if (k > 1.0) { k = 1.0; }
      var kn = 1.0 - k;
      let fogTemp = P.volFogColour1 * kn + P.volFogColour2 * k;
      var k2 = distanceShifted / P.volFogColour2Distance * k;
      if (k2 > 1.0) { k2 = 1.0; }
      kn = 1.0 - k2;
      distFogColor = fogTemp * kn + P.volFogColour3 * k2;
    }

    var totalLightsWithShadows = vec3f(0.0);
    var totalLights = vec3f(0.0);

    for (var l = 0; l < P.numberOfLights; l++) {
      let light = P.lights[l];
      if (light.enabled != 0) {
        var shadowNeeded = false;
        var lightNeeded = false;
        if (iterFogOpacity > 0.0) {
          lightNeeded = true;
          if (P.iterFogShadows != 0) { shadowNeeded = true; }
        }
        if (P.distanceFogShadows != 0 && distFogOpacity > 0.0) {
          lightNeeded = true;
          shadowNeeded = true;
        }
        if (P.fogCastShadows != 0 && basicFogOpacity > 0.0) {
          lightNeeded = true;
          shadowNeeded = true;
        }
        if (light.castShadows == 0 || P.shadowsEnabled == 0 || P.previewMode != 0u) { shadowNeeded = false; }

        if (lightNeeded) {
          var distanceLight = 0.0;
          let lightVectorTemp = CalculateLightVector(light, point, input2.delta, &distanceLight);
          var lightIntensity = 0.0;
          if (light.ltype == lightDirectional) {
            lightIntensity = light.intensity;
          } else if (light.ltype == lightConical) {
            lightIntensity = light.intensity * 10.0;
          } else {
            lightIntensity = light.intensity / LightDecay(distanceLight, light.decayFunction) * 4.0;
          }
          lightIntensity *= CalculateLightCone(light, point, lightVectorTemp);

          var lightShadow = 1.0;
          if (shadowNeeded) {
            if (lightIntensity > 1e-3) {
              lightShadow = AuxShadow(&input2, light, distanceLight, lightVectorTemp, calcParam, light.intensity);
            } else {
              lightShadow = 0.0;
            }
          }
          let calculatedLight = light.color * lightIntensity;
          totalLightsWithShadows += calculatedLight * lightShadow;
          totalLights += calculatedLight;
        }
      }
    }

    var AO = vec3f(0.0);
    if (iterFogOpacity > 0.0 && P.ambientOcclusionEnabled != 0 && P.ambientOcclusionMode == 1
      && P.previewMode == 0u) {
      AO = AmbientOcclusion(&input2, calcParam) * P.ambientOcclusion;
    }

    if (iterFogOpacity > 0.0) {
      var light = totalLights;
      if (P.iterFogShadows != 0) { light = totalLightsWithShadows; }
      if (iterFogOpacity > 1.0) { iterFogOpacity = 1.0; }
      output = output * (1.0 - iterFogOpacity)
        + (light * P.iterFogBrightnessBoost + AO) * iterFogOpacity * iterFogCol;
      totalOpacity = iterFogOpacity + (1.0 - iterFogOpacity) * totalOpacity;
      out4.w = iterFogOpacity + (1.0 - iterFogOpacity) * out4.w;
    }

    if (distFogOpacity > 0.0) {
      var light = vec3f(1.0);
      if (P.distanceFogShadows != 0) { light = totalLightsWithShadows; }
      if (distFogOpacity > 1.0) { distFogOpacity = 1.0; }
      output = distFogOpacity * distFogColor * (light + AO) + (1.0 - distFogOpacity) * output;
      totalOpacity = distFogOpacity + (1.0 - distFogOpacity) * totalOpacity;
      out4.w = distFogOpacity + (1.0 - distFogOpacity) * out4.w;
    }

    if (basicFogOpacity > 0.0) {
      var light = vec3f(1.0);
      if (P.fogCastShadows != 0) { light = totalLightsWithShadows; }
      if (basicFogOpacity > 1.0) { basicFogOpacity = 1.0; }
      output = basicFogOpacity * P.fogColor * (light + AO) + (1.0 - basicFogOpacity) * output;
      totalOpacity = basicFogOpacity + (1.0 - basicFogOpacity) * totalOpacity;
      out4.w = basicFogOpacity + (1.0 - basicFogOpacity) * out4.w;
    }

    if (totalOpacity > 1.0) { totalOpacity = 1.0; }
    if (out4.w > 1.0) { out4.w = 1.0; }
    *opacityOut = totalOpacity;

    if (end) { break; }
  }

  out4 = vec4f(output, out4.w);
  return out4;
}
