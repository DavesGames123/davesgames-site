// ============================================================================
//  CORAL REEF  ·  tests/manual.test.mjs  ·  control mode (node + jsdom)
//    node tests/manual.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "if i have an ROV selected and I start using
//  wasd, it should override its motion and allow me to maneuver the vehicle
//  in control mode until i click on the portrait again to bring us back to
//  auto mode". Checks:
//    squad ..... rov/squad.js setManual/drive on the real world field: the
//                ROV goes the commanded way, the others keep planner tasks,
//                no ROV comes into the rock while it drives into the floor,
//                setManual off gives a planner task again
//    page ...... the real main.js in jsdom (page-harness.mjs): W in follow
//                mode takes the ROV, the MANUAL badge and the task text
//                show, a click on its feed card and Esc give it back, W in
//                swim mode does not take it
//  Without jsdom (JSDOM_DIR or NODE_PATH) the page part skips.
// ============================================================================
import { createWorld } from '../world/field.js';
import { worldPhysics } from '../world/physics.js';
import { createSquad } from '../rov/squad.js';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) { pass++; console.log(`ok   ${name}${info !== '' ? '  ' + info : ''}`); } else { fail++; console.log(`FAIL ${name}${info !== '' ? '  ' + info : ''}`); } };

// ── squad ───────────────────────────────────────────────────────────────────
{
  const W = createWorld({ seed: 1 }), SC = W.sdfScale;
  let R0 = null;
  for (let j = -30; j <= 30; j++) for (let i = -30; i <= 30; i++) {
    const x = i * 500, z = j * 500;
    if (W.regionAt(x, z).id !== 'reef') continue;
    const s = W.habitat(x, z) - Math.hypot(i, j) * 0.002;
    if (!R0 || s > R0.s) R0 = { s, x, z };
  }
  const P = worldPhysics(W, null, { clear: 0.62 });
  const S = createSquad({ field: P, seed: 1, count: 3, clear: 0.62, start: [R0.x, W.ground(R0.x, R0.z) + 3, R0.z] });
  const dt = 1 / 30;
  let minRock = Infinity;
  const run = (sec, cmd) => { for (let i = 0; i < sec / dt; i++) { if (cmd) S.drive(2, cmd); S.step(dt); for (const v of S.vehicles) minRock = Math.min(minRock, W.sdfAll(...v.state.p) / SC); } };
  run(20);
  ok(S.setManual(2, true) && S.isManual(2), 'setManual takes ROV 2 from the planner');
  const v = S.vehicles[1], p0 = v.state.p.slice(), yaw0 = v.state.yaw;
  run(10, { fwd: 1 });
  const d = [v.state.p[0] - p0[0], v.state.p[2] - p0[2]], along = d[0] * Math.cos(yaw0) + d[1] * Math.sin(yaw0);
  ok(along > 3, 'W thrusts ROV 2 forward along its heading', `${along.toFixed(2)} m in 10 s`);
  const sp = Math.hypot(...v.state.v);
  ok(sp > 0.4 && sp < 0.95, 'the speed has a top limit (drag)', `${sp.toFixed(2)} m/s`);
  const T = S.tasks();
  ok(T[1].kind === 'manual' && T[1].label === 'manual control', 'the task of ROV 2 is "manual control"');
  ok(T[0].kind !== 'manual' && T[2].kind !== 'manual', 'the others keep planner tasks', `${T[0].label} | ${T[2].label}`);
  const y0 = v.state.yaw; run(3, { yaw: 1 });
  ok(v.state.yaw - y0 > 0.5 && v.state.yaw - y0 < 2.5, 'D turns it with a smooth yaw rate', `${(v.state.yaw - y0).toFixed(2)} rad in 3 s`);
  minRock = Infinity; run(30, { fwd: 1, up: -1, boost: true });
  ok(minRock > 0.3, 'driven into the floor, no ROV comes into the rock', `min ${minRock.toFixed(2)} m`);
  let near = Infinity;
  S.setManual(1, true);                    // ROV 1 holds still: ROV 2 drives at it
  S.vehicles[1].state.p = S.vehicles[0].state.p.map((q, i) => q + (i === 0 ? 6 : 0));
  for (let i = 0; i < 6 / dt; i++) {
    const a = S.vehicles[0].state.p, b = S.vehicles[1].state.p, to = [a[0] - b[0], a[2] - b[2]];
    S.vehicles[1].state.yaw = Math.atan2(to[1], to[0]); S.drive(2, { fwd: 1 }); S.step(dt);
    near = Math.min(near, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }
  ok(near > 1.2 && near < 4, 'driven at ROV 1, it does not hit it', `min ${near.toFixed(2)} m`);
  S.setManual(1, false);
  ok(S.setManual(2, false) && !S.isManual(2), 'setManual off gives ROV 2 back');
  run(3);
  ok(S.tasks()[1].kind !== 'manual', 'the planner has ROV 2 again', S.tasks()[1].label);
  S.setManual(1, true); run(2, null); S.setManual(1, false); run(1);
  ok(S.tasks()[0].kind !== 'manual' && !!S.leg, 'the lead ROV gets a new leg after manual control', S.tasks()[0].label);
}

// ── page ────────────────────────────────────────────────────────────────────
const { bootPage, loadJsdom } = await import('./page-harness.mjs');
if (!loadJsdom()) console.log('manual: jsdom not found (set JSDOM_DIR or NODE_PATH), page part skipped');
else {
  const P = await bootPage({ w: 1280, h: 720, dpr: 1, search: '?profile=laptop-low' });
  const Wn = P.win, D = P.doc;
  const until = async (f, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await P.run(100); } return !!f(); };
  const key = (type, code) => Wn.dispatchEvent(new Wn.KeyboardEvent(type, { code, bubbles: true }));
  const built = await until(() => { const d = Wn.__coralDebug(); return d.worldReady && d.rovs > 0 && Wn.snWorld.squad; }, 120000);
  ok(built, 'the world and the ROVs are built');
  await P.run(300);
  const sq = () => Wn.snWorld.squad, cam = () => Wn.__coralDebug().cam || {};
  ok(cam().mode === 'follow', 'the camera follows the selected ROV', JSON.stringify(cam()));
  const id = cam().followId, vi = sq().vehicles.findIndex(v => v.id === id);
  const p0 = sq().vehicles[vi].state.p.slice(), yaw0 = sq().vehicles[vi].state.yaw;
  key('keydown', 'KeyW'); await P.run(2500);
  ok(sq().isManual(id), `W takes ROV ${id} into control mode`);
  const p1 = sq().vehicles[vi].state.p, along = (p1[0] - p0[0]) * Math.cos(yaw0) + (p1[2] - p0[2]) * Math.sin(yaw0);
  ok(along > 0.3, 'the ROV moves forward', `${along.toFixed(2)} m`);
  ok(sq().tasks().filter(t => t.kind === 'manual').length === 1, 'the other ROVs keep their planner tasks', sq().tasks().map(t => t.label).join(' | '));
  const card = () => D.querySelector(`#feedSlot .fcard[data-rov="${id}"]`);
  ok(card() && card().querySelector('.mbadge') && card().classList.contains('manual'), 'the feed card shows the MANUAL badge');
  ok(!!D.querySelector(`#rovTags .rtag.manual[data-rov="${id}"]`) && !!D.querySelector(`#rovPick button.manual[data-rov="${id}"]`), 'the 3D tag and the camera bar button show MANUAL');
  const hint = D.getElementById('manualHint');
  ok(hint && !hint.hidden && /return to auto/.test(hint.textContent), 'the hint says how to return to auto', hint ? hint.textContent : '');
  ok(/manual control/.test(D.getElementById('camFollowLbl').textContent), 'the camera label says manual control');
  key('keyup', 'KeyW'); await P.run(200);
  card().querySelector('.fpick').click(); await P.run(1500);
  ok(!sq().isManual(id) && !card().querySelector('.mbadge') && hint.hidden, 'a click on its feed card returns it to auto');
  ok(sq().tasks()[vi].kind !== 'manual', 'the planner resumes', sq().tasks()[vi].label);
  key('keydown', 'KeyD'); await P.run(300); key('keyup', 'KeyD');
  ok(sq().isManual(id), 'D takes it again');
  key('keydown', 'Escape'); await P.run(300);
  ok(!sq().isManual(id), 'Esc returns it to auto');
  D.querySelector('#camBar button[data-cam="swim"]').click(); await P.run(200);
  key('keydown', 'KeyW'); await P.run(800); key('keyup', 'KeyW');
  ok(cam().mode === 'swim' && !sq().vehicles.some(v => sq().isManual(v.id)), 'W in swim mode moves the camera, not an ROV', cam().mode);
}
console.log(`manual: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
