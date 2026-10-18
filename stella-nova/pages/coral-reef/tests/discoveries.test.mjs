// ============================================================================
//  CORAL REEF  ·  the discoveries of the ROVs (node + jsdom)
//                 node tests/discoveries.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "if an rov has discovered something, it
//  should get marked on the minimap, and it should be available for us to
//  hover over and click on to orbit. we should have a cool highlight
//  there". Checks of discoveries.js and its hooks:
//    pure ... one entry per subject when an ROV inspects it (colony,
//             feature, creature), not when it is far; the cap; the marks
//             at the right map px; the pick; the orbit frame (target, the
//             fill of the view, a clear yaw); the toast words; the
//             highlight snow shader is the marine-snow.js one, placed on
//             the subject
//    3D ..... createHighlight with three.js: attach, fade in, clear, fade
//             out, the snow box and light on the subject
//    jsdom .. mountDiscoveries: the toast rate limit, the minimap hover
//             card, a click flies the camera (target and fill), the
//             highlight attaches, Esc clears it; the large map draws the
//             marks, a hover shows the card, a click closes the map and
//             orbits; the squad-hud.js minimap draw calls the marks; the
//             map snow specks (off with reduced motion)
//  Without jsdom (JSDOM_DIR or NODE_PATH) the DOM parts are SKIPPED.
// ============================================================================
import path from 'node:path';
import { createRequire } from 'node:module';
import * as THREE from '../../../vendor/three@0.160.0/build/three.module.js';
import {
  createDiscoveryLog, scanSquad, drawDiscoveryMarks, pickMark, orbitFrame, toastText, highlightSnowVS, createHighlight,
  mountDiscoveries, FILL, TOAST_GAP, HL_PROGRAMS,
} from '../discoveries.js';
import { checkPrograms } from '../glsl-check.mjs';
import { MARINE_SNOW_FS } from '../../../lib/marine-snow.js';
import { mountExploreMap, mapSnow } from '../map-view.js';
import { worldToMap } from '../minimap.js';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name} ${info}`); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ── fakes ───────────────────────────────────────────────────────────────────
function fakeSquad() {
  const sq = {
    stats: { t: 120 }, visited: new Map([['0,0', 1], ['1,0', 1], ['2,0', 1]]),
    vehicles: [1, 2, 3].map(id => ({ id, state: { p: [id * 40, 20, 0], yaw: 0, look: [id * 40 + 5, 20, 0] } })),
    taskList: [{ id: 1, kind: 'inspect', subject: 'c1' }, { id: 2, kind: 'inspect', subject: 'cFar' }, { id: 3, kind: 'plan', subject: null }],
  };
  sq.tasks = () => sq.taskList;
  return sq;
}
const env = {
  colonies: () => [{ key: 'c1', id: 'bubblegum', center: [44, 19, 2], radius: 1.6, size: 3.4 }, { key: 'cFar', id: 'staghorn', center: [400, 19, 0], radius: 2, size: 4 }],
  speciesLabel: id => ({ bubblegum: 'Bubblegum coral', staghorn: 'Staghorn coral' })[id] || null,
  features: (x, z) => (Math.hypot(x - 80, z) < 1 ? [{ kind: 'arch', id: 'arch:85,3', center: [85, 21, 3], size: 9 }] : []),
  lookAt: (p) => (p[0] === 120 ? { name: 'Vampire squid', dist: 4 } : null),
  ground: () => 16, regionAt: () => ({ id: 'reef', name: 'Reef' }), surfaceY: 55, now: () => 1000,
};

// ── pure ────────────────────────────────────────────────────────────────────
{
  const L = createDiscoveryLog(), sq = fakeSquad();
  const a = scanSquad(L, sq, env, 120);
  const ids = a.map(e => e.id).sort();
  ok(ids.join() === ['coral:c1', 'creature:Vampire squid', 'feature:arch:85,3'].sort().join(), 'log: an inspected colony, a near arch and a creature in view are recorded', ids.join());
  const c = L.get('coral:c1');
  ok(c && c.name === 'Bubblegum coral' && c.cat === 'coral' && c.rov === 1 && c.depth === 39 && c.region === 'Reef' && near(c.p[0], 44) && c.r === 1.6 && c.t === 120, 'log: the entry has the name, kind, place, depth, region, ROV and time', JSON.stringify(c));
  ok(!L.has('coral:cFar'), 'log: a colony that the ROV is not near is not recorded yet');
  const b = scanSquad(L, sq, env, 121);
  ok(b.length === 0 && L.size === 3, 'log: a second scan records nothing again (once per subject)', `${b.length} ${L.size}`);
  sq.vehicles[1].state.p = [398, 20, 0];
  const c2 = scanSquad(L, sq, env, 130);
  ok(c2.length === 1 && c2[0].id === 'coral:cFar' && c2[0].rov === 2, 'log: the far colony is recorded when ROV 2 is near it');
  const S = createDiscoveryLog({ cap: 5 });
  for (let i = 0; i < 9; i++) S.add({ id: 'x' + i });
  ok(S.size === 5 && !S.has('x0') && S.has('x8'), 'log: the cap keeps the newest entries');

  // marks at the right px
  const calls = [];
  const ctx = new Proxy({}, { get(t, k) { if (k in t) return t[k]; return (...args) => calls.push([k, ...args]); }, set(t, k, v) { t[k] = v; return true; } });
  const view = { cx: 50, cz: 0, k: 2, w: 200, h: 160 };
  const hits = drawDiscoveryMarks(ctx, L.list(), view, { now: 1000 });
  const h = hits.find(q => q.id === 'coral:c1'), want = worldToMap(44, 2, view);
  ok(h && near(h.x, want[0]) && near(h.y, want[1]), 'marks: a mark is drawn at the map px of the discovery', JSON.stringify([h, want]));
  ok(!hits.find(q => q.id === 'coral:cFar'), 'marks: a mark out of the view is not drawn');
  ok(calls.some(q => q[0] === 'arc' && q[3] > 8), 'marks: a new mark pulses (a ring larger than the icon)');
  ok(pickMark(hits, want[0] + 3, want[1] - 2).id === 'coral:c1' && pickMark(hits, want[0] + 40, want[1]) === null, 'marks: the pick finds the mark under the pointer only');

  // the orbit frame
  const e = { p: [10, 5, 0], r: 2 };
  const fr = orbitFrame(e, { fov: 50, eye: [30, 10, 0] });
  const ang = Math.atan(e.r / fr.dist) / (25 * Math.PI / 180);
  ok(near(ang, FILL, 0.03) && fr.target.join() === '10,5,0' && near(fr.yaw, 0, 1e-9), 'orbit: the subject fills FILL of the view height, from the eye side', `${ang} ${fr.yaw}`);
  const blocked = orbitFrame(e, { fov: 50, eye: [30, 10, 0], clear: p => (p[0] > 12 ? 0 : 5) });
  ok(Math.cos(blocked.yaw) < 0.5, 'orbit: rock on the eye side turns the orbit to a clear side', String(blocked.yaw));
  ok(toastText({ name: 'Bubblegum coral', rov: 3 }) === 'ROV 3 found a bubblegum coral' && toastText({ name: 'Natural arch', rov: 1 }, 2) === 'ROV 1 found a natural arch (+2 more)', 'toast: the words');
  const vs = highlightSnowVS();
  const gl = checkPrograms([...HL_PROGRAMS, { name: 'snow', vs, fs: MARINE_SNOW_FS, instanced: false }]);
  for (const r of gl) ok(r.ok, `glsl: the highlight ${r.name} program passes naga`, (r.log || '').slice(0, 600));
  ok(vs.includes('(nearL ? cameraPosition : uHlBox) - 0.5 * B') && vs.includes('length(q - uHlBox)') && vs.includes('msLightSpots') && vs.includes('msPhase'), 'snow: the highlight snow is the marine-snow.js shader with the box on the subject and the highlight light');
}

// ── 3D ──────────────────────────────────────────────────────────────────────
{
  const scene = new THREE.Scene();
  const H = createHighlight(THREE, { scene, snowCount: 300 });
  ok(scene.children.includes(H.group) && !H.group.visible, '3d: the highlight group is in the scene, hidden');
  ok(H.snow && H.snow.count === 300 && H.snow.geometry.instanceCount > 0, '3d: a local marine snow cloud of a few hundred flakes', String(H.snow && H.snow.count));
  const e = { id: 'x', p: [110, 20, 50], r: 2, ground: 17 };
  H.attach(e, '#3fd0ff');
  for (let i = 0; i < 60; i++) H.update(1 / 30, i / 30, [100, 40]);
  const B = H.snow.uniforms.uHlBox.value;
  ok(H.group.visible && H.alpha > 0.6 && near(H.rim.position.x, 10) && near(H.rim.position.z, 10), '3d: attach fades in at the subject (render space)', `${H.alpha}`);
  ok(near(B.x, 10) && near(B.y, 20) && near(B.z, 10) && H.snow.uniforms.uHlLC.value.length() > 0, '3d: the snow box and the highlight light are on the subject');
  H.clear();
  for (let i = 0; i < 90; i++) H.update(1 / 30, 2 + i / 30, [100, 40]);
  ok(!H.group.visible && H.alpha === 0 && H.entry === null, '3d: clear fades out and hides it');
  H.dispose();
}

// ── jsdom ───────────────────────────────────────────────────────────────────
function jsdomClass() {
  try {
    const dirs = [process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(path.delimiter)].filter(Boolean);
    const req = createRequire(import.meta.url);
    return req(req.resolve('jsdom', { paths: dirs.length ? dirs : undefined })).JSDOM;
  } catch { return null; }
}
const JSDOM = jsdomClass();
if (!JSDOM) console.log('discoveries: jsdom not found (set JSDOM_DIR or NODE_PATH): the DOM parts SKIPPED');
else {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="minimap"><canvas id="mmCanvas"></canvas></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document;
  Object.defineProperty(win, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: 800, configurable: true });
  const draws = [];
  const ctx = new Proxy({}, { get(t, k) { if (k in t) return t[k]; if (k === 'createImageData') return (a, b) => ({ data: new Uint8ClampedArray(a * b * 4) }); if (k === 'measureText') return () => ({ width: 8 }); return (...a) => draws.push(k); }, set(t, k, v) { t[k] = v; return true; } });
  win.HTMLCanvasElement.prototype.getContext = () => ctx;
  Object.defineProperty(win.HTMLElement.prototype, 'offsetParent', { get() { return this.parentNode; }, configurable: true });
  const sq = fakeSquad();
  const cam = { mode: 'follow', eye: [44, 30, 30], look: [44, 19, 2], orbit: { target: [0, 0, 0] } };
  const tcam = new THREE.PerspectiveCamera(50, 1.6, 0.1, 500); tcam.position.set(0, 30, 30); tcam.lookAt(0, 19, 2); tcam.updateMatrixWorld(true);
  const scene = new THREE.Scene(), flights = [], cleared = [];
  let mapOpen = false, closed = 0;
  let clock = 1000;
  const realNow = globalThis.performance.now;
  globalThis.performance.now = () => clock * 1000;
  const Dm = mountDiscoveries({
    doc, win, THREE, scene, getSquad: () => sq, getCam: () => cam, camera: () => tcam, origin: () => [0, 0],
    colourOf: id => ['#f2b705', '#3fd0ff', '#ff6fae', '#9be15d'][id - 1], env: { ...env, now: () => clock },
    flyTo: (fr, e) => { flights.push([fr, e.id]); cam.mode = 'orbit'; cam.orbit.target = fr.target.slice(); return true; },
    onClear: why => cleared.push(why), mapOpen: () => mapOpen, closeMap: () => { closed++; mapOpen = false; },
  });
  Dm.tick(1.1, 1);
  const T = Dm.debug();
  ok(T.size === 3 && T.toasts.length === 1 && T.toasts[0].text.startsWith('ROV '), 'toast: three finds in one scan give one toast', JSON.stringify(T.toasts));
  ok(/\(\+2 more\)/.test(T.toasts[0].text), 'toast: the toast counts the others', T.toasts[0].text);
  sq.vehicles[1].state.p = [398, 20, 0];
  clock += 1.2; Dm.tick(1.1, 2);
  ok(Dm.debug().toasts.length === 1 && Dm.debug().waiting === 1, 'toast: a new find within TOAST_GAP s waits');
  clock += TOAST_GAP; Dm.tick(0.1, 3);
  ok(Dm.debug().toasts.length === 2 && /staghorn coral/.test(Dm.debug().toasts[1].text), 'toast: it shows after the gap', JSON.stringify(Dm.debug().toasts));

  // the minimap: squad-hud.js draws the marks (o.marks.draw), the box listeners hover and click
  const mmc = doc.getElementById('mmCanvas');
  mmc.getBoundingClientRect = () => ({ left: 20, top: 500, width: 220, height: 220 });
  const mv = { cx: 44, cz: 0, k: 220 / 240, w: 220, h: 220 };
  Dm.marks.draw(ctx, mv, 'mini');
  const mp = worldToMap(44, 2, mv);
  let opened = 0;
  mmc.addEventListener('pointerup', () => opened++);     // squad-hud.js: a click opens the large map
  const pe = (type, x, y, o2 = {}) => { const ev = new win.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }); Object.defineProperty(ev, 'pointerType', { value: o2.touch ? 'touch' : 'mouse' }); mmc.dispatchEvent(ev); return ev; };
  pe('pointermove', 20 + mp[0] + 2, 500 + mp[1]);
  const card = doc.getElementById('dscCard');
  ok(!card.hidden && card.dataset.id === 'coral:c1' && /Bubblegum coral/.test(card.textContent) && /39 m deep · Reef/.test(card.textContent) && /Found by ROV 1/.test(card.textContent) && /ago|just now/.test(card.textContent), 'minimap: hover shows the card (name, kind, depth, region, found by, time ago)', card.textContent);
  pe('pointermove', 20 + mp[0], 500 + mp[1] + 60);
  ok(card.hidden, 'minimap: the card hides off the mark');
  pe('pointerdown', 20 + mp[0], 500 + mp[1]); pe('pointerup', 20 + mp[0], 500 + mp[1]);
  const [fr, fid] = flights[0] || [];
  const fill = fr ? Math.atan(1.6 / fr.dist) / (25 * Math.PI / 180) : 0;
  ok(fid === 'coral:c1' && fr.target.join() === '44,19,2' && near(fill, FILL, 0.03), 'minimap: a click flies the camera into an orbit (target and fill)', JSON.stringify(fr));
  ok(opened === 0, 'minimap: a click on a mark does not open the large map');
  pe('pointerdown', 20 + mp[0], 500 + mp[1] + 60); pe('pointerup', 20 + mp[0], 500 + mp[1] + 60);
  ok(opened === 1, 'minimap: a click off the marks still opens the large map');
  ok(Dm.selected === 'coral:c1' && Dm.highlight.entry && Dm.highlight.entry.id === 'coral:c1', 'highlight: it attaches to the selected discovery');
  clock += 1; Dm.tick(0.5, 4);
  const lab = doc.getElementById('dscLabel');
  ok(/Bubblegum coral/.test(lab.textContent), 'highlight: a floating label has the name', lab.textContent);
  win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(Dm.selected === null && cleared[0] === 'esc' && Dm.highlight.want === 0, 'highlight: Esc clears it');
  for (let i = 0; i < 40; i++) Dm.tick(1 / 20, 5 + i / 20);
  ok(!Dm.highlight.group.visible, 'highlight: it fades out after Esc');
  // touch: the first tap shows the card with an Orbit button
  pe('pointerdown', 20 + mp[0], 500 + mp[1], { touch: true }); pe('pointerup', 20 + mp[0], 500 + mp[1], { touch: true });
  const go = card.querySelector('.dsc-go');
  ok(!card.hidden && go && flights.length === 1, 'touch: a tap shows the card and an Orbit button, no flight yet');
  go.click();
  ok(flights.length === 2 && Dm.selected === 'coral:c1', 'touch: Orbit flies the camera');
  // the camera leaves: the highlight goes
  clock += 3; cam.mode = 'swim'; Dm.tick(0.1, 7);
  ok(Dm.selected === null && cleared[cleared.length - 1] === 'left', 'highlight: it clears when the camera leaves');

  // the large map: marks, hover, click (closes the map, orbits)
  const hud = { selected: () => 1, select: () => true, sendTo: () => true, colourOf: id => '#f2b705' };
  const M = mountExploreMap({
    doc, win, getSquad: () => sq, getField: () => ({ ground: () => 16, regionAt: () => ({ id: 'reef', name: 'Reef' }) }), getCam: () => cam, camera: () => ({ fov: 50 }), canvas: { clientWidth: 1280, clientHeight: 800 },
    surfaceY: 55, phoneQ: { matches: false }, isSaver: () => false, flash: () => {}, hud, marks: Dm.marks, moveCam: () => {},
  });
  M.open(); mapOpen = true;
  M.view = { cx: 44, cz: 0, k: 4, w: 800, h: 600 };
  draws.length = 0; clock += 0.1; M.tick(0.05); clock += 0.1; M.tick(0.05);
  const bp = worldToMap(44, 2, M.view);
  ok(Dm.debug().hits.big >= 2, 'big map: the marks are drawn', JSON.stringify(Dm.debug().hits));
  const xc = doc.getElementById('xmCanvas');
  xc.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 600 });
  const xe = (type, x, y) => { const ev = new win.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }); Object.defineProperty(ev, 'pointerId', { value: 1 }); Object.defineProperty(ev, 'pointerType', { value: 'mouse' }); xc.dispatchEvent(ev); };
  xe('pointermove', 100 + bp[0] + 1, 50 + bp[1] + 1);
  ok(!card.hidden && card.dataset.id === 'coral:c1', 'big map: hover shows the card');
  xe('pointerdown', 100 + bp[0], 50 + bp[1]); xe('pointerup', 100 + bp[0], 50 + bp[1]);
  ok(flights.length === 3 && flights[2][1] === 'coral:c1' && closed === 1 && Dm.selected === 'coral:c1', 'big map: a click closes the map and orbits the discovery');
  ok(!M.debug().actions.some(a => a.kind === 'send'), 'big map: a click on a mark does not send an ROV');
  ok(doc.getElementById('xmSnow') && M.snow, 'big map: the snow layer is there');

  // the map snow specks: a few dozen, low alpha; reduced motion: off
  const cv = doc.createElement('canvas'); const fills = [];
  const sctx = { setTransform() {}, clearRect() {}, beginPath() {}, arc() {}, fill() { fills.push(this.fillStyle); } };
  cv.getContext = () => sctx;
  const sn = mapSnow(cv, win);
  sn.step(0.05);
  const alphas = fills.map(f => +/,([\d.]+)\)$/.exec(f)[1]);
  ok(sn.specks.length >= 24 && sn.specks.length <= 60 && fills.length === sn.specks.length && Math.max(...alphas) <= 0.35, 'map snow: a few dozen faint specks', `${sn.specks.length} ${Math.max(...alphas)}`);
  win.matchMedia = q => ({ matches: /reduce/.test(q), addEventListener() {} });
  ok(mapSnow(cv, win).start() === false, 'map snow: off with prefers-reduced-motion');
  globalThis.performance.now = realNow;

  // the squad-hud.js minimap draw calls the marks
  try {
    const { mountSquadHud } = await import('../squad-hud.js');
    const drawn = [];
    const Hd = mountSquadHud({
      doc, win, THREE: null, canvas: { clientWidth: 1280, clientHeight: 800 }, camera: () => ({ fov: 50 }), getSquad: () => sq, getRovs: () => null,
      getField: () => ({ ground: () => 16, regionAt: () => null }), getCam: () => cam, surfaceY: 55, phoneQ: { matches: false }, isSaver: () => false,
      feedOn: () => false, onSelect: () => {}, flash: () => {}, marks: { draw: (c, v, key) => drawn.push([key, v.cx]), hover() {}, click() { return false; }, leave() {}, animating: () => false },
    });
    Hd.setRovs({ vehicles: sq.vehicles.map(v => ({ id: v.id })) });
    Hd.drawMap();
    ok(drawn.length === 1 && drawn[0][0] === 'mini' && drawn[0][1] === 40, 'squad-hud: the minimap draw draws the marks', JSON.stringify(drawn));
  } catch (e) { ok(false, 'squad-hud: the minimap draw draws the marks', e.stack); }
}

console.log(`\ndiscoveries: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
