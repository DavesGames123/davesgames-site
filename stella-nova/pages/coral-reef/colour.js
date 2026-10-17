// ============================================================================
//  CORAL REEF  ·  colour by (DOM-free)
// ----------------------------------------------------------------------------
//  Each "Colour by" mode maps one value of each polyp to t in 0..1. The
//  page writes t into an instance attribute and reads the colour from a
//  gradient row texture (lib/growth-gradients.js lut). So a gradient change
//  only writes the texture row, and a mode change only writes t. No regrow.
//
//    natural ... the colours of the species (naturalRGB), lighter at tips
//    age ....... the order of joining: the newest polyps at the hot end
//    depth ..... hops from the seed, per colony
//    height .... height above the sand, over the whole reef
//    flow ...... log of the subtree size, per colony (the nutrient flow
//                that passes through a polyp to the polyps it feeds)
//    light ..... an estimate of light and nutrient exposure: high polyps
//                with few neighbours get more
//    colony .... one colour per colony
//
//  grep -n targets
//    the mode table ......... "export const MODES"
//    derived fields ......... "export function fieldsOf"
//    t of each polyp ........ "export function colourT"
//    neighbour count ........ "function crowding"
//    natural colours ........ "export function naturalRGB"
//    radius of each polyp ... "export function radiiOf"
//    thumbnail data ......... "export function polypData"
// ============================================================================
import { SPECIES, sandY, polypRadius } from './reef.js';
import { sample } from '../../lib/growth-gradients.js';

export const MODES = [
  { id: 'natural', label: 'Natural' },
  { id: 'age', label: 'Age' },
  { id: 'depth', label: 'Depth' },
  { id: 'height', label: 'Height' },
  { id: 'flow', label: 'Flow' },
  { id: 'light', label: 'Light' },
  { id: 'colony', label: 'Colony' },
];
export const MODE_IDS = MODES.map(m => m.id);

// Subtree size and depth of each polyp, in global order.
export function fieldsOf(reef) {
  const n = reef.count, sub = new Float32Array(n), dep = new Float32Array(n);
  const maxSub = new Float32Array(reef.colonies.length), maxDep = new Float32Array(reef.colonies.length);
  for (const c of reef.colonies) {
    const s = c.model.subtreeSizes(), d = c.model.depth;
    for (let i = 0; i < c.count; i++) {
      const g = c.ids[i]; sub[g] = s[i]; dep[g] = d[i];
      if (s[i] > maxSub[c.k]) maxSub[c.k] = s[i];
      if (d[i] > maxDep[c.k]) maxDep[c.k] = d[i];
    }
  }
  return { sub, dep, maxSub, maxDep };
}

// Neighbours of each polyp in a radius of 1.8, from a hash grid.
function crowding(reef) {
  const n = reef.count, C = 1.8, cnt = new Uint16Array(n), grid = new Map();
  const key = (x, y, z) => (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(reef.px[i] / C), Math.floor(reef.py[i] / C), Math.floor(reef.pz[i] / C));
    const a = grid.get(k); if (a) a.push(i); else grid.set(k, [i]);
  }
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(reef.px[i] / C), cy = Math.floor(reef.py[i] / C), cz = Math.floor(reef.pz[i] / C);
    let c = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const a = grid.get(key(cx + dx, cy + dy, cz + dz)); if (!a) continue;
      for (const j of a) {
        const ex = reef.px[j] - reef.px[i], ey = reef.py[j] - reef.py[i], ez = reef.pz[j] - reef.pz[i];
        if (j !== i && ex * ex + ey * ey + ez * ez < C * C) c++;
      }
    }
    cnt[i] = c;
  }
  return cnt;
}

// t of each polyp for a mode, in out (Float32Array, length >= count).
export function colourT(reef, mode, out, F) {
  const n = reef.count; out = out && out.length >= n ? out : new Float32Array(Math.max(1, n));
  if (mode === 'age' || mode === 'natural') {
    for (let i = 0; i < n; i++) out[i] = n > 1 ? i / (n - 1) : 1;
    return out;
  }
  if (mode === 'colony') {
    for (let i = 0; i < n; i++) out[i] = (reef.col[i] * 0.618034 + 0.12) % 1;
    return out;
  }
  F = F || fieldsOf(reef);
  if (mode === 'depth') {
    for (let i = 0; i < n; i++) out[i] = F.dep[i] / Math.max(1, F.maxDep[reef.col[i]]);
  } else if (mode === 'flow') {
    for (let i = 0; i < n; i++) out[i] = Math.log(F.sub[i]) / Math.log(Math.max(2, F.maxSub[reef.col[i]]));
  } else if (mode === 'height' || mode === 'light') {
    let hm = 1e-6;
    for (let i = 0; i < n; i++) { const h = reef.py[i] - sandY(reef.px[i], reef.pz[i]); out[i] = h; if (h > hm) hm = h; }
    for (let i = 0; i < n; i++) out[i] = Math.max(0, out[i] / hm);
    if (mode === 'light') {
      const cnt = crowding(reef);
      for (let i = 0; i < n; i++) out[i] = 0.55 * out[i] + 0.45 * (1 - Math.min(1, cnt[i] / 10));
    }
  }
  return out;
}

// The natural colour of each polyp (rgb, 0..1): the species base colour,
// lighter toward the tips (small subtrees), with a small seeded jitter.
export function naturalRGB(reef, out, F) {
  const n = reef.count; out = out && out.length >= n * 3 ? out : new Float32Array(Math.max(3, n * 3));
  F = F || fieldsOf(reef);
  for (let i = 0; i < n; i++) {
    const sp = reef.colonies[reef.col[i]].sp;
    const tip = Math.pow(1 - Math.min(1, Math.log2(F.sub[i]) / 5), 1.6);
    const j = 0.9 + 0.2 * (((i * 2654435761) >>> 0) / 4294967296);
    for (let k = 0; k < 3; k++) out[i * 3 + k] = Math.min(1, (sp.base[k] + (sp.tip[k] - sp.base[k]) * tip) * j);
  }
  return out;
}

// Polyp radii from the subtree sizes.
export function radiiOf(reef, out, F) {
  const n = reef.count; out = out && out.length >= n ? out : new Float32Array(Math.max(1, n));
  F = F || fieldsOf(reef);
  for (let i = 0; i < n; i++) out[i] = polypRadius(reef.colonies[reef.col[i]].sp, F.sub[i]);
  return out;
}

// Everything a renderer needs, in node too (home thumbnails):
// { n, pos (xyz), radius, t, rgb (the colour of the mode: natural or the gradient) }.
export function polypData(reef, mode = 'natural', gradient = 'reef', rev = false) {
  const F = fieldsOf(reef), n = reef.count;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = reef.px[i]; pos[i * 3 + 1] = reef.py[i]; pos[i * 3 + 2] = reef.pz[i]; }
  const t = colourT(reef, mode, null, F), radius = radiiOf(reef, null, F);
  let rgb;
  if (mode === 'natural') rgb = naturalRGB(reef, null, F);
  else { rgb = new Float32Array(n * 3); const c = [0, 0, 0]; for (let i = 0; i < n; i++) { sample(gradient, t[i], rev, c); rgb.set(c, i * 3); } }
  return { n, pos, radius, t, rgb };
}

export { SPECIES };
