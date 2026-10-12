// ============================================================================
//  FLY DUEL  ·  the right-click card zoom  (node tests/cardzoom.test.mjs)
// ----------------------------------------------------------------------------
//  The user: "if i hover and right click over any card during the
//  simulation i should be able to see a magnified view of it
//  superimposed on the screen until i right click somewhere elese".
//    pick     ui/fly3d/scene.js pickFace (headless): the point of a card
//             on the table gives that card; a point with no card gives
//             null; in play mode (first person) a hidden card of the
//             other fly gives id null at every point of the screen
//    zoom     ui/cardzoom.js with linkedom: a right-click on a card opens
//             the zoom with that id; on another card it changes; on no
//             card it closes; a right-click elsewhere on the page closes;
//             Escape closes; a hidden card (id null) never opens; play
//             mode (active false) does nothing; touch: a long press opens,
//             a tap outside the card closes
//    size     zoomSize keeps 5:7 inside the view
//    wiring   main.js attaches the zoom to the table canvas in watch mode
//  Exit code 1 on any failure.
// ============================================================================
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

const vendor = new URL('../../../vendor/three@0.160.0/', import.meta.url);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'three') return { url: new URL('build/three.module.js', vendor).href, shortCircuit: true };
    if (spec.startsWith('three/addons/')) return { url: new URL('examples/jsm/' + spec.slice(13), vendor).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('ok  ', m); } else { fail++; console.error('FAIL', m); } };

const THREE = await import('three');
const rules = await import('../game/rules.js');
const { greedyBot } = await import('../game/bots.js');
const { Match, agentFromBot } = await import('../ui/match.js');
const { createDuelScene } = await import('../ui/fly3d/scene.js');
const { createCardZoom, attachCardZoom, zoomSize } = await import('../ui/cardzoom.js');
const { CARD } = await import('../game/cards.js');

// --- pick (headless scene) ---------------------------------------------------------
{
  const W = 1280, H = 720;
  const M = new Match(rules, [agentFromBot(greedyBot(), 'a'), agentFromBot(greedyBot(), 'b')], { seed: 5 });
  for (let i = 0; i < 60 && !M.over(); i++) M.next();
  const st = M.state;
  const sc = createDuelScene({ clientWidth: W, clientHeight: H }, { headless: true });
  await sc.ready;
  sc.setState(st);
  sc.setCamera('script');
  sc.shoot('wide', 0, { cut: true }); sc.render(1e-4);
  sc.scene.updateMatrixWorld(true); sc.camera.updateMatrixWorld();
  const px = o => { const v = o.mesh.getWorldPosition(new THREE.Vector3()).project(sc.camera); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; };
  const Z = sc.world.Z;
  let tried = 0, hits = 0;
  for (const [uid, o] of Z.perms) {
    const [x, y] = px(o);
    if (x < 0 || x > W || y < 0 || y > H) continue;
    tried++;
    const h = sc.pickFace(x, y);
    // a land stack: the top land of the stack (same card) may take the hit
    if (h && h.zone === 'perm' && h.id === o.id) hits++;
  }
  ok(tried > 0 && hits >= tried - 1, `pick: the centre of a permanent gives that card (${hits} of ${tried})`);
  const g = [0, 1].flatMap(p => Z.grave[p]);
  const gt = g.length ? sc.pickFace(...px(g[g.length - 1])) : null;
  ok(!g.length || (gt && gt.id != null && (gt.zone === 'grave' || gt.zone === 'perm')), `pick: a graveyard card gives a face id (${g.length} cards, ${gt?.zone})`);
  const hand = Z.hand[0].filter(o => { const [x, y] = px(o); return x > 0 && x < W && y > 0 && y < H; });
  const hh = hand.length ? sc.pickFace(...px(hand[hand.length - 1])) : null;
  ok(!hand.length || (hh && hh.zone === 'hand' && hh.id != null), `pick: a hand card shown to the watchers gives its id (${hand.length} in frame)`);
  ok(sc.pickFace(4, 4) === null, 'pick: a point with no card gives null');
  // play mode: the hand of the other fly is hidden
  sc.setFirstPerson(0); sc.setState(st); sc.render(1e-4);
  sc.scene.updateMatrixWorld(true); sc.camera.updateMatrixWorld();
  ok(Z.hand[1].length === 0 || Z.hand[1].every(o => o.hidden), `pick: in first person the hand of the other fly is hidden (${Z.hand[1].length} cards)`);
  let hidHits = 0, leaks = 0;
  for (let gx = 0; gx <= 64; gx++) for (let gy = 0; gy <= 36; gy++) {
    const h = sc.pickFace(gx * W / 64, gy * H / 36);
    if (h && h.zone === 'hand' && h.seat === 1) { hidHits++; if (h.id != null) leaks++; }
  }
  for (const o of Z.hand[1]) { const h = sc.pickFace(...px(o)); if (h && h.zone === 'hand' && h.seat === 1) { hidHits++; if (h.id != null) leaks++; } }
  ok(hidHits > 0 && leaks === 0, `pick: a hidden card never gives an id in play mode (${hidHits} hits, ${leaks} with an id)`);
  sc.dispose();
}

// --- size ----------------------------------------------------------------------------
for (const [vw, vh] of [[1920, 1080], [390, 844], [844, 390]]) {
  const s = zoomSize(vw, vh);
  ok(s.w <= vw && s.h <= vh && Math.abs(s.w / s.h - 5 / 7) < 0.01 && s.h >= Math.min(vh * 0.5, (vw * 0.86) * 7 / 5 - 1), `size: ${vw}x${vh} -> ${s.w}x${s.h}, 5:7, inside the view and large`);
}

// --- zoom (linkedom) ------------------------------------------------------------------
let linkedom = null;
for (const spec of ['linkedom', '/usr/local/lib/node_modules/openclaw/node_modules/linkedom/esm/index.js']) {
  try { linkedom = await import(spec); break; } catch { /* next */ }
}
if (!linkedom) console.log('cardzoom: zoom DOM part skipped (linkedom not found)');
else {
  const { document, window } = linkedom.parseHTML('<!doctype html><html><body><div id="app"><canvas id="cv"></canvas><button id="other">x</button></div></body></html>');
  const app = document.getElementById('app'), cv = document.getElementById('cv'), other = document.getElementById('other');
  const draws = [];
  const CF = { drawCard: (g, card) => draws.push(card.id), paintWithArt: (t, id, draw) => draw(null) };
  const zoom = createCardZoom(app, { CARD, CF, view: () => [1440, 900] });
  ok(zoom.el.parentNode === app && zoom.el.hidden, 'zoom: the zoom element is in #app and starts hidden');
  // linkedom has no 2D canvas: a fake context for the draw
  zoom.el.querySelector('canvas').getContext = () => ({ clearRect() {}, setTransform() {} });
  // a fake table: x < 100 is card A, 100..200 card B, 200..300 a hidden card, else nothing
  const ids = Object.keys(CARD);
  const A = ids[0], B = ids[1];
  let isActive = true;
  const pick = x => (x < 100 ? { id: A } : x < 200 ? { id: B } : x < 300 ? { id: null } : null);
  const inp = attachCardZoom(cv, zoom, { pick, active: () => isActive, doc: document });
  const ev = (el, type, props = {}) => {
    const e = new window.Event(type, { bubbles: true, cancelable: true });
    for (const [k, v] of Object.entries(props)) { try { Object.defineProperty(e, k, { value: v }); } catch { e[k] = v; } }
    el.dispatchEvent(e);
    return e;
  };
  const e1 = ev(cv, 'contextmenu', { clientX: 50, clientY: 10 });
  ok(zoom.isOpen() && zoom.id() === A && zoom.el.dataset.id === A && e1.defaultPrevented, `zoom: a right-click on a card opens it with its id (${zoom.id()}), no browser menu`);
  ev(cv, 'contextmenu', { clientX: 150, clientY: 10 });
  ok(zoom.isOpen() && zoom.id() === B, `zoom: a right-click on another card changes to it (${zoom.id()})`);
  ev(cv, 'contextmenu', { clientX: 400, clientY: 10 });
  ok(!zoom.isOpen() && zoom.id() === null, 'zoom: a right-click on no card closes it');
  ev(cv, 'contextmenu', { clientX: 250, clientY: 10 });
  ok(!zoom.isOpen(), 'zoom: a hidden card (id null) never opens');
  ev(cv, 'contextmenu', { clientX: 50, clientY: 10 });
  const e2 = ev(other, 'contextmenu', { clientX: 900, clientY: 10 });
  ok(!zoom.isOpen() && e2.defaultPrevented, 'zoom: a right-click elsewhere on the page closes it');
  ev(cv, 'contextmenu', { clientX: 50, clientY: 10 });
  ev(document, 'keydown', { key: 'Escape' });
  ok(!zoom.isOpen(), 'zoom: Escape closes it');
  isActive = false;
  const e3 = ev(cv, 'contextmenu', { clientX: 50, clientY: 10 });
  ok(!zoom.isOpen() && !e3.defaultPrevented, 'zoom: play mode (active false): the zoom input is off');
  isActive = true;
  ok(draws.includes(A) && draws.includes(B), 'zoom: the card face draws with drawCard');
  // touch
  ev(cv, 'pointerdown', { pointerType: 'touch', clientX: 150, clientY: 10 });
  await new Promise(r => setTimeout(r, 520));
  ev(cv, 'pointerup', { pointerType: 'touch', clientX: 150, clientY: 10 });
  ok(zoom.isOpen() && zoom.id() === B, 'zoom: touch: a long press on a card opens it');
  ev(cv, 'pointerdown', { pointerType: 'touch', clientX: 400, clientY: 10 });
  ev(cv, 'pointerup', { pointerType: 'touch', clientX: 400, clientY: 10 });
  ok(!zoom.isOpen(), 'zoom: touch: a tap outside the card closes it');
  ev(cv, 'pointerdown', { pointerType: 'touch', clientX: 250, clientY: 10 });
  await new Promise(r => setTimeout(r, 520));
  ev(cv, 'pointerup', { pointerType: 'touch', clientX: 250, clientY: 10 });
  ok(!zoom.isOpen(), 'zoom: touch: a long press on a hidden card does not open');
  inp.dispose(); zoom.dispose();
}

// --- wiring and look ---------------------------------------------------------------
{
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  ok(/attachCardZoom\(\$\('heroCv'\), hero\.zoom, \{\s*pick: \(x, y\) => sc\.pickFace\(x, y\),\s*active: \(\) => app\.mode === 'watch'/.test(main), 'wiring: main.js attaches the zoom to the table canvas, watch mode only');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  ok(/\.czoom\{[^}]*pointer-events:none/.test(css) && !/\.czoom\{[^}]*background/.test(css), 'look: the zoom takes no pointer events and has no veil over the screen');
  const insp = readFileSync(new URL('../ui/play/inspector.js', import.meta.url), 'utf8');
  ok(/addEventListener\('contextmenu', e => \{ e\.preventDefault\(\); close\(\); \}\)/.test(insp), 'play: a right-click closes the play inspector too');
}

console.log(`cardzoom: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
