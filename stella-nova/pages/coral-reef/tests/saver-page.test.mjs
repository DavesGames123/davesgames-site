// ============================================================================
//  CORAL REEF  ·  the saver end to end in jsdom (node, no browser)
//                 node tests/saver-page.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-17): "tjhe screensaver was fucked up". The real
//  main.js and saver.js run in jsdom on the fake WebGL2 (page-harness.mjs);
//  the reef runs on the main thread (jsdom has no Worker). Two cases, one
//  process each: 'wide' (1280 x 720, laptop-low) and 'phone' (390 x 844,
//  coarse, the phone profile). Each case:
//    enter ..... the canvas that enter() gives is #view, in the document;
//                the page UI hides (html.sn-saver and the style.css rule)
//    world ..... enter() before the world is built does not break: the
//                dive waits for the rock and the reef worker 'ready'
//    colony .... the dive site is open rock in the plot; the colony gets
//                particles in single-colony mode, and grows
//    camera .... every frame: the camera in open water (rock.sdfAll), the
//                colony in front of it (in the field of view)
//    rov ....... one ROV in view (the others hidden), placed beside the
//                site; its camera looks at the colony, less than 10 m away
//    card ...... the feed card has the cardRect place, inside the canvas
//    exit ...... the class, the feed card style, the ROVs and the reef
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
const r = W.snSaver.enter({ seed: 7, calm: 0.7, label: () => {} });
say(r && r.canvas === $('view') && r.canvas.isConnected, 'enter() gives #view, in the document');
say(doc.documentElement.classList.contains('sn-saver') && !$('panel').classList.contains('open'), 'the page UI hides (html.sn-saver, the panel closed)');
const css = fs.readFileSync(path.join(path.dirname(SELF), '..', 'style.css'), 'utf8');
say(/html\.sn-saver #panel,html\.sn-saver #dock,html\.sn-saver #read,html\.sn-saver #legend,html\.sn-saver #hint,\s*html\.sn-saver #gear,html\.sn-saver \.topbar,html\.sn-saver #about,html\.sn-saver #plantBar,html\.sn-saver #tapMark\{display:none!important\}/.test(css), 'style.css hides the panel, dock, readout, legend, hint, gear, topbar, explainer, plant bar and tap mark in the saver');
await P.run(300);
say(P.errors.length === 0, 'enter() before the world is built gives no error', P.errors.slice(0, 2).join(' | '));
const ready = await until(() => W.__coralDebug().worldReady && W.__coralDebug().coral && W.__coralDebug().coral.ready, 90000);
say(ready, 'the world builds while the saver waits');
const started = await until(() => { const d = W.snSaver.debug(); return d.dive && d.colony && d.colony.count > 5; }, 60000);
let D = W.snSaver.debug();
say(started, 'a dive starts and its colony gets particles (single-colony mode)', JSON.stringify(D.colony));
const sdf = D.sdfAll, k = D.rock ? D.rock.sdfScale : 1;
if (D.site) {
  const p = D.site.p, n = D.site.n, q = [p[0] + n[0], p[1] + n[1], p[2] + n[2]];
  say(Math.hypot(p[0], p[2]) < 24.5 && n[1] > 0.25 && sdf(q[0], q[1], q[2]) / k > 0.3, 'the site is open, up-facing rock in the plot', JSON.stringify(D.site));
}
const c0 = D.colony ? D.colony.count : 0;
// sample the camera for a while
let n = 0, inWater = 0, inView = 0, worst = Infinity, worstAt = null, kinds = new Set(), hows = {};
const fov = 50;
const end = Date.now() + 24000;
while (Date.now() < end) {
  await P.run(150);
  D = W.snSaver.debug();
  if (!D.pose || !D.cam) continue;
  n++;
  kinds.add(D.pose.kind); hows[D.pose.how] = (hows[D.pose.how] || 0) + 1;
  const dw = sdf(D.cam[0], D.cam[1], D.cam[2]) / k;
  if (dw > 0.15) inWater++;
  if (dw < worst) { worst = dw; worstAt = D.cam.map(v => +v.toFixed(2)); }
  // the colony in the view of the goal pose
  const a = ang(sub(D.pose.tgt, D.pose.pos), sub(D.pose.c, D.pose.pos));
  if (a < (fov / 2) * Math.PI / 180) inView++;
}
D = W.snSaver.debug();
say(n > 20, 'the saver ran shots', n);
say(inWater === n, 'every frame: the camera is in open water (rock and sand)', `${inWater}/${n}, worst ${worst.toFixed(2)} m at ${worstAt}`);
say(inView === n, 'every frame: the colony is in the field of view of the shot', `${inView}/${n}`);
say(D.colony && D.colony.count > c0, 'the colony grows during the dive', `${c0} -> ${D.colony && D.colony.count}`);
say(D.rov && D.rov.visible && D.hidden !== false, 'one ROV is in view, the others are hidden');
if (D.rov && D.rov.cam && D.rov.target && D.pose) {
  const dt = len(sub(D.rov.target, D.pose.c)), a = ang(sub(D.rov.target, D.rov.cam), sub(D.pose.c, D.rov.cam)) * 180 / Math.PI;
  say(a < (D.rov.fov || 60) / 2, 'the ROV camera looks at the colony', `angle ${a.toFixed(1)} deg, target ${dt.toFixed(2)} m from the colony`);
  // near: the ROV inspects from between near = 1.6 r + 1.6 m and far =
  // 1.6 near + 1.5 m of a colony of radius r (rov/pilot.js), so a tall
  // colony (one trunk, branches up to its full size) sets the limit past 10 m
  const near = Math.max(10, Math.max(1.6 * (D.pose.r || 0) + 1.6, 2.2) * 1.6 + 1.5);
  say(len(sub(D.rov.cam, D.pose.c)) < near, 'the ROV is near the colony (it starts beside the site)', `${len(sub(D.rov.cam, D.pose.c)).toFixed(1)} m, limit ${near.toFixed(1)} m (colony radius ${(D.pose.r || 0).toFixed(2)} m)`);
  info(`rov: camera ${len(sub(D.rov.cam, D.pose.c)).toFixed(1)} m from the colony, angle ${a.toFixed(1)} deg`);
}
const f = $('feed');
if (D.card && !f.hidden) {
  const left = W.innerWidth - parseFloat(f.style.right) - parseFloat(f.style.width);
  say(Math.abs(left - D.card.left) < 1 && Math.abs(parseFloat(f.style.top) - D.card.top) < 1, 'the feed card has the cardRect place', JSON.stringify({ style: f.style.cssText, card: D.card }));
  say(D.card.left >= 0 && D.card.top >= 0 && D.card.left + D.card.w <= opt.w + 0.5 && D.card.top + D.card.h <= opt.h + 0.5, 'the feed card is inside the canvas');
} else say(false, 'the feed card shows in the saver', JSON.stringify({ hidden: f.hidden, card: D.card }));
info(`saver ${opt.w}x${opt.h} ${W.__coralDebug().profile}: ${n} samples, shots ${[...kinds].join(',')}, poses ${JSON.stringify(hows)}, colony ${c0} -> ${D.colony && D.colony.count}, worst ${worst.toFixed(2)} m`);

// exit
const gen0 = W.__coralDebug().coral.count;
W.snSaver.exit();
await P.run(600);
const X = W.__coralDebug();
say(!doc.documentElement.classList.contains('sn-saver') && f.getAttribute('style') === null && $('view').style.opacity === '', 'exit() removes the class, the card style and the fade');
say($('panel').classList.contains('open') === panelOpen0, 'exit() gives the panel back as it was', `${panelOpen0}`);
say(W.snSaver.debug().on === false && X.rovs > 0, 'exit() ends the saver');
const all = await until(() => { const d = W.__coralDebug(); return d.coral && d.coral.colonies > 1; }, 30000);
say(all, 'exit() regrows the full reef (more than one colony)', JSON.stringify(W.__coralDebug().coral));
say(P.errors.length === 0, 'no console errors in the run', P.errors.slice(0, 3).join(' | '));
P.close();
process.exit(0);
