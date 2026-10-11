// ============================================================================
//  UI TESTS  ·  pure helpers of the IDE, in node (no browser)
// ----------------------------------------------------------------------------
//  Run:  node --test stella-nova/pages/manim-live/tests/ui.test.mjs
//  Covers: timeline mapping, URL share round trip, catalog filter and
//  header read, Markdown and docstring rendering, code reads, the lesson
//  check, Python highlight, and the seed examples' headers.
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSegments, segmentAtFrame, frameForLine, linesWithSegments, formatTime } from '../ui/timeline.js';
import { encodeShare, decodeShare, b64urlEncode, b64urlDecode } from '../ui/share.js';
import { normalise, filterCatalog, topicsOf, parseHeader } from '../ui/catalog.js';
import { renderMarkdown, renderInline, escapeHtml } from '../ui/markdown.js';
import { rstToHtml, refName } from '../ui/rst.js';
import { guessScenes, animationLines, dottedAt, tracebackLines } from '../ui/pysource.js';
import { highlightPython } from '../ui/pyhighlight.js';
import { checkStep } from '../ui/learn.js';
import { SEEDS } from '../ui/seed-examples.js';
import { REPLACED } from '../ui/hood.js';
import { shortFile } from '../ui/reference.js';

const ANIMS = [
  { index: 1, name: 'Transform', line: 12, runTime: 1, startFrame: 15, endFrame: 30 },
  { index: 0, name: 'Create', line: 11, runTime: 1, startFrame: 0, endFrame: 15 },
  { index: 2, name: 'Wait', line: 13, runTime: 0.5, startFrame: 30 },
];

test('timeline: segments are sorted and a missing endFrame is filled', () => {
  const s = buildSegments(ANIMS, 38, 15);
  assert.deepEqual(s.map(x => x.name), ['Create', 'Transform', 'Wait']);
  assert.equal(s[2].endFrame, 38);
  assert.equal(s[1].t0, 1);
  assert.equal(s[1].t1, 2);
});

test('timeline: frame -> segment, line -> frame', () => {
  const s = buildSegments(ANIMS, 38, 15);
  assert.equal(segmentAtFrame(s, 0).name, 'Create');
  assert.equal(segmentAtFrame(s, 14).name, 'Create');
  assert.equal(segmentAtFrame(s, 15).name, 'Transform');
  assert.equal(segmentAtFrame(s, 37).name, 'Wait');
  assert.equal(segmentAtFrame(s, 38), null);
  assert.equal(segmentAtFrame(s, -1), null);
  assert.equal(frameForLine(s, 12), 15);
  assert.equal(frameForLine(s, 99), -1);
  assert.deepEqual([...linesWithSegments(s)].sort(), [11, 12, 13]);
});

test('timeline: a gap before the first animation gives null', () => {
  const s = buildSegments([{ name: 'A', line: 3, startFrame: 10, endFrame: 20 }], 20, 10);
  assert.equal(segmentAtFrame(s, 5), null);
  assert.equal(segmentAtFrame(s, 10).name, 'A');
});

test('timeline: zero-length segment still gets one frame', () => {
  const s = buildSegments([{ name: 'A', startFrame: 4, endFrame: 4 }], 0, 10);
  assert.equal(s[0].endFrame, 5);
});

test('timeline: formatTime', () => {
  assert.equal(formatTime(0), '0:00.0');
  assert.equal(formatTime(61.25), '1:01.3');
  assert.equal(formatTime(NaN), '0:00.0');
});

test('share: base64url round trip of all byte values', () => {
  const b = new Uint8Array(256).map((_, i) => i);
  assert.deepEqual(b64urlDecode(b64urlEncode(b)), b);
  assert.doesNotMatch(b64urlEncode(b), /[+/=]/);
});

test('share: code, scene and quality survive the URL hash', async () => {
  const code = 'from manim import *\n\nclass A(Scene):\n    def construct(self):\n        self.play(Write(MathTex(r"\\int_0^1 x\\,dx = \\tfrac12")))  # ünïcødé π\n';
  const hash = await encodeShare({ code, scene: 'A', quality: 'medium' });
  assert.match(hash, /^#code=z[\w-]+&scene=A&q=medium$/);
  const back = await decodeShare(hash);
  assert.equal(back.code, code);
  assert.equal(back.scene, 'A');
  assert.equal(back.quality, 'medium');
});

test('share: deflate makes long code shorter, and bad input gives null', async () => {
  const code = 'self.play(Create(Circle()))\n'.repeat(200);
  const hash = await encodeShare({ code });
  assert.ok(hash.length < code.length / 5, `hash ${hash.length} chars`);
  assert.equal(await decodeShare(''), null);
  assert.equal(await decodeShare('#foo=1'), null);
  assert.equal(await decodeShare('#code=zNOT_DEFLATE'), null);
  assert.equal((await decodeShare('#code=u' + b64urlEncode(new TextEncoder().encode('x = 1')))).code, 'x = 1');
});

const CAT = [
  { id: 'calc-riemann', file: 'calc-riemann.py', title: 'Riemann sums', topic: 'Calculus', level: 1, scene: 'RiemannSums', summary: 'Area under a curve.', concepts: ['Axes', 'get_riemann_rectangles', 'ValueTracker'] },
  { id: 'la-matrix', file: 'la-matrix.py', title: 'Matrix as a map', topic: 'Linear algebra', level: 2, scene: 'M', summary: 'A matrix moves the grid.', concepts: 'NumberPlane, ApplyMatrix' },
  { id: 'calc-taylor', title: 'Taylor series', topic: 'Calculus', level: '3', summary: 'Polynomials that hug a curve.', concepts: [] },
  { title: 'Broken entry' },
].map(normalise);

test('catalog: normalise fills fields and splits concepts', () => {
  assert.deepEqual(CAT[1].concepts, ['NumberPlane', 'ApplyMatrix']);
  assert.equal(CAT[2].level, 3);
  assert.equal(CAT[3].topic, 'Other');
  assert.equal(CAT[3].level, 1);
});

test('catalog: filter by topic, level and words', () => {
  assert.equal(filterCatalog(CAT, {}).length, 4);
  assert.deepEqual(filterCatalog(CAT, { topic: 'Calculus' }).map(e => e.id), ['calc-riemann', 'calc-taylor']);
  assert.deepEqual(filterCatalog(CAT, { level: 2 }).map(e => e.id), ['la-matrix']);
  assert.deepEqual(filterCatalog(CAT, { query: 'valuetracker' }).map(e => e.id), ['calc-riemann']);
  assert.deepEqual(filterCatalog(CAT, { query: 'grid matrix' }).map(e => e.id), ['la-matrix']);
  assert.deepEqual(filterCatalog(CAT, { query: 'grid curve' }), []);
  assert.deepEqual(topicsOf(CAT), [{ topic: 'Calculus', count: 2 }, { topic: 'Linear algebra', count: 1 }, { topic: 'Other', count: 1 }]);
});

test('catalog: parseHeader reads the example header and stops at code', () => {
  const h = parseHeader('# title: Riemann sums\n# topic: Calculus\n# level: 1\n# scene: RiemannSums\n# concepts: Axes, ValueTracker\nfrom manim import *\n# note: not header\n');
  assert.equal(h.title, 'Riemann sums');
  assert.equal(h.scene, 'RiemannSums');
  assert.deepEqual(h.concepts, ['Axes', 'ValueTracker']);
  assert.equal(h.note, undefined);
});

test('seeds: every seed has a header that matches its fields and a scene class', () => {
  for (const s of SEEDS) {
    const h = parseHeader(s.code);
    assert.equal(h.scene, s.scene, s.id);
    assert.equal(h.title, s.title, s.id);
    assert.ok(guessScenes(s.code).includes(s.scene), s.id);
    assert.match(s.code, /^from manim import \*$/m);
  }
});

test('markdown: escapes HTML and keeps TeX for MathJax', () => {
  const h = renderMarkdown('# Title\n\nArea is $\\int_a^b f(x)\\,dx$ and <script>x</script>.\n\n- one `Circle()`\n- **two**\n\n$$\nx^2\n$$');
  assert.match(h, /<h2>Title<\/h2>/);
  assert.match(h, /data-tex="\\int_a\^b f\(x\)\\,dx"/);
  assert.match(h, /&lt;script&gt;/);
  assert.doesNotMatch(h, /<script>/);
  assert.match(h, /<ul><li>one <code>Circle\(\)<\/code><\/li><li><strong>two<\/strong><\/li><\/ul>/);
  assert.match(h, /md-tex-display" data-tex="x\^2"/);
});

test('markdown: code fences use the code hook, links are safe', () => {
  const h = renderMarkdown('```python\nx = 1\n```\n[ok](https://docs.manim.community) [bad](javascript:alert(1))', { code: t => `<b>${t}</b>` });
  assert.match(h, /<pre class="md-code"><code><b>x = 1<\/b><\/code><\/pre>/);
  assert.match(h, /href="https:\/\/docs.manim.community"/);
  assert.doesNotMatch(h, /javascript:/);
  assert.equal(renderInline('a *b* c'), 'a <em>b</em> c');
  assert.equal(escapeHtml('<"&\'>'), '&lt;&quot;&amp;&#39;&gt;');
});

test('rst: numpydoc sections, roles, and manim examples', () => {
  const doc = `A circle.

    Parameters
    ----------
    radius : float
        The radius of the :class:\`~.Circle\`.
    color
        The colour. See :meth:\`.Mobject.set_color\`.

    Examples
    --------
    .. manim:: CircleExample
        :save_last_frame:

        class CircleExample(Scene):
            def construct(self):
                self.add(Circle())

    >>> Circle().radius
    1.0
    `;
  const { html, examples } = rstToHtml(doc);
  assert.match(html, /<h4 class="rst-h">Parameters<\/h4>/);
  assert.match(html, /<dt><code>radius<\/code> <span class="rst-type">float<\/span><\/dt>/);
  assert.match(html, /data-ref="Circle">Circle<\/code>/);
  assert.match(html, /data-ref="Mobject.set_color"/);
  assert.equal(examples.length, 1);
  assert.equal(examples[0].scene, 'CircleExample');
  assert.match(examples[0].code, /^from manim import \*\n\nclass CircleExample\(Scene\):\n    def construct/);
  assert.match(html, /rst-doctest/);
  assert.equal(refName('~.Mobject.shift()'), 'Mobject.shift');
});

test('pysource: scenes, play lines, dotted names, traceback frames', () => {
  const code = 'from manim import *\nclass A(Scene):\n  def construct(self):\n    self.play(Create(Circle()))\n    # self.play(x)\n    self.wait()\nclass B(ThreeDScene): pass\nclass Helper(VGroup): pass\nclass C(MovingCameraScene, Other): pass\n';
  assert.deepEqual(guessScenes(code), ['A', 'B', 'C']);
  assert.deepEqual(animationLines(code), [4, 6]);
  assert.equal(dottedAt('    sq.set_fill(BLUE)', 8), 'sq.set_fill');
  assert.equal(dottedAt('Axes.plot(f)', 1), 'Axes');
  assert.equal(dottedAt('x = Circle(radius=1)', 6), 'Circle');
  assert.equal(dottedAt('x = (1)', 4), '');
  const tb = 'Traceback (most recent call last):\n  File "/lib/python3.13/site-packages/manim/scene/scene.py", line 237, in render\n  File "<scene>", line 4, in construct\nNameError: name \'Circl\' is not defined';
  assert.deepEqual(tracebackLines(tb).map(f => [f.line, f.user]), [[237, false], [4, true]]);
});

test('learn: checkStep forms', () => {
  const code = 'self.play(Create(Circle()))';
  assert.equal(checkStep({}, code).ok, null);
  assert.equal(checkStep({ check: 'Create\\(' }, code).ok, true);
  assert.equal(checkStep({ check: { contains: ['Circle', 'Square'] } }, code).ok, false);
  assert.equal(checkStep({ check: { animations: 2 } }, code, { animations: ['Create', 'Wait'] }).ok, true);
  assert.equal(checkStep({ check: { animations: 1 } }, code, { animations: ['Create'], error: { type: 'X' } }).ok, false);
  assert.equal(checkStep({ check: (c, r) => r.frames > 0 }, code, { frames: 3 }).ok, true);
  assert.equal(checkStep({ check: () => 'Add a Square.' }, code).message, 'Add a Square.');
});

test('pyhighlight: tokens get classes and text is escaped', () => {
  const h = highlightPython('def f(x):\n    return "<a>" # c');
  assert.match(h, /<span class="tok-keyword">def<\/span>/);
  assert.match(h, /&lt;a&gt;/);
  assert.match(h, /tok-comment/);
  assert.equal(h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'), 'def f(x):\n    return "<a>" # c');
});

test('hood: the five replaced native modules, and file names', () => {
  assert.deepEqual(REPLACED.map(r => r.mod), ['cairo', 'manimpango', 'pathops', 'mapbox_earcut', 'av']);
  assert.equal(shortFile('/lib/python3.13/site-packages/manim/mobject/geometry/arc.py'), 'manim/mobject/geometry/arc.py');
});
