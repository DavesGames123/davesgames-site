// arcs (H): the comet pool, the heat decay, the ambient pick, the trail,
// the occlusion test, the city glow helpers, and both layers driven with
// the real three.js objects in node (no renderer, no GPU).
import { readFileSync } from 'node:fs';
import * as THREE from '../../../vendor/three@0.160.0/build/three.module.js';
import * as geo from '../geo.js';
import { parseNodes } from '../data.js';
import { buildNetwork } from '../network.js';
import {
  createHeat, createCometPool, eventKind, KIND, flightDur, flowCdf, pickEdge, trailPoint, cometDone,
  edgeLookup, pairKey, occluded, createArcs, POOL, TRAIL, HEAT_TAU,
} from '../render/arcs.js';
import { glowLevel, nodeSize, approach, ringState, createRingPool, createNodes, RING_DUR } from '../render/nodes.js';

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
  const big = createCometPool(POOL);
  for (let i = 0; i < POOL + 50; i++) big.alloc(1, i);
  ok('pool: fixed size under a storm', big.count === POOL && big.live.length === POOL);

  // kinds and durations
  ok('kind: first, blocked, infected', eventKind({ first: true }) === KIND.first && eventKind({ blocked: true, first: true }) === KIND.blocked && eventKind({}) === KIND.infected);
  ok('flight: longer routes take longer, capped', flightDur(500) < flightDur(10000) && flightDur(1e6) <= 4.2 * 1.001 && flightDur(0) >= 1.4);

  // ambient pick
  const cdf = flowCdf([1, 0, 3]);
  ok('pick: zero flow is never picked', pickEdge(cdf, 0.2) === 0 && pickEdge(cdf, 0.26) === 2 && pickEdge(cdf, 0.999) === 2);
  let c2 = 0; for (let i = 0; i < 4000; i++) if (pickEdge(cdf, (i + 0.5) / 4000) === 2) c2++;
  ok('pick: frequency follows flow', Math.abs(c2 / 4000 - 0.75) < 0.01, `${c2 / 4000}`);
  ok('pick: empty cdf gives -1', pickEdge(flowCdf([]), 0.5) === -1 && pickEdge(flowCdf([0, 0]), 0.5) === -1);

  // trail
  ok('trail: head at t, fades along the trail', trailPoint(0.5, 0).tk === 0.5 && trailPoint(0.5, 3).a < trailPoint(0.5, 1).a);
  ok('trail: points before the start are hidden', trailPoint(0.01, 5) === null);
  ok('trail: after arrival the head stays at 1', trailPoint(1.1, 0).tk === 1);
  ok('trail: done when the tail reaches 1', !cometDone(1.1) && cometDone(1 + (TRAIL - 1) * 0.028 + 1e-9));

  // occlusion
  const cam = [0, 0, 3];
  ok('occlusion: the near side shows', !occluded(cam, [0, 0, 1.003]) && !occluded(cam, geo.sphere(30, -90, 0.003)));
  ok('occlusion: the far side hides', occluded(cam, [0, 0, -1.003]));
  ok('occlusion: a high arc over the limb shows', !occluded(cam, [0, 1.3, -0.3]));

  // nodes helpers
  ok('glow: 0 at and below 1e-7, 1 at 10 %', glowLevel(0) === 0 && glowLevel(1e-7) === 0 && glowLevel(0.1) === 1 && glowLevel(0.5) === 1);
  ok('glow: monotone on the log scale', glowLevel(1e-5) < glowLevel(1e-3) && Math.abs(glowLevel(1e-4) - 0.5) < 1e-9);
  ok('size: big cities are larger, bounded', nodeSize(1e5) < nodeSize(2e7) && nodeSize(1e9) <= 0.017 + 1e-12 && nodeSize(0) >= 0.006);
  let g = 0; for (let i = 0; i < 60; i++) g = approach(g, 1, 1 / 60);
  ok('approach: smooth, no overshoot', g > 0.9 && g < 1 && approach(0, 1, 0) === 0);
  const r0 = ringState(0), r1 = ringState(RING_DUR * 0.5);
  ok('ring: grows and fades, ends at RING_DUR', r0.alpha === 1 && r1.scale > r0.scale && r1.alpha < 1 && ringState(RING_DUR) === null);
  const rp = createRingPool(3);
  rp.start(5, 0); rp.start(6, 1); rp.start(7, 2);
  ok('ring pool: full pool reuses the oldest', rp.start(8, 3) === 0 && rp.node[0] === 8);
  rp.expire(10);
  ok('ring pool: expire frees old rings', rp.live === 0);

  // layers with real three objects
  const D = parseNodes(JSON.parse(readFileSync(new URL('../data/nodes.json', import.meta.url))));
  const net = buildNetwork(D);
  const root = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(35, 1.5, 0.01, 100);
  camera.position.set(0, 0.8, 3); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const ctx = { THREE, scene: root, renderer: null, camera, D, net, geo, field: null, mode: 'globe', root };
  const arcs = createArcs(ctx), nodes = createNodes(ctx);
  ok('layer: both add a group to root', root.children.length === 2);
  const look = edgeLookup(net.air);
  const e0 = 0, a0 = net.air.a[e0], b0 = net.air.b[e0];
  ok('layer: edge lookup finds both directions', look.get(pairKey(a0, b0)) === 0 && look.get(pairKey(b0, a0)) === 0);
  const sim = { firstDay: new Float64Array(D.nodes.length).fill(-1) };
  sim.firstDay[a0] = 0;
  const prev = new Float32Array(D.nodes.length); prev[a0] = 0.01;
  const evs = [
    { day: 1, from: a0, to: b0, kind: 'air', edge: e0, first: true, blocked: false },
    { day: 1, from: b0, to: a0, kind: 'air', edge: e0, first: false, blocked: false },
    { day: 1, from: a0, to: b0, kind: 'air', edge: -1, first: false, blocked: true },
    { day: 1, from: net.land.a[0], to: net.land.b[0], kind: 'land', edge: 0, first: false, blocked: false },
  ];
  let threw = null;
  try {
    for (let f = 0; f < 240; f++) {
      const frame = { t: f / 60, dt: 1 / 60, sim, prev, events: f === 1 ? evs : [], mode: 'globe' };
      arcs.update(frame); nodes.update(frame);
      if (f === 2) {
        ok('arcs: an infected flight heats its edge', arcs.heat.h[e0] > 1, arcs.heat.h[e0].toFixed(3));
        ok('arcs: events and ambient fill the pool', arcs.pool.count >= 4);
        ok('nodes: a first event and the seed start ring bursts', nodes.pool.live >= 2);
      }
    }
  } catch (e) { threw = e; }
  ok('layer: 4 s of frames run without error', !threw, threw && threw.stack);
  ok('arcs: heat decays after the events', arcs.heat.h[e0] < 1.2 * Math.exp(-3.9 / HEAT_TAU) + 1e-3, arcs.heat.h[e0].toFixed(3));
  ok('arcs: ambient traffic keeps flowing', arcs.pool.count > 5 && arcs.pool.count <= POOL, `${arcs.pool.count}`);
  ok('nodes: the glow approaches the prevalence', nodes.glow[a0] > 0.6 && nodes.glow[b0] === 0, nodes.glow[a0].toFixed(3));
  const sim2 = { firstDay: new Float64Array(D.nodes.length).fill(-1) };
  arcs.update({ t: 5, dt: 1 / 60, sim: sim2, prev: null, events: [], mode: 'globe' });
  ok('arcs: a new sim clears the heat', arcs.heat.h[e0] === 0);
  try {
    arcs.setMode('flat'); nodes.setMode('flat');
    for (let f = 0; f < 30; f++) { const fr = { t: 6 + f / 60, dt: 1 / 60, sim: sim2, prev, events: evs, mode: 'flat' }; arcs.update(fr); nodes.update(fr); }
    threw = null;
  } catch (e) { threw = e; }
  ok('layer: flat mode runs without error', !threw, threw && threw.stack);
  arcs.dispose(); nodes.dispose();
  ok('layer: dispose removes the groups', root.children.length === 0);
}
