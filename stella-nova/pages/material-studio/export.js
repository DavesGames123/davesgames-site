// ============================================================================
//  MATERIAL STUDIO  ·  export.js — engine packages, project files, export UI
// ────────────────────────────────────────────────────────────────────────────
//  Owner: IO agent. Reads the baked MaterialMaps back from the GPU, packs the
//  channels the way each engine wants them, encodes the images and writes a
//  zip (or a .glb for glTF). It also saves the studio project.
//
//  UI PLACEMENT  (placeUI runs on boot:done, after panels.js init)
//      panels.js owns #export-panel: this module appends an .io-extra block
//      (package details, channel layout, last export, project, import) and a
//      MutationObserver puts it back after each panels re-render. Without
//      panels.js it mounts the full panel and the Open/Save/Import/Export
//      buttons in #tb-file. Ctrl+S (project with images) and Ctrl+O (any file)
//      are captured on window before the panels.js graph-JSON shortcuts.
//
//  DATA FLOW
//      state.maps (rgba16float GPUTextures, linear)            contract.js
//        └─ withMaps(res)  same res: use state.maps; other res: bake.bakeAt(res)
//           or bake.bakeOnce(res) if the bake module has one, else swap the
//           preview res and wait for bake:done, then restore it
//        └─ MapSource.get(slot)  __studio.bake.readback(slot, {maps}) or own
//           copyTextureToBuffer ─▶ Uint16Array of half bits, res*res*4
//        └─ computeStats  min/max/mean per channel ─▶ "used" flags, constant
//           folding, emissive peak normalization
//        └─ plan(target)  file list: per file the channel sources and ops
//           (srgb, invert, DirectX green flip, gain), bit depth, format
//        └─ packImage ─▶ encodePNG / encodeTGA / encodeEXR (zip.js)
//        └─ text files  Unity .mat + .meta, Unreal import .py, Godot .tres,
//           README.txt, project .studio.json
//        └─ makeZip (zip.js) or buildGLB (glb.js) ─▶ Blob ─▶ download
//
//  CHANNEL PACKING  (all normals leave the bake as OpenGL +Y, n*0.5+0.5)
//      Unity URP      _BaseMap rgba | _MetallicGlossMap R metal A smooth |
//                     _BumpMap +Y | _OcclusionMap | _ParallaxMap | _EmissionMap
//                     | _ClearCoatMap R mask G smooth (Complex Lit)
//      Unity HDRP     _BaseColorMap | _MaskMap R metal G ao B detail A smooth |
//                     _NormalMap +Y | _HeightMap | _EmissiveColorMap | _CoatMaskMap
//      Unity Built-in _MainTex | _MetallicGlossMap R metal A smooth | _BumpMap
//                     | _OcclusionMap | _ParallaxMap | _EmissionMap
//      Unreal         BC (A opacity) | N  -Y (green flipped) | ORM | H | E | CC
//      Godot 4        albedo | normal +Y | orm | height | emission | clearcoat
//      glTF 2.0       baseColor | ORM shared by occlusion + metallicRoughness |
//                     normal | emissive | KHR clearcoat, sheen, anisotropy,
//                     ior, transmission, emissive_strength, texture_transform
//      PNG            one file per chosen map, naming template
//
//  SECTIONS  (grep -n the banner to jump)
//      half LUTs ........ half bits -> float / 8-bit linear / 8-bit sRGB
//      graph access ..... graphJSON, outputParams, scalarsNow, materialName
//      readback ......... readTexture, MapSource
//      maps at res ...... withMaps, waitBake
//      stats ............ computeStats, usedFlags
//      packing .......... packImage, ch() channel spec helpers
//      plans ............ PLANS: one planner per EXPORT_TARGETS id
//      unity yaml ....... unityGuid, unityMat, unityTexMeta
//      unreal py ........ unrealScript
//      godot tres ....... godotTres
//      gltf ............. gltfPackage
//      readme ........... readmeText
//      exportPackage .... the public entry
//      project .......... projectJSON, saveProject, copyMaterialJSON
//      ui ............... mountExportUI, placeUI, layout table, progress, topbar, keys
//      selfTest / init
// ============================================================================
import {
  EXPORT_TARGETS, MAP_SLOTS, MAP_NAMES, DEFAULT_SCALARS, RES_OPTIONS, GRAPH_VERSION,
} from './contract.js';
import { makeZip, encodePNG, crc32, decodePNG, readZip } from './zip.js';
import { buildGLB, uvSphere, parseGLB } from './glb.js';
import * as IMP from './import.js';

import { C, S, UI, last, bind, setLast, err } from './export/ctx.js';
import { H2F, luts, linToSrgb } from './export/half.js';
import { f, fmtSize } from './export/format.js';
import { graphJSON, scalarsNow, sanitize, materialName } from './export/graph-access.js';
import { readTexture, MapSource } from './export/readback.js';
import { withMaps } from './export/maps.js';
import { computeStats, usedFlags } from './export/stats.js';
import { ch, chLabel, packImage } from './export/pack.js';
import { PLANS, PLAIN_MAPS, FORMATS, resolvePlan, baseRGB, gray } from './export/plans.js';
import { DEFAULT_OPTS, OPTS, saveOpts } from './export/options.js';

export { linToSrgb, scalarsNow, readTexture, PLAIN_MAPS, FORMATS };
let busy = false;

// ------------------------------------------------------------ unity yaml
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

function unityTexMeta(guid, { srgb, normal, alpha }) {
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
const matMeta = guid => `fileFormatVersion: 2
guid: ${guid}
NativeFormatImporter:
  externalObjects: {}
  mainObjectFileID: 2100000
  userData:
  assetBundleName:
  assetBundleVariant:
`;

/** Build the Unity .mat YAML. texGuid: role -> guid. */
function unityMat(target, o, sc, u, texGuid, shaderGuid) {
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

// ------------------------------------------------------------ unreal py
function pyStr(s) { return JSON.stringify(String(s)); }
function unrealScript(o, sc, u, files) {
  const tex = files.map(fi => {
    const comp = fi.key === 'normal' ? 'TC_NORMALMAP' : fi.key === 'height' ? (fi.bits === 16 ? 'TC_GRAYSCALE' : 'TC_GRAYSCALE') : (fi.key === 'orm' || fi.key === 'clearcoat') ? 'TC_MASKS' : 'TC_DEFAULT';
    return `    ${pyStr(fi.key)}: (${pyStr(fi.name)}, ${fi.color === 'sRGB' ? 'True' : 'False'}, ${pyStr(comp)}),`;
  }).join('\n');
  const blend = sc.alphaMode === 'mask' ? 'BLEND_MASKED' : sc.alphaMode === 'blend' ? 'BLEND_TRANSLUCENT' : 'BLEND_OPAQUE';
  return `# -*- coding: utf-8 -*-
# Unreal Editor import script, generated by Stella Nova PBR Material Studio.
#
# Use: Unreal Editor > Tools > Execute Python Script... and pick this file.
# The Python Editor Script Plugin must be on (Edit > Plugins > Python).
# The script imports the textures next to it with the correct compression
# and sRGB settings, then builds M_${o.name} with every map connected.
# Edit DEST to change the content folder. Run it again to update in place.
import os
import unreal

MATERIAL_NAME = ${pyStr('M_' + o.name)}
DEST = ${pyStr(o.unrealDest.replace(/\{name\}/g, o.name))}
UV_TILING = ${f(o.uvScale)}
EMISSIVE_STRENGTH = ${f(sc.emissiveStrength * (u?.emissiveScale ?? 1))}
HEIGHT_RATIO = ${f(Math.min(0.1, 2 * sc.displacementScale))}
USE_PARALLAX = ${files.some(x => x.key === 'height') ? 'True' : 'False'}
BLEND_MODE = ${pyStr(blend)}
OPACITY_CLIP = ${f(sc.alphaCutoff)}
TWO_SIDED = ${sc.doubleSided ? 'True' : 'False'}
USE_OPACITY = ${u?.opacity || sc.alphaMode !== 'opaque' ? 'True' : 'False'}

# key: (file name, sRGB, compression setting)
TEXTURES = {
${tex}
}

try:
    HERE = os.path.dirname(os.path.abspath(__file__))
except NameError:
    HERE = os.getcwd()

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary


def import_texture(key):
    fname, srgb, comp = TEXTURES[key]
    path = os.path.join(HERE, fname)
    if not os.path.isfile(path):
        unreal.log_warning("missing texture %s" % path)
        return None
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", path)
    task.set_editor_property("destination_path", DEST)
    task.set_editor_property("destination_name", os.path.splitext(fname)[0])
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", False)
    asset_tools.import_asset_tasks([task])
    tex = unreal.load_asset(DEST + "/" + os.path.splitext(fname)[0])
    if tex is None:
        unreal.log_error("import failed: %s" % path)
        return None
    tex.set_editor_property("srgb", srgb)
    tex.set_editor_property("compression_settings", getattr(unreal.TextureCompressionSettings, comp))
    if comp == "TC_NORMALMAP":
        # the file is already DirectX (green flipped); do not flip again
        tex.set_editor_property("flip_green_channel", False)
    eal.save_loaded_asset(tex)
    return tex


def sampler_type(key):
    if key == "normal":
        return unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL
    if key in ("orm", "clearcoat"):
        return unreal.MaterialSamplerType.SAMPLERTYPE_MASKS
    if key == "height":
        return unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_GRAYSCALE
    return unreal.MaterialSamplerType.SAMPLERTYPE_COLOR


def main():
    textures = {k: import_texture(k) for k in TEXTURES}
    path = DEST + "/" + MATERIAL_NAME
    if eal.does_asset_exist(path):
        mat = unreal.load_asset(path)
        mel.delete_all_material_expressions(mat)
    else:
        mat = asset_tools.create_asset(MATERIAL_NAME, DEST, unreal.Material, unreal.MaterialFactoryNew())

    mat.set_editor_property("blend_mode", getattr(unreal.BlendMode, BLEND_MODE))
    mat.set_editor_property("two_sided", TWO_SIDED)
    if BLEND_MODE == "BLEND_MASKED":
        mat.set_editor_property("opacity_mask_clip_value", OPACITY_CLIP)
    if textures.get("clearcoat"):
        mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_CLEAR_COAT)

    coord = mel.create_material_expression(mat, unreal.MaterialExpressionTextureCoordinate, -1400, 0)
    coord.set_editor_property("u_tiling", UV_TILING)
    coord.set_editor_property("v_tiling", UV_TILING)
    uv = coord

    if USE_PARALLAX and textures.get("height"):
        hs = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSampleParameter2D, -1150, 500)
        hs.set_editor_property("parameter_name", "Height")
        hs.set_editor_property("texture", textures["height"])
        hs.set_editor_property("sampler_type", sampler_type("height"))
        mel.connect_material_expressions(coord, "", hs, "UVs")
        ratio = mel.create_material_expression(mat, unreal.MaterialExpressionScalarParameter, -1150, 700)
        ratio.set_editor_property("parameter_name", "HeightRatio")
        ratio.set_editor_property("default_value", HEIGHT_RATIO)
        bump = mel.create_material_expression(mat, unreal.MaterialExpressionBumpOffset, -900, 400)
        mel.connect_material_expressions(coord, "", bump, "Coordinate")
        mel.connect_material_expressions(hs, "R", bump, "Height")
        mel.connect_material_expressions(ratio, "", bump, "HeightRatioInput")
        uv = bump

    def sample(key, name, x, y):
        tex = textures.get(key)
        if tex is None:
            return None
        e = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSampleParameter2D, x, y)
        e.set_editor_property("parameter_name", name)
        e.set_editor_property("texture", tex)
        e.set_editor_property("sampler_type", sampler_type(key))
        mel.connect_material_expressions(uv, "", e, "UVs")
        return e

    MP = unreal.MaterialProperty
    bc = sample("base", "BaseColor", -600, -300)
    if bc:
        mel.connect_material_property(bc, "RGB", MP.MP_BASE_COLOR)
        if USE_OPACITY and BLEND_MODE == "BLEND_MASKED":
            mel.connect_material_property(bc, "A", MP.MP_OPACITY_MASK)
        elif USE_OPACITY and BLEND_MODE == "BLEND_TRANSLUCENT":
            mel.connect_material_property(bc, "A", MP.MP_OPACITY)
    orm = sample("orm", "ORM", -600, 0)
    if orm:
        mel.connect_material_property(orm, "R", MP.MP_AMBIENT_OCCLUSION)
        mel.connect_material_property(orm, "G", MP.MP_ROUGHNESS)
        mel.connect_material_property(orm, "B", MP.MP_METALLIC)
    nrm = sample("normal", "Normal", -600, 300)
    if nrm:
        mel.connect_material_property(nrm, "RGB", MP.MP_NORMAL)
    em = sample("emissive", "Emissive", -600, 600)
    if em:
        k = mel.create_material_expression(mat, unreal.MaterialExpressionScalarParameter, -600, 800)
        k.set_editor_property("parameter_name", "EmissiveStrength")
        k.set_editor_property("default_value", EMISSIVE_STRENGTH)
        mul = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, -300, 650)
        mel.connect_material_expressions(em, "RGB", mul, "A")
        mel.connect_material_expressions(k, "", mul, "B")
        mel.connect_material_property(mul, "", MP.MP_EMISSIVE_COLOR)
    cc = sample("clearcoat", "ClearCoat", -600, 900)
    if cc:
        mel.connect_material_property(cc, "R", MP.MP_CUSTOM_DATA0)
        mel.connect_material_property(cc, "G", MP.MP_CUSTOM_DATA1)

    mel.layout_material_expressions(mat)
    mel.recompile_material(mat)
    eal.save_asset(path)
    unreal.log("Stella Nova material imported: %s" % path)


main()
`;
}

// ------------------------------------------------------------ godot tres
function godotTres(o, sc, u, files, st) {
  const res = [], props = [];
  const id = {};
  files.forEach((fi, i) => {
    id[fi.key] = `${i + 1}_${fi.key}`;
    res.push(`[ext_resource type="Texture2D" path="${o.godotRoot.replace(/\{name\}/g, o.name).replace(/\/+$/, '')}/${fi.name}" id="${id[fi.key]}"]`);
  });
  const E = k => `ExtResource("${id[k]}")`;
  props.push(`resource_name = "${o.name}"`);
  if (sc.alphaMode === 'blend') props.push('transparency = 1');
  if (sc.alphaMode === 'mask') props.push('transparency = 2', `alpha_scissor_threshold = ${f(sc.alphaCutoff)}`);
  if (sc.doubleSided) props.push('cull_mode = 2');
  if (id.base) props.push(`albedo_texture = ${E('base')}`);
  if (id.orm) {
    props.push('metallic = 1.0', 'metallic_specular = 0.5', `metallic_texture = ${E('orm')}`, 'metallic_texture_channel = 2',
      'roughness = 1.0', `roughness_texture = ${E('orm')}`, 'roughness_texture_channel = 1',
      'ao_enabled = true', `ao_texture = ${E('orm')}`, 'ao_texture_channel = 0');
  }
  if (id.normal) props.push('normal_enabled = true', 'normal_scale = 1.0', `normal_texture = ${E('normal')}`);
  if (id.emissive) props.push('emission_enabled = true', 'emission = Color(1, 1, 1, 1)', `emission_energy_multiplier = ${f(sc.emissiveStrength * (u?.emissiveScale ?? 1))}`, `emission_texture = ${E('emissive')}`);
  if (id.height) props.push('heightmap_enabled = true', `heightmap_scale = ${f(Math.min(16, sc.displacementScale * 200))}`, 'heightmap_deep_parallax = true', `heightmap_texture = ${E('height')}`);
  if (id.clearcoat) props.push('clearcoat_enabled = true', 'clearcoat = 1.0', 'clearcoat_roughness = 1.0', `clearcoat_texture = ${E('clearcoat')}`);
  if (u?.anisotropy && st?.extra) props.push('anisotropy_enabled = true', `anisotropy = ${f(st.extra.mean[3])}`);
  if (u?.sheen && st?.extra) props.push('rim_enabled = true', `rim = ${f(st.extra.mean[2])}`, 'rim_tint = 0.5');
  if (sc.transmission > 0) props.push('refraction_enabled = true', `refraction_scale = ${f(sc.transmission * 0.05)}`);
  if (o.uvScale !== 1) props.push(`uv1_scale = Vector3(${f(o.uvScale)}, ${f(o.uvScale)}, 1)`);
  return `[gd_resource type="StandardMaterial3D" load_steps=${files.length + 1} format=3]\n\n${res.join('\n')}\n\n[resource]\n${props.join('\n')}\n`;
}

// ------------------------------------------------------------ gltf
async function previewMesh(o, src, sc) {
  let mesh = null;
  try {
    const vp = window.__studio?.viewport;
    if (vp && typeof vp.meshData === 'function') mesh = await vp.meshData();
    if (!mesh) {
      const M = await import('./mesh.js');
      mesh = M.buildMesh(o.mesh || S.view.mesh || 'sphere', { subdiv: Math.min(S.view.subdiv || 96, 128) });
    }
  } catch (e) { mesh = null; }
  if (!mesh || !mesh.positions || !mesh.positions.length) mesh = uvSphere(96);
  // tangents are rebuilt by glb.js with the glTF handedness rule, so the
  // viewport tangent convention does not leak into the file
  mesh = { positions: Float32Array.from(mesh.positions), normals: mesh.normals && Float32Array.from(mesh.normals), uvs: mesh.uvs, indices: mesh.indices };
  if (o.displaceMesh && mesh.normals && mesh.uvs) {
    luts();
    const h = await src.get('height'), r = src.res, P = mesh.positions, N = mesh.normals, U = mesh.uvs;
    for (let i = 0; i < P.length / 3; i++) {
      let x = (((U[i * 2] * o.uvScale) % 1) + 1) % 1, y = (((U[(i * 2) + 1] * o.uvScale) % 1) + 1) % 1;
      x = (x * r) - 0.5; y = (y * r) - 0.5;
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const t = (xx, yy) => H2F[h[((((yy % r) + r) % r) * r * 4) + ((((xx % r) + r) % r) * 4)]];
      const v = ((t(x0, y0) * (1 - fx)) + (t(x0 + 1, y0) * fx)) * (1 - fy) + ((t(x0, y0 + 1) * (1 - fx)) + (t(x0 + 1, y0 + 1) * fx)) * fy;
      const d = (v - 0.5) * 2 * sc.displacementScale;   // as pbr.wgsl displace
      P[i * 3] += N[i * 3] * d; P[(i * 3) + 1] += N[(i * 3) + 1] * d; P[(i * 3) + 2] += N[(i * 3) + 2] * d;
    }
  }
  return mesh;
}

async function gltfPackage(o, src, sc, u, st, plan, progress) {
  const images = [], index = {};
  for (let i = 0; i < plan.length; i++) {
    const img = plan[i];
    progress?.(`encoding ${img.file}`, 0.35 + (0.5 * (i / plan.length)));
    const data = await packImage({ ...img, fmt: 'png' }, src);
    index[img.key] = images.length;
    images.push({ name: img.file, mime: 'image/png', data });
  }
  const tt = o.uvScale !== 1 ? { extensions: { KHR_texture_transform: { scale: [o.uvScale, o.uvScale] } } } : {};
  const T = (key, extra = {}) => ({ index: index[key], ...extra, ...JSON.parse(JSON.stringify(tt)) });
  const mean = (s, c) => (st[s] ? st[s].mean[c] : 0);
  const mat = { name: o.name, pbrMetallicRoughness: {} };
  const pbr = mat.pbrMetallicRoughness;
  const lin = c => c; // factors are linear in glTF
  if (index.base !== undefined) { pbr.baseColorTexture = T('base'); pbr.baseColorFactor = [1, 1, 1, 1]; }
  else pbr.baseColorFactor = [lin(mean('albedo', 0)), lin(mean('albedo', 1)), lin(mean('albedo', 2)), u.opacity ? mean('albedo', 3) : 1];
  if (index.orm !== undefined) {
    pbr.metallicRoughnessTexture = T('orm'); pbr.metallicFactor = 1; pbr.roughnessFactor = 1;
    if (!u.aoOne) mat.occlusionTexture = T('orm', { strength: 1 });
  } else { pbr.metallicFactor = mean('orm', 2); pbr.roughnessFactor = mean('orm', 1); }
  if (index.normal !== undefined) mat.normalTexture = T('normal', { scale: 1 });
  if (index.emissive !== undefined) {
    mat.emissiveTexture = T('emissive'); mat.emissiveFactor = [1, 1, 1];
    const es = sc.emissiveStrength * (u.emissiveScale ?? 1);
    if (es !== 1) mat.extensions = { ...mat.extensions, KHR_materials_emissive_strength: { emissiveStrength: es } };
  }
  if (sc.alphaMode !== 'opaque') { mat.alphaMode = sc.alphaMode === 'mask' ? 'MASK' : 'BLEND'; if (sc.alphaMode === 'mask') mat.alphaCutoff = sc.alphaCutoff; }
  if (sc.doubleSided) mat.doubleSided = true;
  const ext = mat.extensions || {};
  if (index.clearcoat !== undefined) ext.KHR_materials_clearcoat = { clearcoatFactor: 1, clearcoatTexture: T('clearcoat'), clearcoatRoughnessFactor: 1, clearcoatRoughnessTexture: T('clearcoat') };
  if (index.sheen !== undefined) ext.KHR_materials_sheen = { sheenColorFactor: [1, 1, 1], sheenColorTexture: T('sheen'), sheenRoughnessFactor: 0.5 };
  if (index.aniso !== undefined) ext.KHR_materials_anisotropy = { anisotropyStrength: 1, anisotropyRotation: 0, anisotropyTexture: T('aniso') };
  if (Math.abs(sc.ior - 1.5) > 1e-4) ext.KHR_materials_ior = { ior: sc.ior };
  if (sc.transmission > 0) ext.KHR_materials_transmission = { transmissionFactor: sc.transmission };
  if (Object.keys(ext).length) mat.extensions = ext;
  progress?.('building mesh', 0.88);
  const mesh = await previewMesh(o, src, sc);
  const glb = buildGLB({ mesh, images, material: mat, name: o.name, extras: { studio: { scalars: sc, uvScale: o.uvScale, res: src.res } } });
  return { glb, images, material: mat };
}

// ------------------------------------------------------------ readme
function readmeText(target, o, sc, files, notes) {
  const t = EXPORT_TARGETS.find(x => x.id === target);
  const rows = files.filter(x => x.chans).map(fi => {
    const chans = fi.chans.map((c, i) => `${(fi.chans.length === 1 ? 'L' : 'RGBA'[i])}=${chLabel(c)}`).join('  ');
    return `  ${fi.name.padEnd(34)} ${String(fi.bits === 16 ? '16-bit' : fi.fmt === 'exr' ? 'half' : '8-bit').padEnd(7)} ${fi.color.padEnd(7)} ${fi.role}\n      ${chans}`;
  }).join('\n');
  const steps = {
    'unity-urp': [
      'Copy the folder into Assets/. The .meta files set the import options:',
      '  base and emission maps are sRGB; every other map has sRGB off;',
      '  the normal map has Texture Type = Normal map.',
      `Open ${o.name}.mat. It uses Universal Render Pipeline/Lit.`,
      'If you see a pink material, set the shader to Universal Render Pipeline/Lit.',
      'Clearcoat: switch the shader to Universal Render Pipeline/Complex Lit;',
      '  _ClearCoatMap (R mask, G smoothness) is already assigned.',
      'If Unity rejects a .meta file, delete it and set the options above by hand.',
    ],
    'unity-hdrp': [
      'Copy the folder into Assets/. The .meta files set sRGB off for the mask,',
      '  normal, height and coat maps and Texture Type = Normal map for the normal.',
      `Select ${o.name}.mat once so that HDRP validates its keywords.`,
      'MaskMap: R metallic, G ambient occlusion, B detail mask (1), A smoothness.',
      'Height uses pixel displacement; set Displacement Mode to None to turn it off.',
    ],
    'unity-builtin': [
      'Copy the folder into Assets/. The .meta files set the import options.',
      'The material uses the Standard shader (metallic setup).',
      'Smoothness Source = Metallic Alpha. Standard has no double-sided option.',
    ],
    unreal: [
      'Put this folder anywhere on disk. In the Unreal Editor, use',
      `  Tools > Execute Python Script... and pick import_${o.name}.py.`,
      `It imports the textures into ${o.unrealDest.replace(/\{name\}/g, o.name)} and builds M_${o.name}.`,
      'The normal map is DirectX (green flipped). Do not tick Flip Green Channel.',
      'Manual import: ORM and CC = Masks, sRGB off; N = Normalmap; H = Grayscale.',
    ],
    godot: [
      `Copy the folder to ${o.godotRoot.replace(/\{name\}/g, o.name)} in the Godot project`,
      '  (or edit the paths at the top of the .tres file).',
      'Godot detects the normal map when the material uses it, and reimports it.',
      'Sheen becomes rim light, and anisotropy is a single value: Godot has no',
      '  sheen and no anisotropy map in StandardMaterial3D.',
    ],
    gltf: ['Drop the .glb into any glTF 2.0 viewer, Blender, three.js or Babylon.js.'],
    png: ['One PNG per map. Color maps are sRGB; data maps are linear.', 'Normal maps are OpenGL (+Y) unless the name says _dx.'],
  }[target] || [];
  return `${o.name} — ${t ? t.label : target} export
Stella Nova PBR Material Studio · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC
Resolution ${o.resolved}x${o.resolved} · UV tiling ${o.uvScale}

FILES
${rows}

HOW TO IMPORT
${steps.map(s => '  ' + s).join('\n')}

MATERIAL SCALARS
  IOR ${sc.ior} · transmission ${sc.transmission} · displacement ${sc.displacementScale}
  emissive strength ${sc.emissiveStrength}${notes.emissiveScale && notes.emissiveScale !== 1 ? ` (x${notes.emissiveScale.toFixed(3)}: the emissive map peak was above 1, so the map is divided by the peak and the strength carries it)` : ''}
  alpha ${sc.alphaMode}${sc.alphaMode === 'mask' ? ` (cutoff ${sc.alphaCutoff})` : ''} · double sided ${sc.doubleSided ? 'yes' : 'no'}
${notes.skipped && notes.skipped.length ? `\nNOT WRITTEN (no data in the bake)\n  ${notes.skipped.join(', ')}\n` : ''}`;
}

// ------------------------------------------------------------ exportPackage
/**
 * Build an export package.
 * @param {string} target an EXPORT_TARGETS id
 * @param {object} [opts] overrides of the panel options:
 *   {res, name, fmt:'png'|'tga', heightFmt:'png16'|'png8'|'exr', normalBits:8|16,
 *    template, maps:[PLAIN_MAPS keys], includeGraph, readme, fold, displaceMesh,
 *    unityShaderGuid, godotRoot, unrealDest, compress, onProgress(stage, frac)}
 * @returns {Promise<Blob>} zip (or .glb for 'gltf'); blob.fileName and
 *   blob.entries [{name, size}] describe it.
 */
export async function exportPackage(target, opts = {}) {
  if (!PLANS[target]) throw new Error('Unknown export target ' + target);
  if (!C.gpu.ok) throw new Error('Export needs WebGPU');
  const o = { ...OPTS, ...opts, target };
  if (opts.format && !opts.fmt) o.fmt = FORMATS.includes(opts.format) ? opts.format : 'png'; // panels.js name
  if (opts.helpers !== undefined) o.helpers = !!opts.helpers;
  o.name = sanitize(opts.name || materialName());
  o.uvScale = +(opts.uvScale ?? S.view.uvScale ?? 1) || 1;
  o.normalBits = +o.normalBits === 16 ? 16 : 8;
  const progress = o.onProgress;
  const res = +o.res || 0;
  return withMaps(res, async maps => {
    const src = new MapSource(maps);
    o.resolved = src.res;
    const sc = scalarsNow(maps);
    const st = await computeStats(src, MAP_NAMES, progress);
    const u = usedFlags(st, sc);
    u.emissiveScale = u.emissivePeak > 1 ? u.emissivePeak : 1;
    u.emissiveGain = 1 / u.emissiveScale;
    const full = PLANS[target](o, null, sc).map(x => x.file);
    const plan = resolvePlan(target, o, u, sc);
    const skipped = full.filter(fl => !plan.some(p => p.file === fl));
    const files = [];
    const root = target === 'png' || target === 'gltf' ? '' : `${o.name}/`;
    if (target === 'gltf') {
      const { glb, images } = await gltfPackage(o, src, sc, u, st, plan, progress);
      const blob = new Blob([glb], { type: 'model/gltf-binary' });
      blob.fileName = blob.name = `${o.name}.glb`;
      blob.entries = [{ name: blob.fileName, size: glb.byteLength }, ...images.map(i => ({ name: '  ' + i.name + '.png', size: i.data.length }))];
      finish(target, o, blob, sc, u);
      return blob;
    }
    const meta = [];
    for (let i = 0; i < plan.length; i++) {
      const img = plan[i];
      progress?.(`encoding ${img.file}`, 0.32 + (0.55 * (i / plan.length)));
      const data = await packImage(img, src);
      const name = `${img.file}.${img.ext}`;
      files.push({ name: root + name, data });
      meta.push({ key: img.key, name, bits: img.bits, fmt: img.fmt || img.ext, color: img.color, role: img.role, chans: img.chans });
    }
    progress?.('writing helper files', 0.9);
    if (!o.helpers) { /* helper files off: maps, README and graph only */ }
    else if (target.startsWith('unity-')) {
      const texGuid = {};
      for (const m of meta) {
        const guid = unityGuid(`${o.name}/${m.name}`);
        texGuid[m.key] = guid;
        files.push({ name: `${root}${m.name}.meta`, data: unityTexMeta(guid, { srgb: m.color === 'sRGB', normal: m.key === 'normal', alpha: m.chans.length === 4 && m.key === 'base' }) });
      }
      const mg = unityGuid(`${o.name}/${o.name}.mat`);
      files.push({ name: `${root}${o.name}.mat`, data: unityMat(target, o, sc, u, texGuid, o.unityShaderGuid) });
      files.push({ name: `${root}${o.name}.mat.meta`, data: matMeta(mg) });
    } else if (target === 'unreal') {
      files.push({ name: `${root}import_${o.name}.py`, data: unrealScript(o, sc, u, meta) });
    } else if (target === 'godot') {
      files.push({ name: `${root}${o.name}.tres`, data: godotTres(o, sc, u, meta, st) });
    }
    if (o.readme) files.push({ name: `${root}README.txt`, data: readmeText(target, o, sc, meta, { emissiveScale: u.emissiveScale, skipped }) });
    if (o.includeGraph && S.graph) files.push({ name: `${root}${o.name}.studio.json`, data: JSON.stringify(await projectJSON({ embed: true, name: o.name }), null, 1) });
    progress?.('zipping', 0.95);
    const blob = await makeZip(files, { compress: o.compress, comment: `Stella Nova PBR Material Studio · ${target}` });
    blob.fileName = blob.name = `${o.name}_${target}.zip`;
    blob.entries = await Promise.all(files.map(async x => ({ name: x.name, size: typeof x.data === 'string' ? new TextEncoder().encode(x.data).length : x.data.length })));
    finish(target, o, blob, sc, u);
    return blob;
  }, progress);
}
function finish(target, o, blob, sc, u) {
  setLast({ target, name: blob.fileName, size: blob.size, entries: blob.entries, res: o.resolved, at: Date.now() });
  o.onProgress?.('done', 1);
  if (UI.box && !o.onProgress) { setProgress('done', 1); showResult(blob); }
}

/** Save a Blob as a download. */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name || blob.fileName || 'download';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Export one baked map slot as a PNG (for the map strip). Linear except the
 * sRGB color slots; normal stays OpenGL.
 * @param {string} slot a MAP_NAMES entry @returns {Promise<Blob>}
 */
export async function exportMapPNG(slot, { res = 0, bits = 8 } = {}) {
  return withMaps(res, async maps => {
    const src = new MapSource(maps);
    const srgb = !!MAP_SLOTS[slot]?.srgbOnExport;
    const chans = slot === 'height' ? gray('height', 0) : slot === 'albedo' ? baseRGB(true)
      : [0, 1, 2, 3].map(c => (srgb && c < 3 ? ch.srgb(slot, c) : ch.s(slot, c)));
    const png = await packImage({ chans: slot === 'normal' || slot === 'orm' || slot === 'emissive' ? chans.slice(0, 3) : chans, bits: slot === 'height' ? 16 : bits, srgbChunk: srgb }, src);
    const b = new Blob([png], { type: 'image/png' });
    b.fileName = `${materialName()}_${slot}.png`;
    return b;
  });
}

// ------------------------------------------------------------ project
/**
 * The studio project as JSON: graph, settings, view, env and the images the
 * graph uses. embed true writes image assets as data URLs.
 */
export async function projectJSON({ embed = true, name } = {}) {
  const graph = graphJSON();
  const assets = {};
  if (graph) {
    for (const n of graph.nodes || []) {
      for (const [k, v] of Object.entries(n.params || {})) {
        if (!v || typeof v !== 'object' || typeof v.url !== 'string') continue;
        if (!/^(blob:|data:)/.test(v.url)) continue;
        const id = v.asset || IMP.assetIdForUrl(v.url) || ('a' + crc32(new TextEncoder().encode(v.url)).toString(16));
        if (!assets[id]) {
          assets[id] = { name: v.name || id, mime: v.mime || '' };
          if (embed) { try { const { dataURL, mime } = await IMP.assetDataURL(v.url); assets[id].data = dataURL; assets[id].mime = mime; } catch (e) { assets[id].error = String(e.message || e); } }
        }
        const { url, bitmap, ...rest } = v;
        n.params[k] = { ...rest, asset: id };
      }
    }
    if (name) graph.name = name;
  }
  return {
    format: 'stella-material-studio', version: 1, graphVersion: GRAPH_VERSION,
    saved: new Date().toISOString(), name: name || graph?.name || materialName(),
    graph, settings: { ...S.settings }, view: { ...S.view }, env: JSON.parse(JSON.stringify(S.env)),
    scalars: scalarsNow(), assets,
  };
}
/** Download the project as <name>.studio.json. */
export async function saveProject() {
  const j = await projectJSON({ embed: true });
  const blob = new Blob([JSON.stringify(j)], { type: 'application/json' });
  download(blob, `${sanitize(j.name)}.studio.json`);
  C.store.toast(`Saved ${sanitize(j.name)}.studio.json (${fmtSize(blob.size)})`, 'ok');
  return blob;
}
/** Copy the material (graph, scalars, settings, no embedded images) to the clipboard. */
export async function copyMaterialJSON() {
  const j = await projectJSON({ embed: false });
  delete j.view; delete j.env;
  const text = JSON.stringify(j, null, 2);
  try { await navigator.clipboard.writeText(text); C.store.toast('Material JSON copied', 'ok'); }
  catch (e) { C.store.toast('Clipboard is blocked: the JSON is in the console', 'warn'); console.log(text); }
  return text;
}

// ------------------------------------------------------------ ui
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
function sel(id, options, value, on) {
  const s = h('select', { class: 'io-sel', id });
  for (const op of options) s.add(new Option(op.label ?? op, String(op.value ?? op)));
  s.value = String(value);
  s.addEventListener('change', () => on(s.value));
  return s;
}
function row(label, ctl, hint) {
  return h('label', { class: 'io-row' }, h('span', { class: 'io-k' }, label), ctl, hint ? h('span', { class: 'io-hint' }, hint) : null);
}
function chk(label, value, on) {
  const c = h('input', { type: 'checkbox' }); c.checked = !!value;
  c.addEventListener('change', () => on(c.checked));
  return h('label', { class: 'io-chk' }, c, h('span', {}, label));
}

/**
 * Build the export UI into `host`.
 *   full mode: target cards, options, details, channel layout, run, project, import.
 *   extra mode (panels.js already owns the target cards, options and the Export
 *   button): details, channel layout, last export, project and import only.
 *   The target then follows the panels card that is on.
 */
export function mountExportUI(host, { mode = 'full' } = {}) {
  const box = h('div', { class: 'io' + (mode === 'extra' ? ' io-extra' : '') });
  UI.mode = mode;
  // target cards (full mode)
  if (mode === 'full') {
    const targets = h('div', { class: 'io-targets', role: 'radiogroup', 'aria-label': 'Export target' });
    for (const t of EXPORT_TARGETS) {
      const b = h('button', { type: 'button', class: 'io-target', 'data-target': t.id, role: 'radio', title: t.packing },
        h('b', {}, t.label), h('span', {}, t.normalY === '-Y' ? 'DX normal' : 'GL normal'));
      b.addEventListener('click', () => { OPTS.target = t.id; saveOpts(); refresh(); });
      targets.append(b);
    }
    UI.targets = targets;
    UI.packing = h('div', { class: 'io-pack' });
    box.append(h('section', { class: 'io-sec' }, h('h4', {}, 'Target'), targets, UI.packing));
  }
  // options
  UI.name = h('input', { class: 'io-in', type: 'text', placeholder: 'Material', spellcheck: 'false', maxlength: '64' });
  UI.name.addEventListener('input', () => refreshTable());
  const resOpts = [{ value: 0, label: 'Preview res' }, ...RES_OPTIONS.map(r => ({ value: r, label: `${r} px` }))];
  UI.res = sel('io-res', resOpts, OPTS.res, v => { OPTS.res = +v; saveOpts(); });
  UI.fmt = sel('io-fmt', FORMATS.map(v => ({ value: v, label: v === 'tga' ? 'TGA (RLE)' : 'PNG' })), OPTS.fmt, v => { OPTS.fmt = v; saveOpts(); refreshTable(); });
  UI.hfmt = sel('io-hfmt', [{ value: 'png16', label: 'PNG 16-bit' }, { value: 'png8', label: 'PNG 8-bit' }, { value: 'exr', label: 'EXR half' }], OPTS.heightFmt, v => { OPTS.heightFmt = v; saveOpts(); refreshTable(); });
  UI.nbits = sel('io-nbits', [{ value: 8, label: '8-bit' }, { value: 16, label: '16-bit' }], OPTS.normalBits, v => { OPTS.normalBits = +v; saveOpts(); refreshTable(); });
  const optRows = mode === 'full'
    ? h('div', { class: 'io-grid' }, row('Name', UI.name), row('Res', UI.res), row('Format', UI.fmt), row('Height', UI.hfmt), row('Normal', UI.nbits))
    : h('div', { class: 'io-grid' }, row('Height', UI.hfmt), row('Normal', UI.nbits));
  // target-specific
  const txt = (key, fallback) => {
    const el = h('input', { class: 'io-in mono', type: 'text', spellcheck: 'false' });
    el.value = OPTS[key]; el.addEventListener('change', () => { OPTS[key] = el.value.trim() || fallback; el.value = OPTS[key]; saveOpts(); refreshTable(); });
    return el;
  };
  UI.tUnity = txt('unityShaderGuid', ''); UI.tUnity.placeholder = 'blank = the default Lit GUID';
  UI.tGodot = txt('godotRoot', DEFAULT_OPTS.godotRoot);
  UI.tUnreal = txt('unrealDest', DEFAULT_OPTS.unrealDest);
  UI.tTemplate = txt('template', DEFAULT_OPTS.template);
  UI.tTemplate.addEventListener('input', () => { OPTS.template = UI.tTemplate.value || DEFAULT_OPTS.template; refreshTable(); });
  UI.mapsBox = h('div', { class: 'io-maps' });
  for (const [k, m] of Object.entries(PLAIN_MAPS)) {
    UI.mapsBox.append(chk(m.label, OPTS.maps.includes(k), on => {
      OPTS.maps = Object.keys(PLAIN_MAPS).filter(x => (x === k ? on : OPTS.maps.includes(x)));
      saveOpts(); refreshTable();
    }));
  }
  UI.specific = {
    unity: h('div', { class: 'io-spec', 'data-for': 'unity' }, row('Shader', UI.tUnity, 'GUID; only when your pipeline differs')),
    unreal: h('div', { class: 'io-spec', 'data-for': 'unreal' }, row('Dest', UI.tUnreal, 'content folder; {name} expands')),
    godot: h('div', { class: 'io-spec', 'data-for': 'godot' }, row('Path', UI.tGodot, 'res:// folder of the textures')),
    gltf: h('div', { class: 'io-spec', 'data-for': 'gltf' },
      chk('Fold constant maps into factors', OPTS.fold, v => { OPTS.fold = v; saveOpts(); }),
      chk('Bake height into the mesh', OPTS.displaceMesh, v => { OPTS.displaceMesh = v; saveOpts(); })),
    png: h('div', { class: 'io-spec', 'data-for': 'png' }, row('Names', UI.tTemplate, '{name} {map} {res}'), UI.mapsBox),
  };
  const flags = mode === 'full' ? h('div', { class: 'io-flags' },
    chk('Project graph', OPTS.includeGraph, v => { OPTS.includeGraph = v; saveOpts(); }),
    chk('Helper files', OPTS.helpers, v => { OPTS.helpers = v; saveOpts(); }),
    chk('README', OPTS.readme, v => { OPTS.readme = v; saveOpts(); }),
    chk('Deflate', OPTS.compress !== 'store', v => { OPTS.compress = v ? 'auto' : 'store'; saveOpts(); }))
    : h('div', { class: 'io-flags' },
      chk('README', OPTS.readme, v => { OPTS.readme = v; saveOpts(); }),
      chk('Deflate', OPTS.compress !== 'store', v => { OPTS.compress = v ? 'auto' : 'store'; saveOpts(); }));
  box.append(h('section', { class: 'io-sec' }, h('h4', {}, mode === 'full' ? 'Options' : 'Package details'), optRows, ...Object.values(UI.specific), flags));
  UI.table = h('table', { class: 'io-table' });
  UI.tableHead = h('h4', {}, 'Channel layout');
  box.append(h('section', { class: 'io-sec' }, UI.tableHead, h('div', { class: 'io-tablewrap' }, UI.table)));
  // run (full) or the result list only (extra)
  UI.bar = h('div', { class: 'io-bar' }, h('i'));
  UI.stage = h('div', { class: 'io-stage mono' });
  UI.result = h('div', { class: 'io-result' });
  if (mode === 'full') {
    UI.go = h('button', { type: 'button', class: 'io-go' }, 'Export');
    UI.go.addEventListener('click', () => runExport());
    box.append(h('section', { class: 'io-sec io-run' }, UI.go, UI.bar, UI.stage, UI.result));
  } else box.append(h('section', { class: 'io-sec io-run' }, UI.bar, UI.stage, UI.result));
  // project
  box.append(h('section', { class: 'io-sec' }, h('h4', {}, 'Project'), h('div', { class: 'io-btns' },
    h('button', { type: 'button', class: 'io-btn', title: 'Graph, settings, view, light and the imported images (Ctrl+S)', onclick: () => saveProject().catch(err) }, 'Save project'),
    h('button', { type: 'button', class: 'io-btn', onclick: () => IMP.pickFiles('.json,application/json,.zip') }, 'Open project'),
    h('button', { type: 'button', class: 'io-btn', onclick: () => copyMaterialJSON().catch(err) }, 'Copy JSON'),
    h('button', { type: 'button', class: 'io-btn', title: 'Every baked map as PNG in one zip', onclick: () => runExport('png') }, 'All maps .zip'))));
  const impSec = h('section', { class: 'io-sec', id: 'io-import' });
  box.append(impSec);
  IMP.mountImportUI?.(impSec);
  UI.box = box;
  host.append(box);
  refresh();
  return box;
}

/** The active target: the panels card that is on (extra mode) or OPTS.target. */
function activeTarget() {
  if (UI.mode === 'extra') {
    const cards = [...document.querySelectorAll('#export-panel .ex-card')];
    const i = cards.findIndex(c => c.classList.contains('on'));
    if (i >= 0 && EXPORT_TARGETS[i]) return EXPORT_TARGETS[i].id;
  }
  return OPTS.target;
}

function refresh() {
  if (!UI.box) return;
  const target = activeTarget();
  if (UI.targets) for (const b of UI.targets.children) { const on = b.dataset.target === target; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }
  const t = EXPORT_TARGETS.find(x => x.id === target);
  if (UI.packing) UI.packing.textContent = t ? `${t.packing} · normal ${t.normalY}` : '';
  const fam = target.startsWith('unity') ? 'unity' : target;
  for (const [k, el] of Object.entries(UI.specific)) el.hidden = k !== fam;
  UI.fmt.disabled = target === 'gltf';
  UI.hfmt.disabled = target === 'gltf';
  if (UI.go) UI.go.textContent = target === 'gltf' ? 'Export .glb' : `Export ${t ? t.label : ''} .zip`;
  if (!UI.name.value) UI.name.placeholder = graphJSON()?.name || 'Material';
  refreshTable();
}
function refreshTable() {
  if (!UI.table) return;
  const target = activeTarget();
  const o = { ...OPTS, name: materialName(), uvScale: S.view.uvScale || 1, normalBits: +OPTS.normalBits };
  const plan = resolvePlan(target, o, null, scalarsNow());
  const t = UI.table;
  UI.tableHead.textContent = `Channel layout · ${EXPORT_TARGETS.find(x => x.id === target)?.label || target}`;
  t.textContent = '';
  t.append(h('tr', {}, h('th', {}, 'File'), h('th', {}, 'R'), h('th', {}, 'G'), h('th', {}, 'B'), h('th', {}, 'A'), h('th', {}, 'Bits')));
  for (const img of plan) {
    const cells = [0, 1, 2, 3].map(i => {
      const c = img.chans.length === 1 ? (i < 3 ? img.chans[0] : null) : img.chans[i];
      return h('td', { class: c ? (c.inv ? 'inv' : c.v !== undefined ? 'k' : '') : 'none' }, c ? chLabel(c).replace(' (sRGB)', '') : '—');
    });
    t.append(h('tr', { title: img.role },
      h('td', { class: 'f' }, `${img.file}.${img.ext}`, img.optional || img.fold ? h('em', {}, img.fold ? ' if varied' : ' if used') : null, h('small', {}, img.role)),
      ...cells, h('td', { class: 'b' }, img.fmt === 'exr' ? 'half' : `${img.bits}${img.color === 'sRGB' ? ' sRGB' : ''}`)));
  }
}

function setProgress(stage, frac) {
  if (!UI.bar) return;
  UI.bar.firstChild.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
  UI.stage.textContent = stage;
}
function showResult(blob, ms) {
  if (!UI.result) return;
  UI.result.textContent = '';
  UI.result.append(h('div', { class: 'io-res-head' }, h('b', {}, blob.fileName), ` ${fmtSize(blob.size)} · ${last.res}²${ms ? ` · ${(ms / 1000).toFixed(1)} s` : ''}`),
    h('ul', {}, blob.entries.map(e => h('li', {}, h('span', {}, e.name), h('i', {}, fmtSize(e.size))))));
}
/** Export with the panel options and download the result. */
async function runExport(target = activeTarget()) {
  if (busy) return;
  busy = true;
  document.body.classList.add('io-busy');
  if (UI.go) UI.go.disabled = true;
  const t0 = performance.now();
  try {
    const blob = await exportPackage(target, { onProgress: setProgress });
    download(blob, blob.fileName);
    const ms = performance.now() - t0;
    C.store.toast(`Exported ${blob.fileName} · ${fmtSize(blob.size)} · ${(ms / 1000).toFixed(1)} s`, 'ok');
    showResult(blob, ms);
  } catch (e) { err(e); setProgress('failed: ' + (e.message || e), 0); }
  finally { busy = false; document.body.classList.remove('io-busy'); if (UI.go) UI.go.disabled = false; }
}

function topbar() {
  const tb = C.$('tb-file');
  if (!tb) return;
  tb.append(h('span', { class: 'io-tb' },
    h('button', { type: 'button', class: 'tb-btn', title: 'Open a project, graph, maps or a zip (Ctrl+O)', onclick: () => IMP.pickFiles() }, 'Open'),
    h('button', { type: 'button', class: 'tb-btn', title: 'Save the project as .studio.json (Ctrl+S)', onclick: () => saveProject().catch(err) }, 'Save'),
    h('button', { type: 'button', class: 'tb-btn', title: 'Import texture maps as image nodes', onclick: () => IMP.pickFiles('image/*,.zip,.tga') }, 'Import'),
    h('button', { type: 'button', class: 'tb-btn', title: 'Export with the Export tab options (Ctrl+E)', onclick: () => { showExportTab(); runExport(); } }, 'Export')));
}
function showExportTab() { C.$('side-tabs')?.querySelector('button[data-tab="export"]')?.click(); }

/**
 * Put the UI in place after every module ran init. panels.js may own
 * #export-panel (target cards) and #tb-file (File menu). Then this module
 * adds only the extra block, and a MutationObserver puts it back each time
 * panels re-renders the pane with replaceChildren.
 */
function placeUI() {
  const host = C.$('export-panel');
  if (!host || UI.box) return;
  const panelsOwns = !!host.querySelector('.ex-cards') || typeof C.modules.panels?.api?.renderExport === 'function';
  host.classList.add('io-host');
  mountExportUI(host, { mode: panelsOwns ? 'extra' : 'full' });
  if (panelsOwns) {
    new MutationObserver(() => {
      if (!host.contains(UI.box)) host.append(UI.box);
      refresh();
    }).observe(host, { childList: true });
  }
  const tb = C.$('tb-file');
  if (tb && !tb.children.length) topbar();
}

// ------------------------------------------------------------ selfTest / init
/** Quick checks that need no bake: codecs, zip, glb, GUIDs, plans. */
export async function selfTest() {
  const out = { ok: true, checks: {} };
  const ok = (k, v) => { out.checks[k] = v; if (!v) out.ok = false; };
  ok('crc32', crc32(new TextEncoder().encode('123456789')) === 0xcbf43926);
  const px = new Uint8Array([0, 0, 0, 0, 255, 128, 7, 3, 1, 2, 3, 255, 9, 9, 9, 9]);
  const png = await encodePNG({ width: 2, height: 2, channels: 4, data: px });
  const back = await decodePNG(png);
  ok('png8 alpha 0 keeps rgb', back.data.every((v, i) => v === px[i]));
  const zipped = await makeZip([{ name: 'a.txt', data: 'x'.repeat(500) }, { name: 'b.png', data: png }]);
  const entries = await readZip(zipped);
  ok('zip roundtrip', entries.length === 2 && entries[0].data.length === 500);
  const glb = buildGLB({ mesh: uvSphere(8), images: [{ data: png }], material: { name: 't', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } } });
  const pg = parseGLB(glb);
  ok('glb parse', pg.json.asset.version === '2.0' && pg.json.images.length === 1);
  ok('unity guid', /^[0-9a-f]{32}$/.test(unityGuid('x')) && unityGuid('x') === unityGuid('x'));
  ok('plans', EXPORT_TARGETS.every(t => PLANS[t.id] && resolvePlan(t.id, { ...OPTS, name: 'T', uvScale: 1 }, null, DEFAULT_SCALARS).length > 0));
  out.maps = !!S.maps;
  out.last = last && { target: last.target, name: last.name, size: last.size };
  return out;
}

/** @param {object} ctx main.js module context */
export async function init(ctx) {
  bind(ctx);
  // panels.js inits after this module, so place the UI once every init ran
  ctx.store.on('boot:done', () => { try { placeUI(); } catch (e) { console.error('[export] UI', e); } });
  ctx.store.on('graph:changed', () => { if (UI.name && !UI.name.value) UI.name.placeholder = graphJSON()?.name || 'Material'; });
  ctx.store.on('view:changed', () => refreshTable());
  // Capture phase on window: Ctrl+S saves the full project (graph plus the
  // embedded images) and Ctrl+O opens any file kind. Both are supersets of the
  // panels.js graph-JSON shortcuts, which skip a defaultPrevented event.
  window.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.defaultPrevented) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); saveProject().catch(err); }
    else if (k === 'o') { e.preventDefault(); IMP.pickFiles(); }
    else if (k === 'e' && UI.mode === 'full') { e.preventDefault(); showExportTab(); }
  }, true);
  ctx.register('io', {
    exportPackage, exportMapPNG, download, saveProject, copyMaterialJSON, projectJSON, scalarsNow,
    readTexture, runExport, unityGuid, PLAIN_MAPS, FORMATS, mountExportUI,
    options: () => ({ ...OPTS }), setOptions: p => { Object.assign(OPTS, p); saveOpts(); refresh(); },
    get last() { return last; },
    importFiles: IMP.importFiles, importMaps: IMP.importMaps, loadProject: IMP.loadProject,
    roleFromName: IMP.roleFromName, detectNormalConvention: IMP.detectNormalConvention,
    serverStatus: IMP.serverStatus, imageToPBR: IMP.imageToPBR,
    async selfTest() { const a = await selfTest(); const b = await IMP.selfTest(); return { ok: a.ok && b.ok, export: a, import: b }; },
  });
}
