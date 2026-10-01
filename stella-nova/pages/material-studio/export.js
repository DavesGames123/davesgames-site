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
import { EXPORT_TARGETS, DEFAULT_SCALARS } from './contract.js';
import { makeZip, encodePNG, crc32, decodePNG, readZip } from './zip.js';
import { buildGLB, uvSphere, parseGLB } from './glb.js';
import * as IMP from './import.js';

import { S, UI, last, bind } from './export/ctx.js';
import { linToSrgb } from './export/half.js';
import { graphJSON, scalarsNow } from './export/graph-access.js';
import { readTexture } from './export/readback.js';
import { PLANS, PLAIN_MAPS, FORMATS, resolvePlan } from './export/plans.js';
import { OPTS, saveOpts } from './export/options.js';
import { unityGuid } from './export/engines/unity.js';
import { download } from './export/ui/dom.js';
import { exportPackage, exportMapPNG } from './export/package.js';
import { projectJSON, saveProject, copyMaterialJSON } from './export/project.js';
import { mountExportUI, refresh, refreshTable } from './export/ui/panel.js';
import { runExport } from './export/ui/run.js';
import { placeUI } from './export/ui/place.js';
import { bindKeys } from './export/ui/keys.js';

export {
  linToSrgb, scalarsNow, readTexture, PLAIN_MAPS, FORMATS, unityGuid, download,
  exportPackage, exportMapPNG, projectJSON, saveProject, copyMaterialJSON, mountExportUI,
};

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
