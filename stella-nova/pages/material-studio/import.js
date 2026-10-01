// ============================================================================
//  MATERIAL STUDIO  ·  import.js — map, project and image import
// ────────────────────────────────────────────────────────────────────────────
//  Owner: IO agent. Turns dropped or picked files into graph edits:
//    .studio.json / graph JSON ..... loadProject (bench graph JSON goes to
//                                     __studio.bench.importBenchGraph when present)
//    .zip .......................... readZip (zip.js), then each entry below
//    .png .jpg .webp .tga .gif .bmp  importMaps: one Image node per map, wired
//                                     to the Material Output by its role
//  It also runs the optional "Image to PBR (server)" import against the
//  material-lab Python server (material-lab-server/server.py, POST /pbr).
//
//  DATA FLOW (importMaps)
//      files ─▶ roleFromName (suffix tokens: _albedo _nrm _rough _orm ...)
//            ─▶ decodeImage only when a role needs the pixels:
//                 normal  detectNormalConvention (curl sign) ─▶ flip green
//                 gloss   invert to roughness
//                 packed  ORM / ARM / RMA / HDRP MaskMap / MetallicSmoothness
//                         ─▶ per-channel outputs of the Image node, or split
//                            into gray PNGs here when the node has none
//            ─▶ registerAsset (blob URL; projects embed it as a data URL)
//            ─▶ graph.addNode(image type) + graph.connect(out -> Material Output)
//            ─▶ emit graph:changed {reason:'edit'} + store.checkpoint
//
//  ASSET STORE
//      Image params hold {name, url, asset, mime, w, h}. url is a blob: URL
//      so the undo history stays small. export.js projectJSON embeds each
//      asset as a data URL, and loadProject turns them back into blob URLs.
//
//  SECTIONS  (grep -n the banner to jump)
//      assets ............ registerAsset, assetIdForUrl, assetDataURL, restoreAsset
//      roles ............. ROLE_WORDS, roleFromName
//      decode ............ decodeImage (PNG exact, TGA, browser codecs)
//      normals ........... detectNormalConvention
//      image node ........ imageNodeDef, pickOutput, colorSpaceParam
//      graph ops ......... G (graph.js or plain JSON fallback)
//      importMaps ........ the map import
//      project ........... loadProject
//      importFiles ....... dispatch by file type, pickFiles, drag and drop
//      server ............ probeServer, serverStatus, imageToPBR
//      ui ................ mountImportUI
//      selfTest / init
// ============================================================================
import { OUTPUT_TYPE, MATERIAL_INPUTS, DEFAULT_SETTINGS, validateGraph } from './contract.js';
import { decodePNG, encodePNG, readZip, sniffImage, toBytes } from './zip.js';

let C = null, S = null;
const UI = {};
let lastReport = null;

// ------------------------------------------------------------ assets
const assets = new Map();     // id -> {id, name, mime, blob, url}
const byUrl = new Map();      // url -> id
let assetSeq = 1;

/** Keep a blob as a studio asset. @returns {{id,name,mime,blob,url}} */
export function registerAsset(blob, name, id) {
  id = id || `img${Date.now().toString(36)}${(assetSeq++).toString(36)}`;
  const url = URL.createObjectURL(blob);
  const a = { id, name: name || id, mime: blob.type || 'image/png', blob, url };
  assets.set(id, a); byUrl.set(url, id);
  return a;
}
/** The asset id of a blob URL made here, or null. */
export function assetIdForUrl(url) { return byUrl.get(url) || null; }
/** Read a blob:/data: URL as a data URL. @returns {Promise<{dataURL:string, mime:string}>} */
export async function assetDataURL(url) {
  if (url.startsWith('data:')) return { dataURL: url, mime: url.slice(5, url.indexOf(';')) };
  const id = byUrl.get(url);
  const blob = id ? assets.get(id).blob : await (await fetch(url)).blob();
  const dataURL = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  return { dataURL, mime: blob.type };
}
/** Turn an embedded project asset back into a blob URL asset. */
export async function restoreAsset(id, rec) {
  if (assets.has(id)) return assets.get(id);
  if (!rec || !rec.data) return null;
  const blob = await (await fetch(rec.data)).blob();
  return registerAsset(blob.type ? blob : new Blob([blob], { type: rec.mime || 'image/png' }), rec.name, id);
}

// ------------------------------------------------------------ roles
/**
 * Joined lower-case suffix words -> role. A role is one of the Material
 * Output inputs, or a packed layout with per-channel targets.
 *   conv: 'gl'|'dx' normal convention from the name   inv: invert (gloss)
 *   pack: {r|g|b|a: input id}  channel -> Material Output input
 */
const ROLE_WORDS = (() => {
  const m = {};
  const put = (words, spec) => { for (const w of words) m[w] = spec; };
  put(['albedo', 'basecolor', 'basecolour', 'diffuse', 'diff', 'color', 'colour', 'col', 'alb', 'bc', 'base', 'albedotransparency', 'basecoloralpha'], { role: 'baseColor' });
  put(['normal', 'normals', 'nrm', 'nor', 'norm', 'normalmap', 'nml', 'n'], { role: 'normal' });
  put(['normalgl', 'norgl', 'nrmgl', 'normalopengl', 'normalogl', 'nogl'], { role: 'normal', conv: 'gl' });
  put(['normaldx', 'nordx', 'nrmdx', 'normaldirectx', 'normaldirect'], { role: 'normal', conv: 'dx' });
  put(['roughness', 'rough', 'rgh'], { role: 'roughness' });
  put(['gloss', 'glossiness', 'smoothness', 'smooth', 'glossy'], { role: 'roughness', inv: true });
  put(['metallic', 'metalness', 'metal', 'mtl', 'met', 'metalic'], { role: 'metallic' });
  put(['ao', 'ambientocclusion', 'occlusion', 'occ', 'mixedao', 'ambient'], { role: 'ao' });
  put(['orm', 'arm', 'occlusionroughnessmetallic', 'aorm', 'aoroughnessmetallic', 'aoroughmetal'], { pack: { r: 'ao', g: 'roughness', b: 'metallic' } });
  put(['rma', 'roughnessmetallicao'], { pack: { r: 'roughness', g: 'metallic', b: 'ao' } });
  put(['mra'], { pack: { r: 'metallic', g: 'roughness', b: 'ao' } });
  put(['maskmap', 'mask_map', 'hdrpmask'], { pack: { r: 'metallic', g: 'ao', a: 'roughness' }, invA: true });
  put(['metallicsmoothness', 'metallicgloss', 'metalsmooth', 'metallicglossmap', 'metallicsmooth'], { pack: { r: 'metallic', a: 'roughness' }, invA: true });
  put(['height', 'heightmap', 'disp', 'displacement', 'displace', 'bump', 'depth', 'parallax', 'h'], { role: 'height' });
  put(['emissive', 'emission', 'emit', 'glow', 'illum', 'selfillum', 'illumination', 'emissivemap'], { role: 'emissive' });
  put(['opacity', 'alpha', 'transparency', 'opac', 'mask', 'cutout'], { role: 'opacity' });
  put(['clearcoat', 'coat', 'cc', 'clearcoatmask', 'coatmask'], { role: 'clearcoat' });
  put(['clearcoatroughness', 'coatroughness', 'ccroughness', 'clearcoatrough', 'ccrough'], { role: 'clearcoatRoughness' });
  put(['sheen', 'fuzz', 'velvet'], { role: 'sheen' });
  put(['anisotropy', 'aniso', 'anisotropic'], { role: 'anisotropy' });
  put(['preview', 'thumb', 'thumbnail', 'sphere', 'cavity', 'specular', 'spec', 'translucency', 'sss', 'idmap', 'id', 'curvature', 'position'], { role: 'skip' });
  return m;
})();
const RES_TOKEN = /^(\d+k|\d+px|\d{3,5}|png|jpe?g|tga|exr|tif+|webp|lod\d|var\d|v\d+)$/;

/**
 * Guess the role of an image from its file name.
 * @param {string} name file name or path
 * @returns {{role?:string, conv?:'gl'|'dx', inv?:boolean, pack?:Object<string,string>, invA?:boolean, word?:string}|null}
 */
export function roleFromName(name) {
  const base = String(name).split('/').pop().replace(/\.[a-z0-9]+$/i, '');
  const tokens = base.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  while (tokens.length > 1 && RES_TOKEN.test(tokens[tokens.length - 1])) tokens.pop();
  for (let k = Math.min(4, tokens.length); k >= 1; k--) {
    const tail = tokens.slice(tokens.length - k);
    const word = tail.join('');
    if (ROLE_WORDS[word] && !(k === 1 && word.length === 1 && tokens.length === 1)) return { ...ROLE_WORDS[word], word };
  }
  // a known word anywhere (for example "bricks_normal_gl_2k" already handled; "albedo_bricks")
  for (const t of tokens) if (t.length > 2 && ROLE_WORDS[t] && ROLE_WORDS[t].role !== 'skip') return { ...ROLE_WORDS[t], word: t };
  return null;
}

// ------------------------------------------------------------ decode
/** Decode a TGA (types 2, 3, 10, 11; 8/24/32 bits). */
function decodeTGA(u8) {
  const idLen = u8[0], cmap = u8[1], type = u8[2];
  const cmapLen = u8[5] | (u8[6] << 8), cmapBits = u8[7];
  const w = u8[12] | (u8[13] << 8), h = u8[14] | (u8[15] << 8), bpp = u8[16], desc = u8[17];
  if (![2, 3, 10, 11].includes(type) || cmap) throw new Error('tga: unsupported type ' + type);
  const pb = bpp >> 3, ch = pb === 1 ? 1 : pb === 4 ? 4 : 3;
  let p = 18 + idLen + (cmap ? cmapLen * (cmapBits >> 3) : 0);
  const px = new Uint8Array(w * h * pb);
  if (type === 2 || type === 3) px.set(u8.subarray(p, p + px.length));
  else {
    let o = 0;
    while (o < px.length) {
      const c = u8[p++], n = (c & 127) + 1;
      if (c & 128) { const v = u8.subarray(p, p + pb); p += pb; for (let i = 0; i < n; i++) { px.set(v, o); o += pb; } }
      else { px.set(u8.subarray(p, p + (n * pb)), o); p += n * pb; o += n * pb; }
    }
  }
  const top = !!(desc & 0x20), out = new Uint8Array(w * h * ch);
  for (let y = 0; y < h; y++) {
    const sy = top ? y : h - 1 - y;
    for (let x = 0; x < w; x++) {
      const s = ((sy * w) + x) * pb, d = ((y * w) + x) * ch;
      if (ch === 1) out[d] = px[s];
      else { out[d] = px[s + 2]; out[d + 1] = px[s + 1]; out[d + 2] = px[s]; if (ch === 4) out[d + 3] = px[s + 3]; }
    }
  }
  return { width: w, height: h, channels: ch, bitDepth: 8, data: out };
}

/**
 * Decode an image to exact samples where possible.
 * PNG: own decoder (16 bits kept, no premultiply). TGA: own decoder.
 * Others: createImageBitmap + OffscreenCanvas (8-bit RGBA).
 * @param {Uint8Array} bytes @param {string} [name]
 * @returns {Promise<{width,height,channels,bitDepth,data}>}
 */
export async function decodeImage(bytes, name = '') {
  const kind = sniffImage(bytes) || (/\.tga$/i.test(name) ? 'tga' : null);
  if (kind === 'png') { try { return await decodePNG(bytes); } catch (e) { if (!/interlaced/.test(e.message)) throw e; } }
  if (kind === 'tga') return decodeTGA(bytes);
  if (kind === 'exr') throw new Error('EXR import is not supported; convert it to 16-bit PNG');
  const bmp = await createImageBitmap(new Blob([bytes]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const id = g.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close?.();
  return { width: id.width, height: id.height, channels: 4, bitDepth: 8, data: new Uint8Array(id.data.buffer) };
}
const mimeOf = (kind, name) => ({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' }[kind] || (/\.tga$/i.test(name) ? 'image/x-tga' : 'application/octet-stream'));

/** Make a PNG of one channel (or a transform) of a decoded image. */
async function derivePNG(img, { channel, invert = false, flipGreen = false }) {
  const { width: w, height: hgt, channels: ch, bitDepth: bits, data } = img;
  const max = bits === 16 ? 65535 : 255, n = w * hgt;
  if (channel !== undefined) {
    const out = bits === 16 ? new Uint16Array(n) : new Uint8Array(n);
    // source sample: alpha sits at 3 (RGBA) or 1 (gray+alpha); no alpha reads as opaque
    const si = channel === 3 ? (ch === 4 ? 3 : ch === 2 ? 1 : -1) : (ch >= 3 ? channel : 0);
    for (let i = 0; i < n; i++) { const v = si < 0 ? max : data[(i * ch) + si]; out[i] = invert ? max - v : v; }
    return encodePNG({ width: w, height: hgt, channels: 1, bitDepth: bits, data: out });
  }
  const outCh = ch >= 3 ? ch : 3, out = bits === 16 ? new Uint16Array(n * outCh) : new Uint8Array(n * outCh);
  for (let i = 0; i < n; i++) for (let c = 0; c < outCh; c++) {
    let v = ch >= 3 ? data[(i * ch) + c] : data[i * ch];
    if (flipGreen && c === 1) v = max - v;
    if (invert && c < 3) v = max - v;
    out[(i * outCh) + c] = v;
  }
  return encodePNG({ width: w, height: hgt, channels: outCh, bitDepth: bits, data: out });
}

// ------------------------------------------------------------ normals
/**
 * Guess the green-channel convention of a tangent normal map from the curl
 * of its slope field. A normal map made from a height h has slopes
 * a = nx/nz = -dh/dx and b = ny/nz. OpenGL (+Y up the image) gives
 * b = +dh/drow, so da/drow = -db/dcol and the correlation is negative.
 * DirectX flips b, so the correlation is positive. Noise and painted maps
 * give a weak score: the result is then 'unknown'.
 * @param {{width,height,channels,bitDepth,data}} img
 * @returns {{convention:'gl'|'dx'|'unknown', score:number, samples:number}}
 */
export function detectNormalConvention(img) {
  const { width: w, height: hgt, channels: ch, bitDepth: bits, data } = img;
  if (ch < 3) return { convention: 'unknown', score: 0, samples: 0 };
  const max = bits === 16 ? 65535 : 255;
  const step = Math.max(1, Math.floor(Math.max(w, hgt) / 384));
  const gw = Math.floor(w / step), gh = Math.floor(hgt / step);
  const A = new Float32Array(gw * gh), B = new Float32Array(gw * gh), V = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const i = (((y * step) * w) + (x * step)) * ch;
    const nx = ((data[i] / max) * 2) - 1, ny = ((data[i + 1] / max) * 2) - 1, nz = ((data[i + 2] / max) * 2) - 1;
    const k = (y * gw) + x;
    if (nz > 0.1) { A[k] = nx / nz; B[k] = ny / nz; V[k] = 1; }
  }
  let num = 0, da2 = 0, db2 = 0, n = 0;
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
    const k = (y * gw) + x;
    if (!V[k - gw] || !V[k + gw] || !V[k - 1] || !V[k + 1]) continue;
    const da = A[k + gw] - A[k - gw], db = B[k + 1] - B[k - 1];
    num += da * db; da2 += da * da; db2 += db * db; n++;
  }
  const score = (da2 > 0 && db2 > 0) ? num / Math.sqrt(da2 * db2) : 0;
  return { convention: score < -0.12 ? 'gl' : score > 0.12 ? 'dx' : 'unknown', score: Math.round(score * 1000) / 1000, samples: n };
}

// ------------------------------------------------------------ image node
/** The registry NodeDef used for imported images, and its image param id. */
export function imageNodeDef() {
  const reg = S.registry;
  for (const t of ['input.image', 'image.file', 'input.texture', 'image.image', 'input.bitmap']) {
    const d = reg.get(t);
    if (d && (d.params || []).some(p => p.kind === 'image')) return { def: d, param: d.params.find(p => p.kind === 'image').id };
  }
  let best = null;
  for (const d of reg.values()) {
    const p = (d.params || []).find(q => q.kind === 'image');
    if (!p || d.source === 'bench') continue;
    const score = (d.category === 'Input' ? 2 : 0) + (/image|texture|bitmap/i.test(d.type) ? 1 : 0) - (d.inputs || []).length;
    if (!best || score > best.score) best = { def: d, param: p.id, score };
  }
  return best;
}
/** Pick the output of an image node for a wanted socket kind or channel. */
export function pickOutput(def, want) {
  const outs = def.outputs || [];
  const byType = t => outs.find(o => o.type === t);
  const chanNames = { r: ['r', 'red'], g: ['g', 'green'], b: ['b', 'blue'], a: ['a', 'alpha'] };
  if (chanNames[want]) return outs.find(o => chanNames[want].includes(String(o.id).toLowerCase()) || chanNames[want].includes(String(o.label).toLowerCase())) || null;
  if (want === 'color') return byType('color') || byType('texture') || byType('vec3') || outs[0] || null;
  if (want === 'normal') return byType('normal') || byType('color') || byType('texture') || byType('vec3') || outs[0] || null;
  if (want === 'float') return outs.find(o => o.type === 'float' && !/^(a|alpha)$/i.test(o.id)) || byType('color') || byType('texture') || outs[0] || null;
  return outs[0] || null;
}
/** Params to set on an image node for a role: color space and DirectX flip. */
function roleParams(def, role, { dx = false } = {}) {
  const out = {};
  const isColor = role === 'baseColor' || role === 'emissive';
  for (const p of def.params || []) {
    const key = `${p.id} ${p.label || ''}`;
    if (/srgb|colou?r ?space|gamma|linear/i.test(key)) {
      if (p.kind === 'bool') out[p.id] = /linear/i.test(key) ? !isColor : isColor;
      else if (p.kind === 'enum') {
        const opts = (p.options || []).map(o => (typeof o === 'string' ? o : o.value));
        const pick = isColor ? opts.find(o => /srgb|color/i.test(o)) : opts.find(o => /linear|raw|data|non/i.test(o));
        if (pick !== undefined) out[p.id] = pick;
      }
    }
    if (role === 'normal' && p.kind === 'bool' && /flip.*(y|green)|directx|\bdx\b/i.test(key)) out.__flipParam = p.id;
    if (role === 'normal' && p.kind === 'enum' && /normal|convention/i.test(key)) out.__convParam = p;
  }
  if (dx && out.__flipParam) out[out.__flipParam] = true;
  return out;
}

// ------------------------------------------------------------ graph ops
const G = {
  json() { const ser = C.modules.graph?.serialize; return ser ? ser(S.graph) : S.graph; },
  addNode(type, x, y, params) {
    const g = C.modules.graph;
    if (g && typeof g.addNode === 'function') return g.addNode(S.graph, type, x, y, params);
    let i = 1; while (S.graph.nodes.some(n => n.id === 'n' + i)) i++;
    const node = { id: 'n' + i, type, x, y, params: { ...params } };
    S.graph.nodes.push(node); return node;
  },
  connect(from, to) {
    const g = C.modules.graph;
    if (g && typeof g.connect === 'function') return g.connect(S.graph, from, to);
    S.graph.links = S.graph.links.filter(l => !(l.to[0] === to[0] && l.to[1] === to[1]));
    S.graph.links.push({ from: [...from], to: [...to] });
  },
  removeNode(id) {
    const g = C.modules.graph;
    if (g && typeof g.removeNode === 'function') return g.removeNode(S.graph, id);
    S.graph.nodes = S.graph.nodes.filter(n => n.id !== id);
    S.graph.links = S.graph.links.filter(l => l.from[0] !== id && l.to[0] !== id);
  },
};

// ------------------------------------------------------------ importMaps
const IMPORT_KEY = 'material-studio.import';
const IOPTS = { normal: 'auto', replace: true, maskOpacity: false };
try { Object.assign(IOPTS, JSON.parse(localStorage.getItem(IMPORT_KEY) || '{}')); } catch (e) {}
const saveIOpts = () => { try { localStorage.setItem(IMPORT_KEY, JSON.stringify(IOPTS)); } catch (e) {} };

const ROLE_ORDER = MATERIAL_INPUTS.map(i => i.id);
const WANT = { baseColor: 'color', emissive: 'color', normal: 'normal' };

/**
 * Import texture maps as Image nodes wired to the Material Output.
 * @param {Array<File|{name:string, data:Uint8Array}>} files
 * @param {{normal?:'auto'|'gl'|'dx', replace?:boolean, roles?:Object<string,object>}} [opts]
 *        roles: file name -> forced role spec (the server import uses it)
 * @returns {Promise<{added:string[], skipped:string[], report:Array<object>}>}
 */
export async function importMaps(files, opts = {}) {
  const o = { ...IOPTS, ...opts };
  const report = [], skipped = [], added = [];
  const img = imageNodeDef();
  if (!img) {
    C.store.toast('The node library has no image node yet, so maps cannot be imported', 'error');
    return { added, skipped: [...files].map(f => f.name), report };
  }
  // 1. roles, with the first file of each role winning (GL normal over DX)
  const items = [];
  for (const f of files) {
    const spec = (o.roles && o.roles[f.name]) || roleFromName(f.name);
    if (!spec || spec.role === 'skip') { skipped.push(f.name); report.push({ file: f.name, result: spec ? 'skipped (not a material map)' : 'skipped (no role in the name)' }); continue; }
    items.push({ f, spec });
  }
  if (!items.length && files.length === 1) { const f = files[0]; skipped.length = 0; report.length = 0; items.push({ f, spec: { role: 'baseColor', word: '(single image)' } }); }
  items.sort((a, b) => (a.spec.conv === 'gl' ? -1 : 0) - (b.spec.conv === 'gl' ? -1 : 0));
  const taken = new Set(), work = [];
  for (const it of items) {
    const targets = it.spec.pack ? Object.values(it.spec.pack) : [it.spec.role];
    if (targets.every(t => taken.has(t))) { skipped.push(it.f.name); report.push({ file: it.f.name, result: `skipped (${targets.join('/')} already imported)` }); continue; }
    targets.forEach(t => taken.add(t));
    work.push(it);
  }
  if (!work.length) { finishReport(report); return { added, skipped, report }; }

  // 2. nodes
  const gj = G.json();
  const outNode = (gj.nodes || []).find(n => n.id === gj.output) || (gj.nodes || []).find(n => n.type === OUTPUT_TYPE);
  if (!outNode) { C.store.toast('The graph has no Material Output', 'error'); return { added, skipped: files.map(f => f.name), report }; }
  const outId = outNode.id;
  const x0 = (outNode.x || 0) - 300;
  let y = (outNode.y || 0) - 40;
  const toRemove = new Set();
  const wire = (nodeId, outPort, input) => {
    if (o.replace) {
      const prev = (gj.links || []).find(l => l.to[0] === outId && l.to[1] === input);
      if (prev) {
        const pn = gj.nodes.find(n => n.id === prev.from[0]);
        const others = gj.links.filter(l => l.from[0] === prev.from[0] && !(l.to[0] === outId && l.to[1] === input));
        if (pn && pn.type === img.def.type && !others.length) toRemove.add(pn.id);
      }
    }
    G.connect([nodeId, outPort], [outId, input]);
  };
  const order = r => ROLE_ORDER.indexOf(r.spec.pack ? Object.values(r.spec.pack)[0] : r.spec.role);
  work.sort((a, b) => order(a) - order(b));

  for (const { f, spec } of work) {
    try {
      const bytes = f.data ? await toBytes(f.data) : new Uint8Array(await f.arrayBuffer());
      const kind = sniffImage(bytes) || (/\.tga$/i.test(f.name) ? 'tga' : null);
      if (!kind || kind === 'zip' || kind === 'exr') { skipped.push(f.name); report.push({ file: f.name, result: kind === 'exr' ? 'skipped (EXR is not supported; use 16-bit PNG)' : 'skipped (not an image)' }); continue; }
      const browserOK = kind !== 'tga';
      const rec = { file: f.name, word: spec.word };
      const mk = async (blobBytes, label, mime) => registerAsset(new Blob([blobBytes], { type: mime }), label);
      const place = (assetRec, role, extraParams = {}) => {
        const params = { ...roleParams(img.def, role), ...extraParams };
        delete params.__flipParam; delete params.__convParam;
        params[img.param] = { name: assetRec.name, url: assetRec.url, asset: assetRec.id, mime: assetRec.mime };
        const node = G.addNode(img.def.type, x0, y, params);
        if (node && !node.label) node.label = labelFor(role, f.name);
        y += 150;
        added.push(node.id);
        return node;
      };
      if (spec.pack) {
        const chOuts = Object.keys(spec.pack).map(c => [c, pickOutput(img.def, c)]);
        const decoded = await decodeImage(bytes, f.name);
        rec.size = `${decoded.width}x${decoded.height} ${decoded.bitDepth}-bit`;
        const canDirect = chOuts.every(([, out]) => out) && !(spec.invA && spec.pack.a);
        if (canDirect) {
          const a = await mk(browserOK ? bytes : await derivePNG(decoded, {}), f.name, browserOK ? mimeOf(kind, f.name) : 'image/png');
          const node = place(a, 'packed');
          for (const [c, out] of chOuts) wire(node.id, out.id, spec.pack[c]);
          rec.result = `packed ${Object.entries(spec.pack).map(([c, r]) => `${c.toUpperCase()}->${r}`).join(' ')}`;
        } else {
          const parts = [];
          for (const [c, role] of Object.entries(spec.pack)) {
            const png = await derivePNG(decoded, { channel: 'rgba'.indexOf(c), invert: !!(spec.invA && c === 'a') });
            const a = await mk(png, `${f.name.replace(/\.[^.]+$/, '')}.${c}.png`, 'image/png');
            const node = place(a, role);
            const out = pickOutput(img.def, 'float');
            wire(node.id, out.id, role);
            parts.push(`${c.toUpperCase()}->${role}${spec.invA && c === 'a' ? ' (1-A)' : ''}`);
          }
          rec.result = `split ${parts.join(' ')}`;
        }
      } else if (spec.role === 'normal') {
        const decoded = await decodeImage(bytes, f.name);
        rec.size = `${decoded.width}x${decoded.height} ${decoded.bitDepth}-bit`;
        let conv = o.normal === 'auto' ? spec.conv : o.normal;
        let det = null;
        if (!conv) { det = detectNormalConvention(decoded); conv = det.convention === 'dx' ? 'dx' : 'gl'; }
        const rp = roleParams(img.def, 'normal', { dx: conv === 'dx' });
        let a;
        if (conv === 'dx' && !rp.__flipParam) a = await mk(await derivePNG(decoded, { flipGreen: true }), f.name.replace(/\.[^.]+$/, '') + '.gl.png', 'image/png');
        else a = await mk(browserOK ? bytes : await derivePNG(decoded, {}), f.name, browserOK ? mimeOf(kind, f.name) : 'image/png');
        const extra = {}; if (conv === 'dx' && rp.__flipParam) extra[rp.__flipParam] = true;
        const node = place(a, 'normal', extra);
        wire(node.id, pickOutput(img.def, 'normal').id, 'normal');
        rec.result = `normal ${conv === 'dx' ? 'DirectX, green flipped to OpenGL' : 'OpenGL'}${det ? ` (detected, score ${det.score})` : spec.conv ? ' (from the name)' : ' (set by the option)'}`;
        rec.convention = conv; if (det) rec.detect = det;
      } else {
        let a;
        if (spec.inv || !browserOK) {
          const decoded = await decodeImage(bytes, f.name);
          rec.size = `${decoded.width}x${decoded.height} ${decoded.bitDepth}-bit`;
          a = await mk(await derivePNG(decoded, spec.inv ? { channel: 0, invert: true } : {}), f.name.replace(/\.[^.]+$/, '') + (spec.inv ? '.rough.png' : '.png'), 'image/png');
        } else a = await mk(bytes, f.name, mimeOf(kind, f.name));
        const node = place(a, spec.role);
        wire(node.id, pickOutput(img.def, WANT[spec.role] || 'float').id, spec.role);
        rec.result = spec.inv ? `${spec.role} (inverted from ${spec.word})` : spec.role;
        // a base color PNG with an alpha channel also feeds opacity when no
        // opacity map came with it
        const aOut = pickOutput(img.def, 'a');
        if (spec.role === 'baseColor' && aOut && !taken.has('opacity') && kind === 'png' && (bytes[25] === 6 || bytes[25] === 4)) {
          wire(node.id, aOut.id, 'opacity'); taken.add('opacity');
          rec.result += ' + alpha -> opacity';
        }
      }
      report.push(rec);
    } catch (e) {
      console.error('[import]', f.name, e);
      skipped.push(f.name); report.push({ file: f.name, result: 'failed: ' + (e.message || e) });
    }
  }
  for (const id of toRemove) G.removeNode(id);
  if (added.length) {
    C.store.emit('graph:changed', { reason: 'edit', nodeIds: added });
    C.store.checkpoint(`Import ${added.length} map${added.length > 1 ? 's' : ''}`);
    C.store.select(added);
    C.store.toast(`Imported ${added.length} image node${added.length > 1 ? 's' : ''}${skipped.length ? ` · ${skipped.length} skipped` : ''}`, 'ok');
  } else C.store.toast('No maps were imported', 'warn');
  finishReport(report);
  return { added, skipped, report };
}
function labelFor(role, file) {
  const m = MATERIAL_INPUTS.find(i => i.id === role);
  return `${m ? m.label : 'Image'} · ${String(file).split('/').pop()}`.slice(0, 48);
}
function finishReport(report) {
  lastReport = report;
  if (!UI.report) return;
  UI.report.textContent = '';
  for (const r of report) {
    const li = document.createElement('li');
    const a = document.createElement('span'); a.textContent = r.file;
    const b = document.createElement('i'); b.textContent = r.result;
    if (/^(skipped|failed)/.test(r.result)) li.className = 'skip';
    li.append(a, b); UI.report.append(li);
  }
}

// ------------------------------------------------------------ project
/**
 * Load a studio project, a plain graph JSON, or (through the bench module) a
 * Composition Bench graph.
 * @param {object|string} json
 * @returns {Promise<{ok:boolean, kind:string, warnings:string[]}>}
 */
export async function loadProject(json) {
  const j = typeof json === 'string' ? JSON.parse(json) : json;
  const warnings = [];
  let graph = null, kind = 'graph';
  if (j && j.format === 'stella-material-studio') { graph = j.graph; kind = 'project'; }
  else if (j && j.version === 1 && Array.isArray(j.nodes) && Array.isArray(j.links) && j.nodes.some(n => n.type === OUTPUT_TYPE)) graph = j;
  else {
    const bench = window.__studio?.bench, mod = C.modules.bench;
    const fn = bench?.importBenchGraph || mod?.importBenchGraph;
    if (typeof fn === 'function') {
      const r = await fn(j);
      C.store.toast('Composition Bench graph imported', 'ok');
      return { ok: true, kind: 'bench', warnings: [], result: r };
    }
    throw new Error('This JSON is not a studio project or material graph');
  }
  if (!graph) throw new Error('The project has no graph');
  graph = JSON.parse(JSON.stringify(graph));
  if (j.assets) {
    for (const n of graph.nodes || []) for (const [k, v] of Object.entries(n.params || {})) {
      if (!v || typeof v !== 'object' || !v.asset) continue;
      const a = await restoreAsset(v.asset, j.assets[v.asset]);
      if (a) n.params[k] = { ...v, url: a.url, mime: a.mime };
      else warnings.push(`image ${v.name || v.asset} is missing`);
    }
  }
  const v = validateGraph(graph, S.registry);
  if (!v.ok) warnings.push(...v.errors);
  const des = C.modules.graph?.deserialize;
  S.graph = des ? des(graph) : graph;
  const settings = { ...DEFAULT_SETTINGS, ...(graph.settings || {}), ...(j.settings || {}) };
  const res = settings.res;
  Object.assign(S.settings, settings);
  if (j.view) C.store.setView(j.view);
  if (j.env) C.store.setEnv(j.env);
  C.store.resetHistory();
  C.store.select([]);
  C.store.emit('graph:changed', { reason: 'load' });
  C.store.emit('res:changed', { res });
  C.store.toast(`Loaded ${j.name || graph.name || 'project'}${warnings.length ? ` · ${warnings.length} warning${warnings.length > 1 ? 's' : ''}` : ''}`, warnings.length ? 'warn' : 'ok');
  if (warnings.length) console.warn('[import] project warnings', warnings);
  return { ok: true, kind, warnings };
}

// ------------------------------------------------------------ importFiles
const IMAGE_EXT = /\.(png|jpe?g|webp|tga|gif|bmp|exr|tiff?)$/i;
/**
 * Import any mix of files: the first JSON loads as a project; zips expand;
 * images go to importMaps.
 * @param {FileList|File[]} list
 */
export async function importFiles(list) {
  const files = [...list];
  const images = [];
  for (const f of files) {
    try {
      if (/\.json$/i.test(f.name) || f.type === 'application/json') { await loadProject(await f.text()); continue; }
      if (/\.zip$/i.test(f.name) || f.type === 'application/zip') {
        const entries = await readZip(f);
        const proj = entries.find(e => /\.studio\.json$/i.test(e.name));
        const imgs = entries.filter(e => IMAGE_EXT.test(e.name));
        if (proj && !imgs.length) { await loadProject(new TextDecoder().decode(proj.data)); continue; }
        images.push(...imgs.map(e => ({ name: e.name.split('/').pop(), data: e.data })));
        continue;
      }
      if (IMAGE_EXT.test(f.name) || /^image\//.test(f.type)) images.push(f);
      else C.store.toast(`${f.name}: unknown file type`, 'warn');
    } catch (e) { console.error('[import]', e); C.store.toast(`${f.name}: ${e.message || e}`, 'error'); }
  }
  if (images.length) return importMaps(images);
  return null;
}

let picker = null;
/** Open the file picker. @param {string} [accept] */
export function pickFiles(accept = '.json,.zip,image/*,.tga', handler = importFiles) {
  if (!picker) {
    picker = document.createElement('input');
    picker.type = 'file'; picker.multiple = true; picker.hidden = true;
    document.body.append(picker);
  }
  picker.accept = accept;
  picker.onchange = () => { const fl = [...picker.files]; picker.value = ''; if (fl.length) handler(fl); };
  picker.click();
}

function dragAndDrop() {
  let depth = 0;
  const overlay = document.createElement('div');
  overlay.id = 'io-drop';
  overlay.innerHTML = '<div><b>Drop to import</b><span>maps (png, jpg, tga, webp) · zip of maps · .studio.json project · graph JSON</span></div>';
  document.body.append(overlay);
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; depth++; document.body.classList.add('io-drop'); });
  window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('io-drop'); });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => {
    depth = 0; document.body.classList.remove('io-drop');
    if (!hasFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    importFiles(e.dataTransfer.files);
  });
}

// ------------------------------------------------------------ server
const SERVER_KEY = 'material-studio.pbrServer';
const server = { url: 'http://localhost:8787', ok: false, device: '', checked: false };
try { const s = JSON.parse(localStorage.getItem(SERVER_KEY) || 'null'); if (s && s.url) { server.url = s.url; server.wasOk = !!s.ok; } } catch (e) {}
const apiBase = () => server.url.replace(/\/+$/, '');

/** Probe the material-lab server /health. @returns {Promise<{url,ok,device}>} */
export async function probeServer(url = server.url) {
  server.url = url;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 1500);
  try {
    const r = await fetch(apiBase() + '/health', { signal: ac.signal, cache: 'no-store' });
    const d = r.ok ? await r.json() : null;
    server.ok = !!(d && d.status === 'ok'); server.device = d?.device || '';
  } catch (e) { server.ok = false; server.device = ''; }
  finally { clearTimeout(t); server.checked = true; }
  try { localStorage.setItem(SERVER_KEY, JSON.stringify({ url: server.url, ok: server.ok })); } catch (e) {}
  renderServer();
  return serverStatus();
}
export function serverStatus() { return { url: server.url, ok: server.ok, device: server.device, checked: server.checked }; }

/**
 * Send one photo to the server POST /pbr and import the returned maps.
 * Server keys: albedo, mask, depth, normals, roughness, metallic, ao (base64 PNG).
 * @param {File|Blob} file
 */
export async function imageToPBR(file) {
  if (!server.ok) throw new Error('The Image to PBR server is not reachable');
  const fd = new FormData();
  fd.append('file', file, file.name || 'photo.png');
  setServerMsg('Running segmentation, depth and PBR estimation on the server…');
  const t0 = performance.now();
  const r = await fetch(apiBase() + '/pbr', { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
  const d = await r.json();
  const stem = String(file.name || 'photo').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_');
  const map = { albedo: 'baseColor', normals: 'normal', roughness: 'roughness', metallic: 'metallic', ao: 'ao', depth: 'height' };
  if (IOPTS.maskOpacity) map.mask = 'opacity';
  const files = [], roles = {};
  for (const [k, role] of Object.entries(map)) {
    if (!d[k]) continue;
    const name = `${stem}_${k}.png`;
    files.push({ name, data: Uint8Array.from(atob(d[k]), c => c.charCodeAt(0)) });
    roles[name] = role === 'normal' ? { role, conv: 'gl', word: 'server' } : { role, word: 'server' };
  }
  setServerMsg(`Server done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  return importMaps(files, { roles, normal: 'auto' });
}
function setServerMsg(t) { if (UI.srvMsg) UI.srvMsg.textContent = t; }
function renderServer() {
  if (!UI.srv) return;
  UI.srv.hidden = !server.ok && !UI.srvForce;
  UI.srvState.textContent = server.ok ? `connected · ${server.device || 'server'}` : server.checked ? 'not reachable' : 'not checked';
  UI.srvState.dataset.ok = server.ok ? '1' : '0';
  UI.srvRun.disabled = !server.ok;
}

// ------------------------------------------------------------ ui
/** Fill the Import section (export.js calls this inside #export-panel). */
export function mountImportUI(sec) {
  const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; };
  sec.append(el('h4', '', 'Import'));
  const btns = el('div', 'io-btns');
  const b1 = el('button', 'io-btn', 'Import maps…'); b1.type = 'button'; b1.onclick = () => pickFiles('image/*,.tga,.zip');
  const b2 = el('button', 'io-btn', 'Open project…'); b2.type = 'button'; b2.onclick = () => pickFiles('.json,application/json,.zip');
  btns.append(b1, b2);
  const conv = document.createElement('select'); conv.className = 'io-sel';
  for (const [v, l] of [['auto', 'Auto (name, then detect)'], ['gl', 'OpenGL (+Y)'], ['dx', 'DirectX (-Y): flip']]) conv.add(new Option(l, v));
  conv.value = IOPTS.normal; conv.onchange = () => { IOPTS.normal = conv.value; saveIOpts(); };
  const row = el('label', 'io-row'); row.append(el('span', 'io-k', 'Normals'), conv);
  const rep = el('label', 'io-chk'); const rc = document.createElement('input'); rc.type = 'checkbox'; rc.checked = IOPTS.replace;
  rc.onchange = () => { IOPTS.replace = rc.checked; saveIOpts(); }; rep.append(rc, el('span', '', 'Replace image nodes on the same input'));
  const hint = el('p', 'io-hint-p', 'Names pick the input: _albedo _basecolor _diff · _normal _nrm (_gl/_dx) · _rough · _gloss · _metal · _ao · _orm/_arm · _maskmap · _height _disp · _emissive · _opacity. Drop files anywhere.');
  UI.report = el('ul', 'io-report');
  // server
  const srv = el('div', 'io-srv'); srv.hidden = true;
  const sHead = el('div', 'io-srv-head'); sHead.append(el('b', '', 'Image to PBR (server)'));
  UI.srvState = el('span', 'io-srv-state', 'not checked'); sHead.append(UI.srvState);
  const url = document.createElement('input'); url.className = 'io-in mono'; url.value = server.url; url.spellcheck = false;
  const chkB = el('button', 'io-btn', 'Check'); chkB.type = 'button'; chkB.onclick = () => probeServer(url.value.trim());
  const urow = el('div', 'io-srv-row'); urow.append(url, chkB);
  UI.srvRun = el('button', 'io-btn io-btn-a', 'Photo to PBR maps…'); UI.srvRun.type = 'button';
  UI.srvRun.onclick = () => pickFiles('image/*', fl => imageToPBR(fl[0]).catch(e => { setServerMsg('failed: ' + e.message); C.store.toast(e.message, 'error'); }));
  const mo = el('label', 'io-chk'); const mc = document.createElement('input'); mc.type = 'checkbox'; mc.checked = IOPTS.maskOpacity;
  mc.onchange = () => { IOPTS.maskOpacity = mc.checked; saveIOpts(); }; mo.append(mc, el('span', '', 'Use the segmentation mask as opacity'));
  UI.srvMsg = el('div', 'io-stage mono');
  srv.append(sHead, urow, UI.srvRun, mo, UI.srvMsg);
  UI.srv = srv;
  sec.append(btns, row, rep, hint, UI.report, srv);
  renderServer();
}

// ------------------------------------------------------------ selfTest / init
/** Checks without the GPU: role names, normal convention, TGA, derive. */
export async function selfTest() {
  const checks = {};
  const role = n => { const r = roleFromName(n); return r ? (r.pack ? 'pack:' + Object.values(r.pack).join('/') : r.role + (r.conv ? ':' + r.conv : '') + (r.inv ? ':inv' : '')) : null; };
  const cases = {
    'rock_wall_diff_2k.jpg': 'baseColor', 'rock_wall_nor_gl_2k.png': 'normal:gl', 'rock_wall_nor_dx_2k.png': 'normal:dx',
    'rock_wall_arm_2k.png': 'pack:ao/roughness/metallic', 'Bricks059_2K-PNG_Color.png': 'baseColor',
    'Bricks059_2K-PNG_NormalGL.png': 'normal:gl', 'Bricks059_2K-PNG_AmbientOcclusion.png': 'ao',
    'Bricks059_2K-PNG_Displacement.png': 'height', 'Metal_Metalness.png': 'metallic', 'wood_Gloss.jpg': 'roughness:inv',
    'Crate_MetallicSmoothness.png': 'pack:metallic/roughness', 'Crate_MaskMap.png': 'pack:metallic/ao/roughness',
    'T_Rock_ORM.tga': 'pack:ao/roughness/metallic', 'lava_emissive.png': 'emissive', 'leaf_opacity.png': 'opacity',
    'Mat_OcclusionRoughnessMetallic.png': 'pack:ao/roughness/metallic', 'foo_Preview.png': 'skip', 'T_Rock_N.tga': 'normal',
    'car_clearcoat.png': 'clearcoat', 'car_clearcoat_roughness.png': 'clearcoatRoughness', 'velvet_Sheen.png': 'sheen', 'hair_aniso.png': 'anisotropy',
  };
  const bad = Object.entries(cases).filter(([n, want]) => role(n) !== want).map(([n, want]) => `${n}: ${role(n)} != ${want}`);
  checks.roles = bad.length ? bad : true;
  // synthetic GL normal map from a bumpy height field
  const w = 96, data = new Uint8Array(w * w * 3);
  const hf = (x, y) => (Math.sin(x * 0.21) * Math.cos(y * 0.17)) + (0.5 * Math.sin((x + (2 * y)) * 0.11));
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const hx = (hf(x + 1, y) - hf(x - 1, y)) * 2, hr = (hf(x, y + 1) - hf(x, y - 1)) * 2;
    const nx = -hx, ny = hr, nz = 1, l = Math.hypot(nx, ny, nz), i = ((y * w) + x) * 3;
    data[i] = Math.round(((nx / l) * 127.5) + 127.5); data[i + 1] = Math.round(((ny / l) * 127.5) + 127.5); data[i + 2] = Math.round(((nz / l) * 127.5) + 127.5);
  }
  const gl = detectNormalConvention({ width: w, height: w, channels: 3, bitDepth: 8, data });
  const dxData = data.slice(); for (let i = 1; i < dxData.length; i += 3) dxData[i] = 255 - dxData[i];
  const dx = detectNormalConvention({ width: w, height: w, channels: 3, bitDepth: 8, data: dxData });
  checks.normalGL = gl; checks.normalDX = dx;
  checks.normals = gl.convention === 'gl' && dx.convention === 'dx';
  // tga roundtrip through zip.js encodeTGA
  const { encodeTGA } = await import('./zip.js');
  const px = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const t = decodeTGA(encodeTGA({ width: 2, height: 2, channels: 4, data: px }));
  checks.tga = t.data.every((v, i) => v === px[i]);
  checks.imageNode = imageNodeDef()?.def.type || null;
  checks.server = serverStatus();
  const ok = checks.roles === true && checks.normals && checks.tga;
  return { ok, checks, lastReport };
}

/** @param {object} ctx main.js module context */
export async function init(ctx) {
  C = ctx; S = ctx.store.state;
  dragAndDrop();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const qs = new URLSearchParams(location.search).get('pbrserver');
  if (qs) server.url = qs;
  if (local || qs || server.wasOk) probeServer(server.url); // not awaited: init must not wait on the network
}

