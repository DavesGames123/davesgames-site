// ============================================================================
//  MATERIAL STUDIO  ·  export/stats.js — per-channel stats and the used flags
// ────────────────────────────────────────────────────────────────────────────
//  computeStats reads each slot once and keeps min, max and mean per channel.
//  usedFlags turns the stats into flags with a 1e-3 tolerance: which
//  optional maps carry data (opacity, emissive, height, clearcoat, sheen,
//  anisotropy, normal), which maps are constant (ormConst, albedoConst),
//  and the emissive peak. The plans drop or fold maps from these flags.
//
//  GREP TARGETS
//      computeStats  usedFlags  emissivePeak  ormConst  albedoConst
// ============================================================================
import { MAP_NAMES } from '../contract.js';
import { H2F, luts } from './half.js';

/** Per-channel min/max/mean of every slot. @returns {Promise<Object<string,{min:number[],max:number[],mean:number[]}>>} */
export async function computeStats(src, slots = MAP_NAMES, progress) {
  luts();
  const out = {};
  let k = 0;
  for (const slot of slots) {
    progress?.(`reading ${slot}`, 0.05 + (0.25 * (k++ / slots.length)));
    if (!src.maps[slot]) continue;
    const a = await src.get(slot);
    const min = [Infinity, Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity, -Infinity], sum = [0, 0, 0, 0];
    for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 4; c++) {
      const v = H2F[a[i + c]];
      if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v; sum[c] += v;
    }
    const n = a.length / 4;
    out[slot] = { min, max, mean: sum.map(s => s / n) };
    src.drop(slot);
  }
  return out;
}
/** Which optional maps carry data. st null (UI preview) marks all as maybe. */
export function usedFlags(st, sc) {
  if (!st) return null;
  const g = (s, c, f) => (st[s] ? st[s][f][c] : (f === 'min' ? 0 : 0));
  const eps = 1e-3;
  return {
    opacity: sc.alphaMode !== 'opaque' || (st.albedo && st.albedo.min[3] < 1 - eps),
    emissive: !!st.emissive && Math.max(st.emissive.max[0], st.emissive.max[1], st.emissive.max[2]) > eps,
    emissivePeak: st.emissive ? Math.max(st.emissive.max[0], st.emissive.max[1], st.emissive.max[2], 0) : 0,
    height: !!st.height && (g('height', 0, 'max') - g('height', 0, 'min')) > eps,
    clearcoat: !!st.extra && st.extra.max[0] > eps,
    sheen: !!st.extra && st.extra.max[2] > eps,
    anisotropy: !!st.extra && Math.max(Math.abs(st.extra.max[3]), Math.abs(st.extra.min[3])) > eps,
    normal: !!st.normal && ((st.normal.max[0] - st.normal.min[0]) > eps || (st.normal.max[1] - st.normal.min[1]) > eps),
    ormConst: !!st.orm && [0, 1, 2].every(c => (st.orm.max[c] - st.orm.min[c]) < eps),
    aoOne: !!st.orm && st.orm.min[0] > 1 - eps,
    albedoConst: !!st.albedo && [0, 1, 2, 3].every(c => (st.albedo.max[c] - st.albedo.min[c]) < eps),
  };
}
