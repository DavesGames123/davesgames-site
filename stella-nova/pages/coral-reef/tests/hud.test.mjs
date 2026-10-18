// ============================================================================
//  CORAL REEF  ·  the squad HUD on the page: cards, selection (node + jsdom)
//                 node tests/hud.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "we should be able to see the camera from all
//  three ROV's on the right side and a minimap on the bottom left of what
//  they've explored so far. we should be able to select each ROV
//  individually and highlight it with this menu". The real main.js boots in
//  jsdom on the fake WebGL2 (page-harness.mjs). Checks:
//    page ...... N cards and N bar buttons for N ROVs; a bar click, a card
//                tap and the keys 1 to 4 select, and the bar, the cards,
//                the tags, the minimap, the feed main and the follow camera
//                agree; orbit keeps the mark; all feeds render, the
//                selected one the most; the minimap follows the selected
//                ROV; 4 ROVs give 4 cards; the saver keeps one card (the
//                lead, at the cardRect place) and gives the selection back
//    phone ..... one card with tabs, the map folded, only the shown card
//                renders, a tap makes the card large
//  tests/feeds.test.mjs has the render budget, tests/minimap.test.mjs the
//  map. Without jsdom (JSDOM_DIR or NODE_PATH) it skips and says so.
// ============================================================================
let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name} ${info}`); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ── the page in jsdom ──────────────────────────────────────────────────────
const { bootPage, loadJsdom } = await import('./page-harness.mjs');
if (!loadJsdom()) {
  console.log('hud: jsdom not found (set JSDOM_DIR or NODE_PATH): the page part SKIPPED');
} else {
  const P = await bootPage({ w: 1280, h: 720, dpr: 1, search: '?profile=laptop-low' });
  const W = P.win, $ = id => P.doc.getElementById(id);
  const dbg = () => W.__coralDebug();
  const until = async (f, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await P.run(100); } return !!f(); };
  const built = await until(() => dbg().worldReady && dbg().rovs > 0, 120000);
  ok(built, 'page: the world and the ROVs are built');
  await P.run(600);
  const agree = (id) => { const d = dbg(), h = d.hud; return h.sel === id && +h.mainCard === id && h.barSel.join() === String(id) && h.tagSel.join() === String(id) && h.feedMain === id && d.cam.followId === id && d.cam.mode === 'follow' && (!h.map || h.map.selArrow === id); };
  const state = () => { const d = dbg(), h = d.hud; return JSON.stringify({ sel: h.sel, main: h.mainCard, bar: h.barSel, tag: h.tagSel, feed: h.feedMain, cam: d.cam.followId, mode: d.cam.mode, arrow: h.map && h.map.selArrow }); };
  let h = dbg().hud;
  const n = dbg().rovs;
  ok(n === 4 && h.cards.join() === '1,2,3,4' && $('rovPick').querySelectorAll('button').length === 4, 'page: 4 ROVs (the default, the user: "four ROV\'s total please") give 4 feed cards and 4 ROV buttons on the camera bar', JSON.stringify(h.cards));
  ok(agree(1), 'page: by default ROV 1 is selected everywhere and followed', state());
  ok([...$('feedSlot').querySelectorAll('.fcard canvas')].length === 4, 'page: each card holds the HUD canvas of its own feed');
  $('rovPick').querySelector('button[data-rov="2"]').click();
  await P.run(300);
  ok(agree(2), 'page: a click on ROV 2 in the camera bar selects it in the bar, the cards, the tags, the minimap, the feed and the follow camera', state());
  ok(dbg().camOn.join() === 'follow' && /ROV 2/.test($('camFollowLbl').textContent), 'page: the bar shows the followed ROV as on and says so', dbg().camOn.join() + ' ' + $('camFollowLbl').textContent);
  $('feedSlot').querySelector('.fcard[data-rov="3"] .fpick').click();
  await P.run(300);
  ok(agree(3), 'page: a tap on the small card of ROV 3 selects it', state());
  W.dispatchEvent(new W.KeyboardEvent('keydown', { code: 'Digit1', key: '1' }));
  await P.run(300);
  ok(agree(1), 'page: the key 1 selects ROV 1', state());
  W.dispatchEvent(new W.KeyboardEvent('keydown', { code: 'Numpad2', key: '2' }));
  await P.run(300);
  ok(agree(2), 'page: the keypad key 2 selects ROV 2', state());
  W.dispatchEvent(new W.KeyboardEvent('keydown', { code: 'Digit4', key: '4' }));
  await P.run(300);
  ok(agree(4), 'page: with 4 ROVs the key 4 selects ROV 4', state());
  W.dispatchEvent(new W.KeyboardEvent('keydown', { code: 'Digit2', key: '2' }));
  await P.run(300);
  // the camera bar Orbit: the selection holds, the ROV button is not on
  $('camBar').querySelector('button[data-cam="orbit"]').click();
  await P.run(200);
  ok(dbg().cam.mode === 'orbit' && dbg().hud.sel === 2 && dbg().hud.barSel.join() === '2' && dbg().camOn.join() === 'orbit', 'page: in orbit the selected ROV keeps its mark on the bar and the follow button is off', state() + dbg().camOn.join());
  W.dispatchEvent(new W.KeyboardEvent('keydown', { code: 'Digit3', key: '3' }));
  await P.run(300);
  ok(agree(3), 'page: a key in orbit selects and follows that ROV', state());
  // the feed render budget on the page: the set of the page counts its renders
  const st0 = dbg().hud.feedStats, t0 = Date.now();
  await P.run(2000);
  const st1 = dbg().hud.feedStats;
  const per = Object.fromEntries(Object.keys(st1.perId).map(k => [k, st1.perId[k] - (st0.perId[k] || 0)]));
  ok(per[3] > per[1] && per[3] > per[2] && per[1] > 0 && per[2] > 0, 'page: all three feeds render, the selected one the most', JSON.stringify(per) + ` in ${Date.now() - t0} ms`);
  // the minimap follows the selected ROV
  const m = dbg().hud.map, L = dbg().squad.p[2];
  ok(m && near(m.view.cx, L[0], 3) && near(m.view.cz, L[2], 3) && m.painted > 0, 'page: the minimap is centred on the selected ROV and shows explored cells', JSON.stringify(m && m.view) + ' painted ' + (m && m.painted));
  // 3 ROVs (the squad-size control)
  const b3 = $('rovCount') && $('rovCount').querySelector('button[data-id="3"]');
  if (b3) b3.click();
  const want3 = await until(() => dbg().rovs === 3 && dbg().hud.cards.length === 3, 20000);
  if (want3) {
    ok(dbg().hud.cards.join() === '1,2,3' && $('rovPick').querySelectorAll('button').length === 3 && agree(3), 'page: 3 ROVs give 3 cards and 3 buttons; the selection holds', state());
    W.dispatchEvent(new W.KeyboardEvent('keydown', { code: 'Digit4', key: '4' }));
    await P.run(300);
    ok(dbg().hud.sel === 3, 'page: the key 4 does nothing with 3 ROVs', state());
  } else ok(false, 'page: the ROV count control gives 3 ROVs', `${dbg().rovs} ROVs`);
  // the saver: one card, the lead, at the cardRect place
  W.snSaver.enter({ seed: 3, calm: 0.7, label: () => {} });
  await P.run(1200);
  const sv = W.snSaver.debug();
  ok(dbg().hud.feedMain === 1 && dbg().hud.mainCard === '1' && sv.card && Math.abs(parseFloat($('feed').style.width) - sv.card.w) < 1, 'page: the saver shows the lead feed as the one card at the cardRect place', JSON.stringify({ main: dbg().hud.mainCard, card: sv.card, style: $('feed').style.cssText }));
  W.snSaver.exit();
  await P.run(300);
  ok(dbg().hud.sel === 3 && dbg().cam.followId === 3, 'page: the saver exit gives the selection back and follows it', state());
  ok(P.errors.length === 0, 'page: no console errors', P.errors.slice(0, 3).join(' | '));
  P.close();

  // the phone: one card with tabs, the map folded
  const Q = await bootPage({ w: 390, h: 844, dpr: 2, coarse: true, search: '?profile=phone' });
  const W2 = Q.win, $2 = id => Q.doc.getElementById(id), d2 = () => W2.__coralDebug();
  const until2 = async (f, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await Q.run(100); } return !!f(); };
  await until2(() => d2().worldReady && d2().rovs > 0, 120000);
  await Q.run(600);
  const nn = d2().rovs;
  ok($2('feed').classList.contains('one') && $2('feedTabs').querySelectorAll('button').length === nn && d2().hud.layout.one, 'phone: the feed shows one card with a tab for each ROV', `${nn} ROVs, tabs ${$2('feedTabs').querySelectorAll('button').length}`);
  ok($2('minimap').classList.contains('fold') && $2('mmFold').getAttribute('aria-expanded') === 'false', 'phone: the minimap starts folded');
  $2('feedTabs').querySelector('button[data-rov="2"]').click();
  await Q.run(300);
  ok(d2().hud.sel === 2 && d2().hud.mainCard === '2' && d2().cam.followId === 2, 'phone: a tab selects its ROV and its card shows', JSON.stringify(d2().hud.mainCard));
  const s0 = d2().hud.feedStats;
  await Q.run(1500);
  const s1 = d2().hud.feedStats, got = Object.keys(s1.perId).map(k => [k, s1.perId[k] - (s0.perId[k] || 0)]);
  ok(got.every(([k, v]) => (k === '2' ? v > 0 : v === 0)), 'phone: only the shown card renders live frames', JSON.stringify(got));
  $2('feedSlot').querySelector('.fcard[data-rov="2"] .fpick').click();
  ok($2('feed').classList.contains('big'), 'phone: a tap on the card makes it large');
  $2('mmFold').click();
  ok(!$2('minimap').classList.contains('fold'), 'phone: the fold button opens the map');
  ok(Q.errors.length === 0, 'phone: no console errors', Q.errors.slice(0, 3).join(' | '));
  Q.close();
}

console.log(`hud: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
