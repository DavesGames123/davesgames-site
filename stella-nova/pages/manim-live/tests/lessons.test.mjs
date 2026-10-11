// ============================================================================
//  MANIM LIVE  ·  tests/lessons.test.mjs  (node --test tests/lessons.test.mjs)
// ----------------------------------------------------------------------------
//  Part 1 (no Python): the shape of lessons/index.js. Lesson and step
//  fields, ids, step counts, the scene class in each code, and a check
//  that ui/learn.js checkStep can read.
//  Part 2 (needs MANIM_LIVE_CACHE, see tools/node-env.mjs; skipped without):
//  the Python ast module in Pyodide parses the code of each step, and
//  finds the scene class at the top level of the module.
//  The full render of each step is not in this test (about 40 s). Use
//  tools/render.mjs on each step for that.
// ============================================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test, before } from 'node:test';

import { LESSONS } from '../lessons/index.js';
import { checkStep } from '../ui/learn.js';

const HAVE_CACHE = !!(process.env.MANIM_LIVE_CACHE && fs.existsSync(path.join(process.env.MANIM_LIVE_CACHE, 'node_modules', 'pyodide')));
const NEED = HAVE_CACHE ? {} : { skip: 'MANIM_LIVE_CACHE is not set (see tools/node-env.mjs)' };

const steps = () => LESSONS.flatMap((l) => l.steps.map((s, i) => ({ l, s, i, key: `${l.id}/${i}` })));

// ---------------------------------------------------------------- part 1 --

test('lessons: 10 to 12 lessons, unique ids, levels 1..3, 3 to 6 steps each', () => {
  assert.ok(Array.isArray(LESSONS));
  assert.ok(LESSONS.length >= 10 && LESSONS.length <= 12, `${LESSONS.length} lessons`);
  const ids = LESSONS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate lesson id');
  for (const l of LESSONS) {
    assert.match(l.id, /^[a-z0-9-]+$/, l.id);
    assert.equal(typeof l.title, 'string');
    assert.ok(l.title.length > 0);
    assert.ok([1, 2, 3].includes(l.level), `${l.id} level`);
    assert.ok(typeof l.blurb === 'string' && l.blurb.length > 10, `${l.id} blurb`);
    assert.ok(l.steps.length >= 3 && l.steps.length <= 6, `${l.id}: ${l.steps.length} steps`);
  }
});

test('lessons: each step has title, md, code, scene, task and hint', () => {
  for (const { s, key } of steps()) {
    for (const f of ['title', 'md', 'code', 'scene', 'task', 'hint']) {
      assert.equal(typeof s[f], 'string', `${key}.${f}`);
      assert.ok(s[f].trim().length > 0, `${key}.${f} is empty`);
    }
    assert.match(s.scene, /^[A-Z]\w*$/, `${key}.scene`);
    assert.ok(s.code.startsWith('from manim import *\n'), `${key}: code must start with "from manim import *"`);
    assert.match(s.code, new RegExp(`^class ${s.scene}\\((\\w*Scene)\\):`, 'm'), `${key}: no class ${s.scene}(...Scene)`);
    assert.ok(!/\t/.test(s.code), `${key}: tab in code`);
    assert.ok(s.md.length < 1200, `${key}: md is ${s.md.length} chars, keep it short`);
  }
});

test('lessons: each check is a form that checkStep reads, and it does not throw', () => {
  for (const { s, key } of steps()) {
    assert.ok(s.check !== undefined, `${key}: no check`);
    const c = s.check;
    if (typeof c === 'string') assert.doesNotThrow(() => new RegExp(c, 'm'), key);
    else assert.ok(Array.isArray(c.contains) || Number.isFinite(c.animations) || typeof c.regex === 'string', `${key}: check form`);
    const r = checkStep(s, s.code, { scenes: [s.scene], animations: [], frames: 1, error: null });
    assert.ok(r.ok === true || r.ok === false, `${key}: checkStep gave ${JSON.stringify(r)}`);
    assert.equal(r.message, '', `${key}: checkStep message ${r.message}`);
  }
});

test('lessons: a regex check fails on the starting code when the task asks for a change', () => {
  // A task that the starting code already passes teaches nothing. Steps with
  // an {animations} check, or a check on a line the task keeps, are exempt.
  const keep = new Set(['updaters/0']);
  for (const { s, key } of steps()) {
    if (typeof s.check !== 'string' || keep.has(key)) continue;
    assert.ok(!new RegExp(s.check, 'm').test(s.code), `${key}: the starting code already passes ${s.check}`);
  }
});

test('lessons: the track covers the planned topics, in order', () => {
  const want = ['first-scene', 'positioning', 'styling', 'animations', 'animate-syntax', 'text-and-latex',
    'axes-and-graphs', 'updaters', 'camera', 'three-d', 'inside-manim', 'capstone'];
  assert.deepEqual(LESSONS.map((l) => l.id), want);
  const all = steps().map(({ s }) => s.code).join('\n');
  for (const name of ['Scene', 'VGroup', 'Transform', 'ReplacementTransform', 'TransformMatchingTex', 'MathTex', 'Tex(',
    'Axes', 'ValueTracker', 'always_redraw', 'add_updater', 'MovingCameraScene', 'ThreeDScene', 'Surface', 'CubicBezier',
    'LaggedStart', 'Succession', 'AnimationGroup', 'rate_func', 'z_index']) {
    assert.ok(all.includes(name), `no step uses ${name}`);
  }
});

// ---------------------------------------------------------------- part 2 --

let rt = null;
before(async () => {
  if (!HAVE_CACHE) return;
  const { createNodeRuntime } = await import('../tools/node-env.mjs');
  rt = await createNodeRuntime();
});

test('python ast: every step parses, and its scene class is at the top level', NEED, () => {
  const py = rt.pyodide;
  py.runPython(`
import ast, json
def _lesson_parse(code, scene):
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return json.dumps({"ok": False, "error": f"{e.msg} (line {e.lineno})"})
    classes = [n.name for n in tree.body if isinstance(n, ast.ClassDef)]
    star = any(isinstance(n, ast.ImportFrom) and n.module == "manim" and n.names[0].name == "*" for n in tree.body)
    return json.dumps({"ok": scene in classes and star, "classes": classes, "star": star})
`);
  const parse = py.globals.get('_lesson_parse');
  try {
    for (const { s, key } of steps()) {
      const r = JSON.parse(parse(s.code, s.scene));
      assert.ok(r.ok, `${key}: ${JSON.stringify(r)}`);
    }
  } finally {
    parse.destroy();
  }
});
