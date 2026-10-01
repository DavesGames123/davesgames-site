// ============================================================================
//  MATERIAL STUDIO  ·  export/project.js — the studio project file
// ────────────────────────────────────────────────────────────────────────────
//  projectJSON writes the graph, settings, view, env and scalars. Each
//  image param with a blob: or data: URL becomes an asset id, and with
//  embed the asset data goes into the file as a data URL. saveProject
//  downloads <name>.studio.json. copyMaterialJSON puts the material,
//  with no view, env or image data, on the clipboard.
//
//  GREP TARGETS
//      projectJSON  saveProject  copyMaterialJSON  assets  embed
// ============================================================================
import { GRAPH_VERSION } from '../contract.js';
import { crc32 } from '../zip.js';
import * as IMP from '../import.js';
import { C, S } from './ctx.js';
import { fmtSize } from './format.js';
import { graphJSON, scalarsNow, sanitize, materialName } from './graph-access.js';
import { download } from './ui/dom.js';

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
