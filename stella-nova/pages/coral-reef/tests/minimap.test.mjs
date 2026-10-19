// ============================================================================
//  CORAL REEF  ·  the minimap and the card layout (node, pure functions)
//                 node tests/minimap.test.mjs
// ----------------------------------------------------------------------------
//  The user said (2026-10-18): "a minimap on the bottom left of what they've
//  explored so far". Checks of minimap.js and squad-hud.js:
//    map ....... the projection and its inverse, only visited cells are
//                painted (the fog), each cell once, the buffer moves with
//                the view, the arrows at the projected ROV positions with
//                the heading of the yaw, the scale bar, the view cone
//    layout .... feedLayout fits the card stack under the readout; one
//                card on a phone; the task text of each ROV
// ============================================================================
import { worldToMap, mapToWorld, headingVec, createFogMap, drawMinimap, niceScale, depthColour, contourLevel, cellKey, MAP_CELL, coneOf } from '../minimap.js';
import { feedLayout, vehicleTask } from '../squad-hud.js';
import { rovColour } from '../rov/hud.js';

let pass = 0, fail = 0;
const ok = (c, name, info = '') => { if (c) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name} ${info}`); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// ── the minimap ────────────────────────────────────────────────────────────
{
  const v = { cx: 1000, cz: -400, k: 200 / 240, w: 200, h: 200 };
  const a = worldToMap(1000, -400, v), b = worldToMap(1120, -400, v), c = worldToMap(1000, -520, v);
  ok(near(a[0], 100) && near(a[1], 100) && near(b[0], 200) && near(c[1], 0), 'map: the view centre is the map centre; east is right, north (-z) is up', JSON.stringify([a, b, c]));
  let worst = 0;
  for (let i = 0; i < 50; i++) { const x = 900 + i * 7.3, z = -500 + i * 3.1, m = worldToMap(x, z, v), w = mapToWorld(m[0], m[1], v); worst = Math.max(worst, Math.hypot(w[0] - x, w[1] - z)); }
  ok(worst < 1e-9, 'map: mapToWorld inverts worldToMap (a tap gives the world point)', worst);
  const hv = headingVec(Math.PI / 2);
  ok(near(hv[0], 0) && near(hv[1], 1), 'map: yaw pi/2 (+z, south) points down the map');
  const sc = niceScale(200 / 240, 50);
  ok([50, 100].includes(sc.m) && sc.px > 30 && sc.px < 90, 'map: the scale bar has a round length', JSON.stringify(sc));
  ok(depthColour(0)[1] > depthColour(1000)[1] && depthColour(1000)[1] > depthColour(6000)[1] && contourLevel(100) > contourLevel(50), 'map: deeper is darker; the contour level rises with depth');
  const cone = coneOf([0, 0, 0], [0, 0, 10], Math.PI / 2, 10);
  ok(cone && near(cone[1][0], 10 * Math.cos(Math.PI / 4)) && near(cone[2][0], -10 * Math.cos(Math.PI / 4)), 'map: the view cone opens round the look direction', JSON.stringify(cone));

  // fog: only the visited cells are painted
  let calls = 0;
  const F = createFogMap({ ground: (x, z) => { calls++; return 30 - 0.02 * x + 3 * Math.sin(z / 20); }, region: () => ({ id: 'reef' }), surfaceY: 55, size: 256, res: 3 });
  const visited = new Map([['0,0', 1], ['1,0', 1], ['2,1', 1], ['-3,-2', 1]]);
  F.follow(0, 0, 100, visited.keys());
  let n = 0; while (F.pending) n += F.work(50);
  ok(n === 4 && F.painted.size === 4, 'map: the fog paints each visited cell once', `${n} painted`);
  const at = (i, j) => F.pixelAt(i * MAP_CELL + 6, j * MAP_CELL + 6);
  const shown = [[0, 0], [1, 0], [2, 1], [-3, -2]].every(([i, j]) => at(i, j)[3] === 255);
  const dark = [[0, 1], [1, 1], [3, 1], [-2, -2], [5, 5], [-1, 0]].every(([i, j]) => at(i, j)[3] === 0);
  ok(shown && dark, 'map: visited cells are revealed, the cells round them stay dark', JSON.stringify([at(0, 1), at(1, 1)]));
  let alpha = 0; for (let i = 3; i < F.pixels.length; i += 4) if (F.pixels[i]) alpha++;
  ok(alpha === 4 * 16, 'map: exactly 16 px (12 m at 3 m a px) for each visited cell', `${alpha} px`);
  const c0 = calls; F.add('0,0'); F.work(10);
  ok(calls === c0, 'map: a cell seen again costs nothing');
  ok(!F.add(cellKey(200, 200)), 'map: a cell outside the buffer waits for the buffer to move');
  const moved = F.follow(2400, 2400, 100, visited.keys());
  ok(moved && F.painted.size === 0 && F.pending === 0, 'map: the buffer moves with the view; cells far away are not painted');

  // the draw: arrows at the projected ROV positions
  const ops = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { ops.push([k, ...a]); }), set: (t, k, v2) => { t[k] = v2; return true; } });
  const rovs = [
    { id: 1, p: [1010, 20, -380], yaw: 0, colour: rovColour(1), trail: [[1000, -390], [1005, -385]], sel: false },
    { id: 2, p: [960, 18, -430], yaw: Math.PI / 2, colour: rovColour(2), trail: [], sel: true },
    { id: 3, p: [1050, 22, -400], yaw: Math.PI, colour: rovColour(3), trail: [], sel: false },
  ];
  const r = drawMinimap(ctx, { w: 200, h: 200, view: v, fog: null, rovs, cone: null, title: 'ROV 2 · Reef', sub: '37 m deep' });
  const okPos = rovs.every(q => { const m = worldToMap(q.p[0], q.p[2], v), A = r.arrows.find(x => x.id === q.id); return A && near(A.x, m[0]) && near(A.y, m[1]) && near(A.ang, Math.atan2(Math.sin(q.yaw), Math.cos(q.yaw))); });
  ok(okPos && r.arrows.length === 3, 'map: each ROV arrow is at its projected position with the heading of its yaw', JSON.stringify(r.arrows));
  ok(r.arrows[r.arrows.length - 1].id === 2 && r.arrows[r.arrows.length - 1].sel, 'map: the selected ROV is drawn last (on top) and marked');
  const tr = ops.filter(o => o[0] === 'translate');
  ok(tr.length === 3 && tr.every((o, i) => near(o[1], r.arrows[i].x) && near(o[2], r.arrows[i].y)), 'map: the arrows are drawn where they are reported');
  ok(ops.some(o => o[0] === 'fillText' && /m$/.test(o[1])) && ops.some(o => o[0] === 'fillText' && o[1] === 'ROV 2 · Reef'), 'map: the scale bar and the region of the selected ROV are written');
}

// ── the layout ─────────────────────────────────────────────────────────────
{
  for (const [vw, vh] of [[1440, 900], [1280, 720], [1024, 768]]) for (const n of [2, 3, 4]) {
    const top = 220, L = feedLayout({ vw, vh, n, top, bottom: 14 });
    ok(L.height <= vh - top - 14 + 1 && L.main > L.thumb && (L.one ? L.thumb === 0 : L.thumb >= 80), `layout ${vw}x${vh}, ${n} cards: the stack fits under the readout, the main card is the largest`, JSON.stringify(L));
  }
  const P = feedLayout({ vw: 390, vh: 844, n: 3, phone: true });
  ok(P.one && P.thumb === 0, 'layout: a phone has one card');
  const sq = { vehicles: [{ id: 1, state: { mode: 'survey' } }, { id: 2, state: { mode: 'inspect' } }, { id: 3, state: { mode: 'survey' } }], task: { label: 'following a canyon' } };
  ok(vehicleTask(sq, 0) === 'following a canyon' && vehicleTask(sq, 1) === 'lighting the colony' && vehicleTask(sq, 2) === 'following ROV 1', 'layout: the tag text says the task of each ROV');
}

console.log(`minimap: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
