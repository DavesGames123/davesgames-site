// build-library.mjs -- copy and convert the preset files, bake the library
// thumbnails, and write CREDITS.txt, all from library.js and patterns.js.
//
// Run from the page folder:
//   node tools/build-library.mjs [--upstream DIR] [--bench]
// --upstream DIR  DIR holds shallow clones of origamicp, flat-folder and
//                 OrigamiSimulator at the commits in library.js SOURCES. Each
//                 file entry is copied (.fold, unchanged) or converted
//                 (.svg, .opx, with svg2fold.mjs) into patterns/.
// --bench         time 50 sim steps per preset and print the node counts.
//
// Output:
//   patterns/*.fold  -- the pattern files (with --upstream only)
//   thumbs.json      -- per preset id, SVG path data per crease kind on a
//                       0..100 box: { m, v, b, f }. The library draws its
//                       tiles from this, so it never has to fetch every file.
//   CREDITS.txt      -- every pattern file with source, commit, path, author
//                       and licence, the excluded list, and each MIT text once.
//
// grep map:
//   importFiles  -- copy or convert the upstream files
//   thumbOf      -- one crease pattern to chained, rounded path data
//   credits      -- the CREDITS.txt text

import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as patterns from '../patterns.js';
import { SOURCES, EXCLUDED } from '../library.js';
import { convert } from './svg2fold.mjs';
import { planarize } from '../planarize.js';
import * as sim from '../sim.js';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const upIdx = args.indexOf('--upstream');
const upstream = upIdx >= 0 ? args[upIdx + 1] : null;
const bench = args.includes('--bench');
const REPO_DIR = { origamicp: 'origamicp', flatfolder: 'flat-folder', origamisim: 'OrigamiSimulator' };

// ── copy or convert the upstream files ──────────────────────────────────────
async function importFiles() {
  for (const p of patterns.ALL) {
    if (!p.file || !p.path) continue;
    const src = join(upstream, REPO_DIR[p.src], p.path);
    const dst = join(here, 'patterns', p.file);
    if (p.path.endsWith('.fold')) { await copyFile(src, dst); continue; }
    const s = SOURCES[p.src];
    const r = convert(await readFile(src, 'utf8'), p.path.endsWith('.opx') ? 'opx' : 'svg', {
      title: p.label, author: p.author, source: `${s.repo}/blob/${s.commit}/${p.path}`,
    });
    await writeFile(dst, JSON.stringify(r.fold) + '\n');
    console.log(`converted ${p.path} -> patterns/${p.file}: ${r.fold.edges_vertices.length} edges${r.warnings.length ? ' (' + r.warnings.join('; ') + ')' : ''}`);
  }
}

// ── thumbnails ──────────────────────────────────────────────────────────────
// Round every vertex to the 0..100 box (y up), drop zero-length and repeated
// segments, then chain each kind into polylines, so a shared point is written
// once. A straight run through a vertex is preferred, so a long crease stays
// one stroke.
const KINDS = { M: 'm', V: 'v', B: 'b', F: 'f', U: 'f' };
export function thumbOf(cp) {
  const [lo, hi] = cp.bounds();
  const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1]) || 1;
  const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2;
  const P = (v) => [Math.round((50 + (v[0] - cx) / ext * 96) * 2) / 2, Math.round((50 - (v[1] - cy) / ext * 96) * 2) / 2];
  const out = {};
  for (const [letter, key] of Object.entries(KINDS)) {
    const segs = new Map();
    cp.edges.forEach((e, i) => {
      if (cp.assignment[i] !== letter) return;
      const a = P(cp.vertices[e[0]]), b = P(cp.vertices[e[1]]);
      if (a[0] === b[0] && a[1] === b[1]) return;
      const ka = a.join(','), kb = b.join(',');
      segs.set(ka < kb ? ka + ' ' + kb : kb + ' ' + ka, [a, b]);
    });
    if (!segs.size) continue;
    const adj = new Map();
    const list = [...segs.values()];
    list.forEach((s, i) => {
      for (const p of s) { const k = p.join(','); if (!adj.has(k)) adj.set(k, []); adj.get(k).push(i); }
    });
    const used = new Uint8Array(list.length);
    const parts = [];
    const fmt = (p) => `${p[0]} ${p[1]}`;
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const chain = [list[i][0], list[i][1]];
      // Walk forward from the chain end while an unused segment continues it.
      for (;;) {
        const end = chain[chain.length - 1], prev = chain[chain.length - 2];
        const cand = adj.get(end.join(',')).filter((j) => !used[j]);
        if (!cand.length) break;
        const dir = [end[0] - prev[0], end[1] - prev[1]];
        const score = (j) => {
          const q = list[j][0].join(',') === end.join(',') ? list[j][1] : list[j][0];
          const d = [q[0] - end[0], q[1] - end[1]];
          return (dir[0] * d[0] + dir[1] * d[1]) / (Math.hypot(...dir) * Math.hypot(...d) || 1);
        };
        cand.sort((x, y) => score(y) - score(x));
        const j = cand[0];
        used[j] = 1;
        chain.push(list[j][0].join(',') === end.join(',') ? list[j][1] : list[j][0]);
      }
      parts.push('M' + chain.map(fmt).join(' '));
    }
    out[key] = parts.join('');
  }
  return out;
}

// ── CREDITS.txt ─────────────────────────────────────────────────────────────
const MIT_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

function credits() {
  const rule = '-'.repeat(77);
  const L = [];
  L.push('Origami Simulator (web port) -- credits and licenses');
  L.push('=====================================================');
  L.push('');
  L.push('This page is a web port of the origami desktop app (Rust, wgpu, winit). It');
  L.push('carries third-party work under the MIT license. The license text of each source');
  L.push('follows once at the end, as each repository requires. tools/build-library.mjs');
  L.push('writes this file from library.js and patterns.js.');
  L.push('');
  L.push('1. Folding simulation');
  L.push('   Ported from Origami Simulator by Amanda Ghassaei.');
  L.push('   https://github.com/amandaghassaei/OrigamiSimulator');
  L.push('   Paper: A. Ghassaei, E. D. Demaine, N. Gershenfeld, "Fast, Interactive');
  L.push('   Origami Simulation using GPU Computation", Origami 7 (7OSME), 2018.');
  L.push('   Used in: sim.js, solver.js (the bar-and-hinge model, its constants, and the');
  L.push('   per-step passes, by way of the Rust port in src/sim/).');
  L.push('');
  L.push('2. Pattern sources');
  for (const k of ['origamicp', 'flatfolder', 'origamisim']) {
    const s = SOURCES[k];
    L.push(`   ${s.name} by ${s.by}, ${s.licence}. ${s.repo}`);
    L.push(`     commit ${s.commit}`);
  }
  L.push('   generated: original code in generators.js and patterns.js (this page).');
  L.push('   A .fold upstream file is an unchanged copy. An .svg or .opx upstream file');
  L.push('   was converted to a planar FOLD file by tools/svg2fold.mjs. On load, every');
  L.push('   pattern is fit into the centred unit square (patterns.js fromFoldText).');
  L.push('');
  L.push('3. Every preset');
  L.push('   id | label | source | upstream path (or generator) | designer as stated | licence');
  for (const g of patterns.GROUPS) {
    L.push('');
    L.push(`   ${g.name}`);
    for (const p of g.list) {
      const s = SOURCES[p.src];
      const where = p.gen ? `generators.js ${p.gen[0]}(${p.gen[1].join(', ')})`
        : p.path ? `${p.path} -> patterns/${p.file}` : 'patterns.js (native rule)';
      L.push(`   ${p.id} | ${p.label} | ${s.name} | ${where} | ${p.author || 'no designer stated'} | ${s.licence}`);
      if (p.note) L.push(`       note: ${p.note}`);
    }
  }
  L.push('');
  L.push('4. Excluded upstream patterns');
  L.push('   A pattern credited to a named designer ships only when its source states');
  L.push('   a license or the designer\'s permission for it. Jason Ku\'s own designs');
  L.push('   ship under the MIT license of his flat-folder repository.');
  for (const [src, what, who, why] of EXCLUDED) L.push(`   - ${SOURCES[src].name}: ${what} [${who}]: ${why}`);
  for (const k of ['origamisim', 'origamicp', 'flatfolder']) {
    L.push('');
    L.push(rule);
    L.push(`MIT License (${SOURCES[k].name})`);
    L.push('');
    L.push(SOURCES[k].copyright);
    L.push('');
    L.push(MIT_BODY);
  }
  return L.join('\n') + '\n';
}

// ── main ────────────────────────────────────────────────────────────────────
if (upstream) await importFiles();
await patterns.preloadFolds((n) => readFile(join(here, 'patterns', n), 'utf8'));
const thumbs = {};
const rows = [];
for (const p of patterns.ALL) {
  const cp = patterns.build(p);
  thumbs[p.id] = thumbOf(cp);
  if (bench) {
    const planar = planarize(cp);
    const m = sim.build(planar);
    m.setFraction(0.5);
    const t = performance.now();
    for (let i = 0; i < 50; i++) m.step();
    rows.push([p.id, m.nodeCount, planar.edges.length, (performance.now() - t) / 50]);
  }
}
await writeFile(join(here, 'thumbs.json'), JSON.stringify(thumbs));
await writeFile(join(here, 'CREDITS.txt'), credits());
const size = Buffer.byteLength(JSON.stringify(thumbs));
console.log(`thumbs.json: ${Object.keys(thumbs).length} presets, ${size} bytes`);
console.log(`CREDITS.txt: written`);
if (bench) {
  rows.sort((a, b) => b[1] - a[1]);
  console.log('largest presets (nodes, planar edges, ms per step in node):');
  for (const r of rows.slice(0, 8)) console.log(`  ${r[0].padEnd(20)} ${String(r[1]).padStart(5)} ${String(r[2]).padStart(5)} ${r[3].toFixed(2)}`);
}
