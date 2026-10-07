// ============================================================================
//  CONTEXT FREE  ·  tests.mjs — node tests of the engine build and its API
// ----------------------------------------------------------------------------
//  Our own code (GPL-2.0-or-later, see COPYING).
//  Run: node stella-nova/pages/context-free/tests.mjs
//  Exit code 0 when every test passes. --print prints the golden values.
//
//  1  cf.wasm loads in node, and the build is the one in engine/BUILD
//  2  upstream examples render to stable shape counts and pixel hashes
//  3  every gallery design parses and renders with no error
//  4  a syntax error reports the right line
//  5  a progress hook stops a render (cancel) or finishes it early
//  6  tiled designs repeat; time designs animate; one frame renders alone
//  7  SVG output, no antialiasing, the background define
//  8  the JavaScript variation codes match Variation:: in the engine
//  9  the growth replay (patch 0004): the final frame of every mode is
//     the normal render, frames grow, and an added frame is a redraw
// ============================================================================
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './engine.js';
import { varToString, varFromString } from './variation.js';
import { DESIGNS } from './designs.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PRINT = process.argv.includes('--print');
const read = f => fs.readFileSync(HERE + 'designs/' + f, 'utf8');
let pass = 0, fail = 0;
function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log('  ok   ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
}
const fnv = px => { let h = 0x811c9dc5; for (let i = 0; i < px.length; i++) { h ^= px[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };

console.log('1. load');
const t0 = performance.now();
const E = await loadEngine();
ok(!!E, 'cf.wasm instantiates', (performance.now() - t0).toFixed(0) + ' ms');
const wasmSha = crypto.createHash('sha256').update(fs.readFileSync(HERE + 'cf.wasm')).digest('hex');
const build = fs.readFileSync(HERE + 'engine/BUILD', 'utf8');
ok(build.includes(wasmSha), 'cf.wasm sha256 is the one in engine/BUILD', wasmSha.slice(0, 16));

console.log('2. golden renders (200 x 200, variation ABC)');
const GOLD = {
  'welcome.cfdg': [4728, '2e7af5ab'],
  'sierpinski.cfdg': [9841, '0e8b2c5a'],
  'snowflake.cfdg': [26568, 'c7700ff1'],
  'thingy.cfdg': [21845, '46ff135b'],
  'demo1.cfdg': [14544, '9f0baec6'],
};
const ABC = varFromString('ABC');
for (const [f, [count, hash]] of Object.entries(GOLD)) {
  const p = E.parse(read(f), ABC);
  const r = E.render({ width: 200, height: 200, maxShapes: 500000, tickMs: 0 });
  const h = fnv(r.pixels);
  if (PRINT) console.log(`  '${f}': [${r.shapes}, '${h}'],`);
  ok(p.ok && r.ok && r.shapes === count && h === hash, f, `${r.shapes} shapes, fnv ${h}`);
}
// The same render twice gives the same pixels (no hidden state).
{
  E.parse(read('demo1.cfdg'), ABC);
  const a = fnv(E.render({ width: 160, height: 160 }).pixels);
  E.parse(read('demo1.cfdg'), ABC);
  const b = fnv(E.render({ width: 160, height: 160 }).pixels);
  ok(a === b, 'a second render is identical', a);
  E.parse(read('demo1.cfdg'), ABC + 1);
  const c = fnv(E.render({ width: 160, height: 160 }).pixels);
  ok(c !== a, 'another variation gives other pixels', c);
}

console.log('3. every gallery design');
for (const d of DESIGNS) {
  const p = E.parse(read(d.file), 7);
  const r = p.ok ? E.render({ width: 120, height: 120, maxShapes: 30000, tile: d.tiled ? 2 : 0, frames: d.anim ? 4 : 0, frame: d.anim ? 2 : 0, tickMs: 0 }) : null;
  const errs = p.diags.filter(x => x.error);
  ok(p.ok && r && r.ok && !errs.length && r.pixels && r.pixels.length > 0, d.file, r ? `${r.width}x${r.height} ${r.shapes} shapes` : JSON.stringify(p.diags).slice(0, 160));
}

console.log('4. syntax errors');
{
  const src = 'startshape A\n\nshape A {\n  CIRCLE [ ]\n  B [ s 0.5 x 1 \n}\n';
  const p = E.parse(src, 1);
  const e = p.diags.find(x => x.error);
  ok(!p.ok && e && e.line === 6, 'unclosed [ is reported at line 6', e ? `line ${e.line}: ${e.text}` : 'no diag');
  const p2 = E.parse('startshape A\nshape A {\n  CIRCLE [ ]\n  NOPE [ ]\n}\n', 1);
  const r2 = p2.ok ? E.render({ width: 50, height: 50 }) : null;
  const all = p2.diags.concat(r2 ? r2.diags : []);
  ok(all.some(x => x.error), 'a shape with no rules is an error', JSON.stringify(all.map(x => x.line + ':' + x.text)).slice(0, 120));
  const p3 = E.parse('startshape A\nshape A {\n  CIRCLE [ ]\n}\n\n\n\nshape B {\n  CIRCLE [ q 3 ]\n}\n', 1);
  const e3 = p3.diags.find(x => x.error);
  ok(!p3.ok && e3 && e3.line === 9, 'an unknown adjustment is reported at line 9', e3 ? `line ${e3.line}: ${e3.text}` : 'no diag');
}

console.log('5. stop and finish');
{
  E.parse(read('snowflake.cfdg'), ABC);
  const full = E.render({ width: 300, height: 300, tickMs: 0 });
  E.parse(read('snowflake.cfdg'), ABC);
  let calls = 0;
  const stopped = E.render({ width: 300, height: 300, tickMs: 1 }, { onProgress: () => (++calls >= 2 ? 'stop' : 0) });
  ok(stopped.stopped && calls >= 2, 'a stop from the progress hook ends the render', `${calls} progress calls, stopped=${stopped.stopped}`);
  E.parse(read('snowflake.cfdg'), ABC);
  const fin = E.render({ width: 300, height: 300, tickMs: 1 }, { onProgress: p => (p.shapes > 2000 ? 'finish' : 0) });
  ok(fin.finished && fin.ok && fin.shapes < full.shapes && fnv(fin.pixels) !== fnv(full.pixels), 'finish up draws the shapes so far',
    `${fin.shapes} of ${full.shapes} shapes`);
  E.parse(read('snowflake.cfdg'), ABC);
  let partials = 0;
  E.render({ width: 300, height: 300, partial: true, tickMs: 1 }, { onFrame: () => partials++ });
  ok(partials >= 2, 'partial frames arrive during a render', `${partials} frames`);
}

console.log('6. tiles and time');
{
  E.parse(read('ours-truchet.cfdg'), 5);
  const r = E.render({ width: 300, height: 300, tile: 3 });
  ok(r.info.tiled && r.width === 3 * r.tileWidth && r.height === 3 * r.tileHeight, 'a tiled design renders 3 x 3 tiles', `${r.width}x${r.height}, tile ${r.tileWidth}x${r.tileHeight}`);
  // The tile repeats: the left third equals the middle third.
  const w = r.width, tw = r.tileWidth;
  let same = 0, n = 0;
  for (let y = 0; y < r.height; y += 7) for (let x = 0; x < tw; x += 5) {
    const a = (y * w + x) * 4, b = (y * w + x + tw) * 4; n++;
    if (Math.abs(r.pixels[a] - r.pixels[b]) < 3 && Math.abs(r.pixels[a + 1] - r.pixels[b + 1]) < 3) same++;
  }
  ok(same / n > 0.97, 'the tiles repeat', `${(100 * same / n).toFixed(1)}% of samples match`);
  E.parse(read('test-friezetest1.cfdg'), 5);
  const fz = E.render({ width: 300, height: 300, tile: 3 });
  ok(fz.info.frieze === 1 && fz.width === 3 * fz.tileWidth && fz.height === fz.tileHeight, 'a frieze repeats along x only', `${fz.width}x${fz.height}`);
  E.parse(read('ours-rosette.cfdg'), 5);
  const frames = [];
  const a = E.render({ width: 100, height: 100, frames: 6 }, { onFrame: (px, fw, fh, i) => frames.push(fnv(px) + '@' + i) });
  ok(a.ok && frames.length === 6 && new Set(frames.map(f => f.split('@')[0])).size === 6, 'a time design gives 6 different frames', frames.join(' '));
  // One frame alone (the -f option of the CLI). Upstream animate() skips
  // the other frames before it moves the frame time on, so frame k alone
  // runs at a time from the start to frame k: not the time of frame k in
  // a full run. The page uses it for thumbnails only.
  E.parse(read('ours-rosette.cfdg'), 5);
  const one = E.render({ width: 100, height: 100, frames: 6, frame: 3 });
  ok(one.ok && one.pixels && one.pixels.length === 100 * 100 * 4 && one.shapes > 0, 'one frame renders alone', `${fnv(one.pixels)}, ${one.shapes} shapes`);
}

console.log('7. SVG, antialiasing, defines');
{
  E.parse(read('thingy.cfdg'), ABC);
  const svg = E.svg({ width: 200, height: 200, maxShapes: 5000 });
  ok(svg.startsWith('<?xml') && svg.includes('<svg') && (svg.match(/<(path|circle|rect|use|polygon)/g) || []).length > 100, 'SVG output has the shapes', svg.length + ' chars');
  E.parse(read('thingy.cfdg'), ABC);
  const aa = E.render({ width: 200, height: 200 });
  E.parse(read('thingy.cfdg'), ABC);
  const noaa = E.render({ width: 200, height: 200, antialias: false });
  const levels = px => { const s = new Set(); for (let i = 0; i < px.length; i += 4) s.add(px[i]); return s.size; };
  ok(levels(noaa.pixels) <= 2 && levels(aa.pixels) > 20, 'antialias off leaves only two grey levels', `${levels(aa.pixels)} -> ${levels(noaa.pixels)}`);
  E.parse(read('welcome.cfdg'), 5);
  const r0 = E.render({ width: 100, height: 100 });
  const p = E.parse(read('welcome.cfdg'), 5, {}, 'CF::Background = [b -1]');
  const r = E.render({ width: 100, height: 100 });
  ok(p.ok && r0.pixels[0] > 240 && r.pixels[0] < 15 && r.pixels[1] < 15 && r.pixels[2] < 15, 'a background define overrides CF::Background',
    `corner rgb ${r0.pixels[0]} -> ${r.pixels[0]},${r.pixels[1]},${r.pixels[2]}`);
  const p2 = E.parse(read('thingy.cfdg'), 5, {}, 'CF::Background = [b -1]');
  ok(!p2.ok, 'a define on a CFDG 2 design fails, as in the CLI', p2.messages.slice(-1)[0] || '');
}

console.log('8. variation codes');
{
  let bad = 0;
  for (const v of [1, 2, 25, 26, 27, 52, 701, 702, 703, 704, 18277, 18278, 18279, 123456, 2147483647]) {
    if (E.varToString(v) !== varToString(v) || E.varFromString(varToString(v)) !== v || varFromString(varToString(v)) !== v) bad++;
  }
  for (const s of ['a', 'Zz', 'abc', 'ZZZ', '17', 'x9', '']) if (E.varFromString(s) !== varFromString(s)) bad++;
  ok(bad === 0, 'JS and engine variation codes agree', bad + ' mismatches');
}

console.log('9. growth replay');
{
  // Pixels that differ from the background (the first pixel of the final
  // render) by more than 40 in some channel.
  let bg = [255, 255, 255];
  const ink = px => { let n = 0; for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - bg[0]) > 40 || Math.abs(px[i + 1] - bg[1]) > 40 || Math.abs(px[i + 2] - bg[2]) > 40) n++; return n; };
  for (const [f, tile] of [['demo1.cfdg', 0], ['snowflake.cfdg', 0], ['sierpinski.cfdg', 0], ['ours-truchet.cfdg', 3]]) {
    E.parse(read(f), ABC);
    const plain = E.render({ width: 240, height: 240, tile, tickMs: 0 });
    E.parse(read(f), ABC);
    const g = E.render({ width: 240, height: 240, tile, grow: true, tickMs: 0 });
    const want = fnv(plain.pixels);
    bg = [plain.pixels[0], plain.pixels[1], plain.pixels[2]];
    ok(g.grow && g.measured === plain.shapes && fnv(g.pixels) === want, `${f}: a grow render is the normal render`, `${g.measured} shapes, depth ${g.minDepth}..${g.maxDepth}, fnv ${want}`);
    for (const mode of ['build', 'depth', 'radial']) {
      const counts = [0, 0.25, 0.5, 0.75].map(t => ink(E.growFrame(mode, t)));
      const fin = E.growFrame(mode, 1);
      const up = counts.every((c, i) => i === 0 || c >= counts[i - 1]) && ink(fin) > counts[0];
      ok(fnv(fin) === want && up, `${f}: ${mode} grows to the normal render`, counts.concat(ink(fin)).join(' < ') + ', fnv ' + fnv(fin));
    }
    // An added frame (0.3 then 0.6) equals a frame drawn from clear (0.9
    // then 0.6) in build order, where the draw order is the key order.
    E.growFrame('build', 0.3); const added = fnv(E.growFrame('build', 0.6));
    E.growFrame('build', 0.9); const fresh = fnv(E.growFrame('build', 0.6));
    ok(added === fresh, `${f}: an added build frame equals a redraw`, added);
    E.growEnd();
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
