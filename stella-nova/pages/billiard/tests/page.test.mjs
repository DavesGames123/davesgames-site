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
//  saver .......... enter / cuts / label (TeX, no code) / exit; the
//                   regions of 16:9 and 9:16 sit in the clear band
//  Skips (and fails) when jsdom is missing: give JSDOM_DIR or NODE_PATH.
// ============================================================================
import { ok, done } from './util.mjs';
import { bootPage, loadJsdom } from './harness.mjs';
import { regions, COMPS } from '../saver.js';

if (!loadJsdom()) { ok(false, 'jsdom: not found (set JSDOM_DIR or NODE_PATH)'); done(); process.exit(1); }

// ── desktop ─────────────────────────────────────────────────────────────────
{
  const P = await bootPage({ w: 1280, h: 800 });
  const { pool, doc } = P, A = pool.APP;
  const secs = [...doc.querySelectorAll('#panelBody .snp-sec')].map(s => s.dataset.sec).join(',');
  ok(secs === 'game,shot,maths,view,about', 'desktop: the panel has the sections Game, Shot, Maths, View, About', secs);
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
  const ev = new P.win.Event('pointerdown'); ev.clientX = 100; ev.clientY = 100; ev.pointerId = 1;
  doc.getElementById('c2d').dispatchEvent(ev);
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

// ── saver ───────────────────────────────────────────────────────────────────
{
  const P = await bootPage({ w: 1280, h: 720 });
  const { pool, doc } = P;
  const labels = [];
  const V = pool.V; let sizes = 0; const ss = V.renderer.setSize.bind(V.renderer); V.renderer.setSize = (...a) => { sizes++; return ss(...a); };
  const res = await P.win.snSaver.enter({ seed: 42, calm: 0.5, label: L => labels.push(L) });
  ok(res.canvas === doc.getElementById('saverCanvas') && doc.documentElement.classList.contains('saver') && !res.canvas.hidden, 'saver: enter returns the composite canvas (in the document) and hides the page UI');
  for (let k = 0; k < 1500; k++) P.frames(1);
  for (let k = 0; k < 6; k++) { P.win.snSaver.cut(); P.frames(20); }
  const dbg = P.win.snSaver.debug(), h = dbg.hist.map(x => x.shot);
  let rep = 0; for (let i = 1; i < h.length; i++) if (h[i] === h[i - 1]) rep++;
  const withTex = labels.filter(L => L && L.tex && L.tex.length);
  ok(h.length >= 7 && rep === 0 && COMPS.every(c => h.includes(c)), 'saver: cuts through split, table and diagram with no repeat', h.join(' '));
  ok(withTex.length > 0 && labels.every(L => !L || !('code' in L)) && P.ctxSaver.__st.calls > 1000 && P.ctxSaver.__st.bad === 0, 'saver: the plate gets the TeX of each step and no code; the frame draws', `${withTex.length} TeX plates; ${dbg.shots} shots`);
  ok(sizes <= dbg.hist.length + 2, 'saver: the 3D renderer resizes only when a composition changes (not every frame)', `${sizes} resizes over ${dbg.hist.length} compositions and 1620 frames`);
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
  const frames = [[1280, 720, { t: 140, b: 170, w: 1280 }], [405, 720, { t: 150, b: 210, w: 405 }], [1280, 720, null], [405, 720, null]];
  for (const [W, H, band] of frames) for (const c of COMPS) {
    const r = regions(W, H, band, c);
    for (const k of ['diagram', 'three']) {
      const q = r[k]; if (!q) continue;
      const t = band ? band.t : 0, b = band ? band.b : 0;
      if (q.x < 0 || q.x + q.w > W + 0.5 || q.y < t - 0.5 || q.y + q.h > H - b + 0.5 || q.w < 60 || q.h < 60) bad.push(`${W}x${H} ${c} ${k}`);
    }
    if (W < H && c === 'split' && !(r.three.y > r.diagram.y)) bad.push('9:16 split not stacked');
    if (W > H && c === 'split' && !(r.three.x > r.diagram.x)) bad.push('16:9 split not side by side');
    const bh = H - (band ? band.t + band.b : 0), bw = band ? band.w - 16 : W - 16;
    if (c === 'diagram' && (bh > bw * 1.1) !== !!r.rot) bad.push(`${W}x${H} diagram turn`);
  }
  ok(!bad.length, 'saver framing: every region of 16:9 and 9:16 sits in the plate clear band (split stacks in 9:16, a tall band turns the diagram)', bad.join('; '));
}
done();
