// ============================================================================
//  PLANT GROWTH  ·  roots by diffusion-limited aggregation (DOM-free)
// ----------------------------------------------------------------------------
//  The roots grow with lib/dla-engine.js, our port of fogleman/dlaf
//  (Michael Fogleman, MIT, https://github.com/fogleman/dlaf). DLA gives
//  the shape of roots and dendrites: walkers wander through the soil and
//  join the structure where they first touch it, so the tips that reach
//  out catch the most walkers and grow fastest.
//
//  The page uses three of the five dlaf hooks:
//    randomStartingPosition  a walker starts in the soil: on the lower cap
//                            of a sphere round the structure, below ground
//    motionVector            a random step plus a bias. The bias points up,
//                            toward the root crown, so walkers come from
//                            below and join at the deep tips: the roots
//                            grow down. (Nutrients and water move toward
//                            the root that takes them in.)
//    shouldReset             a walker that leaves the soil starts again
//  placeParticle keeps each new particle under the ground plane.
//
//  Engine units: particleSpacing 1. world() scales them to metres.
//
//  USE
//    const r = createRoots({ seed: 3, scale: 0.12 });
//    r.growFor(4);   r.count;   r.world(i, out)
//    r.radius, r.order, r.flow, r.born (set with r.stamp(clock))
//
//  grep -n targets
//    the hooks ............. "const hooks"
//    pipe radius ........... "function pipe"
// ============================================================================
import { createModel, randomInUnitSphere } from '../../lib/dla-engine.js';

// opts: seed, scale (metres per engine unit), bias (0..1, the pull up to
// the crown), max (particle cap), r0 (tip radius in metres), rTop (the
// radius at the root crown, the trunk base), lean ([x, z] in 0..1: a
// share of walkers that start on the side the camera looks at).
export function createRoots(opts = {}) {
  const scale = opts.scale ?? 0.12, bias = opts.bias ?? 0.3, max = opts.max ?? 2500;
  const deep = opts.deep ?? 0.6, r0 = opts.r0 ?? 0.008, rTop = opts.rTop ?? 0.15, lean = opts.lean ?? null;
  const hooks = {
    randomStartingPosition(m, out) {
      randomInUnitSphere(m.random, 3, out);
      if (lean && m.random() < 0.35) { out[0] = Math.abs(out[0]) * Math.sign(lean[0] || 1); out[2] = Math.abs(out[2]) * Math.sign(lean[1] || 1); }
      out[1] = -Math.abs(out[1]) - deep;   // the lower cap of the sphere
      const l = Math.hypot(out[0], out[1], out[2]) || 1, R = m.boundingRadius + 2;
      out[0] *= R / l; out[1] = out[1] * R / l - 0.5; out[2] *= R / l;
      return out;
    },
    motionVector(m, p, out) {
      randomInUnitSphere(m.random, 3, out);
      const l = Math.hypot(out[0], out[1], out[2]) || 1;
      out[0] /= l; out[1] = out[1] / l + bias; out[2] /= l;
      return out;
    },
    shouldReset(m, p) {
      return p[1] > 1 || Math.hypot(p[0], p[1], p[2]) > m.boundingRadius * 2 + 4;
    },
    placeParticle(m, p, parent, out) {
      m.lerpFrom(parent, p, m.params.particleSpacing, out);
      if (out[1] > -0.25) out[1] = -0.25;
      return out;
    },
  };
  const m = createModel({
    dim: 3, seed: opts.seed ?? 1, hooks, maxSteps: 20000,
    params: { particleSpacing: 1, attractionDistance: 2.2, minMoveDistance: 1, stubbornness: 0, stickiness: opts.stickiness ?? 0.8 },
  });
  m.add([0, 0, 0]);

  let cap = 0, born = new Float32Array(0), radius = new Float32Array(0), order = new Uint8Array(0), kids = new Uint8Array(0), flow = new Float32Array(0);
  let stamped = 0, sizes = null, maxOrder = 0, maxDepthY = 0;
  function ensure() {
    if (m.count <= cap) return;
    cap = Math.max(1024, cap * 2, m.count);
    const g = (a, T) => { const b = new T(cap); b.set(a); return b; };
    born = g(born, Float32Array); radius = g(radius, Float32Array); order = g(order, Uint8Array); kids = g(kids, Uint8Array); flow = g(flow, Float32Array);
  }
  // Mark the particles that joined since the last call with the clock.
  function stamp(clock) {
    ensure();
    for (let i = stamped; i < m.count; i++) {
      born[i] = clock;
      const p = m.parent[i];
      order[i] = p < 0 ? 0 : Math.min(250, order[p] + (kids[p] > 0 ? 1 : 0));
      if (order[i] > maxOrder) maxOrder = order[i];
      if (p >= 0) kids[p]++;
      const y = -m.pos[i * 3 + 1] * scale; if (y > maxDepthY) maxDepthY = y;
    }
    stamped = m.count;
    pipe();
  }
  // The pipe rule on subtree sizes: r = r0 * size^(1/2.5), capped by rTop.
  function pipe() {
    sizes = m.subtreeSizes(sizes);
    const top = sizes[0] || 1, k = Math.min(1, rTop / (r0 * Math.pow(top, 0.4)));
    for (let i = 0; i < m.count; i++) {
      radius[i] = r0 * Math.pow(sizes[i], 0.4) * Math.max(k, 0.35);
      flow[i] = sizes[i];
    }
  }
  return {
    model: m, scale,
    get count() { return m.count; },
    get born() { return born; }, get radius() { return radius; }, get order() { return order; },
    get flow() { return flow; }, get maxOrder() { return maxOrder; }, get maxFlow() { return sizes ? sizes[0] : 1; },
    get depth() { return maxDepthY; },
    grow(n) { const k = Math.min(n, max - m.count); if (k > 0) m.grow(k); return Math.max(0, k); },
    growFor(ms) { return m.count >= max ? 0 : m.growFor(ms, max - m.count); },
    stamp,
    // Particle i in metres (y up, ground at 0).
    world(i, out = [0, 0, 0]) { out[0] = m.pos[i * 3] * scale; out[1] = m.pos[i * 3 + 1] * scale; out[2] = m.pos[i * 3 + 2] * scale; return out; },
    get max() { return max; },
  };
}
