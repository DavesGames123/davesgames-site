// ============================================================================
//  FLY DUEL  ·  play mode, the cast preview (MTG Arena style)
//  (node tests/play-cast.test.mjs)
// ----------------------------------------------------------------------------
//  The user (verbatim, 2026-10-12): "it should animatedly display the card
//  in the left, then place it down on the mat magic the gathering arena
//  style".
//    plan      castPlan: a creature or a spell cast gets a preview, a land,
//              a pass or an attack none; the creature gets the uid of its
//              new permanent; calm > normal > fast; reduced motion: no
//              flight
//    rect      castRect at 390 x 760, 1920 x 1080, 844 x 390: the card is
//              at the left, in the view, clear of the hand and the top
//    target    projectTarget maps a camera point to the canvas rect;
//              fallbackTarget: your row low, the fly's row high
//    dom       createCastView on a manual clock: the card shows at once at
//              the left, holds still for the hold, then flies to the target
//              and shrinks, then goes; the promise ends after the total
//    play      mountPlay: a whole game against greedyBot (you pass), the
//              fly's casts show the preview; the scene stub plays the clip
//              at the same time
//  Exit code 1 on any failure.
// ============================================================================
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('ok  ', m); } else { fail++; console.error('FAIL', m); } };

const { CARD } = await import('../game/cards.js');
let C = null;
try { C = await import('../ui/play/castview.js'); } catch (e) { ok(false, `ui/play/castview.js loads (${e.message.split('\n')[0]})`); }
const ids = Object.keys(CARD);
const creature = ids.find(id => CARD[id].type === 'creature');
const spell = ids.find(id => CARD[id].type !== 'creature' && CARD[id].type !== 'land');
const land = ids.find(id => CARD[id].type === 'land');
const rec = (type, card, who = 1) => ({
  who, action: { type, card },
  before: { players: [{ battlefield: [{ uid: 1, id: land }] }, { battlefield: [{ uid: 2, id: land }] }] },
  after: { players: [{ battlefield: [{ uid: 1, id: land }] }, { battlefield: [{ uid: 2, id: land }, ...(type === 'cast' && CARD[card].type === 'creature' ? [{ uid: 9, id: card }] : [])] }] },
});

if (C) {
  const { CAST, castPlan, castRect, fallbackTarget, projectTarget, createCastView } = C;
  // --- plan
  {
    const p = castPlan(rec('cast', creature), CARD);
    ok(p && p.kind === 'creature' && p.id === creature && p.seat === 1 && p.uid === 9, `plan: a creature cast previews, with its new uid (${JSON.stringify(p)})`);
    ok(p && p.hold === CAST.hold && p.fly === CAST.fly && p.total === CAST.hold + CAST.fly + CAST.fade, 'plan: normal speed holds CAST.hold, then flies CAST.fly');
    const s = castPlan(rec('cast', spell), CARD);
    ok(s && s.kind === 'spell' && s.uid === null, 'plan: a spell cast previews (no permanent)');
    ok(castPlan(rec('land', land), CARD) === null, 'plan: a land has no preview');
    ok(castPlan({ who: 0, action: { type: 'pass' } }, CARD) === null && castPlan({ who: 0, action: { type: 'attack', attackers: [] } }, CARD) === null, 'plan: a pass or an attack has no preview');
    const calm = castPlan(rec('cast', creature), CARD, { speed: 'calm' }), fast = castPlan(rec('cast', creature), CARD, { speed: 'fast' });
    ok(calm.total > p.total && p.total > fast.total && fast.hold >= 250, `plan: calm ${calm.total} > normal ${p.total} > fast ${fast.total} ms, the fast hold still reads (${fast.hold} ms)`);
    const r = castPlan(rec('cast', creature), CARD, { reduced: true });
    ok(r.fly === 0 && r.hold === CAST.hold, 'plan: reduced motion: the hold stays, no flight');
  }
  // --- rect
  {
    let bad = '';
    for (const [vw, vh, peek, top] of [[390, 760, 99, 60], [1920, 1080, 170, 80], [844, 390, 70, 40]]) {
      const r = castRect(vw, vh, { peek, top });
      if (r.x < 0 || r.y < top || r.x + r.w > vw * 0.5 || r.y + r.h > vh - peek) bad ||= `${vw}x${vh}: ${JSON.stringify(r)}`;
      if (Math.abs(r.h / r.w - 1.4) > 0.02) bad ||= `${vw}x${vh}: not 5:7`;
      if (r.w < 100) bad ||= `${vw}x${vh}: too small (${r.w})`;
    }
    ok(!bad, `rect: the big card is at the left half, in the view, clear of the hand and the top, 5:7, 100 px wide or more (${bad || 'ok'})`);
    ok(castRect(1920, 1080, { peek: 170 }).w >= 220, 'rect: large on a desktop');
  }
  // --- target
  {
    const box = { left: 0, top: 0, width: 1000, height: 800 };
    ok(fallbackTarget(box, true).y > fallbackTarget(box, false).y, 'target: your row is lower than the fly row');
    ok(fallbackTarget(box, true, 'spell').y === 400, 'target: a spell goes to the middle');
    // a fake camera: project() gives fixed NDC
    const vec = ndc => ({ clone: () => ({ project: () => ({ ...ndc }) }) });
    const t = projectTarget(vec({ x: 0, y: 0, z: 0.5 }), {}, { left: 100, top: 50, width: 800, height: 600 });
    ok(t && t.x === 500 && t.y === 350, `target: NDC (0, 0) is the centre of the canvas rect (${JSON.stringify(t)})`);
    ok(projectTarget(vec({ x: 0, y: 0, z: 1.2 }), {}, box) === null && projectTarget(null, {}, box) === null, 'target: behind the camera or no point: null');
  }

  // --- DOM
  let parseHTML = null;
  for (const base of [join(ROOT, 'package.json'), '/usr/local/lib/node_modules/openclaw/package.json']) {
    try { ({ parseHTML } = createRequire(base)('linkedom')); break; } catch { /* next */ }
  }
  if (!parseHTML) console.log('  skip: DOM checks (linkedom is missing)');
  else {
    const { window, document } = parseHTML('<!doctype html><html><body><main id="r"></main><main id="play"></main></body></html>');
    globalThis.window = window; globalThis.document = document;
    let now = 0, q = [], n = 0;
    const wait = (f, ms) => { const id = ++n; q.push({ id, at: now + ms, f }); return id; };
    const unwait = id => { q = q.filter(x => x.id !== id); };
    const tick = ms => { const end = now + ms; for (;;) { q.sort((a, b) => a.at - b.at || a.id - b.id); const x = q[0]; if (!x || x.at > end) break; q.shift(); now = x.at; x.f(); } now = end; };
    const root = document.getElementById('r');
    const painted = [];
    const V = createCastView(root, { paint: (cv, id, w, h) => painted.push([id, w, h]), view: () => [1920, 1080], insets: () => ({ peek: 170, top: 80 }), wait, unwait });
    const plan = castPlan(rec('cast', creature), CARD);
    let ended = false;
    V.play(plan, () => ({ x: 960, y: 380 })).then(() => { ended = true; });
    const el = root.querySelector('.pl-cast');
    ok(el && !el.hidden && el.dataset.id === creature && painted[0]?.[0] === creature, 'dom: the cast card shows at once, painted');
    ok(parseInt(el.style.left, 10) < 1920 * 0.1 && parseInt(el.style.width, 10) >= 220, `dom: it is large at the left (left ${el.style.left}, width ${el.style.width})`);
    tick(plan.hold - 10);
    ok(!el.style.transform && !el.classList.contains('is-down'), 'dom: it holds still for the hold');
    tick(20);
    ok(/translate\(/.test(el.style.transform) && /scale\(0\.2\)/.test(el.style.transform) && el.classList.contains('is-down'), `dom: after the hold it flies down and shrinks (${el.style.transform})`);
    const m = el.style.transform.match(/translate\((-?\d+)px, (-?\d+)px\)/);
    const r = castRect(1920, 1080, { peek: 170, top: 80 });
    ok(m && +m[1] === Math.round(960 - (r.x + r.w / 2)) && +m[2] === Math.round(380 - (r.y + r.h / 2)), 'dom: it flies to the target point');
    tick(plan.fly + plan.fade + 5);
    await Promise.resolve();
    ok(el.hidden && ended, 'dom: then it goes and the promise ends');
    ok(await V.play(null, null) === false && el.hidden, 'dom: no plan, no preview');

    // --- play: a game in which you pass; the fly's casts preview
    {
      const realST = globalThis.setTimeout;
      globalThis.setTimeout = f => realST(f, 0);
      const rules = await import('../game/rules.js');
      const cards = await import('../game/cards.js');
      const bots = await import('../game/bots.js');
      const { mountPlay } = await import('../ui/play/play.js');
      const proot = document.getElementById('play');
      const ev = (e, type) => e.dispatchEvent(new window.Event(type, { bubbles: true }));
      let clips = 0;
      const scene = { pickPermanent: () => null, setFirstPerson() {}, highlight() {}, setState() {}, setSpeed() {}, resize() {}, play: () => { clips++; return Promise.resolve(); } };
      const P = mountPlay(proot, { rules, cards, bots, flies: {}, connectomes: {}, seed: 11, scene, sceneEl: document.createElement('canvas') });
      const pq = s => proot.querySelector(s);
      ev(pq('.pl-seg[data-k="opp"] button[data-v="bot"]'), 'click');
      ev(pq('.pl-go'), 'click');
      ev(pq('[data-call="heads"]'), 'click');
      ev(pq('.pl-go'), 'click');
      ev(pq('[data-keep]'), 'click');
      const pc = P.controller;
      let guard = 0;
      while (pc.need() !== 'over' && guard++ < 4000) {
        await new Promise(r => realST(r, 1));
        if (pc.need() === 'human' && !P.busy) ev(pq('.pl-pri'), 'click');
      }
      const flyCasts = pc.history.filter(h => h.who === pc.flySeat && castPlan(h, CARD)).length;
      const shown = +(pq('.pl-cast')?.dataset.n || 0);
      ok(flyCasts > 0 && shown === flyCasts, `play: every cast of the fly shows the preview (${shown} of ${flyCasts})`);
      ok(clips > 0, 'play: the 3D clip still plays');
      P.destroy();
      ok(!pq('.pl-cast'), 'play: destroy removes the preview');
      globalThis.setTimeout = realST;
    }
  }
}

console.log(`play-cast: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
