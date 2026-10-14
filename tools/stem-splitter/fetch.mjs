#!/usr/bin/env node
// ============================================================================
//  STEM WEIGHTS FETCH  ·  tools/stem-splitter/fetch.mjs — the Demucs .th files
// ----------------------------------------------------------------------------
//  The Stem Splitter page runs Demucs v4 in the browser. Its ONNX graphs
//  (models/*.onnx, in git) hold no weights: each weight points to a byte
//  range of the official Demucs checkpoint (.th). This tool downloads the
//  pinned checkpoints unchanged from dl.fbaipublicfiles.com, checks each
//  sha256, and puts them in stella-nova/pages/stem-splitter/models/.
//
//  The .th files are not in git (84 MB + 55 MB). .gitignore keeps them out
//  of the index. The pages workflow runs this tool before the upload, with
//  an actions/cache step, so the deploy has them. The Meta server sends no
//  CORS header, so the page cannot read the files from Meta itself.
//
//  Pin file: tools/stem-splitter/fetch.lock.json, "files" -> one record per
//  model id: file, url, bytes, sha256. "dir" is the output folder.
//
//  Usage (from the repo root):
//    node tools/stem-splitter/fetch.mjs                fetch every pinned file
//    node tools/stem-splitter/fetch.mjs --check        change nothing; exit 1 if
//                                                      a file is absent or wrong
//    node tools/stem-splitter/fetch.mjs --out <dir>    use <dir>, not "dir"
//    node tools/stem-splitter/fetch.mjs --only <id>    one model id only
//
//  A file that is present with the right sha256 is not downloaded again.
//  A download goes to "<file>.part" and is renamed only after the hash
//  check. The tool joins the chunks at their real size: content-length is
//  for progress only (a server can send a compressed length).
//
//  grep -n targets
//    hash of a file on disk .. "async function hashFile"
//    download + verify ....... "async function fetchOne"
//    argument parse .......... "const args"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const LOCK = JSON.parse(fs.readFileSync(path.join(HERE, 'fetch.lock.json'), 'utf8'));
const UA = 'davesgames.io build';

async function hashFile(p) {
  const h = crypto.createHash('sha256');
  let size = 0;
  for await (const chunk of fs.createReadStream(p)) { h.update(chunk); size += chunk.length; }
  return { sha256: h.digest('hex'), size };
}

async function isCurrent(dir, f) {
  const p = path.join(dir, f.file);
  if (!fs.existsSync(p)) return false;
  const { sha256, size } = await hashFile(p);
  return sha256 === f.sha256 && size === f.bytes;
}

async function fetchOne(dir, id, f) {
  if (await isCurrent(dir, f)) { console.log(`${id}: ${f.file} current`); return; }
  fs.mkdirSync(dir, { recursive: true });
  const part = path.join(dir, f.file + '.part');
  const t0 = Date.now();
  const r = await fetch(f.url, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error(`${id}: ${r.status} ${r.statusText}: ${f.url}`);
  const h = crypto.createHash('sha256');
  const out = fs.createWriteStream(part);
  let got = 0, shown = 0;
  try {
    for await (const chunk of r.body) {
      h.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) await new Promise(res => out.once('drain', res));
      if (process.stdout.isTTY && got - shown > 8e6) {
        shown = got;
        process.stdout.write(`\r${id}: ${(got / 1e6).toFixed(0)} / ${(f.bytes / 1e6).toFixed(0)} MB`);
      }
    }
    await new Promise((res, rej) => out.end(err => (err ? rej(err) : res())));
  } catch (e) {
    out.destroy();
    fs.rmSync(part, { force: true });
    throw e;
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
  const sha = h.digest('hex');
  if (sha !== f.sha256 || got !== f.bytes) {
    fs.rmSync(part, { force: true });
    throw new Error(`${id}: got ${got} B sha256 ${sha}, pinned ${f.bytes} B ${f.sha256}`);
  }
  fs.renameSync(part, path.join(dir, f.file));
  console.log(`${id}: ${f.file} fetched (${(got / 1e6).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(1)} s, sha256 ok)`);
}

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const dir = path.resolve(ROOT, opt('--out') || LOCK.dir);
const only = opt('--only');
const files = Object.entries(LOCK.files).filter(([id]) => !only || id === only);
try {
  if (!files.length) throw new Error(`no model id "${only}" in fetch.lock.json`);
  if (args.includes('--check')) {
    let ok = 0;
    for (const [id, f] of files) {
      if (await isCurrent(dir, f)) { ok++; console.log(`${id}: ${f.file} sha256 ok`); }
      else console.log(`${id}: ${f.file} absent or wrong`);
    }
    console.log(`stem-splitter: ${ok}/${files.length} pinned weight files current`);
    process.exit(ok === files.length ? 0 : 1);
  }
  for (const [id, f] of files) await fetchOne(dir, id, f);
} catch (e) {
  console.error(`stem-splitter fetch: ${e.message}`);
  process.exit(1);
}
