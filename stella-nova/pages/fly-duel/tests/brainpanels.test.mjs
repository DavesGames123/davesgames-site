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
//    layout     style.css: wide = three columns with panels of about a
//               third of the width; tall = bands over and under the
//               table; play shows only the opposing fly's panel
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
const { createBrainPanels, fitDistance, PANEL_VIEW } = await import('../ui/fly3d/brainpanels.js');
const rules = await import('../game/rules.js');
const { Fly } = await import('../brain/fly.js');
const { Match, agentFromFly } = await import('../ui/match.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL', m); } };
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
      getContext: () => ({ drawImage: (...a) => copies.push([tag, ...a]) }) };
    return el;
  };
  globalThis.devicePixelRatio = 2;
  const cvA = panelCv(400, 700, 'A'), cvB = panelCv(400, 700, 'B');
  const P = createBrainPanels([cvA, cvB], [CA, CB], { renderer: fake });
  ok(P.stats().contexts === 1, 'renderer: one renderer for the two panels');
  P.update(0.016);
  const renders = calls.filter(c => c[0] === 'render');
  ok(renders.length === 2 && renders[0][1] !== renders[1][1], `renderer: the first frame draws both panels, one scene each (${renders.length})`);
  ok(cvA.width === 800 && cvA.height === 1400, `renderer: the panel canvas is its CSS size at the pixel ratio (${cvA.width}x${cvA.height})`);
  ok(glCanvas.width >= 800 && glCanvas.height >= 1400, `renderer: the shared canvas grows to the largest panel (${glCanvas.width}x${glCanvas.height})`);
  const vp = calls.filter(c => c[0] === 'viewport');
  ok(vp.every(c => c[1] === 0 && c[2] === 0 && c[3] === 800 && c[4] === 1400), 'renderer: each panel renders into the lower-left corner at its pixel size');
  ok(calls.some(c => c[0] === 'scissorTest' && c[1] === true) && calls.filter(c => c[0] === 'scissor').length === 2, 'renderer: the scissor keeps each render in its corner');
  ok(copies.length === 2 && copies.every(c => c[1] === glCanvas && c[2] === 0 && c[3] === glCanvas.height - 1400 && c[4] === 800 && c[5] === 1400 && c[8] === 800 && c[9] === 1400), 'renderer: drawImage copies the corner (top-left origin) into the whole panel');
  ok(Math.abs(renders[0][2] - 400 / 700) < 1e-9, 'renderer: the camera aspect is the panel aspect');
  calls.length = 0; copies.length = 0;
  P.update(0.016);
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

// --- layout (style.css) ----------------------------------------------------------------
{
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const wide = css.slice(css.indexOf('@media (min-aspect-ratio:11/10) and (min-width:700px)'));
  ok(/--bpw:clamp\(220px,31vw,640px\)/.test(wide), 'layout: wide panels are about a third of the width each');
  ok(/\[data-mode="watch"\]\{--ct:0px;--cb:var\(--bar-h\);--cl:var\(--bpw\);--cr:var\(--bpw\)\}/.test(wide), 'layout: wide watch = brain A | table | brain B');
  ok(/\.bp\.a\{left:0;right:auto;border:0;/.test(wide) && /\.bp\.b,\.app\[data-mode="play"\] \.bp\.b\{top:0;bottom:var\(--bar-h\);left:auto;right:0;border:0;/.test(wide), 'layout: brain A on the left, brain B on the right, the tall-layout edges reset');
  ok(/\.app\[data-mode="play"\] \.bp\.a,\.app\[data-mode="play"\] \.bp\.b\{bottom:0\}/.test(wide), 'layout: in play mode (no bar) the panel runs to the bottom');
  ok(/--bph:clamp\(118px,22dvh,250px\)/.test(css) && /\.bp\.a\{top:0;/.test(css) && /\.bp\.b\{bottom:var\(--bar-h\);/.test(css), 'layout: tall = brain A over the table, brain B under it');
  ok(/\[data-mode="play"\]\[data-opp="A"\] \.bp\.a,\s*\.app\[data-brains="panels"\]\[data-mode="play"\]\[data-opp="B"\] \.bp\.b\{display:block\}/.test(css), 'layout: play shows only the panel of the opposing fly');
  ok(/\.stage\{position:absolute;left:var\(--cl\);right:var\(--cr\);top:var\(--ct\);bottom:var\(--cb\)/.test(css) && /\.playroot\{position:absolute;left:var\(--cl\);right:var\(--cr\);top:var\(--ct\)/.test(css), 'layout: the table and the play screen fill the region between the panels');
}

console.log(`brainpanels: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
