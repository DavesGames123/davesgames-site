// ============================================================================
//  FLY DUEL  ·  the two big brain panels  (node tests/brainpanels.test.mjs)
// ----------------------------------------------------------------------------
//  ui/fly3d/brainpanels.js without a browser (the user does not allow
//  headless Chrome):
//    fit        fitDistance: the map sphere fits the smaller side of a
//               tall panel, a square panel and a wide band
//    fire       headless: a real decision of each fly (brain/fly.js trace)
//               lights that fly's own panel only: its active KCs, the
//               info for the caption, the sequence ends after 1.4 s
//    reduced    reduced motion: a fire jumps to its end state
//    renderer   one shared renderer (a fake with the WebGLRenderer calls)
//               serves both panels: each panel renders into the lower-left
//               corner (viewport and scissor at its pixel size) and copies
//               that corner into its own 2D canvas with drawImage; a panel
//               draws only when its map runs or it changed; a hidden panel
//               does not draw
//    alpha      the shared renderer has alpha, clears to alpha 0, the
//               scenes have no background, each panel canvas is cleared
//               before the copy
//    grip       projectedBounds: the input box of the brain lies inside
//               the panel and is smaller than a tall side panel; a point
//               outside it is not on the grip
//    insets     clearInsets: side overlays -> l, r; bands -> t, b
//    layout     style.css: the table canvas fills the game view; the
//               brains are transparent overlays (no ground, no border,
//               no pointer events but the grip); wide = A left, B right,
//               about a third of the width each; tall = bands at the top
//               and the base; play shows only the opposing fly's brain
//    framing    ui/fly3d/scene.js setClear fill with fillFrame: at ten
//               desktop, tablet and phone sizes the canvas is the game
//               view, the table centre and both flies (head and base) are
//               in the view and off the brain squares, and the smallest
//               fly is at least the minimum of that size (120 px at
//               1920x1080)
//    fillFrame  the move of the centre under the wide brain squares
//    squares    style.css watch squares, the grip offset, main.js
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
const THREE = await import('three');
const { createBrainPanels, fitDistance, PANEL_VIEW, projectedBounds, clearInsets, fillFrame, WIDE_HEAD } = await import('../ui/fly3d/brainpanels.js');
const rules = await import('../game/rules.js');
const { Fly } = await import('../brain/fly.js');
const { Match, agentFromFly } = await import('../ui/match.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; if (process.env.VERBOSE) console.log('ok  ', m); } else { fail++; console.error('FAIL', m); } };
const json = p => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const CA = json('data/connectome.json'), CB = json('data/connectome-flywire.json');
const PT = json('data/pretrained.json');

// --- fit ---------------------------------------------------------------------------
for (const aspect of [0.45, 1, 2.6]) {
  const d = fitDistance(aspect);
  const cam = new THREE.PerspectiveCamera(PANEL_VIEW.fov, aspect, 0.01, 40);
  cam.position.set(0, 0, d); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  // the sphere edge in the narrow direction projects inside the frame
  const v = aspect < 1 ? new THREE.Vector3(PANEL_VIEW.radius, 0, 0) : new THREE.Vector3(0, PANEL_VIEW.radius, 0);
  const n = v.project(cam);
  const edge = aspect < 1 ? Math.abs(n.x) : Math.abs(n.y);
  ok(edge <= 1.02 && edge > 0.7, `fit: aspect ${aspect}: the map fills the smaller side (edge at ${edge.toFixed(2)} of the half frame)`);
}
ok(fitDistance(0.45) > fitDistance(1) && fitDistance(1) <= fitDistance(2.6) + 1e-9, 'fit: a narrow panel puts the camera further back');

// --- real decisions ------------------------------------------------------------------
const flyA = Fly.fromJSON(CA, PT.A), flyB = Fly.fromJSON(CB, PT.B);
const M = new Match(rules, [agentFromFly(flyA, 'Fly A'), agentFromFly(flyB, 'Fly B')], { seed: 11, decks: ['amber', 'rot'] });
const recs = [];
for (let i = 0; i < 40; i++) { const r = M.next(); if (!r) break; if (r.trace) recs.push(r); }
const rA = recs.find(r => r.who === 0), rB = recs.find(r => r.who === 1);
ok(!!rA && !!rB, `fire: real traces of both flies (${recs.length} decisions)`);

// --- fire (headless) -----------------------------------------------------------------
{
  const infos = [];
  const P = createBrainPanels([{}, {}], [CA, CB], { headless: true, onFire: (p, info) => infos.push([p, info]) });
  ok(P.stats().contexts === 0, 'fire: headless has no renderer');
  P.fire(0, rA.trace, rA.delta);
  const s0 = P.stats().panels;
  ok(s0[0].fires === 1 && s0[1].fires === 0, 'fire: a decision of Fly A fires the panel of Fly A only');
  ok(s0[0].info.kc === rA.trace.kc.length && s0[0].info.nKC === CA.kc.n, `fire: the caption info has the active KCs of the trace (${s0[0].info.kc} of ${s0[0].info.nKC})`);
  ok(infos.length === 1 && infos[0][0] === 0, 'fire: onFire reports the panel');
  ok(s0[0].running, 'fire: the sequence runs');
  let t = 0;
  while (P.panels[0].map.running && t < 3) { P.update(0.05); t += 0.05; }
  ok(!P.panels[0].map.running && t > 1.2 && t < 1.6, `fire: the sequence ends after about 1.4 s (${t.toFixed(2)} s)`);
  ok(P.panels[0].map.lit().kc === rA.trace.kc.length, `fire: the KCs of the trace hold after the sequence (${P.panels[0].map.lit().kc})`);
  P.fire(1, rB.trace, rB.delta);
  ok(P.stats().panels[1].info.nKC === CB.kc.n && P.panels[1].map.stats().kc === CB.kc.n, 'fire: Fly B fires on the FlyWire file');
  ok(P.fire(1, null) === null && P.stats().panels[1].fires === 1, 'fire: no trace, no fire');
  P.dispose();
}

// --- reduced -----------------------------------------------------------------------
{
  const P = createBrainPanels([{}, {}], [CA, CB], { headless: true, reducedMotion: true });
  P.fire(0, rA.trace, rA.delta);
  P.update(0);
  ok(!P.panels[0].map.running && P.panels[0].map.lit().kc === rA.trace.kc.length, 'reduced: a fire jumps to its end state');
  P.dispose();
}

// --- renderer (a fake shared renderer) ---------------------------------------------
{
  const calls = [];
  const glCanvas = { width: 1, height: 1, addEventListener() {} };
  const fake = {
    domElement: glCanvas,
    setPixelRatio(r) { calls.push(['ratio', r]); }, outputColorSpace: '', toneMapping: 0,
    setScissorTest(on) { calls.push(['scissorTest', on]); },
    setClearColor(c, a) { calls.push(['clearColor', c, a]); },
    setSize(w, h) { glCanvas.width = w; glCanvas.height = h; calls.push(['size', w, h]); },
    setViewport(x, y, w, h) { calls.push(['viewport', x, y, w, h]); },
    setScissor(x, y, w, h) { calls.push(['scissor', x, y, w, h]); },
    render(scene, cam) { calls.push(['render', scene.uuid, cam.aspect]); },
    dispose() {}, forceContextLoss() {},
  };
  const copies = [];
  const panelCv = (w, h, tag) => {
    const el = { clientWidth: w, clientHeight: h, width: 0, height: 0, style: {}, tabIndex: -1, ownerDocument: null,
      addEventListener() {}, removeEventListener() {}, getRootNode() { return el; },
      getContext: () => ({ drawImage: (...a) => copies.push([tag, ...a]), clearRect: (...a) => { if (!globalThis.__noClear) copies.push([tag + ':clear', ...a]); } }) };
    return el;
  };
  globalThis.devicePixelRatio = 2;
  const cvA = panelCv(400, 700, 'A'), cvB = panelCv(400, 700, 'B');
  const P = createBrainPanels([cvA, cvB], [CA, CB], { renderer: fake });
  ok(P.stats().contexts === 1, 'renderer: one renderer for the two panels');
  P.update(0.016);
  const clears = copies.filter(c => c[0].endsWith(':clear'));
  ok(clears.length === 2 && copies.findIndex(c => c[0] === 'A:clear') < copies.findIndex(c => c[0] === 'A'), 'alpha: each panel canvas is cleared before the copy');
  ok(calls.some(c => c[0] === 'clearColor' && c[2] === 0), 'alpha: the shared renderer clears to alpha 0');
  ok(P.panels.every(x => x.scene.background === null), 'alpha: the panel scenes have no background');
  const b0 = P.bounds(0);
  ok(!!b0 && b0.x >= 0 && b0.y >= 0 && b0.x + b0.w <= 400 + 1e-6 && b0.y + b0.h <= 700 + 1e-6 && b0.h < 700 * 0.8, `grip: the input box of the brain is inside the panel and smaller than it (${b0 && [b0.x, b0.y, b0.w, b0.h].map(v => v | 0)})`);
  for (let i = copies.length - 1; i >= 0; i--) if (copies[i][0].endsWith(':clear')) copies.splice(i, 1);
  const renders = calls.filter(c => c[0] === 'render');
  ok(renders.length === 2 && renders[0][1] !== renders[1][1], `renderer: the first frame draws both panels, one scene each (${renders.length})`);
  ok(cvA.width === 800 && cvA.height === 1400, `renderer: the panel canvas is its CSS size at the pixel ratio (${cvA.width}x${cvA.height})`);
  ok(glCanvas.width >= 800 && glCanvas.height >= 1400, `renderer: the shared canvas grows to the largest panel (${glCanvas.width}x${glCanvas.height})`);
  const vp = calls.filter(c => c[0] === 'viewport');
  ok(vp.every(c => c[1] === 0 && c[2] === 0 && c[3] === 800 && c[4] === 1400), 'renderer: each panel renders into the lower-left corner at its pixel size');
  ok(calls.some(c => c[0] === 'scissorTest' && c[1] === true) && calls.filter(c => c[0] === 'scissor').length === 2, 'renderer: the scissor keeps each render in its corner');
  ok(copies.length === 2 && copies.every(c => c[1] === glCanvas && c[2] === 0 && c[3] === glCanvas.height - 1400 && c[4] === 800 && c[5] === 1400 && c[8] === 800 && c[9] === 1400), 'renderer: drawImage copies the corner (top-left origin) into the whole panel');
  ok(Math.abs(renders[0][2] - 400 / 700) < 1e-9, 'renderer: the camera aspect is the panel aspect');
  calls.length = 0; copies.length = 0; globalThis.__noClear = true;
  P.update(0.016);
  for (let i = copies.length - 1; i >= 0; i--) if (copies[i][0].endsWith(':clear')) copies.splice(i, 1);
  ok(copies.length === 0, 'renderer: no change, no draw');
  P.fire(1, rB.trace, rB.delta);
  P.update(0.05);
  ok(copies.length === 1 && copies[0][0] === 'B', 'renderer: a fire of Fly B draws the panel of Fly B only');
  copies.length = 0;
  P.setVisible(1, false);
  P.update(0.05);
  ok(copies.length === 0 && P.panels[1].map.running, 'renderer: a hidden panel does not draw, its map still runs');
  P.setVisible(1, true);
  P.update(0.05);
  ok(copies.length === 1, 'renderer: shown again, it draws');
  copies.length = 0;
  cvA.clientWidth = 600; cvA.clientHeight = 300;
  P.resize(); P.update(0.05);
  ok(cvA.width === 1200 && cvA.height === 600 && copies.some(c => c[0] === 'A'), `renderer: a resize draws again at the new size (${cvA.width}x${cvA.height})`);
  ok(Math.abs(P.panels[0].camera.position.length() - fitDistance(2)) < 1e-6, 'renderer: the camera moves to the new fit');
  P.dispose();
}

// --- grip and insets (pure) ------------------------------------------------------------
{
  // a wide-layout side panel: 595 x 984 CSS px
  const cam = new THREE.PerspectiveCamera(PANEL_VIEW.fov, 595 / 984, 0.01, 40);
  cam.position.set(0, 0, fitDistance(595 / 984)); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const r = PANEL_VIEW.radius * 0.8;
  const box = new THREE.Box3(new THREE.Vector3(-r, -r * 0.7, -r * 0.6), new THREE.Vector3(r, r * 0.7, r * 0.6));
  const b = projectedBounds(cam, box, 595, 984);
  ok(!!b && b.y > 100 && b.y + b.h < 884, `grip: in a tall side panel the box leaves the top and the base free (${b && [b.y | 0, (b.y + b.h) | 0]} of 984)`);
  const inGrip = (x, y) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  ok(!inGrip(300, 30) && !inGrip(300, 960) && inGrip(297, 492), 'grip: a point over the panel top or base is not on the grip; the brain centre is');
  ok(projectedBounds(cam, new THREE.Box3(), 595, 984) === null, 'grip: an empty box has no grip');
  const cv = { left: 0, top: 0, right: 1920, bottom: 984 };
  const w = clearInsets(cv, [{ left: 0, top: 0, right: 595, bottom: 984 }, { left: 1325, top: 0, right: 1920, bottom: 984 }], true);
  ok(w.l === 595 && w.r === 595 && w.t === 0 && w.b === 0, `insets: wide side overlays give l and r (${JSON.stringify(w)})`);
  const t = clearInsets({ left: 0, top: 0, right: 390, bottom: 748 }, [{ left: 0, top: 52, right: 390, bottom: 238 }, { left: 0, top: 562, right: 390, bottom: 748 }], false);
  ok(t.t === 238 && t.b === 186 && t.l === 0 && t.r === 0, `insets: tall bands give t and b (${JSON.stringify(t)})`);
  const one = clearInsets(cv, [{ left: 1325, top: 72, right: 1920, bottom: 800 }], true);
  ok(one.l === 0 && one.r === 595, 'insets: play with brain B only: the right inset only');
  ok(JSON.stringify(clearInsets(cv, [{ left: 0, top: 0, right: 0, bottom: 0 }], true)) === JSON.stringify({ l: 0, r: 0, t: 0, b: 0 }), 'insets: a hidden overlay (an empty rect) gives no inset');
}

// --- alpha (source) ---------------------------------------------------------------------
{
  const src = readFileSync(new URL('../ui/fly3d/brainpanels.js', import.meta.url), 'utf8');
  ok(/new THREE\.WebGLRenderer\(\{[^}]*alpha: true, premultipliedAlpha: true/.test(src), 'alpha: the shared WebGLRenderer is created with alpha and premultipliedAlpha');
  ok(/setClearColor\?\.\(0x000000, 0\)/.test(src), 'alpha: the clear colour has alpha 0');
}

// --- layout (style.css) ----------------------------------------------------------------
{
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const wide = css.slice(css.indexOf('@media (min-aspect-ratio:11/10) and (min-width:700px)'));
  // every rule whose selector names a brain panel element
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => /\.bp(?:-cv|-grip|-cap)?\b|#heroPane|#heroBrain/.test(m[1]));
  const bg = rules.filter(m => /background(?:-color)?:\s*(?!transparent|none)/.test(m[2]));
  ok(rules.length > 5 && bg.length === 0, `layout: no brain panel rule sets a ground (${bg.map(m => m[1].trim()).join(' | ') || 'none'})`);
  ok(!rules.some(m => /border(?:-[a-z]+)?:\s*(?!0\b)[0-9]/.test(m[2])), 'layout: no brain panel rule sets a border');
  ok(/\.bp\{[^}]*pointer-events:none/.test(css) && /\.bp-cv\{[^}]*pointer-events:none/.test(css) && /\.bp-grip\{[^}]*pointer-events:auto/.test(css), 'layout: the panel and its canvas pass the pointer through; only the grip takes it');
  ok(/\.stage\{position:absolute;left:0;right:0;top:0;bottom:var\(--bar-h\)/.test(css) && !/\.stage\{[^}]*var\(--c[lrtb]\)/.test(css), 'layout: the table canvas fills the game view (no centre column)');
  ok(/\.stage-cv\{position:absolute;inset:0;width:100%;height:100%/.test(css), 'layout: the scene canvas is the size of the stage');
  ok(/\.playroot\{position:absolute;left:0;right:0;top:0;bottom:0;/.test(css) && !/\.playroot\{[^}]*z-index/.test(css), 'layout: the play screen fills the view and makes no stacking context (the brain lies under the play HUD)');
  ok(/--bpw:clamp\(220px,31vw,640px\)/.test(wide), 'layout: wide brains are about a third of the width each');
  ok(/\.bp\.a\{left:0;right:auto\}/.test(wide) && /\.bp\.b\{left:auto;right:0\}/.test(wide), 'layout: wide: brain A on the left, brain B on the right');
  ok(/--bph:clamp\(118px,22dvh,250px\)/.test(css) && /\.bp\.a\{top:var\(--bpa-top\)\}/.test(css) && /\.bp\.b\{bottom:var\(--bar-h\)\}/.test(css), 'layout: tall: brain A at the top, brain B over the bar');
  ok(/\[data-mode="play"\]\[data-opp="A"\] \.bp\.a,\s*\.app\[data-brains="panels"\]\[data-mode="play"\]\[data-opp="B"\] \.bp\.b\{display:block\}/.test(css), 'layout: play shows only the brain of the opposing fly');
  ok(/\.bp-cap\{position:absolute;right:var\(--pad\);bottom:6px/.test(css), 'layout: the caption sits at the base of its overlay');
  ok(/#scA\{left:/.test(css) && /#scB\{right:/.test(css), 'layout: the scorecards sit in the top corners');
}

// --- framing (ui/fly3d/scene.js setClear fill, fillFrame) -------------------------------
// The user (verbatim, 2026-10-12): "i want the visual of the fly to take
// up as much visual real estate as possible". Before this framing, the
// camera framed only the clear strip between the brains: the smallest
// fly was 60 px at 1920x1080, 45 at 1440x900, 32 at 1024x768, 31 at
// 390x844 and 26 at 844x390. Now the shots take the full canvas, and
// the flies and the board centre stay off the brain squares.
{
  const { createDuelScene, TABLE } = await import('../ui/fly3d/scene.js');
  const { greedyBot } = await import('../game/bots.js');
  const { agentFromBot } = await import('../ui/match.js');
  // [W, H, smallest fly px in the wide and combat shots]
  const SIZES = [[1920, 1080, 120], [1440, 900, 100], [1024, 768, 75], [1180, 820, 85], [820, 1180, 85],
    [390, 844, 45], [360, 740, 40], [430, 932, 50], [844, 390, 40], [932, 430, 45]];
  for (const [W, H, MIN] of SIZES) {
    // the bar of style.css: 96 px (phone), 62 px (760 px and wider), 56 px (a phone held sideways)
    const BAR = H <= 520 && W > H ? 56 : W >= 760 ? 62 : 96;
    const h = H - BAR, wide = W / H >= 1.1 && W >= 700;
    // the brain squares of style.css WATCH SQUARES at this size
    const bpw = Math.min(640, Math.max(220, 0.31 * W)), bph = Math.min(250, Math.max(118, 0.22 * H));
    const sq = wide ? Math.min(0.6 * h, 0.92 * bpw) : bph;
    const squares = wide ? [{ left: 0, top: 0, right: bpw, bottom: sq }, { left: W - bpw, top: 0, right: W, bottom: sq }]
      : [{ left: 0, top: 52, right: sq, bottom: 52 + sq }, { left: W - sq, top: h - sq, right: W, bottom: h }];
    const cv = { left: 0, top: 0, right: W, bottom: h };
    const fr = fillFrame(cv, squares, wide);
    const sc = createDuelScene({ clientWidth: W, clientHeight: h }, { headless: true });
    await sc.ready;
    sc.setState(new Match(rules, [agentFromBot(greedyBot(), 'a'), agentFromBot(greedyBot(), 'b')], { seed: 3 }).state);
    sc.setClear(fr);
    ok(sc.clear.w === W && sc.clear.h === h && sc.clear.fill, `framing ${W}x${H}: the scene canvas is the game view (${sc.clear.w}x${sc.clear.h}) and the shots fill it`);
    sc.setCamera('script');
    const px = v => { const p = v.clone().project(sc.camera); return [(p.x + 1) / 2 * W, (1 - p.y) / 2 * h]; };
    const onSq = ([x, y]) => squares.some(q => x >= q.left && x <= q.right && y >= q.top && y <= q.bottom);
    const inView = ([x, y]) => x >= 0 && x <= W && y >= 0 && y <= h;
    let bad = [], minFly = Infinity;
    for (const shot of ['wide', 'combat']) for (const az of [-1.57, 0, 1.57]) for (const p of [0, 1]) {
      sc.shoot(shot, p, { cut: true }); sc.world.cam.az = az; sc.render(1e-4);
      sc.scene.updateMatrixWorld(true); sc.camera.updateMatrixWorld();
      const pts = [['centre', new THREE.Vector3(0, TABLE.y, 0)]];
      sc.world.flies.forEach((f, i) => {
        const head = f.built.rig.joints?.head?.getWorldPosition(new THREE.Vector3()) ?? f.holder.position.clone().setY(3.2);
        const base = f.holder.position.clone().setY(TABLE.y);
        pts.push([`fly ${i} head`, head], [`fly ${i} base`, base]);
        minFly = Math.min(minFly, Math.abs(px(head)[1] - px(base)[1]));
      });
      for (const [n, v] of pts) { const q = px(v); if (!inView(q) || onSq(q)) bad.push(`${shot} p${p} az ${az} ${n} at ${q.map(z => z | 0)}`); }
    }
    ok(bad.length === 0, `framing ${W}x${H}: the board centre and both flies are in the view and off the brain squares${bad.length ? ': ' + bad.slice(0, 3).join('; ') : ''}`);
    ok(minFly >= MIN, `framing ${W}x${H}: the smallest fly in the wide and combat shots is ${minFly | 0} px high (at least ${MIN})`);
    sc.dispose();
  }
}

// --- fillFrame (pure) ----------------------------------------------------------------------
{
  const cv = { left: 0, top: 0, right: 1920, bottom: 1018 };
  const f = fillFrame(cv, [{ left: 0, top: 0, right: 595, bottom: 547 }, { left: 1325, top: 0, right: 1920, bottom: 547 }], true);
  ok(f.fill === true && f.frame === 'wide' && f.l === 0 && f.r === 0 && f.b === 0 && f.t > 0 && f.t <= 0.45 * 1018, `fillFrame: wide squares move the centre down (t ${f.t})`);
  ok((1018 + f.t) / 2 - WIDE_HEAD * 1018 >= 547, 'fillFrame: the head line is under the brain squares');
  const none = fillFrame(cv, [], true);
  ok(none.t === 0 && none.fill, 'fillFrame: no brain (hidden maps): the full frame, no move');
  const tall = fillFrame({ left: 0, top: 0, right: 390, bottom: 748 }, [{ left: 0, top: 52, right: 186, bottom: 238 }], false);
  ok(tall.t === 0 && tall.frame === null && tall.fill, 'fillFrame: tall: no move, the frame from the aspect');
  const huge = fillFrame(cv, [{ left: 0, top: 0, right: 595, bottom: 1000 }], true);
  ok(huge.t === Math.round(0.45 * 1018), 'fillFrame: the move is at most 0.45 h (the limit of scene.js resize)');
}

// --- watch squares (style.css) -------------------------------------------------------------
{
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const wide = css.slice(css.indexOf('@media (min-aspect-ratio:11/10) and (min-width:700px)'));
  ok(/\.app\[data-table="3d"\]\[data-mode="watch"\] \.bp-cv\{right:auto;width:var\(--bph\)/.test(css) && /\.bp\.b \.bp-cv\{left:auto;right:0\}/.test(css), 'watch squares: tall: A square at the left of its band, B at the right');
  ok(/\.bp-cv\{left:0;right:0;width:auto;bottom:auto;height:min\(60%,calc\(var\(--bpw\) \* 0\.92\)\)\}/.test(wide), 'watch squares: wide: a square at the top of the side, at most 60 % of its height');
  const src = readFileSync(new URL('../ui/fly3d/brainpanels.js', import.meta.url), 'utf8');
  ok(/offsetLeft/.test(src) && /offsetTop/.test(src), 'watch squares: the grip adds the canvas offset in the overlay');
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  ok(/app\.mode === 'watch'\)[\s\S]{0,200}fillFrame\(/.test(main), 'watch squares: main.js syncClear frames watch mode with fillFrame');
}

console.log(`brainpanels: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
