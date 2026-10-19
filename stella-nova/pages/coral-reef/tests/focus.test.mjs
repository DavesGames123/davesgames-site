// ============================================================================
//  CORAL REEF  ·  tests/focus.test.mjs  ·  the inspection light of an orbit
//    node tests/focus.test.mjs   (jsdom: NODE_PATH or JSDOM_DIR)
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "there's a problem that focusing on objects
//  does not light them up in deep water". A deep subject (twilight zone of
//  seed 1) outside every ROV lamp cone:
//    dark ...... the ROV lamps give it no light (spotRadiance < DARK)
//    key ....... discoveries.js select() turns on the key light
//                (focus-light.js): the subject gets more than LIT
//    fade ...... after clear() the key light fades to off (null) in 2 s
//    squad ..... S.inspect sends one ROV; in 40 s it is near the subject and
//                its lamp, aimed at the subject, gives more than LIT
//    release ... S.release puts the ROV back on its own plan
//    GLSL ...... shaders.js lightSurf has the key term (uKeyP, uKeyC)
// ============================================================================
import path from 'node:path';
import { createRequire } from 'node:module';
import * as THREE from '../../../vendor/three@0.160.0/build/three.module.js';
import { keyFrame, keyRadiance, spotRadiance } from '../focus-light.js';
import { mountDiscoveries } from '../discoveries.js';
import { createWorld } from '../world/field.js';
import { worldPhysics } from '../world/physics.js';
import { createSquad } from '../rov/squad.js';
import { WATER } from '../shaders.js';

let pass = 0, fail = 0;
function ok(c, name, info = '') { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name}${info !== '' ? '  ' + info : ''}`); } }
const LIT = 0.12, DARK = 1e-3, FOG = [0.07, 0.04, 0.03];
const lum = c => (c[0] + c[1] + c[2]) / 3;
const LAMP = { range: 42, cosOuter: Math.cos(0.44), cosInner: Math.cos(0.44 * 0.45), c: [420 * 0.004, 420 * 0.004 * 0.94, 420 * 0.004 * 0.86] };
const lampOf = st => { const d = [st.look[0] - st.p[0], st.look[1] - st.p[1], st.look[2] - st.p[2]], l = Math.hypot(...d) || 1; return Object.assign({ p: st.p, dir: d.map(v => v / l) }, LAMP); };
const lampsLight = (S, p, n) => S.vehicles.reduce((a, v) => a + lum(spotRadiance(lampOf(v.state), p, FOG)) * Math.max(0, 1), 0);

ok(/uKeyP/.test(WATER) && /keyRad\(w, L\)/.test(WATER), 'GLSL: lightSurf adds the key light term (uKeyP, uKeyC)');

// ── a deep subject outside every cone ─────────────────────────────────────
const W = createWorld({ seed: 1 });
let site = null;
for (let x = -40000; x <= 40000 && !site; x += 2000) for (let z = -40000; z <= 40000; z += 2000) { const g = W.regionAt(x, z); if (g.id === 'twilight' && g.depth > 250 && g.depth < 900) { site = [x, z, g.depth]; break; } }
ok(!!site, 'deep: a twilight-zone site', JSON.stringify(site));
const P = worldPhysics(W, null, { clear: 0.62 });
const start = [site[0], W.ground(site[0], site[1]) + 3, site[1]];
const S = createSquad({ field: P, seed: 1, count: 3, clear: 0.62, start });
for (let i = 0; i < 90; i++) S.step(1 / 30);
// the subject: 14 m behind the leader, on the ground
const L0 = S.vehicles[0].state, bx = start[0] - Math.cos(L0.yaw) * 14, bz = start[2] - Math.sin(L0.yaw) * 14;
const subj = { id: 'coral:deep1', cat: 'coral', kind: 'bubblegum', name: 'Bubblegum coral', p: [bx, W.ground(bx, bz) + 1.2, bz], r: 1.4, ground: W.ground(bx, bz), depth: Math.round(site[2]), region: 'Twilight zone', rov: 2, t: 3, at: 0 };
const up = [0, 1, 0];
const dark = lampsLight(S, subj.p, up);
ok(dark < DARK, 'dark: no ROV lamp cone lights the deep subject', `lamp light ${dark.toExponential(2)}`);

// ── the key light through discoveries.js ──────────────────────────────────
function jsdomClass() {
  try {
    const dirs = [process.env.JSDOM_DIR, ...(process.env.NODE_PATH || '').split(path.delimiter)].filter(Boolean);
    const req = createRequire(import.meta.url);
    return req(req.resolve('jsdom', { paths: dirs.length ? dirs : undefined })).JSDOM;
  } catch { return null; }
}
const JSDOM = jsdomClass();
ok(!!JSDOM, 'jsdom: found (NODE_PATH or JSDOM_DIR)');
if (JSDOM) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  const win = dom.window, doc = win.document;
  const tcam = new THREE.PerspectiveCamera(50, 1.6, 0.1, 500);
  const cam = { mode: 'follow', eye: [0, 0, 0], look: subj.p.slice(), orbit: { target: subj.p.slice() } };
  let key = 'unset', inspected = [], released = [];
  const ext = { value: new THREE.Vector3(...FOG) };
  const Dm = mountDiscoveries({
    doc, win, THREE, scene: new THREE.Scene(), getSquad: () => null, getCam: () => cam, camera: () => tcam, origin: () => [0, 0], ext,
    flyTo: fr => { cam.mode = 'orbit'; cam.orbit.target = fr.target.slice(); tcam.position.set(fr.target[0] + fr.dist * 0.8, fr.target[1] + fr.dist * 0.3, fr.target[2] + fr.dist * 0.5); return true; },
    inspect: e => { inspected.push(e.id); return S.inspect(1, e.p, e.r); }, release: id => { released.push(id); S.release(id); },
    keyLight: K => { key = K; },
  });
  Dm.log.add(subj);
  Dm.select(subj.id);
  for (let i = 0; i < 60; i++) Dm.tick(1 / 30, i / 30);
  const lit = key && key !== 'unset' ? lum(keyRadiance(key, subj.p, [0, 1, 0])) + 0 : 0;
  const toEye = [tcam.position.x - subj.p[0], tcam.position.y - subj.p[1], tcam.position.z - subj.p[2]], le = Math.hypot(...toEye);
  const litEye = key && key !== 'unset' ? lum(keyRadiance(key, subj.p, toEye.map(v => v / le))) : 0;
  ok(lit > LIT && litEye > LIT, 'key: the orbit lights the deep subject (top face and the face to the eye)', `top ${lit.toFixed(3)}, eye side ${litEye.toFixed(3)} > ${LIT}; alpha ${Dm.highlight.alpha.toFixed(2)}`);
  ok(inspected[0] === subj.id && Dm.debug().inspector != null && Dm.debug().inspector !== 1, 'squad: select asks for an ROV (the leader sends another one)', `ROV ${Dm.debug().inspector}`);
  const rid = Dm.debug().inspector;
  // the ROV flies there and aims its lamps
  let best = 0, t = 0;
  for (; t < 40 * 30; t++) { S.step(1 / 30); if (t % 15 === 0) { const v = S.vehicles.find(q => q.id === rid); best = Math.max(best, lum(spotRadiance(lampOf(v.state), subj.p, FOG))); if (best > LIT * 2) break; } }
  const v = S.vehicles.find(q => q.id === rid), dist = Math.hypot(v.state.p[0] - subj.p[0], v.state.p[1] - subj.p[1], v.state.p[2] - subj.p[2]);
  ok(best > LIT, `squad: ROV ${rid} reaches the subject and its lamp lights it`, `${(t / 30).toFixed(1)} s, ${dist.toFixed(1)} m away, lamp ${best.toFixed(3)} > ${LIT}`);
  ok(S.tasks().find(q => q.id === rid).kind === 'focus', 'squad: its task is "lighting the orbit subject"', S.tasks().find(q => q.id === rid).label);
  Dm.clear('esc');
  ok(released[0] === rid && S.tasks().find(q => q.id === rid).kind !== 'focus', 'release: clear() gives the ROV back to its own plan', S.tasks().find(q => q.id === rid).kind);
  const k0 = key ? lum(keyRadiance(key, subj.p, [0, 1, 0])) : 0;
  for (let i = 0; i < 12; i++) Dm.tick(1 / 30, 3 + i / 30);
  const kMid = key ? lum(keyRadiance(key, subj.p, [0, 1, 0])) : 0;
  for (let i = 0; i < 60; i++) Dm.tick(1 / 30, 4 + i / 30);
  ok(kMid < k0 && key === null, 'fade: the key light fades out, then turns off (null)', `${k0.toFixed(3)} -> ${kMid.toFixed(3)} -> ${key === null ? 'off' : 'on'}`);
}
{
  const K = keyFrame([0, 10, 10], [0, 0, 0], 1, 1, FOG), K0 = keyFrame([0, 10, 10], [0, 0, 0], 1, 0, FOG);
  ok(lum(keyRadiance(K, [0, 0, 0], [0, 1, 0])) > LIT && lum(keyRadiance(K0, [0, 0, 0], [0, 1, 0])) === 0 && lum(keyRadiance(K, [0, 0, 60], [0, 1, 0])) === 0, 'key: alpha 0 is off, and the light has a range');
}

console.log(`focus: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
