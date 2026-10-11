#!/usr/bin/env node
// Write py/manifest.json: the Python files that engine-core.js copies into
// the Pyodide file system (the shims and the manimlive runtime package).
// Run after you add, rename or delete a file under py/:
//   node tools/py-manifest.mjs
// tests/engine.test.mjs fails when the manifest and the folder differ.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PY = path.join(PAGE, 'py');

export function listPyFiles() {
  const out = [];
  for (const dir of fs.readdirSync(PY).sort()) {
    const abs = path.join(PY, dir);
    if (!fs.statSync(abs).isDirectory() || dir === 'wheels' || dir.startsWith('__')) continue;
    const walk = (d, rel) => {
      for (const f of fs.readdirSync(d).sort()) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) { if (f !== '__pycache__') walk(p, rel + f + '/'); }
        else if (f.endsWith('.py')) out.push(rel + f);
      }
    };
    walk(abs, dir + '/');
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const files = listPyFiles();
  fs.writeFileSync(path.join(PY, 'manifest.json'), JSON.stringify({ files }, null, 1) + '\n');
  console.log(`py/manifest.json: ${files.length} files`);
}
