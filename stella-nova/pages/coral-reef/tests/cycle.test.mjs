// ============================================================================
//  CORAL REEF  ·  CYCLE tests (node + jsdom):  node tests/cycle.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "we should have a mode where we can just
//  slowly swap back and forth between rovers (cycle button above the
//  camers)". squad-hud.js createCycle and the Cycle button of the HUD:
//    pure ...... a step each dwell; a hand selection starts the dwell
//                again; a camera input stops it for the idle time
//    hud ....... index.html in jsdom (no page script), 4 stub ROVs: with
//                Cycle on, the selection visits 2, 3, 4, 1 over 4 dwells
//                and the bar and the cards agree; a drag on the view
//                stops it, a minute of no input starts it again; the key
//                C toggles it; it is kept in localStorage; the saver does
//                not cycle
//  Without jsdom (JSDOM_DIR or NODE_PATH) the hud part skips and says so.
// ============================================================================
import fs from 'node:fs';
import { createCycle, mountSquadHud, CYCLE_DWELL } from '../squad-hud.js';
import { loadJsdom } from './page-harness.mjs';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); } };

{
  const c = createCycle({ dwell: 20, idle: 60 });
  ok(!c.step(100), 'pure: off, no step');
  c.set(true);
  let n = 0; for (let t = 0; t < 80; t += 0.5) if (c.step(0.5)) n++;
  ok(n === 4, 'pure: 4 steps in 4 dwells', n);
  c.step(15); c.picked(); ok(!c.step(10) && c.step(10), 'pure: a hand selection starts the dwell again');
  c.input(); let m = 0; for (let t = 0; t < 59; t += 1) if (c.step(1)) m++;
  ok(m === 0 && c.pause > 0, 'pure: a camera input stops it for the idle time');
  for (let t = 0; t < 21; t += 1) if (c.step(1)) m++;
  ok(m === 1, 'pure: after a minute of no input it goes on', m);
}

const JSDOM = loadJsdom();
if (!JSDOM) console.log('cycle: jsdom not found (set JSDOM_DIR or NODE_PATH): the hud part SKIPPED');
else {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://example.test/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document, $ = id => doc.getElementById(id);
  win.HTMLCanvasElement.prototype.getContext = () => null;   // no canvas package: the maps draw nothing
  let saver = false; const follows = [];
  const H = mountSquadHud({
    doc, win, THREE: null, canvas: $('view'), camera: () => null, getSquad: () => null, getField: () => null,
    getCam: () => ({ mode: 'follow' }), surfaceY: 0, phoneQ: { matches: false }, isSaver: () => saver,
    feedOn: () => true, onSelect: (id, how) => follows.push([id, how.follow, how.source]), flash: () => {},
  });
  H.setRovs({ vehicles: [1, 2, 3, 4].map(id => ({ id })), feed: null });
  const agree = (id) => H.selected === id && doc.querySelector('#rovPick button.sel').dataset.rov === String(id) && doc.querySelector('#feedSlot .fcard.main').dataset.rov === String(id);
  ok(!!$('feedCycle') && $('feedCycle').getAttribute('aria-pressed') === 'false', 'hud: the Cycle button is over the cards, off by default');
  $('feedCycle').click();
  ok(H.cycle.on && win.localStorage.getItem('coral-reef-feed-cycle') === '1', 'hud: the button sets it on and it is kept');
  const seen = [];
  for (let t = 0; t < 4 * CYCLE_DWELL + 0.5; t += 0.25) { const s0 = H.selected; H.tick(0.25); if (H.selected !== s0) { seen.push(H.selected); if (!agree(H.selected)) ok(false, 'hud: the bar, the cards and the selection agree', H.selected); } }
  ok(seen.join() === '2,3,4,1', 'hud: with Cycle on, the selection visits all 4 ROVs in order over 4 dwells', seen.join());
  ok(follows.slice(-4).every(f => f[1] === true), 'hud: each cycle step asks the follow camera to go to the ROV (a glide in main.js)', JSON.stringify(follows.slice(-4)));
  $('view').dispatchEvent(new win.Event('pointerdown'));
  const s1 = H.selected; for (let t = 0; t < 55; t += 0.5) H.tick(0.5);
  ok(H.selected === s1 && H.cycle.on, 'hud: a drag on the view stops the cycle (it stays on)', H.selected);
  for (let t = 0; t < CYCLE_DWELL + 6; t += 0.5) H.tick(0.5);
  ok(H.selected !== s1, 'hud: after a minute with no input the cycle goes on');
  win.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyC', key: 'c' }));
  ok(!H.cycle.on && $('feedCycle').getAttribute('aria-pressed') === 'false', 'hud: the key C sets it off');
  win.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyC', key: 'c' }));
  saver = true; const s2 = H.selected; for (let t = 0; t < 3 * CYCLE_DWELL; t += 0.5) H.tick(0.5);
  ok(H.cycle.on && H.selected === s2, 'hud: the saver does not cycle');
  win.close();
}
console.log(`cycle: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
