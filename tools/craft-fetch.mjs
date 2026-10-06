#!/usr/bin/env node
// ============================================================================
//  CRAFT FETCH  ·  tools/craft-fetch.mjs — the upstream Crafting Apps builds
// ----------------------------------------------------------------------------
//  The Craft Suite pages host the official web builds of the Crafting Apps
//  (github.com/storytold: PhotoCraft, VectorCraft and so on). The site does
//  not build or change them. Each app's release has a web zip. This tool
//  downloads the pinned zip, checks its sha256, and unpacks it unchanged.
//
//  The builds are not in git. One build is 25-35 MB of wasm, and upstream
//  makes releases each day, so git would grow by the full size of each
//  bump. The pages workflow (.github/workflows/pages.yml) runs this tool
//  before the upload, so the deploy has the builds. .gitignore keeps them
//  out of the index, and tools/offline-manifest.mjs lists only tracked files,
//  so the service worker does not precache them.
//
//  Pin file: stella-nova/vendor/craft/craft.lock.json, "apps" -> one record
//  per app: repo, tag, asset, sha256, dir (the zip's top folder), and the
//  name, licence and links that lib/craft-host.js shows on the page.
//
//  Output: stella-nova/vendor/craft/<dir>/ with the files of the zip, less
//  build leftovers (SKIP). <dir>/.craft-sha256 holds the zip hash, so a
//  second run with the same pin downloads nothing.
//
//  Usage (from the repo root):
//    node tools/craft-fetch.mjs              fetch every pinned build
//    node tools/craft-fetch.mjs --check      change nothing, exit 1 if a
//                                            pinned build is absent or stale
//    node tools/craft-fetch.mjs --latest     show the newest upstream tag of
//                                            each app (GitHub API, read only)
//    node tools/craft-fetch.mjs --bump <app> pin the newest release: read
//                                            its SHA256SUMS.txt, write the
//                                            lock, then fetch and verify
//
//  grep -n targets
//    skipped zip entries .. "const SKIP"
//    download + verify .... "async function fetchApp"
//    pin bump ............. "async function bump"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'stella-nova', 'vendor', 'craft');
const LOCK = path.join(DIR, 'craft.lock.json');
const STAMP = '.craft-sha256';

// Zip entries that are not part of the web app. The lightcraft 0.2.1 zip
// carries its cargo target folder (deps/, build/, .fingerprint/,
// incremental/, examples/, .cargo-*lock files, about 110 MB) and
// precompressed .gz/.br copies that GitHub Pages cannot serve as
// Content-Encoding.
const SKIP = ['*/deps/*', '*/build/*', '*/.fingerprint/*', '*/incremental/*', '*/examples/*',
  '*/.cargo-lock', '*/.cargo-artifact-lock', '*/.cargo-build-lock',
  '*.rlib', '*.so', '*.dylib', '*.d', '*.gz', '*.br'];

const readLock = () => JSON.parse(fs.readFileSync(LOCK, 'utf8'));
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const releaseUrl = (a, file) => `https://github.com/${a.repo}/releases/download/${a.tag}/${file}`;

async function get(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'davesgames-craft-fetch' } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

function isCurrent(a) {
  try { return fs.readFileSync(path.join(DIR, a.dir, STAMP), 'utf8').trim() === a.sha256; }
  catch { return false; }
}

async function fetchApp(id, a) {
  if (isCurrent(a)) { console.log(`${id}: ${a.dir} current`); return; }
  const zip = await get(releaseUrl(a, a.asset));
  const got = sha256(zip);
  if (got !== a.sha256) throw new Error(`${id}: sha256 ${got} is not the pinned ${a.sha256}`);
  const tmp = fs.mkdtempSync(path.join(DIR, `.${id}-`));
  try {
    const zf = path.join(tmp, a.asset);
    fs.writeFileSync(zf, zip);
    // unzip prints a caution for each SKIP pattern with no match. Drop those.
    const r = spawnSync('unzip', ['-q', zf, '-d', tmp, '-x', ...SKIP], { encoding: 'utf8' });
    const err = (r.stderr || '').split('\n').filter(l => l && !/excluded filename not matched/.test(l));
    if (err.length) console.error(err.join('\n'));
    if (r.status !== 0 && r.status !== 11) throw new Error(`${id}: unzip exit ${r.status}`);
    const top = path.join(tmp, a.dir);
    if (!fs.existsSync(path.join(top, 'index.html'))) throw new Error(`${id}: ${a.dir}/index.html is not in ${a.asset}`);
    fs.writeFileSync(path.join(top, STAMP), a.sha256 + '\n');
    const out = path.join(DIR, a.dir);
    fs.rmSync(out, { recursive: true, force: true });
    fs.renameSync(top, out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`${id}: ${a.dir} fetched (${(zip.length / 1e6).toFixed(1)} MB zip, sha256 ok)`);
}

async function latestTag(repo) {
  const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { 'user-agent': 'davesgames-craft-fetch', accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`${r.status}: ${repo} latest release`);
  const j = await r.json();
  return { tag: j.tag_name, assets: j.assets.map(x => x.name) };
}

async function bump(id) {
  const lock = readLock();
  const a = lock.apps[id];
  if (!a) throw new Error(`no app "${id}" in ${path.relative(ROOT, LOCK)}`);
  const { tag, assets } = await latestTag(a.repo);
  const asset = assets.find(n => /-web-.*\.zip$/.test(n));
  if (!asset) throw new Error(`${id} ${tag}: the release has no web zip`);
  const sums = (await get(releaseUrl({ ...a, tag }, 'SHA256SUMS.txt'))).toString('utf8');
  const line = sums.split('\n').find(l => l.trim().endsWith(' ' + asset));
  if (!line) throw new Error(`${id} ${tag}: SHA256SUMS.txt has no line for ${asset}`);
  Object.assign(a, { tag, asset, sha256: line.trim().split(/\s+/)[0], dir: asset.replace(/\.zip$/, '') });
  fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
  console.log(`${id}: pinned ${tag} ${asset}`);
  await fetchApp(id, a);
}

const args = process.argv.slice(2);
const apps = Object.entries(readLock().apps);
try {
  if (args[0] === '--check') {
    const bad = apps.filter(([, a]) => !isCurrent(a));
    bad.forEach(([id, a]) => console.log(`${id}: ${a.dir} absent or stale`));
    console.log(`craft: ${apps.length - bad.length}/${apps.length} pinned builds current`);
    process.exit(bad.length ? 1 : 0);
  } else if (args[0] === '--latest') {
    for (const [id, a] of apps) {
      const { tag } = await latestTag(a.repo);
      console.log(`${id}: pinned ${a.tag}, latest ${tag}${tag === a.tag ? '' : '  <- bump available'}`);
    }
  } else if (args[0] === '--bump') {
    if (!args[1]) throw new Error('usage: --bump <app>');
    await bump(args[1]);
  } else {
    for (const [id, a] of apps) await fetchApp(id, a);
  }
} catch (e) {
  console.error(`craft-fetch: ${e.message}`);
  process.exit(1);
}
