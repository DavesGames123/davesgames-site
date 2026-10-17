// ============================================================================
//  PLANT GROWTH  ·  pose and colour of the branch tree each frame (DOM-free)
// ----------------------------------------------------------------------------
//  The model (grow.js, roots.js) gives node positions, parents, pipe radii
//  and birth times. Each frame, fill() writes two RGBA float rows per node
//  for the GPU (render.js reads them as textures):
//    pos row   x, y, z of the shown node, the shown radius
//    col row   t (the gradient value), light, parent id, growth 0..1
//  The shown node is not the model node:
//    - a new segment grows from its parent over growDur clock units, so a
//      branch extends smoothly and does not pop in;
//    - the shown radius eases toward the pipe radius, so the trunk swells;
//    - wind bends each segment by an angle that grows as the radius falls
//      (flex = (rTip / r)^0.8), and the bend adds up from the root, so a
//      thin tip moves with its branch and more.
//  The parent comes first in the arrays (ids grow with time), so one pass
//  from 0 to n is enough.
//
//  grep -n targets
//    colour modes ........ "export const COLOUR_MODES"
//    one colour value .... "export function colourT"
//    adapters ............ "export function plantView"
//    the frame pass ...... "export function createPoser"
// ============================================================================

export const COLOUR_MODES = [
  { id: 'natural', label: 'Natural', short: 'Natural', text: 'Bark, leaf and flower colours. Shaded leaves are darker.' },
  { id: 'age', label: 'Age', short: 'Age', text: 'The order of growth. The newest nodes are at the hot end of the gradient, so the growing tips glow.' },
  { id: 'order', label: 'Branch order', short: 'Order', text: 'The trunk is order 0. Each side branch is one order more than the branch it grows from.' },
  { id: 'flow', label: 'Flow', short: 'Flow', text: 'The pipe model: the number of tips a branch supports, on a log scale. The trunk carries all of them.' },
  { id: 'height', label: 'Height', short: 'Height', text: 'Height above the deepest root, up to the top of the crown.' },
  { id: 'light', label: 'Light', short: 'Light', text: 'A shade estimate: a node with many nodes above it gets less light. Roots get none.' },
];
export const COLOUR_IDS = COLOUR_MODES.map(m => m.id);

// A common view of a plant or of the roots: plain arrays and a scale.
export function plantView(p) {
  return {
    kind: 'plant', get count() { return p.count; }, get pos() { return p.pos; }, scale: 1,
    get parent() { return p.parent; }, get radius() { return p.radius; }, get born() { return p.born; },
    get order() { return p.order; }, get maxOrder() { return p.maxOrder; },
    get flow() { return p.tips; }, get maxFlow() { return p.maxTips; }, get light() { return p.light; },
    rTip: p.r0, growDur: 1,
  };
}
export function rootsView(r) {
  return {
    kind: 'roots', get count() { return Math.min(r.count, r.born.length); }, get pos() { return r.model.pos; }, scale: r.scale,
    get parent() { return r.model.parent; }, get radius() { return r.radius; }, get born() { return r.born; },
    get order() { return r.order; }, get maxOrder() { return r.maxOrder; },
    get flow() { return r.flow; }, get maxFlow() { return r.maxFlow; }, light: null,
    rTip: 0.008, growDur: 1.5,
  };
}

// The gradient value of node i in 0..1. clock: the growth clock (steps).
// range: { yMin, yMax } in metres, shared by the plant and the roots.
export function colourT(v, i, mode, clock, range) {
  let t = 0;
  switch (mode) {
    case 'age': t = clock > 0 ? v.born[i] / clock : 1; break;
    case 'order': t = v.maxOrder > 0 ? v.order[i] / v.maxOrder : 0; break;
    case 'flow': t = Math.log(1 + v.flow[i]) / Math.log(1 + Math.max(1, v.maxFlow)); break;
    case 'height': {
      const y = v.pos[i * 3 + 1] * v.scale, a = range ? range.yMin : 0, b = range ? range.yMax : 1;
      t = b > a ? (y - a) / (b - a) : 0; break;
    }
    case 'light': t = v.light ? v.light[i] : 0; break;
    default: t = 0;
  }
  return t < 0 ? 0 : t > 1 ? 1 : (t === t ? t : 0);
}

const smooth = g => g * g * (3 - 2 * g);

export function createPoser() {
  let cap = 0, rShown = new Float32Array(0);
  const WD = [0.93, 0, 0.37];            // wind direction (unit, in xz)
  const WP = [-WD[2], 0, WD[0]];         // across the wind
  return {
    reset() { rShown.fill(0); },
    // o: { clock, time (s), dt (s), wind 0..1, mode, range }. outPos and
    // outCol are Float32Arrays of 4 floats per node.
    fill(v, o, outPos, outCol) {
      const n = v.count, P = v.pos, s = v.scale, par = v.parent, R = v.radius, born = v.born;
      if (n > cap) { const a = new Float32Array(Math.max(n, cap * 2, 256)); a.set(rShown); rShown = a; cap = a.length; }
      const ease = Math.min(1, (o.dt || 0) * 2.5), wind = o.wind || 0, tm = o.time || 0;
      for (let i = 0; i < n; i++) {
        const p = par[i], k = i * 4;
        const g0 = (o.clock - born[i]) / v.growDur, g = g0 <= 0 ? 0 : g0 >= 1 ? 1 : g0;
        const r = R[i];
        rShown[i] = rShown[i] > 0 ? rShown[i] + (r - rShown[i]) * ease : r;
        const x = P[i * 3] * s, y = P[i * 3 + 1] * s, z = P[i * 3 + 2] * s;
        if (p < 0) {
          outPos[k] = x; outPos[k + 1] = y; outPos[k + 2] = z;
        } else {
          const sx = (x - P[p * 3] * s), sy = (y - P[p * 3 + 1] * s), sz = (z - P[p * 3 + 2] * s);
          const e = smooth(g);
          let bx = 0, by = 0, bz = 0;
          if (wind > 0 && y > 0) {
            const L = Math.sqrt(sx * sx + sy * sy + sz * sz);
            const f = Math.pow(Math.min(1, v.rTip / Math.max(1e-4, rShown[i])), 0.8);
            const ph = 0.35 * (x + z) + 0.15 * y;
            const a = wind * 0.06 * f * L * (0.55 + Math.sin(tm * 1.7 + ph));
            const c = wind * 0.025 * f * L * Math.sin(tm * 2.9 + ph * 1.3);
            bx = WD[0] * a + WP[0] * c; bz = WD[2] * a + WP[2] * c; by = -Math.abs(a) * 0.3;
          }
          outPos[k] = outPos[p * 4] + sx * e + bx;
          outPos[k + 1] = outPos[p * 4 + 1] + sy * e + by;
          outPos[k + 2] = outPos[p * 4 + 2] + sz * e + bz;
        }
        outPos[k + 3] = g > 0 ? rShown[i] : 0;
        outCol[k] = colourT(v, i, o.mode, o.clock, o.range);
        outCol[k + 1] = v.light ? v.light[i] : 0;
        outCol[k + 2] = p < 0 ? i : p;
        outCol[k + 3] = g;
      }
      return n;
    },
  };
}
