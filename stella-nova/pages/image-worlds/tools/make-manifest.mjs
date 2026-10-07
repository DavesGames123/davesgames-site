// ============================================================================
//  IMAGE WORLDS  ·  tools/make-manifest.mjs — list the hosted world files
// ────────────────────────────────────────────────────────────────────────────
//  A static host cannot list a folder, so worlds/manifest.json lists every
//  file of each hosted world. To add a world:
//    1. Copy the image-blaster folder worlds/<slug>/ to
//       stella-nova/pages/image-worlds/worlds/<slug>/ (hidden request JSON
//       and .DS_Store are skipped here; you can delete them).
//    2. node stella-nova/pages/image-worlds/tools/make-manifest.mjs
//    3. Add name, credit, licence and note to the new entry by hand if you
//       want them. A rerun keeps them, and keeps the order of the worlds.
//  Fields per world: slug, name, credit, licence, note, saver (see
//  worlds.js parseManifest), files (paths under worlds/<slug>/), sizes.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'worlds');
const FILE = path.join(DIR, 'manifest.json');
const old = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { version: 1, worlds: [] };
const walk = (d, pre = '') => fs.readdirSync(d, { withFileTypes: true }).filter(e => !e.name.startsWith('.')).flatMap(e =>
  e.isDirectory() ? walk(path.join(d, e.name), pre + e.name + '/') : e.isFile() ? [pre + e.name] : []).sort();
const slugs = fs.readdirSync(DIR, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);
const order = [...old.worlds.map(w => w.slug).filter(s => slugs.includes(s)), ...slugs.filter(s => !old.worlds.some(w => w.slug === s)).sort()];
const worlds = order.map(slug => {
  const prev = old.worlds.find(w => w.slug === slug) || {};
  const files = walk(path.join(DIR, slug));
  const sizes = Object.fromEntries(files.map(f => [f, fs.statSync(path.join(DIR, slug, f)).size]));
  const keep = Object.fromEntries(['name', 'credit', 'licence', 'note', 'saver', 'start', 'background'].filter(k => prev[k] !== undefined).map(k => [k, prev[k]]));
  return { slug, ...keep, files, sizes };
});
fs.writeFileSync(FILE, JSON.stringify({ version: 1, note: old.note || 'Hosted worlds for the Image Worlds page. Written by tools/make-manifest.mjs; edit name, credit, licence, note, saver, start and background by hand.', worlds }, null, 2) + '\n');
console.log('manifest:', worlds.map(w => w.slug + ' (' + w.files.length + ' files)').join(', ') || 'no worlds');
