// ============================================================================
//  FLY DUEL  ·  node tests for the framing and the slim scorecards
//  (node tests/play-framing.test.mjs)
// ----------------------------------------------------------------------------
//  The user: "i want the visual of the fly to take up as much visual real
//  estate as possible. the fly a vs fly b cards should be much less
//  visually obstrusive".
//
//    watch      the wide shot (ui/fly3d/scene.js WATCH) shows each fly
//               larger than the old numbers did, at a desktop and a phone
//               frame, with both heads in the frame
//    seat       the play seat view shows the other fly large
//    slim card  ui/hud/scorecard.js slim: the brain button opens and
//               closes the neural panel, does not target the player, and
//               shows only on a fly card; a small life die
//    css        the slim card is translucent with small type; the 3D play
//               table is full bleed with the HUD over it; the watch
//               scorecards are at most 250 px wide
//    play DOM   mountPlay with a 3D scene: full bleed root, slim cards
//               (skipped without linkedom)
//  Exit code 1 on any failure.
// ============================================================================
import { registerHooks, createRequire } from 'node:module';
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
let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL', msg); } };

const THREE = await import('three');
const rules = await import('../game/rules.js');
const cards = await import('../game/cards.js');
const { greedyBot } = await import('../game/bots.js');
const { Match, agentFromBot } = await import('../ui/match.js');
const { createDuelScene, WATCH, TABLE } = await import('../ui/fly3d/scene.js');

// ------------------------------------------------------------- watch
// fly height on the screen: head joint to the table top under the seat
function flyPx(sc, h) {
  sc.scene.updateMatrixWorld(true); sc.camera.updateMatrixWorld();
  let m = Infinity;
  for (const f of sc.world.flies) {
    const head = f.built.rig.joints?.head?.getWorldPosition(new THREE.Vector3()) ?? f.holder.position.clone().setY(3.2);
    const a = head.clone().project(sc.camera), b = f.holder.position.clone().setY(TABLE.y).project(sc.camera);
    if (Math.abs(a.x) > 0.98 || Math.abs(a.y) > 0.98) return -1;
    m = Math.min(m, Math.abs(a.y - b.y) * h / 2);
  }
  return m;
}
const OLD = { wideR: 10, wideEl: 0.48, wideLook: 0.5, drift: 0.55, tallR: 13.5, tallEl: 0.55, fitAspect: 1.45 };
const NEW = { ...WATCH };
for (const [w, h, gain] of [[1600, 900, 1.25], [960, 540, 1.25], [390, 844, 1.1]]) {
  const sc = createDuelScene({ clientWidth: w, clientHeight: h }, { headless: true });
  await sc.ready;
  sc.setState(new Match(rules, [agentFromBot(greedyBot(), 'a'), agentFromBot(greedyBot(), 'b')], { seed: 3 }).state);
  sc.setCamera('script');
  const at = cfg => {
    Object.assign(WATCH, cfg);
    let m = Infinity;
    for (const az of [-1.57, 0, 1.57]) { sc.shoot('wide', 0, { cut: true }); sc.world.cam.az = az; sc.render(1e-4); const v = flyPx(sc, h); m = v < 0 ? -1 : Math.min(m, v); if (m < 0) break; }
    return m;
  };
  const old = at(OLD), now = at(NEW);
  Object.assign(WATCH, NEW);
  ok(now > 0 && now >= old * gain, `${w}x${h}: the wide shot shows each fly larger (${old | 0} px before, ${now | 0} px now, both heads in the frame)`);
  sc.dispose();
}

// -------------------------------------------------------------- seat
for (const [w, h, min] of [[1440, 900, 230], [390, 760, 105]]) {
  const sc = createDuelScene({ clientWidth: w, clientHeight: h, style: {} }, { headless: true });
  await sc.ready;
  sc.setState(new Match(rules, [agentFromBot(greedyBot(), 'a'), agentFromBot(greedyBot(), 'b')], { seed: 3 }).state);
  sc.setFirstPerson(0);
  for (let k = 0; k < 90; k++) sc.render(1 / 30);
  sc.scene.updateMatrixWorld(true); sc.camera.updateMatrixWorld();
  const f = sc.world.flies[1];
  const head = f.built.rig.joints.head.getWorldPosition(new THREE.Vector3()).project(sc.camera);
  const top = new THREE.Vector3(0, 3.56, -TABLE.seatV).project(sc.camera), base = new THREE.Vector3(0, TABLE.y, -TABLE.halfDepth).project(sc.camera);
  const px = (top.y - base.y) * h / 2;
  ok(Math.abs(head.x) < 0.9 && top.y < 0.95 && px >= min, `${w}x${h}: the seat view shows the other fly ${px | 0} px high (at least ${min}), its head in the frame`);
  sc.dispose();
}

// --------------------------------------------------------------- css
const hud = readFileSync(join(ROOT, 'ui/hud/hud.css'), 'utf8');
const play = readFileSync(join(ROOT, 'ui/play/play.css'), 'utf8');
const style = readFileSync(join(ROOT, 'style.css'), 'utf8');
const rule = (css, sel) => { const i = css.indexOf(sel + ' {') >= 0 ? css.indexOf(sel + ' {') : css.indexOf(sel + '{'); if (i < 0) return ''; return css.slice(i, css.indexOf('}', i)); };
const slim = rule(hud, '.hd-slim');
const alpha = +(slim.match(/background:\s*rgba\([^)]*,\s*([\d.]+)\)/) || [])[1];
ok(alpha > 0 && alpha <= 0.6, `slim card background is translucent (alpha ${alpha})`);
ok(+(slim.match(/font-size:\s*(\d+)px/) || [])[1] <= 12, 'slim card type is small');
ok(/\.hd-slim \.hd-brain, \.hd-slim \.hd-top \{ display: none; \}/.test(hud) && /\.hd-slim\.is-open \.hd-brain \{ display: block/.test(hud), 'slim card: the neural panel shows only when open');
ok(/\.pl\.pl-3d \.pl-table \{ position: absolute; inset: 0;/.test(play), '3D play: the table is full bleed');
ok(/\.pl\.pl-3d \.pl-opp \{ display: none; \}/.test(play), '3D play: the DOM card backs go (the 3D table shows them)');
const scW = +(rule(play, '.pl.pl-3d .pl-sc').match(/min\((\d+)px/) || [])[1];
ok(scW > 0 && scW <= 250, `3D play: a scorecard is at most ${scW} px wide`);
const cols = [...style.matchAll(/\.wtop\{grid-template-columns:minmax\(0,(\d+)px\)/g)].map(m => +m[1]);
ok(cols.length >= 3 && cols.every(c => c <= 250), `watch: scorecard columns at most 250 px (${cols.join(', ')})`);

// ------------------------------------------------- slim card and play DOM
let parseHTML = null;
for (const base of [join(ROOT, 'package.json'), '/usr/local/lib/node_modules/openclaw/package.json']) {
  try { ({ parseHTML } = createRequire(base)('linkedom')); break; } catch { /* next */ }
}
if (!parseHTML) console.log('  skip: DOM checks (linkedom is missing)');
else {
  const { window, document } = parseHTML('<!doctype html><html><body><div id="h"></div><main id="play"></main></body></html>');
  globalThis.window = window; globalThis.document = document;
  const ev = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
  const { createScorecard, scorecardModel } = await import('../ui/hud/scorecard.js');
  const st = new Match(rules, [agentFromBot(greedyBot(), 'a'), agentFromBot(greedyBot(), 'b')], { seed: 3 }).state;
  let targeted = 0;
  const sc = createScorecard(document.getElementById('h'), { seat: 1, side: 'right', kind: 'fly', slim: true, onPlayer: () => targeted++ });
  sc.update(scorecardModel({ state: st, seat: 1, CARD: cards.CARD, kind: 'fly', name: 'Fly B' }));
  const more = sc.el.querySelector('.hd-more');
  ok(sc.el.classList.contains('hd-slim') && !more.hidden && !sc.open, 'slim fly card: the brain button shows, the panel is closed');
  ev(more, 'click');
  ok(sc.open && more.getAttribute('aria-expanded') === 'true' && targeted === 0, 'the brain button opens the panel and does not target the player');
  ev(more, 'click');
  ok(!sc.open && more.getAttribute('aria-expanded') === 'false', 'a second tap closes it');
  ok(/width="30"/.test(sc.el.querySelector('.hd-life').innerHTML), 'slim card: a small life die (30 px)');
  ev(sc.el.querySelector('.hd-name'), 'click');
  ok(targeted === 1, 'a tap on the name still targets the player');
  const human = createScorecard(document.getElementById('h'), { seat: 0, kind: 'human', slim: true });
  human.update(scorecardModel({ state: st, seat: 0, CARD: cards.CARD, kind: 'human', name: 'You' }));
  ok(human.el.querySelector('.hd-more').hidden, 'your own card has no brain button');
  sc.setSlim(false);
  ok(!sc.el.classList.contains('hd-slim') && more.hidden === false, 'setSlim(false) gives the full card');
  sc.dispose(); human.dispose();

  const { mountPlay } = await import('../ui/play/play.js');
  const scene = { pickPermanent: () => null, setFirstPerson() {}, highlight() {}, setState() {}, setSpeed() {}, resize() {}, play: () => Promise.resolve(), orbitBy: () => ({}), zoomBy: () => ({}), seatView() {} };
  const root = document.getElementById('play');
  const P = mountPlay(root, { rules, cards, bots: { greedyBot }, flies: {}, connectomes: {}, seed: 4, scene, sceneEl: document.createElement('canvas') });
  ev(root.querySelector('.pl-go'), 'click');
  ok(root.classList.contains('pl-3d'), 'play with a 3D scene: the root is full bleed (.pl-3d)');
  ok(root.querySelectorAll('.hd-card.hd-slim').length === 2, 'play with a 3D scene: both scorecards are slim');
  ok(root.querySelector('.pl-table > canvas') && root.querySelector('.pl-seatbtn')?.hidden === true, 'play: the canvas is in the table, "Back to seat" waits for an orbit');
  P.destroy();
  ok(!root.classList.contains('pl-3d'), 'destroy removes the full bleed class');
}

console.log(`play-framing: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
