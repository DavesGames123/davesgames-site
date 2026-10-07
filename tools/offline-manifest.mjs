#!/usr/bin/env node
// ============================================================================
//  OFFLINE MANIFEST  ·  writes sw-manifest.js and the sw.js version stamp
// ----------------------------------------------------------------------------
//  The service worker (/sw.js) keeps the site in Cache Storage, so a page
//  works with no network after one online visit. The worker needs the list
//  of files and a hash of each file. This tool writes that list:
//
//    sw-manifest.js   self.SN_OFFLINE = { version, core, lazy }
//                     core  [path, hash] pairs. The worker downloads them
//                           at install, before it takes control.
//                     lazy  [path, hash] pairs. The worker downloads them
//                           in the background after the shell loads, and
//                           also keeps each one when a page first asks.
//    sw.js            the line  const VERSION = '<version>';
//                     A new version changes the bytes of sw.js, so each
//                     browser installs the new worker.
//
//  Paths are relative to the site root, with no leading slash. The hash is
//  the first 16 hex digits of the git blob id of the file in the index
//  (git ls-files -s). The version is the first 16 hex digits of the SHA-256
//  of all "path hash" lines. So the version changes only when a listed file
//  changes, is added or is removed.
//
//  The tool reads the git index, not the work tree. An edit that is not
//  staged does not change the manifest. Stage the files of a commit, run
//  the tool, then stage sw.js and sw-manifest.js too. In the deploy
//  workflow the index is the commit, so the list matches the served files.
//
//  The file set is the index (tracked files only), less the EXCLUDE
//  patterns. Core takes code and fonts at any size, and any other file up
//  to CORE_MAX_BYTES, except in LAZY_DIRS. Everything else is lazy (meshes,
//  photos, big data).
//  Untracked files (for example the leo-catalog TLE snapshot that the
//  deploy workflow writes) are not listed. The worker treats the snapshot
//  as live data.
//
//  Usage (from the repo root):
//    node tools/offline-manifest.mjs          write both files, print totals
//    node tools/offline-manifest.mjs --check  change nothing, exit 1 if
//                                             either file is out of date
//  The pages workflow (.github/workflows/pages.yml) also runs it before
//  the upload, so the deploy always has a current manifest.
//
//  grep -n targets
//    excluded paths ....... "const EXCLUDE"
//    core rule ............ "function isCore"
//    version stamp ........ "function stamp"
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

// Never cached by the worker: repo tooling, docs, tests, build scripts,
// and the worker files (the browser fetches those itself).
const EXCLUDE = [
  /^tools\//, /^\.github\//, /^material-lab-server\//, /^CNAME$/,
  /(^|\/)\.[^/]+$/,                       // .DS_Store, .gitignore, ...
  /\.(md|py|sh|yml|yaml|txt)$/i,          // docs, scripts, licence texts
  /(^|\/)tools\//,                        // page tools (node scripts)
  /(^|\/)build[^/]*\.mjs$/, /(^|\/)tests?[^/]*\.mjs$/, /\.test\.mjs$/,
  /(^|\/)LICENSE[^/]*$/,
  /^sw\.js$/, /^sw-manifest\.js$/,
];
// Code and fonts: a page cannot start without them. Core takes them at any
// size, and any other file up to CORE_MAX_BYTES (icons, thumbnails, small
// data). LAZY_DIRS hold data written as code, or code that loads only on a
// user action: they wait for the background pass or the first request.
const CODE = /\.(html|js|mjs|css|wgsl|glsl|woff2|svg|webmanifest|ico|wasm)$/i;
const CORE_MAX_BYTES = 48 * 1024;
const LAZY_DIRS = [
  /^stella-nova\/pages\/img2threejs\/models\//,   // 4 MB of model passes
  /^stella-nova\/pages\/translate\/strings\//,    // 2.7 MB of UI strings
  /^stella-nova\/vendor\/mathjax@[^/]+\/es5\/(a11y|ui)\//, // menu options only
  /^stella-nova\/vendor\/spark@[^/]+\//,           // 2.7 MB splat renderer, image-worlds only
  /^stella-nova\/vendor\/onnxruntime-web@[^/]+\//, // ML runtime + wasm, market-forecast only
];

function isCore(p, size) {
  if (LAZY_DIRS.some((re) => re.test(p))) return false;
  return CODE.test(p) || size <= CORE_MAX_BYTES;
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
const git = (args, input) => execFileSync('git', args, { cwd: ROOT, input, maxBuffer: 64 << 20 }).toString();

// Index entries: "<mode> <blob> <stage>\t<path>". Skip submodules (160000).
const entries = git(['ls-files', '-s', '-z']).split('\0').filter(Boolean)
  .map((l) => { const [meta, p] = l.split('\t'); const [mode, blob] = meta.split(' '); return { mode, blob, p }; })
  .filter((e) => e.mode !== '160000' && !EXCLUDE.some((re) => re.test(e.p)))
  .sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
// Blob sizes in one git call.
const sizes = git(['cat-file', '--batch-check=%(objectsize)'], entries.map((e) => e.blob).join('\n') + '\n')
  .trim().split('\n').map(Number);

const core = [], lazy = [];
let coreBytes = 0, lazyBytes = 0;
entries.forEach((e, i) => {
  const item = [e.p, e.blob.slice(0, 16)];
  if (isCore(e.p, sizes[i])) { core.push(item); coreBytes += sizes[i]; }
  else { lazy.push(item); lazyBytes += sizes[i]; }
});
const version = sha([...core, ...lazy].map((e) => e.join(' ')).join('\n'));

const manifest =
  '// Generated by tools/offline-manifest.mjs. Do not edit by hand.\n' +
  '// Read by sw.js (importScripts). See the tool header for the format.\n' +
  `self.SN_OFFLINE = {\n  version: '${version}',\n` +
  `  core: [\n${core.map((e) => '    ' + JSON.stringify(e)).join(',\n')}\n  ],\n` +
  `  lazy: [\n${lazy.map((e) => '    ' + JSON.stringify(e)).join(',\n')}\n  ],\n};\n`;

// Write the version into the one VERSION line of sw.js.
function stamp(src) {
  const re = /^const VERSION = '[^']*';$/m;
  if (!re.test(src)) throw new Error('sw.js has no VERSION line');
  return src.replace(re, `const VERSION = '${version}';`);
}

const manPath = path.join(ROOT, 'sw-manifest.js');
const swPath = path.join(ROOT, 'sw.js');
const oldMan = fs.existsSync(manPath) ? fs.readFileSync(manPath, 'utf8') : '';
const oldSw = fs.readFileSync(swPath, 'utf8');
const newSw = stamp(oldSw);
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
console.log(`version ${version}: core ${core.length} files ${mb(coreBytes)}, lazy ${lazy.length} files ${mb(lazyBytes)}`);
if (CHECK) {
  const stale = [oldMan !== manifest && 'sw-manifest.js', oldSw !== newSw && 'sw.js'].filter(Boolean);
  if (stale.length) { console.error('out of date: ' + stale.join(', ') + ' (run node tools/offline-manifest.mjs)'); process.exit(1); }
  console.log('up to date');
} else {
  if (oldMan !== manifest) fs.writeFileSync(manPath, manifest);
  if (oldSw !== newSw) fs.writeFileSync(swPath, newSw);
}
