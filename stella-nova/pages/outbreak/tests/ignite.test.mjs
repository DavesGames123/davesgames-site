// ignite: the page animations. City ignitions (render/ignite.js), planes
// that ignite their destination when they land (render/arcs.js), the
// shockwave rings and flashes (render/nodes.js), and the ticking HUD
// counters (stats.js). Real three.js objects in node, no GPU.
import { readFileSync } from 'node:fs';
import * as THREE from '../../../vendor/three@0.160.0/build/three.module.js';
import * as geo from '../geo.js';
import { parseNodes } from '../data.js';
import { buildNetwork } from '../network.js';
import { IGNITE, ARRIVAL_POWER, igniteLimits, igniteState, createIgnition } from '../render/ignite.js';
import { createArcs, KIND } from '../render/arcs.js';
import { createNodes, ringState, RING_DUR, RING_PX, RING_POOL, RING_POOL_PHONE } from '../render/nodes.js';
import { IGN_SLOTS } from '../render/infect.js';
import { tickCounter } from '../stats.js';

export default function (ok) {
  // ── the look of one ignition ──
  const s0 = igniteState(0), s1 = igniteState(IGNITE.flash), sEnd = igniteState(IGNITE.dur);
  ok('ignite: a sharp flash that is over in under 0.3 s', s0.flash === 1 && s1.flash === 0 && IGNITE.flash <= 0.3);
  let grow = true, fade = true, last = null;
  for (let k = 1; k < 40; k++) {
    const s = igniteState(k / 40 * IGNITE.dur);
    if (last && !(s.ringPx > last.ringPx)) grow = false;
    if (last && !(s.ringA < last.ringA)) fade = false;
    last = s;
  }
  ok('ignite: the shockwave ring only grows and only fades, then ends', grow && fade && sEnd === null);
  ok('ignite: a weaker ignition (a plane into a city with cases) rings smaller', igniteState(1, ARRIVAL_POWER).ringPx < igniteState(1, 1).ringPx && igniteState(1, ARRIVAL_POWER).bloom < igniteState(1, 1).bloom);
  ok('ignite: the ring stays inside its px cap, smaller on a phone', igniteState(IGNITE.dur * 0.999).ringPx <= IGNITE.ringPx && igniteLimits(true).ringPx < igniteLimits(false).ringPx);

  // ── the bus ──
  const bus = createIgnition();
  bus.now = 1;
  ok('bus: fire takes a slot', bus.fire(5, 1) >= 0 && bus.live === 1);
  ok('bus: one node does not fire twice in NODE_GAP', bus.fire(5, 1) === -1 && bus.live === 1);
  bus.now = 1 + IGNITE.nodeGap + 0.01;
  ok('bus: after the gap it fires again', bus.fire(5, 1) >= 0);
  for (let i = 0; i < 100; i++) bus.fire(100 + i, i % 2 ? 1 : ARRIVAL_POWER);
  ok('bus: the pool is capped (24 desktop, 10 phone)', bus.live === 24 && createIgnition({ phone: true }).n === 10);
  const out = Array.from({ length: IGN_SLOTS }, () => ({ x: 0, y: 0, z: 0, w: -1 }));
  const used = bus.slots(() => [1, 0, 0], out);
  ok('bus: the shader slots take only strong ignitions, up to the slot count', used === IGN_SLOTS && out.every(o => o.w >= 0 && o.w < IGNITE.dur));
  const outP = Array.from({ length: IGN_SLOTS }, () => ({ x: 0, y: 0, z: 0, w: -1 }));
  const busP = createIgnition({ phone: true }); busP.now = 0;
  for (let i = 0; i < 20; i++) busP.fire(i, 1);
  ok('bus: a phone fills at most 4 shader slots', busP.slots(() => [1, 0, 0], outP) === 4 && outP.filter(o => o.w >= 0).length === 4);
  const c0 = bus.since(0);
  ok('bus: since(cursor) lists the new fires once', c0.list.length > 0 && bus.since(c0.cursor).list.length === 0);
  bus.now += IGNITE.dur + 0.1; bus.expire();
  ok('bus: ignitions expire (no leak)', bus.live === 0 && bus.slots(() => [1, 0, 0], out) === 0 && out.every(o => o.w === -1));

  // ── planes ignite their destination when they land ──
  const D = parseNodes(JSON.parse(readFileSync(new URL('../data/nodes.json', import.meta.url))));
  const net = buildNetwork(D);
  const root = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(35, 1.5, 0.01, 100);
  camera.position.set(0, 0.8, 3); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const ign = createIgnition();
  const ctx = { THREE, scene: root, renderer: null, camera, D, net, geo, field: null, mode: 'globe', root, ignite: ign };
  const arcs = createArcs(ctx), nodes = createNodes(ctx);
  ok('arcs: the layer says it fires ignitions', arcs.ignites === true);
  const a = net.air.a[3], b = net.air.b[3];
  const sim = { firstDay: new Float64Array(D.nodes.length).fill(-1) };
  sim.firstDay[a] = 0;
  const ev = [{ day: 1, from: a, to: b, kind: 'air', edge: 3, first: true, blocked: false }];
  let firedAt = -1, slot = -1, t = 0;
  const step = (events = []) => { t += 1 / 60; ign.now = t; ign.expire(); arcs.update({ t, dt: 1 / 60, sim, prev: null, events, mode: 'globe' }); nodes.update({ t, dt: 1 / 60, sim, prev: null, events, mode: 'globe' }); };
  step(ev);
  for (let s = 0; s < arcs.pool.size; s++) if (arcs.pool.live[s] && arcs.pool.kind[s] === KIND.first) slot = s;
  const dur = slot >= 0 ? arcs.pool.dur[slot] : 0;
  const firesAtTakeoff = ign.since(0).list.filter(f => f.node === b).length;
  for (let f = 0; f < 60 * 9 && firedAt < 0; f++) { step(); if (ign.since(0).list.some(x => x.node === b)) firedAt = t; }
  ok('arcs: a first flight flies, and nothing ignites at take-off', slot >= 0 && firesAtTakeoff === 0);
  ok('arcs: the destination ignites when the plane lands', firedAt > 0 && Math.abs(firedAt - dur) < 0.05, `landed at ${firedAt.toFixed(2)} s, flight ${dur.toFixed(2)} s`);
  ok('nodes: the landing starts a shockwave ring at the city', [...nodes.pool.node].includes(b));
  // a first event with no flight (same city) still ignites at once
  const c = (b + 17) % D.nodes.length, before = ign.since(0).cursor;
  step([{ day: 2, from: c, to: c, kind: 'air', edge: -1, first: true, blocked: false }]);
  ok('arcs: a first event with no flight ignites at once', ign.since(before).list.some(x => x.node === c && x.power === 1));
  arcs.dispose(); nodes.dispose();

  // ── the rings ──
  const r0 = ringState(0), rh = ringState(0, RING_DUR, 6, ARRIVAL_POWER);
  ok('rings: a white-hot flash at the start, a smaller one for a weak ignition', r0.flash === 1 && rh.flash < r0.flash && r0.flashPx > rh.flashPx);
  ok('rings: the shockwave reaches RING_PX (64 px) and ends by RING_DUR (<= 2 s)', ringState(RING_DUR * 0.999).px <= RING_PX && ringState(RING_DUR * 0.999).px > RING_PX * 0.95 && RING_DUR <= 2 && ringState(RING_DUR) === null);
  {
    const root2 = new THREE.Group();
    const np = createNodes({ ...ctx, root: root2, phone: true, ignite: createIgnition({ phone: true }) });
    ok('rings: a phone keeps a smaller ring pool', np.pool.n === RING_POOL_PHONE && RING_POOL_PHONE < RING_POOL);
    np.dispose();
  }

  // ── ticking counters ──
  let v = 0, mono = true, frames = 0;
  while (v < 1234567 && frames < 600) { const n = tickCounter(v, 1234567, 1 / 60); if (n < v || n > 1234567) mono = false; v = n; frames++; }
  ok('counters: tick up to the target without overshoot', mono && v === 1234567, `${frames} frames`);
  ok('counters: they reach the target in about 1-3 s', frames >= 30 && frames <= 200, `${(frames / 60).toFixed(2)} s`);
  ok('counters: a lower target (a new run) snaps', tickCounter(500, 3, 1 / 60) === 3 && tickCounter(5, 5, 1 / 60) === 5);
  let w = 0; for (let k = 0; k < 120; k++) w = tickCounter(w, 7, 1 / 60);
  ok('counters: small counts finish their last digits', w === 7);
}
