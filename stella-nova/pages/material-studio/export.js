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
//  This file is the entry that main.js loads. It keeps the module exports
//  and init(). The work is in export/, one concern per file. Each file
//  opens with a header and its grep targets.
//
//  MODULES  (export/<name>.js)
//      ctx .............. C, S, UI, last; bind, setLast, err
//      half ............. half bits -> float / 8-bit linear / 8-bit sRGB
//      format ........... f (number text), fmtSize
//      graph-access ..... graphJSON, outputParams, scalarsNow, materialName
//      readback ......... readTexture, MapSource
//      maps ............. withMaps, waitBake
//      stats ............ computeStats, usedFlags
//      pack ............. packImage, ch() channel spec helpers, chLabel
//      plans ............ PLANS: one planner per EXPORT_TARGETS id; PLAIN_MAPS
//      options .......... OPTS, DEFAULT_OPTS, saveOpts (localStorage)
//      engines/unity .... unityGuid, unityMat, unityTexMeta, matMeta
//      engines/unreal ... unrealScript
//      engines/godot .... godotTres
//      engines/gltf ..... gltfPackage, previewMesh
//      engines/readme ... readmeText
//      package .......... exportPackage (the public entry), exportMapPNG
//      project .......... projectJSON, saveProject, copyMaterialJSON
//      ui/dom ........... h, sel, row, chk, download
//      ui/progress ...... setProgress, showResult
//      ui/run ........... activeTarget, runExport
//      ui/panel ......... mountExportUI, refresh, refreshTable (layout table)
//      ui/place ......... placeUI, topbar, showExportTab
//      ui/keys .......... bindKeys
//      selftest ......... selfTest
//      export.test.mjs .. golden node test (run: node export/export.test.mjs)
//
//  GREP TARGETS (this file)
//      export { ... } ... the public names, the same as before the split
//      init ............. bind, store subscriptions, bindKeys,
//                         ctx.register('io', ...)
// ============================================================================
import * as IMP from './import.js';
import { UI, last, bind } from './export/ctx.js';
import { linToSrgb } from './export/half.js';
import { graphJSON, scalarsNow } from './export/graph-access.js';
import { readTexture } from './export/readback.js';
import { PLAIN_MAPS, FORMATS } from './export/plans.js';
import { OPTS, saveOpts } from './export/options.js';
import { unityGuid } from './export/engines/unity.js';
import { download } from './export/ui/dom.js';
import { exportPackage, exportMapPNG } from './export/package.js';
import { projectJSON, saveProject, copyMaterialJSON } from './export/project.js';
import { mountExportUI, refresh, refreshTable } from './export/ui/panel.js';
import { runExport } from './export/ui/run.js';
import { placeUI } from './export/ui/place.js';
import { bindKeys } from './export/ui/keys.js';
import { selfTest } from './export/selftest.js';

export {
  linToSrgb, scalarsNow, readTexture, PLAIN_MAPS, FORMATS, unityGuid, download,
  exportPackage, exportMapPNG, projectJSON, saveProject, copyMaterialJSON, mountExportUI, selfTest,
};

// ------------------------------------------------------------ init
/** @param {object} ctx main.js module context */
export async function init(ctx) {
  bind(ctx);
  // panels.js inits after this module, so place the UI once every init ran
  ctx.store.on('boot:done', () => { try { placeUI(); } catch (e) { console.error('[export] UI', e); } });
  ctx.store.on('graph:changed', () => { if (UI.name && !UI.name.value) UI.name.placeholder = graphJSON()?.name || 'Material'; });
  ctx.store.on('view:changed', () => refreshTable());
  bindKeys();
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
