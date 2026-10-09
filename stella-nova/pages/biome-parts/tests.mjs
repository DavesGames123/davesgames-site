// ============================================================================
//  BIOME PARTS  ·  tests.mjs — node checks (no browser)
// ----------------------------------------------------------------------------
//    node tests.mjs            everything, with the 500-build saver soak
//    node tests.mjs --quick    a 40-build soak
//
//  SECTIONS (grep -n "section(")
//    page shell ........ wishlist after gpu-guard, [hidden] guard, ids, credits
//    vocab ............. tables equal the Python dump (make_ref.py vocab.json)
//    weights ........... sha256 of the vendored file = Biome-S1 release/hf
//    parity ............ tokens equal Python; logits and done logits within
//                        1e-4 of PyTorch on 60 states (ref.json)
//    eval .............. the repo's goal streams, 12 per suite, closed loop
//    session ........... topology rules, undo, expert on simple builds
//    field ............. a hole removes its volume, polar N-fold symmetry,
//                        mirror symmetry, CPU field = analytic volume
//    mesh .............. marching cubes export is closed; STL text
//    wgsl .............. naga validates the shader; Tint traps absent
//    main.js link ...... node import: no SyntaxError
//    saver soak ........ 500 live builds through director.js: no NaN, flat
//                        heap, success rate vs the repo, shot rules
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import vm from 'node:vm';

const HERE = new URL('./', import.meta.url);
const QUICK = process.argv.includes('--quick');
const read = p => readFileSync(new URL(p, HERE));
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  FAIL', msg); } };
const section = name => console.log('\n## ' + name);

const V = await import('./js/vocab.js');
const { encodeState, encodeActions, f16 } = await import('./js/featurize.js');
const { loadModel, forward } = await import('./js/model.js');
const { runEpisode } = await import('./js/agent.js');
const { Session, buildTarget, shapeInfo, pickFace } = await import('./js/fcsim.js');
const { packTape, fieldFC, volumeOf, meshOf, toSTL, iou, WGSL_PART } = await import('./js/part.js');
const { GALLERY } = await import('./js/gallery.js');
const { createDirector, SHOTS } = await import('./js/director.js');
const { Runner } = await import('./js/core.js');

section('page shell');
const html = read('index.html').toString(), css = read('style.css').toString();
const lines = html.split('\n');
const gi = lines.findIndex(l => l.includes('lib/gpu-guard.js'));
ok(gi >= 0 && lines[gi + 1].includes('lib/wishlist.js'), 'wishlist.js directly after gpu-guard');
ok(/\[hidden\]\{display:none!important\}/.test(css), '[hidden]{display:none!important} in style.css');
for (const id of ['view', 'ov', 'scores', 'checks', 'tree', 'log', 'items', 'gallery', 'buildBtn', 'stepBtn', 'playBtn', 'stlBtn', 'jsonBtn', 'forgeBtn', 'tokens', 'evalTable', 'nogpu'])
  ok(html.includes(`id="${id}"`), 'element #' + id);
ok(html.includes('github.com/shhivv/biome-s1') && html.includes('Shiv Shanmugam'), 'credit and link on the page');
const credits = read('taiga-s1/CREDITS.md').toString(), lic = read('taiga-s1/LICENSE').toString();
ok(lic.includes('MIT License') && lic.includes('Shiv Shanmugam'), 'MIT licence text vendored');
// hidden elements that also get a display rule are safe only with the guard
for (const m of html.matchAll(/id="([^"]+)"[^>]*\shidden/g)) ok(!new RegExp('#' + m[1] + '\\{[^}]*display').test(css) || css.includes('[hidden]{display:none!important}'), 'hidden #' + m[1]);

section('vocab');
const voc = JSON.parse(read('test-data/vocab.json'));
for (const k of ['ACTION_IDS', 'CATEGORIES', 'SCOPES', 'WORD_VOCAB', 'NODE_TYPES', 'WORKBENCHES', 'GOAL_KINDS', 'NODE_NUM_KEYS', 'GOAL_PARAM_KEYS'])
  ok(JSON.stringify(V[k]) === JSON.stringify(voc[k]), k + ' equals the Python table');
for (const [a, w] of Object.entries(voc.words)) ok(JSON.stringify(V.actionWords(a)) === JSON.stringify(w), 'words of ' + a);
for (const [a, v] of Object.entries(voc.vectors)) ok(JSON.stringify(V.actionVector(a)) === JSON.stringify(v), 'vector of ' + a);
ok(f16(0.1) === 0.0999755859375 && f16(1 / 3) === 0.333251953125 && f16(-2.5) === -2.5, 'f16 rounds like numpy float16');

section('weights');
const wbuf = read('taiga-s1/model.safetensors');
const sha = createHash('sha256').update(wbuf).digest('hex');
const wref = JSON.parse(read('test-data/weights.json'));
ok(sha === wref.sha256, 'sha256 ' + sha.slice(0, 16) + ' = release/hf');
ok(credits.includes(sha), 'CREDITS.md records the sha256');
const cfg = JSON.parse(read('taiga-s1/config.json'));
const M = loadModel(wbuf.buffer.slice(wbuf.byteOffset, wbuf.byteOffset + wbuf.byteLength), cfg);
ok(M.params === 1228163, 'parameter count ' + M.params);

section('parity');
const states = JSON.parse(read('test-data/states.json')), ref = JSON.parse(read('test-data/ref.json'));
let tokBad = 0, maxL = 0, maxD = 0, argBad = 0;
states.forEach((s, i) => {
  const r = ref[i], T = encodeState(s.state, s.goal), A = encodeActions(s.actions);
  for (const k of ['seg', 'a', 'b', 'pos', 'ord']) if (T[k].length !== r[k].length || T[k].some((x, j) => x !== r[k][j])) tokBad++;
  r.num.forEach((row, j) => row.forEach((x, c) => { if (x !== T.num[j * 48 + c]) tokBad++; }));
  A.forEach((a, j) => { if (a.id !== r.act_id[j] || a.cat !== r.act_cat[j] || a.scope !== r.act_scope[j] || a.words.some((w, q) => w !== r.act_words[j][q]) || a.vec.some((x, q) => x !== r.act_vec[j][q])) tokBad++; });
  const o = forward(M, T, A);
  o.logits.forEach((l, j) => { maxL = Math.max(maxL, Math.abs(l - r.logits[j])); });
  o.done.forEach((l, j) => { maxD = Math.max(maxD, Math.abs(l - r.done[j])); });
  const am = x => x.indexOf(Math.max(...x));
  if (am(o.logits) !== am(r.logits)) argBad++;
});
console.log(`  ${states.length} states: token mismatches ${tokBad}, max |dlogit| ${maxL.toExponential(2)}, max |ddone| ${maxD.toExponential(2)}, argmax mismatches ${argBad}`);
ok(tokBad === 0, 'tokens and action rows equal Python');
ok(maxL < 1e-4 && maxD < 1e-4 && argBad === 0, 'logits match PyTorch');

section('eval');
const suites = JSON.parse(read('test-data/eval.json'));
const REPO = { 'iid-L1': 1, 'iid-L2': 1, 'iid-L3': 1, 'comp-L3': 0.9, 'comp2-L3': 1, 'comp3-L3': 1, 'len-L4': 1, 'len2-L5': 1, 'len3-L6': 1 };
const PER = QUICK ? 4 : 12;
for (const [name, eps] of Object.entries(suites)) {
  let n = 0, s = 0;
  for (const e of eps.slice(0, PER)) { const r = runEpisode(M, JSON.parse(JSON.stringify(e.goal)), e.start); n++; s += r.success; }
  console.log(`  ${name.padEnd(9)} ${s}/${n}   repo ${Math.round(100 * REPO[name])}% of 100`);
  ok(s / n >= REPO[name] - 0.2, name + ' within 20 points of the repo on the first ' + n);
}

section('session');
const T1 = buildTarget({ features: [{ kind: 'base_box', params: { w: 40, d: 30, h: 10 } }], scale: 40 });
ok(T1.A.F === 6 && T1.A.E === 12 && Math.abs(T1.A.vol - 12000) < 1e-6, 'box: 6 faces, 12 edges, 12000 mm³');
const T2 = buildTarget({ features: [{ kind: 'base_box', params: { w: 40, d: 30, h: 10 } }, { kind: 'hole', params: { r: 3, x: 8, y: 2 } }], scale: 40 });
ok(T2.A.F === 7 && T2.A.E === 15 && Math.abs(T2.A.vol - (12000 - Math.PI * 90)) < 1e-6, 'through hole: +1 face, +3 edges, -πr²h');
ok(pickFace(T2.A, '+Z').area < 1200, 'the top face loses the hole footprint');
const si = shapeInfo(buildTarget({ features: [{ kind: 'base_cyl', params: { r: 10, h: 5 } }], scale: 20 }).A);
ok(si.n_faces === 3 && si.face_dirs.join() === '+Z,-Z,|Z', 'disc: 3 faces, +Z -Z and a vertical seam');
{
  const S = new Session();
  const g = { features: [{ kind: 'base_box', params: { w: 20, d: 20, h: 5 } }], scale: 20 };
  buildTarget(g); S.reset(g);
  for (const a of ['PartDesign_Body', 'Select:Plane:XY', 'PartDesign_NewSketch', 'Sketcher_CreateCircle']) S.step(a);
  ok(S.expert()[0] === 'Std_Undo', 'an off-plan command makes the expert ask for Undo');
  S.step('Std_Undo');
  ok(S.expert()[0] === 'Sketcher_CreateRectangle' && S.state().tree.length === 2, 'Undo restores the sketch state');
}

section('field');
const box = { features: [{ kind: 'base_box', params: { w: 40, d: 30, h: 10 } }], scale: 40 };
const holed = { features: [...box.features, { kind: 'hole', params: { r: 4, x: 6, y: -3 } }], scale: 40 };
const b = { lo: [-22, -17, -1], hi: [22, 17, 11] };
const v0 = volumeOf(packTape(buildTarget(box).ops), b, 72), v1 = volumeOf(packTape(buildTarget(holed).ops), b, 72);
const want = Math.PI * 16 * 10;
console.log(`  hole removes ${(v0 - v1).toFixed(0)} mm³ (πr²h = ${want.toFixed(0)})`);
ok(Math.abs((v0 - v1) - want) / want < 0.08, 'a hole removes its volume');
ok(fieldFC(packTape(buildTarget(holed).ops), 6, -3, 5)[0] > 3.5, 'the hole axis is outside the part');
const flange = buildTarget(JSON.parse(JSON.stringify(GALLERY.flange.goal)));
const PF = packTape(flange.ops);
let symErr = 0;
for (let i = 0; i < 400; i++) {
  const r = 5 + 30 * ((i * 0.618) % 1), a = i * 2.39996, z = -1 + 22 * ((i * 0.377) % 1), t = 2 * Math.PI / 6;
  const d0 = fieldFC(PF, r * Math.cos(a), r * Math.sin(a), z)[0], d1 = fieldFC(PF, r * Math.cos(a + t), r * Math.sin(a + t), z)[0];
  symErr = Math.max(symErr, Math.abs(d0 - d1));
}
ok(symErr < 1e-6, `flange field has 6-fold symmetry (max diff ${symErr.toExponential(1)})`);
let holes = 0;
for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; if (fieldFC(PF, 26 * Math.cos(a), 26 * Math.sin(a), 4)[0] > 0) holes++; }
ok(holes === 6, `6 bolt holes on the 26 mm circle (found ${holes} of 12 sampled angles)`);
const plate = buildTarget(JSON.parse(JSON.stringify(GALLERY.mounting_plate.goal))), PP = packTape(plate.ops);
let mirErr = 0;
for (let i = 0; i < 300; i++) { const x = -44 + 88 * ((i * 0.618) % 1), y = -29 + 58 * ((i * 0.377) % 1), z = 7 * ((i * 0.733) % 1); mirErr = Math.max(mirErr, Math.abs(fieldFC(PP, x, y, z)[0] - fieldFC(PP, -x, y, z)[0])); }
ok(mirErr < 1e-6, 'mirrored plate field is symmetric in x');
for (const [k, g] of Object.entries(GALLERY)) {
  const t = buildTarget(JSON.parse(JSON.stringify(g.goal)));
  const bb = { lo: t.A.bbox[0].map(x => x - 1), hi: t.A.bbox[1].map(x => x + 1) };
  const vv = volumeOf(packTape(t.ops), bb, 64);
  ok(Math.abs(vv - t.A.vol) / t.A.vol < 0.12, `${k}: voxel volume ${vv.toFixed(0)} vs analytic ${t.A.vol.toFixed(0)}`);
}
ok(iou(flange.ops, flange.ops, { lo: flange.A.bbox[0], hi: flange.A.bbox[1] }, 24) === 1, 'IoU of a part with itself is 1');

section('mesh');
for (const k of ['flange', 'enclosure', 'washer']) {
  const t = buildTarget(JSON.parse(JSON.stringify(GALLERY[k].goal)));
  const { m, stats } = meshOf(t.ops, t.A, 64);
  ok(stats.closed && stats.degenerate < stats.tris * 0.01, `${k}: mesh closed (${stats.tris} triangles)`);
  ok(Math.abs(stats.volume - t.A.vol) / t.A.vol < 0.12, `${k}: mesh volume ${stats.volume.toFixed(0)} vs ${t.A.vol.toFixed(0)}`);
  const stl = toSTL(m);
  ok(stl.startsWith('solid ') && stl.trimEnd().endsWith('endsolid biome_part') && (stl.match(/facet normal/g) || []).length === stats.tris, k + ': STL text');
}

section('wgsl');
const { SHADER } = await import('./js/gpu.js').catch(() => ({ SHADER: null }));
const naga = process.env.HOME + '/.cargo/bin/naga';
if (SHADER && existsSync(naga)) {
  const f = fileURLToPath(new URL('./.shader-check.wgsl', HERE));
  (await import('node:fs')).writeFileSync(f, SHADER);
  const r = spawnSync(naga, [f], { encoding: 'utf8' });
  (await import('node:fs')).unlinkSync(f);
  ok(r.status === 0, 'naga validates the shader ' + (r.stderr || '').slice(0, 200));
} else console.log('  naga or gpu.js not loadable in node: skipped');
const mixed = WGSL_PART.split('\n').filter(l => /&&/.test(l) && /\|\|/.test(l));
ok(!mixed.length, 'no mixed && and || (Tint)');
ok(!/[*][^;\n]*\^|\^[^;\n]*[*]/.test(WGSL_PART), 'no mixed * and ^ (Tint)');

section('main.js link');
{
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(new URL('./js/main.js', HERE).href)}).catch(e => { console.log(e.name + ': ' + e.message); process.exit(e instanceof SyntaxError ? 3 : 0); })`], { encoding: 'utf8' });
  console.log('  ' + (r.stdout || '').trim().split('\n')[0]);
  ok(r.status === 0, 'main.js links (a browser-global ReferenceError is fine, a SyntaxError is not)');
}

section('saver soak');
v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc');
const R = new Runner(M);
const BUILDS = QUICK ? 40 : 500;
let clock = 0, nan = 0, lastShot = null, repeats = 0, shotAt = 0;
const cuts = [];
const heap = [];
const D = createDirector({ brain: R, seed: 20261008, calm: 0.6, sleep: async ms => { clock += ms; }, hooks: {
  onView(v) { if (v.decision && v.decision.rows.some(r => !Number.isFinite(r.p) || !Number.isFinite(r.z))) nan++; },
  onShot(k) { if (k === lastShot) repeats++; if (SHOTS.includes(k) && SHOTS.includes(lastShot)) cuts.push(clock - shotAt); lastShot = k; shotAt = clock; },
  onBuild(s) { if (s.tally.built % 50 === 0) { gc(); heap.push(process.memoryUsage().heapUsed); } },
} });
const t0 = Date.now();
const tally = await D.run(BUILDS);
const cleanRate = tally.clean.ok / Math.max(1, tally.clean.n), gremRate = tally.gremlin.ok / Math.max(1, tally.gremlin.n);
console.log(`  ${tally.built} builds in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${tally.steps} steps; clean ${tally.clean.ok}/${tally.clean.n}, gremlin ${tally.gremlin.ok}/${tally.gremlin.n}, injected ${tally.noise}, undos ${tally.undos}, outcomes ${JSON.stringify(tally.outcomes)}`);
console.log('  heap after gc every 50 builds (MB): ' + heap.map(h => (h / 1048576).toFixed(1)).join(' '));
ok(nan === 0, 'no NaN in any score');
ok(tally.built === BUILDS, 'every build counted');
// The repo: 100% right parts on every clean suite up to 11 items; 88-100%
// with 20% random actions. The saver injects 12% on a third of the parts.
ok(cleanRate >= 0.95, `clean success ${(100 * cleanRate).toFixed(1)}% >= 95% (repo 100%, margin 5 points)`);
ok(gremRate >= 0.8, `gremlin success ${(100 * gremRate).toFixed(1)}% >= 80% (repo 88-100% at 20%, margin 8 points)`);
if (heap.length >= 3) {
  const first = heap[1], last = heap[heap.length - 1];
  ok(last < first * 1.25 + 4 * 1048576, `heap flat: ${(first / 1048576).toFixed(1)} -> ${(last / 1048576).toFixed(1)} MB`);
}
ok(repeats === 0, 'no shot kind twice in a row');
const shotOk = cuts.filter(c => c >= 5800 && c <= 14000).length;
ok(cuts.length > 10 && shotOk / cuts.length > 0.9, `cuts every 6-12 s (${shotOk}/${cuts.length} cuts in range, a cut lands after the step that crosses it)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
