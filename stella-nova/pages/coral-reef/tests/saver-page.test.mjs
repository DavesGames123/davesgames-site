// ============================================================================
//  CORAL REEF  ·  the saver end to end in jsdom (node, no browser)
//                 node tests/saver-page.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): the world is "explored constantly by the ROV
//  squad". The real main.js and saver.js run in jsdom on the fake WebGL2
//  (page-harness.mjs); the world jobs run on the main thread (jsdom has no
//  Worker). Two cases, one process each: 'wide' (1280 x 720, laptop-low)
//  and 'phone' (390 x 844, coarse, the phone profile). Each case:
//    enter ..... the canvas that enter() gives is #view, in the document;
//                the page UI hides (html.sn-saver and the style.css rule)
//    world ..... enter() before the world is built does not break
//    camera .... every frame: the camera in open water (rock, sand and
//                coral), the subject of the shot in the field of view
//    shots ..... the shots cut; the squad explores while the saver runs
//    plate ..... live squad stats and the real frontier score code
//    growth .... no shown coral is young (no grow-in)
//    card ...... the feed card has the cardRect place, inside the canvas
//    exit ...... the class, the feed card style and the follow camera
//                come back
//  Without jsdom (JSDOM_DIR or NODE_PATH) it skips.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const SELF = fileURLToPath(import.meta.url);
const arg = process.argv[2];
let pass = 0, fail = 0;
if (!arg) {
  for (const c of ['wide', 'phone']) {
    let out = '';
    try { out = execFileSync(process.execPath, [SELF, c], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 400000, env: process.env }); }
    catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
    for (const l of out.trim().split('\n')) {
      const m = l.match(/^CASE (OK|FAIL|SKIP) (.*)$/);
      if (m) { if (m[1] === 'OK') pass++; else if (m[1] === 'FAIL') { fail++; console.log(`FAIL ${c}: ${m[2]}`); } else console.log(`${c}: skipped (${m[2]})`); }
      else if (l.startsWith('INFO ')) console.log(`${c}: ${l.slice(5)}`);
    }
    if (!/CASE /.test(out)) { fail++; console.log(`FAIL ${c}: no result\n${out.slice(-1500)}`); }
  }
  console.log(`saver-page: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

const { bootPage, loadJsdom } = await import('./page-harness.mjs');
const say = (cond, name, info = '') => console.log(`CASE ${cond ? 'OK' : 'FAIL'} ${name}${!cond && info !== '' ? ' ' + String(info).replace(/\n/g, ' | ').slice(0, 700) : ''}`);
const info = s => console.log('INFO ' + s);
if (!loadJsdom()) { console.log('CASE SKIP jsdom not found (set JSDOM_DIR or NODE_PATH)'); process.exit(0); }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], len = a => Math.hypot(a[0], a[1], a[2]);
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b) || 1))));

const opt = arg === 'phone' ? { w: 390, h: 844, coarse: true, dpr: 3 } : { w: 1280, h: 720, coarse: false, dpr: 2, search: '?profile=laptop-low' };
const P = await bootPage(opt);
const W = P.win, doc = P.doc, $ = id => doc.getElementById(id);
const until = async (f, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await P.run(100); } return !!f(); };

// enter at once: the world is not built yet
const panelOpen0 = $('panel').classList.contains('open');
const labels = [];
const r = W.snSaver.enter({ seed: 7, calm: 0.7, label: l => { if (l) labels.push(l); } });
say(r && r.canvas === $('view') && r.canvas.isConnected, 'enter() gives #view, in the document');
say(doc.documentElement.classList.contains('sn-saver') && !$('panel').classList.contains('open'), 'the page UI hides (html.sn-saver, the panel closed)');
const css = fs.readFileSync(path.join(path.dirname(SELF), '..', 'style.css'), 'utf8');
say(/html\.sn-saver #panel,html\.sn-saver #dock,html\.sn-saver #read,html\.sn-saver #legend,html\.sn-saver #hint,/.test(css), 'style.css hides the panel, dock, readout, legend and hint in the saver');
await P.run(300);
say(P.errors.length === 0, 'enter() before the world is built gives no error', P.errors.slice(0, 2).join(' | '));
const ready = await until(() => W.__coralDebug().worldReady && W.__coralDebug().rovs > 0, 120000);
say(ready, 'the world and the squad build while the saver runs');
// sample the camera for a while: the squad explores, the shots cut
let n = 0, inWater = 0, inView = 0, worst = Infinity, worstAt = null, kinds = new Set(), hows = {}, shots = new Set();
let D = W.snSaver.debug();
const lead0 = D.squad ? D.squad[0].slice() : null;
const end = Date.now() + (opt.w > opt.h ? 30000 : 24000);
while (Date.now() < end) {
  await P.run(150);
  D = W.snSaver.debug();
  if (!D.pose || !D.cam || !D.squad) continue;
  n++;
  kinds.add(D.pose.kind); shots.add(D.shot.i); hows[D.pose.how] = (hows[D.pose.how] || 0) + 1;
  const dw = D.solid(D.cam[0], D.cam[1], D.cam[2]);
  if (dw > 0.15) inWater++;
  if (dw < worst) { worst = dw; worstAt = D.cam.map(v => +v.toFixed(2)); }
  // the subject of the shot (the squad, or the colony) in the camera view
  const a = ang(sub(D.look, D.cam), sub(D.pose.tgt, D.cam));
  if (a < (D.fov / 2) * Math.PI / 180) inView++;
}
D = W.snSaver.debug();
say(n > 20, 'the saver ran', n);
say(inWater === n, 'every frame: the camera is in open water (rock, sand and coral)', `${inWater}/${n}, worst ${worst.toFixed(2)} m at ${worstAt}`);
say(inView >= n * 0.9, 'the subject of the shot is in the field of view (90 % of the frames: a cut glides for a moment)', `${inView}/${n}`);
say(shots.size >= 2, 'the shots cut (8 to 14 s each)', `${shots.size} shots: ${[...kinds].join(', ')}`);
say(lead0 && D.squad && len(sub(D.squad[0], lead0)) > 2, 'the squad explores during the saver', lead0 ? `${len(sub(D.squad[0], lead0)).toFixed(1)} m` : 'no squad');
const L = labels[labels.length - 1];
say(L && L.title === 'ROV squad' && L.params.length === 5 && /explored/.test(L.params[0].name) && L.code && /frontierScore|novelty/.test(L.code.text), 'the plate has live squad stats and the frontier score code', L ? JSON.stringify(L.params.map(p => p.value)) : 'no label');
const age = W.__coralDebug().ageMin;
say(age === null || age > 1e4, 'no growth: the corals shown are all old (no grow-in)', `youngest ${age}`);
const f = $('feed');
if (D.card && !f.hidden) {
  const left = W.innerWidth - parseFloat(f.style.right) - parseFloat(f.style.width);
  say(Math.abs(left - D.card.left) < 1 && Math.abs(parseFloat(f.style.top) - D.card.top) < 1, 'the feed card has the cardRect place', JSON.stringify({ style: f.style.cssText, card: D.card }));
  say(D.card.left >= 0 && D.card.top >= 0 && D.card.left + D.card.w <= opt.w + 0.5 && D.card.top + D.card.h <= opt.h + 0.5, 'the feed card is inside the canvas');
} else say(false, 'the feed card shows in the saver', JSON.stringify({ hidden: f.hidden, card: D.card }));
info(`saver ${opt.w}x${opt.h} ${W.__coralDebug().profile}: ${n} samples, shots ${[...kinds].join(',')}, poses ${JSON.stringify(hows)}, worst ${worst.toFixed(2)} m, squad ${lead0 && D.squad ? len(sub(D.squad[0], lead0)).toFixed(1) : 0} m`);

// exit
W.snSaver.exit();
await P.run(600);
const X = W.__coralDebug();
say(!doc.documentElement.classList.contains('sn-saver') && f.getAttribute('style') === null && $('view').style.opacity === '', 'exit() removes the class, the card style and the fade');
say($('panel').classList.contains('open') === panelOpen0, 'exit() gives the panel back as it was', `${panelOpen0}`);
say(W.snSaver.debug().on === false && X.rovs > 0 && X.cam && X.cam.mode === 'follow', 'exit() ends the saver and the camera follows the lead ROV again', JSON.stringify(X.cam && X.cam.mode));
say(P.errors.length === 0, 'no page errors', P.errors.slice(0, 2).join(' | '));
P.close();
process.exit(0);
