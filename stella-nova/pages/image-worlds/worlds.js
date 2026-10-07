// ============================================================================
//  IMAGE WORLDS  ·  worlds.js — read image-blaster world folders
// ────────────────────────────────────────────────────────────────────────────
//  DOM-free (Node runs it in tests.mjs). It turns a list of files into world
//  records, with the same rules as the upstream viewer's Vite plugin
//  (image-blaster app/vite.config.ts, function readWorlds). Every file comes
//  in as an ENTRY, so a hosted world (manifest.json + fetch) and a local
//  folder (a file picker or a drop) take one path.
//
//  IMAGE-BLASTER LAYOUT  (one world; N is the generation index)
//    <slug>/project.json                 display_name, notes
//    <slug>/scene.json                   version 1: instances (placements),
//                                        sun, metricScaleFactor,
//                                        groundPlaneOffset, ...
//    <slug>/source/N-<name>.<img>        the source image (index 0 first)
//    <slug>/output/world/N-world.json    World Labs world record: assets.
//                                        splats.semantics_metadata
//    <slug>/output/world/N-world-<key>.spz   key: 100k 150k 500k full_res
//    <slug>/output/world/N-world.glb     collider mesh
//    <slug>/output/world/N-world-pano.<img>, N-world-thumbnail.<img>,
//                        N-world-plate.<img>
//    <slug>/output/sfx/N-<name>.<audio>  world ambience (looped)
//    <slug>/output/<object>/object.json  object.name
//    <slug>/output/<object>/N-<object>.glb   the mesh (latest N wins)
//    <slug>/output/<object>/N-*.<img>    reference and thumbnail images
//    <slug>/output/<object>/sfx/*.<audio>   impact sounds (one-shots)
//  A path part that starts with "." is hidden (request JSON) and skipped.
//  A loose .spz/.ply/.splat/.ksplat with no world folder round it becomes a
//  world of its own.
//
//  ENTRY  { path, size, text(), bytes(onProgress), href(), release() }
//    path is relative, "/" separated. href() gives a URL for an <img>;
//    release() frees a blob URL that href() made.
//
//  EXPORTS
//    parseIndexedName(name) ..... { index, slug, ext, hidden } | undefined
//    entryFromUrl(path, url, size) / entryFromFile(path, file) /
//    entryFromBytes(path, bytes) .. ENTRY makers
//    parseManifest(json, base) .. { worlds: [{ slug, name, credit, licence,
//                                   note, saver, start, background,
//                                   entries }], errors: [] }
//    loadWorlds(entries) ........ async -> [WORLD]
//    pickSplat(world, quality) .. { key, entry } for 'low' | 'mid' | 'high'
//    sanitizeScene(json) ........ upstream sanitizePlacementProject
//    matchPlacements(objects, scene), gridPosition(i, n)
//                                 placements -> objects, the default grid
//    SPLAT_EXT, MODEL_EXT, AUDIO_EXT, IMAGE_EXT
//
//  WORLD  { slug, name, notes, root, loose, source, sourceVersions,
//           version, versions, splats: { key: ENTRY }, collider, pano,
//           thumbnail, plate, semantics: { metricScale, groundOffset, flipY },
//           scene, objects: [{ id, name, model, thumb, sfx: [ENTRY] }],
//           ambient: [ENTRY], files, warnings }
// ============================================================================
export const SPLAT_EXT = new Set(['.spz', '.ply', '.splat', '.ksplat']);
export const MODEL_EXT = new Set(['.glb']);
export const AUDIO_EXT = new Set(['.mp3', '.ogg', '.wav', '.m4a', '.opus']);
export const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);
const RESERVED = new Set(['world', 'sfx']);
const SPZ_KEYS = ['full_res', '500k', '150k', '100k'];

const extOf = p => { const m = /(\.[^./]+)$/.exec(p); return m ? m[1].toLowerCase() : ''; };
const baseOf = p => p.slice(p.lastIndexOf('/') + 1);
const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';

export function parseIndexedName(name) {
  const rq = /^\.(\d+)-(.+?)(?:__([a-z0-9._-]+))?-request\.json$/i.exec(name);
  if (rq) return { index: +rq[1], slug: rq[2], scope: rq[3], ext: '.json', hidden: true };
  const m = /^(\d+)-(.+?)(\.[^.]+)$/.exec(name);
  if (!m) return undefined;
  return { index: +m[1], slug: m[2], ext: m[3].toLowerCase(), hidden: false };
}

export function displayName(slug) {
  return String(slug).split(/[-_]/).filter(Boolean).map(s => s[0].toUpperCase() + s.slice(1)).join(' ') || 'Untitled world';
}

// ── entries ────────────────────────────────────────────────────────────────
// A stream read joins chunks at their real size: GitHub Pages gzips some
// types, so content-length is the compressed size and only drives progress.
async function readStream(res, size, onProgress) {
  if (!res.body || !res.body.getReader) return new Uint8Array(await res.arrayBuffer());
  const total = size || +res.headers.get('content-length') || 0;
  const reader = res.body.getReader(), parts = []; let n = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value); n += value.length;
    if (onProgress) onProgress(total ? Math.min(1, n / total) : 0, n);
  }
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function entryFromUrl(path, url, size = 0) {
  const get = async () => { const r = await fetch(url); if (!r.ok) throw new Error(r.status + ' ' + url); return r; };
  return {
    path, size, url,
    text: async () => (await get()).text(),
    bytes: async onProgress => readStream(await get(), size, onProgress),
    head: async n => { const r = await fetch(url, { headers: { Range: 'bytes=0-' + (n - 1) } }); if (!r.ok) throw new Error(r.status + ' ' + url); const b = new Uint8Array(await r.arrayBuffer()); return b.subarray(0, n); },
    href: () => url,
    release() {},
  };
}

export function entryFromFile(path, file) {
  let blobUrl = null;
  return {
    path, size: file.size, file,
    text: () => file.text(),
    bytes: async onProgress => { const b = new Uint8Array(await file.arrayBuffer()); if (onProgress) onProgress(1, b.length); return b; },
    head: async n => new Uint8Array(await file.slice(0, n).arrayBuffer()),
    href: () => blobUrl || (blobUrl = URL.createObjectURL(file)),
    release() { if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; } },
  };
}

export function entryFromBytes(path, bytes) {
  const b = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return {
    path, size: b.length,
    text: async () => new TextDecoder().decode(b),
    bytes: async () => b,
    head: async n => b.subarray(0, n),
    href: () => 'data:,' + encodeURIComponent(path),
    release() {},
  };
}

// ── hosted manifest ────────────────────────────────────────────────────────
// worlds/manifest.json: { version: 1, worlds: [{ slug, name?, credit?,
// licence?, note?, saver?: { target: [x, y, z], radius: [r0, r1] },
// start?: { position: [x, y, z], target: [x, y, z] } (the first view),
// background?: '#rrggbb' (the colour round the splat),
// files: ['project.json', 'output/world/0-world.json', ...], sizes?: { file: bytes } }] }
// A static host cannot list a folder, so the manifest lists the files.
// tools/make-manifest.mjs writes the files lists from the folders.
const SAFE_SLUG = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const safeRel = f => typeof f === 'string' && f.length < 400 && !/^[\\/]|:|\\|(^|\/)\.\.(\/|$)/.test(f);

export function parseManifest(json, base = './worlds/') {
  const out = { worlds: [], errors: [] };
  if (!json || typeof json !== 'object' || json.version !== 1 || !Array.isArray(json.worlds)) {
    out.errors.push('manifest: expected { version: 1, worlds: [] }');
    return out;
  }
  const seen = new Set();
  json.worlds.forEach((w, i) => {
    if (!w || typeof w !== 'object') return out.errors.push('worlds[' + i + ']: not an object');
    if (!SAFE_SLUG.test(w.slug || '')) return out.errors.push('worlds[' + i + ']: bad slug ' + JSON.stringify(w.slug));
    if (seen.has(w.slug)) return out.errors.push('worlds[' + i + ']: duplicate slug ' + w.slug);
    if (!Array.isArray(w.files) || !w.files.length) return out.errors.push(w.slug + ': no files');
    const bad = w.files.filter(f => !safeRel(f));
    if (bad.length) out.errors.push(w.slug + ': skipped unsafe paths ' + bad.join(', '));
    seen.add(w.slug);
    const str = v => typeof v === 'string' ? v.slice(0, 400) : '';
    const sizes = w.sizes && typeof w.sizes === 'object' ? w.sizes : {};
    const sv = w.saver && typeof w.saver === 'object' && isVec3(w.saver.target)
      ? { target: w.saver.target, radius: Array.isArray(w.saver.radius) && w.saver.radius.length === 2 && w.saver.radius.every(num) ? w.saver.radius : [2, 3] } : null;
    const start = w.start && typeof w.start === 'object' && isVec3(w.start.position) && isVec3(w.start.target) ? { position: w.start.position, target: w.start.target } : null;
    out.worlds.push({
      slug: w.slug, name: str(w.name), credit: str(w.credit), licence: str(w.licence), note: str(w.note), saver: sv, start,
      background: typeof w.background === 'string' && /^#[0-9a-f]{6}$/i.test(w.background) ? w.background.toLowerCase() : '',
      entries: w.files.filter(safeRel).map(f => entryFromUrl(w.slug + '/' + f, base + w.slug + '/' + f.split('/').map(encodeURIComponent).join('/'), +sizes[f] || 0)),
    });
  });
  return out;
}

// ── scene.json ─────────────────────────────────────────────────────────────
const isVec3 = v => Array.isArray(v) && v.length === 3 && v.every(x => typeof x === 'number' && Number.isFinite(x));
const num = v => typeof v === 'number' && Number.isFinite(v);

export function sanitizeScene(rec) {
  if (!rec || typeof rec !== 'object' || rec.version !== 1 || !Array.isArray(rec.instances)) return null;
  const instances = rec.instances.flatMap(it => {
    if (!it || typeof it !== 'object') return [];
    const { instanceId, objectId, assetId, physics, position, rotation, scale } = it;
    if (typeof instanceId !== 'string' || typeof objectId !== 'string') return [];
    if (assetId !== undefined && typeof assetId !== 'string') return [];
    if (physics !== undefined && !['rigidbody', 'static', 'ghost'].includes(physics)) return [];
    if (!isVec3(position) || !isVec3(rotation) || !isVec3(scale)) return [];
    return [{ instanceId, objectId, ...(assetId ? { assetId } : {}), physics: physics || 'rigidbody', position, rotation, scale }];
  });
  const s = rec.sun && typeof rec.sun === 'object' && num(rec.sun.intensity) && isVec3(rec.sun.rotation)
    ? { intensity: rec.sun.intensity, rotation: rec.sun.rotation, ...(num(rec.sun.environmentIntensity) ? { environmentIntensity: rec.sun.environmentIntensity } : {}) } : null;
  return {
    version: 1, instances,
    ...(s ? { sun: s } : {}),
    ...(num(rec.metricScaleFactor) ? { metricScaleFactor: rec.metricScaleFactor } : {}),
    ...(num(rec.groundPlaneOffset) ? { groundPlaneOffset: rec.groundPlaneOffset } : {}),
    ...(typeof rec.groundPlaneColliderEnabled === 'boolean' ? { groundPlaneColliderEnabled: rec.groundPlaneColliderEnabled } : {}),
    ...(num(rec.shadowCatcherOpacity) ? { shadowCatcherOpacity: Math.min(1, Math.max(0, rec.shadowCatcherOpacity)) } : {}),
    ...(typeof rec.shadowCatcherColor === 'string' && /^#[0-9a-f]{6}$/i.test(rec.shadowCatcherColor) ? { shadowCatcherColor: rec.shadowCatcherColor.toLowerCase() } : {}),
  };
}

// ── folder walk ────────────────────────────────────────────────────────────
// Strip a shared leading part that is not a world (the user picked the
// image-blaster repo or its worlds/ folder), then find the world roots: a
// folder with project.json, or the folder above an output/world/ folder.
function findRoots(paths) {
  const roots = new Set();
  for (const p of paths) {
    if (baseOf(p) === 'project.json') roots.add(dirOf(p));
    const i = p.indexOf('output/world/');
    if (i === 0 || (i > 0 && p[i - 1] === '/')) roots.add(i ? p.slice(0, i - 1) : '');
  }
  // A root inside another root (output/<object>/... cannot hold project.json
  // in practice, but a nested copy can): keep the outer one.
  const list = [...roots].sort((a, b) => a.length - b.length);
  return list.filter(r => !list.some(o => o !== r && (o === '' || r.startsWith(o + '/'))));
}

async function readJson(entry, warnings) {
  if (!entry) return null;
  try { return JSON.parse(await entry.text()); }
  catch (e) { warnings.push(entry.path + ': ' + (e.message || e)); return null; }
}

const indexed = (entries, exts, slugs) => entries
  .map(e => ({ e, n: parseIndexedName(baseOf(e.path)), ext: extOf(e.path) }))
  .filter(x => (!exts || exts.has(x.ext)) && (!x.n || !x.n.hidden))
  .filter(x => !slugs || (x.n && slugs.includes(x.n.slug)))
  .sort((a, b) => ((a.n ? a.n.index : 1e15) - (b.n ? b.n.index : 1e15)) || baseOf(a.e.path).localeCompare(baseOf(b.e.path)));

async function buildWorld(root, entries, meta = {}) {
  const warnings = [];
  const rel = new Map();
  for (const e of entries) {
    const r = root ? e.path.slice(root.length + 1) : e.path;
    if (r.split('/').some(part => part.startsWith('.'))) continue;
    rel.set(r, e);
  }
  const inDir = d => [...rel].filter(([r]) => dirOf(r) === d).map(([, e]) => e);
  const slug = meta.slug || baseOf(root) || 'world';
  const project = await readJson(rel.get('project.json'), warnings) || {};
  const scene = sanitizeScene(await readJson(rel.get('scene.json'), warnings));

  // Source image: index 0, else the first.
  const src = indexed(inDir('source'), IMAGE_EXT);
  const source = (src.find(x => x.n && x.n.index === 0) || src[0] || {}).e || null;

  // World versions: each N-world.json, with the files of the same index.
  const wdir = inDir('output/world');
  const wfiles = indexed(wdir, null);
  const versionIdx = [...new Set(wfiles.filter(x => x.n && x.n.slug === 'world' && x.ext === '.json').map(x => x.n.index))].sort((a, b) => a - b);
  const pickIdx = (i, slugName, exts) => (wfiles.find(x => x.n && x.n.index === i && x.n.slug === slugName && (!exts || exts.has(x.ext))) || {}).e || null;
  const versions = [];
  for (const i of versionIdx) {
    const rec = await readJson(pickIdx(i, 'world', new Set(['.json'])), warnings) || {};
    const splats = {};
    for (const x of wfiles) {
      if (!x.n || x.n.index !== i || !SPLAT_EXT.has(x.ext)) continue;
      const m = /^world-(.+)$/.exec(x.n.slug);
      if (m) splats[m[1]] = x.e;
    }
    const sm = (((rec.assets || {}).splats || {}).semantics_metadata) || {};
    versions.push({
      index: i, record: rec, splats,
      collider: pickIdx(i, 'world', MODEL_EXT), pano: pickIdx(i, 'world-pano', IMAGE_EXT),
      thumbnail: pickIdx(i, 'world-thumbnail', IMAGE_EXT), plate: pickIdx(i, 'world-plate', IMAGE_EXT),
      semantics: { metricScale: num(sm.metric_scale_factor) ? sm.metric_scale_factor : 1, groundOffset: num(sm.ground_plane_offset) ? sm.ground_plane_offset : 0, flipY: typeof sm.flip_y === 'boolean' ? sm.flip_y : true },
      caption: typeof (rec.assets || {}).caption === 'string' ? rec.assets.caption : '',
      prompt: typeof rec.world_prompt === 'string' ? rec.world_prompt : '',
    });
  }
  // Splat files with no N-world.json (a partial copy): a version from the
  // highest index found, with the default semantics.
  if (!versions.length) {
    const loose = wfiles.filter(x => SPLAT_EXT.has(x.ext));
    if (loose.length) {
      const splats = {};
      for (const x of loose) { const m = x.n && /^world-(.+)$/.exec(x.n.slug); splats[m ? m[1] : baseOf(x.e.path)] = x.e; }
      versions.push({ index: 0, record: {}, splats, collider: pickIdx(0, 'world', MODEL_EXT), pano: null, thumbnail: null, plate: null, semantics: { metricScale: 1, groundOffset: 0, flipY: true }, caption: '', prompt: '' });
      warnings.push('output/world has splat files but no N-world.json: flip_y assumed true');
    }
  }
  const complete = versions.filter(v => Object.keys(v.splats).length);
  const ver = complete[complete.length - 1] || versions[versions.length - 1] || null;
  if (!ver || !Object.keys(ver.splats).length) warnings.push('no splat file in output/world');

  // Objects: each output/<dir> but world and sfx, latest indexed .glb.
  const objDirs = new Set();
  for (const r of rel.keys()) { const m = /^output\/([^/]+)\//.exec(r); if (m && !RESERVED.has(m[1])) objDirs.add(m[1]); }
  const objects = [];
  for (const d of [...objDirs].sort()) {
    const files = inDir('output/' + d);
    const models = indexed(files, MODEL_EXT);
    if (!models.length) continue;
    const model = models[models.length - 1];
    const oj = await readJson(rel.get('output/' + d + '/object.json'), warnings);
    const imgs = indexed(files, IMAGE_EXT);
    const sameIdx = imgs.filter(x => !model.n || (x.n && x.n.index === model.n.index));
    const thumb = (sameIdx.find(x => baseOf(x.e.path).includes('thumbnail')) || sameIdx[0] || imgs[0] || {}).e || null;
    objects.push({
      id: model.n ? d + '-' + model.n.index : d, dir: d,
      name: (oj && ((oj.object && oj.object.name) || oj.name)) || displayName(d),
      model: model.e, thumb,
      sfx: indexed(inDir('output/' + d + '/sfx'), AUDIO_EXT).map(x => x.e),
    });
  }
  const ambient = indexed(inDir('output/sfx'), AUDIO_EXT).map(x => x.e);
  const name = meta.name || (typeof project.display_name === 'string' && project.display_name) || displayName(slug);
  const semantics = ver ? { ...ver.semantics } : { metricScale: 1, groundOffset: 0, flipY: true };
  // scene.json overrides, as upstream: metric scale, then the ground offset
  // (scaled with the metric scale when scene.json gives only the scale).
  if (scene && num(scene.metricScaleFactor)) {
    const k = scene.metricScaleFactor / (semantics.metricScale || 1);
    semantics.metricScale = scene.metricScaleFactor;
    semantics.groundOffset = num(scene.groundPlaneOffset) ? scene.groundPlaneOffset : semantics.groundOffset * k;
  } else if (scene && num(scene.groundPlaneOffset)) semantics.groundOffset = scene.groundPlaneOffset;
  return {
    slug, name, notes: typeof project.notes === 'string' ? project.notes : '', root, loose: false,
    credit: meta.credit || '', licence: meta.licence || '', note: meta.note || '',
    source, sourceVersions: src.map(x => x.e),
    version: ver ? ver.index : null, versions,
    splats: ver ? ver.splats : {}, collider: ver && ver.collider, pano: ver && ver.pano,
    thumbnail: ver && ver.thumbnail, plate: ver && ver.plate, caption: ver ? ver.caption : '',
    semantics, scene, objects, ambient,
    files: entries.length, warnings,
  };
}

function looseWorld(e) {
  const nm = baseOf(e.path).replace(/\.[^.]+$/, '');
  return {
    slug: nm.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'splat', name: displayName(nm), notes: '', root: dirOf(e.path), loose: true,
    credit: '', licence: '', note: '', source: null, sourceVersions: [], version: 0, versions: [],
    splats: { file: e }, collider: null, pano: null, thumbnail: null, plate: null, caption: '',
    // A bare splat file has no World Labs record. PLY captures are in
    // OpenCV axes (y down) as a rule, as World Labs SPZ files are.
    semantics: { metricScale: 1, groundOffset: 0, flipY: true }, scene: null, objects: [], ambient: [],
    files: 1, warnings: ['a single splat file: no world record, flip_y assumed true'],
  };
}

export async function loadWorlds(entries, meta = {}) {
  const norm = entries.map(e => (e.path = String(e.path).replace(/\\/g, '/').replace(/^\.?\//, ''), e))
    .filter(e => e.path && !baseOf(e.path).startsWith('.') && baseOf(e.path) !== 'Thumbs.db');
  const roots = findRoots(norm.map(e => e.path));
  const out = [], used = new Set();
  for (const r of roots) {
    const mine = norm.filter(e => r === '' || e.path.startsWith(r + '/'));
    mine.forEach(e => used.add(e));
    out.push(await buildWorld(r, mine, roots.length === 1 ? meta : {}));
  }
  for (const e of norm) if (!used.has(e) && SPLAT_EXT.has(extOf(e.path))) out.push(looseWorld(e));
  return out;
}

export function gridPosition(i, total) {
  const cols = Math.min(3, Math.max(1, total)), c = i % cols, r = Math.floor(i / cols);
  return [(c - (cols - 1) / 2) * 1, 0, -2 - r];
}

// Upstream placements.ts: with no scene.json the objects go on a grid at
// (0, 0, -2), 1 m apart, 3 to a row. A placement finds its object by
// objectId (dir-index), then assetId (slug/dir/index), then the folder.
export function matchPlacements(objects, scene) {
  if (!scene || !scene.instances || !scene.instances.length)
    return objects.map((o, i) => ({ obj: o, inst: { instanceId: o.id, objectId: o.id, physics: 'rigidbody', position: gridPosition(i, objects.length), rotation: [0, 0, 0], scale: [1, 1, 1] } }));
  const out = [];
  for (const inst of scene.instances) {
    const tail = s => String(s || '').split('/');
    const o = objects.find(x => x.id === inst.objectId)
      || objects.find(x => inst.assetId && tail(inst.assetId).slice(1).join('-') === x.id)
      || objects.find(x => x.dir === inst.objectId || x.dir === tail(inst.assetId)[1] || x.dir === String(inst.objectId).replace(/-\d+$/, ''));
    if (o) out.push({ obj: o, inst });
  }
  return out;
}

// The splat to load for a quality preset. 'low' takes the smallest file
// (phones), 'mid' 500k, 'high' full_res, each falling back in order.
export function pickSplat(world, quality = 'mid') {
  const s = world.splats || {};
  const order = quality === 'low' ? ['100k', '150k', '500k', 'full_res'] : quality === 'high' ? ['full_res', '500k', '150k', '100k'] : ['500k', 'full_res', '150k', '100k'];
  for (const k of order) if (s[k]) return { key: k, entry: s[k] };
  const k = Object.keys(s).sort((a, b) => SPZ_KEYS.indexOf(a) - SPZ_KEYS.indexOf(b))[0];
  return k ? { key: k, entry: s[k] } : null;
}
