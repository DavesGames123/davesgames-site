// ============================================================================
//  CORAL REEF  ·  the default camera follows an ROV (node + jsdom, no browser)
//                 node tests/follow.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-17): "focus on rov's by default". The real main.js
//  boots in jsdom on the fake WebGL2 (page-harness.mjs). Checks:
//    default ... when the ROVs exist, the camera is in 'follow' on the
//                feed ROV and the camera bar shows Follow as on
//    choice .... a camera bar pick (orbit) holds when the ROVs are built
//                again (the ROV count chips) and after the saver
//    saver ..... with no user pick, the saver exit goes back to follow
//    new world . a new seed clears the pick: the camera follows again
//  Without jsdom (JSDOM_DIR or NODE_PATH) it skips.
// ============================================================================
const { bootPage, loadJsdom } = await import('./page-harness.mjs');
let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name} ${info}`); } };
if (!loadJsdom()) { console.log('follow: jsdom not found (set JSDOM_DIR or NODE_PATH), skipped'); console.log('follow: 0 passed, 0 failed'); process.exit(0); }

const P = await bootPage({ w: 1280, h: 720, dpr: 1, search: '?profile=laptop-low' });
const W = P.win, $ = id => P.doc.getElementById(id);
const dbg = () => { const d = W.__coralDebug(); return Object.assign({ camOn: [] }, d, { cam: d.cam || {} }); };
const until = async (f, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await P.run(100); } return !!f(); };
const camStr = () => JSON.stringify(dbg().cam) + ' on=' + dbg().camOn.join(',');
const click = sel => $('camBar').querySelector(`button[data-cam="${sel}"]`).click();

const built = await until(() => dbg().worldReady && dbg().rovs > 0, 120000);
ok(built, 'the world and the ROVs are built');
await P.run(200);
let c = dbg().cam;
ok(c && c.mode === 'follow' && c.followId === 1 && !c.choice, 'default: the camera follows the feed ROV (ROV 1) when the ROVs exist', camStr());
ok(dbg().camOn.length === 1 && dbg().camOn[0] === 'follow', 'default: the camera bar shows Follow as on', camStr());
ok(/ROV 1/.test($('camFollowLbl').textContent), 'default: the Follow label names the ROV', $('camFollowLbl').textContent);

// a user pick holds
click('orbit');
await P.run(200);
ok(dbg().cam.mode === 'orbit' && dbg().cam.choice === 'orbit', 'choice: the Orbit button gives orbit', camStr());
const chip = [...$('rovCount').querySelectorAll('button')].find(b => !b.classList.contains('on'));
chip.click();
await P.run(400);
ok(dbg().rovs > 0 && dbg().cam.mode === 'orbit', 'choice: orbit holds when the ROVs are built again', camStr());
W.snSaver.enter({ seed: 3, calm: 0.7, label: () => {} });
await P.run(600);
ok(dbg().cam.mode === 'saver', 'saver: the saver has its own camera', camStr());
W.snSaver.exit();
await P.run(200);
ok(dbg().cam.mode === 'orbit', 'choice: orbit holds after the saver', camStr());

// a new world: follow again
$('bSeed').click();
await P.run(300);
const rebuilt = await until(() => dbg().worldReady && dbg().rovs > 0, 120000);
await P.run(200);
ok(rebuilt && dbg().cam.mode === 'follow' && !dbg().cam.choice, 'new world: a new seed clears the pick and the camera follows an ROV', camStr());

// the saver exit with no pick: follow, not orbit
W.snSaver.enter({ seed: 5, calm: 0.7, label: () => {} });
await P.run(600);
W.snSaver.exit();
await P.run(200);
ok(dbg().cam.mode === 'follow' && dbg().camOn.join() === 'follow', 'saver: the exit with no user pick follows the ROV again', camStr());
ok(P.errors.length === 0, 'no page errors', P.errors.slice(0, 2).join(' | '));
P.close();
console.log(`follow: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
