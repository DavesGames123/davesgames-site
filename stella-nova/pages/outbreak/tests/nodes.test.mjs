// nodes (H): the city markers and the first-infection rings, with the
// real three.js objects in node (no GPU).
import { readFileSync } from 'node:fs';
import * as THREE from '../../../vendor/three@0.160.0/build/three.module.js';
import * as geo from '../geo.js';
import { parseNodes } from '../data.js';
import { buildNetwork } from '../network.js';
import { glowLevel, nodeSize, approach, ringState, createRingPool, createNodes, RING_DUR } from '../render/nodes.js';

export default function (ok) {
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

  const D = parseNodes(JSON.parse(readFileSync(new URL('../data/nodes.json', import.meta.url))));
  const net = buildNetwork(D);
  const root = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(35, 1.5, 0.01, 100);
  camera.position.set(0, 0.8, 3); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const ctx = { THREE, scene: root, renderer: null, camera, D, net, geo, field: null, mode: 'globe', root };
  const nodes = createNodes(ctx);
  ok('layer: adds a group to root', root.children.length === 1);
  const a0 = net.air.a[0], b0 = net.air.b[0];
  const sim = { firstDay: new Float64Array(D.nodes.length).fill(-1) };
  sim.firstDay[a0] = 0;
  const prev = new Float32Array(D.nodes.length); prev[a0] = 0.01;
  const evs = [{ day: 1, from: a0, to: b0, kind: 'air', edge: 0, first: true, blocked: false }];
  let threw = null;
  try {
    for (let f = 0; f < 240; f++) {
      nodes.update({ t: f / 60, dt: 1 / 60, sim, prev, events: f === 1 ? evs : [], mode: 'globe' });
      if (f === 2) ok('nodes: a first event and the seed start ring bursts', nodes.pool.live >= 2);
    }
  } catch (e) { threw = e; }
  ok('layer: 4 s of frames run without error', !threw, threw && threw.stack);
  ok('nodes: the glow approaches the prevalence', nodes.glow[a0] > 0.6 && nodes.glow[b0] === 0, nodes.glow[a0].toFixed(3));
  try { nodes.setMode('flat'); for (let f = 0; f < 30; f++) nodes.update({ t: 6 + f / 60, dt: 1 / 60, sim, prev, events: evs, mode: 'flat' }); threw = null; } catch (e) { threw = e; }
  ok('layer: flat mode runs without error', !threw, threw && threw.stack);
  nodes.dispose();
  ok('layer: dispose removes the group', root.children.length === 0);
}
