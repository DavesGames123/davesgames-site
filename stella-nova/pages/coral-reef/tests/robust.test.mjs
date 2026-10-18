// ============================================================================
//  CORAL REEF  ·  robustness tests (node + jsdom, no browser)
//                 node tests/robust.test.mjs
// ----------------------------------------------------------------------------
//  The real main.js boots in jsdom on the fake WebGL2 (tests/page-harness.mjs).
//  Each case runs in its own node process (main.js keeps timers):
//    shader ..... a fragment shader that does not compile shows the error
//                 box with the shader log and the source line
//    lost ....... a context loss reloads one time, one profile lower
//                 (sessionStorage), and a second loss stops with a message
//    worker ..... no module Worker, and a Worker that fails: the rock and
//                 the reef fall back to the main thread, the reef grows
//    errors ..... window error and unhandledrejection show in the box
//    phone ...... a coarse 390 x 844 boots with the phone profile loads
//  coral-link.js alone: the replay of the state after a worker failure.
//  Without jsdom (JSDOM_DIR or NODE_PATH) the page cases skip.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCoralLink, halfBudget } from '../coral-link.js';

const SELF = fileURLToPath(import.meta.url);
const arg = process.argv[2];
let pass = 0, fail = 0;
function ok(cond, name, info = '') { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${info !== '' ? ' ' + info : ''}`); } }

class CrashWorker {
  constructor() { this.posted = []; setTimeout(() => { if (this.onerror) this.onerror({ message: 'fake worker crash', preventDefault() {} }); }, 30); }
  postMessage(m) { this.posted.push(m); }
  terminate() { this.dead = true; }
}

if (!arg) {
  // ── coral-link.js on its own ────────────────────────────────────────────
  {
    const got = [], seen = [];
    let w = null;
    const link = createCoralLink({
      makeWorker: () => (w = { postMessage: m => seen.push(m.type), terminate() { this.dead = true; } }),
      makeRunner: post => ({ onMessage: m => got.push(m) }),
      onMessage: () => {}, onFallback: why => got.push({ type: 'fallback', why }),
    });
    link.post({ type: 'init', seed: 3, quality: 'mid', budget: { particles: 60000, tris: 1300000, colonies: 44 } });
    link.post({ type: 'current', deg: 40, strength: 0.3 });
    link.post({ type: 'env', env: { speed: 2 } }); link.post({ type: 'env', env: { temp: 29 } });
    link.post({ type: 'single', site: { p: [0, 1, 0], n: [0, 1, 0] }, species: 'fan', rate: 0 });
    link.post({ type: 'rate', value: 12 });
    ok(seen.join() === 'init,current,env,env,single,rate' && !link.local, 'link: messages go to the worker while it works', seen.join());
    w.onerror({ message: 'boom' });
    const types = got.map(m => m.type);
    ok(link.local && w.dead, 'link: a worker error stops the worker and starts the main-thread runner');
    ok(types[0] === 'fallback' && types[1] === 'budget' && types[2] === 'init', 'link: the runner gets its slice budget, then the init', types.join());
    const init = got.find(m => m.type === 'init');
    ok(init && init.budget.particles === 30000 && init.budget.tris === 650000, 'link: the init replays with half the particles and triangles', JSON.stringify(init && init.budget));
    ok(types.includes('current') && types.includes('rate') && types[types.length - 1] === 'single', 'link: current, rate and the last single replay, the single last', types.join());
    const env = got.find(m => m.type === 'env');
    ok(env && env.env.speed === 2 && env.env.temp === 29, 'link: the env messages merge into one');
    link.post({ type: 'play', on: false });
    ok(got[got.length - 1].type === 'play', 'link: later messages go to the runner');
    const g2 = [];
    const l2 = createCoralLink({ makeWorker: () => { throw new Error('no module workers'); }, makeRunner: () => ({ onMessage: m => g2.push(m.type) }), onMessage() {} });
    ok(l2.local && /no module worker/.test(l2.why), 'link: no Worker class gives the runner at once', l2.why);
    const g3 = [];
    let w3 = null;
    const l3 = createCoralLink({ makeWorker: () => (w3 = { postMessage() {}, terminate() {} }), makeRunner: () => ({ onMessage: m => g3.push(m.type) }), onMessage() {} });
    l3.post({ type: 'init', budget: {} });
    w3.onmessage({ data: { type: 'error', message: 'Error: rock import failed' } });
    ok(l3.local && /rock import failed/.test(l3.why), 'link: an error message before ready falls back', l3.why);
    ok(halfBudget({ particles: 6000, tris: 120000, colonies: 10 }).particles === 4000, 'link: the lower budget has a floor');
  }
  // ── the page cases, one process each ─────────────────────────────────────
  for (const c of ['shader', 'lost', 'lost2', 'worker', 'errors', 'phone']) {
    let out = '';
    try { out = execFileSync(process.execPath, [SELF, c], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240000, env: process.env }); }
    catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
    for (const l of out.trim().split('\n')) {
      const m = l.match(/^CASE (OK|FAIL|SKIP) (.*)$/);
      if (m) { if (m[1] === 'OK') pass++; else if (m[1] === 'FAIL') { fail++; console.log(`FAIL ${c}: ${m[2]}`); } else console.log(`${c}: skipped (${m[2]})`); }
      else if (l.startsWith('INFO ')) console.log(`${c}: ${l.slice(5)}`);
    }
    if (!/CASE /.test(out)) { fail++; console.log(`FAIL ${c}: no result\n${out.slice(-1500)}`); }
  }
  console.log(`robust: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// ── one page case (child process) ──────────────────────────────────────────
const { bootPage, loadJsdom } = await import('./page-harness.mjs');
const say = (cond, name, info = '') => console.log(`CASE ${cond ? 'OK' : 'FAIL'} ${name}${!cond && info !== '' ? ' ' + String(info).replace(/\n/g, ' | ').slice(0, 600) : ''}`);
const info = s => console.log('INFO ' + s);
if (!loadJsdom()) { console.log('CASE SKIP jsdom not found (set JSDOM_DIR or NODE_PATH)'); process.exit(0); }
const until = async (P, f, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await P.run(100); } return !!f(); };

if (arg === 'shader') {
  const P = await bootPage({ w: 1280, h: 720, search: '?profile=phone', gl: { compileError: 'uDebugNaN' } });
  await P.run(800);
  const D = P.win.__coralDebug(), boxEl = P.doc.getElementById('errBox');
  const txt = boxEl ? boxEl.textContent : '';
  say(boxEl && !boxEl.hidden && /shader did not compile/.test(txt), 'a shader that does not compile shows the error box', txt.slice(0, 200));
  say(/uDebugNaN/.test(txt) && /fragment:/.test(txt) && /ERROR: 0:12/.test(txt), 'the box has the shader log and the source line', txt.slice(0, 400));
  say(/Copy/.test(boxEl ? boxEl.querySelector('.eb-copy').textContent : ''), 'the box has a Copy button');
  info(`shader box: ${txt.replace(/\s+/g, ' ').slice(0, 160)}`);
  P.close(); process.exit(0);
}
if (arg === 'lost') {
  const P = await bootPage({ w: 1440, h: 900, search: '?profile=laptop-low' });
  let reloads = 0; P.win.__coralReload = () => { reloads++; };
  await P.run(400);
  const e = P.fake.loseContext();
  say(e.defaultPrevented, 'webglcontextlost: the page calls preventDefault (so the context can come back)');
  await P.run(1800);
  const D = P.win.__coralDebug();
  say(reloads === 1, 'a context loss reloads the page one time', reloads);
  say(P.win.sessionStorage.getItem('coral-reef-profile') === 'phone', 'the reload is one profile lower (laptop-low -> phone)', P.win.sessionStorage.getItem('coral-reef-profile'));
  say(D.lostNow && /lost/.test(P.doc.getElementById('errBox').textContent), 'the box says that the GPU context was lost');
  info(`context loss: laptop-low -> reload ${reloads}, next profile ${P.win.sessionStorage.getItem('coral-reef-profile')}`);
  P.close(); process.exit(0);
}
if (arg === 'lost2') {
  const st = JSON.stringify({ losses: 1, at: Date.now() - 5000 });
  const P = await bootPage({ w: 1440, h: 900, search: '?profile=laptop-low', session: { 'coral-reef-profile': 'phone', 'coral-reef-lost': st } });
  let reloads = 0; P.win.__coralReload = () => { reloads++; };
  await P.run(300);
  say(P.win.__coralDebug().profile === 'phone', 'after the reload the lowered profile wins over ?profile=', P.win.__coralDebug().profile);
  P.fake.loseContext();
  await P.run(1800);
  const txt = P.doc.getElementById('errBox').textContent;
  say(reloads === 0 && /lost again/.test(txt), 'a second loss stops with a message and no reload', `${reloads} ${txt.slice(0, 120)}`);
  info(`second loss: reloads ${reloads}, "${txt.replace(/\s+/g, ' ').slice(0, 90)}"`);
  P.close(); process.exit(0);
}
if (arg === 'worker') {
  const P = await bootPage({ w: 1280, h: 720, search: '?profile=phone', worker: CrashWorker });
  const grew = await until(P, () => { const d = P.win.__coralDebug(); return d.coral && d.coral.count > 50; }, 60000);
  const D = P.win.__coralDebug();
  say(D.rockQuality === 'low', 'a failed rock worker gives the low rock on the main thread', D.rockQuality);
  say(D.coral && D.coral.local && /reef worker stopped/.test(D.coral.why), 'a failed reef worker gives the main-thread runner', D.coral && D.coral.why);
  say(grew, 'the reef grows on the main thread', D.coral && D.coral.count);
  say(D.coral && D.coral.budget && D.coral.budget.particles === 25000, 'the page budget is the phone budget (the runner gets half of it)');
  const txt = P.doc.getElementById('errBox').textContent;
  say(/main thread/.test(txt), 'the box notes the fall back', txt.slice(0, 160));
  info(`worker fall back: rock ${D.rockQuality}, reef local ${D.coral && D.coral.local}, ${D.coral && D.coral.count} particles, "${D.coral && D.coral.why}"`);
  P.close(); process.exit(0);
}
if (arg === 'errors') {
  const P = await bootPage({ w: 1280, h: 720, search: '?profile=phone' });
  await P.run(200);
  const W = P.win;
  W.dispatchEvent(new W.ErrorEvent('error', { message: 'TypeError: x is undefined', filename: 'https://davesgames.io/stella-nova/pages/coral-reef/main.js', lineno: 12, colno: 3 }));
  let txt = P.doc.getElementById('errBox').textContent;
  say(!P.doc.getElementById('errBox').hidden && /x is undefined/.test(txt) && /main\.js:12:3/.test(txt), 'window error shows in the box with the place', txt.slice(0, 200));
  const ev = new W.Event('unhandledrejection'); ev.reason = new Error('fetch failed: tex.webp');
  W.dispatchEvent(ev);
  txt = P.doc.getElementById('errBox').textContent;
  say(/fetch failed/.test(txt) && /2 messages/.test(txt), 'unhandledrejection shows in the box too', txt.slice(0, 200));
  W.dispatchEvent(new W.ErrorEvent('error', { message: 'Script error.' }));
  say(P.win.__coralDebug().box === 2 + (P.win.__coralDebug().coral && P.win.__coralDebug().coral.local ? 1 : 0), '"Script error." (no detail) does not show');
  P.doc.querySelector('#errBox .eb-x').dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
  say(P.doc.getElementById('errBox').hidden, 'the close button hides the box');
  P.close(); process.exit(0);
}
if (arg === 'phone') {
  const P = await bootPage({ w: 390, h: 844, coarse: true, dpr: 3, ua: 'iPhone' });
  const ready = await until(P, () => P.win.__coralDebug().worldReady, 60000);
  const D = P.win.__coralDebug();
  say(D.profile === 'phone', 'coarse 390 x 844 boots with the phone profile', D.profile);
  say(ready && D.rockQuality === 'low' && D.quality === 'phone' && D.rovs === 2, 'phone: low rock, Few colonies, 2 ROVs', JSON.stringify({ r: D.rockQuality, q: D.quality, rovs: D.rovs }));
  say(D.loads && D.loads.shadow === 1024 && D.loads.volScale === 0.35 && D.loads.polypDraw === 30000, 'phone: the scene loads come from the profile', JSON.stringify(D.loads));
  const pr = P.fake.canvas.width / 390;
  say(pr <= 1.5 + 1e-6, 'phone: the pixel ratio is at most 1.5', pr);
  const q = [...P.doc.querySelectorAll('#quality button')];
  say(q.length === 3 && q.filter(b => b.disabled).length === 2, 'phone: the Many and Most chips are off', q.map(b => `${b.dataset.id}${b.disabled ? ' off' : ''}`).join());
  say(D.post && D.post.on && !D.post.failed, 'phone: the post chain passes its first-frame check', JSON.stringify(D.post));
  say(P.errors.length === 0, 'phone: no console errors', P.errors.slice(0, 3).join(' | '));
  info(`phone boot: ${JSON.stringify({ profile: D.profile, rock: D.rockQuality, quality: D.quality, rovs: D.rovs, pr, colonies: D.coral && D.coral.colonies, local: D.coral && D.coral.local })}`);
  P.close(); process.exit(0);
}
