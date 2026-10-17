// ============================================================================
//  TENSOR CALCULUS  ·  tests/saver.test.mjs  (SAVER)
// ----------------------------------------------------------------------------
//  node stella-nova/pages/tensor-calculus/tests/saver.test.mjs
//  Checks the saver with no browser: the shot catalog (every shot names a
//  VIZ scene, a LIBRARY entry with a trace, and real code), the seeded plan
//  (the same per seed, different across seeds, no subject twice in a row,
//  the 'all' rotation), the hold times, pickWindow, the framing maths for
//  16:9 and 9:16, the label payload (and its TeX in MathJax when
//  mathjax-full is on NODE_PATH or MATHJAX_DIR), and enter / exit of
//  window.snSaver on a stub DOM with a stub page.
//
//  SECTIONS   (grep -n "^section(" tests/saver.test.mjs)
// ============================================================================
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0, current = '';
const pending = [];
function section(name) { current = name; }
function check(name, fn) {
  const label = `${current} :: ${name}`;
  pending.push(() => Promise.resolve().then(fn).then(() => { pass++; }, e => { fail++; console.log('FAIL ' + label + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n     ')); }));
}
async function drain() { while (pending.length) await pending.shift()(); }

const D = await import(join(ROOT, 'saver/director.js'));
const LIB = await import(join(ROOT, 'library/index.js'));
const REG = await import(join(ROOT, 'viz/registry.js'));
const { SAVER_SHOTS } = await import(join(ROOT, 'viz/shots.js'));
const { installSaver } = await import(join(ROOT, 'saver/index.js'));
const CAT = D.buildCatalog(LIB, SAVER_SHOTS);

// ---------------------------------------------------------------- catalog
section('catalog');
check('every kind and every channel has shots', () => {
  for (const k of D.KINDS) assert.ok(CAT.some(s => s.kind === k), 'no shot of kind ' + k);
  for (const c of D.CHANNELS) assert.ok(D.shotsOf(CAT, c).length >= 10, `channel ${c} has ${D.shotsOf(CAT, c).length} shots`);
  assert.equal(new Set(CAT.map(s => s.key)).size, CAT.length, 'shot keys are unique');
  console.log(`     catalog: ${CAT.length} shots; ` + D.KINDS.map(k => `${k} ${CAT.filter(s => s.kind === k).length}`).join(', ') +
    '; channels ' + D.CHANNELS.map(c => `${c} ${D.shotsOf(CAT, c).length}`).join(', '));
});
check('every 3D shot names a VIZ scene with known params and a camera', () => {
  for (const s of CAT.filter(x => x.layout === 'viz')) {
    assert.ok(REG.SCENE_IDS.includes(s.scene), s.key + ': no scene ' + s.scene);
    const keys = REG.sceneInfo(s.scene).params.map(p => p.key);
    for (const k of Object.keys(s.params || {})) assert.ok(keys.includes(k), `${s.key}: param ${k} not in ${keys}`);
    assert.ok(s.camera && s.camera.pos.length === 3 && s.camera.target.length === 3, s.key + ': camera');
    assert.ok(s.tex.length >= 1 && s.tex.every(t => typeof t === 'string' && t.length), s.key + ': tex');
  }
  // every VIZ saver shot is in the catalog, and every scene but the
  // step-only components block has a shot
  assert.equal(CAT.filter(s => s.kind === 'orbit').length, SAVER_SHOTS.length);
  const seen = new Set(CAT.filter(x => x.layout === 'viz').map(s => s.scene));
  for (const id of REG.SCENE_IDS) if (id !== 'components') assert.ok(seen.has(id), 'no shot of scene ' + id);
});
check('every entry shot names a LIBRARY entry whose trace has steps', () => {
  const entries = CAT.filter(s => s.entry);
  assert.equal(entries.length, LIB.LIBRARY.length);
  let steps = 0;
  for (const s of entries) {
    const e = LIB.getEntry(s.entry);
    assert.ok(e, 'no entry ' + s.entry);
    const tr = e.trace();
    assert.ok(tr.steps.length >= 1, s.entry + ': no steps');
    for (const st of tr.steps) assert.ok(st.after && typeof st.after.tex === 'string', `${s.entry} ${st.id}: no after.tex`);
    steps += tr.steps.length;
  }
  console.log(`     ${entries.length} entry shots, ${steps} trace steps`);
});
check('every code reference is a real block of tensor/ or viz/', () => {
  const refs = { ...D.CODE_SCENE, ...D.CODE_KIND };
  for (const [k, [file, marker]] of Object.entries(refs)) {
    assert.ok(/^(tensor|viz)\//.test(file), k + ': ' + file);
    assert.ok(existsSync(join(ROOT, file)), k + ': no file ' + file);
    const text = D.extractBlock(read(file), marker);
    assert.ok(text, `${k}: marker "${marker}" not in ${file}`);
    const lines = text.split('\n');
    assert.ok(lines[0].startsWith(marker) && lines.length >= 3 && lines.length <= 12, `${k}: ${lines.length} lines`);
  }
  for (const s of CAT) if (!s.entry) assert.ok(D.codeRef(s, null), s.key + ': no code');
  for (const k of ['contract', 'raise', 'christoffel', 'covariant', 'evaluate']) assert.deepEqual(D.codeRef({ entry: 'x' }, { kind: k }), D.CODE_KIND[k]);
});
check('extractBlock stops at the closing brace and cuts long blocks', () => {
  const src = 'a\nexport function f(x) {\n  return x;\n}\nmore';
  assert.equal(D.extractBlock(src, 'export function f'), 'export function f(x) {\n  return x;\n}');
  const long = 'export function g() {\n' + Array.from({ length: 30 }, (_, i) => `  x${i}();`).join('\n') + '\n}\n';
  const cut = D.extractBlock(long, 'export function g').split('\n');
  assert.equal(cut.length, 12); assert.match(cut[11], /\/\/ …$/);
  assert.equal(D.extractBlock(src, 'nope'), null);
});

// ---------------------------------------------------------------- plan
section('plan');
const keys = p => p.map(s => s.key).join('|');
check('the same seed gives the same plan', () => {
  for (const ch of D.CHANNELS) {
    const a = D.buildPlan(CAT, { seed: 1234, channel: ch, calm: 0.7 }), b = D.buildPlan(CAT, { seed: 1234, channel: ch, calm: 0.7 });
    assert.equal(keys(a), keys(b), ch);
    assert.deepEqual(a.map(s => s.hold), b.map(s => s.hold), ch + ' holds');
  }
});
check('different seeds give different plans', () => {
  for (const ch of D.CHANNELS) {
    const firsts = new Set();
    for (let seed = 1; seed <= 20; seed++) firsts.add(D.buildPlan(CAT, { seed, channel: ch }).slice(0, 6).map(s => s.key).join('|'));
    assert.ok(firsts.size >= 19, `${ch}: ${firsts.size} distinct openings of 20`);
  }
});
check('a plan holds every shot of its channel, 5 to 12 s', () => {
  for (const ch of D.CHANNELS) for (const seed of [3, 99, 777]) for (const calm of [0, 0.7, 1]) {
    const p = D.buildPlan(CAT, { seed, channel: ch, calm });
    // a channel: each shot once; 'all': each shot once or more (a short
    // channel comes round again while the long ones play out)
    if (ch === 'all') assert.equal(new Set(p.map(s => s.key)).size, CAT.length);
    else { assert.equal(p.length, D.shotsOf(CAT, ch).length); assert.equal(new Set(p.map(s => s.key)).size, p.length); }
    for (const s of p) assert.ok(s.hold >= 5 && s.hold <= 12, `${s.key} hold ${s.hold}`);
  }
});
check('no subject twice in a row, also across two plans', () => {
  let n = 0;
  for (const ch of D.CHANNELS) for (let seed = 1; seed <= 30; seed++) {
    const a = D.buildPlan(CAT, { seed, channel: ch });
    const b = D.buildPlan(CAT, { seed: seed + 1000, channel: ch, avoid: a[a.length - 1].subject });
    const all = a.concat(b);
    for (let i = 1; i < all.length; i++) { assert.notEqual(all[i].subject, all[i - 1].subject, `${ch} seed ${seed} at ${i}: ${all[i].subject}`); n++; }
  }
  console.log(`     ${n} cuts checked`);
});
check("'all' rotates the four channels in blocks", () => {
  for (const seed of [5, 6, 7]) {
    const p = D.buildPlan(CAT, { seed, channel: 'all' });
    const first8 = p.slice(0, 8).map(s => s.channel);
    assert.equal(new Set(first8).size, 4, `seed ${seed}: ${first8}`);
    for (let i = 0; i < 8; i += D.ROTATE_BLOCK) assert.equal(new Set(first8.slice(i, i + D.ROTATE_BLOCK)).size, 1, `seed ${seed} block ${i}: ${first8}`);
  }
  const orders = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(seed => D.buildPlan(CAT, { seed, channel: 'all' }).slice(0, 8).map(s => s.channel).filter((c, i, a) => a.indexOf(c) === i).join(',')));
  assert.ok(orders.size >= 3, 'channel orders: ' + [...orders].join(' / '));
});
check('pickWindow fits the end of a derivation in the hold', () => {
  const tl = ms => { let t = 0; return ms.map((m, index) => { const r = { index, start: t, motion: m, hold: 900 }; t += m + 900; return r; }); };
  const short = tl([1800, 1800, 1800]);           // 8.1 s
  assert.deepEqual(D.pickWindow(short, 10000), { step: 0, speed: 1, steps: 3 });
  assert.deepEqual(D.pickWindow(short, 20000), { step: 0, speed: 0.5, steps: 3 });
  const long = tl([5000, 5000, 5000, 5000, 5000, 5000]);   // 35.4 s
  const w = D.pickWindow(long, 9000);
  assert.ok(w.steps >= 3 && w.speed === 2, JSON.stringify(w));
  const end = 6 * 5900;
  assert.ok((end - long[w.step].start) / w.speed <= 9000);
  assert.deepEqual(D.pickWindow([], 9000), { step: 0, speed: 1, steps: 0 });
  // the real traces: every entry ends inside a 9 s hold
  for (const e of LIB.LIBRARY) {
    const t = tl(e.trace().steps.map(s => s.ms || 2400));
    const x = D.pickWindow(t, 9000 * 0.95), tot = t[t.length - 1].start + t[t.length - 1].motion + 900;
    assert.ok((tot - t[x.step].start) / x.speed <= 9000 * 0.95 + 1, e.id);
  }
});

// ---------------------------------------------------------------- framing
section('framing');
const FRAMES = [
  ['16:9', 1920, 1080, [{ t: 250, b: 310, w: 1920 }, { t: 180, b: 420, w: 1920 }, { t: 120, b: 160, w: 1920 }, null]],
  ['16:9 small', 1280, 720, [{ t: 170, b: 200, w: 1280 }, null]],
  ['9:16', 608, 1080, [{ t: 300, b: 330, w: 608 }, { t: 380, b: 420, w: 608 }, { t: 200, b: 260, w: 608 }, null]],
  ['9:16 column in a wide window', 1920, 1080, [{ t: 300, b: 330, w: 608 }]],
];
check('a 3D subject sits in the middle of the clear band', () => {
  for (const [name, W, H, bands] of FRAMES) for (const b of bands) {
    const f = D.frameFor(W, H, b, 'viz'), box = D.clearBox(W, H, b);
    assert.deepEqual(f.stage, { top: 0, left: 0, right: 0, bottom: 0 });
    // viz setViewOffset(x, y) moves the picture up by y: the frame centre lands at H/2 - y
    assert.ok(Math.abs(H / 2 - f.offset.y - box.cy) <= 0.5, `${name}: centre ${H / 2 - f.offset.y} vs ${box.cy}`);
    assert.ok(Math.abs(W / 2 - f.offset.x - box.cx) <= 0.5, `${name}: x centre`);
    assert.ok(f.dist >= 0.85 && f.dist <= 1.8, `${name}: dist ${f.dist}`);
    assert.ok(f.anchor.r * 2 <= D.FILL * Math.min(box.w, box.h) + 1, `${name}: subject ${2 * f.anchor.r} in box ${box.w}x${box.h}`);
    assert.ok(f.anchor.r * 2 >= 0.25 * Math.min(box.w, box.h), `${name}: subject too small`);
    assert.ok(box.y >= 0 && box.y + box.h <= H + 0.5 && box.h >= 0.3 * H - 0.5, `${name}: box`);
  }
});
check('a pane shot puts the stage in the clear band; 9:16 stacks a pair', () => {
  assert.equal(D.stackPair(608, 450), true); assert.equal(D.stackPair(1920, 520), false); assert.equal(D.stackPair(608, 324), false);
  for (const [name, W, H, bands] of FRAMES) for (const b of bands) {
    const f = D.frameFor(W, H, b, 'pair'), box = D.clearBox(W, H, b);
    assert.ok(Math.abs(f.stage.top - box.y) <= 0.5 && Math.abs(H - f.stage.bottom - (box.y + box.h)) <= 1, name + ' vertical');
    assert.ok(Math.abs(f.stage.left - box.x) <= 0.5 && Math.abs(W - f.stage.right - (box.x + box.w)) <= 1, name + ' horizontal');
    assert.deepEqual(f.offset, { x: 0, y: 0 });
    assert.equal(f.tall, D.stackPair(box.w, box.h), name);
    if (!name.startsWith('9:16')) assert.equal(f.tall, false, name + ' should sit side by side');
  }
});
check('the camera of a shot: yaw keeps the distance, a push-in ends nearer', () => {
  const s = { ...CAT.find(x => x.kind === 'push'), yaw: 0.4, spin: -1 };
  const len = c => Math.hypot(...c.pos.map((v, i) => v - c.target[i]));
  const a = D.cameraFor(s, 1, 'start'), b = D.cameraFor(s, 1, 'end'), base = len(s.camera);
  assert.ok(len(a) > base && len(b) < base, `${len(a)} ${base} ${len(b)}`);
  const o = { ...CAT.find(x => x.kind === 'orbit'), yaw: 0.3, spin: -0.7 };
  assert.ok(Math.abs(len(D.cameraFor(o, 1.2)) - 1.2 * len(o.camera)) < 1e-9);
  assert.ok(D.cameraFor(o, 1).orbit < 0, 'spin -1 orbits the other way');
});

// ---------------------------------------------------------------- label
section('label');
function findMathJax() {
  const dirs = [process.env.MATHJAX_DIR, process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(':')].filter(Boolean);
  for (const d of dirs) for (const base of [join(d, 'x.js'), join(d, '..', 'x.js')]) {
    try {
      const req = createRequire(base);
      const { mathjax } = req('mathjax-full/js/mathjax.js');
      const { TeX } = req('mathjax-full/js/input/tex.js');
      const { SVG } = req('mathjax-full/js/output/svg.js');
      const { liteAdaptor } = req('mathjax-full/js/adaptors/liteAdaptor.js');
      const { RegisterHTMLHandler } = req('mathjax-full/js/handlers/html.js');
      req('mathjax-full/js/input/tex/AllPackages.js');
      const adaptor = liteAdaptor(); RegisterHTMLHandler(adaptor);
      // the packages of lib/sci-math.js: base, ams (autoload) and html, color
      const doc = mathjax.document('', { InputJax: new TeX({ packages: ['base', 'ams', 'html', 'color', 'noundefined'], formatError: (jax, err) => { throw err; } }), OutputJax: new SVG({ fontCache: 'none' }) });
      return tex => { const out = adaptor.outerHTML(doc.convert(tex, { display: true })); if (/data-mjx-error|merror|fill="red"/.test(out)) throw new Error('TeX error in ' + tex); return out; };
    } catch (e) { /* next */ }
  }
  return null;
}
const mj = findMathJax();
function labels() {
  const out = [];
  for (const s of CAT) {
    if (s.entry) {
      const tr = LIB.getEntry(s.entry).trace();
      out.push([s, D.labelFor(s, { channel: 'all' })]);
      tr.steps.forEach((st, i) => out.push([s, D.labelFor(s, { step: st, index: i, count: tr.steps.length, trace: tr, channel: 'derivations', style: 'birdtrack', slotOf: () => i, code: { name: 'tensor/tensor.js · contract', text: 'x' } })]));
    } else out.push([s, D.labelFor(s, { reads: { s: 1.4, pair: 2.1, beta: 0.5, holonomy: 3.14, K: 1, nope: 4 }, anchor: { x: 9, y: 9, r: 4 }, code: { name: 'n', text: 't' } })]);
  }
  return out;
}
check('every label has the plate shape', () => {
  const L = labels();
  for (const [s, info] of L) {
    const tag = s.key;
    assert.ok(typeof info.title === 'string' && info.title.length > 1, tag + ' title');
    assert.equal(typeof info.sub, 'string', tag + ' sub');
    assert.ok(Array.isArray(info.tex) && info.tex.length >= 1 && info.tex.every(t => typeof t === 'string' && t.length), tag + ' tex');
    assert.ok(Array.isArray(info.rules) && info.rules.every(r => Array.isArray(r) && typeof r[0] === 'string' && /^m[1-6]$/.test(r[1])), tag + ' rules');
    assert.ok(Array.isArray(info.params) && info.params.every(p => typeof p.sym === 'string' && typeof p.name === 'string' && typeof p.value === 'string' && /^m[1-6]$/.test(p.cls)), tag + ' params');
    assert.ok(info.params.length <= 4, tag + ' params count');
    assert.ok(Array.isArray(info.lines) && info.lines.every(x => typeof x === 'string'), tag + ' lines');
    assert.ok(Array.isArray(info.eq) && info.eq.length === info.tex.length, tag + ' eq');
    for (const t of info.tex) {
      let d = 0; for (const c of t.replace(/\\[{}]/g, '')) { if (c === '{') d++; if (c === '}') d--; assert.ok(d >= 0, tag + ' braces ' + t); }
      assert.equal(d, 0, tag + ' braces ' + t);
      for (const m of t.matchAll(/\\class\{([^}]*)\}/g)) assert.match(m[1], /^m[1-6]$/, tag + ' class ' + m[1]);
    }
    if (s.entry && !info.params.length) assert.equal(info.code, undefined, tag + ' no code before the trace');
    else assert.ok(info.code && info.code.lang === 'js' && info.code.text, tag + ' code');
  }
  // live numbers: the reads table picks known keys only
  const viz = L.find(([s]) => s.scene === 'upper-lower')[1];
  assert.deepEqual(viz.params.map(p => p.name), ['basis stretch', 'pairing', 'boost speed', 'holonomy']);
  assert.deepEqual(viz.anchor, { x: 9, y: 9, r: 4 });
  // a step label: the live TeX is the step result with index colours
  const st = L.find(([s, i]) => s.entry === 'riemann-tensor' && i.params.length)[1];
  assert.match(st.tex[0], /\\class\{m[1-6]\}/);
  assert.equal(st.params[0].name, 'step');
  console.log(`     ${L.length} labels checked`);
});
check('index colours: one plate class per letter, no two letters share one', () => {
  const m = D.mClassMap(['mu', 'nu', 'rho', 'sigma', 'lambda', 'kappa'], s => ({ mu: 0, nu: 1, rho: 2, sigma: 3, lambda: 4, kappa: 5 })[s]);
  assert.equal(new Set(m.values()).size, 6);
  assert.equal(m.get('mu'), 'm1'); assert.equal(m.get('nu'), 'm2');
  const t = D.colourTex('R^\\rho{}_{\\sigma\\mu\\nu} = e^{x}', D.mClassMap(['rho', 'sigma', 'mu', 'nu']));
  assert.match(t, /\\class\{m\d\}\{\\rho\}/);
  assert.ok(t.endsWith('= e^{x}'), 'a letter that is not an index stays plain: ' + t);
});
if (mj) check('every label TeX typesets in MathJax (html, color)', () => {
  const seen = new Set();
  for (const [, info] of labels()) for (const t of info.tex) if (!seen.has(t)) { seen.add(t); mj(t); }
  for (const p of labels().flatMap(([, i]) => i.params)) if (!seen.has(p.sym)) { seen.add(p.sym); mj(p.sym); }
  console.log(`     mathjax: ${seen.size} TeX strings typeset`);
});
else console.log('SKIP  MathJax typeset: mathjax-full not on NODE_PATH or MATHJAX_DIR');

// ---------------------------------------------------------------- enter / exit
section('enter-exit');
function stubDom() {
  const all = [];
  const mk = (tag, id) => {
    const cls = new Set(), props = {};
    const el = {
      tagName: tag.toUpperCase(), id: id || '', children: [], parent: null, textContent: '',
      get isConnected() { let n = this; while (n.parent) n = n.parent; return n === root; },
      classList: { add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)), toggle: (c, on) => { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); }, contains: c => cls.has(c), get list() { return [...cls]; } },
      style: { props, setProperty: (k, v) => { props[k] = v; }, removeProperty: k => { delete props[k]; } },
      appendChild(c) { c.parent = this; this.children.push(c); return c; },
    };
    all.push(el);
    return el;
  };
  const root = mk('html'), head = root.appendChild(mk('head')), body = root.appendChild(mk('body'));
  body.appendChild(mk('main', 'stage')).appendChild(mk('canvas', 'vizCanvas'));
  const doc = { documentElement: root, head, body, createElement: t => mk(t), getElementById: id => all.find(e => e.id === id && e.isConnected) || null, contains: e => e.isConnected };
  return { doc, root, head };
}
function stubPage(entryId = 'riemann-tensor') {
  const log = [];
  const S = { entryId, layout: { views: ['tex', 'viz', 'diagram'], mode: 'all', style: 'network' }, scene: { id: 'curvature-loop', params: { d: 0.3 } }, vizFree: false, trace: null };
  let steps = [], pos = { index: 0, t: 0, playing: true, speed: 1.5 };
  const player = {
    load(tr) { steps = tr.steps; pos = { ...pos, index: 0, t: 0, playing: false }; },
    steps: () => steps, position: () => ({ ...pos }),
    timeline() { let t = 0; return steps.map((s, index) => { const r = { index, start: t, motion: s.ms || 2400, hold: 900 }; t += r.motion + 900; return r; }); },
    seek(i, t = 0) { pos.index = i; pos.t = t; log.push(['seek', i, t]); }, play() { pos.playing = true; log.push(['play']); },
    pause() { pos.playing = false; log.push(['pause']); }, setSpeed(s) { pos.speed = s; log.push(['speed', s]); },
  };
  const setTime = function (s) { log.push(['time', s]); };
  const viz = {
    saverShots: SAVER_SHOTS, setTime,
    setShot: (shot, ms) => log.push(['setShot', shot.scene, ms, shot.camera]), setCamera: (c, ms) => log.push(['setCamera', ms, c]),
    setViewOffset: (x, y) => log.push(['offset', x, y]), setOrbit: d => log.push(['orbit', d]), resize: () => {},
    readouts: () => ({ beta: 0.4, holonomy: 1.2 }), sceneInfo: id => REG.sceneInfo(id),
  };
  const listeners = new Set();
  const openEntry = (id, params, o) => {
    log.push(['openEntry', id, o]);
    const e = LIB.getEntry(id); if (!e) return Promise.reject(new Error('no entry ' + id));
    S.entryId = id; S.trace = e.trace(); player.load(S.trace);
    for (const fn of listeners) fn({ index: 0, step: S.trace.steps[0] });
    return Promise.resolve({ id });
  };
  const api = {
    openEntry, playTrace: tr => { log.push(['playTrace']); return Promise.resolve(); },
    setScene: (id, p) => { log.push(['setScene', id, p]); S.vizFree = true; return Promise.resolve(); },
    on: (ev, fn) => { if (ev === 'step') listeners.add(fn); return () => listeners.delete(fn); },
  };
  const internals = {
    store: S, player, views: { viz, diagram: { resize() {} } }, packages: { library: { entries: LIB.LIBRARY } },
    layout: { set: spec => { log.push(['layout', spec]); return Promise.resolve(); } },
    setFree: f => { S.vizFree = f; log.push(['free', f]); }, palette: { indexSlot: () => 0 },
  };
  return { api, internals, log, S, viz, setTime, listeners, pos: () => pos };
}
async function runSaver({ W = 1920, H = 1080, band = { t: 250, b: 300, w: W }, seed = 42, channel, seconds = 75 } = {}) {
  const dom = stubDom(), page = stubPage();
  let clock = 0, timer = null;
  const labels = [];
  const win = { innerWidth: W, innerHeight: H, location: { hash: '', search: '' }, document: dom.doc };
  const saver = installSaver(page.api, page.internals, {
    win, doc: dom.doc, now: () => clock, plateBand: () => band,
    setInterval: fn => { timer = fn; return 1; }, clearInterval: () => { timer = null; },
    loadText: f => Promise.resolve(read(f)),
  });
  const res = win.snSaver.enter({ seed, calm: 0.7, seconds: 60, label: x => labels.push(x), channel });
  const cuts = [];
  let last = null;
  for (; clock < seconds * 1000; clock += 250) {
    await new Promise(r => setImmediate(r));
    if (timer) timer();
    const d = saver.debug();
    if (d && d.shot && d.shot.key !== last) { cuts.push({ at: clock, key: d.shot.key, kind: d.shot.kind, hold: d.shot.hold }); last = d.shot.key; }
  }
  await new Promise(r => setImmediate(r));
  return { dom, page, saver, win, res, labels, cuts, clock: () => clock, timer: () => timer };
}
check('enter hides the page UI, returns the canvas in the document and starts the plan', async () => {
  const r = await runSaver();
  assert.ok(r.res.canvas && r.res.canvas.id === 'vizCanvas' && r.dom.doc.contains(r.res.canvas), 'canvas in the document');
  assert.ok(r.res.warmupMs >= 0);
  assert.ok(r.dom.root.classList.contains('sn-saver') && r.dom.root.classList.contains('tc-saver'));
  const style = r.dom.head.children.find(c => c.id === 'tcSaverStyle');
  assert.ok(style && /#panel/.test(style.textContent) && /#player/.test(style.textContent) && /\.pane-head/.test(style.textContent), 'saver CSS hides the page chrome');
  assert.ok(r.cuts.length >= 6, `${r.cuts.length} shots in 75 s`);
  for (let i = 1; i < r.cuts.length; i++) {
    const gap = (r.cuts[i].at - r.cuts[i - 1].at) / 1000;
    assert.ok(gap >= 5 && gap <= 12.5, `cut ${i} after ${gap} s`);
  }
  assert.ok(new Set(r.cuts.map(c => c.kind)).size >= 3, 'kinds: ' + r.cuts.map(c => c.kind));
  console.log('     seed 42, all: ' + r.cuts.map(c => `${c.kind}:${c.key.replace(/^[a-z]+:/, '')}@${(c.at / 1000).toFixed(1)}s`).join(' '));
  r.win.snSaver.exit();
});
check('each shot drives the page: 3D shots go free with framing, entry shots play a window', async () => {
  const r = await runSaver({ seed: 9 });
  const L = r.page.log;
  const shots = L.filter(x => x[0] === 'setShot'), entries = L.filter(x => x[0] === 'openEntry');
  assert.ok(shots.length >= 1 && entries.length >= 1, `setShot ${shots.length}, openEntry ${entries.length}`);
  for (const s of shots) assert.ok(REG.SCENE_IDS.includes(s[1]), s[1]);
  for (const e of entries) { assert.ok(LIB.getEntry(e[1]), e[1]); assert.equal(e[2].noHash, true); }
  assert.ok(L.some(x => x[0] === 'free' && x[1] === true), 'a 3D shot frees the 3D view');
  const fr = D.frameFor(1920, 1080, { t: 250, b: 300, w: 1920 }, 'viz');
  assert.ok(L.some(x => x[0] === 'offset' && x[1] === fr.offset.x && x[2] === fr.offset.y), 'setViewOffset ' + JSON.stringify(fr.offset));
  assert.ok(L.some(x => x[0] === 'speed') && L.some(x => x[0] === 'play'), 'entry shots set a speed and play');
  const lay = L.filter(x => x[0] === 'layout').map(x => JSON.stringify(x[1]));
  assert.ok(lay.some(x => x === '"viz"') && lay.some(x => /diagram/.test(x)), 'layouts ' + [...new Set(lay)].join(' '));
  r.win.snSaver.exit();
});
check('the labels carry live TeX, params and a real code extract', async () => {
  const r = await runSaver({ seed: 9 });
  const real = r.labels.filter(Boolean);
  assert.ok(real.length >= 6);
  const withCode = real.filter(x => x.code && x.code.text);
  assert.ok(withCode.length >= real.length / 2, `${withCode.length} of ${real.length} labels have code`);
  for (const x of withCode) {
    const [file] = x.code.name.split(' · ');
    assert.ok(read(file).includes(x.code.text.split('\n')[0]), 'code from ' + file);
  }
  assert.ok(real.every(x => x.tex.length && x.anchor && x.anchor.r > 0));
  r.win.snSaver.exit();
  assert.equal(r.labels[r.labels.length - 1], null, 'exit clears the plate');
});
check('exit restores the page', async () => {
  const r = await runSaver({ seed: 11, seconds: 30 });
  const before = r.page.viz.setTime;
  assert.notEqual(before, r.page.setTime, 'the scene clock is slower in saver mode');
  r.page.viz.setTime(10); r.page.viz.setTime(20);
  const t = r.page.log.filter(x => x[0] === 'time').slice(-2).map(x => x[1]);
  assert.ok(t[1] - t[0] > 4 && t[1] - t[0] < 10, 'clock rate ' + (t[1] - t[0]) / 10);
  r.page.log.length = 0;
  await r.win.snSaver.exit();
  const L = r.page.log;
  assert.equal(r.page.viz.setTime, r.page.setTime, 'setTime is the original again');
  assert.ok(!r.dom.root.classList.contains('tc-saver') && !r.dom.root.classList.contains('sn-saver'));
  assert.deepEqual(Object.keys(r.dom.root.style.props), []);
  assert.ok(L.some(x => x[0] === 'offset' && x[1] === 0 && x[2] === 0), 'view offset back to 0');
  assert.ok(L.some(x => x[0] === 'orbit' && x[1] === 0), 'orbit off');
  assert.deepEqual(L.find(x => x[0] === 'layout')[1], { views: ['tex', 'viz', 'diagram'], style: 'network' });
  const oe = L.find(x => x[0] === 'openEntry');
  assert.ok(oe && oe[1] === 'riemann-tensor', 'the reader entry opens again');
  assert.ok(L.some(x => x[0] === 'speed' && x[1] === 1.5), 'the reader speed');
  assert.ok(L.some(x => x[0] === 'setCamera' && x[1] === 900), 'the scene camera');
  assert.equal(r.timer(), null, 'the timer stops');
  assert.equal(r.saver.active, false);
});
check('the same seed plays the same shots; another seed differs', async () => {
  const a = await runSaver({ seed: 2024, seconds: 50 }); a.win.snSaver.exit();
  const b = await runSaver({ seed: 2024, seconds: 50 }); b.win.snSaver.exit();
  const c = await runSaver({ seed: 2025, seconds: 50 }); c.win.snSaver.exit();
  const k = r => r.cuts.map(x => x.key).join('|');
  assert.equal(k(a), k(b));
  assert.notEqual(k(a), k(c));
});
check('a channel from opts or the URL holds only its shots; 9:16 frames too', async () => {
  for (const ch of ['geometry', 'relativity', 'notation', 'derivations']) {
    const r = await runSaver({ seed: 5, channel: ch, seconds: 40, W: 608, H: 1080, band: { t: 300, b: 330, w: 608 } });
    const own = new Set(D.shotsOf(CAT, ch).map(s => s.key));
    assert.ok(r.cuts.every(c => own.has(c.key)), ch + ': ' + r.cuts.map(c => c.key));
    assert.equal(r.saver.debug().channel, ch);
    const fr = r.saver.debug().frame;
    assert.ok(fr.box.w === 608 && fr.box.h === 450, ch + ' box ' + JSON.stringify(fr.box));
    r.win.snSaver.exit();
  }
  // from the URL: #saver=relativity
  const dom = stubDom(), page = stubPage();
  const win = { innerWidth: 1280, innerHeight: 720, location: { hash: '#entry=x&saver=relativity', search: '' }, document: dom.doc };
  installSaver(page.api, page.internals, { win, doc: dom.doc, now: () => 0, plateBand: () => null, setInterval: () => 1, clearInterval: () => {}, loadText: () => Promise.resolve(null) });
  win.snSaver.enter({ seed: 1 });
  assert.equal(win.snSaver.debug().channel, 'relativity');
  assert.deepEqual(win.snSaver.channels, ['all', 'geometry', 'relativity', 'notation', 'derivations']);
  assert.equal(win.snSaver.setChannel('notation'), true);
  assert.equal(win.snSaver.debug().channel, 'notation');
  await win.snSaver.exit();
});
check('a missing entry skips to the next shot', async () => {
  const dom = stubDom(), page = stubPage();
  let clock = 0, timer = null;
  const win = { innerWidth: 1280, innerHeight: 720, location: { hash: '', search: '' }, document: dom.doc };
  page.api.openEntry = () => Promise.reject(new Error('gone'));
  const saver = installSaver(page.api, page.internals, { win, doc: dom.doc, now: () => clock, plateBand: () => null, setInterval: fn => { timer = fn; return 1; }, clearInterval: () => {}, loadText: () => Promise.resolve(null) });
  saver.enter({ seed: 3, channel: 'derivations' });
  const first = saver.debug().shot.key;
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  clock += 250; timer();
  assert.notEqual(saver.debug().shot.key, first, 'the saver cut at once');
  saver.exit();
});

await drain();
console.log(`${pass} passed, ${fail} failed (saver tests; no browser ran)`);
process.exit(fail ? 1 : 0);
