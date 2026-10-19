// ============================================================================
//  POOL PHYSICS  ·  tests/page.test.mjs — the page in jsdom (no browser)
// ----------------------------------------------------------------------------
//  desktop boot ... 2D and 3D (fake WebGL2) draw, the panel has its five
//                   sections, the AI plays turns, the maths cards carry the
//                   plain-text fallback (MathJax does not load in jsdom)
//  take over ...... a tap on the 2D view plans the shot; the strike card
//                   shows; the planner's predicted paths equal the paths
//                   the shot then takes (no spin)
//  phone .......... 390 x 844 touch: boots, panel closed, a tall 2D pane
//                   turns the table up the screen
//  no layout shift . the user: "the pool captions often resize the layouts
//                   in 2d and in 3d": over a full sequence of shots (and a
//                   layout() call every frame, as a resize observer would)
//                   the 2D canvas and the 3D buffer keep their sizes; the
//                   CSS gives the header lines, the maths cards and their
//                   equation boxes fixed heights (tools/css-viewport.mjs)
//  phone order ..... "the mobile layout should only focus the 2d version
//                   with the last few computations ... then you should be
//                   able to scroll down to find the 3d version": at 390 x
//                   844 the page scrolls in one column: the 2D diagram, the
//                   last four maths steps, the 3D table
//  saver .......... enter / cuts / label (no code) / exit; the chalkboard
//                   (the maths cards) and the contact zoom are in the saver
//                   frame; the gap from the balls at rest to the next
//                   strike stays under a few seconds; the regions of 16:9
//                   and 9:16 sit in the clear band
//  Skips (and fails) when jsdom is missing: give JSDOM_DIR or NODE_PATH.
// ============================================================================
import { ok, done } from './util.mjs';
import { bootPage, loadJsdom } from './harness.mjs';
import { regions, COMPS } from '../saver.js';
import fs from 'node:fs';
import { parseCss, styleOf, px } from '../../../../tools/css-viewport.mjs';

if (!loadJsdom()) { ok(false, 'jsdom: not found (set JSDOM_DIR or NODE_PATH)'); done(); process.exit(1); }

// ── desktop ─────────────────────────────────────────────────────────────────
{
  const P = await bootPage({ w: 1280, h: 800 });
  const { pool, doc } = P, A = pool.APP;
  const secs = [...doc.querySelectorAll('#panelBody .snp-sec')].map(s => s.dataset.sec).join(',');
  ok(secs === 'game,online,shot,maths,view,about', 'desktop: the panel has the sections Game, Online, Shot, Maths, View, About', secs);
  ok(!!pool.V && P.errors.length === 0, 'desktop: boots with the 3D scene on a fake WebGL2 and no errors', P.errors.slice(0, 2).join(' | '));
  const seen = new Set();
  for (let k = 0; k < 900; k++) { P.frames(1); seen.add(A.phase); }
  const draws = P.fake.log.filter(x => x.op === 'draw').length;
  ok(['think', 'aim', 'roll', 'settle'].every(p => seen.has(p)) && A.G.shots >= 1, 'desktop: the AI runs think, aim, roll and settle', `phases ${[...seen].join(' ')}, ${A.G.shots} shots in 15 s`);
  ok(P.ctx2d.__st.calls > 10000 && P.ctx2d.__st.bad === 0 && draws > 1000, 'desktop: both views draw, every 2D argument finite', `${P.ctx2d.__st.calls} 2D calls, ${draws} GL draws`);
  const c = pool.maths.count();
  ok(c.cards > 0 && c.plain === c.cards && c.shown > 0, 'maths: every card has its plain-text form (the fallback with no MathJax)', JSON.stringify(c));
  const plain = [...doc.querySelectorAll('.mstep .mplain')].map(e => e.textContent);
  ok(plain.every(t => t.length > 8 && !/\\[a-z]/.test(t)), 'maths: the fallback text has no TeX commands in it', plain.slice(0, 2).join(' | '));
  ok(/v·n̂/.test(doc.getElementById('readout').textContent), 'readouts: the live table shows v, a, v·n, v·t and theta');

  // take over: a tap on the 2D view during the AI's turn
  let guard = 0;
  while (!(A.phase === 'think' || A.phase === 'aim') && guard++ < 2000) P.frames(1);
  // a swipe (60 px) does not take over: on a phone it scrolls the column
  for (const [t, y] of [['pointerdown', 100], ['pointerup', 160]]) { const ev = new P.win.Event(t); ev.clientX = 100; ev.clientY = y; ev.pointerId = 1; doc.getElementById('c2d').dispatchEvent(ev); }
  ok(A.phase !== 'plan' && !A.takeover, 'swipe: a 60 px swipe on the 2D view does not take over (the phone column scrolls)', `phase ${A.phase}`);
  // a tap: down and up at one point
  for (const t of ['pointerdown', 'pointerup']) { const ev = new P.win.Event(t); ev.clientX = 100; ev.clientY = 100; ev.pointerId = 1; doc.getElementById('c2d').dispatchEvent(ev); }
  ok(A.phase === 'plan' && !doc.getElementById('strikeCard').hidden && doc.body.classList.contains('planning'), 'take over: a tap on the table hands the shot to the user (strike card shown)', `phase ${A.phase}`);
  // plan: tap the first legal ball (picks its best pocket), no spin, medium speed
  P.frames(2);
  const S = A.G.S, legal = pool.frame2d(1).pick.legal;
  const n = legal.find(b => S.on[b]);
  pool.planPointer('down', [S.x[n], S.y[n]]); pool.planPointer('up', [S.x[n], S.y[n]]);
  A.pl.a = 0; A.pl.b = 0; A.pl.v = 2.4; A.pl.dirty = true;
  P.frames(2);
  const planned = A.pred;
  ok(planned && planned.paths && A.steps.length >= 4 && pool.maths.count().shown === A.steps.length, 'plan: the predicted layout and every maths step show at once', `${A.steps.length} steps, first contact ${planned.first}`);
  pool.shootPlan();
  guard = 0;
  while (A.phase !== 'settle' && guard++ < 6000) P.frames(1);
  const live = S.paths;
  let same = true, worst = 0, count = 0;
  for (let b = 0; b < 16; b++) {
    const a = planned.paths[b] || [], c2 = live[b] || [];
    if (a.length !== c2.length) { same = false; continue; }
    for (let k = 0; k < a.length; k++) { worst = Math.max(worst, Math.abs(a[k] - c2[k])); count++; }
  }
  ok(same && worst === 0 && count > 30, 'plan: the predicted paths equal the simulated paths of the shot (no spin)', `${count / 3} samples, largest difference ${worst}`);
  P.frames(120);
  ok(A.phase !== 'plan' && !A.human, 'hand back: in AI vs AI the AI takes the table again after the user shot', `phase ${A.phase}`);
  P.close();
}

// ── phone ───────────────────────────────────────────────────────────────────
{
  const P = await bootPage({ w: 390, h: 844, coarse: true, dpr: 3 });
  const { pool, doc } = P;
  P.frames(120);
  ok(P.errors.length === 0 && doc.body.classList.contains('panel-closed') && P.ctx2d.__st.calls > 1000, 'phone: boots at 390 x 844 with the panel closed and both views drawing', P.errors.slice(0, 2).join(' | '));
  ok(pool.D.rot === false, 'phone: the stacked 2D pane keeps the table across');
  doc.getElementById('pane2d').getBoundingClientRect = () => ({ left: 0, top: 0, width: 374, height: 620, right: 374, bottom: 620, x: 0, y: 0 });
  doc.getElementById('dockView').click();
  pool.layout(); P.frames(5);
  ok(pool.APP.view === '2d' && pool.D.rot === true && P.ctx2d.__st.bad === 0, 'phone: the 2D view alone turns the table up the screen', `view ${pool.APP.view}`);
  P.close();
}

// ── no layout shift: a sequence of shots ────────────────────────────────────
{
  const P = await bootPage({ w: 1280, h: 800 });
  const { pool, doc } = P, A = pool.APP, V = pool.V;
  P.frames(5);
  const c2d = doc.getElementById('c2d');
  let sets = 0; const W0 = c2d.width, H0 = c2d.height;
  for (const k of ['width', 'height']) {
    const proto = Object.getOwnPropertyDescriptor(P.win.HTMLCanvasElement.prototype, k);
    Object.defineProperty(c2d, k, { configurable: true, get() { return proto.get.call(this); }, set(v) { sets++; proto.set.call(this, v); } });
  }
  let gl = 0; const ss = V.renderer.setSize.bind(V.renderer); V.renderer.setSize = (...a) => { gl++; return ss(...a); };
  let dl = 0; const lay = pool.D.layout; pool.D.layout = (...a) => { dl++; return lay(...a); };
  const insets = new Set(), msgs = new Set();
  const shots0 = A.G.shots;
  for (let k = 0; k < 9000 && A.G.shots < shots0 + 4; k++) {
    P.frames(1);
    pool.layout();                                // as if a resize observer fired on every caption change
    insets.add(JSON.stringify(pool.D.inset));
    msgs.add(doc.getElementById('msg').textContent + '|' + doc.getElementById('status').textContent);
  }
  pool.D.layout = lay;
  ok(A.G.shots >= shots0 + 4 && sets === 0 && gl === 0 && dl === 0 && c2d.width === W0 && c2d.height === H0 && insets.size === 1,
    'no layout shift: over 4 shots with layout() every frame, the 2D canvas, the 3D buffer and the contact inset never change',
    `${A.G.shots - shots0} shots, ${msgs.size} caption texts, canvas sets ${sets}, GL setSize ${gl}, D.layout ${dl}, inset boxes ${insets.size}`);
  P.close();
}
{
  const css = parseCss(fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8'));
  const P = await bootPage({ w: 1280, h: 800 });
  const doc = P.doc, vp = { w: 1280, h: 800, coarse: false };
  const st = sel => styleOf(doc.querySelector(sel), css, vp);
  // a maths card in the DOM to read its style
  const steps = doc.getElementById('steps');
  const card = doc.createElement('article'); card.className = 'mstep'; const eq = doc.createElement('div'); eq.className = 'meq'; const tt = doc.createElement('span'); tt.className = 'mttl'; card.append(tt, eq); steps.appendChild(card);
  const app = st('#app'), top = st('#top'), msg = st('#msg'), status = st('#status'), ms = st('.mstep'), me = st('.meq'), mt = st('.mttl');
  const bad = [];
  if (!/^var\(--top-h/.test(app['grid-template-rows'] || '') || /\bauto\b/.test(app['grid-template-rows'])) bad.push('#app rows ' + app['grid-template-rows']);
  if (!/var\(--top-h/.test(top.height || '') || top['flex-wrap'] !== 'nowrap' || top.overflow !== 'hidden') bad.push('#top');
  for (const [n, x] of [['#msg', msg], ['#status', status], ['.mttl', mt]]) if (x['white-space'] !== 'nowrap' || x['text-overflow'] !== 'ellipsis' || x.overflow !== 'hidden') bad.push(n);
  if (!/var\(--card-h/.test(ms.height || '') || ms.overflow !== 'hidden') bad.push('.mstep ' + ms.height);
  if (!/calc\(var\(--card-h/.test(me.height || '') || me.overflow !== 'hidden') bad.push('.meq ' + me.height);
  ok(!bad.length, 'no layout shift (CSS): the header rows and lines, each maths card and its equation box have fixed heights; long text cuts with an ellipsis', bad.join('; '));
  P.close();
}

// ── phone: one column, 2D, the last steps, then 3D ──────────────────────────
{
  const css = parseCss(fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8'));
  const P = await bootPage({ w: 390, h: 844, coarse: true, dpr: 3 });
  const { pool, doc } = P, vp = { w: 390, h: 844, coarse: true };
  const st = sel => styleOf(doc.querySelector(sel), css, vp);
  const app = st('#app'), vars = { '--card-h': app['--card-h'], '--top-h': app['--top-h'], '--snp-dock-h': '64px' };
  const len = v => px(String(v || '').replace(/var\((--[\w-]+)(?:,[^)]*)?\)/g, (m, k) => vars[k] || '0px'), vp);
  const o = id => +(st(id).order || 0);
  const h2 = len(st('#pane2d').height), hm = len(st('#maths').height), h3 = len(st('#pane3d').height);
  ok(app.display === 'flex' && app['flex-direction'] === 'column' && app['overflow-y'] === 'auto' && st('#views').display === 'contents' && o('#pane2d') < o('#maths') && o('#maths') < o('#pane3d') && st('#readout').display === 'none',
    'phone (390 x 844): one scrolling column in the order 2D diagram, maths, 3D table', `orders ${o('#top')} ${o('#pane2d')} ${o('#maths')} ${o('#pane3d')}, #app overflow-y ${app['overflow-y']}`);
  ok(h2 > 250 && hm > 150 && h3 > 400 && 58 + h2 + hm < 844 - 64 - 44 + 40 && 58 + h2 + hm + h3 > 844 - 64 - 44,
    'phone: the 2D diagram and the last steps fill the first screen; the 3D table is below them (scroll down)', `heights: header 58, 2D ${h2.toFixed(0)}, maths ${hm.toFixed(0)}, 3D ${h3.toFixed(0)} px; screen ${844 - 64 - 44} px`);
  // the last steps: only the "recent" cards show
  const card = doc.createElement('article'); card.className = 'mstep'; doc.getElementById('steps').appendChild(card);
  const hidden = st('.mstep').display; card.classList.add('recent'); const shown = styleOf(card, css, vp).display; card.remove();
  const A = pool.APP; let guard = 0;
  while (!(A.phase === 'roll' && A.shown >= 5) && guard++ < 6000) P.frames(1);
  const rec = pool.maths.recent(), n = pool.maths.count().shown;
  ok(hidden === 'none' && shown === 'grid' && rec.length === Math.min(4, n) && rec[rec.length - 1] === A.shown,
    'phone: the maths shows the last four steps (the newest last), the others hide', `recent ${rec.join(',')} of ${n} shown, current ${A.shown}`);
  P.close();
}

// ── saver ───────────────────────────────────────────────────────────────────
{
  const P = await bootPage({ w: 1280, h: 720 });
  const { pool, doc } = P;
  const labels = [];
  const V = pool.V; let sizes = 0; const ss = V.renderer.setSize.bind(V.renderer); V.renderer.setSize = (...a) => { sizes++; return ss(...a); };
  const res = await P.win.snSaver.enter({ seed: 42, calm: 0.5, label: L => labels.push(L) });
  ok(res.canvas === doc.getElementById('saverCanvas') && doc.documentElement.classList.contains('saver') && !res.canvas.hidden, 'saver: enter returns the composite canvas (in the document) and hides the page UI');
  const titles = new Set(), drawn = P.ctxSaver.__st.texts;
  let boardHits = 0, boardChecks = 0;
  for (let k = 0; k < 7200; k++) {
    P.frames(1);
    if (k % 30 === 0 && pool.APP.shown >= 0 && pool.APP.steps.length) {
      boardChecks++;
      const t = pool.APP.steps[Math.min(pool.APP.shown, pool.APP.steps.length - 1)].title;
      if (drawn.slice(-400).some(s => s.startsWith(t.slice(0, 12)))) boardHits++;
      titles.add(t);
    }
  }
  for (let k = 0; k < 4; k++) { P.win.snSaver.cut(); P.frames(20); }
  const dbg = P.win.snSaver.debug(), h = dbg.hist.map(x => x.shot);
  let rep = 0; for (let i = 1; i < h.length; i++) if (h[i] === h[i - 1]) rep++;
  ok(h.length >= 5 && rep === 0 && COMPS.every(c => h.includes(c)), 'saver: cuts between the board and the board with the 3D table, no repeat', h.join(' '));
  ok(boardChecks > 50 && boardHits >= 0.9 * boardChecks && drawn.some(s => /zoom ×|contact zoom/.test(s)),
    'saver: the chalkboard (the maths cards, current step drawn) and the contact zoom are in the saver frame', `${boardHits}/${boardChecks} checks found the current step on the board; ${titles.size} step titles`);
  const gaps = dbg.gaps.slice().sort((a, b) => a - b), med = gaps[gaps.length >> 1] || 99, max = gaps[gaps.length - 1] || 99;
  ok(gaps.length >= 6 && med <= 3.5 && max <= 5, 'saver: the gap from the balls at rest to the next strike is a few seconds (a full game plays briskly)',
    `${gaps.length} gaps, median ${med.toFixed(2)} s, longest ${max.toFixed(2)} s, ${dbg.shots} shots in ${(7200 / 60).toFixed(0)} s, kinds ${JSON.stringify(dbg.kinds.reduce((o, k) => (o[k] = (o[k] || 0) + 1, o), {}))}`);
  ok(labels.every(L => !L || !('code' in L)) && labels.some(L => L && L.params && L.params.length) && P.ctxSaver.__st.calls > 1000 && P.ctxSaver.__st.bad === 0,
    'saver: the plate gets the title and live values and no code; the frame draws with finite arguments', `${labels.length} plates (${labels.filter(L => L && L.params && L.params.length).length} with values); ${P.ctxSaver.__st.calls} calls, ${P.ctxSaver.__st.bad} not finite ${JSON.stringify(P.ctxSaver.__st.badOps)}`);
  ok(sizes <= dbg.hist.length + 2, 'saver: the 3D renderer resizes only when a composition changes (not every frame)', `${sizes} resizes over ${dbg.hist.length} compositions`);
  P.win.snSaver.exit();
  V.camMode('overhead'); V.update(0.016);
  const lampHidden = V.lamp.visible === false;
  V.camMode('broadcast'); V.update(0.016);
  ok(lampHidden && V.lamp.visible, 'camera: the lamp body hides from the overhead camera (it hangs between the camera and the table)');
  ok(!doc.documentElement.classList.contains('saver') && doc.getElementById('saverCanvas').hidden && pool.APP.saver === null, 'saver: exit restores the page');
  P.close();
}
{
  let bad = [];
  const frames = [[1280, 720, { t: 140, b: 120, w: 1280 }], [405, 720, { t: 150, b: 130, w: 405 }], [1280, 720, null], [405, 720, null]];
  for (const [W, H, band] of frames) for (const c of COMPS) {
    const r = regions(W, H, band, c);
    const t = band ? band.t : 0, b = band ? band.b : 0;
    for (const k of ['diagram', 'board', 'inset', 'three', 'side']) {
      const q = r[k]; if (!q) continue;
      if (q.x < 0 || q.x + q.w > W + 0.5 || q.y < t - 0.5 || q.y + q.h > H - b + 0.5 || q.w < 40 || q.h < 40) bad.push(`${W}x${H} ${c} ${k}`);
    }
    if (!(r.board && r.board.h >= 80 && r.board.w >= 150)) bad.push(`${W}x${H} ${c} board too small`);
    // the contact zoom in the bottom-right corner of the band
    const band0 = { x: band ? (W - band.w) / 2 : 0, w: band ? band.w : W };
    if (!(Math.abs(r.inset.x + r.inset.w - (band0.x + band0.w - 8)) < 1 && Math.abs(r.inset.y + r.inset.h - (H - b)) < 1)) bad.push(`${W}x${H} ${c} inset not bottom right`);
    if (W > H && !(r.board.x > r.diagram.x + r.diagram.w - 1)) bad.push('16:9 board not beside the diagram');
    if (W < H && !(r.board.y > r.diagram.y + r.diagram.h - 1)) bad.push('9:16 board not under the diagram');
    if (c === 'board3d' && !r.three) bad.push('board3d without 3D');
  }
  ok(!bad.length, 'saver framing: the diagram, the chalkboard and the bottom-right zoom sit in the plate clear band (board beside in 16:9, under in 9:16)', bad.join('; '));
}
done();
