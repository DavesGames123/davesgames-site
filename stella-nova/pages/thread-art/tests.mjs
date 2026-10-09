// ============================================================================
//  THREAD ART  ·  tests.mjs — node checks of the model, the step and the exports
// ----------------------------------------------------------------------------
//  Run: node tests.mjs   (from any directory)
//  The GPU check runs gpu-check.mjs in Deno when deno is on PATH; without
//  deno it is reported as skipped, not as passed.
//  The page boot (jsdom-boot.mjs) needs JSDOM_DIR, a folder whose
//  node_modules holds jsdom; without it the boot checks are skipped.
// ============================================================================
import * as E from './engine.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0, skip = 0;
function ok(cond, name, info = '') {
  if (cond) { pass++; console.log('  ok   ' + name + (info ? '  ' + info : '')); }
  else { fail++; console.log('  FAIL ' + name + (info ? '  ' + info : '')); }
}

function makeRun({ res = 48, shape = 'circle', P = 36, color = false, dark = false, img = 'eye', alpha = 0.25, seed = 1, maxLines = 400, colors } = {}) {
  const mask = E.frameMask(shape, res);
  const T = E.targetFrom(E.shapeImage(img, res), res, { color, dark, mask });
  colors = colors || (color ? E.PALETTES.cmyk[dark ? 'dark' : 'light'] : E.PALETTES.mono[dark ? 'dark' : 'light']);
  return E.createRun({ res, shape, P, color, dark, alpha, seed, maxLines, colors }, T);
}

console.log('rdiv and line walk');
{
  let good = true;
  for (let m = 1; m < 40; m++) for (let a = -60; a <= 60; a++) {
    const want = Math.sign(a) * Math.floor(Math.abs(a) / m + 0.5);
    if (E.rdiv(a, m) !== want) { good = false; break; }
  }
  ok(good, 'rdiv rounds halves away from zero');
  const pegs = E.makePegs('circle', 64, 101);
  let distinct = true, inGrid = true, ends = true;
  for (let a = 0; a < 64; a += 3) for (let b = 0; b < 64; b += 5) {
    if (a === b) continue;
    const seen = new Set(), px = [];
    const n = E.walkLine(pegs, 101, a, b, p => { seen.add(p); px.push(p); });
    if (seen.size !== n) distinct = false;
    if (px.some(p => p < 0 || p >= 101 * 101)) inGrid = false;
    if (px[0] !== pegs.y[a] * 101 + pegs.x[a] || px[n - 1] !== pegs.y[b] * 101 + pegs.x[b]) ends = false;
  }
  ok(distinct, 'each pixel of a line is visited once');
  ok(inGrid && ends, 'lines stay in the grid and end on the pegs');
}

console.log('pegs and frames');
for (const shape of E.SHAPES) {
  const res = 120, pg = E.makePegs(shape, 90, res), mask = E.frameMask(shape, res);
  let inside = true;
  for (let i = 0; i < 90; i++) {
    if (pg.x[i] < 0 || pg.y[i] < 0 || pg.x[i] >= res || pg.y[i] >= res) inside = false;
    else if (!mask[pg.y[i] * res + pg.x[i]]) inside = false;
  }
  ok(inside, `${shape}: 90 pegs on the grid and in the frame mask`);
  ok(Math.abs(pg.x[0] - (res - 1) / 2) <= 1 && pg.y[0] <= 1, `${shape}: peg 0 at the top`);
}

console.log('greedy step = brute force');
function bruteBest(run) {
  // Lay each legal candidate on a copy of the residual; keep the lowest E (ties: lowest index).
  let best = { k: -1, j: -1, E: Infinity, gain: 0 };
  const E0 = E.sumSq(run.residual);
  for (let k = 0; k < run.K; k++) for (let j = 0; j < run.P; j++) {
    if (!E.validPair(run, run.cur[k], j)) continue;
    const copy = { ...run, residual: Int32Array.from(run.residual), cur: Int32Array.from(run.cur), lines: [] };
    E.applyLine(copy, k, j);
    const e = E.sumSq(copy.residual);
    if (e < best.E) best = { k, j, E: e, gain: E0 - e };
  }
  return best;
}
for (const c of [{ name: 'mono', color: false }, { name: 'colour', color: true, img: 'star' }, { name: 'colour dark hexagon', color: true, dark: true, shape: 'hexagon', img: 'rings' }]) {
  const run = makeRun({ res: 40, P: 28, ...c });
  let same = 0, gainExact = 0, tries = 25;
  for (let s = 0; s < tries; s++) {
    const bf = bruteBest(run), g = E.bestLine(run);
    if (bf.gain <= 0) { tries = s; break; }
    if (bf.k === g.k && bf.j === g.j) same++;
    if (g.gain === bf.gain) gainExact++;
    E.applyLine(run, g.k, g.j);
  }
  ok(tries > 5 && same === tries, `${c.name}: bestLine = brute force over ${tries} steps`, `${same}/${tries}`);
  ok(gainExact === tries, `${c.name}: gain = decrease of sum r^2`, `${gainExact}/${tries}`);
}

console.log('error decreases');
for (const c of [{ name: 'mono circle', img: 'moon', alpha: 0.12 }, { name: 'colour square', color: true, shape: 'square', img: 'star', alpha: 0.15 }, { name: 'mono dark', dark: true, img: 'eye' }]) {
  const run = makeRun({ res: 64, P: 60, maxLines: 600, ...c });
  let last = E.sumSq(run.residual), mono = true, steps = 0;
  while (E.stepRun(run)) {
    const e = E.sumSq(run.residual);
    if (!(e < last)) mono = false;
    last = e; steps++;
  }
  ok(steps > 20 && mono, `${c.name}: E falls on every step`, `${steps} lines, E/E0 ${E.errorFraction(run).toFixed(3)}, done ${run.done}`);
}
{
  // The floor: put one pixel of a line just above RFLOOR. Laying the line
  // clamps it, and the real decrease of E is then larger than the gain.
  const run = makeRun({ res: 48, P: 36, img: 'moon', alpha: 0.3 });
  const g = E.bestLine(run);
  const px = [];
  E.walkLine(run.pegs, run.res, run.cur[g.k], g.j, p => px.push(p));
  run.residual[px[Math.floor(px.length / 2)]] = E.RFLOOR + 3;
  const g2 = { k: g.k, j: g.j, gain: E.scoreLine(run, g.k, g.j) }, e0 = E.sumSq(run.residual);
  E.applyLine(run, g2.k, g2.j);
  const e1 = E.sumSq(run.residual), floored = run.residual.filter(v => v === E.RFLOOR).length;
  ok(floored === 1 && e0 - e1 > g2.gain && g2.gain > 0, 'the floor clamps, and E falls by more than the gain', `gain ${g2.gain}, decrease ${e0 - e1}`);
  const run2 = makeRun({ res: 40, P: 30, img: 'rings', alpha: 0.6, maxLines: 5000 });
  let n = 0; while (E.stepRun(run2)) n++;
  ok(run2.done && n < 5000, 'the step stops when no line has a positive gain', `${n} lines`);
}

console.log('determinism');
{
  const a = makeRun({ seed: 42, color: true, img: 'star' }), b = makeRun({ seed: 42, color: true, img: 'star' }), c = makeRun({ seed: 43, color: true, img: 'star' });
  while (E.stepRun(a)); while (E.stepRun(b)); while (E.stepRun(c));
  const key = r => r.lines.map(l => `${l.k}.${l.a}.${l.b}`).join(',');
  ok(key(a) === key(b) && a.lines.length > 50, 'the same seed gives the same sequence', `${a.lines.length} lines`);
  ok(key(a) !== key(c), 'another seed gives another sequence');
  ok(JSON.stringify(Array.from(a.start)) !== JSON.stringify(Array.from(c.start)), 'the seed sets the start pegs');
}

console.log('exports');
{
  const run = makeRun({ res: 64, P: 50, color: true, img: 'star', maxLines: 300, seed: 7 });
  while (E.stepRun(run));
  const json = JSON.stringify(E.toJSON(run));
  const back = E.fromJSON(json);
  const same = back.lines.length === run.lines.length && back.lines.every((l, i) => l.k === run.lines[i].k && l.a === run.lines[i].a && l.b === run.lines[i].b);
  ok(same, 'JSON peg sequence round-trips', `${back.lines.length} lines, ${json.length} bytes`);
  ok(back.colors.every((c, k) => c.every((v, i) => Math.abs(v - run.cfg.colors[k][i]) < 1 / 255)), 'JSON thread colours round-trip');
  // Replay: the record alone rebuilds the same residual.
  const re = makeRun({ res: 64, P: 50, color: true, img: 'star', maxLines: 300, seed: 7 });
  for (const l of back.lines) E.applyLine(re, l.k, l.b);
  ok(re.residual.every((v, i) => v === run.residual[i]), 'replaying the JSON gives the same residual');
  let threw = false;
  try { const o = JSON.parse(json); o.order[3][1] = (o.order[3][1] + 1) % 50; E.fromJSON(o); } catch (e) { threw = true; }
  ok(threw, 'a record whose order and thread pegs disagree is refused');

  const txt = E.toText(run);
  const nums = txt.split('\n').filter(l => /^\s+\d+:/.test(l)).flatMap(l => l.split(':')[1].trim().split(/\s+/).map(Number));
  ok(nums.length === run.lines.length + run.K, 'the text sheet lists every peg', `${nums.length} pegs`);

  const svg = E.toSVG(run, { size: 800, title: 'test <&>' });
  const lineCount = (svg.match(/<line /g) || []).length;
  ok(lineCount === run.lines.length, 'SVG has one <line> per line', String(lineCount));
  // A small balance check of tags, then xmllint when it is there.
  const stack = []; let balanced = true;
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    if (m[3] === '/') continue;
    if (m[1]) { if (stack.pop() !== m[2]) { balanced = false; break; } } else stack.push(m[2]);
  }
  ok(balanced && stack.length === 0, 'SVG tags balance');
  const dir = mkdtempSync(join(tmpdir(), 'thread-art-'));
  try {
    writeFileSync(join(dir, 't.svg'), svg);
    const r = spawnSync('xmllint', ['--noout', join(dir, 't.svg')], { encoding: 'utf8' });
    if (r.error) { skip++; console.log('  skip xmllint not found'); }
    else ok(r.status === 0, 'xmllint: SVG is well formed', (r.stderr || '').trim().slice(0, 120));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log('render and palette');
{
  const run = makeRun({ res: 64, P: 50, img: 'moon', alpha: 0.15, maxLines: 400 });
  while (E.stepRun(run));
  const mean = px => { let s = 0; for (let i = 0; i < px.length; i += 4) s += px[i]; return s / (px.length / 4); };
  const m0 = mean(E.renderRGBA(run, { size: 128, lines: 0 })), m1 = mean(E.renderRGBA(run, { size: 128 }));
  ok(m0 === 255 && m1 < 235, 'render: the page is white, the lines darken it', `mean ${m1.toFixed(1)}`);
  const rgba = E.shapeImage('star', 64);
  const pal = E.imagePalette(rgba, 64, 4, { seed: 3 });
  ok(pal.length === 4 && pal[3].every(v => v === 0), 'image palette: 3 colours + black', pal.map(E.hex).join(' '));
  const pal2 = E.imagePalette(rgba, 64, 4, { seed: 3 });
  ok(JSON.stringify(pal) === JSON.stringify(pal2), 'image palette is deterministic');
  const err = E.residualRGBA(run.residual, 64, 1, false, E.frameMask('circle', 64));
  ok(err.length === 64 * 64 * 4, 'error image size');
}

console.log('hairline: the drawn line keeps the model darkening');
{
  let agree = true, thin = true, worst = 0;
  for (const alpha of [0.05, 0.08, 0.1, 0.14]) for (const k of [1.5, 2.1, 3, 4.2, 6.3, 8]) {
    const h = E.hairline(alpha, k);
    if (h.q < 1 - 1e-9) { const e = Math.abs(h.q * h.w - alpha * k) / (alpha * k); worst = Math.max(worst, e); if (e > 1e-9) agree = false; }
    if (alpha <= 0.1 && k <= 4.5 && !(h.w >= 0.35 - 1e-9 && h.w <= 0.5)) thin = false;
    if (!(h.q > 0 && h.q <= 1)) agree = false;
  }
  ok(agree, 'width x opacity = opacity x model px (fit view)', `worst rel. error ${worst.toExponential(1)}`);
  ok(thin, 'opacity <= 0.1: the line is 0.35-0.5 device px at 1.5-4.5 device px per model px');
  const h1 = E.hairline(0.08, 4.2), h6 = E.hairline(0.08, 4.2, { zoom: 6 }), h40 = E.hairline(0.08, 4.2, { zoom: 40 });
  ok(h6.w > h1.w && h6.w < 3 * h1.w && h40.w <= E.HAIR_MAX && h6.q === h1.q, 'a zoom keeps the line a hairline', `w ${h1.w.toFixed(3)} / ${h6.w.toFixed(3)} / ${h40.w.toFixed(3)} px, q ${h1.q.toFixed(2)}`);
  ok(h1.q >= 0.9, 'the line is near opaque at 4.2 device px per model px', `q ${h1.q.toFixed(2)}`);
  const run = makeRun({ res: 64, P: 50, maxLines: 80, alpha: 0.08 }); while (E.stepRun(run));
  const svg = E.toSVG(run, { size: 1600 }), hs = E.hairline(0.08, 1600 / 64);
  const sw = +(svg.match(/stroke-width="([\d.]+)"/) || [])[1], so = +(svg.match(/stroke-opacity="([\d.]+)"/) || [])[1];
  ok(Math.abs(sw - hs.w) < 1e-3 && Math.abs(so - hs.q) < 1e-3, 'SVG export uses the same hairline', `stroke-width ${sw}, stroke-opacity ${so}`);
}

console.log('page boot in jsdom: backing stores at DPR 2 and 3');
for (const dpr of [2, 3]) {
  const r = spawnSync(process.execPath, [join(HERE, 'jsdom-boot.mjs'), 'hires', String(dpr), '1280', '800'], { encoding: 'utf8', timeout: 120000, env: process.env });
  let o; try { o = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch (e) { o = { error: (r.stderr || r.stdout || '').slice(0, 300) }; }
  if (o.skip) { skip++; console.log('  skip ' + o.skip); break; }
  if (o.error) { ok(false, `DPR ${dpr}: boot`, o.error); continue; }
  ok(o.ready && o.lines > 0 && !o.errors.length, `DPR ${dpr}: the page boots and lays lines`, `${o.lines} lines${o.errors.length ? ' ' + o.errors[0] : ''}`);
  ok(o.canvases.length > 0 && !o.low.length, `DPR ${dpr}: no canvas has a backing store below CSS size x DPR`, o.canvases.map(c => `#${c.id} ${c.w}x${c.h} (need ${c.need.join('x')})`).join(', '));
  ok(o.upscaledGrid === 0 && o.errCanvas && o.errCanvas[0] > 2 * 384, `DPR ${dpr}: the error view is at device px, no model grid drawn scaled up`, `error canvas ${o.errCanvas && o.errCanvas.join('x')}, upscaled grid draws ${o.upscaledGrid}`);
  ok(o.nBad === 0, `DPR ${dpr}: no NaN or infinite draw arguments`, `${o.calls} calls`);
}

console.log('GPU (Deno WebGPU) = CPU');
{
  const r = spawnSync('deno', ['run', '-A', join(HERE, 'gpu-check.mjs')], { encoding: 'utf8', timeout: 120000 });
  if (r.error) { skip++; console.log('  skip deno not found: the WGSL step is not checked'); }
  else {
    const rows = (r.stdout || '').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return { raw: l }; } });
    if (rows.length === 1 && rows[0].skip) { skip++; console.log('  skip ' + rows[0].skip); }
    else {
      for (const row of rows) ok(row.ok === true, `gpu ${row.case}`, `cpu ${row.cpuLines} gpu ${row.gpuLines} lines, residual diffs ${row.residDiff}`);
      ok(r.status === 0 && rows.length >= 4, 'gpu-check exit status', `status ${r.status}${r.stderr ? ' ' + r.stderr.trim().slice(0, 200) : ''}`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
void execFileSync;
