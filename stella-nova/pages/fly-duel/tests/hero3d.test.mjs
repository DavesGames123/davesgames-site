// ============================================================================
//  FLY DUEL  ·  the 3D hero on the page  (node tests/hero3d.test.mjs)
// ----------------------------------------------------------------------------
//  Boots the real index.html and main.js in node with linkedom, with the
//  3D table of ui/fly3d/scene.js in headless mode (no renderer: the user
//  does not allow headless Chrome). A loader hook maps the bare 'three'
//  specifiers of the import map to ../../vendor. window.flyDuelOpts
//  .headless3d is the test seam: main.js then makes the scene with no
//  canvas. The test checks that:
//    - the hero runs the 3D driver, #arena (the 2D stand-in) is hidden
//    - the match moves on only when the scene has played a record, and
//      the cards on the 3D table follow the match state (mirror)
//    - the HUD cards show life and one mana glyph per land with the
//      untapped count of the state
//    - pause, speed, new game, camera and brain controls reach the scene
//    - the triangle count of the hero is under the desktop budget
//    - the saver (saver.js createShow3d) films the duel on its own 3D
//      table: director shots reach the scene camera, plates go out,
//      and the hero waits while the saver runs
//    - no console.error or console.warn
//  Without linkedom the test prints "skipped" and exits 0.
//
//  GREP MAP   (grep -n "^// ---" tests/hero3d.test.mjs)
// ============================================================================
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = new URL('../../../vendor/three@0.160.0/', import.meta.url);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'three') return { url: new URL('build/three.module.js', vendor).href, shortCircuit: true };
    if (spec.startsWith('three/addons/')) return { url: new URL('examples/jsm/' + spec.slice(13), vendor).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log(`  FAIL ${m}`); } };

// --------------------------------------------------------------- linkedom
let linkedom = null;
for (const spec of ['linkedom', '/usr/local/lib/node_modules/openclaw/node_modules/linkedom/esm/index.js']) {
  try { linkedom = await import(spec); break; } catch { /* next */ }
}
if (!linkedom) { console.log('hero3d.test: skipped (linkedom not found)'); process.exit(0); }

// --------------------------------------------------------------- markup
const raw = readFileSync(join(ROOT, 'index.html'), 'utf8');
{
  const head = raw.slice(0, raw.indexOf('</head>'));
  const im = head.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  let map = null; try { map = JSON.parse(im[1]); } catch { /* bad json */ }
  ok(map?.imports?.three === '../../vendor/three@0.160.0/build/three.module.js' && map.imports['three/addons/'] === '../../vendor/three@0.160.0/examples/jsm/', 'markup: the import map gives three r160 from ../../vendor');
  ok(head.indexOf('importmap') < raw.indexOf('main.js"'), 'markup: the import map comes before main.js');
  ok(existsSync(join(ROOT, '../../vendor/three@0.160.0/build/three.module.js')), 'markup: the vendored three.module.js is there');
  const stage = raw.slice(raw.indexOf('id="heroStage"'), raw.indexOf('class="stagebar"'));
  ok(!/not a real fly|not real flies/.test(stage) && !/stage-tag/.test(raw), 'markup: no honesty tag over the 3D view (research content lives in the drawer)');
  const bar = raw.slice(raw.indexOf('class="stagebar"'), raw.indexOf('id="playRoot"'));
  ok(/<span class="honest">[^<]*<span data-wiring>[^<]*<\/span>[^<]*not real flies\.<\/span>/.test(bar), 'markup: one short honesty line at the base of the HUD');
  ok(/<div class="arena" id="arena" hidden>/.test(raw), 'markup: the 2D stand-in starts hidden');
  for (const id of ['heroCv', 'hudBar', 'heroTurn', 'hudA', 'hudB', 'heroCam', 'heroBrains', 'heroPaneA', 'heroPaneB', 'heroBrainA', 'heroBrainB', 'heroMove', 'manaLegGlyphs']) ok(raw.includes(`id="${id}"`), `markup: #${id}`);
  ok(!raw.includes('id="heroMaps"'), 'markup: no close-up maps over the stage (the side panels show the brains)');
}

// --------------------------------------------------------------- globals
const W = linkedom.parseHTML(raw.replace(/<script[^>]*\ssrc=[^>]*><\/script>/g, ''));
const { document } = W;
const errors = [];
const oe = console.error, ow = console.warn, oi = console.info;
console.error = (...a) => errors.push(a.map(x => x && x.stack || String(x)).join(' '));
console.warn = (...a) => errors.push('warn: ' + a.map(x => x && x.stack || String(x)).join(' '));
const infos = []; console.info = (...a) => infos.push(a.map(String).join(' '));
const stub = () => {
  const store = {};
  return new Proxy(function () {}, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === 'then') return undefined;
      if (p in store) return store[p];
      if (p === 'width' || p === 'height' || p === 'length') return 0;
      return stub();
    },
    set(t, p, v) { store[p] = v; return true; },
    apply() { return stub(); },
  });
};
const proto = W.HTMLElement.prototype;
proto.getBoundingClientRect = () => ({ width: 960, height: 600, top: 100, left: 0, right: 960, bottom: 700 });
proto.setPointerCapture = () => {}; proto.scrollTo = () => {}; proto.scrollIntoView = () => {};
(W.HTMLCanvasElement || W.HTMLElement).prototype.getContext = function () { return this.__g ||= stub(); };
const frames = [], winL = {};
Object.assign(globalThis, {
  window: globalThis, document, Node: W.Node, HTMLElement: W.HTMLElement, Event: W.Event,
  innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2,
  flyDuelOpts: { headless3d: true },
  Image: class { set src(v) { this._s = v; setTimeout(() => this.onload?.(), 0); } get src() { return this._s; } decode() { return Promise.resolve(); } },
  Worker: class { postMessage() {} terminate() {} },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  IntersectionObserver: class { constructor(cb) { this.cb = cb; } observe(t) { this.cb([{ target: t, isIntersecting: true }]); } unobserve() {} disconnect() {} },
  ResizeObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame: f => frames.push(f), cancelAnimationFrame() {},
  addEventListener: (t, f) => (winL[t] ||= []).push(f), removeEventListener() {},
  dispatchEvent: e => { (winL[e.type] || []).forEach(f => f(e)); return true; },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  fetch: async p => {
    const f = join(ROOT, String(p).replace(/^\.\//, '').replace(/^file:\/\/.*?\/pages\/fly-duel\//, ''));
    if (!existsSync(f)) return { ok: false, status: 404 };
    const txt = readFileSync(f, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(txt), text: async () => txt };
  },
});
Object.defineProperty(document, 'hidden', { value: false, configurable: true });

// --------------------------------------------------------------- boot
// main.js seeds the hero match from Math.random: a fixed generator makes
// each run of this test the same.
{ let a = 0x5eed1234; Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const t0 = Date.now();
let bootErr = null;
try { await import(pathToFileURL(join(ROOT, 'main.js')).href); } catch (e) { bootErr = e; }
ok(!bootErr, `boot: main.js imports (${bootErr && bootErr.message})`);
await globalThis.flyDuel?.ready;
await new Promise(r => setTimeout(r, 200));
const fd = globalThis.flyDuel, hero = fd.hero;
const $ = id => document.getElementById(id);
const click = el => el.dispatchEvent(new W.Event('click', { bubbles: true }));
let T = 0;
// One rAF frame per task, as in a browser: promise callbacks (the
// scene.play resolve) run between frames.
const pump = async n => { for (let i = 0; i < n; i++) { const fs = frames.splice(0); T += 50; for (const f of fs) f(T); await new Promise(r => setImmediate(r)); } };
const { mirrorOf, mirrorDiff } = await import('../ui/fly3d/choreo.js');

ok(hero.mode === '3d' && !!hero.scene, `hero: the 3D driver runs (mode ${hero.mode}, ${fd.M && Object.keys(fd.M).length} modules)`);
ok($('arena').hidden === true && $('heroStage').hidden === false, 'hero: the stage shows, the 2D stand-in is hidden');
const info = await hero.scene.ready;
ok(info.fly === 'fly.js' && info.brain === true, `hero: the real fly and both brain maps (${JSON.stringify(info)})`);
ok(/pretrained weights/.test($('heroStatus').textContent), `hero: the pretrained flies play (${$('heroStatus').textContent.slice(0, 60)})`);

// --------------------------------------------------------------- the match follows the scene
{
  let drift = 0, checks = 0, early = 0, prevLen = 0;
  for (let i = 0; i < 900; i++) {
    await pump(1);
    const n = hero.match.history.length;
    if (n > prevLen + 1) early++;   // two records started in one frame
    prevLen = n;
    if (!hero.busy && !hero.match.over() && n > 0) {
      checks++;
      const d = mirrorDiff(hero.scene.world.mirror, mirrorOf(hero.match.state));
      if (d.length) { drift++; if (drift < 3) console.log('  drift', d.slice(0, 3)); }
    }
  }
  const n = hero.match.history.length;
  ok(n >= 6, `match: ${n} records in 45 s of frames at speed 1`);
  ok(early === 0, 'match: one record at a time (the next waits for the scene)');
  ok(checks > 5 && drift === 0, `match: the 3D table equals the match state after each record (${checks} checks, ${drift} drift)`);
  ok($('heroLog').children.length > 0 && /Fly [AB]/.test($('heroMove').textContent), `match: the log and the move line (${$('heroMove').textContent.slice(0, 50)})`);
}

// --------------------------------------------------------------- brain panels
// Each fly's panel fires on that fly's own decisions with the real trace
// (ui/fly3d/brainpanels.js, headless here: no renderer, the maps run).
{
  const P = hero.panels;
  ok(!!P, 'panels: the 3D hero has the two brain panels');
  const st = P?.stats();
  ok(st?.contexts === 0, `panels: headless, no WebGL context (${st?.contexts})`);
  const recs = hero.match.history;
  for (const p of [0, 1]) {
    const mine = recs.filter(r => r.who === p && r.trace);
    const last = mine[mine.length - 1];
    const sp = st?.panels?.[p];
    ok(mine.length > 0 && sp?.fires >= mine.length - 1, `panels: Fly ${p ? 'B' : 'A'} panel fired on its decisions (${sp?.fires} fires, ${mine.length} decisions)`);
    if (hero.rec?.who === p || !last) continue;
    ok(sp?.info?.kc === last.trace.kc.length, `panels: Fly ${p ? 'B' : 'A'} lit its own active KCs (${sp?.info?.kc} = ${last.trace.kc.length})`);
    const cap = $(p ? 'heroCapB' : 'heroCapA').textContent;
    ok(new RegExp(`${last.trace.kc.length} of [\\d,]+ KCs active`).test(cap) && /hemibrain|FlyWire/.test(cap), `panels: caption names the wiring and the active KCs (${cap})`);
  }
  ok(P?.panels?.[0]?.map.stats().kc === fd.conOf('A').kc.n && P?.panels?.[1]?.map.stats().kc === fd.conOf('B').kc.n, 'panels: Fly A on its file, Fly B on the FlyWire file');
}

// --------------------------------------------------------------- HUD and mana
{
  const st = hero.match.state, byId = hero.byId;
  for (const [p, id] of [[0, 'hudA'], [1, 'hudB']]) {
    const el = $(id), pl = st.players[p];
    const lands = pl.battlefield.filter(x => byId.get(x.id).type === 'land');
    const up = lands.filter(x => !x.tapped).length;
    const html = el.innerHTML;
    if (!hero.busy) {
      ok(el.querySelector('.life')?.textContent === String(pl.life), `hud ${id}: life ${pl.life}`);
      ok(lands.length === 0 ? /no lands yet/.test(html) : el.querySelector('.mana .n')?.textContent === `${up}/${lands.length}`, `hud ${id}: mana ${up}/${lands.length}`);
      ok(el.querySelectorAll('.mana .m').length === Math.min(12, lands.length), `hud ${id}: one glyph per land`);
      ok(el.querySelectorAll('.mana .m.off').length === Math.min(12, lands.length) - Math.min(up, 12) || lands.length > 12, `hud ${id}: tapped lands are dim`);
    }
    ok(!raw.slice(raw.indexOf('id="heroStage"'), raw.indexOf('class="stagebar"')).includes(`id="${id}"`), `hud ${id}: outside the stage, over no part of the scene`);
    ok(/hand <b>\d+<\/b>/.test(html) && /deck <b>\d+<\/b>/.test(html), `hud ${id}: hand and deck`);
  }
  // hudHTML on a fixed state: two amber lands (one tapped), one moss land
  const { hudHTML } = await import(pathToFileURL(join(ROOT, 'main.js')).href);
  const ids = [...byId.values()];
  const amber = ids.find(c => c.type === 'land' && c.produces === 'amber'), moss = ids.find(c => c.type === 'land' && c.produces === 'moss');
  const fake = { players: [{ life: 4, hand: [1, 2], library: [1, 2, 3], graveyard: [], battlefield: [{ uid: 1, id: amber.id, tapped: true }, { uid: 2, id: moss.id, tapped: false }, { uid: 3, id: amber.id, tapped: false }] }] };
  const h = hudHTML(fake, 0, byId, { acting: true });
  ok(/<span class="n">2\/3<\/span>/.test(h) && (h.match(/class="m off"/g) || []).length === 1, 'hudHTML: 2/3 untapped, one dim glyph');
  ok(h.indexOf('mana-amber') < h.indexOf('mana-moss') && /life low/.test(h) && /choosing/.test(h), 'hudHTML: amber first, low life marked, "choosing"');
  // while a record plays, the box shows the turn before the record
  const turn = hero.busy ? hero.rec.before.turn : st.turn;
  ok(new RegExp(`^Turn ${turn}(?!\\d)`).test($('heroTurn').textContent), `turn box: turn ${turn} (${$('heroTurn').textContent}, busy ${hero.busy})`);
  ok(/mana-amber/.test($('manaLegGlyphs').innerHTML) && /mana-moss/.test($('manaLegGlyphs').innerHTML), 'mana legend: the glyphs');
}

// --------------------------------------------------------------- controls
{
  const segBtn = (id, v) => [...$(id).querySelectorAll('button')].find(b => b.dataset.v === v);
  click(segBtn('heroCam', 'wide'));
  ok(hero.scene.stats().camera === 'wide' && hero.scene.stats().shot === 'wide', 'controls: camera "wide" holds the wide shot');
  await pump(60);
  ok(hero.scene.stats().shot === 'wide', 'controls: no cut while the camera is "wide"');
  click(segBtn('heroCam', 'free'));
  ok(hero.scene.stats().camera === 'free', 'controls: camera "free"');
  click(segBtn('heroCam', 'auto'));
  ok(hero.scene.stats().camera === 'auto', 'controls: camera "director"');
  ok($('app').dataset.brains === 'panels' && hero.scene.stats().brainsShown === false, 'controls: the side panels show the brains, the hall maps hide (one place per brain)');
  click(segBtn('heroBrains', 'off'));
  ok(hero.scene.stats().brainsShown === false && $('app').dataset.brains === 'off', 'controls: brains hidden');
  click(segBtn('heroBrains', 'scene'));
  ok(hero.scene.stats().brainsShown === true && $('app').dataset.brains === 'scene', 'controls: brains beside the flies in the hall, no panels');
  click(segBtn('heroBrains', 'panels'));
  ok(hero.scene.stats().brainsShown === false && $('app').dataset.brains === 'panels', 'controls: back to the side panels');
  click(segBtn('heroSpeed', '3'));
  ok(hero.speed === 3, 'controls: speed 3');
  click($('heroPlay'));
  ok(hero.playing === false && $('heroPlay').textContent === 'Play', 'controls: pause');
  const n0 = hero.match.history.length;
  await pump(200);
  ok(hero.match.history.length === n0, 'controls: no new record while paused');
  click($('heroPlay'));
  await pump(200);
  ok(hero.match.history.length > n0, `controls: play goes on (${n0} -> ${hero.match.history.length})`);
  click($('heroNew'));
  ok(hero.match.history.length === 0 && $('heroLog').children.length === 0, 'controls: new game empties the history');
  const s = hero.scene.stats();
  ok(s.hand[0] + s.hand[1] === hero.match.state.players[0].hand.length + hero.match.state.players[1].hand.length && s.perms === 0, `controls: new game resets the table (hands ${s.hand})`);
  ok(s.tris < 400000, `budget: hero scene ${s.tris} triangles < 400k`);
  console.log(`  hero3d: ${s.meshes} meshes, ${s.tris} triangles, ${s.cards} cards`);
}

// --------------------------------------------------------------- whole game
{
  const bannersAtStart = hero.scene.stats().banners;
  let guard = 0;
  while (!hero.match.over() && guard++ < 6000) await pump(10);
  ok(!!hero.match.over(), `game: a whole game ends (${hero.match.history.length} records)`);
  // The last record can be a long lethal combat (many strikes, the hold
  // after a big play, the win): wait until the scene has played it.
  for (let k = 0; k < 400 && hero.busy; k++) await pump(1);
  await pump(2);
  const over = hero.match.over();
  ok(/wins|draw|loses/.test($('hudA').textContent + $('hudB').textContent), 'game: the HUD names the result');
  ok(over && /wins|Draw/.test($('heroTurn').textContent) && !/wins|Draw/.test($('heroStatus').textContent), `game: the turn box names the result, the status line does not (${$('heroTurn').textContent})`);
  // one voice on the 3D table: no turn banner, one big panel at the end
  const st = hero.scene.stats();
  ok(st.banners === bannersAtStart + 1, `game: one big banner in the whole game, the result (${st.banners - bannersAtStart})`);
  await pump(200);
  ok(hero.match.history.length < 20 && !hero.match.over(), 'game: a new game starts after the hold');
}

// --------------------------------------------------------------- saver on the 3D table
{
  const SV = await import(pathToFileURL(join(ROOT, 'saver.js')).href);
  const ev = (kind, at) => ({ kind, n: 1, who: 1, event: { kind, at, card: 'x' } });
  ok(JSON.stringify(SV.camShot({ ...ev('card', 10), kind: 'card' }, 11)) === '["close",1]', 'saver: a fresh card shot is a close-up');
  ok(SV.camShot({ ...ev('card', 10), kind: 'card' }, 13)[0] === 'over', 'saver: a late card shot looks over the shoulder');
  ok(SV.camShot({ kind: 'combat', who: 0 })[0] === 'combat' && SV.camShot({ kind: 'duo', who: 0 })[0] === 'wide' && SV.camShot(null)[0] === 'wide', 'saver: combat and duo shots');
  ok(Object.keys(SV.SHOT_3D).sort().join() === [...SV.IDLE, ...new Set(Object.values(SV.EVENT_SHOT))].filter((k, i, a) => a.indexOf(k) === i).sort().join(), 'saver: SHOT_3D covers every shot kind of the director');
  const sv = globalThis.snSaver;
  ok(!!sv, 'saver: window.snSaver installed');
  const labels = [];
  const n0 = hero.match.history.length, seed0 = hero.match.seed;
  const res = sv.enter({ seed: 7, calm: 0.5, label: p => labels.push(p) });
  ok(res?.canvas?.id === 'fdSaverCv' && document.getElementById('fdSaverCv') === res.canvas, 'saver: enter gives a canvas in the document');
  await new Promise(r => setTimeout(r, 300));
  await pump(600);
  const d = sv.debug();
  console.log(`  saver 3d: ${d.n} shots, ${d.games} games, ${labels.length} plates in ${d.now} s, camera ${d.camera}`);
  ok(d.mode === '3d', `saver: the show plays on the 3D table (${JSON.stringify({ mode: d.mode, err: d.err })})`);
  ok(d.n >= 2 && d.games >= 1, `saver: 30 s give shots (${d.n} shots, ${d.games} games, now ${d.now})`);
  ok(['wide', 'over', 'close', 'combat', 'win'].includes(d.camera), `saver: the scene camera takes the director shot (${d.camera})`);
  ok(labels.length >= 10 && labels.every(p => p.title && /turn \d+/.test(p.sub)), `saver: plates with live numbers (${labels.length})`);
  const pw = JSON.parse(readFileSync(join(ROOT, 'data/pretrained.json'), 'utf8')).wiring;
  if (pw?.B?.id === 'flywire') ok(labels.every(p => p.lines.some(l => /Fly B FlyWire/.test(l))) && !labels.some(p => p.lines.some(l => /A model on hemibrain/.test(l))), 'saver: the plate names the wiring of each fly');
  const a = labels[labels.length - 1].anchor();
  ok(a && Number.isFinite(a.x) && Number.isFinite(a.y) && a.lead === false, 'saver: the anchor gives a box');
  ok(hero.match.history.length === n0 && hero.match.seed === seed0, 'saver: the hero match waits while the saver runs');
  sv.exit();
  ok(globalThis.__fdSaver === false && !document.getElementById('fdSaverCv'), 'saver: exit removes the canvas and clears the flag');
  await pump(100);
  // a game in its end hold starts a new game (new seed), else it goes on
  ok(hero.match.history.length > n0 || hero.match.seed !== seed0, `saver: the hero goes on after exit (${n0} -> ${hero.match.history.length})`);
}

// --------------------------------------------------------------- end
console.error = oe; console.warn = ow; console.info = oi;
ok(errors.length === 0, `page: no console.error or console.warn (${errors.length}): ${errors.slice(0, 3).join(' | ').slice(0, 600)}`);
console.log(`hero3d.test: ${pass} pass, ${fail} fail (${Date.now() - t0} ms)`);
process.exit(fail ? 1 : 0);
