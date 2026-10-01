// ============================================================================
//  MATERIAL STUDIO  ·  export/engines/unity.js — Unity .mat and .meta text
// ────────────────────────────────────────────────────────────────────────────
//  unityGuid makes a fixed 32-hex GUID from a path, so a second export
//  keeps the same asset links. unityTexMeta writes the TextureImporter
//  .meta (sRGB, normal map, alpha). unityMat writes the material YAML for
//  URP Lit, HDRP Lit or Built-in Standard: texture slots, floats, colors,
//  keywords and the render queue. matMeta writes the .mat.meta.
//
//  GREP TARGETS
//      unityGuid  UNITY_SHADERS  unityTexMeta  matMeta  unityMat
//      'unity-urp'  'unity-hdrp'  relief  parallax
// ============================================================================
import { f } from '../format.js';

/** Deterministic 32-hex Unity GUID from a string (FNV-1a, four lanes). */
export function unityGuid(s) {
  let out = '';
  for (let lane = 0; lane < 4; lane++) {
    let h = (0x811c9dc5 ^ (lane * 0x9e3779b9)) >>> 0;
    const t = `${lane}:${s}`;
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return out;
}
const UNITY_SHADERS = {
  'unity-urp': { ref: guid => `{fileID: 4800000, guid: ${guid}, type: 3}`, guid: '933532a4fcc9baf4fa0491de14d08ed7', name: 'Universal Render Pipeline/Lit' },
  'unity-hdrp': { ref: guid => `{fileID: 4800000, guid: ${guid}, type: 3}`, guid: '6e4ae4064600d784cac1e41a9e6f2e59', name: 'HDRP/Lit' },
  'unity-builtin': { ref: () => '{fileID: 46, guid: 0000000000000000f000000000000000, type: 0}', guid: '', name: 'Standard' },
};

export function unityTexMeta(guid, { srgb, normal, alpha }) {
  return `fileFormatVersion: 2
guid: ${guid}
TextureImporter:
  internalIDToNameTable: []
  externalObjects: {}
  serializedVersion: 12
  mipmaps:
    mipMapMode: 0
    enableMipMap: 1
    sRGBTexture: ${srgb ? 1 : 0}
    linearTexture: 0
    fadeOut: 0
    borderMipMap: 0
    mipMapsPreserveCoverage: 0
    alphaTestReferenceValue: 0.5
    mipMapFadeDistanceStart: 1
    mipMapFadeDistanceEnd: 3
  bumpmap:
    convertToNormalMap: 0
    externalNormalMap: 0
    heightScale: 0.25
    normalMapFilter: 0
    flipGreenChannel: 0
  isReadable: 0
  streamingMipmaps: 1
  streamingMipmapsPriority: 0
  grayScaleToAlpha: 0
  generateCubemap: 6
  cubemapConvolution: 0
  seamlessCubemap: 0
  textureFormat: 1
  maxTextureSize: 8192
  textureSettings:
    serializedVersion: 2
    filterMode: 1
    aniso: 4
    mipBias: 0
    wrapU: 0
    wrapV: 0
    wrapW: 0
  nPOTScale: 1
  lightmap: 0
  compressionQuality: 50
  alphaUsage: ${alpha ? 1 : 0}
  alphaIsTransparency: 0
  textureType: ${normal ? 1 : 0}
  textureShape: 1
  singleChannelComponent: 0
  userData:
  assetBundleName:
  assetBundleVariant:
`;
}
export const matMeta = guid => `fileFormatVersion: 2
guid: ${guid}
NativeFormatImporter:
  externalObjects: {}
  mainObjectFileID: 2100000
  userData:
  assetBundleName:
  assetBundleVariant:
`;

/** Build the Unity .mat YAML. texGuid: role -> guid. */
export function unityMat(target, o, sc, u, texGuid, shaderGuid) {
  const sh = UNITY_SHADERS[target];
  const name = o.name;
  const T = id => texGuid[id] ? `{fileID: 2800000, guid: ${texGuid[id]}, type: 3}` : '{fileID: 0}';
  const tex = [], floats = [], colors = [], kw = [];
  const addT = (prop, id) => tex.push(`    - ${prop}:\n        m_Texture: ${T(id)}\n        m_Scale: {x: ${f(o.uvScale)}, y: ${f(o.uvScale)}}\n        m_Offset: {x: 0, y: 0}`);
  const addF = (k, v) => floats.push(`    - ${k}: ${f(+v)}`);
  const addC = (k, r, g, b, a = 1) => colors.push(`    - ${k}: {r: ${f(r)}, g: ${f(g)}, b: ${f(b)}, a: ${f(a)}}`);
  const mode = sc.alphaMode, es = sc.emissiveStrength * (u?.emissiveScale ?? 1);
  const emissive = !!texGuid.emissive;
  // The studio moves a vertex by (h - 0.5) * 2 * displacementScale (pbr.wgsl
  // displace), so the total relief from h = 0 to h = 1 is 2 * displacementScale.
  const relief = 2 * sc.displacementScale;
  const parallax = Math.min(0.08, Math.max(0.005, relief));
  let queue = -1, tags = 'Opaque';
  if (target === 'unity-urp') {
    addT('_BaseMap', 'base'); addT('_MainTex', 'base');
    addT('_MetallicGlossMap', 'mask'); addT('_BumpMap', 'normal'); addT('_OcclusionMap', 'ao');
    addT('_ParallaxMap', 'height'); addT('_EmissionMap', 'emissive'); addT('_ClearCoatMap', 'clearcoat');
    addT('_SpecGlossMap', null); addT('_DetailAlbedoMap', null); addT('_DetailNormalMap', null); addT('_DetailMask', null);
    addF('_WorkflowMode', 1); addF('_Metallic', 1); addF('_Smoothness', 1); addF('_Glossiness', 1); addF('_GlossMapScale', 1);
    addF('_SmoothnessTextureChannel', 0); addF('_BumpScale', 1); addF('_OcclusionStrength', 1);
    addF('_Parallax', texGuid.height ? parallax : 0.005);
    addF('_Surface', mode === 'blend' ? 1 : 0); addF('_Blend', 0); addF('_AlphaClip', mode === 'mask' ? 1 : 0);
    addF('_Cutoff', sc.alphaCutoff); addF('_Cull', sc.doubleSided ? 0 : 2);
    addF('_SrcBlend', mode === 'blend' ? 5 : 1); addF('_DstBlend', mode === 'blend' ? 10 : 0);
    addF('_SrcBlendAlpha', 1); addF('_DstBlendAlpha', mode === 'blend' ? 10 : 0); addF('_ZWrite', mode === 'blend' ? 0 : 1);
    addF('_ReceiveShadows', 1); addF('_SpecularHighlights', 1); addF('_EnvironmentReflections', 1); addF('_QueueOffset', 0);
    addF('_ClearCoat', texGuid.clearcoat ? 1 : 0); addF('_ClearCoatMask', 1); addF('_ClearCoatSmoothness', 1);
    addC('_BaseColor', 1, 1, 1, 1); addC('_Color', 1, 1, 1, 1);
    addC('_EmissionColor', emissive ? es : 0, emissive ? es : 0, emissive ? es : 0, 1); addC('_SpecColor', 0.2, 0.2, 0.2, 1);
    kw.push('_METALLICSPECGLOSSMAP', '_NORMALMAP', '_OCCLUSIONMAP');
    if (texGuid.height) kw.push('_PARALLAXMAP');
    if (emissive) kw.push('_EMISSION');
    if (texGuid.clearcoat) kw.push('_CLEARCOAT', '_CLEARCOATMAP');
    if (mode === 'mask') { kw.push('_ALPHATEST_ON'); queue = 2450; tags = 'TransparentCutout'; }
    if (mode === 'blend') { kw.push('_SURFACE_TYPE_TRANSPARENT'); queue = 3000; tags = 'Transparent'; }
  } else if (target === 'unity-hdrp') {
    addT('_BaseColorMap', 'base'); addT('_MainTex', 'base'); addT('_MaskMap', 'mask'); addT('_NormalMap', 'normal');
    addT('_HeightMap', 'height'); addT('_EmissiveColorMap', 'emissive'); addT('_CoatMaskMap', 'clearcoat');
    addF('_Metallic', 1); addF('_Smoothness', 1); addF('_MetallicRemapMin', 0); addF('_MetallicRemapMax', 1);
    addF('_SmoothnessRemapMin', 0); addF('_SmoothnessRemapMax', 1); addF('_AORemapMin', 0); addF('_AORemapMax', 1);
    addF('_NormalScale', 1); addF('_NormalMapSpace', 0); addF('_MaterialID', 1);
    // HDRP MinMax height: _HeightMin/_HeightMax in cm, _HeightAmplitude in m.
    addF('_HeightAmplitude', relief); addF('_HeightCenter', 0.5); addF('_HeightMapParametrization', 0);
    addF('_HeightMin', -sc.displacementScale * 100); addF('_HeightMax', sc.displacementScale * 100);
    addF('_HeightPoMAmplitude', Math.max(0.1, relief * 100)); addF('_DisplacementMode', texGuid.height ? 2 : 0);
    addF('_PPDMinSamples', 5); addF('_PPDMaxSamples', 15);
    addF('_CoatMask', texGuid.clearcoat ? 1 : 0);
    addF('_SurfaceType', mode === 'blend' ? 1 : 0); addF('_AlphaCutoffEnable', mode === 'mask' ? 1 : 0); addF('_AlphaCutoff', sc.alphaCutoff);
    addF('_DoubleSidedEnable', sc.doubleSided ? 1 : 0); addF('_CullMode', sc.doubleSided ? 0 : 2);
    addF('_UseEmissiveIntensity', 0); addF('_EmissiveIntensity', 1); addF('_EmissiveExposureWeight', 1);
    addF('_ZWrite', mode === 'blend' ? 0 : 1);
    addC('_BaseColor', 1, 1, 1, 1); addC('_Color', 1, 1, 1, 1);
    addC('_EmissiveColor', emissive ? es : 0, emissive ? es : 0, emissive ? es : 0, 1); addC('_EmissiveColorLDR', 1, 1, 1, 1);
    kw.push('_MASKMAP', '_NORMALMAP', '_NORMALMAP_TANGENT_SPACE');
    if (texGuid.height) kw.push('_HEIGHTMAP', '_PIXEL_DISPLACEMENT');
    if (emissive) kw.push('_EMISSIVE_COLOR_MAP');
    if (texGuid.clearcoat) kw.push('_MATERIAL_FEATURE_CLEAR_COAT');
    if (mode === 'mask') { kw.push('_ALPHATEST_ON'); queue = 2475; tags = 'TransparentCutout'; }
    if (mode === 'blend') { kw.push('_SURFACE_TYPE_TRANSPARENT', '_BLENDMODE_ALPHA'); queue = 3000; tags = 'Transparent'; }
    if (sc.doubleSided) kw.push('_DOUBLESIDED_ON');
  } else {
    addT('_MainTex', 'base'); addT('_MetallicGlossMap', 'mask'); addT('_BumpMap', 'normal'); addT('_OcclusionMap', 'ao');
    addT('_ParallaxMap', 'height'); addT('_EmissionMap', 'emissive'); addT('_DetailAlbedoMap', null); addT('_DetailNormalMap', null); addT('_DetailMask', null);
    const m = mode === 'mask' ? 1 : mode === 'blend' ? 3 : 0;
    addF('_Mode', m); addF('_Cutoff', sc.alphaCutoff); addF('_Glossiness', 0.5); addF('_GlossMapScale', 1); addF('_SmoothnessTextureChannel', 0);
    addF('_Metallic', 0); addF('_BumpScale', 1); addF('_OcclusionStrength', 1); addF('_Parallax', texGuid.height ? parallax : 0.02);
    addF('_SrcBlend', m === 3 ? 1 : 1); addF('_DstBlend', m === 3 ? 10 : 0); addF('_ZWrite', m === 3 ? 0 : 1);
    addF('_UVSec', 0); addF('_SpecularHighlights', 1); addF('_GlossyReflections', 1);
    addC('_Color', 1, 1, 1, 1); addC('_EmissionColor', emissive ? es : 0, emissive ? es : 0, emissive ? es : 0, 1);
    kw.push('_METALLICGLOSSMAP', '_NORMALMAP');
    if (texGuid.height) kw.push('_PARALLAXMAP');
    if (emissive) kw.push('_EMISSION');
    if (m === 1) { kw.push('_ALPHATEST_ON'); queue = 2450; tags = 'TransparentCutout'; }
    if (m === 3) { kw.push('_ALPHAPREMULTIPLY_ON'); queue = 3000; tags = 'Transparent'; }
  }
  const head = `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
# Generated by Stella Nova PBR Material Studio.
# Shader: ${sh.name}${sh.guid ? ` (GUID ${shaderGuid || sh.guid}).
# If the material shows as pink or "missing shader", select it and set the
# shader to ${sh.name} by hand. The texture slots stay assigned.` : '.'}
--- !u!21 &2100000
Material:
  serializedVersion: ${target === 'unity-builtin' ? 6 : 8}
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Name: ${name}
  m_Shader: ${sh.ref(shaderGuid || sh.guid)}
`;
  const kwBlock = target === 'unity-builtin'
    ? `  m_ShaderKeywords: ${kw.join(' ')}\n`
    : `  m_Parent: {fileID: 0}\n  m_ModifiedSerializedProperties: 0\n  m_ValidKeywords:\n${kw.map(k => `  - ${k}`).join('\n')}\n  m_InvalidKeywords: []\n`;
  return head + kwBlock + `  m_LightmapFlags: ${emissive ? 2 : 4}
  m_EnableInstancingVariants: 0
  m_DoubleSidedGI: ${sc.doubleSided ? 1 : 0}
  m_CustomRenderQueue: ${queue}
  stringTagMap:
    RenderType: ${tags}
  disabledShaderPasses: []
  m_SavedProperties:
    serializedVersion: 3
    m_TexEnvs:
${tex.join('\n')}
    m_Ints: []
    m_Floats:
${floats.join('\n')}
    m_Colors:
${colors.join('\n')}
  m_BuildTextureStacks: []
`;
}
