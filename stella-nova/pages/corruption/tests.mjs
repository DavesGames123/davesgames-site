// ============================================================================
//  CORRUPTION SHADER  ·  tests.mjs — node checks, no browser
// ----------------------------------------------------------------------------
//  Run:  node stella-nova/pages/corruption/tests.mjs      (V=1 shows each pass)
//  Exit code 1 when a check fails. The WGSL check runs ~/.cargo/bin/naga when
//  it is installed (naga is not Tint: see the Tint section for the rules
//  that naga does not enforce). A render check is tools/render-check.mjs
//  (Deno, offscreen).
//
//  GREP MAP
//    section('link ........ node --check, module imports, main.js named imports
//    section('library ..... the sdf-solids markers, the joined module, naga
//    section('tint ........ reserved words, mixed && || and mixed * ^ & |
//    section('uniforms .... struct U against params.js UNIFORM_FIELDS
//    section('params ...... ranges, shuffle, spread, emissive, scene points
//    section('models ...... meshes, fit, samples, polyhedra
//    section('camera ...... projection of the target, the pixel ray
//    section('saver ....... the shot plan
//    section('page ........ head order, ids, [hidden] rule
// ============================================================================
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import * as Pm from './params.js';
import * as Md from './models.js';
import { orbitCamera, mul4 } from './camera.js';
import { buildModule, sliceLibrary, LIB_START, LIB_END } from './gpu.js';
import { makePlan, SAVER_MODELS, codeExtract } from './saver.js';

const here = new URL('./', import.meta.url);
const path = f => new URL(f, here).pathname;
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) { passes++; if (process.env.V) console.log('  ok  ', msg); } else { fails++; console.log('  FAIL', msg); } };
const section = n => console.log(`\n-- ${n}`);
const finite = a => Array.from(a).every(Number.isFinite);

const page = await readFile(path('shaders/corruption.wgsl'), 'utf8');
const pack = await readFile(path('../sdf-solids-table/shaders/pack.wgsl'), 'utf8');
const html = await readFile(path('index.html'), 'utf8');
const mainSrc = await readFile(path('main.js'), 'utf8');
const css = await readFile(path('style.css'), 'utf8');

// ── link ────────────────────────────────────────────────────────────────────
section('link');
for (const f of (await readdir(path('.'))).filter(f => f.endsWith('.js')).concat(['tools/render-check.mjs'])) {
  const r = spawnSync(process.execPath, ['--check', path(f)], { encoding: 'utf8' });
  ok(r.status === 0, `node --check ${f}${r.status ? ': ' + r.stderr : ''}`);
}
// every named import of main.js exists in its module (main.js itself runs
// the page at import, so it is read, not imported)
globalThis.window = globalThis.window || {};
for (const m of mainSrc.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
  const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
  const mod = await import(new URL(m[2], here));
  for (const n of names) ok(n in mod, `main.js imports ${n} from ${m[2]}`);
}

// ── library ─────────────────────────────────────────────────────────────────
section('library');
ok(pack.includes(LIB_START) && pack.includes(LIB_END), 'pack.wgsl still has the two library markers');
const lib = sliceLibrary(pack);
for (const fn of ['fn gnoise', 'fn fbm3', 'fn worley2', 'fn sdCapsule', 'fn sdCyl', 'fn rbox', 'fn env(', 'fn dielectric', 'fn metal', 'fn plastic', 'fn finish', 'fn spin'])
  ok(lib.includes(fn), `library has ${fn}`);
ok(!/@group|struct SolidU/.test(lib), 'library section declares no binding and no struct');
const joined = buildModule(pack, page);
const naga = join(homedir(), '.cargo/bin/naga');
if (existsSync(naga)) {
  const dir = mkdtempSync(join(tmpdir(), 'corr-'));
  writeFileSync(join(dir, 'm.wgsl'), joined);
  const r = spawnSync(naga, [join(dir, 'm.wgsl')], { encoding: 'utf8', timeout: 60000 });
  ok(r.status === 0 && /successful/.test(r.stdout + r.stderr), `naga validates the joined module${r.status ? ': ' + (r.stdout + r.stderr).slice(0, 600) : ''}`);
} else console.log('  skip  naga is not installed (~/.cargo/bin/naga)');
for (const e of ['vs_full', 'fs_scene', 'vs_mesh', 'fs_mesh', 'vs_part', 'fs_part', 'vs_glyph', 'fs_glyph', 'fs_post', 'cs_sample', 'cs_pick'])
  ok(new RegExp(`fn ${e}\\(`).test(page), `entry point ${e}`);

// ── tint: rules that naga does not enforce ─────────────────────────────────
section('tint');
const RESERVED = 'NULL Self abstract active alignas alignof as asm async attribute auto await become cast catch class coherent common compile concept crate debugger delete demote do enum explicit export extends extern external fallthrough filter final finally friend from get goto groupshared highp impl implements import inline instanceof interface layout lowp macro match mediump meta mod module move mut mutable namespace new nil noexcept noinline nointerpolation noperspective null nullptr of operator package packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public readonly ref regardless register require resource restrict self set shared sizeof smooth snorm static std subroutine super target template this throw trait try type typedef typeid typename typeof union unless unorm unsafe unsized use using varying virtual volatile wgsl where with writeonly yield'.split(' ');
const idents = new Set([...page.matchAll(/\b(?:let|var|fn)\s+([A-Za-z_]\w*)/g), ...page.matchAll(/[(,]\s*([A-Za-z_]\w*)\s*:/g)].map(m => m[1]));
ok(RESERVED.every(w => !idents.has(w)), `no reserved word as a name (${RESERVED.filter(w => idents.has(w)).join(', ') || 'none'})`);
const code = page.split('\n').map(l => l.replace(/\/\/.*$/, ''));
const mixedLogic = code.filter(l => /&&/.test(l) && /\|\|/.test(l));
ok(mixedLogic.length === 0, `no line mixes && and || (${mixedLogic.length})`);
const mixedBits = code.filter(l => /[^&|]&[^&]|\^|[^|]\|[^|]/.test(l) && /[*+-]/.test(l) && !/\(\s*\w+\s*<<\s*1u\s*\)\s*&\s*2u/.test(l) && !/->/.test(l));
ok(mixedBits.length === 0, `no line mixes bit and arithmetic operators (${mixedBits.map(l => l.trim()).join(' | ')})`);
const fsMesh = page.slice(page.indexOf('fn fs_mesh'), page.indexOf('fn fs_mesh') + 400);
ok(fsMesh.indexOf('dpdx') < fsMesh.indexOf('if ('), 'fs_mesh takes derivatives before any branch (uniform control flow)');
ok(!/textureSample\(/.test(page), 'post uses textureSampleLevel only (no uniformity rule)');

// ── uniforms ────────────────────────────────────────────────────────────────
section('uniforms');
const body = page.slice(page.indexOf('struct U {'), page.indexOf('};', page.indexOf('struct U {')));
const SIZE = { f32: 1, vec2f: 2, vec4f: 4, mat4x4f: 16 };
const wgsl = [...body.matchAll(/(\w+)\s*:\s*([\w<>, ]+?)\s*(?=,\s*(?:\w+\s*:|$))/gm)].map(m => {
  const t = m[2].trim(), arr = t.match(/array<vec4f,\s*(\d+)>/);
  return [m[1], arr ? 4 * +arr[1] : SIZE[t]];
});
ok(JSON.stringify(wgsl) === JSON.stringify(Pm.UNIFORM_FIELDS), `struct U matches UNIFORM_FIELDS (${wgsl.length} fields)`);
ok(Pm.UNIFORM_FLOATS % 4 === 0, `uniform block is a multiple of 16 bytes (${Pm.UNIFORM_FLOATS * 4})`);
let off = 0, aligned = true;
for (const [n, k] of Pm.UNIFORM_FIELDS) { const al = k >= 4 ? 4 : k === 2 ? 2 : 1; if (off % al) aligned = false; off += k; }
ok(aligned, 'every field sits on its WGSL alignment (no hidden padding)');
for (const n of ['size', 'pixelScale', 'ink', 'tone', 'cream', 'exposure', 'studio'])
  ok(Pm.UNIFORM_FIELDS.some(f => f[0] === n), `struct U has ${n}, which the library reads`);
for (const m of lib.matchAll(/\bu\.(\w+)/g)) ok(Pm.UNIFORM_FIELDS.some(f => f[0] === m[1]), `library field u.${m[1]} exists`);

// ── params ──────────────────────────────────────────────────────────────────
section('params');
const D = Pm.defaults();
for (const p of Pm.PARAMS) {
  ok(p.min <= p.lo && p.lo <= p.hi && p.hi <= p.max, `${p.id}: shuffle range inside the panel range`);
  ok(p.min <= D[p.id] && D[p.id] <= p.max, `${p.id}: default inside the range`);
}
ok(new Set(Pm.PARAMS.map(p => p.id)).size === Pm.PARAMS.length, 'parameter ids are unique');
const a = Pm.shuffle(1234), b = Pm.shuffle(1234), c = Pm.shuffle(1235);
ok(JSON.stringify(a) === JSON.stringify(b), 'shuffle is the same for the same seed');
const diff = Pm.PARAMS.filter(p => a[p.id] !== c[p.id]).length;
ok(diff > Pm.PARAMS.length * 0.7, `the next seed changes most rows (${diff} of ${Pm.PARAMS.length})`);
let inRange = true, srcOk = true;
for (let s = 0; s < 300; s++) {
  const o = Pm.shuffle(s * 7919 + 3, { c: [0, 1, 0], r: 1.1 });
  for (const p of Pm.PARAMS) if (!(o[p.id] >= p.min && o[p.id] <= p.max)) inRange = false;
  if (!(o.src[1] >= 0.05) || Math.hypot(o.src[0], o.src[1] - 1, o.src[2]) > 1.1 * 0.92) srcOk = false;
}
ok(inRange, '300 shuffles stay inside the panel ranges');
ok(srcOk, '300 shuffles put the origin above the deck and inside 0.9 bound radii');
for (const mode of ['hold', 'breathe', 'sweep']) {
  const v = Array.from({ length: 400 }, (_, i) => Pm.spreadAt({ ...D, mode }, i * 0.11));
  ok(v.every(x => x >= 0 && x <= 1.36), `spreadAt ${mode} stays in 0..1.35`);
}
const sw = Array.from({ length: 220 }, (_, i) => Pm.spreadAt({ ...D, mode: 'sweep' }, i * 0.1));
ok(Math.max(...sw) - Math.min(...sw) > 0.3, 'sweep mode moves the front');
for (const h of [-1, 0, 1]) { const e = Pm.emissive(h); ok(e[0] === 1 && e[1] < 0.15 && e[2] < 0.15, `emissive(${h}) stays red [${e.map(x => x.toFixed(3))}]`); }
const pts = Pm.scenePoints(D, { c: [0, 1, 0], r: 1 }, 3.2, 0.5, 9);
ok(pts.length === 208 && finite(pts), 'scenePoints: 52 finite vec4');
let bounded = true;
for (let i = 0; i < 6; i++) for (let s = 0; s < 5; s++) {
  const k = (i * 5 + s) * 4, bk = (30 + i) * 4;
  if (Math.hypot(pts[k] - pts[bk], pts[k + 1] - pts[bk + 1], pts[k + 2] - pts[bk + 2]) + pts[k + 3] > pts[bk + 3] + 1e-6) bounded = false;
}
ok(bounded, 'each tendril bounding sphere holds its capsules');
const U = Pm.packUniforms(D, orbitCamera().viewState(800, 500), { time: 1, amount: 0.4, kind: 0, sdfId: 0, samples: 0, bound: { c: [0, 1, 0], r: 1 }, seed: 5 });
ok(U.length === Pm.UNIFORM_FLOATS && finite(U), 'packUniforms fills the block with finite numbers');
ok(U[Pm.UNIFORM_OFFSET.amount] === Math.fround(0.4) && U[Pm.UNIFORM_OFFSET.size] === 800, 'packUniforms puts fields at their offsets');
const fs = Pm.fitSrc([0.5, 1.5, 0], { c: [0, 1, 0], r: 1 }, { c: [0, 2, 0], r: 2 });
ok(fs[0] === 1 && fs[1] === 3 && fs[2] === 0, 'fitSrc scales the origin offset to the new bound');
ok(Pm.readQuery('?seed=77&model=knot').seed === 77 && Pm.readQuery('').seed === null, 'readQuery reads seed and model');

// ── models ──────────────────────────────────────────────────────────────────
section('models');
ok(new Set(Md.MODELS.map(m => m.id)).size === Md.MODELS.length, 'model ids are unique');
ok(Md.MODELS.filter(m => m.kind === 'sdf').map(m => m.sdf).join() === '0,1,2,3', 'SDF ids 0..3 match the sdModel branches');
ok(/id == 0\) \{ return sdTrooper/.test(page) && /id == 1\) \{ return sdReactor/.test(page) && /id == 2\) \{ return sdCrates/.test(page) && /return sdRelic/.test(page), 'sdModel has the four branches');
for (const [id, f] of [['knot', Md.torusKnot], ['pod', Md.hullPod], ['bench', Md.bench]]) {
  const m = f();
  const nv = m.positions.length / 3;
  ok(finite(m.positions) && finite(m.normals) && m.normals.length === m.positions.length, `${id}: finite positions and normals`);
  ok(m.indices.length % 3 === 0 && Math.max(...m.indices) < nv, `${id}: indices in range (${m.indices.length / 3} triangles)`);
  let unit = true; for (let i = 0; i < m.normals.length; i += 3) if (Math.abs(Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]) - 1) > 1e-3) unit = false;
  ok(unit, `${id}: unit normals`);
  const fm = Md.fitMesh(m, 2);
  const bb = Md.bounds(fm.mesh.positions);
  ok(Math.abs(bb.min[1]) < 1e-5 && Math.max(bb.max[0] - bb.min[0], bb.max[1], bb.max[2] - bb.min[2]) <= 2 + 1e-4, `${id}: fit stands on y = 0, size 2`);
  const smp = Md.sampleSurface(fm.mesh, 500, Pm.rng(1));
  let inB = true; for (let i = 0; i < 500; i++) { const p = [smp[i * 8], smp[i * 8 + 1], smp[i * 8 + 2]]; if (Math.hypot(p[0] - fm.bound.c[0], p[1] - fm.bound.c[1], p[2] - fm.bound.c[2]) > fm.bound.r + 1e-4) inB = false; }
  ok(inB && finite(smp), `${id}: samples lie inside the bound sphere`);
}
const P = Md.polyhedra();
ok(P.ranges.map(r => r.name).join() === 'tetra,cube,octa,icosa' && P.ranges.reduce((s, r) => s + r.count, 0) * 6 === P.data.length, 'polyhedra: four shapes, ranges cover the data');
let out = true;
for (let i = 0; i < P.data.length; i += 18) {
  const c = [0, 1, 2].map(k => (P.data[i + k] + P.data[i + 6 + k] + P.data[i + 12 + k]) / 3);
  if (c[0] * P.data[i + 3] + c[1] * P.data[i + 4] + c[2] * P.data[i + 5] <= 0) out = false;
}
ok(out, 'polyhedra: every face normal points outward');
const glbLike = { meshes: [{ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: null, indices: new Uint32Array([0, 1, 2]), vertexCount: 3 }] };
const gm = Md.meshFromGLB(glbLike);
ok(gm.normals[2] > 0.99, 'meshFromGLB makes normals for a GLB without them');

// ── camera ──────────────────────────────────────────────────────────────────
section('camera');
const cam = orbitCamera({ target: [0, 1, 0], dist: 4 });
const vs = cam.viewState(1000, 600);
const proj = (m, p) => { const v = [0, 1, 2, 3].map(r => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]); return v.map(x => x / v[3]); };
const t = proj(vs.viewProj, [0, 1, 0]);
ok(Math.abs(t[0]) < 1e-6 && Math.abs(t[1]) < 1e-6 && t[2] > 0 && t[2] < 1, `target projects to the centre, depth ${t[2].toFixed(4)}`);
const ray = cam.rayAt(500, 300, 1000, 600);
ok(Math.hypot(...ray.d.map((d, i) => d - vs.camF[i])) < 1e-6, 'the centre pixel ray is the forward axis');
const r2 = cam.rayAt(800, 150, 1000, 600), hp = [0, 1, 2].map(i => r2.o[i] + r2.d[i] * 3), pp = proj(vs.viewProj, hp);
ok(Math.abs(pp[0] - 0.6) < 1e-4 && Math.abs(pp[1] - 0.5) < 1e-4, 'a pixel ray reprojects to its pixel');
cam.shiftY = -0.08;
const vs2 = cam.viewState(1000, 600), r3 = cam.rayAt(500, 300, 1000, 600), pp3 = proj(vs2.viewProj, [0, 1, 2].map(i => r3.o[i] + r3.d[i] * 2));
ok(Math.abs(pp3[1]) < 1e-4, 'with a principal point shift the pixel ray still reprojects to its pixel');
ok(mul4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], vs.viewProj).every((v, i) => Math.abs(v - vs.viewProj[i]) < 1e-12), 'mul4 identity');

// ── saver ───────────────────────────────────────────────────────────────────
section('saver');
const pl = makePlan(42), pl2 = makePlan(42);
ok(JSON.stringify(pl) === JSON.stringify(pl2), 'the plan is the same for the same seed');
ok(JSON.stringify(makePlan(43)) !== JSON.stringify(pl), 'another seed gives another plan');
ok(pl.every(s => s.dur >= 7 && s.dur <= 12 && SAVER_MODELS.includes(s.model)), 'shots last 7 to 12 s on stage models');
ok(new Set(pl.map(s => s.model)).size >= 4, `a plan visits several models (${new Set(pl.map(s => s.model)).size})`);
ok(!SAVER_MODELS.includes('custom'), 'the saver never asks for the custom model');
const ex = codeExtract(page);
ok(ex.startsWith('fn spreadR') && ex.includes('fn corruptFieldOct') && !ex.includes('//') && ex.split('\n').length <= 16, `the plate code extract is the field, ${ex.split('\n').length} lines`);

// ── page ────────────────────────────────────────────────────────────────────
section('page');
ok(/<head>\s*<script src="\.\.\/\.\.\/lib\/gpu-guard\.js"><\/script>\s*<script src="\.\.\/\.\.\/lib\/wishlist\.js"><\/script>/.test(html), 'gpu-guard first, wishlist directly after');
ok(/\[hidden\]\{display:none!important\}/.test(css), 'style.css has the [hidden] guard');
for (const m of mainSrc.matchAll(/\$\('(\w+)'\)/g)) ok(html.includes(`id="${m[1]}"`), `index.html has #${m[1]}`);
ok(html.indexOf('sn-panel.css') > html.indexOf('style.css'), 'sn-panel.css loads after style.css');
ok(/window\.snSaver\s*=/.test(await readFile(path('saver.js'), 'utf8')), 'saver.js installs window.snSaver');

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
