// ============================================================================
//  MATERIAL STUDIO  ·  export/package.js — build one export package
// ────────────────────────────────────────────────────────────────────────────
//  exportPackage is the public entry of the export. It merges the call
//  opts over OPTS, gets the maps at the export res, reads the stats, and
//  resolves the plan. Then it encodes each image, adds the engine helper
//  files, the README and the project JSON, and writes a zip (or a .glb for
//  glTF). finish keeps the summary in ctx.last and updates the panel.
//  exportMapPNG writes one baked slot as a PNG for the map strip.
//
//  GREP TARGETS
//      exportPackage  finish  exportMapPNG  root  skipped  emissiveScale
// ============================================================================
import { MAP_SLOTS, MAP_NAMES } from '../contract.js';
import { makeZip } from '../zip.js';
import { C, S, UI, setLast } from './ctx.js';
import { scalarsNow, sanitize, materialName } from './graph-access.js';
import { MapSource } from './readback.js';
import { withMaps } from './maps.js';
import { computeStats, usedFlags } from './stats.js';
import { ch, packImage } from './pack.js';
import { PLANS, FORMATS, resolvePlan, baseRGB, gray } from './plans.js';
import { OPTS } from './options.js';
import { unityGuid, unityTexMeta, matMeta, unityMat } from './engines/unity.js';
import { unrealScript } from './engines/unreal.js';
import { godotTres } from './engines/godot.js';
import { gltfPackage } from './engines/gltf.js';
import { readmeText } from './engines/readme.js';
import { projectJSON } from './project.js';
import { setProgress, showResult } from './ui/progress.js';

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
