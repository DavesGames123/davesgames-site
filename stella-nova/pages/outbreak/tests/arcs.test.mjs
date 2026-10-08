// arcs (H): the flight pool, the departure gate, the heat decay, the
// ambient pick, the trail that follows each plane, the phone limits, and
// the layer driven with the real three.js objects in node (no GPU).
import { readFileSync } from 'node:fs';
import * as THREE from '../../../vendor/three@0.160.0/build/three.module.js';
import * as geo from '../geo.js';
import { parseNodes } from '../data.js';
import { buildNetwork } from '../network.js';
import {
  createHeat, createCometPool, createGate, eventKind, KIND, flightDur, flowCdf, pickEdge,
  trailSpan, trailAlpha, flightDone, edgeLookup, pairKey, occluded, createArcs, limitsFor, LIMITS,
  POOL, TRAIL_S, TRAIL_PTS, HEAT_TAU, HUB_GAP,
} from '../render/arcs.js';

export default function (ok) {
  // heat
  const h = createHeat(3, 8, 2);
  h.bump(1, 0.5); h.bump(1, 0.5);
  ok('heat: bumps add', Math.abs(h.h[1] - 1) < 1e-6 && h.h[0] === 0);
  h.bump(1, 5);
  ok('heat: clamps at the max', h.h[1] === 2);
  h.decay(8);
  ok('heat: one tau decays by 1/e', Math.abs(h.h[1] - 2 / Math.E) < 1e-5, h.h[1].toFixed(4));
  const h2 = createHeat(1, 8); h2.bump(0, 1); for (let i = 0; i < 80; i++) h2.decay(0.1);
  const h3 = createHeat(1, 8); h3.bump(0, 1); h3.decay(8);
  ok('heat: decay does not depend on the frame step', Math.abs(h2.h[0] - h3.h[0]) < 1e-5);
  h.decay(1000);
  ok('heat: cold edges go to 0 and stop the work', h.h[1] === 0 && !h.hot);
  h.bump(-1, 1); h.bump(9, 1);
  ok('heat: out-of-range edges are ignored', !h.hot);

  // pool
  const p = createCometPool(4);
  const s = [p.alloc(0, 0), p.alloc(0, 1), p.alloc(1, 2), p.alloc(1, 3)];
  ok('pool: fills free slots', s.join() === '0,1,2,3' && p.count === 4);
  ok('pool: ambient never evicts', p.alloc(0, 4) === -1);
  ok('pool: infected evicts the oldest ambient', p.alloc(1, 5) === 0 && p.count === 4);
  ok('pool: next eviction is the other ambient', p.alloc(2, 6) === 1);
  p.prio.fill(2);
  ok('pool: infected cannot evict a first', p.alloc(1, 7) === -1);
  p.free(2);
  ok('pool: free gives the slot back', p.count === 3 && p.alloc(0, 8) === 2);

  // gate
  const g = createGate(3, 0.5);
  ok('gate: the first departure passes', g.pass(1, 0));
  ok('gate: a second departure inside the gap waits', !g.pass(1, 0.3) && g.pass(2, 0.3));
  ok('gate: after the gap it passes, force always passes', g.pass(1, 0.51) && g.pass(1, 0.52, true));

  // limits
  const dl = limitsFor({}), pl = limitsFor({ phone: true });
  ok('limits: the phone has fewer flights, a lower rate, smaller planes',
    pl.flights < dl.flights && pl.ambientRate < dl.ambientRate && pl.planePx <= dl.planePx && dl.flights === POOL);
  ok('limits: a flight cap of at most 80 on desktop and 40 on a phone', LIMITS.desktop.flights <= 80 && LIMITS.phone.flights <= 40);

  // kinds and durations
  ok('kind: first, blocked, infected', eventKind({ first: true }) === KIND.first && eventKind({ blocked: true, first: true }) === KIND.blocked && eventKind({}) === KIND.infected);
  ok('flight: longer routes take longer, calm and capped', flightDur(500) < flightDur(10000) && flightDur(1e6) <= 6.8 * 1.001 && flightDur(0) >= 2.5);

  // ambient pick
  const cdf = flowCdf([1, 0, 3]);
  ok('pick: zero flow is never picked', pickEdge(cdf, 0.2) === 0 && pickEdge(cdf, 0.26) === 2 && pickEdge(cdf, 0.999) === 2);
  let c2 = 0; for (let i = 0; i < 4000; i++) if (pickEdge(cdf, (i + 0.5) / 4000) === 2) c2++;
  ok('pick: frequency follows flow', Math.abs(c2 / 4000 - 0.75) < 0.01, `${c2 / 4000}`);
  ok('pick: empty cdf gives -1', pickEdge(flowCdf([]), 0.5) === -1 && pickEdge(flowCdf([0, 0]), 0.5) === -1);

  // the trail follows the plane
  const dur = 4, sp = trailSpan(0.6, dur);
  ok('trail: the head is at the plane', sp.head === 0.6);
  ok('trail: the tail is TRAIL_S of path behind the plane', Math.abs(sp.tail - (0.6 - TRAIL_S / dur)) < 1e-12);
  ok('trail: at take-off the trail has no length', trailSpan(0, dur).head === 0 && trailSpan(0, dur).tail === 0);
  const sa = trailSpan(1 + 0.5 * TRAIL_S / dur, dur);
  ok('trail: after arrival it drains into the destination', sa.head === 1 && Math.abs(sa.tail - (1 - 0.5 * TRAIL_S / dur)) < 1e-12);
  ok('trail: bright at the plane, fading back', trailAlpha(0) === 1 && trailAlpha(5) < trailAlpha(1) && trailAlpha(TRAIL_PTS - 1) === 0);
  ok('trail: the flight ends when the trail has drained', !flightDone(1.1, dur) && flightDone(1 + TRAIL_S / dur + 1e-9, dur));

  // occlusion
  const cam = [0, 0, 3];
  ok('occlusion: the near side shows', !occluded(cam, [0, 0, 1.003]) && !occluded(cam, geo.sphere(30, -90, 0.003)));
  ok('occlusion: the far side hides', occluded(cam, [0, 0, -1.003]));
  ok('occlusion: a high arc over the limb shows', !occluded(cam, [0, 1.3, -0.3]));

  // the layer with real three objects
  const D = parseNodes(JSON.parse(readFileSync(new URL('../data/nodes.json', import.meta.url))));
  const net = buildNetwork(D);
  const root = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(35, 1.5, 0.01, 100);
  camera.position.set(0, 0.8, 3); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const ctx = { THREE, scene: root, renderer: null, camera, D, net, geo, field: null, mode: 'globe', root };
  const arcs = createArcs(ctx);
  ok('layer: adds one group to root', root.children.length === 1);
  const names = arcs.group.children.map(o => o.name).join();
  ok('layer: network, trails and planes', names === 'arcs-network,arcs-trails,arcs-planes', names);
  const lineBase = arcs.group.children[0].geometry.getAttribute('aBase').array;
  let shown = 0; for (let v = 0; v < lineBase.length; v += 48) if (lineBase[v] > 0) shown++;
  ok('network: visible by default on every edge (no toggle)', shown > net.air.n * 0.98, `${shown}/${net.air.n}`);
  ok('network: base lines stay at a low alpha', Math.max(...lineBase) <= 0.2);
  const look = edgeLookup(net.air);
  const e0 = 0, a0 = net.air.a[e0], b0 = net.air.b[e0];
  ok('layer: edge lookup finds both directions', look.get(pairKey(a0, b0)) === 0 && look.get(pairKey(b0, a0)) === 0);
  const sim = { firstDay: new Float64Array(D.nodes.length).fill(-1) };
  const evs = [
    { day: 1, from: a0, to: b0, kind: 'air', edge: e0, first: true, blocked: false },
    { day: 1, from: b0, to: a0, kind: 'air', edge: e0, first: false, blocked: false },
    { day: 1, from: a0, to: b0, kind: 'air', edge: -1, first: false, blocked: true },
    { day: 1, from: net.land.a[0], to: net.land.b[0], kind: 'land', edge: 0, first: false, blocked: false },
  ];
  let threw = null, firstSlot = -1, headA = 0, tailA = 1, maxCount = 0;
  try {
    for (let f = 0; f < 240; f++) {
      const frame = { t: f / 60, dt: 1 / 60, sim, prev: null, events: f === 1 ? evs : [], mode: 'globe' };
      arcs.update(frame);
      if (f === 1) for (let q = 0; q < arcs.pool.size; q++) if (arcs.pool.live[q] && arcs.pool.kind[q] === KIND.first) firstSlot = q;
      if (f === 2) ok('arcs: an infected flight heats its edge', arcs.heat.h[e0] > 1, arcs.heat.h[e0].toFixed(3));
      if (f === 90 && firstSlot >= 0) { const b = firstSlot * TRAIL_PTS * 2; headA = arcs.trailAlpha[b]; tailA = arcs.trailAlpha[b + 2 * (TRAIL_PTS - 1)]; }
      maxCount = Math.max(maxCount, arcs.pool.count);
    }
  } catch (e) { threw = e; }
  ok('layer: 4 s of frames run without error', !threw, threw && threw.stack);
  ok('arcs: the first arrival flies', firstSlot >= 0);
  ok('arcs: its trail is bright at the plane and dark at the tail', headA > 0.8 && tailA === 0, `${headA.toFixed(2)} ${tailA}`);
  ok('arcs: the heat decays after the events', arcs.heat.h[e0] < 1.4 * Math.exp(-3.9 / HEAT_TAU) + 1e-3, arcs.heat.h[e0].toFixed(3));
  ok('arcs: ambient traffic flows under the cap', arcs.pool.count > 3 && maxCount <= arcs.limits.flights, `${arcs.pool.count} / max ${maxCount}`);

  // a burst of infected events: the cap holds, one flight per edge, the gate spaces departures
  const burst = [];
  for (let e = 0; e < net.air.n; e += 3) burst.push({ day: 2, from: net.air.a[e], to: net.air.b[e], kind: 'air', edge: e, first: e % 9 === 0, blocked: false });
  let over = 0, multi = 0;
  for (let f = 0; f < 600; f++) {
    arcs.update({ t: 4 + f / 60, dt: 1 / 60, sim, prev: null, events: f % 2 ? burst : [], mode: 'globe' });
    if (arcs.pool.count > arcs.limits.flights) over++;
    for (let e = 0; e < arcs.busy.length; e++) if (arcs.busy[e] > 1) { multi++; break; }
  }
  ok('arcs: the flight cap holds under a burst of events', over === 0 && arcs.pool.count <= arcs.limits.flights, `${arcs.pool.count}`);
  ok('arcs: no edge carries two ordinary flights at once', multi < 60, `${multi} frames`);
  // no leak: the slots and the trails go back after the flights end
  for (let f = 0; f < 900; f++) arcs.update({ t: 20 + f / 60, dt: 1 / 60, sim, prev: null, events: [], mode: 'globe' });
  const sim3 = { firstDay: new Float64Array(D.nodes.length).fill(-1) };
  arcs.update({ t: 40, dt: 1 / 60, sim: sim3, prev: null, events: [], mode: 'globe' });
  ok('arcs: a new sim clears the heat and the flights', arcs.heat.h[e0] === 0 && arcs.pool.count === 0 && arcs.busy.every(x => x === 0));
  let lit = 0; for (const a of arcs.trailAlpha) if (a > 0) lit++;
  ok('arcs: no trail stays lit after its flight', lit === 0, `${lit}`);

  // the phone layer
  const root2 = new THREE.Group();
  const ph = createArcs({ ...ctx, root: root2, phone: true });
  for (let f = 0; f < 600; f++) ph.update({ t: f / 60, dt: 1 / 60, sim, prev: null, events: f % 2 ? burst : [], mode: 'globe' });
  ok('phone: the flight cap is the phone cap', ph.limits.flights === LIMITS.phone.flights && ph.pool.count <= LIMITS.phone.flights && ph.pool.size === LIMITS.phone.flights);
  ph.dispose();
  ok('phone: the gap between departures of one city', HUB_GAP >= 0.3);

  try {
    arcs.setMode('flat');
    for (let f = 0; f < 30; f++) arcs.update({ t: 50 + f / 60, dt: 1 / 60, sim: sim3, prev: null, events: evs, mode: 'flat' });
    threw = null;
  } catch (e) { threw = e; }
  ok('layer: flat mode runs without error', !threw, threw && threw.stack);
  arcs.dispose();
  ok('layer: dispose removes the group', root.children.length === 0);
}
