// render_params.wgsl - render parameter structs and engine bindings for the Mandelbulber WebGPU port.
// Ported from Mandelbulber v2 (opencl/fractparams_cl.hpp, light_cl.h, material_cl.h,
// fractal_coloring_cl.hpp, hybrid_sequence_cl.h). A subset of sParamRenderCl in one struct.
// Copyright (C) 2017-24 Mandelbulber Team, Krzysztof Marczak and contributors.
// Mandelbulber is free software under the GNU General Public License v3 or later.
// This port is also GPL-3.0. See COPYING in the page folder.
//
// params.js parses the structs in this file to compute byte offsets, so every field here is
// host-shareable (f32, i32, u32, vec3f, vec4f, arrays, nested structs). Add a field here and
// params.js packs it by name with no other change.
//
// grep: RenderParams SlotData LightCl MaterialCl FractalColoringCl P FR SEQ ACC CalcParams
//       MAX_SLOTS MAX_LIGHTS PALETTE_SIZE calcModeNormal calcModeColouring

const MAX_SLOTS: u32 = 9u;
const MAX_LIGHTS: u32 = 4u;
const PALETTE_SIZE: u32 = 128u;

// per-slot data of the hybrid sequence (sHybridFractalDataCl without the sFractalCl copy)
struct SlotData {
  formulaCase: i32,       // case index in callFormula()
  formulaId: i32,         // upstream enumFractalFormula id (8 = mandelbox, 64 aboxMod1, 73 amazingSurf)
  formulaWeight: f32,
  bailout: f32,
  addCConstant: i32,
  checkForBailout: i32,
  useAdditionalBailoutCond: i32,
  pad0: i32,
}

// sLightCl subset
struct LightCl {
  color: vec3f,
  intensity: f32,
  position: vec3f,
  size: f32,
  targetPos: vec3f,     // 'target' is a WGSL reserved word
  visibility: f32,
  lightDirection: vec3f,
  softShadowCone: f32,
  contourSharpness: f32,
  coneRatio: f32,
  coneSoftRatio: f32,
  volumetricVisibility: f32,
  enabled: i32,
  castShadows: i32,
  penetrating: i32,
  volumetric: i32,
  ltype: i32,             // enumLightTypeCl: 0 directional, 1 point, 2 conical, 3 projection, 4 beam
  decayFunction: i32,     // enumLightDecayFunctionCl
  pad0: i32,
  pad1: i32,
}

// sFractalColoringCl (complete)
struct FractalColoringCl {
  lineDirection: vec4f,
  xyz000: vec3f,
  addMax: f32,
  xyzC111: vec3f,
  addSpread: f32,
  addStartValue: f32,
  auxColorHybridWeight: f32,
  auxColorWeight: f32,
  cosAdd: f32,
  cosPeriod: f32,
  cosStartValue: f32,
  hybridAuxColorScale1: f32,
  hybridOrbitTrapScale1: f32,
  hybridRadDivDeScale1: f32,
  icRadWeight: f32,
  initialColorValue: f32,
  iterAddScale: f32,
  iterScale: f32,
  maxColorValue: f32,
  minColorValue: f32,
  orbitTrapWeight: f32,
  parabScale: f32,
  parabStartValue: f32,
  radDivDeWeight: f32,
  radWeight: f32,
  roundScale: f32,
  sphereRadius: f32,
  xyzIterScale: f32,
  addEnabledFalse: i32,
  auxColorFalse: i32,
  color4dEnabledFalse: i32,
  colorPreV215False: i32,
  cosEnabledFalse: i32,
  extraColorOptionsEnabledFalse: i32,
  extraColorEnabledFalse: i32,
  globalPaletteFalse: i32,
  icFabsFalse: i32,
  icRadFalse: i32,
  icXYZFalse: i32,
  initCondFalse: i32,
  iterAddScaleTrue: i32,
  iterGroupFalse: i32,
  iterScaleFalse: i32,
  orbitTrapTrue: i32,
  parabEnabledFalse: i32,
  radDiv1e13False: i32,
  radDivDE1e13False: i32,
  radDivDeFalse: i32,
  radDivDeSquaredFalse: i32,
  radFalse: i32,
  radSquaredFalse: i32,
  roundEnabledFalse: i32,
  xyzBiasEnabledFalse: i32,
  xyzDiv1e13False: i32,
  xyzFabsFalse: i32,
  xyzXSqrdFalse: i32,
  xyzYSqrdFalse: i32,
  xyzZSqrdFalse: i32,
  tempLimitFalse: i32,
  iStartValue: i32,
  coloringAlgorithm: i32,  // enumFractalColoringCl
}

// sMaterialCl subset (material 1) plus palette offsets into RenderParams.palette
struct MaterialCl {
  fractalColoring: FractalColoringCl,
  color: vec3f,
  shading: f32,
  specularColor: vec3f,
  specular: f32,
  luminosityColor: vec3f,
  luminosity: f32,
  specularWidth: f32,
  specularMetallic: f32,
  specularMetallicRoughness: f32,
  specularMetallicWidth: f32,
  paletteOffset: f32,
  coloring_speed: f32,
  surfaceRoughness: f32,
  luminosityEmissive: f32,
  useColorsFromPalette: i32,
  specularPlasticEnable: i32,
  metallic: i32,
  roughSurface: i32,
  surfaceGradientEnable: i32,
  specularGradientEnable: i32,
  diffuseGradientEnable: i32,
  luminosityGradientEnable: i32,
  paletteSurfaceOffset: i32,
  paletteSurfaceLength: i32,
  paletteSpecularOffset: i32,
  paletteSpecularLength: i32,
  paletteDiffuseOffset: i32,
  paletteDiffuseLength: i32,
  paletteLuminosityOffset: i32,
  paletteLuminosityLength: i32,
}

struct RenderParams {
  // camera (upstream: camera, target, camera_top, fov after CalcFOV, resolution = 1 / image height)
  camera: vec3f,
  fov: f32,
  targetPoint: vec3f,   // camera target ('target' is a WGSL reserved word)
  resolution: f32,
  rotM1: vec3f,           // rows of the main rotation matrix (rot in full_engine.cl)
  width: f32,
  rotM2: vec3f,
  height: f32,
  rotM3: vec3f,
  perspectiveType: i32,   // 0 three point, 1 fish eye, 2 equirectangular, 3 fish eye cut
  legacyCoordinateSystem: i32,
  sampleIndex: u32,
  bandIndex: u32,       // this dispatch renders the 8-row stripes s with s % bandCount == bandIndex
  bandCount: u32,
  jitterEnable: u32,
  frameSeed: u32,
  previewMode: u32,     // 1 while the user drags: no AO, no shadow rays, no volumetric march
  pad1: u32,

  // ray-marching quality
  N: i32,
  minN: i32,
  maxRaymarching: i32,
  iterThreshMode: i32,
  DEFactor: f32,
  detailLevel: f32,
  DEThresh: f32,
  constantDEThreshold: i32,
  smoothness: f32,
  viewDistanceMax: f32,
  viewDistanceMin: f32,
  deltaDERelativeDelta: f32,
  advancedQuality: i32,
  absMinMarchingStep: f32,
  absMaxMarchingStep: f32,
  relMinMarchingStep: f32,
  relMaxMarchingStep: f32,
  detailSizeMin: f32,
  detailSizeMax: f32,
  linearDEOffset: f32,
  limitsEnabled: i32,
  interiorMode: i32,
  pad2: i32,
  pad3: i32,
  limitMin: vec3f,
  pad4: f32,
  limitMax: vec3f,
  pad5: f32,
  fractalPosition: vec3f,
  pad6: f32,
  repeat: vec3f,
  pad7: f32,
  mRotFractal1: vec3f,
  pad8: f32,
  mRotFractal2: vec3f,
  pad9: f32,
  mRotFractal3: vec3f,
  pad10: f32,

  // hybrid sequence (sHybridSequenceCl)
  juliaConstant: vec3f,
  initialWAxis: f32,
  constantMultiplier: vec3f,
  formulaMaxiter: i32,
  seqLength: i32,
  isHybrid: i32,
  juliaEnabled: i32,
  DEType: i32,            // enumDETypeCl: 0 analytic, 1 delta
  DEFunctionType: i32,    // enumDEFunctionTypeCl
  DEAnalyticFunction: i32,// enumDEAnalyticFunctionCl
  coloringFunction: i32,  // enumColoringFunctionCl
  iterationWeight: i32,   // ITERATION_WEIGHT define
  slots: array<SlotData, 9>,

  // shaders
  ambientOcclusionEnabled: i32,
  ambientOcclusionMode: i32,  // 0 fast, 1 multiple rays, 2 screen space (runs as multiple rays here)
  ambientOcclusionQuality: f32,
  ambientOcclusion: f32,
  ambientOcclusionColor: vec3f,
  ambientOcclusionFastTune: f32,
  fillLightColor: vec3f,
  numberOfLights: i32,

  background3ColorsEnable: i32,
  background_brightness: f32,
  background_gamma: f32,
  shadowsEnabled: i32,
  background_color1: vec3f,
  pad11: f32,
  background_color2: vec3f,
  pad12: f32,
  background_color3: vec3f,
  pad13: f32,

  glowEnabled: i32,
  glowIntensity: f32,
  fogEnabled: i32,
  fogVisibility: f32,
  glowColor1: vec3f,
  fogCastShadows: i32,
  glowColor2: vec3f,
  volFogEnabled: i32,
  fogColor: vec3f,
  volFogDensity: f32,
  volFogColour1: vec3f,
  volFogDistanceFactor: f32,
  volFogColour2: vec3f,
  volFogDistanceFromSurface: f32,
  volFogColour3: vec3f,
  volFogColour1Distance: f32,
  volFogColour2Distance: f32,
  distanceFogShadows: i32,
  iterFogEnabled: i32,
  iterFogShadows: i32,
  iterFogColour1: vec3f,
  iterFogOpacity: f32,
  iterFogColour2: vec3f,
  iterFogOpacityTrim: f32,
  iterFogColour3: vec3f,
  iterFogOpacityTrimHigh: f32,
  iterFogColor1Maxiter: f32,
  iterFogColor2Maxiter: f32,
  iterFogBrightnessBoost: f32,
  volumetricLightDEFactor: f32,
  simpleGlow: i32,
  cloudsPeriod: f32,       // caps the volumetric step as lastCloudDistance does upstream
  pad15: i32,
  pad16: i32,

  lights: array<LightCl, 4>,
  material: MaterialCl,
  palette: array<vec4f, 128>,
}

// sClCalcParams
struct CalcParams {
  N: i32,
  deltaDEMaxN: i32,
  randomSeed: i32,
  iterThreshMode: i32,
  normalCalculationMode: i32,
  orbitTrapIndex: i32,
  distThresh: f32,
  detailSize: f32,
}

// enumCalculationModeCl
const calcModeNormal: i32 = 0;
const calcModeColouring: i32 = 1;
const calcModeFake_AO: i32 = 2;
const calcModeDeltaDE1: i32 = 3;
const calcModeDeltaDE2: i32 = 4;
const calcModeOrbitTrap: i32 = 5;
const calcModeCubeOrbitTrap: i32 = 6;

@group(0) @binding(0) var<storage, read> P: RenderParams;
@group(0) @binding(1) var<storage, read> FR: array<Fractal>;
@group(0) @binding(2) var<storage, read> SEQ: array<i32>;
@group(0) @binding(3) var<storage, read_write> ACC: array<vec4f>;
