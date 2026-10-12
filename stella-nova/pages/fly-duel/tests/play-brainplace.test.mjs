// ============================================================================
//  FLY DUEL  ·  node tests for the place of the brain of the other fly in
//  play mode  (node tests/play-brainplace.test.mjs)
// ----------------------------------------------------------------------------
//  The user (verbatim, 2026-10-12): "when i'm playing against fly b, we
//  want a big visualization of the fly's brain" and "the fly brain is
//  obscuring my ability to see my hand in play mode". The 1600x900
//  capture of 2026-10-12 showed the brain of Fly B over your library and
//  your mat, and its caption behind the dock.
//
//    old      the old right column (style.css, clearInsets) at 1600x900
//             lies over your library: the check that finds the bug
//    wide     playBrainBox (ui/fly3d/brainpanels.js) with the seat rects
//             of ui/fly3d/scene.js seatRects at 1600x900, 1920x1080,
//             1440x900, 1280x800 and 1024x768, both seats: the brain
//             square and its caption touch neither your mat, your
//             library, the mat of the other fly, the dock nor the hand;
//             the caption is off the other fly; the square is large
//    hall     the map of the other fly in the hall (brains "in hall")
//             is off your mat, your library and the dock
//    tall     390x760: the top band of style.css with clearInsets is off
//             your mat, your library and the dock
//    main     main.js syncClear places the brain with playBrainBox
//  Exit code 1 on any failure.
// ============================================================================
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const vendor = new URL('../../../vendor/three@0.160.0/', import.meta.url);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'three') return { url: new URL('build/three.module.js', vendor).href, shortCircuit: true };
    if (spec.startsWith('three/addons/')) return { url: new URL('examples/jsm/' + spec.slice(13), vendor).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const rules = await import('../game/rules.js');
const { createDuelScene } = await import('../ui/fly3d/scene.js');
const BP = await import('../ui/fly3d/brainpanels.js');
const { layoutFor } = await import('../ui/play/layout.js');
const { dockRect } = await import('../ui/play/turnbar.js');
const C = JSON.parse(readFileSync(join(ROOT, 'data/connectome.json'), 'utf8'));

let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };
const hit = (a, b) => !!(a && b) && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const f = r => (r ? [r.x, r.y, r.w, r.h].map(Math.round).join(',') : 'null');

ok(typeof BP.playBrainBox === 'function', 'brainpanels.js exports playBrainBox');

// The HUD of play mode at w x h: the dock with the small button at its
// left (play.css .pl-sec), the resting hand, the two slim scorecards.
function hud(w, h) {
  const L = layoutFor(w, h);
  const d = dockRect(L, { vw: w, vh: h, sec: true });
  return {
    dock: { x: d.left - 104, y: d.top, w: d.w + 104, h: d.h },
    hand: { x: 0, y: h - L.hand.peek, w, h: L.hand.peek },
    cards: [{ x: 8, y: 8, w: 260, h: 76 }, { x: w - 268, y: 8, w: 260, h: 76 }],
  };
}

async function sceneAt(w, h) {
  const sc = createDuelScene({ clientWidth: w, clientHeight: h, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }) }, { headless: true, connectomes: [C, C] });
  await sc.ready;
  sc.setState(rules.newGame({ seed: 3, decks: ['pollen', 'amber-pollen'] }));
  return sc;
}

// --- old: the right column of before, at 1600x900 ------------------------------
{
  const [w, h] = [1600, 900];
  const sc = await sceneAt(w, h);
  sc.setFirstPerson(0);
  const bpw = Math.min(640, Math.max(220, 0.31 * w));
  const col = { left: w - bpw, top: 72, right: w, bottom: h - 180 };
  sc.setClear({ ...BP.clearInsets({ left: 0, top: 0, right: w, bottom: h }, [col], true), frame: null });
  const R = sc.seatRects?.();
  const colR = { x: col.left, y: col.top, w: bpw, h: col.bottom - col.top };
  ok(!!R && hit(colR, R.mine.library), `old: the right column of before lies over your library (column ${f(colR)}, library ${f(R?.mine?.library)})`);
  sc.dispose();
}

// --- wide: playBrainBox with the seat rects ----------------------------------------
for (const [w, h] of [[1600, 900], [1920, 1080], [1440, 900], [1280, 800], [1024, 768]]) {
  const sc = await sceneAt(w, h);
  const H = hud(w, h);
  for (const seat of [0, 1]) {
    const tag = `${w}x${h} seat ${seat}`;
    sc.setFirstPerson(seat);
    sc.setClear({ l: 0, r: 0, t: 0, b: 0, frame: null });
    for (let k = 0; k < 30; k++) sc.render(1 / 30);
    const R = sc.seatRects?.();
    ok(!!R && R.mine.mat && R.mine.library && R.opp.mat && R.opp.fly, `${tag}: seatRects gives your mat, your library, the mat and the fly of the other seat`);
    if (!R) continue;
    const top = Math.max(...H.cards.map(r => r.y + r.h + 6));
    const res = BP.playBrainBox?.({ w, h }, [R.mine.mat, R.mine.library, R.opp.mat, H.dock, H.hand, ...H.cards], { top, capAvoid: [R.opp.fly] });
    ok(!!res, `${tag}: a brain square fits`);
    if (!res) continue;
    const named = { 'your mat': R.mine.mat, 'your library': R.mine.library, 'the mat of the other fly': R.opp.mat, 'the dock': H.dock, 'the hand': H.hand, 'a scorecard': H.cards[0], 'the other scorecard': H.cards[1] };
    const on = (r) => Object.entries(named).filter(([, x]) => hit(r, x)).map(([n]) => n);
    ok(on(res.brain).length === 0, `${tag}: the brain ${f(res.brain)} is off the board and the HUD (${on(res.brain).join(', ')})`);
    ok(on(res.cap).length === 0, `${tag}: the caption ${f(res.cap)} (${res.capSide}) is off the board and the HUD (${on(res.cap).join(', ')})`);
    ok(res.capSide === 'inside' || !hit(res.cap, R.opp.fly), `${tag}: the caption is off the other fly (${f(R.opp.fly)})`);
    ok(res.brain.x + res.brain.w <= w && res.brain.y >= top && res.brain.y + res.brain.h <= h, `${tag}: the brain is in the view, under the scorecards`);
    ok(res.brain.w >= 0.25 * h, `${tag}: the brain square is large (${Math.round(res.brain.w)} px, at least ${Math.round(0.25 * h)})`);
    // the map of the other fly in the hall (brains "in hall")
    ok(!!R.bigBrain && !hit(R.bigBrain, R.mine.mat) && !hit(R.bigBrain, R.mine.library) && !hit(R.bigBrain, H.dock), `${tag}: the map in the hall ${f(R.bigBrain)} is off your mat, your library and the dock`);
  }
  sc.dispose();
}

// --- tall: the top band and clearInsets at 390x760 ----------------------------------
{
  const [w, h] = [390, 760];
  const sc = await sceneAt(w, h);
  const H = hud(w, h);
  const bph = Math.min(250, Math.max(118, 0.22 * h));
  const band = { left: 0, top: 64, right: w, bottom: 64 + bph };
  sc.setClear({ ...BP.clearInsets({ left: 0, top: 0, right: w, bottom: h }, [band], false), frame: null });
  for (const seat of [0, 1]) {
    sc.setFirstPerson(seat);
    const R = sc.seatRects?.();
    const b = { x: band.left, y: band.top, w: w, h: bph };
    ok(!!R && !hit(b, R.mine.mat) && !hit(b, R.mine.library) && !hit(b, H.dock), `390x760 seat ${seat}: the brain band ${f(b)} is off your mat ${f(R?.mine?.mat)}, your library ${f(R?.mine?.library)} and the dock`);
  }
  sc.dispose();
}

// --- main: syncClear uses playBrainBox ----------------------------------------------
{
  const src = readFileSync(join(ROOT, 'main.js'), 'utf8');
  ok(/function placePlayBrain\(/.test(src) && /PM\.playBrainBox\(/.test(src) && /sc\.seatRects\(/.test(src), 'main: placePlayBrain places the brain with seatRects and playBrainBox');
  ok(/if \(app\.mode === 'play' && placePlayBrain\(/.test(src), 'main: syncClear places the brain in play mode before the insets of the side column');
}

console.log(`play-brainplace: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
