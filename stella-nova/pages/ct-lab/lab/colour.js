// lab/colour.js - colour map targets of the CT lab, their params fields, the share hash
// and the quick swatches. Pure data and small helpers. No DOM. node tests import this file.
//
// The lab has four colour targets. Each target keeps { id, reverse, gamma } in three
// params fields:
//   image  the object, the reconstruction, the compare tiles     cmap, cmapReverse, cmapGamma
//   sino   the sinogram                                          sinoMap, sinoReverse, sinoGamma
//   diff   the error panel (a diverging map about zero)          diffMap, diffReverse, diffGamma
//   v3d    the 3D tab: mip, slices and the dvr colour            map3d, map3dReverse, map3dGamma
// The display window (level and width) applies first. The map colours the windowed value.
//
// grep handles:
//   TARGETS, PANEL_TARGET, QUICK, targetOf, mapOf, mapPartial, encodeMaps, decodeMaps, mapNames

import * as CM from '../colormaps/maps.js';

export const TARGETS = {
  image: { id: 'cmap', reverse: 'cmapReverse', gamma: 'cmapGamma', hash: 'cmap', label: 'Images',
    groups: ['grey', 'medical', 'perceptual', 'artistic'], fallback: 'grey' },
  sino: { id: 'sinoMap', reverse: 'sinoReverse', gamma: 'sinoGamma', hash: 'sino', label: 'Sinogram',
    groups: ['grey', 'medical', 'perceptual', 'artistic', 'cyclic'], fallback: 'magma' },
  diff: { id: 'diffMap', reverse: 'diffReverse', gamma: 'diffGamma', hash: 'diff', label: 'Error',
    groups: ['diverging'], fallback: 'coolwarm', kind: 'diverging' },
  v3d: { id: 'map3d', reverse: 'map3dReverse', gamma: 'map3dGamma', hash: 'v3d', label: '3D',
    groups: ['grey', 'medical', 'perceptual', 'artistic'], fallback: 'bone' },
};

// Panel names (LAB-API.md) and target names -> target key.
export const PANEL_TARGET = {
  image: 'image', images: 'image', phantom: 'image', recon: 'image', compare: 'image',
  sino: 'sino', sinogram: 'sino',
  diff: 'diff', error: 'diff',
  v3d: 'v3d', '3d': 'v3d', volume: 'v3d',
};

// One-tap swatches above each picker.
export const QUICK = {
  image: ['grey', 'bone', 'pink-tissue', 'hot-iron', 'pet-rainbow', 'viridis', 'magma', 'inferno', 'cividis', 'gold-leaf'],
  sino: ['magma', 'inferno', 'viridis', 'mako', 'rocket', 'cubehelix', 'turbo', 'grey'],
  diff: ['coolwarm', 'red-blue', 'berlin', 'purple-orange', 'pink-green', 'brown-teal', 'vanimo', 'managua'],
  v3d: ['bone', 'xray-blue', 'magma', 'inferno', 'ice', 'gold-leaf', 'aurora', 'nebula'],
};

export function targetOf(name) { return PANEL_TARGET[String(name ?? '').toLowerCase()] ?? null; }

const clampGamma = (g) => (Number.isFinite(+g) && +g > 0 ? Math.round(Math.min(3, Math.max(1 / 3, +g)) * 100) / 100 : 1);

// A map id that suits the target: unknown ids and (for diff) non-diverging maps fall back.
export function validId(target, id) {
  const T = TARGETS[target];
  if (!CM.has(id)) return T.fallback;
  if (T.kind && CM.get(id).kind !== T.kind) return T.fallback;
  return id;
}

export function mapOf(params, target) {
  const T = TARGETS[target];
  return { id: validId(target, params[T.id]), reverse: !!params[T.reverse], gamma: clampGamma(params[T.gamma] ?? 1) };
}

// Params fields for a map choice. o: { reverse, gamma }; a missing field keeps cur (when given).
export function mapPartial(target, id, o = {}, cur = null) {
  const T = TARGETS[target];
  const old = cur ? mapOf(cur, target) : { reverse: false, gamma: 1 };
  return {
    [T.id]: validId(target, id),
    [T.reverse]: o.reverse !== undefined ? !!o.reverse : old.reverse,
    [T.gamma]: o.gamma !== undefined ? clampGamma(o.gamma) : old.gamma,
  };
}

// Hash value of one map: id, then ~r for reverse, then ~g<gamma> when gamma is not 1.
function encodeOne(m) { return `${m.id}${m.reverse ? '~r' : ''}${m.gamma !== 1 ? `~g${m.gamma}` : ''}`; }

// '&cmap=magma~r&sino=viridis~g0.8' for the targets that differ from base (the preset's maps).
export function encodeMaps(params, base) {
  let s = '';
  for (const k of Object.keys(TARGETS)) {
    const a = encodeOne(mapOf(params, k));
    if (!base || a !== encodeOne(mapOf(base, k))) s += `&${TARGETS[k].hash}=${a}`;
  }
  return s;
}

// Params fields from a location hash. Unknown maps fall back; absent targets are left out.
export function decodeMaps(hash) {
  const out = {};
  for (const k of Object.keys(TARGETS)) {
    const m = new RegExp(`(?:^|[#&?])${TARGETS[k].hash}=([\\w.~-]+)`).exec(String(hash || ''));
    if (!m) continue;
    const [id, ...flags] = m[1].split('~');
    const o = { reverse: flags.includes('r'), gamma: 1 };
    for (const f of flags) if (f[0] === 'g') o.gamma = +f.slice(1);
    Object.assign(out, mapPartial(k, id, o));
  }
  return out;
}

// 'Images bone · Sinogram magma · Error coolwarm' for captions and the export sheet.
export function mapNames(params, targets = ['image', 'sino', 'diff']) {
  return targets.map((k) => {
    const m = mapOf(params, k);
    return `${TARGETS[k].label} ${CM.get(m.id).name}${m.reverse ? ' (reversed)' : ''}`;
  }).join(' · ');
}
