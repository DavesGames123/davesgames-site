// ============================================================================
//  MANIM LIVE  ·  tests/engine.test.mjs  (node --test tests/engine.test.mjs)
// ----------------------------------------------------------------------------
//  Part 1 (no Python): wheel digests, py/manifest.json, no module named
//  "manim" in the page code, example headers.
//  Part 2 (needs MANIM_LIVE_CACHE, see tools/node-env.mjs; skipped without):
//  the real manim 0.22.0 in Pyodide in Node:
//    version and file of manim, every installed manim file against the
//    wheel RECORD, shim modules come from py/, seed examples render,
//    native reference frames, TeX parts and colours, speed of a 3 s scene,
//    and the worker protocol through the real worker.js + engine.js.
// ============================================================================

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test, before, after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildCatalog } from '../tools/build-catalog.mjs';
import { listPyFiles } from '../tools/py-manifest.mjs';

const PAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIM_SHA256 = 'bce56dbe420ce002cb77076c0b4e041637a0bd41ce5749e837e96375937e935f';
const SHIMS = ['cairo', 'manimpango', 'pathops', 'mapbox_earcut', 'av', 'moderngl'];
const HAVE_CACHE = !!(process.env.MANIM_LIVE_CACHE && fs.existsSync(path.join(process.env.MANIM_LIVE_CACHE, 'node_modules', 'pyodide')));
const NEED = HAVE_CACHE ? {} : { skip: 'MANIM_LIVE_CACHE is not set (see tools/node-env.mjs)' };
// Thresholds from the measured reference differences (UNDER-THE-HOOD.md).
const MAX_MAD = 1.5;       // mean absolute difference per channel, 0..255
const MAX_OVER32 = 0.01;   // share of pixels off by more than 32

// ---------------------------------------------------------------- part 1 --

test('wheels: each file matches LOCK.json, and the PyPI digests', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(PAGE, 'py/wheels/LOCK.json'), 'utf8'));
  const manim = lock.wheels.find((w) => w.name === 'manim');
  assert.equal(manim.file, 'manim-0.22.0-py3-none-any.whl');
  assert.equal(manim.pypiSha256, MANIM_SHA256);
  for (const w of lock.wheels) {
    const hex = crypto.createHash('sha256').update(fs.readFileSync(path.join(PAGE, 'py/wheels', w.file))).digest('hex');
    assert.equal(hex, w.sha256, w.file);
    if (w.pypiSha256) assert.equal(hex, w.pypiSha256, w.file + ' vs PyPI');
  }
});

test('py/manifest.json lists exactly the Python files under py/', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PAGE, 'py/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.files, listPyFiles());
});

test('no module named manim is defined by the page (only the shims)', () => {
  const tops = fs.readdirSync(path.join(PAGE, 'py')).filter((d) => d !== 'wheels' && !d.endsWith('.json'));
  assert.deepEqual(tops.sort(), [...SHIMS, 'manimlive'].sort());
  for (const f of listPyFiles()) {
    assert.ok(!/^manim(\/|\.py$)/.test(f), f);
    const src = fs.readFileSync(path.join(PAGE, 'py', f), 'utf8');
    assert.ok(!/sys\.modules\[\s*['"]manim['".]/.test(src), `${f} writes sys.modules['manim...']`);
  }
  const jsFiles = ['engine.js', 'worker.js', 'engine-core.js', 'engine-canvas.js', ...fs.readdirSync(path.join(PAGE, 'tools')).filter((f) => f.endsWith('.mjs')).map((f) => 'tools/' + f)];
  for (const f of jsFiles) {
    const src = fs.readFileSync(path.join(PAGE, f), 'utf8');
    assert.ok(!/registerJsModule\(\s*['"]manim['"]/.test(src), `${f} registers a JS module named manim`);
    assert.ok(!/site-packages\/manim\//.test(src), `${f} writes into site-packages/manim`);
  }
});

test('example headers are valid', () => {
  const { entries, errors } = buildCatalog();
  assert.deepEqual(errors, []);
  assert.ok(entries.length >= 3);
});

// ---------------------------------------------------------------- part 2 --

let rt = null;
let renderFile = null;
before(async () => {
  if (!HAVE_CACHE) return;
  const { createNodeRuntime } = await import('../tools/node-env.mjs');
  ({ renderFile } = await import('../tools/render.mjs'));
  rt = await createNodeRuntime();
});

const py = (code) => rt.pyodide.runPython(code);

test('manim is the PyPI wheel: version, file, digest', NEED, () => {
  assert.equal(rt.info.manimVersion, '0.22.0');
  assert.equal(rt.info.distVersion, '0.22.0');
  assert.ok(rt.info.manimFile.startsWith(rt.info.sitePackages + '/manim/'), rt.info.manimFile);
  const w = rt.info.wheels.find((x) => x.name === 'manim');
  assert.equal(w.sha256, MANIM_SHA256);
  assert.equal(py('import manim; manim.__version__'), '0.22.0');
});

test('every installed manim file matches the RECORD of the wheel', NEED, () => {
  const out = JSON.parse(py(`
import base64, hashlib, json, os, site
sp = site.getsitepackages()[0]
bad, n = [], 0
for line in open(os.path.join(sp, "manim-0.22.0.dist-info", "RECORD")):
    name, digest, size = line.rstrip("\\n").rsplit(",", 2)
    if not name.startswith("manim/") or not digest:
        continue
    algo, b64 = digest.split("=", 1)
    data = open(os.path.join(sp, name), "rb").read()
    got = base64.urlsafe_b64encode(hashlib.new(algo, data).digest()).rstrip(b"=").decode()
    n += 1
    if got != b64:
        bad.append(name)
json.dumps({"checked": n, "bad": bad})
`));
  assert.ok(out.checked > 150, `only ${out.checked} files checked`);
  assert.deepEqual(out.bad, []);
});

test('native modules resolve to py/ shims, manim to site-packages', NEED, () => {
  const out = JSON.parse(py(`
import json, sys
import manim
from manim import *
mods = {k: getattr(v, "__file__", None) for k, v in list(sys.modules.items()) if k == "manim" or k.startswith("manim.")}
shims = {k: sys.modules[k].__file__ for k in ${JSON.stringify(SHIMS)}}
json.dumps({"manim": mods, "shims": shims})
`));
  for (const [k, f] of Object.entries(out.shims)) assert.ok(f.startsWith('/home/pyodide/py/' + k + '/'), `${k}: ${f}`);
  const files = Object.values(out.manim).filter(Boolean);
  assert.ok(files.length > 100);
  for (const f of files) assert.ok(f.startsWith(rt.info.sitePackages + '/manim/'), f);
});

test('seed examples render', NEED, async () => {
  const files = fs.readdirSync(path.join(PAGE, 'examples')).filter((f) => f.endsWith('.py'));
  assert.ok(files.length >= 3);
  for (const f of files) {
    const scene = /^# scene:\s*(\S+)/m.exec(fs.readFileSync(path.join(PAGE, 'examples', f), 'utf8'))[1];
    const r = await renderFile({ file: path.join(PAGE, 'examples', f), scene, quality: 'low', frames: [], out: path.join(PAGE, 'tests', '.out-unused') }, rt);
    const err = r.events.find(([n]) => n === 'error');
    assert.ok(r.summary.ok, `${f}: ${err ? err[1].message : JSON.stringify(r.summary)}`);
    assert.ok(r.summary.frames > 10, `${f}: ${r.summary.frames} frames`);
    console.log(`  ${f}: ${r.summary.frames} frames in ${r.renderSeconds.toFixed(2)} s`);
  }
  fs.rmSync(path.join(PAGE, 'tests', '.out-unused'), { recursive: true, force: true });
});

test('frames match native manim 0.22.0 (tests/reference)', NEED, async () => {
  const { compareReference } = await import('../tools/reference-compare.mjs');
  const rows = await compareReference(rt);
  assert.ok(rows.length >= 9);
  for (const r of rows) {
    console.log(`  ${(r.scene + '-' + r.frame).padEnd(16)} MAD ${r.mad.map((v) => v.toFixed(3)).join(' ')}  >32: ${(100 * r.over32).toFixed(2)} %`);
    for (const v of r.mad) assert.ok(v < MAX_MAD, `${r.scene}-${r.frame}: MAD ${v}`);
    assert.ok(r.over32 < MAX_OVER32, `${r.scene}-${r.frame}: ${r.over32}`);
  }
});

test('TeX through MathJax keeps MathTex parts, colours and sizes', NEED, () => {
  const out = JSON.parse(py(`
import json
from manim import *
p = MathTex("a^2", "+", "b^2", "=", "c^2", tex_to_color_map={"b^2": RED})
q = MathTex(r"{{ a }} + {{ b }}")
t = Tex(r"Text with $x^2$")
one = MathTex("1")
json.dumps({"parts": [len(x) for x in p], "b": p[2][0].get_color().to_hex(), "a": p[0][0].get_color().to_hex(),
            "q": len(q), "tex": len(t[0]), "h1": one.height, "w1": one.width})
`));
  assert.deepEqual(out.parts, [2, 1, 2, 1, 2]);
  assert.equal(out.b.toUpperCase(), '#FC6255');
  assert.equal(out.a.toUpperCase(), '#FFFFFF');
  assert.equal(out.q, 3);
  assert.ok(out.tex >= 10);
  // "1" in the 10 pt TeX font, font_size 48: about 0.33 manim units high
  assert.ok(Math.abs(out.h1 - 0.333) < 0.01, `height ${out.h1}`);
});

test('a 3-second low-quality scene renders in under 10 s', NEED, () => {
  const code = `from manim import *
class Three(Scene):
    def construct(self):
        sq = Square(color=BLUE, fill_opacity=0.5)
        t = Text("speed", font_size=48).next_to(sq, UP)
        self.play(Create(sq), Write(t))
        self.play(sq.animate.rotate(PI / 2).shift(RIGHT), run_time=1)
        self.play(FadeOut(t), Transform(sq, Circle()), run_time=1)
`;
  let frames = 0;
  rt.frameSink = (u8, w, h, i, t, rep) => { frames += rep; };
  const t0 = Date.now();
  const s = rt.run(code, { quality: 'low' }, () => {});
  const sec = (Date.now() - t0) / 1000;
  rt.frameSink = null;
  console.log(`  3 s scene: ${frames} frames in ${sec.toFixed(2)} s (boot ${rt.info.bootSeconds.toFixed(1)} s, not counted)`);
  assert.ok(s.ok);
  assert.equal(frames, 45);
  assert.ok(sec < 10, `${sec} s`);
});

test('worker protocol: real worker.js + engine.js', NEED, async () => {
  const { installMainGlobals, localPyodide } = await import('./web-worker-shim.mjs');
  installMainGlobals();
  globalThis.crossOriginIsolated = true; // SharedArrayBuffer interrupt path
  const { createEngine } = await import('../engine.js');
  const eng = createEngine({ pyodide: localPyodide() });
  try {
    const info = await eng.ready;
    assert.equal(info.manimVersion, '0.22.0');
    assert.ok(eng.canInterrupt);
    const code = 'from manim import *\n\nclass A(Scene):\n    def construct(self):\n        c = Circle()\n        self.play(Create(c))\n        self.wait(0.5)\n        print("hi")\n        self.play(c.animate.shift(RIGHT), run_time=0.5)\n';
    const h = eng.run(code, { quality: 'low' });
    const seen = { scenes: null, anim: [], frames: [], logs: [], done: null, firstFrameBeforeDone: false };
    h.on('scenes', (s) => { seen.scenes = s; });
    h.on('animation', (a) => seen.anim.push(a));
    h.on('frame', (f) => { seen.frames.push(f.index); assert.ok(f.bitmap); });
    h.on('log', (l) => seen.logs.push(l.text));
    h.on('done', (d) => { seen.done = d; seen.firstFrameBeforeDone = seen.frames.length > 0; });
    const sum = await h.done;
    assert.ok(sum.ok);
    assert.deepEqual(seen.scenes, ['A']);
    assert.deepEqual(seen.anim.map((a) => [a.name, a.line, a.startFrame, a.endFrame]), [['Create(Circle)', 6, 0, 15], ['Wait', 7, 15, 22], ['Circle.animate.shift', 9, 22, 30]]);
    assert.deepEqual(seen.frames, [...Array(30).keys()]);
    assert.ok(seen.firstFrameBeforeDone);
    assert.ok(seen.logs.includes('hi'));
    assert.deepEqual(seen.done, { frames: 30, duration: 2, width: 854, height: 480, fps: 15 });

    const bad = eng.run('from manim import *\nclass B(Scene):\n    def construct(self):\n        self.play(Create(Circl()))\n');
    let err = null;
    bad.on('error', (e) => { err = e; });
    await bad.done;
    assert.equal(err.type, 'NameError');
    assert.equal(err.line, 4);

    const intro = await eng.introspect('Circle');
    assert.equal(intro.kind, 'class');
    assert.equal(intro.file, 'manim/mobject/geometry/arc.py');
    assert.ok(intro.doc.startsWith('A circle.'));
    const src = await eng.source('Circle');
    assert.ok(src.text.startsWith('class Circle(Arc):'));
    const shim = await eng.source('cairo.Context');
    assert.equal(shim.file, 'py/cairo/__init__.py');
    assert.ok(shim.note && shim.note.includes("'cairo'"));
    // Scene.play has an observer (runtime.install_hooks). The page must name
    // manim's file for manim's source, not the file of the observer.
    const play = await eng.source('Scene.play');
    assert.equal(play.file, 'manim/scene/scene.py');
    assert.ok(play.text.trimStart().startsWith('def play('));
    assert.equal(play.note, null);
    assert.equal((await eng.introspect('Scene.play')).file, 'manim/scene/scene.py');
    // The one replaced function: its own source, a note, and manim's original.
    const tex = await eng.source('manim.utils.tex_file_writing.tex_to_svg_file');
    assert.equal(tex.file, 'py/manimlive/tex.py');
    assert.ok(tex.note);
    assert.equal(tex.original.file, 'manim/utils/tex_file_writing.py');
    assert.ok(tex.original.text.includes('dvisvgm') || tex.original.text.includes('compile_tex'));
    const comp = await eng.complete('from manim import *\nCirc', 2, 4);
    assert.ok(comp.some((c) => c.name === 'Circle'));

    const long = eng.run('from manim import *\nclass L(Scene):\n    def construct(self):\n        self.play(Rotate(Square(), 100), run_time=60)\n');
    let n = 0;
    let cancelErr = null;
    long.on('frame', () => { if (++n === 5) eng.cancel(); });
    long.on('error', (e) => { cancelErr = e; });
    const ls = await long.done;
    assert.equal(ls.ok, false);
    assert.equal(cancelErr.type, 'KeyboardInterrupt');
    assert.ok(n < 100, `${n} frames after cancel`);
    const again = await eng.run(code).done;
    assert.ok(again.ok, 'run after cancel');
  } finally {
    eng.terminate();
  }
});

after(() => {});
