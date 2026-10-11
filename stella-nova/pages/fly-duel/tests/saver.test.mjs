// ============================================================================
//  FLY DUEL  ·  node tests for the screensaver  (node tests/saver.test.mjs)
// ----------------------------------------------------------------------------
//  Package F. No browser (the user does not allow headless Chrome). Parts:
//    classify   decision records -> events (cast, lethal, block, burst)
//    director   shot lengths in [SHOT_MIN, SHOT_MAX], event cuts only after
//               SHOT_MIN, determinism, a different order per seed, no idle
//               kind twice in a row
//    pace/plate pacing bounds; every plate has a title, live numbers, no
//               code extract and no trademark words
//    show       the real rules, connectome and flies (pretrained weights
//               when data/pretrained.json is there) for 300 simulated
//               seconds; every shot kind draws on a fake 2D context with
//               finite numbers, at a desktop band and at a phone band
//    hook       window.snSaver.enter / exit on a small fake DOM
//  Exit code 1 on any failure.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

// ---------------------------------------------------------------- fake 2D context
// Records calls; any non-finite number argument is an error.
function fakeCtx(stats = { n: 0, bad: 0, badCalls: [] }) {
  let px = 10;
  const fn = name => (...a) => {
    stats.n++;
    for (const v of a) if (typeof v === 'number' && !Number.isFinite(v)) { stats.bad++; if (stats.badCalls.length < 5) stats.badCalls.push(`${name}(${a.join(',')})`); }
  };
  const target = {
    measureText: s => ({ width: String(s).length * px * 0.55 }),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  return new Proxy(target, {
    get(t, k) { if (k in t) return t[k]; if (k === 'canvas') return { width: 300, height: 150 }; return fn(String(k)); },
    set(t, k, v) { if (k === 'font') { const m = /(\d+)px/.exec(v); if (m) px = +m[1]; } if (typeof v === 'number' && !Number.isFinite(v)) stats.bad++; t[k] = v; return true; },
  });
}
const fakeCanvas = stats => ({ width: 0, height: 0, style: {}, getContext: () => fakeCtx(stats), remove() {} });

// ---------------------------------------------------------------- fake DOM (before the import)
const appended = [], frames = [];
const fakeEl = tag => ({ tagName: tag, id: '', style: {}, textContent: '', width: 0, height: 0, getContext: () => fakeCtx(domStats), remove() { const i = appended.indexOf(this); if (i >= 0) appended.splice(i, 1); } });
const domStats = { n: 0, bad: 0, badCalls: [] };
Object.assign(globalThis, {
  window: globalThis, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2,
  document: { createElement: fakeEl, head: { appendChild: e => appended.push(e) }, body: { appendChild: e => appended.push(e) } },
  requestAnimationFrame: f => { frames.push(f); return frames.length; }, cancelAnimationFrame() {},
  dispatchEvent() { return true; }, Image: class { constructor() { this.complete = true; this.naturalWidth = 100; } }, Event: class { constructor(t) { this.type = t; } },
});

const SV = await import('../saver.js');
const { classify, createDirector, paceFor, plateFor, createShow, SHOT_MIN, SHOT_MAX, IDLE, PRIORITY, EVENT_SHOT } = SV;

// ---------------------------------------------------------------- classify
{
  const byId = new Map([['bug', { id: 'bug', type: 'creature', power: 3, toughness: 2 }], ['zap', { id: 'zap', type: 'spell' }]]);
  const st = { players: [{ life: 20, battlefield: [{ uid: 1, id: 'bug', pp: 0 }, { uid: 2, id: 'bug', pp: 1 }] }, { life: 7, battlefield: [] }] };
  const kinds = r => classify(r, { byId, burstAt: 0.5 }).map(e => e.kind).join(',');
  ok(kinds({ i: 0, who: 0, action: { type: 'pass' }, before: st }) === '', 'classify: a pass gives no event');
  ok(kinds({ i: 0, who: 0, action: { type: 'cast', card: 'bug' }, before: st }) === 'creature', 'classify: a creature cast');
  ok(kinds({ i: 0, who: 0, action: { type: 'cast', card: 'zap', target: 'p1' }, before: st }) === 'spell', 'classify: a spell cast');
  ok(kinds({ i: 0, who: 0, action: { type: 'attack', attackers: [1] }, before: st }) === 'attack', 'classify: 3 power into 7 life is an attack');
  ok(kinds({ i: 0, who: 0, action: { type: 'attack', attackers: [1, 2] }, before: st }) === 'lethal', 'classify: 3 + 4 power into 7 life is lethal (pump counts)');
  ok(kinds({ i: 0, who: 0, action: { type: 'attack', attackers: [] }, before: st }) === '', 'classify: no attackers, no event');
  const b1 = classify({ i: 0, who: 1, action: { type: 'block', blocks: [[1, 9]] } }, { byId })[0];
  const b2 = classify({ i: 0, who: 1, action: { type: 'block', blocks: [[1, 9], [2, 8]] } }, { byId })[0];
  ok(b1.kind === 'block' && b2.kind === 'block' && b2.pri > b1.pri && b1.who === 1, 'classify: a double block ranks over a single one, the blocker is who');
  ok(kinds({ i: 0, who: 0, action: { type: 'pass' }, delta: -0.6 }) === 'burst', 'classify: |delta| over the bar is a burst');
  ok(kinds({ i: 0, who: 0, action: { type: 'pass' }, delta: 0.4 }) === '', 'classify: |delta| under the bar is not');
  ok(classify(null).length === 0 && classify({}).length === 0, 'classify: a bad record gives nothing');
  ok(Object.values(EVENT_SHOT).every(k => ['win', 'combat', 'card', 'brain'].includes(k)) && Object.keys(EVENT_SHOT).every(k => PRIORITY[k] > 0), 'classify: every event has a shot and a priority');
}

// ---------------------------------------------------------------- director
function runDirector(seed, calm, evAt = () => [], T = 400, dt = 0.1) {
  const d = createDirector({ seed, calm }), shots = [];
  for (let t = dt; t <= T; t += dt) {
    const r = d.tick(+t.toFixed(4), evAt(t));
    if (r.changed) shots.push({ t, kind: r.shot.kind, len: r.shot.len, ev: r.shot.event && r.shot.event.kind });
  }
  return shots;
}
{
  const s = runDirector(7, 0.7);
  const gaps = s.slice(1).map((x, i) => x.t - s[i].t);
  ok(s.every(x => x.len >= SHOT_MIN && x.len <= SHOT_MAX), 'director: every planned length is in [5, 12] s');
  ok(gaps.every(gp => gp >= SHOT_MIN - 1e-6 && gp <= SHOT_MAX + 0.11), `director: idle cuts every 5-12 s (${Math.min(...gaps).toFixed(1)}-${Math.max(...gaps).toFixed(1)})`);
  ok(s.slice(1).every((x, i) => x.kind !== s[i].kind), 'director: no idle kind twice in a row');
  ok(IDLE.every(k => s.some(x => x.kind === k)), 'director: every idle kind shows');
  ok(JSON.stringify(runDirector(7, 0.7)) === JSON.stringify(s), 'director: the same seed gives the same shots');
  const orders = new Set(Array.from({ length: 12 }, (_, i) => runDirector(1000 + i, 0.7, undefined, 40).map(x => x.kind).join(',')));
  ok(orders.size >= 6, `director: 12 seeds give ${orders.size} different orders`);
  const lens = new Set(runDirector(3, 0.7).map(x => x.len.toFixed(2)));
  ok(lens.size > 5, 'director: shot lengths vary');
  // events: a lethal at 2 s waits until SHOT_MIN, then cuts to combat
  const e1 = runDirector(5, 0.5, t => (Math.abs(t - 2) < 0.05 ? [{ kind: 'lethal', pri: PRIORITY.lethal, who: 1 }] : []), 30);
  ok(e1[1] && e1[1].kind === 'combat' && Math.abs(e1[1].t - SHOT_MIN) < 0.11 && e1[1].ev === 'lethal', `director: a lethal attack cuts to combat at ${e1[1] && e1[1].t.toFixed(2)} s`);
  // a creature cast (low priority) does not cut early; it is the next shot
  const e2 = runDirector(5, 0.5, t => (Math.abs(t - 2) < 0.05 ? [{ kind: 'creature', pri: PRIORITY.creature, who: 0 }] : []), 30);
  ok(e2[1] && e2[1].kind === 'card' && e2[1].t >= e2[0].len - 0.11, 'director: a creature cast waits for the end of the shot');
  // a stale event (older than the pending window) does not cut
  const e3 = runDirector(5, 0.5, t => (Math.abs(t - 0.5) < 0.05 ? [{ kind: 'creature', pri: PRIORITY.creature, who: 0 }] : []), 30);
  const first = runDirector(5, 0.5, undefined, 30);
  ok(e3[1] && e3[1].t - 0.5 > 6 && e3[1].kind === first[1].kind, `director: an event older than 6 s is dropped (cut at ${e3[1] && e3[1].t.toFixed(1)} s)`);
  const e5 = runDirector(5, 0.5, t => (Math.abs(t - 3) < 0.05 ? [{ kind: 'creature', pri: PRIORITY.creature, who: 0 }] : []), 30);
  ok(e5[1] && e5[1].kind === 'card', 'director: the same event 2.5 s later is still fresh at the cut');
  // a constant stream of events: cuts never closer than SHOT_MIN
  const e4 = runDirector(9, 0.2, t => (Math.round(t * 10) % 7 === 0 ? [{ kind: 'attack', pri: PRIORITY.attack, who: (t | 0) & 1 }] : []), 200);
  const g4 = e4.slice(1).map((x, i) => x.t - e4[i].t);
  ok(g4.every(gp => gp >= SHOT_MIN - 1e-6) && g4.some(gp => gp < 6), 'director: with many events, cuts come at SHOT_MIN and not sooner');
  let run3 = 0, worst = 0;
  for (const x of e4) { run3 = x.ev ? run3 + 1 : 0; worst = Math.max(worst, run3); }
  ok(worst <= 2 && e4.some(x => !x.ev), `director: weak events make at most 2 event shots in a row (${worst})`);
  const e6 = runDirector(9, 0.2, t => (Math.round(t * 10) % 7 === 0 ? [{ kind: 'lethal', pri: PRIORITY.lethal, who: 0 }] : []), 100);
  ok(e6.slice(1).every(x => x.ev === 'lethal'), 'director: strong events cut through the variety rule');
}

// ---------------------------------------------------------------- pace and plate
{
  const ps = [{ type: 'pass' }, { type: 'attack', attackers: [] }, { type: 'land', card: 'x' }, { type: 'cast', card: 'x' }, { type: 'attack', attackers: [1] }];
  for (const calm of [0, 0.5, 1]) {
    const v = ps.map(a => paceFor(a, calm));
    ok(v.every(x => x > 0.2 && x < 3) && v[0] < v[2] && v[2] < v[3], `pace: calm ${calm} gives ${v.map(x => x.toFixed(2)).join(' ')}`);
  }
  ok(paceFor({ type: 'pass' }, 0.5, true) >= 4, 'pace: the end of a match holds');
  const snap = { life: [14, 3], turn: 9, kc: [{ on: 88, live: 1750 }, { on: 90, live: 1750 }], trained: true, kinds: ['fly', 'fly'], card: { name: 'Flare Spit', text: 'Deal 2 damage.' }, over: { winner: 1, reason: 'life' } };
  const TM = /magic|gathering|wizards|planeswalker|tapped out|mtg/i;
  for (const kind of ['table', 'duo', 'values', 'brain', 'combat', 'card', 'win']) {
    for (const ev of [null, { kind: 'burst', delta: -0.2, who: 1 }, { kind: 'lethal', who: 0 }]) {
      const p = plateFor({ kind, who: ev ? ev.who : 0, event: ev }, snap);
      const all = JSON.stringify(p);
      ok(p.title && p.sub.includes('14') && p.sub.includes('3 life') && p.sub.includes('turn 9'), `plate ${kind}: title and live numbers`);
      ok(!('code' in p) && !TM.test(all), `plate ${kind}: no code extract, no trademark words`);
      ok(p.lines.length <= 4 && p.lines.some(l => /5\.0%|5\.1%/.test(l)) && p.lines.some(l => /not a real fly/.test(l)), `plate ${kind}: KC sparsity and the model line`);
      ok(Array.isArray(p.tex) && Array.isArray(p.eq), `plate ${kind}: TeX with a plain fallback`);
    }
  }
  ok(/Fly B wins/.test(plateFor({ kind: 'win', who: 1 }, snap).title), 'plate: the win title names the winner');
  ok(/Flare Spit/.test(plateFor({ kind: 'card', who: 0, event: { kind: 'spell', card: 'flare-spit' } }, snap).title), 'plate: the card title names the card');
  ok(/PPL1/.test(plateFor({ kind: 'brain', who: 1, event: { kind: 'burst', delta: -0.2, who: 1 } }, snap).lines[0]), 'plate: a negative burst names PPL1');
  ok(/Untrained/.test(plateFor({ kind: 'table' }, { ...snap, trained: false }).lines.join()), 'plate: untrained flies are named as such');
  ok(/greedy bot/.test(plateFor({ kind: 'table' }, { ...snap, kinds: ['fly', 'bot'] }).lines.join()), 'plate: a stand-in bot is named');
}

// ---------------------------------------------------------------- show (real modules)
const rules = await import('../game/rules.js');
const cards = await import('../game/cards.js');
const bots = await import('../game/bots.js');
const { Fly } = await import('../brain/fly.js');
const C = JSON.parse(readFileSync(join(ROOT, 'data/connectome.json'), 'utf8'));
let pre = null;
if (existsSync(join(ROOT, 'data/pretrained.json'))) { try { pre = JSON.parse(readFileSync(join(ROOT, 'data/pretrained.json'), 'utf8')); } catch { pre = null; } }
const wFor = side => pre ? (pre[side] ?? pre.flies?.[side] ?? null) : null;
function flyFor(side) {
  const w = wFor(side);
  if (w) { try { return Fly.fromJSON(C, w); } catch (e) { console.log(`  note: pretrained ${side} did not load (${e.message}); naive fly`); } }
  return new Fly(C, { name: `Fly ${side}`, hemisphere: side, seed: side === 'A' ? 1 : 2 });
}
const byId = new Map(Object.entries(cards.CARD));
console.log(`  flies: ${pre && wFor('A') ? 'pretrained (data/pretrained.json)' : 'naive (no data/pretrained.json)'}`);

function simulate({ seed, calm, R, T = 300, dt = 1 / 30, flies = [flyFor('A'), flyFor('B')] }) {
  const stats = { n: 0, bad: 0, badCalls: [] };
  const show = createShow({ rules, byId, connectome: C, flies, bots, trained: !!pre, seed, calm, makeCanvas: () => fakeCanvas(stats), makeImage: null, dpr: 2 });
  const g = fakeCtx(stats), shots = [], plates = [], subj = [];
  let errors = 0, msMax = 0;
  for (let t = 0; t < T; t += dt) {
    const t0 = performance.now();
    let r = null;
    try { r = show.update(dt); const s = show.draw(g, R, dt); if (s) subj.push(s); } catch (e) { if (errors++ < 3) console.error(e); }
    msMax = Math.max(msMax, performance.now() - t0);
    if (r && r.changed) { shots.push({ t: show.now, kind: r.shot.kind, ev: r.shot.event && r.shot.event.kind }); plates.push(show.plate()); }
  }
  return { show, stats, shots, plates, subj, errors, msMax };
}
{
  const t0 = Date.now();
  const D1 = simulate({ seed: 11, calm: 0.6, R: { x: 16, y: 150, w: 1248, h: 480 } });
  const kinds = new Set(D1.shots.map(s => s.kind));
  const gaps = D1.shots.slice(1).map((x, i) => x.t - D1.shots[i].t);
  console.log(`  show: ${D1.shots.length} shots, ${D1.show.games} matches in 300 s, kinds ${[...kinds].join(' ')}, events ${D1.shots.filter(s => s.ev).map(s => s.ev).join(' ')}`);
  console.log(`  show: ${D1.stats.n} draw calls, slowest frame ${D1.msMax.toFixed(1)} ms, wall ${Date.now() - t0} ms`);
  ok(D1.errors === 0, 'show: no exception in 300 s at 30 fps');
  ok(D1.stats.bad === 0, `show: every draw call has finite numbers (${D1.stats.badCalls.join(' ')})`);
  ok(D1.show.games >= 2, `show: at least one match ends and a new one starts (${D1.show.games})`);
  ok(gaps.every(gp => gp >= SHOT_MIN - 0.05 && gp <= SHOT_MAX + 0.05), `show: cuts every 5-12 s (${Math.min(...gaps).toFixed(2)}-${Math.max(...gaps).toFixed(2)})`);
  ok(kinds.size >= 6 && kinds.has('combat') && kinds.has('card') && kinds.has('win'), 'show: event shots (combat, card, win) and idle shots all appear');
  ok(D1.shots.filter(s => s.ev).length >= 5, 'show: shots cut on match events');
  ok(D1.plates.every(p => p.title && /turn \d+/.test(p.sub) && !('code' in p)), 'show: every plate has a title and live numbers, no code');
  ok(D1.subj.every(s => s.x >= 16 - 1 && s.x <= 1264 + 1 && s.y >= 150 - 1 && s.y <= 630 + 1), 'show: the subject centre stays in the band');
  ok(D1.msMax < 250, `show: slowest frame under 250 ms in node (${D1.msMax.toFixed(1)})`);
  const D2 = simulate({ seed: 11, calm: 0.6, R: { x: 16, y: 150, w: 1248, h: 480 }, T: 60 });
  ok(JSON.stringify(D2.shots) === JSON.stringify(D1.shots.filter(s => s.t < 60 - 1e-9)), 'show: the same seed replays the same shots');
  const D3 = simulate({ seed: 12, calm: 0.6, R: { x: 16, y: 150, w: 1248, h: 480 }, T: 60 });
  ok(JSON.stringify(D3.shots) !== JSON.stringify(D2.shots), 'show: another seed gives another run');
  // phone band: 390 x 844 frame, a tall narrow band
  const P = simulate({ seed: 5, calm: 1, R: { x: 16, y: 210, w: 358, h: 420 }, T: 150 });
  ok(P.errors === 0 && P.stats.bad === 0, `show: phone band draws clean (${P.shots.length} shots)`);
  // a fly that does not load: the greedy bot stands in
  const Q = simulate({ seed: 3, calm: 0.3, R: { x: 0, y: 0, w: 800, h: 400 }, T: 40, flies: [flyFor('A'), null] });
  ok(Q.errors === 0 && Q.show.S.kinds[1] === 'bot' && /greedy bot/.test(Q.plates[0].lines.join()), 'show: a missing fly gives a named stand-in bot');
  // burst: the brain shot comes with a large TD error at some point
  const anyBurst = [D1, P].some(d => d.shots.some(s => s.ev === 'burst'));
  ok(anyBurst || D1.shots.some(s => s.kind === 'brain'), 'show: brain shots appear (burst or idle)');
}

// ---------------------------------------------------------------- hook
{
  ok(globalThis.snSaver && typeof snSaver.enter === 'function' && typeof snSaver.exit === 'function', 'hook: window.snSaver has enter and exit');
  const labels = [];
  globalThis.flyDuel = {
    ready: Promise.resolve(),
    M: { rules, cards, bots, fly: { Fly } }, D: { connectome: C, pretrained: pre },
    makeFly: s => flyFor(s), heroFlies: () => ({ trained: !!pre }),
  };
  const res = snSaver.enter({ calm: 0.5, seed: 42, label: p => labels.push(p) });
  ok(res && res.canvas && appended.includes(res.canvas) && res.canvas.id === 'fdSaverCv', 'hook: enter returns a canvas that is in the document');
  ok(globalThis.__fdSaver === true, 'hook: enter sets window.__fdSaver (main.js loop stops)');
  await new Promise(r => setTimeout(r, 0));
  let t = 0;
  for (let i = 0; i < 30 * 20; i++) { const fs = frames.splice(0); t += 1000 / 30; for (const f of fs) f(t); }
  const dbg = snSaver.debug();
  ok(dbg && dbg.n >= 2 && dbg.games >= 1, `hook: 20 s of frames give shots (${JSON.stringify({ n: dbg.n, kind: dbg.kind, games: dbg.games })})`);
  ok(labels.length >= 10 && labels.every(p => p && p.title && typeof p.anchor === 'function' && !('code' in p)), `hook: the plate is sent and refreshed (${labels.length} calls)`);
  const a = labels[labels.length - 1].anchor();
  ok(a && Number.isFinite(a.x) && Number.isFinite(a.y) && a.lead === false, 'hook: the anchor gives the subject box');
  ok(domStats.bad === 0, 'hook: the hook frames draw finite numbers');
  snSaver.exit();
  ok(globalThis.__fdSaver === false && !appended.some(e => e.id === 'fdSaverCv'), 'hook: exit removes the canvas and clears the flag');
  const src = readFileSync(join(ROOT, 'saver.js'), 'utf8');
  ok(!/headless|puppeteer|playwright/i.test(src), 'hook: no browser automation in saver.js');
  ok(!/\bcode\s*:/.test(src.slice(src.indexOf('export function plateFor'), src.indexOf('// ----------------------------------------------------------- drawing'))), 'hook: plateFor sets no code field');
}

console.log(`saver.test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
