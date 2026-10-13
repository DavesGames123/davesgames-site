#!/usr/bin/env node
// ============================================================================
//  RETRO FETCH  ·  tools/retro-fetch.mjs — pinned files of the Retro Shelf
// ----------------------------------------------------------------------------
//  The Retro Shelf page (stella-nova/pages/retro-shelf) runs freeware games
//  in open-source engines. The engines (js-dos emulators, EmulatorJS and its
//  cores) and the game archives are third-party files that are not in git.
//  This tool downloads each pinned file, checks its sha256 and writes it
//  under stella-nova/vendor/retro/fetched/. The pages workflow
//  (.github/workflows/pages.yml) runs it before the upload, the same way as
//  tools/craft-fetch.mjs. .gitignore keeps the output out of the index, and
//  tools/offline-manifest.mjs lists only tracked files, so the service
//  worker does not precache them.
//
//  Pin file: stella-nova/vendor/retro/retro.lock.json, "items":
//    kind "tgz"   an npm tarball. "pick" lists [from, to] pairs. A "from"
//                 that ends in "/" copies that folder. Output goes to
//                 <out>/<dir>/; <dir>/.retro-<stamp|id> holds the sha256.
//    kind "file"  a game archive, kept byte for byte at <out>/<path>.
//                 "urls" are mirrors, tried in order. The file itself is
//                 the stamp: it is current when its sha256 matches.
//  The licence review of every game is pages/retro-shelf/LICENSES.md.
//
//  Usage (from the repo root):
//    node tools/retro-fetch.mjs            fetch every pinned file
//    node tools/retro-fetch.mjs --check    change nothing, exit 1 if a file
//                                          is absent or stale
//    node tools/retro-fetch.mjs <id> ...   fetch only these items
//
//  The responses can be gzip-encoded. fetch() decodes them, and the tool
//  never sizes a buffer from content-length.
//
//  grep -n targets
//    download + mirrors .... "async function get"
//    npm tarball ........... "async function fetchTgz"
//    game archive .......... "async function fetchFile"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = path.join(ROOT, 'stella-nova', 'vendor', 'retro', 'retro.lock.json');
const UA = 'davesgames-retro-fetch (+https://davesgames.io)';

const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
const OUT = path.join(ROOT, lock.out);
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

async function get(urls) {
  let last = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA } });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { last = e; console.error(`  ${e.message}`); }
  }
  throw last || new Error('no URL');
}

const stampFile = (id, a) => path.join(OUT, a.dir, `.retro-${a.stamp || id}`);
function isCurrent(id, a) {
  try {
    if (a.kind === 'file') return sha256(fs.readFileSync(path.join(OUT, a.path))) === a.sha256;
    if (fs.readFileSync(stampFile(id, a), 'utf8').trim() !== a.sha256) return false;
    return a.pick.every(([from, to]) => from.endsWith('/') || fs.existsSync(path.join(OUT, a.dir, to)));
  } catch { return false; }
}

async function fetchFile(id, a) {
  const buf = await get(a.urls);
  const got = sha256(buf);
  if (got !== a.sha256) throw new Error(`${id}: sha256 ${got} is not the pinned ${a.sha256}`);
  if (a.bytes && buf.length !== a.bytes) throw new Error(`${id}: ${buf.length} bytes, the pin says ${a.bytes}`);
  const dst = path.join(OUT, a.path);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst + '.part', buf);
  fs.renameSync(dst + '.part', dst);
  console.log(`${id}: ${a.path} fetched (${(buf.length / 1e6).toFixed(1)} MB, sha256 ok)`);
}

async function fetchTgz(id, a) {
  const buf = await get([a.url]);
  const got = sha256(buf);
  if (got !== a.sha256) throw new Error(`${id}: sha256 ${got} is not the pinned ${a.sha256}`);
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(OUT, `.${id}-`));
  try {
    const tgz = path.join(tmp, 'pkg.tgz');
    fs.writeFileSync(tgz, buf);
    const x = path.join(tmp, 'x');
    fs.mkdirSync(x);
    const r = spawnSync('tar', ['xzf', tgz, '-C', x], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${id}: tar exit ${r.status} ${r.stderr}`);
    const dir = path.join(OUT, a.dir);
    for (const [from, to] of a.pick) {
      const src = path.join(x, from);
      if (!fs.existsSync(src)) throw new Error(`${id}: ${from} is not in the tarball`);
      const dst = path.join(dir, to);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.rmSync(dst, { recursive: true, force: true });
      fs.cpSync(src, dst, { recursive: true });
    }
    fs.writeFileSync(stampFile(id, a), a.sha256 + '\n');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`${id}: ${a.dir} fetched (${(buf.length / 1e6).toFixed(1)} MB tarball, sha256 ok)`);
}

const args = process.argv.slice(2);
const items = Object.entries(lock.items);
try {
  if (args[0] === '--check') {
    const bad = items.filter(([id, a]) => !isCurrent(id, a));
    bad.forEach(([id]) => console.log(`${id}: absent or stale`));
    console.log(`retro: ${items.length - bad.length}/${items.length} pinned files current`);
    process.exit(bad.length ? 1 : 0);
  }
  const want = args.length ? items.filter(([id]) => args.includes(id)) : items;
  if (args.length && want.length !== args.length) throw new Error(`unknown item in: ${args.join(' ')}`);
  for (const [id, a] of want) {
    if (isCurrent(id, a)) { console.log(`${id}: current`); continue; }
    if (a.kind === 'file') await fetchFile(id, a);
    else if (a.kind === 'tgz') await fetchTgz(id, a);
    else throw new Error(`${id}: unknown kind ${a.kind}`);
  }
} catch (e) {
  console.error(`retro-fetch: ${e.message}`);
  process.exit(1);
}
