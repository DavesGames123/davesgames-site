// nodes (H): the city markers and the first-infection rings, with the
// real three.js objects in node (no GPU).
import { readFileSync } from 'node:fs';
import * as THREE from '../../../vendor/three@0.160.0/build/three.module.js';
import * as geo from '../geo.js';
import { parseNodes } from '../data.js';
import { buildNetwork } from '../network.js';
import { glowLevel, markerPx, approach, ringState, createRingPool, createNodes, RING_DUR, RING_PX, MARK_HOT, RING_POOL } from '../render/nodes.js';

export default function (ok) {
  ok('glow: 0 at and below 1e-7, 1 at 10 %', glowLevel(0) === 0 && glowLevel(1e-7) === 0 && glowLevel(0.1) === 1 && glowLevel(0.5) === 1);
  ok('glow: monotone on the log scale', glowLevel(1e-5) < glowLevel(1e-3) && Math.abs(glowLevel(1e-4) - 0.5) < 1e-9);
  const lv = [0, 0.05, 0.2, 0.4, 0.6, 0.8, 1];
  let mono = true;
  for (const cp of [1e4, 1e6, 3e7]) for (let k = 1; k < lv.length; k++) if (!(markerPx(lv[k], cp) > markerPx(lv[k - 1], cp))) mono = false;
  ok('marker: size in px grows with prevalence for every city size', mono);
  ok('marker: an idle city is a 1.8-3 px dot, larger cities larger', markerPx(0, 1e5) >= 1.8 && markerPx(0, 1e9) <= 3 && markerPx(0, 1e5) < markerPx(0, 2e7));
  ok('marker: an infected city is at least 3.5 px and at most 12 px', markerPx(1e-6, 1) >= 3.5 && markerPx(1, 1e9) === MARK_HOT[1]);
  ok('marker: the size is in CSS px, not world units', markerPx(0.5) > 1 && markerPx(0.5) < 20);
  let g = 0; for (let i = 0; i < 60; i++) g = approach(g, 1, 1 / 60);
  ok('approach: smooth, no overshoot', g > 0.9 && g < 1 && approach(0, 1, 0) === 0);
  const r0 = ringState(0), r1 = ringState(RING_DUR * 0.5);
  ok('ring: one thin ring grows and fades, ends at RING_DUR', r0.alpha === 1 && r1.px > r0.px && r1.alpha < 1 && ringState(RING_DUR) === null);
  ok('ring: at most RING_PX px wide and short', ringState(RING_DUR * 0.999).px <= RING_PX && RING_DUR <= 2);
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
  ok('nodes: the level approaches the prevalence', nodes.glow[a0] > 0.6 && nodes.glow[b0] === 0, nodes.glow[a0].toFixed(3));
  ok('nodes: the infected marker is larger in px', nodes.px[a0] > nodes.px[b0] && nodes.px[a0] <= MARK_HOT[1]);
  ok('nodes: rings expire (no leak)', nodes.pool.live === 0 && nodes.pool.n === RING_POOL);
  ok('nodes: markers and rings are point sprites', nodes.group.children.map(o => o.name).join() === 'nodes-markers,nodes-rings');
  try { nodes.setMode('flat'); for (let f = 0; f < 30; f++) nodes.update({ t: 6 + f / 60, dt: 1 / 60, sim, prev, events: evs, mode: 'flat' }); threw = null; } catch (e) { threw = e; }
  ok('layer: flat mode runs without error', !threw, threw && threw.stack);
  nodes.dispose();
  ok('layer: dispose removes the group', root.children.length === 0);
}
